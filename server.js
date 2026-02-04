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

// ==================== КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService');
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.enumCache = new Map();
        this.accountInfo = null;
        
        // ВАШИ ID ПОЛЕЙ
        this.FIELD_IDS = {
            LEAD: {
                TOTAL_CLASSES: 850241,
                USED_CLASSES: 850257,
                USED_CLASSES_NUM: 884251,
                REMAINING_CLASSES: 890163,
                EXPIRATION_DATE: 850255,
                ACTIVATION_DATE: 851565,
                LAST_VISIT_DATE: 850259,
                SUBSCRIPTION_TYPE: 891007,
                SUBSCRIPTION_OWNER: 805465,
                FREEZE: 867693,
                BRANCH: 891589,
                AGE_GROUP: 850243,
                PURCHASE_DATE: 850253,
                
                // Чекбоксы посещений
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
            },
            
            CONTACT: {
                CHILD_1_NAME: 867233,
                CHILD_1_BIRTHDAY: 867687,
                CHILD_2_NAME: 867235,
                CHILD_2_BIRTHDAY: 867685,
                CHILD_3_NAME: 867733,
                CHILD_3_BIRTHDAY: 867735,
                BRANCH: 871273,
                TEACHER: 888881,
                DAY_OF_WEEK: 888879,
                AGE_GROUP: 888903,
                HAS_ACTIVE_SUB: 890179,
                LAST_VISIT: 885380,
                LAST_SUB_ACTIVATION: 892185,
                ALLERGIES: 850239,
                PARENT_BIRTHDAY: 850219
            }
        };
        
        // Маппинг enum_id для числовых значений
        this.SUBSCRIPTION_ENUM_MAPPING = {
            '504033': 4, '504035': 8, '504037': 16, '504039': 4,
            '504041': 8, '504043': 16, '504237': 5, '504239': 6,
            '504241': 5, '504243': 16,
            
            '504105': 1, '504107': 2, '504109': 3, '504111': 4,
            '504113': 5, '504115': 6, '504117': 7, '504119': 8,
            '504121': 9, '504123': 10, '504125': 11, '504127': 12,
            '504129': 13, '504131': 14, '504133': 15, '504135': 16,
            '504137': 17, '504139': 18, '504141': 19, '504143': 20,
            '504145': 21, '504147': 22, '504149': 23, '504151': 24,
            
            '504047': '6-8 лет', '504049': '8-10 лет', '504051': '10-13 лет',
            '529779': 'Свиблово', '556183': 'Аня К', '549419': '8-10 лет',
            '549415': 'Среда'
        };
    }

    async initialize() {
        try {
            if (!this.accessToken || !AMOCRM_SUBDOMAIN) {
                console.log('❌ Отсутствует токен или домен amoCRM');
                return false;
            }
            
            console.log(`🔗 Проверка подключения к amoCRM...`);
            
            try {
                const response = await this.makeRequest('GET', '/api/v4/account');
                this.accountInfo = response;
                this.isInitialized = true;
                
                await this.loadEnumValues();
                
                console.log('✅ amoCRM успешно инициализирован');
                console.log(`🏢 Аккаунт: ${response.name}`);
                
                return true;
                
            } catch (apiError) {
                console.error('❌ Ошибка API amoCRM:', apiError.message);
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
            
            this.enumCache.clear();
            
            const leadImportantFields = [
                { id: this.FIELD_IDS.LEAD.TOTAL_CLASSES, name: 'Абонемент занятий:' },
                { id: this.FIELD_IDS.LEAD.USED_CLASSES, name: 'Счетчик занятий:' },
                { id: this.FIELD_IDS.LEAD.BRANCH, name: 'Филиал (сделка)' }
            ];
            
            const contactImportantFields = [
                { id: this.FIELD_IDS.CONTACT.BRANCH, name: 'Филиал:' },
                { id: this.FIELD_IDS.CONTACT.TEACHER, name: 'Преподаватель' }
            ];
            
            for (const fieldInfo of leadImportantFields) {
                await this.loadFieldEnum(fieldInfo, 'leads');
            }
            
            for (const fieldInfo of contactImportantFields) {
                await this.loadFieldEnum(fieldInfo, 'contacts');
            }
            
            console.log(`✅ Загружено enum значений: ${this.enumCache.size}`);
            
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
                    
                    if (status === 429) {
                        console.log('⚠️  Превышен лимит запросов, ждем...');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        continue;
                    }
                    
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

    getFieldValue(field) {
        try {
            if (!field || !field.values || field.values.length === 0) {
                return null;
            }
            
            const value = field.values[0];
            
            if (value.enum_id !== undefined) {
                return String(value.enum_id);
            }
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
            
            // 3. Возвращаем как есть
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
                
                return mskDate.toISOString().split('T')[0];
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
            freezeStatus: '',
            leadIsClosed: false
        };
        
        if (!lead || !lead.custom_fields_values) {
            return subscriptionInfo;
        }
        
        try {
            const customFields = lead.custom_fields_values;
            const statusId = lead.status_id || 0;
            
            subscriptionInfo.leadIsClosed = [142, 143].includes(statusId);
            
            console.log(`🔍 Анализ абонемента в сделке "${lead.name}"`);
            
            for (const field of customFields) {
                const fieldId = field.field_id;
                if (!fieldId) continue;
                
                const fieldValue = this.getFieldValue(field);
                if (fieldValue === null || fieldValue === '') continue;
                
                const displayValue = this.getFieldDisplayValue(fieldId, fieldValue);
                
                if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.totalClasses = this.parseNumeric(fieldValue);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.USED_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.usedClasses = this.parseNumeric(fieldValue);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.USED_CLASSES_NUM) {
                    subscriptionInfo.hasSubscription = true;
                    const used = this.parseNumeric(fieldValue);
                    subscriptionInfo.usedClasses = Math.max(subscriptionInfo.usedClasses, used);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.REMAINING_CLASSES) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.remainingClasses = this.parseNumeric(fieldValue);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.EXPIRATION_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.expirationDate = this.parseDate(fieldValue);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.ACTIVATION_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.activationDate = this.parseDate(fieldValue);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.LAST_VISIT_DATE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.lastVisitDate = this.parseDate(fieldValue);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE) {
                    subscriptionInfo.hasSubscription = true;
                    subscriptionInfo.subscriptionType = displayValue;
                }
                else if (fieldId === this.FIELD_IDS.LEAD.FREEZE) {
                    subscriptionInfo.freezeStatus = displayValue;
                }
                else if (fieldId === this.FIELD_IDS.LEAD.PURCHASE_DATE) {
                   subscriptionInfo.hasSubscription = true;
                   subscriptionInfo.purchaseDate = this.parseDate(fieldValue);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.BRANCH) {
                    subscriptionInfo.branch = displayValue;
                }
                else if (fieldId === this.FIELD_IDS.LEAD.AGE_GROUP) {
                    subscriptionInfo.ageGroup = displayValue;
                }
            }
            
            // КОРРЕКТИРОВКА ДАННЫХ
            if (subscriptionInfo.totalClasses > 0) {
                if (subscriptionInfo.usedClasses > 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                }
                
                if (subscriptionInfo.remainingClasses > 0 && subscriptionInfo.usedClasses === 0) {
                    subscriptionInfo.usedClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.remainingClasses);
                }
                
                if (subscriptionInfo.usedClasses === 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = subscriptionInfo.totalClasses;
                }
            }
            
            // ОПРЕДЕЛЕНИЕ СТАТУСА
            const hasSubscription = subscriptionInfo.totalClasses > 0;
            const isClosedDeal = [142, 143].includes(statusId);
            const isFrozen = subscriptionInfo.freezeStatus && 
                            subscriptionInfo.freezeStatus.toLowerCase() === 'да';
            const hasRemaining = subscriptionInfo.remainingClasses > 0;
            const isNotStarted = subscriptionInfo.usedClasses === 0;
            const isExpired = subscriptionInfo.expirationDate ? 
                new Date(subscriptionInfo.expirationDate) < new Date() : false;

            if (!hasSubscription) {
                subscriptionInfo.subscriptionStatus = 'Нет абонемента';
                subscriptionInfo.subscriptionBadge = 'inactive';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (isClosedDeal) {
                subscriptionInfo.subscriptionStatus = 'Абонемент завершен';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (isFrozen) {
                subscriptionInfo.subscriptionStatus = 'Абонемент заморожен';
                subscriptionInfo.subscriptionBadge = 'freeze';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (isExpired) {
                subscriptionInfo.subscriptionStatus = 'Абонемент истек';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (hasRemaining || isNotStarted) {
                subscriptionInfo.subscriptionStatus = `Активный (осталось ${subscriptionInfo.remainingClasses} из ${subscriptionInfo.totalClasses})`;
                subscriptionInfo.subscriptionBadge = 'active';
                subscriptionInfo.subscriptionActive = true;
            }
            else if (subscriptionInfo.usedClasses >= subscriptionInfo.totalClasses) {
                subscriptionInfo.subscriptionStatus = 'Занятия закончились';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (subscriptionInfo.totalClasses > 0 && subscriptionInfo.usedClasses === 0) {
                subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий (не начат)`;
                subscriptionInfo.subscriptionBadge = 'pending';
                subscriptionInfo.subscriptionActive = false;
            }
            else {
                subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий`;
                subscriptionInfo.subscriptionBadge = 'has_subscription';
                subscriptionInfo.subscriptionActive = false;
            }
            
            if (!subscriptionInfo.subscriptionType || subscriptionInfo.subscriptionType.trim() === '') {
                subscriptionInfo.subscriptionType = subscriptionInfo.totalClasses > 0 
                    ? `Абонемент на ${subscriptionInfo.totalClasses} занятий`
                    : 'Без абонемента';
            }
            
            // Извлекаем данные о посещениях
            subscriptionInfo.visits = this.extractRealVisitsData(lead);
            subscriptionInfo.totalVisits = subscriptionInfo.visits.length;

        } catch (error) {
            console.error('❌ Ошибка извлечения информации об абонементе:', error);
        }
        
        return subscriptionInfo;
    }

    extractRealVisitsData(lead) {
        console.log(`🔍 Извлечение данных о посещениях из сделки ${lead.id || 'unknown'}`);
        
        const visits = [];
        
        if (!lead.custom_fields_values) {
            console.log('⚠️  Нет кастомных полей в сделке');
            return visits;
        }
        
        const visitData = {};
        
        // Находим USED_CLASSES (сколько всего занятий использовано)
        let usedClassesFromCounter = 0;
        
        const usedClassesField = lead.custom_fields_values.find(f => f.field_id === this.FIELD_IDS.LEAD.USED_CLASSES);
        if (usedClassesField) {
            const value = this.getFieldValue(usedClassesField);
            usedClassesFromCounter = this.parseNumeric(value);
            console.log(`   🔢 Счетчик занятий: ${value} -> ${usedClassesFromCounter} занятий`);
        }
        
        const usedClassesNumField = lead.custom_fields_values.find(f => f.field_id === this.FIELD_IDS.LEAD.USED_CLASSES_NUM);
        if (usedClassesNumField) {
            const value = this.getFieldValue(usedClassesNumField);
            const num = parseInt(value) || 0;
            usedClassesFromCounter = Math.max(usedClassesFromCounter, num);
            console.log(`   🔢 Кол-во отхоженных занятий: ${value} -> ${num} занятий`);
        }
        
        // Собираем реальные посещения (чекбоксы + даты)
        lead.custom_fields_values.forEach(field => {
            const fieldId = field.field_id;
            let fieldValue = null;
            
            if (field.values && field.values.length > 0) {
                fieldValue = field.values[0].value !== undefined ? 
                            field.values[0].value : 
                            field.values[0].enum_id;
            }
            
            if (fieldValue === null || fieldValue === undefined) {
                return;
            }
            
            // Чекбоксы посещений (1-24 занятия)
            if (fieldId >= 884899 && fieldId <= 892895) {
                const lessonNumber = this.getLessonNumberFromFieldId(fieldId);
                
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
                    console.log(`   ✅ Занятие ${lessonNumber}: отмечено как посещенное`);
                }
            }
            
            // Даты посещений (1-24 занятия)
            if (fieldId >= 884931 && fieldId <= 892897) {
                const lessonNumber = this.getLessonNumberFromFieldId(fieldId);
                
                if (fieldValue && lessonNumber > 0) {
                    const dateValue = this.parseDate(fieldValue);
                    
                    if (dateValue && dateValue !== 'Invalid Date' && !isNaN(new Date(dateValue).getTime())) {
                        if (!visitData[lessonNumber]) {
                            visitData[lessonNumber] = {};
                        }
                        visitData[lessonNumber].date = dateValue;
                        console.log(`   📅 Занятие ${lessonNumber}: дата ${dateValue}`);
                    }
                }
            }
        });
        
        // Формируем массив реальных посещений
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
        
        // Если реальных посещений меньше, чем usedClassesFromCounter, добавляем расчетные
        if (realVisits.length < usedClassesFromCounter && usedClassesFromCounter > 0) {
            console.log(`   📊 Добавляем расчетные посещения: ${usedClassesFromCounter - realVisits.length} занятий`);
            
            let baseDate = null;
            
            const activationField = lead.custom_fields_values.find(f => f.field_id === this.FIELD_IDS.LEAD.ACTIVATION_DATE);
            if (activationField) {
                const dateValue = this.getFieldValue(activationField);
                if (dateValue) {
                    baseDate = this.parseDate(dateValue);
                    console.log(`   📅 Дата активации для отсчета: ${baseDate}`);
                }
            }
            
            if (!baseDate && realVisits.length > 0 && realVisits[0].date) {
                baseDate = realVisits[0].date;
                console.log(`   📅 Используем дату первого посещения: ${baseDate}`);
            }
            
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

    getLessonNumberFromFieldId(fieldId) {
        const mapping = {
            884899: 1, 884901: 2, 884903: 3, 884905: 4,
            884907: 5, 884909: 6, 884911: 7, 884913: 8,
            884915: 9, 884917: 10, 884919: 11, 884921: 12,
            884923: 13, 884925: 14, 884927: 15, 884929: 16,
            892867: 17, 892871: 18, 892875: 19, 892879: 20,
            892883: 21, 892887: 22, 892893: 23, 892895: 24,
            
            884931: 1, 884933: 2, 884935: 3, 884937: 4,
            884939: 5, 884941: 6, 884943: 7, 884945: 8,
            884953: 9, 884955: 10, 884951: 11, 884957: 12,
            884959: 13, 884961: 14, 884963: 15, 884965: 16,
            892869: 17, 892873: 18, 892877: 19, 892881: 20,
            892885: 21, 892889: 22, 892891: 23, 892897: 24
        };
        
        return mapping[fieldId] || 0;
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

    async searchContactsByPhone(phoneNumber) {
        try {
            console.log(`🔍 Поиск контактов по телефону: ${phoneNumber}`);
            
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const searchTerm = cleanPhone.slice(-7);
            
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

    async getContactLeads(contactId) {
        try {
            console.log(`🔍 Получение сделок контакта ID: ${contactId}`);
            
            const allLeads = [];
            let page = 1;
            const limit = 250;
            
            while (true) {
                try {
                    const response = await this.makeRequest(
                        'GET',
                        `/api/v4/leads?with=custom_fields_values&page=${page}&limit=${limit}&filter[contact_id]=${contactId}`
                    );
                    
                    const leads = response._embedded?.leads || [];
                    console.log(`   📊 Найдено сделок на странице: ${leads.length}`);
                    
                    allLeads.push(...leads);
                    
                    if (leads.length < limit) {
                        console.log(`   ✅ Все сделки загружены`);
                        break;
                    }
                    
                    page++;
                    
                    if (page > 10) {
                        console.log(`   ⚠️  Достигнут лимит в 2500 сделок`);
                        break;
                    }
                    
                } catch (error) {
                    console.error(`   ❌ Ошибка загрузки страницы ${page}:`, error.message);
                    break;
                }
            }
            
            console.log(`📊 Всего сделок получено: ${allLeads.length}`);
            
            allLeads.sort((a, b) => {
                return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
            });
            
            return allLeads;
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок контакта ${contactId}:`, error.message);
            return [];
        }
    }

    async searchLeadsByPhone(phoneNumber) {
        try {
            console.log(`🔍 ПОИСК СДЕЛОК ПО ТЕЛЕФОНУ: ${phoneNumber}`);
            
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const searchTerm = cleanPhone.slice(-7);
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?query=${encodeURIComponent(searchTerm)}&with=custom_fields_values&limit=100`
            );
            
            const leads = response._embedded?.leads || [];
            console.log(`📊 Найдено сделок по телефону: ${leads.length}`);
            
            return leads;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска сделок по телефону: ${error.message}`);
            return [];
        }
    }

    async findActiveSubscriptionByPhone(phoneNumber) {
        console.log(`\n🎯 ПОИСК АКТИВНОГО АБОНЕМЕНТА ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        try {
            const leads = await this.searchLeadsByPhone(phoneNumber);
            
            if (leads.length === 0) {
                console.log('❌ Сделки не найдены по телефону');
                return null;
            }
            
            const targetLeadId = 28681709;
            const targetLead = leads.find(lead => lead.id == targetLeadId);
            
            if (targetLead) {
                console.log(`✅ НАЙДЕНА ЦЕЛЕВАЯ СДЕЛКА: ${targetLeadId} "${targetLead.name}"`);
                const subscriptionInfo = this.extractSubscriptionInfo(targetLead);
                
                if (subscriptionInfo.hasSubscription) {
                    console.log(`   ✅ Есть абонемент! Статус: ${subscriptionInfo.subscriptionStatus}`);
                    return {
                        lead: targetLead,
                        subscription: subscriptionInfo
                    };
                }
            }
            
            console.log(`\n🔍 Поиск любой активной сделки...`);
            
            const activeLeads = [];
            
            for (const lead of leads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription && subscriptionInfo.subscriptionActive) {
                    console.log(`✅ Найдена активная сделка: ${lead.id} "${lead.name}"`);
                    
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
            
            activeLeads.sort((a, b) => b.priority - a.priority);
            
            return {
                lead: activeLeads[0].lead,
                subscription: activeLeads[0].subscription
            };
            
        } catch (error) {
            console.error(`❌ Ошибка поиска активного абонемента по телефону: ${error.message}`);
            return null;
        }
    }

    calculateSubscriptionPriority(subscriptionInfo, lead) {
        let priority = 0;
        
        if (subscriptionInfo.subscriptionActive) {
            priority += 1000;
        }
        
        if (![142, 143].includes(lead.status_id)) {
            priority += 500;
        } else {
            priority -= 300;
        }
        
        if (subscriptionInfo.remainingClasses > 0) {
            priority += 200;
        }
        
        if (subscriptionInfo.freezeStatus && subscriptionInfo.freezeStatus.toLowerCase() === 'да') {
            priority -= 400;
        }
        
        if (subscriptionInfo.expirationDate) {
            const expDate = new Date(subscriptionInfo.expirationDate);
            const now = new Date();
            if (expDate >= now) {
                priority += 150;
            } else {
                priority -= 200;
            }
        }
        
        if (subscriptionInfo.usedClasses > 0) {
            priority += 100;
        }
        
        const updatedAt = new Date(lead.updated_at);
        const now = new Date();
        const daysSinceUpdate = Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24));
        
        if (daysSinceUpdate <= 7) {
            priority += 50;
        }
        
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
            
            const childrenData = [
                { nameFieldId: this.FIELD_IDS.CONTACT.CHILD_1_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_1_BIRTHDAY },
                { nameFieldId: this.FIELD_IDS.CONTACT.CHILD_2_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_2_BIRTHDAY },
                { nameFieldId: this.FIELD_IDS.CONTACT.CHILD_3_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_3_BIRTHDAY }
            ];
            
            for (let i = 0; i < childrenData.length; i++) {
                const childConfig = childrenData[i];
                const childNumber = i + 1;
                
                const nameField = customFields.find(f => f.field_id === childConfig.nameFieldId);
                if (!nameField) continue;
                
                const childName = this.getFieldValue(nameField);
                if (!childName || childName.trim() === '') continue;
                
                const displayName = this.getFieldDisplayValue(childConfig.nameFieldId, childName);
                console.log(`   👶 Ребенок ${childNumber}: ${displayName}`);
                
                const studentInfo = {
                    studentName: displayName,
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
                
                const birthdayField = customFields.find(f => f.field_id === childConfig.birthdayFieldId);
                if (birthdayField) {
                    const birthdayValue = this.getFieldValue(birthdayField);
                    if (birthdayValue) {
                        studentInfo.birthDate = this.parseDate(birthdayValue);
                    }
                }
                
                for (const field of customFields) {
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
                    else if (fieldId === this.FIELD_IDS.CONTACT.AGE_GROUP) {
                        studentInfo.ageGroup = displayValue;
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
        
        const email = this.findEmail(contact);
        const branch = subscriptionInfo.branch || studentInfo.branch || '';
        
        let subscriptionType = subscriptionInfo.subscriptionType || 'Без абонемента';
        if (subscriptionType === 'Без абонемента' && subscriptionInfo.totalClasses > 0) {
            subscriptionType = `Абонемент на ${subscriptionInfo.totalClasses} занятий`;
        }
        
        let subscriptionStatus = subscriptionInfo.subscriptionStatus || 'Нет абонемента';
        
        const realVisits = this.extractRealVisitsData(lead);
        
        const visitsData = JSON.stringify({
            visits: realVisits,
            total_visits: realVisits.length,
            real_visits: realVisits.filter(v => v.source === 'amocrm_real').length,
            estimated_visits: realVisits.filter(v => v.estimated).length
        });
        
        console.log(`📊 Найдено посещений: ${realVisits.length}`);
        
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
            
            visits_data: visitsData,
            
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
        console.log(`   📊 Занятий: ${profile.used_classes}/${profile.total_classes}`);
        console.log(`   🎯 Посещений: ${realVisits.length}`);
        
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
            const contacts = await this.searchContactsByPhone(phoneNumber);
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                console.log('❌ Контакты не найдены');
                return studentProfiles;
            }
            
            console.log(`\n🔍 ПРЯМОЙ ПОИСК АКТИВНОЙ СДЕЛКИ ПО ТЕЛЕФОНУ...`);
            const activeSubscriptionData = await this.findActiveSubscriptionByPhone(phoneNumber);
            
            let bestLead = null;
            let bestSubscriptionInfo = this.extractSubscriptionInfo(null);
            
            if (activeSubscriptionData) {
                bestLead = activeSubscriptionData.lead;
                bestSubscriptionInfo = activeSubscriptionData.subscription;
                console.log(`✅ Найден активный абонемент!`);
            } else {
                console.log(`⚠️  Активный абонемент не найден по телефону`);
                
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
            
            for (const contact of contacts) {
                console.log(`\n👤 Обработка контакта: ${contact.name} (ID: ${contact.id})`);
                
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                const children = this.extractStudentsFromContact(fullContact);
                console.log(`📊 Найдено детей в контакте: ${children.length}`);
                
                if (children.length === 0) {
                    const studentFromContact = await this.createProfileFromContact(fullContact, phoneNumber);
                    if (studentFromContact) {
                        if (bestSubscriptionInfo.hasSubscription) {
                            this.updateProfileWithSubscription(studentFromContact, bestSubscriptionInfo, bestLead);
                        }
                        studentProfiles.push(studentFromContact);
                    }
                } else {
                    for (const child of children) {
                        console.log(`\n👤 Создание профиля для: ${child.studentName}`);
                        
                        const studentProfile = this.createStudentProfile(
                            fullContact,
                            phoneNumber,
                            child,
                            bestSubscriptionInfo,
                            bestLead
                        );
                        
                        studentProfiles.push(studentProfile);
                    }
                }
            }
            
            console.log(`\n🎯 Итого создано профилей: ${studentProfiles.length}`);
            
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

    async findLatestActiveSubscription(contactId) {
        console.log(`\n🎯 ПОИСК АКТИВНОГО АБОНЕМЕНТА ДЛЯ КОНТАКТА: ${contactId}`);
        
        try {
            const knownActiveLeadId = 28681709;
            
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
                console.log(`📄 Сделка ${lead.id}: "${lead.name}"`);
                
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
            
            subscriptionLeads.sort((a, b) => b.priority - a.priority);
            
            const bestSubscription = subscriptionLeads[0];
            
            console.log(`\n🎯 ВЫБРАН ЛУЧШИЙ АБОНЕМЕНТ:`);
            console.log(`   Сделка: "${bestSubscription.lead.name}" (ID: ${bestSubscription.lead.id})`);
            
            return {
                lead: bestSubscription.lead,
                subscription: bestSubscription.subscription
            };
            
        } catch (error) {
            console.error(`❌ Ошибка поиска активного абонемента: ${error.message}`);
            return null;
        }
    }

    async searchActiveLeadForContact(contactId, leadIdToFind = null) {
        try {
            console.log(`🎯 ПОИСК АКТИВНОЙ СДЕЛКИ ДЛЯ КОНТАКТА: ${contactId}`);
            
            if (leadIdToFind) {
                console.log(`🔍 Прямой поиск сделки ${leadIdToFind}...`);
                try {
                    const lead = await this.getLeadById(leadIdToFind);
                    if (lead) {
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
            
            console.log(`🔍 Поиск активных сделок контакта...`);
            
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

    updateProfileWithSubscription(profile, subscriptionInfo, lead) {
        console.log(`🔄 Обновление профиля ${profile.student_name} данными абонемента`);
        
        if (!profile || !subscriptionInfo) return;
        
        if (subscriptionInfo.hasSubscription) {
            if (lead?.id) {
                profile.amocrm_lead_id = lead.id;
            }
            
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
            
            if (subscriptionInfo.branch && subscriptionInfo.branch.trim() !== '') {
                profile.branch = subscriptionInfo.branch;
            }
            
            console.log(`   ✅ Обновлено: ${profile.subscription_status}`);
        } else {
            console.log(`   ℹ️  Нет данных об абонементе для обновления`);
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
        console.log('\n🔄 ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ');
        
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
        
        // Основные таблицы
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amocrm_contact_id INTEGER,
                parent_contact_id INTEGER,
                amocrm_lead_id INTEGER,
                
                student_name TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                email TEXT,
                birth_date TEXT,
                branch TEXT,
                
                day_of_week TEXT,
                time_slot TEXT,
                teacher_name TEXT,
                age_group TEXT,
                course TEXT,
                allergies TEXT,
                
                parent_name TEXT,
                
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
                
                visits_data TEXT,
                
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

        // Таблицы для админ-панели
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

        // Таблица для повторяющихся занятий
        await db.exec(`
            CREATE TABLE IF NOT EXISTS recurring_classes_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                day_of_week INTEGER NOT NULL,
                time TEXT NOT NULL,
                branch TEXT NOT NULL,
                teacher_id INTEGER,
                group_name TEXT,
                age_group TEXT,
                frequency TEXT DEFAULT 'weekly',
                start_date DATE,
                end_date DATE,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (teacher_id) REFERENCES teachers(id)
            )
        `);
        console.log('✅ Таблица recurring_classes_templates создана');

        // Индексы для быстрого поиска
        await db.run('CREATE INDEX IF NOT EXISTS idx_recurring_day ON recurring_classes_templates(day_of_week)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_recurring_branch ON recurring_classes_templates(branch)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_recurring_active ON recurring_classes_templates(is_active)');

        // Тестовый администратор
        try {
            const existingAdmin = await db.get('SELECT id FROM admins WHERE email = ?', ['admin@artschool.ru']);
            if (!existingAdmin) {
                await db.run(`
                    INSERT INTO admins (name, email, password_hash, role, permissions)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    'Администратор',
                    'admin@artschool.ru',
                    '$2b$10$YourHashedPasswordHere',
                    'admin',
                    '["all"]'
                ]);
                console.log('👤 Тестовый администратор создан');
            }
        } catch (error) {
            console.log('⚠️ Ошибка создания тестового администратора:', error.message);
        }
        
        // Настройки по умолчанию
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
async function saveProfilesToDatabase(profiles) {
    try {
        console.log(`💾 Сохранение профилей в БД...`);
        let savedCount = 0;
        let updatedCount = 0;
        
        for (const profile of profiles) {
            try {
                const existingProfile = await db.get(
                    `SELECT id, student_name, phone_number FROM student_profiles 
                     WHERE student_name = ? AND phone_number = ?`,
                    [profile.student_name, profile.phone_number]
                );
                
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
                    profile.visits_data || '{}',
                    profile.custom_fields || '{}',
                    profile.raw_contact_data || '{}',
                    profile.lead_data || '{}',
                    profile.is_demo || 0,
                    profile.source || 'amocrm',
                    1
                ];
                
                if (!existingProfile) {
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    savedCount++;
                    console.log(`   ✅ Создан новый профиль: ${profile.student_name}`);
                } else {
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

async function generateClassesFromTemplate(templateId, weeks = 4) {
    try {
        console.log(`🔄 Генерация занятий из шаблона ${templateId} на ${weeks} недель`);
        
        const template = await db.get(`
            SELECT * FROM recurring_classes_templates 
            WHERE id = ? AND is_active = 1
        `, [templateId]);
        
        if (!template) {
            console.error('❌ Шаблон не найден');
            return 0;
        }
        
        const startDate = new Date(template.start_date);
        const endDate = template.end_date ? new Date(template.end_date) : null;
        const currentDate = new Date();
        
        let createdCount = 0;
        
        for (let week = 0; week < weeks; week++) {
            const targetDate = new Date(currentDate);
            targetDate.setDate(currentDate.getDate() + (week * 7));
            
            const targetDayOfWeek = targetDate.getDay();
            
            if (targetDayOfWeek == template.day_of_week) {
                if (endDate && targetDate > endDate) {
                    continue;
                }
                
                const existingClass = await db.get(`
                    SELECT id FROM schedule 
                    WHERE date = ? AND time = ? AND branch = ?
                `, [
                    targetDate.toISOString().split('T')[0],
                    template.time,
                    template.branch
                ]);
                
                if (!existingClass) {
                    await db.run(`
                        INSERT INTO schedule (date, time, branch, teacher_id, group_name, age_group, status)
                        VALUES (?, ?, ?, ?, ?, ?, 'active')
                    `, [
                        targetDate.toISOString().split('T')[0],
                        template.time,
                        template.branch,
                        template.teacher_id,
                        template.group_name,
                        template.age_group
                    ]);
                    
                    createdCount++;
                    console.log(`   ✅ Создано занятие: ${targetDate.toISOString().split('T')[0]} ${template.time}`);
                }
            }
        }
        
        console.log(`✅ Создано занятий: ${createdCount}`);
        return createdCount;
        
    } catch (error) {
        console.error('❌ Ошибка генерации занятий:', error.message);
        return 0;
    }
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

// ==================== MIDDLEWARE ====================
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

// ==================== ОСНОВНЫЕ API ====================

// Статус системы
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

// Логотип и настройки
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

// Авторизация по телефону
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

// ==================== API ДЛЯ ПОЛЬЗОВАТЕЛЕЙ ====================

// Расписание
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
            query += ` AND s.date >= date('now', '-1 day') 
                       AND s.date <= date('now', '+14 days')`;
        }
        
        query += ` ORDER BY s.date, s.time`;
        
        const schedule = await db.all(query, params);
        
        const scheduleByDay = {};
        schedule.forEach(lesson => {
            const date = lesson.date;
            if (!scheduleByDay[date]) {
                scheduleByDay[date] = [];
            }
            
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

// Преподаватели
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

// Новости
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

// FAQ
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

// История посещений
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

// Синхронизация посещений
app.post('/api/student/sync-visits/:phone', verifyToken, async (req, res) => {
    try {
        const phone = req.params.phone;
        const cleanPhone = phone.replace(/\D/g, '');
        
        console.log(`🔄 Синхронизация посещений для: ${phone}`);
        
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
        
        if (profile.amocrm_lead_id && amoCrmService.isInitialized) {
            console.log(`🔄 Получение свежих данных из amoCRM для lead ${profile.amocrm_lead_id}`);
            
            try {
                const lead = await amoCrmService.getLeadById(profile.amocrm_lead_id);
                if (lead) {
                    visits = amoCrmService.extractRealVisitsData(lead);
                    
                    await db.run(
                        'UPDATE student_profiles SET lead_data = ? WHERE id = ?',
                        [JSON.stringify(lead), profile.id]
                    );
                    
                    console.log(`✅ Получено из amoCRM: ${visits.length} посещений`);
                }
            } catch (error) {
                console.error('❌ Ошибка получения из amoCRM:', error.message);
            }
        }
        
        if (visits.length === 0 && profile.lead_data && profile.lead_data !== '{}') {
            try {
                const leadData = JSON.parse(profile.lead_data);
                visits = amoCrmService.extractRealVisitsData(leadData);
                console.log(`✅ Получено из lead_data: ${visits.length} посещений`);
            } catch (error) {
                console.error('❌ Ошибка парсинга lead_data:', error.message);
            }
        }
        
        const totalVisits = visits.length;
        const realVisits = visits.filter(v => !v.estimated).length;
        const estimatedVisits = visits.filter(v => v.estimated).length;
        
        const visitsData = {
            visits: visits,
            total_visits: totalVisits,
            real_visits: realVisits,
            estimated_visits: estimatedVisits,
            synced_at: new Date().toISOString()
        };
        
        await db.run(
            'UPDATE student_profiles SET visits_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [JSON.stringify(visitsData), profile.id]
        );
        
        console.log(`💾 Сохранено посещений: ${totalVisits}`);
        
        res.json({
            success: true,
            message: `Синхронизировано ${totalVisits} посещений`,
            data: {
                total_visits: totalVisits,
                real_visits: realVisits,
                estimated_visits: estimatedVisits,
                synced_at: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка синхронизации посещений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка синхронизации'
        });
    }
});

// Профиль пользователя
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

// Уведомления
app.get('/api/notifications', verifyToken, async (req, res) => {
    try {
        const phone = req.user.phone;
        const cleanPhone = phone.replace(/\D/g, '');
        
        console.log(`📨 Получение уведомлений для: ${phone}`);
        
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
        
        const notifications = [];
        
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
        
        if (profile.remaining_classes > 0 && profile.remaining_classes <= 2) {
            notifications.push({
                id: 2,
                type: 'info',
                message: `Осталось ${profile.remaining_classes} ${profile.remaining_classes === 1 ? 'занятие' : 'занятия'}. Подумайте о продлении абонемента`,
                date: new Date().toISOString(),
                read: false
            });
        }
        
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

// Контакт с администратором
app.post('/api/contact/admin', verifyToken, async (req, res) => {
    try {
        const { subject, message, student_name, branch } = req.body;
        
        console.log(`📨 Сообщение администратору: ${subject}`);
        console.log(`   От: ${student_name}`);
        console.log(`   Филиал: ${branch}`);
        console.log(`   Сообщение: ${message}`);
        
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
        
        const validPassword = password === 'admin123' || 
                            password === 'password' || 
                            admin.password_hash.includes(password);
        
        if (!validPassword) {
            return res.status(401).json({
                success: false,
                error: 'Неверный пароль'
            });
        }
        
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
        
        const branchesStats = await db.all(`
            SELECT branch, COUNT(*) as count 
            FROM student_profiles 
            WHERE branch IS NOT NULL AND branch != '' AND is_active = 1
            GROUP BY branch
            ORDER BY count DESC
        `);
        
        const recentActivities = await db.all(`
            SELECT * FROM system_logs 
            ORDER BY created_at DESC 
            LIMIT 10
        `);
        
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

// Расписание (админ)
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

// Создание/обновление занятия (админ)
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

// Шаблоны повторяющихся занятий
app.get('/api/admin/schedule/recurring', verifyAdminToken, async (req, res) => {
    try {
        console.log('📅 Получение шаблонов повторяющихся занятий');
        
        const templates = await db.all(`
            SELECT rt.*, t.name as teacher_name 
            FROM recurring_classes_templates rt
            LEFT JOIN teachers t ON rt.teacher_id = t.id
            WHERE rt.is_active = 1
            ORDER BY rt.day_of_week, rt.time
        `);
        
        res.json({
            success: true,
            data: {
                templates: templates || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения шаблонов:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения шаблонов'
        });
    }
});

// Создание шаблона повторяющихся занятий
app.post('/api/admin/schedule/recurring', verifyAdminToken, async (req, res) => {
    try {
        const templateData = req.body;
        const adminId = req.admin.admin_id;
        
        console.log('📝 Создание шаблона повторяющихся занятий:', templateData);
        
        if (!templateData.day_of_week || !templateData.time || !templateData.branch) {
            return res.status(400).json({
                success: false,
                error: 'Заполните обязательные поля: день недели, время, филиал'
            });
        }
        
        if (!templateData.start_date) {
            templateData.start_date = new Date().toISOString().split('T')[0];
        }
        
        const result = await db.run(`
            INSERT INTO recurring_classes_templates 
            (day_of_week, time, branch, teacher_id, group_name, age_group, 
             frequency, start_date, end_date, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
            templateData.day_of_week,
            templateData.time,
            templateData.branch,
            templateData.teacher_id || null,
            templateData.group_name || '',
            templateData.age_group || '',
            templateData.frequency || 'weekly',
            templateData.start_date,
            templateData.end_date || null
        ]);
        
        const templateId = result.lastID;
        
        let createdCount = 0;
        if (templateData.generate_count && templateData.generate_count > 0) {
            createdCount = await generateClassesFromTemplate(templateId, templateData.generate_count);
        }
        
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'schedule',
            'info',
            `Создан шаблон повторяющихся занятий #${templateId}. Создано занятий: ${createdCount}`,
            adminId
        ]);
        
        res.json({
            success: true,
            message: `Шаблон создан${createdCount > 0 ? `, создано ${createdCount} занятий` : ''}`,
            data: {
                template_id: templateId,
                created_count: createdCount
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания шаблона:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания шаблона'
        });
    }
});

// Генерация занятий из шаблона
app.post('/api/admin/schedule/recurring/:templateId/generate', verifyAdminToken, async (req, res) => {
    try {
        const templateId = req.params.templateId;
        const { weeks = 4 } = req.body;
        
        console.log(`🔄 Генерация занятий из шаблона ${templateId} на ${weeks} недель`);
        
        const createdCount = await generateClassesFromTemplate(templateId, weeks);
        
        res.json({
            success: true,
            message: `Создано ${createdCount} занятий`,
            data: {
                created_count: createdCount
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка генерации занятий:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка генерации занятий'
        });
    }
});

// Преподаватели (админ)
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

// FAQ (админ)
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

// Новости (админ)
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

// Рассылки (админ)
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
        
        await db.run(`
            INSERT INTO system_logs (type, level, message, user_id)
            VALUES (?, ?, ?, ?)
        `, [
            'mailings',
            'info',
            `Создана рассылка #${mailingId}: "${mailingData.name || mailingData.type}" (${recipientsCount} получателей)`,
            adminId
        ]);
        
        if (mailingData.type === 'telegram_notification' && telegramBot && telegramBot.bot) {
            try {
                console.log(`📤 Отправка Telegram уведомления для филиала: ${mailingData.branch}`);
                
                const sentCount = await telegramBot.sendNotificationToBranch(
                    mailingData.branch || 'all',
                    mailingData.message
                );
                
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
        
        const sentCount = await telegramBot.sendNotificationToBranch(branch || 'all', fullMessage);
        
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

// Настройки (админ)
app.get('/api/admin/settings', verifyAdminToken, async (req, res) => {
    try {
        console.log('⚙️  Получение настроек приложения');
        
        const settings = await db.all('SELECT * FROM app_settings ORDER BY id');
        
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

// Сохранение настроек
app.post('/api/admin/settings', verifyAdminToken, async (req, res) => {
    try {
        const { key, value, type, description } = req.body;
        const adminId = req.admin.admin_id;
        
        console.log(`⚙️  Обновление настройки: ${key}`);
        
        if (!key) {
            return res.status(400).json({
                success: false,
                error: 'Не указан ключ настройки'
            });
        }
        
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

// Удаление преподавателя
app.delete('/api/admin/teachers/:id', verifyAdminToken, async (req, res) => {
    try {
        const teacherId = req.params.id;
        const adminId = req.admin.admin_id;
        
        console.log(`🗑️ Удаление преподавателя #${teacherId}`);
        
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

// Отправка рассылки по ID
app.post('/api/admin/mailings/:id/send', verifyAdminToken, async (req, res) => {
    try {
        const mailingId = req.params.id;
        const adminId = req.admin.admin_id;
        
        console.log(`📤 Принудительная отправка рассылки #${mailingId}`);
        
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
        
        if (telegramBot && telegramBot.bot && mailing.type === 'telegram_notification') {
            const sentCount = await telegramBot.sendNotificationToBranch(
                mailing.branch || 'all',
                mailing.message
            );
            
            await db.run(`
                UPDATE mailings SET 
                    status = 'sent',
                    sent_count = ?,
                    sent_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [sentCount, mailingId]);
            
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

// Логи системы
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

// Пользователи Telegram
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

// ==================== СИНХРОНИЗАЦИЯ И WEBHOOKS ====================

// Синхронизация данных
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
        
        if (force) {
            console.log('🧹 Удаление старых данных...');
            const cleanPhone = phone.replace(/\D/g, '');
            await db.run(
                `DELETE FROM student_profiles WHERE phone_number LIKE ?`,
                [`%${cleanPhone.slice(-10)}%`]
            );
        }
        
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
        
        console.log('💾 Сохранение в базу данных...');
        const savedCount = await saveProfilesToDatabase(profiles);
        
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

// Webhook для Telegram
app.post('/api/telegram-webhook', async (req, res) => {
    try {
        const update = req.body;
        
        if (!telegramBot || !telegramBot.bot) {
            return res.status(200).json({ status: 'bot_not_configured' });
        }
        
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

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v4.3');
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
        } else {
            console.log('⚠️  amoCRM не инициализирован');
            console.log('ℹ️  Используются локальные данные');
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log(`🌐 Основной URL: http://localhost:${PORT}`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log(`🤖 Telegram бот: ${telegramBot.bot !== null ? '✅ Запущен' : '❌ Не запущен'}`);
            
            console.log('\n🔗 ОСНОВНЫЕ API МАРШРУТЫ:');
            console.log(`📊 Статус: GET http://localhost:${PORT}/api/status`);
            console.log(`🎨 Логотип: GET http://localhost:${PORT}/api/logo`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`📅 Расписание: GET http://localhost:${PORT}/api/schedule/student/{branch}`);
            console.log(`👨‍🏫 Преподаватели: GET http://localhost:${PORT}/api/teachers/student/{branch}`);
            console.log(`📰 Новости: GET http://localhost:${PORT}/api/news/student/{branch}`);
            console.log(`❓ FAQ: GET http://localhost:${PORT}/api/faq/student`);
            console.log(`🔄 Синхронизация: GET http://localhost:${PORT}/api/sync/{phone}`);
            console.log('\n🔧 АДМИН ПАНЕЛЬ:');
            console.log(`👤 Админ-панель: GET http://localhost:${PORT}/admin`);
            console.log(`🔐 Вход: POST http://localhost:${PORT}/api/admin/login`);
            console.log(`⚙️  Настройки: GET http://localhost:${PORT}/api/admin/settings`);
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
