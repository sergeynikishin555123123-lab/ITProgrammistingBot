// server.js - ПОЛНОСТЬЮ ПЕРЕРАБОТАННАЯ ВЕРСИЯ
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
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.fieldMappings = new Map();
        this.customFieldCache = new Map();
        this.accountInfo = null;
        
        // ВАШИ ID ПОЛЕЙ (обновленные по карточке 29719948)
        this.FIELD_IDS = {
            // Сделки (абонементы) - ОСНОВНЫЕ ПОЛЯ
            LEAD: {
                // Ключевые поля абонемента
                TOTAL_CLASSES: 850241,        // "Абонемент занятий:" (select) - ГЛАВНОЕ ПОЛЕ!
                USED_CLASSES: 850257,         // "Счетчик занятий:" (numeric/select?)
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
                
                // Технические поля
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
                
                // Дополнительные поля
                STATUS_ID: 'status_id',        // Статус сделки
                NAME: 'name',                  // Название сделки
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
                EMAIL: 216617,               // "Email" (стандартное поле)
                PHONE: 'phone'               // Телефон
            }
        };
        
        // Кэш enum значений для быстрого доступа
        this.enumCache = new Map();
        
        // Маппинг enum_id для поля "Абонемент занятий:"
        this.SUBSCRIPTION_ENUM_MAPPING = {
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
    }

    // ==================== ОСНОВНЫЕ МЕТОДЫ ====================
    
    async initialize() {
        try {
            if (!this.accessToken) {
                console.log('❌ Отсутствует токен доступа amoCRM');
                return false;
            }
            
            if (!AMOCRM_SUBDOMAIN) {
                console.log('❌ Не указан домен amoCRM');
                return false;
            }
            
            console.log(`🔗 Проверка подключения к amoCRM...`);
            console.log(`   Домен: ${this.baseUrl}`);
            console.log(`   Токен: ${this.accessToken ? '✓ Присутствует' : '✗ Отсутствует'}`);
            
            // Проверяем подключение
            try {
                const response = await this.makeRequest('GET', '/api/v4/account');
                this.accountInfo = response;
                this.isInitialized = true;
                
                // Загружаем информацию о полях
                await this.loadCustomFields();
                
                console.log('✅ amoCRM успешно инициализирован');
                console.log(`🏢 Аккаунт: ${response.name}`);
                console.log(`👤 ID пользователя: ${response.current_user?.id || 'неизвестно'}`);
                console.log(`🔗 Домен: ${this.baseUrl}`);
                console.log(`📊 Загружено полей: ${this.fieldMappings.size}`);
                
                return true;
            } catch (apiError) {
                console.error('❌ Ошибка API amoCRM:', apiError.message);
                console.error('   Проверьте токен и домен!');
                this.isInitialized = false;
                return false;
            }
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            this.isInitialized = false;
            return false;
        }
    }

    async loadCustomFields() {
        try {
            console.log('📊 Загрузка кастомных полей...');
            
            // Загружаем поля для сделок
            const leadFields = await this.makeRequest('GET', '/api/v4/leads/custom_fields');
            for (const field of leadFields) {
                this.fieldMappings.set(field.id, {
                    id: field.id,
                    name: field.name,
                    type: field.type,
                    entity_type: 'lead',
                    enums: field.enums || []
                });
                
                // Кэшируем enum значения
                if (field.enums && field.enums.length > 0) {
                    this.enumCache.set(field.id, field.enums);
                }
            }
            
            // Загружаем поля для контактов
            const contactFields = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            for (const field of contactFields) {
                this.fieldMappings.set(field.id, {
                    id: field.id,
                    name: field.name,
                    type: field.type,
                    entity_type: 'contact',
                    enums: field.enums || []
                });
                
                // Кэшируем enum значения
                if (field.enums && field.enums.length > 0) {
                    this.enumCache.set(field.id, field.enums);
                }
            }
            
            console.log(`✅ Загружено полей: ${this.fieldMappings.size}`);
            
        } catch (error) {
            console.error('❌ Ошибка загрузки кастомных полей:', error.message);
        }
    }

    async makeRequest(method, endpoint, data = null, retries = 3) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            method,
            url,
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 30000
        };
        
        if (data) {
            config.data = data;
        }
        
        let lastError;
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                if (attempt > 1) {
                    console.log(`   ↺ Повтор ${attempt}/${retries}...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
                
                console.log(`📤 ${method} ${endpoint}${data ? ' (with data)' : ''}`);
                const response = await axios(config);
                
                if (response.status === 204) {
                    return { success: true };
                }
                
                return response.data;
                
            } catch (error) {
                lastError = error;
                
                if (error.response) {
                    const status = error.response.status;
                    
                    if (status === 401) {
                        console.error('❌ Ошибка авторизации amoCRM (неверный токен)');
                        throw error;
                    }
                    
                    if (status === 404) {
                        console.error(`❌ Ресурс не найден: ${endpoint}`);
                        break;
                    }
                    
                    if (status === 429) {
                        console.log('⚠️  Превышен лимит запросов, ждем...');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        continue;
                    }
                    
                    console.error(`❌ Ошибка ${status}:`, error.response.data);
                    
                    if (error.response.data && error.response.data.title) {
                        console.error(`   Сообщение: ${error.response.data.title}`);
                    }
                    
                    if (status >= 500) {
                        // Серверная ошибка, пробуем снова
                        continue;
                    } else {
                        // Клиентская ошибка, не повторяем
                        break;
                    }
                } else if (error.request) {
                    console.error('❌ Нет ответа от amoCRM (таймаут)');
                    continue;
                } else {
                    console.error('❌ Ошибка настройки запроса:', error.message);
                    break;
                }
            }
        }
        
        throw lastError || new Error(`Не удалось выполнить запрос после ${retries} попыток`);
    }

    // ==================== УЛУЧШЕННЫЕ ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ====================
    
    getFieldName(fieldId) {
        const fieldInfo = this.fieldMappings.get(fieldId);
        return fieldInfo ? fieldInfo.name : `Поле ${fieldId}`;
    }

    getFieldValue(field) {
        try {
            if (!field || !field.values || field.values.length === 0) {
                return null;
            }
            
            const value = field.values[0];
            
            // ПРИОРИТЕТ 1: enum_id (для select полей)
            if (value.enum_id !== undefined) {
                return String(value.enum_id);
            }
            // ПРИОРИТЕТ 2: enum_code
            else if (value.enum_code !== undefined) {
                return String(value.enum_code);
            }
            // ПРИОРИТЕТ 3: обычное значение
            else if (value.value !== undefined) {
                return String(value.value);
            }
            // ПРИОРИТЕТ 4: другие форматы
            else if (value.subtype !== undefined) {
                return String(value.subtype);
            }
            
            return null;
        } catch (error) {
            console.error('❌ Ошибка получения значения поля:', error);
            return null;
        }
    }

    getFieldDisplayValue(fieldId, value) {
        try {
            if (!value) return '';
            
            // Для поля "Абонемент занятий:" используем наш маппинг
            if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES) {
                const num = this.SUBSCRIPTION_ENUM_MAPPING[String(value)];
                return num ? `${num} занятий` : value;
            }
            
            // Для других полей с enum
            const enums = this.enumCache.get(fieldId);
            if (enums && Array.isArray(enums)) {
                const enumItem = enums.find(e => String(e.id) === String(value));
                if (enumItem) {
                    return enumItem.value;
                }
            }
            
            return String(value);
        } catch (error) {
            console.error('❌ Ошибка получения отображаемого значения:', error);
            return String(value);
        }
    }

    parseDate(value) {
        if (!value) return null;
        
        try {
            const dateStr = String(value).trim();
            
            // Убираем лишние символы
            const cleanStr = dateStr.replace(/[^\d\.\-T:+]/g, '');
            
            // Если это timestamp в секундах
            if (/^\d{9,10}$/.test(cleanStr)) {
                const timestamp = parseInt(cleanStr);
                if (timestamp > 1000000000 && timestamp < 2000000000) {
                    const date = new Date(timestamp * 1000);
                    return date.toISOString().split('T')[0];
                }
            }
            
            // Формат DD.MM.YYYY
            if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(cleanStr)) {
                const [day, month, year] = cleanStr.split('.');
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
            
            // Формат YYYY-MM-DD
            if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(cleanStr)) {
                const [year, month, day] = cleanStr.split('-');
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
            
            // ISO формат
            if (cleanStr.includes('T')) {
                const date = new Date(cleanStr);
                if (!isNaN(date.getTime())) {
                    return date.toISOString().split('T')[0];
                }
            }
            
            // Пробуем распарсить как дату
            const parsedDate = new Date(cleanStr);
            if (!isNaN(parsedDate.getTime())) {
                return parsedDate.toISOString().split('T')[0];
            }
            
            return cleanStr;
            
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error, 'Значение:', value);
            return value;
        }
    }

    parseNumeric(value) {
        if (!value) return 0;
        
        try {
            const str = String(value).trim();
            
            // Пробуем извлечь число из строки
            const numMatch = str.match(/\d+/);
            if (numMatch) {
                return parseInt(numMatch[0], 10);
            }
            
            // Проверяем enum_id для поля "Счетчик занятий:"
            if (this.SUBSCRIPTION_ENUM_MAPPING[str]) {
                return this.SUBSCRIPTION_ENUM_MAPPING[str];
            }
            
            // Текстовые значения
            const textNumbers = {
                'один': 1, 'одно': 1, 'одна': 1,
                'два': 2, 'двое': 2, 'две': 2,
                'три': 3, 'трое': 3,
                'четыре': 4, 'пять': 5, 'шесть': 6,
                'семь': 7, 'восемь': 8, 'девять': 9,
                'десять': 10, 'одиннадцать': 11, 'двенадцать': 12,
                'тринадцать': 13, 'четырнадцать': 14, 'пятнадцать': 15,
                'шестнадцать': 16
            };
            
            const lowerStr = str.toLowerCase();
            for (const [text, num] of Object.entries(textNumbers)) {
                if (lowerStr.includes(text)) {
                    return num;
                }
            }
            
            return 0;
        } catch (error) {
            console.error('❌ Ошибка парсинга числа:', error);
            return 0;
        }
    }

    // ==================== ОСНОВНАЯ ЛОГИКА АБОНЕМЕНТОВ ====================
    
    extractSubscriptionInfo(lead) {
        console.log(`\n🔍 АНАЛИЗ АБОНЕМЕНТА В СДЕЛКЕ ${lead?.id || 'null'}`);
        
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
            freezeStatus: '',
            leadName: lead?.name || '',
            leadStatus: lead?.status_id || 0,
            leadIsClosed: false
        };
        
        if (!lead || !lead.custom_fields_values) {
            console.log('⚠️  Нет данных сделки или кастомных полей');
            return subscriptionInfo;
        }
        
        try {
            const customFields = lead.custom_fields_values;
            const leadName = lead.name || 'Без названия';
            const statusId = lead.status_id || 0;
            subscriptionInfo.leadIsClosed = [142, 143].includes(statusId);
            
            console.log(`   Сделка: "${leadName}" (ID: ${lead.id}, Статус: ${statusId})`);
            console.log(`   Закрыта: ${subscriptionInfo.leadIsClosed ? 'Да' : 'Нет'}`);
            
            // ПРОХОДИМ ПО ВСЕМ ПОЛЯМ СДЕЛКИ
            console.log(`\n📊 АНАЛИЗ ПОЛЕЙ СДЕЛКИ:`);
            
            for (const field of customFields) {
                const fieldId = field.field_id;
                if (!fieldId) continue;
                
                const fieldName = this.getFieldName(fieldId);
                const fieldValue = this.getFieldValue(field);
                const displayValue = this.getFieldDisplayValue(fieldId, fieldValue);
                
                if (fieldValue === null || fieldValue === '') continue;
                
                console.log(`   ${fieldName} (${fieldId}): ${fieldValue} -> "${displayValue}"`);
                
                // ОСНОВНЫЕ ПОЛЯ АБОНЕМЕНТА
                if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    const classes = this.parseNumeric(fieldValue);
                    subscriptionInfo.totalClasses = classes;
                    console.log(`     → Абонемент: ${classes} занятий`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.USED_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    const used = this.parseNumeric(fieldValue);
                    subscriptionInfo.usedClasses = used;
                    console.log(`     → Счетчик занятий: ${used}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.USED_CLASSES_NUM) {
                    subscriptionInfo.hasSubscription = true;
                    const used = this.parseNumeric(fieldValue);
                    // Берем максимальное значение из всех счетчиков
                    subscriptionInfo.usedClasses = Math.max(subscriptionInfo.usedClasses, used);
                    console.log(`     → Кол-во отхоженных: ${used}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.REMAINING_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    const remaining = this.parseNumeric(fieldValue);
                    subscriptionInfo.remainingClasses = remaining;
                    console.log(`     → Остаток занятий: ${remaining}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.TECHNICAL_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    const techClasses = this.parseNumeric(fieldValue);
                    if (techClasses > 0 && subscriptionInfo.totalClasses === 0) {
                        subscriptionInfo.totalClasses = techClasses;
                        console.log(`     → Техническое количество: ${techClasses}`);
                    }
                }
                else if (fieldId === this.FIELD_IDS.LEAD.EXPIRATION_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    const date = this.parseDate(fieldValue);
                    subscriptionInfo.expirationDate = date;
                    console.log(`     → Окончание: ${date}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.ACTIVATION_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    const date = this.parseDate(fieldValue);
                    subscriptionInfo.activationDate = date;
                    console.log(`     → Активация: ${date}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.PURCHASE_DATE) {
                    const date = this.parseDate(fieldValue);
                    subscriptionInfo.purchaseDate = date;
                    console.log(`     → Покупка: ${date}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.LAST_VISIT_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    const date = this.parseDate(fieldValue);
                    subscriptionInfo.lastVisitDate = date;
                    console.log(`     → Последний визит: ${date}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.subscriptionType = displayValue;
                    console.log(`     → Тип абонемента: ${displayValue}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.SUBSCRIPTION_OWNER) {
                    subscriptionInfo.subscriptionOwner = displayValue;
                    console.log(`     → Принадлежность: ${displayValue}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.BRANCH) {
                    subscriptionInfo.branch = displayValue;
                    console.log(`     → Филиал: ${displayValue}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.AGE_GROUP) {
                    subscriptionInfo.ageGroup = displayValue;
                    console.log(`     → Возрастная группа: ${displayValue}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.FREEZE) {
                    subscriptionInfo.freezeStatus = displayValue;
                    console.log(`     → Заморозка: ${displayValue}`);
                }
            }
            
            // ДОПОЛНИТЕЛЬНЫЙ АНАЛИЗ ЧЕКБОКСОВ
            if (subscriptionInfo.hasSubscription && subscriptionInfo.usedClasses === 0) {
                let visitedClasses = 0;
                
                for (let i = 1; i <= 24; i++) {
                    const checkboxId = this.FIELD_IDS.LEAD[`CLASS_${i}`];
                    if (checkboxId) {
                        const checkboxField = customFields.find(f => f.field_id === checkboxId);
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
                    console.log(`   📊 Найдено посещений по чекбоксам: ${visitedClasses}`);
                }
            }
            
            // КОРРЕКТИРОВКА ДАННЫХ
            console.log(`\n🔄 КОРРЕКТИРОВКА ДАННЫХ:`);
            
            // Если есть общее количество, но нет данных о посещениях
            if (subscriptionInfo.totalClasses > 0) {
                // 1. Если есть счетчик, но нет остатка
                if (subscriptionInfo.usedClasses > 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                    console.log(`   Рассчитан остаток: ${subscriptionInfo.remainingClasses}`);
                }
                
                // 2. Если есть остаток, но нет счетчика
                if (subscriptionInfo.remainingClasses > 0 && subscriptionInfo.usedClasses === 0) {
                    subscriptionInfo.usedClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.remainingClasses);
                    console.log(`   Рассчитано использованных: ${subscriptionInfo.usedClasses}`);
                }
                
                // 3. Если нет данных о посещениях вообще
                if (subscriptionInfo.usedClasses === 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = subscriptionInfo.totalClasses;
                    console.log(`   Нет данных о посещениях, показываем все доступными: ${subscriptionInfo.remainingClasses}`);
                }
            }
            
            // СВОДКА ДАННЫХ
            console.log(`\n📊 СВОДКА ДАННЫХ:`);
            console.log(`   Всего занятий: ${subscriptionInfo.totalClasses}`);
            console.log(`   Использовано: ${subscriptionInfo.usedClasses}`);
            console.log(`   Осталось: ${subscriptionInfo.remainingClasses}`);
            console.log(`   Активация: ${subscriptionInfo.activationDate}`);
            console.log(`   Окончание: ${subscriptionInfo.expirationDate}`);
            console.log(`   Заморозка: ${subscriptionInfo.freezeStatus}`);
            
            // ОПРЕДЕЛЕНИЕ СТАТУСА
            console.log(`\n🎯 ОПРЕДЕЛЕНИЕ СТАТУСА:`);
            
            const today = new Date();
            const now = today.getTime();
            
            // Проверки
            const hasFutureActivation = subscriptionInfo.activationDate ? 
                new Date(subscriptionInfo.activationDate).getTime() > now : false;
            
            const isExpiredByDate = subscriptionInfo.expirationDate ? 
                new Date(subscriptionInfo.expirationDate).getTime() < now : false;
            
            const hasRemaining = subscriptionInfo.remainingClasses > 0;
            const hasUsed = subscriptionInfo.usedClasses > 0;
            const isFrozen = subscriptionInfo.freezeStatus && 
                           subscriptionInfo.freezeStatus.toLowerCase() === 'да';
            
            console.log(`   • Активация в будущем: ${hasFutureActivation}`);
            console.log(`   • Истек по дате: ${isExpiredByDate}`);
            console.log(`   • Есть остаток: ${hasRemaining}`);
            console.log(`   • Есть посещения: ${hasUsed}`);
            console.log(`   • Заморожен: ${isFrozen}`);
            console.log(`   • Сделка закрыта: ${subscriptionInfo.leadIsClosed}`);
            
            // ЛОГИКА ОПРЕДЕЛЕНИЯ СТАТУСА
            if (isFrozen) {
                subscriptionInfo.subscriptionStatus = 'Абонемент заморожен';
                subscriptionInfo.subscriptionBadge = 'freeze';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (isExpiredByDate) {
                subscriptionInfo.subscriptionStatus = 'Абонемент истек';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (hasFutureActivation) {
                subscriptionInfo.subscriptionStatus = 'Ожидает активации';
                subscriptionInfo.subscriptionBadge = 'pending';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (subscriptionInfo.leadIsClosed) {
                subscriptionInfo.subscriptionStatus = 'Абонемент завершен';
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
            else if (subscriptionInfo.totalClasses > 0 && !hasUsed && !subscriptionInfo.leadIsClosed) {
                subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий (не начат)`;
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
            console.log(`   Статус: ${subscriptionInfo.subscriptionStatus}`);
            console.log(`   Активен: ${subscriptionInfo.subscriptionActive}`);
            console.log(`   Бейдж: ${subscriptionInfo.subscriptionBadge}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации об абонементе:', error);
            console.error(error.stack);
        }
        
        return subscriptionInfo;
    }

    async getContactLeads(contactId) {
        try {
            console.log(`\n🔍 ПОЛУЧЕНИЕ СДЕЛОК КОНТАКТА ${contactId}`);
            
            let allLeads = [];
            
            // МЕТОД 1: через filter[contact_id] (основной)
            try {
                const response = await this.makeRequest(
                    'GET',
                    `/api/v4/leads?with=custom_fields_values&limit=250&filter[contact_id]=${contactId}`
                );
                
                const leads = response._embedded?.leads || [];
                console.log(`   Метод 1: найдено ${leads.length} сделок`);
                allLeads = leads;
                
            } catch (error) {
                console.log(`   Метод 1 не сработал: ${error.message}`);
            }
            
            // МЕТОД 2: через /contacts/{id}/leads
            if (allLeads.length < 5) {
                try {
                    const altResponse = await this.makeRequest(
                        'GET',
                        `/api/v4/contacts/${contactId}/leads?with=custom_fields_values&limit=250`
                    );
                    
                    const altLeads = altResponse._embedded?.leads || [];
                    console.log(`   Метод 2: найдено ${altLeads.length} сделок`);
                    
                    // Объединяем, убирая дубликаты
                    const existingIds = new Set(allLeads.map(l => l.id));
                    for (const lead of altLeads) {
                        if (!existingIds.has(lead.id)) {
                            allLeads.push(lead);
                        }
                    }
                    
                } catch (error) {
                    console.log(`   Метод 2 не сработал: ${error.message}`);
                }
            }
            
            console.log(`📊 Всего уникальных сделок: ${allLeads.length}`);
            
            // Сортируем по дате обновления (новые сначала)
            allLeads.sort((a, b) => {
                return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
            });
            
            return allLeads;
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок контакта ${contactId}:`, error.message);
            return [];
        }
    }

    async searchContactsByPhone(phoneNumber) {
        try {
            console.log(`\n🔍 ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
            
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            
            // Ищем по номеру телефона
            let contacts = [];
            
            // Поиск через query (ищет по всем полям)
            try {
                const queryResponse = await this.makeRequest(
                    'GET',
                    `/api/v4/contacts?query=${encodeURIComponent(cleanPhone.slice(-7))}&with=custom_fields_values&limit=50`
                );
                
                contacts = queryResponse._embedded?.contacts || [];
                console.log(`   Поиск по query: ${contacts.length} контактов`);
                
            } catch (error) {
                console.log(`   Поиск по query не сработал: ${error.message}`);
            }
            
            // Фильтруем контакты, у которых действительно есть этот телефон
            if (contacts.length > 0) {
                const filteredContacts = [];
                
                for (const contact of contacts) {
                    const hasPhone = this.checkContactHasPhone(contact, cleanPhone);
                    if (hasPhone) {
                        filteredContacts.push(contact);
                    }
                }
                
                console.log(`   После фильтрации по телефону: ${filteredContacts.length} контактов`);
                return filteredContacts;
            }
            
            return contacts;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return [];
        }
    }

    checkContactHasPhone(contact, phoneDigits) {
        try {
            if (!contact.custom_fields_values) return false;
            
            for (const field of contact.custom_fields_values) {
                if (field.field_code === 'PHONE' || field.field_name?.toLowerCase().includes('телефон')) {
                    for (const value of field.values) {
                        const contactPhone = String(value.value || '').replace(/\D/g, '');
                        if (contactPhone.includes(phoneDigits.slice(-7))) {
                            return true;
                        }
                    }
                }
            }
            
            return false;
        } catch (error) {
            console.error('❌ Ошибка проверки телефона:', error);
            return false;
        }
    }

    async getFullContactInfo(contactId) {
        try {
            console.log(`🔍 Получение полной информации контакта ${contactId}`);
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/contacts/${contactId}?with=custom_fields_values,leads`
            );
            
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения контакта ${contactId}:`, error.message);
            return null;
        }
    }

    extractStudentsFromContact(contact) {
        const students = [];
        
        try {
            console.log(`\n👤 ПОИСК ДЕТЕЙ В КОНТАКТЕ: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
            
            if (!contact.custom_fields_values) {
                console.log('⚠️  У контакта нет кастомных полей');
                return students;
            }
            
            const customFields = contact.custom_fields_values;
            
            // Находим поля с именами детей
            const childrenData = [
                { nameFieldId: this.FIELD_IDS.CONTACT.CHILD_1_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_1_BIRTHDAY },
                { nameFieldId: this.FIELD_IDS.CONTACT.CHILD_2_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_2_BIRTHDAY },
                { nameFieldId: this.FIELD_IDS.CONTACT.CHILD_3_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_3_BIRTHDAY }
            ];
            
            for (let i = 0; i < childrenData.length; i++) {
                const childConfig = childrenData[i];
                const childNumber = i + 1;
                
                // Ищем имя ребенка
                const nameField = customFields.find(f => f.field_id === childConfig.nameFieldId);
                if (!nameField) {
                    console.log(`   Ребенок ${childNumber}: поле имени не найдено`);
                    continue;
                }
                
                const childName = this.getFieldValue(nameField);
                if (!childName || childName.trim() === '') {
                    console.log(`   Ребенок ${childNumber}: имя пустое`);
                    continue;
                }
                
                const displayName = this.getFieldDisplayValue(childConfig.nameFieldId, childName);
                console.log(`   👶 Ребенок ${childNumber}: ${displayName}`);
                
                // Создаем объект с информацией о ребенке
                const studentInfo = {
                    studentName: displayName,
                    birthDate: '',
                    branch: '',
                    parentName: contact.name || '',
                    teacherName: '',
                    dayOfWeek: '',
                    timeSlot: '',
                    ageGroup: '',
                    allergies: '',
                    hasActiveSubscription: false,
                    lastVisitDate: ''
                };
                
                // Ищем день рождения
                const birthdayField = customFields.find(f => f.field_id === childConfig.birthdayFieldId);
                if (birthdayField) {
                    const birthdayValue = this.getFieldValue(birthdayField);
                    if (birthdayValue) {
                        studentInfo.birthDate = this.parseDate(birthdayValue);
                        console.log(`     День рождения: ${studentInfo.birthDate}`);
                    }
                }
                
                // Ищем другие поля (общие для всех детей в контакте)
                for (const field of customFields) {
                    const fieldId = field.field_id;
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue) continue;
                    
                    const displayValue = this.getFieldDisplayValue(fieldId, fieldValue);
                    
                    if (fieldId === this.FIELD_IDS.CONTACT.BRANCH) {
                        studentInfo.branch = displayValue;
                        console.log(`     Филиал: ${displayValue}`);
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.TEACHER) {
                        studentInfo.teacherName = displayValue;
                        console.log(`     Преподаватель: ${displayValue}`);
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.DAY_OF_WEEK) {
                        studentInfo.dayOfWeek = displayValue;
                        console.log(`     День недели: ${displayValue}`);
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.AGE_GROUP) {
                        studentInfo.ageGroup = displayValue;
                        console.log(`     Возрастная группа: ${displayValue}`);
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) {
                        studentInfo.hasActiveSubscription = displayValue.toLowerCase() === 'да';
                        console.log(`     Активный абонемент: ${studentInfo.hasActiveSubscription ? 'Да' : 'Нет'}`);
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.LAST_VISIT) {
                        studentInfo.lastVisitDate = this.parseDate(fieldValue);
                        console.log(`     Последний визит: ${studentInfo.lastVisitDate}`);
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.ALLERGIES) {
                        studentInfo.allergies = displayValue;
                        console.log(`     Аллергии: ${displayValue}`);
                    }
                }
                
                students.push(studentInfo);
            }
            
            console.log(`📊 Найдено детей: ${students.length}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения учеников из контакта:', error);
            console.error(error.stack);
        }
        
        return students;
    }

    async findLatestActiveSubscription(contactId) {
        console.log(`\n🎯 ПОИСК САМОГО СВЕЖЕГО АКТИВНОГО АБОНЕМЕНТА ДЛЯ КОНТАКТА: ${contactId}`);
        
        try {
            // Получаем все сделки контакта
            const leads = await this.getContactLeads(contactId);
            console.log(`📊 Сделок получено: ${leads.length}`);
            
            if (leads.length === 0) {
                console.log(`❌ Сделки не найдены`);
                return null;
            }
            
            // Анализируем сделки на наличие абонементов
            const subscriptionLeads = [];
            
            for (const lead of leads) {
                console.log(`\n📄 Анализ сделки ${lead.id}: "${lead.name}"`);
                
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription) {
                    console.log(`   ✅ Найден абонемент! Статус: ${subscriptionInfo.subscriptionStatus}`);
                    
                    subscriptionLeads.push({
                        lead: lead,
                        subscription: subscriptionInfo,
                        created_at: lead.created_at,
                        updated_at: lead.updated_at,
                        priority: this.calculateSubscriptionPriority(subscriptionInfo, lead)
                    });
                } else {
                    console.log(`   ❌ Абонемент не найден в сделке`);
                }
            }
            
            console.log(`\n📊 Сделок с абонементами: ${subscriptionLeads.length}`);
            
            if (subscriptionLeads.length === 0) {
                console.log(`❌ Абонементы не найдены`);
                return null;
            }
            
            // Сортируем по приоритету
            subscriptionLeads.sort((a, b) => {
                // Сначала по приоритету (выше = лучше)
                if (b.priority !== a.priority) {
                    return b.priority - a.priority;
                }
                
                // Затем по дате обновления (новые сначала)
                return new Date(b.updated_at) - new Date(a.updated_at);
            });
            
            // Выводим приоритеты
            console.log(`\n🏆 РЕЙТИНГ АБОНЕМЕНТОВ:`);
            subscriptionLeads.forEach((item, index) => {
                console.log(`   ${index + 1}. Сделка ${item.lead.id}: "${item.lead.name}"`);
                console.log(`      Приоритет: ${item.priority}`);
                console.log(`      Статус: ${item.subscription.subscriptionStatus}`);
                console.log(`      Обновлено: ${item.updated_at}`);
                console.log(`   ---`);
            });
            
            const bestSubscription = subscriptionLeads[0];
            
            console.log(`\n🎯 ЛУЧШИЙ АБОНЕМЕНТ:`);
            console.log(`   Сделка: "${bestSubscription.lead.name}" (ID: ${bestSubscription.lead.id})`);
            console.log(`   Статус: ${bestSubscription.subscription.subscriptionStatus}`);
            console.log(`   Активен: ${bestSubscription.subscription.subscriptionActive}`);
            console.log(`   Занятий: ${bestSubscription.subscription.totalClasses} всего`);
            console.log(`   Использовано: ${bestSubscription.subscription.usedClasses}`);
            console.log(`   Осталось: ${bestSubscription.subscription.remainingClasses}`);
            
            return {
                lead: bestSubscription.lead,
                subscription: bestSubscription.subscription
            };
            
        } catch (error) {
            console.error(`❌ Ошибка поиска активного абонемента: ${error.message}`);
            console.error(error.stack);
            return null;
        }
    }

    calculateSubscriptionPriority(subscriptionInfo, lead) {
        let priority = 0;
        
        // БАЗОВЫЙ ПРИОРИТЕТ
        priority += 10;
        
        // АКТИВНЫЕ АБОНЕМЕНТЫ
        if (subscriptionInfo.subscriptionActive) {
            priority += 100;
            console.log(`   +100 за активный статус`);
        }
        
        // ЕСТЬ ОСТАТОК ЗАНЯТИЙ
        if (subscriptionInfo.remainingClasses > 0) {
            priority += 80;
            console.log(`   +80 за остаток занятий: ${subscriptionInfo.remainingClasses}`);
        }
        
        // НЕ ЗАМОРОЖЕН
        if (subscriptionInfo.freezeStatus && subscriptionInfo.freezeStatus.toLowerCase() === 'да') {
            priority -= 200; // Сильное понижение для замороженных
            console.log(`   -200 за заморозку`);
        }
        
        // НЕ ИСТЕК СРОК
        if (subscriptionInfo.expirationDate) {
            const expDate = new Date(subscriptionInfo.expirationDate);
            const now = new Date();
            if (expDate >= now) {
                priority += 60;
                console.log(`   +60 за срок не истек`);
            } else {
                priority -= 50;
                console.log(`   -50 за истекший срок`);
            }
        }
        
        // НЕ ЗАКРЫТАЯ СДЕЛКА
        if (lead.status_id && ![142, 143].includes(lead.status_id)) {
            priority += 40;
            console.log(`   +40 за открытую сделку`);
        } else {
            priority -= 30;
            console.log(`   -30 за закрытую сделку`);
        }
        
        // ЕСТЬ ДАТА АКТИВАЦИИ (не 1970)
        if (subscriptionInfo.activationDate && 
            subscriptionInfo.activationDate !== '1970-01-01' &&
            subscriptionInfo.activationDate !== '1970-01-02') {
            priority += 20;
            console.log(`   +20 за реальную дату активации`);
        }
        
        // ЕСТЬ ПОСЕЩЕНИЯ
        if (subscriptionInfo.usedClasses > 0) {
            priority += 10;
            console.log(`   +10 за посещения: ${subscriptionInfo.usedClasses}`);
        }
        
        console.log(`   Итоговый приоритет: ${priority}`);
        return priority;
    }

    findEmail(contact) {
        try {
            if (!contact.custom_fields_values) return '';
            
            for (const field of contact.custom_fields_values) {
                const fieldName = this.getFieldName(field.field_id).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if ((fieldName.includes('email') || 
                     fieldName.includes('почта') || 
                     fieldName.includes('e-mail') ||
                     field.field_code === 'EMAIL') && 
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
        console.log(`\n📝 СОЗДАНИЕ ПРОФИЛЯ УЧЕНИКА: ${studentInfo.studentName}`);
        
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
            time_slot: studentInfo.timeSlot || '',
            teacher_name: studentInfo.teacherName || '',
            age_group: studentInfo.ageGroup || subscriptionInfo.ageGroup || '',
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
            last_visit_date: subscriptionInfo.lastVisitDate || studentInfo.lastVisitDate || null,
            
            // Технические данные
            custom_fields: JSON.stringify(contact.custom_fields_values || []),
            raw_contact_data: JSON.stringify(contact),
            lead_data: lead ? JSON.stringify(lead) : '{}',
            is_demo: 0,
            source: 'amocrm',
            is_active: 1
        };
        
        console.log(`✅ Профиль создан:`);
        console.log(`   👤 ${profile.student_name}`);
        console.log(`   📍 Филиал: ${profile.branch || 'не указан'}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        console.log(`   📊 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        
        return profile;
    }

    async getStudentsByPhone(phoneNumber) {
        console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        console.log('='.repeat(60));
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            // 1. Ищем контакты по телефону
            console.log('🔍 Поиск контактов...');
            const contacts = await this.searchContactsByPhone(phoneNumber);
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                console.log('📭 Контакты не найдены');
                return studentProfiles;
            }
            
            // 2. Для каждого контакта получаем профили
            for (const contact of contacts) {
                console.log(`\n👤 Анализ контакта: ${contact.name} (ID: ${contact.id})`);
                console.log('─'.repeat(40));
                
                // Получаем полную информацию о контакте
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) {
                    console.log('⚠️  Не удалось получить полную информацию о контакте');
                    continue;
                }
                
                // Извлекаем информацию о детях
                const children = this.extractStudentsFromContact(fullContact);
                console.log(`📊 Найдено детей в контакте: ${children.length}`);
                
                // Если детей нет, создаем профиль из самого контакта
                if (children.length === 0) {
                    console.log('👤 Создаем профиль из контакта...');
                    const studentFromContact = await this.createProfileFromContact(fullContact, phoneNumber);
                    if (studentFromContact) {
                        studentProfiles.push(studentFromContact);
                    }
                } else {
                    // Для каждого ребенка создаем профиль
                    for (const child of children) {
                        console.log(`\n👤 Создание профиля для: ${child.studentName}`);
                        console.log('─'.repeat(30));
                        
                        // Ищем самый свежий активный абонемент
                        const subscriptionData = await this.findLatestActiveSubscription(contact.id);
                        
                        let bestSubscriptionInfo = this.extractSubscriptionInfo(null);
                        let bestLead = null;
                        
                        if (subscriptionData) {
                            bestLead = subscriptionData.lead;
                            bestSubscriptionInfo = subscriptionData.subscription;
                            
                            console.log(`✅ Найден абонемент для ${child.studentName}`);
                            console.log(`   Сделка: "${bestLead.name}" (ID: ${bestLead.id})`);
                            console.log(`   Занятий: ${bestSubscriptionInfo.usedClasses}/${bestSubscriptionInfo.totalClasses} (осталось: ${bestSubscriptionInfo.remainingClasses})`);
                        } else {
                            console.log(`⚠️  Абонемент не найден для ${child.studentName}`);
                        }
                        
                        // Создаем профиль ученика
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
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${studentProfiles.length}`);
            console.log('='.repeat(60));
            
        } catch (crmError) {
            console.error(`❌ Ошибка получения данных из amoCRM:`, crmError.message);
            console.error(crmError.stack);
        }
        
        return studentProfiles;
    }

    async createProfileFromContact(contact, phoneNumber) {
        try {
            console.log(`👤 Создание профиля из контакта: ${contact.name}`);
            
            const studentInfo = {
                studentName: contact.name || 'Ученик',
                birthDate: '',
                branch: '',
                parentName: contact.name || '',
                teacherName: '',
                dayOfWeek: '',
                timeSlot: '',
                ageGroup: '',
                allergies: '',
                hasActiveSubscription: false,
                lastVisitDate: ''
            };
            
            // Извлекаем данные из полей контакта
            if (contact.custom_fields_values) {
                for (const field of contact.custom_fields_values) {
                    const fieldId = field.field_id;
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue) continue;
                    
                    const displayValue = this.getFieldDisplayValue(fieldId, fieldValue);
                    
                    switch(fieldId) {
                        case this.FIELD_IDS.CONTACT.BRANCH:
                            studentInfo.branch = displayValue;
                            break;
                        case this.FIELD_IDS.CONTACT.TEACHER:
                            studentInfo.teacherName = displayValue;
                            break;
                        case this.FIELD_IDS.CONTACT.DAY_OF_WEEK:
                            studentInfo.dayOfWeek = displayValue;
                            break;
                        case this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB:
                            studentInfo.hasActiveSubscription = displayValue.toLowerCase() === 'да';
                            break;
                        case this.FIELD_IDS.CONTACT.LAST_VISIT:
                            studentInfo.lastVisitDate = this.parseDate(fieldValue);
                            break;
                        case this.FIELD_IDS.CONTACT.AGE_GROUP:
                            studentInfo.ageGroup = displayValue;
                            break;
                        case this.FIELD_IDS.CONTACT.ALLERGIES:
                            studentInfo.allergies = displayValue;
                            break;
                    }
                }
            }
            
            // Ищем абонемент для контакта
            const subscriptionData = await this.findLatestActiveSubscription(contact.id);
            
            let subscriptionInfo = this.extractSubscriptionInfo(null);
            let bestLead = null;
            
            if (subscriptionData) {
                bestLead = subscriptionData.lead;
                subscriptionInfo = subscriptionData.subscription;
            }
            
            const profile = this.createStudentProfile(
                contact,
                phoneNumber,
                studentInfo,
                subscriptionInfo,
                bestLead
            );
            
            return profile;
            
        } catch (error) {
            console.error('❌ Ошибка создания профиля из контакта:', error);
            return null;
        }
    }

    // ==================== МЕТОДЫ ДЛЯ ОТЛАДКИ ====================
    
    async debugContact(contactId) {
        try {
            console.log(`\n🔍 ДЕБАГ КОНТАКТА ${contactId}`);
            console.log('='.repeat(50));
            
            const contact = await this.getFullContactInfo(contactId);
            if (!contact) {
                console.log('❌ Контакт не найден');
                return null;
            }
            
            console.log(`👤 Контакт: ${contact.name} (ID: ${contact.id})`);
            console.log(`📅 Создан: ${contact.created_at}`);
            console.log(`📅 Обновлен: ${contact.updated_at}`);
            
            // Выводим все поля
            if (contact.custom_fields_values) {
                console.log(`\n📊 КАСТОМНЫЕ ПОЛЯ (${contact.custom_fields_values.length}):`);
                console.log('─'.repeat(50));
                
                for (const field of contact.custom_fields_values) {
                    const fieldId = field.field_id;
                    const fieldName = this.getFieldName(fieldId);
                    const fieldValue = this.getFieldValue(field);
                    const displayValue = this.getFieldDisplayValue(fieldId, fieldValue);
                    
                    console.log(`${fieldId}: ${fieldName}`);
                    console.log(`  Значение: ${fieldValue}`);
                    console.log(`  Отображение: ${displayValue}`);
                    
                    if (field.values && field.values[0]) {
                        console.log(`  Детали:`, JSON.stringify(field.values[0], null, 2));
                    }
                    console.log('─'.repeat(30));
                }
            }
            
            // Получаем сделки
            const leads = await this.getContactLeads(contactId);
            console.log(`\n📄 СДЕЛКИ КОНТАКТА (${leads.length}):`);
            
            for (const lead of leads.slice(0, 5)) { // Показываем первые 5 сделок
                console.log(`\n🔹 Сделка ${lead.id}: "${lead.name}"`);
                console.log(`   Статус: ${lead.status_id}`);
                console.log(`   Создана: ${lead.created_at}`);
                console.log(`   Обновлена: ${lead.updated_at}`);
                
                // Анализируем абонемент
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription) {
                    console.log(`   ✅ НАЙДЕН АБОНЕМЕНТ:`);
                    console.log(`      Всего занятий: ${subscriptionInfo.totalClasses}`);
                    console.log(`      Использовано: ${subscriptionInfo.usedClasses}`);
                    console.log(`      Осталось: ${subscriptionInfo.remainingClasses}`);
                    console.log(`      Статус: ${subscriptionInfo.subscriptionStatus}`);
                }
            }
            
            return contact;
            
        } catch (error) {
            console.error('❌ Ошибка дебага контакта:', error.message);
            return null;
        }
    }

    async debugLead(leadId) {
        try {
            console.log(`\n🔍 ДЕБАГ СДЕЛКИ ${leadId}`);
            console.log('='.repeat(50));
            
            const lead = await this.getLeadById(leadId);
            if (!lead) {
                console.log('❌ Сделка не найдена');
                return null;
            }
            
            console.log(`📄 Сделка: "${lead.name}" (ID: ${lead.id})`);
            console.log(`📅 Создана: ${lead.created_at}`);
            console.log(`📅 Обновлена: ${lead.updated_at}`);
            console.log(`📊 Статус ID: ${lead.status_id}`);
            
            // Выводим все поля сделки
            if (lead.custom_fields_values) {
                console.log(`\n📊 КАСТОМНЫЕ ПОЛЯ СДЕЛКИ (${lead.custom_fields_values.length}):`);
                console.log('─'.repeat(50));
                
                for (const field of lead.custom_fields_values) {
                    const fieldId = field.field_id;
                    const fieldName = this.getFieldName(fieldId);
                    const fieldValue = this.getFieldValue(field);
                    const displayValue = this.getFieldDisplayValue(fieldId, fieldValue);
                    
                    console.log(`${fieldId}: ${fieldName}`);
                    console.log(`  Значение: ${fieldValue}`);
                    console.log(`  Отображение: ${displayValue}`);
                    
                    // Особый вывод для поля "Абонемент занятий:"
                    if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES) {
                        console.log(`  🔢 Это поле "Абонемент занятий:"`);
                        console.log(`  📊 Enum mapping: ${this.SUBSCRIPTION_ENUM_MAPPING[fieldValue] || 'не найден'}`);
                    }
                    
                    if (field.values && field.values[0]) {
                        console.log(`  Детали:`, JSON.stringify(field.values[0], null, 2));
                    }
                    console.log('─'.repeat(30));
                }
            }
            
            // Анализируем абонемент
            console.log(`\n🎯 АНАЛИЗ АБОНЕМЕНТА:`);
            const subscriptionInfo = this.extractSubscriptionInfo(lead);
            
            console.log(`\n📊 РЕЗУЛЬТАТ АНАЛИЗА:`);
            console.log(`   Найден абонемент: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
            console.log(`   Всего занятий: ${subscriptionInfo.totalClasses}`);
            console.log(`   Использовано: ${subscriptionInfo.usedClasses}`);
            console.log(`   Осталось: ${subscriptionInfo.remainingClasses}`);
            console.log(`   Активация: ${subscriptionInfo.activationDate}`);
            console.log(`   Окончание: ${subscriptionInfo.expirationDate}`);
            console.log(`   Статус: ${subscriptionInfo.subscriptionStatus}`);
            console.log(`   Активен: ${subscriptionInfo.subscriptionActive ? '✅ Да' : '❌ Нет'}`);
            
            return lead;
            
        } catch (error) {
            console.error('❌ Ошибка дебага сделки:', error.message);
            return null;
        }
    }

    async getAllFieldsInfo() {
        try {
            console.log(`\n📊 ПОЛУЧЕНИЕ ВСЕЙ ИНФОРМАЦИИ О ПОЛЯХ`);
            console.log('='.repeat(60));
            
            const result = {
                account: null,
                lead_fields: [],
                contact_fields: [],
                custom_fields_count: 0,
                field_mappings: []
            };
            
            // Получаем информацию об аккаунте
            try {
                result.account = await this.makeRequest('GET', '/api/v4/account');
                console.log(`✅ Информация об аккаунте получена`);
            } catch (error) {
                console.log(`⚠️  Не удалось получить информацию об аккаунте: ${error.message}`);
            }
            
            // Получаем все поля сделок
            try {
                const leadFields = await this.makeRequest('GET', '/api/v4/leads/custom_fields');
                result.lead_fields = leadFields;
                console.log(`✅ Поля сделок получены: ${leadFields.length}`);
                
                // Форматируем для вывода
                for (const field of leadFields) {
                    result.field_mappings.push({
                        id: field.id,
                        name: field.name,
                        type: field.type,
                        entity_type: 'lead',
                        enum_count: field.enums ? field.enums.length : 0,
                        is_in_our_config: Object.values(this.FIELD_IDS.LEAD).includes(field.id)
                    });
                }
            } catch (error) {
                console.log(`⚠️  Не удалось получить поля сделок: ${error.message}`);
            }
            
            // Получаем все поля контактов
            try {
                const contactFields = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
                result.contact_fields = contactFields;
                console.log(`✅ Поля контактов получены: ${contactFields.length}`);
                
                // Форматируем для вывода
                for (const field of contactFields) {
                    result.field_mappings.push({
                        id: field.id,
                        name: field.name,
                        type: field.type,
                        entity_type: 'contact',
                        enum_count: field.enums ? field.enums.length : 0,
                        is_in_our_config: Object.values(this.FIELD_IDS.CONTACT).includes(field.id)
                    });
                }
            } catch (error) {
                console.log(`⚠️  Не удалось получить поля контактов: ${error.message}`);
            }
            
            result.custom_fields_count = result.field_mappings.length;
            
            console.log(`\n📊 ИТОГО:`);
            console.log(`   Всего полей в системе: ${result.custom_fields_count}`);
            console.log(`   Из них в нашей конфигурации: ${result.field_mappings.filter(f => f.is_in_our_config).length}`);
            
            return result;
            
        } catch (error) {
            console.error('❌ Ошибка получения информации о полях:', error.message);
            throw error;
        }
    }

    async getLeadById(leadId) {
        try {
            console.log(`🔍 Получение сделки по ID: ${leadId}`);
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}?with=custom_fields_values,contacts`
            );
            console.log(`✅ Сделка получена: ${response.name}`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения сделки ${leadId}:`, error.message);
            return null;
        }
    }

    createDemoProfile(phoneNumber) {
        console.log('🎭 Создание демо-профиля...');
        
        return {
            amocrm_contact_id: null,
            parent_contact_id: null,
            amocrm_lead_id: null,
            student_name: 'Демо Ученик',
            phone_number: phoneNumber,
            email: 'demo@example.com',
            birth_date: '2015-05-15',
            branch: 'Демо филиал',
            parent_name: 'Демо Родитель',
            day_of_week: 'Среда',
            time_slot: '17:00-18:00',
            teacher_name: 'Демо Преподаватель',
            age_group: '6-8 лет',
            course: 'Рисование',
            allergies: 'Нет',
            subscription_type: 'Демо абонемент на 8 занятий',
            subscription_active: 1,
            subscription_status: 'Активный (осталось 6/8 занятий)',
            subscription_badge: 'active',
            total_classes: 8,
            used_classes: 2,
            remaining_classes: 6,
            expiration_date: '2024-12-31',
            activation_date: '2024-01-15',
            last_visit_date: '2024-10-10',
            custom_fields: '{}',
            raw_contact_data: '{}',
            lead_data: '{}',
            is_demo: 1,
            source: 'demo',
            is_active: 1
        };
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
        await db.run('PRAGMA busy_timeout = 5000');
        
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

        // Создаем индексы
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_name ON student_profiles(student_name)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(is_active)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_branch ON student_profiles(branch)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_contact_id ON student_profiles(amocrm_contact_id)');
        
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
        
        // Создаем индекс для сессий
        await db.run('CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_user_sessions_phone ON user_sessions(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at)');
        
        console.log('\n🎉 Все таблицы созданы успешно!');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

async function saveProfilesToDatabase(profiles) {
    try {
        console.log(`\n💾 СОХРАНЕНИЕ ПРОФИЛЕЙ В БД (${profiles.length} шт.)`);
        console.log('─'.repeat(40));
        
        let savedCount = 0;
        let updatedCount = 0;
        
        for (const profile of profiles) {
            try {
                // Проверяем существование профиля по нескольким критериям
                const existingProfile = await db.get(
                    `SELECT id FROM student_profiles 
                     WHERE student_name = ? 
                       AND phone_number LIKE ? 
                       AND (amocrm_contact_id = ? OR amocrm_contact_id IS NULL)`,
                    [
                        profile.student_name,
                        `%${profile.phone_number.slice(-10)}%`,
                        profile.amocrm_contact_id || null
                    ]
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
                    1  // is_active
                ];
                
                if (!existingProfile) {
                    // Вставка нового профиля
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    const result = await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    
                    savedCount++;
                    console.log(`✅ Сохранен новый профиль: ${profile.student_name} (ID: ${result.lastID})`);
                } else {
                    // Обновление существующего профиля
                    const setClause = columns.map(col => `${col} = ?`).join(', ');
                    
                    await db.run(
                        `UPDATE student_profiles SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [...values, existingProfile.id]
                    );
                    
                    updatedCount++;
                    console.log(`✅ Обновлен профиль: ${profile.student_name} (ID: ${existingProfile.id})`);
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка сохранения профиля ${profile.student_name}:`, profileError.message);
            }
        }
        
        console.log(`\n📊 ИТОГО СОХРАНЕНИЕ:`);
        console.log(`   Новых профилей: ${savedCount}`);
        console.log(`   Обновленных: ${updatedCount}`);
        console.log(`   Всего обработано: ${savedCount + updatedCount}`);
        
        return savedCount + updatedCount;
        
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

// ==================== API МАРШРУТЫ ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '4.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        data_source: amoCrmService.isInitialized ? 'Реальные данные из amoCRM' : 'Локальные данные',
        endpoints: {
            status: '/api/status',
            auth: 'POST /api/auth/phone',
            profiles: 'GET /api/profiles',
            subscription: 'POST /api/subscription',
            debug_fields: 'GET /api/debug/fields',
            debug_lead: 'GET /api/debug/lead/:id',
            debug_contact: 'GET /api/debug/contact/:id',
            test_cycle: 'GET /api/test/full-cycle/:phone'
        }
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
        console.log('='.repeat(50));
        
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
        
        // Если в amoCRM не нашли, ищем в локальной БД
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
        
        // Если ничего не найдено, создаем демо-профиль
        if (profiles.length === 0 && amoCrmService.isInitialized) {
            console.log('🎭 Создание демо-профиля...');
            const demoProfile = amoCrmService.createDemoProfile(formattedPhone);
            profiles = [demoProfile];
            
            // Сохраняем демо-профиль в БД
            await saveProfilesToDatabase([demoProfile]);
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
        
        console.log(`\n✅ АВТОРИЗАЦИЯ ЗАВЕРШЕНА`);
        console.log(`📊 Профилей: ${profiles.length}`);
        console.log(`🎯 Реальные данные: ${hasRealData ? '✅ Да' : '❌ Нет'}`);
        console.log(`👥 Несколько учеников: ${hasMultipleStudents ? '✅ Да' : '❌ Нет'}`);
        console.log('='.repeat(50));
        
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Ошибка авторизации:', error.message);
        console.error(error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки телефона',
            details: error.message
        });
    }
});

// Получение профилей пользователя
app.get('/api/profiles', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Токен не предоставлен'
            });
        }
        
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const phone = decoded.phone;
            
            console.log(`\n📋 ПОЛУЧЕНИЕ ПРОФИЛЕЙ ДЛЯ: ${phone}`);
            
            // Ищем профили в БД
            const cleanPhone = phone.replace(/\D/g, '');
            const profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY 
                   CASE WHEN subscription_active = 1 THEN 1 ELSE 2 END,
                   updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            
            console.log(`📊 Найдено профилей: ${profiles.length}`);
            
            // Форматируем ответ
            const responseProfiles = profiles.map(p => ({
                id: p.id,
                student_name: p.student_name,
                phone_number: p.phone_number,
                email: p.email,
                branch: p.branch,
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
            
            res.json({
                success: true,
                data: {
                    profiles: responseProfiles,
                    total_profiles: profiles.length
                }
            });
            
        } catch (jwtError) {
            console.error('❌ Ошибка проверки токена:', jwtError.message);
            return res.status(401).json({
                success: false,
                error: 'Недействительный токен'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка получения профилей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профилей'
        });
    }
});

// Получение информации об абонементе
app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!profile_id) {
            return res.status(400).json({
                success: false,
                error: 'Укажите ID профиля'
            });
        }
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Токен не предоставлен'
            });
        }
        
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            
            console.log(`\n🎫 ПОЛУЧЕНИЕ ИНФОРМАЦИИ ОБ АБОНЕМЕНТЕ ДЛЯ ПРОФИЛЯ: ${profile_id}`);
            
            // Получаем профиль из БД
            const profile = await db.get(
                'SELECT * FROM student_profiles WHERE id = ? AND is_active = 1',
                [profile_id]
            );
            
            if (!profile) {
                return res.status(404).json({
                    success: false,
                    error: 'Профиль не найден'
                });
            }
            
            // Если профиль из amoCRM, обновляем информацию
            if (profile.source === 'amocrm' && profile.amocrm_lead_id && amoCrmService.isInitialized) {
                console.log(`🔄 Обновление информации об абонементе из amoCRM...`);
                
                try {
                    const lead = await amoCrmService.getLeadById(profile.amocrm_lead_id);
                    if (lead) {
                        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                        
                        // Обновляем профиль в БД
                        await db.run(
                            `UPDATE student_profiles SET 
                             subscription_active = ?,
                             subscription_status = ?,
                             subscription_badge = ?,
                             total_classes = ?,
                             used_classes = ?,
                             remaining_classes = ?,
                             expiration_date = ?,
                             last_visit_date = ?,
                             updated_at = CURRENT_TIMESTAMP
                             WHERE id = ?`,
                            [
                                subscriptionInfo.subscriptionActive ? 1 : 0,
                                subscriptionInfo.subscriptionStatus,
                                subscriptionInfo.subscriptionBadge,
                                subscriptionInfo.totalClasses,
                                subscriptionInfo.usedClasses,
                                subscriptionInfo.remainingClasses,
                                subscriptionInfo.expirationDate,
                                subscriptionInfo.lastVisitDate,
                                profile_id
                            ]
                        );
                        
                        console.log(`✅ Информация об абонементе обновлена`);
                    }
                } catch (crmError) {
                    console.error(`⚠️  Не удалось обновить информацию из amoCRM:`, crmError.message);
                }
            }
            
            // Получаем обновленный профиль
            const updatedProfile = await db.get(
                'SELECT * FROM student_profiles WHERE id = ?',
                [profile_id]
            );
            
            // Форматируем ответ
            const subscriptionData = {
                profile_id: updatedProfile.id,
                student_name: updatedProfile.student_name,
                subscription_type: updatedProfile.subscription_type,
                subscription_active: updatedProfile.subscription_active === 1,
                subscription_status: updatedProfile.subscription_status,
                subscription_badge: updatedProfile.subscription_badge,
                total_classes: updatedProfile.total_classes,
                used_classes: updatedProfile.used_classes,
                remaining_classes: updatedProfile.remaining_classes,
                expiration_date: updatedProfile.expiration_date,
                activation_date: updatedProfile.activation_date,
                last_visit_date: updatedProfile.last_visit_date,
                updated_at: updatedProfile.updated_at
            };
            
            console.log(`✅ Данные абонемента получены`);
            console.log(`   Статус: ${subscriptionData.subscription_status}`);
            console.log(`   Занятий: ${subscriptionData.used_classes}/${subscriptionData.total_classes} (осталось: ${subscriptionData.remaining_classes})`);
            
            res.json({
                success: true,
                data: subscriptionData
            });
            
        } catch (jwtError) {
            console.error('❌ Ошибка проверки токена:', jwtError.message);
            return res.status(401).json({
                success: false,
                error: 'Недействительный токен'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка получения информации об абонементе:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
        });
    }
});

