// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;
const { Telegraf, Markup, session } = require('telegraf');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const querystring = require('querystring');

const app = express();

// ==================== КОНФИГУРАЦИЯ ====================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8425388642:AAFpXOa7lYdGYmimJvxyDg2PXyLjlxYrSq4';
const DOMAIN = process.env.DOMAIN || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'art-school-jwt-secret-2024';

// Настройки amoCRM
const AMOCRM_CLIENT_ID = process.env.AMOCRM_CLIENT_ID;
const AMOCRM_CLIENT_SECRET = process.env.AMOCRM_CLIENT_SECRET;
const AMOCRM_REDIRECT_URI = process.env.AMOCRM_REDIRECT_URI;
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN;
const AMOCRM_AUTH_CODE = process.env.AMOCRM_AUTH_CODE;
const AMOCRM_ACCESS_TOKEN = process.env.AMOCRM_ACCESS_TOKEN;

// ==================== НАСТРОЙКА EXPRESS ====================
app.set('trust proxy', 1); // Важно для rate-limit

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

// ==================== ИНИЦИАЛИЗАЦИЯ TELEGRAM БОТА ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
bot.use(session({ defaultSession: () => ({}) }));

// ==================== УПРОЩЕННЫЙ КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        this.baseUrl = AMOCRM_DOMAIN ? `https://${AMOCRM_DOMAIN}` : null;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = !!(AMOCRM_DOMAIN && AMOCRM_ACCESS_TOKEN);
        
        if (this.isInitialized) {
            console.log(`✅ amoCRM подключен: ${AMOCRM_DOMAIN}`);
        } else {
            console.log('⚠️ amoCRM не подключен, используются демо-данные');
        }
    }

    async initialize() {
        return this.isInitialized;
    }

    async makeRequest(method, endpoint, data = null) {
        if (!this.isInitialized) {
            throw new Error('amoCRM не инициализирован');
        }

        try {
            const config = {
                method: method,
                url: `${this.baseUrl}${endpoint}`,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            };

            if (data) {
                config.data = data;
            }

            const response = await axios(config);
            return response.data;
            
        } catch (error) {
            console.error(`❌ Ошибка запроса к amoCRM ${endpoint}:`, error.message);
            throw error;
        }
    }

    async getContacts(filters = {}) {
        try {
            if (!this.isInitialized) {
                return this.getMockContacts();
            }
            
            let query = '/api/v4/contacts';
            const params = [];
            
            if (filters.phone) {
                query += `?query=${encodeURIComponent(filters.phone)}`;
            }
            
            if (filters.limit) {
                query += `${query.includes('?') ? '&' : '?'}limit=${filters.limit}`;
            }
            
            return await this.makeRequest('GET', query);
            
        } catch (error) {
            console.log('⚠️ Использую демо-данные для контактов');
            return this.getMockContacts();
        }
    }

    async getLeads(filters = {}) {
        try {
            if (!this.isInitialized) {
                return this.getMockLeads();
            }
            
            let query = '/api/v4/leads';
            
            if (filters.contact_id) {
                query += `?filter[contacts][id]=${filters.contact_id}`;
            }
            
            return await this.makeRequest('GET', query);
            
        } catch (error) {
            console.log('⚠️ Использую демо-данные для сделок');
            return this.getMockLeads();
        }
    }

    getMockContacts() {
        return {
            _embedded: {
                contacts: [
                    {
                        id: 1001,
                        name: "Иван Иванов",
                        custom_fields_values: [
                            {
                                field_name: "Телефон",
                                values: [{ value: "+79991234567" }]
                            },
                            {
                                field_name: "Филиал",
                                values: [{ value: "Свиблово" }]
                            },
                            {
                                field_name: "Родитель",
                                values: [{ value: "Мария Иванова" }]
                            },
                            {
                                field_name: "Email",
                                values: [{ value: "ivan@example.com" }]
                            }
                        ]
                    },
                    {
                        id: 1002,
                        name: "Мария Сидорова",
                        custom_fields_values: [
                            {
                                field_name: "Телефон",
                                values: [{ value: "+79997654321" }]
                            },
                            {
                                field_name: "Филиал",
                                values: [{ value: "Чертаново" }]
                            },
                            {
                                field_name: "Родитель",
                                values: [{ value: "Ольга Сидорова" }]
                            },
                            {
                                field_name: "Email",
                                values: [{ value: "maria@example.com" }]
                            }
                        ]
                    }
                ]
            }
        };
    }

    getMockLeads() {
        return {
            _embedded: {
                leads: [
                    {
                        id: 2001,
                        name: "Абонемент #2001",
                        price: 12000,
                        status_id: 142,
                        created_at: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60,
                        custom_fields_values: [
                            {
                                field_name: "Всего занятий",
                                values: [{ value: 12 }]
                            },
                            {
                                field_name: "Осталось занятий",
                                values: [{ value: 5 }]
                            },
                            {
                                field_name: "Дата окончания",
                                values: [{ value: "2024-12-31" }]
                            }
                        ]
                    }
                ]
            }
        };
    }

    async syncAllData() {
        try {
            console.log('🔄 Синхронизация данных...');
            
            if (this.isInitialized) {
                await this.syncTeachersFromAmo();
                await this.syncStudentsFromAmo();
                await this.syncSubscriptionsFromAmo();
                console.log('✅ Данные синхронизированы из amoCRM');
            } else {
                console.log('📝 Загрузка демо-данных...');
                await this.syncDemoData();
            }
            
            return true;
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации:', error.message);
            await this.syncDemoData();
            return false;
        }
    }

    async syncTeachersFromAmo() {
        try {
            if (!this.isInitialized) {
                return this.syncDemoTeachers();
            }
            
            const response = await this.makeRequest('GET', '/api/v4/users');
            const users = response._embedded?.users || [];
            
            for (const user of users) {
                const existingTeacher = await db.get(
                    'SELECT * FROM teachers WHERE amocrm_user_id = ?',
                    [user.id]
                );
                
                const teacherData = {
                    name: user.name || '',
                    email: user.email || '',
                    phone_number: user.phone || '',
                    amocrm_user_id: user.id,
                    is_active: 1
                };
                
                if (!existingTeacher) {
                    await db.run(
                        `INSERT INTO teachers (name, email, phone_number, amocrm_user_id, is_active) 
                         VALUES (?, ?, ?, ?, ?)`,
                        Object.values(teacherData)
                    );
                }
            }
            
            console.log(`✅ Синхронизировано ${users.length} преподавателей`);
            
        } catch (error) {
            console.log('⚠️ Использую демо-преподавателей');
            await this.syncDemoTeachers();
        }
    }

    async syncDemoTeachers() {
        try {
            const demoTeachers = [
                ['Анна Петрова', 'https://via.placeholder.com/300x300/4A90E2/FFFFFF?text=АП', 
                 'Художник-педагог, член Союза художников России', 
                 'Академический рисунок, графика', 8,
                 'Опытный преподаватель с 8-летним стажем. Специализируется на академическом рисунке и графике.',
                 '["Свиблово"]', '@anna_petrova', '+79997778899', 'anna@artschool.ru', null, 1],
                 
                ['Сергей Смирнов', 'https://via.placeholder.com/300x300/9C6ADE/FFFFFF?text=СС',
                 'Художник-живописец, преподаватель с 10-летним стажем',
                 'Акварель, масляная живопись', 10,
                 'Эксперт в акварельной и масляной живописи. Работы учеников регулярно участвуют в выставках.',
                 '["Чертаново"]', '@sergey_smirnov', '+79996667788', 'sergey@artschool.ru', null, 2],
                 
                ['Елена Ковалева', 'https://via.placeholder.com/300x300/FFC107/FFFFFF?text=ЕК',
                 'Иллюстратор, дизайнер, преподаватель детских групп',
                 'Скетчинг, иллюстрация, детское творчество', 6,
                 'Специализируется на работе с детьми. Разработала авторскую методику обучения рисованию для детей.',
                 '["Свиблово", "Чертаново"]', '@elena_kovaleva', '+79995554433', 'elena@artschool.ru', null, 3]
            ];
            
            for (const teacher of demoTeachers) {
                const existing = await db.get('SELECT 1 FROM teachers WHERE name = ?', [teacher[0]]);
                if (!existing) {
                    await db.run(
                        `INSERT INTO teachers (name, photo_url, qualification, specialization, 
                         experience_years, description, branches, telegram_username, 
                         phone_number, email, amocrm_user_id, display_order) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        teacher
                    );
                }
            }
            
            console.log('✅ Демо-преподаватели загружены');
            
        } catch (error) {
            console.error('❌ Ошибка загрузки демо-преподавателей:', error.message);
        }
    }

    async syncStudentsFromAmo() {
        try {
            if (!this.isInitialized) {
                return this.syncDemoStudents();
            }
            
            const response = await this.getContacts({ limit: 50 });
            const contacts = response._embedded?.contacts || [];
            
            for (const contact of contacts) {
                let phone = '';
                let branch = '';
                
                if (contact.custom_fields_values) {
                    const phoneField = contact.custom_fields_values.find(field => 
                        field.field_code === 'PHONE' || field.field_name?.toLowerCase().includes('телефон')
                    );
                    if (phoneField?.values?.[0]) {
                        phone = phoneField.values[0].value;
                    }
                    
                    const branchField = contact.custom_fields_values.find(field => 
                        field.field_name?.toLowerCase().includes('филиал')
                    );
                    if (branchField?.values?.[0]) {
                        branch = branchField.values[0].value;
                    }
                }
                
                const existingStudent = await db.get(
                    'SELECT * FROM student_profiles WHERE amocrm_contact_id = ?',
                    [contact.id]
                );
                
                if (!existingStudent) {
                    await db.run(
                        `INSERT INTO student_profiles 
                         (amocrm_contact_id, student_name, phone_number, branch, is_active) 
                         VALUES (?, ?, ?, ?, ?)`,
                        [contact.id, contact.name || '', phone, branch || 'Не указан', 1]
                    );
                }
            }
            
            console.log(`✅ Синхронизировано ${contacts.length} учеников`);
            
        } catch (error) {
            console.log('⚠️ Использую демо-учеников');
            await this.syncDemoStudents();
        }
    }

    async syncDemoStudents() {
        try {
            const demoStudents = [
                [null, 'Иван Иванов', 'Мария Иванова', '+79991234567', 'ivan@example.com', 
                 'Свиблово', 'Художественный курс для начинающих', 12, 5, 
                 '2024-12-31', 'Анна Петрова', 'понедельник', '16:00-17:30'],
                 
                [null, 'Мария Сидорова', 'Ольга Сидорова', '+79997654321', 'maria@example.com',
                 'Чертаново', 'Курс акварельной живописи', 16, 8,
                 '2024-11-30', 'Сергей Смирнов', 'среда', '16:30-18:00']
            ];
            
            for (const student of demoStudents) {
                const existing = await db.get(
                    'SELECT 1 FROM student_profiles WHERE student_name = ? AND phone_number = ?',
                    [student[1], student[3]]
                );
                
                if (!existing) {
                    await db.run(
                        `INSERT INTO student_profiles 
                         (amocrm_contact_id, student_name, parent_name, phone_number, email,
                          branch, subscription_type, total_classes, remaining_classes,
                          expiration_date, teacher_name, day_of_week, time_slot, is_active)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [...student, 1]
                    );
                }
            }
            
            console.log('✅ Демо-ученики загружены');
            
        } catch (error) {
            console.error('❌ Ошибка загрузки демо-учеников:', error.message);
        }
    }

    async syncSubscriptionsFromAmo() {
        try {
            if (!this.isInitialized) {
                return;
            }
            
            const response = await this.getLeads({ limit: 50 });
            const leads = response._embedded?.leads || [];
            
            for (const lead of leads) {
                if (lead._embedded?.contacts?.[0]) {
                    const contactId = lead._embedded.contacts[0].id;
                    
                    await db.run(
                        `UPDATE student_profiles 
                         SET subscription_type = ?, total_classes = ?, remaining_classes = ?,
                             expiration_date = ?
                         WHERE amocrm_contact_id = ?`,
                        [
                            `Абонемент #${lead.id}`,
                            12,
                            8,
                            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                            contactId
                        ]
                    );
                }
            }
            
            console.log(`✅ Синхронизировано ${leads.length} абонементов`);
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации абонементов:', error.message);
        }
    }

    async syncDemoData() {
        await this.syncDemoTeachers();
        await this.syncDemoStudents();
        console.log('✅ Все демо-данные загружены');
    }

    async getStudentByPhoneFromAmo(phoneNumber) {
        try {
            if (!this.isInitialized) {
                return this.getMockStudentProfiles(phoneNumber);
            }
            
            const contacts = await this.getContacts({ phone: phoneNumber });
            
            if (contacts._embedded?.contacts?.length > 0) {
                const contact = contacts._embedded.contacts[0];
                const leads = await this.getLeads({ contact_id: contact.id });
                
                const customFields = {};
                if (contact.custom_fields_values) {
                    for (const field of contact.custom_fields_values) {
                        if (field.values?.[0]) {
                            const fieldName = field.field_name || field.field_code;
                            customFields[fieldName] = field.values[0].value;
                        }
                    }
                }
                
                const studentProfile = {
                    amocrm_contact_id: contact.id,
                    student_name: contact.name || '',
                    parent_name: customFields['Родитель'] || '',
                    phone_number: phoneNumber,
                    email: customFields['Email'] || '',
                    branch: customFields['Филиал'] || 'Не указан',
                    subscription_type: leads._embedded?.leads?.[0] ? `Абонемент #${leads._embedded.leads[0].id}` : 'Без абонемента',
                    total_classes: 12,
                    remaining_classes: 8,
                    expiration_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    teacher_name: customFields['Преподаватель'] || '',
                    day_of_week: customFields['День недели'] || '',
                    time_slot: customFields['Время'] || '',
                    custom_fields: customFields
                };
                
                return [studentProfile];
            }
            
            return this.getMockStudentProfiles(phoneNumber);
            
        } catch (error) {
            console.error('❌ Ошибка получения ученика:', error.message);
            return this.getMockStudentProfiles(phoneNumber);
        }
    }

    getMockStudentProfiles(phoneNumber) {
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
                time_slot: '16:00-17:30'
            },
            {
                student_name: 'Мария Сидорова',
                parent_name: 'Ольга Сидорова',
                phone_number: phoneNumber,
                email: 'maria@example.com',
                branch: 'Чертаново',
                subscription_type: 'Курс акварельной живописи',
                total_classes: 16,
                remaining_classes: 8,
                expiration_date: '2024-11-30',
                teacher_name: 'Сергей Смирнов',
                day_of_week: 'среда',
                time_slot: '16:30-18:00'
            }
        ];
    }
}

