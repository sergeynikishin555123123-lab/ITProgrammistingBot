// server.js - исправленная версия с правильной работой с файловой системой
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
const crypto = require('crypto');

const app = express();

// ==================== КОНФИГУРАЦИЯ ====================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8425388642:AAFpXOa7lYdGYmimJvxyDg2PXyLjlxYrSq4';
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

class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 СОЗДАНИЕ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.clientId = AMOCRM_CLIENT_ID;
        this.clientSecret = AMOCRM_CLIENT_SECRET;
        this.redirectUri = AMOCRM_REDIRECT_URI;
        this.isInitialized = false;
        
        // Карта полей, специфичных для вашей школы
        this.fieldPatterns = {
            'subscription_fields': [
                'Абонемент занятий',
                'Количество занятий',
                'Остаток занятий',
                'Счетчик занятий',
                'Дата активации абонемента',
                'Окончание абонемента',
                'Дата последнего визита',
                'Активный абонемент',
                'Тип абонемента'
            ]
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
                timeout: 10000
            });
            
            this.accountInfo = response.data;
            console.log('✅ Токен валиден!');
            return true;
        } catch (error) {
            console.error('❌ Ошибка проверки токена:', error.message);
            return false;
        }
    }

    async makeRequest(method, endpoint, data = null) {
        const url = `${this.baseUrl}${endpoint}`;
        console.log(`🌐 API: ${method} ${endpoint}`);
        
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
            console.error(`❌ Ошибка запроса: ${error.message}`);
            throw error;
        }
    }

    async searchContactsByPhone(phoneNumber) {
        console.log(`\n🔍 ПОИСК КОНТАКТОВ: ${phoneNumber}`);
        
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
            
            console.log(`🔍 Поиск: ${searchPhone}`);
            
            // Ищем контакт с полными данными
            const response = await this.makeRequest(
                'GET', 
                `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=custom_fields_values`
            );
            
            return response;
        } catch (error) {
            console.error(`❌ Ошибка поиска: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    async getContactDetails(contactId) {
        console.log(`\n🔍 ДЕТАЛИ КОНТАКТА ${contactId}`);
        
        try {
            // Получаем контакт с кастомными полями
            const contact = await this.makeRequest(
                'GET', 
                `/api/v4/contacts/${contactId}?with=custom_fields_values`
            );
            
            // Получаем все сделки контакта
            const leads = await this.getContactLeads(contactId);
            
            // Получаем все покупатели контакта
            const customers = await this.getContactCustomers(contactId);
            
            return {
                contact,
                leads,
                customers
            };
            
        } catch (error) {
            console.error(`❌ Ошибка получения деталей: ${error.message}`);
            throw error;
        }
    }

    async getContactLeads(contactId) {
        try {
            // Получаем все сделки контакта
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}`
            );
            
            console.log(`📊 Сделок: ${response._embedded?.leads?.length || 0}`);
            return response._embedded?.leads || [];
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    async getContactCustomers(contactId) {
        try {
            // Получаем всех покупателей контакта
            const response = await this.makeRequest(
                'GET',
                `/api/v4/customers?with=custom_fields_values&filter[contact_id]=${contactId}`
            );
            
            console.log(`📊 Покупателей: ${response._embedded?.customers?.length || 0}`);
            return response._embedded?.customers || [];
            
        } catch (error) {
            console.error(`❌ Ошибка получения покупателей: ${error.message}`);
            return [];
        }
    }

    // Глубокий поиск поля по всем сущностям
    deepFindFieldValue(fieldNames, entities) {
        if (!entities || !Array.isArray(entities)) {
            return null;
        }
        
        const searchNames = fieldNames.map(name => name.toLowerCase());
        
        for (const entity of entities) {
            const fields = entity.custom_fields_values || [];
            
            for (const field of fields) {
                let fieldName = '';
                
                // Получаем название поля
                if (field.field_name) {
                    fieldName = field.field_name.toLowerCase();
                } else if (field.name) {
                    fieldName = field.name.toLowerCase();
                }
                
                // Проверяем соответствие
                for (const searchName of searchNames) {
                    if (fieldName.includes(searchName)) {
                        if (field.values && field.values.length > 0) {
                            const value = field.values[0];
                            return value.value || value.enum_value || value;
                        }
                    }
                }
            }
        }
        
        return null;
    }

    // Поиск абонемента в контакте и связанных сущностях
    findSubscriptionData(contactData) {
        console.log('\n🔍 ПОИСК ДАННЫХ ОБ АБОНЕМЕНТЕ');
        
        const subscription = {
            hasSubscription: false,
            subscriptionType: '',
            totalClasses: 0,
            remainingClasses: 0,
            usedClasses: 0,
            activationDate: '',
            expirationDate: '',
            lastVisitDate: '',
            branch: '',
            isActive: false
        };
        
        // Все сущности для поиска
        const allEntities = [
            contactData.contact,
            ...contactData.leads,
            ...contactData.customers
        ];
        
        // Пробуем найти поля абонемента
        const subscriptionType = this.deepFindFieldValue(
            ['Абонемент занятий', 'Тип абонемента', 'Абонемент'],
            allEntities
        );
        
        const totalClasses = this.deepFindFieldValue(
            ['Количество занятий', 'Всего занятий', 'Занятий в абонементе'],
            allEntities
        );
        
        const remainingClasses = this.deepFindFieldValue(
            ['Остаток занятий', 'Осталось занятий', 'Доступно занятий'],
            allEntities
        );
        
        const usedClasses = this.deepFindFieldValue(
            ['Счетчик занятий', 'Использовано занятий', 'Пройдено занятий'],
            allEntities
        );
        
        const activationDate = this.deepFindFieldValue(
            ['Дата активации абонемента', 'Активирован'],
            allEntities
        );
        
        const expirationDate = this.deepFindFieldValue(
            ['Окончание абонемента', 'Срок действия до'],
            allEntities
        );
        
        const lastVisitDate = this.deepFindFieldValue(
            ['Дата последнего визита', 'Последнее посещение'],
            allEntities
        );
        
        const activeStatus = this.deepFindFieldValue(
            ['Активный абонемент', 'Статус абонемента'],
            allEntities
        );
        
        const branch = this.deepFindFieldValue(
            ['Филиал', 'Отделение', 'Branch'],
            allEntities
        );
        
        // Если нашли хоть что-то об абонементе
        if (subscriptionType || totalClasses || remainingClasses) {
            subscription.hasSubscription = true;
            subscription.subscriptionType = subscriptionType || 'Абонемент';
            subscription.totalClasses = parseInt(totalClasses) || 0;
            subscription.remainingClasses = parseInt(remainingClasses) || 0;
            subscription.usedClasses = parseInt(usedClasses) || 0;
            subscription.activationDate = activationDate || '';
            subscription.expirationDate = expirationDate || '';
            subscription.lastVisitDate = lastVisitDate || '';
            subscription.branch = branch || '';
            subscription.isActive = activeStatus ? 
                (activeStatus.toString().toLowerCase().includes('актив') || 
                 activeStatus.toString().toLowerCase().includes('да') ||
                 activeStatus === true) : 
                false;
            
            console.log('✅ Данные абонемента найдены:');
            console.log(`   Тип: ${subscription.subscriptionType}`);
            console.log(`   Занятий: ${subscription.totalClasses}`);
            console.log(`   Остаток: ${subscription.remainingClasses}`);
            console.log(`   Использовано: ${subscription.usedClasses}`);
            console.log(`   Активен: ${subscription.isActive}`);
        } else {
            console.log('📭 Данные об абонементе не найдены');
        }
        
        return subscription;
    }

    // Парсим контакт в профиль
    async parseContactToStudentProfile(contactData) {
        console.log(`\n🎯 СОЗДАНИЕ ПРОФИЛЯ УЧЕНИКА`);
        
        const contact = contactData.contact;
        const subscription = this.findSubscriptionData(contactData);
        
        // Ищем основные поля в контакте
        const customFields = contact.custom_fields_values || [];
        
        // Функция поиска поля в контакте
        const findInContact = (fieldNames) => {
            for (const fieldName of fieldNames) {
                const field = customFields.find(f => {
                    const name = f.field_name?.toLowerCase() || f.name?.toLowerCase() || '';
                    return name.includes(fieldName.toLowerCase());
                });
                
                if (field && field.values && field.values.length > 0) {
                    return field.values[0].value || field.values[0].enum_value;
                }
            }
            return null;
        };
        
        // Основные данные
        const studentName = contact.name || 
                          findInContact(['ФИО ребенка', 'Имя ребенка', 'ФИО']) || 
                          'Не указано';
        
        const phoneNumber = findInContact(['Телефон', 'Мобильный телефон', 'Phone']) || '';
        const email = findInContact(['Email', 'Электронная почта']) || '';
        const birthDate = findInContact(['День рождения', 'Дата рождения']) || '';
        const parentName = findInContact(['Имя родителя', 'ФИО родителя']) || '';
        
        // Филиал (из абонемента или из контакта)
        const branch = subscription.branch || 
                      findInContact(['Филиал', 'Отделение', 'Студия']) || 
                      '';
        
        // Расписание
        const dayOfWeek = findInContact(['День недели', 'День занятий']) || '';
        const timeSlot = findInContact(['Время занятия', 'Время']) || '';
        const teacherName = findInContact(['Преподаватель', 'Педагог', 'Учитель']) || '';
        
        // Создаем профиль
        const profile = {
            amocrm_contact_id: contact.id,
            student_name: studentName,
            phone_number: phoneNumber,
            email: email,
            birth_date: birthDate,
            branch: branch,
            parent_name: parentName,
            day_of_week: dayOfWeek,
            time_slot: timeSlot,
            teacher_name: teacherName,
            
            // Данные абонемента
            subscription_type: subscription.subscriptionType || 'Без абонемента',
            subscription_active: subscription.isActive ? 1 : 0,
            total_classes: subscription.totalClasses,
            remaining_classes: subscription.remainingClasses,
            used_classes: subscription.usedClasses || (subscription.totalClasses - subscription.remainingClasses),
            expiration_date: subscription.expirationDate,
            activation_date: subscription.activationDate,
            last_visit_date: subscription.lastVisitDate,
            
            // Технические данные
            custom_fields: JSON.stringify(customFields),
            raw_contact_data: JSON.stringify(contactData),
            is_demo: 0,
            source: 'amocrm',
            is_active: 1
        };
        
        // Логируем
        console.log('\n📊 ИЗВЛЕЧЕННЫЕ ДАННЫЕ:');
        console.log('='.repeat(60));
        console.log(`👤 Ученик: ${profile.student_name}`);
        console.log(`📞 Телефон: ${profile.phone_number}`);
        console.log(`🏢 Филиал: ${profile.branch}`);
        console.log(`🎫 Абонемент: ${profile.subscription_type}`);
        console.log(`✅ Активный: ${profile.subscription_active ? 'Да' : 'Нет'}`);
        console.log(`📊 Занятий: ${profile.remaining_classes}/${profile.total_classes}`);
        if (profile.expiration_date) console.log(`📅 Срок действия: ${profile.expiration_date}`);
        if (profile.activation_date) console.log(`📅 Дата активации: ${profile.activation_date}`);
        console.log('='.repeat(60));
        
        return profile;
    }

    async getStudentsByPhone(phoneNumber) {
        const profiles = [];
        
        if (this.isInitialized) {
            try {
                console.log(`\n🔍 Поиск в amoCRM...`);
                const contactsResponse = await this.searchContactsByPhone(phoneNumber);
                const contacts = contactsResponse._embedded?.contacts || [];
                
                console.log(`📊 Найдено контактов: ${contacts.length}`);
                
                for (const contact of contacts) {
                    try {
                        console.log(`\n🔄 Обработка контакта: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
                        
                        const contactDetails = await this.getContactDetails(contact.id);
                        const profile = await this.parseContactToStudentProfile(contactDetails);
                        
                        profiles.push(profile);
                        console.log(`✅ Профиль добавлен`);
                        
                    } catch (contactError) {
                        console.error(`❌ Ошибка обработки контакта: ${contactError.message}`);
                    }
                }
            } catch (crmError) {
                console.error(`❌ Ошибка поиска в amoCRM: ${crmError.message}`);
            }
        }
        
        return profiles;
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
        
        // Определяем путь к БД
        let dbPath;
        
        if (process.env.REPLIT_DB_URL || process.env.REPL_ID) {
            console.log('🌐 Определена среда Replit');
            dbPath = path.join(process.cwd(), 'art_school.db');
        } else {
            const dbDir = path.join(__dirname, 'data');
            try {
                await fs.mkdir(dbDir, { recursive: true });
                console.log('📁 Директория данных создана:', dbDir);
            } catch (mkdirError) {
                console.log('📁 Директория данных уже существует');
            }
            dbPath = path.join(dbDir, 'art_school.db');
        }
        
        console.log(`💾 Путь к базе данных: ${dbPath}`);
        
        // Открываем базу данных
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        
        // Настраиваем базу данных
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        
        console.log('⚙️  Настройки SQLite применены');
        
        // Создаем таблицы
        await createTables();
        
        console.log('\n✅ База данных успешно инициализирована!');
        
        return db;
    } catch (error) {
        console.error('❌ Критическая ошибка инициализации базы данных:', error.message);
        
        // Пробуем альтернативный путь для БД
        try {
            console.log('\n🔄 Попытка альтернативного пути для БД...');
            const tempDbPath = path.join('/tmp', 'art_school.db');
            
            db = await open({
                filename: tempDbPath,
                driver: sqlite3.Database
            });
            
            await db.run('PRAGMA foreign_keys = ON');
            await createTables();
            
            console.log('✅ База данных создана в временной директории');
            return db;
            
        } catch (tempError) {
            console.error('❌ Не удалось создать БД даже во временной директории');
            
            // Создаем БД в памяти
            console.log('\n🔄 Создаем БД в памяти...');
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            await db.run('PRAGMA foreign_keys = ON');
            await createTables();
            
            console.log('⚠️  ВНИМАНИЕ: БД создана в памяти. Данные будут потеряны при перезапуске!');
            return db;
        }
    }
};

const createTables = async () => {
    try {
        console.log('\n📊 СОЗДАНИЕ ТАБЛИЦ БАЗЫ ДАННЫХ');
        
        // Упрощенная таблица профилей учеников (с исправленной структурой)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amocrm_contact_id INTEGER UNIQUE,
                
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
                
                -- Абонемент
                subscription_type TEXT,
                subscription_active INTEGER DEFAULT 0,
                total_classes INTEGER DEFAULT 0,
                used_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                expiration_date TEXT,
                activation_date TEXT,  -- ДОБАВЛЕНО
                last_visit_date TEXT,
                
                -- Дополнительная информация
                parent_name TEXT,
                comment TEXT,
                address TEXT,
                
                -- Статистика
                first_purchase_date TEXT,
                
                -- Технические данные
                custom_fields TEXT,
                raw_contact_data TEXT,
                is_demo INTEGER DEFAULT 0,
                source TEXT DEFAULT 'amocrm',
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица student_profiles создана');

        // Индексы
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_amocrm_id ON student_profiles(amocrm_contact_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(is_active)');
        
        console.log('\n🎉 Все таблицы созданы успешно!');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};
// ==================== ТЕСТОВЫЕ ДАННЫЕ ====================
const createTestData = async () => {
    try {
        console.log('\n📝 СОЗДАНИЕ ТЕСТОВЫХ ДАННЫХ');
        
        // Проверяем наличие данных
        const hasStudents = await db.get("SELECT 1 FROM student_profiles LIMIT 1");
        
        // Создаем тестового ученика только если нет реальных данных из amoCRM
        if (!hasStudents && !amoCrmService.isInitialized) {
            console.log('👤 Создание тестовых учеников (для демо)...');
            
            const student = {
                student_name: 'Иванов Иван',
                phone_number: '+79680175895',
                email: 'ivanov@example.com',
                branch: 'Свиблово',
                subscription_type: 'Активный абонемент',
                subscription_active: 1,
                total_classes: 8,
                remaining_classes: 6,
                used_classes: 2,
                day_of_week: 'понедельник',
                time_slot: '18:00',
                teacher_name: 'Саша М',
                is_demo: 1
            };
            
            await db.run(
                `INSERT OR IGNORE INTO student_profiles 
                 (student_name, phone_number, email, branch, subscription_type, subscription_active,
                  total_classes, remaining_classes, used_classes,
                  day_of_week, time_slot, teacher_name, is_demo, source) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    student.student_name,
                    student.phone_number,
                    student.email,
                    student.branch,
                    student.subscription_type,
                    student.subscription_active,
                    student.total_classes,
                    student.remaining_classes,
                    student.used_classes,
                    student.day_of_week,
                    student.time_slot,
                    student.teacher_name,
                    student.is_demo,
                    'demo'
                ]
            );
            console.log('⚠️  Созданы ТЕСТОВЫЕ данные (используются только при отключенном amoCRM)');
        }
        
        console.log('\n✅ Тестовые данные проверены/созданы');
        
    } catch (error) {
        console.error('⚠️  Ошибка создания тестовых данных:', error.message);
    }
};

// ==================== ОСНОВНОЙ API ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '2.1.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        data_source: amoCrmService.isInitialized ? 'Реальные данные из amoCRM' : 'Локальные данные'
    });
});