// ==================== ДЕБАГ МАРШРУТЫ ====================

// Получение всей информации о полях в amoCRM
app.get('/api/debug/fields', async (req, res) => {
    try {
        console.log(`\n🔧 ЗАПРОС НА ДЕБАГ ПОЛЕЙ AMOCRM`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(500).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const fieldsInfo = await amoCrmService.getAllFieldsInfo();
        
        // Форматируем ответ для удобного просмотра
        const response = {
            success: true,
            data: {
                account: {
                    name: fieldsInfo.account?.name || 'Неизвестно',
                    id: fieldsInfo.account?.id || 'Неизвестно',
                    current_user: fieldsInfo.account?.current_user || null
                },
                statistics: {
                    total_fields: fieldsInfo.custom_fields_count,
                    lead_fields: fieldsInfo.lead_fields.length,
                    contact_fields: fieldsInfo.contact_fields.length,
                    fields_in_our_config: fieldsInfo.field_mappings.filter(f => f.is_in_our_config).length
                },
                our_field_config: amoCrmService.FIELD_IDS,
                all_fields: fieldsInfo.field_mappings,
                lead_fields: fieldsInfo.lead_fields.slice(0, 50), // Первые 50 полей
                contact_fields: fieldsInfo.contact_fields.slice(0, 50) // Первые 50 полей
            }
        };
        
        console.log(`✅ Информация о полях получена`);
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Ошибка получения информации о полях:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации о полях',
            details: error.message
        });
    }
});

