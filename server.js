// server.js - ПОЛНОСТЬЮ ПЕРЕПИСАННАЯ ВЕРСИЯ С ПРАВИЛЬНОЙ ЛОГИКОЙ
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');

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

// ==================== КЛАСС AMOCRM (ПЕРЕПИСАННЫЙ) ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.accountInfo = null;
        
        // Критические поля из вашего примера сделки
        this.FIELD_IDS = {
            // Основные поля абонемента
            TOTAL_CLASSES: 850241,        // "Абонемент занятий:"
            USED_CLASSES: 850257,         // "Счетчик занятий:"
            REMAINING_CLASSES: 890163,    // "Остаток занятий"
            EXPIRATION_DATE: 850255,      // "Окончание абонемента:"
            ACTIVATION_DATE: 851565,      // "Дата активации абонемента:"
            LAST_VISIT_DATE: 850259,      // "Дата последнего визита:"
            SUBSCRIPTION_TYPE: 891007,    // "Тип абонемента"
            AGE_GROUP: 850243,            // "Группа возраст:"
            FREEZE: 867693,               // "Заморозка абонемента:"
            SUBSCRIPTION_OWNER: 805465,   // "Принадлежность абонемента:"
            BRANCH: 891589,               // "Филиал"
            
            // Дополнительные
            PURCHASE_DATE: 850253,        // "Дата покупки:"
            PRICE_PER_CLASS: 891813,      // "Стоимость 1 занятия"
            TECHNICAL_CLASSES: 891819,    // "Количество занятий (тех)"
            ATTENDED_CLASSES: 884251      // "Кол-во отхоженных занятий"
        };
    }

    async initialize() {
        try {
            if (!this.accessToken) {
                console.log('❌ Токен amoCRM не указан');
                return false;
            }
            
            console.log('🔍 Проверка валидности токена...');
            const isValid = await this.checkTokenValidity(this.accessToken);
            this.isInitialized = isValid;
            
            if (isValid) {
                console.log('✅ amoCRM успешно инициализирован');
            } else {
                console.log('❌ Токен amoCRM невалиден');
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
                if (error.response.data) {
                    console.error(`📋 Данные:`, JSON.stringify(error.response.data, null, 2));
                }
            }
            throw error;
        }
    }

    // ==================== ОСНОВНАЯ ЛОГИКА (ПЕРЕПИСАННАЯ) ====================
    
    /**
     * Основной метод: получить активный абонемент по номеру телефона
     * Алгоритм:
     * 1. Найти все сделки по телефону
     * 2. Взять самую свежую сделку с абонементом (по дате активации)
     * 3. Проверить актуальность (не истек ли)
     * 4. Извлечь данные об абонементе
     */
    async getActiveSubscriptionByPhone(phoneNumber) {
        console.log(`\n🎯 ПОИСК АКТИВНОГО АБОНЕМЕНТА ДЛЯ: ${phoneNumber}`);
        console.log('='.repeat(80));
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return null;
        }
        
        try {
            // 1. Форматируем телефон
            const formattedPhone = this.formatPhoneNumber(phoneNumber);
            console.log(`📱 Форматированный номер: ${formattedPhone}`);
            
            // 2. Ищем контакт по телефону
            console.log('🔍 Поиск контакта по телефону...');
            const contact = await this.findContactByPhone(formattedPhone);
            
            if (!contact) {
                console.log('❌ Контакт не найден');
                return null;
            }
            
            console.log(`👤 Найден контакт: ${contact.name} (ID: ${contact.id})`);
            
            // 3. Получаем все сделки контакта
            console.log('📋 Получение всех сделок контакта...');
            const leads = await this.getContactLeads(contact.id);
            console.log(`📊 Найдено сделок: ${leads.length}`);
            
            if (leads.length === 0) {
                console.log('❌ У контакта нет сделок');
                return null;
            }
            
            // 4. Фильтруем сделки с абонементами и анализируем их
            console.log('🔍 Анализ сделок на наличие абонементов...');
            const subscriptionLeads = [];
            
            for (const lead of leads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                if (subscriptionInfo.hasSubscription) {
                    subscriptionLeads.push({
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        activationDate: subscriptionInfo.activationDate ? new Date(subscriptionInfo.activationDate) : null
                    });
                    console.log(`✅ Найден абонемент: "${lead.name}" (Активация: ${subscriptionInfo.activationDate})`);
                }
            }
            
            if (subscriptionLeads.length === 0) {
                console.log('❌ Не найдено сделок с абонементами');
                return null;
            }
            
            // 5. Сортируем по дате активации (самые свежие первыми)
            subscriptionLeads.sort((a, b) => {
                if (!a.activationDate && !b.activationDate) return 0;
                if (!a.activationDate) return 1;
                if (!b.activationDate) return -1;
                return b.activationDate - a.activationDate; // Сначала самые новые
            });
            
            console.log(`📊 Сортировка абонементов по дате активации...`);
            
            // 6. Берем самый свежий актуальный абонемент
            let activeSubscription = null;
            const now = new Date();
            
            for (const subLead of subscriptionLeads) {
                const subInfo = subLead.subscriptionInfo;
                
                console.log(`\n🔍 Проверка абонемента: "${subLead.lead.name}"`);
                console.log(`   📅 Активация: ${subInfo.activationDate}`);
                console.log(`   📅 Окончание: ${subInfo.expirationDate}`);
                console.log(`   📊 Занятий: ${subInfo.usedClasses}/${subInfo.totalClasses}`);
                
                // Проверяем, не истек ли абонемент
                if (subInfo.expirationDate) {
                    const expirationDate = new Date(subInfo.expirationDate);
                    if (expirationDate < now) {
                        console.log(`   ⚠️  Абонемент истек ${expirationDate.toISOString().split('T')[0]}`);
                        continue;
                    }
                }
                
                // Проверяем, не закончились ли занятия
                if (subInfo.totalClasses > 0 && subInfo.remainingClasses <= 0) {
                    console.log(`   ⚠️  Занятия закончились`);
                    continue;
                }
                
                // Проверяем заморозку
                if (subInfo.isFrozen) {
                    console.log(`   ⚠️  Абонемент заморожен`);
                    continue;
                }
                
                console.log(`   ✅ Абонемент актуален!`);
                activeSubscription = subLead;
                break;
            }
            
            if (!activeSubscription) {
                console.log('❌ Не найден актуальный активный абонемент');
                return null;
            }
            
            // 7. Создаем профиль ученика
            console.log('\n👤 СОЗДАНИЕ ПРОФИЛЯ УЧЕНИКА...');
            const profile = this.createStudentProfile(contact, activeSubscription.lead, activeSubscription.subscriptionInfo);
            
            console.log('='.repeat(80));
            console.log('✅ ПРОФИЛЬ УЧЕНИКА СОЗДАН УСПЕШНО!');
            console.log('='.repeat(80));
            
            return profile;
            
        } catch (error) {
            console.error('❌ Ошибка поиска абонемента:', error.message);
            return null;
        }
    }

    /**
     * Поиск контакта по номеру телефона
     */
    async findContactByPhone(phoneNumber) {
        try {
            const cleanPhone = phoneNumber.replace(/\D/g, '');
            const lastDigits = cleanPhone.slice(-10);
            
            // Поиск контактов через query
            const response = await this.makeRequest(
                'GET',
                `/api/v4/contacts?query=${encodeURIComponent(lastDigits)}&limit=10`
            );
            
            const contacts = response._embedded?.contacts || [];
            
            // Фильтруем контакты, чтобы убедиться, что телефон действительно совпадает
            for (const contact of contacts) {
                // Получаем полные данные контакта с кастомными полями
                const fullContact = await this.makeRequest(
                    'GET',
                    `/api/v4/contacts/${contact.id}?with=custom_fields_values`
                );
                
                // Проверяем поля телефона в контакте
                if (fullContact.custom_fields_values) {
                    for (const field of fullContact.custom_fields_values) {
                        if (field.field_code === 'PHONE' || field.code === 'PHONE' || 
                            (field.name && field.name.toLowerCase().includes('телефон'))) {
                            
                            if (field.values && field.values.length > 0) {
                                for (const phoneValue of field.values) {
                                    const contactPhone = phoneValue.value?.toString().replace(/\D/g, '') || '';
                                    if (contactPhone.includes(lastDigits)) {
                                        console.log(`📞 Найден телефон в контакте: ${phoneValue.value}`);
                                        return fullContact;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            // Если не нашли по полям телефона, берем первый контакт из поиска
            if (contacts.length > 0) {
                const firstContact = contacts[0];
                return await this.makeRequest(
                    'GET',
                    `/api/v4/contacts/${firstContact.id}?with=custom_fields_values`
                );
            }
            
            return null;
            
        } catch (error) {
            console.error('❌ Ошибка поиска контакта:', error.message);
            return null;
        }
    }

    /**
     * Получить все сделки контакта
     */
    async getContactLeads(contactId) {
        try {
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&limit=100`
            );
            
            return response._embedded?.leads || [];
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    /**
     * Извлечь информацию об абонементе из сделки
     */
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
            isFrozen: false,
            subscriptionOwner: '',
            ageGroup: '',
            purchaseDate: '',
            pricePerClass: 0
        };
        
        if (!lead || !lead.custom_fields_values) {
            return subscriptionInfo;
        }
        
        try {
            // Создаем карту значений полей
            const fieldMap = {};
            lead.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const value = this.extractFieldValue(field);
                if (value !== null && value !== '') {
                    fieldMap[fieldId] = value;
                }
            });
            
            // Извлекаем данные по известным ID полей
            const FIELD = this.FIELD_IDS;
            
            // 1. Общее количество занятий
            if (FIELD.TOTAL_CLASSES && fieldMap[FIELD.TOTAL_CLASSES]) {
                subscriptionInfo.totalClasses = this.parseClassesCount(fieldMap[FIELD.TOTAL_CLASSES]);
            }
            
            // 2. Использованные занятия
            if (FIELD.USED_CLASSES && fieldMap[FIELD.USED_CLASSES]) {
                subscriptionInfo.usedClasses = parseInt(fieldMap[FIELD.USED_CLASSES]) || 0;
            }
            
            // 3. Остаток занятий
            if (FIELD.REMAINING_CLASSES && fieldMap[FIELD.REMAINING_CLASSES]) {
                subscriptionInfo.remainingClasses = parseInt(fieldMap[FIELD.REMAINING_CLASSES]) || 0;
            }
            
            // 4. Тип абонемента
            if (FIELD.SUBSCRIPTION_TYPE && fieldMap[FIELD.SUBSCRIPTION_TYPE]) {
                subscriptionInfo.subscriptionType = fieldMap[FIELD.SUBSCRIPTION_TYPE];
            }
            
            // 5. Дата окончания
            if (FIELD.EXPIRATION_DATE && fieldMap[FIELD.EXPIRATION_DATE]) {
                subscriptionInfo.expirationDate = this.parseDateOrTimestamp(fieldMap[FIELD.EXPIRATION_DATE]);
            }
            
            // 6. Дата активации
            if (FIELD.ACTIVATION_DATE && fieldMap[FIELD.ACTIVATION_DATE]) {
                subscriptionInfo.activationDate = this.parseDateOrTimestamp(fieldMap[FIELD.ACTIVATION_DATE]);
            }
            
            // 7. Дата последнего визита
            if (FIELD.LAST_VISIT_DATE && fieldMap[FIELD.LAST_VISIT_DATE]) {
                subscriptionInfo.lastVisitDate = this.parseDateOrTimestamp(fieldMap[FIELD.LAST_VISIT_DATE]);
            }
            
            // 8. Возрастная группа
            if (FIELD.AGE_GROUP && fieldMap[FIELD.AGE_GROUP]) {
                subscriptionInfo.ageGroup = fieldMap[FIELD.AGE_GROUP];
            }
            
            // 9. Владелец абонемента
            if (FIELD.SUBSCRIPTION_OWNER && fieldMap[FIELD.SUBSCRIPTION_OWNER]) {
                subscriptionInfo.subscriptionOwner = fieldMap[FIELD.SUBSCRIPTION_OWNER];
            }
            
            // 10. Заморозка
            if (FIELD.FREEZE && fieldMap[FIELD.FREEZE]) {
                subscriptionInfo.isFrozen = fieldMap[FIELD.FREEZE].toLowerCase() === 'да';
            }
            
            // 11. Филиал
            if (FIELD.BRANCH && fieldMap[FIELD.BRANCH]) {
                subscriptionInfo.branch = fieldMap[FIELD.BRANCH];
            }
            
            // 12. Дата покупки
            if (FIELD.PURCHASE_DATE && fieldMap[FIELD.PURCHASE_DATE]) {
                subscriptionInfo.purchaseDate = this.parseDateOrTimestamp(fieldMap[FIELD.PURCHASE_DATE]);
            }
            
            // 13. Стоимость занятия
            if (FIELD.PRICE_PER_CLASS && fieldMap[FIELD.PRICE_PER_CLASS]) {
                subscriptionInfo.pricePerClass = parseFloat(fieldMap[FIELD.PRICE_PER_CLASS]) || 0;
            }
            
            // Определяем наличие абонемента
            subscriptionInfo.hasSubscription = subscriptionInfo.totalClasses > 0 || 
                                              subscriptionInfo.subscriptionType !== '';
            
            // Определяем статус абонемента
            if (subscriptionInfo.hasSubscription) {
                if (subscriptionInfo.isFrozen) {
                    subscriptionInfo.subscriptionStatus = 'Заморожен';
                    subscriptionInfo.subscriptionBadge = 'frozen';
                } else if (subscriptionInfo.expirationDate) {
                    const expiration = new Date(subscriptionInfo.expirationDate);
                    const now = new Date();
                    
                    if (expiration < now) {
                        subscriptionInfo.subscriptionStatus = 'Истек';
                        subscriptionInfo.subscriptionBadge = 'expired';
                    } else if (subscriptionInfo.remainingClasses <= 0 && subscriptionInfo.totalClasses > 0) {
                        subscriptionInfo.subscriptionStatus = 'Занятия закончились';
                        subscriptionInfo.subscriptionBadge = 'expired';
                    } else {
                        subscriptionInfo.subscriptionStatus = 'Активен';
                        subscriptionInfo.subscriptionBadge = 'active';
                        subscriptionInfo.subscriptionActive = true;
                    }
                } else {
                    subscriptionInfo.subscriptionStatus = 'Активен';
                    subscriptionInfo.subscriptionBadge = 'active';
                    subscriptionInfo.subscriptionActive = true;
                }
            }
            
            console.log(`📊 Статистика абонемента:`);
            console.log(`   • Всего занятий: ${subscriptionInfo.totalClasses}`);
            console.log(`   • Использовано: ${subscriptionInfo.usedClasses}`);
            console.log(`   • Осталось: ${subscriptionInfo.remainingClasses}`);
            console.log(`   • Статус: ${subscriptionInfo.subscriptionStatus}`);
            console.log(`   • Тип: ${subscriptionInfo.subscriptionType}`);
            console.log(`   • Активация: ${subscriptionInfo.activationDate}`);
            console.log(`   • Окончание: ${subscriptionInfo.expirationDate}`);
            
        } catch (error) {
            console.error('❌ Ошибка extractSubscriptionInfo:', error);
        }
        
        return subscriptionInfo;
    }

    /**
     * Создать профиль ученика из контакта и сделки
     */
    createStudentProfile(contact, lead, subscriptionInfo) {
        try {
            console.log('\n👤 ФОРМИРОВАНИЕ ПРОФИЛЯ УЧЕНИКА...');
            
            // 1. Извлекаем имя ученика из названия сделки
            const studentName = this.extractStudentNameFromLead(lead);
            console.log(`   👶 Имя ученика из сделки: ${studentName}`);
            
            // 2. Извлекаем имя родителя из контакта
            const parentName = contact.name || 'Родитель';
            console.log(`   👨‍👩‍👧 Имя родителя: ${parentName}`);
            
            // 3. Извлекаем контактные данные
            const email = this.extractEmailFromContact(contact);
            const phone = this.extractPhoneFromContact(contact);
            
            // 4. Формируем описание абонемента
            let subscriptionDescription = '';
            if (subscriptionInfo.hasSubscription) {
                if (subscriptionInfo.totalClasses > 0) {
                    subscriptionDescription = `${subscriptionInfo.subscriptionType || 'Абонемент'} на ${subscriptionInfo.totalClasses} занятий`;
                } else {
                    subscriptionDescription = subscriptionInfo.subscriptionType || 'Абонемент';
                }
            } else {
                subscriptionDescription = 'Без абонемента';
            }
            
            // 5. Рассчитываем прогресс
            let progress = 0;
            if (subscriptionInfo.totalClasses > 0) {
                progress = Math.round((subscriptionInfo.usedClasses / subscriptionInfo.totalClasses) * 100);
            }
            
            // 6. Проверяем актуальность
            const now = new Date();
            let isActive = subscriptionInfo.subscriptionActive;
            let daysRemaining = 0;
            
            if (subscriptionInfo.expirationDate) {
                const expiration = new Date(subscriptionInfo.expirationDate);
                if (expiration >= now) {
                    const diffTime = expiration - now;
                    daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                }
            }
            
            const profile = {
                // Идентификаторы
                amocrm_contact_id: contact.id || null,
                amocrm_lead_id: lead.id || null,
                
                // Основная информация ученика
                student_name: studentName,
                phone_number: phone,
                email: email,
                branch: subscriptionInfo.branch || 'Филиал не указан',
                age_group: subscriptionInfo.ageGroup || '',
                
                // Информация о родителе
                parent_name: parentName,
                
                // Абонемент
                subscription_type: subscriptionInfo.subscriptionType || 'Без абонемента',
                subscription_description: subscriptionDescription,
                subscription_active: isActive ? 1 : 0,
                subscription_status: subscriptionInfo.subscriptionStatus || 'Нет абонемента',
                subscription_badge: subscriptionInfo.subscriptionBadge || 'inactive',
                
                // Занятия
                total_classes: subscriptionInfo.totalClasses || 0,
                used_classes: subscriptionInfo.usedClasses || 0,
                remaining_classes: subscriptionInfo.remainingClasses || 0,
                progress_percent: progress,
                
                // Даты
                activation_date: subscriptionInfo.activationDate || null,
                expiration_date: subscriptionInfo.expirationDate || null,
                last_visit_date: subscriptionInfo.lastVisitDate || null,
                days_remaining: daysRemaining,
                
                // Дополнительно
                is_frozen: subscriptionInfo.isFrozen ? 1 : 0,
                subscription_owner: subscriptionInfo.subscriptionOwner || '',
                
                // Технические данные
                raw_contact_data: JSON.stringify(contact),
                lead_data: JSON.stringify(lead),
                custom_fields: JSON.stringify(lead.custom_fields_values || []),
                source: 'amocrm',
                last_sync: new Date().toISOString(),
                created_at: new Date().toISOString()
            };
            
            console.log('\n' + '='.repeat(60));
            console.log('✅ ПРОФИЛЬ УЧЕНИКА СОЗДАН:');
            console.log('='.repeat(60));
            console.log(`👶 Ученик: ${profile.student_name}`);
            console.log(`👨‍👩‍👧 Родитель: ${profile.parent_name}`);
            console.log(`📱 Телефон: ${profile.phone_number}`);
            console.log(`📍 Филиал: ${profile.branch}`);
            console.log('---');
            console.log(`🎫 Абонемент: ${profile.subscription_description}`);
            console.log(`📊 Статус: ${profile.subscription_status}`);
            console.log(`📈 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
            console.log(`📅 Активация: ${profile.activation_date || 'не указана'}`);
            console.log(`📅 Окончание: ${profile.expiration_date || 'не указано'}`);
            console.log(`⏳ Осталось дней: ${profile.days_remaining}`);
            console.log('='.repeat(60));
            
            return profile;
            
        } catch (error) {
            console.error('❌ Ошибка создания профиля:', error);
            return null;
        }
    }

    /**
     * Извлечь имя ученика из названия сделки
     * Примеры названий:
     * - "Василиса Зайцева - 4 занятия"
     * - "Иванов Иван - 8 занятий"
     * - "Абонемент для Петрова Пети"
     */
    extractStudentNameFromLead(lead) {
        if (!lead || !lead.name) {
            return 'Ученик';
        }
        
        const name = lead.name.trim();
        console.log(`🔍 Извлечение имени из: "${name}"`);
        
        // Паттерны для извлечения имени
        const patterns = [
            /^(.*?)\s*[-–]\s*\d+\s*занят/i,      // "Имя Фамилия - 4 занятия"
            /^(.*?)\s*[-–]\s*абонемент/i,         // "Имя Фамилия - абонемент"
            /для\s+(.*?)$/i,                      // "Абонемент для Имя Фамилия"
            /ученик\s+(.*?)$/i,                   // "Абонемент ученик Имя Фамилия"
            /^(.*?)\s*\(.*?\)$/i,                 // "Имя Фамилия (комментарий)"
            /^[^-–]*$/,                           // Просто имя без разделителей
            /^.*?[:]\s*(.*?)$/i                   // "Текст: Имя Фамилия"
        ];
        
        for (const pattern of patterns) {
            const match = name.match(pattern);
            if (match && match[1]) {
                const extractedName = match[1].trim();
                if (extractedName.length > 1 && !extractedName.match(/^\d+$/)) {
                    console.log(`✅ Извлечено имя: ${extractedName}`);
                    return extractedName;
                }
            }
        }
        
        // Если не нашли по паттернам, возвращаем все до первого тире или скобки
        const cleanName = name.split(/[-–(]/)[0].trim();
        if (cleanName.length > 0) {
            console.log(`✅ Извлечено имя (очищенное): ${cleanName}`);
            return cleanName;
        }
        
        console.log(`⚠️  Имя не извлечено, используем "Ученик"`);
        return 'Ученик';
    }

    /**
     * Извлечь email из контакта
     */
    extractEmailFromContact(contact) {
        if (!contact.custom_fields_values) {
            return '';
        }
        
        for (const field of contact.custom_fields_values) {
            const fieldName = field.name?.toLowerCase() || '';
            if (fieldName.includes('email') || fieldName.includes('почта') || fieldName.includes('e-mail')) {
                const value = this.extractFieldValue(field);
                if (value && value.includes('@')) {
                    return value;
                }
            }
        }
        
        return '';
    }

    /**
     * Извлечь телефон из контакта
     */
    extractPhoneFromContact(contact) {
        if (!contact.custom_fields_values) {
            return '';
        }
        
        for (const field of contact.custom_fields_values) {
            const fieldName = field.name?.toLowerCase() || '';
            if (fieldName.includes('телефон') || fieldName.includes('phone')) {
                const value = this.extractFieldValue(field);
                if (value) {
                    return value;
                }
            }
        }
        
        return '';
    }

    /**
     * Вспомогательные методы
     */
    formatPhoneNumber(phone) {
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

    parseClassesCount(value) {
        if (!value) return 0;
        
        const str = String(value).toLowerCase();
        
        // Ищем числа в строке
        const patterns = [
            /(\d+)\s*занят/i,
            /^(\d+)$/,
            /всего\s*(\d+)/i,
            /количество\s*(\d+)/i
        ];
        
        for (const pattern of patterns) {
            const match = str.match(pattern);
            if (match && match[1]) {
                const num = parseInt(match[1]);
                if (!isNaN(num) && num > 0) {
                    return num;
                }
            }
        }
        
        // По умолчанию ищем любое число
        const numMatch = str.match(/\d+/);
        if (numMatch) {
            const num = parseInt(numMatch[0]);
            if (!isNaN(num) && num > 0) {
                return num;
            }
        }
        
        return 0;
    }

    parseDateOrTimestamp(value) {
        if (!value) return '';
        
        try {
            const str = String(value).trim();
            
            // Если это timestamp
            if (/^\d+$/.test(str)) {
                const timestamp = parseInt(str);
                const date = timestamp < 10000000000 
                    ? new Date(timestamp * 1000)
                    : new Date(timestamp);
                
                if (!isNaN(date.getTime())) {
                    return date.toISOString().split('T')[0];
                }
            }
            
            // Если это дата в формате DD.MM.YYYY
            if (str.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
                const parts = str.split('.');
                return `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
            
            // Если это дата в формате YYYY-MM-DD
            if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
                return str;
            }
            
            // Пробуем парсить любую дату
            const date = new Date(str);
            if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
            }
            
            return str;
            
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error);
            return value;
        }
    }

    extractFieldValue(field) {
        try {
            if (!field.values || !field.values[0]) {
                return null;
            }
            
            const value = field.values[0];
            
            if (value.value !== undefined && value.value !== null) {
                return value.value.toString();
            }
            
            if (value.enum_id && field.enums) {
                const enumItem = field.enums.find(e => e.id == value.enum_id);
                if (enumItem) {
                    return enumItem.value;
                }
                return value.enum_id.toString();
            }
            
            if (value.enum_code) {
                return value.enum_code;
            }
            
            return null;
            
        } catch (error) {
            console.error('❌ Ошибка извлечения значения поля:', error);
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
        
        const dbPath = path.join(__dirname, 'data', 'art_school.db');
        
        try {
            await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
        } catch (error) {
            // Директория уже существует
        }
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });
        
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        
        console.log('✅ База данных SQLite подключена');
        
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
                
                -- Основная информация ученика
                student_name TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                email TEXT,
                branch TEXT,
                age_group TEXT,
                
                -- Информация о родителе
                parent_name TEXT,
                
                -- Абонемент
                subscription_type TEXT,
                subscription_description TEXT,
                subscription_active INTEGER DEFAULT 0,
                subscription_status TEXT,
                subscription_badge TEXT,
                
                -- Занятия
                total_classes INTEGER DEFAULT 0,
                used_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                progress_percent INTEGER DEFAULT 0,
                
                -- Даты
                activation_date TEXT,
                expiration_date TEXT,
                last_visit_date TEXT,
                days_remaining INTEGER DEFAULT 0,
                
                -- Дополнительно
                is_frozen INTEGER DEFAULT 0,
                subscription_owner TEXT,
                
                -- Технические данные
                raw_contact_data TEXT,
                lead_data TEXT,
                custom_fields TEXT,
                source TEXT DEFAULT 'amocrm',
                last_sync TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                -- Индексы
                UNIQUE(amocrm_lead_id)
            )
        `);
        
        console.log('✅ Таблица student_profiles создана');
        
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(subscription_active)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_sync ON student_profiles(last_sync)');
        
        console.log('✅ Индексы созданы');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};

// ==================== ОСНОВНОЙ API ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '6.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        data_source: 'Актуальные данные из amoCRM'
    });
});

// Основной API: авторизация по телефону и получение абонемента
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
        console.log('='.repeat(60));
        
        // Проверяем подключение к amoCRM
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'Сервис amoCRM не подключен'
            });
        }
        
        // Получаем актуальный абонемент из amoCRM
        const profile = await amoCrmService.getActiveSubscriptionByPhone(phone);
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Активный абонемент не найден',
                message: 'Проверьте номер телефона или обратитесь в администрацию'
            });
        }
        
        // Сохраняем профиль в базу данных
        try {
            // Удаляем старый профиль для этой сделки (если есть)
            await db.run(
                `DELETE FROM student_profiles WHERE amocrm_lead_id = ?`,
                [profile.amocrm_lead_id]
            );
            
            // Вставляем новый профиль
            const columns = [
                'amocrm_contact_id', 'amocrm_lead_id', 'student_name', 'phone_number', 'email',
                'branch', 'age_group', 'parent_name', 'subscription_type', 'subscription_description',
                'subscription_active', 'subscription_status', 'subscription_badge',
                'total_classes', 'used_classes', 'remaining_classes', 'progress_percent',
                'activation_date', 'expiration_date', 'last_visit_date', 'days_remaining',
                'is_frozen', 'subscription_owner', 'raw_contact_data', 'lead_data',
                'custom_fields', 'source', 'last_sync'
            ];
            
            const values = [
                profile.amocrm_contact_id,
                profile.amocrm_lead_id,
                profile.student_name,
                profile.phone_number,
                profile.email,
                profile.branch,
                profile.age_group,
                profile.parent_name,
                profile.subscription_type,
                profile.subscription_description,
                profile.subscription_active,
                profile.subscription_status,
                profile.subscription_badge,
                profile.total_classes,
                profile.used_classes,
                profile.remaining_classes,
                profile.progress_percent,
                profile.activation_date,
                profile.expiration_date,
                profile.last_visit_date,
                profile.days_remaining,
                profile.is_frozen,
                profile.subscription_owner,
                profile.raw_contact_data,
                profile.lead_data,
                profile.custom_fields,
                profile.source,
                profile.last_sync
            ];
            
            const placeholders = columns.map(() => '?').join(', ');
            const columnNames = columns.join(', ');
            
            const result = await db.run(
                `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                values
            );
            
            console.log(`✅ Профиль сохранен в БД с ID: ${result.lastID}`);
            
        } catch (dbError) {
            console.error('⚠️  Ошибка сохранения в БД:', dbError.message);
            // Продолжаем работу, даже если БД не сохранила
        }
        
        // Создаем JWT токен
        const token = jwt.sign(
            {
                phone: profile.phone_number,
                student_name: profile.student_name,
                lead_id: profile.amocrm_lead_id,
                timestamp: new Date().toISOString()
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        // Формируем ответ
        const responseData = {
            success: true,
            message: 'Абонемент найден',
            data: {
                student: {
                    name: profile.student_name,
                    phone: profile.phone_number,
                    email: profile.email,
                    branch: profile.branch,
                    age_group: profile.age_group,
                    parent_name: profile.parent_name
                },
                subscription: {
                    type: profile.subscription_type,
                    description: profile.subscription_description,
                    status: profile.subscription_status,
                    badge: profile.subscription_badge,
                    is_active: profile.subscription_active === 1,
                    is_frozen: profile.is_frozen === 1
                },
                classes: {
                    total: profile.total_classes,
                    used: profile.used_classes,
                    remaining: profile.remaining_classes,
                    progress_percent: profile.progress_percent
                },
                dates: {
                    activation: profile.activation_date,
                    expiration: profile.expiration_date,
                    last_visit: profile.last_visit_date,
                    days_remaining: profile.days_remaining
                },
                metadata: {
                    lead_id: profile.amocrm_lead_id,
                    contact_id: profile.amocrm_contact_id,
                    last_sync: profile.last_sync,
                    data_source: 'amoCRM'
                }
            },
            token: token
        };
        
        console.log('\n✅ Запрос успешно обработан');
        console.log(`📊 Данные отправлены для: ${profile.student_name}`);
        
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Ошибка авторизации:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'Ошибка обработки запроса',
            details: error.message
        });
    }
});

// Получить информацию об абонементе по токену
app.get('/api/subscription', async (req, res) => {
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
        
        // Ищем последний профиль в базе
        const profile = await db.get(
            `SELECT * FROM student_profiles 
             WHERE phone_number = ? 
             ORDER BY last_sync DESC LIMIT 1`,
            [phone]
        );
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        // Формируем ответ
        res.json({
            success: true,
            data: {
                student: {
                    name: profile.student_name,
                    phone: profile.phone_number,
                    email: profile.email,
                    branch: profile.branch,
                    age_group: profile.age_group,
                    parent_name: profile.parent_name
                },
                subscription: {
                    type: profile.subscription_type,
                    description: profile.subscription_description,
                    status: profile.subscription_status,
                    badge: profile.subscription_badge,
                    is_active: profile.subscription_active === 1,
                    is_frozen: profile.is_frozen === 1
                },
                classes: {
                    total: profile.total_classes,
                    used: profile.used_classes,
                    remaining: profile.remaining_classes,
                    progress_percent: profile.progress_percent
                },
                dates: {
                    activation: profile.activation_date,
                    expiration: profile.expiration_date,
                    last_visit: profile.last_visit_date,
                    days_remaining: profile.days_remaining
                },
                metadata: {
                    lead_id: profile.amocrm_lead_id,
                    last_sync: profile.last_sync
                }
            }
        });
        
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Неверный токен'
            });
        }
        
        console.error('❌ Ошибка получения абонемента:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
        });
    }
});

// ==================== ДИАГНОСТИЧЕСКИЕ МАРШРУТЫ ====================

// Полная диагностика
app.get('/api/debug/full-diagnostic/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        console.log(`\n🔍 ПОЛНАЯ ДИАГНОСТИКА ДЛЯ: ${phone}`);
        
        const diagnostic = {
            phone_info: {
                original: phone,
                formatted: amoCrmService.formatPhoneNumber(phone)
            },
            system_status: {
                amocrm_initialized: amoCrmService.isInitialized,
                timestamp: new Date().toISOString()
            },
            amocrm_connection: {},
            search_results: {},
            subscription_info: {}
        };
        
        // Проверка соединения с amoCRM
        if (amoCrmService.isInitialized) {
            try {
                const accountInfo = await amoCrmService.makeRequest('GET', '/api/v4/account');
                diagnostic.amocrm_connection = {
                    connected: true,
                    account_name: accountInfo.name,
                    account_id: accountInfo.id
                };
            } catch (error) {
                diagnostic.amocrm_connection = {
                    connected: false,
                    error: error.message
                };
            }
        }
        
        // Поиск контакта
        try {
            const formattedPhone = amoCrmService.formatPhoneNumber(phone);
            const contact = await amoCrmService.findContactByPhone(formattedPhone);
            
            diagnostic.search_results.contact = contact ? {
                found: true,
                id: contact.id,
                name: contact.name,
                created_at: contact.created_at
            } : {
                found: false
            };
            
            // Если контакт найден, ищем сделки
            if (contact) {
                const leads = await amoCrmService.getContactLeads(contact.id);
                diagnostic.search_results.leads = {
                    count: leads.length,
                    items: leads.map(lead => ({
                        id: lead.id,
                        name: lead.name,
                        status_id: lead.status_id,
                        created_at: lead.created_at
                    }))
                };
                
                // Анализ абонементов
                const subscriptionLeads = [];
                for (const lead of leads) {
                    const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                    if (subscriptionInfo.hasSubscription) {
                        subscriptionLeads.push({
                            lead_id: lead.id,
                            lead_name: lead.name,
                            subscription_info: subscriptionInfo
                        });
                    }
                }
                
                diagnostic.subscription_info = {
                    total_subscriptions: subscriptionLeads.length,
                    subscriptions: subscriptionLeads
                };
            }
        } catch (error) {
            diagnostic.search_results.error = error.message;
        }
        
        // Попытка получить активный абонемент
        try {
            const activeProfile = await amoCrmService.getActiveSubscriptionByPhone(phone);
            diagnostic.active_subscription = activeProfile ? {
                found: true,
                student_name: activeProfile.student_name,
                lead_id: activeProfile.amocrm_lead_id,
                subscription_status: activeProfile.subscription_status,
                total_classes: activeProfile.total_classes,
                remaining_classes: activeProfile.remaining_classes
            } : {
                found: false
            };
        } catch (error) {
            diagnostic.active_subscription = {
                error: error.message
            };
        }
        
        res.json({
            success: true,
            message: 'Диагностика завершена',
            diagnostic: diagnostic
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Проверка конкретной сделки
app.get('/api/debug/lead/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        console.log(`\n🔍 АНАЛИЗ СДЕЛКИ: ${leadId}`);
        
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        // Извлекаем все поля
        const fields = [];
        if (lead.custom_fields_values) {
            lead.custom_fields_values.forEach(field => {
                const value = amoCrmService.extractFieldValue(field);
                fields.push({
                    id: field.field_id || field.id,
                    name: field.name || 'Неизвестно',
                    value: value,
                    raw: field.values || []
                });
            });
        }
        
        // Анализируем абонемент
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        res.json({
            success: true,
            data: {
                lead: {
                    id: lead.id,
                    name: lead.name,
                    status_id: lead.status_id,
                    price: lead.price,
                    created_at: lead.created_at
                },
                subscription_info: subscriptionInfo,
                all_fields: fields,
                field_mapping: amoCrmService.FIELD_IDS
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа сделки:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v6.0');
        console.log('='.repeat(80));
        console.log('✨ НОВАЯ ЛОГИКА: ПОИСК САМОГО СВЕЖЕГО АКТИВНОГО АБОНЕМЕНТА');
        console.log('✨ ИМЯ УЧЕНИКА ИЗ НАЗВАНИЯ СДЕЛКИ');
        console.log('✨ ПРОВЕРКА АКТУАЛЬНОСТИ ПО ДАТАМ И ЗАНЯТИЯМ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const amoCrmInitialized = await amoCrmService.initialize();
        
        if (amoCrmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
        } else {
            console.log('⚠️  amoCRM не подключен. Работа в режиме только БД.');
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 Основной URL: http://localhost:${PORT}`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ API:');
            console.log('='.repeat(60));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус: GET http://localhost:${PORT}/api/status`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`📋 Абонемент: GET http://localhost:${PORT}/api/subscription (с токеном)`);
            console.log('='.repeat(60));
            
            console.log('\n🐛 ДИАГНОСТИКА:');
            console.log('='.repeat(60));
            console.log(`🔍 Диагностика: GET http://localhost:${PORT}/api/debug/full-diagnostic/79175161115`);
            console.log(`📊 Сделка: GET http://localhost:${PORT}/api/debug/lead/28664339`);
            console.log('='.repeat(60));
            
            console.log('\n📞 ТЕСТОВЫЙ ЗАПРОС:');
            console.log('='.repeat(60));
            console.log(`curl -X POST http://localhost:${PORT}/api/auth/phone \\
  -H "Content-Type: application/json" \\
  -d '{"phone": "79175161115"}'`);
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

startServer();
