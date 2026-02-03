// server.js - ФИНАЛЬНАЯ ВЕРСИЯ с системой реальных посещений из amoCRM
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
}

// ==================== ПРАВИЛЬНЫЙ МАППИНГ ДЛЯ ВАШЕГО AMOCRM ====================

function getLessonNumberFromFieldId(fieldId) {
    // Правильный маппинг для вашего amoCRM
    const mapping = {
        // Чекбоксы посещений
        884899: 1,  // CLASS_1
        884901: 2,  // CLASS_2
        884903: 3,  // CLASS_3
        884905: 4,  // CLASS_4
        884907: 5,  // CLASS_5
        884909: 6,  // CLASS_6
        884911: 7,  // CLASS_7
        884913: 8,  // CLASS_8
        884915: 9,  // CLASS_9
        884917: 10, // CLASS_10
        884919: 11, // CLASS_11
        884921: 12, // CLASS_12
        884923: 13, // CLASS_13
        884925: 14, // CLASS_14
        884927: 15, // CLASS_15
        884929: 16, // CLASS_16
        892867: 17, // CLASS_17
        892871: 18, // CLASS_18
        892875: 19, // CLASS_19
        892879: 20, // CLASS_20
        892883: 21, // CLASS_21
        892887: 22, // CLASS_22
        892893: 23, // CLASS_23
        892895: 24, // CLASS_24
        
        // Даты посещений - ВАЖНО: исправь это!
        884931: 1,  // CLASS_DATE_1
        884933: 2,  // CLASS_DATE_2
        884935: 3,  // CLASS_DATE_3 ← ИСПРАВЬ: было 884933, должно быть 884935
        884937: 4,  // CLASS_DATE_4
        884939: 5,  // CLASS_DATE_5
        884941: 6,  // CLASS_DATE_6
        884943: 7,  // CLASS_DATE_7
        884945: 8,  // CLASS_DATE_8
        884953: 9,  // CLASS_DATE_9
        884955: 10, // CLASS_DATE_10
        884951: 11, // CLASS_DATE_11
        884957: 12, // CLASS_DATE_12
        884959: 13, // CLASS_DATE_13
        884961: 14, // CLASS_DATE_14
        884963: 15, // CLASS_DATE_15
        884965: 16, // CLASS_DATE_16
        892869: 17, // CLASS_DATE_17
        892873: 18, // CLASS_DATE_18
        892877: 19, // CLASS_DATE_19
        892881: 20, // CLASS_DATE_20
        892885: 21, // CLASS_DATE_21
        892889: 22, // CLASS_DATE_22
        892891: 23, // CLASS_DATE_23
        892897: 24  // CLASS_DATE_24
    };
    
    return mapping[fieldId] || 0;
}

function isVisitCheckboxField(fieldId) {
    return (fieldId >= 884899 && fieldId <= 892895);
}

