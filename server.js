// server-fixed.js - ПЕРЕПИСАННЫЙ СЕРВЕР С ТОЧНЫМ ПОИСКОМ СДЕЛОК

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
const JWT_SECRET = process.env.JWT_SECRET || 'art-school-jwt-secret-2024';
const AMOCRM_ACCESS_TOKEN = process.env.AMOCRM_ACCESS_TOKEN;
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN;
const AMOCRM_SUBDOMAIN = AMOCRM_DOMAIN ? AMOCRM_DOMAIN.replace('.amocrm.ru', '') : '';

// ==================== НАСТРОЙКА EXPRESS ====================
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
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService v5.0');
        console.log('🎯 ТОЧНЫЙ ПОИСК СДЕЛОК ПО ИМЕНИ УЧЕНИКА');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        
        // РЕАЛЬНЫЕ ID ПОЛЕЙ ИЗ ДИАГНОСТИКИ
        this.FIELD_IDS = {
            LEAD: {
                TOTAL_CLASSES: 850241,     // "Абонемент занятий:" 
                USED_CLASSES: 850257,      // "Счетчик занятий:"
                REMAINING_CLASSES: 890163, // "Остаток занятий"
                EXPIRATION_DATE: 850255,   // "Окончание абонемента:"
                ACTIVATION_DATE: 851565,   // "Дата активации абонемента:"
                LAST_VISIT_DATE: 850259,   // "Дата последнего визита:"
                SUBSCRIPTION_TYPE: 891007, // "Тип абонемента"
                AGE_GROUP: 850243,         // "Группа возраст:"
                TECHNICAL_COUNT: 891819,   // "Количество занятий (тех)"
                PURCHASE_DATE: 850253,     // "Дата покупки:"
                LESSON_PRICE: 891813,      // "Стоимость 1 занятия"
                FIRST_LESSON: 884899       // "1 занятие"
            },
            
            CONTACT: {
                CHILD_1_NAME: 867233,      // "!ФИО ребенка:"
                CHILD_2_NAME: 867235,      // Поле для второго ребенка
                CHILD_3_NAME: 867733,      // Поле для третьего ребенка
                BRANCH: 871273,            // "Филиал:"
                TEACHER: 888881,           // "Преподаватель"
                DAY_OF_WEEK: 892225,       // День недели
                HAS_ACTIVE_SUB: 890179,    // "Есть активный абонемент"
                LAST_VISIT: 885380,        // "Дата последнего визита"
                AGE_GROUP: 888903,         // "Возраст группы"
                PHONE: 216615,             // "Телефон"
            }
        };

        // СТАТУСЫ СДЕЛОК (активные)
        this.SUBSCRIPTION_STATUSES = {
            ACTIVE_IN_PIPELINE: [65473306, 142, 143]
        };

        // ВОРОНКА АБОНЕМЕНТОВ
        this.SUBSCRIPTION_PIPELINE_ID = 7977402;
    }
    
    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    async initialize() {
        try {
            console.log('🔄 Инициализация amoCRM...');
            
            if (!AMOCRM_ACCESS_TOKEN) {
                console.error('❌ AMOCRM_ACCESS_TOKEN не установлен');
                return false;
            }
            
            if (!AMOCRM_SUBDOMAIN) {
                console.error('❌ AMOCRM_DOMAIN не установлен');
                return false;
            }
            
            console.log(`🔗 Проверка соединения с ${this.baseUrl}...`);
            
            const accountInfo = await this.makeRequest('GET', '/api/v4/account');
            
            if (accountInfo && accountInfo.name) {
                this.isInitialized = true;
                console.log('✅ amoCRM инициализирован успешно!');
                console.log(`📊 Аккаунт: ${accountInfo.name}`);
                return true;
            } else {
                console.error('❌ Не удалось получить информацию об аккаунте');
                return false;
            }
            
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
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
            console.error(`❌ Ошибка запроса к amoCRM ${method} ${endpoint}:`, error.message);
            throw error;
        }
    }

    // ==================== ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ ====================
    async searchContactsByPhone(phone) {
        try {
            const cleanPhone = phone.replace(/\D/g, '');
            const last10Digits = cleanPhone.slice(-10);
            
            console.log(`🔍 Поиск контактов по телефону: ${last10Digits}`);
            
            // Ищем контакты через query
            const queryResponse = await this.makeRequest('GET', 
                `/api/v4/contacts?query=${last10Digits}&with=custom_fields_values&limit=100`
            );
            
            const contacts = queryResponse._embedded?.contacts || [];
            console.log(`✅ Найдено контактов по query: ${contacts.length}`);
            
            // Фильтруем только те контакты, у которых действительно есть этот телефон
            const filteredContacts = contacts.filter(contact => 
                this.contactHasPhone(contact, last10Digits)
            );
            
            console.log(`✅ После фильтрации по телефону: ${filteredContacts.length} контактов`);
            
            return {
                _embedded: {
                    contacts: filteredContacts
                }
            };
            
        } catch (error) {
            console.error('❌ Ошибка поиска контактов:', error.message);
            return { _embedded: { contacts: [] } };
        }
    }
    
    contactHasPhone(contact, phoneDigits) {
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
        
        for (const phoneField of phoneFields) {
            if (phoneField.values && Array.isArray(phoneField.values)) {
                for (const value of phoneField.values) {
                    const contactPhone = String(value.value || '').replace(/\D/g, '');
                    if (contactPhone.includes(phoneDigits) || phoneDigits.includes(contactPhone.slice(-10))) {
                        return true;
                    }
                }
            }
        }
        
        return false;
    }

    // ==================== ПОИСК ВСЕХ СДЕЛОК КОНТАКТА ====================
    async getAllContactLeads(contactId) {
        try {
            console.log(`🔍 Получение всех сделок контакта ID: ${contactId}`);
            
            // Метод 1: Через фильтр по contact_id
            try {
                const response = await this.makeRequest('GET', 
                    `/api/v4/leads?filter[contact_id][]=${contactId}&with=custom_fields_values&limit=250`
                );
                
                if (response && response._embedded && response._embedded.leads) {
                    console.log(`✅ Найдено сделок: ${response._embedded.leads.length}`);
                    return response._embedded.leads;
                }
            } catch (error1) {
                console.log(`⚠️  Метод 1 не сработал: ${error1.message}`);
            }
            
            // Метод 2: Через связанные сущности
            try {
                const response = await this.makeRequest('GET', 
                    `/api/v4/leads?with=contacts&limit=100`
                );
                
                if (response && response._embedded && response._embedded.leads) {
                    const filteredLeads = response._embedded.leads.filter(lead => {
                        return lead._embedded && 
                               lead._embedded.contacts &&
                               lead._embedded.contacts.some(contact => contact.id === contactId);
                    });
                    
                    console.log(`✅ Найдено сделок через связанные сущности: ${filteredLeads.length}`);
                    
                    const fullLeads = [];
                    for (const lead of filteredLeads) {
                        const fullLead = await this.makeRequest('GET', 
                            `/api/v4/leads/${lead.id}?with=custom_fields_values`
                        );
                        if (fullLead) fullLeads.push(fullLead);
                    }
                    
                    return fullLeads;
                }
            } catch (error2) {
                console.log(`⚠️  Метод 2 не сработал: ${error2.message}`);
            }
            
            console.log('❌ Все методы не сработали');
            return [];
            
        } catch (error) {
            console.error('❌ Ошибка получения сделок контакта:', error.message);
            return [];
        }
    }

    // ==================== ПОИСК СДЕЛКИ ДЛЯ УЧЕНИКА ====================
    async findLeadForStudent(contactId, studentName) {
        console.log(`\n🔍 ПОИСК СДЕЛКИ ДЛЯ УЧЕНИКА: "${studentName}"`);
        console.log('='.repeat(60));
        
        try {
            // Получаем все сделки контакта
            const allLeads = await this.getAllContactLeads(contactId);
            
            if (allLeads.length === 0) {
                console.log('❌ У контакта нет сделок');
                return null;
            }
            
            console.log(`📊 Всего сделок: ${allLeads.length}`);
            
            // Нормализуем имя ученика
            const normalizedStudentName = this.normalizeName(studentName);
            console.log(`🔍 Ищем сделку для: "${normalizedStudentName}"`);
            
            // 1. Ищем САМОЕ ТОЧНОЕ совпадение по имени
            let bestMatch = null;
            let bestScore = 0;
            
            for (const lead of allLeads) {
                if (!lead.name) continue;
                
                const leadName = this.normalizeName(lead.name);
                const score = this.calculateNameMatchScore(leadName, normalizedStudentName);
                
                console.log(`   🔎 Сделка "${lead.name}" - ${score} баллов`);
                
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = lead;
                }
            }
            
            // 2. Если нашли хорошее совпадение (больше 60 баллов), берем эту сделку
            if (bestMatch && bestScore > 60) {
                console.log(`✅ Найдена сделка: "${bestMatch.name}" (${bestScore} баллов)`);
                const subscriptionInfo = this.extractSubscriptionInfo(bestMatch);
                
                return {
                    lead: bestMatch,
                    subscriptionInfo: subscriptionInfo,
                    match_score: bestScore,
                    match_type: 'EXACT_NAME_MATCH'
                };
            }
            
            // 3. Если нет точных совпадений, ищем в воронке абонементов
            console.log(`\n⚠️  Нет точных совпадений, ищем в воронке абонементов...`);
            
            for (const lead of allLeads) {
                // Проверяем, что сделка в правильной воронке
                if (lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID) {
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    
                    // Проверяем, что в сделке есть абонемент
                    if (subscriptionInfo.hasSubscription) {
                        console.log(`   ✅ Найдена сделка в воронке абонементов: "${lead.name}"`);
                        return {
                            lead: lead,
                            subscriptionInfo: subscriptionInfo,
                            match_score: 50,
                            match_type: 'PIPELINE_MATCH'
                        };
                    }
                }
            }
            
            // 4. Если не нашли в воронке, ищем любую сделку с абонементом
            console.log(`\n⚠️  Не нашли в воронке, ищем любую сделку с абонементом...`);
            
            for (const lead of allLeads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription) {
                    console.log(`   ⚠️  Найдена сделка с абонементом: "${lead.name}"`);
                    
                    return {
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        match_score: 30,
                        match_type: 'SUBSCRIPTION_MATCH'
                    };
                }
            }
            
            console.log(`\n❌ Не нашли подходящей сделки для ученика "${studentName}"`);
            return null;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска сделки:`, error.message);
            return null;
        }
    }
    
    // ==================== РАСЧЕТ СОВПАДЕНИЯ ИМЕН ====================
    calculateNameMatchScore(leadName, studentName) {
        let score = 0;
        
        // Разбиваем имена на части
        const studentParts = studentName.split(' ').filter(p => p.length > 1);
        const leadParts = leadName.split(' ').filter(p => p.length > 1);
        
        // 1. Проверяем полное совпадение имени
        if (leadName.includes(studentName)) {
            score += 100;
        }
        
        // 2. Проверяем совпадение фамилии (последняя часть)
        if (studentParts.length > 0) {
            const studentLastName = studentParts[studentParts.length - 1];
            
            if (leadName.includes(studentLastName)) {
                score += 50;
            }
        }
        
        // 3. Проверяем совпадение имени (первая часть)
        if (studentParts.length > 0) {
            const studentFirstName = studentParts[0];
            
            if (leadName.includes(studentFirstName)) {
                score += 30;
            }
        }
        
        // 4. Проверяем каждую часть имени
        for (const studentPart of studentParts) {
            for (const leadPart of leadParts) {
                if (leadPart.includes(studentPart) || studentPart.includes(leadPart)) {
                    score += 20;
                }
            }
        }
        
        return score;
    }
    
    normalizeName(name) {
        if (!name) return '';
        return name.toLowerCase().trim();
    }

    // ==================== ИЗВЛЕЧЕНИЕ ИНФОРМАЦИИ О СДЕЛКЕ ====================
    extractSubscriptionInfo(lead) {
        console.log(`\n🔍 ИЗВЛЕЧЕНИЕ ДАННЫХ АБОНЕМЕНТА`);
        console.log(`📋 Сделка: "${lead.name}"`);
        
        const customFields = lead.custom_fields_values || [];
        
        const getFieldValue = (fieldId) => {
            const field = customFields.find(f => (f.field_id || f.id) === fieldId);
            if (!field || !field.values || field.values.length === 0) {
                return null;
            }
            
            const rawValue = field.values[0].value;
            
            // Обработка timestamp (дата в секундах)
            if (typeof rawValue === 'number' && rawValue > 1000000000) {
                const date = new Date(rawValue * 1000);
                return date.toISOString().split('T')[0]; // YYYY-MM-DD
            }
            
            // Обработка строки с числом ("4 занятия" -> 4)
            if (typeof rawValue === 'string') {
                const match = rawValue.match(/(\d+)/);
                return match ? parseInt(match[1]) : rawValue;
            }
            
            return rawValue;
        };
        
        // Получаем значения полей
        const totalClasses = parseInt(getFieldValue(this.FIELD_IDS.LEAD.TOTAL_CLASSES) || 0);
        const usedClasses = parseInt(getFieldValue(this.FIELD_IDS.LEAD.USED_CLASSES) || 0);
        const remainingClasses = parseInt(getFieldValue(this.FIELD_IDS.LEAD.REMAINING_CLASSES) || 0);
        const technicalCount = parseInt(getFieldValue(this.FIELD_IDS.LEAD.TECHNICAL_COUNT) || 0);
        
        // Используем техническое количество, если основное поле пустое
        const finalTotalClasses = totalClasses > 0 ? totalClasses : technicalCount;
        
        const hasSubscription = finalTotalClasses > 0 || remainingClasses > 0;
        
        // Проверяем активность сделки
        const isInSubscriptionPipeline = lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID;
        const hasActiveStatus = this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(lead.status_id);
        
        let subscriptionStatus = 'Нет данных';
        let subscriptionBadge = 'inactive';
        
        if (hasActiveStatus) {
            subscriptionStatus = 'Активен';
            subscriptionBadge = 'active';
        } else if (isInSubscriptionPipeline) {
            subscriptionStatus = 'В воронке абонементов';
            subscriptionBadge = 'warning';
        } else {
            subscriptionStatus = 'Не активен';
        }
        
        const result = {
            hasSubscription: hasSubscription,
            subscriptionActive: subscriptionBadge === 'active',
            subscriptionStatus: subscriptionStatus,
            subscriptionBadge: subscriptionBadge,
            totalClasses: finalTotalClasses,
            usedClasses: usedClasses,
            remainingClasses: remainingClasses > 0 ? remainingClasses : (finalTotalClasses - usedClasses),
            subscriptionType: getFieldValue(this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE) || 'Без абонемента',
            expirationDate: getFieldValue(this.FIELD_IDS.LEAD.EXPIRATION_DATE),
            activationDate: getFieldValue(this.FIELD_IDS.LEAD.ACTIVATION_DATE),
            lastVisitDate: getFieldValue(this.FIELD_IDS.LEAD.LAST_VISIT_DATE),
            purchaseDate: getFieldValue(this.FIELD_IDS.LEAD.PURCHASE_DATE),
            lessonPrice: getFieldValue(this.FIELD_IDS.LEAD.LESSON_PRICE),
            ageGroup: getFieldValue(this.FIELD_IDS.LEAD.AGE_GROUP),
            firstLesson: getFieldValue(this.FIELD_IDS.LEAD.FIRST_LESSON),
            isInSubscriptionPipeline: isInSubscriptionPipeline,
            hasActiveStatus: hasActiveStatus
        };
        
        console.log(`📊 РЕЗУЛЬТАТ:`);
        console.log(`   ✅ Абонемент: ${hasSubscription ? 'Да' : 'Нет'}`);
        console.log(`   📊 Занятий: ${usedClasses}/${finalTotalClasses} (осталось: ${result.remainingClasses})`);
        console.log(`   🎯 Статус: ${subscriptionStatus}`);
        console.log(`   🏷️  Тип: ${result.subscriptionType}`);
        
        return result;
    }

    // ==================== ИЗВЛЕЧЕНИЕ УЧЕНИКОВ ИЗ КОНТАКТА ====================
    extractStudentsFromContact(contact) {
        console.log(`\n👨‍👩‍👧‍👦 ИЗВЛЕЧЕНИЕ УЧЕНИКОВ ИЗ КОНТАКТА: "${contact.name}"`);
        
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
        
        console.log(`✅ Извлечено учеников: ${students.length}`);
        
        return students;
    }

    // ==================== ПОЛУЧЕНИЕ УЧЕНИКОВ ПО ТЕЛЕФОНУ ====================
    async getStudentsByPhone(phoneNumber) {
        console.log(`\n📱 ПОЛУЧЕНИЕ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            // 1. Ищем контакты
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                return studentProfiles;
            }
            
            // 2. Обрабатываем первый контакт (самый релевантный)
            const contact = contacts[0];
            
            // Получаем полную информацию о контакте
            const contactResponse = await this.makeRequest('GET', 
                `/api/v4/contacts/${contact.id}?with=custom_fields_values`
            );
            
            if (!contactResponse) {
                return studentProfiles;
            }
            
            console.log(`📋 Контакт: "${contactResponse.name}"`);
            
            // Извлекаем учеников из контакта
            const children = this.extractStudentsFromContact(contactResponse);
            
            if (children.length === 0) {
                console.log('⚠️  У контакта нет учеников в полях');
                return studentProfiles;
            }
            
            // 3. Для КАЖДОГО ученика ищем ЕГО сделку
            for (const child of children) {
                console.log(`\n🎯 Поиск сделки для ученика: "${child.studentName}"`);
                
                const leadResult = await this.findLeadForStudent(contact.id, child.studentName);
                
                // Получаем телефон контакта
                const phoneField = contactResponse.custom_fields_values?.find(f => 
                    (f.field_id || f.id) === this.FIELD_IDS.CONTACT.PHONE
                );
                const phone = phoneField ? this.getFieldValue(phoneField) : phoneNumber;
                
                if (leadResult) {
                    console.log(`✅ Найдена сделка: "${leadResult.lead.name}"`);
                    
                    // Создаем профиль
                    const profile = this.createStudentProfile(
                        contactResponse,
                        phone,
                        child,
                        leadResult.subscriptionInfo,
                        leadResult.lead
                    );
                    
                    studentProfiles.push(profile);
                } else {
                    console.log(`⚠️  Не найдено сделки, создаем профиль без абонемента`);
                    
                    // Создаем профиль без абонемента
                    const profile = this.createStudentProfile(
                        contactResponse,
                        phone,
                        child,
                        this.getDefaultSubscriptionInfo(),
                        null
                    );
                    
                    studentProfiles.push(profile);
                }
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${studentProfiles.length}`);
            
            return studentProfiles;
            
        } catch (error) {
            console.error('❌ Ошибка поиска учеников:', error.message);
            return studentProfiles;
        }
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
    
    getFieldValue(field) {
        if (!field) return null;
        
        if (field.values && field.values.length > 0) {
            return field.values[0].value;
        }
        
        return null;
    }
    
    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        const formatTimestamp = (timestamp) => {
            if (!timestamp) return '';
            
            if (timestamp > 1000000000 && timestamp < 100000000000) {
                const date = new Date(timestamp * 1000);
                return date.toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                });
            }
            
            if (typeof timestamp === 'string') {
                return timestamp;
            }
            
            return '';
        };
        
        // Получаем филиал
        let branch = studentInfo.branch || '';
        
        if (!branch && lead) {
            const customFields = lead.custom_fields_values || [];
            const branchField = customFields.find(f => 
                (f.field_id || f.id) === 871273 // ID поля филиал
            );
            
            if (branchField) {
                branch = this.getFieldValue(branchField);
            }
        }
        
        const profile = {
            amocrm_contact_id: contact.id || null,
            parent_contact_id: contact.id || null,
            amocrm_lead_id: lead?.id || null,
            
            student_name: studentInfo.studentName || 'Ученик',
            phone_number: phoneNumber,
            email: '',
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
            subscription_status: subscriptionInfo.subscriptionStatus || 'Нет абонемента',
            subscription_badge: subscriptionInfo.subscriptionBadge || 'inactive',
            
            total_classes: subscriptionInfo.totalClasses || 0,
            used_classes: subscriptionInfo.usedClasses || 0,
            remaining_classes: subscriptionInfo.remainingClasses || 0,
            
            expiration_date: subscriptionInfo.expirationDate || null,
            activation_date: subscriptionInfo.activationDate || null,
            last_visit_date: studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate || null,
            purchase_date: subscriptionInfo.purchaseDate || null,
            
            expiration_date_display: formatTimestamp(subscriptionInfo.expirationDate),
            activation_date_display: formatTimestamp(subscriptionInfo.activationDate),
            last_visit_date_display: formatTimestamp(studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate),
            purchase_date_display: formatTimestamp(subscriptionInfo.purchaseDate),
            
            lesson_price: subscriptionInfo.lessonPrice || 0,
            first_lesson: subscriptionInfo.firstLesson || false,
            
            is_demo: 0,
            source: 'amocrm',
            is_active: 1,
            last_sync: new Date().toISOString(),
        };
        
        console.log(`\n👤 СОЗДАН ПРОФИЛЬ УЧЕНИКА:`);
        console.log(`   👦 Имя: ${profile.student_name}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_type}`);
        console.log(`   📊 Занятий: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        console.log(`   ✅ Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
        
        return profile;
    }
}

// ==================== ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('\n🔄 ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ');
        
        try {
            const dbDir = path.join(__dirname, 'data');
            await fs.mkdir(dbDir, { recursive: true });
            
            const dbPath = path.join(dbDir, 'art_school.db');
            console.log(`💾 Путь к базе данных: ${dbPath}`);
            
            db = await open({
                filename: dbPath,
                driver: sqlite3.Database
            });

            console.log('✅ База данных SQLite подключена');
            
        } catch (fileError) {
            console.log('⚠️  Ошибка файловой системы, используем память:', fileError.message);
            
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            console.log('⚠️  ВНИМАНИЕ: БД создана в памяти');
        }
        
        await db.run('PRAGMA foreign_keys = ON');
        
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
        
        console.log('✅ База данных успешно инициализирована!');
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        throw error;
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function formatPhoneNumber(phone) {
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
    
    return '+7' + cleanPhone.slice(-10);
}

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
                    await db.run(
                        `INSERT INTO student_profiles (
                            amocrm_contact_id, parent_contact_id, amocrm_lead_id,
                            student_name, phone_number, email, birth_date, branch,
                            day_of_week, time_slot, teacher_name, age_group, course, allergies,
                            parent_name, subscription_type, subscription_active, subscription_status,
                            subscription_badge, total_classes, used_classes, remaining_classes,
                            expiration_date, activation_date, last_visit_date,
                            is_demo, source, is_active, last_sync
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            profile.amocrm_contact_id, profile.parent_contact_id, profile.amocrm_lead_id,
                            profile.student_name, profile.phone_number, profile.email, profile.birth_date, profile.branch,
                            profile.day_of_week, profile.time_slot, profile.teacher_name, profile.age_group, profile.course, profile.allergies,
                            profile.parent_name, profile.subscription_type, profile.subscription_active, profile.subscription_status,
                            profile.subscription_badge, profile.total_classes, profile.used_classes, profile.remaining_classes,
                            profile.expiration_date, profile.activation_date, profile.last_visit_date,
                            profile.is_demo, profile.source, 1, new Date().toISOString()
                        ]
                    );
                    
                    savedCount++;
                } else {
                    await db.run(
                        `UPDATE student_profiles SET
                            amocrm_contact_id = ?, amocrm_lead_id = ?,
                            subscription_type = ?, subscription_active = ?, subscription_status = ?,
                            subscription_badge = ?, total_classes = ?, used_classes = ?, remaining_classes = ?,
                            expiration_date = ?, activation_date = ?, last_visit_date = ?,
                            is_active = ?, last_sync = ?, updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        [
                            profile.amocrm_contact_id, profile.amocrm_lead_id,
                            profile.subscription_type, profile.subscription_active, profile.subscription_status,
                            profile.subscription_badge, profile.total_classes, profile.used_classes, profile.remaining_classes,
                            profile.expiration_date, profile.activation_date, profile.last_visit_date,
                            1, new Date().toISOString(), existingProfile.id
                        ]
                    );
                    
                    savedCount++;
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка сохранения профиля:`, profileError.message);
            }
        }
        
        console.log(`✅ Сохранено/обновлено: ${savedCount} профилей`);
        return savedCount;
    } catch (error) {
        console.error(`❌ Общая ошибка сохранения профилей: ${error.message}`);
        return 0;
    }
}

