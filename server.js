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
const AMOCRM_REFRESH_TOKEN = process.env.AMOCRM_REFRESH_TOKEN;

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

// ==================== УЛУЧШЕННЫЙ КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 СОЗДАНИЕ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.oauthUrl = 'https://pismovbanu.amocrm.ru';
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.refreshToken = AMOCRM_REFRESH_TOKEN;
        this.clientId = AMOCRM_CLIENT_ID;
        this.clientSecret = AMOCRM_CLIENT_SECRET;
        this.redirectUri = AMOCRM_REDIRECT_URI;
        this.isInitialized = false;
        this.tokenExpiresAt = 0;
        this.accountInfo = null;
        
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
        console.log(`🔄 Refresh Token: ${this.refreshToken ? '✅ Установлен (' + this.refreshToken.substring(0, 20) + '...)' : '❌ Не установлен'}`);
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
        
        if (!AMOCRM_CLIENT_ID || !AMOCRM_CLIENT_SECRET) {
            console.log('❌ Отсутствуют учетные данные (Client ID или Client Secret)');
            return false;
        }
        
        // 2. Пробуем загрузить токены из базы данных
        try {
            const tokensLoaded = await this.loadTokensFromDatabase();
            if (tokensLoaded) {
                console.log('✅ Токены успешно загружены из базы данных');
                this.isInitialized = true;
                return true;
            }
        } catch (dbError) {
            console.log('⚠️  Не удалось загрузить токены из БД:', dbError.message);
        }
        
        // 3. Если есть access token в .env, проверяем его валидность
        if (this.accessToken) {
            console.log('\n🔍 ПРОВЕРКА ТОКЕНА ИЗ .ENV ФАЙЛА');
            try {
                const isValid = await this.checkTokenValidity(this.accessToken);
                if (isValid) {
                    console.log('✅ Токен из .env валиден');
                    this.isInitialized = true;
                    
                    // Сохраняем токен в БД
                    if (this.refreshToken) {
                        await this.saveTokensToDatabase(this.accessToken, this.refreshToken, Date.now() + 24 * 60 * 60 * 1000);
                    }
                    return true;
                }
            } catch (tokenError) {
                console.log('❌ Токен из .env невалиден:', tokenError.message);
                
                // Если есть refresh token, пробуем обновить
                if (this.refreshToken) {
                    console.log('🔄 Пробуем обновить токен с помощью refresh token...');
                    try {
                        await this.refreshAccessToken();
                        this.isInitialized = true;
                        return true;
                    } catch (refreshError) {
                        console.log('❌ Не удалось обновить токен:', refreshError.message);
                    }
                }
            }
        }
        
        // 4. Если ничего не сработало, показываем инструкцию
        console.log('\n❌ НЕ УДАЛОСЬ ИНИЦИАЛИЗИРОВАТЬ AMOCRM');
        console.log('\n📋 ВАРИАНТЫ РЕШЕНИЯ:');
        console.log('='.repeat(60));
        console.log('1. Получите новый токен через OAuth:');
        console.log(`   Перейдите по ссылке для авторизации:`);
        console.log(`   ${DOMAIN}/oauth/link`);
        console.log('\n2. Или добавьте в .env файл:');
        console.log(`   AMOCRM_ACCESS_TOKEN=ваш_долгосрочный_токен`);
        console.log(`   AMOCRM_REFRESH_TOKEN=ваш_refresh_токен`);
        console.log('='.repeat(60));
        
        this.isInitialized = false;
        return false;
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
                console.log(`   Данные:`, JSON.stringify(error.response.data, null, 2));
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
            const response = await axios.post(`${this.oauthUrl}/oauth2/access_token`, tokenData, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'ArtSchoolBot/1.0'
                },
                timeout: 15000
            });

            const { access_token, refresh_token, expires_in } = response.data;
            
            this.accessToken = access_token;
            this.refreshToken = refresh_token;
            this.tokenExpiresAt = Date.now() + expires_in * 1000;
            
            console.log('✅ ACCESS TOKEN ПОЛУЧЕН УСПЕШНО!');
            console.log(`🔑 Access Token: ${access_token.substring(0, 30)}...`);
            console.log(`🔄 Refresh Token: ${refresh_token.substring(0, 30)}...`);
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
                console.log(`   Заголовки:`, error.response.headers);
            } else if (error.request) {
                console.log(`   Запрос отправлен, но ответ не получен`);
                console.log(`   Ошибка: ${error.message}`);
            } else {
                console.log(`   Ошибка настройки запроса: ${error.message}`);
            }
            throw error;
        }
    }

    async refreshAccessToken() {
        console.log('\n🔄 ОБНОВЛЕНИЕ ACCESS TOKEN');
        
        if (!this.refreshToken) {
            throw new Error('Refresh token отсутствует');
        }

        const tokenData = {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken,
            redirect_uri: this.redirectUri
        };

        console.log('📦 Данные запроса:', {
            client_id: this.clientId,
            client_secret: '***' + this.clientSecret?.slice(-4),
            grant_type: 'refresh_token',
            refresh_token_length: this.refreshToken.length,
            redirect_uri: this.redirectUri
        });

        try {
            const response = await axios.post(`${this.oauthUrl}/oauth2/access_token`, tokenData, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'ArtSchoolBot/1.0'
                },
                timeout: 15000
            });

            const { access_token, refresh_token, expires_in } = response.data;
            
            this.accessToken = access_token;
            this.refreshToken = refresh_token;
            this.tokenExpiresAt = Date.now() + expires_in * 1000;
            
            console.log('✅ ACCESS TOKEN ОБНОВЛЕН УСПЕШНО!');
            console.log(`🔑 Новый Access Token: ${access_token.substring(0, 30)}...`);
            console.log(`🔄 Новый Refresh Token: ${refresh_token.substring(0, 30)}...`);
            console.log(`⏰ Истекает через: ${Math.floor(expires_in / 3600)} часов`);
            console.log(`📅 Новое время истечения: ${new Date(this.tokenExpiresAt).toLocaleString()}`);
            
            // Сохраняем токены в БД
            await this.saveTokensToDatabase(access_token, refresh_token, this.tokenExpiresAt);
            
            return true;
        } catch (error) {
            console.error('❌ ОШИБКА ОБНОВЛЕНИЯ TOKEN:');
            if (error.response) {
                console.log(`   Статус: ${error.response.status}`);
                console.log(`   Данные:`, JSON.stringify(error.response.data, null, 2));
            } else if (error.request) {
                console.log(`   Запрос отправлен, но ответ не получен`);
            } else {
                console.log(`   Ошибка: ${error.message}`);
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
            console.error('Stack trace:', error.stack);
        }
    }

    async loadTokensFromDatabase() {
        try {
            console.log('\n📂 ЗАГРУЗКА ТОКЕНОВ ИЗ БАЗЫ ДАННЫХ');
            
            const tokens = await db.get('SELECT * FROM amocrm_tokens WHERE id = 1');
            
            if (tokens) {
                console.log('✅ Токены найдены в базе данных:');
                console.log(`   Access Token: ${tokens.access_token.substring(0, 30)}...`);
                console.log(`   Refresh Token: ${tokens.refresh_token.substring(0, 30)}...`);
                console.log(`   Истекает: ${new Date(tokens.expires_at).toLocaleString()}`);
                console.log(`   Создано: ${new Date(tokens.created_at).toLocaleString()}`);
                
                const now = Date.now();
                const expiresAt = tokens.expires_at;
                
                // Проверяем не истек ли токен (запас 5 минут)
                if (now < expiresAt - 300000) {
                    console.log('✅ Токен из БД валиден');
                    this.accessToken = tokens.access_token;
                    this.refreshToken = tokens.refresh_token;
                    this.tokenExpiresAt = expiresAt;
                    
                    // Проверяем валидность токена
                    await this.checkTokenValidity(tokens.access_token);
                    return true;
                } else {
                    console.log('🔄 Токен из БД истек или скоро истекает');
                    this.accessToken = tokens.access_token;
                    this.refreshToken = tokens.refresh_token;
                    
                    // Пробуем обновить токен
                    try {
                        await this.refreshAccessToken();
                        return true;
                    } catch (refreshError) {
                        console.log('❌ Не удалось обновить токен из БД:', refreshError.message);
                        return false;
                    }
                }
            } else {
                console.log('📭 Токены в БД не найдены');
                return false;
            }
        } catch (error) {
            console.error('❌ Ошибка загрузки токенов из БД:', error.message);
            console.error('Stack trace:', error.stack);
            return false;
        }
    }

    async makeRequest(method, endpoint, data = null, retry = true) {
        if (!this.isInitialized || !this.accessToken) {
            throw new Error('amoCRM не инициализирован или токен отсутствует');
        }

        // Проверяем не истек ли токен
        const now = Date.now();
        if (now > this.tokenExpiresAt - 300000) { // Запас 5 минут
            console.log('🔄 Токен скоро истекает, обновляем...');
            try {
                await this.refreshAccessToken();
            } catch (refreshError) {
                throw new Error(`Не удалось обновить токен: ${refreshError.message}`);
            }
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
            
            // Логируем структуру ответа
            if (response.data) {
                if (Array.isArray(response.data)) {
                    console.log(`📊 Получено элементов: ${response.data.length}`);
                } else if (response.data._embedded) {
                    const keys = Object.keys(response.data._embedded);
                    console.log(`📊 Вложенные данные: ${keys.join(', ')}`);
                    keys.forEach(key => {
                        const items = response.data._embedded[key];
                        if (Array.isArray(items)) {
                            console.log(`   ${key}: ${items.length} элементов`);
                        }
                    });
                }
            }
            
            return response.data;
            
        } catch (error) {
            console.error(`❌ ОШИБКА ЗАПРОСА К AMOCRM:`);
            console.error(`   URL: ${method} ${url}`);
            
            if (error.response) {
                console.error(`   Статус: ${error.response.status}`);
                console.error(`   Данные ответа:`, JSON.stringify(error.response.data, null, 2));
                
                // Если 401 ошибка и еще не пробовали обновить токен
                if (error.response.status === 401 && retry) {
                    console.log('🔄 Получена 401 ошибка, обновляем токен и повторяем запрос...');
                    try {
                        await this.refreshAccessToken();
                        return await this.makeRequest(method, endpoint, data, false);
                    } catch (refreshError) {
                        console.error('❌ Не удалось обновить токен после 401 ошибки');
                        throw error;
                    }
                }
            } else if (error.request) {
                console.error(`   Запрос отправлен, но ответ не получен`);
                console.error(`   Ошибка сети: ${error.message}`);
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

    async getContactCustomFields() {
        console.log('\n📋 ПОЛУЧЕНИЕ КАСТОМНЫХ ПОЛЕЙ КОНТАКТОВ');
        try {
            const response = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            const fields = response._embedded?.custom_fields || [];
            
            console.log(`✅ Получено кастомных полей: ${fields.length}`);
            
            // Логируем все поля для отладки
            console.log('\n📝 СПИСОК ВСЕХ КАСТОМНЫХ ПОЛЕЙ:');
            console.log('='.repeat(80));
            fields.forEach((field, index) => {
                console.log(`${index + 1}. ${field.name} (ID: ${field.id}, Код: ${field.field_code}, Тип: ${field.type})`);
                if (field.enums) {
                    console.log(`   Варианты: ${Object.values(field.enums).map(e => e.value).join(', ')}`);
                }
            });
            console.log('='.repeat(80));
            
            return fields;
        } catch (error) {
            console.error('❌ Ошибка получения кастомных полей:', error.message);
            return [];
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
        
        // Сначала получаем все кастомные поля для понимания структуры
        const customFields = await this.getContactCustomFields();
        const phoneFieldId = customFields.find(f => 
            f.field_code === 'PHONE' || 
            f.name?.toLowerCase().includes('телефон')
        )?.id;

        console.log(`📊 ID поля телефона: ${phoneFieldId || 'Не найден'}`);
        
        // Ищем по всем вариантам
        for (const phoneVariant of phoneVariants) {
            try {
                console.log(`\n🔍 Поиск по варианту: "${phoneVariant}"`);
                
                // Вариант 1: Поиск через query параметр
                try {
                    const encodedQuery = encodeURIComponent(phoneVariant);
                    const response = await this.makeRequest('GET', `/api/v4/contacts?query=${encodedQuery}&limit=250`);
                    
                    if (response._embedded?.contacts) {
                        const contacts = response._embedded.contacts;
                        console.log(`✅ Найдено контактов через query: ${contacts.length}`);
                        
                        contacts.forEach(contact => {
                            console.log(`   👤 ${contact.name || 'Без имени'} (ID: ${contact.id})`);
                            this.logContactPhones(contact, customFields);
                        });
                        
                        allContacts = [...allContacts, ...contacts];
                    }
                } catch (queryError) {
                    console.log(`⚠️  Ошибка поиска через query: ${queryError.message}`);
                }
                
                // Вариант 2: Поиск через фильтр по телефону (если знаем ID поля)
                if (phoneFieldId) {
                    try {
                        const filterData = {
                            filter: {
                                custom_fields_values: [{
                                    field_id: phoneFieldId,
                                    values: [{ value: phoneVariant }]
                                }]
                            },
                            limit: 250
                        };
                        
                        const response = await this.makeRequest('POST', '/api/v4/contacts/filter', filterData);
                        
                        if (response._embedded?.contacts) {
                            const contacts = response._embedded.contacts;
                            console.log(`✅ Найдено контактов через фильтр: ${contacts.length}`);
                            
                            contacts.forEach(contact => {
                                console.log(`   👤 ${contact.name || 'Без имени'} (ID: ${contact.id})`);
                                this.logContactPhones(contact, customFields);
                            });
                            
                            allContacts = [...allContacts, ...contacts];
                        }
                    } catch (filterError) {
                        console.log(`⚠️  Ошибка поиска через фильтр: ${filterError.message}`);
                    }
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

    logContactPhones(contact, customFields) {
        if (!contact.custom_fields_values) return;
        
        const phoneFields = contact.custom_fields_values.filter(field => {
            const fieldInfo = customFields.find(cf => cf.id === field.field_id);
            return fieldInfo && (
                fieldInfo.field_code === 'PHONE' ||
                fieldInfo.name?.toLowerCase().includes('телефон')
            );
        });
        
        if (phoneFields.length > 0) {
            phoneFields.forEach(field => {
                const fieldInfo = customFields.find(cf => cf.id === field.field_id);
                const phones = field.values?.map(v => v.value).join(', ') || 'нет';
                console.log(`     📞 ${fieldInfo?.name || 'Телефон'}: ${phones}`);
            });
        }
    }

    async getContactDetails(contactId) {
        console.log(`\n🔍 ПОЛУЧЕНИЕ ДЕТАЛЕЙ КОНТАКТА ${contactId}`);
        try {
            const response = await this.makeRequest('GET', `/api/v4/contacts/${contactId}?with=leads,customers,companies`);
            console.log(`✅ Детали контакта получены`);
            
            // Логируем все данные контакта
            console.log('\n📝 ДЕТАЛИ КОНТАКТА:');
            console.log('='.repeat(80));
            console.log(`ID: ${response.id}`);
            console.log(`Имя: ${response.name || 'Не указано'}`);
            console.log(`Дата создания: ${new Date(response.created_at * 1000).toLocaleString()}`);
            console.log(`Ответственный: ${response.responsible_user_id}`);
            
            if (response.custom_fields_values) {
                console.log('\n📋 КАСТОМНЫЕ ПОЛЯ:');
                response.custom_fields_values.forEach(field => {
                    const values = field.values?.map(v => v.value).join(', ') || 'нет значений';
                    console.log(`   ${field.field_name || 'Без имени'} (ID: ${field.field_id}): ${values}`);
                });
            }
            
            if (response._embedded?.leads) {
                console.log(`\n💼 СДЕЛКИ: ${response._embedded.leads.length}`);
                response._embedded.leads.forEach(lead => {
                    console.log(`   ${lead.id}: ${lead.name || 'Без названия'} (Статус: ${lead.status_id})`);
                });
            }
            
            console.log('='.repeat(80));
            
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения деталей контакта: ${error.message}`);
            throw error;
        }
    }

    async getLeadsByContactId(contactId) {
        console.log(`\n🔍 ПОЛУЧЕНИЕ СДЕЛОК КОНТАКТА ${contactId}`);
        try {
            const response = await this.makeRequest('GET', `/api/v4/contacts/${contactId}/leads?limit=100`);
            
            if (response._embedded?.leads) {
                console.log(`✅ Найдено сделок: ${response._embedded.leads.length}`);
                
                response._embedded.leads.forEach(lead => {
                    console.log(`   💼 ${lead.name || 'Без названия'} (ID: ${lead.id})`);
                    console.log(`     Цена: ${lead.price || 0}, Статус: ${lead.status_id}`);
                    console.log(`     Создана: ${new Date(lead.created_at * 1000).toLocaleString()}`);
                });
            } else {
                console.log('📭 Сделки не найдены');
            }
            
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return { _embedded: { leads: [] } };
        }
    }

    async parseContactToStudentProfile(contact) {
        console.log(`\n🔍 ПАРСИНГ КОНТАКТА В ПРОФИЛЬ УЧЕНИКА`);
        console.log(`👤 Контакт: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
        
        const profile = {
            amocrm_contact_id: contact.id,
            student_name: contact.name || 'Не указано',
            parent_name: '',
            phone_number: '',
            email: '',
            branch: 'Не указан',
            subscription_type: 'Без абонемента',
            total_classes: 0,
            remaining_classes: 0,
            expiration_date: null,
            teacher_name: '',
            day_of_week: '',
            time_slot: '',
            custom_fields: contact.custom_fields_values || [],
            raw_contact_data: JSON.stringify(contact, null, 2),
            created_at: contact.created_at ? new Date(contact.created_at * 1000).toISOString() : null,
            updated_at: contact.updated_at ? new Date(contact.updated_at * 1000).toISOString() : null
        };
        
        // Получаем все кастомные поля для правильного парсинга
        const customFields = await this.getContactCustomFields();
        
        // Парсим кастомные поля
        if (contact.custom_fields_values) {
            console.log(`\n📋 ПАРСИНГ КАСТОМНЫХ ПОЛЕЙ:`);
            
            for (const field of contact.custom_fields_values) {
                const fieldInfo = customFields.find(cf => cf.id === field.field_id);
                const fieldName = fieldInfo?.name?.toLowerCase() || '';
                const fieldCode = fieldInfo?.field_code || '';
                const fieldValues = field.values || [];
                
                if (fieldValues.length > 0) {
                    const value = fieldValues[0].value;
                    
                    // Телефоны
                    if (fieldCode === 'PHONE' || fieldName.includes('телефон') || fieldName.includes('phone')) {
                        profile.phone_number = value;
                        console.log(`   📞 Телефон: ${value}`);
                    }
                    
                    // Email
                    else if (fieldCode === 'EMAIL' || fieldName.includes('email') || fieldName.includes('почта')) {
                        profile.email = value;
                        console.log(`   📧 Email: ${value}`);
                    }
                    
                    // Филиал
                    else if (fieldName.includes('филиал') || fieldName.includes('branch') || 
                             fieldName.includes('отделение') || fieldName.includes('локация')) {
                        profile.branch = value;
                        console.log(`   🏢 Филиал: ${value}`);
                    }
                    
                    // Родитель
                    else if (fieldName.includes('родитель') || fieldName.includes('parent') || 
                             fieldName.includes('мама') || fieldName.includes('папа')) {
                        profile.parent_name = value;
                        console.log(`   👨‍👩‍👧‍👦 Родитель: ${value}`);
                    }
                    
                    // Учитель
                    else if (fieldName.includes('преподаватель') || fieldName.includes('учитель') || 
                             fieldName.includes('teacher') || fieldName.includes('тренер')) {
                        profile.teacher_name = value;
                        console.log(`   👩‍🏫 Учитель: ${value}`);
                    }
                    
                    // День недели
                    else if (fieldName.includes('день недели') || fieldName.includes('расписание') ||
                             fieldName.includes('дни занятий')) {
                        profile.day_of_week = value;
                        console.log(`   📅 День недели: ${value}`);
                    }
                    
                    // Время
                    else if (fieldName.includes('время') || fieldName.includes('time') ||
                             fieldName.includes('часы') || (fieldName.includes('начало') && fieldName.includes('занятий'))) {
                        profile.time_slot = value;
                        console.log(`   ⏰ Время: ${value}`);
                    }
                    
                    // Абонемент
                    else if (fieldName.includes('абонемент') || fieldName.includes('курс') ||
                             fieldName.includes('программа') || fieldName.includes('subscription')) {
                        profile.subscription_type = value;
                        console.log(`   📋 Абонемент: ${value}`);
                    }
                    
                    // Количество занятий
                    else if (fieldName.includes('количество занятий') || fieldName.includes('всего занятий') ||
                             fieldName.includes('уроков всего')) {
                        const num = parseInt(value);
                        if (!isNaN(num)) {
                            profile.total_classes = num;
                            console.log(`   🎯 Всего занятий: ${num}`);
                        }
                    }
                    
                    // Осталось занятий
                    else if (fieldName.includes('осталось занятий') || fieldName.includes('остаток') ||
                             fieldName.includes('remaining')) {
                        const num = parseInt(value);
                        if (!isNaN(num)) {
                            profile.remaining_classes = num;
                            console.log(`   📊 Осталось занятий: ${num}`);
                        }
                    }
                    
                    // Дата окончания
                    else if (fieldName.includes('дата окончания') || fieldName.includes('действует до') ||
                             fieldName.includes('expiration')) {
                        profile.expiration_date = value;
                        console.log(`   📅 Дата окончания: ${value}`);
                    }
                }
            }
        }
        
        console.log(`\n✅ ПРОФИЛЬ СОЗДАН:`);
        console.log('='.repeat(50));
        console.log(`   👤 Ученик: ${profile.student_name}`);
        console.log(`   📞 Телефон: ${profile.phone_number}`);
        console.log(`   📧 Email: ${profile.email}`);
        console.log(`   🏢 Филиал: ${profile.branch}`);
        console.log(`   👩‍🏫 Учитель: ${profile.teacher_name}`);
        console.log(`   📅 Расписание: ${profile.day_of_week} ${profile.time_slot}`);
        console.log(`   📋 Абонемент: ${profile.subscription_type}`);
        console.log(`   🎯 Занятий: ${profile.remaining_classes}/${profile.total_classes}`);
        console.log(`   📅 Действует до: ${profile.expiration_date}`);
        console.log('='.repeat(50));
        
        return profile;
    }

    async enrichProfileWithLeads(profile) {
        console.log(`\n🔍 ОБОГАЩЕНИЕ ПРОФИЛЯ ДАННЫМИ ИЗ СДЕЛОК`);
        
        try {
            const leadsResponse = await this.getLeadsByContactId(profile.amocrm_contact_id);
            
            if (leadsResponse._embedded?.leads?.length > 0) {
                // Берем самую последнюю сделку (предполагаем что она активная)
                const lead = leadsResponse._embedded.leads.sort((a, b) => b.created_at - a.created_at)[0];
                console.log(`✅ Найдена сделка: "${lead.name}" (ID: ${lead.id})`);
                
                // Обновляем данные профиля из сделки
                if (lead.name && !profile.subscription_type.includes('Абонемент')) {
                    profile.subscription_type = lead.name;
                }
                
                if (lead.price && lead.price > 0) {
                    profile.total_classes = lead.price;
                    // Если остаток не был определен из кастомных полей, устанавливаем по умолчанию
                    if (profile.remaining_classes === 0) {
                        profile.remaining_classes = Math.floor(lead.price * 0.7);
                    }
                }
                
                // Если есть кастомные поля в сделке, парсим их
                if (lead.custom_fields_values) {
                    console.log(`📋 Кастомные поля сделки:`);
                    for (const field of lead.custom_fields_values) {
                        const fieldName = field.field_name?.toLowerCase() || '';
                        const fieldValues = field.values || [];
                        
                        if (fieldValues.length > 0) {
                            const value = fieldValues[0].value;
                            
                            if (fieldName.includes('осталось') || fieldName.includes('остаток')) {
                                const num = parseInt(value);
                                if (!isNaN(num)) {
                                    profile.remaining_classes = num;
                                    console.log(`     → Осталось занятий: ${num}`);
                                }
                            }
                            else if (fieldName.includes('дата окончания') || fieldName.includes('до')) {
                                profile.expiration_date = value;
                                console.log(`     → Дата окончания: ${value}`);
                            }
                            else if (fieldName.includes('всего занятий') || fieldName.includes('количество')) {
                                const num = parseInt(value);
                                if (!isNaN(num)) {
                                    profile.total_classes = num;
                                    console.log(`     → Всего занятий: ${num}`);
                                }
                            }
                        }
                    }
                }
                
                // Если дата окончания не найдена, устанавливаем по умолчанию
                if (!profile.expiration_date && lead.created_at) {
                    const createdDate = new Date(lead.created_at * 1000);
                    const expirationDate = new Date(createdDate);
                    expirationDate.setMonth(expirationDate.getMonth() + 6); // +6 месяцев
                    profile.expiration_date = expirationDate.toISOString().split('T')[0];
                    console.log(`📅 Установлена дата окончания по умолчанию: ${profile.expiration_date}`);
                }
                
                console.log(`✅ Профиль обогащен данными сделки`);
            } else {
                console.log(`📭 Сделки не найдены для контакта`);
            }
        } catch (error) {
            console.log(`⚠️  Ошибка обогащения профиля: ${error.message}`);
        }
        
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
                        
                        // Обогащаем данными из сделок
                        profile = await this.enrichProfileWithLeads(profile);
                        
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
                console.error('Stack trace:', crmError.stack);
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

    async syncAllData() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ЗАПУСК ПОЛНОЙ СИНХРОНИЗАЦИИ ДАННЫХ');
        console.log('='.repeat(80));
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован, синхронизация невозможна');
            console.log('ℹ️  Сначала подключите amoCRM через OAuth авторизацию');
            return false;
        }
        
        try {
            console.log('\n1️⃣ СИНХРОНИЗАЦИЯ ПРЕПОДАВАТЕЛЕЙ');
            await this.syncTeachersFromAmo();
            
            console.log('\n2️⃣ СИНХРОНИЗАЦИЯ УЧЕНИКОВ');
            await this.syncStudentsFromAmo();
            
            console.log('\n3️⃣ СИНХРОНИЗАЦИЯ АБОНЕМЕНТОВ');
            await this.syncSubscriptionsFromAmo();
            
            console.log('\n✅ ПОЛНАЯ СИНХРОНИЗАЦИЯ ЗАВЕРШЕНА');
            return true;
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации:', error.message);
            console.error('Stack trace:', error.stack);
            return false;
        }
    }

    async syncTeachersFromAmo() {
        console.log('\n🔄 СИНХРОНИЗАЦИЯ ПРЕПОДАВАТЕЛЕЙ ИЗ AMOCRM');
        
        try {
            const response = await this.makeRequest('GET', '/api/v4/users?limit=100');
            const users = response._embedded?.users || [];
            
            console.log(`📊 Найдено пользователей в amoCRM: ${users.length}`);
            
            let syncedCount = 0;
            let updatedCount = 0;
            
            for (const user of users) {
                try {
                    // Проверяем, есть ли уже такой преподаватель
                    const existing = await db.get(
                        'SELECT id FROM teachers WHERE amocrm_user_id = ?',
                        [user.id]
                    );
                    
                    const teacherData = {
                        name: user.name || `Пользователь ${user.id}`,
                        email: user.email || '',
                        phone_number: '',
                        amocrm_user_id: user.id,
                        is_active: user.is_active || 1,
                        created_at: user.created_at ? new Date(user.created_at * 1000).toISOString() : new Date().toISOString()
                    };
                    
                    // Пробуем получить контакт пользователя для получения телефона
                    try {
                        const contactResponse = await this.makeRequest('GET', `/api/v4/users/${user.id}/contacts`);
                        if (contactResponse._embedded?.contacts?.[0]?.custom_fields_values) {
                            const phoneField = contactResponse._embedded.contacts[0].custom_fields_values.find(
                                f => f.field_code === 'PHONE'
                            );
                            if (phoneField?.values?.[0]) {
                                teacherData.phone_number = phoneField.values[0].value;
                            }
                        }
                    } catch (contactError) {
                        // Игнорируем ошибку получения контакта
                    }
                    
                    if (!existing) {
                        await db.run(
                            `INSERT INTO teachers (name, email, phone_number, amocrm_user_id, is_active, created_at) 
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [
                                teacherData.name,
                                teacherData.email,
                                teacherData.phone_number,
                                teacherData.amocrm_user_id,
                                teacherData.is_active,
                                teacherData.created_at
                            ]
                        );
                        console.log(`✅ Добавлен: ${teacherData.name}`);
                        syncedCount++;
                    } else {
                        await db.run(
                            `UPDATE teachers 
                             SET name = ?, email = ?, phone_number = ?, updated_at = CURRENT_TIMESTAMP
                             WHERE amocrm_user_id = ?`,
                            [teacherData.name, teacherData.email, teacherData.phone_number, user.id]
                        );
                        console.log(`🔄 Обновлен: ${teacherData.name}`);
                        updatedCount++;
                    }
                } catch (userError) {
                    console.error(`❌ Ошибка пользователя ${user.id}: ${userError.message}`);
                }
            }
            
            console.log(`📊 ИТОГО: ${syncedCount} добавлено, ${updatedCount} обновлено`);
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации преподавателей:', error.message);
        }
    }

    async syncStudentsFromAmo() {
        console.log('\n🔄 СИНХРОНИЗАЦИЯ УЧЕНИКОВ ИЗ AMOCRM');
        
        try {
            // Получаем все контакты с лимитом 250
            const response = await this.makeRequest('GET', '/api/v4/contacts?limit=250&order[created_at]=desc');
            const contacts = response._embedded?.contacts || [];
            
            console.log(`📊 Контактов для обработки: ${contacts.length}`);
            
            let syncedCount = 0;
            let updatedCount = 0;
            let errorCount = 0;
            
            for (const contact of contacts) {
                try {
                    // Проверяем, есть ли уже такой ученик
                    const existing = await db.get(
                        'SELECT id FROM student_profiles WHERE amocrm_contact_id = ?',
                        [contact.id]
                    );
                    
                    // Парсим контакт в профиль
                    let profile = await this.parseContactToStudentProfile(contact);
                    
                    // Обогащаем данными из сделок
                    profile = await this.enrichProfileWithLeads(profile);
                    
                    if (!existing) {
                        await db.run(
                            `INSERT INTO student_profiles 
                             (amocrm_contact_id, student_name, parent_name, phone_number, email, 
                              branch, subscription_type, total_classes, remaining_classes,
                              expiration_date, teacher_name, day_of_week, time_slot, 
                              amocrm_custom_fields, is_demo, is_active, created_at) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                profile.amocrm_contact_id,
                                profile.student_name,
                                profile.parent_name || '',
                                profile.phone_number || '',
                                profile.email || '',
                                profile.branch || 'Не указан',
                                profile.subscription_type || 'Без абонемента',
                                profile.total_classes || 0,
                                profile.remaining_classes || 0,
                                profile.expiration_date || null,
                                profile.teacher_name || '',
                                profile.day_of_week || '',
                                profile.time_slot || '',
                                JSON.stringify(profile.custom_fields || []),
                                0, // is_demo = 0 (реальные данные)
                                1, // is_active = 1
                                profile.created_at || new Date().toISOString()
                            ]
                        );
                        syncedCount++;
                        if (syncedCount % 10 === 0) {
                            console.log(`   Добавлено: ${syncedCount} профилей`);
                        }
                    } else {
                        await db.run(
                            `UPDATE student_profiles SET
                             student_name = ?, parent_name = ?, phone_number = ?, email = ?,
                             branch = ?, subscription_type = ?, total_classes = ?, remaining_classes = ?,
                             expiration_date = ?, teacher_name = ?, day_of_week = ?, time_slot = ?,
                             amocrm_custom_fields = ?, updated_at = CURRENT_TIMESTAMP
                             WHERE amocrm_contact_id = ?`,
                            [
                                profile.student_name,
                                profile.parent_name || '',
                                profile.phone_number || '',
                                profile.email || '',
                                profile.branch || 'Не указан',
                                profile.subscription_type || 'Без абонемента',
                                profile.total_classes || 0,
                                profile.remaining_classes || 0,
                                profile.expiration_date || null,
                                profile.teacher_name || '',
                                profile.day_of_week || '',
                                profile.time_slot || '',
                                JSON.stringify(profile.custom_fields || []),
                                contact.id
                            ]
                        );
                        updatedCount++;
                    }
                } catch (contactError) {
                    console.error(`❌ Ошибка контакта ${contact.id}: ${contactError.message}`);
                    errorCount++;
                }
            }
            
            console.log(`\n📊 ИТОГО СИНХРОНИЗАЦИИ УЧЕНИКОВ:`);
            console.log(`   ✅ Добавлено: ${syncedCount}`);
            console.log(`   🔄 Обновлено: ${updatedCount}`);
            console.log(`   ❌ Ошибок: ${errorCount}`);
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации учеников:', error.message);
            console.error('Stack trace:', error.stack);
        }
    }

    async syncSubscriptionsFromAmo() {
        console.log('\n🔄 СИНХРОНИЗАЦИЯ АБОНЕМЕНТОВ ИЗ AMOCRM');
        
        try {
            // Получаем активные сделки (статус 142 - предположим что это "Успешно реализовано")
            const response = await this.makeRequest('GET', '/api/v4/leads?filter[statuses][][status_id]=142&limit=100');
            const leads = response._embedded?.leads || [];
            
            console.log(`📊 Найдено активных сделок: ${leads.length}`);
            
            let updatedCount = 0;
            
            for (const lead of leads) {
                try {
                    // Получаем контакты сделки
                    if (lead._embedded?.contacts) {
                        for (const contact of lead._embedded.contacts) {
                            await db.run(
                                `UPDATE student_profiles 
                                 SET subscription_type = ?, total_classes = ?, remaining_classes = ?,
                                     expiration_date = ?, updated_at = CURRENT_TIMESTAMP
                                 WHERE amocrm_contact_id = ?`,
                                [
                                    lead.name || 'Абонемент',
                                    lead.price || 0,
                                    Math.floor((lead.price || 0) * 0.7),
                                    this.calculateLeadExpiration(lead),
                                    contact.id
                                ]
                            );
                            updatedCount++;
                        }
                    }
                } catch (leadError) {
                    console.error(`❌ Ошибка сделки ${lead.id}: ${leadError.message}`);
                }
            }
            
            console.log(`✅ Обновлено абонементов: ${updatedCount}`);
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации абонементов:', error.message);
        }
    }

    calculateLeadExpiration(lead) {
        if (lead.closed_at) {
            return new Date(lead.closed_at * 1000).toISOString().split('T')[0];
        } else if (lead.created_at) {
            const created = new Date(lead.created_at * 1000);
            created.setMonth(created.getMonth() + 6); // +6 месяцев
            return created.toISOString().split('T')[0];
        }
        return null;
    }

    async getLeads(statusId = null) {
        console.log(`\n🔍 ПОЛУЧЕНИЕ СПИСКА СДЕЛОК`);
        
        try {
            let url = '/api/v4/leads?limit=100&order[created_at]=desc';
            if (statusId) {
                url += `&filter[statuses][][status_id]=${statusId}`;
            }
            
            const response = await this.makeRequest('GET', url);
            const leads = response._embedded?.leads || [];
            
            console.log(`📊 Найдено сделок: ${leads.length}`);
            
            // Логируем все сделки для отладки
            leads.forEach(lead => {
                console.log(`   💼 ${lead.id}: "${lead.name}"`);
                console.log(`     Статус: ${lead.status_id}, Цена: ${lead.price || 0}`);
                console.log(`     Создана: ${new Date(lead.created_at * 1000).toLocaleString()}`);
                if (lead._embedded?.contacts) {
                    console.log(`     Контакты: ${lead._embedded.contacts.length}`);
                }
            });
            
            return leads;
        } catch (error) {
            console.error('❌ Ошибка получения сделок:', error.message);
            return [];
        }
    }

    async getUsers() {
        console.log(`\n🔍 ПОЛУЧЕНИЕ СПИСКА ПОЛЬЗОВАТЕЛЕЙ`);
        
        try {
            const response = await this.makeRequest('GET', '/api/v4/users?limit=100');
            const users = response._embedded?.users || [];
            
            console.log(`📊 Найдено пользователей: ${users.length}`);
            
            users.forEach(user => {
                console.log(`   👤 ${user.id}: ${user.name} (${user.email || 'нет email'})`);
                console.log(`     Активен: ${user.is_active ? 'Да' : 'Нет'}`);
            });
            
            return users;
        } catch (error) {
            console.error('❌ Ошибка получения пользователей:', error.message);
            return [];
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
        
        // Создаем директорию для базы данных если её нет
        const dbDir = path.join(__dirname, 'data');
        try {
            await fs.mkdir(dbDir, { recursive: true });
            console.log('📁 Директория данных создана:', dbDir);
        } catch (mkdirError) {
            console.log('📁 Директория данных уже существует');
        }
        
        const dbPath = path.join(dbDir, 'art_school.db');
        console.log(`💾 Путь к базе данных: ${dbPath}`);
        
        // Проверяем существование базы
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
        
        // Настройки SQLite
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
                refresh_token TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица amocrm_tokens создана');

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
        console.log('✅ Таблица telegram_users создана');

        // Профили учеников
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_user_id INTEGER,
                amocrm_contact_id INTEGER UNIQUE,
                student_name TEXT NOT NULL,
                parent_name TEXT,
                phone_number TEXT NOT NULL,
                email TEXT,
                branch TEXT NOT NULL CHECK(branch IN ('Свиблово', 'Чертаново', 'Не указан')),
                subscription_type TEXT,
                total_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                expiration_date DATE,
                teacher_name TEXT,
                day_of_week TEXT,
                time_slot TEXT,
                amocrm_lead_id INTEGER,
                amocrm_custom_fields TEXT,
                is_demo INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                last_selected INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Таблица student_profiles создана');

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
        console.log('✅ Таблица schedule создана');

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
                branches TEXT,
                telegram_username TEXT,
                phone_number TEXT,
                email TEXT,
                amocrm_user_id INTEGER UNIQUE,
                is_active INTEGER DEFAULT 1,
                display_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица teachers создана');

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
                amocrm_task_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                FOREIGN KEY (schedule_id) REFERENCES schedule(id) ON DELETE SET NULL
            )
        `);
        console.log('✅ Таблица attendance создана');

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
        console.log('✅ Таблица faq создана');

        // Новости школы
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

        // Администраторы
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

        // Рассылки
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
        console.log('✅ Таблица branch_contacts создана');

        // Сессии пользователей
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

        // Логи синхронизации
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
        
        // Создаем индексы для ускорения поиска
        await createIndexes();
        
        // Создаем тестовые данные только если таблицы пустые
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
        await db.run('CREATE INDEX IF NOT EXISTS idx_teachers_amocrm_id ON teachers(amocrm_user_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_telegram_users_phone ON telegram_users(phone_number)');
        
        console.log('✅ Индексы созданы');
    } catch (error) {
        console.error('⚠️  Ошибка создания индексов:', error.message);
    }
};

// ==================== ТЕСТОВЫЕ ДАННЫЕ (ТОЛЬКО ЕСЛИ НЕТ РЕАЛЬНЫХ) ====================
const createTestData = async () => {
    try {
        console.log('\n📝 ПРОВЕРКА И СОЗДАНИЕ ТЕСТОВЫХ ДАННЫХ');
        
        // Проверяем, есть ли уже данные
        const hasStudents = await db.get("SELECT 1 FROM student_profiles LIMIT 1");
        const hasTeachers = await db.get("SELECT 1 FROM teachers LIMIT 1");
        const hasAdmins = await db.get("SELECT 1 FROM administrators LIMIT 1");
        
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
        
        // Создаем FAQ только если их нет
        if (!(await db.get("SELECT 1 FROM faq LIMIT 1"))) {
            console.log('❓ Создание тестовых FAQ...');
            const faq = [
                ['Как продлить абонемент?', 
                 'Для продления абонемента свяжитесь с администратором вашего филиала через кнопку "Связаться с администратором" в разделе "Абонемент".', 
                 'subscription', 1],
                 
                ['Что делать, если нужно пропустить занятие?', 
                 'Если вы пропускаете занятие по уважительной причине, сообщите об этом администратору за 24 часа. В некоторых случаях возможно перенести занятие.', 
                 'attendance', 2]
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
        
        // Преподаватели и ученики будут загружены из amoCRM при синхронизации
        
        console.log('\n✅ Тестовые данные проверены/созданы');
        
    } catch (error) {
        console.error('⚠️  Ошибка создания тестовых данных:', error.message);
    }
};

// ==================== TELEGRAM БОТ КОМАНДЫ ====================
const WEB_APP_URL = DOMAIN.replace('https://', '').replace('http://', '');

bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const firstName = ctx.from.first_name || '';
    const lastName = ctx.from.last_name || '';
    const username = ctx.from.username || '';
    
    try {
        // Сохраняем пользователя
        const existingUser = await db.get(
            'SELECT * FROM telegram_users WHERE telegram_id = ?',
            [telegramId]
        );
        
        if (!existingUser) {
            await db.run(
                `INSERT INTO telegram_users (telegram_id, first_name, last_name, username) 
                 VALUES (?, ?, ?, ?)`,
                [telegramId, firstName, lastName, username]
            );
            console.log(`👤 Новый пользователь Telegram: ${firstName} ${lastName} (@${username})`);
        } else {
            await db.run(
                `UPDATE telegram_users 
                 SET first_name = ?, last_name = ?, username = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE telegram_id = ?`,
                [firstName, lastName, username, telegramId]
            );
        }
    } catch (error) {
        console.error('❌ Ошибка сохранения пользователя Telegram:', error);
    }
    
    await ctx.replyWithHTML(
        `🎨 <b>Добро пожаловать в художественную студию!</b>\n\n` +
        `Для доступа к вашему расписанию, абонементу и другим функциям перейдите в наше веб-приложение:`,
        Markup.inlineKeyboard([
            Markup.button.webApp(
                '🚀 Открыть приложение',
                `https://${WEB_APP_URL}`
            )
        ])
    );
});

bot.command('app', async (ctx) => {
    await ctx.replyWithHTML(
        `🎨 <b>Откройте приложение художественной студии</b>\n\n` +
        `Перейдите по кнопке ниже, чтобы получить доступ ко всем функциям:`,
        Markup.inlineKeyboard([
            Markup.button.webApp(
                '🚀 Открыть приложение',
                `https://${WEB_APP_URL}`
            )
        ])
    );
});

bot.command('help', async (ctx) => {
    await ctx.replyWithHTML(
        `🎨 <b>Помощь по боту художественной студии</b>\n\n` +
        `<b>Основные команды:</b>\n` +
        `/start - Начать работу с ботом\n` +
        `/app - Открыть веб-приложение\n` +
        `/help - Эта справка\n\n` +
        `<b>Как использовать:</b>\n` +
        `1. Нажмите /start для начала работы\n` +
        `2. Нажмите кнопку "Открыть приложение"\n` +
        `3. В приложении авторизуйтесь через Telegram\n` +
        `4. Используйте все функции личного кабинета\n\n` +
        `<b>Техническая поддержка:</b>\n` +
        `Если у вас возникли проблемы, напишите администратору в приложении`
    );
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    
    if (text.startsWith('/')) {
        return;
    }
    
    await ctx.replyWithHTML(
        `🎨 Для работы с функциями художественной студии используйте наше веб-приложение:`,
        Markup.inlineKeyboard([
            Markup.button.webApp(
                '🚀 Открыть приложение',
                `https://${WEB_APP_URL}`
            )
        ])
    );
});

// Webhook для Telegram
app.post('/webhook', (req, res) => {
    bot.handleUpdate(req.body, res);
});

// ==================== RATE LIMITING ====================
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Слишком много запросов с вашего IP, пожалуйста, попробуйте позже'
});
app.use('/api/', limiter);

