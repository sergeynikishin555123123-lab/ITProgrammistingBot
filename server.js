// server.js - ИСПРАВЛЕННАЯ ВЕРСИЯ С КОРРЕКТНЫМ СИНТАКСИСОМ

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
        
        // Воронка "!Абонемент" - ВСЕ статусы в этой воронке считаются активными!
        this.SUBSCRIPTION_PIPELINE_ID = 7977402; // ID воронки "!Абонемент"
        
        // Статусы в воронке "!Абонемент"
        this.SUBSCRIPTION_STATUSES = {
            // ВСЕ статусы в воронке "!Абонемент" считаются активными
            ACTIVE_IN_PIPELINE: [
                65473306, // "Активный абонемент" (Текущий)
                60025747, // "Активирован" (Исторический)
                65455980, // "Пробный" (возможно есть)
                60025749, // "Истек" (в той же воронке!)
                60025751  // "Заморозка" (в той же воронке!)
            ],
            // Если сделка НЕ в воронке абонементов
            INACTIVE: [
                // Статусы в других воронках
            ]
        };
        
        // Критические поля для сделки 28674745
        this.FIELD_IDS.LEAD = {
            TOTAL_CLASSES: 850241,    // "Абонемент занятий:" = "8 занятий"
            USED_CLASSES: 850257,     // "Счетчик занятий:" = "1"
            REMAINING_CLASSES: 890163, // "Остаток занятий" = "7"
            EXPIRATION_DATE: 850255,  // "Окончание абонемента:"
            ACTIVATION_DATE: 851565,  // "Дата активации абонемента:" = "25.01.2026"
            LAST_VISIT_DATE: 850259,  // "Дата последнего визита:" = "25.01.2026"
            SUBSCRIPTION_TYPE: 891007, // "Тип абонемента" = "Повторный"
            FREEZE: 867693,           // "Заморозка абонемента:" = "ДА"
            SUBSCRIPTION_OWNER: 805465, // "Принадлежность абонемента:"
            
            // Дополнительные поля
            TECHNICAL_COUNT: 891819,  // "Количество занятий (тех)"
            AGE_GROUP: 850243,        // "Группа возраст:" = "Поступающий"
            PRICE_PER_CLASS: 891813,  // "Стоимость 1 занятия"
            ADVANCE_PAYMENT: 891817,  // "Авансовые средства"
            RECEIVED_PAYMENT: 891815, // "Полученные средства"
            
            // Поля для посещений (чекбоксы)
            CLASS_1: 884899, CLASS_2: 884901, CLASS_3: 884903, CLASS_4: 884905,
            CLASS_5: 884907, CLASS_6: 884909, CLASS_7: 884911, CLASS_8: 884913
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

    // ==================== ИСПРАВЛЕННАЯ ЛОГИКА ОПРЕДЕЛЕНИЯ АКТИВНОГО АБОНЕМЕНТА ====================
    extractSubscriptionInfo(lead) {
        try {
            const customFields = lead.custom_fields_values || [];
            const statusId = lead.status_id;
            const pipelineId = lead.pipeline_id;
            
            console.log(`🔍 Анализ сделки ${lead.id}: "${lead.name}"`);
            console.log(`   📍 Pipeline: ${pipelineId}, Status: ${statusId}`);
            
            // Получаем данные полей
            const totalClasses = this.getNumberFromField(customFields, this.FIELD_IDS.LEAD.TOTAL_CLASSES);
            const usedClasses = this.getNumberFromField(customFields, this.FIELD_IDS.LEAD.USED_CLASSES);
            const remainingClasses = this.getNumberFromField(customFields, this.FIELD_IDS.LEAD.REMAINING_CLASSES);
            
            // Если поле "Остаток занятий" не заполнено, вычисляем
            let finalRemaining = remainingClasses;
            if (finalRemaining === 0 && totalClasses > 0) {
                finalRemaining = Math.max(0, totalClasses - usedClasses);
            }
            
            // Проверяем заморозку
            const freezeValue = this.getFieldValueFromFields(customFields, this.FIELD_IDS.LEAD.FREEZE);
            const isFrozen = freezeValue === 'ДА' || freezeValue === 'Да' || freezeValue === 'true';
            
            // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: 
            // Если сделка находится в воронке "!Абонемент" (7977402) → она АКТИВНАЯ
            const isInSubscriptionPipeline = pipelineId === this.SUBSCRIPTION_PIPELINE_ID;
            
            console.log(`   📊 Занятий: ${usedClasses}/${totalClasses} (остаток: ${finalRemaining})`);
            console.log(`   🎯 Воронка абонементов: ${isInSubscriptionPipeline ? '✅ Да' : '❌ Нет'}`);
            console.log(`   ❄️  Заморожен: ${isFrozen ? '✅ Да' : '❌ Нет'}`);
            
            let subscriptionActive = false;
            let subscriptionStatus = 'Не определен';
            let subscriptionBadge = 'secondary';
            
            // ПРАВИЛО №1: Если сделка в воронке "!Абонемент" → она АКТИВНАЯ
            if (isInSubscriptionPipeline) {
                subscriptionActive = true;
                
                // Подстатус внутри активного абонемента
                if (isFrozen) {
                    subscriptionStatus = `Активный (заморожен, осталось ${finalRemaining} занятий)`;
                    subscriptionBadge = 'warning';
                } 
                else if (finalRemaining > 0) {
                    subscriptionStatus = `Активный (осталось ${finalRemaining} занятий)`;
                    subscriptionBadge = 'success';
                }
                else if (finalRemaining === 0 && totalClasses > 0) {
                    subscriptionStatus = `Активный (использован, ${usedClasses}/${totalClasses} занятий)`;
                    subscriptionBadge = 'info';
                }
                else {
                    subscriptionStatus = `Активный абонемент`;
                    subscriptionBadge = 'success';
                }
            }
            // ПРАВИЛО №2: Сделка НЕ в воронке абонементов
            else if (totalClasses > 0) {
                subscriptionActive = false;
                
                if (isFrozen) {
                    subscriptionStatus = `Неактивный (заморожен, осталось ${finalRemaining} занятий)`;
                    subscriptionBadge = 'secondary';
                }
                else if (finalRemaining > 0) {
                    subscriptionStatus = `Неактивный (осталось ${finalRemaining} занятий)`;
                    subscriptionBadge = 'secondary';
                }
                else {
                    subscriptionStatus = `Неактивный (использован, ${usedClasses}/${totalClasses} занятий)`;
                    subscriptionBadge = 'secondary';
                }
            }
            // ПРАВИЛО №3: Нет абонемента
            else {
                subscriptionActive = false;
                subscriptionStatus = 'Нет абонемента';
                subscriptionBadge = 'inactive';
            }
            
            console.log(`   ✅ Итог: ${subscriptionStatus}`);
            
            return {
                hasSubscription: totalClasses > 0,
                totalClasses: totalClasses,
                usedClasses: usedClasses,
                remainingClasses: finalRemaining,
                subscriptionType: this.getFieldValueFromFields(customFields, this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE),
                subscriptionActive: subscriptionActive,
                activationDate: this.parseDate(this.getFieldValueFromFields(customFields, this.FIELD_IDS.LEAD.ACTIVATION_DATE)),
                expirationDate: this.parseDate(this.getFieldValueFromFields(customFields, this.FIELD_IDS.LEAD.EXPIRATION_DATE)),
                lastVisitDate: this.parseDate(this.getFieldValueFromFields(customFields, this.FIELD_IDS.LEAD.LAST_VISIT_DATE)),
                subscriptionStatus: subscriptionStatus,
                subscriptionBadge: subscriptionBadge,
                isFrozen: isFrozen,
                isInSubscriptionPipeline: isInSubscriptionPipeline,
                pipelineId: pipelineId,
                statusId: statusId
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

    getNumberFromField(customFields, fieldId) {
        const field = customFields.find(f => (f.field_id || f.id) === fieldId);
        if (!field) return 0;
        
        const value = this.getFieldValue(field);
        return this.parseNumberFromField(value);
    }

    getFieldValueFromFields(customFields, fieldId) {
        const field = customFields.find(f => (f.field_id || f.id) === fieldId);
        if (!field) return '';
        return this.getFieldValue(field);
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

    // ==================== ДИАГНОСТИЧЕСКИЙ МЕТОД ДЛЯ ТЕСТИРОВАНИЯ ====================
    async testSpecificLead(leadId) {
        try {
            console.log(`\n🧪 ТЕСТ СДЕЛКИ ${leadId}`);
            console.log('='.repeat(80));
            
            // Получаем сделку
            const lead = await this.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}?with=custom_fields_values`
            );
            
            if (!lead) {
                console.log('❌ Сделка не найдена');
                return null;
            }
            
            // Анализируем
            const subscriptionInfo = this.extractSubscriptionInfo(lead);
            
            // Выводим детали
            console.log(`\n📋 СДЕЛКА: "${lead.name}"`);
            console.log(`📌 ID: ${lead.id}`);
            console.log(`📍 Pipeline: ${lead.pipeline_id} (ожидается: ${this.SUBSCRIPTION_PIPELINE_ID})`);
            console.log(`📍 Status: ${lead.status_id}`);
            
            console.log(`\n🎯 ИНФОРМАЦИЯ ОБ АБОНЕМЕНТЕ:`);
            console.log(`   • Найден абонемент: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Всего занятий: ${subscriptionInfo.totalClasses}`);
            console.log(`   • Использовано: ${subscriptionInfo.usedClasses}`);
            console.log(`   • Осталось: ${subscriptionInfo.remainingClasses}`);
            console.log(`   • Тип: ${subscriptionInfo.subscriptionType}`);
            console.log(`   • Заморожен: ${subscriptionInfo.isFrozen ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Воронка абонемента: ${subscriptionInfo.isInSubscriptionPipeline ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Активен: ${subscriptionInfo.subscriptionActive ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Статус: ${subscriptionInfo.subscriptionStatus}`);
            
            // Анализируем ВСЕ поля
            const customFields = lead.custom_fields_values || [];
            console.log(`\n🔍 ВСЕ КЛЮЧЕВЫЕ ПОЛЯ:`);
            
            const keyFields = [
                { id: this.FIELD_IDS.LEAD.TOTAL_CLASSES, name: 'Абонемент занятий:' },
                { id: this.FIELD_IDS.LEAD.USED_CLASSES, name: 'Счетчик занятий:' },
                { id: this.FIELD_IDS.LEAD.REMAINING_CLASSES, name: 'Остаток занятий' },
                { id: this.FIELD_IDS.LEAD.FREEZE, name: 'Заморозка абонемента:' },
                { id: this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE, name: 'Тип абонемента' },
                { id: this.FIELD_IDS.LEAD.ACTIVATION_DATE, name: 'Дата активации абонемента:' },
                { id: this.FIELD_IDS.LEAD.LAST_VISIT_DATE, name: 'Дата последнего визита:' }
            ];
            
            keyFields.forEach(fieldDef => {
                const field = customFields.find(f => (f.field_id || f.id) === fieldDef.id);
                if (field) {
                    const value = this.getFieldValue(field);
                    console.log(`   • ${fieldDef.name}: "${value}"`);
                } else {
                    console.log(`   • ${fieldDef.name}: ❌ Не найдено`);
                }
            });
            
            return {
                lead: lead,
                subscriptionInfo: subscriptionInfo
            };
            
        } catch (error) {
            console.error('❌ Ошибка теста:', error.message);
            return null;
        }
    }

    // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ ДИАГНОСТИКИ ====================

    // Получение описания паттерна заполнения
    getPatternDescription(fieldPresence) {
        const descriptions = [];
        
        if (fieldPresence.total_classes) descriptions.push('Абонемент занятий');
        if (fieldPresence.used_classes) descriptions.push('Счетчик занятий');
        if (fieldPresence.remaining_classes) descriptions.push('Остаток занятий');
        if (fieldPresence.expiration_date) descriptions.push('Дата окончания');
        if (fieldPresence.activation_date) descriptions.push('Дата активации');
        if (fieldPresence.subscription_type) descriptions.push('Тип абонемента');
        if (fieldPresence.freeze) descriptions.push('Заморозка');
        
        const missing = [];
        if (!fieldPresence.total_classes) missing.push('Абонемент занятий');
        if (!fieldPresence.used_classes) missing.push('Счетчик занятий');
        if (!fieldPresence.remaining_classes) missing.push('Остаток занятий');
        
        let result = `Заполнено: ${descriptions.join(', ')}`;
        if (missing.length > 0) {
            result += ` | Отсутствуют: ${missing.join(', ')}`;
        }
        
        return result;
    }

    // Проверка целостности данных для сделки
    checkDataIntegrityForLead(fieldValues) {
        const problems = [];
        
        // Проверяем, что если есть total_classes, то должны быть used_classes и remaining_classes
        if (fieldValues.total_classes && (!fieldValues.used_classes || !fieldValues.remaining_classes)) {
            problems.push({
                type: 'INCOMPLETE_DATA',
                message: `Есть "Абонемент занятий: ${fieldValues.total_classes}", но нет счетчика или остатка`
            });
        }
        
        // Проверяем логику total = used + remaining
        if (fieldValues.total_classes && fieldValues.used_classes && fieldValues.remaining_classes) {
            const total = this.parseNumberFromField(fieldValues.total_classes);
            const used = this.parseNumberFromField(fieldValues.used_classes);
            const remaining = this.parseNumberFromField(fieldValues.remaining_classes);
            
            if (total !== used + remaining) {
                problems.push({
                    type: 'DATA_INTEGRITY',
                    message: `Некорректная сумма: ${used} + ${remaining} ≠ ${total}`,
                    expected: total,
                    actual: used + remaining
                });
            }
        }
        
        // Проверяем даты
        if (fieldValues.activation_date && fieldValues.expiration_date) {
            const activation = new Date(this.parseDate(fieldValues.activation_date));
            const expiration = new Date(this.parseDate(fieldValues.expiration_date));
            
            if (activation > expiration) {
                problems.push({
                    type: 'DATE_ORDER',
                    message: `Дата активации позже даты окончания`
                });
            }
        }
        
        return {
            hasProblems: problems.length > 0,
            problems: problems
        };
    }

    // Анализ названия сделки для хранения
    analyzeLeadNameForStorage(leadName) {
        const patterns = [
            {
                pattern: 'NAME - N занятий',
                regex: /^(.+?)\s*-\s*(\d+)\s*занят/i,
                description: 'ФИО - N занятий',
                extract: (match) => ({
                    student_name: match[1].trim(),
                    class_count: parseInt(match[2])
                })
            },
            {
                pattern: 'NAME (N занятий)',
                regex: /^(.+?)\s*\((\d+)\s*занят/i,
                description: 'ФИО (N занятий)',
                extract: (match) => ({
                    student_name: match[1].trim(),
                    class_count: parseInt(match[2])
                })
            },
            {
                pattern: 'Абонемент N занятий: NAME',
                regex: /^Абонемент\s*(\d+)\s*занят.*:\s*(.+)/i,
                description: 'Абонемент N занятий: ФИО',
                extract: (match) => ({
                    student_name: match[2].trim(),
                    class_count: parseInt(match[1])
                })
            },
            {
                pattern: 'Закончился N занятий - NAME',
                regex: /^Закончился\s*(\d+)\s*занят.*-\s*(.+)/i,
                description: 'Закончился N занятий - ФИО',
                extract: (match) => ({
                    student_name: match[2].trim(),
                    class_count: parseInt(match[1])
                })
            },
            {
                pattern: 'NAME и NAME - N занятий',
                regex: /^(.+?)\s+и\s+(.+?)\s*-\s*(\d+)\s*занят/i,
                description: 'ФИО и ФИО - N занятий',
                extract: (match) => ({
                    student_name: `${match[1].trim()} и ${match[2].trim()}`,
                    class_count: parseInt(match[3])
                })
            }
        ];
        
        for (const pattern of patterns) {
            const match = leadName.match(pattern.regex);
            if (match) {
                const extracted = pattern.extract(match);
                return {
                    pattern: pattern.pattern,
                    description: pattern.description,
                    student_name: extracted.student_name,
                    class_count: extracted.class_count
                };
            }
        }
        
        // Если не нашли стандартный паттерн, анализируем структуру
        const words = leadName.split(/\s+/);
        const hasNumber = words.some(word => /\d+/.test(word));
        const hasZanyatiy = leadName.toLowerCase().includes('занят');
        
        return {
            pattern: 'CUSTOM',
            description: hasNumber && hasZanyatiy ? 'Кастомный с числом занятий' : 'Нестандартный формат',
            student_name: null,
            class_count: null
        };
    }

    // Определение типичной конфигурации для статуса
    getTypicalConfiguration(fieldPresence) {
        const presentFields = Object.keys(fieldPresence).filter(k => fieldPresence[k]);
        return presentFields.join(', ');
    }

    // Проверка, является ли абонемент активным
    isActiveSubscription(statusId, fieldValues) {
        // Активные статусы из диагностики: 65473306, 142 (нужно уточнить)
        const activeStatusIds = [65473306, 142]; // Добавьте правильные ID
        
        if (!activeStatusIds.includes(parseInt(statusId))) {
            return false;
        }
        
        // Проверяем, есть ли остаток занятий
        if (fieldValues.remaining_classes) {
            const remaining = this.parseNumberFromField(fieldValues.remaining_classes);
            if (remaining > 0) {
                return true;
            }
        }
        
        return false;
    }

    // Может ли сделка быть выбрана как активный абонемент
    canBeSelectedAsActive(lead, fieldValues) {
        // Проверяем основные критерии
        const checks = [];
        
        // 1. В правильной воронке
        checks.push({
            name: 'Воронка абонементов',
            passed: lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID,
            weight: 100
        });
        
        // 2. Активный статус
        const activeStatusIds = [65473306, 142];
        checks.push({
            name: 'Активный статус',
            passed: activeStatusIds.includes(parseInt(lead.status_id)),
            weight: 80
        });
        
        // 3. Есть общее количество занятий
        checks.push({
            name: 'Указано общее кол-во занятий',
            passed: !!fieldValues.total_classes,
            weight: 60
        });
        
        // 4. Есть остаток занятий
        if (fieldValues.remaining_classes) {
            const remaining = this.parseNumberFromField(fieldValues.remaining_classes);
            checks.push({
                name: 'Есть остаток занятий',
                passed: remaining > 0,
                weight: 50,
                details: `Осталось: ${remaining}`
            });
        } else {
            checks.push({
                name: 'Есть остаток занятий',
                passed: false,
                weight: 50
            });
        }
        
        // 5. Не заморожен
        checks.push({
            name: 'Не заморожен',
            passed: !fieldValues.freeze || fieldValues.freeze.toLowerCase() !== 'да',
            weight: 40
        });
        
        // 6. Есть дата активации
        checks.push({
            name: 'Есть дата активации',
            passed: !!fieldValues.activation_date,
            weight: 30
        });
        
        // 7. Есть дата окончания
        checks.push({
            name: 'Есть дата окончания',
            passed: !!fieldValues.expiration_date,
            weight: 20
        });
        
        // Рассчитываем общий балл
        const totalScore = checks.reduce((sum, check) => {
            return sum + (check.passed ? check.weight : 0);
        }, 0);
        
        const maxScore = checks.reduce((sum, check) => sum + check.weight, 0);
        const percentage = (totalScore / maxScore) * 100;
        
        return {
            can_be_selected: percentage >= 70,
            score: totalScore,
            max_score: maxScore,
            percentage: percentage.toFixed(1),
            checks: checks,
            failed_checks: checks.filter(c => !c.passed).map(c => c.name)
        };
    }

    // Генерация рекомендаций на основе анализа
    generateStorageRecommendations(analysis) {
        const recommendations = [];
        
        // Анализируем паттерны заполнения
        const mostCommonPattern = analysis.data_completeness_patterns[0];
        if (mostCommonPattern) {
            const percentage = (mostCommonPattern.count / analysis.total_subscriptions_analyzed * 100).toFixed(1);
            recommendations.push(`Самый частый паттерн заполнения (${percentage}%): ${mostCommonPattern.description}`);
            
            // Если в самом частом паттерне не хватает ключевых полей
            const example = mostCommonPattern.examples[0];
            if (example && example.fields_missing && example.fields_missing.length > 0) {
                recommendations.push(`⚠️ В ${percentage}% сделок отсутствуют: ${example.fields_missing.join(', ')}`);
            }
        }
        
        // Анализируем варианты хранения "Абонемент занятий:"
        const totalClassesVariants = Object.keys(analysis.field_storage_patterns.total_classes).length;
        if (totalClassesVariants > 3) {
            recommendations.push(`Много вариантов записи "Абонемент занятий:" (${totalClassesVariants}). Нужна унификация.`);
        }
        
        // Анализируем проблемы с данными
        if (analysis.data_problems.length > 0) {
            const problemPercentage = (analysis.data_problems.length / analysis.total_subscriptions_analyzed * 100).toFixed(1);
            recommendations.push(`Обнаружены проблемы в данных: ${analysis.data_problems.length} сделок (${problemPercentage}%)`);
        }
        
        // Анализируем рабочие конфигурации
        if (analysis.working_configurations.length > 0) {
            const workingPercentage = (analysis.working_configurations.length / analysis.total_subscriptions_analyzed * 100).toFixed(1);
            recommendations.push(`✅ Полностью заполненные абонементы: ${analysis.working_configurations.length} (${workingPercentage}%)`);
        } else {
            recommendations.push(`🚨 КРИТИЧЕСКО: Нет ни одного полностью заполненного абонемента!`);
        }
        
        // Рекомендации по парсингу на основе анализа
        const totalClassesValues = Object.entries(analysis.field_storage_patterns.total_classes)
            .filter(([value, data]) => data.parsed_as_number === 0 && data.count > 1)
            .map(([value]) => value);
        
        if (totalClassesValues.length > 0) {
            recommendations.push(`Проблемы парсинга "Абонемент занятий:" для значений: ${totalClassesValues.join(', ')}`);
        }
        
        // Рекомендации по выбору активного абонемента
        const activeConfigs = analysis.working_configurations.filter(c => c.can_be_selected);
        if (activeConfigs.length > 0) {
            recommendations.push(`Можно выбирать как активные: ${activeConfigs.length} абонементов`);
        } else {
            recommendations.push(`⚠️ Нет абонементов, которые можно выбрать как активные по текущим критериям`);
        }
        
        return recommendations;
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
                        if (!this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(status.id)) {
                            this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.push(status.id);
                        }
                    } else if (status.name.toLowerCase().includes('заморозк')) {
                        if (!this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(status.id)) {
                            this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.push(status.id);
                        }
                    } else if (status.name.toLowerCase().includes('истек')) {
                        if (!this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(status.id)) {
                            this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.push(status.id);
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

    // ==================== ДИАГНОСТИЧЕСКИЕ МЕТОДЫ ====================
    async debugPhoneSearch(phone) {
        try {
            console.log(`\n🔍 ДИАГНОСТИКА ПОИСКА ПО ТЕЛЕФОНУ: ${phone}`);
            
            const results = {
                phone: phone,
                contacts_found: 0,
                leads_found: 0,
                subscription_leads: 0,
                details: [],
                issues: []
            };
            
            // Поиск контактов
            const contactsResponse = await this.searchContactsByPhone(phone);
            const contacts = contactsResponse._embedded?.contacts || [];
            results.contacts_found = contacts.length;
            
            console.log(`📊 Контактов найдено: ${contacts.length}`);
            
            if (contacts.length === 0) {
                results.issues.push('Не найдено контактов по телефону');
                return results;
            }
            
            // Анализируем первый контакт
            const contact = contacts[0];
            console.log(`👤 Основной контакт: "${contact.name}" (ID: ${contact.id})`);
            
            // Получаем сделки контакта
            const leads = await this.getContactLeadsSorted(contact.id);
            results.leads_found = leads.length;
            
            console.log(`📊 Сделок найдено: ${leads.length}`);
            
            // Анализируем первые 10 сделок
            for (let i = 0; i < Math.min(leads.length, 10); i++) {
                const lead = leads[i];
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                results.details.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    has_subscription: subscriptionInfo.hasSubscription,
                    total_classes: subscriptionInfo.totalClasses,
                    remaining_classes: subscriptionInfo.remainingClasses,
                    subscription_status: subscriptionInfo.subscriptionStatus
                });
                
                if (subscriptionInfo.hasSubscription) {
                    results.subscription_leads++;
                }
                
                console.log(`   ${i + 1}. "${lead.name.substring(0, 50)}..."`);
                console.log(`      🎫 Абонемент: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
                console.log(`      📊 Занятий: ${subscriptionInfo.totalClasses}`);
                console.log(`      📍 Pipeline: ${lead.pipeline_id}`);
            }
            
            // Проверяем наличие сделок с абонементами
            if (results.subscription_leads === 0 && results.leads_found > 0) {
                results.issues.push('Найдены сделки, но нет сделок с абонементами');
            }
            
            return results;
            
        } catch (error) {
            console.error('❌ Ошибка диагностики:', error.message);
            return null;
        }
    }

    async debugLeadAnalysis(leadId) {
        try {
            console.log(`\n🔍 ДИАГНОСТИКА СДЕЛКИ: ${leadId}`);
            
            const lead = await this.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}?with=custom_fields_values`
            );
            
            if (!lead) {
                console.log('❌ Сделка не найдена');
                return null;
            }
            
            const analysis = {
                lead_id: lead.id,
                lead_name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                fields_count: lead.custom_fields_values?.length || 0,
                subscription_info: this.extractSubscriptionInfo(lead),
                critical_fields: {},
                issues: []
            };
            
            // Анализируем критические поля
            const criticalFieldIds = [
                850241, // Абонемент занятий:
                850257, // Счетчик занятий:
                890163, // Остаток занятий
                850255, // Окончание абонемента:
                851565, // Дата активации абонемента:
                867693  // Заморозка абонемента:
            ];
            
            criticalFieldIds.forEach(fieldId => {
                const field = lead.custom_fields_values?.find(f => 
                    (f.field_id || f.id) === fieldId
                );
                
                if (field) {
                    const value = this.getFieldValue(field);
                    const parsedNumber = this.parseNumberFromField(value);
                    
                    analysis.critical_fields[fieldId] = {
                        name: this.getFieldName(field),
                        value: value,
                        parsed: parsedNumber,
                        exists: true
                    };
                } else {
                    analysis.critical_fields[fieldId] = {
                        name: `Поле ${fieldId}`,
                        value: null,
                        parsed: 0,
                        exists: false
                    };
                    
                    if ([850241, 850257, 890163].includes(fieldId)) {
                        analysis.issues.push(`Критическое поле ${fieldId} не найдено`);
                    }
                }
            });
            
            // Проверяем целостность данных
            const total = analysis.subscription_info.totalClasses;
            const used = analysis.subscription_info.usedClasses;
            const remaining = analysis.subscription_info.remainingClasses;
            
            if (total > 0 && used + remaining !== total) {
                analysis.issues.push(`Некорректная сумма: ${used} + ${remaining} ≠ ${total}`);
            }
            
            console.log(`📋 Сделка: "${lead.name}"`);
            console.log(`📍 Pipeline: ${lead.pipeline_id}, Status: ${lead.status_id}`);
            console.log(`🎯 Абонемент: ${analysis.subscription_info.hasSubscription ? '✅ Найден' : '❌ Не найден'}`);
            console.log(`📊 Занятий: ${total} всего, ${remaining} осталось`);
            
            if (analysis.issues.length > 0) {
                console.log(`🚨 Проблемы: ${analysis.issues.join('; ')}`);
            }
            
            return analysis;
            
        } catch (error) {
            console.error('❌ Ошибка анализа:', error.message);
            return null;
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

// ==================== ДИАГНОСТИЧЕСКИЕ МАРШРУТЫ ====================

// ==================== ПОЛНАЯ ДИАГНОСТИКА ХРАНЕНИЯ ДАННЫХ АБОНЕМЕНТОВ ====================
app.get('/api/debug/subscriptions-storage', async (req, res) => {
    try {
        console.log('\n🔍 ПОЛНАЯ ДИАГНОСТИКА ХРАНЕНИЯ ДАННЫХ АБОНЕМЕНТОВ');
        console.log('='.repeat(120));
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const startTime = Date.now();
        
        // 1. СБИРАЕМ ВСЕ ВАРИАНТЫ ЗАПИСИ АБОНЕМЕНТОВ
        console.log('\n📊 ШАГ 1: Сбор всех вариантов записи абонементов...');
        
        // Получаем первые 100 сделок из воронки абонементов
        const leadsResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&page=1&limit=100&filter[pipeline_id][]=${amoCrmService.SUBSCRIPTION_PIPELINE_ID}`
        );
        
        const leads = leadsResponse._embedded?.leads || [];
        
        console.log(`📊 Найдено сделок в воронке абонементов: ${leads.length}`);
        
        const storageAnalysis = {
            timestamp: new Date().toISOString(),
            total_subscriptions_analyzed: 0,
            
            // ВАРИАНТЫ ХРАНЕНИЯ ПО КЛЮЧЕВЫМ ПОЛЯМ
            field_storage_patterns: {
                total_classes: {},       // Как хранятся "Абонемент занятий:"
                used_classes: {},        // Как хранятся "Счетчик занятий:"
                remaining_classes: {},   // Как хранятся "Остаток занятий"
                expiration_date: {},     // Как хранятся "Окончание абонемента:"
                activation_date: {},     // Как хранятся "Дата активации абонемента:"
                subscription_type: {},   // Как хранятся "Тип абонемента"
                freeze: {}               // Как хранятся "Заморозка абонемента:"
            },
            
            // ПАТТЕРНЫ ПОЛНОТЫ ДАННЫХ
            data_completeness_patterns: [],
            
            // СТАТУСЫ АБОНЕМЕНТОВ И ИХ ХАРАКТЕРИСТИКИ
            subscription_statuses: {},
            
            // ПРОБЛЕМЫ В ДАННЫХ
            data_problems: [],
            
            // ВАРИАНТЫ НАЗВАНИЙ СДЕЛОК
            lead_naming_patterns: [],
            
            // ПРИМЕРЫ РАБОЧИХ КОНФИГУРАЦИЙ
            working_configurations: []
        };
        
        // 2. АНАЛИЗИРУЕМ КАЖДУЮ СДЕЛКУ
        for (const lead of leads) {
            const leadId = lead.id;
            const leadName = lead.name;
            const statusId = lead.status_id;
            const customFields = lead.custom_fields_values || [];
            
            // Собираем данные по каждому полю
            const fieldValues = {};
            const fieldPresence = {};
            
            // Ключевые поля для анализа
            const keyFields = [
                { id: 850241, name: 'Абонемент занятий:', key: 'total_classes' },
                { id: 850257, name: 'Счетчик занятий:', key: 'used_classes' },
                { id: 890163, name: 'Остаток занятий', key: 'remaining_classes' },
                { id: 850255, name: 'Окончание абонемента:', key: 'expiration_date' },
                { id: 851565, name: 'Дата активации абонемента:', key: 'activation_date' },
                { id: 891007, name: 'Тип абонемента', key: 'subscription_type' },
                { id: 867693, name: 'Заморозка абонемента:', key: 'freeze' }
            ];
            
            // Проверяем каждое поле
            for (const fieldDef of keyFields) {
                const field = customFields.find(f => (f.field_id || f.id) === fieldDef.id);
                
                if (field) {
                    const value = amoCrmService.getFieldValue(field);
                    fieldValues[fieldDef.key] = value;
                    fieldPresence[fieldDef.key] = true;
                    
                    // Собираем статистику по вариантам хранения
                    if (!storageAnalysis.field_storage_patterns[fieldDef.key][value]) {
                        storageAnalysis.field_storage_patterns[fieldDef.key][value] = {
                            raw_value: value,
                            count: 1,
                            examples: [`"${leadName}"`],
                            parsed_as_number: amoCrmService.parseNumberFromField(value),
                            parsed_as_date: amoCrmService.parseDate(value)
                        };
                    } else {
                        storageAnalysis.field_storage_patterns[fieldDef.key][value].count++;
                        if (storageAnalysis.field_storage_patterns[fieldDef.key][value].examples.length < 5) {
                            storageAnalysis.field_storage_patterns[fieldDef.key][value].examples.push(`"${leadName}"`);
                        }
                    }
                } else {
                    fieldValues[fieldDef.key] = null;
                    fieldPresence[fieldDef.key] = false;
                }
            }
            
            // Анализируем паттерн полноты данных
            const presenceKey = Object.keys(fieldPresence)
                .map(key => fieldPresence[key] ? '1' : '0')
                .join('');
            
            const existingPattern = storageAnalysis.data_completeness_patterns.find(p => p.pattern === presenceKey);
            if (existingPattern) {
                existingPattern.count++;
                if (existingPattern.examples.length < 3) {
                    existingPattern.examples.push({
                        lead_id: leadId,
                        lead_name: leadName,
                        fields_present: Object.keys(fieldPresence).filter(k => fieldPresence[k]),
                        fields_missing: Object.keys(fieldPresence).filter(k => !fieldPresence[k])
                    });
                }
            } else {
                storageAnalysis.data_completeness_patterns.push({
                    pattern: presenceKey,
                    description: amoCrmService.getPatternDescription(fieldPresence),
                    count: 1,
                    examples: [{
                        lead_id: leadId,
                        lead_name: leadName,
                        fields_present: Object.keys(fieldPresence).filter(k => fieldPresence[k]),
                        fields_missing: Object.keys(fieldPresence).filter(k => !fieldPresence[k])
                    }]
                });
            }
            
            // Анализируем статус
            if (!storageAnalysis.subscription_statuses[statusId]) {
                storageAnalysis.subscription_statuses[statusId] = {
                    count: 1,
                    examples: [leadName],
                    typical_configuration: amoCrmService.getTypicalConfiguration(fieldPresence)
                };
            } else {
                storageAnalysis.subscription_statuses[statusId].count++;
                if (storageAnalysis.subscription_statuses[statusId].examples.length < 3) {
                    storageAnalysis.subscription_statuses[statusId].examples.push(leadName);
                }
            }
            
            // Проверяем целостность данных
            const integrityCheck = amoCrmService.checkDataIntegrityForLead(fieldValues);
            if (integrityCheck.hasProblems) {
                storageAnalysis.data_problems.push({
                    lead_id: leadId,
                    lead_name: leadName,
                    problems: integrityCheck.problems,
                    field_values: fieldValues
                });
            }
            
            // Если это рабочая конфигурация (все ключевые поля заполнены)
            const allKeyFieldsPresent = Object.values(fieldPresence).every(p => p === true);
            if (allKeyFieldsPresent) {
                storageAnalysis.working_configurations.push({
                    lead_id: leadId,
                    lead_name: leadName,
                    status_id: statusId,
                    field_values: fieldValues,
                    is_active: amoCrmService.isActiveSubscription(statusId, fieldValues),
                    can_be_selected: amoCrmService.canBeSelectedAsActive(lead, fieldValues)
                });
            }
            
            storageAnalysis.total_subscriptions_analyzed++;
        }
        
        // 3. АНАЛИЗ ВАРИАНТОВ НАЗВАНИЙ
        console.log('\n📊 ШАГ 2: Анализ паттернов названий...');
        
        leads.forEach(lead => {
            const pattern = amoCrmService.analyzeLeadNameForStorage(lead.name);
            
            const existingPattern = storageAnalysis.lead_naming_patterns.find(p => p.pattern === pattern.pattern);
            if (existingPattern) {
                existingPattern.count++;
                if (existingPattern.examples.length < 3) {
                    existingPattern.examples.push(lead.name);
                }
            } else {
                storageAnalysis.lead_naming_patterns.push({
                    pattern: pattern.pattern,
                    description: pattern.description,
                    count: 1,
                    examples: [lead.name],
                    student_extraction: pattern.student_name,
                    class_extraction: pattern.class_count
                });
            }
        });
        
        // 4. СОРТИРОВКА И ФИЛЬТРАЦИЯ РЕЗУЛЬТАТОВ
        storageAnalysis.data_completeness_patterns.sort((a, b) => b.count - a.count);
        storageAnalysis.lead_naming_patterns.sort((a, b) => b.count - a.count);
        
        // 5. ГЕНЕРАЦИЯ РЕКОМЕНДАЦИЙ
        console.log('\n📊 ШАГ 3: Генерация рекомендаций...');
        
        const recommendations = amoCrmService.generateStorageRecommendations(storageAnalysis);
        storageAnalysis.recommendations = recommendations;
        
        // 6. ВЫВОД В КОНСОЛЬ ДЛЯ ОТЛАДКИ
        console.log('\n' + '='.repeat(120));
        console.log('📈 РЕЗУЛЬТАТЫ ДИАГНОСТИКИ ХРАНЕНИЯ ДАННЫХ');
        console.log('='.repeat(120));
        
        console.log(`📊 Всего проанализировано абонементов: ${storageAnalysis.total_subscriptions_analyzed}`);
        console.log(`📊 Уникальных паттернов заполнения: ${storageAnalysis.data_completeness_patterns.length}`);
        console.log(`📊 Рабочих конфигураций: ${storageAnalysis.working_configurations.length}`);
        console.log(`🚨 Проблем в данных: ${storageAnalysis.data_problems.length}`);
        
        console.log('\n🔑 ТОП-3 ПАТТЕРНА ЗАПОЛНЕНИЯ ПОЛЕЙ:');
        storageAnalysis.data_completeness_patterns.slice(0, 3).forEach((pattern, index) => {
            const percentage = (pattern.count / storageAnalysis.total_subscriptions_analyzed * 100).toFixed(1);
            console.log(`\n${index + 1}. ${pattern.description} (${pattern.count} сделок, ${percentage}%)`);
            pattern.examples.forEach(example => {
                console.log(`   • "${example.lead_name}"`);
                console.log(`     ✅ Присутствуют: ${example.fields_present.join(', ')}`);
                if (example.fields_missing.length > 0) {
                    console.log(`     ❌ Отсутствуют: ${example.fields_missing.join(', ')}`);
                }
            });
        });
        
        console.log('\n💾 ВАРИАНТЫ ХРАНЕНИЯ КЛЮЧЕВЫХ ПОЛЕЙ:');
        
        // Для поля "Абонемент занятий:"
        const totalClassesPatterns = Object.entries(storageAnalysis.field_storage_patterns.total_classes)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5);
        
        console.log(`\n📋 "Абонемент занятий:" (${Object.keys(storageAnalysis.field_storage_patterns.total_classes).length} вариантов):`);
        totalClassesPatterns.forEach(([value, data], index) => {
            const percentage = (data.count / storageAnalysis.total_subscriptions_analyzed * 100).toFixed(1);
            console.log(`   ${index + 1}. "${value}" → ${data.parsed_as_number} занятий (${data.count} сделок, ${percentage}%)`);
            console.log(`      Примеры: ${data.examples.join(', ')}`);
        });
        
        // Для поля "Остаток занятий"
        const remainingClassesPatterns = Object.entries(storageAnalysis.field_storage_patterns.remaining_classes)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5);
        
        if (remainingClassesPatterns.length > 0) {
            console.log(`\n📋 "Остаток занятий" (${Object.keys(storageAnalysis.field_storage_patterns.remaining_classes).length} вариантов):`);
            remainingClassesPatterns.forEach(([value, data], index) => {
                const percentage = (data.count / storageAnalysis.total_subscriptions_analyzed * 100).toFixed(1);
                console.log(`   ${index + 1}. "${value}" → ${data.parsed_as_number} (${data.count} сделок, ${percentage}%)`);
            });
        }
        
        console.log('\n🏷️  ТОП-3 ПАТТЕРНА НАЗВАНИЙ СДЕЛОК:');
        storageAnalysis.lead_naming_patterns.slice(0, 3).forEach((pattern, index) => {
            const percentage = (pattern.count / storageAnalysis.total_subscriptions_analyzed * 100).toFixed(1);
            console.log(`\n${index + 1}. ${pattern.description} (${pattern.count} сделок, ${percentage}%)`);
            console.log(`   Извлекается: ${pattern.student_extraction || 'неизвестно'}`);
            if (pattern.class_extraction) {
                console.log(`   Занятий: ${pattern.class_extraction}`);
            }
            pattern.examples.forEach(example => {
                console.log(`   • "${example}"`);
            });
        });
        
        console.log('\n✅ РАБОЧИЕ КОНФИГУРАЦИИ (полностью заполненные):');
        storageAnalysis.working_configurations.slice(0, 5).forEach((config, index) => {
            console.log(`\n${index + 1}. "${config.lead_name}"`);
            console.log(`   🆔 Статус: ${config.status_id}`);
            console.log(`   📊 Занятий: ${config.field_values.total_classes} всего, ${config.field_values.remaining_classes} осталось`);
            console.log(`   📅 Активация: ${config.field_values.activation_date}`);
            console.log(`   📅 Окончание: ${config.field_values.expiration_date}`);
            console.log(`   ✅ Может быть выбран как активный: ${config.can_be_selected ? 'Да' : 'Нет'}`);
        });
        
        if (storageAnalysis.data_problems.length > 0) {
            console.log('\n🚨 ПРОБЛЕМЫ В ДАННЫХ:');
            storageAnalysis.data_problems.slice(0, 5).forEach((problem, index) => {
                console.log(`\n${index + 1}. "${problem.lead_name}"`);
                problem.problems.forEach(p => {
                    console.log(`   • ${p.message}`);
                });
            });
        }
        
        console.log('\n💡 РЕКОМЕНДАЦИИ:');
        storageAnalysis.recommendations.forEach((rec, index) => {
            console.log(`${index + 1}. ${rec}`);
        });
        
        const duration = Date.now() - startTime;
        console.log(`\n⏱️  Время выполнения: ${duration}ms`);
        console.log('='.repeat(120));
        
        res.json({
            success: true,
            message: 'Полная диагностика хранения данных абонементов выполнена',
            timestamp: storageAnalysis.timestamp,
            data: {
                summary: {
                    total_analyzed: storageAnalysis.total_subscriptions_analyzed,
                    working_configurations: storageAnalysis.working_configurations.length,
                    data_problems: storageAnalysis.data_problems.length,
                    unique_patterns: storageAnalysis.data_completeness_patterns.length,
                    execution_time_ms: duration
                },
                field_storage_patterns: storageAnalysis.field_storage_patterns,
                data_completeness_patterns: storageAnalysis.data_completeness_patterns,
                subscription_statuses: storageAnalysis.subscription_statuses,
                lead_naming_patterns: storageAnalysis.lead_naming_patterns,
                working_configurations: storageAnalysis.working_configurations.slice(0, 10),
                data_problems: storageAnalysis.data_problems.slice(0, 10),
                recommendations: storageAnalysis.recommendations
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики хранения данных:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

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
                subscription_pipeline_id: amoCrmService.SUBSCRIPTION_PIPELINE_ID
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

// Тест конкретной сделки
app.get('/api/test-lead/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        const result = await amoCrmService.testSpecificLead(leadId);
        
        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        res.json({
            success: true,
            message: 'Тест выполнен',
            data: result
        });
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Тест поиска учеников по телефону
app.get('/api/test-phone/:phone', async (req, res) => {
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
                }))
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
            console.log(`🧪 Тест сделки: GET http://localhost:${PORT}/api/test-lead/28674745`);
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
