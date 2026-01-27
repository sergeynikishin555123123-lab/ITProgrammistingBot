// server.js - БЫСТРЫЙ И ЭФФЕКТИВНЫЙ СЕРВЕР

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
const AMOCRM_ACCESS_TOKEN = process.env.AMOCRM_ACCESS_TOKEN;
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN;
const AMOCRM_SUBDOMAIN = AMOCRM_DOMAIN ? AMOCRM_DOMAIN.replace('.amocrm.ru', '') : '';

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

// ==================== КЛАСС AMOCRM SERVICE (БЫСТРЫЙ) ====================
class FastAmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🚀 FAST AmoCrmService - МГНОВЕННЫЙ ПОИСК');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        
        // Кэш для ускорения
        this.contactsCache = new Map();
        this.leadsCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 минут
        
        // ID полей
        this.FIELD_IDS = {
            CONTACT: {
                CHILD_NAME: 867233,  // "!ФИО ребенка:"
                PHONE: 216615,       // "Телефон"
                BRANCH: 871273,      // "Филиал:"
                TEACHER: 888881      // "Преподаватель"
            },
            LEAD: {
                TOTAL_CLASSES: 850241,
                USED_CLASSES: 850257,
                REMAINING_CLASSES: 890163,
                SUBSCRIPTION_TYPE: 891007
            }
        };
    }

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    async initialize() {
        try {
            console.log('🔄 Проверка подключения к amoCRM...');
            
            const response = await axios.get(`${this.baseUrl}/api/v4/account`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });
            
            if (response.data) {
                this.isInitialized = true;
                console.log('✅ amoCRM подключен успешно');
                return true;
            }
            
        } catch (error) {
            console.error('❌ Ошибка подключения к amoCRM:', error.message);
            this.isInitialized = false;
        }
        
        return false;
    }

    // ==================== БЫСТРЫЙ ПОИСК КОНТАКТА ====================
    async findContactByPhone(phone) {
        const startTime = Date.now();
        const cleanPhone = phone.replace(/\D/g, '');
        const last10Digits = cleanPhone.slice(-10);
        
        console.log(`🔍 Поиск контакта: ${last10Digits}`);
        
        // Проверяем кэш
        const cacheKey = `contact_${last10Digits}`;
        const cached = this.contactsCache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            console.log(`⚡ Из кэша: "${cached.data.name}"`);
            return cached.data;
        }
        
        try {
            // БЫСТРЫЙ поиск через фильтр по телефону
            const response = await axios.get(`${this.baseUrl}/api/v4/contacts`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    'filter[custom_fields_values][phone]': last10Digits,
                    'with': 'custom_fields_values',
                    'limit': 5
                },
                timeout: 5000
            });
            
            if (response.data && response.data._embedded && response.data._embedded.contacts) {
                const contacts = response.data._embedded.contacts;
                
                if (contacts.length > 0) {
                    const contact = contacts[0];
                    console.log(`✅ Найден: "${contact.name || 'Без имени'}"`);
                    
                    // Сохраняем в кэш
                    this.contactsCache.set(cacheKey, {
                        data: contact,
                        timestamp: Date.now()
                    });
                    
                    console.log(`⏱️  Время поиска: ${Date.now() - startTime}ms`);
                    return contact;
                }
            }
            
            // Если не нашли через фильтр, пробуем быстрый query
            console.log('🔍 Быстрый query поиск...');
            const queryResponse = await axios.get(`${this.baseUrl}/api/v4/contacts`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    'query': last10Digits,
                    'with': 'custom_fields_values',
                    'limit': 5
                },
                timeout: 5000
            });
            
            if (queryResponse.data && queryResponse.data._embedded && queryResponse.data._embedded.contacts) {
                for (const contact of queryResponse.data._embedded.contacts) {
                    if (this.hasPhone(contact, last10Digits)) {
                        console.log(`✅ Найден через query: "${contact.name}"`);
                        
                        this.contactsCache.set(cacheKey, {
                            data: contact,
                            timestamp: Date.now()
                        });
                        
                        console.log(`⏱️  Общее время: ${Date.now() - startTime}ms`);
                        return contact;
                    }
                }
            }
            
            console.log(`❌ Контакт не найден (${Date.now() - startTime}ms)`);
            return null;
            
        } catch (error) {
            console.error('❌ Ошибка поиска контакта:', error.message);
            return null;
        }
    }

    hasPhone(contact, phoneDigits) {
        if (!contact.custom_fields_values) return false;
        
        for (const field of contact.custom_fields_values) {
            if (field.field_id === this.FIELD_IDS.CONTACT.PHONE && field.values) {
                for (const value of field.values) {
                    const contactPhone = String(value.value || '').replace(/\D/g, '');
                    if (contactPhone.includes(phoneDigits)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // ==================== БЫСТРОЕ ПОЛУЧЕНИЕ СДЕЛОК ====================
    async getContactLeads(contactId) {
        const cacheKey = `leads_${contactId}`;
        const cached = this.leadsCache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            console.log(`⚡ Сделки из кэша: ${cached.data.length}`);
            return cached.data;
        }
        
        try {
            console.log(`🔍 Получение сделок контакта ${contactId}...`);
            
            // Получаем только последние 50 сделок (этого достаточно)
            const response = await axios.get(`${this.baseUrl}/api/v4/leads`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    'filter[contact_id][0]': contactId,
                    'with': 'custom_fields_values',
                    'limit': 50,
                    'order[created_at]': 'desc'
                },
                timeout: 5000
            });
            
            const leads = response.data?._embedded?.leads || [];
            console.log(`📊 Получено сделок: ${leads.length}`);
            
            // Кэшируем
            this.leadsCache.set(cacheKey, {
                data: leads,
                timestamp: Date.now()
            });
            
            return leads;
            
        } catch (error) {
            console.error('❌ Ошибка получения сделок:', error.message);
            return [];
        }
    }

    // ==================== УМНЫЙ ПОИСК СДЕЛКИ ====================
    async findStudentSubscription(contactId, studentName) {
        console.log(`\n🎯 Поиск абонемента для: "${studentName}"`);
        
        const leads = await this.getContactLeads(contactId);
        if (leads.length === 0) return null;
        
        const normalizedStudentName = studentName.toLowerCase();
        const studentLastName = normalizedStudentName.split(' ').pop();
        
        // Стратегии поиска в порядке приоритета
        const searchStrategies = [
            // 1. По полному совпадению имени в названии
            (lead) => {
                const leadName = lead.name.toLowerCase();
                return leadName.includes(normalizedStudentName);
            },
            
            // 2. По совпадению фамилии
            (lead) => {
                if (!studentLastName || studentLastName.length < 3) return false;
                const leadName = lead.name.toLowerCase();
                return leadName.includes(studentLastName);
            },
            
            // 3. Поиск в воронке абонементов (ID: 7977402)
            (lead) => lead.pipeline_id === 7977402,
            
            // 4. По активным статусам
            (lead) => [65473306, 142, 143].includes(lead.status_id),
            
            // 5. По наличию полей абонемента
            (lead) => {
                if (!lead.custom_fields_values) return false;
                return lead.custom_fields_values.some(field => 
                    [850241, 850257, 890163, 891007].includes(field.field_id)
                );
            }
        ];
        
        // Применяем стратегии по порядку
        for (const strategy of searchStrategies) {
            for (const lead of leads) {
                if (strategy(lead)) {
                    console.log(`✅ Найдена сделка: "${lead.name}"`);
                    const subscription = this.extractSubscription(lead);
                    if (subscription.hasSubscription) {
                        console.log(`🎫 Абонемент найден!`);
                        return { lead, subscription };
                    }
                }
            }
        }
        
        console.log('❌ Абонемент не найден');
        return null;
    }

    // ==================== БЫСТРОЕ ИЗВЛЕЧЕНИЕ ДАННЫХ ====================
    extractSubscription(lead) {
        const fields = lead.custom_fields_values || [];
        
        const getValue = (fieldId) => {
            const field = fields.find(f => f.field_id === fieldId);
            if (!field || !field.values || field.values.length === 0) return null;
            
            const value = field.values[0].value;
            
            // Извлекаем число из строки
            if (typeof value === 'string') {
                const match = value.match(/\d+/);
                return match ? parseInt(match[0]) : value;
            }
            
            return value;
        };
        
        const total = getValue(850241) || 0;
        const used = getValue(850257) || 0;
        const remaining = getValue(890163) || 0;
        
        return {
            hasSubscription: total > 0 || remaining > 0,
            subscriptionActive: [65473306, 142, 143].includes(lead.status_id),
            totalClasses: total,
            usedClasses: used,
            remainingClasses: remaining > 0 ? remaining : (total - used),
            subscriptionType: getValue(891007) || 'Без абонемента'
        };
    }

    // ==================== ГЛАВНЫЙ МЕТОД (БЫСТРЫЙ) ====================
    async getStudentProfile(phone) {
        const startTime = Date.now();
        console.log(`\n📱 ЗАПРОС: ${phone}`);
        
        try {
            // 1. Быстрый поиск контакта
            const contact = await this.findContactByPhone(phone);
            if (!contact) {
                console.log(`⏱️  Время выполнения: ${Date.now() - startTime}ms`);
                return null;
            }
            
            // 2. Извлекаем ученика из контакта
            const childField = contact.custom_fields_values?.find(f => 
                f.field_id === this.FIELD_IDS.CONTACT.CHILD_NAME
            );
            
            if (!childField || !childField.values || childField.values.length === 0) {
                console.log('❌ Ученик не указан в контакте');
                console.log(`⏱️  Время выполнения: ${Date.now() - startTime}ms`);
                return null;
            }
            
            const studentName = childField.values[0].value;
            console.log(`👤 Ученик: ${studentName}`);
            
            // 3. Ищем абонемент
            const subscriptionResult = await this.findStudentSubscription(contact.id, studentName);
            
            // 4. Формируем профиль
            const profile = {
                contactId: contact.id,
                leadId: subscriptionResult?.lead?.id,
                studentName: studentName,
                phone: phone,
                parentName: contact.name || '',
                branch: this.getFieldValue(contact, this.FIELD_IDS.CONTACT.BRANCH) || '',
                teacher: this.getFieldValue(contact, this.FIELD_IDS.CONTACT.TEACHER) || '',
                subscription: subscriptionResult ? subscriptionResult.subscription : {
                    hasSubscription: false,
                    subscriptionActive: false,
                    subscriptionType: 'Без абонемента',
                    totalClasses: 0,
                    usedClasses: 0,
                    remainingClasses: 0
                }
            };
            
            console.log(`✅ Профиль создан за ${Date.now() - startTime}ms`);
            console.log(`📊 ${profile.subscription.usedClasses}/${profile.subscription.totalClasses} занятий`);
            
            return profile;
            
        } catch (error) {
            console.error('❌ Критическая ошибка:', error.message);
            console.log(`⏱️  Время выполнения: ${Date.now() - startTime}ms`);
            return null;
        }
    }

    getFieldValue(contact, fieldId) {
        const field = contact.custom_fields_values?.find(f => f.field_id === fieldId);
        if (!field || !field.values || field.values.length === 0) return null;
        return field.values[0].value;
    }
}

// Создаем экземпляр быстрого сервиса
const amoCrmService = new FastAmoCrmService();

// ==================== БАЗА ДАННЫХ (ОПТИМИЗИРОВАННАЯ) ====================
let db;

const initDatabase = async () => {
    try {
        const dbPath = path.join(__dirname, 'data', 'fast_school.db');
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });
        
        // Простая таблица для профилей
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                student_name TEXT NOT NULL,
                parent_name TEXT,
                branch TEXT,
                subscription_type TEXT,
                total_classes INTEGER DEFAULT 0,
                used_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 0,
                last_sync TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(phone, student_name)
            )
        `);
        
        await db.run('CREATE INDEX IF NOT EXISTS idx_phone ON student_profiles(phone)');
        
        console.log('✅ База данных оптимизирована');
        return db;
        
    } catch (error) {
        console.error('❌ Ошибка БД:', error.message);
        return null;
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function formatPhone(phone) {
    const clean = phone.replace(/\D/g, '');
    if (clean.length === 10) return '+7' + clean;
    if (clean.length === 11 && clean.startsWith('7')) return '+' + clean;
    if (clean.length === 11 && clean.startsWith('8')) return '+7' + clean.slice(1);
    return '+7' + clean.slice(-10);
}

// Кэш для сессий (ускоряем проверку токенов)
const sessionCache = new Map();

// ==================== ОСНОВНЫЕ API МАРШРУТЫ ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Быстрый сервер школы рисования',
        timestamp: new Date().toISOString(),
        amocrm_connected: amoCrmService.isInitialized
    });
});

// БЫСТРАЯ авторизация
app.post('/api/auth/phone', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { phone } = req.body;
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите телефон'
            });
        }
        
        const formattedPhone = formatPhone(phone);
        console.log(`\n📱 АВТОРИЗАЦИЯ: ${formattedPhone}`);
        
        // Проверяем локальную базу (быстрее всего)
        const cachedProfile = await db?.get(
            `SELECT * FROM student_profiles WHERE phone = ? AND is_active = 1 ORDER BY last_sync DESC LIMIT 1`,
            [formattedPhone]
        );
        
        if (cachedProfile && amoCrmService.isInitialized) {
            console.log(`⚡ Данные из кэша (${Date.now() - startTime}ms)`);
            
            const token = jwt.sign(
                { phone: formattedPhone, timestamp: Date.now() },
                JWT_SECRET,
                { expiresIn: '7d' }
            );
            
            return res.json({
                success: true,
                data: {
                    profile: {
                        student_name: cachedProfile.student_name,
                        phone: cachedProfile.phone,
                        subscription_type: cachedProfile.subscription_type,
                        total_classes: cachedProfile.total_classes,
                        used_classes: cachedProfile.used_classes,
                        remaining_classes: cachedProfile.remaining_classes,
                        is_active: cachedProfile.is_active === 1
                    },
                    token: token,
                    from_cache: true,
                    response_time: Date.now() - startTime
                }
            });
        }
        
        // Если нет в кэше и amoCRM подключен, ищем в CRM
        if (amoCrmService.isInitialized) {
            const profile = await amoCrmService.getStudentProfile(formattedPhone);
            
            if (profile) {
                // Сохраняем в базу
                if (db) {
                    await db.run(
                        `INSERT OR REPLACE INTO student_profiles 
                         (phone, student_name, parent_name, branch, subscription_type, 
                          total_classes, used_classes, remaining_classes, is_active, last_sync)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            profile.phone,
                            profile.studentName,
                            profile.parentName,
                            profile.branch,
                            profile.subscription.subscriptionType,
                            profile.subscription.totalClasses,
                            profile.subscription.usedClasses,
                            profile.subscription.remainingClasses,
                            profile.subscription.subscriptionActive ? 1 : 0,
                            new Date().toISOString()
                        ]
                    );
                }
                
                const token = jwt.sign(
                    { phone: formattedPhone, timestamp: Date.now() },
                    JWT_SECRET,
                    { expiresIn: '7d' }
                );
                
                console.log(`✅ Авторизация успешна за ${Date.now() - startTime}ms`);
                
                return res.json({
                    success: true,
                    data: {
                        profile: {
                            student_name: profile.studentName,
                            phone: profile.phone,
                            parent_name: profile.parentName,
                            branch: profile.branch,
                            subscription_type: profile.subscription.subscriptionType,
                            total_classes: profile.subscription.totalClasses,
                            used_classes: profile.subscription.usedClasses,
                            remaining_classes: profile.subscription.remainingClasses,
                            is_active: profile.subscription.subscriptionActive
                        },
                        token: token,
                        from_cache: false,
                        response_time: Date.now() - startTime
                    }
                });
            }
        }
        
        // Если ничего не нашли
        return res.status(404).json({
            success: false,
            error: 'Ученик не найден',
            response_time: Date.now() - startTime
        });
        
    } catch (error) {
        console.error('❌ Ошибка авторизации:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Ошибка сервера',
            response_time: Date.now() - startTime
        });
    }
});

