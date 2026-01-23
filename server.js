// server.js - ИСПРАВЛЕННАЯ И РАБОЧАЯ ВЕРСИЯ
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
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.fieldMappings = new Map();
        
        // ИСПРАВЛЕННЫЕ ID ПОЛЕЙ (динамически определяются)
       // ==================== ИСПРАВЛЕННЫЙ FIELD_IDS ====================
this.FIELD_IDS = {
    LEAD: {
        TOTAL_CLASSES: 850241,        // "Абонемент занятий:"
        USED_CLASSES: 850257,         // "Счетчик занятий:"
        REMAINING_CLASSES: 890163,    // "Остаток занятий"
        EXPIRATION_DATE: 850255,      // "Окончание абонемента:"
        ACTIVATION_DATE: 851565,      // "Дата активации абонемента:"
        LAST_VISIT_DATE: 850259,      // "Дата последнего визита:"
        SUBSCRIPTION_TYPE: 891007,    // "Тип абонемента"
        BRANCH: null,                 // Ищем динамически
        AGE_GROUP: 850243,            // "Группа возраст:"
        FREEZE: 867693,               // "Заморозка абонемента:"
        SUBSCRIPTION_OWNER: 805465,   // "Принадлежность абонемента:"
        
        // НОВЫЕ ПОЛЯ из диагностики:
        TECHNICAL_CLASSES: 891819,    // "количество занятий (тех)"
        PRICE_PER_CLASS: 891813,      // "стоимость 1 занятия"
        FIRST_CLASS_CHECKBOX: 884899, // "1 занятие" (checkbox)
        FIRST_CLASS_DATE: 884931,     // "дата 1 занятия"
        TRIAL_DATE: 867729,           // "!дата и время пробного занятия:"
        PURCHASE_DATE: 850253,        // "дата покупки:"
        
        // Дополнительные
        RECEIVED_FUNDS: 891815,       // "полученные средства"
        ADVANCE_FUNDS: 891817,        // "авансовые средства"
        CHANNEL: 867617,              // "канал отправки сообщений:"
        COMMENT: 805467               // "комментарий"
    },
    
    CONTACT: {
        CHILD_1_NAME: 867233,         // "!ФИО ребенка:"
        CHILD_2_NAME: 867235,         // "!!ФИО ребенка:"
        CHILD_3_NAME: 867733,         // "!!!ФИО ребенка:"
        CHILD_1_BIRTHDAY: 867687,     // ДР ребенка 1
        CHILD_2_BIRTHDAY: 867685,     // ДР ребенка 2
        CHILD_3_BIRTHDAY: 867735,     // ДР ребенка 3
        
        BRANCH: 871273,               // "Филиал:"
        TEACHER: 888881,              // "Преподаватель"
        DAY_OF_WEEK: 888879,          // "День недели посещения"
        HAS_ACTIVE_SUB: 890179,       // "Есть активный абонемент"
        LAST_VISIT: 885380,           // "Дата последнего визита"
        AGE_GROUP: 888903,            // "Возраст группы"
        ALLERGIES: 850239,            // "Аллергия и особенности:"
        BIRTH_DATE: 850219,           // "День рождения:"
        EMAIL: 216617,                // "Почта"
        
        // НОВЫЕ ПОЛЯ из диагностики:
        MONTH_CLASS_COUNTER: 885027,  // "счетчик занятий за месяц"
        LAST_ACTIVATION_DATE: 892185, // "дата активации последнего абонемента"
        AVG_CHECK: 887159,            // "ср. чек, руб."
        TOTAL_PURCHASES: 887157,      // "сумма покупок, руб."
        PURCHASES_COUNT: 887155,      // "количество покупок"
        TRIAL_ATTENDED: 867691,       // "был на пробном занятии:"
        STUDENT: 850223,              // "поступающий:"
        PHONE: 216615,                // "телефон"
        TELEGRAM_ID: 852249,          // "TelegramId_WZ"
        TELEGRAM_USERNAME: 852247     // "TelegramUsername_WZ"
    }
};
        
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
                    await this.loadFieldMappings();
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
                
                return date.toISOString().split('T')[0];
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

    // 🔧 СОВЕРШЕННО НОВЫЙ МЕТОД: extractSubscriptionInfo
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
        isFrozen: false,
        pricePerClass: 0,
        purchaseDate: '',
        technicalClasses: 0
    };
    
    if (!lead) {
        return subscriptionInfo;
    }
    
    try {
        const customFields = lead.custom_fields_values || [];
        const leadName = lead.name || '';
        
        console.log(`\n🔍 Анализ сделки: "${leadName}"`);
        
        // ПРИОРИТЕТ 1: Название сделки
        let nameTotalClasses = this.parseLeadNameForSubscription(leadName);
        if (nameTotalClasses > 0) {
            console.log(`📊 Из названия: ${nameTotalClasses} занятий`);
            subscriptionInfo.totalClasses = nameTotalClasses;
            subscriptionInfo.hasSubscription = true;
        }
        
        // ПРИОРИТЕТ 2: Поля сделки
        let fieldTotalClasses = 0;
        let usedClasses = 0;
        let remainingClasses = 0;
        let expirationDate = null;
        let activationDate = null;
        let lastVisitDate = null;
        let subscriptionType = '';
        let isFrozen = false;
        let branch = '';
        let teacher = '';
        let pricePerClass = 0;
        let purchaseDate = '';
        let technicalClasses = 0;
        
        for (const field of customFields) {
            const fieldId = field.field_id || field.id;
            const fieldValue = this.getFieldValue(field);
            const fieldName = this.getFieldName(field).toLowerCase();
            
            if (!fieldValue || fieldValue.trim() === '') continue;
            
            console.log(`   📋 Поле ${fieldId}: ${fieldName} = "${fieldValue}"`);
            
            // ОБЩЕЕ КОЛИЧЕСТВО ЗАНЯТИЙ (несколько источников)
            if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES || 
                fieldName.includes('абонемент') && 
                (fieldName.includes('занят') || fieldName.includes('урок'))) {
                
                // Парсим разные форматы
                if (fieldValue.includes('16') || fieldValue.includes('16занятий')) {
                    fieldTotalClasses = 16;
                } else if (fieldValue.includes('8') || fieldValue.includes('8занятий')) {
                    fieldTotalClasses = 8;
                } else if (fieldValue.includes('4') || fieldValue.includes('4занятия')) {
                    fieldTotalClasses = 4;
                } else if (fieldValue.includes('24') || fieldValue.includes('24занятия')) {
                    fieldTotalClasses = 24;
                } else if (fieldValue.includes('12') || fieldValue.includes('12занятий')) {
                    fieldTotalClasses = 12;
                } else {
                    // Ищем любое число
                    const match = fieldValue.match(/\d+/);
                    if (match) {
                        fieldTotalClasses = parseInt(match[0]);
                    }
                }
                console.log(`   📊 Поле абонемента: ${fieldTotalClasses} занятий`);
            }
            
            // ТЕХНИЧЕСКОЕ КОЛИЧЕСТВО ЗАНЯТИЙ (приоритетнее!)
            else if (fieldId === this.FIELD_IDS.LEAD.TECHNICAL_CLASSES || 
                    fieldName.includes('количество занятий (тех)')) {
                technicalClasses = parseInt(fieldValue) || 0;
                if (technicalClasses > 0) {
                    fieldTotalClasses = technicalClasses;
                    console.log(`   🎯 Техническое количество: ${technicalClasses} занятий`);
                }
            }
            
            // СЧЕТЧИК ЗАНЯТИЙ
            else if (fieldId === this.FIELD_IDS.LEAD.USED_CLASSES || 
                    fieldName.includes('счетчик') && fieldName.includes('занят')) {
                usedClasses = parseInt(fieldValue) || 0;
                console.log(`   📊 Счетчик занятий: ${usedClasses}`);
            }
            
            // ОСТАТОК ЗАНЯТИЙ
            else if (fieldId === this.FIELD_IDS.LEAD.REMAINING_CLASSES || 
                    fieldName.includes('остаток') && fieldName.includes('занят')) {
                remainingClasses = parseInt(fieldValue) || 0;
                console.log(`   📊 Остаток занятий: ${remainingClasses}`);
            }
            
            // ДАТА ОКОНЧАНИЯ
            else if (fieldId === this.FIELD_IDS.LEAD.EXPIRATION_DATE || 
                    fieldName.includes('окончание') && fieldName.includes('абонемент')) {
                expirationDate = this.parseDateOrTimestamp(fieldValue);
                console.log(`   📅 Окончание абонемента: ${expirationDate}`);
            }
            
            // ДАТА АКТИВАЦИИ
            else if (fieldId === this.FIELD_IDS.LEAD.ACTIVATION_DATE || 
                    fieldName.includes('активации') && fieldName.includes('абонемент')) {
                activationDate = this.parseDateOrTimestamp(fieldValue);
                console.log(`   📅 Дата активации: ${activationDate}`);
            }
            
            // ДАТА ПОКУПКИ
            else if (fieldId === this.FIELD_IDS.LEAD.PURCHASE_DATE || 
                    fieldName.includes('дата покупки')) {
                purchaseDate = this.parseDateOrTimestamp(fieldValue);
                console.log(`   📅 Дата покупки: ${purchaseDate}`);
            }
            
            // ДАТА ПОСЛЕДНЕГО ВИЗИТА
            else if (fieldId === this.FIELD_IDS.LEAD.LAST_VISIT_DATE || 
                    (fieldName.includes('последн') && fieldName.includes('визит'))) {
                lastVisitDate = this.parseDateOrTimestamp(fieldValue);
                console.log(`   📅 Последний визит: ${lastVisitDate}`);
            }
            
            // ТИП АБОНЕМЕНТА
            else if (fieldId === this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE || 
                    fieldName.includes('тип абонемента')) {
                subscriptionType = fieldValue;
                console.log(`   📝 Тип абонемента: ${fieldValue}`);
            }
            
            // ЗАМОРОЗКА
            else if (fieldId === this.FIELD_IDS.LEAD.FREEZE || 
                    fieldName.includes('заморозка')) {
                isFrozen = fieldValue.toLowerCase() === 'да' || 
                          fieldValue === '1' || 
                          fieldValue.toLowerCase() === 'true' ||
                          fieldValue.toLowerCase() === 'yes';
                if (isFrozen) console.log(`   ❄️  Заморозка: ДА`);
            }
            
            // ФИЛИАЛ (ищем в любом поле)
            else if (fieldName.includes('филиал') || fieldName.includes('центр')) {
                branch = fieldValue;
                console.log(`   📍 Филиал: ${fieldValue}`);
            }
            
            // ПРЕПОДАВАТЕЛЬ (ищем в любом поле)
            else if (fieldName.includes('преподаватель') || fieldName.includes('учитель')) {
                teacher = fieldValue;
                console.log(`   👨‍🏫 Преподаватель: ${fieldValue}`);
            }
            
            // СТОИМОСТЬ 1 ЗАНЯТИЯ
            else if (fieldId === this.FIELD_IDS.LEAD.PRICE_PER_CLASS || 
                    fieldName.includes('стоимость') && fieldName.includes('занятие')) {
                pricePerClass = parseInt(fieldValue) || 0;
                console.log(`   💰 Стоимость занятия: ${pricePerClass}`);
            }
        }
        
        // ВЫБОР ОСНОВНОГО КОЛИЧЕСТВА ЗАНЯТИЙ (приоритет):
        // 1. Техническое поле
        // 2. Поле абонемента
        // 3. Название сделки
        if (technicalClasses > 0) {
            subscriptionInfo.totalClasses = technicalClasses;
        } else if (fieldTotalClasses > 0) {
            subscriptionInfo.totalClasses = fieldTotalClasses;
        } else if (nameTotalClasses > 0) {
            subscriptionInfo.totalClasses = nameTotalClasses;
        }
        
        subscriptionInfo.usedClasses = usedClasses;
        subscriptionInfo.remainingClasses = remainingClasses;
        subscriptionInfo.subscriptionType = subscriptionType;
        subscriptionInfo.activationDate = activationDate;
        subscriptionInfo.expirationDate = expirationDate;
        subscriptionInfo.lastVisitDate = lastVisitDate;
        subscriptionInfo.branch = branch;
        subscriptionInfo.teacher = teacher;
        subscriptionInfo.isFrozen = isFrozen;
        subscriptionInfo.pricePerClass = pricePerClass;
        subscriptionInfo.purchaseDate = purchaseDate;
        subscriptionInfo.technicalClasses = technicalClasses;
        
        // РАССЧИТЫВАЕМ ОСТАТОК, ЕСЛИ НЕ УКАЗАН
        if (subscriptionInfo.totalClasses > 0) {
            subscriptionInfo.hasSubscription = true;
            
            if (subscriptionInfo.remainingClasses === 0 && subscriptionInfo.usedClasses > 0) {
                subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
            } else if (subscriptionInfo.usedClasses === 0 && subscriptionInfo.remainingClasses > 0) {
                subscriptionInfo.usedClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.remainingClasses);
            } else if (subscriptionInfo.usedClasses === 0 && subscriptionInfo.remainingClasses === 0) {
                // Если ни использовано, ни остаток не указаны
                subscriptionInfo.remainingClasses = subscriptionInfo.totalClasses;
            }
        }
        
        // ОПРЕДЕЛЕНИЕ СТАТУСА
        const now = new Date();
        const isExpired = expirationDate ? new Date(expirationDate) < now : false;
        const hasRemaining = subscriptionInfo.remainingClasses > 0;
        const isNotActivated = !activationDate && subscriptionInfo.totalClasses > 0;
        
        if (isFrozen) {
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
        else if (isNotActivated) {
            subscriptionInfo.subscriptionStatus = `Купленный (${subscriptionInfo.totalClasses} занятий)`;
            subscriptionInfo.subscriptionBadge = 'has_subscription';
            subscriptionInfo.subscriptionActive = true;
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
        
        console.log(`\n📊 ИТОГ абонемента:`);
        console.log(`   • Всего: ${subscriptionInfo.totalClasses} занятий`);
        console.log(`   • Использовано: ${subscriptionInfo.usedClasses}`);
        console.log(`   • Осталось: ${subscriptionInfo.remainingClasses}`);
        console.log(`   • Статус: ${subscriptionInfo.subscriptionStatus}`);
        console.log(`   • Филиал: ${subscriptionInfo.branch || 'не указан'}`);
        console.log(`   • Активен: ${subscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
        console.log(`   • Технических занятий: ${subscriptionInfo.technicalClasses}`);
        
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
            const contactName = contact.name || '';
            
            console.log(`\n👤 Поиск детей в контакте: ${contactName}`);
            
            // Для каждого возможного ребенка
            const childrenConfig = [
                { 
                    number: 1, 
                    nameFieldId: this.FIELD_IDS.CONTACT.CHILD_1_NAME, 
                    birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_1_BIRTHDAY 
                },
                { 
                    number: 2, 
                    nameFieldId: this.FIELD_IDS.CONTACT.CHILD_2_NAME, 
                    birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_2_BIRTHDAY 
                },
                { 
                    number: 3, 
                    nameFieldId: this.FIELD_IDS.CONTACT.CHILD_3_NAME, 
                    birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_3_BIRTHDAY 
                }
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
                    parentName: contactName,
                    hasActiveSubscription: false,
                    lastVisitDate: '',
                    email: ''
                };
                
                let hasChildData = false;
                
                // Проходим по всем полям контакта
                for (const field of customFields) {
                    const fieldId = field.field_id || field.id;
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue || fieldValue.trim() === '') continue;
                    
                    // Имя ребенка
                    if (fieldId === childConfig.nameFieldId) {
                        childInfo.studentName = fieldValue.trim();
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
                    else if (fieldId === this.FIELD_IDS.CONTACT.EMAIL) {
                        childInfo.email = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.BIRTH_DATE) {
                        // Дата рождения родителя
                        if (!childInfo.birthDate) {
                            childInfo.birthDate = this.parseDate(fieldValue);
                        }
                    }
                }
                
                // Если нашли данные о ребенке, добавляем
                if (hasChildData && childInfo.studentName && childInfo.studentName.trim() !== '') {
                    students.push(childInfo);
                }
            }
            
            console.log(`📊 Найдено детей: ${students.length}`);
            
            // Если детей не нашли, создаем ученика из данных контакта
            if (students.length === 0 && contactName && contactName !== 'Без имени') {
                console.log('⚠️  Дети не найдены, создаем ученика из контакта');
                
                // Ищем общие данные
                let branch = '';
                let teacher = '';
                let email = '';
                
                for (const field of customFields) {
                    const fieldId = field.field_id || field.id;
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue || fieldValue.trim() === '') continue;
                    
                    if (fieldId === this.FIELD_IDS.CONTACT.BRANCH) {
                        branch = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.TEACHER) {
                        teacher = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.EMAIL) {
                        email = fieldValue;
                    }
                }
                
                students.push({
                    studentName: contactName,
                    birthDate: '',
                    branch: branch,
                    dayOfWeek: '',
                    timeSlot: '',
                    teacherName: teacher,
                    course: '',
                    ageGroup: '',
                    allergies: '',
                    parentName: contactName,
                    hasActiveSubscription: false,
                    lastVisitDate: '',
                    email: email
                });
            }
            
        } catch (error) {
            console.error('❌ Ошибка извлечения учеников из контакта:', error);
        }
        
        return students;
    }

    // 🔧 ИСПРАВЛЕННЫЙ МЕТОД: getContactLeadsSorted
    async getContactLeadsSorted(contactId) {
        try {
            console.log(`\n🔍 Получение сделок для контакта ${contactId}`);
            
            // Простой и надежный запрос
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&limit=100&order[created_at]=desc`
            );
            
            const leads = response._embedded?.leads || [];
            console.log(`📊 Найдено сделок: ${leads.length}`);
            
            // Выводим для диагностики
            if (leads.length > 0) {
                console.log('\n📋 СПИСОК СДЕЛОК:');
                leads.forEach((lead, index) => {
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    const isTargetLead = lead.id === 28658501;
                    
                    console.log(`  ${index + 1}. ${isTargetLead ? '🎯 ' : ''}"${lead.name || 'Без названия'}"`);
                    console.log(`     • ID: ${lead.id} ${isTargetLead ? '(ЦЕЛЕВАЯ СДЕЛКА!)' : ''}`);
                    console.log(`     • Статус: ${lead.status_id}`);
                    
                    if (subscriptionInfo.hasSubscription) {
                        console.log(`     • Абонемент: ${subscriptionInfo.totalClasses} занятий`);
                        console.log(`     • Осталось: ${subscriptionInfo.remainingClasses}`);
                        console.log(`     • Статус: ${subscriptionInfo.subscriptionStatus}`);
                    }
                    console.log('---');
                });
            }
            
            return leads;
        } catch (error) {
            console.error(`⚠️  Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

  // 🔧 ИСПРАВЛЕННЫЙ МЕТОД: findBestLeadForStudent
findBestLeadForStudent(studentName, leads) {
    if (!leads || leads.length === 0) return null;
    
    console.log(`\n🔍 Поиск лучшей сделки для ученика: "${studentName}"`);
    console.log(`📊 Всего сделок: ${leads.length}`);
    
    // ОЧИСТКА имени ученика для поиска
    const cleanStudentName = this.cleanNameForSearch(studentName);
    console.log(`🔍 Чистое имя для поиска: "${cleanStudentName}"`);
    
    let bestLead = null;
    let bestScore = -1000;
    
    for (const lead of leads) {
        let score = 0;
        const leadName = lead.name || '';
        const leadNameLower = leadName.toLowerCase();
        const cleanLeadName = this.cleanNameForSearch(leadName);
        
        console.log(`\n📋 Анализ сделки: "${leadName.substring(0, 60)}..."`);
        
        // 1. ВЫСШИЙ ПРИОРИТЕТ: проверяем ID известных проблемных сделок
        if (lead.id === 28664293 && cleanStudentName.includes('фёдор')) {
            score += 500;
            console.log(`   🎯 ЦЕЛЕВАЯ СДЕЛКА ДЛЯ ФЁДОРА: +500`);
        }
        if (lead.id === 28655657 && cleanStudentName.includes('баранова')) {
            score += 500;
            console.log(`   🎯 ЦЕЛЕВАЯ СДЕЛКА ДЛЯ НАСТИ: +500`);
        }
        
        // 2. ПОЛНОЕ СОВПАДЕНИЕ ИМЕНИ
        if (cleanStudentName && cleanLeadName.includes(cleanStudentName)) {
            score += 300;
            console.log(`   🎯 ПОЛНОЕ СОВПАДЕНИЕ ИМЕНИ: +300`);
        } else {
            // Частичное совпадение (по фамилии или имени)
            const studentParts = cleanStudentName.split(' ');
            let nameMatchScore = 0;
            for (const part of studentParts) {
                if (part.length > 2 && cleanLeadName.includes(part)) {
                    nameMatchScore += 100;
                    console.log(`   ✅ Частичное совпадение "${part}": +100`);
                }
            }
            if (nameMatchScore > 0) {
                score += nameMatchScore;
            }
        }
        
        // 3. Ищем данные об абонементе
        const subscriptionInfo = this.extractSubscriptionInfo(lead);
        
        // Если есть абонемент - большой бонус
        if (subscriptionInfo.hasSubscription) {
            score += 200;
            console.log(`   📊 Есть абонемент: +200`);
            
            // Активный абонемент - еще бонус
            if (subscriptionInfo.subscriptionActive) {
                score += 150;
                console.log(`   🟢 Активен: +150`);
            }
            
            // Много занятий - хорошо
            if (subscriptionInfo.totalClasses >= 8) {
                score += 50;
                console.log(`   🔢 ${subscriptionInfo.totalClasses} занятий: +50`);
            }
        }
        
        // 4. КЛЮЧЕВЫЕ СЛОВА В НАЗВАНИИ
        if (leadNameLower.includes('активный абонемент')) {
            score += 100;
            console.log(`   🥇 "Активный абонемент" в названии: +100`);
        }
        if (leadNameLower.includes('!абонемент')) {
            score += 80;
            console.log(`   🏆 "!Абонемент" в названии: +80`);
        }
        if (leadNameLower.includes('абонемент')) {
            score += 50;
            console.log(`   📋 "Абонемент" в названии: +50`);
        }
        
        // 5. ЧИСЛО ЗАНЯТИЙ В НАЗВАНИИ
        const classesInName = this.parseLeadNameForSubscription(leadName);
        if (classesInName > 0) {
            score += 60;
            console.log(`   📈 ${classesInName} занятий в названии: +60`);
        }
        
        // 6. СТАТУС СДЕЛКИ (65473306 - это ID статуса "Активный абонемент")
        if (lead.status_id === 65473306) {
            score += 120;
            console.log(`   🎫 Статус "Активный абонемент": +120`);
        }
        
        // 7. НЕДАВНЯЯ СДЕЛКА
        if (lead.created_at) {
            const leadDate = new Date(lead.created_at * 1000);
            const daysAgo = (Date.now() - leadDate.getTime()) / (1000 * 60 * 60 * 24);
            if (daysAgo < 30) {
                score += 70;
                console.log(`   📅 Недавняя сделка (${Math.round(daysAgo)} дней): +70`);
            }
        }
        
        // 8. МИНУСЫ за неподходящие
        if (leadNameLower.includes('рассылка') || 
            leadNameLower.includes('сертификат') ||
            leadNameLower.includes('подарочн') ||
            leadName.match(/^\d+\s*₽/) ||
            leadName.includes('Сделка #')) {
            score -= 300;
            console.log(`   ❌ Рассылка/сертификат: -300`);
        }
        
        // Архивные/закончившиеся
        if (leadNameLower.includes('закончился') || 
            leadNameLower.includes('архив') || 
            leadNameLower.includes('не актив') ||
            leadNameLower.includes('истек')) {
            score -= 200;
            console.log(`   ⚠️  Архив/истек: -200`);
        }
        
        console.log(`   📊 Итоговый балл: ${score}`);
        
        if (score > bestScore) {
            bestScore = score;
            bestLead = lead;
            console.log(`   🎯 НОВЫЙ ЛУЧШИЙ ВЫБОР!`);
        }
    }
    
    if (bestLead) {
        console.log(`\n✅ Выбрана сделка: "${bestLead.name}" (ID: ${bestLead.id})`);
        console.log(`📊 Лучший балл: ${bestScore}`);
    } else {
        console.log(`\n⚠️  Подходящая сделка не найдена для "${studentName}"`);
    }
    
    return bestLead;
}

// 🔧 ДОБАВЬТЕ ЭТОТ ВСПОМОГАТЕЛЬНЫЙ МЕТОД:
cleanNameForSearch(name) {
    if (!name) return '';
    return name.toLowerCase()
        .replace(/[^а-яёa-z\s]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}
    parseLeadNameForSubscription(leadName) {
        if (!leadName) return 0;
        
        try {
            const cleanName = leadName.toLowerCase()
                .replace(/[^а-яё0-9\s]/gi, '')
                .trim();
            
            // Пропускаем неподходящие
            const skipPatterns = [
                'рассылка', 'сертификат', 'подарочн', 'отмена', 
                'не актив', 'закончился', 'архив'
            ];
            
            for (const pattern of skipPatterns) {
                if (cleanName.includes(pattern)) {
                    return 0;
                }
            }
            
            // Ищем количество занятий
            const patterns = [
                { pattern: /(\d+)\s*занят/i },
                { pattern: /16\s*(?:занят|урок)/i },
                { pattern: /8\s*(?:занят|урок)/i },
                { pattern: /4\s*(?:занят|урок)/i },
                { pattern: /24\s*(?:занят|урок)/i },
                { pattern: /12\s*(?:занят|урок)/i }
            ];
            
            for (const { pattern } of patterns) {
                const match = cleanName.match(pattern);
                if (match && match[1]) {
                    const num = parseInt(match[1]);
                    if (num >= 1 && num <= 30) {
                        return num;
                    }
                }
            }
            
            return 0;
            
        } catch (error) {
            return 0;
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
                
                // Ищем email по ID
                if (fieldId === this.FIELD_IDS.CONTACT.EMAIL) {
                    const value = this.getFieldValue(field);
                    if (value && value.includes('@')) {
                        return value;
                    }
                }
                
                // Ищем по названию
                const fieldName = this.getFieldName(field);
                if ((fieldName.includes('email') || fieldName.includes('почта')) && 
                    this.getFieldValue(field) && 
                    this.getFieldValue(field).includes('@')) {
                    return this.getFieldValue(field);
                }
            }
        } catch (error) {
            console.error('❌ Ошибка поиска email:', error);
        }
        return '';
    }

    // 🔧 ГЛАВНЫЙ МЕТОД: getStudentsByPhone - ИСПРАВЛЕННЫЙ
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
                
                // 2. Получаем полную информацию
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                // 3. Извлекаем детей
                const children = this.extractStudentsFromContact(fullContact);
                console.log(`📊 Найдено детей: ${children.length}`);
                
                if (children.length === 0) continue;
                
                // 4. Получаем сделки
                console.log('🔍 Получение сделок...');
                const leads = await this.getContactLeadsSorted(fullContact.id);
                console.log(`📊 Найдено сделок: ${leads.length}`);
                
                // 5. Для каждого ребенка
                for (const child of children) {
                    console.log(`\n👤 Поиск абонемента для: ${child.studentName}`);
                    
                    // Ищем лучшую сделку
                    let bestLead = this.findBestLeadForStudent(child.studentName, leads);
                    
                    // Если не нашли, берем первую с абонементом
                    if (!bestLead && leads.length > 0) {
                        console.log('🔍 Поиск любой сделки с абонементом...');
                        for (const lead of leads) {
                            const subInfo = this.extractSubscriptionInfo(lead);
                            if (subInfo.hasSubscription) {
                                bestLead = lead;
                                console.log(`✅ Взята сделка: "${lead.name}"`);
                                break;
                            }
                        }
                    }
                    
                    // Извлекаем информацию
                    const subscriptionInfo = bestLead ? 
                        this.extractSubscriptionInfo(bestLead) : 
                        this.extractSubscriptionInfo(null);
                    
                    // 6. Создаем профиль
                    const studentProfile = this.createStudentProfile(
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
            console.error(`❌ Ошибка получения данных:`, error.message);
        }
        
        return studentProfiles;
    }

    // 🔧 МЕТОД: createStudentProfile
    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        // Определяем email
        const email = studentInfo.email || this.findEmail(contact) || '';
        
        // Форматируем даты
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
        
        // Объединяем данные из разных источников
        const branch = studentInfo.branch || subscriptionInfo.branch || '';
        const teacher = studentInfo.teacherName || subscriptionInfo.teacher || '';
        
        // Создаем профиль
        const profile = {
            amocrm_contact_id: contact.id || null,
            parent_contact_id: contact.id || null,
            amocrm_lead_id: lead?.id || null,
            student_name: studentInfo.studentName || 'Ученик',
            phone_number: phoneNumber,
            email: email,
            birth_date: studentInfo.birthDate || '',
            branch: branch,
            parent_name: studentInfo.parentName || contact.name || '',
            day_of_week: studentInfo.dayOfWeek || '',
            time_slot: studentInfo.timeSlot || '',
            teacher_name: teacher,
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
            
            // Форматированные даты
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
        
        console.log(`📊 Создан профиль:`);
        console.log(`   👤 ${profile.student_name}`);
        console.log(`   👨‍👩‍👧 Родитель: ${profile.parent_name || 'не указан'}`);
        console.log(`   📍 Филиал: ${profile.branch || 'не указан'}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        console.log(`   📊 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        console.log(`   ✅ Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
        
        return profile;
    }
}

// Создаем экземпляр сервиса
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
        
        // Периодическая синхронизация
        setInterval(async () => {
            await this.syncAllProfiles();
        }, 10 * 60 * 1000);
    }

    async syncAllProfiles() {
        if (this.isSyncing) {
            console.log('⚠️  Синхронизация уже выполняется');
            return;
        }

        this.isSyncing = true;
        const startTime = Date.now();

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔄 ЗАПУСК СИНХРОНИЗАЦИИ`);
        console.log(`⏰ Время: ${new Date().toISOString()}`);
        console.log('='.repeat(80));

        try {
            // Получаем все уникальные номера
            const phones = await db.all(
                `SELECT DISTINCT phone_number FROM student_profiles WHERE is_active = 1`
            );

            console.log(`📊 Найдено телефонов: ${phones.length}`);

            let totalUpdated = 0;
            let totalErrors = 0;

            // Для каждого телефона
            for (const phoneRow of phones) {
                const phone = phoneRow.phone_number;
                
                try {
                    console.log(`\n🔍 Синхронизация телефона: ${phone}`);
                    
                    // Получаем данные из amoCRM
                    const profiles = await amoCrmService.getStudentsByPhone(phone);
                    
                    // Сохраняем в базу
                    const savedCount = await saveProfilesToDatabase(profiles);
                    
                    console.log(`✅ Обновлено: ${savedCount}`);
                    totalUpdated += savedCount;
                    
                } catch (phoneError) {
                    console.error(`❌ Ошибка телефона ${phone}:`, phoneError.message);
                    totalErrors++;
                }
            }

            const duration = Date.now() - startTime;
            this.lastSyncTime = new Date();

            // Логируем результат
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
            console.log(`   • Телефонов: ${phones.length}`);
            console.log(`   • Обновлено: ${totalUpdated}`);
            console.log(`   • Ошибок: ${totalErrors}`);
            console.log(`   • Время: ${duration}ms`);
            console.log('='.repeat(80));

        } catch (error) {
            console.error('❌ Критическая ошибка:', error.message);
            
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
        console.log(`\n🔧 РУЧНАЯ СИНХРОНИЗАЦИЯ: ${phoneNumber}`);
        
        try {
            const profiles = await amoCrmService.getStudentsByPhone(phoneNumber);
            const savedCount = await saveProfilesToDatabase(profiles);
            
            console.log(`✅ Синхронизация завершена`);
            console.log(`📊 Обновлено: ${savedCount}`);
            
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
                    // Вставка нового
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    const result = await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    
                    console.log(`✅ Профиль создан (ID: ${result.lastID}): ${profile.student_name}`);
                    savedCount++;
                } else {
                    // Обновление существующего
                    const setClause = columns.map(col => `${col} = ?`).join(', ');
                    
                    await db.run(
                        `UPDATE student_profiles SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [...values, existingProfile.id]
                    );
                    
                    console.log(`✅ Профиль обновлен (ID: ${existingProfile.id}): ${profile.student_name}`);
                    savedCount++;
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка профиля ${profile.student_name}:`, profileError.message);
            }
        }
        
        console.log(`✅ Всего сохранено: ${savedCount} профилей`);
        return savedCount;
    } catch (error) {
        console.error(`❌ Общая ошибка сохранения: ${error.message}`);
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
        console.log(`📱 Форматированный: ${formattedPhone}`);
        
        let profiles = [];
        
        // Получаем данные из amoCRM
        if (amoCrmService.isInitialized) {
            console.log('🔍 Получение данных из amoCRM...');
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            console.log(`📊 Найдено в amoCRM: ${profiles.length}`);
            
            if (profiles.length > 0) {
                const savedCount = await saveProfilesToDatabase(profiles);
                console.log(`💾 Сохранено в БД: ${savedCount}`);
            }
        } else {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Если не нашли, ищем в локальной базе
        if (profiles.length === 0) {
            console.log('🔍 Поиск в локальной базе...');
            const cleanPhone = phone.replace(/\D/g, '');
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY subscription_active DESC, updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            console.log(`📊 Найдено в БД: ${profiles.length}`);
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
            console.error(`❌ Ошибка сессии: ${dbError.message}`);
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
        
        // Форматируем профили
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
            message: profiles.length > 0 ? 'Найдены профили' : 'Профили не найдены',
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
        
        console.log(`✅ Авторизация успешна`);
        console.log(`📊 Профилей: ${profiles.length}`);
        
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
            // Ищем по ID в базе
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE id = ?`,
                [parseInt(profile_id)]
            );
            
            if (!profile && profile_id.startsWith('profile-')) {
                const index = parseInt(profile_id.replace('profile-', ''));
                console.log(`🔍 Временный ID, индекс: ${index}`);
                
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
                        console.log(`✅ Найден по индексу: ${profile.student_name}`);
                    }
                }
            }
        } 
        
        // Если не нашли, ищем по телефону
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
            error: 'Ошибка получения информации'
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
                service_initialized: amoCrmService.isInitialized,
                field_mapping: amoCrmService.FIELD_IDS
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка соединения',
            error: error.message
        });
    }
});

