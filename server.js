// server.js - ПОЛНАЯ ПЕРЕРАБОТАННАЯ ВЕРСИЯ С ОПТИМИЗИРОВАННЫМ КЛАССОМ AMOCRM
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

// ==================== ОПТИМИЗИРОВАННЫЙ КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🚀 СОЗДАНИЕ OPTIMIZED AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        
        // Кэш для быстрого доступа
        this.cache = new Map();
        this.cacheTTL = 10 * 60 * 1000; // 10 минут
        
        // ID полей (только самые важные для оптимизации)
        this.FIELD_IDS = {
            LEAD: {
                TOTAL_CLASSES: 850241,
                USED_CLASSES: 850257,
                REMAINING_CLASSES: 890163,
                EXPIRATION_DATE: 850255,
                ACTIVATION_DATE: 851565,
                LAST_VISIT_DATE: 850259,
                SUBSCRIPTION_TYPE: 891007,
                BRANCH: 891589,
                AGE_GROUP: 850243,
                PURCHASE_DATE: 850253,
                TECHNICAL_CLASSES: 891819
            },
            
            CONTACT: {
                CHILD_1_NAME: 867233,
                CHILD_2_NAME: 867235,
                CHILD_3_NAME: 867733,
                BRANCH: 871273,
                TEACHER: 888881,
                HAS_ACTIVE_SUB: 890179,
                LAST_VISIT: 885380,
                EMAIL: 850217
            }
        };
    }

    async initialize() {
        try {
            if (this.accessToken) {
                console.log('🔍 Проверка валидности токена...');
                const isValid = await this.checkTokenValidity(this.accessToken);
                this.isInitialized = isValid;
                return isValid;
            }
            return false;
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
                timeout: 5000
            });
            
            console.log('✅ Токен валиден!');
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
                timeout: 10000
            };

            if (data) config.data = data;

            const response = await axios(config);
            return response.data;
        } catch (error) {
            console.error(`❌ Ошибка запроса ${endpoint}:`, error.message);
            throw error;
        }
    }

    // 🔥 ОСНОВНОЙ ОПТИМИЗИРОВАННЫЙ МЕТОД
    async getStudentsByPhone(phoneNumber) {
        console.log(`\n🎯 ПОИСК УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        const cacheKey = `phone_${phoneNumber}`;
        
        // Проверяем кэш
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTTL) {
                console.log(`📦 Используем кэшированные данные`);
                return cached.profiles;
            }
        }
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return this.createDemoProfiles(phoneNumber);
        }
        
        try {
            // 1. Быстрый поиск контакта
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const searchPhone = cleanPhone.length === 11 && cleanPhone.startsWith('7') 
                ? `+${cleanPhone}`
                : `+7${cleanPhone.slice(-10)}`;
            
            console.log(`🔍 Поиск контакта: ${searchPhone}`);
            
            const contactsResponse = await this.makeRequest(
                'GET', 
                `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=custom_fields_values&limit=5`
            );
            
            const contacts = contactsResponse._embedded?.contacts || [];
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                console.log('📭 Контакты не найдены');
                const demoProfiles = this.createDemoProfiles(phoneNumber);
                this.cache.set(cacheKey, { profiles: demoProfiles, timestamp: Date.now() });
                return demoProfiles;
            }
            
            const profiles = [];
            
            // 2. Для каждого контакта быстрый поиск
            for (const contact of contacts) {
                console.log(`\n👤 Обработка контакта: ${contact.name || 'Без имени'}`);
                
                // Извлекаем детей из контакта
                const children = this.extractChildrenFromContact(contact);
                console.log(`👶 Найдено детей: ${children.length}`);
                
                if (children.length === 0) {
                    // Если нет детей, создаем профиль из самого контакта
                    const profile = this.createProfileFromContact(contact, phoneNumber);
                    profiles.push(profile);
                } else {
                    // Для каждого ребенка создаем профиль
                    for (const child of children) {
                        // 🔥 КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: быстрый поиск абонемента
                        const subscription = await this.findLatestSubscriptionFast(contact.id, child.name);
                        
                        const profile = this.createStudentProfile(
                            contact,
                            phoneNumber,
                            child,
                            subscription
                        );
                        
                        profiles.push(profile);
                    }
                }
            }
            
            // Кэшируем результаты
            this.cache.set(cacheKey, { profiles: profiles, timestamp: Date.now() });
            
            console.log(`\n✅ Создано профилей: ${profiles.length}`);
            return profiles;
            
        } catch (error) {
            console.error('❌ Ошибка поиска учеников:', error.message);
            const demoProfiles = this.createDemoProfiles(phoneNumber);
            this.cache.set(cacheKey, { profiles: demoProfiles, timestamp: Date.now() });
            return demoProfiles;
        }
    }

    // 🔥 БЫСТРЫЙ ПОИСК ПОСЛЕДНЕГО АБОНЕМЕНТА
    async findLatestSubscriptionFast(contactId, studentName = '') {
        console.log(`⚡ Быстрый поиск абонемента для контакта ${contactId}`);
        
        const cacheKey = `subscription_${contactId}_${studentName}`;
        
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTTL) {
                return cached.subscription;
            }
        }
        
        try {
            // Ищем ТОЛЬКО ПОСЛЕДНИЕ 20 сделок для скорости
            const leadsResponse = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contacts][id]=${contactId}&limit=20&order[created_at]=desc`
            );
            
            const leads = leadsResponse._embedded?.leads || [];
            console.log(`📋 Проверяем ${leads.length} последних сделок`);
            
            if (leads.length === 0) {
                return this.createEmptySubscription();
            }
            
            // Ищем первую сделку с абонементом
            for (const lead of leads) {
                if (this.hasSubscriptionFields(lead)) {
                    console.log(`🎯 Найден абонемент: ${lead.id} "${lead.name}"`);
                    
                    // Извлекаем информацию об абонементе
                    const subscription = this.extractSubscriptionFromLead(lead);
                    
                    // Кэшируем
                    this.cache.set(cacheKey, { 
                        subscription: subscription, 
                        timestamp: Date.now() 
                    });
                    
                    return subscription;
                }
            }
            
            console.log('📭 Сделок с абонементами не найдено');
            return this.createEmptySubscription();
            
        } catch (error) {
            console.error('❌ Ошибка поиска абонемента:', error.message);
            return this.createEmptySubscription();
        }
    }

    // 🔥 ПРОВЕРКА ЕСТЬ ЛИ В СДЕЛКЕ ПОЛЯ АБОНЕМЕНТА
    hasSubscriptionFields(lead) {
        if (!lead.custom_fields_values || lead.custom_fields_values.length === 0) {
            return false;
        }
        
        // Быстрая проверка по ключевым полям
        for (const field of lead.custom_fields_values) {
            const fieldId = field.field_id || field.id;
            
            // Ключевые поля абонемента
            if ([
                this.FIELD_IDS.LEAD.TOTAL_CLASSES,
                this.FIELD_IDS.LEAD.USED_CLASSES,
                this.FIELD_IDS.LEAD.REMAINING_CLASSES,
                this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE
            ].includes(fieldId)) {
                
                const value = this.getFieldValue(field);
                if (value && value.trim() !== '') {
                    return true;
                }
            }
        }
        
        return false;
    }

    // 🔥 ИЗВЛЕЧЕНИЕ ИНФОРМАЦИИ ОБ АБОНЕМЕНТЕ ИЗ СДЕЛКИ
    extractSubscriptionFromLead(lead) {
        const subscription = {
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
            leadId: lead.id,
            leadName: lead.name,
            statusId: lead.status_id || 0
        };
        
        if (!lead.custom_fields_values) {
            return subscription;
        }
        
        // Собираем данные из полей
        for (const field of lead.custom_fields_values) {
            const fieldId = field.field_id || field.id;
            const fieldValue = this.getFieldValue(field);
            
            if (!fieldValue || fieldValue.trim() === '') continue;
            
            switch(fieldId) {
                case this.FIELD_IDS.LEAD.TOTAL_CLASSES:
                    subscription.totalClasses = this.parseClassesCount(fieldValue);
                    subscription.hasSubscription = true;
                    break;
                    
                case this.FIELD_IDS.LEAD.USED_CLASSES:
                    subscription.usedClasses = this.parseClassesCount(fieldValue);
                    subscription.hasSubscription = true;
                    break;
                    
                case this.FIELD_IDS.LEAD.REMAINING_CLASSES:
                    subscription.remainingClasses = parseInt(fieldValue) || 0;
                    subscription.hasSubscription = true;
                    break;
                    
                case this.FIELD_IDS.LEAD.EXPIRATION_DATE:
                    subscription.expirationDate = this.parseDate(fieldValue);
                    subscription.hasSubscription = true;
                    break;
                    
                case this.FIELD_IDS.LEAD.ACTIVATION_DATE:
                    subscription.activationDate = this.parseDate(fieldValue);
                    subscription.hasSubscription = true;
                    break;
                    
                case this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE:
                    subscription.subscriptionType = fieldValue;
                    subscription.hasSubscription = true;
                    break;
                    
                case this.FIELD_IDS.LEAD.BRANCH:
                    subscription.branch = fieldValue;
                    break;
                    
                case this.FIELD_IDS.LEAD.LAST_VISIT_DATE:
                    subscription.lastVisitDate = this.parseDate(fieldValue);
                    break;
            }
        }
        
        // 🎯 АВТОМАТИЧЕСКИЙ РАСЧЕТ
        if (subscription.hasSubscription) {
            // Расчет остатка если его нет
            if (subscription.totalClasses > 0 && subscription.remainingClasses === 0) {
                subscription.remainingClasses = Math.max(
                    0, 
                    subscription.totalClasses - subscription.usedClasses
                );
                console.log(`🔢 Рассчитан остаток: ${subscription.remainingClasses}`);
            }
            
            // Расчет общего количества если его нет
            if (subscription.totalClasses === 0 && subscription.remainingClasses > 0 && subscription.usedClasses > 0) {
                subscription.totalClasses = subscription.usedClasses + subscription.remainingClasses;
                console.log(`🔢 Рассчитано общее количество: ${subscription.totalClasses}`);
            }
            
            // Определение статуса
            const today = new Date();
            const isExpired = subscription.expirationDate ? 
                new Date(subscription.expirationDate) < today : false;
            
            const isFuture = subscription.activationDate ? 
                new Date(subscription.activationDate) > today : false;
            
            if (isExpired) {
                subscription.subscriptionStatus = 'Абонемент истек';
                subscription.subscriptionBadge = 'expired';
            }
            else if (isFuture) {
                subscription.subscriptionStatus = 'Ожидает активации';
                subscription.subscriptionBadge = 'pending';
            }
            else if (subscription.remainingClasses > 0) {
                subscription.subscriptionStatus = `Активный (осталось ${subscription.remainingClasses}/${subscription.totalClasses || '?'} занятий)`;
                subscription.subscriptionBadge = 'active';
                subscription.subscriptionActive = true;
            }
            else if (subscription.usedClasses > 0 && subscription.totalClasses > 0) {
                subscription.subscriptionStatus = 'Занятия закончились';
                subscription.subscriptionBadge = 'expired';
            }
            else {
                subscription.subscriptionStatus = subscription.subscriptionType || 'Абонемент';
                subscription.subscriptionBadge = 'has_subscription';
            }
        }
        
        return subscription;
    }

    // 🔥 ИЗВЛЕЧЕНИЕ ДЕТЕЙ ИЗ КОНТАКТА
    extractChildrenFromContact(contact) {
        const children = [];
        
        if (!contact.custom_fields_values) {
            return children;
        }
        
        const childFields = [
            { number: 1, nameId: this.FIELD_IDS.CONTACT.CHILD_1_NAME },
            { number: 2, nameId: this.FIELD_IDS.CONTACT.CHILD_2_NAME },
            { number: 3, nameId: this.FIELD_IDS.CONTACT.CHILD_3_NAME }
        ];
        
        for (const childConfig of childFields) {
            let childName = '';
            
            // Ищем имя ребенка
            for (const field of contact.custom_fields_values) {
                if (field.field_id === childConfig.nameId || field.id === childConfig.nameId) {
                    childName = this.getFieldValue(field);
                    break;
                }
            }
            
            if (childName && childName.trim() !== '') {
                children.push({
                    name: childName,
                    number: childConfig.number
                });
            }
        }
        
        return children;
    }

    // 🔥 СОЗДАНИЕ ПРОФИЛЯ ИЗ КОНТАКТА
    createProfileFromContact(contact, phoneNumber) {
        let studentName = contact.name || 'Ученик';
        let branch = '';
        let teacher = '';
        
        // Ищем данные в полях контакта
        if (contact.custom_fields_values) {
            for (const field of contact.custom_fields_values) {
                const fieldId = field.field_id || field.id;
                const value = this.getFieldValue(field);
                
                if (!value) continue;
                
                if (fieldId === this.FIELD_IDS.CONTACT.BRANCH) {
                    branch = value;
                }
                else if (fieldId === this.FIELD_IDS.CONTACT.TEACHER) {
                    teacher = value;
                }
            }
        }
        
        return {
            amocrm_contact_id: contact.id,
            student_name: studentName,
            phone_number: phoneNumber,
            branch: branch || 'Филиал не указан',
            teacher_name: teacher || '',
            subscription_type: 'Без абонемента',
            subscription_active: 0,
            subscription_status: 'Нет активного абонемента',
            subscription_badge: 'inactive',
            total_classes: 0,
            used_classes: 0,
            remaining_classes: 0,
            source: 'amocrm',
            is_demo: 0
        };
    }

    // 🔥 СОЗДАНИЕ ПРОФИЛЯ УЧЕНИКА
    createStudentProfile(contact, phoneNumber, child, subscription) {
        let branch = '';
        let teacher = '';
        let email = '';
        
        // Извлекаем данные из контакта
        if (contact.custom_fields_values) {
            for (const field of contact.custom_fields_values) {
                const fieldId = field.field_id || field.id;
                const value = this.getFieldValue(field);
                
                if (!value) continue;
                
                if (fieldId === this.FIELD_IDS.CONTACT.BRANCH) {
                    branch = value;
                }
                else if (fieldId === this.FIELD_IDS.CONTACT.TEACHER) {
                    teacher = value;
                }
                else if (fieldId === this.FIELD_IDS.CONTACT.EMAIL) {
                    email = value;
                }
            }
        }
        
        // Используем branch из абонемента, если он там есть
        if (subscription.branch) {
            branch = subscription.branch;
        }
        
        return {
            amocrm_contact_id: contact.id,
            amocrm_lead_id: subscription.leadId || null,
            student_name: child.name,
            phone_number: phoneNumber,
            email: email,
            branch: branch || 'Филиал не указан',
            teacher_name: teacher || '',
            
            // Данные абонемента
            subscription_type: subscription.subscriptionType || 'Без абонемента',
            subscription_active: subscription.subscriptionActive ? 1 : 0,
            subscription_status: subscription.subscriptionStatus,
            subscription_badge: subscription.subscriptionBadge,
            total_classes: subscription.totalClasses || 0,
            used_classes: subscription.usedClasses || 0,
            remaining_classes: subscription.remainingClasses || 0,
            expiration_date: subscription.expirationDate || null,
            activation_date: subscription.activationDate || null,
            last_visit_date: subscription.lastVisitDate || null,
            
            source: 'amocrm',
            is_demo: 0
        };
    }

    // 🔥 СОЗДАНИЕ ПУСТОГО АБОНЕМЕНТА
    createEmptySubscription() {
        return {
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
            leadId: null,
            leadName: '',
            statusId: 0
        };
    }

    // 🔥 СОЗДАНИЕ ДЕМО-ПРОФИЛЕЙ
    createDemoProfiles(phoneNumber) {
        console.log('📦 Создание демо-профилей');
        
        return [{
            amocrm_contact_id: null,
            amocrm_lead_id: null,
            student_name: 'Демо Ученик',
            phone_number: phoneNumber,
            email: '',
            branch: 'Свиблово',
            teacher_name: 'Демо Преподаватель',
            day_of_week: 'Пятница',
            time_slot: '18:00',
            subscription_type: 'Демо-абонемент',
            subscription_active: 1,
            subscription_status: 'Активный (осталось 4/8 занятий)',
            subscription_badge: 'active',
            total_classes: 8,
            used_classes: 4,
            remaining_classes: 4,
            expiration_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            activation_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            last_visit_date: new Date().toISOString().split('T')[0],
            source: 'demo',
            is_demo: 1
        }];
    }

    // 📋 ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ

    getFieldValue(field) {
        try {
            if (!field || !field.values || !Array.isArray(field.values) || field.values.length === 0) {
                return '';
            }
            
            const firstValue = field.values[0];
            
            if (typeof firstValue === 'object' && firstValue !== null) {
                if (firstValue.value !== undefined && firstValue.value !== null) {
                    return String(firstValue.value);
                }
                else if (firstValue.enum_id !== undefined) {
                    return String(firstValue.enum_id);
                }
            }
            
            return String(firstValue);
        } catch (error) {
            return '';
        }
    }

    parseClassesCount(value) {
        if (!value) return 0;
        
        const str = String(value).toLowerCase().trim();
        
        // Быстрый парсинг чисел
        const numberMatch = str.match(/(\d+)/);
        if (numberMatch) {
            return parseInt(numberMatch[1]);
        }
        
        // Текстовые значения
        const textToNumber = {
            'четыре': 4, '4': 4,
            'восемь': 8, '8': 8,
            'шестнадцать': 16, '16': 16,
            'двадцать четыре': 24, '24': 24
        };
        
        for (const [text, num] of Object.entries(textToNumber)) {
            if (str.includes(text)) {
                return num;
            }
        }
        
        return 0;
    }

    parseDate(value) {
        if (!value) return '';
        
        try {
            const str = String(value).trim();
            
            // Если это timestamp (10 цифр)
            if (str.match(/^\d{10}$/)) {
                const timestamp = parseInt(str) * 1000;
                return new Date(timestamp).toISOString().split('T')[0];
            }
            
            // Если это уже дата в формате YYYY-MM-DD
            if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
                return str;
            }
            
            // Если это дата в формате DD.MM.YYYY
            if (str.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
                const parts = str.split('.');
                return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
            
            return str;
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error);
            return '';
        }
    }

    // 🔄 ОЧИСТКА КЭША
    clearCache() {
        this.cache.clear();
        console.log('🧹 Кэш очищен');
    }

    // 📊 СТАТИСТИКА КЭША
    getCacheStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
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
