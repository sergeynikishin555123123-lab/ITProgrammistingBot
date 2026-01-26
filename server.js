// server.js - ИСПРАВЛЕННАЯ ВЕРСИЯ С КОРРЕКТНЫМ СИНТАКСИСОМ

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
const AMOCRM_SUBDOMAIN = AMOCRM_DOMAIN ? AMOCRM_DOMAIN.replace('.amocrm.ru', '') : '';
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

// ==================== КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService v3.0');
        console.log('📊 КОРРЕКТНАЯ ЛОГИКА ВЫБОРА АБОНЕМЕНТОВ');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.fieldMappings = new Map();
        
        // ОСНОВНЫЕ ПОЛЯ ДЛЯ АБОНЕМЕНТОВ
        this.FIELD_IDS = {
            // Сделки (абонементы)
            LEAD: {
                TOTAL_CLASSES: 850241,    // "Абонемент занятий:"
                USED_CLASSES: 850257,     // "Счетчик занятий:"  
                REMAINING_CLASSES: 890163, // "Остаток занятий"
                EXPIRATION_DATE: 850255,  // "Окончание абонемента:"
                ACTIVATION_DATE: 851565,  // "Дата активации абонемента:"
                LAST_VISIT_DATE: 850259,  // "Дата последнего визита:"
                SUBSCRIPTION_TYPE: 891007, // "Тип абонемента"
                FREEZE: 867693,           // "Заморозка абонемента:"
                SUBSCRIPTION_OWNER: 805465, // "Принадлежность абонемента:"
                
                // Дополнительные поля
                TECHNICAL_COUNT: 891819,  // "Количество занятий (тех)"
                AGE_GROUP: 850243,        // "Группа возраст:"
                PRICE_PER_CLASS: 891813,  // "Стоимость 1 занятия"
                ADVANCE_PAYMENT: 891817,  // "Авансовые средства"
                RECEIVED_PAYMENT: 891815, // "Полученные средства"
                
                // Поля для посещений
                CLASS_1: 884899, CLASS_2: 884901, CLASS_3: 884903, CLASS_4: 884905,
                CLASS_5: 884907, CLASS_6: 884909, CLASS_7: 884911, CLASS_8: 884913,
                CLASS_9: 884915, CLASS_10: 884917, CLASS_11: 884919, CLASS_12: 884921,
                CLASS_13: 884923, CLASS_14: 884925, CLASS_15: 884927, CLASS_16: 884929,
                CLASS_17: 892867, CLASS_18: 892871, CLASS_19: 892875, CLASS_20: 892879,
                CLASS_21: 892883, CLASS_22: 892887, CLASS_23: 892893, CLASS_24: 892895
            },
            
            // Контакты (ученики)
            CONTACT: {
                // Дети
                CHILD_1_NAME: 867233,    // "!ФИО ребенка:"
                CHILD_1_BIRTHDAY: null,
                CHILD_2_NAME: 867235,    // "!!ФИО ребенка:"
                CHILD_2_BIRTHDAY: 867685,
                CHILD_3_NAME: 867733,    // "!!!ФИО ребенка:"
                CHILD_3_BIRTHDAY: 867735,
                
                // Основные поля
                BRANCH: 871273,          // "Филиал:"
                TEACHER: 888881,         // "Преподаватель"
                DAY_OF_WEEK: 892225,     // "День недели (2025-26)"
                HAS_ACTIVE_SUB: 890179,  // "Есть активный абонемент"
                LAST_VISIT: 885380,      // "Дата последнего визита"
                AGE_GROUP: 888903,       // "Возраст группы"
                ALLERGIES: null,
                BIRTH_DATE: null,
                
                // Общие поля
                PARENT_NAME: 'name',     // Имя контакта
                EMAIL: null,
                PHONE: 216615            // "Телефон"
            }
        };
        
        // Воронка "!Абонемент" - ВСЕ статусы в этой воронке считаются активными!
        this.SUBSCRIPTION_PIPELINE_ID = 7977402; // ID воронки "!Абонемент"
        
        // Статусы в воронке "!Абонемент"
        this.SUBSCRIPTION_STATUSES = {
            // ВСЕ статусы в воронке "!Абонемент" считаются активными
            ACTIVE_IN_PIPELINE: [
                65473306, // "Активный абонемент" (Текущий)
                60025747, // "Активирован" (Исторический)
                65455980, // "Пробный" (возможно есть)
                60025749, // "Истек" (в той же воронке!)
                60025751  // "Заморозка" (в той же воронке!)
            ],
            // Если сделка НЕ в воронке абонементов
            INACTIVE: [
                // Статусы в других воронках
            ]
        };
        
        // Критические поля для сделки 28674745
        this.FIELD_IDS.LEAD = {
            TOTAL_CLASSES: 850241,    // "Абонемент занятий:" = "8 занятий"
            USED_CLASSES: 850257,     // "Счетчик занятий:" = "1"
            REMAINING_CLASSES: 890163, // "Остаток занятий" = "7"
            EXPIRATION_DATE: 850255,  // "Окончание абонемента:"
            ACTIVATION_DATE: 851565,  // "Дата активации абонемента:" = "25.01.2026"
            LAST_VISIT_DATE: 850259,  // "Дата последнего визита:" = "25.01.2026"
            SUBSCRIPTION_TYPE: 891007, // "Тип абонемента" = "Повторный"
            FREEZE: 867693,           // "Заморозка абонемента:" = "ДА"
            SUBSCRIPTION_OWNER: 805465, // "Принадлежность абонемента:"
            
            // Дополнительные поля
            TECHNICAL_COUNT: 891819,  // "Количество занятий (тех)"
            AGE_GROUP: 850243,        // "Группа возраст:" = "Поступающий"
            PRICE_PER_CLASS: 891813,  // "Стоимость 1 занятия"
            ADVANCE_PAYMENT: 891817,  // "Авансовые средства"
            RECEIVED_PAYMENT: 891815, // "Полученные средства"
            
            // Поля для посещений (чекбоксы)
            CLASS_1: 884899, CLASS_2: 884901, CLASS_3: 884903, CLASS_4: 884905,
            CLASS_5: 884907, CLASS_6: 884909, CLASS_7: 884911, CLASS_8: 884913
        };
    }
async debugLeadSelection(contactId, studentName) {
    console.log(`\n🔍 ДИАГНОСТИКА ВЫБОРА СДЕЛКИ ДЛЯ: "${studentName}"`);
    console.log('='.repeat(80));
    
    try {
        // Получаем все сделки контакта
        const leads = await this.getContactLeadsSorted(contactId);
        console.log(`📊 Всего сделок: ${leads.length}`);
        
        // Анализируем каждую сделку
        const leadAnalysis = [];
        
        for (const lead of leads) {
            console.log(`\n📄 Сделка ${lead.id}: "${lead.name}"`);
            console.log(`📍 Pipeline: ${lead.pipeline_id}, Status: ${lead.status_id}`);
            
            const subscriptionInfo = this.extractSubscriptionInfo(lead);
            
            const analysis = {
                lead_id: lead.id,
                lead_name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                subscription_info: subscriptionInfo,
                name_match: this.checkNameMatch(lead.name, studentName),
                is_in_subscription_pipeline: lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID,
                has_subscription: subscriptionInfo.hasSubscription,
                is_best_candidate: this.isBestLeadForStudent(lead, studentName, subscriptionInfo)
            };
            
            leadAnalysis.push(analysis);
            
            console.log(`   • Абонемент: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Занятий: ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses}`);
            console.log(`   • Статус: ${subscriptionInfo.subscriptionStatus}`);
            console.log(`   • Активен: ${subscriptionInfo.subscriptionActive ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Воронка: ${analysis.is_in_subscription_pipeline ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Совпадение: ${analysis.name_match.exact ? 'Точное' : analysis.name_match.partial ? 'Частичное' : 'Нет'}`);
        }
        
        // Находим лучшую сделку
        const bestLeads = leadAnalysis.filter(a => a.has_subscription);
        
        if (bestLeads.length > 0) {
            // Сортируем по приоритету
            const sorted = bestLeads.sort((a, b) => {
                // 1. Точное совпадение имени
                if (a.name_match.exact !== b.name_match.exact) {
                    return b.name_match.exact - a.name_match.exact;
                }
                
                // 2. Активный абонемент
                if (a.subscription_info.subscriptionActive !== b.subscription_info.subscriptionActive) {
                    return b.subscription_info.subscriptionActive - a.subscription_info.subscriptionActive;
                }
                
                // 3. Остаток занятий
                if (a.subscription_info.remainingClasses !== b.subscription_info.remainingClasses) {
                    return b.subscription_info.remainingClasses - a.subscription_info.remainingClasses;
                }
                
                // 4. В воронке абонементов
                if (a.is_in_subscription_pipeline !== b.is_in_subscription_pipeline) {
                    return b.is_in_subscription_pipeline - a.is_in_subscription_pipeline;
                }
                
                return 0;
            });
            
            console.log(`\n🏆 ЛУЧШАЯ СДЕЛКА: "${sorted[0].lead_name}"`);
            return sorted[0];
        }
        
        console.log(`\n❌ НЕТ ПОДХОДЯЩИХ СДЕЛОК`);
        return null;
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
        return null;
    }
}
    async initialize() {
        try {
            console.log('🔄 Начинаем инициализацию amoCRM...');
            
            if (this.accessToken) {
                console.log('🔍 Проверка валидности токена...');
                const isValid = await this.checkTokenValidity(this.accessToken);
                this.isInitialized = isValid;
                
                if (isValid) {
                    await this.loadFieldMappings();
                    console.log('✅ amoCRM успешно инициализирован');
                    console.log(`📊 Аккаунт: ${this.accountInfo.name}`);
                    console.log(`🏢 Домен: ${AMOCRM_DOMAIN}`);
                    
                    await this.checkSubscriptionPipeline();
                    await this.loadPipelineStatuses();
                } else {
                    console.log('❌ Токен не валиден. Проверьте AMOCRM_ACCESS_TOKEN в .env файле');
                }
                return isValid;
            } else {
                console.log('❌ Токен не найден. Установите AMOCRM_ACCESS_TOKEN в .env файле');
                return false;
            }
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            return false;
        }
    }

    async checkTokenValidity(token) {
        try {
            const response = await axios.get(`${this.baseUrl}/api/v4/account`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
            
            this.accountInfo = response.data;
            console.log('✅ Токен валиден!');
            console.log(`📊 Аккаунт: ${this.accountInfo.name || 'Неизвестно'}`);
            console.log(`🆔 ID аккаунта: ${this.accountInfo.id}`);
            return true;
        } catch (error) {
            console.error('❌ Ошибка проверки токена:');
            if (error.response) {
                console.error(`   📊 Статус: ${error.response.status}`);
                console.error(`   📋 Ответ:`, error.response.data);
            } else {
                console.error(`   📋 Ошибка: ${error.message}`);
            }
            return false;
        }
    }

    async loadFieldMappings() {
        try {
            console.log('📋 Загрузка всех кастомных полей amoCRM...');
            
            const contactFields = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            let loadedCount = 0;
            
            if (contactFields && contactFields._embedded && contactFields._embedded.custom_fields) {
                contactFields._embedded.custom_fields.forEach(field => {
                    this.fieldMappings.set(field.id, {
                        name: field.name,
                        type: field.type,
                        enums: field.enums || []
                    });
                    loadedCount++;
                });
            }
            
            const leadFields = await this.makeRequest('GET', '/api/v4/leads/custom_fields');
            
            if (leadFields && leadFields._embedded && leadFields._embedded.custom_fields) {
                leadFields._embedded.custom_fields.forEach(field => {
                    this.fieldMappings.set(field.id, {
                        name: field.name,
                        type: field.type,
                        enums: field.enums || []
                    });
                    loadedCount++;
                });
            }
            
            console.log(`✅ Загружено полей: ${loadedCount}`);
            this.showKeyFields();
            
            return this.fieldMappings;
        } catch (error) {
            console.error('❌ Ошибка загрузки полей:', error.message);
            return new Map();
        }
    }

    showKeyFields() {
        console.log('\n🔑 КЛЮЧЕВЫЕ ПОЛЯ ДЛЯ РАБОТЫ:');
        console.log('='.repeat(60));
        
        const keyFields = [
            { id: this.FIELD_IDS.LEAD.TOTAL_CLASSES, name: 'Абонемент занятий:' },
            { id: this.FIELD_IDS.LEAD.USED_CLASSES, name: 'Счетчик занятий:' },
            { id: this.FIELD_IDS.LEAD.REMAINING_CLASSES, name: 'Остаток занятий' },
            { id: this.FIELD_IDS.LEAD.EXPIRATION_DATE, name: 'Окончание абонемента:' },
            { id: this.FIELD_IDS.LEAD.ACTIVATION_DATE, name: 'Дата активации абонемента:' },
            { id: this.FIELD_IDS.LEAD.LAST_VISIT_DATE, name: 'Дата последнего визита:' },
            { id: this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE, name: 'Тип абонемента' },
            { id: this.FIELD_IDS.LEAD.FREEZE, name: 'Заморозка абонемента:' }
        ];
        
        keyFields.forEach(field => {
            const mapping = this.fieldMappings.get(field.id);
            console.log(`   ID ${field.id}: ${field.name} ${mapping ? '✅ Загружено' : '❌ Не найдено'}`);
        });
    }

    async makeRequest(method, endpoint, data = null) {
        const url = `${this.baseUrl}${endpoint}`;
        
        try {
            const config = {
                method: method,
                url: url,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'ArtSchoolAPI/1.0'
                },
                timeout: 30000
            };

            if (data) config.data = data;

            const response = await axios(config);
            return response.data;
        } catch (error) {
            console.error(`❌ Ошибка запроса ${method} ${endpoint}:`);
            if (error.response) {
                console.error(`   📊 Статус: ${error.response.status}`);
                console.error(`   📋 Ответ:`, JSON.stringify(error.response.data, null, 2));
            } else if (error.request) {
                console.error(`   📡 Нет ответа от сервера: ${error.message}`);
            } else {
                console.error(`   ⚠️  Ошибка: ${error.message}`);
            }
            throw error;
        }
    }

  // В классе AmoCrmService - ПЕРЕПИСАТЬ МЕТОД ПОЛНОСТЬЮ