// ==================== СОЗДАНИЕ ЭКЗЕМПЛЯРА AMOCRM ====================
const amoCrmService = new AmoCrmService();

// ==================== ОСНОВНЫЕ API МАРШРУТЫ ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер художественной студии работает',
        timestamp: new Date().toISOString(),
        version: '5.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        features: 'Точный поиск сделок по имени ученика'
    });
});

// АВТОРИЗАЦИЯ ПО ТЕЛЕФОНУ
app.post('/api/auth/phone', async (req, res) => {
    try {
        console.log('\n📱 ЗАПРОС АВТОРИЗАЦИИ ПО ТЕЛЕФОНУ');
        console.log('='.repeat(80));
        
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`📱 Телефон: ${formattedPhone}`);
        
        // Проверяем статус amoCRM
        if (!amoCrmService.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return res.status(503).json({
                success: false,
                error: 'Система временно недоступна'
            });
        }
        
        // Получаем данные из amoCRM
        console.log('🔍 Поиск учеников в amoCRM...');
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        if (profiles.length === 0) {
            console.log('❌ Ученики не найдены');
            
            // Проверяем в локальной базе
            const cleanPhone = phone.replace(/\D/g, '');
            const localProfiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY subscription_active DESC, updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            
            console.log(`📊 Найдено в локальной БД: ${localProfiles.length}`);
            
            if (localProfiles.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Ученики не найдены',
                    message: 'По указанному телефону не найдено учеников',
                    phone: formattedPhone,
                    profiles: []
                });
            }
            
            profiles = localProfiles;
        }
        
        // Сохраняем профили в базу данных
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
        
        // Формируем ответ
        const responseProfiles = profiles.map(p => ({
            id: p.id || null,
            student_name: p.student_name,
            phone_number: p.phone_number,
            email: p.email,
            branch: p.branch || 'Филиал не указан',
            teacher_name: p.teacher_name,
            age_group: p.age_group,
            subscription_type: p.subscription_type,
            subscription_active: p.subscription_active === 1 || p.subscription_active === true,
            subscription_status: p.subscription_status,
            subscription_badge: p.subscription_badge,
            total_classes: p.total_classes || 0,
            remaining_classes: p.remaining_classes || 0,
            used_classes: p.used_classes || 0,
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            parent_name: p.parent_name,
            source: p.source,
            last_sync: p.last_sync || new Date().toISOString()
        }));
        
        console.log('✅ Авторизация успешна');
        console.log(`📊 Профилей: ${responseProfiles.length}`);
        
        res.json({
            success: true,
            message: 'Найдены профили учеников',
            data: {
                user: {
                    phone_number: formattedPhone,
                    name: responseProfiles.length > 0 
                        ? responseProfiles[0].parent_name || responseProfiles[0].student_name?.split(' ')[0] || 'Ученик'
                        : 'Гость',
                    profiles_count: responseProfiles.length
                },
                profiles: responseProfiles,
                total_profiles: responseProfiles.length,
                amocrm_connected: amoCrmService.isInitialized,
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

// АВТОРИЗАЦИЯ ПО ID КОНТАКТА
app.get('/api/debug/by-contact/:contactId', async (req, res) => {
    try {
        const contactId = parseInt(req.params.contactId);
        
        console.log(`\n🔑 АВТОРИЗАЦИЯ ПО ID КОНТАКТА: ${contactId}`);
        console.log('='.repeat(60));
        
        if (!amoCrmService.isInitialized) {
            return res.json({ 
                success: false, 
                error: 'amoCRM не инициализирован' 
            });
        }
        
        // 1. Получаем контакт
        const contactResponse = await amoCrmService.makeRequest('GET', 
            `/api/v4/contacts/${contactId}?with=custom_fields_values`
        );
        
        if (!contactResponse) {
            return res.json({ 
                success: false, 
                error: 'Контакт не найден' 
            });
        }
        
        console.log(`📋 Контакт: "${contactResponse.name}" (ID: ${contactId})`);
        
        // 2. Извлекаем учеников из контакта
        const students = amoCrmService.extractStudentsFromContact(contactResponse);
        console.log(`👥 Ученики: ${students.length}`);
        
        if (students.length === 0) {
            return res.json({ 
                success: false, 
                error: 'У контакта нет учеников' 
            });
        }
        
        // 3. Получаем телефон контакта
        const phoneField = contactResponse.custom_fields_values?.find(f => 
            (f.field_id || f.id) === 216615
        );
        const phone = phoneField ? amoCrmService.getFieldValue(phoneField) : null;
        
        // 4. Для КАЖДОГО ученика ищем сделку с абонементом
        const profiles = [];
        
        for (const student of students) {
            console.log(`\n🎯 Поиск для ученика: "${student.studentName}"`);
            
            const leadResult = await amoCrmService.findLeadForStudent(contactId, student.studentName);
            
            if (leadResult) {
                console.log(`✅ Найдена сделка: "${leadResult.lead.name}"`);
                
                // Создаем профиль
                const profile = amoCrmService.createStudentProfile(
                    contactResponse,
                    phone || 'ID:' + contactId,
                    student,
                    leadResult.subscriptionInfo,
                    leadResult.lead
                );
                
                profiles.push(profile);
            } else {
                console.log(`⚠️  Сделка не найдена, создаем базовый профиль`);
                
                // Создаем профиль без абонемента
                const profile = amoCrmService.createStudentProfile(
                    contactResponse,
                    phone || 'ID:' + contactId,
                    student,
                    amoCrmService.getDefaultSubscriptionInfo(),
                    null
                );
                
                profiles.push(profile);
            }
        }
        
        // 5. Сохраняем в БД
        const savedCount = await saveProfilesToDatabase(profiles);
        console.log(`💾 Сохранено в БД: ${savedCount} профилей`);
        
        // 6. Создаем токен
        const sessionId = crypto.randomBytes(32).toString('hex');
        const token = jwt.sign(
            {
                session_id: sessionId,
                contact_id: contactId,
                phone: phone,
                profiles_count: profiles.length,
                timestamp: Date.now()
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        // 7. Форматируем ответ
        const formattedProfiles = profiles.map(p => ({
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
            total_classes: p.total_classes || 0,
            remaining_classes: p.remaining_classes || 0,
            used_classes: p.used_classes || 0,
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            parent_name: p.parent_name,
            source: p.source,
            last_sync: p.last_sync || new Date().toISOString()
        }));
        
        console.log(`\n✅ Авторизация успешна!`);
        console.log(`📊 Профилей: ${profiles.length}`);
        
        res.json({
            success: true,
            message: 'Авторизация по ID контакта успешна',
            data: {
                user: {
                    contact_id: contactId,
                    phone_number: phone || 'ID:' + contactId,
                    name: contactResponse.name,
                    profiles_count: profiles.length
                },
                profiles: formattedProfiles,
                contact_name: contactResponse.name,
                total_profiles: profiles.length,
                token: token,
                last_sync: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка авторизации по ID:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ТЕСТОВАЯ СТРАНИЦА - ДИАГНОСТИКА
app.get('/api/test-connection', async (req, res) => {
    try {
        console.log('\n🧪 ТЕСТ ПОДКЛЮЧЕНИЯ');
        
        const tests = {
            amocrm_initialized: amoCrmService.isInitialized,
            amocrm_domain: AMOCRM_DOMAIN,
            amocrm_token: AMOCRM_ACCESS_TOKEN ? '✅ Установлен' : '❌ Отсутствует',
            database: db ? '✅ Подключена' : '❌ Не подключена'
        };
        
        res.json({
            success: true,
            tests: tests,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ПОИСК СДЕЛКИ ДЛЯ УЧЕНИКА
app.get('/api/find-lead/:contactId/:studentName', async (req, res) => {
    try {
        const contactId = parseInt(req.params.contactId);
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ПОИСК СДЕЛКИ ДЛЯ УЧЕНИКА`);
        console.log(`📋 Контакт ID: ${contactId}`);
        console.log(`👤 Ученик: "${studentName}"`);
        console.log('='.repeat(60));
        
        if (!amoCrmService.isInitialized) {
            return res.json({ 
                success: false, 
                error: 'amoCRM не инициализирован' 
            });
        }
        
        const leadResult = await amoCrmService.findLeadForStudent(contactId, studentName);
        
        if (!leadResult) {
            return res.json({
                success: false,
                error: 'Сделка не найдена',
                student_name: studentName,
                contact_id: contactId
            });
        }
        
        res.json({
            success: true,
            message: 'Сделка найдена',
            data: {
                student_name: studentName,
                contact_id: contactId,
                lead: {
                    id: leadResult.lead.id,
                    name: leadResult.lead.name,
                    pipeline_id: leadResult.lead.pipeline_id,
                    status_id: leadResult.lead.status_id
                },
                subscription_info: leadResult.subscriptionInfo,
                match_score: leadResult.match_score,
                match_type: leadResult.match_type
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска сделки:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ДИАГНОСТИЧЕСКИЙ МАРШРУТ ДЛЯ ВЕБ-ИНТЕРФЕЙСА
app.get('/api/debug/for-app/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ДИАГНОСТИКА ДЛЯ ПРИЛОЖЕНИЯ`);
        console.log(`📱 Телефон: ${phone}`);
        console.log(`👤 Ученик: "${studentName}"`);
        console.log('='.repeat(60));
        
        const formattedPhone = formatPhoneNumber(phone);
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({
                success: false,
                error: 'Контакты не найдены'
            });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // Ищем сделки для этого ученика
        const leadResult = await amoCrmService.findLeadForStudent(contact.id, studentName);
        
        if (!leadResult) {
            return res.json({
                success: false,
                error: 'Сделка не найдена',
                contact: {
                    id: contact.id,
                    name: contact.name
                }
            });
        }
        
        // Получаем полную информацию о контакте
        const contactResponse = await amoCrmService.makeRequest('GET', 
            `/api/v4/contacts/${contact.id}?with=custom_fields_values`
        );
        
        // Извлекаем учеников
        const students = amoCrmService.extractStudentsFromContact(contactResponse);
        
        // Находим нашего ученика
        const studentInfo = students.find(s => 
            amoCrmService.normalizeName(s.studentName).includes(amoCrmService.normalizeName(studentName))
        ) || {
            studentName: studentName,
            branch: '',
            teacherName: '',
            ageGroup: '',
            parentName: contactResponse.name
        };
        
        // Создаем профиль
        const profile = amoCrmService.createStudentProfile(
            contactResponse,
            formattedPhone,
            studentInfo,
            leadResult.subscriptionInfo,
            leadResult.lead
        );
        
        res.json({
            success: true,
            message: 'Данные найдены',
            data: {
                profile: profile,
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                lead: {
                    id: leadResult.lead.id,
                    name: leadResult.lead.name
                },
                match_score: leadResult.match_score,
                is_correct_lead: leadResult.match_score > 50
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ПОЛУЧЕНИЕ ПРОФИЛЕЙ
app.get('/api/profiles', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Токен не предоставлен'
            });
        }
        
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (tokenError) {
            return res.status(401).json({
                success: false,
                error: 'Невалидный токен'
            });
        }
        
        const phone = decoded.phone;
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        
        const profiles = await db.all(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1
             ORDER BY 
               CASE WHEN subscription_active = 1 THEN 1 ELSE 2 END,
               student_name`,
            [`%${cleanPhone}%`]
        );
        
        const formattedProfiles = profiles.map(p => ({
            id: p.id,
            student_name: p.student_name,
            branch: p.branch || 'Филиал не указан',
            teacher_name: p.teacher_name,
            subscription_type: p.subscription_type,
            subscription_status: p.subscription_status,
            subscription_badge: p.subscription_badge,
            total_classes: p.total_classes,
            remaining_classes: p.remaining_classes,
            used_classes: p.used_classes,
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            is_active: p.subscription_active === 1,
            last_sync: p.last_sync
        }));
        
        res.json({
            success: true,
            data: {
                profiles: formattedProfiles,
                total: profiles.length,
                has_multiple: profiles.length > 1,
                last_sync: profiles.length > 0 ? profiles[0].last_sync : null
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения профилей:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профилей'
        });
    }
});

// ПОЛУЧЕНИЕ ИНФОРМАЦИИ ОБ АБОНЕМЕНТЕ
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
        
        try {
            jwt.verify(token, JWT_SECRET);
        } catch (tokenError) {
            return res.status(401).json({
                success: false,
                error: 'Невалидный токен'
            });
        }
        
        let profile;
        
        if (profile_id) {
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE id = ?`,
                [parseInt(profile_id)]
            );
        }
        
        if (!profile && phone) {
            const cleanPhone = phone.replace(/\D/g, '').slice(-10);
            profile = await db.get(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1 
                 ORDER BY subscription_active DESC, updated_at DESC LIMIT 1`,
                [`%${cleanPhone}%`]
            );
        }
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        let progress = 0;
        if (profile.total_classes > 0) {
            progress = Math.round((profile.used_classes / profile.total_classes) * 100);
        }
        
        const response = {
            success: true,
            data: {
                student: {
                    id: profile.id,
                    name: profile.student_name,
                    phone: profile.phone_number,
                    email: profile.email,
                    branch: profile.branch || 'Филиал не указан',
                    birth_date: profile.birth_date,
                    age_group: profile.age_group,
                    course: profile.course,
                    allergies: profile.allergies,
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
                        activation: profile.activation_date,
                        expiration: profile.expiration_date,
                        last_visit: profile.last_visit_date
                    }
                },
                
                parent: profile.parent_name ? {
                    name: profile.parent_name
                } : null,
                
                metadata: {
                    data_source: profile.source,
                    is_real_data: true,
                    last_sync: profile.last_sync,
                    profile_id: profile.id
                }
            }
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Ошибка получения абонемента:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v5.0');
        console.log('✨ ТОЧНЫЙ ПОИСК СДЕЛОК ПО ИМЕНИ УЧЕНИКА');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
        } else {
            console.log('❌ amoCRM не инициализирован');
            console.log('⚠️  Проверьте настройки в .env файле');
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`🔑 Авторизация по ID: GET http://localhost:${PORT}/api/debug/by-contact/{id}`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ПРИМЕРЫ ЗАПРОСОВ:');
            console.log('='.repeat(50));
            console.log('📱 Авторизация по телефону: POST /api/auth/phone { "phone": "79660587744" }');
            console.log('🔑 Авторизация по ID: GET /api/debug/by-contact/123456');
            console.log('🔍 Поиск сделки: GET /api/find-lead/123456/Иван%20Иванов');
            console.log('📋 Профили: GET /api/profiles (Authorization: Bearer token)');
            console.log('🎫 Абонемент: POST /api/subscription { "phone": "79660587744" }');
            console.log('='.repeat(50));
        });
        
        process.on('SIGINT', async () => {
            console.log('\n🔄 Остановка сервера...');
            
            try {
                if (db) {
                    await db.close();
                    console.log('✅ База данных закрыта');
                }
            } catch (dbError) {
                console.error('❌ Ошибка закрытия базы данных:', dbError.message);
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
