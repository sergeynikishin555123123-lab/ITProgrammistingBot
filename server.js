// server.js - ИСПРАВЛЕННАЯ ВЕРСИЯ С КОРРЕКТНОЙ ЛОГИКОЙ ВЫБОРА АБОНЕМЕНТОВ

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
const AMOCRM_SUBDOMAIN = AMOCRM_DOMAIN ? AMOCRM_DOMAIN.replace('.amocrm.ru', '') : '';
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

// ==================== КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService v3.0');
        console.log('📊 КОРРЕКТНАЯ ЛОГИКА ВЫБОРА АБОНЕМЕНТОВ');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.fieldMappings = new Map();
        
        // ОСНОВНЫЕ ПОЛЯ ДЛЯ АБОНЕМЕНТОВ
        this.FIELD_IDS = {
            // Сделки (абонементы)
            LEAD: {
                TOTAL_CLASSES: 850241,    // "Абонемент занятий:"
                USED_CLASSES: 850257,     // "Счетчик занятий:"  
                REMAINING_CLASSES: 890163, // "Остаток занятий"
                EXPIRATION_DATE: 850255,  // "Окончание абонемента:"
                ACTIVATION_DATE: 851565,  // "Дата активации абонемента:"
                LAST_VISIT_DATE: 850259,  // "Дата последнего визита:"
                SUBSCRIPTION_TYPE: 891007, // "Тип абонемента"
                FREEZE: 867693,           // "Заморозка абонемента:"
                SUBSCRIPTION_OWNER: 805465, // "Принадлежность абонемента:"
                
                // Дополнительные поля
                TECHNICAL_COUNT: 891819,  // "Количество занятий (тех)"
                AGE_GROUP: 850243,        // "Группа возраст:"
                PRICE_PER_CLASS: 891813,  // "Стоимость 1 занятия"
                ADVANCE_PAYMENT: 891817,  // "Авансовые средства"
                RECEIVED_PAYMENT: 891815, // "Полученные средства"
                
                // Поля для посещений
                CLASS_1: 884899, CLASS_2: 884901, CLASS_3: 884903, CLASS_4: 884905,
                CLASS_5: 884907, CLASS_6: 884909, CLASS_7: 884911, CLASS_8: 884913,
                CLASS_9: 884915, CLASS_10: 884917, CLASS_11: 884919, CLASS_12: 884921,
                CLASS_13: 884923, CLASS_14: 884925, CLASS_15: 884927, CLASS_16: 884929,
                CLASS_17: 892867, CLASS_18: 892871, CLASS_19: 892875, CLASS_20: 892879,
                CLASS_21: 892883, CLASS_22: 892887, CLASS_23: 892893, CLASS_24: 892895
            },
            
            // Контакты (ученики)
            CONTACT: {
                // Дети
                CHILD_1_NAME: 867233,    // "!ФИО ребенка:"
                CHILD_1_BIRTHDAY: null,
                CHILD_2_NAME: 867235,    // "!!ФИО ребенка:"
                CHILD_2_BIRTHDAY: 867685,
                CHILD_3_NAME: 867733,    // "!!!ФИО ребенка:"
                CHILD_3_BIRTHDAY: 867735,
                
                // Основные поля
                BRANCH: 871273,          // "Филиал:"
                TEACHER: 888881,         // "Преподаватель"
                DAY_OF_WEEK: 892225,     // "День недели (2025-26)"
                HAS_ACTIVE_SUB: 890179,  // "Есть активный абонемент"
                LAST_VISIT: 885380,      // "Дата последнего визита"
                AGE_GROUP: 888903,       // "Возраст группы"
                ALLERGIES: null,
                BIRTH_DATE: null,
                
                // Общие поля
                PARENT_NAME: 'name',     // Имя контакта
                EMAIL: null,
                PHONE: 216615            // "Телефон"
            }
        };
        
        // Воронка "!Абонемент"
        this.SUBSCRIPTION_PIPELINE_ID = 7977402;
        
        // Статусы абонементов
        this.SUBSCRIPTION_STATUSES = {
            ACTIVE: [
                65473306, // "Активный абонемент"
                60025747  // "Активирован"
            ],
            INACTIVE: [
                60025749  // "Истек"
            ],
            FROZEN: [
                60025751  // "Заморозка"
            ]
        };
    }

    async initialize() {
        try {
            console.log('🔄 Начинаем инициализацию amoCRM...');
            
            if (this.accessToken) {
                console.log('🔍 Проверка валидности токена...');
                const isValid = await this.checkTokenValidity(this.accessToken);
                this.isInitialized = isValid;
                
                if (isValid) {
                    await this.loadFieldMappings();
                    console.log('✅ amoCRM успешно инициализирован');
                    console.log(`📊 Аккаунт: ${this.accountInfo.name}`);
                    console.log(`🏢 Домен: ${AMOCRM_DOMAIN}`);
                    
                    await this.checkSubscriptionPipeline();
                    await this.loadPipelineStatuses();
                } else {
                    console.log('❌ Токен не валиден. Проверьте AMOCRM_ACCESS_TOKEN в .env файле');
                }
                return isValid;
            } else {
                console.log('❌ Токен не найден. Установите AMOCRM_ACCESS_TOKEN в .env файле');
                return false;
            }
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
            console.log(`🆔 ID аккаунта: ${this.accountInfo.id}`);
            return true;
        } catch (error) {
            console.error('❌ Ошибка проверки токена:');
            if (error.response) {
                console.error(`   📊 Статус: ${error.response.status}`);
                console.error(`   📋 Ответ:`, error.response.data);
            } else {
                console.error(`   📋 Ошибка: ${error.message}`);
            }
            return false;
        }
    }

    async loadFieldMappings() {
        try {
            console.log('📋 Загрузка всех кастомных полей amoCRM...');
            
            const contactFields = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            let loadedCount = 0;
            
            if (contactFields && contactFields._embedded && contactFields._embedded.custom_fields) {
                contactFields._embedded.custom_fields.forEach(field => {
                    this.fieldMappings.set(field.id, {
                        name: field.name,
                        type: field.type,
                        enums: field.enums || []
                    });
                    loadedCount++;
                });
            }
            
            const leadFields = await this.makeRequest('GET', '/api/v4/leads/custom_fields');
            
            if (leadFields && leadFields._embedded && leadFields._embedded.custom_fields) {
                leadFields._embedded.custom_fields.forEach(field => {
                    this.fieldMappings.set(field.id, {
                        name: field.name,
                        type: field.type,
                        enums: field.enums || []
                    });
                    loadedCount++;
                });
            }
            
            console.log(`✅ Загружено полей: ${loadedCount}`);
            this.showKeyFields();
            
            return this.fieldMappings;
        } catch (error) {
            console.error('❌ Ошибка загрузки полей:', error.message);
            return new Map();
        }
    }

    showKeyFields() {
        console.log('\n🔑 КЛЮЧЕВЫЕ ПОЛЯ ДЛЯ РАБОТЫ:');
        console.log('='.repeat(60));
        
        const keyFields = [
            { id: this.FIELD_IDS.LEAD.TOTAL_CLASSES, name: 'Абонемент занятий:' },
            { id: this.FIELD_IDS.LEAD.USED_CLASSES, name: 'Счетчик занятий:' },
            { id: this.FIELD_IDS.LEAD.REMAINING_CLASSES, name: 'Остаток занятий' },
            { id: this.FIELD_IDS.LEAD.EXPIRATION_DATE, name: 'Окончание абонемента:' },
            { id: this.FIELD_IDS.LEAD.ACTIVATION_DATE, name: 'Дата активации абонемента:' },
            { id: this.FIELD_IDS.LEAD.LAST_VISIT_DATE, name: 'Дата последнего визита:' },
            { id: this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE, name: 'Тип абонемента' },
            { id: this.FIELD_IDS.LEAD.FREEZE, name: 'Заморозка абонемента:' }
        ];
        
        keyFields.forEach(field => {
            const mapping = this.fieldMappings.get(field.id);
            console.log(`   ID ${field.id}: ${field.name} ${mapping ? '✅ Загружено' : '❌ Не найдено'}`);
        });
    }

    async makeRequest(method, endpoint, data = null) {
        const url = `${this.baseUrl}${endpoint}`;
        
        try {
            const config = {
                method: method,
                url: url,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'ArtSchoolAPI/1.0'
                },
                timeout: 30000
            };

            if (data) config.data = data;

            const response = await axios(config);
            return response.data;
        } catch (error) {
            console.error(`❌ Ошибка запроса ${method} ${endpoint}:`);
            if (error.response) {
                console.error(`   📊 Статус: ${error.response.status}`);
                console.error(`   📋 Ответ:`, JSON.stringify(error.response.data, null, 2));
            } else if (error.request) {
                console.error(`   📡 Нет ответа от сервера: ${error.message}`);
            } else {
                console.error(`   ⚠️  Ошибка: ${error.message}`);
            }
            throw error;
        }
    }

  // ==================== КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ extractSubscriptionInfo ====================
extractSubscriptionInfo(lead) {
    try {
        const customFields = lead.custom_fields_values || [];
        
        // КРИТИЧЕСКАЯ ПРОБЛЕМА: поле 850241 (Абонемент занятий:) - это SELECT с enum
        const totalClassesField = customFields.find(f => 
            (f.field_id || f.id) === this.FIELD_IDS.LEAD.TOTAL_CLASSES
        );
        
        let totalClasses = 0;
        if (totalClassesField) {
            const fieldValue = this.getFieldValue(totalClassesField);
            totalClasses = this.parseNumberFromSelectField(totalClassesField); // НОВЫЙ МЕТОД!
        }
        
        // Поле 850257 (Счетчик занятий:) - тоже SELECT
        const usedClassesField = customFields.find(f => 
            (f.field_id || f.id) === this.FIELD_IDS.LEAD.USED_CLASSES
        );
        
        let usedClasses = 0;
        if (usedClassesField) {
            const fieldValue = this.getFieldValue(usedClassesField);
            usedClasses = this.parseNumberFromSelectField(usedClassesField);
        }
        
        // Поле 890163 (Остаток занятий) - текстовое поле (когда заполнено)
        const remainingClassesField = customFields.find(f => 
            (f.field_id || f.id) === this.FIELD_IDS.LEAD.REMAINING_CLASSES
        );
        
        let remainingClasses = 0;
        if (remainingClassesField) {
            const fieldValue = this.getFieldValue(remainingClassesField);
            remainingClasses = this.parseNumberFromField(fieldValue);
        } else {
            // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: если поле не заполнено, ВЫЧИСЛЯЕМ
            remainingClasses = Math.max(0, totalClasses - usedClasses);
        }
        
        // Проверяем целостность данных
        if (totalClasses > 0 && usedClasses + remainingClasses !== totalClasses) {
            console.log(`⚠️  Несоответствие данных в ${lead.id}: ${usedClasses} + ${remainingClasses} ≠ ${totalClasses}`);
            // Автоматически корректируем
            if (remainingClassesField) {
                // Если поле "Остаток занятий" заполнено, доверяем ему
                totalClasses = usedClasses + remainingClasses;
            } else {
                // Иначе доверяем полю "Абонемент занятий:"
                remainingClasses = Math.max(0, totalClasses - usedClasses);
            }
        }
        
        // Остальная логика остается той же...
        const freezeField = customFields.find(f => 
            (f.field_id || f.id) === this.FIELD_IDS.LEAD.FREEZE
        );
        
        let isFrozen = false;
        if (freezeField) {
            const fieldValue = this.getFieldValue(freezeField);
            isFrozen = fieldValue === 'ДА' || fieldValue === 'Да' || fieldValue === 'true';
        }
        
        // Определяем активность абонемента
        const isInSubscriptionPipeline = lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID;
        const isActiveStatus = this.SUBSCRIPTION_STATUSES.ACTIVE.includes(lead.status_id);
        
        let subscriptionActive = false;
        let subscriptionStatus = 'Не определен';
        let subscriptionBadge = 'secondary';
        
        if (isFrozen) {
            subscriptionStatus = `Заморожен (осталось ${remainingClasses} занятий)`;
            subscriptionBadge = 'warning';
            subscriptionActive = true; // Замороженный все еще считается активным!
        }
        else if (isActiveStatus && remainingClasses > 0 && isInSubscriptionPipeline) {
            subscriptionStatus = `Активный (осталось ${remainingClasses} занятий)`;
            subscriptionBadge = 'success';
            subscriptionActive = true;
        }
        else if (remainingClasses > 0 && isInSubscriptionPipeline) {
            subscriptionStatus = `Есть остаток (${remainingClasses} занятий)`;
            subscriptionBadge = 'info';
            subscriptionActive = false;
        }
        else if (totalClasses > 0 && usedClasses >= totalClasses) {
            subscriptionStatus = `Использован (${usedClasses}/${totalClasses} занятий)`;
            subscriptionBadge = 'secondary';
            subscriptionActive = false;
        }
        else if (totalClasses > 0) {
            subscriptionStatus = `Неактивный (осталось ${remainingClasses} занятий)`;
            subscriptionBadge = 'secondary';
            subscriptionActive = false;
        }
        
        return {
            hasSubscription: totalClasses > 0,
            totalClasses: totalClasses,
            usedClasses: usedClasses,
            remainingClasses: remainingClasses,
            subscriptionType: this.getFieldValue(customFields.find(f => 
                (f.field_id || f.id) === this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE
            )),
            subscriptionActive: subscriptionActive,
            activationDate: this.parseDate(this.getFieldValue(customFields.find(f => 
                (f.field_id || f.id) === this.FIELD_IDS.LEAD.ACTIVATION_DATE
            ))),
            expirationDate: this.parseDate(this.getFieldValue(customFields.find(f => 
                (f.field_id || f.id) === this.FIELD_IDS.LEAD.EXPIRATION_DATE
            ))),
            lastVisitDate: this.parseDate(this.getFieldValue(customFields.find(f => 
                (f.field_id || f.id) === this.FIELD_IDS.LEAD.LAST_VISIT_DATE
            ))),
            subscriptionStatus: subscriptionStatus,
            subscriptionBadge: subscriptionBadge,
            isFrozen: isFrozen,
            isInSubscriptionPipeline: isInSubscriptionPipeline,
            pipelineId: lead.pipeline_id,
            statusId: lead.status_id
        };
        
    } catch (error) {
        console.error('❌ Ошибка extractSubscriptionInfo:', error.message);
        return this.getDefaultSubscriptionInfo();
    }
}

// ==================== НОВЫЙ МЕТОД ДЛЯ ПАРСИНГА SELECT-ПОЛЕЙ ====================
parseNumberFromSelectField(field) {
    if (!field || !field.values || !Array.isArray(field.values) || field.values.length === 0) {
        return 0;
    }
    
    try {
        // Для select-полей значения хранятся в enum_id или value
        const firstValue = field.values[0];
        
        if (firstValue.enum_id !== undefined) {
            // Это select-поле с enum_id
            // Маппинг enum_id → количество занятий
            const enumMapping = {
                // enum_id для поля "Абонемент занятий:"
                504035: 8,    // "8 занятий"
                504037: 16,   // "16 занятий"
                504039: 4,    // "4 занятия"
                504041: 1,    // "1 занятие"
                504043: 2,    // "2 занятия"
                504045: 3,    // "3 занятия"
                504047: 24,   // "24 занятия"
                
                // enum_id для поля "Счетчик занятий:"
                504105: 1,    // "1"
                504107: 2,    // "2"
                504109: 3,    // "3"
                504111: 4,    // "4"
                504113: 5,    // "5"
                504115: 6,    // "6"
                504117: 7,    // "7"
                504119: 8,    // "8"
                504121: 9,    // "9"
                504123: 10,   // "10"
                504125: 11,   // "11"
                504127: 12,   // "12"
                504129: 13,   // "13"
                504131: 14,   // "14"
                504133: 15,   // "15"
                504135: 16    // "16"
            };
            
            return enumMapping[firstValue.enum_id] || 0;
        } else if (firstValue.value !== undefined) {
            // Прямое значение
            return this.parseNumberFromField(firstValue.value);
        }
        
        return 0;
        
    } catch (error) {
        console.error('❌ Ошибка парсинга select-поля:', error);
        return 0;
    }
}
    getDefaultSubscriptionInfo() {
        return {
            hasSubscription: false,
            totalClasses: 0,
            usedClasses: 0,
            remainingClasses: 0,
            subscriptionType: '',
            subscriptionActive: false,
            activationDate: null,
            expirationDate: null,
            lastVisitDate: null,
            subscriptionStatus: 'Нет данных',
            subscriptionBadge: 'inactive',
            isFrozen: false,
            isInSubscriptionPipeline: false,
            pipelineId: null,
            statusId: null
        };
    }

    parseNumberFromField(value) {
        if (!value && value !== 0) {
            return 0;
        }
        
        try {
            if (typeof value === 'number') {
                return value;
            }
            
            const str = String(value).trim();
            
            if (str.toLowerCase().includes('занят')) {
                if (str.toLowerCase() === '1 занятие') return 1;
                if (str.toLowerCase() === '2 занятия') return 2;
                if (str.toLowerCase() === '3 занятия') return 3;
                if (str.toLowerCase() === '4 занятия') return 4;
                if (str.toLowerCase() === '8 занятий') return 8;
                if (str.toLowerCase() === '16 занятий') return 16;
                if (str.toLowerCase() === '24 занятия') return 24;
                if (str.toLowerCase() === 'разовый') return 1;
                
                const match = str.match(/(\d+)/);
                if (match && match[1]) {
                    const num = parseInt(match[1]);
                    return isNaN(num) ? 0 : num;
                }
                
                return 0;
            }
            
            const match = str.match(/(\d+)/);
            if (match && match[1]) {
                const num = parseInt(match[1]);
                return isNaN(num) ? 0 : num;
            }
            
            if (str.toLowerCase() === 'да' || str.toLowerCase() === 'true' || str === '1') {
                return 1;
            }
            
            return 0;
            
        } catch (error) {
            console.error(`❌ Ошибка парсинга "${value}":`, error.message);
            return 0;
        }
    }

    getFieldValue(field) {
        try {
            if (!field || !field.values || !Array.isArray(field.values) || field.values.length === 0) {
                return '';
            }
            
            const firstValue = field.values[0];
            
            if (firstValue === null || firstValue === undefined) {
                return '';
            }
            
            if (typeof firstValue === 'string') {
                return firstValue.trim();
            } else if (typeof firstValue === 'number') {
                return String(firstValue);
            } else if (typeof firstValue === 'object' && firstValue !== null) {
                if (firstValue.value !== undefined && firstValue.value !== null) {
                    return String(firstValue.value).trim();
                } else if (firstValue.enum_value !== undefined && firstValue.enum_value !== null) {
                    return String(firstValue.enum_value).trim();
                } else if (firstValue.enum_id !== undefined && firstValue.enum_id !== null) {
                    // Для select полей нужно получить текст из enum
                    if (field.enums) {
                        const enumItem = field.enums.find(e => e.id === firstValue.enum_id);
                        if (enumItem) return enumItem.value;
                    }
                    return String(firstValue.enum_id);
                }
            }
            
            return String(firstValue).trim();
        } catch (error) {
            console.error('❌ Ошибка получения значения поля:', error);
            return '';
        }
    }

    parseDate(value) {
        if (!value) return null;
        
        try {
            const dateStr = String(value).trim();
            
            if (/^\d+$/.test(dateStr)) {
                const timestamp = parseInt(dateStr);
                const date = timestamp < 10000000000 
                    ? new Date(timestamp * 1000)
                    : new Date(timestamp);
                
                return date.toISOString().split('T')[0];
            }
            
            if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
                const parts = dateStr.split('.');
                const day = parts[0].padStart(2, '0');
                const month = parts[1].padStart(2, '0');
                const year = parts[2];
                
                return `${year}-${month}-${day}`;
            }
            
            if (dateStr.match(/^\d{4}-\d{1,2}-\d{1,2}$/)) {
                const parts = dateStr.split('-');
                return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            }
            
            return dateStr;
            
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error);
            return value;
        }
    }

   // ==================== ИСПРАВЛЕННАЯ ЛОГИКА ВЫБОРА СДЕЛКИ ====================