extractSubscriptionInfo(lead) {
    console.log(`\n🔍 EXTRACT для сделки ${lead.id}: "${lead.name}"`);
    console.log('='.repeat(60));
    
    try {
        // 1. БАЗОВАЯ ПРОВЕРКА
        if (!lead || !lead.custom_fields_values) {
            console.log('❌ Нет данных о сделке');
            return this.getDefaultSubscriptionInfo();
        }
        
        const leadName = lead.name || '';
        const customFields = lead.custom_fields_values;
        const pipelineId = lead.pipeline_id;
        const statusId = lead.status_id;
        
        console.log(`📍 Pipeline: ${pipelineId}, Status: ${statusId}`);
        
        // 2. ПРОВЕРЯЕМ, ЧТО СДЕЛКА В ВОРОНКЕ АБОНЕМЕНТОВ
        const isInSubscriptionPipeline = pipelineId === this.SUBSCRIPTION_PIPELINE_ID;
        
        if (!isInSubscriptionPipeline) {
            console.log('❌ Сделка не в воронке абонементов');
            return this.getDefaultSubscriptionInfo();
        }
        
        // 3. ПОЛУЧАЕМ ВСЕ КЛЮЧЕВЫЕ ЗНАЧЕНИЯ
        console.log('\n📊 ПОЛУЧЕНИЕ ЗНАЧЕНИЙ ПОЛЕЙ:');
        
        // 3.1 Абонемент занятий (850241)
        const totalField = customFields.find(f => f.field_id === 850241);
        let totalClasses = 0;
        if (totalField) {
            const totalValue = this.getFieldValue(totalField);
            totalClasses = this.parseNumberFromField(totalValue);
            console.log(`• TOTAL: "${totalValue}" → ${totalClasses}`);
        }
        
        // 3.2 Счетчик занятий (850257)
        const usedField = customFields.find(f => f.field_id === 850257);
        let usedClasses = 0;
        if (usedField) {
            const usedValue = this.getFieldValue(usedField);
            usedClasses = this.parseNumberFromField(usedValue);
            console.log(`• USED: "${usedValue}" → ${usedClasses}`);
        }
        
        // 3.3 Остаток занятий (890163)
        const remainingField = customFields.find(f => f.field_id === 890163);
        let remainingClasses = 0;
        if (remainingField) {
            const remainingValue = this.getFieldValue(remainingField);
            remainingClasses = this.parseNumberFromField(remainingValue);
            console.log(`• REMAINING (field): "${remainingValue}" → ${remainingClasses}`);
        }
        
        // ⚡ КРИТИЧЕСКОЕ: ВСЕГДА ВЫЧИСЛЯЕМ ПРАВИЛЬНЫЙ ОСТАТОК
        const calculatedRemaining = Math.max(0, totalClasses - usedClasses);
        console.log(`⚡ CALCULATED: ${totalClasses} - ${usedClasses} = ${calculatedRemaining}`);
        
        // Используем вычисленный остаток, если он отличается
        if (remainingClasses !== calculatedRemaining) {
            console.log(`⚡ ИСПРАВЛЯЕМ: ${remainingClasses} → ${calculatedRemaining}`);
            remainingClasses = calculatedRemaining;
        }
        
        // 3.4 Тип абонемента (891007)
        const typeField = customFields.find(f => f.field_id === 891007);
        let subscriptionType = '';
        if (typeField) {
            subscriptionType = this.getFieldValue(typeField);
            console.log(`• TYPE: "${subscriptionType}"`);
        }
        
        // 3.5 Заморозка (867693)
        const freezeField = customFields.find(f => f.field_id === 867693);
        let isFrozen = false;
        if (freezeField) {
            const freezeValue = this.getFieldValue(freezeField);
            isFrozen = freezeValue === 'ДА' || freezeValue === 'Да' || freezeValue === 'true';
            console.log(`• FREEZE: "${freezeValue}" → ${isFrozen ? 'Да' : 'Нет'}`);
        }
        
        // 3.6 Даты
        const activationField = customFields.find(f => f.field_id === 851565);
        const expirationField = customFields.find(f => f.field_id === 850255);
        const lastVisitField = customFields.find(f => f.field_id === 850259);
        
        let activationDate = activationField ? this.parseDate(this.getFieldValue(activationField)) : null;
        let expirationDate = expirationField ? this.parseDate(this.getFieldValue(expirationField)) : null;
        let lastVisitDate = lastVisitField ? this.parseDate(this.getFieldValue(lastVisitField)) : null;
        
        console.log(`• ACTIVATION: ${activationDate}`);
        console.log(`• EXPIRATION: ${expirationDate}`);
        console.log(`• LAST VISIT: ${lastVisitDate}`);
        
        // 4. ОПРЕДЕЛЕНИЕ, ЕСТЬ ЛИ АБОНЕМЕНТ
        const hasSubscription = totalClasses > 0 && totalClasses > 0; // Должно быть положительное количество занятий
        
        console.log(`\n📊 ИТОГО:`);
        console.log(`   • totalClasses: ${totalClasses}`);
        console.log(`   • usedClasses: ${usedClasses}`);
        console.log(`   • remainingClasses: ${remainingClasses}`);
        console.log(`   • hasSubscription: ${hasSubscription ? '✅ Да' : '❌ Нет'}`);
        console.log(`   • isFrozen: ${isFrozen ? '✅ Да' : '❌ Нет'}`);
        console.log(`   • isInPipeline: ${isInSubscriptionPipeline ? '✅ Да' : '❌ Нет'}`);
        
        if (!hasSubscription) {
            console.log('❌ Нет данных об абонементе');
            return this.getDefaultSubscriptionInfo();
        }
        
        // 5. ОПРЕДЕЛЕНИЕ АКТИВНОСТИ - КРИТИЧЕСКИЙ АЛГОРИТМ
        let subscriptionActive = false;
        let subscriptionStatus = '';
        let subscriptionBadge = 'secondary';
        
        console.log('\n🎯 ОПРЕДЕЛЕНИЕ АКТИВНОСТИ:');
        
        // 5.1 Если заморожен - НЕ активен
        if (isFrozen) {
            subscriptionStatus = `Заморожен (осталось ${remainingClasses} занятий)`;
            subscriptionBadge = 'warning';
            subscriptionActive = false;
            console.log(`   • Заморожен: НЕ активен`);
        }
        // 5.2 Если остались занятия и сделка в воронке абонементов
        else if (remainingClasses > 0 && isInSubscriptionPipeline) {
            // Проверяем статусы сделки
            const activeStatuses = [65473306, 142, 143, 60025747]; // Активные статусы
            
            if (activeStatuses.includes(statusId)) {
                subscriptionStatus = `Активный (осталось ${remainingClasses} занятий)`;
                subscriptionBadge = 'success';
                subscriptionActive = true;
                console.log(`   • Status ${statusId} в активных: АКТИВЕН`);
            } else {
                subscriptionStatus = `Неактивный (статус ${statusId}, осталось ${remainingClasses} занятий)`;
                subscriptionBadge = 'secondary';
                subscriptionActive = false;
                console.log(`   • Status ${statusId} не в активных: НЕ активен`);
            }
        }
        // 5.3 Если занятия закончились
        else if (remainingClasses === 0 && totalClasses > 0) {
            subscriptionStatus = `Использован (${usedClasses}/${totalClasses} занятий)`;
            subscriptionBadge = 'secondary';
            subscriptionActive = false;
            console.log(`   • Занятия закончились: НЕ активен`);
        }
        // 5.4 Если нет остатка
        else {
            subscriptionStatus = `Нет занятий`;
            subscriptionBadge = 'secondary';
            subscriptionActive = false;
            console.log(`   • Нет остатка занятий: НЕ активен`);
        }
        
        // 6. ПРОВЕРКА СРОКА ДЕЙСТВИЯ
        if (expirationDate) {
            const today = new Date().toISOString().split('T')[0];
            
            if (expirationDate < today && subscriptionActive) {
                console.log(`⚠️  Абонемент просрочен! ${expirationDate} < ${today}`);
                subscriptionStatus = `Просрочен (истек ${this.formatDateDisplay(expirationDate)})`;
                subscriptionBadge = 'danger';
                subscriptionActive = false;
            }
        }
        
        console.log(`\n✅ РЕЗУЛЬТАТ:`);
        console.log(`   • subscriptionActive: ${subscriptionActive}`);
        console.log(`   • subscriptionStatus: ${subscriptionStatus}`);
        
        return {
            hasSubscription: true,
            totalClasses: totalClasses,
            usedClasses: usedClasses,
            remainingClasses: remainingClasses,
            subscriptionType: subscriptionType,
            subscriptionActive: subscriptionActive,
            activationDate: activationDate,
            expirationDate: expirationDate,
            lastVisitDate: lastVisitDate,
            subscriptionStatus: subscriptionStatus,
            subscriptionBadge: subscriptionBadge,
            isFrozen: isFrozen,
            isInSubscriptionPipeline: isInSubscriptionPipeline,
            pipelineId: pipelineId,
            statusId: statusId,
            leadId: lead.id,
            leadName: lead.name
        };
        
    } catch (error) {
        console.error('❌ Ошибка в extractSubscriptionInfo:', error);
        return this.getDefaultSubscriptionInfo();
    }
}

        // ==================== ТЕСТ ПАРСИНГА СДЕЛКИ ====================
    async debugLeadParsing(leadId) {
        try {
            console.log(`\n🔍 ТЕСТ ПАРСИНГА СДЕЛКИ ${leadId}`);
            console.log('='.repeat(80));
            
            const lead = await this.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}?with=custom_fields_values`
            );
            
            if (!lead) {
                console.log('❌ Сделка не найдена');
                return null;
            }
            
            console.log(`📋 Сделка: "${lead.name}"`);
            console.log(`📍 Pipeline: ${lead.pipeline_id}, Status: ${lead.status_id}`);
            
            const customFields = lead.custom_fields_values || [];
            console.log(`📊 Полей в сделке: ${customFields.length}`);
            
            // Ключевые поля для проверки
            const keyFields = [
                { id: 850241, name: 'Абонемент занятий:' },
                { id: 850257, name: 'Счетчик занятий:' },
                { id: 890163, name: 'Остаток занятий' },
                { id: 851565, name: 'Дата активации:' },
                { id: 850255, name: 'Дата окончания:' },
                { id: 891007, name: 'Тип абонемента' },
                { id: 867693, name: 'Заморозка' }
            ];
            
            console.log('\n🔑 КЛЮЧЕВЫЕ ПОЛЯ:');
            keyFields.forEach(fieldDef => {
                const field = customFields.find(f => (f.field_id || f.id) === fieldDef.id);
                if (field) {
                    const rawValue = field.values?.[0];
                    const parsedValue = this.getFieldValue(field);
                    const numericValue = this.parseNumberFromField(parsedValue);
                    
                    console.log(`\n${fieldDef.name} (ID: ${fieldDef.id}):`);
                    console.log(`   📦 Сырые данные:`, JSON.stringify(rawValue));
                    console.log(`   📝 Парсинг: "${parsedValue}"`);
                    console.log(`   🔢 Число: ${numericValue}`);
                    console.log(`   🏷️  Тип поля: ${field.field_type || field.type}`);
                    if (rawValue?.enum_id) console.log(`   🆔 Enum ID: ${rawValue.enum_id}`);
                } else {
                    console.log(`\n${fieldDef.name}: ❌ НЕ НАЙДЕНО`);
                }
            });
            
            // Показываем ВСЕ поля для отладки
            console.log('\n📋 ВСЕ ПОЛЯ СДЕЛКИ:');
            customFields.slice(0, 10).forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldName = this.fieldMappings.get(fieldId)?.name || `Поле ${fieldId}`;
                const parsedValue = this.getFieldValue(field);
                
                console.log(`${fieldId}: ${fieldName} = "${parsedValue}"`);
            });
            
            // Тест извлечения абонемента
            console.log('\n🧪 ТЕСТ extractSubscriptionInfo:');
            const subscriptionInfo = this.extractSubscriptionInfo(lead);
            console.log(`   • hasSubscription: ${subscriptionInfo.hasSubscription}`);
            console.log(`   • totalClasses: ${subscriptionInfo.totalClasses}`);
            console.log(`   • usedClasses: ${subscriptionInfo.usedClasses}`);
            console.log(`   • remainingClasses: ${subscriptionInfo.remainingClasses}`);
            console.log(`   • subscriptionActive: ${subscriptionInfo.subscriptionActive}`);
            console.log(`   • subscriptionStatus: ${subscriptionInfo.subscriptionStatus}`);
            
            return {
                lead: lead,
                fields: customFields,
                subscriptionInfo: subscriptionInfo
            };
            
        } catch (error) {
            console.error('❌ Ошибка отладки парсинга:', error.message);
            return null;
        }
    }
    // ==================== НОВЫЙ МЕТОД ДЛЯ ПАРСИНГА SELECT-ПОЛЕЙ ====================
    parseNumberFromSelectField(field) {
        if (!field || !field.values || !Array.isArray(field.values) || field.values.length === 0) {
            return 0;
        }
        
        try {
            // Для select-полей значения хранятся в enum_id или value
            const firstValue = field.values[0];
            
            if (firstValue.enum_id !== undefined) {
                // Это select-поле с enum_id
                // Маппинг enum_id → количество занятий
                const enumMapping = {
                    // enum_id для поля "Абонемент занятий:"
                    504035: 8,    // "8 занятий"
                    504037: 16,   // "16 занятий"
                    504039: 4,    // "4 занятия"
                    504041: 1,    // "1 занятие"
                    504043: 2,    // "2 занятия"
                    504045: 3,    // "3 занятия"
                    504047: 24,   // "24 занятия"
                    
                    // enum_id для поля "Счетчик занятий:"
                    504105: 1,    // "1"
                    504107: 2,    // "2"
                    504109: 3,    // "3"
                    504111: 4,    // "4"
                    504113: 5,    // "5"
                    504115: 6,    // "6"
                    504117: 7,    // "7"
                    504119: 8,    // "8"
                    504121: 9,    // "9"
                    504123: 10,   // "10"
                    504125: 11,   // "11"
                    504127: 12,   // "12"
                    504129: 13,   // "13"
                    504131: 14,   // "14"
                    504133: 15,   // "15"
                    504135: 16    // "16"
                };
                
                return enumMapping[firstValue.enum_id] || 0;
            } else if (firstValue.value !== undefined) {
                // Прямое значение
                return this.parseNumberFromField(firstValue.value);
            }
            
            return 0;
            
        } catch (error) {
            console.error('❌ Ошибка парсинга select-поля:', error);
            return 0;
        }
    }

   getDefaultSubscriptionInfo() {
    return {
        hasSubscription: false,
        totalClasses: 0,
        usedClasses: 0,
        remainingClasses: 0,
        subscriptionType: '',
        subscriptionActive: false,
        activationDate: null,
        expirationDate: null,
        lastVisitDate: null,
        subscriptionStatus: 'Нет абонемента',
        subscriptionBadge: 'inactive',
        isFrozen: false,
        isInSubscriptionPipeline: false,
        pipelineId: null,
        statusId: null,
        leadId: null,
        leadName: null
    };
}

    getNumberFromField(customFields, fieldId) {
        const field = customFields.find(f => (f.field_id || f.id) === fieldId);
        if (!field) return 0;
        
        const value = this.getFieldValue(field);
        return this.parseNumberFromField(value);
    }

    getFieldValueFromFields(customFields, fieldId) {
        const field = customFields.find(f => (f.field_id || f.id) === fieldId);
        if (!field) return '';
        return this.getFieldValue(field);
    }

parseNumberFromField(value) {
    if (!value && value !== 0) {
        return 0;
    }
    
    try {
        if (typeof value === 'number') {
            return value;
        }
        
        const str = String(value).trim();
        
        if (str === '' || str === 'null' || str === 'undefined' || str === '-') {
            return 0;
        }
        
        // Ищем первое число в строке
        const match = str.match(/\d+/);
        if (match) {
            const num = parseInt(match[0]);
            return isNaN(num) ? 0 : num;
        }
        
        // Для текстовых значений
        const lowerStr = str.toLowerCase();
        if (lowerStr === 'разовый' || lowerStr === 'один') return 1;
        if (lowerStr === 'да' || lowerStr === 'true' || lowerStr === 'yes') return 1;
        if (lowerStr === 'нет' || lowerStr === 'false' || lowerStr === 'no') return 0;
        
        // Пытаемся преобразовать как число
        const parsed = parseFloat(str);
        return isNaN(parsed) ? 0 : parsed;
        
    } catch (error) {
        console.error(`❌ Ошибка парсинга числа:`, error);
        return 0;
    }
}
// Добавьте этот метод в класс AmoCrmService
isSubscriptionActive(subscriptionInfo) {
    // Активные статусы из диагностики
    const ACTIVE_STATUS_IDS = [142, 143]; // Из результатов диагностики
    
    return subscriptionInfo.remainingClasses > 0 && 
           ACTIVE_STATUS_IDS.includes(subscriptionInfo.statusId) &&
           subscriptionInfo.isInSubscriptionPipeline &&
           !subscriptionInfo.isFrozen;
}
   getFieldValue(field) {
    try {
        if (!field || !field.values || !Array.isArray(field.values) || field.values.length === 0) {
            return '';
        }
        
        const firstValue = field.values[0];
        
        if (firstValue === null || firstValue === undefined) {
            return '';
        }
        
        // Для select-полей
        if (field.field_type === 'select' || field.type === 'select') {
            if (firstValue.value !== undefined && firstValue.value !== null) {
                return String(firstValue.value).trim();
            } else if (firstValue.enum_id !== undefined) {
                // Маппинг enum_id → текстовое значение
                const enumMapping = {
                    504033: '4 занятия',
                    504035: '8 занятий', 
                    504037: '16 занятий',
                    504039: 'Продвинутый 4 занятия',
                    504041: 'Разовый',
                    504043: '2 занятия',
                    504045: '3 занятия',
                    504047: '24 занятия',
                    504237: 'База Блок № 1 - 5 занятий',
                    504241: 'База Блок № 3 - 5 занятий',
                    504243: 'База - 16 занятий',
                    504049: '8-10 лет',
                    504105: '1',
                    504107: '2',
                    504109: '3',
                    504111: '4',
                    504113: '5',
                    504115: '6',
                    504117: '7',
                    504119: '8',
                    504121: '9',
                    504123: '10',
                    504125: '11',
                    504127: '12',
                    504129: '13',
                    504131: '14',
                    504133: '15',
                    504135: '16',
                    554163: 'Первичный',
                    554165: 'Повторный',
                    527317: 'НЕТ',
                    527319: 'ДА'
                };
                
                const textValue = enumMapping[firstValue.enum_id];
                return textValue || String(firstValue.enum_id);
            }
        }
        
        // Для остальных типов полей
        if (typeof firstValue === 'string') {
            return firstValue.trim();
        } else if (typeof firstValue === 'number') {
            return String(firstValue);
        } else if (typeof firstValue === 'object' && firstValue !== null) {
            if (firstValue.value !== undefined && firstValue.value !== null) {
                return String(firstValue.value).trim();
            }
        }
        
        return String(firstValue).trim();
        
    } catch (error) {
        console.error('❌ Ошибка получения значения поля:', error);
        return '';
    }
}
    parseDate(value) {
        if (!value) return null;
        
        try {
            const dateStr = String(value).trim();
            
            if (/^\d+$/.test(dateStr)) {
                const timestamp = parseInt(dateStr);
                const date = timestamp < 10000000000 
                    ? new Date(timestamp * 1000)
                    : new Date(timestamp);
                
                return date.toISOString().split('T')[0];
            }
            
            if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
                const parts = dateStr.split('.');
                const day = parts[0].padStart(2, '0');
                const month = parts[1].padStart(2, '0');
                const year = parts[2];
                
                return `${year}-${month}-${day}`;
            }
            
            if (dateStr.match(/^\d{4}-\d{1,2}-\d{1,2}$/)) {
                const parts = dateStr.split('-');
                return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            }
            
            return dateStr;
            
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error);
            return value;
        }
    }

    // ==================== ДИАГНОСТИЧЕСКИЙ МЕТОД ДЛЯ ТЕСТИРОВАНИЯ ====================
    async testSpecificLead(leadId) {
        try {
            console.log(`\n🧪 ТЕСТ СДЕЛКИ ${leadId}`);
            console.log('='.repeat(80));
            
            // Получаем сделку
            const lead = await this.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}?with=custom_fields_values`
            );
            
            if (!lead) {
                console.log('❌ Сделка не найдена');
                return null;
            }
            
            // Анализируем
            const subscriptionInfo = this.extractSubscriptionInfo(lead);
            
            // Выводим детали
            console.log(`\n📋 СДЕЛКА: "${lead.name}"`);
            console.log(`📌 ID: ${lead.id}`);
            console.log(`📍 Pipeline: ${lead.pipeline_id} (ожидается: ${this.SUBSCRIPTION_PIPELINE_ID})`);
            console.log(`📍 Status: ${lead.status_id}`);
            
            console.log(`\n🎯 ИНФОРМАЦИЯ ОБ АБОНЕМЕНТЕ:`);
            console.log(`   • Найден абонемент: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Всего занятий: ${subscriptionInfo.totalClasses}`);
            console.log(`   • Использовано: ${subscriptionInfo.usedClasses}`);
            console.log(`   • Осталось: ${subscriptionInfo.remainingClasses}`);
            console.log(`   • Тип: ${subscriptionInfo.subscriptionType}`);
            console.log(`   • Заморожен: ${subscriptionInfo.isFrozen ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Воронка абонемента: ${subscriptionInfo.isInSubscriptionPipeline ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Активен: ${subscriptionInfo.subscriptionActive ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Статус: ${subscriptionInfo.subscriptionStatus}`);
            
            // Анализируем ВСЕ поля
            const customFields = lead.custom_fields_values || [];
            console.log(`\n🔍 ВСЕ КЛЮЧЕВЫЕ ПОЛЯ:`);
            
            const keyFields = [
                { id: this.FIELD_IDS.LEAD.TOTAL_CLASSES, name: 'Абонемент занятий:' },
                { id: this.FIELD_IDS.LEAD.USED_CLASSES, name: 'Счетчик занятий:' },
                { id: this.FIELD_IDS.LEAD.REMAINING_CLASSES, name: 'Остаток занятий' },
                { id: this.FIELD_IDS.LEAD.FREEZE, name: 'Заморозка абонемента:' },
                { id: this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE, name: 'Тип абонемента' },
                { id: this.FIELD_IDS.LEAD.ACTIVATION_DATE, name: 'Дата активации абонемента:' },
                { id: this.FIELD_IDS.LEAD.LAST_VISIT_DATE, name: 'Дата последнего визита:' }
            ];
            
            keyFields.forEach(fieldDef => {
                const field = customFields.find(f => (f.field_id || f.id) === fieldDef.id);
                if (field) {
                    const value = this.getFieldValue(field);
                    console.log(`   • ${fieldDef.name}: "${value}"`);
                } else {
                    console.log(`   • ${fieldDef.name}: ❌ Не найдено`);
                }
            });
            
            return {
                lead: lead,
                subscriptionInfo: subscriptionInfo
            };
            
        } catch (error) {
            console.error('❌ Ошибка теста:', error.message);
            return null;
        }
    }

    // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ДИАГНОСТИКИ ВСЕХ АКТИВНЫХ АБОНЕМЕНТОВ ====================

    // Извлечение имени ученика из названия сделки
    extractStudentNameFromLead(leadName) {
        if (!leadName) return 'Не найден';
        
        try {
            // Убираем лишние части
            const cleaned = leadName
                .replace(/-\s*\d+\s*занят.*/gi, '') // "- 8 занятий"
                .replace(/\(\d+\s*занят.*\)/gi, '')  // "(8 занятий)"
                .replace(/Абонемент\s*\d+\s*занят.*:\s*/gi, '') // "Абонемент 8 занятий: "
                .replace(/разовый/gi, '')
                .replace(/истек/gi, '')
                .replace(/закончился/gi, '')
                .replace(/заморозка/gi, '')
                .trim();
            
            // Ищем ФИО (русские буквы, минимум 2 слова)
            const nameMatch = cleaned.match(/[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+/);
            if (nameMatch) return nameMatch[0];
            
            // Пытаемся извлечь из паттернов
            const patterns = [
                /^(.+?)\s*-\s*\d/,          // "Имя - 8"
                /^(.+?)\s*\(/,              // "Имя ("
                /:\s*(.+)$/                  // ": Имя"
            ];
            
            for (const pattern of patterns) {
                const match = cleaned.match(pattern);
                if (match && match[1]) {
                    const extracted = match[1].trim();
                    if (extracted.length > 3 && !/\d/.test(extracted)) {
                        return extracted;
                    }
                }
            }
            
            return cleaned || 'Не найден';
            
        } catch (error) {
            console.error('Ошибка извлечения имени:', error);
            return 'Ошибка извлечения';
        }
    }

    // Проверка, является ли поле телефоном
    isPhoneField(fieldId) {
        // ID полей телефонов (можно расширить)
        const phoneFieldIds = [
            216615,  // Основной телефон
            850217,  // Дополнительный телефон
            216619   // Еще телефон
        ];
        
        return phoneFieldIds.includes(fieldId);
    }

    // Получение имени статуса
    async getStatusName(statusId) {
        try {
            // Попробуем получить из загруженных данных
            if (this.fieldMappings) {
                // Можно расширить логику для получения имени статуса
                return `Статус ${statusId}`;
            }
            return `ID: ${statusId}`;
        } catch (error) {
            return `ID: ${statusId}`;
        }
    }

    // Извлечение ID всех полей из сделки
    extractFieldIds(customFields) {
        if (!customFields || !Array.isArray(customFields)) return [];
        
        return customFields
            .map(f => f.field_id || f.id)
            .filter(id => id && typeof id === 'number');
    }

    // Получение примеров значений полей
    getFieldExamples(customFields) {
        if (!customFields || !Array.isArray(customFields)) return {};
        
        const examples = {};
        
        // Ключевые поля для примеров
        const keyFields = [850241, 850257, 890163, 850255, 851565, 891007, 867693];
        
        keyFields.forEach(fieldId => {
            const field = customFields.find(f => (f.field_id || f.id) === fieldId);
            if (field) {
                examples[fieldId] = {
                    value: this.getFieldValue(field),
                    type: field.field_type || field.type,
                    enum_id: field.values?.[0]?.enum_id
                };
            }
        });
        
        return examples;
    }
// ==================== ОЦЕНКА СДЕЛКИ ====================
isBestLeadForStudent(lead, studentName, subscriptionInfo) {
    if (!subscriptionInfo.hasSubscription) {
        return false;
    }
    
    let score = 0;
    
    // 1. Точное совпадение имени (+100)
    const nameMatch = this.checkNameMatch(lead.name, studentName);
    if (nameMatch.exact) score += 100;
    else if (nameMatch.partial) score += 50;
    
    // 2. Активный абонемент (+80)
    if (subscriptionInfo.subscriptionActive) score += 80;
    
    // 3. В воронке абонементов (+60)
    if (lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID) score += 60;
    
    // 4. Есть остаток занятий (+ за каждое занятие)
    if (subscriptionInfo.remainingClasses > 0) {
        score += subscriptionInfo.remainingClasses * 5;
    }
    
    // 5. Активный статус (+40)
    if ([65473306, 142, 143, 60025747].includes(lead.status_id)) score += 40;
    
    // 6. Не заморожен (+30)
    if (!subscriptionInfo.isFrozen) score += 30;
    
    // 7. Свежесть сделки
    const daysAgo = Math.floor((Date.now() - (lead.updated_at * 1000)) / (1000 * 60 * 60 * 24));
    if (daysAgo < 30) score += 30;
    else if (daysAgo < 90) score += 15;
    else if (daysAgo < 180) score += 5;
    
    // 8. Штрафы
    if (lead.name.toLowerCase().includes('истек') || lead.name.toLowerCase().includes('закончился')) {
        score -= 40;
    }
    
    if (lead.name.toLowerCase().includes('разовый')) {
        score -= 20;
    }
    
    console.log(`   📊 Оценка "${lead.name}": ${score} баллов`);
    
    return score >= 150; // Порог для "лучшего кандидата"
}
        // ==================== ОЦЕНКА КАЧЕСТВА СДЕЛКИ ====================
    evaluateLeadQuality(lead, subscriptionInfo, studentName, currentScore, bestScore, bestSubscriptionInfo, bestLead) {
        // Если это первая сделка с абонементом
        if (!bestLead) return true;
        
        console.log(`\n   🔍 СРАВНЕНИЕ С ЛУЧШЕЙ СДЕЛКОЙ:`);
        console.log(`      Текущая: "${lead.name}" (${currentScore} баллов)`);
        console.log(`      Лучшая:  "${bestLead.name}" (${bestScore} баллов)`);
        
        // 1. Сначала проверяем точное совпадение имени
        const currentNameMatch = this.checkNameMatch(lead.name, studentName);
        const bestNameMatch = this.checkNameMatch(bestLead.name, studentName);
        
        if (currentNameMatch.exact && !bestNameMatch.exact) {
            console.log(`      ⭐ ТОЧНОЕ СОВПАДЕНИЕ ИМЕНИ - ВЫБИРАЕМ ЭТУ!`);
            return true;
        }
        
        if (!currentNameMatch.exact && bestNameMatch.exact) {
            console.log(`      ⭐ У ЛУЧШЕЙ ЕСТЬ ТОЧНОЕ СОВПАДЕНИЕ - ОСТАВЛЯЕМ ЕЕ`);
            return false;
        }
        
        // 2. Приоритет: сделки в воронке абонементов
        const currentInPipeline = lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID;
        const bestInPipeline = bestLead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID;
        
        if (currentInPipeline && !bestInPipeline) {
            console.log(`      ⭐ В ВОРОНКЕ АБОНЕМЕНТОВ - ВЫБИРАЕМ ЭТУ!`);
            return true;
        }
        
        if (!currentInPipeline && bestInPipeline) {
            console.log(`      ⭐ ЛУЧШАЯ В ВОРОНКЕ - ОСТАВЛЯЕМ ЕЕ`);
            return false;
        }
        
        // 3. Приоритет: активные абонементы
        const currentActive = subscriptionInfo.subscriptionActive;
        const bestActive = bestSubscriptionInfo?.subscriptionActive || false;
        
        if (currentActive && !bestActive) {
            console.log(`      ⭐ АКТИВНЫЙ АБОНЕМЕНТ - ВЫБИРАЕМ ЭТУ!`);
            return true;
        }
        
        if (!currentActive && bestActive) {
            console.log(`      ⭐ ЛУЧШАЯ АКТИВНА - ОСТАВЛЯЕМ ЕЕ`);
            return false;
        }
        
        // 4. Приоритет: больше остаток занятий
        const currentRemaining = subscriptionInfo.remainingClasses || 0;
        const bestRemaining = bestSubscriptionInfo?.remainingClasses || 0;
        
        if (currentRemaining > bestRemaining) {
            console.log(`      ⭐ БОЛЬШЕ ОСТАТОК ЗАНЯТИЙ (${currentRemaining} > ${bestRemaining}) - ВЫБИРАЕМ ЭТУ!`);
            return true;
        }
        
        // 5. Приоритет: более свежая сделка
        const currentDate = new Date(lead.updated_at * 1000);
        const bestDate = new Date(bestLead.updated_at * 1000);
        const daysDifference = Math.floor((currentDate - bestDate) / (1000 * 60 * 60 * 24));
        
        if (currentDate > bestDate && currentScore >= bestScore * 0.8) {
            // Если сделка новее и оценка не сильно хуже
            console.log(`      ⭐ СВЕЖАЯ СДЕЛКА (на ${daysDifference} дней) - ВЫБИРАЕМ ЭТУ!`);
            return true;
        }
        
        // 6. Если все критерии равны - по оценке
        if (currentScore > bestScore) {
            console.log(`      ⭐ БОЛЬШЕ БАЛЛОВ (${currentScore} > ${bestScore}) - ВЫБИРАЕМ ЭТУ!`);
            return true;
        }
        
        console.log(`      ❌ ОСТАВЛЯЕМ ПРЕЖНЮЮ ЛУЧШУЮ СДЕЛКУ`);
        return false;
    }
    // Генерация рекомендаций по конфигурации
    generateConfigurationRecommendations(subscriptionInfo, lead) {
        const recommendations = [];
        
        if (!subscriptionInfo.activationDate) {
            recommendations.push('Добавить парсинг поля "Дата активации абонемента:" (851565)');
        }
        
        if (!subscriptionInfo.expirationDate) {
            recommendations.push('Добавить парсинг поля "Окончание абонемента:" (850255)');
        }
        
        if (subscriptionInfo.totalClasses === 0) {
            recommendations.push('Проверить парсинг поля "Абонемент занятий:" (850241)');
        }
        
        // Проверяем целостность данных
        if (subscriptionInfo.totalClasses > 0 && 
            subscriptionInfo.usedClasses + subscriptionInfo.remainingClasses !== subscriptionInfo.totalClasses) {
            recommendations.push('Добавить логику пересчета остатка занятий');
        }
        
        return recommendations;
    }

    // Проверка наличия всех обязательных полей
    hasAllRequiredFields(customFields) {
        const requiredFields = [850241, 850257]; // Абонемент занятий, Счетчик занятий
        
        return requiredFields.every(fieldId => 
            customFields?.some(f => (f.field_id || f.id) === fieldId)
        );
    }

    // Расчет качества данных
    calculateDataQualityScore(customFields) {
        if (!customFields) return 0;
        
        const keyFields = [
            { id: 850241, weight: 30 }, // Абонемент занятий
            { id: 850257, weight: 25 }, // Счетчик занятий
            { id: 890163, weight: 20 }, // Остаток занятий
            { id: 851565, weight: 15 }, // Дата активации
            { id: 850255, weight: 10 }  // Дата окончания
        ];
        
        let score = 0;
        let maxScore = 0;
        
        keyFields.forEach(field => {
            maxScore += field.weight;
            const exists = customFields.some(f => (f.field_id || f.id) === field.id);
            if (exists) score += field.weight;
        });
        
        return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    }

    // Расчет дней с момента активации
    calculateDaysSince(dateString) {
        if (!dateString) return null;
        
        try {
            const activationDate = new Date(dateString);
            const today = new Date();
            const diffTime = today.getTime() - activationDate.getTime();
            return Math.floor(diffTime / (1000 * 60 * 60 * 24));
        } catch (error) {
            return null;
        }
    }

    // Расчет дней до окончания
    calculateDaysUntil(dateString) {
        if (!dateString) return null;
        
        try {
            const expirationDate = new Date(dateString);
            const today = new Date();
            const diffTime = expirationDate.getTime() - today.getTime();
            return Math.floor(diffTime / (1000 * 60 * 60 * 24));
        } catch (error) {
            return null;
        }
    }

    // Генерация рекомендаций по настройке системы
    generateSetupRecommendations(summary, activeSubscriptions) {
        const recommendations = [];
        
        // Анализ типов абонементов
        const subscriptionTypes = Object.keys(summary.subscription_types);
        if (subscriptionTypes.length > 1) {
            const mostCommonType = Object.entries(summary.subscription_types)
                .sort((a, b) => b[1] - a[1])[0][0];
            
            recommendations.push(`Самый частый тип абонемента: "${mostCommonType}" (${summary.subscription_types[mostCommonType]} случаев)`);
        }
        
        // Анализ количества занятий
        const mostCommonClasses = Object.entries(summary.class_distribution)
            .filter(([_, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])[0];
        
        if (mostCommonClasses) {
            recommendations.push(`Самый частый абонемент: ${mostCommonClasses[0]} (${mostCommonClasses[1]} случаев)`);
        }
        
        // Проблемы с данными
        if (summary.problematic_cases.length > 0) {
            const problemPercentage = (summary.problematic_cases.length / summary.active_subscriptions_found * 100).toFixed(1);
            recommendations.push(`Обнаружены проблемы в ${problemPercentage}% активных абонементов`);
        }
        
        // Рекомендации по настройке парсинга
        const firstActive = activeSubscriptions[0];
        if (firstActive) {
            recommendations.push(`Пример для настройки: сделка ${firstActive.lead.id} (${firstActive.student.name})`);
            recommendations.push(`ID поля "Абонемент занятий:": 850241`);
            recommendations.push(`ID поля "Счетчик занятий:": 850257`);
            recommendations.push(`ID поля "Остаток занятий": 890163`);
            recommendations.push(`ID поля "Дата активации": 851565`);
            recommendations.push(`ID поля "Дата окончания": 850255`);
        }
        
        // Рекомендации по логике
        recommendations.push('Добавить пересчет остатка занятий: total - used = remaining');
        recommendations.push('Проверять статус сделки: должен быть активным в воронке абонементов');
        recommendations.push('Проверять дату окончания: абонемент активен если не истек');
        
        return recommendations;
    }

    
    
    // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ ДИАГНОСТИКИ ====================

    // Получение описания паттерна заполнения
    getPatternDescription(fieldPresence) {
        const descriptions = [];
        
        if (fieldPresence.total_classes) descriptions.push('Абонемент занятий');
        if (fieldPresence.used_classes) descriptions.push('Счетчик занятий');
        if (fieldPresence.remaining_classes) descriptions.push('Остаток занятий');
        if (fieldPresence.expiration_date) descriptions.push('Дата окончания');
        if (fieldPresence.activation_date) descriptions.push('Дата активации');
        if (fieldPresence.subscription_type) descriptions.push('Тип абонемента');
        if (fieldPresence.freeze) descriptions.push('Заморозка');
        
        const missing = [];
        if (!fieldPresence.total_classes) missing.push('Абонемент занятий');
        if (!fieldPresence.used_classes) missing.push('Счетчик занятий');
        if (!fieldPresence.remaining_classes) missing.push('Остаток занятий');
        
        let result = `Заполнено: ${descriptions.join(', ')}`;
        if (missing.length > 0) {
            result += ` | Отсутствуют: ${missing.join(', ')}`;
        }
        
        return result;
    }

    // Проверка целостности данных для сделки
    checkDataIntegrityForLead(fieldValues) {
        const problems = [];
        
        // Проверяем, что если есть total_classes, то должны быть used_classes и remaining_classes
        if (fieldValues.total_classes && (!fieldValues.used_classes || !fieldValues.remaining_classes)) {
            problems.push({
                type: 'INCOMPLETE_DATA',
                message: `Есть "Абонемент занятий: ${fieldValues.total_classes}", но нет счетчика или остатка`
            });
        }
        
        // Проверяем логику total = used + remaining
        if (fieldValues.total_classes && fieldValues.used_classes && fieldValues.remaining_classes) {
            const total = this.parseNumberFromField(fieldValues.total_classes);
            const used = this.parseNumberFromField(fieldValues.used_classes);
            const remaining = this.parseNumberFromField(fieldValues.remaining_classes);
            
            if (total !== used + remaining) {
                problems.push({
                    type: 'DATA_INTEGRITY',
                    message: `Некорректная сумма: ${used} + ${remaining} ≠ ${total}`,
                    expected: total,
                    actual: used + remaining
                });
            }
        }
        
        // Проверяем даты
        if (fieldValues.activation_date && fieldValues.expiration_date) {
            const activation = new Date(this.parseDate(fieldValues.activation_date));
            const expiration = new Date(this.parseDate(fieldValues.expiration_date));
            
            if (activation > expiration) {
                problems.push({
                    type: 'DATE_ORDER',
                    message: `Дата активации позже даты окончания`
                });
            }
        }
        
        return {
            hasProblems: problems.length > 0,
            problems: problems
        };
    }

    // Анализ названия сделки для хранения
    analyzeLeadNameForStorage(leadName) {
        const patterns = [
            {
                pattern: 'NAME - N занятий',
                regex: /^(.+?)\s*-\s*(\d+)\s*занят/i,
                description: 'ФИО - N занятий',
                extract: (match) => ({
                    student_name: match[1].trim(),
                    class_count: parseInt(match[2])
                })
            },
            {
                pattern: 'NAME (N занятий)',
                regex: /^(.+?)\s*\((\d+)\s*занят/i,
                description: 'ФИО (N занятий)',
                extract: (match) => ({
                    student_name: match[1].trim(),
                    class_count: parseInt(match[2])
                })
            },
            {
                pattern: 'Абонемент N занятий: NAME',
                regex: /^Абонемент\s*(\d+)\s*занят.*:\s*(.+)/i,
                description: 'Абонемент N занятий: ФИО',
                extract: (match) => ({
                    student_name: match[2].trim(),
                    class_count: parseInt(match[1])
                })
            },
            {
                pattern: 'Закончился N занятий - NAME',
                regex: /^Закончился\s*(\d+)\s*занят.*-\s*(.+)/i,
                description: 'Закончился N занятий - ФИО',
                extract: (match) => ({
                    student_name: match[2].trim(),
                    class_count: parseInt(match[1])
                })
            },
            {
                pattern: 'NAME и NAME - N занятий',
                regex: /^(.+?)\s+и\s+(.+?)\s*-\s*(\d+)\s*занят/i,
                description: 'ФИО и ФИО - N занятий',
                extract: (match) => ({
                    student_name: `${match[1].trim()} и ${match[2].trim()}`,
                    class_count: parseInt(match[3])
                })
            }
        ];
        
        for (const pattern of patterns) {
            const match = leadName.match(pattern.regex);
            if (match) {
                const extracted = pattern.extract(match);
                return {
                    pattern: pattern.pattern,
                    description: pattern.description,
                    student_name: extracted.student_name,
                    class_count: extracted.class_count
                };
            }
        }
        
        // Если не нашли стандартный паттерн, анализируем структуру
        const words = leadName.split(/\s+/);
        const hasNumber = words.some(word => /\d+/.test(word));
        const hasZanyatiy = leadName.toLowerCase().includes('занят');
        
        return {
            pattern: 'CUSTOM',
            description: hasNumber && hasZanyatiy ? 'Кастомный с числом занятий' : 'Нестандартный формат',
            student_name: null,
            class_count: null
        };
    }

    // Определение типичной конфигурации для статуса
    getTypicalConfiguration(fieldPresence) {
        const presentFields = Object.keys(fieldPresence).filter(k => fieldPresence[k]);
        return presentFields.join(', ');
    }

    // Проверка, является ли абонемент активным
    isActiveSubscription(statusId, fieldValues) {
        // Активные статусы из диагностики: 65473306, 142 (нужно уточнить)
        const activeStatusIds = [65473306, 142]; // Добавьте правильные ID
        
        if (!activeStatusIds.includes(parseInt(statusId))) {
            return false;
        }
        
        // Проверяем, есть ли остаток занятий
        if (fieldValues.remaining_classes) {
            const remaining = this.parseNumberFromField(fieldValues.remaining_classes);
            if (remaining > 0) {
                return true;
            }
        }
        
        return false;
    }

    // Может ли сделка быть выбрана как активный абонемент
    canBeSelectedAsActive(lead, fieldValues) {
        // Проверяем основные критерии
        const checks = [];
        
        // 1. В правильной воронке
        checks.push({
            name: 'Воронка абонементов',
            passed: lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID,
            weight: 100
        });
        
        // 2. Активный статус
        const activeStatusIds = [65473306, 142];
        checks.push({
            name: 'Активный статус',
            passed: activeStatusIds.includes(parseInt(lead.status_id)),
            weight: 80
        });
        
        // 3. Есть общее количество занятий
        checks.push({
            name: 'Указано общее кол-во занятий',
            passed: !!fieldValues.total_classes,
            weight: 60
        });
        
        // 4. Есть остаток занятий
        if (fieldValues.remaining_classes) {
            const remaining = this.parseNumberFromField(fieldValues.remaining_classes);
            checks.push({
                name: 'Есть остаток занятий',
                passed: remaining > 0,
                weight: 50,
                details: `Осталось: ${remaining}`
            });
        } else {
            checks.push({
                name: 'Есть остаток занятий',
                passed: false,
                weight: 50
            });
        }
        
        // 5. Не заморожен
        checks.push({
            name: 'Не заморожен',
            passed: !fieldValues.freeze || fieldValues.freeze.toLowerCase() !== 'да',
            weight: 40
        });
        
        // 6. Есть дата активации
        checks.push({
            name: 'Есть дата активации',
            passed: !!fieldValues.activation_date,
            weight: 30
        });
        
        // 7. Есть дата окончания
        checks.push({
            name: 'Есть дата окончания',
            passed: !!fieldValues.expiration_date,
            weight: 20
        });
        
        // Рассчитываем общий балл
        const totalScore = checks.reduce((sum, check) => {
            return sum + (check.passed ? check.weight : 0);
        }, 0);
        
        const maxScore = checks.reduce((sum, check) => sum + check.weight, 0);
        const percentage = (totalScore / maxScore) * 100;
        
        return {
            can_be_selected: percentage >= 70,
            score: totalScore,
            max_score: maxScore,
            percentage: percentage.toFixed(1),
            checks: checks,
            failed_checks: checks.filter(c => !c.passed).map(c => c.name)
        };
    }

    // Генерация рекомендаций на основе анализа
    generateStorageRecommendations(analysis) {
        const recommendations = [];
        
        // Анализируем паттерны заполнения
        const mostCommonPattern = analysis.data_completeness_patterns[0];
        if (mostCommonPattern) {
            const percentage = (mostCommonPattern.count / analysis.total_subscriptions_analyzed * 100).toFixed(1);
            recommendations.push(`Самый частый паттерн заполнения (${percentage}%): ${mostCommonPattern.description}`);
            
            // Если в самом частом паттерне не хватает ключевых полей
            const example = mostCommonPattern.examples[0];
            if (example && example.fields_missing && example.fields_missing.length > 0) {
                recommendations.push(`⚠️ В ${percentage}% сделок отсутствуют: ${example.fields_missing.join(', ')}`);
            }
        }
        
        // Анализируем варианты хранения "Абонемент занятий:"
        const totalClassesVariants = Object.keys(analysis.field_storage_patterns.total_classes).length;
        if (totalClassesVariants > 3) {
            recommendations.push(`Много вариантов записи "Абонемент занятий:" (${totalClassesVariants}). Нужна унификация.`);
        }
        
        // Анализируем проблемы с данными
        if (analysis.data_problems.length > 0) {
            const problemPercentage = (analysis.data_problems.length / analysis.total_subscriptions_analyzed * 100).toFixed(1);
            recommendations.push(`Обнаружены проблемы в данных: ${analysis.data_problems.length} сделок (${problemPercentage}%)`);
        }
        
        // Анализируем рабочие конфигурации
        if (analysis.working_configurations.length > 0) {
            const workingPercentage = (analysis.working_configurations.length / analysis.total_subscriptions_analyzed * 100).toFixed(1);
            recommendations.push(`✅ Полностью заполненные абонементы: ${analysis.working_configurations.length} (${workingPercentage}%)`);
        } else {
            recommendations.push(`🚨 КРИТИЧЕСКО: Нет ни одного полностью заполненного абонемента!`);
        }
        
        // Рекомендации по парсингу на основе анализа
        const totalClassesValues = Object.entries(analysis.field_storage_patterns.total_classes)
            .filter(([value, data]) => data.parsed_as_number === 0 && data.count > 1)
            .map(([value]) => value);
        
        if (totalClassesValues.length > 0) {
            recommendations.push(`Проблемы парсинга "Абонемент занятий:" для значений: ${totalClassesValues.join(', ')}`);
        }
        
        // Рекомендации по выбору активного абонемента
        const activeConfigs = analysis.working_configurations.filter(c => c.can_be_selected);
        if (activeConfigs.length > 0) {
            recommendations.push(`Можно выбирать как активные: ${activeConfigs.length} абонементов`);
        } else {
            recommendations.push(`⚠️ Нет абонементов, которые можно выбрать как активные по текущим критериям`);
        }
        
        return recommendations;
    }
    
async findLeadForStudent(contactId, studentName) {
    console.log(`\n🎯 ИСПРАВЛЕННАЯ ЛОГИКА ПОИСКА: "${studentName}"`);
    console.log('='.repeat(60));
    
    try {
        // 1. Получаем контакт
        const contact = await this.getFullContactInfo(contactId);
        if (!contact) {
            console.log('❌ Контакт не найден');
            return null;
        }
        
        console.log(`📋 Контакт: "${contact.name}"`);
        
        // 2. Извлекаем учеников
        const studentsInContact = this.extractStudentsFromContact(contact);
        console.log(`👥 Ученики в контакте:`);
        studentsInContact.forEach(s => console.log(`   • ${s.studentName}`));
        
        // 3. Ищем нужного ученика
        const targetStudent = studentsInContact.find(s => 
            s.studentName.toLowerCase().includes(studentName.toLowerCase()) ||
            studentName.toLowerCase().includes(s.studentName.toLowerCase())
        );
        
        if (!targetStudent) {
            console.log(`❌ Ученик "${studentName}" не найден в контакте`);
            return null;
        }
        
        console.log(`✅ Найден ученик: "${targetStudent.studentName}"`);
        
        // 4. Получаем ВСЕ сделки
        const leads = await this.getContactLeadsSorted(contactId);
        console.log(`📊 Всего сделок у контакта: ${leads.length}`);
        
        if (leads.length === 0) {
            console.log('❌ Нет сделок у контакта');
            return null;
        }
        
        // 5. Фильтруем сделки - ТОЛЬКО те, которые принадлежат ученику
        const studentLeads = [];
        const otherLeads = [];
        
        for (const lead of leads) {
            const isForThisStudent = this.isLeadForStudent(lead, targetStudent.studentName);
            
            if (isForThisStudent) {
                studentLeads.push(lead);
            } else {
                otherLeads.push(lead);
            }
        }
        
        console.log(`\n📊 Результаты фильтрации:`);
        console.log(`   ✅ Сделки для "${targetStudent.studentName}": ${studentLeads.length}`);
        console.log(`   ❌ Сделки для других: ${otherLeads.length}`);
        
        // 6. Если есть сделки для ученика - ищем среди них
        if (studentLeads.length > 0) {
            console.log(`\n🔍 Ищем абонемент среди сделок ученика:`);
            
            let bestLead = null;
            let bestSubscriptionInfo = null;
            let bestScore = -1;
            
            for (const lead of studentLeads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (!subscriptionInfo.hasSubscription) {
                    continue;
                }
                
                // Оценка сделки
                let score = 0;
                
                // Точное совпадение имени
                if (this.checkNameMatch(lead.name, targetStudent.studentName).exact) {
                    score += 100;
                }
                
                // Воронка абонементов
                if (lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID) {
                    score += 80;
                }
                
                // Активный статус
                if ([142, 143, 65473306].includes(lead.status_id)) {
                    score += 60;
                }
                
                // Есть остаток занятий
                if (subscriptionInfo.remainingClasses > 0) {
                    score += subscriptionInfo.remainingClasses * 10;
                }
                
                // Не заморожен
                if (!subscriptionInfo.isFrozen) {
                    score += 30;
                }
                
                console.log(`   📄 "${lead.name}" (ID: ${lead.id}) - ${score} баллов`);
                
                if (score > bestScore) {
                    bestScore = score;
                    bestLead = lead;
                    bestSubscriptionInfo = subscriptionInfo;
                }
            }
            
            if (bestLead) {
                console.log(`\n🏆 ВЫБРАНА СДЕЛКА: "${bestLead.name}"`);
                console.log(`   📊 ${bestSubscriptionInfo.usedClasses}/${bestSubscriptionInfo.totalClasses} занятий`);
                console.log(`   📈 Остаток: ${bestSubscriptionInfo.remainingClasses}`);
                
                return {
                    lead: bestLead,
                    subscriptionInfo: bestSubscriptionInfo,
                    student: targetStudent
                };
            }
        }
        
        // 7. Если не нашли сделки для ученика, проверяем все сделки (старая логика)
        console.log(`\n⚠️  Не нашли сделок для ученика, проверяем все сделки...`);
        
        let bestLead = null;
        let bestSubscriptionInfo = null;
        let bestScore = -1;
        
        for (const lead of leads) {
            const subscriptionInfo = this.extractSubscriptionInfo(lead);
            
            if (!subscriptionInfo.hasSubscription) {
                continue;
            }
            
            // Оценка
            let score = 0;
            const nameMatch = this.checkNameMatch(lead.name, targetStudent.studentName);
            
            if (nameMatch.exact) {
                score += 100;
            } else if (nameMatch.partial) {
                score += 50;
            }
            
            if (lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID) {
                score += 80;
            }
            
            if ([142, 143, 65473306].includes(lead.status_id)) {
                score += 60;
            }
            
            if (subscriptionInfo.remainingClasses > 0) {
                score += subscriptionInfo.remainingClasses * 10;
            }
            
            console.log(`   📄 "${lead.name}" (ID: ${lead.id}) - ${score} баллов`);
            
            if (score > bestScore) {
                bestScore = score;
                bestLead = lead;
                bestSubscriptionInfo = subscriptionInfo;
            }
        }
        
        if (bestLead) {
            console.log(`\n🏆 ВЫБРАНА СДЕЛКА: "${bestLead.name}"`);
            return {
                lead: bestLead,
                subscriptionInfo: bestSubscriptionInfo,
                student: targetStudent
            };
        }
        
        console.log(`\n❌ НЕТ ПОДХОДЯЩЕЙ СДЕЛКИ`);
        return null;
        
    } catch (error) {
        console.error('❌ Ошибка в findLeadForStudent:', error);
        return null;
    }
}

// ==================== НОВЫЙ МЕТОД ДЛЯ ПРОВЕРКИ СДЕЛКИ ====================
isLeadForStudent(lead, studentName) {
    const leadName = lead.name || '';
    const cleanLeadName = leadName.toLowerCase();
    const cleanStudentName = studentName.toLowerCase();
    
    // 1. Прямое совпадение
    if (cleanLeadName.includes(cleanStudentName)) {
        return true;
    }
    
    // 2. Ищем фамилию
    const studentParts = cleanStudentName.split(' ');
    const lastName = studentParts[studentParts.length - 1];
    
    if (lastName && cleanLeadName.includes(lastName)) {
        return true;
    }
    
    // 3. Проверяем, что сделка НЕ для другого ученика
    const otherStudents = [
        'трибунская', 'мария', 'петрова', 'даша',
        'анастасия', 'алексей', 'иван', 'сергей'
    ];
    
    for (const otherStudent of otherStudents) {
        if (cleanLeadName.includes(otherStudent) && otherStudent.length > 3) {
            return false; // Это сделка для другого ученика!
        }
    }
    
    // 4. Если сделка в воронке абонементов и нет четкого указания на другого ученика
    if (lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID) {
        return true; // Предполагаем, что это для нашего ученика
    }
    
    return false;
}

    // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ СОВПАДЕНИЯ ИМЕН ====================
    isExactNameMatch(leadName, studentName) {
        if (!leadName || !studentName) return false;
        
        const cleanLeadName = leadName.toLowerCase().trim();
        const cleanStudentName = studentName.toLowerCase().trim();
        
        // 1. Прямое вхождение имени в названии сделки
        if (cleanLeadName.includes(cleanStudentName)) {
            console.log(`   ✅ Точное совпадение: "${studentName}" в "${leadName}"`);
            return true;
        }
        
        // 2. Разбиваем имена на части
        const studentParts = cleanStudentName.split(/\s+/).filter(part => part.length > 1);
        const leadParts = cleanLeadName.split(/\s+/).filter(part => part.length > 1);
        
        // 3. Проверяем совпадение всех частей имени
        let matchedParts = 0;
        for (const studentPart of studentParts) {
            if (studentPart.length <= 2) continue;
            
            for (const leadPart of leadParts) {
                if (leadPart.includes(studentPart) || studentPart.includes(leadPart)) {
                    matchedParts++;
                    break;
                }
            }
        }
        
        // Если совпали все части имени
        if (matchedParts === studentParts.length && studentParts.length > 0) {
            console.log(`   ✅ Все части имени совпадают: ${matchedParts}/${studentParts.length}`);
            return true;
        }
        
        return false;
    }

    isPartialNameMatch(leadName, studentName) {
        if (!leadName || !studentName) return false;
        
        const cleanLeadName = leadName.toLowerCase().trim();
        const cleanStudentName = studentName.toLowerCase().trim();
        
        // Разбиваем имена на части
        const studentParts = cleanStudentName.split(/\s+/).filter(part => part.length > 1);
        const leadParts = cleanLeadName.split(/\s+/).filter(part => part.length > 1);
        
        // Ищем фамилию (обычно последняя часть)
        const studentLastName = studentParts[studentParts.length - 1];
        
        for (const leadPart of leadParts) {
            if (leadPart.includes(studentLastName) || studentLastName.includes(leadPart)) {
                console.log(`   ✅ Частичное совпадение фамилии: "${studentLastName}" в "${leadName}"`);
                return true;
            }
        }
        
        return false;
    }

    // ==================== МЕТОД ПРОВЕРКИ СОВПАДЕНИЯ ИМЕН ====================
    checkNameMatch(leadName, studentName) {
        if (!leadName || !studentName) return { exact: false, partial: false };
        
        const cleanLeadName = leadName.toLowerCase().trim();
        const cleanStudentName = studentName.toLowerCase().trim();
        
        // Точное совпадение
        if (cleanLeadName.includes(cleanStudentName)) {
            return { exact: true, partial: true };
        }
        
        // Частичное совпадение (по фамилии)
        const studentParts = cleanStudentName.split(/\s+/);
        const leadParts = cleanLeadName.split(/\s+/);
        
        // Ищем совпадение любой части
        for (const studentPart of studentParts) {
            if (studentPart.length < 3) continue;
            
            for (const leadPart of leadParts) {
                if (leadPart.includes(studentPart) || studentPart.includes(leadPart)) {
                    return { exact: false, partial: true };
                }
            }
        }
        
        return { exact: false, partial: false };
    }

    // Анализ паттерна названия сделки
    analyzeLeadNamePattern(leadName) {
        const patterns = [
            { pattern: 'ФИО - N занятий', regex: /^(.+)\s+-\s+(\d+)\s+занят/i },
            { pattern: 'ФИО (N занятий)', regex: /^(.+)\s+\((\d+)\s+занят/i },
            { pattern: 'Абонемент N занятий: ФИО', regex: /^Абонемент\s+(\d+)\s+занят.+:\s*(.+)/i },
            { pattern: 'ФИО - абонемент N', regex: /^(.+)\s+-\s+абонемент\s+(\d+)/i },
            { pattern: 'Разовый: ФИО', regex: /^Разовый.+:\s*(.+)/i },
            { pattern: 'ФИО - заморозка', regex: /^(.+)\s+-\s+заморозка/i },
            { pattern: 'ФИО', regex: /^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+$/ }
        ];
        
        for (const p of patterns) {
            const match = leadName.match(p.regex);
            if (match) {
                return {
                    pattern: p.pattern,
                    student_name: match[1]?.trim(),
                    class_count: match[2] ? parseInt(match[2]) : null,
                    match: match[0]
                };
            }
        }
        
        return {
            pattern: 'Неизвестный паттерн',
            student_name: null,
            class_count: null,
            match: leadName
        };
    }

    // Генерация ключа паттерна заполнения полей
    getFieldPatternKey(fieldsAnalysis) {
        const parts = [];
        
        const keyFields = [
            'total_classes', 
            'used_classes', 
            'remaining_classes', 
            'subscription_type',
            'freeze'
        ];
        
        keyFields.forEach(key => {
            if (fieldsAnalysis[key] && fieldsAnalysis[key].exists) {
                parts.push(`${key}:YES`);
            } else {
                parts.push(`${key}:NO`);
            }
        });
        
        return parts.join('|');
    }

    // Проверка целостности данных
    checkDataIntegrity(subscriptionInfo, fieldsAnalysis) {
        const problems = [];
        
        // Проверка 1: total = used + remaining
        const total = subscriptionInfo.totalClasses;
        const used = subscriptionInfo.usedClasses;
        const remaining = subscriptionInfo.remainingClasses;
        
        if (total > 0 && used + remaining !== total) {
            problems.push({
                type: 'DATA_INTEGRITY',
                message: `Некорректная сумма: ${used} + ${remaining} ≠ ${total}`,
                expected: total,
                actual: used + remaining,
                recommendation: 'Проверить поля "Счетчик занятий:" и "Остаток занятий"'
            });
        }
        
        // Проверка 2: поле "Остаток занятий" должно совпадать с расчетом
        if (fieldsAnalysis.remaining_classes && fieldsAnalysis.remaining_classes.exists) {
            const fieldRemaining = fieldsAnalysis.remaining_classes.parsed_number;
            if (fieldRemaining !== remaining) {
                problems.push({
                    type: 'REMAINING_CALCULATION_MISMATCH',
                    message: `Поле "Остаток занятий" (${fieldRemaining}) не совпадает с расчетом (${remaining})`,
                    field_value: fieldRemaining,
                    calculated_value: remaining,
                    recommendation: 'Использовать значение из поля или пересчитать логику'
                });
            }
        }
        
        // Проверка 3: даты должны быть в правильном порядке
        if (subscriptionInfo.activationDate && subscriptionInfo.expirationDate) {
            const activation = new Date(subscriptionInfo.activationDate);
            const expiration = new Date(subscriptionInfo.expirationDate);
            
            if (activation > expiration) {
                problems.push({
                    type: 'DATE_ORDER',
                    message: `Дата активации (${subscriptionInfo.activationDate}) позже даты окончания (${subscriptionInfo.expirationDate})`,
                    recommendation: 'Проверить корректность дат'
                });
            }
        }
        
        return { problems };
    }

    // Рекомендации для проблемных случаев
    getRecommendationForProblems(problems) {
        const recommendations = [];
        
        problems.forEach(problem => {
            switch (problem.type) {
                case 'TOTAL_CLASSES_MISMATCH':
                    recommendations.push('Исправить парсинг поля "Абонемент занятий:"');
                    break;
                case 'REMAINING_CLASSES_MISMATCH':
                    recommendations.push('Проверить логику расчета остатка занятий');
                    break;
                case 'DATA_INTEGRITY':
                    recommendations.push('Пересчитать used_classes и remaining_classes');
                    break;
            }
        });
        
        return [...new Set(recommendations)].join('; ');
    }
    
    async checkSubscriptionPipeline() {
        try {
            const pipelines = await this.makeRequest('GET', '/api/v4/leads/pipelines');
            
            if (pipelines._embedded && pipelines._embedded.pipelines) {
                const subscriptionPipeline = pipelines._embedded.pipelines.find(
                    p => p.name.includes('Абонемент') || p.id === this.SUBSCRIPTION_PIPELINE_ID
                );
                
                if (subscriptionPipeline) {
                    this.SUBSCRIPTION_PIPELINE_ID = subscriptionPipeline.id;
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка проверки воронки:', error.message);
        }
    }

    async loadPipelineStatuses() {
        try {
            const response = await this.makeRequest('GET', `/api/v4/leads/pipelines/${this.SUBSCRIPTION_PIPELINE_ID}`);
            
            if (response && response._embedded && response._embedded.statuses) {
                response._embedded.statuses.forEach(status => {
                    if (status.name.toLowerCase().includes('актив') || status.name === 'Активирован') {
                        if (!this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(status.id)) {
                            this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.push(status.id);
                        }
                    } else if (status.name.toLowerCase().includes('заморозк')) {
                        if (!this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(status.id)) {
                            this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.push(status.id);
                        }
                    } else if (status.name.toLowerCase().includes('истек')) {
                        if (!this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(status.id)) {
                            this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.push(status.id);
                        }
                    }
                });
            }
            
        } catch (error) {
            console.error('❌ Ошибка загрузки статусов:', error.message);
        }
    }

    // ==================== ОСТАЛЬНЫЕ МЕТОДЫ ====================
    async searchContactsByPhone(phoneNumber) {
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
            return { _embedded: { contacts: [] } };
        }
        
        try {
            const last10Digits = cleanPhone.slice(-10);
            const searchFormats = [
                `+7${last10Digits}`,
                `8${last10Digits}`,
                `7${last10Digits}`,
                last10Digits
            ];
            
            let allContacts = [];
            
            for (const format of searchFormats) {
                try {
                    const response = await this.makeRequest(
                        'GET', 
                        `/api/v4/contacts?query=${encodeURIComponent(format)}&with=custom_fields_values&limit=50`
                    );
                    
                    const contacts = response._embedded?.contacts || [];
                    contacts.forEach(contact => {
                        if (!allContacts.some(c => c.id === contact.id)) {
                            allContacts.push(contact);
                        }
                    });
                    
                } catch (searchError) {
                    continue;
                }
            }
            
            return { _embedded: { contacts: allContacts } };
            
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    extractStudentsFromContact(contact) {
        const students = [];
        
        try {
            const customFields = contact.custom_fields_values || [];
            const contactName = contact.name || '';
            
            const childrenConfig = [
                { number: 1, nameFieldId: 867233 },
                { number: 2, nameFieldId: 867235 },
                { number: 3, nameFieldId: 867733 }
            ];
            
            for (const childConfig of childrenConfig) {
                let studentName = '';
                
                for (const field of customFields) {
                    const fieldId = field.field_id || field.id;
                    const fieldValue = this.getFieldValue(field);
                    
                    if (fieldId === childConfig.nameFieldId && fieldValue && fieldValue.trim()) {
                        studentName = fieldValue.trim();
                        break;
                    }
                }
                
                if (studentName) {
                    const studentInfo = {
                        studentName: studentName,
                        birthDate: '',
                        branch: '',
                        dayOfWeek: '',
                        timeSlot: '',
                        teacherName: '',
                        course: '',
                        ageGroup: '',
                        allergies: '',
                        parentName: contactName,
                        hasActiveSubscription: false,
                        lastVisitDate: '',
                        email: ''
                    };
                    
                    for (const field of customFields) {
                        const fieldId = field.field_id || field.id;
                        const fieldValue = this.getFieldValue(field);
                        
                        if (!fieldValue) continue;
                        
                        if (fieldId === 871273) {
                            studentInfo.branch = fieldValue;
                        } else if (fieldId === 888881) {
                            studentInfo.teacherName = fieldValue;
                        } else if (fieldId === 892225) {
                            studentInfo.dayOfWeek = fieldValue;
                        } else if (fieldId === 888903) {
                            studentInfo.ageGroup = fieldValue;
                        } else if (fieldId === 890179) {
                            studentInfo.hasActiveSubscription = fieldValue.toLowerCase() === 'да' || 
                                                             fieldValue === '1';
                        } else if (fieldId === 885380) {
                            studentInfo.lastVisitDate = this.parseDate(fieldValue);
                        } else if (fieldId === 850239) {
                            studentInfo.allergies = fieldValue;
                        } else if (fieldId === 216617 || fieldId === 850219) {
                            if (fieldValue.includes('@')) {
                                studentInfo.email = fieldValue;
                            } else if (fieldId === 850219) {
                                studentInfo.birthDate = this.parseDate(fieldValue);
                            }
                        }
                    }
                    
                    students.push(studentInfo);
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка извлечения учеников:', error);
        }
        
        return students;
    }

    async getContactLeadsSorted(contactId) {
        try {
            let allLeads = [];
            let page = 1;
            const limit = 100;
            
            while (true) {
                try {
                    const response = await this.makeRequest(
                        'GET',
                        `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&page=${page}&limit=${limit}&order[updated_at]=desc`
                    );
                    
                    const leads = response._embedded?.leads || [];
                    if (leads.length === 0) break;
                    
                    allLeads = [...allLeads, ...leads];
                    
                    if (leads.length < limit) break;
                    page++;
                    
                    if (page > 5) break;
                    
                } catch (pageError) {
                    break;
                }
            }
            
            // Фильтруем рассылки и архивы
            const filteredLeads = allLeads.filter(lead => {
                const leadName = lead.name || '';
                const lowerName = leadName.toLowerCase();
                
                const excludePatterns = [
                    /^рассылка/i,
                    /рассылка\s*\|/i,
                    /^архив/i,
                    /^отменен/i,
                    /^не\s+актив/i,
                    /^успешн/i,
                    /^\d+\s*₽/i,
                    /^сделка\s*#/i,
                    /^#\d+/i,
                    /^test/i,
                    /^тест/i,
                    /^\s*$/
                ];
                
                const shouldExclude = excludePatterns.some(pattern => pattern.test(lowerName));
                return !shouldExclude;
            });
            
            return filteredLeads;
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    // ==================== ОСНОВНОЙ МЕТОД ПОЛУЧЕНИЯ УЧЕНИКОВ ====================
    async getStudentsByPhone(phoneNumber) {
        console.log(`\n📱 ПОЛУЧЕНИЕ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                return studentProfiles;
            }
            
            const filteredContacts = contacts.filter(contact => {
                const contactName = contact.name || '';
                const isAdminContact = 
                    contactName.toLowerCase().includes('админ') ||
                    contactName.toLowerCase().includes('admin') ||
                    contactName.toLowerCase().includes('менеджер') ||
                    contactName.toLowerCase().includes('manager') ||
                    contactName.toLowerCase().includes('yurlova') ||
                    contactName.toLowerCase().includes('александрова') ||
                    contact.id === 31966847;
                
                return !isAdminContact;
            });
            
            const contactsToProcess = filteredContacts.length > 0 ? filteredContacts : contacts;
            
            for (const contact of contactsToProcess) {
                try {
                    const fullContact = await this.getFullContactInfo(contact.id);
                    if (!fullContact) continue;
                    
                    const children = this.extractStudentsFromContact(fullContact);
                    
                    if (children.length === 0) {
                        continue;
                    }
                    
                    for (const child of children) {
                        const leadResult = await this.findLeadForStudent(contact.id, child.studentName);
                        
                        if (leadResult) {
                            const profile = this.createStudentProfile(
                                fullContact,
                                phoneNumber,
                                child,
                                leadResult.subscriptionInfo,
                                leadResult.lead
                            );
                            
                            studentProfiles.push(profile);
                            console.log(`✅ Профиль создан: ${child.studentName}`);
                        } else {
                            const profile = this.createStudentProfile(
                                fullContact,
                                phoneNumber,
                                child,
                                {
                                    hasSubscription: false,
                                    totalClasses: 0,
                                    usedClasses: 0,
                                    remainingClasses: 0,
                                    subscriptionType: '',
                                    subscriptionActive: false,
                                    activationDate: null,
                                    expirationDate: null,
                                    lastVisitDate: null,
                                    subscriptionStatus: 'Нет абонемента',
                                    subscriptionBadge: 'inactive',
                                    isFrozen: false
                                },
                                null
                            );
                            
                            studentProfiles.push(profile);
                        }
                    }
                    
                } catch (contactError) {
                    console.error(`❌ Ошибка обработки контакта:`, contactError.message);
                }
            }
            
            // Убираем дубликаты
            const uniqueProfiles = [];
            const seenStudents = new Set();
            
            for (const profile of studentProfiles) {
                const key = `${profile.student_name}_${profile.phone_number}`;
                if (!seenStudents.has(key)) {
                    seenStudents.add(key);
                    uniqueProfiles.push(profile);
                }
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${uniqueProfiles.length}`);
            
            return uniqueProfiles;
            
        } catch (error) {
            console.error('❌ Ошибка поиска учеников:', error.message);
            return studentProfiles;
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
            console.error(`❌ Ошибка получения контакта:`, error.message);
            return null;
        }
    }

    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        const email = studentInfo.email || this.findEmail(contact);
        
        const formatDisplayDate = (dateStr) => {
            if (!dateStr) return '';
            try {
                const date = new Date(dateStr);
                if (isNaN(date.getTime())) return dateStr;
                
                return date.toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                });
            } catch (error) {
                return dateStr;
            }
        };
        
        let branch = studentInfo.branch || '';
        
        if (!branch && lead) {
            const customFields = lead.custom_fields_values || [];
            const branchField = customFields.find(f => 
                (f.field_id || f.id) === 871273
            );
            
            if (branchField) {
                branch = this.getFieldValue(branchField);
            }
        }
        
        const profile = {
            amocrm_contact_id: contact.id || null,
            parent_contact_id: contact.id || null,
            amocrm_lead_id: lead?.id || null,
            
            student_name: studentInfo.studentName || 'Ученик',
            phone_number: phoneNumber,
            email: email || '',
            birth_date: studentInfo.birthDate || '',
            branch: branch || '',
            parent_name: studentInfo.parentName || contact.name || '',
            
            day_of_week: studentInfo.dayOfWeek || '',
            time_slot: studentInfo.timeSlot || '',
            teacher_name: studentInfo.teacherName || '',
            age_group: studentInfo.ageGroup || '',
            course: studentInfo.course || '',
            allergies: studentInfo.allergies || '',
            
            subscription_type: subscriptionInfo.subscriptionType || 'Без абонемента',
            subscription_active: subscriptionInfo.subscriptionActive ? 1 : 0,
            subscription_status: subscriptionInfo.subscriptionStatus || 'Нет абонемента',
            subscription_badge: subscriptionInfo.subscriptionBadge || 'inactive',
            
            total_classes: subscriptionInfo.totalClasses || 0,
            remaining_classes: subscriptionInfo.remainingClasses || 0,
            used_classes: subscriptionInfo.usedClasses || 0,
            
            expiration_date: subscriptionInfo.expirationDate || null,
            activation_date: subscriptionInfo.activationDate || null,
            last_visit_date: studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate || null,
            
            expiration_date_display: formatDisplayDate(subscriptionInfo.expirationDate),
            activation_date_display: formatDisplayDate(subscriptionInfo.activationDate),
            last_visit_date_display: formatDisplayDate(studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate),
            
            custom_fields: JSON.stringify(contact.custom_fields_values || []),
            raw_contact_data: JSON.stringify(contact),
            lead_data: lead ? JSON.stringify(lead) : '{}',
            
            is_demo: 0,
            source: 'amocrm',
            is_active: 1,
            last_sync: new Date().toISOString()
        };
        
        console.log(`📊 Профиль ученика:`);
        console.log(`   👤 ${profile.student_name}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        console.log(`   📊 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        console.log(`   ✅ Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
        
        return profile;
    }

    findEmail(contact) {
        try {
            const customFields = contact.custom_fields_values || [];
            
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                const fieldValue = this.getFieldValue(field);
                
                if (fieldValue && fieldValue.includes('@')) {
                    return fieldValue;
                }
            }
            
            return '';
            
        } catch (error) {
            return '';
        }
    }

    // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ====================
    getFieldName(field) {
        const fieldId = field.field_id || field.id;
        const fieldMapping = this.fieldMappings.get(fieldId);
        return fieldMapping ? fieldMapping.name : `Поле ${fieldId}`;
    }

    isSubscriptionField(fieldId) {
        return Object.values(this.FIELD_IDS.LEAD).includes(fieldId);
    }

    isImportantField(fieldId) {
        const importantFields = [
            this.FIELD_IDS.LEAD.TOTAL_CLASSES,
            this.FIELD_IDS.LEAD.USED_CLASSES,
            this.FIELD_IDS.LEAD.REMAINING_CLASSES,
            this.FIELD_IDS.LEAD.EXPIRATION_DATE,
            this.FIELD_IDS.LEAD.ACTIVATION_DATE
        ];
        return importantFields.includes(fieldId);
    }

    checkIfLeadBelongsToStudent(leadName, studentName) {
        return this.isExactNameMatch(leadName, studentName) || this.isPartialNameMatch(leadName, studentName);
    }

    // ==================== ДИАГНОСТИЧЕСКИЕ МЕТОДЫ ====================
    async debugPhoneSearch(phone) {
        try {
            console.log(`\n🔍 ДИАГНОСТИКА ПОИСКА ПО ТЕЛЕФОНУ: ${phone}`);
            
            const results = {
                phone: phone,
                contacts_found: 0,
                leads_found: 0,
                subscription_leads: 0,
                details: [],
                issues: []
            };
            
            // Поиск контактов
            const contactsResponse = await this.searchContactsByPhone(phone);
            const contacts = contactsResponse._embedded?.contacts || [];
            results.contacts_found = contacts.length;
            
            console.log(`📊 Контактов найдено: ${contacts.length}`);
            
            if (contacts.length === 0) {
                results.issues.push('Не найдено контактов по телефону');
                return results;
            }
            
            // Анализируем первый контакт
            const contact = contacts[0];
            console.log(`👤 Основной контакт: "${contact.name}" (ID: ${contact.id})`);
            
            // Получаем сделки контакта
            const leads = await this.getContactLeadsSorted(contact.id);
            results.leads_found = leads.length;
            
            console.log(`📊 Сделок найдено: ${leads.length}`);
            
            // Анализируем первые 10 сделок
            for (let i = 0; i < Math.min(leads.length, 10); i++) {
                const lead = leads[i];
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                results.details.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    has_subscription: subscriptionInfo.hasSubscription,
                    total_classes: subscriptionInfo.totalClasses,
                    remaining_classes: subscriptionInfo.remainingClasses,
                    subscription_status: subscriptionInfo.subscriptionStatus
                });
                
                if (subscriptionInfo.hasSubscription) {
                    results.subscription_leads++;
                }
                
                console.log(`   ${i + 1}. "${lead.name.substring(0, 50)}..."`);
                console.log(`      🎫 Абонемент: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
                console.log(`      📊 Занятий: ${subscriptionInfo.totalClasses}`);
                console.log(`      📍 Pipeline: ${lead.pipeline_id}`);
            }
            
            // Проверяем наличие сделок с абонементами
            if (results.subscription_leads === 0 && results.leads_found > 0) {
                results.issues.push('Найдены сделки, но нет сделок с абонементами');
            }
            
            return results;
            
        } catch (error) {
            console.error('❌ Ошибка диагностики:', error.message);
            return null;
        }
    }

    async debugLeadAnalysis(leadId) {
        try {
            console.log(`\n🔍 ДИАГНОСТИКА СДЕЛКИ: ${leadId}`);
            
            const lead = await this.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}?with=custom_fields_values`
            );
            
            if (!lead) {
                console.log('❌ Сделка не найдена');
                return null;
            }
            
            const analysis = {
                lead_id: lead.id,
                lead_name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                fields_count: lead.custom_fields_values?.length || 0,
                subscription_info: this.extractSubscriptionInfo(lead),
                critical_fields: {},
                issues: []
            };
            
            // Анализируем критические поля
            const criticalFieldIds = [
                850241, // Абонемент занятий:
                850257, // Счетчик занятий:
                890163, // Остаток занятий
                850255, // Окончание абонемента:
                851565, // Дата активации абонемента:
                867693  // Заморозка абонемента:
            ];
            
            criticalFieldIds.forEach(fieldId => {
                const field = lead.custom_fields_values?.find(f => 
                    (f.field_id || f.id) === fieldId
                );
                
                if (field) {
                    const value = this.getFieldValue(field);
                    const parsedNumber = this.parseNumberFromField(value);
                    
                    analysis.critical_fields[fieldId] = {
                        name: this.getFieldName(field),
                        value: value,
                        parsed: parsedNumber,
                        exists: true
                    };
                } else {
                    analysis.critical_fields[fieldId] = {
                        name: `Поле ${fieldId}`,
                        value: null,
                        parsed: 0,
                        exists: false
                    };
                    
                    if ([850241, 850257, 890163].includes(fieldId)) {
                        analysis.issues.push(`Критическое поле ${fieldId} не найдено`);
                    }
                }
            });
            
            // Проверяем целостность данных
            const total = analysis.subscription_info.totalClasses;
            const used = analysis.subscription_info.usedClasses;
            const remaining = analysis.subscription_info.remainingClasses;
            
            if (total > 0 && used + remaining !== total) {
                analysis.issues.push(`Некорректная сумма: ${used} + ${remaining} ≠ ${total}`);
            }
            
            console.log(`📋 Сделка: "${lead.name}"`);
            console.log(`📍 Pipeline: ${lead.pipeline_id}, Status: ${lead.status_id}`);
            console.log(`🎯 Абонемент: ${analysis.subscription_info.hasSubscription ? '✅ Найден' : '❌ Не найден'}`);
            console.log(`📊 Занятий: ${total} всего, ${remaining} осталось`);
            
            if (analysis.issues.length > 0) {
                console.log(`🚨 Проблемы: ${analysis.issues.join('; ')}`);
            }
            
            return analysis;
            
        } catch (error) {
            console.error('❌ Ошибка анализа:', error.message);
            return null;
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
                
                custom_fields TEXT,
                raw_contact_data TEXT,
                lead_data TEXT,
                is_demo INTEGER DEFAULT 0,
                source TEXT DEFAULT 'amocrm',
                is_active INTEGER DEFAULT 1,
                last_sync TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица student_profiles создана');

        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_name ON student_profiles(student_name)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(is_active)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_branch ON student_profiles(branch)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_sync ON student_profiles(last_sync)');
        
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
            CREATE TABLE IF NOT EXISTS sync_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_type TEXT NOT NULL,
                items_count INTEGER DEFAULT 0,
                success_count INTEGER DEFAULT 0,
                error_count INTEGER DEFAULT 0,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                duration_ms INTEGER,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица sync_logs создана');
        
        console.log('\n🎉 Все таблицы созданы успешно!');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};

// ==================== СИСТЕМА СИНХРОНИЗАЦИИ ====================
class SyncService {
    constructor() {
        this.isSyncing = false;
        this.lastSyncTime = null;
    }

    async startAutoSync() {
        console.log('\n🔄 ЗАПУСК АВТОМАТИЧЕСКОЙ СИНХРОНИЗАЦИИ');
        console.log('📅 Синхронизация каждые 10 минут');
        
        await this.syncAllProfiles();
        
        setInterval(async () => {
            await this.syncAllProfiles();
        }, 10 * 60 * 1000);
    }

    async syncAllProfiles() {
        if (this.isSyncing) {
            console.log('⚠️  Синхронизация уже выполняется, пропускаем');
            return;
        }

        this.isSyncing = true;
        const startTime = Date.now();

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔄 ЗАПУСК СИНХРОНИЗАЦИИ`);
        console.log(`⏰ Время: ${new Date().toISOString()}`);
        console.log('='.repeat(80));

        try {
            const phones = await db.all(
                `SELECT DISTINCT phone_number FROM student_profiles WHERE is_active = 1`
            );

            console.log(`📊 Найдено уникальных телефонов: ${phones.length}`);

            let totalUpdated = 0;
            let totalErrors = 0;

            for (const phoneRow of phones) {
                const phone = phoneRow.phone_number;
                
                try {
                    console.log(`\n🔍 Синхронизация для телефона: ${phone}`);
                    
                    const profiles = await amoCrmService.getStudentsByPhone(phone);
                    
                    const savedCount = await saveProfilesToDatabase(profiles);
                    
                    console.log(`✅ Обновлено профилей: ${savedCount}`);
                    totalUpdated += savedCount;
                    
                } catch (phoneError) {
                    console.error(`❌ Ошибка синхронизации телефона ${phone}:`, phoneError.message);
                    totalErrors++;
                }
            }

            const duration = Date.now() - startTime;
            this.lastSyncTime = new Date();

            await db.run(
                `INSERT INTO sync_logs (sync_type, items_count, success_count, error_count, start_time, end_time, duration_ms) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ['auto_sync', phones.length, totalUpdated, totalErrors, 
                 new Date(startTime).toISOString(), new Date().toISOString(), duration]
            );

            console.log('\n' + '='.repeat(80));
            console.log(`✅ СИНХРОНИЗАЦИЯ ЗАВЕРШЕНА`);
            console.log('='.repeat(80));
            console.log(`📊 Результаты:`);
            console.log(`   • Обработано телефонов: ${phones.length}`);
            console.log(`   • Обновлено профилей: ${totalUpdated}`);
            console.log(`   • Ошибок: ${totalErrors}`);
            console.log(`   • Время выполнения: ${duration}ms`);
            console.log(`   • Следующая синхронизация: через 10 минут`);
            console.log('='.repeat(80));

        } catch (error) {
            console.error('❌ Критическая ошибка синхронизации:', error.message);
            
            await db.run(
                `INSERT INTO sync_logs (sync_type, error_message, start_time, end_time, duration_ms) 
                 VALUES (?, ?, ?, ?, ?)`,
                ['auto_sync', error.message, new Date(startTime).toISOString(), 
                 new Date().toISOString(), Date.now() - startTime]
            );
        } finally {
            this.isSyncing = false;
        }
    }

    getSyncStatus() {
        return {
            is_syncing: this.isSyncing,
            last_sync_time: this.lastSyncTime,
            next_sync_in: this.lastSyncTime ? 
                Math.max(0, 10 * 60 * 1000 - (Date.now() - this.lastSyncTime.getTime())) : 
                null
        };
    }
}

const syncService = new SyncService();

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
                
                if (!existingProfile) {
                    const result = await db.run(
                        `INSERT INTO student_profiles (
                            amocrm_contact_id, parent_contact_id, amocrm_lead_id,
                            student_name, phone_number, email, birth_date, branch,
                            day_of_week, time_slot, teacher_name, age_group, course, allergies,
                            parent_name, subscription_type, subscription_active, subscription_status,
                            subscription_badge, total_classes, used_classes, remaining_classes,
                            expiration_date, activation_date, last_visit_date,
                            custom_fields, raw_contact_data, lead_data, is_demo, source, is_active, last_sync
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            profile.amocrm_contact_id, profile.parent_contact_id, profile.amocrm_lead_id,
                            profile.student_name, profile.phone_number, profile.email, profile.birth_date, profile.branch,
                            profile.day_of_week, profile.time_slot, profile.teacher_name, profile.age_group, profile.course, profile.allergies,
                            profile.parent_name, profile.subscription_type, profile.subscription_active, profile.subscription_status,
                            profile.subscription_badge, profile.total_classes, profile.used_classes, profile.remaining_classes,
                            profile.expiration_date, profile.activation_date, profile.last_visit_date,
                            profile.custom_fields, profile.raw_contact_data, profile.lead_data,
                            profile.is_demo, profile.source, 1, new Date().toISOString()
                        ]
                    );
                    
                    console.log(`✅ Профиль создан (ID: ${result.lastID}): ${profile.student_name}`);
                    savedCount++;
                } else {
                    await db.run(
                        `UPDATE student_profiles SET
                            amocrm_contact_id = ?, amocrm_lead_id = ?,
                            subscription_type = ?, subscription_active = ?, subscription_status = ?,
                            subscription_badge = ?, total_classes = ?, used_classes = ?, remaining_classes = ?,
                            expiration_date = ?, activation_date = ?, last_visit_date = ?,
                            custom_fields = ?, raw_contact_data = ?, lead_data = ?,
                            is_active = ?, last_sync = ?, updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        [
                            profile.amocrm_contact_id, profile.amocrm_lead_id,
                            profile.subscription_type, profile.subscription_active, profile.subscription_status,
                            profile.subscription_badge, profile.total_classes, profile.used_classes, profile.remaining_classes,
                            profile.expiration_date, profile.activation_date, profile.last_visit_date,
                            profile.custom_fields, profile.raw_contact_data, profile.lead_data,
                            1, new Date().toISOString(), existingProfile.id
                        ]
                    );
                    
                    console.log(`✅ Профиль обновлен (ID: ${existingProfile.id}): ${profile.student_name}`);
                    savedCount++;
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка сохранения профиля ${profile.student_name}:`, profileError.message);
            }
        }
        
        console.log(`✅ Всего сохранено/обновлено: ${savedCount} профилей`);
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
        }
    }
    
    return '+7' + cleanPhone.slice(-10);
}

// В server.js добавьте маршрут
app.post('/api/force-refresh/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`\n🔄 ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ: ${formattedPhone}`);
        
        // Удаляем все профили этого телефона
        await db.run(
            `DELETE FROM student_profiles WHERE phone_number LIKE ?`,
            [`%${formattedPhone.slice(-10)}%`]
        );
        
        // Получаем свежие данные
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        // Сразу возвращаем данные
        res.json({
            success: true,
            message: 'Данные обновлены',
            data: {
                phone: formattedPhone,
                profiles: profiles,
                force_refreshed: true
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ОЧИСТКА КЭША И ПЕРЕСИНХРОНИЗАЦИЯ ====================
app.post('/api/clear-cache/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`\n🗑️  ОЧИСТКА КЭША ДЛЯ: ${formattedPhone}`);
        
        // Удаляем все профили этого телефона
        await db.run(
            `DELETE FROM student_profiles WHERE phone_number LIKE ?`,
            [`%${formattedPhone.slice(-10)}%`]
        );
        
        console.log(`✅ Кэш очищен`);
        
        // Запрашиваем свежие данные из amoCRM
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        const savedCount = await saveProfilesToDatabase(profiles);
        
        console.log(`🔄 Получено свежих данных: ${savedCount} профилей`);
        
        res.json({
            success: true,
            message: 'Кэш очищен и данные обновлены',
            data: {
                phone: formattedPhone,
                profiles_found: profiles.length,
                profiles_saved: savedCount,
                profiles: profiles.map(p => ({
                    student_name: p.student_name,
                    subscription_status: p.subscription_status,
                    total_classes: p.total_classes,
                    remaining_classes: p.remaining_classes
                }))
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка очистки кэша:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ЧТО ВИДИТ ПРИЛОЖЕНИЕ ====================
app.get('/api/debug/app-view/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`\n📱 ЧТО ВИДИТ ПРИЛОЖЕНИЕ ДЛЯ: ${formattedPhone}`);
        
        // 1. Что в базе данных
        const dbProfiles = await db.all(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ? 
             ORDER BY last_sync DESC`,
            [`%${formattedPhone.slice(-10)}%`]
        );
        
        console.log(`📊 В базе данных: ${dbProfiles.length} профилей`);
        
        // 2. Что в amoCRM (реальные данные)
        const crmProfiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        console.log(`📊 В amoCRM: ${crmProfiles.length} профилей`);
        
        // 3. Сравниваем
        const comparison = dbProfiles.map(dbProfile => {
            const crmProfile = crmProfiles.find(p => 
                p.student_name === dbProfile.student_name &&
                p.phone_number === dbProfile.phone_number
            );
            
            return {
                student_name: dbProfile.student_name,
                db_data: {
                    total_classes: dbProfile.total_classes,
                    remaining_classes: dbProfile.remaining_classes,
                    subscription_status: dbProfile.subscription_status,
                    last_sync: dbProfile.last_sync
                },
                crm_data: crmProfile ? {
                    total_classes: crmProfile.total_classes,
                    remaining_classes: crmProfile.remaining_classes,
                    subscription_status: crmProfile.subscription_status
                } : null,
                matches: crmProfile 
                    ? (dbProfile.total_classes === crmProfile.total_classes && 
                       dbProfile.remaining_classes === crmProfile.remaining_classes)
                    : false
            };
        });
        
        res.json({
            success: true,
            data: {
                phone: formattedPhone,
                database_profiles: dbProfiles.map(p => ({
                    id: p.id,
                    student_name: p.student_name,
                    total_classes: p.total_classes,
                    remaining_classes: p.remaining_classes,
                    subscription_status: p.subscription_status,
                    last_sync: p.last_sync
                })),
                crm_profiles: crmProfiles.map(p => ({
                    student_name: p.student_name,
                    total_classes: p.total_classes,
                    remaining_classes: p.remaining_classes,
                    subscription_status: p.subscription_status
                })),
                comparison: comparison,
                issues: comparison.filter(c => !c.matches).map(c => ({
                    student: c.student_name,
                    problem: `Данные не совпадают: БД=${c.db_data.total_classes}/${c.db_data.remaining_classes}, CRM=${c.crm_data?.total_classes}/${c.crm_data?.remaining_classes}`
                }))
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка отладки:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        sync_status: syncService.getSyncStatus(),
        data_source: 'Реальные данные из amoCRM'
    });
});
// ==================== ПРЯМОЙ API ДЛЯ ПРИЛОЖЕНИЯ ====================
app.post('/api/app/get-profiles', async (req, res) => {
    try {
        const { phone, force_refresh = false } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`\n📱 ЗАПРОС ОТ ПРИЛОЖЕНИЯ: ${formattedPhone} ${force_refresh ? '(force refresh)' : ''}`);
        
        // Если нужно обновить - очищаем кэш
        if (force_refresh) {
            await db.run(
                `DELETE FROM student_profiles WHERE phone_number LIKE ?`,
                [`%${formattedPhone.slice(-10)}%`]
            );
            console.log('🗑️  Кэш очищен');
        }
        
        // Проверяем, есть ли свежие данные в БД (менее 5 минут назад)
        const recentProfiles = await db.all(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ? 
               AND last_sync > datetime('now', '-5 minutes')
             ORDER BY subscription_active DESC, updated_at DESC`,
            [`%${formattedPhone.slice(-10)}%`]
        );
        
        let profiles = [];
        
        if (recentProfiles.length > 0 && !force_refresh) {
            console.log(`📊 Используем кэшированные данные (${recentProfiles.length} профилей)`);
            profiles = recentProfiles;
        } else {
            // Получаем свежие данные из amoCRM
            console.log('🔄 Получение свежих данных из amoCRM...');
            const crmProfiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            
            if (crmProfiles.length === 0) {
                return res.json({
                    success: true,
                    message: 'Ученики не найдены',
                    data: {
                        profiles: [],
                        source: 'crm',
                        cache_hit: false,
                        timestamp: new Date().toISOString()
                    }
                });
            }
            
            // Сохраняем в БД
            const savedCount = await saveProfilesToDatabase(crmProfiles);
            console.log(`💾 Сохранено в БД: ${savedCount} профилей`);
            
            // Читаем из БД
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? 
                 ORDER BY subscription_active DESC, updated_at DESC`,
                [`%${formattedPhone.slice(-10)}%`]
            );
        }
        
        // Форматируем ответ для приложения
        const responseProfiles = profiles.map(p => ({
            id: p.id,
            student_name: p.student_name,
            phone_number: p.phone_number,
            branch: p.branch || 'Филиал не указан',
            
            subscription: {
                type: p.subscription_type,
                active: p.subscription_active === 1,
                status: p.subscription_status,
                badge: p.subscription_badge,
                
                classes: {
                    total: p.total_classes,
                    used: p.used_classes,
                    remaining: p.remaining_classes,
                    progress: p.total_classes > 0 
                        ? Math.round((p.used_classes / p.total_classes) * 100) 
                        : 0
                },
                
                dates: {
                    activation: p.activation_date,
                    expiration: p.expiration_date,
                    last_visit: p.last_visit_date
                }
            },
            
            schedule: {
                day_of_week: p.day_of_week,
                time_slot: p.time_slot,
                teacher_name: p.teacher_name
            },
            
            parent: p.parent_name ? {
                name: p.parent_name
            } : null,
            
            metadata: {
                profile_id: p.id,
                last_sync: p.last_sync,
                source: p.source,
                is_real_data: true
            }
        }));
        
        console.log(`✅ Отправлено приложению: ${responseProfiles.length} профилей`);
        
        res.json({
            success: true,
            message: 'Профили получены',
            data: {
                profiles: responseProfiles,
                total: responseProfiles.length,
                has_multiple: responseProfiles.length > 1,
                source: profiles[0]?.source || 'unknown',
                cache_hit: recentProfiles.length > 0 && !force_refresh,
                timestamp: new Date().toISOString(),
                debug_info: {
                    phone_requested: phone,
                    phone_formatted: formattedPhone,
                    server_time: new Date().toISOString(),
                    amocrm_connected: amoCrmService.isInitialized
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка API для приложения:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения данных',
            debug: error.message
        });
    }
});
// ==================== ПРАВИЛЬНЫЙ API ДЛЯ ПРИЛОЖЕНИЯ ====================
app.post('/api/v2/auth/phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`\n📱 V2 API: ПОИСК ДЛЯ ${formattedPhone}`);
        
        // 1. Ищем контакт в CRM
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Контакт не найден'
            });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // 2. Получаем учеников из контакта
        const fullContact = await amoCrmService.getFullContactInfo(contact.id);
        const students = amoCrmService.extractStudentsFromContact(fullContact);
        
        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Ученики не найдены'
            });
        }
        
        // 3. Для каждого ученика находим лучший активный абонемент
        const profiles = [];
        
        for (const student of students) {
            console.log(`\n🔍 Поиск абонемента для: "${student.studentName}"`);
            
            // Ищем сделку с абонементом
            const leadResult = await amoCrmService.findLeadForStudent(contact.id, student.studentName);
            
            if (leadResult && leadResult.subscriptionInfo.hasSubscription) {
                // Создаем профиль с правильными данными
                const profile = {
                    id: Date.now() + Math.random(), // Временный ID
                    student_name: student.studentName,
                    phone_number: formattedPhone,
                    branch: student.branch || '',
                    teacher_name: student.teacherName || '',
                    age_group: student.ageGroup || '',
                    
                    subscription: {
                        type: leadResult.subscriptionInfo.subscriptionType,
                        active: leadResult.subscriptionInfo.subscriptionActive,
                        status: leadResult.subscriptionInfo.subscriptionStatus,
                        badge: leadResult.subscriptionInfo.subscriptionBadge,
                        
                        classes: {
                            total: leadResult.subscriptionInfo.totalClasses,
                            used: leadResult.subscriptionInfo.usedClasses,
                            remaining: leadResult.subscriptionInfo.remainingClasses,
                            progress: leadResult.subscriptionInfo.totalClasses > 0 
                                ? Math.round((leadResult.subscriptionInfo.usedClasses / leadResult.subscriptionInfo.totalClasses) * 100)
                                : 0
                        },
                        
                        dates: {
                            activation: leadResult.subscriptionInfo.activationDate,
                            expiration: leadResult.subscriptionInfo.expirationDate,
                            last_visit: leadResult.subscriptionInfo.lastVisitDate
                        }
                    },
                    
                    parent: {
                        name: student.parentName || contact.name
                    },
                    
                    metadata: {
                        lead_id: leadResult.lead?.id,
                        contact_id: contact.id,
                        is_real_data: true,
                        last_sync: new Date().toISOString()
                    }
                };
                
                profiles.push(profile);
                console.log(`✅ Найден абонемент: ${leadResult.subscriptionInfo.totalClasses} занятий`);
                
            } else {
                // Если нет активного абонемента, создаем профиль без абонемента
                const profile = {
                    id: Date.now() + Math.random(),
                    student_name: student.studentName,
                    phone_number: formattedPhone,
                    branch: student.branch || '',
                    teacher_name: student.teacherName || '',
                    age_group: student.ageGroup || '',
                    
                    subscription: {
                        type: 'Нет абонемента',
                        active: false,
                        status: 'Нет активного абонемента',
                        badge: 'inactive',
                        classes: { total: 0, used: 0, remaining: 0, progress: 0 },
                        dates: { activation: null, expiration: null, last_visit: null }
                    },
                    
                    parent: {
                        name: student.parentName || contact.name
                    },
                    
                    metadata: {
                        contact_id: contact.id,
                        is_real_data: true,
                        last_sync: new Date().toISOString()
                    }
                };
                
                profiles.push(profile);
                console.log(`ℹ️  Нет активного абонемента`);
            }
        }
        
        // 4. Создаем токен
        const token = jwt.sign(
            {
                phone: formattedPhone,
                contact_id: contact.id,
                profiles_count: profiles.length,
                timestamp: Date.now()
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: `Найдено ${profiles.length} учеников`,
            data: {
                user: {
                    phone: formattedPhone,
                    name: contact.name,
                    profiles_count: profiles.length
                },
                profiles: profiles,
                token: token,
                metadata: {
                    amocrm_connected: true,
                    source: 'direct_crm_data',
                    timestamp: new Date().toISOString()
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка V2 API:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения данных',
            debug: error.message
        });
    }
});

// ==================== ПРАВИЛЬНЫЙ API ДЛЯ АБОНЕМЕНТОВ ====================
app.post('/api/v2/subscription', async (req, res) => {
    try {
        const { profile_id, phone } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        console.log(`\n📋 V2 API: АБОНЕМЕНТ`);
        console.log(`📌 phone: ${phone}`);
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Требуется авторизация'
            });
        }
        
        // Валидируем токен
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
            console.log(`✅ Токен валиден для: ${decoded.phone}`);
        } catch (tokenError) {
            return res.status(401).json({
                success: false,
                error: 'Невалидный токен'
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone || decoded.phone);
        
        // Ищем контакт
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Контакт не найден'
            });
        }
        
        const contact = contacts[0];
        
        // Если указан profile_id, ищем конкретного ученика
        let targetStudentName = null;
        if (profile_id && profile_id.includes('_')) {
            // profile_id может быть в формате "student_name_phone"
            const parts = profile_id.split('_');
            if (parts.length > 1) {
                targetStudentName = parts.slice(0, -1).join('_');
            }
        }
        
        // Получаем всех учеников
        const fullContact = await amoCrmService.getFullContactInfo(contact.id);
        const allStudents = amoCrmService.extractStudentsFromContact(fullContact);
        
        // Находим ученика
        let student = null;
        if (targetStudentName) {
            student = allStudents.find(s => 
                s.studentName.toLowerCase().includes(targetStudentName.toLowerCase())
            );
        }
        
        // Если не нашли конкретного ученика, берем первого
        if (!student && allStudents.length > 0) {
            student = allStudents[0];
        }
        
        if (!student) {
            return res.status(404).json({
                success: false,
                error: 'Ученик не найден'
            });
        }
        
        console.log(`👤 Ученик: "${student.studentName}"`);
        
        // Ищем абонемент
        const leadResult = await amoCrmService.findLeadForStudent(contact.id, student.studentName);
        
        if (!leadResult || !leadResult.subscriptionInfo.hasSubscription) {
            return res.json({
                success: true,
                data: {
                    student: {
                        name: student.studentName,
                        branch: student.branch || '',
                        teacher_name: student.teacherName || '',
                        age_group: student.ageGroup || ''
                    },
                    subscription: {
                        type: 'Нет абонемента',
                        status: 'Нет активного абонемента',
                        active: false,
                        badge: 'inactive',
                        classes: { total: 0, used: 0, remaining: 0, progress: 0 },
                        dates: { activation: null, expiration: null, last_visit: null }
                    }
                }
            });
        }
        
        // Форматируем даты для отображения
        const formatDate = (dateStr) => {
            if (!dateStr) return null;
            try {
                const date = new Date(dateStr);
                return date.toLocaleDateString('ru-RU');
            } catch (e) {
                return dateStr;
            }
        };
        
        const progress = leadResult.subscriptionInfo.totalClasses > 0 
            ? Math.round((leadResult.subscriptionInfo.usedClasses / leadResult.subscriptionInfo.totalClasses) * 100)
            : 0;
        
        res.json({
            success: true,
            data: {
                student: {
                    name: student.studentName,
                    phone: formattedPhone,
                    branch: student.branch || '',
                    teacher_name: student.teacherName || '',
                    age_group: student.ageGroup || ''
                },
                
                subscription: {
                    type: leadResult.subscriptionInfo.subscriptionType || 'Абонемент',
                    status: leadResult.subscriptionInfo.subscriptionStatus,
                    active: leadResult.subscriptionInfo.subscriptionActive,
                    badge: leadResult.subscriptionInfo.subscriptionBadge,
                    
                    classes: {
                        total: leadResult.subscriptionInfo.totalClasses,
                        used: leadResult.subscriptionInfo.usedClasses,
                        remaining: leadResult.subscriptionInfo.remainingClasses,
                        progress: progress
                    },
                    
                    dates: {
                        activation: leadResult.subscriptionInfo.activationDate,
                        activation_display: formatDate(leadResult.subscriptionInfo.activationDate),
                        expiration: leadResult.subscriptionInfo.expirationDate,
                        expiration_display: formatDate(leadResult.subscriptionInfo.expirationDate),
                        last_visit: leadResult.subscriptionInfo.lastVisitDate,
                        last_visit_display: formatDate(leadResult.subscriptionInfo.lastVisitDate)
                    }
                },
                
                parent: student.parentName ? {
                    name: student.parentName
                } : null,
                
                metadata: {
                    lead_id: leadResult.lead?.id,
                    contact_id: contact.id,
                    source: 'direct_crm',
                    is_real_data: true,
                    last_updated: new Date().toISOString()
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка V2 subscription:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения данных абонемента',
            debug: error.message
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
        console.log(`🔧 Статус amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
        
        let profiles = [];
        
        if (amoCrmService.isInitialized) {
            console.log('🔍 Получение данных из amoCRM...');
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            console.log(`📊 Найдено профилей в amoCRM: ${profiles.length}`);
            
            if (profiles.length > 0) {
                const savedCount = await saveProfilesToDatabase(profiles);
                console.log(`💾 Сохранено в БД: ${savedCount} профилей`);
            }
        } else {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен. Невозможно получить данные.'
            });
        }
        
        if (profiles.length === 0) {
            console.log('🔍 Поиск в локальной базе данных...');
            const cleanPhone = phone.replace(/\D/g, '');
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY subscription_active DESC, updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            console.log(`📊 Найдено профилей в локальной БД: ${profiles.length}`);
        }
        
        if (profiles.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Ученики не найдены',
                message: 'По указанному телефону не найдено учеников. Проверьте правильность номера или обратитесь в студию.'
            });
        }
        
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            first_name: profiles.length > 0 ? profiles[0].student_name?.split(' ')[0] || 'Ученик' : 'Гость',
            is_temp: true,
            profiles_count: profiles.length
        };
        
        const token = jwt.sign(
            {
                session_id: crypto.randomBytes(32).toString('hex'),
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
            remaining_classes: p.remaining_classes,
            used_classes: p.used_classes,
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            parent_name: p.parent_name,
            is_demo: p.is_demo === 1,
            source: p.source,
            last_sync: p.last_sync
        }));
        
        const hasMultipleStudents = profiles.length > 1;
        
        const responseData = {
            success: true,
            message: 'Найдены профили учеников',
            data: {
                user: tempUser,
                profiles: responseProfiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                has_real_data: true,
                has_multiple_students: hasMultipleStudents,
                token: token,
                last_sync: profiles.length > 0 ? profiles[0].last_sync : null
            }
        };
        
        console.log(`✅ Авторизация завершена успешно`);
        console.log(`📊 Профилей: ${profiles.length}`);
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

// ==================== ИСПРАВЛЕННЫЙ МАРШРУТ ДЛЯ АБОНЕМЕНТОВ ====================
app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id, phone } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        console.log(`\n📋 ЗАПРОС АБОНЕМЕНТА`);
        console.log(`📌 profile_id: ${profile_id}`);
        console.log(`📌 phone: ${phone}`);
        console.log(`🔑 Token: ${token ? 'Присутствует' : 'Отсутствует'}`);
        
        // Проверяем токен
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Требуется авторизация'
            });
        }
        
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            console.log(`✅ Токен валиден для телефона: ${decoded.phone}`);
        } catch (tokenError) {
            console.log(`❌ Ошибка токена: ${tokenError.message}`);
            return res.status(401).json({
                success: false,
                error: 'Невалидный токен'
            });
        }
        
        let profile;
        
        if (profile_id) {
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE id = ?`,
                [parseInt(profile_id)]
            );
        }
        
        if (!profile && phone) {
            const cleanPhone = phone.replace(/\D/g, '').slice(-10);
            profile = await db.get(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1 
                 ORDER BY subscription_active DESC, updated_at DESC LIMIT 1`,
                [`%${cleanPhone}%`]
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
        console.log(`📍 Филиал: ${profile.branch || 'не указан'}`);
        console.log(`📊 Абонемент: ${profile.subscription_status}`);
        console.log(`📊 Источник данных: ${profile.source}`);
        console.log(`📊 Последняя синхронизация: ${profile.last_sync}`);
        
        let progress = 0;
        if (profile.total_classes > 0) {
            progress = Math.round((profile.used_classes / profile.total_classes) * 100);
        }
        
        const response = {
            success: true,
            data: {
                student: {
                    id: profile.id,
                    name: profile.student_name,
                    phone: profile.phone_number,
                    email: profile.email,
                    branch: profile.branch || 'Филиал не указан',
                    birth_date: profile.birth_date,
                    age_group: profile.age_group,
                    course: profile.course,
                    allergies: profile.allergies,
                    teacher_name: profile.teacher_name
                },
                
                schedule: {
                    day_of_week: profile.day_of_week,
                    time_slot: profile.time_slot,
                    teacher_name: profile.teacher_name
                },
                
                subscription: {
                    type: profile.subscription_type,
                    status: profile.subscription_status,
                    badge: profile.subscription_badge,
                    is_active: profile.subscription_active === 1,
                    
                    classes: {
                        total: profile.total_classes,
                        used: profile.used_classes,
                        remaining: profile.remaining_classes,
                        progress: progress
                    },
                    
                    dates: {
                        activation: profile.activation_date,
                        expiration: profile.expiration_date,
                        last_visit: profile.last_visit_date
                    }
                },
                
                parent: profile.parent_name ? {
                    name: profile.parent_name
                } : null,
                
                metadata: {
                    data_source: profile.source,
                    is_real_data: true,
                    last_sync: profile.last_sync,
                    profile_id: profile.id
                }
            }
        };
        
        console.log(`✅ Отправлен ответ с данными абонемента`);
        res.json(response);
        
    } catch (error) {
        console.error('❌ Ошибка получения абонемента:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе',
            details: error.message
        });
    }
});

