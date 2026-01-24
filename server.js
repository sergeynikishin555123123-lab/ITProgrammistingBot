// server.js - ИСПРАВЛЕННАЯ И ОПТИМИЗИРОВАННАЯ ВЕРСИЯ
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
        this.accountInfo = null;
        
        // ИЗВЕСТНЫЕ ID ПОЛЕЙ (заполняются при инициализации)
        this.FIELD_IDS = {
            LEAD: {
                TOTAL_CLASSES: null,
                USED_CLASSES: null,
                REMAINING_CLASSES: null,
                EXPIRATION_DATE: null,
                ACTIVATION_DATE: null,
                LAST_VISIT_DATE: null,
                SUBSCRIPTION_TYPE: null,
                BRANCH: null,
                AGE_GROUP: null,
                FREEZE: null,
                SUBSCRIPTION_OWNER: null
            },
            
            CONTACT: {
                CHILD_1_NAME: null,
                CHILD_2_NAME: null,
                CHILD_3_NAME: null,
                CHILD_1_BIRTHDAY: null,
                CHILD_2_BIRTHDAY: null,
                CHILD_3_BIRTHDAY: null,
                BRANCH: null,
                TEACHER: null,
                DAY_OF_WEEK: null,
                HAS_ACTIVE_SUB: null,
                LAST_VISIT: null,
                AGE_GROUP: null,
                ALLERGIES: null,
                BIRTH_DATE: null,
                PARENT_NAME: 'name',
                EMAIL: null
            }
        };
        
        this.fieldCache = {
            leadFields: new Map(),
            contactFields: new Map()
        };
    }

    async initialize() {
        try {
            if (!this.accessToken) {
                console.log('❌ Токен amoCRM не указан');
                return false;
            }
            
            console.log('🔍 Проверка валидности токена...');
            const isValid = await this.checkTokenValidity(this.accessToken);
            this.isInitialized = isValid;
            
            if (isValid) {
                await this.loadAndMapFields();
                this.printDebugInfo(); // ← ДОБАВЛЕН ВЫЗОВ ОТЛАДКИ
                console.log('✅ amoCRM успешно инициализирован');
            } else {
                console.log('❌ Токен amoCRM невалиден');
            }
            return isValid;
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            return false;
        }
    }

    async loadAndMapFields() {
        try {
            console.log('📋 Загрузка и маппинг полей amoCRM...');
            
            const [leadFields, contactFields] = await Promise.all([
                this.makeRequest('GET', '/api/v4/leads/custom_fields'),
                this.makeRequest('GET', '/api/v4/contacts/custom_fields')
            ]);
            
            await this.mapLeadFields(leadFields);
            await this.mapContactFields(contactFields);
            
            this.printFieldMapping();
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка загрузки полей:', error.message);
            return false;
        }
    }

    async mapLeadFields(fieldsResponse) {
        if (!fieldsResponse?._embedded?.custom_fields) {
            console.log('⚠️  Поля сделок не найдены');
            return;
        }
        
        const fields = fieldsResponse._embedded.custom_fields;
        console.log(`📊 Найдено полей сделок: ${fields.length}`);
        
        this.fieldCache.leadFields.clear();
        
        for (const field of fields) {
            const fieldId = field.id;
            const fieldName = field.name.toLowerCase();
            const fieldType = field.type || '';
            
            this.fieldCache.leadFields.set(fieldId, {
                id: fieldId,
                name: field.name,
                type: field.type,
                enums: field.enums || []
            });
            
            // Маппинг полей на основе реальных ID
            if (fieldName.includes('абонемент занят')) {
                this.FIELD_IDS.LEAD.TOTAL_CLASSES = fieldId;
                console.log(`✅ TOTAL_CLASSES: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('счетчик занят') || fieldName.includes('счетчик')) {
                this.FIELD_IDS.LEAD.USED_CLASSES = fieldId;
                console.log(`✅ USED_CLASSES: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('остаток занят')) {
                this.FIELD_IDS.LEAD.REMAINING_CLASSES = fieldId;
                console.log(`✅ REMAINING_CLASSES: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('окончание абонемента')) {
                this.FIELD_IDS.LEAD.EXPIRATION_DATE = fieldId;
                console.log(`✅ EXPIRATION_DATE: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('дата активации абонемента')) {
                this.FIELD_IDS.LEAD.ACTIVATION_DATE = fieldId;
                console.log(`✅ ACTIVATION_DATE: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('дата последнего визита')) {
                this.FIELD_IDS.LEAD.LAST_VISIT_DATE = fieldId;
                console.log(`✅ LAST_VISIT_DATE: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('тип абонемента')) {
                this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE = fieldId;
                console.log(`✅ SUBSCRIPTION_TYPE: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('филиал') || fieldName.includes('центр')) {
                this.FIELD_IDS.LEAD.BRANCH = fieldId;
                console.log(`✅ BRANCH: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('группа возраст') || fieldName.includes('возраст')) {
                this.FIELD_IDS.LEAD.AGE_GROUP = fieldId;
                console.log(`✅ AGE_GROUP: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('заморозка абонемента')) {
                this.FIELD_IDS.LEAD.FREEZE = fieldId;
                console.log(`✅ FREEZE: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('принадлежность абонемента')) {
                this.FIELD_IDS.LEAD.SUBSCRIPTION_OWNER = fieldId;
                console.log(`✅ SUBSCRIPTION_OWNER: ${fieldId} -> "${field.name}"`);
            }
        }
        
        // Выводим все найденные поля для отладки
        console.log('\n📋 ВСЕ ПОЛЯ СДЕЛОК:');
        console.log('-'.repeat(40));
        for (const field of fields) {
            console.log(`${field.id}: ${field.name} (${field.type})`);
        }
        console.log('-'.repeat(40));
        
        this.validateRequiredFields('LEAD');
    }

    async mapContactFields(fieldsResponse) {
        if (!fieldsResponse?._embedded?.custom_fields) {
            console.log('⚠️  Поля контактов не найдены');
            return;
        }
        
        const fields = fieldsResponse._embedded.custom_fields;
        console.log(`📊 Найдено полей контактов: ${fields.length}`);
        
        this.fieldCache.contactFields.clear();
        let childCount = 1;
        
        for (const field of fields) {
            const fieldId = field.id;
            const fieldName = field.name.toLowerCase();
            
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
            } else if (fieldName.includes('преподаватель')) {
                this.FIELD_IDS.CONTACT.TEACHER = fieldId;
                console.log(`✅ TEACHER: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('день недел')) {
                this.FIELD_IDS.CONTACT.DAY_OF_WEEK = fieldId;
                console.log(`✅ DAY_OF_WEEK: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('активн') && fieldName.includes('абонемент')) {
                this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB = fieldId;
                console.log(`✅ HAS_ACTIVE_SUB: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('последн') && fieldName.includes('визит')) {
                this.FIELD_IDS.CONTACT.LAST_VISIT = fieldId;
                console.log(`✅ LAST_VISIT: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('возраст') && fieldName.includes('групп')) {
                this.FIELD_IDS.CONTACT.AGE_GROUP = fieldId;
                console.log(`✅ AGE_GROUP: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('аллерг') || fieldName.includes('особенност')) {
                this.FIELD_IDS.CONTACT.ALLERGIES = fieldId;
                console.log(`✅ ALLERGIES: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('день рождения') && !fieldName.includes('ребен')) {
                this.FIELD_IDS.CONTACT.BIRTH_DATE = fieldId;
                console.log(`✅ BIRTH_DATE: ${fieldId} -> "${field.name}"`);
            } else if (fieldName.includes('почта') || fieldName.includes('email')) {
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

    // ДОБАВЛЕН МЕТОД ДЛЯ ОТЛАДКИ
    printDebugInfo() {
        console.log('\n' + '='.repeat(80));
        console.log('🐛 ДЕБАГ ИНФОРМАЦИЯ ПО ПОЛЯМ');
        console.log('='.repeat(80));
        
        console.log('\n🔍 ИСПОЛЬЗУЕМЫЕ ID ПОЛЕЙ:');
        console.log('-'.repeat(40));
        for (const [key, value] of Object.entries(this.FIELD_IDS.LEAD)) {
            if (value) {
                const fieldInfo = this.fieldCache.leadFields.get(value);
                console.log(`${key.padEnd(25)}: ${value} -> "${fieldInfo?.name || 'неизвестно'}"`);
            }
        }
        console.log('-'.repeat(40));
    }

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
            teacher: '',
            isFrozen: false
        };
        
        if (!lead) {
            return subscriptionInfo;
        }
        
        try {
            const customFields = lead.custom_fields_values || [];
            const leadName = lead.name || '';
            
            console.log(`\n🔍 Анализ сделки: "${leadName}" (ID: ${lead.id})`);
            console.log(`📊 Всего полей: ${customFields.length}`);
            
            // Используем реальные ID полей из FIELD_IDS
            const FIELD = this.FIELD_IDS.LEAD;
            
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                const values = field.values || [];
                const firstValue = values[0] || {};
                let fieldValue = firstValue.value || firstValue.enum_id || '';
                
                // Для select полей получаем значение enum
                if (firstValue.enum_id && this.fieldCache.leadFields.has(fieldId)) {
                    const fieldInfo = this.fieldCache.leadFields.get(fieldId);
                    const enumItem = fieldInfo.enums.find(e => e.id === firstValue.enum_id);
                    if (enumItem) {
                        fieldValue = enumItem.value;
                    }
                }
                
                console.log(`  ID ${fieldId}: "${fieldValue}"`);
                
                if (fieldId === FIELD.TOTAL_CLASSES) {
                    // Парсим количество занятий из значения типа "8 занятий"
                    subscriptionInfo.totalClasses = this.parseClassesCount(fieldValue);
                    console.log(`✅ TOTAL_CLASSES: ${subscriptionInfo.totalClasses}`);
                } else if (fieldId === FIELD.USED_CLASSES) {
                    // Для счетчика занятий
                    subscriptionInfo.usedClasses = parseInt(fieldValue) || 0;
                    console.log(`✅ USED_CLASSES: ${subscriptionInfo.usedClasses}`);
                } else if (fieldId === FIELD.REMAINING_CLASSES) {
                    subscriptionInfo.remainingClasses = parseInt(fieldValue) || 0;
                    console.log(`✅ REMAINING_CLASSES: ${subscriptionInfo.remainingClasses}`);
                } else if (fieldId === FIELD.EXPIRATION_DATE) {
                    subscriptionInfo.expirationDate = this.parseDateOrTimestamp(fieldValue);
                    console.log(`✅ EXPIRATION_DATE: ${subscriptionInfo.expirationDate}`);
                } else if (fieldId === FIELD.ACTIVATION_DATE) {
                    subscriptionInfo.activationDate = this.parseDateOrTimestamp(fieldValue);
                    console.log(`✅ ACTIVATION_DATE: ${subscriptionInfo.activationDate}`);
                } else if (fieldId === FIELD.LAST_VISIT_DATE) {
                    subscriptionInfo.lastVisitDate = this.parseDateOrTimestamp(fieldValue);
                    console.log(`✅ LAST_VISIT_DATE: ${subscriptionInfo.lastVisitDate}`);
                } else if (fieldId === FIELD.SUBSCRIPTION_TYPE) {
                    subscriptionInfo.subscriptionType = fieldValue;
                    console.log(`✅ SUBSCRIPTION_TYPE: ${fieldValue}`);
                } else if (fieldId === FIELD.FREEZE) {
                    subscriptionInfo.isFrozen = fieldValue === 'ДА' || fieldValue === 'Да';
                    console.log(`✅ FREEZE: ${subscriptionInfo.isFrozen ? 'ДА' : 'НЕТ'}`);
                } else if (fieldId === FIELD.BRANCH) {
                    subscriptionInfo.branch = fieldValue;
                    console.log(`✅ BRANCH: ${fieldValue}`);
                } else if (fieldId === FIELD.AGE_GROUP) {
                    subscriptionInfo.ageGroup = fieldValue;
                    console.log(`✅ AGE_GROUP: ${fieldValue}`);
                }
            }
            
            // Если не нашли в полях, пробуем парсить название сделки
            if (subscriptionInfo.totalClasses === 0) {
                subscriptionInfo.totalClasses = this.parseClassesCount(leadName);
                if (subscriptionInfo.totalClasses > 0) {
                    console.log(`📊 Из названия сделки: ${subscriptionInfo.totalClasses} занятий`);
                }
            }
            
            // Расчет остатка занятий
            if (subscriptionInfo.totalClasses > 0) {
                subscriptionInfo.hasSubscription = true;
                
                if (subscriptionInfo.usedClasses > 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                    console.log(`📊 Расчет REMAINING_CLASSES: ${subscriptionInfo.totalClasses} - ${subscriptionInfo.usedClasses} = ${subscriptionInfo.remainingClasses}`);
                } else if (subscriptionInfo.remainingClasses > 0 && subscriptionInfo.usedClasses === 0) {
                    subscriptionInfo.usedClasses = subscriptionInfo.totalClasses - subscriptionInfo.remainingClasses;
                    console.log(`📊 Расчет USED_CLASSES: ${subscriptionInfo.totalClasses} - ${subscriptionInfo.remainingClasses} = ${subscriptionInfo.usedClasses}`);
                } else if (subscriptionInfo.usedClasses === 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = subscriptionInfo.totalClasses;
                    console.log(`📊 Установка REMAINING_CLASSES = TOTAL_CLASSES: ${subscriptionInfo.remainingClasses}`);
                }
                
                // Проверка на заморозку
                if (subscriptionInfo.isFrozen) {
                    subscriptionInfo.subscriptionStatus = 'Абонемент заморожен';
                    subscriptionInfo.subscriptionBadge = 'frozen';
                    subscriptionInfo.subscriptionActive = false;
                } 
                // Проверка истечения срока
                else if (subscriptionInfo.expirationDate) {
                    const expirationDate = new Date(subscriptionInfo.expirationDate);
                    const now = new Date();
                    
                    if (expirationDate < now) {
                        subscriptionInfo.subscriptionStatus = 'Абонемент истек';
                        subscriptionInfo.subscriptionBadge = 'expired';
                        subscriptionInfo.subscriptionActive = false;
                    } else if (subscriptionInfo.remainingClasses <= 0) {
                        subscriptionInfo.subscriptionStatus = 'Занятия закончились';
                        subscriptionInfo.subscriptionBadge = 'expired';
                        subscriptionInfo.subscriptionActive = false;
                    } else {
                        subscriptionInfo.subscriptionStatus = `Активный (${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
                        subscriptionInfo.subscriptionBadge = 'active';
                        subscriptionInfo.subscriptionActive = true;
                    }
                } else {
                    // Если нет даты истечения, проверяем только по занятиям
                    if (subscriptionInfo.remainingClasses <= 0) {
                        subscriptionInfo.subscriptionStatus = 'Занятия закончились';
                        subscriptionInfo.subscriptionBadge = 'expired';
                        subscriptionInfo.subscriptionActive = false;
                    } else {
                        subscriptionInfo.subscriptionStatus = `Активный (${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
                        subscriptionInfo.subscriptionBadge = 'active';
                        subscriptionInfo.subscriptionActive = true;
                    }
                }
            }
            
            console.log('\n🎯 ИТОГОВЫЙ СТАТУС:');
            console.log(`• Абонемент: ${subscriptionInfo.subscriptionType || 'Не указан'}`);
            console.log(`• Всего занятий: ${subscriptionInfo.totalClasses}`);
            console.log(`• Использовано: ${subscriptionInfo.usedClasses}`);
            console.log(`• Осталось: ${subscriptionInfo.remainingClasses}`);
            console.log(`• Статус: ${subscriptionInfo.subscriptionStatus}`);
            console.log(`• Активен: ${subscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
            console.log(`• Дата окончания: ${subscriptionInfo.expirationDate || 'Не указана'}`);
            
        } catch (error) {
            console.error('❌ Ошибка extractSubscriptionInfo:', error);
        }
        
        return subscriptionInfo;
    }

    parseClassesCount(value) {
        if (!value) return 0;
        
        const str = String(value).toLowerCase();
        
        // Ищем паттерны типа "8 занятий", "16 занятий" и т.д.
        const patterns = [
            /(\d+)\s*занят/,        // "8 занятий"
            /(\d+)\s*урок/,         // "8 уроков"
            /^(\d+)$/,              // просто число
            /всего\s*(\d+)/,        // "всего 8"
            /количество\s*(\d+)/,   // "количество 8"
        ];
        
        for (const pattern of patterns) {
            const match = str.match(pattern);
            if (match && match[1]) {
                const num = parseInt(match[1]);
                if (!isNaN(num) && num > 0 && num < 100) {
                    console.log(`📊 parseClassesCount: Найдено ${num} занятий в "${str}"`);
                    return num;
                }
            }
        }
        
        // Для enum значений типа "16 занятий" в select полях
        if (str.includes('занят')) {
            const numMatch = str.match(/\d+/);
            if (numMatch) {
                const num = parseInt(numMatch[0]);
                if (!isNaN(num) && num > 0) {
                    console.log(`📊 parseClassesCount (enum): ${num} занятий в "${str}"`);
                    return num;
                }
            }
        }
        
        console.log(`📊 parseClassesCount: Не найдено чисел в "${str}"`);
        return 0;
    }

    parseDateOrTimestamp(value) {
        if (!value) return null;
        
        try {
            const str = String(value).trim();
            
            // Если это timestamp (число)
            if (/^\d+$/.test(str)) {
                const timestamp = parseInt(str);
                const date = timestamp < 10000000000 
                    ? new Date(timestamp * 1000)  // секунды
                    : new Date(timestamp);         // миллисекунды
                
                if (!isNaN(date.getTime())) {
                    return date.toISOString().split('T')[0]; // YYYY-MM-DD
                }
            }
            
            // Если это дата в формате YYYY-MM-DD
            if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
                const date = new Date(str);
                if (!isNaN(date.getTime())) {
                    return str;
                }
            }
            
            // Пробуем парсить любую дату
            const date = new Date(str);
            if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
            }
            
            // Возвращаем как есть, если не удалось распарсить
            return str;
            
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error);
            return value;
        }
    }

    extractStudentsFromContact(contact) {
        const students = [];
        
        try {
            const customFields = contact.custom_fields_values || [];
            const contactName = contact.name || '';
            
            console.log(`\n👤 Поиск детей в контакте: ${contactName}`);
            
            const childFields = [];
            const childBirthdayFields = [];
            
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
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
                
                if (fieldName.includes('день рождения') && fieldName.includes('ребен')) {
                    childBirthdayFields.push({
                        id: field.field_id || field.id,
                        name: field.name,
                        value: fieldValue
                    });
                }
            }
            
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
                
                if (childBirthdayFields.length > index) {
                    student.birthDate = this.parseDate(childBirthdayFields[index].value);
                }
                
                for (const field of customFields) {
                    const fieldName = this.getFieldName(field).toLowerCase();
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue || fieldValue.trim() === '') continue;
                    
                    if (fieldName.includes('филиал') || fieldName.includes('центр')) {
                        student.branch = fieldValue;
                    } else if (fieldName.includes('преподаватель')) {
                        student.teacherName = fieldValue;
                    } else if (fieldName.includes('день недел')) {
                        student.dayOfWeek = fieldValue;
                    } else if (fieldName.includes('возраст') && fieldName.includes('групп')) {
                        student.ageGroup = fieldValue;
                    } else if (fieldName.includes('аллерг') || fieldName.includes('особенност')) {
                        student.allergies = fieldValue;
                    } else if (fieldName.includes('почта') || fieldName.includes('email')) {
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

    async getStudentsByPhone(phoneNumber) {
        console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ УЧЕНИКОВ: ${phoneNumber}`);
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            // 1. Поиск контактов
            console.log('🔍 Поиск контактов...');
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            let hasValidContact = false;
            
            if (contacts.length > 0) {
                // 2. Для каждого контакта ищем сделки
                for (const contact of contacts) {
                    console.log(`\n👤 Контакт: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
                    
                    // 3. Получаем сделки контакта
                    const leads = await this.getContactLeadsSorted(contact.id);
                    console.log(`📊 Сделок у контакта: ${leads.length}`);
                    
                    // 4. Ищем сделки с абонементами
                    const subscriptionLeads = leads.filter(lead => {
                        const leadName = lead.name || '';
                        return leadName.includes('занят') || 
                               leadName.includes('Абонемент') ||
                               (lead.custom_fields_values && 
                                lead.custom_fields_values.some(f => 
                                    Object.values(this.FIELD_IDS.LEAD).includes(f.field_id || f.id)
                                ));
                    });
                    
                    console.log(`📊 Сделок с абонементами: ${subscriptionLeads.length}`);
                    
                    if (subscriptionLeads.length > 0) {
                        hasValidContact = true;
                        
                        // 5. Создаем профили из сделок
                        for (const lead of subscriptionLeads) {
                            console.log(`\n🎫 Анализ сделки: "${lead.name}"`);
                            
                            const subscriptionInfo = this.extractSubscriptionInfo(lead);
                            
                            if (subscriptionInfo.hasSubscription) {
                                const profile = this.createStudentProfileFromLead(
                                    contact,
                                    phoneNumber,
                                    lead,
                                    subscriptionInfo
                                );
                                
                                if (profile) {
                                    studentProfiles.push(profile);
                                    console.log(`✅ Профиль создан: ${profile.student_name}`);
                                }
                            }
                        }
                    }
                }
            }
            
            // 6. Если контакты не найдены, ищем сделки напрямую
            if (studentProfiles.length === 0) {
                console.log('\n🔍 Контакты не найдены, ищем сделки напрямую...');
                const leads = await this.searchLeadsByPhone(phoneNumber);
                
                console.log(`📊 Найдено сделок напрямую: ${leads.length}`);
                
                for (const lead of leads) {
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    
                    if (subscriptionInfo.hasSubscription) {
                        const profile = this.createStudentProfileFromLead(
                            { id: null, name: 'Неизвестный контакт' },
                            phoneNumber,
                            lead,
                            subscriptionInfo
                        );
                        
                        if (profile) {
                            studentProfiles.push(profile);
                            console.log(`✅ Профиль создан из сделки: ${profile.student_name}`);
                        }
                    }
                }
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${studentProfiles.length}`);
            
            return studentProfiles;
            
        } catch (error) {
            console.error(`❌ Ошибка получения данных:`, error.message);
            return [];
        }
    }

    async searchLeadsByPhone(phoneNumber) {
        try {
            console.log(`🔍 ПОИСК СДЕЛОК ПО ТЕЛЕФОНУ: ${phoneNumber}`);
            
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const lastDigits = cleanPhone.slice(-10);
            
            let allLeads = [];
            let page = 1;
            
            while (true) {
                try {
                    const response = await this.makeRequest(
                        'GET',
                        `/api/v4/leads?page=${page}&limit=100&with=custom_fields_values`
                    );
                    
                    const leads = response._embedded?.leads || [];
                    console.log(`📄 Страница ${page}: ${leads.length} сделок`);
                    
                    if (leads.length === 0) break;
                    
                    // Фильтруем по наличию абонементных полей
                    const filteredLeads = leads.filter(lead => {
                        const name = lead.name || '';
                        if (name.includes('занят') || name.includes('Абонемент')) {
                            return true;
                        }
                        
                        if (lead.custom_fields_values) {
                            return lead.custom_fields_values.some(f => 
                                Object.values(this.FIELD_IDS.LEAD).includes(f.field_id || f.id)
                            );
                        }
                        
                        return false;
                    });
                    
                    if (filteredLeads.length > 0) {
                        console.log(`✅ На странице ${page} найдено сделок с абонементами: ${filteredLeads.length}`);
                        allLeads = allLeads.concat(filteredLeads);
                    }
                    
                    if (leads.length < 100) break;
                    page++;
                    
                    if (page > 5) break;
                    
                } catch (error) {
                    console.error(`❌ Ошибка страницы ${page}:`, error.message);
                    break;
                }
            }
            
            console.log(`📊 Всего найдено сделок с абонементами: ${allLeads.length}`);
            return allLeads;
            
        } catch (error) {
            console.error('❌ Ошибка поиска сделок:', error.message);
            return [];
        }
    }

    createStudentProfileFromLead(contact, phoneNumber, lead, subscriptionInfo) {
        try {
            console.log(`👤 Создание профиля из сделки: "${lead.name}"`);
            
            let studentName = 'Ученик';
            const leadName = lead.name || '';
            const nameMatch = leadName.match(/^(.*?)\s*[-–]\s*\d+\s*занят/);
            if (nameMatch && nameMatch[1]) {
                studentName = nameMatch[1].trim();
            }
            
            // Ищем в кастомных полях
            if (lead.custom_fields_values) {
                for (const field of lead.custom_fields_values) {
                    const fieldName = this.getFieldName(field);
                    const fieldValue = this.getFieldValue(field);
                    
                    if (fieldValue && (fieldName.includes('ученик') || 
                                       fieldName.includes('ребен') || 
                                       fieldName.includes('ФИО'))) {
                        studentName = fieldValue;
                        break;
                    }
                }
            }
            
            const formatDisplayDate = (dateStr) => {
                if (!dateStr) return '';
                try {
                    const date = new Date(dateStr);
                    return date.toLocaleDateString('ru-RU');
                } catch (error) {
                    return dateStr;
                }
            };
            
            const profile = {
                amocrm_contact_id: contact.id || null,
                parent_contact_id: contact.id || null,
                amocrm_lead_id: lead.id || null,
                student_name: studentName,
                phone_number: phoneNumber,
                email: '',
                birth_date: '',
                branch: subscriptionInfo.branch || '',
                parent_name: contact.name || 'Родитель',
                day_of_week: '',
                time_slot: '',
                teacher_name: '',
                age_group: subscriptionInfo.ageGroup || '',
                course: '',
                allergies: '',
                
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
                
                // Форматированные даты
                expiration_date_display: formatDisplayDate(subscriptionInfo.expirationDate),
                activation_date_display: formatDisplayDate(subscriptionInfo.activationDate),
                last_visit_date_display: formatDisplayDate(subscriptionInfo.lastVisitDate),
                
                // Технические данные
                custom_fields: JSON.stringify(lead.custom_fields_values || []),
                raw_contact_data: JSON.stringify(contact),
                lead_data: JSON.stringify(lead),
                is_demo: 0,
                source: 'amocrm',
                is_active: 1,
                last_sync: new Date().toISOString()
            };
            
            console.log(`📊 Создан профиль:`);
            console.log(`   👤 ${profile.student_name}`);
            console.log(`   🎫 ${profile.subscription_status}`);
            console.log(`   📊 ${profile.used_classes}/${profile.total_classes} занятий`);
            console.log(`   📍 Филиал: ${profile.branch}`);
            
            return profile;
            
        } catch (error) {
            console.error('❌ Ошибка создания профиля:', error);
            return null;
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
                if (error.response.data) {
                    console.error(`📋 Данные:`, JSON.stringify(error.response.data, null, 2));
                }
            }
            throw error;
        }
    }

    async getContactLeadsSorted(contactId) {
        try {
            console.log(`🔍 Получение всех сделок для контакта ${contactId}`);
            
            let allLeads = [];
            let page = 1;
            const limit = 100;
            
            while (true) {
                const response = await this.makeRequest(
                    'GET',
                    `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&page=${page}&limit=${limit}&order[created_at]=desc`
                );
                
                const leads = response._embedded?.leads || [];
                console.log(`📊 Страница ${page}: ${leads.length} сделок`);
                
                if (leads.length === 0) break;
                
                allLeads = allLeads.concat(leads);
                
                if (leads.length < limit) break;
                
                page++;
                
                if (page > 10) {
                    console.log('⚠️  Достигнут лимит страниц (10)');
                    break;
                }
            }
            
            console.log(`✅ Всего найдено сделок: ${allLeads.length}`);
            
            console.log('\n📋 СПИСОК ВСЕХ СДЕЛОК КОНТАКТА:');
            allLeads.forEach((lead, index) => {
                const hasSubscription = (lead.name || '').includes('абонемент') || 
                                      (lead.name || '').includes('занят');
                const status = lead.status_id === 65473306 ? 'Активный абонемент' : 
                              lead.status_id === 65473286 ? 'Закончился' : 'Другой';
                
                console.log(`  ${index + 1}. "${lead.name || 'Без названия'}"`);
                console.log(`     • ID: ${lead.id}`);
                console.log(`     • Статус: ${status} (${lead.status_id})`);
                console.log(`     • Создана: ${new Date(lead.created_at * 1000).toLocaleDateString()}`);
                console.log(`     • Абонемент: ${hasSubscription ? 'Да' : 'Нет'}`);
            });
            
            return allLeads;
        } catch (error) {
            console.error(`⚠️  Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    async searchContactsByPhone(phoneNumber) {
        try {
            console.log(`\n🔍 РЕАЛЬНЫЙ ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
            
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const lastDigits = cleanPhone.slice(-10);
            
            // Вариант 1: Поиск через query
            try {
                const query = encodeURIComponent(lastDigits);
                const response = await this.makeRequest(
                    'GET',
                    `/api/v4/contacts?query=${query}&with=custom_fields_values&limit=50`
                );
                
                console.log(`📊 Результат поиска по query: ${response._embedded?.contacts?.length || 0} контактов`);
                
                if (response._embedded?.contacts?.length > 0) {
                    return response;
                }
            } catch (queryError) {
                console.log('⚠️  Поиск по query не сработал:', queryError.message);
            }
            
            // Вариант 2: Фильтрация вручную
            console.log('🔄 Пробуем получить все контакты и отфильтровать...');
            
            let allContacts = [];
            let page = 1;
            const limit = 100;
            
            while (true) {
                try {
                    const response = await this.makeRequest(
                        'GET',
                        `/api/v4/contacts?page=${page}&limit=${limit}&with=custom_fields_values`
                    );
                    
                    const contacts = response._embedded?.contacts || [];
                    console.log(`📄 Страница ${page}: ${contacts.length} контактов`);
                    
                    if (contacts.length === 0) break;
                    
                    const filteredContacts = contacts.filter(contact => {
                        if (contact.custom_fields_values) {
                            for (const field of contact.custom_fields_values) {
                                const fieldValue = this.getFieldValue(field);
                                if (fieldValue && fieldValue.includes(lastDigits)) {
                                    return true;
                                }
                            }
                        }
                        return false;
                    });
                    
                    if (filteredContacts.length > 0) {
                        console.log(`✅ На странице ${page} найдено: ${filteredContacts.length} контактов`);
                        allContacts = allContacts.concat(filteredContacts);
                    }
                    
                    if (contacts.length < limit) break;
                    page++;
                    
                    if (page > 5) {
                        console.log('⚠️  Ограничение: проверено 5 страниц');
                        break;
                    }
                    
                } catch (pageError) {
                    console.error(`❌ Ошибка получения страницы ${page}:`, pageError.message);
                    break;
                }
            }
            
            console.log(`📊 ИТОГО найдено контактов: ${allContacts.length}`);
            
            return {
                _embedded: {
                    contacts: allContacts
                }
            };
            
        } catch (error) {
            console.error('❌ Ошибка поиска контактов:', error.message);
            return { _embedded: { contacts: [] } };
        }
    }

    getFieldName(field) {
        return field.name || this.fieldCache.leadFields.get(field.field_id || field.id)?.name || 'Неизвестно';
    }

    getFieldValue(field) {
        try {
            if (!field.values || !field.values[0]) return '';
            const value = field.values[0];
            
            if (value.value) {
                return value.value.toString();
            } else if (value.enum_id && field.enums) {
                const enumItem = field.enums.find(e => e.id === value.enum_id);
                return enumItem ? enumItem.value : value.enum_id.toString();
            }
            
            return '';
        } catch (error) {
            return '';
        }
    }

    parseDate(dateStr) {
        try {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return dateStr;
            return date.toISOString().split('T')[0];
        } catch (error) {
            return dateStr;
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
        const syncId = `sync_${new Date().toISOString().replace(/[^0-9]/g, '')}`;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔄 ЗАПУСК СИНХРОНИЗАЦИИ: ${syncId}`);
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

    async syncSinglePhone(phoneNumber) {
        console.log(`\n🔧 РУЧНАЯ СИНХРОНИЗАЦИЯ ТЕЛЕФОНА: ${phoneNumber}`);
        
        try {
            const profiles = await amoCrmService.getStudentsByPhone(phoneNumber);
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
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    const result = await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    
                    console.log(`✅ Профиль создан (ID: ${result.lastID}): ${profile.student_name}`);
                    savedCount++;
                } else {
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
            is_demo: p.is_demo === 0 ? false : true,
            source: p.source,
            last_sync: p.last_sync
        }));
        
        const hasMultipleStudents = profiles.length > 1;
        
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
            
            if (!profile && profile_id.startsWith('profile-')) {
                const index = parseInt(profile_id.replace('profile-', ''));
                console.log(`🔍 Это временный ID, индекс: ${index}`);
                
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
                all_fields: allFields.slice(0, 50)
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
                    is_subscription_field: Object.values(amoCrmService.FIELD_IDS.LEAD).includes(fieldId)
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
                            Object.values(amoCrmService.FIELD_IDS.LEAD).includes(f.field_id || f.id)
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

app.get('/api/debug/system-status', async (req, res) => {
    try {
        console.log('\n⚙️  СТАТУС СИСТЕМЫ');
        
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

// ДОБАВЛЕН НОВЫЙ МАРШРУТ ДЛЯ ТЕСТОВОГО АНАЛИЗА СДЕЛКИ
app.get('/api/debug/test-lead/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        console.log(`\n🔧 ТЕСТОВЫЙ АНАЛИЗ СДЕЛКИ ID: ${leadId}`);
        
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
        
        console.log(`📋 Название сделки: ${lead.name || 'Без названия'}`);
        console.log(`📋 Все поля сделки:`);
        
        if (lead.custom_fields_values) {
            lead.custom_fields_values.forEach((field, index) => {
                const fieldId = field.field_id || field.id;
                const fieldName = amoCrmService.getFieldName(field);
                const values = field.values || [];
                const firstValue = values[0] || {};
                let fieldValue = firstValue.value || firstValue.enum_id || '';
                
                // Получаем значение enum
                if (firstValue.enum_id && amoCrmService.fieldCache.leadFields.has(fieldId)) {
                    const fieldInfo = amoCrmService.fieldCache.leadFields.get(fieldId);
                    const enumItem = fieldInfo.enums.find(e => e.id === firstValue.enum_id);
                    if (enumItem) {
                        fieldValue = enumItem.value;
                    }
                }
                
                console.log(`${index + 1}. ${fieldId}: ${fieldName} = "${fieldValue}"`);
            });
        }
        
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        res.json({
            success: true,
            data: {
                lead_name: lead.name,
                subscription: subscriptionInfo,
                raw_fields: lead.custom_fields_values
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестового анализа:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== API СИНХРОНИЗАЦИИ ====================
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
            
            console.log('\n🐛 ДЕБАГ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`🔍 Тест сделки: GET http://localhost:${PORT}/api/debug/test-lead/12345`);
            console.log(`📋 Поля сделок: GET http://localhost:${PORT}/api/debug/lead-fields`);
            console.log(`📱 Диагностика телефона: GET http://localhost:${PORT}/api/debug/phone/79175161115`);
            console.log(`⚙️  Статус системы: GET http://localhost:${PORT}/api/debug/system-status`);
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
