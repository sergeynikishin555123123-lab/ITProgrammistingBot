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
const querystring = require('querystring');
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
const AMOCRM_AUTH_CODE = process.env.AMOCRM_AUTH_CODE;
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
        console.log('🔄 Создание AmoCrmService...');
        console.log('📋 Проверка переменных окружения:');
        console.log(`  AMOCRM_DOMAIN: ${AMOCRM_DOMAIN ? '✅ Установлен' : '❌ Не установлен'}`);
        console.log(`  AMOCRM_CLIENT_ID: ${AMOCRM_CLIENT_ID ? '✅ Установлен' : '❌ Не установлен'}`);
        console.log(`  AMOCRM_ACCESS_TOKEN: ${AMOCRM_ACCESS_TOKEN ? '✅ Установлен (' + AMOCRM_ACCESS_TOKEN.substring(0, 20) + '...)' : '❌ Не установлен'}`);
        console.log(`  AMOCRM_REFRESH_TOKEN: ${AMOCRM_REFRESH_TOKEN ? '✅ Установлен' : '❌ Не установлен'}`);
        console.log(`  AMOCRM_AUTH_CODE: ${AMOCRM_AUTH_CODE ? '✅ Установлен' : '❌ Не установлен'}`);
        
        this.baseUrl = AMOCRM_DOMAIN ? `https://${AMOCRM_DOMAIN}` : null;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.refreshToken = AMOCRM_REFRESH_TOKEN;
        this.clientId = AMOCRM_CLIENT_ID;
        this.clientSecret = AMOCRM_CLIENT_SECRET;
        this.redirectUri = AMOCRM_REDIRECT_URI;
        this.isInitialized = false;
        this.tokenExpiresAt = 0;
    }

    async initialize() {
        console.log('\n🔄 Инициализация amoCRM...');
        
        // Проверяем минимальные требования
        if (!AMOCRM_DOMAIN) {
            console.log('❌ AMOCRM_DOMAIN не указан');
            console.log('ℹ️  Установите в .env: AMOCRM_DOMAIN=ваш-домен.amocrm.ru');
            this.isInitialized = false;
            return false;
        }

        if (!AMOCRM_CLIENT_ID) {
            console.log('❌ AMOCRM_CLIENT_ID не указан');
            console.log('ℹ️  Получите client_id в настройках интеграции amoCRM');
            this.isInitialized = false;
            return false;
        }

        // Пробуем разные способы инициализации
        let initialized = false;
        
        // 1. Пробуем загрузить токены из базы данных
        try {
            initialized = await this.loadTokensFromDatabase();
            if (initialized) {
                console.log('✅ Токены загружены из базы данных');
                this.isInitialized = true;
                return true;
            }
        } catch (error) {
            console.log('⚠️  Не удалось загрузить токены из БД:', error.message);
        }
        
        // 2. Если есть access token в .env, используем его
        if (this.accessToken) {
            console.log('🔄 Проверяем валидность access token из .env...');
            try {
                await this.checkTokenValidity();
                console.log('✅ Токен из .env валиден');
                this.isInitialized = true;
                
                // Сохраняем токен в БД
                if (this.refreshToken) {
                    await this.saveTokensToDatabase(this.accessToken, this.refreshToken, Date.now() + 24 * 60 * 60 * 1000);
                }
                return true;
            } catch (error) {
                console.log('❌ Токен из .env невалиден:', error.message);
                
                // Если есть refresh token, пробуем обновить
                if (this.refreshToken) {
                    console.log('🔄 Пробуем обновить токен...');
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
        
        // 3. Если есть код авторизации, получаем токен
        if (AMOCRM_AUTH_CODE) {
            console.log('🔄 Получаем токен по коду авторизации...');
            try {
                await this.getAccessToken(AMOCRM_AUTH_CODE);
                this.isInitialized = true;
                return true;
            } catch (error) {
                console.log('❌ Не удалось получить токен по коду:', error.message);
            }
        }
        
        // 4. Если ничего не сработало, показываем инструкцию
        console.log('\n❌ Не удалось инициализировать amoCRM');
        console.log('\n📋 ВАРИАНТЫ РЕШЕНИЯ:');
        console.log('='.repeat(50));
        console.log('1. Добавьте в .env файл:');
        console.log('   AMOCRM_DOMAIN=ваш-домен.amocrm.ru');
        console.log('   AMOCRM_CLIENT_ID=ваш_client_id');
        console.log('   AMOCRM_CLIENT_SECRET=ваш_client_secret');
        console.log('   AMOCRM_REDIRECT_URI=http://localhost:3000/oauth/callback');
        console.log('\n2. Получите код авторизации:');
        console.log(`   Перейдите по ссылке:`);
        console.log(`   https://www.amocrm.ru/oauth?client_id=${AMOCRM_CLIENT_ID}&state=art_school`);
        console.log(`   Затем добавьте полученный код в .env как AMOCRM_AUTH_CODE`);
        console.log('='.repeat(50));
        
        this.isInitialized = false;
        return false;
    }

    async checkTokenValidity() {
        if (!this.accessToken) {
            throw new Error('Токен не установлен');
        }

        console.log(`🔍 Проверка токена: ${this.accessToken.substring(0, 20)}...`);
        
        try {
            const response = await axios.get(`${this.baseUrl}/api/v4/account`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
            
            console.log('✅ Токен валиден');
            console.log(`📊 Аккаунт: ${response.data.name} (ID: ${response.data.id})`);
            return true;
        } catch (error) {
            console.error('❌ Ошибка проверки токена:');
            if (error.response) {
                console.log(`   Статус: ${error.response.status}`);
                console.log(`   Данные:`, error.response.data);
            } else {
                console.log(`   Сообщение: ${error.message}`);
            }
            throw error;
        }
    }

    async getAccessToken(authCode) {
        if (!authCode) {
            throw new Error('Не указан код авторизации');
        }

        console.log('🔄 Получение access token...');
        console.log(`📝 Код авторизации: ${authCode.substring(0, 20)}...`);
        
        const tokenData = {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'authorization_code',
            code: authCode,
            redirect_uri: this.redirectUri
        };

        console.log('📦 Данные запроса:', {
            client_id: this.clientId ? '✅' : '❌',
            client_secret: this.clientSecret ? '✅' : '❌',
            grant_type: 'authorization_code',
            redirect_uri: this.redirectUri
        });

        try {
            const response = await axios.post('https://www.amocrm.ru/oauth2/access_token', tokenData, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            const { access_token, refresh_token, expires_in } = response.data;
            
            this.accessToken = access_token;
            this.refreshToken = refresh_token;
            this.tokenExpiresAt = Date.now() + expires_in * 1000;
            
            console.log('✅ Access token получен успешно');
            console.log(`🔑 Новый токен: ${access_token.substring(0, 20)}...`);
            console.log(`🔄 Refresh token: ${refresh_token.substring(0, 20)}...`);
            console.log(`⏰ Истекает через: ${Math.floor(expires_in / 3600)} часов`);
            
            // Сохраняем токены в БД
            await this.saveTokensToDatabase(access_token, refresh_token, this.tokenExpiresAt);
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка получения access token:');
            if (error.response) {
                console.log(`   Статус: ${error.response.status}`);
                console.log(`   Данные:`, JSON.stringify(error.response.data, null, 2));
            } else {
                console.log(`   Сообщение: ${error.message}`);
            }
            throw error;
        }
    }

    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('Нет refresh token');
        }

        console.log('🔄 Обновление access token...');
        console.log(`🔄 Refresh token: ${this.refreshToken.substring(0, 20)}...`);
        
        const tokenData = {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken,
            redirect_uri: this.redirectUri
        };

        try {
            const response = await axios.post('https://www.amocrm.ru/oauth2/access_token', tokenData, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            const { access_token, refresh_token, expires_in } = response.data;
            
            this.accessToken = access_token;
            this.refreshToken = refresh_token;
            this.tokenExpiresAt = Date.now() + expires_in * 1000;
            
            console.log('✅ Access token обновлен успешно');
            console.log(`🔑 Новый токен: ${access_token.substring(0, 20)}...`);
            console.log(`🔄 Новый refresh token: ${refresh_token.substring(0, 20)}...`);
            console.log(`⏰ Новое время истечения: ${new Date(this.tokenExpiresAt).toLocaleString()}`);
            
            // Сохраняем токены в БД
            await this.saveTokensToDatabase(access_token, refresh_token, this.tokenExpiresAt);
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка обновления токена:');
            if (error.response) {
                console.log(`   Статус: ${error.response.status}`);
                console.log(`   Данные:`, error.response.data);
            } else {
                console.log(`   Сообщение: ${error.message}`);
            }
            throw error;
        }
    }

    async saveTokensToDatabase(accessToken, refreshToken, expiresAt) {
        try {
            await db.run(
                `INSERT OR REPLACE INTO amocrm_tokens (id, access_token, refresh_token, expires_at, created_at) 
                 VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [accessToken, refreshToken, expiresAt]
            );
            console.log('✅ Токены сохранены в БД');
        } catch (error) {
            console.error('❌ Ошибка сохранения токенов в БД:', error.message);
        }
    }

    async loadTokensFromDatabase() {
        try {
            const tokens = await db.get('SELECT * FROM amocrm_tokens WHERE id = 1');
            if (tokens) {
                console.log('📂 Найдены токены в базе данных');
                console.log(`🔑 Токен: ${tokens.access_token.substring(0, 20)}...`);
                console.log(`🔄 Refresh: ${tokens.refresh_token.substring(0, 20)}...`);
                console.log(`⏰ Истекает: ${new Date(tokens.expires_at).toLocaleString()}`);
                
                this.accessToken = tokens.access_token;
                this.refreshToken = tokens.refresh_token;
                this.tokenExpiresAt = tokens.expires_at;
                
                // Проверяем не истек ли токен
                const now = Date.now();
                if (now < this.tokenExpiresAt - 60000) { // Запас 1 минута
                    console.log('✅ Токен из БД валиден');
                    return true;
                } else {
                    console.log('🔄 Токен из БД истек, обновляем...');
                    try {
                        await this.refreshAccessToken();
                        return true;
                    } catch (refreshError) {
                        console.log('❌ Не удалось обновить токен из БД:', refreshError.message);
                        return false;
                    }
                }
            }
            console.log('📭 Токены в БД не найдены');
            return false;
        } catch (error) {
            console.error('❌ Ошибка загрузки токенов из БД:', error.message);
            return false;
        }
    }

    async makeRequest(method, endpoint, data = null, retry = true) {
        if (!this.isInitialized || !this.accessToken) {
            throw new Error('amoCRM не инициализирован или токен отсутствует');
        }

        // Проверяем не истек ли токен
        if (Date.now() > this.tokenExpiresAt - 60000) { // Запас 1 минута
            console.log('🔄 Токен скоро истекает, обновляем...');
            try {
                await this.refreshAccessToken();
            } catch (refreshError) {
                throw new Error(`Не удалось обновить токен: ${refreshError.message}`);
            }
        }

        const url = `${this.baseUrl}${endpoint}`;
        console.log(`🌐 ${method} ${url}`);
        
        try {
            const config = {
                method: method,
                url: url,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'ArtSchoolBot/1.0'
                },
                timeout: 20000
            };

            if (data) {
                console.log('📦 Данные запроса:', JSON.stringify(data, null, 2).substring(0, 200) + '...');
                config.data = data;
            }

            const response = await axios(config);
            console.log(`✅ Запрос успешен: ${response.status}`);
            
            if (response.data && typeof response.data === 'object') {
                console.log(`📊 Данные получены:`, Object.keys(response.data).join(', '));
            }
            
            return response.data;
            
        } catch (error) {
            console.error(`❌ Ошибка запроса к amoCRM:`);
            console.error(`   URL: ${method} ${url}`);
            
            if (error.response) {
                console.error(`   Статус: ${error.response.status}`);
                console.error(`   Данные:`, JSON.stringify(error.response.data, null, 2));
                console.error(`   Заголовки:`, error.response.headers);
            } else if (error.request) {
                console.error(`   Запрос отправлен, но ответ не получен`);
                console.error(`   Ошибка: ${error.message}`);
            } else {
                console.error(`   Ошибка настройки запроса: ${error.message}`);
            }
            
            // Если 401 ошибка и еще не пробовали обновить токен
            if (error.response?.status === 401 && retry) {
                console.log('🔄 Получена 401 ошибка, обновляем токен и повторяем запрос...');
                try {
                    await this.refreshAccessToken();
                    return await this.makeRequest(method, endpoint, data, false);
                } catch (refreshError) {
                    console.error('❌ Не удалось обновить токен после 401 ошибки');
                    throw error;
                }
            }
            
            throw error;
        }
    }

    async searchContactsByPhone(phoneNumber) {
        console.log(`\n🔍 ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ`);
        console.log(`📞 Исходный номер: ${phoneNumber}`);
        
        // Очищаем номер телефона
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        console.log(`🧹 Очищенный номер: ${cleanPhone}`);
        
        // Создаем варианты для поиска
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
                
                const encodedQuery = encodeURIComponent(phoneVariant);
                const response = await this.makeRequest('GET', `/api/v4/contacts?query=${encodedQuery}&limit=50`);
                
                if (response._embedded && response._embedded.contacts) {
                    const contacts = response._embedded.contacts;
                    console.log(`✅ Найдено контактов: ${contacts.length}`);
                    
                    // Добавляем информацию о телефонах в логи
                    contacts.forEach(contact => {
                        console.log(`   👤 ${contact.name} (ID: ${contact.id})`);
                        if (contact.custom_fields_values) {
                            const phones = contact.custom_fields_values
                                .filter(field => field.field_code === 'PHONE' || 
                                        field.field_name?.toLowerCase().includes('телефон') ||
                                        field.field_name?.toLowerCase().includes('phone'))
                                .flatMap(field => field.values?.map(v => v.value) || []);
                            if (phones.length > 0) {
                                console.log(`     📞 Телефоны: ${phones.join(', ')}`);
                            }
                        }
                    });
                    
                    allContacts = [...allContacts, ...contacts];
                } else {
                    console.log(`📭 Контактов не найдено`);
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
            const response = await this.makeRequest('GET', `/api/v4/contacts/${contactId}?with=leads,customers`);
            console.log(`✅ Детали контакта получены`);
            
            // Логируем все кастомные поля
            if (response.custom_fields_values) {
                console.log(`📋 Кастомные поля контакта:`);
                response.custom_fields_values.forEach(field => {
                    console.log(`   ${field.field_name} (${field.field_code}):`, 
                        field.values?.map(v => v.value).join(', ') || 'нет значений');
                });
            }
            
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения деталей контакта: ${error.message}`);
            throw error;
        }
    }

    async getLeadsByContactId(contactId) {
        console.log(`\n🔍 ПОЛУЧЕНИЕ СДЕЛОК КОНТАКТА ${contactId}`);
        try {
            const response = await this.makeRequest('GET', `/api/v4/leads?filter[contacts][id][]=${contactId}&with=catalog_elements`);
            console.log(`✅ Найдено сделок: ${response._embedded?.leads?.length || 0}`);
            
            if (response._embedded?.leads) {
                response._embedded.leads.forEach(lead => {
                    console.log(`   💼 ${lead.name} (ID: ${lead.id}, Цена: ${lead.price}, Статус: ${lead.status_id})`);
                });
            }
            
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return { _embedded: { leads: [] } };
        }
    }

    async getContactCustomFields() {
        console.log(`\n🔍 ПОЛУЧЕНИЕ КАСТОМНЫХ ПОЛЕЙ КОНТАКТОВ`);
        try {
            const response = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            const fields = response._embedded?.custom_fields || [];
            console.log(`✅ Получено полей: ${fields.length}`);
            
            // Логируем поля для отладки
            console.log(`📋 Список полей:`);
            fields.slice(0, 10).forEach(field => {
                console.log(`   ${field.id}. ${field.name} (${field.field_code}) - ${field.type}`);
            });
            if (fields.length > 10) {
                console.log(`   ... и еще ${fields.length - 10} полей`);
            }
            
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения кастомных полей: ${error.message}`);
            return { _embedded: { custom_fields: [] } };
        }
    }

    async parseContactToStudentProfile(contact) {
        console.log(`\n🔍 ПАРСИНГ КОНТАКТА В ПРОФИЛЬ`);
        console.log(`👤 Контакт: ${contact.name} (ID: ${contact.id})`);
        
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
            raw_contact_data: JSON.stringify(contact, null, 2)
        };
        
        // Парсим кастомные поля
        if (contact.custom_fields_values) {
            console.log(`📋 Кастомные поля для парсинга:`);
            
            for (const field of contact.custom_fields_values) {
                const fieldName = field.field_name?.toLowerCase() || '';
                const fieldCode = field.field_code || '';
                const fieldValues = field.values || [];
                
                if (fieldValues.length > 0) {
                    const value = fieldValues[0].value;
                    console.log(`   ${fieldName} (${fieldCode}): "${value}"`);
                    
                    // Телефоны
                    if (fieldCode === 'PHONE' || fieldName.includes('телефон') || fieldName.includes('phone')) {
                        profile.phone_number = value;
                        console.log(`     → Телефон: ${value}`);
                    }
                    
                    // Email
                    else if (fieldCode === 'EMAIL' || fieldName.includes('email') || fieldName.includes('почта') || fieldName.includes('e-mail')) {
                        profile.email = value;
                        console.log(`     → Email: ${value}`);
                    }
                    
                    // Филиал
                    else if (fieldName.includes('филиал') || fieldName.includes('branch') || 
                             fieldName.includes('отделение') || fieldName.includes('локация')) {
                        profile.branch = value;
                        console.log(`     → Филиал: ${value}`);
                    }
                    
                    // Родитель
                    else if (fieldName.includes('родитель') || fieldName.includes('parent') || 
                             fieldName.includes('мама') || fieldName.includes('папа') ||
                             fieldName.includes('контактное лицо')) {
                        profile.parent_name = value;
                        console.log(`     → Родитель: ${value}`);
                    }
                    
                    // Учитель
                    else if (fieldName.includes('преподаватель') || fieldName.includes('учитель') || 
                             fieldName.includes('teacher') || fieldName.includes('тренер') ||
                             fieldName.includes('педагог')) {
                        profile.teacher_name = value;
                        console.log(`     → Учитель: ${value}`);
                    }
                    
                    // День недели
                    else if ((fieldName.includes('день') && fieldName.includes('недели')) ||
                             fieldName.includes('день недели') || fieldName.includes('расписание') ||
                             fieldName.includes('дни занятий')) {
                        profile.day_of_week = value;
                        console.log(`     → День недели: ${value}`);
                    }
                    
                    // Время
                    else if (fieldName.includes('время') || fieldName.includes('time') ||
                             fieldName.includes('часы') || fieldName.includes('расписание')) {
                        profile.time_slot = value;
                        console.log(`     → Время: ${value}`);
                    }
                    
                    // Абонемент
                    else if (fieldName.includes('абонемент') || fieldName.includes('курс') ||
                             fieldName.includes('программа') || fieldName.includes('subscription')) {
                        profile.subscription_type = value;
                        console.log(`     → Абонемент: ${value}`);
                    }
                    
                    // Количество занятий
                    else if (fieldName.includes('количество') || fieldName.includes('занятий') ||
                             fieldName.includes('уроков') || fieldName.includes('всего')) {
                        const num = parseInt(value);
                        if (!isNaN(num)) {
                            profile.total_classes = num;
                            console.log(`     → Всего занятий: ${num}`);
                        }
                    }
                    
                    // Осталось занятий
                    else if (fieldName.includes('осталось') || fieldName.includes('остаток') ||
                             fieldName.includes('remaining')) {
                        const num = parseInt(value);
                        if (!isNaN(num)) {
                            profile.remaining_classes = num;
                            console.log(`     → Осталось занятий: ${num}`);
                        }
                    }
                    
                    // Дата окончания
                    else if (fieldName.includes('дата окончания') || fieldName.includes('до') ||
                             fieldName.includes('expiration') || fieldName.includes('действует до')) {
                        profile.expiration_date = value;
                        console.log(`     → Дата окончания: ${value}`);
                    }
                }
            }
        }
        
        console.log(`✅ Профиль создан:`);
        console.log(`   👤 Ученик: ${profile.student_name}`);
        console.log(`   📞 Телефон: ${profile.phone_number}`);
        console.log(`   🏢 Филиал: ${profile.branch}`);
        console.log(`   👩‍🏫 Учитель: ${profile.teacher_name}`);
        console.log(`   📅 Абонемент: ${profile.subscription_type} (${profile.remaining_classes}/${profile.total_classes})`);
        
        return profile;
    }

    async enrichProfileWithLeads(profile) {
        console.log(`\n🔍 ОБОГАЩЕНИЕ ПРОФИЛЯ ДАННЫМИ ИЗ СДЕЛОК`);
        
        try {
            const leadsResponse = await this.getLeadsByContactId(profile.amocrm_contact_id);
            
            if (leadsResponse._embedded && leadsResponse._embedded.leads.length > 0) {
                const lead = leadsResponse._embedded.leads[0];
                console.log(`✅ Найдена сделка: ${lead.name} (ID: ${lead.id})`);
                
                // Обновляем данные профиля из сделки
                if (lead.name && !profile.subscription_type.includes('Абонемент')) {
                    profile.subscription_type = lead.name;
                }
                
                if (lead.price && lead.price > 0) {
                    profile.total_classes = lead.price;
                    // По умолчанию считаем, что осталось 70% занятий
                    profile.remaining_classes = Math.floor(lead.price * 0.7);
                }
                
                // Парсим кастомные поля сделки
                if (lead.custom_fields_values) {
                    console.log(`📋 Кастомные поля сделки:`);
                    for (const field of lead.custom_fields_values) {
                        const fieldName = field.field_name?.toLowerCase() || '';
                        const fieldValues = field.values || [];
                        
                        if (fieldValues.length > 0) {
                            const value = fieldValues[0].value;
                            console.log(`   ${fieldName}: "${value}"`);
                            
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
            } else {
                console.log(`📭 Сделки не найдены`);
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
                
                console.log(`📊 Контактов найдено в amoCRM: ${contacts.length}`);
                
                // Парсим каждый контакт в профиль
                for (const contact of contacts) {
                    try {
                        console.log(`\n🔄 Обработка контакта: ${contact.name}`);
                        
                        // Получаем детали контакта
                        const contactDetails = await this.getContactDetails(contact.id);
                        
                        // Создаем профиль
                        let profile = await this.parseContactToStudentProfile(contactDetails);
                        
                        // Обогащаем данными из сделок
                        profile = await this.enrichProfileWithLeads(profile);
                        
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
        
        // Если в amoCRM не нашли или он не инициализирован, ищем в локальной базе
        if (profiles.length === 0) {
            console.log(`\n🔍 Поиск в локальной базе данных...`);
            try {
                const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);
                const localProfiles = await db.all(
                    `SELECT * FROM student_profiles 
                     WHERE phone_number LIKE ? AND is_active = 1
                     ORDER BY created_at DESC`,
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
        
        // Если ничего не нашли, создаем демо-профиль
        if (profiles.length === 0) {
            console.log(`\n🎭 Создаем демо-профиль...`);
            const demoProfile = this.createDemoProfile(phoneNumber);
            profiles.push(demoProfile);
        }
        
        console.log(`\n🎯 ИТОГО найдено профилей: ${profiles.length}`);
        
        return profiles;
    }

    createDemoProfile(phoneNumber) {
        const demoProfiles = [
            {
                student_name: 'Иван Иванов',
                parent_name: 'Мария Иванова',
                phone_number: phoneNumber,
                email: 'ivan@example.com',
                branch: 'Свиблово',
                subscription_type: 'Художественный курс для начинающих',
                total_classes: 12,
                remaining_classes: 5,
                expiration_date: '2024-12-31',
                teacher_name: 'Анна Петрова',
                day_of_week: 'понедельник',
                time_slot: '16:00-17:30',
                is_demo: true
            },
            {
                student_name: 'Мария Сидорова',
                parent_name: 'Ольга Сидорова',
                phone_number: phoneNumber,
                email: 'maria@example.com',
                branch: 'Чертаново',
                subscription_type: 'Курс акварельной живописи',
                total_classes: 16,
                remaining_classes: 8,
                expiration_date: '2024-11-30',
                teacher_name: 'Сергей Смирнов',
                day_of_week: 'среда',
                time_slot: '16:30-18:00',
                is_demo: true
            }
        ];
        
        return demoProfiles[Math.floor(Math.random() * demoProfiles.length)];
    }

    async syncAllData() {
        console.log('\n🔄 ЗАПУСК ПОЛНОЙ СИНХРОНИЗАЦИИ ДАННЫХ');
        
        if (!this.isInitialized) {
            console.log('⚠️  amoCRM не инициализирован, используем локальные данные');
            await this.syncDemoData();
            return false;
        }
        
        try {
            await this.syncTeachersFromAmo();
            await this.syncStudentsFromAmo();
            await this.syncSubscriptionsFromAmo();
            
            console.log('✅ Полная синхронизация завершена');
            return true;
        } catch (error) {
            console.error('❌ Ошибка синхронизации:', error.message);
            await this.syncDemoData();
            return false;
        }
    }

    async syncTeachersFromAmo() {
        console.log('\n🔄 СИНХРОНИЗАЦИЯ ПРЕПОДАВАТЕЛЕЙ');
        
        if (!this.isInitialized) {
            return await this.syncDemoTeachers();
        }
        
        try {
            const response = await this.makeRequest('GET', '/api/v4/users');
            const users = response._embedded?.users || [];
            
            console.log(`📊 Найдено пользователей: ${users.length}`);
            
            let syncedCount = 0;
            for (const user of users) {
                try {
                    // Проверяем, есть ли уже такой преподаватель
                    const existing = await db.get(
                        'SELECT id FROM teachers WHERE amocrm_user_id = ?',
                        [user.id]
                    );
                    
                    const teacherData = {
                        name: user.name || 'Не указано',
                        email: user.email || '',
                        phone_number: user.phone || '',
                        amocrm_user_id: user.id,
                        is_active: 1
                    };
                    
                    if (!existing) {
                        await db.run(
                            `INSERT INTO teachers (name, email, phone_number, amocrm_user_id, is_active) 
                             VALUES (?, ?, ?, ?, ?)`,
                            [teacherData.name, teacherData.email, teacherData.phone_number, 
                             teacherData.amocrm_user_id, teacherData.is_active]
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
                    }
                } catch (userError) {
                    console.error(`❌ Ошибка пользователя ${user.id}: ${userError.message}`);
                }
            }
            
            console.log(`✅ Синхронизировано преподавателей: ${syncedCount}`);
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации преподавателей:', error.message);
            await this.syncDemoTeachers();
        }
    }

    async syncDemoTeachers() {
        console.log('\n📝 ЗАГРУЗКА ДЕМО-ПРЕПОДАВАТЕЛЕЙ');
        
        try {
            const demoTeachers = [
                ['Анна Петрова', 'https://via.placeholder.com/300x300/4A90E2/FFFFFF?text=АП', 
                 'Художник-педагог, член Союза художников России', 
                 'Академический рисунок, графика', 8,
                 'Опытный преподаватель с 8-летним стажем. Специализируется на академическом рисунке и графике.',
                 '["Свиблово"]', '@anna_petrova', '+79997778899', 'anna@artschool.ru', null, 1],
                 
                ['Сергей Смирнов', 'https://via.placeholder.com/300x300/9C6ADE/FFFFFF?text=СС',
                 'Художник-живописец, преподаватель с 10-летним стажем',
                 'Акварель, масляная живопись', 10,
                 'Эксперт в акварельной и масляной живописи. Работы учеников регулярно участвуют в выставках.',
                 '["Чертаново"]', '@sergey_smirnov', '+79996667788', 'sergey@artschool.ru', null, 2],
                 
                ['Елена Ковалева', 'https://via.placeholder.com/300x300/FFC107/FFFFFF?text=ЕК',
                 'Иллюстратор, дизайнер, преподаватель детских групп',
                 'Скетчинг, иллюстрация, детское творчество', 6,
                 'Специализируется на работе с детьми. Разработала авторскую методику обучения рисованию для детей.',
                 '["Свиблово", "Чертаново"]', '@elena_kovaleva', '+79995554433', 'elena@artschool.ru', null, 3]
            ];
            
            let addedCount = 0;
            for (const teacher of demoTeachers) {
                const existing = await db.get('SELECT 1 FROM teachers WHERE name = ?', [teacher[0]]);
                if (!existing) {
                    await db.run(
                        `INSERT INTO teachers (name, photo_url, qualification, specialization, 
                         experience_years, description, branches, telegram_username, 
                         phone_number, email, amocrm_user_id, display_order) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        teacher
                    );
                    addedCount++;
                }
            }
            
            console.log(`✅ Демо-преподаватели загружены: добавлено ${addedCount}`);
            
        } catch (error) {
            console.error('❌ Ошибка загрузки демо-преподавателей:', error.message);
        }
    }

    async syncStudentsFromAmo() {
        console.log('\n🔄 СИНХРОНИЗАЦИЯ УЧЕНИКОВ');
        
        if (!this.isInitialized) {
            return await this.syncDemoStudents();
        }
        
        try {
            // Получаем контакты с лимитом 100
            const response = await this.makeRequest('GET', '/api/v4/contacts?with=leads&limit=100');
            const contacts = response._embedded?.contacts || [];
            
            console.log(`📊 Контактов для синхронизации: ${contacts.length}`);
            
            let syncedCount = 0;
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
                              expiration_date, teacher_name, day_of_week, time_slot, amocrm_custom_fields, is_active) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                profile.amocrm_contact_id,
                                profile.student_name,
                                profile.parent_name,
                                profile.phone_number,
                                profile.email,
                                profile.branch,
                                profile.subscription_type,
                                profile.total_classes,
                                profile.remaining_classes,
                                profile.expiration_date,
                                profile.teacher_name,
                                profile.day_of_week,
                                profile.time_slot,
                                JSON.stringify(profile.custom_fields),
                                1
                            ]
                        );
                        console.log(`✅ Добавлен: ${profile.student_name}`);
                        syncedCount++;
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
                                profile.parent_name,
                                profile.phone_number,
                                profile.email,
                                profile.branch,
                                profile.subscription_type,
                                profile.total_classes,
                                profile.remaining_classes,
                                profile.expiration_date,
                                profile.teacher_name,
                                profile.day_of_week,
                                profile.time_slot,
                                JSON.stringify(profile.custom_fields),
                                contact.id
                            ]
                        );
                        console.log(`🔄 Обновлен: ${profile.student_name}`);
                    }
                } catch (contactError) {
                    console.error(`❌ Ошибка контакта ${contact.id}: ${contactError.message}`);
                }
            }
            
            console.log(`✅ Синхронизировано учеников: ${syncedCount}`);
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации учеников:', error.message);
            await this.syncDemoStudents();
        }
    }

    async syncDemoStudents() {
        console.log('\n📝 ЗАГРУЗКА ДЕМО-УЧЕНИКОВ');
        
        try {
            const demoStudents = [
                [null, 'Иван Иванов', 'Мария Иванова', '+79991234567', 'ivan@example.com', 
                 'Свиблово', 'Художественный курс для начинающих', 12, 5, 
                 '2024-12-31', 'Анна Петрова', 'понедельник', '16:00-17:30'],
                 
                [null, 'Мария Сидорова', 'Ольга Сидорова', '+79997654321', 'maria@example.com',
                 'Чертаново', 'Курс акварельной живописи', 16, 8,
                 '2024-11-30', 'Сергей Смирнов', 'среда', '16:30-18:00'],
                 
                [null, 'Алексей Петров', 'Елена Петрова', '+79995556677', 'alexey@example.com',
                 'Свиблово', 'Курс масляной живописи', 8, 3,
                 '2024-10-15', 'Сергей Смирнов', 'пятница', '18:00-19:30']
            ];
            
            let addedCount = 0;
            for (const student of demoStudents) {
                const existing = await db.get(
                    'SELECT 1 FROM student_profiles WHERE student_name = ? AND phone_number = ?',
                    [student[1], student[3]]
                );
                
                if (!existing) {
                    await db.run(
                        `INSERT INTO student_profiles 
                         (amocrm_contact_id, student_name, parent_name, phone_number, email,
                          branch, subscription_type, total_classes, remaining_classes,
                          expiration_date, teacher_name, day_of_week, time_slot, is_active)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [...student, 1]
                    );
                    addedCount++;
                }
            }
            
            console.log(`✅ Демо-ученики загружены: добавлено ${addedCount}`);
            
        } catch (error) {
            console.error('❌ Ошибка загрузки демо-учеников:', error.message);
        }
    }

    async syncSubscriptionsFromAmo() {
        console.log('\n🔄 СИНХРОНИЗАЦИЯ АБОНЕМЕНТОВ');
        
        if (!this.isInitialized) {
            return;
        }
        
        try {
            // Получаем активные сделки
            const response = await this.makeRequest('GET', '/api/v4/leads?filter[statuses][][status_id]=142&limit=100');
            const leads = response._embedded?.leads || [];
            
            console.log(`📊 Активных сделок: ${leads.length}`);
            
            let updatedCount = 0;
            for (const lead of leads) {
                try {
                    // Получаем контакты сделки
                    if (lead._embedded && lead._embedded.contacts) {
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

    async syncDemoData() {
        await this.syncDemoTeachers();
        await this.syncDemoStudents();
        console.log('✅ Все демо-данные загружены');
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
        
        // Создаем демо-данные
        await createDemoData();
        
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

// ==================== ДЕМО ДАННЫЕ ====================
const createDemoData = async () => {
    try {
        console.log('\n📝 СОЗДАНИЕ ДЕМО-ДАННЫХ');
        
        // Проверяем, есть ли уже данные
        const hasData = await db.get("SELECT 1 FROM administrators LIMIT 1");
        
        if (hasData) {
            console.log('📂 Демо-данные уже существуют');
            return;
        }

        // Демо администраторы
        console.log('👥 Создание демо-администраторов...');
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

        // Демо расписание
        console.log('📅 Создание демо-расписания...');
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
        console.log('❓ Создание демо-FAQ...');
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
        console.log('📰 Создание демо-новостей...');
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

        console.log('\n🎉 Все демо-данные созданы успешно!');
        
    } catch (error) {
        console.error('⚠️  Ошибка создания демо-данных:', error.message);
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
            client_id: !!AMOCRM_CLIENT_ID,
            access_token: !!amoCrmService.accessToken,
            refresh_token: !!amoCrmService.refreshToken,
            using_demo_data: !amoCrmService.isInitialized,
            base_url: amoCrmService.baseUrl,
            token_expires_at: amoCrmService.tokenExpiresAt ? 
                new Date(amoCrmService.tokenExpiresAt).toLocaleString() : 'Не установлено'
        };
        
        console.log('📊 Статус amoCRM запрошен:', status);
        
        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('❌ Ошибка статуса amoCRM:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статуса amoCRM'
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
        
        console.log(`\n🔍 ДИАГНОСТИКА ЗАПРОШЕНА`);
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
                base_url: amoCrmService.baseUrl
            }
        };
        
        if (!amoCrmService.isInitialized) {
            diagnostics.error = 'amoCRM не инициализирован';
            diagnostics.suggestions = [
                'Проверьте AMOCRM_DOMAIN в .env файле',
                'Проверьте AMOCRM_CLIENT_ID и AMOCRM_CLIENT_SECRET',
                'Получите код авторизации через OAuth',
                'Или добавьте AMOCRM_ACCESS_TOKEN напрямую'
            ];
            
            // Показываем ссылку для авторизации
            if (AMOCRM_CLIENT_ID) {
                diagnostics.oauth_url = `https://www.amocrm.ru/oauth?client_id=${AMOCRM_CLIENT_ID}&state=art_school`;
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
                accountInfo = await amoCrmService.makeRequest('GET', '/api/v4/account');
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
                const fields = customFields._embedded?.custom_fields || [];
                diagnostics.custom_fields = {
                    count: fields.length,
                    sample: fields.slice(0, 5).map(f => ({
                        id: f.id,
                        name: f.name,
                        code: f.field_code,
                        type: f.type
                    }))
                };
                console.log(`✅ Кастомных полей: ${fields.length}`);
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
                    contacts: contacts.map(c => ({
                        id: c.id,
                        name: c.name,
                        phones: c.custom_fields_values
                            ?.filter(f => f.field_code === 'PHONE' || 
                                    f.field_name?.toLowerCase().includes('телефон'))
                            ?.flatMap(f => f.values?.map(v => v.value) || []) || [],
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
                                field_name: f.field_name,
                                field_code: f.field_code,
                                values: f.values?.map(v => v.value) || []
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
            
            // 4. Поиск в локальной базе
            console.log(`\n📊 ТЕСТ 5: Поиск в локальной базе`);
            try {
                const cleanPhone = phone.replace(/\D/g, '').slice(-10);
                const localProfiles = await db.all(
                    `SELECT * FROM student_profiles 
                     WHERE phone_number LIKE ? 
                     LIMIT ?`,
                    [`%${cleanPhone}%`, limit]
                );
                diagnostics.local_profiles = {
                    count: localProfiles.length,
                    profiles: localProfiles.map(p => ({
                        id: p.id,
                        student_name: p.student_name,
                        phone_number: p.phone_number,
                        branch: p.branch,
                        is_demo: p.is_demo
                    }))
                };
                console.log(`✅ Найдено в локальной базе: ${localProfiles.length}`);
            } catch (dbError) {
                diagnostics.db_error = dbError.message;
                console.log(`❌ Ошибка локальной базы: ${dbError.message}`);
            }
            
            res.json({
                success: true,
                diagnostics,
                summary: {
                    amocrm_contacts_found: diagnostics.search_results?.contacts_found || 0,
                    local_profiles_found: diagnostics.local_profiles?.count || 0,
                    custom_fields_count: diagnostics.custom_fields?.count || 0,
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
            details: error.message
        });
    }
});

// Комплексный тест amoCRM
app.get('/api/debug/amocrm-test', async (req, res) => {
    try {
        console.log('\n🧪 КОМПЛЕКСНЫЙ ТЕСТ AMOCRM');
        
        const tests = [];
        
        // Тест 1: Проверка инициализации
        tests.push({
            name: 'Проверка инициализации',
            success: amoCrmService.isInitialized,
            data: {
                is_initialized: amoCrmService.isInitialized,
                domain: AMOCRM_DOMAIN,
                has_access_token: !!amoCrmService.accessToken,
                has_refresh_token: !!amoCrmService.refreshToken
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
                    AMOCRM_AUTH_CODE: AMOCRM_AUTH_CODE ? '✅ Установлен' : '❌ Не установлен'
                },
                oauth_url: AMOCRM_CLIENT_ID ? 
                    `https://www.amocrm.ru/oauth?client_id=${AMOCRM_CLIENT_ID}&state=art_school` : 
                    'Требуется AMOCRM_CLIENT_ID'
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
                    timezone: accountInfo.timezone
                }
            });
        } catch (error) {
            tests.push({
                name: 'Получение информации об аккаунте',
                success: false,
                error: error.message,
                status: error.response?.status
            });
        }
        
        // Тест 3: Получение кастомных полей контактов
        try {
            const customFields = await amoCrmService.getContactCustomFields();
            const fields = customFields._embedded?.custom_fields || [];
            tests.push({
                name: 'Получение кастомных полей контактов',
                success: true,
                data: {
                    fields_count: fields.length,
                    phone_fields: fields.filter(f => 
                        f.field_code === 'PHONE' || 
                        f.name?.toLowerCase().includes('телефон')).map(f => f.name),
                    sample_fields: fields.slice(0, 5).map(f => ({
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
                error: error.message,
                status: error.response?.status
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
                        phones: contacts[0].custom_fields_values
                            ?.filter(f => f.field_code === 'PHONE')
                            ?.flatMap(f => f.values?.map(v => v.value) || []) || []
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
        
        // Тест 5: Проверка работы с БД
        try {
            const dbTest = await db.all('SELECT COUNT(*) as count FROM student_profiles');
            tests.push({
                name: 'Проверка локальной базы данных',
                success: true,
                data: {
                    student_profiles_count: dbTest[0].count
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
            failed_tests: tests.filter(t => !t.success).length
        };
        
        console.log(`📊 ИТОГИ ТЕСТА: ${summary.passed_tests}/${summary.total_tests} успешно`);
        
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
            details: error.message
        });
    }
});

// Синхронизация данных
app.post('/api/amocrm/sync', async (req, res) => {
    try {
        const { sync_type } = req.body;
        
        console.log(`\n🔄 ЗАПРОС СИНХРОНИЗАЦИИ: ${sync_type || 'all'}`);
        
        let result;
        switch (sync_type) {
            case 'teachers':
                result = await amoCrmService.syncTeachersFromAmo();
                break;
            case 'students':
                result = await amoCrmService.syncStudentsFromAmo();
                break;
            case 'subscriptions':
                result = await amoCrmService.syncSubscriptionsFromAmo();
                break;
            case 'all':
            default:
                result = await amoCrmService.syncAllData();
                break;
        }
        
        res.json({
            success: true,
            message: `Синхронизация ${sync_type || 'all'} завершена`,
            using_demo_data: !amoCrmService.isInitialized,
            result: result
        });
        
    } catch (error) {
        console.error('❌ Ошибка синхронизации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка синхронизации с amoCRM',
            using_demo_data: !amoCrmService.isInitialized
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
        using_demo_data: !amoCrmService.isInitialized,
        endpoints: {
            status: '/api/status',
            amocrm_status: '/api/amocrm/status',
            debug_contacts: '/api/debug/amocrm-contacts?phone=79991234567',
            debug_test: '/api/debug/amocrm-test',
            auth_phone: 'POST /api/auth/phone',
            teachers: '/api/teachers',
            schedule: 'POST /api/schedule'
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
                using_demo_data: !amoCrmService.isInitialized,
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

// Авторизация по номеру телефона (ОБНОВЛЕННЫЙ)
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
        
        if (profiles.length === 0) {
            console.log(`📭 Профили не найдены`);
            
            const response = {
                success: true,
                message: 'Профили не найдены',
                data: {
                    profiles: [],
                    total_profiles: 0,
                    amocrm_connected: amoCrmService.isInitialized,
                    using_demo_data: !amoCrmService.isInitialized,
                    search_details: {
                        phone_used: formattedPhone,
                        search_method: amoCrmService.isInitialized ? 'amoCRM API' : 'Local Database',
                        has_demo_data: profiles.some(p => p.is_demo) || false
                    }
                }
            };
            
            return res.json(response);
        }
        
        console.log(`✅ Профили найдены`);
        
        // Создаем временного пользователя для сессии
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            first_name: profiles[0].student_name?.split(' ')[0] || 'Ученик',
            last_name: profiles[0].student_name?.split(' ')[1] || '',
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
            message: 'Авторизация успешна',
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
                    raw_contact_data: p.raw_contact_data ? JSON.parse(p.raw_contact_data) : null
                })),
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                using_demo_data: !amoCrmService.isInitialized,
                token: token,
                search_details: {
                    phone_used: formattedPhone,
                    search_method: amoCrmService.isInitialized ? 'amoCRM API' : 'Local Database',
                    has_demo_data: profiles.some(p => p.is_demo) || false,
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
                    demo_data: {
                        demo_students: demoStats.demo_count || 0,
                        real_students: demoStats.real_count || 0,
                        using_demo: !amoCrmService.isInitialized
                    },
                    amocrm_connected: amoCrmService.isInitialized
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
            oauth_url: authUrl
        }
    });
});
// Полная диагностика всех активных абонементов и пользователей
app.get('/api/debug/subscriptions-full', async (req, res) => {
    try {
        console.log('\n' + '='.repeat(100));
        console.log('🔍 ПОЛНАЯ ДИАГНОСТИКА АКТИВНЫХ АБОНЕМЕНТОВ');
        console.log('='.repeat(100));
        
        const diagnostics = {
            timestamp: new Date().toISOString(),
            amocrm_status: {
                initialized: amoCrmService.isInitialized,
                domain: AMOCRM_DOMAIN,
                using_demo_data: !amoCrmService.isInitialized
            },
            summary: {},
            active_subscriptions: [],
            expired_subscriptions: [],
            users_without_subscriptions: [],
            subscription_statistics: {},
            branch_statistics: {},
            teacher_statistics: {},
            raw_data_sample: {}
        };

        // 1. СТАТИСТИКА ПО ВСЕМ АБОНЕМЕНТАМ
        console.log('\n📊 1. СТАТИСТИКА ПО АБОНЕМЕНТАМ:');
        
        const allSubscriptions = await db.all(`
            SELECT 
                sp.*,
                tu.telegram_id,
                tu.first_name as telegram_first_name,
                tu.last_name as telegram_last_name,
                tu.username as telegram_username
            FROM student_profiles sp
            LEFT JOIN telegram_users tu ON sp.telegram_user_id = tu.id
            WHERE sp.is_active = 1
            ORDER BY sp.branch, sp.student_name
        `);

        console.log(`📈 Всего активных профилей: ${allSubscriptions.length}`);

        // 2. АКТИВНЫЕ АБОНЕМЕНТЫ (есть занятия и дата не истекла)
        const activeSubs = allSubscriptions.filter(profile => {
            const hasClasses = profile.remaining_classes > 0;
            const isNotExpired = !profile.expiration_date || 
                new Date(profile.expiration_date) >= new Date();
            const hasSubscription = profile.subscription_type && 
                profile.subscription_type !== 'Без абонемента';
            
            return hasClasses && isNotExpired && hasSubscription;
        });

        console.log(`✅ Активных абонементов: ${activeSubs.length}`);

        // 3. ИСТЕКШИЕ АБОНЕМЕНТЫ
        const expiredSubs = allSubscriptions.filter(profile => {
            const hasExpired = profile.expiration_date && 
                new Date(profile.expiration_date) < new Date();
            const hasSubscription = profile.subscription_type && 
                profile.subscription_type !== 'Без абонемента';
            
            return hasExpired && hasSubscription;
        });

        console.log(`⏰ Истекших абонементов: ${expiredSubs.length}`);

        // 4. БЕЗ АБОНЕМЕНТА
        const noSubscriptions = allSubscriptions.filter(profile => {
            return !profile.subscription_type || 
                   profile.subscription_type === 'Без абонемента' ||
                   profile.remaining_classes === 0;
        });

        console.log(`📭 Без абонемента: ${noSubscriptions.length}`);

        // 5. СТАТИСТИКА ПО ФИЛИАЛАМ
        console.log('\n🏢 2. СТАТИСТИКА ПО ФИЛИАЛАМ:');
        const branchStats = {};
        
        activeSubs.forEach(profile => {
            const branch = profile.branch || 'Не указан';
            if (!branchStats[branch]) {
                branchStats[branch] = {
                    count: 0,
                    total_classes: 0,
                    remaining_classes: 0,
                    subscriptions: []
                };
            }
            branchStats[branch].count++;
            branchStats[branch].total_classes += profile.total_classes || 0;
            branchStats[branch].remaining_classes += profile.remaining_classes || 0;
            branchStats[branch].subscriptions.push(profile.subscription_type);
        });

        Object.keys(branchStats).forEach(branch => {
            console.log(`   ${branch}:`);
            console.log(`     👥 Учеников: ${branchStats[branch].count}`);
            console.log(`     📚 Всего занятий: ${branchStats[branch].total_classes}`);
            console.log(`     ✅ Осталось занятий: ${branchStats[branch].remaining_classes}`);
            
            // Уникальные типы абонементов
            const uniqueSubs = [...new Set(branchStats[branch].subscriptions)];
            console.log(`     🎫 Типы абонементов: ${uniqueSubs.length}`);
            uniqueSubs.forEach((sub, idx) => {
                const count = branchStats[branch].subscriptions.filter(s => s === sub).length;
                console.log(`       ${idx + 1}. ${sub}: ${count} учеников`);
            });
        });

        // 6. СТАТИСТИКА ПО ПРЕПОДАВАТЕЛЯМ
        console.log('\n👩‍🏫 3. СТАТИСТИКА ПО ПРЕПОДАВАТЕЛЯМ:');
        const teacherStats = {};
        
        activeSubs.forEach(profile => {
            const teacher = profile.teacher_name || 'Не указан';
            if (!teacherStats[teacher]) {
                teacherStats[teacher] = {
                    count: 0,
                    branches: new Set(),
                    total_classes: 0,
                    remaining_classes: 0
                };
            }
            teacherStats[teacher].count++;
            teacherStats[teacher].branches.add(profile.branch);
            teacherStats[teacher].total_classes += profile.total_classes || 0;
            teacherStats[teacher].remaining_classes += profile.remaining_classes || 0;
        });

        Object.keys(teacherStats).forEach(teacher => {
            console.log(`   ${teacher}:`);
            console.log(`     👥 Учеников: ${teacherStats[teacher].count}`);
            console.log(`     🏢 Филиалы: ${Array.from(teacherStats[teacher].branches).join(', ')}`);
            console.log(`     📚 Всего занятий: ${teacherStats[teacher].total_classes}`);
            console.log(`     ✅ Осталось занятий: ${teacherStats[teacher].remaining_classes}`);
        });

        // 7. АНАЛИЗ СРОКОВ ДЕЙСТВИЯ
        console.log('\n📅 4. АНАЛИЗ СРОКОВ ДЕЙСТВИЯ:');
        
        const today = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(today.getDate() + 7);
        const nextMonth = new Date();
        nextMonth.setDate(today.getDate() + 30);

        const expiringSoon = activeSubs.filter(profile => {
            if (!profile.expiration_date) return false;
            const expDate = new Date(profile.expiration_date);
            return expDate >= today && expDate <= nextMonth;
        });

        const expiringThisWeek = expiringSoon.filter(profile => {
            const expDate = new Date(profile.expiration_date);
            return expDate <= nextWeek;
        });

        console.log(`   📅 Истекают в этом месяце: ${expiringSoon.length}`);
        console.log(`   ⚠️  Истекают на этой неделе: ${expiringThisWeek.length}`);

        // 8. ПОДРОБНАЯ ИНФОРМАЦИЯ ОБ АКТИВНЫХ АБОНЕМЕНТАХ
        console.log('\n📋 5. ПОДРОБНЫЙ СПИСОК АКТИВНЫХ АБОНЕМЕНТОВ:');
        
        const detailedActiveSubs = await Promise.all(activeSubs.slice(0, 50).map(async (profile) => {
            // Получаем историю посещений
            const visits = await db.all(`
                SELECT * FROM attendance 
                WHERE student_profile_id = ?
                ORDER BY attendance_date DESC
                LIMIT 5
            `, [profile.id]);

            // Получаем расписание
            const schedule = await db.get(`
                SELECT * FROM schedule 
                WHERE branch = ? AND teacher_name LIKE ?
                AND day_of_week LIKE ? AND is_active = 1
                LIMIT 1
            `, [
                profile.branch,
                `%${profile.teacher_name || ''}%`,
                `%${profile.day_of_week || ''}%`
            ]);

            // Рассчитываем прогресс
            const total = profile.total_classes || 1;
            const remaining = profile.remaining_classes || 0;
            const used = total - remaining;
            const progressPercent = total > 0 ? Math.round((used / total) * 100) : 0;

            // Определяем статус
            let status = 'active';
            if (profile.expiration_date && new Date(profile.expiration_date) < today) {
                status = 'expired';
            } else if (remaining === 0) {
                status = 'used';
            } else if (remaining <= 3) {
                status = 'low';
            }

            return {
                id: profile.id,
                student_name: profile.student_name,
                parent_name: profile.parent_name,
                phone_number: profile.phone_number,
                email: profile.email,
                branch: profile.branch,
                subscription_type: profile.subscription_type,
                total_classes: total,
                remaining_classes: remaining,
                used_classes: used,
                progress_percent: progressPercent,
                expiration_date: profile.expiration_date,
                teacher_name: profile.teacher_name,
                day_of_week: profile.day_of_week,
                time_slot: profile.time_slot,
                status: status,
                is_demo: profile.is_demo || 0,
                telegram_user: profile.telegram_id ? {
                    id: profile.telegram_id,
                    username: profile.telegram_username,
                    name: `${profile.telegram_first_name || ''} ${profile.telegram_last_name || ''}`.trim()
                } : null,
                recent_visits: visits.length,
                schedule_info: schedule ? {
                    group_name: schedule.group_name,
                    room_number: schedule.room_number,
                    start_time: schedule.start_time,
                    end_time: schedule.end_time
                } : null
            };
        }));

        // 9. ФОРМИРУЕМ ОТВЕТ
        diagnostics.summary = {
            total_profiles: allSubscriptions.length,
            active_subscriptions: activeSubs.length,
            expired_subscriptions: expiredSubs.length,
            without_subscriptions: noSubscriptions.length,
            expiring_this_week: expiringThisWeek.length,
            expiring_this_month: expiringSoon.length
        };

        diagnostics.active_subscriptions = detailedActiveSubs;
        
        diagnostics.expired_subscriptions = expiredSubs.slice(0, 20).map(profile => ({
            student_name: profile.student_name,
            phone_number: profile.phone_number,
            branch: profile.branch,
            subscription_type: profile.subscription_type,
            expiration_date: profile.expiration_date,
            days_expired: profile.expiration_date ? 
                Math.floor((today - new Date(profile.expiration_date)) / (1000 * 60 * 60 * 24)) : null
        }));

        diagnostics.users_without_subscriptions = noSubscriptions.slice(0, 20).map(profile => ({
            student_name: profile.student_name,
            phone_number: profile.phone_number,
            branch: profile.branch,
            teacher_name: profile.teacher_name,
            last_seen: profile.updated_at
        }));

        diagnostics.subscription_statistics = {
            by_type: {},
            by_status: {
                active: activeSubs.length,
                expired: expiredSubs.length,
                used: allSubscriptions.filter(p => p.remaining_classes === 0 && p.total_classes > 0).length,
                without: noSubscriptions.length
            }
        };

        // Статистика по типам абонементов
        const subscriptionTypes = {};
        activeSubs.forEach(profile => {
            const type = profile.subscription_type || 'Не указан';
            subscriptionTypes[type] = (subscriptionTypes[type] || 0) + 1;
        });

        diagnostics.subscription_statistics.by_type = subscriptionTypes;

        diagnostics.branch_statistics = branchStats;
        diagnostics.teacher_statistics = teacherStats;

        // 10. СЫРЫЕ ДАННЫЕ ДЛЯ ОТЛАДКИ (первые 3 записи)
        diagnostics.raw_data_sample = {
            amocrm_initialized: amoCrmService.isInitialized,
            sample_profiles: allSubscriptions.slice(0, 3).map(p => ({
                id: p.id,
                name: p.student_name,
                phone: p.phone_number,
                subscription: p.subscription_type,
                classes: `${p.remaining_classes}/${p.total_classes}`,
                expiration: p.expiration_date,
                is_demo: p.is_demo
            }))
        };

        // 11. ВЫВОД В КОНСОЛЬ ИТОГОВ
        console.log('\n' + '='.repeat(100));
        console.log('📈 ИТОГОВАЯ СТАТИСТИКА:');
        console.log('='.repeat(100));
        console.log(`👥 Всего учеников: ${diagnostics.summary.total_profiles}`);
        console.log(`✅ Активных абонементов: ${diagnostics.summary.active_subscriptions}`);
        console.log(`⏰ Истекших абонементов: ${diagnostics.summary.expired_subscriptions}`);
        console.log(`📭 Без абонемента: ${diagnostics.summary.without_subscriptions}`);
        console.log(`⚠️  Истекают на этой неделе: ${diagnostics.summary.expiring_this_week}`);
        console.log(`📅 Истекают в этом месяце: ${diagnostics.summary.expiring_this_month}`);
        
        // Общее количество занятий
        const totalClasses = activeSubs.reduce((sum, p) => sum + (p.total_classes || 0), 0);
        const remainingClasses = activeSubs.reduce((sum, p) => sum + (p.remaining_classes || 0), 0);
        const usedClasses = totalClasses - remainingClasses;
        const utilizationRate = totalClasses > 0 ? Math.round((usedClasses / totalClasses) * 100) : 0;
        
        console.log(`\n📚 ОБЩАЯ СТАТИСТИКА ЗАНЯТИЙ:`);
        console.log(`   Всего занятий в абонементах: ${totalClasses}`);
        console.log(`   Использовано занятий: ${usedClasses}`);
        console.log(`   Осталось занятий: ${remainingClasses}`);
        console.log(`   Процент использования: ${utilizationRate}%`);
        
        // Средние показатели
        const avgClassesPerStudent = activeSubs.length > 0 ? 
            Math.round(totalClasses / activeSubs.length) : 0;
        const avgRemainingPerStudent = activeSubs.length > 0 ? 
            Math.round(remainingClasses / activeSubs.length) : 0;
        
        console.log(`\n📊 СРЕДНИЕ ПОКАЗАТЕЛИ:`);
        console.log(`   Среднее занятий на ученика: ${avgClassesPerStudent}`);
        console.log(`   Средний остаток занятий: ${avgRemainingPerStudent}`);
        
        // Топ абонементов
        console.log(`\n🏆 ТОП ТИПОВ АБОНЕМЕНТОВ:`);
        const sortedTypes = Object.entries(subscriptionTypes)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        sortedTypes.forEach(([type, count], index) => {
            console.log(`   ${index + 1}. ${type}: ${count} учеников`);
        });
        
        console.log('='.repeat(100));

        // 12. ВОЗВРАЩАЕМ ОТВЕТ
        res.json({
            success: true,
            diagnostics: diagnostics,
            export_info: {
                formats: ['json', 'csv', 'excel'],
                endpoints: {
                    json: '/api/debug/subscriptions-full',
                    csv: '/api/debug/subscriptions-full?format=csv',
                    active_only: '/api/debug/subscriptions-full?status=active',
                    expired_only: '/api/debug/subscriptions-full?status=expired'
                },
                filters_available: ['branch', 'teacher', 'status', 'expiration_date']
            }
        });

    } catch (error) {
        console.error('❌ Ошибка полной диагностики абонементов:', error.message);
        console.error('Stack trace:', error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Ошибка выполнения полной диагностики',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Экспорт в CSV
app.get('/api/debug/subscriptions-export', async (req, res) => {
    try {
        const { format = 'csv', status = 'active' } = req.query;
        
        console.log(`\n📤 ЭКСПОРТ ДАННЫХ АБОНЕМЕНТОВ`);
        console.log(`📝 Формат: ${format}, Статус: ${status}`);
        
        let query = `
            SELECT 
                sp.student_name,
                sp.parent_name,
                sp.phone_number,
                sp.email,
                sp.branch,
                sp.subscription_type,
                sp.total_classes,
                sp.remaining_classes,
                sp.expiration_date,
                sp.teacher_name,
                sp.day_of_week,
                sp.time_slot,
                sp.is_demo,
                sp.created_at,
                sp.updated_at
            FROM student_profiles sp
            WHERE sp.is_active = 1
        `;
        
        const params = [];
        
        if (status === 'active') {
            query += ` AND sp.remaining_classes > 0 
                       AND (sp.expiration_date IS NULL OR sp.expiration_date >= DATE('now'))`;
        } else if (status === 'expired') {
            query += ` AND sp.expiration_date < DATE('now')`;
        } else if (status === 'used') {
            query += ` AND sp.remaining_classes = 0 AND sp.total_classes > 0`;
        }
        
        query += ` ORDER BY sp.branch, sp.student_name`;
        
        const profiles = await db.all(query, params);
        
        if (format === 'csv') {
            // Заголовки CSV
            const headers = [
                'ФИО ученика',
                'Родитель',
                'Телефон',
                'Email',
                'Филиал',
                'Тип абонемента',
                'Всего занятий',
                'Осталось занятий',
                'Дата окончания',
                'Преподаватель',
                'День недели',
                'Время',
                'Демо-данные',
                'Дата создания',
                'Дата обновления'
            ];
            
            // Данные
            const rows = profiles.map(p => [
                p.student_name || '',
                p.parent_name || '',
                p.phone_number || '',
                p.email || '',
                p.branch || '',
                p.subscription_type || '',
                p.total_classes || 0,
                p.remaining_classes || 0,
                p.expiration_date || '',
                p.teacher_name || '',
                p.day_of_week || '',
                p.time_slot || '',
                p.is_demo ? 'Да' : 'Нет',
                p.created_at || '',
                p.updated_at || ''
            ]);
            
            // Создаем CSV
            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');
            
            // Устанавливаем заголовки для скачивания
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="subscriptions_${status}_${new Date().toISOString().split('T')[0]}.csv"`);
            
            res.send(csvContent);
            
        } else {
            // JSON формат
            res.json({
                success: true,
                data: {
                    profiles: profiles,
                    total: profiles.length,
                    status: status,
                    exported_at: new Date().toISOString()
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка экспорта данных:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка экспорта данных'
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
        
        // Инициализируем amoCRM после базы данных
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            console.log(`🔑 Токен: ${amoCrmService.accessToken ? '✅ Присутствует' : '❌ Отсутствует'}`);
        } else {
            console.log('⚠️  amoCRM не инициализирован, используются демо-данные');
            console.log('ℹ️  Для подключения amoCRM:');
            console.log('   1. Проверьте переменные окружения в .env файле');
            console.log('   2. Перейдите в админ-панель: http://localhost:3000/admin');
            console.log('   3. Используйте OAuth авторизацию');
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
            console.log(`🎭 Режим: ${amoCrmService.isInitialized ? 'Реальные данные' : 'Демо-данные'}`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`⚙️  Админ-панель: http://localhost:${PORT}/admin`);
            console.log(`🔧 Диагностика: http://localhost:${PORT}/debug`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log(`🔍 Диагностика amoCRM: http://localhost:${PORT}/api/debug/amocrm-test`);
            console.log('='.repeat(50));
            
            console.log('\n🎯 ДИАГНОСТИКА ИНТЕГРАЦИИ:');
            console.log('='.repeat(50));
            console.log('1. Проверьте статус: /api/amocrm/status');
            console.log('2. Тестовый поиск: /api/debug/amocrm-contacts?phone=79991234567');
            console.log('3. Полный тест: /api/debug/amocrm-test');
            console.log('4. Для OAuth авторизации перейдите в админ-панель');
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
