// server.js - версия с улучшенным парсингом данных из amoCRM
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
        console.log('🔄 СОЗДАНИЕ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.clientId = AMOCRM_CLIENT_ID;
        this.clientSecret = AMOCRM_CLIENT_SECRET;
        this.redirectUri = AMOCRM_REDIRECT_URI;
        this.isInitialized = false;
        this.fieldMapping = {}; // Карта полей для парсинга
    }

    async initialize() {
        try {
            if (this.accessToken) {
                console.log('🔍 Проверка валидности токена...');
                const isValid = await this.checkTokenValidity(this.accessToken);
                this.isInitialized = isValid;
                
                if (isValid) {
                    await this.loadCustomFieldsMapping();
                }
                
                return isValid;
            }
            return false;
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            return false;
        }
    }

    async loadCustomFieldsMapping() {
        try {
            console.log('📊 Загрузка карты кастомных полей...');
            
            // Загружаем поля контактов
            const contactFields = await this.makeRequest(
                'GET',
                '/api/v4/contacts/custom_fields'
            );
            
            // Загружаем поля сделок
            const leadFields = await this.makeRequest(
                'GET',
                '/api/v4/leads/custom_fields'
            );
            
            // Загружаем поля покупателей
            const customerFields = await this.makeRequest(
                'GET',
                '/api/v4/customers/custom_fields'
            );
            
            this.fieldMapping = {
                contacts: this.parseFields(contactFields?._embedded?.custom_fields || []),
                leads: this.parseFields(leadFields?._embedded?.custom_fields || []),
                customers: this.parseFields(customerFields?._embedded?.custom_fields || [])
            };
            
            console.log('✅ Карта полей загружена');
            
        } catch (error) {
            console.error('❌ Ошибка загрузки карты полей:', error.message);
        }
    }

    parseFields(fields) {
        const mapping = {};
        for (const field of fields) {
            mapping[field.id] = {
                name: field.name,
                type: field.type,
                code: field.code
            };
        }
        return mapping;
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
            console.log(`📊 Аккаунт: ${response.data.name}`);
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
            console.error(`❌ Ошибка запроса: ${error.message}`);
            throw error;
        }
    }

    async searchContactsByPhone(phoneNumber) {
        console.log(`\n🔍 ПОИСК КОНТАКТОВ: ${phoneNumber}`);
        
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
            
            console.log(`🔍 Поиск телефона: ${searchPhone}`);
            
            // Ищем контакты с телефоном
            const contactsResponse = await this.makeRequest(
                'GET', 
                `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=custom_fields_values,leads,customers`
            );
            
            return contactsResponse;
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    async getContactEntities(contactId) {
        try {
            console.log(`📊 Получение сущностей контакта ${contactId}...`);
            
            // Получаем сделки контакта
            const leadsResponse = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}`
            );
            
            // Получаем покупателей контакта
            const customersResponse = await this.makeRequest(
                'GET',
                `/api/v4/customers?with=custom_fields_values&filter[contact_id]=${contactId}`
            );
            
            const leads = leadsResponse._embedded?.leads || [];
            const customers = customersResponse._embedded?.customers || [];
            
            console.log(`📊 Найдено сделок: ${leads.length}, покупателей: ${customers.length}`);
            
            return { leads, customers };
            
        } catch (error) {
            console.error(`❌ Ошибка получения сущностей: ${error.message}`);
            return { leads: [], customers: [] };
        }
    }

    // Основной метод для поиска учеников по телефону родителя
    async getStudentsByPhone(phoneNumber) {
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            console.log(`\n🔍 Поиск учеников по телефону родителя: ${phoneNumber}`);
            
            // 1. Ищем контакты (родителей) с этим телефоном
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const parentContacts = contactsResponse._embedded?.contacts || [];
            
            console.log(`📊 Найдено контактов-родителей: ${parentContacts.length}`);
            
            // Для каждого найденного контакта-родителя
            for (const parentContact of parentContacts) {
                console.log(`\n👤 Родитель: ${parentContact.name || 'Без имени'} (ID: ${parentContact.id})`);
                
                try {
                    // 2. Получаем все сущности контакта
                    const { leads, customers } = await this.getContactEntities(parentContact.id);
                    
                    // 3. Анализируем каждую сделку на наличие информации об учениках
                    for (const lead of leads) {
                        const studentInfo = this.extractStudentInfoFromLead(lead);
                        if (studentInfo.hasStudent) {
                            const profile = this.createStudentProfile(
                                parentContact, 
                                phoneNumber, 
                                studentInfo,
                                'lead'
                            );
                            studentProfiles.push(profile);
                        }
                    }
                    
                    // 4. Анализируем каждого покупателя
                    for (const customer of customers) {
                        const studentInfo = this.extractStudentInfoFromCustomer(customer);
                        if (studentInfo.hasStudent) {
                            const profile = this.createStudentProfile(
                                parentContact, 
                                phoneNumber, 
                                studentInfo,
                                'customer'
                            );
                            studentProfiles.push(profile);
                        }
                    }
                    
                } catch (contactError) {
                    console.error(`❌ Ошибка обработки контакта: ${contactError.message}`);
                }
            }
            
            console.log(`\n🎯 ИТОГО найдено учеников: ${studentProfiles.length}`);
            
        } catch (crmError) {
            console.error(`❌ Ошибка поиска в amoCRM: ${crmError.message}`);
        }
        
        return studentProfiles;
    }

    // Метод для извлечения информации об ученике из сделки
    extractStudentInfoFromLead(lead) {
        const result = {
            hasStudent: false,
            studentName: '',
            leadId: lead.id,
            leadName: lead.name || '',
            status: '',
            
            // Данные об абонементе
            hasSubscription: false,
            subscriptionType: '',
            subscriptionStatus: '',
            totalClasses: 0,
            remainingClasses: 0,
            usedClasses: 0,
            expirationDate: '',
            activationDate: '',
            lastVisitDate: '',
            
            // Расписание
            branch: '',
            teacherName: '',
            dayOfWeek: '',
            timeSlot: '',
            
            // Дополнительно
            birthDate: '',
            ageGroup: '',
            purchaseDate: '',
            amount: 0,
            certificateNumber: '',
            comment: '',
            
            // Статусы
            subscriptionActive: false,
            certificateSent: false,
            messagesEnabled: true,
            
            rawFields: lead.custom_fields_values || []
        };
        
        console.log(`🔍 Анализ сделки: ${lead.name || 'Без названия'} (ID: ${lead.id})`);
        
        // Парсим название сделки для имени ученика
        if (lead.name) {
            const nameMatch = lead.name.match(/^([^-]+)/);
            if (nameMatch) {
                result.studentName = nameMatch[1].trim();
                result.hasStudent = true;
                console.log(`✅ Имя ученика из названия: ${result.studentName}`);
            }
        }
        
        // Парсим кастомные поля
        this.parseCustomFieldsForLead(lead.custom_fields_values || [], result);
        
        // Дополнительный анализ
        this.analyzeLeadData(result);
        
        return result;
    }

    // Метод для извлечения информации об ученике из покупателя
    extractStudentInfoFromCustomer(customer) {
        const result = {
            hasStudent: false,
            studentName: '',
            customerId: customer.id,
            customerName: customer.name || '',
            
            // Данные об абонементе
            hasSubscription: false,
            subscriptionType: '',
            subscriptionStatus: '',
            totalClasses: 0,
            remainingClasses: 0,
            usedClasses: 0,
            expirationDate: '',
            activationDate: '',
            lastVisitDate: '',
            
            // Расписание
            branch: '',
            teacherName: '',
            dayOfWeek: '',
            timeSlot: '',
            
            // Дополнительно
            birthDate: '',
            ageGroup: '',
            
            rawFields: customer.custom_fields_values || []
        };
        
        console.log(`🔍 Анализ покупателя: ${customer.name || 'Без названия'} (ID: ${customer.id})`);
        
        // Парсим название
        if (customer.name) {
            const nameMatch = customer.name.match(/^([^-]+)/);
            if (nameMatch) {
                result.studentName = nameMatch[1].trim();
                result.hasStudent = true;
                console.log(`✅ Имя ученика из названия: ${result.studentName}`);
            }
        }
        
        // Парсим кастомные поля покупателя
        this.parseCustomFieldsForCustomer(customer.custom_fields_values || [], result);
        
        return result;
    }

    // Парсинг кастомных полей сделки
    parseCustomFieldsForLead(fields, result) {
        for (const field of fields) {
            const fieldName = (field.field_name || '').toLowerCase();
            const fieldValue = field.values?.[0]?.value || field.values?.[0]?.enum_value || '';
            const fieldId = field.field_id;
            
            // Получаем название поля из маппинга
            let mappedFieldName = fieldName;
            if (this.fieldMapping.leads && this.fieldMapping.leads[fieldId]) {
                mappedFieldName = this.fieldMapping.leads[fieldId].name.toLowerCase();
            }
            
            // Анализируем поле
            this.analyzeField(mappedFieldName, fieldValue, result);
        }
    }

    // Парсинг кастомных полей покупателя
    parseCustomFieldsForCustomer(fields, result) {
        for (const field of fields) {
            const fieldName = (field.field_name || '').toLowerCase();
            const fieldValue = field.values?.[0]?.value || field.values?.[0]?.enum_value || '';
            const fieldId = field.field_id;
            
            // Получаем название поля из маппинга
            let mappedFieldName = fieldName;
            if (this.fieldMapping.customers && this.fieldMapping.customers[fieldId]) {
                mappedFieldName = this.fieldMapping.customers[fieldId].name.toLowerCase();
            }
            
            // Анализируем поле
            this.analyzeField(mappedFieldName, fieldValue, result);
        }
    }

    // Анализ поля по его названию
    analyzeField(fieldName, fieldValue, result) {
        // Имя ученика
        if (!result.studentName && (
            fieldName.includes('ребенк') || 
            fieldName.includes('ученик') || 
            fieldName.includes('фио ребен') ||
            fieldName.includes('имя ребен') ||
            (fieldName.includes('фио') && !fieldName.includes('родител'))
        )) {
            if (fieldValue && fieldValue.trim() !== '') {
                result.studentName = fieldValue;
                result.hasStudent = true;
            }
        }
        
        // Абонемент занятий
        if (fieldName.includes('абонемент занятий') || fieldName.includes('количество занятий')) {
            const match = fieldValue.match(/(\d+)/);
            if (match) {
                result.totalClasses = parseInt(match[1]);
                result.hasSubscription = true;
            }
        }
        
        // Счетчик занятий
        if (fieldName.includes('счетчик занятий') || fieldName.includes('использовано')) {
            result.usedClasses = parseInt(fieldValue) || 0;
            result.hasSubscription = true;
        }
        
        // Остаток занятий
        if (fieldName.includes('остаток занятий') || fieldName.includes('осталось')) {
            result.remainingClasses = parseInt(fieldValue) || 0;
            result.hasSubscription = true;
        }
        
        // Тип абонемента
        if (fieldName.includes('тип абонемента')) {
            result.subscriptionType = fieldValue;
            result.hasSubscription = true;
        }
        
        // Статус абонемента
        if (fieldName.includes('активный абонемент') || fieldName.includes('статус абонемента')) {
            result.subscriptionStatus = fieldValue;
            result.subscriptionActive = fieldValue === 'Активный' || 
                                       fieldValue === 'Активирован' ||
                                       fieldValue === 'активен' ||
                                       fieldValue === 'true' ||
                                       fieldValue === '1';
        }
        
        // Даты
        if (fieldName.includes('дата активации')) {
            result.activationDate = fieldValue;
        }
        
        if (fieldName.includes('окончание') || fieldName.includes('срок действия')) {
            result.expirationDate = fieldValue;
        }
        
        if (fieldName.includes('последний визит') || fieldName.includes('дата последнего визита')) {
            result.lastVisitDate = fieldValue;
        }
        
        if (fieldName.includes('дата покупки')) {
            result.purchaseDate = fieldValue;
        }
        
        // Филиал
        if (fieldName.includes('филиал')) {
            result.branch = fieldValue;
        }
        
        // Преподаватель
        if (fieldName.includes('преподаватель')) {
            result.teacherName = fieldValue;
        }
        
        // День недели
        if (fieldName.includes('день недели')) {
            result.dayOfWeek = fieldValue;
        }
        
        // Время занятия
        if (fieldName.includes('время занятия')) {
            result.timeSlot = fieldValue;
        }
        
        // День рождения
        if (fieldName.includes('день рождения')) {
            result.birthDate = fieldValue;
        }
        
        // Возрастная группа
        if (fieldName.includes('возраст') || fieldName.includes('возрастная')) {
            result.ageGroup = fieldValue;
        }
        
        // Сумма
        if (fieldName.includes('сумма') || fieldName.includes('бюджет')) {
            const amountMatch = fieldValue.replace(/\s/g, '').match(/(\d+)/);
            if (amountMatch) {
                result.amount = parseInt(amountMatch[1]);
            }
        }
        
        // Номер сертификата
        if (fieldName.includes('номер сертификата') || fieldName.includes('сертификат')) {
            result.certificateNumber = fieldValue;
        }
        
        // Комментарий
        if (fieldName.includes('комментарий')) {
            result.comment = fieldValue;
        }
        
        // Отправка сообщений
        if (fieldName.includes('сообщени') || fieldName.includes('рассылка')) {
            result.messagesEnabled = !fieldValue.includes('Не отправлять');
        }
    }

    // Дополнительный анализ данных сделки
    analyzeLeadData(result) {
        // Определяем филиал из названия
        if (!result.branch && result.leadName) {
            if (result.leadName.includes('СВИБЛОВО')) {
                result.branch = 'СВИБЛОВО';
            } else if (result.leadName.includes('БАБУШКИНСКАЯ')) {
                result.branch = 'БАБУШКИНСКАЯ';
            }
        }
        
        // Определяем статус из названия
        if (result.leadName) {
            if (result.leadName.includes('Активирован')) {
                result.subscriptionStatus = 'Активирован';
                result.subscriptionActive = true;
            } else if (result.leadName.includes('Закончился')) {
                result.subscriptionStatus = 'Закончился';
                result.subscriptionActive = false;
            }
        }
        
        // Определяем тип абонемента из названия
        if (!result.subscriptionType && result.leadName) {
            if (result.leadName.includes('8 занятий')) {
                result.subscriptionType = '8 занятий';
                result.totalClasses = 8;
            } else if (result.leadName.includes('16 занятий')) {
                result.subscriptionType = '16 занятий';
                result.totalClasses = 16;
            } else if (result.leadName.includes('Абонемент')) {
                result.subscriptionType = 'Абонемент';
            }
        }
        
        // Рассчитываем отсутствующие значения
        if (result.totalClasses > 0 && result.usedClasses > 0 && result.remainingClasses === 0) {
            result.remainingClasses = result.totalClasses - result.usedClasses;
        }
        
        if (result.totalClasses > 0 && result.remainingClasses > 0 && result.usedClasses === 0) {
            result.usedClasses = result.totalClasses - result.remainingClasses;
        }
        
        // Определяем активность абонемента
        if (!result.subscriptionStatus) {
            if (result.expirationDate) {
                const expiration = new Date(result.expirationDate);
                const today = new Date();
                result.subscriptionActive = expiration >= today;
                result.subscriptionStatus = result.subscriptionActive ? 'Активен' : 'Истек';
            }
        }
    }

    // Метод для создания профиля ученика
    createStudentProfile(parentContact, phoneNumber, studentInfo, sourceType) {
        const profile = {
            amocrm_contact_id: parentContact.id,
            parent_contact_id: parentContact.id,
            student_name: studentInfo.studentName,
            phone_number: phoneNumber,
            email: this.findEmail(parentContact),
            birth_date: studentInfo.birthDate || '',
            branch: studentInfo.branch || '',
            parent_name: parentContact.name || '',
            day_of_week: studentInfo.dayOfWeek || '',
            time_slot: studentInfo.timeSlot || '',
            teacher_name: studentInfo.teacherName || '',
            age_group: studentInfo.ageGroup || '',
            purchase_date: studentInfo.purchaseDate || '',
            amount: studentInfo.amount || 0,
            certificate_number: studentInfo.certificateNumber || '',
            comment: studentInfo.comment || '',
            
            // Данные об абонементе
            subscription_type: studentInfo.subscriptionType || 'Без абонемента',
            subscription_status: studentInfo.subscriptionStatus || '',
            subscription_active: studentInfo.subscriptionActive ? 1 : 0,
            total_classes: studentInfo.totalClasses || 0,
            remaining_classes: studentInfo.remainingClasses || 0,
            used_classes: studentInfo.usedClasses || 0,
            expiration_date: studentInfo.expirationDate || null,
            activation_date: studentInfo.activationDate || null,
            last_visit_date: studentInfo.lastVisitDate || null,
            messages_enabled: studentInfo.messagesEnabled ? 1 : 1,
            
            // Ссылки на сущности
            source_entity_id: studentInfo.leadId || studentInfo.customerId || null,
            source_entity_type: sourceType,
            source_entity_name: studentInfo.leadName || studentInfo.customerName || '',
            
            // Технические данные
            custom_fields: JSON.stringify(studentInfo.rawFields || []),
            raw_contact_data: JSON.stringify({
                parent_contact: { 
                    id: parentContact.id, 
                    name: parentContact.name 
                },
                student_info: studentInfo
            }),
            is_demo: 0,
            source: 'amocrm',
            is_active: 1
        };
        
        console.log(`📊 Создан профиль для: ${profile.student_name}`);
        console.log(`   📍 Филиал: ${profile.branch}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_type} (${profile.subscription_status})`);
        console.log(`   📅 Занятий: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        console.log(`   ⏰ Расписание: ${profile.day_of_week} ${profile.time_slot}`);
        console.log(`   👨‍🏫 Преподаватель: ${profile.teacher_name}`);
        
        return profile;
    }

    // Поиск email в контакте
    findEmail(contact) {
        const customFields = contact.custom_fields_values || [];
        for (const field of customFields) {
            const fieldName = (field.field_name || '').toLowerCase();
            if (fieldName.includes('email') || fieldName.includes('почта')) {
                const value = field.values?.[0]?.value || field.values?.[0]?.enum_value || '';
                if (value && value.includes('@')) return value;
            }
        }
        return '';
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
        
        // Определяем путь к БД
        let dbPath;
        
        if (process.env.REPLIT_DB_URL || process.env.REPL_ID) {
            console.log('🌐 Определена среда Replit');
            dbPath = path.join(process.cwd(), 'art_school.db');
        } else {
            const dbDir = path.join(__dirname, 'data');
            try {
                await fs.mkdir(dbDir, { recursive: true });
                console.log('📁 Директория данных создана:', dbDir);
            } catch (mkdirError) {
                console.log('📁 Директория данных уже существует');
            }
            dbPath = path.join(dbDir, 'art_school.db');
        }
        
        console.log(`💾 Путь к базе данных: ${dbPath}`);
        
        // Открываем базу данных
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        
        // Настраиваем базу данных
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        
        console.log('⚙️  Настройки SQLite применены');
        
        // Создаем таблицы
        await createTables();
        
        console.log('\n✅ База данных успешно инициализирована!');
        
        return db;
    } catch (error) {
        console.error('❌ Критическая ошибка инициализации базы данных:', error.message);
        
        // Пробуем альтернативный путь для БД
        try {
            console.log('\n🔄 Попытка альтернативного пути для БД...');
            const tempDbPath = path.join('/tmp', 'art_school.db');
            
            db = await open({
                filename: tempDbPath,
                driver: sqlite3.Database
            });
            
            await db.run('PRAGMA foreign_keys = ON');
            await createTables();
            
            console.log('✅ База данных создана в временной директории');
            return db;
            
        } catch (tempError) {
            console.error('❌ Не удалось создать БД даже во временной директории');
            
            // Создаем БД в памяти
            console.log('\n🔄 Создаем БД в памяти...');
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            await db.run('PRAGMA foreign_keys = ON');
            await createTables();
            
            console.log('⚠️  ВНИМАНИЕ: БД создана в памяти. Данные будут потеряны при перезапуске!');
            return db;
        }
    }
};

