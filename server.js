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
const AMOCRM_ACCESS_TOKEN = process.env.AMOCRM_ACCESS_TOKEN;
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN;
const AMOCRM_SUBDOMAIN = AMOCRM_DOMAIN ? AMOCRM_DOMAIN.replace('.amocrm.ru', '') : '';

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

class AmoCrmService {
// Обновите конструктор класса AmoCrmService:
// Обновите конструктор класса AmoCrmService:
constructor() {
    console.log('\n' + '='.repeat(80));
    console.log('🎨 ИНИЦИАЛИЗАЦИЯ ДЛЯ ХУДОЖЕСТВЕННОЙ СТУДИИ');
    console.log('📊 ИСПОЛЬЗУЮ РЕАЛЬНЫЕ ДАННЫЕ ИЗ AMOCRM');
    console.log('='.repeat(80));
    
    this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
    this.accessToken = AMOCRM_ACCESS_TOKEN;
    this.isInitialized = false;
    
    // ВАШИ РЕАЛЬНЫЕ ID ПОЛЕЙ ИЗ ДАМПА
    this.FIELD_IDS = {
        LEAD: {
            TOTAL_CLASSES: 850241,        // "Абонемент занятий:" (например: "4 занятия")
            USED_CLASSES: 850257,         // "Счетчик занятий:" (например: "1")
            REMAINING_CLASSES: 890163,    // "Остаток занятий" (например: 3)
            SUBSCRIPTION_TYPE: 891007,    // "Тип абонемента" (например: "Повторный")
            ACTIVATION_DATE: 851565,      // "Дата активации абонемента:"
            EXPIRATION_DATE: 850255,      // "Окончание абонемента:"
            LAST_VISIT_DATE: 850259,      // "Дата последнего визита:"
            AGE_GROUP: 850243,            // "Группа возраст:"
            BRANCH: 891589,               // "Филиал"
            LESSON_PRICE: 891813,         // "Стоимость 1 занятия"
            PURCHASE_DATE: 850253,        // "Дата покупки:"
            SUBSCRIPTION_OWNERSHIP: 805465, // "Принадлежность абонемента:"
            FREEZE_SUBSCRIPTION: 867693    // "Заморозка абонемента:"
        },
        CONTACT: {
            CHILD_1_NAME: 867233,         // "!ФИО ребенка:" 
            CHILD_2_NAME: 867235,         // "!!ФИО ребенка:"
            CHILD_3_NAME: 867733,         // "!!!ФИО ребенка:"
            BRANCH: 871273,               // "Филиал:"
            TEACHER: 888881,              // "Преподаватель"
            DAY_OF_WEEK: 888879,          // "День недели посещения"
            PHONE: 216615,                // "Телефон"
            EMAIL: 216617,                // "Email"
            AGE_GROUP: 888903,            // "Возраст группы"
            HAS_ACTIVE_SUB: 890179        // "Есть активный абонемент"
        }
    };
    
    // ВОРОНКИ, ГДЕ МОГУТ НАХОДИТЬСЯ АБОНЕМЕНТЫ (на основе данных из /api/debug/pipelines)
    this.SUBSCRIPTION_PIPELINE_IDS = [
        7977402,  // Воронка "!Абонемент"
        5663740,  // Воронка "Входящие лиды"
        5663743,  // Воронка "ШКОЛА ЧЕРТАНОВО" - где найдена сделка 13154405
        7137514,  // Воронка "ШКОЛА СВИБЛОВО"
        7490194,  // Воронка "АМАКИДС"
        7977386,  // Воронка "!Воронка первичных продаж"
        7977398,  // Воронка "!Воронка повторных продаж"
        10151974  // Воронка "!Сертификаты"
    ];
    
    // АКТИВНЫЕ СТАТУСЫ ДЛЯ АБОНЕМЕНТОВ
    // Статус 142 ("Успешно реализовано") считается активным для абонементов
    this.ACTIVE_SUBSCRIPTION_STATUSES = [
        72490890, // "Купленный абонемент" (из воронки "!Абонемент")
        65473306, // "Активный абонемент" (из воронки "!Абонемент")
        142       // "Успешно реализовано" (есть во многих воронках)
    ];
    
    // Статусы, которые считаются завершенными продажами
    this.SUCCESS_STATUSES = [142];
    
    // Статусы занятий в воронках школ (для сделок типа "1-Е ЗАНЯТИЕ", "2-Е ЗАНЯТИЕ" и т.д.)
    this.LESSON_STATUSES = [
        51325726, 51325729, 51325732, 51325735, 51325738, 51325741, 51325744, 51325747,
        51325750, 51325753, 51325756, 51325759, 51325762, 51325765, 51325768, 51325771, // Чертаново
        59693174, 59693178, 59693182, 59693186, 59693190, 59693194, 59693198, 59693202,
        59693206, 59693210, 59693214, 59693218, 59693222, 59693226, 59693230, 59693234, // Свиблово
        62131974, 62131978, 62131982, 62131986, 62131990, 62131994, 62131998, 62132002,
        62132006, 62132010, 62132014, 62132018, 62132022, 62132026, 62132030, 62132034  // Амакидс
    ];
    
    console.log('✅ Использую ВАШИ реальные данные:');
    console.log(`   🎯 Воронки абонементов: ${this.SUBSCRIPTION_PIPELINE_IDS.length} воронок`);
    console.log(`   ✅ Активные статусы: ${this.ACTIVE_SUBSCRIPTION_STATUSES.join(', ')}`);
    console.log(`   📊 Статусы занятий: ${this.LESSON_STATUSES.length} статусов`);
}
    
    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    async initialize() {
        try {
            console.log('🔄 Проверка соединения с amoCRM...');
            
            if (!AMOCRM_ACCESS_TOKEN || !AMOCRM_SUBDOMAIN) {
                console.error('❌ Не установлены переменные окружения');
                return false;
            }
            
            // Простая проверка соединения
            const accountInfo = await this.makeRequest('GET', '/api/v4/account');
            
            if (accountInfo && accountInfo.id) {
                console.log(`✅ Подключено к аккаунту: "${accountInfo.name}"`);
                this.isInitialized = true;
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('❌ Ошибка инициализации:', error.message);
            return false;
        }
    }
    
    // ==================== ОСНОВНЫЕ МЕТОДЫ API ====================
    async makeRequest(method, endpoint, data = null) {
        try {
            const url = `${this.baseUrl}${endpoint}`;
            
            const config = {
                method: method,
                url: url,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'ArtSchoolApp/1.0'
                },
                timeout: 30000
            };
            
            if (data) {
                config.data = data;
            }
            
            const response = await axios(config);
            return response.data;
            
        } catch (error) {
            console.error(`❌ Ошибка запроса ${method} ${endpoint}:`, error.message);
            
            if (error.response) {
                console.error(`Статус: ${error.response.status}`);
                console.error(`Данные:`, JSON.stringify(error.response.data, null, 2));
            }
            
            throw error;
        }
    }
    
    // ==================== ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ (ИСПРАВЛЕННЫЙ) ====================
    async searchContactsByPhone(phone) {
        try {
            // Очищаем номер телефона
            const cleanPhone = phone.replace(/\D/g, '');
            console.log(`🔍 Поиск контактов по телефону (очищенный): ${cleanPhone}`);
            
            // Проверяем минимальную длину
            if (cleanPhone.length < 7) {
                console.log('❌ Слишком короткий номер телефона');
                return { _embedded: { contacts: [] } };
            }
            
            // Формируем поисковые варианты
            const searchVariants = this.generatePhoneSearchVariants(cleanPhone);
            console.log('📋 Варианты поиска:', searchVariants);
            
            let allContacts = [];
            let seenContactIds = new Set();
            
            // Ищем каждый вариант
            for (const searchTerm of searchVariants) {
                if (!searchTerm || searchTerm.length < 7) continue;
                
                console.log(`   🔎 Поиск по варианту: "${searchTerm}"`);
                
                try {
                    // Поиск контактов через API v4 с фильтром по пользовательскому полю телефона
                    const response = await this.makeRequest('GET', 
                        `/api/v4/contacts?filter[custom_fields_values][${this.FIELD_IDS.CONTACT.PHONE}][]=${searchTerm}&with=custom_fields_values&limit=250`
                    );
                    
                    if (response && response._embedded && response._embedded.contacts) {
                        const contacts = response._embedded.contacts;
                        console.log(`   📊 Найдено контактов по этому варианту: ${contacts.length}`);
                        
                        // Фильтруем только те контакты, у которых действительно есть этот телефон
                        const filteredContacts = contacts.filter(contact => {
                            // Пропускаем если уже видели этот контакт
                            if (seenContactIds.has(contact.id)) {
                                return false;
                            }
                            
                            // Проверяем наличие телефона
                            if (this.contactHasPhoneExact(contact, cleanPhone)) {
                                seenContactIds.add(contact.id);
                                return true;
                            }
                            
                            return false;
                        });
                        
                        if (filteredContacts.length > 0) {
                            console.log(`   ✅ После фильтрации: ${filteredContacts.length} контактов`);
                            allContacts = [...allContacts, ...filteredContacts];
                        }
                    }
                } catch (error) {
                    console.log(`   ⚠️  Ошибка поиска по варианту ${searchTerm}:`, error.message);
                    continue;
                }
            }
            
            // Альтернативный метод: если ничего не нашли, ищем через общий поиск
            if (allContacts.length === 0) {
                console.log('🔄 Альтернативный поиск через общий запрос...');
                try {
                    // Берем последние 10 цифр для поиска
                    const last10Digits = cleanPhone.slice(-10);
                    
                    const response = await this.makeRequest('GET', 
                        `/api/v4/contacts?query=${last10Digits}&with=custom_fields_values&limit=100`
                    );
                    
                    if (response && response._embedded && response._embedded.contacts) {
                        const contacts = response._embedded.contacts;
                        console.log(`📊 Найдено через общий поиск: ${contacts.length}`);
                        
                        // Фильтруем контакты с телефоном
                        for (const contact of contacts) {
                            if (seenContactIds.has(contact.id)) continue;
                            
                            if (this.contactHasPhoneExact(contact, cleanPhone)) {
                                seenContactIds.add(contact.id);
                                allContacts.push(contact);
                            }
                        }
                    }
                } catch (error) {
                    console.log('⚠️  Альтернативный поиск не сработал:', error.message);
                }
            }
            
            console.log(`✅ Итого найдено уникальных контактов: ${allContacts.length}`);
            
            // Если контактов нет, возвращаем пустой массив
            if (allContacts.length === 0) {
                return { _embedded: { contacts: [] } };
            }
            
            // Получаем полную информацию о каждом контакте
            const fullContacts = [];
            for (const contact of allContacts) {
                try {
                    const fullContact = await this.getFullContactInfo(contact.id);
                    if (fullContact) {
                        fullContacts.push(fullContact);
                    }
                } catch (error) {
                    console.log(`⚠️  Не удалось получить полную информацию о контакте ${contact.id}:`, error.message);
                    fullContacts.push(contact); // Добавляем хотя бы базовую информацию
                }
            }
            
            return { _embedded: { contacts: fullContacts } };
            
        } catch (error) {
            console.error('❌ Ошибка поиска контактов:', error.message);
            return { _embedded: { contacts: [] } };
        }
    }
    