// Авторизация по номеру телефона
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
        
        // Очищаем номер телефона
        const cleanPhone = phone.replace(/\D/g, '');
        
        if (cleanPhone.length < 10) {
            return res.status(400).json({
                success: false,
                error: 'Неверный номер телефона (минимум 10 цифр)'
            });
        }
        
        // Форматируем номер
        let formattedPhone;
        if (cleanPhone.length === 10) {
            formattedPhone = '+7' + cleanPhone;
        } else if (cleanPhone.length === 11) {
            if (cleanPhone.startsWith('8')) {
                formattedPhone = '+7' + cleanPhone.slice(1);
            } else if (cleanPhone.startsWith('7')) {
                formattedPhone = '+' + cleanPhone;
            } else {
                formattedPhone = '+7' + cleanPhone.slice(-10);
            }
        } else {
            formattedPhone = '+7' + cleanPhone.slice(-10);
        }
        
        console.log(`📱 Форматированный номер: ${formattedPhone}`);
        console.log(`🔧 Статус amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
        
        // Ищем профили через amoCRM сервис
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        // Создаем временного пользователя
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            first_name: profiles.length > 0 ? profiles[0].student_name?.split(' ')[0] || 'Ученик' : 'Гость',
            is_temp: true
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
                    JSON.stringify({ user: tempUser, profiles }),
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
        
// В функции app.post('/api/auth/phone', async (req, res) => {
// После создания профиля:

// Сохраняем профили в базу данных
if (profiles.length > 0) {
    console.log(`💾 Сохранение профилей в БД...`);
    for (const profile of profiles) {
        try {
            // Проверяем существующий профиль
            const existingProfile = await db.get(
                `SELECT id FROM student_profiles 
                 WHERE phone_number = ? AND student_name = ?`,
                [profile.phone_number, profile.student_name]
            );
            
            if (!existingProfile) {
                // Вставляем новый профиль
                await db.run(
                    `INSERT INTO student_profiles 
                     (amocrm_contact_id, student_name, phone_number, email, birth_date, branch,
                      day_of_week, time_slot, teacher_name,
                      subscription_type, subscription_active, total_classes, used_classes, remaining_classes, 
                      expiration_date, activation_date, last_visit_date,
                      parent_name,
                      custom_fields, raw_contact_data, is_demo, source, is_active) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        profile.amocrm_contact_id || null,
                        profile.student_name,
                        profile.phone_number,
                        profile.email || '',
                        profile.birth_date || '',
                        profile.branch || '',
                        profile.day_of_week || '',
                        profile.time_slot || '',
                        profile.teacher_name || '',
                        profile.subscription_type || 'Без абонемента',
                        profile.subscription_active || 0,
                        profile.total_classes || 0,
                        profile.used_classes || 0,
                        profile.remaining_classes || 0,
                        profile.expiration_date || null,
                        profile.activation_date || null,
                        profile.last_visit_date || null,
                        profile.parent_name || '',
                        profile.custom_fields || '{}',
                        profile.raw_contact_data || '{}',
                        profile.is_demo || 0,
                        profile.source || 'unknown',
                        1
                    ]
                );
                console.log(`✅ Профиль сохранен в БД: ${profile.student_name}`);
            } else {
                // Обновляем существующий профиль
                await db.run(
                    `UPDATE student_profiles SET
                     student_name = ?, phone_number = ?, email = ?, birth_date = ?, branch = ?,
                     day_of_week = ?, time_slot = ?, teacher_name = ?,
                     subscription_type = ?, subscription_active = ?, total_classes = ?, used_classes = ?, remaining_classes = ?,
                     expiration_date = ?, activation_date = ?, last_visit_date = ?,
                     parent_name = ?,
                     custom_fields = ?, raw_contact_data = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [
                        profile.student_name,
                        profile.phone_number,
                        profile.email || '',
                        profile.birth_date || '',
                        profile.branch || '',
                        profile.day_of_week || '',
                        profile.time_slot || '',
                        profile.teacher_name || '',
                        profile.subscription_type || 'Без абонемента',
                        profile.subscription_active || 0,
                        profile.total_classes || 0,
                        profile.used_classes || 0,
                        profile.remaining_classes || 0,
                        profile.expiration_date || null,
                        profile.activation_date || null,
                        profile.last_visit_date || null,
                        profile.parent_name || '',
                        profile.custom_fields || '{}',
                        profile.raw_contact_data || '{}',
                        existingProfile.id
                    ]
                );
                console.log(`✅ Профиль обновлен в БД: ${profile.student_name}`);
            }
        } catch (profileError) {
            console.error(`❌ Ошибка сохранения профиля: ${profileError.message}`);
        }
    }
            console.log(`💾 Сохранено профилей: ${profiles.length}`);
        }
        
        // Формируем ответ
        const responseData = {
            success: true,
            message: profiles.length > 0 ? 'Авторизация успешна' : 'Профили не найдены',
            data: {
                user: tempUser,
                profiles: profiles.map(p => ({
                    id: p.id,
                    student_name: p.student_name,
                    phone_number: p.phone_number,
                    email: p.email,
                    branch: p.branch,
                    day_of_week: p.day_of_week,
                    time_slot: p.time_slot,
                    teacher_name: p.teacher_name,
                    subscription_type: p.subscription_type,
                    subscription_active: p.subscription_active,
                    total_classes: p.total_classes,
                    remaining_classes: p.remaining_classes,
                    expiration_date: p.expiration_date,
                    last_visit_date: p.last_visit_date,
                    is_demo: p.is_demo,
                    amocrm_contact_id: p.amocrm_contact_id
                })),
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
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

// Получение абонемента
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
        } else if (phone) {
            const cleanPhone = phone.replace(/\D/g, '').slice(-10);
            profile = await db.get(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1 
                 ORDER BY updated_at DESC LIMIT 1`,
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
        
        // Получаем историю посещений
        const visits = await db.all(
            `SELECT * FROM attendance 
             WHERE student_profile_id = ? 
             ORDER BY attendance_date DESC 
             LIMIT 10`,
            [profile.id]
        );
        
        res.json({
            success: true,
            data: {
                subscription: {
                    student_name: profile.student_name,
                    phone_number: profile.phone_number,
                    email: profile.email,
                    branch: profile.branch,
                    day_of_week: profile.day_of_week,
                    time_slot: profile.time_slot,
                    teacher_name: profile.teacher_name,
                    subscription_type: profile.subscription_type,
                    subscription_active: profile.subscription_active === 1,
                    total_classes: profile.total_classes,
                    remaining_classes: profile.remaining_classes,
                    expiration_date: profile.expiration_date,
                    last_visit_date: profile.last_visit_date
                },
                visits: visits,
                data_source: profile.source,
                is_real_data: profile.is_demo === 0
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения абонемента:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
        });
    }
});

