// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;
const { Telegraf, Markup, session } = require('telegraf');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const crypto = require('crypto');

const app = express();

// ==================== КОНФИГУРАЦИЯ ====================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8425388642:AAFpXOa7lYdGYmimJvxyDg2PXyLjlxYrSq4';
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

// ==================== ИНИЦИАЛИЗАЦИЯ TELEGRAM БОТА ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
bot.use(session({ defaultSession: () => ({}) }));

// ==================== УЛУЧШЕННЫЙ КЛАСС AMOCRM С ПРАВИЛЬНЫМ ПАРСИНГОМ ====================
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
        this.tokenExpiresAt = 0;
        this.accountInfo = null;
        
        // Карта полей amoCRM для парсинга
        this.fieldMapping = {
            // Основная информация
            'student_name': { source: 'contact_name' }, // Из названия контакта
            'phone_number': { fields: ['Телефон', 'Мобильный телефон', 'Phone'], priority: 0 },
            'email': { fields: ['Email', 'Электронная почта', 'Почта'], priority: 0 },
            'branch': { fields: ['Филиал', 'Отделение', 'Branch'], priority: 0 },
            
            // Информация об абонементе
            'subscription_active': { fields: ['Активный абонемент', 'Есть активный абонемент'], priority: 0 },
            'subscription_type': { fields: ['Тип абонемента', 'Абонемент', 'Subscription type'], priority: 1 },
            'total_classes': { fields: ['Количество занятий', 'Всего занятий', 'Total classes'], priority: 0 },
            'used_classes': { fields: ['Использовано занятий', 'Пройденные занятия', 'Used classes'], priority: 0 },
            'remaining_classes': { fields: ['Осталось занятий', 'Доступно занятий', 'Remaining classes'], priority: 0 },
            'expiration_date': { fields: ['Срок действия', 'Действует до', 'Expiration date'], priority: 0 },
            
            // Расписание
            'day_of_week': { fields: ['День недели', 'День занятий', 'Day of week'], priority: 0 },
            'teacher_name': { fields: ['Преподаватель', 'Учитель', 'Teacher'], priority: 0 },
            'time_slot': { fields: ['Время занятия', 'Время', 'Time slot'], priority: 0 },
            'group_age': { fields: ['Возраст группы', 'Группа возраст', 'Age group'], priority: 0 },
            
            // Статистика и аналитика
            'last_visit_date': { fields: ['Дата последнего визита', 'Последнее посещение', 'Last visit'], priority: 0 },
            'first_purchase_date': { fields: ['Дата первой покупки', 'Первая покупка', 'First purchase'], priority: 0 },
            'purchase_count': { fields: ['Количество покупок', 'Число покупок', 'Purchase count'], priority: 0 },
            'total_purchase_amount': { fields: ['Сумма покупок', 'Общая сумма', 'Total amount'], priority: 0 },
            'average_check': { fields: ['Средний чек', 'Ср. чек', 'Average check'], priority: 1 },
            'free_classes_available': { fields: ['Доступно бесплатных занятий', 'Бесплатные занятия', 'Free classes'], priority: 0 },
            'month_classes_count': { fields: ['Счетчик занятий за месяц', 'Занятий в месяце', 'Month classes'], priority: 0 },
            
            // Дополнительная информация
            'is_regular': { fields: ['Постоянный клиент', 'Лояльный клиент', 'Regular client'], priority: 0 },
            'attendance_status': { fields: ['Посещаемость', 'Attendance', 'Attendance rate'], priority: 0 },
            'trial_date': { fields: ['Дата пробного занятия', 'Пробное занятие', 'Trial date'], priority: 0 },
            'trial_type': { fields: ['Тип пробного', 'Пробное', 'Trial type'], priority: 1 },
            'comment': { fields: ['Комментарий', 'Заметки', 'Comment'], priority: 0 },
            'allergy_info': { fields: ['Аллергия и особенности', 'Особенности', 'Allergy'], priority: 1 },
            
            // Маркетинг
            'marketing_channel': { fields: ['Рекламный канал', 'Канал привлечения', 'Marketing channel'], priority: 0 },
            'communication_channel': { fields: ['Канал связи', 'Основной канал', 'Communication channel'], priority: 0 },
            'telegram_subscribed': { fields: ['Подписан на Телеграм Бот', 'Telegram подписка', 'Telegram subscribed'], priority: 0 }
        };
        
        this.logConfig();
    }

    logConfig() {
        console.log('\n📋 КОНФИГУРАЦИЯ AMOCRM:');
        console.log('='.repeat(50));
        console.log(`🏢 Домен: ${AMOCRM_DOMAIN || '❌ Не установлен'}`);
        console.log(`🔗 Base URL: ${this.baseUrl}`);
        console.log(`🔑 Client ID: ${this.clientId ? '✅ Установлен' : '❌ Не установлен'}`);
        console.log(`🔐 Client Secret: ${this.clientSecret ? '✅ Установлен' : '❌ Не установлен'}`);
        console.log(`🔄 Redirect URI: ${this.redirectUri}`);
        console.log(`🔑 Access Token: ${this.accessToken ? '✅ Установлен (' + this.accessToken.substring(0, 20) + '...)' : '❌ Не установлен'}`);
        console.log('='.repeat(50));
    }

    async initialize() {
        console.log('\n🔄 ИНИЦИАЛИЗАЦИЯ AMOCRM СЕРВИСА');
        console.log('='.repeat(50));
        
        // 1. Проверяем минимальные требования
        if (!AMOCRM_DOMAIN) {
            console.log('❌ AMOCRM_DOMAIN не указан в .env файле');
            console.log('ℹ️  Добавьте в .env: AMOCRM_DOMAIN=pismovbanu.amocrm.ru');
            return false;
        }
        
        if (!this.accessToken) {
            console.log('❌ Отсутствует access token');
            console.log('ℹ️  Добавьте AMOCRM_ACCESS_TOKEN в .env файл или пройдите OAuth авторизацию');
            return false;
        }
        
        // 2. Проверяем валидность токена
        try {
            const isValid = await this.checkTokenValidity(this.accessToken);
            if (isValid) {
                console.log('✅ Токен валиден');
                this.isInitialized = true;
                
                // Сохраняем токен в БД
                await this.saveTokensToDatabase(this.accessToken, null, Date.now() + 24 * 60 * 60 * 1000);
                
                // Получаем и кешируем кастомные поля для парсинга
                await this.cacheCustomFields();
                
                return true;
            }
        } catch (tokenError) {
            console.log('❌ Токен невалиден:', tokenError.message);
            
            // Пробуем загрузить токен из базы данных
            try {
                const tokensLoaded = await this.loadTokensFromDatabase();
                if (tokensLoaded) {
                    console.log('✅ Токены успешно загружены из базы данных');
                    this.isInitialized = true;
                    
                    // Получаем и кешируем кастомные поля для парсинга
                    await this.cacheCustomFields();
                    
                    return true;
                }
            } catch (dbError) {
                console.log('⚠️  Не удалось загрузить токены из БД:', dbError.message);
            }
        }
        
        console.log('\n❌ НЕ УДАЛОСЬ ИНИЦИАЛИЗИРОВАТЬ AMOCRM');
        console.log('\n📋 ВАРИАНТЫ РЕШЕНИЯ:');
        console.log('='.repeat(60));
        console.log('1. Получите новый токен через OAuth:');
        console.log(`   Перейдите по ссылке для авторизации:`);
        console.log(`   ${DOMAIN}/oauth/link`);
        console.log('\n2. Или добавьте в .env файл:');
        console.log(`   AMOCRM_ACCESS_TOKEN=ваш_долгосрочный_токен`);
        console.log('='.repeat(60));
        
        this.isInitialized = false;
        return false;
    }

    async cacheCustomFields() {
        console.log('\n🗃️  КЕШИРОВАНИЕ КАСТОМНЫХ ПОЛЕЙ ДЛЯ ПАРСИНГА');
        
        try {
            const fields = await this.getContactCustomFields();
            this.cachedFields = fields;
            
            // Создаем обратное отображение ID поля -> название для быстрого поиска
            this.fieldIdToName = {};
            fields.forEach(field => {
                this.fieldIdToName[field.id] = field.name;
            });
            
            console.log(`✅ Закешировано ${fields.length} полей`);
            
            // Логируем маппинг полей для отладки
            console.log('\n🔍 СВЯЗЬ ПОЛЕЙ ДЛЯ ПАРСИНГА:');
            console.log('='.repeat(80));
            Object.entries(this.fieldMapping).forEach(([profileField, mapping]) => {
                if (mapping.fields) {
                    console.log(`${profileField}: ищем поля [${mapping.fields.join(', ')}]`);
                }
            });
            console.log('='.repeat(80));
            
        } catch (error) {
            console.error('❌ Ошибка кеширования полей:', error.message);
        }
    }

    async getContactCustomFields() {
        console.log('\n📋 ПОЛУЧЕНИЕ КАСТОМНЫХ ПОЛЕЙ КОНТАКТОВ');
        try {
            const response = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            const fields = response._embedded?.custom_fields || [];
            
            console.log(`✅ Получено кастомных полей: ${fields.length}`);
            
            // Логируем поля для отладки
            if (fields.length > 0) {
                console.log('\n📝 СПИСОК ВСЕХ КАСТОМНЫХ ПОЛЕЙ:');
                console.log('='.repeat(80));
                fields.forEach((field, index) => {
                    console.log(`${index + 1}. "${field.name}" (ID: ${field.id}, Тип: ${field.type})`);
                    if (field.enums) {
                        console.log(`   Варианты: ${Object.values(field.enums).map(e => e.value).join(', ')}`);
                    }
                });
                console.log('='.repeat(80));
            }
            
            return fields;
        } catch (error) {
            console.error('❌ Ошибка получения кастомных полей:', error.message);
            return [];
        }
    }

    async checkTokenValidity(token) {
        console.log('\n🔍 ПРОВЕРКА ВАЛИДНОСТИ ТОКЕНА');
        
        try {
            const response = await axios.get(`${this.baseUrl}/api/v4/account`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'ArtSchoolBot/1.0'
                },
                timeout: 10000
            });
            
            this.accountInfo = response.data;
            console.log('✅ Токен валиден!');
            console.log(`📊 Аккаунт: ${this.accountInfo.name} (ID: ${this.accountInfo.id})`);
            console.log(`🌍 Поддомен: ${this.accountInfo.subdomain}`);
            console.log(`🕐 Часовой пояс: ${this.accountInfo.timezone}`);
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка проверки токена:');
            if (error.response) {
                console.log(`   Статус: ${error.response.status}`);
                if (error.response.status === 401) {
                    console.log(`   Токен невалиден или истек`);
                }
            } else if (error.request) {
                console.log(`   Не получен ответ от сервера`);
            } else {
                console.log(`   Ошибка: ${error.message}`);
            }
            throw error;
        }
    }

    async getAccessToken(authCode) {
        console.log('\n🔄 ПОЛУЧЕНИЕ ACCESS TOKEN ПО КОДУ АВТОРИЗАЦИИ');
        
        const tokenData = {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'authorization_code',
            code: authCode,
            redirect_uri: this.redirectUri
        };

        console.log('📦 Данные запроса:', {
            client_id: this.clientId,
            client_secret: '***' + this.clientSecret?.slice(-4),
            grant_type: 'authorization_code',
            code_length: authCode?.length,
            redirect_uri: this.redirectUri
        });

        try {
            const response = await axios.post(`https://${AMOCRM_SUBDOMAIN}.amocrm.ru/oauth2/access_token`, tokenData, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'ArtSchoolBot/1.0'
                },
                timeout: 15000
            });

            const { access_token, refresh_token, expires_in } = response.data;
            
            this.accessToken = access_token;
            this.tokenExpiresAt = Date.now() + expires_in * 1000;
            
            console.log('✅ ACCESS TOKEN ПОЛУЧЕН УСПЕШНО!');
            console.log(`🔑 Access Token: ${access_token.substring(0, 30)}...`);
            console.log(`⏰ Истекает через: ${Math.floor(expires_in / 3600)} ч ${Math.floor((expires_in % 3600) / 60)} мин`);
            console.log(`📅 Истекает: ${new Date(this.tokenExpiresAt).toLocaleString()}`);
            
            // Сохраняем токены в БД
            await this.saveTokensToDatabase(access_token, refresh_token, this.tokenExpiresAt);
            
            // Проверяем валидность токена
            await this.checkTokenValidity(access_token);
            
            return true;
        } catch (error) {
            console.error('❌ ОШИБКА ПОЛУЧЕНИЯ ACCESS TOKEN:');
            if (error.response) {
                console.log(`   Статус: ${error.response.status}`);
                console.log(`   Данные:`, JSON.stringify(error.response.data, null, 2));
            } else if (error.request) {
                console.log(`   Запрос отправлен, но ответ не получен`);
                console.log(`   Ошибка: ${error.message}`);
            } else {
                console.log(`   Ошибка настройки запроса: ${error.message}`);
            }
            throw error;
        }
    }

    async saveTokensToDatabase(accessToken, refreshToken, expiresAt) {
        try {
            console.log('\n💾 СОХРАНЕНИЕ ТОКЕНОВ В БАЗУ ДАННЫХ');
            
            await db.run(
                `INSERT OR REPLACE INTO amocrm_tokens (id, access_token, refresh_token, expires_at, created_at) 
                 VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [accessToken, refreshToken, expiresAt]
            );
            
            console.log('✅ Токены успешно сохранены в БД');
            console.log(`   Access Token сохранен (первые 20 символов): ${accessToken.substring(0, 20)}...`);
            console.log(`   Срок действия: ${new Date(expiresAt).toLocaleString()}`);
            
        } catch (error) {
            console.error('❌ Ошибка сохранения токенов в БД:', error.message);
        }
    }

    async loadTokensFromDatabase() {
        try {
            console.log('\n📂 ЗАГРУЗКА ТОКЕНОВ ИЗ БАЗЫ ДАННЫХ');
            
            const tokens = await db.get('SELECT * FROM amocrm_tokens WHERE id = 1');
            
            if (tokens) {
                console.log('✅ Токены найдены в базе данных:');
                console.log(`   Access Token: ${tokens.access_token.substring(0, 30)}...`);
                console.log(`   Истекает: ${new Date(tokens.expires_at).toLocaleString()}`);
                
                const now = Date.now();
                const expiresAt = tokens.expires_at;
                
                // Проверяем не истек ли токен (запас 5 минут)
                if (now < expiresAt - 300000) {
                    console.log('✅ Токен из БД валиден');
                    this.accessToken = tokens.access_token;
                    this.tokenExpiresAt = expiresAt;
                    
                    // Проверяем валидность токена
                    await this.checkTokenValidity(tokens.access_token);
                    return true;
                } else {
                    console.log('🔄 Токен из БД истек или скоро истекает');
                    console.log('⚠️  Для долгосрочных токенов обновление не требуется');
                    return false;
                }
            } else {
                console.log('📭 Токены в БД не найдены');
                return false;
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки токенов из БД:', error.message);
            return false;
        }
    }

    async makeRequest(method, endpoint, data = null) {
        if (!this.isInitialized || !this.accessToken) {
            throw new Error('amoCRM не инициализирован или токен отсутствует');
        }

        const url = `${this.baseUrl}${endpoint}`;
        console.log(`\n🌐 API ЗАПРОС: ${method} ${url}`);
        
        if (data && method !== 'GET') {
            console.log('📦 Данные запроса:', JSON.stringify(data, null, 2));
        }

        try {
            const config = {
                method: method,
                url: url,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'ArtSchoolBot/1.0'
                },
                timeout: 30000
            };

            if (data) {
                config.data = data;
            }

            const response = await axios(config);
            console.log(`✅ Запрос успешен: ${response.status}`);
            
            return response.data;
            
        } catch (error) {
            console.error(`❌ ОШИБКА ЗАПРОСА К AMOCRM:`);
            console.error(`   URL: ${method} ${url}`);
            
            if (error.response) {
                console.error(`   Статус: ${error.response.status}`);
                console.error(`   Данные ответа:`, JSON.stringify(error.response.data, null, 2));
                
                // Если 401 ошибка - токен истек
                if (error.response.status === 401) {
                    console.log('❌ Токен невалиден или истек. Требуется новая авторизация.');
                    this.isInitialized = false;
                }
            } else if (error.request) {
                console.error(`   Запрос отправлен, но ответ не получен`);
            } else {
                console.error(`   Ошибка настройки запроса: ${error.message}`);
            }
            
            throw error;
        }
    }

    async getAccountInfo() {
        console.log('\n📊 ПОЛУЧЕНИЕ ИНФОРМАЦИИ ОБ АККАУНТЕ');
        try {
            const info = await this.makeRequest('GET', '/api/v4/account');
            this.accountInfo = info;
            return info;
        } catch (error) {
            console.error('❌ Ошибка получения информации об аккаунте:', error.message);
            throw error;
        }
    }

    async searchContactsByPhone(phoneNumber) {
        console.log(`\n🔍 ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ`);
        console.log(`📞 Исходный номер: ${phoneNumber}`);
        
        // Очищаем номер телефона
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        console.log(`🧹 Очищенный номер: ${cleanPhone}`);
        
        if (!cleanPhone || cleanPhone.length < 10) {
            console.log('❌ Номер телефона слишком короткий');
            return { _embedded: { contacts: [] } };
        }
        
        // Форматируем номер в разные форматы для поиска
        let phoneVariants = [];
        
        if (cleanPhone.length === 10) {
            phoneVariants = [
                `+7${cleanPhone}`,
                `8${cleanPhone}`,
                `7${cleanPhone}`,
                cleanPhone
            ];
        } else if (cleanPhone.length === 11) {
            if (cleanPhone.startsWith('8')) {
                phoneVariants = [
                    `+7${cleanPhone.slice(1)}`,
                    cleanPhone,
                    `7${cleanPhone.slice(1)}`
                ];
            } else if (cleanPhone.startsWith('7')) {
                phoneVariants = [
                    `+${cleanPhone}`,
                    `8${cleanPhone.slice(1)}`,
                    cleanPhone
                ];
            }
        } else {
            phoneVariants = [cleanPhone];
        }
        
        // Убираем дубликаты
        phoneVariants = [...new Set(phoneVariants)];
        console.log(`🔄 Варианты для поиска:`, phoneVariants);
        
        let allContacts = [];
        
        // Ищем по всем вариантам
        for (const phoneVariant of phoneVariants) {
            try {
                console.log(`\n🔍 Поиск по варианту: "${phoneVariant}"`);
                
                // Поиск через query параметр
                try {
                    const encodedQuery = encodeURIComponent(phoneVariant);
                    const response = await this.makeRequest('GET', `/api/v4/contacts?query=${encodedQuery}&limit=250`);
                    
                    if (response._embedded?.contacts) {
                        const contacts = response._embedded.contacts;
                        console.log(`✅ Найдено контактов через query: ${contacts.length}`);
                        
                        allContacts = [...allContacts, ...contacts];
                    }
                } catch (queryError) {
                    console.log(`⚠️  Ошибка поиска через query: ${queryError.message}`);
                }
                
            } catch (error) {
                console.log(`⚠️  Ошибка поиска по варианту "${phoneVariant}": ${error.message}`);
            }
        }
        
        // Убираем дубликаты по ID
        const uniqueContacts = [];
        const seenIds = new Set();
        
        for (const contact of allContacts) {
            if (!seenIds.has(contact.id)) {
                seenIds.add(contact.id);
                uniqueContacts.push(contact);
            }
        }
        
        console.log(`\n📊 ИТОГО: ${uniqueContacts.length} уникальных контактов`);
        
        return {
            _embedded: {
                contacts: uniqueContacts
            }
        };
    }

    async getContactDetails(contactId) {
        console.log(`\n🔍 ПОЛУЧЕНИЕ ДЕТАЛЕЙ КОНТАКТА ${contactId}`);
        try {
            const response = await this.makeRequest('GET', `/api/v4/contacts/${contactId}?with=leads`);
            console.log(`✅ Детали контакта получены`);
            
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения деталей контакта: ${error.message}`);
            throw error;
        }
    }

    // Улучшенный метод парсинга полей из amoCRM
    extractFieldValue(fieldValues, fieldType = 'text') {
        if (!fieldValues || !Array.isArray(fieldValues) || fieldValues.length === 0) {
            return null;
        }
        
        const firstValue = fieldValues[0];
        
        switch (fieldType) {
            case 'text':
            case 'textarea':
                return firstValue.value || null;
            case 'numeric':
                const num = parseFloat(firstValue.value);
                return isNaN(num) ? null : num;
            case 'date':
                try {
                    // amoCRM может хранить даты в timestamp или строке
                    const dateStr = firstValue.value;
                    if (/^\d+$/.test(dateStr)) {
                        return new Date(parseInt(dateStr) * 1000).toISOString().split('T')[0];
                    }
                    return dateStr;
                } catch (e) {
                    return firstValue.value;
                }
            case 'checkbox':
                return firstValue.value === 'true' || firstValue.value === '1' || firstValue.value === 'Да';
            case 'select':
            case 'multiselect':
                return firstValue.value;
            default:
                return firstValue.value;
        }
    }

    // Находим поле в кастомных полях по названию
    findFieldByName(fieldName, customFields) {
        if (!this.fieldIdToName || !customFields) {
            return null;
        }
        
        // Поиск по ID поля
        const fieldId = Object.keys(this.fieldIdToName).find(id => 
            this.fieldIdToName[id].toLowerCase() === fieldName.toLowerCase()
        );
        
        if (fieldId) {
            return customFields.find(f => f.field_id.toString() === fieldId);
        }
        
        // Если не нашли по ID, ищем по названию в значениях полей
        for (const field of customFields) {
            const name = this.fieldIdToName[field.field_id];
            if (name && name.toLowerCase().includes(fieldName.toLowerCase())) {
                return field;
            }
        }
        
        return null;
    }

    // Получаем значение поля по его возможным названиям
    getFieldValueByNames(fieldNames, customFields) {
        if (!customFields || !Array.isArray(customFields)) {
            return null;
        }
        
        for (const fieldName of fieldNames) {
            const field = this.findFieldByName(fieldName, customFields);
            if (field && field.values && field.values.length > 0) {
                return this.extractFieldValue(field.values, field.field_type || 'text');
            }
        }
        
        return null;
    }

    // Анализируем количество занятий из текстовых полей
    parseClassesCount(text) {
        if (!text) return null;
        
        // Ищем числа в тексте
        const matches = text.match(/\d+/g);
        if (!matches || matches.length === 0) return null;
        
        // Берем первое число
        const count = parseInt(matches[0]);
        return isNaN(count) ? null : count;
    }

    // Анализируем информацию об абонементе
    analyzeSubscriptionInfo(customFields) {
        const result = {
            is_active: false,
            type: 'Без абонемента',
            total_classes: 0,
            used_classes: 0,
            remaining_classes: 0,
            expiration_date: null
        };
        
        // Проверяем активность абонемента
        const activeField = this.getFieldValueByNames(['Активный абонемент', 'Есть активный абонемент'], customFields);
        if (activeField === true || activeField === 'Да' || activeField === 'ДА' || activeField === 'true') {
            result.is_active = true;
        }
        
        // Тип абонемента
        result.type = this.getFieldValueByNames(['Тип абонемента', 'Абонемент', 'Subscription type'], customFields) || 
                     (result.is_active ? 'Активный абонемент' : 'Без абонемента');
        
        // Количество занятий (из разных полей)
        const totalClasses = this.getFieldValueByNames(['Количество занятий', 'Всего занятий', 'Total classes'], customFields);
        if (totalClasses) {
            result.total_classes = parseInt(totalClasses) || this.parseClassesCount(totalClasses) || 0;
        }
        
        // Осталось занятий
        const remainingClasses = this.getFieldValueByNames(['Осталось занятий', 'Доступно занятий', 'Remaining classes'], customFields);
        if (remainingClasses) {
            result.remaining_classes = parseInt(remainingClasses) || this.parseClassesCount(remainingClasses) || 0;
        }
        
        // Доступно бесплатных занятий (отдельное поле)
        const freeClasses = this.getFieldValueByNames(['Доступно бесплатных занятий', 'Бесплатные занятия'], customFields);
        if (freeClasses) {
            const freeCount = parseInt(freeClasses) || this.parseClassesCount(freeClasses) || 0;
            if (freeCount > 0) {
                result.remaining_classes += freeCount;
                if (result.total_classes === 0) {
                    result.total_classes = freeCount;
                }
            }
        }
        
        // Счетчик занятий за месяц (может быть использовано занятий)
        const monthClasses = this.getFieldValueByNames(['Счетчик занятий за месяц', 'Занятий в месяце'], customFields);
        if (monthClasses) {
            const monthCount = parseInt(monthClasses) || this.parseClassesCount(monthClasses) || 0;
            result.used_classes = monthCount;
            
            // Если общее количество известно, но остаток нет - вычисляем
            if (result.total_classes > 0 && result.remaining_classes === 0) {
                result.remaining_classes = Math.max(0, result.total_classes - monthCount);
            }
        }
        
        // Срок действия
        result.expiration_date = this.getFieldValueByNames(['Срок действия', 'Действует до', 'Expiration date'], customFields);
        
        // Если осталось занятий известно, но общее количество нет - устанавливаем разумное значение
        if (result.remaining_classes > 0 && result.total_classes === 0) {
            result.total_classes = result.remaining_classes * 2; // Предполагаем, что использовано столько же
        }
        
        // Если абонемент активен, но нет данных о занятиях - устанавливаем значения по умолчанию
        if (result.is_active && result.total_classes === 0) {
            result.total_classes = 8;
            result.remaining_classes = 4;
        }
        
        return result;
    }

    async parseContactToStudentProfile(contact) {
        console.log(`\n🎯 ПАРСИНГ КОНТАКТА В ПРОФИЛЬ УЧЕНИКА`);
        console.log(`👤 Контакт: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
        
        const customFields = contact.custom_fields_values || [];
        
        // Анализируем информацию об абонементе
        const subscriptionInfo = this.analyzeSubscriptionInfo(customFields);
        
        // Извлекаем значения по всем полям
        const profile = {
            // Основная информация
            amocrm_contact_id: contact.id,
            student_name: contact.name || 'Не указано',
            parent_name: '', // В вашем примере не было родителя
            
            // Контактные данные
            phone_number: this.getFieldValueByNames(['Телефон', 'Мобильный телефон', 'Phone'], customFields) || '',
            email: this.getFieldValueByNames(['Email', 'Электронная почта', 'Почта'], customFields) || '',
            
            // Филиал и расписание
            branch: this.getFieldValueByNames(['Филиал', 'Отделение', 'Branch'], customFields) || 'Не указан',
            day_of_week: this.getFieldValueByNames(['День недели', 'День занятий', 'Day of week'], customFields) || '',
            time_slot: this.getFieldValueByNames(['Время занятия', 'Время', 'Time slot'], customFields) || '',
            teacher_name: this.getFieldValueByNames(['Преподаватель', 'Учитель', 'Teacher'], customFields) || '',
            group_age: this.getFieldValueByNames(['Возраст группы', 'Группа возраст', 'Age group'], customFields) || '',
            
            // Информация об абонементе
            subscription_type: subscriptionInfo.type,
            subscription_active: subscriptionInfo.is_active,
            total_classes: subscriptionInfo.total_classes,
            remaining_classes: subscriptionInfo.remaining_classes,
            used_classes: subscriptionInfo.used_classes,
            expiration_date: subscriptionInfo.expiration_date,
            
            // Статистика и аналитика
            last_visit_date: this.getFieldValueByNames(['Дата последнего визита', 'Последнее посещение', 'Last visit'], customFields),
            first_purchase_date: this.getFieldValueByNames(['Дата первой покупки', 'Первая покупка', 'First purchase'], customFields),
            purchase_count: this.getFieldValueByNames(['Количество покупок', 'Число покупок', 'Purchase count'], customFields) || 0,
            total_purchase_amount: this.getFieldValueByNames(['Сумма покупок', 'Общая сумма', 'Total amount'], customFields) || 0,
            average_check: this.getFieldValueByNames(['Средний чек', 'Ср. чек', 'Average check'], customFields) || 0,
            free_classes_available: this.getFieldValueByNames(['Доступно бесплатных занятий', 'Бесплатные занятия', 'Free classes'], customFields) || 0,
            month_classes_count: this.getFieldValueByNames(['Счетчик занятий за месяц', 'Занятий в месяце', 'Month classes'], customFields) || 0,
            
            // Дополнительная информация
            is_regular: this.getFieldValueByNames(['Постоянный клиент', 'Лояльный клиент', 'Regular client'], customFields) || false,
            attendance_status: this.getFieldValueByNames(['Посещаемость', 'Attendance', 'Attendance rate'], customFields) || '',
            trial_date: this.getFieldValueByNames(['Дата пробного занятия', 'Пробное занятие', 'Trial date'], customFields),
            trial_type: this.getFieldValueByNames(['Тип пробного', 'Пробное', 'Trial type'], customFields) || '',
            comment: this.getFieldValueByNames(['Комментарий', 'Заметки', 'Comment'], customFields) || '',
            allergy_info: this.getFieldValueByNames(['Аллергия и особенности', 'Особенности', 'Allergy'], customFields) || '',
            
            // Маркетинг
            marketing_channel: this.getFieldValueByNames(['Рекламный канал', 'Канал привлечения', 'Marketing channel'], customFields) || '',
            communication_channel: this.getFieldValueByNames(['Канал связи', 'Основной канал', 'Communication channel'], customFields) || '',
            telegram_subscribed: this.getFieldValueByNames(['Подписан на Телеграм Бот', 'Telegram подписка', 'Telegram subscribed'], customFields) || false,
            
            // Технические поля
            custom_fields: JSON.stringify(customFields),
            raw_contact_data: JSON.stringify(contact, null, 2),
            is_demo: 0,
            source: 'amocrm',
            created_at: contact.created_at ? new Date(contact.created_at * 1000).toISOString() : null,
            updated_at: contact.updated_at ? new Date(contact.updated_at * 1000).toISOString() : null
        };
        
        // Логируем извлеченные данные
        console.log('\n📊 ИЗВЛЕЧЕННЫЕ ДАННЫЕ ИЗ AMOCRM:');
        console.log('='.repeat(80));
        console.log(`👤 Ученик: ${profile.student_name}`);
        console.log(`📞 Телефон: ${profile.phone_number}`);
        console.log(`📧 Email: ${profile.email}`);
        console.log(`🏢 Филиал: ${profile.branch}`);
        console.log(`📅 День недели: ${profile.day_of_week}`);
        console.log(`⏰ Время: ${profile.time_slot}`);
        console.log(`👩‍🏫 Преподаватель: ${profile.teacher_name}`);
        console.log(`👶 Возрастная группа: ${profile.group_age}`);
        console.log('\n🎫 ИНФОРМАЦИЯ ОБ АБОНЕМЕНТЕ:');
        console.log(`   Тип: ${profile.subscription_type}`);
        console.log(`   Активный: ${profile.subscription_active ? 'Да' : 'Нет'}`);
        console.log(`   Всего занятий: ${profile.total_classes}`);
        console.log(`   Использовано: ${profile.used_classes}`);
        console.log(`   Осталось: ${profile.remaining_classes}`);
        console.log(`   Срок действия: ${profile.expiration_date}`);
        console.log('\n📈 СТАТИСТИКА:');
        console.log(`   Последний визит: ${profile.last_visit_date}`);
        console.log(`   Количество покупок: ${profile.purchase_count}`);
        console.log(`   Сумма покупок: ${profile.total_purchase_amount} руб.`);
        console.log(`   Средний чек: ${profile.average_check} руб.`);
        console.log(`   Доступно бесплатных занятий: ${profile.free_classes_available}`);
        console.log(`   Занятий в месяце: ${profile.month_classes_count}`);
        console.log(`   Постоянный клиент: ${profile.is_regular ? 'Да' : 'Нет'}`);
        console.log(`   Дата пробного: ${profile.trial_date}`);
        console.log('='.repeat(80));
        
        return profile;
    }

    async getStudentsByPhone(phoneNumber) {
        console.log(`\n🎯 ПОЛНЫЙ ПОИСК УЧЕНИКОВ ПО ТЕЛЕФОНУ`);
        console.log(`📞 Телефон для поиска: ${phoneNumber}`);
        
        const profiles = [];
        
        // Пробуем найти в amoCRM
        if (this.isInitialized) {
            try {
                console.log(`\n🔍 Поиск в amoCRM...`);
                const contactsResponse = await this.searchContactsByPhone(phoneNumber);
                const contacts = contactsResponse._embedded?.contacts || [];
                
                console.log(`\n📊 Контактов найдено в amoCRM: ${contacts.length}`);
                
                if (contacts.length === 0) {
                    console.log('📭 Контакты не найдены в amoCRM');
                }
                
                // Парсим каждый контакт в профиль
                for (const contact of contacts) {
                    try {
                        console.log(`\n🔄 Обработка контакта: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
                        
                        // Получаем детали контакта
                        const contactDetails = await this.getContactDetails(contact.id);
                        
                        // Создаем профиль
                        let profile = await this.parseContactToStudentProfile(contactDetails);
                        
                        // Добавляем флаг, что это реальные данные из amoCRM
                        profile.is_demo = 0;
                        profile.source = 'amocrm';
                        
                        profiles.push(profile);
                        console.log(`✅ Профиль добавлен: ${profile.student_name}`);
                    } catch (contactError) {
                        console.error(`❌ Ошибка обработки контакта ${contact.id}: ${contactError.message}`);
                    }
                }
            } catch (crmError) {
                console.error(`❌ Ошибка поиска в amoCRM: ${crmError.message}`);
            }
        } else {
            console.log(`⚠️  amoCRM не инициализирован, пропускаем поиск в CRM`);
        }
        
        // Если в amoCRM не нашли, ищем в локальной базе
        if (profiles.length === 0) {
            console.log(`\n🔍 Поиск в локальной базе данных...`);
            try {
                const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);
                const localProfiles = await db.all(
                    `SELECT * FROM student_profiles 
                     WHERE phone_number LIKE ? AND is_active = 1
                     ORDER BY created_at DESC
                     LIMIT 10`,
                    [`%${cleanPhone}%`]
                );
                
                console.log(`📊 Найдено в локальной базе: ${localProfiles.length}`);
                
                if (localProfiles.length > 0) {
                    profiles.push(...localProfiles);
                }
            } catch (dbError) {
                console.error(`❌ Ошибка поиска в локальной БД: ${dbError.message}`);
            }
        }
        
        console.log(`\n🎯 ИТОГО найдено профилей: ${profiles.length}`);
        
        return profiles;
    }

    async testConnection() {
        console.log('\n🧪 ТЕСТ ПОДКЛЮЧЕНИЯ К AMOCRM');
        
        try {
            // 1. Проверяем токен
            await this.checkTokenValidity(this.accessToken);
            
            // 2. Получаем информацию об аккаунте
            const accountInfo = await this.getAccountInfo();
            
            // 3. Получаем кастомные поля
            const customFields = await this.getContactCustomFields();
            
            // 4. Тестовый поиск
            const testSearch = await this.searchContactsByPhone('79991234567');
            
            return {
                success: true,
                account: accountInfo,
                custom_fields_count: customFields.length,
                test_search_results: testSearch._embedded?.contacts?.length || 0,
                domain: AMOCRM_DOMAIN,
                field_mapping: Object.keys(this.fieldMapping).length
            };
        } catch (error) {
            console.error('❌ Ошибка тестирования подключения:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
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
        
        const dbDir = path.join(__dirname, 'data');
        try {
            await fs.mkdir(dbDir, { recursive: true });
            console.log('📁 Директория данных создана:', dbDir);
        } catch (mkdirError) {
            console.log('📁 Директория данных уже существует');
        }
        
        const dbPath = path.join(dbDir, 'art_school.db');
        console.log(`💾 Путь к базе данных: ${dbPath}`);
        
        try {
            await fs.access(dbPath);
            console.log('📂 Используем существующую базу данных');
        } catch (error) {
            console.log('🆕 Создаем новую базу данных...');
        }
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        await db.run('PRAGMA busy_timeout = 5000');
        await db.run('PRAGMA synchronous = NORMAL');
        
        console.log('⚙️  Настройки SQLite применены');
        
        await createTables();
        
        console.log('\n✅ База данных успешно инициализирована!');
        
        return db;
    } catch (error) {
        console.error('❌ Критическая ошибка инициализации базы данных:', error.message);
        console.error('Stack trace:', error.stack);
        
        try {
            console.log('\n🔄 Пробуем создать временную базу данных в памяти...');
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            console.log('✅ Создана временная база данных в памяти');
            await db.run('PRAGMA foreign_keys = ON');
            await createTables();
            console.log('⚠️  ВНИМАНИЕ: Используется база данных в памяти. Данные не сохранятся после перезапуска!');
            
            return db;
        } catch (memoryError) {
            console.error('❌ Не удалось создать даже базу в памяти:', memoryError.message);
            throw error;
        }
    }
};

const createTables = async () => {
    try {
        console.log('\n📊 СОЗДАНИЕ ТАБЛИЦ БАЗЫ ДАННЫХ');
        
        // Токены amoCRM
        await db.exec(`
            CREATE TABLE IF NOT EXISTS amocrm_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expires_at INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица amocrm_tokens создана');

        // Обновленная таблица профилей учеников с новыми полями
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_user_id INTEGER,
                amocrm_contact_id INTEGER UNIQUE,
                
                -- Основная информация
                student_name TEXT NOT NULL,
                parent_name TEXT,
                phone_number TEXT NOT NULL,
                email TEXT,
                branch TEXT NOT NULL CHECK(branch IN ('Свиблово', 'Чертаново', 'Не указан')),
                
                -- Расписание
                day_of_week TEXT,
                time_slot TEXT,
                teacher_name TEXT,
                group_age TEXT,
                
                -- Информация об абонементе
                subscription_type TEXT,
                subscription_active INTEGER DEFAULT 0,
                total_classes INTEGER DEFAULT 0,
                used_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                expiration_date DATE,
                free_classes_available INTEGER DEFAULT 0,
                
                -- Статистика и аналитика
                last_visit_date DATE,
                first_purchase_date DATE,
                purchase_count INTEGER DEFAULT 0,
                total_purchase_amount INTEGER DEFAULT 0,
                average_check INTEGER DEFAULT 0,
                month_classes_count INTEGER DEFAULT 0,
                
                -- Дополнительная информация
                is_regular INTEGER DEFAULT 0,
                attendance_status TEXT,
                trial_date DATE,
                trial_type TEXT,
                comment TEXT,
                allergy_info TEXT,
                
                -- Маркетинг
                marketing_channel TEXT,
                communication_channel TEXT,
                telegram_subscribed INTEGER DEFAULT 0,
                
                -- Технические поля
                custom_fields TEXT,
                raw_contact_data TEXT,
                is_demo INTEGER DEFAULT 0,
                source TEXT DEFAULT 'amocrm',
                is_active INTEGER DEFAULT 1,
                last_selected INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Таблица student_profiles создана (обновленная)');

        // Остальные таблицы (без изменений)
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
        console.log('✅ Таблица telegram_users создана');

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
        console.log('✅ Таблица schedule создана');

        await db.exec(`
            CREATE TABLE IF NOT EXISTS teachers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                photo_url TEXT,
                qualification TEXT,
                specialization TEXT,
                experience_years INTEGER,
                description TEXT,
                branches TEXT,
                telegram_username TEXT,
                phone_number TEXT,
                email TEXT,
                is_active INTEGER DEFAULT 1,
                display_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица teachers создана');

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
        console.log('✅ Таблица attendance создана');

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
        console.log('✅ Таблица faq создана');

        await db.exec(`
            CREATE TABLE IF NOT EXISTS news (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                short_description TEXT,
                image_url TEXT,
                branch TEXT,
                is_active INTEGER DEFAULT 1,
                publish_date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица news создана');

        await db.exec(`
            CREATE TABLE IF NOT EXISTS administrators (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE,
                name TEXT NOT NULL,
                email TEXT,
                phone_number TEXT,
                branches TEXT,
                role TEXT DEFAULT 'admin' CHECK(role IN ('admin', 'superadmin')),
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица administrators создана');

        await db.exec(`
            CREATE TABLE IF NOT EXISTS broadcasts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id INTEGER NOT NULL,
                broadcast_type TEXT NOT NULL CHECK(broadcast_type IN ('service', 'marketing')),
                message_type TEXT CHECK(message_type IN ('cancellation', 'replacement', 'reschedule', 'custom')),
                title TEXT,
                message TEXT NOT NULL,
                branches TEXT,
                teacher_ids TEXT,
                days_of_week TEXT,
                filters_applied TEXT,
                recipients_count INTEGER DEFAULT 0,
                sent_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sending', 'sent', 'failed')),
                sent_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_id) REFERENCES administrators(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Таблица broadcasts создана');

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
        console.log('✅ Таблица branch_contacts создана');

        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT UNIQUE NOT NULL,
                user_id INTEGER,
                telegram_user_id INTEGER,
                session_data TEXT,
                phone_number TEXT,
                ip_address TEXT,
                user_agent TEXT,
                is_active INTEGER DEFAULT 1,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Таблица user_sessions создана');

        await db.exec(`
            CREATE TABLE IF NOT EXISTS amocrm_sync_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_type TEXT NOT NULL,
                records_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'success' CHECK(status IN ('success', 'error', 'partial')),
                error_message TEXT,
                sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица amocrm_sync_logs создана');

        console.log('\n🎉 Все таблицы созданы успешно!');
        
        await createIndexes();
        
        await createTestData();
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    }
};

const createIndexes = async () => {
    try {
        console.log('\n📈 СОЗДАНИЕ ИНДЕКСОВ');
        
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_amocrm_id ON student_profiles(amocrm_contact_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(is_active)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_telegram_users_phone ON telegram_users(phone_number)');
        
        console.log('✅ Индексы созданы');
    } catch (error) {
        console.error('⚠️  Ошибка создания индексов:', error.message);
    }
};

// ==================== ТЕСТОВЫЕ ДАННЫЕ ====================
const createTestData = async () => {
    try {
        console.log('\n📝 ПРОВЕРКА И СОЗДАНИЕ ТЕСТОВЫХ ДАННЫХ');
        
        const hasStudents = await db.get("SELECT 1 FROM student_profiles LIMIT 1");
        const hasTeachers = await db.get("SELECT 1 FROM teachers LIMIT 1");
        const hasAdmins = await db.get("SELECT 1 FROM administrators LIMIT 1");
        const hasSchedule = await db.get("SELECT 1 FROM schedule LIMIT 1");
        
        // Создаем администратора только если нет ни одного
        if (!hasAdmins) {
            console.log('👥 Создание тестового администратора...');
            await db.run(
                `INSERT INTO administrators (telegram_id, name, email, phone_number, branches, role) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [123456789, 'Тестовый Администратор', 'admin@artschool.ru', '+79991112233', '["Свиблово", "Чертаново"]', 'superadmin']
            );
            console.log('✅ Тестовый администратор создан');
        }
        
        // Создаем контакты филиалов только если их нет
        if (!(await db.get("SELECT 1 FROM branch_contacts LIMIT 1"))) {
            console.log('🏢 Создание контактов филиалов...');
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
        
        // Создаем тестовых преподавателей если их нет
        if (!hasTeachers) {
            console.log('👩‍🏫 Создание тестовых преподавателей...');
            const teachers = [
                ['Анна Петрова', 'Художник-педагог, 10 лет опыта', 'Рисование, акварель', 10, 'Специалист по работе с детьми 6-12 лет', '["Свиблово"]', '@anna_petrova'],
                ['Иван Сидоров', 'Художник-график, 8 лет опыта', 'Графика, скетчинг', 8, 'Эксперт по современному искусству', '["Чертаново"]', '@ivan_sidorov'],
                ['Мария Иванова', 'Скульптор, 12 лет опыта', 'Скульптура, лепка', 12, 'Специалист по работе с подростками', '["Свиблово", "Чертаново"]', '@maria_ivanova']
            ];
            
            for (const teacher of teachers) {
                await db.run(
                    `INSERT INTO teachers (name, qualification, specialization, experience_years, description, branches, telegram_username) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    teacher
                );
            }
            console.log('✅ Тестовые преподаватели созданы');
        }
        
        // Создаем тестовое расписание если его нет
        if (!hasSchedule) {
            console.log('📅 Создание тестового расписания...');
            const schedule = [
                ['Свиблово', 'вторник', '16:00', '17:30', 1, 'Анна Петрова', 'Рисование для начинающих (6-8 лет)', 'Кабинет 1', 10, 0],
                ['Свиблово', 'четверг', '16:00', '17:30', 1, 'Анна Петрова', 'Рисование для начинающих (6-8 лет)', 'Кабинет 1', 10, 0],
                ['Свиблово', 'суббота', '11:00', '12:30', 3, 'Мария Иванова', 'Скульптура (9-12 лет)', 'Кабинет 2', 8, 0],
                ['Чертаново', 'среда', '17:00', '18:30', 2, 'Иван Сидоров', 'Скетчинг для подростков', 'Кабинет 3', 12, 0],
                ['Чертаново', 'пятница', '17:00', '18:30', 2, 'Иван Сидоров', 'Скетчинг для подростков', 'Кабинет 3', 12, 0]
            ];
            
            for (const item of schedule) {
                await db.run(
                    `INSERT INTO schedule (branch, day_of_week, start_time, end_time, teacher_id, teacher_name, group_name, room_number, max_students, current_students) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    item
                );
            }
            console.log('✅ Тестовое расписание создано');
        }
        
        // Создаем FAQ только если их нет
        if (!(await db.get("SELECT 1 FROM faq LIMIT 1"))) {
            console.log('❓ Создание тестовых FAQ...');
            const faq = [
                ['Как посмотреть информацию об абонементе?', 
                 'Вся информация об абонементе автоматически загружается из amoCRM. Вы можете видеть количество занятий, остаток, срок действия и историю посещений.', 
                 'subscription', 1],
                 
                ['Как обновляются данные из amoCRM?', 
                 'Данные обновляются в реальном времени при каждом входе в приложение. Вы всегда видите актуальную информацию о вашем абонементе и посещениях.', 
                 'technical', 2],
                 
                ['Что делать, если данные отображаются неверно?', 
                 'Свяжитесь с администратором вашего филиала. Данные берутся напрямую из amoCRM, поэтому любые корректировки нужно вносить там.', 
                 'support', 3]
            ];
            
            for (const item of faq) {
                await db.run(
                    `INSERT INTO faq (question, answer, category, display_order) 
                     VALUES (?, ?, ?, ?)`,
                    item
                );
            }
            console.log('✅ Тестовые FAQ созданы');
        }
        
        // Создаем тестовых учеников только если нет реальных данных из amoCRM
        if (!hasStudents && !amoCrmService.isInitialized) {
            console.log('👤 Создание тестовых учеников (ТОЛЬКО ДЛЯ ТЕСТА, если amoCRM не подключен)...');
            const students = [
                [
                    null, 1001, 'Строителева Кира', '', '+79680175895', 'kira@example.com', 'Свиблово',
                    'понедельник', '18:00', 'Саша М', '11-13 лет',
                    'Активный абонемент', 1, 8, 2, 6, '2024-12-31', 1,
                    '2024-02-19', '2023-09-01', 6, 71430, 11905, 2,
                    1, 'Хорошая', '2024-01-10', 'Комикс', 'интересуют занятия по комиксам', '',
                    'Партнеры', 'Телеграм', 1,
                    0, 'test'
                ]
            ];
            
            for (const student of students) {
                await db.run(
                    `INSERT INTO student_profiles 
                     (telegram_user_id, amocrm_contact_id, student_name, parent_name, phone_number, email, branch,
                      day_of_week, time_slot, teacher_name, group_age,
                      subscription_type, subscription_active, total_classes, used_classes, remaining_classes, expiration_date, free_classes_available,
                      last_visit_date, first_purchase_date, purchase_count, total_purchase_amount, average_check, month_classes_count,
                      is_regular, attendance_status, trial_date, trial_type, comment, allergy_info,
                      marketing_channel, communication_channel, telegram_subscribed,
                      is_demo, source) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    student
                );
            }
            console.log('⚠️  Созданы ТЕСТОВЫЕ данные (используются только при отключенном amoCRM)');
        }
        
        console.log('\n✅ Тестовые данные проверены/созданы');
        
    } catch (error) {
        console.error('⚠️  Ошибка создания тестовых данных:', error.message);
    }
};

// ==================== ОСНОВНОЙ API С ПРАВИЛЬНЫМ ПАРСИНГОМ ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        data_source: amoCrmService.isInitialized ? 'Реальные данные из amoCRM' : 'Локальные тестовые данные',
        features: [
            'Полный парсинг полей amoCRM',
            'Автоматическое обновление данных',
            'Информация об абонементах',
            'История посещений',
            'Расписание занятий',
            'Контакты преподавателей'
        ]
    });
});

// Авторизация по номеру телефона - ОБНОВЛЕННАЯ ВЕРСИЯ
app.post('/api/auth/phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`\n🔐 АВТОРИЗАЦИЯ ПО ТЕЛЕФОНУ`);
        console.log(`📞 Получен номер: ${phone}`);
        
        // Очищаем номер телефона
        const cleanPhone = phone.replace(/\D/g, '');
        console.log(`🧹 Очищенный номер: ${cleanPhone}`);
        
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
        
        // Ищем профили через amoCRM сервис
        console.log(`🔍 Поиск профилей в amoCRM...`);
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        // Создаем временного пользователя для сессии
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            first_name: profiles.length > 0 ? profiles[0].student_name?.split(' ')[0] || 'Ученик' : 'Гость',
            last_name: profiles.length > 0 ? profiles[0].student_name?.split(' ')[1] || '' : '',
            is_temp: true
        };
        
        console.log(`👤 Создан временный пользователь: ${tempUser.first_name} ${tempUser.last_name}`);
        
        // Создаем сессию
        const sessionId = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        
        console.log(`🔑 Создание сессии...`);
        
        try {
            await db.run(
                `INSERT INTO user_sessions (session_id, session_data, phone_number, ip_address, user_agent, expires_at, is_active) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    sessionId,
                    JSON.stringify({ user: tempUser, profiles }),
                    formattedPhone,
                    req.ip || '',
                    req.headers['user-agent'] || '',
                    expiresAt.toISOString(),
                    1
                ]
            );
            console.log(`✅ Сессия создана: ${sessionId.substring(0, 10)}...`);
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
        
        console.log(`🎫 JWT токен создан`);
        
        // Сохраняем профили в базу данных
        if (profiles.length > 0) {
            console.log(`💾 Сохранение профилей в БД...`);
            for (const profile of profiles) {
                try {
                    // Проверяем существующий профиль
                    const existingProfile = await db.get(
                        `SELECT id FROM student_profiles 
                         WHERE phone_number = ? AND student_name = ? AND amocrm_contact_id = ?`,
                        [profile.phone_number, profile.student_name, profile.amocrm_contact_id]
                    );
                    
                    if (!existingProfile) {
                        // Вставляем новый профиль
                        await db.run(
                            `INSERT INTO student_profiles 
                             (amocrm_contact_id, student_name, parent_name, phone_number, email, branch,
                              day_of_week, time_slot, teacher_name, group_age,
                              subscription_type, subscription_active, total_classes, used_classes, remaining_classes, 
                              expiration_date, free_classes_available,
                              last_visit_date, first_purchase_date, purchase_count, total_purchase_amount, 
                              average_check, month_classes_count,
                              is_regular, attendance_status, trial_date, trial_type, comment, allergy_info,
                              marketing_channel, communication_channel, telegram_subscribed,
                              custom_fields, raw_contact_data, is_demo, source, is_active) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                profile.amocrm_contact_id || null,
                                profile.student_name,
                                profile.parent_name || '',
                                profile.phone_number,
                                profile.email || '',
                                profile.branch || 'Не указан',
                                profile.day_of_week || '',
                                profile.time_slot || '',
                                profile.teacher_name || '',
                                profile.group_age || '',
                                profile.subscription_type || 'Без абонемента',
                                profile.subscription_active ? 1 : 0,
                                profile.total_classes || 0,
                                profile.used_classes || 0,
                                profile.remaining_classes || 0,
                                profile.expiration_date || null,
                                profile.free_classes_available || 0,
                                profile.last_visit_date || null,
                                profile.first_purchase_date || null,
                                profile.purchase_count || 0,
                                profile.total_purchase_amount || 0,
                                profile.average_check || 0,
                                profile.month_classes_count || 0,
                                profile.is_regular ? 1 : 0,
                                profile.attendance_status || '',
                                profile.trial_date || null,
                                profile.trial_type || '',
                                profile.comment || '',
                                profile.allergy_info || '',
                                profile.marketing_channel || '',
                                profile.communication_channel || '',
                                profile.telegram_subscribed ? 1 : 0,
                                profile.custom_fields || '{}',
                                profile.raw_contact_data || '{}',
                                profile.is_demo || 0,
                                profile.source || 'unknown',
                                1
                            ]
                        );
                        console.log(`✅ Профиль сохранен в БД: ${profile.student_name}`);
                    } else {
                        // Обновляем существующий профиль
                        await db.run(
                            `UPDATE student_profiles SET
                             student_name = ?, phone_number = ?, email = ?, branch = ?,
                             day_of_week = ?, time_slot = ?, teacher_name = ?, group_age = ?,
                             subscription_type = ?, subscription_active = ?, total_classes = ?, used_classes = ?, 
                             remaining_classes = ?, expiration_date = ?, free_classes_available = ?,
                             last_visit_date = ?, first_purchase_date = ?, purchase_count = ?, total_purchase_amount = ?,
                             average_check = ?, month_classes_count = ?,
                             is_regular = ?, attendance_status = ?, trial_date = ?, trial_type = ?, comment = ?, allergy_info = ?,
                             marketing_channel = ?, communication_channel = ?, telegram_subscribed = ?,
                             custom_fields = ?, raw_contact_data = ?, updated_at = CURRENT_TIMESTAMP
                             WHERE id = ?`,
                            [
                                profile.student_name,
                                profile.phone_number,
                                profile.email || '',
                                profile.branch || 'Не указан',
                                profile.day_of_week || '',
                                profile.time_slot || '',
                                profile.teacher_name || '',
                                profile.group_age || '',
                                profile.subscription_type || 'Без абонемента',
                                profile.subscription_active ? 1 : 0,
                                profile.total_classes || 0,
                                profile.used_classes || 0,
                                profile.remaining_classes || 0,
                                profile.expiration_date || null,
                                profile.free_classes_available || 0,
                                profile.last_visit_date || null,
                                profile.first_purchase_date || null,
                                profile.purchase_count || 0,
                                profile.total_purchase_amount || 0,
                                profile.average_check || 0,
                                profile.month_classes_count || 0,
                                profile.is_regular ? 1 : 0,
                                profile.attendance_status || '',
                                profile.trial_date || null,
                                profile.trial_type || '',
                                profile.comment || '',
                                profile.allergy_info || '',
                                profile.marketing_channel || '',
                                profile.communication_channel || '',
                                profile.telegram_subscribed ? 1 : 0,
                                profile.custom_fields || '{}',
                                profile.raw_contact_data || '{}',
                                existingProfile.id
                            ]
                        );
                        console.log(`✅ Профиль обновлен в БД: ${profile.student_name}`);
                    }
                } catch (profileError) {
                    console.error(`❌ Ошибка сохранения профиля ${profile.student_name}: ${profileError.message}`);
                }
            }
            console.log(`💾 Сохранено профилей: ${profiles.length}`);
        }
        
        // Формируем подробный ответ
        const responseData = {
            success: true,
            message: profiles.length > 0 ? 'Авторизация успешна' : 'Профили не найдены',
            data: {
                user: tempUser,
                profiles: profiles.map(p => ({
                    // Основная информация
                    id: p.id,
                    student_name: p.student_name,
                    parent_name: p.parent_name,
                    phone_number: p.phone_number,
                    email: p.email,
                    branch: p.branch,
                    
                    // Расписание
                    day_of_week: p.day_of_week,
                    time_slot: p.time_slot,
                    teacher_name: p.teacher_name,
                    group_age: p.group_age,
                    
                    // Абонемент (главная информация)
                    subscription_type: p.subscription_type,
                    subscription_active: p.subscription_active || false,
                    total_classes: p.total_classes || 0,
                    used_classes: p.used_classes || 0,
                    remaining_classes: p.remaining_classes || 0,
                    expiration_date: p.expiration_date,
                    free_classes_available: p.free_classes_available || 0,
                    
                    // Статистика
                    last_visit_date: p.last_visit_date,
                    purchase_count: p.purchase_count || 0,
                    total_purchase_amount: p.total_purchase_amount || 0,
                    average_check: p.average_check || 0,
                    month_classes_count: p.month_classes_count || 0,
                    
                    // Дополнительная информация
                    is_regular: p.is_regular || false,
                    attendance_status: p.attendance_status,
                    trial_date: p.trial_date,
                    trial_type: p.trial_type,
                    
                    // Техническая информация
                    is_demo: p.is_demo || 0,
                    amocrm_contact_id: p.amocrm_contact_id,
                    source: p.source || 'unknown',
                    created_at: p.created_at
                })),
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                token: token,
                search_details: {
                    phone_used: formattedPhone,
                    search_method: amoCrmService.isInitialized ? 'amoCRM API' : 'Local Database',
                    has_real_data: profiles.some(p => !p.is_demo) || false,
                    crm_status: amoCrmService.isInitialized ? 'connected' : 'disconnected',
                    account_name: amoCrmService.accountInfo?.name || 'Не подключен'
                }
            }
        };
        
        console.log(`✅ Авторизация завершена успешно`);
        console.log(`📊 Результат: ${profiles.length} профилей, amoCRM: ${amoCrmService.isInitialized ? 'подключен' : 'отключен'}`);
        
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Ошибка проверки телефона:', error.message);
        console.error('Stack trace:', error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки телефона',
            details: error.message,
            amocrm_status: amoCrmService.isInitialized ? 'connected' : 'disconnected'
        });
    }
});