// Быстрое получение абонемента
app.post('/api/subscription', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { phone } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Требуется токен',
                response_time: Date.now() - startTime
            });
        }
        
        // Быстрая проверка токена
        try {
            jwt.verify(token, JWT_SECRET);
        } catch {
            return res.status(401).json({
                success: false,
                error: 'Невалидный токен',
                response_time: Date.now() - startTime
            });
        }
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите телефон',
                response_time: Date.now() - startTime
            });
        }
        
        const formattedPhone = formatPhone(phone);
        
        // Ищем в локальной базе (самый быстрый способ)
        const profile = await db?.get(
            `SELECT * FROM student_profiles WHERE phone = ? ORDER BY last_sync DESC LIMIT 1`,
            [formattedPhone]
        );
        
        if (profile) {
            console.log(`⚡ Данные из локальной БД (${Date.now() - startTime}ms)`);
            
            return res.json({
                success: true,
                data: {
                    student: {
                        name: profile.student_name,
                        phone: profile.phone,
                        branch: profile.branch || 'Не указан'
                    },
                    subscription: {
                        type: profile.subscription_type,
                        is_active: profile.is_active === 1,
                        classes: {
                            total: profile.total_classes,
                            used: profile.used_classes,
                            remaining: profile.remaining_classes
                        }
                    },
                    response_time: Date.now() - startTime,
                    data_source: 'local_cache'
                }
            });
        }
        
        // Если нет в локальной базе
        return res.status(404).json({
            success: false,
            error: 'Данные не найдены',
            response_time: Date.now() - startTime
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения абонемента:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Ошибка сервера',
            response_time: Date.now() - startTime
        });
    }
});

