require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs').promises;
const fsSync = require('fs');
const { Telegraf, Markup, session } = require('telegraf');

const app = express();

// ==================== КОНФИГУРАЦИЯ ====================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8425388642:AAFpXOa7lYdGYmimJvxyDg2PXyLjlxYrSq4';
const DOMAIN = process.env.DOMAIN || 'https://sergeynikishin555123123-lab-itprogrammistingbot-8f42.twc1.net';
const JWT_SECRET = process.env.JWT_SECRET || 'art-school-jwt-secret-2024';

const AMOCRM_CONFIG = {
    domain: process.env.AMOCRM_DOMAIN || 'yourcompany.amocrm.ru',
    client_id: process.env.AMOCRM_CLIENT_ID || '',
    client_secret: process.env.AMOCRM_CLIENT_SECRET || '',
    redirect_uri: `${DOMAIN}/oauth/callback`,
    access_token: process.env.AMOCRM_ACCESS_TOKEN || '',
    refresh_token: process.env.AMOCRM_REFRESH_TOKEN || ''
};

// ==================== ИНИЦИАЛИЗАЦИЯ TELEGRAM БОТА ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Middleware для сессий
bot.use(session({ defaultSession: () => ({}) }));

// ==================== НАСТРОЙКА CORS И MIDDLEWARE ====================

// CORS настройки
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? [DOMAIN] 
        : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080', 'http://localhost:5000', 'http://localhost:5500'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Применяем CORS middleware
app.use(cors(corsOptions));

// Обработка preflight запросов
app.options('*', cors(corsOptions));

// Парсинг JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Статические файлы
app.use(express.static('public'));

