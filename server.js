// server.js - ПОЛНОСТЬЮ ПЕРЕПИСАННАЯ И ИСПРАВЛЕННАЯ ВЕРСИЯ
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
        this.accountInfo = null;
        
        // Кэш полей
        this.fieldCache = {
            leadFields: new Map(),
            contactFields: new Map()
        };
        
        // ID полей из вашей диагностики
        this.FIELD_IDS = {
            LEAD: {
                // Основные поля абонемента
                TOTAL_CLASSES: 850241,        // "Абонемент занятий:"
                USED_CLASSES: 850257,         // "Счетчик занятий:"
                REMAINING_CLASSES: 890163,    // "Остаток занятий"
                EXPIRATION_DATE: 850255,      // "Окончание абонемента:"
                ACTIVATION_DATE: 851565,      // "Дата активации абонемента:"
                LAST_VISIT_DATE: 850259,      // "Дата последнего визита:"
                SUBSCRIPTION_TYPE: 891007,    // "Тип абонемента"
                BRANCH: 891589,               // "Филиал" (предположительно)
                AGE_GROUP: 850243,            // "Группа возраст:"
                FREEZE: 867693,               // "Заморозка абонемента:"
                SUBSCRIPTION_OWNER: 805465,   // "Принадлежность абонемента:"
                
                // Дополнительные поля
                PRICE_PER_CLASS: 891813,      // "Стоимость 1 занятия"
                TECHNICAL_CLASSES: 891819,    // "Количество занятий (тех)"
                ATTENDED_CLASSES: 884251,     // "Кол-во отхоженных занятий"
                IS_OLD_WRITE_OFF: 890125,     // "Старое списание абонементов"
                IS_PROMOTION: 891461,         // "Отходил абонемент по акции"
                TRANSFER_REASON: 890169,      // "Причина переноса срока абонемента"
                SUBSCRIPTION_DETAILS: 885051, // "---Инфо по занятиям---"
                PURCHASE_DATE: 850253,        // "Дата покупки:"
                ADVERTISING_CHANNEL: 850251   // "Рекламный канал:"
            },
            
            CONTACT: {
                // Поля детей
                CHILD_1_NAME: null,
                CHILD_2_NAME: null,
                CHILD_3_NAME: null,
                CHILD_1_BIRTHDAY: null,
                CHILD_2_BIRTHDAY: null,
                CHILD_3_BIRTHDAY: null,
                
                // Общие поля
                BRANCH: null,
                TEACHER: null,
                DAY_OF_WEEK: null,
                HAS_ACTIVE_SUB: null,
                LAST_VISIT: null,
                AGE_GROUP: null,
                ALLERGIES: null,
                BIRTH_DATE: null,
                PARENT_NAME: 'name',
                EMAIL: null,
                PHONE: null
            }
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
            console.log('📋 Загрузка полей amoCRM...');
            
            // Загружаем поля контактов
            const contactFields = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            this.mapContactFields(contactFields);
            
            // Выводим информацию о маппинге
            console.log('\n' + '='.repeat(80));
            console.log('📊 ИТОГОВЫЙ МАППИНГ ПОЛЕЙ');
            console.log('='.repeat(80));
            
            console.log('\n🎫 ПОЛЯ СДЕЛОК (абонементы):');
            console.log('-'.repeat(40));
            for (const [key, value] of Object.entries(this.FIELD_IDS.LEAD)) {
                console.log(`  ${key.padEnd(25)}: ${value} ${value ? '✅' : '❌'}`);
            }
            
            console.log('\n👤 ПОЛЯ КОНТАКТОВ (ученики):');
            console.log('-'.repeat(40));
            for (const [key, value] of Object.entries(this.FIELD_IDS.CONTACT)) {
                if (value === 'name') {
                    console.log(`  ${key.padEnd(25)}: (системное поле)`);
                } else {
                    console.log(`  ${key.padEnd(25)}: ${value || '❌ НЕ НАЙДЕНО'}`);
                }
            }
            console.log('='.repeat(80));
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка загрузки полей:', error.message);
            return false;
        }
    }

    async mapContactFields(fieldsResponse) {
        if (!fieldsResponse?._embedded?.custom_fields) {
            console.log('⚠️  Поля контактов не найдены');
            return;
        }
        
        const fields = fieldsResponse._embedded.custom_fields;
        console.log(`📊 Найдено полей контактов: ${fields.length}`);
        
        // Выводим все поля контактов для диагностики
        console.log('\n📋 ВСЕ ПОЛЯ КОНТАКТОВ:');
        console.log('-'.repeat(40));
        
        let childFields = [];
        let contactInfoFields = [];
        let otherFields = [];
        
        for (const field of fields) {
            const fieldName = field.name.toLowerCase();
            const fieldId = field.id;
            
            // Сохраняем в кэш
            this.fieldCache.contactFields.set(fieldId, {
                id: fieldId,
                name: field.name,
                type: field.type,
                enums: field.enums || []
            });
            
            // Маппинг полей
            if (fieldName.includes('ребен') || fieldName.includes('ученик') || fieldName.includes('фио')) {
                if (!fieldName.includes('день рождения')) {
                    childFields.push(field);
                }
                
                // Маппинг конкретных полей
                if (fieldName.includes('ребенок 1') || fieldName.includes('1 ребенок')) {
                    this.FIELD_IDS.CONTACT.CHILD_1_NAME = fieldId;
                } else if (fieldName.includes('ребенок 2') || fieldName.includes('2 ребенок')) {
                    this.FIELD_IDS.CONTACT.CHILD_2_NAME = fieldId;
                } else if (fieldName.includes('ребенок 3') || fieldName.includes('3 ребенок')) {
                    this.FIELD_IDS.CONTACT.CHILD_3_NAME = fieldId;
                }
            }
            
            // Дни рождения
            else if (fieldName.includes('день рождения')) {
                if (fieldName.includes('ребенок 1') || fieldName.includes('1 ребенок')) {
                    this.FIELD_IDS.CONTACT.CHILD_1_BIRTHDAY = fieldId;
                } else if (fieldName.includes('ребенок 2') || fieldName.includes('2 ребенок')) {
                    this.FIELD_IDS.CONTACT.CHILD_2_BIRTHDAY = fieldId;
                } else if (fieldName.includes('ребенок 3') || fieldName.includes('3 ребенок')) {
                    this.FIELD_IDS.CONTACT.CHILD_3_BIRTHDAY = fieldId;
                } else if (!fieldName.includes('ребен')) {
                    this.FIELD_IDS.CONTACT.BIRTH_DATE = fieldId;
                }
            }
            
            // Другие поля
            else if (fieldName.includes('филиал') || fieldName.includes('центр')) {
                this.FIELD_IDS.CONTACT.BRANCH = fieldId;
                contactInfoFields.push(field);
            } else if (fieldName.includes('преподаватель') || fieldName.includes('педагог')) {
                this.FIELD_IDS.CONTACT.TEACHER = fieldId;
                contactInfoFields.push(field);
            } else if (fieldName.includes('день недел') || fieldName.includes('расписание')) {
                this.FIELD_IDS.CONTACT.DAY_OF_WEEK = fieldId;
                contactInfoFields.push(field);
            } else if (fieldName.includes('почта') || fieldName.includes('email')) {
                this.FIELD_IDS.CONTACT.EMAIL = fieldId;
                contactInfoFields.push(field);
            } else if (fieldName.includes('телефон') && fieldName.includes('доп')) {
                this.FIELD_IDS.CONTACT.PHONE = fieldId;
                contactInfoFields.push(field);
            } else if (fieldName.includes('аллерг') || fieldName.includes('особенност')) {
                this.FIELD_IDS.CONTACT.ALLERGIES = fieldId;
                contactInfoFields.push(field);
            } else if (fieldName.includes('возраст') || fieldName.includes('группа')) {
                this.FIELD_IDS.CONTACT.AGE_GROUP = fieldId;
                contactInfoFields.push(field);
            } else if (fieldName.includes('актив') && fieldName.includes('абонемент')) {
                this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB = fieldId;
            } else {
                otherFields.push(field);
            }
        }
        
        // Выводим структурированную информацию
        if (childFields.length > 0) {
            console.log('\n👶 ПОЛЯ ДЕТЕЙ:');
            console.log('-'.repeat(40));
            childFields.forEach(f => {
                console.log(`  ${f.id}: ${f.name}`);
            });
        }
        
        if (contactInfoFields.length > 0) {
            console.log('\n📋 КОНТАКТНАЯ ИНФОРМАЦИЯ:');
            console.log('-'.repeat(40));
            contactInfoFields.forEach(f => {
                console.log(`  ${f.id}: ${f.name}`);
            });
        }
        
        if (otherFields.length > 0) {
            console.log('\n⚙️  ДРУГИЕ ПОЛЯ (первые 10):');
            console.log('-'.repeat(40));
            otherFields.slice(0, 10).forEach(f => {
                console.log(`  ${f.id}: ${f.name}`);
            });
            if (otherFields.length > 10) {
                console.log(`  ... и еще ${otherFields.length - 10} полей`);
            }
        }
    }

    extractSubscriptionInfo(lead) {
        console.log(`\n🔍 Анализ сделки: "${lead.name}" (ID: ${lead.id})`);
        
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
            subscriptionOwner: '',
            pricePerClass: 0,
            technicalClasses: 0,
            usedTechnicalClasses: 0,
            isOldWriteOff: false,
            isPromotion: false,
            transferReason: '',
            ageGroup: '',
            purchaseDate: '',
            advertisingChannel: ''
        };
        
        if (!lead || !lead.custom_fields_values) {
            return subscriptionInfo;
        }
        
        try {
            // Создаем карту значений полей
            const fieldMap = {};
            lead.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const value = this.extractFieldValue(field);
                if (value !== null && value !== '') {
                    fieldMap[fieldId] = value;
                }
            });
            
            // Извлекаем данные по известным ID полей
            const FIELD = this.FIELD_IDS.LEAD;
            
            // 1. Общее количество занятий
            if (FIELD.TOTAL_CLASSES && fieldMap[FIELD.TOTAL_CLASSES]) {
                subscriptionInfo.totalClasses = this.parseClassesCount(fieldMap[FIELD.TOTAL_CLASSES]);
                console.log(`✅ TOTAL_CLASSES: ${subscriptionInfo.totalClasses}`);
            }
            
            // 2. Использованные занятия
            if (FIELD.USED_CLASSES && fieldMap[FIELD.USED_CLASSES]) {
                subscriptionInfo.usedClasses = parseInt(fieldMap[FIELD.USED_CLASSES]) || 0;
                console.log(`✅ USED_CLASSES: ${subscriptionInfo.usedClasses}`);
            }
            
            // 3. Остаток занятий
            if (FIELD.REMAINING_CLASSES && fieldMap[FIELD.REMAINING_CLASSES]) {
                subscriptionInfo.remainingClasses = parseInt(fieldMap[FIELD.REMAINING_CLASSES]) || 0;
                console.log(`✅ REMAINING_CLASSES: ${subscriptionInfo.remainingClasses}`);
            }
            
            // 4. Тип абонемента
            if (FIELD.SUBSCRIPTION_TYPE && fieldMap[FIELD.SUBSCRIPTION_TYPE]) {
                subscriptionInfo.subscriptionType = fieldMap[FIELD.SUBSCRIPTION_TYPE];
                console.log(`✅ SUBSCRIPTION_TYPE: ${subscriptionInfo.subscriptionType}`);
            }
            
            // 5. Дата окончания
            if (FIELD.EXPIRATION_DATE && fieldMap[FIELD.EXPIRATION_DATE]) {
                subscriptionInfo.expirationDate = this.parseDateOrTimestamp(fieldMap[FIELD.EXPIRATION_DATE]);
                console.log(`✅ EXPIRATION_DATE: ${subscriptionInfo.expirationDate}`);
            }
            
            // 6. Дата активации
            if (FIELD.ACTIVATION_DATE && fieldMap[FIELD.ACTIVATION_DATE]) {
                subscriptionInfo.activationDate = this.parseDateOrTimestamp(fieldMap[FIELD.ACTIVATION_DATE]);
                console.log(`✅ ACTIVATION_DATE: ${subscriptionInfo.activationDate}`);
            }
            
            // 7. Дата последнего визита
            if (FIELD.LAST_VISIT_DATE && fieldMap[FIELD.LAST_VISIT_DATE]) {
                subscriptionInfo.lastVisitDate = this.parseDateOrTimestamp(fieldMap[FIELD.LAST_VISIT_DATE]);
                console.log(`✅ LAST_VISIT_DATE: ${subscriptionInfo.lastVisitDate}`);
            }
            
            // 8. Возрастная группа
            if (FIELD.AGE_GROUP && fieldMap[FIELD.AGE_GROUP]) {
                subscriptionInfo.ageGroup = fieldMap[FIELD.AGE_GROUP];
                console.log(`✅ AGE_GROUP: ${subscriptionInfo.ageGroup}`);
            }
            
            // 9. Владелец абонемента
            if (FIELD.SUBSCRIPTION_OWNER && fieldMap[FIELD.SUBSCRIPTION_OWNER]) {
                subscriptionInfo.subscriptionOwner = fieldMap[FIELD.SUBSCRIPTION_OWNER];
                console.log(`✅ SUBSCRIPTION_OWNER: ${subscriptionInfo.subscriptionOwner}`);
            }
            
            // 10. Заморозка
            if (FIELD.FREEZE && fieldMap[FIELD.FREEZE]) {
                subscriptionInfo.isFrozen = fieldMap[FIELD.FREEZE].toLowerCase() === 'да';
                console.log(`✅ FREEZE: ${subscriptionInfo.isFrozen ? 'ДА' : 'НЕТ'}`);
            }
            
            // 11. Технические поля
            if (FIELD.TECHNICAL_CLASSES && fieldMap[FIELD.TECHNICAL_CLASSES]) {
                subscriptionInfo.technicalClasses = parseInt(fieldMap[FIELD.TECHNICAL_CLASSES]) || 0;
                console.log(`✅ TECHNICAL_CLASSES: ${subscriptionInfo.technicalClasses}`);
            }
            
            if (FIELD.ATTENDED_CLASSES && fieldMap[FIELD.ATTENDED_CLASSES]) {
                subscriptionInfo.usedTechnicalClasses = parseInt(fieldMap[FIELD.ATTENDED_CLASSES]) || 0;
                console.log(`✅ ATTENDED_CLASSES: ${subscriptionInfo.usedTechnicalClasses}`);
            }
            
            // 12. Стоимость занятия
            if (FIELD.PRICE_PER_CLASS && fieldMap[FIELD.PRICE_PER_CLASS]) {
                subscriptionInfo.pricePerClass = parseFloat(fieldMap[FIELD.PRICE_PER_CLASS]) || 0;
                console.log(`✅ PRICE_PER_CLASS: ${subscriptionInfo.pricePerClass}`);
            }
            
            // 13. Акция
            if (FIELD.IS_PROMOTION && fieldMap[FIELD.IS_PROMOTION]) {
                subscriptionInfo.isPromotion = fieldMap[FIELD.IS_PROMOTION].toLowerCase() === 'да';
                console.log(`✅ IS_PROMOTION: ${subscriptionInfo.isPromotion ? 'ДА' : 'НЕТ'}`);
            }
            
            // 14. Дата покупки
            if (FIELD.PURCHASE_DATE && fieldMap[FIELD.PURCHASE_DATE]) {
                subscriptionInfo.purchaseDate = this.parseDateOrTimestamp(fieldMap[FIELD.PURCHASE_DATE]);
                console.log(`✅ PURCHASE_DATE: ${subscriptionInfo.purchaseDate}`);
            }
            
            // Определяем наличие абонемента
            subscriptionInfo.hasSubscription = subscriptionInfo.totalClasses > 0 || 
                                              subscriptionInfo.technicalClasses > 0 ||
                                              subscriptionInfo.subscriptionType !== '';
            
            // Определяем статус абонемента
            if (subscriptionInfo.hasSubscription) {
                if (subscriptionInfo.isFrozen) {
                    subscriptionInfo.subscriptionStatus = 'Заморожен';
                    subscriptionInfo.subscriptionBadge = 'frozen';
                } else if (subscriptionInfo.expirationDate) {
                    const expiration = new Date(subscriptionInfo.expirationDate);
                    const now = new Date();
                    
                    if (expiration < now) {
                        subscriptionInfo.subscriptionStatus = 'Истек';
                        subscriptionInfo.subscriptionBadge = 'expired';
                    } else if (subscriptionInfo.remainingClasses <= 0 && subscriptionInfo.totalClasses > 0) {
                        subscriptionInfo.subscriptionStatus = 'Занятия закончились';
                        subscriptionInfo.subscriptionBadge = 'expired';
                    } else {
                        subscriptionInfo.subscriptionStatus = 'Активен';
                        subscriptionInfo.subscriptionBadge = 'active';
                        subscriptionInfo.subscriptionActive = true;
                    }
                } else {
                    subscriptionInfo.subscriptionStatus = 'Активен';
                    subscriptionInfo.subscriptionBadge = 'active';
                    subscriptionInfo.subscriptionActive = true;
                }
            }
            
            console.log('\n🎯 ИТОГОВЫЙ СТАТУС:');
            console.log(`• Тип: ${subscriptionInfo.subscriptionType}`);
            console.log(`• Всего занятий: ${subscriptionInfo.totalClasses}`);
            console.log(`• Использовано: ${subscriptionInfo.usedClasses}`);
            console.log(`• Осталось: ${subscriptionInfo.remainingClasses}`);
            console.log(`• Технических: ${subscriptionInfo.technicalClasses}`);
            console.log(`• Отхожено: ${subscriptionInfo.usedTechnicalClasses}`);
            console.log(`• Статус: ${subscriptionInfo.subscriptionStatus}`);
            console.log(`• Активен: ${subscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
            
        } catch (error) {
            console.error('❌ Ошибка extractSubscriptionInfo:', error);
        }
        
        return subscriptionInfo;
    }

    parseClassesCount(value) {
        if (!value) return 0;
        
        const str = String(value).toLowerCase();
        
        // Ищем паттерны типа "4 занятия", "8 занятий", "16 занятий"
        const patterns = [
            /(\d+)\s*занят/i,
            /^(\d+)$/,
            /всего\s*(\d+)/i,
            /количество\s*(\d+)/i
        ];
        
        for (const pattern of patterns) {
            const match = str.match(pattern);
            if (match && match[1]) {
                const num = parseInt(match[1]);
                if (!isNaN(num) && num > 0) {
                    return num;
                }
            }
        }
        
        // Специальные случаи для абонементов "База"
        if (str.includes('база') && str.includes('блок')) {
            if (str.includes('блок № 1')) return 5;
            if (str.includes('блок № 2')) return 6;
            if (str.includes('блок № 3')) return 5;
            if (str.includes('база - 16')) return 16;
        }
        
        // Для "Продвинутый" абонементов
        if (str.includes('продвинут')) {
            const numMatch = str.match(/\d+/);
            if (numMatch) {
                const num = parseInt(numMatch[0]);
                if (!isNaN(num) && num > 0) {
                    return num;
                }
            }
        }
        
        // По умолчанию ищем любое число в строке
        const numMatch = str.match(/\d+/);
        if (numMatch) {
            const num = parseInt(numMatch[0]);
            if (!isNaN(num) && num > 0) {
                return num;
            }
        }
        
        return 0;
    }

    parseDateOrTimestamp(value) {
        if (!value) return '';
        
        try {
            const str = String(value).trim();
            
            // Если это timestamp (число)
            if (/^\d+$/.test(str)) {
                const timestamp = parseInt(str);
                const date = timestamp < 10000000000 
                    ? new Date(timestamp * 1000)
                    : new Date(timestamp);
                
                if (!isNaN(date.getTime())) {
                    return date.toISOString().split('T')[0];
                }
            }
            
            // Если это дата в формате YYYY-MM-DD
            if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
                return str;
            }
            
            // Пробуем парсить любую дату
            const date = new Date(str);
            if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
            }
            
            return str;
            
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error);
            return value;
        }
    }

    extractFieldValue(field) {
        try {
            if (!field.values || !field.values[0]) {
                return null;
            }
            
            const value = field.values[0];
            
            // Если есть значение
            if (value.value !== undefined && value.value !== null) {
                return value.value.toString();
            }
            
            // Если есть enum_id, ищем значение в enums
            if (value.enum_id && field.enums) {
                const enumItem = field.enums.find(e => e.id == value.enum_id);
                if (enumItem) {
                    return enumItem.value;
                }
                return value.enum_id.toString();
            }
            
            // Если есть enum_code
            if (value.enum_code) {
                return value.enum_code;
            }
            
            return null;
            
        } catch (error) {
            console.error('❌ Ошибка извлечения значения поля:', error);
            return null;
        }
    }

    async getStudentsByPhone(phoneNumber) {
        console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ УЧЕНИКОВ: ${phoneNumber}`);
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            // 1. Поиск контактов по телефону
            console.log('🔍 Поиск контактов...');
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            for (const contact of contacts) {
                console.log(`\n👤 Контакт: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
                
                // 2. Получаем сделки контакта
                const leads = await this.getContactLeads(contact.id);
                console.log(`📊 Сделок у контакта: ${leads.length}`);
                
                // 3. Ищем сделки с абонементами
                const subscriptionLeads = leads.filter(lead => {
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    return subscriptionInfo.hasSubscription;
                });
                
                console.log(`📊 Сделок с абонементами: ${subscriptionLeads.length}`);
                
                if (subscriptionLeads.length > 0) {
                    // 4. Создаем профили из сделок
                    for (const lead of subscriptionLeads) {
                        console.log(`\n🎫 Анализ сделки: "${lead.name}"`);
                        
                        const subscriptionInfo = this.extractSubscriptionInfo(lead);
                        const profile = this.createStudentProfile(contact, phoneNumber, lead, subscriptionInfo);
                        
                        if (profile) {
                            studentProfiles.push(profile);
                            console.log(`✅ Профиль создан: ${profile.student_name}`);
                        }
                    }
                } else {
                    // Если нет сделок с абонементами, создаем профиль из контакта
                    console.log('📝 Создаем профиль из контакта без абонемента');
                    const profile = this.createProfileFromContact(contact, phoneNumber);
                    if (profile) {
                        studentProfiles.push(profile);
                    }
                }
            }
            
            // 5. Если контакты не найдены, ищем сделки напрямую
            if (studentProfiles.length === 0) {
                console.log('\n🔍 Контакты не найдены, ищем сделки напрямую...');
                const leads = await this.searchLeadsByPhone(phoneNumber);
                
                console.log(`📊 Найдено сделок напрямую: ${leads.length}`);
                
                for (const lead of leads) {
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    
                    if (subscriptionInfo.hasSubscription) {
                        const profile = this.createStudentProfile(
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

    createStudentProfile(contact, phoneNumber, lead, subscriptionInfo) {
        try {
            console.log(`👤 Создание профиля из сделки: "${lead.name}"`);
            
            // Извлекаем данные
            const studentName = this.extractStudentName(contact, lead);
            const email = this.extractEmail(contact);
            const birthDate = this.extractBirthDate(contact);
            const teacher = this.extractTeacher(contact);
            const branch = this.extractBranch(contact);
            const ageGroup = subscriptionInfo.ageGroup || this.extractAgeGroup(contact);
            const dayOfWeek = this.extractDayOfWeek(contact);
            const allergies = this.extractAllergies(contact);
            
            // Формируем описание абонемента
            let subscriptionDescription = '';
            if (subscriptionInfo.hasSubscription) {
                if (subscriptionInfo.totalClasses > 0) {
                    subscriptionDescription = `${subscriptionInfo.subscriptionType || 'Абонемент'} на ${subscriptionInfo.totalClasses} занятий`;
                } else {
                    subscriptionDescription = subscriptionInfo.subscriptionType || 'Абонемент';
                }
            } else {
                subscriptionDescription = 'Без абонемента';
            }
            
            const profile = {
                // Идентификаторы
                amocrm_contact_id: contact.id || null,
                amocrm_lead_id: lead.id || null,
                
                // Основная информация
                student_name: studentName,
                phone_number: phoneNumber,
                email: email,
                birth_date: birthDate,
                branch: branch || subscriptionInfo.branch || '',
                
                // Расписание и обучение
                day_of_week: dayOfWeek,
                teacher_name: teacher,
                age_group: ageGroup,
                allergies: allergies,
                
                // Информация о родителе
                parent_name: contact.name || 'Родитель',
                
                // Абонемент
                subscription_type: subscriptionInfo.subscriptionType || 'Без абонемента',
                subscription_owner: subscriptionInfo.subscriptionOwner || '',
                subscription_description: subscriptionDescription,
                subscription_active: subscriptionInfo.subscriptionActive ? 1 : 0,
                subscription_status: subscriptionInfo.subscriptionStatus || 'Нет абонемента',
                subscription_badge: subscriptionInfo.subscriptionBadge || 'inactive',
                
                // Занятия
                total_classes: subscriptionInfo.totalClasses || 0,
                used_classes: subscriptionInfo.usedClasses || 0,
                remaining_classes: subscriptionInfo.remainingClasses || 0,
                
                // Даты
                expiration_date: subscriptionInfo.expirationDate || null,
                activation_date: subscriptionInfo.activationDate || null,
                last_visit_date: subscriptionInfo.lastVisitDate || null,
                
                // Технические данные
                custom_fields: JSON.stringify(lead.custom_fields_values || []),
                raw_contact_data: JSON.stringify(contact),
                lead_data: JSON.stringify(lead),
                is_demo: 0,
                source: 'amocrm',
                is_active: 1,
                last_sync: new Date().toISOString()
            };
            
            console.log(`\n✅ СОЗДАН ПРОФИЛЬ:`);
            console.log('='.repeat(50));
            console.log(`👤 Имя: ${profile.student_name}`);
            console.log(`📱 Телефон: ${profile.phone_number}`);
            console.log(`📍 Филиал: ${profile.branch || 'не указан'}`);
            console.log(`🎫 Абонемент: ${profile.subscription_description}`);
            console.log(`📊 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
            console.log(`📅 Срок: ${profile.expiration_date || 'не указан'}`);
            console.log(`👨‍🏫 Преподаватель: ${profile.teacher_name || 'не указан'}`);
            console.log('='.repeat(50));
            
            return profile;
            
        } catch (error) {
            console.error('❌ Ошибка создания профиля:', error);
            return null;
        }
    }

    createProfileFromContact(contact, phoneNumber) {
        try {
            const studentName = this.extractStudentName(contact, null);
            const email = this.extractEmail(contact);
            const birthDate = this.extractBirthDate(contact);
            const teacher = this.extractTeacher(contact);
            const branch = this.extractBranch(contact);
            const ageGroup = this.extractAgeGroup(contact);
            const dayOfWeek = this.extractDayOfWeek(contact);
            const allergies = this.extractAllergies(contact);
            
            const profile = {
                amocrm_contact_id: contact.id || null,
                amocrm_lead_id: null,
                student_name: studentName,
                phone_number: phoneNumber,
                email: email,
                birth_date: birthDate,
                branch: branch || '',
                day_of_week: dayOfWeek,
                teacher_name: teacher,
                age_group: ageGroup,
                allergies: allergies,
                parent_name: contact.name || 'Родитель',
                subscription_type: 'Без абонемента',
                subscription_description: 'Без абонемента',
                subscription_active: 0,
                subscription_status: 'Нет абонемента',
                subscription_badge: 'inactive',
                total_classes: 0,
                used_classes: 0,
                remaining_classes: 0,
                expiration_date: null,
                activation_date: null,
                last_visit_date: null,
                custom_fields: JSON.stringify(contact.custom_fields_values || []),
                raw_contact_data: JSON.stringify(contact),
                lead_data: '{}',
                is_demo: 0,
                source: 'amocrm',
                is_active: 1,
                last_sync: new Date().toISOString()
            };
            
            console.log(`✅ Профиль создан из контакта: ${profile.student_name}`);
            return profile;
            
        } catch (error) {
            console.error('❌ Ошибка создания профиля из контакта:', error);
            return null;
        }
    }

    // Вспомогательные методы для извлечения данных
    extractStudentName(contact, lead) {
        // Пытаемся найти имя в полях контакта
        if (contact.custom_fields_values) {
            const childFields = [
                this.FIELD_IDS.CONTACT.CHILD_1_NAME,
                this.FIELD_IDS.CONTACT.CHILD_2_NAME,
                this.FIELD_IDS.CONTACT.CHILD_3_NAME
            ];
            
            for (const fieldId of childFields) {
                if (fieldId) {
                    const name = this.getFieldValueFromContact(contact, fieldId);
                    if (name && name.trim()) {
                        return name.trim();
                    }
                }
            }
        }
        
        // Ищем в названии сделки
        if (lead && lead.name) {
            const namePatterns = [
                /^(.*?)\s*[-–]\s*/,  // "Иванов Иван - 8 занятий"
                /для\s+(.*?)$/i,      // "Абонемент для Петрова Пети"
                /ученик\s+(.*?)$/i    // "Абонемент ученик Сидоров"
            ];
            
            for (const pattern of namePatterns) {
                const match = lead.name.match(pattern);
                if (match && match[1]) {
                    const name = match[1].trim();
                    if (name.length > 1) {
                        return name;
                    }
                }
            }
        }
        
        // Используем имя контакта (родителя)
        if (contact.name && contact.name.trim()) {
            return contact.name.trim();
        }
        
        return 'Ученик';
    }

    extractEmail(contact) {
        if (!contact.custom_fields_values || !this.FIELD_IDS.CONTACT.EMAIL) {
            return '';
        }
        
        return this.getFieldValueFromContact(contact, this.FIELD_IDS.CONTACT.EMAIL) || '';
    }

    extractBirthDate(contact) {
        if (!contact.custom_fields_values) {
            return '';
        }
        
        // Проверяем поля дня рождения
        const birthdayFields = [
            this.FIELD_IDS.CONTACT.BIRTH_DATE,
            this.FIELD_IDS.CONTACT.CHILD_1_BIRTHDAY,
            this.FIELD_IDS.CONTACT.CHILD_2_BIRTHDAY,
            this.FIELD_IDS.CONTACT.CHILD_3_BIRTHDAY
        ];
        
        for (const fieldId of birthdayFields) {
            if (fieldId) {
                const date = this.getFieldValueFromContact(contact, fieldId);
                if (date) {
                    return this.parseDateOrTimestamp(date);
                }
            }
        }
        
        return '';
    }

    extractTeacher(contact) {
        if (!contact.custom_fields_values || !this.FIELD_IDS.CONTACT.TEACHER) {
            return '';
        }
        
        return this.getFieldValueFromContact(contact, this.FIELD_IDS.CONTACT.TEACHER) || '';
    }

    extractBranch(contact) {
        if (!contact.custom_fields_values || !this.FIELD_IDS.CONTACT.BRANCH) {
            return '';
        }
        
        return this.getFieldValueFromContact(contact, this.FIELD_IDS.CONTACT.BRANCH) || '';
    }

    extractAgeGroup(contact) {
        if (!contact.custom_fields_values || !this.FIELD_IDS.CONTACT.AGE_GROUP) {
            return '';
        }
        
        return this.getFieldValueFromContact(contact, this.FIELD_IDS.CONTACT.AGE_GROUP) || '';
    }

    extractDayOfWeek(contact) {
        if (!contact.custom_fields_values || !this.FIELD_IDS.CONTACT.DAY_OF_WEEK) {
            return '';
        }
        
        return this.getFieldValueFromContact(contact, this.FIELD_IDS.CONTACT.DAY_OF_WEEK) || '';
    }

    extractAllergies(contact) {
        if (!contact.custom_fields_values || !this.FIELD_IDS.CONTACT.ALLERGIES) {
            return '';
        }
        
        return this.getFieldValueFromContact(contact, this.FIELD_IDS.CONTACT.ALLERGIES) || '';
    }

    getFieldValueFromContact(contact, fieldId) {
        if (!contact.custom_fields_values || !fieldId) {
            return '';
        }
        
        for (const field of contact.custom_fields_values) {
            const currentFieldId = field.field_id || field.id;
            if (currentFieldId == fieldId) {
                return this.extractFieldValue(field);
            }
        }
        
        return '';
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

    async searchContactsByPhone(phoneNumber) {
        try {
            console.log(`🔍 Поиск контактов по телефону: ${phoneNumber}`);
            
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const lastDigits = cleanPhone.slice(-10);
            
            // Используем поиск по query
            const response = await this.makeRequest(
                'GET',
                `/api/v4/contacts?query=${encodeURIComponent(lastDigits)}&with=custom_fields_values&limit=50`
            );
            
            console.log(`📊 Найдено контактов: ${response._embedded?.contacts?.length || 0}`);
            
            return response;
            
        } catch (error) {
            console.error('❌ Ошибка поиска контактов:', error.message);
            return { _embedded: { contacts: [] } };
        }
    }

    async getContactLeads(contactId) {
        try {
            console.log(`🔍 Получение сделок контакта ${contactId}`);
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&limit=50`
            );
            
            return response._embedded?.leads || [];
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    async searchLeadsByPhone(phoneNumber) {
        try {
            console.log(`🔍 Поиск сделок по телефону: ${phoneNumber}`);
            
            // Поиск сделок через контакты
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            let allLeads = [];
            
            for (const contact of contacts) {
                const leads = await this.getContactLeads(contact.id);
                allLeads = allLeads.concat(leads);
            }
            
            console.log(`📊 Всего найдено сделок: ${allLeads.length}`);
            return allLeads;
            
        } catch (error) {
            console.error('❌ Ошибка поиска сделок:', error.message);
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
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        
        await createTables();
        console.log('✅ База данных успешно инициализирована!');
        
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
                amocrm_lead_id INTEGER,
                
                -- Основная информация
                student_name TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                email TEXT,
                birth_date TEXT,
                branch TEXT,
                
                -- Расписание
                day_of_week TEXT,
                teacher_name TEXT,
                age_group TEXT,
                allergies TEXT,
                
                -- Информация о родителе
                parent_name TEXT,
                
                -- Абонемент
                subscription_type TEXT,
                subscription_owner TEXT,
                subscription_description TEXT,
                subscription_active INTEGER DEFAULT 0,
                subscription_status TEXT,
                subscription_badge TEXT,
                
                -- Занятия
                total_classes INTEGER DEFAULT 0,
                used_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                
                -- Даты
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
        
        // Создаем индексы
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_name ON student_profiles(student_name)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(is_active)');
        
        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT UNIQUE NOT NULL,
                session_data TEXT,
                phone_number TEXT,
                expires_at TIMESTAMP NOT NULL,
                is_active INTEGER DEFAULT 1,
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
        
        console.log('🎉 Все таблицы созданы успешно!');
        
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
            last_sync_time: this.lastSyncTime
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
                    'amocrm_contact_id', 'amocrm_lead_id', 'student_name', 'phone_number', 'email',
                    'birth_date', 'branch', 'day_of_week', 'teacher_name', 'age_group', 'allergies',
                    'parent_name', 'subscription_type', 'subscription_owner', 'subscription_description',
                    'subscription_active', 'subscription_status', 'subscription_badge',
                    'total_classes', 'used_classes', 'remaining_classes', 'expiration_date', 
                    'activation_date', 'last_visit_date', 'custom_fields', 
                    'raw_contact_data', 'lead_data', 'is_demo', 'source', 'is_active', 'last_sync'
                ];
                
                const values = [
                    profile.amocrm_contact_id || null,
                    profile.amocrm_lead_id || null,
                    profile.student_name,
                    profile.phone_number,
                    profile.email || '',
                    profile.birth_date || '',
                    profile.branch || '',
                    profile.day_of_week || '',
                    profile.teacher_name || '',
                    profile.age_group || '',
                    profile.allergies || '',
                    profile.parent_name || '',
                    profile.subscription_type || 'Без абонемента',
                    profile.subscription_owner || '',
                    profile.subscription_description || '',
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
        version: '5.0.0',
        amocrm_connected: amoCrmService.isInitialized,
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
        
        // Создаем JWT токен
        const token = jwt.sign(
            {
                phone: formattedPhone,
                profiles_count: profiles.length,
                timestamp: new Date().toISOString()
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
            last_sync: p.last_sync
        }));
        
        const responseData = {
            success: true,
            message: profiles.length > 0 ? 'Найдены профили учеников' : 'Профили не найдены',
            data: {
                profiles: responseProfiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                has_real_data: true,
                token: token,
                last_sync: profiles.length > 0 ? profiles[0].last_sync : null
            }
        };
        
        console.log(`✅ Авторизация завершена успешно`);
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
                    teacher_name: profile.teacher_name
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

// САМЫЙ ПОДРОБНЫЙ ДИАГНОСТИЧЕСКИЙ ЗАПРОС
app.get('/api/debug/full-diagnostic/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        console.log(`\n🔍 ПОЛНАЯ ДИАГНОСТИКА ДЛЯ ТЕЛЕФОНА: ${phone}`);
        console.log('='.repeat(100));
        
        const diagnosticData = {
            phone_info: {
                original: phone,
                formatted: formatPhoneNumber(phone),
                clean: phone.replace(/\D/g, '')
            },
            system_status: {
                amocrm_initialized: amoCrmService.isInitialized,
                database_connected: !!db,
                timestamp: new Date().toISOString()
            },
            amocrm_connection: {},
            search_results: {},
            raw_data: {},
            processed_data: {},
            field_mapping: {},
            database_info: {}
        };
        
        // 1. Проверка соединения с amoCRM
        if (amoCrmService.isInitialized) {
            try {
                const accountInfo = await amoCrmService.makeRequest('GET', '/api/v4/account');
                diagnosticData.amocrm_connection = {
                    connected: true,
                    account_name: accountInfo.name,
                    account_id: accountInfo.id,
                    subdomain: AMOCRM_SUBDOMAIN
                };
            } catch (error) {
                diagnosticData.amocrm_connection = {
                    connected: false,
                    error: error.message
                };
            }
        }
        
        // 2. Поиск контактов
        try {
            const formattedPhone = formatPhoneNumber(phone);
            const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            diagnosticData.search_results.contacts = {
                count: contacts.length,
                items: contacts.map(contact => ({
                    id: contact.id,
                    name: contact.name,
                    created_at: contact.created_at,
                    updated_at: contact.updated_at,
                    custom_fields_count: contact.custom_fields_values?.length || 0,
                    raw_fields: contact.custom_fields_values?.map(field => ({
                        id: field.field_id || field.id,
                        name: field.name || 'Неизвестно',
                        values: field.values || [],
                        enums: field.enums || []
                    })) || []
                }))
            };
            
            // Сохраняем сырые данные
            diagnosticData.raw_data.contacts = contacts;
            
            // Анализ первого контакта
            if (contacts.length > 0) {
                const contact = contacts[0];
                diagnosticData.processed_data.contact_analysis = {
                    student_name: amoCrmService.extractStudentName(contact, null),
                    email: amoCrmService.extractEmail(contact),
                    birth_date: amoCrmService.extractBirthDate(contact),
                    teacher: amoCrmService.extractTeacher(contact),
                    branch: amoCrmService.extractBranch(contact),
                    age_group: amoCrmService.extractAgeGroup(contact),
                    day_of_week: amoCrmService.extractDayOfWeek(contact),
                    allergies: amoCrmService.extractAllergies(contact)
                };
            }
        } catch (error) {
            diagnosticData.search_results.contacts = {
                count: 0,
                error: error.message
            };
        }
        
        // 3. Поиск сделок
        try {
            const leads = await amoCrmService.searchLeadsByPhone(phone);
            diagnosticData.search_results.leads = {
                count: leads.length,
                items: leads.map(lead => ({
                    id: lead.id,
                    name: lead.name,
                    status_id: lead.status_id,
                    pipeline_id: lead.pipeline_id,
                    created_at: lead.created_at,
                    updated_at: lead.updated_at,
                    price: lead.price,
                    custom_fields_count: lead.custom_fields_values?.length || 0
                }))
            };
            
            // Сохраняем сырые данные сделок
            diagnosticData.raw_data.leads = leads;
            
            // Анализ абонементов в сделках
            if (leads.length > 0) {
                diagnosticData.processed_data.leads_analysis = leads.map(lead => {
                    const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                    return {
                        lead_id: lead.id,
                        lead_name: lead.name,
                        subscription_info: subscriptionInfo,
                        custom_fields: lead.custom_fields_values?.map(field => ({
                            id: field.field_id || field.id,
                            name: field.name || 'Неизвестно',
                            value: amoCrmService.extractFieldValue(field),
                            values: field.values || []
                        })) || []
                    };
                });
            }
        } catch (error) {
            diagnosticData.search_results.leads = {
                count: 0,
                error: error.message
            };
        }
        
        // 4. Получение профилей
        try {
            const profiles = await amoCrmService.getStudentsByPhone(phone);
            diagnosticData.processed_data.profiles = {
                count: profiles.length,
                items: profiles.map(profile => ({
                    student_name: profile.student_name,
                    phone_number: profile.phone_number,
                    email: profile.email,
                    branch: profile.branch,
                    subscription_type: profile.subscription_type,
                    subscription_status: profile.subscription_status,
                    total_classes: profile.total_classes,
                    used_classes: profile.used_classes,
                    remaining_classes: profile.remaining_classes,
                    expiration_date: profile.expiration_date,
                    teacher_name: profile.teacher_name,
                    age_group: profile.age_group,
                    day_of_week: profile.day_of_week
                }))
            };
        } catch (error) {
            diagnosticData.processed_data.profiles = {
                count: 0,
                error: error.message
            };
        }
        
        // 5. Информация о маппинге полей
        diagnosticData.field_mapping = {
            lead_fields: amoCrmService.FIELD_IDS.LEAD,
            contact_fields: amoCrmService.FIELD_IDS.CONTACT,
            field_cache_sizes: {
                lead_fields: amoCrmService.fieldCache.leadFields.size,
                contact_fields: amoCrmService.fieldCache.contactFields.size
            }
        };
        
        // 6. Проверка базы данных
        try {
            const dbStats = await db.all(`
                SELECT 
                    (SELECT COUNT(*) FROM student_profiles WHERE phone_number LIKE ?) as matching_profiles,
                    (SELECT COUNT(*) FROM student_profiles WHERE is_active = 1) as active_profiles,
                    (SELECT COUNT(*) FROM student_profiles) as total_profiles,
                    (SELECT COUNT(*) FROM sync_logs) as sync_count
            `, [`%${phone.replace(/\D/g, '').slice(-10)}%`]);
            
            diagnosticData.database_info = dbStats[0] || {};
            
            // Получаем профили из базы
            const dbProfiles = await db.all(
                `SELECT * FROM student_profiles WHERE phone_number LIKE ? ORDER BY last_sync DESC`,
                [`%${phone.replace(/\D/g, '').slice(-10)}%`]
            );
            
            diagnosticData.database_info.profiles = dbProfiles.map(p => ({
                id: p.id,
                student_name: p.student_name,
                subscription_type: p.subscription_type,
                subscription_status: p.subscription_status,
                total_classes: p.total_classes,
                used_classes: p.used_classes,
                last_sync: p.last_sync,
                updated_at: p.updated_at
            }));
        } catch (error) {
            diagnosticData.database_info = {
                error: error.message
            };
        }
        
        // 7. Тестовый запрос для проверки полей абонемента
        diagnosticData.test_queries = {
            sample_lead_fields: Object.entries(amoCrmService.FIELD_IDS.LEAD).map(([key, id]) => ({
                key,
                id,
                description: this.getFieldDescription(key)
            }))
        };
        
        res.json({
            success: true,
            message: 'Полная диагностика завершена',
            timestamp: new Date().toISOString(),
            diagnostic: diagnosticData
        });
        
    } catch (error) {
        console.error('❌ Ошибка полной диагностики:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка диагностики',
            details: error.message
        });
    }
});

// Вспомогательная функция для описания полей
function getFieldDescription(fieldKey) {
    const descriptions = {
        'TOTAL_CLASSES': 'Общее количество занятий в абонементе',
        'USED_CLASSES': 'Использованные занятия',
        'REMAINING_CLASSES': 'Остаток занятий',
        'EXPIRATION_DATE': 'Дата окончания абонемента',
        'ACTIVATION_DATE': 'Дата активации абонемента',
        'LAST_VISIT_DATE': 'Дата последнего визита',
        'SUBSCRIPTION_TYPE': 'Тип абонемента (Первчиный/Повторный)',
        'AGE_GROUP': 'Возрастная группа',
        'FREEZE': 'Заморозка абонемента',
        'SUBSCRIPTION_OWNER': 'Принадлежность абонемента',
        'PRICE_PER_CLASS': 'Стоимость 1 занятия',
        'TECHNICAL_CLASSES': 'Техническое количество занятий',
        'ATTENDED_CLASSES': 'Кол-во отхоженных занятий',
        'IS_OLD_WRITE_OFF': 'Старое списание абонементов',
        'IS_PROMOTION': 'Отходил абонемент по акции',
        'TRANSFER_REASON': 'Причина переноса срока абонемента',
        'SUBSCRIPTION_DETAILS': 'Инфо по занятиям'
    };
    
    return descriptions[fieldKey] || 'Неизвестное поле';
}

// Другие диагностические маршруты
app.get('/api/debug/lead-fields', async (req, res) => {
    try {
        const fields = await amoCrmService.makeRequest('GET', '/api/v4/leads/custom_fields');
        
        const subscriptionFields = [];
        const allFields = [];
        
        if (fields && fields._embedded && fields._embedded.custom_fields) {
            fields._embedded.custom_fields.forEach(field => {
                allFields.push({
                    id: field.id,
                    name: field.name,
                    type: field.type,
                    enums: field.enums || []
                });
            });
        }
        
        res.json({
            success: true,
            data: {
                total_fields: allFields.length,
                subscription_fields_count: subscriptionFields.length,
                your_field_ids: amoCrmService.FIELD_IDS.LEAD,
                all_fields: allFields
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/debug/test-lead/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        console.log(`\n🔍 ТЕСТОВЫЙ АНАЛИЗ СДЕЛКИ: ${leadId}`);
        
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        console.log(`📋 Название сделки: ${lead.name}`);
        
        // Анализ всех полей
        const fieldsAnalysis = [];
        if (lead.custom_fields_values) {
            lead.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const value = amoCrmService.extractFieldValue(field);
                const fieldName = field.name || 'Неизвестно';
                
                fieldsAnalysis.push({
                    id: fieldId,
                    name: fieldName,
                    value: value,
                    is_mapped: Object.values(amoCrmService.FIELD_IDS.LEAD).includes(fieldId),
                    raw_values: field.values || []
                });
            });
        }
        
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        res.json({
            success: true,
            data: {
                lead_info: {
                    id: lead.id,
                    name: lead.name,
                    status_id: lead.status_id,
                    price: lead.price,
                    created_at: lead.created_at
                },
                subscription_info: subscriptionInfo,
                fields_analysis: fieldsAnalysis,
                field_mapping: amoCrmService.FIELD_IDS.LEAD
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

app.get('/api/debug/contact-fields', async (req, res) => {
    try {
        const fields = await amoCrmService.makeRequest('GET', '/api/v4/contacts/custom_fields');
        
        const contactFields = [];
        if (fields && fields._embedded && fields._embedded.custom_fields) {
            fields._embedded.custom_fields.forEach(field => {
                contactFields.push({
                    id: field.id,
                    name: field.name,
                    type: field.type,
                    enums: field.enums || []
                });
            });
        }
        
        res.json({
            success: true,
            data: {
                total_fields: contactFields.length,
                your_field_ids: amoCrmService.FIELD_IDS.CONTACT,
                all_fields: contactFields
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/debug/system-status', async (req, res) => {
    try {
        const dbStats = await db.all(`
            SELECT 
                (SELECT COUNT(*) FROM student_profiles) as total_profiles,
                (SELECT COUNT(*) FROM student_profiles WHERE subscription_active = 1) as active_subscriptions,
                (SELECT COUNT(*) FROM student_profiles WHERE is_active = 1) as active_profiles,
                (SELECT COUNT(DISTINCT phone_number) FROM student_profiles) as unique_phones
        `);
        
        const lastSync = await db.get(
            `SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 1`
        );
        
        res.json({
            success: true,
            data: {
                system: {
                    uptime: process.uptime(),
                    memory_usage: process.memoryUsage(),
                    node_version: process.version
                },
                amocrm: {
                    connected: amoCrmService.isInitialized,
                    account_name: amoCrmService.accountInfo?.name,
                    subdomain: AMOCRM_SUBDOMAIN
                },
                database: dbStats[0] || {},
                synchronization: {
                    status: syncService.getSyncStatus(),
                    last_sync: lastSync
                }
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ДОПОЛНИТЕЛЬНЫЕ API ====================
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
             ORDER BY subscription_active DESC, student_name`,
            [phone]
        );
        
        res.json({
            success: true,
            data: {
                profiles: profiles.map(p => ({
                    id: p.id,
                    student_name: p.student_name,
                    branch: p.branch,
                    teacher_name: p.teacher_name,
                    subscription_type: p.subscription_type,
                    subscription_status: p.subscription_status,
                    total_classes: p.total_classes,
                    remaining_classes: p.remaining_classes,
                    used_classes: p.used_classes,
                    expiration_date: p.expiration_date,
                    is_active: p.subscription_active === 1
                })),
                total: profiles.length
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        amocrm_status: amoCrmService.isInitialized ? 'connected' : 'disconnected'
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v5.0');
        console.log('='.repeat(80));
        console.log('✨ ИСПРАВЛЕННЫЙ КОД С ПРАВИЛЬНОЙ ОБРАБОТКОЙ ПОЛЕЙ');
        console.log('✨ ПОДРОБНАЯ ДИАГНОСТИКА ДАННЫХ ИЗ AMOCRM');
        console.log('✨ АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ КАЖДЫЕ 10 МИНУТ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        await amoCrmService.initialize();
        
        if (amoCrmService.isInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            
            // Запускаем синхронизацию через 5 секунд
            setTimeout(() => {
                syncService.startAutoSync();
            }, 5000);
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 Основной URL: http://localhost:${PORT}`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(60));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`📋 Абонемент: POST http://localhost:${PORT}/api/subscription`);
            console.log('='.repeat(60));
            
            console.log('\n🐛 ДИАГНОСТИЧЕСКИЕ ССЫЛКИ:');
            console.log('='.repeat(60));
            console.log(`🔍 ПОЛНАЯ ДИАГНОСТИКА: GET http://localhost:${PORT}/api/debug/full-diagnostic/79175161115`);
            console.log(`🔧 Тест сделки: GET http://localhost:${PORT}/api/debug/test-lead/12345`);
            console.log(`📋 Поля сделок: GET http://localhost:${PORT}/api/debug/lead-fields`);
            console.log(`👤 Поля контактов: GET http://localhost:${PORT}/api/debug/contact-fields`);
            console.log(`⚙️  Статус системы: GET http://localhost:${PORT}/api/debug/system-status`);
            console.log('='.repeat(60));
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