    // ==================== ПОЛУЧЕНИЕ ПОЛНОЙ ИНФОРМАЦИИ О КОНТАКТЕ ====================
    async getFullContactInfo(contactId) {
        try {
            const contact = await this.makeRequest('GET', 
                `/api/v4/contacts/${contactId}?with=custom_fields_values,leads`
            );
            
            if (contact) {
                console.log(`✅ Получен контакт ${contactId}: "${contact.name}"`);
                return contact;
            }
        } catch (error) {
            console.error(`❌ Ошибка получения контакта ${contactId}:`, error.message);
            
            // Пробуем без связанных сделок
            try {
                const contact = await this.makeRequest('GET', 
                    `/api/v4/contacts/${contactId}?with=custom_fields_values`
                );
                return contact;
            } catch (error2) {
                console.error(`❌ Не удалось получить контакт ${contactId}`);
                return null;
            }
        }
        
        return null;
    }
    
    // ==================== ПОЛУЧЕНИЕ СДЕЛОК КОНТАКТА ====================
    async getContactLeads(contactId) {
        try {
            console.log(`🔍 Получение сделок контакта ID: ${contactId}`);
            
            // Метод 1: Через связанные сделки контакта
            const response = await this.makeRequest('GET', 
                `/api/v4/contacts/${contactId}/leads?with=custom_fields_values&limit=200`
            );
            
            return response?._embedded?.leads || [];
            
        } catch (error) {
            console.error(`❌ Ошибка получения сделок контакта ${contactId}:`, error.message);
            
            // Метод 2: Альтернативный метод поиска
            try {
                const response = await this.makeRequest('GET', 
                    `/api/v4/leads?filter[contact_id][]=${contactId}&with=custom_fields_values&limit=200`
                );
                
                return response?._embedded?.leads || [];
            } catch (error2) {
                console.error(`❌ Альтернативный метод тоже не сработал`);
                return [];
            }
        }
    }
    // Добавьте этот метод в класс AmoCrmService
hasStudentFields(contact) {
    if (!contact || !contact.custom_fields_values) {
        return false;
    }
    
    const studentFieldIds = [
        this.FIELD_IDS.CONTACT.CHILD_1_NAME,
        this.FIELD_IDS.CONTACT.CHILD_2_NAME,
        this.FIELD_IDS.CONTACT.CHILD_3_NAME
    ];
    
    return contact.custom_fields_values.some(field => 
        studentFieldIds.includes(field.field_id || field.id)
    );
}
    // ==================== ИЗВЛЕЧЕНИЕ УЧЕНИКОВ ИЗ КОНТАКТА ====================
    extractStudentsFromContact(contact) {
        console.log(`\n👨‍👩‍👧‍👦 Извлечение учеников из контакта: "${contact.name}"`);
        
        const students = [];
        const customFields = contact.custom_fields_values || [];
        
        const getFieldValue = (fieldId) => {
            const field = customFields.find(f => (f.field_id || f.id) === fieldId);
            if (!field || !field.values || field.values.length === 0) {
                return null;
            }
            return field.values[0].value;
        };
        
        // Извлекаем учеников
        const child1 = getFieldValue(this.FIELD_IDS.CONTACT.CHILD_1_NAME);
        const child2 = getFieldValue(this.FIELD_IDS.CONTACT.CHILD_2_NAME);
        const child3 = getFieldValue(this.FIELD_IDS.CONTACT.CHILD_3_NAME);
        
        console.log(`👦 Ученик 1: ${child1 || 'Не указан'}`);
        console.log(`👧 Ученик 2: ${child2 || 'Не указан'}`);
        console.log(`👶 Ученик 3: ${child3 || 'Не указан'}`);
        
        // Собираем данные об учениках
        const processChild = (childName, index) => {
            if (childName) {
                const studentInfo = {
                    studentName: childName,
                    branch: getFieldValue(this.FIELD_IDS.CONTACT.BRANCH) || '',
                    teacherName: getFieldValue(this.FIELD_IDS.CONTACT.TEACHER) || '',
                    ageGroup: getFieldValue(this.FIELD_IDS.CONTACT.AGE_GROUP) || '',
                    dayOfWeek: getFieldValue(this.FIELD_IDS.CONTACT.DAY_OF_WEEK) || '',
                    hasActiveSub: getFieldValue(this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) || false
                };
                
                students.push(studentInfo);
                console.log(`✅ Добавлен ученик ${index}: ${childName}`);
            }
        };
        
        processChild(child1, 1);
        processChild(child2, 2);
        processChild(child3, 3);
        
        // Если учеников нет в полях контакта, создаем одного ученика с именем контакта
        if (students.length === 0) {
            console.log('⚠️  Учеников не найдено в полях контакта, использую имя контакта');
            
            students.push({
                studentName: contact.name || 'Ученик',
                branch: getFieldValue(this.FIELD_IDS.CONTACT.BRANCH) || '',
                teacherName: getFieldValue(this.FIELD_IDS.CONTACT.TEACHER) || '',
                ageGroup: getFieldValue(this.FIELD_IDS.CONTACT.AGE_GROUP) || '',
                dayOfWeek: getFieldValue(this.FIELD_IDS.CONTACT.DAY_OF_WEEK) || '',
                hasActiveSub: getFieldValue(this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) || false
            });
        }
        
        console.log(`✅ Извлечено учеников: ${students.length}`);
        
        return students;
    }
    
    // ==================== ПОИСК САМОЙ СВЕЖЕЙ АКТИВНОЙ СДЕЛКИ ====================

    
// Обновите метод findMostRecentActiveLead:
async findMostRecentActiveLead(contactId) {
    console.log(`\n🎯 Поиск активной сделки для контакта: ${contactId}`);
    console.log(`📊 Активные статусы: ${this.ACTIVE_SUBSCRIPTION_STATUSES.join(', ')}`);
    console.log(`📊 Статусы занятий: ${this.LESSON_STATUSES.length} статусов`);
    console.log(`📊 Воронки абонементов: ${this.SUBSCRIPTION_PIPELINE_IDS.length} воронок`);
    
    try {
        // Получаем ВСЕ сделки контакта
        const allLeads = await this.getContactLeads(contactId);
        
        if (allLeads.length === 0) {
            console.log('❌ У контакта нет сделок');
            return null;
        }
        
        console.log(`📊 Всего сделок у контакта: ${allLeads.length}`);
        
        // Фильтруем сделки по критериям:
        // 1. В одной из воронок абонементов ИЛИ имеет статус занятия
        // 2. (Активный статус ИЛИ статус занятия)
        // 3. С данными об абонементе
        const activeLeads = [];
        
        for (const lead of allLeads) {
            const isInSubscriptionPipeline = this.SUBSCRIPTION_PIPELINE_IDS.includes(lead.pipeline_id);
            const hasActiveStatus = this.ACTIVE_SUBSCRIPTION_STATUSES.includes(lead.status_id);
            const isLessonStatus = this.LESSON_STATUSES.includes(lead.status_id);
            const subscriptionInfo = this.extractSubscriptionInfo(lead);
            
            const canBeActive = (isInSubscriptionPipeline || isLessonStatus) && 
                                (hasActiveStatus || isLessonStatus) && 
                                subscriptionInfo.hasSubscription;
            
            if (canBeActive) {
                activeLeads.push({
                    lead: lead,
                    subscriptionInfo: subscriptionInfo,
                    created_at: lead.created_at
                });
                console.log(`✅ Найдена активная сделка: "${lead.name}" (ID: ${lead.id})`);
                console.log(`   Воронка: ${lead.pipeline_id}, Статус: ${lead.status_id}`);
            }
        }
        
        console.log(`🎯 Активных сделок найдено: ${activeLeads.length}`);
        
        if (activeLeads.length === 0) {
            console.log('⚠️  Активных сделок не найдено, ищем любую сделку с абонементом...');
            
            // Ищем любую сделку с данными об абонементе
            const leadsWithSubscription = [];
            
            for (const lead of allLeads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                if (subscriptionInfo.hasSubscription) {
                    leadsWithSubscription.push({
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        created_at: lead.created_at
                    });
                }
            }
            
            if (leadsWithSubscription.length > 0) {
                // Находим самую свежую
                const mostRecent = leadsWithSubscription.reduce((latest, current) => {
                    return (current.created_at > latest.created_at) ? current : latest;
                });
                
                console.log(`✅ Найдена сделка с абонементом: "${mostRecent.lead.name}"`);
                console.log(`   Воронка: ${mostRecent.lead.pipeline_id}, Статус: ${mostRecent.lead.status_id}`);
                return {
                    lead: mostRecent.lead,
                    subscriptionInfo: mostRecent.subscriptionInfo,
                    match_type: 'ANY_SUBSCRIPTION'
                };
            }
            
            return null;
        }
        
        // Находим самую свежую активную сделку
        const mostRecentLead = activeLeads.reduce((latest, current) => {
            return (current.created_at > latest.created_at) ? current : latest;
        });
        
        console.log(`🎉 Самая свежая активная сделка: "${mostRecentLead.lead.name}"`);
        console.log(`   📅 Дата создания: ${new Date(mostRecentLead.created_at * 1000).toLocaleString()}`);
        console.log(`   🎯 Статус ID: ${mostRecentLead.lead.status_id}`);
        console.log(`   📍 Воронка ID: ${mostRecentLead.lead.pipeline_id}`);
        console.log(`   📊 Занятий: ${mostRecentLead.subscriptionInfo.usedClasses}/${mostRecentLead.subscriptionInfo.totalClasses}`);
        
        return {
            lead: mostRecentLead.lead,
            subscriptionInfo: mostRecentLead.subscriptionInfo,
            match_type: 'MOST_RECENT_ACTIVE'
        };
        
    } catch (error) {
        console.error(`❌ Ошибка поиска сделки:`, error.message);
        return null;
    }
}
    
