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
const { Telegraf, Markup, session } = require('telegraf');
const rateLimit = require('express-rate-limit');

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
const TELEGRAM_BOT_TOKEN = '8425388642:AAFpXOa7lYdGYmimJvxyDg2PXyLjlxYrSq4';

// Middleware для сессий
bot.use(session({ defaultSession: () => ({}) }));

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
        await setupWebhook();
        
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
        
        // Ищем профили в amoCRM
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

// Команда расписания
bot.command('schedule', async (ctx) => {
    const user = await getTelegramUser(ctx.from.id);
    if (!user) {
        await ctx.reply('Пожалуйста, сначала авторизуйтесь с помощью /start');
        return;
    }
    
    const profile = await getSelectedProfile(user.id);
    if (!profile) {
        await ctx.reply('У вас нет выбранного профиля. Пожалуйста, выберите профиль в меню.');
        return;
    }
    
    await showSchedule(ctx, profile);
});

// Команда абонемента
bot.command('subscription', async (ctx) => {
    const user = await getTelegramUser(ctx.from.id);
    if (!user) {
        await ctx.reply('Пожалуйста, сначала авторизуйтесь с помощью /start');
        return;
    }
    
    const profile = await getSelectedProfile(user.id);
    if (!profile) {
        await ctx.reply('У вас нет выбранного профиля. Пожалуйста, выберите профиль в меню.');
        return;
    }
    
    await showSubscription(ctx, profile);
});

// Команда преподавателей
bot.command('teachers', async (ctx) => {
    const user = await getTelegramUser(ctx.from.id);
    if (!user) {
        await ctx.reply('Пожалуйста, сначала авторизуйтесь с помощью /start');
        return;
    }
    
    const profile = await getSelectedProfile(user.id);
    if (!profile) {
        await ctx.reply('У вас нет выбранного профиля. Пожалуйста, выберите профиль в меню.');
        return;
    }
    
    await showTeachers(ctx, profile.branch);
});

// Команда помощи
bot.command('help', async (ctx) => {
    await ctx.replyWithHTML(
        `🎨 <b>Помощь по использованию бота художественной студии</b>\n\n` +
        `<b>Основные команды:</b>\n` +
        `/start - Начать работу с ботом\n` +
        `/menu - Показать главное меню\n` +
        `/schedule - Показать расписание\n` +
        `/subscription - Информация об абонементе\n` +
        `/teachers - Список преподавателей\n` +
        `/help - Эта справка\n\n` +
        `<b>Как это работает:</b>\n` +
        `1. При первом использовании поделитесь номером телефона\n` +
        `2. Система найдет ваши абонементы в художественной студии\n` +
        `3. Выберите нужный профиль (если их несколько)\n` +
        `4. Используйте меню для доступа к функциям\n\n` +
        `<b>Функции:</b>\n` +
        `• Просмотр расписания занятий\n` +
        `• Проверка остатка занятий\n` +
        `• История посещений\n` +
        `• Информация о преподавателях\n` +
        `• Связь с администратором\n` +
        `• Уведомления об изменениях\n\n` +
        `<b>Техническая поддержка:</b>\n` +
        `Если у вас возникли проблемы, напишите @art_school_support`
    );
});

// ==================== TELEGRAM БОТ МЕНЮ ====================

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

async function showSchedule(ctx, profile) {
    try {
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
            [profile.branch]
        );
        
        if (schedule.length === 0) {
            await ctx.reply(
                '📅 Расписание для вашего филиала пока не заполнено.'
            );
            return;
        }
        
        let message = `📅 <b>Расписание занятий - ${profile.branch}</b>\n\n`;
        
        const days = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
        
        for (const day of days) {
            const dayLessons = schedule.filter(lesson => lesson.day_of_week === day);
            
            if (dayLessons.length > 0) {
                message += `\n<b>${day.charAt(0).toUpperCase() + day.slice(1)}:</b>\n`;
                
                for (const lesson of dayLessons) {
                    const statusEmoji = lesson.status === 'cancelled' ? '❌' : 
                                       lesson.status === 'changed' ? '🔄' : '✅';
                    
                    message += `${statusEmoji} <b>${lesson.start_time}-${lesson.end_time}</b>\n`;
                    message += `   ${lesson.group_name}\n`;
                    message += `   Преподаватель: ${lesson.teacher_name}\n`;
                    message += `   Кабинет: ${lesson.room_number}\n`;
                    
                    if (lesson.status_note) {
                        message += `   📌 ${lesson.status_note}\n`;
                    }
                    
                    message += '\n';
                }
            }
        }
        
        await ctx.replyWithHTML(message, Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Обновить', 'refresh_schedule')],
            [Markup.button.callback('🏠 В меню', 'back_to_menu')]
        ]));
        
    } catch (error) {
        console.error('Ошибка показа расписания:', error);
        await ctx.reply('❌ Произошла ошибка при загрузке расписания.');
    }
}

