// server.js - ПОЛНАЯ ПЕРЕРАБОТАННАЯ ВЕРСИЯ
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

// ==================== УЛУЧШЕННЫЙ КЛАСС AMOCRM ====================
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
        
        // ============ ВАШИ КОНСТАНТЫ ID ПОЛЕЙ ============
// В классе AmoCrmService обновите FIELD_IDS с учетом экспортированных полей
this.FIELD_IDS = {
    // Сделки (абонементы) - ВСЕ НАЙДЕННЫЕ ПОЛЯ
    LEAD: {
        // Основные поля абонемента
        TOTAL_CLASSES: 850241,        // "Абонемент занятий:" (select)
        USED_CLASSES: 850257,         // "Счетчик занятий:" (select)
        USED_CLASSES_NUM: 884251,     // "Кол-во отхоженных занятий" (numeric)
        REMAINING_CLASSES: 890163,    // "Остаток занятий" (numeric)
        EXPIRATION_DATE: 850255,      // "Окончание абонемента:" (date)
        ACTIVATION_DATE: 851565,      // "Дата активации абонемента:" (date)
        LAST_VISIT_DATE: 850259,      // "Дата последнего визита:" (date)
        SUBSCRIPTION_TYPE: 891007,    // "Тип абонемента" (select)
        SUBSCRIPTION_OWNER: 805465,   // "Принадлежность абонемента:" (select)
        FREEZE: 867693,               // "Заморозка абонемента:" (select)
        BRANCH: 891589,               // "Филиал" (select)
        AGE_GROUP: 850243,            // "Группа возраст:" (select)
        PURCHASE_DATE: 850253,        // "Дата покупки:" (date)
        
        // Технические поля для абонемента
        TECHNICAL_CLASSES: 891819,    // "Количество занятий (тех)" (numeric)
        CLASS_PRICE: 891813,          // "Стоимость 1 занятия" (numeric)
        
        // Чекбоксы посещений (все 24 занятия)
        CLASS_1: 884899, CLASS_2: 884901, CLASS_3: 884903, CLASS_4: 884905,
        CLASS_5: 884907, CLASS_6: 884909, CLASS_7: 884911, CLASS_8: 884913,
        CLASS_9: 884915, CLASS_10: 884917, CLASS_11: 884919, CLASS_12: 884921,
        CLASS_13: 884923, CLASS_14: 884925, CLASS_15: 884927, CLASS_16: 884929,
        CLASS_17: 892867, CLASS_18: 892871, CLASS_19: 892875, CLASS_20: 892879,
        CLASS_21: 892883, CLASS_22: 892887, CLASS_23: 892893, CLASS_24: 892895,
        
        // Даты занятий
        CLASS_DATE_1: 884931, CLASS_DATE_2: 884933, CLASS_DATE_3: 884935,
        CLASS_DATE_4: 884937, CLASS_DATE_5: 884939, CLASS_DATE_6: 884941,
        CLASS_DATE_7: 884943, CLASS_DATE_8: 884945, CLASS_DATE_9: 884953,
        CLASS_DATE_10: 884955, CLASS_DATE_11: 884951, CLASS_DATE_12: 884957,
        CLASS_DATE_13: 884959, CLASS_DATE_14: 884961, CLASS_DATE_15: 884963,
        CLASS_DATE_16: 884965, CLASS_DATE_17: 892869, CLASS_DATE_18: 892873,
        CLASS_DATE_19: 892877, CLASS_DATE_20: 892881, CLASS_DATE_21: 892885,
        CLASS_DATE_22: 892889, CLASS_DATE_23: 892891, CLASS_DATE_24: 892897,
    },
    
    // Контакты (ученики)
    CONTACT: {
        // Дети
        CHILD_1_NAME: 867233,         // "!ФИО ребенка:"
        CHILD_1_BIRTHDAY: 867687,     // "День рождения:" (ребенок 1)
        CHILD_2_NAME: 867235,         // "!!ФИО ребенка:"
        CHILD_2_BIRTHDAY: 867685,     // "День рождения:" (ребенок 2)
        CHILD_3_NAME: 867733,         // "!!!ФИО ребенка:"
        CHILD_3_BIRTHDAY: 867735,     // "День рождения:" (ребенок 3)
        
        // Основные поля
        BRANCH: 871273,              // "Филиал:" (select)
        TEACHER: 888881,             // "Преподаватель" (multiselect)
        SUMMER_TEACHER: 891651,      // "Преподаватель (лето)" (multiselect)
        DAY_OF_WEEK: 888879,         // "День недели посещения" (multiselect)
        AGE_GROUP: 888903,           // "Возраст группы" (multiselect)
        
        // Абонемент в контакте
        HAS_ACTIVE_SUB: 890179,      // "Есть активный абонемент" (checkbox)
        LAST_VISIT: 885380,          // "Дата последнего визита" (date)
        LAST_SUB_ACTIVATION: 892185, // "Дата активации последнего абонемента" (date)
        
        // Дополнительная информация
        ALLERGIES: 850239,           // "Аллергия и особенности:" (textarea)
        PARENT_BIRTHDAY: 850219,     // "День рождения:" (родителя)
        PARENT_NAME: 'name',         // Имя контакта
        EMAIL: 216617                // "Email" (стандартное поле)
    }
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

    async loadFieldMappings() {
        try {
            console.log('📋 Загрузка полей amoCRM...');
            const fields = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            
            this.fieldMappings.clear();
            if (fields && fields._embedded && fields._embedded.custom_fields) {
                fields._embedded.custom_fields.forEach(field => {
                    this.fieldMappings.set(field.id, {
                        name: field.name,
                        type: field.type,
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
            
            console.log(`🔍 Форматированный номер для поиска: ${searchPhone}`);
            
            const response = await this.makeRequest(
                'GET', 
                `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=leads,customers,custom_fields_values`
            );
            
            console.log(`📊 Найдено контактов: ${response._embedded?.contacts?.length || 0}`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    getFieldValue(field) {
        try {
            if (!field || !field.values || !Array.isArray(field.values) || field.values.length === 0) {
                return '';
            }
            
            const firstValue = field.values[0];
            
            // Если это объект с enum_id (как в поле "счетчик занятий:")
            if (typeof firstValue === 'object' && firstValue !== null) {
                // ВАЖНО: Для поля "счетчик занятий:" нужно извлекать value, а не enum_id
                if (firstValue.value !== undefined && firstValue.value !== null) {
                    return String(firstValue.value);
                }
                // Для других полей с enum
                else if (firstValue.enum_id !== undefined) {
                    // Если это счетчик занятий, нужно преобразовать enum_id в число
                    const fieldId = field.field_id || field.id;
                    if (fieldId === 850257) { // "счетчик занятий:"
                        return this.parseCounterFromEnum(firstValue.enum_id);
                    }
                    return String(firstValue.enum_id);
                }
                else if (firstValue.enum_value !== undefined) {
                    return String(firstValue.enum_value);
                }
            }
            
            // Если это просто строка или число
            return String(firstValue);
            
        } catch (error) {
            console.error('❌ Ошибка получения значения поля:', error);
            return '';
        }
    }

    // Новый метод для парсинга счетчика занятий из enum
    parseCounterFromEnum(enumId) {
        // Сопоставление enum_id с количеством занятий
        const enumMapping = {
            '504105': '1',  // 1 занятие
            '504107': '2',  // 2 занятия
            '504109': '3',  // 3 занятия
            '504111': '4',  // 4 занятия
            '504113': '5',  // 5 занятий
            '504115': '6',  // 6 занятий
            '504117': '7',  // 7 занятий
            '504119': '8',  // 8 занятий
            // Добавьте остальные по мере необходимости
        };
        
        const enumStr = String(enumId);
        return enumMapping[enumStr] || '0';
    }

    getFieldName(field) {
        try {
            if (!field) return '';
            
            if (field.field_name) {
                return String(field.field_name).toLowerCase();
            } else if (field.name) {
                return String(field.name).toLowerCase();
            } else if (field.field_id && this.fieldMappings.has(field.field_id)) {
                return this.fieldMappings.get(field.field_id).name.toLowerCase();
            }
            
            return '';
        } catch (error) {
            console.error('❌ Ошибка получения имени поля:', error);
            return '';
        }
    }

   // 🔧 ОБНОВИТЬ МЕТОД парсинга количества занятий
parseClassesCount(value) {
    if (!value) return 0;
    
    const str = String(value).toLowerCase().trim();
    console.log(`🔢 Парсим значение: "${str}"`);
    
    // Если это enum_id для "Абонемент занятий:"
    const subscriptionEnumMapping = {
        '504033': 4,    // "4 занятия"
        '504035': 8,    // "8 занятий" 
        '504037': 16,   // "16 занятий"
        '504039': 4,    // "Продвинутый 4 занятия"
        '504041': 8,    // "Продвинутый 8 занятий"
        '504043': 16,   // "Продвинутый 16 занятий"
        '504237': 5,    // "База Блок № 1 - 5 занятий"
        '504239': 6,    // "База Блок № 2 - 6 занятий"
        '504241': 5,    // "База Блок № 3 - 5 занятий"
        '504243': 16,   // "База - 16 занятий"
    };
    
    // Проверяем, является ли значение enum_id
    if (subscriptionEnumMapping[str]) {
        console.log(`   → Найден enum_id ${str}: ${subscriptionEnumMapping[str]} занятий`);
        return subscriptionEnumMapping[str];
    }
    
    // Ищем числа в тексте
    const numberMatch = str.match(/(\d+)/);
    if (numberMatch) {
        const result = parseInt(numberMatch[1]);
        console.log(`   → Найдено число: ${result}`);
        return result;
    }
    
    // Текстовые значения
    const textToNumber = {
        'четыре': 4, '4 занятия': 4, '4': 4,
        'восемь': 8, '8 занятий': 8, '8': 8,
        'шестнадцать': 16, '16 занятий': 16, '16': 16,
        'двадцать четыре': 24, '24 занятия': 24, '24': 24,
        'два': 2, '2 занятия': 2, '2': 2,
        'три': 3, '3 занятия': 3, '3': 3,
        'пять': 5, '5 занятий': 5, '5': 5,
        'шесть': 6, '6 занятий': 6, '6': 6
    };
    
    for (const [text, num] of Object.entries(textToNumber)) {
        if (str.includes(text)) {
            console.log(`   → Распознано текстовое значение: ${num}`);
            return num;
        }
    }
    
    console.log(`   → Число не найдено, возвращаем 0`);
    return 0;
}

   parseDate(value) {
    if (!value) return null;
    
    try {
        const dateStr = String(value).trim();
        console.log(`📅 Парсим дату: "${dateStr}"`);
        
        // Если это timestamp в секундах (как в amoCRM)
        if (dateStr.match(/^\d{9,10}$/)) {
            const timestamp = parseInt(dateStr);
            
            // Проверяем, может ли это быть дата (не слишком маленькая или большая)
            if (timestamp > 1000000000 && timestamp < 2000000000) {
                // Это timestamp в секундах - преобразуем в миллисекунды
                const date = new Date(timestamp * 1000);
                const result = date.toISOString().split('T')[0];
                console.log(`   → Timestamp ${timestamp} преобразован в: ${result}`);
                return result;
            }
        }
        
        // Если это timestamp в миллисекундах (редко, но может быть)
        if (dateStr.match(/^\d{13}$/)) {
            const timestamp = parseInt(dateStr);
            const date = new Date(timestamp);
            const result = date.toISOString().split('T')[0];
            console.log(`   → Timestamp (ms) ${timestamp} преобразован в: ${result}`);
            return result;
        }
        
        // Формат DD.MM.YYYY
        if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
            const parts = dateStr.split('.');
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2];
            const result = `${year}-${month}-${day}`;
            console.log(`   → Преобразовано из DD.MM.YYYY в: ${result}`);
            return result;
        }
        
        // Формат DD.MM.YY
        if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{2}$/)) {
            const parts = dateStr.split('.');
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            let year = parts[2];
            
            if (year.length === 2) {
                year = '20' + year;
            }
            
            const result = `${year}-${month}-${day}`;
            console.log(`   → Преобразовано из DD.MM.YY в: ${result}`);
            return result;
        }
        
        // Формат YYYY-MM-DD
        if (dateStr.match(/^\d{4}-\d{1,2}-\d{1,2}$/)) {
            const parts = dateStr.split('-');
            const result = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            console.log(`   → Стандартизировано YYYY-MM-DD: ${result}`);
            return result;
        }
        
        // Пробуем распарсить как дату
        const parsedDate = new Date(dateStr);
        if (!isNaN(parsedDate.getTime())) {
            const result = parsedDate.toISOString().split('T')[0];
            console.log(`   → Автоматически распаршено в: ${result}`);
            return result;
        }
        
        console.log(`   ⚠️  Формат не распознан, возвращаем как есть: ${dateStr}`);
        return dateStr;
        
    } catch (error) {
        console.error('❌ Ошибка парсинга даты:', error);
        return value;
    }
}
    // 🔧 ИСПРАВЛЕННЫЙ И УЛУЧШЕННЫЙ МЕТОД: extractSubscriptionInfo
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
        subscriptionOwner: '',
        freezeStatus: ''
    };
    
    if (!lead) {
        return subscriptionInfo;
    }
    
    try {
        const customFields = lead.custom_fields_values || [];
        const leadName = lead.name || '';
        const statusId = lead.status_id || 0;
        
        console.log(`\n🔍 Анализ абонемента в сделке: "${leadName}" (ID: ${lead.id}, Статус: ${statusId})`);
        
        // Собираем все данные
        for (const field of customFields) {
            const fieldId = field.field_id || field.id;
            const fieldName = this.getFieldName(field);
            const fieldValue = this.getFieldValue(field);
            
            if (!fieldValue || fieldValue.trim() === '') continue;
            
            switch(fieldId) {
                // Количество занятий (абонемент)
                case this.FIELD_IDS.LEAD.TOTAL_CLASSES:
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.totalClasses = this.parseClassesCount(fieldValue);
                    console.log(`   🎫 Абонемент: ${fieldValue} → ${subscriptionInfo.totalClasses} занятий`);
                    break;
                    
                // Счетчик занятий (использовано)
                case this.FIELD_IDS.LEAD.USED_CLASSES:
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.usedClasses = this.parseClassesCount(fieldValue);
                    console.log(`   📊 Счетчик занятий: ${fieldValue} → ${subscriptionInfo.usedClasses}`);
                    break;
                    
                // Альтернативный счетчик
                case this.FIELD_IDS.LEAD.USED_CLASSES_NUM:
                    subscriptionInfo.hasSubscription = true;
                    const numValue = parseInt(fieldValue) || 0;
                    subscriptionInfo.usedClasses = Math.max(subscriptionInfo.usedClasses, numValue);
                    console.log(`   📊 Кол-во отхоженных: ${fieldValue} → ${numValue}`);
                    break;
                    
                // Остаток занятий
                case this.FIELD_IDS.LEAD.REMAINING_CLASSES:
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.remainingClasses = parseInt(fieldValue) || 0;
                    console.log(`   📊 Остаток занятий: ${fieldValue} → ${subscriptionInfo.remainingClasses}`);
                    break;
                    
                // Техническое количество занятий
                case this.FIELD_IDS.LEAD.TECHNICAL_CLASSES:
                    subscriptionInfo.hasSubscription = true;
                    const techClasses = parseInt(fieldValue) || 0;
                    if (subscriptionInfo.totalClasses === 0 && techClasses > 0) {
                        subscriptionInfo.totalClasses = techClasses;
                        console.log(`   🔧 Техническое количество: ${fieldValue} → ${techClasses}`);
                    }
                    break;
                    
                // Дата окончания
                case this.FIELD_IDS.LEAD.EXPIRATION_DATE:
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.expirationDate = this.parseDate(fieldValue);
                    console.log(`   📅 Окончание: ${fieldValue} → ${subscriptionInfo.expirationDate}`);
                    break;
                    
                // Дата активации
                case this.FIELD_IDS.LEAD.ACTIVATION_DATE:
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.activationDate = this.parseDate(fieldValue);
                    console.log(`   📅 Активация: ${fieldValue} → ${subscriptionInfo.activationDate}`);
                    break;
                    
                // Дата покупки
                case this.FIELD_IDS.LEAD.PURCHASE_DATE:
                    subscriptionInfo.purchaseDate = this.parseDate(fieldValue);
                    console.log(`   📅 Покупка: ${fieldValue} → ${subscriptionInfo.purchaseDate}`);
                    break;
                    
                // Дата последнего визита
                case this.FIELD_IDS.LEAD.LAST_VISIT_DATE:
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.lastVisitDate = this.parseDate(fieldValue);
                    console.log(`   📅 Последний визит: ${fieldValue} → ${subscriptionInfo.lastVisitDate}`);
                    break;
                    
                // Тип абонемента
                case this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE:
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.subscriptionType = fieldValue;
                    console.log(`   🏷️  Тип абонемента: ${fieldValue}`);
                    break;
                    
                // Принадлежность абонемента
                case this.FIELD_IDS.LEAD.SUBSCRIPTION_OWNER:
                    subscriptionInfo.subscriptionOwner = fieldValue;
                    console.log(`   👤 Принадлежность: ${fieldValue}`);
                    break;
                    
                // Филиал в сделке
                case this.FIELD_IDS.LEAD.BRANCH:
                    subscriptionInfo.branch = fieldValue;
                    console.log(`   📍 Филиал (сделка): ${fieldValue}`);
                    break;
                    
                // Возрастная группа
                case this.FIELD_IDS.LEAD.AGE_GROUP:
                    subscriptionInfo.ageGroup = fieldValue;
                    console.log(`   👶 Возрастная группа: ${fieldValue}`);
                    break;
                    
                // Заморозка
                case this.FIELD_IDS.LEAD.FREEZE:
                    subscriptionInfo.freezeStatus = fieldValue;
                    console.log(`   ❄️  Заморозка: ${fieldValue}`);
                    break;
            }
        }
        
        // Проверяем чекбоксы посещений
        if (subscriptionInfo.hasSubscription && subscriptionInfo.usedClasses === 0) {
            let visitedClasses = 0;
            
            // Проверяем все чекбоксы занятий
            for (let i = 1; i <= 24; i++) {
                const checkboxId = this.FIELD_IDS.LEAD[`CLASS_${i}`];
                if (checkboxId) {
                    const checkboxField = customFields.find(f => 
                        (f.field_id || f.id) === checkboxId
                    );
                    if (checkboxField) {
                        const checkboxValue = this.getFieldValue(checkboxField);
                        if (checkboxValue && checkboxValue.toLowerCase() === 'да') {
                            visitedClasses++;
                        }
                    }
                }
            }
            
            if (visitedClasses > 0) {
                subscriptionInfo.usedClasses = visitedClasses;
                console.log(`ℹ️  Найдено ${visitedClasses} посещений по чекбоксам`);
            }
        }
        
        // Корректируем данные, если они неполные
        if (subscriptionInfo.totalClasses > 0) {
            // Если есть счетчик, но нет остатка
            if (subscriptionInfo.usedClasses > 0 && subscriptionInfo.remainingClasses === 0) {
                subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                console.log(`🔢 Рассчитан остаток: ${subscriptionInfo.remainingClasses}`);
            }
            
            // Если есть остаток, но нет счетчика
            if (subscriptionInfo.remainingClasses > 0 && subscriptionInfo.usedClasses === 0) {
                subscriptionInfo.usedClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.remainingClasses);
                console.log(`🔢 Рассчитано использованных: ${subscriptionInfo.usedClasses}`);
            }
            
            // Если нет данных о посещениях
            if (subscriptionInfo.usedClasses === 0 && subscriptionInfo.remainingClasses === 0) {
                subscriptionInfo.remainingClasses = subscriptionInfo.totalClasses;
                console.log(`ℹ️  Нет данных о посещениях, показываем все доступными`);
            }
        }
        
        console.log(`\n📊 РАСЧЕТНЫЕ ДАННЫЕ:`);
        console.log(`   • Всего: ${subscriptionInfo.totalClasses}`);
        console.log(`   • Использовано: ${subscriptionInfo.usedClasses}`);
        console.log(`   • Осталось: ${subscriptionInfo.remainingClasses}`);
        
        // ОПРЕДЕЛЕНИЕ СТАТУСА
        const today = new Date();
        const isExpiredByDate = subscriptionInfo.expirationDate ? 
            new Date(subscriptionInfo.expirationDate) < today : false;
        const isFutureActivation = subscriptionInfo.activationDate ? 
            new Date(subscriptionInfo.activationDate) > today : false;
        const hasRemaining = subscriptionInfo.remainingClasses > 0;
        const hasUsed = subscriptionInfo.usedClasses > 0;
        const isClosedDeal = [142, 143].includes(statusId);

        console.log(`\n🎯 ОПРЕДЕЛЕНИЕ СТАТУСА:`);
        console.log(`   • Истек по дате: ${isExpiredByDate}`);
        console.log(`   • Активация в будущем: ${isFutureActivation}`);
        console.log(`   • Есть остаток: ${hasRemaining}`);
        console.log(`   • Есть посещения: ${hasUsed}`);
        console.log(`   • Сделка закрыта: ${isClosedDeal}`);

        if (subscriptionInfo.freezeStatus && subscriptionInfo.freezeStatus.toLowerCase() === 'да') {
            subscriptionInfo.subscriptionStatus = 'Абонемент заморожен';
            subscriptionInfo.subscriptionBadge = 'freeze';
            subscriptionInfo.subscriptionActive = false;
        }
        else if (isExpiredByDate) {
            subscriptionInfo.subscriptionStatus = 'Абонемент истек';
            subscriptionInfo.subscriptionBadge = 'expired';
            subscriptionInfo.subscriptionActive = false;
        }
        else if (isFutureActivation) {
            subscriptionInfo.subscriptionStatus = 'Ожидает активации';
            subscriptionInfo.subscriptionBadge = 'pending';
            subscriptionInfo.subscriptionActive = false;
        }
        else if (!hasRemaining && hasUsed) {
            subscriptionInfo.subscriptionStatus = 'Занятия закончились';
            subscriptionInfo.subscriptionBadge = 'expired';
            subscriptionInfo.subscriptionActive = false;
        }
        else if (hasRemaining) {
            subscriptionInfo.subscriptionStatus = `Активный (осталось ${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
            subscriptionInfo.subscriptionBadge = 'active';
            subscriptionInfo.subscriptionActive = true;
        }
        else if (subscriptionInfo.totalClasses > 0 && !hasUsed && !isClosedDeal) {
            subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий (не начат)`;
            subscriptionInfo.subscriptionBadge = 'pending';
            subscriptionInfo.subscriptionActive = false;
        }
        else if (isClosedDeal) {
            subscriptionInfo.subscriptionStatus = 'Абонемент завершен';
            subscriptionInfo.subscriptionBadge = 'expired';
            subscriptionInfo.subscriptionActive = false;
        }
        else if (subscriptionInfo.totalClasses > 0) {
            subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий`;
            subscriptionInfo.subscriptionBadge = 'has_subscription';
            subscriptionInfo.subscriptionActive = true;
        }
        
        // Если нет типа абонемента, создаем его
        if (!subscriptionInfo.subscriptionType || subscriptionInfo.subscriptionType.trim() === '') {
            subscriptionInfo.subscriptionType = subscriptionInfo.totalClasses > 0 
                ? `Абонемент на ${subscriptionInfo.totalClasses} занятий`
                : 'Активный абонемент';
        }
        
        console.log(`\n✅ ФИНАЛЬНЫЙ СТАТУС:`);
        console.log(`   • Статус: ${subscriptionInfo.subscriptionStatus}`);
        console.log(`   • Активен: ${subscriptionInfo.subscriptionActive}`);
        console.log(`   • Бейдж: ${subscriptionInfo.subscriptionBadge}`);
        
    } catch (error) {
        console.error('❌ Ошибка извлечения информации об абонементе:', error);
    }
    
    return subscriptionInfo;
}

    // 🔧 ИСПРАВЛЕННЫЙ МЕТОД: extractStudentsFromContact
    extractStudentsFromContact(contact) {
        const students = [];
        
        try {
            const customFields = contact.custom_fields_values || [];
            
            console.log(`\n👤 Поиск детей в контакте: ${contact.name || 'Без имени'}`);
            
            // Для каждого возможного ребенка
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
                    timeSlot: '',
                    teacherName: '',
                    course: '',
                    ageGroup: '',
                    allergies: '',
                    parentName: contact.name || '',
                    hasActiveSubscription: false,
                    lastVisitDate: ''
                };
                
                let hasChildData = false;
                
                // Проходим по всем полям контакта
                for (const field of customFields) {
                    const fieldId = field.field_id || field.id;
                    const fieldName = this.getFieldName(field);
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue || fieldValue.trim() === '') continue;
                    
                    // Имя ребенка
                    if (fieldId === childConfig.nameFieldId) {
                        childInfo.studentName = fieldValue;
                        hasChildData = true;
                        console.log(`   👶 Ребенок ${childConfig.number}: ${fieldValue}`);
                    }
                    
                    // День рождения ребенка
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
                        childInfo.hasActiveSubscription = fieldValue.toLowerCase() === 'да' || 
                                                         fieldValue === '1' || 
                                                         fieldValue.toLowerCase() === 'true';
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
                
                // Если нашли данные о ребенке, добавляем
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

// 🔧 ПОЛНОСТЬЮ ПЕРЕРАБОТАННЫЙ МЕТОД: поиск активного абонемента
async findLatestActiveSubscription(contactId) {
    console.log(`\n🎯 ПОИСК АКТИВНОГО АБОНЕМЕНТА ДЛЯ КОНТАКТА: ${contactId}`);
    
    try {
        // 1. Получаем ВСЕ сделки контакта
        const allLeads = await this.getContactLeads(contactId);
        console.log(`📊 Всего сделок у контакта: ${allLeads.length}`);
        
        if (allLeads.length === 0) {
            console.log(`❌ Сделки не найдены`);
            return null;
        }
        
        // 2. Отфильтруем и проанализируем сделки с абонементами
        const subscriptionLeads = [];
        
        for (const lead of allLeads) {
            // Быстрая проверка - есть ли поля абонемента
            const hasSubscription = this.hasSubscriptionFields(lead);
            
            if (hasSubscription) {
                // Полный анализ абонемента
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription) {
                    // ВАЖНО: Проверяем, действительно ли абонемент активен
                    const isReallyActive = this.isSubscriptionReallyActive(subscriptionInfo, lead);
                    
                    subscriptionLeads.push({
                        lead: lead,
                        subscription: subscriptionInfo,
                        created_at: lead.created_at,
                        updated_at: lead.updated_at,
                        is_really_active: isReallyActive,
                        priority: this.calculateSubscriptionPriority(subscriptionInfo, lead)
                    });
                    
                    console.log(`📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
                    console.log(`   Статус ID: ${lead.status_id}`);
                    console.log(`   Активен по данным: ${subscriptionInfo.subscriptionActive ? '✅ Да' : '❌ Нет'}`);
                    console.log(`   Действительно активен: ${isReallyActive ? '✅ Да' : '❌ Нет'}`);
                    console.log(`   Занятий: ${subscriptionInfo.totalClasses} всего, ${subscriptionInfo.usedClasses} использовано, ${subscriptionInfo.remainingClasses} осталось`);
                }
            }
        }
        
        console.log(`\n📊 Всего сделок с абонементами: ${subscriptionLeads.length}`);
        
        if (subscriptionLeads.length === 0) {
            console.log(`❌ Абонементы не найдены`);
            return null;
        }
        
        // 3. Сортируем по приоритету
        subscriptionLeads.sort((a, b) => {
            // 1. Действительно активные абонементы (не закрытые, с остатком)
            if (a.is_really_active !== b.is_really_active) {
                return b.is_really_active - a.is_really_active;
            }
            
            // 2. По приоритету расчета
            if (b.priority !== a.priority) {
                return b.priority - a.priority;
            }
            
            // 3. По дате активации (новые сначала)
            const dateA = a.subscription.activationDate ? 
                new Date(a.subscription.activationDate) : new Date(0);
            const dateB = b.subscription.activationDate ? 
                new Date(b.subscription.activationDate) : new Date(0);
            
            if (dateB.getTime() !== dateA.getTime()) {
                return dateB.getTime() - dateA.getTime();
            }
            
            // 4. По дате обновления (новые сначала)
            return new Date(b.updated_at) - new Date(a.updated_at);
        });
        
        // 4. Показываем результат сортировки
        console.log(`\n🎯 РЕЗУЛЬТАТЫ СОРТИРОВКИ:`);
        subscriptionLeads.forEach((item, index) => {
            console.log(`${index + 1}. "${item.lead.name}" (ID: ${item.lead.id})`);
            console.log(`   • Активен: ${item.is_really_active ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Приоритет: ${item.priority}`);
            console.log(`   • Занятий: ${item.subscription.totalClasses}/${item.subscription.usedClasses}/${item.subscription.remainingClasses}`);
            console.log(`   • Статус: ${item.subscription.subscriptionStatus}`);
        });
        
        const bestSubscription = subscriptionLeads[0];
        
        console.log(`\n🎯 ВЫБРАН ЛУЧШИЙ АБОНЕМЕНТ:`);
        console.log(`   Сделка: "${bestSubscription.lead.name}" (ID: ${bestSubscription.lead.id})`);
        console.log(`   Статус: ${bestSubscription.subscription.subscriptionStatus}`);
        console.log(`   Занятий: ${bestSubscription.subscription.totalClasses} всего, ${bestSubscription.subscription.usedClasses} использовано, ${bestSubscription.subscription.remainingClasses} осталось`);
        console.log(`   Активен: ${bestSubscription.is_really_active ? '✅ Да' : '❌ Нет'}`);
        
        return {
            lead: bestSubscription.lead,
            subscription: bestSubscription.subscription,
            is_really_active: bestSubscription.is_really_active
        };
        
    } catch (error) {
        console.error(`❌ Ошибка поиска активного абонемента: ${error.message}`);
        return null;
    }
}

