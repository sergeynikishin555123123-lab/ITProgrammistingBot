// server.js - ВЕРСИЯ С УПРАВЛЕНИЕМ ЛОГОТИПОМ И УЛУЧШЕННЫМИ УВЕДОМЛЕНИЯМИ
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
const TelegramBot = require('node-telegram-bot-api');

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

// Настройки Telegram бота
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8425388642:AAFpXOa7lYdGYmimJvxyDg2PXyLjlxYrSq4';

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

// ==================== КЛАСС TELEGRAM БОТА ====================
class TelegramBotService {
    constructor() {
        this.setupBot();
    }

    setupBot() {
        if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your_telegram_bot_token') {
            console.log('⚠️ Telegram токен не настроен');
            this.bot = null;
            return;
        }

        try {
            console.log(`🤖 Запуск Telegram бота с токеном: ${TELEGRAM_BOT_TOKEN.substring(0, 10)}...`);
            
            // Простой polling режим
            this.bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
            
            console.log('✅ Telegram бот запущен в режиме polling');
            
            // Настраиваем обработчики
            this.setupHandlers();
            
        } catch (error) {
            console.error('❌ Ошибка запуска бота:', error.message);
            this.bot = null;
        }
    }

    setupHandlers() {
        if (!this.bot) return;

        // Команда /start
        this.bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const user = msg.from;
            
            console.log(`👤 /start от ${user.first_name} (chat_id: ${chatId})`);
            
            // Сохраняем пользователя
            await this.saveTelegramUser(chatId, user);
            
            // Отправляем приветственное сообщение с кнопкой
            await this.bot.sendMessage(chatId, 
                `🎨 *Добро пожаловать в Школу рисования Баня!*\n\n` +
                `Для входа в личный кабинет нажмите кнопку ниже:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '📱 Открыть личный кабинет',
                                    web_app: { url: DOMAIN }
                                }
                            ],
                            [
                                {
                                    text: '📞 Отправить номер телефона',
                                    callback_data: 'send_phone'
                                }
                            ]
                        ]
                    }
                }
            );
        });

        // Обработка callback кнопок
        this.bot.on('callback_query', async (callbackQuery) => {
            const chatId = callbackQuery.message.chat.id;
            const data = callbackQuery.data;
            
            if (data === 'send_phone') {
                await this.bot.sendMessage(chatId,
                    `📱 *Отправьте номер телефона*\n\n` +
                    `Введите ваш номер телефона в формате:\n` +
                    `*79991234567*\n\n` +
                    `Бот проверит ваш абонемент и отправит данные.`,
                    { parse_mode: 'Markdown' }
                );
            }
            
            // Подтверждаем callback
            await this.bot.answerCallbackQuery(callbackQuery.id);
        });

        // Обработка номеров телефона
        this.bot.on('message', async (msg) => {
            if (!msg.text || msg.text.startsWith('/')) return;
            
            const chatId = msg.chat.id;
            const text = msg.text;
            const cleanText = text.replace(/\D/g, '');
            
            // Если сообщение похоже на телефон (10-11 цифр)
            if (cleanText.length >= 10 && cleanText.length <= 11) {
                console.log(`📱 Получен телефон от ${chatId}: ${cleanText}`);
                
                // Форматируем телефон
                let phone = cleanText;
                if (phone.length === 10) {
                    phone = '7' + phone; // Добавляем 7 для российских номеров
                } else if (phone.startsWith('8')) {
                    phone = '7' + phone.substring(1); // Меняем 8 на 7
                }
                
                await this.handlePhoneInput(chatId, phone);
            }
        });

        // Обработка ошибок
        this.bot.on('polling_error', (error) => {
            console.error('❌ Ошибка polling Telegram:', error.message);
        });

        console.log('✅ Обработчики команд установлены');
    }

    async saveTelegramUser(chatId, userInfo) {
        try {
            await db.run(`
                INSERT OR REPLACE INTO telegram_users 
                (chat_id, username, first_name, last_name, language_code, is_active, last_activity)
                VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
            `, [
                chatId,
                userInfo.username || null,
                userInfo.first_name || null,
                userInfo.last_name || null,
                userInfo.language_code || null
            ]);
            
            console.log(`✅ Пользователь сохранен: ${userInfo.first_name} (chat_id: ${chatId})`);
            
        } catch (error) {
            console.error('❌ Ошибка сохранения пользователя:', error.message);
        }
    }

    async handlePhoneInput(chatId, phone) {
        try {
            await this.bot.sendMessage(chatId, `🔍 *Ищу профили для телефона:* ${this.formatPhoneNumber(phone)}...`, 
                { parse_mode: 'Markdown' });
            
            // Ищем профили в базе данных
            const cleanPhone = phone.replace(/\D/g, '');
            const profiles = await db.all(`
                SELECT student_name, branch, subscription_status, total_classes, 
                       subscription_active, remaining_classes
                FROM student_profiles 
                WHERE phone_number LIKE ? AND is_active = 1
                ORDER BY subscription_active DESC
                LIMIT 5
            `, [`%${cleanPhone.slice(-10)}%`]);
            
            if (profiles.length === 0) {
                await this.bot.sendMessage(chatId,
                    `❌ *Профили не найдены*\n\n` +
                    `Для телефона: ${this.formatPhoneNumber(phone)}\n\n` +
                    `Если вы считаете, что это ошибка:\n` +
                    `1. Проверьте правильность номера\n` +
                    `2. Обратитесь к администратору\n` +
                    `3. Перейдите в личный кабинет:`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                {
                                    text: '📱 Открыть личный кабинет',
                                    web_app: { url: DOMAIN }
                                }
                            ]]
                        }
                    }
                );
                return;
            }
            
            // Формируем сообщение с найденными профилями
            let message = `📋 *Найдено профилей: ${profiles.length}*\n\n`;
            
            profiles.forEach((profile, index) => {
                message += `*${index + 1}. ${profile.student_name}*\n`;
                message += `📍 Филиал: ${profile.branch || 'Не указан'}\n`;
                message += `🎫 Абонемент: ${profile.subscription_status}\n`;
                message += `📊 Занятий: ${profile.total_classes} (осталось: ${profile.remaining_classes})\n`;
                message += `🔵 Статус: ${profile.subscription_active === 1 ? '✅ Активен' : '❌ Не активен'}\n\n`;
            });
            
            message += `Для входа в личный кабинет и получения полной информации:`;
            
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '📱 Открыть личный кабинет',
                            web_app: { url: DOMAIN }
                        }
                    ]]
                }
            });
            
        } catch (error) {
            console.error('❌ Ошибка обработки телефона:', error);
            await this.bot.sendMessage(chatId, 
                '❌ Произошла ошибка при поиске профилей. Попробуйте позже.');
        }
    }

    formatPhoneNumber(phone) {
        const clean = phone.replace(/\D/g, '');
        if (clean.length === 11) {
            return `+7 (${clean.substring(1, 4)}) ${clean.substring(4, 7)}-${clean.substring(7, 9)}-${clean.substring(9, 11)}`;
        }
        return phone;
    }

    async sendNotificationToBranch(branch, message, excludeChatIds = []) {
        console.log(`\n🚀 ОТПРАВКА УВЕДОМЛЕНИЯ ДЛЯ ФИЛИАЛА: "${branch}"`);
        
        if (!this.bot) {
            console.log('❌ Telegram бот не доступен');
            return 0;
        }
        
        try {
            // 1. Получаем chat_id пользователей
            let users = [];
            
            if (branch === 'all') {
                // Все активные пользователи
                users = await db.all(`
                    SELECT DISTINCT chat_id 
                    FROM telegram_users 
                    WHERE is_active = 1
                    AND chat_id NOT IN (${excludeChatIds.map(() => '?').join(',')})
                `, excludeChatIds);
            } else {
                // Пользователи конкретного филиала
                users = await db.all(`
                    SELECT DISTINCT tu.chat_id 
                    FROM telegram_users tu
                    LEFT JOIN student_profiles sp ON tu.username = sp.phone_number
                    WHERE tu.is_active = 1
                    AND (sp.branch = ? OR sp.branch LIKE ? OR ? = 'all')
                    AND tu.chat_id NOT IN (${excludeChatIds.map(() => '?').join(',')})
                `, [branch, `%${branch}%`, branch, ...excludeChatIds]);
            }
            
            console.log(`👥 Найдено пользователей для отправки: ${users.length}`);
            
            if (users.length === 0) {
                console.log('⚠️  Нет пользователей для отправки. Возможные причины:');
                console.log('   • Пользователи не отправили /start боту');
                console.log('   • В таблице telegram_users нет записей');
                console.log('   • Все пользователи неактивны (is_active = 0)');
                return 0;
            }
            
            // 2. Отправляем сообщения
            let sentCount = 0;
            let failedCount = 0;
            const failedUsers = [];
            
            for (const user of users) {
                try {
                    await this.bot.sendMessage(
                        user.chat_id,
                        `📢 *Уведомление от Школы рисования*\n\n` +
                        `${message}\n\n` +
                        `_Не отвечайте на это сообщение_`,
                        { 
                            parse_mode: 'Markdown',
                            disable_web_page_preview: true 
                        }
                    );
                    
                    sentCount++;
                    
                    // Задержка между отправками (100 мс)
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    failedCount++;
                    failedUsers.push({
                        chat_id: user.chat_id,
                        error: error.message
                    });
                    
                    console.error(`❌ Ошибка отправки в chat_id ${user.chat_id}:`, error.message);
                    
                    // Если пользователь заблокировал бота (403) или чат не найден
                    if (error.response?.statusCode === 403 || error.response?.statusCode === 400) {
                        await db.run(
                            'UPDATE telegram_users SET is_active = 0 WHERE chat_id = ?',
                            [user.chat_id]
                        );
                        console.log(`   👤 Пользователь ${user.chat_id} деактивирован`);
                    }
                }
            }
            
            console.log(`📊 ИТОГ РАССЫЛКИ:`);
            console.log(`   ✅ Успешно отправлено: ${sentCount}`);
            console.log(`   ❌ Не отправлено: ${failedCount}`);
            
            if (failedUsers.length > 0) {
                console.log('   🐛 Ошибки отправки:');
                failedUsers.slice(0, 5).forEach(fu => {
                    console.log(`      chat_id ${fu.chat_id}: ${fu.error}`);
                });
            }
            
            return sentCount;
            
        } catch (error) {
            console.error('❌ Общая ошибка отправки уведомлений:', error);
            return 0;
        }
    }

    // Новый метод для отправки персонализированных уведомлений
    async sendPersonalizedNotification(chatId, message, userName = '') {
        if (!this.bot) {
            console.log('❌ Telegram бот не доступен');
            return false;
        }
        
        try {
            let personalizedMessage = `👋 *Привет${userName ? ', ' + userName : ''}!*\n\n`;
            personalizedMessage += `${message}\n\n`;
            personalizedMessage += `_Не отвечайте на это сообщение_`;
            
            await this.bot.sendMessage(
                chatId,
                personalizedMessage,
                { 
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true 
                }
            );
            
            console.log(`✅ Персонализированное уведомление отправлено в chat_id ${chatId}`);
            return true;
            
        } catch (error) {
            console.error(`❌ Ошибка отправки в chat_id ${chatId}:`, error.message);
            
            // Если пользователь заблокировал бота, деактивируем его
            if (error.response?.statusCode === 403 || error.response?.statusCode === 400) {
                await db.run(
                    'UPDATE telegram_users SET is_active = 0 WHERE chat_id = ?',
                    [chatId]
                );
                console.log(`   👤 Пользователь ${chatId} деактивирован`);
            }
            
            return false;
        }
    }
}

// ==================== УЛУЧШЕННЫЙ КЛАСС AMOCRM ====================
class AmoCrmService {
    // ... (остальной код AmoCrmService остается без изменений) ...
}

// Создаем экземпляры сервисов
const amoCrmService = new AmoCrmService();
const telegramBot = new TelegramBotService();

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
        
        // Существующие таблицы
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

        await db.exec(`
            CREATE TABLE IF NOT EXISTS telegram_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id BIGINT UNIQUE NOT NULL,
                username TEXT,
                first_name TEXT,
                last_name TEXT,
                language_code TEXT,
                is_active INTEGER DEFAULT 1,
                last_activity TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица telegram_users создана');

        await db.run('CREATE INDEX IF NOT EXISTS idx_telegram_users_username ON telegram_users(username)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_telegram_users_active ON telegram_users(is_active)');

        // Дополнительные таблицы для админ-панели
        await db.exec(`
            CREATE TABLE IF NOT EXISTS teachers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                photo_url TEXT,
                branch TEXT NOT NULL,
                specialization TEXT,
                experience INTEGER DEFAULT 0,
                education TEXT,
                description TEXT,
                email TEXT,
                is_active INTEGER DEFAULT 1,
                display_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица teachers создана');

        await db.exec(`
            CREATE TABLE IF NOT EXISTS schedule (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE NOT NULL,
                time TEXT NOT NULL,
                branch TEXT NOT NULL,
                teacher_id INTEGER,
                group_name TEXT,
                age_group TEXT,
                status TEXT DEFAULT 'active',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (teacher_id) REFERENCES teachers(id)
            )
        `);
        console.log('✅ Таблица schedule создана');

        await db.exec(`
            CREATE TABLE IF NOT EXISTS faq (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                display_order INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица faq создана');

        await db.exec(`
            CREATE TABLE IF NOT EXISTS news (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                image_url TEXT,
                branch TEXT DEFAULT 'all',
                publish_date DATE,
                views INTEGER DEFAULT 0,
                is_published INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица news создана');

        await db.exec(`
            CREATE TABLE IF NOT EXISTS mailings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                name TEXT,
                segment TEXT,
                branch TEXT,
                teacher TEXT,
                day TEXT,
                message TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                recipients_count INTEGER DEFAULT 0,
                sent_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0,
                scheduled_for TIMESTAMP,
                sent_at TIMESTAMP,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES admins(id)
            )
        `);
        console.log('✅ Таблица mailings создана');

        await db.exec(`
            CREATE TABLE IF NOT EXISTS system_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                user_id INTEGER,
                ip_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица system_logs создана');

        await db.exec(`
            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT DEFAULT 'admin',
                branch TEXT DEFAULT 'all',
                permissions TEXT DEFAULT '[]',
                is_active INTEGER DEFAULT 1,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица admins создана');

        // НОВАЯ ТАБЛИЦА: Настройки приложения (включая логотип)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT,
                setting_type TEXT DEFAULT 'text',
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица app_settings создана');

        // Тестовый администратор (если нет)
        try {
            const existingAdmin = await db.get('SELECT id FROM admins WHERE email = ?', ['admin@artschool.ru']);
            if (!existingAdmin) {
                // В реальном приложении пароль должен быть захэширован
                await db.run(`
                    INSERT INTO admins (name, email, password_hash, role, permissions)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    'Администратор',
                    'admin@artschool.ru',
                    '$2b$10$YourHashedPasswordHere', // В реальном приложении используйте bcrypt
                    'admin',
                    '["all"]'
                ]);
                console.log('👤 Тестовый администратор создан');
            }
        } catch (error) {
            console.log('⚠️ Ошибка создания тестового администратора:', error.message);
        }
        
        // Добавляем настройки по умолчанию (если их нет)
        try {
            const defaultSettings = [
                ['logo_image', '', 'image', 'Логотип школы (base64 или URL)'],
                ['school_name', 'БАНЯ', 'text', 'Название школы'],
                ['primary_color', '#ff6b35', 'color', 'Основной цвет'],
                ['secondary_color', '#0066FF', 'color', 'Второстепенный цвет']
            ];
            
            for (const [key, value, type, desc] of defaultSettings) {
                await db.run(`
                    INSERT OR IGNORE INTO app_settings (setting_key, setting_value, setting_type, description)
                    VALUES (?, ?, ?, ?)
                `, [key, value, type, desc]);
            }
            
            console.log('⚙️  Настройки по умолчанию добавлены');
        } catch (settingsError) {
            console.log('⚠️  Ошибка создания настроек по умолчанию:', settingsError.message);
        }
        
        console.log('\n🎉 Все таблицы созданы успешно!');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
// Функция для подсчета получателей рассылки
async function getMailingRecipientsCount(mailing) {
    try {
        let query = '';
        let params = [];
        
        if (mailing.type === 'telegram_notification') {
            // Для Telegram уведомлений по филиалу
            if (mailing.branch && mailing.branch !== 'all') {
                query = `
                    SELECT COUNT(DISTINCT tu.chat_id) as count
                    FROM telegram_users tu
                    JOIN student_profiles sp ON tu.username = sp.phone_number
                    WHERE sp.branch = ? AND tu.is_active = 1
                `;
                params = [mailing.branch];
            } else {
                query = 'SELECT COUNT(*) as count FROM telegram_users WHERE is_active = 1';
            }
        } else if (mailing.segment) {
            // Для сегментированных рассылок
            const segment = mailing.segment;
            query = 'SELECT COUNT(*) as count FROM student_profiles WHERE is_active = 1';
            
            if (segment === 'active') {
                query += ' AND subscription_active = 1';
            } else if (segment === 'expiring') {
                query += ' AND subscription_active = 1 AND expiration_date IS NOT NULL AND expiration_date <= date("now", "+30 days")';
            } else if (segment === 'expired') {
                query += ' AND subscription_active = 0';
            } else if (segment === 'inactive') {
                query += ' AND last_visit_date IS NULL OR last_visit_date < date("now", "-30 days")';
            } else if (segment === 'branch_sviblovo') {
                query += ' AND branch = "Свиблово"';
            } else if (segment === 'branch_chertanovo') {
                query += ' AND branch = "Чертаново"';
            }
        }
        
        if (query) {
            const result = await db.get(query, params);
            return {
                total: result?.count || 0,
                estimated: mailing.recipients_count || 0
            };
        }
        
        return { total: 0, estimated: mailing.recipients_count || 0 };
        
    } catch (error) {
        console.error('❌ Ошибка подсчета получателей:', error.message);
        return { total: 0, estimated: mailing.recipients_count || 0 };
    }
}

async function saveProfilesToDatabase(profiles) {
    try {
        console.log(`💾 Сохранение профилей в БД...`);
        let savedCount = 0;
        let updatedCount = 0;
        
        for (const profile of profiles) {
            try {
                const existingProfile = await db.get(
                    `SELECT id, subscription_type, subscription_status, subscription_active, 
                            total_classes, used_classes, remaining_classes, updated_at
                     FROM student_profiles 
                     WHERE student_name = ? AND phone_number = ?`,
                    [profile.student_name, profile.phone_number]
                );
                
                // Сравниваем данные абонемента
                const isSameSubscription = existingProfile && 
                    existingProfile.subscription_type === profile.subscription_type &&
                    existingProfile.subscription_status === profile.subscription_status &&
                    existingProfile.subscription_active === profile.subscription_active &&
                    existingProfile.total_classes === profile.total_classes &&
                    existingProfile.used_classes === profile.used_classes &&
                    existingProfile.remaining_classes === profile.remaining_classes;
                
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
                    // Новый профиль
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    savedCount++;
                    console.log(`   ✅ Создан новый профиль: ${profile.student_name}`);
                } else {
                    // Существующий профиль - ОБНОВЛЯЕМ ВСЕ ПОЛЯ
                    const setClause = columns.map(col => `${col} = ?`).join(', ');
                    
                    await db.run(
                        `UPDATE student_profiles SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [...values, existingProfile.id]
                    );
                    
                    if (isSameSubscription) {
                        console.log(`   🔄 Обновлен профиль (без изменений абонемента): ${profile.student_name}`);
                    } else {
                        console.log(`   🔄 ОБНОВЛЕН АБОНЕМЕНТ: ${profile.student_name}`);
                        console.log(`      Было: ${existingProfile.subscription_type} (${existingProfile.used_classes}/${existingProfile.total_classes})`);
                        console.log(`      Стало: ${profile.subscription_type} (${profile.used_classes}/${profile.total_classes})`);
                        updatedCount++;
                    }
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка сохранения профиля:`, profileError.message);
            }
        }
        
        console.log(`✅ Сохранено новых: ${savedCount}, Обновлено: ${updatedCount}, Всего: ${savedCount + updatedCount}`);
        return savedCount + updatedCount;
        
    } catch (error) {
        console.error(`❌ Общая ошибка сохранения профилей: ${error.message}`);
        return 0;
    }
}

// Добавить вспомогательную функцию
function formatDateForDisplay(dateStr) {
    if (!dateStr) return '';
    
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        
        return `${day}.${month}.${year}`;
    } catch (error) {
        return dateStr;
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

// Middleware для проверки токена пользователя
function verifyToken(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Токен не предоставлен'
        });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('❌ Ошибка проверки токена:', error.message);
        return res.status(401).json({
            success: false,
            error: 'Недействительный токен'
        });
    }
}