// Дебаг конкретной сделки
app.get('/api/debug/lead/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        
        console.log(`\n🔧 ДЕБАГ СДЕЛКИ ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(500).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const lead = await amoCrmService.debugLead(leadId);
        
        if (!lead) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        res.json({
            success: true,
            data: {
                lead: lead,
                subscription_info: amoCrmService.extractSubscriptionInfo(lead)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка дебага сделки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка дебага сделки',
            details: error.message
        });
    }
});

// Дебаг конкретного контакта
app.get('/api/debug/contact/:id', async (req, res) => {
    try {
        const contactId = req.params.id;
        
        console.log(`\n🔧 ДЕБАГ КОНТАКТА ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(500).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const contact = await amoCrmService.debugContact(contactId);
        
        if (!contact) {
            return res.status(404).json({
                success: false,
                error: 'Контакт не найдена'
            });
        }
        
        res.json({
            success: true,
            data: {
                contact: contact,
                students: amoCrmService.extractStudentsFromContact(contact)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка дебага контакта:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка дебага контакта',
            details: error.message
        });
    }
});

// Полный тестовый цикл для телефона
app.get('/api/test/full-cycle/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n🧪 ПОЛНЫЙ ТЕСТОВЫЙ ЦИКЛ ДЛЯ ТЕЛЕФОНА: ${phone}`);
        console.log('='.repeat(60));
        
        if (!amoCrmService.isInitialized) {
            return res.status(500).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        
        // Шаг 1: Поиск контактов
        console.log('\n1️⃣  ПОИСК КОНТАКТОВ...');
        const contacts = await amoCrmService.searchContactsByPhone(formattedPhone);
        console.log(`✅ Найдено контактов: ${contacts.length}`);
        
        // Шаг 2: Для каждого контакта
        const results = [];
        
        for (const contact of contacts.slice(0, 3)) { // Ограничиваем 3 контактами
            console.log(`\n🔍 АНАЛИЗ КОНТАКТА: ${contact.name} (ID: ${contact.id})`);
            
            const contactResult = {
                contact_id: contact.id,
                contact_name: contact.name,
                students: [],
                leads: []
            };
            
            // Получаем полную информацию
            const fullContact = await amoCrmService.getFullContactInfo(contact.id);
            if (!fullContact) continue;
            
            // Извлекаем учеников
            const students = amoCrmService.extractStudentsFromContact(fullContact);
            contactResult.students = students;
            
            // Получаем сделки
            const leads = await amoCrmService.getContactLeads(contact.id);
            console.log(`   Сделок у контакта: ${leads.length}`);
            
            // Анализируем сделки
            for (const lead of leads.slice(0, 5)) { // Первые 5 сделок
                console.log(`   📄 Сделка ${lead.id}: "${lead.name}"`);
                
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                contactResult.leads.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    status_id: lead.status_id,
                    subscription_info: subscriptionInfo
                });
            }
            
            results.push(contactResult);
        }
        
        // Шаг 3: Получаем профили через основной метод
        console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ ЧЕРЕЗ ОСНОВНОЙ МЕТОД...`);
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        console.log(`\n📊 ИТОГ ТЕСТА:`);
        console.log(`   Контактов найдено: ${contacts.length}`);
        console.log(`   Профилей создано: ${profiles.length}`);
        console.log(`   Результатов анализа: ${results.length}`);
        
        res.json({
            success: true,
            data: {
                test_phone: formattedPhone,
                contacts_found: contacts.length,
                profiles_created: profiles.length,
                analysis_results: results,
                profiles: profiles.slice(0, 10) // Первые 10 профилей
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестового цикла:', error.message);
        console.error(error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Ошибка тестового цикла',
            details: error.message
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(100));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v4.0');
        console.log('='.repeat(100));
        console.log('✨ УЛУЧШЕННЫЙ ПАРСИНГ AMOCRM С ИСПРАВЛЕНИЕМ ВСЕХ ОШИБОК');
        console.log('✨ ДОБАВЛЕНЫ ДЕБАГ МАРШРУТЫ ДЛЯ АНАЛИЗА ДАННЫХ');
        console.log('✨ УЛУЧШЕНА ЛОГИКА ПОИСКА АБОНЕМЕНТОВ И УЧЕНИКОВ');
        console.log('='.repeat(100));
        
        // Инициализация базы данных
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Инициализация amoCRM
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            console.log(`👤 Аккаунт: ${amoCrmService.accountInfo?.name || 'Неизвестно'}`);
        } else {
            console.log('⚠️  amoCRM не инициализирован');
            console.log('ℹ️  Используются локальные/тестовые данные');
        }
        
        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, () => {
            console.log('\n' + '='.repeat(100));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(100));
            console.log(`🌐 Основной URL: http://localhost:${PORT}`);
            console.log(`💾 База данных: SQLite ${db.filename === ':memory:' ? '(в памяти)' : db.filename}`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log('='.repeat(100));
            
            console.log('\n🔗 ОСНОВНЫЕ API МАРШРУТЫ:');
            console.log('='.repeat(50));
            console.log(`📊 Статус: GET http://localhost:${PORT}/api/status`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`📋 Профили: GET http://localhost:${PORT}/api/profiles`);
            console.log(`🎫 Абонемент: POST http://localhost:${PORT}/api/subscription`);
            console.log('');
            console.log('🔧 ДЕБАГ МАРШРУТЫ:');
            console.log('─'.repeat(50));
            console.log(`📊 Все поля amoCRM: GET http://localhost:${PORT}/api/debug/fields`);
            console.log(`📄 Дебаг сделки: GET http://localhost:${PORT}/api/debug/lead/29719948`);
            console.log(`👤 Дебаг контакта: GET http://localhost:${PORT}/api/debug/contact/{id}`);
            console.log(`🧪 Полный тест: GET http://localhost:${PORT}/api/test/full-cycle/79175161115`);
            console.log('='.repeat(50));
            
            console.log('\n💡 ПОДСКАЗКА:');
            console.log('Для отладки проблемы с абонементом проверьте:');
            console.log('1. Правильность ID полей в конфигурации');
            console.log('2. Формат данных в amoCRM (enum_id vs value)');
            console.log('3. Наличие сделок у контакта');
            console.log('4. Статус сделки (142,143 - закрытые)');
            console.log('='.repeat(50));
        });
        
        // Обработка завершения работы
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
        console.error(error.stack);
        process.exit(1);
    }
};

startServer();
