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
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService v2.0');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.fieldMappings = new Map();
        this.forceMatchIfOnlyOneStudent = false;
        this.isOnlyStudentInContact = false;
        
        // FIELD_IDS - основные поля для работы с абонементами
        this.FIELD_IDS = {
            // Сделки (абонементы)
            LEAD: {
                // Основные поля абонемента из воронки "!Абонемент"
                TOTAL_CLASSES: 850241,    // "Абонемент занятий:" - ОСНОВНОЕ поле!
                USED_CLASSES: 850257,     // "Счетчик занятий:"  
                REMAINING_CLASSES: 890163, // "Остаток занятий"
                EXPIRATION_DATE: 850255,  // "Окончание абонемента:"
                ACTIVATION_DATE: 851565,  // "Дата активации абонемента:"
                LAST_VISIT_DATE: 850259,  // "Дата последнего визита:"
                SUBSCRIPTION_TYPE: 891007, // "Тип абонемента"
                FREEZE: 867693,           // "Заморозка абонемента:"
                SUBSCRIPTION_OWNER: 805465, // "Принадлежность абонемента:"
                
                // Вспомогательные поля
                TECHNICAL_COUNT: 891819,  // "Количество занятий (тех)"
                AGE_GROUP: 850243,        // "Группа возраст:"
                BRANCH: null,             // "Филиал" в сделке
                
                // Поля для посещений (checkbox) - 24 занятия
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
                CHILD_1_BIRTHDAY: null,  // ДР ребенка 1
                CHILD_2_NAME: 867235,    // "!!ФИО ребенка:"
                CHILD_2_BIRTHDAY: 867685, // "День рождения:" для ребенка 2
                CHILD_3_NAME: 867733,    // "!!!ФИО ребенка:"
                CHILD_3_BIRTHDAY: 867735, // "День рождения:" для ребенка 3
                
                // Основные поля
                BRANCH: 871273,          // "Филиал:"
                TEACHER: 888881,         // "Преподаватель"
                DAY_OF_WEEK: 892225,     // "День недели (2025-26)"
                HAS_ACTIVE_SUB: 890179,  // "Есть активный абонемент"
                LAST_VISIT: 885380,      // "Дата последнего визита"
                AGE_GROUP: 888903,       // "Возраст группы"
                ALLERGIES: 850239,       // "Аллергия и особенности:"
                BIRTH_DATE: 850219,      // "День рождения:" (родителя)
                
                // Общие поля
                PARENT_NAME: 'name',      // Имя контакта
                EMAIL: 216617            // "Email" поле
            }
        };
        
        this.SUBSCRIPTION_STATUS_IDS = {
            '!Абонемент': {
                pipelineId: 7138617,  // ID воронки "!Абонемент"
                statusIds: {
                    'Активный абонемент': 60025745,  // ID статуса "Активный абонемент"
                    'Активирован': 60025747,        // ID статуса "Активирован"
                    'Заморозка': 60025751,          // ID статуса "Заморозка"
                    'Истек': 60025749               // ID статуса "Истек"
                },
                activeStatusIds: []
            }
        };
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
                    
                    // Проверяем воронку абонементов
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

    async checkSubscriptionPipeline() {
        try {
            console.log('\n🔍 Проверка воронки "!Абонемент"...');
            
            const pipelines = await this.makeRequest('GET', '/api/v4/leads/pipelines');
            
            let subscriptionPipeline = null;
            if (pipelines._embedded && pipelines._embedded.pipelines) {
                subscriptionPipeline = pipelines._embedded.pipelines.find(
                    p => p.name.includes('Абонемент') || p.id === 7138617
                );
            }
            
            if (subscriptionPipeline) {
                console.log(`✅ Воронка найдена: "${subscriptionPipeline.name}" (ID: ${subscriptionPipeline.id})`);
                console.log(`📊 Статусы воронки:`);
                
                if (subscriptionPipeline._embedded && subscriptionPipeline._embedded.statuses) {
                    subscriptionPipeline._embedded.statuses.forEach(status => {
                        console.log(`   • ${status.name} (ID: ${status.id})`);
                    });
                }
                
                this.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId = subscriptionPipeline.id;
            } else {
                console.log('⚠️  Воронка "!Абонемент" не найдена. Используем стандартные значения.');
            }
            
        } catch (error) {
            console.error('❌ Ошибка проверки воронки:', error.message);
        }
    }

    async loadFieldMappings() {
        try {
            console.log('📋 Загрузка всех кастомных полей amoCRM...');
            
            // Загружаем поля контактов
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
            
            // Загружаем поля сделок
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
            
            // Показываем ключевые поля
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

    // ==================== ОСНОВНОЙ МЕТОД ИЗВЛЕЧЕНИЯ АБОНЕМЕНТА ====================
    extractSubscriptionInfo(lead) {
        try {
            const leadName = lead.name || '';
            const customFields = lead.custom_fields_values || [];
            const statusId = lead.status_id;
            const pipelineId = lead.pipeline_id;
            
            console.log(`\n🔍 АНАЛИЗ СДЕЛКИ: "${leadName.substring(0, 50)}..."`);
            console.log(`   📍 Pipeline ID: ${pipelineId}, Status ID: ${statusId}`);
            
            // 1. Проверяем, находится ли сделка в воронке "!Абонемент"
            const isInSubscriptionPipeline = pipelineId === this.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId;
            const isActiveStatus = statusId === this.SUBSCRIPTION_STATUS_IDS['!Абонемент'].statusIds['Активный абонемент'] ||
                                 statusId === this.SUBSCRIPTION_STATUS_IDS['!Абонемент'].statusIds['Активирован'];
            
            // 2. Получаем основные данные из полей
            let totalClasses = 0;
            let usedClasses = 0;
            let remainingClasses = 0;
            let subscriptionType = '';
            let expirationDate = null;
            let activationDate = null;
            let lastVisitDate = null;
            let isFrozen = false;
            let subscriptionOwner = '';
            
            // Показываем все поля для отладки
            console.log(`   📊 Поля сделки (${customFields.length}):`);
            
            customFields.forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldName = this.getFieldName(field);
                const fieldValue = this.getFieldValue(field);
                
                // Основные поля абонемента
                if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES) {
                    totalClasses = this.parseNumberFromField(fieldValue);
                    console.log(`   ✅ Поле ${fieldId} (${fieldName}): ${fieldValue} -> ${totalClasses} занятий`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.USED_CLASSES) {
                    usedClasses = this.parseNumberFromField(fieldValue);
                    console.log(`   ✅ Поле ${fieldId} (${fieldName}): ${fieldValue} -> ${usedClasses} использовано`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.REMAINING_CLASSES) {
                    remainingClasses = this.parseNumberFromField(fieldValue);
                    console.log(`   ✅ Поле ${fieldId} (${fieldName}): ${fieldValue} -> ${remainingClasses} осталось`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.EXPIRATION_DATE) {
                    expirationDate = this.parseDate(fieldValue);
                    console.log(`   ✅ Поле ${fieldId} (${fieldName}): ${fieldValue} -> ${expirationDate}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.ACTIVATION_DATE) {
                    activationDate = this.parseDate(fieldValue);
                    console.log(`   ✅ Поле ${fieldId} (${fieldName}): ${fieldValue} -> ${activationDate}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.LAST_VISIT_DATE) {
                    lastVisitDate = this.parseDate(fieldValue);
                    console.log(`   ✅ Поле ${fieldId} (${fieldName}): ${fieldValue} -> ${lastVisitDate}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE) {
                    subscriptionType = fieldValue;
                    console.log(`   ✅ Поле ${fieldId} (${fieldName}): ${fieldValue}`);
                }
                else if (fieldId === this.FIELD_IDS.LEAD.FREEZE) {
                    isFrozen = fieldValue === 'Да' || fieldValue === 'true' || fieldValue === '1';
                    console.log(`   ✅ Поле ${fieldId} (${fieldName}): ${fieldValue} -> заморожен: ${isFrozen}`);
                }
            });
            
            // 3. Если не нашли поле "Абонемент занятий:", пытаемся извлечь из названия
            if (totalClasses === 0) {
                totalClasses = this.parseLeadNameForSubscription(leadName);
                if (totalClasses > 0) {
                    console.log(`   📝 Из названия: ${totalClasses} занятий`);
                }
            }
            
            // 4. Если не нашли "Остаток занятий", рассчитываем
            if (totalClasses > 0 && remainingClasses === 0 && usedClasses === 0) {
                // Если есть чекбоксы - считаем их
                const visitedClasses = this.countVisitedClasses(customFields);
                if (visitedClasses > 0) {
                    usedClasses = visitedClasses;
                    remainingClasses = Math.max(0, totalClasses - usedClasses);
                    console.log(`   🧮 По чекбоксам: использовано ${usedClasses}, осталось ${remainingClasses}`);
                }
            } else if (totalClasses > 0 && remainingClasses === 0 && usedClasses > 0) {
                remainingClasses = Math.max(0, totalClasses - usedClasses);
                console.log(`   🧮 Расчет остатка: ${totalClasses} - ${usedClasses} = ${remainingClasses}`);
            }
            
            // 5. Определяем статус абонемента
            let subscriptionStatus = 'Нет абонемента';
            let subscriptionActive = false;
            let subscriptionBadge = 'inactive';

            if (totalClasses > 0) {
                // УЛУЧШЕННАЯ ЛОГИКА ОПРЕДЕЛЕНИЯ АКТИВНОСТИ:
                // 1. Проверяем, находится ли сделка в воронке абонементов
                // 2. Проверяем по статусу
                // 3. Проверяем по остатку занятий и датам
                
                const isInCorrectPipeline = pipelineId === this.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId;
                
                // Статусы, которые считаются активными
                const activeStatusIds = [
                    this.SUBSCRIPTION_STATUS_IDS['!Абонемент'].statusIds['Активный абонемент'],
                    this.SUBSCRIPTION_STATUS_IDS['!Абонемент'].statusIds['Активирован'],
                    65473306,  // Статус из реальных данных
                    72490890   // Другой статус из данных
                ];
                
                // Проверяем, есть ли остаток занятий
                const hasRemainingClasses = remainingClasses > 0;
                
                // Проверяем, не истек ли абонемент
                let isExpired = false;
                if (expirationDate) {
                    const expDate = new Date(expirationDate);
                    const today = new Date();
                    isExpired = expDate < today;
                }
                
                // Определяем активность
                subscriptionActive = (
                    isInCorrectPipeline && 
                    activeStatusIds.includes(statusId) &&
                    hasRemainingClasses &&
                    !isExpired &&
                    !isFrozen
                );
                
                // Формируем статус
                if (isFrozen) {
                    subscriptionStatus = `Заморожен (осталось ${remainingClasses} занятий)`;
                    subscriptionBadge = 'warning';
                } else if (subscriptionActive) {
                    subscriptionStatus = `Активный (осталось ${remainingClasses} занятий)`;
                    subscriptionBadge = 'success';
                } else if (hasRemainingClasses && !isExpired) {
                    subscriptionStatus = `Есть остаток (${remainingClasses} занятий)`;
                    subscriptionBadge = 'info';
                } else if (totalClasses > 0 && usedClasses >= totalClasses) {
                    subscriptionStatus = `Использован (${usedClasses}/${totalClasses} занятий)`;
                    subscriptionBadge = 'secondary';
                } else if (isExpired) {
                    subscriptionStatus = `Истек (было ${totalClasses} занятий)`;
                    subscriptionBadge = 'secondary';
                } else {
                    subscriptionStatus = `Неактивный (осталось ${remainingClasses} занятий)`;
                    subscriptionBadge = 'secondary';
                }
            } else if (leadName.toLowerCase().includes('занятий') || leadName.toLowerCase().includes('абонемент')) {
                subscriptionStatus = 'Абонемент без указания занятий';
                subscriptionBadge = 'warning';
            }

            console.log(`   🎯 СТАТУС АБОНЕМЕНТА:`);
            console.log(`       • Всего занятий: ${totalClasses}`);
            console.log(`       • Использовано: ${usedClasses}`);
            console.log(`       • Осталось: ${remainingClasses}`);
            console.log(`       • Pipeline: ${pipelineId} (ожидается: ${this.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId})`);
            console.log(`       • Status ID: ${statusId}`);
            console.log(`       • Активен: ${subscriptionActive ? '✅ Да' : '❌ Нет'}`);
            console.log(`       • Статус: ${subscriptionStatus}`);
            
            console.log(`   🎯 ИТОГ: ${subscriptionStatus}`);
            
            return {
                hasSubscription: totalClasses > 0,
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
                statusId: statusId
            };
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации об абонементе:', error);
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
                subscriptionStatus: 'Ошибка обработки',
                subscriptionBadge: 'danger',
                isFrozen: false,
                isInSubscriptionPipeline: false,
                pipelineId: null,
                statusId: null
            };
        }
    }

    parseNumberFromField(value) {
        if (!value) return 0;
        
        try {
            // Если это уже число
            if (typeof value === 'number') return value;
            
            const str = String(value).trim();
            
            // Ищем число в строке
            const match = str.match(/(\d+)/);
            if (match) {
                const num = parseInt(match[1]);
                return isNaN(num) ? 0 : num;
            }
            
            // Специальные случаи
            if (str.toLowerCase().includes('разовый') || 
                str.toLowerCase().includes('пробное')) {
                return 1;
            }
            
            return 0;
        } catch (error) {
            console.error('❌ Ошибка парсинга числа:', error);
            return 0;
        }
    }

    parseLeadNameForSubscription(leadName) {
        if (!leadName) return 0;
        
        console.log(`   🔍 Парсинг названия: "${leadName}"`);
        
        const lowerName = leadName.toLowerCase();
        
        // Пропускаем технические названия
        if (lowerName.includes('рассылка') || 
            lowerName.includes('рассылк') ||
            lowerName.includes('архив') ||
            lowerName.includes('отменен') ||
            lowerName.match(/^\d+\s*₽/i) ||
            lowerName.match(/^#\d+/i)) {
            console.log(`   ⏭️  Пропускаем техническое название`);
            return 0;
        }
        
        // Основные паттерны из примеров:
        // "Имя Фамилия - N занятий"
        // "Имя Фамилия - N занятия"
        // "Имя и Имя - N занятий"
        
        // Паттерн 1: " - N занятий"
        const pattern1 = /-\s*(\d+)\s*занятий?/i;
        const match1 = leadName.match(pattern1);
        if (match1 && match1[1]) {
            const num = parseInt(match1[1]);
            if (num >= 1 && num <= 50) {
                console.log(`   ✅ Паттерн 1 (дефис): ${num} занятий`);
                return num;
            }
        }
        
        // Паттерн 2: "N занятий"
        const pattern2 = /(\d+)\s*занятий?/i;
        const match2 = leadName.match(pattern2);
        if (match2 && match2[1]) {
            const num = parseInt(match2[1]);
            if (num >= 1 && num <= 50) {
                console.log(`   ✅ Паттерн 2 (прямое): ${num} занятий`);
                return num;
            }
        }
        
        // Паттерн 3: "N занятия"
        const pattern3 = /(\d+)\s*занятия/i;
        const match3 = leadName.match(pattern3);
        if (match3 && match3[1]) {
            const num = parseInt(match3[1]);
            if (num >= 1 && num <= 50) {
                console.log(`   ✅ Паттерн 3 (мн. число): ${num} занятий`);
                return num;
            }
        }
        
        // Паттерн 4: "абонемент N"
        const pattern4 = /абонемент\s+(\d+)/i;
        const match4 = leadName.match(pattern4);
        if (match4 && match4[1]) {
            const num = parseInt(match4[1]);
            if (num >= 1 && num <= 50) {
                console.log(`   ✅ Паттерн 4 (абонемент): ${num} занятий`);
                return num;
            }
        }
        
        console.log(`   ❌ Не удалось определить количество занятий из названия`);
        return 0;
    }

    countVisitedClasses(customFields) {
        let visitedCount = 0;
        
        const checkboxFields = [
            this.FIELD_IDS.LEAD.CLASS_1, this.FIELD_IDS.LEAD.CLASS_2,
            this.FIELD_IDS.LEAD.CLASS_3, this.FIELD_IDS.LEAD.CLASS_4,
            this.FIELD_IDS.LEAD.CLASS_5, this.FIELD_IDS.LEAD.CLASS_6,
            this.FIELD_IDS.LEAD.CLASS_7, this.FIELD_IDS.LEAD.CLASS_8,
            this.FIELD_IDS.LEAD.CLASS_9, this.FIELD_IDS.LEAD.CLASS_10,
            this.FIELD_IDS.LEAD.CLASS_11, this.FIELD_IDS.LEAD.CLASS_12,
            this.FIELD_IDS.LEAD.CLASS_13, this.FIELD_IDS.LEAD.CLASS_14,
            this.FIELD_IDS.LEAD.CLASS_15, this.FIELD_IDS.LEAD.CLASS_16,
            this.FIELD_IDS.LEAD.CLASS_17, this.FIELD_IDS.LEAD.CLASS_18,
            this.FIELD_IDS.LEAD.CLASS_19, this.FIELD_IDS.LEAD.CLASS_20,
            this.FIELD_IDS.LEAD.CLASS_21, this.FIELD_IDS.LEAD.CLASS_22,
            this.FIELD_IDS.LEAD.CLASS_23, this.FIELD_IDS.LEAD.CLASS_24
        ];
        
        customFields.forEach(field => {
            const fieldId = field.field_id || field.id;
            if (checkboxFields.includes(fieldId)) {
                const value = this.getFieldValue(field);
                if (value === 'true' || value === '1' || value === true || 
                    (typeof value === 'string' && value.toLowerCase() === 'да')) {
                    visitedCount++;
                }
            }
        });
        
        return visitedCount;
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
            
            if (typeof firstValue === 'string') {
                return firstValue.trim();
            } else if (typeof firstValue === 'number') {
                return String(firstValue);
            } else if (typeof firstValue === 'object' && firstValue !== null) {
                if (firstValue.value !== undefined && firstValue.value !== null) {
                    return String(firstValue.value).trim();
                } else if (firstValue.enum_value !== undefined && firstValue.enum_value !== null) {
                    return String(firstValue.enum_value).trim();
                } else if (firstValue.enum_id !== undefined && firstValue.enum_id !== null) {
                    return String(firstValue.enum_id);
                }
            }
            
            return String(firstValue).trim();
        } catch (error) {
            console.error('❌ Ошибка получения значения поля:', error);
            return '';
        }
    }

    getFieldName(field) {
        try {
            if (!field) return '';
            
            if (field.field_name) {
                return field.field_name;
            } else if (field.name) {
                return field.name;
            } else if (field.field_id && this.fieldMappings.has(field.field_id)) {
                return this.fieldMappings.get(field.field_id).name;
            }
            
            return '';
        } catch (error) {
            console.error('❌ Ошибка получения имени поля:', error);
            return '';
        }
    }

    parseDate(value) {
        if (!value) return null;
        
        try {
            const dateStr = String(value).trim();
            
            // Если это timestamp
            if (/^\d+$/.test(dateStr)) {
                const timestamp = parseInt(dateStr);
                const date = timestamp < 10000000000 
                    ? new Date(timestamp * 1000)
                    : new Date(timestamp);
                
                return date.toISOString().split('T')[0];
            }
            
            // Формат DD.MM.YYYY
            if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
                const parts = dateStr.split('.');
                const day = parts[0].padStart(2, '0');
                const month = parts[1].padStart(2, '0');
                const year = parts[2];
                
                return `${year}-${month}-${day}`;
            }
            
            // Формат YYYY-MM-DD
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

    // ==================== ПОИСК КОНТАКТОВ И УЧЕНИКОВ ====================
    async searchContactsByPhone(phoneNumber) {
        console.log(`\n🔍 ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
            console.log('❌ Номер слишком короткий');
            return { _embedded: { contacts: [] } };
        }
        
        try {
            // Основной поиск по последним 10 цифрам
            const last10Digits = cleanPhone.slice(-10);
            
            // Форматы для поиска
            const searchFormats = [
                `+7${last10Digits}`,
                `8${last10Digits}`,
                `7${last10Digits}`,
                last10Digits
            ];
            
            let allContacts = [];
            
            for (const format of searchFormats) {
                try {
                    console.log(`   🔍 Поиск по формату: ${format}`);
                    
                    const response = await this.makeRequest(
                        'GET', 
                        `/api/v4/contacts?query=${encodeURIComponent(format)}&with=custom_fields_values&limit=50`
                    );
                    
                    const contacts = response._embedded?.contacts || [];
                    console.log(`   📊 Найдено: ${contacts.length} контактов`);
                    
                    // Фильтруем дубликаты
                    contacts.forEach(contact => {
                        if (!allContacts.some(c => c.id === contact.id)) {
                            allContacts.push(contact);
                        }
                    });
                    
                } catch (searchError) {
                    console.log(`   ⚠️  Ошибка поиска по "${format}": ${searchError.message}`);
                }
            }
            
            console.log(`📊 ИТОГО уникальных контактов: ${allContacts.length}`);
            
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
            
            console.log(`\n👤 Поиск детей в контакте: "${contactName}"`);
            
            // Конфигурация полей детей
            const childrenConfig = [
                { number: 1, nameFieldId: 867233 },
                { number: 2, nameFieldId: 867235 },
                { number: 3, nameFieldId: 867733 }
            ];
            
            // Ищем каждого ребенка
            for (const childConfig of childrenConfig) {
                let studentName = '';
                
                // Ищем имя ребенка
                for (const field of customFields) {
                    const fieldId = field.field_id || field.id;
                    const fieldValue = this.getFieldValue(field);
                    
                    if (fieldId === childConfig.nameFieldId && fieldValue && fieldValue.trim()) {
                        studentName = fieldValue.trim();
                        console.log(`   ✅ Найден ребенок ${childConfig.number}: "${studentName}"`);
                        break;
                    }
                }
                
                // Если нашли ребенка
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
                    
                    // Ищем дополнительные данные
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
                            // Email или дата рождения
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
            
            console.log(`📊 ИТОГО найдено детей: ${students.length}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения учеников из контакта:', error);
        }
        
        return students;
    }

    // ==================== ПОИСК СДЕЛОК ДЛЯ УЧЕНИКА ====================
    async getContactLeadsSorted(contactId) {
        console.log(`\n📋 ПОЛУЧЕНИЕ СДЕЛОК КОНТАКТА: ${contactId}`);
        
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
                    console.log(`   📄 Страница ${page}: ${leads.length} сделок`);
                    
                    if (leads.length === 0) break;
                    
                    allLeads = [...allLeads, ...leads];
                    
                    if (leads.length < limit) break;
                    page++;
                    
                    if (page > 5) break; // Ограничение на 5 страниц
                    
                } catch (pageError) {
                    console.error(`   ⚠️  Ошибка страницы ${page}:`, pageError.message);
                    break;
                }
            }
            
            console.log(`📊 Всего сделок до фильтрации: ${allLeads.length}`);
            
            // ФИЛЬТРУЕМ: убираем рассылки, архивы и т.д.
            const filteredLeads = allLeads.filter(lead => {
                const leadName = lead.name || '';
                const lowerName = leadName.toLowerCase();
                
                // ИСКЛЮЧАЕМ:
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
                    /^\s*$/  // Пустые названия
                ];
                
                const shouldExclude = excludePatterns.some(pattern => pattern.test(lowerName));
                
                if (shouldExclude) {
                    console.log(`   ⏭️  Исключена: "${leadName.substring(0, 50)}..."`);
                    return false;
                }
                
                return true;
            });
            
            console.log(`✅ После фильтрации: ${filteredLeads.length} сделок`);
            
            return filteredLeads;
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    checkIfLeadBelongsToStudent(leadName, studentName) {
        if (!leadName || !studentName) return false;
        
        console.log(`   🔍 Сопоставление: "${studentName}" ↔ "${leadName}"`);
        
        const cleanLeadName = leadName.toLowerCase().trim();
        const cleanStudentName = studentName.toLowerCase().trim();
        
        // 1. Прямое вхождение (полное имя)
        if (cleanLeadName.includes(cleanStudentName)) {
            console.log(`   ✅ Прямое вхождение`);
            return true;
        }
        
        // 2. Разбиваем имена на части
        const studentParts = cleanStudentName.split(/\s+/).filter(part => part.length > 1);
        const leadParts = cleanLeadName.split(/\s+/).filter(part => part.length > 1);
        
        // 3. Ищем совпадения по отдельным частям имени
        let matchedParts = 0;
        let totalParts = studentParts.length;
        
        for (const studentPart of studentParts) {
            // Пропускаем короткие части
            if (studentPart.length <= 2) continue;
            
            // Ищем вхождение этой части
            for (const leadPart of leadParts) {
                // Прямое вхождение части
                if (leadPart.includes(studentPart) || studentPart.includes(leadPart)) {
                    matchedParts++;
                    console.log(`   ✅ Совпадение части: "${studentPart}" → "${leadPart}"`);
                    break;
                }
                
                // Проверка с учетом транслитерации/опечаток
                if (this.stringsAreSimilar(leadPart, studentPart, 0.7)) {
                    matchedParts++;
                    console.log(`   ✅ Похожие строки: "${studentPart}" ≈ "${leadPart}"`);
                    break;
                }
            }
        }
        
        // Если совпало больше половины частей имени
        const matchThreshold = Math.max(1, Math.floor(totalParts * 0.7));
        if (matchedParts >= matchThreshold) {
            console.log(`   ✅ Совпало частей: ${matchedParts}/${totalParts} (порог: ${matchThreshold})`);
            return true;
        }
        
        // 4. Специальный случай: имя может быть на первом месте перед дефисом
        const dashPattern = /^([а-яё\s]+)\s*-\s*/i;
        const dashMatch = leadName.match(dashPattern);
        
        if (dashMatch) {
            const nameBeforeDash = dashMatch[1].trim().toLowerCase();
            console.log(`   🔍 Имя перед дефисом: "${nameBeforeDash}"`);
            
            if (nameBeforeDash.includes(cleanStudentName) || cleanStudentName.includes(nameBeforeDash)) {
                console.log(`   ✅ Совпадение с именем перед дефисом`);
                return true;
            }
            
            // Проверяем части
            const dashNameParts = nameBeforeDash.split(/\s+/).filter(part => part.length > 1);
            let dashMatched = 0;
            
            for (const studentPart of studentParts) {
                if (studentPart.length <= 2) continue;
                
                for (const dashPart of dashNameParts) {
                    if (dashPart.includes(studentPart) || studentPart.includes(dashPart)) {
                        dashMatched++;
                        break;
                    }
                }
            }
            
            if (dashMatched >= matchThreshold) {
                console.log(`   ✅ Совпадение частей с именем перед дефисом: ${dashMatched}/${totalParts}`);
                return true;
            }
        }
        
        // 5. Проверяем русские имена с английской транслитерацией
        const transliteratedMatches = this.checkTransliteration(leadName, studentName);
        if (transliteratedMatches) {
            console.log(`   ✅ Совпадение по транслитерации`);
            return true;
        }
        
        console.log(`   ❌ Нет совпадения: только ${matchedParts}/${totalParts} частей`);
        return false;
    }

    stringsAreSimilar(str1, str2, threshold = 0.7) {
        if (!str1 || !str2) return false;
        
        const s1 = str1.toLowerCase();
        const s2 = str2.toLowerCase();
        
        // Если строки почти одинаковы
        if (s1 === s2) return true;
        
        // Если одна строка содержит другую
        if (s1.includes(s2) || s2.includes(s1)) return true;
        
        // Проверка по расстоянию Левенштейна (упрощенная)
        const len = Math.max(s1.length, s2.length);
        const diff = Math.abs(s1.length - s2.length);
        
        // Если разница в длине больше 2 символов - скорее всего разные
        if (diff > 2) return false;
        
        // Простая проверка первых 3 символов
        if (s1.slice(0, 3) === s2.slice(0, 3)) return true;
        
        // Проверка последних 3 символов
        if (s1.slice(-3) === s2.slice(-3)) return true;
        
        return false;
    }

    checkTransliteration(leadName, studentName) {
        const rusToEng = {
            'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd',
            'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z', 'и': 'i',
            'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
            'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't',
            'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch',
            'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '',
            'э': 'e', 'ю': 'yu', 'я': 'ya'
        };
        
        // Транслитерируем русское имя на английский
        const transliterate = (text) => {
            return text.toLowerCase().split('').map(char => 
                rusToEng[char] || char
            ).join('');
        };
        
        const transliteratedStudent = transliterate(studentName.toLowerCase());
        const leadNameLower = leadName.toLowerCase();
        
        // Проверяем вхождение транслитерированного имени
        if (leadNameLower.includes(transliteratedStudent)) {
            return true;
        }
        
        // Проверяем части
        const studentParts = transliteratedStudent.split(/\s+/);
        let matched = 0;
        
        for (const part of studentParts) {
            if (part.length > 2 && leadNameLower.includes(part)) {
                matched++;
            }
        }
        
        return matched >= Math.max(1, studentParts.length * 0.6);
    }

    async loadPipelineStatuses() {
        try {
            console.log('📋 Загрузка статусов воронки "!Абонемент"...');
            
            const pipelineId = this.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId;
            const response = await this.makeRequest('GET', `/api/v4/leads/pipelines/${pipelineId}`);
            
            if (response && response._embedded && response._embedded.statuses) {
                console.log(`📊 Найдено статусов: ${response._embedded.statuses.length}`);
                
                // Создаем массив для активных статусов
                const activeStatuses = [];
                
                response._embedded.statuses.forEach(status => {
                    console.log(`   • ${status.name} (ID: ${status.id})`);
                    
                    // Если название статуса указывает на активность
                    if (status.name.toLowerCase().includes('актив') || 
                        status.name.toLowerCase().includes('использ') ||
                        status.name === 'Активирован') {
                        activeStatuses.push(status.id);
                    }
                });
                
                console.log(`✅ Активные статусы: ${activeStatuses.join(', ')}`);
                
                // Обновляем список активных статусов
                this.SUBSCRIPTION_STATUS_IDS['!Абонемент'].activeStatusIds = activeStatuses;
            }
            
        } catch (error) {
            console.error('❌ Ошибка загрузки статусов:', error.message);
        }
    }
    
    async findLeadForStudent(contactId, studentName) {
        console.log(`\n🎯 ПОИСК СДЕЛКИ ДЛЯ УЧЕНИКА: "${studentName}"`);
        
        try {
            const leads = await this.getContactLeadsSorted(contactId);
            
            if (leads.length === 0) {
                console.log(`   ❌ У контакта нет сделок`);
                return null;
            }
            
            // УЛУЧШЕННЫЙ ПОИСК: Ищем сделки разными способами
            
            // 1. Сделки с прямым совпадением имени
            const exactMatches = [];
            
            // 2. Сделки с частичным совпадением (по частям имени)
            const partialMatches = [];
            
            // 3. Сделки без совпадения имени, но с активными абонементами
            const activeSubscriptions = [];
            
            // 4. Все остальные сделки с абонементами
            const otherSubscriptions = [];
            
            console.log(`   🔍 Анализ ${leads.length} сделок...`);
            
            for (const lead of leads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                // Пропускаем сделки без абонемента
                if (!subscriptionInfo.hasSubscription) {
                    continue;
                }
                
                // Проверяем совпадение имен
                const belongs = this.checkIfLeadBelongsToStudent(lead.name || '', studentName);
                
                if (belongs) {
                    // Проверяем, насколько точно совпадает
                    const leadNameLower = (lead.name || '').toLowerCase();
                    const studentNameLower = studentName.toLowerCase();
                    
                    if (leadNameLower.includes(studentNameLower)) {
                        exactMatches.push({ lead, info: subscriptionInfo, matchType: 'exact' });
                    } else {
                        partialMatches.push({ lead, info: subscriptionInfo, matchType: 'partial' });
                    }
                } else if (subscriptionInfo.subscriptionActive) {
                    activeSubscriptions.push({ lead, info: subscriptionInfo, matchType: 'active' });
                } else {
                    otherSubscriptions.push({ lead, info: subscriptionInfo, matchType: 'other' });
                }
            }
            
            console.log(`   📊 Результаты поиска:`);
            console.log(`       • Точные совпадения: ${exactMatches.length}`);
            console.log(`       • Частичные совпадения: ${partialMatches.length}`);
            console.log(`       • Активные абонементы без совпадения: ${activeSubscriptions.length}`);
            console.log(`       • Другие абонементы: ${otherSubscriptions.length}`);
            
            // ВЫБОР ЛУЧШЕЙ СДЕЛКИ ПО ПРИОРИТЕТАМ:
            let bestLead = null;
            let bestMatchType = '';
            
            // 1. Точные совпадения (сортировка по активности и остатку)
            if (exactMatches.length > 0) {
                exactMatches.sort((a, b) => {
                    // Активные выше
                    if (a.info.subscriptionActive !== b.info.subscriptionActive) {
                        return b.info.subscriptionActive ? 1 : -1;
                    }
                    
                    // С остатком выше
                    if (a.info.remainingClasses !== b.info.remainingClasses) {
                        return b.info.remainingClasses - a.info.remainingClasses;
                    }
                    
                    // С большим общим количеством
                    if (a.info.totalClasses !== b.info.totalClasses) {
                        return b.info.totalClasses - a.info.totalClasses;
                    }
                    
                    // Новые выше
                    const dateA = new Date(a.lead.updated_at || a.lead.created_at || 0);
                    const dateB = new Date(b.lead.updated_at || b.lead.created_at || 0);
                    return dateB.getTime() - dateA.getTime();
                });
                
                bestLead = exactMatches[0].lead;
                bestMatchType = `точное совпадение ("${exactMatches[0].lead.name}")`;
            }
            // 2. Частичные совпадения
            else if (partialMatches.length > 0) {
                partialMatches.sort((a, b) => {
                    // Активные выше
                    if (a.info.subscriptionActive !== b.info.subscriptionActive) {
                        return b.info.subscriptionActive ? 1 : -1;
                    }
                    
                    // С остатком выше
                    if (a.info.remainingClasses !== b.info.remainingClasses) {
                        return b.info.remainingClasses - a.info.remainingClasses;
                }
                
                // С большим общим количеством
                if (a.info.totalClasses !== b.info.totalClasses) {
                    return b.info.totalClasses - a.info.totalClasses;
                }
                
                // Новые выше
                const dateA = new Date(a.lead.updated_at || a.lead.created_at || 0);
                const dateB = new Date(b.lead.updated_at || b.lead.created_at || 0);
                return dateB.getTime() - dateA.getTime();
            });
            
            bestLead = partialMatches[0].lead;
            bestMatchType = `частичное совпадение ("${partialMatches[0].lead.name}")`;
        }
        // 3. Активные абонементы без совпадения имени
        else if (activeSubscriptions.length > 0) {
            activeSubscriptions.sort((a, b) => {
                // С остатком выше
                if (a.info.remainingClasses !== b.info.remainingClasses) {
                    return b.info.remainingClasses - a.info.remainingClasses;
                }
                
                // С большим общим количеством
                if (a.info.totalClasses !== b.info.totalClasses) {
                    return b.info.totalClasses - a.info.totalClasses;
                }
                
                // Новые выше
                const dateA = new Date(a.lead.updated_at || a.lead.created_at || 0);
                const dateB = new Date(b.lead.updated_at || b.lead.created_at || 0);
                return dateB.getTime() - dateA.getTime();
            });
            
            bestLead = activeSubscriptions[0].lead;
            bestMatchType = `активный абонемент без совпадения имени ("${activeSubscriptions[0].lead.name}")`;
        }
        // 4. Любые другие абонементы
        else if (otherSubscriptions.length > 0) {
            otherSubscriptions.sort((a, b) => {
                // С остатком выше
                if (a.info.remainingClasses !== b.info.remainingClasses) {
                    return b.info.remainingClasses - a.info.remainingClasses;
                }
                
                // С большим общим количеством
                if (a.info.totalClasses !== b.info.totalClasses) {
                    return b.info.totalClasses - a.info.totalClasses;
                }
                
                // Новые выше
                const dateA = new Date(a.lead.updated_at || a.lead.created_at || 0);
                const dateB = new Date(b.lead.updated_at || b.lead.created_at || 0);
                return dateB.getTime() - dateA.getTime();
            });
            
            bestLead = otherSubscriptions[0].lead;
            bestMatchType = `любой абонемент ("${otherSubscriptions[0].lead.name}")`;
        }
        
        if (bestLead) {
            const leadInfo = this.extractSubscriptionInfo(bestLead);
            console.log(`\n   ✅ Выбрана сделка: ${bestMatchType}`);
            console.log(`       • Название: "${bestLead.name}"`);
            console.log(`       • Статус: ${leadInfo.subscriptionStatus}`);
            console.log(`       • Занятий: ${leadInfo.remainingClasses}/${leadInfo.totalClasses}`);
            console.log(`       • Активен: ${leadInfo.subscriptionActive ? 'Да' : 'Нет'}`);
        } else {
            console.log(`\n   ❌ Не найдено подходящей сделки`);
        }
        
        return bestLead;
        
    } catch (error) {
        console.error(`❌ Ошибка поиска сделки для ученика: ${error.message}`);
        return null;
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
            // 1. Ищем контакты по телефону
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                console.log('❌ Контакты не найдены');
                return studentProfiles;
            }
            
            // 2. Обрабатываем каждый контакт
            for (const contact of contacts) {
                try {
                    console.log(`\n👤 Обработка контакта: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
                    
                    // Получаем полную информацию о контакте
                    const fullContact = await this.getFullContactInfo(contact.id);
                    if (!fullContact) continue;
                    
                    // Извлекаем учеников из контакта
                    const children = this.extractStudentsFromContact(fullContact);
                    console.log(`📊 Учеников в контакте: ${children.length}`);
                    
                    if (children.length === 0) {
                        console.log('⚠️  В контакте нет учеников');
                        continue;
                    }
                    
// 3. Для каждого ученика ищем сделку
for (const child of children) {
    console.log(`\n🎯 Поиск сделки для ученика: "${child.studentName}"`);
    
    // Ищем лучшую сделку для ученика
    let bestLead = await this.findLeadForStudent(contact.id, child.studentName);
    
    // 🔥 ДОБАВЛЯЕМ ЗДЕСЬ: Форсированный поиск активного абонемента (если не нашли)
    if (!bestLead) {
        console.log(`   🔍 Форсированный поиск активного абонемента...`);
        
        // Ищем любую сделку с остатком занятий
        const allLeads = await this.getContactLeadsSorted(contact.id);
        const leadsWithRemaining = allLeads.filter(lead => {
            const info = this.extractSubscriptionInfo(lead);
            return info.remainingClasses > 0 && info.totalClasses > 0;
        });
        
        if (leadsWithRemaining.length > 0) {
            // Сортируем по остатку
            leadsWithRemaining.sort((a, b) => {
                const infoA = this.extractSubscriptionInfo(a);
                const infoB = this.extractSubscriptionInfo(b);
                return infoB.remainingClasses - infoA.remainingClasses;
            });
            
            bestLead = leadsWithRemaining[0];
            const leadInfo = this.extractSubscriptionInfo(bestLead);
            console.log(`   🎯 Найден абонемент с остатком: "${bestLead.name}"`);
            console.log(`       • Занятий: ${leadInfo.remainingClasses}/${leadInfo.totalClasses}`);
            console.log(`       • Статус: ${leadInfo.subscriptionStatus}`);
        }
    }
    
    if (bestLead) {
        // Получаем информацию об абонементе
        const subscriptionInfo = this.extractSubscriptionInfo(bestLead);
        
        // Создаем профиль
        const profile = this.createStudentProfile(
            fullContact,
            phoneNumber,
            child,
            subscriptionInfo,
            bestLead
        );
        
        studentProfiles.push(profile);
        console.log(`✅ Профиль создан: ${child.studentName}`);
    } else {
        console.log(`⚠️  Для ученика "${child.studentName}" не найдено подходящей сделки`);
        
        // Создаем профиль без абонемента
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
                    console.error(`❌ Ошибка обработки контакта ${contact.id}:`, contactError.message);
                }
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${studentProfiles.length}`);
            
        } catch (error) {
            console.error('❌ Ошибка поиска учеников:', error.message);
        }
        
        return studentProfiles;
    }

    async getFullContactInfo(contactId) {
        try {
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
        
        const profile = {
            amocrm_contact_id: contact.id || null,
            parent_contact_id: contact.id || null,
            amocrm_lead_id: lead?.id || null,
            
            // Основная информация об ученике
            student_name: studentInfo.studentName || 'Ученик',
            phone_number: phoneNumber,
            email: email || '',
            birth_date: studentInfo.birthDate || '',
            branch: studentInfo.branch || '',
            parent_name: studentInfo.parentName || contact.name || '',
            
            // Расписание
            day_of_week: studentInfo.dayOfWeek || '',
            time_slot: studentInfo.timeSlot || '',
            teacher_name: studentInfo.teacherName || '',
            age_group: studentInfo.ageGroup || '',
            course: studentInfo.course || '',
            allergies: studentInfo.allergies || '',
            
            // Абонемент
            subscription_type: subscriptionInfo.subscriptionType || 'Без абонемента',
            subscription_active: subscriptionInfo.subscriptionActive ? 1 : 0,
            subscription_status: subscriptionInfo.subscriptionStatus || 'Нет абонемента',
            subscription_badge: subscriptionInfo.subscriptionBadge || 'inactive',
            
            // Занятия
            total_classes: subscriptionInfo.totalClasses || 0,
            remaining_classes: subscriptionInfo.remainingClasses || 0,
            used_classes: subscriptionInfo.usedClasses || 0,
            
            // Даты
            expiration_date: subscriptionInfo.expirationDate || null,
            activation_date: subscriptionInfo.activationDate || null,
            last_visit_date: studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate || null,
            
            // Отформатированные даты для отображения
            expiration_date_display: formatDisplayDate(subscriptionInfo.expirationDate),
            activation_date_display: formatDisplayDate(subscriptionInfo.activationDate),
            last_visit_date_display: formatDisplayDate(studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate),
            
            // Дополнительные данные
            custom_fields: JSON.stringify(contact.custom_fields_values || []),
            raw_contact_data: JSON.stringify(contact),
            lead_data: lead ? JSON.stringify(lead) : '{}',
            
            is_demo: 0,
            source: 'amocrm',
            is_active: 1,
            last_sync: new Date().toISOString()
        };
        
        console.log(`📊 Создан профиль ученика:`);
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
                    if (fieldId === this.FIELD_IDS.CONTACT.EMAIL || 
                        this.getFieldName(field).toLowerCase().includes('email') ||
                        this.getFieldName(field).toLowerCase().includes('почта')) {
                        return fieldValue;
                    }
                }
            }
            
            return '';
            
        } catch (error) {
            console.error('❌ Ошибка поиска email:', error);
            return '';
        }
    }

    // ==================== ДИАГНОСТИЧЕСКИЕ МЕТОДЫ ====================
    async debugPhoneSearch(phoneNumber) {
        console.log(`\n🔍 ДИАГНОСТИКА ПОИСКА ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        console.log('='.repeat(80));
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return null;
        }
        
        const results = {
            phone: phoneNumber,
            contacts: [],
            students: [],
            leads: [],
            issues: []
        };
        
        try {
            // 1. Поиск контактов
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            for (const contact of contacts) {
                const contactInfo = {
                    id: contact.id,
                    name: contact.name,
                    created_at: contact.created_at ? new Date(contact.created_at * 1000).toISOString() : null,
                    updated_at: contact.updated_at ? new Date(contact.updated_at * 1000).toISOString() : null
                };
                
                results.contacts.push(contactInfo);
                
                // 2. Получаем полную информацию о контакте
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                // 3. Извлекаем учеников
                const children = this.extractStudentsFromContact(fullContact);
                
                children.forEach(child => {
                    results.students.push({
                        contact_id: contact.id,
                        contact_name: contact.name,
                        student_name: child.studentName,
                        branch: child.branch,
                        has_active_subscription: child.hasActiveSubscription
                    });
                });
                
                // 4. Получаем сделки
                const leads = await this.getContactLeadsSorted(contact.id);
                
                leads.forEach(lead => {
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    
                    results.leads.push({
                        lead_id: lead.id,
                        lead_name: lead.name,
                        contact_id: contact.id,
                        student_matches: children.filter(child => 
                            this.checkIfLeadBelongsToStudent(lead.name, child.studentName)
                        ).map(child => child.studentName),
                        subscription_info: subscriptionInfo
                    });
                });
            }
            
            // Анализ проблем
            if (results.contacts.length === 0) {
                results.issues.push('Не найдено контактов по указанному телефону');
            }
            
            if (results.students.length === 0) {
                results.issues.push('В найденных контактах нет учеников');
            }
            
            const activeSubscriptions = results.leads.filter(lead => 
                lead.subscription_info.subscriptionActive
            );
            
            if (activeSubscriptions.length === 0) {
                results.issues.push('Не найдено активных абонементов');
            }
            
            console.log(`\n📊 ИТОГИ ДИАГНОСТИКИ:`);
            console.log(`   • Контактов: ${results.contacts.length}`);
            console.log(`   • Учеников: ${results.students.length}`);
            console.log(`   • Сделок: ${results.leads.length}`);
            console.log(`   • Активных абонементов: ${activeSubscriptions.length}`);
            console.log(`   • Проблем: ${results.issues.length}`);
            
            if (results.issues.length > 0) {
                console.log(`\n🚨 ПРОБЛЕМЫ:`);
                results.issues.forEach(issue => console.log(`   • ${issue}`));
            }
            
            return results;
            
        } catch (error) {
            console.error('❌ Ошибка диагностики:', error.message);
            results.issues.push(`Ошибка диагностики: ${error.message}`);
            return results;
        }
    }

    async debugLeadAnalysis(leadId) {
        console.log(`\n🔍 ПОЛНЫЙ АНАЛИЗ СДЕЛКИ: ${leadId}`);
        console.log('='.repeat(80));
        
        try {
            const lead = await this.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}?with=custom_fields_values`
            );
            
            if (!lead) {
                console.log('❌ Сделка не найдена');
                return null;
            }
            
            const analysis = {
                lead_info: {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    price: lead.price,
                    created_at: lead.created_at ? new Date(lead.created_at * 1000).toISOString() : null,
                    updated_at: lead.updated_at ? new Date(lead.updated_at * 1000).toISOString() : null
                },
                
                subscription_info: this.extractSubscriptionInfo(lead),
                
                fields: []
            };
            
            // Анализ полей
            const customFields = lead.custom_fields_values || [];
            
            customFields.forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldName = this.getFieldName(field);
                const fieldValue = this.getFieldValue(field);
                
                analysis.fields.push({
                    id: fieldId,
                    name: fieldName,
                    value: fieldValue,
                    is_subscription_field: this.isSubscriptionField(fieldId),
                    is_important: this.isImportantField(fieldId)
                });
            });
            
            // Статистика
            const subscriptionFields = analysis.fields.filter(f => f.is_subscription_field);
            const importantFields = analysis.fields.filter(f => f.is_important);
            
            console.log(`📋 Сделка: "${lead.name}"`);
            console.log(`📊 Pipeline ID: ${lead.pipeline_id}, Status ID: ${lead.status_id}`);
            console.log(`📊 Полей всего: ${analysis.fields.length}`);
            console.log(`📊 Полей абонемента: ${subscriptionFields.length}`);
            console.log(`📊 Важных полей: ${importantFields.length}`);
            
            console.log(`\n🎯 ИНФОРМАЦИЯ ОБ АБОНЕМЕНТЕ:`);
            console.log(`   • Всего занятий: ${analysis.subscription_info.totalClasses}`);
            console.log(`   • Использовано: ${analysis.subscription_info.usedClasses}`);
            console.log(`   • Осталось: ${analysis.subscription_info.remainingClasses}`);
            console.log(`   • Статус: ${analysis.subscription_info.subscriptionStatus}`);
            console.log(`   • Активен: ${analysis.subscription_info.subscriptionActive ? '✅ Да' : '❌ Нет'}`);
            console.log(`   • Тип: ${analysis.subscription_info.subscriptionType}`);
            console.log(`   • Воронка абонемента: ${analysis.subscription_info.isInSubscriptionPipeline ? '✅ Да' : '❌ Нет'}`);
            
            console.log(`\n🔑 ВАЖНЫЕ ПОЛЯ:`);
            importantFields.forEach(field => {
                console.log(`   • ${field.name} (ID: ${field.id}): ${field.value}`);
            });
            
            return analysis;
            
        } catch (error) {
            console.error('❌ Ошибка анализа сделки:', error.message);
            return null;
        }
    }

    isSubscriptionField(fieldId) {
        const subscriptionFieldIds = [
            this.FIELD_IDS.LEAD.TOTAL_CLASSES,
            this.FIELD_IDS.LEAD.USED_CLASSES,
            this.FIELD_IDS.LEAD.REMAINING_CLASSES,
            this.FIELD_IDS.LEAD.EXPIRATION_DATE,
            this.FIELD_IDS.LEAD.ACTIVATION_DATE,
            this.FIELD_IDS.LEAD.LAST_VISIT_DATE,
            this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE,
            this.FIELD_IDS.LEAD.FREEZE
        ];
        
        return subscriptionFieldIds.includes(fieldId);
    }

    isImportantField(fieldId) {
        return this.isSubscriptionField(fieldId) || 
               (fieldId >= 884899 && fieldId <= 884929); // Чекбоксы занятий
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

// ==================== API МАРШРУТЫ ====================

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

// Получение информации об абонементе
app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id, phone } = req.body;
        
        console.log(`\n📋 ЗАПРОС АБОНЕМЕНТА`);
        console.log(`📌 profile_id: ${profile_id}`);
        console.log(`📌 phone: ${phone}`);
        
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
        
        res.json({
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
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения абонемента:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
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

// ==================== ДИАГНОСТИЧЕСКИЕ МАРШРУТЫ ====================

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
                subscription_pipeline_id: amoCrmService.SUBSCRIPTION_STATUS_IDS['!Абонемент'].pipelineId
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