    // ==================== ИЗВЛЕЧЕНИЕ ДАННЫХ ОБ АБОНЕМЕНТЕ (ИСПРАВЛЕННЫЙ) ====================
// Временный исправленный метод с максимальной отладкой
extractSubscriptionInfo(lead) {
    console.log(`\n=== НАЧАЛО extractSubscriptionInfo для сделки ${lead.id} ===`);
    console.log(`Название: "${lead.name}"`);
    console.log(`Воронка: ${lead.pipeline_id}, Статус: ${lead.status_id}`);
    
    const customFields = lead.custom_fields_values || [];
    console.log(`Всего полей: ${customFields.length}`);
    
    // Создаем карту полей для быстрого доступа
    const fieldMap = new Map();
    
    console.log(`📋 Всего полей в сделке: ${customFields.length}`);
    
    for (const field of customFields) {
        const fieldId = field.field_id || field.id;
        const fieldValue = this.getFieldValue(field);
        fieldMap.set(fieldId, fieldValue);
        
        // Логируем важные поля
        const importantFields = [
            this.FIELD_IDS.LEAD.TOTAL_CLASSES,
            this.FIELD_IDS.LEAD.USED_CLASSES,
            this.FIELD_IDS.LEAD.REMAINING_CLASSES,
            this.FIELD_IDS.LEAD.ACTIVATION_DATE,
            this.FIELD_IDS.LEAD.EXPIRATION_DATE,
            this.FIELD_IDS.LEAD.LAST_VISIT_DATE,
            this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE,
            this.FIELD_IDS.LEAD.BRANCH
        ];
        
        if (importantFields.includes(fieldId)) {
            console.log(`   📝 Поле ${fieldId}: "${fieldValue}" (тип: ${typeof fieldValue})`);
        }
    }
    
    // 1. Извлекаем общее количество занятий
    const subscriptionTypeRaw = fieldMap.get(this.FIELD_IDS.LEAD.TOTAL_CLASSES);
    console.log(`📊 "Абонемент занятий:" (ID: ${this.FIELD_IDS.LEAD.TOTAL_CLASSES}): "${subscriptionTypeRaw}"`);
    
    let totalClasses = 0;
    if (subscriptionTypeRaw) {
        // Пробуем разные способы извлечения числа
        if (typeof subscriptionTypeRaw === 'number') {
            totalClasses = subscriptionTypeRaw;
            console.log(`✅ Числовое значение totalClasses: ${totalClasses}`);
        } else if (typeof subscriptionTypeRaw === 'string') {
            // Ищем число в строке
            const match = subscriptionTypeRaw.match(/\d+/);
            if (match) {
                totalClasses = parseInt(match[0]);
                console.log(`✅ Извлекли число из текста "${subscriptionTypeRaw}": ${totalClasses}`);
            } else {
                // Пробуем преобразовать строку в число
                const num = Number(subscriptionTypeRaw);
                if (!isNaN(num)) {
                    totalClasses = num;
                    console.log(`✅ Преобразовали строку в число: ${totalClasses}`);
                }
            }
        } else if (typeof subscriptionTypeRaw === 'boolean') {
            console.log(`⚠️  Boolean значение: ${subscriptionTypeRaw}`);
        }
    }
    
    // 2. Извлекаем использованные занятия
    const usedClassesRaw = fieldMap.get(this.FIELD_IDS.LEAD.USED_CLASSES);
    console.log(`📊 "Счетчик занятий:" (ID: ${this.FIELD_IDS.LEAD.USED_CLASSES}): "${usedClassesRaw}"`);
    
    let usedClasses = 0;
    if (usedClassesRaw !== null && usedClassesRaw !== undefined) {
        if (typeof usedClassesRaw === 'number') {
            usedClasses = usedClassesRaw;
            console.log(`✅ Числовое значение usedClasses: ${usedClasses}`);
        } else if (typeof usedClassesRaw === 'string') {
            const match = usedClassesRaw.match(/\d+/);
            if (match) {
                usedClasses = parseInt(match[0]);
                console.log(`✅ Извлекли число из текста "${usedClassesRaw}": ${usedClasses}`);
            } else {
                const num = Number(usedClassesRaw);
                if (!isNaN(num)) {
                    usedClasses = num;
                    console.log(`✅ Преобразовали строку в число: ${usedClasses}`);
                }
            }
        }
    }
    
    // 3. Извлекаем остаток занятий
    const remainingClassesRaw = fieldMap.get(this.FIELD_IDS.LEAD.REMAINING_CLASSES);
    console.log(`📊 "Остаток занятий" (ID: ${this.FIELD_IDS.LEAD.REMAINING_CLASSES}): "${remainingClassesRaw}"`);
    
    let remainingClasses = 0;
    if (remainingClassesRaw !== null && remainingClassesRaw !== undefined) {
        if (typeof remainingClassesRaw === 'number') {
            remainingClasses = remainingClassesRaw;
            console.log(`✅ Числовое значение remainingClasses: ${remainingClasses}`);
        } else if (typeof remainingClassesRaw === 'string') {
            const match = remainingClassesRaw.match(/\d+/);
            if (match) {
                remainingClasses = parseInt(match[0]);
                console.log(`✅ Извлекли число из текста "${remainingClassesRaw}": ${remainingClasses}`);
            } else {
                const num = Number(remainingClassesRaw);
                if (!isNaN(num)) {
                    remainingClasses = num;
                    console.log(`✅ Преобразовали строку в число: ${remainingClasses}`);
                }
            }
        }
    }
    
    // 4. Если остаток не указан, вычисляем его
    if (remainingClasses === 0 && totalClasses > 0 && usedClasses >= 0) {
        remainingClasses = Math.max(0, totalClasses - usedClasses);
        console.log(`🔄 Вычислен остаок: ${totalClasses} - ${usedClasses} = ${remainingClasses}`);
    }
    
    // 5. Получаем другие данные
    const subscriptionType = subscriptionTypeRaw || 'Без абонемента';
    const activationDate = this.parseDate(fieldMap.get(this.FIELD_IDS.LEAD.ACTIVATION_DATE));
    const expirationDate = this.parseDate(fieldMap.get(this.FIELD_IDS.LEAD.EXPIRATION_DATE));
    const lastVisitDate = this.parseDate(fieldMap.get(this.FIELD_IDS.LEAD.LAST_VISIT_DATE));
    const ageGroup = fieldMap.get(this.FIELD_IDS.LEAD.AGE_GROUP) || '';
    const branch = fieldMap.get(this.FIELD_IDS.LEAD.BRANCH) || '';
    const subscriptionTypeField = fieldMap.get(this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE) || '';
    
    // 6. Определяем статус абонемента
   // 6. Определяем статус абонемента
    const hasSubscription = totalClasses > 0 || remainingClasses > 0 || usedClasses > 0 ||
                           (subscriptionType && subscriptionType !== 'Без абонемента');
    
   const isInSubscriptionPipeline = this.SUBSCRIPTION_PIPELINE_IDS.includes(lead.pipeline_id);
    const hasActiveStatus = this.ACTIVE_SUBSCRIPTION_STATUSES.includes(lead.status_id);
    const isLessonStatus = this.LESSON_STATUSES.includes(lead.status_id);
    
     // ПРОСТАЯ И ПОНЯТНАЯ ПРОВЕРКА:
    console.log(`\n=== ПРОВЕРКА АКТИВНОСТИ ===`);
    console.log(`SUBSCRIPTION_PIPELINE_IDS:`, this.SUBSCRIPTION_PIPELINE_IDS);
    console.log(`ACTIVE_SUBSCRIPTION_STATUSES:`, this.ACTIVE_SUBSCRIPTION_STATUSES);
    
    const isInSubscriptionPipeline = this.SUBSCRIPTION_PIPELINE_IDS.includes(lead.pipeline_id);
    const hasActiveStatus = this.ACTIVE_SUBSCRIPTION_STATUSES.includes(lead.status_id);
    
    console.log(`isInSubscriptionPipeline: ${isInSubscriptionPipeline} (${lead.pipeline_id} in [${this.SUBSCRIPTION_PIPELINE_IDS}])`);
    console.log(`hasActiveStatus: ${hasActiveStatus} (${lead.status_id} in [${this.ACTIVE_SUBSCRIPTION_STATUSES}])`);
    console.log(`hasSubscription: ${hasSubscription} (totalClasses: ${totalClasses}, subscriptionType: "${subscriptionType}")`);
    
    // САМАЯ ПРОСТАЯ ЛОГИКА:
    let subscriptionActive = false;
    let subscriptionStatus = 'Нет данных';
    let subscriptionBadge = 'inactive';
    
    if (isInSubscriptionPipeline && hasActiveStatus && hasSubscription) {
        subscriptionActive = true;
        subscriptionStatus = 'Активен';
        subscriptionBadge = 'active';
        console.log(`✅ СДЕЛКА АКТИВНА по условию 1`);
    } else if (hasSubscription) {
        subscriptionActive = false;
        subscriptionStatus = 'Есть абонемент';
        subscriptionBadge = 'warning';
        console.log(`⚠️  Есть абонемент, но не активен`);
    } else {
        subscriptionActive = false;
        subscriptionStatus = 'Нет абонемента';
        subscriptionBadge = 'inactive';
        console.log(`❌ Нет абонемента`);
    }
    
    console.log(`=== РЕЗУЛЬТАТ: subscriptionActive = ${subscriptionActive} ===`);
    
    return {
        hasSubscription: hasSubscription,
        subscriptionActive: subscriptionActive,
        subscriptionStatus: subscriptionStatus,
        subscriptionBadge: subscriptionBadge,
        
        subscriptionType: subscriptionType,
        subscriptionTypeField: subscriptionTypeField,
        totalClasses: totalClasses,
        usedClasses: usedClasses,
        remainingClasses: remainingClasses,
        
        expirationDate: expirationDate,
        activationDate: activationDate,
        lastVisitDate: lastVisitDate,
        
        ageGroup: ageGroup,
        branch: branch,
        
        isInSubscriptionPipeline: isInSubscriptionPipeline,
        hasActiveStatus: hasActiveStatus,
        pipelineId: lead.pipeline_id,
        statusId: lead.status_id,
        
        // Для отладки
        rawData: {
            totalClassesRaw: subscriptionTypeRaw,
            usedClassesRaw: usedClassesRaw,
            remainingClassesRaw: remainingClassesRaw
        }
    };
}
    
    // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ====================
    // ==================== ИЗВЛЕЧЕНИЕ ЧИСЛА ИЗ ПОЛЯ ====================
extractNumberFromField(value) {
    if (value === null || value === undefined) {
        return 0;
    }
    
    if (typeof value === 'number') {
        return value;
    }
    
    if (typeof value === 'string') {
        // Убираем все нецифровые символы, кроме точки и минуса
        const cleanStr = value.replace(/[^\d.-]/g, '');
        const num = parseFloat(cleanStr);
        return isNaN(num) ? 0 : num;
    }
    
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    
    return 0;
}
    getFieldValue(field) {
        if (!field || !field.values || field.values.length === 0) {
            return null;
        }
        
        return field.values[0].value;
    }
    
    // ==================== ГЕНЕРАЦИЯ ВАРИАНТОВ ТЕЛЕФОНА ДЛЯ ПОИСКА ====================
    generatePhoneSearchVariants(cleanPhone) {
        const variants = new Set();
        
        // Сохраняем исходный вариант
        variants.add(cleanPhone);
        
        // Различные форматы
        const last10 = cleanPhone.slice(-10);
        const last7 = cleanPhone.slice(-7);
        
        // Российские форматы
        if (cleanPhone.length === 11) {
            if (cleanPhone.startsWith('7')) {
                variants.add('8' + cleanPhone.slice(1)); // 7XXXXXXXXXX -> 8XXXXXXXXXX
                variants.add(cleanPhone.slice(1)); // Без 7
                variants.add('+7' + cleanPhone.slice(1)); // +7XXXXXXXXXX
            } else if (cleanPhone.startsWith('8')) {
                variants.add('7' + cleanPhone.slice(1)); // 8XXXXXXXXXX -> 7XXXXXXXXXX
                variants.add(cleanPhone.slice(1)); // Без 8
                variants.add('+7' + cleanPhone.slice(1)); // +7XXXXXXXXXX
            }
        } else if (cleanPhone.length === 10) {
            variants.add('7' + cleanPhone); // XXXXXXXXXX -> 7XXXXXXXXXX
            variants.add('8' + cleanPhone); // XXXXXXXXXX -> 8XXXXXXXXXX
            variants.add('+7' + cleanPhone); // XXXXXXXXXX -> +7XXXXXXXXXX
        }
        
        // Варианты без кода страны
        if (cleanPhone.length >= 10) {
            variants.add(cleanPhone.slice(-10)); // Последние 10 цифр
        }
        variants.add(cleanPhone.slice(-9)); // Последние 9 цифр
        variants.add(last7); // Последние 7 цифр
        
        // Удаляем слишком короткие варианты
        const result = Array.from(variants).filter(v => v && v.length >= 7);
        return result;
    }
    
    // ==================== ПРОВЕРКА НАЛИЧИЯ ТЕЛЕФОНА У КОНТАКТА (ТОЧНЫЙ ПОИСК) ====================
    contactHasPhoneExact(contact, targetPhone) {
        if (!contact || !contact.custom_fields_values) {
            return false;
        }
        
        // Очищаем целевой телефон
        const cleanTarget = targetPhone.replace(/\D/g, '');
        
        // Ищем поле телефона
        const phoneFields = contact.custom_fields_values.filter(field => {
            const fieldId = field.field_id || field.id;
            return fieldId === this.FIELD_IDS.CONTACT.PHONE;
        });
        
        if (phoneFields.length === 0) {
            return false;
        }
        
        // Проверяем все значения телефона
        for (const phoneField of phoneFields) {
            if (phoneField.values && Array.isArray(phoneField.values)) {
                for (const value of phoneField.values) {
                    const contactPhone = String(value.value || '').replace(/\D/g, '');
                    
                    // Различные варианты сравнения
                    if (contactPhone === cleanTarget) {
                        return true;
                    }
                    
                    // Сравнение последних 10 цифр
                    if (contactPhone.slice(-10) === cleanTarget.slice(-10)) {
                        return true;
                    }
                    
                    // Сравнение последних 7 цифр
                    if (contactPhone.slice(-7) === cleanTarget.slice(-7)) {
                        return true;
                    }
                }
            }
        }
        
        return false;
    }
    
    parseDate(value) {
        if (!value) return null;
        
        try {
            // Если это timestamp
            if (typeof value === 'number') {
                // Если это секунды
                if (value > 1000000000 && value < 100000000000) {
                    const date = new Date(value * 1000);
                    return date.toISOString().split('T')[0];
                }
                // Если это миллисекунды
                if (value > 1000000000000) {
                    const date = new Date(value);
                    return date.toISOString().split('T')[0];
                }
            }
            
            // Если это строка даты в формате DD.MM.YYYY
            if (typeof value === 'string') {
                // Пробуем разобрать формат DD.MM.YYYY
                const parts = value.split('.');
                if (parts.length === 3) {
                    const day = parseInt(parts[0]);
                    const month = parseInt(parts[1]) - 1;
                    const year = parseInt(parts[2]);
                    
                    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                        const date = new Date(year, month, day);
                        return date.toISOString().split('T')[0];
                    }
                }
                
                // Пробуем стандартный формат
                const date = new Date(value);
                if (!isNaN(date.getTime())) {
                    return date.toISOString().split('T')[0];
                }
                
                return value; // Возвращаем как есть, если не удалось распарсить
            }
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error, 'Значение:', value);
        }
        
        return null;
    }
    
    normalizeName(name) {
        if (!name || typeof name !== 'string') return '';
        return name.toLowerCase().trim();
    }
    
   // ==================== ГЛАВНЫЙ МЕТОД: ПОЛУЧЕНИЕ УЧЕНИКОВ ПО ТЕЛЕФОНУ (ИСПРАВЛЕННЫЙ) ====================