// Middleware для проверки токена администратора
function verifyAdminToken(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Токен не предоставлен'
        });
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (error) {
        console.error('❌ Ошибка проверки токена администратора:', error.message);
        return res.status(401).json({
            success: false,
            error: 'Недействительный токен'
        });
    }
}

// ==================== API МАРШРУТЫ ====================

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '4.3.0',
        amocrm_connected: amoCrmService.isInitialized,
        telegram_bot_connected: telegramBot.bot !== null,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        data_source: amoCrmService.isInitialized ? 'Реальные данные из amoCRM' : 'Локальные данные'
    });
});

// ==================== API ДЛЯ УПРАВЛЕНИЯ НАСТРОЙКАМИ (ЛОГОТИП И ДР.) ====================

// Получение всех настроек для админ-панели
app.get('/api/admin/settings', verifyAdminToken, async (req, res) => {
    try {
        console.log('⚙️  Получение настроек приложения');
        
        const settings = await db.all('SELECT * FROM app_settings ORDER BY id');
        
        // Обрабатываем логотип - если это base64, добавляем data URL
        const processedSettings = settings.map(setting => {
            if (setting.setting_key === 'logo_image' && setting.setting_value) {
                // Проверяем, не является ли уже data URL
                if (!setting.setting_value.startsWith('data:image')) {
                    // Добавляем data URL префикс для фронтенда
                    return {
                        ...setting,
                        setting_value: `data:image/png;base64,${setting.setting_value}`
                    };
                }
            }
            return setting;
        });
        
        res.json({
            success: true,
            data: {
                settings: processedSettings
            }
        });
    } catch (error) {
        console.error('❌ Ошибка получения настроек:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения настроек'
        });
    }
});

