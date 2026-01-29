// server.js - ПОЛНОСТЬЮ ПЕРЕРАБОТАННАЯ СИСТЕМА ДЛЯ ХУДОЖЕСТВЕННОЙ СТУДИИ

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

// ==================== КЛАСС ДЛЯ РАБОТЫ С AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ИНИЦИАЛИЗАЦИЯ СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('📊 ПОЛНАЯ ИНТЕГРАЦИЯ С AMOCRM');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        
        // ID ПОЛЕЙ (из вашего дампа)
        this.FIELD_IDS = {
            // Поля в сделках
            LEAD: {
                TOTAL_CLASSES: 850241,        // "Абонемент занятий:"
                USED_CLASSES: 850257,         // "Счетчик занятий:"
                REMAINING_CLASSES: 890163,    // "Остаток занятий"
                SUBSCRIPTION_TYPE: 891007,    // "Тип абонемента"
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
            // Поля в контактах
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
        
        // ВСЕ воронки, где могут быть абонементы (на основе анализа данных)
        this.SUBSCRIPTION_PIPELINE_IDS = [
            7977402,  // "!Абонемент"
            5663740,  // "Входящие лиды"
            5663743,  // "ШКОЛА ЧЕРТАНОВО"
            7137514,  // "ШКОЛА СВИБЛОВО"
            7490194,  // "АМАКИДС"
            7977386,  // "!Воронка первичных продаж"
            7977398,  // "!Воронка повторных продаж"
            10151974, // "!Сертификаты"
            8786186,  // "Онлайн база"
            5951374,  // "Акционная"
            8606330,  // "Реанимация"
            9495758,  // "Отложенный спрос"
            9568318,  // "Онлайн портрет"
            10082054, // "Доп. Продажи"
            10082070, // "МК"
            10082286  // "HR"
        ];
        
        // Статусы, которые считаем активными для абонементов
        this.ACTIVE_SUBSCRIPTION_STATUSES = [
            72490890, // "Купленный абонемент"
            65473306, // "Активный абонемент"
            142       // "Успешно реализовано"
        ];
        
        // Статусы занятий (1-е занятие, 2-е занятие и т.д.)
        this.LESSON_STATUSES = [
            // Чертаново
            51325726, 51325729, 51325732, 51325735, 51325738, 51325741, 51325744, 51325747,
            51325750, 51325753, 51325756, 51325759, 51325762, 51325765, 51325768, 51325771,
            // Свиблово
            59693174, 59693178, 59693182, 59693186, 59693190, 59693194, 59693198, 59693202,
            59693206, 59693210, 59693214, 59693218, 59693222, 59693226, 59693230, 59693234,
            // Амакидс
            62131974, 62131978, 62131982, 62131986, 62131990, 62131994, 62131998, 62132002,
            62132006, 62132010, 62132014, 62132018, 62132022, 62132026, 62132030, 62132034
        ];
        
        console.log('✅ Настройки загружены:');
        console.log(`   📊 Воронок для поиска: ${this.SUBSCRIPTION_PIPELINE_IDS.length}`);
        console.log(`   🎯 Активных статусов: ${this.ACTIVE_SUBSCRIPTION_STATUSES.length}`);
        console.log(`   📚 Статусов занятий: ${this.LESSON_STATUSES.length}`);
    }
    
    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    async initialize() {
        try {
            console.log('🔄 Проверка соединения с amoCRM...');
            
            if (!AMOCRM_ACCESS_TOKEN || !AMOCRM_SUBDOMAIN) {
                throw new Error('Не установлены переменные окружения AMOCRM_ACCESS_TOKEN и AMOCRM_DOMAIN');
            }
            
            const accountInfo = await this.makeRequest('GET', '/api/v4/account');
            
            if (accountInfo && accountInfo.id) {
                console.log(`✅ Подключено к аккаунту: "${accountInfo.name}"`);
                this.isInitialized = true;
                return true;
            }
            
            throw new Error('Не удалось получить информацию об аккаунте');
        } catch (error) {
            console.error('❌ Ошибка инициализации:', error.message);
            return false;
        }
    }
    
    // ==================== БАЗОВЫЕ МЕТОДЫ API ====================
    async makeRequest(method, endpoint, data = null, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
                if (attempt === maxRetries) {
                    console.error(`❌ Ошибка запроса ${method} ${endpoint}:`, error.message);
                    
                    if (error.response) {
                        console.error(`Статус: ${error.response.status}`);
                        console.error(`Данные:`, JSON.stringify(error.response.data, null, 2));
                    }
                    
                    throw error;
                }
                
                // Ждем перед повторной попыткой
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }
    
    // ==================== ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ ====================
    async searchContactsByPhone(phone) {
        try {
            const cleanPhone = phone.replace(/\D/g, '');
            console.log(`🔍 Поиск контактов по телефону: ${cleanPhone}`);
            
            if (cleanPhone.length < 7) {
                return { _embedded: { contacts: [] } };
            }
            
            // Генерируем все варианты номера для поиска
            const searchVariants = this.generatePhoneVariants(cleanPhone);
            
            let allContacts = [];
            let seenIds = new Set();
            
            // Ищем по каждому варианту
            for (const searchTerm of searchVariants) {
                if (!searchTerm || searchTerm.length < 7) continue;
                
                try {
                    // Поиск через фильтр по полю телефона
                    const response = await this.makeRequest('GET', 
                        `/api/v4/contacts?filter[custom_fields_values][${this.FIELD_IDS.CONTACT.PHONE}][]=${searchTerm}&with=custom_fields_values&limit=250`
                    );
                    
                    if (response?._embedded?.contacts) {
                        for (const contact of response._embedded.contacts) {
                            if (!seenIds.has(contact.id) && this.hasPhone(contact, cleanPhone)) {
                                seenIds.add(contact.id);
                                allContacts.push(contact);
                            }
                        }
                    }
                } catch (error) {
                    continue; // Пробуем следующий вариант
                }
            }
            
            // Если не нашли через фильтр, пробуем общий поиск
            if (allContacts.length === 0) {
                try {
                    const response = await this.makeRequest('GET', 
                        `/api/v4/contacts?query=${cleanPhone.slice(-10)}&with=custom_fields_values&limit=100`
                    );
                    
                    if (response?._embedded?.contacts) {
                        for (const contact of response._embedded.contacts) {
                            if (!seenIds.has(contact.id) && this.hasPhone(contact, cleanPhone)) {
                                seenIds.add(contact.id);
                                allContacts.push(contact);
                            }
                        }
                    }
                } catch (error) {
                    // Игнорируем ошибку
                }
            }
            
            console.log(`✅ Найдено контактов: ${allContacts.length}`);
            
            return { _embedded: { contacts: allContacts } };
            
        } catch (error) {
            console.error('❌ Ошибка поиска контактов:', error.message);
            return { _embedded: { contacts: [] } };
        }
    }
    // Добавьте этот метод в класс AmoCrmService для получения имени статуса
getStatusName(statusId) {
    // Карта статусов (можно расширить)
    const statusMap = {
        142: 'Успешно реализовано',
        143: 'Закрыто и не реализовано',
        72490890: 'Купленный абонемент',
        65473306: 'Активный абонемент'
    };
    
    return statusMap[statusId] || `Статус ${statusId}`;
}
    // Генерация вариантов номера телефона
    generatePhoneVariants(phone) {
        const variants = new Set();
        variants.add(phone);
        
        if (phone.length === 11) {
            if (phone.startsWith('7')) {
                variants.add('8' + phone.slice(1));
                variants.add(phone.slice(1));
                variants.add('+7' + phone.slice(1));
            } else if (phone.startsWith('8')) {
                variants.add('7' + phone.slice(1));
                variants.add(phone.slice(1));
                variants.add('+7' + phone.slice(1));
            }
        } else if (phone.length === 10) {
            variants.add('7' + phone);
            variants.add('8' + phone);
            variants.add('+7' + phone);
        }
        
        if (phone.length >= 10) {
            variants.add(phone.slice(-10));
        }
        
        return Array.from(variants).filter(v => v && v.length >= 7);
    }
    
    // Проверка наличия телефона у контакта
    hasPhone(contact, targetPhone) {
        if (!contact.custom_fields_values) return false;
        
        const cleanTarget = targetPhone.replace(/\D/g, '');
        
        const phoneFields = contact.custom_fields_values.filter(field => 
            (field.field_id || field.id) === this.FIELD_IDS.CONTACT.PHONE
        );
        
        for (const phoneField of phoneFields) {
            if (phoneField.values) {
                for (const value of phoneField.values) {
                    const contactPhone = String(value.value || '').replace(/\D/g, '');
                    
                    if (contactPhone === cleanTarget ||
                        contactPhone.slice(-10) === cleanTarget.slice(-10) ||
                        contactPhone.slice(-7) === cleanTarget.slice(-7)) {
                        return true;
                    }
                }
            }
        }
        
        return false;
    }
    
    // ==================== ПОЛУЧЕНИЕ СДЕЛОК КОНТАКТА ====================
    async getContactLeads(contactId) {
        try {
            // Сначала пробуем через связанные сделки
            const response = await this.makeRequest('GET', 
                `/api/v4/contacts/${contactId}/leads?with=custom_fields_values&limit=250`
            );
            
            return response?._embedded?.leads || [];
            
        } catch (error) {
            // Если не получилось, пробуем альтернативный метод
            try {
                const response = await this.makeRequest('GET', 
                    `/api/v4/leads?filter[contact_id][]=${contactId}&with=custom_fields_values&limit=250`
                );
                
                return response?._embedded?.leads || [];
            } catch (error2) {
                console.error(`❌ Не удалось получить сделки контакта ${contactId}:`, error2.message);
                return [];
            }
        }
    }
    
    // ==================== ИЗВЛЕЧЕНИЕ УЧЕНИКОВ ИЗ КОНТАКТА ====================
    extractStudentsFromContact(contact) {
        const students = [];
        const customFields = contact.custom_fields_values || [];
        
        // Функция для получения значения поля
        const getFieldValue = (fieldId) => {
            const field = customFields.find(f => (f.field_id || f.id) === fieldId);
            return field?.values?.[0]?.value || null;
        };
        
        // Извлекаем учеников из полей
        const childFields = [
            { id: this.FIELD_IDS.CONTACT.CHILD_1_NAME, index: 1 },
            { id: this.FIELD_IDS.CONTACT.CHILD_2_NAME, index: 2 },
            { id: this.FIELD_IDS.CONTACT.CHILD_3_NAME, index: 3 }
        ];
        
        for (const field of childFields) {
            const childName = getFieldValue(field.id);
            if (childName && childName.trim()) {
                students.push({
                    studentName: childName.trim(),
                    branch: getFieldValue(this.FIELD_IDS.CONTACT.BRANCH) || '',
                    teacherName: getFieldValue(this.FIELD_IDS.CONTACT.TEACHER) || '',
                    ageGroup: getFieldValue(this.FIELD_IDS.CONTACT.AGE_GROUP) || '',
                    dayOfWeek: getFieldValue(this.FIELD_IDS.CONTACT.DAY_OF_WEEK) || '',
                    hasActiveSub: this.getBooleanFieldValue(getFieldValue(this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB))
                });
            }
        }
        
        // Если учеников нет в полях, создаем одного из имени контакта
        if (students.length === 0 && contact.name && contact.name.trim()) {
            students.push({
                studentName: contact.name.trim(),
                branch: getFieldValue(this.FIELD_IDS.CONTACT.BRANCH) || '',
                teacherName: getFieldValue(this.FIELD_IDS.CONTACT.TEACHER) || '',
                ageGroup: getFieldValue(this.FIELD_IDS.CONTACT.AGE_GROUP) || '',
                dayOfWeek: getFieldValue(this.FIELD_IDS.CONTACT.DAY_OF_WEEK) || '',
                hasActiveSub: this.getBooleanFieldValue(getFieldValue(this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB))
            });
        }
        
        return students;
    }
    
    // Преобразование значения в boolean
    getBooleanFieldValue(value) {
        if (value === null || value === undefined) return false;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'да';
        }
        if (typeof value === 'number') return value !== 0;
        return false;
    }
    
   // ==================== ПОИСК ЛУЧШЕЙ СДЕЛКИ (ИСПРАВЛЕННЫЙ) ====================
