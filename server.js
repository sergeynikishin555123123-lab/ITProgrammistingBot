// server.js - исправленная версия для поиска учеников по телефону родителя с правильным отображением абонемента
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

// ==================== ПРОСТОЙ КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 СОЗДАНИЕ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
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
            console.error(`❌ Ошибка запроса: ${error.message}`);
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
            // Форматируем телефон для поиска
            let searchPhone;
            if (cleanPhone.length === 11 && cleanPhone.startsWith('7')) {
                searchPhone = `+${cleanPhone}`;
            } else if (cleanPhone.length === 10) {
                searchPhone = `+7${cleanPhone}`;
            } else {
                searchPhone = `+${cleanPhone}`;
            }
            
            console.log(`🔍 Форматированный номер для поиска: ${searchPhone}`);
            
            // Поиск контактов по телефону
            const response = await this.makeRequest(
                'GET', 
                `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=leads,customers,custom_fields_values`
            );
            
            console.log(`📊 Найдено контактов: ${response._embedded?.contacts?.length || 0}`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    // Основной метод для поиска учеников по телефону родителя
    async getStudentsByPhone(phoneNumber) {
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            console.log(`\n🎯 ПОИСК УЧЕНИКОВ ПО ТЕЛЕФОНУ РОДИТЕЛЯ: ${phoneNumber}`);
            
            // 1. Ищем контакты (родителей) с этим телефоном
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const parentContacts = contactsResponse._embedded?.contacts || [];
            
            console.log(`📊 Найдено контактов-родителей: ${parentContacts.length}`);
            
            // Для каждого найденного контакта-родителя
            for (const parentContact of parentContacts) {
                console.log(`\n👤 Родитель: ${parentContact.name || 'Без имени'} (ID: ${parentContact.id})`);
                
                // 2. Получаем информацию о связанных сделках (где может быть информация об ученике)
                const studentInfo = this.extractStudentInfo(parentContact);
                
                if (studentInfo.studentName) {
                    console.log(`✅ Найден ученик: ${studentInfo.studentName}`);
                    
                    // Создаем профиль ученика
                    const profile = this.createStudentProfile(
                        parentContact, 
                        phoneNumber, 
                        studentInfo
                    );
                    
                    studentProfiles.push(profile);
                } else {
                    console.log(`❌ Не найдена информация об ученике для этого контакта`);
                }
            }
            
            console.log(`\n🎯 ИТОГО найдено учеников: ${studentProfiles.length}`);
            
        } catch (crmError) {
            console.error(`❌ Ошибка поиска в amoCRM: ${crmError.message}`);
        }
        
        return studentProfiles;
    }

    // Метод для извлечения информации об ученике из контакта
    extractStudentInfo(parentContact) {
        const result = {
            studentName: '',
            birthDate: '',
            branch: '',
            dayOfWeek: '',
            timeSlot: '',
            teacherName: '',
            
            // Данные абонемента
            subscriptionType: '',
            subscriptionActive: false,
            totalClasses: 0,
            usedClasses: 0,
            remainingClasses: 0,
            expirationDate: '',
            activationDate: '',
            lastVisitDate: ''
        };
        
        const customFields = parentContact.custom_fields_values || [];
        
        console.log(`🔍 Анализ кастомных полей контакта...`);
        
        // 1. Ищем имя ученика
        for (const field of customFields) {
            const fieldName = (field.field_name || field.name || '').toLowerCase();
            const fieldValue = field.values?.[0]?.value || '';
            
            // Варианты названий полей для имени ученика
            if (fieldName.includes('ребенок') || 
                fieldName.includes('ученик') || 
                fieldName.includes('фио ребен') ||
                fieldName.includes('имя ребенка')) {
                
                if (fieldValue && fieldValue.trim() !== '') {
                    result.studentName = fieldValue;
                    console.log(`✅ Найдено имя ученика: ${fieldValue}`);
                    break;
                }
            }
        }
        
        // Если имя не найдено в кастомных полях, проверяем имя контакта
        if (!result.studentName && parentContact.name) {
            result.studentName = parentContact.name;
            console.log(`ℹ️  Используем имя контакта: ${parentContact.name}`);
        }
        
        // 2. Ищем данные об абонементе и занятиях
        if (result.studentName) {
            for (const field of customFields) {
                const fieldName = (field.field_name || field.name || '').toLowerCase();
                const fieldValue = field.values?.[0]?.value || '';
                
                // Общее количество занятий
                if (fieldName.includes('всего занятий') || 
                    fieldName.includes('занятий всего') ||
                    fieldName.includes('количество занятий')) {
                    const numValue = parseInt(fieldValue);
                    if (!isNaN(numValue) && numValue > 0) {
                        result.totalClasses = numValue;
                    }
                }
                
                // Использовано занятий
                if (fieldName.includes('использовано занятий') || 
                    fieldName.includes('пройдено занятий') ||
                    fieldName.includes('посещено занятий')) {
                    const numValue = parseInt(fieldValue);
                    if (!isNaN(numValue) && numValue >= 0) {
                        result.usedClasses = numValue;
                    }
                }
                
                // Осталось занятий
                if (fieldName.includes('осталось занятий') || 
                    fieldName.includes('остаток занятий') ||
                    fieldName.includes('занятий осталось')) {
                    const numValue = parseInt(fieldValue);
                    if (!isNaN(numValue) && numValue >= 0) {
                        result.remainingClasses = numValue;
                    }
                }
                
                // Тип абонемента
                if (fieldName.includes('тип абонемента') || 
                    fieldName.includes('вид абонемента')) {
                    result.subscriptionType = fieldValue;
                }
                
                // Статус абонемента
                if (fieldName.includes('статус абонемента') || 
                    fieldName.includes('активный абонемент')) {
                    const status = fieldValue.toLowerCase();
                    result.subscriptionActive = status.includes('актив') || 
                                              status.includes('да') ||
                                              status === 'true' ||
                                              status === '1';
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
                
                // Время занятия
                if (fieldName.includes('время занятия') && !result.timeSlot) {
                    result.timeSlot = fieldValue;
                }
                
                // День рождения
                if (fieldName.includes('день рождения') && !result.birthDate) {
                    result.birthDate = fieldValue;
                }
                
                // Дата окончания
                if (fieldName.includes('окончание') || 
                    fieldName.includes('срок действия')) {
                    result.expirationDate = fieldValue;
                }
                
                // Дата активации
                if (fieldName.includes('дата активации')) {
                    result.activationDate = fieldValue;
                }
                
                // Последний визит
                if (fieldName.includes('последний визит') || 
                    fieldName.includes('последнее посещение')) {
                    result.lastVisitDate = fieldValue;
                }
            }
            
            // Автоматически определяем оставшиеся занятия если они не указаны
            if (result.totalClasses > 0 && result.usedClasses > 0 && result.remainingClasses === 0) {
                result.remainingClasses = result.totalClasses - result.usedClasses;
                console.log(`ℹ️  Рассчитано оставшихся занятий: ${result.remainingClasses}`);
            }
            
            // Автоматически определяем тип абонемента если не указан
            if (!result.subscriptionType && result.totalClasses > 0) {
                result.subscriptionType = 'Абонемент';
                if (result.subscriptionActive) {
                    result.subscriptionType = 'Активный абонемент';
                }
            }
            
            // Автоматически определяем активность абонемента по остатку занятий
            if (!result.subscriptionActive && result.remainingClasses > 0) {
                result.subscriptionActive = true;
                console.log(`ℹ️  Абонемент определен как активный (есть остаток занятий)`);
            }
            
            console.log(`📊 Результаты анализа:`);
            console.log(`   Всего занятий: ${result.totalClasses}`);
            console.log(`   Использовано: ${result.usedClasses}`);
            console.log(`   Осталось: ${result.remainingClasses}`);
            console.log(`   Тип абонемента: ${result.subscriptionType}`);
            console.log(`   Активный: ${result.subscriptionActive ? 'Да' : 'Нет'}`);
        }
        
        return result;
    }

    // Метод для поиска email в контакте
    findEmail(contact) {
        const customFields = contact.custom_fields_values || [];
        for (const field of customFields) {
            const fieldName = (field.field_name || field.name || '').toLowerCase();
            if (fieldName.includes('email') || fieldName.includes('почта')) {
                const value = field.values?.[0]?.value || '';
                if (value) return value;
            }
        }
        return '';
    }

    // Метод для создания профиля ученика
    createStudentProfile(parentContact, phoneNumber, studentInfo) {
        // Формируем статус абонемента для отображения
        let subscriptionStatus = 'Нет абонемента';
        let subscriptionBadge = 'inactive';
        
        if (studentInfo.totalClasses > 0) {
            if (studentInfo.subscriptionActive && studentInfo.remainingClasses > 0) {
                subscriptionStatus = `Активный (осталось ${studentInfo.remainingClasses}/${studentInfo.totalClasses} занятий)`;
                subscriptionBadge = 'active';
            } else if (studentInfo.remainingClasses === 0 && studentInfo.usedClasses > 0) {
                subscriptionStatus = `Завершен (использовано ${studentInfo.usedClasses}/${studentInfo.totalClasses} занятий)`;
                subscriptionBadge = 'expired';
            } else {
                subscriptionStatus = `${studentInfo.totalClasses} занятий`;
                subscriptionBadge = 'has_subscription';
            }
        }
        
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
            subscription_status: subscriptionStatus,
            subscription_badge: subscriptionBadge,
            total_classes: studentInfo.totalClasses || 0,
            remaining_classes: studentInfo.remainingClasses || 0,
            used_classes: studentInfo.usedClasses || 0,
            expiration_date: studentInfo.expirationDate || null,
            activation_date: studentInfo.activationDate || null,
            last_visit_date: studentInfo.lastVisitDate || null,
            
            // Технические данные
            custom_fields: JSON.stringify(parentContact.custom_fields_values || []),
            raw_contact_data: JSON.stringify(parentContact),
            is_demo: 0,
            source: 'amocrm',
            is_active: 1
        };
        
        console.log(`📊 Создан профиль ученика:`);
        console.log(`   👤 ${profile.student_name}`);
        console.log(`   📍 Филиал: ${profile.branch || 'не указан'}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        
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
        
        // Создаем БД в памяти как запасной вариант
        try {
            console.log('\n🔄 Создаем БД в памяти...');
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            await db.run('PRAGMA foreign_keys = ON');
            await createTables();
            
            console.log('⚠️  ВНИМАНИЕ: БД создана в памяти. Данные будут потеряны при перезапуске!');
            return db;
        } catch (memError) {
            console.error('❌ Не удалось создать БД даже в памяти:', memError.message);
            throw error;
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
                subscription_status TEXT,
                subscription_badge TEXT,
                total_classes INTEGER DEFAULT 0,
                used_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                expiration_date TEXT,
                activation_date TEXT,
                last_visit_date TEXT,
                
                -- Информация о родителе
                parent_name TEXT,
                
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

        // Индексы для быстрого поиска
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_name ON student_profiles(student_name)');
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
        
        // Создаем тестового ученика только если нет данных из amoCRM
        if (!hasStudents && !amoCrmService.isInitialized) {
            console.log('👤 Создание тестовых учеников (для демо)...');
            
            const testStudents = [
                {
                    student_name: 'Иванов Иван',
                    phone_number: '+79680175895',
                    email: 'ivanov@example.com',
                    branch: 'Свиблово',
                    subscription_type: 'Активный абонемент',
                    subscription_active: 1,
                    subscription_status: 'Активный (осталось 6/8 занятий)',
                    subscription_badge: 'active',
                    total_classes: 8,
                    remaining_classes: 6,
                    used_classes: 2,
                    day_of_week: 'понедельник',
                    time_slot: '18:00',
                    teacher_name: 'Саша М',
                    is_demo: 1
                },
                {
                    student_name: 'Петрова Мария',
                    phone_number: '+79680175895',
                    email: 'petrova@example.com',
                    branch: 'Бабушкинская',
                    subscription_type: 'Абонемент',
                    subscription_active: 1,
                    subscription_status: 'Активный (осталось 4/10 занятий)',
                    subscription_badge: 'active',
                    total_classes: 10,
                    remaining_classes: 4,
                    used_classes: 6,
                    day_of_week: 'среда',
                    time_slot: '17:30',
                    teacher_name: 'Анна К',
                    is_demo: 1
                }
            ];
            
            for (const student of testStudents) {
                await db.run(
                    `INSERT OR IGNORE INTO student_profiles 
                     (student_name, phone_number, email, branch, subscription_type, subscription_active,
                      subscription_status, subscription_badge, total_classes, remaining_classes, used_classes,
                      day_of_week, time_slot, teacher_name, is_demo, source) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        student.student_name,
                        student.phone_number,
                        student.email,
                        student.branch,
                        student.subscription_type,
                        student.subscription_active,
                        student.subscription_status,
                        student.subscription_badge,
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
            }
            
            console.log(`✅ Создано ${testStudents.length} тестовых учеников`);
        }
        
        console.log('✅ Тестовые данные проверены/созданы');
        
    } catch (error) {
        console.error('⚠️  Ошибка создания тестовых данных:', error.message);
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

// Функция для сохранения профилей в базу данных
async function saveProfilesToDatabase(profiles) {
    try {
        console.log(`💾 Сохранение профилей в БД...`);
        let savedCount = 0;
        
        for (const profile of profiles) {
            try {
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
                          subscription_type, subscription_active, subscription_status, subscription_badge,
                          total_classes, used_classes, remaining_classes, expiration_date, 
                          activation_date, last_visit_date, parent_name, custom_fields, 
                          raw_contact_data, is_demo, source, is_active) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                            profile.subscription_status || '',
                            profile.subscription_badge || 'inactive',
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
                    savedCount++;
                } else {
                    // Обновляем существующий профиль
                    await db.run(
                        `UPDATE student_profiles SET
                         student_name = ?, phone_number = ?, email = ?, birth_date = ?, branch = ?,
                         day_of_week = ?, time_slot = ?, teacher_name = ?,
                         subscription_type = ?, subscription_active = ?, subscription_status = ?, subscription_badge = ?,
                         total_classes = ?, used_classes = ?, remaining_classes = ?,
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
                            profile.subscription_status || '',
                            profile.subscription_badge || 'inactive',
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
                    savedCount++;
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка сохранения профиля ${profile.student_name}:`, profileError.message);
            }
        }
        
        console.log(`✅ Сохранено/обновлено профилей: ${savedCount}`);
    } catch (error) {
        console.error(`❌ Общая ошибка сохранения профилей: ${error.message}`);
    }
}

