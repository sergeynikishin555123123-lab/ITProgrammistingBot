// server.js - ИСПРАВЛЕННАЯ ВЕРСИЯ
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

// ==================== ИСПРАВЛЕННЫЙ КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 СОЗДАНИЕ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.fieldMappings = new Map();
        this.customFieldCache = new Map();
        this.accountInfo = null;
        
        // ВАШИ КОНСТАНТЫ ID ПОЛЕЙ
        this.FIELD_IDS = {
            // Сделки (абонементы) - ВСЕ НАЙДЕННЫЕ ПОЛЯ
            LEAD: {
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
                
                // Технические поля для абонемента
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
            },
            
            // Контакты (ученики)
            CONTACT: {
                // Дети
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
                PARENT_NAME: 'name',         // Имя контакта
                EMAIL: 216617                // "Email" (стандартное поле)
            }
        };
    }

    // ==================== ОСНОВНЫЕ МЕТОДЫ ====================
    
    async initialize() {
        try {
            if (!this.accessToken) {
                console.log('❌ Отсутствует токен доступа amoCRM');
                return false;
            }
            
            // Проверяем подключение
            const response = await this.makeRequest('GET', '/api/v4/account');
            this.accountInfo = response;
            this.isInitialized = true;
            
            console.log('✅ amoCRM успешно инициализирован');
            console.log(`🏢 Аккаунт: ${response.name}`);
            console.log(`🔗 Домен: ${this.baseUrl}`);
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            this.isInitialized = false;
            return false;
        }
    }

    async makeRequest(method, endpoint, data = null) {
        const url = `${this.baseUrl}${endpoint}`;
        const config = {
            method,
            url,
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            }
        };
        
        if (data) {
            config.data = data;
        }
        
        try {
            console.log(`📤 ${method} ${url}${data ? ' (with data)' : ''}`);
            const response = await axios(config);
            return response.data;
        } catch (error) {
            console.error(`❌ Ошибка запроса к amoCRM: ${method} ${endpoint}`);
            if (error.response) {
                console.error(`📊 Статус: ${error.response.status}`);
                console.error(`📊 Данные:`, error.response.data);
            }
            throw error;
        }
    }

    // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ====================
    
    getFieldName(field) {
        return field.field_name || 'Неизвестное поле';
    }

    getFieldValue(field) {
        if (!field.values || field.values.length === 0) {
            return '';
        }
        
        const value = field.values[0];
        if (value.value !== undefined) {
            return String(value.value);
        } else if (value.enum_value !== undefined) {
            return String(value.enum_value);
        } else if (value.enum_id !== undefined) {
            return String(value.enum_id);
        }
        
        return '';
    }

    parseDate(value) {
        if (!value) return null;
        
        try {
            const dateStr = String(value).trim();
            console.log(`📅 Парсим дату: "${dateStr}"`);
            
            // Если это timestamp в секундах
            if (dateStr.match(/^\d{9,10}$/)) {
                const timestamp = parseInt(dateStr);
                if (timestamp > 1000000000 && timestamp < 2000000000) {
                    const date = new Date(timestamp * 1000);
                    const result = date.toISOString().split('T')[0];
                    console.log(`   → Timestamp ${timestamp} преобразован в: ${result}`);
                    return result;
                }
            }
            
            // Формат DD.MM.YYYY
            if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
                const parts = dateStr.split('.');
                const day = parts[0].padStart(2, '0');
                const month = parts[1].padStart(2, '0');
                const year = parts[2];
                const result = `${year}-${month}-${day}`;
                console.log(`   → Преобразовано из DD.MM.YYYY в: ${result}`);
                return result;
            }
            
            // Формат YYYY-MM-DD
            if (dateStr.match(/^\d{4}-\d{1,2}-\d{1,2}$/)) {
                const parts = dateStr.split('-');
                const result = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                console.log(`   → Стандартизировано YYYY-MM-DD: ${result}`);
                return result;
            }
            
            // Пробуем распарсить как дату
            const parsedDate = new Date(dateStr);
            if (!isNaN(parsedDate.getTime())) {
                const result = parsedDate.toISOString().split('T')[0];
                console.log(`   → Автоматически распаршено в: ${result}`);
                return result;
            }
            
            console.log(`   ⚠️  Формат не распознан, возвращаем как есть: ${dateStr}`);
            return dateStr;
            
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error);
            return value;
        }
    }

    parseClassesCount(value) {
        if (!value) return 0;
        
        const str = String(value).toLowerCase().trim();
        console.log(`🔢 Парсим значение: "${str}"`);
        
        // Если это enum_id для "Абонемент занятий:"
        const subscriptionEnumMapping = {
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
        };
        
        // Проверяем, является ли значение enum_id
        if (subscriptionEnumMapping[str]) {
            console.log(`   → Найден enum_id ${str}: ${subscriptionEnumMapping[str]} занятий`);
            return subscriptionEnumMapping[str];
        }
        
        // Ищем числа в тексте
        const numberMatch = str.match(/(\d+)/);
        if (numberMatch) {
            const result = parseInt(numberMatch[1]);
            console.log(`   → Найдено число: ${result}`);
            return result;
        }
        
        // Текстовые значения
        const textToNumber = {
            'четыре': 4, '4 занятия': 4, '4': 4,
            'восемь': 8, '8 занятий': 8, '8': 8,
            'шестнадцать': 16, '16 занятий': 16, '16': 16,
            'двадцать четыре': 24, '24 занятия': 24, '24': 24,
            'два': 2, '2 занятия': 2, '2': 2,
            'три': 3, '3 занятия': 3, '3': 3,
            'пять': 5, '5 занятий': 5, '5': 5,
            'шесть': 6, '6 занятий': 6, '6': 6
        };
        
        for (const [text, num] of Object.entries(textToNumber)) {
            if (str.includes(text)) {
                console.log(`   → Распознано текстовое значение: ${num}`);
                return num;
            }
        }
        
        console.log(`   → Число не найдено, возвращаем 0`);
        return 0;
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
            freezeStatus: ''
        };
        
        if (!lead) {
            return subscriptionInfo;
        }
        
        try {
            const customFields = lead.custom_fields_values || [];
            const leadName = lead.name || '';
            const statusId = lead.status_id || 0;
            
            console.log(`\n🔍 Анализ абонемента в сделке: "${leadName}" (ID: ${lead.id}, Статус: ${statusId})`);
            
            // Собираем все данные
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                const fieldName = this.getFieldName(field);
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                switch(fieldId) {
                    case this.FIELD_IDS.LEAD.TOTAL_CLASSES:
                        subscriptionInfo.hasSubscription = true;
                        subscriptionInfo.totalClasses = this.parseClassesCount(fieldValue);
                        console.log(`   🎫 Абонемент: ${fieldValue} → ${subscriptionInfo.totalClasses} занятий`);
                        break;
                        
                    case this.FIELD_IDS.LEAD.USED_CLASSES:
                        subscriptionInfo.hasSubscription = true;
                        subscriptionInfo.usedClasses = this.parseClassesCount(fieldValue);
                        console.log(`   📊 Счетчик занятий: ${fieldValue} → ${subscriptionInfo.usedClasses}`);
                        break;
                        
                    case this.FIELD_IDS.LEAD.USED_CLASSES_NUM:
                        subscriptionInfo.hasSubscription = true;
                        const numValue = parseInt(fieldValue) || 0;
                        subscriptionInfo.usedClasses = Math.max(subscriptionInfo.usedClasses, numValue);
                        console.log(`   📊 Кол-во отхоженных: ${fieldValue} → ${numValue}`);
                        break;
                        
                    case this.FIELD_IDS.LEAD.REMAINING_CLASSES:
                        subscriptionInfo.hasSubscription = true;
                        subscriptionInfo.remainingClasses = parseInt(fieldValue) || 0;
                        console.log(`   📊 Остаток занятий: ${fieldValue} → ${subscriptionInfo.remainingClasses}`);
                        break;
                        
                    case this.FIELD_IDS.LEAD.TECHNICAL_CLASSES:
                        subscriptionInfo.hasSubscription = true;
                        const techClasses = parseInt(fieldValue) || 0;
                        if (subscriptionInfo.totalClasses === 0 && techClasses > 0) {
                            subscriptionInfo.totalClasses = techClasses;
                            console.log(`   🔧 Техническое количество: ${fieldValue} → ${techClasses}`);
                        }
                        break;
                        
                    case this.FIELD_IDS.LEAD.EXPIRATION_DATE:
                        subscriptionInfo.hasSubscription = true;
                        subscriptionInfo.expirationDate = this.parseDate(fieldValue);
                        console.log(`   📅 Окончание: ${fieldValue} → ${subscriptionInfo.expirationDate}`);
                        break;
                        
                    case this.FIELD_IDS.LEAD.ACTIVATION_DATE:
                        subscriptionInfo.hasSubscription = true;
                        subscriptionInfo.activationDate = this.parseDate(fieldValue);
                        console.log(`   📅 Активация: ${fieldValue} → ${subscriptionInfo.activationDate}`);
                        break;
                        
                    case this.FIELD_IDS.LEAD.PURCHASE_DATE:
                        subscriptionInfo.purchaseDate = this.parseDate(fieldValue);
                        console.log(`   📅 Покупка: ${fieldValue} → ${subscriptionInfo.purchaseDate}`);
                        break;
                        
                    case this.FIELD_IDS.LEAD.LAST_VISIT_DATE:
                        subscriptionInfo.hasSubscription = true;
                        subscriptionInfo.lastVisitDate = this.parseDate(fieldValue);
                        console.log(`   📅 Последний визит: ${fieldValue} → ${subscriptionInfo.lastVisitDate}`);
                        break;
                        
                    case this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE:
                        subscriptionInfo.hasSubscription = true;
                        subscriptionInfo.subscriptionType = fieldValue;
                        console.log(`   🏷️  Тип абонемента: ${fieldValue}`);
                        break;
                        
                    case this.FIELD_IDS.LEAD.SUBSCRIPTION_OWNER:
                        subscriptionInfo.subscriptionOwner = fieldValue;
                        console.log(`   👤 Принадлежность: ${fieldValue}`);
                        break;
                        
                    case this.FIELD_IDS.LEAD.BRANCH:
                        subscriptionInfo.branch = fieldValue;
                        console.log(`   📍 Филиал (сделка): ${fieldValue}`);
                        break;
                        
                    case this.FIELD_IDS.LEAD.AGE_GROUP:
                        subscriptionInfo.ageGroup = fieldValue;
                        console.log(`   👶 Возрастная группа: ${fieldValue}`);
                        break;
                        
                    case this.FIELD_IDS.LEAD.FREEZE:
                        subscriptionInfo.freezeStatus = fieldValue;
                        console.log(`   ❄️  Заморозка: ${fieldValue}`);
                        break;
                }
            }
            
            // Проверяем чекбоксы посещений
            if (subscriptionInfo.hasSubscription && subscriptionInfo.usedClasses === 0) {
                let visitedClasses = 0;
                
                // Проверяем все чекбоксы занятий
                for (let i = 1; i <= 24; i++) {
                    const checkboxId = this.FIELD_IDS.LEAD[`CLASS_${i}`];
                    if (checkboxId) {
                        const checkboxField = customFields.find(f => 
                            (f.field_id || f.id) === checkboxId
                        );
                        if (checkboxField) {
                            const checkboxValue = this.getFieldValue(checkboxField);
                            if (checkboxValue && checkboxValue.toLowerCase() === 'да') {
                                visitedClasses++;
                            }
                        }
                    }
                }
                
                if (visitedClasses > 0) {
                    subscriptionInfo.usedClasses = visitedClasses;
                    console.log(`ℹ️  Найдено ${visitedClasses} посещений по чекбоксам`);
                }
            }
            
            // Корректируем данные, если они неполные
            if (subscriptionInfo.totalClasses > 0) {
                // Если есть счетчик, но нет остатка
                if (subscriptionInfo.usedClasses > 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                    console.log(`🔢 Рассчитан остаток: ${subscriptionInfo.remainingClasses}`);
                }
                
                // Если есть остаток, но нет счетчика
                if (subscriptionInfo.remainingClasses > 0 && subscriptionInfo.usedClasses === 0) {
                    subscriptionInfo.usedClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.remainingClasses);
                    console.log(`🔢 Рассчитано использованных: ${subscriptionInfo.usedClasses}`);
                }
                
                // Если нет данных о посещениях
                if (subscriptionInfo.usedClasses === 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = subscriptionInfo.totalClasses;
                    console.log(`ℹ️  Нет данных о посещениях, показываем все доступными`);
                }
            }
            
            console.log(`\n📊 РАСЧЕТНЫЕ ДАННЫЕ:`);
            console.log(`   • Всего: ${subscriptionInfo.totalClasses}`);
            console.log(`   • Использовано: ${subscriptionInfo.usedClasses}`);
            console.log(`   • Осталось: ${subscriptionInfo.remainingClasses}`);
            
            // ОПРЕДЕЛЕНИЕ СТАТУСА
            const today = new Date();
            const isExpiredByDate = subscriptionInfo.expirationDate ? 
                new Date(subscriptionInfo.expirationDate) < today : false;
            const isFutureActivation = subscriptionInfo.activationDate ? 
                new Date(subscriptionInfo.activationDate) > today : false;
            const hasRemaining = subscriptionInfo.remainingClasses > 0;
            const hasUsed = subscriptionInfo.usedClasses > 0;
            const isClosedDeal = [142, 143].includes(statusId);

            console.log(`\n🎯 ОПРЕДЕЛЕНИЕ СТАТУСА:`);
            console.log(`   • Истек по дате: ${isExpiredByDate}`);
            console.log(`   • Активация в будущем: ${isFutureActivation}`);
            console.log(`   • Есть остаток: ${hasRemaining}`);
            console.log(`   • Есть посещения: ${hasUsed}`);
            console.log(`   • Сделка закрыта: ${isClosedDeal}`);

            if (subscriptionInfo.freezeStatus && subscriptionInfo.freezeStatus.toLowerCase() === 'да') {
                subscriptionInfo.subscriptionStatus = 'Абонемент заморожен';
                subscriptionInfo.subscriptionBadge = 'freeze';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (isExpiredByDate) {
                subscriptionInfo.subscriptionStatus = 'Абонемент истек';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (isFutureActivation) {
                subscriptionInfo.subscriptionStatus = 'Ожидает активации';
                subscriptionInfo.subscriptionBadge = 'pending';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (!hasRemaining && hasUsed) {
                subscriptionInfo.subscriptionStatus = 'Занятия закончились';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (hasRemaining) {
                subscriptionInfo.subscriptionStatus = `Активный (осталось ${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
                subscriptionInfo.subscriptionBadge = 'active';
                subscriptionInfo.subscriptionActive = true;
            }
            else if (subscriptionInfo.totalClasses > 0 && !hasUsed && !isClosedDeal) {
                subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий (не начат)`;
                subscriptionInfo.subscriptionBadge = 'pending';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (isClosedDeal) {
                subscriptionInfo.subscriptionStatus = 'Абонемент завершен';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (subscriptionInfo.totalClasses > 0) {
                subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий`;
                subscriptionInfo.subscriptionBadge = 'has_subscription';
                subscriptionInfo.subscriptionActive = true;
            }
            
            // Если нет типа абонемента, создаем его
            if (!subscriptionInfo.subscriptionType || subscriptionInfo.subscriptionType.trim() === '') {
                subscriptionInfo.subscriptionType = subscriptionInfo.totalClasses > 0 
                    ? `Абонемент на ${subscriptionInfo.totalClasses} занятий`
                    : 'Активный абонемент';
            }
            
            console.log(`\n✅ ФИНАЛЬНЫЙ СТАТУС:`);
            console.log(`   • Статус: ${subscriptionInfo.subscriptionStatus}`);
            console.log(`   • Активен: ${subscriptionInfo.subscriptionActive}`);
            console.log(`   • Бейдж: ${subscriptionInfo.subscriptionBadge}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации об абонементе:', error);
        }
        
        return subscriptionInfo;
    }

    async getContactLeads(contactId) {
        try {
            console.log(`🔍 Получение сделок контакта ID: ${contactId}`);
            
            // Основной метод - через filter[contact_id]
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&limit=250&filter[contact_id]=${contactId}`
            );
            
            let leads = response._embedded?.leads || [];
            console.log(`📊 Найдено сделок основным методом: ${leads.length}`);
            
            // Если мало сделок, пробуем альтернативный метод
            if (leads.length < 10) {
                console.log(`🔄 Пробуем альтернативный метод...`);
                try {
                    const altResponse = await this.makeRequest(
                        'GET',
                        `/api/v4/contacts/${contactId}/leads?with=custom_fields_values`
                    );
                    
                    const altLeads = altResponse._embedded?.leads || [];
                    console.log(`📊 Найдено сделок альтернативным методом: ${altLeads.length}`);
                    
                    // Объединяем результаты, убирая дубликаты
                    const allLeads = [...leads];
                    const existingIds = new Set(leads.map(l => l.id));
                    
                    for (const lead of altLeads) {
                        if (!existingIds.has(lead.id)) {
                            allLeads.push(lead);
                            existingIds.add(lead.id);
                        }
                    }
                    
                    leads = allLeads;
                    console.log(`📊 Всего уникальных сделок: ${leads.length}`);
                } catch (altError) {
                    console.log(`⚠️  Альтернативный метод не сработал: ${altError.message}`);
                }
            }
            
            // Сортируем по дате обновления (новые сначала)
            leads.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
            
            return leads;
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок контакта: ${error.message}`);
            return [];
        }
    }

    async searchContactsByPhone(phoneNumber) {
        try {
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const searchTerm = cleanPhone.slice(-4); // Последние 4 цифры
            
            return await this.makeRequest(
                'GET',
                `/api/v4/contacts?query=${encodeURIComponent(searchTerm)}&with=custom_fields_values`
            );
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            throw error;
        }
    }

    async getFullContactInfo(contactId) {
        try {
            const response = await this.makeRequest(
                'GET',
                `/api/v4/contacts/${contactId}?with=custom_fields_values`
            );
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения контакта: ${error.message}`);
            return null;
        }
    }

    extractStudentsFromContact(contact) {
        const students = [];
        
        try {
            const customFields = contact.custom_fields_values || [];
            
            console.log(`\n👤 Поиск детей в контакте: ${contact.name || 'Без имени'}`);
            
            // Для каждого возможного ребенка
            const childrenConfig = [
                { number: 1, nameFieldId: this.FIELD_IDS.CONTACT.CHILD_1_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_1_BIRTHDAY },
                { number: 2, nameFieldId: this.FIELD_IDS.CONTACT.CHILD_2_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_2_BIRTHDAY },
                { number: 3, nameFieldId: this.FIELD_IDS.CONTACT.CHILD_3_NAME, birthdayFieldId: this.FIELD_IDS.CONTACT.CHILD_3_BIRTHDAY }
            ];
            
            for (const childConfig of childrenConfig) {
                let childInfo = {
                    studentName: '',
                    birthDate: '',
                    branch: '',
                    dayOfWeek: '',
                    timeSlot: '',
                    teacherName: '',
                    course: '',
                    ageGroup: '',
                    allergies: '',
                    parentName: contact.name || '',
                    hasActiveSubscription: false,
                    lastVisitDate: ''
                };
                
                let hasChildData = false;
                
                // Проходим по всем полям контакта
                for (const field of customFields) {
                    const fieldId = field.field_id || field.id;
                    const fieldName = this.getFieldName(field);
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue || fieldValue.trim() === '') continue;
                    
                    // Имя ребенка
                    if (fieldId === childConfig.nameFieldId) {
                        childInfo.studentName = fieldValue;
                        hasChildData = true;
                        console.log(`   👶 Ребенок ${childConfig.number}: ${fieldValue}`);
                    }
                    
                    // День рождения ребенка
                    else if (fieldId === childConfig.birthdayFieldId) {
                        childInfo.birthDate = this.parseDate(fieldValue);
                    }
                    
                    // Общие поля для всех детей
                    else if (fieldId === this.FIELD_IDS.CONTACT.BRANCH) {
                        childInfo.branch = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.TEACHER) {
                        childInfo.teacherName = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.DAY_OF_WEEK) {
                        childInfo.dayOfWeek = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) {
                        childInfo.hasActiveSubscription = fieldValue.toLowerCase() === 'да' || 
                                                         fieldValue === '1' || 
                                                         fieldValue.toLowerCase() === 'true';
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.LAST_VISIT) {
                        childInfo.lastVisitDate = this.parseDate(fieldValue);
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.AGE_GROUP) {
                        childInfo.ageGroup = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.ALLERGIES) {
                        childInfo.allergies = fieldValue;
                    }
                }
                
                // Если нашли данные о ребенке, добавляем
                if (hasChildData && childInfo.studentName && childInfo.studentName.trim() !== '') {
                    students.push(childInfo);
                }
            }
            
            console.log(`📊 Найдено детей: ${students.length}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения учеников из контакта:', error);
        }
        
        return students;
    }

    async findLatestActiveSubscription(contactId) {
        console.log(`\n🎯 ПОИСК САМОГО СВЕЖЕГО АКТИВНОГО АБОНЕМЕНТА ДЛЯ КОНТАКТА: ${contactId}`);
        
        try {
            // Получаем все сделки контакта
            const leads = await this.getContactLeads(contactId);
            console.log(`📊 Сделок получено: ${leads.length}`);
            
            if (leads.length === 0) {
                console.log(`❌ Сделки не найдены`);
                return null;
            }
            
            // Ищем сделки с абонементами
            const subscriptionLeads = [];
            
            for (const lead of leads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription) {
                    subscriptionLeads.push({
                        lead: lead,
                        subscription: subscriptionInfo,
                        created_at: lead.created_at,
                        updated_at: lead.updated_at,
                        // Приоритет: активные > с остатком > по дате
                        priority: this.calculateSubscriptionPriority(subscriptionInfo, lead)
                    });
                }
            }
            
            console.log(`📊 Сделок с абонементами: ${subscriptionLeads.length}`);
            
            if (subscriptionLeads.length === 0) {
                console.log(`❌ Абонементы не найдены`);
                return null;
            }
            
            // Сортируем по приоритету
            subscriptionLeads.sort((a, b) => {
                // По приоритету (выше = лучше)
                if (b.priority !== a.priority) {
                    return b.priority - a.priority;
                }
                
                // По дате обновления (новые сначала)
                return new Date(b.updated_at) - new Date(a.updated_at);
            });
            
            const bestSubscription = subscriptionLeads[0];
            
            console.log(`\n🎯 НАЙДЕН ЛУЧШИЙ АБОНЕМЕНТ:`);
            console.log(`   Сделка: "${bestSubscription.lead.name}" (ID: ${bestSubscription.lead.id})`);
            console.log(`   Статус: ${bestSubscription.subscription.subscriptionStatus}`);
            console.log(`   Занятий: ${bestSubscription.subscription.totalClasses} всего, ${bestSubscription.subscription.usedClasses} использовано, ${bestSubscription.subscription.remainingClasses} осталось`);
            
            return {
                lead: bestSubscription.lead,
                subscription: bestSubscription.subscription
            };
            
        } catch (error) {
            console.error(`❌ Ошибка поиска активного абонемента: ${error.message}`);
            return null;
        }
    }

    calculateSubscriptionPriority(subscriptionInfo, lead) {
        let priority = 0;
        
        // Активен в системе
        if (subscriptionInfo.subscriptionActive) priority += 100;
        
        // Есть остаток занятий
        if (subscriptionInfo.remainingClasses > 0) priority += 50;
        
        // Не истек срок
        if (subscriptionInfo.expirationDate) {
            const expDate = new Date(subscriptionInfo.expirationDate);
            const now = new Date();
            if (expDate >= now) priority += 30;
        }
        
        // Не заморожен
        if (subscriptionInfo.freezeStatus && subscriptionInfo.freezeStatus.toLowerCase() === 'да') {
            priority -= 100; // Замороженные имеют низкий приоритет
        }
        
        // Не закрытая сделка
        if (lead.status_id && ![142, 143].includes(lead.status_id)) {
            priority += 20;
        }
        
        // Есть реальная дата активации (не 1970)
        if (subscriptionInfo.activationDate && subscriptionInfo.activationDate !== '1970-01-01') {
            priority += 10;
        }
        
        return priority;
    }

    findEmail(contact) {
        try {
            const customFields = contact.custom_fields_values || [];
            for (const field of customFields) {
                const fieldName = this.getFieldName(field);
                const fieldValue = this.getFieldValue(field);
                
                if ((fieldName.includes('email') || 
                     fieldName.includes('почта') || 
                     fieldName.includes('e-mail')) && 
                    fieldValue && 
                    fieldValue.includes('@')) {
                    return fieldValue;
                }
            }
        } catch (error) {
            console.error('❌ Ошибка поиска email:', error);
        }
        return '';
    }

    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        // Определяем email
        const email = this.findEmail(contact);
        
        // Создаем базовый профиль
        const profile = {
            amocrm_contact_id: contact.id || null,
            parent_contact_id: contact.id || null,
            amocrm_lead_id: lead?.id || null,
            student_name: studentInfo.studentName || 'Ученик',
            phone_number: phoneNumber,
            email: email || '',
            birth_date: studentInfo.birthDate || '',
            branch: studentInfo.branch || '',
            parent_name: studentInfo.parentName || contact.name || '',
            day_of_week: studentInfo.dayOfWeek || '',
            time_slot: studentInfo.timeSlot || '',
            teacher_name: studentInfo.teacherName || '',
            age_group: studentInfo.ageGroup || '',
            course: studentInfo.course || '',
            allergies: studentInfo.allergies || '',
            
            // Данные абонемента
            subscription_type: subscriptionInfo.subscriptionType || 'Без абонемента',
            subscription_active: subscriptionInfo.subscriptionActive ? 1 : 0,
            subscription_status: subscriptionInfo.subscriptionStatus || 'Нет абонемента',
            subscription_badge: subscriptionInfo.subscriptionBadge || 'inactive',
            total_classes: subscriptionInfo.totalClasses || 0,
            remaining_classes: subscriptionInfo.remainingClasses || 0,
            used_classes: subscriptionInfo.usedClasses || 0,
            expiration_date: subscriptionInfo.expirationDate || null,
            activation_date: subscriptionInfo.activationDate || null,
            last_visit_date: subscriptionInfo.lastVisitDate || null,
            
            // Технические данные
            custom_fields: JSON.stringify(contact.custom_fields_values || []),
            raw_contact_data: JSON.stringify(contact),
            lead_data: lead ? JSON.stringify(lead) : '{}',
            is_demo: 0,
            source: 'amocrm',
            is_active: 1
        };
        
        console.log(`📊 Создан профиль ученика:`);
        console.log(`   👤 ${profile.student_name}`);
        console.log(`   📍 Филиал: ${profile.branch || 'не указан'}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        console.log(`   📊 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        
        return profile;
    }

    async getStudentsByPhone(phoneNumber) {
        console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            // 1. Ищем контакты по телефону
            console.log('🔍 Поиск контактов...');
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            // Если контактов нет, возвращаем пустой массив
            if (contacts.length === 0) {
                console.log('📭 Контакты не найдены');
                return studentProfiles;
            }
            
            // 2. Для каждого контакта получаем профили
            for (const contact of contacts) {
                console.log(`\n👤 Анализ контакта: ${contact.name} (ID: ${contact.id})`);
                
                // Получаем полную информацию о контакте
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                // Извлекаем информацию о детях
                const children = this.extractStudentsFromContact(fullContact);
                console.log(`📊 Найдено детей в контакте: ${children.length}`);
                
                // Если детей нет, создаем профиль из самого контакта
                if (children.length === 0) {
                    console.log('👤 Создаем профиль из контакта...');
                    const studentFromContact = await this.createProfileFromContact(fullContact, phoneNumber);
                    if (studentFromContact) {
                        studentProfiles.push(studentFromContact);
                    }
                } else {
                    // Для каждого ребенка создаем профиль
                    for (const child of children) {
                        console.log(`\n👤 Создание профиля для: ${child.studentName}`);
                        
                        // Ищем самый свежий активный абонемент
                        const subscriptionData = await this.findLatestActiveSubscription(contact.id);
                        
                        let bestSubscriptionInfo = this.extractSubscriptionInfo(null);
                        let bestLead = null;
                        
                        if (subscriptionData) {
                            bestLead = subscriptionData.lead;
                            bestSubscriptionInfo = subscriptionData.subscription;
                            
                            console.log(`✅ Найден абонемент для ${child.studentName}`);
                            console.log(`   Сделка: "${bestLead.name}" (ID: ${bestLead.id})`);
                            console.log(`   Занятий: ${bestSubscriptionInfo.usedClasses}/${bestSubscriptionInfo.totalClasses} (осталось: ${bestSubscriptionInfo.remainingClasses})`);
                        } else {
                            console.log(`⚠️  Абонемент не найден для ${child.studentName}`);
                        }
                        
                        // Создаем профиль ученика
                        const studentProfile = this.createStudentProfile(
                            fullContact,
                            phoneNumber,
                            child,
                            bestSubscriptionInfo,
                            bestLead
                        );
                        
                        studentProfiles.push(studentProfile);
                        console.log(`✅ Профиль создан: ${child.studentName}`);
                    }
                }
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${studentProfiles.length}`);
            
        } catch (crmError) {
            console.error(`❌ Ошибка получения данных из amoCRM:`, crmError.message);
        }
        
        return studentProfiles;
    }

    async createProfileFromContact(contact, phoneNumber) {
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
            
            // Извлекаем данные из полей контакта
            if (contact.custom_fields_values) {
                contact.custom_fields_values.forEach(field => {
                    const fieldId = field.field_id || field.id;
                    const fieldValue = this.getFieldValue(field);
                    
                    switch(fieldId) {
                        case this.FIELD_IDS.CONTACT.BRANCH:
                            studentInfo.branch = fieldValue;
                            break;
                        case this.FIELD_IDS.CONTACT.TEACHER:
                            studentInfo.teacherName = fieldValue;
                            break;
                        case this.FIELD_IDS.CONTACT.DAY_OF_WEEK:
                            studentInfo.dayOfWeek = fieldValue;
                            break;
                        case this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB:
                            studentInfo.hasActiveSubscription = fieldValue.toLowerCase() === 'да';
                            break;
                        case this.FIELD_IDS.CONTACT.LAST_VISIT:
                            studentInfo.lastVisitDate = this.parseDate(fieldValue);
                            break;
                        case this.FIELD_IDS.CONTACT.AGE_GROUP:
                            studentInfo.ageGroup = fieldValue;
                            break;
                        case this.FIELD_IDS.CONTACT.ALLERGIES:
                            studentInfo.allergies = fieldValue;
                            break;
                    }
                });
            }
            
            // Ищем абонемент для контакта
            const subscriptionData = await this.findLatestActiveSubscription(contact.id);
            
            let subscriptionInfo = this.extractSubscriptionInfo(null);
            let bestLead = null;
            
            if (subscriptionData) {
                bestLead = subscriptionData.lead;
                subscriptionInfo = subscriptionData.subscription;
            }
            
            return this.createStudentProfile(
                contact,
                phoneNumber,
                studentInfo,
                subscriptionInfo,
                bestLead
            );
            
        } catch (error) {
            console.error('❌ Ошибка создания профиля из контакта:', error);
            return null;
        }
    }

    // ==================== ДОПОЛНИТЕЛЬНЫЕ МЕТОДЫ ====================
    
    async getLeadById(leadId) {
        try {
            console.log(`🔍 Получение сделки по ID: ${leadId}`);
            return await this.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}?with=custom_fields_values,contacts`
            );
        } catch (error) {
            console.error(`❌ Ошибка получения сделки ${leadId}:`, error.message);
            return null;
        }
    }

    createDemoProfile(phoneNumber) {
        console.log('🎭 Создание демо-профиля...');
        
        return {
            amocrm_contact_id: null,
            parent_contact_id: null,
            amocrm_lead_id: null,
            student_name: 'Демо Ученик',
            phone_number: phoneNumber,
            email: 'demo@example.com',
            birth_date: '2015-05-15',
            branch: 'Демо филиал',
            parent_name: 'Демо Родитель',
            day_of_week: 'Среда',
            time_slot: '17:00-18:00',
            teacher_name: 'Демо Преподаватель',
            age_group: '6-8 лет',
            course: 'Рисование',
            allergies: 'Нет',
            subscription_type: 'Демо абонемент на 8 занятий',
            subscription_active: 1,
            subscription_status: 'Активный (осталось 6/8 занятий)',
            subscription_badge: 'active',
            total_classes: 8,
            used_classes: 2,
            remaining_classes: 6,
            expiration_date: '2024-12-31',
            activation_date: '2024-01-15',
            last_visit_date: '2024-10-10',
            custom_fields: '{}',
            raw_contact_data: '{}',
            lead_data: '{}',
            is_demo: 1,
            source: 'demo',
            is_active: 1
        };
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
        
        for (const profile of profiles) {
            try {
                // Проверяем существование профиля
                const existingProfile = await db.get(
                    `SELECT id FROM student_profiles 
                     WHERE student_name = ? AND phone_number = ? AND (branch = ? OR (branch IS NULL AND ? IS NULL))`,
                    [profile.student_name, profile.phone_number, profile.branch || '', profile.branch || '']
                );
                
                const columns = [
                    'amocrm_contact_id', 'parent_contact_id', 'amocrm_lead_id', 'student_name', 'phone_number', 'email',
                    'birth_date', 'branch', 'day_of_week', 'time_slot', 'teacher_name', 'age_group', 'course', 'allergies',
                    'parent_name', 'subscription_type', 'subscription_active', 'subscription_status', 'subscription_badge',
                    'total_classes', 'used_classes', 'remaining_classes', 'expiration_date', 
                    'activation_date', 'last_visit_date', 'custom_fields', 
                    'raw_contact_data', 'lead_data', 'is_demo', 'source', 'is_active'
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
                    // Вставка нового профиля
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    savedCount++;
                    console.log(`✅ Профиль сохранен: ${profile.student_name} (${profile.branch || 'без филиала'})`);
                } else {
                    // Обновление существующего профиля
                    const setClause = columns.map(col => `${col} = ?`).join(', ');
                    
                    await db.run(
                        `UPDATE student_profiles SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [...values, existingProfile.id]
                    );
                    savedCount++;
                    console.log(`✅ Профиль обновлен: ${profile.student_name} (${profile.branch || 'без филиала'})`);
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка сохранения профиля ${profile.student_name}:`, profileError.message);
            }
        }
        
        console.log(`✅ Сохранено/обновлено профилей: ${savedCount}`);
        return savedCount;
    } catch (error) {
        console.error(`❌ Общая ошибка сохранения профилей: ${error.message}`);
        return 0;
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

// ==================== ОСНОВНОЙ API ====================

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '3.0.0',
        amocrm_connected: amoCrmService.isInitialized,
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
        console.log(`🔧 Статус amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
        
        let profiles = [];
        
        // Ищем профили в amoCRM
        if (amoCrmService.isInitialized) {
            console.log('🔍 Поиск в amoCRM...');
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            console.log(`📊 Найдено профилей в amoCRM: ${profiles.length}`);
            
            if (profiles.length > 0) {
                const savedCount = await saveProfilesToDatabase(profiles);
                console.log(`💾 Сохранено в БД: ${savedCount} профилей`);
                
                // После сохранения, загружаем из БД для гарантии
                const cleanPhone = phone.replace(/\D/g, '');
                profiles = await db.all(
                    `SELECT * FROM student_profiles 
                     WHERE phone_number LIKE ? AND is_active = 1
                     ORDER BY 
                       CASE WHEN subscription_active = 1 THEN 1 ELSE 2 END,
                       CASE WHEN source = 'amocrm' THEN 1 ELSE 2 END,
                       updated_at DESC`,
                    [`%${cleanPhone.slice(-10)}%`]
                );
                console.log(`📊 Загружено из БД после сохранения: ${profiles.length}`);
            }
        }
        
        // Если в amoCRM не нашли или не удалось сохранить, ищем в локальной БД
        if (profiles.length === 0) {
            console.log('🔍 Поиск в локальной базе данных...');
            const cleanPhone = phone.replace(/\D/g, '');
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY 
                   CASE WHEN subscription_active = 1 THEN 1 ELSE 2 END,
                   CASE WHEN source = 'amocrm' THEN 1 ELSE 2 END,
                   updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            console.log(`📊 Найдено профилей в локальной БД: ${profiles.length}`);
        }
        
        // Создаем временного пользователя
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            first_name: profiles.length > 0 ? profiles[0].student_name?.split(' ')[0] || 'Ученик' : 'Гость',
            is_temp: true,
            profiles_count: profiles.length
        };
        
        // Создаем сессию
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
        
        // Форматируем профили для ответа
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
            remaining_classes: p.remaining_classes,
            used_classes: p.used_classes,
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            parent_name: p.parent_name,
            is_demo: p.is_demo === 1,
            source: p.source
        }));
        
        // Проверяем, есть ли реальные данные из amoCRM
        const hasRealData = profiles.some(p => p.source === 'amocrm' && p.is_demo === 0);
        
        // Определяем, есть ли несколько учеников
        const hasMultipleStudents = profiles.length > 1;
        
        // Формируем ответ
        const responseData = {
            success: true,
            message: profiles.length > 0 
                ? hasRealData ? 'Найдены реальные профили учеников' : 'Найдены демо-профили учеников'
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
        console.log(`📊 Реальные данные из amoCRM: ${hasRealData ? '✅ Да' : '❌ Нет'}`);
        console.log(`👥 Несколько учеников: ${hasMultipleStudents ? '✅ Да' : '❌ Нет'}`);
        
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

// ... остальные маршруты остаются без изменений ...

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v3.0');
        console.log('='.repeat(80));
        console.log('✨ ПОЛНОСТЬЮ ПЕРЕРАБОТАНА ЛОГИКА РАБОТЫ С AMOCRM');
        console.log('✨ ДОБАВЛЕНЫ ВСЕ ВАШИ ID ПОЛЕЙ');
        console.log('✨ ИСПРАВЛЕНЫ ОШИБКИ ПОИСКА ДЕТЕЙ И АБОНЕМЕНТОВ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
        } else {
            console.log('⚠️  amoCRM не инициализирован');
            console.log('ℹ️  Используются локальные/тестовые данные');
        }
        
        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 Основной URL: http://localhost:${PORT}`);
            console.log(`📊 База данных: SQLite`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`🔍 Профили пользователя: GET http://localhost:${PORT}/api/profiles`);
            console.log(`📋 Абонемент: POST http://localhost:${PORT}/api/subscription`);
            console.log(`🧪 Полный тест цикла: GET http://localhost:${PORT}/api/test/full-cycle/79175161115`);
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