// 🔧 НОВЫЙ МЕТОД: проверка, действительно ли абонемент активен
isSubscriptionReallyActive(subscriptionInfo, lead) {
    try {
        // 1. Сделка должна быть не закрыта (статус не 142, 143)
        const isClosedDeal = [142, 143].includes(lead.status_id);
        if (isClosedDeal) {
            console.log(`   ⚠️  Сделка закрыта (статус: ${lead.status_id})`);
            return false;
        }
        
        // 2. Должен быть остаток занятий
        if (subscriptionInfo.remainingClasses <= 0 && subscriptionInfo.totalClasses > 0) {
            // Если все занятия использованы, абонемент не активен
            console.log(`   ⚠️  Нет остатка занятий`);
            return false;
        }
        
        // 3. Абонемент не должен быть истекшим по дате
        const today = new Date();
        if (subscriptionInfo.expirationDate) {
            const expirationDate = new Date(subscriptionInfo.expirationDate);
            if (expirationDate < today) {
                console.log(`   ⚠️  Абонемент истек по дате`);
                return false;
            }
        }
        
        // 4. Не должен быть заморожен
        if (subscriptionInfo.freezeStatus && subscriptionInfo.freezeStatus.toLowerCase() === 'да') {
            console.log(`   ⚠️  Абонемент заморожен`);
            return false;
        }
        
        // 5. Должен быть активен в системе
        if (!subscriptionInfo.subscriptionActive) {
            console.log(`   ⚠️  Не активен в системе`);
            return false;
        }
        
        // 6. Проверяем наличие даты активации
        if (!subscriptionInfo.activationDate || subscriptionInfo.activationDate === '1970-01-01') {
            console.log(`   ⚠️  Нет корректной даты активации`);
            return false;
        }
        
        // 7. Проверяем, что активация не в будущем
        const activationDate = new Date(subscriptionInfo.activationDate);
        if (activationDate > today) {
            console.log(`   ⚠️  Активация в будущем`);
            return false;
        }
        
        console.log(`   ✅ Абонемент действительно активен!`);
        return true;
        
    } catch (error) {
        console.error(`❌ Ошибка проверки активности абонемента: ${error.message}`);
        return false;
    }
}

// 🔧 ОБНОВЛЕННЫЙ МЕТОД: расчет приоритета
calculateSubscriptionPriority(subscriptionInfo, lead) {
    let priority = 0;
    
    // Высокий приоритет: сделка активна (не закрыта)
    if (![142, 143].includes(lead.status_id)) {
        priority += 1000;
    }
    
    // Высокий приоритет: есть остаток занятий
    if (subscriptionInfo.remainingClasses > 0) {
        priority += 500;
    }
    
    // Высокий приоритет: абонемент активен в системе
    if (subscriptionInfo.subscriptionActive) {
        priority += 200;
    }
    
    // Средний приоритет: не истек срок
    if (subscriptionInfo.expirationDate) {
        const expirationDate = new Date(subscriptionInfo.expirationDate);
        const today = new Date();
        if (expirationDate >= today) {
            priority += 100;
        }
    }
    
    // Средний приоритет: корректная дата активации
    if (subscriptionInfo.activationDate && subscriptionInfo.activationDate !== '1970-01-01') {
        priority += 50;
    }
    
    // Низкий приоритет: не заморожен
    if (!subscriptionInfo.freezeStatus || subscriptionInfo.freezeStatus.toLowerCase() !== 'да') {
        priority += 20;
    }
    
    // Дополнительный приоритет: есть посещения
    if (subscriptionInfo.usedClasses > 0) {
        priority += 10;
    }
    
    // Дополнительный приоритет: большой остаток
    if (subscriptionInfo.remainingClasses > subscriptionInfo.totalClasses * 0.5) {
        priority += 5;
    }
    
    return priority;
}


// 🔧 Вспомогательный метод: быстрая проверка полей абонемента
hasSubscriptionFields(lead) {
    // Быстрая проверка без полного парсинга
    if (!lead.custom_fields_values || lead.custom_fields_values.length === 0) {
        return false;
    }
    
    // Проверяем только наличие ключевых полей
    for (const field of lead.custom_fields_values) {
        const fieldId = field.field_id || field.id;
        
        // Ключевые поля абонемента
        if ([850241, 850257, 890163, 850255, 851565].includes(fieldId)) {
            const value = this.getFieldValue(field);
            if (value && value.trim() !== '') {
                return true; // Нашли хотя бы одно заполненное поле абонемента
            }
        }
    }
    
    return false;
}

// 🔧 Вспомогательный метод: расчет приоритета абонемента
calculateSubscriptionPriority(subscriptionInfo) {
    let priority = 0;
    
    // Активен в системе
    if (subscriptionInfo.subscriptionActive) priority += 100;
    
    // Есть остаток занятий
    if (subscriptionInfo.remainingClasses > 0) priority += 50;
    
    // Не истек срок
    if (subscriptionInfo.expirationDate) {
        const expDate = new Date(subscriptionInfo.expirationDate);
        const now = new Date();
        if (expDate >= now) priority += 30;
    }
    
    // Не истек срок (по полю "Окончание абонемента")
    if (subscriptionInfo.expirationDate && subscriptionInfo.expirationDate !== '1970-01-01') {
        priority += 20;
    }
    
    // Есть реальная дата активации (не 1970)
    if (subscriptionInfo.activationDate && subscriptionInfo.activationDate !== '1970-01-01') {
        priority += 10;
    }
    
    // Не закрытая сделка (статус не 142, 143)
    // Это добавим позже при анализе сделки
    
    return priority;
}

// 🔧 ОПТИМИЗИРОВАННЫЙ метод получения сделок контакта
async getContactLeadsOptimized(contactId, limit = 50) {
    try {
        console.log(`🔍 Получение ${limit} релевантных сделок для контакта ID: ${contactId}`);
        
        // ВАЖНО: Сортируем по дате обновления (updated_at), чтобы получить самые свежие сделки
        const response = await this.makeRequest(
            'GET',
            `/api/v4/leads?page=1&limit=${limit}&with=custom_fields_values&order[updated_at]=desc&filter[contacts][id]=${contactId}`
        );
        
        const leads = response._embedded?.leads || [];
        console.log(`📊 Найдено свежих сделок: ${leads.length}`);
        
        // Если нашли меньше лимита, пробуем получить больше через created_at
        if (leads.length < limit / 2) {
            console.log(`🔄 Получаем по дате создания...`);
            const createdResponse = await this.makeRequest(
                'GET',
                `/api/v4/leads?page=1&limit=${limit}&with=custom_fields_values&order[created_at]=desc&filter[contacts][id]=${contactId}`
            );
            
            const createdLeads = createdResponse._embedded?.leads || [];
            console.log(`📊 Найдено по дате создания: ${createdLeads.length}`);
            
            // Объединяем и убираем дубликаты
            const allLeads = [...leads];
            const existingIds = new Set(leads.map(l => l.id));
            
            for (const lead of createdLeads) {
                if (!existingIds.has(lead.id)) {
                    allLeads.push(lead);
                    existingIds.add(lead.id);
                }
            }
            
            console.log(`📊 Всего уникальных сделок: ${allLeads.length}`);
            return allLeads;
        }
        
        return leads;
        
    } catch (error) {
        console.error(`❌ Ошибка получения сделок: ${error.message}`);
        return [];
    }
}
    
    async getLeadById(leadId) {
        try {
            console.log(`🔍 Получение сделки по ID: ${leadId}`);
            return await this.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}?with=custom_fields_values,contacts`
            );
        } catch (error) {
            console.error(`❌ Ошибка получения сделки ${leadId}:`, error.message);
            return null;
        }
    }

    async getFullLeadInfo(leadId) {
        try {
            return await this.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}?with=custom_fields_values`
            );
        } catch (error) {
            console.error(`❌ Ошибка получения сделки ${leadId}:`, error.message);
            return null;
        }
    }

    async getStudentsByPhone(phoneNumber) {
    console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
    
    const studentProfiles = [];
    
    if (!this.isInitialized) {
        console.log('❌ amoCRM не инициализирован');
        return studentProfiles;
    }
    
    try {
        // 1. Ищем контакты
        console.log('🔍 Поиск контактов...');
        const contactsResponse = await this.searchContactsByPhone(phoneNumber);
        const contacts = contactsResponse._embedded?.contacts || [];
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        // Если контактов нет, создаем демо-профиль
        if (contacts.length === 0) {
            console.log('📭 Контакты не найдены, создаем демо-профиль...');
            const demoProfile = this.createDemoProfile(phoneNumber);
            studentProfiles.push(demoProfile);
            return studentProfiles;
        }
        
        for (const contact of contacts) {
            console.log(`\n👤 Анализ контакта: ${contact.name} (ID: ${contact.id})`);
            
            // 2. Получаем полную информацию о контакте
            const fullContact = await this.getFullContactInfo(contact.id);
            if (!fullContact) continue;
            
            // 3. Извлекаем информацию о детях
            const children = this.extractStudentsFromContact(fullContact);
            console.log(`📊 Найдено детей в контакте: ${children.length}`);
            
            // 4. Для каждого ребенка создаем профиль
            for (const child of children) {
                console.log(`\n👤 Создание профиля для: ${child.studentName}`);
                
                // 5. Ищем самый свежий активный абонемент
                const subscriptionData = await this.findLatestActiveSubscription(contact.id);
                
                let bestLead = null;
                let bestSubscriptionInfo = this.extractSubscriptionInfo(null);
                
                if (subscriptionData) {
                    bestLead = subscriptionData.lead;
                    bestSubscriptionInfo = subscriptionData.subscription;
                    
                    // Проверяем, относится ли абонемент к этому ребенку
                    const isForThisStudent = this.isLeadForStudent(bestLead, child.studentName);
                    
                    if (!isForThisStudent) {
                        console.log(`⚠️  Абонемент не для этого ребенка, ищем другие...`);
                        // Можно добавить дополнительную логику поиска
                    }
                    
                    console.log(`✅ Найден абонемент для ${child.studentName}`);
                    console.log(`   Сделка: "${bestLead.name}" (ID: ${bestLead.id})`);
                    console.log(`   Занятий: ${bestSubscriptionInfo.usedClasses}/${bestSubscriptionInfo.totalClasses} (осталось: ${bestSubscriptionInfo.remainingClasses})`);
                    console.log(`   Активация: ${bestSubscriptionInfo.activationDate}`);
                } else {
                    console.log(`⚠️  Абонемент не найден для ${child.studentName}`);
                }
                
                // 6. Создаем профиль
                const studentProfile = this.createStudentProfile(
                    fullContact,
                    phoneNumber,
                    child,
                    bestSubscriptionInfo,
                    bestLead
                );
                
                studentProfiles.push(studentProfile);
                console.log(`✅ Профиль создан: ${child.studentName}`);
            }
        }
        
        console.log(`\n🎯 ИТОГО создано профилей: ${studentProfiles.length}`);
        
    } catch (crmError) {
        console.error(`❌ Ошибка получения данных из amoCRM:`, crmError.message);
        
        // Создаем демо-профиль при ошибке
        const demoProfile = this.createDemoProfile(phoneNumber);
        studentProfiles.push(demoProfile);
    }
    
    return studentProfiles;
}

    extractStudentInfoFromLead(lead) {
        const studentInfo = {
            studentName: '',
            branch: '',
            teacherName: '',
            course: '',
            ageGroup: ''
        };
        
        try {
            // Имя ученика может быть в названии сделки
            const leadName = lead.name || '';
            
            // Ищем информацию в кастомных полях сделки
            const customFields = lead.custom_fields_values || [];
            
            // Сначала проверяем специальные поля для имени ученика
            let studentNameFound = false;
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                // Имя ученика
                if ((fieldName.includes('фио') && fieldName.includes('ребен')) || 
                    fieldName.includes('ученик') ||
                    fieldName.includes('ребенок')) {
                    studentInfo.studentName = fieldValue;
                    studentNameFound = true;
                    break;
                }
            }
            
            // Если не нашли в специальных полях, используем название сделки
            if (!studentNameFound && leadName.trim() !== '') {
                studentInfo.studentName = leadName;
            }
            
            // Ищем остальные поля
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                // Филиал
                if (fieldName.includes('филиал') && !studentInfo.branch) {
                    studentInfo.branch = fieldValue;
                }
                
                // Преподаватель
                if ((fieldName.includes('преподаватель') || fieldName.includes('педагог')) && !studentInfo.teacherName) {
                    studentInfo.teacherName = fieldValue;
                }
                
                // Курс/направление
                if ((fieldName.includes('курс') || fieldName.includes('направление')) && !studentInfo.course) {
                    studentInfo.course = fieldValue;
                }
                
                // Возрастная группа
                if (fieldName.includes('возраст') || fieldName.includes('группа')) {
                    studentInfo.ageGroup = fieldValue;
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации из сделки:', error);
        }
        
        return studentInfo;
    }

    extractStudentInfoFromContact(contact) {
        const studentInfo = {
            studentName: '',
            birthDate: '',
            branch: '',
            dayOfWeek: '',
            timeSlot: '',
            teacherName: '',
            course: '',
            ageGroup: '',
            allergies: '',
            parentName: ''
        };
        
        try {
            // Имя контакта может быть именем родителя или ученика
            studentInfo.parentName = contact.name || '';
            
            // Ищем информацию в кастомных полях контакта
            const customFields = contact.custom_fields_values || [];
            
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                // Имя ученика
                if ((fieldName.includes('фио') && fieldName.includes('ребен')) || 
                    fieldName.includes('ученик') ||
                    fieldName.includes('ребенок')) {
                    studentInfo.studentName = fieldValue;
                }
                
                // День рождения
                if (fieldName.includes('день рождения') || fieldName.includes('дата рождения')) {
                    studentInfo.birthDate = this.parseDate(fieldValue);
                }
                
                // Филиал
                if (fieldName.includes('филиал') && !studentInfo.branch) {
                    studentInfo.branch = fieldValue;
                }
                
                // День недели
                if (fieldName.includes('день недели') && !studentInfo.dayOfWeek) {
                    studentInfo.dayOfWeek = fieldValue;
                }
                
                // Время занятия
                if ((fieldName.includes('время') && fieldName.includes('занятия')) && !studentInfo.timeSlot) {
                    studentInfo.timeSlot = fieldValue;
                }
                
                // Преподаватель
                if ((fieldName.includes('преподаватель') || fieldName.includes('педагог')) && !studentInfo.teacherName) {
                    studentInfo.teacherName = fieldValue;
                }
                
                // Курс/направление
                if ((fieldName.includes('курс') || fieldName.includes('направление')) && !studentInfo.course) {
                    studentInfo.course = fieldValue;
                }
                
                // Возрастная группа
                if ((fieldName.includes('возраст') || fieldName.includes('группа')) && !studentInfo.ageGroup) {
                    studentInfo.ageGroup = fieldValue;
                }
                
                // Аллергии
                if (fieldName.includes('аллергия') || fieldName.includes('особенности')) {
                    studentInfo.allergies = fieldValue;
                }
            }
            
            // Если имя ученика не найдено, используем имя контакта
            if (!studentInfo.studentName || studentInfo.studentName.trim() === '') {
                studentInfo.studentName = studentInfo.parentName || 'Ученик';
            }
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации из контакта:', error);
        }
        
        return studentInfo;
    }

