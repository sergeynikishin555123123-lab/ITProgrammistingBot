require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

// CORS настройки
const corsOptions = {
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Статические файлы из public директории
app.use(express.static(path.join(__dirname, 'public')));

// ==================== КОНФИГУРАЦИЯ ====================
const AMOCRM_CONFIG = {
    // Конфигурация amoCRM - нужно заполнить из .env
    domain: process.env.AMOCRM_DOMAIN || 'yourcompany.amocrm.ru',
    client_id: process.env.AMOCRM_CLIENT_ID || '',
    client_secret: process.env.AMOCRM_CLIENT_SECRET || '',
    redirect_uri: process.env.AMOCRM_REDIRECT_URI || 'https://yourserver.com/oauth/callback',
    access_token: process.env.AMOCRM_ACCESS_TOKEN || '',
    refresh_token: process.env.AMOCRM_REFRESH_TOKEN || ''
};

const TELEGRAM_CONFIG = {
    bot_token: process.env.TELEGRAM_BOT_TOKEN || '',
    webhook_url: process.env.TELEGRAM_WEBHOOK_URL || ''
};

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных школы рисования...');
        
        const dbDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
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
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        throw error;
    }
};

const createTables = async () => {
    try {
        console.log('📊 Создание таблиц школы рисования...');
        
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

        // Профили учеников (связь с amoCRM)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_user_id INTEGER,
                amo_contact_id INTEGER,
                amo_deal_id INTEGER,
                student_name TEXT NOT NULL,
                parent_name TEXT,
                phone_number TEXT NOT NULL,
                email TEXT,
                branch TEXT NOT NULL CHECK(branch IN ('Свиблово', 'Чертаново')),
                subscription_type TEXT,
                total_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                expiration_date DATE,
                teacher_name TEXT,
                day_of_week TEXT,
                time_slot TEXT,
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
                branches TEXT, -- JSON массив филиалов
                telegram_username TEXT,
                phone_number TEXT,
                email TEXT,
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
                branch TEXT, -- NULL для всех филиалов
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
                branches TEXT, -- JSON массив филиалов
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
                branches TEXT, -- JSON массив филиалов
                teacher_ids TEXT, -- JSON массив ID преподавателей
                days_of_week TEXT, -- JSON массив дней недели
                filters_applied TEXT, -- JSON с фильтрами
                recipients_count INTEGER DEFAULT 0,
                sent_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sending', 'sent', 'failed')),
                sent_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_id) REFERENCES administrators(id) ON DELETE CASCADE
            )
        `);

        // Лог рассылок
        await db.exec(`
            CREATE TABLE IF NOT EXISTS broadcast_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                broadcast_id INTEGER NOT NULL,
                student_profile_id INTEGER,
                telegram_user_id INTEGER,
                status TEXT CHECK(status IN ('sent', 'delivered', 'failed')),
                error_message TEXT,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE,
                FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE SET NULL,
                FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(id) ON DELETE SET NULL
            )
        `);

        // Сообщения для администраторов
        await db.exec(`
            CREATE TABLE IF NOT EXISTS admin_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_profile_id INTEGER NOT NULL,
                telegram_user_id INTEGER,
                message_type TEXT DEFAULT 'contact' CHECK(message_type IN ('contact', 'renewal', 'question')),
                message TEXT NOT NULL,
                branch TEXT,
                student_name TEXT,
                status TEXT DEFAULT 'new' CHECK(status IN ('new', 'read', 'replied', 'closed')),
                admin_id INTEGER,
                admin_response TEXT,
                responded_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(id) ON DELETE SET NULL,
                FOREIGN KEY (admin_id) REFERENCES administrators(id) ON DELETE SET NULL
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

        // Токены для amoCRM API
        await db.exec(`
            CREATE TABLE IF NOT EXISTS amocrm_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
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
        console.log('📝 Создание демо-данных для школы рисования...');

        // Демо администраторы
        const adminExists = await db.get("SELECT 1 FROM administrators LIMIT 1");
        if (!adminExists) {
            await db.run(
                `INSERT INTO administrators (name, email, phone_number, branches, role) 
                 VALUES (?, ?, ?, ?, ?)`,
                ['Администратор Свиблово', 'admin1@artschool.ru', '+79991112233', '["Свиблово"]', 'admin']
            );
            
            await db.run(
                `INSERT INTO administrators (name, email, phone_number, branches, role) 
                 VALUES (?, ?, ?, ?, ?)`,
                ['Администратор Чертаново', 'admin2@artschool.ru', '+79994445566', '["Чертаново"]', 'admin']
            );
            
            console.log('✅ Демо-администраторы созданы');
        }

        // Демо преподаватели
        const teachersExist = await db.get("SELECT 1 FROM teachers LIMIT 1");
        if (!teachersExist) {
            const teachers = [
                ['Анна Петрова', 'https://via.placeholder.com/300x300/4A90E2/FFFFFF?text=АП', 
                 'Художник-педагог, член Союза художников России', 
                 'Академический рисунок, графика', 8,
                 'Опытный преподаватель с 8-летним стажем. Специализируется на академическом рисунке и графике.',
                 '["Свиблово"]', '@anna_petrova', '+79997778899', 'anna@artschool.ru', 1],
                 
                ['Сергей Смирнов', 'https://via.placeholder.com/300x300/9C6ADE/FFFFFF?text=СС',
                 'Художник-живописец, преподаватель с 10-летним стажем',
                 'Акварель, масляная живопись', 10,
                 'Эксперт в акварельной и масляной живописи. Работы учеников регулярно участвуют в выставках.',
                 '["Чертаново"]', '@sergey_smirnov', '+79996667788', 'sergey@artschool.ru', 2],
                 
                ['Елена Ковалева', 'https://via.placeholder.com/300x300/FFC107/FFFFFF?text=ЕК',
                 'Иллюстратор, дизайнер, преподаватель детских групп',
                 'Скетчинг, иллюстрация, детское творчество', 6,
                 'Специализируется на работе с детьми. Разработала авторскую методику обучения рисованию для детей.',
                 '["Свиблово", "Чертаново"]', '@elena_kovaleva', '+79995554433', 'elena@artschool.ru', 3]
            ];
            
            for (const teacher of teachers) {
                await db.run(
                    `INSERT INTO teachers (name, photo_url, qualification, specialization, 
                     experience_years, description, branches, telegram_username, 
                     phone_number, email, display_order) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    teacher
                );
            }
            console.log('✅ Демо-преподаватели созданы');
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
                ['Чертаново', 'суббота', '13:00', '14:30', 3, 'Елена Ковалева', 'Дети 7-9 лет', 'Кабинет 4', 8, 6]
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
                 'Да, по предварительному согласованию с администраторами обоих филиалов возможно разовое посещение занятий в другом филиале.', 
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