// Получение расписания
app.post('/api/schedule', async (req, res) => {
    try {
        const { branch, week_start } = req.body;
        
        console.log(`\n📅 ЗАПРОС РАСПИСАНИЯ: ${branch}`);
        
        // Получаем расписание из базы данных
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
            [branch || 'Свиблово']
        );
        
        // Если расписания нет, создаем демо-расписание
        if (schedule.length === 0) {
            console.log('📝 Создание демо-расписания');
            
            const demoSchedule = [
                {
                    day_of_week: 'понедельник',
                    start_time: '16:00',
                    end_time: '17:30',
                    teacher_name: 'Анна Петрова',
                    group_name: 'Основы рисования',
                    room_number: '101'
                },
                {
                    day_of_week: 'вторник',
                    start_time: '17:00',
                    end_time: '18:30',
                    teacher_name: 'Иван Сидоров',
                    group_name: 'Акварельная живопись',
                    room_number: '102'
                },
                {
                    day_of_week: 'среда',
                    start_time: '16:30',
                    end_time: '18:00',
                    teacher_name: 'Мария Иванова',
                    group_name: 'Рисунок карандашом',
                    room_number: '103'
                },
                {
                    day_of_week: 'суббота',
                    start_time: '11:00',
                    end_time: '12:30',
                    teacher_name: 'Саша М',
                    group_name: 'Художественный курс',
                    room_number: '104'
                }
            ];
            
            // Сохраняем демо-расписание в базу
            for (const lesson of demoSchedule) {
                await db.run(
                    `INSERT INTO schedule (branch, day_of_week, start_time, end_time, teacher_name, group_name, room_number, is_active)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        branch || 'Свиблово',
                        lesson.day_of_week,
                        lesson.start_time,
                        lesson.end_time,
                        lesson.teacher_name,
                        lesson.group_name,
                        lesson.room_number,
                        1
                    ]
                );
            }
            
            // Получаем сохраненное расписание
            const savedSchedule = await db.all(
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
                [branch || 'Свибловo']
            );
            
            res.json({
                success: true,
                data: {
                    schedule: savedSchedule,
                    is_demo: true
                }
            });
            
            return;
        }
        
        res.json({
            success: true,
            data: {
                schedule: schedule,
                is_demo: false
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения расписания:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения расписания'
        });
    }
});

// Создание таблицы schedule если не существует
const createScheduleTable = async () => {
    try {
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
                status TEXT DEFAULT 'normal',
                status_note TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица schedule создана');
    } catch (error) {
        console.error('❌ Ошибка создания таблицы schedule:', error.message);
    }
};

// Создание таблицы attendance если не существует
const createAttendanceTable = async () => {
    try {
        await db.exec(`
            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_profile_id INTEGER NOT NULL,
                schedule_id INTEGER,
                attendance_date DATE NOT NULL,
                attendance_time TIME,
                status TEXT DEFAULT 'attended',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица attendance создана');
    } catch (error) {
        console.error('❌ Ошибка создания таблицы attendance:', error.message);
    }
};

// Создание таблицы user_sessions если не существует
const createUserSessionsTable = async () => {
    try {
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
    } catch (error) {
        console.error('❌ Ошибка создания таблицы user_sessions:', error.message);
    }
};

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v2.1');
        console.log('='.repeat(80));
        console.log('✨ УПРОЩЕННЫЙ ПАРСИНГ AMOCRM');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Создаем дополнительные таблицы
        await createScheduleTable();
        await createAttendanceTable();
        await createUserSessionsTable();
        
        // Инициализируем amoCRM
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            console.log(`📊 Аккаунт: ${amoCrmService.accountInfo?.name || 'Не получено'}`);
        } else {
            console.log('⚠️  amoCRM не инициализирован');
            console.log('ℹ️  Используются локальные данные');
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

// Запуск сервера
startServer();
