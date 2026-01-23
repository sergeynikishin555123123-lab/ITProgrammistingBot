
 // server.js - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ
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

// ==================== КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService (ИСПРАВЛЕННАЯ ВЕРСИЯ)');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.fieldMappings = new Map();
        
        // ДИНАМИЧЕСКИ ОПРЕДЕЛЯЕМЫЕ ID ПОЛЕЙ (будут заполнены при инициализации)
        this.FIELD_IDS = {
            LEAD: {
                TOTAL_CLASSES: null,    // "Абонемент занятий:"
                USED_CLASSES: null,     // "Счетчик занятий:"
                REMAINING_CLASSES: null, // "Остаток занятий"
                EXPIRATION_DATE: null,  // "Окончание абонемента:"
                ACTIVATION_DATE: null,  // "Дата активации абонемента:"
                LAST_VISIT_DATE: null,  // "Дата последнего визита:"
                SUBSCRIPTION_TYPE: null, // "Тип абонемента"
                BRANCH: null,           // Будем искать поле с "филиал"
                AGE_GROUP: null,        // "Группа возраст:"
                FREEZE: null,           // "Заморозка абонемента:"
                SUBSCRIPTION_OWNER: null // "Принадлежность абонемента:"
            },
            
            CONTACT: {
                CHILD_1_NAME: null,    // Будем искать поле с "ребен"
                CHILD_2_NAME: null,
                CHILD_3_NAME: null,
                CHILD_1_BIRTHDAY: null,
                CHILD_2_BIRTHDAY: null,
                CHILD_3_BIRTHDAY: null,
                
                BRANCH: null,          // Будем искать поле с "филиал"
                TEACHER: null,         // Будем искать поле с "преподаватель"
                DAY_OF_WEEK: null,     // Будем искать поле с "день недели"
                HAS_ACTIVE_SUB: null,  // Будем искать поле с "активн"
                LAST_VISIT: null,      // Будем искать поле с "последн"
                AGE_GROUP: null,       // Будем искать поле с "возраст"
                ALLERGIES: null,       // Будем искать поле с "аллерг"
                BIRTH_DATE: null,      // "День рождения:"
                
                // Общие поля
                PARENT_NAME: 'name',
                EMAIL: null
            }
        };
        
        // Кэш для хранения найденных полей
        this.fieldCache = {
            leadFields: new Map(),
            contactFields: new Map()
        };
    }

    async initialize() {
        try {
            if (this.accessToken) {
                console.log('🔍 Проверка валидности токена...');
                const isValid = await this.checkTokenValidity(this.accessToken);
                this.isInitialized = isValid;
                
                if (isValid) {
                    await this.loadAndMapFields();
                    console.log('✅ amoCRM успешно инициализирован');
                }
                return isValid;
            }
            return false;
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            return false;
        }
    }


     async loadAndMapFields() {
        try {
            console.log('📋 Загрузка и маппинг полей amoCRM...');
            
            // Загружаем поля сделок
            const leadFields = await this.makeRequest('GET', '/api/v4/leads/custom_fields');
            await this.mapLeadFields(leadFields);
            
            // Загружаем поля контактов
            const contactFields = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            await this.mapContactFields(contactFields);
            
            // Выводим отладочную информацию
            this.printFieldMapping();
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка загрузки полей:', error.message);
            return false;
        }
    }