// ==================== AMOCRM ИНТЕГРАЦИЯ ====================

// Получение токена amoCRM
const getAmocrmToken = async () => {
    try {
        const token = await db.get(
            'SELECT * FROM amocrm_tokens ORDER BY created_at DESC LIMIT 1'
        );
        
        if (!token) {
            throw new Error('Токен amoCRM не найден');
        }
        
        // Проверяем срок действия токена
        if (new Date(token.expires_at) < new Date()) {
            // Токен истек, обновляем
            return await refreshAmocrmToken(token.refresh_token);
        }
        
        return token.access_token;
        
    } catch (error) {
        console.error('Ошибка получения токена amoCRM:', error.message);
        throw error;
    }
};

// Обновление токена amoCRM
const refreshAmocrmToken = async (refreshToken) => {
    try {
        const response = await axios.post(`https://${AMOCRM_CONFIG.domain}/oauth2/access_token`, {
            client_id: AMOCRM_CONFIG.client_id,
            client_secret: AMOCRM_CONFIG.client_secret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            redirect_uri: AMOCRM_CONFIG.redirect_uri
        });
        
        const { access_token, refresh_token, expires_in } = response.data;
        
        // Сохраняем новый токен
        const expiresAt = new Date(Date.now() + expires_in * 1000);
        
        await db.run(
            `INSERT INTO amocrm_tokens (access_token, refresh_token, expires_at) 
             VALUES (?, ?, ?)`,
            [access_token, refresh_token, expiresAt.toISOString()]
        );
        
        console.log('✅ Токен amoCRM обновлен');
        
        return access_token;
        
    } catch (error) {
        console.error('Ошибка обновления токена amoCRM:', error.message);
        throw error;
    }
};