// Обновление настройки
app.post('/api/admin/settings', verifyAdminToken, async (req, res) => {
    try {
        const { key, value, type, description } = req.body;
        
        console.log(`⚙️  Обновление настройки: ${key}`);
        
        if (!key) {
            return res.status(400).json({
                success: false,
                error: 'Не указан ключ настройки'
            });
        }
        
        // Обрабатываем логотип (удаляем data URL часть если есть)
        let processedValue = value;
        if (key === 'logo_image' && value && value.startsWith('data:image')) {
            // Извлекаем только base64 часть
            const parts = value.split(',');
            if (parts.length > 1) {
                processedValue = parts[1];
                console.log('📸 Логотип сохранен (base64)');
            }
        }
        
        await db.run(`
            INSERT OR REPLACE INTO app_settings (setting_key, setting_value, setting_type, description, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [key, processedValue, type || 'text', description || '']);
        
        // Логируем изменение
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'settings',
            'info',
            `Настройка "${key}" обновлена`,
            req.admin?.admin_id || 1
        ]);
        
        res.json({
            success: true,
            message: 'Настройка сохранена'
        });
    } catch (error) {
        console.error('❌ Ошибка сохранения настроек:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения настроек'
        });
    }
});

// Получение логотипа и названия школы для фронтенда
app.get('/api/logo', async (req, res) => {
    try {
        const logoSetting = await db.get(
            'SELECT setting_value FROM app_settings WHERE setting_key = ?',
            ['logo_image']
        );
        
        const nameSetting = await db.get(
            'SELECT setting_value FROM app_settings WHERE setting_key = ?',
            ['school_name']
        );
        
        const primaryColorSetting = await db.get(
            'SELECT setting_value FROM app_settings WHERE setting_key = ?',
            ['primary_color']
        );
        
        const secondaryColorSetting = await db.get(
            'SELECT setting_value FROM app_settings WHERE setting_key = ?',
            ['secondary_color']
        );
        
        // Формируем полный data URL для логотипа
        let logoUrl = '';
        if (logoSetting?.setting_value) {
            if (logoSetting.setting_value.startsWith('data:image')) {
                logoUrl = logoSetting.setting_value;
            } else if (logoSetting.setting_value.trim() !== '') {
                logoUrl = `data:image/png;base64,${logoSetting.setting_value}`;
            }
        }
        
        res.json({
            success: true,
            data: {
                logo: logoUrl,
                name: nameSetting?.setting_value || 'БАНЯ',
                primary_color: primaryColorSetting?.setting_value || '#ff6b35',
                secondary_color: secondaryColorSetting?.setting_value || '#0066FF'
            }
        });
    } catch (error) {
        console.error('❌ Ошибка получения логотипа:', error.message);
        res.json({
            success: true,
            data: {
                logo: '',
                name: 'БАНЯ',
                primary_color: '#ff6b35',
                secondary_color: '#0066FF'
            }
        });
    }
});

// ==================== АУТЕНТИФИКАЦИЯ И ПРОЧИЕ API ====================

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
        
        let profiles = [];
        
        if (amoCrmService.isInitialized) {
            console.log('🔍 Поиск в amoCRM...');
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            console.log(`📊 Найдено профилей в amoCRM: ${profiles.length}`);
            
            if (profiles.length > 0) {
                await saveProfilesToDatabase(profiles);
            }
        }
        
        if (profiles.length === 0) {
            console.log('🔍 Поиск в локальной базе данных...');
            const cleanPhone = phone.replace(/\D/g, '');
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY 
                   CASE 
                     WHEN subscription_active = 1 THEN 1
                     WHEN subscription_badge = 'active' THEN 2
                     WHEN subscription_badge = 'pending' THEN 3
                     WHEN subscription_badge = 'has_subscription' THEN 4
                     ELSE 5
                   END,
                   total_classes DESC,
                   updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            console.log(`📊 Найдено профилей в локальной БД: ${profiles.length}`);
        }
        
        // УДАЛЕН СОЗДАНИЕ ДЕМО-ПРОФИЛЯ
        if (profiles.length === 0) {
            console.log('⚠️ Профили не найдены ни в amoCRM, ни в локальной БД');
            return res.status(404).json({
                success: false,
                error: 'Профили не найдены. Проверьте номер телефона или обратитесь к администратору.',
                error_code: 'PROFILE_NOT_FOUND'
            });
        }
        
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            first_name: profiles.length > 0 ? profiles[0].student_name?.split(' ')[0] || 'Ученик' : 'Гость',
            is_temp: true,
            profiles_count: profiles.length
        };
        
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
            remaining_classes: p.remaining_classes || 0,
            used_classes: p.used_classes || 0,
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            parent_name: p.parent_name,
            is_demo: p.is_demo === 1,
            source: p.source,
            // Добавляем расчетные поля для фронтенда
            progress_percentage: p.total_classes > 0 ? 
                Math.round(((p.used_classes || 0) / p.total_classes) * 100) : 0,
            has_visits: (p.used_classes || 0) > 0,
            activation_date_formatted: p.activation_date ? 
                formatDateForDisplay(p.activation_date) : 'Не указано',
            expiration_date_formatted: p.expiration_date ? 
                formatDateForDisplay(p.expiration_date) : 'Не указано',
            last_visit_date_formatted: p.last_visit_date ? 
                formatDateForDisplay(p.last_visit_date) : 'Не указано'
        }));
        
        const hasRealData = profiles.some(p => p.source === 'amocrm' && p.is_demo === 0);
        const hasMultipleStudents = profiles.length > 1;
        
        const responseData = {
            success: true,
            message: profiles.length > 0 
                ? hasRealData ? 'Найдены реальные профили учеников' : 'Найдены профили учеников'
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

// ==================== API ДЛЯ ФРОНТЕНДА ====================

// Получение профиля пользователя
app.get('/api/profile', verifyToken, async (req, res) => {
    try {
        const { student_name } = req.query;
        
        if (!student_name) {
            return res.status(400).json({
                success: false,
                error: 'Не указано имя ученика'
            });
        }
        
        const profile = await db.get(
            `SELECT * FROM student_profiles 
             WHERE student_name = ? AND is_active = 1`,
            [student_name]
        );
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Профиль не найден'
            });
        }
        
        res.json({
            success: true,
            data: {
                profile: profile
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения профиля:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профиля'
        });
    }
});

app.get('/api/schedule/student/:branch', async (req, res) => {
    try {
        const { branch } = req.params;
        const { week_start } = req.query;
        
        console.log(`📅 Расписание для филиала: ${branch}`);
        
        let query = `
            SELECT s.*, t.name as teacher_name, t.photo_url as teacher_photo
            FROM schedule s
            LEFT JOIN teachers t ON s.teacher_id = t.id
            WHERE s.branch = ? AND s.status = 'active'
        `;
        const params = [branch];
        
        if (week_start) {
            query += ` AND s.date >= ? AND s.date <= date(?, '+7 days')`;
            params.push(week_start, week_start);
        } else {
            // Показываем занятия на 2 недели вперед
            query += ` AND s.date >= date('now', '-1 day') 
                       AND s.date <= date('now', '+14 days')`;
        }
        
        query += ` ORDER BY s.date, s.time`;
        
        const schedule = await db.all(query, params);
        
        // Группируем по дням для удобного отображения
        const scheduleByDay = {};
        schedule.forEach(lesson => {
            const date = lesson.date;
            if (!scheduleByDay[date]) {
                scheduleByDay[date] = [];
            }
            
            // Определяем статус для отображения
            let statusText = 'Запланировано';
            let statusType = 'normal';
            
            if (lesson.status === 'cancelled') {
                statusText = 'Отменено';
                statusType = 'cancelled';
            } else if (lesson.status === 'rescheduled') {
                statusText = 'Перенесено';
                statusType = 'rescheduled';
            } else if (lesson.status === 'replacement') {
                statusText = 'Замена преподавателя';
                statusType = 'replacement';
            }
            
            scheduleByDay[date].push({
                id: lesson.id,
                time: lesson.time,
                teacher: lesson.teacher_name || 'Преподаватель не указан',
                teacher_photo: lesson.teacher_photo,
                group: lesson.group_name || '',
                ageGroup: lesson.age_group || '',
                status: {
                    text: statusText,
                    type: statusType
                },
                notes: lesson.notes || ''
            });
        });
        
        // Преобразуем объект в массив для фронтенда
        const scheduleArray = Object.entries(scheduleByDay).map(([date, lessons]) => ({
            day: formatDateForDisplay(date),
            date: date,
            lessons: lessons
        }));
        
        res.json({
            success: true,
            data: {
                schedule: scheduleArray,
                branch: branch,
                total_lessons: schedule.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения расписания:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения расписания'
        });
    }
});

// Получение преподавателей для фронтенда
app.get('/api/teachers/student/:branch', async (req, res) => {
    try {
        const { branch } = req.params;
        
        console.log(`👨‍🏫 Преподаватели для филиала: ${branch}`);
        
        const teachers = await db.all(`
            SELECT id, name, photo_url, specialization, experience, description
            FROM teachers 
            WHERE (branch = ? OR branch = 'both') AND is_active = 1
            ORDER BY name
        `, [branch]);
        
        res.json({
            success: true,
            data: {
                teachers: teachers || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения преподавателей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения преподавателей'
        });
    }
});

// Получение новостей для фронтенда
app.get('/api/news/student/:branch', async (req, res) => {
    try {
        const { branch } = req.params;
        
        console.log(`📰 Новости для филиала: ${branch}`);
        
        const news = await db.all(`
            SELECT id, title, content, image_url, publish_date
            FROM news 
            WHERE (branch = ? OR branch = 'all') AND is_published = 1
            ORDER BY publish_date DESC 
            LIMIT 10
        `, [branch]);
        
        res.json({
            success: true,
            data: {
                news: news || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения новостей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения новостей'
        });
    }
});

// Получение FAQ для фронтенда
app.get('/api/faq/student', async (req, res) => {
    try {
        console.log('❓ FAQ для студента');
        
        const faq = await db.all(`
            SELECT id, question, answer, category
            FROM faq 
            WHERE is_active = 1 
            ORDER BY display_order, id
            LIMIT 20
        `);
        
        res.json({
            success: true,
            data: {
                faq: faq || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения FAQ:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения FAQ'
        });
    }
});

// Получение расписания по филиалу
app.get('/api/schedule/:branch', async (req, res) => {
    try {
        const branch = req.params.branch;
        
        console.log(`📅 Получение расписания для филиала: ${branch}`);
        
        const schedule = await db.all(`
            SELECT s.*, t.name as teacher_name 
            FROM schedule s
            LEFT JOIN teachers t ON s.teacher_id = t.id
            WHERE s.branch = ? AND s.status = 'active'
            AND s.date >= date('now', '-1 day')
            ORDER BY s.date, s.time
            LIMIT 20
        `, [branch]);
        
        console.log(`📊 Найдено занятий: ${schedule.length}`);
        
        // Преобразуем в формат для фронтенда
        const formattedSchedule = schedule.map(lesson => ({
            id: lesson.id,
            date: lesson.date,
            time: lesson.time,
            branch: lesson.branch,
            group_name: lesson.group_name || 'Группа',
            age_group: lesson.age_group || '',
            status: lesson.status,
            teacher_name: lesson.teacher_name || 'Преподаватель не указан',
            teacher_id: lesson.teacher_id
        }));
        
        res.json({
            success: true,
            data: {
                schedule: formattedSchedule,
                branch: branch,
                total_lessons: schedule.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения расписания:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения расписания',
            details: error.message
        });
    }
});

// Получение преподавателей по филиалу
app.get('/api/teachers/:branch', async (req, res) => {
    try {
        const branch = req.params.branch;
        
        console.log(`👨‍🏫 Получение преподавателей для филиала: ${branch}`);
        
        const teachers = await db.all(`
            SELECT * FROM teachers 
            WHERE (branch = ? OR branch = 'both') AND is_active = 1
            ORDER BY name
        `, [branch]);
        
        res.json({
            success: true,
            data: {
                teachers: teachers || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения преподавателей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения преподавателей'
        });
    }
});

// Получение новостей по филиалу
app.get('/api/news/:branch', async (req, res) => {
    try {
        const branch = req.params.branch;
        
        console.log(`📰 Получение новостей для филиала: ${branch}`);
        
        const news = await db.all(`
            SELECT * FROM news 
            WHERE (branch = ? OR branch = 'all') AND is_published = 1
            ORDER BY publish_date DESC 
            LIMIT 20
        `, [branch]);
        
        res.json({
            success: true,
            data: {
                news: news || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения новостей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения новостей'
        });
    }
});

// Получение FAQ
app.get('/api/faq', async (req, res) => {
    try {
        console.log('❓ Получение FAQ');
        
        const faq = await db.all(`
            SELECT * FROM faq 
            WHERE is_active = 1 
            ORDER BY display_order, id
        `);
        
        res.json({
            success: true,
            data: {
                faq: faq || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения FAQ:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения FAQ'
        });
    }
});

// ==================== API ДЛЯ ОТПРАВКИ TELEGRAM УВЕДОМЛЕНИЙ ====================

// Отправка уведомления через Telegram (улучшенная версия)
app.post('/api/admin/send-telegram-notification', verifyAdminToken, async (req, res) => {
    try {
        const { branch, message, type, admin_id, title, is_important } = req.body;
        
        console.log(`📨 Запрос на отправку уведомления для филиала: ${branch}`);
        
        if (!telegramBot || !telegramBot.bot) {
            return res.status(400).json({
                success: false,
                error: 'Telegram бот не настроен'
            });
        }
        
        // Проверяем наличие сообщения
        if (!message || message.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Введите текст сообщения'
            });
        }
        
        // Проверяем филиал
        if (!branch || branch.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Выберите филиал'
            });
        }
        
        console.log('🔄 Начинаем отправку уведомлений...');
        
        // Формируем полное сообщение с заголовком
        let fullMessage = '';
        if (title) {
            fullMessage += `📢 *${title}*\n\n`;
        } else {
            fullMessage += `📢 *Уведомление от школы*\n\n`;
        }
        
        fullMessage += `${message}\n\n`;
        
        if (is_important) {
            fullMessage += `❗ *Важно!*\n`;
        }
        
        fullMessage += `_Не отвечайте на это сообщение_`;
        
        // Отправляем уведомление
        const sentCount = await telegramBot.sendNotificationToBranch(branch, fullMessage);
        
        // Сохраняем в историю рассылок
        const result = await db.run(`
            INSERT INTO mailings (type, name, branch, message, status, recipients_count, sent_count, created_by, sent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
            type || 'telegram_notification',
            title || `Уведомление для ${branch}`,
            branch,
            message,
            'sent',
            0, // recipients_count будет подсчитан позже
            sentCount,
            admin_id || 1
        ]);
        
        const mailingId = result.lastID;
        
        // Получаем реальное количество получателей
        let recipientsCount = 0;
        if (branch && branch !== 'all') {
            const result = await db.get(`
                SELECT COUNT(DISTINCT tu.chat_id) as count
                FROM telegram_users tu
                JOIN student_profiles sp ON tu.username = sp.phone_number
                WHERE sp.branch = ? AND tu.is_active = 1
            `, [branch]);
            recipientsCount = result?.count || 0;
        } else {
            const result = await db.get('SELECT COUNT(*) as count FROM telegram_users WHERE is_active = 1');
            recipientsCount = result?.count || 0;
        }
        
        // Обновляем количество получателей
        await db.run(
            'UPDATE mailings SET recipients_count = ? WHERE id = ?',
            [recipientsCount, mailingId]
        );
        
        // Логируем
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'telegram_notification',
            'info',
            `Telegram уведомление #${mailingId} отправлено для филиала "${branch}". Отправлено: ${sentCount}/${recipientsCount}`,
            admin_id || 1
        ]);
        
        res.json({
            success: true,
            message: `Уведомление отправлено. Получили: ${sentCount} из ${recipientsCount} пользователей`,
            data: {
                sent_count: sentCount,
                recipients_count: recipientsCount,
                branch: branch,
                mailing_id: mailingId
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка отправки Telegram уведомления:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки уведомления'
        });
    }
});