// Создаем экземпляр сервиса amoCRM
const amoCrmService = new AmoCrmService();

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных школы рисования...');
        
        // Создаем директорию для базы данных если её нет
        const dbDir = path.join(__dirname, 'data');
        try {
            await fs.mkdir(dbDir, { recursive: true });
        } catch (mkdirError) {
            // Игнорируем ошибку если директория уже существует
        }
        
        const dbPath = path.join(dbDir, 'art_school.db');
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        
        await createTables();
        await createDemoData();
        
        console.log('🎉 База данных успешно инициализирована!');
        
        // Инициализируем amoCRM
        await amoCrmService.initialize();
        
        // Синхронизируем данные
        await amoCrmService.syncAllData();
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        
        try {
            console.log('🔄 Пробуем создать временную базу данных в памяти...');
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            console.log('✅ Создана временная база данных в памяти');
            await db.run('PRAGMA foreign_keys = ON');
            await createTables();
            await createDemoData();
            console.log('⚠️ ВНИМАНИЕ: Используется база данных в памяти. Данные не сохранятся после перезапуска!');
            
            return db;
        } catch (memoryError) {
            console.error('❌ Не удалось создать даже базу в памяти:', memoryError.message);
            throw error;
        }
    }
};

const createTables = async () => {
    try {
        console.log('📊 Создание таблиц...');
        
        // Токены amoCRM
        await db.exec(`
            CREATE TABLE IF NOT EXISTS amocrm_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Пользователи Telegram
        await db.exec(`
            CREATE TABLE IF NOT EXISTS telegram_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE NOT NULL,
                phone_number TEXT NOT NULL,
                first_name TEXT,
                last_name TEXT,
                username TEXT,
                avatar_url TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Профили учеников
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_user_id INTEGER,
                amocrm_contact_id INTEGER UNIQUE,
                student_name TEXT NOT NULL,
                parent_name TEXT,
                phone_number TEXT NOT NULL,
                email TEXT,
                branch TEXT NOT NULL CHECK(branch IN ('Свиблово', 'Чертаново', 'Не указан')),
                subscription_type TEXT,
                total_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                expiration_date DATE,
                teacher_name TEXT,
                day_of_week TEXT,
                time_slot TEXT,
                amocrm_lead_id INTEGER,
                amocrm_custom_fields TEXT,
                is_active INTEGER DEFAULT 1,
                last_selected INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(id) ON DELETE CASCADE
            )
        `);

        // Расписание занятий
        await db.exec(`
            CREATE TABLE IF NOT EXISTS schedule (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                branch TEXT NOT NULL,
                day_of_week TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                teacher_id INTEGER,
                teacher_name TEXT,
                group_name TEXT,
                room_number TEXT,
                max_students INTEGER DEFAULT 10,
                current_students INTEGER DEFAULT 0,
                status TEXT DEFAULT 'normal' CHECK(status IN ('normal', 'cancelled', 'changed', 'rescheduled')),
                status_note TEXT,
                cancellation_reason TEXT,
                replacement_teacher_id INTEGER,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Преподаватели
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
                telegram_username TEXT,
                phone_number TEXT,
                email TEXT,
                amocrm_user_id INTEGER UNIQUE,
                is_active INTEGER DEFAULT 1,
                display_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // История посещений
        await db.exec(`
            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_profile_id INTEGER NOT NULL,
                schedule_id INTEGER,
                attendance_date DATE NOT NULL,
                attendance_time TIME,
                status TEXT DEFAULT 'attended' CHECK(status IN ('attended', 'missed', 'cancelled')),
                notes TEXT,
                amocrm_task_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                FOREIGN KEY (schedule_id) REFERENCES schedule(id) ON DELETE SET NULL
            )
        `);

        // Частые вопросы (FAQ)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS faq (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                display_order INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Новости школы
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

        // Администраторы
        await db.exec(`
            CREATE TABLE IF NOT EXISTS administrators (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE,
                name TEXT NOT NULL,
                email TEXT,
                phone_number TEXT,
                branches TEXT,
                role TEXT DEFAULT 'admin' CHECK(role IN ('admin', 'superadmin')),
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Рассылки
        await db.exec(`
            CREATE TABLE IF NOT EXISTS broadcasts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id INTEGER NOT NULL,
                broadcast_type TEXT NOT NULL CHECK(broadcast_type IN ('service', 'marketing')),
                message_type TEXT CHECK(message_type IN ('cancellation', 'replacement', 'reschedule', 'custom')),
                title TEXT,
                message TEXT NOT NULL,
                branches TEXT,
                teacher_ids TEXT,
                days_of_week TEXT,
                filters_applied TEXT,
                recipients_count INTEGER DEFAULT 0,
                sent_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sending', 'sent', 'failed')),
                sent_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_id) REFERENCES administrators(id) ON DELETE CASCADE
            )
        `);

        // Контакты администраторов по филиалам
        await db.exec(`
            CREATE TABLE IF NOT EXISTS branch_contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                branch TEXT UNIQUE NOT NULL,
                telegram_username TEXT,
                telegram_chat_id TEXT,
                phone_number TEXT,
                email TEXT,
                address TEXT,
                working_hours TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Сессии пользователей
        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_user_id INTEGER NOT NULL,
                session_id TEXT UNIQUE NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                is_active INTEGER DEFAULT 1,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(id) ON DELETE CASCADE
            )
        `);

        // Логи синхронизации
        await db.exec(`
            CREATE TABLE IF NOT EXISTS amocrm_sync_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_type TEXT NOT NULL,
                records_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'success' CHECK(status IN ('success', 'error', 'partial')),
                error_message TEXT,
                sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Все таблицы созданы');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};

// ==================== ДЕМО ДАННЫЕ ====================
const createDemoData = async () => {
    try {
        console.log('📝 Создание демо-данных...');

        // Демо администраторы
        const adminExists = await db.get("SELECT 1 FROM administrators LIMIT 1");
        if (!adminExists) {
            await db.run(
                `INSERT INTO administrators (telegram_id, name, email, phone_number, branches, role) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [123456789, 'Администратор Свиблово', 'admin1@artschool.ru', '+79991112233', '["Свиблово"]', 'admin']
            );
            
            await db.run(
                `INSERT INTO administrators (telegram_id, name, email, phone_number, branches, role) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [987654321, 'Администратор Чертаново', 'admin2@artschool.ru', '+79994445566', '["Чертаново"]', 'admin']
            );
            
            console.log('✅ Демо-администраторы созданы');
        }

        // Демо расписание
        const scheduleExists = await db.get("SELECT 1 FROM schedule LIMIT 1");
        if (!scheduleExists) {
            const schedule = [
                ['Свиблово', 'понедельник', '16:00', '17:30', 1, 'Анна Петрова', 'Дети 7-9 лет', 'Кабинет 1', 8, 6],
                ['Свиблово', 'понедельник', '18:00', '19:30', 1, 'Анна Петрова', 'Подростки 10-12 лет', 'Кабинет 1', 8, 5],
                ['Свиблово', 'вторник', '17:00', '18:30', 3, 'Елена Ковалева', 'Дети 5-7 лет', 'Кабинет 2', 6, 4],
                ['Чертаново', 'среда', '16:30', '18:00', 2, 'Сергей Смирнов', 'Взрослые', 'Кабинет 3', 10, 8],
                ['Чертаново', 'суббота', '11:00', '12:30', 2, 'Сергей Смирнов', 'Подростки', 'Кабинет 3', 8, 7],
                ['Чертаново', 'суббота', '13:00', '14:30', 3, 'Елена Ковалеva', 'Дети 7-9 лет', 'Кабинет 4', 8, 6]
            ];
            
            for (const item of schedule) {
                await db.run(
                    `INSERT INTO schedule (branch, day_of_week, start_time, end_time, 
                     teacher_id, teacher_name, group_name, room_number, max_students, current_students) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    item
                );
            }
            console.log('✅ Демо-расписание создано');
        }

        // Демо FAQ
        const faqExists = await db.get("SELECT 1 FROM faq LIMIT 1");
        if (!faqExists) {
            const faq = [
                ['Как продлить абонемент?', 
                 'Для продления абонемента свяжитесь с администратором вашего филиала через кнопку "Связаться с администратором" в разделе "Абонемент".', 
                 'subscription', 1],
                 
                ['Что делать, если нужно пропустить занятие?', 
                 'Если вы пропускаете занятие по уважительной причине, сообщите об этом администратору за 24 часа. В некоторых случаях возможно перенести занятие.', 
                 'attendance', 2],
                 
                ['Какие материалы нужны для занятий?', 
                 'Основные материалы (бумага, краски, карандаши) предоставляются школой. Для некоторых специализированных занятий могут потребоваться дополнительные материалы, о чем преподаватель сообщит заранее.', 
                 'materials', 3],
                 
                ['Можно ли посещать занятия в другом филиале?', 
                 'Да, по предварительному согласованию с администраторами обеих филиалов возможно разовое посещение занятий в другом филиале.', 
                 'branches', 4],
                 
                ['Что входит в стоимость абонемента?', 
                 'В стоимость абонемента входят занятия с преподавателем, основные материалы, пользование оборудованием школы. Дополнительные материалы и участие в выставках оплачиваются отдельно.', 
                 'subscription', 5]
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

        // Демо новости
        const newsExists = await db.get("SELECT 1 FROM news LIMIT 1");
        if (!newsExists) {
            const news = [
                ['Новая выставка работ учеников', 
                 'С 15 по 30 марта в холле школы будет проходить выставка работ наших учеников. Вы сможете увидеть прогресс детей за прошедший год и познакомиться с различными техниками рисования.',
                 'Приглашаем на выставку лучших работ наших учеников',
                 'https://via.placeholder.com/600x300/4A90E2/FFFFFF?text=Выставка+работ', null],
                 
                ['Мастер-класс по акварели', 
                 '15 апреля в 18:00 состоится бесплатный мастер-класс по акварельной живописи для взрослых. Все материалы предоставляются. Количество мест ограничено, необходима предварительная регистрация.',
                 'Бесплатный мастер-класс для всех желающих',
                 'https://via.placeholder.com/600x300/9C6ADE/FFFFFF?text=Мастер-класс', 'Свиблово'],
                 
                ['Летний интенсив по рисованию', 
                 'С 1 июня стартуют летние интенсивные курсы для детей и взрослых. За месяц вы освоите основы рисунка и живописи. Группы формируются по возрасту и уровню подготовки.',
                 'Запись на летние интенсивные курсы открыта',
                 'https://via.placeholder.com/600x300/FFC107/FFFFFF?text=Летний+курс', 'Чертаново']
            ];
            
            for (const item of news) {
                await db.run(
                    `INSERT INTO news (title, content, short_description, image_url, branch) 
                     VALUES (?, ?, ?, ?, ?)`,
                    item
                );
            }
            console.log('✅ Демо-новости созданы');
        }

        // Контакты филиалов
        const contactsExist = await db.get("SELECT 1 FROM branch_contacts LIMIT 1");
        if (!contactsExist) {
            await db.run(
                `INSERT INTO branch_contacts (branch, telegram_username, phone_number, email, address, working_hours) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ['Свиблово', '@art_school_sviblovo', '+7 (495) 123-45-67', 'sviblovo@artschool.ru', 
                 'ул. Свибловская, д. 1', 'Пн-Сб 10:00-20:00, Вс 10:00-18:00']
            );
            
            await db.run(
                `INSERT INTO branch_contacts (branch, telegram_username, phone_number, email, address, working_hours) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ['Чертаново', '@art_school_chertanovo', '+7 (495) 765-43-21', 'chertanovo@artschool.ru', 
                 'ул. Чертановская, д. 2', 'Пн-Сб 10:00-20:00, Вс 10:00-18:00']
            );
            
            console.log('✅ Контакты филиалов созданы');
        }

        console.log('🎉 Демо-данные созданы!');
        
    } catch (error) {
        console.error('⚠️ Ошибка создания демо-данных:', error.message);
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

// Поиск профилей по номеру телефона
async function findProfilesByPhone(phoneNumber) {
    try {
        console.log(`🔍 Поиск ученика по телефону: ${phoneNumber}`);
        
        // Пробуем найти в amoCRM
        const profiles = await amoCrmService.getStudentByPhoneFromAmo(phoneNumber);
        
        if (profiles && profiles.length > 0) {
            console.log(`✅ Найдено ${profiles.length} профилей`);
            return profiles;
        }
        
        // Если не нашли, ищем в локальной базе
        const localProfiles = await db.all(
            `SELECT * FROM student_profiles 
             WHERE phone_number = ? AND is_active = 1`,
            [phoneNumber]
        );
        
        if (localProfiles && localProfiles.length > 0) {
            console.log(`✅ Найдено ${localProfiles.length} профилей в локальной базе`);
            return localProfiles;
        }
        
        // Если ничего не нашли, возвращаем пустой массив
        console.log('⚠️ Профили не найдены');
        return [];
        
    } catch (error) {
        console.error('❌ Ошибка поиска профилей:', error.message);
        return [];
    }
}

// Сохранение профилей в базу
async function saveProfiles(telegramUserId, profiles) {
    const savedProfiles = [];
    
    for (const profile of profiles) {
        try {
            // Проверяем существующий профиль
            const existingProfile = await db.get(
                `SELECT * FROM student_profiles 
                 WHERE phone_number = ? AND student_name = ? AND telegram_user_id = ?`,
                [profile.phone_number, profile.student_name, telegramUserId]
            );
            
            if (!existingProfile) {
                // Создаем новый профиль
                const result = await db.run(
                    `INSERT INTO student_profiles 
                     (telegram_user_id, amocrm_contact_id, student_name, parent_name, phone_number, 
                      email, branch, subscription_type, total_classes, remaining_classes, 
                      expiration_date, teacher_name, day_of_week, time_slot, amocrm_custom_fields) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        telegramUserId,
                        profile.amocrm_contact_id || null,
                        profile.student_name,
                        profile.parent_name || '',
                        profile.phone_number,
                        profile.email || '',
                        profile.branch || 'Не указан',
                        profile.subscription_type || 'Без абонемента',
                        profile.total_classes || 0,
                        profile.remaining_classes || 0,
                        profile.expiration_date || null,
                        profile.teacher_name || '',
                        profile.day_of_week || '',
                        profile.time_slot || '',
                        profile.custom_fields ? JSON.stringify(profile.custom_fields) : null
                    ]
                );
                
                const newProfile = await db.get(
                    'SELECT * FROM student_profiles WHERE id = ?',
                    [result.lastID]
                );
                savedProfiles.push(newProfile);
            } else {
                // Обновляем существующий профиль
                await db.run(
                    `UPDATE student_profiles 
                     SET branch = ?, subscription_type = ?,
                         total_classes = ?, remaining_classes = ?, expiration_date = ?,
                         teacher_name = ?, day_of_week = ?, time_slot = ?,
                         amocrm_contact_id = ?, amocrm_custom_fields = ?,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [
                        profile.branch || existingProfile.branch,
                        profile.subscription_type || existingProfile.subscription_type,
                        profile.total_classes || existingProfile.total_classes,
                        profile.remaining_classes || existingProfile.remaining_classes,
                        profile.expiration_date || existingProfile.expiration_date,
                        profile.teacher_name || existingProfile.teacher_name,
                        profile.day_of_week || existingProfile.day_of_week,
                        profile.time_slot || existingProfile.time_slot,
                        profile.amocrm_contact_id || existingProfile.amocrm_contact_id,
                        profile.custom_fields ? JSON.stringify(profile.custom_fields) : existingProfile.amocrm_custom_fields,
                        existingProfile.id
                    ]
                );
                
                savedProfiles.push({
                    ...existingProfile,
                    ...profile
                });
            }
        } catch (error) {
            console.error('❌ Ошибка сохранения профиля:', error.message);
        }
    }
    
    return savedProfiles;
}

// ==================== TELEGRAM БОТ КОМАНДЫ ====================

const WEB_APP_URL = DOMAIN.replace('https://', '').replace('http://', '');

bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const firstName = ctx.from.first_name || '';
    const lastName = ctx.from.last_name || '';
    const username = ctx.from.username || '';
    
    try {
        // Сохраняем пользователя
        const existingUser = await db.get(
            'SELECT * FROM telegram_users WHERE telegram_id = ?',
            [telegramId]
        );
        
        if (!existingUser) {
            await db.run(
                `INSERT INTO telegram_users (telegram_id, first_name, last_name, username) 
                 VALUES (?, ?, ?, ?)`,
                [telegramId, firstName, lastName, username]
            );
        } else {
            await db.run(
                `UPDATE telegram_users 
                 SET first_name = ?, last_name = ?, username = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE telegram_id = ?`,
                [firstName, lastName, username, telegramId]
            );
        }
    } catch (error) {
        console.error('Ошибка сохранения пользователя:', error);
    }
    
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

bot.command('help', async (ctx) => {
    await ctx.replyWithHTML(
        `🎨 <b>Помощь по боту художественной студии</b>\n\n` +
        `<b>Основные команды:</b>\n` +
        `/start - Начать работу с ботом\n` +
        `/app - Открыть веб-приложение\n` +
        `/help - Эта справка\n\n` +
        `<b>Как использовать:</b>\n` +
        `1. Нажмите /start для начала работы\n` +
        `2. Нажмите кнопку "Открыть приложение"\n` +
        `3. В приложении авторизуйтесь через Telegram\n` +
        `4. Используйте все функции личного кабинета\n\n` +
        `<b>Техническая поддержка:</b>\n` +
        `Если у вас возникли проблемы, напишите администратору в приложении`
    );
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    
    if (text.startsWith('/')) {
        return;
    }
    
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

// ==================== RATE LIMITING ====================
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Слишком много запросов с вашего IP, пожалуйста, попробуйте позже'
});
app.use('/api/', limiter);

// Webhook для Telegram
app.post('/webhook', (req, res) => {
    bot.handleUpdate(req.body, res);
});

// ==================== API ДЛЯ РАБОТЫ С AMOCRM ====================

// Статус amoCRM
app.get('/api/amocrm/status', async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                is_initialized: amoCrmService.isInitialized,
                domain: AMOCRM_DOMAIN,
                client_id: !!AMOCRM_CLIENT_ID,
                access_token: !!AMOCRM_ACCESS_TOKEN,
                using_demo_data: !amoCrmService.isInitialized
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статуса amoCRM'
        });
    }
});

// Тестовый эндпоинт для проверки amoCRM
app.get('/api/test-amocrm', async (req, res) => {
    try {
        const testResult = {
            is_initialized: amoCrmService.isInitialized,
            domain: AMOCRM_DOMAIN,
            using_demo_data: !amoCrmService.isInitialized
        };
        
        if (amoCrmService.isInitialized) {
            try {
                const accountInfo = await amoCrmService.makeRequest('GET', '/api/v4/account');
                testResult.connection_success = true;
                testResult.account_id = accountInfo.id;
                testResult.account_name = accountInfo.name;
            } catch (apiError) {
                testResult.connection_success = false;
                testResult.api_error = apiError.message;
            }
        }
        
        res.json({
            success: true,
            message: 'Тест соединения с amoCRM',
            data: testResult
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка тестирования amoCRM'
        });
    }
});

// Синхронизация данных
app.post('/api/amocrm/sync', async (req, res) => {
    try {
        const { sync_type } = req.body;
        
        let result;
        
        switch (sync_type) {
            case 'teachers':
                await amoCrmService.syncTeachersFromAmo();
                break;
            case 'students':
                await amoCrmService.syncStudentsFromAmo();
                break;
            case 'subscriptions':
                await amoCrmService.syncSubscriptionsFromAmo();
                break;
            case 'all':
            default:
                result = await amoCrmService.syncAllData();
                break;
        }
        
        res.json({
            success: true,
            message: `Синхронизация ${sync_type || 'all'} завершена`,
            using_demo_data: !amoCrmService.isInitialized
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка синхронизации с amoCRM',
            using_demo_data: !amoCrmService.isInitialized
        });
    }
});

// ==================== ОСНОВНОЙ API ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        using_demo_data: !amoCrmService.isInitialized
    });
});

// Авторизация через Telegram
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { telegram_id, first_name, last_name, username, phone } = req.body;
        
        if (!telegram_id || !phone) {
            return res.status(400).json({
                success: false,
                error: 'Необходимы telegram_id и номер телефона'
            });
        }
        
        // Проверяем существующего пользователя
        let telegramUser = await db.get(
            'SELECT * FROM telegram_users WHERE telegram_id = ? OR phone_number = ?',
            [telegram_id, phone]
        );
        
        if (!telegramUser) {
            // Создаем нового пользователя
            const result = await db.run(
                `INSERT INTO telegram_users (telegram_id, phone_number, first_name, last_name, username) 
                 VALUES (?, ?, ?, ?, ?)`,
                [telegram_id, phone, first_name || '', last_name || '', username || '']
            );
            
            telegramUser = await db.get(
                'SELECT * FROM telegram_users WHERE id = ?',
                [result.lastID]
            );
        } else {
            // Обновляем существующего пользователя
            await db.run(
                `UPDATE telegram_users 
                 SET phone_number = ?, first_name = ?, last_name = ?, username = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [phone, first_name || '', last_name || '', username || '', telegramUser.id]
            );
        }
        
        // Ищем профили по телефону
        const profiles = await findProfilesByPhone(phone);
        const savedProfiles = await saveProfiles(telegramUser.id, profiles);
        
        // Если есть профили, устанавливаем первый как выбранный
        if (savedProfiles.length > 0) {
            await db.run(
                'UPDATE student_profiles SET last_selected = 0 WHERE telegram_user_id = ?',
                [telegramUser.id]
            );
            
            await db.run(
                'UPDATE student_profiles SET last_selected = 1 WHERE id = ?',
                [savedProfiles[0].id]
            );
        }
        
        // Создаем JWT токен
        const token = jwt.sign(
            {
                id: telegramUser.id,
                telegram_id: telegramUser.telegram_id,
                phone: telegramUser.phone_number
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: profiles.length > 0 ? 'Авторизация успешна' : 'Профили не найдены',
            data: {
                user: telegramUser,
                profiles: savedProfiles,
                total_profiles: savedProfiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                using_demo_data: !amoCrmService.isInitialized,
                token: token
            }
        });
        
    } catch (error) {
        console.error('Ошибка авторизации:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка авторизации'
        });
    }
});

