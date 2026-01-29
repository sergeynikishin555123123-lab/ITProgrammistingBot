// server.js - ИСПРАВЛЕННАЯ ВЕРСИЯ
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
        
        // ВАШИ ID ПОЛЕЙ
        this.FIELD_IDS = {
            LEAD: {
                TOTAL_CLASSES: 850241,
                USED_CLASSES: 850257,
                USED_CLASSES_NUM: 884251,
                REMAINING_CLASSES: 890163,
                EXPIRATION_DATE: 850255,
                ACTIVATION_DATE: 851565,
                LAST_VISIT_DATE: 850259,
                SUBSCRIPTION_TYPE: 891007,
                SUBSCRIPTION_OWNER: 805465,
                FREEZE: 867693,
                BRANCH: 891589,
                AGE_GROUP: 850243,
                PURCHASE_DATE: 850253,
                TECHNICAL_CLASSES: 891819,
                CLASS_PRICE: 891813,
            },
            
            CONTACT: {
                CHILD_1_NAME: 867233,
                CHILD_1_BIRTHDAY: 867687,
                CHILD_2_NAME: 867235,
                CHILD_2_BIRTHDAY: 867685,
                CHILD_3_NAME: 867733,
                CHILD_3_BIRTHDAY: 867735,
                BRANCH: 871273,
                TEACHER: 888881,
                DAY_OF_WEEK: 888879,
                AGE_GROUP: 888903,
                HAS_ACTIVE_SUB: 890179,
                LAST_VISIT: 885380,
                ALLERGIES: 850239,
                PARENT_BIRTHDAY: 850219,
                EMAIL: 216617
            }
        };
        
        // Кэш enum значений
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
            
            try {
                const response = await this.makeRequest('GET', '/api/v4/account');
                this.accountInfo = response;
                this.isInitialized = true;
                
                console.log('✅ amoCRM успешно инициализирован');
                console.log(`🏢 Аккаунт: ${response.name}`);
                
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
                
                console.log(`📤 ${method} ${endpoint}`);
                const response = await axios(config);
                
                return response.data;
                
            } catch (error) {
                lastError = error;
                
                if (error.response) {
                    const status = error.response.status;
                    
                    if (status === 401) {
                        console.error('❌ Ошибка авторизации amoCRM');
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
                    
                    if (status >= 500) {
                        continue;
                    } else {
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

    // ==================== МЕТОДЫ ДЛЯ РАБОТЫ С ПОЛЯМИ ====================
    
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
            
            // ПРИОРИТЕТ: enum_id
            if (value.enum_id !== undefined) {
                return String(value.enum_id);
            }
            // Затем обычное значение
            else if (value.value !== undefined) {
                return String(value.value);
            }
            
            return null;
        } catch (error) {
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
            
            return String(value);
        } catch (error) {
            return String(value);
        }
    }

    parseDate(value) {
        if (!value) return null;
        
        try {
            const dateStr = String(value).trim();
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
            
            return cleanStr;
            
        } catch (error) {
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
            
            // Проверяем enum_id для поля "Абонемент занятий:"
            if (this.SUBSCRIPTION_ENUM_MAPPING[str]) {
                return this.SUBSCRIPTION_ENUM_MAPPING[str];
            }
            
            return 0;
        } catch (error) {
            return 0;
        }
    }

    // ==================== ОСНОВНАЯ ЛОГИКА ====================
    
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
            freezeStatus: '',
            leadName: lead?.name || '',
            leadStatus: lead?.status_id || 0,
            leadIsClosed: false
        };
        
        if (!lead || !lead.custom_fields_values) {
            return subscriptionInfo;
        }
        
        try {
            const customFields = lead.custom_fields_values;
            const statusId = lead.status_id || 0;
            subscriptionInfo.leadIsClosed = [142, 143].includes(statusId);
            
            console.log(`🔍 Анализ абонемента в сделке "${lead.name}" (ID: ${lead.id})`);
            
            // Проходим по всем полям
            for (const field of customFields) {
                const fieldId = field.field_id;
                if (!fieldId) continue;
                
                const fieldValue = this.getFieldValue(field);
                if (fieldValue === null || fieldValue === '') continue;
                
                // ОСНОВНЫЕ ПОЛЯ АБОНЕМЕНТА
                if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.totalClasses = this.parseNumeric(fieldValue);
                    console.log(`   🎫 Абонемент: ${fieldValue} -> ${subscriptionInfo.totalClasses} занятий`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.USED_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.usedClasses = this.parseNumeric(fieldValue);
                    console.log(`   📊 Счетчик занятий: ${fieldValue} -> ${subscriptionInfo.usedClasses}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.USED_CLASSES_NUM) {
                    subscriptionInfo.hasSubscription = true;
                    const used = this.parseNumeric(fieldValue);
                    subscriptionInfo.usedClasses = Math.max(subscriptionInfo.usedClasses, used);
                    console.log(`   📊 Кол-во отхоженных: ${fieldValue} -> ${used}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.REMAINING_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.remainingClasses = this.parseNumeric(fieldValue);
                    console.log(`   📊 Остаток занятий: ${fieldValue} -> ${subscriptionInfo.remainingClasses}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.EXPIRATION_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.expirationDate = this.parseDate(fieldValue);
                    console.log(`   📅 Окончание: ${fieldValue} -> ${subscriptionInfo.expirationDate}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.ACTIVATION_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.activationDate = this.parseDate(fieldValue);
                    console.log(`   📅 Активация: ${fieldValue} -> ${subscriptionInfo.activationDate}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.LAST_VISIT_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.lastVisitDate = this.parseDate(fieldValue);
                    console.log(`   📅 Последний визит: ${fieldValue} -> ${subscriptionInfo.lastVisitDate}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.subscriptionType = fieldValue;
                    console.log(`   🏷️  Тип абонемента: ${fieldValue}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.FREEZE) {
                    subscriptionInfo.freezeStatus = fieldValue;
                    console.log(`   ❄️  Заморозка: ${fieldValue}`);
                }
            }
            
            // Корректировка данных
            if (subscriptionInfo.totalClasses > 0) {
                if (subscriptionInfo.usedClasses > 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                }
                if (subscriptionInfo.remainingClasses > 0 && subscriptionInfo.usedClasses === 0) {
                    subscriptionInfo.usedClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.remainingClasses);
                }
                if (subscriptionInfo.usedClasses === 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = subscriptionInfo.totalClasses;
                }
            }
            
            // Определение статуса
            const today = new Date();
            const now = today.getTime();
            
            const hasFutureActivation = subscriptionInfo.activationDate ? 
                new Date(subscriptionInfo.activationDate).getTime() > now : false;
            
            const isExpiredByDate = subscriptionInfo.expirationDate ? 
                new Date(subscriptionInfo.expirationDate).getTime() < now : false;
            
            const hasRemaining = subscriptionInfo.remainingClasses > 0;
            const hasUsed = subscriptionInfo.usedClasses > 0;
            const isFrozen = subscriptionInfo.freezeStatus && 
                           subscriptionInfo.freezeStatus.toLowerCase() === 'да';
            
            if (isFrozen) {
                subscriptionInfo.subscriptionStatus = 'Абонемент заморожен';
                subscriptionInfo.subscriptionBadge = 'freeze';
            }
            else if (isExpiredByDate) {
                subscriptionInfo.subscriptionStatus = 'Абонемент истек';
                subscriptionInfo.subscriptionBadge = 'expired';
            }
            else if (hasFutureActivation) {
                subscriptionInfo.subscriptionStatus = 'Ожидает активации';
                subscriptionInfo.subscriptionBadge = 'pending';
            }
            else if (subscriptionInfo.leadIsClosed) {
                subscriptionInfo.subscriptionStatus = 'Абонемент завершен';
                subscriptionInfo.subscriptionBadge = 'expired';
            }
            else if (!hasRemaining && hasUsed) {
                subscriptionInfo.subscriptionStatus = 'Занятия закончились';
                subscriptionInfo.subscriptionBadge = 'expired';
            }
            else if (hasRemaining) {
                subscriptionInfo.subscriptionStatus = `Активный (осталось ${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
                subscriptionInfo.subscriptionBadge = 'active';
                subscriptionInfo.subscriptionActive = true;
            }
            else if (subscriptionInfo.totalClasses > 0 && !hasUsed && !subscriptionInfo.leadIsClosed) {
                subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий (не начат)`;
                subscriptionInfo.subscriptionBadge = 'pending';
            }
            else if (subscriptionInfo.totalClasses > 0) {
                subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий`;
                subscriptionInfo.subscriptionBadge = 'has_subscription';
                subscriptionInfo.subscriptionActive = true;
            }
            
            console.log(`✅ Статус: ${subscriptionInfo.subscriptionStatus}`);
            console.log(`✅ Активен: ${subscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации об абонементе:', error);
        }
        
        return subscriptionInfo;
    }

    async getContactLeads(contactId) {
        try {
            console.log(`🔍 Получение сделок контакта ID: ${contactId}`);
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&limit=250&filter[contact_id]=${contactId}`
            );
            
            const leads = response._embedded?.leads || [];
            console.log(`📊 Найдено сделок: ${leads.length}`);
            
            // Сортируем по дате обновления (новые сначала)
            leads.sort((a, b) => {
                return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
            });
            
            return leads;
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок контакта ${contactId}:`, error.message);
            return [];
        }
    }

    async searchContactsByPhone(phoneNumber) {
        try {
            console.log(`🔍 Поиск контактов по телефону: ${phoneNumber}`);
            
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const searchTerm = cleanPhone.slice(-7); // Последние 7 цифр
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/contacts?query=${encodeURIComponent(searchTerm)}&with=custom_fields_values&limit=50`
            );
            
            const contacts = response._embedded?.contacts || [];
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            return contacts;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return [];
        }
    }

    async getFullContactInfo(contactId) {
        try {
            console.log(`🔍 Получение контакта ID: ${contactId}`);
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/contacts/${contactId}?with=custom_fields_values`
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
            console.log(`👤 Поиск детей в контакте: ${contact.name || 'Без имени'}`);
            
            if (!contact.custom_fields_values) {
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
                if (!nameField) continue;
                
                const childName = this.getFieldValue(nameField);
                if (!childName || childName.trim() === '') continue;
                
                console.log(`   👶 Ребенок ${childNumber}: ${childName}`);
                
                // Создаем объект с информацией о ребенке
                const studentInfo = {
                    studentName: childName,
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
                    }
                }
                
                // Ищем другие поля
                for (const field of customFields) {
                    const fieldId = field.field_id;
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue) continue;
                    
                    if (fieldId === this.FIELD_IDS.CONTACT.BRANCH) {
                        studentInfo.branch = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.TEACHER) {
                        studentInfo.teacherName = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.DAY_OF_WEEK) {
                        studentInfo.dayOfWeek = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.AGE_GROUP) {
                        studentInfo.ageGroup = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) {
                        studentInfo.hasActiveSubscription = fieldValue.toLowerCase() === 'да';
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.LAST_VISIT) {
                        studentInfo.lastVisitDate = this.parseDate(fieldValue);
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.ALLERGIES) {
                        studentInfo.allergies = fieldValue;
                    }
                }
                
                students.push(studentInfo);
            }
            
            console.log(`📊 Найдено детей: ${students.length}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения учеников из контакта:', error);
        }
        
        return students;
    }

    async findLatestActiveSubscription(contactId) {
        console.log(`🎯 Поиск активного абонемента для контакта: ${contactId}`);
        
        try {
            const leads = await this.getContactLeads(contactId);
            console.log(`📊 Сделок получено: ${leads.length}`);
            
            if (leads.length === 0) {
                return null;
            }
            
            const subscriptionLeads = [];
            
            for (const lead of leads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription) {
                    subscriptionLeads.push({
                        lead: lead,
                        subscription: subscriptionInfo,
                        updated_at: lead.updated_at,
                        priority: subscriptionInfo.subscriptionActive ? 100 : 50
                    });
                }
            }
            
            console.log(`📊 Сделок с абонементами: ${subscriptionLeads.length}`);
            
            if (subscriptionLeads.length === 0) {
                return null;
            }
            
            // Сортируем по приоритету и дате
            subscriptionLeads.sort((a, b) => {
                if (b.priority !== a.priority) {
                    return b.priority - a.priority;
                }
                return new Date(b.updated_at) - new Date(a.updated_at);
            });
            
            const bestSubscription = subscriptionLeads[0];
            
            console.log(`✅ Найден абонемент: "${bestSubscription.lead.name}"`);
            console.log(`   Статус: ${bestSubscription.subscription.subscriptionStatus}`);
            console.log(`   Занятий: ${bestSubscription.subscription.usedClasses}/${bestSubscription.subscription.totalClasses}`);
            
            return {
                lead: bestSubscription.lead,
                subscription: bestSubscription.subscription
            };
            
        } catch (error) {
            console.error(`❌ Ошибка поиска активного абонемента: ${error.message}`);
            return null;
        }
    }

    findEmail(contact) {
        try {
            if (!contact.custom_fields_values) return '';
            
            for (const field of contact.custom_fields_values) {
                const fieldValue = this.getFieldValue(field);
                
                if (fieldValue && fieldValue.includes('@')) {
                    return fieldValue;
                }
            }
        } catch (error) {
            console.error('❌ Ошибка поиска email:', error);
        }
        return '';
    }

    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        const email = this.findEmail(contact);
        
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
        
        console.log(`✅ Профиль создан: ${profile.student_name}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        
        return profile;
    }

    async getStudentsByPhone(phoneNumber) {
        console.log(`🎯 Получение профилей по телефону: ${phoneNumber}`);
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            const contacts = await this.searchContactsByPhone(phoneNumber);
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                return studentProfiles;
            }
            
            for (const contact of contacts) {
                console.log(`👤 Анализ контакта: ${contact.name} (ID: ${contact.id})`);
                
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                const children = this.extractStudentsFromContact(fullContact);
                console.log(`📊 Найдено детей в контакте: ${children.length}`);
                
                if (children.length === 0) {
                    const studentFromContact = await this.createProfileFromContact(fullContact, phoneNumber);
                    if (studentFromContact) {
                        studentProfiles.push(studentFromContact);
                    }
                } else {
                    for (const child of children) {
                        console.log(`👤 Создание профиля для: ${child.studentName}`);
                        
                        const subscriptionData = await this.findLatestActiveSubscription(contact.id);
                        
                        let bestSubscriptionInfo = this.extractSubscriptionInfo(null);
                        let bestLead = null;
                        
                        if (subscriptionData) {
                            bestLead = subscriptionData.lead;
                            bestSubscriptionInfo = subscriptionData.subscription;
                            console.log(`✅ Найден абонемент для ${child.studentName}`);
                        } else {
                            console.log(`⚠️  Абонемент не найден для ${child.studentName}`);
                        }
                        
                        const studentProfile = this.createStudentProfile(
                            fullContact,
                            phoneNumber,
                            child,
                            bestSubscriptionInfo,
                            bestLead
                        );
                        
                        studentProfiles.push(studentProfile);
                    }
                }
            }
            
            console.log(`🎯 Итого создано профилей: ${studentProfiles.length}`);
            
        } catch (crmError) {
            console.error(`❌ Ошибка получения данных из amoCRM:`, crmError.message);
        }
        
        return studentProfiles;
    }

    async createProfileFromContact(contact, phoneNumber) {
        try {
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
            
            if (contact.custom_fields_values) {
                for (const field of contact.custom_fields_values) {
                    const fieldId = field.field_id;
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue) continue;
                    
                    if (fieldId === this.FIELD_IDS.CONTACT.BRANCH) {
                        studentInfo.branch = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.TEACHER) {
                        studentInfo.teacherName = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.DAY_OF_WEEK) {
                        studentInfo.dayOfWeek = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) {
                        studentInfo.hasActiveSubscription = fieldValue.toLowerCase() === 'да';
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.LAST_VISIT) {
                        studentInfo.lastVisitDate = this.parseDate(fieldValue);
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.AGE_GROUP) {
                        studentInfo.ageGroup = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.ALLERGIES) {
                        studentInfo.allergies = fieldValue;
                    }
                }
            }
            
            const subscriptionData = await this.findLatestActiveSubscription(contact.id);
            
            let subscriptionInfo = this.extractSubscriptionInfo(null);
            let bestLead = null;
            
            if (subscriptionData) {
                bestLead = subscriptionData.lead;
                subscriptionInfo = subscriptionData.subscription;
            }
            
            return this.createStudentProfile(
                contact,
                phoneNumber,
                studentInfo,
                subscriptionInfo,
                bestLead
            );
            
        } catch (error) {
            console.error('❌ Ошибка создания профиля из контакта:', error);
            return null;
        }
    }

    // ==================== ДЕБАГ МЕТОДЫ ====================
    
    async debugContact(contactId) {
        try {
            console.log(`🔍 ДЕБАГ КОНТАКТА ${contactId}`);
            
            const contact = await this.getFullContactInfo(contactId);
            if (!contact) {
                console.log('❌ Контакт не найден');
                return null;
            }
            
            console.log(`👤 Контакт: ${contact.name} (ID: ${contact.id})`);
            
            // Выводим все поля
            if (contact.custom_fields_values) {
                console.log(`📊 КАСТОМНЫЕ ПОЛЯ (${contact.custom_fields_values.length}):`);
                
                for (const field of contact.custom_fields_values) {
                    const fieldId = field.field_id;
                    const fieldValue = this.getFieldValue(field);
                    
                    console.log(`  ${fieldId}: ${fieldValue}`);
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
            console.log(`🔍 ДЕБАГ СДЕЛКИ ${leadId}`);
            
            const lead = await this.getLeadById(leadId);
            if (!lead) {
                console.log('❌ Сделка не найдена');
                return null;
            }
            
            console.log(`📄 Сделка: "${lead.name}" (ID: ${lead.id})`);
            
            // Выводим все поля сделки
            if (lead.custom_fields_values) {
                console.log(`📊 КАСТОМНЫЕ ПОЛЯ СДЕЛКИ (${lead.custom_fields_values.length}):`);
                
                for (const field of lead.custom_fields_values) {
                    const fieldId = field.field_id;
                    const fieldValue = this.getFieldValue(field);
                    
                    console.log(`  ${fieldId}: ${fieldValue}`);
                    
                    // Особый вывод для поля "Абонемент занятий:"
                    if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES) {
                        console.log(`  🔢 Это поле "Абонемент занятий:"`);
                        console.log(`  📊 Enum mapping: ${this.SUBSCRIPTION_ENUM_MAPPING[fieldValue] || 'не найден'}`);
                    }
                }
            }
            
            return lead;
            
        } catch (error) {
            console.error('❌ Ошибка дебага сделки:', error.message);
            return null;
        }
    }

    async getAllFieldsInfo() {
        try {
            console.log(`📊 Получение информации о полях amoCRM`);
            
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
                const leadFieldsResponse = await this.makeRequest('GET', '/api/v4/leads/custom_fields');
                const leadFields = Array.isArray(leadFieldsResponse) ? leadFieldsResponse : [];
                result.lead_fields = leadFields;
                console.log(`✅ Поля сделок получены: ${leadFields.length}`);
                
                for (const field of leadFields) {
                    if (field && field.id) {
                        result.field_mappings.push({
                            id: field.id,
                            name: field.name || 'Без имени',
                            type: field.type || 'unknown',
                            entity_type: 'lead',
                            is_in_our_config: Object.values(this.FIELD_IDS.LEAD).includes(field.id)
                        });
                    }
                }
            } catch (error) {
                console.log(`⚠️  Не удалось получить поля сделок: ${error.message}`);
            }
            
            // Получаем все поля контактов
            try {
                const contactFieldsResponse = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
                const contactFields = Array.isArray(contactFieldsResponse) ? contactFieldsResponse : [];
                result.contact_fields = contactFields;
                console.log(`✅ Поля контактов получены: ${contactFields.length}`);
                
                for (const field of contactFields) {
                    if (field && field.id) {
                        result.field_mappings.push({
                            id: field.id,
                            name: field.name || 'Без имени',
                            type: field.type || 'unknown',
                            entity_type: 'contact',
                            is_in_our_config: Object.values(this.FIELD_IDS.CONTACT).includes(field.id)
                        });
                    }
                }
            } catch (error) {
                console.log(`⚠️  Не удалось получить поля контактов: ${error.message}`);
            }
            
            result.custom_fields_count = result.field_mappings.length;
            
            console.log(`📊 ИТОГО: ${result.custom_fields_count} полей`);
            
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
                `/api/v4/leads/${leadId}?with=custom_fields_values`
            );
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения сделки ${leadId}:`, error.message);
            return null;
        }
    }

    createDemoProfile(phoneNumber) {
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
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    savedCount++;
                } else {
                    const setClause = columns.map(col => `${col} = ?`).join(', ');
                    
                    await db.run(
                        `UPDATE student_profiles SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [...values, existingProfile.id]
                    );
                    savedCount++;
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка сохранения профиля:`, profileError.message);
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

// ==================== API МАРШРУТЫ ====================

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '4.1.0',
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
        
        let profiles = [];
        
        if (amoCrmService.isInitialized) {
            console.log('🔍 Поиск в amoCRM...');
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            console.log(`📊 Найдено профилей в amoCRM: ${profiles.length}`);
            
            if (profiles.length > 0) {
                await saveProfilesToDatabase(profiles);
            }
        }
        
        if (profiles.length === 0) {
            console.log('🔍 Поиск в локальной базе данных...');
            const cleanPhone = phone.replace(/\D/g, '');
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            console.log(`📊 Найдено профилей в локальной БД: ${profiles.length}`);
        }
        
        if (profiles.length === 0) {
            console.log('🎭 Создание демо-профиля...');
            const demoProfile = amoCrmService.createDemoProfile(formattedPhone);
            profiles = [demoProfile];
            await saveProfilesToDatabase([demoProfile]);
        }
        
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            first_name: profiles.length > 0 ? profiles[0].student_name?.split(' ')[0] || 'Ученик' : 'Гость',
            is_temp: true,
            profiles_count: profiles.length
        };
        
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
        
        const hasRealData = profiles.some(p => p.source === 'amocrm' && p.is_demo === 0);
        const hasMultipleStudents = profiles.length > 1;
        
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
            
            const cleanPhone = phone.replace(/\D/g, '');
            const profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            
            console.log(`📊 Найдено профилей: ${profiles.length}`);
            
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
            jwt.verify(token, JWT_SECRET);
            
            console.log(`\n🎫 ПОЛУЧЕНИЕ ИНФОРМАЦИИ ОБ АБОНЕМЕНТЕ ДЛЯ ПРОФИЛЯ: ${profile_id}`);
            
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
            
            const subscriptionData = {
                profile_id: profile.id,
                student_name: profile.student_name,
                subscription_type: profile.subscription_type,
                subscription_active: profile.subscription_active === 1,
                subscription_status: profile.subscription_status,
                subscription_badge: profile.subscription_badge,
                total_classes: profile.total_classes,
                used_classes: profile.used_classes,
                remaining_classes: profile.remaining_classes,
                expiration_date: profile.expiration_date,
                activation_date: profile.activation_date,
                last_visit_date: profile.last_visit_date,
                updated_at: profile.updated_at
            };
            
            console.log(`✅ Данные абонемента получены`);
            
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
        
        // Безопасная обработка массивов
        const leadFields = Array.isArray(fieldsInfo.lead_fields) ? fieldsInfo.lead_fields : [];
        const contactFields = Array.isArray(fieldsInfo.contact_fields) ? fieldsInfo.contact_fields : [];
        
        const response = {
            success: true,
            data: {
                account: {
                    name: fieldsInfo.account?.name || 'Неизвестно',
                    id: fieldsInfo.account?.id || 'Неизвестно'
                },
                statistics: {
                    total_fields: fieldsInfo.custom_fields_count || 0,
                    lead_fields: leadFields.length,
                    contact_fields: contactFields.length,
                    fields_in_our_config: fieldsInfo.field_mappings?.filter(f => f.is_in_our_config).length || 0
                },
                our_field_config: amoCrmService.FIELD_IDS,
                field_mappings: fieldsInfo.field_mappings || [],
                lead_fields: leadFields.slice(0, 20), // Ограничиваем вывод
                contact_fields: contactFields.slice(0, 20) // Ограничиваем вывод
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
                error: 'Контакт не найден'
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

app.get('/api/test/full-cycle/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n🧪 ПОЛНЫЙ ТЕСТОВЫЙ ЦИКЛ ДЛЯ ТЕЛЕФОНА: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(500).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log('\n1️⃣  ПОИСК КОНТАКТОВ...');
        const contacts = await amoCrmService.searchContactsByPhone(formattedPhone);
        console.log(`✅ Найдено контактов: ${contacts.length}`);
        
        const results = [];
        
        for (const contact of contacts.slice(0, 2)) {
            console.log(`\n🔍 АНАЛИЗ КОНТАКТА: ${contact.name} (ID: ${contact.id})`);
            
            const contactResult = {
                contact_id: contact.id,
                contact_name: contact.name,
                students: [],
                leads: []
            };
            
            const fullContact = await amoCrmService.getFullContactInfo(contact.id);
            if (!fullContact) continue;
            
            const students = amoCrmService.extractStudentsFromContact(fullContact);
            contactResult.students = students;
            
            const leads = await amoCrmService.getContactLeads(contact.id);
            console.log(`   Сделок у контакта: ${leads.length}`);
            
            for (const lead of leads.slice(0, 3)) {
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
        
        console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ ЧЕРЕЗ ОСНОВНОЙ МЕТОД...`);
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        console.log(`\n📊 ИТОГ ТЕСТА:`);
        console.log(`   Контактов найдено: ${contacts.length}`);
        console.log(`   Профилей создано: ${profiles.length}`);
        
        res.json({
            success: true,
            data: {
                test_phone: formattedPhone,
                contacts_found: contacts.length,
                profiles_created: profiles.length,
                analysis_results: results,
                profiles: profiles.slice(0, 5)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестового цикла:', error.message);
        
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
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v4.1');
        console.log('='.repeat(100));
        console.log('✨ УЛУЧШЕННЫЙ ПАРСИНГ AMOCRM');
        console.log('✨ ИСПРАВЛЕНЫ ОШИБКИ ОБРАБОТКИ МАССИВОВ');
        console.log('✨ ДОБАВЛЕНЫ ДЕБАГ МАРШРУТЫ');
        console.log('='.repeat(100));
        
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
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(100));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(100));
            console.log(`🌐 Основной URL: http://localhost:${PORT}`);
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