// Отправка персонализированного уведомления конкретному пользователю
app.post('/api/admin/send-personal-notification', verifyAdminToken, async (req, res) => {
    try {
        const { chat_id, message, user_name, admin_id, title } = req.body;
        
        console.log(`📩 Отправка персонального уведомления пользователю: ${chat_id}`);
        
        if (!telegramBot || !telegramBot.bot) {
            return res.status(400).json({
                success: false,
                error: 'Telegram бот не настроен'
            });
        }
        
        if (!chat_id || !message) {
            return res.status(400).json({
                success: false,
                error: 'Укажите chat_id и сообщение'
            });
        }
        
        // Отправляем персонализированное сообщение
        const success = await telegramBot.sendPersonalizedNotification(chat_id, message, user_name);
        
        if (success) {
            // Сохраняем в логи
            await db.run(`
                INSERT INTO system_logs (type, level, message, user_id)
                VALUES (?, ?, ?, ?)
            `, [
                'personal_notification',
                'info',
                `Персональное уведомление отправлено пользователю ${chat_id}`,
                admin_id || 1
            ]);
            
            res.json({
                success: true,
                message: 'Персональное уведомление отправлено'
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Не удалось отправить уведомление'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка отправки персонального уведомления:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки уведомления'
        });
    }
});

// ==================== WEBHOOK ДЛЯ TELEGRAM ====================

// Webhook для Telegram
app.post('/api/telegram-webhook', async (req, res) => {
    try {
        const update = req.body;
        
        if (!telegramBot || !telegramBot.bot) {
            return res.status(200).json({ status: 'bot_not_configured' });
        }
        
        // Обрабатываем update
        if (update.message) {
            const chatId = update.message.chat.id;
            const text = update.message.text;
            
            if (text === '/start') {
                await telegramBot.bot.sendMessage(chatId, 
                    `🎨 *Добро пожаловать в Школу рисования Баня!*\n\n` +
                    `Для входа в личный кабинет перейдите по ссылке:\n` +
                    `${DOMAIN}\n\n` +
                    `Введите ваш номер телефона в формате 79991234567:`
                );
            } else if (/^\d{10,11}$/.test(text.replace(/\D/g, ''))) {
                // Обработка телефона через существующий метод
                const phone = text.replace(/\D/g, '');
                await telegramBot.handlePhoneInput(chatId, phone);
            }
        }
        
        res.status(200).json({ status: 'ok' });
        
    } catch (error) {
        console.error('❌ Ошибка обработки webhook Telegram:', error);
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// Настройка webhook
app.get('/api/setup-telegram-webhook', async (req, res) => {
    try {
        if (!telegramBot || !telegramBot.bot) {
            return res.json({
                success: false,
                error: 'Telegram бот не настроен'
            });
        }
        
        const webhookUrl = `${DOMAIN}/api/telegram-webhook`;
        await telegramBot.bot.setWebHook(webhookUrl);
        
        console.log(`✅ Telegram webhook установлен: ${webhookUrl}`);
        
        res.json({
            success: true,
            message: 'Webhook установлен',
            webhook_url: webhookUrl
        });
        
    } catch (error) {
        console.error('❌ Ошибка установки webhook:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка установки webhook'
        });
    }
});

// ==================== СИНХРОНИЗАЦИЯ И ПРОЧИЕ API ====================

app.get('/api/sync/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const force = req.query.force === 'true';
        
        console.log(`\n🔄 СИНХРОНИЗАЦИЯ: ${phone}${force ? ' (ФОРСИРОВАННАЯ)' : ''}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`📱 Форматированный телефон: ${formattedPhone}`);
        
        // ФОРСИРОВАННАЯ СИНХРОНИЗАЦИЯ: удаляем старые данные
        if (force) {
            console.log('🧹 Удаление старых данных...');
            const cleanPhone = phone.replace(/\D/g, '');
            await db.run(
                `DELETE FROM student_profiles WHERE phone_number LIKE ?`,
                [`%${cleanPhone.slice(-10)}%`]
            );
        }
        
        // Поиск в amoCRM
        console.log('🔍 Поиск профилей в amoCRM...');
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        console.log(`📊 Найдено профилей в amoCRM: ${profiles.length}`);
        
        if (profiles.length === 0) {
            return res.json({
                success: true,
                message: 'Профили не найдены в amoCRM',
                profiles_found: 0
            });
        }
        
        // Сохранение в БД
        console.log('💾 Сохранение в базу данных...');
        const savedCount = await saveProfilesToDatabase(profiles);
        
        // Получаем обновленные данные из БД
        const cleanPhone = phone.replace(/\D/g, '');
        const dbProfiles = await db.all(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1
             ORDER BY subscription_active DESC, updated_at DESC`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        
        const result = {
            success: true,
            message: `Синхронизация завершена. Найдено ${profiles.length} профилей, сохранено ${savedCount}`,
            sync_details: {
                amocrm_profiles: profiles.length,
                saved_to_db: savedCount,
                phone_searched: formattedPhone,
                force_update: force,
                timestamp: new Date().toISOString()
            },
            profiles: dbProfiles.map(p => ({
                id: p.id,
                student_name: p.student_name,
                branch: p.branch,
                teacher: p.teacher_name,
                subscription_type: p.subscription_type,
                subscription_status: p.subscription_status,
                subscription_active: p.subscription_active === 1,
                classes: `${p.used_classes}/${p.total_classes}`,
                remaining: p.remaining_classes,
                expiration_date: p.expiration_date,
                last_visit_date: p.last_visit_date,
                source: p.source,
                updated: p.updated_at
            }))
        };
        
        console.log(`\n✅ Синхронизация завершена успешно!`);
        console.log(`   Профилей найдено: ${profiles.length}`);
        console.log(`   Профилей сохранено: ${savedCount}`);
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Ошибка синхронизации:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка синхронизации',
            details: error.message
        });
    }
});