// Middleware для обработки ошибок CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.path.startsWith('/api')) {
        res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.header('Pragma', 'no-cache');
        res.header('Expires', '0');
    }
    
    next();
});

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных школы рисования...');
        
        // Простой путь к базе данных в текущей директории
        const dbPath = './art_school.db';
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        // Создаем папку db если нужно
        const dbDir = path.dirname(dbPath);
        if (!fsSync.existsSync(dbDir) && dbDir !== '.') {
            fsSync.mkdirSync(dbDir, { recursive: true });
        }
        
        // Открываем базу данных
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        
        // Настраиваем параметры базы данных
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        
        // Создаем таблицы
        await createTables();
        
        // Создаем демо-данные
        await createDemoData();
        
        // Настраиваем вебхук
        await setupWebhook();
        
        console.log('🎉 База данных успешно инициализирована!');
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        console.error('Стек ошибки:', error.stack);
        
        // Пробуем создать временную базу в памяти как запасной вариант
        try {
            console.log('🔄 Пробуем создать временную базу данных в памяти...');
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            console.log('✅ Создана временная база данных в памяти');
            await db.run('PRAGMA foreign_keys = ON');
            await createTables();
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
                telegram_message_id INTEGER,
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
                telegram_message_id INTEGER,
                message_type TEXT DEFAULT 'contact' CHECK(message_type IN ('contact', 'renewal', 'question')),
                message TEXT NOT NULL,
                branch TEXT,
                student_name TEXT,
                status TEXT DEFAULT 'new' CHECK(status IN ('new', 'read', 'replied', 'closed')),
                admin_id INTEGER,
                admin_response TEXT,
                admin_response_message_id INTEGER,
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

        // Сессии пользователей для веб-интерфейса
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

        // Очередь уведомлений
        await db.exec(`
            CREATE TABLE IF NOT EXISTS notification_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_user_id INTEGER,
                message TEXT NOT NULL,
                message_type TEXT CHECK(message_type IN ('reminder', 'cancellation', 'news', 'broadcast', 'system')),
                data TEXT, -- JSON с дополнительными данными
                scheduled_for TIMESTAMP,
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'sent', 'failed')),
                retry_count INTEGER DEFAULT 0,
                error_message TEXT,
                sent_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(id) ON DELETE SET NULL
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

        // Проверяем, есть ли уже данные
        const adminExists = await db.get("SELECT 1 FROM administrators LIMIT 1");
        if (adminExists) {
            console.log('✅ Демо-данные уже существуют');
            return;
        }

        // Демо администраторы
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

        // Демо преподаватели
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

        // Демо расписание
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

        // Демо FAQ
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

        // Демо новости
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

        // Контакты филиалов
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

        console.log('🎉 Демо-данные успешно созданы!');
        
    } catch (error) {
        console.error('⚠️ Ошибка создания демо-данных:', error.message);
    }
};

// ==================== TELEGRAM БОТ КОМАНДЫ ====================

// Стартовая команда
bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const firstName = ctx.from.first_name || '';
    const lastName = ctx.from.last_name || '';
    const username = ctx.from.username || '';
    
    // Проверяем, зарегистрирован ли пользователь
    const user = await db.get(
        'SELECT * FROM telegram_users WHERE telegram_id = ?',
        [telegramId]
    );
    
    if (!user) {
        // Предлагаем авторизацию
        await ctx.replyWithHTML(
            `🎨 <b>Добро пожаловать в художественную студию!</b>\n\n` +
            `Для доступа к личному кабинету необходимо авторизоваться.\n\n` +
            `Пожалуйста, поделитесь своим номером телефона для поиска ваших абонементов:`,
            Markup.keyboard([
                [Markup.button.contactRequest('📱 Поделиться номером телефона')]
            ]).resize()
        );
    } else {
        // Показываем меню
        await showMainMenu(ctx);
    }
});

// Обработка контакта
bot.on('contact', async (ctx) => {
    const telegramId = ctx.from.id;
    const phoneNumber = ctx.message.contact.phone_number;
    const firstName = ctx.from.first_name || '';
    const lastName = ctx.from.last_name || '';
    const username = ctx.from.username || '';
    
    try {
        // Сохраняем/обновляем пользователя
        let user = await db.get(
            'SELECT * FROM telegram_users WHERE telegram_id = ?',
            [telegramId]
        );
        
        if (!user) {
            const result = await db.run(
                `INSERT INTO telegram_users (telegram_id, phone_number, first_name, last_name, username) 
                 VALUES (?, ?, ?, ?, ?)`,
                [telegramId, phoneNumber, firstName, lastName, username]
            );
            user = await db.get(
                'SELECT * FROM telegram_users WHERE id = ?',
                [result.lastID]
            );
            console.log(`✅ Новый пользователь: ${telegramId}`);
        } else {
            await db.run(
                `UPDATE telegram_users 
                 SET phone_number = ?, first_name = ?, last_name = ?, username = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [phoneNumber, firstName, lastName, username, user.id]
            );
        }
        
        // Ищем профили в amoCRM (демо версия)
        const amocrmResult = await findInAmocrmByPhone(phoneNumber);
        
        if (!amocrmResult.success || amocrmResult.data.profiles.length === 0) {
            await ctx.replyWithHTML(
                `❌ <b>Абонементы не найдены</b>\n\n` +
                `По вашему номеру телефона не найдены активные абонементы в художественной студии.\n\n` +
                `Пожалуйста, свяжитесь с администратором для уточнения информации.`,
                Markup.keyboard([
                    ['📞 Связаться с администратором'],
                    ['🏠 Главное меню']
                ]).resize()
            );
            return;
        }
        
        // Сохраняем профили
        const savedProfiles = await saveProfilesFromAmocrm(user.id, amocrmResult.data.profiles);
        
        if (savedProfiles.length === 1) {
            // Автоматически выбираем единственный профиль
            await db.run(
                'UPDATE student_profiles SET last_selected = 1 WHERE id = ?',
                [savedProfiles[0].id]
            );
            
            await ctx.replyWithHTML(
                `✅ <b>Авторизация успешна!</b>\n\n` +
                `Найден абонемент для <b>${savedProfiles[0].student_name}</b>\n` +
                `Филиал: <b>${savedProfiles[0].branch}</b>\n` +
                `Осталось занятий: <b>${savedProfiles[0].remaining_classes}</b>\n\n` +
                `Теперь вы можете использовать все функции личного кабинета.`,
                await getMainMenuKeyboard()
            );
        } else {
            // Предлагаем выбрать профиль
            await ctx.replyWithHTML(
                `✅ <b>Найдено несколько абонементов</b>\n\n` +
                `Пожалуйста, выберите подходящий профиль:`,
                await getProfilesKeyboard(savedProfiles)
            );
        }
        
    } catch (error) {
        console.error('Ошибка обработки контакта:', error);
        await ctx.reply(
            '❌ Произошла ошибка при обработке вашего номера телефона. Пожалуйста, попробуйте позже.'
        );
    }
});