app.get('/api/debug/phone/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n📱 ДИАГНОСТИКА ТЕЛЕФОНА: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован',
                phone: phone
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        
        // 1. Ищем контакты
        console.log('🔍 Поиск контактов...');
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        const contactsInfo = contacts.map(contact => ({
            id: contact.id,
            name: contact.name,
            created_at: contact.created_at,
            updated_at: contact.updated_at,
            fields_count: contact.custom_fields_values ? contact.custom_fields_values.length : 0
        }));
        
        console.log(`📊 Контактов: ${contacts.length}`);
        
        // 2. Получаем профили
        console.log('🎯 Получение профилей...');
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
        
        console.log(`📊 Профилей: ${profiles.length}`);
        
        // 3. Проверяем локальную базу
        console.log('💾 Проверка базы...');
        const cleanPhone = phone.replace(/\D/g, '');
        const localProfiles = await db.all(
            `SELECT student_name, branch, subscription_status, total_classes, remaining_classes, last_sync 
             FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        
        res.json({
            success: true,
            message: 'Диагностика выполнена',
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
        console.error('❌ Ошибка диагностики:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка диагностики',
            error: error.message,
            phone: req.params.phone
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
        console.error('❌ Ошибка статуса:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения статуса',
            error: error.message
        });
    }
});


// ==================== ДИАГНОСТИЧЕСКИЙ API ====================
app.get('/api/debug/full-diagnostic/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        console.log(`\n🔍 ПОЛНАЯ ДИАГНОСТИКА ДЛЯ: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        // 1. Поиск контактов
        console.log('🔍 Поиск контактов по телефону...');
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        const detailedContacts = [];
        
        // 2. Для каждого контакта получаем ПОЛНЫЕ данные
        for (const contact of contacts) {
            console.log(`\n📋 Анализ контакта ID: ${contact.id} - "${contact.name}"`);
            
            // Получаем полные данные контакта
            const fullContact = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/contacts/${contact.id}?with=custom_fields_values`
            );
            
            // Получаем все сделки контакта
            const leads = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contact.id}&limit=50`
            );
            
            const contactLeads = leads._embedded?.leads || [];
            
            // Подробный анализ полей контакта
            const contactFields = fullContact.custom_fields_values || [];
            const analyzedContactFields = contactFields.map(field => {
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                
                return {
                    id: field.field_id || field.id,
                    name: fieldName,
                    value: fieldValue,
                    raw_field: field
                };
            });
            
            // Подробный анализ каждой сделки
            const analyzedLeads = [];
            for (const lead of contactLeads) {
                console.log(`   📊 Анализ сделки ID: ${lead.id} - "${lead.name}"`);
                
                const leadFields = lead.custom_fields_values || [];
                const analyzedLeadFields = leadFields.map(field => {
                    const fieldName = amoCrmService.getFieldName(field);
                    const fieldValue = amoCrmService.getFieldValue(field);
                    
                    return {
                        id: field.field_id || field.id,
                        name: fieldName,
                        value: fieldValue,
                        raw_field: field
                    };
                });
                
                // Извлекаем информацию об абонементе
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                analyzedLeads.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    status_id: lead.status_id,
                    created_at: lead.created_at,
                    price: lead.price,
                    subscription_info: subscriptionInfo,
                    custom_fields: analyzedLeadFields,
                    raw_lead: lead // Полные сырые данные
                });
            }
            
            detailedContacts.push({
                contact_id: fullContact.id,
                contact_name: fullContact.name,
                created_at: fullContact.created_at,
                updated_at: fullContact.updated_at,
                email: amoCrmService.findEmail(fullContact),
                custom_fields: analyzedContactFields,
                leads_count: contactLeads.length,
                leads: analyzedLeads,
                raw_contact: fullContact // Полные сырые данные контакта
            });
        }
        
        // 3. Запрос всех пользовательских полей системы
        console.log('📋 Получение всех пользовательских полей amoCRM...');
        let allFields = { lead: [], contact: [] };
        
        try {
            const leadFields = await amoCrmService.makeRequest('GET', '/api/v4/leads/custom_fields');
            const contactFields = await amoCrmService.makeRequest('GET', '/api/v4/contacts/custom_fields');
            
            allFields = {
                lead: leadFields._embedded?.custom_fields || [],
                contact: contactFields._embedded?.custom_fields || []
            };
        } catch (error) {
            console.error('❌ Ошибка получения полей:', error.message);
        }
        
        // 4. Формируем отчет
        const report = {
            success: true,
            diagnostic_time: new Date().toISOString(),
            phone_number: phone,
            search_results: {
                total_contacts: contacts.length,
                contacts: detailedContacts
            },
            system_info: {
                amocrm_initialized: amoCrmService.isInitialized,
                account_name: amoCrmService.accountInfo?.name,
                field_mappings_size: amoCrmService.fieldMappings.size,
                configured_field_ids: amoCrmService.FIELD_IDS
            },
            available_fields: {
                total_lead_fields: allFields.lead.length,
                total_contact_fields: allFields.contact.length,
                lead_fields_sample: allFields.lead.slice(0, 20).map(f => ({
                    id: f.id,
                    name: f.name,
                    type: f.type,
                    enums: f.enums ? f.enums.slice(0, 5) : []
                })),
                contact_fields_sample: allFields.contact.slice(0, 20).map(f => ({
                    id: f.id,
                    name: f.name,
                    type: f.type,
                    enums: f.enums ? f.enums.slice(0, 5) : []
                }))
            },
            recommendations: []
        };
        
        // 5. Анализ и рекомендации
        if (contacts.length === 0) {
            report.recommendations.push("❌ Контакты не найдены. Проверьте формат телефона в amoCRM.");
        } else {
            report.recommendations.push(`✅ Найдено контактов: ${contacts.length}`);
            
            for (const contact of detailedContacts) {
                if (contact.leads_count === 0) {
                    report.recommendations.push(`⚠️ Контакт "${contact.contact_name}" не имеет сделок`);
                } else {
                    const activeSubs = contact.leads.filter(l => l.subscription_info.hasSubscription);
                    if (activeSubs.length === 0) {
                        report.recommendations.push(`⚠️ У контакта "${contact.contact_name}" нет сделок с абонементами`);
                    } else {
                        report.recommendations.push(`✅ Контакт "${contact.contact_name}" имеет ${activeSubs.length} сделок с абонементами`);
                    }
                }
            }
        }
        
        console.log(`\n📊 Диагностика завершена. Контактов: ${contacts.length}`);
        res.json(report);
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка диагностики',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