// ==================== АДМИН API МАРШРУТЫ ====================

// Аутентификация администратора
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log(`🔐 Попытка входа администратора: ${email}`);
        
        // В реальном приложении проверка будет в базе данных
        if (email === 'admin@artschool.ru' && password === 'admin123') {
            const adminData = {
                id: 1,
                name: 'Администратор',
                email: email,
                role: 'Администратор',
                branch: 'all',
                permissions: ['all']
            };
            
            const token = jwt.sign(
                {
                    admin_id: adminData.id,
                    email: adminData.email,
                    role: adminData.role,
                    permissions: adminData.permissions
                },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            
            res.json({
                success: true,
                message: 'Вход выполнен успешно',
                data: {
                    token: token,
                    admin: adminData
                }
            });
        } else {
            res.status(401).json({
                success: false,
                error: 'Неверный email или пароль'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка входа администратора:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка входа'
        });
    }
});

// Маршрут для админ-панели
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API для админ-панели
app.get('/api/admin/status', verifyAdminToken, (req, res) => {
    res.json({
        success: true,
        message: 'Админ-панель работает',
        user: req.admin
    });
});

// Получение статистики для дашборда
app.get('/api/admin/dashboard', verifyAdminToken, async (req, res) => {
    try {
        console.log('📊 Получение данных дашборда');
        
        // Получаем статистику из базы данных
        const totalStudents = await db.get('SELECT COUNT(*) as count FROM student_profiles WHERE is_active = 1');
        const activeSubscriptions = await db.get(`
            SELECT COUNT(*) as count FROM student_profiles 
            WHERE subscription_active = 1 AND is_active = 1
        `);
        const totalTeachers = await db.get('SELECT COUNT(*) as count FROM teachers WHERE is_active = 1');
        
        // Статистика по филиалам
        const branchStats = await db.all(`
            SELECT branch, COUNT(*) as count 
            FROM student_profiles 
            WHERE branch IS NOT NULL AND branch != '' AND is_active = 1
            GROUP BY branch
        `);
        
        // Новые ученики за месяц
        const newStudents = await db.get(`
            SELECT COUNT(*) as count FROM student_profiles 
            WHERE created_at >= date('now', '-30 days') AND is_active = 1
        `);
        
        // Истекающие абонементы
        const expiringSubscriptions = await db.get(`
            SELECT COUNT(*) as count FROM student_profiles 
            WHERE expiration_date >= date('now') 
            AND expiration_date <= date('now', '+30 days')
            AND subscription_active = 1
            AND is_active = 1
        `);
        
        // Статистика Telegram бота
        const telegramUsers = await db.get('SELECT COUNT(*) as count FROM telegram_users WHERE is_active = 1');
        const telegramActive = await db.get(`
            SELECT COUNT(*) as count FROM telegram_users 
            WHERE is_active = 1 AND last_activity >= date('now', '-7 days')
        `);
        
        res.json({
            success: true,
            data: {
                stats: {
                    total_students: totalStudents?.count || 0,
                    active_subscriptions: activeSubscriptions?.count || 0,
                    total_teachers: totalTeachers?.count || 0,
                    new_students_month: newStudents?.count || 0,
                    expiring_subscriptions: expiringSubscriptions?.count || 0,
                    telegram_users: telegramUsers?.count || 0,
                    telegram_active: telegramActive?.count || 0,
                    branches: branchStats || []
                },
                recent_activity: [
                    { type: 'new_student', name: 'Иванов Петр', time: '10:30', date: '2024-01-15' },
                    { type: 'subscription_purchase', name: 'Сидорова Мария', time: '14:20', amount: '₽8,400' },
                    { type: 'mailing_sent', name: 'Отмена занятия', recipients: 24, time: '09:15' },
                    { type: 'teacher_added', name: 'Анна К.', time: '16:45' }
                ]
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения данных дашборда:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения данных'
        });
    }
});

app.post('/api/admin/mailings', verifyAdminToken, async (req, res) => {
    try {
        const mailingData = req.body;
        const adminId = req.admin?.admin_id || 1;
        
        console.log('📨 Получены данные рассылки:');
        console.log('   Тип:', mailingData.type);
        console.log('   Название:', mailingData.name);
        console.log('   Филиал:', mailingData.branch);
        console.log('   Сообщение:', mailingData.message?.substring(0, 100) + '...');
        
        // Проверяем обязательные поля
        if (!mailingData.message || mailingData.message.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Введите текст сообщения'
            });
        }
        
        // Подсчитываем количество получателей
        let recipientsCount = 0;
        
        if (mailingData.type === 'telegram_notification') {
            // Для Telegram уведомлений по филиалу
            if (mailingData.branch && mailingData.branch !== 'all') {
                // Разделяем филиалы если их несколько
                const branches = mailingData.branch.split(',');
                let totalCount = 0;
                
                for (const branch of branches) {
                    const trimmedBranch = branch.trim();
                    const result = await db.get(`
                        SELECT COUNT(DISTINCT tu.chat_id) as count
                        FROM telegram_users tu
                        JOIN student_profiles sp ON tu.username = sp.phone_number
                        WHERE sp.branch LIKE ? AND tu.is_active = 1
                    `, [`%${trimmedBranch}%`]);
                    totalCount += result?.count || 0;
                }
                recipientsCount = totalCount;
            } else {
                const result = await db.get('SELECT COUNT(*) as count FROM telegram_users WHERE is_active = 1');
                recipientsCount = result?.count || 0;
            }
        } else if (mailingData.segment) {
            // Для сегментированных рассылок - упрощенный подсчет
            recipientsCount = 50; // Примерное значение
        }
        
        console.log(`👥 Получателей: ${recipientsCount}`);
        
        // Сохраняем рассылку в базу данных
        const result = await db.run(`
            INSERT INTO mailings 
            (type, name, segment, branch, teacher, day, message, status, recipients_count, created_by) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            mailingData.type || 'telegram_notification',
            mailingData.name || `Рассылка ${new Date().toLocaleString()}`,
            mailingData.segment || '',
            mailingData.branch || '',
            mailingData.teacher || '',
            mailingData.day || '',
            mailingData.message,
            'pending', // Статус будет изменен после отправки
            recipientsCount,
            adminId
        ]);
        
        const mailingId = result.lastID;
        
        console.log(`✅ Рассылка создана ID: ${mailingId}`);
        
        // НЕМЕДЛЕННО отправляем Telegram уведомление
        if (mailingData.type === 'telegram_notification' && telegramBot.bot) {
            try {
                console.log(`🚀 Начинаем отправку Telegram рассылки #${mailingId}...`);
                
                // Обновляем статус на "отправляется"
                await db.run('UPDATE mailings SET status = ? WHERE id = ?', ['sending', mailingId]);
                
                // Формируем сообщение с заголовком
                let fullMessage = `📢 *${mailingData.name || 'Уведомление'}*\n\n`;
                fullMessage += `${mailingData.message}\n\n`;
                fullMessage += `_Не отвечайте на это сообщение_`;
                
                // Отправляем уведомление
                let sentCount = 0;
                const branches = mailingData.branch ? mailingData.branch.split(',').map(b => b.trim()) : [];
                
                for (const branch of branches) {
                    if (branch) {
                        const count = await telegramBot.sendNotificationToBranch(branch, fullMessage);
                        sentCount += count;
                        console.log(`   📤 Филиал "${branch}": отправлено ${count}`);
                    }
                }
                
                // Если не указаны филиалы, отправляем всем
                if (branches.length === 0 || branches[0] === '') {
                    sentCount = await telegramBot.sendNotificationToBranch('all', fullMessage);
                }
                
                // Обновляем статус и количество отправленных
                await db.run(
                    'UPDATE mailings SET status = ?, sent_count = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?',
                    ['sent', sentCount, mailingId]
                );
                
                console.log(`✅ Telegram рассылка #${mailingId} отправлена! Отправлено: ${sentCount}`);
                
            } catch (sendError) {
                console.error('❌ Ошибка отправки Telegram рассылки:', sendError.message);
                await db.run(
                    'UPDATE mailings SET status = ?, failed_count = ? WHERE id = ?', 
                    ['failed', recipientsCount, mailingId]
                );
                
                // Записываем ошибку в логи
                await db.run(`
                    INSERT INTO system_logs (type, level, message, user_id)
                    VALUES (?, ?, ?, ?)
                `, [
                    'mailing',
                    'error',
                    `Ошибка отправки рассылки #${mailingId}: ${sendError.message}`,
                    adminId
                ]);
            }
        } else if (mailingData.type === 'marketing') {
            // Для маркетинговых рассылок пока просто сохраняем
            console.log(`📧 Маркетинговая рассылка #${mailingId} сохранена для ручной отправки`);
        }
        
        // Логируем создание рассылки
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'mailing',
            'info',
            `Создана рассылка #${mailingId}: "${mailingData.name}" (получателей: ${recipientsCount})`,
            adminId
        ]);
        
        res.json({
            success: true,
            message: 'Рассылка создана и отправлена',
            data: {
                mailing_id: mailingId,
                recipients_count: recipientsCount,
                sent_count: mailingData.type === 'telegram_notification' ? recipientsCount : 0,
                status: mailingData.type === 'telegram_notification' ? 'sent' : 'pending'
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания рассылки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания рассылки',
            details: error.message
        });
    }
});