// ==================== ДИАГНОСТИЧЕСКИЕ API ====================

// Подробная диагностика amoCRM
app.get('/api/debug/amocrm-detailed', async (req, res) => {
    try {
        const { phone } = req.query;
        
        console.log('\n🔍 ПОДРОБНАЯ ДИАГНОСТИКА AMOCRM');
        console.log('='.repeat(80));
        
        const diagnostics = {
            timestamp: new Date().toISOString(),
            amocrm_status: {
                initialized: amoCrmService.isInitialized,
                domain: AMOCRM_DOMAIN,
                subdomain: AMOCRM_SUBDOMAIN,
                has_access_token: !!amoCrmService.accessToken,
                account_info: amoCrmService.accountInfo ? {
                    name: amoCrmService.accountInfo.name,
                    id: amoCrmService.accountInfo.id,
                    subdomain: amoCrmService.accountInfo.subdomain
                } : null
            },
            field_mapping: Object.keys(amoCrmService.fieldMapping).length,
            cached_fields: amoCrmService.cachedFields?.length || 0
        };
        
        if (phone) {
            console.log(`📞 Телефон для диагностики: ${phone}`);
            diagnostics.search_phone = phone;
            
            if (amoCrmService.isInitialized) {
                try {
                    const profiles = await amoCrmService.getStudentsByPhone(phone);
                    diagnostics.search_results = {
                        profiles_found: profiles.length,
                        sample_profile: profiles.length > 0 ? profiles[0] : null,
                        all_profiles: profiles.map(p => ({
                            student_name: p.student_name,
                            phone: p.phone_number,
                            branch: p.branch,
                            subscription: p.subscription_type,
                            remaining_classes: p.remaining_classes,
                            total_classes: p.total_classes
                        }))
                    };
                } catch (searchError) {
                    diagnostics.search_error = searchError.message;
                }
            }
        }
        
        // Тест поля "Активный абонемент"
        if (amoCrmService.cachedFields) {
            const activeSubscriptionFields = amoCrmService.cachedFields.filter(f => 
                f.name && (f.name.includes('активный абонемент') || 
                          f.name.includes('Активный абонемент') ||
                          f.name.toLowerCase().includes('subscription'))
            );
            
            diagnostics.field_detection = {
                active_subscription_fields: activeSubscriptionFields.map(f => ({
                    id: f.id,
                    name: f.name,
                    type: f.type
                })),
                total_custom_fields: amoCrmService.cachedFields.length
            };
        }
        
        res.json({
            success: true,
            diagnostics: diagnostics
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка диагностики',
            details: error.message
        });
    }
});

