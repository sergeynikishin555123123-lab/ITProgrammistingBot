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

// Настройки amoCRM - КРИТИЧЕСКИ ВАЖНО ПРАВИЛЬНЫЕ ЗНАЧЕНИЯ
const AMOCRM_CLIENT_ID = process.env.AMOCRM_CLIENT_ID || 'bb629052-604f-449a-80bd-8f6333645879';
const AMOCRM_CLIENT_SECRET = process.env.AMOCRM_CLIENT_SECRET || 'tMED3Q4GsAzjzAWMCMg6OeyPN25WmdYcEit2GQ6wmQ3Rnzy8RGhKoLu7W4Zj0caw';
const AMOCRM_REDIRECT_URI = process.env.AMOCRM_REDIRECT_URI || `${DOMAIN}/oauth/callback`;
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN || 'pismovbanu.amocrm.ru';
const AMOCRM_SUBDOMAIN = AMOCRM_DOMAIN.replace('.amocrm.ru', '');
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
        console.log('='.repeat(60));
        console.log(`🏢 Домен: ${AMOCRM_DOMAIN}`);
        console.log(`🔗 Base URL: ${this.baseUrl}`);
        console.log(`🔑 Client ID: ${this.clientId ? '✅ Установлен' : '❌ Не установлен'}`);
        console.log(`🔐 Client Secret: ${this.clientSecret ? '✅ Установлен' : '❌ Не установлен'}`);
        console.log(`🔄 Redirect URI: ${this.redirectUri}`);
        console.log(`🔑 Access Token: ${this.accessToken ? '✅ Установлен' : '❌ Не установлен'}`);
        console.log(`🔄 Refresh Token: ${this.refreshToken ? '✅ Установлен' : '❌ Не установлен'}`);
        console.log('='.repeat(60));
    }

    async initialize() {
        console.log('\n🔄 ИНИЦИАЛИЗАЦИЯ AMOCRM СЕРВИСА');
        console.log('='.repeat(60));
        
        // 1. Проверяем минимальные требования
        if (!AMOCRM_DOMAIN || AMOCRM_DOMAIN === 'yourcompany.amocrm.ru') {
            console.log('❌ AMOCRM_DOMAIN неверный или не указан');
            console.log('ℹ️  Установите правильный домен: pismovbanu.amocrm.ru');
            return false;
        }
        
        if (!AMOCRM_CLIENT_ID || AMOCRM_CLIENT_ID === 'your_client_id') {
            console.log('❌ AMOCRM_CLIENT_ID не указан или некорректен');
            console.log('ℹ️  Установите правильный Client ID из интеграции amoCRM');
            return false;
        }
        
        if (!AMOCRM_CLIENT_SECRET || AMOCRM_CLIENT_SECRET.includes('***')) {
            console.log('❌ AMOCRM_CLIENT_SECRET не указан или некорректен');
            console.log('ℹ️  Установите правильный Client Secret из интеграции amoCRM');
            return false;
        }
        
        console.log('✅ Все обязательные переменные проверены');
        
        // 2. Если есть access token, проверяем его
        if (this.accessToken && this.accessToken !== 'initial_access_token') {
            console.log('\n🔍 ПРОВЕРКА ACCESS TOKEN ИЗ .ENV');
            try {
                const isValid = await this.checkTokenValidity(this.accessToken);
                if (isValid) {
                    console.log('✅ Access token из .env валиден');
                    this.isInitialized = true;
                    
                    // Сохраняем токен в БД
                    if (this.refreshToken && this.refreshToken !== 'initial_refresh_token') {
                        await this.saveTokensToDatabase(this.accessToken, this.refreshToken, Date.now() + 24 * 60 * 60 * 1000);
                    }
                    return true;
                }
            } catch (tokenError) {
                console.log(`❌ Access token из .env невалиден: ${tokenError.message}`);
                
                // Если есть refresh token, пробуем обновить
                if (this.refreshToken && this.refreshToken !== 'initial_refresh_token') {
                    console.log('🔄 Пробуем обновить токен с помощью refresh token...');
                    try {
                        await this.refreshAccessToken();
                        this.isInitialized = true;
                        return true;
                    } catch (refreshError) {
                        console.log(`❌ Не удалось обновить токен: ${refreshError.message}`);
                    }
                }
            }
        } else {
            console.log('📭 Access token отсутствует или некорректен');
        }
        
        // 3. Пробуем загрузить токены из базы данных
        try {
            console.log('\n📂 ЗАГРУЗКА ТОКЕНОВ ИЗ БАЗЫ ДАННЫХ');
            const tokensLoaded = await this.loadTokensFromDatabase();
            if (tokensLoaded) {
                console.log('✅ Токены успешно загружены из базы данных');
                this.isInitialized = true;
                return true;
            }
        } catch (dbError) {
            console.log(`⚠️  Не удалось загрузить токены из БД: ${dbError.message}`);
        }
        
        // 4. Если ничего не сработало, показываем инструкцию
        console.log('\n❌ НЕ УДАЛОСЬ ИНИЦИАЛИЗИРОВАТЬ AMOCRM');
        console.log('\n📋 ВАРИАНТЫ РЕШЕНИЯ:');
        console.log('='.repeat(60));
        console.log('1. Проверьте подписку amoCRM (402 ошибка - нет активной подписки)');
        console.log('2. Получите новый токен через OAuth:');
        console.log(`   ${DOMAIN}/oauth/link`);
        console.log('\n3. Проверьте правильность данных в .env:');
        console.log(`   AMOCRM_DOMAIN=pismovbanu.amocrm.ru`);
        console.log(`   AMOCRM_CLIENT_ID=bb629052-604f-449a-80bd-8f6333645879`);
        console.log(`   AMOCRM_CLIENT_SECRET=tMED3Q4GsAzjzAWMCMg6OeyPN25WmdYcEit2GQ6wmQ3Rnzy8RGhKoLu7W4Zj0caw`);
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
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка проверки токена:');
            if (error.response) {
                console.log(`   Статус: ${error.response.status}`);
                console.log(`   Сообщение: ${error.response.statusText}`);
                
                // Обработка специфических ошибок
                if (error.response.status === 402) {
                    console.log('💰 ОШИБКА: Нет активной подписки amoCRM');
                    console.log('ℹ️  Требуется активировать или продлить подписку amoCRM');
                } else if (error.response.status === 401) {
                    console.log('🔐 ОШИБКА: Неавторизованный доступ');
                } else if (error.response.status === 403) {
                    console.log('🚫 ОШИБКА: Доступ запрещен');
                }
                
                if (error.response.data) {
                    console.log(`   Данные:`, JSON.stringify(error.response.data, null, 2));
                }
            } else if (error.request) {
                console.log(`   Не получен ответ от сервера`);
                console.log(`   URL: ${this.baseUrl}/api/v4/account`);
            } else {
                console.log(`   Ошибка: ${error.message}`);
            }
            throw error;
        }
    }

    async getAccessToken(authCode) {
        console.log('\n🔄 ПОЛУЧЕНИЕ ACCESS TOKEN ПО КОДУ АВТОРИЗАЦИИ');
        
        if (!authCode || authCode === 'your_auth_code') {
            throw new Error('Некорректный код авторизации');
        }

        const tokenData = {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'authorization_code',
            code: authCode,
            redirect_uri: this.redirectUri
        };

        console.log('📦 Отправка запроса на получение токена...');
        console.log(`   Client ID: ${this.clientId.substring(0, 8)}...`);
        console.log(`   Redirect URI: ${this.redirectUri}`);
        console.log(`   Длина кода: ${authCode.length} символов`);

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
            console.log(`⏰ Истекает через: ${Math.floor(expires_in / 3600)} часов`);
            
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
                
                if (error.response.status === 400) {
                    console.log('⚠️  Возможные причины:');
                    console.log('   - Неверный client_id или client_secret');
                    console.log('   - Неверный redirect_uri');
                    console.log('   - Код авторизации уже использован');
                    console.log('   - Истек срок действия кода');
                }
            } else if (error.request) {
                console.log(`   Запрос отправлен, но ответ не получен`);
                console.log(`   Проверьте интернет-соединение и доступность amoCRM`);
            } else {
                console.log(`   Ошибка настройки запроса: ${error.message}`);
            }
            throw error;
        }
    }

    async refreshAccessToken() {
        console.log('\n🔄 ОБНОВЛЕНИЕ ACCESS TOKEN');
        
        if (!this.refreshToken || this.refreshToken === 'initial_refresh_token') {
            throw new Error('Refresh token отсутствует или некорректен');
        }

        const tokenData = {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken,
            redirect_uri: this.redirectUri
        };

        console.log('📦 Отправка запроса на обновление токена...');
        console.log(`   Client ID: ${this.clientId.substring(0, 8)}...`);

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
            
            // Сохраняем токены в БД
            await this.saveTokensToDatabase(access_token, refresh_token, this.tokenExpiresAt);
            
            return true;
        } catch (error) {
            console.error('❌ ОШИБКА ОБНОВЛЕНИЯ TOKEN:');
            if (error.response) {
                console.log(`   Статус: ${error.response.status}`);
                console.log(`   Данные:`, JSON.stringify(error.response.data, null, 2));
                
                if (error.response.status === 400) {
                    console.log('⚠️  Возможные причины:');
                    console.log('   - Неверный refresh token');
                    console.log('   - Истек срок действия refresh token');
                    console.log('   - Неверные учетные данные');
                }
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
            
        } catch (error) {
            console.error('❌ Ошибка сохранения токенов в БД:', error.message);
        }
    }

    async loadTokensFromDatabase() {
        try {
            console.log('\n📂 ЗАГРУЗКА ТОКЕНОВ ИЗ БАЗЫ ДАННЫХ');
            
            const tokens = await db.get('SELECT * FROM amocrm_tokens WHERE id = 1');
            
            if (tokens) {
                console.log('✅ Токены найдены в базе данных');
                console.log(`   Создано: ${new Date(tokens.created_at).toLocaleString()}`);
                
                const now = Date.now();
                const expiresAt = tokens.expires_at;
                
                // Проверяем не истек ли токен
                if (now < expiresAt - 300000) { // Запас 5 минут
                    console.log('✅ Токен из БД валиден');
                    this.accessToken = tokens.access_token;
                    this.refreshToken = tokens.refresh_token;
                    this.tokenExpiresAt = expiresAt;
                    
                    // Проверяем валидность токена
                    try {
                        await this.checkTokenValidity(tokens.access_token);
                        return true;
                    } catch (validationError) {
                        console.log('❌ Токен из БД не прошел проверку:', validationError.message);
                        return false;
                    }
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
            return false;
        }
    }

    async makeRequest(method, endpoint, data = null, retry = true) {
        if (!this.isInitialized || !this.accessToken) {
            throw new Error('amoCRM не инициализирован или токен отсутствует');
        }

        const url = `${this.baseUrl}${endpoint}`;
        console.log(`\n🌐 API ЗАПРОС: ${method} ${url}`);
        
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
                console.error(`   Сообщение: ${error.response.statusText}`);
                
                // Обработка специфических ошибок
                if (error.response.status === 402) {
                    console.error('💰 ОШИБКА: Нет активной подписки amoCRM');
                    console.error('ℹ️  Требуется активировать или продлить подписку amoCRM');
                }
                
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
                console.error(`   Проверьте интернет-соединение`);
            } else {
                console.error(`   Ошибка настройки запроса: ${error.message}`);
            }
            
            throw error;
        }
    }

    async testConnection() {
        console.log('\n🧪 ТЕСТ ПОДКЛЮЧЕНИЯ К AMOCRM');
        
        try {
            const response = await this.makeRequest('GET', '/api/v4/account');
            console.log('✅ Подключение успешно!');
            console.log(`📊 Аккаунт: ${response.name}`);
            console.log(`🌍 Поддомен: ${response.subdomain}`);
            return response;
        } catch (error) {
            console.error('❌ Ошибка подключения:', error.message);
            throw error;
        }
    }

    async getStudentsByPhone(phoneNumber) {
        console.log(`\n🔍 ПОИСК УЧЕНИКОВ ПО ТЕЛЕФОНУ`);
        console.log(`📞 Телефон: ${phoneNumber}`);
        
        if (!this.isInitialized) {
            console.log('⚠️  amoCRM не инициализирован, используем локальный поиск');
            return await this.searchInLocalDatabase(phoneNumber);
        }
        
        try {
            // Очищаем номер
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            let searchPhone = cleanPhone;
            
            if (cleanPhone.length === 10) {
                searchPhone = '7' + cleanPhone;
            } else if (cleanPhone.length === 11 && cleanPhone.startsWith('8')) {
                searchPhone = '7' + cleanPhone.slice(1);
            }
            
            console.log(`🔍 Поиск в amoCRM по телефону: ${searchPhone}`);
            
            // Пробуем поиск через query
            const encodedQuery = encodeURIComponent(searchPhone);
            const response = await this.makeRequest('GET', `/api/v4/contacts?query=${encodedQuery}&limit=50`);
            
            const contacts = response._embedded?.contacts || [];
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            const profiles = [];
            for (const contact of contacts) {
                try {
                    const profile = await this.parseContactToProfile(contact);
                    profiles.push(profile);
                } catch (contactError) {
                    console.error(`❌ Ошибка обработки контакта: ${contactError.message}`);
                }
            }
            
            return profiles;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска в amoCRM: ${error.message}`);
            console.log('🔄 Переключаемся на локальный поиск...');
            return await this.searchInLocalDatabase(phoneNumber);
        }
    }

    async searchInLocalDatabase(phoneNumber) {
        console.log('🔍 ЛОКАЛЬНЫЙ ПОИСК В БАЗЕ ДАННЫХ');
        
        try {
            const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);
            const profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY created_at DESC
                 LIMIT 10`,
                [`%${cleanPhone}%`]
            );
            
            console.log(`📊 Найдено в локальной базе: ${profiles.length}`);
            return profiles;
        } catch (error) {
            console.error('❌ Ошибка локального поиска:', error.message);
            return [];
        }
    }

    async parseContactToProfile(contact) {
        console.log(`\n🔍 ПАРСИНГ КОНТАКТА: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
        
        const profile = {
            amocrm_contact_id: contact.id,
            student_name: contact.name || 'Не указано',
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
            is_demo: 0,
            source: 'amocrm',
            created_at: contact.created_at ? new Date(contact.created_at * 1000).toISOString() : new Date().toISOString()
        };
        
        // Парсим кастомные поля
        if (contact.custom_fields_values) {
            for (const field of contact.custom_fields_values) {
                const fieldName = field.field_name?.toLowerCase() || '';
                const fieldCode = field.field_code || '';
                const values = field.values || [];
                
                if (values.length > 0) {
                    const value = values[0].value;
                    
                    if (fieldCode === 'PHONE' || fieldName.includes('телефон')) {
                        profile.phone_number = value;
                    }
                    else if (fieldCode === 'EMAIL' || fieldName.includes('email')) {
                        profile.email = value;
                    }
                    else if (fieldName.includes('филиал')) {
                        profile.branch = value;
                    }
                    else if (fieldName.includes('преподаватель') || fieldName.includes('учитель')) {
                        profile.teacher_name = value;
                    }
                    else if (fieldName.includes('день недели')) {
                        profile.day_of_week = value;
                    }
                    else if (fieldName.includes('время') || fieldName.includes('часы')) {
                        profile.time_slot = value;
                    }
                    else if (fieldName.includes('абонемент') || fieldName.includes('курс')) {
                        profile.subscription_type = value;
                    }
                    else if (fieldName.includes('количество занятий') || fieldName.includes('всего')) {
                        const num = parseInt(value);
                        if (!isNaN(num)) profile.total_classes = num;
                    }
                    else if (fieldName.includes('осталось') || fieldName.includes('остаток')) {
                        const num = parseInt(value);
                        if (!isNaN(num)) profile.remaining_classes = num;
                    }
                    else if (fieldName.includes('дата окончания') || fieldName.includes('действует до')) {
                        profile.expiration_date = value;
                    }
                }
            }
        }
        
        console.log(`✅ Профиль создан: ${profile.student_name}`);
        return profile;
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
        
        // Пробуем разные пути для базы данных
        const possiblePaths = [
            '/app/data/art_school.db',  // Docker контейнер
            '/tmp/art_school.db',       // Временная директория
            './data/art_school.db',     // Текущая директория
            ':memory:'                  // In-memory как запасной вариант
        ];
        
        let dbPath;
        let dbSuccess = false;
        
        for (const path of possiblePaths) {
            try {
                console.log(`\n🔍 Пробуем путь: ${path}`);
                
                if (path !== ':memory:') {
                    // Создаем директорию если нужно
                    const dir = require('path').dirname(path);
                    try {
                        await fs.mkdir(dir, { recursive: true });
                        console.log(`📁 Директория создана: ${dir}`);
                    } catch (mkdirError) {
                        // Директория уже существует - это нормально
                    }
                }
                
                db = await open({
                    filename: path,
                    driver: sqlite3.Database
                });
                
                console.log(`✅ База данных подключена: ${path}`);
                dbPath = path;
                dbSuccess = true;
                break;
                
            } catch (pathError) {
                console.log(`❌ Не удалось использовать путь ${path}: ${pathError.message}`);
                continue;
            }
        }
        
        if (!dbSuccess) {
            throw new Error('Не удалось создать базу данных ни по одному из путей');
        }
        
        // Настройки SQLite
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        await db.run('PRAGMA busy_timeout = 5000');
        await db.run('PRAGMA synchronous = NORMAL');
        
        console.log('⚙️  Настройки SQLite применены');
        
        // Создаем таблицы
        await createTables();
        
        console.log('\n✅ База данных успешно инициализирована!');
        
        return db;
        
    } catch (error) {
        console.error('❌ Критическая ошибка инициализации базы данных:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    }
};

const createTables = async () => {
    try {
        console.log('\n📊 СОЗДАНИЕ ТАБЛИЦ БАЗЫ ДАННЫХ');
        
        // Все таблицы из вашего кода...
        // [Вставьте здесь все CREATE TABLE запросы из предыдущего кода]
        
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

        console.log('\n🎉 Все основные таблицы созданы!');
        
        // Создаем индексы
        await createIndexes();
        
        // Создаем минимальные тестовые данные
        await createMinimalTestData();
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};

const createIndexes = async () => {
    try {
        console.log('\n📈 СОЗДАНИЕ ИНДЕКСОВ');
        
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_amocrm_id ON student_profiles(amocrm_contact_id)');
        
        console.log('✅ Индексы созданы');
    } catch (error) {
        console.error('⚠️  Ошибка создания индексов:', error.message);
    }
};

const createMinimalTestData = async () => {
    try {
        console.log('\n📝 СОЗДАНИЕ МИНИМАЛЬНЫХ ТЕСТОВЫХ ДАННЫХ');
        
        // Проверяем, есть ли уже администраторы
        const adminExists = await db.get("SELECT 1 FROM administrators LIMIT 1");
        if (!adminExists) {
            await db.run(
                `INSERT INTO administrators (telegram_id, name, email, phone_number, branches, role) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [123456789, 'Администратор', 'admin@artschool.ru', '+79991112233', '["Свиблово", "Чертаново"]', 'superadmin']
            );
            console.log('✅ Тестовый администратор создан');
        }
        
        // Проверяем FAQ
        const faqExists = await db.get("SELECT 1 FROM faq LIMIT 1");
        if (!faqExists) {
            await db.run(
                `INSERT INTO faq (question, answer, category, display_order) 
                 VALUES (?, ?, ?, ?)`,
                ['Как работает система?', 'Система позволяет просматривать расписание, остатки занятий и информацию о преподавателях.', 'general', 1]
            );
            console.log('✅ Тестовый FAQ создан');
        }
        
        // Проверяем филиалы
        const branchExists = await db.get("SELECT 1 FROM branch_contacts LIMIT 1");
        if (!branchExists) {
            await db.run(
                `INSERT INTO branch_contacts (branch, phone_number, email, address, working_hours) 
                 VALUES (?, ?, ?, ?, ?)`,
                ['Свиблово', '+7 (495) 123-45-67', 'sviblovo@artschool.ru', 'ул. Свибловская, д. 1', 'Пн-Сб 10:00-20:00']
            );
            console.log('✅ Тестовый филиал создан');
        }
        
        console.log('✅ Минимальные тестовые данные созданы');
        
    } catch (error) {
        console.error('⚠️  Ошибка создания тестовых данных:', error.message);
    }
};

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('='.repeat(80));
        
        // Инициализируем базу данных ПЕРВОЙ
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Затем инициализируем amoCRM
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('\n✅ amoCRM инициализирован успешно!');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            console.log(`📊 Аккаунт: ${amoCrmService.accountInfo?.name || 'Информация получена'}`);
        } else {
            console.log('\n⚠️  amoCRM не инициализирован');
            console.log('ℹ️  Система будет работать в автономном режиме');
            console.log('📋 Для подключения amoCRM:');
            console.log('   1. Проверьте подписку amoCRM (402 ошибка)');
            console.log('   2. Проверьте правильность данных в .env');
            console.log('   3. Используйте OAuth авторизацию');
        }
        
        // Telegram бот (опционально)
        if (TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN !== 'your_telegram_bot_token') {
            try {
                console.log('\n🤖 Проверка Telegram бота...');
                const botInfo = await bot.telegram.getMe();
                console.log(`✅ Telegram бот: @${botInfo.username}`);
                
                // Запускаем бота в фоновом режиме
                bot.launch().then(() => {
                    console.log('🤖 Telegram бот запущен');
                }).catch(botError => {
                    console.log('⚠️  Бот уже запущен или ошибка запуска');
                });
            } catch (botError) {
                console.log('🤖 Telegram бот: Ошибка подключения');
            }
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 URL: http://localhost:${PORT}`);
            console.log(`📊 База данных: ${db.filename}`);
            console.log(`🔗 amoCRM: ${crmInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log(`🤖 Telegram: ${TELEGRAM_BOT_TOKEN ? '✅ Настроен' : '❌ Не настроен'}`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`⚙️  Админ-панель: http://localhost:${PORT}/admin`);
            console.log(`🔧 Диагностика: http://localhost:${PORT}/debug`);
            console.log(`🔗 OAuth: http://localhost:${PORT}/oauth/link`);
            console.log(`📊 API статус: http://localhost:${PORT}/api/status`);
            console.log('='.repeat(50));
            
            console.log('\n🎯 КЛЮЧЕВЫЕ КОМАНДЫ:');
            console.log('='.repeat(50));
            console.log('🔍 Поиск ученика: POST /api/auth/phone');
            console.log('📊 Статус amoCRM: GET /api/amocrm/status');
            console.log('🧪 Тест подключения: GET /api/debug/amocrm-test');
            console.log('🔄 Синхронизация: POST /api/amocrm/sync');
            console.log('='.repeat(50));
            
        }).on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ Порт ${PORT} занят!`);
                console.log(`🔄 Пробуйте порт 3001: PORT=3001 npm start`);
            } else {
                console.error('❌ Ошибка сервера:', error);
            }
            process.exit(1);
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Обработка завершения
process.on('SIGINT', () => {
    console.log('\n🔄 Остановка сервера...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🔄 Получен SIGTERM, остановка...');
    process.exit(0);
});

// Запуск
startServer();