// Тестовый маршрут для проверки скорости
app.get('/api/test-speed/:phone', async (req, res) => {
    const startTime = Date.now();
    const phone = req.params.phone;
    
    try {
        const formattedPhone = formatPhone(phone);
        console.log(`\n🧪 ТЕСТ СКОРОСТИ: ${formattedPhone}`);
        
        const profile = await amoCrmService.getStudentProfile(formattedPhone);
        const totalTime = Date.now() - startTime;
        
        res.json({
            success: !!profile,
            data: profile,
            performance: {
                total_time_ms: totalTime,
                acceptable: totalTime < 2000,
                rating: totalTime < 1000 ? 'excellent' : 
                       totalTime < 2000 ? 'good' : 
                       totalTime < 5000 ? 'slow' : 'very_slow'
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            performance: {
                total_time_ms: Date.now() - startTime
            }
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🚀 ЗАПУСК БЫСТРОГО СЕРВЕРА');
        console.log('⚡ ОЖИДАЕМАЯ СКОРОСТЬ: < 2 секунды');
        console.log('='.repeat(80));
        
        await initDatabase();
        
        console.log('\n🔄 Подключение к amoCRM...');
        await amoCrmService.initialize();
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('✅ СЕРВЕР ЗАПУЩЕН!');
            console.log('='.repeat(80));
            console.log(`🌐 URL: http://localhost:${PORT}`);
            console.log(`⚡ Быстрая авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`⚡ Быстрый абонемент: POST http://localhost:${PORT}/api/subscription`);
            console.log(`🧪 Тест скорости: GET http://localhost:${PORT}/api/test-speed/79265725212`);
            console.log('='.repeat(80));
            console.log('\n📊 ОЖИДАЕМЫЕ ВРЕМЕНА ОТКЛИКА:');
            console.log('   • Из локального кэша: < 50ms');
            console.log('   • Поиск в amoCRM: < 2000ms');
            console.log('   • Максимальное время: < 5000ms');
            console.log('='.repeat(80));
        });
        
    } catch (error) {
        console.error('❌ Ошибка запуска:', error.message);
        process.exit(1);
    }
};

startServer();
