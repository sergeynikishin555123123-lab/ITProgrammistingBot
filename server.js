// server.js - ПОЛНОСТЬЮ ПЕРЕРАБОТАННАЯ И ИСПРАВЛЕННАЯ ВЕРСИЯ
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
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService (ВЕРСИЯ 5.0)');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.fieldMappings = new Map();
        
        // ДИНАМИЧЕСКИ ОПРЕДЕЛЯЕМЫЕ ID ПОЛЕЙ
        this.FIELD_IDS = {
            LEAD: {},
            CONTACT: {}
        };
    }

    async initialize() {
        try {
            if (!this.accessToken) {
                console.error('❌ Токен amoCRM не указан в env');
                return false;
            }
            
            console.log('🔍 Проверка валидности токена...');
            const isValid = await this.checkTokenValidity(this.accessToken);
            this.isInitialized = isValid;
            
            if (isValid) {
                await this.loadAndMapFields();
                console.log('✅ amoCRM успешно инициализирован');
            }
            return isValid;
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
            return true;
        } catch (error) {
            console.error('❌ Ошибка проверки токена:', error.message);
            return false;
        }
    }

    async loadAndMapFields() {
        try {
            console.log('📋 Загрузка и маппинг полей amoCRM...');
            
            // Загружаем поля сделок
            const leadFields = await this.makeRequest('GET', '/api/v4/leads/custom_fields');
            await this.mapFields(leadFields, 'LEAD');
            
            // Загружаем поля контактов
            const contactFields = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            await this.mapFields(contactFields, 'CONTACT');
            
            // Выводим отладочную информацию
            this.printFieldMapping();
            
            return true;
        } catch (error) {
            console.error('❌ Ошибка загрузки полей:', error.message);
            return false;
        }
    }

    async mapFields(fieldsResponse, type) {
        if (!fieldsResponse || !fieldsResponse._embedded || !fieldsResponse._embedded.custom_fields) {
            console.log(`⚠️  Поля ${type} не найдены`);
            return;
        }
        
        const fields = fieldsResponse._embedded.custom_fields;
        console.log(`📊 Найдено полей ${type}: ${fields.length}`);
        
        for (const field of fields) {
            const fieldId = field.id;
            const fieldName = field.name.toLowerCase();
            
            // Сохраняем в кэш
            this.fieldMappings.set(fieldId, {
                id: fieldId,
                name: field.name,
                type: field.type,
                enums: field.enums || []
            });
            
            // Маппинг полей сделок
            if (type === 'LEAD') {
                if (fieldName.includes('абонемент занят')) {
                    this.FIELD_IDS.LEAD.TOTAL_CLASSES = fieldId;
                }
                else if (fieldName.includes('счетчик занят')) {
                    this.FIELD_IDS.LEAD.USED_CLASSES = fieldId;
                }
                else if (fieldName.includes('остаток занят')) {
                    this.FIELD_IDS.LEAD.REMAINING_CLASSES = fieldId;
                }
                else if (fieldName.includes('окончание абонемента')) {
                    this.FIELD_IDS.LEAD.EXPIRATION_DATE = fieldId;
                }
                else if (fieldName.includes('дата активации')) {
                    this.FIELD_IDS.LEAD.ACTIVATION_DATE = fieldId;
                }
                else if (fieldName.includes('дата последнего визита')) {
                    this.FIELD_IDS.LEAD.LAST_VISIT_DATE = fieldId;
                }
                else if (fieldName.includes('тип абонемента')) {
                    this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE = fieldId;
                }
                else if (fieldName.includes('филиал') || fieldName.includes('центр')) {
                    this.FIELD_IDS.LEAD.BRANCH = fieldId;
                }
                else if (fieldName.includes('заморозка')) {
                    this.FIELD_IDS.LEAD.FREEZE = fieldId;
                }
            }
            
            // Маппинг полей контактов
            if (type === 'CONTACT') {
                if (fieldName.includes('фио ребенка') || (fieldName.includes('ребен') && fieldName.includes('фио'))) {
                    if (!this.FIELD_IDS.CONTACT.CHILD_1_NAME) {
                        this.FIELD_IDS.CONTACT.CHILD_1_NAME = fieldId;
                    } else if (!this.FIELD_IDS.CONTACT.CHILD_2_NAME) {
                        this.FIELD_IDS.CONTACT.CHILD_2_NAME = fieldId;
                    } else if (!this.FIELD_IDS.CONTACT.CHILD_3_NAME) {
                        this.FIELD_IDS.CONTACT.CHILD_3_NAME = fieldId;
                    }
                }
                else if (fieldName.includes('филиал') || fieldName.includes('центр')) {
                    this.FIELD_IDS.CONTACT.BRANCH = fieldId;
                }
                else if (fieldName.includes('преподаватель')) {
                    this.FIELD_IDS.CONTACT.TEACHER = fieldId;
                }
                else if (fieldName.includes('день недел')) {
                    this.FIELD_IDS.CONTACT.DAY_OF_WEEK = fieldId;
                }
                else if (fieldName.includes('возраст') && fieldName.includes('групп')) {
                    this.FIELD_IDS.CONTACT.AGE_GROUP = fieldId;
                }
                else if (fieldName.includes('почта') || fieldName.includes('email')) {
                    this.FIELD_IDS.CONTACT.EMAIL = fieldId;
                }
            }
        }
    }

    printFieldMapping() {
        console.log('\n' + '='.repeat(80));
        console.log('📊 ИТОГОВЫЙ МАППИНГ ПОЛЕЙ:');
        console.log('='.repeat(80));
        
        console.log('\n🎫 ПОЛЯ СДЕЛОК:');
        console.log('-'.repeat(40));
        for (const [key, value] of Object.entries(this.FIELD_IDS.LEAD)) {
            if (value) {
                const fieldInfo = this.fieldMappings.get(value);
                console.log(`  ${key.padEnd(25)}: ${value} -> "${fieldInfo?.name || 'неизвестно'}"`);
            }
        }
        
        console.log('\n👤 ПОЛЯ КОНТАКТОВ:');
        console.log('-'.repeat(40));
        for (const [key, value] of Object.entries(this.FIELD_IDS.CONTACT)) {
            if (value) {
                const fieldInfo = this.fieldMappings.get(value);
                console.log(`  ${key.padEnd(25)}: ${value} -> "${fieldInfo?.name || 'неизвестно'}"`);
            }
        }
        console.log('='.repeat(80));
    }

    async makeRequest(method, endpoint, data = null) {
        const url = `${this.baseUrl}${endpoint}`;
        
        try {
            const config = {
                method: method,
                url: url,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            };

            if (data) config.data = data;

            const response = await axios(config);
            return response.data;
        } catch (error) {
            console.error(`❌ Ошибка запроса ${endpoint}: ${error.message}`);
            if (error.response) {
                console.error(`📊 Статус: ${error.response.status}`);
            }
            throw error;
        }
    }

    // 🔧 УЛУЧШЕННЫЙ ПОИСК ПО ТЕЛЕФОНУ
    async searchContactsByPhone(phoneNumber) {
        console.log(`\n🔍 ПОИСК КОНТАКТОВ: ${phoneNumber}`);
        
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
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
            
            console.log(`🔍 Форматированный номер: ${searchPhone}`);
            
            // Ищем контакты
            const response = await this.makeRequest(
                'GET', 
                `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=custom_fields_values`
            );
            
            console.log(`📊 Найдено контактов: ${response._embedded?.contacts?.length || 0}`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    // 🔧 НОВЫЙ МЕТОД: ИЩЕТ ВСЕХ ДЕТЕЙ В КОНТАКТЕ
    async extractChildrenFromContact(contact) {
        const children = [];
        
        try {
            const customFields = contact.custom_fields_values || [];
            console.log(`\n👤 Поиск детей в контакте: ${contact.name || 'Без имени'}`);
            
            // Ищем все поля с детьми
            const childFields = [];
            
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                // Ищем поля с именами детей
                if ((fieldName.includes('ребен') || fieldName.includes('фио') || 
                     fieldName.includes('ученик')) && 
                    !fieldName.includes('день рождения') &&
                    !fieldName.includes('возраст') &&
                    !fieldName.includes('группа')) {
                    
                    childFields.push({
                        id: field.field_id || field.id,
                        name: field.name,
                        value: fieldValue
                    });
                }
            }
            
            // Создаем объекты детей
            childFields.forEach((childField, index) => {
                const child = {
                    studentName: childField.value,
                    birthDate: '',
                    branch: '',
                    dayOfWeek: '',
                    teacherName: '',
                    ageGroup: '',
                    allergies: '',
                    parentName: contact.name || '',
                    email: '',
                    rawData: {}
                };
                
                // Заполняем дополнительные поля из контакта
                for (const field of customFields) {
                    const fieldName = this.getFieldName(field).toLowerCase();
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue || fieldValue.trim() === '') continue;
                    
                    if (fieldName.includes('филиал') || fieldName.includes('центр')) {
                        child.branch = fieldValue;
                    }
                    else if (fieldName.includes('преподаватель')) {
                        child.teacherName = fieldValue;
                    }
                    else if (fieldName.includes('день недел')) {
                        child.dayOfWeek = fieldValue;
                    }
                    else if (fieldName.includes('возраст') && fieldName.includes('групп')) {
                        child.ageGroup = fieldValue;
                    }
                    else if (fieldName.includes('почта') || fieldName.includes('email')) {
                        child.email = fieldValue;
                    }
                    else if (fieldName.includes('аллерг') || fieldName.includes('особенност')) {
                        child.allergies = fieldValue;
                    }
                    
                    // Сохраняем raw данные
                    child.rawData[fieldName] = fieldValue;
                }
                
                console.log(`   👶 Найден ребенок ${index + 1}: ${child.studentName}`);
                children.push(child);
            });
            
            // Если детей не нашли, создаем одного из имени контакта
            if (children.length === 0 && contact.name) {
                console.log('⚠️  Дети не найдены, создаем из имени контакта');
                const child = {
                    studentName: contact.name,
                    parentName: contact.name,
                    branch: '',
                    email: this.findEmail(contact),
                    rawData: {}
                };
                children.push(child);
            }
            
            console.log(`📊 Всего детей: ${children.length}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения детей:', error);
        }
        
        return children;
    }

    // 🔧 УЛУЧШЕННЫЙ ПОИСК СДЕЛОК ДЛЯ РЕБЕНКА
    async findLeadsForChild(childName, phoneNumber) {
        console.log(`\n🔍 ПОИСК СДЕЛОК ДЛЯ: ${childName}`);
        
        const leads = [];
        
        try {
            // 1. Ищем сделки по номеру телефона (через контакты)
            const contacts = await this.searchContactsByPhone(phoneNumber);
            const contactIds = contacts._embedded?.contacts?.map(c => c.id) || [];
            
            // Получаем сделки для каждого контакта
            for (const contactId of contactIds) {
                const contactLeads = await this.getContactLeads(contactId);
                leads.push(...contactLeads);
            }
            
            // 2. Ищем сделки по имени ребенка (если не нашли через контакты)
            if (leads.length === 0) {
                console.log('🔍 Поиск сделок по имени ребенка...');
                const nameLeads = await this.searchLeadsByName(childName);
                leads.push(...nameLeads);
            }
            
            // Фильтруем только сделки с абонементами
            const subscriptionLeads = leads.filter(lead => {
                const name = lead.name || '';
                const hasSubscription = name.includes('абонемент') || 
                                      name.includes('занят') ||
                                      name.includes('Активный абонемент') ||
                                      name.includes('!Абонемент');
                
                const isBad = name.includes('рассылка') || 
                             name.includes('сертификат') || 
                             name.includes('подарочн') ||
                             name.match(/^\d+\s*₽/);
                
                return hasSubscription && !isBad;
            });
            
            console.log(`📊 Найдено сделок: ${leads.length} (с абонементами: ${subscriptionLeads.length})`);
            
            return subscriptionLeads;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска сделок: ${error.message}`);
            return [];
        }
    }

    async getContactLeads(contactId) {
        try {
            console.log(`🔍 Получение сделок контакта ${contactId}...`);
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/contacts/${contactId}/leads?with=custom_fields_values`
            );
            
            const leads = response._embedded?.leads || [];
            console.log(`📊 Сделок у контакта: ${leads.length}`);
            
            return leads;
        } catch (error) {
            console.error(`⚠️  Ошибка получения сделок контакта: ${error.message}`);
            return [];
        }
    }

    async searchLeadsByName(name) {
        try {
            const cleanName = name.split(' ')[0];
            if (!cleanName || cleanName.length < 3) return [];
            
            console.log(`🔍 Поиск сделок по имени: ${cleanName}`);
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?query=${encodeURIComponent(cleanName)}&with=custom_fields_values&limit=20`
            );
            
            const leads = response._embedded?.leads || [];
            console.log(`📊 Найдено сделок по имени: ${leads.length}`);
            
            return leads;
        } catch (error) {
            console.error(`❌ Ошибка поиска сделок по имени: ${error.message}`);
            return [];
        }
    }

    // 🔧 ГЛАВНЫЙ МЕТОД: ПОЛУЧЕНИЕ ПРОФИЛЕЙ
    async getStudentProfilesByPhone(phoneNumber) {
        console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        const profiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return profiles;
        }
        
        try {
            // 1. Ищем контакты по телефону
            console.log('🔍 Поиск контактов...');
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            if (contacts.length === 0) {
                console.log('❌ Контакты не найдены');
                return profiles;
            }
            
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            // 2. Для каждого контакта получаем детей
            for (const contact of contacts) {
                console.log(`\n👤 Анализ контакта: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
                
                // Получаем полную информацию о контакте
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                // Извлекаем детей из контакта
                const children = await this.extractChildrenFromContact(fullContact);
                console.log(`📊 Найдено детей: ${children.length}`);
                
                if (children.length === 0) continue;
                
                // 3. Для каждого ребенка ищем сделки
                for (const child of children) {
                    console.log(`\n👤 Поиск абонемента для: ${child.studentName}`);
                    
                    // Ищем сделки для этого ребенка
                    const leads = await this.findLeadsForChild(child.studentName, phoneNumber);
                    
                    // Выбираем лучшую сделку
                    const bestLead = this.selectBestLead(leads, child.studentName);
                    
                    // Извлекаем информацию об абонементе
                    const subscriptionInfo = bestLead ? 
                        this.extractSubscriptionInfo(bestLead) : 
                        this.createEmptySubscriptionInfo();
                    
                    // Создаем профиль
                    const profile = this.createStudentProfile(
                        fullContact,
                        phoneNumber,
                        child,
                        subscriptionInfo,
                        bestLead
                    );
                    
                    profiles.push(profile);
                    console.log(`✅ Профиль создан: ${child.studentName}`);
                }
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${profiles.length}`);
            
            // Если профилей не нашли, создаем пустой профиль
            if (profiles.length === 0) {
                console.log('⚠️  Профили не найдены, создаем пустой...');
                const emptyProfile = this.createEmptyProfile(phoneNumber);
                profiles.push(emptyProfile);
            }
            
        } catch (error) {
            console.error(`❌ Ошибка получения профилей:`, error.message);
        }
        
        return profiles;
    }

    // 🔧 УЛУЧШЕННЫЙ ВЫБОР СДЕЛКИ
    selectBestLead(leads, studentName) {
        if (!leads || leads.length === 0) return null;
        
        console.log(`🔍 Выбор лучшей сделки из ${leads.length}...`);
        
        let bestLead = null;
        let bestScore = -1000;
        
        for (const lead of leads) {
            let score = 0;
            const leadName = lead.name || '';
            const leadNameLower = leadName.toLowerCase();
            
            // 1. СОВПАДЕНИЕ ИМЕНИ (самое важное)
            const cleanStudentName = studentName.toLowerCase().replace(/[^а-яё\s]/gi, '');
            const cleanLeadName = leadNameLower.replace(/[^а-яё\s]/gi, '');
            
            if (cleanLeadName.includes(cleanStudentName)) {
                score += 200;
                console.log(`   🎯 Полное совпадение имени: +200`);
            } else {
                // Частичное совпадение
                const studentParts = cleanStudentName.split(' ');
                for (const part of studentParts) {
                    if (part.length > 2 && cleanLeadName.includes(part)) {
                        score += 50;
                        console.log(`   ✅ Частичное совпадение "${part}": +50`);
                    }
                }
            }
            
            // 2. СТАТУСЫ АБОНЕМЕНТОВ
            if (leadName.includes('!Абонемент')) {
                score += 150;
                console.log(`   🏆 !Абонемент: +150`);
            }
            if (leadName.includes('Активный абонемент')) {
                score += 120;
                console.log(`   🥇 Активный абонемент: +120`);
            }
            
            // 3. ДАННЫЕ ОБ АБОНЕМЕНТЕ
            const subInfo = this.extractSubscriptionInfo(lead);
            if (subInfo.hasSubscription) {
                score += 80;
                console.log(`   📊 Есть абонемент: +80`);
                
                if (subInfo.totalClasses > 0) {
                    score += 20;
                    console.log(`   🔢 ${subInfo.totalClasses} занятий: +20`);
                }
                
                if (subInfo.subscriptionActive) {
                    score += 40;
                    console.log(`   🟢 Активен: +40`);
                }
            }
            
            // 4. МИНУСЫ ЗА НЕПОДХОДЯЩИЕ
            if (leadNameLower.includes('закончился') || 
                leadNameLower.includes('архив') || 
                leadNameLower.includes('не актив')) {
                score -= 100;
                console.log(`   ⚠️  Архив/неактивен: -100`);
            }
            
            console.log(`   📊 Итоговый балл: ${score}`);
            
            if (score > bestScore) {
                bestScore = score;
                bestLead = lead;
                console.log(`   🎯 Новый лучший выбор!`);
            }
        }
        
        if (bestLead) {
            console.log(`\n✅ Выбрана сделка: "${bestLead.name.substring(0, 50)}..."`);
            console.log(`📊 Лучший балл: ${bestScore}`);
        }
        
        return bestLead;
    }

    // 🔧 ИЗВЛЕЧЕНИЕ ИНФОРМАЦИИ ОБ АБОНЕМЕНТЕ
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
            subscriptionStatus: 'Нет абонемента',
            subscriptionBadge: 'inactive',
            branch: '',
            teacher: ''
        };
        
        if (!lead) {
            return subscriptionInfo;
        }
        
        try {
            const customFields = lead.custom_fields_values || [];
            const leadName = lead.name || '';
            
            console.log(`🔍 Анализ сделки: "${leadName.substring(0, 50)}..."`);
            
            // Парсим поля
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                const fieldValue = this.getFieldValue(field);
                const fieldName = this.getFieldName(field).toLowerCase();
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                if (fieldName.includes('абонемент') && fieldName.includes('занят')) {
                    const match = fieldValue.match(/(\d+)\s*занят/);
                    if (match && match[1]) {
                        subscriptionInfo.totalClasses = parseInt(match[1]);
                    }
                }
                else if (fieldName.includes('счетчик')) {
                    subscriptionInfo.usedClasses = parseInt(fieldValue) || 0;
                }
                else if (fieldName.includes('остаток')) {
                    subscriptionInfo.remainingClasses = parseInt(fieldValue) || 0;
                }
                else if (fieldName.includes('окончание') || fieldName.includes('срок')) {
                    subscriptionInfo.expirationDate = this.parseDateOrTimestamp(fieldValue);
                }
                else if (fieldName.includes('активации')) {
                    subscriptionInfo.activationDate = this.parseDateOrTimestamp(fieldValue);
                }
                else if (fieldName.includes('последн') && fieldName.includes('визит')) {
                    subscriptionInfo.lastVisitDate = this.parseDateOrTimestamp(fieldValue);
                }
                else if (fieldName.includes('тип абонемента')) {
                    subscriptionInfo.subscriptionType = fieldValue;
                }
                else if (fieldName.includes('филиал') || fieldName.includes('центр')) {
                    subscriptionInfo.branch = fieldValue;
                }
                else if (fieldName.includes('преподаватель')) {
                    subscriptionInfo.teacher = fieldValue;
                }
            }
            
            // Парсим название
            if (subscriptionInfo.totalClasses === 0) {
                const nameMatch = leadName.match(/(\d+)\s*занят/);
                if (nameMatch && nameMatch[1]) {
                    subscriptionInfo.totalClasses = parseInt(nameMatch[1]);
                }
            }
            
            // Рассчитываем
            if (subscriptionInfo.totalClasses > 0) {
                subscriptionInfo.hasSubscription = true;
                
                if (subscriptionInfo.usedClasses > 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                }
                else if (subscriptionInfo.remainingClasses > 0 && subscriptionInfo.usedClasses === 0) {
                    subscriptionInfo.usedClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.remainingClasses);
                }
                else if (subscriptionInfo.usedClasses === 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = subscriptionInfo.totalClasses;
                }
            }
            
            // Определяем статус
            const now = new Date();
            const isExpired = subscriptionInfo.expirationDate ? 
                new Date(subscriptionInfo.expirationDate) < now : false;
            const hasRemaining = subscriptionInfo.remainingClasses > 0;
            
            if (isExpired) {
                subscriptionInfo.subscriptionStatus = 'Абонемент истек';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (!hasRemaining && subscriptionInfo.usedClasses > 0) {
                subscriptionInfo.subscriptionStatus = 'Занятия закончились';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            }
            else if (hasRemaining && subscriptionInfo.usedClasses === 0) {
                subscriptionInfo.subscriptionStatus = `Купленный (${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
                subscriptionInfo.subscriptionBadge = 'has_subscription';
                subscriptionInfo.subscriptionActive = true;
            }
            else if (hasRemaining) {
                subscriptionInfo.subscriptionStatus = `Активный (осталось ${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
                subscriptionInfo.subscriptionBadge = 'active';
                subscriptionInfo.subscriptionActive = true;
            }
            else if (subscriptionInfo.totalClasses > 0) {
                subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий`;
                subscriptionInfo.subscriptionBadge = 'has_subscription';
                subscriptionInfo.subscriptionActive = true;
            }
            
            console.log(`📊 ИТОГ: ${subscriptionInfo.totalClasses} занятий, ${subscriptionInfo.usedClasses} исп., ${subscriptionInfo.remainingClasses} ост.`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации:', error);
        }
        
        return subscriptionInfo;
    }

    // 🔧 ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    createEmptySubscriptionInfo() {
        return {
            hasSubscription: false,
            totalClasses: 0,
            usedClasses: 0,
            remainingClasses: 0,
            subscriptionType: '',
            subscriptionActive: false,
            activationDate: '',
            expirationDate: '',
            lastVisitDate: '',
            subscriptionStatus: 'Нет абонемента',
            subscriptionBadge: 'inactive',
            branch: '',
            teacher: ''
        };
    }

    createEmptyProfile(phoneNumber) {
        return {
            amocrm_contact_id: null,
            amocrm_lead_id: null,
            student_name: 'Ученик',
            phone_number: phoneNumber,
            email: '',
            branch: '',
            parent_name: '',
            teacher_name: '',
            subscription_type: 'Без абонемента',
            subscription_active: 0,
            subscription_status: 'Нет абонемента',
            subscription_badge: 'inactive',
            total_classes: 0,
            remaining_classes: 0,
            used_classes: 0,
            expiration_date: null,
            activation_date: null,
            last_visit_date: null,
            is_demo: 0,
            source: 'amocrm',
            is_active: 1,
            last_sync: new Date().toISOString()
        };
    }

    createStudentProfile(contact, phoneNumber, child, subscriptionInfo, lead) {
        const email = child.email || this.findEmail(contact);
        
        const formatDate = (dateStr) => {
            if (!dateStr) return '';
            try {
                const date = new Date(dateStr);
                if (isNaN(date.getTime())) return dateStr;
                return date.toLocaleDateString('ru-RU');
            } catch (error) {
                return dateStr;
            }
        };
        
        // Объединяем данные из контакта и абонемента
        const branch = child.branch || subscriptionInfo.branch || '';
        const teacher = child.teacherName || subscriptionInfo.teacher || '';
        
        const profile = {
            amocrm_contact_id: contact.id || null,
            amocrm_lead_id: lead?.id || null,
            student_name: child.studentName || 'Ученик',
            phone_number: phoneNumber,
            email: email || '',
            birth_date: child.birthDate || '',
            branch: branch,
            parent_name: child.parentName || contact.name || '',
            day_of_week: child.dayOfWeek || '',
            teacher_name: teacher,
            age_group: child.ageGroup || '',
            allergies: child.allergies || '',
            
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
            
            expiration_date_display: formatDate(subscriptionInfo.expirationDate),
            activation_date_display: formatDate(subscriptionInfo.activationDate),
            last_visit_date_display: formatDate(subscriptionInfo.lastVisitDate),
            
            raw_contact_data: JSON.stringify(contact),
            lead_data: lead ? JSON.stringify(lead) : '{}',
            is_demo: 0,
            source: 'amocrm',
            is_active: 1,
            last_sync: new Date().toISOString()
        };
        
        console.log(`📊 Создан профиль:`);
        console.log(`   👤 ${profile.student_name}`);
        console.log(`   📍 ${profile.branch || 'Филиал не указан'}`);
        console.log(`   🎫 ${profile.subscription_status}`);
        console.log(`   📊 ${profile.used_classes}/${profile.total_classes} (ост: ${profile.remaining_classes})`);
        
        return profile;
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

    findEmail(contact) {
        try {
            const customFields = contact.custom_fields_values || [];
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if ((fieldName.includes('email') || fieldName.includes('почта')) && 
                    fieldValue && fieldValue.includes('@')) {
                    return fieldValue;
                }
            }
        } catch (error) {
            console.error('❌ Ошибка поиска email:', error);
        }
        return '';
    }

    getFieldValue(field) {
        try {
            if (!field || !field.values || !Array.isArray(field.values) || field.values.length === 0) {
                return '';
            }
            
            const firstValue = field.values[0];
            
            if (typeof firstValue === 'string') {
                return firstValue;
            } else if (typeof firstValue === 'object' && firstValue !== null) {
                if (firstValue.value !== undefined) {
                    return String(firstValue.value);
                } else if (firstValue.enum_value !== undefined) {
                    return String(firstValue.enum_value);
                } else if (firstValue.enum_id !== undefined) {
                    return String(firstValue.enum_id);
                }
            }
            
            return String(firstValue);
        } catch (error) {
            console.error('❌ Ошибка получения значения поля:', error);
            return '';
        }
    }

    getFieldName(field) {
        try {
            if (!field) return '';
            
            if (field.field_name) {
                return String(field.field_name).toLowerCase();
            } else if (field.name) {
                return String(field.name).toLowerCase();
            } else if (field.field_id && this.fieldMappings.has(field.field_id)) {
                return this.fieldMappings.get(field.field_id).name.toLowerCase();
            }
            
            return '';
        } catch (error) {
            console.error('❌ Ошибка получения имени поля:', error);
            return '';
        }
    }

    parseDateOrTimestamp(value) {
        if (!value) return null;
        
        try {
            const str = String(value).trim();
            
            if (/^\d+$/.test(str)) {
                const timestamp = parseInt(str);
                const date = timestamp < 10000000000 
                    ? new Date(timestamp * 1000)
                    : new Date(timestamp);
                
                return date.toISOString().split('T')[0];
            }
            
            if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
                return str;
            }
            
            return this.parseDate(str);
            
        } catch (error) {
            console.error('❌ Ошибка парсинга даты/таймстампа:', error);
            return value;
        }
    }

    parseDate(value) {
        if (!value) return null;
        
        try {
            const dateStr = String(value).trim();
            
            if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{2,4}$/)) {
                const parts = dateStr.split('.');
                let day = parts[0].padStart(2, '0');
                let month = parts[1].padStart(2, '0');
                let year = parts[2];
                
                if (year.length === 2) {
                    year = '20' + year;
                }
                
                return `${year}-${month}-${day}`;
            }
            
            return dateStr;
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error);
            return value;
        }
    }
}

// Создаем экземпляр сервиса
const amoCrmService = new AmoCrmService();

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ');
        console.log('='.repeat(80));
        
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
                amocrm_lead_id INTEGER,
                
                student_name TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                email TEXT,
                birth_date TEXT,
                branch TEXT,
                
                day_of_week TEXT,
                teacher_name TEXT,
                age_group TEXT,
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

            console.log(`📊 Найдено телефонов: ${phones.length}`);

            let totalUpdated = 0;
            let totalErrors = 0;

            for (const phoneRow of phones) {
                const phone = phoneRow.phone_number;
                
                try {
                    console.log(`\n🔍 Синхронизация: ${phone}`);
                    
                    const profiles = await amoCrmService.getStudentProfilesByPhone(phone);
                    const savedCount = await saveProfilesToDatabase(profiles);
                    
                    console.log(`✅ Обновлено: ${savedCount}`);
                    totalUpdated += savedCount;
                    
                } catch (phoneError) {
                    console.error(`❌ Ошибка синхронизации ${phone}:`, phoneError.message);
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
            console.log(`   • Телефонов: ${phones.length}`);
            console.log(`   • Обновлено: ${totalUpdated}`);
            console.log(`   • Ошибок: ${totalErrors}`);
            console.log(`   • Время: ${duration}ms`);
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
        console.log(`💾 Сохранение профилей...`);
        let savedCount = 0;
        
        for (const profile of profiles) {
            try {
                const existingProfile = await db.get(
                    `SELECT id FROM student_profiles 
                     WHERE student_name = ? AND phone_number = ?`,
                    [profile.student_name, profile.phone_number]
                );
                
                const columns = [
                    'amocrm_contact_id', 'amocrm_lead_id', 'student_name', 'phone_number', 'email',
                    'birth_date', 'branch', 'day_of_week', 'teacher_name', 'age_group', 'allergies',
                    'parent_name', 'subscription_type', 'subscription_active', 'subscription_status', 'subscription_badge',
                    'total_classes', 'used_classes', 'remaining_classes', 'expiration_date', 
                    'activation_date', 'last_visit_date', 'raw_contact_data', 
                    'lead_data', 'is_demo', 'source', 'is_active', 'last_sync'
                ];
                
                const values = [
                    profile.amocrm_contact_id || null,
                    profile.amocrm_lead_id || null,
                    profile.student_name,
                    profile.phone_number,
                    profile.email || '',
                    profile.birth_date || '',
                    profile.branch || '',
                    profile.day_of_week || '',
                    profile.teacher_name || '',
                    profile.age_group || '',
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
                    profile.raw_contact_data || '{}',
                    profile.lead_data || '{}',
                    profile.is_demo || 0,
                    profile.source || 'amocrm',
                    1,
                    new Date().toISOString()
                ];
                
                if (!existingProfile) {
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    const result = await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    
                    console.log(`✅ Создан (ID: ${result.lastID}): ${profile.student_name}`);
                    savedCount++;
                } else {
                    const setClause = columns.map(col => `${col} = ?`).join(', ');
                    
                    await db.run(
                        `UPDATE student_profiles SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [...values, existingProfile.id]
                    );
                    
                    console.log(`✅ Обновлен (ID: ${existingProfile.id}): ${profile.student_name}`);
                    savedCount++;
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка профиля ${profile.student_name}:`, profileError.message);
            }
        }
        
        console.log(`✅ Всего сохранено: ${savedCount}`);
        return savedCount;
    } catch (error) {
        console.error(`❌ Ошибка сохранения: ${error.message}`);
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
        version: '5.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        sync_status: syncService.getSyncStatus()
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
        
        console.log(`\n🔐 АВТОРИЗАЦИЯ: ${phone}`);
        
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`📱 Форматированный: ${formattedPhone}`);
        
        let profiles = [];
        
        if (amoCrmService.isInitialized) {
            console.log('🔍 Получение данных из amoCRM...');
            profiles = await amoCrmService.getStudentProfilesByPhone(formattedPhone);
            console.log(`📊 Найдено профилей: ${profiles.length}`);
            
            if (profiles.length > 0) {
                const savedCount = await saveProfilesToDatabase(profiles);
                console.log(`💾 Сохранено в БД: ${savedCount}`);
            }
        } else {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        if (profiles.length === 0) {
            console.log('🔍 Поиск в локальной базе...');
            const cleanPhone = phone.replace(/\D/g, '');
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY subscription_active DESC, updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            console.log(`📊 Найдено в локальной БД: ${profiles.length}`);
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
            console.error(`❌ Ошибка сессии: ${dbError.message}`);
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
            last_visit_date: p.last_visit_date,
            parent_name: p.parent_name,
            last_sync: p.last_sync
        }));
        
        const hasMultipleStudents = profiles.length > 1;
        
        const responseData = {
            success: true,
            message: profiles.length > 0 ? 'Найдены профили учеников' : 'Профили не найдены',
            data: {
                user: tempUser,
                profiles: responseProfiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                has_multiple_students: hasMultipleStudents,
                token: token,
                last_sync: profiles.length > 0 ? profiles[0].last_sync : null
            }
        };
        
        console.log(`✅ Авторизация завершена`);
        console.log(`📊 Профилей: ${profiles.length}`);
        
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
            
            if (!profile && phone) {
                const cleanPhone = phone.replace(/\D/g, '').slice(-10);
                const profiles = await db.all(
                    `SELECT * FROM student_profiles 
                     WHERE phone_number LIKE ? AND is_active = 1 
                     ORDER BY subscription_active DESC, updated_at DESC`,
                    [`%${cleanPhone}%`]
                );
                
                const index = profile_id.startsWith('profile-') ? 
                    parseInt(profile_id.replace('profile-', '')) : 0;
                
                if (profiles.length > index) {
                    profile = profiles[index];
                }
            }
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
                    allergies: profile.allergies,
                    teacher_name: profile.teacher_name
                },
                
                schedule: {
                    day_of_week: profile.day_of_week,
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

// ==================== ДИАГНОСТИЧЕСКИЕ МАРШРУТЫ ====================
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
                field_mapping: amoCrmService.FIELD_IDS,
                service_initialized: amoCrmService.isInitialized
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

app.get('/api/debug/phone/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n📱 ДИАГНОСТИКА ТЕЛЕФОНА: ${phone}`);
        console.log('='.repeat(80));
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован',
                phone: phone
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        
        // Ищем контакты
        console.log('\n🔍 Поиск контактов...');
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        const contactsInfo = contacts.map(contact => ({
            id: contact.id,
            name: contact.name,
            created_at: contact.created_at,
            updated_at: contact.updated_at,
            fields_count: contact.custom_fields_values ? contact.custom_fields_values.length : 0
        }));
        
        // Получаем профили
        console.log('\n🎯 Получение профилей...');
        const profiles = await amoCrmService.getStudentProfilesByPhone(phone);
        
        const profilesInfo = profiles.map(profile => ({
            student_name: profile.student_name,
            branch: profile.branch,
            subscription_status: profile.subscription_status,
            total_classes: profile.total_classes,
            used_classes: profile.used_classes,
            remaining_classes: profile.remaining_classes,
            expiration_date: profile.expiration_date,
            subscription_active: profile.subscription_active === 1
        }));
        
        // Проверяем базу
        console.log('\n💾 Проверка локальной базы...');
        const cleanPhone = phone.replace(/\D/g, '');
        const localProfiles = await db.all(
            `SELECT student_name, branch, subscription_status, total_classes, remaining_classes, last_sync 
             FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        
        res.json({
            success: true,
            message: 'Диагностика выполнена успешно',
            timestamp: new Date().toISOString(),
            data: {
                phone: {
                    original: phone,
                    formatted: formattedPhone,
                    clean: cleanPhone
                },
                contacts: {
                    count: contacts.length,
                    items: contactsInfo
                },
                profiles: {
                    count: profiles.length,
                    items: profilesInfo
                },
                local_database: {
                    count: localProfiles.length,
                    items: localProfiles
                },
                system_status: {
                    amocrm_connected: amoCrmService.isInitialized,
                    sync_status: syncService.getSyncStatus(),
                    last_sync: localProfiles.length > 0 ? localProfiles[0].last_sync : null
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики телефона:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка диагностики',
            error: error.message,
            phone: req.params.phone
        });
    }
});

app.get('/api/debug/lead/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        
        console.log(`\n📋 ДИАГНОСТИКА СДЕЛКИ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        const fields = [];
        if (lead.custom_fields_values) {
            lead.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                
                fields.push({
                    id: fieldId,
                    name: fieldName,
                    value: fieldValue
                });
            });
        }
        
        res.json({
            success: true,
            message: 'Сделка получена',
            timestamp: new Date().toISOString(),
            data: {
                lead: {
                    id: lead.id,
                    name: lead.name,
                    status_id: lead.status_id,
                    created_at: lead.created_at,
                    updated_at: lead.updated_at
                },
                subscription: subscriptionInfo,
                fields: {
                    count: fields.length,
                    items: fields
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики сделки:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения сделки',
            error: error.message,
            lead_id: req.params.id
        });
    }
});

// ==================== ДОПОЛНИТЕЛЬНЫЕ API ====================
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

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v5.0');
        console.log('='.repeat(80));
        console.log('✨ ИСПРАВЛЕННЫЙ ПОИСК СДЕЛОК ПО ИМЕНИ');
        console.log('✨ ДИНАМИЧЕСКИЙ МАППИНГ ПОЛЕЙ');
        console.log('✨ УЛУЧШЕННАЯ ЛОГИКА ВЫБОРА АБОНЕМЕНТОВ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            
            setTimeout(() => {
                syncService.startAutoSync();
            }, 5000);
            
        } else {
            console.log('❌ amoCRM не инициализирован');
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 URL: http://localhost:${PORT}`);
            console.log(`📊 База данных: SQLite`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log(`🔄 Автосинхронизация: ✅ Каждые 10 минут`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус: http://localhost:${PORT}/api/status`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`🔍 Диагностика: GET http://localhost:${PORT}/api/debug/phone/79175161115`);
            console.log(`📋 Проверка сделки: GET http://localhost:${PORT}/api/debug/lead/28658501`);
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