// Расписание
app.post('/api/schedule', async (req, res) => {
    try {
        const { branch, week_start } = req.body;
        
        if (!branch) {
            return res.status(400).json({
                success: false,
                error: 'Укажите филиал'
            });
        }
        
        const schedule = await db.all(
            `SELECT * FROM schedule 
             WHERE branch = ? AND is_active = 1
             ORDER BY 
                 CASE day_of_week 
                     WHEN 'понедельник' THEN 1
                     WHEN 'вторник' THEN 2
                     WHEN 'среда' THEN 3
                     WHEN 'четверг' THEN 4
                     WHEN 'пятница' THEN 5
                     WHEN 'суббота' THEN 6
                     WHEN 'воскресенье' THEN 7
                     ELSE 8
                 END, start_time`,
            [branch]
        );
        
        res.json({
            success: true,
            data: {
                schedule: schedule,
                branch: branch
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения расписания'
        });
    }
});

// Абонемент
app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id } = req.body;
        
        if (!profile_id) {
            return res.status(400).json({
                success: false,
                error: 'Укажите ID профиля'
            });
        }
        
        const profile = await db.get(
            `SELECT * FROM student_profiles WHERE id = ?`,
            [profile_id]
        );
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        // История посещений
        const visits = await db.all(
            `SELECT * FROM attendance 
             WHERE student_profile_id = ?
             ORDER BY attendance_date DESC
             LIMIT 20`,
            [profile.id]
        );
        
        res.json({
            success: true,
            data: {
                subscription: profile,
                visits: visits,
                amocrm_connected: amoCrmService.isInitialized
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
        });
    }
});