// Поиск контактов и сделок в amoCRM по номеру телефона
const findInAmocrmByPhone = async (phoneNumber) => {
    try {
        const token = await getAmocrmToken();
        
        // Поиск контакта по телефону
        const contactsResponse = await axios.get(
            `https://${AMOCRM_CONFIG.domain}/api/v4/contacts?query=${encodeURIComponent(phoneNumber)}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        if (!contactsResponse.data._embedded || !contactsResponse.data._embedded.contacts) {
            return { success: false, error: 'Контакт не найден' };
        }
        
        const contact = contactsResponse.data._embedded.contacts[0];
        
        // Получаем сделки контакта
        const dealsResponse = await axios.get(
            `https://${AMOCRM_CONFIG.domain}/api/v4/contacts/${contact.id}/leads`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        // Парсим сделки для получения профилей учеников
        const profiles = [];
        
        if (dealsResponse.data._embedded && dealsResponse.data._embedded.leads) {
            for (const deal of dealsResponse.data._embedded.leads) {
                const profile = await parseDealToProfile(contact, deal);
                if (profile) {
                    profiles.push(profile);
                }
            }
        }
        
        return {
            success: true,
            data: {
                contact: contact,
                profiles: profiles,
                total_profiles: profiles.length
            }
        };
        
    } catch (error) {
        console.error('Ошибка поиска в amoCRM:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
};

// Парсинг сделки в профиль ученика
const parseDealToProfile = async (contact, deal) => {
    try {
        // Получаем кастомные поля сделки
        const dealCustomFields = deal.custom_fields_values || [];
        
        // Извлекаем нужные поля из сделки
        const studentName = getCustomFieldValue(dealCustomFields, 'student_name') || 
                           contact.name || 'Неизвестный ученик';
        
        const branch = getCustomFieldValue(dealCustomFields, 'branch') || 'Не указан';
        const subscriptionType = getCustomFieldValue(dealCustomFields, 'subscription_type') || 'Без названия';
        const totalClasses = parseInt(getCustomFieldValue(dealCustomFields, 'total_classes')) || 0;
        const remainingClasses = parseInt(getCustomFieldValue(dealCustomFields, 'remaining_classes')) || 0;
        const expirationDate = getCustomFieldValue(dealCustomFields, 'expiration_date');
        const teacherName = getCustomFieldValue(dealCustomFields, 'teacher_name');
        const dayOfWeek = getCustomFieldValue(dealCustomFields, 'day_of_week');
        const timeSlot = getCustomFieldValue(dealCustomFields, 'time_slot');
        
        // Определяем статус абонемента
        let subscriptionStatus = 'unknown';
        if (deal.status_id) {
            // Здесь нужно сопоставить ID статуса воронки с названием
            // Например: 142 - Активный абонемент, 143 - Завершен и т.д.
            subscriptionStatus = mapPipelineStatus(deal.status_id);
        }
        
        return {
            amo_contact_id: contact.id,
            amo_deal_id: deal.id,
            student_name: studentName,
            parent_name: contact.name,
            phone_number: contact.custom_fields_values ? 
                getPhoneFromContact(contact.custom_fields_values) : '',
            branch: branch,
            subscription_type: subscriptionType,
            total_classes: totalClasses,
            remaining_classes: remainingClasses,
            expiration_date: expirationDate,
            teacher_name: teacherName,
            day_of_week: dayOfWeek,
            time_slot: timeSlot,
            subscription_status: subscriptionStatus,
            deal_name: deal.name,
            created_at: deal.created_at,
            updated_at: deal.updated_at
        };
        
    } catch (error) {
        console.error('Ошибка парсинга сделки:', error.message);
        return null;
    }
};

// Вспомогательные функции для работы с amoCRM
const getCustomFieldValue = (customFields, fieldCode) => {
    if (!customFields) return null;
    
    const field = customFields.find(f => f.field_code === fieldCode || f.field_name === fieldCode);
    if (field && field.values && field.values.length > 0) {
        return field.values[0].value;
    }
    return null;
};

const getPhoneFromContact = (customFields) => {
    const phoneField = customFields.find(f => f.field_code === 'PHONE' || f.field_name === 'Телефон');
    if (phoneField && phoneField.values && phoneField.values.length > 0) {
        return phoneField.values[0].value;
    }
    return null;
};

const mapPipelineStatus = (statusId) => {
    // Здесь нужно сопоставить ID статусов вашей воронки "Абонемент"
    const statusMap = {
        142: 'active',      // Активный абонемент
        143: 'completed',   // Успешно реализовано
        144: 'failed',      // Не реализовано
        145: 'purchased',   // Купленный абонемент
        // Добавьте другие статусы
    };
    
    return statusMap[statusId] || 'unknown';
};

// ==================== ТЕЛЕГРАМ ИНТЕГРАЦИЯ ====================

// Обработка авторизации через Telegram
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
            
            console.log(`✅ Новый пользователь Telegram создан: ${telegramUser.id}`);
        } else {
            // Обновляем существующего пользователя
            await db.run(
                `UPDATE telegram_users 
                 SET first_name = ?, last_name = ?, username = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [first_name || '', last_name || '', username || '', telegramUser.id]
            );
        }
        
        // Ищем профили учеников в amoCRM
        const amocrmResult = await findInAmocrmByPhone(phone);
        
        if (!amocrmResult.success) {
            return res.status(404).json({
                success: false,
                error: amocrmResult.error || 'Профили не найдены в amoCRM'
            });
        }
        
        // Сохраняем найденные профили в базу
        const savedProfiles = [];
        
        for (const profile of amocrmResult.data.profiles) {
            // Проверяем существующий профиль
            const existingProfile = await db.get(
                `SELECT * FROM student_profiles 
                 WHERE amo_deal_id = ? AND telegram_user_id = ?`,
                [profile.amo_deal_id, telegramUser.id]
            );
            
            if (!existingProfile) {
                // Создаем новый профиль
                const profileResult = await db.run(
                    `INSERT INTO student_profiles 
                     (telegram_user_id, amo_contact_id, amo_deal_id, student_name, 
                      parent_name, phone_number, branch, subscription_type, 
                      total_classes, remaining_classes, expiration_date, 
                      teacher_name, day_of_week, time_slot) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        telegramUser.id,
                        profile.amo_contact_id,
                        profile.amo_deal_id,
                        profile.student_name,
                        profile.parent_name || '',
                        profile.phone_number,
                        profile.branch,
                        profile.subscription_type,
                        profile.total_classes,
                        profile.remaining_classes,
                        profile.expiration_date,
                        profile.teacher_name || '',
                        profile.day_of_week || '',
                        profile.time_slot || ''
                    ]
                );
                
                const newProfile = await db.get(
                    'SELECT * FROM student_profiles WHERE id = ?',
                    [profileResult.lastID]
                );
                
                savedProfiles.push(newProfile);
            } else {
                // Обновляем существующий профиль
                await db.run(
                    `UPDATE student_profiles 
                     SET student_name = ?, branch = ?, subscription_type = ?,
                         total_classes = ?, remaining_classes = ?, expiration_date = ?,
                         teacher_name = ?, day_of_week = ?, time_slot = ?,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [
                        profile.student_name,
                        profile.branch,
                        profile.subscription_type,
                        profile.total_classes,
                        profile.remaining_classes,
                        profile.expiration_date,
                        profile.teacher_name || '',
                        profile.day_of_week || '',
                        profile.time_slot || '',
                        existingProfile.id
                    ]
                );
                
                savedProfiles.push({
                    ...existingProfile,
                    ...profile
                });
            }
        }
        
        // Группируем профили по филиалам
        const profilesByBranch = {};
        savedProfiles.forEach(profile => {
            if (!profilesByBranch[profile.branch]) {
                profilesByBranch[profile.branch] = [];
            }
            profilesByBranch[profile.branch].push(profile);
        });
        
        // Определяем логику выбора профиля по ТЗ
        const selectionLogic = determineProfileSelection(savedProfiles);
        
        res.json({
            success: true,
            message: 'Авторизация успешна',
            data: {
                user: telegramUser,
                profiles: savedProfiles,
                profiles_by_branch: profilesByBranch,
                selection_logic: selectionLogic,
                total_profiles: savedProfiles.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка авторизации через Telegram:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка авторизации'
        });
    }
});

// Определение логики выбора профиля по ТЗ
const determineProfileSelection = (profiles) => {
    if (profiles.length === 0) {
        return {
            action: 'no_profiles',
            message: 'Профили не найдены'
        };
    }
    
    if (profiles.length === 1) {
        return {
            action: 'auto_select',
            profile: profiles[0],
            message: 'Автоматически выбран единственный профиль'
        };
    }
    
    // Группируем по филиалам
    const profilesByBranch = {};
    profiles.forEach(profile => {
        if (!profilesByBranch[profile.branch]) {
            profilesByBranch[profile.branch] = [];
        }
        profilesByBranch[profile.branch].push(profile);
    });
    
    // Если все профили в одном филиале
    const branchKeys = Object.keys(profilesByBranch);
    if (branchKeys.length === 1) {
        // Приоритет: активный абонемент
        const activeProfiles = profiles.filter(p => 
            p.subscription_status === 'active' || 
            (p.remaining_classes > 0 && p.expiration_date && new Date(p.expiration_date) > new Date())
        );
        
        if (activeProfiles.length === 1) {
            return {
                action: 'auto_select_active',
                profile: activeProfiles[0],
                message: 'Выбран активный абонемент'
            };
        } else if (activeProfiles.length > 1) {
            return {
                action: 'select_from_active',
                profiles: activeProfiles,
                message: 'Несколько активных абонементов - требуется выбор'
            };
        } else {
            // Ищем последний купленный абонемент
            const purchasedProfiles = profiles.filter(p => p.subscription_status === 'purchased');
            if (purchasedProfiles.length > 0) {
                const latestPurchased = purchasedProfiles.sort((a, b) => 
                    new Date(b.created_at) - new Date(a.created_at)
                )[0];
                
                return {
                    action: 'select_latest_purchased',
                    profile: latestPurchased,
                    message: 'Выбран последний купленный абонемент'
                };
            } else {
                // Выбираем последний завершенный
                const completedProfiles = profiles.filter(p => 
                    p.subscription_status === 'completed' || p.subscription_status === 'failed'
                );
                if (completedProfiles.length > 0) {
                    const latestCompleted = completedProfiles.sort((a, b) => 
                        new Date(b.created_at) - new Date(a.created_at)
                    )[0];
                    
                    return {
                        action: 'select_latest_completed',
                        profile: latestCompleted,
                        message: 'Выбран последний завершенный абонемент'
                    };
                }
            }
        }
    } else {
        // Профили в разных филиалах
        return {
            action: 'select_branch_first',
            branches: branchKeys,
            profiles_by_branch: profilesByBranch,
            message: 'Профили в разных филиалах - сначала выберите филиал'
        };
    }
    
    return {
        action: 'manual_select',
        profiles: profiles,
        message: 'Требуется ручной выбор профиля'
    };
};

// ==================== ОСНОВНОЙ ФУНКЦИОНАЛ ====================

// Получение расписания для филиала
app.post('/api/schedule', async (req, res) => {
    try {
        const { branch, week_start } = req.body;
        
        if (!branch) {
            return res.status(400).json({
                success: false,
                error: 'Укажите филиал'
            });
        }
        
        // Рассчитываем даты недели
        const startDate = week_start ? new Date(week_start) : new Date();
        const weekDates = getWeekDates(startDate);
        
        // Получаем расписание для филиала
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
        
        // Добавляем информацию о датах
        const scheduleWithDates = schedule.map(lesson => {
            const dayIndex = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресеньe']
                .indexOf(lesson.day_of_week.toLowerCase());
            
            return {
                ...lesson,
                date: weekDates[dayIndex] ? weekDates[dayIndex].toISOString().split('T')[0] : null,
                is_today: weekDates[dayIndex] ? isToday(weekDates[dayIndex]) : false
            };
        });
        
        res.json({
            success: true,
            data: {
                schedule: scheduleWithDates,
                week_start: weekDates[0].toISOString().split('T')[0],
                week_end: weekDates[6].toISOString().split('T')[0],
                branch: branch
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения расписания:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения расписания'
        });
    }
});

// Получение информации об абонементе
app.post('/api/subscription', async (req, res) => {
    try {
        const { deal_id, profile_id } = req.body;
        
        if (!deal_id && !profile_id) {
            return res.status(400).json({
                success: false,
                error: 'Укажите ID сделки или профиля'
            });
        }
        
        let profile;
        if (profile_id) {
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE id = ?`,
                [profile_id]
            );
        } else {
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE amo_deal_id = ?`,
                [deal_id]
            );
        }
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        // Получаем историю посещений
        const visits = await db.all(
            `SELECT * FROM attendance 
             WHERE student_profile_id = ?
             ORDER BY attendance_date DESC, attendance_time DESC
             LIMIT 20`,
            [profile.id]
        );
        
        // Получаем ближайшие занятия
        const upcomingClasses = await getUpcomingClasses(profile);
        
        res.json({
            success: true,
            data: {
                subscription: profile,
                visits: visits,
                upcoming_classes: upcomingClasses,
                progress: {
                    used_classes: profile.total_classes - profile.remaining_classes,
                    total_classes: profile.total_classes,
                    percentage: profile.total_classes > 0 ? 
                        Math.round(((profile.total_classes - profile.remaining_classes) / profile.total_classes) * 100) : 0
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения информации об абонементе:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
        });
    }
});

// Получение преподавателей филиала
app.post('/api/teachers', async (req, res) => {
    try {
        const { branch } = req.body;
        
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
        console.error('Ошибка получения преподавателей:', error.message);
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
            `SELECT * FROM faq 
             WHERE is_active = 1
             ORDER BY display_order, category`
        );
        
        // Группировка по категориям
        const faqByCategory = faq.reduce((acc, item) => {
            if (!acc[item.category]) {
                acc[item.category] = [];
            }
            acc[item.category].push(item);
            return acc;
        }, {});
        
        res.json({
            success: true,
            data: {
                faq: faqByCategory,
                categories: Object.keys(faqByCategory)
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения FAQ:', error.message);
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
        console.error('Ошибка получения новостей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения новостей'
        });
    }
});

// ==================== АДМИН-ПАНЕЛЬ ====================

// Авторизация администратора
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Здесь должна быть проверка учетных данных администратора
        // Для демо используем простую проверку
        const admin = await db.get(
            `SELECT * FROM administrators 
             WHERE email = ? AND is_active = 1`,
            [email]
        );
        
        if (!admin) {
            return res.status(401).json({
                success: false,
                error: 'Администратор не найден'
            });
        }
        
        // Простая проверка пароля (в реальном приложении нужно использовать хеширование)
        if (password !== 'admin123') { // Демо-пароль
            return res.status(401).json({
                success: false,
                error: 'Неверный пароль'
            });
        }
        
        // Создаем JWT токен
        const token = jwt.sign(
            { 
                id: admin.id,
                email: admin.email,
                role: admin.role,
                branches: JSON.parse(admin.branches || '[]')
            },
            process.env.JWT_SECRET || 'art-school-secret-key-2024',
            { expiresIn: '24h' }
        );
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно',
            data: {
                admin: {
                    id: admin.id,
                    name: admin.name,
                    email: admin.email,
                    role: admin.role,
                    branches: JSON.parse(admin.branches || '[]')
                },
                token: token
            }
        });
        
    } catch (error) {
        console.error('Ошибка входа администратора:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка входа'
        });
    }
});

// Middleware для проверки администратора
const adminAuthMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Требуется авторизация'
            });
        }
        
        const token = authHeader.replace('Bearer ', '').trim();
        
        try {
            const decoded = jwt.verify(
                token, 
                process.env.JWT_SECRET || 'art-school-secret-key-2024'
            );
            
            req.admin = decoded;
            next();
            
        } catch (jwtError) {
            return res.status(401).json({
                success: false,
                error: 'Неверный токен'
            });
        }
        
    } catch (error) {
        console.error('Ошибка authMiddleware:', error);
        return res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
};

// Получение данных для рассылки по фильтрам
app.post('/api/admin/calculate-recipients', adminAuthMiddleware, async (req, res) => {
    try {
        const { branch, teacher_id, day_of_week } = req.body;
        
        let query = `
            SELECT COUNT(DISTINCT sp.id) as count
            FROM student_profiles sp
            WHERE sp.is_active = 1
        `;
        
        let params = [];
        
        if (branch) {
            query += ` AND sp.branch = ?`;
            params.push(branch);
        }
        
        if (teacher_id) {
            query += ` AND sp.teacher_name IN (
                SELECT name FROM teachers WHERE id = ?
            )`;
            params.push(teacher_id);
        }
        
        if (day_of_week) {
            query += ` AND sp.day_of_week = ?`;
            params.push(day_of_week);
        }
        
        // Фильтр по филиалам администратора
        if (req.admin.branches && req.admin.branches.length > 0) {
            query += ` AND sp.branch IN (${req.admin.branches.map(() => '?').join(',')})`;
            params.push(...req.admin.branches);
        }
        
        const result = await db.get(query, params);
        
        res.json({
            success: true,
            data: {
                count: result.count,
                filters: { branch, teacher_id, day_of_week }
            }
        });
        
    } catch (error) {
        console.error('Ошибка расчета получателей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка расчета получателей'
        });
    }
});

// Отправка тестовой рассылки
app.post('/api/admin/send-test-broadcast', adminAuthMiddleware, async (req, res) => {
    try {
        const { message, type } = req.body;
        
        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Введите текст сообщения'
            });
        }
        
        // В реальном приложении здесь должна быть отправка в Telegram
        // Для демо просто логируем
        
        console.log('📤 Тестовая рассылка администратору:', {
            admin_id: req.admin.id,
            message: message,
            type: type
        });
        
        res.json({
            success: true,
            message: 'Тестовое сообщение отправлено администратору',
            data: {
                sent_to: req.admin.email,
                message_preview: message.substring(0, 100) + '...'
            }
        });
        
    } catch (error) {
        console.error('Ошибка отправки тестовой рассылки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки тестовой рассылки'
        });
    }
});

// Отправка рассылки всем получателям
app.post('/api/admin/send-broadcast', adminAuthMiddleware, async (req, res) => {
    try {
        const { branch, teacher_id, day_of_week, message, type } = req.body;
        
        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Введите текст сообщения'
            });
        }
        
        // Получаем список получателей
        let query = `
            SELECT DISTINCT sp.*, tu.telegram_id
            FROM student_profiles sp
            LEFT JOIN telegram_users tu ON sp.telegram_user_id = tu.id
            WHERE sp.is_active = 1
        `;
        
        let params = [];
        
        if (branch) {
            query += ` AND sp.branch = ?`;
            params.push(branch);
        }
        
        if (teacher_id) {
            const teacher = await db.get('SELECT name FROM teachers WHERE id = ?', [teacher_id]);
            if (teacher) {
                query += ` AND sp.teacher_name = ?`;
                params.push(teacher.name);
            }
        }
        
        if (day_of_week) {
            query += ` AND sp.day_of_week = ?`;
            params.push(day_of_week);
        }
        
        // Фильтр по филиалам администратора
        if (req.admin.branches && req.admin.branches.length > 0) {
            query += ` AND sp.branch IN (${req.admin.branches.map(() => '?').join(',')})`;
            params.push(...req.admin.branches);
        }
        
        const recipients = await db.all(query, params);
        
        if (recipients.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Нет получателей по заданным фильтрам'
            });
        }
        
        // Создаем запись о рассылке
        const broadcastResult = await db.run(
            `INSERT INTO broadcasts 
             (admin_id, broadcast_type, message_type, message, 
              branches, teacher_ids, days_of_week, recipients_count, status) 
             VALUES (?, 'service', ?, ?, ?, ?, ?, ?, 'sending')`,
            [
                req.admin.id,
                type || 'custom',
                message,
                branch ? JSON.stringify([branch]) : null,
                teacher_id ? JSON.stringify([teacher_id]) : null,
                day_of_week ? JSON.stringify([day_of_week]) : null,
                recipients.length
            ]
        );
        
        const broadcastId = broadcastResult.lastID;
        
        // В реальном приложении здесь должна быть отправка в Telegram
        // Для демо просто логируем и обновляем статус
        
        console.log('📤 Рассылка всем получателям:', {
            broadcast_id: broadcastId,
            recipients_count: recipients.length,
            message: message
        });
        
        // Обновляем статус рассылки
        await db.run(
            `UPDATE broadcasts 
             SET status = 'sent', sent_count = ?, sent_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [recipients.length, broadcastId]
        );
        
        // Создаем логи рассылки
        for (const recipient of recipients) {
            await db.run(
                `INSERT INTO broadcast_logs (broadcast_id, student_profile_id, telegram_user_id, status) 
                 VALUES (?, ?, ?, 'sent')`,
                [broadcastId, recipient.id, recipient.telegram_user_id]
            );
        }
        
        res.json({
            success: true,
            message: `Рассылка отправлена ${recipients.length} получателям`,
            data: {
                broadcast_id: broadcastId,
                sent_count: recipients.length,
                recipients: recipients.map(r => ({
                    id: r.id,
                    student_name: r.student_name,
                    branch: r.branch
                }))
            }
        });
        
    } catch (error) {
        console.error('Ошибка отправки рассылки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки рассылки'
        });
    }
});