const createTables = async () => {
    try {
        console.log('\n📊 СОЗДАНИЕ ТАБЛИЦ БАЗЫ ДАННЫХ');
        
        // Таблица профилей учеников
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amocrm_contact_id INTEGER,
                parent_contact_id INTEGER,
                
                -- Основная информация
                student_name TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                email TEXT,
                birth_date TEXT,
                branch TEXT,
                parent_name TEXT,
                
                -- Расписание
                day_of_week TEXT,
                time_slot TEXT,
                teacher_name TEXT,
                age_group TEXT,
                
                -- Данные абонемента
                subscription_type TEXT,
                subscription_status TEXT,
                subscription_active INTEGER DEFAULT 0,
                total_classes INTEGER DEFAULT 0,
                used_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                expiration_date TEXT,
                activation_date TEXT,
                last_visit_date TEXT,
                purchase_date TEXT,
                
                -- Финансы
                amount INTEGER DEFAULT 0,
                certificate_number TEXT,
                
                -- Коммуникация
                comment TEXT,
                messages_enabled INTEGER DEFAULT 1,
                
                -- Ссылки на сущности
                source_entity_id INTEGER,
                source_entity_type TEXT,
                source_entity_name TEXT,
                
                -- Технические данные
                custom_fields TEXT,
                raw_contact_data TEXT,
                is_demo INTEGER DEFAULT 0,
                source TEXT DEFAULT 'amocrm',
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица student_profiles создана');

        // Индексы
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_student_name ON student_profiles(student_name)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_branch ON student_profiles(branch)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(is_active)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_subscription ON student_profiles(subscription_active)');
        
        // Таблица сессий пользователей
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

// ==================== ТЕСТОВЫЕ ДАННЫЕ ====================
const createTestData = async () => {
    try {
        console.log('\n📝 СОЗДАНИЕ ТЕСТОВЫХ ДАННЫХ');
        
        // Проверяем наличие данных
        const hasStudents = await db.get("SELECT 1 FROM student_profiles LIMIT 1");
        
        // Создаем тестового ученика только если нет реальных данных из amoCRM
        if (!hasStudents && !amoCrmService.isInitialized) {
            console.log('👤 Создание тестовых учеников (для демо)...');
            
            const students = [
                {
                    student_name: 'Гладкова Таня',
                    phone_number: '+79680175895',
                    email: 'example@mail.com',
                    branch: 'СВИБЛОВО',
                    subscription_type: '8 занятий',
                    subscription_status: 'Активирован',
                    subscription_active: 1,
                    total_classes: 8,
                    remaining_classes: 7,
                    used_classes: 1,
                    expiration_date: '11.04.2026',
                    activation_date: '17.01.2026',
                    last_visit_date: '17.01.2026',
                    purchase_date: '17.01.2026',
                    day_of_week: 'Понедельник',
                    time_slot: '18:00',
                    teacher_name: 'Саша М',
                    age_group: '8-10 лет',
                    amount: 7020,
                    certificate_number: '28656433',
                    comment: 'Майская акция, аттестация26',
                    is_demo: 1
                },
                {
                    student_name: 'Иванов Иван',
                    phone_number: '+79999999999',
                    email: 'ivanov@example.com',
                    branch: 'БАБУШКИНСКАЯ',
                    subscription_type: '16 занятий',
                    subscription_status: 'Активен',
                    subscription_active: 1,
                    total_classes: 16,
                    remaining_classes: 10,
                    used_classes: 6,
                    expiration_date: '15.05.2026',
                    activation_date: '15.01.2026',
                    last_visit_date: '10.02.2026',
                    purchase_date: '15.01.2026',
                    day_of_week: 'Среда',
                    time_slot: '17:00',
                    teacher_name: 'Мария К',
                    age_group: '10-12 лет',
                    amount: 11900,
                    certificate_number: '28656434',
                    is_demo: 1
                }
            ];
            
            for (const student of students) {
                await db.run(
                    `INSERT OR IGNORE INTO student_profiles 
                     (student_name, phone_number, email, branch, subscription_type, subscription_status,
                      subscription_active, total_classes, remaining_classes, used_classes,
                      expiration_date, activation_date, last_visit_date, purchase_date,
                      day_of_week, time_slot, teacher_name, age_group, amount, certificate_number,
                      comment, is_demo, source) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        student.student_name,
                        student.phone_number,
                        student.email,
                        student.branch,
                        student.subscription_type,
                        student.subscription_status,
                        student.subscription_active,
                        student.total_classes,
                        student.remaining_classes,
                        student.used_classes,
                        student.expiration_date,
                        student.activation_date,
                        student.last_visit_date,
                        student.purchase_date,
                        student.day_of_week,
                        student.time_slot,
                        student.teacher_name,
                        student.age_group,
                        student.amount,
                        student.certificate_number,
                        student.comment,
                        student.is_demo,
                        'demo'
                    ]
                );
                console.log(`✅ Тестовый профиль создан: ${student.student_name}`);
            }
            
            console.log('⚠️  Созданы ТЕСТОВЫЕ данные (используются только при отключенном amoCRM)');
        }
        
        console.log('\n✅ Тестовые данные проверены/созданы');
        
    } catch (error) {
        console.error('⚠️  Ошибка создания тестовых данных:', error.message);
    }
};

// ==================== ОСНОВНОЙ API ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '2.3.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        data_source: amoCrmService.isInitialized ? 'Реальные данные из amoCRM' : 'Локальные данные',
        features: [
            'Поиск учеников по телефону родителя',
            'Отображение абонементов',
            'Расписание занятий',
            'История посещений',
            'Финансовая информация'
        ]
    });
});

// Авторизация по номеру телефона
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
        
        // Очищаем номер телефона
        const cleanPhone = phone.replace(/\D/g, '');
        
        if (cleanPhone.length < 10) {
            return res.status(400).json({
                success: false,
                error: 'Неверный номер телефона (минимум 10 цифр)'
            });
        }
        
        // Форматируем номер
        let formattedPhone;
        if (cleanPhone.length === 10) {
            formattedPhone = '+7' + cleanPhone;
        } else if (cleanPhone.length === 11) {
            if (cleanPhone.startsWith('8')) {
                formattedPhone = '+7' + cleanPhone.slice(1);
            } else if (cleanPhone.startsWith('7')) {
                formattedPhone = '+' + cleanPhone;
            } else {
                formattedPhone = '+7' + cleanPhone.slice(-10);
            }
        } else {
            formattedPhone = '+7' + cleanPhone.slice(-10);
        }
        
        console.log(`📱 Форматированный номер: ${formattedPhone}`);
        console.log(`🔧 Статус amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
        
        let profiles = [];
        
        if (amoCrmService.isInitialized) {
            // Ищем учеников в amoCRM по телефону родителя
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            console.log(`📊 Найдено профилей в amoCRM: ${profiles.length}`);
            
            // Сохраняем найденные профили в базу данных
            if (profiles.length > 0) {
                await saveProfilesToDatabase(profiles);
            }
        }
        
        // Если не нашли в amoCRM, ищем в локальной базе
        if (profiles.length === 0) {
            console.log('🔍 Поиск в локальной базе данных...');
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            console.log(`📊 Найдено профилей в локальной БД: ${profiles.length}`);
        }
        
        // Создаем временного пользователя
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            first_name: profiles.length > 0 ? profiles[0].student_name?.split(' ')[0] || 'Ученик' : 'Гость',
            is_temp: true
        };
        
        // Создаем сессию
        const sessionId = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        
        try {
            await db.run(
                `INSERT INTO user_sessions (session_id, session_data, phone_number, expires_at, is_active) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    sessionId,
                    JSON.stringify({ user: tempUser, profiles }),
                    formattedPhone,
                    expiresAt.toISOString(),
                    1
                ]
            );
        } catch (dbError) {
            console.error(`❌ Ошибка создания сессии: ${dbError.message}`);
        }
        
        // Создаем JWT токен
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
        
        // Форматируем профили для ответа
        const responseProfiles = profiles.map(p => ({
            id: p.id,
            student_name: p.student_name,
            phone_number: p.phone_number,
            email: p.email,
            birth_date: p.birth_date,
            branch: p.branch,
            parent_name: p.parent_name,
            
            // Расписание
            day_of_week: p.day_of_week,
            time_slot: p.time_slot,
            teacher_name: p.teacher_name,
            age_group: p.age_group,
            
            // Абонемент
            subscription_type: p.subscription_type,
            subscription_status: p.subscription_status,
            subscription_active: p.subscription_active === 1,
            total_classes: p.total_classes,
            remaining_classes: p.remaining_classes,
            used_classes: p.used_classes,
            expiration_date: p.expiration_date,
            activation_date: p.activation_date,
            last_visit_date: p.last_visit_date,
            purchase_date: p.purchase_date,
            
            // Финансы
            amount: p.amount,
            certificate_number: p.certificate_number,
            
            // Дополнительно
            comment: p.comment,
            messages_enabled: p.messages_enabled === 1,
            
            // Технические данные
            source_entity_id: p.source_entity_id,
            source_entity_type: p.source_entity_type,
            source_entity_name: p.source_entity_name,
            is_demo: p.is_demo === 1,
            source: p.source,
            updated_at: p.updated_at
        }));
        
        // Формируем ответ
        const responseData = {
            success: true,
            message: profiles.length > 0 ? 'Авторизация успешна' : 'Профили не найдены',
            data: {
                user: tempUser,
                profiles: responseProfiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                has_active_subscriptions: responseProfiles.some(p => p.subscription_active),
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

// Функция для сохранения профилей в базу данных
async function saveProfilesToDatabase(profiles) {
    try {
        console.log(`💾 Сохранение профилей в БД...`);
        
        for (const profile of profiles) {
            // Проверяем, существует ли уже такой профиль
            const existingProfile = await db.get(
                `SELECT id FROM student_profiles 
                 WHERE amocrm_contact_id = ? AND student_name = ? AND source_entity_id = ?`,
                [profile.amocrm_contact_id, profile.student_name, profile.source_entity_id]
            );
            
            if (!existingProfile) {
                // Вставляем новый профиль
                await db.run(
                    `INSERT INTO student_profiles 
                     (amocrm_contact_id, parent_contact_id, student_name, phone_number, email, 
                      birth_date, branch, parent_name, day_of_week, time_slot, teacher_name,
                      age_group, subscription_type, subscription_status, subscription_active, 
                      total_classes, used_classes, remaining_classes, expiration_date, 
                      activation_date, last_visit_date, purchase_date, amount, certificate_number,
                      comment, messages_enabled, source_entity_id, source_entity_type, 
                      source_entity_name, custom_fields, raw_contact_data, is_demo, source, is_active) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        profile.amocrm_contact_id || null,
                        profile.parent_contact_id || null,
                        profile.student_name,
                        profile.phone_number,
                        profile.email || '',
                        profile.birth_date || '',
                        profile.branch || '',
                        profile.parent_name || '',
                        profile.day_of_week || '',
                        profile.time_slot || '',
                        profile.teacher_name || '',
                        profile.age_group || '',
                        profile.subscription_type || 'Без абонемента',
                        profile.subscription_status || '',
                        profile.subscription_active || 0,
                        profile.total_classes || 0,
                        profile.used_classes || 0,
                        profile.remaining_classes || 0,
                        profile.expiration_date || null,
                        profile.activation_date || null,
                        profile.last_visit_date || null,
                        profile.purchase_date || '',
                        profile.amount || 0,
                        profile.certificate_number || '',
                        profile.comment || '',
                        profile.messages_enabled || 1,
                        profile.source_entity_id || null,
                        profile.source_entity_type || '',
                        profile.source_entity_name || '',
                        profile.custom_fields || '[]',
                        profile.raw_contact_data || '{}',
                        profile.is_demo || 0,
                        profile.source || 'amocrm',
                        1
                    ]
                );
                console.log(`✅ Профиль сохранен в БД: ${profile.student_name}`);
            } else {
                // Обновляем существующий профиль
                await db.run(
                    `UPDATE student_profiles SET
                     student_name = ?, phone_number = ?, email = ?, birth_date = ?, branch = ?,
                     parent_name = ?, day_of_week = ?, time_slot = ?, teacher_name = ?, age_group = ?,
                     subscription_type = ?, subscription_status = ?, subscription_active = ?, 
                     total_classes = ?, used_classes = ?, remaining_classes = ?,
                     expiration_date = ?, activation_date = ?, last_visit_date = ?, purchase_date = ?,
                     amount = ?, certificate_number = ?, comment = ?, messages_enabled = ?,
                     source_entity_name = ?, custom_fields = ?, raw_contact_data = ?, 
                     updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [
                        profile.student_name,
                        profile.phone_number,
                        profile.email || '',
                        profile.birth_date || '',
                        profile.branch || '',
                        profile.parent_name || '',
                        profile.day_of_week || '',
                        profile.time_slot || '',
                        profile.teacher_name || '',
                        profile.age_group || '',
                        profile.subscription_type || 'Без абонемента',
                        profile.subscription_status || '',
                        profile.subscription_active || 0,
                        profile.total_classes || 0,
                        profile.used_classes || 0,
                        profile.remaining_classes || 0,
                        profile.expiration_date || null,
                        profile.activation_date || null,
                        profile.last_visit_date || null,
                        profile.purchase_date || '',
                        profile.amount || 0,
                        profile.certificate_number || '',
                        profile.comment || '',
                        profile.messages_enabled || 1,
                        profile.source_entity_name || '',
                        profile.custom_fields || '[]',
                        profile.raw_contact_data || '{}',
                        existingProfile.id
                    ]
                );
                console.log(`✅ Профиль обновлен в БД: ${profile.student_name}`);
            }
        }
        
        console.log(`💾 Сохранено профилей: ${profiles.length}`);
    } catch (error) {
        console.error(`❌ Ошибка сохранения профилей в БД: ${error.message}`);
    }
}

// Получение подробной информации об ученике
app.get('/api/student/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`\n📋 ЗАПРОС ПОДРОБНОЙ ИНФОРМАЦИИ ОБ УЧЕНИКЕ: ${id}`);
        
        const profile = await db.get(
            `SELECT * FROM student_profiles WHERE id = ?`,
            [id]
        );
        
        if (!profile) {
            console.log(`📭 Профиль не найден`);
            return res.status(404).json({
                success: false,
                error: 'Профиль не найден'
            });
        }
        
        console.log(`✅ Найден профиль: ${profile.student_name}`);
        
        // Форматируем ответ
        const responseData = {
            success: true,
            data: {
                profile: {
                    id: profile.id,
                    student_name: profile.student_name,
                    phone_number: profile.phone_number,
                    email: profile.email,
                    birth_date: profile.birth_date,
                    branch: profile.branch,
                    parent_name: profile.parent_name,
                    
                    // Расписание
                    day_of_week: profile.day_of_week,
                    time_slot: profile.time_slot,
                    teacher_name: profile.teacher_name,
                    age_group: profile.age_group,
                    
                    // Абонемент
                    subscription_type: profile.subscription_type,
                    subscription_status: profile.subscription_status,
                    subscription_active: profile.subscription_active === 1,
                    total_classes: profile.total_classes,
                    remaining_classes: profile.remaining_classes,
                    used_classes: profile.used_classes,
                    expiration_date: profile.expiration_date,
                    activation_date: profile.activation_date,
                    last_visit_date: profile.last_visit_date,
                    purchase_date: profile.purchase_date,
                    
                    // Финансы
                    amount: profile.amount,
                    certificate_number: profile.certificate_number,
                    
                    // Дополнительно
                    comment: profile.comment,
                    messages_enabled: profile.messages_enabled === 1,
                    
                    // Технические данные
                    source_entity_id: profile.source_entity_id,
                    source_entity_type: profile.source_entity_type,
                    source_entity_name: profile.source_entity_name,
                    is_demo: profile.is_demo === 1,
                    source: profile.source,
                    created_at: profile.created_at,
                    updated_at: profile.updated_at
                },
                subscription_summary: {
                    status: profile.subscription_status || (profile.subscription_active ? 'Активен' : 'Не активен'),
                    progress: profile.total_classes > 0 ? Math.round((profile.used_classes / profile.total_classes) * 100) : 0,
                    classes_left: profile.remaining_classes,
                    days_left: profile.expiration_date ? 
                        Math.ceil((new Date(profile.expiration_date.split('.').reverse().join('-')) - new Date()) / (1000 * 60 * 60 * 24)) : 
                        null
                }
            }
        };
        
        res.json(responseData);
        
    } catch (error) {
        console.error('Ошибка получения профиля:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об ученике'
        });
    }
});

// Обновление данных из amoCRM для конкретного ученика
app.post('/api/student/:id/refresh', async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!amoCrmService.isInitialized) {
            return res.status(400).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        console.log(`\n🔄 ОБНОВЛЕНИЕ ДАННЫХ УЧЕНИКА: ${id}`);
        
        // Получаем текущий профиль
        const profile = await db.get(
            `SELECT * FROM student_profiles WHERE id = ?`,
            [id]
        );
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Профиль не найден'
            });
        }
        
        // Ищем обновленные данные в amoCRM
        const phoneNumber = profile.phone_number;
        const profiles = await amoCrmService.getStudentsByPhone(phoneNumber);
        
        // Находим профиль с тем же именем ученика
        const updatedProfile = profiles.find(p => 
            p.student_name === profile.student_name && 
            p.source_entity_id === profile.source_entity_id
        );
        
        if (updatedProfile) {
            // Обновляем профиль в базе
            await saveProfilesToDatabase([updatedProfile]);
            
            console.log(`✅ Данные обновлены для: ${profile.student_name}`);
            
            res.json({
                success: true,
                message: 'Данные успешно обновлены',
                data: {
                    student_name: profile.student_name,
                    updated_fields: ['subscription', 'visits', 'dates']
                }
            });
        } else {
            console.log(`⚠️  Обновленные данные не найдены в amoCRM`);
            
            res.json({
                success: true,
                message: 'Обновленные данные не найдены в amoCRM',
                data: null
            });
        }
        
    } catch (error) {
        console.error('Ошибка обновления данных:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления данных'
        });
    }
});

// Поиск ученика по телефону (прямой поиск)
app.post('/api/search/student', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`\n🔍 ПРЯМОЙ ПОИСК УЧЕНИКА: ${phone}`);
        
        // Форматируем номер телефона
        const cleanPhone = phone.replace(/\D/g, '');
        let formattedPhone;
        
        if (cleanPhone.length === 10) {
            formattedPhone = '+7' + cleanPhone;
        } else if (cleanPhone.length === 11) {
            if (cleanPhone.startsWith('8')) {
                formattedPhone = '+7' + cleanPhone.slice(1);
            } else if (cleanPhone.startsWith('7')) {
                formattedPhone = '+' + cleanPhone;
            } else {
                formattedPhone = '+7' + cleanPhone.slice(-10);
            }
        } else {
            formattedPhone = '+7' + cleanPhone.slice(-10);
        }
        
        let profiles = [];
        
        // Если подключен amoCRM, ищем там
        if (amoCrmService.isInitialized) {
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            
            // Сохраняем в базу
            if (profiles.length > 0) {
                await saveProfilesToDatabase(profiles);
            }
        }
        
        // Если не нашли в amoCRM, ищем в локальной базе
        if (profiles.length === 0) {
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
        }
        
        // Форматируем краткий ответ
        const briefProfiles = profiles.map(p => ({
            id: p.id,
            student_name: p.student_name,
            phone_number: p.phone_number,
            branch: p.branch,
            subscription_type: p.subscription_type,
            subscription_status: p.subscription_status,
            subscription_active: p.subscription_active === 1,
            total_classes: p.total_classes,
            remaining_classes: p.remaining_classes,
            expiration_date: p.expiration_date,
            is_demo: p.is_demo === 1
        }));
        
        res.json({
            success: true,
            data: {
                profiles: briefProfiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized
            }
        });
        
    } catch (error) {
        console.error('Ошибка поиска ученика:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка поиска ученика'
        });
    }
});

// Статистика по абонементам
app.get('/api/stats/subscriptions', async (req, res) => {
    try {
        console.log('\n📊 ЗАПРОС СТАТИСТИКИ ПО АБОНЕМЕНТАМ');
        
        const stats = await db.all(`
            SELECT 
                subscription_status,
                COUNT(*) as count,
                SUM(total_classes) as total_classes,
                SUM(used_classes) as used_classes,
                SUM(remaining_classes) as remaining_classes,
                AVG(amount) as avg_amount
            FROM student_profiles 
            WHERE is_active = 1 AND subscription_type != 'Без абонемента'
            GROUP BY subscription_status
            ORDER BY count DESC
        `);
        
        const total = await db.get(`
            SELECT 
                COUNT(*) as total_students,
                SUM(CASE WHEN subscription_active = 1 THEN 1 ELSE 0 END) as active_subscriptions,
                SUM(total_classes) as total_classes_all,
                SUM(used_classes) as used_classes_all,
                SUM(remaining_classes) as remaining_classes_all
            FROM student_profiles 
            WHERE is_active = 1
        `);
        
        res.json({
            success: true,
            data: {
                stats: stats,
                total: total,
                amocrm_connected: amoCrmService.isInitialized,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения статистики:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v2.3');
        console.log('='.repeat(80));
        console.log('✨ РАСШИРЕННЫЙ ПОИСК УЧЕНИКОВ С ДЕТАЛЬНЫМИ АБОНЕМЕНТАМИ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Создаем тестовые данные
        await createTestData();
        
        // Инициализируем amoCRM
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            console.log(`📊 Аккаунт: ${amoCrmService.accountInfo?.name || 'Не получено'}`);
        } else {
            console.log('⚠️  amoCRM не инициализирован');
            console.log('ℹ️  Используются локальные данные');
        }
        
        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 Основной URL: http://localhost:${PORT}`);
            console.log(`📊 База данных: SQLite`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log(`🔍 Поиск учеников: http://localhost:${PORT}/api/auth/phone (POST)`);
            console.log(`📋 Детали ученика: http://localhost:${PORT}/api/student/:id`);
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

// Запуск сервера
startServer();
