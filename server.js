// server.js - ИСПРАВЛЕННЫЙ СЕРВЕР ДЛЯ ВАШИХ РЕАЛЬНЫХ ДАННЫХ

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

// ==================== КЛАСС AMOCRM SERVICE ДЛЯ ВАШИХ ДАННЫХ ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ИНИЦИАЛИЗАЦИЯ ДЛЯ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('📊 ИСПОЛЬЗУЮ РЕАЛЬНЫЕ ДАННЫЕ ИЗ ВАШЕГО AMOCRM');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        
        // ВАШИ РЕАЛЬНЫЕ ID ПОЛЕЙ (взято из дампа)
        this.FIELD_IDS = {
            LEAD: {
                TOTAL_CLASSES: 850241,        // "Абонемент занятий:"
                USED_CLASSES: 850257,         // "Счетчик занятий:"
                REMAINING_CLASSES: 890163,    // "Остаток занятий"
                SUBSCRIPTION_TYPE: 891007,    // "Тип абонемента"
                ACTIVATION_DATE: 851565,      // "Дата активации абонемента:"
                EXPIRATION_DATE: 850255,      // "Окончание абонемента:"
                LAST_VISIT_DATE: 850259,      // "Дата последнего визита:"
                AGE_GROUP: 850243,            // "Группа возраст:"
                BRANCH: 891589,               // "Филиал" (ВНИМАНИЕ: это ВАШЕ поле!)
                LESSON_PRICE: 891813,         // "Стоимость 1 занятия"
                PURCHASE_DATE: 850253,        // "Дата покупки:"
                SUBSCRIPTION_OWNERSHIP: 805465 // "Принадлежность абонемента:"
            },
            CONTACT: {
                CHILD_1_NAME: 867233,         // "!ФИО ребенка:" 
                CHILD_2_NAME: 867235,         // "!!ФИО ребенка:"
                CHILD_3_NAME: 867733,         // "!!!ФИО ребенка:"
                BRANCH: 871273,               // "Филиал:"
                TEACHER: 888881,              // "Преподаватель"
                DAY_OF_WEEK: 888879,          // "День недели посещения"
                PHONE: 216615,                // "Телефон"
                EMAIL: 216617,                // "Email"
                AGE_GROUP: 888903,            // "Возраст группы"
                HAS_ACTIVE_SUB: 890179        // "Есть активный абонемент"
            }
        };
        
        // ВАШИ РЕАЛЬНЫЕ ВОРОНКИ И СТАТУСЫ
        this.SUBSCRIPTION_PIPELINE_ID = 7977402; // Воронка "!Абонемент"
        this.SCHOOL_PIPELINE_IDS = [5663743, 7137514, 7490194]; // Школы Чертаново, Свиблово, Амакидс
        
        this.ACTIVE_SUBSCRIPTION_STATUSES = [
            72490890, // "Купленный абонемент"
            65473306  // "Активный абонемент"
        ];
        
        this.SUCCESS_STATUSES = [142]; // "Успешно реализовано"
        
        console.log('✅ Использую ВАШИ реальные данные:');
        console.log(`   🎯 Воронка абонементов: ${this.SUBSCRIPTION_PIPELINE_ID}`);
        console.log(`   ✅ Активные статусы: ${this.ACTIVE_SUBSCRIPTION_STATUSES.join(', ')}`);
    }
    
    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    async initialize() {
        try {
            console.log('🔄 Проверка соединения с amoCRM...');
            
            if (!AMOCRM_ACCESS_TOKEN || !AMOCRM_SUBDOMAIN) {
                console.error('❌ Не установлены переменные окружения');
                return false;
            }
            
            // Простая проверка соединения
            const accountInfo = await this.makeRequest('GET', '/api/v4/account');
            
            if (accountInfo && accountInfo.id) {
                console.log(`✅ Подключено к аккаунту: "${accountInfo.name}"`);
                this.isInitialized = true;
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('❌ Ошибка инициализации:', error.message);
            return false;
        }
    }
    
    // ==================== ОСНОВНЫЕ МЕТОДЫ API ====================
    async makeRequest(method, endpoint, data = null) {
        try {
            const url = `${this.baseUrl}${endpoint}`;
            
            const config = {
                method: method,
                url: url,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'ArtSchoolApp/1.0'
                },
                timeout: 30000
            };
            
            if (data) {
                config.data = data;
            }
            
            const response = await axios(config);
            return response.data;
            
        } catch (error) {
            console.error(`❌ Ошибка запроса ${method} ${endpoint}:`, error.message);
            
            if (error.response) {
                console.error(`Статус: ${error.response.status}`);
                console.error(`Данные:`, JSON.stringify(error.response.data, null, 2));
            }
            
            throw error;
        }
    }
    
    // ==================== ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ ====================
    async searchContactsByPhone(phone) {
        try {
            const cleanPhone = phone.replace(/\D/g, '');
            const last10Digits = cleanPhone.slice(-10);
            
            console.log(`🔍 Поиск контактов по телефону: ${last10Digits}`);
            
            // Пробуем разные форматы поиска
            const searchFormats = [
                last10Digits,
                cleanPhone,
                `+7${last10Digits}`,
                `8${last10Digits}`,
                `7${last10Digits}`
            ];
            
            let allContacts = [];
            
            for (const searchTerm of searchFormats) {
                if (!searchTerm || searchTerm.length < 7) continue;
                
                try {
                    const response = await this.makeRequest('GET', 
                        `/api/v4/contacts?query=${searchTerm}&with=custom_fields_values&limit=50`
                    );
                    
                    if (response && response._embedded && response._embedded.contacts) {
                        const contacts = response._embedded.contacts;
                        
                        // Фильтруем только те контакты, у которых действительно есть этот телефон
                        const filteredContacts = contacts.filter(contact => 
                            this.contactHasPhone(contact, last10Digits)
                        );
                        
                        allContacts = [...allContacts, ...filteredContacts];
                    }
                } catch (error) {
                    continue;
                }
            }
            
            // Убираем дубликаты
            const uniqueContacts = [];
            const seenIds = new Set();
            
            for (const contact of allContacts) {
                if (!seenIds.has(contact.id)) {
                    seenIds.add(contact.id);
                    uniqueContacts.push(contact);
                }
            }
            
            console.log(`✅ Найдено контактов: ${uniqueContacts.length}`);
            
            return {
                _embedded: {
                    contacts: uniqueContacts
                }
            };
            
        } catch (error) {
            console.error('❌ Ошибка поиска контактов:', error.message);
            return { _embedded: { contacts: [] } };
        }
    }
    
    // Проверяет, есть ли у контакта указанный телефон
    contactHasPhone(contact, last10Digits) {
        if (!contact || !contact.custom_fields_values) {
            return false;
        }
        
        const phoneFields = contact.custom_fields_values.filter(field => {
            const fieldId = field.field_id || field.id;
            return fieldId === this.FIELD_IDS.CONTACT.PHONE;
        });
        
        if (phoneFields.length === 0) {
            return false;
        }
        
        // Проверяем все значения телефона
        for (const phoneField of phoneFields) {
            if (phoneField.values && Array.isArray(phoneField.values)) {
                for (const value of phoneField.values) {
                    const contactPhone = String(value.value || '').replace(/\D/g, '');
                    const contactLast10 = contactPhone.slice(-10);
                    
                    if (contactLast10 === last10Digits || contactPhone.includes(last10Digits)) {
                        return true;
                    }
                }
            }
        }
        
        return false;
    }
    
    // ==================== ПОЛУЧЕНИЕ ПОЛНОЙ ИНФОРМАЦИИ О КОНТАКТЕ ====================
    async getFullContactInfo(contactId) {
        try {
            console.log(`🔍 Получение контакта ID: ${contactId}`);
            
            const contact = await this.makeRequest('GET', 
                `/api/v4/contacts/${contactId}?with=custom_fields_values`
            );
            
            if (!contact) {
                console.error(`❌ Контакт ${contactId} не найден`);
                return null;
            }
            
            // Получаем сделки контакта
            const leads = await this.getContactLeads(contactId);
            
            return {
                ...contact,
                leads: leads || []
            };
            
        } catch (error) {
            console.error(`❌ Ошибка получения контакта ${contactId}:`, error.message);
            return null;
        }
    }
    
    // Получение сделок контакта
    async getContactLeads(contactId) {
        try {
            const response = await this.makeRequest('GET', 
                `/api/v4/leads?filter[contact_id][]=${contactId}&with=custom_fields_values&limit=100`
            );
            
            return response?._embedded?.leads || [];
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок контакта ${contactId}:`, error.message);
            return [];
        }
    }
    
    // ==================== ИЗВЛЕЧЕНИЕ УЧЕНИКОВ ИЗ КОНТАКТА ====================
    extractStudentsFromContact(contact) {
        console.log(`\n👨‍👩‍👧‍👦 Извлечение учеников из контакта: "${contact.name}"`);
        
        const students = [];
        const customFields = contact.custom_fields_values || [];
        
        const getFieldValue = (fieldId) => {
            const field = customFields.find(f => (f.field_id || f.id) === fieldId);
            if (!field || !field.values || field.values.length === 0) {
                return null;
            }
            return field.values[0].value;
        };
        
        // Извлекаем учеников
        const child1 = getFieldValue(this.FIELD_IDS.CONTACT.CHILD_1_NAME);
        const child2 = getFieldValue(this.FIELD_IDS.CONTACT.CHILD_2_NAME);
        const child3 = getFieldValue(this.FIELD_IDS.CONTACT.CHILD_3_NAME);
        
        console.log(`👦 Ученик 1: ${child1 || 'Не указан'}`);
        console.log(`👧 Ученик 2: ${child2 || 'Не указан'}`);
        console.log(`👶 Ученик 3: ${child3 || 'Не указан'}`);
        
        // Собираем данные об учениках
        const processChild = (childName, index) => {
            if (childName) {
                students.push({
                    studentName: childName,
                    branch: getFieldValue(this.FIELD_IDS.CONTACT.BRANCH) || '',
                    teacherName: getFieldValue(this.FIELD_IDS.CONTACT.TEACHER) || '',
                    ageGroup: getFieldValue(this.FIELD_IDS.CONTACT.AGE_GROUP) || '',
                    dayOfWeek: getFieldValue(this.FIELD_IDS.CONTACT.DAY_OF_WEEK) || '',
                    lastVisitDate: getFieldValue(this.FIELD_IDS.CONTACT.LAST_VISIT) || '',
                    hasActiveSub: getFieldValue(this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) || false
                });
            }
        };
        
        processChild(child1, 1);
        processChild(child2, 2);
        processChild(child3, 3);
        
        console.log(`✅ Извлечено учеников: ${students.length}`);
        
        return students;
    }
    
    // ==================== ПОИСК СДЕЛКИ С АБОНЕМЕНТОМ ДЛЯ УЧЕНИКА ====================
    async findSubscriptionLeadForStudent(contactId, studentName) {
        console.log(`\n🎯 Поиск абонемента для: "${studentName}"`);
        
        try {
            // Получаем все сделки контакта
            const allLeads = await this.getContactLeads(contactId);
            
            if (allLeads.length === 0) {
                console.log('❌ У контакта нет сделок');
                return null;
            }
            
            console.log(`📊 Всего сделок у контакта: ${allLeads.length}`);
            
            // Нормализуем имя для поиска
            const normalizedStudentName = this.normalizeName(studentName);
            const studentLastName = normalizedStudentName.split(' ').pop();
            const studentFirstName = normalizedStudentName.split(' ')[0];
            
            // ШАГ 1: Ищем сделку в воронке абонементов с активным статусом (самое важное!)
            console.log(`\n🔍 Шаг 1: Поиск в воронке абонементов (ID: ${this.SUBSCRIPTION_PIPELINE_ID})`);
            
            for (const lead of allLeads) {
                // Проверяем, что сделка в правильной воронке И имеет активный статус
                if (lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID && 
                    this.ACTIVE_SUBSCRIPTION_STATUSES.includes(lead.status_id)) {
                    
                    console.log(`✅ Найдена активная сделка в воронке абонементов: "${lead.name}"`);
                    
                    // Проверяем, что имя ученика совпадает
                    const leadName = this.normalizeName(lead.name);
                    const nameMatches = leadName.includes(normalizedStudentName) || 
                                       leadName.includes(studentLastName) ||
                                       normalizedStudentName.includes(leadName.split(' ')[0]);
                    
                    if (nameMatches) {
                        console.log(`✅ Имя ученика совпадает: "${studentName}"`);
                        const subscriptionInfo = this.extractSubscriptionInfo(lead);
                        
                        if (subscriptionInfo.hasSubscription) {
                            return {
                                lead: lead,
                                subscriptionInfo: subscriptionInfo,
                                match_type: 'ACTIVE_SUBSCRIPTION_PIPELINE',
                                confidence: 'VERY_HIGH'
                            };
                        }
                    }
                }
            }
            
            // ШАГ 2: Ищем сделку с именем ученика в любой воронке
            console.log(`\n🔍 Шаг 2: Поиск по имени ученика во всех сделках`);
            
            for (const lead of allLeads) {
                const leadName = this.normalizeName(lead.name);
                
                if (leadName.includes(normalizedStudentName) || 
                    leadName.includes(studentLastName) ||
                    normalizedStudentName.includes(leadName.split(' ')[0])) {
                    
                    console.log(`✅ Найдена сделка по имени: "${lead.name}"`);
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    
                    if (subscriptionInfo.hasSubscription) {
                        return {
                            lead: lead,
                            subscriptionInfo: subscriptionInfo,
                            match_type: 'NAME_MATCH',
                            confidence: 'HIGH'
                        };
                    }
                }
            }
            
            // ШАГ 3: Ищем любую сделку с данными об абонементе
            console.log(`\n🔍 Шаг 3: Поиск любой сделки с данными об абонементе`);
            
            for (const lead of allLeads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription) {
                    console.log(`✅ Найдена сделка с абонементом: "${lead.name}"`);
                    
                    return {
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        match_type: 'ANY_SUBSCRIPTION',
                        confidence: 'MEDIUM'
                    };
                }
            }
            
            console.log(`❌ Не найдено сделки с абонементом для "${studentName}"`);
            return null;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска сделки:`, error.message);
            return null;
        }
    }
    
    // ==================== ИЗВЛЕЧЕНИЕ ДАННЫХ ОБ АБОНЕМЕНТЕ ====================
    extractSubscriptionInfo(lead) {
        console.log(`\n🔍 Извлечение данных абонемента: "${lead.name}"`);
        
        const customFields = lead.custom_fields_values || [];
        
        // Создаем карту полей для быстрого доступа
        const fieldMap = new Map();
        
        for (const field of customFields) {
            const fieldId = field.field_id || field.id;
            const fieldValue = this.getFieldValue(field);
            fieldMap.set(fieldId, fieldValue);
        }
        
        // Извлекаем данные по ВАШИМ ID полей
        const totalClasses = this.extractNumber(fieldMap.get(this.FIELD_IDS.LEAD.TOTAL_CLASSES));
        const usedClasses = this.extractNumber(fieldMap.get(this.FIELD_IDS.LEAD.USED_CLASSES));
        const remainingClasses = this.extractNumber(fieldMap.get(this.FIELD_IDS.LEAD.REMAINING_CLASSES));
        
        // Если остаток не указан, вычисляем его
        let finalRemainingClasses = remainingClasses;
        if (finalRemainingClasses === 0 && totalClasses > 0 && usedClasses > 0) {
            finalRemainingClasses = totalClasses - usedClasses;
        }
        
        // Получаем другие данные
        const subscriptionType = fieldMap.get(this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE) || 'Без абонемента';
        const activationDate = this.parseDate(fieldMap.get(this.FIELD_IDS.LEAD.ACTIVATION_DATE));
        const expirationDate = this.parseDate(fieldMap.get(this.FIELD_IDS.LEAD.EXPIRATION_DATE));
        const lastVisitDate = this.parseDate(fieldMap.get(this.FIELD_IDS.LEAD.LAST_VISIT_DATE));
        const ageGroup = fieldMap.get(this.FIELD_IDS.LEAD.AGE_GROUP) || '';
        const branch = fieldMap.get(this.FIELD_IDS.LEAD.BRANCH) || '';
        const lessonPrice = this.extractNumber(fieldMap.get(this.FIELD_IDS.LEAD.LESSON_PRICE));
        
        // Определяем статус абонемента
        const hasSubscription = totalClasses > 0 || finalRemainingClasses > 0 || subscriptionType !== 'Без абонемента';
        
        // Проверяем, активна ли сделка
        const isInSubscriptionPipeline = lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID;
        const hasActiveStatus = this.ACTIVE_SUBSCRIPTION_STATUSES.includes(lead.status_id);
        const isSuccessStatus = this.SUCCESS_STATUSES.includes(lead.status_id);
        
        let subscriptionStatus = 'Нет данных';
        let subscriptionBadge = 'inactive';
        let subscriptionActive = false;
        
        if (hasActiveStatus && hasSubscription) {
            subscriptionStatus = 'Активен';
            subscriptionBadge = 'active';
            subscriptionActive = true;
        } else if (isSuccessStatus && hasSubscription) {
            subscriptionStatus = 'Завершен';
            subscriptionBadge = 'success';
        } else if (hasSubscription) {
            subscriptionStatus = 'Есть абонемент';
            subscriptionBadge = 'warning';
        } else {
            subscriptionStatus = 'Нет абонемента';
            subscriptionBadge = 'inactive';
        }
        
        console.log(`📊 Результат:`);
        console.log(`   ✅ Абонемент: ${hasSubscription ? 'Да' : 'Нет'}`);
        console.log(`   📊 Занятий: ${usedClasses}/${totalClasses} (осталось: ${finalRemainingClasses})`);
        console.log(`   🏷️  Тип: ${subscriptionType}`);
        console.log(`   📅 Окончание: ${expirationDate || 'Нет данных'}`);
        console.log(`   🎯 Статус: ${subscriptionStatus}`);
        
        return {
            hasSubscription: hasSubscription,
            subscriptionActive: subscriptionActive,
            subscriptionStatus: subscriptionStatus,
            subscriptionBadge: subscriptionBadge,
            
            subscriptionType: subscriptionType,
            totalClasses: totalClasses,
            usedClasses: usedClasses,
            remainingClasses: finalRemainingClasses,
            
            expirationDate: expirationDate,
            activationDate: activationDate,
            lastVisitDate: lastVisitDate,
            
            lessonPrice: lessonPrice,
            ageGroup: ageGroup,
            branch: branch,
            
            isInSubscriptionPipeline: isInSubscriptionPipeline,
            hasActiveStatus: hasActiveStatus,
            pipelineId: lead.pipeline_id,
            statusId: lead.status_id
        };
    }
    
    // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ====================
    getFieldValue(field) {
        if (!field || !field.values || field.values.length === 0) {
            return null;
        }
        
        return field.values[0].value;
    }
    
    extractNumber(value) {
        if (!value) return 0;
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
            const match = value.match(/\d+/);
            return match ? parseInt(match[0]) : 0;
        }
        return 0;
    }
    
    parseDate(value) {
        if (!value) return null;
        
        try {
            // Если это timestamp
            if (typeof value === 'number') {
                // Если это секунды
                if (value > 1000000000 && value < 100000000000) {
                    const date = new Date(value * 1000);
                    return date.toISOString().split('T')[0];
                }
                // Если это миллисекунды
                if (value > 1000000000000) {
                    const date = new Date(value);
                    return date.toISOString().split('T')[0];
                }
            }
            
            // Если это строка даты
            if (typeof value === 'string') {
                return value.split('T')[0]; // Берем только дату
            }
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error);
        }
        
        return null;
    }
    
    normalizeName(name) {
        if (!name || typeof name !== 'string') return '';
        return name.toLowerCase().trim();
    }
    
    // ==================== ГЛАВНЫЙ МЕТОД: ПОЛУЧЕНИЕ УЧЕНИКОВ ПО ТЕЛЕФОНУ ====================
    async getStudentsByPhone(phoneNumber) {
        console.log(`\n📱 ПОЛУЧЕНИЕ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        console.log('='.repeat(60));
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            // 1. Ищем контакты по телефону
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                console.log('⚠️  Контакты не найдены');
                return studentProfiles;
            }
            
            // 2. Обрабатываем каждый контакт
            for (const contact of contacts) {
                try {
                    console.log(`\n📋 Обработка контакта: "${contact.name}" (ID: ${contact.id})`);
                    
                    // Получаем полную информацию о контакте
                    const fullContact = await this.getFullContactInfo(contact.id);
                    if (!fullContact) {
                        console.log(`⚠️  Не удалось получить контакт ${contact.id}`);
                        continue;
                    }
                    
                    // Извлекаем учеников из контакта
                    const children = this.extractStudentsFromContact(fullContact);
                    console.log(`👥 Учеников в контакте: ${children.length}`);
                    
                    if (children.length === 0) {
                        console.log('⚠️  У контакта нет учеников в полях');
                        
                        // Если нет учеников в полях, ищем в сделках контакта
                        const allLeads = await this.getContactLeads(contact.id);
                        
                        for (const lead of allLeads) {
                            const subscriptionInfo = this.extractSubscriptionInfo(lead);
                            
                            if (subscriptionInfo.hasSubscription) {
                                // Извлекаем имя из названия сделки
                                const studentNameFromLead = this.extractStudentNameFromLead(lead.name);
                                
                                if (studentNameFromLead) {
                                    const studentInfo = {
                                        studentName: studentNameFromLead,
                                        branch: subscriptionInfo.branch || '',
                                        teacherName: '',
                                        ageGroup: subscriptionInfo.ageGroup || '',
                                        dayOfWeek: '',
                                        lastVisitDate: subscriptionInfo.lastVisitDate || '',
                                        hasActiveSub: subscriptionInfo.subscriptionActive
                                    };
                                    
                                    const profile = this.createStudentProfile(
                                        fullContact,
                                        phoneNumber,
                                        studentInfo,
                                        subscriptionInfo,
                                        lead
                                    );
                                    
                                    studentProfiles.push(profile);
                                }
                            }
                        }
                        
                        continue;
                    }
                    
                    // 3. Для каждого ученика ищем сделку с абонементом
                    for (const child of children) {
                        console.log(`\n🎯 Поиск для ученика: "${child.studentName}"`);
                        
                        const leadResult = await this.findSubscriptionLeadForStudent(contact.id, child.studentName);
                        
                        if (leadResult) {
                            console.log(`✅ Найдена сделка: "${leadResult.lead.name}"`);
                            
                            const profile = this.createStudentProfile(
                                fullContact,
                                phoneNumber,
                                child,
                                leadResult.subscriptionInfo,
                                leadResult.lead
                            );
                            
                            studentProfiles.push(profile);
                        } else {
                            console.log(`⚠️  Сделка не найдена, создаем профиль без абонемента`);
                            
                            const profile = this.createStudentProfile(
                                fullContact,
                                phoneNumber,
                                child,
                                this.getDefaultSubscriptionInfo(),
                                null
                            );
                            
                            studentProfiles.push(profile);
                        }
                    }
                    
                } catch (contactError) {
                    console.error(`❌ Ошибка обработки контакта:`, contactError.message);
                }
            }
            
            // Убираем дубликаты
            const uniqueProfiles = [];
            const seenKeys = new Set();
            
            for (const profile of studentProfiles) {
                const key = `${profile.student_name}_${profile.phone_number}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    uniqueProfiles.push(profile);
                }
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${uniqueProfiles.length}`);
            
            return uniqueProfiles;
            
        } catch (error) {
            console.error('❌ Критическая ошибка поиска учеников:', error.message);
            return studentProfiles;
        }
    }
    
    // Извлечение имени ученика из названия сделки
    extractStudentNameFromLead(leadName) {
        try {
            // Убираем часть про занятия
            const name = leadName.split('-')[0]?.trim() || 
                        leadName.split('—')[0]?.trim() ||
                        leadName;
            
            // Убираем "Сделка #"
            const cleanName = name.replace(/Сделка #\d+/i, '').trim();
            
            return cleanName || 'Ученик';
        } catch (error) {
            return 'Ученик';
        }
    }
    
    // Создание профиля ученика
    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        // Получаем email из контакта
        const emailField = contact.custom_fields_values?.find(f => 
            (f.field_id || f.id) === this.FIELD_IDS.CONTACT.EMAIL
        );
        const email = emailField ? this.getFieldValue(emailField) : '';
        
        // Получаем филиал
        let branch = studentInfo.branch || subscriptionInfo.branch || '';
        
        if (!branch && contact.custom_fields_values) {
            const branchField = contact.custom_fields_values.find(f =>
                (f.field_id || f.id) === this.FIELD_IDS.CONTACT.BRANCH
            );
            
            if (branchField) {
                branch = this.getFieldValue(branchField);
            }
        }
        
        // Если все еще нет филиала, берем из сделки
        if (!branch && lead && lead.custom_fields_values) {
            const leadBranchField = lead.custom_fields_values.find(f => 
                (f.field_id || f.id) === this.FIELD_IDS.LEAD.BRANCH
            );
            
            if (leadBranchField) {
                branch = this.getFieldValue(leadBranchField);
            }
        }
        
        const profile = {
            amocrm_contact_id: contact.id || null,
            parent_contact_id: contact.id || null,
            amocrm_lead_id: lead?.id || null,
            
            student_name: studentInfo.studentName || 'Ученик',
            phone_number: phoneNumber,
            email: email || '',
            birth_date: '',
            branch: branch || 'Филиал не указан',
            parent_name: contact.name || '',
            
            day_of_week: studentInfo.dayOfWeek || '',
            time_slot: '',
            teacher_name: studentInfo.teacherName || '',
            age_group: studentInfo.ageGroup || subscriptionInfo.ageGroup || '',
            course: '',
            allergies: '',
            
            subscription_type: subscriptionInfo.subscriptionType || 'Без абонемента',
            subscription_active: subscriptionInfo.subscriptionActive ? 1 : 0,
            subscription_status: subscriptionInfo.subscriptionStatus || 'Не активен',
            subscription_badge: subscriptionInfo.subscriptionBadge || 'inactive',
            
            total_classes: subscriptionInfo.totalClasses || 0,
            used_classes: subscriptionInfo.usedClasses || 0,
            remaining_classes: subscriptionInfo.remainingClasses || 0,
            
            expiration_date: subscriptionInfo.expirationDate || null,
            activation_date: subscriptionInfo.activationDate || null,
            last_visit_date: studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate || null,
            purchase_date: subscriptionInfo.purchaseDate || null,
            trial_date: subscriptionInfo.trialDate || null,
            
            lesson_price: subscriptionInfo.lessonPrice || 0,
            first_lesson: subscriptionInfo.firstLesson || false,
            
            custom_fields: JSON.stringify(contact.custom_fields_values || []),
            raw_contact_data: JSON.stringify(contact),
            lead_data: lead ? JSON.stringify(lead) : '{}',
            
            is_demo: 0,
            source: 'amocrm',
            is_active: 1,
            last_sync: new Date().toISOString()
        };
        
        console.log(`👤 СОЗДАН ПРОФИЛЬ: ${profile.student_name}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_type}`);
        console.log(`   📊 Занятий: ${profile.used_classes}/${profile.total_classes}`);
        console.log(`   ✅ Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
        
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
            subscriptionType: 'Без абонемента',
            expirationDate: null,
            activationDate: null,
            lastVisitDate: null
        };
    }
}

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        const dbDir = path.join(__dirname, 'data');
        await fs.mkdir(dbDir, { recursive: true });
        
        const dbPath = path.join(dbDir, 'art_school_real.db');
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        
        // Создаем таблицы
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amocrm_contact_id INTEGER,
                parent_contact_id INTEGER,
                amocrm_lead_id INTEGER,
                
                student_name TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                email TEXT,
                birth_date TEXT,
                branch TEXT,
                
                day_of_week TEXT,
                time_slot TEXT,
                teacher_name TEXT,
                age_group TEXT,
                course TEXT,
                allergies TEXT,
                
                parent_name TEXT,
                
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
                
                custom_fields TEXT,
                raw_contact_data TEXT,
                lead_data TEXT,
                is_demo INTEGER DEFAULT 0,
                source TEXT DEFAULT 'amocrm',
                is_active INTEGER DEFAULT 1,
                last_sync TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_name ON student_profiles(student_name)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(is_active)');
        
        console.log('✅ Таблицы созданы');
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        throw error;
    }
};