// Получение истории рассылок
app.get('/api/admin/broadcast-history', adminAuthMiddleware, async (req, res) => {
    try {
        const broadcasts = await db.all(
            `SELECT b.*, a.name as admin_name
             FROM broadcasts b
             LEFT JOIN administrators a ON b.admin_id = a.id
             WHERE a.id = ? OR ? = 'superadmin'
             ORDER BY b.created_at DESC
             LIMIT 20`,
            [req.admin.id, req.admin.role]
        );
        
        res.json({
            success: true,
            data: {
                broadcasts: broadcasts,
                total: broadcasts.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения истории рассылок:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения истории рассылок'
        });
    }
});

// Управление преподавателями (админ)
app.get('/api/admin/teachers', adminAuthMiddleware, async (req, res) => {
    try {
        const teachers = await db.all(
            `SELECT * FROM teachers 
             ORDER BY display_order, name`
        );
        
        res.json({
            success: true,
            data: {
                teachers: teachers,
                total: teachers.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения преподавателей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения преподавателей'
        });
    }
});

// Обновление преподавателя
app.put('/api/admin/teachers/:id', adminAuthMiddleware, async (req, res) => {
    try {
        const teacherId = req.params.id;
        const { name, photo_url, qualification, specialization, 
                experience_years, description, branches, 
                telegram_username, phone_number, email, display_order, is_active } = req.body;
        
        const existingTeacher = await db.get(
            'SELECT * FROM teachers WHERE id = ?',
            [teacherId]
        );
        
        if (!existingTeacher) {
            return res.status(404).json({
                success: false,
                error: 'Преподаватель не найден'
            });
        }
        
        await db.run(
            `UPDATE teachers 
             SET name = ?, photo_url = ?, qualification = ?, specialization = ?,
                 experience_years = ?, description = ?, branches = ?,
                 telegram_username = ?, phone_number = ?, email = ?,
                 display_order = ?, is_active = ?
             WHERE id = ?`,
            [
                name || existingTeacher.name,
                photo_url || existingTeacher.photo_url,
                qualification || existingTeacher.qualification,
                specialization || existingTeacher.specialization,
                experience_years || existingTeacher.experience_years,
                description || existingTeacher.description,
                branches ? JSON.stringify(branches) : existingTeacher.branches,
                telegram_username || existingTeacher.telegram_username,
                phone_number || existingTeacher.phone_number,
                email || existingTeacher.email,
                display_order || existingTeacher.display_order,
                is_active !== undefined ? is_active : existingTeacher.is_active,
                teacherId
            ]
        );
        
        const updatedTeacher = await db.get(
            'SELECT * FROM teachers WHERE id = ?',
            [teacherId]
        );
        
        res.json({
            success: true,
            message: 'Преподаватель обновлен',
            data: { teacher: updatedTeacher }
        });
        
    } catch (error) {
        console.error('Ошибка обновления преподавателя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления преподавателя'
        });
    }
});

// Создание нового преподавателя
app.post('/api/admin/teachers', adminAuthMiddleware, async (req, res) => {
    try {
        const { name, photo_url, qualification, specialization, 
                experience_years, description, branches, 
                telegram_username, phone_number, email, display_order } = req.body;
        
        if (!name) {
            return res.status(400).json({
                success: false,
                error: 'Введите имя преподавателя'
            });
        }
        
        const result = await db.run(
            `INSERT INTO teachers 
             (name, photo_url, qualification, specialization, 
              experience_years, description, branches, 
              telegram_username, phone_number, email, display_order) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                name,
                photo_url || '',
                qualification || '',
                specialization || '',
                experience_years || 0,
                description || '',
                branches ? JSON.stringify(branches) : null,
                telegram_username || '',
                phone_number || '',
                email || '',
                display_order || 0
            ]
        );
        
        const teacherId = result.lastID;
        const teacher = await db.get('SELECT * FROM teachers WHERE id = ?', [teacherId]);
        
        res.status(201).json({
            success: true,
            message: 'Преподаватель создан',
            data: { teacher }
        });
        
    } catch (error) {
        console.error('Ошибка создания преподавателя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания преподавателя'
        });
    }
});

// ==================== СВЯЗЬ С АДМИНИСТРАТОРОМ ====================

// Получение контактов администратора для филиала
app.get('/api/contacts/:branch', async (req, res) => {
    try {
        const { branch } = req.params;
        
        const contact = await db.get(
            'SELECT * FROM branch_contacts WHERE branch = ? AND is_active = 1',
            [branch]
        );
        
        if (!contact) {
            return res.status(404).json({
                success: false,
                error: 'Контакты для филиала не найдены'
            });
        }
        
        res.json({
            success: true,
            data: { contact }
        });
        
    } catch (error) {
        console.error('Ошибка получения контактов:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения контактов'
        });
    }
});

// Создание сообщения администратору
app.post('/api/contact-admin', async (req, res) => {
    try {
        const { student_profile_id, message_type, message, branch, student_name } = req.body;
        
        if (!student_profile_id || !message) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        // Получаем профиль ученика
        const profile = await db.get(
            'SELECT * FROM student_profiles WHERE id = ?',
            [student_profile_id]
        );
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Профиль ученика не найден'
            });
        }
        
        // Создаем сообщение
        const result = await db.run(
            `INSERT INTO admin_messages 
             (student_profile_id, telegram_user_id, message_type, message, branch, student_name) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                student_profile_id,
                profile.telegram_user_id,
                message_type || 'contact',
                message,
                branch || profile.branch,
                student_name || profile.student_name
            ]
        );
        
        const messageId = result.lastID;
        
        // В реальном приложении здесь должно быть уведомление администратора в Telegram
        // Для демо просто логируем
        
        console.log('📨 Новое сообщение администратору:', {
            message_id: messageId,
            student_name: profile.student_name,
            branch: profile.branch,
            message: message
        });
        
        res.status(201).json({
            success: true,
            message: 'Сообщение отправлено администратору',
            data: {
                message_id: messageId,
                contact_info: await getBranchContact(profile.branch)
            }
        });
        
    } catch (error) {
        console.error('Ошибка отправки сообщения:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки сообщения'
        });
    }
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

const getWeekDates = (startDate) => {
    const date = new Date(startDate);
    // Находим понедельник
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    
    const monday = new Date(date.setDate(diff));
    const weekDates = [];
    
    for (let i = 0; i < 7; i++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + i);
        weekDates.push(date);
    }
    
    return weekDates;
};

