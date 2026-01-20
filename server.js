// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;
const { Telegraf, Markup, session } = require('telegraf');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const crypto = require('crypto');

const app = express();

// ==================== КОНФИГУРАЦИЯ ====================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DOMAIN = process.env.DOMAIN || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'art-school-jwt-secret';

// Настройки amoCRM
const AMOCRM_CLIENT_ID = process.env.AMOCRM_CLIENT_ID;
const AMOCRM_CLIENT_SECRET = process.env.AMOCRM_CLIENT_SECRET;
const AMOCRM_REDIRECT_URI = process.env.AMOCRM_REDIRECT_URI;
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN;
const AMOCRM_ACCESS_TOKEN = process.env.AMOCRM_ACCESS_TOKEN;

console.log('🔧 Проверка конфигурации amoCRM:');
console.log(`  Domain: ${AMOCRM_DOMAIN ? '✅' : '❌'} ${AMOCRM_DOMAIN}`);
console.log(`  Access Token: ${AMOCRM_ACCESS_TOKEN ? '✅ (' + AMOCRM_ACCESS_TOKEN.substring(0, 30) + '...)' : '❌'}`);
console.log(`  Client ID: ${AMOCRM_CLIENT_ID ? '✅' : '❌'}`);
console.log(`  Client Secret: ${AMOCRM_CLIENT_SECRET ? '✅' : '❌'}`);

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

// ==================== TELEGRAM БОТ ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
bot.use(session({ defaultSession: () => ({}) }));

// ==================== AMOCRM СЕРВИС С ДОЛГОСРОЧНЫМ ТОКЕНОМ ====================
class AmoCrmService {
    constructor() {
        console.log('🔄 Создание AmoCrmService...');
        
        this.baseUrl = AMOCRM_DOMAIN ? `https://${AMOCRM_DOMAIN}` : null;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.clientId = AMOCRM_CLIENT_ID;
        this.clientSecret = AMOCRM_CLIENT_SECRET;
        this.isInitialized = false;
        this.tokenExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 дней для долгосрочного токена
    }

    async initialize() {
        console.log('\n🔄 Инициализация amoCRM с долгосрочным токеном...');
        
        if (!AMOCRM_DOMAIN) {
            console.log('❌ AMOCRM_DOMAIN не указан');
            return false;
        }

        if (!this.accessToken) {
            console.log('❌ AMOCRM_ACCESS_TOKEN не указан');
            return false;
        }

        console.log(`🔑 Используем долгосрочный токен (JWT)`);
        console.log(`🌐 Домен: ${AMOCRM_DOMAIN}`);
        console.log(`⏰ Токен истекает: ${new Date(this.tokenExpiresAt).toLocaleString()}`);
        
        // Проверяем валидность токена
        try {
            await this.checkTokenValidity();
            this.isInitialized = true;
            console.log('✅ amoCRM инициализирован с долгосрочным токеном');
            return true;
        } catch (error) {
            console.log('❌ Ошибка проверки токена:', error.message);
            
            // Если это JWT токен, парсим его для получения информации
            if (this.accessToken.startsWith('eyJ')) {
                try {
                    const payload = JSON.parse(Buffer.from(this.accessToken.split('.')[1], 'base64').toString());
                    console.log('📋 Информация из JWT токена:');
                    console.log(`   Аккаунт ID: ${payload.account_id}`);
                    console.log(`   Истекает: ${new Date(payload.exp * 1000).toLocaleString()}`);
                    console.log(`   Домен API: ${payload.api_domain}`);
                    
                    // Проверяем не истек ли токен
                    if (payload.exp * 1000 < Date.now()) {
                        console.log('❌ Токен истек!');
                        return false;
                    }
                    
                    // Если есть api_domain, используем его
                    if (payload.api_domain) {
                        this.baseUrl = `https://${payload.api_domain}`;
                        console.log(`🌐 Используем API домен: ${payload.api_domain}`);
                    }
                    
                    // Пробуем сделать тестовый запрос
                    console.log('🔄 Тестируем подключение...');
                    await this.testConnection();
                    this.isInitialized = true;
                    console.log('✅ amoCRM инициализирован (JWT токен)');
                    return true;
                } catch (jwtError) {
                    console.log('❌ Ошибка парсинга JWT токена:', jwtError.message);
                    return false;
                }
            }
            
            return false;
        }
    }