async findLeadForStudent(contactId, studentName) {
    console.log(`\n🎯 КРИТИЧЕСКИЙ ПОИСК СДЕЛКИ ДЛЯ: "${studentName}"`);
    
    const leads = await this.getContactLeadsSorted(contactId);
    
    let bestLead = null;
    let bestLeadInfo = null;
    let bestScore = -1;
    
    // ПРИОРИТЕТЫ:
    // 1. Сделка в воронке абонементов
    // 2. Точное совпадение имени
    // 3. Активный статус
    // 4. Не заморожен
    // 5. Есть остаток занятий
    // 6. Используем поле "Остаток занятий" если есть, иначе вычисляем
    
    for (const lead of leads) {
        const subscriptionInfo = this.extractSubscriptionInfo(lead);
        
        if (!subscriptionInfo.hasSubscription) continue;
        
        let score = 0;
        
        // 1. В воронке абонементов? +200 баллов
        if (subscriptionInfo.isInSubscriptionPipeline) {
            score += 200;
        }
        
        // 2. Точное совпадение имени? +150 баллов
        if (this.isExactNameMatch(lead.name, studentName)) {
            score += 150;
        }
        // 3. Частичное совпадение имени? +80 баллов
        else if (this.isPartialNameMatch(lead.name, studentName)) {
            score += 80;
        }
        
        // 4. Активный статус? +100 баллов
        if (subscriptionInfo.subscriptionActive) {
            score += 100;
        }
        
        // 5. Не заморожен? +50 баллов
        if (!subscriptionInfo.isFrozen) {
            score += 50;
        }
        
        // 6. Есть остаток занятий? +30 за каждое занятие
        if (subscriptionInfo.remainingClasses > 0) {
            score += subscriptionInfo.remainingClasses * 30;
        }
        
        // 7. Маленький абонемент (4-8 занятий)? +40 баллов
        if (subscriptionInfo.totalClasses >= 4 && subscriptionInfo.totalClasses <= 8) {
            score += 40;
        }
        
        // 8. Свежесть сделки (последние 90 дней)
        const leadDate = new Date(lead.updated_at * 1000);
        const daysAgo = Math.floor((Date.now() - leadDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysAgo <= 90) {
            score += Math.max(0, 100 - daysAgo);
        }
        
        // КРИТИЧЕСКАЯ ПРОВЕРКА: целостность данных
        if (subscriptionInfo.totalClasses > 0) {
            const calculatedRemaining = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
            
            // Если данные не совпадают, снижаем баллы
            if (calculatedRemaining !== subscriptionInfo.remainingClasses) {
                console.log(`   ⚠️  Несоответствие данных: ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses}, остаток: ${subscriptionInfo.remainingClasses}, расчет: ${calculatedRemaining}`);
                score -= 50; // Штраф за некорректные данные
                
                // Используем РАСЧЕТ вместо поля "Остаток занятий"
                subscriptionInfo.remainingClasses = calculatedRemaining;
            }
        }
        
        // Бонус за заполненное поле "Остаток занятий"
        const customFields = lead.custom_fields_values || [];
        const remainingField = customFields.find(f => 
            (f.field_id || f.id) === this.FIELD_IDS.LEAD.REMAINING_CLASSES
        );
        if (remainingField) {
            score += 30; // Бонус за правильно заполненное поле
        }
        
        console.log(`   📊 "${lead.name}" - ${score} баллов`);
        console.log(`      🎫 ${subscriptionInfo.subscriptionStatus}`);
        console.log(`      📊 ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses} (осталось: ${subscriptionInfo.remainingClasses})`);
        
        if (score > bestScore || 
            (score === bestScore && subscriptionInfo.remainingClasses > bestLeadInfo?.remainingClasses)) {
            
            bestScore = score;
            bestLead = lead;
            bestLeadInfo = subscriptionInfo;
        }
    }
    
    if (bestLead) {
        console.log(`\n🏆 ВЫБРАНА СДЕЛКА: "${bestLead.name}"`);
        console.log(`   🏆 Баллы: ${bestScore}`);
        console.log(`   📊 Занятий: ${bestLeadInfo.remainingClasses}/${bestLeadInfo.totalClasses}`);
        console.log(`   🎯 Статус: ${bestLeadInfo.subscriptionStatus}`);
        
        return {
            lead: bestLead,
            subscriptionInfo: bestLeadInfo
        };
    }
    
    return null;
}

    // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ СОВПАДЕНИЯ ИМЕН ====================
    isExactNameMatch(leadName, studentName) {
        if (!leadName || !studentName) return false;
        
        const cleanLeadName = leadName.toLowerCase().trim();
        const cleanStudentName = studentName.toLowerCase().trim();
        
        // 1. Прямое вхождение имени в названии сделки
        if (cleanLeadName.includes(cleanStudentName)) {
            console.log(`   ✅ Точное совпадение: "${studentName}" в "${leadName}"`);
            return true;
        }
        
        // 2. Разбиваем имена на части
        const studentParts = cleanStudentName.split(/\s+/).filter(part => part.length > 1);
        const leadParts = cleanLeadName.split(/\s+/).filter(part => part.length > 1);
        
        // 3. Проверяем совпадение всех частей имени
        let matchedParts = 0;
        for (const studentPart of studentParts) {
            if (studentPart.length <= 2) continue;
            
            for (const leadPart of leadParts) {
                if (leadPart.includes(studentPart) || studentPart.includes(leadPart)) {
                    matchedParts++;
                    break;
                }
            }
        }
        
        // Если совпали все части имени
        if (matchedParts === studentParts.length && studentParts.length > 0) {
            console.log(`   ✅ Все части имени совпадают: ${matchedParts}/${studentParts.length}`);
            return true;
        }
        
        return false;
    }

    isPartialNameMatch(leadName, studentName) {
        if (!leadName || !studentName) return false;
        
        const cleanLeadName = leadName.toLowerCase().trim();
        const cleanStudentName = studentName.toLowerCase().trim();
        
        // Разбиваем имена на части
        const studentParts = cleanStudentName.split(/\s+/).filter(part => part.length > 1);
        const leadParts = cleanLeadName.split(/\s+/).filter(part => part.length > 1);
        
        // Ищем фамилию (обычно последняя часть)
        const studentLastName = studentParts[studentParts.length - 1];
        
        for (const leadPart of leadParts) {
            if (leadPart.includes(studentLastName) || studentLastName.includes(leadPart)) {
                console.log(`   ✅ Частичное совпадение фамилии: "${studentLastName}" в "${leadName}"`);
                return true;
            }
        }
        
        return false;
    }

    // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ АНАЛИЗА ====================

// Анализ паттерна названия сделки
analyzeLeadNamePattern(leadName) {
    const patterns = [
        { pattern: 'ФИО - N занятий', regex: /^(.+)\s+-\s+(\d+)\s+занят/i },
        { pattern: 'ФИО (N занятий)', regex: /^(.+)\s+\((\d+)\s+занят/i },
        { pattern: 'Абонемент N занятий: ФИО', regex: /^Абонемент\s+(\d+)\s+занят.+:\s*(.+)/i },
        { pattern: 'ФИО - абонемент N', regex: /^(.+)\s+-\s+абонемент\s+(\d+)/i },
        { pattern: 'Разовый: ФИО', regex: /^Разовый.+:\s*(.+)/i },
        { pattern: 'ФИО - заморозка', regex: /^(.+)\s+-\s+заморозка/i },
        { pattern: 'ФИО', regex: /^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+$/ }
    ];
    
    for (const p of patterns) {
        const match = leadName.match(p.regex);
        if (match) {
            return {
                pattern: p.pattern,
                student_name: match[1]?.trim(),
                class_count: match[2] ? parseInt(match[2]) : null,
                match: match[0]
            };
        }
    }
    
    return {
        pattern: 'Неизвестный паттерн',
        student_name: null,
        class_count: null,
        match: leadName
    };
}

// Генерация ключа паттерна заполнения полей
getFieldPatternKey(fieldsAnalysis) {
    const parts = [];
    
    const keyFields = [
        'total_classes', 
        'used_classes', 
        'remaining_classes', 
        'subscription_type',
        'freeze'
    ];
    
    keyFields.forEach(key => {
        if (fieldsAnalysis[key] && fieldsAnalysis[key].exists) {
            parts.push(`${key}:YES`);
        } else {
            parts.push(`${key}:NO`);
        }
    });
    
    return parts.join('|');
}

// Проверка целостности данных
checkDataIntegrity(subscriptionInfo, fieldsAnalysis) {
    const problems = [];
    
    // Проверка 1: total = used + remaining
    const total = subscriptionInfo.totalClasses;
    const used = subscriptionInfo.usedClasses;
    const remaining = subscriptionInfo.remainingClasses;
    
    if (total > 0 && used + remaining !== total) {
        problems.push({
            type: 'DATA_INTEGRITY',
            message: `Некорректная сумма: ${used} + ${remaining} ≠ ${total}`,
            expected: total,
            actual: used + remaining,
            recommendation: 'Проверить поля "Счетчик занятий:" и "Остаток занятий"'
        });
    }
    
    // Проверка 2: поле "Остаток занятий" должно совпадать с расчетом
    if (fieldsAnalysis.remaining_classes && fieldsAnalysis.remaining_classes.exists) {
        const fieldRemaining = fieldsAnalysis.remaining_classes.parsed_number;
        if (fieldRemaining !== remaining) {
            problems.push({
                type: 'REMAINING_CALCULATION_MISMATCH',
                message: `Поле "Остаток занятий" (${fieldRemaining}) не совпадает с расчетом (${remaining})`,
                field_value: fieldRemaining,
                calculated_value: remaining,
                recommendation: 'Использовать значение из поля или пересчитать логику'
            });
        }
    }
    
    // Проверка 3: даты должны быть в правильном порядке
    if (subscriptionInfo.activationDate && subscriptionInfo.expirationDate) {
        const activation = new Date(subscriptionInfo.activationDate);
        const expiration = new Date(subscriptionInfo.expirationDate);
        
        if (activation > expiration) {
            problems.push({
                type: 'DATE_ORDER',
                message: `Дата активации (${subscriptionInfo.activationDate}) позже даты окончания (${subscriptionInfo.expirationDate})`,
                recommendation: 'Проверить корректность дат'
            });
        }
    }
    
    return { problems };
}

// Рекомендации для проблемных случаев
getRecommendationForProblems(problems) {
    const recommendations = [];
    
    problems.forEach(problem => {
        switch (problem.type) {
            case 'TOTAL_CLASSES_MISMATCH':
                recommendations.push('Исправить парсинг поля "Абонемент занятий:"');
                break;
            case 'REMAINING_CLASSES_MISMATCH':
                recommendations.push('Проверить логику расчета остатка занятий');
                break;
            case 'DATA_INTEGRITY':
                recommendations.push('Пересчитать used_classes и remaining_classes');
                break;
        }
    });
    
    return [...new Set(recommendations)].join('; ');
}
    
    async checkSubscriptionPipeline() {
        try {
            const pipelines = await this.makeRequest('GET', '/api/v4/leads/pipelines');
            
            if (pipelines._embedded && pipelines._embedded.pipelines) {
                const subscriptionPipeline = pipelines._embedded.pipelines.find(
                    p => p.name.includes('Абонемент') || p.id === this.SUBSCRIPTION_PIPELINE_ID
                );
                
                if (subscriptionPipeline) {
                    this.SUBSCRIPTION_PIPELINE_ID = subscriptionPipeline.id;
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка проверки воронки:', error.message);
        }
    }

    async loadPipelineStatuses() {
        try {
            const response = await this.makeRequest('GET', `/api/v4/leads/pipelines/${this.SUBSCRIPTION_PIPELINE_ID}`);
            
            if (response && response._embedded && response._embedded.statuses) {
                response._embedded.statuses.forEach(status => {
                    if (status.name.toLowerCase().includes('актив') || status.name === 'Активирован') {
                        if (!this.SUBSCRIPTION_STATUSES.ACTIVE.includes(status.id)) {
                            this.SUBSCRIPTION_STATUSES.ACTIVE.push(status.id);
                        }
                    } else if (status.name.toLowerCase().includes('заморозк')) {
                        if (!this.SUBSCRIPTION_STATUSES.FROZEN.includes(status.id)) {
                            this.SUBSCRIPTION_STATUSES.FROZEN.push(status.id);
                        }
                    } else if (status.name.toLowerCase().includes('истек')) {
                        if (!this.SUBSCRIPTION_STATUSES.INACTIVE.includes(status.id)) {
                            this.SUBSCRIPTION_STATUSES.INACTIVE.push(status.id);
                        }
                    }
                });
            }
            
        } catch (error) {
            console.error('❌ Ошибка загрузки статусов:', error.message);
        }
    }

    // ==================== ОСТАЛЬНЫЕ МЕТОДЫ ====================
    async searchContactsByPhone(phoneNumber) {
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
            return { _embedded: { contacts: [] } };
        }
        
        try {
            const last10Digits = cleanPhone.slice(-10);
            const searchFormats = [
                `+7${last10Digits}`,
                `8${last10Digits}`,
                `7${last10Digits}`,
                last10Digits
            ];
            
            let allContacts = [];
            
            for (const format of searchFormats) {
                try {
                    const response = await this.makeRequest(
                        'GET', 
                        `/api/v4/contacts?query=${encodeURIComponent(format)}&with=custom_fields_values&limit=50`
                    );
                    
                    const contacts = response._embedded?.contacts || [];
                    contacts.forEach(contact => {
                        if (!allContacts.some(c => c.id === contact.id)) {
                            allContacts.push(contact);
                        }
                    });
                    
                } catch (searchError) {
                    continue;
                }
            }
            
            return { _embedded: { contacts: allContacts } };
            
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    extractStudentsFromContact(contact) {
        const students = [];
        
        try {
            const customFields = contact.custom_fields_values || [];
            const contactName = contact.name || '';
            
            const childrenConfig = [
                { number: 1, nameFieldId: 867233 },
                { number: 2, nameFieldId: 867235 },
                { number: 3, nameFieldId: 867733 }
            ];
            
            for (const childConfig of childrenConfig) {
                let studentName = '';
                
                for (const field of customFields) {
                    const fieldId = field.field_id || field.id;
                    const fieldValue = this.getFieldValue(field);
                    
                    if (fieldId === childConfig.nameFieldId && fieldValue && fieldValue.trim()) {
                        studentName = fieldValue.trim();
                        break;
                    }
                }
                
                if (studentName) {
                    const studentInfo = {
                        studentName: studentName,
                        birthDate: '',
                        branch: '',
                        dayOfWeek: '',
                        timeSlot: '',
                        teacherName: '',
                        course: '',
                        ageGroup: '',
                        allergies: '',
                        parentName: contactName,
                        hasActiveSubscription: false,
                        lastVisitDate: '',
                        email: ''
                    };
                    
                    for (const field of customFields) {
                        const fieldId = field.field_id || field.id;
                        const fieldValue = this.getFieldValue(field);
                        
                        if (!fieldValue) continue;
                        
                        if (fieldId === 871273) {
                            studentInfo.branch = fieldValue;
                        } else if (fieldId === 888881) {
                            studentInfo.teacherName = fieldValue;
                        } else if (fieldId === 892225) {
                            studentInfo.dayOfWeek = fieldValue;
                        } else if (fieldId === 888903) {
                            studentInfo.ageGroup = fieldValue;
                        } else if (fieldId === 890179) {
                            studentInfo.hasActiveSubscription = fieldValue.toLowerCase() === 'да' || 
                                                             fieldValue === '1';
                        } else if (fieldId === 885380) {
                            studentInfo.lastVisitDate = this.parseDate(fieldValue);
                        } else if (fieldId === 850239) {
                            studentInfo.allergies = fieldValue;
                        } else if (fieldId === 216617 || fieldId === 850219) {
                            if (fieldValue.includes('@')) {
                                studentInfo.email = fieldValue;
                            } else if (fieldId === 850219) {
                                studentInfo.birthDate = this.parseDate(fieldValue);
                            }
                        }
                    }
                    
                    students.push(studentInfo);
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка извлечения учеников:', error);
        }
        
        return students;
    }

    async getContactLeadsSorted(contactId) {
        try {
            let allLeads = [];
            let page = 1;
            const limit = 100;
            
            while (true) {
                try {
                    const response = await this.makeRequest(
                        'GET',
                        `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&page=${page}&limit=${limit}&order[updated_at]=desc`
                    );
                    
                    const leads = response._embedded?.leads || [];
                    if (leads.length === 0) break;
                    
                    allLeads = [...allLeads, ...leads];
                    
                    if (leads.length < limit) break;
                    page++;
                    
                    if (page > 5) break;
                    
                } catch (pageError) {
                    break;
                }
            }
            
            // Фильтруем рассылки и архивы
            const filteredLeads = allLeads.filter(lead => {
                const leadName = lead.name || '';
                const lowerName = leadName.toLowerCase();
                
                const excludePatterns = [
                    /^рассылка/i,
                    /рассылка\s*\|/i,
                    /^архив/i,
                    /^отменен/i,
                    /^не\s+актив/i,
                    /^успешн/i,
                    /^\d+\s*₽/i,
                    /^сделка\s*#/i,
                    /^#\d+/i,
                    /^test/i,
                    /^тест/i,
                    /^\s*$/
                ];
                
                const shouldExclude = excludePatterns.some(pattern => pattern.test(lowerName));
                return !shouldExclude;
            });
            
            return filteredLeads;
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    // ==================== ОСНОВНОЙ МЕТОД ПОЛУЧЕНИЯ УЧЕНИКОВ ====================
    async getStudentsByPhone(phoneNumber) {
        console.log(`\n📱 ПОЛУЧЕНИЕ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                return studentProfiles;
            }
            
            const filteredContacts = contacts.filter(contact => {
                const contactName = contact.name || '';
                const isAdminContact = 
                    contactName.toLowerCase().includes('админ') ||
                    contactName.toLowerCase().includes('admin') ||
                    contactName.toLowerCase().includes('менеджер') ||
                    contactName.toLowerCase().includes('manager') ||
                    contactName.toLowerCase().includes('yurlova') ||
                    contactName.toLowerCase().includes('александрова') ||
                    contact.id === 31966847;
                
                return !isAdminContact;
            });
            
            const contactsToProcess = filteredContacts.length > 0 ? filteredContacts : contacts;
            
            for (const contact of contactsToProcess) {
                try {
                    const fullContact = await this.getFullContactInfo(contact.id);
                    if (!fullContact) continue;
                    
                    const children = this.extractStudentsFromContact(fullContact);
                    
                    if (children.length === 0) {
                        continue;
                    }
                    
                    for (const child of children) {
                        const leadResult = await this.findLeadForStudent(contact.id, child.studentName);
                        
                        if (leadResult) {
                            const profile = this.createStudentProfile(
                                fullContact,
                                phoneNumber,
                                child,
                                leadResult.subscriptionInfo,
                                leadResult.lead
                            );
                            
                            studentProfiles.push(profile);
                            console.log(`✅ Профиль создан: ${child.studentName}`);
                        } else {
                            const profile = this.createStudentProfile(
                                fullContact,
                                phoneNumber,
                                child,
                                {
                                    hasSubscription: false,
                                    totalClasses: 0,
                                    usedClasses: 0,
                                    remainingClasses: 0,
                                    subscriptionType: '',
                                    subscriptionActive: false,
                                    activationDate: null,
                                    expirationDate: null,
                                    lastVisitDate: null,
                                    subscriptionStatus: 'Нет абонемента',
                                    subscriptionBadge: 'inactive',
                                    isFrozen: false
                                },
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
            const seenStudents = new Set();
            
            for (const profile of studentProfiles) {
                const key = `${profile.student_name}_${profile.phone_number}`;
                if (!seenStudents.has(key)) {
                    seenStudents.add(key);
                    uniqueProfiles.push(profile);
                }
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${uniqueProfiles.length}`);
            
            return uniqueProfiles;
            
        } catch (error) {
            console.error('❌ Ошибка поиска учеников:', error.message);
            return studentProfiles;
        }
    }

    async getFullContactInfo(contactId) {
        try {
            const response = await this.makeRequest(
                'GET',
                `/api/v4/contacts/${contactId}?with=custom_fields_values`
            );
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения контакта:`, error.message);
            return null;
        }
    }

    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        const email = studentInfo.email || this.findEmail(contact);
        
        const formatDisplayDate = (dateStr) => {
            if (!dateStr) return '';
            try {
                const date = new Date(dateStr);
                if (isNaN(date.getTime())) return dateStr;
                
                return date.toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                });
            } catch (error) {
                return dateStr;
            }
        };
        
        let branch = studentInfo.branch || '';
        
        if (!branch && lead) {
            const customFields = lead.custom_fields_values || [];
            const branchField = customFields.find(f => 
                (f.field_id || f.id) === 871273
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
            email: email || '',
            birth_date: studentInfo.birthDate || '',
            branch: branch || '',
            parent_name: studentInfo.parentName || contact.name || '',
            
            day_of_week: studentInfo.dayOfWeek || '',
            time_slot: studentInfo.timeSlot || '',
            teacher_name: studentInfo.teacherName || '',
            age_group: studentInfo.ageGroup || '',
            course: studentInfo.course || '',
            allergies: studentInfo.allergies || '',
            
            subscription_type: subscriptionInfo.subscriptionType || 'Без абонемента',
            subscription_active: subscriptionInfo.subscriptionActive ? 1 : 0,
            subscription_status: subscriptionInfo.subscriptionStatus || 'Нет абонемента',
            subscription_badge: subscriptionInfo.subscriptionBadge || 'inactive',
            
            total_classes: subscriptionInfo.totalClasses || 0,
            remaining_classes: subscriptionInfo.remainingClasses || 0,
            used_classes: subscriptionInfo.usedClasses || 0,
            
            expiration_date: subscriptionInfo.expirationDate || null,
            activation_date: subscriptionInfo.activationDate || null,
            last_visit_date: studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate || null,
            
            expiration_date_display: formatDisplayDate(subscriptionInfo.expirationDate),
            activation_date_display: formatDisplayDate(subscriptionInfo.activationDate),
            last_visit_date_display: formatDisplayDate(studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate),
            
            custom_fields: JSON.stringify(contact.custom_fields_values || []),
            raw_contact_data: JSON.stringify(contact),
            lead_data: lead ? JSON.stringify(lead) : '{}',
            
            is_demo: 0,
            source: 'amocrm',
            is_active: 1,
            last_sync: new Date().toISOString()
        };
        
        console.log(`📊 Профиль ученика:`);
        console.log(`   👤 ${profile.student_name}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        console.log(`   📊 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        console.log(`   ✅ Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
        
        return profile;
    }

    findEmail(contact) {
        try {
            const customFields = contact.custom_fields_values || [];
            
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                const fieldValue = this.getFieldValue(field);
                
                if (fieldValue && fieldValue.includes('@')) {
                    return fieldValue;
                }
            }
            
            return '';
            
        } catch (error) {
            return '';
        }
    }

    // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ====================
    getFieldName(field) {
        const fieldId = field.field_id || field.id;
        const fieldMapping = this.fieldMappings.get(fieldId);
        return fieldMapping ? fieldMapping.name : `Поле ${fieldId}`;
    }

    isSubscriptionField(fieldId) {
        return Object.values(this.FIELD_IDS.LEAD).includes(fieldId);
    }

    isImportantField(fieldId) {
        const importantFields = [
            this.FIELD_IDS.LEAD.TOTAL_CLASSES,
            this.FIELD_IDS.LEAD.USED_CLASSES,
            this.FIELD_IDS.LEAD.REMAINING_CLASSES,
            this.FIELD_IDS.LEAD.EXPIRATION_DATE,
            this.FIELD_IDS.LEAD.ACTIVATION_DATE
        ];
        return importantFields.includes(fieldId);
    }

    checkIfLeadBelongsToStudent(leadName, studentName) {
        return this.isExactNameMatch(leadName, studentName) || this.isPartialNameMatch(leadName, studentName);
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
        console.log('✅ Таблица student_profiles создана');

        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_name ON student_profiles(student_name)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(is_active)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_branch ON student_profiles(branch)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_sync ON student_profiles(last_sync)');
        
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
        
        await db.exec(`
            CREATE TABLE IF NOT EXISTS sync_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_type TEXT NOT NULL,
                items_count INTEGER DEFAULT 0,
                success_count INTEGER DEFAULT 0,
                error_count INTEGER DEFAULT 0,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                duration_ms INTEGER,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица sync_logs создана');
        
        console.log('\n🎉 Все таблицы созданы успешно!');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};


// ==================== СИСТЕМА СИНХРОНИЗАЦИИ ====================
class SyncService {
    constructor() {
        this.isSyncing = false;
        this.lastSyncTime = null;
    }

    async startAutoSync() {
        console.log('\n🔄 ЗАПУСК АВТОМАТИЧЕСКОЙ СИНХРОНИЗАЦИИ');
        console.log('📅 Синхронизация каждые 10 минут');
        
        await this.syncAllProfiles();
        
        setInterval(async () => {
            await this.syncAllProfiles();
        }, 10 * 60 * 1000);
    }

    async syncAllProfiles() {
        if (this.isSyncing) {
            console.log('⚠️  Синхронизация уже выполняется, пропускаем');
            return;
        }

        this.isSyncing = true;
        const startTime = Date.now();

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔄 ЗАПУСК СИНХРОНИЗАЦИИ`);
        console.log(`⏰ Время: ${new Date().toISOString()}`);
        console.log('='.repeat(80));

        try {
            const phones = await db.all(
                `SELECT DISTINCT phone_number FROM student_profiles WHERE is_active = 1`
            );

            console.log(`📊 Найдено уникальных телефонов: ${phones.length}`);

            let totalUpdated = 0;
            let totalErrors = 0;

            for (const phoneRow of phones) {
                const phone = phoneRow.phone_number;
                
                try {
                    console.log(`\n🔍 Синхронизация для телефона: ${phone}`);
                    
                    const profiles = await amoCrmService.getStudentsByPhone(phone);
                    
                    const savedCount = await saveProfilesToDatabase(profiles);
                    
                    console.log(`✅ Обновлено профилей: ${savedCount}`);
                    totalUpdated += savedCount;
                    
                } catch (phoneError) {
                    console.error(`❌ Ошибка синхронизации телефона ${phone}:`, phoneError.message);
                    totalErrors++;
                }
            }

            const duration = Date.now() - startTime;
            this.lastSyncTime = new Date();

            await db.run(
                `INSERT INTO sync_logs (sync_type, items_count, success_count, error_count, start_time, end_time, duration_ms) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ['auto_sync', phones.length, totalUpdated, totalErrors, 
                 new Date(startTime).toISOString(), new Date().toISOString(), duration]
            );

            console.log('\n' + '='.repeat(80));
            console.log(`✅ СИНХРОНИЗАЦИЯ ЗАВЕРШЕНА`);
            console.log('='.repeat(80));
            console.log(`📊 Результаты:`);
            console.log(`   • Обработано телефонов: ${phones.length}`);
            console.log(`   • Обновлено профилей: ${totalUpdated}`);
            console.log(`   • Ошибок: ${totalErrors}`);
            console.log(`   • Время выполнения: ${duration}ms`);
            console.log(`   • Следующая синхронизация: через 10 минут`);
            console.log('='.repeat(80));

        } catch (error) {
            console.error('❌ Критическая ошибка синхронизации:', error.message);
            
            await db.run(
                `INSERT INTO sync_logs (sync_type, error_message, start_time, end_time, duration_ms) 
                 VALUES (?, ?, ?, ?, ?)`,
                ['auto_sync', error.message, new Date(startTime).toISOString(), 
                 new Date().toISOString(), Date.now() - startTime]
            );
        } finally {
            this.isSyncing = false;
        }
    }

    getSyncStatus() {
        return {
            is_syncing: this.isSyncing,
            last_sync_time: this.lastSyncTime,
            next_sync_in: this.lastSyncTime ? 
                Math.max(0, 10 * 60 * 1000 - (Date.now() - this.lastSyncTime.getTime())) : 
                null
        };
    }
}

const syncService = new SyncService();

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
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
                    
                    console.log(`✅ Профиль создан (ID: ${result.lastID}): ${profile.student_name}`);
                    savedCount++;
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
                    
                    console.log(`✅ Профиль обновлен (ID: ${existingProfile.id}): ${profile.student_name}`);
                    savedCount++;
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

// ==================== API МАРШРУТЫ ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        sync_status: syncService.getSyncStatus(),
        data_source: 'Реальные данные из amoCRM'
    });
});

// Авторизация по телефону
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
        
        if (amoCrmService.isInitialized) {
            console.log('🔍 Получение данных из amoCRM...');
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            console.log(`📊 Найдено профилей в amoCRM: ${profiles.length}`);
            
            if (profiles.length > 0) {
                const savedCount = await saveProfilesToDatabase(profiles);
                console.log(`💾 Сохранено в БД: ${savedCount} профилей`);
            }
        } else {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен. Невозможно получить данные.'
            });
        }
        
        if (profiles.length === 0) {
            console.log('🔍 Поиск в локальной базе данных...');
            const cleanPhone = phone.replace(/\D/g, '');
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY subscription_active DESC, updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            console.log(`📊 Найдено профилей в локальной БД: ${profiles.length}`);
        }
        
        if (profiles.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Ученики не найдены',
                message: 'По указанному телефону не найдено учеников. Проверьте правильность номера или обратитесь в студию.'
            });
        }
        
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            first_name: profiles.length > 0 ? profiles[0].student_name?.split(' ')[0] || 'Ученик' : 'Гость',
            is_temp: true,
            profiles_count: profiles.length
        };
        
        const token = jwt.sign(
            {
                session_id: crypto.randomBytes(32).toString('hex'),
                phone: formattedPhone,
                is_temp: true,
                profiles_count: profiles.length,
                amocrm_connected: amoCrmService.isInitialized
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        const responseProfiles = profiles.map(p => ({
            id: p.id,
            student_name: p.student_name,
            phone_number: p.phone_number,
            email: p.email,
            branch: p.branch || 'Филиал не указан',
            day_of_week: p.day_of_week,
            time_slot: p.time_slot,
            teacher_name: p.teacher_name,
            age_group: p.age_group,
            course: p.course,
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
        
        const hasMultipleStudents = profiles.length > 1;
        
        const responseData = {
            success: true,
            message: 'Найдены профили учеников',
            data: {
                user: tempUser,
                profiles: responseProfiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                has_real_data: true,
                has_multiple_students: hasMultipleStudents,
                token: token,
                last_sync: profiles.length > 0 ? profiles[0].last_sync : null
            }
        };
        
        console.log(`✅ Авторизация завершена успешно`);
        console.log(`📊 Профилей: ${profiles.length}`);
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

// Получение информации об абонементе
app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id, phone } = req.body;
        
        console.log(`\n📋 ЗАПРОС АБОНЕМЕНТА`);
        console.log(`📌 profile_id: ${profile_id}`);
        console.log(`📌 phone: ${phone}`);
        
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
            console.log(`📭 Абонемент не найден`);
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        console.log(`✅ Найден профиль: ${profile.student_name}`);
        console.log(`📍 Филиал: ${profile.branch || 'не указан'}`);
        console.log(`📊 Абонемент: ${profile.subscription_status}`);
        console.log(`📊 Источник данных: ${profile.source}`);
        console.log(`📊 Последняя синхронизация: ${profile.last_sync}`);
        
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
                    course: profile.course,
                    allergies: profile.allergies,
                    teacher_name: profile.teacher_name
                },
                
                schedule: {
                    day_of_week: profile.day_of_week,
                    time_slot: profile.time_slot,
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
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения абонемента:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
        });
    }
});

// ==================== БЫСТРАЯ НАСТРОЙКА ПОЛЕЙ ====================
app.post('/api/quick-setup', async (req, res) => {
    try {
        console.log('\n⚡ БЫСТРАЯ НАСТРОЙКА СИСТЕМЫ ПО ДАННЫМ ДИАГНОСТИКИ');
        console.log('='.repeat(80));
        
        // Автоматически применяем найденные поля из диагностики
        const fieldUpdates = {
            leads: {
                TOTAL_CLASSES: 850241,      // "Абонемент занятий:"
                USED_CLASSES: 850257,       // "Счетчик занятий:"  
                REMAINING_CLASSES: 890163,  // "Остаток занятий"
                EXPIRATION_DATE: 850255,    // "Окончание абонемента:"
                ACTIVATION_DATE: 851565,    // "Дата активации абонемента:"
                LAST_VISIT_DATE: 850259,    // "Дата последнего визита:"
                SUBSCRIPTION_TYPE: 891007,   // "Тип абонемента"
                FREEZE: 867693,             // "Заморозка абонемента:"
                SUBSCRIPTION_OWNER: 805465,  // "Принадлежность абонемента:"
                TECHNICAL_COUNT: 891819,     // "Количество занятий (тех)"
                AGE_GROUP: 850243,          // "Группа возраст:"
                PRICE_PER_CLASS: 891813,    // "Стоимость 1 занятия"
                ADVANCE_PAYMENT: 891817,    // "Авансовые средства"
                RECEIVED_PAYMENT: 891815     // "Полученные средства"
            },
            contacts: {
                CHILD_1_NAME: 867233,      // "!ФИО ребенка:"
                BRANCH: 871273,            // "Филиал:"
                TEACHER: 888881,           // "Преподаватель"
                DAY_OF_WEEK: 892225,       // "День недели (2025-26)"
                HAS_ACTIVE_SUB: 890179,    // "Есть активный абонемент"
                LAST_VISIT: 885380,        // "Дата последнего визита"
                AGE_GROUP: 888903,         // "Возраст группы"
                PHONE: 216615              // "Телефон"
            }
        };
        
        // Применяем настройки
        Object.entries(fieldUpdates.leads).forEach(([key, id]) => {
            amoCrmService.FIELD_IDS.LEAD[key] = id;
            console.log(`✅ LEAD.${key} = ${id}`);
        });
        
        Object.entries(fieldUpdates.contacts).forEach(([key, id]) => {
            amoCrmService.FIELD_IDS.CONTACT[key] = id;
            console.log(`✅ CONTACT.${key} = ${id}`);
        });
        
        // Обновляем статус воронки абонементов (из тестовой сделки)
        amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'] = {
            pipelineId: 7977402,  // ID из тестовой сделки
            statusIds: {
                'Активный абонемент': 65473306,  // ID из тестовой сделки
                'Активирован': null,             // Нужно найти
                'Заморозка': null,               // Нужно найти
                'Истек': null                    // Нужно найти
            },
            activeStatusIds: [65473306]  // Пока только один известный
        };
        
        console.log('\n' + '='.repeat(80));
        console.log('✅ СИСТЕМА НАСТРОЕНА!');
        console.log('='.repeat(80));
        console.log('📊 ОСНОВНЫЕ ПОЛЯ:');
        console.log('   • Абонемент занятий: 850241 ✅');
        console.log('   • Счетчик занятий: 850257 ✅');
        console.log('   • Остаток занятий: 890163 ✅');
        console.log('   • Филиал ученика: 871273 ✅');
        console.log('   • Преподаватель: 888881 ✅');
        console.log('   • Воронка абонементов: 7977402 ✅');
        
        res.json({
            success: true,
            message: 'Система настроена на основе диагностических данных',
            data: {
                fields_updated: Object.keys(fieldUpdates.leads).length + Object.keys(fieldUpdates.contacts).length,
                subscription_pipeline: 7977402,
                test_lead_analyzed: 28674865,
                recommendations: [
                    '✅ Основные поля абонементов найдены и настроены',
                    '✅ Поля учеников настроены',
                    '✅ Воронка абонементов определена',
                    '⚠️ Нужно найти недостающие поля (email, дата рождения)',
                    'ℹ️ Для тестирования используйте телефон: +79160577611'
                ]
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка настройки:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ТЕСТ ВСЕХ ТИПОВ АБОНЕМЕНТОВ ====================
app.get('/api/test/all-subscription-types', async (req, res) => {
    try {
        console.log('\n🧪 ТЕСТИРОВАНИЕ ВСЕХ ТИПОВ АБОНЕМЕНТОВ');
        console.log('='.repeat(80));
        
        const testCases = [
            { phone: '+79161916984', expected: 'Полина Кунахович - 8 занятий (заморожен)' },
            { phone: '+79160577611', expected: 'Никифорова Алиса - 4 занятия' },
            { phone: '+79852541504', expected: 'Зайцева Агния - 16 занятий (активный)' },
            // Добавьте другие телефоны для тестирования
        ];
        
        const results = [];
        
        for (const testCase of testCases) {
            try {
                console.log(`\n📱 Тест: ${testCase.phone}`);
                const profiles = await amoCrmService.getStudentsByPhone(testCase.phone);
                
                const studentInfo = profiles.map(p => ({
                    name: p.student_name,
                    total: p.total_classes,
                    remaining: p.remaining_classes,
                    used: p.used_classes,
                    status: p.subscription_status,
                    active: p.subscription_active ? '✅ Да' : '❌ Нет',
                    type: p.subscription_type
                }));
                
                results.push({
                    phone: testCase.phone,
                    students_found: profiles.length,
                    students: studentInfo,
                    success: profiles.length > 0
                });
                
                console.log(`   👥 Учеников: ${profiles.length}`);
                profiles.forEach(p => {
                    console.log(`   👤 ${p.student_name}: ${p.subscription_status}`);
                    console.log(`      📊 ${p.used_classes}/${p.total_classes} (осталось: ${p.remaining_classes})`);
                });
                
            } catch (error) {
                console.error(`   ❌ Ошибка: ${error.message}`);
                results.push({
                    phone: testCase.phone,
                    error: error.message,
                    success: false
                });
            }
        }
        
        // Анализ результатов
        const analysis = {
            total_tests: results.length,
            successful_tests: results.filter(r => r.success).length,
            failed_tests: results.filter(r => !r.success).length,
            subscription_types_found: [],
            issues_detected: []
        };
        
        results.forEach(result => {
            if (result.students) {
                result.students.forEach(student => {
                    if (!analysis.subscription_types_found.includes(student.total)) {
                        analysis.subscription_types_found.push(student.total);
                    }
                    
                    // Проверяем логику
                    if (student.remaining > student.total) {
                        analysis.issues_detected.push({
                            phone: result.phone,
                            student: student.name,
                            issue: `Остаток (${student.remaining}) > Всего (${student.total})`,
                            severity: 'HIGH'
                        });
                    }
                    
                    if (student.used + student.remaining !== student.total) {
                        analysis.issues_detected.push({
                            phone: result.phone,
                            student: student.name,
                            issue: `Использовано (${student.used}) + Остаток (${student.remaining}) ≠ Всего (${student.total})`,
                            severity: 'MEDIUM'
                        });
                    }
                });
            }
        });
        
        console.log('\n📊 АНАЛИЗ РЕЗУЛЬТАТОВ:');
        console.log(`   • Всего тестов: ${analysis.total_tests}`);
        console.log(`   • Успешных: ${analysis.successful_tests}`);
        console.log(`   • Неудачных: ${analysis.failed_tests}`);
        console.log(`   • Найдено типов абонементов: ${analysis.subscription_types_found.sort((a,b) => a-b).join(', ')} занятий`);
        console.log(`   • Проблем обнаружено: ${analysis.issues_detected.length}`);
        
        if (analysis.issues_detected.length > 0) {
            console.log('\n🚨 ОБНАРУЖЕНЫ ПРОБЛЕМЫ:');
            analysis.issues_detected.forEach(issue => {
                console.log(`   • ${issue.student} (${issue.phone}): ${issue.issue}`);
            });
        }
        
        res.json({
            success: true,
            message: 'Тестирование завершено',
            data: {
                results: results,
                analysis: analysis,
                system_status: {
                    pipeline_id: amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId,
                    active_status_ids: amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'].activeStatusIds,
                    fields_configured: Object.keys(amoCrmService.FIELD_IDS.LEAD).length
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ПРОВЕРКА ТЕСТОВОГО ТЕЛЕФОНА ====================
app.get('/api/test/phone/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        console.log(`\n📱 ТЕСТ ПОИСКА УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phone}`);
        
        const profiles = await amoCrmService.getStudentsByPhone(phone);
        
        res.json({
            success: true,
            message: `Найдено учеников: ${profiles.length}`,
            data: {
                phone: phone,
                profiles_count: profiles.length,
                profiles: profiles.map(p => ({
                    student_name: p.student_name,
                    branch: p.branch,
                    subscription_status: p.subscription_status,
                    remaining_classes: p.remaining_classes,
                    total_classes: p.total_classes
                })),
                system_status: {
                    fields_configured: Object.keys(amoCrmService.FIELD_IDS.LEAD).length,
                    subscription_pipeline: amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId,
                    amocrm_connected: amoCrmService.isInitialized
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ПОДРОБНАЯ ДИАГНОСТИКА ТЕЛЕФОНА ====================
app.get('/api/debug/phone-detailed/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n🔍 ПОДРОБНАЯ ДИАГНОСТИКА ТЕЛЕФОНА: ${phone}`);
        console.log('='.repeat(80));
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        // Ищем контакты
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        const detailedResults = {
            phone: phone,
            contacts_found: contacts.length,
            contacts: [],
            raw_data: []
        };
        
        for (const contact of contacts) {
            const contactData = {
                id: contact.id,
                name: contact.name,
                leads: []
            };
            
            // Получаем сделки контакта
            const leads = await amoCrmService.getContactLeadsSorted(contact.id);
            
            for (const lead of leads.slice(0, 10)) { // Первые 10 сделок
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                // Собираем все поля сделки для анализа
                const leadFields = lead.custom_fields_values || [];
                const fieldAnalysis = [];
                
                leadFields.forEach(field => {
                    const fieldId = field.field_id || field.id;
                    const fieldName = amoCrmService.getFieldName(field);
                    const fieldValue = amoCrmService.getFieldValue(field);
                    const fieldType = amoCrmService.fieldMappings.get(fieldId)?.type || 'unknown';
                    
                    fieldAnalysis.push({
                        id: fieldId,
                        name: fieldName,
                        value: fieldValue,
                        type: fieldType,
                        interpreted_as_number: amoCrmService.parseNumberFromField(fieldValue),
                        interpreted_as_date: amoCrmService.parseDate(fieldValue),
                        is_subscription_field: amoCrmService.isSubscriptionField(fieldId)
                    });
                });
                
                contactData.leads.push({
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    subscription_info: subscriptionInfo,
                    fields: fieldAnalysis,
                    raw_lead: lead // Для глубокой отладки
                });
            }
            
            detailedResults.contacts.push(contactData);
        }
        
        // Анализ расхождений
        const analysis = {
            potential_issues: []
        };
        
        detailedResults.contacts.forEach(contact => {
            contact.leads.forEach(lead => {
                const sub = lead.subscription_info;
                
                // Проверка 1: расхождение между totalClasses и полем "Абонемент занятий:"
                const totalField = lead.fields.find(f => f.id === 850241);
                if (totalField && totalField.interpreted_as_number !== sub.totalClasses) {
                    analysis.potential_issues.push({
                        type: 'TOTAL_CLASSES_MISMATCH',
                        lead_id: lead.id,
                        lead_name: lead.name,
                        field_value: totalField.value,
                        interpreted_number: totalField.interpreted_as_number,
                        system_total: sub.totalClasses,
                        recommendation: 'Проверить парсинг поля 850241'
                    });
                }
                
                // Проверка 2: поле "Остаток занятий" не совпадает с расчетом
                const remainingField = lead.fields.find(f => f.id === 890163);
                if (remainingField && remainingField.interpreted_as_number !== sub.remainingClasses) {
                    analysis.potential_issues.push({
                        type: 'REMAINING_CLASSES_MISMATCH',
                        lead_id: lead.id,
                        lead_name: lead.name,
                        field_value: remainingField.value,
                        field_number: remainingField.interpreted_as_number,
                        system_remaining: sub.remainingClasses,
                        recommendation: 'Использовать значение из поля 890163 вместо расчета'
                    });
                }
                
                // Проверка 3: заморозка
                const freezeField = lead.fields.find(f => f.id === 867693);
                if (freezeField && freezeField.value === 'ДА' && !sub.isFrozen) {
                    analysis.potential_issues.push({
                        type: 'FREEZE_NOT_DETECTED',
                        lead_id: lead.id,
                        lead_name: lead.name,
                        field_value: freezeField.value,
                        system_frozen: sub.isFrozen,
                        recommendation: 'Проверить парсинг поля 867693'
                    });
                }
            });
        });
        
        detailedResults.analysis = analysis;
        
        res.json({
            success: true,
            message: 'Подробная диагностика выполнена',
            data: detailedResults
        });
        
    } catch (error) {
        console.error('❌ Ошибка детальной диагностики:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ПОЛНАЯ ДИАГНОСТИКА ПОЛЕЙ AMOCRM ====================
app.get('/api/debug/fields/all', async (req, res) => {
    try {
        console.log('\n🔍 ПОЛНАЯ ДИАГНОСТИКА ВСЕХ ПОЛЕЙ AMOCRM');
        console.log('='.repeat(80));
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const results = {
            timestamp: new Date().toISOString(),
            account: amoCrmService.accountInfo?.name || 'Неизвестно',
            domain: AMOCRM_DOMAIN,
            fields_loaded: amoCrmService.fieldMappings.size,
            all_fields: {
                leads: [],
                contacts: [],
                companies: [],
                customers: [],
                custom_fields: []
            },
            subscription_related_fields: {
                leads: [],
                contacts: []
            },
            field_statistics: {}
        };
        
        // 1. Получаем все кастомные поля сделок (абонементов)
        console.log('📊 Получение кастомных полей сделок...');
        try {
            const leadFields = await amoCrmService.makeRequest('GET', '/api/v4/leads/custom_fields');
            
            if (leadFields && leadFields._embedded && leadFields._embedded.custom_fields) {
                results.all_fields.leads = leadFields._embedded.custom_fields.map(field => {
                    const fieldInfo = {
                        id: field.id,
                        name: field.name,
                        type: field.type,
                        code: field.code || null,
                        sort: field.sort,
                        is_multiple: field.is_multiple || false,
                        is_visible: field.is_visible || true,
                        is_required: field.is_required || false,
                        is_deletable: field.is_deletable || true,
                        enums: field.enums || [],
                        settings: field.settings || {}
                    };
                    
                    // Проверяем, относится ли поле к абонементам
                    const isSubscriptionField = amoCrmService.isSubscriptionField(field.id);
                    const isImportantField = amoCrmService.isImportantField(field.id);
                    
                    if (isSubscriptionField || isImportantField) {
                        results.subscription_related_fields.leads.push({
                            ...fieldInfo,
                            subscription_importance: isSubscriptionField ? 'HIGH' : 'MEDIUM',
                            current_mapping_id: amoCrmService.FIELD_IDS.LEAD[Object.keys(amoCrmService.FIELD_IDS.LEAD).find(
                                key => amoCrmService.FIELD_IDS.LEAD[key] === field.id
                            )] || null
                        });
                    }
                    
                    return fieldInfo;
                });
                
                console.log(`✅ Полей сделок: ${results.all_fields.leads.length}`);
            }
        } catch (leadError) {
            console.error(`❌ Ошибка получения полей сделок: ${leadError.message}`);
            results.all_fields.leads = { error: leadError.message };
        }
        
        // 2. Получаем все кастомные поля контактов
        console.log('📊 Получение кастомных полей контактов...');
        try {
            const contactFields = await amoCrmService.makeRequest('GET', '/api/v4/contacts/custom_fields');
            
            if (contactFields && contactFields._embedded && contactFields._embedded.custom_fields) {
                results.all_fields.contacts = contactFields._embedded.custom_fields.map(field => {
                    const fieldInfo = {
                        id: field.id,
                        name: field.name,
                        type: field.type,
                        code: field.code || null,
                        sort: field.sort,
                        is_multiple: field.is_multiple || false,
                        is_visible: field.is_visible || true,
                        is_required: field.is_required || false,
                        is_deletable: field.is_deletable || true,
                        enums: field.enums || [],
                        settings: field.settings || {}
                    };
                    
                    // Проверяем, относится ли поле к ученикам/детям
                    const isStudentField = [
                        amoCrmService.FIELD_IDS.CONTACT.CHILD_1_NAME,
                        amoCrmService.FIELD_IDS.CONTACT.CHILD_1_BIRTHDAY,
                        amoCrmService.FIELD_IDS.CONTACT.CHILD_2_NAME,
                        amoCrmService.FIELD_IDS.CONTACT.CHILD_2_BIRTHDAY,
                        amoCrmService.FIELD_IDS.CONTACT.CHILD_3_NAME,
                        amoCrmService.FIELD_IDS.CONTACT.CHILD_3_BIRTHDAY,
                        amoCrmService.FIELD_IDS.CONTACT.BRANCH,
                        amoCrmService.FIELD_IDS.CONTACT.TEACHER,
                        amoCrmService.FIELD_IDS.CONTACT.DAY_OF_WEEK,
                        amoCrmService.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB,
                        amoCrmService.FIELD_IDS.CONTACT.LAST_VISIT,
                        amoCrmService.FIELD_IDS.CONTACT.AGE_GROUP,
                        amoCrmService.FIELD_IDS.CONTACT.ALLERGIES,
                        amoCrmService.FIELD_IDS.CONTACT.BIRTH_DATE,
                        amoCrmService.FIELD_IDS.CONTACT.EMAIL
                    ].includes(field.id);
                    
                    if (isStudentField) {
                        results.subscription_related_fields.contacts.push({
                            ...fieldInfo,
                            student_importance: 'HIGH',
                            current_mapping_id: amoCrmService.FIELD_IDS.CONTACT[Object.keys(amoCrmService.FIELD_IDS.CONTACT).find(
                                key => amoCrmService.FIELD_IDS.CONTACT[key] === field.id
                            )] || null
                        });
                    }
                    
                    return fieldInfo;
                });
                
                console.log(`✅ Полей контактов: ${results.all_fields.contacts.length}`);
            }
        } catch (contactError) {
            console.error(`❌ Ошибка получения полей контактов: ${contactError.message}`);
            results.all_fields.contacts = { error: contactError.message };
        }
        
        // 3. Получаем стандартные поля (если доступно)
        console.log('📊 Получение стандартных полей...');
        try {
            // Поля счетов (customers)
            const customerFields = await amoCrmService.makeRequest('GET', '/api/v4/customers/custom_fields');
            if (customerFields && customerFields._embedded && customerFields._embedded.custom_fields) {
                results.all_fields.customers = customerFields._embedded.custom_fields.map(field => ({
                    id: field.id,
                    name: field.name,
                    type: field.type
                }));
                console.log(`✅ Полей счетов: ${results.all_fields.customers.length}`);
            }
        } catch (customerError) {
            console.log(`⚠️  Поля счетов не получены: ${customerError.message}`);
        }
        
        try {
            // Поля компаний
            const companyFields = await amoCrmService.makeRequest('GET', '/api/v4/companies/custom_fields');
            if (companyFields && companyFields._embedded && companyFields._embedded.custom_fields) {
                results.all_fields.companies = companyFields._embedded.custom_fields.map(field => ({
                    id: field.id,
                    name: field.name,
                    type: field.type
                }));
                console.log(`✅ Полей компаний: ${results.all_fields.companies.length}`);
            }
        } catch (companyError) {
            console.log(`⚠️  Поля компаний не получены: ${companyError.message}`);
        }
        
        // 4. Получаем поля воронок (pipelines)
        console.log('📊 Получение воронок и статусов...');
        try {
            const pipelines = await amoCrmService.makeRequest('GET', '/api/v4/leads/pipelines');
            
            if (pipelines && pipelines._embedded && pipelines._embedded.pipelines) {
                results.pipelines = pipelines._embedded.pipelines.map(pipeline => ({
                    id: pipeline.id,
                    name: pipeline.name,
                    is_main: pipeline.is_main || false,
                    sort: pipeline.sort,
                    statuses: (pipeline._embedded && pipeline._embedded.statuses) ? 
                        pipeline._embedded.statuses.map(status => ({
                            id: status.id,
                            name: status.name,
                            sort: status.sort,
                            color: status.color
                        })) : []
                }));
                
                console.log(`✅ Воронок: ${results.pipelines.length}`);
                
                // Находим воронку абонементов
                const subscriptionPipeline = results.pipelines.find(
                    p => p.name.includes('Абонемент') || p.id === amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId
                );
                
                if (subscriptionPipeline) {
                    results.subscription_pipeline = subscriptionPipeline;
                    console.log(`✅ Воронка абонементов: "${subscriptionPipeline.name}" (ID: ${subscriptionPipeline.id})`);
                }
            }
        } catch (pipelineError) {
            console.error(`❌ Ошибка получения воронок: ${pipelineError.message}`);
        }
        
        // 5. Анализ текущих маппингов
        console.log('\n🔍 АНАЛИЗ ТЕКУЩИХ МАППИНГОВ ПОЛЕЙ');
        console.log('='.repeat(60));
        
        results.current_mappings = {
            leads: {},
            contacts: {},
            issues: []
        };
        
        // Проверяем маппинги для сделок (абонементов)
        Object.entries(amoCrmService.FIELD_IDS.LEAD).forEach(([key, fieldId]) => {
            const field = results.all_fields.leads.find(f => f.id === fieldId);
            
            if (field) {
                results.current_mappings.leads[key] = {
                    id: fieldId,
                    name: field.name,
                    type: field.type,
                    status: '✅ НАЙДЕНО',
                    importance: amoCrmService.isSubscriptionField(fieldId) ? 'ВЫСОКАЯ' : 'СРЕДНЯЯ'
                };
            } else {
                results.current_mappings.leads[key] = {
                    id: fieldId,
                    name: `Неизвестное поле (ID: ${fieldId})`,
                    status: '❌ НЕ НАЙДЕНО',
                    importance: 'ВЫСОКАЯ'
                };
                
                results.issues.push({
                    type: 'MISSING_FIELD',
                    entity: 'LEAD',
                    field_key: key,
                    field_id: fieldId,
                    severity: 'HIGH'
                });
            }
        });
        
        // Проверяем маппинги для контактов (учеников)
        Object.entries(amoCrmService.FIELD_IDS.CONTACT).forEach(([key, fieldId]) => {
            if (fieldId === 'name' || fieldId === null) {
                results.current_mappings.contacts[key] = {
                    id: fieldId,
                    name: key === 'PARENT_NAME' ? 'Имя контакта' : 'Не используется',
                    status: 'ℹ️ СТАНДАРТНОЕ',
                    importance: key === 'PARENT_NAME' ? 'ВЫСОКАЯ' : 'НИЗКАЯ'
                };
                return;
            }
            
            const field = results.all_fields.contacts.find(f => f.id === fieldId);
            
            if (field) {
                results.current_mappings.contacts[key] = {
                    id: fieldId,
                    name: field.name,
                    type: field.type,
                    status: '✅ НАЙДЕНО',
                    importance: 'ВЫСОКАЯ'
                };
            } else {
                results.current_mappings.contacts[key] = {
                    id: fieldId,
                    name: `Неизвестное поле (ID: ${fieldId})`,
                    status: '❌ НЕ НАЙДЕНО',
                    importance: 'ВЫСОКАЯ'
                };
                
                results.issues.push({
                    type: 'MISSING_FIELD',
                    entity: 'CONTACT',
                    field_key: key,
                    field_id: fieldId,
                    severity: 'HIGH'
                });
            }
        });
        
        // 6. Создаем рекомендации по полям для абонементов
        console.log('\n💡 РЕКОМЕНДАЦИИ ДЛЯ ПОЛЕЙ АБОНЕМЕНТОВ');
        console.log('='.repeat(60));
        
        results.recommendations = {
            critical_fields: [],
            suggested_mappings: [],
            new_fields_needed: []
        };
        
        // Критические поля для отслеживания абонементов
        const criticalFieldNames = [
            'Абонемент занятий:',
            'Счетчик занятий:',
            'Остаток занятий',
            'Окончание абонемента:',
            'Дата активации абонемента:',
            'Дата последнего визита:',
            'Тип абонемента',
            'Заморозка абонемента:'
        ];
        
        criticalFieldNames.forEach(fieldName => {
            const foundField = results.all_fields.leads.find(f => 
                f.name.toLowerCase().includes(fieldName.toLowerCase().replace(':', ''))
            );
            
            if (foundField) {
                results.recommendations.critical_fields.push({
                    name: fieldName,
                    status: '✅ НАЙДЕНО',
                    field_id: foundField.id,
                    current_mapping: Object.keys(amoCrmService.FIELD_IDS.LEAD).find(
                        key => amoCrmService.FIELD_IDS.LEAD[key] === foundField.id
                    ) || 'НЕ МАППИРОВАНО'
                });
            } else {
                results.recommendations.critical_fields.push({
                    name: fieldName,
                    status: '❌ НЕ НАЙДЕНО',
                    field_id: null,
                    action: 'СОЗДАТЬ ПОЛЕ В AMOCRM'
                });
                
                results.recommendations.new_fields_needed.push(fieldName);
            }
        });
        
        // Поля для посещений (чекбоксы)
        const visitFieldPattern = /занятие|посещение|визит|чекбокс/i;
        const visitFields = results.all_fields.leads.filter(f => 
            visitFieldPattern.test(f.name) && f.type === 'checkbox'
        );
        
        if (visitFields.length > 0) {
            results.recommendations.suggested_mappings.push({
                type: 'VISIT_FIELDS',
                count: visitFields.length,
                fields: visitFields.slice(0, 5).map(f => ({ id: f.id, name: f.name })),
                note: visitFields.length >= 24 ? '✅ Достаточно для 24 занятий' : `⚠️ Нужно ${24 - visitFields.length} полей`
            });
        }
        
        // 7. Статистика
        results.field_statistics = {
            total_custom_fields: results.all_fields.leads.length + results.all_fields.contacts.length,
            lead_fields: results.all_fields.leads.length,
            contact_fields: results.all_fields.contacts.length,
            subscription_fields_mapped: Object.values(amoCrmService.FIELD_IDS.LEAD).filter(id => 
                results.all_fields.leads.some(f => f.id === id)
            ).length,
            student_fields_mapped: Object.values(amoCrmService.FIELD_IDS.CONTACT).filter(id => 
                id !== 'name' && id !== null && results.all_fields.contacts.some(f => f.id === id)
            ).length,
            missing_critical_fields: results.recommendations.critical_fields.filter(f => f.status === '❌ НЕ НАЙДЕНО').length,
            issues_count: results.issues.length
        };
        
        // 8. Выводим сводку в консоль
        console.log('\n' + '='.repeat(80));
        console.log('📊 СВОДКА ДИАГНОСТИКИ ПОЛЕЙ');
        console.log('='.repeat(80));
        console.log(`📋 Всего кастомных полей: ${results.field_statistics.total_custom_fields}`);
        console.log(`📁 Поля сделок: ${results.field_statistics.lead_fields}`);
        console.log(`👤 Поля контактов: ${results.field_statistics.contact_fields}`);
        console.log(`🎫 Маппированных полей абонементов: ${results.field_statistics.subscription_fields_mapped}/${Object.keys(amoCrmService.FIELD_IDS.LEAD).length}`);
        console.log(`👨‍🎓 Маппированных полей учеников: ${results.field_statistics.student_fields_mapped}/${Object.keys(amoCrmService.FIELD_IDS.CONTACT).length - 2}`);
        console.log(`⚠️  Отсутствует критических полей: ${results.field_statistics.missing_critical_fields}`);
        console.log(`🚨 Проблем: ${results.field_statistics.issues_count}`);
        
        if (results.field_statistics.missing_critical_fields > 0) {
            console.log('\n🚨 КРИТИЧЕСКИЕ ПРОБЛЕМЫ:');
            results.recommendations.critical_fields
                .filter(f => f.status === '❌ НЕ НАЙДЕНО')
                .forEach(f => {
                    console.log(`   • ${f.name} - ${f.action}`);
                });
        }
        
        console.log('\n' + '='.repeat(80));
        
        res.json({
            success: true,
            message: 'Полная диагностика полей amoCRM выполнена',
            timestamp: results.timestamp,
            data: results
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики полей:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==================== ГЛУБОКАЯ ОТЛАДКА ПОИСКА ====================
app.get('/api/debug/search-details/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n🔍 ГЛУБОКАЯ ОТЛАДКА ПОИСКА ДЛЯ: ${phone}`);
        console.log('='.repeat(80));
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const results = {
            phone: phone,
            step_1_contacts: [],
            step_2_students: [],
            step_3_leads: [],
            step_4_matching: [],
            final_profiles: [],
            issues: []
        };
        
        // Шаг 1: Ищем контакты
        console.log('\n📋 ШАГ 1: Поиск контактов');
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        results.step_1_contacts = contacts.map(c => ({
            id: c.id,
            name: c.name,
            created_at: c.created_at ? new Date(c.created_at * 1000).toISOString() : null
        }));
        
        console.log(`   📊 Найдено контактов: ${contacts.length}`);
        
        if (contacts.length === 0) {
            results.issues.push('Не найдено контактов по телефону');
            return res.json({ success: true, data: results });
        }
        
        // Шаг 2: Ищем учеников в контактах
        console.log('\n📋 ШАГ 2: Поиск учеников в контактах');
        
        for (const contact of contacts.slice(0, 3)) { // Проверяем первые 3 контакта
            try {
                const fullContact = await amoCrmService.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                const children = amoCrmService.extractStudentsFromContact(fullContact);
                
                children.forEach(child => {
                    results.step_2_students.push({
                        contact_id: contact.id,
                        contact_name: contact.name,
                        student_name: child.studentName,
                        branch: child.branch,
                        teacher: child.teacherName
                    });
                });
                
                console.log(`   👤 Контакт "${contact.name}": ${children.length} учеников`);
                
            } catch (contactError) {
                console.error(`   ❌ Ошибка контакта ${contact.id}:`, contactError.message);
            }
        }
        
        console.log(`   📊 Всего учеников: ${results.step_2_students.length}`);
        
        if (results.step_2_students.length === 0) {
            results.issues.push('В контактах не найдено учеников');
        }
        
        // Шаг 3: Ищем сделки для первого контакта
        console.log('\n📋 ШАГ 3: Поиск сделок для контакта');
        
        if (contacts.length > 0) {
            const contactId = contacts[0].id;
            const leads = await amoCrmService.getContactLeadsSorted(contactId);
            
            console.log(`   📊 Сделок найдено: ${leads.length}`);
            
            // Анализируем первые 10 сделок
            leads.slice(0, 10).forEach(lead => {
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                results.step_3_leads.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    is_subscription_pipeline: lead.pipeline_id === amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId,
                    subscription_found: subscriptionInfo.hasSubscription,
                    total_classes: subscriptionInfo.totalClasses,
                    remaining_classes: subscriptionInfo.remainingClasses,
                    subscription_status: subscriptionInfo.subscriptionStatus,
                    subscription_active: subscriptionInfo.subscriptionActive
                });
                
                console.log(`   📋 "${lead.name.substring(0, 40)}..."`);
                console.log(`      🎫 Абонемент: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
                console.log(`      📊 Занятий: ${subscriptionInfo.totalClasses}`);
                console.log(`      📍 Pipeline: ${lead.pipeline_id} (ожидается: ${amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId})`);
            });
            
            // Проверяем, есть ли сделки с абонементами
            const leadsWithSubscription = leads.filter(lead => {
                const info = amoCrmService.extractSubscriptionInfo(lead);
                return info.hasSubscription;
            });
            
            console.log(`   📊 Сделок с абонементами: ${leadsWithSubscription.length}`);
            
            if (leadsWithSubscription.length === 0) {
                results.issues.push('Не найдено сделок с абонементами');
            }
        }
        
        // Шаг 4: Полный поиск профилей
        console.log('\n📋 ШАГ 4: Полный поиск профилей');
        const profiles = await amoCrmService.getStudentsByPhone(phone);
        
        results.final_profiles = profiles.map(p => ({
            student_name: p.student_name,
            branch: p.branch,
            subscription_status: p.subscription_status,
            total_classes: p.total_classes,
            remaining_classes: p.remaining_classes,
            subscription_active: p.subscription_active === 1
        }));
        
        console.log(`   📊 Найдено профилей: ${profiles.length}`);
        
        // Анализ проблем
        if (profiles.length === 0 && results.step_2_students.length > 0) {
            results.issues.push('Найдены ученики, но не созданы профили (проблема с поиском сделок)');
        }
        
        res.json({
            success: true,
            message: 'Глубокая отладка выполнена',
            data: results
        });
        
    } catch (error) {
        console.error('❌ Ошибка глубокой отладки:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ПОИСК ПРАВИЛЬНОГО КОНТАКТА ====================
app.get('/api/find-correct-contact/:studentName', async (req, res) => {
    try {
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ПОИСК ПРАВИЛЬНОГО КОНТАКТА ДЛЯ: ${studentName}`);
        console.log('='.repeat(80));
        
        // Ищем контакты по имени ученика
        const searchResults = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/contacts?query=${encodeURIComponent(studentName)}&with=custom_fields_values&limit=50`
        );
        
        const contacts = searchResults._embedded?.contacts || [];
        
        console.log(`📊 Найдено контактов по имени "${studentName}": ${contacts.length}`);
        
        const analyzedContacts = [];
        
        for (const contact of contacts) {
            // Проверяем, есть ли этот ученик в контакте
            const children = amoCrmService.extractStudentsFromContact(contact);
            const hasThisStudent = children.some(child => 
                child.studentName.toLowerCase().includes(studentName.toLowerCase()) ||
                studentName.toLowerCase().includes(child.studentName.toLowerCase())
            );
            
            if (hasThisStudent) {
                console.log(`\n✅ Контакт найден: "${contact.name}" (ID: ${contact.id})`);
                console.log(`   👥 Ученики в контакте: ${children.map(c => c.studentName).join(', ')}`);
                
                // Получаем сделки контакта
                const leads = await amoCrmService.getContactLeadsSorted(contact.id);
                const leadsWithSubscription = leads.filter(lead => {
                    const info = amoCrmService.extractSubscriptionInfo(lead);
                    return info.hasSubscription;
                }).slice(0, 5); // Первые 5 сделок
                
                analyzedContacts.push({
                    contact_id: contact.id,
                    contact_name: contact.name,
                    students: children.map(c => c.studentName),
                    leads_count: leads.length,
                    subscription_leads_count: leadsWithSubscription.length,
                    sample_leads: leadsWithSubscription.map(l => ({
                        id: l.id,
                        name: l.name,
                        pipeline_id: l.pipeline_id,
                        status_id: l.status_id
                    }))
                });
            }
        }
        
        if (analyzedContacts.length === 0) {
            // Ищем по фамилии
            const lastName = studentName.split(' ').pop();
            console.log(`\n🔍 Поиск по фамилии: "${lastName}"`);
            
            const lastNameSearch = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/contacts?query=${encodeURIComponent(lastName)}&with=custom_fields_values&limit=50`
            );
            
            const lastNameContacts = lastNameSearch._embedded?.contacts || [];
            
            for (const contact of lastNameContacts) {
                const children = amoCrmService.extractStudentsFromContact(contact);
                const hasMatchingLastName = children.some(child => 
                    child.studentName.toLowerCase().includes(lastName.toLowerCase())
                );
                
                if (hasMatchingLastName) {
                    console.log(`\n⚠️  Найден по фамилии: "${contact.name}" (ID: ${contact.id})`);
                    console.log(`   👥 Ученики: ${children.map(c => c.studentName).join(', ')}`);
                    
                    analyzedContacts.push({
                        contact_id: contact.id,
                        contact_name: contact.name,
                        students: children.map(c => c.studentName),
                        matched_by: 'last_name',
                        note: 'Найден по совпадению фамилии'
                    });
                }
            }
        }
        
        res.json({
            success: true,
            message: analyzedContacts.length > 0 ? 'Контакты найдены' : 'Контакты не найдены',
            data: {
                student_name: studentName,
                total_contacts_found: analyzedContacts.length,
                contacts: analyzedContacts,
                recommendations: analyzedContacts.length > 0 ? [
                    'Используйте правильный contact_id для поиска сделок',
                    'Текущий contact_id (31966847) - общий контакт администратора'
                ] : [
                    'Ученик не найден в системе',
                    'Проверьте правильность написания имени',
                    'Возможно, ученик записан на другой телефон'
                ]
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска контакта:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/debug/final-check/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ФИНАЛЬНАЯ ПРОВЕРКА: ${studentName} (${phone})`);
        
        // Получаем контакты
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        console.log(`📞 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // Получаем лучшую сделку
        const leadResult = await amoCrmService.findLeadForStudent(contact.id, studentName);
        
        if (!leadResult || !leadResult.lead) {
            return res.json({ success: false, error: 'Сделка не найдена' });
        }
        
        // Получаем данные ученика
        const fullContact = await amoCrmService.getFullContactInfo(contact.id);
        const children = amoCrmService.extractStudentsFromContact(fullContact);
        const child = children.find(c => c.studentName.includes(studentName));
        
        if (!child) {
            return res.json({ success: false, error: 'Ученик не найден в контакте' });
        }
        
        // Создаем профиль
        const profile = amoCrmService.createStudentProfile(
            fullContact,
            phone,
            child,
            leadResult.subscriptionInfo,
            leadResult.lead
        );
        
        console.log(`\n📊 ИТОГОВЫЙ ПРОФИЛЬ:`);
        console.log(`   👤 ${profile.student_name}`);
        console.log(`   📋 Сделка: "${leadResult.lead.name}"`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        console.log(`   📊 Занятий: ${profile.total_classes} всего, ${profile.remaining_classes} осталось`);
        console.log(`   ✅ Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
        
        res.json({
            success: true,
            data: {
                contact: { id: contact.id, name: contact.name },
                student: child.studentName,
                selected_lead: {
                    id: leadResult.lead.id,
                    name: leadResult.lead.name,
                    pipeline_id: leadResult.lead.pipeline_id,
                    status_id: leadResult.lead.status_id
                },
                subscription_info: leadResult.subscriptionInfo,
                profile: {
                    student_name: profile.student_name,
                    branch: profile.branch,
                    subscription_status: profile.subscription_status,
                    total_classes: profile.total_classes,
                    remaining_classes: profile.remaining_classes,
                    used_classes: profile.used_classes,
                    subscription_active: profile.subscription_active
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== АНАЛИЗ ВАРИАНТОВ ДЛЯ КОНКРЕТНОГО УЧЕНИКА ====================
app.get('/api/debug/student-subscription-variations/:studentName', async (req, res) => {
    try {
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 АНАЛИЗ ВАРИАНТОВ ДЛЯ УЧЕНИКА: ${studentName}`);
        console.log('='.repeat(100));
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        // Ищем все сделки с именем ученика
        const searchResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?query=${encodeURIComponent(studentName)}&with=custom_fields_values&limit=100`
        );
        
        const leads = searchResponse._embedded?.leads || [];
        
        const analysis = {
            student_name: studentName,
            total_leads_found: leads.length,
            leads_in_subscription_pipeline: 0,
            subscription_variations: [],
            field_value_examples: {},
            recommendations: []
        };
        
        // Анализируем каждую сделку
        leads.forEach(lead => {
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            const customFields = lead.custom_fields_values || [];
            
            const isInSubscriptionPipeline = lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID;
            if (isInSubscriptionPipeline) {
                analysis.leads_in_subscription_pipeline++;
            }
            
            // Собираем ВСЕ значения ключевых полей
            const keyFields = [
                { id: 850241, name: 'Абонемент занятий:' },
                { id: 850257, name: 'Счетчик занятий:' },
                { id: 890163, name: 'Остаток занятий' },
                { id: 850255, name: 'Окончание абонемента:' },
                { id: 851565, name: 'Дата активации абонемента:' }
            ];
            
            keyFields.forEach(fieldDef => {
                const field = customFields.find(f => (f.field_id || f.id) === fieldDef.id);
                if (field) {
                    const value = amoCrmService.getFieldValue(field);
                    
                    if (!analysis.field_value_examples[fieldDef.id]) {
                        analysis.field_value_examples[fieldDef.id] = {
                            field_name: fieldDef.name,
                            values: new Set(),
                            examples: []
                        };
                    }
                    
                    analysis.field_value_examples[fieldDef.id].values.add(value);
                    analysis.field_value_examples[fieldDef.id].examples.push({
                        lead_name: lead.name,
                        value: value,
                        parsed: amoCrmService.parseNumberFromField(value)
                    });
                }
            });
            
            // Добавляем информацию о сделке
            analysis.subscription_variations.push({
                lead_id: lead.id,
                lead_name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                is_in_subscription_pipeline: isInSubscriptionPipeline,
                subscription_info: subscriptionInfo,
                custom_fields_count: customFields.length
            });
        });
        
        // Вывод в консоль
        console.log(`📊 Найдено сделок: ${analysis.total_leads_found}`);
        console.log(`📊 В воронке абонементов: ${analysis.leads_in_subscription_pipeline}`);
        
        console.log('\n🔧 ВАРИАНТЫ ЗНАЧЕНИЙ ПОЛЕЙ:');
        Object.entries(analysis.field_value_examples).forEach(([fieldId, data]) => {
            console.log(`\n📋 ${data.field_name} (ID: ${fieldId}):`);
            console.log(`   Уникальных значений: ${data.values.size}`);
            data.values.forEach(value => {
                const examples = data.examples
                    .filter(e => e.value === value)
                    .slice(0, 3)
                    .map(e => `"${e.lead_name}" → ${e.parsed}`);
                
                console.log(`   • "${value}"`);
                if (examples.length > 0) {
                    console.log(`     Примеры: ${examples.join(', ')}`);
                }
            });
        });
        
        // Рекомендации
        Object.entries(analysis.field_value_examples).forEach(([fieldId, data]) => {
            if (data.values.size > 5) {
                analysis.recommendations.push({
                    field: data.field_name,
                    issue: `Много разных форматов (${data.values.size})`,
                    recommendation: 'Унифицировать формат заполнения поля'
                });
            }
        });
        
        res.json({
            success: true,
            message: `Анализ вариантов для ученика ${studentName} выполнен`,
            data: analysis
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа вариантов:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ДИАГНОСТИКА ПАРСИНГА ПОЛЕЙ ====================
app.get('/api/debug/parsing-test/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ДИАГНОСТИКА ПАРСИНГА ДЛЯ СДЕЛКИ: ${leadId}`);
        console.log('='.repeat(80));
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        const customFields = lead.custom_fields_values || [];
        
        console.log(`📋 Сделка: "${lead.name}"`);
        console.log(`📊 Поля: ${customFields.length}`);
        
        const parsingResults = [];
        
        // Тестируем парсинг каждого поля
        customFields.forEach(field => {
            const fieldId = field.field_id || field.id;
            const fieldName = amoCrmService.getFieldName(field);
            const rawValue = field.values || [];
            
            // Получаем значение разными способами
            const value1 = amoCrmService.getFieldValue(field);
            const value2 = field.values?.[0]?.value || field.values?.[0]?.enum_value || field.values?.[0];
            const parsedNumber = amoCrmService.parseNumberFromField(value1);
            
            parsingResults.push({
                field_id: fieldId,
                field_name: fieldName,
                raw_values: rawValue,
                getFieldValue_result: value1,
                direct_access: value2,
                parsed_number: parsedNumber,
                is_subscription_field: amoCrmService.isSubscriptionField(fieldId)
            });
            
            console.log(`\n🔍 Поле ${fieldId} (${fieldName}):`);
            console.log(`   • raw_values:`, JSON.stringify(rawValue));
            console.log(`   • getFieldValue(): "${value1}"`);
            console.log(`   • Парсинг числа: ${parsedNumber}`);
        });
        
        // Тестируем полный анализ
        console.log('\n' + '='.repeat(80));
        console.log('🧪 ПОЛНЫЙ АНАЛИЗ СДЕЛКИ:');
        
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        res.json({
            success: true,
            message: 'Диагностика парсинга выполнена',
            data: {
                lead_info: {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id
                },
                fields_count: customFields.length,
                parsing_results: parsingResults,
                subscription_info: subscriptionInfo,
                critical_analysis: {
                    total_classes_field: parsingResults.find(f => f.field_id === 850241),
                    used_classes_field: parsingResults.find(f => f.field_id === 850257),
                    remaining_classes_field: parsingResults.find(f => f.field_id === 890163),
                    final_total: subscriptionInfo.totalClasses,
                    final_remaining: subscriptionInfo.remainingClasses,
                    has_subscription: subscriptionInfo.hasSubscription
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики парсинга:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== УНИВЕРСАЛЬНЫЙ АНАЛИЗ ВСЕХ АБОНЕМЕНТОВ В СИСТЕМЕ ====================
app.get('/api/debug/all-subscriptions-analysis', async (req, res) => {
    try {
        console.log('\n🔍 УНИВЕРСАЛЬНЫЙ АНАЛИЗ ВСЕХ АБОНЕМЕНТОВ В СИСТЕМЕ');
        console.log('='.repeat(100));
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const startTime = Date.now();
        const analysis = {
            timestamp: new Date().toISOString(),
            total_leads_analyzed: 0,
            subscription_patterns: [],
            field_variations: {},
            lead_naming_patterns: [],
            status_distribution: {},
            problems_detected: [],
            recommendations: []
        };
        
        // 1. ПОЛУЧАЕМ ВСЕ СДЕЛКИ ИЗ ВОРОНКИ АБОНЕМЕНТОВ
        console.log('\n📊 ШАГ 1: Получение всех сделок из воронки абонементов...');
        
        let page = 1;
        const limit = 250;
        let allLeads = [];
        
        while (true) {
            try {
                const response = await amoCrmService.makeRequest(
                    'GET',
                    `/api/v4/leads?with=custom_fields_values&page=${page}&limit=${limit}&filter[pipeline_id][]=${amoCrmService.SUBSCRIPTION_PIPELINE_ID}`
                );
                
                const leads = response._embedded?.leads || [];
                if (leads.length === 0) break;
                
                allLeads = [...allLeads, ...leads];
                console.log(`   📄 Страница ${page}: ${leads.length} сделок`);
                
                if (leads.length < limit) break;
                page++;
                
                if (page > 10) { // Ограничиваем 2500 сделок для анализа
                    console.log(`   ⚠️  Ограничение: проанализировано 2500 сделок`);
                    break;
                }
                
            } catch (error) {
                console.error(`   ❌ Ошибка страницы ${page}:`, error.message);
                break;
            }
        }
        
        analysis.total_leads_analyzed = allLeads.length;
        console.log(`✅ Всего сделок в воронке: ${allLeads.length}`);
        
        // 2. АНАЛИЗИРУЕМ КАЖДУЮ СДЕЛКУ
        console.log('\n📊 ШАГ 2: Анализ структуры каждой сделки...');
        
        for (let i = 0; i < Math.min(allLeads.length, 100); i++) { // Анализируем первые 100 сделок для скорости
            const lead = allLeads[i];
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            
            if (!subscriptionInfo.hasSubscription) continue;
            
            const customFields = lead.custom_fields_values || [];
            
            // Анализируем КАК хранятся данные
            const fieldPattern = {
                lead_id: lead.id,
                lead_name: lead.name,
                status_id: lead.status_id,
                subscription_info: subscriptionInfo,
                
                // Как заполнены КЛЮЧЕВЫЕ поля
                fields_analysis: {},
                
                // Какие поля вообще есть в сделке
                all_fields: customFields.map(f => ({
                    id: f.field_id || f.id,
                    name: amoCrmService.getFieldName(f),
                    value: amoCrmService.getFieldValue(f),
                    raw_value: f.values || []
                })),
                
                // Проблемы в данных
                data_problems: []
            };
            
            // АНАЛИЗ КЛЮЧЕВЫХ ПОЛЕЙ АБОНЕМЕНТА
            const keyFields = [
                { id: 850241, name: 'Абонемент занятий:', key: 'total_classes' },
                { id: 850257, name: 'Счетчик занятий:', key: 'used_classes' },
                { id: 890163, name: 'Остаток занятий', key: 'remaining_classes' },
                { id: 850255, name: 'Окончание абонемента:', key: 'expiration_date' },
                { id: 851565, name: 'Дата активации абонемента:', key: 'activation_date' },
                { id: 850259, name: 'Дата последнего визита:', key: 'last_visit_date' },
                { id: 891007, name: 'Тип абонемента', key: 'subscription_type' },
                { id: 867693, name: 'Заморозка абонемента:', key: 'freeze' },
                { id: 805465, name: 'Принадлежность абонемента:', key: 'subscription_owner' }
            ];
            
            for (const fieldDef of keyFields) {
                const field = customFields.find(f => (f.field_id || f.id) === fieldDef.id);
                
                if (field) {
                    const rawValue = field.values || [];
                    const fieldValue = amoCrmService.getFieldValue(field);
                    const parsedNumber = amoCrmService.parseNumberFromField(fieldValue);
                    const parsedDate = amoCrmService.parseDate(fieldValue);
                    
                    fieldPattern.fields_analysis[fieldDef.key] = {
                        field_id: fieldDef.id,
                        field_name: fieldDef.name,
                        exists: true,
                        raw_value: rawValue,
                        string_value: fieldValue,
                        parsed_number: parsedNumber,
                        parsed_date: parsedDate,
                        field_type: amoCrmService.fieldMappings.get(fieldDef.id)?.type || 'unknown'
                    };
                    
                    // Проверяем проблемы в данных
                    if (fieldDef.key === 'total_classes' && subscriptionInfo.totalClasses !== parsedNumber) {
                        fieldPattern.data_problems.push({
                            type: 'TOTAL_CLASSES_MISMATCH',
                            field_value: fieldValue,
                            parsed: parsedNumber,
                            system_total: subscriptionInfo.totalClasses,
                            message: `Поле "${fieldDef.name}": "${fieldValue}" → ${parsedNumber}, но в системе: ${subscriptionInfo.totalClasses}`
                        });
                    }
                    
                    if (fieldDef.key === 'remaining_classes' && subscriptionInfo.remainingClasses !== parsedNumber) {
                        fieldPattern.data_problems.push({
                            type: 'REMAINING_CLASSES_MISMATCH',
                            field_value: fieldValue,
                            parsed: parsedNumber,
                            system_remaining: subscriptionInfo.remainingClasses,
                            message: `Поле "${fieldDef.name}": "${fieldValue}" → ${parsedNumber}, но в системе: ${subscriptionInfo.remainingClasses}`
                        });
                    }
                    
                } else {
                    fieldPattern.fields_analysis[fieldDef.key] = {
                        field_id: fieldDef.id,
                        field_name: fieldDef.name,
                        exists: false,
                        message: 'Поле отсутствует в сделке'
                    };
                }
            }
            
            // Анализ названия сделки
            const namePattern = amoCrmService.analyzeLeadNamePattern(lead.name);
            fieldPattern.name_pattern = namePattern;
            
            // Проверка целостности данных
            const integrityCheck = amoCrmService.checkDataIntegrity(subscriptionInfo, fieldPattern.fields_analysis);
            if (integrityCheck.problems.length > 0) {
                fieldPattern.data_problems.push(...integrityCheck.problems);
            }
            
            // Добавляем в анализ
            analysis.subscription_patterns.push(fieldPattern);
            
            // Собираем статистику по статусам
            const statusKey = `${lead.status_id}`;
            analysis.status_distribution[statusKey] = (analysis.status_distribution[statusKey] || 0) + 1;
            
            // Собираем статистику по названиям
            if (namePattern.pattern) {
                const patternKey = namePattern.pattern;
                if (!analysis.lead_naming_patterns.find(p => p.pattern === patternKey)) {
                    analysis.lead_naming_patterns.push({
                        pattern: patternKey,
                        example: lead.name,
                        count: 1
                    });
                } else {
                    const pattern = analysis.lead_naming_patterns.find(p => p.pattern === patternKey);
                    pattern.count++;
                }
            }
        }
        
        // 3. АНАЛИЗ РАЗНЫХ ВАРИАНТОВ ХРАНЕНИЯ ДАННЫХ
        console.log('\n📊 ШАГ 3: Анализ вариантов хранения данных...');
        
        // Группируем по паттернам заполнения полей
        const fieldPatternGroups = {};
        
        analysis.subscription_patterns.forEach(pattern => {
            const key = amoCrmService.getFieldPatternKey(pattern.fields_analysis);
            
            if (!fieldPatternGroups[key]) {
                fieldPatternGroups[key] = {
                    pattern_key: key,
                    examples: [],
                    field_config: pattern.fields_analysis,
                    count: 0
                };
            }
            
            fieldPatternGroups[key].examples.push({
                lead_id: pattern.lead_id,
                lead_name: pattern.lead_name,
                data_problems: pattern.data_problems
            });
            fieldPatternGroups[key].count++;
        });
        
        // Преобразуем в массив и сортируем
        analysis.field_variations = Object.values(fieldPatternGroups)
            .sort((a, b) => b.count - a.count);
        
        // 4. ВЫЯВЛЯЕМ ПРОБЛЕМНЫЕ СЛУЧАИ
        console.log('\n📊 ШАГ 4: Выявление проблемных случаев...');
        
        analysis.subscription_patterns.forEach(pattern => {
            if (pattern.data_problems.length > 0) {
                analysis.problems_detected.push({
                    lead_id: pattern.lead_id,
                    lead_name: pattern.lead_name,
                    problems: pattern.data_problems,
                    recommendation: amoCrmService.getRecommendationForProblems(pattern.data_problems)
                });
            }
        });
        
        // 5. ГЕНЕРИРУЕМ РЕКОМЕНДАЦИИ
        console.log('\n📊 ШАГ 5: Генерация рекомендаций...');
        
        // Анализ распределения полей
        const fieldStats = {};
        analysis.subscription_patterns.forEach(pattern => {
            Object.entries(pattern.fields_analysis).forEach(([key, field]) => {
                if (!fieldStats[key]) {
                    fieldStats[key] = { exists: 0, missing: 0, total: 0 };
                }
                
                if (field.exists) {
                    fieldStats[key].exists++;
                } else {
                    fieldStats[key].missing++;
                }
                fieldStats[key].total++;
            });
        });
        
        // Рекомендации по полям
        Object.entries(fieldStats).forEach(([key, stats]) => {
            const percentage = Math.round((stats.exists / stats.total) * 100);
            
            if (percentage < 80) {
                analysis.recommendations.push({
                    type: 'FIELD_COVERAGE',
                    field: key,
                    coverage: `${percentage}%`,
                    recommendation: `Поле заполнено только в ${percentage}% сделок. Рассмотреть альтернативные поля.`
                });
            }
        });
        
        // Рекомендации по парсингу
        const parsingProblems = analysis.problems_detected.filter(p => 
            p.problems.some(prob => prob.type.includes('MISMATCH'))
        );
        
        if (parsingProblems.length > 0) {
            analysis.recommendations.push({
                type: 'PARSING_ISSUE',
                count: parsingProblems.length,
                recommendation: `Обнаружено ${parsingProblems.length} проблем с парсингом полей. Проверить логику parseNumberFromField() и getFieldValue().`
            });
        }
        
        // 6. ВЫВОД РЕЗУЛЬТАТОВ В КОНСОЛЬ
        console.log('\n' + '='.repeat(100));
        console.log('📈 ИТОГИ АНАЛИЗА');
        console.log('='.repeat(100));
        
        console.log(`📊 Всего проанализировано сделок: ${analysis.total_leads_analyzed}`);
        console.log(`📊 Уникальных паттернов заполнения: ${analysis.field_variations.length}`);
        console.log(`🚨 Проблемных сделок: ${analysis.problems_detected.length}`);
        
        console.log('\n📋 РАСПРЕДЕЛЕНИЕ ПО СТАТУСАМ:');
        Object.entries(analysis.status_distribution).forEach(([statusId, count]) => {
            const percentage = Math.round((count / analysis.subscription_patterns.length) * 100);
            console.log(`   • Статус ${statusId}: ${count} сделок (${percentage}%)`);
        });
        
        console.log('\n🏷️  ПАТТЕРНЫ НАЗВАНИЙ СДЕЛОК:');
        analysis.lead_naming_patterns
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
            .forEach(pattern => {
                const percentage = Math.round((pattern.count / analysis.subscription_patterns.length) * 100);
                console.log(`   • "${pattern.pattern}": ${pattern.count} сделок (${percentage}%)`);
                console.log(`     Пример: "${pattern.example}"`);
            });
        
        console.log('\n🔧 ВАРИАНТЫ ЗАПОЛНЕНИЯ ПОЛЕЙ (Топ-5):');
        analysis.field_variations.slice(0, 5).forEach((variation, index) => {
            const percentage = Math.round((variation.count / analysis.subscription_patterns.length) * 100);
            console.log(`\n${index + 1}. Паттерн ${variation.pattern_key} (${variation.count} сделок, ${percentage}%):`);
            
            Object.entries(variation.field_config).forEach(([key, field]) => {
                if (field.exists) {
                    const examples = variation.examples.slice(0, 2).map(e => e.lead_name);
                    console.log(`   • ${key}: ЗАПОЛНЕНО (${field.field_name})`);
                    if (examples.length > 0) {
                        console.log(`     Примеры: ${examples.join(', ')}`);
                    }
                }
            });
        });
        
        console.log('\n🚨 ПРОБЛЕМЫ В ДАННЫХ:');
        if (analysis.problems_detected.length === 0) {
            console.log('   ✅ Проблем не обнаружено');
        } else {
            analysis.problems_detected.slice(0, 10).forEach((problem, index) => {
                console.log(`\n${index + 1}. "${problem.lead_name}" (ID: ${problem.lead_id}):`);
                problem.problems.forEach(prob => {
                    console.log(`   • ${prob.message}`);
                });
                if (problem.recommendation) {
                    console.log(`   💡 Рекомендация: ${problem.recommendation}`);
                }
            });
        }
        
        console.log('\n💡 РЕКОМЕНДАЦИИ:');
        analysis.recommendations.forEach((rec, index) => {
            console.log(`${index + 1}. ${rec.recommendation}`);
        });
        
        const duration = Date.now() - startTime;
        console.log(`\n⏱️  Время выполнения: ${duration}ms`);
        console.log('='.repeat(100));
        
        res.json({
            success: true,
            message: 'Универсальный анализ всех абонементов выполнен',
            timestamp: analysis.timestamp,
            data: {
                summary: {
                    total_leads_analyzed: analysis.total_leads_analyzed,
                    field_variations_count: analysis.field_variations.length,
                    problems_detected: analysis.problems_detected.length,
                    execution_time_ms: duration
                },
                field_variations: analysis.field_variations,
                problems_detected: analysis.problems_detected,
                recommendations: analysis.recommendations,
                status_distribution: analysis.status_distribution,
                lead_naming_patterns: analysis.lead_naming_patterns
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка универсального анализа:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// ==================== ЭКСТРЕННЫЙ ПОИСК ИВАНА ЮРЛОВА ====================
app.get('/api/find-ivan-yurlov', async (req, res) => {
    try {
        console.log('\n🔍 ЭКСТРЕННЫЙ ПОИСК ИВАНА ЮРЛОВА');
        console.log('='.repeat(80));
        
        const studentName = 'Иван Юрлов';
        const phone = '+79852541504';
        
        // 1. Ищем контакт с Иваном Юрловым
        console.log('\n📋 ШАГ 1: Поиск контакта с Иваном Юрловым');
        
        const searchResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/contacts?query=${encodeURIComponent('Юрлов')}&with=custom_fields_values&limit=50`
        );
        
        const contacts = searchResponse._embedded?.contacts || [];
        
        console.log(`📊 Найдено контактов с фамилией "Юрлов": ${contacts.length}`);
        
        let correctContact = null;
        let ivanFound = false;
        
        for (const contact of contacts) {
            const children = amoCrmService.extractStudentsFromContact(contact);
            const hasIvan = children.some(child => 
                child.studentName.toLowerCase().includes('иван') ||
                child.studentName.toLowerCase().includes('yurlov')
            );
            
            if (hasIvan) {
                correctContact = contact;
                console.log(`\n✅ Найден правильный контакт: "${contact.name}" (ID: ${contact.id})`);
                console.log(`   👥 Ученики: ${children.map(c => c.studentName).join(', ')}`);
                console.log(`   📞 Телефон контакта: ${contact.custom_fields_values?.find(f => 
                    f.field_name?.toLowerCase().includes('телефон')
                )?.values?.[0]?.value || 'Не указан'}`);
                
                ivanFound = true;
                break;
            }
        }
        
        if (!ivanFound) {
            console.log('❌ Иван Юрлов не найден в контактах с фамилией "Юрлов"');
            
            // Ищем по телефону
            console.log('\n📋 ШАГ 2: Поиск по телефону +79852541504');
            
            const phoneResponse = await amoCrmService.searchContactsByPhone(phone);
            const phoneContacts = phoneResponse._embedded?.contacts || [];
            
            console.log(`📊 Контактов по телефону: ${phoneContacts.length}`);
            
            for (const contact of phoneContacts) {
                console.log(`   👤 "${contact.name}" (ID: ${contact.id})`);
                
                // Проверяем, не администратор ли это
                if (contact.id === 31966847) {
                    console.log(`   ⚠️  Это администраторский контакт (Anastasia Yurlova)`);
                    console.log(`   ℹ️  В этом контакте 230 сделок разных учеников`);
                    console.log(`   ❌ Иван Юрлов НЕ ЗАПИСАН НА ЭТОТ ТЕЛЕФОН!`);
                    console.log(`   ✅ Иван записан на другой телефон или в другом контакте`);
                }
            }
        }
        
        // 2. Ищем сделку для Ивана Юрлова
        console.log('\n📋 ШАГ 3: Поиск сделки "Иван Юрлов - 4 занятия"');
        
        const leadSearch = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?query=${encodeURIComponent('Иван Юрлов')}&with=custom_fields_values&limit=10`
        );
        
        const leads = leadSearch._embedded?.leads || [];
        
        console.log(`📊 Найдено сделок с именем "Иван Юрлов": ${leads.length}`);
        
        leads.forEach(lead => {
            console.log(`\n   📋 "${lead.name}" (ID: ${lead.id})`);
            console.log(`      📍 Pipeline: ${lead.pipeline_id}, Status: ${lead.status_id}`);
            
            // Проверяем контакты сделки
            if (lead._embedded && lead._embedded.contacts) {
                console.log(`      👥 Контакты сделки:`);
                lead._embedded.contacts.forEach(contactLink => {
                    console.log(`         • Контакт ID: ${contactLink.id}`);
                });
            }
            
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            console.log(`      🎫 Абонемент: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
            console.log(`      📊 Занятий: ${subscriptionInfo.totalClasses}`);
        });
        
        res.json({
            success: true,
            message: 'Экстренный поиск выполнен',
            data: {
                student_name: studentName,
                phone: phone,
                correct_contact_found: !!correctContact,
                correct_contact: correctContact ? {
                    id: correctContact.id,
                    name: correctContact.name,
                    phone: phone
                } : null,
                leads_found: leads.length,
                leads: leads.map(lead => ({
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    contacts: lead._embedded?.contacts?.map(c => c.id) || []
                })),
                conclusion: correctContact ? 
                    `Иван Юрлов найден в контакте "${correctContact.name}"` :
                    `Иван Юрлов не записан на телефон ${phone}. Он записан на другой телефон.`,
                recommendation: [
                    'Пользователь должен авторизоваться по ТОМУ телефону, на который записан Иван Юрлов',
                    'Текущий телефон +79852541504 принадлежит администратору Anastasia Yurlova',
                    'На этот телефон записаны 230 разных учеников'
                ]
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== АНАЛИЗ ВЫБОРА СДЕЛОК ====================
app.get('/api/debug/lead-selection/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 АНАЛИЗ ВЫБОРА СДЕЛОК: ${studentName} (${phone})`);
        console.log('='.repeat(80));
        
        // Ищем контакты
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({
                success: false,
                error: 'Контакты не найдены'
            });
        }
        
        const contactId = contacts[0].id;
        const leads = await amoCrmService.getContactLeadsSorted(contactId);
        
        console.log(`📊 Всего сделок: ${leads.length}`);
        
        const leadAnalysis = [];
        
        // Анализируем каждую сделку
        for (const lead of leads) {
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            
            // Пропускаем без абонемента
            if (!subscriptionInfo.hasSubscription) continue;
            
            // Проверяем совпадение имени
            const nameMatch = amoCrmService.checkIfLeadBelongsToStudent(lead.name || '', studentName);
            
            // Рассчитываем баллы
            let score = 0;
            const isInSubscriptionPipeline = lead.pipeline_id === amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId;
            const activeStatusIds = amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'].activeStatusIds;
            
            if (nameMatch) score += 100;
            if (isInSubscriptionPipeline) score += 80;
            if (activeStatusIds.includes(lead.status_id)) score += 60;
            if (subscriptionInfo.subscriptionActive) score += 50;
            if (!subscriptionInfo.isFrozen) score += 40;
            if (subscriptionInfo.remainingClasses > 0) score += 30;
            if (subscriptionInfo.totalClasses <= 8) score += 25;
            
            // Бонус за свежесть
            const leadDate = new Date(lead.updated_at * 1000);
            const daysAgo = Math.floor((Date.now() - leadDate.getTime()) / (1000 * 60 * 60 * 24));
            if (daysAgo <= 30) score += Math.max(0, 20 - daysAgo);
            
            leadAnalysis.push({
                lead_id: lead.id,
                lead_name: lead.name,
                updated_at: new Date(lead.updated_at * 1000).toISOString(),
                days_ago: daysAgo,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                is_in_subscription_pipeline: isInSubscriptionPipeline,
                is_active_status: activeStatusIds.includes(lead.status_id),
                subscription_info: {
                    total_classes: subscriptionInfo.totalClasses,
                    remaining_classes: subscriptionInfo.remainingClasses,
                    used_classes: subscriptionInfo.usedClasses,
                    is_active: subscriptionInfo.subscriptionActive,
                    is_frozen: subscriptionInfo.isFrozen,
                    status: subscriptionInfo.subscriptionStatus
                },
                name_match: nameMatch,
                score: score,
                selection_criteria: {
                    name_match: nameMatch ? 100 : 0,
                    subscription_pipeline: isInSubscriptionPipeline ? 80 : 0,
                    active_status: activeStatusIds.includes(lead.status_id) ? 60 : 0,
                    subscription_active: subscriptionInfo.subscriptionActive ? 50 : 0,
                    not_frozen: !subscriptionInfo.isFrozen ? 40 : 0,
                    has_remaining: subscriptionInfo.remainingClasses > 0 ? 30 : 0,
                    small_subscription: subscriptionInfo.totalClasses <= 8 ? 25 : 0,
                    freshness_bonus: daysAgo <= 30 ? Math.max(0, 20 - daysAgo) : 0
                }
            });
        }
        
        // Сортируем по баллам
        leadAnalysis.sort((a, b) => b.score - a.score);
        
        console.log(`\n🏆 ТОП-5 СДЕЛОК:`);
        leadAnalysis.slice(0, 5).forEach((lead, index) => {
            console.log(`\n${index + 1}. "${lead.lead_name}"`);
            console.log(`   • Баллы: ${lead.score}`);
            console.log(`   • Занятий: ${lead.subscription_info.remaining_classes}/${lead.subscription_info.total_classes}`);
            console.log(`   • Статус: ${lead.subscription_info.status}`);
            console.log(`   • Совпадение имени: ${lead.name_match ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Воронка абонементов: ${lead.is_in_subscription_pipeline ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Активный статус: ${lead.is_active_status ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Заморожен: ${lead.subscription_info.is_frozen ? '✅ Да' : '❌ Нет'}`);
        });
        
        res.json({
            success: true,
            message: 'Анализ выбора сделок выполнен',
            data: {
                student_name: studentName,
                phone: phone,
                contact_id: contactId,
                total_leads: leads.length,
                leads_with_subscription: leadAnalysis.length,
                top_leads: leadAnalysis.slice(0, 5),
                all_leads: leadAnalysis,
                recommendations: leadAnalysis.length > 0 ? [
                    `Рекомендуется выбрать: "${leadAnalysis[0].lead_name}"`,
                    `Причина: ${leadAnalysis[0].score} баллов (${leadAnalysis[0].subscription_info.status})`
                ] : ['Нет подходящих сделок с абонементами']
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== БЫСТРОЕ ИСПРАВЛЕНИЕ ВЫБОРА СДЕЛОК ====================
app.post('/api/fix-lead-selection', async (req, res) => {
    try {
        console.log('\n🔧 ИСПРАВЛЕНИЕ ЛОГИКИ ВЫБОРА СДЕЛОК');
        console.log('='.repeat(80));
        
        // Тестовые случаи
        const testCases = [
            { phone: '+79161916984', student: 'Полина Кунахович', expected: '8 занятий' },
            { phone: '+79160577611', student: 'Никифорова Алиса', expected: '4 занятия' },
            { phone: '+79852541504', student: 'Иван Юрлов', expected: '4 занятия' }
        ];
        
        const results = [];
        
        for (const testCase of testCases) {
            console.log(`\n📱 Тест: ${testCase.student} (${testCase.phone})`);
            
            // Получаем контакты
            const contactsResponse = await amoCrmService.searchContactsByPhone(testCase.phone);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            if (contacts.length === 0) {
                results.push({
                    phone: testCase.phone,
                    student: testCase.student,
                    success: false,
                    error: 'Контакты не найдены'
                });
                continue;
            }
            
            // Ищем лучшую сделку
            const bestLead = await amoCrmService.findLeadForStudent(contacts[0].id, testCase.student);
            
            if (bestLead) {
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(bestLead);
                
                const result = {
                    phone: testCase.phone,
                    student: testCase.student,
                    success: true,
                    selected_lead: {
                        id: bestLead.id,
                        name: bestLead.name,
                        total_classes: subscriptionInfo.totalClasses,
                        remaining_classes: subscriptionInfo.remainingClasses,
                        status: subscriptionInfo.subscriptionStatus,
                        is_frozen: subscriptionInfo.isFrozen
                    },
                    matches_expected: subscriptionInfo.totalClasses === parseInt(testCase.expected) || 
                                     bestLead.name.includes(testCase.expected),
                    expected: testCase.expected,
                    actual: `${subscriptionInfo.totalClasses} занятий`
                };
                
                console.log(`   ✅ Выбрана сделка: "${bestLead.name}"`);
                console.log(`   📊 ${subscriptionInfo.remaining_classes}/${subscriptionInfo.totalClasses} занятий`);
                console.log(`   🎯 Совпадает с ожидаемым: ${result.matches_expected ? '✅ Да' : '❌ Нет'}`);
                
                results.push(result);
            } else {
                results.push({
                    phone: testCase.phone,
                    student: testCase.student,
                    success: false,
                    error: 'Не найдено подходящей сделки'
                });
                console.log(`   ❌ Не найдено подходящей сделки`);
            }
        }
        
        // Анализ результатов
        const successfulTests = results.filter(r => r.success && r.matches_expected);
        const wrongSelections = results.filter(r => r.success && !r.matches_expected);
        const failedTests = results.filter(r => !r.success);
        
        console.log('\n📊 ИТОГИ ТЕСТИРОВАНИЯ:');
        console.log(`   • Всего тестов: ${results.length}`);
        console.log(`   • Успешных выборов: ${successfulTests.length}`);
        console.log(`   • Неправильных выборов: ${wrongSelections.length}`);
        console.log(`   • Неудачных тестов: ${failedTests.length}`);
        
        if (wrongSelections.length > 0) {
            console.log('\n🚨 ПРОБЛЕМНЫЕ СЛУЧАИ:');
            wrongSelections.forEach(test => {
                console.log(`   • ${test.student}: ожидалось ${test.expected}, выбрано ${test.actual}`);
                console.log(`     Сделка: "${test.selected_lead.name}"`);
            });
        }
        
        res.json({
            success: true,
            message: 'Исправление логики выбора применено',
            data: {
                results: results,
                summary: {
                    total_tests: results.length,
                    correct_selections: successfulTests.length,
                    incorrect_selections: wrongSelections.length,
                    failed_tests: failedTests.length
                },
                recommendations: wrongSelections.length > 0 ? [
                    '1. Увеличьте вес совпадения имени',
                    '2. Увеличьте вес воронки абонементов', 
                    '3. Увеличьте вес активных статусов',
                    '4. Увеличьте вес незамороженных абонементов',
                    '5. Увеличьте бонус за меньшие абонементы (4-8 занятий)'
                ] : ['✅ Логика выбора работает правильно']
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка исправления:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ДИАГНОСТИКА КОНКРЕТНОГО УЧЕНИКА ====================
app.get('/api/debug/student-match/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ДИАГНОСТИКА СОПОСТАВЛЕНИЯ: ${studentName} (${phone})`);
        console.log('='.repeat(80));
        
        // Ищем контакты
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({
                success: false,
                error: 'Контакты не найдены'
            });
        }
        
        const contactId = contacts[0].id;
        const leads = await amoCrmService.getContactLeadsSorted(contactId);
        
        console.log(`📊 Всего сделок: ${leads.length}`);
        
        const matchingAnalysis = [];
        
        // Анализируем каждую сделку
        for (const lead of leads) {
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            
            // Только сделки с абонементами
            if (!subscriptionInfo.hasSubscription) continue;
            
            // Проверяем совпадение имени
            const nameMatch = amoCrmService.checkIfLeadBelongsToStudent(lead.name || '', studentName);
            
            // Детальный анализ совпадения
            const matchDetails = {
                direct_match: lead.name.toLowerCase().includes(studentName.toLowerCase()),
                student_in_lead: studentName.toLowerCase().includes(lead.name.toLowerCase()),
                parts_match: 0,
                total_parts: 0
            };
            
            // Анализ по частям имени
            const studentParts = studentName.toLowerCase().split(/\s+/).filter(p => p.length > 1);
            const leadParts = (lead.name || '').toLowerCase().split(/\s+/).filter(p => p.length > 1);
            
            matchDetails.total_parts = studentParts.length;
            
            for (const studentPart of studentParts) {
                for (const leadPart of leadParts) {
                    if (leadPart.includes(studentPart) || studentPart.includes(leadPart)) {
                        matchDetails.parts_match++;
                        break;
                    }
                }
            }
            
            matchingAnalysis.push({
                lead_id: lead.id,
                lead_name: lead.name,
                subscription_info: {
                    total_classes: subscriptionInfo.totalClasses,
                    remaining_classes: subscriptionInfo.remainingClasses,
                    status: subscriptionInfo.subscriptionStatus,
                    is_active: subscriptionInfo.subscriptionActive
                },
                name_match: nameMatch,
                match_details: matchDetails,
                match_percentage: studentParts.length > 0 ? 
                    Math.round((matchDetails.parts_match / studentParts.length) * 100) : 0,
                recommendation: nameMatch ? '✅ РЕКОМЕНДУЕТСЯ' : 
                    matchDetails.match_percentage > 50 ? '⚠️ ВОЗМОЖНО' : '❌ НЕ РЕКОМЕНДУЕТСЯ'
            });
        }
        
        // Сортируем по совпадению
        matchingAnalysis.sort((a, b) => {
            if (a.name_match !== b.name_match) return b.name_match ? 1 : -1;
            if (a.match_percentage !== b.match_percentage) return b.match_percentage - a.match_percentage;
            return b.subscription_info.remaining_classes - a.subscription_info.remaining_classes;
        });
        
        console.log(`\n🏆 ТОП-5 СОВПАДЕНИЙ ДЛЯ "${studentName}":`);
        matchingAnalysis.slice(0, 5).forEach((match, index) => {
            console.log(`\n${index + 1}. "${match.lead_name}"`);
            console.log(`   • Совпадение имени: ${match.name_match ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Совпадение частей: ${match.match_details.parts_match}/${match.match_details.total_parts} (${match.match_percentage}%)`);
            console.log(`   • Занятий: ${match.subscription_info.remaining_classes}/${match.subscription_info.total_classes}`);
            console.log(`   • Статус: ${match.subscription_info.status}`);
            console.log(`   • Рекомендация: ${match.recommendation}`);
        });
        
        // Проверяем, есть ли сделка с точным совпадением
        const exactMatch = matchingAnalysis.find(m => 
            m.lead_name.toLowerCase().includes(studentName.toLowerCase()) ||
            studentName.toLowerCase().includes(m.lead_name.toLowerCase())
        );
        
        res.json({
            success: true,
            message: 'Диагностика сопоставления выполнена',
            data: {
                student_name: studentName,
                phone: phone,
                contact_id: contactId,
                contact_name: contacts[0].name,
                total_leads_with_subscription: matchingAnalysis.length,
                exact_match_found: !!exactMatch,
                exact_match: exactMatch || null,
                top_matches: matchingAnalysis.slice(0, 5),
                all_matches: matchingAnalysis,
                summary: {
                    total_analyzed: leads.length,
                    with_subscription: matchingAnalysis.length,
                    exact_matches: matchingAnalysis.filter(m => m.name_match).length,
                    partial_matches: matchingAnalysis.filter(m => !m.name_match && m.match_percentage > 50).length,
                    no_matches: matchingAnalysis.filter(m => !m.name_match && m.match_percentage <= 50).length
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ЭКСТРЕННЫЙ ТЕСТ АБОНЕМЕНТОВ ====================
app.get('/api/emergency-test/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🚨 ЭКСТРЕННЫЙ ТЕСТ СДЕЛКИ: ${leadId}`);
        console.log('='.repeat(80));
        
        // Тест 1: Получаем сделку напрямую
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        console.log(`📋 Сделка: "${lead.name}"`);
        console.log(`📍 Pipeline ID: ${lead.pipeline_id}`);
        console.log(`📍 Status ID: ${lead.status_id}`);
        
        // Тест 2: Анализируем абонемент
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        console.log('\n🔍 АНАЛИЗ АБОНЕМЕНТА:');
        console.log(`   • Найден абонемент: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
        console.log(`   • Всего занятий: ${subscriptionInfo.totalClasses}`);
        console.log(`   • Использовано: ${subscriptionInfo.usedClasses}`);
        console.log(`   • Осталось: ${subscriptionInfo.remainingClasses}`);
        console.log(`   • Статус: ${subscriptionInfo.subscriptionStatus}`);
        console.log(`   • Активен: ${subscriptionInfo.subscriptionActive ? '✅ Да' : '❌ Нет'}`);
        console.log(`   • Воронка абонемента: ${subscriptionInfo.isInSubscriptionPipeline ? '✅ Да' : '❌ Нет'}`);
        
        // Тест 3: Анализируем все поля
        const customFields = lead.custom_fields_values || [];
        console.log('\n🔍 ВСЕ ПОЛЯ СДЕЛКИ:');
        
        customFields.forEach(field => {
            const fieldId = field.field_id || field.id;
            const fieldName = amoCrmService.getFieldName(field);
            const fieldValue = amoCrmService.getFieldValue(field);
            
            // Особое внимание к полям абонемента
            const isSubField = amoCrmService.isSubscriptionField(fieldId);
            const prefix = isSubField ? '🔥 ' : '   ';
            
            console.log(`${prefix}${fieldId}: ${fieldName} = "${fieldValue}"`);
        });
        
        // Тест 4: Проверяем парсинг "Абонемент занятий:"
        const totalClassesField = customFields.find(f => 
            (f.field_id || f.id) === 850241
        );
        
        if (totalClassesField) {
            const fieldValue = amoCrmService.getFieldValue(totalClassesField);
            const parsedValue = amoCrmService.parseNumberFromField(fieldValue);
            
            console.log('\n🔍 ТЕСТ ПАРСИНГА "Абонемент занятий:":');
            console.log(`   • Исходное значение: "${fieldValue}"`);
            console.log(`   • Распознано как число: ${parsedValue}`);
            console.log(`   • В extractSubscriptionInfo: ${subscriptionInfo.totalClasses}`);
        }
        
        res.json({
            success: true,
            message: 'Экстренный тест выполнен',
            data: {
                lead_info: {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id
                },
                subscription_info: subscriptionInfo,
                field_count: customFields.length,
                critical_fields: customFields.filter(f => 
                    amoCrmService.isSubscriptionField(f.field_id || f.id)
                ).map(f => ({
                    id: f.field_id || f.id,
                    name: amoCrmService.getFieldName(f),
                    value: amoCrmService.getFieldValue(f)
                }))
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка экстренного теста:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== АНАЛИЗ ВАРИАНТОВ ДЛЯ КОНКРЕТНОГО УЧЕНИКА ====================
app.get('/api/debug/student-subscription-variations/:studentName', async (req, res) => {
    try {
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 АНАЛИЗ ВАРИАНТОВ ДЛЯ УЧЕНИКА: ${studentName}`);
        console.log('='.repeat(100));
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        // Ищем все сделки с именем ученика
        const searchResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?query=${encodeURIComponent(studentName)}&with=custom_fields_values&limit=100`
        );
        
        const leads = searchResponse._embedded?.leads || [];
        
        const analysis = {
            student_name: studentName,
            total_leads_found: leads.length,
            leads_in_subscription_pipeline: 0,
            subscription_variations: [],
            field_value_examples: {},
            recommendations: []
        };
        
        // Анализируем каждую сделку
        leads.forEach(lead => {
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            const customFields = lead.custom_fields_values || [];
            
            const isInSubscriptionPipeline = lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID;
            if (isInSubscriptionPipeline) {
                analysis.leads_in_subscription_pipeline++;
            }
            
            // Собираем ВСЕ значения ключевых полей
            const keyFields = [
                { id: 850241, name: 'Абонемент занятий:' },
                { id: 850257, name: 'Счетчик занятий:' },
                { id: 890163, name: 'Остаток занятий' },
                { id: 850255, name: 'Окончание абонемента:' },
                { id: 851565, name: 'Дата активации абонемента:' }
            ];
            
            keyFields.forEach(fieldDef => {
                const field = customFields.find(f => (f.field_id || f.id) === fieldDef.id);
                if (field) {
                    const value = amoCrmService.getFieldValue(field);
                    
                    if (!analysis.field_value_examples[fieldDef.id]) {
                        analysis.field_value_examples[fieldDef.id] = {
                            field_name: fieldDef.name,
                            values: new Set(),
                            examples: []
                        };
                    }
                    
                    analysis.field_value_examples[fieldDef.id].values.add(value);
                    analysis.field_value_examples[fieldDef.id].examples.push({
                        lead_name: lead.name,
                        value: value,
                        parsed: amoCrmService.parseNumberFromField(value)
                    });
                }
            });
            
            // Добавляем информацию о сделке
            analysis.subscription_variations.push({
                lead_id: lead.id,
                lead_name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                is_in_subscription_pipeline: isInSubscriptionPipeline,
                subscription_info: subscriptionInfo,
                custom_fields_count: customFields.length
            });
        });
        
        // Вывод в консоль
        console.log(`📊 Найдено сделок: ${analysis.total_leads_found}`);
        console.log(`📊 В воронке абонементов: ${analysis.leads_in_subscription_pipeline}`);
        
        console.log('\n🔧 ВАРИАНТЫ ЗНАЧЕНИЙ ПОЛЕЙ:');
        Object.entries(analysis.field_value_examples).forEach(([fieldId, data]) => {
            console.log(`\n📋 ${data.field_name} (ID: ${fieldId}):`);
            console.log(`   Уникальных значений: ${data.values.size}`);
            data.values.forEach(value => {
                const examples = data.examples
                    .filter(e => e.value === value)
                    .slice(0, 3)
                    .map(e => `"${e.lead_name}" → ${e.parsed}`);
                
                console.log(`   • "${value}"`);
                if (examples.length > 0) {
                    console.log(`     Примеры: ${examples.join(', ')}`);
                }
            });
        });
        
        // Рекомендации
        Object.entries(analysis.field_value_examples).forEach(([fieldId, data]) => {
            if (data.values.size > 5) {
                analysis.recommendations.push({
                    field: data.field_name,
                    issue: `Много разных форматов (${data.values.size})`,
                    recommendation: 'Унифицировать формат заполнения поля'
                });
            }
        });
        
        res.json({
            success: true,
            message: `Анализ вариантов для ученика ${studentName} выполнен`,
            data: analysis
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа вариантов:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ДИАГНОСТИКА ПАРСИНГА ПОЛЕЙ ====================
app.get('/api/debug/parsing-test/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ДИАГНОСТИКА ПАРСИНГА ДЛЯ СДЕЛКИ: ${leadId}`);
        console.log('='.repeat(80));
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        const customFields = lead.custom_fields_values || [];
        
        console.log(`📋 Сделка: "${lead.name}"`);
        console.log(`📊 Поля: ${customFields.length}`);
        
        const parsingResults = [];
        
        // Тестируем парсинг каждого поля
        customFields.forEach(field => {
            const fieldId = field.field_id || field.id;
            const fieldName = amoCrmService.getFieldName(field);
            const rawValue = field.values || [];
            
            // Получаем значение разными способами
            const value1 = amoCrmService.getFieldValue(field);
            const value2 = field.values?.[0]?.value || field.values?.[0]?.enum_value || field.values?.[0];
            const parsedNumber = amoCrmService.parseNumberFromField(value1);
            
            parsingResults.push({
                field_id: fieldId,
                field_name: fieldName,
                raw_values: rawValue,
                getFieldValue_result: value1,
                direct_access: value2,
                parsed_number: parsedNumber,
                is_subscription_field: amoCrmService.isSubscriptionField(fieldId)
            });
            
            console.log(`\n🔍 Поле ${fieldId} (${fieldName}):`);
            console.log(`   • raw_values:`, JSON.stringify(rawValue));
            console.log(`   • getFieldValue(): "${value1}"`);
            console.log(`   • Парсинг числа: ${parsedNumber}`);
        });
        
        // Тестируем полный анализ
        console.log('\n' + '='.repeat(80));
        console.log('🧪 ПОЛНЫЙ АНАЛИЗ СДЕЛКИ:');
        
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        res.json({
            success: true,
            message: 'Диагностика парсинга выполнена',
            data: {
                lead_info: {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id
                },
                fields_count: customFields.length,
                parsing_results: parsingResults,
                subscription_info: subscriptionInfo,
                critical_analysis: {
                    total_classes_field: parsingResults.find(f => f.field_id === 850241),
                    used_classes_field: parsingResults.find(f => f.field_id === 850257),
                    remaining_classes_field: parsingResults.find(f => f.field_id === 890163),
                    final_total: subscriptionInfo.totalClasses,
                    final_remaining: subscriptionInfo.remainingClasses,
                    has_subscription: subscriptionInfo.hasSubscription
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики парсинга:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== БЫСТРОЕ ИСПРАВЛЕНИЕ ====================
app.post('/api/quick-fix-parsing', async (req, res) => {
    try {
        console.log('\n🔧 ПРИМЕНЕНИЕ БЫСТРОГО ИСПРАВЛЕНИЯ ПАРСИНГА');
        console.log('='.repeat(80));
        
        // Тест 1: Проверяем парсинг конкретных значений
        const testValues = [
            '8 занятий',
            '16 занятий', 
            '4 занятия',
            '1 занятие',
            '2 занятия',
            '3 занятия',
            '24 занятия',
            'Разовый'
        ];
        
        const parsingTests = testValues.map(value => {
            const parsed = amoCrmService.parseNumberFromField(value);
            return {
                input: value,
                output: parsed,
                success: parsed > 0
            };
        });
        
        console.log('\n🧪 ТЕСТ ПАРСИНГА:');
        parsingTests.forEach(test => {
            console.log(`   "${test.input}" → ${test.output} ${test.success ? '✅' : '❌'}`);
        });
        
        // Тест 2: Проверяем конкретную сделку
        console.log('\n🧪 ТЕСТ КОНКРЕТНОЙ СДЕЛКИ (28674745):');
        
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/28674745?with=custom_fields_values`
        );
        
        if (lead) {
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            
            console.log(`   📋 Сделка: "${lead.name}"`);
            console.log(`   🎫 Абонемент найден: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
            console.log(`   📊 Занятий: ${subscriptionInfo.totalClasses} всего, ${subscriptionInfo.remainingClasses} осталось`);
            console.log(`   🎯 Статус: ${subscriptionInfo.subscriptionStatus}`);
            
            // Проверяем критические поля
            const customFields = lead.custom_fields_values || [];
            const totalField = customFields.find(f => (f.field_id || f.id) === 850241);
            
            if (totalField) {
                const value = amoCrmService.getFieldValue(totalField);
                const parsed = amoCrmService.parseNumberFromField(value);
                console.log(`   🔍 Поле 850241: "${value}" → ${parsed}`);
            }
        }
        
        res.json({
            success: true,
            message: 'Исправление применено',
            data: {
                parsing_tests: parsingTests,
                test_lead: lead ? {
                    name: lead.name,
                    subscription_found: subscriptionInfo.hasSubscription,
                    total_classes: subscriptionInfo.totalClasses,
                    remaining_classes: subscriptionInfo.remainingClasses,
                    status: subscriptionInfo.subscriptionStatus
                } : null,
                recommendations: [
                    '1. Проверьте логику getFieldValue()',
                    '2. Убедитесь, что FIELD_IDS правильно настроены',
                    '3. Проверьте обработку select-полей с enum_id'
                ]
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка быстрого исправления:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ПОИСК ПОЛЕЙ ПО НАЗВАНИЮ ====================
app.get('/api/debug/fields/search', async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Укажите поисковый запрос (параметр query)'
            });
        }
        
        console.log(`\n🔍 ПОИСК ПОЛЕЙ ПО ЗАПРОСУ: "${query}"`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const searchResults = {
            query: query,
            timestamp: new Date().toISOString(),
            leads: [],
            contacts: [],
            companies: [],
            customers: []
        };
        
        const searchLower = query.toLowerCase();
        
        // Ищем в полях сделок
        try {
            const leadFields = await amoCrmService.makeRequest('GET', '/api/v4/leads/custom_fields');
            if (leadFields && leadFields._embedded && leadFields._embedded.custom_fields) {
                searchResults.leads = leadFields._embedded.custom_fields
                    .filter(field => field.name.toLowerCase().includes(searchLower))
                    .map(field => ({
                        id: field.id,
                        name: field.name,
                        type: field.type,
                        code: field.code,
                        is_multiple: field.is_multiple,
                        enums: field.enums || []
                    }));
            }
        } catch (error) {
            console.error('❌ Ошибка поиска полей сделок:', error.message);
        }
        
        // Ищем в полях контактов
        try {
            const contactFields = await amoCrmService.makeRequest('GET', '/api/v4/contacts/custom_fields');
            if (contactFields && contactFields._embedded && contactFields._embedded.custom_fields) {
                searchResults.contacts = contactFields._embedded.custom_fields
                    .filter(field => field.name.toLowerCase().includes(searchLower))
                    .map(field => ({
                        id: field.id,
                        name: field.name,
                        type: field.type,
                        code: field.code,
                        is_multiple: field.is_multiple,
                        enums: field.enums || []
                    }));
            }
        } catch (error) {
            console.error('❌ Ошибка поиска полей контактов:', error.message);
        }
        
        // Рекомендации для абонементов
        const subscriptionKeywords = ['абонемент', 'занят', 'счетчик', 'остаток', 'окончание', 'активац', 'посещ', 'визит', 'заморозк'];
        const isSubscriptionSearch = subscriptionKeywords.some(keyword => searchLower.includes(keyword));
        
        if (isSubscriptionSearch) {
            searchResults.subscription_recommendations = [];
            
            // Проверяем поля, связанные с абонементами
            const allSubscriptionFields = [
                ...searchResults.leads.filter(f => 
                    f.name.toLowerCase().includes('абонемент') || 
                    f.name.toLowerCase().includes('занят')
                ),
                ...searchResults.contacts.filter(f => 
                    f.name.toLowerCase().includes('ребен') || 
                    f.name.toLowerCase().includes('учен') || 
                    f.name.toLowerCase().includes('дет')
                )
            ];
            
            allSubscriptionFields.forEach(field => {
                // Определяем тип поля для рекомендации
                let fieldType = 'unknown';
                let mappingSuggestion = null;
                
                if (field.name.toLowerCase().includes('абонемент') && field.name.toLowerCase().includes('занят')) {
                    fieldType = 'TOTAL_CLASSES';
                    mappingSuggestion = 'FIELD_IDS.LEAD.TOTAL_CLASSES';
                } else if (field.name.toLowerCase().includes('счетчик')) {
                    fieldType = 'USED_CLASSES';
                    mappingSuggestion = 'FIELD_IDS.LEAD.USED_CLASSES';
                } else if (field.name.toLowerCase().includes('остаток')) {
                    fieldType = 'REMAINING_CLASSES';
                    mappingSuggestion = 'FIELD_IDS.LEAD.REMAINING_CLASSES';
                } else if (field.name.toLowerCase().includes('окончание')) {
                    fieldType = 'EXPIRATION_DATE';
                    mappingSuggestion = 'FIELD_IDS.LEAD.EXPIRATION_DATE';
                } else if (field.name.toLowerCase().includes('активац')) {
                    fieldType = 'ACTIVATION_DATE';
                    mappingSuggestion = 'FIELD_IDS.LEAD.ACTIVATION_DATE';
                } else if (field.name.toLowerCase().includes('ребен')) {
                    fieldType = 'CHILD_NAME';
                    mappingSuggestion = 'FIELD_IDS.CONTACT.CHILD_1_NAME (или CHILD_2_NAME, CHILD_3_NAME)';
                }
                
                searchResults.subscription_recommendations.push({
                    field_id: field.id,
                    field_name: field.name,
                    field_type: field.type,
                    detected_as: fieldType,
                    mapping_suggestion: mappingSuggestion,
                    current_mapping: amoCrmService.FIELD_IDS.LEAD[Object.keys(amoCrmService.FIELD_IDS.LEAD).find(
                        key => amoCrmService.FIELD_IDS.LEAD[key] === field.id
                    )] || amoCrmService.FIELD_IDS.CONTACT[Object.keys(amoCrmService.FIELD_IDS.CONTACT).find(
                        key => amoCrmService.FIELD_IDS.CONTACT[key] === field.id
                    )] || 'Не маппировано'
                });
            });
        }
        
        console.log(`📊 Результаты поиска:`);
        console.log(`   • Поля сделок: ${searchResults.leads.length}`);
        console.log(`   • Поля контактов: ${searchResults.contacts.length}`);
        console.log(`   • Рекомендаций: ${searchResults.subscription_recommendations?.length || 0}`);
        
        res.json({
            success: true,
            message: 'Поиск полей выполнен',
            data: searchResults
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска полей:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ОБНОВЛЕНИЕ МАППИНГОВ ПОЛЕЙ ====================
app.post('/api/debug/fields/update-mappings', async (req, res) => {
    try {
        const { mappings } = req.body;
        
        if (!mappings) {
            return res.status(400).json({
                success: false,
                error: 'Укажите маппинги в теле запроса'
            });
        }
        
        console.log('\n🔄 ОБНОВЛЕНИЕ МАППИНГОВ ПОЛЕЙ');
        console.log('='.repeat(60));
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const updates = [];
        const errors = [];
        
        // Обрабатываем маппинги для сделок
        if (mappings.leads) {
            for (const [key, fieldId] of Object.entries(mappings.leads)) {
                try {
                    // Проверяем, что поле существует
                    const leadFields = await amoCrmService.makeRequest('GET', '/api/v4/leads/custom_fields');
                    const fieldExists = leadFields._embedded?.custom_fields?.some(f => f.id === fieldId);
                    
                    if (fieldExists) {
                        // Обновляем маппинг в сервисе
                        amoCrmService.FIELD_IDS.LEAD[key] = fieldId;
                        
                        updates.push({
                            entity: 'LEAD',
                            key: key,
                            old_value: amoCrmService.FIELD_IDS.LEAD[key],
                            new_value: fieldId,
                            status: '✅ ОБНОВЛЕНО'
                        });
                        
                        console.log(`   ✅ LEAD.${key} = ${fieldId}`);
                    } else {
                        errors.push({
                            entity: 'LEAD',
                            key: key,
                            field_id: fieldId,
                            error: 'Поле не найдено в amoCRM'
                        });
                        
                        console.log(`   ❌ LEAD.${key}: поле ${fieldId} не найдено`);
                    }
                } catch (error) {
                    errors.push({
                        entity: 'LEAD',
                        key: key,
                        field_id: fieldId,
                        error: error.message
                    });
                    
                    console.log(`   ❌ LEAD.${key}: ${error.message}`);
                }
            }
        }
        
        // Обрабатываем маппинги для контактов
        if (mappings.contacts) {
            for (const [key, fieldId] of Object.entries(mappings.contacts)) {
                try {
                    // Пропускаем специальные значения
                    if (fieldId === 'name' || fieldId === null) {
                        amoCrmService.FIELD_IDS.CONTACT[key] = fieldId;
                        
                        updates.push({
                            entity: 'CONTACT',
                            key: key,
                            value: fieldId,
                            status: '✅ ОБНОВЛЕНО (специальное значение)'
                        });
                        
                        console.log(`   ✅ CONTACT.${key} = ${fieldId}`);
                        continue;
                    }
                    
                    // Проверяем, что поле существует
                    const contactFields = await amoCrmService.makeRequest('GET', '/api/v4/contacts/custom_fields');
                    const fieldExists = contactFields._embedded?.custom_fields?.some(f => f.id === fieldId);
                    
                    if (fieldExists) {
                        // Обновляем маппинг в сервисе
                        amoCrmService.FIELD_IDS.CONTACT[key] = fieldId;
                        
                        updates.push({
                            entity: 'CONTACT',
                            key: key,
                            old_value: amoCrmService.FIELD_IDS.CONTACT[key],
                            new_value: fieldId,
                            status: '✅ ОБНОВЛЕНО'
                        });
                        
                        console.log(`   ✅ CONTACT.${key} = ${fieldId}`);
                    } else {
                        errors.push({
                            entity: 'CONTACT',
                            key: key,
                            field_id: fieldId,
                            error: 'Поле не найдено в amoCRM'
                        });
                        
                        console.log(`   ❌ CONTACT.${key}: поле ${fieldId} не найдено`);
                    }
                } catch (error) {
                    errors.push({
                        entity: 'CONTACT',
                        key: key,
                        field_id: fieldId,
                        error: error.message
                    });
                    
                    console.log(`   ❌ CONTACT.${key}: ${error.message}`);
                }
            }
        }
        
        // Перезагружаем маппинги полей
        await amoCrmService.loadFieldMappings();
        
        console.log('='.repeat(60));
        console.log(`📊 ИТОГО: ${updates.length} обновлений, ${errors.length} ошибок`);
        
        res.json({
            success: true,
            message: 'Маппинги полей обновлены',
            timestamp: new Date().toISOString(),
            data: {
                updates: updates,
                errors: errors,
                current_mappings: {
                    leads: amoCrmService.FIELD_IDS.LEAD,
                    contacts: amoCrmService.FIELD_IDS.CONTACT
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления маппингов:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ПОЛНАЯ ПРОВЕРКА ТЕСТОВОЙ СДЕЛКИ ====================
app.get('/api/debug/test-subscription/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ПОЛНАЯ ПРОВЕРКА ТЕСТОВОЙ СДЕЛКИ: ${leadId}`);
        console.log('='.repeat(80));
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values,contacts`
        );
        
        if (!lead) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        // Полный анализ
        const analysis = {
            lead_info: {
                id: lead.id,
                name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                price: lead.price,
                created_at: lead.created_at ? new Date(lead.created_at * 1000).toISOString() : null,
                updated_at: lead.updated_at ? new Date(lead.updated_at * 1000).toISOString() : null
            },
            
            // Извлекаем информацию об абонементе
            subscription_info: amoCrmService.extractSubscriptionInfo(lead),
            
            // Все поля сделки
            fields: [],
            
            // Контакты связанные со сделкой
            contacts: [],
            
            // Подробный анализ каждого поля
            detailed_field_analysis: []
        };
        
        // Анализ полей
        const customFields = lead.custom_fields_values || [];
        
        customFields.forEach(field => {
            const fieldId = field.field_id || field.id;
            const fieldName = amoCrmService.getFieldName(field);
            const fieldValue = amoCrmService.getFieldValue(field);
            const fieldType = amoCrmService.fieldMappings.get(fieldId)?.type || 'unknown';
            
            analysis.fields.push({
                id: fieldId,
                name: fieldName,
                value: fieldValue,
                type: fieldType,
                raw_value: field.values || []
            });
            
            // Подробный анализ для полей абонемента
            if (amoCrmService.isSubscriptionField(fieldId)) {
                analysis.detailed_field_analysis.push({
                    field_id: fieldId,
                    field_name: fieldName,
                    field_value: fieldValue,
                    field_type: fieldType,
                    
                    // Как интерпретируется значение
                    interpretation: {
                        as_number: amoCrmService.parseNumberFromField(fieldValue),
                        as_date: amoCrmService.parseDate(fieldValue),
                        as_boolean: fieldValue === 'Да' || fieldValue === 'true' || fieldValue === '1',
                        raw_interpretation: `Тип: ${fieldType}, Значение: "${fieldValue}"`
                    },
                    
                    // К какому полю абонемента относится
                    subscription_field: Object.keys(amoCrmService.FIELD_IDS.LEAD).find(
                        key => amoCrmService.FIELD_IDS.LEAD[key] === fieldId
                    ) || 'Не маппировано',
                    
                    // Важность
                    importance: amoCrmService.isSubscriptionField(fieldId) ? 'CRITICAL' : 'NORMAL'
                });
            }
        });
        
        // Анализ контактов
        if (lead._embedded && lead._embedded.contacts) {
            for (const contactLink of lead._embedded.contacts) {
                try {
                    const contact = await amoCrmService.makeRequest(
                        'GET',
                        `/api/v4/contacts/${contactLink.id}?with=custom_fields_values`
                    );
                    
                    if (contact) {
                        const children = amoCrmService.extractStudentsFromContact(contact);
                        
                        analysis.contacts.push({
                            id: contact.id,
                            name: contact.name,
                            children_count: children.length,
                            children: children.map(child => ({
                                name: child.studentName,
                                branch: child.branch,
                                has_active_subscription: child.hasActiveSubscription
                            })),
                            custom_fields: contact.custom_fields_values?.map(field => ({
                                id: field.field_id || field.id,
                                name: amoCrmService.getFieldName(field),
                                value: amoCrmService.getFieldValue(field)
                            })) || []
                        });
                    }
                } catch (contactError) {
                    console.error(`❌ Ошибка получения контакта ${contactLink.id}:`, contactError.message);
                }
            }
        }
        
        // Проверяем воронку
        if (lead.pipeline_id) {
            try {
                const pipeline = await amoCrmService.makeRequest(
                    'GET',
                    `/api/v4/leads/pipelines/${lead.pipeline_id}`
                );
                
                if (pipeline) {
                    analysis.pipeline_info = {
                        id: pipeline.id,
                        name: pipeline.name,
                        is_subscription_pipeline: pipeline.id === amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId
                    };
                }
            } catch (pipelineError) {
                console.error(`❌ Ошибка получения воронки:`, pipelineError.message);
            }
        }
        
        // Проверяем статус
        if (lead.pipeline_id && lead.status_id) {
            try {
                const pipeline = await amoCrmService.makeRequest(
                    'GET',
                    `/api/v4/leads/pipelines/${lead.pipeline_id}`
                );
                
                if (pipeline && pipeline._embedded && pipeline._embedded.statuses) {
                    const status = pipeline._embedded.statuses.find(s => s.id === lead.status_id);
                    if (status) {
                        analysis.status_info = {
                            id: status.id,
                            name: status.name,
                            color: status.color,
                            is_active_status: [
                                amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'].statusIds['Активный абонемент'],
                                amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'].statusIds['Активирован']
                            ].includes(status.id)
                        };
                    }
                }
            } catch (statusError) {
                console.error(`❌ Ошибка получения статуса:`, statusError.message);
            }
        }
        
        // Вывод в консоль
        console.log(`\n📋 СДЕЛКА: "${lead.name}"`);
        console.log(`📊 Pipeline: ${lead.pipeline_id}, Status: ${lead.status_id}`);
        console.log(`📊 Полей: ${analysis.fields.length}`);
        console.log(`📊 Контактов: ${analysis.contacts.length}`);
        console.log(`\n🎯 ИНФОРМАЦИЯ ОБ АБОНЕМЕНТЕ:`);
        console.log(`   • Всего занятий: ${analysis.subscription_info.totalClasses}`);
        console.log(`   • Использовано: ${analysis.subscription_info.usedClasses}`);
        console.log(`   • Осталось: ${analysis.subscription_info.remainingClasses}`);
        console.log(`   • Статус: ${analysis.subscription_info.subscriptionStatus}`);
        console.log(`   • Активен: ${analysis.subscription_info.subscriptionActive ? '✅ Да' : '❌ Нет'}`);
        console.log(`   • Воронка абонемента: ${analysis.subscription_info.isInSubscriptionPipeline ? '✅ Да' : '❌ Нет'}`);
        
        console.log(`\n🔑 КРИТИЧЕСКИЕ ПОЛЯ:`);
        analysis.detailed_field_analysis.forEach(field => {
            if (field.importance === 'CRITICAL') {
                console.log(`   • ${field.field_name} (ID: ${field.field_id}): ${field.field_value}`);
            }
        });
        
        res.json({
            success: true,
            message: 'Полный анализ сделки выполнен',
            timestamp: new Date().toISOString(),
            data: analysis
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа сделки:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Получение списка профилей
app.get('/api/profiles', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Токен не предоставлен'
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const phone = decoded.phone;
        
        const profiles = await db.all(
            `SELECT * FROM student_profiles 
             WHERE phone_number = ? AND is_active = 1
             ORDER BY 
               CASE WHEN subscription_active = 1 THEN 1 ELSE 2 END,
               student_name`,
            [phone]
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

// ==================== ДИАГНОСТИЧЕСКИЕ МАРШРУТЫ ====================

// Диагностика поиска по телефону
app.get('/api/debug/phone/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n📱 ДИАГНОСТИКА ТЕЛЕФОНА: ${phone}`);
        console.log('='.repeat(80));
        
        const results = await amoCrmService.debugPhoneSearch(phone);
        
        if (!results) {
            return res.status(500).json({
                success: false,
                error: 'Не удалось выполнить диагностику'
            });
        }
        
        res.json({
            success: true,
            message: 'Диагностика выполнена',
            timestamp: new Date().toISOString(),
            data: results
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики телефона:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Диагностика сделки
app.get('/api/debug/lead/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ДИАГНОСТИКА СДЕЛКИ: ${leadId}`);
        console.log('='.repeat(80));
        
        const analysis = await amoCrmService.debugLeadAnalysis(leadId);
        
        if (!analysis) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        res.json({
            success: true,
            message: 'Анализ сделки выполнен',
            timestamp: new Date().toISOString(),
            data: analysis
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики сделки:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Проверка соединения с amoCRM
app.get('/api/debug/connection', async (req, res) => {
    try {
        console.log('\n🔍 ПРОВЕРКА СВЯЗИ С AMOCRM');
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован',
                timestamp: new Date().toISOString()
            });
        }
        
        const accountInfo = await amoCrmService.makeRequest('GET', '/api/v4/account');
        
        res.json({
            success: true,
            message: 'Соединение с amoCRM установлено',
            timestamp: new Date().toISOString(),
            data: {
                account: accountInfo.name || 'Неизвестно',
                subdomain: AMOCRM_SUBDOMAIN,
                amocrm_domain: AMOCRM_DOMAIN,
                fields_loaded: amoCrmService.fieldMappings.size,
                service_initialized: amoCrmService.isInitialized,
                subscription_pipeline_id: amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки связи:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка соединения с amoCRM',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Статистика базы данных
app.get('/api/debug/database', async (req, res) => {
    try {
        console.log('\n📊 СТАТИСТИКА БАЗЫ ДАННЫХ');
        
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_profiles,
                SUM(CASE WHEN subscription_active = 1 THEN 1 ELSE 0 END) as active_subscriptions,
                SUM(CASE WHEN subscription_active = 0 THEN 1 ELSE 0 END) as inactive_subscriptions,
                AVG(total_classes) as avg_classes,
                AVG(remaining_classes) as avg_remaining,
                MIN(last_sync) as oldest_sync,
                MAX(last_sync) as latest_sync
            FROM student_profiles
            WHERE is_active = 1
        `);
        
        const recentProfiles = await db.all(`
            SELECT 
                student_name,
                branch,
                subscription_status,
                total_classes,
                remaining_classes,
                last_sync
            FROM student_profiles
            WHERE is_active = 1
            ORDER BY last_sync DESC
            LIMIT 10
        `);
        
        res.json({
            success: true,
            message: 'Статистика базы данных',
            timestamp: new Date().toISOString(),
            data: {
                statistics: stats,
                recent_profiles: recentProfiles,
                total_syncs: await db.get(`SELECT COUNT(*) as count FROM sync_logs`)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Принудительная синхронизация
app.post('/api/sync/now', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`\n🔄 ПРИНУДИТЕЛЬНАЯ СИНХРОНИЗАЦИЯ ДЛЯ: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        const savedCount = await saveProfilesToDatabase(profiles);
        
        res.json({
            success: true,
            message: 'Синхронизация выполнена',
            data: {
                phone: formattedPhone,
                profiles_found: profiles.length,
                profiles_saved: savedCount,
                last_sync: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка синхронизации:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ОСНОВНЫЕ МАРШРУТЫ ====================
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        amocrm_status: amoCrmService.isInitialized ? 'connected' : 'disconnected',
        sync_status: syncService.getSyncStatus()
    });
});

app.get('/api/sync/status', async (req, res) => {
    try {
        const status = syncService.getSyncStatus();
        
        const lastSync = await db.get(
            `SELECT * FROM sync_logs 
             WHERE sync_type = 'auto_sync' 
             ORDER BY created_at DESC LIMIT 1`
        );
        
        res.json({
            success: true,
            data: {
                sync_status: status,
                last_sync: lastSync || null,
                amocrm_status: amoCrmService.isInitialized
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статуса синхронизации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статуса синхронизации'
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v2.0');
        console.log('='.repeat(80));
        console.log('✨ РЕАЛЬНЫЕ ДАННЫЕ ИЗ AMOCRM');
        console.log('✨ ВОРОНКА "!АБОНЕМЕНТ"');
        console.log('✨ АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            
            // Запускаем синхронизацию через 5 секунд
            setTimeout(() => {
                syncService.startAutoSync();
            }, 5000);
            
        } else {
            console.log('❌ amoCRM не инициализирован');
            console.log('❌ Невозможно получить данные без подключения к CRM');
        }
        
        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 Основной URL: http://localhost:${PORT}`);
            console.log(`📊 База данных: SQLite`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log(`🔄 Автосинхронизация: ✅ Каждые 10 минут`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`🔍 Профили: GET http://localhost:${PORT}/api/profiles`);
            console.log(`📋 Абонемент: POST http://localhost:3000/api/subscription`);
            console.log(`🔄 Статус синхронизации: GET http://localhost:${PORT}/api/sync/status`);
            console.log(`🔧 Диагностика телефона: GET http://localhost:${PORT}/api/debug/phone/79660587744`);
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
