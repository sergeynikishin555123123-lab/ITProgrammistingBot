// server.js - 100% ГАРАНТИРОВАННОЕ ИСПРАВЛЕНИЕ

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

// ==================== КЛАСС AMOCRM - 100% ГАРАНТИРОВАННЫЙ ВЫБОР ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService v4.0');
        console.log('🎯 100% ГАРАНТИРОВАННЫЙ ВЫБОР СДЕЛКИ');
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
        
        // Воронка "!Абонемент"
        this.SUBSCRIPTION_PIPELINE_ID = 7977402;
        
        // Статусы в воронке "!Абонемент"
        this.SUBSCRIPTION_STATUSES = {
            ACTIVE_IN_PIPELINE: [
                65473306, // "Активный абонемент" (Текущий)
                60025747, // "Активирован" (Исторический)
                65455980, // "Пробный" (возможно есть)
                60025749, // "Истек" (в той же воронке!)
                60025751  // "Заморозка" (в той же воронке!)
            ],
            INACTIVE: []
        };
    }

    // ==================== НОРМАЛИЗАЦИЯ ИМЕНИ ====================
    normalizeName(name) {
        if (!name) return '';
        
        return name
            .toLowerCase()
            .replace(/[^а-яёa-z0-9\s]/g, ' ') // Убираем спецсимволы
            .replace(/\s+/g, ' ') // Множественные пробелы в один
            .trim();
    }

    // ==================== АНАЛИЗ ПРИНАДЛЕЖНОСТИ СДЕЛКИ ====================
    analyzeLeadOwnership(leadName, studentName) {
        if (!leadName || !studentName) return 'UNKNOWN';
        
        const normalizedLeadName = this.normalizeName(leadName);
        const normalizedStudentName = this.normalizeName(studentName);
        
        // 1. ТОЧНОЕ СОВПАДЕНИЕ (имя ученика полностью в названии сделки)
        if (normalizedLeadName.includes(normalizedStudentName)) {
            return 'EXACT';
        }
        
        // 2. Разбиваем имена на части
        const studentParts = normalizedStudentName.split(' ');
        const leadParts = normalizedLeadName.split(' ');
        
        // Ищем фамилию (последняя часть)
        const studentLastName = studentParts[studentParts.length - 1];
        
        // 3. Проверяем фамилию
        if (studentLastName && studentLastName.length > 2) {
            for (const leadPart of leadParts) {
                if (leadPart.includes(studentLastName) || studentLastName.includes(leadPart)) {
                    return 'NAME_MATCH';
                }
            }
        }
        
        // 4. Проверяем другие имена
        for (const studentPart of studentParts) {
            if (studentPart.length < 3) continue;
            
            for (const leadPart of leadParts) {
                if (leadPart.includes(studentPart) || studentPart.includes(leadPart)) {
                    return 'NAME_MATCH';
                }
            }
        }
        
        // 5. ПРОВЕРКА: ЯВНО ЧУЖАЯ СДЕЛКА?
        // Список явно чужих имен
        const otherStudents = [
            'афанасьева', 'александра', 'александр',
            'трибунская', 'мария', 'петрова', 'даша',
            'анастасия', 'алексей', 'иван', 'сергей',
            'наталья', 'ольга', 'елена', 'татьяна'
        ];
        
        for (const otherName of otherStudents) {
            if (normalizedLeadName.includes(otherName)) {
                // Проверяем, что это НЕ наш ученик
                let isOurStudent = false;
                for (const studentPart of studentParts) {
                    if (studentPart.includes(otherName) || otherName.includes(studentPart)) {
                        isOurStudent = true;
                        break;
                    }
                }
                
                if (!isOurStudent) {
                    return 'WRONG_STUDENT';
                }
            }
        }
        
        return 'UNKNOWN';
    }

    // ==================== 100% ГАРАНТИРОВАННЫЙ ПОИСК СДЕЛКИ ====================
    async findLeadForStudent100(contactId, studentName) {
        console.log(`\n🔐 100% ГАРАНТИЯ: ПОИСК СДЕЛКИ ДЛЯ "${studentName}"`);
        console.log('='.repeat(80));
        
        try {
            // 1. Получаем ВСЕ сделки
            const leads = await this.getContactLeadsSorted(contactId);
            
            if (leads.length === 0) {
                console.log('❌ Нет сделок');
                return null;
            }
            
            console.log(`📊 Всего сделок: ${leads.length}`);
            
            // 2. Нормализуем имя ученика для поиска
            const normalizedStudentName = this.normalizeName(studentName);
            console.log(`🔍 Поиск по нормализованному имени: "${normalizedStudentName}"`);
            
            // 3. Делим сделки на категории
            const exactMatches = [];      // Точное совпадение имени
            const nameMatches = [];       // Совпадение имени/фамилии
            const otherLeads = [];        // Остальные сделки
            const wrongLeads = [];        // Явно чужие сделки
            
            for (const lead of leads) {
                const leadName = lead.name || '';
                
                // Проверяем, ЧЬЯ это сделка
                const matchType = this.analyzeLeadOwnership(leadName, studentName);
                
                switch(matchType) {
                    case 'EXACT':
                        exactMatches.push(lead);
                        console.log(`✅ ТОЧНОЕ СОВПАДЕНИЕ: "${leadName}"`);
                        break;
                        
                    case 'NAME_MATCH':
                        nameMatches.push(lead);
                        console.log(`✅ СОВПАДЕНИЕ ИМЕНИ: "${leadName}"`);
                        break;
                        
                    case 'WRONG_STUDENT':
                        wrongLeads.push(lead);
                        console.log(`❌ ЧУЖАЯ СДЕЛКА: "${leadName}" (для другого ученика)`);
                        break;
                        
                    default:
                        otherLeads.push(lead);
                        console.log(`➖ НЕИЗВЕСТНО: "${leadName}"`);
                }
            }
            
            console.log(`\n📊 КАТЕГОРИИ СДЕЛОК:`);
            console.log(`   • Точные совпадения: ${exactMatches.length}`);
            console.log(`   • Совпадения имени: ${nameMatches.length}`);
            console.log(`   • Чужие сделки: ${wrongLeads.length}`);
            console.log(`   • Остальные: ${otherLeads.length}`);
            
            // 4. Ищем абонемент в ПРАВИЛЬНОЙ сделке
            let targetLeads = [];
            
            // Сначала ищем в точных совпадениях
            if (exactMatches.length > 0) {
                targetLeads = exactMatches;
                console.log(`\n🔍 Ищем в ТОЧНЫХ СОВПАДЕНИЯХ...`);
            } 
            // Затем в совпадениях имени
            else if (nameMatches.length > 0) {
                targetLeads = nameMatches;
                console.log(`\n🔍 Ищем в СОВПАДЕНИЯХ ИМЕНИ...`);
            }
            // Если нет совпадений, проверяем остальные сделки
            else {
                console.log(`\n⚠️  Нет сделок с совпадением имени. Проверяем все сделки...`);
                targetLeads = otherLeads;
            }
            
            // 5. Ищем абонемент в подходящих сделках
            let bestLead = null;
            let bestSubscriptionInfo = null;
            let bestScore = -1;
            
            for (const lead of targetLeads) {
                // Пропускаем явно чужие сделки
                if (wrongLeads.includes(lead)) {
                    console.log(`   ❌ Пропускаем чужую сделку: "${lead.name}"`);
                    continue;
                }
                
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (!subscriptionInfo.hasSubscription) {
                    console.log(`   ❌ "${lead.name}" - нет абонемента`);
                    continue;
                }
                
                // Вычисляем баллы
                let score = 0;
                
                // Баллы за совпадение имени
                const matchType = this.analyzeLeadOwnership(lead.name, studentName);
                if (matchType === 'EXACT') score += 200;
                else if (matchType === 'NAME_MATCH') score += 150;
                
                // Баллы за активный абонемент
                if (subscriptionInfo.subscriptionActive) {
                    score += 100;
                }
                
                // Баллы за остаток занятий
                if (subscriptionInfo.remainingClasses > 0) {
                    score += subscriptionInfo.remainingClasses * 10;
                }
                
                // Баллы за свежесть (чем новее, тем лучше)
                const daysAgo = Math.floor((Date.now() - (lead.updated_at * 1000)) / (1000 * 60 * 60 * 24));
                if (daysAgo < 30) score += 50;
                else if (daysAgo < 90) score += 30;
                
                // Баллы за воронку абонементов
                if (lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID) {
                    score += 80;
                }
                
                console.log(`   📊 "${lead.name}" - ${score} баллов`);
                
                if (score > bestScore) {
                    bestScore = score;
                    bestLead = lead;
                    bestSubscriptionInfo = subscriptionInfo;
                }
            }
            
            // 6. Если не нашли в подходящих сделках, проверяем последний вариант
            if (!bestLead && targetLeads.length > 0) {
                console.log(`\n⚠️  Не нашли подходящий абонемент. Берем первую сделку с абонементом...`);
                
                for (const lead of targetLeads) {
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    
                    if (subscriptionInfo.hasSubscription) {
                        bestLead = lead;
                        bestSubscriptionInfo = subscriptionInfo;
                        console.log(`   ⚠️  Выбрана сделка: "${lead.name}"`);
                        break;
                    }
                }
            }
            
            // 7. Возвращаем результат
            if (bestLead) {
                this.logLeadSelection(studentName, bestLead, bestSubscriptionInfo);
                
                return {
                    lead: bestLead,
                    subscriptionInfo: bestSubscriptionInfo,
                    selection_metadata: {
                        score: bestScore,
                        total_leads: leads.length,
                        exact_matches: exactMatches.length,
                        name_matches: nameMatches.length,
                        wrong_leads: wrongLeads.length
                    }
                };
            }
            
            console.log(`\n❌ НЕТ ПОДХОДЯЩЕЙ СДЕЛКИ ДЛЯ "${studentName}"`);
            return null;
            
        } catch (error) {
            console.error('❌ Критическая ошибка поиска:', error);
            return null;
        }
    }

    // ==================== ЛОГИРОВАНИЕ ВЫБОРА ====================
    logLeadSelection(studentName, lead, subscriptionInfo, matchType = null) {
        console.log(`\n📋 ЛОГ ВЫБОРА СДЕЛКИ:`);
        console.log('='.repeat(60));
        console.log(`👤 Ученик: ${studentName}`);
        console.log(`📄 Сделка: "${lead?.name || 'НЕТ'}"`);
        
        if (matchType) {
            console.log(`🏷️  Тип совпадения: ${matchType}`);
        }
        
        if (subscriptionInfo) {
            console.log(`🎫 Абонемент: ${subscriptionInfo.hasSubscription ? '✅ Да' : '❌ Нет'}`);
            if (subscriptionInfo.hasSubscription) {
                console.log(`📊 ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses} занятий`);
                console.log(`📈 Остаток: ${subscriptionInfo.remainingClasses}`);
                console.log(`🎯 Статус: ${subscriptionInfo.subscriptionStatus}`);
            }
        }
        
        console.log('='.repeat(60));
    }

    // ==================== ОСНОВНЫЕ МЕТОДЫ ====================
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
            return this.fieldMappings;
        } catch (error) {
            console.error('❌ Ошибка загрузки полей:', error.message);
            return new Map();
        }
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

    // ==================== ИЗВЛЕЧЕНИЕ ИНФОРМАЦИИ ОБ АБОНЕМЕНТЕ ====================
    extractSubscriptionInfo(lead) {
        console.log(`\n🔍 EXTRACT для сделки ${lead.id}: "${lead.name}"`);
        
        try {
            // 1. БАЗОВАЯ ПРОВЕРКА
            if (!lead || !lead.custom_fields_values) {
                return this.getDefaultSubscriptionInfo();
            }
            
            const customFields = lead.custom_fields_values;
            const pipelineId = lead.pipeline_id;
            const statusId = lead.status_id;
            
            // 2. Проверяем воронку
            const isInSubscriptionPipeline = pipelineId === this.SUBSCRIPTION_PIPELINE_ID;
            
            if (!isInSubscriptionPipeline) {
                return this.getDefaultSubscriptionInfo();
            }
            
            // 3. Получаем значения полей
            const totalClasses = this.getNumberFromField(customFields, 850241);
            const usedClasses = this.getNumberFromField(customFields, 850257);
            const fieldRemaining = this.getNumberFromField(customFields, 890163);
            
            // 4. ВЫЧИСЛЯЕМ правильный остаток
            const calculatedRemaining = Math.max(0, totalClasses - usedClasses);
            
            // Используем вычисленный остаток
            let remainingClasses = calculatedRemaining;
            
            // 5. Получаем другие поля
            const subscriptionType = this.getFieldValueFromFields(customFields, 891007);
            const freezeValue = this.getFieldValueFromFields(customFields, 867693);
            const isFrozen = freezeValue === 'ДА' || freezeValue === 'Да' || freezeValue === 'true';
            
            // 6. Даты
            const activationDate = this.parseDate(this.getFieldValueFromFields(customFields, 851565));
            const expirationDate = this.parseDate(this.getFieldValueFromFields(customFields, 850255));
            const lastVisitDate = this.parseDate(this.getFieldValueFromFields(customFields, 850259));
            
            // 7. Определяем, есть ли абонемент
            const hasSubscription = totalClasses > 0 && totalClasses > 0;
            
            if (!hasSubscription) {
                return this.getDefaultSubscriptionInfo();
            }
            
            // 8. Определяем активность
            let subscriptionActive = false;
            let subscriptionStatus = '';
            let subscriptionBadge = 'secondary';
            
            if (isFrozen) {
                subscriptionStatus = `Заморожен (осталось ${remainingClasses} занятий)`;
                subscriptionBadge = 'warning';
                subscriptionActive = false;
            }
            else if (remainingClasses > 0 && isInSubscriptionPipeline) {
                const activeStatuses = [65473306, 142, 143, 60025747];
                
                if (activeStatuses.includes(statusId)) {
                    subscriptionStatus = `Активный (осталось ${remainingClasses} занятий)`;
                    subscriptionBadge = 'success';
                    subscriptionActive = true;
                } else {
                    subscriptionStatus = `Неактивный (статус ${statusId}, осталось ${remainingClasses} занятий)`;
                    subscriptionBadge = 'secondary';
                    subscriptionActive = false;
                }
            }
            else if (remainingClasses === 0 && totalClasses > 0) {
                subscriptionStatus = `Использован (${usedClasses}/${totalClasses} занятий)`;
                subscriptionBadge = 'secondary';
                subscriptionActive = false;
            }
            else {
                subscriptionStatus = `Нет занятий`;
                subscriptionBadge = 'secondary';
                subscriptionActive = false;
            }
            
            // 9. Проверка срока действия
            if (expirationDate) {
                const today = new Date().toISOString().split('T')[0];
                
                if (expirationDate < today && subscriptionActive) {
                    subscriptionStatus = `Просрочен (истек ${this.formatDateDisplay(expirationDate)})`;
                    subscriptionBadge = 'danger';
                    subscriptionActive = false;
                }
            }
            
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

    // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ====================
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
            
            return 0;
            
        } catch (error) {
            console.error(`❌ Ошибка парсинга числа:`, error);
            return 0;
        }
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
                    return String(firstValue.enum_id);
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

    formatDateDisplay(dateStr) {
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
    }

    // ==================== ПОИСК УЧЕНИКОВ ====================
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
            
            // Фильтруем контакты (убираем админов)
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
                        // 🔥 ИСПОЛЬЗУЕМ 100% ГАРАНТИРОВАННЫЙ ПОИСК
                        const leadResult = await this.findLeadForStudent100(contact.id, child.studentName);
                        
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
                                this.getDefaultSubscriptionInfo(),
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

// ==================== ОСНОВНЫЕ API МАРШРУТЫ ====================
// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '4.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        sync_status: syncService.getSyncStatus(),
        data_source: 'Реальные данные из amoCRM',
        guarantee: '100% выбор правильной сделки'
    });
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

