// server.js - исправленная версия для поиска учеников по телефону родителя
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
        console.log('🔄 СОЗДАНИЕ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.clientId = AMOCRM_CLIENT_ID;
        this.clientSecret = AMOCRM_CLIENT_SECRET;
        this.redirectUri = AMOCRM_REDIRECT_URI;
        this.isInitialized = false;
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
            
            console.log(`🔍 Поиск телефона: ${searchPhone}`);
            
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

    async getContactLeads(contactId) {
        try {
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}`
            );
            
            return response._embedded?.leads || [];
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    async getContactCustomers(contactId) {
        try {
            const response = await this.makeRequest(
                'GET',
                `/api/v4/customers?with=custom_fields_values&filter[contact_id]=${contactId}`
            );
            
            return response._embedded?.customers || [];
        } catch (error) {
            console.error(`❌ Ошибка получения покупателей: ${error.message}`);
            return [];
        }
    }

    findEmail(contact) {
        const customFields = contact.custom_fields_values || [];
        for (const field of customFields) {
            const fieldName = (field.field_name || field.name || '').toLowerCase();
            if (fieldName.includes('email') || fieldName.includes('почта')) {
                const value = field.values?.[0]?.value || field.values?.[0]?.enum_value || '';
                if (value) return value;
            }
        }
        return '';
    }

    // Основной метод для поиска учеников по телефону родителя
    async getStudentsByPhone(phoneNumber) {
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            console.log(`\n🔍 Поиск учеников по телефону родителя: ${phoneNumber}`);
            
            // 1. Ищем контакты (родителей) с этим телефоном
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const parentContacts = contactsResponse._embedded?.contacts || [];
            
            console.log(`📊 Найдено контактов-родителей: ${parentContacts.length}`);
            
            // Для каждого найденного контакта-родителя
            for (const parentContact of parentContacts) {
                console.log(`\n👤 Родитель: ${parentContact.name || 'Без имени'} (ID: ${parentContact.id})`);
                
                try {
                    // 2. Ищем связанные сделки этого контакта
                    const leads = await this.getContactLeads(parentContact.id);
                    console.log(`📊 Связанных сделок: ${leads.length}`);
                    
                    // 3. Ищем связанных покупателей этого контакта
                    const customers = await this.getContactCustomers(parentContact.id);
                    console.log(`📊 Связанных покупателей: ${customers.length}`);
                    
                    // 4. Объединяем все сущности для анализа
                    const allEntities = [parentContact, ...leads, ...customers];
                    
                    // 5. Ищем информацию об учениках в этих сущностях
                    const studentInfos = await this.findStudentInfoInEntities(allEntities);
                    
                    // 6. Создаем профили для каждого найденного ученика
                    for (const studentInfo of studentInfos) {
                        const profile = this.createStudentProfile(
                            parentContact, 
                            phoneNumber, 
                            studentInfo
                        );
                        studentProfiles.push(profile);
                    }
                    
                } catch (contactError) {
                    console.error(`❌ Ошибка обработки контакта: ${contactError.message}`);
                }
            }
            
            console.log(`\n🎯 ИТОГО найдено учеников: ${studentProfiles.length}`);
            
        } catch (crmError) {
            console.error(`❌ Ошибка поиска в amoCRM: ${crmError.message}`);
        }
        
        return studentProfiles;
    }

    // Метод для поиска информации об учениках в сущностях
    async findStudentInfoInEntities(entities) {
        const studentInfos = [];
        
        console.log('\n🔍 Поиск информации об учениках...');
        
        for (const entity of entities) {
            const studentInfo = this.extractStudentInfoFromEntity(entity);
            if (studentInfo.hasStudent) {
                studentInfos.push(studentInfo);
                console.log(`✅ Найден ученик: ${studentInfo.studentName}`);
            }
        }
        
        return studentInfos;
    }

    // Метод для извлечения информации об ученике из сущности
    extractStudentInfoFromEntity(entity) {
        const result = {
            hasStudent: false,
            studentName: '',
            hasSubscription: false,
            subscriptionType: '',
            totalClasses: 0,
            remainingClasses: 0,
            usedClasses: 0,
            expirationDate: '',
            activationDate: '',
            lastVisitDate: '',
            branch: '',
            teacherName: '',
            dayOfWeek: '',
            timeSlot: '',
            birthDate: '',
            subscriptionActive: false
        };
        
        const customFields = entity.custom_fields_values || [];
        
        // Логируем все поля для отладки
        console.log(`🔍 Анализ сущности: ${entity.name || 'Без имени'} (${entity.id})`);
        
        // Ищем имя ученика
        for (const field of customFields) {
            const fieldName = (field.field_name || field.name || '').toLowerCase();
            const fieldValue = field.values?.[0]?.value || field.values?.[0]?.enum_value || '';
            
            // Проверяем различные варианты названий полей для имени ученика
            if (fieldName.includes('ребенк') || 
                fieldName.includes('ученик') || 
                fieldName.includes('фио ребен') ||
                (fieldName.includes('имя') && !fieldName.includes('родител'))) {
                
                if (fieldValue && fieldValue.trim() !== '') {
                    result.studentName = fieldValue;
                    result.hasStudent = true;
                    break;
                }
            }
        }
        
        // Если имя ученика не найдено в кастомных полях, проверяем название сделки/покупателя
        if (!result.hasStudent && entity.name) {
            // Проверяем, не является ли название сущности именем ученика
            if (entity.name.includes(' - ') || entity.name.includes('занят')) {
                result.studentName = entity.name.split(' - ')[0] || entity.name;
                result.hasStudent = true;
            }
        }
        
        // Если нашли ученика, ищем остальную информацию
        if (result.hasStudent) {
            this.extractAdditionalInfo(customFields, result);
        }
        
        return result;
    }

    // Метод для извлечения дополнительной информации
    extractAdditionalInfo(customFields, result) {
        for (const field of customFields) {
            const fieldName = (field.field_name || field.name || '').toLowerCase();
            const fieldValue = field.values?.[0]?.value || field.values?.[0]?.enum_value || '';
            const fieldId = field.field_id;
            
            // Абонемент
            if (fieldName.includes('абонемент занятий') || 
                (fieldName.includes('занятий') && fieldName.includes('абонемент'))) {
                const match = fieldValue.match(/(\d+)/);
                if (match) {
                    result.totalClasses = parseInt(match[1]);
                    result.hasSubscription = true;
                }
            }
            
            // Количество занятий
            if (fieldName.includes('всего занятий') || 
                fieldName.includes('количество занятий')) {
                result.totalClasses = parseInt(fieldValue) || 0;
                result.hasSubscription = true;
            }
            
            // Счетчик занятий
            if (fieldName.includes('счетчик занятий') || 
                fieldName.includes('использовано')) {
                result.usedClasses = parseInt(fieldValue) || 0;
                result.hasSubscription = true;
            }
            
            // Остаток занятий
            if (fieldName.includes('остаток занятий') || 
                fieldName.includes('осталось')) {
                result.remainingClasses = parseInt(fieldValue) || 0;
                result.hasSubscription = true;
            }
            
            // Тип абонемента
            if (fieldName.includes('тип абонемента')) {
                result.subscriptionType = fieldValue;
                result.hasSubscription = true;
            }
            
            // Статус абонемента
            if (fieldName.includes('активный абонемент') || 
                fieldName.includes('статус абонемента')) {
                result.subscriptionActive = fieldValue === 'true' || 
                                          fieldValue === 'активен' ||
                                          fieldValue === 'активный' ||
                                          fieldValue === 'да' ||
                                          fieldValue === '1';
                result.hasSubscription = true;
            }
            
            // Даты
            if (fieldName.includes('дата активации')) {
                result.activationDate = fieldValue;
            }
            
            if (fieldName.includes('окончание') || 
                fieldName.includes('срок действия')) {
                result.expirationDate = fieldValue;
            }
            
            if (fieldName.includes('последний визит') || 
                fieldName.includes('последнее посещение') ||
                fieldName.includes('дата последнего визита')) {
                result.lastVisitDate = fieldValue;
            }
            
            // Филиал
            if (fieldName.includes('филиал') && !result.branch) {
                result.branch = fieldValue;
            }
            
            // Преподаватель
            if (fieldName.includes('преподаватель') && !result.teacherName) {
                result.teacherName = fieldValue;
            }
            
            // День недели
            if (fieldName.includes('день недели') && !result.dayOfWeek) {
                result.dayOfWeek = fieldValue;
            }
            
            // Время
            if (fieldName.includes('время занятия') && !result.timeSlot) {
                result.timeSlot = fieldValue;
            }
            
            // День рождения
            if (fieldName.includes('день рождения') && !result.birthDate) {
                result.birthDate = fieldValue;
            }
        }
        
        // Автоматически определяем тип абонемента если не указан
        if (result.hasSubscription && !result.subscriptionType) {
            if (result.subscriptionActive) {
                result.subscriptionType = 'Активный абонемент';
            } else {
                result.subscriptionType = 'Абонемент';
            }
        }
        
        // Рассчитываем отсутствующие значения
        if (result.totalClasses > 0 && result.usedClasses > 0 && result.remainingClasses === 0) {
            result.remainingClasses = result.totalClasses - result.usedClasses;
        }
        
        if (result.totalClasses > 0 && result.remainingClasses > 0 && result.usedClasses === 0) {
            result.usedClasses = result.totalClasses - result.remainingClasses;
        }
    }

    // Метод для создания профиля ученика
    createStudentProfile(parentContact, phoneNumber, studentInfo) {
        const profile = {
            amocrm_contact_id: parentContact.id,
            parent_contact_id: parentContact.id,
            student_name: studentInfo.studentName,
            phone_number: phoneNumber,
            email: this.findEmail(parentContact),
            birth_date: studentInfo.birthDate || '',
            branch: studentInfo.branch || '',
            parent_name: parentContact.name || '',
            day_of_week: studentInfo.dayOfWeek || '',
            time_slot: studentInfo.timeSlot || '',
            teacher_name: studentInfo.teacherName || '',
            
            // Данные абонемента
            subscription_type: studentInfo.subscriptionType || 'Без абонемента',
            subscription_active: studentInfo.subscriptionActive ? 1 : 0,
            total_classes: studentInfo.totalClasses || 0,
            remaining_classes: studentInfo.remainingClasses || 0,
            used_classes: studentInfo.usedClasses || 0,
            expiration_date: studentInfo.expirationDate || null,
            activation_date: studentInfo.activationDate || null,
            last_visit_date: studentInfo.lastVisitDate || null,
            
            // Технические данные
            custom_fields: JSON.stringify(parentContact.custom_fields_values || []),
            raw_contact_data: JSON.stringify({
                parent_contact: { id: parentContact.id, name: parentContact.name },
                student_name: studentInfo.studentName,
                has_subscription: studentInfo.hasSubscription
            }),
            is_demo: 0,
            source: 'amocrm',
            is_active: 1
        };
        
        console.log(`📊 Создан профиль для: ${profile.student_name}`);
        console.log(`   Абонемент: ${profile.subscription_type}`);
        console.log(`   Занятий: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        
        return profile;
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
        
        // Таблица профилей учеников
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amocrm_contact_id INTEGER,
                parent_contact_id INTEGER,
                
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
                activation_date TEXT,
                last_visit_date TEXT,
                
                -- Информация о родителе
                parent_name TEXT,
                
                -- Дополнительная информация
                comment TEXT,
                address TEXT,
                
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
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_student_name ON student_profiles(student_name)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(is_active)');
        
        // Таблица сессий пользователей
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
        version: '2.2.0',
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
        
        let profiles = [];
        
        if (amoCrmService.isInitialized) {
            // Ищем учеников в amoCRM по телефону родителя
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            console.log(`📊 Найдено профилей в amoCRM: ${profiles.length}`);
            
            // Сохраняем найденные профили в базу данных
            if (profiles.length > 0) {
                await saveProfilesToDatabase(profiles);
            }
        }
        
        // Если не нашли в amoCRM, ищем в локальной базе
        if (profiles.length === 0) {
            console.log('🔍 Поиск в локальной базе данных...');
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            console.log(`📊 Найдено профилей в локальной БД: ${profiles.length}`);
        }
        
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
        
        // Форматируем ответ
        const responseProfiles = profiles.map(p => ({
            id: p.id,
            student_name: p.student_name,
            phone_number: p.phone_number,
            email: p.email,
            branch: p.branch,
            day_of_week: p.day_of_week,
            time_slot: p.time_slot,
            teacher_name: p.teacher_name,
            subscription_type: p.subscription_type,
            subscription_active: p.subscription_active === 1,
            total_classes: p.total_classes,
            remaining_classes: p.remaining_classes,
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            is_demo: p.is_demo === 1
        }));
        
        // Формируем ответ
        const responseData = {
            success: true,
            message: profiles.length > 0 ? 'Авторизация успешна' : 'Профили не найдены',
            data: {
                user: tempUser,
                profiles: responseProfiles,
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

// Функция для сохранения профилей в базу данных
async function saveProfilesToDatabase(profiles) {
    try {
        console.log(`💾 Сохранение профилей в БД...`);
        
        for (const profile of profiles) {
            // Проверяем, существует ли уже такой профиль
            const existingProfile = await db.get(
                `SELECT id FROM student_profiles 
                 WHERE amocrm_contact_id = ? AND student_name = ?`,
                [profile.amocrm_contact_id, profile.student_name]
            );
            
            if (!existingProfile) {
                // Вставляем новый профиль
                await db.run(
                    `INSERT INTO student_profiles 
                     (amocrm_contact_id, parent_contact_id, student_name, phone_number, email, 
                      birth_date, branch, day_of_week, time_slot, teacher_name,
                      subscription_type, subscription_active, total_classes, used_classes, 
                      remaining_classes, expiration_date, activation_date, last_visit_date,
                      parent_name, custom_fields, raw_contact_data, is_demo, source, is_active) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        profile.amocrm_contact_id || null,
                        profile.parent_contact_id || null,
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
                        profile.source || 'amocrm',
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
                     subscription_type = ?, subscription_active = ?, total_classes = ?, 
                     used_classes = ?, remaining_classes = ?,
                     expiration_date = ?, activation_date = ?, last_visit_date = ?,
                     parent_name = ?, custom_fields = ?, raw_contact_data = ?, 
                     updated_at = CURRENT_TIMESTAMP
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
        }
        
        console.log(`💾 Сохранено профилей: ${profiles.length}`);
    } catch (error) {
        console.error(`❌ Ошибка сохранения профилей в БД: ${error.message}`);
    }
}

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
                    activation_date: profile.activation_date,
                    last_visit_date: profile.last_visit_date,
                    parent_name: profile.parent_name
                },
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

// Поиск ученика по телефону (прямой поиск)
app.post('/api/search/student', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`\n🔍 ПРЯМОЙ ПОИСК УЧЕНИКА: ${phone}`);
        
        // Форматируем номер телефона
        const cleanPhone = phone.replace(/\D/g, '');
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
        
        let profiles = [];
        
        // Если подключен amoCRM, ищем там
        if (amoCrmService.isInitialized) {
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            
            // Сохраняем в базу
            if (profiles.length > 0) {
                await saveProfilesToDatabase(profiles);
            }
        }
        
        // Если не нашли в amoCRM, ищем в локальной базе
        if (profiles.length === 0) {
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
        }
        
        res.json({
            success: true,
            data: {
                profiles: profiles.map(p => ({
                    id: p.id,
                    student_name: p.student_name,
                    phone_number: p.phone_number,
                    branch: p.branch,
                    subscription_type: p.subscription_type,
                    subscription_active: p.subscription_active === 1,
                    total_classes: p.total_classes,
                    remaining_classes: p.remaining_classes,
                    expiration_date: p.expiration_date,
                    is_demo: p.is_demo === 1
                })),
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized
            }
        });
        
    } catch (error) {
        console.error('Ошибка поиска ученика:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка поиска ученика'
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v2.2');
        console.log('='.repeat(80));
        console.log('✨ ПОИСК УЧЕНИКОВ ПО ТЕЛЕФОНУ РОДИТЕЛЯ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Создаем тестовые данные
        await createTestData();
        
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
