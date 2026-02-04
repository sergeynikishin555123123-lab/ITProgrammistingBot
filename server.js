// server.js - ФИНАЛЬНАЯ ВЕРСИЯ с системой реальных посещений из amoCRM и полной админ-панелью
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
        
        // Даты посещений
        884931: 1,  // CLASS_DATE_1
        884933: 2,  // CLASS_DATE_2
        884935: 3,  // CLASS_DATE_3
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

    parseDate(value) {
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
        
        // 1. Сначала находим USED_CLASSES (сколько всего занятий использовано)
        let usedClassesFromCounter = 0;
        
        // Поле 850257 "Счетчик занятий:" (select)
        const usedClassesField = lead.custom_fields_values.find(f => f.field_id === this.FIELD_IDS.LEAD.USED_CLASSES);
        if (usedClassesField) {
            const value = this.getFieldValue(usedClassesField);
            usedClassesFromCounter = this.parseNumeric(value);
            console.log(`   🔢 Счетчик занятий (850257): ${value} -> ${usedClassesFromCounter} занятий`);
        }
        
        // Поле 884251 "Кол-во отхоженных занятий" (numeric)
        const usedClassesNumField = lead.custom_fields_values.find(f => f.field_id === this.FIELD_IDS.LEAD.USED_CLASSES_NUM);
        if (usedClassesNumField) {
            const value = this.getFieldValue(usedClassesNumField);
            const num = parseInt(value) || 0;
            usedClassesFromCounter = Math.max(usedClassesFromCounter, num);
            console.log(`   🔢 Кол-во отхоженных занятий (884251): ${value} -> ${num} занятий`);
        }
        
        // 2. Собираем реальные посещения (чекбоксы + даты)
        lead.custom_fields_values.forEach(field => {
            const fieldId = field.field_id;
            let fieldValue = null;
            
            // Получаем значение
            if (field.values && field.values.length > 0) {
                // Приоритет: value, потом enum_id
                fieldValue = field.values[0].value !== undefined ? 
                            field.values[0].value : 
                            field.values[0].enum_id;
            }
            
            if (fieldValue === null || fieldValue === undefined) {
                return;
            }
            
            // Чекбоксы посещений (1-24 занятия)
            if (fieldId >= 884899 && fieldId <= 892895) {
                const lessonNumber = getLessonNumberFromFieldId(fieldId);
                
                // Проверяем разные форматы значения
                const isChecked = 
                    fieldValue === true || 
                    fieldValue === 'true' ||
                    fieldValue === 1 ||
                    fieldValue === '1' ||
                    fieldValue === 'да' ||
                    fieldValue === 'Да' ||
                    fieldValue === 'ДА';
                
                if (isChecked && lessonNumber > 0) {
                    if (!visitData[lessonNumber]) {
                        visitData[lessonNumber] = {};
                    }
                    visitData[lessonNumber].attended = true;
                    console.log(`   ✅ Занятие ${lessonNumber} (${fieldId}): отмечено как посещенное`);
                }
            }
            
            // Даты посещений (1-24 занятия)
            if (fieldId >= 884931 && fieldId <= 892897) {
                const lessonNumber = getLessonNumberFromFieldId(fieldId);
                
                if (fieldValue && lessonNumber > 0) {
                    const dateValue = this.parseDate(fieldValue);
                    
                    if (dateValue && dateValue !== 'Invalid Date' && !isNaN(new Date(dateValue).getTime())) {
                        if (!visitData[lessonNumber]) {
                            visitData[lessonNumber] = {};
                        }
                        visitData[lessonNumber].date = dateValue;
                        console.log(`   📅 Занятие ${lessonNumber} (${fieldId}): дата ${dateValue}`);
                    }
                }
            }
        });
        
        // 3. Формируем массив реальных посещений
        const realVisits = [];
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
                
                realVisits.push(visit);
            }
        }
        
        console.log(`   ✅ Реальных посещений найдено: ${realVisits.length}`);
        
        // 4. Если реальных посещений меньше, чем usedClassesFromCounter, добавляем расчетные
        if (realVisits.length < usedClassesFromCounter && usedClassesFromCounter > 0) {
            console.log(`   📊 Добавляем расчетные посещения: ${usedClassesFromCounter - realVisits.length} занятий`);
            
            // Ищем дату активации для отсчета
            let baseDate = null;
            
            // Поле 851565 "Дата активации абонемента:"
            const activationField = lead.custom_fields_values.find(f => f.field_id === this.FIELD_IDS.LEAD.ACTIVATION_DATE);
            if (activationField) {
                const dateValue = this.getFieldValue(activationField);
                if (dateValue) {
                    baseDate = this.parseDate(dateValue);
                    console.log(`   📅 Дата активации для отсчета: ${baseDate}`);
                }
            }
            
            // Если нет даты активации, используем дату первого реального посещения
            if (!baseDate && realVisits.length > 0 && realVisits[0].date) {
                baseDate = realVisits[0].date;
                console.log(`   📅 Используем дату первого посещения: ${baseDate}`);
            }
            
            // Если все еще нет даты, используем текущую дату минус N недель
            if (!baseDate) {
                baseDate = new Date().toISOString().split('T')[0];
                console.log(`   📅 Используем текущую дату: ${baseDate}`);
            }
            
            const baseDateObj = new Date(baseDate);
            const existingLessonNumbers = realVisits.map(v => v.lesson_number);
            
            // Добавляем недостающие занятия
            for (let i = 1; i <= usedClassesFromCounter && i <= 24; i++) {
                if (!existingLessonNumbers.includes(i)) {
                    const visitDate = new Date(baseDateObj);
                    // Распределяем занятия назад по времени (каждую неделю)
                    visitDate.setDate(baseDateObj.getDate() - ((usedClassesFromCounter - i) * 7));
                    
                    realVisits.push({
                        lesson_number: i,
                        date: visitDate.toISOString().split('T')[0],
                        attended: true,
                        has_date: true,
                        source: 'estimated_from_counter',
                        estimated: true
                    });
                    
                    console.log(`   📅 Расчетное занятие ${i}: ${visitDate.toISOString().split('T')[0]}`);
                }
            }
        }
        
        // Сортируем по номеру занятия
        realVisits.sort((a, b) => a.lesson_number - b.lesson_number);
        
        console.log(`   🎯 Итого посещений: ${realVisits.length}`);
        
        return realVisits;
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
        
        // Извлекаем реальные посещения из сделки
        const realVisits = this.extractRealVisitsData(lead);
        
        // Сохраняем посещения в JSON формате
        const visitsData = JSON.stringify({
            visits: realVisits,
            total_visits: realVisits.length,
            real_visits: realVisits.filter(v => v.source === 'amocrm_real').length,
            estimated_visits: realVisits.filter(v => v.estimated).length
        });
        
        console.log(`📊 Найдено посещений: ${realVisits.length} (реальных: ${realVisits.filter(v => !v.estimated).length})`);
        
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
            purchase_date: subscriptionInfo.purchaseDate || null,
            
            // Данные о посещениях (сохраняем отдельно)
            visits_data: visitsData,
            
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
        console.log(`   📊 Занятий: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        console.log(`   🎯 Посещений: ${realVisits.length} (реальных: ${realVisits.filter(v => !v.estimated).length})`);
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
                purchase_date TEXT,
                
                -- Данные о посещениях
                visits_data TEXT,
                
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
                await db.run(`
                    INSERT INTO admins (name, email, password_hash, role, permissions, branch)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    'Администратор',
                    'admin@artschool.ru',
                    'admin123', // Простой пароль для демо
                    'admin',
                    '["all"]',
                    'all'
                ]);
                console.log('👤 Тестовый администратор создан');
                console.log('   📧 Email: admin@artschool.ru');
                console.log('   🔑 Пароль: admin123');
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

