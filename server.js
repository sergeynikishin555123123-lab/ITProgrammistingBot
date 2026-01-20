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
        console.log('🔄 Инициализация amoCRM...');
        
        if (!AMOCRM_DOMAIN) {
            console.log('⚠️ AMOCRM_DOMAIN не указан');
            this.isInitialized = false;
            return false;
        }

        if (this.accessToken) {
            console.log('✅ Найден access token');
            this.isInitialized = true;
            
            // Проверяем валидность токена
            try {
                await this.checkTokenValidity();
                return true;
            } catch (error) {
                console.log('❌ Токен невалиден, пытаемся обновить...');
                try {
                    await this.refreshAccessToken();
                    return true;
                } catch (refreshError) {
                    console.log('❌ Не удалось обновить токен:', refreshError.message);
                    this.isInitialized = false;
                    return false;
                }
            }
        } else if (AMOCRM_AUTH_CODE) {
            console.log('🔄 Получен код авторизации, получаем токен...');
            try {
                await this.getAccessToken(AMOCRM_AUTH_CODE);
                return true;
            } catch (error) {
                console.log('❌ Ошибка получения токена:', error.message);
                this.isInitialized = false;
                return false;
            }
        } else {
            console.log('⚠️ Нет данных для подключения к amoCRM');
            this.isInitialized = false;
            return false;
        }
    }

    async checkTokenValidity() {
        try {
            const response = await axios.get(`${this.baseUrl}/api/v4/account`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });
            
            console.log('✅ Токен валиден, аккаунт:', response.data.name);
            return true;
        } catch (error) {
            if (error.response?.status === 401) {
                throw new Error('Токен невалиден');
            }
            throw error;
        }
    }

    async getAccessToken(authCode) {
        if (!authCode) {
            throw new Error('Не указан код авторизации');
        }

        console.log('🔄 Получение access token...');
        
        const tokenData = {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'authorization_code',
            code: authCode,
            redirect_uri: this.redirectUri
        };

        try {
            const response = await axios.post('https://www.amocrm.ru/oauth2/access_token', tokenData, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            const { access_token, refresh_token, expires_in } = response.data;
            
            this.accessToken = access_token;
            this.refreshToken = refresh_token;
            this.tokenExpiresAt = Date.now() + expires_in * 1000;
            this.isInitialized = true;
            
            console.log('✅ Access token получен успешно');
            console.log(`⏰ Токен истекает: ${new Date(this.tokenExpiresAt).toLocaleString()}`);
            
            // Сохраняем токены в БД
            await this.saveTokensToDatabase(access_token, refresh_token, this.tokenExpiresAt);
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка получения access token:', error.response?.data || error.message);
            throw error;
        }
    }

    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('Нет refresh token');
        }

        console.log('🔄 Обновление access token...');
        
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
                timeout: 10000
            });

            const { access_token, refresh_token, expires_in } = response.data;
            
            this.accessToken = access_token;
            this.refreshToken = refresh_token;
            this.tokenExpiresAt = Date.now() + expires_in * 1000;
            this.isInitialized = true;
            
            console.log('✅ Access token обновлен успешно');
            console.log(`⏰ Новое время истечения: ${new Date(this.tokenExpiresAt).toLocaleString()}`);
            
            // Сохраняем токены в БД
            await this.saveTokensToDatabase(access_token, refresh_token, this.tokenExpiresAt);
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка обновления токена:', error.response?.data || error.message);
            this.isInitialized = false;
            throw error;
        }
    }

    async saveTokensToDatabase(accessToken, refreshToken, expiresAt) {
        try {
            await db.run(
                `INSERT OR REPLACE INTO amocrm_tokens (id, access_token, refresh_token, expires_at) 
                 VALUES (1, ?, ?, ?)`,
                [accessToken, refreshToken, expiresAt]
            );
            console.log('✅ Токены сохранены в БД');
        } catch (error) {
            console.error('❌ Ошибка сохранения токенов:', error.message);
        }
    }

    async loadTokensFromDatabase() {
        try {
            const tokens = await db.get('SELECT * FROM amocrm_tokens WHERE id = 1');
            if (tokens) {
                this.accessToken = tokens.access_token;
                this.refreshToken = tokens.refresh_token;
                this.tokenExpiresAt = tokens.expires_at;
                
                // Проверяем не истек ли токен
                if (Date.now() < this.tokenExpiresAt - 60000) { // Запас 1 минута
                    this.isInitialized = true;
                    return true;
                } else {
                    console.log('🔄 Токен истек, обновляем...');
                    return await this.refreshAccessToken();
                }
            }
            return false;
        } catch (error) {
            console.error('❌ Ошибка загрузки токенов:', error.message);
            return false;
        }
    }

    async makeRequest(method, endpoint, data = null, retry = true) {
        if (!this.isInitialized) {
            throw new Error('amoCRM не инициализирован');
        }

        // Проверяем не истек ли токен
        if (Date.now() > this.tokenExpiresAt - 60000) { // Запас 1 минута
            console.log('🔄 Токен скоро истекает, обновляем...');
            await this.refreshAccessToken();
        }

        try {
            const config = {
                method: method,
                url: `${this.baseUrl}${endpoint}`,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            };

            if (data) {
                config.data = data;
            }

            const response = await axios(config);
            return response.data;
            
        } catch (error) {
            console.error(`❌ Ошибка запроса к amoCRM ${method} ${endpoint}:`, error.message);
            
            // Если 401 ошибка и еще не пробовали обновить токен
            if (error.response?.status === 401 && retry) {
                console.log('🔄 Обновляем токен и повторяем запрос...');
                await this.refreshAccessToken();
                return await this.makeRequest(method, endpoint, data, false);
            }
            
            throw error;
        }
    }

    async searchContactsByPhone(phoneNumber) {
        console.log(`🔍 Поиск контакта по телефону: ${phoneNumber}`);
        
        try {
            // Очищаем номер телефона
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            let searchPhone = cleanPhone;
            
            // Пробуем разные форматы
            const phoneVariants = [
                cleanPhone,
                `+7${cleanPhone.slice(-10)}`,
                `8${cleanPhone.slice(-10)}`,
                `7${cleanPhone.slice(-10)}`
            ];
            
            const uniqueVariants = [...new Set(phoneVariants)];
            
            let allContacts = [];
            
            // Ищем по всем вариантам
            for (const phoneVariant of uniqueVariants) {
                try {
                    console.log(`🔍 Поиск по варианту: ${phoneVariant}`);
                    
                    const response = await this.makeRequest('GET', `/api/v4/contacts?query=${encodeURIComponent(phoneVariant)}&limit=50`);
                    
                    if (response._embedded && response._embedded.contacts) {
                        const contacts = response._embedded.contacts;
                        console.log(`✅ Найдено ${contacts.length} контактов по варианту ${phoneVariant}`);
                        allContacts = [...allContacts, ...contacts];
                    }
                } catch (searchError) {
                    console.log(`⚠️ Ошибка поиска по варианту ${phoneVariant}:`, searchError.message);
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
            
            console.log(`📊 Всего уникальных контактов: ${uniqueContacts.length}`);
            
            // Детальная информация о найденных контактах
            for (const contact of uniqueContacts) {
                console.log(`📋 Контакт ${contact.id}: ${contact.name}`);
                if (contact.custom_fields_values) {
                    const phones = contact.custom_fields_values
                        .filter(field => field.field_code === 'PHONE' || field.field_name?.toLowerCase().includes('телефон'))
                        .flatMap(field => field.values?.map(v => v.value) || []);
                    console.log(`   📞 Телефоны: ${phones.join(', ')}`);
                }
            }
            
            return {
                _embedded: {
                    contacts: uniqueContacts
                }
            };
            
        } catch (error) {
            console.error('❌ Ошибка поиска контактов:', error.message);
            throw error;
        }
    }

    async getContactDetails(contactId) {
        try {
            const response = await this.makeRequest('GET', `/api/v4/contacts/${contactId}?with=customers,leads`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения деталей контакта ${contactId}:`, error.message);
            throw error;
        }
    }

    async getLeadsByContactId(contactId) {
        try {
            const response = await this.makeRequest('GET', `/api/v4/leads?filter[contacts][id][]=${contactId}`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения сделок контакта ${contactId}:`, error.message);
            throw error;
        }
    }

    async getContactCustomFields() {
        try {
            const response = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            return response;
        } catch (error) {
            console.error('❌ Ошибка получения кастомных полей:', error.message);
            throw error;
        }
    }

    async getLeadCustomFields() {
        try {
            const response = await this.makeRequest('GET', '/api/v4/leads/custom_fields');
            return response;
        } catch (error) {
            console.error('❌ Ошибка получения кастомных полей сделок:', error.message);
            throw error;
        }
    }

    async getUserById(userId) {
        try {
            const response = await this.makeRequest('GET', `/api/v4/users/${userId}`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения пользователя ${userId}:`, error.message);
            throw error;
        }
    }

    async getAccountInfo() {
        try {
            const response = await this.makeRequest('GET', '/api/v4/account');
            return response;
        } catch (error) {
            console.error('❌ Ошибка получения информации об аккаунте:', error.message);
            throw error;
        }
    }

    async parseContactToStudentProfile(contact) {
        console.log(`🔍 Парсинг контакта: ${contact.name} (ID: ${contact.id})`);
        
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
            custom_fields: contact.custom_fields_values || []
        };
        
        // Парсим кастомные поля
        if (contact.custom_fields_values) {
            for (const field of contact.custom_fields_values) {
                const fieldName = field.field_name?.toLowerCase() || '';
                const fieldCode = field.field_code || '';
                const fieldValues = field.values || [];
                
                console.log(`   📝 Поле ${fieldName} (${fieldCode}):`, fieldValues);
                
                if (fieldValues.length > 0) {
                    const value = fieldValues[0].value;
                    
                    // Телефоны
                    if (fieldCode === 'PHONE' || fieldName.includes('телефон')) {
                        profile.phone_number = value;
                    }
                    
                    // Email
                    else if (fieldCode === 'EMAIL' || fieldName.includes('email') || fieldName.includes('почта')) {
                        profile.email = value;
                    }
                    
                    // Филиал
                    else if (fieldName.includes('филиал') || fieldName.includes('branch')) {
                        profile.branch = value;
                    }
                    
                    // Родитель
                    else if (fieldName.includes('родитель') || fieldName.includes('parent')) {
                        profile.parent_name = value;
                    }
                    
                    // Учитель
                    else if (fieldName.includes('преподаватель') || fieldName.includes('учитель') || fieldName.includes('teacher')) {
                        profile.teacher_name = value;
                    }
                    
                    // День недели
                    else if (fieldName.includes('день') && fieldName.includes('недели')) {
                        profile.day_of_week = value;
                    }
                    
                    // Время
                    else if (fieldName.includes('время') || fieldName.includes('time')) {
                        profile.time_slot = value;
                    }
                }
            }
        }
        
        console.log(`✅ Спарсенный профиль:`, {
            имя: profile.student_name,
            телефон: profile.phone_number,
            филиал: profile.branch,
            учитель: profile.teacher_name
        });
        
        return profile;
    }

    async enrichProfileWithLeads(profile) {
        try {
            const leadsResponse = await this.getLeadsByContactId(profile.amocrm_contact_id);
            
            if (leadsResponse._embedded && leadsResponse._embedded.leads.length > 0) {
                const lead = leadsResponse._embedded.leads[0];
                
                profile.subscription_type = lead.name || 'Абонемент';
                profile.total_classes = lead.price || 0; // Используем price как количество занятий
                
                // Парсим кастомные поля сделки
                if (lead.custom_fields_values) {
                    for (const field of lead.custom_fields_values) {
                        const fieldName = field.field_name?.toLowerCase() || '';
                        const fieldValues = field.values || [];
                        
                        if (fieldValues.length > 0) {
                            const value = fieldValues[0].value;
                            
                            if (fieldName.includes('осталось') || fieldName.includes('remaining')) {
                                profile.remaining_classes = parseInt(value) || 0;
                            }
                            else if (fieldName.includes('дата окончания') || fieldName.includes('expiration')) {
                                profile.expiration_date = value;
                            }
                        }
                    }
                }
                
                console.log(`✅ Профиль обогащен данными сделки: ${lead.name}`);
            }
            
            return profile;
        } catch (error) {
            console.log('⚠️ Не удалось получить сделки для контакта:', error.message);
            return profile;
        }
    }

    async getStudentsByPhone(phoneNumber) {
        console.log(`🔍 Полный поиск учеников по телефону: ${phoneNumber}`);
        
        try {
            // 1. Ищем в amoCRM
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            console.log(`📊 Найдено контактов в amoCRM: ${contacts.length}`);
            
            const profiles = [];
            
            // 2. Парсим каждый контакт
            for (const contact of contacts) {
                try {
                    // Создаем базовый профиль из контакта
                    let profile = await this.parseContactToStudentProfile(contact);
                    
                    // Обогащаем данными из сделок
                    profile = await this.enrichProfileWithLeads(profile);
                    
                    profiles.push(profile);
                } catch (parseError) {
                    console.error(`❌ Ошибка парсинга контакта ${contact.id}:`, parseError.message);
                }
            }
            
            console.log(`✅ Создано профилей: ${profiles.length}`);
            
            // 3. Если в amoCRM не нашли, ищем в локальной базе
            if (profiles.length === 0) {
                console.log('🔍 Поиск в локальной базе данных...');
                const localProfiles = await db.all(
                    `SELECT * FROM student_profiles 
                     WHERE phone_number LIKE ? AND is_active = 1`,
                    [`%${phoneNumber.replace(/\D/g, '').slice(-10)}%`]
                );
                
                console.log(`📊 Найдено в локальной базе: ${localProfiles.length}`);
                return localProfiles;
            }
            
            return profiles;
            
        } catch (error) {
            console.error('❌ Критическая ошибка поиска учеников:', error.message);
            
            // При ошибке ищем в локальной базе
            try {
                const localProfiles = await db.all(
                    `SELECT * FROM student_profiles 
                     WHERE phone_number LIKE ? AND is_active = 1`,
                    [`%${phoneNumber.replace(/\D/g, '').slice(-10)}%`]
                );
                
                console.log(`📊 Найдено в локальной базе после ошибки: ${localProfiles.length}`);
                return localProfiles;
            } catch (dbError) {
                console.error('❌ Ошибка поиска в локальной БД:', dbError.message);
                return [];
            }
        }
    }

    async syncAllData() {
        try {
            console.log('🔄 Начало полной синхронизации данных...');
            
            if (!this.isInitialized) {
                console.log('⚠️ amoCRM не инициализирован, используем локальные данные');
                return await this.syncDemoData();
            }
            
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
        try {
            console.log('🔄 Синхронизация преподавателей...');
            
            if (!this.isInitialized) {
                return await this.syncDemoTeachers();
            }
            
            const response = await this.makeRequest('GET', '/api/v4/users');
            const users = response._embedded?.users || [];
            
            console.log(`📊 Найдено пользователей в amoCRM: ${users.length}`);
            
            for (const user of users) {
                try {
                    // Проверяем, является ли пользователь преподавателем
                    const isTeacher = await this.checkIfTeacher(user);
                    
                    if (isTeacher) {
                        const existingTeacher = await db.get(
                            'SELECT * FROM teachers WHERE amocrm_user_id = ?',
                            [user.id]
                        );
                        
                        const teacherData = {
                            name: user.name || '',
                            email: user.email || '',
                            phone_number: user.phone || '',
                            amocrm_user_id: user.id,
                            is_active: 1
                        };
                        
                        if (!existingTeacher) {
                            await db.run(
                                `INSERT INTO teachers (name, email, phone_number, amocrm_user_id, is_active) 
                                 VALUES (?, ?, ?, ?, ?)`,
                                Object.values(teacherData)
                            );
                            console.log(`✅ Добавлен преподаватель: ${user.name}`);
                        } else {
                            await db.run(
                                `UPDATE teachers SET 
                                 name = ?, email = ?, phone_number = ?, updated_at = CURRENT_TIMESTAMP
                                 WHERE amocrm_user_id = ?`,
                                [teacherData.name, teacherData.email, teacherData.phone_number, user.id]
                            );
                        }
                    }
                } catch (userError) {
                    console.error(`❌ Ошибка обработки пользователя ${user.id}:`, userError.message);
                }
            }
            
            console.log(`✅ Синхронизировано преподавателей: ${users.length}`);
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации преподавателей:', error.message);
            await this.syncDemoTeachers();
        }
    }

    async checkIfTeacher(user) {
        // Здесь можно добавить логику определения преподавателя
        // Например, по определенной роли, должности и т.д.
        return true; // Временно считаем всех пользователей преподавателями
    }

    async syncStudentsFromAmo() {
        try {
            console.log('🔄 Синхронизация учеников...');
            
            if (!this.isInitialized) {
                return await this.syncDemoStudents();
            }
            
            // Получаем контакты с лидами
            const response = await this.makeRequest('GET', '/api/v4/contacts?with=leads&limit=100');
            const contacts = response._embedded?.contacts || [];
            
            console.log(`📊 Найдено контактов для синхронизации: ${contacts.length}`);
            
            let syncedCount = 0;
            
            for (const contact of contacts) {
                try {
                    // Парсим контакт в профиль
                    let profile = await this.parseContactToStudentProfile(contact);
                    
                    // Обогащаем данными из сделок
                    profile = await this.enrichProfileWithLeads(profile);
                    
                    // Сохраняем в базу
                    const existingProfile = await db.get(
                        'SELECT * FROM student_profiles WHERE amocrm_contact_id = ?',
                        [contact.id]
                    );
                    
                    if (!existingProfile) {
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
                    }
                } catch (contactError) {
                    console.error(`❌ Ошибка синхронизации контакта ${contact.id}:`, contactError.message);
                }
            }
            
            console.log(`✅ Синхронизировано учеников: ${syncedCount}`);
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации учеников:', error.message);
            await this.syncDemoStudents();
        }
    }

    async syncSubscriptionsFromAmo() {
        try {
            console.log('🔄 Синхронизация абонементов...');
            
            if (!this.isInitialized) {
                return;
            }
            
            // Получаем активные сделки
            const response = await this.makeRequest('GET', '/api/v4/leads?filter[statuses][][status_id]=142&limit=100');
            const leads = response._embedded?.leads || [];
            
            console.log(`📊 Найдено активных сделок: ${leads.length}`);
            
            for (const lead of leads) {
                try {
                    // Получаем контакты сделки
                    if (lead._embedded && lead._embedded.contacts) {
                        for (const contact of lead._embedded.contacts) {
                            // Обновляем профиль ученика
                            await db.run(
                                `UPDATE student_profiles 
                                 SET subscription_type = ?, total_classes = ?, remaining_classes = ?,
                                     expiration_date = ?, updated_at = CURRENT_TIMESTAMP
                                 WHERE amocrm_contact_id = ?`,
                                [
                                    lead.name || 'Абонемент',
                                    lead.price || 0,
                                    await this.calculateRemainingClasses(lead),
                                    await this.getLeadExpirationDate(lead),
                                    contact.id
                                ]
                            );
                        }
                    }
                } catch (leadError) {
                    console.error(`❌ Ошибка обработки сделки ${lead.id}:`, leadError.message);
                }
            }
            
            console.log(`✅ Синхронизировано абонементов: ${leads.length}`);
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации абонементов:', error.message);
        }
    }

    async calculateRemainingClasses(lead) {
        // Логика расчета оставшихся занятий
        // Можно парсить из кастомных полей или рассчитывать на основе дат
        return Math.floor((lead.price || 0) * 0.7); // Временная логика
    }

    async getLeadExpirationDate(lead) {
        // Логика получения даты окончания
        // Можно парсить из кастомных полей или рассчитывать
        const created = lead.created_at * 1000;
        const expiration = new Date(created + 30 * 24 * 60 * 60 * 1000); // +30 дней
        return expiration.toISOString().split('T')[0];
    }

    async syncDemoTeachers() {
        try {
            console.log('📝 Загрузка демо-преподавателей...');
            
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
                }
            }
            
            console.log('✅ Демо-преподаватели загружены');
            
        } catch (error) {
            console.error('❌ Ошибка загрузки демо-преподавателей:', error.message);
        }
    }

    async syncDemoStudents() {
        try {
            console.log('📝 Загрузка демо-учеников...');
            
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
                }
            }
            
            console.log('✅ Демо-ученики загружены');
            
        } catch (error) {
            console.error('❌ Ошибка загрузки демо-учеников:', error.message);
        }
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
        console.log('🔄 Инициализация базы данных школы рисования...');
        
        // Создаем директорию для базы данных если её нет
        const dbDir = path.join(__dirname, 'data');
        try {
            await fs.mkdir(dbDir, { recursive: true });
        } catch (mkdirError) {
            // Игнорируем ошибку если директория уже существует
        }
        
        const dbPath = path.join(dbDir, 'art_school.db');
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        // Проверяем существование базы
        try {
            await fs.access(dbPath);
            console.log('📂 Используем существующую базу данных');
        } catch (error) {
            console.log('📝 Создаем новую базу данных...');
        }
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        await db.run('PRAGMA busy_timeout = 5000');
        
        await createTables();
        
        console.log('🎉 База данных успешно инициализирована!');
        
        // Инициализируем amoCRM
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            // Загружаем токены из БД
            await amoCrmService.loadTokensFromDatabase();
            
            // Начальная синхронизация
            setTimeout(async () => {
                await amoCrmService.syncAllData();
            }, 3000);
        } else {
            console.log('⚠️ Используются демо-данные');
            await amoCrmService.syncDemoData();
        }
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        
        try {
            console.log('🔄 Пробуем создать временную базу данных в памяти...');
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            console.log('✅ Создана временная база данных в памяти');
            await db.run('PRAGMA foreign_keys = ON');
            await createTables();
            await amoCrmService.syncDemoData();
            console.log('⚠️ ВНИМАНИЕ: Используется база данных в памяти. Данные не сохранятся после перезапуска!');
            
            return db;
        } catch (memoryError) {
            console.error('❌ Не удалось создать даже базу в памяти:', memoryError.message);
            throw error;
        }
    }
};


const createTables = async () => {
    try {
        console.log('📊 Создание таблиц...');
        
        // Токены amoCRM
        await db.exec(`
            CREATE TABLE IF NOT EXISTS amocrm_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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
                is_active INTEGER DEFAULT 1,
                last_selected INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(id) ON DELETE CASCADE
            )
        `);

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

        // Сессии пользователей (обновленная версия)
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

        console.log('✅ Все таблицы созданы');
        
        // Проверяем и обновляем существующие таблицы
        await updateExistingTables();
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};

// Функция для обновления существующих таблиц
const updateExistingTables = async () => {
    try {
        console.log('🔄 Проверка структуры таблиц...');
        
        // Проверяем существование столбцов в user_sessions
        const sessionColumns = await db.all(`
            PRAGMA table_info(user_sessions);
        `);
        
        const columnNames = sessionColumns.map(col => col.name);
        console.log('Столбцы user_sessions:', columnNames);
        
        // Добавляем отсутствующие столбцы
        if (!columnNames.includes('session_data')) {
            console.log('🔄 Добавляем столбец session_data в user_sessions');
            await db.run(`
                ALTER TABLE user_sessions ADD COLUMN session_data TEXT;
            `);
        }
        
        if (!columnNames.includes('phone_number')) {
            console.log('🔄 Добавляем столбец phone_number в user_sessions');
            await db.run(`
                ALTER TABLE user_sessions ADD COLUMN phone_number TEXT;
            `);
        }
        
        if (!columnNames.includes('user_id')) {
            console.log('🔄 Добавляем столбец user_id в user_sessions');
            await db.run(`
                ALTER TABLE user_sessions ADD COLUMN user_id INTEGER;
            `);
        }
        
        console.log('✅ Структура таблиц проверена и обновлена');
        
    } catch (error) {
        console.error('⚠️ Ошибка обновления таблиц:', error.message);
        // Игнорируем ошибки, так как таблицы могут быть уже обновлены
    }
};

// ==================== ДЕМО ДАННЫЕ ====================
const createDemoData = async () => {
    try {
        console.log('📝 Создание демо-данных...');

        // Демо администраторы
        const adminExists = await db.get("SELECT 1 FROM administrators LIMIT 1");
        if (!adminExists) {
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
        }

        // Демо расписание
        const scheduleExists = await db.get("SELECT 1 FROM schedule LIMIT 1");
        if (!scheduleExists) {
            const schedule = [
                ['Свиблово', 'понедельник', '16:00', '17:30', 1, 'Анна Петрова', 'Дети 7-9 лет', 'Кабинет 1', 8, 6],
                ['Свиблово', 'понедельник', '18:00', '19:30', 1, 'Анна Петрова', 'Подростки 10-12 лет', 'Кабинет 1', 8, 5],
                ['Свиблово', 'вторник', '17:00', '18:30', 3, 'Елена Ковалева', 'Дети 5-7 лет', 'Кабинет 2', 6, 4],
                ['Чертаново', 'среда', '16:30', '18:00', 2, 'Сергей Смирнов', 'Взрослые', 'Кабинет 3', 10, 8],
                ['Чертаново', 'суббота', '11:00', '12:30', 2, 'Сергей Смирнов', 'Подростки', 'Кабинет 3', 8, 7],
                ['Чертаново', 'суббота', '13:00', '14:30', 3, 'Елена Ковалеva', 'Дети 7-9 лет', 'Кабинет 4', 8, 6]
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
        }

        // Демо FAQ
        const faqExists = await db.get("SELECT 1 FROM faq LIMIT 1");
        if (!faqExists) {
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
        }

        // Демо новости
        const newsExists = await db.get("SELECT 1 FROM news LIMIT 1");
        if (!newsExists) {
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
        }

        // Контакты филиалов
        const contactsExist = await db.get("SELECT 1 FROM branch_contacts LIMIT 1");
        if (!contactsExist) {
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

        console.log('🎉 Демо-данные созданы!');
        
    } catch (error) {
        console.error('⚠️ Ошибка создания демо-данных:', error.message);
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

// Поиск профилей по номеру телефона
async function findProfilesByPhone(phoneNumber) {
    try {
        console.log(`🔍 Поиск ученика по телефону: ${phoneNumber}`);
        
        // Пробуем найти в amoCRM
        const profiles = await amoCrmService.getStudentByPhoneFromAmo(phoneNumber);
        
        if (profiles && profiles.length > 0) {
            // Проверяем, не демо ли это данные
            const isDemoProfile = profiles[0].student_name === 'Иван Иванов' || 
                                 profiles[0].student_name === 'Мария Сидорова';
            
            if (!isDemoProfile) {
                console.log(`✅ Найдено ${profiles.length} реальных профилей из AmoCRM`);
                return profiles;
            }
        }
        
        // Если не нашли или это демо, ищем в локальной базе
        const localProfiles = await db.all(
            `SELECT * FROM student_profiles 
             WHERE phone_number = ? AND is_active = 1`,
            [phoneNumber]
        );
        
        if (localProfiles && localProfiles.length > 0) {
            console.log(`✅ Найдено ${localProfiles.length} профилей в локальной базе`);
            return localProfiles;
        }
        
        // Если ничего не нашли, возвращаем пустой массив
        console.log('⚠️ Профили не найдены');
        return [];
        
    } catch (error) {
        console.error('❌ Ошибка поиска профилей:', error.message);
        return [];
    }
}

// Сохранение профилей в базу
async function saveProfiles(telegramUserId, profiles) {
    const savedProfiles = [];
    
    for (const profile of profiles) {
        try {
            // Проверяем существующий профиль
            const existingProfile = await db.get(
                `SELECT * FROM student_profiles 
                 WHERE phone_number = ? AND student_name = ? AND telegram_user_id = ?`,
                [profile.phone_number, profile.student_name, telegramUserId]
            );
            
            if (!existingProfile) {
                // Создаем новый профиль
                const result = await db.run(
                    `INSERT INTO student_profiles 
                     (telegram_user_id, amocrm_contact_id, student_name, parent_name, phone_number, 
                      email, branch, subscription_type, total_classes, remaining_classes, 
                      expiration_date, teacher_name, day_of_week, time_slot, amocrm_custom_fields) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        telegramUserId,
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
                        profile.custom_fields ? JSON.stringify(profile.custom_fields) : null
                    ]
                );
                
                const newProfile = await db.get(
                    'SELECT * FROM student_profiles WHERE id = ?',
                    [result.lastID]
                );
                savedProfiles.push(newProfile);
            } else {
                // Обновляем существующий профиль
                await db.run(
                    `UPDATE student_profiles 
                     SET branch = ?, subscription_type = ?,
                         total_classes = ?, remaining_classes = ?, expiration_date = ?,
                         teacher_name = ?, day_of_week = ?, time_slot = ?,
                         amocrm_contact_id = ?, amocrm_custom_fields = ?,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [
                        profile.branch || existingProfile.branch,
                        profile.subscription_type || existingProfile.subscription_type,
                        profile.total_classes || existingProfile.total_classes,
                        profile.remaining_classes || existingProfile.remaining_classes,
                        profile.expiration_date || existingProfile.expiration_date,
                        profile.teacher_name || existingProfile.teacher_name,
                        profile.day_of_week || existingProfile.day_of_week,
                        profile.time_slot || existingProfile.time_slot,
                        profile.amocrm_contact_id || existingProfile.amocrm_contact_id,
                        profile.custom_fields ? JSON.stringify(profile.custom_fields) : existingProfile.amocrm_custom_fields,
                        existingProfile.id
                    ]
                );
                
                savedProfiles.push({
                    ...existingProfile,
                    ...profile
                });
            }
        } catch (error) {
            console.error('❌ Ошибка сохранения профиля:', error.message);
        }
    }
    
    return savedProfiles;
}

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
        } else {
            await db.run(
                `UPDATE telegram_users 
                 SET first_name = ?, last_name = ?, username = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE telegram_id = ?`,
                [firstName, lastName, username, telegramId]
            );
        }
    } catch (error) {
        console.error('Ошибка сохранения пользователя:', error);
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

// ==================== RATE LIMITING ====================
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Слишком много запросов с вашего IP, пожалуйста, попробуйте позже'
});
app.use('/api/', limiter);

// Webhook для Telegram
app.post('/webhook', (req, res) => {
    bot.handleUpdate(req.body, res);
});

// ==================== API ДЛЯ РАБОТЫ С AMOCRM ====================

// Статус amoCRM
app.get('/api/amocrm/status', async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                is_initialized: amoCrmService.isInitialized,
                domain: AMOCRM_DOMAIN,
                client_id: !!AMOCRM_CLIENT_ID,
                access_token: !!AMOCRM_ACCESS_TOKEN,
                using_demo_data: !amoCrmService.isInitialized
            }
        });
    } catch (error) {
        console.error('Ошибка статуса amoCRM:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статуса amoCRM'
        });
    }
});

// Тестовый эндпоинт для проверки соединения с AmoCRM
app.get('/api/amocrm/test-connection', async (req, res) => {
    try {
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                error: 'AmoCRM не инициализирован',
                details: {
                    domain: AMOCRM_DOMAIN,
                    has_client_id: !!AMOCRM_CLIENT_ID,
                    has_access_token: !!AMOCRM_ACCESS_TOKEN
                }
            });
        }
        
        // Пробуем сделать простой запрос к AmoCRM
        let testResult = {
            connection: false,
            account_info: null,
            error: null
        };
        
        try {
            const accountInfo = await amoCrmService.makeRequest('GET', '/api/v4/account');
            testResult.connection = true;
            testResult.account_info = {
                id: accountInfo.id,
                name: accountInfo.name,
                created_at: accountInfo.created_at
            };
        } catch (apiError) {
            testResult.connection = false;
            testResult.error = {
                message: apiError.message,
                status: apiError.response?.status,
                statusText: apiError.response?.statusText
            };
        }
        
        res.json({
            success: true,
            data: testResult
        });
        
    } catch (error) {
        console.error('Ошибка теста AmoCRM:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка тестирования AmoCRM'
        });
    }
});

// Синхронизация данных
app.post('/api/amocrm/sync', async (req, res) => {
    try {
        const { sync_type } = req.body;
        
        switch (sync_type) {
            case 'teachers':
                await amoCrmService.syncTeachersFromAmo();
                break;
            case 'students':
                await amoCrmService.syncStudentsFromAmo();
                break;
            case 'subscriptions':
                await amoCrmService.syncSubscriptionsFromAmo();
                break;
            case 'all':
            default:
                await amoCrmService.syncAllData();
                break;
        }
        
        res.json({
            success: true,
            message: `Синхронизация ${sync_type || 'all'} завершена`,
            using_demo_data: !amoCrmService.isInitialized
        });
        
    } catch (error) {
        console.error('Ошибка синхронизации:', error);
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
        using_demo_data: !amoCrmService.isInitialized
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
        
        console.log(`🔐 Авторизация Telegram: ${telegram_id}, телефон: ${phone}`);
        
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
        } else {
            // Обновляем существующего пользователя
            await db.run(
                `UPDATE telegram_users 
                 SET phone_number = ?, first_name = ?, last_name = ?, username = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [phone, first_name || '', last_name || '', username || '', telegramUser.id]
            );
        }
        
        // Ищем профили по телефону
        const profiles = await findProfilesByPhone(phone);
        const savedProfiles = await saveProfiles(telegramUser.id, profiles);
        
        // Если есть профили, устанавливаем первый как выбранный
        if (savedProfiles.length > 0) {
            await db.run(
                'UPDATE student_profiles SET last_selected = 0 WHERE telegram_user_id = ?',
                [telegramUser.id]
            );
            
            await db.run(
                'UPDATE student_profiles SET last_selected = 1 WHERE id = ?',
                [savedProfiles[0].id]
            );
        }
        
        // Создаем JWT токен
        const token = jwt.sign(
            {
                id: telegramUser.id,
                telegram_id: telegramUser.telegram_id,
                phone: telegramUser.phone_number,
                is_telegram_auth: true
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: profiles.length > 0 ? 'Авторизация успешна' : 'Профили не найдены',
            data: {
                user: telegramUser,
                profiles: savedProfiles,
                total_profiles: savedProfiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                using_demo_data: !amoCrmService.isInitialized,
                token: token
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка авторизации через Telegram:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка авторизации через Telegram'
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
        
        console.log(`🔍 Поиск по телефону: ${phone}`);
        
        // Очищаем номер телефона
        const cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
            return res.status(400).json({
                success: false,
                error: 'Неверный номер телефона'
            });
        }
        
        // Форматируем номер
        const formattedPhone = '+7' + cleanPhone.substring(cleanPhone.length - 10);
        
        // Ищем профили по телефону
        const profiles = await findProfilesByPhone(formattedPhone);
        
        console.log(`Найдено профилей: ${profiles.length}`);
        
        if (profiles.length === 0) {
            return res.status(404).json({
                success: true, // Успешный ответ, но профилей нет
                error: 'Профиль не найден',
                message: 'Номер телефона не найден в системе. Если у вас есть абонемент, свяжитесь с администратором.',
                data: {
                    profiles: [],
                    total_profiles: 0,
                    amocrm_connected: amoCrmService.isInitialized,
                    using_demo_data: !amoCrmService.isInitialized
                }
            });
        }
        
        // Создаем временного пользователя для сессии
        const tempUser = {
            id: Date.now(), // Временный ID
            phone_number: formattedPhone,
            first_name: profiles[0].student_name?.split(' ')[0] || 'Ученик',
            last_name: profiles[0].student_name?.split(' ')[1] || '',
            is_temp: true
        };
        
        // Создаем сессию в базе
        const sessionId = require('crypto').randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 дней
        
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
        } catch (dbError) {
            console.error('Ошибка создания сессии:', dbError);
            // Если ошибка из-за отсутствия столбца, создаем новую таблицу
            if (dbError.message.includes('no column named')) {
                console.log('🔄 Пересоздаем таблицу user_sessions');
                await db.exec(`DROP TABLE IF EXISTS user_sessions;`);
                await db.exec(`
                    CREATE TABLE user_sessions (
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
                
                // Повторно вставляем данные
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
            } else {
                throw dbError;
            }
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
        
        res.json({
            success: true,
            message: 'Авторизация успешна',
            data: {
                user: tempUser,
                profiles: profiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                using_demo_data: !amoCrmService.isInitialized,
                token: token
            }
        });
        
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

// Расписание (не требует аутентификации при первом входе)
app.post('/api/schedule', async (req, res) => {
    try {
        const { branch, week_start } = req.body;
        
        if (!branch) {
            return res.status(400).json({
                success: false,
                error: 'Укажите филиал'
            });
        }
        
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
        
        res.json({
            success: true,
            data: {
                schedule: schedule,
                branch: branch
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

// Абонемент (требует аутентификации)
app.post('/api/subscription', authenticateToken, async (req, res) => {
    try {
        const { profile_id } = req.body;
        
        if (!profile_id && !req.user.phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите ID профиля или номер телефона'
            });
        }
        
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
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        // История посещений
        const visits = await db.all(
            `SELECT * FROM attendance 
             WHERE student_profile_id = ?
             ORDER BY attendance_date DESC
             LIMIT 20`,
            [profile.id]
        );
        
        res.json({
            success: true,
            data: {
                subscription: profile,
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

// Преподаватели (не требует аутентификации)
app.get('/api/teachers', async (req, res) => {
    try {
        const { branch } = req.query;
        
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
        
        res.json({
            success: true,
            data: {
                teachers: teachers,
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

// FAQ (не требует аутентификации)
app.get('/api/faq', async (req, res) => {
    try {
        const faq = await db.all(
            `SELECT * FROM faq 
             WHERE is_active = 1
             ORDER BY display_order, category`
        );
        
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

// Новости (не требует аутентификации)
app.get('/api/news', async (req, res) => {
    try {
        const { branch } = req.query;
        
        let query = `SELECT * FROM news WHERE is_active = 1`;
        let params = [];
        
        if (branch) {
            query += ` AND (branch = ? OR branch IS NULL)`;
            params.push(branch);
        }
        
        query += ` ORDER BY publish_date DESC, created_at DESC`;
        
        const news = await db.all(query, params);
        
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
        
        const admin = await db.get(
            'SELECT * FROM administrators WHERE telegram_id = ?',
            [telegram_id]
        );
        
        if (!admin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        const token = jwt.sign(
            {
                id: admin.id,
                telegram_id: admin.telegram_id,
                role: admin.role
            },
            JWT_SECRET,
            { expiresIn: '1d' }
        );
        
        res.json({
            success: true,
            data: {
                admin: admin,
                token: token
            }
        });
        
    } catch (error) {
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
        
        // Проверяем токен
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            
            const admin = await db.get(
                'SELECT * FROM administrators WHERE id = ?',
                [decoded.id]
            );
            
            if (!admin) {
                return res.status(403).json({
                    success: false,
                    error: 'Доступ запрещен'
                });
            }
            
            // Статистика
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
            
            res.json({
                success: true,
                data: {
                    total_students: totalStudents.count,
                    total_teachers: totalTeachers.count,
                    today_attendance: todayAttendance.count,
                    active_subscriptions: activeSubscriptions.count,
                    branches: branchesStats,
                    amocrm_connected: amoCrmService.isInitialized
                }
            });
            
        } catch (jwtError) {
            return res.status(401).json({
                success: false,
                error: 'Неверный токен'
            });
        }
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// ==================== OAuth callback ====================
app.get('/oauth/callback', async (req, res) => {
    try {
        const { code } = req.query;
        
        if (!code) {
            return res.status(400).send('Не передан код авторизации');
        }
        
        console.log('🔄 Получен код авторизации amoCRM');
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Авторизация amoCRM</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .container { max-width: 500px; margin: 0 auto; }
                    .success { color: #4CAF50; font-size: 24px; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="success">✅ Код авторизации получен</div>
                    <p>Код авторизации: <code>${code.substring(0, 50)}...</code></p>
                    <p>Сохраните этот код в файле .env как AMOCRM_AUTH_CODE</p>
                    <p><a href="/admin">Перейти в админ-панель</a></p>
                </div>
            </body>
            </html>
        `);
        
    } catch (error) {
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Ошибка</title>
            </head>
            <body>
                <div style="color: #f44336; font-size: 24px; margin-bottom: 20px;">❌ Ошибка</div>
                <p>${error.message}</p>
            </body>
            </html>
        `);
    }
});

// В разделе статических файлов (строка ~730 в вашем коде)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Добавьте этот маршрут ДО 404 обработчика:
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 обработчик
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Маршрут не найден'
    });
});

// ==================== ИНИЦИАЛИЗАЦИЯ И ЗАПУСК ====================

const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Пробуем запустить бота
        try {
            const botInfo = await bot.telegram.getMe();
            console.log(`🤖 Telegram бот: @${botInfo.username}`);
            
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
        app.listen(PORT, () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}!`);
            console.log(`🌐 Доступ по адресу: http://localhost:${PORT}`);
            console.log('='.repeat(80));
            console.log('🔧 КОНФИГУРАЦИЯ:');
            console.log('='.repeat(50));
            console.log(`Бот токен: ${TELEGRAM_BOT_TOKEN ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log(`Домен: ${DOMAIN}`);
            console.log(`amoCRM домен: ${AMOCRM_DOMAIN || '❌ Не установлен'}`);
            console.log(`amoCRM client_id: ${AMOCRM_CLIENT_ID ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log(`amoCRM подключен: ${amoCrmService.isInitialized ? '✅ Да' : '❌ Нет'}`);
            console.log(`Используются демо-данные: ${!amoCrmService.isInitialized ? '✅ Да' : '❌ Нет'}`);
            console.log('='.repeat(50));
            
            console.log('\n📱 КАК ИСПОЛЬЗОВАТЬ:');
            console.log('='.repeat(60));
            console.log('1. Откройте Telegram бота');
            console.log('2. Нажмите /start и поделитесь номером телефона');
            console.log('3. Перейдите в веб-приложение');
            console.log('4. Для админ-панели: http://localhost:3000/admin');
            console.log('5. Проверить статус amoCRM: http://localhost:3000/api/amocrm/status');
            console.log('6. Диагностика: http://localhost:3000/api/debug/amocrm-contacts?phone=79991234567');
            console.log('='.repeat(60));
            
            // Запускаем периодическую синхронизацию
            setInterval(async () => {
                try {
                    if (amoCrmService.isInitialized) {
                        console.log('🔄 Автоматическая синхронизация данных...');
                        await amoCrmService.syncAllData();
                    }
                } catch (syncError) {
                    console.error('❌ Ошибка автоматической синхронизации:', syncError.message);
                }
            }, 30 * 60 * 1000); // Каждые 30 минут
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Добавим новые API эндпоинты для диагностики
// ==================== ДИАГНОСТИЧЕСКИЙ API ====================

app.get('/api/debug/amocrm-contacts', async (req, res) => {
    try {
        const { phone, limit = 10 } = req.query;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона для поиска'
            });
        }
        
        console.log(`🔍 ДИАГНОСТИКА: Поиск контакта по телефону: ${phone}`);
        
        const diagnostics = {
            search_phone: phone,
            amocrm_initialized: amoCrmService.isInitialized,
            amocrm_domain: AMOCRM_DOMAIN,
            has_access_token: !!AMOCRM_ACCESS_TOKEN,
            timestamp: new Date().toISOString()
        };
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                diagnostics,
                error: 'amoCRM не инициализирован',
                suggestions: [
                    'Проверьте AMOCRM_DOMAIN в .env файле',
                    'Проверьте AMOCRM_ACCESS_TOKEN',
                    'Запустите OAuth авторизацию'
                ]
            });
        }
        
        try {
            // 1. Пробуем поиск через API
            const searchResponse = await amoCrmService.searchContactsByPhone(phone);
            diagnostics.search_results = searchResponse;
            
            // 2. Получаем информацию о кастомных полях
            const customFields = await amoCrmService.getContactCustomFields();
            diagnostics.custom_fields = customFields;
            
            // 3. Получаем информацию об аккаунте
            const accountInfo = await amoCrmService.getAccountInfo();
            diagnostics.account_info = {
                id: accountInfo.id,
                name: accountInfo.name,
                subdomain: accountInfo.subdomain
            };
            
            // 4. Пробуем найти контакты в локальной базе
            const localProfiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? 
                 LIMIT ?`,
                [`%${phone.replace(/\D/g, '').slice(-10)}%`, limit]
            );
            diagnostics.local_profiles = localProfiles;
            
            res.json({
                success: true,
                diagnostics,
                summary: {
                    amocrm_contacts_found: searchResponse._embedded?.contacts?.length || 0,
                    local_profiles_found: localProfiles.length,
                    custom_fields_count: customFields._embedded?.custom_fields?.length || 0
                }
            });
            
        } catch (apiError) {
            diagnostics.api_error = {
                message: apiError.message,
                status: apiError.response?.status,
                data: apiError.response?.data
            };
            
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

app.get('/api/debug/amocrm-test', async (req, res) => {
    try {
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                amocrm_initialized: false,
                error: 'amoCRM не инициализирован',
                required_variables: {
                    AMOCRM_DOMAIN: AMOCRM_DOMAIN || '❌ Не установлен',
                    AMOCRM_CLIENT_ID: AMOCRM_CLIENT_ID ? '✅ Установлен' : '❌ Не установлен',
                    AMOCRM_ACCESS_TOKEN: AMOCRM_ACCESS_TOKEN ? '✅ Установлен' : '❌ Не установлен',
                    AMOCRM_AUTH_CODE: AMOCRM_AUTH_CODE ? '✅ Установлен' : '❌ Не установлен'
                }
            });
        }
        
        // Пробуем сделать несколько тестовых запросов
        const tests = [];
        
        // Тест 1: Получение информации об аккаунте
        try {
            const accountInfo = await amoCrmService.getAccountInfo();
            tests.push({
                name: 'Получение информации об аккаунте',
                success: true,
                data: {
                    account_id: accountInfo.id,
                    account_name: accountInfo.name,
                    subdomain: accountInfo.subdomain
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
        
        // Тест 2: Получение кастомных полей контактов
        try {
            const customFields = await amoCrmService.getContactCustomFields();
            tests.push({
                name: 'Получение кастомных полей контактов',
                success: true,
                data: {
                    fields_count: customFields._embedded?.custom_fields?.length || 0,
                    field_names: customFields._embedded?.custom_fields?.map(f => ({
                        id: f.id,
                        name: f.name,
                        code: f.field_code,
                        type: f.type
                    })).slice(0, 10)
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
        
        // Тест 3: Поиск тестового контакта
        try {
            const testPhone = '79991234567';
            const contacts = await amoCrmService.searchContactsByPhone(testPhone);
            tests.push({
                name: 'Поиск тестового контакта',
                success: true,
                data: {
                    search_phone: testPhone,
                    contacts_found: contacts._embedded?.contacts?.length || 0,
                    contacts_sample: contacts._embedded?.contacts?.slice(0, 3).map(c => ({
                        id: c.id,
                        name: c.name,
                        phones: c.custom_fields_values
                            ?.filter(f => f.field_code === 'PHONE')
                            ?.flatMap(f => f.values?.map(v => v.value) || []) || []
                    }))
                }
            });
        } catch (error) {
            tests.push({
                name: 'Поиск тестового контакта',
                success: false,
                error: error.message
            });
        }
        
        res.json({
            success: true,
            amocrm_initialized: true,
            tests: tests,
            summary: {
                total_tests: tests.length,
                passed_tests: tests.filter(t => t.success).length,
                failed_tests: tests.filter(t => !t.success).length
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка тестирования amoCRM',
            details: error.message
        });
    }
});

// Обновленный эндпоинт для авторизации по телефону
app.post('/api/auth/phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`🔍 Поиск по телефону: ${phone}`);
        
        // Очищаем номер телефона
        const cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
            return res.status(400).json({
                success: false,
                error: 'Неверный номер телефона'
            });
        }
        
        // Форматируем номер
        let formattedPhone = cleanPhone;
        if (cleanPhone.length === 10) {
            formattedPhone = '+7' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('8')) {
            formattedPhone = '+7' + cleanPhone.slice(1);
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('7')) {
            formattedPhone = '+' + cleanPhone;
        }
        
        console.log(`📞 Форматированный номер: ${formattedPhone}`);
        
        // Ищем профили через amoCRM сервис
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        if (profiles.length === 0) {
            return res.json({
                success: true,
                message: 'Профили не найдены',
                data: {
                    profiles: [],
                    total_profiles: 0,
                    amocrm_connected: amoCrmService.isInitialized,
                    using_demo_data: !amoCrmService.isInitialized,
                    search_phone: formattedPhone
                }
            });
        }
        
        // Создаем временного пользователя для сессии
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            first_name: profiles[0].student_name?.split(' ')[0] || 'Ученик',
            last_name: profiles[0].student_name?.split(' ')[1] || '',
            is_temp: true
        };
        
        // Создаем сессию
        const sessionId = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        
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
        } catch (dbError) {
            console.error('Ошибка создания сессии:', dbError);
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
        
        res.json({
            success: true,
            message: 'Авторизация успешна',
            data: {
                user: tempUser,
                profiles: profiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                using_demo_data: !amoCrmService.isInitialized,
                token: token,
                search_details: {
                    phone_used: formattedPhone,
                    search_method: amoCrmService.isInitialized ? 'amoCRM API' : 'Local Database'
                }
            }
        });
        
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

// OAuth callback для amoCRM
app.get('/oauth/callback', async (req, res) => {
    try {
        const { code, referer, state } = req.query;
        
        console.log('🔄 Получен OAuth callback от amoCRM');
        console.log('📝 Код авторизации:', code ? '✅ Получен' : '❌ Отсутствует');
        console.log('🔗 Referer:', referer || 'Не указан');
        console.log('🏷️ State:', state || 'Не указан');
        
        if (!code) {
            return res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Ошибка авторизации amoCRM</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        .error { color: #f44336; font-size: 24px; margin-bottom: 20px; }
                        .code { background: #f5f5f5; padding: 10px; border-radius: 5px; margin: 20px 0; }
                    </style>
                </head>
                <body>
                    <div class="error">❌ Ошибка авторизации</div>
                    <p>Не получен код авторизации от amoCRM</p>
                    <p><a href="/admin">Вернуться в админ-панель</a></p>
                </body>
                </html>
            `);
        }
        
        try {
            // Получаем access token
            await amoCrmService.getAccessToken(code);
            
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Успешная авторизация amoCRM</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        .success { color: #4CAF50; font-size: 24px; margin-bottom: 20px; }
                        .info { background: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px auto; max-width: 600px; text-align: left; }
                        .code { background: #e8f5e9; padding: 10px; border-radius: 5px; margin: 10px 0; font-family: monospace; word-break: break-all; }
                    </style>
                </head>
                <body>
                    <div class="success">✅ Авторизация amoCRM успешна!</div>
                    
                    <div class="info">
                        <h3>✅ Система подключена к amoCRM</h3>
                        <p><strong>Домен:</strong> ${AMOCRM_DOMAIN}</p>
                        <p><strong>Access Token:</strong> Получен и сохранен</p>
                        <p><strong>Refresh Token:</strong> Получен и сохранен</p>
                        <p><strong>Статус:</strong> Готов к использованию</p>
                    </div>
                    
                    <div class="info">
                        <h3>📝 Информация для .env файла (если нужно):</h3>
                        <p>Код авторизации (для ручного сохранения):</p>
                        <div class="code">AMOCRM_AUTH_CODE=${code.substring(0, 50)}...</div>
                        <p><small>Этот код уже использован для получения токенов. Для повторной авторизации потребуется новый код.</small></p>
                    </div>
                    
                    <p><a href="/admin" style="background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Перейти в админ-панель</a></p>
                    <p><a href="/api/amocrm/status" style="color: #2196F3;">Проверить статус подключения</a></p>
                </body>
                </html>
            `);
            
        } catch (tokenError) {
            res.status(500).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Ошибка получения токена amoCRM</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        .error { color: #f44336; font-size: 24px; margin-bottom: 20px; }
                        .info { background: #ffebee; padding: 20px; border-radius: 5px; margin: 20px auto; max-width: 600px; text-align: left; }
                    </style>
                </head>
                <body>
                    <div class="error">❌ Ошибка получения токена amoCRM</div>
                    
                    <div class="info">
                        <h3>Детали ошибки:</h3>
                        <p><strong>Сообщение:</strong> ${tokenError.message}</p>
                        <p><strong>Код авторизации:</strong> ${code ? '✅ Получен' : '❌ Отсутствует'}</p>
                    </div>
                    
                    <p><a href="/admin">Вернуться в админ-панель</a></p>
                </body>
                </html>
            `);
        }
        
    } catch (error) {
        console.error('❌ Ошибка в OAuth callback:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Ошибка</title>
            </head>
            <body>
                <div style="color: #f44336; font-size: 24px; margin-bottom: 20px;">❌ Ошибка обработки callback</div>
                <p>${error.message}</p>
            </body>
            </html>
        `);
    }
});

// Обработка завершения работы
process.on('SIGINT', async () => {
    console.log('\n🔄 Остановка сервера...');
    if (db) {
        await db.close();
        console.log('✅ База данных закрыта');
    }
    bot.stop('SIGINT');
    console.log('✅ Telegram бот остановлен');
    process.exit(0);
});

// Запуск сервера
startServer();