    async testConnection() {
        try {
            const response = await axios.get(`${this.baseUrl}/api/v4/account`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'ArtSchoolBot/1.0'
                },
                timeout: 10000
            });
            
            console.log('✅ Подключение успешно!');
            console.log(`📊 Аккаунт: ${response.data.name}`);
            console.log(`🏷️  ID: ${response.data.id}`);
            console.log(`🌍 Поддомен: ${response.data.subdomain}`);
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка подключения:');
            if (error.response) {
                console.log(`   Статус: ${error.response.status}`);
                console.log(`   Сообщение: ${error.response.data?.title || error.response.statusText}`);
                
                if (error.response.status === 401) {
                    console.log('   🔒 Неверный токен или нет доступа');
                } else if (error.response.status === 402) {
                    console.log('   💰 Нет активной подписки amoCRM');
                } else if (error.response.status === 403) {
                    console.log('   🚫 Доступ запрещен');
                } else if (error.response.status === 404) {
                    console.log('   🔍 Аккаунт не найден');
                }
            } else {
                console.log(`   Ошибка сети: ${error.message}`);
            }
            throw error;
        }
    }

    async checkTokenValidity() {
        return await this.testConnection();
    }

    async makeRequest(method, endpoint, data = null) {
        if (!this.isInitialized) {
            throw new Error('amoCRM не инициализирован');
        }

        const url = `${this.baseUrl}${endpoint}`;
        console.log(`🌐 ${method} ${endpoint}`);
        
        try {
            const config = {
                method: method,
                url: url,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'ArtSchoolBot/1.0'
                },
                timeout: 15000
            };

            if (data) {
                config.data = data;
            }

            const response = await axios(config);
            return response.data;
            
        } catch (error) {
            console.error(`❌ Ошибка запроса: ${method} ${endpoint}`);
            
            if (error.response) {
                console.error(`   Статус: ${error.response.status}`);
                console.error(`   Ответ:`, error.response.data);
            } else {
                console.error(`   Сообщение: ${error.message}`);
            }
            
            throw error;
        }
    }

    async searchContactsByPhone(phoneNumber) {
        console.log(`\n🔍 Поиск контактов по телефону: ${phoneNumber}`);
        
        try {
            // Очищаем номер
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const searchPhone = cleanPhone.length === 10 ? `+7${cleanPhone}` : cleanPhone;
            
            console.log(`🔎 Ищем: ${searchPhone}`);
            
            // Пробуем поиск через query
            const response = await this.makeRequest('GET', `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&limit=50`);
            
            console.log(`📊 Найдено контактов: ${response._embedded?.contacts?.length || 0}`);
            
            // Логируем найденные контакты
            if (response._embedded?.contacts) {
                response._embedded.contacts.forEach((contact, index) => {
                    console.log(`   ${index + 1}. ${contact.name} (ID: ${contact.id})`);
                    
                    // Ищем телефоны в кастомных полях
                    if (contact.custom_fields_values) {
                        const phones = contact.custom_fields_values
                            .filter(field => field.field_code === 'PHONE' || field.field_name?.toLowerCase().includes('телефон'))
                            .flatMap(field => field.values?.map(v => v.value) || []);
                        
                        if (phones.length > 0) {
                            console.log(`     📞 Телефоны: ${phones.join(', ')}`);
                        }
                    }
                });
            }
            
            return response;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    async getContactDetails(contactId) {
        try {
            const response = await this.makeRequest('GET', `/api/v4/contacts/${contactId}`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения контакта ${contactId}: ${error.message}`);
            throw error;
        }
    }

    async getLeadsByContactId(contactId) {
        try {
            const response = await this.makeRequest('GET', `/api/v4/leads?filter[contacts][id]=${contactId}`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return { _embedded: { leads: [] } };
        }
    }

    async parseContactToStudentProfile(contact) {
        console.log(`🔍 Парсинг контакта: ${contact.name}`);
        
        const profile = {
            amocrm_contact_id: contact.id,
            student_name: contact.name || 'Не указано',
            parent_name: '',
            phone_number: '',
            email: '',
            branch: 'Не указан',
            subscription_type: 'Без абонемента',
            total_classes: 0,
            remaining_classes: 0,
            expiration_date: null,
            teacher_name: '',
            day_of_week: '',
            time_slot: '',
            is_demo: 0
        };
        
        // Парсим кастомные поля
        if (contact.custom_fields_values) {
            console.log(`📋 Кастомные поля (${contact.custom_fields_values.length}):`);
            
            for (const field of contact.custom_fields_values) {
                const fieldName = field.field_name?.toLowerCase() || '';
                const fieldCode = field.field_code || '';
                const fieldValues = field.values || [];
                
                if (fieldValues.length > 0) {
                    const value = fieldValues[0].value;
                    
                    if (fieldCode === 'PHONE' || fieldName.includes('телефон')) {
                        profile.phone_number = value;
                        console.log(`   📞 Телефон: ${value}`);
                    }
                    else if (fieldCode === 'EMAIL' || fieldName.includes('email')) {
                        profile.email = value;
                    }
                    else if (fieldName.includes('филиал') || fieldName.includes('branch')) {
                        profile.branch = value;
                        console.log(`   🏢 Филиал: ${value}`);
                    }
                    else if (fieldName.includes('родитель') || fieldName.includes('parent')) {
                        profile.parent_name = value;
                    }
                    else if (fieldName.includes('преподаватель') || fieldName.includes('учитель')) {
                        profile.teacher_name = value;
                    }
                }
            }
        }
        
        return profile;
    }

    async getStudentsByPhone(phoneNumber) {
        console.log(`\n🎯 Поиск учеников по телефону: ${phoneNumber}`);
        
        try {
            // Ищем в amoCRM
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            console.log(`📊 Контактов найдено: ${contacts.length}`);
            
            const profiles = [];
            
            // Обрабатываем каждый найденный контакт
            for (const contact of contacts) {
                try {
                    // Создаем профиль из контакта
                    let profile = await this.parseContactToStudentProfile(contact);
                    
                    // Получаем сделки для контакта
                    const leadsResponse = await this.getLeadsByContactId(contact.id);
                    const leads = leadsResponse._embedded?.leads || [];
                    
                    if (leads.length > 0) {
                        const lead = leads[0];
                        profile.subscription_type = lead.name || 'Абонемент';
                        profile.total_classes = lead.price || 0;
                        
                        // Пытаемся получить оставшиеся занятия из кастомных полей
                        if (lead.custom_fields_values) {
                            for (const field of lead.custom_fields_values) {
                                const fieldName = field.field_name?.toLowerCase() || '';
                                if (fieldName.includes('осталось') && field.values?.[0]) {
                                    profile.remaining_classes = parseInt(field.values[0].value) || 0;
                                }
                            }
                        }
                        
                        // Если не нашли оставшиеся, считаем 70%
                        if (!profile.remaining_classes && profile.total_classes) {
                            profile.remaining_classes = Math.floor(profile.total_classes * 0.7);
                        }
                    }
                    
                    profiles.push(profile);
                    console.log(`✅ Профиль создан: ${profile.student_name}`);
                    
                } catch (contactError) {
                    console.error(`❌ Ошибка обработки контакта ${contact.id}: ${contactError.message}`);
                }
            }
            
            return profiles;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска учеников: ${error.message}`);
            
            // В случае ошибки возвращаем демо-данные
            return this.getDemoProfiles(phoneNumber);
        }
    }

    getDemoProfiles(phoneNumber) {
        console.log('🎭 Используем демо-данные');
        
        return [
            {
                student_name: 'Иван Иванов',
                parent_name: 'Мария Иванова',
                phone_number: phoneNumber,
                email: 'ivan@example.com',
                branch: 'Свиблово',
                subscription_type: 'Художественный курс для начинающих',
                total_classes: 12,
                remaining_classes: 5,
                expiration_date: '2024-12-31',
                teacher_name: 'Анна Петрова',
                day_of_week: 'понедельник',
                time_slot: '16:00-17:30',
                is_demo: 1
            }
        ];
    }
}

// Создаем экземпляр сервиса
const amoCrmService = new AmoCrmService();

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('\n🔄 Инициализация базы данных...');
        
        // Создаем директорию для базы данных
        const dbDir = path.join(__dirname, 'data');
        try {
            await fs.mkdir(dbDir, { recursive: true });
            console.log(`📁 Директория создана: ${dbDir}`);
        } catch (error) {
            // Директория уже существует
        }
        
        const dbPath = path.join(dbDir, 'art_school.db');
        console.log(`💾 База данных: ${dbPath}`);
        
        try {
            db = await open({
                filename: dbPath,
                driver: sqlite3.Database
            });
            
            console.log('✅ База данных подключена');
            
            // Настройки SQLite
            await db.run('PRAGMA journal_mode = WAL');
            await db.run('PRAGMA foreign_keys = ON');
            
            // Создаем таблицы
            await createTables();
            
            console.log('🎉 База данных готова');
            return db;
            
        } catch (error) {
            console.error(`❌ Ошибка SQLite: ${error.message}`);
            
            // Пробуем in-memory базу
            console.log('🔄 Пробуем in-memory базу...');
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            await createTables();
            console.log('⚠️  Используется in-memory база (данные не сохранятся)');
            return db;
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка базы данных:', error.message);
        throw error;
    }
};