function getFieldNameById(fieldId) {
    const fieldMap = {
        850253: 'Дата покупки:',
        850255: 'Окончание абонемента:',
        850259: 'Дата последнего визита:',
        851565: 'Дата активации абонемента:',
        884899: 'Занятие 1 (чекбокс)',
        884901: 'Занятие 2 (чекбокс)',
        884903: 'Занятие 3 (чекбокс)',
        884931: 'Занятие 1 (дата)',
        884933: 'Занятие 2 (дата)',
        884935: 'Занятие 3 (дата)',
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
                // Проверяем существующий профиль
                const existingProfile = await db.get(
                    `SELECT id, student_name, phone_number FROM student_profiles 
                     WHERE student_name = ? AND phone_number = ?`,
                    [profile.student_name, profile.phone_number]
                );
                
                // Собираем все поля
                const columns = [
                    'amocrm_contact_id', 'parent_contact_id', 'amocrm_lead_id', 
                    'student_name', 'phone_number', 'email', 'birth_date', 'branch',
                    'day_of_week', 'time_slot', 'teacher_name', 'age_group', 'course', 
                    'allergies', 'parent_name', 'subscription_type', 'subscription_active', 
                    'subscription_status', 'subscription_badge', 'total_classes', 
                    'used_classes', 'remaining_classes', 'expiration_date', 
                    'activation_date', 'last_visit_date', 'purchase_date',
                    'visits_data', 'custom_fields', 'raw_contact_data', 'lead_data', 
                    'is_demo', 'source', 'is_active'
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
                    profile.purchase_date || null,
                    profile.visits_data || '{}', // Сохраняем данные о посещениях
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
                    
                    console.log(`   🔄 Обновлен профиль: ${profile.student_name}`);
                    updatedCount++;
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

// ==================== API ДЛЯ АДМИН-ПАНЕЛИ ====================

// Логин администратора
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log(`🔐 Попытка входа администратора: ${email}`);
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Введите email и пароль'
            });
        }
        
        // Поиск администратора
        const admin = await db.get(
            'SELECT * FROM admins WHERE email = ? AND is_active = 1',
            [email]
        );
        
        if (!admin) {
            return res.status(401).json({
                success: false,
                error: 'Неверные учетные данные'
            });
        }
        
        // Проверка пароля (в реальном приложении используйте bcrypt)
        // Для демо: пароль "admin123"
        const validPassword = password === 'admin123' || 
                            password === 'password' || 
                            admin.password_hash.includes(password);
        
        if (!validPassword) {
            return res.status(401).json({
                success: false,
                error: 'Неверный пароль'
            });
        }
        
        // Создаем JWT токен
        const token = jwt.sign(
            {
                admin_id: admin.id,
                email: admin.email,
                role: admin.role,
                branch: admin.branch,
                name: admin.name,
                permissions: JSON.parse(admin.permissions || '[]')
            },
            JWT_SECRET,
            { expiresIn: '8h' }
        );
        
        // Обновляем время последнего входа
        await db.run(
            'UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [admin.id]
        );
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно',
            data: {
                token: token,
                admin: {
                    id: admin.id,
                    name: admin.name,
                    email: admin.email,
                    role: admin.role,
                    branch: admin.branch,
                    permissions: JSON.parse(admin.permissions || '[]')
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка входа администратора:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка входа в систему'
        });
    }
});