function isVisitDateField(fieldId) {
    return (fieldId >= 884931 && fieldId <= 892897);
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

 parseDate: function(value) {
    if (!value) return null;
    
    try {
        const strValue = String(value).trim();
        
        // Если это текст (не число), возвращаем как есть
        if (isNaN(strValue) && !/^\d+$/.test(strValue)) {
            return strValue;
        }
        
        // Если это timestamp в секундах (9-10 цифр)
        if (/^\d{9,10}$/.test(strValue)) {
            const timestamp = parseInt(strValue);
            const date = new Date(timestamp * 1000);
            
            // Корректируем на московское время (UTC+3)
            const mskOffset = 3 * 60 * 60 * 1000;
            const mskDate = new Date(date.getTime() + mskOffset);
            
            return mskDate.toISOString().split('T')[0]; // YYYY-MM-DD
        }
        
        // Если это timestamp в миллисекундах (13 цифр)
        if (/^\d{13}$/.test(strValue)) {
            const timestamp = parseInt(strValue);
            const date = new Date(timestamp);
            return date.toISOString().split('T')[0];
        }
        
        // Формат DD.MM.YYYY
        if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(strValue)) {
            const [day, month, year] = strValue.split('.');
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        
        // Формат YYYY-MM-DD
        if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(strValue)) {
            return strValue;
        }
        
        // Если это просто число (не timestamp), возвращаем как есть
        return strValue;
        
    } catch (error) {
        console.error(`❌ Ошибка парсинга даты "${value}":`, error.message);
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
                else if (fieldId === this.FIELD_IDS.LEAD.PURCHASE_DATE) {
                   subscriptionInfo.hasSubscription = true;
                   subscriptionInfo.purchaseDate = this.parseDate(fieldValue);
                   console.log(`   💰 Дата покупки: ${fieldValue} -> ${subscriptionInfo.purchaseDate}`);
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
        
        // Извлекаем данные о посещениях
        subscriptionInfo.visits = this.extractRealVisitsData(lead);
        subscriptionInfo.totalVisits = subscriptionInfo.visits.length;

        // Логируем найденные посещения
        if (subscriptionInfo.totalVisits > 0) {
            console.log(`   🎯 Найдены реальные посещения: ${subscriptionInfo.totalVisits}`);
            subscriptionInfo.visits.forEach(visit => {
                console.log(`      • Занятие ${visit.lesson_number}: ${visit.date || 'без даты'} ${visit.estimated ? '(оценка)' : ''}`);
            });
        }

        return subscriptionInfo;
    }

    // ==================== МЕТОДЫ ДЛЯ РАБОТЫ С РЕАЛЬНЫМИ ПОСЕЩЕНИЯМИ ====================

    getVisitFieldInfo(fieldId) {
        // Информация о поле посещения
        const lessonNumber = getLessonNumberFromFieldId(fieldId);
        
        if (lessonNumber > 0) {
            if (isVisitCheckboxField(fieldId)) {
                return {
                    type: 'checkbox',
                    lesson_number: lessonNumber,
                    field_name: `CLASS_${lessonNumber}`
                };
            } else if (isVisitDateField(fieldId)) {
                return {
                    type: 'date',
                    lesson_number: lessonNumber,
                    field_name: `CLASS_DATE_${lessonNumber}`
                };
            }
        }
        
        return null;
    }

   extractRealVisitsData(lead) {
    console.log(`🔍 Извлечение данных о посещениях из сделки ${lead.id || 'unknown'}`);
    
    const visits = [];
    
    if (!lead.custom_fields_values) {
        console.log('⚠️  Нет кастомных полей в сделке');
        return visits;
    }
    
    // Собираем данные о посещениях
    const visitData = {};
    
    lead.custom_fields_values.forEach(field => {
        const fieldId = field.field_id;
        let fieldValue = null;
        
        // Получаем значение поля
        if (field.values && field.values.length > 0) {
            // Приоритет: value, потом enum_id
            fieldValue = field.values[0].value !== undefined ? 
                        field.values[0].value : 
                        field.values[0].enum_id;
        }
        
        if (!fieldValue && fieldValue !== false && fieldValue !== 0) {
            return;
        }
        
        // Проверяем, является ли поле чекбоксом посещения (1-24 занятия)
        if (fieldId >= 884899 && fieldId <= 892895) {
            const lessonNumber = getLessonNumberFromFieldId(fieldId);
            
            // Проверяем разные форматы значения
            const isChecked = 
                fieldValue === true || 
                fieldValue === 'true' ||
                fieldValue === 1 ||
                fieldValue === '1' ||
                fieldValue === 'да' ||
                fieldValue === 'Да';
            
            if (isChecked) {
                if (!visitData[lessonNumber]) {
                    visitData[lessonNumber] = {};
                }
                visitData[lessonNumber].attended = true;
                console.log(`   ✅ Занятие ${lessonNumber}: отмечено как посещенное`);
            }
        }
        
        // Проверяем, является ли поле датой занятия (1-24 занятия)
        if (fieldId >= 884931 && fieldId <= 892897) {
            const lessonNumber = getLessonNumberFromFieldId(fieldId);
            const dateValue = this.parseDate(fieldValue);
            
            if (dateValue && dateValue !== 'Invalid Date') {
                if (!visitData[lessonNumber]) {
                    visitData[lessonNumber] = {};
                }
                visitData[lessonNumber].date = dateValue;
                console.log(`   📅 Занятие ${lessonNumber}: дата ${dateValue}`);
            }
        }
    });
    
    // Формируем массив посещений
    for (let lessonNumber = 1; lessonNumber <= 24; lessonNumber++) {
        if (visitData[lessonNumber] && visitData[lessonNumber].attended) {
            const visit = {
                lesson_number: lessonNumber,
                attended: true,
                date: visitData[lessonNumber].date || null,
                has_date: !!visitData[lessonNumber].date,
                source: 'amocrm_real',
                estimated: !visitData[lessonNumber].date
            };
            
            visits.push(visit);
        }
    }
    
    console.log(`   ✅ Всего извлечено посещений: ${visits.length}`);
    
    // Если нет структурированных данных, используем счетчик
    if (visits.length === 0) {
        const usedClasses = this.getUsedClassesFromLead(lead);
        console.log(`   📊 Используем счетчик: ${usedClasses} занятий`);
        
        if (usedClasses > 0) {
            // Пытаемся найти дату активации для отсчета
            let baseDate = null;
            
            // Ищем дату активации в сделке
            lead.custom_fields_values.forEach(field => {
                if (field.field_id === this.FIELD_IDS.LEAD.ACTIVATION_DATE) {
                    const dateValue = this.getFieldValue(field);
                    if (dateValue) {
                        baseDate = this.parseDate(dateValue);
                        console.log(`   📅 Найдена дата активации для отсчета: ${baseDate}`);
                    }
                }
            });
            
            // Если нет даты активации, используем текущую дату
            if (!baseDate) {
                baseDate = new Date().toISOString().split('T')[0];
                console.log(`   📅 Используем текущую дату для отсчета: ${baseDate}`);
            }
            
            const baseDateObj = new Date(baseDate);
            
            for (let i = 1; i <= usedClasses && i <= 24; i++) {
                const visitDate = new Date(baseDateObj);
                visitDate.setDate(baseDateObj.getDate() + ((i - 1) * 7)); // Каждые 7 дней
                
                visits.push({
                    lesson_number: i,
                    date: visitDate.toISOString().split('T')[0],
                    attended: true,
                    has_date: true,
                    source: 'estimated_from_counter',
                    estimated: true
                });
            }
        }
    }
    
    return visits;
}

    getCheckboxFieldId(lessonNumber) {
        const mapping = {
            1: 884899, 2: 884901, 3: 884903, 4: 884905,
            5: 884907, 6: 884909, 7: 884911, 8: 884913,
            9: 884915, 10: 884917, 11: 884919, 12: 884921,
            13: 884923, 14: 884925, 15: 884927, 16: 884929,
            17: 892867, 18: 892871, 19: 892875, 20: 892879,
            21: 892883, 22: 892887, 23: 892893, 24: 892895
        };
        return mapping[lessonNumber] || null;
    }

    getDateFieldId(lessonNumber) {
        const mapping = {
            1: 884931, 2: 884933, 3: 884935, 4: 884937,
            5: 884939, 6: 884941, 7: 884943, 8: 884945,
            9: 884953, 10: 884955, 11: 884951, 12: 884957,
            13: 884959, 14: 884961, 15: 884963, 16: 884965,
            17: 892869, 18: 892873, 19: 892877, 20: 892881,
            21: 892885, 22: 892889, 23: 892891, 24: 892897
        };
        return mapping[lessonNumber] || null;
    }

    getUsedClassesFromLead(lead) {
        if (!lead.custom_fields_values) return 0;
        
        // Поле USED_CLASSES (850257)
        const usedClassesField = lead.custom_fields_values.find(f => f.field_id === this.FIELD_IDS.LEAD.USED_CLASSES);
        if (usedClassesField) {
            const value = this.getFieldValue(usedClassesField);
            return this.parseNumeric(value);
        }
        
        return 0;
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
                
               // ДОБАВЬТЕ сравнение дат:
const isSameSubscription = existingProfile && 
    existingProfile.subscription_type === profile.subscription_type &&
    existingProfile.subscription_status === profile.subscription_status &&
    existingProfile.subscription_active === profile.subscription_active &&
    existingProfile.total_classes === profile.total_classes &&
    existingProfile.used_classes === profile.used_classes &&
    existingProfile.remaining_classes === profile.remaining_classes &&
    // Добавьте сравнение дат:
    existingProfile.activation_date === profile.activation_date &&
    existingProfile.expiration_date === profile.expiration_date &&
    existingProfile.last_visit_date === profile.last_visit_date &&
    existingProfile.purchase_date === profile.purchase_date;
                
                const columns = [
                    'amocrm_contact_id', 'parent_contact_id', 'amocrm_lead_id', 'student_name', 'phone_number', 'email',
                    'birth_date', 'branch', 'day_of_week', 'time_slot', 'teacher_name', 'age_group', 'course', 'allergies',
                    'parent_name', 'subscription_type', 'subscription_active', 'subscription_status', 'subscription_badge',
                    'total_classes', 'used_classes', 'remaining_classes', 'expiration_date', 
                    'activation_date', 'last_visit_date', 'custom_fields', 
                    'raw_contact_data','purchase_date', 'lead_data', 'is_demo', 'source', 'is_active'
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

// Функция для получения рекомендаций по полям с датами
function getDateFieldRecommendations(summary) {
    const recommendations = [];
    
    if (summary.has_dates.activation_date === 0) {
        recommendations.push({
            level: 'warning',
            message: 'В сделках не найдены поля с датами активации абонемента',
            suggestion: 'Проверьте заполнение поля "Дата активации абонемента:" (ID: 851565) в сделках'
        });
    }
    
    if (summary.has_dates.expiration_date === 0) {
        recommendations.push({
            level: 'warning',
            message: 'В сделках не найдены поля с датами окончания абонемента',
            suggestion: 'Проверьте заполнение поля "Окончание абонемента:" (ID: 850255) в сделках'
        });
    }
    
    if (summary.has_dates.last_visit_date === 0) {
        recommendations.push({
            level: 'info',
            message: 'В сделках не найдены поля с датами последнего визита',
            suggestion: 'Даты последнего визита могут храниться в полях дат занятий или отдельном поле'
        });
    }
    
    if (summary.active_subscriptions > 0 && summary.has_dates.activation_date < summary.active_subscriptions) {
        recommendations.push({
            level: 'warning',
            message: `Только ${summary.has_dates.activation_date} из ${summary.active_subscriptions} активных абонементов имеют дату активации`,
            suggestion: 'Обновите даты активации для всех активных абонементов'
        });
    }
    
    if (recommendations.length === 0) {
        recommendations.push({
            level: 'success',
            message: 'Даты корректно заполнены в системе',
            suggestion: 'Продолжайте текущую практику заполнения полей с датами'
        });
    }
    
    return recommendations;
}

// Функция для анализа форматов дат
function analyzeDateFormats(dateFields) {
    const formats = {
        timestamp: 0,
        iso: 0,
        dd_mm_yyyy: 0,
        unknown: 0
    };
    
    for (const [fieldId, fieldInfo] of Object.entries(dateFields)) {
        const rawValue = fieldInfo.raw_value.toString();
        
        if (/^\d{9,10}$/.test(rawValue)) {
            formats.timestamp++;
        } else if (/^\d{4}-\d{2}-\d{2}/.test(rawValue)) {
            formats.iso++;
        } else if (/^\d{1,2}\.\d{1,2}\.\d{4}/.test(rawValue)) {
            formats.dd_mm_yyyy++;
        } else {
            formats.unknown++;
        }
    }
    
    return formats;
}

// Функция рекомендаций по парсингу дат
function getDateParsingRecommendations(dateString, results, additionalTests) {
    const recommendations = [];
    
    const successfulParsers = results.filter(r => r.is_valid).map(r => r.parser);
    
    if (successfulParsers.length === 0) {
        recommendations.push({
            level: 'error',
            message: 'Не удалось распарсить дату ни одним методом',
            suggestion: 'Проверьте формат данных в amoCRM'
        });
    } else if (successfulParsers.length > 1) {
        recommendations.push({
            level: 'warning',
            message: `Дата распарсена ${successfulParsers.length} методами`,
            suggestion: `Используйте метод: ${successfulParsers[0]}`
        });
    } else {
        recommendations.push({
            level: 'success',
            message: `Дата успешно распарсена методом: ${successfulParsers[0]}`,
            suggestion: 'Продолжайте использовать текущий метод парсинга'
        });
    }
    
    // Специфичные рекомендации
    if (/^\d{9,10}$/.test(dateString)) {
        recommendations.push({
            level: 'info',
            message: 'Дата похожа на timestamp (секунды)',
            suggestion: 'Используйте new Date(timestamp * 1000)'
        });
    } else if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(dateString)) {
        recommendations.push({
            level: 'info',
            message: 'Дата в формате DD.MM.YYYY',
            suggestion: 'Преобразуйте в YYYY-MM-DD'
        });
    }
    
    return recommendations;
}

// Вспомогательные функции для диагностики
function getFieldNameById(fieldId) {
    const fieldMap = {
        850253: 'Дата покупки:',
        850255: 'Окончание абонемента:',
        850259: 'Дата последнего визита:',
        851565: 'Дата активации абонемента:',
        884899: 'Занятие 1 (чекбокс)',
        884901: 'Занятие 2 (чекбокс)',
        884903: 'Занятие 3 (чекбокс)',
        // ... добавьте остальные 21 чекбокс
        884931: 'Занятие 1 (дата)',
        884933: 'Занятие 2 (дата)',
        884935: 'Занятие 3 (дата)',
        // ... добавьте остальные 21 дату
    };
    
    return fieldMap[fieldId] || `Поле ${fieldId}`;
}

function getClassNumberFromFieldId(fieldId) {
    // Маппинг fieldId -> номер занятия
    const mapping = {
        // Чекбоксы
        884899: 1, 884901: 2, 884903: 3, 884905: 4,
        884907: 5, 884909: 6, 884911: 7, 884913: 8,
        884915: 9, 884917: 10, 884919: 11, 884921: 12,
        884923: 13, 884925: 14, 884927: 15, 884929: 16,
        892867: 17, 892871: 18, 892875: 19, 892879: 20,
        892883: 21, 892887: 22, 892893: 23, 892895: 24,
        // Даты
        884931: 1, 884933: 2, 884935: 3, 884937: 4,
        884939: 5, 884941: 6, 884943: 7, 884945: 8,
        884953: 9, 884955: 10, 884951: 11, 884957: 12,
        884959: 13, 884961: 14, 884963: 15, 884965: 16,
        892869: 17, 892873: 18, 892877: 19, 892881: 20,
        892885: 21, 892889: 22, 892891: 23, 892897: 24
    };
    
    return mapping[fieldId] || 0;
}

function combineVisits(checkboxes, dates) {
    const combined = [];
    
    for (let i = 1; i <= 24; i++) {
        if (checkboxes[i] || dates[i]) {
            combined.push({
                lesson_number: i,
                attended: !!checkboxes[i],
                date: dates[i]?.parsed || dates[i]?.raw || 'Дата не указана',
                has_date: !!dates[i]
            });
        }
    }
    
    return combined;
}

function getVisitsDisplayRecommendations(diagnosticData) {
    const recommendations = [];
    
    // Проверяем, есть ли данные для отображения
    const hasCheckboxes = diagnosticData.lead_data_analysis?.visit_checkboxes_found > 0;
    const hasVisitDates = diagnosticData.lead_data_analysis?.visit_dates_found > 0;
    const hasCombinedVisits = diagnosticData.lead_data_analysis?.combined_visits?.length > 0;
    
    if (!hasCheckboxes && !hasVisitDates) {
        recommendations.push({
            level: 'warning',
            message: 'В amoCRM не найдены данные о посещениях',
            suggestion: 'Проверьте заполнение чекбоксов и дат занятий в сделке'
        });
    } else if (hasCheckboxes && !hasVisitDates) {
        recommendations.push({
            level: 'info',
            message: `Найдено ${diagnosticData.lead_data_analysis.visit_checkboxes_found} посещений без дат`,
            suggestion: 'Заполните даты занятий в amoCRM для полной истории'
        });
    } else if (hasCombinedVisits) {
        recommendations.push({
            level: 'success',
            message: `Найдено ${diagnosticData.lead_data_analysis.combined_visits.length} посещений с датами`,
            suggestion: 'Можно отображать историю посещений'
        });
    }
    
    // Проверяем наличие used_classes
    if (diagnosticData.subscription_info.used_classes > 0) {
        recommendations.push({
            level: 'info',
            message: `Счетчик занятий: ${diagnosticData.subscription_info.used_classes}`,
            suggestion: 'Можно показать количество посещений, даже без детальной истории'
        });
    }
    
    return recommendations;
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

// ==================== API ДЛЯ ПОЛУЧЕНИЯ РЕАЛЬНОЙ ИСТОРИИ ПОСЕЩЕНИЙ ====================

app.get('/api/visits/real/:phone', verifyToken, async (req, res) => {
    try {
        const phone = req.params.phone;
        const cleanPhone = phone.replace(/\D/g, '');
        
        console.log(`📊 Получение истории посещений для: ${phone}`);
        
        // Находим профиль
        const profile = await db.get(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1 
             ORDER BY subscription_active DESC 
             LIMIT 1`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        
        if (!profile) {
            return res.json({
                success: false,
                error: 'Профиль не найден'
            });
        }
        
        console.log(`👤 Профиль: ${profile.student_name}`);
        console.log(`🎫 Занятий: ${profile.used_classes}/${profile.total_classes}`);
        
        let visits = [];
        
        // 1. Извлекаем реальные посещения из lead_data
        if (profile.lead_data && profile.lead_data !== '{}') {
            try {
                const leadData = JSON.parse(profile.lead_data);
                console.log(`📄 Извлекаем данные из сделки...`);
                
                visits = amoCrmService.extractRealVisitsData(leadData);
                
                console.log(`✅ Извлечено реальных посещений: ${visits.length}`);
                
                // Если реальных посещений меньше, чем used_classes, добавляем расчетные
                if (visits.length < profile.used_classes) {
                    console.log(`📊 Добавляем расчетные посещения...`);
                    
                    const usedClasses = profile.used_classes || 0;
                    const existingLessons = visits.map(v => v.lesson_number);
                    
                    // Ищем дату для отсчета
                    let baseDate = null;
                    
                    // Пытаемся найти дату активации
                    if (profile.activation_date) {
                        baseDate = new Date(profile.activation_date);
                    } else if (visits.length > 0 && visits[0].date) {
                        // Используем дату последнего реального посещения
                        baseDate = new Date(visits[0].date);
                    } else {
                        // Используем текущую дату
                        baseDate = new Date();
                    }
                    
                    // Добавляем недостающие занятия
                    for (let i = 1; i <= usedClasses && i <= 24; i++) {
                        if (!existingLessons.includes(i)) {
                            const visitDate = new Date(baseDate);
                            // Распределяем занятия по неделям
                            visitDate.setDate(baseDate.getDate() - ((usedClasses - i) * 7));
                            
                            visits.push({
                                lesson_number: i,
                                date: visitDate.toISOString().split('T')[0],
                                attended: true,
                                has_date: true,
                                source: 'estimated_complement',
                                estimated: true
                            });
                        }
                    }
                }
                
            } catch (error) {
                console.error('❌ Ошибка парсинга lead_data:', error.message);
            }
        }
        
        // 2. Если все еще нет данных, создаем на основе used_classes
        if (visits.length === 0 && profile.used_classes > 0) {
            console.log(`📊 Создаем полную историю на основе счетчика: ${profile.used_classes} занятий`);
            
            let baseDate = new Date();
            
            // Пытаемся использовать дату активации
            if (profile.activation_date) {
                baseDate = new Date(profile.activation_date);
                console.log(`   📅 Используем дату активации: ${profile.activation_date}`);
            } else if (profile.last_visit_date) {
                baseDate = new Date(profile.last_visit_date);
                console.log(`   📅 Используем дату последнего визита: ${profile.last_visit_date}`);
            }
            
            for (let i = 1; i <= profile.used_classes && i <= 24; i++) {
                const visitDate = new Date(baseDate);
                // Распределяем занятия по неделям от даты активации
                visitDate.setDate(baseDate.getDate() + ((i - 1) * 7));
                
                visits.push({
                    lesson_number: i,
                    date: visitDate.toISOString().split('T')[0],
                    attended: true,
                    has_date: true,
                    source: 'estimated_full',
                    estimated: true
                });
            }
        }
        
        // 3. Сортируем по номеру занятия
        visits.sort((a, b) => a.lesson_number - b.lesson_number);
        
        // 4. Обогащаем данными для отображения
        const enrichedVisits = visits.map(visit => ({
            ...visit,
            student_name: profile.student_name,
            branch: profile.branch,
            teacher_name: profile.teacher_name || 'Преподаватель не указан',
            age_group: profile.age_group || '',
            group_name: profile.course || 'Основная группа',
            formatted_date: visit.date ? formatDateForDisplay(visit.date) : 'Дата не указана',
            time: '18:00', // Дефолтное время
            estimated: visit.estimated || false
        }));
        
        console.log(`📊 Итого посещений: ${enrichedVisits.length}`);
        
        res.json({
            success: true,
            data: {
                student_name: profile.student_name,
                phone: phone,
                subscription_info: {
                    total_classes: profile.total_classes,
                    used_classes: profile.used_classes,
                    remaining_classes: profile.remaining_classes
                },
                visits: enrichedVisits,
                total_visits: enrichedVisits.length,
                has_real_data: enrichedVisits.some(v => !v.estimated),
                summary: {
                    real_visits: enrichedVisits.filter(v => !v.estimated).length,
                    estimated_visits: enrichedVisits.filter(v => v.estimated).length,
                    total: enrichedVisits.length
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения истории посещений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения истории посещений'
        });
    }
});

// ==================== API ДЛЯ ИСТОРИИ ПОСЕЩЕНИЙ ====================

app.get('/api/visits/history/:phone', verifyToken, async (req, res) => {
    try {
        const phone = req.params.phone;
        const cleanPhone = phone.replace(/\D/g, '');
        
        console.log(`📊 Получение истории посещений для: ${phone}`);
        
        // Получаем профиль
        const profile = await db.get(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1 
             ORDER BY subscription_active DESC 
             LIMIT 1`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        
        if (!profile) {
            return res.json({
                success: true,
                data: {
                    visits: [],
                    message: 'Профиль не найден'
                }
            });
        }
        
        let visits = [];
        
        // 1. Пытаемся извлечь посещения из lead_data
        if (profile.lead_data && profile.lead_data !== '{}') {
            try {
                const leadData = JSON.parse(profile.lead_data);
                
                if (leadData.custom_fields_values) {
                    const visitCheckboxes = {};
                    const visitDates = {};
                    
                    // Собираем чекбоксы и даты
                    for (const field of leadData.custom_fields_values) {
                        const fieldId = field.field_id;
                        const fieldValue = field.values?.[0]?.value || field.values?.[0]?.enum_id;
                        
                        // Чекбоксы посещений
                        if (fieldId >= 884899 && fieldId <= 892895) {
                            const classNumber = getClassNumberFromFieldId(fieldId);
                            if (fieldValue === 'true' || fieldValue === '1' || fieldValue === true) {
                                visitCheckboxes[classNumber] = true;
                            }
                        }
                        
                        // Даты посещений
                        if (fieldId >= 884931 && fieldId <= 892897) {
                            const classNumber = getClassNumberFromFieldId(fieldId);
                            if (fieldValue) {
                                visitDates[classNumber] = amoCrmService.parseDate(fieldValue);
                            }
                        }
                    }
                    
                    // Объединяем данные
                    for (let i = 1; i <= 24; i++) {
                        if (visitCheckboxes[i] && visitDates[i]) {
                            visits.push({
                                id: i,
                                date: visitDates[i],
                                lesson_number: i,
                                status: 'attended',
                                type: 'regular'
                            });
                        } else if (visitCheckboxes[i]) {
                            visits.push({
                                id: i,
                                date: `Занятие ${i}`,
                                lesson_number: i,
                                status: 'attended_no_date',
                                type: 'regular'
                            });
                        }
                    }
                }
            } catch (error) {
                console.error('❌ Ошибка парсинга lead_data:', error.message);
            }
        }
        
        // 2. Если нет данных в lead_data, создаем фиктивную историю на основе used_classes
        if (visits.length === 0 && profile.used_classes > 0) {
            console.log(`📊 Создаем историю на основе used_classes: ${profile.used_classes}`);
            
            const today = new Date();
            for (let i = 1; i <= profile.used_classes && i <= 24; i++) {
                const visitDate = new Date(today);
                visitDate.setDate(today.getDate() - (i * 7)); // Каждую неделю
                
                visits.push({
                    id: i,
                    date: visitDate.toISOString().split('T')[0],
                    lesson_number: i,
                    status: 'attended',
                    type: 'regular',
                    estimated: true // Помечаем как оценочные данные
                });
            }
        }
        
        // 3. Сортируем по дате (новые сначала)
        visits.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateB - dateA;
        });
        
        // Ограничиваем количество
        visits = visits.slice(0, profile.used_classes || 10);
        
        res.json({
            success: true,
            data: {
                student_name: profile.student_name,
                total_visits: profile.used_classes || 0,
                visits: visits,
                has_detailed_history: visits.length > 0 && !visits[0]?.estimated,
                message: visits.length > 0 
                    ? `Найдено ${visits.length} посещений` 
                    : 'История посещений не найдена'
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения истории посещений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения истории посещений'
        });
    }
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
             activation_date: p.activation_date,                    // ← ДОБАВИТЬ
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
        
        res.json({
            success: true,
            message: 'Функция находится в разработке'
        });
        
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

// ==================== ДИАГНОСТИЧЕСКИЙ МАРШРУТ ДЛЯ ИСТОРИИ ПОСЕЩЕНИЙ ====================

app.get('/api/debug/visits/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        const cleanPhone = phone.replace(/\D/g, '');
        
        console.log(`🔍 ДИАГНОСТИКА ИСТОРИИ ПОСЕЩЕНИЙ ДЛЯ: ${formattedPhone}`);
        
        // 1. Получаем профиль из БД
        const profile = await db.get(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1 
             ORDER BY subscription_active DESC 
             LIMIT 1`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Профиль не найден в БД'
            });
        }
        
        console.log(`👤 Профиль: ${profile.student_name}`);
        console.log(`📅 Даты в БД:`);
        console.log(`   • Активация: ${profile.activation_date || 'НЕТ'}`);
        console.log(`   • Окончание: ${profile.expiration_date || 'НЕТ'}`);
        console.log(`   • Последний визит: ${profile.last_visit_date || 'НЕТ'}`);
        console.log(`   • Покупка: ${profile.purchase_date || 'НЕТ'}`);
        console.log(`🎫 Занятия: ${profile.used_classes}/${profile.total_classes}`);
        
        const result = {
            success: true,
            student_name: profile.student_name,
            phone: formattedPhone,
            subscription_info: {
                total_classes: profile.total_classes,
                used_classes: profile.used_classes,
                remaining_classes: profile.remaining_classes,
                subscription_active: profile.subscription_active === 1
            },
            dates_in_db: {
                activation_date: profile.activation_date,
                expiration_date: profile.expiration_date,
                last_visit_date: profile.last_visit_date,
                purchase_date: profile.purchase_date
            }
        };
        
        // 2. Анализ raw_data из БД (сырые данные amoCRM)
        if (profile.lead_data && profile.lead_data !== '{}') {
            try {
                const leadData = JSON.parse(profile.lead_data);
                console.log(`📊 Данные сделки из БД:`);
                console.log(`   • Lead ID: ${leadData.id || 'НЕТ'}`);
                console.log(`   • Название: ${leadData.name || 'НЕТ'}`);
                
                // Поиск полей с датами в lead_data
                if (leadData.custom_fields_values && Array.isArray(leadData.custom_fields_values)) {
                    const dateFields = {};
                    const visitCheckboxes = {};
                    const visitDates = {};
                    
                    console.log(`📋 Анализ кастомных полей сделки (${leadData.custom_fields_values.length}):`);
                    
                    for (const field of leadData.custom_fields_values) {
                        const fieldId = field.field_id;
                        const fieldValue = field.values?.[0]?.value || field.values?.[0]?.enum_id || 'НЕТ';
                        
                        // 2.1. Поля с датами
                        if ([850253, 850255, 850259, 851565].includes(fieldId)) {
                            const fieldName = getFieldNameById(fieldId);
                            dateFields[fieldId] = {
                                name: fieldName,
                                value: fieldValue,
                                parsed: amoCrmService.parseDate(fieldValue)
                            };
                            console.log(`   📅 ${fieldName} (${fieldId}): ${fieldValue} -> ${dateFields[fieldId].parsed}`);
                        }
                        
                        // 2.2. Чекбоксы посещений (24 занятия)
                        if (fieldId >= 884899 && fieldId <= 892895) {
                            const classNumber = getClassNumberFromFieldId(fieldId);
                            if (fieldValue === 'true' || fieldValue === '1' || fieldValue === true) {
                                visitCheckboxes[classNumber] = true;
                            }
                        }
                        
                        // 2.3. Даты посещений (24 занятия)
                        if (fieldId >= 884931 && fieldId <= 892897) {
                            const classNumber = getClassNumberFromFieldId(fieldId);
                            if (fieldValue && fieldValue !== 'НЕТ') {
                                visitDates[classNumber] = {
                                    raw: fieldValue,
                                    parsed: amoCrmService.parseDate(fieldValue)
                                };
                            }
                        }
                    }
                    
                    result.lead_data_analysis = {
                        total_fields: leadData.custom_fields_values.length,
                        date_fields: dateFields,
                        visit_checkboxes_found: Object.keys(visitCheckboxes).length,
                        visit_dates_found: Object.keys(visitDates).length,
                        visit_checkboxes: visitCheckboxes,
                        visit_dates: visitDates,
                        combined_visits: combineVisits(visitCheckboxes, visitDates)
                    };
                    
                    console.log(`✅ Чекбоксов посещений найдено: ${Object.keys(visitCheckboxes).length}`);
                    console.log(`✅ Дат посещений найдено: ${Object.keys(visitDates).length}`);
                }
                
            } catch (parseError) {
                console.error(`❌ Ошибка парсинга lead_data: ${parseError.message}`);
                result.lead_data_error = parseError.message;
            }
        }
        
        // 3. Если подключен amoCRM, получаем свежие данные
        if (amoCrmService.isInitialized && profile.amocrm_lead_id) {
            console.log(`🔄 Получение свежих данных из amoCRM для lead ${profile.amocrm_lead_id}...`);
            
            try {
                const lead = await amoCrmService.getLeadById(profile.amocrm_lead_id);
                
                if (lead && lead.custom_fields_values) {
                    const amoCrmAnalysis = {
                        lead_id: lead.id,
                        lead_name: lead.name,
                        fields_count: lead.custom_fields_values.length,
                        dates: {},
                        checkboxes: {},
                        visit_dates: {}
                    };
                    
                    for (const field of lead.custom_fields_values) {
                        const fieldId = field.field_id;
                        const fieldValue = amoCrmService.getFieldValue(field);
                        
                        // Даты
                        if ([850253, 850255, 850259, 851565].includes(fieldId)) {
                            amoCrmAnalysis.dates[fieldId] = {
                                name: amoCrmService.getFieldNameById(fieldId),
                                value: fieldValue,
                                parsed: amoCrmService.parseDate(fieldValue)
                            };
                        }
                        
                        // Чекбоксы
                        if (fieldId >= 884899 && fieldId <= 892895) {
                            const classNum = getClassNumberFromFieldId(fieldId);
                            if (fieldValue === 'true' || fieldValue === '1' || fieldValue === true) {
                                amoCrmAnalysis.checkboxes[classNum] = true;
                            }
                        }
                        
                        // Даты занятий
if (fieldId >= 884931 && fieldId <= 892897) {
    if (field.value && /^\d{9,13}$/.test(String(field.value))) { // Только timestamp
        const lessonNum = getLessonNumberFromFieldId(fieldId);
        const parsedDate = amoCrmService.parseDate(field.value);
        
        visitDates.push({
            field_id: fieldId,
            value: field.value,
            lesson_number: lessonNum,
            parsed_date: parsedDate
        });
    }
}
                    }
                    
                    result.amoCrm_fresh_data = amoCrmAnalysis;
                    console.log(`✅ Данные из amoCRM получены: ${Object.keys(amoCrmAnalysis.checkboxes).length} посещений`);
                }
            } catch (crmError) {
                console.error(`❌ Ошибка получения данных из amoCRM: ${crmError.message}`);
                result.amoCrm_error = crmError.message;
            }
        }
        
        // 4. Проверка таблицы schedule на возможные посещения
        console.log(`📅 Поиск в расписании для ${profile.branch}...`);
        
        const scheduleVisits = await db.all(`
            SELECT s.date, s.time, s.group_name, t.name as teacher_name
            FROM schedule s
            LEFT JOIN teachers t ON s.teacher_id = t.id
            WHERE s.branch = ? AND s.status = 'completed'
            ORDER BY s.date DESC
            LIMIT 10
        `, [profile.branch || 'Свиблово']);
        
        result.schedule_visits = {
            found: scheduleVisits.length,
            visits: scheduleVisits
        };
        
        console.log(`✅ В расписании найдено: ${scheduleVisits.length} завершенных занятий`);
        
        // 5. Рекомендации по отображению истории
        const recommendations = getVisitsDisplayRecommendations(result);
        result.recommendations = recommendations;
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Ошибка диагностики посещений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка диагностики',
            details: error.message
        });
    }
});

// ==================== ДИАГНОСТИКА СТРУКТУРЫ ПОЛЕЙ AMOCRM ====================

app.get('/api/debug/amocrm-fields', async (req, res) => {
    try {
        console.log('🔍 Диагностика структуры полей amoCRM');
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const result = await amoCrmService.getAllFieldsInfo();
        
        // Фильтруем поля, которые могут содержать данные о посещениях
        const visitRelatedFields = {
            leads: [],
            contacts: []
        };
        
        // Поиск полей со словами "занятие", "посещение", "чек", "check", "visit" и т.д.
        const visitKeywords = ['занятие', 'посещение', 'чек', 'check', 'visit', 'урок', 'lesson', 'класс'];
        
        // Поля сделок (leads)
        if (result.lead_fields && Array.isArray(result.lead_fields)) {
            result.lead_fields.forEach(field => {
                if (field && field.name) {
                    const fieldName = field.name.toLowerCase();
                    const isVisitField = visitKeywords.some(keyword => fieldName.includes(keyword));
                    
                    if (isVisitField || field.type === 'checkbox' || field.type === 'date') {
                        visitRelatedFields.leads.push({
                            id: field.id,
                            name: field.name,
                            type: field.type,
                            enums: field.enums || [],
                            enum_count: field.enums ? field.enums.length : 0
                        });
                    }
                }
            });
        }
        
        // Поля контактов (contacts)
        if (result.contact_fields && Array.isArray(result.contact_fields)) {
            result.contact_fields.forEach(field => {
                if (field && field.name) {
                    const fieldName = field.name.toLowerCase();
                    const isVisitField = visitKeywords.some(keyword => fieldName.includes(keyword));
                    
                    if (isVisitField || field.type === 'checkbox' || field.type === 'date') {
                        visitRelatedFields.contacts.push({
                            id: field.id,
                            name: field.name,
                            type: field.type,
                            enums: field.enums || [],
                            enum_count: field.enums ? field.enums.length : 0
                        });
                    }
                }
            });
        }
        
        // Проверяем известные поля посещений
        const knownVisitFields = {
            checkboxes: [],
            dates: []
        };
        
        // Известные ID полей для чекбоксов (24 занятия)
        const knownCheckboxIds = [
            884899, 884901, 884903, 884905, 884907, 884909, 884911, 884913,
            884915, 884917, 884919, 884921, 884923, 884925, 884927, 884929,
            892867, 892871, 892875, 892879, 892883, 892887, 892893, 892895
        ];
        
        // Известные ID полей для дат (24 занятия)
        const knownDateIds = [
            884931, 884933, 884935, 884937, 884939, 884941, 884943, 884945,
            884953, 884955, 884951, 884957, 884959, 884961, 884963, 884965,
            892869, 892873, 892877, 892881, 892885, 892889, 892891, 892897
        ];
        
        // Проверяем какие из известных полей существуют
        knownCheckboxIds.forEach(fieldId => {
            const field = result.field_mappings.find(f => f.id === fieldId);
            if (field) {
                knownVisitFields.checkboxes.push({
                    id: fieldId,
                    exists: true,
                    name: field.name || `Поле ${fieldId}`,
                    enum_count: field.enum_count || 0
                });
            } else {
                knownVisitFields.checkboxes.push({
                    id: fieldId,
                    exists: false,
                    name: `Поле ${fieldId} (не найдено)`
                });
            }
        });
        
        knownDateIds.forEach(fieldId => {
            const field = result.field_mappings.find(f => f.id === fieldId);
            if (field) {
                knownVisitFields.dates.push({
                    id: fieldId,
                    exists: true,
                    name: field.name || `Поле ${fieldId}`,
                    enum_count: field.enum_count || 0
                });
            } else {
                knownVisitFields.dates.push({
                    id: fieldId,
                    exists: false,
                    name: `Поле ${fieldId} (не найдено)`
                });
            }
        });
        
        res.json({
            success: true,
            data: {
                account_info: result.account,
                visit_related_fields: visitRelatedFields,
                known_fields_status: knownVisitFields,
                summary: {
                    total_lead_fields: result.lead_fields.length,
                    total_contact_fields: result.contact_fields.length,
                    visit_related_leads: visitRelatedFields.leads.length,
                    visit_related_contacts: visitRelatedFields.contacts.length,
                    known_checkboxes_found: knownVisitFields.checkboxes.filter(f => f.exists).length,
                    known_dates_found: knownVisitFields.dates.filter(f => f.exists).length
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики полей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка диагностики полей',
            details: error.message
        });
    }
});

// ==================== ПРОВЕРКА РЕАЛЬНОЙ СДЕЛКИ НА ПОСЕЩЕНИЯ ====================
// В server.js добавь этот маршрут
app.get('/api/find-all-fields/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        console.log(`🔍 ПОИСК ВСЕХ ПОЛЕЙ В СДЕЛКЕ ${leadId}`);
        
        // 1. Прямой запрос к amoCRM
        const lead = await amoCrmService.getLeadById(leadId);
        
        if (!lead) {
            return res.json({ 
                success: false, 
                error: `Сделка ${leadId} не найдена в amoCRM` 
            });
        }
        
        console.log(`✅ Сделка найдена: "${lead.name}"`);
        
        const allFields = [];
        const checkboxFields = [];
        const dateFields = [];
        const numericFields = [];
        const textFields = [];
        
        if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
            console.log(`📊 Найдено кастомных полей: ${lead.custom_fields_values.length}`);
            
            for (const field of lead.custom_fields_values) {
                const fieldId = field.field_id;
                let fieldValue = null;
                let valueType = 'unknown';
                
                // Получаем значение
                if (field.values && field.values.length > 0) {
                    const firstValue = field.values[0];
                    
                    // Проверяем все возможные варианты
                    if (firstValue.value !== undefined) {
                        fieldValue = firstValue.value;
                        
                        // Определяем тип значения
                        if (typeof fieldValue === 'boolean') {
                            valueType = 'boolean';
                        } else if (typeof fieldValue === 'number') {
                            valueType = 'number';
                        } else if (fieldValue === 'true' || fieldValue === 'false') {
                            valueType = 'boolean_string';
                        } else if (!isNaN(fieldValue) && fieldValue.trim() !== '') {
                            valueType = 'number_string';
                        } else if (fieldValue.includes('-') || fieldValue.includes('.')) {
                            // Проверяем формат даты
                            if (/^\d{4}-\d{2}-\d{2}/.test(fieldValue) || 
                                /^\d{1,2}\.\d{1,2}\.\d{4}/.test(fieldValue) ||
                                /^\d{9,10}$/.test(fieldValue)) {
                                valueType = 'date_string';
                            } else {
                                valueType = 'text';
                            }
                        } else {
                            valueType = 'text';
                        }
                        
                    } else if (firstValue.enum_id !== undefined) {
                        fieldValue = String(firstValue.enum_id);
                        valueType = 'enum_id';
                    }
                }
                
                const fieldInfo = {
                    field_id: fieldId,
                    value: fieldValue,
                    value_type: valueType,
                    values: field.values || []
                };
                
                allFields.push(fieldInfo);
                
                // Группируем по типам
                if (valueType.includes('boolean')) {
                    checkboxFields.push(fieldInfo);
                } else if (valueType.includes('date')) {
                    dateFields.push(fieldInfo);
                } else if (valueType.includes('number')) {
                    numericFields.push(fieldInfo);
                } else if (valueType === 'text') {
                    textFields.push(fieldInfo);
                }
                
                // Выводим важные поля
                if (valueType.includes('boolean') || valueType.includes('date') || 
                    valueType.includes('number') || fieldId >= 884899) {
                    console.log(`   ${fieldId}: ${fieldValue} (${valueType})`);
                }
            }
        } else {
            console.log('⚠️  Нет кастомных полей в сделке');
        }
        
        // 2. Также получаем информацию о стандартных полях сделки
        const standardFields = {
            id: lead.id,
            name: lead.name,
            price: lead.price,
            status_id: lead.status_id,
            pipeline_id: lead.pipeline_id,
            created_at: lead.created_at,
            updated_at: lead.updated_at,
            closed_at: lead.closed_at
        };
        
        // 3. Формируем отчет
        const report = {
            success: true,
            lead_info: standardFields,
            fields_summary: {
                total_custom_fields: allFields.length,
                checkbox_fields: checkboxFields.length,
                date_fields: dateFields.length,
                numeric_fields: numericFields.length,
                text_fields: textFields.length
            },
            all_custom_fields: allFields.map(f => ({
                id: f.field_id,
                value: f.value,
                type: f.value_type
            })),
            checkbox_fields: checkboxFields.map(f => ({
                id: f.field_id,
                value: f.value,
                is_true: f.value === true || f.value === 'true' || f.value === '1'
            })),
            date_fields: dateFields.map(f => ({
                id: f.field_id,
                value: f.value,
                parsed: f.value ? amoCrmService.parseDate(f.value) : null
            })),
            numeric_fields: numericFields.map(f => ({
                id: f.field_id,
                value: f.value,
                numeric: parseInt(f.value) || 0
            }))
        };
        
        console.log('\n📋 ИТОГОВЫЙ ОТЧЕТ:');
        console.log(`   Всего полей: ${allFields.length}`);
        console.log(`   Чекбоксов: ${checkboxFields.length}`);
        console.log(`   Дат: ${dateFields.length}`);
        console.log(`   Числовых: ${numericFields.length}`);
        
        // 4. Ищем поля посещений (по известным ID или паттернам)
        const visitCheckboxes = [];
        const visitDates = [];
        
        allFields.forEach(field => {
            const fieldId = field.field_id;
            
            // Чекбоксы посещений (диапазон 884899-892895)
            if (fieldId >= 884899 && fieldId <= 892895) {
                const isChecked = field.value === true || field.value === 'true' || 
                                 field.value === '1' || field.value === 1;
                if (isChecked) {
                    visitCheckboxes.push({
                        field_id: fieldId,
                        value: field.value,
                        lesson_number: getLessonNumberFromFieldId(fieldId)
                    });
                }
            }
            
            // Даты посещений (диапазон 884931-892897)
            if (fieldId >= 884931 && fieldId <= 892897) {
                if (field.value) {
                    visitDates.push({
                        field_id: fieldId,
                        value: field.value,
                        lesson_number: getLessonNumberFromFieldId(fieldId),
                        parsed_date: amoCrmService.parseDate(field.value)
                    });
                }
            }
        });
        
        console.log(`\n🎯 НАЙДЕНЫ ПОСЕЩЕНИЯ:`);
        console.log(`   Чекбоксов отмеченных: ${visitCheckboxes.length}`);
        console.log(`   Дат заполненных: ${visitDates.length}`);
        
        // 5. Группируем посещения
        const groupedVisits = {};
        
        visitCheckboxes.forEach(cb => {
            const lessonNum = cb.lesson_number;
            if (!groupedVisits[lessonNum]) {
                groupedVisits[lessonNum] = {};
            }
            groupedVisits[lessonNum].attended = true;
            groupedVisits[lessonNum].checkbox_id = cb.field_id;
        });
        
        visitDates.forEach(date => {
            const lessonNum = date.lesson_number;
            if (!groupedVisits[lessonNum]) {
                groupedVisits[lessonNum] = {};
            }
            groupedVisits[lessonNum].date = date.parsed_date;
            groupedVisits[lessonNum].date_id = date.field_id;
            groupedVisits[lessonNum].raw_date = date.value;
        });
        
        // Формируем финальный список посещений
        const finalVisits = [];
        for (let i = 1; i <= 24; i++) {
            if (groupedVisits[i] && groupedVisits[i].attended) {
                finalVisits.push({
                    lesson_number: i,
                    attended: true,
                    date: groupedVisits[i].date || null,
                    has_date: !!groupedVisits[i].date,
                    checkbox_field: groupedVisits[i].checkbox_id,
                    date_field: groupedVisits[i].date_id,
                    raw_date: groupedVisits[i].raw_date
                });
            }
        }
        
        report.visits_discovery = {
            checkboxes_found: visitCheckboxes,
            dates_found: visitDates,
            grouped_visits: groupedVisits,
            final_visits: finalVisits,
            total_visits: finalVisits.length
        };
        
        // 6. Проверяем поля счетчиков
        const usedClassesField = allFields.find(f => f.field_id === 850257); // "Счетчик занятий:"
        const usedClassesNumField = allFields.find(f => f.field_id === 884251); // "Кол-во отхоженных занятий"
        const remainingClassesField = allFields.find(f => f.field_id === 890163); // "Остаток занятий"
        
        report.counters = {
            used_classes_select: usedClassesField ? {
                id: 850257,
                value: usedClassesField.value,
                numeric: amoCrmService.parseNumeric(usedClassesField.value)
            } : null,
            used_classes_numeric: usedClassesNumField ? {
                id: 884251,
                value: usedClassesNumField.value,
                numeric: parseInt(usedClassesNumField.value) || 0
            } : null,
            remaining_classes: remainingClassesField ? {
                id: 890163,
                value: remainingClassesField.value,
                numeric: parseInt(remainingClassesField.value) || 0
            } : null
        };
        
        console.log(`\n🔢 СЧЕТЧИКИ:`);
        console.log(`   USED_CLASSES (850257): ${usedClassesField?.value || 'НЕТ'}`);
        console.log(`   USED_CLASSES_NUM (884251): ${usedClassesNumField?.value || 'НЕТ'}`);
        console.log(`   REMAINING_CLASSES (890163): ${remainingClassesField?.value || 'НЕТ'}`);
        
        res.json(report);
        
    } catch (error) {
        console.error('❌ Ошибка поиска полей:', error.message);
        console.error('Stack:', error.stack);
        
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});
app.get('/api/debug/real-lead-visits/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`🔍 Проверка реальной сделки ${leadId} на посещения`);
        
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
        
        console.log(`📄 Сделка: "${lead.name}" (ID: ${lead.id})`);
        
        const analysis = {
            lead_id: lead.id,
            lead_name: lead.name,
            total_fields: lead.custom_fields_values ? lead.custom_fields_values.length : 0,
            all_fields: [],
            visit_checkboxes: [],
            visit_dates: [],
            subscription_fields: [],
            other_visit_related: []
        };
        
        if (lead.custom_fields_values && Array.isArray(lead.custom_fields_values)) {
            console.log(`📋 Анализ ${lead.custom_fields_values.length} полей сделки...`);
            
            lead.custom_fields_values.forEach(field => {
                const fieldId = field.field_id;
                const fieldValue = field.values?.[0]?.value || field.values?.[0]?.enum_id;
                const fieldName = amoCrmService.getFieldNameById(fieldId);
                
                const fieldInfo = {
                    id: fieldId,
                    name: fieldName,
                    value: fieldValue,
                    type: 'unknown'
                };
                
                analysis.all_fields.push(fieldInfo);
                
                // Определяем тип поля
                if (fieldId >= 884899 && fieldId <= 892895) {
                    fieldInfo.type = 'visit_checkbox';
                    analysis.visit_checkboxes.push({
                        ...fieldInfo,
                        lesson_number: getLessonNumberFromFieldId(fieldId),
                        is_checked: fieldValue === 'true' || fieldValue === '1' || fieldValue === true || fieldValue === 1
                    });
                } 
                else if (fieldId >= 884931 && fieldId <= 892897) {
                    fieldInfo.type = 'visit_date';
                    analysis.visit_dates.push({
                        ...fieldInfo,
                        lesson_number: getLessonNumberFromFieldId(fieldId),
                        parsed_date: fieldValue ? amoCrmService.parseDate(fieldValue) : null
                    });
                }
                else if ([850241, 850257, 850255, 851565, 850259, 850253].includes(fieldId)) {
                    fieldInfo.type = 'subscription';
                    analysis.subscription_fields.push(fieldInfo);
                }
                else if (fieldName && (
                    fieldName.toLowerCase().includes('занятие') ||
                    fieldName.toLowerCase().includes('посещение') ||
                    fieldName.toLowerCase().includes('чек') ||
                    fieldName.toLowerCase().includes('check') ||
                    fieldName.toLowerCase().includes('visit')
                )) {
                    fieldInfo.type = 'visit_related';
                    analysis.other_visit_related.push(fieldInfo);
                }
            });
        }
        
        // Анализируем найденные данные
        const checkedCheckboxes = analysis.visit_checkboxes.filter(cb => cb.is_checked);
        const filledDates = analysis.visit_dates.filter(d => d.value);
        
        console.log(`✅ Найдено:`);
        console.log(`   • Всего полей: ${analysis.total_fields}`);
        console.log(`   • Чекбоксов посещений: ${analysis.visit_checkboxes.length}`);
        console.log(`   • Отмеченных чекбоксов: ${checkedCheckboxes.length}`);
        console.log(`   • Полей с датами: ${analysis.visit_dates.length}`);
        console.log(`   • Заполненных дат: ${filledDates.length}`);
        console.log(`   • Других полей о посещениях: ${analysis.other_visit_related.length}`);
        
        // Показываем первые 5 найденных посещений
        if (checkedCheckboxes.length > 0) {
            console.log(`\n📊 Найденные посещения:`);
            checkedCheckboxes.slice(0, 5).forEach(cb => {
                const dateField = analysis.visit_dates.find(d => d.lesson_number === cb.lesson_number);
                console.log(`   • Занятие ${cb.lesson_number}: ${dateField ? dateField.parsed_date : 'без даты'}`);
            });
        }
        
        res.json({
            success: true,
            data: analysis,
            summary: {
                total_fields: analysis.total_fields,
                visit_checkboxes_total: analysis.visit_checkboxes.length,
                visit_checkboxes_checked: checkedCheckboxes.length,
                visit_dates_total: analysis.visit_dates.length,
                visit_dates_filled: filledDates.length,
                subscription_fields: analysis.subscription_fields.length,
                other_visit_fields: analysis.other_visit_related.length,
                has_visits_data: checkedCheckboxes.length > 0 || filledDates.length > 0
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки сделки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки сделки',
            details: error.message
        });
    }
});
// В server.js добавь:
app.get('/api/debug/crm-fields-discovery/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        console.log(`🔍 ПОИСК ВСЕХ ПОЛЕЙ В СДЕЛКЕ ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({ success: false, error: 'CRM не подключен' });
        }
        
        const lead = await amoCrmService.getLeadById(leadId);
        if (!lead) {
            return res.json({ success: false, error: 'Сделка не найдена' });
        }
        
        console.log(`📄 Сделка: "${lead.name}" (ID: ${lead.id})`);
        
        const result = {
            lead_id: lead.id,
            lead_name: lead.name,
            status_id: lead.status_id,
            all_fields: [],
            fields_by_type: {
                checkbox: [],
                date: [],
                select: [],
                numeric: [],
                text: [],
                multiselect: []
            },
            visit_related: [],
            date_fields: [],
            counter_fields: []
        };
        
        if (lead.custom_fields_values) {
            console.log(`📊 Анализ ${lead.custom_fields_values.length} полей...`);
            
            lead.custom_fields_values.forEach(field => {
                const fieldId = field.field_id;
                let fieldValue = null;
                let fieldType = 'unknown';
                
                // Определяем значение
                if (field.values && field.values.length > 0) {
                    fieldValue = field.values[0].value !== undefined ? 
                                field.values[0].value : 
                                field.values[0].enum_id;
                }
                
                // Определяем тип по field_id
                if (fieldId >= 884899 && fieldId <= 892895) {
                    fieldType = 'checkbox_visit';
                } else if (fieldId >= 884931 && fieldId <= 892897) {
                    fieldType = 'date_visit';
                } else if ([850241, 850257, 850255, 851565, 850259, 850253].includes(fieldId)) {
                    fieldType = 'subscription_main';
                } else if ([884251, 890163].includes(fieldId)) {
                    fieldType = 'counter';
                } else {
                    // Пробуем определить по значению
                    if (typeof fieldValue === 'boolean' || fieldValue === 'true' || fieldValue === 'false') {
                        fieldType = 'checkbox';
                    } else if (!isNaN(parseInt(fieldValue)) && fieldValue.length < 10) {
                        fieldType = 'numeric';
                    } else if (fieldValue && fieldValue.includes('-') || fieldValue && fieldValue.includes('.')) {
                        fieldType = 'date_possible';
                    } else {
                        fieldType = 'text';
                    }
                }
                
                const fieldInfo = {
                    field_id: fieldId,
                    value: fieldValue,
                    type: fieldType,
                    raw: field.values || []
                };
                
                result.all_fields.push(fieldInfo);
                result.fields_by_type[fieldType.split('_')[0]].push(fieldInfo);
                
                // Собираем посещения
                if (fieldType === 'checkbox_visit') {
                    const lessonNum = getLessonNumberFromFieldId(fieldId);
                    const isChecked = fieldValue === true || fieldValue === 'true' || fieldValue === '1' || fieldValue === 1;
                    
                    result.visit_related.push({
                        ...fieldInfo,
                        lesson_number: lessonNum,
                        is_checked: isChecked,
                        field_name: `CLASS_${lessonNum}`
                    });
                    
                    if (isChecked) {
                        console.log(`   ✅ Чекбокс занятия ${lessonNum} (${fieldId}): ОТМЕЧЕНО`);
                    }
                }
                
                // Собираем даты
                if (fieldType === 'date_visit') {
                    const lessonNum = getLessonNumberFromFieldId(fieldId);
                    
                    result.date_fields.push({
                        ...fieldInfo,
                        lesson_number: lessonNum,
                        parsed_date: fieldValue ? amoCrmService.parseDate(fieldValue) : null,
                        field_name: `CLASS_DATE_${lessonNum}`
                    });
                    
                    if (fieldValue) {
                        console.log(`   📅 Дата занятия ${lessonNum} (${fieldId}): ${fieldValue}`);
                    }
                }
                
                // Счетчики
                if (fieldType === 'counter') {
                    result.counter_fields.push({
                        ...fieldInfo,
                        numeric_value: parseInt(fieldValue) || 0
                    });
                    
                    console.log(`   🔢 Счетчик (${fieldId}): ${fieldValue}`);
                }
            });
        }
        
        // Группируем посещения по номерам
        const groupedVisits = {};
        result.visit_related.forEach(visit => {
            if (!groupedVisits[visit.lesson_number]) {
                groupedVisits[visit.lesson_number] = {
                    lesson_number: visit.lesson_number,
                    checkbox_id: null,
                    checkbox_checked: false,
                    date_id: null,
                    date_value: null,
                    parsed_date: null
                };
            }
            
            if (visit.type === 'checkbox_visit') {
                groupedVisits[visit.lesson_number].checkbox_id = visit.field_id;
                groupedVisits[visit.lesson_number].checkbox_checked = visit.is_checked;
            }
        });
        
        result.date_fields.forEach(dateField => {
            if (groupedVisits[dateField.lesson_number]) {
                groupedVisits[dateField.lesson_number].date_id = dateField.field_id;
                groupedVisits[dateField.lesson_number].date_value = dateField.value;
                groupedVisits[dateField.lesson_number].parsed_date = dateField.parsed_date;
            }
        });
        
        // Формируем итоговый список посещений
        const finalVisits = [];
        for (let i = 1; i <= 24; i++) {
            if (groupedVisits[i] && groupedVisits[i].checkbox_checked) {
                finalVisits.push({
                    lesson_number: i,
                    attended: true,
                    date: groupedVisits[i].parsed_date,
                    has_date: !!groupedVisits[i].parsed_date,
                    checkbox_field: groupedVisits[i].checkbox_id,
                    date_field: groupedVisits[i].date_id,
                    raw_date_value: groupedVisits[i].date_value
                });
            }
        }
        
        result.final_visits = finalVisits;
        
        res.json({
            success: true,
            data: result,
            summary: {
                total_fields: result.all_fields.length,
                visit_checkboxes: result.visit_related.filter(v => v.is_checked).length,
                date_fields: result.date_fields.filter(d => d.value).length,
                final_visits_count: finalVisits.length,
                counter_values: result.counter_fields.map(c => c.numeric_value)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска полей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка поиска полей'
        });
    }
});
// ==================== ДИАГНОСТИЧЕСКИЙ МАРШРУТ ДЛЯ АНАЛИЗА ДАТ В AMOCRM ====================
app.get('/api/debug/amocrm-dates/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`🔍 ДИАГНОСТИКА ДАТ AMOCRM ДЛЯ ТЕЛЕФОНА: ${formattedPhone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // 1. Поиск контактов
        const contacts = await amoCrmService.searchContactsByPhone(formattedPhone);
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        if (contacts.length === 0) {
            return res.json({
                success: false,
                error: 'Контакты не найдены'
            });
        }
        
        const diagnosticResults = [];
        
        // 2. Анализ каждого контакта
        for (const contact of contacts) {
            console.log(`\n👤 Анализ контакта: ${contact.name} (ID: ${contact.id})`);
            
            const contactInfo = await amoCrmService.getFullContactInfo(contact.id);
            
            // 3. Получение всех сделок контакта
            const leads = await amoCrmService.getContactLeads(contact.id);
            console.log(`📄 Найдено сделок: ${leads.length}`);
            
            const contactDiagnostic = {
                contact_id: contact.id,
                contact_name: contact.name,
                leads_count: leads.length,
                leads: []
            };
            
            // 4. Детальный анализ каждой сделки
            for (const lead of leads) {
                console.log(`\n📊 АНАЛИЗ СДЕЛКИ ${lead.id}: "${lead.name}"`);
                console.log(`   Статус ID: ${lead.status_id}`);
                console.log(`   Создана: ${lead.created_at}`);
                console.log(`   Обновлена: ${lead.updated_at}`);
                
                const leadDiagnostic = {
                    lead_id: lead.id,
                    lead_name: lead.name,
                    status_id: lead.status_id,
                    created_at: lead.created_at,
                    updated_at: lead.updated_at,
                    price: lead.price,
                    fields: {},
                    date_fields: {}
                };
                
                // 5. Анализ всех кастомных полей сделки
                if (lead.custom_fields_values) {
                    console.log(`   📋 Кастомные поля (${lead.custom_fields_values.length}):`);
                    
                    for (const field of lead.custom_fields_values) {
                        const fieldId = field.field_id;
                        const fieldValue = amoCrmService.getFieldValue(field);
                        
                        if (!fieldValue) continue;
                        
                        const fieldName = amoCrmService.getFieldNameById(fieldId);
                        const displayValue = amoCrmService.getFieldDisplayValue(fieldId, fieldValue);
                        
                        leadDiagnostic.fields[fieldId] = {
                            name: fieldName,
                            raw_value: fieldValue,
                            display_value: displayValue,
                            values: field.values || []
                        };
                        
                        // Отдельно сохраняем поля с датами
                        if (fieldId === amoCrmService.FIELD_IDS.LEAD.ACTIVATION_DATE ||
                            fieldId === amoCrmService.FIELD_IDS.LEAD.EXPIRATION_DATE ||
                            fieldId === amoCrmService.FIELD_IDS.LEAD.LAST_VISIT_DATE ||
                            fieldId === amoCrmService.FIELD_IDS.LEAD.PURCHASE_DATE) {
                            
                            const parsedDate = amoCrmService.parseDate(fieldValue);
                            
                            leadDiagnostic.date_fields[fieldId] = {
                                name: fieldName,
                                raw_value: fieldValue,
                                parsed_date: parsedDate,
                                is_valid: !isNaN(new Date(parsedDate).getTime())
                            };
                            
                            console.log(`   📅 ${fieldName} (${fieldId}):`);
                            console.log(`      Сырое значение: ${fieldValue}`);
                            console.log(`      Разобранная дата: ${parsedDate}`);
                            console.log(`      Валидная дата: ${!isNaN(new Date(parsedDate).getTime())}`);
                        }
                        
                        // Анализ полей занятий
                        if (fieldId === amoCrmService.FIELD_IDS.LEAD.TOTAL_CLASSES ||
                            fieldId === amoCrmService.FIELD_IDS.LEAD.USED_CLASSES) {
                            
                            console.log(`   🎫 ${fieldName} (${fieldId}):`);
                            console.log(`      Значение: ${fieldValue}`);
                            console.log(`      Отображение: ${displayValue}`);
                        }
                        
                        // Анализ чекбоксов посещений
                        if (fieldId >= 884899 && fieldId <= 892895) {
                            // Это чекбокс занятия
                            if (fieldValue === 'true' || fieldValue === '1') {
                                console.log(`   ✅ Посещение (поле ${fieldId}): отмечено`);
                            }
                        }
                        
                        // Анализ дат занятий
                        if (fieldId >= 884931 && fieldId <= 892897) {
                            // Это дата занятия
                            if (fieldValue) {
                                const parsedDate = amoCrmService.parseDate(fieldValue);
                                console.log(`   📅 Дата занятия (поле ${fieldId}): ${parsedDate}`);
                            }
                        }
                    }
                }
                
                // 6. Извлекаем информацию об абонементе
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                leadDiagnostic.subscription = {
                    has_subscription: subscriptionInfo.hasSubscription,
                    total_classes: subscriptionInfo.totalClasses,
                    used_classes: subscriptionInfo.usedClasses,
                    remaining_classes: subscriptionInfo.remainingClasses,
                    subscription_type: subscriptionInfo.subscriptionType,
                    subscription_active: subscriptionInfo.subscriptionActive,
                    activation_date: subscriptionInfo.activationDate,
                    expiration_date: subscriptionInfo.expirationDate,
                    last_visit_date: subscriptionInfo.lastVisitDate,
                    purchase_date: subscriptionInfo.purchaseDate,
                    freeze_status: subscriptionInfo.freezeStatus,
                    branch: subscriptionInfo.branch,
                    subscription_status: subscriptionInfo.subscriptionStatus,
                    subscription_badge: subscriptionInfo.subscriptionBadge
                };
                
                console.log(`\n   🎯 ИНФОРМАЦИЯ ОБ АБОНЕМЕНТЕ:`);
                console.log(`      Есть абонемент: ${subscriptionInfo.hasSubscription}`);
                console.log(`      Всего занятий: ${subscriptionInfo.totalClasses}`);
                console.log(`      Использовано: ${subscriptionInfo.usedClasses}`);
                console.log(`      Осталось: ${subscriptionInfo.remainingClasses}`);
                console.log(`      Дата активации: ${subscriptionInfo.activationDate}`);
                console.log(`      Дата окончания: ${subscriptionInfo.expirationDate}`);
                console.log(`      Дата последнего визита: ${subscriptionInfo.lastVisitDate}`);
                console.log(`      Дата покупки: ${subscriptionInfo.purchaseDate}`);
                console.log(`      Статус: ${subscriptionInfo.subscriptionStatus}`);
                console.log(`      Активен: ${subscriptionInfo.subscriptionActive}`);
                
                contactDiagnostic.leads.push(leadDiagnostic);
            }
            
            diagnosticResults.push(contactDiagnostic);
        }
        
        // 7. Анализ полей контакта
        console.log(`\n👤 АНАЛИЗ ПОЛЕЙ КОНТАКТА:`);
        const contactFieldsAnalysis = [];
        
        for (const contact of contacts) {
            const fullContact = await amoCrmService.getFullContactInfo(contact.id);
            
            if (fullContact?.custom_fields_values) {
                const contactAnalysis = {
                    contact_id: contact.id,
                    contact_name: contact.name,
                    date_fields: {}
                };
                
                for (const field of fullContact.custom_fields_values) {
                    const fieldId = field.field_id;
                    const fieldValue = amoCrmService.getFieldValue(field);
                    
                    // Проверяем поля с датами в контакте
                    if (fieldId === amoCrmService.FIELD_IDS.CONTACT.LAST_VISIT ||
                        fieldId === amoCrmService.FIELD_IDS.CONTACT.LAST_SUB_ACTIVATION ||
                        fieldId === amoCrmService.FIELD_IDS.CONTACT.PARENT_BIRTHDAY ||
                        fieldId === amoCrmService.FIELD_IDS.CONTACT.CHILD_1_BIRTHDAY ||
                        fieldId === amoCrmService.FIELD_IDS.CONTACT.CHILD_2_BIRTHDAY ||
                        fieldId === amoCrmService.FIELD_IDS.CONTACT.CHILD_3_BIRTHDAY) {
                        
                        const fieldName = amoCrmService.getFieldNameById(fieldId);
                        const parsedDate = amoCrmService.parseDate(fieldValue);
                        
                        contactAnalysis.date_fields[fieldId] = {
                            name: fieldName,
                            raw_value: fieldValue,
                            parsed_date: parsedDate,
                            is_valid: !isNaN(new Date(parsedDate).getTime())
                        };
                        
                        console.log(`   📅 ${fieldName} (${fieldId}):`);
                        console.log(`      Сырое значение: ${fieldValue}`);
                        console.log(`      Разобранная дата: ${parsedDate}`);
                    }
                }
                
                contactFieldsAnalysis.push(contactAnalysis);
            }
        }
        
        // 8. Формируем итоговый отчет
        const summary = {
            total_contacts: contacts.length,
            total_leads: diagnosticResults.reduce((sum, contact) => sum + contact.leads_count, 0),
            active_subscriptions: 0,
            has_dates: {
                activation_date: 0,
                expiration_date: 0,
                last_visit_date: 0,
                purchase_date: 0
            }
        };
        
        // Подсчет статистики
        for (const contact of diagnosticResults) {
            for (const lead of contact.leads) {
                if (lead.subscription.has_subscription) {
                    if (lead.subscription.activation_date) summary.has_dates.activation_date++;
                    if (lead.subscription.expiration_date) summary.has_dates.expiration_date++;
                    if (lead.subscription.last_visit_date) summary.has_dates.last_visit_date++;
                    if (lead.subscription.purchase_date) summary.has_dates.purchase_date++;
                    
                    if (lead.subscription.subscription_active) {
                        summary.active_subscriptions++;
                    }
                }
            }
        }
        
        res.json({
            success: true,
            diagnostic: {
                phone: formattedPhone,
                search_time: new Date().toISOString(),
                summary: summary,
                contacts: diagnosticResults,
                contact_fields_analysis: contactFieldsAnalysis,
                field_mappings: {
                    LEAD: {
                        ACTIVATION_DATE: {
                            id: amoCrmService.FIELD_IDS.LEAD.ACTIVATION_DATE,
                            name: amoCrmService.getFieldNameById(amoCrmService.FIELD_IDS.LEAD.ACTIVATION_DATE)
                        },
                        EXPIRATION_DATE: {
                            id: amoCrmService.FIELD_IDS.LEAD.EXPIRATION_DATE,
                            name: amoCrmService.getFieldNameById(amoCrmService.FIELD_IDS.LEAD.EXPIRATION_DATE)
                        },
                        LAST_VISIT_DATE: {
                            id: amoCrmService.FIELD_IDS.LEAD.LAST_VISIT_DATE,
                            name: amoCrmService.getFieldNameById(amoCrmService.FIELD_IDS.LEAD.LAST_VISIT_DATE)
                        },
                        PURCHASE_DATE: {
                            id: amoCrmService.FIELD_IDS.LEAD.PURCHASE_DATE,
                            name: amoCrmService.getFieldNameById(amoCrmService.FIELD_IDS.LEAD.PURCHASE_DATE)
                        }
                    },
                    CONTACT: {
                        LAST_VISIT: {
                            id: amoCrmService.FIELD_IDS.CONTACT.LAST_VISIT,
                            name: amoCrmService.getFieldNameById(amoCrmService.FIELD_IDS.CONTACT.LAST_VISIT)
                        },
                        LAST_SUB_ACTIVATION: {
                            id: amoCrmService.FIELD_IDS.CONTACT.LAST_SUB_ACTIVATION,
                            name: amoCrmService.getFieldNameById(amoCrmService.FIELD_IDS.CONTACT.LAST_SUB_ACTIVATION)
                        }
                    }
                },
                recommendations: getDateFieldRecommendations(summary)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка диагностики',
            details: error.message,
            stack: error.stack
        });
    }
});
// В server.js добавьте:
app.get('/api/debug/visits-detailed/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const cleanPhone = phone.replace(/\D/g, '');
        
        console.log(`🔍 ДЕТАЛЬНАЯ ДИАГНОСТИКА ПОСЕЩЕНИЙ ДЛЯ: ${phone}`);
        
        // Получаем профиль
        const profile = await db.get(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1 
             ORDER BY subscription_active DESC 
             LIMIT 1`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        
        if (!profile) {
            return res.json({ success: false, error: 'Профиль не найден' });
        }
        
        console.log(`👤 Профиль: ${profile.student_name}`);
        console.log(`📊 Занятий: ${profile.used_classes}/${profile.total_classes}`);
        console.log(`📅 Даты активации: ${profile.activation_date}`);
        console.log(`📅 Последний визит: ${profile.last_visit_date}`);
        console.log(`📅 Окончание: ${profile.expiration_date}`);
        
        const result = {
            profile_info: {
                name: profile.student_name,
                used_classes: profile.used_classes,
                total_classes: profile.total_classes,
                activation_date: profile.activation_date,
                last_visit_date: profile.last_visit_date,
                expiration_date: profile.expiration_date
            },
            lead_data_analysis: null,
            visits_found: []
        };
        
        // Анализ lead_data
        if (profile.lead_data && profile.lead_data !== '{}') {
            try {
                const leadData = JSON.parse(profile.lead_data);
                console.log(`📄 Lead ID: ${leadData.id || 'НЕТ'}`);
                console.log(`📄 Название сделки: ${leadData.name || 'НЕТ'}`);
                
                result.lead_data_info = {
                    lead_id: leadData.id,
                    lead_name: leadData.name,
                    custom_fields_count: leadData.custom_fields_values?.length || 0
                };
                
                // Поиск полей с посещениями
                if (leadData.custom_fields_values) {
                    const visitFields = {};
                    
                    leadData.custom_fields_values.forEach(field => {
                        const fieldId = field.field_id;
                        const value = field.values?.[0]?.value || field.values?.[0]?.enum_id;
                        
                        // Чекбоксы занятий (1-24)
                        if (fieldId >= 884899 && fieldId <= 892895) {
                            const lessonNum = getLessonNumberFromFieldId(fieldId);
                            const isChecked = value === 'true' || value === '1' || value === true || value === 1;
                            
                            if (isChecked) {
                                visitFields[lessonNum] = visitFields[lessonNum] || {};
                                visitFields[lessonNum].attended = true;
                                console.log(`✅ Занятие ${lessonNum}: отмечено как посещенное`);
                            }
                        }
                        
                        // Даты занятий (1-24)
                        if (fieldId >= 884931 && fieldId <= 892897) {
                            const lessonNum = getLessonNumberFromFieldId(fieldId);
                            if (value && value !== '0') {
                                visitFields[lessonNum] = visitFields[lessonNum] || {};
                                visitFields[lessonNum].date = amoCrmService.parseDate(value);
                                console.log(`📅 Занятие ${lessonNum}: дата ${visitFields[lessonNum].date}`);
                            }
                        }
                    });
                    
                    // Формируем список посещений
                    for (let i = 1; i <= 24; i++) {
                        if (visitFields[i]) {
                            result.visits_found.push({
                                lesson_number: i,
                                attended: visitFields[i].attended || false,
                                date: visitFields[i].date || null,
                                has_date: !!visitFields[i].date
                            });
                        }
                    }
                }
                
            } catch (error) {
                console.error(`❌ Ошибка парсинга lead_data: ${error.message}`);
            }
        } else {
            console.log(`❌ Нет lead_data в профиле`);
        }
        
        console.log(`📊 Найдено посещений в lead_data: ${result.visits_found.length}`);
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка диагностики'
        });
    }
});
// МАРШРУТ ДЛЯ АНАЛИЗА КОНКРЕТНОЙ СДЕЛКИ
app.get('/api/debug/lead/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`🔍 ДЕТАЛЬНЫЙ АНАЛИЗ СДЕЛКИ ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем сделку
        const lead = await amoCrmService.getLeadById(leadId);
        
        if (!lead) {
            return res.json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        console.log(`📄 Сделка: "${lead.name}" (ID: ${lead.id})`);
        console.log(`   Статус: ${lead.status_id}`);
        console.log(`   Цена: ${lead.price}`);
        console.log(`   Создана: ${lead.created_at}`);
        console.log(`   Обновлена: ${lead.updated_at}`);
        
        const analysis = {
            lead_id: lead.id,
            lead_name: lead.name,
            status_id: lead.status_id,
            created_at: lead.created_at,
            updated_at: lead.updated_at,
            price: lead.price,
            pipeline_id: lead.pipeline_id,
            fields_by_category: {
                subscription: {},
                dates: {},
                classes: {},
                other: {}
            },
            raw_custom_fields: [],
            subscription_info: null
        };
        
        // Анализ кастомных полей
        if (lead.custom_fields_values) {
            console.log(`📋 Кастомные поля (${lead.custom_fields_values.length}):`);
            
            for (const field of lead.custom_fields_values) {
                const fieldId = field.field_id;
                const fieldValue = amoCrmService.getFieldValue(field);
                
                if (!fieldValue) continue;
                
                const fieldName = amoCrmService.getFieldNameById(fieldId);
                const displayValue = amoCrmService.getFieldDisplayValue(fieldId, fieldValue);
                
                const fieldInfo = {
                    field_id: fieldId,
                    field_name: fieldName,
                    raw_value: fieldValue,
                    display_value: displayValue,
                    values: field.values || []
                };
                
                analysis.raw_custom_fields.push(fieldInfo);
                
                // Категоризация полей
                if (fieldId === amoCrmService.FIELD_IDS.LEAD.TOTAL_CLASSES ||
                    fieldId === amoCrmService.FIELD_IDS.LEAD.USED_CLASSES ||
                    fieldId === amoCrmService.FIELD_IDS.LEAD.USED_CLASSES_NUM ||
                    fieldId === amoCrmService.FIELD_IDS.LEAD.REMAINING_CLASSES) {
                    
                    analysis.fields_by_category.subscription[fieldId] = fieldInfo;
                    console.log(`   🎫 ${fieldName}: ${fieldValue} -> ${displayValue}`);
                }
                else if (fieldId === amoCrmService.FIELD_IDS.LEAD.ACTIVATION_DATE ||
                         fieldId === amoCrmService.FIELD_IDS.LEAD.EXPIRATION_DATE ||
                         fieldId === amoCrmService.FIELD_IDS.LEAD.LAST_VISIT_DATE ||
                         fieldId === amoCrmService.FIELD_IDS.LEAD.PURCHASE_DATE) {
                    
                    const parsedDate = amoCrmService.parseDate(fieldValue);
                    fieldInfo.parsed_date = parsedDate;
                    fieldInfo.is_valid_date = !isNaN(new Date(parsedDate).getTime());
                    
                    analysis.fields_by_category.dates[fieldId] = fieldInfo;
                    console.log(`   📅 ${fieldName}: ${fieldValue} -> ${parsedDate} (валидно: ${fieldInfo.is_valid_date})`);
                }
                else if ((fieldId >= 884899 && fieldId <= 892895) || // Чекбоксы занятий
                         (fieldId >= 884931 && fieldId <= 892897)) { // Даты занятий
                    
                    if (fieldId >= 884899 && fieldId <= 892895) {
                        // Чекбокс занятия
                        if (fieldValue === 'true' || fieldValue === '1') {
                            analysis.fields_by_category.classes[fieldId] = fieldInfo;
                            console.log(`   ✅ Посещение ${fieldId}: отмечено`);
                        }
                    } else {
                        // Дата занятия
                        const parsedDate = amoCrmService.parseDate(fieldValue);
                        if (parsedDate) {
                            fieldInfo.parsed_date = parsedDate;
                            analysis.fields_by_category.classes[fieldId] = fieldInfo;
                            console.log(`   📅 Дата занятия ${fieldId}: ${parsedDate}`);
                        }
                    }
                }
                else {
                    analysis.fields_by_category.other[fieldId] = fieldInfo;
                }
            }
        }
        
        // Извлекаем информацию об абонементе
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        analysis.subscription_info = subscriptionInfo;
        
        console.log(`\n🎯 ИНФОРМАЦИЯ ОБ АБОНЕМЕНТЕ:`);
        console.log(JSON.stringify(subscriptionInfo, null, 2));
        
        // Анализ форматов дат
        const dateFormats = analyzeDateFormats(analysis.fields_by_category.dates);
        
        res.json({
            success: true,
            analysis: analysis,
            summary: {
                has_subscription: subscriptionInfo.hasSubscription,
                subscription_active: subscriptionInfo.subscriptionActive,
                dates_present: {
                    activation: !!subscriptionInfo.activationDate,
                    expiration: !!subscriptionInfo.expirationDate,
                    last_visit: !!subscriptionInfo.lastVisitDate,
                    purchase: !!subscriptionInfo.purchaseDate
                },
                classes: {
                    total: subscriptionInfo.totalClasses,
                    used: subscriptionInfo.usedClasses,
                    remaining: subscriptionInfo.remainingClasses
                },
                date_formats: dateFormats
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа сделки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка анализа сделки',
            details: error.message
        });
    }
});

app.get('/api/debug/profile-data/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`🔍 Проверка данных профиля для телефона: ${formattedPhone}`);
        
        // Получаем профили из БД
        const cleanPhone = phone.replace(/\D/g, '');
        const profiles = await db.all(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        
        if (profiles.length === 0) {
            return res.json({
                success: false,
                error: 'Профили не найдены в БД'
            });
        }
        
        console.log(`📊 Найдено профилей в БД: ${profiles.length}`);
        
        // Проверяем, какие данные есть в профилях
        const profileCheck = profiles.map(p => ({
            student_name: p.student_name,
            subscription_active: p.subscription_active,
            // Проверяем наличие дат в БД
            dates_in_db: {
                activation_date: p.activation_date || 'НЕТ',
                last_visit_date: p.last_visit_date || 'НЕТ',
                expiration_date: p.expiration_date || 'НЕТ',
                purchase_date: p.purchase_date || 'НЕТ'
            },
            // Проверяем данные абонемента
            subscription: {
                total_classes: p.total_classes,
                used_classes: p.used_classes,
                remaining_classes: p.remaining_classes,
                subscription_status: p.subscription_status
            },
            // Сырые данные для отладки
            raw_data_length: {
                lead_data: p.lead_data ? JSON.parse(p.lead_data)?.custom_fields_values?.length || 0 : 0,
                contact_data: p.raw_contact_data ? JSON.parse(p.raw_contact_data)?.custom_fields_values?.length || 0 : 0
            }
        }));
        
        res.json({
            success: true,
            data: {
                profiles_count: profiles.length,
                profiles: profileCheck,
                summary: {
                    profiles_with_activation_date: profiles.filter(p => p.activation_date).length,
                    profiles_with_last_visit_date: profiles.filter(p => p.last_visit_date).length,
                    profiles_with_expiration_date: profiles.filter(p => p.expiration_date).length,
                    profiles_with_purchase_date: profiles.filter(p => p.purchase_date).length,
                    active_subscriptions: profiles.filter(p => p.subscription_active === 1).length
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки профилей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки профилей'
        });
    }
});

// МАРШРУТ ДЛЯ ТЕСТИРОВАНИЯ ПАРСИНГА ДАТ
app.get('/api/debug/parse-date/:dateString', (req, res) => {
    try {
        const dateString = req.params.dateString;
        console.log(`🧪 Тестирование парсинга даты: "${dateString}"`);
        
        const testCases = [
            { input: dateString, parser: 'amoCrmService.parseDate' },
            { input: dateString, parser: 'Date.parse' },
            { input: dateString, parser: 'new Date()' }
        ];
        
        const results = testCases.map(test => {
            let result;
            try {
                if (test.parser === 'amoCrmService.parseDate') {
                    result = amoCrmService.parseDate(test.input);
                } else if (test.parser === 'Date.parse') {
                    result = new Date(Date.parse(test.input)).toISOString();
                } else {
                    result = new Date(test.input).toISOString();
                }
            } catch (error) {
                result = `Ошибка: ${error.message}`;
            }
            
            return {
                parser: test.parser,
                result: result,
                is_valid: !result.includes('Ошибка') && !isNaN(new Date(result).getTime())
            };
        });
        
        // Дополнительные тесты
        const additionalTests = [];
        
        // Тест timestamp (секунды)
        if (/^\d{9,10}$/.test(dateString)) {
            const timestamp = parseInt(dateString);
            const dateFromSeconds = new Date(timestamp * 1000);
            const dateFromMilliseconds = new Date(timestamp);
            
            additionalTests.push({
                parser: 'timestamp (секунды)',
                result: dateFromSeconds.toISOString(),
                is_valid: !isNaN(dateFromSeconds.getTime())
            });
            
            additionalTests.push({
                parser: 'timestamp (миллисекунды)',
                result: dateFromMilliseconds.toISOString(),
                is_valid: !isNaN(dateFromMilliseconds.getTime())
            });
        }
        
        res.json({
            success: true,
            original_date: dateString,
            length: dateString.length,
            is_numeric: /^\d+$/.test(dateString),
            results: results,
            additional_tests: additionalTests,
            recommendations: getDateParsingRecommendations(dateString, results, additionalTests)
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестирования даты:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка тестирования даты',
            details: error.message
        });
    }
});

app.get('/api/test-dates/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`🧪 Тест дат для сделки ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({ error: 'amoCRM не подключен' });
        }
        
        const lead = await amoCrmService.getLeadById(leadId);
        
        if (!lead) {
            return res.json({ error: 'Сделка не найдена' });
        }
        
        const dates = {};
        
        if (lead.custom_fields_values) {
            lead.custom_fields_values.forEach(field => {
                if ([850253, 850255, 850259, 851565].includes(field.field_id)) {
                    const value = amoCrmService.getFieldValue(field);
                    const parsed = amoCrmService.parseDate(value);
                    const formatted = formatDateForDisplay(parsed);
                    
                    dates[field.field_id] = {
                        field_name: amoCrmService.getFieldNameById(field.field_id),
                        raw_value: value,
                        parsed: parsed,
                        formatted: formatted
                    };
                }
            });
        }
        
        // Также получим информацию об абонементе
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        res.json({
            success: true,
            dates: dates,
            subscription_info: {
                activation_date: subscriptionInfo.activationDate,
                expiration_date: subscriptionInfo.expirationDate,
                last_visit_date: subscriptionInfo.lastVisitDate,
                purchase_date: subscriptionInfo.purchaseDate
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста дат:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/force-update/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`🔄 Принудительное обновление профилей для: ${formattedPhone}`);
        
        // Удаляем старые данные
        const cleanPhone = phone.replace(/\D/g, '');
        await db.run(
            `DELETE FROM student_profiles WHERE phone_number LIKE ?`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        console.log('🧹 Старые данные удалены');
        
        // Получаем новые данные из amoCRM
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        console.log(`📊 Найдено в amoCRM: ${profiles.length} профилей`);
        
        if (profiles.length === 0) {
            return res.json({
                success: false,
                error: 'Профили не найдены в amoCRM'
            });
        }
        
        // Сохраняем в БД
        const savedCount = await saveProfilesToDatabase(profiles);
        
        // Получаем обновленные данные
        const updatedProfiles = await db.all(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ?`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        
        // Проверяем, что даты сохранились
        const profileCheck = updatedProfiles.map(p => ({
            student_name: p.student_name,
            dates: {
                activation: p.activation_date || 'НЕТ',
                expiration: p.expiration_date || 'НЕТ',
                last_visit: p.last_visit_date || 'НЕТ',
                purchase: p.purchase_date || 'НЕТ'
            }
        }));
        
        res.json({
            success: true,
            message: `Принудительно обновлено ${savedCount} профилей`,
            saved_count: savedCount,
            profiles: updatedProfiles.map(p => ({
                id: p.id,
                student_name: p.student_name,
                activation_date: p.activation_date,
                expiration_date: p.expiration_date,
                last_visit_date: p.last_visit_date,
                purchase_date: p.purchase_date,
                subscription_active: p.subscription_active
            })),
            date_check: profileCheck
        });
        
    } catch (error) {
        console.error('❌ Ошибка принудительного обновления:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ДРУГИЕ АДМИН API ====================
// В server.js обновите метод получения реальной истории посещений:

app.get('/api/visits/real/:phone', verifyToken, async (req, res) => {
    try {
        const phone = req.params.phone;
        const cleanPhone = phone.replace(/\D/g, '');
        
        console.log(`📊 Получение реальной истории посещений для: ${phone}`);
        
        // Находим профиль
        const profile = await db.get(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1 
             ORDER BY subscription_active DESC 
             LIMIT 1`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        
        if (!profile) {
            return res.json({
                success: false,
                error: 'Профиль не найден'
            });
        }
        
        console.log(`👤 Профиль: ${profile.student_name}`);
        console.log(`🎫 Использовано занятий: ${profile.used_classes || 0}`);
        console.log(`📅 Даты в профиле: активация=${profile.activation_date}, последний визит=${profile.last_visit_date}`);
        
        let visits = [];
        
        // 1. Пытаемся извлечь из lead_data
        if (profile.lead_data && profile.lead_data !== '{}') {
            try {
                const leadData = JSON.parse(profile.lead_data);
                console.log(`✅ lead_data найдено, парсим...`);
                
                // Используем метод из amoCrmService
                visits = amoCrmService.extractRealVisitsData(leadData);
                
                console.log(`✅ Извлечено из lead_data: ${visits.length} посещений`);
                
                // Если нет посещений в lead_data, но есть used_classes
                if (visits.length === 0 && profile.used_classes > 0) {
                    console.log(`📊 Создаем историю на основе счетчика: ${profile.used_classes} занятий`);
                    
                    // Используем дату активации если есть, иначе текущую дату
                    let baseDate = profile.activation_date ? 
                        new Date(profile.activation_date) : new Date();
                    
                    for (let i = 1; i <= profile.used_classes && i <= 24; i++) {
                        const visitDate = new Date(baseDate);
                        visitDate.setDate(baseDate.getDate() + (i * 7)); // Каждые 7 дней
                        
                        visits.push({
                            lesson_number: i,
                            date: visitDate.toISOString().split('T')[0],
                            attended: true,
                            has_date: true,
                            source: 'estimated',
                            estimated: true,
                            formatted_date: formatDateForDisplay(visitDate.toISOString().split('T')[0])
                        });
                    }
                }
                
            } catch (error) {
                console.error('❌ Ошибка парсинга lead_data:', error.message);
                
                // Если ошибка парсинга, создаем оценочные данные
                if (profile.used_classes > 0) {
                    console.log(`📊 Создаем историю после ошибки парсинга: ${profile.used_classes} занятий`);
                    
                    let baseDate = new Date();
                    if (profile.last_visit_date) {
                        baseDate = new Date(profile.last_visit_date);
                    } else if (profile.activation_date) {
                        baseDate = new Date(profile.activation_date);
                    }
                    
                    for (let i = 1; i <= profile.used_classes && i <= 24; i++) {
                        const visitDate = new Date(baseDate);
                        visitDate.setDate(baseDate.getDate() - ((profile.used_classes - i) * 7));
                        
                        visits.push({
                            lesson_number: i,
                            date: visitDate.toISOString().split('T')[0],
                            attended: true,
                            has_date: true,
                            source: 'estimated_after_error',
                            estimated: true,
                            formatted_date: formatDateForDisplay(visitDate.toISOString().split('T')[0])
                        });
                    }
                }
            }
        } else {
            console.log(`⚠️  Нет lead_data в профиле`);
            
            // 2. Если нет lead_data, но есть счетчик
            if (profile.used_classes > 0) {
                console.log(`📊 Создаем историю на основе счетчика: ${profile.used_classes} занятий`);
                
                let baseDate = new Date();
                if (profile.last_visit_date) {
                    baseDate = new Date(profile.last_visit_date);
                } else if (profile.activation_date) {
                    baseDate = new Date(profile.activation_date);
                }
                
                for (let i = 1; i <= profile.used_classes && i <= 24; i++) {
                    const visitDate = new Date(baseDate);
                    visitDate.setDate(baseDate.getDate() - ((profile.used_classes - i) * 7));
                    
                    visits.push({
                        lesson_number: i,
                        date: visitDate.toISOString().split('T')[0],
                        attended: true,
                        has_date: true,
                        source: 'estimated_no_data',
                        estimated: true,
                        formatted_date: formatDateForDisplay(visitDate.toISOString().split('T')[0])
                    });
                }
            }
        }
        
        // 3. Обогащаем данными из БД
        const enrichedVisits = visits.map(visit => ({
            ...visit,
            student_name: profile.student_name,
            branch: profile.branch,
            teacher_name: profile.teacher_name,
            age_group: profile.age_group,
            group_name: profile.course || 'Основная группа',
            formatted_date: visit.formatted_date || (visit.date ? formatDateForDisplay(visit.date) : 'Дата не указана'),
            time: '18:00' // Дефолтное время, можно сделать динамическим
        }));
        
        // Сортируем по дате (новые сначала)
        enrichedVisits.sort((a, b) => {
            const dateA = new Date(a.date || 0);
            const dateB = new Date(b.date || 0);
            return dateB - dateA;
        });
        
        // Логируем результат
        console.log(`📊 Итоговое количество посещений: ${enrichedVisits.length}`);
        console.log(`📅 Первые 3 посещения:`);
        enrichedVisits.slice(0, 3).forEach((v, i) => {
            console.log(`   ${i+1}. ${v.formatted_date} - ${v.estimated ? '(оценка)' : '(реальное)'}`);
        });
        
        res.json({
            success: true,
            data: {
                student_name: profile.student_name,
                phone: phone,
                subscription_info: {
                    total_classes: profile.total_classes,
                    used_classes: profile.used_classes,
                    remaining_classes: profile.remaining_classes
                },
                visits: enrichedVisits,
                total_visits: enrichedVisits.length,
                has_real_data: enrichedVisits.some(v => !v.estimated),
                summary: {
                    with_dates: enrichedVisits.filter(v => v.has_date).length,
                    without_dates: enrichedVisits.filter(v => !v.has_date).length,
                    estimated: enrichedVisits.filter(v => v.estimated).length,
                    real: enrichedVisits.filter(v => !v.estimated).length
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения реальной истории:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения истории посещений'
        });
    }
});

// Получение уведомлений для пользователя
app.get('/api/notifications', verifyToken, async (req, res) => {
    try {
        const phone = req.user.phone;
        const cleanPhone = phone.replace(/\D/g, '');
        
        console.log(`📨 Получение уведомлений для: ${phone}`);
        
        // Получаем профиль пользователя
        const profile = await db.get(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1
             ORDER BY subscription_active DESC 
             LIMIT 1`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        
        if (!profile) {
            return res.json({
                success: true,
                data: {
                    notifications: []
                }
            });
        }
        
        // Создаем уведомления на основе данных пользователя
        const notifications = [];
        
        // Уведомление о скором окончании абонемента
        if (profile.expiration_date) {
            const expDate = new Date(profile.expiration_date);
            const today = new Date();
            const daysLeft = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));
            
            if (daysLeft > 0 && daysLeft <= 7) {
                notifications.push({
                    id: 1,
                    type: 'warning',
                    message: `Абонемент заканчивается через ${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}`,
                    date: new Date().toISOString(),
                    read: false
                });
            }
        }
        
        // Уведомление о низком остатке занятий
        if (profile.remaining_classes > 0 && profile.remaining_classes <= 2) {
            notifications.push({
                id: 2,
                type: 'info',
                message: `Осталось ${profile.remaining_classes} ${profile.remaining_classes === 1 ? 'занятие' : 'занятия'}. Подумайте о продлении абонемента`,
                date: new Date().toISOString(),
                read: false
            });
        }
        
        // Уведомление о новых новостях (если есть)
        if (profile.branch) {
            const recentNews = await db.all(`
                SELECT COUNT(*) as count 
                FROM news 
                WHERE (branch = ? OR branch = 'all') 
                AND is_published = 1
                AND publish_date >= date('now', '-7 days')
            `, [profile.branch]);
            
            if (recentNews[0]?.count > 0) {
                notifications.push({
                    id: 3,
                    type: 'info',
                    message: `Есть ${recentNews[0].count} ${recentNews[0].count === 1 ? 'новость' : 'новости'} для вашего филиала`,
                    date: new Date().toISOString(),
                    read: false
                });
            }
        }
        
        res.json({
            success: true,
            data: {
                notifications: notifications,
                unread_count: notifications.filter(n => !n.read).length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения уведомлений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения уведомлений'
        });
    }
});

// API для контакта с администратором
app.post('/api/contact/admin', verifyToken, async (req, res) => {
    try {
        const { subject, message, student_name, branch } = req.body;
        const adminPhone = process.env.ADMIN_PHONE || '+79991112233';
        
        console.log(`📨 Сообщение администратору: ${subject}`);
        console.log(`   От: ${student_name}`);
        console.log(`   Филиал: ${branch}`);
        console.log(`   Сообщение: ${message}`);
        
        // Здесь можно добавить отправку через Telegram, email или сохранение в БД
        
        res.json({
            success: true,
            message: 'Сообщение отправлено администратору',
            data: {
                timestamp: new Date().toISOString(),
                subject: subject,
                student_name: student_name,
                branch: branch
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка отправки сообщения:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки сообщения'
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