async function showSubscription(ctx, profile) {
    try {
        // Получаем историю посещений
        const visits = await db.all(
            `SELECT * FROM attendance 
             WHERE student_profile_id = ?
             ORDER BY attendance_date DESC
             LIMIT 10`,
            [profile.id]
        );
        
        const usedClasses = profile.total_classes - profile.remaining_classes;
        const progressPercent = profile.total_classes > 0 ? 
            Math.round((usedClasses / profile.total_classes) * 100) : 0;
        
        let message = `🎫 <b>Мой абонемент</b>\n\n`;
        message += `<b>Ученик:</b> ${profile.student_name}\n`;
        message += `<b>Филиал:</b> ${profile.branch}\n`;
        message += `<b>Абонемент:</b> ${profile.subscription_type}\n`;
        message += `<b>Всего занятий:</b> ${profile.total_classes}\n`;
        message += `<b>Использовано:</b> ${usedClasses}\n`;
        message += `<b>Осталось:</b> ${profile.remaining_classes}\n`;
        
        if (profile.expiration_date) {
            const expDate = new Date(profile.expiration_date);
            const today = new Date();
            const daysLeft = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
            
            message += `<b>Срок действия:</b> ${expDate.toLocaleDateString('ru-RU')}\n`;
            message += `<b>Осталось дней:</b> ${daysLeft}\n`;
        }
        
        message += `\n<b>Прогресс:</b>\n`;
        message += `[${'█'.repeat(Math.floor(progressPercent/10))}${'░'.repeat(10 - Math.floor(progressPercent/10))}] ${progressPercent}%\n`;
        
        if (visits.length > 0) {
            message += `\n<b>Последние посещения:</b>\n`;
            for (const visit of visits.slice(0, 5)) {
                const date = new Date(visit.attendance_date);
                const statusEmoji = visit.status === 'attended' ? '✅' : 
                                   visit.status === 'missed' ? '❌' : '⏸️';
                message += `${statusEmoji} ${date.toLocaleDateString('ru-RU')} ${visit.attendance_time || ''}\n`;
            }
        }
        
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('📞 Связаться с администратором', 'contact_admin')],
            [Markup.button.callback('🔄 Обновить', 'refresh_subscription')],
            [Markup.button.callback('🏠 В меню', 'back_to_menu')]
        ]);
        
        await ctx.replyWithHTML(message, keyboard);
        
    } catch (error) {
        console.error('Ошибка показа абонемента:', error);
        await ctx.reply('❌ Произошла ошибка при загрузке информации об абонементе.');
    }
}

async function showTeachers(ctx, branch) {
    try {
        const teachers = await db.all(
            `SELECT * FROM teachers 
             WHERE is_active = 1 
               AND (branches LIKE ? OR branches LIKE '%"all"%' OR branches IS NULL)
             ORDER BY display_order, name`,
            [`%${branch}%`]
        );
        
        if (teachers.length === 0) {
            await ctx.reply('👨‍🏫 Информация о преподавателях вашего филиала пока не доступна.');
            return;
        }
        
        let message = `👨‍🏫 <b>Преподаватели - ${branch}</b>\n\n`;
        
        for (const teacher of teachers) {
            message += `<b>${teacher.name}</b>\n`;
            message += `${teacher.qualification}\n`;
            message += `<b>Специализация:</b> ${teacher.specialization}\n`;
            message += `<b>Опыт:</b> ${teacher.experience_years} лет\n\n`;
        }
        
        await ctx.replyWithHTML(message, Markup.inlineKeyboard([
            [Markup.button.callback('🏠 В меню', 'back_to_menu')]
        ]));
        
    } catch (error) {
        console.error('Ошибка показа преподавателей:', error);
        await ctx.reply('❌ Произошла ошибка при загрузке списка преподавателей.');
    }
}

// ==================== TELEGRAM БОТ ОБРАБОТЧИКИ ====================

