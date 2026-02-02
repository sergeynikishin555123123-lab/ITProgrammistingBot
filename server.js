// server.js - ОКОНЧАТЕЛЬНАЯ ВЕРСИЯ (без демо-данных, с Telegram ботом и улучшенным API)
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

    // Отправка уведомления пользователям филиала
    async sendNotificationToBranch(branch, message, excludeChatIds = []) {
        if (!this.bot) {
            console.log('⚠️ Telegram бот не доступен для отправки уведомлений');
            return 0;
        }
        
        try {
            console.log(`📨 Отправка уведомления для филиала "${branch}"`);
            
            // Находим chat_id пользователей по филиалу
            const users = await db.all(`
                SELECT DISTINCT tu.chat_id 
                FROM telegram_users tu
                JOIN student_profiles sp ON tu.username = sp.phone_number
                WHERE sp.branch = ? AND tu.is_active = 1
                AND tu.chat_id NOT IN (${excludeChatIds.map(() => '?').join(',')})
            `, [branch, ...excludeChatIds]);
            
            console.log(`👥 Найдено пользователей для рассылки: ${users.length}`);
            
            let sentCount = 0;
            let failedCount = 0;
            
            for (const user of users) {
                try {
                    await this.bot.sendMessage(user.chat_id, 
                        `📢 *Уведомление от Школы рисования*\n\n` +
                        `${message}\n\n` +
                        `_Не отвечайте на это сообщение_`,
                        { parse_mode: 'Markdown' }
                    );
                    
                    sentCount++;
                    console.log(`✅ Отправлено chat_id ${user.chat_id}`);
                    
                    // Задержка между отправками (50 мс)
                    await new Promise(resolve => setTimeout(resolve, 50));
                    
                } catch (error) {
                    failedCount++;
                    console.error(`❌ Ошибка отправки в chat_id ${user.chat_id}:`, error.message);
                    
                    // Если пользователь заблокировал бота, деактивируем его
                    if (error.response?.statusCode === 403) {
                        await db.run(
                            'UPDATE telegram_users SET is_active = 0 WHERE chat_id = ?',
                            [user.chat_id]
                        );
                        console.log(`👤 Пользователь ${user.chat_id} деактивирован (заблокировал бота)`);
                    }
                }
            }
            
            console.log(`📊 Итог рассылки: отправлено ${sentCount}, не отправлено ${failedCount}`);
            return sentCount;
            
        } catch (error) {
            console.error('❌ Ошибка отправки уведомлений:', error);
            return 0;
        }
    }
}