async findBestLeadForContact(contactId) {
    try {
        console.log(`\n🎯 ПОИСК ЛУЧШЕЙ СДЕЛКИ ДЛЯ КОНТАКТА ${contactId}`);
        
        const allLeads = await this.getContactLeads(contactId);
        
        if (allLeads.length === 0) {
            console.log('❌ У контакта нет сделок');
            return null;
        }
        
        console.log(`📊 Всего сделок: ${allLeads.length}`);
        
        // ШАГ 1: Ищем сделки ТОЛЬКО в воронке "!Абонемент" (7977402)
        const subscriptionPipelineLeads = [];
        for (const lead of allLeads) {
            if (lead.pipeline_id === 7977402) { // ТОЛЬКО эта воронка!
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                if (subscriptionInfo.hasSubscription) {
                    subscriptionPipelineLeads.push({
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        score: this.calculateLeadScore(lead, subscriptionInfo)
                    });
                }
            }
        }
        
        console.log(`📊 Сделок в воронке "!Абонемент" (7977402): ${subscriptionPipelineLeads.length}`);
        
        // Если нашли сделки в воронке абонементов, берем лучшую
        if (subscriptionPipelineLeads.length > 0) {
            subscriptionPipelineLeads.sort((a, b) => b.score - a.score);
            const bestLead = subscriptionPipelineLeads[0];
            
            console.log(`\n🎉 НАЙДЕНА ЛУЧШАЯ СДЕЛКА В ВОРОНКЕ "!Абонемент":`);
            console.log(`   ID: ${bestLead.lead.id}`);
            console.log(`   Название: "${bestLead.lead.name}"`);
            console.log(`   Статус: ${bestLead.lead.status_id} (${this.getStatusName(bestLead.lead.status_id)})`);
            console.log(`   Абонемент: ${bestLead.subscriptionInfo.subscriptionType}`);
            console.log(`   Занятий: ${bestLead.subscriptionInfo.usedClasses}/${bestLead.subscriptionInfo.totalClasses}`);
            console.log(`   Активен: ${bestLead.subscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
            
            return bestLead;
        }
        
        // ШАГ 2: Если нет сделок в воронке "!Абонемент", ищем сделки с абонементом в ЛЮБОЙ воронке
        console.log('\n🔍 Сделок в воронке "!Абонемент" не найдено, ищем в других воронках...');
        
        const otherLeadsWithSubscription = [];
        for (const lead of allLeads) {
            // Ищем сделки с абонементом в ЛЮБОЙ воронке
            const subscriptionInfo = this.extractSubscriptionInfo(lead);
            if (subscriptionInfo.hasSubscription && subscriptionInfo.subscriptionActive) {
                otherLeadsWithSubscription.push({
                    lead: lead,
                    subscriptionInfo: subscriptionInfo,
                    score: this.calculateLeadScore(lead, subscriptionInfo)
                });
            }
        }
        
        if (otherLeadsWithSubscription.length > 0) {
            otherLeadsWithSubscription.sort((a, b) => b.score - a.score);
            const bestLead = otherLeadsWithSubscription[0];
            
            console.log(`\n🎉 НАЙДЕНА ЛУЧШАЯ СДЕЛКА С АКТИВНЫМ АБОНЕМЕНТОМ:`);
            console.log(`   ID: ${bestLead.lead.id}`);
            console.log(`   Воронка: ${bestLead.lead.pipeline_id}`);
            console.log(`   Название: "${bestLead.lead.name}"`);
            console.log(`   Абонемент: ${bestLead.subscriptionInfo.subscriptionType}`);
            
            return bestLead;
        }
        
        // ШАГ 3: Если совсем не нашли сделок с абонементом, ищем самую свежую сделку
        console.log('\n🔍 Активных абонементов не найдено, ищем самую свежую сделку...');
        
        // Ищем самую свежую сделку (менее 3 месяцев)
        let mostRecentLead = null;
        const threeMonthsAgo = Date.now() / 1000 - (90 * 24 * 60 * 60); // 90 дней назад
        
        for (const lead of allLeads) {
            if (lead.created_at > threeMonthsAgo) { // Только свежие сделки
                if (!mostRecentLead || lead.created_at > mostRecentLead.created_at) {
                    mostRecentLead = lead;
                }
            }
        }
        
        // Если нет свежих, берем самую последнюю
        if (!mostRecentLead && allLeads.length > 0) {
            allLeads.sort((a, b) => b.created_at - a.created_at);
            mostRecentLead = allLeads[0];
        }
        
        if (mostRecentLead) {
            const subscriptionInfo = this.extractSubscriptionInfo(mostRecentLead);
            console.log(`\n📋 Берем самую свежую сделку:`);
            console.log(`   ID: ${mostRecentLead.id}`);
            console.log(`   Название: "${mostRecentLead.name}"`);
            console.log(`   Дата: ${new Date(mostRecentLead.created_at * 1000).toLocaleString()}`);
            
            return {
                lead: mostRecentLead,
                subscriptionInfo: subscriptionInfo,
                score: 0
            };
        }
        
        console.log('❌ Не удалось найти подходящую сделку');
        return null;
        
    } catch (error) {
        console.error(`❌ Ошибка поиска сделки:`, error.message);
        return null;
    }
}

// ==================== ОЦЕНКА СДЕЛКИ (УЛУЧШЕННАЯ) ====================
calculateLeadScore(lead, subscriptionInfo) {
    let score = 0;
    
    // МАКСИМАЛЬНЫЙ ПРИОРИТЕТ - ВОРОНКА "!Абонемент"
    if (lead.pipeline_id === 7977402) {
        score += 100000; // Супер-приоритет для этой воронки
        
        // Дополнительный бонус за статусы в этой воронке
        if (lead.status_id === 65473306) { // "Активный абонемент"
            score += 50000;
        } else if (lead.status_id === 72490890) { // "Купленный абонемент"
            score += 40000;
        }
    }
    
    // БАЛЛЫ ЗА НАЛИЧИЕ АБОНЕМЕНТА
    if (subscriptionInfo.hasSubscription) {
        score += 10000;
        
        // Бонус за конкретное количество занятий
        if (subscriptionInfo.totalClasses >= 8) {
            score += 5000; // 8+ занятий
        } else if (subscriptionInfo.totalClasses >= 4) {
            score += 3000; // 4-7 занятий
        }
        
        // Бонус за использованные занятия
        if (subscriptionInfo.usedClasses > 0) {
            score += subscriptionInfo.usedClasses * 1000;
        }
        
        // Бонус за остаток занятий
        if (subscriptionInfo.remainingClasses > 0) {
            score += subscriptionInfo.remainingClasses * 500;
        }
    }
    
    // БАЛЛЫ ЗА АКТИВНОСТЬ (самое важное после воронки)
    if (subscriptionInfo.subscriptionActive) {
        score += 50000;
    }
    
    // БАЛЛЫ ЗА СТАТУС (приоритет по убыванию)
    if (lead.status_id === 65473306) { // "Активный абонемент"
        score += 40000;
    } else if (lead.status_id === 72490890) { // "Купленный абонемент"
        score += 30000;
    } else if (this.LESSON_STATUSES.includes(lead.status_id)) { // Статусы занятий
        score += 20000;
    } else if (lead.status_id === 142) { // "Успешно реализовано"
        score += 10000;
    }
    
    // БАЛЛЫ ЗА СВЕЖЕСТЬ (новые сделки важнее)
    const daysOld = (Date.now() / 1000 - lead.created_at) / (24 * 60 * 60);
    if (daysOld < 30) { // Менее месяца - максимальный бонус
        score += 10000;
    } else if (daysOld < 90) { // Менее 3 месяцев
        score += 5000;
    } else if (daysOld < 180) { // Менее 6 месяцев
        score += 2000;
    }
    
    // ШТРАФ за старые сделки (более года)
    if (daysOld > 365) {
        score -= 50000; // Суровый штраф за старые сделки
    }
    
    // ШТРАФ за автосделки и плохие названия
    if (lead.name && (lead.name.includes('Сделка #') || 
                      lead.name.includes('Автосделка:') || 
                      lead.name.includes('Автосделка '))) {
        score -= 30000;
    }
    
    // БОНУС за хорошее название (содержит имя ученика и информацию об абонементе)
    if (lead.name && lead.name.includes('-') && 
        (lead.name.includes('занятий') || lead.name.includes('занятия'))) {
        score += 10000;
    }
    
    console.log(`   Оценка сделки ${lead.id}: ${score} (воронка: ${lead.pipeline_id}, статус: ${lead.status_id})`);
    return score;
}
    
    // ==================== ИЗВЛЕЧЕНИЕ ДАННЫХ ОБ АБОНЕМЕНТЕ ====================
    extractSubscriptionInfo(lead) {
        const customFields = lead.custom_fields_values || [];
        const fieldMap = new Map();
        
        // Собираем все поля в карту
        for (const field of customFields) {
            const fieldId = field.field_id || field.id;
            const fieldValue = this.getFieldValue(field);
            fieldMap.set(fieldId, fieldValue);
        }
        
        // Извлекаем данные об абонементе
        const subscriptionTypeRaw = fieldMap.get(this.FIELD_IDS.LEAD.TOTAL_CLASSES);
        const usedClassesRaw = fieldMap.get(this.FIELD_IDS.LEAD.USED_CLASSES);
        const remainingClassesRaw = fieldMap.get(this.FIELD_IDS.LEAD.REMAINING_CLASSES);
        
        // Обрабатываем количество занятий
        const totalClasses = this.extractNumber(subscriptionTypeRaw);
        const usedClasses = this.extractNumber(usedClassesRaw);
        let remainingClasses = this.extractNumber(remainingClassesRaw);
        
        // Если остаток не указан, вычисляем его
        if (remainingClasses === 0 && totalClasses > 0 && usedClasses >= 0) {
            remainingClasses = Math.max(0, totalClasses - usedClasses);
        }
        
        // Получаем другие данные
        const subscriptionType = subscriptionTypeRaw || 'Без абонемента';
        const activationDate = this.parseDate(fieldMap.get(this.FIELD_IDS.LEAD.ACTIVATION_DATE));
        const expirationDate = this.parseDate(fieldMap.get(this.FIELD_IDS.LEAD.EXPIRATION_DATE));
        const lastVisitDate = this.parseDate(fieldMap.get(this.FIELD_IDS.LEAD.LAST_VISIT_DATE));
        const ageGroup = fieldMap.get(this.FIELD_IDS.LEAD.AGE_GROUP) || '';
        const branch = fieldMap.get(this.FIELD_IDS.LEAD.BRANCH) || '';
        const subscriptionTypeField = fieldMap.get(this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE) || '';
        
        // Определяем, есть ли абонемент
        const hasSubscription = totalClasses > 0 || remainingClasses > 0 || usedClasses > 0 ||
                               (subscriptionType && subscriptionType !== 'Без абонемента');
        
        // ПРОВЕРКА АКТИВНОСТИ - КЛЮЧЕВАЯ ЛОГИКА
        const isInSubscriptionPipeline = this.SUBSCRIPTION_PIPELINE_IDS.includes(lead.pipeline_id);
        const hasActiveStatus = this.ACTIVE_SUBSCRIPTION_STATUSES.includes(lead.status_id);
        const isLessonStatus = this.LESSON_STATUSES.includes(lead.status_id);
        
        // Абонемент активен если:
// 1. Сделка в воронке "!Абонемент" (7977402) И статус активный
// 2. ИЛИ статус занятия в школьных воронках
// 3. ИЛИ сделка в других воронках и имеет статус 142

let subscriptionActive = false;
let subscriptionStatus = 'Нет данных';
let subscriptionBadge = 'inactive';

if (hasSubscription) {
    // Воронка "!Абонемент" с активными статусами
    if (lead.pipeline_id === 7977402 && hasActiveStatus) {
        subscriptionActive = true;
        subscriptionStatus = 'Активен';
        subscriptionBadge = 'active';
    } 
    // Статусы занятий в школьных воронках
    else if (isLessonStatus && 
             (lead.pipeline_id === 5663743 ||  // ШКОЛА ЧЕРТАНОВО
              lead.pipeline_id === 7137514 ||  // ШКОЛА СВИБЛОВО
              lead.pipeline_id === 7490194)) { // АМАКИДС
        subscriptionActive = true;
        subscriptionStatus = 'Идет обучение';
        subscriptionBadge = 'active';
    }
    // Статус 142 в любых воронках (кроме очень старых)
    else if (lead.status_id === 142) {
        const daysOld = (Date.now() / 1000 - lead.created_at) / (24 * 60 * 60);
        if (daysOld < 180) { // Менее 6 месяцев
            subscriptionActive = true;
            subscriptionStatus = 'Активен';
            subscriptionBadge = 'active';
        } else {
            subscriptionActive = false;
            subscriptionStatus = 'Завершен';
            subscriptionBadge = 'warning';
        }
    } else {
        subscriptionActive = false;
        subscriptionStatus = 'Есть абонемент';
        subscriptionBadge = 'warning';
    }

        
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
            
            rawData: {
                totalClassesRaw: subscriptionTypeRaw,
                usedClassesRaw: usedClassesRaw,
                remainingClassesRaw: remainingClassesRaw
            }
        };
    }
    
    // Метод 4 - ДОБАВЛЕН ПРОПУЩЕННЫЙ МЕТОД
    extractPhoneFromContact(contact) {
        if (!contact.custom_fields_values) return '';
        
        const phoneField = contact.custom_fields_values.find(f => 
            (f.field_id || f.id) === this.FIELD_IDS.CONTACT.PHONE
        );
        
        if (phoneField && phoneField.values && phoneField.values.length > 0) {
            return phoneField.values[0].value || '';
        }
        
        return '';
    }
    
    // Метод 5 - ИСПРАВЛЕННЫЙ СИНТАКСИС
    extractNumber(value) {
        if (value === null || value === undefined) return 0;
        
        if (typeof value === 'number') {
            return value;
        }
        
        if (typeof value === 'string') {
            const match = value.match(/\d+/);
            if (match) {
                return parseInt(match[0]);
            }
            
            const num = Number(value);
            if (!isNaN(num)) {
                return num;
            }
        }
        
        return 0;
    }
    
    // Получение значения поля
    getFieldValue(field) {
        if (!field || !field.values || field.values.length === 0) {
            return null;
        }
        
        return field.values[0].value;
    }
    
    // Парсинг даты
    parseDate(value) {
        if (!value) return null;
        
        try {
            // Если это timestamp в секундах
            if (typeof value === 'number' && value > 1000000000 && value < 10000000000) {
                return new Date(value * 1000).toISOString().split('T')[0];
            }
            
            // Если это timestamp в миллисекундах
            if (typeof value === 'number' && value > 1000000000000) {
                return new Date(value).toISOString().split('T')[0];
            }
            
            // Если это строка с датой
            if (typeof value === 'string') {
                // Формат DD.MM.YYYY
                const parts = value.split('.');
                if (parts.length === 3) {
                    const day = parseInt(parts[0]);
                    const month = parseInt(parts[1]) - 1;
                    const year = parseInt(parts[2]);
                    
                    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                        return new Date(year, month, day).toISOString().split('T')[0];
                    }
                }
                
                // Стандартный формат
                const date = new Date(value);
                if (!isNaN(date.getTime())) {
                    return date.toISOString().split('T')[0];
                }
                
                return value;
            }
        } catch (error) {
            console.error('Ошибка парсинга даты:', value, error);
        }
        
        return null;
    }
    
    // ==================== ОСНОВНОЙ МЕТОД: ПОЛУЧЕНИЕ УЧЕНИКОВ ПО ТЕЛЕФОНУ ====================
    async getStudentsByPhone(phoneNumber) {
        console.log(`\n📱 ПОЛУЧЕНИЕ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        console.log('='.repeat(60));
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            // 1. Ищем контакты
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                return studentProfiles;
            }
            
            // 2. Обрабатываем каждый контакт
            for (const contact of contacts) {
                try {
                    // Извлекаем учеников
                    const students = this.extractStudentsFromContact(contact);
                    
                    if (students.length === 0) {
                        console.log(`⚠️  У контакта ${contact.id} нет учеников`);
                        continue;
                    }
                    
                    // Находим лучшую сделку для контакта
                    const bestLead = await this.findBestLeadForContact(contact.id);
                    
                    // Создаем профили для каждого ученика
                    for (const student of students) {
                        const profile = this.createStudentProfile(
                            contact,
                            phoneNumber,
                            student,
                            bestLead?.subscriptionInfo || this.getDefaultSubscriptionInfo(),
                            bestLead?.lead || null
                        );
                        
                        studentProfiles.push(profile);
                    }
                    
                } catch (contactError) {
                    console.error(`❌ Ошибка обработки контакта ${contact.id}:`, contactError.message);
                }
            }
            
            // Убираем дубликаты
            const uniqueProfiles = this.removeDuplicateProfiles(studentProfiles);
            
            console.log(`\n🎯 ИТОГО создано профилей: ${uniqueProfiles.length}`);
            
            return uniqueProfiles;
            
        } catch (error) {
            console.error('❌ Критическая ошибка поиска учеников:', error.message);
            return studentProfiles;
        }
    }
    
    // Удаление дубликатов профилей
    removeDuplicateProfiles(profiles) {
        const uniqueProfiles = [];
        const seenKeys = new Set();
        
        for (const profile of profiles) {
            const key = `${profile.student_name}_${profile.phone_number}_${profile.branch}`;
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                uniqueProfiles.push(profile);
            }
        }
        
        return uniqueProfiles;
    }
    
    // Создание профиля ученика
    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        // Получаем email из контакта
        let email = '';
        if (contact.custom_fields_values) {
            const emailField = contact.custom_fields_values.find(f => 
                (f.field_id || f.id) === this.FIELD_IDS.CONTACT.EMAIL
            );
            if (emailField) {
                email = this.getFieldValue(emailField) || '';
            }
        }
        
        // Получаем филиал (приоритет: из сделки > из ученика > из контакта)
        let branch = subscriptionInfo.branch || studentInfo.branch || '';
        
        if (!branch && contact.custom_fields_values) {
            const branchField = contact.custom_fields_values.find(f =>
                (f.field_id || f.id) === this.FIELD_IDS.CONTACT.BRANCH
            );
            if (branchField) {
                branch = this.getFieldValue(branchField) || '';
            }
        }
        
        // Имя родителя
        let parentName = contact.name || '';
        if (parentName.includes('Контакт ') && parentName.replace('Контакт ', '').match(/^\d+$/)) {
            parentName = '';
        }
        
        const profile = {
            amocrm_contact_id: contact.id || null,
            parent_contact_id: contact.id || null,
            amocrm_lead_id: lead?.id || null,
            
            student_name: studentInfo.studentName || 'Ученик',
            phone_number: phoneNumber,
            email: email,
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
            is_active: 1,
            last_sync: new Date().toISOString()
        };
        
        console.log(`👤 СОЗДАН ПРОФИЛЬ: ${profile.student_name}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_type}`);
        console.log(`   📊 Занятий: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        console.log(`   ✅ Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
        console.log(`   🏫 Филиал: ${profile.branch}`);
        
        return profile;
    }
    
    // Дефолтные данные об абонементе
    getDefaultSubscriptionInfo() {
        return {
            hasSubscription: false,
            subscriptionActive: false,
            subscriptionStatus: 'Нет абонемента',
            subscriptionBadge: 'inactive',
            subscriptionType: 'Без абонемента',
            subscriptionTypeField: '',
            totalClasses: 0,
            usedClasses: 0,
            remainingClasses: 0,
            expirationDate: null,
            activationDate: null,
            lastVisitDate: null,
            ageGroup: '',
            branch: '',
            isInSubscriptionPipeline: false,
            hasActiveStatus: false,
            pipelineId: null,
            statusId: null,
            rawData: {
                totalClassesRaw: null,
                usedClassesRaw: null,
                remainingClassesRaw: null
            }
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
            await fs.mkdir(dbDir, { recursive: true });
            
            const dbPath = path.join(dbDir, 'art_school.db');
            
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
        
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        // Форматируем телефон
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length === 10) {
            cleanPhone = '7' + cleanPhone;
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('8')) {
            cleanPhone = '7' + cleanPhone.slice(1);
        }
        
        console.log(`📱 Телефон: ${cleanPhone}`);
        
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
        const profiles = await amoCrmService.getStudentsByPhone(cleanPhone);
        
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        if (profiles.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Ученики не найдены',
                message: 'По указанному телефону не найдено учеников в системе.',
                phone: cleanPhone,
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
                phone: cleanPhone,
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
                    phone: cleanPhone,
                    profiles_count: profiles.length 
                }),
                cleanPhone,
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
        console.log(`📱 Телефон: ${cleanPhone}`);
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
                    phone_number: cleanPhone,
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