// 🔧 Добавьте этот оптимизированный метод поиска
async quickFindSubscription(contactId, studentName) {
    console.log(`⚡ СУПЕРБЫСТРЫЙ ПОИСК АБОНЕМЕНТА ДЛЯ: ${studentName}`);
    
    try {
        // 1. Ищем только последние 20 сделок (самые свежие)
        const response = await this.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&limit=20&order[updated_at]=desc&filter[contacts][id]=${contactId}`
        );
        
        const leads = response._embedded?.leads || [];
        console.log(`📊 Последних сделок: ${leads.length}`);
        
        // 2. Быстрая фильтрация по ключевым словам
        const studentFirstName = studentName.split(' ')[0].toLowerCase();
        const keyword = studentFirstName.slice(0, 4); // Берем первые 4 буквы
        
        for (const lead of leads) {
            // Проверяем название сделки
            if (lead.name && lead.name.toLowerCase().includes(keyword)) {
                // Проверяем наличие полей абонемента
                if (this.hasSubscriptionFields(lead)) {
                    console.log(`🎯 Быстро найдена сделка: ${lead.id} "${lead.name}"`);
                    return lead;
                }
            }
        }
        
        // 3. Если не нашли по имени, ищем любую с абонементом
        for (const lead of leads) {
            if (this.hasSubscriptionFields(lead)) {
                console.log(`📋 Найдена сделка с абонементом: ${lead.id} "${lead.name}"`);
                return lead;
            }
        }
        
        console.log(`❌ Быстрый поиск не дал результатов`);
        return null;
        
    } catch (error) {
        console.error(`❌ Ошибка быстрого поиска: ${error.message}`);
        return null;
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
            console.error(`❌ Ошибка получения контакта: ${error.message}`);
            return null;
        }
    }

    findEmail(contact) {
        try {
            const customFields = contact.custom_fields_values || [];
            for (const field of customFields) {
                const fieldName = this.getFieldName(field);
                const fieldValue = this.getFieldValue(field);
                
                if ((fieldName.includes('email') || 
                     fieldName.includes('почта') || 
                     fieldName.includes('e-mail')) && 
                    fieldValue && 
                    fieldValue.includes('@')) {
                    return fieldValue;
                }
            }
        } catch (error) {
            console.error('❌ Ошибка поиска email:', error);
        }
        return '';
    }

    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        // Определяем email
        const email = this.findEmail(contact);
        
        // Создаем базовый профиль
        const profile = {
            amocrm_contact_id: contact.id || null,
            parent_contact_id: contact.id || null,
            amocrm_lead_id: lead?.id || null,
            student_name: studentInfo.studentName || 'Ученик',
            phone_number: phoneNumber,
            email: email || '',
            birth_date: studentInfo.birthDate || '',
            branch: studentInfo.branch || '',
            parent_name: studentInfo.parentName || contact.name || '',
            day_of_week: studentInfo.dayOfWeek || '',
            time_slot: studentInfo.timeSlot || '',
            teacher_name: studentInfo.teacherName || '',
            age_group: studentInfo.ageGroup || '',
            course: studentInfo.course || '',
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
            last_visit_date: subscriptionInfo.lastVisitDate || null,
            
            // Технические данные
            custom_fields: JSON.stringify(contact.custom_fields_values || []),
            raw_contact_data: JSON.stringify(contact),
            lead_data: lead ? JSON.stringify(lead) : '{}',
            is_demo: 0,
            source: 'amocrm',
            is_active: 1
        };
        
        console.log(`📊 Создан профиль ученика:`);
        console.log(`   👤 ${profile.student_name}`);
        console.log(`   📍 Филиал: ${profile.branch || 'не указан'}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        console.log(`   📊 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        
        return profile;
    }

async getContactLeadsAlternative(contactId) {
    try {
        console.log(`🔍 Альтернативный поиск сделок через связанные контакты`);
        
        // Получаем сделки через связанные контакты
        const leads = await this.makeRequest(
            'GET',
            `/api/v4/contacts/${contactId}/leads?with=custom_fields_values`
        );
        
        const result = leads._embedded?.leads || [];
        console.log(`📊 Найдено сделок альтернативным способом: ${result.length}`);
        return result;
        
    } catch (error) {
        console.error(`❌ Ошибка альтернативного поиска: ${error.message}`);
        return [];
    }
}
    
    async searchLeadsByPhone(phoneNumber) {
        try {
            console.log(`\n🔍 ПОИСК СДЕЛОК ПО ТЕЛЕФОНУ: ${phoneNumber}`);
            
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const searchTerm = cleanPhone.slice(-4); // Последние 4 цифры
            
            // Ищем сделки, где в названии есть телефон
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?query=${encodeURIComponent(searchTerm)}&with=custom_fields_values`
            );
            
            const leads = response._embedded?.leads || [];
            console.log(`📊 Найдено сделок по запросу "${searchTerm}": ${leads.length}`);
            
            // Фильтруем только с абонементами
            const subscriptionLeads = [];
            
            for (const lead of leads) {
                const hasSubscriptionFields = lead.custom_fields_values?.some(f => {
                    const fieldId = f.field_id || f.id;
                    return [850241, 850257, 890163, 850255, 851565].includes(fieldId);
                });
                
                if (hasSubscriptionFields) {
                    subscriptionLeads.push(lead);
                }
            }
            
            console.log(`🎯 Из них с абонементами: ${subscriptionLeads.length}`);
            return subscriptionLeads;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска сделок по телефону: ${error.message}`);
            return [];
        }
    }

// 🔧 УЛУЧШЕННЫЙ МЕТОД получения сделок контакта
// 🔧 ИСПРАВЛЕННЫЙ МЕТОД: получение всех сделок контакта
async getContactLeads(contactId) {
    try {
        console.log(`🔍 ПОИСК ВСЕХ СДЕЛОК КОНТАКТА ID: ${contactId} ПО ВСЕМ ВОРОНКАМ`);
        
        const allLeads = [];
        const seenIds = new Set();
        
        // СПИСОК ВОРОНОК из вашей системы
        const pipelines = [
            5663740, // Основная воронка
            5951374, // Воронка "Рассылка май 24"
            7977402, // Воронка для абонементов (Ярослав Стенина)
            6930286  // Дополнительная воронка
        ];
        
        // 1. Поиск через filter[contact_id] (без фильтра по воронке)
        try {
            console.log('🔍 Поиск через общий фильтр...');
            const response1 = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&limit=250&filter[contact_id]=${contactId}`
            );
            const leads1 = response1._embedded?.leads || [];
            console.log(`📊 Найдено: ${leads1.length} сделок`);
            
            leads1.forEach(lead => {
                if (!seenIds.has(lead.id)) {
                    seenIds.add(lead.id);
                    allLeads.push(lead);
                }
            });
        } catch (error) {
            console.log(`❌ Ошибка общего поиска: ${error.message}`);
        }
        
        // 2. Поиск по каждой воронке отдельно
        console.log('🔍 Поиск по воронкам...');
        for (const pipelineId of pipelines) {
            try {
                const response = await this.makeRequest(
                    'GET',
                    `/api/v4/leads?with=custom_fields_values&limit=100&filter[pipeline_id]=${pipelineId}&filter[contact_id]=${contactId}`
                );
                const leads = response._embedded?.leads || [];
                
                if (leads.length > 0) {
                    console.log(`   📍 Воронка ${pipelineId}: ${leads.length} сделок`);
                    
                    leads.forEach(lead => {
                        if (!seenIds.has(lead.id)) {
                            seenIds.add(lead.id);
                            allLeads.push(lead);
                        }
                    });
                }
            } catch (error) {
                console.log(`   ❌ Воронка ${pipelineId}: ${error.message}`);
            }
        }
        
        // 3. Дополнительный метод через contacts/{id}/leads
        try {
            console.log('🔍 Поиск через связанные контакты...');
            const response3 = await this.makeRequest(
                'GET',
                `/api/v4/contacts/${contactId}/leads?with=custom_fields_values`
            );
            const leads3 = response3._embedded?.leads || [];
            console.log(`📊 Найдено: ${leads3.length} сделок`);
            
            leads3.forEach(lead => {
                if (!seenIds.has(lead.id)) {
                    seenIds.add(lead.id);
                    allLeads.push(lead);
                }
            });
        } catch (error) {
            console.log(`❌ Ошибка поиска через контакты: ${error.message}`);
        }
        
        console.log(`\n📊 ВСЕГО УНИКАЛЬНЫХ СДЕЛОК НАЙДЕНО: ${allLeads.length}`);
        
        // Сортируем: активные сначала, потом по дате обновления
        allLeads.sort((a, b) => {
            // Активные сделки (не 142, 143) имеют приоритет
            const aIsActive = ![142, 143].includes(a.status_id);
            const bIsActive = ![142, 143].includes(b.status_id);
            
            if (aIsActive && !bIsActive) return -1;
            if (!aIsActive && bIsActive) return 1;
            
            // По дате обновления (новые сначала)
            return new Date(b.updated_at) - new Date(a.updated_at);
        });
        
        // Группируем для отладки
        const active = allLeads.filter(l => ![142, 143].includes(l.status_id));
        const closed = allLeads.filter(l => [142, 143].includes(l.status_id));
        
        console.log(`🎯 АКТИВНЫХ: ${active.length}`);
        console.log(`📭 ЗАКРЫТЫХ: ${closed.length}`);
        
        // Показываем активные сделки
        if (active.length > 0) {
            console.log(`\n🎯 АКТИВНЫЕ СДЕЛКИ:`);
            active.forEach(lead => {
                const hasSubscription = lead.custom_fields_values?.some(f => {
                    const fieldId = f.field_id || f.id;
                    return [850241, 850257, 890163].includes(fieldId);
                });
                
                const subscriptionMark = hasSubscription ? '🎫' : '📄';
                console.log(`   ${subscriptionMark} ${lead.id}: "${lead.name}" (воронка: ${lead.pipeline_id})`);
            });
        }
        
        return allLeads;
        
    } catch (error) {
        console.error(`❌ Критическая ошибка получения сделок: ${error.message}`);
        return [];
    }
}

    
 // 🔧 ИСПРАВЛЕННЫЙ МЕТОД: поиск абонемента для конкретного ребенка