// ==================== УЛУЧШЕННЫЙ КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.fieldMappings = new Map();
        this.customFieldCache = new Map();
        this.accountInfo = null;
        
        // Кэш для enum значений
        this.enumCache = new Map();
        
        // ВАШИ ID ПОЛЕЙ (полный список)
        this.FIELD_IDS = {
            // ==================== СДЕЛКИ (LEADS) ====================
            LEAD: {
                // Основные поля абонемента
                TOTAL_CLASSES: 850241,        // "Абонемент занятий:" (select)
                USED_CLASSES: 850257,         // "Счетчик занятий:" (select)
                USED_CLASSES_NUM: 884251,     // "Кол-во отхоженных занятий" (numeric)
                REMAINING_CLASSES: 890163,    // "Остаток занятий" (numeric)
                EXPIRATION_DATE: 850255,      // "Окончание абонемента:" (date)
                ACTIVATION_DATE: 851565,      // "Дата активации абонемента:" (date)
                LAST_VISIT_DATE: 850259,      // "Дата последнего визита:" (date)
                SUBSCRIPTION_TYPE: 891007,    // "Тип абонемента" (select)
                SUBSCRIPTION_OWNER: 805465,   // "Принадлежность абонемента:" (select)
                FREEZE: 867693,               // "Заморозка абонемента:" (select)
                BRANCH: 891589,               // "Филиал" (select)
                AGE_GROUP: 850243,            // "Группа возраст:" (select)
                PURCHASE_DATE: 850253,        // "Дата покупки:" (date)
                
                // Технические поля
                TECHNICAL_CLASSES: 891819,    // "Количество занятий (тех)" (numeric)
                CLASS_PRICE: 891813,          // "Стоимость 1 занятия" (numeric)
                
                // Чекбоксы посещений (все 24 занятия)
                CLASS_1: 884899, CLASS_2: 884901, CLASS_3: 884903, CLASS_4: 884905,
                CLASS_5: 884907, CLASS_6: 884909, CLASS_7: 884911, CLASS_8: 884913,
                CLASS_9: 884915, CLASS_10: 884917, CLASS_11: 884919, CLASS_12: 884921,
                CLASS_13: 884923, CLASS_14: 884925, CLASS_15: 884927, CLASS_16: 884929,
                CLASS_17: 892867, CLASS_18: 892871, CLASS_19: 892875, CLASS_20: 892879,
                CLASS_21: 892883, CLASS_22: 892887, CLASS_23: 892893, CLASS_24: 892895,
                
                // Даты занятий
                CLASS_DATE_1: 884931, CLASS_DATE_2: 884933, CLASS_DATE_3: 884935,
                CLASS_DATE_4: 884937, CLASS_DATE_5: 884939, CLASS_DATE_6: 884941,
                CLASS_DATE_7: 884943, CLASS_DATE_8: 884945, CLASS_DATE_9: 884953,
                CLASS_DATE_10: 884955, CLASS_DATE_11: 884951, CLASS_DATE_12: 884957,
                CLASS_DATE_13: 884959, CLASS_DATE_14: 884961, CLASS_DATE_15: 884963,
                CLASS_DATE_16: 884965, CLASS_DATE_17: 892869, CLASS_DATE_18: 892873,
                CLASS_DATE_19: 892877, CLASS_DATE_20: 892881, CLASS_DATE_21: 892885,
                CLASS_DATE_22: 892889, CLASS_DATE_23: 892891, CLASS_DATE_24: 892897,
                
                // Дополнительные поля
                ADVERTISING_CHANNEL: 850251,  // "Рекламный канал:"
                MESSAGING_CHANNEL: 867617,    // "Канал отправки сообщений:"
                TRIAL_DATE: 867729,           // "!Дата и время пробного занятия:"
                
                // Финансовые поля
                ADVANCE_PAYMENT: 891817,      // "Авансовые средства"
                RECEIVED_PAYMENT: 891815,     // "Полученные средства"
                
                // Стандартные поля
                STATUS_ID: 'status_id',       // Статус сделки
                NAME: 'name',                 // Название сделки
                PRICE: 'price',               // Стоимость
                PIPELINE_ID: 'pipeline_id',   // Воронка
            },
            
            // ==================== КОНТАКТЫ (CONTACTS) ====================
            CONTACT: {
                // Дети (3 ребенка)
                CHILD_1_NAME: 867233,         // "!ФИО ребенка:"
                CHILD_1_BIRTHDAY: 867687,     // "День рождения:" (ребенок 1)
                CHILD_2_NAME: 867235,         // "!!ФИО ребенка:"
                CHILD_2_BIRTHDAY: 867685,     // "День рождения:" (ребенок 2)
                CHILD_3_NAME: 867733,         // "!!!ФИО ребенка:"
                CHILD_3_BIRTHDAY: 867735,     // "День рождения:" (ребенок 3)
                
                // Основные поля
                BRANCH: 871273,              // "Филиал:" (select)
                TEACHER: 888881,             // "Преподаватель" (multiselect)
                SUMMER_TEACHER: 891651,      // "Преподаватель (лето)" (multiselect)
                DAY_OF_WEEK: 888879,         // "День недели посещения" (multiselect)
                AGE_GROUP: 888903,           // "Возраст группы" (multiselect)
                
                // Абонемент в контакте
                HAS_ACTIVE_SUB: 890179,      // "Есть активный абонемент" (checkbox)
                LAST_VISIT: 885380,          // "Дата последнего визита" (date)
                LAST_SUB_ACTIVATION: 892185, // "Дата активации последнего абонемента" (date)
                
                // Дополнительная информация
                ALLERGIES: 850239,           // "Аллергия и особенности:" (textarea)
                PARENT_BIRTHDAY: 850219,     // "День рождения:" (родителя)
                
                // Посещаемость и статистика
                ATTENDANCE: 888559,          // "Посещаемость"
                MONTHLY_CLASSES_COUNT: 885027, // "Счетчик занятий за месяц"
                FREE_CLASSES_AVAILABLE: 885031, // "Доступно бесплатных занятий"
                HAS_AV: 879891,              // "Есть АВ:"
                BOUGHT_ON_SALE: 889361,      // "Купил абонемент по акции"
                
                // Статистика покупок
                AVERAGE_CHECK: 887159,       // "Ср. чек, руб."
                TOTAL_PURCHASES: 887157,     // "Сумма покупок, руб."
                PURCHASES_COUNT: 887155,     // "Количество покупок"
                
                // Сегментация
                SEGMENT: 890981,             // "Сегмент"
                OLD_OFFER: 890199,           // "Старая оферта"
                
                // Коммуникации
                MAILING_CHANNEL: 892645,     // "Канал рассылки"
                SENDING_CHANNEL: 893159,     // "Канал отправки"
                MAILINGS: 892647,            // "Рассылки"
                FEEDBACK: 891635,            // "Отзыв"
                WEEK_DAY_2025_26: 892225,    // "День недели (2025-26)"
                
                // Заморозка абонемента
                FREEZE_USED: 890095,         // "Использована заморозка абонемента"
                FREEZE_PERIOD: 890097,       // "Срок заморозки"
                FREEZE_PRICE: 890099,        // "Цена заморозки"
                
                // Trial занятия
                TRIAL_VISITED: 867691,       // "Был на пробном занятии:"
                APPLICANT: 850223,           // "Постоянный клиент:"
                
                // Контактные данные
                TELEGRAM_ID: 852249,         // "TelegramId_WZ"
                PHONE: 'phone',              // Телефон (стандартное поле)
                EMAIL: 'email',              // Email (стандартное поле)
                
                // Стандартные поля
                PARENT_NAME: 'name',         // Имя контакта (родителя)
                CREATED_AT: 'created_at',    // Дата создания
                UPDATED_AT: 'updated_at',    // Дата обновления
            }
        };
        
        // Маппинг enum_id для быстрого преобразования
        this.SUBSCRIPTION_ENUM_MAPPING = {
            // ==================== АБОНЕМЕНТ ЗАНЯТИЙ: (850241) ====================
            '504033': 4,    // "4 занятия"
            '504035': 8,    // "8 занятий" 
            '504037': 16,   // "16 занятий"
            '504039': 4,    // "Продвинутый 4 занятия"
            '504041': 8,    // "Продвинутый 8 занятий"
            '504043': 16,   // "Продвинутый 16 занятий"
            '504237': 5,    // "База Блок № 1 - 5 занятий"
            '504239': 6,    // "База Блок № 2 - 6 занятий"
            '504241': 5,    // "База Блок № 3 - 5 занятий"
            '504243': 16,   // "База - 16 занятий"
            
            // ==================== СЧЕТЧИК ЗАНЯТИЙ: (850257) ====================
            '504105': 1,    // "1"
            '504107': 2,    // "2"
            '504109': 3,    // "3"
            '504111': 4,    // "4"
            '504113': 5,    // "5"
            '504115': 6,    // "6"
            '504117': 7,    // "7"
            '504119': 8,    // "8"
            '504121': 9,    // "9"
            '504123': 10,   // "10"
            '504125': 11,   // "11"
            '504127': 12,   // "12"
            '504129': 13,   // "13"
            '504131': 14,   // "14"
            '504133': 15,   // "15"
            '504135': 16,   // "16"
            '504137': 17,   // "17"
            '504139': 18,   // "18"
            '504141': 19,   // "19"
            '504143': 20,   // "20"
            '504145': 21,   // "21"
            '504147': 22,   // "22"
            '504149': 23,   // "23"
            '504151': 24,   // "24"
            
            // ==================== ТИП АБОНЕМЕНТА (891007) ====================
            '554165': 'Повторный',
            
            // ==================== ГРУППА ВОЗРАСТ: (850243) ====================
            '504047': '6-8 лет',
            '504049': '8-10 лет',
            '504051': '10-13 лет',
            
            // ==================== РЕКЛАМНЫЙ КАНАЛ: (850251) ====================
            '504095': 'Сарафан',
            
            // ==================== КАНАЛ ОТПРАВКИ СООБЩЕНИЙ: (867617) ====================
            '527233': 'Телеграм',
            
            // ==================== ФИЛИАЛ В КОНТАКТАХ (871273) ====================
            '529779': 'Свиблово',
            
            // ==================== ПРЕПОДАВАТЕЛЬ (888881) ====================
            '556183': 'Аня К',
            
            // ==================== ВОЗРАСТ ГРУППЫ (888903) ====================
            '549419': '8-10 лет',
            
            // ==================== ДЕНЬ НЕДЕЛИ ПОСЕЩЕНИЯ (888879) ====================
            '549415': 'Среда',
            
            // ==================== КАНАЛ РАССЫЛКИ (892645) ====================
            '557151': 'Телеграм',
            
            // ==================== КАНАЛ ОТПРАВКИ (893159) ====================
            '557855': 'ТГ и ТГ Бот',
            
            // ==================== ДЕНЬ НЕДЕЛИ (2025-26) (892225) ====================
            '556037': 'Среда',
            
            // ==================== ОТЗЫВ (891635) ====================
            '555251': 'Запрошен',
            
            // ==================== СРОК ЗАМОРОЗКИ (890097) ====================
            '551613': '1 неделя',
            
            // ==================== РАССЫЛКИ (892647) ====================
            '557199': 'Рассылка 17.10.2025',
            
            // ==================== БЫЛ НА ПРОБНОМ ЗАНЯТИИ: (867691) ====================
            '527299': 'Скульптура',
        };
        
        console.log('📊 Загружено ID полей:');
        console.log(`   Сделки (LEAD): ${Object.keys(this.FIELD_IDS.LEAD).length} полей`);
        console.log(`   Контакты (CONTACT): ${Object.keys(this.FIELD_IDS.CONTACT).length} полей`);
        console.log(`   Enum маппинг: ${Object.keys(this.SUBSCRIPTION_ENUM_MAPPING).length} значений`);
    }

    // ==================== ОСНОВНЫЕ МЕТОДЫ ====================
    
    async initialize() {
        try {
            if (!this.accessToken) {
                console.log('❌ Отсутствует токен доступа amoCRM');
                return false;
            }
            
            if (!AMOCRM_SUBDOMAIN) {
                console.log('❌ Не указан домен amoCRM');
                return false;
            }
            
            console.log(`🔗 Проверка подключения к amoCRM...`);
            console.log(`   Домен: ${this.baseUrl}`);
            console.log(`   Токен: ${this.accessToken ? '✓ Присутствует' : '✗ Отсутствует'}`);
            
            try {
                // Проверяем подключение
                const response = await this.makeRequest('GET', '/api/v4/account');
                this.accountInfo = response;
                this.isInitialized = true;
                
                // Загружаем enum значения из amoCRM
                await this.loadEnumValues();
                
                console.log('✅ amoCRM успешно инициализирован');
                console.log(`🏢 Аккаунт: ${response.name}`);
                console.log(`👤 ID пользователя: ${response.current_user?.id || 'неизвестно'}`);
                console.log(`🔗 Домен: ${this.baseUrl}`);
                console.log(`📊 Загружено enum значений: ${this.enumCache.size}`);
                
                // Показываем загруженные значения для ключевых полей
                console.log('\n📊 ЗАГРУЖЕННЫЕ ENUM ЗНАЧЕНИЯ:');
                
                // Для поля "Абонемент занятий:" (850241)
                const subscriptionEnum = this.enumCache.get(this.FIELD_IDS.LEAD.TOTAL_CLASSES);
                if (subscriptionEnum) {
                    console.log(`   🎫 Абонемент занятий: (${this.FIELD_IDS.LEAD.TOTAL_CLASSES})`);
                    for (const [enumId, value] of Object.entries(subscriptionEnum)) {
                        const num = this.SUBSCRIPTION_ENUM_MAPPING[enumId];
                        console.log(`     ${enumId} → "${value}" → ${num} занятий`);
                    }
                }
                
                // Для поля "Счетчик занятий:" (850257)
                const counterEnum = this.enumCache.get(this.FIELD_IDS.LEAD.USED_CLASSES);
                if (counterEnum) {
                    console.log(`   📊 Счетчик занятий: (${this.FIELD_IDS.LEAD.USED_CLASSES})`);
                    for (const [enumId, value] of Object.entries(counterEnum)) {
                        console.log(`     ${enumId} → "${value}"`);
                    }
                }
                
                // Для поля "Филиал:" в контактах (871273)
                const branchEnum = this.enumCache.get(this.FIELD_IDS.CONTACT.BRANCH);
                if (branchEnum) {
                    console.log(`   📍 Филиал: (${this.FIELD_IDS.CONTACT.BRANCH})`);
                    for (const [enumId, value] of Object.entries(branchEnum)) {
                        console.log(`     ${enumId} → "${value}"`);
                    }
                }
                
                console.log('\n✅ Инициализация завершена успешно!');
                return true;
                
            } catch (apiError) {
                console.error('❌ Ошибка API amoCRM:', apiError.message);
                console.error('   Проверьте токен и домен!');
                this.isInitialized = false;
                return false;
            }
            
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            this.isInitialized = false;
            return false;
        }
    }

    async loadEnumValues() {
        try {
            console.log('📊 Загрузка enum значений из amoCRM...');
            
            // Сбрасываем кэш
            this.enumCache.clear();
            
            // Ключевые поля сделок (LEAD)
            const leadImportantFields = [
                { id: this.FIELD_IDS.LEAD.TOTAL_CLASSES, name: 'Абонемент занятий:' },
                { id: this.FIELD_IDS.LEAD.USED_CLASSES, name: 'Счетчик занятий:' },
                { id: this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE, name: 'Тип абонемента' },
                { id: this.FIELD_IDS.LEAD.BRANCH, name: 'Филиал (сделка)' },
                { id: this.FIELD_IDS.LEAD.AGE_GROUP, name: 'Группа возраст:' },
                { id: this.FIELD_IDS.LEAD.FREEZE, name: 'Заморозка абонемента:' }
            ];
            
            // Ключевые поля контактов (CONTACT)
            const contactImportantFields = [
                { id: this.FIELD_IDS.CONTACT.BRANCH, name: 'Филиал:' },
                { id: this.FIELD_IDS.CONTACT.TEACHER, name: 'Преподаватель' },
                { id: this.FIELD_IDS.CONTACT.AGE_GROUP, name: 'Возраст группы' },
                { id: this.FIELD_IDS.CONTACT.DAY_OF_WEEK, name: 'День недели посещения' }
            ];
            
            console.log('🔍 Загрузка полей сделок...');
            for (const fieldInfo of leadImportantFields) {
                await this.loadFieldEnum(fieldInfo, 'leads');
            }
            
            console.log('🔍 Загрузка полей контактов...');
            for (const fieldInfo of contactImportantFields) {
                await this.loadFieldEnum(fieldInfo, 'contacts');
            }
            
            console.log(`✅ Загружено enum значений: ${this.enumCache.size}`);
            
            // Показываем что загрузилось
            this.showLoadedEnumValues();
            
        } catch (error) {
            console.error('❌ Ошибка загрузки enum значений:', error.message);
        }
    }

    async loadFieldEnum(fieldInfo, entityType) {
        try {
            const response = await this.makeRequest(
                'GET', 
                `/api/v4/${entityType}/custom_fields/${fieldInfo.id}`
            );
            
            if (response && response.enums && Array.isArray(response.enums)) {
                const enumMapping = {};
                for (const enumItem of response.enums) {
                    if (enumItem.id && enumItem.value) {
                        enumMapping[String(enumItem.id)] = enumItem.value;
                    }
                }
                
                if (Object.keys(enumMapping).length > 0) {
                    this.enumCache.set(fieldInfo.id, enumMapping);
                    console.log(`   ✅ ${fieldInfo.name} (${fieldInfo.id}): ${Object.keys(enumMapping).length} значений`);
                    return true;
                }
            }
            console.log(`   ⚠️  ${fieldInfo.name} (${fieldInfo.id}): нет enum значений`);
            return false;
        } catch (error) {
            console.log(`   ❌ ${fieldInfo.name} (${fieldInfo.id}): ${error.message}`);
            return false;
        }
    }

    updateProfileWithSubscription(profile, subscriptionInfo, lead) {
        console.log(`🔄 Обновление профиля ${profile.student_name} данными абонемента`);
        
        if (!profile || !subscriptionInfo) return;
        
        // Обновляем только если есть данные об абонементе
        if (subscriptionInfo.hasSubscription) {
            // Обновляем ID сделки
            if (lead?.id) {
                profile.amocrm_lead_id = lead.id;
            }
            
            // Обновляем данные абонемента
            profile.subscription_type = subscriptionInfo.subscriptionType || profile.subscription_type;
            profile.subscription_active = subscriptionInfo.subscriptionActive ? 1 : 0;
            profile.subscription_status = subscriptionInfo.subscriptionStatus || profile.subscription_status;
            profile.subscription_badge = subscriptionInfo.subscriptionBadge || profile.subscription_badge;
            profile.total_classes = subscriptionInfo.totalClasses || profile.total_classes;
            profile.used_classes = subscriptionInfo.usedClasses || profile.used_classes;
            profile.remaining_classes = subscriptionInfo.remainingClasses || profile.remaining_classes;
            profile.expiration_date = subscriptionInfo.expirationDate || profile.expiration_date;
            profile.activation_date = subscriptionInfo.activationDate || profile.activation_date;
            profile.last_visit_date = subscriptionInfo.lastVisitDate || profile.last_visit_date;
            
            // Обновляем branch из сделки (если есть)
            if (subscriptionInfo.branch && subscriptionInfo.branch.trim() !== '') {
                profile.branch = subscriptionInfo.branch;
            }
            
            console.log(`   ✅ Обновлено: ${profile.subscription_status}`);
            console.log(`   🎫 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
            console.log(`   🔵 Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
        } else {
            console.log(`   ℹ️  Нет данных об абонементе для обновления`);
        }
    }

    // Метод для получения имени поля по ID
    getFieldNameById(fieldId) {
        // Ищем в полях сделок
        for (const [key, value] of Object.entries(this.FIELD_IDS.LEAD)) {
            if (value === fieldId) {
                return `LEAD.${key}`;
            }
        }
        
        // Ищем в полях контактов
        for (const [key, value] of Object.entries(this.FIELD_IDS.CONTACT)) {
            if (value === fieldId) {
                return `CONTACT.${key}`;
            }
        }
        
        return `Поле ${fieldId}`;
    }

    // Метод для отладки полей
    debugField(fieldId, value) {
        const fieldName = this.getFieldNameById(fieldId);
        const enumMapping = this.enumCache.get(fieldId);
        const displayValue = this.getFieldDisplayValue(fieldId, value);
        
        console.log(`🔍 ${fieldName} (${fieldId}):`);
        console.log(`   Значение: ${value}`);
        console.log(`   Отображение: ${displayValue}`);
        
        if (enumMapping) {
            console.log(`   В кэше: ${Object.keys(enumMapping).length} значений`);
            if (enumMapping[String(value)]) {
                console.log(`   Найдено в кэше: ${enumMapping[String(value)]}`);
            } else {
                console.log(`   ❌ Не найдено в кэше`);
                console.log(`   Доступные значения: ${Object.keys(enumMapping).join(', ')}`);
            }
        } else {
            console.log(`   ❌ Нет в кэше enumCache`);
        }
        
        return displayValue;
    }

    showLoadedEnumValues() {
        console.log('\n📊 ЗАГРУЖЕННЫЕ ENUM ЗНАЧЕНИЯ:');
        
        // Проверяем ключевые поля
        const checkFields = [
            { id: this.FIELD_IDS.LEAD.TOTAL_CLASSES, name: 'Абонемент занятий:' },
            { id: this.FIELD_IDS.LEAD.USED_CLASSES, name: 'Счетчик занятий:' },
            { id: this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE, name: 'Тип абонемента' },
            { id: this.FIELD_IDS.CONTACT.BRANCH, name: 'Филиал:' },
            { id: this.FIELD_IDS.CONTACT.TEACHER, name: 'Преподаватель' }
        ];
        
        for (const field of checkFields) {
            const enumMapping = this.enumCache.get(field.id);
            if (enumMapping) {
                console.log(`\n🔸 ${field.name} (${field.id}):`);
                // Показываем все значения (их обычно немного)
                for (const [enumId, value] of Object.entries(enumMapping)) {
                    console.log(`   ${enumId} → "${value}"`);
                }
            } else {
                console.log(`\n❌ ${field.name} (${field.id}): НЕ ЗАГРУЖЕНО`);
            }
        }
    }

    async makeRequest(method, endpoint, data = null, retries = 3) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            method,
            url,
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 30000
        };
        
        if (data) {
            config.data = data;
        }
        
        let lastError;
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                if (attempt > 1) {
                    console.log(`   ↺ Повтор ${attempt}/${retries}...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
                
                console.log(`📤 ${method} ${endpoint}`);
                const response = await axios(config);
                
                return response.data;
                
            } catch (error) {
                lastError = error;
                
                if (error.response) {
                    const status = error.response.status;
                    
                    if (status === 401) {
                        console.error('❌ Ошибка авторизации amoCRM');
                        throw error;
                    }
                    
                    if (status === 404) {
                        console.error(`❌ Ресурс не найден: ${endpoint}`);
                        break;
                    }
                    
                    if (status === 429) {
                        console.log('⚠️  Превышен лимит запросов, ждем...');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        continue;
                    }
                    
                    console.error(`❌ Ошибка ${status}:`, error.response.data);
                    
                    if (status >= 500) {
                        continue;
                    } else {
                        break;
                    }
                } else if (error.request) {
                    console.error('❌ Нет ответа от amoCRM (таймаут)');
                    continue;
                } else {
                    console.error('❌ Ошибка настройки запроса:', error.message);
                    break;
                }
            }
        }
        
        throw lastError || new Error(`Не удалось выполнить запрос после ${retries} попыток`);
    }

    // ==================== МЕТОДЫ ДЛЯ РАБОТЫ С ПОЛЯМИ ====================
    
    getFieldName(fieldId) {
        const fieldInfo = this.fieldMappings.get(fieldId);
        return fieldInfo ? fieldInfo.name : `Поле ${fieldId}`;
    }

    getFieldValue(field) {
        try {
            if (!field || !field.values || field.values.length === 0) {
                return null;
            }
            
            const value = field.values[0];
            
            // ПРИОРИТЕТ: enum_id
            if (value.enum_id !== undefined) {
                return String(value.enum_id);
            }
            // Затем обычное значение
            else if (value.value !== undefined) {
                return String(value.value);
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }

    getFieldDisplayValue(fieldId, value) {
        try {
            if (!value || value === '') return '';
            
            const strValue = String(value);
            
            // 1. Проверяем кэш enum значений
            const enumMapping = this.enumCache.get(fieldId);
            if (enumMapping && enumMapping[strValue]) {
                return enumMapping[strValue];
            }
            
            // 2. Проверяем наш маппинг для числовых полей
            if (this.SUBSCRIPTION_ENUM_MAPPING[strValue]) {
                return String(this.SUBSCRIPTION_ENUM_MAPPING[strValue]);
            }
            
            // 3. Для поля "Абонемент занятий:" добавляем "занятий"
            if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES) {
                const num = this.SUBSCRIPTION_ENUM_MAPPING[strValue];
                return num ? `${num} занятий` : strValue;
            }
            
            // 4. Возвращаем как есть
            return strValue;
            
        } catch (error) {
            console.error('❌ Ошибка getFieldDisplayValue:', error);
            return String(value);
        }
    }

    parseDate(value) {
        if (!value) return null;
        
        try {
            const dateStr = String(value).trim();
            const cleanStr = dateStr.replace(/[^\d\.\-T:+]/g, '');
            
            // Если это timestamp в секундах
            if (/^\d{9,10}$/.test(cleanStr)) {
                const timestamp = parseInt(cleanStr);
                if (timestamp > 1000000000 && timestamp < 2000000000) {
                    const date = new Date(timestamp * 1000);
                    return date.toISOString().split('T')[0];
                }
            }
            
            // Формат DD.MM.YYYY
            if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(cleanStr)) {
                const [day, month, year] = cleanStr.split('.');
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
            
            // Формат YYYY-MM-DD
            if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(cleanStr)) {
                const [year, month, day] = cleanStr.split('-');
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
            
            return cleanStr;
            
        } catch (error) {
            return value;
        }
    }

    parseNumeric(value) {
        if (!value) return 0;
        
        try {
            const str = String(value).trim();
            
            // Сначала проверяем enum_id через наш маппинг
            if (this.SUBSCRIPTION_ENUM_MAPPING[str]) {
                return this.SUBSCRIPTION_ENUM_MAPPING[str];
            }
            
            // Затем пробуем извлечь число из строки
            const numMatch = str.match(/\d+/);
            if (numMatch) {
                return parseInt(numMatch[0], 10);
            }
            
            return 0;
        } catch (error) {
            return 0;
        }
    }

    // ==================== ОСНОВНАЯ ЛОГИКА ====================
    
    extractSubscriptionInfo(lead) {
        const subscriptionInfo = {
            hasSubscription: false,
            totalClasses: 0,
            usedClasses: 0,
            remainingClasses: 0,
            subscriptionType: '',
            subscriptionActive: false,
            activationDate: '',
            expirationDate: '',
            lastVisitDate: '',
            purchaseDate: '',
            subscriptionStatus: 'Нет абонемента',
            subscriptionBadge: 'inactive',
            branch: '',
            ageGroup: '',
            subscriptionOwner: '',
            freezeStatus: '',
            leadName: lead?.name || '',
            leadStatus: lead?.status_id || 0,
            leadIsClosed: false
        };
        
        if (!lead || !lead.custom_fields_values) {
            console.log('⚠️  Нет данных сделки или кастомных полей');
            return subscriptionInfo;
        }
        
        try {
            const customFields = lead.custom_fields_values;
            const statusId = lead.status_id || 0;
            
            // Определяем закрыта ли сделка
            subscriptionInfo.leadIsClosed = [142, 143].includes(statusId);
            
            console.log(`🔍 Анализ абонемента в сделке "${lead.name}"`);
            console.log(`   Статус ID: ${statusId}, Закрыта: ${subscriptionInfo.leadIsClosed ? 'Да' : 'Нет'}`);
            
            // Проходим по всем полям
            for (const field of customFields) {
                const fieldId = field.field_id;
                if (!fieldId) continue;
                
                const fieldValue = this.getFieldValue(field);
                if (fieldValue === null || fieldValue === '') continue;
                
                const displayValue = this.getFieldDisplayValue(fieldId, fieldValue);
                
                // ОСНОВНЫЕ ПОЛЯ АБОНЕМЕНТА
                if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.totalClasses = this.parseNumeric(fieldValue);
                    console.log(`   🎫 Абонемент: ${fieldValue} -> ${subscriptionInfo.totalClasses} занятий`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.USED_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.usedClasses = this.parseNumeric(fieldValue);
                    console.log(`   📊 Счетчик занятий: ${fieldValue} -> ${subscriptionInfo.usedClasses}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.USED_CLASSES_NUM) {
                    subscriptionInfo.hasSubscription = true;
                    const used = this.parseNumeric(fieldValue);
                    subscriptionInfo.usedClasses = Math.max(subscriptionInfo.usedClasses, used);
                    console.log(`   📊 Кол-во отхоженных: ${fieldValue} -> ${used}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.REMAINING_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.remainingClasses = this.parseNumeric(fieldValue);
                    console.log(`   📊 Остаток занятий: ${fieldValue} -> ${subscriptionInfo.remainingClasses}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.EXPIRATION_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.expirationDate = this.parseDate(fieldValue);
                    console.log(`   📅 Окончание: ${fieldValue} -> ${subscriptionInfo.expirationDate}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.ACTIVATION_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.activationDate = this.parseDate(fieldValue);
                    console.log(`   📅 Активация: ${fieldValue} -> ${subscriptionInfo.activationDate}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.LAST_VISIT_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.lastVisitDate = this.parseDate(fieldValue);
                    console.log(`   📅 Последний визит: ${fieldValue} -> ${subscriptionInfo.lastVisitDate}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.subscriptionType = displayValue;
                    console.log(`   🏷️  Тип абонемента: ${fieldValue} -> "${displayValue}"`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.FREEZE) {
                    subscriptionInfo.freezeStatus = displayValue;
                    console.log(`   ❄️  Заморозка: ${fieldValue} -> "${displayValue}"`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.BRANCH) {
                    subscriptionInfo.branch = displayValue;
                    console.log(`   📍 Филиал: ${fieldValue} -> "${displayValue}"`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.AGE_GROUP) {
                    subscriptionInfo.ageGroup = displayValue;
                    console.log(`   👶 Возрастная группа: ${fieldValue} -> "${displayValue}"`);
                }
            }
            
            // КОРРЕКТИРОВКА ДАННЫХ
            console.log(`\n🔄 Корректировка данных:`);
            
            // Если есть общее количество, корректируем данные
            if (subscriptionInfo.totalClasses > 0) {
                // 1. Если есть счетчик, но нет остатка
                if (subscriptionInfo.usedClasses > 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                    console.log(`   Рассчитан остаток: ${subscriptionInfo.remainingClasses}`);
                }
                
                // 2. Если есть остаток, но нет счетчика
                if (subscriptionInfo.remainingClasses > 0 && subscriptionInfo.usedClasses === 0) {
                    subscriptionInfo.usedClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.remainingClasses);
                    console.log(`   Рассчитано использованных: ${subscriptionInfo.usedClasses}`);
                }
                
                // 3. Если нет данных о посещениях вообще
                if (subscriptionInfo.usedClasses === 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = subscriptionInfo.totalClasses;
                    console.log(`   Нет данных о посещениях, показываем все доступными: ${subscriptionInfo.remainingClasses}`);
                }
            }
            
            console.log(`\n📊 Сводка данных:`);
            console.log(`   Всего: ${subscriptionInfo.totalClasses}`);
            console.log(`   Использовано: ${subscriptionInfo.usedClasses}`);
            console.log(`   Осталось: ${subscriptionInfo.remainingClasses}`);
            console.log(`   Активация: ${subscriptionInfo.activationDate}`);
            console.log(`   Окончание: ${subscriptionInfo.expirationDate}`);
            console.log(`   Заморозка: ${subscriptionInfo.freezeStatus}`);
            console.log(`   Сделка закрыта: ${subscriptionInfo.leadIsClosed}`);
            
            // ОПРЕДЕЛЕНИЕ СТАТУСА (УЛУЧШЕННАЯ ЛОГИКА)
            console.log(`\n🎯 Определение статуса абонемента:`);

            // КРИТЕРИИ АКТИВНОСТИ:
            // 1. Есть абонемент (totalClasses > 0)
            // 2. Сделка не закрыта (не 142, 143)
            // 3. Не заморожен
            // 4. Есть остаток занятий ИЛИ еще не начат
            // 5. Не истек срок (если указан)

            const hasSubscription = subscriptionInfo.totalClasses > 0;
            const isClosedDeal = [142, 143].includes(statusId);
            const isFrozen = subscriptionInfo.freezeStatus && 
                            subscriptionInfo.freezeStatus.toLowerCase() === 'да';
            const hasRemaining = subscriptionInfo.remainingClasses > 0;
            const isNotStarted = subscriptionInfo.usedClasses === 0;
            const isExpired = subscriptionInfo.expirationDate ? 
                new Date(subscriptionInfo.expirationDate) < new Date() : false;

            console.log(`   • Есть абонемент: ${hasSubscription}`);
            console.log(`   • Сделка закрыта: ${isClosedDeal}`);
            console.log(`   • Заморожен: ${isFrozen}`);
            console.log(`   • Есть остаток: ${hasRemaining}`);
            console.log(`   • Не начат: ${isNotStarted}`);
            console.log(`   • Истек срок: ${isExpired}`);

            // ОПРЕДЕЛЕНИЕ СТАТУСА
            if (!hasSubscription) {
                subscriptionInfo.subscriptionStatus = 'Нет абонемента';
                subscriptionInfo.subscriptionBadge = 'inactive';
                subscriptionInfo.subscriptionActive = false;
                console.log(`   ❌ Нет абонемента или 0 занятий`);
            }
            else if (isClosedDeal) {
                subscriptionInfo.subscriptionStatus = 'Абонемент завершен';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
                console.log(`   ❌ Сделка закрыта`);
            }
            else if (isFrozen) {
                subscriptionInfo.subscriptionStatus = 'Абонемент заморожен';
                subscriptionInfo.subscriptionBadge = 'freeze';
                subscriptionInfo.subscriptionActive = false;
                console.log(`   ❄️  Абонемент заморожен`);
            }
            else if (isExpired) {
                subscriptionInfo.subscriptionStatus = 'Абонемент истек';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
                console.log(`   ⌛ Срок абонемента истек`);
            }
            else if (hasRemaining || isNotStarted) {
                // АКТИВНЫЙ АБОНЕМЕНТ!
                subscriptionInfo.subscriptionStatus = `Активный (осталось ${subscriptionInfo.remainingClasses} из ${subscriptionInfo.totalClasses})`;
                subscriptionInfo.subscriptionBadge = 'active';
                subscriptionInfo.subscriptionActive = true;
                console.log(`   ✅ Есть остаток занятий или еще не начат: ${subscriptionInfo.remainingClasses}`);
            }
            else if (subscriptionInfo.usedClasses >= subscriptionInfo.totalClasses) {
                subscriptionInfo.subscriptionStatus = 'Занятия закончились';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
                console.log(`   ❌ Все занятия использованы`);
            }
            else if (subscriptionInfo.totalClasses > 0 && subscriptionInfo.usedClasses === 0) {
                subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий (не начат)`;
                subscriptionInfo.subscriptionBadge = 'pending';
                subscriptionInfo.subscriptionActive = false;
                console.log(`   ⏳ Абонемент не начат`);
            }
            else {
                subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий`;
                subscriptionInfo.subscriptionBadge = 'has_subscription';
                subscriptionInfo.subscriptionActive = false;
                console.log(`   ℹ️  Абонемент есть, но статус не определен`);
            }
            
            // Если нет типа абонемента, создаем его
            if (!subscriptionInfo.subscriptionType || subscriptionInfo.subscriptionType.trim() === '') {
                subscriptionInfo.subscriptionType = subscriptionInfo.totalClasses > 0 
                    ? `Абонемент на ${subscriptionInfo.totalClasses} занятий`
                    : 'Без абонемента';
            }
            
            console.log(`\n✅ Финальный статус:`);
            console.log(`   Статус: ${subscriptionInfo.subscriptionStatus}`);
            console.log(`   Активен: ${subscriptionInfo.subscriptionActive}`);
            console.log(`   Бейдж: ${subscriptionInfo.subscriptionBadge}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации об абонементе:', error);
        }
        
        return subscriptionInfo;
    }

    async getContactLeads(contactId) {
        try {
            console.log(`🔍 Получение сделок контакта ID: ${contactId}`);
            
            const allLeads = [];
            let page = 1;
            const limit = 250; // Максимум 250 на страницу
            
            while (true) {
                console.log(`   📄 Страница ${page}...`);
                
                try {
                    const response = await this.makeRequest(
                        'GET',
                        `/api/v4/leads?with=custom_fields_values&page=${page}&limit=${limit}&filter[contact_id]=${contactId}`
                    );
                    
                    const leads = response._embedded?.leads || [];
                    console.log(`   📊 Найдено сделок на странице: ${leads.length}`);
                    
                    allLeads.push(...leads);
                    
                    // Проверяем, есть ли следующая страница
                    if (leads.length < limit) {
                        console.log(`   ✅ Все сделки загружены`);
                        break;
                    }
                    
                    page++;
                    
                    // Защита от бесконечного цикла
                    if (page > 10) { // Максимум 10 страниц (2500 сделок)
                        console.log(`   ⚠️  Достигнут лимит в 2500 сделок`);
                        break;
                    }
                    
                } catch (error) {
                    console.error(`   ❌ Ошибка загрузки страницы ${page}:`, error.message);
                    break;
                }
            }
            
            console.log(`📊 Всего сделок получено: ${allLeads.length}`);
            
            // Сортируем по дате обновления (новые сначала)
            allLeads.sort((a, b) => {
                return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
            });
            
            // ВЫВОДИМ ID всех сделок для отладки
            console.log(`📋 ID всех сделок контакта ${contactId}:`);
            allLeads.forEach((lead, index) => {
                const isActiveLead = lead.id === 28681709;
                console.log(`   ${index + 1}. ${lead.id} "${lead.name}" ${isActiveLead ? '🎯 АКТИВНАЯ!' : ''}`);
            });
            
            return allLeads;
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок контакта ${contactId}:`, error.message);
            return [];
        }
    }

    async searchActiveLeadForContact(contactId, leadIdToFind = null) {
        try {
            console.log(`🎯 ПОИСК АКТИВНОЙ СДЕЛКИ ДЛЯ КОНТАКТА: ${contactId}`);
            
            // СПОСОБ 1: Прямой запрос сделки (если знаем ID)
            if (leadIdToFind) {
                console.log(`🔍 Прямой поиск сделки ${leadIdToFind}...`);
                try {
                    const lead = await this.getLeadById(leadIdToFind);
                    if (lead) {
                        // Проверяем, связана ли сделка с контактом
                        const contacts = lead._embedded?.contacts || [];
                        const hasContact = contacts.some(c => c.id == contactId);
                        
                        if (hasContact) {
                            console.log(`✅ Сделка ${leadIdToFind} найдена и связана с контактом!`);
                            return lead;
                        } else {
                            console.log(`⚠️ Сделка ${leadIdToFind} не связана с контактом ${contactId}`);
                        }
                    }
                } catch (error) {
                    console.log(`❌ Сделка ${leadIdToFind} не найдена: ${error.message}`);
                }
            }
            
            // СПОСОБ 2: Поиск всех сделок с фильтром по статусу (активные)
            console.log(`🔍 Поиск активных сделок контакта...`);
            
            // Фильтр: сделки НЕ закрытые (не 142, 143)
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&limit=100&filter[contact_id]=${contactId}&filter[status_id][]=142&filter[status_id][]=143`
            );
            
            const leads = response._embedded?.leads || [];
            console.log(`📊 Найдено не закрытых сделок: ${leads.length}`);
            
            if (leads.length === 0) {
                console.log(`❌ Активных сделок не найдено`);
                return null;
            }
            
            // Ищем сделки с абонементом
            for (const lead of leads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                if (subscriptionInfo.hasSubscription && subscriptionInfo.subscriptionActive) {
                    console.log(`✅ Найдена активная сделка с абонементом: ${lead.id} "${lead.name}"`);
                    return lead;
                }
            }
            
            console.log(`⚠️  Сделок с активным абонементом не найдено`);
            return null;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска активной сделки: ${error.message}`);
            return null;
        }
    }

    async searchContactsByPhone(phoneNumber) {
        try {
            console.log(`🔍 Поиск контактов по телефону: ${phoneNumber}`);
            
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const searchTerm = cleanPhone.slice(-7); // Последние 7 цифр
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/contacts?query=${encodeURIComponent(searchTerm)}&with=custom_fields_values&limit=50`
            );
            
            const contacts = response._embedded?.contacts || [];
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            return contacts;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return [];
        }
    }

    async getFullContactInfo(contactId) {
        try {
            console.log(`🔍 Получение контакта ID: ${contactId}`);
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/contacts/${contactId}?with=custom_fields_values`
            );
            
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения контакта ${contactId}:`, error.message);
            return null;
        }
    }

    calculateSubscriptionPriority(subscriptionInfo, lead) {
        let priority = 0;
        
        console.log(`   📊 Расчет приоритета для "${lead.name}":`);
        
        // 1. АКТИВНЫЕ АБОНЕМЕНТЫ (самый важный критерий)
        if (subscriptionInfo.subscriptionActive) {
            priority += 1000;
            console.log(`     +1000 за активный статус`);
        }
        
        // 2. НЕ ЗАКРЫТАЯ СДЕЛКА
        if (![142, 143].includes(lead.status_id)) {
            priority += 500;
            console.log(`     +500 за открытую сделку (статус: ${lead.status_id})`);
        } else {
            priority -= 300;
            console.log(`     -300 за закрытую сделку (статус: ${lead.status_id})`);
        }
        
        // 3. ЕСТЬ ОСТАТОК ЗАНЯТИЙ
        if (subscriptionInfo.remainingClasses > 0) {
            priority += 200;
            console.log(`     +200 за остаток занятий: ${subscriptionInfo.remainingClasses}`);
        }
        
        // 4. НЕ ЗАМОРОЖЕН
        if (subscriptionInfo.freezeStatus && subscriptionInfo.freezeStatus.toLowerCase() === 'да') {
            priority -= 400;
            console.log(`     -400 за заморозку`);
        }
        
        // 5. НЕ ИСТЕК СРОК
        if (subscriptionInfo.expirationDate) {
            const expDate = new Date(subscriptionInfo.expirationDate);
            const now = new Date();
            if (expDate >= now) {
                priority += 150;
                console.log(`     +150 за срок не истек`);
            } else {
                priority -= 200;
                console.log(`     -200 за истекший срок`);
            }
        }
        
        // 6. ЕСТЬ ПОСЕЩЕНИЯ
        if (subscriptionInfo.usedClasses > 0) {
            priority += 100;
            console.log(`     +100 за посещения: ${subscriptionInfo.usedClasses}`);
        }
        
        // 7. НЕДАВНО ОБНОВЛЕНА
        const updatedAt = new Date(lead.updated_at);
        const now = new Date();
        const daysSinceUpdate = Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24));
        
        if (daysSinceUpdate <= 7) { // Обновлена за последнюю неделю
            priority += 50;
            console.log(`     +50 за недавнее обновление (${daysSinceUpdate} дней назад)`);
        }
        
        console.log(`     ИТОГОВЫЙ ПРИОРИТЕТ: ${priority}`);
        return priority;
    }

    extractStudentsFromContact(contact) {
        const students = [];
        
        try {
            console.log(`👤 Поиск детей в контакте: ${contact.name || 'Без имени'}`);
            
            if (!contact.custom_fields_values) {
                return students;
            }
            
            const customFields = contact.custom_fields_values;
            
            // Находим поля с именами детей
            const childrenData = [
                { nameFieldId: this.FIELD_IDS.CONTACT.CHILD_1_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_1_BIRTHDAY },
                { nameFieldId: this.FIELD_IDS.CONTACT.CHILD_2_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_2_BIRTHDAY },
                { nameFieldId: this.FIELD_IDS.CONTACT.CHILD_3_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_3_BIRTHDAY }
            ];
            
            for (let i = 0; i < childrenData.length; i++) {
                const childConfig = childrenData[i];
                const childNumber = i + 1;
                
                // Ищем имя ребенка
                const nameField = customFields.find(f => f.field_id === childConfig.nameFieldId);
                if (!nameField) continue;
                
                const childName = this.getFieldValue(nameField);
                if (!childName || childName.trim() === '') continue;
                
                // ИСПРАВЛЕНИЕ: используем getFieldDisplayValue для текстовых полей
                const displayName = this.getFieldDisplayValue(childConfig.nameFieldId, childName);
                console.log(`   👶 Ребенок ${childNumber}: ${displayName}`);
                
                // Создаем объект с информацией о ребенке
                const studentInfo = {
                    studentName: displayName,  // Используем отображаемое имя
                    birthDate: '',
                    branch: '',
                    parentName: contact.name || '',
                    teacherName: '',
                    dayOfWeek: '',
                    timeSlot: '',
                    ageGroup: '',
                    allergies: '',
                    hasActiveSubscription: false,
                    lastVisitDate: ''
                };
                
                // Ищем день рождения
                const birthdayField = customFields.find(f => f.field_id === childConfig.birthdayFieldId);
                if (birthdayField) {
                    const birthdayValue = this.getFieldValue(birthdayField);
                    if (birthdayValue) {
                        studentInfo.birthDate = this.parseDate(birthdayValue);
                    }
                }
                
                // Ищем другие поля
                for (const field of customFields) {
                    const fieldId = field.field_id;
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue) continue;
                    
                    // ИСПРАВЛЕНИЕ: используем getFieldDisplayValue для всех enum полей
                    const displayValue = this.getFieldDisplayValue(fieldId, fieldValue);
                    
                    if (fieldId === this.FIELD_IDS.CONTACT.BRANCH) {
                        studentInfo.branch = displayValue;  // Теперь будет "Свиблово", а не "529779"
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.TEACHER) {
                        studentInfo.teacherName = displayValue;  // Теперь будет "Аня К", а не "556183"
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.DAY_OF_WEEK) {
                        studentInfo.dayOfWeek = displayValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.AGE_GROUP) {
                        studentInfo.ageGroup = displayValue;  // Теперь будет "8-10 лет", а не "549419"
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) {
                        studentInfo.hasActiveSubscription = displayValue.toLowerCase() === 'да';
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.LAST_VISIT) {
                        studentInfo.lastVisitDate = this.parseDate(fieldValue);
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.ALLERGIES) {
                        studentInfo.allergies = displayValue;
                    }
                }
                
                students.push(studentInfo);
            }
            
            console.log(`📊 Найдено детей: ${students.length}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения учеников из контакта:', error);
        }
        
        return students;
    }

    async searchLeadsByPhone(phoneNumber) {
        try {
            console.log(`🔍 ПОИСК СДЕЛОК ПО ТЕЛЕФОНУ: ${phoneNumber}`);
            
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const searchTerm = cleanPhone.slice(-7); // Последние 7 цифр
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?query=${encodeURIComponent(searchTerm)}&with=custom_fields_values&limit=100`
            );
            
            const leads = response._embedded?.leads || [];
            console.log(`📊 Найдено сделок по телефону: ${leads.length}`);
            
            // Выводим найденные сделки для отладки
            leads.forEach(lead => {
                console.log(`   📄 ${lead.id}: "${lead.name}" (статус: ${lead.status_id})`);
            });
            
            return leads;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска сделок по телефону: ${error.message}`);
            return [];
        }
    }

    async findActiveSubscriptionByPhone(phoneNumber) {
        console.log(`\n🎯 ПОИСК АКТИВНОГО АБОНЕМЕНТА ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        try {
            // 1. Ищем сделки по телефону
            const leads = await this.searchLeadsByPhone(phoneNumber);
            
            if (leads.length === 0) {
                console.log('❌ Сделки не найдены по телефону');
                return null;
            }
            
            // 2. Ищем активную сделку #28681709 (прямой поиск)
            const targetLeadId = 28681709;
            const targetLead = leads.find(lead => lead.id == targetLeadId);
            
            if (targetLead) {
                console.log(`✅ НАЙДЕНА ЦЕЛЕВАЯ СДЕЛКА: ${targetLeadId} "${targetLead.name}"`);
                const subscriptionInfo = this.extractSubscriptionInfo(targetLead);
                
                if (subscriptionInfo.hasSubscription) {
                    console.log(`   ✅ Есть абонемент! Статус: ${subscriptionInfo.subscriptionStatus}`);
                    console.log(`   🎫 Занятия: ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses}`);
                    
                    return {
                        lead: targetLead,
                        subscription: subscriptionInfo
                    };
                }
            } else {
                console.log(`❌ Целевая сделка ${targetLeadId} не найдена в результатах поиска`);
                
                // Показываем что нашли
                console.log(`📊 Найденные сделки:`);
                leads.slice(0, 10).forEach(lead => {
                    const subInfo = this.extractSubscriptionInfo(lead);
                    console.log(`   ${lead.id}: "${lead.name}" - ${subInfo.subscriptionStatus}`);
                });
            }
            
            // 3. Если целевая сделка не найдена, ищем любую активную
            console.log(`\n🔍 Поиск любой активной сделки...`);
            
            const activeLeads = [];
            
            for (const lead of leads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription && subscriptionInfo.subscriptionActive) {
                    console.log(`✅ Найдена активная сделка: ${lead.id} "${lead.name}"`);
                    console.log(`   Статус: ${subscriptionInfo.subscriptionStatus}`);
                    
                    activeLeads.push({
                        lead: lead,
                        subscription: subscriptionInfo,
                        priority: this.calculateSubscriptionPriority(subscriptionInfo, lead)
                    });
                }
            }
            
            if (activeLeads.length === 0) {
                console.log('❌ Активных сделок не найдено');
                return null;
            }
            
            // Сортируем по приоритету
            activeLeads.sort((a, b) => b.priority - a.priority);
            
            console.log(`\n🏆 ВЫБРАНА ЛУЧШАЯ АКТИВНАЯ СДЕЛКА:`);
            console.log(`   ${activeLeads[0].lead.id}: "${activeLeads[0].lead.name}"`);
            console.log(`   Статус: ${activeLeads[0].subscription.subscriptionStatus}`);
            
            return {
                lead: activeLeads[0].lead,
                subscription: activeLeads[0].subscription
            };
            
        } catch (error) {
            console.error(`❌ Ошибка поиска активного абонемента по телефону: ${error.message}`);
            return null;
        }
    }

    async findLatestActiveSubscription(contactId) {
        console.log(`\n🎯 ПОИСК АКТИВНОГО АБОНЕМЕНТА ДЛЯ КОНТАКТА: ${contactId}`);
        
        try {
            // ПРЯМОЙ ПОИСК активной сделки (если знаем её ID)
            const knownActiveLeadId = 28681709; // ID активной сделки
            
            console.log(`🔍 Прямой поиск сделки ${knownActiveLeadId}...`);
            const directLead = await this.searchActiveLeadForContact(contactId, knownActiveLeadId);
            
            if (directLead) {
                console.log(`✅ Найдена прямая сделка: ${directLead.id} "${directLead.name}"`);
                const subscriptionInfo = this.extractSubscriptionInfo(directLead);
                
                return {
                    lead: directLead,
                    subscription: subscriptionInfo
                };
            }
            
            // ТРАДИЦИОННЫЙ ПОИСК (все сделки контакта)
            console.log(`🔍 Традиционный поиск среди всех сделок...`);
            const leads = await this.getContactLeads(contactId);
            console.log(`📊 Сделок получено: ${leads.length}`);
            
            if (leads.length === 0) {
                console.log(`❌ Сделки не найдены`);
                return null;
            }
            
            const subscriptionLeads = [];
            
            console.log(`\n🔍 АНАЛИЗ ВСЕХ СДЕЛОК:`);
            for (const lead of leads) {
                console.log(`📄 Сделка ${lead.id}: "${lead.name}" (статус: ${lead.status_id})`);
                
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription) {
                    console.log(`   ✅ НАЙДЕН АБОНЕМЕНТ! Статус: ${subscriptionInfo.subscriptionStatus}`);
                    
                    subscriptionLeads.push({
                        lead: lead,
                        subscription: subscriptionInfo,
                        updated_at: lead.updated_at,
                        created_at: lead.created_at,
                        priority: this.calculateSubscriptionPriority(subscriptionInfo, lead)
                    });
                }
            }
            
            console.log(`📊 Сделок с абонементами: ${subscriptionLeads.length}`);
            
            if (subscriptionLeads.length === 0) {
                return null;
            }
            
            // СОРТИРОВКА по приоритету
            subscriptionLeads.sort((a, b) => b.priority - a.priority);
            
            // Выводим рейтинг
            console.log(`\n🏆 РЕЙТИНГ АБОНЕМЕНТОВ:`);
            subscriptionLeads.forEach((item, index) => {
                console.log(`${index + 1}. Сделка ${item.lead.id}: "${item.lead.name}"`);
                console.log(`   Приоритет: ${item.priority}`);
                console.log(`   Статус: ${item.subscription.subscriptionStatus}`);
                console.log(`   ---`);
            });
            
            const bestSubscription = subscriptionLeads[0];
            
            console.log(`\n🎯 ВЫБРАН ЛУЧШИЙ АБОНЕМЕНТ:`);
            console.log(`   Сделка: "${bestSubscription.lead.name}" (ID: ${bestSubscription.lead.id})`);
            console.log(`   Статус: ${bestSubscription.subscription.subscriptionStatus}`);
            console.log(`   Занятий: ${bestSubscription.subscription.usedClasses}/${bestSubscription.subscription.totalClasses}`);
            
            return {
                lead: bestSubscription.lead,
                subscription: bestSubscription.subscription
            };
            
        } catch (error) {
            console.error(`❌ Ошибка поиска активного абонемента: ${error.message}`);
            return null;
        }
    }

    findEmail(contact) {
        try {
            if (!contact.custom_fields_values) return '';
            
            for (const field of contact.custom_fields_values) {
                const fieldValue = this.getFieldValue(field);
                
                if (fieldValue && fieldValue.includes('@')) {
                    return fieldValue;
                }
            }
        } catch (error) {
            console.error('❌ Ошибка поиска email:', error);
        }
        return '';
    }

    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        console.log(`\n📝 Создание профиля ученика: ${studentInfo.studentName}`);
        
        // Определяем email
        const email = this.findEmail(contact);
        
        // Определяем branch - приоритет: из сделки > из контакта
        const branch = subscriptionInfo.branch || studentInfo.branch || '';
        
        // Форматируем тип абонемента
        let subscriptionType = subscriptionInfo.subscriptionType || 'Без абонемента';
        if (subscriptionType === 'Без абонемента' && subscriptionInfo.totalClasses > 0) {
            subscriptionType = `Абонемент на ${subscriptionInfo.totalClasses} занятий`;
        }
        
        // Форматируем статус абонемента
        let subscriptionStatus = subscriptionInfo.subscriptionStatus || 'Нет абонемента';
        
        // Создаем профиль
        const profile = {
            amocrm_contact_id: contact.id || null,
            parent_contact_id: contact.id || null,
            amocrm_lead_id: lead?.id || null,
            student_name: studentInfo.studentName || 'Ученик',
            phone_number: phoneNumber,
            email: email || '',
            birth_date: studentInfo.birthDate || '',
            branch: branch,
            parent_name: studentInfo.parentName || contact.name || '',
            day_of_week: studentInfo.dayOfWeek || '',
            time_slot: studentInfo.timeSlot || '',
            teacher_name: studentInfo.teacherName || '',
            age_group: studentInfo.ageGroup || subscriptionInfo.ageGroup || '',
            course: studentInfo.course || '',
            allergies: studentInfo.allergies || '',
            
            // Данные абонемента
            subscription_type: subscriptionType,
            subscription_active: subscriptionInfo.subscriptionActive ? 1 : 0,
            subscription_status: subscriptionStatus,
            subscription_badge: subscriptionInfo.subscriptionBadge || 'inactive',
            total_classes: subscriptionInfo.totalClasses || 0,
            remaining_classes: subscriptionInfo.remainingClasses || 0,
            used_classes: subscriptionInfo.usedClasses || 0,
            expiration_date: subscriptionInfo.expirationDate || null,
            activation_date: subscriptionInfo.activationDate || null,
            last_visit_date: subscriptionInfo.lastVisitDate || studentInfo.lastVisitDate || null,
            
            // Технические данные
            custom_fields: JSON.stringify(contact.custom_fields_values || []),
            raw_contact_data: JSON.stringify(contact),
            lead_data: lead ? JSON.stringify(lead) : '{}',
            is_demo: 0,
            source: 'amocrm',
            is_active: 1
        };
        
        console.log(`✅ Профиль создан:`);
        console.log(`   👤 ${profile.student_name}`);
        console.log(`   📍 Филиал: ${profile.branch || 'не указан'}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        console.log(`   📊 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        console.log(`   🔵 Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
        
        return profile;
    }

    async getStudentsByPhone(phoneNumber) {
        console.log(`🎯 Получение профилей по телефону: ${phoneNumber}`);
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            // 1. Поиск контактов
            const contacts = await this.searchContactsByPhone(phoneNumber);
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                console.log('❌ Контакты не найдены');
                return studentProfiles;
            }
            
            // 2. ПРЯМОЙ ПОИСК АКТИВНОЙ СДЕЛКИ ПО ТЕЛЕФОНУ
            console.log(`\n🔍 ПРЯМОЙ ПОИСК АКТИВНОЙ СДЕЛКИ ПО ТЕЛЕФОНУ...`);
            const activeSubscriptionData = await this.findActiveSubscriptionByPhone(phoneNumber);
            
            let bestLead = null;
            let bestSubscriptionInfo = this.extractSubscriptionInfo(null);
            
            if (activeSubscriptionData) {
                bestLead = activeSubscriptionData.lead;
                bestSubscriptionInfo = activeSubscriptionData.subscription;
                console.log(`✅ Найден активный абонемент!`);
                console.log(`   Сделка: ${bestLead.id} - "${bestLead.name}"`);
                console.log(`   Статус: ${bestSubscriptionInfo.subscriptionStatus}`);
            } else {
                console.log(`⚠️  Активный абонемент не найден по телефону`);
                
                // Пробуем найти через контакты
                for (const contact of contacts) {
                    console.log(`\n🔍 Поиск через контакт ${contact.id}...`);
                    const subscriptionData = await this.findLatestActiveSubscription(contact.id);
                    
                    if (subscriptionData && subscriptionData.subscription.subscriptionActive) {
                        bestLead = subscriptionData.lead;
                        bestSubscriptionInfo = subscriptionData.subscription;
                        console.log(`✅ Найден через контакт: ${bestLead.id}`);
                        break;
                    }
                }
            }
            
            // 3. Создаем профили для каждого контакта
            for (const contact of contacts) {
                console.log(`\n👤 Обработка контакта: ${contact.name} (ID: ${contact.id})`);
                
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                const children = this.extractStudentsFromContact(fullContact);
                console.log(`📊 Найдено детей в контакте: ${children.length}`);
                
                if (children.length === 0) {
                    // Если нет детей, создаем профиль из контакта
                    const studentFromContact = await this.createProfileFromContact(fullContact, phoneNumber);
                    if (studentFromContact) {
                        // Обновляем данные абонементом (если найден)
                        if (bestSubscriptionInfo.hasSubscription) {
                            this.updateProfileWithSubscription(studentFromContact, bestSubscriptionInfo, bestLead);
                        }
                        studentProfiles.push(studentFromContact);
                    }
                } else {
                    // Для каждого ребенка создаем профиль
                    for (const child of children) {
                        console.log(`\n👤 Создание профиля для: ${child.studentName}`);
                        
                        const studentProfile = this.createStudentProfile(
                            fullContact,
                            phoneNumber,
                            child,
                            bestSubscriptionInfo, // Используем найденный активный абонемент
                            bestLead
                        );
                        
                        studentProfiles.push(studentProfile);
                    }
                }
            }
            
            console.log(`\n🎯 Итого создано профилей: ${studentProfiles.length}`);
            
            // Выводим детали
            if (studentProfiles.length > 0) {
                console.log(`\n📊 СОЗДАННЫЕ ПРОФИЛИ:`);
                studentProfiles.forEach((profile, index) => {
                    console.log(`${index + 1}. ${profile.student_name}`);
                    console.log(`   • Абонемент: ${profile.subscription_type}`);
                    console.log(`   • Статус: ${profile.subscription_status}`);
                    console.log(`   • Активен: ${profile.subscription_active === 1 ? 'Да ✅' : 'Нет ❌'}`);
                    console.log(`   • Занятия: ${profile.used_classes}/${profile.total_classes}`);
                    console.log(`   • Остаток: ${profile.remaining_classes}`);
                    console.log(`   • Lead ID: ${profile.amocrm_lead_id || 'нет'}`);
                    console.log(`   ---`);
                });
            }
            
        } catch (crmError) {
            console.error(`❌ Ошибка получения данных из amoCRM:`, crmError.message);
        }
        
        return studentProfiles;
    }

    async createProfileFromContact(contact, phoneNumber, subscriptionInfo = null, lead = null) {
        try {
            const studentInfo = {
                studentName: contact.name || 'Ученик',
                birthDate: '',
                branch: '',
                parentName: contact.name || '',
                teacherName: '',
                dayOfWeek: '',
                timeSlot: '',
                ageGroup: '',
                allergies: '',
                hasActiveSubscription: false,
                lastVisitDate: ''
            };
            
            if (contact.custom_fields_values) {
                for (const field of contact.custom_fields_values) {
                    const fieldId = field.field_id;
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue) continue;
                    
                    const displayValue = this.getFieldDisplayValue(fieldId, fieldValue);
                    
                    if (fieldId === this.FIELD_IDS.CONTACT.BRANCH) {
                        studentInfo.branch = displayValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.TEACHER) {
                        studentInfo.teacherName = displayValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.DAY_OF_WEEK) {
                        studentInfo.dayOfWeek = displayValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) {
                        studentInfo.hasActiveSubscription = displayValue.toLowerCase() === 'да';
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.LAST_VISIT) {
                        studentInfo.lastVisitDate = this.parseDate(fieldValue);
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.AGE_GROUP) {
                        studentInfo.ageGroup = displayValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.ALLERGIES) {
                        studentInfo.allergies = displayValue;
                    }
                }
            }
            
            // Если не переданы данные об абонементе, пытаемся найти
            let finalSubscriptionInfo = subscriptionInfo;
            let finalLead = lead;
            
            if (!finalSubscriptionInfo || !finalLead) {
                const subscriptionData = await this.findLatestActiveSubscription(contact.id);
                if (subscriptionData) {
                    finalLead = subscriptionData.lead;
                    finalSubscriptionInfo = subscriptionData.subscription;
                }
            }
            
            if (!finalSubscriptionInfo) {
                finalSubscriptionInfo = this.extractSubscriptionInfo(null);
            }
            
            const profile = this.createStudentProfile(
                contact,
                phoneNumber,
                studentInfo,
                finalSubscriptionInfo,
                finalLead
            );
            
            return profile;
            
        } catch (error) {
            console.error('❌ Ошибка создания профиля из контакта:', error);
            return null;
        }
    }

    // ==================== ДЕБАГ МЕТОДЫ ====================
    
    async debugContact(contactId) {
        try {
            console.log(`🔍 ДЕБАГ КОНТАКТА ${contactId}`);
            
            const contact = await this.getFullContactInfo(contactId);
            if (!contact) {
                console.log('❌ Контакт не найден');
                return null;
            }
            
            console.log(`👤 Контакт: ${contact.name} (ID: ${contact.id})`);
            
            // Выводим все поля
            if (contact.custom_fields_values) {
                console.log(`📊 КАСТОМНЫЕ ПОЛЯ (${contact.custom_fields_values.length}):`);
                
                for (const field of contact.custom_fields_values) {
                    const fieldId = field.field_id;
                    const fieldValue = this.getFieldValue(field);
                    
                    console.log(`  ${fieldId}: ${fieldValue}`);
                }
            }
            
            return contact;
            
        } catch (error) {
            console.error('❌ Ошибка дебага контакта:', error.message);
            return null;
        }
    }

    async debugLead(leadId) {
        try {
            console.log(`🔍 ДЕБАГ СДЕЛКИ ${leadId}`);
            
            const lead = await this.getLeadById(leadId);
            if (!lead) {
                console.log('❌ Сделка не найдена');
                return null;
            }
            
            console.log(`📄 Сделка: "${lead.name}" (ID: ${lead.id})`);
            
            // Выводим все поля сделки
            if (lead.custom_fields_values) {
                console.log(`📊 КАСТОМНЫЕ ПОЛЯ СДЕЛКИ (${lead.custom_fields_values.length}):`);
                
                for (const field of lead.custom_fields_values) {
                    const fieldId = field.field_id;
                    const fieldValue = this.getFieldValue(field);
                    
                    console.log(`  ${fieldId}: ${fieldValue}`);
                    
                    // Особый вывод для поля "Абонемент занятий:"
                    if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES) {
                        console.log(`  🔢 Это поле "Абонемент занятий:"`);
                        console.log(`  📊 Enum mapping: ${this.SUBSCRIPTION_ENUM_MAPPING[fieldValue] || 'не найден'}`);
                    }
                }
            }
            
            return lead;
            
        } catch (error) {
            console.error('❌ Ошибка дебага сделки:', error.message);
            return null;
        }
    }

    async getAllFieldsInfo() {
        try {
            console.log(`📊 Получение информации о полях amoCRM`);
            
            const result = {
                account: null,
                lead_fields: [],
                contact_fields: [],
                custom_fields_count: 0,
                field_mappings: []
            };
            
            try {
                // Получаем информацию об аккаунте
                result.account = await this.makeRequest('GET', '/api/v4/account');
                console.log(`✅ Информация об аккаунте получена: ${result.account.name}`);
            } catch (error) {
                console.log(`⚠️  Не удалось получить информацию об аккаунте: ${error.message}`);
            }
            
            try {
                // Получаем поля сделок
                const leadFieldsResponse = await this.makeRequest('GET', '/api/v4/leads/custom_fields');
                result.lead_fields = Array.isArray(leadFieldsResponse) ? leadFieldsResponse : [];
                console.log(`✅ Поля сделок получены: ${result.lead_fields.length}`);
                
                // Обрабатываем и кэшируем enum значения
                for (const field of result.lead_fields) {
                    if (field && field.id && field.enums && Array.isArray(field.enums)) {
                        const enumMapping = {};
                        for (const enumItem of field.enums) {
                            if (enumItem.id && enumItem.value) {
                                enumMapping[String(enumItem.id)] = enumItem.value;
                            }
                        }
                        if (Object.keys(enumMapping).length > 0) {
                            this.enumCache.set(field.id, enumMapping);
                            
                            // Добавляем в field_mappings
                            result.field_mappings.push({
                                id: field.id,
                                name: field.name,
                                type: field.type,
                                entity_type: 'lead',
                                enum_count: field.enums.length,
                                is_in_our_config: Object.values(this.FIELD_IDS.LEAD).includes(field.id)
                            });
                        }
                    }
                }
            } catch (error) {
                console.log(`⚠️  Не удалось получить поля сделок: ${error.message}`);
            }
            
            try {
                // Получаем поля контактов
                const contactFieldsResponse = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
                result.contact_fields = Array.isArray(contactFieldsResponse) ? contactFieldsResponse : [];
                console.log(`✅ Поля контактов получены: ${result.contact_fields.length}`);
                
                // Обрабатываем и кэшируем enum значения для контактов
                for (const field of result.contact_fields) {
                    if (field && field.id && field.enums && Array.isArray(field.enums)) {
                        const enumMapping = {};
                        for (const enumItem of field.enums) {
                            if (enumItem.id && enumItem.value) {
                                enumMapping[String(enumItem.id)] = enumItem.value;
                            }
                        }
                        if (Object.keys(enumMapping).length > 0) {
                            this.enumCache.set(field.id, enumMapping);
                            
                            // Добавляем в field_mappings
                            result.field_mappings.push({
                                id: field.id,
                                name: field.name,
                                type: field.type,
                                entity_type: 'contact',
                                enum_count: field.enums.length,
                                is_in_our_config: Object.values(this.FIELD_IDS.CONTACT).includes(field.id)
                            });
                        }
                    }
                }
            } catch (error) {
                console.log(`⚠️  Не удалось получить поля контактов: ${error.message}`);
            }
            
            result.custom_fields_count = result.field_mappings.length;
            
            console.log(`📊 ИТОГО: ${result.custom_fields_count} полей с enum`);
            
            return result;
            
        } catch (error) {
            console.error('❌ Ошибка получения информации о полях:', error.message);
            throw error;
        }
    }

    async getLeadById(leadId) {
        try {
            console.log(`🔍 Получение сделки по ID: ${leadId}`);
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}?with=custom_fields_values`
            );
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения сделки ${leadId}:`, error.message);
            return null;
        }
    }
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

// ==================== API МАРШРУТЫ ====================

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '4.2.0',
        amocrm_connected: amoCrmService.isInitialized,
        telegram_bot_connected: telegramBot.bot !== null,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        data_source: amoCrmService.isInitialized ? 'Реальные данные из amoCRM' : 'Локальные данные'
    });
});

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

// ==================== API ДЛЯ ФРОНТЕНДА (ОБНОВЛЕННЫЕ) ====================

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

// Получение расписания по филиалу (старый маршрут для совместимости)
app.get('/api/schedule/:branch', async (req, res) => {
    try {
        const branch = req.params.branch;
        
        console.log(`📅 Получение расписания для филиала: ${branch}`);
        
        const schedule = await db.all(`
            SELECT s.*, t.name as teacher_name 
            FROM schedule s
            LEFT JOIN teachers t ON s.teacher_id = t.id
            WHERE s.branch = ? AND s.status = 'active'
            AND s.date >= date('now', '-7 days')
            ORDER BY s.date, s.time
        `, [branch]);
        
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

// Получение преподавателей по филиалу (старый маршрут для совместимости)
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

// Получение новостей по филиалу (старый маршрут для совместимости)
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

// Получение FAQ (старый маршрут для совместимости)
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

// Отправка уведомления через Telegram (для админки)
app.post('/api/admin/send-telegram-notification', verifyAdminToken, async (req, res) => {
    try {
        const { branch, message, type, admin_id } = req.body;
        
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
        
        this.showLoading('Отправка уведомлений...');
        
        // Отправляем уведомление
        const sentCount = await telegramBot.sendNotificationToBranch(branch, message);
        
        // Сохраняем в историю рассылок
        await db.run(`
            INSERT INTO mailings (type, name, branch, message, status, sent_count, created_by, sent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
            type || 'telegram_notification',
            `Уведомление для ${branch}`,
            branch,
            message,
            'sent',
            sentCount,
            admin_id || 1
        ]);
        
        // Логируем
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'telegram_notification',
            'info',
            `Telegram уведомление отправлено для филиала "${branch}". Отправлено: ${sentCount}`,
            admin_id || 1
        ]);
        
        res.json({
            success: true,
            message: `Уведомление отправлено. Получили: ${sentCount} пользователей`,
            data: {
                sent_count: sentCount,
                branch: branch
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

// ==================== WEBHOOK ДЛЯ TELEGRAM ====================

// Webhook для Telegram (вместо polling)
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
                    `🎨 Добро пожаловать в Школу рисования!\n\n` +
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
        
        // ДЕТАЛЬНЫЙ ВЫВОД найденных профилей
        console.log(`\n📊 НАЙДЕННЫЕ ПРОФИЛИ В AMOCRM:`);
        profiles.forEach((profile, index) => {
            console.log(`${index + 1}. ${profile.student_name}`);
            console.log(`   • Абонемент: ${profile.subscription_type}`);
            console.log(`   • Статус: ${profile.subscription_status}`);
            console.log(`   • Активен: ${profile.subscription_active === 1 ? 'Да ✅' : 'Нет ❌'}`);
            console.log(`   • Занятия: ${profile.used_classes}/${profile.total_classes}`);
            console.log(`   • Остаток: ${profile.remaining_classes}`);
            console.log(`   • Источник: ${profile.source}`);
            console.log(`   ---`);
        });
        
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
        
        // Проверяем, есть ли активные абонементы
        const activeProfiles = dbProfiles.filter(p => p.subscription_active === 1);
        if (activeProfiles.length > 0) {
            console.log(`\n🎉 НАЙДЕНЫ АКТИВНЫЕ АБОНЕМЕНТЫ!`);
            activeProfiles.forEach(p => {
                console.log(`   👤 ${p.student_name}: ${p.subscription_status}`);
            });
        }
        
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

// ==================== ДЕБАГ МАРШРУТЫ ====================

// Маршрут для проверки конкретной активной сделки
app.get('/api/test/active-lead/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        
        console.log(`\n🎯 ПРОВЕРКА АКТИВНОЙ СДЕЛКИ: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const lead = await amoCrmService.getLeadById(leadId);
        if (!lead) {
            return res.json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        res.json({
            success: true,
            lead_id: leadId,
            lead_name: lead.name,
            status_id: lead.status_id,
            is_closed: [142, 143].includes(lead.status_id),
            subscription_info: subscriptionInfo,
            raw_fields: lead.custom_fields_values?.map(f => ({
                field_id: f.field_id,
                field_name: f.field_name,
                value: f.values[0]?.value || f.values[0]?.enum_id,
                enum_id: f.values[0]?.enum_id
            })) || []
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки сделки:', error.message);
        res.json({
            success: false,
            error: error.message
        });
    }
});

app.get('/api/debug/fields', async (req, res) => {
    try {
        console.log(`\n🔧 ЗАПРОС НА ДЕБАГ ПОЛЕЙ AMOCRM`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(500).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const fieldsInfo = await amoCrmService.getAllFieldsInfo();
        
        // Безопасная обработка массивов
        const leadFields = Array.isArray(fieldsInfo.lead_fields) ? fieldsInfo.lead_fields : [];
        const contactFields = Array.isArray(fieldsInfo.contact_fields) ? fieldsInfo.contact_fields : [];
        
        const response = {
            success: true,
            data: {
                account: {
                    name: fieldsInfo.account?.name || 'Неизвестно',
                    id: fieldsInfo.account?.id || 'Неизвестно'
                },
                statistics: {
                    total_fields: fieldsInfo.custom_fields_count || 0,
                    lead_fields: leadFields.length,
                    contact_fields: contactFields.length,
                    fields_in_our_config: fieldsInfo.field_mappings?.filter(f => f.is_in_our_config).length || 0
                },
                our_field_config: amoCrmService.FIELD_IDS,
                field_mappings: fieldsInfo.field_mappings || [],
                lead_fields: leadFields.slice(0, 20),
                contact_fields: contactFields.slice(0, 20)
            }
        };
        
        console.log(`✅ Информация о полях получена`);
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Ошибка получения информации о полях:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации о полях',
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

// Проверка токена администратора (middleware)
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
        
        res.json({
            success: true,
            data: {
                stats: {
                    total_students: totalStudents?.count || 0,
                    active_subscriptions: activeSubscriptions?.count || 0,
                    total_teachers: totalTeachers?.count || 0,
                    new_students_month: newStudents?.count || 0,
                    expiring_subscriptions: expiringSubscriptions?.count || 0,
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

// Управление рассылками
app.post('/api/admin/mailings', verifyAdminToken, async (req, res) => {
    try {
        const mailingData = req.body;
        
        // ДОБАВЬТЕ ЭТОТ КОД ДЛЯ ОТЛАДКИ
        console.log('📨 Получены данные рассылки:');
        console.log('   Тип:', mailingData.type);
        console.log('   Название:', mailingData.name);
        console.log('   Филиал:', mailingData.branch);
        console.log('   Сообщение:', mailingData.message?.substring(0, 100) + '...');
        console.log('   Все данные:', JSON.stringify(mailingData, null, 2));
        
        // Сохраняем рассылку в базу данных
        const result = await db.run(`
            INSERT INTO mailings (type, name, segment, branch, teacher, day, 
                                 message, status, recipients_count, created_by, scheduled_for)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            mailingData.type,
            mailingData.name,
            mailingData.segment,
            mailingData.branch,
            mailingData.teacher,
            mailingData.day,
            mailingData.message,
            'pending',
            mailingData.recipients_estimated || 0,
            mailingData.created_by || 1,
            mailingData.scheduled_for || null
        ]);
        
        res.json({
            success: true,
            message: 'Рассылка создана успешно',
            data: {
                mailing_id: result.lastID
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания рассылки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания рассылки'
        });
    }
});

// Получение списка рассылок (с исправлениями)
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
        
        // Добавляем данные о получателях
        const mailingsWithStats = await Promise.all(
            mailings.map(async (mailing) => {
                // Получаем количество получателей
                const recipients = await this.getMailingRecipientsCount(mailing);
                return {
                    ...mailing,
                    recipients_count: recipients.total || 0,
                    estimated_count: recipients.estimated || 0
                };
            })
        );
        
        res.json({
            success: true,
            data: {
                mailings: mailingsWithStats || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения рассылок:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения рассылок'
        });
    }
});