const createTables = async () => {
    try {
        console.log('\n📊 Создание таблиц...');
        
        // Основные таблицы
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amocrm_contact_id INTEGER,
                student_name TEXT NOT NULL,
                parent_name TEXT,
                phone_number TEXT NOT NULL,
                email TEXT,
                branch TEXT,
                subscription_type TEXT,
                total_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                expiration_date DATE,
                teacher_name TEXT,
                day_of_week TEXT,
                time_slot TEXT,
                is_demo INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await db.exec(`
            CREATE TABLE IF NOT EXISTS teachers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                photo_url TEXT,
                qualification TEXT,
                specialization TEXT,
                experience_years INTEGER,
                description TEXT,
                branches TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await db.exec(`
            CREATE TABLE IF NOT EXISTS schedule (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                branch TEXT NOT NULL,
                day_of_week TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                teacher_name TEXT,
                group_name TEXT,
                room_number TEXT,
                max_students INTEGER DEFAULT 10,
                current_students INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await db.exec(`
            CREATE TABLE IF NOT EXISTS faq (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                category TEXT,
                display_order INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await db.exec(`
            CREATE TABLE IF NOT EXISTS news (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                short_description TEXT,
                image_url TEXT,
                branch TEXT,
                is_active INTEGER DEFAULT 1,
                publish_date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('✅ Таблицы созданы');
        
        // Создаем демо-данные
        await createDemoData();
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};

const createDemoData = async () => {
    try {
        console.log('\n📝 Создание демо-данных...');
        
        // Проверяем, есть ли уже данные
        const hasTeachers = await db.get("SELECT 1 FROM teachers LIMIT 1");
        
        if (!hasTeachers) {
            // Демо преподаватели
            const teachers = [
                ['Анна Петрова', 'https://via.placeholder.com/300x300/4A90E2/FFFFFF?text=АП', 
                 'Художник-педагог, член Союза художников России', 
                 'Академический рисунок, графика', 8,
                 'Опытный преподаватель с 8-летним стажем. Специализируется на академическом рисунке и графике.',
                 '["Свиблово"]'],
                 
                ['Сергей Смирнов', 'https://via.placeholder.com/300x300/9C6ADE/FFFFFF?text=СС',
                 'Художник-живописец, преподаватель с 10-летним стажем',
                 'Акварель, масляная живопись', 10,
                 'Эксперт в акварельной и масляной живописи. Работы учеников регулярно участвуют в выставках.',
                 '["Чертаново"]'],
                 
                ['Елена Ковалева', 'https://via.placeholder.com/300x300/FFC107/FFFFFF?text=ЕК',
                 'Иллюстратор, дизайнер, преподаватель детских групп',
                 'Скетчинг, иллюстрация, детское творчество', 6,
                 'Специализируется на работе с детьми. Разработала авторскую методику обучения рисованию для детей.',
                 '["Свиблово", "Чертаново"]']
            ];
            
            for (const teacher of teachers) {
                await db.run(
                    `INSERT INTO teachers (name, photo_url, qualification, specialization, 
                     experience_years, description, branches) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    teacher
                );
            }
            console.log('✅ Демо-преподаватели созданы');
        }
        
        // Демо расписание
        const hasSchedule = await db.get("SELECT 1 FROM schedule LIMIT 1");
        if (!hasSchedule) {
            const schedule = [
                ['Свиблово', 'понедельник', '16:00', '17:30', 'Анна Петрова', 'Дети 7-9 лет', 'Кабинет 1', 8, 6],
                ['Свиблово', 'понедельник', '18:00', '19:30', 'Анна Петрова', 'Подростки 10-12 лет', 'Кабинет 1', 8, 5],
                ['Чертаново', 'среда', '16:30', '18:00', 'Сергей Смирнов', 'Взрослые', 'Кабинет 3', 10, 8],
                ['Чертаново', 'суббота', '11:00', '12:30', 'Сергей Смирнов', 'Подростки', 'Кабинет 3', 8, 7]
            ];
            
            for (const item of schedule) {
                await db.run(
                    `INSERT INTO schedule (branch, day_of_week, start_time, end_time, 
                     teacher_name, group_name, room_number, max_students, current_students) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    item
                );
            }
            console.log('✅ Демо-расписание создано');
        }
        
        // Демо FAQ
        const hasFaq = await db.get("SELECT 1 FROM faq LIMIT 1");
        if (!hasFaq) {
            const faq = [
                ['Как продлить абонемент?', 
                 'Для продления абонемента свяжитесь с администратором вашего филиала через кнопку "Связаться с администратором" в разделе "Абонемент".', 
                 'subscription', 1],
                 
                ['Что делать, если нужно пропустить занятие?', 
                 'Если вы пропускаете занятие по уважительной причине, сообщите об этом администратору за 24 часа. В некоторых случаях возможно перенести занятие.', 
                 'attendance', 2]
            ];
            
            for (const item of faq) {
                await db.run(
                    `INSERT INTO faq (question, answer, category, display_order) 
                     VALUES (?, ?, ?, ?)`,
                    item
                );
            }
            console.log('✅ Демо-FAQ созданы');
        }
        
        console.log('🎉 Демо-данные готовы');
        
    } catch (error) {
        console.error('⚠️  Ошибка создания демо-данных:', error.message);
    }
};

// ==================== API ЭНДПОИНТЫ ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер художественной школы работает',
        timestamp: new Date().toISOString(),
        amocrm_connected: amoCrmService.isInitialized,
        using_demo_data: !amoCrmService.isInitialized
    });
});

// Статус amoCRM
app.get('/api/amocrm/status', async (req, res) => {
    try {
        const status = {
            is_initialized: amoCrmService.isInitialized,
            domain: AMOCRM_DOMAIN,
            has_access_token: !!AMOCRM_ACCESS_TOKEN,
            has_client_id: !!AMOCRM_CLIENT_ID,
            using_demo_data: !amoCrmService.isInitialized
        };
        
        // Если amoCRM инициализирован, получаем информацию об аккаунте
        if (amoCrmService.isInitialized) {
            try {
                const accountInfo = await amoCrmService.makeRequest('GET', '/api/v4/account');
                status.account_info = {
                    id: accountInfo.id,
                    name: accountInfo.name,
                    subdomain: accountInfo.subdomain
                };
            } catch (error) {
                status.account_error = error.message;
            }
        }
        
        res.json({
            success: true,
            data: status
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статуса'
        });
    }
});

// Тест подключения к amoCRM
app.get('/api/amocrm/test', async (req, res) => {
    try {
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                error: 'amoCRM не инициализирован',
                details: {
                    has_domain: !!AMOCRM_DOMAIN,
                    has_token: !!AMOCRM_ACCESS_TOKEN,
                    token_type: AMOCRM_ACCESS_TOKEN?.startsWith('eyJ') ? 'JWT' : 'OAuth'
                }
            });
        }
        
        const tests = [];
        
        // Тест 1: Получение информации об аккаунте
        try {
            const accountInfo = await amoCrmService.makeRequest('GET', '/api/v4/account');
            tests.push({
                name: 'Получение информации об аккаунте',
                success: true,
                data: {
                    account_id: accountInfo.id,
                    name: accountInfo.name
                }
            });
        } catch (error) {
            tests.push({
                name: 'Получение информации об аккаунте',
                success: false,
                error: error.message,
                status: error.response?.status
            });
        }
        
        // Тест 2: Поиск контактов
        try {
            const contacts = await amoCrmService.searchContactsByPhone('79991234567');
            tests.push({
                name: 'Поиск контактов',
                success: true,
                data: {
                    contacts_found: contacts._embedded?.contacts?.length || 0
                }
            });
        } catch (error) {
            tests.push({
                name: 'Поиск контактов',
                success: false,
                error: error.message
            });
        }
        
        res.json({
            success: true,
            tests: tests,
            summary: {
                total_tests: tests.length,
                passed: tests.filter(t => t.success).length,
                failed: tests.filter(t => !t.success).length
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка тестирования amoCRM'
        });
    }
});

