// server.js - полная версия с точным отображением данных как в amoCRM
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
        this.fieldMapping = {};
    }

    async initialize() {
        try {
            if (this.accessToken) {
                console.log('🔍 Проверка валидности токена...');
                const isValid = await this.checkTokenValidity(this.accessToken);
                this.isInitialized = isValid;
                
                if (isValid) {
                    // Получаем метаданные о полях
                    await this.loadCustomFields();
                }
                
                return isValid;
            }
            return false;
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            return false;
        }
    }

    async loadCustomFields() {
        try {
            console.log('📋 Загрузка метаданных полей...');
            
            // Загружаем поля контактов
            const contactFields = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            // Загружаем поля сделок
            const leadFields = await this.makeRequest('GET', '/api/v4/leads/custom_fields');
            // Загружаем поля покупателей
            const customerFields = await this.makeRequest('GET', '/api/v4/customers/custom_fields');
            
            // Создаем маппинг полей для быстрого поиска
            this.fieldMapping = {
                contact: this.createFieldMapping(contactFields._embedded?.custom_fields || []),
                lead: this.createFieldMapping(leadFields._embedded?.custom_fields || []),
                customer: this.createFieldMapping(customerFields._embedded?.custom_fields || [])
            };
            
            console.log('✅ Метаданные полей загружены');
            
        } catch (error) {
            console.error('⚠️ Ошибка загрузки метаданных полей:', error.message);
        }
    }

    createFieldMapping(fields) {
        const mapping = {};
        fields.forEach(field => {
            const name = field.name.toLowerCase();
            mapping[field.id] = {
                id: field.id,
                name: field.name,
                type: field.type,
                normalizedName: name
            };
            
            // Создаем обратный маппинг по названию
            mapping[name] = field.id;
        });
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
            return true;
        } catch (error) {
            console.error('❌ Ошибка проверки токена:', error.message);
            return false;
        }
    }

    async makeRequest(method, endpoint, data = null, retryCount = 0) {
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
            if (error.response?.status === 429 && retryCount < 3) {
                const delay = Math.pow(2, retryCount) * 1000;
                console.log(`⚠️ Rate limit, ждем ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.makeRequest(method, endpoint, data, retryCount + 1);
            }
            
            console.error(`❌ Ошибка запроса ${method} ${url}:`, error.message);
            if (error.response) {
                console.error('Детали ошибки:', error.response.data);
            }
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
            
            const response = await this.makeRequest(
                'GET', 
                `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=custom_fields_values`
            );
            
            return response;
        } catch (error) {
            console.error(`❌ Ошибка поиска: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    async getContactLeads(contactId) {
        try {
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}`
            );
            
            return response._embedded?.leads || [];
        } catch (error) {
            console.error(`❌ Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    async getContactCustomers(contactId) {
        try {
            const response = await this.makeRequest(
                'GET',
                `/api/v4/customers?with=custom_fields_values&filter[contact_id]=${contactId}`
            );
            
            return response._embedded?.customers || [];
        } catch (error) {
            console.error(`❌ Ошибка получения покупателей: ${error.message}`);
            return [];
        }
    }

    findEmail(contact) {
        const customFields = contact.custom_fields_values || [];
        for (const field of customFields) {
            const fieldName = (field.field_name || field.name || '').toLowerCase();
            if (fieldName.includes('email') || fieldName.includes('почта')) {
                const value = field.values?.[0]?.value || field.values?.[0]?.enum_value || '';
                if (value) return value;
            }
        }
        return '';
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
                    // 2. Ищем связанные сделки этого контакта
                    const leads = await this.getContactLeads(parentContact.id);
                    console.log(`📊 Связанных сделок: ${leads.length}`);
                    
                    // 3. Ищем связанных покупателей этого контакта
                    const customers = await this.getContactCustomers(parentContact.id);
                    console.log(`📊 Связанных покупателей: ${customers.length}`);
                    
                    // 4. Сначала анализируем сделки - именно там должна быть основная информация об учениках
                    for (const lead of leads) {
                        const studentInfo = this.extractStudentInfoFromLead(lead);
                        if (studentInfo.hasStudent) {
                            console.log(`✅ Найден ученик в сделке: ${studentInfo.studentName} (ID сделки: ${lead.id})`);
                            
                            // Ищем дополнительную информацию в покупателях
                            const customerInfo = this.findMatchingCustomerInfo(customers, studentInfo.studentName);
                            
                            // Объединяем информацию
                            const completeInfo = {
                                ...studentInfo,
                                ...customerInfo
                            };
                            
                            const profile = this.createStudentProfile(
                                parentContact, 
                                phoneNumber, 
                                completeInfo,
                                lead,
                                customerInfo.customer
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

    // Метод для извлечения информации об ученике из СДЕЛКИ (основной источник)
    extractStudentInfoFromLead(lead) {
        console.log(`\n📋 Анализ сделки: "${lead.name}" (ID: ${lead.id})`);
        
        const result = {
            hasStudent: false,
            studentName: '',
            leadName: lead.name || '',
            leadId: lead.id,
            leadStatus: lead.status_id || 0,
            leadPrice: lead.price || 0,
            
            // Информация об абонементе из названия
            subscriptionFromName: this.extractSubscriptionFromLeadName(lead.name),
            
            // Детали абонемента
            totalClasses: 0,
            usedClasses: 0,
            remainingClasses: 0,
            subscriptionType: '',
            subscriptionActive: false,
            activationDate: '',
            expirationDate: '',
            lastVisitDate: '',
            branch: '',
            teacherName: '',
            dayOfWeek: '',
            timeSlot: '',
            birthDate: '',
            
            // Дополнительная информация
            certificateNumber: '',
            groupAge: '',
            purchaseDate: '',
            paymentMethod: '',
            manager: '',
            channel: ''
        };
        
        // 1. Извлекаем имя ученика из названия сделки
        if (lead.name) {
            const nameMatch = lead.name.match(/^([^-]+?)(\s*-\s*\d+\s*занятий?)?$/);
            if (nameMatch && nameMatch[1]) {
                result.studentName = nameMatch[1].trim();
                result.hasStudent = true;
                console.log(`👤 Имя из названия сделки: "${result.studentName}"`);
            }
        }
        
        // 2. Извлекаем информацию из кастомных полей
        if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
            this.extractLeadInfoFromFields(lead.custom_fields_values, result);
        }
        
        // 3. Если есть информация об абонементе из названия, используем её
        if (result.subscriptionFromName.totalClasses > 0 && result.totalClasses === 0) {
            result.totalClasses = result.subscriptionFromName.totalClasses;
            console.log(`📊 Занятий из названия: ${result.totalClasses}`);
        }
        
        // 4. Рассчитываем остаток занятий, если есть данные
        if (result.totalClasses > 0 && result.usedClasses > 0 && result.remainingClasses === 0) {
            result.remainingClasses = result.totalClasses - result.usedClasses;
            console.log(`📊 Рассчитано осталось занятий: ${result.remainingClasses}`);
        }
        
        // 5. Определяем активность абонемента
        result.subscriptionActive = this.isSubscriptionActive(result);
        
        return result;
    }

    extractSubscriptionFromLeadName(leadName) {
        const result = {
            totalClasses: 0,
            subscriptionType: '',
            isActive: false
        };
        
        if (!leadName) return result;
        
        // Ищем количество занятий в названии
        const classMatch = leadName.match(/(\d+)\s*занятий?/i);
        if (classMatch) {
            result.totalClasses = parseInt(classMatch[1]);
        }
        
        // Определяем тип абонемента
        if (leadName.includes('Активный') || leadName.includes('активный')) {
            result.isActive = true;
            result.subscriptionType = 'Активный абонемент';
        } else if (leadName.includes('абонемент')) {
            result.subscriptionType = 'Абонемент';
        }
        
        return result;
    }

    extractLeadInfoFromFields(fields, result) {
        for (const field of fields) {
            const fieldName = (field.field_name || field.name || '').toLowerCase();
            const fieldValue = field.values?.[0]?.value || field.values?.[0]?.enum_value || '';
            const fieldCode = field.field_code || '';
            
            // Логируем все поля для отладки
            if (fieldValue && fieldValue.toString().trim() !== '') {
                console.log(`  📝 ${fieldName}: ${fieldValue} (код: ${fieldCode})`);
            }
            
            // Количество занятий
            if (fieldName.includes('абонемент занятий') || 
                fieldName.includes('количество занятий') ||
                fieldCode === 'ABONEMENT_ZANYATIY') {
                const match = fieldValue.toString().match(/(\d+)/);
                if (match) {
                    result.totalClasses = parseInt(match[1]);
                    result.subscriptionType = result.subscriptionType || 'Абонемент';
                }
            }
            
            // Счетчик занятий (использовано)
            if (fieldName.includes('счетчик занятий') || 
                fieldName.includes('использовано') ||
                fieldCode === 'SCHETCHIK_ZANYATIY') {
                result.usedClasses = parseInt(fieldValue) || 0;
            }
            
            // Остаток занятий
            if (fieldName.includes('остаток занятий') || 
                fieldName.includes('осталось') ||
                fieldCode === 'OSTATOK_ZANYATIY') {
                result.remainingClasses = parseInt(fieldValue) || 0;
            }
            
            // Тип абонемента
            if (fieldName.includes('тип абонемента') ||
                fieldCode === 'TIP_ABONEMENTA') {
                result.subscriptionType = fieldValue;
            }
            
            // Статус абонемента
            if (fieldName.includes('активный абонемент') || 
                fieldName.includes('статус абонемента') ||
                fieldCode === 'AKTIVNYJ_ABONEMENT') {
                result.subscriptionActive = fieldValue === 'true' || 
                                          fieldValue === 'активен' ||
                                          fieldValue === 'активный' ||
                                          fieldValue === 'да' ||
                                          fieldValue === '1' ||
                                          fieldValue === 'Активный абонемент';
            }
            
            // Даты
            if (fieldName.includes('дата активации') ||
                fieldCode === 'DATA_AKTIVACII') {
                result.activationDate = this.formatDate(fieldValue);
            }
            
            if ((fieldName.includes('окончание') || fieldName.includes('срок действия')) &&
                !fieldName.includes('заморозка') ||
                fieldCode === 'OKONCHANIE') {
                result.expirationDate = this.formatDate(fieldValue);
            }
            
            if (fieldName.includes('последний визит') || 
                fieldName.includes('последнее посещение') ||
                fieldName.includes('дата последнего визита') ||
                fieldCode === 'DATA_POSLEDNEGO_VIZITA') {
                result.lastVisitDate = this.formatDate(fieldValue);
            }
            
            // Филиал
            if ((fieldName.includes('филиал') || fieldCode === 'FILIAL') && !result.branch) {
                result.branch = fieldValue;
            }
            
            // Номер сертификата
            if (fieldName.includes('номер сертификата') ||
                fieldCode === 'NOMER_SERTIFIKATA') {
                result.certificateNumber = fieldValue;
            }
            
            // Группа возраст
            if (fieldName.includes('группа возраст') ||
                fieldCode === 'GRUPPA_VOZRAST') {
                result.groupAge = fieldValue;
            }
            
            // Дата покупки
            if (fieldName.includes('дата покупки') ||
                fieldCode === 'DATA_POKUPKI') {
                result.purchaseDate = this.formatDate(fieldValue);
            }
            
            // Способ оплаты
            if (fieldName.includes('способ оплаты') ||
                fieldCode === 'SPOSOB_OPLATY') {
                result.paymentMethod = fieldValue;
            }
            
            // Менеджер
            if (fieldName.includes('менеджер') && !result.manager) {
                result.manager = fieldValue;
            }
            
            // Рекламный канал
            if (fieldName.includes('рекламный канал') && !result.channel) {
                result.channel = fieldValue;
            }
            
            // Преподаватель
            if (fieldName.includes('преподаватель') && !result.teacherName) {
                result.teacherName = fieldValue;
            }
            
            // День недели
            if (fieldName.includes('день недели') && !result.dayOfWeek) {
                result.dayOfWeek = fieldValue;
            }
            
            // Время
            if (fieldName.includes('время занятия') && !result.timeSlot) {
                result.timeSlot = fieldValue;
            }
        }
    }

    findMatchingCustomerInfo(customers, studentName) {
        const result = {
            customer: null,
            additionalInfo: {}
        };
        
        // Ищем покупателя с именем ученика
        for (const customer of customers) {
            if (customer.name && customer.name.includes(studentName)) {
                result.customer = customer;
                
                // Извлекаем дополнительную информацию из покупателя
                if (customer.custom_fields_values) {
                    for (const field of customer.custom_fields_values) {
                        const fieldName = (field.field_name || field.name || '').toLowerCase();
                        const fieldValue = field.values?.[0]?.value || field.values?.[0]?.enum_value || '';
                        
                        // День рождения
                        if (fieldName.includes('день рождения') && !result.additionalInfo.birthDate) {
                            result.additionalInfo.birthDate = this.formatDate(fieldValue);
                        }
                        
                        // Преподаватель (если не найден в сделке)
                        if (fieldName.includes('преподаватель') && !result.additionalInfo.teacherName) {
                            result.additionalInfo.teacherName = fieldValue;
                        }
                        
                        // Расписание (если не найдено в сделке)
                        if (fieldName.includes('день недели') && !result.additionalInfo.dayOfWeek) {
                            result.additionalInfo.dayOfWeek = fieldValue;
                        }
                        
                        if (fieldName.includes('время') && !result.additionalInfo.timeSlot) {
                            result.additionalInfo.timeSlot = fieldValue;
                        }
                    }
                }
                
                console.log(`📋 Найден покупатель: ${customer.name}`);
                break;
            }
        }
        
        return result;
    }

    isSubscriptionActive(studentInfo) {
        // Проверяем по нескольким критериям
        
        // 1. Явно указан статус "Активный"
        if (studentInfo.subscriptionActive === true) {
            return true;
        }
        
        // 2. Есть остаток занятий
        if (studentInfo.remainingClasses > 0) {
            return true;
        }
        
        // 3. Дата окончания не наступила
        if (studentInfo.expirationDate) {
            const expirationDate = new Date(studentInfo.expirationDate);
            const today = new Date();
            if (expirationDate >= today) {
                return true;
            }
        }
        
        // 4. В названии указано "Активный"
        if (studentInfo.leadName && studentInfo.leadName.includes('Активный')) {
            return true;
        }
        
        return false;
    }

    formatDate(dateString) {
        if (!dateString) return '';
        
        try {
            // Пробуем разные форматы дат
            let date;
            
            if (typeof dateString === 'number') {
                // Unix timestamp
                date = new Date(dateString * 1000);
            } else if (dateString.includes('.')) {
                // Формат DD.MM.YYYY
                const parts = dateString.split('.');
                if (parts.length === 3) {
                    date = new Date(parts[2], parts[1] - 1, parts[0]);
                }
            } else {
                // Стандартный ISO формат
                date = new Date(dateString);
            }
            
            if (isNaN(date.getTime())) {
                return dateString;
            }
            
            return date.toISOString().split('T')[0];
        } catch (error) {
            return dateString;
        }
    }

    // Метод для создания профиля ученика
    createStudentProfile(parentContact, phoneNumber, studentInfo, lead, customer) {
        console.log(`\n📊 СОЗДАНИЕ ПРОФИЛЯ ДЛЯ: ${studentInfo.studentName}`);
        
        // Определяем тип абонемента
        let subscriptionType = studentInfo.subscriptionType;
        if (!subscriptionType) {
            if (studentInfo.subscriptionActive) {
                subscriptionType = 'Активный абонемент';
            } else if (studentInfo.totalClasses > 0) {
                subscriptionType = 'Абонемент';
            } else {
                subscriptionType = 'Без абонемента';
            }
        }
        
        // Формируем полное название абонемента
        let fullSubscriptionName = subscriptionType;
        if (studentInfo.totalClasses > 0) {
            fullSubscriptionName += ` (${studentInfo.totalClasses} занятий)`;
        }
        
        // Определяем статус абонемента
        const subscriptionStatus = studentInfo.subscriptionActive ? 'Активирован' : 'Не активирован';
        
        const profile = {
            // Основная информация
            amocrm_contact_id: parentContact.id,
            parent_contact_id: parentContact.id,
            lead_id: studentInfo.leadId,
            customer_id: customer?.id || null,
            
            student_name: studentInfo.studentName,
            phone_number: phoneNumber,
            email: this.findEmail(parentContact),
            birth_date: studentInfo.birthDate || studentInfo.additionalInfo?.birthDate || '',
            branch: studentInfo.branch || '',
            
            // Информация о родителе
            parent_name: parentContact.name || '',
            
            // Расписание
            day_of_week: studentInfo.dayOfWeek || studentInfo.additionalInfo?.dayOfWeek || '',
            time_slot: studentInfo.timeSlot || studentInfo.additionalInfo?.timeSlot || '',
            teacher_name: studentInfo.teacherName || studentInfo.additionalInfo?.teacherName || '',
            group_age: studentInfo.groupAge || '',
            
            // Данные абонемента (ТОЧНО КАК В AMOCRM)
            subscription_type: subscriptionType,
            subscription_name: fullSubscriptionName,
            subscription_status: subscriptionStatus,
            subscription_active: studentInfo.subscriptionActive ? 1 : 0,
            
            // Количество занятий
            total_classes: studentInfo.totalClasses || 0,
            used_classes: studentInfo.usedClasses || 0,
            remaining_classes: studentInfo.remainingClasses || 0,
            
            // Даты
            activation_date: studentInfo.activationDate || '',
            expiration_date: studentInfo.expirationDate || '',
            last_visit_date: studentInfo.lastVisitDate || '',
            purchase_date: studentInfo.purchaseDate || '',
            
            // Дополнительная информация
            certificate_number: studentInfo.certificateNumber || '',
            lead_name: studentInfo.leadName || '',
            lead_price: studentInfo.leadPrice || 0,
            lead_status: studentInfo.leadStatus || 0,
            payment_method: studentInfo.paymentMethod || '',
            manager: studentInfo.manager || '',
            channel: studentInfo.channel || '',
            
            // Технические данные
            custom_fields: JSON.stringify(lead.custom_fields_values || []),
            raw_contact_data: JSON.stringify({
                parent_contact: { 
                    id: parentContact.id, 
                    name: parentContact.name 
                },
                lead: {
                    id: lead.id,
                    name: lead.name,
                    price: lead.price
                },
                customer: customer ? { id: customer.id, name: customer.name } : null
            }),
            
            is_demo: 0,
            source: 'amocrm',
            is_active: 1
        };
        
        console.log(`✅ Профиль создан: ${profile.student_name}`);
        console.log(`   Абонемент: ${profile.subscription_name}`);
        console.log(`   Статус: ${profile.subscription_status}`);
        console.log(`   Занятий: использовано ${profile.used_classes}, осталось ${profile.remaining_classes} из ${profile.total_classes}`);
        console.log(`   Даты: активация ${profile.activation_date}, окончание ${profile.expiration_date}`);
        
        return profile;
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
        
        // Таблица профилей учеников (расширенная)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amocrm_contact_id INTEGER,
                parent_contact_id INTEGER,
                lead_id INTEGER,
                customer_id INTEGER,
                
                -- Основная информация
                student_name TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                email TEXT,
                birth_date TEXT,
                branch TEXT,
                
                -- Информация о родителе
                parent_name TEXT,
                
                -- Расписание
                day_of_week TEXT,
                time_slot TEXT,
                teacher_name TEXT,
                group_age TEXT,
                
                -- Данные абонемента (ТОЧНО КАК В AMOCRM)
                subscription_type TEXT,
                subscription_name TEXT,
                subscription_status TEXT,
                subscription_active INTEGER DEFAULT 0,
                
                -- Количество занятий
                total_classes INTEGER DEFAULT 0,
                used_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                
                -- Даты
                activation_date TEXT,
                expiration_date TEXT,
                last_visit_date TEXT,
                purchase_date TEXT,
                
                -- Дополнительная информация
                certificate_number TEXT,
                lead_name TEXT,
                lead_price INTEGER DEFAULT 0,
                lead_status INTEGER DEFAULT 0,
                payment_method TEXT,
                manager TEXT,
                channel TEXT,
                
                -- Дополнительные поля
                comment TEXT,
                address TEXT,
                
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
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(is_active)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_lead_id ON student_profiles(lead_id)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_contact_id ON student_profiles(amocrm_contact_id)');
        
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
            
            const testStudents = [
                {
                    student_name: 'Гладкова Таня',
                    phone_number: '+79680175895',
                    email: 'example@mail.com',
                    branch: 'СВИБЛОВО',
                    subscription_type: 'Активный абонемент',
                    subscription_name: 'Активный абонемент (8 занятий)',
                    subscription_status: 'Активирован',
                    subscription_active: 1,
                    total_classes: 8,
                    used_classes: 1,
                    remaining_classes: 7,
                    activation_date: '2026-01-17',
                    expiration_date: '2026-04-11',
                    last_visit_date: '2026-01-17',
                    certificate_number: '#28656433',
                    group_age: '8-10 лет',
                    purchase_date: '2026-01-17',
                    payment_method: 'Онлайн',
                    manager: 'Менеджер по продажам',
                    channel: 'Телеграм',
                    is_demo: 1
                },
                {
                    student_name: 'Иванов Иван',
                    phone_number: '+79680175895',
                    email: 'ivanov@example.com',
                    branch: 'Свиблово',
                    subscription_type: 'Активный абонемент',
                    subscription_name: 'Активный абонемент (12 занятий)',
                    subscription_status: 'Активирован',
                    subscription_active: 1,
                    total_classes: 12,
                    used_classes: 4,
                    remaining_classes: 8,
                    activation_date: '2026-01-10',
                    expiration_date: '2026-04-10',
                    last_visit_date: '2026-01-20',
                    is_demo: 1
                }
            ];
            
            for (const student of testStudents) {
                await db.run(
                    `INSERT OR IGNORE INTO student_profiles 
                     (student_name, phone_number, email, branch, 
                      subscription_type, subscription_name, subscription_status, subscription_active,
                      total_classes, used_classes, remaining_classes,
                      activation_date, expiration_date, last_visit_date,
                      certificate_number, group_age, purchase_date, payment_method,
                      manager, channel, is_demo, source) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        student.student_name,
                        student.phone_number,
                        student.email,
                        student.branch,
                        student.subscription_type,
                        student.subscription_name,
                        student.subscription_status,
                        student.subscription_active,
                        student.total_classes,
                        student.used_classes,
                        student.remaining_classes,
                        student.activation_date,
                        student.expiration_date,
                        student.last_visit_date,
                        student.certificate_number,
                        student.group_age,
                        student.purchase_date,
                        student.payment_method,
                        student.manager,
                        student.channel,
                        student.is_demo,
                        'demo'
                    ]
                );
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
        version: '3.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        data_source: amoCrmService.isInitialized ? 'Реальные данные из amoCRM' : 'Локальные данные'
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
                 ORDER BY 
                    subscription_active DESC,
                    remaining_classes DESC,
                    updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            console.log(`📊 Найдено профилей в локальной БД: ${profiles.length}`);
        }
        
        // Форматируем профили для ответа
        const formattedProfiles = profiles.map(profile => ({
            id: profile.id,
            student_name: profile.student_name,
            phone_number: profile.phone_number,
            email: profile.email,
            branch: profile.branch,
            
            // Данные абонемента (ТОЧНО КАК В AMOCRM)
            subscription: {
                type: profile.subscription_type,
                name: profile.subscription_name,
                status: profile.subscription_status,
                active: profile.subscription_active === 1,
                
                // Количество занятий
                total_classes: profile.total_classes,
                used_classes: profile.used_classes,
                remaining_classes: profile.remaining_classes,
                
                // Даты
                activation_date: profile.activation_date,
                expiration_date: profile.expiration_date,
                last_visit_date: profile.last_visit_date,
                purchase_date: profile.purchase_date,
                
                // Дополнительная информация
                certificate_number: profile.certificate_number,
                lead_name: profile.lead_name,
                lead_price: profile.lead_price,
                payment_method: profile.payment_method,
                manager: profile.manager,
                channel: profile.channel,
                group_age: profile.group_age
            },
            
            // Расписание
            schedule: {
                day_of_week: profile.day_of_week,
                time_slot: profile.time_slot,
                teacher_name: profile.teacher_name
            },
            
            // Информация о родителе
            parent_name: profile.parent_name,
            
            // Техническая информация
            is_demo: profile.is_demo === 1,
            data_source: profile.source,
            updated_at: profile.updated_at
        }));
        
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
                    JSON.stringify({ user: tempUser, profiles: formattedProfiles }),
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
                profiles_count: formattedProfiles.length,
                amocrm_connected: amoCrmService.isInitialized
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        // Формируем ответ
        const responseData = {
            success: true,
            message: formattedProfiles.length > 0 ? 'Авторизация успешна' : 'Профили не найдены',
            data: {
                user: tempUser,
                profiles: formattedProfiles,
                total_profiles: formattedProfiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                data_quality: amoCrmService.isInitialized ? 'realtime' : 'cached',
                token: token
            }
        };
        
        console.log(`✅ Авторизация завершена успешно`);
        console.log(`📊 Отправлено профилей: ${formattedProfiles.length}`);
        
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
                 WHERE (amocrm_contact_id = ? AND student_name = ?)
                 OR (lead_id = ? AND lead_id IS NOT NULL)`,
                [profile.amocrm_contact_id, profile.student_name, profile.lead_id]
            );
            
            if (!existingProfile) {
                // Вставляем новый профиль
                await db.run(
                    `INSERT INTO student_profiles 
                     (amocrm_contact_id, parent_contact_id, lead_id, customer_id,
                      student_name, phone_number, email, birth_date, branch,
                      parent_name, day_of_week, time_slot, teacher_name, group_age,
                      subscription_type, subscription_name, subscription_status, subscription_active,
                      total_classes, used_classes, remaining_classes,
                      activation_date, expiration_date, last_visit_date, purchase_date,
                      certificate_number, lead_name, lead_price, lead_status,
                      payment_method, manager, channel,
                      custom_fields, raw_contact_data, is_demo, source, is_active) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        profile.amocrm_contact_id || null,
                        profile.parent_contact_id || null,
                        profile.lead_id || null,
                        profile.customer_id || null,
                        profile.student_name,
                        profile.phone_number,
                        profile.email || '',
                        profile.birth_date || '',
                        profile.branch || '',
                        profile.parent_name || '',
                        profile.day_of_week || '',
                        profile.time_slot || '',
                        profile.teacher_name || '',
                        profile.group_age || '',
                        profile.subscription_type || 'Без абонемента',
                        profile.subscription_name || '',
                        profile.subscription_status || '',
                        profile.subscription_active || 0,
                        profile.total_classes || 0,
                        profile.used_classes || 0,
                        profile.remaining_classes || 0,
                        profile.activation_date || '',
                        profile.expiration_date || '',
                        profile.last_visit_date || '',
                        profile.purchase_date || '',
                        profile.certificate_number || '',
                        profile.lead_name || '',
                        profile.lead_price || 0,
                        profile.lead_status || 0,
                        profile.payment_method || '',
                        profile.manager || '',
                        profile.channel || '',
                        profile.custom_fields || '{}',
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
                     parent_name = ?, day_of_week = ?, time_slot = ?, teacher_name = ?, group_age = ?,
                     subscription_type = ?, subscription_name = ?, subscription_status = ?, subscription_active = ?,
                     total_classes = ?, used_classes = ?, remaining_classes = ?,
                     activation_date = ?, expiration_date = ?, last_visit_date = ?, purchase_date = ?,
                     certificate_number = ?, lead_name = ?, lead_price = ?, lead_status = ?,
                     payment_method = ?, manager = ?, channel = ?,
                     custom_fields = ?, raw_contact_data = ?, 
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
                        profile.group_age || '',
                        profile.subscription_type || 'Без абонемента',
                        profile.subscription_name || '',
                        profile.subscription_status || '',
                        profile.subscription_active || 0,
                        profile.total_classes || 0,
                        profile.used_classes || 0,
                        profile.remaining_classes || 0,
                        profile.activation_date || '',
                        profile.expiration_date || '',
                        profile.last_visit_date || '',
                        profile.purchase_date || '',
                        profile.certificate_number || '',
                        profile.lead_name || '',
                        profile.lead_price || 0,
                        profile.lead_status || 0,
                        profile.payment_method || '',
                        profile.manager || '',
                        profile.channel || '',
                        profile.custom_fields || '{}',
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

// Получение детальной информации об абонементе
app.post('/api/subscription/detail', async (req, res) => {
    try {
        const { profile_id, phone } = req.body;
        
        console.log(`\n📋 ЗАПРОС ДЕТАЛЬНОЙ ИНФОРМАЦИИ ОБ АБОНЕМЕНТЕ`);
        
        let profile;
        if (profile_id) {
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE id = ?`,
                [profile_id]
            );
        } else if (phone) {
            const cleanPhone = phone.replace(/\D/g, '').slice(-10);
            profile = await db.get(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1 
                 ORDER BY subscription_active DESC, updated_at DESC LIMIT 1`,
                [`%${cleanPhone}%`]
            );
        }
        
        if (!profile) {
            console.log(`📭 Профиль не найден`);
            return res.status(404).json({
                success: false,
                error: 'Профиль не найден'
            });
        }
        
        console.log(`✅ Найден профиль: ${profile.student_name}`);
        
        // Форматируем ответ ТОЧНО КАК В AMOCRM
        const response = {
            success: true,
            data: {
                // Основная информация
                student: {
                    name: profile.student_name,
                    phone: profile.phone_number,
                    email: profile.email,
                    branch: profile.branch,
                    birth_date: profile.birth_date,
                    group_age: profile.group_age
                },
                
                // Абонемент (ТОЧНО КАК В AMOCRM)
                subscription: {
                    // Заголовок как в карточке
                    title: `${profile.student_name} - ${profile.total_classes} занятий`,
                    
                    // Основная информация
                    type: profile.subscription_type,
                    name: profile.subscription_name,
                    status: profile.subscription_status,
                    is_active: profile.subscription_active === 1,
                    
                    // Количество занятий (ТОЧНО КАК В AMOCRM)
                    classes: {
                        total: profile.total_classes,
                        used: profile.used_classes,
                        remaining: profile.remaining_classes,
                        progress: profile.total_classes > 0 ? 
                            Math.round((profile.used_classes / profile.total_classes) * 100) : 0
                    },
                    
                    // Даты (ТОЧНО КАК В AMOCRM)
                    dates: {
                        activation: profile.activation_date,
                        expiration: profile.expiration_date,
                        last_visit: profile.last_visit_date,
                        purchase: profile.purchase_date
                    },
                    
                    // Дополнительная информация
                    details: {
                        certificate_number: profile.certificate_number,
                        lead_id: profile.lead_id ? `#${profile.lead_id}` : null,
                        lead_name: profile.lead_name,
                        price: profile.lead_price,
                        payment_method: profile.payment_method,
                        manager: profile.manager,
                        channel: profile.channel
                    },
                    
                    // Расписание
                    schedule: {
                        day_of_week: profile.day_of_week,
                        time_slot: profile.time_slot,
                        teacher: profile.teacher_name
                    },
                    
                    // Информация о родителе
                    parent: {
                        name: profile.parent_name,
                        contact_id: profile.parent_contact_id
                    }
                },
                
                // Метрики
                metrics: {
                    is_demo: profile.is_demo === 1,
                    data_source: profile.source,
                    last_updated: profile.updated_at,
                    data_freshness: amoCrmService.isInitialized ? 'realtime' : 'cached'
                }
            }
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('Ошибка получения детальной информации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
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
                 ORDER BY 
                    subscription_active DESC,
                    remaining_classes DESC,
                    updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
        }
        
        // Форматируем ответ
        const formattedProfiles = profiles.map(p => ({
            id: p.id,
            student_name: p.student_name,
            subscription: {
                title: `${p.student_name} - ${p.total_classes} занятий`,
                name: p.subscription_name,
                status: p.subscription_status,
                is_active: p.subscription_active === 1,
                total_classes: p.total_classes,
                remaining_classes: p.remaining_classes,
                expiration_date: p.expiration_date,
                branch: p.branch
            },
            is_demo: p.is_demo === 1
        }));
        
        res.json({
            success: true,
            data: {
                profiles: formattedProfiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                data_quality: amoCrmService.isInitialized ? 'realtime' : 'cached'
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

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v3.0');
        console.log('='.repeat(80));
        console.log('✨ ТОЧНОЕ ОТОБРАЖЕНИЕ ДАННЫХ ИЗ AMOCRM');
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
            console.log(`📋 Загружено полей: контакты(${Object.keys(amoCrmService.fieldMapping.contact || {}).length/2}), сделки(${Object.keys(amoCrmService.fieldMapping.lead || {}).length/2})`);
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
            console.log(`📊 База данных: SQLite с расширенной схемой`);
            console.log(`🔗 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log('='.repeat(50));
            
            console.log('\n📋 ОТОБРАЖАЕМЫЕ ДАННЫЕ:');
            console.log('='.repeat(50));
            console.log('✅ Имя ученика и количество занятий из названия сделки');
            console.log('✅ Статус "Активирован"/"Не активирован"');
            console.log('✅ Счетчик занятий и остаток (точно как в amoCRM)');
            console.log('✅ Даты активации, окончания, последнего визита');
            console.log('✅ Номер сертификата (если есть)');
            console.log('✅ Филиал и расписание');
            console.log('✅ Информация о менеджере и канале');
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