// Тестовый парсинг конкретного контакта
app.get('/api/debug/parse-contact', async (req, res) => {
    try {
        const { contact_id } = req.query;
        
        if (!contact_id) {
            return res.status(400).json({
                success: false,
                error: 'Укажите contact_id'
            });
        }
        
        console.log(`\n🔍 ТЕСТОВЫЙ ПАРСИНГ КОНТАКТА ${contact_id}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const contactDetails = await amoCrmService.getContactDetails(contact_id);
        const parsedProfile = await amoCrmService.parseContactToStudentProfile(contactDetails);
        
        // Анализируем кастомные поля
        const fieldAnalysis = {};
        const customFields = contactDetails.custom_fields_values || [];
        
        customFields.forEach(field => {
            const fieldName = amoCrmService.fieldIdToName[field.field_id] || `Field_${field.field_id}`;
            fieldAnalysis[fieldName] = {
                id: field.field_id,
                values: field.values,
                extracted_value: amoCrmService.extractFieldValue(field.values, field.field_type)
            };
        });
        
        res.json({
            success: true,
            data: {
                contact_id: contact_id,
                contact_name: contactDetails.name,
                parsed_profile: parsedProfile,
                field_analysis: fieldAnalysis,
                raw_fields: customFields
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка парсинга контакта:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка парсинга контакта',
            details: error.message
        });
    }
});

// ==================== ОСТАЛЬНЫЕ API (без изменений) ====================

// Расписание
app.post('/api/schedule', async (req, res) => {
    try {
        const { branch, week_start } = req.body;
        
        if (!branch) {
            return res.status(400).json({
                success: false,
                error: 'Укажите филиал'
            });
        }
        
        console.log(`\n📅 ЗАПРОС РАСПИСАНИЯ`);
        console.log(`🏢 Филиал: ${branch}`);
        
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
        
        console.log(`📊 Найдено занятий: ${schedule.length}`);
        
        res.json({
            success: true,
            data: {
                schedule: schedule,
                branch: branch,
                total: schedule.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения расписания:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения расписания'
        });
    }
});

// Абонемент с подробной информацией
app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id, phone } = req.body;
        
        console.log(`\n📋 ЗАПРОС АБОНЕМЕНТА`);
        console.log(`👤 ID профиля: ${profile_id || 'не указан'}`);
        console.log(`📞 Телефон: ${phone || 'не указан'}`);
        
        let profile;
        if (profile_id) {
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE id = ?`,
                [profile_id]
            );
        } else if (phone) {
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE phone_number LIKE ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1`,
                [`%${phone.replace(/\D/g, '').slice(-10)}%`]
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
        console.log(`📊 Абонемент: ${profile.subscription_type}`);
        console.log(`🎫 Занятий: ${profile.remaining_classes}/${profile.total_classes}`);
        
        // История посещений
        const visits = await db.all(
            `SELECT * FROM attendance 
             WHERE student_profile_id = ?
             ORDER BY attendance_date DESC
             LIMIT 20`,
            [profile.id]
        );
        
        console.log(`📊 История посещений: ${visits.length} записей`);
        
        res.json({
            success: true,
            data: {
                subscription: {
                    // Основная информация
                    student_name: profile.student_name,
                    phone_number: profile.phone_number,
                    email: profile.email,
                    branch: profile.branch,
                    
                    // Расписание
                    day_of_week: profile.day_of_week,
                    time_slot: profile.time_slot,
                    teacher_name: profile.teacher_name,
                    group_age: profile.group_age,
                    
                    // Абонемент
                    subscription_type: profile.subscription_type,
                    subscription_active: profile.subscription_active === 1,
                    total_classes: profile.total_classes,
                    used_classes: profile.used_classes,
                    remaining_classes: profile.remaining_classes,
                    expiration_date: profile.expiration_date,
                    free_classes_available: profile.free_classes_available,
                    
                    // Статистика
                    last_visit_date: profile.last_visit_date,
                    purchase_count: profile.purchase_count,
                    total_purchase_amount: profile.total_purchase_amount,
                    average_check: profile.average_check,
                    month_classes_count: profile.month_classes_count,
                    
                    // Дополнительная информация
                    is_regular: profile.is_regular === 1,
                    attendance_status: profile.attendance_status,
                    trial_date: profile.trial_date,
                    trial_type: profile.trial_type,
                    comment: profile.comment,
                    
                    // Техническая информация
                    is_demo: profile.is_demo === 1,
                    source: profile.source,
                    updated_at: profile.updated_at
                },
                visits: visits,
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

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v2.0');
        console.log('='.repeat(80));
        console.log('✨ ОБНОВЛЕННАЯ ВЕРСИЯ С ПРАВИЛЬНЫМ ПАРСИНГОМ AMOCRM');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Инициализируем amoCRM после базы данных
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            console.log(`📊 Аккаунт: ${amoCrmService.accountInfo?.name || 'Не получено'}`);
            console.log(`🗃️  Кешировано полей: ${amoCrmService.cachedFields?.length || 0}`);
            console.log(`🔍 Готов к парсингу: ${Object.keys(amoCrmService.fieldMapping).length} полей настроено`);
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
            console.log(`📊 База данных: SQLite (${db.filename})`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log(`🎭 Режим: ${amoCrmService.isInitialized ? 'Реальные данные из amoCRM' : 'Локальные данные'}`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`⚙️  Админ-панель: http://localhost:${PORT}/admin`);
            console.log(`🔧 Диагностика: http://localhost:${PORT}/debug`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log(`🔍 Подробная диагностика: http://localhost:${PORT}/api/debug/amocrm-detailed?phone=79680175895`);
            console.log('='.repeat(50));
            
            console.log('\n🎯 ОСНОВНЫЕ ФУНКЦИИ:');
            console.log('='.repeat(50));
            console.log('✅ Полный парсинг полей amoCRM');
            console.log('✅ Информация об абонементах');
            console.log('✅ История посещений');
            console.log('✅ Расписание занятий');
            console.log('✅ Контакты преподавателей');
            console.log('='.repeat(50));
            
            console.log('\n📝 ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ:');
            console.log('='.repeat(50));
            console.log(`TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log(`AMOCRM_DOMAIN: ${AMOCRM_DOMAIN || '❌ Не установлен'}`);
            console.log(`AMOCRM_ACCESS_TOKEN: ${AMOCRM_ACCESS_TOKEN ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log('='.repeat(50));
            
            if (!amoCrmService.isInitialized) {
                console.log('\n⚠️  ВНИМАНИЕ: amoCRM не подключен!');
                console.log('='.repeat(50));
                console.log('Для подключения к amoCRM:');
                console.log('1. Установите AMOCRM_DOMAIN в .env файле');
                console.log('2. Установите AMOCRM_ACCESS_TOKEN в .env файле');
                console.log('3. Или перейдите по OAuth ссылке в админ-панели');
                console.log('='.repeat(50));
            }
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
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
};

// Запуск сервера
startServer();