// Получение списка рассылок
app.get('/api/admin/mailings', verifyAdminToken, async (req, res) => {
    try {
        const type = req.query.type; // 'service' или 'marketing'
        
        console.log(`📨 Получение рассылок типа: ${type || 'все'}`);
        
        let query = 'SELECT * FROM mailings WHERE 1=1';
        const params = [];
        
        if (type === 'service') {
            query += ' AND type IN ("cancellation", "replacement", "reschedule", "telegram_notification")';
        } else if (type === 'marketing') {
            query += ' AND type = "marketing"';
        }
        
        query += ' ORDER BY created_at DESC LIMIT 50';
        
        const mailings = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                mailings: mailings || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения рассылок:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения рассылок',
            details: error.message
        });
    }
});

// Принудительная отправка рассылки
app.post('/api/admin/mailings/:id/send', verifyAdminToken, async (req, res) => {
    try {
        const mailingId = req.params.id;
        const adminId = req.admin?.admin_id || 1;
        
        console.log(`🚀 Принудительная отправка рассылки #${mailingId}`);
        
        // Получаем данные рассылки
        const mailing = await db.get('SELECT * FROM mailings WHERE id = ?', [mailingId]);
        
        if (!mailing) {
            return res.status(404).json({
                success: false,
                error: 'Рассылка не найдена'
            });
        }
        
        if (mailing.status === 'sent') {
            return res.status(400).json({
                success: false,
                error: 'Рассылка уже отправлена'
            });
        }
        
        // Отправляем через Telegram бота
        if (mailing.type === 'telegram_notification' && telegramBot.bot && mailing.branch) {
            // Обновляем статус
            await db.run('UPDATE mailings SET status = ? WHERE id = ?', ['sending', mailingId]);
            
            // Формируем сообщение
            let fullMessage = `📢 *${mailing.name || 'Уведомление'}*\n\n`;
            fullMessage += `${mailing.message}\n\n`;
            fullMessage += `_Не отвечайте на это сообщение_`;
            
            // Отправляем
            let sentCount = 0;
            const branches = mailing.branch ? mailing.branch.split(',').map(b => b.trim()) : [];
            
            for (const branch of branches) {
                if (branch) {
                    const count = await telegramBot.sendNotificationToBranch(branch, fullMessage);
                    sentCount += count;
                    console.log(`   📤 Филиал "${branch}": отправлено ${count}`);
                }
            }
            
            // Обновляем статус
            await db.run(
                'UPDATE mailings SET status = ?, sent_count = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['sent', sentCount, mailingId]
            );
            
            console.log(`✅ Рассылка #${mailingId} отправлена вручную! Отправлено: ${sentCount}`);
            
            res.json({
                success: true,
                message: `Рассылка отправлена (${sentCount} получателей)`,
                data: {
                    sent_count: sentCount
                }
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Невозможно отправить этот тип рассылки'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка отправки рассылки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки рассылки',
            details: error.message
        });
    }
});

// Удаление рассылки
app.delete('/api/admin/mailings/:id', verifyAdminToken, async (req, res) => {
    try {
        const mailingId = req.params.id;
        
        console.log(`🗑️ Удаление рассылки ID: ${mailingId}`);
        
        // Проверяем существование рассылки
        const mailing = await db.get('SELECT * FROM mailings WHERE id = ?', [mailingId]);
        
        if (!mailing) {
            return res.status(404).json({
                success: false,
                error: 'Рассылка не найдена'
            });
        }
        
        // Нельзя удалять отправленные рассылки
        if (mailing.status === 'sent' || mailing.status === 'sending') {
            return res.status(400).json({
                success: false,
                error: 'Нельзя удалять отправленные или отправляющиеся рассылки'
            });
        }
        
        // Удаляем рассылку
        const result = await db.run('DELETE FROM mailings WHERE id = ?', [mailingId]);
        
        if (result.changes > 0) {
            // Логируем удаление
            await db.run(`
                INSERT INTO system_logs (type, level, message, user_id)
                VALUES (?, ?, ?, ?)
            `, [
                'mailing',
                'info',
                `Рассылка #${mailingId} удалена`,
                req.admin.admin_id || 1
            ]);
            
            res.json({
                success: true,
                message: 'Рассылка удалена'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Рассылка не найдена'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка удаления рассылки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления рассылки'
        });
    }
});

// Просмотр деталей рассылки
app.get('/api/admin/mailings/:id', verifyAdminToken, async (req, res) => {
    try {
        const mailingId = req.params.id;
        
        console.log(`👁️ Просмотр рассылки ID: ${mailingId}`);
        
        const mailing = await db.get('SELECT * FROM mailings WHERE id = ?', [mailingId]);
        
        if (!mailing) {
            return res.status(404).json({
                success: false,
                error: 'Рассылка не найдена'
            });
        }
        
        // Получаем статистику по получателям
        let recipientsInfo = {};
        if (mailing.branch) {
            const result = await db.all(`
                SELECT sp.student_name, sp.phone_number, sp.subscription_status
                FROM student_profiles sp
                JOIN telegram_users tu ON tu.username = sp.phone_number
                WHERE sp.branch = ? AND tu.is_active = 1
                LIMIT 10
            `, [mailing.branch]);
            recipientsInfo = {
                sample: result,
                total: mailing.recipients_count || 0
            };
        }
        
        res.json({
            success: true,
            data: {
                mailing: mailing,
                recipients: recipientsInfo,
                stats: {
                    delivery_rate: mailing.recipients_count > 0 
                        ? Math.round((mailing.sent_count / mailing.recipients_count) * 100)
                        : 0
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения рассылки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения рассылки'
        });
    }
});

// Отправка тестового сообщения
app.post('/api/admin/mailings/test', verifyAdminToken, async (req, res) => {
    try {
        const { message, admin_id } = req.body;
        
        console.log(`📧 Отправка тестового сообщения администратору`);
        
        // Получаем chat_id администратора из таблицы telegram_users
        const adminUser = await db.get(`
            SELECT chat_id FROM telegram_users 
            WHERE username = ? OR first_name LIKE '%админ%' 
            ORDER BY id DESC LIMIT 1
        `, ['admin']);
        
        if (adminUser && adminUser.chat_id && telegramBot.bot) {
            try {
                await telegramBot.bot.sendMessage(adminUser.chat_id, 
                    `📋 *Тестовое сообщение от администратора*\n\n` +
                    `${message}\n\n` +
                    `_Это тестовое сообщение для проверки бота_`,
                    { parse_mode: 'Markdown' }
                );
                
                console.log(`✅ Тестовое сообщение отправлено администратору (chat_id: ${adminUser.chat_id})`);
                
                res.json({
                    success: true,
                    message: 'Тестовое сообщение отправлено'
                });
                
            } catch (botError) {
                console.error('❌ Ошибка отправки тестового сообщения:', botError.message);
                res.status(500).json({
                    success: false,
                    error: 'Ошибка отправки тестового сообщения'
                });
            }
        } else {
            res.status(404).json({
                success: false,
                error: 'Не найден chat_id администратора или бот не настроен'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка отправки тестового сообщения:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки тестового сообщения'
        });
    }
});

// ==================== ДРУГИЕ АДМИН API ====================

// Управление расписанием
app.post('/api/admin/schedule', verifyAdminToken, async (req, res) => {
    try {
        const scheduleData = req.body;
        
        console.log(`📅 Создание/изменение занятия: ${scheduleData.branch} - ${scheduleData.date}`);
        
        if (scheduleData.id) {
            // Обновление существующего занятия
            await db.run(`
                UPDATE schedule SET 
                    date = ?, time = ?, branch = ?, teacher_id = ?, 
                    group_name = ?, age_group = ?, status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                scheduleData.date,
                scheduleData.time,
                scheduleData.branch,
                scheduleData.teacher_id,
                scheduleData.group_name,
                scheduleData.age_group,
                scheduleData.status || 'active',
                scheduleData.id
            ]);
        } else {
            // Создание нового занятия
            const result = await db.run(`
                INSERT INTO schedule (date, time, branch, teacher_id, group_name, age_group, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                scheduleData.date,
                scheduleData.time,
                scheduleData.branch,
                scheduleData.teacher_id,
                scheduleData.group_name,
                scheduleData.age_group,
                scheduleData.status || 'active'
            ]);
            scheduleData.id = result.lastID;
        }
        
        res.json({
            success: true,
            message: 'Расписание сохранено',
            data: {
                schedule_id: scheduleData.id
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка сохранения расписания:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения расписания'
        });
    }
});

// Получение расписания для админ-панели
app.get('/api/admin/schedule', verifyAdminToken, async (req, res) => {
    try {
        const { branch, date_from, date_to, teacher_id, status } = req.query;
        
        console.log(`📅 Получение расписания с фильтрами`);
        
        let query = `
            SELECT s.*, t.name as teacher_name 
            FROM schedule s
            LEFT JOIN teachers t ON s.teacher_id = t.id
            WHERE 1=1
        `;
        const params = [];
        
        if (branch && branch !== 'all') {
            query += ' AND s.branch = ?';
            params.push(branch);
        }
        
        if (date_from) {
            query += ' AND s.date >= ?';
            params.push(date_from);
        }
        
        if (date_to) {
            query += ' AND s.date <= ?';
            params.push(date_to);
        }
        
        if (teacher_id) {
            query += ' AND s.teacher_id = ?';
            params.push(teacher_id);
        }
        
        if (status) {
            query += ' AND s.status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY s.date, s.time LIMIT 100';
        
        const schedule = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                schedule: schedule || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения расписания:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения расписания'
        });
    }
});

// Управление преподавателями
app.post('/api/admin/teachers', verifyAdminToken, async (req, res) => {
    try {
        const teacherData = req.body;
        
        console.log(`👨‍🏫 Сохранение преподавателя: ${teacherData.name}`);
        
        if (teacherData.id) {
            // Обновление существующего преподавателя
            await db.run(`
                UPDATE teachers SET 
                    name = ?, branch = ?, specialization = ?, 
                    experience = ?, education = ?, description = ?,
                    email = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                teacherData.name,
                teacherData.branch,
                teacherData.specialization,
                teacherData.experience,
                teacherData.education,
                teacherData.description,
                teacherData.email,
                teacherData.is_active || 1,
                teacherData.id
            ]);
        } else {
            // Создание нового преподавателя
            const result = await db.run(`
                INSERT INTO teachers (name, branch, specialization, experience, education, description, email)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                teacherData.name,
                teacherData.branch,
                teacherData.specialization,
                teacherData.experience,
                teacherData.education,
                teacherData.description,
                teacherData.email
            ]);
            teacherData.id = result.lastID;
        }
        
        res.json({
            success: true,
            message: 'Преподаватель сохранен',
            data: {
                teacher_id: teacherData.id
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка сохранения преподавателя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения преподавателя'
        });
    }
});

// Получение списка преподавателей для админ-панели
app.get('/api/admin/teachers', verifyAdminToken, async (req, res) => {
    try {
        console.log('👨‍🏫 Получение списка преподавателей');
        
        const teachers = await db.all(`
            SELECT * FROM teachers 
            WHERE is_active = 1 
            ORDER BY name
        `);
        
        res.json({
            success: true,
            data: {
                teachers: teachers || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения преподавателей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения преподавателей'
        });
    }
});

// Управление FAQ
app.post('/api/admin/faq', verifyAdminToken, async (req, res) => {
    try {
        const faqData = req.body;
        
        console.log(`❓ Сохранение FAQ: ${faqData.question.substring(0, 50)}...`);
        
        if (faqData.id) {
            // Обновление существующего FAQ
            await db.run(`
                UPDATE faq SET 
                    question = ?, answer = ?, category = ?, 
                    display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                faqData.question,
                faqData.answer,
                faqData.category,
                faqData.display_order,
                faqData.is_active || 1,
                faqData.id
            ]);
        } else {
            // Создание нового FAQ
            const result = await db.run(`
                INSERT INTO faq (question, answer, category, display_order, is_active)
                VALUES (?, ?, ?, ?, ?)
            `, [
                faqData.question,
                faqData.answer,
                faqData.category,
                faqData.display_order || 1,
                faqData.is_active || 1
            ]);
            faqData.id = result.lastID;
        }
        
        res.json({
            success: true,
            message: 'Вопрос сохранен',
            data: {
                faq_id: faqData.id
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка сохранения FAQ:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения FAQ'
        });
    }
});

// Получение FAQ для админ-панели
app.get('/api/admin/faq', verifyAdminToken, async (req, res) => {
    try {
        console.log('❓ Получение FAQ');
        
        const faq = await db.all(`
            SELECT * FROM faq 
            WHERE is_active = 1 
            ORDER BY display_order, id
        `);
        
        res.json({
            success: true,
            data: {
                faq: faq || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения FAQ:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения FAQ'
        });
    }
});

// Управление новостями
app.post('/api/admin/news', verifyAdminToken, async (req, res) => {
    try {
        const newsData = req.body;
        
        console.log(`📰 Сохранение новости: ${newsData.title}`);
        
        if (newsData.id) {
            // Обновление существующей новости
            await db.run(`
                UPDATE news SET 
                    title = ?, content = ?, branch = ?, 
                    publish_date = ?, is_published = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                newsData.title,
                newsData.content,
                newsData.branch,
                newsData.publish_date,
                newsData.is_published || 0,
                newsData.id
            ]);
        } else {
            // Создание новой новости
            const result = await db.run(`
                INSERT INTO news (title, content, branch, publish_date, is_published)
                VALUES (?, ?, ?, ?, ?)
            `, [
                newsData.title,
                newsData.content,
                newsData.branch,
                newsData.publish_date || new Date().toISOString().split('T')[0],
                newsData.is_published || 0
            ]);
            newsData.id = result.lastID;
        }
        
        res.json({
            success: true,
            message: 'Новость сохранена',
            data: {
                news_id: newsData.id
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка сохранения новости:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения новости'
        });
    }
});

// Получение новостей для админ-панели
app.get('/api/admin/news', verifyAdminToken, async (req, res) => {
    try {
        console.log('📰 Получение новостей');
        
        const news = await db.all(`
            SELECT * FROM news 
            ORDER BY publish_date DESC 
            LIMIT 50
        `);
        
        res.json({
            success: true,
            data: {
                news: news || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения новостей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения новостей'
        });
    }
});

// Получение логов системы
app.get('/api/admin/logs', verifyAdminToken, async (req, res) => {
    try {
        const { type, level, date_from, date_to } = req.query;
        
        console.log(`📝 Получение логов`);
        
        let query = 'SELECT * FROM system_logs WHERE 1=1';
        const params = [];
        
        if (type) {
            query += ' AND type = ?';
            params.push(type);
        }
        
        if (level) {
            query += ' AND level = ?';
            params.push(level);
        }
        
        if (date_from) {
            query += ' AND created_at >= ?';
            params.push(date_from);
        }
        
        if (date_to) {
            query += ' AND created_at <= ?';
            params.push(date_to);
        }
        
        query += ' ORDER BY created_at DESC LIMIT 100';
        
        const logs = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                logs: logs || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения логов:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения логов'
        });
    }
});

// Очистка логов
app.post('/api/admin/logs/clear', verifyAdminToken, async (req, res) => {
    try {
        console.log('🧹 Очистка логов');
        
        await db.run('DELETE FROM system_logs WHERE created_at < date("now", "-30 days")');
        
        // Оставляем последние 1000 записей
        await db.run(`
            DELETE FROM system_logs 
            WHERE id NOT IN (
                SELECT id FROM system_logs 
                ORDER BY created_at DESC 
                LIMIT 1000
            )
        `);
        
        res.json({
            success: true,
            message: 'Старые логи очищены'
        });
        
    } catch (error) {
        console.error('❌ Ошибка очистки логов:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка очистки логов'
        });
    }
});

// Получение списка пользователей Telegram
app.get('/api/admin/telegram-users', verifyAdminToken, async (req, res) => {
    try {
        console.log('👥 Получение пользователей Telegram');
        
        const users = await db.all(`
            SELECT tu.*, sp.student_name, sp.branch 
            FROM telegram_users tu
            LEFT JOIN student_profiles sp ON tu.username = sp.phone_number
            WHERE tu.is_active = 1
            ORDER BY tu.last_activity DESC
            LIMIT 100
        `);
        
        res.json({
            success: true,
            data: {
                users: users || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения пользователей Telegram:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения пользователей'
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(100));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v4.3');
        console.log('='.repeat(100));
        console.log('✨ СИСТЕМА УПРАВЛЕНИЯ ЛОГОТИПОМ');
        console.log('✨ УЛУЧШЕННЫЕ TELEGRAM УВЕДОМЛЕНИЯ');
        console.log('✨ API ДЛЯ НАСТРОЕК И ПЕРСОНАЛИЗИРОВАННЫХ СООБЩЕНИЙ');
        console.log('='.repeat(100));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
        } else {
            console.log('⚠️  amoCRM не инициализирован');
            console.log('ℹ️  Используются локальные данные');
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(100));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(100));
            console.log(`🌐 Основной URL: http://localhost:${PORT}`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log(`🤖 Telegram бот: ${telegramBot.bot !== null ? '✅ Запущен' : '❌ Не запущен'}`);
            console.log('='.repeat(100));
            
            console.log('\n🔗 ОСНОВНЫЕ API МАРШРУТЫ:');
            console.log('='.repeat(50));
            console.log(`📊 Статус: GET http://localhost:${PORT}/api/status`);
            console.log(`🎨 Логотип: GET http://localhost:${PORT}/api/logo`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`📅 Расписание: GET http://localhost:${PORT}/api/schedule/student/{branch}`);
            console.log(`👨‍🏫 Преподаватели: GET http://localhost:${PORT}/api/teachers/student/{branch}`);
            console.log(`📰 Новости: GET http://localhost:${PORT}/api/news/student/{branch}`);
            console.log(`❓ FAQ: GET http://localhost:${PORT}/api/faq/student`);
            console.log(`🔄 Синхронизация: GET http://localhost:${PORT}/api/sync/{phone}`);
            console.log('');
            console.log('🔧 АДМИН ПАНЕЛЬ:');
            console.log('─'.repeat(50));
            console.log(`👤 Админ-панель: GET http://localhost:${PORT}/admin`);
            console.log(`🔐 Вход: POST http://localhost:${PORT}/api/admin/login`);
            console.log(`⚙️  Настройки: GET http://localhost:${PORT}/api/admin/settings`);
            console.log(`📨 Рассылки: POST http://localhost:${PORT}/api/admin/mailings`);
            console.log(`🤖 Telegram уведомления: POST http://localhost:${PORT}/api/admin/send-telegram-notification`);
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