const isToday = (date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
};

const getUpcomingClasses = async (profile) => {
    if (!profile.day_of_week || !profile.branch) {
        return [];
    }
    
    // Получаем расписание для дня недели ученика
    const schedule = await db.all(
        `SELECT * FROM schedule 
         WHERE branch = ? AND day_of_week = ? AND is_active = 1
         ORDER BY start_time`,
        [profile.branch, profile.day_of_week]
    );
    
    // Фильтруем ближайшие 4 занятия
    const today = new Date();
    const upcoming = [];
    
    for (let i = 0; i < 28; i++) { // Проверяем 4 недели вперед
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        
        if (date.getDay() === getDayNumber(profile.day_of_week)) {
            for (const lesson of schedule) {
                if (upcoming.length >= 4) break;
                
                upcoming.push({
                    ...lesson,
                    date: date.toISOString().split('T')[0],
                    is_today: isToday(date)
                });
            }
        }
        
        if (upcoming.length >= 4) break;
    }
    
    return upcoming;
};

const getDayNumber = (dayName) => {
    const days = {
        'понедельник': 1,
        'вторник': 2,
        'среда': 3,
        'четверг': 4,
        'пятница': 5,
        'суббота': 6,
        'воскресенье': 0
    };
    return days[dayName.toLowerCase()] || 0;
};