// ==================== СОХРАНЕНИЕ ПРОФИЛЕЙ В БД ====================
async function saveProfilesToDatabase(profiles) {
    try {
        console.log(`💾 Сохранение профилей в БД...`);
        let savedCount = 0;
        
        for (const profile of profiles) {
            try {
                const existingProfile = await db.get(
                    `SELECT id FROM student_profiles 
                     WHERE student_name = ? AND phone_number = ?`,
                    [profile.student_name, profile.phone_number]
                );
                
                if (!existingProfile) {
                    const result = await db.run(
                        `INSERT INTO student_profiles (
                            amocrm_contact_id, parent_contact_id, amocrm_lead_id,
                            student_name, phone_number, email, birth_date, branch,
                            day_of_week, time_slot, teacher_name, age_group, course, allergies,
                            parent_name, subscription_type, subscription_active, subscription_status,
                            subscription_badge, total_classes, used_classes, remaining_classes,
                            expiration_date, activation_date, last_visit_date,
                            custom_fields, raw_contact_data, lead_data, is_demo, source, is_active, last_sync
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            profile.amocrm_contact_id, profile.parent_contact_id, profile.amocrm_lead_id,
                            profile.student_name, profile.phone_number, profile.email, profile.birth_date, profile.branch,
                            profile.day_of_week, profile.time_slot, profile.teacher_name, profile.age_group, profile.course, profile.allergies,
                            profile.parent_name, profile.subscription_type, profile.subscription_active, profile.subscription_status,
                            profile.subscription_badge, profile.total_classes, profile.used_classes, profile.remaining_classes,
                            profile.expiration_date, profile.activation_date, profile.last_visit_date,
                            profile.custom_fields, profile.raw_contact_data, profile.lead_data,
                            profile.is_demo, profile.source, 1, new Date().toISOString()
                        ]
                    );
                    
                    savedCount++;
                    console.log(`✅ Профиль создан: ${profile.student_name}`);
                } else {
                    await db.run(
                        `UPDATE student_profiles SET
                            amocrm_contact_id = ?, amocrm_lead_id = ?,
                            subscription_type = ?, subscription_active = ?, subscription_status = ?,
                            subscription_badge = ?, total_classes = ?, used_classes = ?, remaining_classes = ?,
                            expiration_date = ?, activation_date = ?, last_visit_date = ?,
                            custom_fields = ?, raw_contact_data = ?, lead_data = ?,
                            is_active = ?, last_sync = ?, updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        [
                            profile.amocrm_contact_id, profile.amocrm_lead_id,
                            profile.subscription_type, profile.subscription_active, profile.subscription_status,
                            profile.subscription_badge, profile.total_classes, profile.used_classes, profile.remaining_classes,
                            profile.expiration_date, profile.activation_date, profile.last_visit_date,
                            profile.custom_fields, profile.raw_contact_data, profile.lead_data,
                            1, new Date().toISOString(), existingProfile.id
                        ]
                    );
                    
                    savedCount++;
                    console.log(`✅ Профиль обновлен: ${profile.student_name}`);
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка сохранения профиля ${profile.student_name}:`, profileError.message);
            }
        }
        
        console.log(`✅ Всего сохранено/обновлено: ${savedCount} профилей`);
        return savedCount;
    } catch (error) {
        console.error(`❌ Общая ошибка сохранения профилей: ${error.message}`);
        return 0;
    }
}

// ==================== ГЛАВНЫЙ API ДЛЯ ПРИЛОЖЕНИЯ ====================
app.post('/api/auth/real-data', async (req, res) => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🔐 АВТОРИЗАЦИЯ ПО РЕАЛЬНЫМ ДАННЫМ');
        console.log('='.repeat(80));
        
        const { phone, student_name } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        // Форматируем телефон
        const formatPhoneNumber = (phone) => {
            const cleanPhone = phone.replace(/\D/g, '');
            
            if (cleanPhone.length === 10) {
                return '+7' + cleanPhone;
            } else if (cleanPhone.length === 11) {
                if (cleanPhone.startsWith('8')) {
                    return '+7' + cleanPhone.slice(1);
                } else if (cleanPhone.startsWith('7')) {
                    return '+' + cleanPhone;
                }
            }
            
            return '+' + cleanPhone.slice(-11);
        };
        
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`📱 Телефон: ${formattedPhone}`);
        console.log(`👤 Ученик: ${student_name || 'Не указан'}`);
        
        // Проверяем подключение к amoCRM
        if (!amoCrmService.isInitialized) {
            console.log('❌ amoCRM не подключен');
            return res.status(503).json({
                success: false,
                error: 'Система временно недоступна'
            });
        }
        
        // Получаем данные из amoCRM
        console.log('🔍 Поиск реальных данных в amoCRM...');
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        if (profiles.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Ученики не найдены',
                message: 'По указанному телефону не найдено учеников в системе.',
                phone: formattedPhone,
                profiles: []
            });
        }
        
        // Сохраняем в БД
        const savedCount = await saveProfilesToDatabase(profiles);
        console.log(`💾 Сохранено в БД: ${savedCount} профилей`);
        
        // Создаем токен
        const sessionId = crypto.randomBytes(32).toString('hex');
        const token = jwt.sign(
            {
                session_id: sessionId,
                phone: formattedPhone,
                profiles_count: profiles.length,
                timestamp: Date.now()
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        // Сохраняем сессию
        await db.run(
            `INSERT INTO user_sessions (session_id, session_data, phone_number, expires_at) 
             VALUES (?, ?, ?, ?)`,
            [
                sessionId,
                JSON.stringify({ 
                    phone: formattedPhone,
                    profiles_count: profiles.length 
                }),
                formattedPhone,
                new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            ]
        );
        
        // Форматируем ответ для приложения
        const responseProfiles = profiles.map(p => ({
            id: p.id || null,
            student_name: p.student_name,
            phone_number: p.phone_number,
            email: p.email,
            branch: p.branch || 'Филиал не указан',
            teacher_name: p.teacher_name,
            age_group: p.age_group,
            subscription_type: p.subscription_type,
            subscription_active: p.subscription_active === 1,
            subscription_status: p.subscription_status,
            subscription_badge: p.subscription_badge,
            total_classes: p.total_classes,
            remaining_classes: p.remaining_classes,
            used_classes: p.used_classes,
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            parent_name: p.parent_name,
            is_demo: p.is_demo === 1,
            source: p.source,
            last_sync: p.last_sync
        }));
        
        console.log('\n' + '='.repeat(80));
        console.log('✅ РЕАЛЬНЫЕ ДАННЫЕ НАЙДЕНЫ');
        console.log('='.repeat(80));
        console.log(`📱 Телефон: ${formattedPhone}`);
        console.log(`👥 Учеников: ${responseProfiles.length}`);
        console.log(`✅ Данные из: amoCRM (настоящие, не тестовые)`);
        
        responseProfiles.forEach((profile, index) => {
            console.log(`\n${index + 1}. ${profile.student_name}`);
            console.log(`   🎫 Абонемент: ${profile.subscription_type}`);
            console.log(`   📊 Занятий: ${profile.used_classes}/${profile.total_classes}`);
            console.log(`   ✅ Активен: ${profile.subscription_active ? 'Да' : 'Нет'}`);
        });
        
        res.json({
            success: true,
            message: 'Реальные данные найдены',
            data: {
                user: {
                    phone_number: formattedPhone,
                    name: responseProfiles.length > 0 ? 
                        responseProfiles[0].parent_name || responseProfiles[0].student_name : 'Гость',
                    is_temp: true,
                    profiles_count: responseProfiles.length
                },
                profiles: responseProfiles,
                total_profiles: responseProfiles.length,
                amocrm_connected: true,
                has_real_data: true,
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
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==================== ПРОВЕРОЧНЫЕ МАРШРУТЫ ====================
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер художественной студии работает',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        data_source: 'Реальные данные из amoCRM',
        guarantee: '100% реальные данные, никаких тестовых'
    });
});

app.get('/api/debug/check-lead/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ПРОВЕРКА СДЕЛКИ ID: ${leadId}`);
        
        const lead = await amoCrmService.makeRequest('GET', 
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.json({ success: false, error: 'Сделка не найдена' });
        }
        
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        res.json({
            success: true,
            data: {
                lead: {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id
                },
                subscription_info: subscriptionInfo,
                is_active_subscription: amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.includes(lead.status_id),
                is_subscription_pipeline: lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const amoCrmService = new AmoCrmService();

const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('📊 ИСПОЛЬЗУЮ ВАШИ РЕАЛЬНЫЕ ДАННЫХ ИЗ AMOCRM');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM подключен успешно!');
            console.log('🎯 Использую ВАШИ реальные данные:');
            console.log(`   • Воронка абонементов: ${amoCrmService.SUBSCRIPTION_PIPELINE_ID}`);
            console.log(`   • Активные статусы: ${amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.join(', ')}`);
            console.log(`   • Всего полей: ${Object.keys(amoCrmService.FIELD_IDS.LEAD).length + Object.keys(amoCrmService.FIELD_IDS.CONTACT).length}`);
        } else {
            console.log('❌ Не удалось подключиться к amoCRM');
            console.log('ℹ️  Проверьте переменные окружения:');
            console.log('   • AMOCRM_ACCESS_TOKEN');
            console.log('   • AMOCRM_DOMAIN');
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 URL: http://localhost:${PORT}`);
            console.log(`🔗 Главный маршрут: POST /api/auth/real-data`);
            console.log(`📊 Статус: GET /api/status`);
            console.log(`🔍 Проверка: GET /api/debug/check-lead/:leadId`);
            console.log('='.repeat(80));
            console.log('\n📱 ДЛЯ ПРИЛОЖЕНИЯ:');
            console.log('Отправьте POST запрос на /api/auth/real-data с телом:');
            console.log('{');
            console.log('  "phone": "79660587744",');
            console.log('  "student_name": "Полина Кунахович"');
            console.log('}');
            console.log('='.repeat(80));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

startServer();