// ==================== API ДЛЯ РАБОТЫ С AMOCRM ====================

// Статус amoCRM
app.get('/api/amocrm/status', async (req, res) => {
    try {
        const status = {
            is_initialized: amoCrmService.isInitialized,
            domain: AMOCRM_DOMAIN,
            subdomain: AMOCRM_SUBDOMAIN,
            client_id: !!AMOCRM_CLIENT_ID,
            access_token: !!amoCrmService.accessToken,
            refresh_token: !!amoCrmService.refreshToken,
            account_info: amoCrmService.accountInfo,
            base_url: amoCrmService.baseUrl,
            token_expires_at: amoCrmService.tokenExpiresAt ? 
                new Date(amoCrmService.tokenExpiresAt).toLocaleString() : 'Не установлено',
            timestamp: new Date().toISOString()
        };
        
        console.log('📊 Статус amoCRM запрошен:', {
            is_initialized: status.is_initialized,
            domain: status.domain,
            has_access_token: status.access_token
        });
        
        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('❌ Ошибка статуса amoCRM:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статуса amoCRM',
            details: error.message
        });
    }
});

// Диагностика amoCRM
app.get('/api/debug/amocrm-contacts', async (req, res) => {
    try {
        const { phone, limit = 10 } = req.query;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона для поиска',
                example: '/api/debug/amocrm-contacts?phone=79991234567'
            });
        }
        
        console.log(`\n🔍 ДИАГНОСТИКА AMOCRM ЗАПРОШЕНА`);
        console.log(`📞 Телефон для поиска: ${phone}`);
        console.log(`🔧 Статус amoCRM: ${amoCrmService.isInitialized ? '✅ Инициализирован' : '❌ Не инициализирован'}`);
        
        const diagnostics = {
            search_phone: phone,
            timestamp: new Date().toISOString(),
            amocrm_status: {
                initialized: amoCrmService.isInitialized,
                domain: AMOCRM_DOMAIN,
                has_access_token: !!amoCrmService.accessToken,
                has_refresh_token: !!amoCrmService.refreshToken,
                base_url: amoCrmService.baseUrl,
                account_info: amoCrmService.accountInfo
            }
        };
        
        if (!amoCrmService.isInitialized) {
            diagnostics.error = 'amoCRM не инициализирован';
            diagnostics.suggestions = [
                'Проверьте AMOCRM_DOMAIN в .env файле',
                'Проверьте AMOCRM_CLIENT_ID и AMOCRM_CLIENT_SECRET',
                'Получите доступ через OAuth авторизацию'
            ];
            
            // Показываем ссылку для авторизации
            if (AMOCRM_CLIENT_ID) {
                diagnostics.oauth_url = `${DOMAIN}/oauth/link`;
            }
            
            return res.json({
                success: false,
                diagnostics,
                error: 'amoCRM не инициализирован'
            });
        }
        
        try {
            // 1. Получаем информацию об аккаунте
            console.log(`\n📊 ТЕСТ 1: Информация об аккаунте`);
            let accountInfo;
            try {
                accountInfo = await amoCrmService.getAccountInfo();
                diagnostics.account_info = {
                    id: accountInfo.id,
                    name: accountInfo.name,
                    subdomain: accountInfo.subdomain,
                    created_at: accountInfo.created_at,
                    timezone: accountInfo.timezone
                };
                console.log(`✅ Аккаунт: ${accountInfo.name} (${accountInfo.subdomain})`);
            } catch (accountError) {
                diagnostics.account_error = accountError.message;
                console.log(`❌ Ошибка получения аккаунта: ${accountError.message}`);
            }
            
            // 2. Получаем кастомные поля
            console.log(`\n📊 ТЕСТ 2: Кастомные поля контактов`);
            let customFields;
            try {
                customFields = await amoCrmService.getContactCustomFields();
                diagnostics.custom_fields = {
                    count: customFields.length,
                    sample: customFields.slice(0, 10).map(f => ({
                        id: f.id,
                        name: f.name,
                        code: f.field_code,
                        type: f.type
                    }))
                };
                console.log(`✅ Кастомных полей: ${customFields.length}`);
            } catch (fieldsError) {
                diagnostics.fields_error = fieldsError.message;
                console.log(`❌ Ошибка получения полей: ${fieldsError.message}`);
            }
            
            // 3. Поиск контактов по телефону
            console.log(`\n📊 ТЕСТ 3: Поиск контактов`);
            let searchResults;
            try {
                searchResults = await amoCrmService.searchContactsByPhone(phone);
                const contacts = searchResults._embedded?.contacts || [];
                diagnostics.search_results = {
                    contacts_found: contacts.length,
                    contacts: contacts.slice(0, 5).map(c => ({
                        id: c.id,
                        name: c.name,
                        created_at: c.created_at ? new Date(c.created_at * 1000).toISOString() : null,
                        updated_at: c.updated_at ? new Date(c.updated_at * 1000).toISOString() : null,
                        custom_fields_count: c.custom_fields_values?.length || 0
                    }))
                };
                console.log(`✅ Найдено контактов: ${contacts.length}`);
                
                // Если есть контакты, получаем детали первого
                if (contacts.length > 0) {
                    console.log(`\n📊 ТЕСТ 4: Детали контакта ${contacts[0].id}`);
                    try {
                        const contactDetails = await amoCrmService.getContactDetails(contacts[0].id);
                        diagnostics.contact_details = {
                            id: contactDetails.id,
                            name: contactDetails.name,
                            all_fields: contactDetails.custom_fields_values?.map(f => ({
                                field_id: f.field_id,
                                values: f.values?.map(v => ({ value: v.value, enum_id: v.enum_id })) || []
                            })) || []
                        };
                        console.log(`✅ Детали контакта получены`);
                    } catch (detailsError) {
                        diagnostics.details_error = detailsError.message;
                        console.log(`❌ Ошибка деталей контакта: ${detailsError.message}`);
                    }
                }
            } catch (searchError) {
                diagnostics.search_error = searchError.message;
                console.log(`❌ Ошибка поиска: ${searchError.message}`);
            }
            
            // 4. Тест получения сделок
            console.log(`\n📊 ТЕСТ 5: Получение сделок`);
            try {
                const leads = await amoCrmService.getLeads();
                diagnostics.leads = {
                    count: leads.length,
                    sample: leads.slice(0, 5).map(l => ({
                        id: l.id,
                        name: l.name,
                        status_id: l.status_id,
                        price: l.price,
                        created_at: new Date(l.created_at * 1000).toISOString()
                    }))
                };
                console.log(`✅ Сделок получено: ${leads.length}`);
            } catch (leadsError) {
                diagnostics.leads_error = leadsError.message;
                console.log(`❌ Ошибка получения сделок: ${leadsError.message}`);
            }
            
            // 5. Тест получения пользователей
            console.log(`\n📊 ТЕСТ 6: Получение пользователей`);
            try {
                const users = await amoCrmService.getUsers();
                diagnostics.users = {
                    count: users.length,
                    sample: users.slice(0, 5).map(u => ({
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        is_active: u.is_active
                    }))
                };
                console.log(`✅ Пользователей получено: ${users.length}`);
            } catch (usersError) {
                diagnostics.users_error = usersError.message;
                console.log(`❌ Ошибка получения пользователей: ${usersError.message}`);
            }
            
            res.json({
                success: true,
                diagnostics,
                summary: {
                    amocrm_contacts_found: diagnostics.search_results?.contacts_found || 0,
                    custom_fields_count: diagnostics.custom_fields?.count || 0,
                    leads_count: diagnostics.leads?.count || 0,
                    users_count: diagnostics.users?.count || 0,
                    account_name: diagnostics.account_info?.name || 'Не получено'
                }
            });
            
        } catch (apiError) {
            diagnostics.api_error = {
                message: apiError.message,
                status: apiError.response?.status,
                data: apiError.response?.data
            };
            
            console.error(`❌ Общая ошибка диагностики: ${apiError.message}`);
            
            res.status(500).json({
                success: false,
                diagnostics,
                error: 'Ошибка при диагностике amoCRM'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка диагностики',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Комплексный тест amoCRM
app.get('/api/debug/amocrm-test', async (req, res) => {
    try {
        console.log('\n🧪 КОМПЛЕКСНЫЙ ТЕСТ AMOCRM');
        console.log('='.repeat(80));
        
        const tests = [];
        
        // Тест 1: Проверка инициализации
        tests.push({
            name: 'Проверка инициализации',
            success: amoCrmService.isInitialized,
            data: {
                is_initialized: amoCrmService.isInitialized,
                domain: AMOCRM_DOMAIN,
                subdomain: AMOCRM_SUBDOMAIN,
                has_access_token: !!amoCrmService.accessToken,
                has_refresh_token: !!amoCrmService.refreshToken,
                base_url: amoCrmService.baseUrl
            }
        });
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                tests: tests,
                error: 'amoCRM не инициализирован',
                required_variables: {
                    AMOCRM_DOMAIN: AMOCRM_DOMAIN || '❌ Не установлен',
                    AMOCRM_CLIENT_ID: AMOCRM_CLIENT_ID ? '✅ Установлен' : '❌ Не установлен',
                    AMOCRM_CLIENT_SECRET: AMOCRM_CLIENT_SECRET ? '✅ Установлен' : '❌ Не установлен',
                    AMOCRM_ACCESS_TOKEN: AMOCRM_ACCESS_TOKEN ? '✅ Установлен (' + AMOCRM_ACCESS_TOKEN.substring(0, 20) + '...)' : '❌ Не установлен',
                },
                solution: `Перейдите по ссылке для OAuth авторизации: ${DOMAIN}/oauth/link`
            });
        }
        
        // Тест 2: Получение информации об аккаунте
        try {
            const accountInfo = await amoCrmService.getAccountInfo();
            tests.push({
                name: 'Получение информации об аккаунте',
                success: true,
                data: {
                    account_id: accountInfo.id,
                    account_name: accountInfo.name,
                    subdomain: accountInfo.subdomain,
                    timezone: accountInfo.timezone,
                    created_at: new Date(accountInfo.created_at * 1000).toLocaleString()
                }
            });
        } catch (error) {
            tests.push({
                name: 'Получение информации об аккаунте',
                success: false,
                error: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
        }
        
        // Тест 3: Получение кастомных полей контактов
        try {
            const customFields = await amoCrmService.getContactCustomFields();
            tests.push({
                name: 'Получение кастомных полей контактов',
                success: true,
                data: {
                    fields_count: customFields.length,
                    phone_fields: customFields.filter(f => 
                        f.field_code === 'PHONE' || 
                        f.name?.toLowerCase().includes('телефон')).map(f => ({ id: f.id, name: f.name })),
                    email_fields: customFields.filter(f => 
                        f.field_code === 'EMAIL').map(f => ({ id: f.id, name: f.name })),
                    sample_fields: customFields.slice(0, 5).map(f => ({
                        id: f.id,
                        name: f.name,
                        code: f.field_code,
                        type: f.type
                    }))
                }
            });
        } catch (error) {
            tests.push({
                name: 'Получение кастомных полей контактов',
                success: false,
                error: error.message
            });
        }
        
        // Тест 4: Тестовый поиск контакта
        try {
            const testPhone = '79991234567';
            const searchResults = await amoCrmService.searchContactsByPhone(testPhone);
            const contacts = searchResults._embedded?.contacts || [];
            tests.push({
                name: 'Тестовый поиск контакта',
                success: true,
                data: {
                    search_phone: testPhone,
                    contacts_found: contacts.length,
                    sample_contact: contacts.length > 0 ? {
                        id: contacts[0].id,
                        name: contacts[0].name,
                        created_at: contacts[0].created_at ? new Date(contacts[0].created_at * 1000).toLocaleString() : null
                    } : null
                }
            });
        } catch (error) {
            tests.push({
                name: 'Тестовый поиск контакта',
                success: false,
                error: error.message
            });
        }
        
        // Тест 5: Получение списка сделок
        try {
            const leads = await amoCrmService.getLeads();
            tests.push({
                name: 'Получение списка сделок',
                success: true,
                data: {
                    leads_count: leads.length,
                    sample_leads: leads.slice(0, 3).map(l => ({
                        id: l.id,
                        name: l.name,
                        status_id: l.status_id,
                        price: l.price
                    }))
                }
            });
        } catch (error) {
            tests.push({
                name: 'Получение списка сделок',
                success: false,
                error: error.message
            });
        }
        
        // Тест 6: Получение списка пользователей
        try {
            const users = await amoCrmService.getUsers();
            tests.push({
                name: 'Получение списка пользователей',
                success: true,
                data: {
                    users_count: users.length,
                    sample_users: users.slice(0, 3).map(u => ({
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        is_active: u.is_active
                    }))
                }
            });
        } catch (error) {
            tests.push({
                name: 'Получение списка пользователей',
                success: false,
                error: error.message
            });
        }
        
        // Тест 7: Проверка работы с БД
        try {
            const studentsCount = await db.get('SELECT COUNT(*) as count FROM student_profiles');
            const teachersCount = await db.get('SELECT COUNT(*) as count FROM teachers');
            tests.push({
                name: 'Проверка локальной базы данных',
                success: true,
                data: {
                    student_profiles_count: studentsCount.count,
                    teachers_count: teachersCount.count,
                    database_file: db.filename
                }
            });
        } catch (error) {
            tests.push({
                name: 'Проверка локальной базы данных',
                success: false,
                error: error.message
            });
        }
        
        const summary = {
            total_tests: tests.length,
            passed_tests: tests.filter(t => t.success).length,
            failed_tests: tests.filter(t => !t.success).length,
            success_rate: Math.round((tests.filter(t => t.success).length / tests.length) * 100)
        };
        
        console.log(`📊 ИТОГИ ТЕСТА: ${summary.passed_tests}/${summary.total_tests} успешно (${summary.success_rate}%)`);
        console.log('='.repeat(80));
        
        res.json({
            success: summary.passed_tests > 0,
            tests: tests,
            summary: summary,
            recommendations: tests.filter(t => !t.success).map(t => 
                `• ${t.name}: ${t.error || 'Неизвестная ошибка'}`
            )
        });
        
    } catch (error) {
        console.error('❌ Ошибка комплексного теста:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка комплексного тестирования amoCRM',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Синхронизация данных
app.post('/api/amocrm/sync', async (req, res) => {
    try {
        const { sync_type } = req.body;
        
        console.log(`\n🔄 ЗАПРОС СИНХРОНИЗАЦИИ: ${sync_type || 'all'}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(400).json({
                success: false,
                error: 'amoCRM не инициализирован',
                message: 'Сначала подключите amoCRM через OAuth авторизацию'
            });
        }
        
        let result;
        let message;
        
        switch (sync_type) {
            case 'teachers':
                result = await amoCrmService.syncTeachersFromAmo();
                message = 'Преподаватели синхронизированы';
                break;
            case 'students':
                result = await amoCrmService.syncStudentsFromAmo();
                message = 'Ученики синхронизированы';
                break;
            case 'subscriptions':
                result = await amoCrmService.syncSubscriptionsFromAmo();
                message = 'Абонементы синхронизированы';
                break;
            case 'all':
            default:
                result = await amoCrmService.syncAllData();
                message = 'Полная синхронизация завершена';
                break;
        }
        
        res.json({
            success: true,
            message: message,
            sync_type: sync_type || 'all',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Ошибка синхронизации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка синхронизации с amoCRM',
            details: error.message
        });
    }
});

// Получение ссылки для OAuth авторизации
app.get('/api/amocrm/oauth-link', (req, res) => {
    try {
        if (!AMOCRM_CLIENT_ID) {
            return res.status(400).json({
                success: false,
                error: 'AMOCRM_CLIENT_ID не установлен'
            });
        }
        
        const authUrl = `https://www.amocrm.ru/oauth?client_id=${AMOCRM_CLIENT_ID}&state=art_school`;
        
        res.json({
            success: true,
            data: {
                oauth_url: authUrl,
                redirect_uri: AMOCRM_REDIRECT_URI,
                instructions: 'Перейдите по ссылке, авторизуйтесь в amoCRM и скопируйте код авторизации'
            }
        });
    } catch (error) {
        console.error('❌ Ошибка получения OAuth ссылки:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения ссылки для авторизации'
        });
    }
});

// ==================== ОСНОВНОЙ API ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        endpoints: {
            status: '/api/status',
            amocrm_status: '/api/amocrm/status',
            debug_contacts: '/api/debug/amocrm-contacts?phone=79991234567',
            debug_test: '/api/debug/amocrm-test',
            auth_phone: 'POST /api/auth/phone',
            teachers: '/api/teachers',
            schedule: 'POST /api/schedule',
            oauth_link: '/api/amocrm/oauth-link',
            sync: 'POST /api/amocrm/sync'
        }
    });
});

// Middleware для проверки JWT токена
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Токен не предоставлен'
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Проверяем сессию в базе (если есть session_id)
        if (decoded.session_id) {
            const session = await db.get(
                'SELECT * FROM user_sessions WHERE session_id = ? AND expires_at > ?',
                [decoded.session_id, new Date().toISOString()]
            );
            
            if (!session) {
                return res.status(401).json({
                    success: false,
                    error: 'Сессия истекла'
                });
            }
        }
        
        req.user = decoded;
        next();
        
    } catch (error) {
        console.error('Ошибка аутентификации токена:', error.message);
        return res.status(401).json({
            success: false,
            error: 'Неверный токен'
        });
    }
};

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
        
        console.log(`\n🔐 АВТОРИЗАЦИЯ TELEGRAM`);
        console.log(`👤 Пользователь: ${first_name} ${last_name} (@${username})`);
        console.log(`📞 Телефон: ${phone}`);
        console.log(`🆔 Telegram ID: ${telegram_id}`);
        
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
            console.log(`✅ Новый пользователь создан: ID ${telegramUser.id}`);
        } else {
            // Обновляем существующего пользователя
            await db.run(
                `UPDATE telegram_users 
                 SET phone_number = ?, first_name = ?, last_name = ?, username = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [phone, first_name || '', last_name || '', username || '', telegramUser.id]
            );
            console.log(`🔄 Пользователь обновлен: ID ${telegramUser.id}`);
        }
        
        // Ищем профили по телефону
        console.log(`🔍 Поиск профилей по телефону...`);
        const profiles = await amoCrmService.getStudentsByPhone(phone);
        
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        // Сохраняем профили в базу
        if (profiles.length > 0) {
            for (const profile of profiles) {
                try {
                    // Проверяем существующий профиль
                    const existingProfile = await db.get(
                        `SELECT * FROM student_profiles 
                         WHERE phone_number = ? AND student_name = ?`,
                        [profile.phone_number, profile.student_name]
                    );
                    
                    if (!existingProfile) {
                        await db.run(
                            `INSERT INTO student_profiles 
                             (telegram_user_id, amocrm_contact_id, student_name, parent_name, phone_number, 
                              email, branch, subscription_type, total_classes, remaining_classes, 
                              expiration_date, teacher_name, day_of_week, time_slot, amocrm_custom_fields, is_demo) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                telegramUser.id,
                                profile.amocrm_contact_id || null,
                                profile.student_name,
                                profile.parent_name || '',
                                profile.phone_number,
                                profile.email || '',
                                profile.branch || 'Не указан',
                                profile.subscription_type || 'Без абонемента',
                                profile.total_classes || 0,
                                profile.remaining_classes || 0,
                                profile.expiration_date || null,
                                profile.teacher_name || '',
                                profile.day_of_week || '',
                                profile.time_slot || '',
                                JSON.stringify(profile.custom_fields || []),
                                profile.is_demo || 0
                            ]
                        );
                        console.log(`✅ Профиль сохранен: ${profile.student_name}`);
                    }
                } catch (profileError) {
                    console.error(`❌ Ошибка сохранения профиля: ${profileError.message}`);
                }
            }
        }
        
        // Если есть профили, устанавливаем первый как выбранный
        if (profiles.length > 0) {
            const firstProfile = profiles[0];
            const profileInDb = await db.get(
                'SELECT id FROM student_profiles WHERE phone_number = ? AND student_name = ?',
                [firstProfile.phone_number, firstProfile.student_name]
            );
            
            if (profileInDb) {
                await db.run(
                    'UPDATE student_profiles SET last_selected = 0 WHERE telegram_user_id = ?',
                    [telegramUser.id]
                );
                
                await db.run(
                    'UPDATE student_profiles SET last_selected = 1 WHERE id = ?',
                    [profileInDb.id]
                );
                console.log(`⭐ Профиль выбран: ${firstProfile.student_name}`);
            }
        }
        
        // Создаем JWT токен
        const token = jwt.sign(
            {
                id: telegramUser.id,
                telegram_id: telegramUser.telegram_id,
                phone: telegramUser.phone_number,
                is_telegram_auth: true,
                profiles_count: profiles.length
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        console.log(`🔑 JWT токен создан`);
        
        const responseData = {
            success: true,
            message: profiles.length > 0 ? 'Авторизация успешна' : 'Профили не найдены',
            data: {
                user: {
                    id: telegramUser.id,
                    telegram_id: telegramUser.telegram_id,
                    phone_number: telegramUser.phone_number,
                    first_name: telegramUser.first_name,
                    last_name: telegramUser.last_name,
                    username: telegramUser.username
                },
                profiles: profiles.map(p => ({
                    student_name: p.student_name,
                    parent_name: p.parent_name,
                    phone_number: p.phone_number,
                    branch: p.branch,
                    subscription_type: p.subscription_type,
                    total_classes: p.total_classes,
                    remaining_classes: p.remaining_classes,
                    expiration_date: p.expiration_date,
                    teacher_name: p.teacher_name,
                    day_of_week: p.day_of_week,
                    time_slot: p.time_slot,
                    is_demo: p.is_demo || 0
                })),
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                token: token
            }
        };
        
        console.log(`✅ Авторизация завершена успешно`);
        
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Ошибка авторизации через Telegram:', error.message);
        console.error('Stack trace:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Ошибка авторизации через Telegram',
            details: error.message
        });
    }
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
        
        // Ищем профили через amoCRM сервис
        console.log(`🔍 Поиск профилей...`);
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
            // Продолжаем без сессии в базе
        }
        
        // Создаем JWT токен
        const token = jwt.sign(
            {
                session_id: sessionId,
                phone: formattedPhone,
                is_temp: true,
                profiles_count: profiles.length
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        console.log(`🎫 JWT токен создан`);
        
        // Формируем ответ
        const responseData = {
            success: true,
            message: profiles.length > 0 ? 'Авторизация успешна' : 'Профили не найдены',
            data: {
                user: tempUser,
                profiles: profiles.map(p => ({
                    student_name: p.student_name,
                    parent_name: p.parent_name,
                    phone_number: p.phone_number,
                    email: p.email,
                    branch: p.branch,
                    subscription_type: p.subscription_type,
                    total_classes: p.total_classes,
                    remaining_classes: p.remaining_classes,
                    expiration_date: p.expiration_date,
                    teacher_name: p.teacher_name,
                    day_of_week: p.day_of_week,
                    time_slot: p.time_slot,
                    is_demo: p.is_demo || 0,
                    amocrm_contact_id: p.amocrm_contact_id,
                    source: p.source || 'unknown'
                })),
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                token: token,
                search_details: {
                    phone_used: formattedPhone,
                    search_method: amoCrmService.isInitialized ? 'amoCRM API' : 'Local Database',
                    has_real_data: profiles.some(p => !p.is_demo) || false,
                    crm_status: amoCrmService.isInitialized ? 'connected' : 'disconnected'
                }
            }
        };
        
        console.log(`✅ Авторизация завершена успешно`);
        console.log(`📤 Отправка ответа...`);
        
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Ошибка проверки телефона:', error.message);
        console.error('Stack trace:', error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки телефона',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

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

// Абонемент
app.post('/api/subscription', authenticateToken, async (req, res) => {
    try {
        const { profile_id } = req.body;
        
        if (!profile_id && !req.user.phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите ID профиля или номер телефона'
            });
        }
        
        console.log(`\n📋 ЗАПРОС АБОНЕМЕНТА`);
        console.log(`👤 ID профиля: ${profile_id || 'не указан'}`);
        console.log(`📞 Телефон пользователя: ${req.user.phone || 'не указан'}`);
        
        let profile;
        if (profile_id) {
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE id = ?`,
                [profile_id]
            );
        } else if (req.user.phone) {
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE phone_number = ? AND is_active = 1 LIMIT 1`,
                [req.user.phone]
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
                    student_name: profile.student_name,
                    parent_name: profile.parent_name,
                    phone_number: profile.phone_number,
                    email: profile.email,
                    branch: profile.branch,
                    subscription_type: profile.subscription_type,
                    total_classes: profile.total_classes,
                    remaining_classes: profile.remaining_classes,
                    expiration_date: profile.expiration_date,
                    teacher_name: profile.teacher_name,
                    day_of_week: profile.day_of_week,
                    time_slot: profile.time_slot,
                    is_demo: profile.is_demo || 0
                },
                visits: visits,
                amocrm_connected: amoCrmService.isInitialized
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

// Преподаватели
app.get('/api/teachers', async (req, res) => {
    try {
        const { branch } = req.query;
        
        console.log(`\n👩‍🏫 ЗАПРОС ПРЕПОДАВАТЕЛЕЙ`);
        console.log(`🏢 Филиал: ${branch || 'все'}`);
        
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
        
        console.log(`📊 Найдено преподавателей: ${teachers.length}`);
        
        res.json({
            success: true,
            data: {
                teachers: teachers.map(t => ({
                    id: t.id,
                    name: t.name,
                    photo_url: t.photo_url,
                    qualification: t.qualification,
                    specialization: t.specialization,
                    experience_years: t.experience_years,
                    description: t.description,
                    branches: t.branches ? JSON.parse(t.branches) : [],
                    telegram_username: t.telegram_username,
                    phone_number: t.phone_number,
                    email: t.email
                })),
                total: teachers.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения преподавателей:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения преподавателей'
        });
    }
});

// FAQ
app.get('/api/faq', async (req, res) => {
    try {
        console.log(`\n❓ ЗАПРОС FAQ`);
        
        const faq = await db.all(
            `SELECT * FROM faq 
             WHERE is_active = 1
             ORDER BY display_order, category`
        );
        
        console.log(`📊 Найдено вопросов: ${faq.length}`);
        
        res.json({
            success: true,
            data: {
                faq: faq
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения FAQ:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения FAQ'
        });
    }
});

// Новости
app.get('/api/news', async (req, res) => {
    try {
        const { branch } = req.query;
        
        console.log(`\n📰 ЗАПРОС НОВОСТЕЙ`);
        console.log(`🏢 Филиал: ${branch || 'все'}`);
        
        let query = `SELECT * FROM news WHERE is_active = 1`;
        let params = [];
        
        if (branch) {
            query += ` AND (branch = ? OR branch IS NULL)`;
            params.push(branch);
        }
        
        query += ` ORDER BY publish_date DESC, created_at DESC`;
        
        const news = await db.all(query, params);
        
        console.log(`📊 Найдено новостей: ${news.length}`);
        
        res.json({
            success: true,
            data: {
                news: news,
                total: news.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения новостей:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения новостей'
        });
    }
});

// Админ авторизация
app.post('/api/admin/auth', async (req, res) => {
    try {
        const { telegram_id } = req.body;
        
        if (!telegram_id) {
            return res.status(400).json({
                success: false,
                error: 'Необходим telegram_id'
            });
        }
        
        console.log(`\n🔐 АДМИН АВТОРИЗАЦИЯ`);
        console.log(`🆔 Telegram ID: ${telegram_id}`);
        
        const admin = await db.get(
            'SELECT * FROM administrators WHERE telegram_id = ?',
            [telegram_id]
        );
        
        if (!admin) {
            console.log(`❌ Доступ запрещен`);
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        console.log(`✅ Админ найден: ${admin.name}`);
        
        const token = jwt.sign(
            {
                id: admin.id,
                telegram_id: admin.telegram_id,
                role: admin.role,
                name: admin.name
            },
            JWT_SECRET,
            { expiresIn: '1d' }
        );
        
        res.json({
            success: true,
            data: {
                admin: {
                    id: admin.id,
                    name: admin.name,
                    email: admin.email,
                    phone_number: admin.phone_number,
                    branches: admin.branches ? JSON.parse(admin.branches) : [],
                    role: admin.role
                },
                token: token
            }
        });
        
    } catch (error) {
        console.error('Ошибка авторизации админа:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка авторизации'
        });
    }
});

// Статистика (админ)
app.get('/api/admin/stats', async (req, res) => {
    try {
        const { token } = req.query;
        
        if (!token) {
            return res.status(400).json({
                success: false,
                error: 'Необходим токен'
            });
        }
        
        console.log(`\n📊 ЗАПРОС СТАТИСТИКИ`);
        
        // Проверяем токен
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            
            const admin = await db.get(
                'SELECT * FROM administrators WHERE id = ?',
                [decoded.id]
            );
            
            if (!admin) {
                console.log(`❌ Доступ запрещен`);
                return res.status(403).json({
                    success: false,
                    error: 'Доступ запрещен'
                });
            }
            
            console.log(`✅ Админ авторизован: ${admin.name}`);
            
            // Статистика
            console.log(`📈 Сбор статистики...`);
            
            const totalStudents = await db.get('SELECT COUNT(*) as count FROM student_profiles WHERE is_active = 1');
            const totalTeachers = await db.get('SELECT COUNT(*) as count FROM teachers WHERE is_active = 1');
            const todayAttendance = await db.get(`
                SELECT COUNT(*) as count FROM attendance 
                WHERE DATE(attendance_date) = DATE('now')
            `);
            const activeSubscriptions = await db.get(`
                SELECT COUNT(*) as count FROM student_profiles 
                WHERE remaining_classes > 0 AND expiration_date >= DATE('now')
            `);
            
            // Статистика по филиалам
            const branchesStats = await db.all(`
                SELECT branch, COUNT(*) as students_count 
                FROM student_profiles 
                WHERE is_active = 1 
                GROUP BY branch
            `);
            
            // Статистика по демо/реальным данным
            const demoStats = await db.get(`
                SELECT 
                    SUM(CASE WHEN is_demo = 1 THEN 1 ELSE 0 END) as demo_count,
                    SUM(CASE WHEN is_demo = 0 THEN 1 ELSE 0 END) as real_count
                FROM student_profiles 
                WHERE is_active = 1
            `);
            
            console.log(`✅ Статистика собрана`);
            
            res.json({
                success: true,
                data: {
                    total_students: totalStudents.count,
                    total_teachers: totalTeachers.count,
                    today_attendance: todayAttendance.count,
                    active_subscriptions: activeSubscriptions.count,
                    branches: branchesStats,
                    data_source: {
                        demo_students: demoStats.demo_count || 0,
                        real_students: demoStats.real_count || 0,
                        using_amocrm: amoCrmService.isInitialized
                    },
                    amocrm_connected: amoCrmService.isInitialized,
                    amocrm_account: amoCrmService.accountInfo
                }
            });
            
        } catch (jwtError) {
            console.error(`❌ Неверный токен: ${jwtError.message}`);
            return res.status(401).json({
                success: false,
                error: 'Неверный токен'
            });
        }
        
    } catch (error) {
        console.error('Ошибка получения статистики:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// ==================== OAuth callback ====================
app.get('/oauth/callback', async (req, res) => {
    try {
        const { code, referer, state } = req.query;
        
        console.log('\n' + '='.repeat(80));
        console.log('🔄 OAuth CALLBACK ОТ AMOCRM');
        console.log('='.repeat(80));
        console.log(`📝 Код авторизации: ${code ? '✅ Получен (' + code.substring(0, 20) + '...)' : '❌ Отсутствует'}`);
        console.log(`🔗 Referer: ${referer || 'Не указан'}`);
        console.log(`🏷️ State: ${state || 'Не указан'}`);
        console.log(`🕐 Время: ${new Date().toLocaleString()}`);
        
        if (!code) {
            const errorHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Ошибка авторизации amoCRM</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                        }
                        
                        body {
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 20px;
                        }
                        
                        .container {
                            background: white;
                            border-radius: 20px;
                            padding: 40px;
                            max-width: 600px;
                            width: 100%;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                            text-align: center;
                        }
                        
                        .error-icon {
                            font-size: 80px;
                            color: #f44336;
                            margin-bottom: 20px;
                        }
                        
                        h1 {
                            color: #333;
                            margin-bottom: 20px;
                            font-size: 28px;
                        }
                        
                        .message {
                            color: #666;
                            margin-bottom: 30px;
                            line-height: 1.6;
                            font-size: 16px;
                        }
                        
                        .details {
                            background: #f8f9fa;
                            border-radius: 10px;
                            padding: 20px;
                            margin: 20px 0;
                            text-align: left;
                        }
                        
                        .details h3 {
                            color: #555;
                            margin-bottom: 10px;
                            font-size: 18px;
                        }
                        
                        .details ul {
                            list-style: none;
                            padding: 0;
                        }
                        
                        .details li {
                            padding: 8px 0;
                            color: #777;
                            border-bottom: 1px solid #eee;
                        }
                        
                        .details li:last-child {
                            border-bottom: none;
                        }
                        
                        .btn {
                            display: inline-block;
                            background: #4CAF50;
                            color: white;
                            padding: 15px 30px;
                            text-decoration: none;
                            border-radius: 50px;
                            font-weight: 600;
                            font-size: 16px;
                            transition: all 0.3s ease;
                            margin: 10px;
                        }
                        
                        .btn:hover {
                            background: #45a049;
                            transform: translateY(-2px);
                            box-shadow: 0 10px 20px rgba(0,0,0,0.2);
                        }
                        
                        .btn-secondary {
                            background: #2196F3;
                        }
                        
                        .btn-secondary:hover {
                            background: #0b7dda;
                        }
                        
                        .btn-group {
                            margin-top: 30px;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="error-icon">❌</div>
                        <h1>Ошибка авторизации amoCRM</h1>
                        
                        <div class="message">
                            Не получен код авторизации от amoCRM. Возможные причины:
                        </div>
                        
                        <div class="details">
                            <h3>Возможные причины:</h3>
                            <ul>
                                <li>❌ Пользователь отменил авторизацию</li>
                                <li>❌ Истекло время действия запроса</li>
                                <li>❌ Неверные настройки интеграции в amoCRM</li>
                                <li>❌ Не совпадает redirect_uri</li>
                            </ul>
                        </div>
                        
                        <div class="btn-group">
                            <a href="/admin" class="btn">Вернуться в админ-панель</a>
                            <a href="/api/amocrm/status" class="btn btn-secondary">Проверить статус</a>
                        </div>
                    </div>
                </body>
                </html>
            `;
            return res.send(errorHtml);
        }
        
        try {
            console.log(`\n🔄 Получаем access token по коду...`);
            
            // Получаем access token
            await amoCrmService.getAccessToken(code);
            
            const successHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Успешная авторизация amoCRM</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                        }
                        
                        body {
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 20px;
                        }
                        
                        .container {
                            background: white;
                            border-radius: 20px;
                            padding: 40px;
                            max-width: 700px;
                            width: 100%;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                        }
                        
                        .success-icon {
                            font-size: 80px;
                            color: #4CAF50;
                            text-align: center;
                            margin-bottom: 20px;
                        }
                        
                        h1 {
                            color: #333;
                            margin-bottom: 20px;
                            font-size: 28px;
                            text-align: center;
                        }
                        
                        .subtitle {
                            color: #666;
                            text-align: center;
                            margin-bottom: 30px;
                            font-size: 18px;
                        }
                        
                        .info-card {
                            background: #f8f9fa;
                            border-radius: 15px;
                            padding: 25px;
                            margin: 20px 0;
                            border-left: 5px solid #4CAF50;
                        }
                        
                        .info-card h3 {
                            color: #333;
                            margin-bottom: 15px;
                            font-size: 20px;
                            display: flex;
                            align-items: center;
                            gap: 10px;
                        }
                        
                        .info-card h3:before {
                            content: "✅";
                            font-size: 24px;
                        }
                        
                        .info-card p {
                            color: #666;
                            line-height: 1.6;
                            margin-bottom: 10px;
                        }
                        
                        .details {
                            background: white;
                            border-radius: 10px;
                            padding: 15px;
                            margin-top: 15px;
                            border: 1px solid #e0e0e0;
                        }
                        
                        .details pre {
                            background: #f5f5f5;
                            padding: 15px;
                            border-radius: 5px;
                            overflow-x: auto;
                            font-family: 'Courier New', monospace;
                            font-size: 14px;
                            color: #333;
                        }
                        
                        .btn-group {
                            display: flex;
                            gap: 15px;
                            margin-top: 30px;
                            flex-wrap: wrap;
                            justify-content: center;
                        }
                        
                        .btn {
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            gap: 10px;
                            background: #4CAF50;
                            color: white;
                            padding: 15px 30px;
                            text-decoration: none;
                            border-radius: 50px;
                            font-weight: 600;
                            font-size: 16px;
                            transition: all 0.3s ease;
                            min-width: 200px;
                        }
                        
                        .btn:hover {
                            background: #45a049;
                            transform: translateY(-2px);
                            box-shadow: 0 10px 20px rgba(0,0,0,0.2);
                        }
                        
                        .btn-secondary {
                            background: #2196F3;
                        }
                        
                        .btn-secondary:hover {
                            background: #0b7dda;
                        }
                        
                        .btn-test {
                            background: #FF9800;
                        }
                        
                        .btn-test:hover {
                            background: #e68900;
                        }
                        
                        .btn-icon {
                            font-size: 20px;
                        }
                        
                        .note {
                            background: #fff8e1;
                            border: 1px solid #ffd54f;
                            border-radius: 10px;
                            padding: 15px;
                            margin-top: 20px;
                            font-size: 14px;
                            color: #856404;
                        }
                        
                        @media (max-width: 600px) {
                            .container {
                                padding: 20px;
                            }
                            
                            .btn-group {
                                flex-direction: column;
                            }
                            
                            .btn {
                                width: 100%;
                            }
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="success-icon">✅</div>
                        <h1>Авторизация amoCRM успешна!</h1>
                        <div class="subtitle">Система подключена к вашему аккаунту amoCRM</div>
                        
                        <div class="info-card">
                            <h3>Подключение установлено</h3>
                            <p><strong>Домен:</strong> ${AMOCRM_DOMAIN}</p>
                            <p><strong>Статус:</strong> <span style="color: #4CAF50; font-weight: bold;">✅ Готов к использованию</span></p>
                            <p><strong>Access Token:</strong> Получен и сохранен в базе данных</p>
                            <p><strong>Refresh Token:</strong> Получен для автоматического обновления</p>
                        </div>
                        
                        <div class="info-card">
                            <h3>Следующие шаги</h3>
                            <p>1. Проверьте подключение через диагностику</p>
                            <p>2. Запустите синхронизацию данных</p>
                            <p>3. Протестируйте поиск учеников по телефону</p>
                        </div>
                        
                        <div class="note">
                            <strong>⚠️ Важно:</strong> Код авторизации одноразовый. Токены сохранены в базе данных и будут автоматически обновляться. Не нужно сохранять этот код в .env файл.
                        </div>
                        
                        <div class="btn-group">
                            <a href="/admin" class="btn">
                                <span class="btn-icon">⚙️</span>
                                Перейти в админ-панель
                            </a>
                            <a href="/api/debug/amocrm-test" class="btn btn-test">
                                <span class="btn-icon">🧪</span>
                                Проверить подключение
                            </a>
                            <a href="/api/debug/amocrm-contacts?phone=79991234567" class="btn btn-secondary">
                                <span class="btn-icon">🔍</span>
                                Тестовый поиск
                            </a>
                        </div>
                    </div>
                    
                    <script>
                        // Сохраняем статус в localStorage для админ-панели
                        localStorage.setItem('amocrm_authorized', 'true');
                        localStorage.setItem('amocrm_authorized_time', new Date().toISOString());
                    </script>
                </body>
                </html>
            `;
            
            res.send(successHtml);
            
        } catch (tokenError) {
            console.error('❌ Ошибка получения токена:', tokenError.message);
            
            const errorHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Ошибка получения токена amoCRM</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                        }
                        
                        body {
                            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 20px;
                        }
                        
                        .container {
                            background: white;
                            border-radius: 20px;
                            padding: 40px;
                            max-width: 700px;
                            width: 100%;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                        }
                        
                        .error-icon {
                            font-size: 80px;
                            color: #f44336;
                            text-align: center;
                            margin-bottom: 20px;
                        }
                        
                        h1 {
                            color: #333;
                            margin-bottom: 20px;
                            font-size: 28px;
                            text-align: center;
                        }
                        
                        .error-details {
                            background: #ffebee;
                            border-radius: 15px;
                            padding: 25px;
                            margin: 20px 0;
                            border-left: 5px solid #f44336;
                        }
                        
                        .error-details h3 {
                            color: #c62828;
                            margin-bottom: 15px;
                            font-size: 20px;
                            display: flex;
                            align-items: center;
                            gap: 10px;
                        }
                        
                        .error-details h3:before {
                            content: "❌";
                            font-size: 24px;
                        }
                        
                        .error-details pre {
                            background: white;
                            padding: 15px;
                            border-radius: 5px;
                            overflow-x: auto;
                            font-family: 'Courier New', monospace;
                            font-size: 14px;
                            color: #c62828;
                            border: 1px solid #ffcdd2;
                            margin-top: 10px;
                        }
                        
                        .solutions {
                            background: #e8f5e9;
                            border-radius: 15px;
                            padding: 25px;
                            margin: 20px 0;
                            border-left: 5px solid #4CAF50;
                        }
                        
                        .solutions h3 {
                            color: #2e7d32;
                            margin-bottom: 15px;
                            font-size: 20px;
                            display: flex;
                            align-items: center;
                            gap: 10px;
                        }
                        
                        .solutions h3:before {
                            content: "💡";
                            font-size: 24px;
                        }
                        
                        .solutions ul {
                            list-style: none;
                            padding: 0;
                        }
                        
                        .solutions li {
                            padding: 10px 0;
                            color: #555;
                            border-bottom: 1px solid #c8e6c9;
                            display: flex;
                            align-items: center;
                            gap: 10px;
                        }
                        
                        .solutions li:last-child {
                            border-bottom: none;
                        }
                        
                        .solutions li:before {
                            content: "👉";
                            color: #4CAF50;
                        }
                        
                        .btn-group {
                            display: flex;
                            gap: 15px;
                            margin-top: 30px;
                            flex-wrap: wrap;
                            justify-content: center;
                        }
                        
                        .btn {
                            display: inline-flex;
                            align-items: center;
                            justify-content: center;
                            gap: 10px;
                            background: #2196F3;
                            color: white;
                            padding: 15px 30px;
                            text-decoration: none;
                            border-radius: 50px;
                            font-weight: 600;
                            font-size: 16px;
                            transition: all 0.3s ease;
                            min-width: 200px;
                        }
                        
                        .btn:hover {
                            background: #0b7dda;
                            transform: translateY(-2px);
                            box-shadow: 0 10px 20px rgba(0,0,0,0.2);
                        }
                        
                        .btn-retry {
                            background: #4CAF50;
                        }
                        
                        .btn-retry:hover {
                            background: #45a049;
                        }
                        
                        @media (max-width: 600px) {
                            .container {
                                padding: 20px;
                            }
                            
                            .btn-group {
                                flex-direction: column;
                            }
                            
                            .btn {
                                width: 100%;
                            }
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="error-icon">❌</div>
                        <h1>Ошибка получения токена amoCRM</h1>
                        
                        <div class="error-details">
                            <h3>Детали ошибки</h3>
                            <p><strong>Сообщение:</strong> ${tokenError.message}</p>
                            ${tokenError.response ? `
                                <p><strong>Статус:</strong> ${tokenError.response.status}</p>
                                <p><strong>Ответ сервера:</strong></p>
                                <pre>${JSON.stringify(tokenError.response.data, null, 2)}</pre>
                            ` : ''}
                        </div>
                        
                        <div class="solutions">
                            <h3>Возможные решения</h3>
                            <ul>
                                <li>Проверьте корректность AMOCRM_CLIENT_ID и AMOCRM_CLIENT_SECRET в .env файле</li>
                                <li>Убедитесь, что redirect_uri совпадает с указанным в настройках интеграции amoCRM</li>
                                <li>Проверьте, что код авторизации не был использован ранее</li>
                                <li>Убедитесь, что интеграция в amoCRM активна и имеет необходимые права</li>
                                <li>Попробуйте сгенерировать новый код авторизации</li>
                            </ul>
                        </div>
                        
                        <div class="btn-group">
                            <a href="/admin" class="btn">Вернуться в админ-панель</a>
                            ${AMOCRM_CLIENT_ID ? `
                                <a href="https://www.amocrm.ru/oauth?client_id=${AMOCRM_CLIENT_ID}&state=art_school" 
                                   class="btn btn-retry" target="_blank">
                                   🔄 Получить новый код
                                </a>
                            ` : ''}
                        </div>
                    </div>
                </body>
                </html>
            `;
            
            res.send(errorHtml);
        }
        
    } catch (error) {
        console.error('❌ Ошибка в OAuth callback:', error);
        
        const errorHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Ошибка обработки callback</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .error { color: #f44336; font-size: 24px; margin-bottom: 20px; }
                    .details { background: #ffebee; padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 600px; }
                </style>
            </head>
            <body>
                <div class="error">❌ Ошибка обработки callback</div>
                <div class="details">
                    <p><strong>Сообщение:</strong> ${error.message}</p>
                    ${error.stack ? `<pre style="text-align: left; overflow: auto;">${error.stack}</pre>` : ''}
                </div>
                <p><a href="/admin">Вернуться в админ-панель</a></p>
            </body>
            </html>
        `;
        
        res.send(errorHtml);
    }
});

// ==================== МАРШРУТЫ ДЛЯ СТАТИЧЕСКИХ ФАЙЛОВ ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/debug', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'debug.html'));
});

// Маршрут для OAuth ссылки
app.get('/oauth/link', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'oauth.html'));
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Инициализируем amoCRM после базы данных
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            console.log(`🔑 Токен: ${amoCrmService.accessToken ? '✅ Присутствует' : '❌ Отсутствует'}`);
            console.log(`📊 Аккаунт: ${amoCrmService.accountInfo?.name || 'Не получено'}`);
        } else {
            console.log('⚠️  amoCRM не инициализирован');
            console.log('ℹ️  Для подключения amoCRM:');
            console.log('   1. Проверьте переменные окружения в .env файле');
            console.log('   2. Перейдите в админ-панель: http://localhost:3000/admin');
            console.log('   3. Используйте OAuth авторизацию: http://localhost:3000/oauth/link');
        }
        
        // Пробуем запустить бота
        console.log('\n🤖 Инициализация Telegram бота...');
        try {
            const botInfo = await bot.telegram.getMe();
            console.log(`✅ Telegram бот: @${botInfo.username} (${botInfo.first_name})`);
            
            bot.launch().then(() => {
                console.log('✅ Telegram бот запущен в режиме polling');
            }).catch(botError => {
                if (botError.response?.error_code === 409) {
                    console.log('⚠️  Другой экземпляр бота уже запущен. Используем только API.');
                } else {
                    console.error('❌ Ошибка запуска бота:', botError.message);
                }
            });
        } catch (botError) {
            console.log('🤖 Telegram бот: Информация недоступна');
            console.log('⚠️  Проверьте токен бота или интернет соединение');
        }
        
        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 Основной URL: http://localhost:${PORT}`);
            console.log(`🤖 Telegram бот: ${TELEGRAM_BOT_TOKEN ? '✅ Настроен' : '❌ Не настроен'}`);
            console.log(`📊 База данных: SQLite (${db.filename})`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log(`🎭 Режим: ${amoCrmService.isInitialized ? 'Реальные данные' : 'Требуется подключение'}`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`⚙️  Админ-панель: http://localhost:${PORT}/admin`);
            console.log(`🔧 Диагностика: http://localhost:${PORT}/debug`);
            console.log(`🔗 OAuth авторизация: http://localhost:${PORT}/oauth/link`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log(`🔍 Диагностика amoCRM: http://localhost:${PORT}/api/debug/amocrm-test`);
            console.log('='.repeat(50));
            
            console.log('\n🎯 ДИАГНОСТИКА ИНТЕГРАЦИИ:');
            console.log('='.repeat(50));
            console.log('1. Проверьте статус: /api/amocrm/status');
            console.log('2. Тестовый поиск: /api/debug/amocrm-contacts?phone=79991234567');
            console.log('3. Полный тест: /api/debug/amocrm-test');
            console.log('4. Для OAuth авторизации перейдите в админ-панель или /oauth/link');
            console.log('='.repeat(50));
            
            console.log('\n📝 ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ:');
            console.log('='.repeat(50));
            console.log(`TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log(`AMOCRM_DOMAIN: ${AMOCRM_DOMAIN || '❌ Не установлен'}`);
            console.log(`AMOCRM_CLIENT_ID: ${AMOCRM_CLIENT_ID ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log(`AMOCRM_CLIENT_SECRET: ${AMOCRM_CLIENT_SECRET ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log(`AMOCRM_ACCESS_TOKEN: ${AMOCRM_ACCESS_TOKEN ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log('='.repeat(50));
            
            // Запускаем периодическую синхронизацию
            setInterval(async () => {
                try {
                    if (amoCrmService.isInitialized) {
                        console.log('\n🔄 Автоматическая синхронизация данных...');
                        await amoCrmService.syncAllData();
                    }
                } catch (syncError) {
                    console.error('❌ Ошибка автоматической синхронизации:', syncError.message);
                }
            }, 30 * 60 * 1000); // Каждые 30 минут
            
            // Первоначальная синхронизация через 5 секунд
            setTimeout(async () => {
                if (amoCrmService.isInitialized) {
                    console.log('\n🔄 Первоначальная синхронизация данных...');
                    await amoCrmService.syncAllData();
                }
            }, 5000);
        });
        
        // Обработка ошибок сервера
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Порт ${PORT} уже занят!`);
                console.log(`🔄 Попробуйте другой порт:`);
                console.log(`   npm start -- --port=3001`);
                process.exit(1);
            } else {
                console.error('❌ Ошибка сервера:', error);
            }
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
};

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
    
    try {
        bot.stop('SIGINT');
        console.log('✅ Telegram бот остановлен');
    } catch (botError) {
        console.error('❌ Ошибка остановки бота:', botError.message);
    }
    
    console.log('👋 Сервер остановлен');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🔄 Получен сигнал SIGTERM, остановка сервера...');
    
    try {
        if (db) {
            await db.close();
        }
    } catch (error) {
        // Игнорируем ошибки при завершении
    }
    
    process.exit(0);
});

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
    console.error('❌ Необработанная ошибка:', error);
    console.error('Stack trace:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Необработанный промис:', reason);
});

// Запуск сервера
startServer();