const getBranchContact = async (branch) => {
    const contact = await db.get(
        'SELECT * FROM branch_contacts WHERE branch = ? AND is_active = 1',
        [branch]
    );
    
    if (!contact) {
        return {
            telegram_username: '@art_school_admin',
            phone_number: '+7 (XXX) XXX-XX-XX',
            email: 'info@artschool.ru'
        };
    }
    
    return contact;
};

// ==================== API МАРШРУТЫ ====================

// Главная
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🎨 Добро пожаловать в API школы рисования',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth/telegram',
            schedule: '/api/schedule',
            subscription: '/api/subscription',
            teachers: '/api/teachers',
            faq: '/api/faq',
            news: '/api/news',
            contacts: '/api/contacts/:branch',
            admin: '/api/admin/*'
        }
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        
        res.json({
            success: true,
            status: 'OK',
            database: 'connected',
            timestamp: new Date().toISOString(),
            service: 'Art School API'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'ERROR',
            error: error.message
        });
    }
});

// ==================== SPA МАРШРУТИЗАЦИЯ ====================
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ 
            success: false, 
            error: 'API endpoint not found' 
        });
    }
    
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ШКОЛЫ РИСОВАНИЯ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        console.log('✅ Все API настроены');
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}!`);
            console.log(`🌐 Доступ по адресу: http://localhost:${PORT}`);
            console.log(`📊 Проверка здоровья: http://localhost:${PORT}/health`);
            console.log('='.repeat(80));
            console.log('🔑 ДЕМО ДАННЫЕ:');
            console.log('='.repeat(50));
            console.log('🏫 Филиалы: Свиблово, Чертаново');
            console.log('👨‍🏫 Преподаватели: 3 демо-преподавателя');
            console.log('📅 Расписание: демо-расписание на неделю');
            console.log('📝 FAQ: 5 демо-вопросов');
            console.log('📰 Новости: 3 демо-новости');
            console.log('='.repeat(50));
            
            console.log('\n🎯 ОСНОВНЫЕ ФУНКЦИОНАЛЬНОСТИ:');
            console.log('='.repeat(60));
            console.log('✅ Интеграция с amoCRM (поиск по номеру телефона)');
            console.log('✅ Авторизация через Telegram');
            console.log('✅ Выбор профиля и филиала по ТЗ');
            console.log('✅ Расписание занятий с статусами');
            console.log('✅ Управление абонементами');
            console.log('✅ Каталог преподавателей');
            console.log('✅ FAQ и новости школы');
            console.log('✅ Админ-панель для рассылок');
            console.log('✅ Система уведомлений');
            console.log('✅ Связь с администратором');
            console.log('='.repeat(60));
            
            console.log('\n🔧 ЧТО НАСТРОИТЬ В .ENV ФАЙЛЕ:');
            console.log('='.repeat(60));
            console.log('AMOCRM_DOMAIN=yourcompany.amocrm.ru');
            console.log('AMOCRM_CLIENT_ID=your_client_id');
            console.log('AMOCRM_CLIENT_SECRET=your_client_secret');
            console.log('AMOCRM_ACCESS_TOKEN=initial_access_token');
            console.log('AMOCRM_REFRESH_TOKEN=initial_refresh_token');
            console.log('TELEGRAM_BOT_TOKEN=your_bot_token');
            console.log('JWT_SECRET=your_jwt_secret');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        
        try {
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            console.log('✅ Используем базу данных в памяти');
            await createTables();
            await createDemoData();
            
            const PORT = process.env.PORT || 3000;
            app.listen(PORT, () => {
                console.log(`🚀 Сервер запущен на порту ${PORT} (база в памяти)!`);
                console.log(`⚠️ ВНИМАНИЕ: Данные будут сброшены при перезагрузке сервера`);
            });
        } catch (memoryError) {
            console.error('❌ Не удалось создать базу в памяти:', memoryError.message);
            process.exit(1);
        }
    }
};

// Запуск
startServer();
