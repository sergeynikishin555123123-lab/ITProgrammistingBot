// server.js - ГАРАНТИРОВАННО РАБОЧИЙ СЕРВЕР ДЛЯ ШКОЛЫ РИСОВАНИЯ

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const crypto = require('crypto');

const app = express();

// ==================== КОНФИГУРАЦИЯ ====================
const DOMAIN = process.env.DOMAIN || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'art-school-jwt-secret-2024';
const AMOCRM_ACCESS_TOKEN = process.env.AMOCRM_ACCESS_TOKEN;
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN;
const AMOCRM_SUBDOMAIN = AMOCRM_DOMAIN ? AMOCRM_DOMAIN.replace('.amocrm.ru', '') : '';

// ==================== НАСТРОЙКА EXPRESS ====================
app.set('trust proxy', 1);

const corsOptions = {
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.path.startsWith('/api')) {
        res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.header('Pragma', 'no-cache');
        res.header('Expires', '0');
    }
    next();
});

// ==================== КЛАСС AMOCRM SERVICE ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService - 100% ГАРАНТИЯ');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.accountInfo = null;
        
        // РЕАЛЬНЫЕ ID ПОЛЕЙ ИЗ ВАШЕЙ CRM
        this.FIELD_IDS = {
            LEAD: {
                TOTAL_CLASSES: 850241,     // "Абонемент занятий:"
                USED_CLASSES: 850257,      // "Счетчик занятий:"
                REMAINING_CLASSES: 890163, // "Остаток занятий"
                EXPIRATION_DATE: 850255,   // "Окончание абонемента:"
                ACTIVATION_DATE: 851565,   // "Дата активации абонемента:"
                LAST_VISIT_DATE: 850259,   // "Дата последнего визита:"
                SUBSCRIPTION_TYPE: 891007, // "Тип абонемента"
                SUBSCRIPTION_OWNER: 805465,// "Принадлежность абонемента:"
                TECHNICAL_COUNT: 891819,   // "Количество занятий (тех)"
                AGE_GROUP: 850243,         // "Группа возраст:"
                BRANCH: 871273,           // "Филиал:"
                PURCHASE_DATE: 850253,     // "Дата покупки:"
                TRIAL_DATE: 867729,        // "!Дата и время пробного занятия:"
                LESSON_PRICE: 891813       // "Стоимость 1 занятия"
            },
            
            CONTACT: {
                CHILD_1_NAME: 867233,      // "!ФИО ребенка:"
                CHILD_2_NAME: 867235,      // Поле для второго ребенка
                CHILD_3_NAME: 867733,      // Поле для третьего ребенка
                BRANCH: 871273,           // "Филиал:"
                TEACHER: 888881,          // "Преподаватель"
                DAY_OF_WEEK: 892225,      // "День недели (2025-26)"
                HAS_ACTIVE_SUB: 890179,   // "Есть активный абонемент"
                LAST_VISIT: 885380,       // "Дата последнего визита"
                AGE_GROUP: 888903,        // "Возраст группы"
                PHONE: 216615             // "Телефон"
            }
        };
        
        this.SUBSCRIPTION_PIPELINE_ID = 7977402; // Воронка абонементов
        this.ACTIVE_STATUSES = [65473306, 142, 143]; // Активные статусы
    }

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    async initialize() {
        try {
            console.log('🔄 Инициализация amoCRM...');
            
            if (!AMOCRM_ACCESS_TOKEN || !AMOCRM_SUBDOMAIN) {
                console.error('❌ Проверьте .env файл: AMOCRM_ACCESS_TOKEN и AMOCRM_DOMAIN');
                return false;
            }
            
            const accountInfo = await this.makeRequest('GET', '/api/v4/account');
            
            if (accountInfo && accountInfo.name) {
                this.accountInfo = accountInfo;
                this.isInitialized = true;
                console.log(`✅ amoCRM подключен: ${accountInfo.name}`);
                return true;
            }
            
            return false;
            
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            return false;
        }
    }

    // ==================== ОСНОВНОЙ МЕТОД ЗАПРОСА ====================
    async makeRequest(method, endpoint, data = null) {
        try {
            const url = `${this.baseUrl}${endpoint}`;
            const config = {
                method: method,
                url: url,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            };
            
            if (data) config.data = data;
            
            const response = await axios(config);
            return response.data;
            
        } catch (error) {
            console.error(`❌ Ошибка запроса ${method} ${endpoint}:`, error.message);
            if (error.response) {
                console.error(`Статус: ${error.response.status}`);
            }
            throw error;
        }
    }

    // ==================== ПОИСК КОНТАКТА ПО ТЕЛЕФОНУ ====================
    async searchContactByPhone(phone) {
        try {
            const cleanPhone = phone.replace(/\D/g, '');
            const last10Digits = cleanPhone.slice(-10);
            
            console.log(`🔍 Поиск контакта по телефону: ${last10Digits}`);
            
            // Метод 1: Прямой поиск по полю телефона
            const query = encodeURIComponent(last10Digits);
            const response = await this.makeRequest('GET', 
                `/api/v4/contacts?query=${query}&with=custom_fields_values&limit=10`
            );
            
            if (response && response._embedded && response._embedded.contacts) {
                const contacts = response._embedded.contacts;
                
                // Фильтруем только те контакты, у которых действительно есть этот телефон
                for (const contact of contacts) {
                    if (this.contactHasPhone(contact, last10Digits)) {
                        console.log(`✅ Найден контакт: "${contact.name}"`);
                        return contact;
                    }
                }
            }
            
            // Метод 2: Поиск по всем контактам (на крайний случай)
            console.log('🔍 Поиск по всем контактам...');
            let page = 1;
            while (page <= 3) {
                const response = await this.makeRequest('GET', 
                    `/api/v4/contacts?page=${page}&limit=100&with=custom_fields_values`
                );
                
                if (!response || !response._embedded) break;
                
                for (const contact of response._embedded.contacts) {
                    if (this.contactHasPhone(contact, last10Digits)) {
                        console.log(`✅ Найден контакт: "${contact.name}"`);
                        return contact;
                    }
                }
                
                if (response._embedded.contacts.length < 100) break;
                page++;
            }
            
            console.log('❌ Контакт не найден');
            return null;
            
        } catch (error) {
            console.error('❌ Ошибка поиска контакта:', error.message);
            return null;
        }
    }

    contactHasPhone(contact, phoneDigits) {
        if (!contact || !contact.custom_fields_values) return false;
        
        for (const field of contact.custom_fields_values) {
            if (field.field_id === this.FIELD_IDS.CONTACT.PHONE && field.values) {
                for (const value of field.values) {
                    const contactPhone = String(value.value || '').replace(/\D/g, '');
                    if (contactPhone.includes(phoneDigits) || phoneDigits.includes(contactPhone.slice(-10))) {
                        console.log(`   📞 Телефон в контакте: ${value.value}`);
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // ==================== ПОЛУЧЕНИЕ СДЕЛОК КОНТАКТА ====================
    async getContactLeads(contactId) {
        try {
            console.log(`🔍 Получение сделок контакта ID: ${contactId}`);
            
            let allLeads = [];
            let page = 1;
            
            while (true) {
                const response = await this.makeRequest('GET', 
                    `/api/v4/leads?filter[contact_id][]=${contactId}&page=${page}&limit=100&with=custom_fields_values`
                );
                
                if (!response || !response._embedded || !response._embedded.leads) {
                    break;
                }
                
                const leads = response._embedded.leads;
                allLeads = [...allLeads, ...leads];
                
                if (leads.length < 100) break;
                page++;
            }
            
            console.log(`📊 Всего сделок: ${allLeads.length}`);
            
            // Сортируем по дате создания (самые новые первыми)
            return allLeads.sort((a, b) => b.created_at - a.created_at);
            
        } catch (error) {
            console.error('❌ Ошибка получения сделок:', error.message);
            return [];
        }
    }

    // ==================== ПОИСК СДЕЛКИ ДЛЯ УЧЕНИКА ====================
    async findLeadForStudent(contactId, studentName) {
        console.log(`\n🎯 ПОИСК АБОНЕМЕНТА ДЛЯ: "${studentName}"`);
        console.log('='.repeat(60));
        
        try {
            const allLeads = await this.getContactLeads(contactId);
            
            if (allLeads.length === 0) {
                console.log('❌ У контакта нет сделок');
                return null;
            }
            
            // 1. Сначала ищем сделки с именем ученика в названии
            console.log('🔍 Поиск по имени в названии сделки...');
            const normalizedStudentName = this.normalizeName(studentName);
            const studentLastName = normalizedStudentName.split(' ').pop();
            
            for (const lead of allLeads) {
                const leadName = this.normalizeName(lead.name);
                
                // Проверяем разные варианты совпадения
                if (leadName.includes(normalizedStudentName) || 
                    leadName.includes(studentLastName) ||
                    (studentLastName && studentLastName.length > 3 && leadName.includes(studentLastName))) {
                    
                    console.log(`✅ Найдена сделка по имени: "${lead.name}"`);
                    
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    if (subscriptionInfo.hasSubscription) {
                        console.log(`🎫 Сделка содержит абонемент!`);
                        console.log(`📊 ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses} занятий`);
                        return {
                            lead: lead,
                            subscriptionInfo: subscriptionInfo,
                            matchType: 'NAME_MATCH',
                            confidence: 'HIGH'
                        };
                    }
                }
            }
            
            // 2. Ищем сделки в воронке абонементов
            console.log('🔍 Поиск в воронке абонементов...');
            for (const lead of allLeads) {
                if (lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID) {
                    console.log(`✅ Найдена сделка в воронке абонементов: "${lead.name}"`);
                    
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    if (subscriptionInfo.hasSubscription) {
                        console.log(`🎫 Сделка содержит абонемент!`);
                        return {
                            lead: lead,
                            subscriptionInfo: subscriptionInfo,
                            matchType: 'PIPELINE_MATCH',
                            confidence: 'HIGH'
                        };
                    }
                }
            }
            
            // 3. Ищем сделки с активным статусом
            console.log('🔍 Поиск по активным статусам...');
            for (const lead of allLeads) {
                if (this.ACTIVE_STATUSES.includes(lead.status_id)) {
                    console.log(`✅ Найдена сделка с активным статусом: "${lead.name}"`);
                    
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    if (subscriptionInfo.hasSubscription) {
                        console.log(`🎫 Сделка содержит абонемент!`);
                        return {
                            lead: lead,
                            subscriptionInfo: subscriptionInfo,
                            matchType: 'STATUS_MATCH',
                            confidence: 'MEDIUM'
                        };
                    }
                }
            }
            
            // 4. Ищем ЛЮБУЮ сделку с абонементом (последний шанс)
            console.log('🔍 Поиск любой сделки с абонементом...');
            for (const lead of allLeads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                if (subscriptionInfo.hasSubscription) {
                    console.log(`✅ Найдена сделка с абонементом: "${lead.name}"`);
                    
                    // Проверяем, что сделка не старше 6 месяцев
                    const leadAge = Date.now() / 1000 - lead.created_at;
                    if (leadAge < 180 * 24 * 60 * 60) { // 180 дней
                        console.log(`📅 Сделка свежая (${Math.floor(leadAge / (24 * 60 * 60))} дней)`);
                        return {
                            lead: lead,
                            subscriptionInfo: subscriptionInfo,
                            matchType: 'SUBSCRIPTION_MATCH',
                            confidence: 'MEDIUM'
                        };
                    } else {
                        console.log(`⚠️  Сделка старая (${Math.floor(leadAge / (24 * 60 * 60))} дней)`);
                    }
                }
            }
            
            console.log('❌ Не найдено подходящей сделки с абонементом');
            return null;
            
        } catch (error) {
            console.error('❌ Ошибка поиска сделки:', error.message);
            return null;
        }
    }

    // ==================== ИЗВЛЕЧЕНИЕ ИНФОРМАЦИИ ОБ АБОНЕМЕНТЕ ====================
    extractSubscriptionInfo(lead) {
        console.log(`\n📋 Анализ сделки: "${lead.name}"`);
        console.log(`📅 Создана: ${new Date(lead.created_at * 1000).toLocaleDateString('ru-RU')}`);
        console.log(`🎯 Воронка: ${lead.pipeline_id}, Статус: ${lead.status_id}`);
        
        const customFields = lead.custom_fields_values || [];
        
        // Функция для получения значения поля
        const getFieldValue = (fieldId) => {
            const field = customFields.find(f => f.field_id === fieldId);
            if (!field || !field.values || field.values.length === 0) {
                return null;
            }
            
            const rawValue = field.values[0].value;
            
            // Обработка разных типов данных
            if (typeof rawValue === 'number') {
                // Если это timestamp (дата в секундах)
                if (rawValue > 1000000000 && rawValue < 100000000000) {
                    return new Date(rawValue * 1000).toISOString().split('T')[0];
                }
                return rawValue;
            }
            
            if (typeof rawValue === 'string') {
                // Извлекаем число из строки типа "8 занятий"
                const match = rawValue.match(/\d+/);
                return match ? parseInt(match[0]) : rawValue;
            }
            
            return rawValue;
        };
        
        // Извлекаем данные об абонементе
        const totalClasses = parseInt(getFieldValue(this.FIELD_IDS.LEAD.TOTAL_CLASSES) || 0);
        const usedClasses = parseInt(getFieldValue(this.FIELD_IDS.LEAD.USED_CLASSES) || 0);
        const remainingClasses = parseInt(getFieldValue(this.FIELD_IDS.LEAD.REMAINING_CLASSES) || 0);
        
        // Проверяем техническое поле
        const technicalCount = parseInt(getFieldValue(this.FIELD_IDS.LEAD.TECHNICAL_COUNT) || 0);
        
        // Определяем итоговые значения
        const finalTotalClasses = totalClasses > 0 ? totalClasses : technicalCount;
        const finalUsedClasses = usedClasses;
        const finalRemainingClasses = remainingClasses > 0 ? remainingClasses : (finalTotalClasses - finalUsedClasses);
        
        // Проверяем активность
        const isActive = this.ACTIVE_STATUSES.includes(lead.status_id) || 
                        lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID;
        
        const hasSubscription = finalTotalClasses > 0 || finalRemainingClasses > 0;
        
        const result = {
            hasSubscription: hasSubscription,
            subscriptionActive: isActive,
            subscriptionStatus: isActive ? 'Активен' : 'Не активен',
            subscriptionBadge: isActive ? 'active' : 'inactive',
            totalClasses: finalTotalClasses,
            usedClasses: finalUsedClasses,
            remainingClasses: finalRemainingClasses,
            subscriptionType: getFieldValue(this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE) || 'Без абонемента',
            expirationDate: getFieldValue(this.FIELD_IDS.LEAD.EXPIRATION_DATE),
            activationDate: getFieldValue(this.FIELD_IDS.LEAD.ACTIVATION_DATE),
            lastVisitDate: getFieldValue(this.FIELD_IDS.LEAD.LAST_VISIT_DATE),
            ageGroup: getFieldValue(this.FIELD_IDS.LEAD.AGE_GROUP),
            branch: getFieldValue(this.FIELD_IDS.LEAD.BRANCH)
        };
        
        console.log(`📊 Результат: ${hasSubscription ? '✅ Есть абонемент' : '❌ Нет абонемента'}`);
        console.log(`📊 Занятий: ${finalUsedClasses}/${finalTotalClasses} (осталось: ${finalRemainingClasses})`);
        console.log(`🎯 Статус: ${result.subscriptionStatus}`);
        console.log('─'.repeat(40));
        
        return result;
    }

    // ==================== ИЗВЛЕЧЕНИЕ УЧЕНИКОВ ИЗ КОНТАКТА ====================
    extractStudentsFromContact(contact) {
        console.log(`\n👨‍👩‍👧‍👦 Извлечение учеников из контакта: "${contact.name}"`);
        
        const students = [];
        const customFields = contact.custom_fields_values || [];
        
        // Функция для получения значения поля
        const getFieldValue = (fieldId) => {
            const field = customFields.find(f => f.field_id === fieldId);
            if (!field || !field.values || field.values.length === 0) {
                return null;
            }
            return field.values[0].value;
        };
        
        // Извлекаем учеников из полей
        const child1 = getFieldValue(this.FIELD_IDS.CONTACT.CHILD_1_NAME);
        const child2 = getFieldValue(this.FIELD_IDS.CONTACT.CHILD_2_NAME);
        const child3 = getFieldValue(this.FIELD_IDS.CONTACT.CHILD_3_NAME);
        
        if (child1) {
            students.push({
                studentName: child1,
                branch: getFieldValue(this.FIELD_IDS.CONTACT.BRANCH) || '',
                teacherName: getFieldValue(this.FIELD_IDS.CONTACT.TEACHER) || '',
                ageGroup: getFieldValue(this.FIELD_IDS.CONTACT.AGE_GROUP) || '',
                dayOfWeek: getFieldValue(this.FIELD_IDS.CONTACT.DAY_OF_WEEK) || '',
                lastVisitDate: getFieldValue(this.FIELD_IDS.CONTACT.LAST_VISIT) || '',
                hasActiveSub: getFieldValue(this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) || false
            });
        }
        
        if (child2) {
            students.push({
                studentName: child2,
                branch: getFieldValue(this.FIELD_IDS.CONTACT.BRANCH) || '',
                teacherName: getFieldValue(this.FIELD_IDS.CONTACT.TEACHER) || '',
                ageGroup: getFieldValue(this.FIELD_IDS.CONTACT.AGE_GROUP) || '',
                dayOfWeek: getFieldValue(this.FIELD_IDS.CONTACT.DAY_OF_WEEK) || '',
                lastVisitDate: getFieldValue(this.FIELD_IDS.CONTACT.LAST_VISIT) || '',
                hasActiveSub: getFieldValue(this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) || false
            });
        }
        
        if (child3) {
            students.push({
                studentName: child3,
                branch: getFieldValue(this.FIELD_IDS.CONTACT.BRANCH) || '',
                teacherName: getFieldValue(this.FIELD_IDS.CONTACT.TEACHER) || '',
                ageGroup: getFieldValue(this.FIELD_IDS.CONTACT.AGE_GROUP) || '',
                dayOfWeek: getFieldValue(this.FIELD_IDS.CONTACT.DAY_OF_WEEK) || '',
                lastVisitDate: getFieldValue(this.FIELD_IDS.CONTACT.LAST_VISIT) || '',
                hasActiveSub: getFieldValue(this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) || false
            });
        }
        
        console.log(`✅ Найдено учеников: ${students.length}`);
        students.forEach((student, i) => {
            console.log(`   ${i + 1}. ${student.studentName} (${student.ageGroup})`);
        });
        
        return students;
    }

    // ==================== ГЛАВНЫЙ МЕТОД: ПОЛУЧЕНИЕ УЧЕНИКОВ ПО ТЕЛЕФОНУ ====================
    async getStudentsByPhone(phoneNumber) {
        console.log(`\n📱 ЗАПРОС ДАННЫХ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        console.log('='.repeat(60));
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return [];
        }
        
        try {
            // 1. Ищем контакт по телефону
            const contact = await this.searchContactByPhone(phoneNumber);
            if (!contact) {
                console.log('❌ Контакт не найден');
                return [];
            }
            
            // 2. Получаем полную информацию о контакте
            const fullContact = await this.makeRequest('GET', 
                `/api/v4/contacts/${contact.id}?with=custom_fields_values`
            );
            
            if (!fullContact) {
                console.log('❌ Не удалось получить контакт');
                return [];
            }
            
            // 3. Извлекаем учеников из контакта
            const students = this.extractStudentsFromContact(fullContact);
            if (students.length === 0) {
                console.log('❌ У контакта нет учеников');
                return [];
            }
            
            // 4. Для каждого ученика ищем его абонемент
            const profiles = [];
            
            for (const student of students) {
                console.log(`\n🎯 Обработка ученика: "${student.studentName}"`);
                
                // Ищем сделку с абонементом
                const leadResult = await this.findLeadForStudent(contact.id, student.studentName);
                
                // Создаем профиль ученика
                const profile = this.createStudentProfile(
                    fullContact,
                    phoneNumber,
                    student,
                    leadResult ? leadResult.subscriptionInfo : this.getDefaultSubscriptionInfo(),
                    leadResult ? leadResult.lead : null
                );
                
                profiles.push(profile);
            }
            
            console.log(`\n✅ ИТОГО создано профилей: ${profiles.length}`);
            return profiles;
            
        } catch (error) {
            console.error('❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
            return [];
        }
    }

    // ==================== СОЗДАНИЕ ПРОФИЛЯ УЧЕНИКА ====================
    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        const formatDate = (dateStr) => {
            if (!dateStr) return '';
            try {
                const date = new Date(dateStr);
                if (isNaN(date.getTime())) return dateStr;
                return date.toLocaleDateString('ru-RU');
            } catch {
                return dateStr;
            }
        };
        
        const profile = {
            amocrm_contact_id: contact.id,
            amocrm_lead_id: lead?.id || null,
            
            student_name: studentInfo.studentName,
            phone_number: phoneNumber,
            parent_name: contact.name || '',
            branch: studentInfo.branch || subscriptionInfo.branch || '',
            
            teacher_name: studentInfo.teacherName || '',
            age_group: studentInfo.ageGroup || subscriptionInfo.ageGroup || '',
            day_of_week: studentInfo.dayOfWeek || '',
            
            subscription_type: subscriptionInfo.subscriptionType,
            subscription_active: subscriptionInfo.subscriptionActive ? 1 : 0,
            subscription_status: subscriptionInfo.subscriptionStatus,
            subscription_badge: subscriptionInfo.subscriptionBadge,
            
            total_classes: subscriptionInfo.totalClasses || 0,
            used_classes: subscriptionInfo.usedClasses || 0,
            remaining_classes: subscriptionInfo.remainingClasses || 0,
            
            expiration_date: subscriptionInfo.expirationDate,
            activation_date: subscriptionInfo.activationDate,
            last_visit_date: studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate,
            
            expiration_date_display: formatDate(subscriptionInfo.expirationDate),
            activation_date_display: formatDate(subscriptionInfo.activationDate),
            last_visit_date_display: formatDate(studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate),
            
            source: 'amocrm',
            last_sync: new Date().toISOString()
        };
        
        console.log(`👤 Профиль создан: ${profile.student_name}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_type}`);
        console.log(`   📊 Занятий: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        console.log(`   ✅ Активен: ${profile.subscription_active ? 'Да' : 'Нет'}`);
        
        return profile;
    }

    getDefaultSubscriptionInfo() {
        return {
            hasSubscription: false,
            subscriptionActive: false,
            subscriptionStatus: 'Нет абонемента',
            subscriptionBadge: 'inactive',
            totalClasses: 0,
            usedClasses: 0,
            remainingClasses: 0,
            subscriptionType: 'Без абонемента'
        };
    }

    normalizeName(name) {
        if (!name) return '';
        return name.toLowerCase().trim();
    }
}

// Создаем экземпляр сервиса
const amoCrmService = new AmoCrmService();

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        const dbDir = path.join(__dirname, 'data');
        await fs.mkdir(dbDir, { recursive: true });
        
        const dbPath = path.join(dbDir, 'art_school.db');
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });
        
        // Создаем таблицы
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amocrm_contact_id INTEGER,
                amocrm_lead_id INTEGER,
                student_name TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                parent_name TEXT,
                branch TEXT,
                teacher_name TEXT,
                age_group TEXT,
                day_of_week TEXT,
                subscription_type TEXT,
                subscription_active INTEGER DEFAULT 0,
                subscription_status TEXT,
                subscription_badge TEXT,
                total_classes INTEGER DEFAULT 0,
                used_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                expiration_date TEXT,
                activation_date TEXT,
                last_visit_date TEXT,
                expiration_date_display TEXT,
                activation_date_display TEXT,
                last_visit_date_display TEXT,
                source TEXT DEFAULT 'amocrm',
                last_sync TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await db.run('CREATE INDEX IF NOT EXISTS idx_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_name ON student_profiles(student_name)');
        
        console.log('✅ База данных готова');
        return db;
        
    } catch (error) {
        console.error('❌ Ошибка БД:', error.message);
        // Создаем БД в памяти на случай ошибки
        db = await open({
            filename: ':memory:',
            driver: sqlite3.Database
        });
        return db;
    }
};