async mapLeadFields(fieldsResponse) {
        if (!fieldsResponse || !fieldsResponse._embedded || !fieldsResponse._embedded.custom_fields) {
            console.log('⚠️  Поля сделок не найдены');
            return;
        }
        
        const fields = fieldsResponse._embedded.custom_fields;
        console.log(`📊 Найдено полей сделок: ${fields.length}`);
        
        // Очищаем кэш
        this.fieldCache.leadFields.clear();
        
        for (const field of fields) {
            const fieldId = field.id;
            const fieldName = field.name.toLowerCase();
            
            // Сохраняем в кэш
            this.fieldCache.leadFields.set(fieldId, {
                id: fieldId,
                name: field.name,
                type: field.type,
                enums: field.enums || []
            });
            
            // Маппинг по ключевым словам
            if (fieldName.includes('абонемент занят')) {
                this.FIELD_IDS.LEAD.TOTAL_CLASSES = fieldId;
                console.log(`✅ TOTAL_CLASSES: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('счетчик занят')) {
                this.FIELD_IDS.LEAD.USED_CLASSES = fieldId;
                console.log(`✅ USED_CLASSES: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('остаток занят')) {
                this.FIELD_IDS.LEAD.REMAINING_CLASSES = fieldId;
                console.log(`✅ REMAINING_CLASSES: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('окончание абонемента')) {
                this.FIELD_IDS.LEAD.EXPIRATION_DATE = fieldId;
                console.log(`✅ EXPIRATION_DATE: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('дата активации')) {
                this.FIELD_IDS.LEAD.ACTIVATION_DATE = fieldId;
                console.log(`✅ ACTIVATION_DATE: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('дата последнего визита')) {
                this.FIELD_IDS.LEAD.LAST_VISIT_DATE = fieldId;
                console.log(`✅ LAST_VISIT_DATE: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('тип абонемента')) {
                this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE = fieldId;
                console.log(`✅ SUBSCRIPTION_TYPE: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('филиал') || fieldName.includes('центр')) {
                this.FIELD_IDS.LEAD.BRANCH = fieldId;
                console.log(`✅ BRANCH: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('группа возраст') || fieldName.includes('возраст')) {
                this.FIELD_IDS.LEAD.AGE_GROUP = fieldId;
                console.log(`✅ AGE_GROUP: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('заморозка')) {
                this.FIELD_IDS.LEAD.FREEZE = fieldId;
                console.log(`✅ FREEZE: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('принадлежность абонемента')) {
                this.FIELD_IDS.LEAD.SUBSCRIPTION_OWNER = fieldId;
                console.log(`✅ SUBSCRIPTION_OWNER: ${fieldId} -> "${field.name}"`);
            }
        }
        
        // Проверяем обязательные поля
        this.validateRequiredFields('LEAD');
    }


 async mapContactFields(fieldsResponse) {
        if (!fieldsResponse || !fieldsResponse._embedded || !fieldsResponse._embedded.custom_fields) {
            console.log('⚠️  Поля контактов не найдены');
            return;
        }
        
        const fields = fieldsResponse._embedded.custom_fields;
        console.log(`📊 Найдено полей контактов: ${fields.length}`);
        
        // Очищаем кэш
        this.fieldCache.contactFields.clear();
        
        let childCount = 1;
        
        for (const field of fields) {
            const fieldId = field.id;
            const fieldName = field.name.toLowerCase();
            
            // Сохраняем в кэш
            this.fieldCache.contactFields.set(fieldId, {
                id: fieldId,
                name: field.name,
                type: field.type,
                enums: field.enums || []
            });
            
            // Маппинг полей детей
            if ((fieldName.includes('ребен') || fieldName.includes('фио')) && 
                !fieldName.includes('день рождения') && 
                childCount <= 3) {
                
                if (childCount === 1) {
                    this.FIELD_IDS.CONTACT.CHILD_1_NAME = fieldId;
                    console.log(`✅ CHILD_1_NAME: ${fieldId} -> "${field.name}"`);
                } else if (childCount === 2) {
                    this.FIELD_IDS.CONTACT.CHILD_2_NAME = fieldId;
                    console.log(`✅ CHILD_2_NAME: ${fieldId} -> "${field.name}"`);
                } else if (childCount === 3) {
                    this.FIELD_IDS.CONTACT.CHILD_3_NAME = fieldId;
                    console.log(`✅ CHILD_3_NAME: ${fieldId} -> "${field.name}"`);
                }
                childCount++;
            }
            
            // День рождения ребенка
            else if (fieldName.includes('день рождения') && fieldName.includes('ребен')) {
                if (!this.FIELD_IDS.CONTACT.CHILD_1_BIRTHDAY) {
                    this.FIELD_IDS.CONTACT.CHILD_1_BIRTHDAY = fieldId;
                    console.log(`✅ CHILD_1_BIRTHDAY: ${fieldId} -> "${field.name}"`);
                } else if (!this.FIELD_IDS.CONTACT.CHILD_2_BIRTHDAY) {
                    this.FIELD_IDS.CONTACT.CHILD_2_BIRTHDAY = fieldId;
                    console.log(`✅ CHILD_2_BIRTHDAY: ${fieldId} -> "${field.name}"`);
                } else if (!this.FIELD_IDS.CONTACT.CHILD_3_BIRTHDAY) {
                    this.FIELD_IDS.CONTACT.CHILD_3_BIRTHDAY = fieldId;
                    console.log(`✅ CHILD_3_BIRTHDAY: ${fieldId} -> "${field.name}"`);
                }
            }
            
            // Общие поля
            else if (fieldName.includes('филиал') || fieldName.includes('центр')) {
                this.FIELD_IDS.CONTACT.BRANCH = fieldId;
                console.log(`✅ CONTACT.BRANCH: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('преподаватель')) {
                this.FIELD_IDS.CONTACT.TEACHER = fieldId;
                console.log(`✅ TEACHER: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('день недел')) {
                this.FIELD_IDS.CONTACT.DAY_OF_WEEK = fieldId;
                console.log(`✅ DAY_OF_WEEK: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('активн') && fieldName.includes('абонемент')) {
                this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB = fieldId;
                console.log(`✅ HAS_ACTIVE_SUB: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('последн') && fieldName.includes('визит')) {
                this.FIELD_IDS.CONTACT.LAST_VISIT = fieldId;
                console.log(`✅ LAST_VISIT: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('возраст') && fieldName.includes('групп')) {
                this.FIELD_IDS.CONTACT.AGE_GROUP = fieldId;
                console.log(`✅ AGE_GROUP: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('аллерг') || fieldName.includes('особенност')) {
                this.FIELD_IDS.CONTACT.ALLERGIES = fieldId;
                console.log(`✅ ALLERGIES: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('день рождения') && !fieldName.includes('ребен')) {
                this.FIELD_IDS.CONTACT.BIRTH_DATE = fieldId;
                console.log(`✅ BIRTH_DATE: ${fieldId} -> "${field.name}"`);
            }
            else if (fieldName.includes('почта') || fieldName.includes('email')) {
                this.FIELD_IDS.CONTACT.EMAIL = fieldId;
                console.log(`✅ EMAIL: ${fieldId} -> "${field.name}"`);
            }
        }
    }

    validateRequiredFields(type) {
        const requiredFields = {
            LEAD: ['TOTAL_CLASSES', 'USED_CLASSES', 'EXPIRATION_DATE', 'ACTIVATION_DATE']
        };
        
        if (requiredFields[type]) {
            console.log(`\n🔍 Проверка обязательных полей для ${type}:`);
            let allFound = true;
            
            for (const fieldName of requiredFields[type]) {
                const fieldId = this.FIELD_IDS[type][fieldName];
                if (!fieldId) {
                    console.log(`❌ Поле ${fieldName} не найдено!`);
                    allFound = false;
                } else {
                    console.log(`✅ ${fieldName}: ${fieldId}`);
                }
            }
            
            if (!allFound) {
                console.log('⚠️  ВНИМАНИЕ: Не все обязательные поля найдены!');
            }
        }
    }

    printFieldMapping() {
        console.log('\n' + '='.repeat(80));
        console.log('📊 ИТОГОВЫЙ МАППИНГ ПОЛЕЙ:');
        console.log('='.repeat(80));
        
        console.log('\n🎫 ПОЛЯ СДЕЛОК (абонементы):');
        console.log('-'.repeat(40));
        for (const [key, value] of Object.entries(this.FIELD_IDS.LEAD)) {
            if (value) {
                const fieldInfo = this.fieldCache.leadFields.get(value);
                console.log(`  ${key.padEnd(25)}: ${value} -> "${fieldInfo?.name || 'неизвестно'}"`);
            } else {
                console.log(`  ${key.padEnd(25)}: НЕ НАЙДЕНО`);
            }
        }
        
        console.log('\n👤 ПОЛЯ КОНТАКТОВ (ученики):');
        console.log('-'.repeat(40));
        for (const [key, value] of Object.entries(this.FIELD_IDS.CONTACT)) {
            if (value && typeof value === 'number') {
                const fieldInfo = this.fieldCache.contactFields.get(value);
                console.log(`  ${key.padEnd(25)}: ${value} -> "${fieldInfo?.name || 'неизвестно'}"`);
            } else if (value === 'name') {
                console.log(`  ${key.padEnd(25)}: (системное поле)`);
            } else if (!value) {
                console.log(`  ${key.padEnd(25)}: НЕ НАЙДЕНО`);
            }
        }
        console.log('='.repeat(80));
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
                `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=leads,custom_fields_values`
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

    parseDate(value) {
        if (!value) return null;
        
        try {
            const dateStr = String(value).trim();
            
            if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{2,4}$/)) {
                const parts = dateStr.split('.');
                let day = parts[0].padStart(2, '0');
                let month = parts[1].padStart(2, '0');
                let year = parts[2];
                
                if (year.length === 2) {
                    year = '20' + year;
                }
                
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

    // 🔧 УЛУЧШЕННЫЙ МЕТОД: extractSubscriptionInfo
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
            subscriptionStatus: 'Нет абонемента',
            subscriptionBadge: 'inactive',
            branch: '',
            teacher: ''
        };
        
        if (!lead) {
            return subscriptionInfo;
        }
        
        try {
            const customFields = lead.custom_fields_values || [];
            const leadName = lead.name || '';
            
            console.log(`\n🔍 Анализ сделки: "${leadName.substring(0, 50)}..." (ID: ${lead.id})`);
            
            // 1. Ищем все числовые поля
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                const fieldValue = this.getFieldValue(field);
                const fieldName = this.getFieldName(field).toLowerCase();
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                // Определяем тип поля по имени
                if (fieldName.includes('абонемент') && fieldName.includes('занят')) {
                    // Парсим значение "4 занятия", "8 занятий" и т.д.
                    const match = fieldValue.match(/(\d+)\s*занят/);
                    if (match && match[1]) {
                        subscriptionInfo.totalClasses = parseInt(match[1]);
                        console.log(`📊 Поле "Абонемент": ${fieldValue} -> ${subscriptionInfo.totalClasses} занятий`);
                    }
                }
                else if (fieldName.includes('счетчик')) {
                    subscriptionInfo.usedClasses = parseInt(fieldValue) || 0;
                    console.log(`📊 Счетчик занятий: ${subscriptionInfo.usedClasses}`);
                }
                else if (fieldName.includes('остаток')) {
                    subscriptionInfo.remainingClasses = parseInt(fieldValue) || 0;
                    console.log(`📊 Остаток занятий: ${subscriptionInfo.remainingClasses}`);
                }
                else if (fieldName.includes('окончание') || fieldName.includes('срок')) {
                    subscriptionInfo.expirationDate = this.parseDateOrTimestamp(fieldValue);
                    console.log(`📊 Окончание: ${subscriptionInfo.expirationDate}`);
                }
                else if (fieldName.includes('активации')) {
                    subscriptionInfo.activationDate = this.parseDateOrTimestamp(fieldValue);
                    console.log(`📊 Активация: ${subscriptionInfo.activationDate}`);
                }
                else if (fieldName.includes('последн') && fieldName.includes('визит')) {
                    subscriptionInfo.lastVisitDate = this.parseDateOrTimestamp(fieldValue);
                    console.log(`📊 Последний визит: ${subscriptionInfo.lastVisitDate}`);
                }
                else if (fieldName.includes('тип абонемента')) {
                    subscriptionInfo.subscriptionType = fieldValue;
                    console.log(`📊 Тип: ${fieldValue}`);
                }
                else if (fieldName.includes('филиал') || fieldName.includes('центр')) {
                    subscriptionInfo.branch = fieldValue;
                    console.log(`📊 Филиал: ${fieldValue}`);
                }
                else if (fieldName.includes('заморозка') && fieldValue.toLowerCase() === 'да') {
                    subscriptionInfo.isFrozen = true;
                    console.log(`📊 Заморозка: ДА`);
                }
                else if (fieldName.includes('преподаватель')) {
                    subscriptionInfo.teacher = fieldValue;
                    console.log(`📊 Преподаватель: ${fieldValue}`);
                }
            }
            
            // 2. Если не нашли в полях, пробуем парсить название
            if (subscriptionInfo.totalClasses === 0) {
                const nameMatch = leadName.match(/(\d+)\s*занят/);
                if (nameMatch && nameMatch[1]) {
                    subscriptionInfo.totalClasses = parseInt(nameMatch[1]);
                    console.log(`📊 Из названия: ${subscriptionInfo.totalClasses} занятий`);
                }
            }
            
            // 3. Рассчитываем недостающие значения
            if (subscriptionInfo.totalClasses > 0) {
                subscriptionInfo.hasSubscription = true;
                
                // Если есть общее количество и использовано, но нет остатка
                if (subscriptionInfo.usedClasses > 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                }
                // Если есть общее количество и остаток, но нет использованных
                else if (subscriptionInfo.remainingClasses > 0 && subscriptionInfo.usedClasses === 0) {
                    subscriptionInfo.usedClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.remainingClasses);
                }
                // Если ни использовано, ни остаток не указаны
                else if (subscriptionInfo.usedClasses === 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = subscriptionInfo.totalClasses;
                }
            }
            
            // 4. Определяем статус
            const now = new Date();
            const isExpired = subscriptionInfo.expirationDate ? 
                new Date(subscriptionInfo.expirationDate) < now : false;
            const hasRemaining = subscriptionInfo.remainingClasses > 0;
            
            if (subscriptionInfo.isFrozen) {
                subscriptionInfo.subscriptionStatus = 'Абонемент заморожен';
                subscriptionInfo.subscriptionBadge = 'frozen';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (isExpired) {
                subscriptionInfo.subscriptionStatus = 'Абонемент истек';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (!hasRemaining && subscriptionInfo.usedClasses > 0) {
                subscriptionInfo.subscriptionStatus = 'Занятия закончились';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (hasRemaining && subscriptionInfo.usedClasses === 0) {
                subscriptionInfo.subscriptionStatus = `Купленный (${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
                subscriptionInfo.subscriptionBadge = 'has_subscription';
                subscriptionInfo.subscriptionActive = true;
            }
            else if (hasRemaining) {
                subscriptionInfo.subscriptionStatus = `Активный (осталось ${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
                subscriptionInfo.subscriptionBadge = 'active';
                subscriptionInfo.subscriptionActive = true;
            }
            else if (subscriptionInfo.totalClasses > 0) {
                subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий`;
                subscriptionInfo.subscriptionBadge = 'has_subscription';
                subscriptionInfo.subscriptionActive = true;
            }
            
            console.log(`📊 ИТОГ:`);
            console.log(`   • Всего: ${subscriptionInfo.totalClasses}`);
            console.log(`   • Использовано: ${subscriptionInfo.usedClasses}`);
            console.log(`   • Осталось: ${subscriptionInfo.remainingClasses}`);
            console.log(`   • Статус: ${subscriptionInfo.subscriptionStatus}`);
            console.log(`   • Филиал: ${subscriptionInfo.branch || 'не указан'}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации:', error);
        }
        
        return subscriptionInfo;
    }

    
    // 🔧 ДОБАВЛЕННЫЙ МЕТОД: parseDateOrTimestamp
    parseDateOrTimestamp(value) {
        if (!value) return null;
        
        try {
            const str = String(value).trim();
            
            // Если это timestamp (число)
            if (/^\d+$/.test(str)) {
                const timestamp = parseInt(str);
                // Проверяем, в секундах или миллисекундах
                const date = timestamp < 10000000000 
                    ? new Date(timestamp * 1000) // секунды -> миллисекунды
                    : new Date(timestamp); // уже миллисекунды
                
                return date.toISOString().split('T')[0]; // Возвращаем YYYY-MM-DD
            }
            
            // Если это уже дата в формате YYYY-MM-DD
            if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
                return str;
            }
            
            // Пытаемся распарсить как обычную дату
            return this.parseDate(str);
            
        } catch (error) {
            console.error('❌ Ошибка парсинга даты/таймстампа:', error);
            return value;
        }
    }
    
     // 🔧 УЛУЧШЕННЫЙ МЕТОД: extractStudentsFromContact
    extractStudentsFromContact(contact) {
        const students = [];
        
        try {
            const customFields = contact.custom_fields_values || [];
            const contactName = contact.name || '';
            
            console.log(`\n👤 Поиск детей в контакте: ${contactName}`);
            
            // Ищем все поля с детьми
            const childFields = [];
            const childBirthdayFields = [];
            
            // Проходим по всем полям для поиска детей
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                // Ищем поля с именами детей
                if ((fieldName.includes('ребен') || fieldName.includes('фио') || 
                     fieldName.includes('ученик')) && 
                    !fieldName.includes('день рождения') &&
                    !fieldName.includes('возраст') &&
                    !fieldName.includes('группа')) {
                    
                    childFields.push({
                        id: field.field_id || field.id,
                        name: field.name,
                        value: fieldValue
                    });
                }
                
                // Ищем поля с днями рождения детей
                if (fieldName.includes('день рождения') && fieldName.includes('ребен')) {
                    childBirthdayFields.push({
                        id: field.field_id || field.id,
                        name: field.name,
                        value: fieldValue
                    });
                }
            }
            
            // Создаем студентов из найденных полей
            childFields.forEach((childField, index) => {
                const student = {
                    studentName: childField.value,
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
                
                // Ищем день рождения для этого ребенка
                if (childBirthdayFields.length > index) {
                    student.birthDate = this.parseDate(childBirthdayFields[index].value);
                }
                
                // Ищем общие поля
                for (const field of customFields) {
                    const fieldName = this.getFieldName(field).toLowerCase();
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue || fieldValue.trim() === '') continue;
                    
                    if (fieldName.includes('филиал') || fieldName.includes('центр')) {
                        student.branch = fieldValue;
                    }
                    else if (fieldName.includes('преподаватель')) {
                        student.teacherName = fieldValue;
                    }
                    else if (fieldName.includes('день недел')) {
                        student.dayOfWeek = fieldValue;
                    }
                    else if (fieldName.includes('возраст') && fieldName.includes('групп')) {
                        student.ageGroup = fieldValue;
                    }
                    else if (fieldName.includes('аллерг') || fieldName.includes('особенност')) {
                        student.allergies = fieldValue;
                    }
                    else if (fieldName.includes('почта') || fieldName.includes('email')) {
                        student.email = fieldValue;
                    }
                }
                
                console.log(`   👶 Найден ребенок ${index + 1}: ${student.studentName}`);
                students.push(student);
            });
            
            console.log(`📊 Всего детей: ${students.length}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения учеников:', error);
        }
        
        return students;
    }
    // 🔧 УЛУЧШЕННЫЙ МЕТОД: getStudentsByPhone
    async getStudentsByPhone(phoneNumber) {
        console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ УЧЕНИКОВ: ${phoneNumber}`);
        
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
            
            if (contacts.length === 0) {
                console.log('❌ Контакты не найдены');
                return studentProfiles;
            }
            
            for (const contact of contacts) {
                console.log(`\n👤 Анализ контакта: ${contact.name} (ID: ${contact.id})`);
                
                // 2. Получаем полную информацию о контакте
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                // 3. Извлекаем детей
                const children = this.extractStudentsFromContact(fullContact);
                console.log(`📊 Найдено детей: ${children.length}`);
                
                if (children.length === 0) {
                    // Если детей не нашли, создаем одного "ученика" из данных контакта
                    console.log('⚠️  Дети не найдены, создаем профиль из данных контакта');
                    const child = {
                        studentName: fullContact.name || 'Ученик',
                        parentName: fullContact.name,
                        branch: '',
                        email: this.findEmail(fullContact)
                    };
                    children.push(child);
                }
                
                // 4. Получаем сделки контакта
                console.log('🔍 Получение сделок...');
                const leads = await this.getContactLeadsSorted(fullContact.id);
                console.log(`📊 Найдено сделок: ${leads.length}`);
                
                // 5. Для каждого ребенка создаем профиль
                for (const child of children) {
                    console.log(`\n👤 Поиск абонемента для: ${child.studentName}`);
                    
                    // Ищем лучшую сделку
                    let bestLead = this.findBestLeadForStudent(child.studentName, leads);
                    
                    // Если не нашли подходящую сделку, берем первую активную
                    if (!bestLead && leads.length > 0) {
                        console.log('🔍 Поиск любой подходящей сделки...');
                        bestLead = leads.find(lead => {
                            const name = lead.name || '';
                            return name.includes('Абонемент') || name.includes('занят');
                        }) || leads[0];
                    }
                    
                    // Извлекаем информацию об абонементе
                    const subscriptionInfo = bestLead ? 
                        this.extractSubscriptionInfo(bestLead) : 
                        this.extractSubscriptionInfo(null);
                    
                    // Объединяем данные из контакта и абонемента
                    const finalProfile = this.createStudentProfile(
                        fullContact,
                        phoneNumber,
                        child,
                        subscriptionInfo,
                        bestLead
                    );
                    
                    studentProfiles.push(finalProfile);
                    console.log(`✅ Профиль создан: ${child.studentName}`);
                }
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${studentProfiles.length}`);
            
        } catch (error) {
            console.error(`❌ Ошибка получения данных:`, error.message);
        }
        
        return studentProfiles;
    }
 
    async getContactLeadsSorted(contactId) {
        try {
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&order[created_at]=desc&limit=50`
            );
            
            return response._embedded?.leads || [];
        } catch (error) {
            console.error(`⚠️  Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    extractStudentNameFromLead(lead) {
        try {
            const customFields = lead.custom_fields_values || [];
            const leadName = lead.name || '';
            
            // Ищем имя ученика в полях сделки
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (fieldValue && (fieldName.includes('ученик') || 
                                   fieldName.includes('ребен') || 
                                   fieldName.includes('фио'))) {
                    return fieldValue;
                }
            }
            
            // Если не нашли в полях, используем название сделки
            return leadName;
        } catch (error) {
            console.error('❌ Ошибка извлечения имени из сделки:', error);
            return '';
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
                const fieldId = field.field_id || field.id;
                const fieldValue = this.getFieldValue(field);
                
                // Ищем поле email по ID или по названию
                if ((fieldId === this.FIELD_IDS.CONTACT.EMAIL || 
                     this.getFieldName(field).includes('email') || 
                     this.getFieldName(field).includes('почта')) && 
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

 // 🔧 УЛУЧШЕННЫЙ МЕТОД: findBestLeadForStudent
    findBestLeadForStudent(studentName, leads) {
        if (!leads || leads.length === 0) return null;
        
        console.log(`🔍 Поиск сделки для: ${studentName}`);
        
        // Сортируем сделки по релевантности
        const scoredLeads = leads.map(lead => {
            let score = 0;
            const leadName = lead.name || '';
            const leadNameLower = leadName.toLowerCase();
            
            // Высший приоритет: активные абонементы
            if (leadName.includes('!Абонемент') || leadName.includes('Активный абонемент')) {
                score += 100;
            }
            
            // Совпадение имени ученика
            const studentFirstName = studentName.split(' ')[0] || '';
            if (studentFirstName && leadName.includes(studentFirstName)) {
                score += 50;
            }
            
            // Присутствие слова "абонемент"
            if (leadNameLower.includes('абонемент')) {
                score += 30;
            }
            
            // Присутствие числа занятий
            if (leadNameLower.match(/\d+\s*занят/)) {
                score += 20;
            }
            
            // Минус за архивные/завершенные
            if (leadNameLower.includes('архив') || leadNameLower.includes('завершен') || 
                leadNameLower.includes('закончился')) {
                score -= 50;
            }
            
            return { lead, score };
        });
        
        // Сортируем по убыванию баллов
        scoredLeads.sort((a, b) => b.score - a.score);
        
        if (scoredLeads.length > 0 && scoredLeads[0].score > 0) {
            const bestLead = scoredLeads[0].lead;
            console.log(`✅ Найдена сделка: "${bestLead.name.substring(0, 50)}..."`);
            console.log(`📊 Балл: ${scoredLeads[0].score}`);
            return bestLead;
        }
        
        console.log('⚠️  Подходящая сделка не найдена');
        return null;
    }

    // 🔧 ДОПОЛНИТЕЛЬНЫЕ МЕТОДЫ (остаются без изменений, но используют новые FIELD_IDS)
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

// 🔧 МЕТОД: findBestLeadFallback - запасной вариант
findBestLeadFallback(studentName, leads) {
    console.log(`🔍 Запасной поиск среди всех сделок...`);
    
    let bestLead = null;
    let bestScore = 0;
    
    for (const lead of leads) {
        let score = 0;
        const leadName = lead.name || '';
        
        // Пропускаем явно неподходящие
        if (leadName.includes('Рассылка') || leadName.includes('Успешные') || 
            leadName.includes('Архив') || leadName.match(/^\d+\s*₽/)) {
            continue;
        }
        
        // Проверяем наличие слова "абонемент"
        if (leadName.toLowerCase().includes('абонемент')) {
            score += 50;
        }
        
        // Проверяем совпадение имени
        const studentFirstName = studentName.split(' ')[0] || '';
        if (studentFirstName && leadName.includes(studentFirstName)) {
            score += 30;
        }
        
        // Проверяем наличие занятий в названии
        if (leadName.match(/\d+\s*занят/)) {
            score += 20;
        }
        
        if (score > bestScore) {
            bestScore = score;
            bestLead = lead;
        }
    }
    
    if (bestLead) {
        console.log(`✅ Найдена сделка: "${bestLead.name.substring(0, 50)}..."`);
    }
    
    return bestLead;
}


// 🔧 МЕТОД: parseLeadNameForSubscription - ИСПРАВЛЕННЫЙ
parseLeadNameForSubscription(leadName) {
    if (!leadName) return 0;
    
    try {
        console.log(`🔍 Парсинг названия сделки: "${leadName}"`);
        
        // Пропускаем названия с ID сделок (начинаются с "#" или "Сделка #")
        if (leadName.includes('#') || leadName.toLowerCase().includes('сделка')) {
            console.log('⏭️  Пропускаем название с ID сделки');
            return 0;
        }
        
        // Приводим к нижнему регистру
        const lowerName = leadName.toLowerCase().trim();
        
        // Слова-фильтры: пропускаем эти слова в начале названия
        const skipPatterns = [
            /^рассылка\s/i,
            /^успешн/i,
            /^архивн/i,
            /^отменен/i,
            /^не\s+актив/i,
            /^закончил/i,
            /^завершён/i,
            /^\d+\s*₽/i, // Цена в начале
        ];
        
        for (const pattern of skipPatterns) {
            if (pattern.test(leadName)) {
                console.log('⏭️  Пропускаем по фильтру:', pattern);
                return 0;
            }
        }
        
        // Теперь ищем количество занятий
        const patterns = [
            // Основные паттерны
            { pattern: /(\d+)\s*(?:занят|урок)/i, desc: 'число занятий' },
            { pattern: /16\s*(?:занят|урок)/i, desc: '16 занятий' },
            { pattern: /8\s*(?:занят|урок)/i, desc: '8 занятий' },
            { pattern: /4\s*(?:занят|урок)/i, desc: '4 занятия' },
            { pattern: /24\s*(?:занят|урок)/i, desc: '24 занятия' },
            { pattern: /12\s*(?:занят|урок)/i, desc: '12 занятий' },
            
            // Число в конце названия (но не цена)
            { pattern: /-?\s*(\d{1,2})\s*(?:занят|урок)?\s*$/i, desc: 'число в конце' },
            
            // Число после дефиса
            { pattern: /-\s*(\d{1,2})\s*(?:занят|урок)?/i, desc: 'число после дефиса' },
        ];
        
        for (const { pattern, desc } of patterns) {
            const match = lowerName.match(pattern);
            if (match && match[1]) {
                const num = parseInt(match[1]);
                if (num >= 1 && num <= 30) { // Разумный диапазон для занятий
                    console.log(`✅ Найдено (${desc}): ${num} занятий`);
                    return num;
                }
            }
        }
        
        // Ищем просто число (но проверяем, что это не цена и не ID)
        const numberMatch = lowerName.match(/\b(\d{1,2})\b(?!\s*₽)/);
        if (numberMatch) {
            const num = parseInt(numberMatch[1]);
            // Проверяем, что это типичное количество занятий
            const typicalClasses = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24];
            if (typicalClasses.includes(num)) {
                console.log(`✅ Найдено типичное число: ${num} занятий`);
                return num;
            }
        }
        
        console.log(`❌ Не удалось определить количество занятий`);
        return 0;
        
    } catch (error) {
        console.error('❌ Ошибка парсинга названия:', error);
        return 0;
    }
}

    // 🔧 МЕТОД: debugSubscriptionFields
debugSubscriptionFields(customFields) {
    console.log('\n🔧 ДИАГНОСТИКА ПОЛЕЙ АБОНЕМЕНТА');
    console.log('=' .repeat(50));
    
    const subscriptionFieldIds = [
        this.FIELD_IDS.LEAD.TOTAL_CLASSES,
        this.FIELD_IDS.LEAD.USED_CLASSES, 
        this.FIELD_IDS.LEAD.REMAINING_CLASSES,
        this.FIELD_IDS.LEAD.EXPIRATION_DATE,
        this.FIELD_IDS.LEAD.ACTIVATION_DATE,
        this.FIELD_IDS.LEAD.LAST_VISIT_DATE,
        this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE,
        this.FIELD_IDS.LEAD.FREEZE
    ];
    
    subscriptionFieldIds.forEach(fieldId => {
        const field = customFields.find(f => (f.field_id || f.id) === fieldId);
        if (field) {
            const value = this.getFieldValue(field);
            console.log(`✅ Поле ${fieldId}: "${value}"`);
        } else {
            console.log(`❌ Поле ${fieldId}: не найдено`);
        }
    });
    
    // Ищем чекбоксы посещений
    const checkboxFields = customFields.filter(f => {
        const fieldId = f.field_id || f.id;
        return [
            this.FIELD_IDS.LEAD.CLASS_1, this.FIELD_IDS.LEAD.CLASS_2,
            this.FIELD_IDS.LEAD.CLASS_3, this.FIELD_IDS.LEAD.CLASS_4,
            this.FIELD_IDS.LEAD.CLASS_5, this.FIELD_IDS.LEAD.CLASS_6,
            this.FIELD_IDS.LEAD.CLASS_7, this.FIELD_IDS.LEAD.CLASS_8,
            this.FIELD_IDS.LEAD.CLASS_9, this.FIELD_IDS.LEAD.CLASS_10,
            this.FIELD_IDS.LEAD.CLASS_11, this.FIELD_IDS.LEAD.CLASS_12,
            this.FIELD_IDS.LEAD.CLASS_13, this.FIELD_IDS.LEAD.CLASS_14,
            this.FIELD_IDS.LEAD.CLASS_15, this.FIELD_IDS.LEAD.CLASS_16
        ].includes(fieldId);
    });
    
    const visitedClasses = checkboxFields.filter(f => {
        const value = this.getFieldValue(f);
        return value && value.toLowerCase() === 'да';
    }).length;
    
    console.log(`📊 Чекбоксы посещений: ${visitedClasses} из ${checkboxFields.length}`);
}
    
    // 🔧 ОБНОВЛЕННЫЙ МЕТОД: createStudentProfile
    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        // Определяем email
        const email = studentInfo.email || this.findEmail(contact);
        
        // Форматируем даты для отображения
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
            last_visit_date: studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate || null,
            
            // Форматированные даты для отображения
            expiration_date_display: formatDisplayDate(subscriptionInfo.expirationDate),
            activation_date_display: formatDisplayDate(subscriptionInfo.activationDate),
            last_visit_date_display: formatDisplayDate(studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate),
            
            // Технические данные
            custom_fields: JSON.stringify(contact.custom_fields_values || []),
            raw_contact_data: JSON.stringify(contact),
            lead_data: lead ? JSON.stringify(lead) : '{}',
            is_demo: 0,
            source: 'amocrm',
            is_active: 1,
            last_sync: new Date().toISOString()
        };
        
        console.log(`📊 Создан профиль ученика:`);
        console.log(`   👤 ${profile.student_name}`);
        console.log(`   👨‍👩‍👧 Родитель: ${profile.parent_name || 'не указан'}`);
        console.log(`   📍 Филиал: ${profile.branch || 'не указан'}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        console.log(`   📊 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        console.log(`   📅 Активация: ${profile.activation_date_display || 'не указано'}`);
        console.log(`   📅 Окончание: ${profile.expiration_date_display || 'не указано'}`);
        console.log(`   ✅ Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
        
        return profile;
    }
}

// Создаем экземпляр сервиса amoCRM (удален дублирующий код)
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
        
        // Первая синхронизация при запуске
        await this.syncAllProfiles();
        
        // Запускаем периодическую синхронизацию
        setInterval(async () => {
            await this.syncAllProfiles();
        }, 10 * 60 * 1000); // 10 минут
    }

    async syncAllProfiles() {
        if (this.isSyncing) {
            console.log('⚠️  Синхронизация уже выполняется, пропускаем');
            return;
        }

        this.isSyncing = true;
        const startTime = Date.now();
        const syncId = `sync_${new Date().toISOString().replace(/[^0-9]/g, '')}`;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔄 ЗАПУСК СИНХРОНИЗАЦИИ: ${syncId}`);
        console.log(`⏰ Время: ${new Date().toISOString()}`);
        console.log('='.repeat(80));

        try {
            // Получаем все уникальные номера телефонов из базы
            const phones = await db.all(
                `SELECT DISTINCT phone_number FROM student_profiles WHERE is_active = 1`
            );

            console.log(`📊 Найдено уникальных телефонов: ${phones.length}`);

            let totalUpdated = 0;
            let totalErrors = 0;

            // Для каждого телефона обновляем данные
            for (const phoneRow of phones) {
                const phone = phoneRow.phone_number;
                
                try {
                    console.log(`\n🔍 Синхронизация для телефона: ${phone}`);
                    
                    // Получаем актуальные данные из amoCRM
                    const profiles = await amoCrmService.getStudentsByPhone(phone);
                    
                    // Сохраняем в базу
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

            // Логируем результат синхронизации
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

    async syncSinglePhone(phoneNumber) {
        console.log(`\n🔧 РУЧНАЯ СИНХРОНИЗАЦИЯ ТЕЛЕФОНА: ${phoneNumber}`);
        
        try {
            // Получаем актуальные данные из amoCRM
            const profiles = await amoCrmService.getStudentsByPhone(phoneNumber);
            
            // Сохраняем в базу
            const savedCount = await saveProfilesToDatabase(profiles);
            
            console.log(`✅ Синхронизация завершена`);
            console.log(`📊 Обновлено профилей: ${savedCount}`);
            
            return {
                success: true,
                phone: phoneNumber,
                profiles_updated: savedCount,
                total_profiles: profiles.length
            };
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации:', error.message);
            return {
                success: false,
                phone: phoneNumber,
                error: error.message
            };
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

// Создаем сервис синхронизации
const syncService = new SyncService();

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

// 🔧 Обновите метод saveProfilesToDatabase
async function saveProfilesToDatabase(profiles) {
    try {
        console.log(`💾 Сохранение профилей в БД...`);
        let savedCount = 0;
        
        for (const profile of profiles) {
            try {
                // Генерируем уникальный ключ для поиска
                const searchKey = `${profile.student_name}|${profile.phone_number}|${profile.branch || ''}`;
                
                // Ищем существующий профиль
                const existingProfile = await db.get(
                    `SELECT id FROM student_profiles 
                     WHERE student_name = ? AND phone_number = ?`,
                    [profile.student_name, profile.phone_number]
                );
                
                const columns = [
                    'amocrm_contact_id', 'parent_contact_id', 'amocrm_lead_id', 'student_name', 'phone_number', 'email',
                    'birth_date', 'branch', 'day_of_week', 'time_slot', 'teacher_name', 'age_group', 'course', 'allergies',
                    'parent_name', 'subscription_type', 'subscription_active', 'subscription_status', 'subscription_badge',
                    'total_classes', 'used_classes', 'remaining_classes', 'expiration_date', 
                    'activation_date', 'last_visit_date', 'custom_fields', 
                    'raw_contact_data', 'lead_data', 'is_demo', 'source', 'is_active', 'last_sync'
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
                    1,
                    new Date().toISOString()
                ];
                
                if (!existingProfile) {
                    // Вставка нового профиля
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    const result = await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    
                    console.log(`✅ Профиль создан (ID: ${result.lastID}): ${profile.student_name}`);
                    savedCount++;
                } else {
                    // Обновление существующего профиля
                    const setClause = columns.map(col => `${col} = ?`).join(', ');
                    
                    await db.run(
                        `UPDATE student_profiles SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [...values, existingProfile.id]
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
        version: '4.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        sync_status: syncService.getSyncStatus(),
        data_source: 'Актуальные данные из amoCRM'
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
        
        // Получаем актуальные данные из amoCRM
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
        
        // Если не нашли профилей
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
            is_demo: p.is_demo === 0 ? false : true, // Всегда false, так как только реальные данные
            source: p.source,
            last_sync: p.last_sync
        }));
        
        // Определяем, есть ли несколько учеников
        const hasMultipleStudents = profiles.length > 1;
        
        // Формируем ответ
        const responseData = {
            success: true,
            message: profiles.length > 0 
                ? 'Найдены профили учеников'
                : 'Профили не найдены',
            data: {
                user: tempUser,
                profiles: responseProfiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                has_real_data: true, // Всегда true, так как только реальные данные
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

// 🔧 ИСПРАВЬТЕ метод в server.js для обработки /api/subscription
app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id, phone } = req.body;
        
        console.log(`\n📋 ЗАПРОС АБОНЕМЕНТА`);
        console.log(`📌 profile_id: ${profile_id}`);
        console.log(`📌 phone: ${phone}`);
        
        let profile;
        
        if (profile_id) {
            // Ищем профиль по ID в базе
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE id = ?`,
                [parseInt(profile_id)]
            );
            
            if (profile) {
                console.log(`✅ Найден профиль в БД: ${profile.student_name}`);
            } else {
                console.log(`❌ Профиль ${profile_id} не найден в БД`);
                
                // Если profile_id начинается с "profile-", это временный ID из фронтенда
                if (profile_id.startsWith('profile-')) {
                    const index = parseInt(profile_id.replace('profile-', ''));
                    console.log(`🔍 Это временный ID, индекс: ${index}`);
                    
                    // Ищем по телефону и имени ученика
                    if (phone) {
                        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
                        const profiles = await db.all(
                            `SELECT * FROM student_profiles 
                             WHERE phone_number LIKE ? AND is_active = 1 
                             ORDER BY subscription_active DESC, updated_at DESC`,
                            [`%${cleanPhone}%`]
                        );
                        
                        if (profiles.length > index) {
                            profile = profiles[index];
                            console.log(`✅ Найден профиль по индексу: ${profile.student_name}`);
                        }
                    }
                }
            }
        } 
        
        // Если не нашли по profile_id, ищем по телефону
        if (!profile && phone) {
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
        console.log(`📊 Последняя синхронизация: ${profile.last_sync}`);
        
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

// Проверка связи с amoCRM
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
        
        // Проверяем доступность API
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
                service_initialized: amoCrmService.isInitialized
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

// Получение всех полей сделок (для проверки ID полей)
app.get('/api/debug/lead-fields', async (req, res) => {
    try {
        console.log('\n📋 ПОЛУЧЕНИЕ ВСЕХ ПОЛЕЙ СДЕЛОК');
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        const fields = await amoCrmService.makeRequest('GET', '/api/v4/leads/custom_fields');
        
        const subscriptionFields = [];
        const allFields = [];
        
        if (fields && fields._embedded && fields._embedded.custom_fields) {
            fields._embedded.custom_fields.forEach(field => {
                const fieldInfo = {
                    id: field.id,
                    name: field.name,
                    type: field.type,
                    enums: field.enums || []
                };
                
                allFields.push(fieldInfo);
                
                // Ищем поля абонементов
                if (field.name.toLowerCase().includes('абонемент') || 
                    field.name.toLowerCase().includes('занят') || 
                    field.name.toLowerCase().includes('счетчик') ||
                    field.name.toLowerCase().includes('остаток')) {
                    subscriptionFields.push(fieldInfo);
                }
            });
        }
        
        res.json({
            success: true,
            message: 'Поля успешно получены',
            timestamp: new Date().toISOString(),
            data: {
                total_fields: allFields.length,
                subscription_fields_count: subscriptionFields.length,
                subscription_fields: subscriptionFields,
                your_field_ids: amoCrmService.FIELD_IDS.LEAD,
                all_fields: allFields.slice(0, 50) // Ограничиваем вывод
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения полей:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения полей',
            error: error.message
        });
    }
});

// Проверка телефона - основной диагностический маршрут
app.get('/api/debug/phone/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n📱 ДИАГНОСТИКА ТЕЛЕФОНА: ${phone}`);
        console.log('='.repeat(80));
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован',
                phone: phone
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`📱 Форматированный номер: ${formattedPhone}`);
        
        // 1. Ищем контакты
        console.log('\n🔍 Поиск контактов...');
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        const contactsInfo = contacts.map(contact => ({
            id: contact.id,
            name: contact.name,
            created_at: contact.created_at,
            updated_at: contact.updated_at,
            fields_count: contact.custom_fields_values ? contact.custom_fields_values.length : 0
        }));
        
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        // 2. Получаем профили учеников
        console.log('\n🎯 Получение профилей учеников...');
        const profiles = await amoCrmService.getStudentsByPhone(phone);
        
        const profilesInfo = profiles.map(profile => ({
            student_name: profile.student_name,
            branch: profile.branch,
            subscription_status: profile.subscription_status,
            total_classes: profile.total_classes,
            used_classes: profile.used_classes,
            remaining_classes: profile.remaining_classes,
            expiration_date: profile.expiration_date,
            subscription_active: profile.subscription_active === 1
        }));
        
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        // 3. Проверяем наличие в локальной базе
        console.log('\n💾 Проверка локальной базы...');
        const cleanPhone = phone.replace(/\D/g, '');
        const localProfiles = await db.all(
            `SELECT student_name, branch, subscription_status, total_classes, remaining_classes, last_sync 
             FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        
        res.json({
            success: true,
            message: 'Диагностика выполнена успешно',
            timestamp: new Date().toISOString(),
            data: {
                phone: {
                    original: phone,
                    formatted: formattedPhone,
                    clean: cleanPhone
                },
                contacts: {
                    count: contacts.length,
                    items: contactsInfo
                },
                profiles: {
                    count: profiles.length,
                    items: profilesInfo
                },
                local_database: {
                    count: localProfiles.length,
                    items: localProfiles
                },
                system_status: {
                    amocrm_connected: amoCrmService.isInitialized,
                    sync_status: syncService.getSyncStatus(),
                    last_sync: localProfiles.length > 0 ? localProfiles[0].last_sync : null
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики телефона:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка диагностики',
            error: error.message,
            phone: req.params.phone
        });
    }
});

// 🔧 ДОПОЛНИТЕЛЬНЫЙ ДИАГНОСТИЧЕСКИЙ МАРШРУТ
app.get('/api/debug/contact-details/:id', async (req, res) => {
    try {
        const contactId = req.params.id;
        
        console.log(`\n🔍 ПОДРОБНАЯ ДИАГНОСТИКА КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        // Получаем полную информацию о контакте
        const contact = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/contacts/${contactId}?with=custom_fields_values`
        );
        
        // Извлекаем учеников
        const students = amoCrmService.extractStudentsFromContact(contact);
        
        // Получаем все поля контакта
        const fields = [];
        if (contact.custom_fields_values) {
            contact.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                
                fields.push({
                    id: fieldId,
                    name: fieldName,
                    value: fieldValue,
                    raw: field.values
                });
            });
        }
        
        // Ищем email
        const email = amoCrmService.findEmail(contact);
        
        // Получаем сделки контакта
        const leadsResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&order[created_at]=desc&limit=5`
        );
        
        const leads = leadsResponse._embedded?.leads || [];
        
        // Анализируем абонементы в сделках
        const subscriptions = [];
        leads.forEach(lead => {
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            if (subscriptionInfo.hasSubscription) {
                subscriptions.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    created_at: lead.created_at,
                    status_id: lead.status_id,
                    subscription: subscriptionInfo
                });
            }
        });
        
        res.json({
            success: true,
            message: 'Детальная диагностика контакта',
            timestamp: new Date().toISOString(),
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name,
                    created_at: contact.created_at,
                    updated_at: contact.updated_at,
                    responsible_user_id: contact.responsible_user_id,
                    email: email
                },
                students: {
                    count: students.length,
                    items: students
                },
                fields: {
                    total: fields.length,
                    items: fields
                },
                leads: {
                    count: leads.length,
                    items: leads.map(lead => ({
                        id: lead.id,
                        name: lead.name,
                        created_at: lead.created_at,
                        status_id: lead.status_id,
                        pipeline_id: lead.pipeline_id
                    }))
                },
                subscriptions: {
                    count: subscriptions.length,
                    items: subscriptions
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка детальной диагностики:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка диагностики',
            error: error.message,
            contact_id: req.params.id
        });
    }
});

// 🔧 МАРШРУТ ДЛЯ ПРОВЕРКИ БАЗЫ ДАННЫХ
app.get('/api/debug/database-status', async (req, res) => {
    try {
        console.log('\n💾 ПРОВЕРКА БАЗЫ ДАННЫХ');
        
        // Получаем статистику
        const stats = await db.all(`
            SELECT 
                (SELECT COUNT(*) FROM student_profiles) as total_profiles,
                (SELECT COUNT(*) FROM student_profiles WHERE subscription_active = 1) as active_subscriptions,
                (SELECT COUNT(*) FROM student_profiles WHERE is_active = 1) as active_profiles,
                (SELECT COUNT(DISTINCT phone_number) FROM student_profiles) as unique_phones,
                (SELECT COUNT(*) FROM sync_logs) as total_syncs,
                (SELECT MAX(last_sync) FROM student_profiles WHERE last_sync IS NOT NULL) as last_profile_sync
        `);
        
        // Получаем последние 5 профилей
        const recentProfiles = await db.all(`
            SELECT 
                id, student_name, phone_number, branch, 
                subscription_status, total_classes, remaining_classes,
                last_sync, created_at, updated_at
            FROM student_profiles 
            ORDER BY updated_at DESC 
            LIMIT 5
        `);
        
        // Получаем последние 5 синхронизаций
        const recentSyncs = await db.all(`
            SELECT 
                id, sync_type, items_count, success_count, error_count,
                duration_ms, created_at
            FROM sync_logs 
            ORDER BY created_at DESC 
            LIMIT 5
        `);
        
        res.json({
            success: true,
            message: 'Статус базы данных',
            timestamp: new Date().toISOString(),
            data: {
                statistics: stats[0] || {},
                recent_profiles: recentProfiles,
                recent_syncs: recentSyncs,
                database_path: process.env.NODE_ENV === 'production' ? 'data/art_school.db' : ':memory:',
                total_tables: 3
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки базы данных:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка проверки базы',
            error: error.message
        });
    }
});

// Проверка конкретной сделки
app.get('/api/debug/lead/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        
        console.log(`\n📋 ДИАГНОСТИКА СДЕЛКИ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        const fields = [];
        if (lead.custom_fields_values) {
            lead.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                
                fields.push({
                    id: fieldId,
                    name: fieldName,
                    value: fieldValue,
                    is_subscription_field: [
                        850241, 850257, 890163, 850255, 851565, 891007
                    ].includes(fieldId)
                });
            });
        }
        
        res.json({
            success: true,
            message: 'Сделка получена',
            timestamp: new Date().toISOString(),
            data: {
                lead: {
                    id: lead.id,
                    name: lead.name,
                    status_id: lead.status_id,
                    pipeline_id: lead.pipeline_id,
                    created_at: lead.created_at,
                    updated_at: lead.updated_at,
                    is_closed: [142, 143].includes(lead.status_id)
                },
                subscription: subscriptionInfo,
                fields: {
                    count: fields.length,
                    subscription_fields: fields.filter(f => f.is_subscription_field),
                    all_fields: fields
                },
                subscription_active: subscriptionInfo.subscriptionActive,
                has_subscription: subscriptionInfo.hasSubscription
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики сделки:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения сделки',
            error: error.message,
            lead_id: req.params.id
        });
    }
});

// Проверка конкретного контакта
app.get('/api/debug/contact/:id', async (req, res) => {
    try {
        const contactId = req.params.id;
        
        console.log(`\n👤 ДИАГНОСТИКА КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        const contact = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/contacts/${contactId}?with=custom_fields_values`
        );
        
        const students = amoCrmService.extractStudentsFromContact(contact);
        
        const fields = [];
        if (contact.custom_fields_values) {
            contact.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                
                fields.push({
                    id: fieldId,
                    name: fieldName,
                    value: fieldValue,
                    is_child_field: [
                        867233, 867687, 867235, 867685, 867733, 867735
                    ].includes(fieldId)
                });
            });
        }
        
        // Получаем сделки контакта
        const leadsResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&limit=10`
        );
        
        const leads = leadsResponse._embedded?.leads || [];
        
        res.json({
            success: true,
            message: 'Контакт получен',
            timestamp: new Date().toISOString(),
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name,
                    created_at: contact.created_at,
                    updated_at: contact.updated_at
                },
                students: {
                    count: students.length,
                    items: students
                },
                fields: {
                    count: fields.length,
                    child_fields: fields.filter(f => f.is_child_field),
                    all_fields: fields
                },
                leads: {
                    count: leads.length,
                    items: leads.map(lead => ({
                        id: lead.id,
                        name: lead.name,
                        status_id: lead.status_id,
                        has_subscription_fields: lead.custom_fields_values?.some(f => 
                            [850241, 850257, 890163].includes(f.field_id || f.id)
                        )
                    }))
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики контакта:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения контакта',
            error: error.message,
            contact_id: req.params.id
        });
    }
});

// Статус системы
app.get('/api/debug/system-status', async (req, res) => {
    try {
        console.log('\n⚙️  СТАТУС СИСТЕМЫ');
        
        // Статистика базы данных
        const dbStats = await db.all(`
            SELECT 
                (SELECT COUNT(*) FROM student_profiles) as total_profiles,
                (SELECT COUNT(*) FROM student_profiles WHERE subscription_active = 1) as active_subscriptions,
                (SELECT COUNT(*) FROM student_profiles WHERE is_active = 1) as active_profiles,
                (SELECT COUNT(DISTINCT phone_number) FROM student_profiles) as unique_phones,
                (SELECT COUNT(*) FROM sync_logs) as total_syncs
        `);
        
        const lastSync = await db.get(
            `SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 1`
        );
        
        res.json({
            success: true,
            message: 'Статус системы',
            timestamp: new Date().toISOString(),
            data: {
                system: {
                    uptime: process.uptime(),
                    memory_usage: process.memoryUsage(),
                    node_version: process.version,
                    platform: process.platform
                },
                amocrm: {
                    connected: amoCrmService.isInitialized,
                    account_name: amoCrmService.accountInfo?.name || null,
                    subdomain: AMOCRM_SUBDOMAIN,
                    fields_loaded: amoCrmService.fieldMappings.size
                },
                database: dbStats[0] || {},
                synchronization: {
                    status: syncService.getSyncStatus(),
                    last_sync: lastSync
                },
                endpoints: {
                    main_auth: `${DOMAIN}/api/auth/phone`,
                    get_subscription: `${DOMAIN}/api/subscription`,
                    check_phone: `${DOMAIN}/api/debug/phone/79175161115`,
                    connection_test: `${DOMAIN}/api/debug/connection`,
                    system_status: `${DOMAIN}/api/debug/system-status`
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статуса системы:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения статуса',
            error: error.message
        });
    }
});

// ==================== API СИНХРОНИЗАЦИИ ====================

app.get('/api/sync/status', async (req, res) => {
    try {
        const status = syncService.getSyncStatus();
        
        // Получаем статистику из логов
        const lastSync = await db.get(
            `SELECT * FROM sync_logs 
             WHERE sync_type = 'auto_sync' 
             ORDER BY created_at DESC LIMIT 1`
        );
        
        const syncStats = await db.get(
            `SELECT 
                COUNT(*) as total_syncs,
                SUM(success_count) as total_success,
                SUM(error_count) as total_errors,
                AVG(duration_ms) as avg_duration
             FROM sync_logs 
             WHERE sync_type = 'auto_sync'`
        );
        
        res.json({
            success: true,
            data: {
                sync_status: status,
                last_sync: lastSync || null,
                statistics: syncStats || null,
                total_profiles: await db.get(`SELECT COUNT(*) as count FROM student_profiles WHERE is_active = 1`),
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

app.post('/api/sync/phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`\n🔧 РУЧНАЯ СИНХРОНИЗАЦИЯ ДЛЯ ТЕЛЕФОНА: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const result = await syncService.syncSinglePhone(phone);
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Ошибка ручной синхронизации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка синхронизации'
        });
    }
});

// ==================== ДОПОЛНИТЕЛЬНЫЕ API ====================

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
                    usage_percentage: progress,
                    last_sync: profile.last_sync
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

app.get('/api/crm/status', async (req, res) => {
    try {
        const isValid = amoCrmService.isInitialized;
        
        res.json({
            success: true,
            data: {
                connected: isValid,
                account_name: amoCrmService.accountInfo?.name || null,
                subdomain: AMOCRM_SUBDOMAIN,
                last_check: new Date().toISOString(),
                field_count: amoCrmService.fieldMappings.size
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

// ==================== ПРОДОЛЖЕНИЕ server.js (добавить перед startServer) ====================

// 📍 ПРОФИЛЬ ПО ID
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
                    usage_percentage: progress,
                    last_sync: profile.last_sync
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

// 📍 ВСЕ ПРОФИЛИ ПОЛЬЗОВАТЕЛЯ
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

// 📍 ПРОВЕРКА ЗДОРОВЬЯ
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

// 📍 СТАТУС CRM
app.get('/api/crm/status', async (req, res) => {
    try {
        const isValid = amoCrmService.isInitialized;
        
        res.json({
            success: true,
            data: {
                connected: isValid,
                account_name: amoCrmService.accountInfo?.name || null,
                subdomain: AMOCRM_SUBDOMAIN,
                last_check: new Date().toISOString(),
                field_count: amoCrmService.fieldMappings.size
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

// 📍 СТАТУС СИНХРОНИЗАЦИИ
app.get('/api/sync/status', async (req, res) => {
    try {
        const status = syncService.getSyncStatus();
        
        const lastSync = await db.get(
            `SELECT * FROM sync_logs 
             WHERE sync_type = 'auto_sync' 
             ORDER BY created_at DESC LIMIT 1`
        );
        
        const syncStats = await db.get(
            `SELECT 
                COUNT(*) as total_syncs,
                SUM(success_count) as total_success,
                SUM(error_count) as total_errors,
                AVG(duration_ms) as avg_duration
             FROM sync_logs 
             WHERE sync_type = 'auto_sync'`
        );
        
        res.json({
            success: true,
            data: {
                sync_status: status,
                last_sync: lastSync || null,
                statistics: syncStats || null,
                total_profiles: await db.get(`SELECT COUNT(*) as count FROM student_profiles WHERE is_active = 1`),
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

// 📍 РУЧНАЯ СИНХРОНИЗАЦИЯ ТЕЛЕФОНА
app.post('/api/sync/phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`\n🔧 РУЧНАЯ СИНХРОНИЗАЦИЯ ДЛЯ ТЕЛЕФОНА: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const result = await syncService.syncSinglePhone(phone);
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Ошибка ручной синхронизации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка синхронизации'
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v4.0');
        console.log('='.repeat(80));
        console.log('✨ ТОЛЬКО РЕАЛЬНЫЕ ДАННЫЕ ИЗ AMOCRM');
        console.log('✨ АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ КАЖДЫЕ 10 МИНУТ');
        console.log('✨ КОРРЕКТНЫЙ ПОИСК ПО ТЕЛЕФОНУ И ИМЕНИ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            
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
            console.log(`🔍 Профили пользователя: GET http://localhost:${PORT}/api/profiles`);
            console.log(`📋 Абонемент: POST http://localhost:${PORT}/api/subscription`);
            console.log(`🔄 Статус синхронизации: GET http://localhost:${PORT}/api/sync/status`);
            console.log(`🔧 Ручная синхронизация: POST http://localhost:${PORT}/api/sync/phone`);
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
