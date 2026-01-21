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
        this.contactFieldMap = {}; // Карта полей для быстрого поиска
        
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
                
                // Загружаем карту полей
                await this.loadContactFieldMap();
                
                // Сохраняем токен в БД
                await this.saveTokensToDatabase(this.accessToken, null, Date.now() + 24 * 60 * 60 * 1000);
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
                    
                    // Загружаем карту полей
                    await this.loadContactFieldMap();
                    
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

    async loadContactFieldMap() {
        console.log('\n🗺️  ЗАГРУЗКА КАРТЫ ПОЛЕЙ КОНТАКТОВ');
        
        try {
            const fields = await this.getContactCustomFields();
            
            // Создаем карту для быстрого поиска
            this.contactFieldMap = {};
            fields.forEach(field => {
                const fieldId = field.id;
                const fieldName = field.name.toLowerCase().trim();
                
                // Сохраняем по ID
                this.contactFieldMap[fieldId] = {
                    name: field.name,
                    type: field.type,
                    enums: field.enums || {},
                    original_name: field.name
                };
                
                // Сохраняем по названию (нижний регистр)
                this.contactFieldMap[fieldName] = {
                    id: fieldId,
                    name: field.name,
                    type: field.type,
                    enums: field.enums || {},
                    original_name: field.name
                };
                
                // Также сохраняем основные варианты
                if (fieldName.includes('филиал')) {
                    this.contactFieldMap['филиал'] = {
                        id: fieldId,
                        name: field.name,
                        type: field.type,
                        original_name: field.name
                    };
                }
                
                if (fieldName.includes('активный абонемент') || fieldName.includes('есть активный абонемент')) {
                    this.contactFieldMap['активный_абонемент'] = {
                        id: fieldId,
                        name: field.name,
                        type: field.type,
                        original_name: field.name
                    };
                }
                
                if (fieldName.includes('статус')) {
                    this.contactFieldMap['статус'] = {
                        id: fieldId,
                        name: field.name,
                        type: field.type,
                        original_name: field.name
                    };
                }
                
                if (fieldName.includes('преподаватель')) {
                    this.contactFieldMap['преподаватель'] = {
                        id: fieldId,
                        name: field.name,
                        type: field.type,
                        original_name: field.name
                    };
                }
                
                if (fieldName.includes('дата последнего визита') || fieldName.includes('последний визит')) {
                    this.contactFieldMap['последний_визит'] = {
                        id: fieldId,
                        name: field.name,
                        type: field.type,
                        original_name: field.name
                    };
                }
            });
            
            console.log(`✅ Карта полей загружена: ${Object.keys(this.contactFieldMap).length} записей`);
            
        } catch (error) {
            console.error('❌ Ошибка загрузки карты полей:', error.message);
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
            
            // Загружаем карту полей
            await this.loadContactFieldMap();
            
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

    async getContactCustomFields() {
        console.log('\n📋 ПОЛУЧЕНИЕ КАСТОМНЫХ ПОЛЕЙ КОНТАКТОВ');
        try {
            const response = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            const fields = response._embedded?.custom_fields || [];
            
            console.log(`✅ Получено кастомных полей: ${fields.length}`);
            
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
        
        // Форматируем номер для поиска
        let searchPhone;
        if (cleanPhone.length === 10) {
            searchPhone = '7' + cleanPhone;
        } else if (cleanPhone.length === 11) {
            if (cleanPhone.startsWith('8')) {
                searchPhone = '7' + cleanPhone.slice(1);
            } else {
                searchPhone = cleanPhone;
            }
        } else {
            searchPhone = cleanPhone;
        }
        
        console.log(`🔍 Поиск номера: ${searchPhone}`);
        
        try {
            // Ищем контакт через API
            const filter = {
                filter: {
                    custom_fields_values: [
                        {
                            field_id: this.findFieldIdByKeywords(['телефон', 'phone', 'номер']),
                            values: [searchPhone]
                        }
                    ]
                }
            };
            
            const response = await this.makeRequest('POST', '/api/v4/contacts/filter', filter);
            const contacts = response._embedded?.contacts || [];
            
            console.log(`✅ Найдено контактов: ${contacts.length}`);
            
            return {
                _embedded: {
                    contacts: contacts
                }
            };
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    findFieldIdByKeywords(keywords) {
        // Поиск ID поля по ключевым словам
        for (const [key, field] of Object.entries(this.contactFieldMap)) {
            const fieldName = field.name.toLowerCase();
            for (const keyword of keywords) {
                if (fieldName.includes(keyword.toLowerCase())) {
                    return field.id;
                }
            }
        }
        return null;
    }

    async getContactDetails(contactId) {
        console.log(`\n🔍 ПОЛУЧЕНИЕ ДЕТАЛЕЙ КОНТАКТА ${contactId}`);
        try {
            const response = await this.makeRequest('GET', `/api/v4/contacts/${contactId}`);
            console.log(`✅ Детали контакта получены`);
            
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения деталей контакта: ${error.message}`);
            throw error;
        }
    }

    async getContactLeads(contactId) {
        console.log(`\n📋 ПОЛУЧЕНИЕ СДЕЛОК КОНТАКТА ${contactId}`);
        try {
            const response = await this.makeRequest('GET', `/api/v4/contacts/${contactId}/leads?limit=50`);
            
            if (response._embedded?.leads) {
                console.log(`✅ Найдено сделок: ${response._embedded.leads.length}`);
                return response._embedded.leads;
            } else {
                console.log('📭 Сделки не найдены');
                return [];
            }
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    async getContactNotes(contactId) {
        console.log(`\n📝 ПОЛУЧЕНИЕ ЗАМЕТОК КОНТАКТА ${contactId}`);
        try {
            const response = await this.makeRequest('GET', `/api/v4/contacts/${contactId}/notes?limit=100`);
            
            if (response._embedded?.notes) {
                console.log(`✅ Найдено заметок: ${response._embedded.notes.length}`);
                return response._embedded.notes;
            } else {
                console.log('📭 Заметки не найдены');
                return [];
            }
        } catch (error) {
            console.error(`❌ Ошибка получения заметок: ${error.message}`);
            return [];
        }
    }

    // НОВЫЙ МЕТОД ДЛЯ ПРАВИЛЬНОГО ПАРСИНГА ДАННЫХ ИЗ AMOCRM
    async parseContactToStudentProfile(contact) {
        console.log(`\n🔍 ПАРСИНГ КОНТАКТА В ПРОФИЛЬ УЧЕНИКА`);
        console.log(`👤 Контакт: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
        
        // Базовая структура профиля
        const profile = {
            amocrm_contact_id: contact.id,
            student_name: contact.name || 'Не указано',
            parent_name: '',
            phone_number: '',
            email: '',
            branch: 'Не указан',
            subscription_type: 'Без абонемента',
            subscription_status: 'Не активен',
            total_classes: 0,
            remaining_classes: 0,
            used_classes: 0,
            expiration_date: null,
            teacher_name: '',
            day_of_week: '',
            time_slot: '',
            age_group: '',
            last_visit_date: null,
            purchase_count: 0,
            total_purchase_amount: 0,
            month_classes: 0,
            custom_fields: contact.custom_fields_values || [],
            raw_contact_data: JSON.stringify(contact, null, 2),
            created_at: contact.created_at ? new Date(contact.created_at * 1000).toISOString() : null,
            updated_at: contact.updated_at ? new Date(contact.updated_at * 1000).toISOString() : null
        };
        
        console.log(`📋 АНАЛИЗ КАСТОМНЫХ ПОЛЕЙ:`);
        
        // Анализируем кастомные поля
        if (contact.custom_fields_values && contact.custom_fields_values.length > 0) {
            for (const field of contact.custom_fields_values) {
                const fieldInfo = this.contactFieldMap[field.field_id];
                const fieldName = fieldInfo ? fieldInfo.name.toLowerCase() : '';
                const values = field.values || [];
                
                if (values.length > 0) {
                    const value = values[0].value;
                    
                    // ВЫВОДИМ ВСЕ ПОЛЯ ДЛЯ ДЕБАГА
                    console.log(`   🔍 ${fieldName}: "${value}" (ID: ${field.field_id})`);
                    
                    // 1. ФИЛИАЛ
                    if (fieldName.includes('филиал') || fieldName.includes('свиблово') || fieldName.includes('чертаново')) {
                        profile.branch = value;
                        console.log(`   🏢 → Филиал: ${value}`);
                    }
                    
                    // 2. СТАТУС АБОНЕМЕНТА (Активирован, Не активен и т.д.)
                    else if (fieldName.includes('статус') && !fieldName.includes('старая')) {
                        profile.subscription_status = value;
                        console.log(`   ✅ → Статус абонемента: ${value}`);
                    }
                    
                    // 3. ЕСТЬ АКТИВНЫЙ АБОНЕМЕНТ (булевое поле)
                    else if (fieldName.includes('активный абонемент') || fieldName.includes('есть активный абонемент')) {
                        if (value === 'да' || value === 'true' || value === true) {
                            profile.subscription_type = 'Активный абонемент';
                            console.log(`   🎫 → Есть активный абонемент: Да`);
                        }
                    }
                    
                    // 4. ТИП АБОНЕМЕНТА
                    else if (fieldName.includes('тип абонемента') || fieldName.includes('абонемент') && !fieldName.includes('активный')) {
                        profile.subscription_type = value;
                        console.log(`   🎫 → Тип абонемента: ${value}`);
                    }
                    
                    // 5. ПРЕПОДАВАТЕЛЬ
                    else if (fieldName.includes('преподаватель')) {
                        profile.teacher_name = value;
                        console.log(`   👩‍🏫 → Преподаватель: ${value}`);
                    }
                    
                    // 6. ДАТА ПОСЛЕДНЕГО ВИЗИТА
                    else if (fieldName.includes('дата последнего визита') || fieldName.includes('последний визит')) {
                        try {
                            const date = this.parseDate(value);
                            if (date) {
                                profile.last_visit_date = date.toISOString().split('T')[0];
                                console.log(`   📅 → Последний визит: ${profile.last_visit_date}`);
                            }
                        } catch (e) {
                            console.log(`   ⚠️ → Не удалось распарсить дату: ${value}`);
                        }
                    }
                    
                    // 7. КОЛИЧЕСТВО ПОКУПОК
                    else if (fieldName.includes('количество покупок')) {
                        const num = parseInt(value);
                        if (!isNaN(num)) {
                            profile.purchase_count = num;
                            console.log(`   🛒 → Количество покупок: ${num}`);
                        }
                    }
                    
                    // 8. СУММА ПОКУПОК
                    else if (fieldName.includes('сумма покупок')) {
                        const num = parseInt(value.toString().replace(/\s/g, '').replace('₽', ''));
                        if (!isNaN(num)) {
                            profile.total_purchase_amount = num;
                            console.log(`   💰 → Сумма покупок: ${num}`);
                        }
                    }
                    
                    // 9. СЧЕТЧИК ЗАНЯТИЙ ЗА МЕСЯЦ
                    else if (fieldName.includes('счетчик занятий за месяц')) {
                        const num = parseInt(value);
                        if (!isNaN(num)) {
                            profile.month_classes = num;
                            console.log(`   📊 → Занятий за месяц: ${num}`);
                        }
                    }
                    
                    // 10. ВОЗРАСТНАЯ ГРУППА
                    else if (fieldName.includes('возраст') || fieldName.includes('группа возраст')) {
                        profile.age_group = value;
                        console.log(`   👶 → Возрастная группа: ${value}`);
                    }
                    
                    // 11. ТЕЛЕФОН
                    else if (fieldName.includes('телефон') || fieldName.includes('phone')) {
                        profile.phone_number = value;
                        console.log(`   📞 → Телефон: ${value}`);
                    }
                    
                    // 12. EMAIL
                    else if (fieldName.includes('email') || fieldName.includes('почта')) {
                        profile.email = value;
                        console.log(`   📧 → Email: ${value}`);
                    }
                }
            }
        }
        
        // ПОЛУЧАЕМ СДЕЛКИ ДЛЯ РАСЧЕТА КОЛИЧЕСТВА ЗАНЯТИЙ
        console.log(`\n📊 АНАЛИЗ СДЕЛОК ДЛЯ РАСЧЕТА ЗАНЯТИЙ:`);
        try {
            const leads = await this.getContactLeads(contact.id);
            
            if (leads.length > 0) {
                // Ищем сделки с абонементами
                let totalClassesFromLeads = 0;
                let remainingClassesFromLeads = 0;
                
                for (const lead of leads) {
                    // Анализируем название сделки и цену
                    const leadName = lead.name || '';
                    const leadPrice = lead.price || 0;
                    
                    console.log(`   🔍 Сделка: "${leadName}" - ${leadPrice}₽`);
                    
                    // Если в названии сделки есть "занятий" или "абонемент"
                    if (leadName.toLowerCase().includes('занятий') || leadName.toLowerCase().includes('абонемент')) {
                        // Пробуем извлечь количество занятий из названия
                        const match = leadName.match(/(\d+)\s*занятий?/i);
                        if (match) {
                            const classes = parseInt(match[1]);
                            totalClassesFromLeads += classes;
                            console.log(`   🎯 → Найдено занятий в сделке: ${classes}`);
                        }
                        
                        // Если цена соответствует стандартным абонементам
                        if (leadPrice === 5040) { // 8 занятий по 630р
                            totalClassesFromLeads = 8;
                            console.log(`   💰 → Цена 5040₽ → 8 занятий`);
                        } else if (leadPrice === 7560) { // 12 занятий
                            totalClassesFromLeads = 12;
                            console.log(`   💰 → Цена 7560₽ → 12 занятий`);
                        } else if (leadPrice === 12600) { // 20 занятий
                            totalClassesFromLeads = 20;
                            console.log(`   💰 → Цена 12600₽ → 20 занятий`);
                        }
                    }
                }
                
                // Если нашли занятия в сделках
                if (totalClassesFromLeads > 0) {
                    profile.total_classes = totalClassesFromLeads;
                    
                    // Пробуем рассчитать оставшиеся занятия
                    if (profile.month_classes > 0) {
                        profile.used_classes = profile.month_classes;
                        profile.remaining_classes = totalClassesFromLeads - profile.month_classes;
                        console.log(`   🧮 → Расчет: ${totalClassesFromLeads} - ${profile.month_classes} = ${profile.remaining_classes} осталось`);
                    } else {
                        // Если не знаем использованных, считаем что все остались
                        profile.remaining_classes = totalClassesFromLeads;
                        console.log(`   🧮 → Использованных занятий не известно, считаем все остались: ${totalClassesFromLeads}`);
                    }
                }
            }
        } catch (leadError) {
            console.log(`   ⚠️  Ошибка анализа сделок: ${leadError.message}`);
        }
        
        // АНАЛИЗ ЗАМЕТОК ДЛЯ ПОЛУЧЕНИЯ ИСТОРИИ ПОСЕЩЕНИЙ
        console.log(`\n📝 АНАЛИЗ ЗАМЕТОК ДЛЯ ИСТОРИИ ПОСЕЩЕНИЙ:`);
        try {
            const notes = await this.getContactNotes(contact.id);
            
            if (notes.length > 0) {
                // Собираем даты посещений из заметок
                const visitDates = [];
                
                for (const note of notes) {
                    const noteText = note.params?.text || '';
                    const noteDate = note.created_at ? new Date(note.created_at * 1000) : null;
                    
                    // Ищем упоминания о посещениях
                    if (noteText.toLowerCase().includes('посещение') || 
                        noteText.toLowerCase().includes('занятие') ||
                        noteText.toLowerCase().includes('пришел') ||
                        noteText.toLowerCase().includes('был на')) {
                        
                        if (noteDate) {
                            const dateStr = noteDate.toISOString().split('T')[0];
                            visitDates.push(dateStr);
                            console.log(`   📅 → Посещение: ${dateStr} - "${noteText.substring(0, 50)}..."`);
                        }
                    }
                }
                
                // Если нашли посещения, обновляем последний визит
                if (visitDates.length > 0) {
                    // Сортируем по дате (новые первыми)
                    visitDates.sort((a, b) => new Date(b) - new Date(a));
                    
                    if (!profile.last_visit_date) {
                        profile.last_visit_date = visitDates[0];
                        console.log(`   📅 → Установлен последний визит из заметок: ${profile.last_visit_date}`);
                    }
                    
                    // Используем количество посещений как использованные занятия
                    if (profile.used_classes === 0 && visitDates.length > 0) {
                        profile.used_classes = visitDates.length;
                        console.log(`   📊 → Использовано занятий из заметок: ${visitDates.length}`);
                        
                        // Пересчитываем остаток
                        if (profile.total_classes > 0) {
                            profile.remaining_classes = Math.max(0, profile.total_classes - profile.used_classes);
                            console.log(`   🧮 → Пересчет остатка: ${profile.total_classes} - ${profile.used_classes} = ${profile.remaining_classes}`);
                        }
                    }
                }
            }
        } catch (noteError) {
            console.log(`   ⚠️  Ошибка анализа заметок: ${noteError.message}`);
        }
        
        // ЛОГИЧЕСКИЙ ВЫВОД ОСТАВШИХСЯ ДАННЫХ
        console.log(`\n🔍 ЛОГИЧЕСКИЙ АНАЛИЗ ДАННЫХ:`);
        
        // Если есть активный абонемент, но нет данных о занятиях
        if (profile.subscription_type === 'Активный абонемент') {
            console.log(`   🎫 Активный абонемент обнаружен`);
            
            // Если есть месячные занятия, но нет общего количества
            if (profile.month_classes > 0 && profile.total_classes === 0) {
                profile.total_classes = profile.month_classes + 4; // Предполагаем остаток 4 занятия
                profile.remaining_classes = 4;
                console.log(`   🧮 → Предполагаем: ${profile.total_classes} всего, ${profile.remaining_classes} осталось`);
            }
            
            // Если нет срока действия, устанавливаем разумный
            if (!profile.expiration_date) {
                const futureDate = new Date();
                futureDate.setDate(futureDate.getDate() + 30);
                profile.expiration_date = futureDate.toISOString().split('T')[0];
                console.log(`   📅 → Установлен срок по умолчанию: ${profile.expiration_date}`);
            }
            
            // Если статус не установлен, ставим "Активирован"
            if (profile.subscription_status === 'Не активен') {
                profile.subscription_status = 'Активирован';
                console.log(`   ✅ → Статус изменен на "Активирован"`);
            }
        }
        
        // Если не нашли имя ученика в контакте, пробуем найти в заметках
        if (profile.student_name === 'Не указано' || profile.student_name === contact.name) {
            // Пробуем извлечь имя из названия контакта
            const contactName = contact.name || '';
            if (contactName && !contactName.includes('Anonim')) {
                profile.student_name = contactName;
                console.log(`   👤 → Имя из названия контакта: ${contactName}`);
            }
        }
        
        // Устанавливаем филиал по умолчанию если не найден
        if (profile.branch === 'Не указан') {
            profile.branch = 'Свиблово';
            console.log(`   🏢 → Филиал по умолчанию: Свиблово`);
        }
        
        console.log(`\n✅ ПРОФИЛЬ СОЗДАН:`);
        console.log('='.repeat(60));
        console.log(`   👤 Ученик: ${profile.student_name}`);
        console.log(`   📞 Телефон: ${profile.phone_number}`);
        console.log(`   🏢 Филиал: ${profile.branch}`);
        console.log(`   🎫 Тип абонемента: ${profile.subscription_type}`);
        console.log(`   ✅ Статус: ${profile.subscription_status}`);
        console.log(`   📊 Всего занятий: ${profile.total_classes}`);
        console.log(`   🎯 Осталось занятий: ${profile.remaining_classes}`);
        console.log(`   📈 Использовано: ${profile.used_classes}`);
        console.log(`   💰 Количество покупок: ${profile.purchase_count}`);
        console.log(`   💵 Сумма покупок: ${profile.total_purchase_amount}₽`);
        console.log(`   📅 Последний визит: ${profile.last_visit_date}`);
        console.log(`   👶 Возрастная группа: ${profile.age_group}`);
        console.log(`   👩‍🏫 Преподаватель: ${profile.teacher_name}`);
        console.log('='.repeat(60));
        
        return profile;
    }

    parseDate(dateStr) {
        if (!dateStr) return null;
        
        // Пробуем разные форматы дат
        try {
            // Формат DD.MM.YYYY
            if (dateStr.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
                const parts = dateStr.split('.');
                return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
            }
            
            // Формат YYYY-MM-DD
            if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                return new Date(dateStr);
            }
            
            // Формат с пробелами
            if (dateStr.match(/^\d{1,2} \w+ \d{4}$/)) {
                return new Date(dateStr);
            }
            
            // Пробуем стандартный парсинг
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
                return date;
            }
        } catch (e) {
            console.log(`   ⚠️  Не удалось распарсить дату: ${dateStr}`);
        }
        
        return null;
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
                
                if (contacts.length === 0) {
                    console.log('📭 Контакты не найдены в amoCRM');
                }
                
                // Парсим каждый контакт в профиль
                for (const contact of contacts) {
                    try {
                        console.log(`\n🔄 Обработка контакта: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
                        
                        // Получаем детали контакта
                        const contactDetails = await this.getContactDetails(contact.id);
                        
                        // Создаем профиль с правильным парсингом
                        let profile = await this.parseContactToStudentProfile(contactDetails);
                        
                        // Добавляем флаг, что это реальные данные из amoCRM
                        profile.is_demo = 0;
                        profile.source = 'amocrm';
                        profile.is_active = 1;
                        profile.is_regular = profile.purchase_count > 1 ? 1 : 0;
                        
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
                test_search_found: testSearch._embedded?.contacts?.length || 0,
                domain: AMOCRM_DOMAIN,
                field_map_loaded: Object.keys(this.contactFieldMap).length > 0
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
                refresh_token TEXT,
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

        // Профили учеников (ОБНОВЛЕННАЯ С УЧЕТОМ НОВЫХ ПОЛЕЙ)
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
                subscription_status TEXT,
                total_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                used_classes INTEGER DEFAULT 0,
                expiration_date DATE,
                teacher_name TEXT,
                day_of_week TEXT,
                time_slot TEXT,
                age_group TEXT,
                is_regular INTEGER DEFAULT 0,
                last_visit_date DATE,
                purchase_count INTEGER DEFAULT 0,
                total_purchase_amount INTEGER DEFAULT 0,
                month_classes INTEGER DEFAULT 0,
                amocrm_custom_fields TEXT,
                visit_history TEXT,
                is_demo INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                last_selected INTEGER DEFAULT 0,
                source TEXT DEFAULT 'unknown',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Таблица student_profiles создана');

        // Расписание занятий (заполняется из админ-панели)
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

        // Преподаватели (заполняется из админ-панели)
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

        // История посещений (заполняется из админ-панели)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_profile_id INTEGER NOT NULL,
                schedule_id INTEGER,
                attendance_date DATE NOT NULL,
                attendance_time TIME,
                status TEXT DEFAULT 'attended' CHECK(status IN ('attended', 'missed', 'cancelled')),
                notes TEXT,
                teacher_name TEXT,
                branch TEXT,
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
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_name ON student_profiles(student_name)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_telegram_users_phone ON telegram_users(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance(student_profile_id, attendance_date)');
        
        console.log('✅ Индексы созданы');
    } catch (error) {
        console.error('⚠️  Ошибка создания индексов:', error.message);
    }
};

// ==================== ТЕСТОВЫЕ ДАННЫЕ ====================
const createTestData = async () => {
    try {
        console.log('\n📝 ПРОВЕРКА И СОЗДАНИЕ ТЕСТОВЫХ ДАННЫХ');
        
        // Проверяем, есть ли уже данные
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
        
        // Создаем тестовых учеников только если нет реальных данных из amoCRM
        if (!hasStudents && !amoCrmService.isInitialized) {
            console.log('👤 Создание тестовых учеников...');
            
            // Тестовый профиль на основе вашего примера
            const testStudent = {
                amocrm_contact_id: 28656553,
                student_name: 'Виталина Виленская',
                parent_name: '',
                phone_number: '+7 (916) 177-79-99',
                email: '',
                branch: 'Свиблово',
                subscription_type: 'Активный абонемент',
                subscription_status: 'Активирован',
                total_classes: 8,
                remaining_classes: 4,
                used_classes: 4,
                expiration_date: '2024-12-31',
                teacher_name: 'Саша М',
                day_of_week: '',
                time_slot: '',
                age_group: '6-8 лет',
                is_regular: 1,
                last_visit_date: '2026-01-17',
                purchase_count: 1,
                total_purchase_amount: 5040,
                month_classes: 1,
                is_demo: 1,
                is_active: 1,
                last_selected: 1,
                source: 'demo'
            };
            
            await db.run(
                `INSERT INTO student_profiles 
                 (amocrm_contact_id, student_name, parent_name, phone_number, email, branch, 
                  subscription_type, subscription_status, total_classes, remaining_classes, used_classes,
                  expiration_date, teacher_name, age_group, is_regular, last_visit_date, 
                  purchase_count, total_purchase_amount, month_classes, is_demo, is_active, last_selected, source) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    testStudent.amocrm_contact_id,
                    testStudent.student_name,
                    testStudent.parent_name,
                    testStudent.phone_number,
                    testStudent.email,
                    testStudent.branch,
                    testStudent.subscription_type,
                    testStudent.subscription_status,
                    testStudent.total_classes,
                    testStudent.remaining_classes,
                    testStudent.used_classes,
                    testStudent.expiration_date,
                    testStudent.teacher_name,
                    testStudent.age_group,
                    testStudent.is_regular,
                    testStudent.last_visit_date,
                    testStudent.purchase_count,
                    testStudent.total_purchase_amount,
                    testStudent.month_classes,
                    testStudent.is_demo,
                    testStudent.is_active,
                    testStudent.last_selected,
                    testStudent.source
                ]
            );
            
            // Добавляем историю посещений
            const visits = [
                ['2026-01-17', 'attended', 'Регулярное занятие', 'Саша М', 'Свиблово'],
                ['2026-01-10', 'attended', 'Регулярное занятие', 'Саша М', 'Свиблово'],
                ['2026-01-03', 'attended', 'Регулярное занятие', 'Саша М', 'Свиблово'],
                ['2025-12-27', 'attended', 'Регулярное занятие', 'Саша М', 'Свиблово']
            ];
            
            for (const visit of visits) {
                await db.run(
                    `INSERT INTO attendance (student_profile_id, attendance_date, status, notes, teacher_name, branch) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [1, ...visit]
                );
            }
            
            console.log('✅ Тестовый ученик создан с историей посещений');
        }
        
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
            account_info: amoCrmService.accountInfo,
            field_map_count: Object.keys(amoCrmService.contactFieldMap).length,
            base_url: amoCrmService.baseUrl,
            timestamp: new Date().toISOString()
        };
        
        console.log('📊 Статус amoCRM запрошен:', {
            is_initialized: status.is_initialized,
            domain: status.domain,
            field_map: status.field_map_count
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
        const { phone, limit = 5 } = req.query;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона для поиска',
                example: '/api/debug/amocrm-contacts?phone=79161777999'
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
                field_map_count: Object.keys(amoCrmService.contactFieldMap).length
            }
        };
        
        if (!amoCrmService.isInitialized) {
            diagnostics.error = 'amoCRM не инициализирован';
            diagnostics.suggestions = [
                'Проверьте AMOCRM_DOMAIN в .env файле',
                'Проверьте AMOCRM_ACCESS_TOKEN'
            ];
            
            return res.json({
                success: false,
                diagnostics,
                error: 'amoCRM не инициализирован'
            });
        }
        
        try {
            // Тест поиска контактов
            console.log(`\n🔍 ТЕСТ: Поиск контактов`);
            let searchResults;
            try {
                searchResults = await amoCrmService.searchContactsByPhone(phone);
                const contacts = searchResults._embedded?.contacts || [];
                diagnostics.search_results = {
                    contacts_found: contacts.length,
                    contacts: contacts.slice(0, limit).map(c => ({
                        id: c.id,
                        name: c.name,
                        created_at: c.created_at ? new Date(c.created_at * 1000).toISOString() : null,
                        custom_fields_count: c.custom_fields_values?.length || 0
                    }))
                };
                console.log(`✅ Найдено контактов: ${contacts.length}`);
                
                // Если есть контакты, получаем детали первого
                if (contacts.length > 0) {
                    console.log(`\n🔍 ТЕСТ: Детали контакта ${contacts[0].id}`);
                    try {
                        const contactDetails = await amoCrmService.getContactDetails(contacts[0].id);
                        diagnostics.contact_details = {
                            id: contactDetails.id,
                            name: contactDetails.name,
                            fields_found: contactDetails.custom_fields_values?.length || 0,
                            custom_fields: contactDetails.custom_fields_values?.map(f => ({
                                field_id: f.field_id,
                                values: f.values
                            })) || []
                        };
                        console.log(`✅ Детали контакта получены`);
                        
                        // Парсим профиль
                        console.log(`\n🔍 ТЕСТ: Парсинг профиля`);
                        const profile = await amoCrmService.parseContactToStudentProfile(contactDetails);
                        diagnostics.parsed_profile = {
                            student_name: profile.student_name,
                            phone: profile.phone_number,
                            branch: profile.branch,
                            subscription_type: profile.subscription_type,
                            subscription_status: profile.subscription_status,
                            total_classes: profile.total_classes,
                            remaining_classes: profile.remaining_classes,
                            used_classes: profile.used_classes,
                            last_visit_date: profile.last_visit_date,
                            teacher_name: profile.teacher_name,
                            age_group: profile.age_group,
                            purchase_count: profile.purchase_count,
                            total_purchase_amount: profile.total_purchase_amount
                        };
                        console.log(`✅ Профиль распарсен`);
                    } catch (detailsError) {
                        diagnostics.details_error = detailsError.message;
                        console.log(`❌ Ошибка деталей контакта: ${detailsError.message}`);
                    }
                }
            } catch (searchError) {
                diagnostics.search_error = searchError.message;
                console.log(`❌ Ошибка поиска: ${searchError.message}`);
            }
            
            res.json({
                success: true,
                diagnostics,
                summary: {
                    amocrm_contacts_found: diagnostics.search_results?.contacts_found || 0,
                    account_name: amoCrmService.accountInfo?.name || 'Не получено',
                    profile_parsed_successfully: !!diagnostics.parsed_profile
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
                field_map_count: Object.keys(amoCrmService.contactFieldMap).length
            }
        });
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                tests: tests,
                error: 'amoCRM не инициализирован',
                required_variables: {
                    AMOCRM_DOMAIN: AMOCRM_DOMAIN || '❌ Не установлен',
                    AMOCRM_ACCESS_TOKEN: AMOCRM_ACCESS_TOKEN ? '✅ Установлен (' + AMOCRM_ACCESS_TOKEN.substring(0, 20) + '...)' : '❌ Не установлен',
                },
                solution: `Добавьте AMOCRM_ACCESS_TOKEN в .env файл`
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
            const customFields = amoCrmService.contactFieldMap;
            const fieldCount = Object.keys(customFields).filter(k => !isNaN(k)).length;
            tests.push({
                name: 'Получение кастомных полей контактов',
                success: fieldCount > 0,
                data: {
                    fields_count: fieldCount,
                    sample_fields: Object.entries(customFields)
                        .filter(([k, v]) => !isNaN(k))
                        .slice(0, 5)
                        .map(([k, v]) => ({
                            id: k,
                            name: v.name,
                            type: v.type
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
        
        // Тест 4: Поиск тестового контакта
        try {
            const searchResults = await amoCrmService.searchContactsByPhone('79161777999');
            const contacts = searchResults._embedded?.contacts || [];
            tests.push({
                name: 'Поиск тестового контакта',
                success: contacts.length > 0,
                data: {
                    contacts_found: contacts.length,
                    sample_contact: contacts.length > 0 ? {
                        id: contacts[0].id,
                        name: contacts[0].name
                    } : null
                }
            });
            
            // Тест 5: Парсинг контакта
            if (contacts.length > 0) {
                try {
                    const contactDetails = await amoCrmService.getContactDetails(contacts[0].id);
                    const profile = await amoCrmService.parseContactToStudentProfile(contactDetails);
                    tests.push({
                        name: 'Парсинг профиля ученика',
                        success: true,
                        data: {
                            student_name: profile.student_name,
                            branch: profile.branch,
                            subscription_type: profile.subscription_type,
                            total_classes: profile.total_classes,
                            remaining_classes: profile.remaining_classes
                        }
                    });
                } catch (parseError) {
                    tests.push({
                        name: 'Парсинг профиля ученика',
                        success: false,
                        error: parseError.message
                    });
                }
            }
        } catch (error) {
            tests.push({
                name: 'Поиск тестового контакта',
                success: false,
                error: error.message
            });
        }
        
        // Тест 6: Тест работы с БД
        try {
            const studentsCount = await db.get('SELECT COUNT(*) as count FROM student_profiles');
            const teachersCount = await db.get('SELECT COUNT(*) as count FROM teachers');
            const scheduleCount = await db.get('SELECT COUNT(*) as count FROM schedule');
            tests.push({
                name: 'Проверка локальной базы данных',
                success: true,
                data: {
                    student_profiles_count: studentsCount.count,
                    teachers_count: teachersCount.count,
                    schedule_count: scheduleCount.count,
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
            details: error.message
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
            debug_contacts: '/api/debug/amocrm-contacts?phone=79161777999',
            debug_test: '/api/debug/amocrm-test',
            auth_phone: 'POST /api/auth/phone',
            teachers: '/api/teachers',
            schedule: 'POST /api/schedule',
            faq: '/api/faq',
            news: '/api/news'
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
        
        // Сохраняем профили в базу данных
        if (profiles.length > 0) {
            for (const profile of profiles) {
                try {
                    // Проверяем существующий профиль
                    const existingProfile = await db.get(
                        `SELECT * FROM student_profiles 
                         WHERE amocrm_contact_id = ?`,
                        [profile.amocrm_contact_id]
                    );
                    
                    if (!existingProfile) {
                        await db.run(
                            `INSERT INTO student_profiles 
                             (amocrm_contact_id, student_name, parent_name, phone_number, 
                              email, branch, subscription_type, subscription_status, total_classes, 
                              remaining_classes, used_classes, expiration_date, teacher_name, 
                              day_of_week, time_slot, age_group, is_regular, last_visit_date, 
                              purchase_count, total_purchase_amount, month_classes, 
                              amocrm_custom_fields, is_demo, is_active, source) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                profile.amocrm_contact_id || null,
                                profile.student_name,
                                profile.parent_name || '',
                                profile.phone_number,
                                profile.email || '',
                                profile.branch || 'Не указан',
                                profile.subscription_type || 'Без абонемента',
                                profile.subscription_status || 'Не активен',
                                profile.total_classes || 0,
                                profile.remaining_classes || 0,
                                profile.used_classes || 0,
                                profile.expiration_date || null,
                                profile.teacher_name || '',
                                profile.day_of_week || '',
                                profile.time_slot || '',
                                profile.age_group || '',
                                profile.is_regular || 0,
                                profile.last_visit_date || null,
                                profile.purchase_count || 0,
                                profile.total_purchase_amount || 0,
                                profile.month_classes || 0,
                                JSON.stringify(profile.custom_fields || []),
                                profile.is_demo || 0,
                                1,
                                profile.source || 'amocrm'
                            ]
                        );
                        
                        // Получаем ID вставленного профиля
                        const insertedProfile = await db.get(
                            `SELECT id FROM student_profiles WHERE amocrm_contact_id = ?`,
                            [profile.amocrm_contact_id]
                        );
                        
                        console.log(`✅ Профиль сохранен в БД: ${profile.student_name} (ID: ${insertedProfile?.id})`);
                        
                        // Сохраняем историю посещений из заметок
                        if (profile.visit_history && Array.isArray(profile.visit_history)) {
                            for (const visit of profile.visit_history) {
                                await db.run(
                                    `INSERT INTO attendance (student_profile_id, attendance_date, status, notes, teacher_name, branch) 
                                     VALUES (?, ?, ?, ?, ?, ?)`,
                                    [
                                        insertedProfile.id,
                                        visit.date,
                                        'attended',
                                        visit.notes || 'Занятие',
                                        profile.teacher_name || '',
                                        profile.branch || 'Свиблово'
                                    ]
                                );
                            }
                            console.log(`   📊 Сохранено посещений: ${profile.visit_history.length}`);
                        }
                    } else {
                        // Обновляем существующий профиль
                        await db.run(
                            `UPDATE student_profiles SET
                             student_name = ?, phone_number = ?, email = ?, branch = ?,
                             subscription_type = ?, subscription_status = ?, total_classes = ?,
                             remaining_classes = ?, used_classes = ?, expiration_date = ?,
                             teacher_name = ?, age_group = ?, is_regular = ?, last_visit_date = ?,
                             purchase_count = ?, total_purchase_amount = ?, month_classes = ?,
                             amocrm_custom_fields = ?, source = ?, updated_at = CURRENT_TIMESTAMP
                             WHERE amocrm_contact_id = ?`,
                            [
                                profile.student_name,
                                profile.phone_number,
                                profile.email || '',
                                profile.branch || 'Не указан',
                                profile.subscription_type || 'Без абонемента',
                                profile.subscription_status || 'Не активен',
                                profile.total_classes || 0,
                                profile.remaining_classes || 0,
                                profile.used_classes || 0,
                                profile.expiration_date || null,
                                profile.teacher_name || '',
                                profile.age_group || '',
                                profile.is_regular || 0,
                                profile.last_visit_date || null,
                                profile.purchase_count || 0,
                                profile.total_purchase_amount || 0,
                                profile.month_classes || 0,
                                JSON.stringify(profile.custom_fields || []),
                                profile.source || 'amocrm',
                                profile.amocrm_contact_id
                            ]
                        );
                        console.log(`🔄 Профиль обновлен: ${profile.student_name}`);
                    }
                } catch (profileError) {
                    console.error(`❌ Ошибка сохранения профиля: ${profileError.message}`);
                }
            }
        }
        
        // Формируем ответ
        const responseData = {
            success: true,
            message: profiles.length > 0 ? 'Авторизация успешна' : 'Профили не найдены',
            data: {
                user: tempUser,
                profiles: profiles.map(p => ({
                    id: p.id,
                    student_name: p.student_name,
                    parent_name: p.parent_name,
                    phone_number: p.phone_number,
                    email: p.email,
                    branch: p.branch,
                    subscription_type: p.subscription_type,
                    subscription_status: p.subscription_status,
                    total_classes: p.total_classes,
                    remaining_classes: p.remaining_classes,
                    used_classes: p.used_classes,
                    expiration_date: p.expiration_date,
                    teacher_name: p.teacher_name,
                    day_of_week: p.day_of_week,
                    time_slot: p.time_slot,
                    age_group: p.age_group,
                    is_regular: p.is_regular || false,
                    last_visit_date: p.last_visit_date,
                    purchase_count: p.purchase_count || 0,
                    total_purchase_amount: p.total_purchase_amount || 0,
                    month_classes: p.month_classes || 0,
                    is_demo: p.is_demo || 0,
                    amocrm_contact_id: p.amocrm_contact_id,
                    source: p.source || 'unknown',
                    custom_fields: p.custom_fields || []
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
        
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Ошибка проверки телефона:', error.message);
        console.error('Stack trace:', error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки телефона',
            details: error.message
        });
    }
});

// Получение истории посещений
app.post('/api/attendance/history', authenticateToken, async (req, res) => {
    try {
        const { profile_id, limit = 20 } = req.body;
        
        if (!profile_id) {
            return res.status(400).json({
                success: false,
                error: 'Укажите ID профиля'
            });
        }
        
        console.log(`\n📋 ЗАПРОС ИСТОРИИ ПОСЕЩЕНИЙ`);
        console.log(`👤 ID профиля: ${profile_id}`);
        
        // Получаем профиль
        const profile = await db.get(
            `SELECT * FROM student_profiles WHERE id = ?`,
            [profile_id]
        );
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Профиль не найден'
            });
        }
        
        // Получаем историю посещений из базы
        const attendance = await db.all(
            `SELECT * FROM attendance 
             WHERE student_profile_id = ?
             ORDER BY attendance_date DESC
             LIMIT ?`,
            [profile_id, limit]
        );
        
        console.log(`📊 Найдено записей посещений: ${attendance.length}`);
        
        // Если в базе мало записей, пробуем получить из amoCRM
        if (attendance.length < 5 && profile.amocrm_contact_id && amoCrmService.isInitialized) {
            console.log(`🔍 Получение дополнительной истории из amoCRM...`);
            try {
                const notes = await amoCrmService.getContactNotes(profile.amocrm_contact_id);
                
                // Фильтруем заметки с посещениями
                const visitNotes = notes.filter(note => {
                    const text = note.params?.text || '';
                    return text.toLowerCase().includes('посещение') || 
                           text.toLowerCase().includes('занятие') ||
                           text.toLowerCase().includes('пришел');
                });
                
                // Добавляем в историю
                for (const note of visitNotes.slice(0, 10)) {
                    const noteDate = note.created_at ? new Date(note.created_at * 1000) : new Date();
                    const dateStr = noteDate.toISOString().split('T')[0];
                    
                    // Проверяем, нет ли уже такой записи
                    const existing = attendance.find(a => a.attendance_date === dateStr);
                    if (!existing) {
                        attendance.push({
                            attendance_date: dateStr,
                            status: 'attended',
                            notes: note.params?.text?.substring(0, 100) || 'Занятие',
                            teacher_name: profile.teacher_name || '',
                            branch: profile.branch || 'Свиблово'
                        });
                    }
                }
                
                console.log(`✅ Добавлено записей из amoCRM: ${visitNotes.length}`);
                
                // Сортируем по дате
                attendance.sort((a, b) => new Date(b.attendance_date) - new Date(a.attendance_date));
                
            } catch (noteError) {
                console.log(`⚠️  Не удалось получить историю из amoCRM: ${noteError.message}`);
            }
        }
        
        res.json({
            success: true,
            data: {
                student_name: profile.student_name,
                attendance_history: attendance,
                total_records: attendance.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения истории посещений:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения истории посещений'
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

// Абонемент с полной информацией
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
        
        // Получаем историю посещений
        const attendance = await db.all(
            `SELECT * FROM attendance 
             WHERE student_profile_id = ?
             ORDER BY attendance_date DESC
             LIMIT 10`,
            [profile.id]
        );
        
        console.log(`📊 История посещений: ${attendance.length} записей`);
        
        // Форматируем данные абонемента
        const subscriptionData = {
            student_name: profile.student_name,
            parent_name: profile.parent_name || '',
            phone_number: profile.phone_number,
            email: profile.email || '',
            branch: profile.branch,
            subscription_type: profile.subscription_type,
            subscription_status: profile.subscription_status,
            total_classes: profile.total_classes,
            remaining_classes: profile.remaining_classes,
            used_classes: profile.used_classes,
            expiration_date: profile.expiration_date,
            teacher_name: profile.teacher_name,
            day_of_week: profile.day_of_week,
            time_slot: profile.time_slot,
            age_group: profile.age_group,
            is_regular: profile.is_regular || 0,
            last_visit_date: profile.last_visit_date,
            purchase_count: profile.purchase_count || 0,
            total_purchase_amount: profile.total_purchase_amount || 0,
            month_classes: profile.month_classes || 0,
            is_demo: profile.is_demo || 0,
            amocrm_contact_id: profile.amocrm_contact_id,
            source: profile.source || 'unknown'
        };
        
        // Добавляем прогресс занятий
        if (profile.total_classes > 0) {
            subscriptionData.progress_percentage = Math.round((profile.used_classes / profile.total_classes) * 100);
            subscriptionData.progress_text = `${profile.used_classes} из ${profile.total_classes} занятий`;
        } else {
            subscriptionData.progress_percentage = 0;
            subscriptionData.progress_text = 'Абонемент не активирован';
        }
        
        // Добавляем информацию о сроке действия
        if (profile.expiration_date) {
            const expirationDate = new Date(profile.expiration_date);
            const today = new Date();
            const daysLeft = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));
            
            if (daysLeft > 0) {
                subscriptionData.days_left = daysLeft;
                subscriptionData.expiration_status = daysLeft <= 7 ? 'Скоро истекает' : 'Активен';
            } else {
                subscriptionData.days_left = 0;
                subscriptionData.expiration_status = 'Истек';
            }
        }
        
        res.json({
            success: true,
            data: {
                subscription: subscriptionData,
                attendance: attendance
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
            console.log(`🗺️  Карта полей: ${Object.keys(amoCrmService.contactFieldMap).length} записей`);
            console.log(`📊 Аккаунт: ${amoCrmService.accountInfo?.name || 'Не получено'}`);
        } else {
            console.log('⚠️  amoCRM не инициализирован');
            console.log('ℹ️  Используются локальные данные');
        }
        
        // Пробуем запустить бота
        console.log('\n🤖 Инициализация Telegram бота...');
        try {
            const botInfo = await bot.telegram.getMe();
            console.log(`✅ Telegram бот: @${botInfo.username} (${botInfo.first_name})`);
            
            bot.launch().then(() => {
                console.log('✅ Telegram бот запущен в режиме polling');
            }).catch(botError => {
                console.log('🤖 Telegram бот: Информация недоступна');
                console.log('⚠️  Проверьте токен бота или интернет соединение');
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
            console.log(`🎭 Режим: ${amoCrmService.isInitialized ? 'Реальные данные из amoCRM' : 'Локальные данные'}`);
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
            
            console.log('\n🎯 ОСНОВНЫЕ ВОЗМОЖНОСТИ СИСТЕМЫ:');
            console.log('='.repeat(50));
            console.log('✅ Поиск по номеру телефона');
            console.log('✅ Получение данных из amoCRM');
            console.log('✅ История посещений');
            console.log('✅ Информация об абонементе');
            console.log('✅ Расписание занятий');
            console.log('✅ Информация о преподавателях');
            console.log('='.repeat(50));
            
            console.log('\n🔧 ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ:');
            console.log('='.repeat(50));
            console.log(`TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log(`AMOCRM_DOMAIN: ${AMOCRM_DOMAIN || '❌ Не установлен'}`);
            console.log(`AMOCRM_ACCESS_TOKEN: ${AMOCRM_ACCESS_TOKEN ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log('='.repeat(50));
        });
        
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
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
};

// Запуск сервера
startServer();
