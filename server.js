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
// В классе AmoCrmService обновите FIELD_IDS
this.FIELD_IDS = {
    // Сделки (абонементы) - ВСЕ НАЙДЕННЫЕ ПОЛЯ
    LEAD: {
        // Основные поля абонемента
        TOTAL_CLASSES: 850241,        // "Абонемент занятий:" (select)
        USED_CLASSES: 850257,         // "Счетчик занятий:" (select)
        USED_CLASSES_NUM: 884251,     // "Кол-во отхоженных занятий" (numeric) - АЛЬТЕРНАТИВНЫЙ СЧЕТЧИК!
        REMAINING_CLASSES: 890163,    // "Остаток занятий" (numeric)
        EXPIRATION_DATE: 850255,      // "Окончание абонемента:" (date)
        ACTIVATION_DATE: 851565,      // "Дата активации абонемента:" (date)
        LAST_VISIT_DATE: 850259,      // "Дата последнего визита:" (date)
        SUBSCRIPTION_TYPE: 891007,    // "Тип абонемента" (select)
        SUBSCRIPTION_OWNER: 805465,   // "Принадлежность абонемента:" (select)
        FREEZE: 867693,               // "Заморозка абонемента:" (select)
        BRANCH: 891589,               // "Филиал" (select) - в сделке!
        AGE_GROUP: 850243,            // "Группа возраст:" (select)
        PURCHASE_DATE: 850253,        // "Дата покупки:" (date)
        
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
        
        // Технические поля
        TECHNICAL_CLASSES: 891819,    // "Количество занятий (тех)" (numeric)
        CLASS_PRICE: 891813,          // "Стоимость 1 занятия" (numeric)
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
        
        // Разделители (для информации)
        CHILDREN_SECTION: 867227,    // "---Дети---"
        CHILD_1_SECTION: 867229,     // "--Ребенок 1--"
        CHILD_2_SECTION: 867231,     // "--Ребенок 2--"
        CHILD_3_SECTION: 867731,     // "--Ребенок 3--"
        
        // Общие поля
        PARENT_NAME: 'name',         // Имя контакта
        EMAIL: 850217                // "Почта" (если есть)
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
            
            if (typeof firstValue === 'string') {
                return firstValue;
            } else if (typeof firstValue === 'object' && firstValue !== null) {
                if (firstValue.value !== undefined) {
                    return String(firstValue.value);
                } else if (firstValue.enum_value !== undefined) {
                    return String(firstValue.enum_value);
                } else if (firstValue.enum_id !== undefined) {
                    return String(firstValue.enum_id);
                }
            }
            
            return String(firstValue);
        } catch (error) {
            console.error('❌ Ошибка получения значения поля:', error);
            return '';
        }
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

    parseClassesCount(value) {
    if (!value) return 0;
    
    const str = String(value).toLowerCase().trim();
    console.log(`🔢 Парсим значение: "${str}"`);
    
    // Проверяем enum значения
    const enumMatches = {
        '554197': 8,    // "8 занятий" 
        '554199': 4,    // "4 занятия"
        '554201': 16,   // "16 занятий"
        '554203': 24,   // "24 занятия"
        '554205': 2,    // "2 занятия"
        '554207': 3     // "3 занятия"
    };
    
    // Если значение - это enum_id
    if (enumMatches[value]) {
        const result = enumMatches[value];
        console.log(`   → Найден enum_id ${value}: ${result} занятий`);
        return result;
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
        'одно': 1, 'один': 1, 'раз': 1,
        'два': 2, 'две': 2,
        'три': 3, 'трое': 3,
        'четыре': 4,
        'пять': 5,
        'шесть': 6,
        'семь': 7,
        'восемь': 8,
        'девять': 9,
        'десять': 10,
        'восемь занятий': 8,
        'четыре занятия': 4,
        'шестнадцать занятий': 16
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
            
            if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{2,4}$/)) {
                const parts = dateStr.split('.');
                let day = parts[0].padStart(2, '0');
                let month = parts[1].padStart(2, '0');
                let year = parts[2];
                
                if (year.length === 2) {
                    year = '20' + year;
                }
                
                const result = `${year}-${month}-${day}`;
                console.log(`   → Преобразовано в: ${result}`);
                return result;
            }
            
            if (dateStr.match(/^\d{4}-\d{1,2}-\d{1,2}$/)) {
                const parts = dateStr.split('-');
                const result = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                console.log(`   → Стандартизировано: ${result}`);
                return result;
            }
            
            console.log(`   → Формат не распознан, возвращаем как есть`);
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
        subscriptionOwner: ''
    };
    
    if (!lead) {
        return subscriptionInfo;
    }
    
    try {
        const customFields = lead.custom_fields_values || [];
        const leadName = lead.name || '';
        const statusId = lead.status_id || 0;
        
        console.log(`\n🔍 Анализ абонемента в сделке: "${leadName}" (ID: ${lead.id}, Статус: ${statusId})`);
        
        // Сначала собираем все данные
        for (const field of customFields) {
            const fieldId = field.field_id || field.id;
            const fieldName = this.getFieldName(field);
            const fieldValue = this.getFieldValue(field);
            
            if (!fieldValue || fieldValue.trim() === '') continue;
            
            // 1. Количество занятий (абонемент)
            if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES) {
                subscriptionInfo.hasSubscription = true;
                subscriptionInfo.totalClasses = this.parseClassesCount(fieldValue);
                console.log(`   🎫 Абонемент: ${fieldValue} → ${subscriptionInfo.totalClasses} занятий`);
            }
            
            // 2. Счетчик занятий (использовано) - поле select
            else if (fieldId === this.FIELD_IDS.LEAD.USED_CLASSES) {
                subscriptionInfo.hasSubscription = true;
                subscriptionInfo.usedClasses = this.parseClassesCount(fieldValue);
                console.log(`   📊 Счетчик занятий: ${fieldValue} → ${subscriptionInfo.usedClasses}`);
            }
            
            // 3. Альтернативный счетчик (numeric)
            else if (fieldId === this.FIELD_IDS.LEAD.USED_CLASSES_NUM) {
                subscriptionInfo.hasSubscription = true;
                const numValue = parseInt(fieldValue) || 0;
                // Берем большее значение между двумя счетчиками
                subscriptionInfo.usedClasses = Math.max(subscriptionInfo.usedClasses, numValue);
                console.log(`   📊 Кол-во отхоженных: ${fieldValue} → ${numValue}`);
            }
            
            // 4. Остаток занятий
            else if (fieldId === this.FIELD_IDS.LEAD.REMAINING_CLASSES) {
                subscriptionInfo.hasSubscription = true;
                subscriptionInfo.remainingClasses = parseInt(fieldValue) || 0;
                console.log(`   📊 Остаток занятий: ${fieldValue} → ${subscriptionInfo.remainingClasses}`);
            }
            
            // 5. Техническое количество занятий
            else if (fieldId === this.FIELD_IDS.LEAD.TECHNICAL_CLASSES) {
                subscriptionInfo.hasSubscription = true;
                const techClasses = parseInt(fieldValue) || 0;
                // Если основное поле не заполнено, используем техническое
                if (subscriptionInfo.totalClasses === 0 && techClasses > 0) {
                    subscriptionInfo.totalClasses = techClasses;
                    console.log(`   🔧 Техническое количество: ${fieldValue} → ${techClasses}`);
                }
            }
            
            // 6. Дата окончания
            else if (fieldId === this.FIELD_IDS.LEAD.EXPIRATION_DATE) {
                subscriptionInfo.hasSubscription = true;
                subscriptionInfo.expirationDate = this.parseDate(fieldValue);
                console.log(`   📅 Окончание: ${fieldValue} → ${subscriptionInfo.expirationDate}`);
            }
            
            // 7. Дата активации
            else if (fieldId === this.FIELD_IDS.LEAD.ACTIVATION_DATE) {
                subscriptionInfo.hasSubscription = true;
                subscriptionInfo.activationDate = this.parseDate(fieldValue);
                console.log(`   📅 Активация: ${fieldValue} → ${subscriptionInfo.activationDate}`);
            }
            
            // 8. Дата покупки
            else if (fieldId === this.FIELD_IDS.LEAD.PURCHASE_DATE) {
                subscriptionInfo.purchaseDate = this.parseDate(fieldValue);
                console.log(`   📅 Покупка: ${fieldValue} → ${subscriptionInfo.purchaseDate}`);
            }
            
            // 9. Дата последнего визита
            else if (fieldId === this.FIELD_IDS.LEAD.LAST_VISIT_DATE) {
                subscriptionInfo.hasSubscription = true;
                subscriptionInfo.lastVisitDate = this.parseDate(fieldValue);
                console.log(`   📅 Последний визит: ${fieldValue} → ${subscriptionInfo.lastVisitDate}`);
            }
            
            // 10. Тип абонемента
            else if (fieldId === this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE) {
                subscriptionInfo.hasSubscription = true;
                subscriptionInfo.subscriptionType = fieldValue;
                console.log(`   🏷️  Тип абонемента: ${fieldValue}`);
            }
            
            // 11. Принадлежность абонемента
            else if (fieldId === this.FIELD_IDS.LEAD.SUBSCRIPTION_OWNER) {
                subscriptionInfo.subscriptionOwner = fieldValue;
                console.log(`   👤 Принадлежность: ${fieldValue}`);
            }
            
            // 12. Филиал в сделке
            else if (fieldId === this.FIELD_IDS.LEAD.BRANCH) {
                subscriptionInfo.branch = fieldValue;
                console.log(`   📍 Филиал (сделка): ${fieldValue}`);
            }
            
            // 13. Возрастная группа
            else if (fieldId === this.FIELD_IDS.LEAD.AGE_GROUP) {
                subscriptionInfo.ageGroup = fieldValue;
                console.log(`   👶 Возрастная группа: ${fieldValue}`);
            }
            
            // 14. Заморозка
            else if (fieldId === this.FIELD_IDS.LEAD.FREEZE) {
                console.log(`   ❄️  Заморозка: ${fieldValue}`);
            }
        }
        
        // Проверяем чекбоксы посещений (если нет счетчика)
        if (subscriptionInfo.hasSubscription && subscriptionInfo.usedClasses === 0) {
            let visitedClasses = 0;
            const checkboxFields = [];
            
            // Собираем все ID чекбоксов занятий
            for (let i = 1; i <= 24; i++) {
                const fieldId = this.FIELD_IDS.LEAD[`CLASS_${i}`];
                if (fieldId) checkboxFields.push(fieldId);
            }
            
            // Проверяем каждый чекбокс
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                if (checkboxFields.includes(fieldId)) {
                    const fieldValue = this.getFieldValue(field);
                    if (fieldValue && fieldValue.toLowerCase() === 'да') {
                        visitedClasses++;
                    }
                }
            }
            
            if (visitedClasses > 0) {
                subscriptionInfo.usedClasses = visitedClasses;
                console.log(`ℹ️  Найдено ${visitedClasses} посещений по чекбоксам`);
            }
        }
        
        // ============ ЛОГИКА РАСЧЕТА ============
        if (subscriptionInfo.hasSubscription) {
            console.log(`\n📊 ИСХОДНЫЕ ДАННЫЕ:`);
            console.log(`   • Всего занятий: ${subscriptionInfo.totalClasses}`);
            console.log(`   • Использовано: ${subscriptionInfo.usedClasses}`);
            console.log(`   • Осталось: ${subscriptionInfo.remainingClasses}`);
            console.log(`   • Статус сделки: ${statusId}`);
            
            // Автоматический расчет, если данные неполные
            if (subscriptionInfo.totalClasses > 0) {
                // Сценарий 1: Есть счетчик, но нет остатка
                if (subscriptionInfo.usedClasses > 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                    console.log(`🔢 Рассчитан остаток: ${subscriptionInfo.remainingClasses}`);
                }
                
                // Сценарий 2: Есть остаток, но нет счетчика
                else if (subscriptionInfo.remainingClasses > 0 && subscriptionInfo.usedClasses === 0) {
                    subscriptionInfo.usedClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.remainingClasses);
                    console.log(`🔢 Рассчитано использованных: ${subscriptionInfo.usedClasses}`);
                }
                
                // Сценарий 3: Нет данных о посещениях
                else if (subscriptionInfo.usedClasses === 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = subscriptionInfo.totalClasses;
                    console.log(`ℹ️  Нет данных о посещениях, показываем все доступными`);
                }
                
                // Сценарий 4: Противоречивые данные (корректируем)
                else if (subscriptionInfo.usedClasses + subscriptionInfo.remainingClasses > subscriptionInfo.totalClasses) {
                    console.log(`⚠️  Противоречие: ${subscriptionInfo.usedClasses} + ${subscriptionInfo.remainingClasses} > ${subscriptionInfo.totalClasses}`);
                    subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                    console.log(`🔢 Скорректирован остаток: ${subscriptionInfo.remainingClasses}`);
                }
            }
            
            console.log(`\n📊 РАСЧЕТНЫЕ ДАННЫЕ:`);
            console.log(`   • Всего: ${subscriptionInfo.totalClasses}`);
            console.log(`   • Использовано: ${subscriptionInfo.usedClasses}`);
            console.log(`   • Осталось: ${subscriptionInfo.remainingClasses}`);
            
            // ============ ОПРЕДЕЛЕНИЕ СТАТУСА ============
            const today = new Date();
            const isExpiredByDate = subscriptionInfo.expirationDate ? 
                new Date(subscriptionInfo.expirationDate) < today : false;
            
            const hasRemaining = subscriptionInfo.remainingClasses > 0;
            const hasUsed = subscriptionInfo.usedClasses > 0;
            const isClosedDeal = [142, 143].includes(statusId); // Закрытые сделки
            
            console.log(`\n🎯 ОПРЕДЕЛЕНИЕ СТАТУСА:`);
            console.log(`   • Истек по дате: ${isExpiredByDate ? 'Да' : 'Нет'}`);
            console.log(`   • Есть остаток: ${hasRemaining ? 'Да' : 'Нет'}`);
            console.log(`   • Есть посещения: ${hasUsed ? 'Да' : 'Нет'}`);
            console.log(`   • Сделка закрыта: ${isClosedDeal ? 'Да' : 'Нет'}`);
            
            // Логика определения статуса
            if (isClosedDeal) {
                subscriptionInfo.subscriptionStatus = 'Абонемент завершен';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (isExpiredByDate) {
                subscriptionInfo.subscriptionStatus = 'Абонемент истек';
                subscriptionInfo.subscriptionBadge = 'expired';
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
            else if (subscriptionInfo.totalClasses > 0 && !hasUsed) {
                subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий (не активирован)`;
                subscriptionInfo.subscriptionBadge = 'pending';
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
            console.log(`   • Активен: ${subscriptionInfo.subscriptionActive ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Бейдж: ${subscriptionInfo.subscriptionBadge}`);
            console.log(`   • Тип: ${subscriptionInfo.subscriptionType}`);
            console.log(`   • Филиал: ${subscriptionInfo.branch || 'не указан'}`);
        }
        
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

    // 🔧 ОБНОВЛЕННЫЙ МЕТОД: getStudentsByPhone
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
            
            for (const contact of contacts) {
                console.log(`\n👤 Анализ контакта: ${contact.name} (ID: ${contact.id})`);
                
                // 2. Получаем полную информацию о контакте
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                // 3. Извлекаем информацию о детях
                const children = this.extractStudentsFromContact(fullContact);
                console.log(`📊 Найдено детей в контакте: ${children.length}`);
                
                // 4. Если нет детей, создаем одного из основной информации
                if (children.length === 0) {
                    console.log('⚠️  Дети не найдены, создаем основную запись...');
                    const mainStudent = this.extractStudentInfoFromContact(fullContact);
                    if (mainStudent.studentName && mainStudent.studentName.trim() !== '') {
                        children.push(mainStudent);
                    }
                }
                
                // 5. Получаем все сделки контакта
                console.log('🔍 Поиск сделок контакта...');
                const leads = await this.getContactLeads(contact.id);
                console.log(`📊 Найдено сделок: ${leads.length}`);
                
                // 6. Ищем сделки с абонементами
                const subscriptionLeads = [];
                for (const lead of leads) {
                    const hasSubscriptionFields = lead.custom_fields_values?.some(f => {
                        const fieldId = f.field_id || f.id;
                        return [
                            this.FIELD_IDS.LEAD.TOTAL_CLASSES,
                            this.FIELD_IDS.LEAD.USED_CLASSES,
                            this.FIELD_IDS.LEAD.REMAINING_CLASSES
                        ].includes(fieldId);
                    });
                    
                    if (hasSubscriptionFields) {
                        subscriptionLeads.push(lead);
                    }
                }
                
                console.log(`🎯 Сделок с абонементами: ${subscriptionLeads.length}`);
                
                // 7. Сортируем сделки по дате (новые сначала)
                subscriptionLeads.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                
                // 8. Для каждого ребенка создаем профиль
                for (const child of children) {
                    console.log(`\n👤 Создание профиля для: ${child.studentName}`);
                    
                    // Ищем подходящую сделку для этого ребенка
                    let bestLead = null;
                    let bestSubscriptionInfo = null;
                    
                    // Проверяем все сделки с абонементами
                    for (const lead of subscriptionLeads) {
                        const subscriptionInfo = this.extractSubscriptionInfo(lead);
                        
                        // Если в сделке есть активный абонемент
                        if (subscriptionInfo.hasSubscription && subscriptionInfo.subscriptionActive) {
                            // Проверяем имя ученика в сделке
                            const leadStudentInfo = this.extractStudentInfoFromLead(lead);
                            
                            // Если имена совпадают или сделка самая новая
                            if ((leadStudentInfo.studentName && 
                                 leadStudentInfo.studentName.includes(child.studentName.split(' ')[0])) ||
                                !bestLead) {
                                
                                bestLead = lead;
                                bestSubscriptionInfo = subscriptionInfo;
                                break; // Берем первую подходящую
                            }
                        }
                    }
                    
                    // Если не нашли активный абонемент, берем последнюю сделку
                    if (!bestLead && subscriptionLeads.length > 0) {
                        bestLead = subscriptionLeads[0];
                        bestSubscriptionInfo = this.extractSubscriptionInfo(bestLead);
                    }
                    
                    // 9. Создаем профиль ученика
                    const studentProfile = this.createStudentProfile(
                        fullContact,
                        phoneNumber,
                        child,
                        bestSubscriptionInfo || this.extractSubscriptionInfo(null),
                        bestLead
                    );
                    
                    // 10. Если в контакте указано, что есть активный абонемент
                    if (child.hasActiveSubscription && 
                        (!bestSubscriptionInfo || !bestSubscriptionInfo.subscriptionActive)) {
                        console.log('⚠️  В контакте указан активный абонемент, но не найден в сделках');
                        studentProfile.subscription_active = 1;
                        studentProfile.subscription_status = 'Активный абонемент';
                        studentProfile.subscription_badge = 'active';
                    }
                    
                    // 11. Добавляем профиль
                    studentProfiles.push(studentProfile);
                    console.log(`✅ Профиль создан: ${child.studentName}`);
                }
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${studentProfiles.length}`);
            
        } catch (crmError) {
            console.error(`❌ Ошибка получения данных из amoCRM:`, crmError.message);
            return [];
        }
        
        return studentProfiles;
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

    async getContactLeads(contactId) {
        try {
            console.log(`🔍 Запрос сделок для контакта ID: ${contactId}`);
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}`
            );
            
            return response._embedded?.leads || [];
        } catch (error) {
            console.error(`⚠️  Ошибка получения сделок контакта ${contactId}:`, error.message);
            return [];
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

    async findActiveSubscriptions(contactId) {
        console.log(`\n🔍 ПОИСК АКТИВНЫХ АБОНЕМЕНТОВ ДЛЯ КОНТАКТА ID: ${contactId}`);
        
        try {
            // Получаем ВСЕ сделки контакта
            const leadsResponse = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&limit=250`
            );
            
            const allLeads = leadsResponse._embedded?.leads || [];
            console.log(`📊 Всего сделок у контакта: ${allLeads.length}`);
            
            const activeSubscriptions = [];
            
            // Проверяем каждую сделку
            for (const lead of allLeads) {
                // Ключевые поля, которые должны быть заполнены для активного абонемента
                const hasTotalClasses = lead.custom_fields_values?.some(f => 
                    (f.field_id === this.FIELD_IDS.LEAD.TOTAL_CLASSES || f.id === this.FIELD_IDS.LEAD.TOTAL_CLASSES) && 
                    f.values && f.values.length > 0 && 
                    this.getFieldValue(f) && this.getFieldValue(f).trim() !== ''
                );
                
                const hasCounter = lead.custom_fields_values?.some(f => 
                    (f.field_id === this.FIELD_IDS.LEAD.USED_CLASSES || f.id === this.FIELD_IDS.LEAD.USED_CLASSES) && 
                    f.values && f.values.length > 0 && 
                    this.getFieldValue(f) && this.getFieldValue(f).trim() !== ''
                );
                
                const hasRemaining = lead.custom_fields_values?.some(f => 
                    (f.field_id === this.FIELD_IDS.LEAD.REMAINING_CLASSES || f.id === this.FIELD_IDS.LEAD.REMAINING_CLASSES) && 
                    f.values && f.values.length > 0 && 
                    this.getFieldValue(f) && this.getFieldValue(f).trim() !== ''
                );
                
                // Если есть хотя бы одно ключевое поле, анализируем дальше
                if (hasTotalClasses || hasCounter || hasRemaining) {
                    console.log(`\n📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
                    console.log(`   Статус: ${lead.status_id}, Есть поля: total=${hasTotalClasses}, counter=${hasCounter}, remaining=${hasRemaining}`);
                    
                    // Извлекаем данные об абонементе
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    
                    // Показываем все заполненные поля
                    if (lead.custom_fields_values) {
                        lead.custom_fields_values.forEach(field => {
                            const fieldId = field.field_id || field.id;
                            const fieldName = this.getFieldName(field);
                            const fieldValue = this.getFieldValue(field);
                            
                            if (fieldValue && fieldValue.trim() !== '') {
                                console.log(`   • ${fieldName}: ${fieldValue}`);
                            }
                        });
                    }
                    
                    // Если абонемент активен, добавляем в список
                    if (subscriptionInfo.hasSubscription && subscriptionInfo.subscriptionActive) {
                        activeSubscriptions.push({
                            lead_id: lead.id,
                            lead_name: lead.name,
                            status_id: lead.status_id,
                            subscription: subscriptionInfo
                        });
                        
                        console.log(`   🎯 АКТИВНЫЙ АБОНЕМЕНТ НАЙДЕН!`);
                        console.log(`      ${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий осталось`);
                    }
                }
            }
            
            console.log(`\n🎯 Найдено активных абонементов: ${activeSubscriptions.length}`);
            
            // Сортируем по дате создания (новые сначала)
            activeSubscriptions.sort((a, b) => {
                const leadA = allLeads.find(l => l.id === a.lead_id);
                const leadB = allLeads.find(l => l.id === b.lead_id);
                return new Date(leadB.created_at) - new Date(leadA.created_at);
            });
            
            return activeSubscriptions;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска активных абонементов: ${error.message}`);
            return [];
        }
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