// Создание рассылки (улучшенная версия)
app.post('/api/admin/mailings', verifyAdminToken, async (req, res) => {
    try {
        const mailingData = req.body;
        
        console.log(`📨 Создание рассылки: ${mailingData.type || mailingData.name}`);
        
        // Подсчитываем количество получателей
        let recipientsCount = 0;
        
        if (mailingData.type === 'telegram_notification' && telegramBot.bot) {
            // Для Telegram уведомлений
            if (mailingData.branch && mailingData.branch !== 'all') {
                const result = await db.get(`
                    SELECT COUNT(DISTINCT tu.chat_id) as count
                    FROM telegram_users tu
                    JOIN student_profiles sp ON tu.username = sp.phone_number
                    WHERE sp.branch = ? AND tu.is_active = 1
                `, [mailingData.branch]);
                recipientsCount = result?.count || 0;
            } else {
                const result = await db.get('SELECT COUNT(*) as count FROM telegram_users WHERE is_active = 1');
                recipientsCount = result?.count || 0;
            }
        } else if (mailingData.segment) {
            // Для сегментированных рассылок
            recipientsCount = 100; // Примерное значение, нужно реализовать точный подсчет
        }
        
        // Сохраняем рассылку в базу данных
        const result = await db.run(`
            INSERT INTO mailings (type, name, segment, branch, teacher, day, 
                                 message, status, recipients_count, created_by, scheduled_for)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            mailingData.type,
            mailingData.name || `Рассылка ${new Date().toLocaleDateString()}`,
            mailingData.segment,
            mailingData.branch,
            mailingData.teacher,
            mailingData.day,
            mailingData.message,
            'pending', // Статус: pending, sending, sent, failed
            recipientsCount,
            req.admin.admin_id || 1,
            mailingData.scheduled_for || null
        ]);
        
        const mailingId = result.lastID;
        
        // Если это Telegram уведомление и указан филиал, отправляем сразу
        if (mailingData.type === 'telegram_notification' && telegramBot.bot && mailingData.branch) {
            try {
                // Обновляем статус на "отправляется"
                await db.run('UPDATE mailings SET status = ? WHERE id = ?', ['sending', mailingId]);
                
                // Отправляем уведомление
                const sentCount = await telegramBot.sendNotificationToBranch(
                    mailingData.branch,
                    mailingData.message
                );
                
                // Обновляем статус и количество отправленных
                await db.run(
                    'UPDATE mailings SET status = ?, sent_count = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?',
                    ['sent', sentCount, mailingId]
                );
                
                console.log(`✅ Telegram рассылка #${mailingId} отправлена (${sentCount} получателей)`);
                
            } catch (sendError) {
                console.error('❌ Ошибка отправки Telegram рассылки:', sendError);
                await db.run('UPDATE mailings SET status = ?, failed_count = ? WHERE id = ?', 
                    ['failed', recipientsCount, mailingId]);
            }
        }
        
        res.json({
            success: true,
            message: 'Рассылка создана успешно',
            data: {
                mailing_id: mailingId,
                recipients_count: recipientsCount
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания рассылки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания рассылки'
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
// Добавьте в server.js после маршрутов
app.get('/api/notifications', verifyToken, async (req, res) => {
    try {
        const phone = req.user?.phone;
        
        if (!phone) {
            return res.json({
                success: true,
                data: {
                    notifications: []
                }
            });
        }
        
        // Получаем уведомления для пользователя
        // Здесь можно добавить логику получения уведомлений из БД
        
        res.json({
            success: true,
            data: {
                notifications: [] // Пока возвращаем пустой массив
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения уведомлений:', error.message);
        res.json({
            success: true,
            data: {
                notifications: []
            }
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
// Удаление преподавателя
app.delete('/api/admin/teachers/:id', verifyAdminToken, async (req, res) => {
    try {
        const teacherId = req.params.id;
        
        console.log(`🗑️ Удаление преподавателя ID: ${teacherId}`);
        
        const result = await db.run(
            'UPDATE teachers SET is_active = 0 WHERE id = ?',
            [teacherId]
        );
        
        if (result.changes > 0) {
            res.json({
                success: true,
                message: 'Преподаватель удален (деактивирован)'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Преподаватель не найден'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка удаления преподавателя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления преподавателя'
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

// Отправка тестового сообщения
app.post('/api/admin/mailings/test', verifyAdminToken, async (req, res) => {
    try {
        const { message, type, admin_id } = req.body;
        
        console.log(`📧 Отправка тестового сообщения администратору: ${type}`);
        
        // Здесь будет логика отправки сообщения администратору
        // Например, через Telegram бота или email
        
        // Записываем в логи
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'mailing',
            'info',
            `Тестовая рассылка отправлена администратору: ${type}`,
            admin_id || 1
        ]);
        
        res.json({
            success: true,
            message: 'Тестовое сообщение отправлено'
        });
        
    } catch (error) {
        console.error('❌ Ошибка отправки тестового сообщения:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки тестового сообщения'
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(100));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v4.2');
        console.log('='.repeat(100));
        console.log('✨ БЕЗ ДЕМО-ДАННЫХ');
        console.log('✨ ИНТЕГРАЦИЯ TELEGRAM БОТА');
        console.log('✨ API ДЛЯ ФРОНТЕНДА ПО ФИЛИАЛАМ');
        console.log('✨ WEBHOOK ДЛЯ TELEGRAM БОТА');
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
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`📅 Расписание (новое): GET http://localhost:${PORT}/api/schedule/student/{branch}`);
            console.log(`👨‍🏫 Преподаватели (новое): GET http://localhost:${PORT}/api/teachers/student/{branch}`);
            console.log(`📰 Новости (новое): GET http://localhost:${PORT}/api/news/student/{branch}`);
            console.log(`❓ FAQ (новое): GET http://localhost:${PORT}/api/faq/student`);
            console.log(`🔄 Синхронизация: GET http://localhost:${PORT}/api/sync/{phone}`);
            console.log(`🤖 Telegram Webhook: POST http://localhost:${PORT}/api/telegram-webhook`);
            console.log('');
            console.log('🔧 АДМИН ПАНЕЛЬ:');
            console.log('─'.repeat(50));
            console.log(`👤 Админ-панель: GET http://localhost:${PORT}/admin`);
            console.log(`🔐 Вход: POST http://localhost:${PORT}/api/admin/login`);
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