// ==================== ДИАГНОСТИЧЕСКИЕ МАРШРУТЫ ====================
// ==================== ТЕСТ ИСПРАВЛЕНИЯ ====================
app.get('/api/test-fix/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🧪 ТЕСТ ИСПРАВЛЕНИЯ ДЛЯ СДЕЛКИ: ${leadId}`);
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        // Старая логика (для сравнения)
        const oldSubscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        // Новая логика с исправлением
        const newSubscriptionInfo = {
            ...oldSubscriptionInfo,
            // Принудительно пересчитываем остаток
            remainingClasses: Math.max(0, oldSubscriptionInfo.totalClasses - oldSubscriptionInfo.usedClasses)
        };
        
        // Определяем активность
        const isActive = newSubscriptionInfo.remainingClasses > 0 && 
                        [142, 143].includes(newSubscriptionInfo.statusId) &&
                        newSubscriptionInfo.isInSubscriptionPipeline &&
                        !newSubscriptionInfo.isFrozen;
        
        res.json({
            success: true,
            data: {
                lead_name: lead.name,
                old_subscription: oldSubscriptionInfo,
                new_subscription: {
                    ...newSubscriptionInfo,
                    subscriptionActive: isActive,
                    subscriptionStatus: isActive ? 
                        `Активный (осталось ${newSubscriptionInfo.remainingClasses} занятий)` :
                        newSubscriptionInfo.subscriptionStatus
                },
                fields: {
                    total_classes_field: lead.custom_fields_values?.find(f => 
                        (f.field_id || f.id) === 850241
                    ),
                    used_classes_field: lead.custom_fields_values?.find(f => 
                        (f.field_id || f.id) === 850257
                    ),
                    remaining_classes_field: lead.custom_fields_values?.find(f => 
                        (f.field_id || f.id) === 890163
                    )
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// ==================== ПОЛНАЯ ДИАГНОСТИКА ХРАНЕНИЯ ДАННЫХ АБОНЕМЕНТОВ ====================
app.get('/api/debug/subscriptions-storage', async (req, res) => {
    try {
        console.log('\n🔍 ПОЛНАЯ ДИАГНОСТИКА ХРАНЕНИЯ ДАННЫХ АБОНЕМЕНТОВ');
        console.log('='.repeat(120));
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const startTime = Date.now();
        
        // 1. СБИРАЕМ ВСЕ ВАРИАНТЫ ЗАПИСИ АБОНЕМЕНТОВ
        console.log('\n📊 ШАГ 1: Сбор всех вариантов записи абонементов...');
        
        // Получаем первые 100 сделок из воронки абонементов
        const leadsResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&page=1&limit=100&filter[pipeline_id][]=${amoCrmService.SUBSCRIPTION_PIPELINE_ID}`
        );
        
        const leads = leadsResponse._embedded?.leads || [];
        
        console.log(`📊 Найдено сделок в воронке абонементов: ${leads.length}`);
        
        const storageAnalysis = {
            timestamp: new Date().toISOString(),
            total_subscriptions_analyzed: 0,
            
            // ВАРИАНТЫ ХРАНЕНИЯ ПО КЛЮЧЕВЫМ ПОЛЯМ
            field_storage_patterns: {
                total_classes: {},       // Как хранятся "Абонемент занятий:"
                used_classes: {},        // Как хранятся "Счетчик занятий:"
                remaining_classes: {},   // Как хранятся "Остаток занятий"
                expiration_date: {},     // Как хранятся "Окончание абонемента:"
                activation_date: {},     // Как хранятся "Дата активации абонемента:"
                subscription_type: {},   // Как хранятся "Тип абонемента"
                freeze: {}               // Как хранятся "Заморозка абонемента:"
            },
            
            // ПАТТЕРНЫ ПОЛНОТЫ ДАННЫХ
            data_completeness_patterns: [],
            
            // СТАТУСЫ АБОНЕМЕНТОВ И ИХ ХАРАКТЕРИСТИКИ
            subscription_statuses: {},
            
            // ПРОБЛЕМЫ В ДАННЫХ
            data_problems: [],
            
            // ВАРИАНТЫ НАЗВАНИЙ СДЕЛОК
            lead_naming_patterns: [],
            
            // ПРИМЕРЫ РАБОЧИХ КОНФИГУРАЦИЙ
            working_configurations: []
        };
        
        // 2. АНАЛИЗИРУЕМ КАЖДУЮ СДЕЛКУ
        for (const lead of leads) {
            const leadId = lead.id;
            const leadName = lead.name;
            const statusId = lead.status_id;
            const customFields = lead.custom_fields_values || [];
            
            // Собираем данные по каждому полю
            const fieldValues = {};
            const fieldPresence = {};
            
            // Ключевые поля для анализа
            const keyFields = [
                { id: 850241, name: 'Абонемент занятий:', key: 'total_classes' },
                { id: 850257, name: 'Счетчик занятий:', key: 'used_classes' },
                { id: 890163, name: 'Остаток занятий', key: 'remaining_classes' },
                { id: 850255, name: 'Окончание абонемента:', key: 'expiration_date' },
                { id: 851565, name: 'Дата активации абонемента:', key: 'activation_date' },
                { id: 891007, name: 'Тип абонемента', key: 'subscription_type' },
                { id: 867693, name: 'Заморозка абонемента:', key: 'freeze' }
            ];
            
            // Проверяем каждое поле
            for (const fieldDef of keyFields) {
                const field = customFields.find(f => (f.field_id || f.id) === fieldDef.id);
                
                if (field) {
                    const value = amoCrmService.getFieldValue(field);
                    fieldValues[fieldDef.key] = value;
                    fieldPresence[fieldDef.key] = true;
                    
                    // Собираем статистику по вариантам хранения
                    if (!storageAnalysis.field_storage_patterns[fieldDef.key][value]) {
                        storageAnalysis.field_storage_patterns[fieldDef.key][value] = {
                            raw_value: value,
                            count: 1,
                            examples: [`"${leadName}"`],
                            parsed_as_number: amoCrmService.parseNumberFromField(value),
                            parsed_as_date: amoCrmService.parseDate(value)
                        };
                    } else {
                        storageAnalysis.field_storage_patterns[fieldDef.key][value].count++;
                        if (storageAnalysis.field_storage_patterns[fieldDef.key][value].examples.length < 5) {
                            storageAnalysis.field_storage_patterns[fieldDef.key][value].examples.push(`"${leadName}"`);
                        }
                    }
                } else {
                    fieldValues[fieldDef.key] = null;
                    fieldPresence[fieldDef.key] = false;
                }
            }
            
            // Анализируем паттерн полноты данных
            const presenceKey = Object.keys(fieldPresence)
                .map(key => fieldPresence[key] ? '1' : '0')
                .join('');
            
            const existingPattern = storageAnalysis.data_completeness_patterns.find(p => p.pattern === presenceKey);
            if (existingPattern) {
                existingPattern.count++;
                if (existingPattern.examples.length < 3) {
                    existingPattern.examples.push({
                        lead_id: leadId,
                        lead_name: leadName,
                        fields_present: Object.keys(fieldPresence).filter(k => fieldPresence[k]),
                        fields_missing: Object.keys(fieldPresence).filter(k => !fieldPresence[k])
                    });
                }
            } else {
                storageAnalysis.data_completeness_patterns.push({
                    pattern: presenceKey,
                    description: amoCrmService.getPatternDescription(fieldPresence),
                    count: 1,
                    examples: [{
                        lead_id: leadId,
                        lead_name: leadName,
                        fields_present: Object.keys(fieldPresence).filter(k => fieldPresence[k]),
                        fields_missing: Object.keys(fieldPresence).filter(k => !fieldPresence[k])
                    }]
                });
            }
            
            // Анализируем статус
            if (!storageAnalysis.subscription_statuses[statusId]) {
                storageAnalysis.subscription_statuses[statusId] = {
                    count: 1,
                    examples: [leadName],
                    typical_configuration: amoCrmService.getTypicalConfiguration(fieldPresence)
                };
            } else {
                storageAnalysis.subscription_statuses[statusId].count++;
                if (storageAnalysis.subscription_statuses[statusId].examples.length < 3) {
                    storageAnalysis.subscription_statuses[statusId].examples.push(leadName);
                }
            }
            
            // Проверяем целостность данных
            const integrityCheck = amoCrmService.checkDataIntegrityForLead(fieldValues);
            if (integrityCheck.hasProblems) {
                storageAnalysis.data_problems.push({
                    lead_id: leadId,
                    lead_name: leadName,
                    problems: integrityCheck.problems,
                    field_values: fieldValues
                });
            }
            
            // Если это рабочая конфигурация (все ключевые поля заполнены)
            const allKeyFieldsPresent = Object.values(fieldPresence).every(p => p === true);
            if (allKeyFieldsPresent) {
                storageAnalysis.working_configurations.push({
                    lead_id: leadId,
                    lead_name: leadName,
                    status_id: statusId,
                    field_values: fieldValues,
                    is_active: amoCrmService.isActiveSubscription(statusId, fieldValues),
                    can_be_selected: amoCrmService.canBeSelectedAsActive(lead, fieldValues)
                });
            }
            
            storageAnalysis.total_subscriptions_analyzed++;
        }
        
        // 3. АНАЛИЗ ВАРИАНТОВ НАЗВАНИЙ
        console.log('\n📊 ШАГ 2: Анализ паттернов названий...');
        
        leads.forEach(lead => {
            const pattern = amoCrmService.analyzeLeadNameForStorage(lead.name);
            
            const existingPattern = storageAnalysis.lead_naming_patterns.find(p => p.pattern === pattern.pattern);
            if (existingPattern) {
                existingPattern.count++;
                if (existingPattern.examples.length < 3) {
                    existingPattern.examples.push(lead.name);
                }
            } else {
                storageAnalysis.lead_naming_patterns.push({
                    pattern: pattern.pattern,
                    description: pattern.description,
                    count: 1,
                    examples: [lead.name],
                    student_extraction: pattern.student_name,
                    class_extraction: pattern.class_count
                });
            }
        });
        
        // 4. СОРТИРОВКА И ФИЛЬТРАЦИЯ РЕЗУЛЬТАТОВ
        storageAnalysis.data_completeness_patterns.sort((a, b) => b.count - a.count);
        storageAnalysis.lead_naming_patterns.sort((a, b) => b.count - a.count);
        
        // 5. ГЕНЕРАЦИЯ РЕКОМЕНДАЦИЙ
        console.log('\n📊 ШАГ 3: Генерация рекомендаций...');
        
        const recommendations = amoCrmService.generateStorageRecommendations(storageAnalysis);
        storageAnalysis.recommendations = recommendations;
        
        // 6. ВЫВОД В КОНСОЛЬ ДЛЯ ОТЛАДКИ
        console.log('\n' + '='.repeat(120));
        console.log('📈 РЕЗУЛЬТАТЫ ДИАГНОСТИКИ ХРАНЕНИЯ ДАННЫХ');
        console.log('='.repeat(120));
        
        console.log(`📊 Всего проанализировано абонементов: ${storageAnalysis.total_subscriptions_analyzed}`);
        console.log(`📊 Уникальных паттернов заполнения: ${storageAnalysis.data_completeness_patterns.length}`);
        console.log(`📊 Рабочих конфигураций: ${storageAnalysis.working_configurations.length}`);
        console.log(`🚨 Проблем в данных: ${storageAnalysis.data_problems.length}`);
        
        console.log('\n🔑 ТОП-3 ПАТТЕРНА ЗАПОЛНЕНИЯ ПОЛЕЙ:');
        storageAnalysis.data_completeness_patterns.slice(0, 3).forEach((pattern, index) => {
            const percentage = (pattern.count / storageAnalysis.total_subscriptions_analyzed * 100).toFixed(1);
            console.log(`\n${index + 1}. ${pattern.description} (${pattern.count} сделок, ${percentage}%)`);
            pattern.examples.forEach(example => {
                console.log(`   • "${example.lead_name}"`);
                console.log(`     ✅ Присутствуют: ${example.fields_present.join(', ')}`);
                if (example.fields_missing.length > 0) {
                    console.log(`     ❌ Отсутствуют: ${example.fields_missing.join(', ')}`);
                }
            });
        });
        
        console.log('\n💾 ВАРИАНТЫ ХРАНЕНИЯ КЛЮЧЕВЫХ ПОЛЕЙ:');
        
        // Для поля "Абонемент занятий:"
        const totalClassesPatterns = Object.entries(storageAnalysis.field_storage_patterns.total_classes)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5);
        
        console.log(`\n📋 "Абонемент занятий:" (${Object.keys(storageAnalysis.field_storage_patterns.total_classes).length} вариантов):`);
        totalClassesPatterns.forEach(([value, data], index) => {
            const percentage = (data.count / storageAnalysis.total_subscriptions_analyzed * 100).toFixed(1);
            console.log(`   ${index + 1}. "${value}" → ${data.parsed_as_number} занятий (${data.count} сделок, ${percentage}%)`);
            console.log(`      Примеры: ${data.examples.join(', ')}`);
        });
        
        // Для поля "Остаток занятий"
        const remainingClassesPatterns = Object.entries(storageAnalysis.field_storage_patterns.remaining_classes)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 5);
        
        if (remainingClassesPatterns.length > 0) {
            console.log(`\n📋 "Остаток занятий" (${Object.keys(storageAnalysis.field_storage_patterns.remaining_classes).length} вариантов):`);
            remainingClassesPatterns.forEach(([value, data], index) => {
                const percentage = (data.count / storageAnalysis.total_subscriptions_analyzed * 100).toFixed(1);
                console.log(`   ${index + 1}. "${value}" → ${data.parsed_as_number} (${data.count} сделок, ${percentage}%)`);
            });
        }
        
        console.log('\n🏷️  ТОП-3 ПАТТЕРНА НАЗВАНИЙ СДЕЛОК:');
        storageAnalysis.lead_naming_patterns.slice(0, 3).forEach((pattern, index) => {
            const percentage = (pattern.count / storageAnalysis.total_subscriptions_analyzed * 100).toFixed(1);
            console.log(`\n${index + 1}. ${pattern.description} (${pattern.count} сделок, ${percentage}%)`);
            console.log(`   Извлекается: ${pattern.student_extraction || 'неизвестно'}`);
            if (pattern.class_extraction) {
                console.log(`   Занятий: ${pattern.class_extraction}`);
            }
            pattern.examples.forEach(example => {
                console.log(`   • "${example}"`);
            });
        });
        
        console.log('\n✅ РАБОЧИЕ КОНФИГУРАЦИИ (полностью заполненные):');
        storageAnalysis.working_configurations.slice(0, 5).forEach((config, index) => {
            console.log(`\n${index + 1}. "${config.lead_name}"`);
            console.log(`   🆔 Статус: ${config.status_id}`);
            console.log(`   📊 Занятий: ${config.field_values.total_classes} всего, ${config.field_values.remaining_classes} осталось`);
            console.log(`   📅 Активация: ${config.field_values.activation_date}`);
            console.log(`   📅 Окончание: ${config.field_values.expiration_date}`);
            console.log(`   ✅ Может быть выбран как активный: ${config.can_be_selected ? 'Да' : 'Нет'}`);
        });
        
        if (storageAnalysis.data_problems.length > 0) {
            console.log('\n🚨 ПРОБЛЕМЫ В ДАННЫХ:');
            storageAnalysis.data_problems.slice(0, 5).forEach((problem, index) => {
                console.log(`\n${index + 1}. "${problem.lead_name}"`);
                problem.problems.forEach(p => {
                    console.log(`   • ${p.message}`);
                });
            });
        }
        
        console.log('\n💡 РЕКОМЕНДАЦИИ:');
        storageAnalysis.recommendations.forEach((rec, index) => {
            console.log(`${index + 1}. ${rec}`);
        });
        
        const duration = Date.now() - startTime;
        console.log(`\n⏱️  Время выполнения: ${duration}ms`);
        console.log('='.repeat(120));
        
        res.json({
            success: true,
            message: 'Полная диагностика хранения данных абонементов выполнена',
            timestamp: storageAnalysis.timestamp,
            data: {
                summary: {
                    total_analyzed: storageAnalysis.total_subscriptions_analyzed,
                    working_configurations: storageAnalysis.working_configurations.length,
                    data_problems: storageAnalysis.data_problems.length,
                    unique_patterns: storageAnalysis.data_completeness_patterns.length,
                    execution_time_ms: duration
                },
                field_storage_patterns: storageAnalysis.field_storage_patterns,
                data_completeness_patterns: storageAnalysis.data_completeness_patterns,
                subscription_statuses: storageAnalysis.subscription_statuses,
                lead_naming_patterns: storageAnalysis.lead_naming_patterns,
                working_configurations: storageAnalysis.working_configurations.slice(0, 10),
                data_problems: storageAnalysis.data_problems.slice(0, 10),
                recommendations: storageAnalysis.recommendations
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики хранения данных:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
app.get('/api/debug/subscription-logic/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🧪 ТЕСТ ЛОГИКИ АБОНЕМЕНТА ДЛЯ: ${leadId}`);
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.status(404).json({ success: false, error: 'Сделка не найдена' });
        }
        
        // Вызываем extractSubscriptionInfo с отладкой
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        // Ручной расчет для проверки
        const customFields = lead.custom_fields_values || [];
        
        // 1. Поле "Абонемент занятий:" (850241)
        const totalField = customFields.find(f => f.field_id === 850241);
        const totalValue = totalField ? amoCrmService.getFieldValue(totalField) : '';
        const totalNumber = amoCrmService.parseNumberFromField(totalValue);
        
        // 2. Поле "Счетчик занятий:" (850257)
        const usedField = customFields.find(f => f.field_id === 850257);
        const usedValue = usedField ? amoCrmService.getFieldValue(usedField) : '';
        const usedNumber = amoCrmService.parseNumberFromField(usedValue);
        
        // 3. Поле "Остаток занятий" (890163)
        const remainingField = customFields.find(f => f.field_id === 890163);
        const remainingValue = remainingField ? amoCrmService.getFieldValue(remainingField) : '';
        const remainingNumber = amoCrmService.parseNumberFromField(remainingValue);
        
        // 4. Вычисленный остаток
        const calculatedRemaining = Math.max(0, totalNumber - usedNumber);
        
        res.json({
            success: true,
            lead_name: lead.name,
            pipeline_id: lead.pipeline_id,
            status_id: lead.status_id,
            manual_calculation: {
                total: {
                    field_id: 850241,
                    value: totalValue,
                    number: totalNumber
                },
                used: {
                    field_id: 850257,
                    value: usedValue,
                    number: usedNumber
                },
                remaining_field: {
                    field_id: 890163,
                    value: remainingValue,
                    number: remainingNumber
                },
                calculated_remaining: calculatedRemaining
            },
            subscription_info: subscriptionInfo,
            issue: subscriptionInfo.hasSubscription ? '✅ OK' : '❌ PROBLEM - hasSubscription=false'
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Диагностика поиска по телефону
app.get('/api/debug/phone/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n📱 ДИАГНОСТИКА ТЕЛЕФОНА: ${phone}`);
        console.log('='.repeat(80));
        
        const results = await amoCrmService.debugPhoneSearch(phone);
        
        if (!results) {
            return res.status(500).json({
                success: false,
                error: 'Не удалось выполнить диагностику'
            });
        }
        
        res.json({
            success: true,
            message: 'Диагностика выполнена',
            timestamp: new Date().toISOString(),
            data: results
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики телефона:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
app.get('/api/debug/contact-leads/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        console.log(`\n🔍 ВСЕ СДЕЛКИ ДЛЯ ТЕЛЕФОНА: ${phone}`);
        
        // Ищем контакты по телефону
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        if (contacts.length === 0) {
            return res.json({
                success: false,
                message: 'Контакты не найдены'
            });
        }
        
        const allLeads = [];
        
        // Для каждого контакта получаем сделки
        for (const contact of contacts) {
            console.log(`\n📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
            
            // Получаем полную информацию о контакте
            const fullContact = await amoCrmService.getFullContactInfo(contact.id);
            if (!fullContact) continue;
            
            // Извлекаем учеников
            const students = amoCrmService.extractStudentsFromContact(fullContact);
            console.log(`👥 Ученики: ${students.map(s => s.studentName).join(', ')}`);
            
            // Получаем все сделки контакта
            const leads = await amoCrmService.getContactLeadsSorted(contact.id);
            console.log(`📊 Сделок у контакта: ${leads.length}`);
            
            // Анализируем каждую сделку
            for (const lead of leads) {
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                allLeads.push({
                    contact_id: contact.id,
                    contact_name: contact.name,
                    lead_id: lead.id,
                    lead_name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    subscription_info: subscriptionInfo,
                    matches_petrovа: lead.name.toLowerCase().includes('петров') || 
                                     lead.name.toLowerCase().includes('даш')
                });
                
                // Выводим информацию о сделке
                console.log(`\n   📄 Сделка: "${lead.name}"`);
                console.log(`      ID: ${lead.id}, Pipeline: ${lead.pipeline_id}, Status: ${lead.status_id}`);
                console.log(`      Абонемент: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
                if (subscriptionInfo.hasSubscription) {
                    console.log(`      📊 ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses} занятий`);
                    console.log(`      🎯 ${subscriptionInfo.subscriptionStatus}`);
                }
            }
        }
        
        res.json({
            success: true,
            message: `Найдено сделок: ${allLeads.length}`,
            data: {
                contacts_count: contacts.length,
                leads_count: allLeads.length,
                leads: allLeads
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ДИАГНОСТИКИ АКТИВНЫХ АБОНЕМЕНТОВ ====================

// Расчет дней с момента активации
function calculateDaysSince(dateString) {
    if (!dateString) return null;
    
    try {
        const activationDate = new Date(dateString);
        const today = new Date();
        const diffTime = today.getTime() - activationDate.getTime();
        return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    } catch (error) {
        return null;
    }
}

// Расчет дней до окончания
function calculateDaysUntil(dateString) {
    if (!dateString) return null;
    
    try {
        const expirationDate = new Date(dateString);
        const today = new Date();
        const diffTime = expirationDate.getTime() - today.getTime();
        return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    } catch (error) {
        return null;
    }
}

// Генерация рекомендаций по настройке системы
function generateSetupRecommendations(summary, activeSubscriptions) {
    const recommendations = [];
    
    // Анализ типов абонементов
    const subscriptionTypes = Object.keys(summary.subscription_types);
    if (subscriptionTypes.length > 1) {
        const mostCommonType = Object.entries(summary.subscription_types)
            .sort((a, b) => b[1] - a[1])[0][0];
        
        recommendations.push(`Самый частый тип абонемента: "${mostCommonType}" (${summary.subscription_types[mostCommonType]} случаев)`);
    }
    
    // Анализ количества занятий
    const mostCommonClasses = Object.entries(summary.class_distribution)
        .filter(([_, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])[0];
    
    if (mostCommonClasses) {
        recommendations.push(`Самый частый абонемент: ${mostCommonClasses[0]} (${mostCommonClasses[1]} случаев)`);
    }
    
    // Проблемы с данными
    if (summary.problematic_cases.length > 0) {
        const problemPercentage = (summary.problematic_cases.length / summary.active_subscriptions_found * 100).toFixed(1);
        recommendations.push(`Обнаружены проблемы в ${problemPercentage}% активных абонементов`);
    }
    
    // Рекомендации по настройке парсинга
    const firstActive = activeSubscriptions[0];
    if (firstActive) {
        recommendations.push(`Пример для настройки: сделка ${firstActive.lead.id} (${firstActive.student.name})`);
        recommendations.push(`ID поля "Абонемент занятий:": 850241`);
        recommendations.push(`ID поля "Счетчик занятий:": 850257`);
        recommendations.push(`ID поля "Остаток занятий": 890163`);
        recommendations.push(`ID поля "Дата активации": 851565`);
        recommendations.push(`ID поля "Дата окончания": 850255`);
    }
    
    // Рекомендации по логике
    recommendations.push('Добавить пересчет остатка занятий: total - used = remaining');
    recommendations.push('Проверять статус сделки: должен быть активным в воронке абонементов');
    recommendations.push('Проверять дату окончания: абонемент активен если не истек');
    
    return recommendations;
}
// ==================== ДИАГНОСТИКА ДЛЯ ПРИЛОЖЕНИЯ ====================
app.get('/api/debug/for-app/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n📱 ДИАГНОСТИКА ДЛЯ ПРИЛОЖЕНИЯ`);
        console.log(`📱 Телефон: ${phone}`);
        console.log(`👤 Ученик: "${studentName}"`);
        console.log('='.repeat(80));
        
        // 1. Получаем контакты
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // 2. Получаем профили через getStudentsByPhone
        const profiles = await amoCrmService.getStudentsByPhone(phone);
        
        console.log(`📊 Профилей найдено: ${profiles.length}`);
        
        // 3. Находим нужного ученика
        const targetProfile = profiles.find(p => 
            p.student_name.toLowerCase().includes(studentName.toLowerCase()) ||
            studentName.toLowerCase().includes(p.student_name.toLowerCase())
        );
        
        if (!targetProfile) {
            return res.json({
                success: false,
                error: `Ученик "${studentName}" не найден`,
                available_students: profiles.map(p => p.student_name)
            });
        }
        
        console.log(`\n🎯 ПРОФИЛЬ, КОТОРЫЙ ВИДИТ ПРИЛОЖЕНИЕ:`);
        console.log(`👤 Ученик: ${targetProfile.student_name}`);
        console.log(`🏫 Филиал: ${targetProfile.branch}`);
        console.log(`🎫 Абонемент: ${targetProfile.subscription_status}`);
        console.log(`📊 Занятий: ${targetProfile.used_classes}/${targetProfile.total_classes} (осталось: ${targetProfile.remaining_classes})`);
        console.log(`✅ Активен: ${targetProfile.subscription_active === 1 ? 'Да' : 'Нет'}`);
        
        // 4. Проверяем lead_data
        let leadData = null;
        if (targetProfile.lead_data && targetProfile.lead_data !== '{}') {
            try {
                leadData = JSON.parse(targetProfile.lead_data);
                console.log(`📄 Lead ID: ${leadData.id}`);
                console.log(`📄 Lead Name: "${leadData.name}"`);
            } catch (e) {
                console.log('❌ Ошибка парсинга lead_data');
            }
        }
        
        // 5. Проверяем, правильно ли выбран lead
        const correctLeadId = 28674081; // ID правильной сделки
        const isCorrectLead = leadData && leadData.id === correctLeadId;
        
        if (!isCorrectLead) {
            console.log(`\n⚠️  ВНИМАНИЕ: Приложение видит НЕ ту сделку!`);
            console.log(`   ❌ Текущий lead_id: ${leadData?.id || 'не найден'}`);
            console.log(`   ✅ Правильный lead_id: ${correctLeadId}`);
            
            // Получаем все сделки контакта
            const allLeads = await amoCrmService.getContactLeadsSorted(contact.id);
            const leadsWithSubscriptions = allLeads.filter(lead => {
                const info = amoCrmService.extractSubscriptionInfo(lead);
                return info.hasSubscription;
            });
            
            console.log(`\n📊 Все сделки с абонементами у контакта:`);
            leadsWithSubscriptions.forEach((lead, index) => {
                const info = amoCrmService.extractSubscriptionInfo(lead);
                console.log(`\n${index + 1}. "${lead.name}" (ID: ${lead.id})`);
                console.log(`   📊 ${info.usedClasses}/${info.totalClasses} занятий`);
                console.log(`   🎯 ${info.subscriptionStatus}`);
                console.log(`   ✅ Активен: ${info.subscriptionActive ? 'Да' : 'Нет'}`);
                console.log(`   📍 Воронка: ${lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID ? '✅ Да' : '❌ Нет'}`);
            });
        }
        
        res.json({
            success: true,
            data: {
                profile: targetProfile,
                lead_data: leadData,
                is_correct_lead: isCorrectLead,
                correct_lead_id: correctLeadId,
                debug: {
                    profiles_count: profiles.length,
                    profiles: profiles.map(p => ({
                        student_name: p.student_name,
                        total_classes: p.total_classes,
                        remaining_classes: p.remaining_classes,
                        lead_id: p.lead_data && p.lead_data !== '{}' ? JSON.parse(p.lead_data)?.id : null
                    }))
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ПРОВЕРКА ВСЕХ СДЕЛОК КОНТАКТА ====================
app.get('/api/debug/contact-leads/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n🔍 ВСЕ СДЕЛКИ ДЛЯ ТЕЛЕФОНА: ${phone}`);
        
        // Ищем контакты
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        if (contacts.length === 0) {
            return res.json({ success: false, message: 'Контакты не найдены' });
        }
        
        const allLeads = [];
        
        for (const contact of contacts) {
            console.log(`\n📋 КОНТАКТ: "${contact.name}" (ID: ${contact.id})`);
            
            // Получаем учеников
            const fullContact = await amoCrmService.getFullContactInfo(contact.id);
            const students = amoCrmService.extractStudentsFromContact(fullContact);
            console.log(`👥 Ученики: ${students.map(s => s.studentName).join(', ')}`);
            
            // Получаем ВСЕ сделки
            const leads = await amoCrmService.getContactLeadsSorted(contact.id);
            console.log(`📊 Всего сделок: ${leads.length}`);
            
            // Анализируем каждую сделку
            for (const lead of leads) {
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                allLeads.push({
                    contact_id: contact.id,
                    contact_name: contact.name,
                    lead_id: lead.id,
                    lead_name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    created_at: new Date(lead.created_at * 1000).toISOString(),
                    updated_at: new Date(lead.updated_at * 1000).toISOString(),
                    subscription_info: subscriptionInfo,
                    is_best_candidate: this.isBestLeadForStudent(lead, 'Захар Веребрюсов', subscriptionInfo)
                });
                
                console.log(`\n   📄 ${lead.id}: "${lead.name}"`);
                console.log(`      📍 Pipeline: ${lead.pipeline_id}, Status: ${lead.status_id}`);
                console.log(`      📅 Обновлено: ${new Date(lead.updated_at * 1000).toLocaleDateString('ru-RU')}`);
                console.log(`      🎫 Абонемент: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
                if (subscriptionInfo.hasSubscription) {
                    console.log(`      📊 ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses} занятий`);
                    console.log(`      🎯 ${subscriptionInfo.subscriptionStatus}`);
                    console.log(`      🔥 Лучший кандидат: ${this.isBestLeadForStudent(lead, 'Захар Веребрюсов', subscriptionInfo) ? '✅ Да' : '❌ Нет'}`);
                }
            }
        }
        
        // Сортируем по приоритету
        const sortedLeads = allLeads
            .filter(l => l.subscription_info.hasSubscription)
            .sort((a, b) => {
                // 1. По активности
                if (a.subscription_info.subscriptionActive !== b.subscription_info.subscriptionActive) {
                    return b.subscription_info.subscriptionActive - a.subscription_info.subscriptionActive;
                }
                // 2. По остатку занятий
                if (a.subscription_info.remainingClasses !== b.subscription_info.remainingClasses) {
                    return b.subscription_info.remainingClasses - a.subscription_info.remainingClasses;
                }
                // 3. По свежести
                return new Date(b.updated_at) - new Date(a.updated_at);
            });
        
        res.json({
            success: true,
            message: `Найдено сделок: ${allLeads.length}`,
            data: {
                contacts_count: contacts.length,
                leads_count: allLeads.length,
                all_leads: allLeads,
                subscription_leads: allLeads.filter(l => l.subscription_info.hasSubscription),
                sorted_best_candidates: sortedLeads.slice(0, 5)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Добавьте этот маршрут
app.get('/api/debug/fix-selection/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔧 ИСПРАВЛЕНИЕ ВЫБОРА ДЛЯ: "${studentName}" (${phone})`);
        
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        const result = await amoCrmService.debugLeadSelection(contact.id, studentName);
        
        if (result) {
            // Создаем профиль с правильными данными
            const fullContact = await amoCrmService.getFullContactInfo(contact.id);
            const students = amoCrmService.extractStudentsFromContact(fullContact);
            const targetStudent = students.find(s => 
                s.studentName.toLowerCase().includes(studentName.toLowerCase())
            );
            
            if (targetStudent) {
                const profile = amoCrmService.createStudentProfile(
                    fullContact,
                    phone,
                    targetStudent,
                    result.subscription_info,
                    { id: result.lead_id, name: result.lead_name }
                );
                
                return res.json({
                    success: true,
                    message: 'Исправление выполнено',
                    data: {
                        best_lead: result,
                        profile: profile
                    }
                });
            }
        }
        
        return res.json({
            success: false,
            error: 'Не удалось найти подходящую сделку'
        });
        
    } catch (error) {
        console.error('❌ Ошибка исправления:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ДИАГНОСТИКА ВСЕХ АКТИВНЫХ АБОНЕМЕНТОВ ====================
app.get('/api/debug/active-subscriptions', async (req, res) => {
    try {
        console.log('\n' + '='.repeat(120));
        console.log('📊 ДИАГНОСТИКА ВСЕХ АКТИВНЫХ АБОНЕМЕНТОВ В CRM');
        console.log('='.repeat(120));
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const startTime = Date.now();
        
        // 1. ПОЛУЧАЕМ ВСЕ СДЕЛКИ ИЗ ВОРОНКИ АБОНЕМЕНТОВ
        console.log('\n🔍 Поиск сделок в воронке абонементов...');
        
        let allLeads = [];
        let page = 1;
        const limit = 250;
        
        while (true) {
            try {
                const response = await amoCrmService.makeRequest(
                    'GET',
                    `/api/v4/leads?with=custom_fields_values&page=${page}&limit=${limit}&filter[pipeline_id][]=${amoCrmService.SUBSCRIPTION_PIPELINE_ID}`
                );
                
                const leads = response._embedded?.leads || [];
                if (leads.length === 0) break;
                
                allLeads = [...allLeads, ...leads];
                console.log(`📥 Загружено страниц: ${page}, сделок: ${allLeads.length}`);
                
                if (leads.length < limit) break;
                page++;
                
                // Ограничим для безопасности
                if (page > 10) {
                    console.log(`⚠️  Ограничение: загружено максимум 10 страниц`);
                    break;
                }
                
                // Небольшая пауза между запросами
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (pageError) {
                console.error(`❌ Ошибка загрузки страницы ${page}:`, pageError.message);
                break;
            }
        }
        
        console.log(`✅ Всего загружено сделок: ${allLeads.length}`);
        
        // 2. АНАЛИЗИРУЕМ КАЖДУЮ СДЕЛКУ
        console.log('\n🔍 Анализ каждой сделки на наличие активного абонемента...');
        
        const activeSubscriptions = [];
        let skippedCount = 0;
        
        for (const lead of allLeads) {
            try {
                // Извлекаем информацию об абонементе
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                // Проверяем, является ли абонемент активным
                const isActive = subscriptionInfo.hasSubscription && 
                               subscriptionInfo.subscriptionActive;
                
                if (!isActive) {
                    skippedCount++;
                    continue;
                }
                
                // 3. НАХОДИМ КОНТАКТ (РОДИТЕЛЯ) ДЛЯ ЭТОЙ СДЕЛКИ
                console.log(`\n🔗 Поиск контакта для сделки ${lead.id}...`);
                
                let contact = null;
                let phone = 'Не найден';
                let parentName = 'Не найден';
                let studentName = amoCrmService.extractStudentNameFromLead(lead.name);
                
                // Получаем связанные контакты
                try {
                    const linksResponse = await amoCrmService.makeRequest(
                        'GET',
                        `/api/v4/leads/${lead.id}/links`
                    );
                    
                    const links = linksResponse._embedded?.links || [];
                    
                    for (const link of links) {
                        if (link.to_entity_type === 'contacts') {
                            const contactResponse = await amoCrmService.makeRequest(
                                'GET',
                                `/api/v4/contacts/${link.to_entity_id}?with=custom_fields_values`
                            );
                            
                            if (contactResponse) {
                                contact = contactResponse;
                                parentName = contact.name || 'Не указан';
                                
                                // Ищем телефон
                                const customFields = contact.custom_fields_values || [];
                                const phoneField = customFields.find(f => {
                                    const fieldId = f.field_id || f.id;
                                    return fieldId === 216615 || // Основной телефон
                                           amoCrmService.isPhoneField(fieldId);
                                });
                                
                                if (phoneField) {
                                    phone = amoCrmService.getFieldValue(phoneField);
                                }
                                
                                // Пытаемся определить ученика из контакта
                                const students = amoCrmService.extractStudentsFromContact(contact);
                                const matchedStudent = students.find(s => 
                                    amoCrmService.checkIfLeadBelongsToStudent(lead.name, s.studentName)
                                );
                                
                                if (matchedStudent) {
                                    studentName = matchedStudent.studentName;
                                }
                                
                                break;
                            }
                        }
                    }
                } catch (linkError) {
                    console.error(`❌ Ошибка получения контакта:`, linkError.message);
                }
                
                // 4. СОБИРАЕМ ПОЛНУЮ ИНФОРМАЦИЮ
                const activeSubscription = {
                    // ИНФОРМАЦИЯ О СДЕЛКЕ
                    lead: {
                        id: lead.id,
                        name: lead.name,
                        pipeline_id: lead.pipeline_id,
                        status_id: lead.status_id,
                        status_name: await amoCrmService.getStatusName(lead.status_id),
                        created_at: new Date(lead.created_at * 1000).toISOString(),
                        updated_at: new Date(lead.updated_at * 1000).toISOString()
                    },
                    
                    // ИНФОРМАЦИЯ О КОНТАКТЕ (РОДИТЕЛЕ)
                    contact: contact ? {
                        id: contact.id,
                        name: parentName,
                        phone: phone,
                        email: amoCrmService.findEmail(contact)
                    } : null,
                    
                    // ИНФОРМАЦИЯ ОБ УЧЕНИКЕ
                    student: {
                        name: studentName,
                        extracted_from_lead: studentName !== 'Не найден'
                    },
                    
                    // ИНФОРМАЦИЯ ОБ АБОНЕМЕНТЕ
                    subscription: {
                        is_active: true,
                        total_classes: subscriptionInfo.totalClasses,
                        used_classes: subscriptionInfo.usedClasses,
                        remaining_classes: subscriptionInfo.remainingClasses,
                        subscription_type: subscriptionInfo.subscriptionType,
                        subscription_status: subscriptionInfo.subscriptionStatus,
                        is_frozen: subscriptionInfo.isFrozen,
                        
                        // ДАТЫ
                        activation_date: subscriptionInfo.activationDate,
                        expiration_date: subscriptionInfo.expirationDate,
                        last_visit_date: subscriptionInfo.lastVisitDate,
                        
                        // ВРЕМЕННЫЕ МЕТКИ
                        days_since_activation: calculateDaysSince(subscriptionInfo.activationDate),
                        days_until_expiration: calculateDaysUntil(subscriptionInfo.expirationDate),
                        
                        // ПРОГРЕСС
                        progress_percentage: subscriptionInfo.totalClasses > 0 ? 
                            Math.round((subscriptionInfo.usedClasses / subscriptionInfo.totalClasses) * 100) : 0,
                        classes_remaining_percentage: subscriptionInfo.totalClasses > 0 ? 
                            Math.round((subscriptionInfo.remainingClasses / subscriptionInfo.totalClasses) * 100) : 0
                    },
                    
                    // ПОЛЯ ДЛЯ НАСТРОЙКИ СИСТЕМЫ
                    configuration_fields: {
                        // ID полей, которые используются в этой сделке
                        field_ids: amoCrmService.extractFieldIds(lead.custom_fields_values),
                        
                        // Примеры значений для настройки парсинга
                        field_examples: amoCrmService.getFieldExamples(lead.custom_fields_values),
                        
                        // Рекомендации по настройке
                        recommendations: amoCrmService.generateConfigurationRecommendations(subscriptionInfo, lead)
                    },
                    
                    // ДИАГНОСТИЧЕСКАЯ ИНФОРМАЦИЯ
                    diagnostics: {
                        data_source: 'amocrm_direct',
                        has_all_required_fields: amoCrmService.hasAllRequiredFields(lead.custom_fields_values),
                        data_quality_score: amoCrmService.calculateDataQualityScore(lead.custom_fields_values),
                        last_analysis: new Date().toISOString()
                    }
                };
                
                activeSubscriptions.push(activeSubscription);
                console.log(`✅ Найден активный абонемент: ${studentName} (${subscriptionInfo.remainingClasses} занятий осталось)`);
                
                // Ограничим вывод для отладки
                if (activeSubscriptions.length >= 50) {
                    console.log(`⚠️  Ограничение: показаны первые 50 активных абонементов`);
                    break;
                }
                
            } catch (leadError) {
                console.error(`❌ Ошибка анализа сделки ${lead.id}:`, leadError.message);
                continue;
            }
        }
        
        // 5. ФОРМИРУЕМ СВОДНЫЕ ДАННЫЕ
        console.log('\n📊 ФОРМИРОВАНИЕ СВОДНЫХ ДАННЫХ...');
        
        const summary = {
            total_leads_analyzed: allLeads.length,
            active_subscriptions_found: activeSubscriptions.length,
            inactive_or_incomplete: skippedCount,
            analysis_timestamp: new Date().toISOString(),
            
            // СТАТИСТИКА ПО ТИПАМ АБОНЕМЕНТОВ
            subscription_types: {},
            
            // СТАТИСТИКА ПО КОЛИЧЕСТВУ ЗАНЯТИЙ
            class_distribution: {
                '4 занятия': 0,
                '8 занятий': 0,
                '12 занятий': 0,
                '16 занятий': 0,
                '24 занятия': 0,
                'другое': 0
            },
            
            // ПРОБЛЕМНЫЕ СДЕЛКИ (для настройки)
            problematic_cases: []
        };
        
        // Анализируем статистику
        activeSubscriptions.forEach(sub => {
            // Типы абонементов
            const type = sub.subscription.subscription_type || 'Не указан';
            summary.subscription_types[type] = (summary.subscription_types[type] || 0) + 1;
            
            // Распределение по количеству занятий
            const total = sub.subscription.total_classes;
            if (total === 4) summary.class_distribution['4 занятия']++;
            else if (total === 8) summary.class_distribution['8 занятий']++;
            else if (total === 12) summary.class_distribution['12 занятий']++;
            else if (total === 16) summary.class_distribution['16 занятий']++;
            else if (total === 24) summary.class_distribution['24 занятия']++;
            else summary.class_distribution['другое']++;
            
            // Проверяем на проблемы с данными
            if (!sub.contact || !sub.contact.phone || sub.contact.phone === 'Не найден') {
                summary.problematic_cases.push({
                    lead_id: sub.lead.id,
                    lead_name: sub.lead.name,
                    issue: 'Не найден контакт или телефон',
                    student: sub.student.name
                });
            }
            
            if (!sub.subscription.activation_date || !sub.subscription.expiration_date) {
                summary.problematic_cases.push({
                    lead_id: sub.lead.id,
                    lead_name: sub.lead.name,
                    issue: 'Отсутствуют даты активации/окончания',
                    student: sub.student.name
                });
            }
        });
        
        // 6. ФОРМИРУЕМ РЕКОМЕНДАЦИИ ПО НАСТРОЙКЕ
        console.log('\n💡 ФОРМИРОВАНИЕ РЕКОМЕНДАЦИЙ...');
        
        const setupRecommendations = generateSetupRecommendations(summary, activeSubscriptions);
        
        // 7. ВЫВОД В КОНСОЛЬ
        console.log('\n' + '='.repeat(120));
        console.log('📈 РЕЗУЛЬТАТЫ ДИАГНОСТИКИ АКТИВНЫХ АБОНЕМЕНТОВ');
        console.log('='.repeat(120));
        
        console.log(`\n📊 ОБЩАЯ СТАТИСТИКА:`);
        console.log(`   • Проанализировано сделок: ${summary.total_leads_analyzed}`);
        console.log(`   • Найдено активных абонементов: ${summary.active_subscriptions_found}`);
        console.log(`   • Пропущено (неактивных/неполных): ${summary.inactive_or_incomplete}`);
        
        console.log(`\n🎯 ТИПЫ АБОНЕМЕНТОВ:`);
        Object.entries(summary.subscription_types).forEach(([type, count]) => {
            const percentage = (count / summary.active_subscriptions_found * 100).toFixed(1);
            console.log(`   • ${type}: ${count} (${percentage}%)`);
        });
        
        console.log(`\n📊 РАСПРЕДЕЛЕНИЕ ПО КОЛИЧЕСТВУ ЗАНЯТИЙ:`);
        Object.entries(summary.class_distribution).forEach(([range, count]) => {
            if (count > 0) {
                const percentage = (count / summary.active_subscriptions_found * 100).toFixed(1);
                console.log(`   • ${range}: ${count} (${percentage}%)`);
            }
        });
        
        if (summary.problematic_cases.length > 0) {
            console.log(`\n🚨 ПРОБЛЕМНЫЕ СЛУЧАИ (${summary.problematic_cases.length}):`);
            summary.problematic_cases.slice(0, 5).forEach((problem, index) => {
                console.log(`   ${index + 1}. "${problem.lead_name}"`);
                console.log(`      👤 Ученик: ${problem.student}`);
                console.log(`      ⚠️  Проблема: ${problem.issue}`);
            });
            
            if (summary.problematic_cases.length > 5) {
                console.log(`   ... и еще ${summary.problematic_cases.length - 5} случаев`);
            }
        }
        
        console.log(`\n💡 РЕКОМЕНДАЦИИ ПО НАСТРОЙКЕ:`);
        setupRecommendations.forEach((rec, index) => {
            console.log(`${index + 1}. ${rec}`);
        });
        
        // Показываем несколько примеров для настройки
        console.log(`\n🔧 ПРИМЕРЫ ДЛЯ НАСТРОЙКИ (первые 3):`);
        activeSubscriptions.slice(0, 3).forEach((sub, index) => {
            console.log(`\n${index + 1}. ${sub.student.name || 'Ученик'}:`);
            console.log(`   📱 Телефон: ${sub.contact?.phone || 'Не найден'}`);
            console.log(`   👨‍👦 Родитель: ${sub.contact?.name || 'Не найден'}`);
            console.log(`   📊 Абонемент: ${sub.subscription.total_classes} занятий`);
            console.log(`   ✅ Использовано: ${sub.subscription.used_classes}`);
            console.log(`   📅 Осталось: ${sub.subscription.remaining_classes}`);
            console.log(`   🗓️  Активация: ${sub.subscription.activation_date || 'Нет'}`);
            console.log(`   🗓️  Окончание: ${sub.subscription.expiration_date || 'Нет'}`);
            console.log(`   🆔 ID сделки: ${sub.lead.id}`);
            console.log(`   🆔 ID контакта: ${sub.contact?.id || 'Нет'}`);
        });
        
        const duration = Date.now() - startTime;
        console.log(`\n⏱️  Время выполнения: ${duration}ms`);
        console.log('='.repeat(120));
        
        res.json({
            success: true,
            message: `Найдено ${activeSubscriptions.length} активных абонементов`,
            timestamp: summary.analysis_timestamp,
            data: {
                summary: summary,
                active_subscriptions: activeSubscriptions,
                setup_recommendations: setupRecommendations,
                execution_time_ms: duration
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики активных абонементов:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// ==================== ТЕСТ ВЫБОРА СДЕЛКИ ====================
app.get('/api/test-lead-selection/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🧪 ТЕСТ ВЫБОРА СДЕЛКИ: "${studentName}" (${phone})`);
        console.log('='.repeat(80));
        
        // Ищем контакты
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // Получаем ВСЕ сделки
        const leads = await amoCrmService.getContactLeadsSorted(contact.id);
        console.log(`📊 Всего сделок: ${leads.length}`);
        
        // Анализируем каждую сделку
        const analyzedLeads = [];
        
        for (const lead of leads) {
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            
            if (!subscriptionInfo.hasSubscription) continue;
            
            const evaluation = {
                lead_id: lead.id,
                lead_name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                is_in_subscription_pipeline: lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID,
                subscription_info: subscriptionInfo,
                
                // Оценка
                name_match: amoCrmService.checkNameMatch(lead.name, studentName),
                is_active: subscriptionInfo.subscriptionActive,
                is_frozen: subscriptionInfo.isFrozen,
                remaining_classes: subscriptionInfo.remainingClasses,
                
                // Критерии
                criteria: {
                    exact_name_match: amoCrmService.checkNameMatch(lead.name, studentName).exact,
                    in_subscription_pipeline: lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID,
                    active_status: [142, 143, 65473306].includes(lead.status_id),
                    subscription_active: subscriptionInfo.subscriptionActive,
                    has_remaining_classes: subscriptionInfo.remainingClasses > 0,
                    not_frozen: !subscriptionInfo.isFrozen
                },
                
                // Штрафы
                penalties: {
                    has_expired_in_name: lead.name.toLowerCase().includes('истек') || 
                                        lead.name.toLowerCase().includes('закончился'),
                    is_one_time: lead.name.toLowerCase().includes('разовый'),
                    is_old: false // будет вычислено ниже
                },
                
                // Дата
                updated_at: new Date(lead.updated_at * 1000).toISOString(),
                days_ago: Math.floor((Date.now() - (lead.updated_at * 1000)) / (1000 * 60 * 60 * 24))
            };
            
            // Штраф за старую сделку
            if (evaluation.days_ago > 180) {
                evaluation.penalties.is_old = true;
            }
            
            analyzedLeads.push(evaluation);
        }
        
        // Сортируем по приоритету
        const sortedLeads = analyzedLeads.sort((a, b) => {
            // 1. Точное совпадение имени
            if (a.criteria.exact_name_match !== b.criteria.exact_name_match) {
                return b.criteria.exact_name_match - a.criteria.exact_name_match;
            }
            
            // 2. Воронка абонементов
            if (a.criteria.in_subscription_pipeline !== b.criteria.in_subscription_pipeline) {
                return b.criteria.in_subscription_pipeline - a.criteria.in_subscription_pipeline;
            }
            
            // 3. Активный абонемент
            if (a.criteria.subscription_active !== b.criteria.subscription_active) {
                return b.criteria.subscription_active - a.criteria.subscription_active;
            }
            
            // 4. Остаток занятий
            if (a.remaining_classes !== b.remaining_classes) {
                return b.remaining_classes - a.remaining_classes;
            }
            
            // 5. Свежесть
            return b.days_ago - a.days_ago;
        });
        
        console.log('\n🏆 РЕЗУЛЬТАТЫ:');
        console.log('='.repeat(80));
        
        sortedLeads.forEach((lead, index) => {
            console.log(`\n${index + 1}. "${lead.lead_name}"`);
            console.log(`   📊 ${lead.subscription_info.usedClasses}/${lead.subscription_info.totalClasses} занятий`);
            console.log(`   📈 Остаток: ${lead.remaining_classes}`);
            console.log(`   🎯 ${lead.subscription_info.subscriptionStatus}`);
            console.log(`   📍 Pipeline: ${lead.pipeline_id} (воронка: ${lead.is_in_subscription_pipeline ? '✅ Да' : '❌ Нет'})`);
            console.log(`   📅 ${lead.days_ago} дней назад`);
            
            if (lead.criteria.exact_name_match) {
                console.log(`   ⭐ ТОЧНОЕ СОВПАДЕНИЕ ИМЕНИ!`);
            }
        });
        
        res.json({
            success: true,
            data: {
                student_name: studentName,
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                total_leads: leads.length,
                subscription_leads: analyzedLeads.length,
                analyzed_leads: analyzedLeads,
                sorted_leads: sortedLeads,
                recommended_lead: sortedLeads[0] || null
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста выбора:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ТЕСТ ПРИЛОЖЕНИЯ ====================
app.get('/api/test-app/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        // Эмулируем запрос приложения
        const testResponse = {
            success: true,
            message: 'ТЕСТ: Что видит приложение',
            timestamp: new Date().toISOString(),
            
            // 1. Что возвращает текущий API
            current_api_response: {
                endpoint: '/api/auth/phone',
                method: 'POST',
                sample_request: { phone: phone },
                expected_response_structure: {
                    success: true,
                    data: {
                        user: { /* данные пользователя */ },
                        profiles: [{
                            student_name: '...',
                            subscription: {
                                active: true,
                                classes: {
                                    total: 8,
                                    used: 1,
                                    remaining: 7
                                }
                            }
                        }]
                    }
                }
            },
            
            // 2. Что на самом деле в amoCRM
            real_data_from_crm: null,
            
            // 3. Что в базе данных
            database_data: null
        };
        
        // Получаем реальные данные
        const formattedPhone = formatPhoneNumber(phone);
        
        // Из amoCRM
        const crmProfiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        testResponse.real_data_from_crm = crmProfiles.map(p => ({
            student_name: p.student_name,
            total_classes: p.total_classes,
            remaining_classes: p.remaining_classes,
            subscription_active: p.subscription_active
        }));
        
        // Из базы данных
        const dbProfiles = await db.all(
            `SELECT student_name, total_classes, remaining_classes, subscription_active, last_sync 
             FROM student_profiles 
             WHERE phone_number LIKE ?`,
            [`%${formattedPhone.slice(-10)}%`]
        );
        testResponse.database_data = dbProfiles;
        
        // Проверяем совпадение
        testResponse.data_match = crmProfiles.every(crmProfile => {
            const dbProfile = dbProfiles.find(p => p.student_name === crmProfile.student_name);
            return dbProfile && 
                   dbProfile.total_classes === crmProfile.total_classes &&
                   dbProfile.remaining_classes === crmProfile.remaining_classes;
        });
        
        res.json(testResponse);
        
    } catch (error) {
        console.error('❌ Ошибка теста приложения:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ==================== ТЕСТ КОНКРЕТНОЙ СДЕЛКИ ====================
app.get('/api/test-deal/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🧪 ТЕСТ СДЕЛКИ ${leadId}`);
        console.log('='.repeat(80));
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.status(404).json({ success: false, error: 'Сделка не найдена' });
        }
        
        console.log(`📋 Сделка: "${lead.name}"`);
        console.log(`📍 Pipeline: ${lead.pipeline_id}, Status: ${lead.status_id}`);
        
        // Тестируем extractSubscriptionInfo
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        // Проверяем поля вручную
        const customFields = lead.custom_fields_values || [];
        
        const manualCheck = {
            total_classes_field: customFields.find(f => f.field_id === 850241),
            used_classes_field: customFields.find(f => f.field_id === 850257),
            remaining_classes_field: customFields.find(f => f.field_id === 890163),
            activation_field: customFields.find(f => f.field_id === 851565),
            expiration_field: customFields.find(f => f.field_id === 850255),
            subscription_type_field: customFields.find(f => f.field_id === 891007)
        };
        
        // Парсим вручную
        const manualTotal = manualCheck.total_classes_field 
            ? amoCrmService.parseNumberFromField(amoCrmService.getFieldValue(manualCheck.total_classes_field))
            : 0;
            
        const manualUsed = manualCheck.used_classes_field
            ? amoCrmService.parseNumberFromField(amoCrmService.getFieldValue(manualCheck.used_classes_field))
            : 0;
            
        const manualRemaining = Math.max(0, manualTotal - manualUsed);
        
        res.json({
            success: true,
            data: {
                lead_info: {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    is_in_subscription_pipeline: lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID
                },
                subscription_info: subscriptionInfo,
                manual_calculation: {
                    total: manualTotal,
                    used: manualUsed,
                    remaining: manualRemaining,
                    calculated: manualTotal - manualUsed
                },
                fields_present: {
                    total: !!manualCheck.total_classes_field,
                    used: !!manualCheck.used_classes_field,
                    remaining: !!manualCheck.remaining_classes_field,
                    activation: !!manualCheck.activation_field,
                    expiration: !!manualCheck.expiration_field,
                    subscription_type: !!manualCheck.subscription_type_field
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ТЕСТ ПАРСИНГА КОНКРЕТНОЙ СДЕЛКИ ====================
app.get('/api/debug/parsing/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        const result = await amoCrmService.debugLeadParsing(leadId);
        
        if (!result) {
            return res.status(404).json({ success: false, error: 'Сделка не найдена' });
        }
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста парсинга:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ТЕСТ ПОИСКА УЧЕНИКА С ДЕТАЛЯМИ ====================
app.get('/api/test-full/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🧪 ПОЛНЫЙ ТЕСТ: ${studentName} (${phone})`);
        console.log('='.repeat(80));
        
        // 1. Ищем контакты
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const results = [];
        
        for (const contact of contacts) {
            console.log(`\n📋 КОНТАКТ: "${contact.name}" (ID: ${contact.id})`);
            
            const fullContact = await amoCrmService.getFullContactInfo(contact.id);
            const students = amoCrmService.extractStudentsFromContact(fullContact);
            
            console.log(`👥 Ученики: ${students.map(s => s.studentName).join(', ')}`);
            
            const targetStudent = students.find(s => 
                s.studentName.toLowerCase().includes(studentName.toLowerCase())
            );
            
            if (!targetStudent) continue;
            
            console.log(`✅ Найден ученик: "${targetStudent.studentName}"`);
            
            // Получаем ВСЕ сделки
            const leads = await amoCrmService.getContactLeadsSorted(contact.id);
            console.log(`📊 Сделок у контакта: ${leads.length}`);
            
            const leadResults = [];
            
            for (const lead of leads) {
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                if (!subscriptionInfo.hasSubscription) continue;
                
                // ВЫЧИСЛЯЕМ правильный остаток
                const correctRemaining = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                
                leadResults.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    has_subscription: subscriptionInfo.hasSubscription,
                    total_classes: subscriptionInfo.totalClasses,
                    used_classes: subscriptionInfo.usedClasses,
                    remaining_in_field: subscriptionInfo.remainingClasses,
                    remaining_calculated: correctRemaining,
                    subscription_active: subscriptionInfo.subscriptionActive,
                    subscription_status: subscriptionInfo.subscriptionStatus,
                    is_in_subscription_pipeline: lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID
                });
            }
            
            results.push({
                contact_id: contact.id,
                contact_name: contact.name,
                student: targetStudent,
                leads_with_subscription: leadResults.length,
                leads: leadResults
            });
            
            break; // Обрабатываем только первый найденный контакт
        }
        
        res.json({
            success: true,
            message: `Найдено результатов: ${results.length}`,
            data: results
        });
        
    } catch (error) {
        console.error('❌ Ошибка полного теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ТЕСТОВЫЙ МАРШРУТ ДЛЯ ПРОВЕРКИ ИСПРАВЛЕНИЯ ====================
app.get('/api/test-fix/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🧪 ТЕСТ ИСПРАВЛЕННОЙ ЛОГИКИ`);
        console.log(`📱 Телефон: ${phone}`);
        console.log(`👤 Ученик: "${studentName}"`);
        console.log('='.repeat(60));
        
        // Ищем контакт
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // Извлекаем учеников
        const fullContact = await amoCrmService.getFullContactInfo(contact.id);
        const students = amoCrmService.extractStudentsFromContact(fullContact);
        console.log(`👥 Ученики в контакте: ${students.map(s => s.studentName).join(', ')}`);
        
        // Ищем нужного ученика
        const targetStudent = students.find(s => 
            s.studentName.toLowerCase().includes(studentName.toLowerCase())
        );
        
        if (!targetStudent) {
            return res.json({ 
                success: false, 
                error: `Ученик "${studentName}" не найден в контакте`,
                available_students: students.map(s => s.studentName)
            });
        }
        
        console.log(`✅ Найден ученик: "${targetStudent.studentName}"`);
        
        // Тестируем поиск сделки
        const result = await amoCrmService.findLeadForStudent(contact.id, studentName);
        
        res.json({
            success: true,
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                student: targetStudent,
                result: result ? {
                    lead_id: result.lead.id,
                    lead_name: result.lead.name,
                    subscription_info: result.subscriptionInfo
                } : null
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ГЛУБОКАЯ ОТЛАДКА ВЫБОРА СДЕЛКИ ====================
app.get('/api/debug/lead-selection/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ГЛУБОКАЯ ОТЛАДКА ВЫБОРА СДЕЛКИ`);
        console.log(`📱 Телефон: ${phone}`);
        console.log(`👤 Ученик: "${studentName}"`);
        console.log('='.repeat(80));
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        // 1. Ищем контакты по телефону
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        if (contacts.length === 0) {
            return res.json({
                success: false,
                error: 'Контакты не найдены',
                phone: phone
            });
        }
        
        const analysis = {
            phone: phone,
            student_name: studentName,
            contacts: [],
            leads_analysis: [],
            selection_result: null,
            problems: []
        };
        
        // 2. Анализируем каждый контакт
        for (const contact of contacts) {
            console.log(`\n📋 КОНТАКТ: "${contact.name}" (ID: ${contact.id})`);
            
            const contactData = {
                id: contact.id,
                name: contact.name,
                students: [],
                leads_count: 0
            };
            
            // Получаем учеников из контакта
            const fullContact = await amoCrmService.getFullContactInfo(contact.id);
            const students = amoCrmService.extractStudentsFromContact(fullContact);
            
            console.log(`   👥 Учеников в контакте: ${students.length}`);
            students.forEach(student => {
                console.log(`   • ${student.studentName}`);
                contactData.students.push(student.studentName);
            });
            
            // Проверяем, есть ли нужный ученик
            const hasTargetStudent = students.some(student => 
                student.studentName.toLowerCase().includes(studentName.toLowerCase()) ||
                studentName.toLowerCase().includes(student.studentName.toLowerCase())
            );
            
            if (!hasTargetStudent) {
                console.log(`   ❌ Ученик "${studentName}" не найден в этом контакте`);
                analysis.problems.push(`Ученик не найден в контакте "${contact.name}"`);
                continue;
            }
            
            console.log(`   ✅ Ученик найден в контакте!`);
            
            // 3. Получаем все сделки контакта
            const leads = await amoCrmService.getContactLeadsSorted(contact.id);
            console.log(`   📊 Всего сделок у контакта: ${leads.length}`);
            
            contactData.leads_count = leads.length;
            analysis.contacts.push(contactData);
            
            // 4. Анализируем каждую сделку
            let leadIndex = 0;
            for (const lead of leads) {
                leadIndex++;
                console.log(`\n   🔍 СДЕЛКА ${leadIndex}: "${lead.name}" (ID: ${lead.id})`);
                
                // Извлекаем информацию об абонементе
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                console.log(`      🎫 Абонемент: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
                console.log(`      📊 Всего/Использовано/Остаток: ${subscriptionInfo.totalClasses}/${subscriptionInfo.usedClasses}/${subscriptionInfo.remainingClasses}`);
                console.log(`      🎯 Статус: ${subscriptionInfo.subscriptionStatus}`);
                console.log(`      ✅ Активен: ${subscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
                console.log(`      📍 Pipeline: ${lead.pipeline_id} (воронка абонементов: ${subscriptionInfo.isInSubscriptionPipeline ? '✅ Да' : '❌ Нет'})`);
                console.log(`      📅 Статус ID: ${lead.status_id}`);
                
                // Проверяем совпадение имени
                const exactMatch = amoCrmService.isExactNameMatch(lead.name, studentName);
                const partialMatch = amoCrmService.isPartialNameMatch(lead.name, studentName);
                
                console.log(`      👤 Совпадение имени:`);
                console.log(`         • Точное: ${exactMatch ? '✅ Да' : '❌ Нет'}`);
                console.log(`         • Частичное: ${partialMatch ? '✅ Да' : '❌ Нет'}`);
                
                // Проверяем поля
                const customFields = lead.custom_fields_values || [];
                const totalField = customFields.find(f => (f.field_id || f.id) === 850241);
                const usedField = customFields.find(f => (f.field_id || f.id) === 850257);
                const remainingField = customFields.find(f => (f.field_id || f.id) === 890163);
                
                console.log(`      📋 Ключевые поля:`);
                console.log(`         • 850241 (Абонемент занятий): ${totalField ? '✅ Заполнено' : '❌ Отсутствует'}`);
                console.log(`         • 850257 (Счетчик занятий): ${usedField ? '✅ Заполнено' : '❌ Отсутствует'}`);
                console.log(`         • 890163 (Остаток занятий): ${remainingField ? '✅ Заполнено' : '❌ Отсутствует (ВЫЧИСЛЯЕМ!)'}`);
                
                // Вычисляем правильный остаток
                const correctRemaining = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                const needsCorrection = subscriptionInfo.remainingClasses !== correctRemaining;
                
                if (needsCorrection) {
                    console.log(`      ⚠️  Некорректный остаток!`);
                    console.log(`         • В поле: ${subscriptionInfo.remainingClasses}`);
                    console.log(`         • Правильный: ${correctRemaining}`);
                    console.log(`         • Исправляем: ${subscriptionInfo.remainingClasses} → ${correctRemaining}`);
                }
                
                // Сохраняем анализ
                analysis.leads_analysis.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    is_in_subscription_pipeline: subscriptionInfo.isInSubscriptionPipeline,
                    subscription_info: subscriptionInfo,
                    name_match: {
                        exact: exactMatch,
                        partial: partialMatch
                    },
                    fields: {
                        total: totalField ? amoCrmService.getFieldValue(totalField) : null,
                        used: usedField ? amoCrmService.getFieldValue(usedField) : null,
                        remaining: remainingField ? amoCrmService.getFieldValue(remainingField) : null
                    },
                    needs_correction: needsCorrection,
                    correct_remaining: correctRemaining
                });
                
                // Ограничим количество анализируемых сделок
                if (leadIndex >= 20) {
                    console.log(`   ⚠️  Показаны первые 20 сделок`);
                    break;
                }
            }
            
            // 5. Запускаем выбор сделки
            console.log(`\n   🎯 ЗАПУСКАЕМ ВЫБОР СДЕЛКИ ДЛЯ "${studentName}"...`);
            
            const selectionResult = await amoCrmService.findLeadForStudent(contact.id, studentName);
            
            if (selectionResult) {
                console.log(`   ✅ ВЫБРАНА СДЕЛКА:`);
                console.log(`      📋 "${selectionResult.lead.name}"`);
                console.log(`      🏆 Баллы: ${selectionResult.selection_metadata?.score || 'N/A'}`);
                console.log(`      📊 Занятий: ${selectionResult.subscriptionInfo.usedClasses}/${selectionResult.subscriptionInfo.totalClasses}`);
                console.log(`      📈 Остаток: ${selectionResult.subscriptionInfo.remainingClasses}`);
                
                analysis.selection_result = {
                    lead_id: selectionResult.lead.id,
                    lead_name: selectionResult.lead.name,
                    subscription_info: selectionResult.subscriptionInfo,
                    selection_metadata: selectionResult.selection_metadata
                };
                
                break; // Нашли ученика и выбрали сделку, выходим
            } else {
                console.log(`   ❌ НЕ ВЫБРАНО НИ ОДНОЙ СДЕЛКИ!`);
                
                // Анализируем почему
                const potentialLeads = analysis.leads_analysis.filter(lead => 
                    lead.subscription_info.hasSubscription
                );
                
                if (potentialLeads.length === 0) {
                    analysis.problems.push('Нет сделок с абонементами у контакта');
                } else {
                    analysis.problems.push(`Есть ${potentialLeads.length} сделок с абонементами, но ни одна не выбрана`);
                    
                    // Показываем потенциальные сделки
                    console.log(`   🔍 ПОТЕНЦИАЛЬНЫЕ СДЕЛКИ С АБОНЕМЕНТАМИ:`);
                    potentialLeads.forEach((lead, index) => {
                        console.log(`      ${index + 1}. "${lead.lead_name}"`);
                        console.log(`         📊 ${lead.subscription_info.usedClasses}/${lead.subscription_info.totalClasses}`);
                        console.log(`         🎯 ${lead.subscription_info.subscriptionStatus}`);
                        console.log(`         📍 Воронка: ${lead.is_in_subscription_pipeline ? '✅ Да' : '❌ Нет'}`);
                    });
                }
            }
        }
        
        // 6. Генерация рекомендаций
        console.log('\n' + '='.repeat(80));
        console.log('💡 РЕКОМЕНДАЦИИ:');
        
        if (analysis.selection_result) {
            console.log(`✅ Успешно выбрана сделка!`);
            
            // Проверяем корректность данных
            const result = analysis.selection_result;
            const correctRemaining = Math.max(0, result.subscription_info.totalClasses - result.subscription_info.usedClasses);
            
            if (result.subscription_info.remainingClasses !== correctRemaining) {
                console.log(`⚠️  Остаток некорректный: ${result.subscription_info.remainingClasses} → должно быть ${correctRemaining}`);
                console.log(`   РЕКОМЕНДАЦИЯ: Исправить extractSubscriptionInfo() чтобы ВСЕГДА вычислять остаток`);
            }
            
            if (!result.subscription_info.hasSubscription) {
                console.log(`❌ Сделка выбрана, но в ней нет данных об абонементе!`);
            }
            
        } else {
            console.log(`❌ Сделка не выбрана. Причины:`);
            analysis.problems.forEach(problem => console.log(`   • ${problem}`));
            
            // Проверяем, есть ли вообще сделки с абонементами
            const leadsWithSubscription = analysis.leads_analysis.filter(lead => 
                lead.subscription_info.hasSubscription
            );
            
            if (leadsWithSubscription.length > 0) {
                console.log(`\n🔍 АНАЛИЗ ПОТЕНЦИАЛЬНЫХ СДЕЛОК:`);
                
                leadsWithSubscription.forEach((lead, index) => {
                    console.log(`\n${index + 1}. "${lead.lead_name}"`);
                    console.log(`   📊 ${lead.subscription_info.usedClasses}/${lead.subscription_info.totalClasses} занятий`);
                    console.log(`   🎯 ${lead.subscription_info.subscriptionStatus}`);
                    console.log(`   ✅ Активен: ${lead.subscription_info.subscriptionActive ? 'Да' : 'Нет'}`);
                    console.log(`   📍 Воронка: ${lead.is_in_subscription_pipeline ? '✅ Да' : '❌ Нет'}`);
                    console.log(`   👤 Совпадение: ${lead.name_match.exact ? 'Точное' : lead.name_match.partial ? 'Частичное' : 'Нет'}`);
                    
                    // Почему не выбрана?
                    const reasons = [];
                    if (!lead.is_in_subscription_pipeline) reasons.push('Не в воронке абонементов');
                    if (!lead.subscription_info.subscriptionActive) reasons.push('Не активен');
                    if (lead.subscription_info.remainingClasses <= 0) reasons.push('Нет остатка занятий');
                    if (!lead.name_match.exact && !lead.name_match.partial) reasons.push('Нет совпадения имени');
                    
                    if (reasons.length > 0) {
                        console.log(`   ❌ Не выбрана из-за: ${reasons.join(', ')}`);
                    }
                });
            }
        }
        
        console.log('='.repeat(80));
        
        res.json({
            success: true,
            message: analysis.selection_result ? 'Сделка выбрана' : 'Сделка не выбрана',
            data: analysis
        });
        
    } catch (error) {
        console.error('❌ Ошибка отладки выбора:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Тестовый маршрут для отладки парсинга
app.get('/api/debug/field-parsing/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.status(404).json({ success: false, error: 'Сделка не найдена' });
        }
        
        const customFields = lead.custom_fields_values || [];
        const analysis = {};
        
        // Анализируем каждое поле
        customFields.forEach(field => {
            const fieldId = field.field_id || field.id;
            const fieldName = field.field_name || `Поле ${fieldId}`;
            const fieldType = field.field_type || field.type;
            
            const rawValue = field.values ? field.values[0] : null;
            const parsedValue = amoCrmService.getFieldValue(field);
            const numericValue = amoCrmService.parseNumberFromField(parsedValue);
            
            analysis[fieldName] = {
                field_id: fieldId,
                field_type: fieldType,
                raw_value: rawValue,
                parsed_value: parsedValue,
                numeric_value: numericValue,
                enum_id: field.values?.[0]?.enum_id,
                value: field.values?.[0]?.value
            };
        });
        
        // Проверяем конкретные поля
        const criticalFields = [
            { id: 850241, name: 'Абонемент занятий:' },
            { id: 850257, name: 'Счетчик занятий:' },
            { id: 890163, name: 'Остаток занятий' },
            { id: 851565, name: 'Дата активации абонемента:' },
            { id: 850255, name: 'Окончание абонемента:' },
            { id: 891007, name: 'Тип абонемента' }
        ];
        
        const criticalAnalysis = {};
        criticalFields.forEach(fieldDef => {
            const field = customFields.find(f => (f.field_id || f.id) === fieldDef.id);
            if (field) {
                criticalAnalysis[fieldDef.name] = {
                    exists: true,
                    value: amoCrmService.getFieldValue(field),
                    number: amoCrmService.parseNumberFromField(amoCrmService.getFieldValue(field))
                };
            } else {
                criticalAnalysis[fieldDef.name] = { exists: false };
            }
        });
        
        res.json({
            success: true,
            lead_name: lead.name,
            pipeline_id: lead.pipeline_id,
            status_id: lead.status_id,
            critical_fields: criticalAnalysis,
            all_fields: analysis
        });
        
    } catch (error) {
        console.error('❌ Ошибка отладки:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== БЫСТРЫЙ ТЕСТ ВЫБОРА ====================
app.get('/api/test-selection/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🧪 БЫСТРЫЙ ТЕСТ ВЫБОРА ДЛЯ: ${studentName} (${phone})`);
        
        // Используем существующий метод поиска
        const profiles = await amoCrmService.getStudentsByPhone(phone);
        
        const targetProfile = profiles.find(p => 
            p.student_name.toLowerCase().includes(studentName.toLowerCase()) ||
            studentName.toLowerCase().includes(p.student_name.toLowerCase())
        );
        
        if (!targetProfile) {
            return res.json({
                success: false,
                message: `Ученик "${studentName}" не найден`,
                profiles_found: profiles.length,
                profiles: profiles.map(p => p.student_name)
            });
        }
        
        res.json({
            success: true,
            message: `Найден профиль для "${studentName}"`,
            data: {
                profile: {
                    student_name: targetProfile.student_name,
                    subscription_status: targetProfile.subscription_status,
                    total_classes: targetProfile.total_classes,
                    remaining_classes: targetProfile.remaining_classes,
                    used_classes: targetProfile.used_classes,
                    subscription_active: targetProfile.subscription_active === 1,
                    has_subscription: targetProfile.total_classes > 0
                },
                raw_data: {
                    amocrm_lead_id: targetProfile.amocrm_lead_id,
                    amocrm_contact_id: targetProfile.amocrm_contact_id,
                    lead_data: targetProfile.lead_data ? JSON.parse(targetProfile.lead_data) : null
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ПРОВЕРКА КОНТАКТА ====================
app.get('/api/debug/contact/:contactId/:studentName', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ПРОВЕРКА КОНТАКТА: ${contactId}, ученик: "${studentName}"`);
        
        // 1. Получаем контакт
        const contact = await amoCrmService.getFullContactInfo(contactId);
        if (!contact) {
            return res.status(404).json({
                success: false,
                error: 'Контакт не найден'
            });
        }
        
        console.log(`📋 Контакт: "${contact.name}"`);
        
        // 2. Проверяем учеников
        const students = amoCrmService.extractStudentsFromContact(contact);
        console.log(`👥 Учеников в контакте: ${students.length}`);
        students.forEach(s => console.log(`   • ${s.studentName}`));
        
        const targetStudent = students.find(s => 
            s.studentName.toLowerCase().includes(studentName.toLowerCase()) ||
            studentName.toLowerCase().includes(s.studentName.toLowerCase())
        );
        
        if (!targetStudent) {
            return res.json({
                success: false,
                error: `Ученик "${studentName}" не найден в контакте`,
                available_students: students.map(s => s.studentName)
            });
        }
        
        console.log(`✅ Ученик найден: "${targetStudent.studentName}"`);
        
        // 3. Запускаем выбор сделки
        console.log(`\n🎯 ЗАПУСКАЕМ ВЫБОР СДЕЛКИ...`);
        const result = await amoCrmService.findLeadForStudent(contactId, studentName);
        
        if (!result) {
            console.log(`❌ Сделка не выбрана!`);
            
            // Получаем все сделки чтобы понять почему
            const allLeads = await amoCrmService.getContactLeadsSorted(contactId);
            const leadsWithSubscription = allLeads.filter(lead => {
                const info = amoCrmService.extractSubscriptionInfo(lead);
                return info.hasSubscription;
            });
            
            return res.json({
                success: false,
                message: 'Сделка не выбрана',
                data: {
                    contact: {
                        id: contact.id,
                        name: contact.name
                    },
                    student: targetStudent.studentName,
                    total_leads: allLeads.length,
                    leads_with_subscription: leadsWithSubscription.length,
                    potential_leads: leadsWithSubscription.map(lead => ({
                        id: lead.id,
                        name: lead.name,
                        subscription_info: amoCrmService.extractSubscriptionInfo(lead)
                    })),
                    possible_reasons: [
                        'Нет сделок в воронке абонементов',
                        'Нет совпадения имени',
                        'Все абонементы использованы',
                        'Абонементы заморожены'
                    ]
                }
            });
        }
        
        console.log(`✅ Выбрана сделка: "${result.lead.name}"`);
        
        res.json({
            success: true,
            message: 'Сделка выбрана',
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                student: targetStudent.studentName,
                selected_lead: {
                    id: result.lead.id,
                    name: result.lead.name,
                    pipeline_id: result.lead.pipeline_id,
                    status_id: result.lead.status_id
                },
                subscription_info: result.subscriptionInfo,
                selection_metadata: result.selection_metadata
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Диагностика сделки
app.get('/api/debug/lead/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ДИАГНОСТИКА СДЕЛКИ: ${leadId}`);
        console.log('='.repeat(80));
        
        const analysis = await amoCrmService.debugLeadAnalysis(leadId);
        
        if (!analysis) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        res.json({
            success: true,
            message: 'Анализ сделки выполнен',
            timestamp: new Date().toISOString(),
            data: analysis
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики сделки:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Проверка соединения с amoCRM
app.get('/api/debug/connection', async (req, res) => {
    try {
        console.log('\n🔍 ПРОВЕРКА СВЯЗИ С AMOCRM');
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован',
                timestamp: new Date().toISOString()
            });
        }
        
        const accountInfo = await amoCrmService.makeRequest('GET', '/api/v4/account');
        
        res.json({
            success: true,
            message: 'Соединение с amoCRM установлено',
            timestamp: new Date().toISOString(),
            data: {
                account: accountInfo.name || 'Неизвестно',
                subdomain: AMOCRM_SUBDOMAIN,
                amocrm_domain: AMOCRM_DOMAIN,
                fields_loaded: amoCrmService.fieldMappings.size,
                service_initialized: amoCrmService.isInitialized,
                subscription_pipeline_id: amoCrmService.SUBSCRIPTION_PIPELINE_ID
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки связи:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка соединения с amoCRM',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Статистика базы данных
app.get('/api/debug/database', async (req, res) => {
    try {
        console.log('\n📊 СТАТИСТИКА БАЗЫ ДАННЫХ');
        
        const stats = await db.get(`
            SELECT 
                COUNT(*) as total_profiles,
                SUM(CASE WHEN subscription_active = 1 THEN 1 ELSE 0 END) as active_subscriptions,
                SUM(CASE WHEN subscription_active = 0 THEN 1 ELSE 0 END) as inactive_subscriptions,
                AVG(total_classes) as avg_classes,
                AVG(remaining_classes) as avg_remaining,
                MIN(last_sync) as oldest_sync,
                MAX(last_sync) as latest_sync
            FROM student_profiles
            WHERE is_active = 1
        `);
        
        const recentProfiles = await db.all(`
            SELECT 
                student_name,
                branch,
                subscription_status,
                total_classes,
                remaining_classes,
                last_sync
            FROM student_profiles
            WHERE is_active = 1
            ORDER BY last_sync DESC
            LIMIT 10
        `);
        
        res.json({
            success: true,
            message: 'Статистика базы данных',
            timestamp: new Date().toISOString(),
            data: {
                statistics: stats,
                recent_profiles: recentProfiles,
                total_syncs: await db.get(`SELECT COUNT(*) as count FROM sync_logs`)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Принудительная синхронизация
app.post('/api/sync/now', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`\n🔄 ПРИНУДИТЕЛЬНАЯ СИНХРОНИЗАЦИЯ ДЛЯ: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        const savedCount = await saveProfilesToDatabase(profiles);
        
        res.json({
            success: true,
            message: 'Синхронизация выполнена',
            data: {
                phone: formattedPhone,
                profiles_found: profiles.length,
                profiles_saved: savedCount,
                last_sync: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка синхронизации:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Получение списка профилей
app.get('/api/profiles', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Токен не предоставлен'
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const phone = decoded.phone;
        
        const profiles = await db.all(
            `SELECT * FROM student_profiles 
             WHERE phone_number = ? AND is_active = 1
             ORDER BY 
               CASE WHEN subscription_active = 1 THEN 1 ELSE 2 END,
               student_name`,
            [phone]
        );
        
        const formattedProfiles = profiles.map(p => ({
            id: p.id,
            student_name: p.student_name,
            branch: p.branch || 'Филиал не указан',
            teacher_name: p.teacher_name,
            subscription_type: p.subscription_type,
            subscription_status: p.subscription_status,
            subscription_badge: p.subscription_badge,
            total_classes: p.total_classes,
            remaining_classes: p.remaining_classes,
            used_classes: p.used_classes,
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            is_active: p.subscription_active === 1,
            last_sync: p.last_sync
        }));
        
        res.json({
            success: true,
            data: {
                profiles: formattedProfiles,
                total: profiles.length,
                has_multiple: profiles.length > 1,
                last_sync: profiles.length > 0 ? profiles[0].last_sync : null
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения профилей:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профилей'
        });
    }
});

// Тест конкретной сделки
app.get('/api/test-lead/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        const result = await amoCrmService.testSpecificLead(leadId);
        
        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        res.json({
            success: true,
            message: 'Тест выполнен',
            data: result
        });
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Тест поиска учеников по телефону
app.get('/api/test-phone/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        console.log(`\n📱 ТЕСТ ПОИСКА УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phone}`);
        
        const profiles = await amoCrmService.getStudentsByPhone(phone);
        
        res.json({
            success: true,
            message: `Найдено учеников: ${profiles.length}`,
            data: {
                phone: phone,
                profiles_count: profiles.length,
                profiles: profiles.map(p => ({
                    student_name: p.student_name,
                    branch: p.branch,
                    subscription_status: p.subscription_status,
                    remaining_classes: p.remaining_classes,
                    total_classes: p.total_classes
                }))
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ОСНОВНЫЕ МАРШРУТЫ ====================
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        amocrm_status: amoCrmService.isInitialized ? 'connected' : 'disconnected',
        sync_status: syncService.getSyncStatus()
    });
});

app.get('/api/sync/status', async (req, res) => {
    try {
        const status = syncService.getSyncStatus();
        
        const lastSync = await db.get(
            `SELECT * FROM sync_logs 
             WHERE sync_type = 'auto_sync' 
             ORDER BY created_at DESC LIMIT 1`
        );
        
        res.json({
            success: true,
            data: {
                sync_status: status,
                last_sync: lastSync || null,
                amocrm_status: amoCrmService.isInitialized
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статуса синхронизации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статуса синхронизации'
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v2.0');
        console.log('='.repeat(80));
        console.log('✨ РЕАЛЬНЫЕ ДАННЫЕ ИЗ AMOCRM');
        console.log('✨ ВОРОНКА "!АБОНЕМЕНТ"');
        console.log('✨ АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            
            // Запускаем синхронизацию через 5 секунд
            setTimeout(() => {
                syncService.startAutoSync();
            }, 5000);
            
        } else {
            console.log('❌ amoCRM не инициализирован');
            console.log('❌ Невозможно получить данные без подключения к CRM');
        }
        
        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 Основной URL: http://localhost:${PORT}`);
            console.log(`📊 База данных: SQLite`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log(`🔄 Автосинхронизация: ✅ Каждые 10 минут`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`🔍 Профили: GET http://localhost:${PORT}/api/profiles`);
            console.log(`📋 Абонемент: POST http://localhost:3000/api/subscription`);
            console.log(`🔄 Статус синхронизации: GET http://localhost:${PORT}/api/sync/status`);
            console.log(`🔧 Диагностика телефона: GET http://localhost:${PORT}/api/debug/phone/79660587744`);
            console.log(`🧪 Тест сделки: GET http://localhost:${PORT}/api/test-lead/28674745`);
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