// Поиск учеников по телефону
app.post('/api/auth/phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`\n📞 Поиск ученика: ${phone}`);
        
        // Ищем профили
        const profiles = await amoCrmService.getStudentsByPhone(phone);
        
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        if (profiles.length === 0) {
            return res.json({
                success: true,
                message: 'Профили не найдены',
                data: {
                    profiles: [],
                    total_profiles: 0,
                    amocrm_connected: amoCrmService.isInitialized,
                    using_demo_data: !amoCrmService.isInitialized
                }
            });
        }
        
        // Создаем JWT токен
        const token = jwt.sign(
            {
                phone: phone,
                profiles_count: profiles.length,
                timestamp: Date.now()
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Авторизация успешна',
            data: {
                user: {
                    phone_number: phone,
                    first_name: profiles[0].student_name?.split(' ')[0] || 'Ученик'
                },
                profiles: profiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                using_demo_data: profiles.some(p => p.is_demo),
                token: token
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка поиска ученика',
            details: error.message
        });
    }
});

// Получение расписания
app.get('/api/schedule', async (req, res) => {
    try {
        const { branch } = req.query;
        
        let query = 'SELECT * FROM schedule WHERE is_active = 1';
        const params = [];
        
        if (branch) {
            query += ' AND branch = ?';
            params.push(branch);
        }
        
        query += ' ORDER BY day_of_week, start_time';
        
        const schedule = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                schedule: schedule,
                total: schedule.length
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения расписания'
        });
    }
});