// Функция для форматирования номера телефона
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

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '2.3.0',
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
        
        // Форматируем номер телефона
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`📱 Форматированный номер: ${formattedPhone}`);
        console.log(`🔧 Статус amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
        
        let profiles = [];
        
        // Поиск в amoCRM
        if (amoCrmService.isInitialized) {
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            console.log(`📊 Найдено профилей в amoCRM: ${profiles.length}`);
            
            // Сохраняем найденные профили в базу данных
            if (profiles.length > 0) {
                await saveProfilesToDatabase(profiles);
            }
        }
        
        // Если не нашли в amoCRM или amoCRM не подключен, ищем в локальной базе
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
        
        // Форматируем профили для ответа
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
            subscription_status: p.subscription_status,
            subscription_badge: p.subscription_badge,
            total_classes: p.total_classes,
            remaining_classes: p.remaining_classes,
            used_classes: p.used_classes,
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            parent_name: p.parent_name,
            is_demo: p.is_demo === 1
        }));
        
        // Формируем ответ
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
        console.log(`📊 Абонемент: ${profile.subscription_status}`);
        
        // Рассчитываем прогресс использования абонемента
        let progress = 0;
        if (profile.total_classes > 0) {
            progress = Math.round((profile.used_classes / profile.total_classes) * 100);
        }
        
        res.json({
            success: true,
            data: {
                student: {
                    name: profile.student_name,
                    phone: profile.phone_number,
                    email: profile.email,
                    branch: profile.branch
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
                    last_updated: profile.updated_at
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
        const formattedPhone = formatPhoneNumber(phone);
        
        let profiles = [];
        
        // Поиск в amoCRM
        if (amoCrmService.isInitialized) {
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            
            // Сохраняем в базу
            if (profiles.length > 0) {
                await saveProfilesToDatabase(profiles);
            }
        }
        
        // Если не нашли в amoCRM, ищем в локальной базе
        if (profiles.length === 0) {
            const cleanPhone = phone.replace(/\D/g, '');
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
        }
        
        // Форматируем ответ
        const formattedProfiles = profiles.map(p => ({
            id: p.id,
            student_name: p.student_name,
            phone_number: p.phone_number,
            email: p.email,
            branch: p.branch,
            subscription_type: p.subscription_type,
            subscription_active: p.subscription_active === 1,
            subscription_status: p.subscription_status,
            subscription_badge: p.subscription_badge,
            total_classes: p.total_classes,
            remaining_classes: p.remaining_classes,
            used_classes: p.used_classes,
            expiration_date: p.expiration_date,
            parent_name: p.parent_name,
            is_demo: p.is_demo === 1
        }));
        
        res.json({
            success: true,
            data: {
                profiles: formattedProfiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска ученика:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка поиска ученика'
        });
    }
});

// Проверка токена
app.get('/api/verify-token', async (req, res) => {
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
            
            // Проверяем сессию в базе данных
            const session = await db.get(
                `SELECT * FROM user_sessions 
                 WHERE session_id = ? AND is_active = 1 AND expires_at > datetime('now')`,
                [decoded.session_id]
            );
            
            if (!session) {
                return res.status(401).json({
                    success: false,
                    error: 'Сессия истекла или не найдена'
                });
            }
            
            res.json({
                success: true,
                data: {
                    valid: true,
                    phone: decoded.phone,
                    profiles_count: decoded.profiles_count,
                    amocrm_connected: decoded.amocrm_connected
                }
            });
            
        } catch (jwtError) {
            return res.status(401).json({
                success: false,
                error: 'Неверный или истекший токен'
            });
        }
        
    } catch (error) {
        console.error('Ошибка проверки токена:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки токена'
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v2.3');
        console.log('='.repeat(80));
        console.log('✨ ПОИСК УЧЕНИКОВ ПО ТЕЛЕФОНУ РОДИТЕЛЯ С ПРАВИЛЬНЫМ ОТОБРАЖЕНИЕМ АБОНЕМЕНТА');
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
            console.log(`🔍 Поиск ученика: POST http://localhost:${PORT}/api/search/student`);
            console.log(`📋 Абонемент: POST http://localhost:${PORT}/api/subscription`);
            console.log('='.repeat(50));
            
            console.log('\n📞 ТЕСТОВЫЕ ТЕЛЕФОНЫ:');
            console.log('='.repeat(50));
            console.log(`📱 Для теста с тестовыми данными: +79680175895`);
            console.log('='.repeat(50));
        });
        
        // Обработка завершения работы
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