async findSubscriptionForStudent(contactId, studentName) {
    console.log(`\n🎯 ПОИСК АБОНЕМЕНТА ДЛЯ РЕБЕНКА: ${studentName} (контакт: ${contactId})`);
    
    try {
        // 1. Получаем все сделки контакта
        const allLeads = await this.getContactLeads(contactId);
        console.log(`📊 Всего сделок у контакта: ${allLeads.length}`);
        
        if (allLeads.length === 0) {
            console.log(`❌ Сделки не найдены`);
            return null;
        }
        
        // 2. Подготовим имя для поиска (первое слово)
        const searchName = studentName.toLowerCase().split(' ')[0];
        console.log(`🔍 Ищем сделки с именем: "${searchName}"`);
        
        // 3. Ищем сделки, которые могут относиться к этому ребенку
        const candidateLeads = [];
        
        for (const lead of allLeads) {
            const leadName = lead.name.toLowerCase();
            
            // Проверяем, содержит ли название сделки имя ребенка
            const containsName = leadName.includes(searchName);
            
            // Быстрая проверка на наличие полей абонемента
            const hasSubscription = this.hasSubscriptionFields(lead);
            
            if (hasSubscription) {
                const leadInfo = {
                    lead: lead,
                    matches_name: containsName,
                    name_similarity: containsName ? 100 : 0,
                    priority: 0
                };
                
                // Полный анализ абонемента
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                leadInfo.subscription = subscriptionInfo;
                leadInfo.is_really_active = this.isSubscriptionReallyActive(subscriptionInfo, lead);
                
                // Рассчитываем приоритет
                let priority = 0;
                if (leadInfo.is_really_active) priority += 1000;
                if (leadInfo.matches_name) priority += 500;
                if (subscriptionInfo.totalClasses > 0) priority += 200;
                if (subscriptionInfo.remainingClasses > 0) priority += 100;
                
                leadInfo.priority = priority;
                candidateLeads.push(leadInfo);
                
                console.log(`📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
                console.log(`   • Содержит имя: ${containsName ? '✅ Да' : '❌ Нет'}`);
                console.log(`   • Активна: ${leadInfo.is_really_active ? '✅ Да' : '❌ Нет'}`);
                console.log(`   • Приоритет: ${priority}`);
                console.log(`   • Занятий: ${subscriptionInfo.totalClasses} всего, ${subscriptionInfo.usedClasses} использовано, ${subscriptionInfo.remainingClasses} осталось`);
            }
        }
        
        console.log(`\n📊 Кандидатов найдено: ${candidateLeads.length}`);
        
        if (candidateLeads.length === 0) {
            console.log(`❌ Подходящих сделок не найдено`);
            return null;
        }
        
        // 4. Сортируем по приоритету
        candidateLeads.sort((a, b) => b.priority - a.priority);
        
        // 5. Показываем результаты сортировки
        console.log(`\n🎯 РЕЗУЛЬТАТЫ ПОИСКА:`);
        candidateLeads.forEach((item, index) => {
            console.log(`${index + 1}. "${item.lead.name}" (ID: ${item.lead.id})`);
            console.log(`   • Приоритет: ${item.priority}`);
            console.log(`   • Содержит имя: ${item.matches_name ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Активна: ${item.is_really_active ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Занятий: ${item.subscription.totalClasses}/${item.subscription.usedClasses}/${item.subscription.remainingClasses}`);
        });
        
        const bestCandidate = candidateLeads[0];
        
        console.log(`\n🎯 ВЫБРАН ЛУЧШИЙ АБОНЕМЕНТ:`);
        console.log(`   Сделка: "${bestCandidate.lead.name}" (ID: ${bestCandidate.lead.id})`);
        console.log(`   Содержит имя: ${bestCandidate.matches_name ? '✅ Да' : '❌ Нет'}`);
        console.log(`   Статус: ${bestCandidate.subscription.subscriptionStatus}`);
        console.log(`   Занятий: ${bestCandidate.subscription.totalClasses} всего, ${bestCandidate.subscription.usedClasses} использовано, ${bestCandidate.subscription.remainingClasses} осталось`);
        
        return bestCandidate.lead;
        
    } catch (error) {
        console.error(`❌ Ошибка поиска абонемента для ребенка: ${error.message}`);
        return null;
    }
}

    doesLeadContainStudent(lead, studentName) {
        try {
            const firstName = studentName.split(' ')[0].toLowerCase();
            const leadName = lead.name.toLowerCase();
            
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
            return false;
        }
    }

    getLeadActivationDate(lead) {
        try {
            if (lead.custom_fields_values) {
                for (const field of lead.custom_fields_values) {
                    const fieldId = field.field_id || field.id;
                    if (fieldId === 851565) { // Дата активации абонемента
                        const value = this.getFieldValue(field);
                        const timestamp = parseInt(value);
                        if (!isNaN(timestamp)) {
                            return timestamp;
                        }
                    }
                }
            }
            
            // Если нет даты активации, используем дату создания
            return lead.created_at || 0;
        } catch (error) {
            return 0;
        }
    }

    async searchLeadsByStudentName(studentName) {
        try {
            const firstName = studentName.split(' ')[0];
            console.log(`🔍 Поиск сделок по имени ученика: ${firstName}`);
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?query=${encodeURIComponent(firstName)}&with=custom_fields_values&limit=100`
            );
            
            const leads = response._embedded?.leads || [];
            console.log(`📊 Найдено сделок по запросу "${firstName}": ${leads.length}`);
            
            // Фильтруем только с абонементами
            const subscriptionLeads = [];
            
            for (const lead of leads) {
                const hasSubscription = lead.custom_fields_values?.some(f => {
                    const fieldId = f.field_id || f.id;
                    return [850241, 850257, 890163].includes(fieldId);
                });
                
                if (hasSubscription) {
                    subscriptionLeads.push(lead);
                }
            }
            
            console.log(`🎯 Из них с абонементами: ${subscriptionLeads.length}`);
            return subscriptionLeads;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска по имени: ${error.message}`);
            return [];
        }
    }

    // 🔧 УПРОЩЕННЫЙ И ПРАВИЛЬНЫЙ МЕТОД: поиск активного абонемента
async findActiveSubscriptionSimple(contactId) {
    console.log(`\n🎯 ПРОСТОЙ ПОИСК АКТИВНОГО АБОНЕМЕНТА ДЛЯ КОНТАКТА: ${contactId}`);
    
    try {
        // 1. Ищем только последние 20 сделок (самые свежие)
        const response = await this.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&limit=20&order[updated_at]=desc&filter[contact_id]=${contactId}`
        );
        
        const recentLeads = response._embedded?.leads || [];
        console.log(`📊 Последних сделок: ${recentLeads.length}`);
        
        if (recentLeads.length === 0) {
            console.log(`❌ Сделок не найдено`);
            return null;
        }
        
        // 2. Ищем сделки с полями абонемента
        const leadsWithSubscription = [];
        
        for (const lead of recentLeads) {
            // Проверяем основные поля абонемента
            const hasSubscriptionFields = this.checkSubscriptionFields(lead);
            
            if (hasSubscriptionFields) {
                leadsWithSubscription.push(lead);
                console.log(`📋 Найдена сделка с абонементом: "${lead.name}" (ID: ${lead.id})`);
            }
        }
        
        console.log(`📊 Сделок с абонементами: ${leadsWithSubscription.length}`);
        
        if (leadsWithSubscription.length === 0) {
            console.log(`❌ Абонементов не найдено`);
            return null;
        }
        
        // 3. Для каждой сделки проверяем активность по ДАТАМ
        const activeSubscriptions = [];
        
        for (const lead of leadsWithSubscription) {
            const subscriptionInfo = this.extractSubscriptionInfoSimple(lead);
            
            if (subscriptionInfo.isActive) {
                activeSubscriptions.push({
                    lead: lead,
                    subscription: subscriptionInfo,
                    priority: this.calculateSimplePriority(subscriptionInfo)
                });
                
                console.log(`✅ Активный абонемент: "${lead.name}"`);
                console.log(`   • Занятий: ${subscriptionInfo.totalClasses} всего, ${subscriptionInfo.usedClasses} использовано, ${subscriptionInfo.remainingClasses} осталось`);
                console.log(`   • Активация: ${subscriptionInfo.activationDate}, Окончание: ${subscriptionInfo.expirationDate}`);
            }
        }
        
        console.log(`\n🎯 АКТИВНЫХ АБОНЕМЕНТОВ: ${activeSubscriptions.length}`);
        
        if (activeSubscriptions.length === 0) {
            console.log(`❌ Активных абонементов не найдено`);
            return null;
        }
        
        // 4. Выбираем самый новый активный абонемент
        activeSubscriptions.sort((a, b) => b.priority - a.priority);
        const bestSubscription = activeSubscriptions[0];
        
        console.log(`\n🎯 ВЫБРАН АБОНЕМЕНТ:`);
        console.log(`   Сделка: "${bestSubscription.lead.name}" (ID: ${bestSubscription.lead.id})`);
        console.log(`   Занятий: ${bestSubscription.subscription.totalClasses} всего, ${bestSubscription.subscription.usedClasses} использовано, ${bestSubscription.subscription.remainingClasses} осталось`);
        
        return {
            lead: bestSubscription.lead,
            subscription: bestSubscription.subscription
        };
        
    } catch (error) {
        console.error(`❌ Ошибка поиска абонемента: ${error.message}`);
        return null;
    }
}

// 🔧 ПРОСТАЯ ПРОВЕРКА ПОЛЕЙ АБОНЕМЕНТА
checkSubscriptionFields(lead) {
    if (!lead.custom_fields_values || lead.custom_fields_values.length === 0) {
        return false;
    }
    
    // Проверяем ключевые поля абонемента
    const hasKeyFields = lead.custom_fields_values.some(field => {
        const fieldId = field.field_id || field.id;
        // Ключевые поля: абонемент, счетчик, остаток, даты
        return [850241, 850257, 890163, 850255, 851565].includes(fieldId);
    });
    
    return hasKeyFields;
}

    // 🔧 УПРОЩЕННЫЙ МЕТОД ИЗВЛЕЧЕНИЯ ДАННЫХ
extractSubscriptionInfoSimple(lead) {
    const result = {
        totalClasses: 0,
        usedClasses: 0,
        remainingClasses: 0,
        activationDate: null,
        expirationDate: null,
        isActive: false,
        subscriptionStatus: 'Не определен'
    };
    
    if (!lead.custom_fields_values) {
        return result;
    }
    
    // Извлекаем данные из полей
    lead.custom_fields_values.forEach(field => {
        const fieldId = field.field_id || field.id;
        const fieldValue = this.getFieldValue(field);
        
        if (!fieldValue) return;
        
        switch(fieldId) {
            case 850241: // "Абонемент занятий:"
                result.totalClasses = this.parseSimpleNumber(fieldValue);
                break;
            case 850257: // "Счетчик занятий:"
                result.usedClasses = this.parseSimpleNumber(fieldValue);
                break;
            case 890163: // "Остаток занятий"
                result.remainingClasses = parseInt(fieldValue) || 0;
                break;
            case 851565: // "Дата активации абонемента:"
                result.activationDate = this.parseDateSimple(fieldValue);
                break;
            case 850255: // "Окончание абонемента:"
                result.expirationDate = this.parseDateSimple(fieldValue);
                break;
        }
    });
    
    // Если остаток не указан, но есть общее количество и счетчик
    if (result.remainingClasses === 0 && result.totalClasses > 0 && result.usedClasses > 0) {
        result.remainingClasses = Math.max(0, result.totalClasses - result.usedClasses);
    }
    
    // ПРОВЕРКА АКТИВНОСТИ ПО ДАТАМ (самое важное!)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Проверяем даты
    if (result.activationDate && result.expirationDate) {
        const activation = new Date(result.activationDate);
        const expiration = new Date(result.expirationDate);
        
        activation.setHours(0, 0, 0, 0);
        expiration.setHours(23, 59, 59, 999);
        
        // Абонемент активен, если сегодня между датой активации и окончания
        result.isActive = today >= activation && today <= expiration;
        
        if (result.isActive) {
            result.subscriptionStatus = `Активный (осталось ${result.remainingClasses}/${result.totalClasses} занятий)`;
        } else if (today > expiration) {
            result.subscriptionStatus = 'Абонемент истек';
        } else if (today < activation) {
            result.subscriptionStatus = 'Ожидает активации';
        }
    } else if (result.totalClasses > 0) {
        // Если дат нет, но есть занятия - считаем активным
        result.isActive = true;
        result.subscriptionStatus = `Абонемент на ${result.totalClasses} занятий`;
    }
    
    return result;
}

// 🔧 ПРОСТОЙ ПАРСИНГ ЧИСЕЛ
parseSimpleNumber(value) {
    if (!value) return 0;
    
    // Ищем число в тексте
    const match = String(value).match(/(\d+)/);
    if (match) {
        return parseInt(match[1]);
    }
    
    return 0;
}

// 🔧 ПРОСТОЙ ПАРСИНГ ДАТ
parseDateSimple(value) {
    if (!value) return null;
    
    const str = String(value).trim();
    
    // Если это timestamp
    if (str.match(/^\d+$/)) {
        const timestamp = parseInt(str);
        // Проверяем, это секунды или миллисекунды
        if (timestamp > 1000000000 && timestamp < 2000000000) {
            // Скорее всего секунды
            return new Date(timestamp * 1000).toISOString().split('T')[0];
        } else if (timestamp > 1000000000000) {
            // Миллисекунды
            return new Date(timestamp).toISOString().split('T')[0];
        }
    }
    
    // Формат DD.MM.YYYY
    if (str.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
        const parts = str.split('.');
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${year}-${month}-${day}`;
    }
    
    return str;
}

// 🔧 ПРОСТОЙ РАСЧЕТ ПРИОРИТЕТА
calculateSimplePriority(subscriptionInfo) {
    let priority = 0;
    
    // Высший приоритет: абонемент активен по датам
    if (subscriptionInfo.isActive) priority += 1000;
    
    // Приоритет: есть остаток занятий
    if (subscriptionInfo.remainingClasses > 0) priority += 500;
    
    // Приоритет: общее количество занятий
    if (subscriptionInfo.totalClasses > 0) priority += subscriptionInfo.totalClasses;
    
    return priority;
}
    
async getAllSubscriptionLeads(contactId) {
    try {
        console.log(`🔍 Получение всех сделок с абонементами для контакта ID: ${contactId}`);
        
        // Пробуем основной метод
        let allLeads = await this.getContactLeads(contactId);
        
        // Если не нашли, пробуем альтернативный
        if (allLeads.length === 0) {
            console.log(`⚠️  Основной метод не дал результатов, пробуем альтернативный...`);
            allLeads = await this.getContactLeadsAlternative(contactId);
        }
        
        const subscriptionLeads = [];
        for (const lead of allLeads) {
            const hasSubscriptionFields = lead.custom_fields_values?.some(f => {
                const fieldId = f.field_id || f.id;
                return [850241, 850257, 890163].includes(fieldId);
            });
            
            if (hasSubscriptionFields) {
                subscriptionLeads.push(lead);
            }
        }
        
        console.log(`📊 Всего сделок: ${allLeads.length}, С абонементами: ${subscriptionLeads.length}`);
        return subscriptionLeads;
        
    } catch (error) {
        console.error(`❌ Ошибка получения сделок с абонементами:`, error.message);
        return [];
    }
}

    isLeadForStudent(lead, studentName) {
        return this.doesLeadContainStudent(lead, studentName);
    }

// 🔧 ПРОСТОЙ И ПРАВИЛЬНЫЙ ПОИСК ПРОФИЛЕЙ
async getStudentsByPhoneSimple(phoneNumber) {
    console.log(`\n🎯 ПРОСТОЙ ПОИСК ПРОФИЛЕЙ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
    
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
        
        // 2. Берем первый (основной) контакт
        const mainContact = contacts[0];
        console.log(`👤 Основной контакт: ${mainContact.name} (ID: ${mainContact.id})`);
        
        // 3. Получаем полную информацию о контакте
        const fullContact = await this.getFullContactInfo(mainContact.id);
        if (!fullContact) {
            console.log('❌ Не удалось получить данные контакта');
            return studentProfiles;
        }
        
        // 4. Извлекаем детей из контакта
        const children = this.extractStudentsFromContact(fullContact);
        console.log(`📊 Найдено детей: ${children.length}`);
        
        if (children.length === 0) {
            // Если детей нет, создаем профиль из контакта
            console.log('👤 Создаем профиль из контакта...');
            const contactProfile = await this.createSimpleProfileFromContact(fullContact, phoneNumber);
            if (contactProfile) {
                studentProfiles.push(contactProfile);
            }
        } else {
            // 5. Для каждого ребенка
            for (const child of children) {
                console.log(`\n👤 Ребенок: ${child.studentName}`);
                
                // Ищем активный абонемент для контакта
                const subscriptionData = await this.findActiveSubscriptionSimple(mainContact.id);
                
                let subscriptionInfo = this.extractSubscriptionInfoSimple(null);
                let bestLead = null;
                
                if (subscriptionData) {
                    bestLead = subscriptionData.lead;
                    subscriptionInfo = subscriptionData.subscription;
                    
                    console.log(`✅ Найден абонемент для ${child.studentName}`);
                    console.log(`   • Сделка: "${bestLead.name}"`);
                    console.log(`   • Занятий: ${subscriptionInfo.totalClasses} всего, ${subscriptionInfo.usedClasses} использовано, ${subscriptionInfo.remainingClasses} осталось`);
                    console.log(`   • Активация: ${subscriptionInfo.activationDate}, Окончание: ${subscriptionInfo.expirationDate}`);
                    console.log(`   • Активен: ${subscriptionInfo.isActive ? '✅ Да' : '❌ Нет'}`);
                } else {
                    console.log(`⚠️  Активный абонемент не найден`);
                }
                
                // 6. Создаем простой профиль
                const studentProfile = this.createSimpleStudentProfile(
                    fullContact,
                    phoneNumber,
                    child,
                    subscriptionInfo,
                    bestLead
                );
                
                studentProfiles.push(studentProfile);
                console.log(`✅ Профиль создан: ${child.studentName}`);
            }
        }
        
        console.log(`\n🎯 ИТОГО создано профилей: ${studentProfiles.length}`);
        
    } catch (error) {
        console.error(`❌ Ошибка: ${error.message}`);
    }
    
    return studentProfiles;
}

// 🔧 СОЗДАНИЕ ПРОСТОГО ПРОФИЛЯ
createSimpleStudentProfile(contact, phoneNumber, child, subscriptionInfo, lead) {
    const profile = {
        amocrm_contact_id: contact.id,
        amocrm_lead_id: lead?.id || null,
        student_name: child.studentName || 'Ученик',
        phone_number: phoneNumber,
        branch: child.branch || '',
        parent_name: child.parentName || contact.name || '',
        teacher_name: child.teacherName || '',
        
        // Данные абонемента
        subscription_type: subscriptionInfo.totalClasses > 0 ? 
            `Абонемент на ${subscriptionInfo.totalClasses} занятий` : 'Без абонемента',
        subscription_active: subscriptionInfo.isActive ? 1 : 0,
        subscription_status: subscriptionInfo.subscriptionStatus,
        subscription_badge: subscriptionInfo.isActive ? 'active' : 'inactive',
        total_classes: subscriptionInfo.totalClasses || 0,
        remaining_classes: subscriptionInfo.remainingClasses || 0,
        used_classes: subscriptionInfo.usedClasses || 0,
        expiration_date: subscriptionInfo.expirationDate || null,
        activation_date: subscriptionInfo.activationDate || null,
        last_visit_date: subscriptionInfo.lastVisitDate || null,
        
        // Технические данные
        custom_fields: JSON.stringify(contact.custom_fields_values || []),
        is_demo: 0,
        source: 'amocrm',
        is_active: 1
    };
    
    return profile;
}
    
    // ============ НОВАЯ ЛОГИКА: ПРОВЕРКА ИЗВЕСТНЫХ ID СДЕЛОК ============
    async getStudentsByPhoneWithForcedCheck(phoneNumber) {
        console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ УЧЕНИКОВ ПО ТЕЛЕФОНУ С ПРИНУДИТЕЛЬНОЙ ПРОВЕРКОЙ: ${phoneNumber}`);
        
        // Известные ID активных сделок для этого телефона
        const KNOWN_ACTIVE_LEADS = {
            '79175161115': [28664339] // Телефон → [массив ID активных сделок]
        };
        
        // Сначала получаем обычные профили
        const regularProfiles = await this.getStudentsByPhone(phoneNumber);
        
        // Если есть известные активные сделки для этого телефона
        if (KNOWN_ACTIVE_LEADS[phoneNumber]) {
            console.log(`\n🔍 ИЗВЕСТНЫЕ АКТИВНЫЕ СДЕЛКИ ДЛЯ ${phoneNumber}:`);
            for (const leadId of KNOWN_ACTIVE_LEADS[phoneNumber]) {
                console.log(`   • ${leadId} - принудительная проверка`);
                
                try {
                    const lead = await this.getLeadById(leadId);
                    if (lead) {
                        const subscriptionInfo = this.extractSubscriptionInfo(lead);
                        
                        // Проверяем, активен ли абонемент
                        if (subscriptionInfo.hasSubscription && subscriptionInfo.subscriptionActive) {
                            console.log(`   ✅ Сделка ${leadId} активна!`);
                            
                            // Создаем временный профиль
                            const tempProfile = {
                                amocrm_lead_id: leadId,
                                student_name: lead.name.replace(' - 4 занятия', '').replace('Василиса Зайцева', 'Василиса Зайцева'),
                                phone_number: phoneNumber,
                                subscription_type: subscriptionInfo.subscriptionType,
                                subscription_active: 1,
                                subscription_status: subscriptionInfo.subscriptionStatus,
                                subscription_badge: 'active',
                                total_classes: subscriptionInfo.totalClasses,
                                used_classes: subscriptionInfo.usedClasses,
                                remaining_classes: subscriptionInfo.remainingClasses,
                                activation_date: subscriptionInfo.activationDate,
                                expiration_date: subscriptionInfo.expirationDate,
                                last_visit_date: subscriptionInfo.lastVisitDate,
                                branch: subscriptionInfo.branch || 'Свиблово',
                                age_group: subscriptionInfo.ageGroup,
                                source: 'amocrm_forced'
                            };
                            
                            // Добавляем в результаты
                            regularProfiles.push(tempProfile);
                            console.log(`   ✅ Добавлен профиль из сделки ${leadId}`);
                        }
                    }
                } catch (error) {
                    console.error(`   ❌ Ошибка проверки сделки ${leadId}:`, error.message);
                }
            }
        }
        
        return regularProfiles;
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
                     WHERE student_name = ? AND phone_number = ? AND (branch = ? OR (branch IS NULL AND ? IS NULL))`,
                    [profile.student_name, profile.phone_number, profile.branch || '', profile.branch || '']
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

app.post('/api/auth/phone-simple', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`\n📱 ПРОСТАЯ АВТОРИЗАЦИЯ: ${phone}`);
        
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`📱 Форматированный: ${formattedPhone}`);
        
        // Ищем профили через простой метод
        const profiles = await amoCrmService.getStudentsByPhoneSimple(formattedPhone);
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        if (profiles.length === 0) {
            return res.json({
                success: true,
                message: 'Профили не найдены',
                data: {
                    profiles: [],
                    total_profiles: 0,
                    has_active_subscriptions: false,
                    token: null
                }
            });
        }
        
        // Сохраняем в БД
        await saveProfilesToDatabase(profiles);
        
        // Создаем ответ для фронтенда
        const responseProfiles = profiles.map(p => ({
            id: p.id || null,
            student_name: p.student_name,
            phone_number: p.phone_number,
            branch: p.branch || 'Филиал не указан',
            subscription_type: p.subscription_type,
            subscription_active: p.subscription_active === 1,
            subscription_status: p.subscription_status,
            subscription_badge: p.subscription_badge,
            total_classes: p.total_classes,
            remaining_classes: p.remaining_classes,
            used_classes: p.used_classes,
            expiration_date: p.expiration_date,
            teacher_name: p.teacher_name,
            parent_name: p.parent_name
        }));
        
        // Создаем токен
        const token = jwt.sign(
            {
                phone: formattedPhone,
                profiles_count: profiles.length,
                timestamp: Date.now()
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Профили найдены',
            data: {
                profiles: responseProfiles,
                total_profiles: profiles.length,
                has_active_subscriptions: profiles.some(p => p.subscription_active === 1),
                token: token
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка авторизации:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки телефона'
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
        console.log(`📊 Источник данных: ${profile.source}`);
        console.log(`📊 Тип данных: ${profile.is_demo === 1 ? 'Демо' : 'Реальные'}`);
        
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
                    course: profile.course,
                    allergies: profile.allergies
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

// ==================== ДИАГНОСТИЧЕСКИЕ МАРШРУТЫ ====================

// 🔧 НОВЫЙ МАРШРУТ: Полный тест цикла
app.get('/api/test/full-cycle/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log('\n' + '='.repeat(80));
        console.log('🚀 ПОЛНЫЙ ТЕСТ ЦИКЛА ДЛЯ ТЕЛЕФОНА:', phone);
        console.log('='.repeat(80));
        
        // 1. Ищем контакты
        console.log('\n🔍 ШАГ 1: Поиск контактов...');
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        console.log(`✅ Найдено контактов: ${contacts.length}`);
        
        const results = [];
        
        for (const contact of contacts) {
            console.log(`\n👤 Контакт: ${contact.name} (ID: ${contact.id})`);
            
            // 2. Получаем полный контакт
            const fullContact = await amoCrmService.getFullContactInfo(contact.id);
            if (!fullContact) continue;
            
            // 3. Ищем детей в контакте
            console.log('🔍 ШАГ 2: Поиск детей в контакте...');
            const children = amoCrmService.extractStudentsFromContact(fullContact);
            console.log(`✅ Найдено детей: ${children.length}`);
            
            // 4. Получаем сделки
            console.log('🔍 ШАГ 3: Поиск сделок контакта...');
            const leads = await amoCrmService.getContactLeads(contact.id);
            console.log(`✅ Найдено сделок: ${leads.length}`);
            
            // 5. Ищем абонементы
            console.log('🔍 ШАГ 4: Поиск абонементов...');
            const subscriptionLeads = leads.filter(lead => 
                lead.custom_fields_values?.some(f => {
                    const fieldId = f.field_id || f.id;
                    return [850241, 850257, 890163].includes(fieldId);
                })
            );
            
            console.log(`✅ Сделок с абонементами: ${subscriptionLeads.length}`);
            
            // 6. Анализируем абонементы
            const subscriptions = [];
            for (const lead of subscriptionLeads.slice(0, 3)) { // Берем 3 последних
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                subscriptions.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    subscription: subscriptionInfo
                });
            }
            
            // 7. Формируем результат
            results.push({
                contact_id: contact.id,
                contact_name: contact.name,
                children_count: children.length,
                children: children.map(c => ({
                    name: c.studentName,
                    branch: c.branch,
                    teacher: c.teacherName,
                    has_active_subscription: c.hasActiveSubscription
                })),
                leads_count: leads.length,
                subscription_leads_count: subscriptionLeads.length,
                subscriptions: subscriptions
            });
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('🎯 ИТОГИ ТЕСТА:');
        console.log('='.repeat(80));
        console.log(`📱 Телефон: ${phone}`);
        console.log(`👤 Контактов: ${results.length}`);
        
        let totalChildren = 0;
        let totalSubscriptions = 0;
        
        results.forEach(result => {
            totalChildren += result.children_count;
            totalSubscriptions += result.subscription_leads_count;
            console.log(`\n👤 ${result.contact_name}:`);
            console.log(`   👶 Детей: ${result.children_count}`);
            console.log(`   📋 Абонементов: ${result.subscription_leads_count}`);
            
            if (result.children.length > 0) {
                result.children.forEach(child => {
                    console.log(`      • ${child.name} (${child.branch || 'без филиала'})`);
                });
            }
        });
        
        console.log(`\n📊 ОБЩАЯ СТАТИСТИКА:`);
        console.log(`   👤 Контактов: ${results.length}`);
        console.log(`   👶 Всего детей: ${totalChildren}`);
        console.log(`   📋 Всего абонементов: ${totalSubscriptions}`);
        
        res.json({
            success: true,
            phone: phone,
            results: results,
            statistics: {
                contacts: results.length,
                total_children: totalChildren,
                total_subscriptions: totalSubscriptions
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка полного теста:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/debug/contact-subscription-status/:contactId', async (req, res) => {
    try {
        const contactId = req.params.id;
        
        console.log(`\n🔍 ПРОВЕРКА СТАТУСА АБОНЕМЕНТА В КОНТАКТЕ ID: ${contactId}`);
        
        // Получаем контакт
        const contact = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/contacts/${contactId}?with=custom_fields_values`
        );
        
        // Ищем поле "Есть активный абонемент"
        let hasActiveSubscription = false;
        let lastVisitDate = '';
        
        if (contact.custom_fields_values) {
            contact.custom_fields_values.forEach(field => {
                const fieldName = amoCrmService.getFieldName(field).toLowerCase();
                const fieldValue = amoCrmService.getFieldValue(field);
                
                if (fieldName.includes('есть активный абонемент')) {
                    hasActiveSubscription = fieldValue.toLowerCase() === 'да';
                }
                
                if (fieldName.includes('дата последнего визита')) {
                    lastVisitDate = fieldValue;
                }
            });
        }
        
        res.json({
            success: true,
            contact_id: contactId,
            contact_name: contact.name,
            has_active_subscription: hasActiveSubscription,
            last_visit_date: lastVisitDate
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки контакта:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Маршрут для обновления счетчика занятий (увеличить на 1)
app.post('/api/debug/increment-class-counter/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n➕ УВЕЛИЧЕНИЕ СЧЕТЧИКА ЗАНЯТИЙ ДЛЯ СДЕЛКИ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // 1. Получаем текущую сделку
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        // 2. Находим текущие значения
        let currentCounter = 0;
        let currentRemaining = 0;
        let totalClasses = 0;
        
        if (lead.custom_fields_values) {
            lead.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldValue = amoCrmService.getFieldValue(field);
                
                if (fieldId === 850257 && fieldValue) { // Счетчик занятий:
                    currentCounter = parseInt(fieldValue) || 0;
                }
                else if (fieldId === 890163 && fieldValue) { // Остаток занятий
                    currentRemaining = parseInt(fieldValue) || 0;
                }
                else if (fieldId === 850241 && fieldValue) { // Абонемент занятий:
                    if (fieldValue.includes('8 занятий')) totalClasses = 8;
                    else if (fieldValue.includes('4 занятия')) totalClasses = 4;
                    else if (fieldValue.includes('16 занятий')) totalClasses = 16;
                }
            });
        }
        
        // 3. Увеличиваем счетчик
        const newCounter = currentCounter + 1;
        const newRemaining = totalClasses > 0 
            ? Math.max(0, totalClasses - newCounter)
            : Math.max(0, currentRemaining - 1);
        
        console.log(`📊 Текущий счетчик: ${currentCounter} → ${newCounter}`);
        console.log(`📊 Текущий остаток: ${currentRemaining} → ${newRemaining}`);
        
        // 4. Обновляем сделку
        const updateData = {
            id: parseInt(leadId),
            custom_fields_values: [
                {
                    field_id: 850257, // Счетчик занятий:
                    values: [{ value: String(newCounter) }]
                },
                {
                    field_id: 890163, // Остаток занятий
                    values: [{ value: String(newRemaining) }]
                },
                {
                    field_id: 850259, // Дата последнего визита:
                    values: [{ value: Math.floor(Date.now() / 1000) }] // Текущее время
                }
            ]
        };
        
        console.log(`\n📤 Отправка обновления в amoCRM...`);
        
        const response = await amoCrmService.makeRequest(
            'PATCH',
            `/api/v4/leads`,
            [updateData]
        );
        
        console.log(`✅ Счетчик увеличен до ${newCounter}`);
        
        // 5. Получаем обновленную сделку
        const updatedLead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(updatedLead);
        
        res.json({
            success: true,
            message: 'Счетчик занятий увеличен',
            lead_id: leadId,
            previous_counter: currentCounter,
            new_counter: newCounter,
            previous_remaining: currentRemaining,
            new_remaining: newRemaining,
            subscription: subscriptionInfo
        });
        
    } catch (error) {
        console.error('❌ Ошибка увеличения счетчика:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response?.data
        });
    }
});

// Маршрут для диагностики сделки по ID
app.get('/api/debug/lead/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        
        console.log(`\n🔍 ДИАГНОСТИКА СДЕЛКИ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем сделку напрямую
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values,contacts`
        );
        
        console.log('\n📊 НАЗВАНИЕ СДЕЛКИ:', lead.name);
        console.log(`📊 ID сделки: ${lead.id}`);
        console.log(`📊 ID воронки: ${lead.pipeline_id}`);
        console.log(`📊 ID статуса: ${lead.status_id}`);
        
        console.log('\n📋 ВСЕ ПОЛЯ СДЕЛКИ:');
        console.log('='.repeat(80));
        
        if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
            lead.custom_fields_values.forEach((field, index) => {
                const fieldId = field.field_id || field.id || 'unknown';
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                console.log(`[${index + 1}] ID: ${fieldId} | "${fieldName}": "${fieldValue}"`);
                
                // Показываем сырые данные поля
                console.log(`    RAW:`, JSON.stringify(field));
            });
        } else {
            console.log('❌ Нет кастомных полей в сделке');
        }
        
        console.log('='.repeat(80));
        
        // Тестируем парсинг абонемента
        console.log('\n🎫 ТЕСТ ПАРСИНГА АБОНЕМЕНТА:');
        console.log('-'.repeat(80));
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        console.log('-'.repeat(80));
        console.log('Результат парсинга:', subscriptionInfo);
        
        // Показываем сырые данные
        console.log('\n📄 СЫРЫЕ ДАННЫЕ СДЕЛКИ (первые 1000 символов):');
        const rawData = JSON.stringify(lead, null, 2);
        console.log(rawData.substring(0, 1000) + (rawData.length > 1000 ? '...' : ''));
        
        res.json({
            success: true,
            data: {
                lead_id: lead.id,
                lead_name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                fields_count: lead.custom_fields_values ? lead.custom_fields_values.length : 0,
                fields: lead.custom_fields_values ? lead.custom_fields_values.map((f, i) => ({
                    index: i,
                    field_id: f.field_id || f.id,
                    field_name: amoCrmService.getFieldName(f),
                    field_value: amoCrmService.getFieldValue(f),
                    raw_values: f.values || []
                })) : [],
                subscription_parsed: subscriptionInfo
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error.message);
        if (error.response) {
            console.error('📊 Ответ сервера:', error.response.status, error.response.data);
        }
        
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response ? {
                status: error.response.status,
                data: error.response.data
            } : null
        });
    }
});

// Быстрая проверка нескольких сделок
app.get('/api/debug/check-leads', async (req, res) => {
    try {
        console.log(`\n🔍 ПРОВЕРКА СДЕЛОК НА НАЛИЧИЕ АБОНЕМЕНТОВ`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Возьмем несколько ID сделок для проверки
        const leadIds = [
            18153229, // "Круглова" - интересное название
            20104751, // "Рассылка май 24" - другая воронка (5951374)
            20263225  // "Новый лид от Tilda"
        ];
        
        const results = [];
        
        for (const leadId of leadIds) {
            console.log(`\n📋 Проверка сделки ID: ${leadId}`);
            
            try {
                const lead = await amoCrmService.makeRequest(
                    'GET',
                    `/api/v4/leads/${leadId}?with=custom_fields_values`
                );
                
                console.log(`   Название: "${lead.name}"`);
                console.log(`   Воронка: ${lead.pipeline_id}, Статус: ${lead.status_id}`);
                
                const leadInfo = {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    has_fields: lead.custom_fields_values ? lead.custom_fields_values.length > 0 : false,
                    fields: []
                };
                
                // Проверяем поля на наличие информации об абонементе
                if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                    console.log(`   Поля (${lead.custom_fields_values.length}):`);
                    
                    lead.custom_fields_values.forEach(field => {
                        const fieldName = amoCrmService.getFieldName(field).toLowerCase();
                        const fieldValue = amoCrmService.getFieldValue(field);
                        
                        // Показываем только интересные поля
                        if (fieldName.includes('абонемент') || 
                            fieldName.includes('занят') || 
                            fieldName.includes('счетчик') ||
                            fieldName.includes('остаток') ||
                            fieldName.includes('ученик') ||
                            fieldName.includes('ребенок')) {
                            console.log(`      • "${fieldName}": ${fieldValue}`);
                            
                            leadInfo.fields.push({
                                name: fieldName,
                                value: fieldValue
                            });
                        }
                    });
                }
                
                // Проверяем парсинг абонемента
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                leadInfo.subscription = subscriptionInfo;
                console.log(`   Парсинг абонемента: ${subscriptionInfo.hasSubscription ? '✅ Найден' : '❌ Не найден'}`);
                if (subscriptionInfo.hasSubscription) {
                    console.log(`      Занятий: ${subscriptionInfo.totalClasses}/${subscriptionInfo.usedClasses}/${subscriptionInfo.remainingClasses}`);
                }
                
                results.push(leadInfo);
                
            } catch (leadError) {
                console.log(`   ❌ Ошибка: ${leadError.message}`);
                results.push({
                    id: leadId,
                    error: leadError.message
                });
            }
        }
        
        res.json({
            success: true,
            leads_checked: results.length,
            results: results
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки сделок:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 🔧 ДОБАВЬТЕ ЭТОТ МАРШРУТ В server.js
app.get('/api/debug/export-fields', async (req, res) => {
    try {
        console.log('\n📊 ЭКСПОРТ ВСЕХ ПОЛЕЙ AMOCRM');
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем все поля контактов
        const contactFieldsRes = await amoCrmService.makeRequest(
            'GET', 
            '/api/v4/contacts/custom_fields'
        );
        
        // Получаем все поля сделок
        const leadFieldsRes = await amoCrmService.makeRequest(
            'GET',
            '/api/v4/leads/custom_fields'
        );
        
        const contactFields = contactFieldsRes._embedded?.custom_fields || [];
        const leadFields = leadFieldsRes._embedded?.custom_fields || [];
        
        console.log(`📊 Поля контактов: ${contactFields.length}`);
        console.log(`📊 Поля сделок: ${leadFields.length}`);
        
        // Форматируем для удобного просмотра
        const formattedResult = {
            export_date: new Date().toISOString(),
            account: amoCrmService.accountInfo?.name || AMOCRM_SUBDOMAIN,
            total_fields: contactFields.length + leadFields.length,
            contact_fields: contactFields.map(field => ({
                id: field.id,
                name: field.name,
                type: field.type,
                field_type: field.field_type,
                code: field.code,
                sort: field.sort,
                is_deletable: field.is_deletable,
                is_visible: field.is_visible,
                enums: field.enums ? field.enums.map(e => ({
                    id: e.id,
                    value: e.value,
                    code: e.code || null
                })).slice(0, 10) : [] // Ограничиваем 10 значениями
            })),
            lead_fields: leadFields.map(field => ({
                id: field.id,
                name: field.name,
                type: field.type,
                field_type: field.field_type,
                code: field.code,
                sort: field.sort,
                is_deletable: field.is_deletable,
                is_visible: field.is_visible,
                enums: field.enums ? field.enums.map(e => ({
                    id: e.id,
                    value: e.value,
                    code: e.code || null
                })).slice(0, 10) : []
            }))
        };
        
        // Показываем в браузере с форматированием
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(formattedResult, null, 2));
        
    } catch (error) {
        console.error('❌ Ошибка экспорта полей:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 🔧 МАРШРУТ: Экспорт полей для школы рисования (отфильтрованные)
app.get('/api/debug/export-school-fields', async (req, res) => {
    try {
        console.log('\n🎨 ЭКСПОРТ ПОЛЕЙ ДЛЯ ШКОЛЫ РИСОВАНИЯ');
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Ключевые слова для фильтрации
        const keywords = [
            'абонемент', 'занят', 'счетчик', 'остаток', 'посещен',
            'ученик', 'ребенок', 'фио', 'имя', 'дети',
            'филиал', 'преподаватель', 'педагог', 'группа', 'курс',
            'дата', 'активац', 'окончан', 'визит', 'рождения',
            'аллерг', 'особенност', 'родитель', 'возраст', 'направлен',
            'оплат', 'чек', 'сертификат', 'заморозк', 'время'
        ];
        
        // Получаем все поля
        const [contactFieldsRes, leadFieldsRes] = await Promise.all([
            amoCrmService.makeRequest('GET', '/api/v4/contacts/custom_fields'),
            amoCrmService.makeRequest('GET', '/api/v4/leads/custom_fields')
        ]);
        
        const contactFields = contactFieldsRes._embedded?.custom_fields || [];
        const leadFields = leadFieldsRes._embedded?.custom_fields || [];
        
        // Фильтруем поля
        const filteredContactFields = contactFields.filter(field => {
            const fieldName = field.name.toLowerCase();
            return keywords.some(keyword => fieldName.includes(keyword));
        });
        
        const filteredLeadFields = leadFields.filter(field => {
            const fieldName = field.name.toLowerCase();
            return keywords.some(keyword => fieldName.includes(keyword));
        });
        
        console.log(`🎯 Найдено релевантных полей:`);
        console.log(`   👤 Контакты: ${filteredContactFields.length}/${contactFields.length}`);
        console.log(`   📋 Сделки: ${filteredLeadFields.length}/${leadFields.length}`);
        
        // Формируем результат
        const result = {
            export_date: new Date().toISOString(),
            total_found: filteredContactFields.length + filteredLeadFields.length,
            categories: {
                subscription: [],
                student: [],
                schedule: [],
                dates: [],
                payment: [],
                other: []
            },
            all_fields: {
                contacts: filteredContactFields.map(f => ({ id: f.id, name: f.name, type: f.type })),
                leads: filteredLeadFields.map(f => ({ id: f.id, name: f.name, type: f.type }))
            }
        };
        
        // Категоризируем поля
        filteredContactFields.concat(filteredLeadFields).forEach(field => {
            const fieldName = field.name.toLowerCase();
            const fieldData = {
                id: field.id,
                name: field.name,
                type: field.type,
                entity: fieldName.includes('contact') ? 'contact' : 'lead'
            };
            
            if (fieldName.includes('абонемент') || fieldName.includes('занят') || 
                fieldName.includes('счетчик') || fieldName.includes('остаток')) {
                result.categories.subscription.push(fieldData);
            }
            else if (fieldName.includes('ученик') || fieldName.includes('ребенок') || 
                     fieldName.includes('фио') || fieldName.includes('имя')) {
                result.categories.student.push(fieldData);
            }
            else if (fieldName.includes('филиал') || fieldName.includes('преподаватель') || 
                     fieldName.includes('педагог') || fieldName.includes('группа')) {
                result.categories.schedule.push(fieldData);
            }
            else if (fieldName.includes('дата') || fieldName.includes('время')) {
                result.categories.dates.push(fieldData);
            }
            else if (fieldName.includes('оплат') || fieldName.includes('чек') || 
                     fieldName.includes('сертификат')) {
                result.categories.payment.push(fieldData);
            }
            else {
                result.categories.other.push(fieldData);
            }
        });
        
        // Сортируем по важности (по ID для удобства)
        Object.keys(result.categories).forEach(category => {
            result.categories[category].sort((a, b) => a.id - b.id);
        });
        
        // Показываем в удобном формате
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Поля amoCRM для школы рисования</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
                .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h1 { color: #333; border-bottom: 3px solid #4CAF50; padding-bottom: 10px; }
                .category { margin-bottom: 30px; border: 1px solid #ddd; border-radius: 8px; padding: 15px; }
                .category-title { background: #4CAF50; color: white; padding: 10px; border-radius: 5px; margin: -15px -15px 15px -15px; font-weight: bold; }
                .field { padding: 8px; border-bottom: 1px solid #eee; display: flex; align-items: center; }
                .field-id { background: #2196F3; color: white; padding: 3px 8px; border-radius: 4px; margin-right: 10px; font-weight: bold; min-width: 80px; }
                .field-name { flex-grow: 1; }
                .field-type { background: #FF9800; color: white; padding: 3px 8px; border-radius: 4px; margin-left: 10px; font-size: 12px; }
                .entity-contact { background: #9C27B0; }
                .entity-lead { background: #009688; }
                .summary { background: #e3f2fd; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                .copy-btn { background: #2196F3; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; margin: 10px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🎨 Поля amoCRM для школы рисования</h1>
                <div class="summary">
                    <strong>Дата экспорта:</strong> ${result.export_date}<br>
                    <strong>Всего найдено полей:</strong> ${result.total_found}<br>
                    <strong>Контакты:</strong> ${result.all_fields.contacts.length}<br>
                    <strong>Сделки:</strong> ${result.all_fields.leads.length}
                </div>
                <button class="copy-btn" onclick="copyAllFields()">📋 Копировать все ID полей</button>
        `;
        
        // Добавляем каждую категорию
        Object.keys(result.categories).forEach(category => {
            const fields = result.categories[category];
            if (fields.length > 0) {
                html += `
                <div class="category">
                    <div class="category-title">
                        ${this.getCategoryName(category)} (${fields.length})
                    </div>
                `;
                
                fields.forEach(field => {
                    const entityClass = field.entity === 'contact' ? 'entity-contact' : 'entity-lead';
                    html += `
                    <div class="field">
                        <div class="field-id ${entityClass}">${field.id}</div>
                        <div class="field-name">${field.name}</div>
                        <div class="field-type">${field.type}</div>
                    </div>
                    `;
                });
                
                html += `</div>`;
            }
        });
        
        // Добавляем скрипт для копирования
        html += `
            <script>
                function copyAllFields() {
                    const fields = ${JSON.stringify(result.all_fields)};
                    const text = '// Поля контактов:\\n' + 
                        fields.contacts.map(f => \`\${f.id} // \${f.name}\`).join('\\n') + 
                        '\\n\\n// Поля сделок:\\n' + 
                        fields.leads.map(f => \`\${f.id} // \${f.name}\`).join('\\n');
                    
                    navigator.clipboard.writeText(text)
                        .then(() => alert('✅ Все ID полей скопированы в буфер обмена!'))
                        .catch(err => console.error('Ошибка копирования:', err));
                }
                
                function getCategoryName(category) {
                    const names = {
                        'subscription': '🎫 Абонементы и занятия',
                        'student': '👤 Ученики и дети',
                        'schedule': '📅 Расписание и филиалы',
                        'dates': '📆 Даты и время',
                        'payment': '💰 Оплаты и чеки',
                        'other': '📦 Прочие поля'
                    };
                    return names[category] || category;
                }
            </script>
            </div>
        </body>
        </html>
        `;
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
        
    } catch (error) {
        console.error('❌ Ошибка экспорта:', error.message);
        res.status(500).send(`
            <html>
            <body style="font-family: Arial; padding: 20px;">
                <h1 style="color: red;">❌ Ошибка экспорта полей</h1>
                <p>${error.message}</p>
            </body>
            </html>
        `);
    }
});

// 🔧 Вспомогательная функция для названий категорий
function getCategoryName(category) {
    const names = {
        'subscription': '🎫 Абонементы и занятия',
        'student': '👤 Ученики и дети',
        'schedule': '📅 Расписание и филиалы',
        'dates': '📆 Даты и время',
        'payment': '💰 Оплаты и чеки',
        'other': '📦 Прочие поля'
    };
    return names[category] || category;
}

// 🔧 ДИАГНОСТИЧЕСКИЙ МАРШРУТ: проверка всех сделок контакта
app.get('/api/debug/contact-leads-analysis/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        
        console.log(`\n🔍 ПОЛНЫЙ АНАЛИЗ СДЕЛОК КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем контакт
        const contact = await amoCrmService.getFullContactInfo(contactId);
        console.log(`👤 Контакт: ${contact.name} (ID: ${contact.id})`);
        
        // Получаем все сделки
        const allLeads = await amoCrmService.getContactLeads(contactId);
        console.log(`📊 Всего сделок: ${allLeads.length}`);
        
        // Анализируем каждую сделку
        const leadsAnalysis = [];
        
        for (const lead of allLeads) {
            console.log(`\n📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
            console.log(`   Статус: ${lead.status_id}, Создана: ${new Date(lead.created_at * 1000).toLocaleDateString()}`);
            
            // Проверяем поля абонемента
            let hasSubscriptionFields = false;
            const subscriptionFields = [];
            
            if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                console.log(`   Кастомные поля (${lead.custom_fields_values.length}):`);
                
                lead.custom_fields_values.forEach(field => {
                    const fieldId = field.field_id || field.id;
                    const fieldName = amoCrmService.getFieldName(field);
                    const fieldValue = amoCrmService.getFieldValue(field);
                    
                    // Ключевые поля абонемента
                    const isSubscriptionField = [
                        850241, 850257, 890163, 850255, 851565, 891007, 805465, 867693
                    ].includes(fieldId);
                    
                    if (isSubscriptionField && fieldValue && fieldValue.trim() !== '') {
                        hasSubscriptionFields = true;
                        subscriptionFields.push({
                            id: fieldId,
                            name: fieldName,
                            value: fieldValue
                        });
                        
                        console.log(`   🎯 ${fieldName}: ${fieldValue}`);
                    }
                });
            }
            
            // Полный анализ абонемента
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            const isReallyActive = amoCrmService.isSubscriptionReallyActive(subscriptionInfo, lead);
            
            leadsAnalysis.push({
                lead_id: lead.id,
                lead_name: lead.name,
                status_id: lead.status_id,
                is_closed: [142, 143].includes(lead.status_id),
                created_at: lead.created_at,
                created_date: new Date(lead.created_at * 1000).toISOString().split('T')[0],
                has_subscription_fields: hasSubscriptionFields,
                subscription_fields: subscriptionFields,
                subscription_info: subscriptionInfo,
                is_really_active: isReallyActive
            });
        }
        
        // Ищем лучший абонемент
        console.log(`\n🎯 ПОИСК САМОГО АКТИВНОГО АБОНЕМЕНТА...`);
        const bestSubscription = await amoCrmService.findLatestActiveSubscription(contactId);
        
        // Сортируем по активности и дате
        leadsAnalysis.sort((a, b) => {
            if (a.is_really_active !== b.is_really_active) {
                return b.is_really_active - a.is_really_active;
            }
            if (a.has_subscription_fields !== b.has_subscription_fields) {
                return b.has_subscription_fields - a.has_subscription_fields;
            }
            return new Date(b.created_at) - new Date(a.created_at);
        });
        
        res.json({
            success: true,
            contact: {
                id: contact.id,
                name: contact.name
            },
            total_leads: allLeads.length,
            leads_with_subscription: leadsAnalysis.filter(l => l.has_subscription_fields).length,
            best_subscription: bestSubscription ? {
                lead_id: bestSubscription.lead.id,
                lead_name: bestSubscription.lead.name,
                subscription_status: bestSubscription.subscription.subscriptionStatus,
                total_classes: bestSubscription.subscription.totalClasses,
                used_classes: bestSubscription.subscription.usedClasses,
                remaining_classes: bestSubscription.subscription.remainingClasses,
                is_really_active: bestSubscription.is_really_active || false
            } : null,
            leads_analysis: leadsAnalysis.map(l => ({
                lead_id: l.lead_id,
                lead_name: l.lead_name,
                status_id: l.status_id,
                is_closed: l.is_closed,
                created_date: l.created_date,
                has_subscription_fields: l.has_subscription_fields,
                is_really_active: l.is_really_active,
                subscription_status: l.subscription_info.subscriptionStatus,
                total_classes: l.subscription_info.totalClasses,
                used_classes: l.subscription_info.usedClasses,
                remaining_classes: l.subscription_info.remainingClasses,
                subscription_fields_count: l.subscription_fields.length,
                key_fields: l.subscription_fields.map(f => ({
                    name: f.name,
                    value: f.value
                }))
            }))
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа сделок контакта:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 🔧 МАРШРУТ: Принудительная проверка конкретной сделки
app.get('/api/debug/force-check-lead/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ПРИНУДИТЕЛЬНАЯ ПРОВЕРКА СДЕЛКИ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем сделку
        const lead = await amoCrmService.getLeadById(leadId);
        
        if (!lead) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        console.log(`📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
        console.log(`📊 Статус: ${lead.status_id}, Воронка: ${lead.pipeline_id}`);
        
        // Полный анализ полей
        console.log(`\n📊 ВСЕ ПОЛЯ СДЕЛКИ:`);
        console.log('='.repeat(80));
        
        const subscriptionFields = [];
        const allFields = [];
        
        if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
            lead.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                const rawValues = field.values || [];
                
                const fieldInfo = {
                    id: fieldId,
                    name: fieldName,
                    value: fieldValue,
                    raw: rawValues
                };
                
                allFields.push(fieldInfo);
                
                // Ключевые поля абонемента
                const isSubscriptionField = [
                    850241, 850257, 890163, 850255, 851565, 891007, 805465, 867693,
                    891589, 850243, 850253, 850259, 884251, 891819, 891813
                ].includes(fieldId);
                
                if (isSubscriptionField && fieldValue && fieldValue.trim() !== '') {
                    subscriptionFields.push(fieldInfo);
                    console.log(`🎯 ID ${fieldId}: "${fieldName}" = "${fieldValue}"`);
                    
                    if (rawValues.length > 0) {
                        console.log(`     RAW: ${JSON.stringify(rawValues)}`);
                    }
                }
            });
        }
        
        console.log('='.repeat(80));
        
        // Анализ абонемента
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        const isReallyActive = amoCrmService.isSubscriptionReallyActive(subscriptionInfo, lead);
        
        // Получаем связанные контакты
        let contacts = [];
        try {
            const contactsResponse = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}/contacts`
            );
            contacts = contactsResponse._embedded?.contacts || [];
        } catch (contactError) {
            console.log(`⚠️  Не удалось получить контакты: ${contactError.message}`);
        }
        
        res.json({
            success: true,
            lead: {
                id: lead.id,
                name: lead.name,
                status_id: lead.status_id,
                pipeline_id: lead.pipeline_id,
                is_closed: [142, 143].includes(lead.status_id)
            },
            subscription: subscriptionInfo,
            is_really_active: isReallyActive,
            subscription_fields: subscriptionFields.map(f => ({
                id: f.id,
                name: f.name,
                value: f.value
            })),
            fields_summary: {
                total: allFields.length,
                subscription: subscriptionFields.length,
                other: allFields.length - subscriptionFields.length
            },
            contacts: contacts.map(c => ({
                id: c.id,
                name: c.name,
                is_main: c.is_main || false
            })),
            recommendations: isReallyActive ? 
                '✅ Эта сделка должна быть выбрана как активный абонемент' :
                '❌ Эта сделка не считается активным абонементом'
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки сделки:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Маршрут для поиска ВСЕХ абонементов контакта
app.get('/api/debug/contact-subscriptions/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        
        console.log(`\n🔍 ПОИСК ВСЕХ АБОНЕМЕНТОВ КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем все сделки контакта
        const leadsResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&limit=250`
        );
        
        const allLeads = leadsResponse._embedded?.leads || [];
        console.log(`📊 Всего сделок: ${allLeads.length}`);
        
        // Группируем сделки по типу
        const subscriptionLeads = [];
        const otherLeads = [];
        
        for (const lead of allLeads) {
            const hasSubscriptionFields = lead.custom_fields_values?.some(f => {
                const fieldId = f.field_id || f.id;
                return [850241, 850257, 890163, 850255, 851565].includes(fieldId);
            });
            
            if (hasSubscriptionFields) {
                subscriptionLeads.push(lead);
            } else {
                otherLeads.push(lead);
            }
        }
        
        console.log(`🎯 Сделок с полями абонемента: ${subscriptionLeads.length}`);
        
        // Анализируем каждую сделку с абонементом
        const analyzedSubscriptions = [];
        
        for (const lead of subscriptionLeads) {
            console.log(`\n📋 Анализ сделки: "${lead.name}" (ID: ${lead.id})`);
            console.log(`   Статус: ${lead.status_id}, Создана: ${new Date(lead.created_at * 1000).toLocaleDateString()}`);
            
            // Показываем все заполненные поля
            let hasData = false;
            const fields = [];
            
            if (lead.custom_fields_values) {
                lead.custom_fields_values.forEach(field => {
                    const fieldId = field.field_id || field.id;
                    const fieldName = amoCrmService.getFieldName(field);
                    const fieldValue = amoCrmService.getFieldValue(field);
                    
                    if (fieldValue && fieldValue.trim() !== '') {
                        hasData = true;
                        fields.push({
                            id: fieldId,
                            name: fieldName,
                            value: fieldValue
                        });
                        
                        // Показываем ключевые поля
                        if ([850241, 850257, 890163, 850255, 851565].includes(fieldId)) {
                            console.log(`   🔑 ${fieldName}: ${fieldValue}`);
                        }
                    }
                });
            }
            
            // Анализируем абонемент
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            
            analyzedSubscriptions.push({
                lead_id: lead.id,
                lead_name: lead.name,
                status_id: lead.status_id,
                created_at: lead.created_at,
                created_date: new Date(lead.created_at * 1000).toISOString().split('T')[0],
                has_data: hasData,
                fields_count: fields.length,
                subscription: subscriptionInfo,
                fields: fields.filter(f => [850241, 850257, 890163, 850255, 851565].includes(f.id))
            });
        }
        
        // Сортируем по дате создания (новые сначала)
        analyzedSubscriptions.sort((a, b) => b.created_at - a.created_at);
        
        // Ищем самый свежий активный абонемент
        const activeSubscriptions = analyzedSubscriptions.filter(s => 
            s.subscription.subscriptionActive
        );
        
        console.log(`\n🎯 АКТИВНЫХ АБОНЕМЕНТОВ: ${activeSubscriptions.length}`);
        
        if (activeSubscriptions.length > 0) {
            console.log(`\n📊 САМЫЙ СВЕЖИЙ АКТИВНЫЙ АБОНЕМЕНТ:`);
            const latestActive = activeSubscriptions[0];
            console.log(`   Сделка: "${latestActive.lead_name}" (ID: ${latestActive.lead_id})`);
            console.log(`   Статус: ${latestActive.subscription.subscriptionStatus}`);
            console.log(`   Занятий: ${latestActive.subscription.usedClasses}/${latestActive.subscription.totalClasses} (осталось: ${latestActive.subscription.remainingClasses})`);
        }
        
        res.json({
            success: true,
            contact_id: contactId,
            total_leads: allLeads.length,
            subscription_leads: subscriptionLeads.length,
            active_subscriptions: activeSubscriptions.length,
            subscriptions: analyzedSubscriptions,
            latest_active: activeSubscriptions.length > 0 ? activeSubscriptions[0] : null
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска абонементов:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 🔧 ТЕСТОВЫЙ МАРШРУТ: Простая проверка абонемента
app.get('/api/test/simple-subscription/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        
        console.log(`\n🧪 ПРОСТАЯ ПРОВЕРКА АБОНЕМЕНТА ДЛЯ КОНТАКТА: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем контакт
        const contact = await amoCrmService.getFullContactInfo(contactId);
        if (!contact) {
            return res.status(404).json({
                success: false,
                error: 'Контакт не найден'
            });
        }
        
        console.log(`👤 Контакт: ${contact.name}`);
        
        // Ищем активный абонемент
        const subscriptionData = await amoCrmService.findActiveSubscriptionSimple(contactId);
        
        if (!subscriptionData) {
            return res.json({
                success: true,
                message: 'Активный абонемент не найден',
                contact: {
                    id: contact.id,
                    name: contact.name
                }
            });
        }
        
        const lead = subscriptionData.lead;
        const subscription = subscriptionData.subscription;
        
        // Показываем поля абонемента
        console.log(`\n📋 СДЕЛКА: "${lead.name}" (ID: ${lead.id})`);
        console.log(`📊 Статус: ${lead.status_id}, Воронка: ${lead.pipeline_id}`);
        
        console.log(`\n🎫 ДАННЫЕ АБОНЕМЕНТА:`);
        console.log(`   • Занятий: ${subscription.totalClasses} всего, ${subscription.usedClasses} использовано, ${subscription.remainingClasses} осталось`);
        console.log(`   • Активация: ${subscription.activationDate}`);
        console.log(`   • Окончание: ${subscription.expirationDate}`);
        console.log(`   • Активен: ${subscription.isActive ? '✅ Да' : '❌ Нет'}`);
        console.log(`   • Статус: ${subscription.subscriptionStatus}`);
        
        // Проверяем даты
        const today = new Date();
        const activationDate = subscription.activationDate ? new Date(subscription.activationDate) : null;
        const expirationDate = subscription.expirationDate ? new Date(subscription.expirationDate) : null;
        
        console.log(`\n📅 ПРОВЕРКА ДАТ:`);
        console.log(`   • Сегодня: ${today.toISOString().split('T')[0]}`);
        console.log(`   • Активация: ${activationDate ? activationDate.toISOString().split('T')[0] : 'нет'}`);
        console.log(`   • Окончание: ${expirationDate ? expirationDate.toISOString().split('T')[0] : 'нет'}`);
        
        if (activationDate && expirationDate) {
            console.log(`   • Сегодня между датами: ${today >= activationDate && today <= expirationDate ? '✅ Да' : '❌ Нет'}`);
        }
        
        res.json({
            success: true,
            contact: {
                id: contact.id,
                name: contact.name
            },
            subscription: {
                lead: {
                    id: lead.id,
                    name: lead.name,
                    status_id: lead.status_id,
                    pipeline_id: lead.pipeline_id
                },
                data: subscription,
                dates_check: {
                    today: today.toISOString().split('T')[0],
                    activation_date: subscription.activationDate,
                    expiration_date: subscription.expirationDate,
                    is_between_dates: activationDate && expirationDate ? 
                        (today >= activationDate && today <= expirationDate) : null
                }
            },
            recommendation: subscription.isActive ? 
                '✅ Этот абонемент должен отображаться в приложении' :
                '❌ Этот абонемент не активен'
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Поиск активных абонементов по телефону
app.get('/api/debug/find-active-subscription/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n🔍 ПОИСК АКТИВНЫХ АБОНЕМЕНТОВ ПО ТЕЛЕФОНУ: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Форматируем телефон
        const formattedPhone = phone.replace(/\D/g, '');
        let searchPhone;
        if (formattedPhone.length === 11 && formattedPhone.startsWith('7')) {
            searchPhone = `+${formattedPhone}`;
        } else if (formattedPhone.length === 10) {
            searchPhone = `+7${formattedPhone}`;
        } else {
            searchPhone = `+${formattedPhone}`;
        }
        
        console.log(`📱 Форматированный номер: ${searchPhone}`);
        
        // 1. Ищем контакты
        const contactsResponse = await amoCrmService.makeRequest(
            'GET', 
            `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=custom_fields_values`
        );
        
        const contacts = contactsResponse._embedded?.contacts || [];
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        const results = [];
        
        for (const contact of contacts) {
            console.log(`\n👤 Контакт: ${contact.name} (ID: ${contact.id})`);
            
            // 2. Ищем все сделки контакта
            const leadsResponse = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contact.id}`
            );
            
            const leads = leadsResponse._embedded?.leads || [];
            console.log(`📊 Всего сделок: ${leads.length}`);
            
            // 3. Ищем сделки с полями абонемента
            for (const lead of leads) {
                const hasSubscriptionFields = lead.custom_fields_values && 
                    lead.custom_fields_values.some(field => {
                        const fieldId = field.field_id || field.id;
                        return [850241, 850257, 890163, 850255, 851565, 891007].includes(fieldId);
                    });
                
                if (hasSubscriptionFields) {
                    console.log(`\n🎯 Найдена сделка с абонементом: "${lead.name}" (ID: ${lead.id})`);
                    console.log(`   Статус: ${lead.status_id}, Активна: ${![142, 143].includes(lead.status_id)}`);
                    
                    // Парсим абонемент
                    const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                    
                    if (subscriptionInfo.hasSubscription) {
                        const result = {
                            contact_id: contact.id,
                            contact_name: contact.name,
                            lead_id: lead.id,
                            lead_name: lead.name,
                            lead_status_id: lead.status_id,
                            lead_pipeline_id: lead.pipeline_id,
                            is_active_lead: ![142, 143].includes(lead.status_id),
                            subscription: subscriptionInfo,
                            fields: []
                        };
                        
                        // Показываем все поля абонемента
                        lead.custom_fields_values.forEach(field => {
                            const fieldId = field.field_id || field.id;
                            if ([850241, 850257, 890163, 850255, 851565, 891007].includes(fieldId)) {
                                const fieldName = amoCrmService.getFieldName(field);
                                const fieldValue = amoCrmService.getFieldValue(field);
                                
                                console.log(`   • ${fieldName}: ${fieldValue}`);
                                
                                result.fields.push({
                                    id: fieldId,
                                    name: fieldName,
                                    value: fieldValue
                                });
                            }
                        });
                        
                        results.push(result);
                    }
                }
            }
        }
        
        // 4. Если не нашли активных, покажем все найденные
        const activeSubscriptions = results.filter(r => r.is_active_lead && r.subscription.subscriptionActive);
        const allSubscriptions = results;
        
        console.log(`\n📊 ИТОГИ ПОИСКА:`);
        console.log(`   Всего абонементов: ${allSubscriptions.length}`);
        console.log(`   Активных абонементов: ${activeSubscriptions.length}`);
        
        res.json({
            success: true,
            phone: phone,
            formatted_phone: searchPhone,
            contacts_found: contacts.length,
            subscriptions_found: allSubscriptions.length,
            active_subscriptions_found: activeSubscriptions.length,
            active_subscriptions: activeSubscriptions,
            all_subscriptions: allSubscriptions
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска активных абонементов:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 🔧 МАРШРУТ: Поиск всех сделок контакта по разным воронкам
app.get('/api/debug/contact-all-leads/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        
        console.log(`\n🔍 ПОИСК ВСЕХ СДЕЛОК КОНТАКТА ПО ВСЕМ ВОРОНКАМ: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем контакт
        const contact = await amoCrmService.getFullContactInfo(contactId);
        console.log(`👤 Контакт: ${contact.name} (ID: ${contact.id})`);
        
        // МЕТОД 1: Поиск через filter[contact_id]
        console.log('\n🔍 Метод 1: filter[contact_id]');
        const method1Response = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&limit=250&filter[contact_id]=${contactId}`
        );
        const method1Leads = method1Response._embedded?.leads || [];
        console.log(`📊 Найдено: ${method1Leads.length} сделок`);
        
        // МЕТОД 2: Поиск через contacts/{id}/leads
        console.log('\n🔍 Метод 2: contacts/{id}/leads');
        let method2Leads = [];
        try {
            const method2Response = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/contacts/${contactId}/leads?with=custom_fields_values`
            );
            method2Leads = method2Response._embedded?.leads || [];
            console.log(`📊 Найдено: ${method2Leads.length} сделок`);
        } catch (error) {
            console.log(`❌ Ошибка: ${error.message}`);
        }
        
        // МЕТОД 3: Поиск по всем воронкам отдельно
        console.log('\n🔍 Метод 3: Поиск по конкретным воронкам');
        const pipelines = [5663740, 5951374, 7977402, 6930286]; // Все возможные воронки
        const method3Leads = [];
        
        for (const pipelineId of pipelines) {
            try {
                const response = await amoCrmService.makeRequest(
                    'GET',
                    `/api/v4/leads?with=custom_fields_values&limit=100&filter[pipeline_id]=${pipelineId}&filter[contact_id]=${contactId}`
                );
                const leads = response._embedded?.leads || [];
                if (leads.length > 0) {
                    console.log(`   📍 Воронка ${pipelineId}: ${leads.length} сделок`);
                    method3Leads.push(...leads);
                }
            } catch (error) {
                console.log(`   ❌ Воронка ${pipelineId}: ${error.message}`);
            }
        }
        
        // Объединяем все результаты
        const allLeads = [...method1Leads, ...method2Leads, ...method3Leads];
        
        // Убираем дубликаты
        const uniqueLeads = [];
        const seenIds = new Set();
        
        for (const lead of allLeads) {
            if (!seenIds.has(lead.id)) {
                seenIds.add(lead.id);
                uniqueLeads.push(lead);
            }
        }
        
        console.log(`\n📊 ВСЕГО УНИКАЛЬНЫХ СДЕЛОК: ${uniqueLeads.length}`);
        
        // Группируем по статусам
        const activeLeads = uniqueLeads.filter(l => ![142, 143].includes(l.status_id));
        const closedLeads = uniqueLeads.filter(l => [142, 143].includes(l.status_id));
        
        console.log(`🎯 АКТИВНЫХ сделок: ${activeLeads.length}`);
        console.log(`📭 ЗАКРЫТЫХ сделок: ${closedLeads.length}`);
        
        // Ищем сделки с абонементами
        const subscriptionLeads = [];
        
        for (const lead of uniqueLeads) {
            const hasSubscription = lead.custom_fields_values?.some(f => {
                const fieldId = f.field_id || f.id;
                return [850241, 850257, 890163].includes(fieldId);
            });
            
            if (hasSubscription) {
                subscriptionLeads.push({
                    id: lead.id,
                    name: lead.name,
                    status_id: lead.status_id,
                    pipeline_id: lead.pipeline_id,
                    is_closed: [142, 143].includes(lead.status_id)
                });
            }
        }
        
        console.log(`\n🎫 СДЕЛОК С АБОНЕМЕНТАМИ: ${subscriptionLeads.length}`);
        
        // Показываем активные сделки с абонементами
        const activeSubscriptionLeads = subscriptionLeads.filter(l => !l.is_closed);
        console.log(`✅ АКТИВНЫХ с абонементами: ${activeSubscriptionLeads.length}`);
        
        if (activeSubscriptionLeads.length > 0) {
            console.log(`\n🎯 АКТИВНЫЕ АБОНЕМЕНТЫ:`);
            activeSubscriptionLeads.forEach(lead => {
                console.log(`   • ${lead.id}: "${lead.name}" (воронка: ${lead.pipeline_id})`);
            });
        }
        
        // Проверяем конкретно сделку 28664339
        console.log(`\n🔍 ПРОВЕРКА СДЕЛКИ 28664339:`);
        const targetLead = uniqueLeads.find(l => l.id == 28664339);
        
        if (targetLead) {
            console.log(`   ✅ Найдена!`);
            console.log(`      Название: "${targetLead.name}"`);
            console.log(`      Статус: ${targetLead.status_id}`);
            console.log(`      Воронка: ${targetLead.pipeline_id}`);
            
            // Проверяем поля абонемента
            if (targetLead.custom_fields_values) {
                console.log(`      Поля абонемента:`);
                targetLead.custom_fields_values.forEach(field => {
                    const fieldId = field.field_id || field.id;
                    if ([850241, 850257, 890163, 850255, 851565].includes(fieldId)) {
                        const value = amoCrmService.getFieldValue(field);
                        console.log(`        • ${fieldId}: ${value}`);
                    }
                });
            }
        } else {
            console.log(`   ❌ НЕ найдена в общем списке!`);
        }
        
        res.json({
            success: true,
            contact: {
                id: contact.id,
                name: contact.name
            },
            methods: {
                method1: method1Leads.length,
                method2: method2Leads.length,
                method3: method3Leads.length,
                total_unique: uniqueLeads.length
            },
            leads_by_status: {
                active: activeLeads.length,
                closed: closedLeads.length,
                total: uniqueLeads.length
            },
            subscription_leads: {
                total: subscriptionLeads.length,
                active: activeSubscriptionLeads.length,
                closed: subscriptionLeads.length - activeSubscriptionLeads.length,
                list: subscriptionLeads
            },
            target_lead_found: !!targetLead,
            target_lead: targetLead ? {
                id: targetLead.id,
                name: targetLead.name,
                status_id: targetLead.status_id,
                pipeline_id: targetLead.pipeline_id,
                is_closed: [142, 143].includes(targetLead.status_id)
            } : null
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска всех сделок:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Проверка связей сделки
app.get('/api/debug/lead-contacts/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ПРОВЕРКА СВЯЗЕЙ СДЕЛКИ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем сделку с контактами
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=contacts`
        );
        
        console.log(`📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
        console.log(`📊 Статус: ${lead.status_id}, Воронка: ${lead.pipeline_id}`);
        
        // Показываем связанные контакты
        if (lead._embedded && lead._embedded.contacts) {
            console.log(`👤 СВЯЗАННЫЕ КОНТАКТЫ (${lead._embedded.contacts.length}):`);
            lead._embedded.contacts.forEach(contact => {
                console.log(`   • ${contact.id}: ${contact.name} (${contact.is_main ? 'основной' : 'дополнительный'})`);
            });
        } else {
            console.log(`⚠️  Нет связанных контактов!`);
        }
        
        res.json({
            success: true,
            lead: {
                id: lead.id,
                name: lead.name,
                status_id: lead.status_id,
                pipeline_id: lead.pipeline_id
            },
            contacts: lead._embedded?.contacts || [],
            contacts_count: lead._embedded?.contacts?.length || 0
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки связей:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Диагностика конкретного абонемента
app.get('/api/debug/subscription-details/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ДИАГНОСТИКА АБОНЕМЕНТА В СДЕЛКЕ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        // Детальный анализ полей
        console.log('\n📊 ДЕТАЛЬНЫЙ АНАЛИЗ ПОЛЕЙ:');
        const fieldAnalysis = [];
        
        if (lead.custom_fields_values) {
            lead.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                const rawValues = field.values || [];
                
                console.log(`\n[${fieldId}] ${fieldName}:`);
                console.log(`   Значение: "${fieldValue}"`);
                console.log(`   Сырые данные:`, JSON.stringify(rawValues));
                
                // Особый анализ для ключевых полей
                if ([850241, 850257, 890163, 850255, 851565].includes(fieldId)) {
                    console.log(`   ⚠️  КРИТИЧЕСКОЕ ПОЛЕ!`);
                    
                    if (fieldId === 850241) { // Абонемент занятий:
                        const parsed = amoCrmService.parseClassesCount(fieldValue);
                        console.log(`   🎯 Парсинг: "${fieldValue}" → ${parsed} занятий`);
                    }
                    else if (fieldId === 850257) { // Счетчик занятий:
                        console.log(`   🎯 Использовано занятий: ${fieldValue}`);
                    }
                }
                
                fieldAnalysis.push({
                    id: fieldId,
                    name: fieldName,
                    value: fieldValue,
                    raw: rawValues,
                    is_critical: [850241, 850257, 890163, 850255, 851565].includes(fieldId)
                });
            });
        }
        
        // Парсим абонемент
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        // Конвертируем timestamp в даты
        const formatTimestamp = (ts) => {
            if (!ts) return null;
            const timestamp = parseInt(ts);
            if (isNaN(timestamp)) return ts;
            return new Date(timestamp * 1000).toISOString().split('T')[0];
        };
        
        const formattedSubscription = {
            ...subscriptionInfo,
            activationDate: formatTimestamp(subscriptionInfo.activationDate),
            expirationDate: formatTimestamp(subscriptionInfo.expirationDate),
            lastVisitDate: formatTimestamp(subscriptionInfo.lastVisitDate),
            purchaseDate: formatTimestamp(subscriptionInfo.purchaseDate)
        };
        
        console.log('\n🎯 ИТОГОВЫЕ ДАННЫЕ АБОНЕМЕНТА:');
        console.log(JSON.stringify(formattedSubscription, null, 2));
        
        res.json({
            success: true,
            lead: {
                id: lead.id,
                name: lead.name,
                status_id: lead.status_id,
                pipeline_id: lead.pipeline_id
            },
            subscription: formattedSubscription,
            fields: fieldAnalysis.filter(f => f.is_critical),
            timestamp_conversion: {
                activationDate: {
                    original: subscriptionInfo.activationDate,
                    converted: formattedSubscription.activationDate
                },
                expirationDate: {
                    original: subscriptionInfo.expirationDate,
                    converted: formattedSubscription.expirationDate
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики абонемента:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Поиск активных сделок контакта
app.get('/api/debug/contact/:id/active-leads', async (req, res) => {
    try {
        const contactId = req.params.id;
        
        console.log(`\n🔍 ПОИСК АКТИВНЫХ СДЕЛОК КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем все сделки контакта
        const leadsResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}`
        );
        
        const allLeads = leadsResponse._embedded?.leads || [];
        console.log(`📊 Всего сделок: ${allLeads.length}`);
        
        // Ищем активные сделки (не 142 и не 143)
        const activeLeads = allLeads.filter(lead => 
            lead.status_id !== 142 && lead.status_id !== 143
        );
        
        console.log(`🎯 Активных сделок: ${activeLeads.length}`);
        
        // Проверяем каждую активную сделку
        const results = [];
        
        for (const lead of activeLeads.slice(0, 10)) { // Проверяем первые 10
            console.log(`\n📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
            console.log(`   Статус: ${lead.status_id}, Воронка: ${lead.pipeline_id}`);
            
            const leadInfo = {
                id: lead.id,
                name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                fields_count: lead.custom_fields_values ? lead.custom_fields_values.length : 0,
                fields: []
            };
            
            // Проверяем все поля
            if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                console.log(`   Поля (${lead.custom_fields_values.length}):`);
                
                lead.custom_fields_values.forEach(field => {
                    const fieldId = field.field_id || field.id || 'unknown';
                    const fieldName = amoCrmService.getFieldName(field);
                    const fieldValue = amoCrmService.getFieldValue(field);
                    
                    console.log(`      • ID ${fieldId}: "${fieldName}" = "${fieldValue}"`);
                    
                    // Сохраняем все поля для анализа
                    leadInfo.fields.push({
                        id: fieldId,
                        name: fieldName,
                        value: fieldValue
                    });
                });
            }
            
            results.push(leadInfo);
        }
        
        // Если активных сделок нет, покажем несколько последних закрытых
        if (activeLeads.length === 0) {
            console.log(`\n⚠️  Активных сделок нет. Показываем последние 5 закрытых сделок:`);
            
            const recentLeads = allLeads
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 5);
            
            for (const lead of recentLeads) {
                console.log(`\n📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
                console.log(`   Создана: ${lead.created_at}, Статус: ${lead.status_id}`);
                
                if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                    console.log(`   Поля (${lead.custom_fields_values.length}):`);
                    
                    lead.custom_fields_values.forEach(field => {
                        const fieldName = amoCrmService.getFieldName(field).toLowerCase();
                        const fieldValue = amoCrmService.getFieldValue(field);
                        
                        if (fieldName.includes('абонемент') || 
                            fieldName.includes('занят') || 
                            fieldName.includes('ученик')) {
                            console.log(`      • "${fieldName}": ${fieldValue}`);
                        }
                    });
                }
            }
        }
        
        res.json({
            success: true,
            contact_id: contactId,
            total_leads: allLeads.length,
            active_leads: activeLeads.length,
            results: results
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска активных сделок:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Тест поиска абонементов для контакта
app.get('/api/debug/test-lead-search/:contactId/:studentName', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        const studentName = req.params.studentName;
        
        console.log(`\n🔍 ТЕСТ ПОИСКА АБОНЕМЕНТОВ ДЛЯ: ${studentName} (контакт: ${contactId})`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // 1. Получаем все сделки контакта
        const allLeads = await amoCrmService.getContactLeads(contactId);
        
        // 2. Ищем сделки с абонементами
        const subscriptionLeads = [];
        const otherLeads = [];
        
        allLeads.forEach(lead => {
            const hasSubscription = lead.custom_fields_values?.some(f => {
                const fieldId = f.field_id || f.id;
                return [850241, 850257, 890163].includes(fieldId);
            });
            
            if (hasSubscription) {
                subscriptionLeads.push({
                    id: lead.id,
                    name: lead.name,
                    status_id: lead.status_id,
                    pipeline_id: lead.pipeline_id,
                    created_at: lead.created_at
                });
            } else {
                otherLeads.push(lead.id);
            }
        });
        
        console.log(`\n📊 РЕЗУЛЬТАТЫ:`);
        console.log(`   Всего сделок: ${allLeads.length}`);
        console.log(`   С абонементами: ${subscriptionLeads.length}`);
        console.log(`   Без абонементов: ${otherLeads.length}`);
        
        // 3. Проверяем конкретную сделку 28664339
        console.log(`\n🔍 ПРОВЕРКА СДЕЛКИ 28664339:`);
        const targetLead = allLeads.find(lead => lead.id == 28664339);
        
        if (targetLead) {
            console.log(`   ✅ Найдена в списке!`);
            console.log(`      Название: "${targetLead.name}"`);
            console.log(`      Статус: ${targetLead.status_id}`);
            
            // Проверяем поля
            if (targetLead.custom_fields_values) {
                console.log(`      Поля абонемента:`);
                targetLead.custom_fields_values.forEach(field => {
                    const fieldId = field.field_id || field.id;
                    if ([850241, 850257, 890163, 850255, 851565].includes(fieldId)) {
                        const value = amoCrmService.getFieldValue(field);
                        console.log(`        • ${fieldId}: ${value}`);
                    }
                });
            }
        } else {
            console.log(`   ❌ НЕ найдена в списке!`);
            console.log(`   Возможные причины:`);
            console.log(`      • Сделка в другой воронке (pipeline_id)`);
            console.log(`      • Ограничение API (только 250 сделок)`);
            console.log(`      • Фильтрация по статусу`);
        }
        
        res.json({
            success: true,
            contact_id: contactId,
            student_name: studentName,
            total_leads: allLeads.length,
            subscription_leads: subscriptionLeads.length,
            subscription_leads_list: subscriptionLeads,
            target_lead_found: !!targetLead,
            target_lead: targetLead ? {
                id: targetLead.id,
                name: targetLead.name,
                status_id: targetLead.status_id,
                pipeline_id: targetLead.pipeline_id
            } : null
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста поиска:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 🔧 ДИАГНОСТИЧЕСКИЙ МАРШРУТ: поиск детей и их абонементов
app.get('/api/debug/find-child-subscriptions/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        
        console.log(`\n🔍 ПОИСК ДЕТЕЙ И ИХ АБОНЕМЕНТОВ ДЛЯ КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем контакт
        const contact = await amoCrmService.getFullContactInfo(contactId);
        console.log(`👤 Контакт: ${contact.name} (ID: ${contact.id})`);
        
        // Извлекаем детей
        const children = amoCrmService.extractStudentsFromContact(contact);
        console.log(`📊 Найдено детей: ${children.length}`);
        
        if (children.length === 0) {
            return res.json({
                success: true,
                message: 'Дети не найдены в контакте',
                contact: {
                    id: contact.id,
                    name: contact.name
                }
            });
        }
        
        // Для каждого ребенка ищем абонементы
        const childrenWithSubscriptions = [];
        
        for (const child of children) {
            console.log(`\n👤 Ребенок: ${child.studentName}`);
            
            // Ищем персональный абонемент
            const personalLead = await amoCrmService.findSubscriptionForStudent(contactId, child.studentName);
            
            let personalSubscription = amoCrmService.extractSubscriptionInfo(null);
            let hasPersonal = false;
            
            if (personalLead) {
                personalSubscription = amoCrmService.extractSubscriptionInfo(personalLead);
                hasPersonal = true;
                console.log(`✅ Найден персональный абонемент: ${personalLead.name} (ID: ${personalLead.id})`);
                console.log(`   • Занятий: ${personalSubscription.totalClasses}/${personalSubscription.usedClasses}/${personalSubscription.remainingClasses}`);
                console.log(`   • Статус: ${personalSubscription.subscriptionStatus}`);
            } else {
                console.log(`❌ Персональный абонемент не найден`);
            }
            
            // Ищем общий активный абонемент
            const generalData = await amoCrmService.findLatestActiveSubscription(contactId);
            let generalSubscription = amoCrmService.extractSubscriptionInfo(null);
            let hasGeneral = false;
            
            if (generalData) {
                generalSubscription = generalData.subscription;
                hasGeneral = true;
                console.log(`📋 Общий абонемент: ${generalData.lead.name} (ID: ${generalData.lead.id})`);
                console.log(`   • Занятий: ${generalSubscription.totalClasses}/${generalSubscription.usedClasses}/${generalSubscription.remainingClasses}`);
            }
            
            childrenWithSubscriptions.push({
                child_name: child.studentName,
                child_info: child,
                has_personal_subscription: hasPersonal,
                personal_lead: personalLead ? {
                    id: personalLead.id,
                    name: personalLead.name,
                    status_id: personalLead.status_id
                } : null,
                personal_subscription: hasPersonal ? {
                    status: personalSubscription.subscriptionStatus,
                    total_classes: personalSubscription.totalClasses,
                    used_classes: personalSubscription.usedClasses,
                    remaining_classes: personalSubscription.remainingClasses,
                    activation_date: personalSubscription.activationDate,
                    expiration_date: personalSubscription.expirationDate
                } : null,
                has_general_subscription: hasGeneral,
                general_subscription: hasGeneral ? {
                    status: generalSubscription.subscriptionStatus,
                    total_classes: generalSubscription.totalClasses,
                    used_classes: generalSubscription.usedClasses,
                    remaining_classes: generalSubscription.remainingClasses
                } : null,
                recommendation: hasPersonal ? 
                    `Использовать персональный абонемент (${personalLead.name})` :
                    hasGeneral ? `Использовать общий абонемент` :
                    `Абонементы не найдены`
            });
        }
        
        res.json({
            success: true,
            contact: {
                id: contact.id,
                name: contact.name
            },
            children_count: children.length,
            children: childrenWithSubscriptions,
            summary: {
                with_personal_subscription: childrenWithSubscriptions.filter(c => c.has_personal_subscription).length,
                with_general_subscription: childrenWithSubscriptions.filter(c => c.has_general_subscription).length,
                without_subscription: childrenWithSubscriptions.filter(c => !c.has_personal_subscription && !c.has_general_subscription).length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска детских абонементов:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/test/latest-subscription/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        
        console.log(`\n🎯 ТЕСТ ПОИСКА СВЕЖЕГО АБОНЕМЕНТА ДЛЯ КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const result = await amoCrmService.findLatestActiveSubscription(contactId);
        
        if (result) {
            const lead = result.lead;
            const subscription = result.subscription;
            
            // Показываем все поля абонемента
            console.log(`\n📊 ВСЕ ПОЛЯ АБОНЕМЕНТА В СДЕЛКЕ ${lead.id}:`);
            if (lead.custom_fields_values) {
                lead.custom_fields_values.forEach(field => {
                    const fieldId = field.field_id || field.id;
                    const fieldName = amoCrmService.getFieldName(field);
                    const fieldValue = amoCrmService.getFieldValue(field);
                    const raw = field.values || [];
                    
                    if (fieldValue && fieldValue.trim() !== '') {
                        console.log(`   [${fieldId}] "${fieldName}": ${fieldValue}`);
                        if (raw.length > 0) {
                            console.log(`       RAW:`, JSON.stringify(raw));
                        }
                    }
                });
            }
            
            res.json({
                success: true,
                message: 'Самый свежий активный абонемент найден',
                data: {
                    contact_id: contactId,
                    lead: {
                        id: lead.id,
                        name: lead.name,
                        status_id: lead.status_id,
                        pipeline_id: lead.pipeline_id,
                        created_at: lead.created_at
                    },
                    subscription: subscription,
                    is_active: subscription.subscriptionActive,
                    remaining_classes: subscription.remainingClasses,
                    total_classes: subscription.totalClasses,
                    activation_date_formatted: amoCrmService.parseDate(subscription.activationDate),
                    expiration_date_formatted: amoCrmService.parseDate(subscription.expirationDate)
                }
            });
        } else {
            res.json({
                success: false,
                message: 'Абонементы не найдены',
                contact_id: contactId
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Поиск сделок с ключевыми словами в полях
app.get('/api/debug/search/subscription-fields', async (req, res) => {
    try {
        console.log(`\n🔍 ПОИСК СДЕЛОК С ПОЛЯМИ ОБ АБОНЕМЕНТАХ`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем все кастомные поля сделок
        const fieldsResponse = await amoCrmService.makeRequest('GET', '/api/v4/leads/custom_fields');
        
        const subscriptionFields = [];
        
        if (fieldsResponse._embedded && fieldsResponse._embedded.custom_fields) {
            fieldsResponse._embedded.custom_fields.forEach(field => {
                const fieldName = field.name.toLowerCase();
                
                // Ищем поля, связанные с абонементами и занятиями
                if (fieldName.includes('абонемент') || 
                    fieldName.includes('занят') || 
                    fieldName.includes('счетчик') ||
                    fieldName.includes('остаток') ||
                    fieldName.includes('посещен') ||
                    fieldName.includes('активац') ||
                    fieldName.includes('окончан')) {
                    
                    subscriptionFields.push({
                        id: field.id,
                        name: field.name,
                        type: field.type,
                        enums: field.enums || []
                    });
                    
                    console.log(`📋 Найдено поле: "${field.name}" (ID: ${field.id})`);
                }
            });
        }
        
        console.log(`\n🎯 Всего найдено полей об абонементах: ${subscriptionFields.length}`);
        
        // Если нашли поля, ищем сделки с этими полями
        const leadsWithSubscription = [];
        
        if (subscriptionFields.length > 0) {
            // Берем первое поле для теста
            const testFieldId = subscriptionFields[0].id;
            console.log(`\n🔍 Ищем сделки с полем ID: ${testFieldId}`);
            
            // Ищем сделки с этим полем (фильтр по значению поля не работает в amoCRM API v4)
            // Поэтому ищем все сделки и фильтруем локально
            const leadsResponse = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&limit=50`
            );
            
            const leads = leadsResponse._embedded?.leads || [];
            console.log(`📊 Проверяем ${leads.length} сделок...`);
            
            for (const lead of leads) {
                if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                    // Проверяем, есть ли поле с абонементом
                    const hasSubscriptionField = lead.custom_fields_values.some(field => {
                        const fieldId = field.field_id || field.id;
                        return subscriptionFields.some(subField => subField.id == fieldId);
                    });
                    
                    if (hasSubscriptionField) {
                        console.log(`\n✅ Найдена сделка с абонементом: "${lead.name}" (ID: ${lead.id})`);
                        
                        const leadInfo = {
                            id: lead.id,
                            name: lead.name,
                            pipeline_id: lead.pipeline_id,
                            status_id: lead.status_id,
                            fields: []
                        };
                        
                        // Показываем все поля абонемента
                        lead.custom_fields_values.forEach(field => {
                            const fieldId = field.field_id || field.id;
                            const fieldObj = subscriptionFields.find(f => f.id == fieldId);
                            
                            if (fieldObj) {
                                const fieldValue = amoCrmService.getFieldValue(field);
                                console.log(`   • "${fieldObj.name}": ${fieldValue}`);
                                
                                leadInfo.fields.push({
                                    id: fieldId,
                                    name: fieldObj.name,
                                    value: fieldValue
                                });
                            }
                        });
                        
                        leadsWithSubscription.push(leadInfo);
                        
                        if (leadsWithSubscription.length >= 5) {
                            break; // Ограничиваем 5 сделками
                        }
                    }
                }
            }
        }
        
        res.json({
            success: true,
            subscription_fields_found: subscriptionFields.length,
            subscription_fields: subscriptionFields,
            leads_with_subscription: leadsWithSubscription.length,
            leads: leadsWithSubscription
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска полей абонементов:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 🔧 НОВЫЙ МАРШРУТ: Принудительное обновление данных профиля
app.post('/api/profile/refresh/:profileId', async (req, res) => {
    try {
        const profileId = req.params.profileId;
        
        console.log(`\n🔄 ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ ПРОФИЛЯ ID: ${profileId}`);
        
        // 1. Получаем профиль из БД
        const profile = await db.get(
            `SELECT * FROM student_profiles WHERE id = ?`,
            [profileId]
        );
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Профиль не найден'
            });
        }
        
        const phoneNumber = profile.phone_number;
        console.log(`📱 Телефон профиля: ${phoneNumber}`);
        
        // 2. Ищем обновленные данные в amoCRM
        let updatedData = null;
        
        if (amoCrmService.isInitialized) {
            console.log('🔍 Поиск в amoCRM...');
            
            // Ищем контакты по телефону
            const contactsResponse = await amoCrmService.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            if (contacts.length > 0) {
                for (const contact of contacts) {
                    // Получаем полный контакт
                    const fullContact = await amoCrmService.getFullContactInfo(contact.id);
                    if (!fullContact) continue;
                    
                    // Извлекаем информацию о детях
                    const children = amoCrmService.extractStudentsFromContact(fullContact);
                    
                    // Ищем ребенка с таким же именем
                    const targetChild = children.find(child => 
                        child.studentName === profile.student_name
                    );
                    
                    if (targetChild) {
                        console.log(`✅ Найден ребенок в amoCRM: ${targetChild.studentName}`);
                        
                        // Ищем абонемент
                        const lead = await amoCrmService.findLatestActiveSubscription(contact.id);
                        
                        let subscriptionInfo = amoCrmService.extractSubscriptionInfo(null);
                        let bestLead = null;
                        
                        if (lead) {
                            bestLead = lead.lead;
                            subscriptionInfo = lead.subscription;
                            console.log(`✅ Найден абонемент: ${subscriptionInfo.subscriptionStatus}`);
                        }
                        
                        // Создаем обновленный профиль
                        updatedData = amoCrmService.createStudentProfile(
                            fullContact,
                            phoneNumber,
                            targetChild,
                            subscriptionInfo,
                            bestLead
                        );
                        break;
                    }
                }
            }
        }
        
        // 3. Обновляем профиль в БД
        if (updatedData) {
            // Обновляем только если есть изменения
            const needsUpdate = 
                updatedData.total_classes !== profile.total_classes ||
                updatedData.used_classes !== profile.used_classes ||
                updatedData.remaining_classes !== profile.remaining_classes ||
                updatedData.subscription_status !== profile.subscription_status;
            
            if (needsUpdate) {
                console.log('📝 Обновление данных профиля...');
                
                const updateFields = [
                    'total_classes = ?',
                    'used_classes = ?',
                    'remaining_classes = ?',
                    'subscription_type = ?',
                    'subscription_active = ?',
                    'subscription_status = ?',
                    'subscription_badge = ?',
                    'expiration_date = ?',
                    'activation_date = ?',
                    'last_visit_date = ?',
                    'updated_at = CURRENT_TIMESTAMP'
                ];
                
                const updateValues = [
                    updatedData.total_classes || 0,
                    updatedData.used_classes || 0,
                    updatedData.remaining_classes || 0,
                    updatedData.subscription_type || profile.subscription_type,
                    updatedData.subscription_active || 0,
                    updatedData.subscription_status || profile.subscription_status,
                    updatedData.subscription_badge || profile.subscription_badge,
                    updatedData.expiration_date || null,
                    updatedData.activation_date || null,
                    updatedData.last_visit_date || null
                ];
                
                await db.run(
                    `UPDATE student_profiles SET ${updateFields.join(', ')} WHERE id = ?`,
                    [...updateValues, profileId]
                );
                
                console.log('✅ Профиль обновлен');
                
                // Получаем обновленный профиль
                const updatedProfile = await db.get(
                    `SELECT * FROM student_profiles WHERE id = ?`,
                    [profileId]
                );
                
                return res.json({
                    success: true,
                    message: 'Профиль успешно обновлен',
                    data: {
                        profile: updatedProfile,
                        was_updated: true,
                        changes: {
                            classes: `${profile.total_classes}/${profile.used_classes}/${profile.remaining_classes} → ${updatedData.total_classes}/${updatedData.used_classes}/${updatedData.remaining_classes}`,
                            status: `${profile.subscription_status} → ${updatedData.subscription_status}`
                        }
                    }
                });
            } else {
                console.log('ℹ️  Данные не изменились, обновление не требуется');
            }
        }
        
        // 4. Если обновлений нет, возвращаем текущий профиль
        const currentProfile = await db.get(
            `SELECT * FROM student_profiles WHERE id = ?`,
            [profileId]
        );
        
        res.json({
            success: true,
            message: 'Данные актуальны',
            data: {
                profile: currentProfile,
                was_updated: false
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления профиля:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 🔧 МАРШРУТ: Быстрое получение данных абонемента
app.post('/api/subscription/fast/:profileId', async (req, res) => {
    try {
        const profileId = req.params.profileId;
        
        console.log(`\n⚡ БЫСТРЫЙ ЗАПРОС АБОНЕМЕНТА ДЛЯ ПРОФИЛЯ ID: ${profileId}`);
        
        // 1. Получаем профиль из БД
        const profile = await db.get(
            `SELECT * FROM student_profiles WHERE id = ?`,
            [profileId]
        );
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Профиль не найден'
            });
        }
        
        // 2. Если есть ID сделки в amoCRM, получаем свежие данные
        let subscriptionData = null;
        
        if (profile.amocrm_lead_id && amoCrmService.isInitialized) {
            console.log(`🔍 Быстрая проверка сделки ${profile.amocrm_lead_id}...`);
            
            try {
                const lead = await amoCrmService.getLeadById(profile.amocrm_lead_id);
                if (lead) {
                    subscriptionData = amoCrmService.extractSubscriptionInfo(lead);
                    console.log(`✅ Получены свежие данные из amoCRM`);
                }
            } catch (error) {
                console.log(`⚠️  Не удалось получить свежие данные: ${error.message}`);
            }
        }
        
        // 3. Используем данные из профиля, если нет свежих
        if (!subscriptionData) {
            subscriptionData = {
                totalClasses: profile.total_classes || 0,
                usedClasses: profile.used_classes || 0,
                remainingClasses: profile.remaining_classes || 0,
                subscriptionType: profile.subscription_type || 'Без абонемента',
                subscriptionStatus: profile.subscription_status || 'Нет данных',
                subscriptionActive: profile.subscription_active === 1,
                subscriptionBadge: profile.subscription_badge || 'inactive',
                expirationDate: profile.expiration_date,
                activationDate: profile.activation_date,
                lastVisitDate: profile.last_visit_date,
                branch: profile.branch,
                subscriptionOwner: ''
            };
        }
        
        // 4. Рассчитываем прогресс
        let progress = 0;
        if (subscriptionData.totalClasses > 0) {
            progress = Math.round((subscriptionData.usedClasses / subscriptionData.totalClasses) * 100);
        }
        
        // 5. Формируем ответ
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
                    allergies: profile.allergies
                },
                subscription: {
                    type: subscriptionData.subscriptionType,
                    status: subscriptionData.subscriptionStatus,
                    badge: subscriptionData.subscriptionBadge,
                    is_active: subscriptionData.subscriptionActive,
                    classes: {
                        total: subscriptionData.totalClasses,
                        used: subscriptionData.usedClasses,
                        remaining: subscriptionData.remainingClasses,
                        progress: progress
                    },
                    dates: {
                        activation: subscriptionData.activationDate,
                        expiration: subscriptionData.expirationDate,
                        last_visit: subscriptionData.lastVisitDate
                    }
                },
                metadata: {
                    last_updated: profile.updated_at,
                    data_source: profile.source,
                    has_fresh_data: subscriptionData !== null
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка быстрого запроса абонемента:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения данных абонемента'
        });
    }
});

// Проверка активных абонементов контакта
app.get('/api/debug/contact-active-subscriptions/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        
        console.log(`\n🔍 ДЕТАЛЬНАЯ ПРОВЕРКА АКТИВНЫХ АБОНЕМЕНТОВ КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем контакт
        const contact = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/contacts/${contactId}?with=custom_fields_values`
        );
        
        console.log(`👤 Контакт: ${contact.name} (ID: ${contact.id})`);
        
        // Ищем активные абонементы
        const subscriptions = await amoCrmService.findActiveSubscriptions(contactId);
        
        // Показываем поле "Есть активный абонемент" из контакта
        let contactHasActive = false;
        if (contact.custom_fields_values) {
            contact.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                if (fieldId === 890179) { // "Есть активный абонемент"
                    const value = amoCrmService.getFieldValue(field);
                    contactHasActive = value.toLowerCase() === 'да';
                    console.log(`📋 Поле контакта "Есть активный абонемент": ${value} → ${contactHasActive ? 'Да' : 'Нет'}`);
                }
            });
        }
        
        res.json({
            success: true,
            contact: {
                id: contact.id,
                name: contact.name,
                has_active_subscription_field: contactHasActive
            },
            subscriptions: subscriptions,
            recommendation: subscriptions.active_count > 0 ? 
                `Использовать активный абонемент из сделки ID: ${subscriptions.active[0].lead_id}` :
                `Активных абонементов не найдено. Использовать последний: ${subscriptions.all.length > 0 ? subscriptions.all[0].lead_id : 'нет'}`,
            debug: {
                total_leads_checked: subscriptions.total,
                active_by_data: subscriptions.active_count,
                all_sorted_by_activation: subscriptions.all.map(s => ({
                    id: s.lead_id,
                    name: s.lead_name,
                    activation: s.activation_date,
                    expiration: s.expiration_date,
                    classes: `${s.subscription.totalClasses}/${s.subscription.usedClasses}/${s.subscription.remainingClasses}`,
                    is_active: s.subscription.subscriptionActive,
                    is_active_by_data: s.is_active_by_data
                }))
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки активных абонементов:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// Диагностика конкретного контакта
app.get('/api/debug/test-contact-leads/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        
        console.log(`\n🔍 ДИАГНОСТИКА СДЕЛОК КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Тестируем оба метода
        console.log('\n🔍 ТЕСТ ОСНОВНОГО МЕТОДА:');
        const leads1 = await amoCrmService.getContactLeads(contactId);
        console.log(`📊 Основной метод: ${leads1.length} сделок`);
        
        console.log('\n🔍 ТЕСТ АЛЬТЕРНАТИВНОГО МЕТОДА:');
        const leads2 = await amoCrmService.getContactLeadsAlternative(contactId);
        console.log(`📊 Альтернативный метод: ${leads2.length} сделок`);
        
        // Объединяем результаты
        const allLeads = [...leads1, ...leads2];
        const uniqueLeads = allLeads.filter((lead, index, self) =>
            index === self.findIndex((l) => l.id === lead.id)
        );
        
        console.log(`\n📊 УНИКАЛЬНЫХ СДЕЛОК: ${uniqueLeads.length}`);
        
        // Показываем сделки с абонементами
        const subscriptionLeads = uniqueLeads.filter(lead => 
            lead.custom_fields_values?.some(f => {
                const fieldId = f.field_id || f.id;
                return [850241, 850257, 890163].includes(fieldId);
            })
        );
        
        console.log(`🎯 СДЕЛОК С АБОНЕМЕНТАМИ: ${subscriptionLeads.length}`);
        
        res.json({
            success: true,
            contact_id: contactId,
            leads: {
                method1: leads1.length,
                method2: leads2.length,
                unique: uniqueLeads.length,
                with_subscription: subscriptionLeads.length
            },
            subscription_leads: subscriptionLeads.map(l => ({
                id: l.id,
                name: l.name,
                status_id: l.status_id,
                pipeline_id: l.pipeline_id
            }))
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Добавьте этот маршрут для поиска ID полей
app.get('/api/debug/find-field-id/:name', async (req, res) => {
    try {
        const fieldName = req.params.name;
        
        console.log(`\n🔍 ПОИСК ID ПОЛЯ ПО НАЗВАНИЮ: "${fieldName}"`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Ищем в полях контактов
        const contactFields = await amoCrmService.makeRequest('GET', '/api/v4/contacts/custom_fields');
        const leadFields = await amoCrmService.makeRequest('GET', '/api/v4/leads/custom_fields');
        
        const foundFields = [];
        
        // Ищем в полях контактов
        if (contactFields._embedded && contactFields._embedded.custom_fields) {
            contactFields._embedded.custom_fields.forEach(field => {
                if (field.name.toLowerCase().includes(fieldName.toLowerCase())) {
                    foundFields.push({
                        source: 'contact',
                        id: field.id,
                        name: field.name,
                        type: field.type
                    });
                }
            });
        }
        
        // Ищем в полях сделок
        if (leadFields._embedded && leadFields._embedded.custom_fields) {
            leadFields._embedded.custom_fields.forEach(field => {
                if (field.name.toLowerCase().includes(fieldName.toLowerCase())) {
                    foundFields.push({
                        source: 'lead',
                        id: field.id,
                        name: field.name,
                        type: field.type
                    });
                }
            });
        }
        
        console.log(`📊 Найдено полей: ${foundFields.length}`);
        foundFields.forEach(f => {
            console.log(`   • ${f.source.toUpperCase()}: ID ${f.id} - "${f.name}" (${f.type})`);
        });
        
        res.json({
            success: true,
            search_name: fieldName,
            found_count: foundFields.length,
            fields: foundFields
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска поля:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Маршрут для диагностики контакта по ID
app.get('/api/debug/contact/:id', async (req, res) => {
    try {
        const contactId = req.params.id;
        
        console.log(`\n🔍 ДИАГНОСТИКА КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем контакт
        const contact = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/contacts/${contactId}?with=custom_fields_values`
        );
        
        console.log('\n📊 ИМЯ КОНТАКТА:', contact.name);
        console.log(`📊 ID контакта: ${contact.id}`);
        
        console.log('\n📋 ВСЕ ПОЛЯ КОНТАКТА:');
        console.log('='.repeat(80));
        
        if (contact.custom_fields_values && contact.custom_fields_values.length > 0) {
            contact.custom_fields_values.forEach((field, index) => {
                const fieldId = field.field_id || field.id || 'unknown';
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                console.log(`[${index + 1}] ID: ${fieldId} | "${fieldName}": "${fieldValue}"`);
            });
        } else {
            console.log('❌ Нет кастомных полей в контакте');
        }
        
        console.log('='.repeat(80));
        
        // Получаем сделки этого контакта
        console.log('\n🔍 ПОИСК СДЕЛОК ЭТОГО КОНТАКТА...');
        try {
            const leadsResponse = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/contacts/${contactId}/leads?with=custom_fields_values`
            );
            
            const leads = leadsResponse._embedded?.leads || [];
            console.log(`📊 Найдено сделок: ${leads.length}`);
            
            leads.forEach(lead => {
                console.log(`\n📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
                console.log(`   Статус ID: ${lead.status_id}, Воронка ID: ${lead.pipeline_id}`);
                
                if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                    console.log(`   Кастомные поля (${lead.custom_fields_values.length}):`);
                    lead.custom_fields_values.forEach(field => {
                        const fieldName = amoCrmService.getFieldName(field).toLowerCase();
                        const fieldValue = amoCrmService.getFieldValue(field);
                        console.log(`      • "${fieldName}": ${fieldValue}`);
                    });
                } else {
                    console.log(`   ❌ Нет кастомных полей в сделке`);
                }
            });
            
            // Показываем сырые данные первой сделки
            if (leads.length > 0) {
                console.log('\n📄 СЫРЫЕ ДАННЫЕ ПЕРВОЙ СДЕЛКИ (первые 1000 символов):');
                const rawData = JSON.stringify(leads[0], null, 2);
                console.log(rawData.substring(0, 1000) + (rawData.length > 1000 ? '...' : ''));
            }
            
        } catch (leadError) {
            console.error(`❌ Ошибка получения сделок: ${leadError.message}`);
        }
        
        res.json({
            success: true,
            data: {
                contact_id: contact.id,
                contact_name: contact.name,
                fields_count: contact.custom_fields_values ? contact.custom_fields_values.length : 0,
                fields: contact.custom_fields_values ? contact.custom_fields_values.map((f, i) => ({
                    index: i,
                    field_id: f.field_id || f.id,
                    field_name: amoCrmService.getFieldName(f),
                    field_value: amoCrmService.getFieldValue(f)
                })) : [],
                leads_found: leads ? leads.length : 0
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики контакта:', error.message);
        if (error.response) {
            console.error('📊 Ответ сервера:', error.response.status, error.response.data);
        }
        
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response ? {
                status: error.response.status,
                data: error.response.data
            } : null
        });
    }
});

// Маршрут для ручного обновления данных абонемента
app.post('/api/debug/update-subscription/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        const { usedClasses, remainingClasses, activationDate, expirationDate } = req.body;
        
        console.log(`\n🔧 ОБНОВЛЕНИЕ ДАННЫХ АБОНЕМЕНТА ДЛЯ СДЕЛКИ ID: ${leadId}`);
        console.log(`📊 Данные: usedClasses=${usedClasses}, remainingClasses=${remainingClasses}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем текущую сделку
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        // Формируем обновленные поля
        const updates = [];
        
        if (usedClasses !== undefined) {
            updates.push({
                field_id: 850257, // "Счетчик занятий:"
                values: [
                    {
                        value: String(usedClasses)
                    }
                ]
            });
        }
        
        if (remainingClasses !== undefined) {
            updates.push({
                field_id: 890163, // "Остаток занятий"
                values: [
                    {
                        value: String(remainingClasses)
                    }
                ]
            });
        }
        
        if (activationDate) {
            updates.push({
                field_id: 851565, // "Дата активации абонемента:"
                values: [
                    {
                        value: Math.floor(new Date(activationDate).getTime() / 1000)
                    }
                ]
            });
        }
        
        if (expirationDate) {
            updates.push({
                field_id: 850255, // "Окончание абонемента:"
                values: [
                    {
                        value: Math.floor(new Date(expirationDate).getTime() / 1000)
                    }
                ]
            });
        }
        
        if (updates.length > 0) {
            // Обновляем сделку
            const updateData = {
                id: parseInt(leadId),
                custom_fields_values: updates
            };
            
            console.log(`\n📤 Отправка обновления в amoCRM:`, JSON.stringify(updateData, null, 2));
            
            const response = await amoCrmService.makeRequest(
                'PATCH',
                `/api/v4/leads`,
                [updateData]
            );
            
            console.log(`✅ Данные обновлены в amoCRM`);
            
            // Получаем обновленную сделку для проверки
            const updatedLead = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}?with=custom_fields_values`
            );
            
            // Анализируем обновленный абонемент
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(updatedLead);
            
            res.json({
                success: true,
                message: 'Данные абонемента обновлены',
                lead_id: leadId,
                updates_applied: updates.length,
                subscription: subscriptionInfo,
                updated_fields: updates.map(u => ({
                    field_id: u.field_id,
                    value: u.values[0].value
                }))
            });
            
        } else {
            res.json({
                success: false,
                error: 'Нет данных для обновления'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка обновления данных:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response?.data
        });
    }
});

// Детальная проверка сделки с абонементом
app.get('/api/debug/lead-subscription-details/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        
        console.log(`\n🔍 ДЕТАЛЬНАЯ ПРОВЕРКА АБОНЕМЕНТА В СДЕЛКЕ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values,contacts`
        );
        
        console.log(`\n📋 СДЕЛКА: "${lead.name}" (ID: ${lead.id})`);
        console.log(`📊 Статус: ${lead.status_id}, Воронка: ${lead.pipeline_id}`);
        console.log(`📅 Создана: ${lead.created_at}`);
        
        // Показываем все поля абонемента
        console.log(`\n📊 ПОЛЯ АБОНЕМЕНТА:`);
        console.log('='.repeat(60));
        
        const subscriptionFields = [];
        const otherFields = [];
        
        if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
            lead.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                
                // Ключевые поля абонемента
                const isSubscriptionField = [
                    850241, 850257, 890163, 850255, 851565, 891007, 805465
                ].includes(fieldId);
                
                if (isSubscriptionField && fieldValue && fieldValue.trim() !== '') {
                    console.log(`🎯 ${fieldName}: ${fieldValue}`);
                    subscriptionFields.push({
                        id: fieldId,
                        name: fieldName,
                        value: fieldValue,
                        raw: field
                    });
                } else if (fieldValue && fieldValue.trim() !== '') {
                    otherFields.push({
                        id: fieldId,
                        name: fieldName,
                        value: fieldValue
                    });
                }
            });
        }
        
        console.log('='.repeat(60));
        
        // Анализируем абонемент
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        // Проверяем, есть ли поля счетчика и остатка
        const hasCounter = subscriptionFields.some(f => f.id === 850257);
        const hasRemaining = subscriptionFields.some(f => f.id === 890163);
        
        console.log(`\n📊 АНАЛИЗ АБОНЕМЕНТА:`);
        console.log(`   Счетчик занятий: ${hasCounter ? '✅ Есть' : '❌ Нет'}`);
        console.log(`   Остаток занятий: ${hasRemaining ? '✅ Есть' : '❌ Нет'}`);
        console.log(`   Всего занятий: ${subscriptionInfo.totalClasses}`);
        console.log(`   Использовано: ${subscriptionInfo.usedClasses}`);
        console.log(`   Осталось: ${subscriptionInfo.remainingClasses}`);
        
        // Показываем другие интересные поля
        console.log(`\n📋 ДРУГИЕ ПОЛЯ СДЕЛКИ (${otherFields.length}):`);
        otherFields.slice(0, 10).forEach(field => {
            console.log(`   • ${field.name}: ${field.value}`);
        });
        
        // Показываем информацию о контакте
        console.log(`\n👤 СВЯЗАННЫЕ КОНТАКТЫ:`);
        if (lead._embedded && lead._embedded.contacts) {
            lead._embedded.contacts.forEach(contact => {
                console.log(`   • ${contact.name} (ID: ${contact.id})`);
            });
        }
        
        res.json({
            success: true,
            lead: {
                id: lead.id,
                name: lead.name,
                status_id: lead.status_id,
                pipeline_id: lead.pipeline_id,
                created_at: lead.created_at,
                is_closed: [142, 143].includes(lead.status_id)
            },
            subscription: subscriptionInfo,
            subscription_fields: subscriptionFields,
            has_counter_field: hasCounter,
            has_remaining_field: hasRemaining,
            fields_summary: {
                total: (lead.custom_fields_values || []).length,
                subscription: subscriptionFields.length,
                other: otherFields.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки сделки:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Маршрут для поиска полей по ключевым словам
app.get('/api/debug/fields/search/:keyword', async (req, res) => {
    try {
        const keyword = req.params.keyword.toLowerCase();
        console.log(`\n🔍 ПОИСК ПОЛЕЙ ПО КЛЮЧЕВОМУ СЛОВУ: "${keyword}"`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем все кастомные поля контактов
        const fields = await amoCrmService.makeRequest('GET', '/api/v4/contacts/custom_fields');
        
        const foundFields = [];
        
        if (fields && fields._embedded && fields._embedded.custom_fields) {
            fields._embedded.custom_fields.forEach(field => {
                const fieldName = field.name.toLowerCase();
                if (fieldName.includes(keyword)) {
                    foundFields.push({
                        id: field.id,
                        name: field.name,
                        type: field.type,
                        enums: field.enums || []
                    });
                }
            });
        }
        
        console.log(`📊 Найдено полей: ${foundFields.length}`);
        
        if (foundFields.length === 0) {
            // Показываем все поля для отладки
            console.log('📋 ВСЕ ПОЛЯ ДЛЯ ОТЛАДКИ:');
            if (fields && fields._embedded && fields._embedded.custom_fields) {
                fields._embedded.custom_fields.slice(0, 20).forEach(field => {
                    console.log(`   ${field.id}: "${field.name}" (${field.type})`);
                });
            }
        }
        
        res.json({
            success: true,
            keyword: keyword,
            found_count: foundFields.length,
            fields: foundFields
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска полей:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Маршрут для тестирования телефона
app.get('/api/debug/phone/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        console.log(`\n📱 ТЕСТИРОВАНИЕ ПО ТЕЛЕФОНУ: ${phone}`);
        console.log('='.repeat(80));
        
        if (!amoCrmService.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return res.json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Форматируем телефон
        const formattedPhone = phone.replace(/\D/g, '');
        let searchPhone;
        if (formattedPhone.length === 11 && formattedPhone.startsWith('7')) {
            searchPhone = `+${formattedPhone}`;
        } else if (formattedPhone.length === 10) {
            searchPhone = `+7${formattedPhone}`;
        } else {
            searchPhone = `+${formattedPhone}`;
        }
        
        console.log(`📱 Форматированный номер для поиска: ${searchPhone}`);
        
        // 1. Ищем контакты
        console.log('\n🔍 ПОИСК КОНТАКТОВ...');
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        console.log(`✅ Найдено контактов: ${contacts.length}`);
        
        // 2. Для каждого контакта получаем сделки
        let allLeads = [];
        for (const contact of contacts) {
            console.log(`\n👤 Контакт: ${contact.name} (ID: ${contact.id})`);
            
            try {
                const leadsResponse = await amoCrmService.makeRequest(
                    'GET',
                    `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contact.id}`
                );
                
                const leads = leadsResponse._embedded?.leads || [];
                console.log(`📊 Сделок у контакта: ${leads.length}`);
                
                leads.forEach(lead => {
                    allLeads.push({
                        contact_id: contact.id,
                        contact_name: contact.name,
                        lead_id: lead.id,
                        lead_name: lead.name,
                        lead_status_id: lead.status_id,
                        lead_pipeline_id: lead.pipeline_id
                    });
                    
                    // Быстрый анализ абонемента
                    console.log(`   📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
                    if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                        lead.custom_fields_values.forEach(field => {
                            const fieldName = amoCrmService.getFieldName(field).toLowerCase();
                            if (fieldName.includes('абонемент') || 
                                fieldName.includes('занят') || 
                                fieldName.includes('счетчик') ||
                                fieldName.includes('остаток')) {
                                const value = amoCrmService.getFieldValue(field);
                                console.log(`      → "${fieldName}": ${value}`);
                            }
                        });
                    }
                });
                
            } catch (leadError) {
                console.error(`   ❌ Ошибка получения сделок: ${leadError.message}`);
            }
        }
        
        // 3. Получаем профили через основной метод
        console.log('\n🎯 ЗАПУСК ОСНОВНОГО МЕТОДА ПОИСКА...');
        const profiles = await amoCrmService.getStudentsByPhone(phone);
        console.log(`📊 Профилей найдено: ${profiles.length}`);
        
        res.json({
            success: true,
            phone: phone,
            formatted_phone: searchPhone,
            contacts_found: contacts.length,
            leads_found: allLeads.length,
            profiles_found: profiles.length,
            contacts: contacts.map(c => ({
                id: c.id,
                name: c.name,
                fields_count: c.custom_fields_values ? c.custom_fields_values.length : 0
            })),
            leads: allLeads,
            profiles: profiles.map(p => ({
                student_name: p.student_name,
                branch: p.branch,
                subscription_status: p.subscription_status,
                total_classes: p.total_classes,
                used_classes: p.used_classes,
                remaining_classes: p.remaining_classes
            }))
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестирования телефона:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            phone: req.params.phone
        });
    }
});

// Маршрут для проверки воронок
app.get('/api/debug/pipelines', async (req, res) => {
    try {
        console.log(`\n🔍 ПОЛУЧЕНИЕ СПИСКА ВОРОНОК`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем все воронки
        const pipelines = await amoCrmService.makeRequest('GET', '/api/v4/leads/pipelines');
        
        console.log('\n📋 ВСЕ ВОРОНКИ:');
        console.log('='.repeat(80));
        
        if (pipelines && pipelines._embedded && pipelines._embedded.pipelines) {
            pipelines._embedded.pipelines.forEach(pipeline => {
                console.log(`🏷️  ${pipeline.id}: "${pipeline.name}"`);
                
                // Получаем статусы для этой воронки
                amoCrmService.makeRequest('GET', `/api/v4/leads/pipelines/${pipeline.id}/statuses`)
                    .then(statuses => {
                        if (statuses && statuses._embedded && statuses._embedded.statuses) {
                            console.log(`   Статусы (${statuses._embedded.statuses.length}):`);
                            statuses._embedded.statuses.forEach(status => {
                                console.log(`     • ${status.id}: "${status.name}"`);
                            });
                        }
                    })
                    .catch(err => {
                        console.log(`   ❌ Ошибка получения статусов: ${err.message}`);
                    });
            });
        }
        
        res.json({
            success: true,
            pipelines_count: pipelines._embedded?.pipelines?.length || 0,
            pipelines: pipelines._embedded?.pipelines?.map(p => ({
                id: p.id,
                name: p.name,
                is_main: p.is_main
            })) || []
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения воронок:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/profile/:id', async (req, res) => {
    try {
        const profileId = req.params.id;
        
        console.log(`👤 ЗАПРОС ПРОФИЛЯ ID: ${profileId}`);
        
        const profile = await db.get(
            `SELECT * FROM student_profiles WHERE id = ?`,
            [profileId]
        );
        
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
                profile: {
                    student: {
                        id: profile.id,
                        name: profile.student_name,
                        phone: profile.phone_number,
                        email: profile.email,
                        birth_date: profile.birth_date,
                        branch: profile.branch || 'Филиал не указан',
                        age_group: profile.age_group,
                        course: profile.course,
                        allergies: profile.allergies
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
                    } : null
                },
                stats: {
                    total_visits: profile.used_classes || 0,
                    remaining_classes: profile.remaining_classes || 0,
                    usage_percentage: progress
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения профиля:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профиля'
        });
    }
});

// Специальный маршрут для поиска полей, нужных для школы рисования
app.get('/api/debug/school-fields', async (req, res) => {
    try {
        console.log(`\n🎨 ПОИСК ПОЛЕЙ ДЛЯ ШКОЛЫ РИСОВАНИЯ`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Ключевые слова для школы рисования
        const schoolKeywords = [
            // Ученики
            'ученик', 'ребенок', 'фио', 'имя', 'дети', 
            // Абонементы
            'абонемент', 'занят', 'счетчик', 'остаток', 'посещен',
            // Расписание
            'филиал', 'преподаватель', 'педагог', 'группа', 'курс',
            // Даты
            'дата', 'активац', 'окончан', 'визит', 'посещен', 'рождения',
            // Дополнительно
            'аллерг', 'особенност', 'родитель', 'возраст', 'направлен',
            // Оплата
            'оплат', 'чек', 'сертификат', 'заморозк'
        ];
        
        const foundFields = [];
        
        // Ищем в контактах и сделках
        const [contactFieldsRes, leadFieldsRes] = await Promise.all([
            amoCrmService.makeRequest('GET', '/api/v4/contacts/custom_fields'),
            amoCrmService.makeRequest('GET', '/api/v4/leads/custom_fields')
        ]);
        
        const contactFields = contactFieldsRes._embedded?.custom_fields || [];
        const leadFields = leadFieldsRes._embedded?.custom_fields || [];
        
        console.log('\n🎯 ПОЛЯ СДЕЛОК (АБОНЕМЕНТЫ):');
        console.log('='.repeat(80));
        
        leadFields.forEach(field => {
            const fieldName = field.name.toLowerCase();
            schoolKeywords.forEach(keyword => {
                if (fieldName.includes(keyword)) {
                    foundFields.push({
                        entity: 'lead',
                        id: field.id,
                        name: field.name,
                        type: field.type,
                        is_critical: ['абонемент', 'счетчик', 'остаток', 'занят'].some(k => fieldName.includes(k))
                    });
                    
                    const criticalMarker = ['абонемент', 'счетчик', 'остаток', 'занят'].some(k => fieldName.includes(k)) ? ' 🔑' : '';
                    console.log(`📋 ID ${field.id}: "${field.name}" (${field.type})${criticalMarker}`);
                    
                    if (field.enums && field.enums.length > 0) {
                        console.log(`   Варианты: ${field.enums.slice(0, 5).map(e => e.value).join(', ')}${field.enums.length > 5 ? '...' : ''}`);
                    }
                }
            });
        });
        
        console.log('\n🎯 ПОЛЯ КОНТАКТОВ (УЧЕНИКИ):');
        console.log('='.repeat(80));
        
        contactFields.forEach(field => {
            const fieldName = field.name.toLowerCase();
            schoolKeywords.forEach(keyword => {
                if (fieldName.includes(keyword)) {
                    foundFields.push({
                        entity: 'contact',
                        id: field.id,
                        name: field.name,
                        type: field.type,
                        is_critical: ['ученик', 'ребенок', 'фио', 'филиал', 'преподаватель'].some(k => fieldName.includes(k))
                    });
                    
                    const criticalMarker = ['ученик', 'ребенок', 'фио', 'филиал', 'преподаватель'].some(k => fieldName.includes(k)) ? ' 🔑' : '';
                    console.log(`👤 ID ${field.id}: "${field.name}" (${field.type})${criticalMarker}`);
                }
            });
        });
        
        // ВАЖНО: Инициализируем categorized перед использованием
        const categorized = {
            subscription: [],
            student: [],
            schedule: [],
            dates: [],
            other: []
        };
        
        // Теперь заполняем категории
        foundFields.forEach(field => {
            const fieldName = field.name.toLowerCase();
            
            if (fieldName.includes('абонемент') || 
                fieldName.includes('занят') ||
                fieldName.includes('счетчик') ||
                fieldName.includes('остаток')) {
                categorized.subscription.push(field);
            }
            else if (fieldName.includes('ученик') || 
                     fieldName.includes('ребенок') ||
                     fieldName.includes('фио')) {
                categorized.student.push(field);
            }
            else if (fieldName.includes('филиал') || 
                     fieldName.includes('преподаватель') ||
                     fieldName.includes('педагог') ||
                     fieldName.includes('группа')) {
                categorized.schedule.push(field);
            }
            else if (fieldName.includes('дата')) {
                categorized.dates.push(field);
            }
            else {
                categorized.other.push(field);
            }
        });
        
        console.log(`\n📊 ИТОГО найдено: ${foundFields.length} полей`);
        console.log(`   🔑 Критических: ${foundFields.filter(f => f.is_critical).length}`);
        console.log(`   📋 Абонементы: ${categorized.subscription.length}`);
        console.log(`   👤 Ученики: ${categorized.student.length}`);
        console.log(`   📅 Расписание: ${categorized.schedule.length}`);
        console.log(`   📅 Даты: ${categorized.dates.length}`);
        console.log(`   📦 Прочие: ${categorized.other.length}`);
        
        res.json({
            success: true,
            total_found: foundFields.length,
            categorized: categorized,
            all_fields: foundFields,
            critical_fields: foundFields.filter(f => f.is_critical)
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска полей школы:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Получение всех профилей для пользователя
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
            is_demo: p.is_demo === 1,
            source: p.source
        }));
        
        res.json({
            success: true,
            data: {
                profiles: formattedProfiles,
                total: profiles.length,
                has_multiple: profiles.length > 1
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
        console.log('✨ ПОЛНОСТЬЮ ПЕРЕРАБОТАНА ЛОГИКА РАБОТЫ С AMOCRM');
        console.log('✨ ДОБАВЛЕНЫ ВСЕ ВАШИ ID ПОЛЕЙ');
        console.log('✨ ИСПРАВЛЕНЫ ОШИБКИ ПОИСКА ДЕТЕЙ И АБОНЕМЕНТОВ');
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
            console.log(`🔍 Профили пользователя: GET http://localhost:${PORT}/api/profiles`);
            console.log(`📋 Абонемент: POST http://localhost:${PORT}/api/subscription`);
            console.log(`🧪 Полный тест цикла: GET http://localhost:${PORT}/api/test/full-cycle/79175161115`);
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