// Команда меню
bot.command('menu', async (ctx) => {
    await showMainMenu(ctx);
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

async function showMainMenu(ctx) {
    const user = await getTelegramUser(ctx.from.id);
    if (!user) {
        await ctx.reply('Пожалуйста, сначала авторизуйтесь с помощью /start');
        return;
    }
    
    const profile = await getSelectedProfile(user.id);
    
    if (profile) {
        await ctx.replyWithHTML(
            `🎨 <b>Главное меню</b>\n\n` +
            `<b>Текущий профиль:</b> ${profile.student_name}\n` +
            `<b>Филиал:</b> ${profile.branch}\n` +
            `<b>Осталось занятий:</b> ${profile.remaining_classes}\n\n` +
            `Выберите действие:`,
            await getMainMenuKeyboard()
        );
    } else {
        const profiles = await db.all(
            'SELECT * FROM student_profiles WHERE telegram_user_id = ? AND is_active = 1',
            [user.id]
        );
        
        if (profiles.length === 0) {
            await ctx.replyWithHTML(
                `❌ <b>Абонементы не найдены</b>\n\n` +
                `У вас нет активных абонементов в художественной студии.\n\n` +
                `Для получения доступа свяжитесь с администратором.`,
                Markup.keyboard([
                    ['📞 Связаться с администратором'],
                    ['/start']
                ]).resize()
            );
        } else {
            await ctx.replyWithHTML(
                `👤 <b>Выберите профиль</b>\n\n` +
                `У вас найдено несколько абонементов. Пожалуйста, выберите профиль:`,
                await getProfilesKeyboard(profiles)
            );
        }
    }
}

async function getTelegramUser(telegramId) {
    return await db.get(
        'SELECT * FROM telegram_users WHERE telegram_id = ?',
        [telegramId]
    );
}

async function getSelectedProfile(telegramUserId) {
    return await db.get(
        'SELECT * FROM student_profiles WHERE telegram_user_id = ? AND last_selected = 1 AND is_active = 1',
        [telegramUserId]
    );
}

async function getMainMenuKeyboard() {
    return Markup.keyboard([
        ['📅 Расписание', '🎫 Мой абонемент'],
        ['👨‍🏫 Преподаватели', '📞 Связаться с администратором'],
        ['❓ Помощь', '🏠 Главное меню']
    ]).resize();
}

async function getProfilesKeyboard(profiles) {
    const buttons = profiles.map(profile => [
        Markup.button.callback(
            `${profile.student_name} (${profile.branch}) - ${profile.remaining_classes} занятий`,
            `profile_${profile.id}`
        )
    ]);
    
    buttons.push([Markup.button.callback('🏠 В меню', 'back_to_menu')]);
    
    return Markup.inlineKeyboard(buttons);
}

async function findInAmocrmByPhone(phoneNumber) {
    try {
        // Для демо возвращаем тестовые данные
        console.log(`🔍 Поиск в amoCRM по номеру: ${phoneNumber}`);
        
        // Тестовые данные для демо
        const demoProfiles = [
            {
                amo_contact_id: 1001,
                amo_deal_id: 2001,
                student_name: 'Иван Иванов',
                parent_name: 'Мария Иванова',
                phone_number: phoneNumber,
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
                amo_contact_id: 1002,
                amo_deal_id: 2002,
                student_name: 'Мария Сидорова',
                parent_name: 'Ольга Сидорова',
                phone_number: phoneNumber,
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
        
        return {
            success: true,
            data: {
                contact: { id: 1001, name: 'Родитель ученика' },
                profiles: demoProfiles,
                total_profiles: demoProfiles.length
            }
        };
        
    } catch (error) {
        console.error('Ошибка поиска в amoCRM:', error.message);
        return {
            success: false,
            error: 'Ошибка интеграции с amoCRM'
        };
    }
}

async function saveProfilesFromAmocrm(telegramUserId, profiles) {
    const savedProfiles = [];
    
    for (const profile of profiles) {
        // Проверяем существующий профиль
        const existingProfile = await db.get(
            `SELECT * FROM student_profiles 
             WHERE amo_deal_id = ? AND telegram_user_id = ?`,
            [profile.amo_deal_id, telegramUserId]
        );
        
        if (!existingProfile) {
            // Создаем новый профиль
            const result = await db.run(
                `INSERT INTO student_profiles 
                 (telegram_user_id, amo_contact_id, amo_deal_id, student_name, 
                  parent_name, phone_number, branch, subscription_type, 
                  total_classes, remaining_classes, expiration_date, 
                  teacher_name, day_of_week, time_slot) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    telegramUserId,
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
                [result.lastID]
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
    
    return savedProfiles;
}

// ==================== WEBHOOK НАСТРОЙКА ====================

async function setupWebhook() {
    try {
        const webhookUrl = `${DOMAIN}/webhook`;
        await bot.telegram.setWebhook(webhookUrl);
        console.log(`✅ Webhook установлен: ${webhookUrl}`);
    } catch (error) {
        console.error('❌ Ошибка установки webhook:', error.message);
    }
}

// ==================== API МАРШРУТЫ ====================

app.post('/webhook', (req, res) => {
    bot.handleUpdate(req.body, res);
});

// Тестовый маршрут
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Система художественной школы работает',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Получение расписания
app.get('/api/schedule/:branch', async (req, res) => {
    try {
        const { branch } = req.params;
        
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
        console.error('Ошибка получения расписания:', error.message);
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
        
        res.json({
            success: true,
            data: {
                faq: faq
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

// ==================== ЗАПУСК СЕРВЕРА ====================

const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Получаем информацию о боте
        try {
            const botInfo = await bot.telegram.getMe();
            console.log(`🤖 Telegram бот: @${botInfo.username}`);
        } catch (botError) {
            console.log('🤖 Telegram бот: Информация недоступна');
            console.log('⚠️  Проверьте токен бота');
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
            console.log('='.repeat(50));
            console.log('\n🎯 ОСНОВНЫЕ ФУНКЦИОНАЛЬНОСТИ:');
            console.log('='.repeat(60));
            console.log('✅ Telegram бот с меню и командами');
            console.log('✅ Система уведомлений и рассылок');
            console.log('✅ Админ-панель для управления рассылками');
            console.log('✅ Интеграция с amoCRM (демо)');
            console.log('✅ Расписание занятий');
            console.log('✅ Управление абонементами');
            console.log('✅ Каталог преподавателей');
            console.log('✅ FAQ и новости');
            console.log('✅ Связь с администратором');
            console.log('='.repeat(60));
            
            console.log('\n📱 КАК ИСПОЛЬЗОВАТЬ:');
            console.log('='.repeat(60));
            console.log('1. Откройте Telegram бота');
            console.log('2. Нажмите /start и поделитесь номером телефона');
            console.log('3. Выберите профиль (если несколько)');
            console.log('4. Используйте меню для навигации');
            console.log('5. Для админ-панели откройте веб-интерфейс');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        console.error('Стек ошибки:', error.stack);
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