// Получение преподавателей
app.get('/api/teachers', async (req, res) => {
    try {
        const { branch } = req.query;
        
        let query = 'SELECT * FROM teachers WHERE is_active = 1';
        const params = [];
        
        if (branch) {
            query += ' AND branches LIKE ?';
            params.push(`%${branch}%`);
        }
        
        query += ' ORDER BY name';
        
        const teachers = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                teachers: teachers,
                total: teachers.length
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения преподавателей'
        });
    }
});

// Получение FAQ
app.get('/api/faq', async (req, res) => {
    try {
        const faq = await db.all(
            'SELECT * FROM faq WHERE is_active = 1 ORDER BY display_order'
        );
        
        res.json({
            success: true,
            data: {
                faq: faq,
                total: faq.length
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения FAQ'
        });
    }
});

// Получение новостей
app.get('/api/news', async (req, res) => {
    try {
        const { branch } = req.query;
        
        let query = 'SELECT * FROM news WHERE is_active = 1';
        const params = [];
        
        if (branch) {
            query += ' AND (branch = ? OR branch IS NULL)';
            params.push(branch);
        }
        
        query += ' ORDER BY publish_date DESC';
        
        const news = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                news: news,
                total: news.length
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения новостей'
        });
    }
});

// Телеграм бот команды
const WEB_APP_URL = DOMAIN.replace('https://', '').replace('http://', '');