// Преподаватели
app.get('/api/teachers', async (req, res) => {
    try {
        const { branch } = req.query;
        
        let teachers;
        if (branch) {
            teachers = await db.all(
                `SELECT * FROM teachers 
                 WHERE is_active = 1 
                   AND (branches LIKE ? OR branches LIKE '%"all"%' OR branches IS NULL)
                 ORDER BY display_order, name`,
                [`%${branch}%`]
            );
        } else {
            teachers = await db.all(
                `SELECT * FROM teachers 
                 WHERE is_active = 1
                 ORDER BY display_order, name`
            );
        }
        
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

// FAQ
app.get('/api/faq', async (req, res) => {
    try {
        const faq = await db.all(
            `SELECT * FROM faq 
             WHERE is_active = 1
             ORDER BY display_order, category`
        );
        
        res.json({
            success: true,
            data: {
                faq: faq
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения FAQ'
        });
    }
});

// Новости
app.get('/api/news', async (req, res) => {
    try {
        const { branch } = req.query;
        
        let query = `SELECT * FROM news WHERE is_active = 1`;
        let params = [];
        
        if (branch) {
            query += ` AND (branch = ? OR branch IS NULL)`;
            params.push(branch);
        }
        
        query += ` ORDER BY publish_date DESC, created_at DESC`;
        
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

// Админ авторизация
app.post('/api/admin/auth', async (req, res) => {
    try {
        const { telegram_id } = req.body;
        
        if (!telegram_id) {
            return res.status(400).json({
                success: false,
                error: 'Необходим telegram_id'
            });
        }
        
        const admin = await db.get(
            'SELECT * FROM administrators WHERE telegram_id = ?',
            [telegram_id]
        );
        
        if (!admin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        const token = jwt.sign(
            {
                id: admin.id,
                telegram_id: admin.telegram_id,
                role: admin.role
            },
            JWT_SECRET,
            { expiresIn: '1d' }
        );
        
        res.json({
            success: true,
            data: {
                admin: admin,
                token: token
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка авторизации'
        });
    }
});

// Статистика (админ)
app.get('/api/admin/stats', async (req, res) => {
    try {
        const { token } = req.query;
        
        if (!token) {
            return res.status(400).json({
                success: false,
                error: 'Необходим токен'
            });
        }
        
        // Проверяем токен
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            
            const admin = await db.get(
                'SELECT * FROM administrators WHERE id = ?',
                [decoded.id]
            );
            
            if (!admin) {
                return res.status(403).json({
                    success: false,
                    error: 'Доступ запрещен'
                });
            }
            
            // Статистика
            const totalStudents = await db.get('SELECT COUNT(*) as count FROM student_profiles WHERE is_active = 1');
            const totalTeachers = await db.get('SELECT COUNT(*) as count FROM teachers WHERE is_active = 1');
            const todayAttendance = await db.get(`
                SELECT COUNT(*) as count FROM attendance 
                WHERE DATE(attendance_date) = DATE('now')
            `);
            const activeSubscriptions = await db.get(`
                SELECT COUNT(*) as count FROM student_profiles 
                WHERE remaining_classes > 0 AND expiration_date >= DATE('now')
            `);
            
            // Статистика по филиалам
            const branchesStats = await db.all(`
                SELECT branch, COUNT(*) as students_count 
                FROM student_profiles 
                WHERE is_active = 1 
                GROUP BY branch
            `);
            
            res.json({
                success: true,
                data: {
                    total_students: totalStudents.count,
                    total_teachers: totalTeachers.count,
                    today_attendance: todayAttendance.count,
                    active_subscriptions: activeSubscriptions.count,
                    branches: branchesStats,
                    amocrm_connected: amoCrmService.isInitialized
                }
            });
            
        } catch (jwtError) {
            return res.status(401).json({
                success: false,
                error: 'Неверный токен'
            });
        }
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// ==================== OAuth callback ====================
app.get('/oauth/callback', async (req, res) => {
    try {
        const { code } = req.query;
        
        if (!code) {
            return res.status(400).send('Не передан код авторизации');
        }
        
        console.log('🔄 Получен код авторизации amoCRM');
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Авторизация amoCRM</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .container { max-width: 500px; margin: 0 auto; }
                    .success { color: #4CAF50; font-size: 24px; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="success">✅ Код авторизации получен</div>
                    <p>Код авторизации: <code>${code.substring(0, 50)}...</code></p>
                    <p>Сохраните этот код в файле .env как AMOCRM_AUTH_CODE</p>
                    <p><a href="/admin">Перейти в админ-панель</a></p>
                </div>
            </body>
            </html>
        `);
        
    } catch (error) {
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Ошибка</title>
            </head>
            <body>
                <div style="color: #f44336; font-size: 24px; margin-bottom: 20px;">❌ Ошибка</div>
                <p>${error.message}</p>
            </body>
            </html>
        `);
    }
});

// Статические файлы
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// 404 обработчик
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Маршрут не найден'
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Пробуем запустить бота
        try {
            const botInfo = await bot.telegram.getMe();
            console.log(`🤖 Telegram бот: @${botInfo.username}`);
            
            bot.launch().then(() => {
                console.log('✅ Telegram бот запущен в режиме polling');
            }).catch(botError => {
                if (botError.response?.error_code === 409) {
                    console.log('⚠️  Другой экземпляр бота уже запущен. Используем только API.');
                } else {
                    console.error('❌ Ошибка запуска бота:', botError.message);
                }
            });
        } catch (botError) {
            console.log('🤖 Telegram бот: Информация недоступна');
            console.log('⚠️  Проверьте токен бота или интернет соединение');
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}!`);
            console.log(`🌐 Доступ по адресу: http://localhost:${PORT}`);
            console.log('='.repeat(80));
            console.log('🔧 КОНФИГУРАЦИЯ:');
            console.log('='.repeat(50));
            console.log(`Бот токен: ${TELEGRAM_BOT_TOKEN ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log(`Домен: ${DOMAIN}`);
            console.log(`amoCRM домен: ${AMOCRM_DOMAIN || '❌ Не установлен'}`);
            console.log(`amoCRM client_id: ${AMOCRM_CLIENT_ID ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log(`amoCRM access_token: ${AMOCRM_ACCESS_TOKEN ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log(`amoCRM инициализирован: ${amoCrmService.isInitialized ? '✅ Да' : '❌ Нет'}`);
            console.log(`Используются демо-данные: ${!amoCrmService.isInitialized ? '✅ Да' : '❌ Нет'}`);
            console.log('='.repeat(50));
            
            console.log('\n🎯 ОСНОВНЫЕ ФУНКЦИОНАЛЬНОСТИ:');
            console.log('='.repeat(60));
            console.log('✅ Telegram бот с веб-приложением');
            console.log('✅ Интеграция с amoCRM (демо/реальные данные)');
            console.log('✅ Синхронизация учеников, преподавателей и абонементов');
            console.log('✅ Расписание занятий');
            console.log('✅ Управление абонементами');
            console.log('✅ Админ-панель');
            console.log('✅ Статистика и аналитика');
            console.log('='.repeat(60));
            
            console.log('\n📱 КАК ИСПОЛЬЗОВАТЬ:');
            console.log('='.repeat(60));
            console.log('1. Откройте Telegram бота');
            console.log('2. Нажмите /start и поделитесь номером телефона');
            console.log('3. Перейдите в веб-приложение');
            console.log('4. Для админ-панели: http://localhost:3000/admin');
            console.log('5. Проверить статус amoCRM: http://localhost:3000/api/test-amocrm');
            console.log('='.repeat(60));
            
            // Запускаем периодическую синхронизацию
            setInterval(async () => {
                try {
                    console.log('🔄 Автоматическая синхронизация данных...');
                    await amoCrmService.syncAllData();
                } catch (syncError) {
                    console.error('❌ Ошибка автоматической синхронизации:', syncError.message);
                }
            }, 30 * 60 * 1000); // Каждые 30 минут
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Обработка завершения работы
process.on('SIGINT', async () => {
    console.log('\n🔄 Остановка сервера...');
    if (db) {
        await db.close();
        console.log('✅ База данных закрыта');
    }
    bot.stop('SIGINT');
    console.log('✅ Telegram бот остановлен');
    process.exit(0);
});

// Запуск
startServer();
