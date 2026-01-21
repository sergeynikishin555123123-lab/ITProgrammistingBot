// server.js - исправленная версия с правильной работой с файловой системой
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

// ==================== УЛУЧШЕННЫЙ КЛАСС AMOCRM С ПОЛНЫМ ПАРСИНГОМ ПОЛЕЙ ====================
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
        
        // Кешированные поля amoCRM
        this.cachedFields = [];
        this.fieldIdToName = {};
        
        // Полная карта полей amoCRM на основе ваших скриншотов
        this.fieldMapping = {
            // Основная информация
            'student_name': { 
                fields: ['ФИО ребенка', 'Имя ребенка', 'ФИО ученика', 'ФИО', 'Имя', 'Имя клиента'], 
                priority: 0,
                type: 'text'
            },
            'phone_number': { 
                fields: ['Телефон', 'Мобильный телефон', 'Phone', 'Телефон клиента', 'Основной телефон'], 
                priority: 0,
                type: 'phone'
            },
            'email': { 
                fields: ['Email', 'Электронная почта', 'Почта', 'Email клиента'], 
                priority: 0,
                type: 'email'
            },
            'birth_date': { 
                fields: ['День рождения', 'Дата рождения', 'Birthday', 'День рождения ребенка'], 
                priority: 0,
                type: 'date'
            },
            
            // Филиалы и направления
            'branch': { 
                fields: ['Филиал', 'Отделение', 'Branch', 'Студия', 'Место занятий', 'Филиал:'], 
                priority: 0,
                type: 'text'
            },
            'course_type': { 
                fields: ['Базовый курс/продвинутый', 'Тип курса', 'Курс', 'Программа'], 
                priority: 0,
                type: 'text'
            },
            'age_group': { 
                fields: ['Возраст группы', 'Возрастная категория', 'Возраст', 'Группа возраст'], 
                priority: 0,
                type: 'text'
            },
            'direction': { 
                fields: ['Рисование', 'Анатомия', 'История искусств', 'Наброски', 'Скульптура', 'Направление'], 
                priority: 1,
                type: 'text'
            },
            
            // Расписание
            'day_of_week': { 
                fields: ['День недели', 'День занятий', 'Расписание', 'День недели (2025-26)', 'День недели (Лето)', 'День недели посещения'], 
                priority: 0,
                type: 'text'
            },
            'teacher_name': { 
                fields: ['Преподаватель', 'Учитель', 'Инструктор', 'Педагог', 'Преподаватель (лето)', 'Педагог и день недели- (код)'], 
                priority: 0,
                type: 'text'
            },
            'time_slot': { 
                fields: ['Время занятия', 'Время', 'Время посещения', 'Время урока'], 
                priority: 0,
                type: 'text'
            },
            
            // Информация об абонементе
            'subscription_active': { 
                fields: ['Есть активный абонемент', 'Активный абонемент', 'Статус абонемента', 'Абонемент активен'], 
                priority: 0,
                type: 'boolean'
            },
            'subscription_type': { 
                fields: ['Тип абонемента', 'Абонемент', 'Вид абонемента', 'Тариф', 'Тип занятия'], 
                priority: 0,
                type: 'text'
            },
            'total_classes': { 
                fields: ['Количество занятий', 'Всего занятий', 'Кол-во занятий', 'Всего в абонементе'], 
                priority: 0,
                type: 'numeric'
            },
            'remaining_classes': { 
                fields: ['Осталось занятий', 'Доступно занятий', 'Остаток занятий', 'Баланс', 'Доступно бесплатных занятий'], 
                priority: 0,
                type: 'numeric'
            },
            'expiration_date': { 
                fields: ['Срок действия', 'Действует до', 'Дата окончания', 'Активен до', 'Срок заморозки (до какой да)'], 
                priority: 0,
                type: 'date'
            },
            'freeze_status': { 
                fields: ['Заморозка', 'Использована заморозка або', 'Срок заморозки', 'Цена заморозки'], 
                priority: 1,
                type: 'text'
            },
            
            // Статистика и история
            'last_visit_date': { 
                fields: ['Дата последнего визита', 'Последнее посещение', 'Последний визит'], 
                priority: 1,
                type: 'date'
            },
            'first_purchase_date': { 
                fields: ['Дата первой покупки', 'Первая покупка', 'Дата прихода'], 
                priority: 1,
                type: 'date'
            },
            'purchase_count': { 
                fields: ['Количество покупок', 'Число покупок', 'Куплено абонементов'], 
                priority: 1,
                type: 'numeric'
            },
            'total_purchase_amount': { 
                fields: ['Сумма покупок, руб.', 'Общая сумма покупок', 'Сумма всех покупок'], 
                priority: 1,
                type: 'numeric'
            },
            'average_check': { 
                fields: ['Ср. чек, руб.', 'Средний чек', 'Average check'], 
                priority: 1,
                type: 'numeric'
            },
            'month_classes_count': { 
                fields: ['Счетчик занятий за месяц', 'Занятий в месяце', 'Занятий за месяц'], 
                priority: 1,
                type: 'numeric'
            },
            
            // Пробные занятия
            'trial_attended': { 
                fields: ['Был на пробном занятии', 'Посетил пробное', 'Пробное занятие пройдено'], 
                priority: 1,
                type: 'boolean'
            },
            'trial_dates': { 
                fields: ['Даты пробных', 'Дата пробного занятия', 'Пробные занятия'], 
                priority: 1,
                type: 'date'
            },
            'incoming_student': { 
                fields: ['Поступающий', 'Поступление', 'Год поступления'], 
                priority: 1,
                type: 'text'
            },
            
            // Дополнительная информация
            'comment': { 
                fields: ['Комментарий', 'Заметки', 'Примечание', 'Дополнительно'], 
                priority: 2,
                type: 'text'
            },
            'allergy_info': { 
                fields: ['Аллергия и особенности', 'Особенности здоровья', 'Аллергии'], 
                priority: 2,
                type: 'text'
            },
            'children_in_family': { 
                fields: ['Детей в семье', 'Количество детей в семье'], 
                priority: 2,
                type: 'numeric'
            },
            'address': { 
                fields: ['Адрес', 'Адрес проживания', 'Место жительства'], 
                priority: 2,
                type: 'text'
            },
            'parent_name': { 
                fields: ['Имя родителя', 'ФИО родителя', 'Контактное лицо'], 
                priority: 2,
                type: 'text'
            },
            
            // Маркетинг и коммуникации
            'marketing_channel': { 
                fields: ['Канал отправки', 'Канал рассылки', 'Рекламный канал', 'Источник'], 
                priority: 2,
                type: 'text'
            },
            'communication_channel': { 
                fields: ['Канал связи', 'Основной канал связи', 'Предпочтительный канал'], 
                priority: 2,
                type: 'text'
            },
            'telegram_subscribed': { 
                fields: ['Подписан на Телеграм Бот', 'Telegram подписка', 'Telegram подписчик'], 
                priority: 2,
                type: 'boolean'
            },
            'newsletter_ban': { 
                fields: ['Запрет рассылок', 'Не отправлять рассылки', 'Отказ от рассылок'], 
                priority: 2,
                type: 'boolean'
            },
            'consent_photo': { 
                fields: ['Согласие на фото', 'Разрешение на фото', 'Фотосъемка разрешена'], 
                priority: 2,
                type: 'boolean'
            },
            
            // UTM метки
            'utm_source': { 
                fields: ['utm_source', 'Источник UTM', 'UTM source'], 
                priority: 2,
                type: 'text'
            },
            'utm_medium': { 
                fields: ['utm_medium', 'Тип трафика UTM', 'UTM medium'], 
                priority: 2,
                type: 'text'
            },
            'utm_campaign': { 
                fields: ['utm_campaign', 'Кампания UTM', 'UTM campaign'], 
                priority: 2,
                type: 'text'
            },
            'utm_content': { 
                fields: ['utm_content', 'Контент UTM', 'UTM content'], 
                priority: 2,
                type: 'text'
            },
            
            // Технические поля
            'max_error': { 
                fields: ['MAX Ошибка', 'Ошибка MAX', 'Ошибка системы'], 
                priority: 3,
                type: 'text'
            },
            'telegram_id': { 
                fields: ['TelegramId_WZ', 'ID Telegram', 'Telegram ID'], 
                priority: 3,
                type: 'text'
            },
            'telegram_username': { 
                fields: ['TelegramUsername_WZ', 'Telegram username', 'Username Telegram'], 
                priority: 3,
                type: 'text'
            },
            'whatsapp_error': { 
                fields: ['WA Ошибка', 'Ошибка WhatsApp', 'WhatsApp ошибка'], 
                priority: 3,
                type: 'text'
            },
            'web_contact': { 
                fields: ['Web', 'Веб-сайт', 'Сайт'], 
                priority: 3,
                type: 'text'
            }
        };
        
        this.logConfig();
    }

    logConfig() {
        console.log('📋 КОНФИГУРАЦИЯ AMOCRM:');
        console.log('='.repeat(50));
        console.log(`🌐 Домен: ${this.baseUrl}`);
        console.log(`🔑 Токен: ${this.accessToken ? '✅ Установлен' : '❌ Отсутствует'}`);
        console.log(`📊 Карта полей: ${Object.keys(this.fieldMapping).length} полей настроено`);
        console.log('='.repeat(50));
    }

    async initialize() {
        console.log('\n🔄 ИНИЦИАЛИЗАЦИЯ AMOCRM SERVICE');
        
        try {
            if (this.accessToken) {
                console.log('🔍 Проверка валидности токена...');
                const isValid = await this.checkTokenValidity(this.accessToken);
                
                if (isValid) {
                    this.isInitialized = true;
                    console.log('✅ Токен валиден');
                    
                    // Кешируем поля amoCRM
                    await this.cacheCustomFields();
                    
                    return true;
                } else {
                    console.log('❌ Токен невалиден');
                    
                    // Пробуем загрузить токен из БД
                    const loaded = await this.loadTokensFromDatabase();
                    if (loaded) {
                        this.isInitialized = true;
                        await this.cacheCustomFields();
                        return true;
                    }
                    
                    return false;
                }
            } else {
                console.log('📭 Токен не установлен в .env');
                
                // Пробуем загрузить токен из БД
                const loaded = await this.loadTokensFromDatabase();
                if (loaded) {
                    this.isInitialized = true;
                    await this.cacheCustomFields();
                    return true;
                }
                
                return false;
            }
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            return false;
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
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка проверки токена:', error.message);
            if (error.response?.status === 401) {
                console.log('❌ Токен невалиден или истек');
            }
            return false;
        }
    }

    async cacheCustomFields() {
        console.log('\n🗃️  КЕШИРОВАНИЕ КАСТОМНЫХ ПОЛЕЙ');
        
        try {
            const fields = await this.getContactCustomFields();
            this.cachedFields = fields;
            
            // Создаем обратное отображение ID поля -> название
            this.fieldIdToName = {};
            fields.forEach(field => {
                this.fieldIdToName[field.id] = field.name;
            });
            
            console.log(`✅ Закешировано ${fields.length} полей`);
            
            // Логируем найденные поля из маппинга
            console.log('\n🔍 ПОИСК КОНКРЕТНЫХ ПОЛЕЙ ИЗ МАППИНГА:');
            console.log('='.repeat(80));
            
            for (const [profileField, mapping] of Object.entries(this.fieldMapping)) {
                if (mapping.fields) {
                    let foundField = null;
                    
                    for (const fieldName of mapping.fields) {
                        const field = this.cachedFields.find(f => 
                            f.name && f.name.toLowerCase() === fieldName.toLowerCase()
                        );
                        
                        if (field) {
                            foundField = field;
                            break;
                        }
                    }
                    
                    if (foundField) {
                        console.log(`✅ "${profileField}" -> "${foundField.name}" (ID: ${foundField.id})`);
                    } else {
                        console.log(`❌ "${profileField}" -> не найдено`);
                    }
                }
            }
            
            console.log('='.repeat(80));
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка кеширования полей:', error.message);
            return false;
        }
    }

    async getContactCustomFields() {
        console.log('\n📋 ПОЛУЧЕНИЕ КАСТОМНЫХ ПОЛЕЙ КОНТАКТОВ');
        try {
            const response = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            const fields = response._embedded?.custom_fields || [];
            
            console.log(`✅ Получено кастомных полей: ${fields.length}`);
            
            // Логируем несколько полей для отладки
            if (fields.length > 0) {
                console.log('\n📝 ПЕРВЫЕ 10 ПОЛЕЙ:');
                console.log('='.repeat(80));
                fields.slice(0, 10).forEach((field, index) => {
                    console.log(`${index + 1}. "${field.name}" (ID: ${field.id}, Тип: ${field.type})`);
                });
                console.log('='.repeat(80));
            }
            
            return fields;
        } catch (error) {
            console.error('❌ Ошибка получения кастомных полей:', error.message);
            return [];
        }
    }

    async makeRequest(method, endpoint, data = null) {
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
            return response.data;
            
        } catch (error) {
            console.error(`❌ ОШИБКА ЗАПРОСА К AMOCRM: ${error.message}`);
            
            if (error.response) {
                console.error(`   Статус: ${error.response.status}`);
                if (error.response.status === 401) {
                    console.log('❌ Токен невалиден или истек');
                    this.isInitialized = false;
                }
            }
            
            throw error;
        }
    }

    async loadTokensFromDatabase() {
        try {
            console.log('\n📂 ЗАГРУЗКА ТОКЕНОВ ИЗ БАЗЫ ДАННЫХ');
            
            const tokens = await db.get('SELECT * FROM amocrm_tokens WHERE id = 1');
            
            if (tokens) {
                console.log('✅ Токены найдены в базе данных');
                
                // Проверяем не истек ли токен (запас 5 минут)
                const now = Date.now();
                const expiresAt = tokens.expires_at;
                
                if (now < expiresAt - 300000) {
                    console.log('✅ Токен из БД валиден');
                    this.accessToken = tokens.access_token;
                    this.tokenExpiresAt = expiresAt;
                    
                    // Проверяем валидность токена
                    const isValid = await this.checkTokenValidity(tokens.access_token);
                    if (isValid) {
                        this.isInitialized = true;
                        return true;
                    }
                } else {
                    console.log('🔄 Токен из БД истек или скоро истекает');
                }
            } else {
                console.log('📭 Токены в БД не найдены');
            }
            
            return false;
        } catch (error) {
            console.error('❌ Ошибка загрузки токенов из БД:', error.message);
            return false;
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
        console.log(`\n🔍 ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        // Очищаем номер телефона
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        
        if (!cleanPhone || cleanPhone.length < 10) {
            console.log('❌ Номер телефона слишком короткий');
            return { _embedded: { contacts: [] } };
        }
        
        try {
            // Форматируем номер для поиска
            let searchPhone;
            if (cleanPhone.length === 11 && cleanPhone.startsWith('7')) {
                searchPhone = `+${cleanPhone}`;
            } else if (cleanPhone.length === 10) {
                searchPhone = `+7${cleanPhone}`;
            } else {
                searchPhone = `+${cleanPhone}`;
            }
            
            console.log(`🔍 Ищем контакт с телефоном: ${searchPhone}`);
            
            // Ищем через API с фильтром по телефону
            const response = await this.makeRequest('GET', `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&limit=100&with=custom_fields_values`);
            
            if (!response._embedded?.contacts) {
                console.log('📭 Контакты не найдены');
                return { _embedded: { contacts: [] } };
            }
            
            console.log(`📊 Найдено контактов: ${response._embedded.contacts.length}`);
            
            return response;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    async getContactDetails(contactId) {
        console.log(`\n🔍 ПОЛУЧЕНИЕ ДЕТАЛЕЙ КОНТАКТА ${contactId}`);
        try {
            const response = await this.makeRequest('GET', `/api/v4/contacts/${contactId}?with=custom_fields_values,leads`);
            console.log(`✅ Детали контакта получены`);
            
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения деталей контакта: ${error.message}`);
            throw error;
        }
    }

    // Улучшенный метод поиска поля
    findFieldByName(fieldNames, customFields) {
        if (!customFields || !Array.isArray(customFields)) {
            return null;
        }
        
        for (const fieldName of fieldNames) {
            // Сначала ищем точное совпадение
            let field = customFields.find(f => {
                const name = this.fieldIdToName[f.field_id];
                return name && name.toLowerCase() === fieldName.toLowerCase();
            });
            
            // Если не нашли, ищем частичное совпадение
            if (!field) {
                field = customFields.find(f => {
                    const name = this.fieldIdToName[f.field_id];
                    return name && name.toLowerCase().includes(fieldName.toLowerCase());
                });
            }
            
            if (field) {
                return field;
            }
        }
        
        return null;
    }

    // Извлечение значения поля
    extractFieldValue(fieldValues, fieldType = 'text') {
        if (!fieldValues || !Array.isArray(fieldValues) || fieldValues.length === 0) {
            return null;
        }
        
        const firstValue = fieldValues[0];
        
        if (!firstValue.value) {
            return null;
        }
        
        switch (fieldType) {
            case 'boolean':
            case 'checkbox':
                const val = firstValue.value.toString().toLowerCase();
                return val === 'да' || val === 'yes' || val === 'true' || val === '1';
            case 'numeric':
                const num = parseFloat(firstValue.value.toString().replace(/\s/g, '').replace(',', '.'));
                return isNaN(num) ? null : num;
            case 'date':
                try {
                    const dateStr = firstValue.value.toString();
                    if (/^\d+$/.test(dateStr)) {
                        return new Date(parseInt(dateStr) * 1000).toISOString().split('T')[0];
                    }
                    return dateStr;
                } catch (e) {
                    return firstValue.value;
                }
            default:
                return firstValue.value;
        }
    }

    // Получаем значение поля по его возможным названиям
    getFieldValueByNames(fieldNames, customFields, fieldType = 'text') {
        const field = this.findFieldByName(fieldNames, customFields);
        if (field && field.values && field.values.length > 0) {
            return this.extractFieldValue(field.values, fieldType);
        }
        return null;
    }

    // Анализируем количество занятий
    analyzeClassesInfo(customFields) {
        const result = {
            total_classes: 0,
            remaining_classes: 0,
            used_classes: 0,
            free_classes_available: 0,
            month_classes_count: 0
        };
        
        // Общее количество занятий
        result.total_classes = this.getFieldValueByNames(
            ['Количество занятий', 'Всего занятий', 'Кол-во занятий'], 
            customFields, 
            'numeric'
        ) || 0;
        
        // Осталось занятий
        result.remaining_classes = this.getFieldValueByNames(
            ['Осталось занятий', 'Доступно занятий', 'Остаток занятий'], 
            customFields, 
            'numeric'
        ) || 0;
        
        // Доступно бесплатных занятий
        result.free_classes_available = this.getFieldValueByNames(
            ['Доступно бесплатных занятий'], 
            customFields, 
            'numeric'
        ) || 0;
        
        // Счетчик занятий за месяц
        result.month_classes_count = this.getFieldValueByNames(
            ['Счетчик занятий за месяц', 'Занятий в месяце'], 
            customFields, 
            'numeric'
        ) || 0;
        
        // Вычисляем использованные занятия
        if (result.total_classes > 0 && result.remaining_classes > 0) {
            result.used_classes = result.total_classes - result.remaining_classes;
        } else if (result.month_classes_count > 0) {
            result.used_classes = result.month_classes_count;
        }
        
        // Если осталось занятий не указано, но есть бесплатные
        if (result.remaining_classes === 0 && result.free_classes_available > 0) {
            result.remaining_classes = result.free_classes_available;
        }
        
        return result;
    }

    // Полный парсинг контакта в профиль ученика
    async parseContactToStudentProfile(contact) {
        console.log(`\n🎯 ПАРСИНГ КОНТАКТА В ПРОФИЛЬ УЧЕНИКА`);
        console.log(`👤 Контакт: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
        
        const customFields = contact.custom_fields_values || [];
        
        // Анализируем информацию о занятиях
        const classesInfo = this.analyzeClassesInfo(customFields);
        
        // Создаем профиль
        const profile = {
            // Основная информация
            amocrm_contact_id: contact.id,
            student_name: contact.name || 'Не указано',
            parent_name: this.getFieldValueByNames(['Имя родителя', 'ФИО родителя'], customFields, 'text') || '',
            
            // Контактные данные
            phone_number: this.getFieldValueByNames(['Телефон', 'Мобильный телефон'], customFields, 'phone') || '',
            email: this.getFieldValueByNames(['Email', 'Электронная почта'], customFields, 'email') || '',
            birth_date: this.getFieldValueByNames(['День рождения', 'Дата рождения'], customFields, 'date') || '',
            
            // Филиал и направления
            branch: this.getFieldValueByNames(['Филиал', 'Филиал:'], customFields, 'text') || 'Не указан',
            course_type: this.getFieldValueByNames(['Базовый курс/продвинутый', 'Тип курса'], customFields, 'text') || '',
            age_group: this.getFieldValueByNames(['Возраст группы', 'Возрастная категория'], customFields, 'text') || '',
            
            // Направления (могут быть несколько)
            drawing: this.getFieldValueByNames(['Рисование'], customFields, 'text') || '',
            anatomy: this.getFieldValueByNames(['Анатомия'], customFields, 'text') || '',
            art_history: this.getFieldValueByNames(['История искусств'], customFields, 'text') || '',
            sketches: this.getFieldValueByNames(['Наброски'], customFields, 'text') || '',
            sculpture: this.getFieldValueByNames(['Скульптура'], customFields, 'text') || '',
            
            // Расписание
            day_of_week: this.getFieldValueByNames(['День недели', 'День недели (2025-26)', 'День недели посещения'], customFields, 'text') || '',
            time_slot: this.getFieldValueByNames(['Время занятия', 'Время'], customFields, 'text') || '',
            teacher_name: this.getFieldValueByNames(['Преподаватель', 'Педагог и день недели- (код)'], customFields, 'text') || '',
            
            // Информация об абонементе
            subscription_active: this.getFieldValueByNames(['Есть активный абонемент', 'Активный абонемент'], customFields, 'boolean') || false,
            subscription_type: this.getFieldValueByNames(['Тип абонемента', 'Абонемент'], customFields, 'text') || 'Без абонемента',
            total_classes: classesInfo.total_classes,
            remaining_classes: classesInfo.remaining_classes,
            used_classes: classesInfo.used_classes,
            free_classes_available: classesInfo.free_classes_available,
            month_classes_count: classesInfo.month_classes_count,
            expiration_date: this.getFieldValueByNames(['Срок действия', 'Действует до', 'Срок заморозки (до какой да)'], customFields, 'date') || '',
            
            // Заморозка
            freeze_status: this.getFieldValueByNames(['Заморозка', 'Использована заморозка або'], customFields, 'text') || '',
            freeze_price: this.getFieldValueByNames(['Цена заморозки'], customFields, 'text') || '',
            
            // Статистика
            last_visit_date: this.getFieldValueByNames(['Дата последнего визита', 'Последнее посещение'], customFields, 'date') || '',
            first_purchase_date: this.getFieldValueByNames(['Дата первой покупки', 'Первая покупка'], customFields, 'date') || '',
            purchase_count: this.getFieldValueByNames(['Количество покупок', 'Число покупок'], customFields, 'numeric') || 0,
            total_purchase_amount: this.getFieldValueByNames(['Сумма покупок, руб.', 'Общая сумма покупок'], customFields, 'numeric') || 0,
            average_check: this.getFieldValueByNames(['Ср. чек, руб.', 'Средний чек'], customFields, 'numeric') || 0,
            
            // Пробные занятия
            trial_attended: this.getFieldValueByNames(['Был на пробном занятии', 'Посетил пробное'], customFields, 'boolean') || false,
            trial_dates: this.getFieldValueByNames(['Даты пробных', 'Дата пробного занятия'], customFields, 'date') || '',
            
            // Поступление
            incoming_student: this.getFieldValueByNames(['Поступающий', 'Поступление'], customFields, 'text') || '',
            admission_year: this.getFieldValueByNames(['Год поступления'], customFields, 'text') || '',
            
            // Дополнительная информация
            comment: this.getFieldValueByNames(['Комментарий', 'Заметки'], customFields, 'text') || '',
            allergy_info: this.getFieldValueByNames(['Аллергия и особенности', 'Особенности здоровья'], customFields, 'text') || '',
            children_in_family: this.getFieldValueByNames(['Детей в семье', 'Количество детей в семье'], customFields, 'numeric') || 0,
            address: this.getFieldValueByNames(['Адрес', 'Адрес проживания'], customFields, 'text') || '',
            
            // Маркетинг
            marketing_channel: this.getFieldValueByNames(['Канал отправки', 'Канал рассылки', 'Рекламный канал'], customFields, 'text') || '',
            communication_channel: this.getFieldValueByNames(['Канал связи', 'Основной канал связи'], customFields, 'text') || '',
            telegram_subscribed: this.getFieldValueByNames(['Подписан на Телеграм Бот', 'Telegram подписка'], customFields, 'boolean') || false,
            newsletter_ban: this.getFieldValueByNames(['Запрет рассылок', 'Не отправлять рассылки'], customFields, 'boolean') || false,
            consent_photo: this.getFieldValueByNames(['Согласие на фото', 'Разрешение на фото'], customFields, 'boolean') || false,
            
            // UTM метки
            utm_source: this.getFieldValueByNames(['utm_source', 'Источник UTM'], customFields, 'text') || '',
            utm_medium: this.getFieldValueByNames(['utm_medium', 'Тип трафика UTM'], customFields, 'text') || '',
            utm_campaign: this.getFieldValueByNames(['utm_campaign', 'Кампания UTM'], customFields, 'text') || '',
            utm_content: this.getFieldValueByNames(['utm_content', 'Контент UTM'], customFields, 'text') || '',
            
            // Технические поля
            max_error: this.getFieldValueByNames(['MAX Ошибка', 'Ошибка MAX'], customFields, 'text') || '',
            telegram_id: this.getFieldValueByNames(['TelegramId_WZ', 'ID Telegram'], customFields, 'text') || '',
            telegram_username: this.getFieldValueByNames(['TelegramUsername_WZ', 'Telegram username'], customFields, 'text') || '',
            whatsapp_error: this.getFieldValueByNames(['WA Ошибка', 'Ошибка WhatsApp'], customFields, 'text') || '',
            web_contact: this.getFieldValueByNames(['Web', 'Веб-сайт'], customFields, 'text') || '',
            
            // Технические данные для БД
            custom_fields: JSON.stringify(customFields),
            raw_contact_data: JSON.stringify(contact, null, 2),
            is_demo: 0,
            source: 'amocrm',
            is_active: 1,
            created_at: contact.created_at ? new Date(contact.created_at * 1000).toISOString() : null,
            updated_at: contact.updated_at ? new Date(contact.updated_at * 1000).toISOString() : null
        };
        
        // Логируем извлеченные данные
        console.log('\n📊 ИЗВЛЕЧЕННЫЕ ДАННЫЕ:');
        console.log('='.repeat(80));
        console.log(`👤 Ученик: ${profile.student_name}`);
        console.log(`📞 Телефон: ${profile.phone_number}`);
        console.log(`🏢 Филиал: ${profile.branch}`);
        console.log(`📅 День недели: ${profile.day_of_week}`);
        console.log(`⏰ Время: ${profile.time_slot}`);
        console.log(`👩‍🏫 Преподаватель: ${profile.teacher_name}`);
        console.log(`🎫 Абонемент: ${profile.subscription_type}`);
        console.log(`✅ Активный: ${profile.subscription_active ? 'Да' : 'Нет'}`);
        console.log(`📊 Занятий: ${profile.remaining_classes}/${profile.total_classes}`);
        console.log(`🆓 Бесплатных: ${profile.free_classes_available}`);
        console.log(`📅 Срок действия: ${profile.expiration_date}`);
        console.log('='.repeat(80));
        
        return profile;
    }

    async getStudentsByPhone(phoneNumber) {
        console.log(`\n🎯 ПОИСК УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
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
            const testSearch = await this.searchContactsByPhone('79680175895');
            
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
        
        // Определяем путь к БД в зависимости от среды выполнения
        let dbPath;
        
        // Проверяем, запущены ли мы в Replit или другой облачной среде
        if (process.env.REPLIT_DB_URL || process.env.REPL_ID) {
            console.log('🌐 Определена среда Replit');
            // Используем текущую директорию для хранения БД
            dbPath = path.join(process.cwd(), 'art_school.db');
            console.log(`💾 БД будет создана в: ${dbPath}`);
        } else {
            // Для локальной разработки используем директорию data
            const dbDir = path.join(__dirname, 'data');
            try {
                await fs.mkdir(dbDir, { recursive: true });
                console.log('📁 Директория данных создана:', dbDir);
            } catch (mkdirError) {
                if (mkdirError.code !== 'EEXIST') {
                    console.log('📁 Директория данных уже существует');
                }
            }
            dbPath = path.join(dbDir, 'art_school.db');
            console.log(`💾 Путь к базе данных: ${dbPath}`);
        }
        
        // Открываем или создаем базу данных
        console.log(`🔧 Открытие базы данных: ${dbPath}`);
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        
        // Настраиваем базу данных
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        await db.run('PRAGMA busy_timeout = 5000');
        
        console.log('⚙️  Настройки SQLite применены');
        
        // Создаем таблицы
        await createTables();
        
        console.log('\n✅ База данных успешно инициализирована!');
        
        return db;
    } catch (error) {
        console.error('❌ Критическая ошибка инициализации базы данных:', error.message);
        console.error('❌ Подробности ошибки:', error);
        
        // Пробуем альтернативный путь для БД
        try {
            console.log('\n🔄 Попытка альтернативного пути для БД...');
            
            // Используем временную директорию
            const tempDbPath = path.join('/tmp', 'art_school.db');
            console.log(`🔄 Создаем БД в временной директории: ${tempDbPath}`);
            
            db = await open({
                filename: tempDbPath,
                driver: sqlite3.Database
            });
            
            await db.run('PRAGMA foreign_keys = ON');
            await createTables();
            
            console.log('✅ База данных создана в временной директории');
            return db;
            
        } catch (tempError) {
            console.error('❌ Не удалось создать БД даже во временной директории:', tempError.message);
            
            // Последняя попытка: создаем БД в памяти
            console.log('\n🔄 Создаем БД в памяти...');
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            await db.run('PRAGMA foreign_keys = ON');
            await createTables();
            
            console.log('⚠️  ВНИМАНИЕ: БД создана в памяти. Данные будут потеряны при перезапуске!');
            return db;
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
                birth_date TEXT,
                branch TEXT NOT NULL CHECK(branch IN ('Свиблово', 'Чертаново', 'Не указан')),
                
                -- Курсы и направления
                course_type TEXT,
                age_group TEXT,
                drawing TEXT,
                anatomy TEXT,
                art_history TEXT,
                sketches TEXT,
                sculpture TEXT,
                
                -- Расписание
                day_of_week TEXT,
                time_slot TEXT,
                teacher_name TEXT,
                
                -- Информация об абонементе
                subscription_type TEXT,
                subscription_active INTEGER DEFAULT 0,
                total_classes INTEGER DEFAULT 0,
                used_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                expiration_date DATE,
                free_classes_available INTEGER DEFAULT 0,
                month_classes_count INTEGER DEFAULT 0,
                
                -- Заморозка
                freeze_status TEXT,
                freeze_price TEXT,
                
                -- Статистика и аналитика
                last_visit_date DATE,
                first_purchase_date DATE,
                purchase_count INTEGER DEFAULT 0,
                total_purchase_amount INTEGER DEFAULT 0,
                average_check INTEGER DEFAULT 0,
                
                -- Пробные занятия
                trial_attended INTEGER DEFAULT 0,
                trial_dates TEXT,
                
                -- Поступление
                incoming_student TEXT,
                admission_year TEXT,
                
                -- Дополнительная информация
                comment TEXT,
                allergy_info TEXT,
                children_in_family INTEGER DEFAULT 0,
                address TEXT,
                
                -- Маркетинг
                marketing_channel TEXT,
                communication_channel TEXT,
                telegram_subscribed INTEGER DEFAULT 0,
                newsletter_ban INTEGER DEFAULT 0,
                consent_photo INTEGER DEFAULT 0,
                
                -- UTM метки
                utm_source TEXT,
                utm_medium TEXT,
                utm_campaign TEXT,
                utm_content TEXT,
                
                -- Технические поля
                max_error TEXT,
                telegram_id TEXT,
                telegram_username TEXT,
                whatsapp_error TEXT,
                web_contact TEXT,
                
                -- Технические данные
                custom_fields TEXT,
                raw_contact_data TEXT,
                is_demo INTEGER DEFAULT 0,
                source TEXT DEFAULT 'amocrm',
                is_active INTEGER DEFAULT 1,
                last_selected INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица student_profiles создана');

        // Остальные таблицы
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
                status TEXT DEFAULT 'normal',
                status_note TEXT,
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
                status TEXT DEFAULT 'attended',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                FOREIGN KEY (schedule_id) REFERENCES schedule(id) ON DELETE SET NULL
            )
        `);
        console.log('✅ Таблица attendance создана');

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

        console.log('\n🎉 Все таблицы созданы успешно!');
        
        // Создаем индексы
        await createIndexes();
        
        // Создаем тестовые данные только при необходимости
        await createTestData();
        
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
        
        console.log('✅ Индексы созданы');
    } catch (error) {
        console.error('⚠️  Ошибка создания индексов:', error.message);
    }
};

// ==================== ТЕСТОВЫЕ ДАННЫЕ ====================
const createTestData = async () => {
    try {
        console.log('\n📝 СОЗДАНИЕ ТЕСТОВЫХ ДАННЫХ');
        
        // Проверяем наличие данных
        const hasStudents = await db.get("SELECT 1 FROM student_profiles LIMIT 1");
        
        // Создаем контакты филиалов только если их нет
        if (!(await db.get("SELECT 1 FROM branch_contacts LIMIT 1"))) {
            console.log('🏢 Создание контактов филиалов...');
            await db.run(
                `INSERT OR IGNORE INTO branch_contacts (branch, telegram_username, phone_number, email, address, working_hours) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ['Свиблово', '@art_school_sviblovo', '+7 (495) 123-45-67', 'sviblovo@artschool.ru', 
                 'ул. Свибловская, д. 1', 'Пн-Сб 10:00-20:00, Вс 10:00-18:00']
            );
            
            await db.run(
                `INSERT OR IGNORE INTO branch_contacts (branch, telegram_username, phone_number, email, address, working_hours) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ['Чертаново', '@art_school_chertanovo', '+7 (495) 765-43-21', 'chertanovo@artschool.ru', 
                 'ул. Чертановская, д. 2', 'Пн-Сб 10:00-20:00, Вс 10:00-18:00']
            );
            console.log('✅ Контакты филиалов созданы');
        }
        
        // Создаем тестовых учеников только если нет реальных данных из amoCRM
        if (!hasStudents && !amoCrmService.isInitialized) {
            console.log('👤 Создание тестовых учеников (для демо)...');
            
            const students = [
                {
                    student_name: 'Иванов Иван',
                    phone_number: '+79680175895',
                    email: 'ivanov@example.com',
                    branch: 'Свиблово',
                    subscription_type: 'Активный абонемент',
                    subscription_active: 1,
                    total_classes: 8,
                    remaining_classes: 6,
                    used_classes: 2,
                    free_classes_available: 0,
                    day_of_week: 'понедельник',
                    time_slot: '18:00',
                    teacher_name: 'Саша М',
                    age_group: '11-13 лет',
                    is_demo: 1
                }
            ];
            
            for (const student of students) {
                await db.run(
                    `INSERT OR IGNORE INTO student_profiles 
                     (student_name, phone_number, email, branch, subscription_type, subscription_active,
                      total_classes, remaining_classes, used_classes, free_classes_available,
                      day_of_week, time_slot, teacher_name, age_group, is_demo, source) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        student.student_name,
                        student.phone_number,
                        student.email,
                        student.branch,
                        student.subscription_type,
                        student.subscription_active,
                        student.total_classes,
                        student.remaining_classes,
                        student.used_classes,
                        student.free_classes_available,
                        student.day_of_week,
                        student.time_slot,
                        student.teacher_name,
                        student.age_group,
                        student.is_demo,
                        'demo'
                    ]
                );
            }
            console.log('⚠️  Созданы ТЕСТОВЫЕ данные (используются только при отключенном amoCRM)');
        }
        
        console.log('\n✅ Тестовые данные проверены/созданы');
        
    } catch (error) {
        console.error('⚠️  Ошибка создания тестовых данных:', error.message);
    }
};

