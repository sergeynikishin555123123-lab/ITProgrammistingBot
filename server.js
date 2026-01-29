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
        // Добавьте другие когда увидите
        
        // ==================== ГРУППА ВОЗРАСТ: (850243) ====================
        '504047': '6-8 лет',
        '504049': '8-10 лет',
        '504051': '10-13 лет',
        // Добавьте другие когда увидите
        
        // ==================== РЕКЛАМНЫЙ КАНАЛ: (850251) ====================
        '504095': 'Сарафан',
        // Добавьте другие когда увидите
        
        // ==================== КАНАЛ ОТПРАВКИ СООБЩЕНИЙ: (867617) ====================
        '527233': 'Телеграм',
        // Добавьте другие когда увидите
        
        // ==================== ФИЛИАЛ В КОНТАКТАХ (871273) ====================
        '529779': 'Свиблово',
        // Добавьте другие филиалы когда увидите
        
        // ==================== ПРЕПОДАВАТЕЛЬ (888881) ====================
        '556183': 'Аня К',
        // Добавьте других преподавателей когда увидите
        
        // ==================== ВОЗРАСТ ГРУППЫ (888903) ====================
        '549419': '8-10 лет',
        // Добавьте другие возрастные группы когда увидите
        
        // ==================== ДЕНЬ НЕДЕЛИ ПОСЕЩЕНИЯ (888879) ====================
        '549415': 'Среда',
        // Добавьте другие дни когда увидите
        
        // ==================== КАНАЛ РАССЫЛКИ (892645) ====================
        '557151': 'Телеграм',
        // Добавьте другие каналы когда увидите
        
        // ==================== КАНАЛ ОТПРАВКИ (893159) ====================
        '557855': 'ТГ и ТГ Бот',
        // Добавьте другие каналы когда увидите
        
        // ==================== ДЕНЬ НЕДЕЛИ (2025-26) (892225) ====================
        '556037': 'Среда',
        // Добавьте другие дни когда увидите
        
        // ==================== ОТЗЫВ (891635) ====================
        '555251': 'Запрошен',
        // Добавьте другие статусы когда увидите
        
        // ==================== СРОК ЗАМОРОЗКИ (890097) ====================
        '551613': '1 неделя',
        // Добавьте другие сроки когда увидите
        
        // ==================== РАССЫЛКИ (892647) ====================
        '557199': 'Рассылка 17.10.2025',
        // Добавьте другие рассылки когда увидите
        
        // ==================== БЫЛ НА ПРОБНОМ ЗАНЯТИИ: (867691) ====================
        '527299': 'Скульптура',
        // Добавьте другие занятия когда увидите
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
            const dateStr = String(value).trim();
            const cleanStr = dateStr.replace(/[^\d\.\-T:+]/g, '');
            
            // Если это timestamp в секундах
            if (/^\d{9,10}$/.test(cleanStr)) {
                const timestamp = parseInt(cleanStr);
                if (timestamp > 1000000000 && timestamp < 2000000000) {
                    const date = new Date(timestamp * 1000);
                    return date.toISOString().split('T')[0];
                }
            }
            
            // Формат DD.MM.YYYY
            if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(cleanStr)) {
                const [day, month, year] = cleanStr.split('.');
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
            
            // Формат YYYY-MM-DD
            if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(cleanStr)) {
                const [year, month, day] = cleanStr.split('-');
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
            
            return cleanStr;
            
        } catch (error) {
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
        
        // ОПРЕДЕЛЕНИЕ СТАТУСА (УПРОЩЕННАЯ ЛОГИКА)
        console.log(`\n🎯 Определение статуса:`);
        
        if (!subscriptionInfo.hasSubscription || subscriptionInfo.totalClasses === 0) {
            subscriptionInfo.subscriptionStatus = 'Нет абонемента';
            subscriptionInfo.subscriptionBadge = 'inactive';
            subscriptionInfo.subscriptionActive = false;
            console.log(`   ❌ Нет абонемента или 0 занятий`);
        }
        else if (subscriptionInfo.leadIsClosed) {
            subscriptionInfo.subscriptionStatus = 'Абонемент завершен';
            subscriptionInfo.subscriptionBadge = 'expired';
            subscriptionInfo.subscriptionActive = false;
            console.log(`   ❌ Сделка закрыта`);
        }
        else if (subscriptionInfo.freezeStatus && subscriptionInfo.freezeStatus.toLowerCase() === 'да') {
            subscriptionInfo.subscriptionStatus = 'Абонемент заморожен';
            subscriptionInfo.subscriptionBadge = 'freeze';
            subscriptionInfo.subscriptionActive = false;
            console.log(`   ❄️  Абонемент заморожен`);
        }
        else if (subscriptionInfo.remainingClasses > 0) {
            subscriptionInfo.subscriptionStatus = `Активный (осталось ${subscriptionInfo.remainingClasses} из ${subscriptionInfo.totalClasses})`;
            subscriptionInfo.subscriptionBadge = 'active';
            subscriptionInfo.subscriptionActive = true;
            console.log(`   ✅ Есть остаток занятий: ${subscriptionInfo.remainingClasses}`);
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
            subscriptionInfo.subscriptionActive = true;
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
    
    return subscriptionInfo;
}
    async getContactLeads(contactId) {
        try {
            console.log(`🔍 Получение сделок контакта ID: ${contactId}`);
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&limit=250&filter[contact_id]=${contactId}`
            );
            
            const leads = response._embedded?.leads || [];
            console.log(`📊 Найдено сделок: ${leads.length}`);
            
            // Сортируем по дате обновления (новые сначала)
            leads.sort((a, b) => {
                return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
            });
            
            return leads;
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок контакта ${contactId}:`, error.message);
            return [];
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

    async findLatestActiveSubscription(contactId) {
        console.log(`🎯 Поиск активного абонемента для контакта: ${contactId}`);
        
        try {
            const leads = await this.getContactLeads(contactId);
            console.log(`📊 Сделок получено: ${leads.length}`);
            
            if (leads.length === 0) {
                return null;
            }
            
            const subscriptionLeads = [];
            
            for (const lead of leads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription) {
                    subscriptionLeads.push({
                        lead: lead,
                        subscription: subscriptionInfo,
                        updated_at: lead.updated_at,
                        priority: subscriptionInfo.subscriptionActive ? 100 : 50
                    });
                }
            }
            
            console.log(`📊 Сделок с абонементами: ${subscriptionLeads.length}`);
            
            if (subscriptionLeads.length === 0) {
                return null;
            }
            
            // Сортируем по приоритету и дате
            subscriptionLeads.sort((a, b) => {
                if (b.priority !== a.priority) {
                    return b.priority - a.priority;
                }
                return new Date(b.updated_at) - new Date(a.updated_at);
            });
            
            const bestSubscription = subscriptionLeads[0];
            
            console.log(`✅ Найден абонемент: "${bestSubscription.lead.name}"`);
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
    console.log(`   📊 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
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
            const contacts = await this.searchContactsByPhone(phoneNumber);
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                return studentProfiles;
            }
            
            for (const contact of contacts) {
                console.log(`👤 Анализ контакта: ${contact.name} (ID: ${contact.id})`);
                
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                const children = this.extractStudentsFromContact(fullContact);
                console.log(`📊 Найдено детей в контакте: ${children.length}`);
                
                if (children.length === 0) {
                    const studentFromContact = await this.createProfileFromContact(fullContact, phoneNumber);
                    if (studentFromContact) {
                        studentProfiles.push(studentFromContact);
                    }
                } else {
                    for (const child of children) {
                        console.log(`👤 Создание профиля для: ${child.studentName}`);
                        
                        const subscriptionData = await this.findLatestActiveSubscription(contact.id);
                        
                        let bestSubscriptionInfo = this.extractSubscriptionInfo(null);
                        let bestLead = null;
                        
                        if (subscriptionData) {
                            bestLead = subscriptionData.lead;
                            bestSubscriptionInfo = subscriptionData.subscription;
                            console.log(`✅ Найден абонемент для ${child.studentName}`);
                        } else {
                            console.log(`⚠️  Абонемент не найден для ${child.studentName}`);
                        }
                        
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
            
            console.log(`🎯 Итого создано профилей: ${studentProfiles.length}`);
            
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
            
            if (contact.custom_fields_values) {
                for (const field of contact.custom_fields_values) {
                    const fieldId = field.field_id;
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue) continue;
                    
                    if (fieldId === this.FIELD_IDS.CONTACT.BRANCH) {
                        studentInfo.branch = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.TEACHER) {
                        studentInfo.teacherName = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.DAY_OF_WEEK) {
                        studentInfo.dayOfWeek = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) {
                        studentInfo.hasActiveSubscription = fieldValue.toLowerCase() === 'да';
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.LAST_VISIT) {
                        studentInfo.lastVisitDate = this.parseDate(fieldValue);
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.AGE_GROUP) {
                        studentInfo.ageGroup = fieldValue;
                    }
                    else if (fieldId === this.FIELD_IDS.CONTACT.ALLERGIES) {
                        studentInfo.allergies = fieldValue;
                    }
                }
            }
            
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

    createDemoProfile(phoneNumber) {
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
                const existingProfile = await db.get(
                    `SELECT id FROM student_profiles 
                     WHERE student_name = ? AND phone_number = ?`,
                    [profile.student_name, profile.phone_number]
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
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    savedCount++;
                } else {
                    const setClause = columns.map(col => `${col} = ?`).join(', ');
                    
                    await db.run(
                        `UPDATE student_profiles SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [...values, existingProfile.id]
                    );
                    savedCount++;
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка сохранения профиля:`, profileError.message);
            }
        }
        
        console.log(`✅ Сохранено/обновлено профилей: ${savedCount}`);
        return savedCount;
    } catch (error) {
        console.error(`❌ Общая ошибка сохранения профилей: ${error.message}`);
        return 0;
    }
}
// Добавить вспомогательную функцию
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

// ==================== API МАРШРУТЫ ====================

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '4.1.0',
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
            console.log('🎭 Создание демо-профиля...');
            const demoProfile = amoCrmService.createDemoProfile(formattedPhone);
            profiles = [demoProfile];
            await saveProfilesToDatabase([demoProfile]);
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
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            parent_name: p.parent_name,
            is_demo: p.is_demo === 1,
            source: p.source,
            // Добавляем расчетные поля для фронтенда
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

app.get('/api/profiles', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Токен не предоставлен'
            });
        }
        
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const phone = decoded.phone;
            
            console.log(`\n📋 ПОЛУЧЕНИЕ ПРОФИЛЕЙ ДЛЯ: ${phone}`);
            
            const cleanPhone = phone.replace(/\D/g, '');
            const profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            
            console.log(`📊 Найдено профилей: ${profiles.length}`);
            
            const responseProfiles = profiles.map(p => ({
                id: p.id,
                student_name: p.student_name,
                phone_number: p.phone_number,
                email: p.email,
                branch: p.branch,
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
            
            res.json({
                success: true,
                data: {
                    profiles: responseProfiles,
                    total_profiles: profiles.length
                }
            });
            
        } catch (jwtError) {
            console.error('❌ Ошибка проверки токена:', jwtError.message);
            return res.status(401).json({
                success: false,
                error: 'Недействительный токен'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка получения профилей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профилей'
        });
    }
});

app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!profile_id) {
            return res.status(400).json({
                success: false,
                error: 'Укажите ID профиля'
            });
        }
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Токен не предоставлен'
            });
        }
        
        try {
            jwt.verify(token, JWT_SECRET);
            
            console.log(`\n🎫 ПОЛУЧЕНИЕ ИНФОРМАЦИИ ОБ АБОНЕМЕНТЕ ДЛЯ ПРОФИЛЯ: ${profile_id}`);
            
            const profile = await db.get(
                'SELECT * FROM student_profiles WHERE id = ? AND is_active = 1',
                [profile_id]
            );
            
            if (!profile) {
                return res.status(404).json({
                    success: false,
                    error: 'Профиль не найден'
                });
            }
            
            const subscriptionData = {
                profile_id: profile.id,
                student_name: profile.student_name,
                subscription_type: profile.subscription_type,
                subscription_active: profile.subscription_active === 1,
                subscription_status: profile.subscription_status,
                subscription_badge: profile.subscription_badge,
                total_classes: profile.total_classes,
                used_classes: profile.used_classes,
                remaining_classes: profile.remaining_classes,
                expiration_date: profile.expiration_date,
                activation_date: profile.activation_date,
                last_visit_date: profile.last_visit_date,
                updated_at: profile.updated_at
            };
            
            console.log(`✅ Данные абонемента получены`);
            
            res.json({
                success: true,
                data: subscriptionData
            });
            
        } catch (jwtError) {
            console.error('❌ Ошибка проверки токена:', jwtError.message);
            return res.status(401).json({
                success: false,
                error: 'Недействительный токен'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка получения информации об абонементе:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
        });
    }
});

// ==================== ДЕБАГ МАРШРУТЫ ====================

app.get('/api/debug/fields', async (req, res) => {
    try {
        console.log(`\n🔧 ЗАПРОС НА ДЕБАГ ПОЛЕЙ AMOCRM`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(500).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const fieldsInfo = await amoCrmService.getAllFieldsInfo();
        
        // Безопасная обработка массивов
        const leadFields = Array.isArray(fieldsInfo.lead_fields) ? fieldsInfo.lead_fields : [];
        const contactFields = Array.isArray(fieldsInfo.contact_fields) ? fieldsInfo.contact_fields : [];
        
        const response = {
            success: true,
            data: {
                account: {
                    name: fieldsInfo.account?.name || 'Неизвестно',
                    id: fieldsInfo.account?.id || 'Неизвестно'
                },
                statistics: {
                    total_fields: fieldsInfo.custom_fields_count || 0,
                    lead_fields: leadFields.length,
                    contact_fields: contactFields.length,
                    fields_in_our_config: fieldsInfo.field_mappings?.filter(f => f.is_in_our_config).length || 0
                },
                our_field_config: amoCrmService.FIELD_IDS,
                field_mappings: fieldsInfo.field_mappings || [],
                lead_fields: leadFields.slice(0, 20), // Ограничиваем вывод
                contact_fields: contactFields.slice(0, 20) // Ограничиваем вывод
            }
        };
        
        console.log(`✅ Информация о полях получена`);
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Ошибка получения информации о полях:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации о полях',
            details: error.message
        });
    }
});

app.get('/api/debug/lead/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        
        console.log(`\n🔧 ДЕБАГ СДЕЛКИ ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(500).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const lead = await amoCrmService.debugLead(leadId);
        
        if (!lead) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        res.json({
            success: true,
            data: {
                lead: lead,
                subscription_info: amoCrmService.extractSubscriptionInfo(lead)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка дебага сделки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка дебага сделки',
            details: error.message
        });
    }
});

app.get('/api/debug/contact/:id', async (req, res) => {
    try {
        const contactId = req.params.id;
        
        console.log(`\n🔧 ДЕБАГ КОНТАКТА ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(500).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const contact = await amoCrmService.debugContact(contactId);
        
        if (!contact) {
            return res.status(404).json({
                success: false,
                error: 'Контакт не найден'
            });
        }
        
        res.json({
            success: true,
            data: {
                contact: contact,
                students: amoCrmService.extractStudentsFromContact(contact)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка дебага контакта:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка дебага контакта',
            details: error.message
        });
    }
});

app.get('/api/test/full-cycle/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n🧪 ПОЛНЫЙ ТЕСТОВЫЙ ЦИКЛ ДЛЯ ТЕЛЕФОНА: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(500).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log('\n1️⃣  ПОИСК КОНТАКТОВ...');
        const contacts = await amoCrmService.searchContactsByPhone(formattedPhone);
        console.log(`✅ Найдено контактов: ${contacts.length}`);
        
        const results = [];
        
        for (const contact of contacts.slice(0, 2)) {
            console.log(`\n🔍 АНАЛИЗ КОНТАКТА: ${contact.name} (ID: ${contact.id})`);
            
            const contactResult = {
                contact_id: contact.id,
                contact_name: contact.name,
                students: [],
                leads: []
            };
            
            const fullContact = await amoCrmService.getFullContactInfo(contact.id);
            if (!fullContact) continue;
            
            const students = amoCrmService.extractStudentsFromContact(fullContact);
            contactResult.students = students;
            
            const leads = await amoCrmService.getContactLeads(contact.id);
            console.log(`   Сделок у контакта: ${leads.length}`);
            
            for (const lead of leads.slice(0, 3)) {
                console.log(`   📄 Сделка ${lead.id}: "${lead.name}"`);
                
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                contactResult.leads.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    status_id: lead.status_id,
                    subscription_info: subscriptionInfo
                });
            }
            
            results.push(contactResult);
        }
        
        console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ ЧЕРЕЗ ОСНОВНОЙ МЕТОД...`);
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        console.log(`\n📊 ИТОГ ТЕСТА:`);
        console.log(`   Контактов найдено: ${contacts.length}`);
        console.log(`   Профилей создано: ${profiles.length}`);
        
        res.json({
            success: true,
            data: {
                test_phone: formattedPhone,
                contacts_found: contacts.length,
                profiles_created: profiles.length,
                analysis_results: results,
                profiles: profiles.slice(0, 5)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестового цикла:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'Ошибка тестового цикла',
            details: error.message
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(100));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v4.1');
        console.log('='.repeat(100));
        console.log('✨ УЛУЧШЕННЫЙ ПАРСИНГ AMOCRM');
        console.log('✨ ИСПРАВЛЕНЫ ОШИБКИ ОБРАБОТКИ МАССИВОВ');
        console.log('✨ ДОБАВЛЕНЫ ДЕБАГ МАРШРУТЫ');
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
            console.log('ℹ️  Используются локальные/тестовые данные');
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(100));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(100));
            console.log(`🌐 Основной URL: http://localhost:${PORT}`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log('='.repeat(100));
            
            console.log('\n🔗 ОСНОВНЫЕ API МАРШРУТЫ:');
            console.log('='.repeat(50));
            console.log(`📊 Статус: GET http://localhost:${PORT}/api/status`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`📋 Профили: GET http://localhost:${PORT}/api/profiles`);
            console.log(`🎫 Абонемент: POST http://localhost:${PORT}/api/subscription`);
            console.log('');
            console.log('🔧 ДЕБАГ МАРШРУТЫ:');
            console.log('─'.repeat(50));
            console.log(`📊 Все поля amoCRM: GET http://localhost:${PORT}/api/debug/fields`);
            console.log(`📄 Дебаг сделки: GET http://localhost:${PORT}/api/debug/lead/29719948`);
            console.log(`👤 Дебаг контакта: GET http://localhost:${PORT}/api/debug/contact/{id}`);
            console.log(`🧪 Полный тест: GET http://localhost:${PORT}/api/test/full-cycle/79175161115`);
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