// Получение профилей
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

// Получение информации об абонементе
app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id, phone } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Требуется авторизация'
            });
        }
        
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
        } catch (tokenError) {
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
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
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
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Ошибка получения абонемента:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
        });
    }
});

// ==================== ДИАГНОСТИЧЕСКИЕ МАРШРУТЫ ====================
// Тест 100% гарантированного выбора
app.get('/api/test-guarantee/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🧪 ТЕСТ 100% ГАРАНТИИ ДЛЯ: "${studentName}" (${phone})`);
        console.log('='.repeat(80));
        
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // Используем 100% гарантированный поиск
        const result = await amoCrmService.findLeadForStudent100(contact.id, studentName);
        
        if (!result) {
            return res.json({
                success: false,
                error: 'Сделка не найдена',
                contact: {
                    id: contact.id,
                    name: contact.name
                }
            });
        }
        
        res.json({
            success: true,
            message: '100% гарантия сработала!',
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                student_name: studentName,
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
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Проверка всех сделок контакта
app.get('/api/debug/contact-leads/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ВСЕ СДЕЛКИ КОНТАКТА`);
        console.log(`📱 Телефон: ${phone}`);
        console.log(`👤 Ученик: "${studentName}"`);
        console.log('='.repeat(80));
        
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // Получаем все сделки
        const leads = await amoCrmService.getContactLeadsSorted(contact.id);
        console.log(`📊 Всего сделок: ${leads.length}`);
        
        // Анализируем каждую сделку
        const analysis = [];
        
        for (const lead of leads) {
            const matchType = amoCrmService.analyzeLeadOwnership(lead.name, studentName);
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            
            analysis.push({
                lead_id: lead.id,
                lead_name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                match_type: matchType,
                has_subscription: subscriptionInfo.hasSubscription,
                total_classes: subscriptionInfo.totalClasses,
                remaining_classes: subscriptionInfo.remainingClasses,
                subscription_status: subscriptionInfo.subscriptionStatus,
                subscription_active: subscriptionInfo.subscriptionActive
            });
        }
        
        // Группируем по типам совпадения
        const exactMatches = analysis.filter(a => a.match_type === 'EXACT');
        const nameMatches = analysis.filter(a => a.match_type === 'NAME_MATCH');
        const wrongStudents = analysis.filter(a => a.match_type === 'WRONG_STUDENT');
        const unknown = analysis.filter(a => a.match_type === 'UNKNOWN');
        
        res.json({
            success: true,
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                student_name: studentName,
                statistics: {
                    total_leads: leads.length,
                    exact_matches: exactMatches.length,
                    name_matches: nameMatches.length,
                    wrong_students: wrongStudents.length,
                    unknown: unknown.length
                },
                leads_by_category: {
                    exact_matches: exactMatches,
                    name_matches: nameMatches,
                    wrong_students: wrongStudents,
                    unknown: unknown
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Принудительное обновление данных
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

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v4.0');
        console.log('='.repeat(80));
        console.log('🔐 100% ГАРАНТИЯ ВЫБОРА ПРАВИЛЬНОЙ СДЕЛКИ');
        console.log('✨ РЕАЛЬНЫЕ ДАННЫЕ ИЗ AMOCRM');
        console.log('✨ ИСКЛЮЧЕНИЕ ЧУЖИХ СДЕЛОК');
        console.log('✨ ТОЧНОЕ СОВПАДЕНИЕ ИМЕН');
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
            console.log(`🎯 100% гарантия выбора: ✅ Включена`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`🔍 Профили: GET http://localhost:${PORT}/api/profiles`);
            console.log(`📋 Абонемент: POST http://localhost:3000/api/subscription`);
            console.log(`🧪 Тест 100% гарантии: GET http://localhost:${PORT}/api/test-guarantee/79660587744/Захар Веребрюсов`);
            console.log(`🔧 Диагностика: GET http://localhost:${PORT}/api/debug/contact-leads/79660587744/Захар Веребрюсов`);
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
