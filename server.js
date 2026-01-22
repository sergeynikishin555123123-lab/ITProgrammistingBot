// server.js - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ ДЛЯ ХУДОЖЕСТВЕННОЙ СТУДИИ
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

// Настройки amoCRM
const AMOCRM_CLIENT_ID = process.env.AMOCRM_CLIENT_ID;
const AMOCRM_CLIENT_SECRET = process.env.AMOCRM_CLIENT_SECRET;
const AMOCRM_REDIRECT_URI = process.env.AMOCRM_REDIRECT_URI || `${DOMAIN}/oauth/callback`;
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN;
const AMOCRM_SUBDOMAIN = AMOCRM_DOMAIN?.replace('.amocrm.ru', '') || '';
const AMOCRM_ACCESS_TOKEN = process.env.AMOCRM_ACCESS_TOKEN;

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

// ==================== ОПТИМИЗИРОВАННЫЙ КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 СОЗДАНИЕ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.fieldMappings = new Map();
        this.customFieldCache = new Map();
        
        // ============ РЕАЛЬНЫЕ ID ПОЛЕЙ ИЗ ВАШЕГО AMOCRM ============
        this.FIELD_IDS = {
            // Сделки (абонементы)
            LEAD: {
                // Основные поля абонемента
                SUBSCRIPTION_TYPE: 850241,        // "Абонемент занятий:" (select)
                COUNTER: 850257,                  // "Счетчик занятий:" (select)
                COUNTER_NUMERIC: 884251,          // "Кол-во отхоженных занятий" (numeric)
                REMAINING: 890163,                // "Остаток занятий" (numeric)
                EXPIRATION_DATE: 850255,          // "Окончание абонемента:" (date)
                ACTIVATION_DATE: 851565,          // "Дата активации абонемента:" (date)
                LAST_VISIT_DATE: 850259,          // "Дата последнего визита:" (date)
                SUB_TYPE: 891007,                 // "Тип абонемента" (select)
                OWNER: 805465,                    // "Принадлежность абонемента:" (select)
                FREEZE: 867693,                   // "Заморозка абонемента:" (select)
                BRANCH: 891589,                   // "Филиал" (select)
                AGE_GROUP: 850243,                // "Группа возраст:" (select)
                PURCHASE_DATE: 850253,            // "Дата покупки:" (date)
                TECHNICAL_CLASSES: 891819,        // "Количество занятий (тех)" (numeric)
                CLASS_PRICE: 891813,              // "Стоимость 1 занятия" (numeric)
                
                // Все 24 чекбокса посещений
                CLASS_1: 884899, CLASS_2: 884901, CLASS_3: 884903, CLASS_4: 884905,
                CLASS_5: 884907, CLASS_6: 884909, CLASS_7: 884911, CLASS_8: 884913,
                CLASS_9: 884915, CLASS_10: 884917, CLASS_11: 884919, CLASS_12: 884921,
                CLASS_13: 884923, CLASS_14: 884925, CLASS_15: 884927, CLASS_16: 884929,
                CLASS_17: 892867, CLASS_18: 892871, CLASS_19: 892875, CLASS_20: 892879,
                CLASS_21: 892883, CLASS_22: 892887, CLASS_23: 892893, CLASS_24: 892895,
                
                // Даты занятий
                DATE_1: 884931, DATE_2: 884933, DATE_3: 884935,
                DATE_4: 884937, DATE_5: 884939, DATE_6: 884941,
                DATE_7: 884943, DATE_8: 884945, DATE_9: 884953,
                DATE_10: 884955, DATE_11: 884951, DATE_12: 884957,
                DATE_13: 884959, DATE_14: 884961, DATE_15: 884963,
                DATE_16: 884965, DATE_17: 892869, DATE_18: 892873,
                DATE_19: 892877, DATE_20: 892881, DATE_21: 892885,
                DATE_22: 892889, DATE_23: 892891, DATE_24: 892897
            },
            
            // Контакты (ученики)
            CONTACT: {
                // Дети
                CHILD_1_NAME: 867233,             // "!ФИО ребенка:"
                CHILD_1_BIRTHDAY: 867687,         // "День рождения:" (ребенок 1)
                CHILD_2_NAME: 867235,             // "!!ФИО ребенка:"
                CHILD_2_BIRTHDAY: 867685,         // "День рождения:" (ребенок 2)
                CHILD_3_NAME: 867733,             // "!!!ФИО ребенка:"
                CHILD_3_BIRTHDAY: 867735,         // "День рождения:" (ребенок 3)
                
                // Основные поля
                BRANCH: 871273,                   // "Филиал:" (select)
                TEACHER: 888881,                  // "Преподаватель" (multiselect)
                SUMMER_TEACHER: 891651,           // "Преподаватель (лето)" (multiselect)
                DAY_OF_WEEK: 888879,              // "День недели посещения" (multiselect)
                AGE_GROUP: 888903,                // "Возраст группы" (multiselect)
                
                // Абонемент в контакте
                HAS_ACTIVE_SUB: 890179,           // "Есть активный абонемент" (checkbox)
                LAST_VISIT: 885380,               // "Дата последнего визита" (date)
                LAST_SUB_ACTIVATION: 892185,      // "Дата активации последнего абонемента" (date)
                
                // Дополнительная информация
                ALLERGIES: 850239,                // "Аллергия и особенности:" (textarea)
                PARENT_BIRTHDAY: 850219,          // "День рождения:" (родителя)
                EMAIL: 216617                     // "Email" (стандартное поле)
            }
        };
        
        // Маппинг значений для поля "Абонемент занятий:"
        this.SUBSCRIPTION_MAPPING = {
            '504033': 4,   // "4 занятия"
            '504035': 8,   // "8 занятий"
            '504037': 16,  // "16 занятий"
            '504039': 24,  // "Продвинутый 4 занятия" (принимаем как 24)
            '504041': 4,   // "Продвинутый 8 занятий" (принимаем как 4)
            '504043': 8,   // "Продвинутый 16 занятий" (принимаем как 8)
            '504237': 5,   // "База Блок № 1 - 5 занятий"
            '504239': 6,   // "База Блок № 2 - 6 занятий"
            '504241': 5,   // "База Блок № 3 - 5 занятий"
            '504243': 16   // "База - 16 занятий"
        };
    }

    async initialize() {
        try {
            if (this.accessToken) {
                console.log('🔍 Проверка валидности токена...');
                const isValid = await this.checkTokenValidity(this.accessToken);
                if (isValid) {
                    await this.loadFieldMappings();
                }
                this.isInitialized = isValid;
                return isValid;
            }
            return false;
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            return false;
        }
    }

    async checkTokenValidity(token) {
        try {
            const response = await axios.get(`${this.baseUrl}/api/v4/account`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
            
            this.accountInfo = response.data;
            console.log('✅ Токен валиден!');
            console.log(`📊 Аккаунт: ${this.accountInfo.name || 'Неизвестно'}`);
            return true;
        } catch (error) {
            console.error('❌ Ошибка проверки токена:', error.message);
            return false;
        }
    }

    async makeRequest(method, endpoint, data = null) {
        const url = `${this.baseUrl}${endpoint}`;
        
        try {
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
            console.error(`❌ Ошибка запроса ${endpoint}: ${error.message}`);
            if (error.response) {
                console.error(`📊 Статус: ${error.response.status}`);
                console.error(`📋 Данные:`, error.response.data);
            }
            throw error;
        }
    }

    async loadFieldMappings() {
        try {
            console.log('📋 Загрузка полей amoCRM...');
            
            // Загружаем поля контактов
            const contactFields = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            // Загружаем поля сделок
            const leadFields = await this.makeRequest('GET', '/api/v4/leads/custom_fields');
            
            this.fieldMappings.clear();
            
            // Обрабатываем поля контактов
            if (contactFields && contactFields._embedded && contactFields._embedded.custom_fields) {
                contactFields._embedded.custom_fields.forEach(field => {
                    this.fieldMappings.set(field.id, {
                        name: field.name,
                        type: field.type,
                        entity: 'contact',
                        enums: field.enums || []
                    });
                });
            }
            
            // Обрабатываем поля сделок
            if (leadFields && leadFields._embedded && leadFields._embedded.custom_fields) {
                leadFields._embedded.custom_fields.forEach(field => {
                    this.fieldMappings.set(field.id, {
                        name: field.name,
                        type: field.type,
                        entity: 'lead',
                        enums: field.enums || []
                    });
                });
            }
            
            console.log(`✅ Загружено полей: ${this.fieldMappings.size}`);
            return this.fieldMappings;
            
        } catch (error) {
            console.error('❌ Ошибка загрузки полей:', error.message);
            return new Map();
        }
    }

    // 🔧 УНИВЕРСАЛЬНЫЙ МЕТОД ДЛЯ ПОЛУЧЕНИЯ ЗНАЧЕНИЯ ПОЛЯ
    getFieldValue(field) {
        try {
            if (!field || !field.values || !Array.isArray(field.values) || field.values.length === 0) {
                return '';
            }
            
            const firstValue = field.values[0];
            
            if (typeof firstValue === 'object' && firstValue !== null) {
                // Для числовых полей
                if (firstValue.value !== undefined && firstValue.value !== null) {
                    return String(firstValue.value);
                }
                // Для полей с enum_id
                else if (firstValue.enum_id !== undefined) {
                    return String(firstValue.enum_id);
                }
                // Для полей с enum_value
                else if (firstValue.enum_value !== undefined) {
                    return String(firstValue.enum_value);
                }
            }
            
            // Для простых значений
            return String(firstValue);
            
        } catch (error) {
            console.error('❌ Ошибка получения значения поля:', error);
            return '';
        }
    }

    // 🔧 ПАРСИНГ КОЛИЧЕСТВА ЗАНЯТИЙ
    parseClassesCount(value) {
        if (!value) return 0;
        
        const str = String(value).toLowerCase().trim();
        
        // Если это enum_id из поля "Абонемент занятий:"
        if (this.SUBSCRIPTION_MAPPING[str]) {
            return this.SUBSCRIPTION_MAPPING[str];
        }
        
        // Ищем числа в тексте
        const numberMatch = str.match(/(\d+)/);
        if (numberMatch) {
            return parseInt(numberMatch[1]);
        }
        
        // Текстовые значения
        const textToNumber = {
            'четыре': 4, '4 занятия': 4, '4': 4,
            'восемь': 8, '8 занятий': 8, '8': 8,
            'шестнадцать': 16, '16 занятий': 16, '16': 16,
            'двадцать четыре': 24, '24 занятия': 24, '24': 24
        };
        
        for (const [text, num] of Object.entries(textToNumber)) {
            if (str.includes(text)) {
                return num;
            }
        }
        
        return 0;
    }

    // 🔧 ПАРСИНГ ДАТЫ
    parseDate(value) {
        if (!value) return null;
        
        try {
            const dateStr = String(value).trim();
            
            // Если это timestamp в секундах
            if (dateStr.match(/^\d{9,10}$/)) {
                const timestamp = parseInt(dateStr);
                if (timestamp > 1000000000 && timestamp < 2000000000) {
                    return new Date(timestamp * 1000).toISOString().split('T')[0];
                }
            }
            
            // Формат DD.MM.YYYY
            if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
                const parts = dateStr.split('.');
                const day = parts[0].padStart(2, '0');
                const month = parts[1].padStart(2, '0');
                const year = parts[2];
                return `${year}-${month}-${day}`;
            }
            
            // Формат YYYY-MM-DD
            if (dateStr.match(/^\d{4}-\d{1,2}-\d{1,2}$/)) {
                const parts = dateStr.split('-');
                return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            }
            
            // Пробуем распарсить как дату
            const parsedDate = new Date(dateStr);
            if (!isNaN(parsedDate.getTime())) {
                return parsedDate.toISOString().split('T')[0];
            }
            
            return dateStr;
            
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error);
            return value;
        }
    }

    // 🔧 ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ
    async searchContactsByPhone(phoneNumber) {
        console.log(`\n🔍 ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
            return { _embedded: { contacts: [] } };
        }
        
        try {
            let searchPhone;
            if (cleanPhone.length === 11 && cleanPhone.startsWith('7')) {
                searchPhone = `+${cleanPhone}`;
            } else if (cleanPhone.length === 10) {
                searchPhone = `+7${cleanPhone}`;
            } else {
                searchPhone = `+${cleanPhone}`;
            }
            
            console.log(`🔍 Форматированный номер: ${searchPhone}`);
            
            const response = await this.makeRequest(
                'GET', 
                `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=leads,custom_fields_values`
            );
            
            console.log(`📊 Найдено контактов: ${response._embedded?.contacts?.length || 0}`);
            return response;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    // 🔧 ПОЛУЧЕНИЕ ПОЛНОЙ ИНФОРМАЦИИ О КОНТАКТЕ
    async getFullContactInfo(contactId) {
        try {
            const response = await this.makeRequest(
                'GET',
                `/api/v4/contacts/${contactId}?with=custom_fields_values`
            );
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения контакта: ${error.message}`);
            return null;
        }
    }

    // 🔧 ПОЛУЧЕНИЕ СДЕЛОК КОНТАКТА
    async getContactLeads(contactId) {
        try {
            console.log(`🔍 Получение сделок контакта ID: ${contactId}`);
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/contacts/${contactId}/leads?with=custom_fields_values,contacts&limit=250`
            );
            
            const leads = response._embedded?.leads || [];
            console.log(`📊 Найдено сделок: ${leads.length}`);
            return leads;
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    // 🔧 ПОИСК САМОГО АКТУАЛЬНОГО АБОНЕМЕНТА
    async findLatestSubscription(contactId, studentName = null) {
        console.log(`\n🎯 ПОИСК АКТУАЛЬНОГО АБОНЕМЕНТА ДЛЯ КОНТАКТА: ${contactId}`);
        
        try {
            // Получаем все сделки контакта
            const leads = await this.getContactLeads(contactId);
            
            if (leads.length === 0) {
                console.log('❌ Сделки не найдены');
                return null;
            }
            
            // Фильтруем сделки с абонементами
            const subscriptionLeads = [];
            
            for (const lead of leads) {
                const hasSubscription = this.hasSubscriptionFields(lead);
                
                if (hasSubscription) {
                    // Если указано имя ученика, проверяем соответствие
                    if (studentName) {
                        const isForStudent = this.doesLeadContainStudent(lead, studentName);
                        if (isForStudent) {
                            subscriptionLeads.push(lead);
                        }
                    } else {
                        subscriptionLeads.push(lead);
                    }
                }
            }
            
            console.log(`📊 Сделок с абонементами: ${subscriptionLeads.length}`);
            
            if (subscriptionLeads.length === 0) {
                return null;
            }
            
            // Сортируем по дате создания (новые сначала)
            subscriptionLeads.sort((a, b) => {
                return (b.created_at || 0) - (a.created_at || 0);
            });
            
            // Берем самую свежую сделку
            const latestLead = subscriptionLeads[0];
            console.log(`✅ Самый свежий абонемент: "${latestLead.name}" (ID: ${latestLead.id})`);
            
            return latestLead;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска абонемента: ${error.message}`);
            return null;
        }
    }

    // 🔧 ПРОВЕРКА ЕСТЬ ЛИ В СДЕЛКЕ ПОЛЯ АБОНЕМЕНТА
    hasSubscriptionFields(lead) {
        if (!lead.custom_fields_values || lead.custom_fields_values.length === 0) {
            return false;
        }
        
        // Проверяем наличие ключевых полей абонемента
        for (const field of lead.custom_fields_values) {
            const fieldId = field.field_id || field.id;
            
            if ([
                this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE,   // Абонемент занятий
                this.FIELD_IDS.LEAD.COUNTER,             // Счетчик занятий
                this.FIELD_IDS.LEAD.REMAINING,           // Остаток занятий
                this.FIELD_IDS.LEAD.TECHNICAL_CLASSES    // Количество занятий (тех)
            ].includes(fieldId)) {
                const value = this.getFieldValue(field);
                if (value && value.trim() !== '') {
                    return true;
                }
            }
        }
        
        return false;
    }

    // 🔧 ПРОВЕРКА ОТНОСИТСЯ ЛИ СДЕЛКА К УЧЕНИКУ
    doesLeadContainStudent(lead, studentName) {
        try {
            if (!studentName) return true;
            
            const firstName = studentName.split(' ')[0].toLowerCase();
            const leadName = (lead.name || '').toLowerCase();
            
            // Проверяем в названии сделки
            if (leadName.includes(firstName)) {
                return true;
            }
            
            // Проверяем в кастомных полях
            if (lead.custom_fields_values) {
                for (const field of lead.custom_fields_values) {
                    const fieldValue = this.getFieldValue(field).toLowerCase();
                    if (fieldValue.includes(firstName)) {
                        return true;
                    }
                }
            }
            
            return false;
        } catch (error) {
            return true; // Если ошибка, считаем что подходит
        }
    }

    // 🔧 ИЗВЛЕЧЕНИЕ ИНФОРМАЦИИ ОБ АБОНЕМЕНТЕ ИЗ СДЕЛКИ
    extractSubscriptionInfo(lead) {
        const subscriptionInfo = {
            hasSubscription: false,
            totalClasses: 0,
            usedClasses: 0,
            remainingClasses: 0,
            subscriptionType: '',
            subscriptionActive: false,
            activationDate: '',
            expirationDate: '',
            lastVisitDate: '',
            purchaseDate: '',
            subscriptionStatus: 'Нет абонемента',
            subscriptionBadge: 'inactive',
            branch: '',
            ageGroup: '',
            subscriptionOwner: ''
        };
        
        if (!lead) {
            return subscriptionInfo;
        }
        
        try {
            const customFields = lead.custom_fields_values || [];
            const leadName = lead.name || '';
            const statusId = lead.status_id || 0;
            
            console.log(`\n🔍 Анализ абонемента: "${leadName}" (Статус: ${statusId})`);
            
            // Собираем данные из полей
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                // Тип абонемента (количество занятий)
                if (fieldId === this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.totalClasses = this.parseClassesCount(fieldValue);
                    subscriptionInfo.subscriptionType = this.getSubscriptionTypeName(fieldValue);
                    console.log(`🎫 Абонемент: ${subscriptionInfo.totalClasses} занятий`);
                }
                
                // Счетчик занятий
                else if (fieldId === this.FIELD_IDS.LEAD.COUNTER) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.usedClasses = this.parseCounterValue(fieldValue);
                    console.log(`📊 Использовано: ${subscriptionInfo.usedClasses}`);
                }
                
                // Альтернативный счетчик (числовой)
                else if (fieldId === this.FIELD_IDS.LEAD.COUNTER_NUMERIC) {
                    subscriptionInfo.hasSubscription = true;
                    const numValue = parseInt(fieldValue) || 0;
                    subscriptionInfo.usedClasses = Math.max(subscriptionInfo.usedClasses, numValue);
                    console.log(`📊 Отхоженных: ${numValue}`);
                }
                
                // Остаток занятий
                else if (fieldId === this.FIELD_IDS.LEAD.REMAINING) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.remainingClasses = parseInt(fieldValue) || 0;
                    console.log(`📊 Осталось: ${subscriptionInfo.remainingClasses}`);
                }
                
                // Техническое количество
                else if (fieldId === this.FIELD_IDS.LEAD.TECHNICAL_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    const techClasses = parseInt(fieldValue) || 0;
                    if (subscriptionInfo.totalClasses === 0 && techClasses > 0) {
                        subscriptionInfo.totalClasses = techClasses;
                        console.log(`🔧 Техническое: ${techClasses}`);
                    }
                }
                
                // Дата окончания
                else if (fieldId === this.FIELD_IDS.LEAD.EXPIRATION_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.expirationDate = this.parseDate(fieldValue);
                    console.log(`📅 Окончание: ${subscriptionInfo.expirationDate}`);
                }
                
                // Дата активации
                else if (fieldId === this.FIELD_IDS.LEAD.ACTIVATION_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.activationDate = this.parseDate(fieldValue);
                    console.log(`📅 Активация: ${subscriptionInfo.activationDate}`);
                }
                
                // Дата покупки
                else if (fieldId === this.FIELD_IDS.LEAD.PURCHASE_DATE) {
                    subscriptionInfo.purchaseDate = this.parseDate(fieldValue);
                    console.log(`📅 Покупка: ${subscriptionInfo.purchaseDate}`);
                }
                
                // Дата последнего визита
                else if (fieldId === this.FIELD_IDS.LEAD.LAST_VISIT_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.lastVisitDate = this.parseDate(fieldValue);
                    console.log(`📅 Последний визит: ${subscriptionInfo.lastVisitDate}`);
                }
                
                // Филиал
                else if (fieldId === this.FIELD_IDS.LEAD.BRANCH) {
                    subscriptionInfo.branch = fieldValue;
                    console.log(`📍 Филиал: ${fieldValue}`);
                }
                
                // Возрастная группа
                else if (fieldId === this.FIELD_IDS.LEAD.AGE_GROUP) {
                    subscriptionInfo.ageGroup = fieldValue;
                    console.log(`👶 Возраст: ${fieldValue}`);
                }
            }
            
            // Проверяем чекбоксы посещений
            if (subscriptionInfo.hasSubscription && subscriptionInfo.usedClasses === 0) {
                let visitedClasses = 0;
                
                for (let i = 1; i <= 24; i++) {
                    const fieldId = this.FIELD_IDS.LEAD[`CLASS_${i}`];
                    if (fieldId) {
                        const field = customFields.find(f => (f.field_id || f.id) === fieldId);
                        if (field) {
                            const value = this.getFieldValue(field);
                            if (value && value.toLowerCase() === 'да') {
                                visitedClasses++;
                            }
                        }
                    }
                }
                
                if (visitedClasses > 0) {
                    subscriptionInfo.usedClasses = visitedClasses;
                    console.log(`ℹ️  Посещений по чекбоксам: ${visitedClasses}`);
                }
            }
            
            // Рассчитываем недостающие данные
            if (subscriptionInfo.hasSubscription) {
                // Если есть общее количество, но нет остатка
                if (subscriptionInfo.totalClasses > 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                }
                
                // Если есть остаток, но нет общего количества
                else if (subscriptionInfo.remainingClasses > 0 && subscriptionInfo.totalClasses === 0) {
                    subscriptionInfo.totalClasses = subscriptionInfo.usedClasses + subscriptionInfo.remainingClasses;
                }
                
                // Определяем статус абонемента
                this.determineSubscriptionStatus(subscriptionInfo, statusId);
            }
            
            console.log(`✅ Итог: ${subscriptionInfo.subscriptionStatus}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации об абонементе:', error);
        }
        
        return subscriptionInfo;
    }

    // 🔧 ОПРЕДЕЛЕНИЕ СТАТУСА АБОНЕМЕНТА
    determineSubscriptionStatus(subscriptionInfo, statusId) {
        const today = new Date();
        
        // Проверяем истек ли срок
        if (subscriptionInfo.expirationDate) {
            const expDate = new Date(subscriptionInfo.expirationDate);
            if (expDate < today) {
                subscriptionInfo.subscriptionStatus = 'Абонемент истек';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
                return;
            }
        }
        
        // Проверяем активацию в будущем
        if (subscriptionInfo.activationDate) {
            const actDate = new Date(subscriptionInfo.activationDate);
            if (actDate > today) {
                subscriptionInfo.subscriptionStatus = 'Ожидает активации';
                subscriptionInfo.subscriptionBadge = 'pending';
                subscriptionInfo.subscriptionActive = false;
                return;
            }
        }
        
        // Проверяем остаток занятий
        if (subscriptionInfo.remainingClasses > 0) {
            subscriptionInfo.subscriptionStatus = `Активный (осталось ${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
            subscriptionInfo.subscriptionBadge = 'active';
            subscriptionInfo.subscriptionActive = true;
            return;
        }
        
        // Если занятия закончились
        if (subscriptionInfo.usedClasses >= subscriptionInfo.totalClasses && subscriptionInfo.totalClasses > 0) {
            subscriptionInfo.subscriptionStatus = 'Занятия закончились';
            subscriptionInfo.subscriptionBadge = 'expired';
            subscriptionInfo.subscriptionActive = false;
            return;
        }
        
        // Сделка закрыта
        if ([142, 143].includes(statusId)) {
            subscriptionInfo.subscriptionStatus = 'Абонемент завершен';
            subscriptionInfo.subscriptionBadge = 'expired';
            subscriptionInfo.subscriptionActive = false;
            return;
        }
        
        // Дефолтный статус
        if (subscriptionInfo.totalClasses > 0) {
            subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий`;
            subscriptionInfo.subscriptionBadge = 'has_subscription';
            subscriptionInfo.subscriptionActive = true;
        } else {
            subscriptionInfo.subscriptionStatus = 'Нет абонемента';
            subscriptionInfo.subscriptionBadge = 'inactive';
            subscriptionInfo.subscriptionActive = false;
        }
    }

    // 🔧 ПАРСИНГ ЗНАЧЕНИЯ СЧЕТЧИКА
    parseCounterValue(value) {
        if (!value) return 0;
        
        const str = String(value).toLowerCase().trim();
        
        // Маппинг для поля "Счетчик занятий:"
        const counterMapping = {
            '504105': 1, '504107': 2, '504109': 3, '504111': 4,
            '504113': 5, '504115': 6, '504117': 7, '504119': 8,
            '504121': 9, '504123': 10
        };
        
        if (counterMapping[str]) {
            return counterMapping[str];
        }
        
        // Ищем число в тексте
        const numberMatch = str.match(/(\d+)/);
        if (numberMatch) {
            return parseInt(numberMatch[1]);
        }
        
        return 0;
    }

    // 🔧 ПОЛУЧЕНИЕ НАЗВАНИЯ ТИПА АБОНЕМЕНТА
    getSubscriptionTypeName(enumId) {
        const mapping = {
            '504033': '4 занятия',
            '504035': '8 занятий',
            '504037': '16 занятий',
            '504039': 'Продвинутый 4 занятия',
            '504041': 'Продвинутый 8 занятий',
            '504043': 'Продвинутый 16 занятий',
            '504237': 'База Блок № 1 - 5 занятий',
            '504239': 'База Блок № 2 - 6 занятий',
            '504241': 'База Блок № 3 - 5 занятий',
            '504243': 'База - 16 занятий'
        };
        
        return mapping[enumId] || `Абонемент (${enumId})`;
    }

    // 🔧 ИЗВЛЕЧЕНИЕ ИНФОРМАЦИИ О ДЕТЯХ ИЗ КОНТАКТА
    extractStudentsFromContact(contact) {
        const students = [];
        
        try {
            const customFields = contact.custom_fields_values || [];
            
            console.log(`\n👤 Поиск детей в контакте: ${contact.name || 'Без имени'}`);
            
            // Конфигурация для трех детей
            const childrenConfig = [
                { number: 1, nameFieldId: this.FIELD_IDS.CONTACT.CHILD_1_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_1_BIRTHDAY },
                { number: 2, nameFieldId: this.FIELD_IDS.CONTACT.CHILD_2_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_2_BIRTHDAY },
                { number: 3, nameFieldId: this.FIELD_IDS.CONTACT.CHILD_3_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_3_BIRTHDAY }
            ];
            
            for (const childConfig of childrenConfig) {
                let childInfo = {
                    studentName: '',
                    birthDate: '',
                    branch: '',
                    dayOfWeek: '',
                    teacherName: '',
                    ageGroup: '',
                    allergies: '',
                    parentName: contact.name || '',
                    hasActiveSubscription: false,
                    lastVisitDate: ''
                };
                
                let hasChildData = false;
                
                // Ищем данные ребенка
                for (const field of customFields) {
                    const fieldId = field.field_id || field.id;
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue || fieldValue.trim() === '') continue;
                    
                    // Имя ребенка
                    if (fieldId === childConfig.nameFieldId) {
                        childInfo.studentName = fieldValue;
                        hasChildData = true;
                        console.log(`   👶 Ребенок ${childConfig.number}: ${fieldValue}`);
                    }
                    
                    // День рождения
                    else if (fieldId === childConfig.birthdayFieldId) {
                        childInfo.birthDate = this.parseDate(fieldValue);
                    }
                    
                    // Общие поля для всех детей
                    else if (fieldId === this.FIELD_IDS.CONTACT.BRANCH) {
                        childInfo.branch = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.TEACHER) {
                        childInfo.teacherName = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.DAY_OF_WEEK) {
                        childInfo.dayOfWeek = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) {
                        childInfo.hasActiveSubscription = fieldValue.toLowerCase() === 'да';
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.LAST_VISIT) {
                        childInfo.lastVisitDate = this.parseDate(fieldValue);
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.AGE_GROUP) {
                        childInfo.ageGroup = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.ALLERGIES) {
                        childInfo.allergies = fieldValue;
                    }
                }
                
                // Добавляем ребенка если нашли имя
                if (hasChildData && childInfo.studentName && childInfo.studentName.trim() !== '') {
                    students.push(childInfo);
                }
            }
            
            console.log(`📊 Найдено детей: ${students.length}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения учеников из контакта:', error);
        }
        
        return students;
    }

    // 🔧 ПОЛУЧЕНИЕ EMAIL ИЗ КОНТАКТА
    findEmail(contact) {
        try {
            const customFields = contact.custom_fields_values || [];
            
            // Ищем поле Email (ID: 216617)
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                if (fieldId === this.FIELD_IDS.CONTACT.EMAIL) {
                    const value = this.getFieldValue(field);
                    if (value && value.includes('@')) {
                        return value;
                    }
                }
            }
            
            return '';
        } catch (error) {
            console.error('❌ Ошибка поиска email:', error);
            return '';
        }
    }

    // 🔧 ОСНОВНОЙ МЕТОД ДЛЯ ПОЛУЧЕНИЯ ПРОФИЛЕЙ УЧЕНИКОВ
    async getStudentsByPhone(phoneNumber) {
        console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            // 1. Ищем контакты по телефону
            console.log('🔍 Поиск контактов...');
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                console.log('📭 Контакты не найдены');
                return studentProfiles;
            }
            
            // 2. Обрабатываем каждый контакт
            for (const contact of contacts) {
                console.log(`\n👤 Анализ контакта: ${contact.name} (ID: ${contact.id})`);
                
                // Получаем полную информацию о контакте
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                // Извлекаем информацию о детях
                const children = this.extractStudentsFromContact(fullContact);
                console.log(`📊 Найдено детей: ${children.length}`);
                
                // 3. Для каждого ребенка создаем профиль
                for (const child of children) {
                    console.log(`\n👤 Создание профиля для: ${child.studentName}`);
                    
                    // Ищем абонемент для этого ребенка
                    const subscriptionLead = await this.findLatestSubscription(contact.id, child.studentName);
                    let subscriptionInfo = this.extractSubscriptionInfo(null);
                    
                    if (subscriptionLead) {
                        subscriptionInfo = this.extractSubscriptionInfo(subscriptionLead);
                        console.log(`✅ Найден абонемент для ${child.studentName}`);
                        console.log(`   Занятий: ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses} (осталось: ${subscriptionInfo.remainingClasses})`);
                    } else {
                        console.log(`⚠️  Абонемент не найден для ${child.studentName}`);
                    }
                    
                    // Создаем профиль
                    const studentProfile = this.createStudentProfile(
                        fullContact,
                        phoneNumber,
                        child,
                        subscriptionInfo,
                        subscriptionLead
                    );
                    
                    studentProfiles.push(studentProfile);
                    console.log(`✅ Профиль создан: ${child.studentName}`);
                }
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${studentProfiles.length}`);
            
        } catch (error) {
            console.error(`❌ Ошибка получения данных из amoCRM:`, error.message);
        }
        
        return studentProfiles;
    }

    // 🔧 СОЗДАНИЕ ПРОФИЛЯ УЧЕНИКА
    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        // Определяем email
        const email = this.findEmail(contact);
        
        // Создаем профиль
        const profile = {
            amocrm_contact_id: contact.id || null,
            parent_contact_id: contact.id || null,
            amocrm_lead_id: lead?.id || null,
            student_name: studentInfo.studentName || 'Ученик',
            phone_number: phoneNumber,
            email: email || '',
            birth_date: studentInfo.birthDate || '',
            branch: studentInfo.branch || subscriptionInfo.branch || '',
            parent_name: studentInfo.parentName || contact.name || '',
            day_of_week: studentInfo.dayOfWeek || '',
            teacher_name: studentInfo.teacherName || '',
            age_group: studentInfo.ageGroup || subscriptionInfo.ageGroup || '',
            allergies: studentInfo.allergies || '',
            
            // Данные абонемента
            subscription_type: subscriptionInfo.subscriptionType || 'Без абонемента',
            subscription_active: subscriptionInfo.subscriptionActive ? 1 : 0,
            subscription_status: subscriptionInfo.subscriptionStatus || 'Нет абонемента',
            subscription_badge: subscriptionInfo.subscriptionBadge || 'inactive',
            total_classes: subscriptionInfo.totalClasses || 0,
            remaining_classes: subscriptionInfo.remainingClasses || 0,
            used_classes: subscriptionInfo.usedClasses || 0,
            expiration_date: subscriptionInfo.expirationDate || null,
            activation_date: subscriptionInfo.activationDate || null,
            last_visit_date: subscriptionInfo.lastVisitDate || studentInfo.lastVisitDate || null,
            
            // Технические данные
            custom_fields: JSON.stringify(contact.custom_fields_values || []),
            raw_contact_data: JSON.stringify(contact),
            lead_data: lead ? JSON.stringify(lead) : '{}',
            is_demo: 0,
            source: 'amocrm',
            is_active: 1
        };
        
        console.log(`📊 Создан профиль:`);
        console.log(`   👤 ${profile.student_name}`);
        console.log(`   📍 Филиал: ${profile.branch || 'не указан'}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        console.log(`   📊 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        
        return profile;
    }
}

// Создаем экземпляр сервиса amoCRM
const amoCrmService = new AmoCrmService();

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ');
        console.log('='.repeat(80));
        
        try {
            const dbDir = path.join(__dirname, 'data');
            try {
                await fs.mkdir(dbDir, { recursive: true });
                console.log('📁 Директория данных создана:', dbDir);
            } catch (mkdirError) {
                console.log('📁 Директория данных уже существует');
            }
            
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
            
            console.log('⚠️  ВНИМАНИЕ: БД создана в памяти. Данные будут потеряны при перезапуске!');
        }
        
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        
        console.log('⚙️  Настройки SQLite применены');
        
        await createTables();
        
        console.log('\n✅ База данных успешно инициализирована!');
        
        return db;
    } catch (error) {
        console.error('❌ Критическая ошибка инициализации базы данных:', error.message);
        throw error;
    }
};

const createTables = async () => {
    try {
        console.log('\n📊 СОЗДАНИЕ ТАБЛИЦ БАЗЫ ДАННЫХ');
        
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amocrm_contact_id INTEGER,
                parent_contact_id INTEGER,
                amocrm_lead_id INTEGER,
                
                -- Основная информация
                student_name TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                email TEXT,
                birth_date TEXT,
                branch TEXT,
                
                -- Расписание
                day_of_week TEXT,
                time_slot TEXT,
                teacher_name TEXT,
                age_group TEXT,
                course TEXT,
                allergies TEXT,
                
                -- Информация о родителе
                parent_name TEXT,
                
                -- Абонемент
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
                
                -- Технические данные
                custom_fields TEXT,
                raw_contact_data TEXT,
                lead_data TEXT,
                is_demo INTEGER DEFAULT 0,
                source TEXT DEFAULT 'amocrm',
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица student_profiles создана');

        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_name ON student_profiles(student_name)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(is_active)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_branch ON student_profiles(branch)');
        
        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT UNIQUE NOT NULL,
                session_data TEXT,
                phone_number TEXT,
                ip_address TEXT,
                user_agent TEXT,
                is_active INTEGER DEFAULT 1,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица user_sessions создана');
        
        console.log('\n🎉 Все таблицы созданы успешно!');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

async function saveProfilesToDatabase(profiles) {
    try {
        console.log(`💾 Сохранение профилей в БД...`);
        let savedCount = 0;
        
        for (const profile of profiles) {
            try {
                // Проверяем существование профиля
                const existingProfile = await db.get(
                    `SELECT id FROM student_profiles 
                     WHERE student_name = ? AND phone_number = ? AND branch = ?`,
                    [profile.student_name, profile.phone_number, profile.branch || '']
                );
                
                const columns = [
                    'amocrm_contact_id', 'parent_contact_id', 'amocrm_lead_id', 'student_name', 'phone_number', 'email',
                    'birth_date', 'branch', 'day_of_week', 'time_slot', 'teacher_name', 'age_group', 'course', 'allergies',
                    'parent_name', 'subscription_type', 'subscription_active', 'subscription_status', 'subscription_badge',
                    'total_classes', 'used_classes', 'remaining_classes', 'expiration_date', 
                    'activation_date', 'last_visit_date', 'custom_fields', 
                    'raw_contact_data', 'lead_data', 'is_demo', 'source', 'is_active'
                ];
                
                const values = [
                    profile.amocrm_contact_id || null,
                    profile.parent_contact_id || null,
                    profile.amocrm_lead_id || null,
                    profile.student_name,
                    profile.phone_number,
                    profile.email || '',
                    profile.birth_date || '',
                    profile.branch || '',
                    profile.day_of_week || '',
                    profile.time_slot || '',
                    profile.teacher_name || '',
                    profile.age_group || '',
                    profile.course || '',
                    profile.allergies || '',
                    profile.parent_name || '',
                    profile.subscription_type || 'Без абонемента',
                    profile.subscription_active || 0,
                    profile.subscription_status || '',
                    profile.subscription_badge || 'inactive',
                    profile.total_classes || 0,
                    profile.used_classes || 0,
                    profile.remaining_classes || 0,
                    profile.expiration_date || null,
                    profile.activation_date || null,
                    profile.last_visit_date || null,
                    profile.custom_fields || '{}',
                    profile.raw_contact_data || '{}',
                    profile.lead_data || '{}',
                    profile.is_demo || 0,
                    profile.source || 'amocrm',
                    1
                ];
                
                if (!existingProfile) {
                    // Вставка нового профиля
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    savedCount++;
                    console.log(`✅ Профиль сохранен: ${profile.student_name} (${profile.branch || 'без филиала'})`);
                } else {
                    // Обновление существующего профиля
                    const setClause = columns.map(col => `${col} = ?`).join(', ');
                    
                    await db.run(
                        `UPDATE student_profiles SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [...values, existingProfile.id]
                    );
                    savedCount++;
                    console.log(`✅ Профиль обновлен: ${profile.student_name} (${profile.branch || 'без филиала'})`);
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка сохранения профиля ${profile.student_name}:`, profileError.message);
            }
        }
        
        console.log(`✅ Сохранено/обновлено профилей: ${savedCount}`);
        return savedCount;
    } catch (error) {
        console.error(`❌ Общая ошибка сохранения профилей: ${error.message}`);
        return 0;
    }
}

function formatPhoneNumber(phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    
    if (cleanPhone.length === 10) {
        return '+7' + cleanPhone;
    } else if (cleanPhone.length === 11) {
        if (cleanPhone.startsWith('8')) {
            return '+7' + cleanPhone.slice(1);
        } else if (cleanPhone.startsWith('7')) {
            return '+' + cleanPhone;
        } else {
            return '+7' + cleanPhone.slice(-10);
        }
    } else {
        return '+7' + cleanPhone.slice(-10);
    }
}

// ==================== ОСНОВНОЙ API ====================

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '3.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        data_source: amoCrmService.isInitialized ? 'Реальные данные из amoCRM' : 'Локальные данные'
    });
});

app.post('/api/auth/phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`\n🔐 АВТОРИЗАЦИЯ ПО ТЕЛЕФОНУ: ${phone}`);
        
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`📱 Форматированный номер: ${formattedPhone}`);
        console.log(`🔧 Статус amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
        
        let profiles = [];
        
        // Ищем профили в amoCRM
        if (amoCrmService.isInitialized) {
            console.log('🔍 Поиск в amoCRM...');
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            console.log(`📊 Найдено профилей в amoCRM: ${profiles.length}`);
            
            if (profiles.length > 0) {
                const savedCount = await saveProfilesToDatabase(profiles);
                console.log(`💾 Сохранено в БД: ${savedCount} профилей`);
                
                // После сохранения, загружаем из БД для гарантии
                const cleanPhone = phone.replace(/\D/g, '');
                profiles = await db.all(
                    `SELECT * FROM student_profiles 
                     WHERE phone_number LIKE ? AND is_active = 1
                     ORDER BY 
                       CASE WHEN subscription_active = 1 THEN 1 ELSE 2 END,
                       CASE WHEN source = 'amocrm' THEN 1 ELSE 2 END,
                       updated_at DESC`,
                    [`%${cleanPhone.slice(-10)}%`]
                );
                console.log(`📊 Загружено из БД после сохранения: ${profiles.length}`);
            }
        }
        
        // Если в amoCRM не нашли или не удалось сохранить, ищем в локальной БД
        if (profiles.length === 0) {
            console.log('🔍 Поиск в локальной базе данных...');
            const cleanPhone = phone.replace(/\D/g, '');
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY 
                   CASE WHEN subscription_active = 1 THEN 1 ELSE 2 END,
                   CASE WHEN source = 'amocrm' THEN 1 ELSE 2 END,
                   updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            console.log(`📊 Найдено профилей в локальной БД: ${profiles.length}`);
        }
        
        // Создаем временного пользователя
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            first_name: profiles.length > 0 ? profiles[0].student_name?.split(' ')[0] || 'Ученик' : 'Гость',
            is_temp: true,
            profiles_count: profiles.length
        };
        
        // Создаем сессию
        const sessionId = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        
        try {
            await db.run(
                `INSERT INTO user_sessions (session_id, session_data, phone_number, expires_at, is_active) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    sessionId,
                    JSON.stringify({ user: tempUser, profiles_count: profiles.length }),
                    formattedPhone,
                    expiresAt.toISOString(),
                    1
                ]
            );
        } catch (dbError) {
            console.error(`❌ Ошибка создания сессии: ${dbError.message}`);
        }
        
        // Создаем JWT токен
        const token = jwt.sign(
            {
                session_id: sessionId,
                phone: formattedPhone,
                is_temp: true,
                profiles_count: profiles.length,
                amocrm_connected: amoCrmService.isInitialized
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        // Форматируем профили для ответа
        const responseProfiles = profiles.map(p => ({
            id: p.id,
            student_name: p.student_name,
            phone_number: p.phone_number,
            email: p.email,
            branch: p.branch || 'Филиал не указан',
            day_of_week: p.day_of_week,
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
            source: p.source
        }));
        
        // Проверяем, есть ли реальные данные из amoCRM
        const hasRealData = profiles.some(p => p.source === 'amocrm' && p.is_demo === 0);
        
        // Определяем, есть ли несколько учеников
        const hasMultipleStudents = profiles.length > 1;
        
        // Формируем ответ
        const responseData = {
            success: true,
            message: profiles.length > 0 
                ? hasRealData ? 'Найдены реальные профили учеников' : 'Найдены демо-профили учеников'
                : 'Профили не найдены',
            data: {
                user: tempUser,
                profiles: responseProfiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                has_real_data: hasRealData,
                has_multiple_students: hasMultipleStudents,
                token: token
            }
        };
        
        console.log(`✅ Авторизация завершена успешно`);
        console.log(`📊 Реальные данные из amoCRM: ${hasRealData ? '✅ Да' : '❌ Нет'}`);
        console.log(`👥 Несколько учеников: ${hasMultipleStudents ? '✅ Да' : '❌ Нет'}`);
        
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Ошибка авторизации:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки телефона',
            details: error.message
        });
    }
});

app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id, phone } = req.body;
        
        console.log(`\n📋 ЗАПРОС АБОНЕМЕНТА`);
        
        let profile;
        if (profile_id) {
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE id = ?`,
                [profile_id]
            );
            console.log(`🔍 Поиск по ID профиля: ${profile_id}`);
        } else if (phone) {
            const cleanPhone = phone.replace(/\D/g, '').slice(-10);
            profile = await db.get(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1 
                 ORDER BY subscription_active DESC, updated_at DESC LIMIT 1`,
                [`%${cleanPhone}%`]
            );
            console.log(`🔍 Поиск по телефону: ${phone}`);
        }
        
        if (!profile) {
            console.log(`📭 Абонемент не найден`);
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        console.log(`✅ Найден профиль: ${profile.student_name}`);
        console.log(`📍 Филиал: ${profile.branch || 'не указан'}`);
        console.log(`📊 Абонемент: ${profile.subscription_status}`);
        
        // Рассчитываем прогресс использования абонемента
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
                    email: profile.email,
                    branch: profile.branch || 'Филиал не указан',
                    birth_date: profile.birth_date,
                    age_group: profile.age_group,
                    allergies: profile.allergies
                },
                
                schedule: {
                    day_of_week: profile.day_of_week,
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
                    is_real_data: profile.is_demo === 0,
                    is_demo: profile.is_demo === 1,
                    last_updated: profile.updated_at,
                    profile_id: profile.id
                }
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

// ==================== ДОПОЛНИТЕЛЬНЫЕ API ====================

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        amocrm_status: amoCrmService.isInitialized ? 'connected' : 'disconnected'
    });
});

app.get('/api/crm/status', async (req, res) => {
    try {
        const isValid = amoCrmService.isInitialized;
        
        res.json({
            success: true,
            data: {
                connected: isValid,
                account_name: amoCrmService.accountInfo?.name || null,
                subdomain: AMOCRM_SUBDOMAIN,
                last_check: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки статуса CRM:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки статуса CRM'
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v3.0');
        console.log('='.repeat(80));
        console.log('✨ ОПТИМИЗИРОВАННЫЙ ПОИСК ДАННЫХ ИЗ AMOCRM');
        console.log('✨ РЕАЛЬНЫЕ ID ПОЛЕЙ ИЗ ВАШЕЙ CRM');
        console.log('✨ АКТУАЛЬНЫЕ ДАННЫЕ АБОНЕМЕНТОВ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
        } else {
            console.log('⚠️  amoCRM не инициализирован');
            console.log('ℹ️  Используются локальные/тестовые данные');
        }
        
        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 Основной URL: http://localhost:${PORT}`);
            console.log(`📊 База данных: SQLite`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`📋 Абонемент: POST http://localhost:${PORT}/api/subscription`);
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