// ==================== ДОПОЛНИТЕЛЬНЫЕ API ====================

// Статус сервера
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

// Тестовый маршрут для проверки
app.get('/api/test/search/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        console.log(`\n🧪 ТЕСТ ПОИСКА ДЛЯ ТЕЛЕФОНА: ${phone}`);
        
        const profiles = await amoCrmService.getStudentsByPhone(phone);
        
        res.json({
            success: true,
            data: {
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
            }
        });
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Проверка сделки
app.get('/api/debug/lead/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        console.log(`\n🔍 ПРОВЕРКА СДЕЛКИ: ${leadId}`);
        
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
                    price: lead.price
                },
                subscription_info: subscriptionInfo
            }
        });
    } catch (error) {
        console.error('❌ Ошибка проверки:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ПОЛНЫЙ АНАЛИЗ СИСТЕМЫ ====================
app.get('/api/debug/full-system-check', async (req, res) => {
    try {
        console.log('\n' + '='.repeat(100));
        console.log('🔍 ПОЛНЫЙ АНАЛИЗ ВСЕЙ СИСТЕМЫ');
        console.log('='.repeat(100));
        
        const result = {
            system_info: {},
            amocrm_status: {},
            test_profiles: {},
            field_analysis: {},
            pipeline_analysis: {},
            lead_comparison: {},
            recommendations: []
        };
        
        // 1. ИНФОРМАЦИЯ О СИСТЕМЕ
        console.log('\n📋 1. ИНФОРМАЦИЯ О СИСТЕМЕ');
        result.system_info = {
            server_time: new Date().toISOString(),
            node_version: process.version,
            environment: process.env.NODE_ENV || 'development',
            amocrm_initialized: amoCrmService.isInitialized,
            amocrm_domain: AMOCRM_SUBDOMAIN,
            database: 'SQLite (art_school.db)'
        };
        
        console.log(`   Серверное время: ${result.system_info.server_time}`);
        console.log(`   AMOCRM инициализирован: ${result.system_info.amocrm_initialized}`);
        console.log(`   Домен: ${result.system_info.amocrm_domain}.amocrm.ru`);
        
        // 2. ПРОВЕРКА ПОДКЛЮЧЕНИЯ К AMOCRM
        console.log('\n🔌 2. ПРОВЕРКА ПОДКЛЮЧЕНИЯ К AMOCRM');
        try {
            const account = await amoCrmService.makeRequest('GET', '/api/v4/account');
            result.amocrm_status = {
                connected: true,
                account_id: account.id,
                account_name: account.name,
                account_currency: account.currency,
                timezone: account.timezone,
                current_user: account.current_user
            };
            console.log(`   ✅ Подключено к аккаунту: "${account.name}" (ID: ${account.id})`);
        } catch (error) {
            result.amocrm_status = {
                connected: false,
                error: error.message
            };
            console.log(`   ❌ Ошибка подключения: ${error.message}`);
        }
        
        // 3. ТЕСТОВЫЕ ПРОФИЛИ
        console.log('\n👥 3. ТЕСТОВЫЕ ПРОФИЛИ');
        const testPhones = ['79778853270', '79161916984', '79660587744'];
        result.test_profiles = {};
        
        for (const phone of testPhones) {
            console.log(`\n   📱 Телефон: ${phone}`);
            try {
                const profiles = await amoCrmService.getStudentsByPhone(phone);
                result.test_profiles[phone] = {
                    found: profiles.length > 0,
                    count: profiles.length,
                    profiles: profiles.map(p => ({
                        student_name: p.student_name,
                        contact_id: p.amocrm_contact_id,
                        lead_id: p.amocrm_lead_id,
                        subscription_type: p.subscription_type,
                        total_classes: p.total_classes,
                        used_classes: p.used_classes,
                        remaining_classes: p.remaining_classes,
                        subscription_active: p.subscription_active === 1,
                        branch: p.branch
                    }))
                };
                
                console.log(`     Найдено профилей: ${profiles.length}`);
                if (profiles.length > 0) {
                    profiles.forEach(p => {
                        console.log(`     👤 ${p.student_name}: ${p.subscription_type}, ${p.used_classes}/${p.total_classes}`);
                    });
                }
            } catch (error) {
                result.test_profiles[phone] = {
                    found: false,
                    error: error.message
                };
                console.log(`     ❌ Ошибка: ${error.message}`);
            }
        }
        
        // 4. АНАЛИЗ ПОЛЕЙ И ВОРОНОК
        console.log('\n🏗️  4. АНАЛИЗ ПОЛЕЙ И ВОРОНОК');
        
        // 4.1 Настройки нашей системы
        result.field_analysis = {
            our_settings: {
                subscription_pipeline_ids: amoCrmService.SUBSCRIPTION_PIPELINE_IDS,
                active_subscription_statuses: amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES,
                lesson_statuses_count: amoCrmService.LESSON_STATUSES.length,
                field_ids: amoCrmService.FIELD_IDS
            }
        };
        
        console.log(`   Наши настройки:`);
        console.log(`     Воронок для поиска: ${amoCrmService.SUBSCRIPTION_PIPELINE_IDS.length}`);
        console.log(`     Активных статусов: ${amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.join(', ')}`);
        console.log(`     ID поля "Абонемент занятий:": ${amoCrmService.FIELD_IDS.LEAD.TOTAL_CLASSES}`);
        console.log(`     ID поля "Счетчик занятий:": ${amoCrmService.FIELD_IDS.LEAD.USED_CLASSES}`);
        console.log(`     ID поля "Остаток занятий": ${amoCrmService.FIELD_IDS.LEAD.REMAINING_CLASSES}`);
        
        // 4.2 Получение реальных данных из amoCRM
        try {
            // Получаем все воронки
            console.log('\n   📊 Получение реальных данных из amoCRM...');
            const pipelines = await amoCrmService.makeRequest('GET', '/api/v4/leads/pipelines');
            
            if (pipelines._embedded && pipelines._embedded.pipelines) {
                result.pipeline_analysis = {
                    total_pipelines: pipelines._embedded.pipelines.length,
                    pipelines: []
                };
                
                console.log(`   Всего воронок в amoCRM: ${pipelines._embedded.pipelines.length}`);
                
                // Анализируем каждую воронку
                for (const pipeline of pipelines._embedded.pipelines) {
                    console.log(`\n   📁 Воронка: "${pipeline.name}" (ID: ${pipeline.id})`);
                    
                    try {
                        const pipelineWithStatuses = await amoCrmService.makeRequest('GET', 
                            `/api/v4/leads/pipelines/${pipeline.id}`
                        );
                        
                        const pipelineInfo = {
                            id: pipeline.id,
                            name: pipeline.name,
                            statuses: pipelineWithStatuses._embedded?.statuses?.map(s => ({
                                id: s.id,
                                name: s.name,
                                is_active_subscription: amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.includes(s.id),
                                is_lesson_status: amoCrmService.LESSON_STATUSES.includes(s.id),
                                is_in_subscription_pipeline: amoCrmService.SUBSCRIPTION_PIPELINE_IDS.includes(pipeline.id)
                            })) || []
                        };
                        
                        result.pipeline_analysis.pipelines.push(pipelineInfo);
                        
                        // Выводим информацию о статусах
                        if (pipelineInfo.statuses.length > 0) {
                            console.log(`     Статусы (${pipelineInfo.statuses.length}):`);
                            pipelineInfo.statuses.forEach(status => {
                                let markers = [];
                                if (status.is_active_subscription) markers.push('✅ Активный статус');
                                if (status.is_lesson_status) markers.push('📚 Статус занятия');
                                if (status.is_in_subscription_pipeline) markers.push('🎯 Воронка абонементов');
                                
                                console.log(`       ${status.id}: "${status.name}" ${markers.join(', ')}`);
                            });
                        }
                        
                    } catch (pipeError) {
                        console.log(`     ⚠️  Не удалось получить статусы: ${pipeError.message}`);
                    }
                }
            }
        } catch (error) {
            console.log(`   ❌ Ошибка получения данных воронок: ${error.message}`);
        }
        
        // 5. СРАВНЕНИЕ СДЕЛОК
        console.log('\n⚖️  5. СРАВНЕНИЕ СДЕЛОК');
        result.lead_comparison = {};
        
        // Тестовые сделки для сравнения
        const testLeads = [
            { id: 13154405, description: 'Автосделка в воронке 5663740' },
            { id: 28674745, description: 'Полина Кунахович в воронке 7977402' },
            { id: 28679861, description: 'Рома Красницкий в воронке 7977402' }
        ];
        
        for (const testLead of testLeads) {
            console.log(`\n   🔍 Сделка ${testLead.id}: ${testLead.description}`);
            
            try {
                const lead = await amoCrmService.makeRequest('GET', 
                    `/api/v4/leads/${testLead.id}?with=custom_fields_values`
                );
                
                if (lead) {
                    const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                    const score = amoCrmService.calculateLeadScore(lead, subscriptionInfo);
                    
                    result.lead_comparison[testLead.id] = {
                        id: lead.id,
                        name: lead.name,
                        pipeline_id: lead.pipeline_id,
                        status_id: lead.status_id,
                        created_at: lead.created_at,
                        created_date: new Date(lead.created_at * 1000).toLocaleString(),
                        subscription_info: subscriptionInfo,
                        score: score,
                        fields_count: lead.custom_fields_values?.length || 0,
                        important_fields: {}
                    };
                    
                    // Извлекаем важные поля
                    if (lead.custom_fields_values) {
                        const importantFieldIds = [
                            amoCrmService.FIELD_IDS.LEAD.TOTAL_CLASSES,
                            amoCrmService.FIELD_IDS.LEAD.USED_CLASSES,
                            amoCrmService.FIELD_IDS.LEAD.REMAINING_CLASSES,
                            amoCrmService.FIELD_IDS.LEAD.ACTIVATION_DATE,
                            amoCrmService.FIELD_IDS.LEAD.EXPIRATION_DATE
                        ];
                        
                        for (const field of lead.custom_fields_values) {
                            const fieldId = field.field_id || field.id;
                            if (importantFieldIds.includes(fieldId)) {
                                result.lead_comparison[testLead.id].important_fields[fieldId] = {
                                    value: amoCrmService.getFieldValue(field),
                                    raw: field.values
                                };
                            }
                        }
                    }
                    
                    console.log(`     Название: "${lead.name}"`);
                    console.log(`     Воронка: ${lead.pipeline_id}, Статус: ${lead.status_id}`);
                    console.log(`     Абонемент: ${subscriptionInfo.subscriptionType}`);
                    console.log(`     Занятий: ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses} (осталось: ${subscriptionInfo.remainingClasses})`);
                    console.log(`     Активен: ${subscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
                    console.log(`     Оценка системы: ${score}`);
                    console.log(`     Поля: ${lead.custom_fields_values?.length || 0}`);
                    
                    // Выводим важные поля
                    Object.entries(result.lead_comparison[testLead.id].important_fields).forEach(([fieldId, data]) => {
                        console.log(`     Поле ${fieldId}: "${data.value}"`);
                    });
                }
            } catch (error) {
                console.log(`     ❌ Ошибка: ${error.message}`);
                result.lead_comparison[testLead.id] = {
                    error: error.message
                };
            }
        }
        
        // 6. РЕКОМЕНДАЦИИ
        console.log('\n💡 6. РЕКОМЕНДАЦИИ И ВЫВОДЫ');
        result.recommendations = [];
        
        // Проверка настроек
        if (!amoCrmService.SUBSCRIPTION_PIPELINE_IDS.includes(7977402)) {
            result.recommendations.push('❌ Воронка "!Абонемент" (7977402) не в списке SUBSCRIPTION_PIPELINE_IDS');
        } else {
            result.recommendations.push('✅ Воронка "!Абонемент" в списке');
        }
        
        if (!amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.includes(65473306)) {
            result.recommendations.push('❌ Статус "Активный абонемент" (65473306) не в списке активных статусов');
        } else {
            result.recommendations.push('✅ Статус "Активный абонемент" в списке активных');
        }
        
        // Проверка полей
        const testLead = result.lead_comparison[28674745];
        if (testLead && testLead.subscription_info) {
            if (testLead.subscription_info.totalClasses !== 8) {
                result.recommendations.push(`❌ Проблема с извлечением totalClasses: должно быть 8, а извлекается ${testLead.subscription_info.totalClasses}`);
            }
            if (testLead.subscription_info.usedClasses !== 1) {
                result.recommendations.push(`❌ Проблема с извлечением usedClasses: должно быть 1, а извлекается ${testLead.subscription_info.usedClasses}`);
            }
        }
        
        // Проверка логики выбора сделок
        const polyanaLead = result.lead_comparison[28674745];
        const autoLead = result.lead_comparison[13154405];
        
        if (polyanaLead && autoLead) {
            if (autoLead.score > polyanaLead.score) {
                result.recommendations.push(`❌ ПРОБЛЕМА: Автосделка ${autoLead.id} имеет оценку ${autoLead.score}, а правильная сделка ${polyanaLead.id} - ${polyanaLead.score}`);
                result.recommendations.push(`   Автосделка выигрывает из-за более высокой оценки!`);
            } else {
                result.recommendations.push(`✅ Правильная сделка имеет более высокую оценку`);
            }
        }
        
        // Выводим рекомендации
        result.recommendations.forEach((rec, index) => {
            console.log(`   ${index + 1}. ${rec}`);
        });
        
        console.log('\n' + '='.repeat(100));
        console.log('✅ ПОЛНЫЙ АНАЛИЗ ЗАВЕРШЕН');
        console.log('='.repeat(100));
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            data: result
        });
        
    } catch (error) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА В СИСТЕМЕ:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

// ==================== ДЕТАЛЬНЫЙ АНАЛИЗ КОНКРЕТНОГО КОНТАКТА ====================
app.get('/api/debug/full-contact-analysis/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        console.log(`\n🔍 ПОЛНЫЙ АНАЛИЗ КОНТАКТА ${contactId}`);
        
        const result = {
            contact_info: {},
            all_leads: [],
            lead_analysis: [],
            system_selection: {},
            recommendations: []
        };
        
        // 1. Получаем полную информацию о контакте
        console.log('\n📋 1. ИНФОРМАЦИЯ О КОНТАКТЕ');
        try {
            const contact = await amoCrmService.makeRequest('GET', 
                `/api/v4/contacts/${contactId}?with=custom_fields_values,leads`
            );
            
            result.contact_info = {
                id: contact.id,
                name: contact.name,
                created_at: contact.created_at,
                updated_at: contact.updated_at,
                custom_fields_count: contact.custom_fields_values?.length || 0,
                leads_count: contact._embedded?.leads?.length || 0
            };
            
            console.log(`   Имя: "${contact.name}"`);
            console.log(`   Поля: ${contact.custom_fields_values?.length || 0}`);
            console.log(`   Сделок: ${contact._embedded?.leads?.length || 0}`);
            
            // Выводим учеников из контакта
            const students = amoCrmService.extractStudentsFromContact(contact);
            console.log(`   Учеников в контакте: ${students.length}`);
            students.forEach((student, index) => {
                console.log(`     ${index + 1}. ${student.studentName}`);
            });
            
        } catch (error) {
            console.log(`   ❌ Ошибка получения контакта: ${error.message}`);
        }
        
        // 2. Получаем ВСЕ сделки контакта
        console.log('\n📊 2. ВСЕ СДЕЛКИ КОНТАКТА');
        const allLeads = await amoCrmService.getContactLeads(contactId);
        result.all_leads = allLeads.map(lead => ({
            id: lead.id,
            name: lead.name,
            pipeline_id: lead.pipeline_id,
            status_id: lead.status_id,
            created_at: lead.created_at
        }));
        
        console.log(`   Всего сделок: ${allLeads.length}`);
        
        // 3. Анализируем каждую сделку
        console.log('\n🔬 3. АНАЛИЗ КАЖДОЙ СДЕЛКИ');
        for (const lead of allLeads.slice(0, 20)) { // Анализируем первые 20 сделок
            console.log(`\n   📋 Сделка ID: ${lead.id}`);
            console.log(`     Название: "${lead.name}"`);
            console.log(`     Воронка: ${lead.pipeline_id}, Статус: ${lead.status_id}`);
            
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            const score = amoCrmService.calculateLeadScore(lead, subscriptionInfo);
            
            const leadAnalysis = {
                id: lead.id,
                name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                subscription_info: subscriptionInfo,
                score: score,
                is_best_candidate: false
            };
            
            // Проверяем критерии для "лучшей" сделки
            let criteria = [];
            if (lead.pipeline_id === 7977402) criteria.push('✅ Воронка "!Абонемент"');
            if (subscriptionInfo.hasSubscription) criteria.push('✅ Есть абонемент');
            if (subscriptionInfo.subscriptionActive) criteria.push('✅ Активен');
            if (subscriptionInfo.totalClasses > 0) criteria.push(`✅ ${subscriptionInfo.totalClasses} занятий`);
            
            if (criteria.length > 0) {
                console.log(`     Критерии: ${criteria.join(', ')}`);
            }
            
            console.log(`     Оценка: ${score}`);
            console.log(`     Абонемент: ${subscriptionInfo.subscriptionType}`);
            console.log(`     Занятий: ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses}`);
            
            result.lead_analysis.push(leadAnalysis);
        }
        
        // 4. Что выберет наша система
        console.log('\n🎯 4. ВЫБОР СИСТЕМЫ');
        const bestLead = await amoCrmService.findBestLeadForContact(contactId);
        
        if (bestLead) {
            result.system_selection = {
                selected_lead_id: bestLead.lead.id,
                selected_lead_name: bestLead.lead.name,
                score: bestLead.score,
                subscription_info: bestLead.subscriptionInfo,
                reason: 'Наибольшая оценка по системе'
            };
            
            console.log(`   ✅ Система выбрала: ${bestLead.lead.id} - "${bestLead.lead.name}"`);
            console.log(`     Оценка: ${bestLead.score}`);
            console.log(`     Абонемент: ${bestLead.subscriptionInfo.subscriptionType}`);
            console.log(`     Занятий: ${bestLead.subscriptionInfo.usedClasses}/${bestLead.subscriptionInfo.totalClasses}`);
            
            // Помечаем выбранную сделку в анализе
            const selectedIndex = result.lead_analysis.findIndex(l => l.id === bestLead.lead.id);
            if (selectedIndex !== -1) {
                result.lead_analysis[selectedIndex].is_best_candidate = true;
                result.lead_analysis[selectedIndex].selection_reason = 'Выбрана системой как лучшая';
            }
        } else {
            console.log(`   ❌ Система не выбрала сделку`);
        }
        
        // 5. Рекомендации
        console.log('\n💡 5. РЕКОМЕНДАЦИИ');
        
        // Находим сделки в воронке "!Абонемент"
        const subscriptionPipelineLeads = result.lead_analysis.filter(l => l.pipeline_id === 7977402);
        if (subscriptionPipelineLeads.length > 0) {
            result.recommendations.push(`✅ В воронке "!Абонемент" найдено ${subscriptionPipelineLeads.length} сделок`);
            
            // Проверяем, выбрала ли система сделку из этой воронки
            const bestIsFromSubscriptionPipeline = subscriptionPipelineLeads.some(l => l.is_best_candidate);
            if (!bestIsFromSubscriptionPipeline) {
                result.recommendations.push(`❌ ПРОБЛЕМА: Система выбрала сделку НЕ из воронки "!Абонемент"`);
                
                // Находим лучшую сделку из воронки "!Абонемент"
                const bestInPipeline = subscriptionPipelineLeads.reduce((best, current) => 
                    current.score > best.score ? current : best
                );
                
                result.recommendations.push(`   Лучшая сделка в воронке "!Абонемент": ${bestInPipeline.id} (оценка: ${bestInPipeline.score})`);
                result.recommendations.push(`   Выбранная сделка: ${result.system_selection.selected_lead_id} (оценка: ${result.system_selection.score})`);
            }
        } else {
            result.recommendations.push(`⚠️  В воронке "!Абонемент" сделок не найдено`);
        }
        
        // Проверяем данные абонемента
        if (result.system_selection.subscription_info) {
            const subInfo = result.system_selection.subscription_info;
            if (subInfo.totalClasses > 0 && subInfo.usedClasses === 0) {
                result.recommendations.push(`⚠️  В выбранной сделке 0 использованных занятий, возможно это неактуальная сделка`);
            }
        }
        
        result.recommendations.forEach((rec, index) => {
            console.log(`   ${index + 1}. ${rec}`);
        });
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ТЕСТ КОНКРЕТНОГО КОНТАКТА ====================
app.get('/api/debug/test-contact/:contactId', async (req, res) => {
    try {
        const contactId = parseInt(req.params.contactId);
        console.log(`\n🧪 ТЕСТ КОНТАКТА ${contactId}`);
        
        // Получаем контакт
        const contact = await amoCrmService.makeRequest('GET', 
            `/api/v4/contacts/${contactId}?with=custom_fields_values`
        );
        
        // Получаем все сделки
        const allLeads = await amoCrmService.getContactLeads(contactId);
        
        // Находим лучшую сделку
        const bestLead = await amoCrmService.findBestLeadForContact(contactId);
        
        res.json({
            success: true,
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name,
                    phone: amoCrmService.extractPhoneFromContact(contact)
                },
                total_leads: allLeads.length,
                best_lead: bestLead ? {
                    id: bestLead.lead.id,
                    name: bestLead.lead.name,
                    pipeline_id: bestLead.lead.pipeline_id,
                    status_id: bestLead.lead.status_id,
                    score: bestLead.score,
                    subscription_info: bestLead.subscriptionInfo
                } : null,
                all_leads_info: allLeads.map(lead => ({
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    created_at: lead.created_at,
                    created_date: new Date(lead.created_at * 1000).toLocaleDateString()
                }))
            }
        });
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ОТЛАДКА ПОИСКА СДЕЛОК ДЛЯ КОНТАКТА ====================
app.get('/api/debug/contact-leads/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        console.log(`\n🔍 ПОИСК ВСЕХ СДЕЛОК ДЛЯ КОНТАКТА: ${contactId}`);
        
        const allLeads = await amoCrmService.getContactLeads(contactId);
        
        console.log(`📊 Всего сделок: ${allLeads.length}`);
        
        // Собираем информацию о каждой сделке
        const leadsInfo = [];
        
        for (const lead of allLeads.slice(0, 50)) { // Берем первые 50 сделок
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            
            leadsInfo.push({
                id: lead.id,
                name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                status_name: this.getStatusName(lead.status_id),
                created_at: lead.created_at,
                created_date: new Date(lead.created_at * 1000).toLocaleString(),
                subscription_info: subscriptionInfo
            });
            
            console.log(`\n📋 Сделка ID: ${lead.id}`);
            console.log(`   Название: "${lead.name}"`);
            console.log(`   Воронка: ${lead.pipeline_id}, Статус: ${lead.status_id}`);
            console.log(`   Абонемент: ${subscriptionInfo.subscriptionType}`);
            console.log(`   Занятий: ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses} (осталось: ${subscriptionInfo.remainingClasses})`);
            console.log(`   Активен: ${subscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
        }
        
        // Ищем сделку 28674745
        console.log(`\n🔍 ПОИСК КОНКРЕТНОЙ СДЕЛКИ 28674745...`);
        const targetLead = allLeads.find(lead => lead.id === 28674745);
        
        if (targetLead) {
            console.log(`✅ Сделка 28674745 найдена!`);
            const targetSubscription = amoCrmService.extractSubscriptionInfo(targetLead);
            console.log(`   Название: "${targetLead.name}"`);
            console.log(`   Воронка: ${targetLead.pipeline_id}, Статус: ${targetLead.status_id}`);
            console.log(`   Абонемент: ${targetSubscription.subscriptionType}`);
            console.log(`   Занятий: ${targetSubscription.usedClasses}/${targetSubscription.totalClasses}`);
            console.log(`   Активен: ${targetSubscription.subscriptionActive ? 'Да' : 'Нет'}`);
        } else {
            console.log(`❌ Сделка 28674745 не найдена в списке сделок контакта`);
        }
        
        res.json({
            success: true,
            data: {
                contact_id: contactId,
                total_leads: allLeads.length,
                leads: leadsInfo,
                target_lead_found: !!targetLead,
                target_lead_info: targetLead ? {
                    id: targetLead.id,
                    name: targetLead.name,
                    pipeline_id: targetLead.pipeline_id,
                    status_id: targetLead.status_id,
                    subscription_info: amoCrmService.extractSubscriptionInfo(targetLead)
                } : null
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска сделок:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ТЕСТ ПОИСКА ЛУЧШЕЙ СДЕЛКИ ====================
app.get('/api/debug/find-best-lead/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        console.log(`\n🧪 ТЕСТ ПОИСКА ЛУЧШЕЙ СДЕЛКИ ДЛЯ КОНТАКТА ${contactId}`);
        
        const bestLead = await amoCrmService.findBestLeadForContact(contactId);
        
        if (bestLead) {
            console.log(`\n✅ ЛУЧШАЯ СДЕЛКА НАЙДЕНА:`);
            console.log(`   ID: ${bestLead.lead.id}`);
            console.log(`   Название: "${bestLead.lead.name}"`);
            console.log(`   Воронка: ${bestLead.lead.pipeline_id}`);
            console.log(`   Статус: ${bestLead.lead.status_id}`);
            console.log(`   Абонемент: ${bestLead.subscriptionInfo.subscriptionType}`);
            console.log(`   Занятий: ${bestLead.subscriptionInfo.usedClasses}/${bestLead.subscriptionInfo.totalClasses}`);
            console.log(`   Активен: ${bestLead.subscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
            console.log(`   Оценка: ${bestLead.score}`);
        } else {
            console.log('❌ Сделка не найдена');
        }
        
        res.json({
            success: true,
            data: {
                contact_id: contactId,
                best_lead: bestLead ? {
                    id: bestLead.lead.id,
                    name: bestLead.lead.name,
                    pipeline_id: bestLead.lead.pipeline_id,
                    status_id: bestLead.lead.status_id,
                    subscription_info: bestLead.subscriptionInfo
                } : null
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ЗАПУСК СЕРВЕРА ====================
const amoCrmService = new AmoCrmService();

const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🚀 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('📊 ПОЛНАЯ ИНТЕГРАЦИЯ С AMOCRM');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM подключен успешно!');
            console.log('🎯 Настройки системы:');
            console.log(`   • Воронок для поиска: ${amoCrmService.SUBSCRIPTION_PIPELINE_IDS.length}`);
            console.log(`   • Активных статусов: ${amoCrmService.ACTIVE_SUBSCRIPTION_STATUSES.length}`);
            console.log(`   • Статусов занятий: ${amoCrmService.LESSON_STATUSES.length}`);
        } else {
            console.log('❌ Не удалось подключиться к amoCRM');
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🎉 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 URL: http://localhost:${PORT}`);
            console.log(`🔗 Главный маршрут: POST /api/auth/real-data`);
            console.log(`📊 Статус: GET /api/status`);
            console.log(`🧪 Тест поиска: GET /api/test/search/:phone`);
            console.log('='.repeat(80));
            console.log('\n📱 ДЛЯ ТЕСТИРОВАНИЯ:');
            console.log('1. Откройте приложение в браузере');
            console.log('2. Используйте номер телефона: 79778853270');
            console.log('3. Или протестируйте через API:');
            console.log('   GET /api/test/search/79778853270');
            console.log('='.repeat(80));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

startServer();