async getStudentsByPhone(phoneNumber) {
    console.log(`\n📱 ПОЛУЧЕНИЕ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
    console.log('='.repeat(60));
    
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
            console.log('⚠️  Контакты не найдены');
            return studentProfiles;
        }
        
        // 2. Обрабатываем КАЖДЫЙ контакт
        for (const contact of contacts) {
            try {
                console.log(`\n📋 Обработка контакта: "${contact.name || 'Без имени'}" (ID: ${contact.id})`);
                
                // Проверяем, есть ли у контакта ученики в полях
                const children = this.extractStudentsFromContact(contact);
                console.log(`👥 Учеников в контакте: ${children.length}`);
                
                // Если нет учеников в полях, создаем одного ученика из имени контакта
                if (children.length === 0) {
                    console.log('⚠️  У контакта нет учеников в полях, создаю ученика из имени контакта');
                    const defaultChild = {
                        studentName: contact.name || 'Ученик',
                        branch: '',
                        teacherName: '',
                        ageGroup: '',
                        dayOfWeek: '',
                        hasActiveSub: false
                    };
                    
                    children.push(defaultChild);
                }
                
                // 3. Ищем активные сделки для каждого контакта
                let subscriptionInfo = this.getDefaultSubscriptionInfo();
                let leadData = null;
                
                // Получаем связанные сделки
                if (contact._embedded?.leads && contact._embedded.leads.length > 0) {
                    console.log(`📊 У контакта ${contact._embedded.leads.length} сделок`);
                    
                    // Ищем самую свежую активную сделку
                    const mostRecentActive = await this.findMostRecentActiveLead(contact.id);
                    
                    if (mostRecentActive) {
                        console.log(`✅ Найдена активная сделка: "${mostRecentActive.lead.name}"`);
                        subscriptionInfo = mostRecentActive.subscriptionInfo;
                        leadData = mostRecentActive.lead;
                    } else {
                        // Если нет активной, ищем любую сделку с абонементом
                        console.log('🔍 Поиск любой сделки с абонементом...');
                        const anyLeadWithSubscription = await this.findAnyLeadWithSubscription(contact.id);
                        
                        if (anyLeadWithSubscription) {
                            console.log(`✅ Найдена сделка с абонементом: "${anyLeadWithSubscription.lead.name}"`);
                            subscriptionInfo = anyLeadWithSubscription.subscriptionInfo;
                            leadData = anyLeadWithSubscription.lead;
                        }
                    }
                } else {
                    console.log('⚠️  У контакта нет связанных сделок');
                }
                
                // 4. Создаем профили для каждого ученика
                for (const child of children) {
                    console.log(`\n👤 Создание профиля для ученика: "${child.studentName}"`);
                    
                    const profile = this.createStudentProfile(
                        contact,
                        phoneNumber,
                        child,
                        subscriptionInfo,
                        leadData
                    );
                    
                    studentProfiles.push(profile);
                    console.log(`✅ Профиль создан: ${profile.student_name}`);
                }
                
            } catch (contactError) {
                console.error(`❌ Ошибка обработки контакта:`, contactError.message);
            }
        }
        
        // Убираем дубликаты
        const uniqueProfiles = [];
        const seenKeys = new Set();
        
        for (const profile of studentProfiles) {
            const key = `${profile.student_name}_${profile.phone_number}_${profile.branch}`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                uniqueProfiles.push(profile);
            }
        }
        
        console.log(`\n🎯 ИТОГО создано профилей: ${uniqueProfiles.length}`);
        
        return uniqueProfiles;
        
    } catch (error) {
        console.error('❌ Критическая ошибка поиска учеников:', error.message);
        return studentProfiles;
    }
}

// ==================== ПОИСК ЛЮБОЙ СДЕЛКИ С АБОНЕМЕНТОМ ====================
async findAnyLeadWithSubscription(contactId) {
    console.log(`🔍 Поиск любой сделки с абонементом для контакта: ${contactId}`);
    
    try {
        const allLeads = await this.getContactLeads(contactId);
        
        if (allLeads.length === 0) {
            return null;
        }
        
        console.log(`📊 Всего сделок: ${allLeads.length}`);
        
        // Ищем первую сделку с данными об абонементе
        for (const lead of allLeads) {
            const subscriptionInfo = this.extractSubscriptionInfo(lead);
            if (subscriptionInfo.hasSubscription) {
                console.log(`✅ Найдена сделка с абонементом: "${lead.name}"`);
                return {
                    lead: lead,
                    subscriptionInfo: subscriptionInfo,
                    match_type: 'ANY_SUBSCRIPTION'
                };
            }
        }
        
        // Если не нашли с абонементом, берем самую свежую сделку
        const mostRecentLead = allLeads.reduce((latest, current) => {
            return (current.created_at > latest.created_at) ? current : latest;
        });
        
        const subscriptionInfo = this.extractSubscriptionInfo(mostRecentLead);
        
        return {
            lead: mostRecentLead,
            subscriptionInfo: subscriptionInfo,
            match_type: 'MOST_RECENT'
        };
        
    } catch (error) {
        console.error(`❌ Ошибка поиска любой сделки:`, error.message);
        return null;
    }
}
    
    // ==================== СОЗДАНИЕ ПРОФИЛЯ УЧЕНИКА ====================
   // ==================== СОЗДАНИЕ ПРОФИЛЯ УЧЕНИКА (ОБНОВЛЕННЫЙ) ====================
createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
    // Получаем email из контакта
    let email = '';
    if (contact.custom_fields_values) {
        const emailField = contact.custom_fields_values.find(f => 
            (f.field_id || f.id) === this.FIELD_IDS.CONTACT.EMAIL
        );
        if (emailField && emailField.values && emailField.values.length > 0) {
            email = this.getFieldValue(emailField);
        }
    }
    
    // Получаем филиал
    let branch = subscriptionInfo.branch || studentInfo.branch || '';
    
    if (!branch && contact.custom_fields_values) {
        const branchField = contact.custom_fields_values.find(f =>
            (f.field_id || f.id) === this.FIELD_IDS.CONTACT.BRANCH
        );
        
        if (branchField) {
            branch = this.getFieldValue(branchField);
        }
    }
    
    // Получаем имя родителя
    let parentName = contact.name || '';
    
    // Если имя контакта содержит "Контакт", убираем это
    if (parentName.includes('Контакт ') && parentName.replace('Контакт ', '').match(/^\d+$/)) {
        parentName = '';
    }
    
    // Проверяем, есть ли активный абонемент
    let hasActiveSub = studentInfo.hasActiveSub || false;
    if (contact.custom_fields_values) {
        const activeSubField = contact.custom_fields_values.find(f =>
            (f.field_id || f.id) === this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB
        );
        
        if (activeSubField) {
            const fieldValue = this.getFieldValue(activeSubField);
            if (fieldValue === true || fieldValue === 'true' || fieldValue === '1') {
                hasActiveSub = true;
            }
        }
    }
    
    const profile = {
        amocrm_contact_id: contact.id || null,
        parent_contact_id: contact.id || null,
        amocrm_lead_id: lead?.id || null,
        
        student_name: studentInfo.studentName || 'Ученик',
        phone_number: phoneNumber,
        email: email || '',
        birth_date: '',
        branch: branch || 'Филиал не указан',
        parent_name: parentName || '',
        
        day_of_week: studentInfo.dayOfWeek || '',
        time_slot: '',
        teacher_name: studentInfo.teacherName || '',
        age_group: studentInfo.ageGroup || subscriptionInfo.ageGroup || '',
        course: '',
        allergies: '',
        
        subscription_type: subscriptionInfo.subscriptionType || 'Без абонемента',
        subscription_active: subscriptionInfo.subscriptionActive ? 1 : 0,
        subscription_status: subscriptionInfo.subscriptionStatus || 'Не активен',
        subscription_badge: subscriptionInfo.subscriptionBadge || 'inactive',
        
        total_classes: subscriptionInfo.totalClasses || 0,
        used_classes: subscriptionInfo.usedClasses || 0,
        remaining_classes: subscriptionInfo.remainingClasses || 0,
        
        expiration_date: subscriptionInfo.expirationDate || null,
        activation_date: subscriptionInfo.activationDate || null,
        last_visit_date: subscriptionInfo.lastVisitDate || null,
        purchase_date: null,
        trial_date: null,
        
        lesson_price: 0,
        first_lesson: false,
        
        custom_fields: JSON.stringify(contact.custom_fields_values || []),
        raw_contact_data: JSON.stringify(contact),
        lead_data: lead ? JSON.stringify(lead) : '{}',
        
        is_demo: 0,
        source: 'amocrm',
        is_active: hasActiveSub ? 1 : 0,
        last_sync: new Date().toISOString()
    };
    
    console.log(`👤 СОЗДАН ПРОФИЛЬ: ${profile.student_name}`);
    console.log(`   🎫 Абонемент: ${profile.subscription_type}`);
    console.log(`   📊 Занятий: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
    console.log(`   ✅ Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
    console.log(`   🏫 Филиал: ${profile.branch}`);
    console.log(`   📅 Окончание: ${profile.expiration_date || 'Не указано'}`);
    
    return profile;
}
    
    getDefaultSubscriptionInfo() {
        return {
            hasSubscription: false,
            subscriptionActive: false,
            subscriptionStatus: 'Нет абонемента',
            subscriptionBadge: 'inactive',
            totalClasses: 0,
            usedClasses: 0,
            remainingClasses: 0,
            subscriptionType: 'Без абонемента',
            expirationDate: null,
            activationDate: null,
            lastVisitDate: null
        };
    }
}

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
        
        console.log('\n🎉 Все таблицы созданы успешно!');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};

// ==================== СОХРАНЕНИЕ ПРОФИЛЕЙ В БД ====================
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
                    await db.run(
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
                    
                    savedCount++;
                    console.log(`✅ Профиль создан: ${profile.student_name}`);
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
                    
                    savedCount++;
                    console.log(`✅ Профиль обновлен: ${profile.student_name}`);
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

// ==================== ГЛАВНЫЙ API ДЛЯ ПРИЛОЖЕНИЯ ====================
app.post('/api/auth/real-data', async (req, res) => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🔐 АВТОРИЗАЦИЯ ПО РЕАЛЬНЫМ ДАННЫМ');
        console.log('='.repeat(80));
        
        const { phone, student_name } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        // Форматируем телефон
        const formatPhoneNumber = (phone) => {
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
            
            return '+' + cleanPhone.slice(-11);
        };
        
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`📱 Телефон: ${formattedPhone}`);
        
        // Проверяем подключение к amoCRM
        if (!amoCrmService.isInitialized) {
            console.log('❌ amoCRM не подключен');
            return res.status(503).json({
                success: false,
                error: 'Система временно недоступна'
            });
        }
        
        // Получаем данные из amoCRM
        console.log('🔍 Поиск реальных данных в amoCRM...');
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        if (profiles.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Ученики не найдены',
                message: 'По указанному телефону не найдено учеников в системе.',
                phone: formattedPhone,
                profiles: []
            });
        }
        
        // Сохраняем в БД
        const savedCount = await saveProfilesToDatabase(profiles);
        console.log(`💾 Сохранено в БД: ${savedCount} профилей`);
        
        // Создаем токен
        const sessionId = crypto.randomBytes(32).toString('hex');
        const token = jwt.sign(
            {
                session_id: sessionId,
                phone: formattedPhone,
                profiles_count: profiles.length,
                timestamp: Date.now()
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        // Сохраняем сессию
        await db.run(
            `INSERT INTO user_sessions (session_id, session_data, phone_number, expires_at) 
             VALUES (?, ?, ?, ?)`,
            [
                sessionId,
                JSON.stringify({ 
                    phone: formattedPhone,
                    profiles_count: profiles.length 
                }),
                formattedPhone,
                new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            ]
        );
        
        // Форматируем ответ для приложения
        const responseProfiles = profiles.map(p => ({
            id: p.id || null,
            student_name: p.student_name,
            phone_number: p.phone_number,
            email: p.email,
            branch: p.branch || 'Филиал не указан',
            teacher_name: p.teacher_name,
            age_group: p.age_group,
            subscription_type: p.subscription_type,
            subscription_active: p.subscription_active === 1,
            subscription_status: p.subscription_status,
            subscription_badge: p.subscription_badge,
            total_classes: p.total_classes,
            remaining_classes: p.remaining_classes,
            used_classes: p.used_classes,
            expiration_date: p.expiration_date,
            activation_date: p.activation_date,
            last_visit_date: p.last_visit_date,
            parent_name: p.parent_name,
            is_demo: p.is_demo === 1,
            source: p.source,
            last_sync: p.last_sync
        }));
        
        console.log('\n' + '='.repeat(80));
        console.log('✅ РЕАЛЬНЫЕ ДАННЫЕ НАЙДЕНЫ');
        console.log('='.repeat(80));
        console.log(`📱 Телефон: ${formattedPhone}`);
        console.log(`👥 Учеников: ${responseProfiles.length}`);
        console.log(`✅ Данные из: amoCRM (настоящие, не тестовые)`);
        
        responseProfiles.forEach((profile, index) => {
            console.log(`\n${index + 1}. ${profile.student_name}`);
            console.log(`   🎫 Абонемент: ${profile.subscription_type}`);
            console.log(`   📊 Занятий: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
            console.log(`   ✅ Активен: ${profile.subscription_active ? 'Да' : 'Нет'}`);
            console.log(`   🏫 Филиал: ${profile.branch}`);
            console.log(`   📅 Окончание: ${profile.expiration_date || 'Не указано'}`);
        });
        
        res.json({
            success: true,
            message: 'Реальные данные найдены',
            data: {
                user: {
                    phone_number: formattedPhone,
                    name: responseProfiles.length > 0 ? 
                        responseProfiles[0].parent_name || responseProfiles[0].student_name : 'Гость',
                    is_temp: true,
                    profiles_count: responseProfiles.length
                },
                profiles: responseProfiles,
                total_profiles: responseProfiles.length,
                amocrm_connected: true,
                has_real_data: true,
                has_multiple_students: responseProfiles.length > 1,
                token: token,
                last_sync: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ ОШИБКА АВТОРИЗАЦИИ:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки телефона',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==================== ПРОВЕРОЧНЫЕ МАРШРУТЫ ====================
// Добавим маршрут для получения информации о воронках
app.get('/api/debug/pipelines', async (req, res) => {
    try {
        console.log(`\n🔍 ПОЛУЧЕНИЕ ВСЕХ ВОРОНОК`);
        
        // Получаем все воронки
        const pipelines = await amoCrmService.makeRequest('GET', '/api/v4/leads/pipelines');
        
        console.log(`📊 Найдено воронок: ${pipelines._embedded?.pipelines?.length || 0}`);
        
        const pipelineData = [];
        
        if (pipelines._embedded && pipelines._embedded.pipelines) {
            for (const pipeline of pipelines._embedded.pipelines) {
                console.log(`\n📁 Воронка: "${pipeline.name}" (ID: ${pipeline.id})`);
                
                // Получаем статусы для этой воронки
                try {
                    const pipelineWithStatuses = await amoCrmService.makeRequest('GET', 
                        `/api/v4/leads/pipelines/${pipeline.id}`
                    );
                    
                    if (pipelineWithStatuses && pipelineWithStatuses._embedded && pipelineWithStatuses._embedded.statuses) {
                        console.log(`   Статусы (${pipelineWithStatuses._embedded.statuses.length}):`);
                        pipelineWithStatuses._embedded.statuses.forEach(status => {
                            console.log(`      ${status.id}: "${status.name}"`);
                        });
                        
                        pipelineData.push({
                            id: pipeline.id,
                            name: pipeline.name,
                            statuses: pipelineWithStatuses._embedded.statuses.map(s => ({
                                id: s.id,
                                name: s.name
                            }))
                        });
                    }
                } catch (error) {
                    console.log(`   ⚠️  Не удалось получить статусы: ${error.message}`);
                    pipelineData.push({
                        id: pipeline.id,
                        name: pipeline.name,
                        statuses: []
                    });
                }
            }
        }
        
        res.json({
            success: true,
            data: {
                pipelines: pipelineData,
                current_settings: {
                    subscription_pipeline_id: amoCrmService.SUBSCRIPTION_PIPELINE_ID,
                    active_statuses: amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения воронок:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ОТЛАДОЧНЫЙ МАРШРУТ ДЛЯ ПОИСКА УЧЕНИКОВ ====================
app.get('/api/debug/get-students/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        console.log(`\n🔍 ОТЛАДКА ПОИСКА УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phone}`);
        
        // 1. Тест поиска контактов
        console.log('\n🔍 1. Тест поиска контактов...');
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        // 2. Тест извлечения учеников из каждого контакта
        console.log('\n👥 2. Извлечение учеников из контактов...');
        const allStudents = [];
        
        for (const contact of contacts) {
            console.log(`\n📋 Контакт: "${contact.name || 'Без имени'}" (ID: ${contact.id})`);
            
            const students = amoCrmService.extractStudentsFromContact(contact);
            console.log(`   Учеников в контакте: ${students.length}`);
            
            if (students.length > 0) {
                students.forEach((student, index) => {
                    console.log(`   ${index + 1}. ${student.studentName}`);
                });
                allStudents.push(...students);
            }
        }
        
        // 3. Тест поиска активных сделок
        console.log('\n🎯 3. Поиск активных сделок...');
        const contactLeadsData = [];
        
        for (const contact of contacts) {
            console.log(`\n📊 Контакт ID: ${contact.id}`);
            const leads = await amoCrmService.getContactLeads(contact.id);
            console.log(`   Сделок всего: ${leads.length}`);
            
            // Находим активную сделку
            const activeLead = await amoCrmService.findMostRecentActiveLead(contact.id);
            
            contactLeadsData.push({
                contact_id: contact.id,
                contact_name: contact.name,
                leads_count: leads.length,
                has_active_lead: !!activeLead,
                active_lead_name: activeLead?.lead?.name,
                active_lead_id: activeLead?.lead?.id
            });
            
            if (activeLead) {
                console.log(`   ✅ Активная сделка: "${activeLead.lead.name}" (ID: ${activeLead.lead.id})`);
                console.log(`      Статус: ${activeLead.subscriptionInfo.subscriptionStatus}`);
                console.log(`      Занятий: ${activeLead.subscriptionInfo.usedClasses}/${activeLead.subscriptionInfo.totalClasses}`);
            } else {
                console.log(`   ❌ Активных сделок не найдено`);
            }
        }
        
        // 4. Тест главного метода
        console.log('\n📱 4. Тест главного метода getStudentsByPhone...');
        const profiles = await amoCrmService.getStudentsByPhone(phone);
        
        console.log(`\n🎯 ИТОГО:`);
        console.log(`   Контактов: ${contacts.length}`);
        console.log(`   Учеников в контактах: ${allStudents.length}`);
        console.log(`   Профилей создано: ${profiles.length}`);
        
        if (profiles.length > 0) {
            profiles.forEach((profile, index) => {
                console.log(`\n   ${index + 1}. ${profile.student_name}`);
                console.log(`      Контакт ID: ${profile.amocrm_contact_id}`);
                console.log(`      Сделка ID: ${profile.amocrm_lead_id || 'Нет'}`);
                console.log(`      Абонемент: ${profile.subscription_type}`);
                console.log(`      Занятий: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
                console.log(`      Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
                console.log(`      Филиал: ${profile.branch}`);
                console.log(`      Email: ${profile.email || 'Нет'}`);
            });
        } else {
            console.log('   ❌ Профили не созданы');
            
            // Пробуем создать профиль вручную для отладки
            console.log('\n🔧 Создание профиля вручную для отладки...');
            if (contacts.length > 0) {
                const contact = contacts[0];
                const students = amoCrmService.extractStudentsFromContact(contact);
                
                if (students.length > 0) {
                    const student = students[0];
                    const defaultSubscription = amoCrmService.getDefaultSubscriptionInfo();
                    
                    const manualProfile = amoCrmService.createStudentProfile(
                        contact,
                        phone,
                        student,
                        defaultSubscription,
                        null
                    );
                    
                    console.log(`✅ Создан профиль вручную: ${manualProfile.student_name}`);
                    console.log(`   Данные:`, manualProfile);
                }
            }
        }
        
        res.json({
            success: true,
            data: {
                phone: phone,
                contacts_count: contacts.length,
                students_in_contacts_count: allStudents.length,
                profiles_count: profiles.length,
                contacts: contacts.map(c => ({
                    id: c.id,
                    name: c.name,
                    has_students_fields: amoCrmService.hasStudentFields(c),
                    custom_fields_count: c.custom_fields_values?.length || 0
                })),
                contact_leads_data: contactLeadsData,
                profiles: profiles.map(p => ({
                    student_name: p.student_name,
                    contact_id: p.amocrm_contact_id,
                    lead_id: p.amocrm_lead_id,
                    subscription_type: p.subscription_type,
                    total_classes: p.total_classes,
                    used_classes: p.used_classes,
                    remaining_classes: p.remaining_classes,
                    subscription_active: p.subscription_active === 1,
                    branch: p.branch,
                    email: p.email
                }))
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка отладки:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Добавим этот маршрут для детальной проверки
app.get('/api/debug/check-active-status/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        console.log(`\n🔍 ПРОВЕРКА СТАТУСА АКТИВНОСТИ ДЛЯ СДЕЛКИ: ${leadId}`);
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest('GET', 
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.json({ success: false, error: 'Сделка не найдена' });
        }
        
        // Получаем информацию об абонементе
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        // Проверяем статусы
        const isInSubscriptionPipeline = lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID;
        const isActiveStatus = amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.includes(lead.status_id);
        const hasSubscription = subscriptionInfo.hasSubscription;
        
        console.log(`📊 Данные сделки:`);
        console.log(`   Название: "${lead.name}"`);
        console.log(`   ID сделки: ${lead.id}`);
        console.log(`   ID воронки: ${lead.pipeline_id}`);
        console.log(`   ID статуса: ${lead.status_id}`);
        console.log(`   Воронка абонементов: ${amoCrmService.SUBSCRIPTION_PIPELINE_ID}`);
        console.log(`   Активные статусы: ${amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.join(', ')}`);
        
        console.log(`\n✅ Проверка условий:`);
        console.log(`   1. В нужной воронке: ${isInSubscriptionPipeline ? '✅' : '❌'} (${lead.pipeline_id} === ${amoCrmService.SUBSCRIPTION_PIPELINE_ID})`);
        console.log(`   2. Активный статус: ${isActiveStatus ? '✅' : '❌'} (${lead.status_id} in [${amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.join(', ')}])`);
        console.log(`   3. Есть абонемент: ${hasSubscription ? '✅' : '❌'}`);
        
        const shouldBeActive = isInSubscriptionPipeline && isActiveStatus && hasSubscription;
        console.log(`\n🎯 ИТОГО: Сделка должна быть активной: ${shouldBeActive ? '✅ ДА' : '❌ НЕТ'}`);
        
        // Получаем все статусы в воронке для проверки
        console.log(`\n🔍 Получение всех статусов воронки...`);
        try {
            const pipeline = await amoCrmService.makeRequest('GET', 
                `/api/v4/leads/pipelines/${amoCrmService.SUBSCRIPTION_PIPELINE_ID}`
            );
            
            if (pipeline && pipeline._embedded && pipeline._embedded.statuses) {
                console.log(`📊 Статусы в воронке "${pipeline.name}":`);
                pipeline._embedded.statuses.forEach(status => {
                    const isActive = amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.includes(status.id);
                    console.log(`   ${status.id}: "${status.name}" ${isActive ? '✅ (активный)' : ''}`);
                });
            }
        } catch (pipeError) {
            console.log(`⚠️  Не удалось получить статусы воронки:`, pipeError.message);
        }
        
        res.json({
            success: true,
            data: {
                lead: {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    pipeline_id_correct: isInSubscriptionPipeline,
                    status_active: isActiveStatus
                },
                subscription_info: subscriptionInfo,
                conditions: {
                    in_subscription_pipeline: isInSubscriptionPipeline,
                    has_active_status: isActiveStatus,
                    has_subscription: hasSubscription,
                    should_be_active: shouldBeActive
                },
                settings: {
                    subscription_pipeline_id: amoCrmService.SUBSCRIPTION_PIPELINE_ID,
                    active_statuses: amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ТЕСТ ПОИСКА КОНТАКТА ПО ТЕЛЕФОНУ ====================
app.get('/api/test/phone-search/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        console.log(`\n📱 ТЕСТ ПОИСКА КОНТАКТА ПО ТЕЛЕФОНУ: ${phone}`);
        
        // Прямой поиск в amoCRM
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        const result = {
            success: true,
            data: {
                phone_searched: phone,
                total_contacts: contacts.length,
                contacts: contacts.map(contact => {
                    // Находим телефоны контакта
                    const phones = [];
                    if (contact.custom_fields_values) {
                        contact.custom_fields_values.forEach(field => {
                            if ((field.field_id || field.id) === amoCrmService.FIELD_IDS.CONTACT.PHONE) {
                                if (field.values && Array.isArray(field.values)) {
                                    field.values.forEach(value => {
                                        phones.push(value.value);
                                    });
                                }
                            }
                        });
                    }
                    
                    return {
                        id: contact.id,
                        name: contact.name,
                        phones: phones,
                        custom_fields_count: contact.custom_fields_values?.length || 0,
                        created_at: contact.created_at,
                        updated_at: contact.updated_at
                    };
                })
            }
        };
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Ошибка тестового поиска по телефону:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ==================== ТЕСТОВЫЙ ПОИСК КОНТАКТА ====================
// Простой тест прямо в консоли
app.get('/api/debug/simple-test/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        console.log(`\n🔍 ПРОСТОЙ ТЕСТ СДЕЛКИ ${leadId}`);
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest('GET', 
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        // Простая проверка
        const pipelineId = lead.pipeline_id;
        const statusId = lead.status_id;
        
        const isInList = amoCrmService.SUBSCRIPTION_PIPELINE_IDS.includes(pipelineId);
        const isActiveStatus = amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.includes(statusId);
        
        console.log(`Pipeline ID: ${pipelineId}`);
        console.log(`Status ID: ${statusId}`);
        console.log(`Is in pipeline list: ${isInList}`);
        console.log(`Is active status: ${isActiveStatus}`);
        console.log(`Pipeline list:`, amoCrmService.SUBSCRIPTION_PIPELINE_IDS);
        console.log(`Active statuses:`, amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES);
        
        // Вызов метода
        const result = amoCrmService.extractSubscriptionInfo(lead);
        
        res.json({
            simple_check: {
                pipeline_id: pipelineId,
                status_id: statusId,
                is_in_pipeline_list: isInList,
                is_active_status: isActiveStatus
            },
            extractSubscriptionInfo_result: result
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ТЕСТ РАЗНЫХ ТЕЛЕФОНОВ ====================
app.get('/api/debug/test-multiple-phones', async (req, res) => {
    try {
        const testPhones = [
            '79778853270', // Ольга Стенина
            '79161916984', // Анна
            '79660587744'  // Наталья
        ];
        
        const results = [];
        
        for (const phone of testPhones) {
            console.log(`\n📱 ТЕСТ ТЕЛЕФОНА: ${phone}`);
            console.log('─'.repeat(50));
            
            try {
                const profiles = await amoCrmService.getStudentsByPhone(phone);
                
                results.push({
                    phone: phone,
                    profiles_count: profiles.length,
                    profiles: profiles.map(p => ({
                        student_name: p.student_name,
                        subscription_type: p.subscription_type,
                        total_classes: p.total_classes,
                        used_classes: p.used_classes,
                        remaining_classes: p.remaining_classes,
                        subscription_active: p.subscription_active === 1,
                        branch: p.branch,
                        lead_id: p.amocrm_lead_id
                    }))
                });
                
                console.log(`✅ Профилей найдено: ${profiles.length}`);
                if (profiles.length > 0) {
                    profiles.forEach(p => {
                        console.log(`   👤 ${p.student_name}: ${p.subscription_type}, ${p.used_classes}/${p.total_classes} занятий`);
                    });
                }
                
            } catch (phoneError) {
                console.log(`❌ Ошибка для телефона ${phone}:`, phoneError.message);
                results.push({
                    phone: phone,
                    error: phoneError.message,
                    profiles_count: 0
                });
            }
        }
        
        res.json({
            success: true,
            data: {
                test_results: results,
                settings: {
                    subscription_pipeline_ids: amoCrmService.SUBSCRIPTION_PIPELINE_IDS,
                    active_statuses: amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
    // ==================== ПРОВЕРКА КОНКРЕТНОЙ СДЕЛКИ С НОВЫМИ НАСТРОЙКАМИ ====================
app.get('/api/debug/check-lead-complete/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        console.log(`\n🔍 ПОЛНАЯ ПРОВЕРКА СДЕЛКИ С НОВЫМИ НАСТРОЙКАМИ: ${leadId}`);
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest('GET', 
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.json({ success: false, error: 'Сделка не найдена' });
        }
        
        // Получаем информацию об абонементе
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        // Проверяем условия
        const isInSubscriptionPipeline = amoCrmService.SUBSCRIPTION_PIPELINE_IDS.includes(lead.pipeline_id);
        const hasActiveStatus = amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.includes(lead.status_id);
        const isLessonStatus = amoCrmService.LESSON_STATUSES.includes(lead.status_id);
        const hasSubscription = subscriptionInfo.hasSubscription;
        
        console.log(`\n📊 ПРОВЕРКА УСЛОВИЙ:`);
        console.log(`   1. Воронка: ${lead.pipeline_id} в списке: ${isInSubscriptionPipeline ? '✅' : '❌'}`);
        console.log(`   2. Статус ${lead.status_id} активный: ${hasActiveStatus ? '✅' : '❌'}`);
        console.log(`   3. Статус ${lead.status_id} занятие: ${isLessonStatus ? '✅' : '❌'}`);
        console.log(`   4. Есть данные абонемента: ${hasSubscription ? '✅' : '❌'}`);
        
        const canBeActive = (isInSubscriptionPipeline || isLessonStatus) && 
                            (hasActiveStatus || isLessonStatus) && 
                            hasSubscription;
        
        console.log(`\n🎯 ИТОГО: Сделка может быть активной: ${canBeActive ? '✅ ДА' : '❌ НЕТ'}`);
        
        res.json({
            success: true,
            data: {
                lead: {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id
                },
                subscription_info: subscriptionInfo,
                conditions: {
                    in_subscription_pipeline: isInSubscriptionPipeline,
                    has_active_status: hasActiveStatus,
                    is_lesson_status: isLessonStatus,
                    has_subscription: hasSubscription,
                    can_be_active: canBeActive
                },
                settings: {
                    subscription_pipeline_ids: amoCrmService.SUBSCRIPTION_PIPELINE_IDS,
                    active_statuses: amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES,
                    lesson_statuses_count: amoCrmService.LESSON_STATUSES.length
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ТЕСТ АВТОРИЗАЦИИ С РЕАЛЬНЫМИ ДАННЫМИ ====================
app.post('/api/test/full-auth', async (req, res) => {
    try {
        const { phone } = req.body;
        console.log(`\n🧪 ПОЛНЫЙ ТЕСТ АВТОРИЗАЦИИ ДЛЯ: ${phone}`);
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите телефон'
            });
        }
        
        const formattedPhone = phone.replace(/\D/g, '');
        
        // Тест поиска контактов
        console.log('\n🔍 1. Тест поиска контактов...');
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        console.log(`📊 Контактов найдено: ${contacts.length}`);
        
        // Тест извлечения учеников
        console.log('\n👥 2. Тест извлечения учеников...');
        const studentsData = [];
        
        for (const contact of contacts.slice(0, 2)) { // Берем первые 2 контакта
            console.log(`\n📋 Контакт: "${contact.name || 'Без имени'}" (ID: ${contact.id})`);
            
            const children = amoCrmService.extractStudentsFromContact(contact);
            console.log(`   Учеников: ${children.length}`);
            
            // Получаем сделки
            const leads = await amoCrmService.getContactLeads(contact.id);
            console.log(`   Сделок: ${leads.length}`);
            
            // Ищем активную сделку
            const activeLead = await amoCrmService.findMostRecentActiveLead(contact.id);
            
            studentsData.push({
                contact_id: contact.id,
                contact_name: contact.name,
                students: children,
                leads_count: leads.length,
                has_active_lead: !!activeLead,
                active_lead_name: activeLead?.lead?.name
            });
        }
        
        // Тест главного метода
        console.log('\n📱 3. Тест главного метода getStudentsByPhone...');
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        console.log(`\n🎯 РЕЗУЛЬТАТ:`);
        console.log(`   Контактов: ${contacts.length}`);
        console.log(`   Профилей: ${profiles.length}`);
        
        profiles.forEach((profile, index) => {
            console.log(`   ${index + 1}. ${profile.student_name}`);
            console.log(`      Абонемент: ${profile.subscription_type}`);
            console.log(`      Занятий: ${profile.used_classes}/${profile.total_classes}`);
            console.log(`      Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
            console.log(`      Филиал: ${profile.branch}`);
        });
        
        res.json({
            success: true,
            data: {
                phone: formattedPhone,
                contacts_count: contacts.length,
                profiles_count: profiles.length,
                contacts: contacts.map(c => ({
                    id: c.id,
                    name: c.name,
                    custom_fields_count: c.custom_fields_values?.length || 0
                })),
                students_data: studentsData,
                profiles: profiles.map(p => ({
                    student_name: p.student_name,
                    subscription_type: p.subscription_type,
                    total_classes: p.total_classes,
                    used_classes: p.used_classes,
                    remaining_classes: p.remaining_classes,
                    subscription_active: p.subscription_active === 1,
                    branch: p.branch,
                    expiration_date: p.expiration_date
                }))
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
app.get('/api/test/search', async (req, res) => {
    try {
        console.log('\n🧪 ТЕСТОВЫЙ ПОИСК КОНТАКТА');
        
        const phone = '79660587744';
        console.log(`Телефон для поиска: ${phone}`);
        
        // Прямой поиск в amoCRM
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        console.log(`Найдено контактов: ${contactsResponse._embedded?.contacts?.length || 0}`);
        
        if (contactsResponse._embedded?.contacts?.length > 0) {
            const contact = contactsResponse._embedded.contacts[0];
            console.log(`Первый контакт: ${contact.name} (ID: ${contact.id})`);
            
            // Проверяем поля контакта
            if (contact.custom_fields_values) {
                console.log('Поля контакта:');
                contact.custom_fields_values.forEach(field => {
                    console.log(`  ID: ${field.field_id || field.id}, Значение: ${field.values?.[0]?.value || 'нет'}`);
                });
            }
            
            // Получаем сделки контакта
            const leads = await amoCrmService.getContactLeads(contact.id);
            console.log(`Сделок у контакта: ${leads.length}`);
            
            res.json({
                success: true,
                contact: {
                    id: contact.id,
                    name: contact.name,
                    fields: contact.custom_fields_values?.map(f => ({
                        id: f.field_id || f.id,
                        value: f.values?.[0]?.value
                    })),
                    leads_count: leads.length,
                    leads: leads.map(l => ({
                        id: l.id,
                        name: l.name,
                        pipeline_id: l.pipeline_id,
                        status_id: l.status_id
                    }))
                }
            });
        } else {
            res.json({
                success: false,
                message: 'Контакты не найдены'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка тестового поиска:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== СТАТУС СЕРВЕРА ====================
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер художественной студии работает',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        data_source: 'Реальные данные из amoCRM'
    });
});

// ==================== ПРОВЕРКА СДЕЛКИ ====================
app.get('/api/debug/check-lead/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ПРОВЕРКА СДЕЛКИ ID: ${leadId}`);
        
        const lead = await amoCrmService.makeRequest('GET', 
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.json({ success: false, error: 'Сделка не найдена' });
        }
        
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        res.json({
            success: true,
            data: {
                lead: {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    created_at: lead.created_at,
                    created_date: new Date(lead.created_at * 1000).toLocaleString(),
                    price: lead.price
                },
                subscription_info: subscriptionInfo,
                is_active_subscription: amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.includes(lead.status_id),
                is_subscription_pipeline: lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID,
                custom_fields: lead.custom_fields_values || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ПОИСК КОНТАКТОВ ====================
app.get('/api/debug/find-contacts/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        console.log(`\n🔍 ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ: ${phone}`);
        
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        res.json({
            success: true,
            data: {
                contacts: contacts,
                total_contacts: contacts.length,
                phone_searched: phone
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска контактов:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const amoCrmService = new AmoCrmService();

const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('📊 ИСПОЛЬЗУЮ ВАШИ РЕАЛЬНЫЕ ДАННЫХ ИЗ AMOCRM');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM подключен успешно!');
            console.log('🎯 Использую ВАШИ реальные данные:');
            console.log(`   • Воронка абонементов: ${amoCrmService.SUBSCRIPTION_PIPELINE_ID}`);
            console.log(`   • Активные статусы: ${amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.join(', ')}`);
            console.log(`   • Поле "Абонемент занятий:": ${amoCrmService.FIELD_IDS.LEAD.TOTAL_CLASSES}`);
            console.log(`   • Поле "Счетчик занятий:": ${amoCrmService.FIELD_IDS.LEAD.USED_CLASSES}`);
            console.log(`   • Поле "Остаток занятий": ${amoCrmService.FIELD_IDS.LEAD.REMAINING_CLASSES}`);
        } else {
            console.log('❌ Не удалось подключиться к amoCRM');
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 URL: http://localhost:${PORT}`);
            console.log(`🔗 Главный маршрут: POST /api/auth/real-data`);
            console.log(`📊 Статус: GET /api/status`);
            console.log(`🔍 Проверка сделки: GET /api/debug/check-lead/:leadId`);
            console.log(`🔍 Поиск контактов: GET /api/debug/find-contacts/:phone`);
            console.log('='.repeat(80));
            console.log('\n📱 ДЛЯ ТЕСТИРОВАНИЯ:');
            console.log('1. Проверьте сделку Рома Красницкий:');
            console.log('   GET /api/debug/check-lead/28679861');
            console.log('2. Авторизуйтесь в приложении с номером телефона');
            console.log('='.repeat(80));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

startServer();