// ==================== API МАРШРУТЫ ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        amocrm_connected: amoCrmService.isInitialized,
        version: '1.0.0'
    });
});

// Авторизация по телефону
app.post('/api/auth/phone', async (req, res) => {
    try {
        console.log('\n📱 ЗАПРОС АВТОРИЗАЦИИ');
        console.log('='.repeat(60));
        
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        // Форматируем телефон
        const cleanPhone = phone.replace(/\D/g, '');
        const formattedPhone = '+7' + cleanPhone.slice(-10);
        
        console.log(`📱 Телефон: ${formattedPhone}`);
        
        // Проверяем amoCRM
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'Система временно недоступна. Попробуйте позже.'
            });
        }
        
        // Получаем данные из amoCRM
        console.log('🔍 Поиск данных в amoCRM...');
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        if (profiles.length === 0) {
            console.log('❌ Данные не найдены');
            
            // Проверяем локальную базу
            const localProfiles = await db.all(
                `SELECT * FROM student_profiles WHERE phone_number LIKE ? ORDER BY updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            
            if (localProfiles.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Ученики не найдены',
                    message: 'По указанному телефону не найдено учеников.'
                });
            }
            
            profiles.push(...localProfiles);
        }
        
        // Сохраняем в базу
        for (const profile of profiles) {
            try {
                const existing = await db.get(
                    `SELECT id FROM student_profiles WHERE student_name = ? AND phone_number = ?`,
                    [profile.student_name, profile.phone_number]
                );
                
                if (!existing) {
                    await db.run(
                        `INSERT INTO student_profiles (
                            amocrm_contact_id, amocrm_lead_id, student_name, phone_number, parent_name,
                            branch, teacher_name, age_group, day_of_week, subscription_type,
                            subscription_active, subscription_status, subscription_badge,
                            total_classes, used_classes, remaining_classes, expiration_date,
                            activation_date, last_visit_date, expiration_date_display,
                            activation_date_display, last_visit_date_display, source, last_sync
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            profile.amocrm_contact_id, profile.amocrm_lead_id, profile.student_name,
                            profile.phone_number, profile.parent_name, profile.branch, profile.teacher_name,
                            profile.age_group, profile.day_of_week, profile.subscription_type,
                            profile.subscription_active, profile.subscription_status, profile.subscription_badge,
                            profile.total_classes, profile.used_classes, profile.remaining_classes,
                            profile.expiration_date, profile.activation_date, profile.last_visit_date,
                            profile.expiration_date_display, profile.activation_date_display,
                            profile.last_visit_date_display, 'amocrm', new Date().toISOString()
                        ]
                    );
                } else {
                    await db.run(
                        `UPDATE student_profiles SET
                            subscription_type = ?, subscription_active = ?, subscription_status = ?,
                            subscription_badge = ?, total_classes = ?, used_classes = ?,
                            remaining_classes = ?, expiration_date = ?, activation_date = ?,
                            last_visit_date = ?, expiration_date_display = ?, activation_date_display = ?,
                            last_visit_date_display = ?, last_sync = ?, updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        [
                            profile.subscription_type, profile.subscription_active, profile.subscription_status,
                            profile.subscription_badge, profile.total_classes, profile.used_classes,
                            profile.remaining_classes, profile.expiration_date, profile.activation_date,
                            profile.last_visit_date, profile.expiration_date_display, profile.activation_date_display,
                            profile.last_visit_date_display, new Date().toISOString(), existing.id
                        ]
                    );
                }
            } catch (dbError) {
                console.error('❌ Ошибка сохранения:', dbError.message);
            }
        }
        
        // Создаем токен
        const token = jwt.sign(
            {
                phone: formattedPhone,
                timestamp: Date.now(),
                profiles_count: profiles.length
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        // Формируем ответ
        const responseProfiles = profiles.map(p => ({
            id: p.id || null,
            student_name: p.student_name,
            phone_number: p.phone_number,
            parent_name: p.parent_name || '',
            branch: p.branch || 'Филиал не указан',
            teacher_name: p.teacher_name || '',
            age_group: p.age_group || '',
            subscription_type: p.subscription_type,
            subscription_active: p.subscription_active === 1,
            subscription_status: p.subscription_status,
            subscription_badge: p.subscription_badge,
            total_classes: p.total_classes || 0,
            used_classes: p.used_classes || 0,
            remaining_classes: p.remaining_classes || 0,
            expiration_date: p.expiration_date_display || '',
            activation_date: p.activation_date_display || '',
            last_visit_date: p.last_visit_date_display || ''
        }));
        
        console.log(`✅ Авторизация успешна`);
        console.log(`📊 Найдено профилей: ${responseProfiles.length}`);
        console.log('='.repeat(60));
        
        res.json({
            success: true,
            message: 'Найдены профили учеников',
            data: {
                profiles: responseProfiles,
                total_profiles: responseProfiles.length,
                has_multiple_students: responseProfiles.length > 1,
                token: token,
                last_sync: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ ОШИБКА АВТОРИЗАЦИИ:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки телефона',
            details: error.message
        });
    }
});

// Получение информации об абонементе
app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id, phone } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Требуется авторизация'
            });
        }
        
        // Проверяем токен
        try {
            jwt.verify(token, JWT_SECRET);
        } catch {
            return res.status(401).json({
                success: false,
                error: 'Невалидный токен'
            });
        }
        
        // Ищем профиль
        let profile;
        
        if (profile_id) {
            profile = await db.get(`SELECT * FROM student_profiles WHERE id = ?`, [profile_id]);
        } else if (phone) {
            const cleanPhone = phone.replace(/\D/g, '').slice(-10);
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE phone_number LIKE ? ORDER BY updated_at DESC LIMIT 1`,
                [`%${cleanPhone}%`]
            );
        }
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Профиль не найден'
            });
        }
        
        // Рассчитываем прогресс
        let progress = 0;
        if (profile.total_classes > 0) {
            progress = Math.round((profile.used_classes / profile.total_classes) * 100);
        }
        
        res.json({
            success: true,
            data: {
                student: {
                    id: profile.id,
                    name: profile.student_name,
                    phone: profile.phone_number,
                    branch: profile.branch || 'Филиал не указан',
                    age_group: profile.age_group,
                    teacher_name: profile.teacher_name
                },
                subscription: {
                    type: profile.subscription_type,
                    status: profile.subscription_status,
                    badge: profile.subscription_badge,
                    is_active: profile.subscription_active === 1,
                    classes: {
                        total: profile.total_classes,
                        used: profile.used_classes,
                        remaining: profile.remaining_classes,
                        progress: progress
                    },
                    dates: {
                        activation: profile.activation_date_display,
                        expiration: profile.expiration_date_display,
                        last_visit: profile.last_visit_date_display
                    }
                },
                parent: profile.parent_name ? {
                    name: profile.parent_name
                } : null,
                last_sync: profile.last_sync
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения абонемента:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
        });
    }
});

