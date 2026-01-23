// server.js - ПРАВИЛЬНАЯ ВЕРСИЯ ПОИСКА АБОНЕМЕНТОВ
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

// ==================== КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        
        // ВАЖНО: Используем ТОЛЬКО ID из диагностики
        this.FIELD_IDS = {
            LEAD: {
                // Основные поля абонемента
                TOTAL_CLASSES: 850241,        // "Абонемент занятий:" - СЕЛЕКТ
                USED_CLASSES: 850257,         // "Счетчик занятий:" - СЕЛЕКТ
                REMAINING_CLASSES: 890163,    // "Остаток занятий" - ЧИСЛОВОЕ
                EXPIRATION_DATE: 850255,      // "Окончание абонемента:" - ДАТА
                ACTIVATION_DATE: 851565,      // "Дата активации абонемента:" - ДАТА
                LAST_VISIT_DATE: 850259,      // "Дата последнего визита:" - ДАТА
                SUBSCRIPTION_TYPE: 891007,    // "Тип абонемента" - СЕЛЕКТ
                FREEZE: 867693,               // "Заморозка абонемента:" - СЕЛЕКТ
                SUBSCRIPTION_OWNER: 805465,   // "Принадлежность абонемента:" - СЕЛЕКТ
                TECHNICAL_CLASSES: 891819,    // "Количество занятий (тех)" - ЧИСЛОВОЕ
                PRICE_PER_CLASS: 891813,      // "Стоимость 1 занятия" - ЧИСЛОВОЕ
                PURCHASE_DATE: 850253,        // "Дата покупки:" - ДАТА
                BRANCH: 891589                // "Филиал" - СЕЛЕКТ
            },
            CONTACT: {
                CHILD_1_NAME: 867233,         // "!ФИО ребенка:"
                CHILD_2_NAME: 867235,         // "!!ФИО ребенка:"
                CHILD_3_NAME: 867733,         // "!!!ФИО ребенка:"
                BRANCH: 871273,               // "Филиал:" - СЕЛЕКТ
                TEACHER: 888881,              // "Преподаватель" - МУЛЬТИСЕЛЕКТ
                DAY_OF_WEEK: 888879,          // "День недели посещения" - МУЛЬТИСЕЛЕКТ
                HAS_ACTIVE_SUB: 890179,       // "Есть активный абонемент" - ЧЕКБОКС
                LAST_VISIT: 885380,           // "Дата последнего визита" - ДАТА
                AGE_GROUP: 888903,            // "Возраст группы" - МУЛЬТИСЕЛЕКТ
                ALLERGIES: 850239,            // "Аллергия и особенности:"
                EMAIL: 216617,                // "Email" - МУЛЬТИТЕКСТ
                PHONE: 216615,                // "Телефон" - МУЛЬТИТЕКСТ
                LAST_ACTIVATION_DATE: 892185  // "Дата активации последнего абонемента" - ДАТА
            }
        };
    }

    async initialize() {
        try {
            if (this.accessToken) {
                console.log('🔍 Проверка валидности токена...');
                const isValid = await this.checkTokenValidity(this.accessToken);
                this.isInitialized = isValid;
                
                if (isValid) {
                    console.log('✅ amoCRM успешно инициализирован');
                }
                return isValid;
            }
            return false;
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
            }
            throw error;
        }
    }

    async searchContactsByPhone(phoneNumber) {
        console.log(`\n🔍 ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
            return { _embedded: { contacts: [] } };
        }
        
        try {
            let searchPhone;
            if (cleanPhone.length === 11 && cleanPhone.startsWith('7')) {
                searchPhone = `+${cleanPhone}`;
            } else if (cleanPhone.length === 10) {
                searchPhone = `+7${cleanPhone}`;
            } else {
                searchPhone = `+${cleanPhone}`;
            }
            
            console.log(`🔍 Форматированный номер: ${searchPhone}`);
            
            const response = await this.makeRequest(
                'GET', 
                `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=leads`
            );
            
            console.log(`📊 Найдено контактов: ${response._embedded?.contacts?.length || 0}`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    async getContactDetails(contactId) {
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

    async getContactLeads(contactId) {
        try {
            console.log(`🔍 Получение сделок для контакта ${contactId}`);
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&order[created_at]=desc&limit=100`
            );
            
            const leads = response._embedded?.leads || [];
            console.log(`📊 Найдено сделок: ${leads.length}`);
            
            // Логируем все сделки для диагностики
            leads.forEach((lead, index) => {
                console.log(`  ${index + 1}. "${lead.name || 'Без названия'}" (ID: ${lead.id})`);
            });
            
            return leads;
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    // НОВЫЙ МЕТОД: Поиск активного абонемента среди сделок
    findActiveSubscription(leads) {
        console.log(`\n🔍 ПОИСК АКТИВНОГО АБОНЕМЕНТА`);
        
        const now = new Date();
        let activeLead = null;
        let latestExpirationDate = null;
        
        for (const lead of leads) {
            console.log(`\n📋 Анализ сделки: "${lead.name}"`);
            
            // Получаем данные об абонементе
            const subscriptionData = this.extractSubscriptionData(lead);
            
            console.log(`   • Всего занятий: ${subscriptionData.totalClasses || 0}`);
            console.log(`   • Осталось занятий: ${subscriptionData.remainingClasses || 0}`);
            console.log(`   • Дата окончания: ${subscriptionData.expirationDate || 'нет'}`);
            console.log(`   • Дата активации: ${subscriptionData.activationDate || 'нет'}`);
            
            // Проверяем, есть ли абонемент
            if (subscriptionData.totalClasses > 0) {
                // Проверяем не истек ли абонемент
                if (subscriptionData.expirationDate) {
                    const expiration = new Date(subscriptionData.expirationDate);
                    
                    if (expiration >= now) {
                        // Абонемент активен (не истек)
                        console.log(`   ✅ Абонемент НЕ истек`);
                        
                        // Выбираем самый свежий по дате окончания
                        if (!latestExpirationDate || expiration > latestExpirationDate) {
                            latestExpirationDate = expiration;
                            activeLead = lead;
                            console.log(`   🎯 Это самый свежий активный абонемент`);
                        }
                    } else {
                        console.log(`   ❌ Абонемент истек`);
                    }
                } else if (subscriptionData.totalClasses > 0) {
                    // Если нет даты окончания, но есть абонемент - считаем активным
                    console.log(`   ⚠️  Нет даты окончания, но есть абонемент`);
                    
                    if (!activeLead) {
                        activeLead = lead;
                        console.log(`   🎯 Взята сделка с абонементом`);
                    }
                }
            } else {
                console.log(`   ❌ Нет данных об абонементе`);
            }
        }
        
        if (activeLead) {
            console.log(`\n✅ Выбран активный абонемент: "${activeLead.name}"`);
        } else {
            console.log(`\n⚠️  Активный абонемент не найден`);
        }
        
        return activeLead;
    }

    // НОВЫЙ МЕТОД: Извлечение точных данных об абонементе
    extractSubscriptionData(lead) {
        const data = {
            totalClasses: 0,
            usedClasses: 0,
            remainingClasses: 0,
            expirationDate: null,
            activationDate: null,
            lastVisitDate: null,
            subscriptionType: '',
            isFrozen: false,
            branch: '',
            teacher: ''
        };
        
        if (!lead || !lead.custom_fields_values) {
            return data;
        }
        
        console.log(`\n📊 Анализ полей сделки ID: ${lead.id}`);
        
        // Проходим по ВСЕМ полям и выводим их для диагностики
        lead.custom_fields_values.forEach(field => {
            const fieldId = field.field_id || field.id;
            const fieldName = this.getFieldNameById(fieldId);
            const fieldValue = this.getFieldValue(field);
            
            console.log(`   📋 Поле ${fieldId} (${fieldName}): ${fieldValue}`);
        });
        
        // Теперь извлекаем конкретные данные
        lead.custom_fields_values.forEach(field => {
            const fieldId = field.field_id || field.id;
            const fieldValue = this.getFieldValue(field);
            
            if (!fieldValue) return;
            
            switch (fieldId) {
                // ОБЩЕЕ КОЛИЧЕСТВО ЗАНЯТИЙ (из селекта)
                case this.FIELD_IDS.LEAD.TOTAL_CLASSES:
                    data.totalClasses = this.parseClassCountFromSelect(fieldValue);
                    break;
                    
                // ТЕХНИЧЕСКОЕ КОЛИЧЕСТВО ЗАНЯТИЙ (числовое поле)
                case this.FIELD_IDS.LEAD.TECHNICAL_CLASSES:
                    const techClasses = parseInt(fieldValue);
                    if (techClasses > 0) {
                        data.totalClasses = techClasses;
                    }
                    break;
                    
                // СЧЕТЧИК ЗАНЯТИЙ (из селекта)
                case this.FIELD_IDS.LEAD.USED_CLASSES:
                    data.usedClasses = this.parseUsedClasses(fieldValue);
                    break;
                    
                // ОСТАТОК ЗАНЯТИЙ (числовое поле)
                case this.FIELD_IDS.LEAD.REMAINING_CLASSES:
                    data.remainingClasses = parseInt(fieldValue) || 0;
                    break;
                    
                // ДАТА ОКОНЧАНИЯ
                case this.FIELD_IDS.LEAD.EXPIRATION_DATE:
                    data.expirationDate = this.parseDate(fieldValue);
                    break;
                    
                // ДАТА АКТИВАЦИИ
                case this.FIELD_IDS.LEAD.ACTIVATION_DATE:
                    data.activationDate = this.parseDate(fieldValue);
                    break;
                    
                // ДАТА ПОСЛЕДНЕГО ВИЗИТА
                case this.FIELD_IDS.LEAD.LAST_VISIT_DATE:
                    data.lastVisitDate = this.parseDate(fieldValue);
                    break;
                    
                // ТИП АБОНЕМЕНТА
                case this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE:
                    data.subscriptionType = fieldValue;
                    break;
                    
                // ЗАМОРОЗКА
                case this.FIELD_IDS.LEAD.FREEZE:
                    data.isFrozen = fieldValue === 'ДА' || fieldValue === '1';
                    break;
                    
                // ФИЛИАЛ
                case this.FIELD_IDS.LEAD.BRANCH:
                    data.branch = fieldValue;
                    break;
            }
        });
        
        // Если остаток не указан, но есть общее количество и счетчик - вычисляем
        if (data.remainingClasses === 0 && data.totalClasses > 0 && data.usedClasses > 0) {
            data.remainingClasses = Math.max(0, data.totalClasses - data.usedClasses);
        }
        
        // Если счетчик не указан, но есть общее количество и остаток - вычисляем
        if (data.usedClasses === 0 && data.totalClasses > 0 && data.remainingClasses > 0) {
            data.usedClasses = Math.max(0, data.totalClasses - data.remainingClasses);
        }
        
        console.log(`\n📊 ИТОГОВЫЕ ДАННЫЕ:`);
        console.log(`   • Всего занятий: ${data.totalClasses}`);
        console.log(`   • Использовано: ${data.usedClasses}`);
        console.log(`   • Осталось: ${data.remainingClasses}`);
        console.log(`   • Дата окончания: ${data.expirationDate || 'не указана'}`);
        console.log(`   • Дата активации: ${data.activationDate || 'не указана'}`);
        
        return data;
    }

    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    getFieldNameById(fieldId) {
        // Ищем в LEAD полях
        for (const [key, value] of Object.entries(this.FIELD_IDS.LEAD)) {
            if (value === fieldId) return key;
        }
        // Ищем в CONTACT полях
        for (const [key, value] of Object.entries(this.FIELD_IDS.CONTACT)) {
            if (value === fieldId) return key;
        }
        return `Поле ${fieldId}`;
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

    parseClassCountFromSelect(value) {
        if (!value) return 0;
        
        const strValue = String(value).toLowerCase();
        
        // Парсим значения из селекта "Абонемент занятий:"
        if (strValue.includes('4') && strValue.includes('занят')) return 4;
        if (strValue.includes('8') && strValue.includes('занят')) return 8;
        if (strValue.includes('16') && strValue.includes('занят')) return 16;
        if (strValue.includes('24') && strValue.includes('занят')) return 24;
        if (strValue.includes('2') && strValue.includes('занят')) return 2;
        if (strValue.includes('3') && strValue.includes('занят')) return 3;
        if (strValue.includes('5') && strValue.includes('занят')) return 5;
        if (strValue.includes('6') && strValue.includes('занят')) return 6;
        
        // Ищем любое число
        const match = strValue.match(/\d+/);
        if (match) {
            const num = parseInt(match[0]);
            if (num >= 1 && num <= 24) return num;
        }
        
        return 0;
    }

    parseUsedClasses(value) {
        if (!value) return 0;
        
        // Поле "Счетчик занятий:" имеет значения 1-24
        const num = parseInt(value);
        if (!isNaN(num) && num >= 1 && num <= 24) {
            return num;
        }
        
        return 0;
    }

    parseDate(value) {
        if (!value) return null;
        
        try {
            const str = String(value).trim();
            
            // Если это timestamp
            if (/^\d+$/.test(str)) {
                const timestamp = parseInt(str);
                const date = timestamp < 10000000000 
                    ? new Date(timestamp * 1000)
                    : new Date(timestamp);
                return date.toISOString().split('T')[0];
            }
            
            // Если это дата в формате YYYY-MM-DD
            if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
                return str;
            }
            
            // Если это дата в формате DD.MM.YYYY
            if (str.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
                const parts = str.split('.');
                const day = parts[0].padStart(2, '0');
                const month = parts[1].padStart(2, '0');
                const year = parts[2];
                return `${year}-${month}-${day}`;
            }
            
            return str;
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error);
            return null;
        }
    }

    // ГЛАВНЫЙ МЕТОД: Получение данных по телефону
    async getStudentDataByPhone(phoneNumber) {
        console.log(`\n🎯 ПОЛУЧЕНИЕ ДАННЫХ ДЛЯ ТЕЛЕФОНА: ${phoneNumber}`);
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return [];
        }
        
        try {
            // 1. Ищем контакты по телефону
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            if (contacts.length === 0) {
                console.log('❌ Контакты не найдены');
                return [];
            }
            
            const profiles = [];
            
            // 2. Для каждого контакта
            for (const contact of contacts) {
                console.log(`\n👤 Анализ контакта: ${contact.name} (ID: ${contact.id})`);
                
                // 3. Получаем детали контакта
                const contactDetails = await this.getContactDetails(contact.id);
                if (!contactDetails) continue;
                
                // 4. Получаем ВСЕ сделки контакта
                const leads = await this.getContactLeads(contact.id);
                
                // 5. Находим АКТИВНЫЙ абонемент
                const activeLead = this.findActiveSubscription(leads);
                
                if (activeLead) {
                    // 6. Извлекаем ТОЧНЫЕ данные об абонементе
                    const subscriptionData = this.extractSubscriptionData(activeLead);
                    
                    // 7. Извлекаем данные ученика из контакта
                    const studentData = this.extractStudentFromContact(contactDetails);
                    
                    // 8. Создаем профиль
                    const profile = this.createStudentProfile(
                        phoneNumber,
                        contactDetails,
                        studentData,
                        activeLead,
                        subscriptionData
                    );
                    
                    profiles.push(profile);
                    console.log(`✅ Профиль создан: ${studentData.studentName}`);
                } else {
                    console.log(`⚠️  У контакта "${contact.name}" нет активного абонемента`);
                }
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${profiles.length}`);
            return profiles;
            
        } catch (error) {
            console.error('❌ Ошибка получения данных:', error.message);
            return [];
        }
    }

    extractStudentFromContact(contact) {
        const student = {
            studentName: contact.name || 'Ученик',
            birthDate: '',
            branch: '',
            teacher: '',
            dayOfWeek: '',
            ageGroup: '',
            allergies: '',
            email: '',
            parentName: contact.name || ''
        };
        
        if (!contact.custom_fields_values) return student;
        
        contact.custom_fields_values.forEach(field => {
            const fieldId = field.field_id || field.id;
            const fieldValue = this.getFieldValue(field);
            
            if (!fieldValue) return;
            
            switch (fieldId) {
                // ФИЛИАЛ
                case this.FIELD_IDS.CONTACT.BRANCH:
                    student.branch = fieldValue;
                    break;
                    
                // ПРЕПОДАВАТЕЛЬ
                case this.FIELD_IDS.CONTACT.TEACHER:
                    student.teacher = fieldValue;
                    break;
                    
                // ДЕНЬ НЕДЕЛИ
                case this.FIELD_IDS.CONTACT.DAY_OF_WEEK:
                    student.dayOfWeek = fieldValue;
                    break;
                    
                // ВОЗРАСТНАЯ ГРУППА
                case this.FIELD_IDS.CONTACT.AGE_GROUP:
                    student.ageGroup = fieldValue;
                    break;
                    
                // АЛЛЕРГИИ
                case this.FIELD_IDS.CONTACT.ALLERGIES:
                    student.allergies = fieldValue;
                    break;
                    
                // EMAIL
                case this.FIELD_IDS.CONTACT.EMAIL:
                    student.email = fieldValue;
                    break;
                    
                // ИМЕНА ДЕТЕЙ (приоритет для имени ученика)
                case this.FIELD_IDS.CONTACT.CHILD_1_NAME:
                case this.FIELD_IDS.CONTACT.CHILD_2_NAME:
                case this.FIELD_IDS.CONTACT.CHILD_3_NAME:
                    if (fieldValue && fieldValue.trim() !== '') {
                        student.studentName = fieldValue.trim();
                    }
                    break;
            }
        });
        
        return student;
    }

    createStudentProfile(phone, contact, student, lead, subscription) {
        // Форматируем даты для отображения
        const formatDate = (dateStr) => {
            if (!dateStr) return '';
            try {
                const date = new Date(dateStr);
                return date.toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                });
            } catch (error) {
                return dateStr;
            }
        };
        
        // Определяем статус абонемента
        let status = 'Нет абонемента';
        let badge = 'inactive';
        let isActive = false;
        
        if (subscription.totalClasses > 0) {
            if (subscription.isFrozen) {
                status = 'Заморожен';
                badge = 'frozen';
            } else if (subscription.expirationDate) {
                const expiration = new Date(subscription.expirationDate);
                const now = new Date();
                
                if (expiration < now) {
                    status = 'Истек';
                    badge = 'expired';
                } else if (subscription.remainingClasses > 0) {
                    status = `Активный (осталось ${subscription.remainingClasses}/${subscription.totalClasses})`;
                    badge = 'active';
                    isActive = true;
                } else {
                    status = 'Занятия закончились';
                    badge = 'expired';
                }
            } else if (subscription.remainingClasses > 0) {
                status = `Активный (осталось ${subscription.remainingClasses}/${subscription.totalClasses})`;
                badge = 'active';
                isActive = true;
            } else {
                status = `Абонемент на ${subscription.totalClasses} занятий`;
                badge = 'has_subscription';
                isActive = true;
            }
        }
        
        // Расчет прогресса
        let progress = 0;
        if (subscription.totalClasses > 0) {
            progress = Math.round((subscription.usedClasses / subscription.totalClasses) * 100);
        }
        
        return {
            // Основная информация
            amocrm_contact_id: contact.id,
            amocrm_lead_id: lead.id,
            student_name: student.studentName,
            phone_number: phone,
            email: student.email,
            birth_date: student.birthDate,
            branch: subscription.branch || student.branch,
            parent_name: student.parentName,
            
            // Расписание
            day_of_week: student.dayOfWeek,
            teacher_name: student.teacher,
            age_group: student.ageGroup,
            allergies: student.allergies,
            
            // Абонемент
            subscription_type: subscription.subscriptionType,
            subscription_active: isActive ? 1 : 0,
            subscription_status: status,
            subscription_badge: badge,
            total_classes: subscription.totalClasses,
            used_classes: subscription.usedClasses,
            remaining_classes: subscription.remainingClasses,
            expiration_date: subscription.expirationDate,
            activation_date: subscription.activationDate,
            last_visit_date: subscription.lastVisitDate,
            is_frozen: subscription.isFrozen ? 1 : 0,
            
            // Форматированные даты
            expiration_date_display: formatDate(subscription.expirationDate),
            activation_date_display: formatDate(subscription.activationDate),
            last_visit_date_display: formatDate(subscription.lastVisitDate),
            
            // Технические данные
            progress_percentage: progress,
            source: 'amocrm',
            is_active: 1,
            last_sync: new Date().toISOString()
        };
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

        console.log('✅ База данных SQLite подключена');
        
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        
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
                parent_name TEXT,
                
                day_of_week TEXT,
                teacher_name TEXT,
                age_group TEXT,
                allergies TEXT,
                
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
                is_frozen INTEGER DEFAULT 0,
                
                expiration_date_display TEXT,
                activation_date_display TEXT,
                last_visit_date_display TEXT,
                
                progress_percentage INTEGER DEFAULT 0,
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
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(subscription_active)');
        
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
                // Проверяем существует ли профиль
                const existingProfile = await db.get(
                    `SELECT id FROM student_profiles 
                     WHERE student_name = ? AND phone_number = ?`,
                    [profile.student_name, profile.phone_number]
                );
                
                if (!existingProfile) {
                    // Вставка нового профиля
                    const result = await db.run(
                        `INSERT INTO student_profiles (
                            amocrm_contact_id, amocrm_lead_id, student_name, phone_number, email,
                            birth_date, branch, parent_name, day_of_week, teacher_name,
                            age_group, allergies, subscription_type, subscription_active,
                            subscription_status, subscription_badge, total_classes, used_classes,
                            remaining_classes, expiration_date, activation_date, last_visit_date,
                            is_frozen, expiration_date_display, activation_date_display,
                            last_visit_date_display, progress_percentage, source, is_active, last_sync
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            profile.amocrm_contact_id,
                            profile.amocrm_lead_id,
                            profile.student_name,
                            profile.phone_number,
                            profile.email || '',
                            profile.birth_date || '',
                            profile.branch || '',
                            profile.parent_name || '',
                            profile.day_of_week || '',
                            profile.teacher_name || '',
                            profile.age_group || '',
                            profile.allergies || '',
                            profile.subscription_type || '',
                            profile.subscription_active || 0,
                            profile.subscription_status || '',
                            profile.subscription_badge || 'inactive',
                            profile.total_classes || 0,
                            profile.used_classes || 0,
                            profile.remaining_classes || 0,
                            profile.expiration_date || null,
                            profile.activation_date || null,
                            profile.last_visit_date || null,
                            profile.is_frozen || 0,
                            profile.expiration_date_display || '',
                            profile.activation_date_display || '',
                            profile.last_visit_date_display || '',
                            profile.progress_percentage || 0,
                            profile.source || 'amocrm',
                            1,
                            new Date().toISOString()
                        ]
                    );
                    
                    console.log(`✅ Профиль создан (ID: ${result.lastID}): ${profile.student_name}`);
                    savedCount++;
                } else {
                    // Обновление существующего профиля
                    await db.run(
                        `UPDATE student_profiles SET
                            amocrm_contact_id = ?, amocrm_lead_id = ?, email = ?, branch = ?,
                            parent_name = ?, day_of_week = ?, teacher_name = ?, age_group = ?,
                            allergies = ?, subscription_type = ?, subscription_active = ?,
                            subscription_status = ?, subscription_badge = ?, total_classes = ?,
                            used_classes = ?, remaining_classes = ?, expiration_date = ?,
                            activation_date = ?, last_visit_date = ?, is_frozen = ?,
                            expiration_date_display = ?, activation_date_display = ?,
                            last_visit_date_display = ?, progress_percentage = ?,
                            source = ?, is_active = ?, last_sync = ?, updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        [
                            profile.amocrm_contact_id,
                            profile.amocrm_lead_id,
                            profile.email || '',
                            profile.branch || '',
                            profile.parent_name || '',
                            profile.day_of_week || '',
                            profile.teacher_name || '',
                            profile.age_group || '',
                            profile.allergies || '',
                            profile.subscription_type || '',
                            profile.subscription_active || 0,
                            profile.subscription_status || '',
                            profile.subscription_badge || 'inactive',
                            profile.total_classes || 0,
                            profile.used_classes || 0,
                            profile.remaining_classes || 0,
                            profile.expiration_date || null,
                            profile.activation_date || null,
                            profile.last_visit_date || null,
                            profile.is_frozen || 0,
                            profile.expiration_date_display || '',
                            profile.activation_date_display || '',
                            profile.last_visit_date_display || '',
                            profile.progress_percentage || 0,
                            profile.source || 'amocrm',
                            1,
                            new Date().toISOString(),
                            existingProfile.id
                        ]
                    );
                    
                    console.log(`✅ Профиль обновлен (ID: ${existingProfile.id}): ${profile.student_name}`);
                    savedCount++;
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка профиля ${profile.student_name}:`, profileError.message);
            }
        }
        
        console.log(`✅ Всего сохранено: ${savedCount} профилей`);
        return savedCount;
    } catch (error) {
        console.error(`❌ Общая ошибка сохранения: ${error.message}`);
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
        data_source: 'Точные данные из amoCRM'
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
        console.log(`📱 Форматированный: ${formattedPhone}`);
        
        let profiles = [];
        
        // Получаем данные из amoCRM
        if (amoCrmService.isInitialized) {
            console.log('🔍 Получение данных из amoCRM...');
            profiles = await amoCrmService.getStudentDataByPhone(formattedPhone);
            console.log(`📊 Найдено в amoCRM: ${profiles.length}`);
            
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
        
        // Если не нашли в amoCRM, ищем в локальной базе
        if (profiles.length === 0) {
            console.log('🔍 Поиск в локальной базе...');
            const cleanPhone = phone.replace(/\D/g, '');
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY subscription_active DESC, updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            console.log(`📊 Найдено в БД: ${profiles.length}`);
        }
        
        // Форматируем ответ
        const responseProfiles = profiles.map(p => ({
            id: p.id,
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
            expiration_date_display: p.expiration_date_display,
            activation_date_display: p.activation_date_display,
            last_visit_date_display: p.last_visit_date_display,
            parent_name: p.parent_name,
            progress_percentage: p.progress_percentage,
            last_sync: p.last_sync
        }));
        
        const hasMultipleStudents = profiles.length > 1;
        
        // Создаем JWT токен
        const token = jwt.sign(
            {
                phone: formattedPhone,
                profiles_count: profiles.length,
                amocrm_connected: amoCrmService.isInitialized
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        const responseData = {
            success: true,
            message: profiles.length > 0 ? 'Найдены профили' : 'Профили не найдены',
            data: {
                profiles: responseProfiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                has_multiple_students: hasMultipleStudents,
                token: token,
                last_sync: profiles.length > 0 ? profiles[0].last_sync : null
            }
        };
        
        console.log(`✅ Авторизация успешна`);
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
        }
        
        if (!profile && phone) {
            const cleanPhone = phone.replace(/\D/g, '').slice(-10);
            profile = await db.get(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND subscription_active = 1 
                 ORDER BY updated_at DESC LIMIT 1`,
                [`%${cleanPhone}%`]
            );
        }
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        console.log(`✅ Найден профиль: ${profile.student_name}`);
        
        // Проверяем, не истек ли абонемент
        const now = new Date();
        let isActuallyActive = profile.subscription_active === 1;
        
        if (profile.expiration_date) {
            const expiration = new Date(profile.expiration_date);
            if (expiration < now) {
                isActuallyActive = false;
                console.log(`⚠️  Абонемент истек ${profile.expiration_date}`);
            }
        }
        
        // Расчет прогресса
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
                    teacher_name: profile.teacher_name,
                    parent_name: profile.parent_name
                },
                
                subscription: {
                    type: profile.subscription_type,
                    status: profile.subscription_status,
                    badge: profile.subscription_badge,
                    is_active: isActuallyActive,
                    is_frozen: profile.is_frozen === 1,
                    
                    classes: {
                        total: profile.total_classes,
                        used: profile.used_classes,
                        remaining: profile.remaining_classes,
                        progress: progress
                    },
                    
                    dates: {
                        activation: profile.activation_date,
                        activation_display: profile.activation_date_display,
                        expiration: profile.expiration_date,
                        expiration_display: profile.expiration_date_display,
                        last_visit: profile.last_visit_date,
                        last_visit_display: profile.last_visit_date_display
                    }
                },
                
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
            error: 'Ошибка получения информации'
        });
    }
});

// ==================== ДИАГНОСТИЧЕСКИЙ API ====================
app.get('/api/debug/phone/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n📱 ДИАГНОСТИКА ТЕЛЕФОНА: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован',
                phone: phone
            });
        }
        
        // Получаем данные через основной метод
        const profiles = await amoCrmService.getStudentDataByPhone(phone);
        
        res.json({
            success: true,
            message: 'Диагностика выполнена',
            phone: phone,
            profiles_found: profiles.length,
            profiles: profiles,
            system_status: {
                amocrm_connected: amoCrmService.isInitialized,
                field_ids: amoCrmService.FIELD_IDS
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка диагностики',
            error: error.message
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('='.repeat(80));
        console.log('✨ ТОЧНЫЙ ПОИСК АБОНЕМЕНТОВ');
        console.log('✨ ПРАВИЛЬНОЕ ОПРЕДЕЛЕНИЕ АКТИВНОГО АБОНЕМЕНТА');
        console.log('✨ КОРРЕКТНЫЙ РАСЧЕТ ОСТАТКА ЗАНЯТИЙ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован');
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
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`📋 Абонемент: POST http://localhost:${PORT}/api/subscription`);
            console.log(`🔍 Диагностика: GET http://localhost:${PORT}/api/debug/phone/79175161115`);
            console.log(`📊 Статус: GET http://localhost:${PORT}/api/status`);
            console.log('='.repeat(50));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

startServer();