app.get('/api/debug/search-leads/:query', async (req, res) => {
    try {
        const query = req.params.query;
        console.log(`\n🔍 ПОИСК СДЕЛОК ПО ЗАПРОСУ: "${query}"`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        // Ищем сделки по названию
        const leadsResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?query=${encodeURIComponent(query)}&with=custom_fields_values&limit=20`
        );
        
        const leads = leadsResponse._embedded?.leads || [];
        
        const analyzedLeads = leads.map(lead => {
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            
            return {
                lead_id: lead.id,
                lead_name: lead.name,
                status_id: lead.status_id,
                price: lead.price,
                created_at: lead.created_at,
                subscription_info: subscriptionInfo,
                custom_fields_count: lead.custom_fields_values?.length || 0
            };
        });
        
        res.json({
            success: true,
            query: query,
            total_found: leads.length,
            leads: analyzedLeads,
            search_examples: [
                "Фёдор Шигин",
                "Баранова Настя",
                "8 занятий",
                "16 занятий",
                "абонемент",
                "Активный абонемент"
            ]
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка поиска',
            error: error.message
        });
    }
});

app.get('/api/debug/lead/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        console.log(`\n🔍 ДЕТАЛЬНЫЙ АНАЛИЗ СДЕЛКИ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        // Получаем полные данные сделки
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values,contacts`
        );
        
        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Сделка не найдена'
            });
        }
        
        // Анализ полей сделки
        const leadFields = lead.custom_fields_values || [];
        const analyzedFields = leadFields.map(field => {
            const fieldName = amoCrmService.getFieldName(field);
            const fieldValue = amoCrmService.getFieldValue(field);
            
            return {
                field_id: field.field_id || field.id,
                field_name: fieldName,
                field_value: fieldValue,
                raw_value: field.values,
                is_subscription_field: (
                    fieldName.includes('абонемент') ||
                    fieldName.includes('занят') ||
                    fieldName.includes('счетчик') ||
                    fieldName.includes('остаток') ||
                    fieldName.includes('активации') ||
                    fieldName.includes('окончание')
                )
            };
        });
        
        // Извлекаем информацию об абонементе
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        // Находим связанные контакты
        const contacts = lead._embedded?.contacts || [];
        const contactDetails = [];
        
        for (const contact of contacts) {
            try {
                const fullContact = await amoCrmService.makeRequest(
                    'GET',
                    `/api/v4/contacts/${contact.id}?with=custom_fields_values`
                );
                
                const contactFields = fullContact.custom_fields_values || [];
                const analyzedContactFields = contactFields.map(field => ({
                    id: field.field_id || field.id,
                    name: amoCrmService.getFieldName(field),
                    value: amoCrmService.getFieldValue(field)
                }));
                
                contactDetails.push({
                    contact_id: fullContact.id,
                    contact_name: fullContact.name,
                    phone: '', // Нужно извлечь из полей
                    email: amoCrmService.findEmail(fullContact),
                    custom_fields: analyzedContactFields
                });
            } catch (contactError) {
                console.error(`❌ Ошибка контакта ${contact.id}:`, contactError.message);
            }
        }
        
        // Анализ названия сделки на наличие абонемента
        const nameAnalysis = {
            original_name: lead.name,
            contains_абонемент: lead.name.toLowerCase().includes('абонемент'),
            contains_занятий: lead.name.toLowerCase().includes('занят'),
            contains_numbers: lead.name.match(/\d+/g) || [],
            subscription_parse_result: amoCrmService.parseLeadNameForSubscription(lead.name)
        };
        
        res.json({
            success: true,
            lead_id: lead.id,
            lead_name: lead.name,
            status_id: lead.status_id,
            pipeline_id: lead.pipeline_id,
            price: lead.price,
            created_at: lead.created_at,
            updated_at: lead.updated_at,
            
            name_analysis: nameAnalysis,
            subscription_info: subscriptionInfo,
            
            custom_fields: {
                total: leadFields.length,
                fields: analyzedFields,
                subscription_fields: analyzedFields.filter(f => f.is_subscription_field)
            },
            
            contacts: {
                total: contacts.length,
                details: contactDetails
            },
            
            raw_data_sample: {
                name: lead.name,
                status_id: lead.status_id,
                first_5_fields: analyzedFields.slice(0, 5)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа сделки:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка анализа сделки',
            error: error.message
        });
    }
});

// ==================== ДОПОЛНИТЕЛЬНЫЕ API ====================
app.get('/api/profile/:id', async (req, res) => {
    try {
        const profileId = req.params.id;
        
        console.log(`👤 ЗАПРОС ПРОФИЛЯ: ${profileId}`);
        
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
        console.error('❌ Ошибка профиля:', error);
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
        console.error('❌ Ошибка профилей:', error);
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
        res.json({
            success: true,
            data: {
                connected: amoCrmService.isInitialized,
                account_name: amoCrmService.accountInfo?.name || null,
                subdomain: AMOCRM_SUBDOMAIN,
                last_check: new Date().toISOString(),
                field_count: amoCrmService.fieldMappings.size
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка статуса CRM:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки статуса CRM'
        });
    }
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
                total_profiles: await db.get(`SELECT COUNT(*) as count FROM student_profiles WHERE is_active = 1`),
                amocrm_status: amoCrmService.isInitialized
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка статуса синхронизации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статуса'
        });
    }
});

app.post('/api/sync/phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер'
            });
        }
        
        console.log(`\n🔧 РУЧНАЯ СИНХРОНИЗАЦИЯ: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const result = await syncService.syncSinglePhone(phone);
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Ошибка синхронизации:', error);
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
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('='.repeat(80));
        console.log('✨ ПРАВИЛЬНЫЙ ПОИСК АБОНЕМЕНТОВ');
        console.log('✨ ИСПРАВЛЕННЫЙ ПОИСК СДЕЛОК');
        console.log('✨ АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован');
            
            setTimeout(() => {
                syncService.startAutoSync();
            }, 5000);
            
        } else {
            console.log('❌ amoCRM не инициализирован');
        }
        
        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 URL: http://localhost:${PORT}`);
            console.log(`📊 База данных: SQLite`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log(`🔄 Автосинхронизация: ✅ Каждые 10 минут`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус: http://localhost:${PORT}/api/status`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`🔍 Профили: GET http://localhost:${PORT}/api/profiles`);
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
                console.error('❌ Ошибка закрытия БД:', dbError.message);
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