// ==================== ОСНОВНОЙ API ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '2.1.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        data_source: amoCrmService.isInitialized ? 'Реальные данные из amoCRM' : 'Локальные данные',
        features: [
            'Полный парсинг 60+ полей amoCRM',
            'Автоматическое обновление данных',
            'Информация об абонементах',
            'Расписание занятий',
            'Контакты преподавателей'
        ]
    });
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
        
        console.log(`\n🔐 АВТОРИЗАЦИЯ ПО ТЕЛЕФОНУ: ${phone}`);
        
        // Очищаем номер телефона
        const cleanPhone = phone.replace(/\D/g, '');
        
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
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        // Создаем временного пользователя
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            first_name: profiles.length > 0 ? profiles[0].student_name?.split(' ')[0] || 'Ученик' : 'Гость',
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
        
        // Сохраняем профили в базу данных
        if (profiles.length > 0) {
            console.log(`💾 Сохранение профилей в БД...`);
            for (const profile of profiles) {
                try {
                    // Проверяем существующий профиль
                    const existingProfile = await db.get(
                        `SELECT id FROM student_profiles 
                         WHERE phone_number = ? AND student_name = ?`,
                        [profile.phone_number, profile.student_name]
                    );
                    
                    if (!existingProfile) {
                        // Вставляем новый профиль
                        await db.run(
                            `INSERT INTO student_profiles 
                             (amocrm_contact_id, student_name, parent_name, phone_number, email, birth_date, branch,
                              course_type, age_group, drawing, anatomy, art_history, sketches, sculpture,
                              day_of_week, time_slot, teacher_name,
                              subscription_type, subscription_active, total_classes, used_classes, remaining_classes, 
                              expiration_date, free_classes_available, month_classes_count,
                              freeze_status, freeze_price,
                              last_visit_date, first_purchase_date, purchase_count, total_purchase_amount, average_check,
                              trial_attended, trial_dates,
                              incoming_student, admission_year,
                              comment, allergy_info, children_in_family, address,
                              marketing_channel, communication_channel, telegram_subscribed, newsletter_ban, consent_photo,
                              utm_source, utm_medium, utm_campaign, utm_content,
                              max_error, telegram_id, telegram_username, whatsapp_error, web_contact,
                              custom_fields, raw_contact_data, is_demo, source, is_active) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                profile.amocrm_contact_id || null,
                                profile.student_name,
                                profile.parent_name || '',
                                profile.phone_number,
                                profile.email || '',
                                profile.birth_date || '',
                                profile.branch || 'Не указан',
                                profile.course_type || '',
                                profile.age_group || '',
                                profile.drawing || '',
                                profile.anatomy || '',
                                profile.art_history || '',
                                profile.sketches || '',
                                profile.sculpture || '',
                                profile.day_of_week || '',
                                profile.time_slot || '',
                                profile.teacher_name || '',
                                profile.subscription_type || 'Без абонемента',
                                profile.subscription_active ? 1 : 0,
                                profile.total_classes || 0,
                                profile.used_classes || 0,
                                profile.remaining_classes || 0,
                                profile.expiration_date || null,
                                profile.free_classes_available || 0,
                                profile.month_classes_count || 0,
                                profile.freeze_status || '',
                                profile.freeze_price || '',
                                profile.last_visit_date || null,
                                profile.first_purchase_date || null,
                                profile.purchase_count || 0,
                                profile.total_purchase_amount || 0,
                                profile.average_check || 0,
                                profile.trial_attended ? 1 : 0,
                                profile.trial_dates || '',
                                profile.incoming_student || '',
                                profile.admission_year || '',
                                profile.comment || '',
                                profile.allergy_info || '',
                                profile.children_in_family || 0,
                                profile.address || '',
                                profile.marketing_channel || '',
                                profile.communication_channel || '',
                                profile.telegram_subscribed ? 1 : 0,
                                profile.newsletter_ban ? 1 : 0,
                                profile.consent_photo ? 1 : 0,
                                profile.utm_source || '',
                                profile.utm_medium || '',
                                profile.utm_campaign || '',
                                profile.utm_content || '',
                                profile.max_error || '',
                                profile.telegram_id || '',
                                profile.telegram_username || '',
                                profile.whatsapp_error || '',
                                profile.web_contact || '',
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
                             student_name = ?, phone_number = ?, email = ?, birth_date = ?, branch = ?,
                             course_type = ?, age_group = ?, drawing = ?, anatomy = ?, art_history = ?, sketches = ?, sculpture = ?,
                             day_of_week = ?, time_slot = ?, teacher_name = ?,
                             subscription_type = ?, subscription_active = ?, total_classes = ?, used_classes = ?, remaining_classes = ?,
                             expiration_date = ?, free_classes_available = ?, month_classes_count = ?,
                             freeze_status = ?, freeze_price = ?,
                             last_visit_date = ?, first_purchase_date = ?, purchase_count = ?, total_purchase_amount = ?, average_check = ?,
                             trial_attended = ?, trial_dates = ?,
                             incoming_student = ?, admission_year = ?,
                             comment = ?, allergy_info = ?, children_in_family = ?, address = ?,
                             marketing_channel = ?, communication_channel = ?, telegram_subscribed = ?, newsletter_ban = ?, consent_photo = ?,
                             utm_source = ?, utm_medium = ?, utm_campaign = ?, utm_content = ?,
                             max_error = ?, telegram_id = ?, telegram_username = ?, whatsapp_error = ?, web_contact = ?,
                             custom_fields = ?, raw_contact_data = ?, updated_at = CURRENT_TIMESTAMP
                             WHERE id = ?`,
                            [
                                profile.student_name,
                                profile.phone_number,
                                profile.email || '',
                                profile.birth_date || '',
                                profile.branch || 'Не указан',
                                profile.course_type || '',
                                profile.age_group || '',
                                profile.drawing || '',
                                profile.anatomy || '',
                                profile.art_history || '',
                                profile.sketches || '',
                                profile.sculpture || '',
                                profile.day_of_week || '',
                                profile.time_slot || '',
                                profile.teacher_name || '',
                                profile.subscription_type || 'Без абонемента',
                                profile.subscription_active ? 1 : 0,
                                profile.total_classes || 0,
                                profile.used_classes || 0,
                                profile.remaining_classes || 0,
                                profile.expiration_date || null,
                                profile.free_classes_available || 0,
                                profile.month_classes_count || 0,
                                profile.freeze_status || '',
                                profile.freeze_price || '',
                                profile.last_visit_date || null,
                                profile.first_purchase_date || null,
                                profile.purchase_count || 0,
                                profile.total_purchase_amount || 0,
                                profile.average_check || 0,
                                profile.trial_attended ? 1 : 0,
                                profile.trial_dates || '',
                                profile.incoming_student || '',
                                profile.admission_year || '',
                                profile.comment || '',
                                profile.allergy_info || '',
                                profile.children_in_family || 0,
                                profile.address || '',
                                profile.marketing_channel || '',
                                profile.communication_channel || '',
                                profile.telegram_subscribed ? 1 : 0,
                                profile.newsletter_ban ? 1 : 0,
                                profile.consent_photo ? 1 : 0,
                                profile.utm_source || '',
                                profile.utm_medium || '',
                                profile.utm_campaign || '',
                                profile.utm_content || '',
                                profile.max_error || '',
                                profile.telegram_id || '',
                                profile.telegram_username || '',
                                profile.whatsapp_error || '',
                                profile.web_contact || '',
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
        
        // Формируем ответ
        const responseData = {
            success: true,
            message: profiles.length > 0 ? 'Авторизация успешна' : 'Профили не найдены',
            data: {
                user: tempUser,
                profiles: profiles.map(p => ({
                    id: p.id,
                    student_name: p.student_name,
                    phone_number: p.phone_number,
                    email: p.email,
                    branch: p.branch,
                    day_of_week: p.day_of_week,
                    time_slot: p.time_slot,
                    teacher_name: p.teacher_name,
                    subscription_type: p.subscription_type,
                    subscription_active: p.subscription_active,
                    total_classes: p.total_classes,
                    remaining_classes: p.remaining_classes,
                    free_classes_available: p.free_classes_available,
                    expiration_date: p.expiration_date,
                    last_visit_date: p.last_visit_date,
                    is_demo: p.is_demo,
                    amocrm_contact_id: p.amocrm_contact_id
                })),
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
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

// ==================== ДИАГНОСТИЧЕСКИЕ API ====================

// Диагностика amoCRM
app.get('/api/debug/amocrm-detailed', async (req, res) => {
    try {
        const { phone } = req.query;
        
        console.log('\n🔍 ПОДРОБНАЯ ДИАГНОСТИКА AMOCRM');
        
        const diagnostics = {
            timestamp: new Date().toISOString(),
            amocrm_status: {
                initialized: amoCrmService.isInitialized,
                domain: AMOCRM_DOMAIN,
                subdomain: AMOCRM_SUBDOMAIN,
                has_access_token: !!amoCrmService.accessToken,
                account_info: amoCrmService.accountInfo ? {
                    name: amoCrmService.accountInfo.name,
                    id: amoCrmService.accountInfo.id
                } : null
            },
            field_mapping: Object.keys(amoCrmService.fieldMapping).length,
            cached_fields: amoCrmService.cachedFields?.length || 0
        };
        
        if (phone && amoCrmService.isInitialized) {
            console.log(`📞 Телефон для диагностики: ${phone}`);
            diagnostics.search_phone = phone;
            
            try {
                const profiles = await amoCrmService.getStudentsByPhone(phone);
                diagnostics.search_results = {
                    profiles_found: profiles.length,
                    sample_profile: profiles.length > 0 ? {
                        student_name: profiles[0].student_name,
                        phone: profiles[0].phone_number,
                        branch: profiles[0].branch,
                        subscription: profiles[0].subscription_type,
                        remaining_classes: profiles[0].remaining_classes
                    } : null
                };
            } catch (searchError) {
                diagnostics.search_error = searchError.message;
            }
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
        
        res.json({
            success: true,
            data: {
                contact_id: contact_id,
                contact_name: contactDetails.name,
                parsed_profile: parsedProfile
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

// Получение абонемента
app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id, phone } = req.body;
        
        console.log(`\n📋 ЗАПРОС АБОНЕМЕНТА`);
        
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
        
        res.json({
            success: true,
            data: {
                subscription: {
                    student_name: profile.student_name,
                    phone_number: profile.phone_number,
                    email: profile.email,
                    branch: profile.branch,
                    day_of_week: profile.day_of_week,
                    time_slot: profile.time_slot,
                    teacher_name: profile.teacher_name,
                    subscription_type: profile.subscription_type,
                    subscription_active: profile.subscription_active === 1,
                    total_classes: profile.total_classes,
                    remaining_classes: profile.remaining_classes,
                    free_classes_available: profile.free_classes_available,
                    expiration_date: profile.expiration_date,
                    last_visit_date: profile.last_visit_date
                },
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
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v2.1');
        console.log('='.repeat(80));
        console.log('✨ ПОЛНЫЙ ПАРСИНГ 60+ ПОЛЕЙ AMOCRM');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Инициализируем amoCRM
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            console.log(`📊 Аккаунт: ${amoCrmService.accountInfo?.name || 'Не получено'}`);
            console.log(`🗃️  Кешировано полей: ${amoCrmService.cachedFields?.length || 0}`);
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
            console.log(`📊 База данных: SQLite (в памяти)`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log(`📝 Полей настроено: ${Object.keys(amoCrmService.fieldMapping).length}`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log(`🔍 Диагностика: http://localhost:${PORT}/api/debug/amocrm-detailed`);
            console.log('='.repeat(50));
            
            if (!amoCrmService.isInitialized) {
                console.log('\n⚠️  ВНИМАНИЕ: amoCRM не подключен!');
                console.log('='.repeat(50));
                console.log('Для подключения к amoCRM:');
                console.log('1. Установите AMOCRM_DOMAIN в .env файле');
                console.log('2. Установите AMOCRM_ACCESS_TOKEN в .env файле');
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
        console.error('❌ Подробная ошибка:', error);
        process.exit(1);
    }
};

// Запуск сервера
startServer();