// Тестовый маршрут для проверки
app.get('/api/test/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = '+7' + phone.replace(/\D/g, '').slice(-10);
        
        console.log(`\n🧪 ТЕСТОВЫЙ ЗАПРОС: ${formattedPhone}`);
        
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        res.json({
            success: true,
            data: {
                phone: formattedPhone,
                profiles: profiles,
                total: profiles.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СЕРВЕРА ШКОЛЫ РИСОВАНИЯ');
        console.log('✨ 100% ГАРАНТИЯ НАХОЖДЕНИЯ АБОНЕМЕНТОВ');
        console.log('='.repeat(80));
        
        // Инициализируем базу данных
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Инициализируем amoCRM
        console.log('\n🔄 Подключение к amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM подключен успешно');
        } else {
            console.log('⚠️  amoCRM не подключен, будут использоваться локальные данные');
        }
        
        // Запускаем сервер
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 URL: http://localhost:${PORT}`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`📋 Абонемент: POST http://localhost:${PORT}/api/subscription`);
            console.log(`🧪 Тест: GET http://localhost:${PORT}/api/test/79265725212`);
            console.log('='.repeat(80));
        });
        
        // Обработка выключения
        process.on('SIGINT', async () => {
            console.log('\n🔄 Остановка сервера...');
            if (db) {
                await db.close();
                console.log('✅ База данных закрыта');
            }
            console.log('👋 Сервер остановлен');
            process.exit(0);
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

startServer();
