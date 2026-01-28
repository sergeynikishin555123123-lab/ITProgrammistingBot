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
        
        // ВАШИ РЕАЛЬНЫЕ ВОРОНКИ И СТАТУСЫ
        this.SUBSCRIPTION_PIPELINE_ID = 7977402; // Воронка "!Абонемент"
        this.ACTIVE_SUBSCRIPTION_STATUSES = [
            72490890, // "Купленный абонемент"
            65473306  // "Активный абонемент"
        ];
        
        this.SUCCESS_STATUSES = [142]; // "Успешно реализовано"
        
        console.log('✅ Использую ВАШИ реальные данные:');
        console.log(`   🎯 Воронка абонементов: ${this.SUBSCRIPTION_PIPELINE_ID}`);
        console.log(`   ✅ Активные статусы: ${this.ACTIVE_SUBSCRIPTION_STATUSES.join(', ')}`);
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
    async findMostRecentActiveLead(contactId) {
        console.log(`\n🎯 Поиск самой свежей активной сделки для контакта: ${contactId}`);
        
        try {
            // Получаем ВСЕ сделки контакта
            const allLeads = await this.getContactLeads(contactId);
            
            if (allLeads.length === 0) {
                console.log('❌ У контакта нет сделок');
                return null;
            }
            
            console.log(`📊 Всего сделок у контакта: ${allLeads.length}`);
            
            // Фильтруем только активные сделки в воронке абонементов
            const activeLeads = allLeads.filter(lead => 
                lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID && 
                this.ACTIVE_SUBSCRIPTION_STATUSES.includes(lead.status_id)
            );
            
            console.log(`🎯 Активных сделок в воронке абонементов: ${activeLeads.length}`);
            
            if (activeLeads.length === 0) {
                console.log('⚠️  Активных сделок в воронке абонементов не найдено');
                
                // Ищем любую сделку с данными об абонементе
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
                
                return null;
            }
            
            // Находим самую свежую активную сделку (по created_at)
            const mostRecentLead = activeLeads.reduce((latest, current) => {
                return (current.created_at > latest.created_at) ? current : latest;
            });
            
            console.log(`🎉 Самая свежая активная сделка: "${mostRecentLead.name}"`);
            console.log(`   📅 Дата создания: ${new Date(mostRecentLead.created_at * 1000).toLocaleString()}`);
            console.log(`   🎯 Статус ID: ${mostRecentLead.status_id}`);
            
            const subscriptionInfo = this.extractSubscriptionInfo(mostRecentLead);
            
            return {
                lead: mostRecentLead,
                subscriptionInfo: subscriptionInfo,
                match_type: 'MOST_RECENT_ACTIVE'
            };
            
        } catch (error) {
            console.error(`❌ Ошибка поиска сделки:`, error.message);
            return null;
        }
    }
    
    // ==================== ИЗВЛЕЧЕНИЕ ДАННЫХ ОБ АБОНЕМЕНТЕ (ИСПРАВЛЕНО) ====================
    extractSubscriptionInfo(lead) {
        console.log(`\n🔍 Извлечение данных абонемента из сделки: "${lead.name}"`);
        
        const customFields = lead.custom_fields_values || [];
        
        // Создаем карту полей для быстрого доступа
        const fieldMap = new Map();
        
        for (const field of customFields) {
            const fieldId = field.field_id || field.id;
            const fieldValue = this.getFieldValue(field);
            fieldMap.set(fieldId, fieldValue);
            
            // Логируем важные поля
            if ([
                this.FIELD_IDS.LEAD.TOTAL_CLASSES,
                this.FIELD_IDS.LEAD.USED_CLASSES,
                this.FIELD_IDS.LEAD.REMAINING_CLASSES,
                this.FIELD_IDS.LEAD.ACTIVATION_DATE,
                this.FIELD_IDS.LEAD.EXPIRATION_DATE,
                this.FIELD_IDS.LEAD.LAST_VISIT_DATE,
                this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE,
                this.FIELD_IDS.LEAD.BRANCH
            ].includes(fieldId)) {
                console.log(`   📝 Поле ${fieldId}: ${fieldValue}`);
            }
        }
        
        // 1. Извлекаем общее количество занятий из поля "Абонемент занятий:"
        const subscriptionTypeRaw = fieldMap.get(this.FIELD_IDS.LEAD.TOTAL_CLASSES);
        console.log(`📊 Сырые данные "Абонемент занятий:": ${subscriptionTypeRaw}`);
        
        let totalClasses = 0;
        if (subscriptionTypeRaw) {
            const match = String(subscriptionTypeRaw).match(/\d+/);
            if (match) {
                totalClasses = parseInt(match[0]);
                console.log(`✅ Извлекли totalClasses из текста: ${subscriptionTypeRaw} -> ${totalClasses}`);
            }
        }
        
        // 2. Извлекаем использованные занятия из поля "Счетчик занятий:"
        const usedClassesRaw = fieldMap.get(this.FIELD_IDS.LEAD.USED_CLASSES);
        console.log(`📊 Сырые данные "Счетчик занятий:": ${usedClassesRaw}`);
        
        let usedClasses = 0;
        if (usedClassesRaw) {
            const match = String(usedClassesRaw).match(/\d+/);
            if (match) {
                usedClasses = parseInt(match[0]);
                console.log(`✅ Извлекли usedClasses из текста: ${usedClassesRaw} -> ${usedClasses}`);
            }
        }
        
        // 3. Извлекаем остаток занятий из поля "Остаток занятий"
        const remainingClassesRaw = fieldMap.get(this.FIELD_IDS.LEAD.REMAINING_CLASSES);
        console.log(`📊 Сырые данные "Остаток занятий": ${remainingClassesRaw}`);
        
        let remainingClasses = 0;
        if (remainingClassesRaw !== null && remainingClassesRaw !== undefined) {
            if (typeof remainingClassesRaw === 'number') {
                remainingClasses = remainingClassesRaw;
            } else if (typeof remainingClassesRaw === 'string') {
                const match = String(remainingClassesRaw).match(/\d+/);
                if (match) {
                    remainingClasses = parseInt(match[0]);
                }
            }
            console.log(`✅ Извлекли remainingClasses: ${remainingClassesRaw} -> ${remainingClasses}`);
        }
        
        // 4. Если остаток не указан, вычисляем его
        if (remainingClasses === 0 && totalClasses > 0 && usedClasses > 0) {
            remainingClasses = totalClasses - usedClasses;
            console.log(`🔄 Вычислен остаток: ${totalClasses} - ${usedClasses} = ${remainingClasses}`);
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
        const hasSubscription = totalClasses > 0 || remainingClasses > 0 || 
                               (subscriptionType && subscriptionType !== 'Без абонемента');
        
        // 7. Проверяем, активна ли сделка
        const isInSubscriptionPipeline = lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID;
        const hasActiveStatus = this.ACTIVE_SUBSCRIPTION_STATUSES.includes(lead.status_id);
        
        let subscriptionStatus = 'Нет данных';
        let subscriptionBadge = 'inactive';
        let subscriptionActive = false;
        
        if (hasActiveStatus && hasSubscription) {
            subscriptionStatus = 'Активен';
            subscriptionBadge = 'active';
            subscriptionActive = true;
        } else if (hasSubscription) {
            subscriptionStatus = 'Есть абонемент';
            subscriptionBadge = 'warning';
        } else {
            subscriptionStatus = 'Нет абонемента';
            subscriptionBadge = 'inactive';
        }
        
        console.log(`📊 РЕЗУЛЬТАТ извлечения данных:`);
        console.log(`   ✅ Абонемент: ${hasSubscription ? 'Да' : 'Нет'}`);
        console.log(`   📊 Занятий: ${usedClasses}/${totalClasses} (осталось: ${remainingClasses})`);
        console.log(`   🏷️  Тип: ${subscriptionType}`);
        console.log(`   📅 Активация: ${activationDate || 'Нет данных'}`);
        console.log(`   📅 Окончание: ${expirationDate || 'Нет данных'}`);
        console.log(`   📅 Последний визит: ${lastVisitDate || 'Нет данных'}`);
        console.log(`   🎯 Статус: ${subscriptionStatus} (активный: ${subscriptionActive})`);
        console.log(`   📍 Филиал: ${branch}`);
        console.log(`   👥 Возрастная группа: ${ageGroup}`);
        
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