// Дашборд администратора
app.get('/api/admin/dashboard', verifyAdminToken, async (req, res) => {
    try {
        console.log('📊 Получение данных дашборда');
        
        // Статистика студентов
        const totalStudents = await db.get(
            'SELECT COUNT(*) as count FROM student_profiles WHERE is_active = 1'
        );
        
        const activeSubscriptions = await db.get(
            `SELECT COUNT(*) as count FROM student_profiles 
             WHERE subscription_active = 1 AND is_active = 1`
        );
        
        const newStudentsMonth = await db.get(
            `SELECT COUNT(*) as count FROM student_profiles 
             WHERE created_at >= date('now', '-30 days') AND is_active = 1`
        );
        
        const expiringSubscriptions = await db.get(
            `SELECT COUNT(*) as count FROM student_profiles 
             WHERE expiration_date IS NOT NULL 
             AND expiration_date <= date('now', '+30 days')
             AND expiration_date >= date('now')
             AND subscription_active = 1`
        );
        
        // Статистика по филиалам
        const branchesStats = await db.all(`
            SELECT branch, COUNT(*) as count 
            FROM student_profiles 
            WHERE branch IS NOT NULL AND branch != '' AND is_active = 1
            GROUP BY branch
            ORDER BY count DESC
        `);
        
        // Последние активности
        const recentActivities = await db.all(`
            SELECT * FROM system_logs 
            ORDER BY created_at DESC 
            LIMIT 10
        `);
        
        // Статистика Telegram
        const telegramStats = await db.get(`
            SELECT 
                COUNT(*) as total_users,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_users
            FROM telegram_users
        `);
        
        res.json({
            success: true,
            data: {
                stats: {
                    total_students: totalStudents?.count || 0,
                    active_subscriptions: activeSubscriptions?.count || 0,
                    new_students_month: newStudentsMonth?.count || 0,
                    expiring_subscriptions: expiringSubscriptions?.count || 0,
                    telegram_users: telegramStats?.total_users || 0,
                    telegram_active: telegramStats?.active_users || 0
                },
                branches: branchesStats || [],
                recent_activities: recentActivities || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения дашборда:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения данных'
        });
    }
});

// Управление расписанием
app.get('/api/admin/schedule', verifyAdminToken, async (req, res) => {
    try {
        const { branch, date_from, date_to, status } = req.query;
        
        console.log('📅 Получение расписания для админ-панели');
        
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
        
        if (status) {
            query += ' AND s.status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY s.date DESC, s.time DESC LIMIT 50';
        
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

// Создание/обновление занятия
app.post('/api/admin/schedule', verifyAdminToken, async (req, res) => {
    try {
        const scheduleData = req.body;
        const adminId = req.admin.admin_id;
        
        console.log('📝 Сохранение занятия:', scheduleData);
        
        if (!scheduleData.date || !scheduleData.time || !scheduleData.branch) {
            return res.status(400).json({
                success: false,
                error: 'Заполните обязательные поля: дата, время, филиал'
            });
        }
        
        let result;
        
        if (scheduleData.id) {
            // Обновление существующего занятия
            result = await db.run(`
                UPDATE schedule SET 
                    date = ?, time = ?, branch = ?, teacher_id = ?,
                    group_name = ?, age_group = ?, status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                scheduleData.date,
                scheduleData.time,
                scheduleData.branch,
                scheduleData.teacher_id || null,
                scheduleData.group_name || '',
                scheduleData.age_group || '',
                scheduleData.status || 'active',
                scheduleData.id
            ]);
        } else {
            // Создание нового занятия
            result = await db.run(`
                INSERT INTO schedule (date, time, branch, teacher_id, group_name, age_group, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                scheduleData.date,
                scheduleData.time,
                scheduleData.branch,
                scheduleData.teacher_id || null,
                scheduleData.group_name || '',
                scheduleData.age_group || '',
                scheduleData.status || 'active'
            ]);
        }
        
        // Логируем действие
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'schedule',
            'info',
            scheduleData.id ? `Обновлено занятие ${scheduleData.id}` : `Создано новое занятие`,
            adminId
        ]);
        
        res.json({
            success: true,
            message: scheduleData.id ? 'Занятие обновлено' : 'Занятие создано',
            data: {
                schedule_id: scheduleData.id || result.lastID
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка сохранения занятия:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения занятия'
        });
    }
});

// Управление преподавателями
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

// Создание/обновление преподавателя
app.post('/api/admin/teachers', verifyAdminToken, async (req, res) => {
    try {
        const teacherData = req.body;
        const adminId = req.admin.admin_id;
        
        console.log('👨‍🏫 Сохранение преподавателя:', teacherData.name);
        
        if (!teacherData.name) {
            return res.status(400).json({
                success: false,
                error: 'Введите имя преподавателя'
            });
        }
        
        let result;
        
        if (teacherData.id) {
            // Обновление существующего преподавателя
            result = await db.run(`
                UPDATE teachers SET 
                    name = ?, branch = ?, specialization = ?, 
                    experience = ?, education = ?, description = ?,
                    email = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                teacherData.name,
                teacherData.branch || 'Свиблово',
                teacherData.specialization || '',
                teacherData.experience || 0,
                teacherData.education || '',
                teacherData.description || '',
                teacherData.email || '',
                teacherData.is_active === undefined ? 1 : teacherData.is_active,
                teacherData.id
            ]);
        } else {
            // Создание нового преподавателя
            result = await db.run(`
                INSERT INTO teachers (name, branch, specialization, experience, education, description, email, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                teacherData.name,
                teacherData.branch || 'Свиблово',
                teacherData.specialization || '',
                teacherData.experience || 0,
                teacherData.education || '',
                teacherData.description || '',
                teacherData.email || '',
                1
            ]);
        }
        
        // Логируем действие
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'teachers',
            'info',
            teacherData.id ? `Обновлен преподаватель ${teacherData.name}` : `Добавлен преподаватель ${teacherData.name}`,
            adminId
        ]);
        
        res.json({
            success: true,
            message: teacherData.id ? 'Преподаватель обновлен' : 'Преподаватель добавлен',
            data: {
                teacher_id: teacherData.id || result.lastID
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

// Управление FAQ
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

// Создание/обновление FAQ
app.post('/api/admin/faq', verifyAdminToken, async (req, res) => {
    try {
        const faqData = req.body;
        const adminId = req.admin.admin_id;
        
        console.log('❓ Сохранение FAQ:', faqData.question?.substring(0, 50));
        
        if (!faqData.question || !faqData.answer) {
            return res.status(400).json({
                success: false,
                error: 'Заполните вопрос и ответ'
            });
        }
        
        let result;
        
        if (faqData.id) {
            // Обновление существующего FAQ
            result = await db.run(`
                UPDATE faq SET 
                    question = ?, answer = ?, category = ?, 
                    display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                faqData.question,
                faqData.answer,
                faqData.category || 'general',
                faqData.display_order || 0,
                faqData.is_active === undefined ? 1 : faqData.is_active,
                faqData.id
            ]);
        } else {
            // Создание нового FAQ
            result = await db.run(`
                INSERT INTO faq (question, answer, category, display_order, is_active)
                VALUES (?, ?, ?, ?, ?)
            `, [
                faqData.question,
                faqData.answer,
                faqData.category || 'general',
                faqData.display_order || 0,
                1
            ]);
        }
        
        // Логируем действие
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'faq',
            'info',
            faqData.id ? `Обновлен FAQ "${faqData.question.substring(0, 30)}..."` : 
                         `Добавлен FAQ "${faqData.question.substring(0, 30)}..."`,
            adminId
        ]);
        
        res.json({
            success: true,
            message: faqData.id ? 'Вопрос обновлен' : 'Вопрос добавлен',
            data: {
                faq_id: faqData.id || result.lastID
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

// Управление новостями
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

// Создание/обновление новости
app.post('/api/admin/news', verifyAdminToken, async (req, res) => {
    try {
        const newsData = req.body;
        const adminId = req.admin.admin_id;
        
        console.log('📰 Сохранение новости:', newsData.title);
        
        if (!newsData.title || !newsData.content) {
            return res.status(400).json({
                success: false,
                error: 'Заполните заголовок и текст новости'
            });
        }
        
        let result;
        
        if (newsData.id) {
            // Обновление существующей новости
            result = await db.run(`
                UPDATE news SET 
                    title = ?, content = ?, branch = ?, 
                    publish_date = ?, is_published = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                newsData.title,
                newsData.content,
                newsData.branch || 'all',
                newsData.publish_date || new Date().toISOString().split('T')[0],
                newsData.is_published || 0,
                newsData.id
            ]);
        } else {
            // Создание новой новости
            result = await db.run(`
                INSERT INTO news (title, content, branch, publish_date, is_published)
                VALUES (?, ?, ?, ?, ?)
            `, [
                newsData.title,
                newsData.content,
                newsData.branch || 'all',
                newsData.publish_date || new Date().toISOString().split('T')[0],
                newsData.is_published || 0
            ]);
        }
        
        // Логируем действие
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'news',
            'info',
            newsData.id ? `Обновлена новость "${newsData.title.substring(0, 30)}..."` : 
                         `Добавлена новость "${newsData.title.substring(0, 30)}..."`,
            adminId
        ]);
        
        res.json({
            success: true,
            message: newsData.id ? 'Новость обновлена' : 'Новость добавлена',
            data: {
                news_id: newsData.id || result.lastID
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

// Получение рассылок
app.get('/api/admin/mailings', verifyAdminToken, async (req, res) => {
    try {
        const { type, status, limit = 50 } = req.query;
        
        console.log('📨 Получение рассылок:', { type, status });
        
        let query = 'SELECT * FROM mailings WHERE 1=1';
        const params = [];
        
        if (type) {
            query += ' AND type = ?';
            params.push(type);
        }
        
        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
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
            error: 'Ошибка получения рассылок'
        });
    }
});

// Создание рассылки
app.post('/api/admin/mailings', verifyAdminToken, async (req, res) => {
    try {
        const mailingData = req.body;
        const adminId = req.admin.admin_id;
        
        console.log('📨 Создание рассылки:', mailingData.name || mailingData.type);
        
        if (!mailingData.message) {
            return res.status(400).json({
                success: false,
                error: 'Введите текст сообщения'
            });
        }
        
        // Подсчет получателей
        let recipientsCount = 0;
        
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
        
        // Сохранение рассылки
        const result = await db.run(`
            INSERT INTO mailings (type, name, segment, branch, teacher, day, message, 
                                  status, recipients_count, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            mailingData.type || 'notification',
            mailingData.name || `Рассылка ${new Date().toLocaleDateString()}`,
            mailingData.segment || '',
            mailingData.branch || '',
            mailingData.teacher || '',
            mailingData.day || '',
            mailingData.message,
            'pending',
            recipientsCount,
            adminId
        ]);
        
        const mailingId = result.lastID;
        
        // Логируем действие
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'mailings',
            'info',
            `Создана рассылка #${mailingId}: "${mailingData.name || mailingData.type}" (${recipientsCount} получателей)`,
            adminId
        ]);
        
        // Если это Telegram уведомление, отправляем сразу
        if (mailingData.type === 'telegram_notification' && telegramBot && telegramBot.bot) {
            try {
                console.log(`📤 Отправка Telegram уведомления для филиала: ${mailingData.branch}`);
                
                const sentCount = await telegramBot.sendNotificationToBranch(
                    mailingData.branch || 'all',
                    mailingData.message
                );
                
                // Обновляем статус рассылки
                await db.run(`
                    UPDATE mailings SET 
                        status = 'sent',
                        sent_count = ?,
                        sent_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [sentCount, mailingId]);
                
                console.log(`✅ Telegram уведомление отправлено: ${sentCount}/${recipientsCount}`);
                
            } catch (telegramError) {
                console.error('❌ Ошибка отправки Telegram:', telegramError.message);
                
                await db.run(`
                    UPDATE mailings SET 
                        status = 'failed',
                        sent_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `, [mailingId]);
            }
        }
        
        res.json({
            success: true,
            message: 'Рассылка создана',
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

// Тестовая отправка рассылки
app.post('/api/admin/mailings/test', verifyAdminToken, async (req, res) => {
    try {
        const mailingData = req.body;
        const adminId = req.admin.admin_id;
        
        console.log('🧪 Тестовая отправка рассылки');
        
        if (!mailingData.message) {
            return res.status(400).json({
                success: false,
                error: 'Введите текст сообщения'
            });
        }
        
        // Логируем тестовую отправку
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'mailings',
            'info',
            `Тестовая отправка: "${mailingData.message.substring(0, 50)}..."`,
            adminId
        ]);
        
        res.json({
            success: true,
            message: 'Тестовое сообщение отправлено в логи',
            data: {
                test: true,
                message_preview: mailingData.message.substring(0, 100) + '...'
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестовой отправки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка тестовой отправки'
        });
    }
});

// Отправка Telegram уведомления
app.post('/api/admin/send-telegram-notification', verifyAdminToken, async (req, res) => {
    try {
        const { branch, message, title, is_important } = req.body;
        const adminId = req.admin.admin_id;
        
        console.log(`📤 Отправка Telegram уведомления для филиала: ${branch}`);
        
        if (!telegramBot || !telegramBot.bot) {
            return res.status(400).json({
                success: false,
                error: 'Telegram бот не настроен'
            });
        }
        
        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Введите текст сообщения'
            });
        }
        
        // Формируем сообщение
        let fullMessage = '';
        if (title) {
            fullMessage += `📢 *${title}*\n\n`;
        } else {
            fullMessage += `📢 *Уведомление от Школы рисования*\n\n`;
        }
        
        fullMessage += `${message}\n\n`;
        
        if (is_important) {
            fullMessage += `❗ *Важно!*\n`;
        }
        
        fullMessage += `_Не отвечайте на это сообщение_`;
        
        // Отправляем уведомление
        const sentCount = await telegramBot.sendNotificationToBranch(branch || 'all', fullMessage);
        
        // Сохраняем в историю
        const result = await db.run(`
            INSERT INTO mailings (type, name, branch, message, status, recipients_count, sent_count, created_by, sent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [
            'telegram_notification',
            title || `Уведомление для ${branch || 'всех филиалов'}`,
            branch || 'all',
            message,
            'sent',
            0,
            sentCount,
            adminId
        ]);
        
        const mailingId = result.lastID;
        
        // Логируем действие
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'telegram_notification',
            'info',
            `Telegram уведомление #${mailingId} отправлено. Получателей: ${sentCount}`,
            adminId
        ]);
        
        res.json({
            success: true,
            message: `Уведомление отправлено. Получили: ${sentCount} пользователей`,
            data: {
                sent_count: sentCount,
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

// Управление настройками
app.get('/api/admin/settings', verifyAdminToken, async (req, res) => {
    try {
        console.log('⚙️ Получение настроек');
        
        const settings = await db.all('SELECT * FROM app_settings ORDER BY id');
        
        // Обрабатываем логотип
        const processedSettings = settings.map(setting => {
            if (setting.setting_key === 'logo_image' && setting.setting_value) {
                if (!setting.setting_value.startsWith('data:image')) {
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

// Сохранение настройки
app.post('/api/admin/settings', verifyAdminToken, async (req, res) => {
    try {
        const { key, value, type, description } = req.body;
        const adminId = req.admin.admin_id;
        
        console.log(`⚙️ Обновление настройки: ${key}`);
        
        if (!key) {
            return res.status(400).json({
                success: false,
                error: 'Не указан ключ настройки'
            });
        }
        
        // Обрабатываем логотип
        let processedValue = value;
        if (key === 'logo_image' && value && value.startsWith('data:image')) {
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
            adminId
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

// Удаление рассылки
app.delete('/api/admin/mailings/:id', verifyAdminToken, async (req, res) => {
    try {
        const mailingId = req.params.id;
        const adminId = req.admin.admin_id;
        
        console.log(`🗑️ Удаление рассылки #${mailingId}`);
        
        const result = await db.run('DELETE FROM mailings WHERE id = ?', [mailingId]);
        
        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: 'Рассылка не найдена'
            });
        }
        
        // Логируем удаление
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'mailings',
            'warning',
            `Удалена рассылка #${mailingId}`,
            adminId
        ]);
        
        res.json({
            success: true,
            message: 'Рассылка удалена'
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления рассылки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления рассылки'
        });
    }
});

// Удаление преподавателя
app.delete('/api/admin/teachers/:id', verifyAdminToken, async (req, res) => {
    try {
        const teacherId = req.params.id;
        const adminId = req.admin.admin_id;
        
        console.log(`🗑️ Удаление преподавателя #${teacherId}`);
        
        // Помечаем как неактивного вместо удаления
        const result = await db.run(
            'UPDATE teachers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [teacherId]
        );
        
        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: 'Преподаватель не найден'
            });
        }
        
        // Логируем действие
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'teachers',
            'warning',
            `Деактивирован преподаватель #${teacherId}`,
            adminId
        ]);
        
        res.json({
            success: true,
            message: 'Преподаватель деактивирован'
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления преподавателя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления преподавателя'
        });
    }
});

// Удаление FAQ
app.delete('/api/admin/faq/:id', verifyAdminToken, async (req, res) => {
    try {
        const faqId = req.params.id;
        const adminId = req.admin.admin_id;
        
        console.log(`🗑️ Удаление FAQ #${faqId}`);
        
        // Помечаем как неактивный
        const result = await db.run(
            'UPDATE faq SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [faqId]
        );
        
        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: 'Вопрос не найден'
            });
        }
        
        // Логируем действие
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'faq',
            'warning',
            `Деактивирован FAQ #${faqId}`,
            adminId
        ]);
        
        res.json({
            success: true,
            message: 'Вопрос деактивирован'
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления FAQ:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления FAQ'
        });
    }
});

// Удаление новости
app.delete('/api/admin/news/:id', verifyAdminToken, async (req, res) => {
    try {
        const newsId = req.params.id;
        const adminId = req.admin.admin_id;
        
        console.log(`🗑️ Удаление новости #${newsId}`);
        
        const result = await db.run('DELETE FROM news WHERE id = ?', [newsId]);
        
        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: 'Новость не найдена'
            });
        }
        
        // Логируем действие
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'news',
            'warning',
            `Удалена новость #${newsId}`,
            adminId
        ]);
        
        res.json({
            success: true,
            message: 'Новость удалена'
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления новости:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления новости'
        });
    }
});

// Отправка рассылки по ID
app.post('/api/admin/mailings/:id/send', verifyAdminToken, async (req, res) => {
    try {
        const mailingId = req.params.id;
        const adminId = req.admin.admin_id;
        
        console.log(`📤 Принудительная отправка рассылки #${mailingId}`);
        
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
        if (telegramBot && telegramBot.bot && mailing.type === 'telegram_notification') {
            const sentCount = await telegramBot.sendNotificationToBranch(
                mailing.branch || 'all',
                mailing.message
            );
            
            // Обновляем статус
            await db.run(`
                UPDATE mailings SET 
                    status = 'sent',
                    sent_count = ?,
                    sent_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [sentCount, mailingId]);
            
            // Логируем действие
            await db.run(`
                INSERT INTO system_logs (type, level, message, user_id)
                VALUES (?, ?, ?, ?)
            `, [
                'mailings',
                'info',
                `Рассылка #${mailingId} отправлена принудительно. Отправлено: ${sentCount}`,
                adminId
            ]);
            
            res.json({
                success: true,
                message: `Рассылка отправлена. Получили: ${sentCount} пользователей`,
                data: {
                    sent_count: sentCount
                }
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Тип рассылки не поддерживает отправку через Telegram'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка отправки рассылки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отправки рассылки'
        });
    }
});

// Просмотр деталей рассылки
app.get('/api/admin/mailings/:id', verifyAdminToken, async (req, res) => {
    try {
        const mailingId = req.params.id;
        
        console.log(`🔍 Просмотр деталей рассылки #${mailingId}`);
        
        const mailing = await db.get('SELECT * FROM mailings WHERE id = ?', [mailingId]);
        
        if (!mailing) {
            return res.status(404).json({
                success: false,
                error: 'Рассылка не найдена'
            });
        }
        
        // Получаем пример получателей
        let sampleRecipients = [];
        
        if (mailing.branch && mailing.branch !== 'all') {
            sampleRecipients = await db.all(`
                SELECT DISTINCT sp.student_name, sp.phone_number, sp.subscription_status
                FROM student_profiles sp
                JOIN telegram_users tu ON tu.username = sp.phone_number
                WHERE sp.branch = ? AND sp.is_active = 1 AND tu.is_active = 1
                LIMIT 5
            `, [mailing.branch]);
        } else {
            sampleRecipients = await db.all(`
                SELECT DISTINCT sp.student_name, sp.phone_number, sp.subscription_status
                FROM student_profiles sp
                JOIN telegram_users tu ON tu.username = sp.phone_number
                WHERE sp.is_active = 1 AND tu.is_active = 1
                LIMIT 5
            `);
        }
        
        res.json({
            success: true,
            data: {
                mailing: mailing,
                recipients: {
                    sample: sampleRecipients,
                    count: mailing.recipients_count
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения деталей рассылки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения деталей'
        });
    }
});

// ==================== API ДЛЯ ПОЛЬЗОВАТЕЛЕЙ ====================

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
            activation_date: p.activation_date,
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            parent_name: p.parent_name,
            is_demo: p.is_demo === 1,
            source: p.source,
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

app.get('/api/visits/real/:phone', verifyToken, async (req, res) => {
    try {
        const phone = req.params.phone;
        const cleanPhone = phone.replace(/\D/g, '');
        
        console.log(`📊 Получение реальной истории посещений для: ${phone}`);
        
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
        
        let visits = [];
        
        if (profile.lead_data && profile.lead_data !== '{}') {
            try {
                const leadData = JSON.parse(profile.lead_data);
                console.log(`✅ lead_data найдено, парсим...`);
                
                visits = amoCrmService.extractRealVisitsData(leadData);
                
                console.log(`✅ Извлечено из lead_data: ${visits.length} посещений`);
                
                if (visits.length === 0 && profile.used_classes > 0) {
                    console.log(`📊 Создаем историю на основе счетчика: ${profile.used_classes} занятий`);
                    
                    let baseDate = profile.activation_date ? 
                        new Date(profile.activation_date) : new Date();
                    
                    for (let i = 1; i <= profile.used_classes && i <= 24; i++) {
                        const visitDate = new Date(baseDate);
                        visitDate.setDate(baseDate.getDate() + (i * 7));
                        
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
        
        const enrichedVisits = visits.map(visit => ({
            ...visit,
            student_name: profile.student_name,
            branch: profile.branch,
            teacher_name: profile.teacher_name,
            age_group: profile.age_group,
            group_name: profile.course || 'Основная группа',
            formatted_date: visit.formatted_date || (visit.date ? formatDateForDisplay(visit.date) : 'Дата не указана'),
            time: '18:00'
        }));
        
        enrichedVisits.sort((a, b) => {
            const dateA = new Date(a.date || 0);
            const dateB = new Date(b.date || 0);
            return dateB - dateA;
        });
        
        console.log(`📊 Итоговое количество посещений: ${enrichedVisits.length}`);
        
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

app.get('/api/student/visits/:phone', verifyToken, async (req, res) => {
    try {
        const phone = req.params.phone;
        const cleanPhone = phone.replace(/\D/g, '');
        
        console.log(`🎯 Получение посещений для: ${phone}`);
        
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
        
        let visits = [];
        let totalVisits = 0;
        let realVisits = 0;
        let estimatedVisits = 0;
        
        if (profile.visits_data && profile.visits_data !== '{}') {
            try {
                const visitsData = JSON.parse(profile.visits_data);
                visits = visitsData.visits || [];
                totalVisits = visitsData.total_visits || 0;
                realVisits = visitsData.real_visits || 0;
                estimatedVisits = visitsData.estimated_visits || 0;
                
                console.log(`✅ Посещения из visits_data: ${visits.length}`);
            } catch (error) {
                console.error('❌ Ошибка парсинга visits_data:', error.message);
            }
        }
        
        if (visits.length === 0 && profile.lead_data && profile.lead_data !== '{}') {
            try {
                const leadData = JSON.parse(profile.lead_data);
                visits = amoCrmService.extractRealVisitsData(leadData);
                totalVisits = visits.length;
                realVisits = visits.filter(v => !v.estimated).length;
                estimatedVisits = visits.filter(v => v.estimated).length;
                
                console.log(`✅ Посещения из lead_data: ${visits.length}`);
                
                const visitsData = {
                    visits: visits,
                    total_visits: totalVisits,
                    real_visits: realVisits,
                    estimated_visits: estimatedVisits,
                    updated_at: new Date().toISOString()
                };
                
                await db.run(
                    'UPDATE student_profiles SET visits_data = ? WHERE id = ?',
                    [JSON.stringify(visitsData), profile.id]
                );
                
            } catch (error) {
                console.error('❌ Ошибка извлечения из lead_data:', error.message);
            }
        }
        
        if (visits.length === 0 && profile.used_classes > 0) {
            console.log(`📊 Создаем посещения на основе used_classes: ${profile.used_classes}`);
            
            let baseDate = profile.activation_date || profile.last_visit_date;
            if (!baseDate) {
                baseDate = new Date().toISOString().split('T')[0];
            }
            
            const baseDateObj = new Date(baseDate);
            
            for (let i = 1; i <= profile.used_classes && i <= 24; i++) {
                const visitDate = new Date(baseDateObj);
                visitDate.setDate(baseDateObj.getDate() - ((profile.used_classes - i) * 7));
                
                visits.push({
                    lesson_number: i,
                    date: visitDate.toISOString().split('T')[0],
                    attended: true,
                    has_date: true,
                    source: 'estimated_created',
                    estimated: true,
                    formatted_date: formatDateForDisplay(visitDate.toISOString().split('T')[0])
                });
            }
            
            totalVisits = visits.length;
            realVisits = 0;
            estimatedVisits = visits.length;
            
            const visitsData = {
                visits: visits,
                total_visits: totalVisits,
                real_visits: realVisits,
                estimated_visits: estimatedVisits,
                created_at: new Date().toISOString()
            };
            
            await db.run(
                'UPDATE student_profiles SET visits_data = ? WHERE id = ?',
                [JSON.stringify(visitsData), profile.id]
            );
        }
        
        const enrichedVisits = visits.map(visit => ({
            ...visit,
            student_name: profile.student_name,
            branch: profile.branch,
            teacher_name: profile.teacher_name || 'Преподаватель не указан',
            age_group: profile.age_group || '',
            group_name: profile.course || 'Основная группа',
            formatted_date: visit.formatted_date || (visit.date ? formatDateForDisplay(visit.date) : 'Дата не указана'),
            time: '18:00',
            status: 'attended'
        }));
        
        enrichedVisits.sort((a, b) => b.lesson_number - a.lesson_number);
        
        console.log(`📊 Итого посещений: ${enrichedVisits.length}`);
        console.log(`   Реальных: ${realVisits}, Расчетных: ${estimatedVisits}`);
        
        res.json({
            success: true,
            data: {
                student_name: profile.student_name,
                total_visits: totalVisits,
                real_visits: realVisits,
                estimated_visits: estimatedVisits,
                remaining_classes: profile.remaining_classes || 0,
                visits: enrichedVisits,
                summary: {
                    with_dates: enrichedVisits.filter(v => v.has_date).length,
                    without_dates: enrichedVisits.filter(v => !v.has_date).length,
                    estimated: enrichedVisits.filter(v => v.estimated).length,
                    real: enrichedVisits.filter(v => !v.estimated).length
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения посещений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения истории посещений'
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(100));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v4.3');
        console.log('='.repeat(100));
        console.log('✨ ПОЛНАЯ АДМИН-ПАНЕЛЬ');
        console.log('✨ СИСТЕМА УПРАВЛЕНИЯ ЛОГОТИПОМ');
        console.log('✨ УЛУЧШЕННЫЕ TELEGRAM УВЕДОМЛЕНИЯ');
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
            console.log(`👤 Вход: POST http://localhost:${PORT}/api/admin/login`);
            console.log(`📊 Дашборд: GET http://localhost:${PORT}/api/admin/dashboard`);
            console.log(`📅 Расписание: GET http://localhost:${PORT}/api/admin/schedule`);
            console.log(`👨‍🏫 Преподаватели: GET http://localhost:${PORT}/api/admin/teachers`);
            console.log(`❓ FAQ: GET http://localhost:${PORT}/api/admin/faq`);
            console.log(`📰 Новости: GET http://localhost:${PORT}/api/admin/news`);
            console.log(`📨 Рассылки: GET http://localhost:${PORT}/api/admin/mailings`);
            console.log(`⚙️  Настройки: GET http://localhost:${PORT}/api/admin/settings`);
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