// Обработка callback запросов
bot.on('callback_query', async (ctx) => {
    const callbackData = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    
    try {
        await ctx.answerCbQuery();
        
        const user = await getTelegramUser(userId);
        if (!user) return;
        
        switch (callbackData) {
            case 'back_to_menu':
                await showMainMenu(ctx);
                break;
                
            case 'refresh_schedule':
                const profile1 = await getSelectedProfile(user.id);
                if (profile1) {
                    await showSchedule(ctx, profile1);
                }
                break;
                
            case 'refresh_subscription':
                const profile2 = await getSelectedProfile(user.id);
                if (profile2) {
                    await showSubscription(ctx, profile2);
                }
                break;
                
            case 'contact_admin':
                const profile3 = await getSelectedProfile(user.id);
                if (profile3) {
                    await contactAdmin(ctx, profile3);
                }
                break;
                
            case 'select_profile':
                // Обработка выбора профиля
                const profiles = await db.all(
                    'SELECT * FROM student_profiles WHERE telegram_user_id = ? AND is_active = 1',
                    [user.id]
                );
                if (profiles.length > 0) {
                    await ctx.replyWithHTML(
                        `👤 <b>Выберите профиль:</b>`,
                        await getProfilesKeyboard(profiles)
                    );
                }
                break;
                
            default:
                if (callbackData.startsWith('profile_')) {
                    const profileId = parseInt(callbackData.replace('profile_', ''));
                    await selectProfile(ctx, user.id, profileId);
                }
                break;
        }
        
    } catch (error) {
        console.error('Ошибка обработки callback:', error);
        await ctx.reply('❌ Произошла ошибка. Пожалуйста, попробуйте еще раз.');
    }
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    
    const user = await getTelegramUser(userId);
    if (!user) return;
    
    switch (text) {
        case '🏠 Главное меню':
            await showMainMenu(ctx);
            break;
            
        case '📅 Расписание':
            const profile1 = await getSelectedProfile(user.id);
            if (profile1) {
                await showSchedule(ctx, profile1);
            } else {
                await ctx.reply('Пожалуйста, сначала выберите профиль.');
            }
            break;
            
        case '🎫 Мой абонемент':
            const profile2 = await getSelectedProfile(user.id);
            if (profile2) {
                await showSubscription(ctx, profile2);
            } else {
                await ctx.reply('Пожалуйста, сначала выберите профиль.');
            }
            break;
            
        case '👨‍🏫 Преподаватели':
            const profile3 = await getSelectedProfile(user.id);
            if (profile3) {
                await showTeachers(ctx, profile3.branch);
            } else {
                await ctx.reply('Пожалуйста, сначала выберите профиль.');
            }
            break;
            
        case '📞 Связаться с администратором':
            const profile4 = await getSelectedProfile(user.id);
            if (profile4) {
                await contactAdmin(ctx, profile4);
            } else {
                await ctx.reply('Пожалуйста, сначала выберите профиль.');
            }
            break;
            
        case '❓ Помощь':
            await ctx.replyWithHTML(
                `🎨 <b>Помощь по использованию бота</b>\n\n` +
                `Для навигации используйте кнопки меню:\n\n` +
                `• <b>Расписание</b> - просмотр занятий\n` +
                `• <b>Мой абонемент</b> - информация об абонементе\n` +
                `• <b>Преподаватели</b> - список преподавателей\n` +
                `• <b>Связь с администратором</b> - задать вопрос\n\n` +
                `Также вы можете использовать команды:\n` +
                `/start - начать работу\n` +
                `/menu - главное меню\n` +
                `/help - помощь\n\n` +
                `Для технической поддержки: @art_school_support`
            );
            break;
    }
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ БОТА ====================

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

async function selectProfile(ctx, telegramUserId, profileId) {
    try {
        // Сбрасываем все выбранные профили
        await db.run(
            'UPDATE student_profiles SET last_selected = 0 WHERE telegram_user_id = ?',
            [telegramUserId]
        );
        
        // Выбираем новый профиль
        await db.run(
            'UPDATE student_profiles SET last_selected = 1 WHERE id = ?',
            [profileId]
        );
        
        const profile = await db.get(
            'SELECT * FROM student_profiles WHERE id = ?',
            [profileId]
        );
        
        await ctx.replyWithHTML(
            `✅ <b>Профиль выбран!</b>\n\n` +
            `Теперь вы используете профиль <b>${profile.student_name}</b>\n` +
            `Филиал: <b>${profile.branch}</b>\n\n` +
            `Теперь вы можете просматривать расписание и информацию об абонементе.`,
            await getMainMenuKeyboard()
        );
        
    } catch (error) {
        console.error('Ошибка выбора профиля:', error);
        await ctx.reply('❌ Произошла ошибка при выборе профиля.');
    }
}

async function contactAdmin(ctx, profile) {
    try {
        // Получаем контакт администратора
        const contact = await db.get(
            'SELECT * FROM branch_contacts WHERE branch = ? AND is_active = 1',
            [profile.branch]
        );
        
        if (!contact) {
            await ctx.reply('❌ Контакты администратора не найдены.');
            return;
        }
        
        let message = `📞 <b>Связаться с администратором</b>\n\n`;
        message += `<b>Филиал:</b> ${profile.branch}\n`;
        message += `<b>Ученик:</b> ${profile.student_name}\n\n`;
        message += `<b>Контакты администратора:</b>\n`;
        
        if (contact.telegram_username) {
            message += `Telegram: ${contact.telegram_username}\n`;
        }
        
        if (contact.phone_number) {
            message += `Телефон: ${contact.phone_number}\n`;
        }
        
        if (contact.email) {
            message += `Email: ${contact.email}\n`;
        }
        
        if (contact.address) {
            message += `Адрес: ${contact.address}\n`;
        }
        
        if (contact.working_hours) {
            message += `Часы работы: ${contact.working_hours}\n`;
        }
        
        message += `\nВы можете написать администратору напрямую или использовать кнопку ниже:`;
        
        const keyboard = Markup.inlineKeyboard([
            contact.telegram_username ? 
                [Markup.button.url('💬 Написать в Telegram', `https://t.me/${contact.telegram_username.replace('@', '')}`)] : 
                [],
            contact.phone_number ? 
                [Markup.button.url('📞 Позвонить', `tel:${contact.phone_number}`)] : 
                [],
            [Markup.button.callback('🏠 В меню', 'back_to_menu')]
        ]);
        
        await ctx.replyWithHTML(message, keyboard);
        
        // Создаем запись в базе о запросе связи
        await db.run(
            `INSERT INTO admin_messages 
             (student_profile_id, telegram_user_id, message_type, message, branch, student_name) 
             VALUES (?, ?, 'contact', 'Пользователь запросил контакт администратора', ?, ?)`,
            [profile.id, profile.telegram_user_id, profile.branch, profile.student_name]
        );
        
    } catch (error) {
        console.error('Ошибка показа контактов администратора:', error);
        await ctx.reply('❌ Произошла ошибка при получении контактов администратора.');
    }
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

// ==================== СИСТЕМА УВЕДОМЛЕНИЙ И РАССЫЛОК ====================

// Функция отправки уведомления пользователю
async function sendNotification(telegramUserId, message, options = {}) {
    try {
        const user = await db.get(
            'SELECT * FROM telegram_users WHERE id = ?',
            [telegramUserId]
        );
        
        if (!user || !user.telegram_id) {
            throw new Error('Пользователь не найден');
        }
        
        const messageOptions = {
            parse_mode: 'HTML',
            ...options
        };
        
        const sentMessage = await bot.telegram.sendMessage(
            user.telegram_id,
            message,
            messageOptions
        );
        
        return {
            success: true,
            message_id: sentMessage.message_id
        };
        
    } catch (error) {
        console.error('Ошибка отправки уведомления:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// Функция отправки массовой рассылки
async function sendBroadcast(broadcastId) {
    try {
        const broadcast = await db.get(
            'SELECT * FROM broadcasts WHERE id = ?',
            [broadcastId]
        );
        
        if (!broadcast) {
            throw new Error('Рассылка не найдена');
        }
        
        // Получаем получателей по фильтрам
        let query = `
            SELECT DISTINCT sp.*, tu.telegram_id
            FROM student_profiles sp
            LEFT JOIN telegram_users tu ON sp.telegram_user_id = tu.id
            WHERE sp.is_active = 1 AND tu.telegram_id IS NOT NULL
        `;
        
        let params = [];
        
        if (broadcast.branches) {
            const branches = JSON.parse(broadcast.branches);
            if (branches.length > 0) {
                query += ` AND sp.branch IN (${branches.map(() => '?').join(',')})`;
                params.push(...branches);
            }
        }
        
        if (broadcast.teacher_ids) {
            const teacherIds = JSON.parse(broadcast.teacher_ids);
            if (teacherIds.length > 0) {
                const teachers = await db.all(
                    'SELECT name FROM teachers WHERE id IN (' + teacherIds.map(() => '?').join(',') + ')',
                    teacherIds
                );
                const teacherNames = teachers.map(t => t.name);
                if (teacherNames.length > 0) {
                    query += ` AND sp.teacher_name IN (${teacherNames.map(() => '?').join(',')})`;
                    params.push(...teacherNames);
                }
            }
        }
        
        if (broadcast.days_of_week) {
            const days = JSON.parse(broadcast.days_of_week);
            if (days.length > 0) {
                query += ` AND sp.day_of_week IN (${days.map(() => '?').join(',')})`;
                params.push(...days);
            }
        }
        
        const recipients = await db.all(query, params);
        
        if (recipients.length === 0) {
            await db.run(
                'UPDATE broadcasts SET status = "failed" WHERE id = ?',
                [broadcastId]
            );
            return {
                success: false,
                error: 'Нет получателей по заданным фильтрам'
            };
        }
        
        // Обновляем статус рассылки
        await db.run(
            `UPDATE broadcasts 
             SET status = 'sending', recipients_count = ?
             WHERE id = ?`,
            [recipients.length, broadcastId]
        );
        
        let sentCount = 0;
        let failedCount = 0;
        
        // Отправляем сообщения
        for (const recipient of recipients) {
            try {
                const result = await sendNotification(
                    recipient.telegram_user_id,
                    broadcast.message,
                    { parse_mode: 'HTML' }
                );
                
                if (result.success) {
                    sentCount++;
                    
                    // Логируем успешную отправку
                    await db.run(
                        `INSERT INTO broadcast_logs 
                         (broadcast_id, student_profile_id, telegram_user_id, telegram_message_id, status) 
                         VALUES (?, ?, ?, ?, 'sent')`,
                        [broadcastId, recipient.id, recipient.telegram_user_id, result.message_id]
                    );
                } else {
                    failedCount++;
                    
                    // Логируем ошибку
                    await db.run(
                        `INSERT INTO broadcast_logs 
                         (broadcast_id, student_profile_id, telegram_user_id, status, error_message) 
                         VALUES (?, ?, ?, 'failed', ?)`,
                        [broadcastId, recipient.id, recipient.telegram_user_id, result.error]
                    );
                }
                
                // Небольшая задержка чтобы не превысить лимиты Telegram
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`Ошибка отправки пользователю ${recipient.id}:`, error);
                failedCount++;
                
                await db.run(
                    `INSERT INTO broadcast_logs 
                     (broadcast_id, student_profile_id, telegram_user_id, status, error_message) 
                     VALUES (?, ?, ?, 'failed', ?)`,
                    [broadcastId, recipient.id, recipient.telegram_user_id, error.message]
                );
            }
        }
        
        // Обновляем финальный статус рассылки
        await db.run(
            `UPDATE broadcasts 
             SET status = 'sent', sent_count = ?, failed_count = ?, sent_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [sentCount, failedCount, broadcastId]
        );
        
        return {
            success: true,
            sent: sentCount,
            failed: failedCount,
            total: recipients.length
        };
        
    } catch (error) {
        console.error('Ошибка отправки рассылки:', error);
        
        await db.run(
            'UPDATE broadcasts SET status = "failed" WHERE id = ?',
            [broadcastId]
        );
        
        return {
            success: false,
            error: error.message
        };
    }
}

// ==================== AMOCRM ИНТЕГРАЦИЯ ====================

// Поиск в amoCRM по номеру телефона
async function findInAmocrmByPhone(phoneNumber) {
    try {
        // Для демо возвращаем тестовые данные
        // В реальном приложении здесь будет интеграция с amoCRM API
        
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

// ==================== EXPRESS НАСТРОЙКИ ====================

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

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100 // лимит запросов
});
app.use('/api/', limiter);

// ==================== WEBHOOK ДЛЯ TELEGRAM ====================

app.post('/webhook', (req, res) => {
    bot.handleUpdate(req.body, res);
});

// ==================== API ДЛЯ ВЕБ-ПРИЛОЖЕНИЯ ====================

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
        
        // Ищем профили в amoCRM
        const amocrmResult = await findInAmocrmByPhone(phone);
        
        if (!amocrmResult.success) {
            return res.status(404).json({
                success: false,
                error: amocrmResult.error || 'Профили не найдены в amoCRM'
            });
        }
        
        // Сохраняем найденные профили
        const savedProfiles = await saveProfilesFromAmocrm(telegramUser.id, amocrmResult.data.profiles);
        
        // Создаем JWT токен для веб-приложения
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
            message: 'Авторизация успешна',
            data: {
                user: telegramUser,
                profiles: savedProfiles,
                total_profiles: savedProfiles.length,
                token: token
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

// API для админ-панели
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
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
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

// Создание рассылки
app.post('/api/admin/broadcasts', adminAuthMiddleware, async (req, res) => {
    try {
        const { message, filters, type, title } = req.body;
        
        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Введите текст сообщения'
            });
        }
        
        // Проверяем права администратора
        const admin = await db.get(
            'SELECT * FROM administrators WHERE telegram_id = ? OR id = ?',
            [req.user.telegram_id, req.user.id]
        );
        
        if (!admin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        // Создаем рассылку
        const result = await db.run(
            `INSERT INTO broadcasts 
             (admin_id, broadcast_type, message_type, title, message, 
              branches, teacher_ids, days_of_week, filters_applied) 
             VALUES (?, 'service', ?, ?, ?, ?, ?, ?, ?)`,
            [
                admin.id,
                type || 'custom',
                title || 'Рассылка',
                message,
                filters?.branches ? JSON.stringify(filters.branches) : null,
                filters?.teacher_ids ? JSON.stringify(filters.teacher_ids) : null,
                filters?.days_of_week ? JSON.stringify(filters.days_of_week) : null,
                filters ? JSON.stringify(filters) : null
            ]
        );
        
        const broadcastId = result.lastID;
        
        // Запускаем рассылку в фоне
        setTimeout(() => {
            sendBroadcast(broadcastId).then(result => {
                console.log(`📤 Рассылка ${broadcastId} завершена:`, result);
            });
        }, 1000);
        
        res.json({
            success: true,
            message: 'Рассылка создана и запущена',
            data: {
                broadcast_id: broadcastId
            }
        });
        
    } catch (error) {
        console.error('Ошибка создания рассылки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания рассылки'
        });
    }
});

// Получение статистики рассылок
app.get('/api/admin/broadcasts/stats', adminAuthMiddleware, async (req, res) => {
    try {
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) as sending,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft
            FROM broadcasts
        `);
        
        const recentBroadcasts = await db.all(`
            SELECT b.*, a.name as admin_name
            FROM broadcasts b
            LEFT JOIN administrators a ON b.admin_id = a.id
            ORDER BY b.created_at DESC
            LIMIT 10
        `);
        
        res.json({
            success: true,
            data: {
                stats,
                recent_broadcasts: recentBroadcasts
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения статистики:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// Получение получателей по фильтрам
app.post('/api/admin/recipients/count', adminAuthMiddleware, async (req, res) => {
    try {
        const { branches, teacher_ids, days_of_week } = req.body;
        
        let query = `
            SELECT COUNT(DISTINCT tu.id) as count
            FROM student_profiles sp
            LEFT JOIN telegram_users tu ON sp.telegram_user_id = tu.id
            WHERE sp.is_active = 1 AND tu.telegram_id IS NOT NULL
        `;
        
        let params = [];
        
        if (branches && branches.length > 0) {
            query += ` AND sp.branch IN (${branches.map(() => '?').join(',')})`;
            params.push(...branches);
        }
        
        if (teacher_ids && teacher_ids.length > 0) {
            const teachers = await db.all(
                'SELECT name FROM teachers WHERE id IN (' + teacher_ids.map(() => '?').join(',') + ')',
                teacher_ids
            );
            const teacherNames = teachers.map(t => t.name);
            if (teacherNames.length > 0) {
                query += ` AND sp.teacher_name IN (${teacherNames.map(() => '?').join(',')})`;
                params.push(...teacherNames);
            }
        }
        
        if (days_of_week && days_of_week.length > 0) {
            query += ` AND sp.day_of_week IN (${days_of_week.map(() => '?').join(',')})`;
            params.push(...days_of_week);
        }
        
        const result = await db.get(query, params);
        
        res.json({
            success: true,
            data: {
                count: result.count,
                filters: { branches, teacher_ids, days_of_week }
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

// ==================== ОСНОВНОЙ API ====================

// Получение расписания
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
        
        // Получаем историю посещений
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
                visits: visits
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

// ==================== ЗАПУСК СЕРВЕРА ====================

const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}!`);
            console.log(`🌐 Доступ по адресу: http://localhost:${PORT}`);
            console.log(`🤖 Telegram бот: @${(await bot.telegram.getMe()).username}`);
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
            console.log('✅ Веб-интерфейс для учеников');
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