bot.start(async (ctx) => {
    await ctx.replyWithHTML(
        `🎨 <b>Добро пожаловать в художественную студию!</b>\n\n` +
        `Для доступа к вашему расписанию, абонементу и другим функциям перейдите в наше веб-приложение:`,
        Markup.inlineKeyboard([
            Markup.button.webApp(
                '🚀 Открыть приложение',
                `https://${WEB_APP_URL}`
            )
        ])
    );
});

bot.command('app', async (ctx) => {
    await ctx.replyWithHTML(
        `🎨 <b>Откройте приложение художественной студии</b>\n\n` +
        `Перейдите по кнопке ниже, чтобы получить доступ ко всем функциям:`,
        Markup.inlineKeyboard([
            Markup.button.webApp(
                '🚀 Открыть приложение',
                `https://${WEB_APP_URL}`
            )
        ])
    );
});

bot.on('text', async (ctx) => {
    await ctx.replyWithHTML(
        `🎨 Для работы с функциями художественной студии используйте наше веб-приложение:`,
        Markup.inlineKeyboard([
            Markup.button.webApp(
                '🚀 Открыть приложение',
                `https://${WEB_APP_URL}`
            )
        ])
    );
});

// Webhook для Telegram
app.post('/webhook', (req, res) => {
    bot.handleUpdate(req.body, res);
});

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use('/api/', limiter);

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(60));
        console.log('🎨 ЗАПУСК ХУДОЖЕСТВЕННОЙ ШКОЛЫ');
        console.log('='.repeat(60));
        
        // Инициализация базы данных
        await initDatabase();
        
        // Инициализация amoCRM
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM успешно подключен!');
            console.log(`🌐 Домен: ${AMOCRM_DOMAIN}`);
        } else {
            console.log('⚠️  amoCRM не подключен, используются демо-данные');
        }
        
        // Запуск Telegram бота
        console.log('\n🤖 Запуск Telegram бота...');
        try {
            await bot.launch();
            console.log('✅ Telegram бот запущен');
        } catch (botError) {
            if (botError.response?.error_code === 409) {
                console.log('⚠️  Бот уже запущен в другом процессе');
            } else {
                console.error('❌ Ошибка запуска бота:', botError.message);
            }
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(60));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН!');
            console.log('='.repeat(60));
            console.log(`🌐 URL: http://localhost:${PORT}`);
            console.log(`🤖 Бот: ${TELEGRAM_BOT_TOKEN ? '✅ Настроен' : '❌ Нет'}`);
            console.log(`📊 База: SQLite`);
            console.log(`🔗 amoCRM: ${crmInitialized ? '✅ Подключен' : '❌ Демо-данные'}`);
            console.log('='.repeat(60));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('- Веб-приложение: /');
            console.log('- Статус API: /api/status');
            console.log('- Тест amoCRM: /api/amocrm/test');
            console.log('- Поиск ученика: POST /api/auth/phone');
        });
        
    } catch (error) {
        console.error('❌ Ошибка запуска сервера:', error.message);
        process.exit(1);
    }
};

// Обработка завершения
process.on('SIGINT', async () => {
    console.log('\n🔄 Остановка сервера...');
    if (db) await db.close();
    bot.stop();
    console.log('✅ Сервер остановлен');
    process.exit(0);
});

// Запуск
startServer();
