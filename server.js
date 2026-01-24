// server.js - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ
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

// ==================== КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.fieldMappings = new Map();
        
       // Обновите FIELD_IDS в конструкторе AmoCrmService:
this.FIELD_IDS = {
    // Сделки (абонементы) - ПРОВЕРЕНО, ВЕРНО
    LEAD: {
        TOTAL_CLASSES: 850241,    // "Абонемент занятий:" ✓
        USED_CLASSES: 850257,     // "Счетчик занятий:" ✓  
        REMAINING_CLASSES: 890163, // "Остаток занятий" ✓
        EXPIRATION_DATE: 850255,  // "Окончание абонемента:" ✓
        ACTIVATION_DATE: 851565,  // "Дата активации абонемента:" ✓
        LAST_VISIT_DATE: 850259,  // "Дата последнего визита:" ✓
        SUBSCRIPTION_TYPE: 891007, // "Тип абонемента" ✓
        BRANCH: null,             // "Филиал" в сделке - ⚠️ НЕ НАЙДЕН
        AGE_GROUP: 850243,        // "Группа возраст:" ✓
        FREEZE: 867693,           // "Заморозка абонемента:" ✓
        SUBSCRIPTION_OWNER: 805465, // "Принадлежность абонемента:" ✓
        
        // Поля для посещений (checkbox) - все ✓
        CLASS_1: 884899, CLASS_2: 884901, CLASS_3: 884903, CLASS_4: 884905,
        CLASS_5: 884907, CLASS_6: 884909, CLASS_7: 884911, CLASS_8: 884913,
        CLASS_9: 884915, CLASS_10: 884917, CLASS_11: 884919, CLASS_12: 884921,
        CLASS_13: 884923, CLASS_14: 884925, CLASS_15: 884927, CLASS_16: 884929,
        CLASS_17: 892867, CLASS_18: 892871, CLASS_19: 892875, CLASS_20: 892879,
        CLASS_21: 892883, CLASS_22: 892887, CLASS_23: 892893, CLASS_24: 892895
    },
    
    // Контакты (ученики) - ОБНОВЛЕНО НА ОСНОВЕ ДАННЫХ
    CONTACT: {
        // Дети - ПРОВЕРЕНО, ВЕРНО
        CHILD_1_NAME: 867233,    // "!ФИО ребенка:" ✓
        CHILD_1_BIRTHDAY: null,  // ДР ребенка 1 - НЕТ В ДАННЫХ
        CHILD_2_NAME: 867235,    // "!!ФИО ребенка:" ✓
        CHILD_2_BIRTHDAY: 867685, // "День рождения:" для ребенка 2 ✓
        CHILD_3_NAME: 867733,    // "!!!ФИО ребенка:" ✓
        CHILD_3_BIRTHDAY: 867735, // "День рождения:" для ребенка 3 ✓
        
        // Основные поля - ПРОВЕРЕНО, ВЕРНО
        BRANCH: 871273,          // "Филиал:" ✓
        TEACHER: 888881,         // "Преподаватель" ✓
        DAY_OF_WEEK: 892225,     // "День недели (2025-26)" ✓ ИЛИ 888879
        HAS_ACTIVE_SUB: 890179,  // "Есть активный абонемент" ✓
        LAST_VISIT: 885380,      // "Дата последнего визита" ✓
        AGE_GROUP: 888903,       // "Возраст группы" ✓
        ALLERGIES: 850239,       // "Аллергия и особенности:" ✓
        BIRTH_DATE: 850219,      // "День рождения:" (родителя) ✓
        
        // Общие поля
        PARENT_NAME: 'name',      // Имя контакта
        EMAIL: 216617            // "Email" поле ✓
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
                    await this.loadFieldMappings();
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

// В класс AmoCrmService добавьте этот метод:
async debugSubscriptionExtraction(leadId) {
    try {
        console.log(`\n🔍 ДИАГНОСТИКА ИЗВЛЕЧЕНИЯ АБОНЕМЕНТА ИЗ СДЕЛКИ: ${leadId}`);
        console.log('='.repeat(70));
        
        // Получаем сделку
        const lead = await this.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        console.log(`📋 Название: "${lead.name || 'Нет названия'}"`);
        console.log(`🔢 ID: ${lead.id}`);
        console.log(`📊 Статус ID: ${lead.status_id || 0}`);
        
        const customFields = lead.custom_fields_values || [];
        console.log(`\n📊 ПОЛЯ СДЕЛКИ (${customFields.length}):`);
        console.log('='.repeat(70));
        
        // Выводим все поля
        customFields.forEach(field => {
            const fieldId = field.field_id || field.id;
            const fieldName = this.getFieldName(field);
            const fieldValue = this.getFieldValue(field);
            const fieldType = field.field_type || 'unknown';
            
            console.log(`   ID:${fieldId} "${fieldName}" (${fieldType}) = "${fieldValue}"`);
            
            // Показываем значения для отладки
            if (field.values && Array.isArray(field.values) && field.values.length > 0) {
                field.values.forEach((val, idx) => {
                    console.log(`       [${idx}] ${JSON.stringify(val)}`);
                });
            }
        });
        
        // Теперь вызываем extractSubscriptionInfo и смотрим что получается
        console.log('\n🔍 ВЫЗОВ extractSubscriptionInfo:');
        const subscriptionInfo = this.extractSubscriptionInfo(lead);
        
        console.log('\n📊 РЕЗУЛЬТАТ extractSubscriptionInfo:');
        console.log('='.repeat(70));
        console.log(`   • hasSubscription: ${subscriptionInfo.hasSubscription}`);
        console.log(`   • totalClasses: ${subscriptionInfo.totalClasses}`);
        console.log(`   • usedClasses: ${subscriptionInfo.usedClasses}`);
        console.log(`   • remainingClasses: ${subscriptionInfo.remainingClasses}`);
        console.log(`   • subscriptionType: ${subscriptionInfo.subscriptionType}`);
        console.log(`   • subscriptionActive: ${subscriptionInfo.subscriptionActive}`);
        console.log(`   • activationDate: ${subscriptionInfo.activationDate}`);
        console.log(`   • expirationDate: ${subscriptionInfo.expirationDate}`);
        console.log(`   • lastVisitDate: ${subscriptionInfo.lastVisitDate}`);
        console.log(`   • subscriptionStatus: ${subscriptionInfo.subscriptionStatus}`);
        console.log(`   • subscriptionBadge: ${subscriptionInfo.subscriptionBadge}`);
        console.log(`   • isFrozen: ${subscriptionInfo.isFrozen}`);
        
        // Проверяем парсинг названия
        console.log('\n🔍 ПРОВЕРКА ПАРСИНГА НАЗВАНИЯ:');
        const nameClasses = this.parseLeadNameForSubscription(lead.name || '');
        console.log(`   parseLeadNameForSubscription: ${nameClasses} занятий`);
        
        return {
            lead: lead,
            subscriptionInfo: subscriptionInfo,
            parsedNameClasses: nameClasses
        };
        
    } catch (error) {
        console.error(`❌ Ошибка диагностики сделки ${leadId}:`, error.message);
        return null;
    }
}
    
    async loadFieldMappings() {
        try {
            console.log('📋 Загрузка полей amoCRM...');
            const fields = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
            
            this.fieldMappings.clear();
            if (fields && fields._embedded && fields._embedded.custom_fields) {
                fields._embedded.custom_fields.forEach(field => {
                    this.fieldMappings.set(field.id, {
                        name: field.name,
                        type: field.type,
                        enums: field.enums || []
                    });
                });
            }
            
            console.log(`✅ Загружено полей: ${this.fieldMappings.size}`);
            return this.fieldMappings;
        } catch (error) {
            console.error('❌ Ошибка загрузки полей:', error.message);
            return new Map();
        }
    }

// В класс AmoCrmService добавьте метод:
async debugContactFields() {
    try {
        console.log('\n📋 ПОЛУЧЕНИЕ ПОЛЕЙ КОНТАКТОВ');
        const fields = await this.makeRequest('GET', '/api/v4/contacts/custom_fields');
        
        const contactFields = [];
        const childFields = [];
        const allContactFields = [];
        
        if (fields && fields._embedded && fields._embedded.custom_fields) {
            fields._embedded.custom_fields.forEach(field => {
                const fieldInfo = {
                    id: field.id,
                    name: field.name,
                    type: field.type,
                    enums: field.enums || []
                };
                
                allContactFields.push(fieldInfo);
                
                // Ищем поля детей
                if (field.name.toLowerCase().includes('ребен') || 
                    field.name.toLowerCase().includes('фио') ||
                    field.name.toLowerCase().includes('др') ||
                    field.name.toLowerCase().includes('день рождения')) {
                    childFields.push(fieldInfo);
                }
                
                // Ищем другие важные поля
                if (field.name.toLowerCase().includes('филиал') ||
                    field.name.toLowerCase().includes('преподаватель') ||
                    field.name.toLowerCase().includes('день недели') ||
                    field.name.toLowerCase().includes('абонемент') ||
                    field.name.toLowerCase().includes('аллерги')) {
                    contactFields.push(fieldInfo);
                }
            });
        }
        
        console.log(`\n👤 ПОЛЯ ДЕТЕЙ (${childFields.length}):`);
        childFields.forEach(f => {
            console.log(`   ID: ${f.id} - "${f.name}" (${f.type})`);
        });
        
        console.log(`\n📍 ДРУГИЕ ВАЖНЫЕ ПОЛЯ (${contactFields.length}):`);
        contactFields.forEach(f => {
            console.log(`   ID: ${f.id} - "${f.name}" (${f.type})`);
        });
        
        console.log(`\n📊 ВСЕГО ПОЛЕЙ КОНТАКТОВ: ${allContactFields.length}`);
        
        return {
            childFields,
            contactFields,
            allContactFields
        };
        
    } catch (error) {
        console.error('❌ Ошибка получения полей контактов:', error.message);
        return { childFields: [], contactFields: [], allContactFields: [] };
    }
}

    // В класс AmoCrmService добавьте метод:
async debugContactAnalysis(contactId) {
    try {
        console.log(`\n🔍 ПОЛНАЯ ДИАГНОСТИКА КОНТАКТА ID: ${contactId}`);
        console.log('='.repeat(60));
        
        // Получаем контакт с полями
        const contact = await this.getFullContactInfo(contactId);
        if (!contact) {
            console.log('❌ Контакт не найден');
            return null;
        }
        
        console.log(`👤 Контакт: ${contact.name || 'Без имени'}`);
        console.log(`📅 Создан: ${contact.created_at}`);
        console.log(`🔄 Обновлен: ${contact.updated_at}`);
        
        // Показываем все поля контакта
        const customFields = contact.custom_fields_values || [];
        console.log(`\n📊 ВСЕ ПОЛЯ КОНТАКТА (${customFields.length}):`);
        console.log('='.repeat(60));
        
        customFields.forEach(field => {
            const fieldId = field.field_id || field.id;
            const fieldName = this.getFieldName(field);
            const fieldValue = this.getFieldValue(field);
            
            console.log(`   ID: ${fieldId} - "${fieldName}": "${fieldValue}"`);
            
            // Показываем значения enum, если есть
            if (field.values && Array.isArray(field.values) && field.values.length > 0) {
                field.values.forEach((val, idx) => {
                    if (val && typeof val === 'object') {
                        console.log(`       Значение ${idx}: ${JSON.stringify(val)}`);
                    }
                });
            }
        });
        
        // Извлекаем учеников
        console.log(`\n👶 ИЗВЛЕЧЕНИЕ УЧЕНИКОВ:`);
        const students = this.extractStudentsFromContact(contact);
        console.log(`📊 Найдено учеников: ${students.length}`);
        
        students.forEach((student, idx) => {
            console.log(`\n   Ученик ${idx + 1}:`);
            console.log(`     Имя: ${student.studentName}`);
            console.log(`     ДР: ${student.birthDate}`);
            console.log(`     Филиал: ${student.branch}`);
            console.log(`     Преподаватель: ${student.teacherName}`);
            console.log(`     День недели: ${student.dayOfWeek}`);
            console.log(`     Email: ${student.email}`);
            console.log(`     Активный абонемент: ${student.hasActiveSubscription ? 'Да' : 'Нет'}`);
        });
        
        // Получаем сделки контакта
        console.log(`\n📋 ПОЛУЧЕНИЕ СДЕЛОК КОНТАКТА:`);
        const leads = await this.getContactLeadsSorted(contactId);
        console.log(`📊 Найдено сделок: ${leads.length}`);
        
        // Анализируем каждую сделку
        console.log(`\n🔍 АНАЛИЗ СДЕЛОК:`);
        const leadsAnalysis = [];
        
        for (const lead of leads) {
            console.log(`\n   📋 Сделка: "${lead.name || 'Без названия'}" (ID: ${lead.id})`);
            
            const subscriptionInfo = this.extractSubscriptionInfo(lead);
            
            console.log(`     • Всего занятий: ${subscriptionInfo.totalClasses}`);
            console.log(`     • Использовано: ${subscriptionInfo.usedClasses}`);
            console.log(`     • Осталось: ${subscriptionInfo.remainingClasses}`);
            console.log(`     • Статус: ${subscriptionInfo.subscriptionStatus}`);
            console.log(`     • Активен: ${subscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
            
            leadsAnalysis.push({
                leadId: lead.id,
                leadName: lead.name,
                subscriptionInfo
            });
        }
        
        return {
            contact: {
                id: contact.id,
                name: contact.name,
                fields: customFields,
                students: students
            },
            leads: leadsAnalysis
        };
        
    } catch (error) {
        console.error(`❌ Ошибка диагностики контакта ${contactId}:`, error.message);
        return null;
    }
}

// 🔧 МЕТОД: debugStudentSearch - для тестирования
async debugStudentSearch(phoneNumber) {
    try {
        console.log(`\n🔍 ПОЛНАЯ ДИАГНОСТИКА ПОИСКА УЧЕНИКА: ${phoneNumber}`);
        console.log('='.repeat(80));
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return null;
        }
        
        // 1. Ищем контакты
        const contactsResponse = await this.searchContactsByPhone(phoneNumber);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        const results = [];
        
        for (const contact of contacts) {
            console.log(`\n👤 Контакт: ${contact.name} (ID: ${contact.id})`);
            
            // Получаем полный контакт
            const fullContact = await this.getFullContactInfo(contact.id);
            const children = this.extractStudentsFromContact(fullContact);
            
            console.log(`📊 Детей в контакте: ${children.length}`);
            
            // Получаем сделки
            const leads = await this.getContactLeadsSorted(contact.id);
            console.log(`📊 Сделок у контакта: ${leads.length}`);
            
            // Для каждого ребенка ищем лучшую сделку
            for (const child of children) {
                console.log(`\n🎯 Ребенок: "${child.studentName}"`);
                
                const bestLead = this.findBestLeadForStudent(child.studentName, leads);
                
                results.push({
                    contact: fullContact.name,
                    contactId: fullContact.id,
                    student: child,
                    bestLead: bestLead ? {
                        id: bestLead.id,
                        name: bestLead.name,
                        subscriptionInfo: this.extractSubscriptionInfo(bestLead)
                    } : null,
                    totalLeads: leads.length,
                    leadsWithSubscription: leads.filter(l => this.extractSubscriptionInfo(l).hasSubscription).length
                });
            }
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('📊 ИТОГИ ПОИСКА:');
        console.log('='.repeat(80));
        
        results.forEach((result, index) => {
            console.log(`\n${index + 1}. ${result.student.studentName}:`);
            console.log(`   • Контакт: ${result.contact} (ID: ${result.contactId})`);
            console.log(`   • Всего сделок: ${result.totalLeads}`);
            console.log(`   • Сделок с абонементом: ${result.leadsWithSubscription}`);
            
            if (result.bestLead) {
                console.log(`   ✅ Найдена сделка: "${result.bestLead.name}"`);
                console.log(`      ID: ${result.bestLead.id}`);
                console.log(`      Абонемент: ${result.bestLead.subscriptionInfo.subscriptionStatus}`);
                console.log(`      Занятий: ${result.bestLead.subscriptionInfo.usedClasses}/${result.bestLead.subscriptionInfo.totalClasses}`);
            } else {
                console.log(`   ❌ Сделка не найдена`);
            }
        });
        
        return results;
        
    } catch (error) {
        console.error('❌ Ошибка диагностики поиска:', error.message);
        return null;
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
                console.error(`📋 Данные:`, error.response.data);
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
            
            console.log(`🔍 Форматированный номер для поиска: ${searchPhone}`);
            
            const response = await this.makeRequest(
                'GET', 
                `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=leads,custom_fields_values`
            );
            
            console.log(`📊 Найдено контактов: ${response._embedded?.contacts?.length || 0}`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
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
        isFrozen: false,
        rawData: {}
    };
    
    if (!lead) {
        return subscriptionInfo;
    }
    
    try {
        const customFields = lead.custom_fields_values || [];
        const leadName = lead.name || '';
        const now = new Date();
        
        console.log(`\n🎫 АНАЛИЗ АБОНЕМЕНТА: "${leadName}"`);
        
        // ВАЖНО: Ищем ВСЕ возможные поля
        let fieldData = {
            totalClasses: 0,
            usedClasses: 0,
            remainingClasses: 0,
            expirationDate: null,
            activationDate: null,
            lastVisitDate: null,
            subscriptionType: '',
            isFrozen: false,
            counterValue: 0
        };
        
        // 1. СБОР ДАННЫХ ИЗ ВСЕХ ВОЗМОЖНЫХ ПОЛЕЙ
        for (const field of customFields) {
            const fieldId = field.field_id || field.id;
            const fieldValue = this.getFieldValue(field);
            
            if (!fieldValue) continue;
            
            // ВАЖНО: Сначала ищем по конкретным ID полей из вашего примера
            if (fieldId === 850241) { // "абонемент занятий:"
                const classes = this.parseNumberFromString(fieldValue);
                if (classes > 0) {
                    fieldData.totalClasses = classes;
                    console.log(`📊 [850241] Абонемент занятий: ${classes}`);
                }
            }
            else if (fieldId === 891819) { // "количество занятий (тех)"
                const classes = parseInt(fieldValue) || 0;
                if (classes > 0 && fieldData.totalClasses === 0) {
                    fieldData.totalClasses = classes;
                    console.log(`📊 [891819] Количество занятий (тех): ${classes}`);
                }
            }
            else if (fieldId === 850257) { // "счетчик занятий:"
                const used = parseInt(fieldValue) || 0;
                fieldData.usedClasses = used;
                fieldData.counterValue = used;
                console.log(`📊 [850257] Счетчик занятий: ${used}`);
            }
            else if (fieldId === 890163) { // "остаток занятий"
                const remaining = parseInt(fieldValue) || 0;
                fieldData.remainingClasses = remaining;
                console.log(`📊 [890163] Остаток занятий: ${remaining}`);
            }
            else if (fieldId === 891007) { // "тип абонемента"
                fieldData.subscriptionType = fieldValue;
                console.log(`📊 [891007] Тип абонемента: ${fieldValue}`);
            }
            else if (fieldId === 850255) { // "окончание абонемента:"
                fieldData.expirationDate = this.parseDateOrTimestamp(fieldValue);
                console.log(`📊 [850255] Окончание: ${fieldData.expirationDate}`);
            }
            else if (fieldId === 851565) { // "дата активации абонемента:"
                fieldData.activationDate = this.parseDateOrTimestamp(fieldValue);
                console.log(`📊 [851565] Активация: ${fieldData.activationDate}`);
            }
            else if (fieldId === 850259) { // "дата последнего визита:"
                fieldData.lastVisitDate = this.parseDateOrTimestamp(fieldValue);
                console.log(`📊 [850259] Последний визит: ${fieldData.lastVisitDate}`);
            }
            else if (fieldId === 867693) { // "заморозка абонемента:"
                const freezeValue = String(fieldValue).toLowerCase();
                fieldData.isFrozen = freezeValue === 'да' || freezeValue === 'true' || freezeValue === '1';
                console.log(`📊 [867693] Заморожен: ${fieldData.isFrozen}`);
            }
            
            // Также проверяем чекбоксы посещений
            if (fieldId >= 884899 && fieldId <= 884929) { // чекбоксы занятий 1-16
                const isChecked = fieldValue === 'true' || fieldValue === '1' || fieldValue === true;
                if (isChecked) {
                    fieldData.usedClasses++;
                }
            }
        }
        
        // 2. ПАРСИМ НАЗВАНИЕ СДЕЛКИ (как запасной вариант)
        if (fieldData.totalClasses === 0) {
            const nameClasses = this.parseLeadNameForSubscription(leadName);
            if (nameClasses > 0) {
                fieldData.totalClasses = nameClasses;
                console.log(`📊 Из названия: ${nameClasses} занятий`);
            }
        }
        
        // 3. РАСЧЕТ ОСНОВНЫХ ПОКАЗАТЕЛЕЙ
        
        // Всего занятий
        subscriptionInfo.totalClasses = fieldData.totalClasses;
        
        // Использовано занятий (приоритет: счетчик > чекбоксы)
        if (fieldData.counterValue > 0) {
            subscriptionInfo.usedClasses = fieldData.counterValue;
        } else if (fieldData.usedClasses > 0) {
            subscriptionInfo.usedClasses = fieldData.usedClasses;
        }
        
        // Остаток занятий (приоритет: поле > расчет)
        if (fieldData.remainingClasses > 0) {
            subscriptionInfo.remainingClasses = fieldData.remainingClasses;
        } else if (subscriptionInfo.totalClasses > 0) {
            subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
        }
        
        // 4. ОПРЕДЕЛЕНИЕ СТАТУСА
        
        // Проверка срока действия
        let isExpired = false;
        if (fieldData.expirationDate) {
            try {
                const expDate = new Date(fieldData.expirationDate);
                isExpired = expDate < now;
            } catch (e) {}
        }
        
        // Проверка условий
        const hasClasses = subscriptionInfo.totalClasses > 0;
        const hasRemaining = subscriptionInfo.remainingClasses > 0;
        const hasUsed = subscriptionInfo.usedClasses > 0;
        const leadNameLower = leadName.toLowerCase();
        const hasEndedInName = leadNameLower.includes('закончился') || 
                               leadNameLower.includes('истек') ||
                               leadNameLower.includes('закончился');
        
        subscriptionInfo.hasSubscription = hasClasses;
        subscriptionInfo.subscriptionType = fieldData.subscriptionType;
        subscriptionInfo.activationDate = fieldData.activationDate;
        subscriptionInfo.expirationDate = fieldData.expirationDate;
        subscriptionInfo.lastVisitDate = fieldData.lastVisitDate;
        subscriptionInfo.isFrozen = fieldData.isFrozen;
        
        // ЛОГИКА ОПРЕДЕЛЕНИЯ СТАТУСА
        if (fieldData.isFrozen) {
            subscriptionInfo.subscriptionStatus = 'Абонемент заморожен';
            subscriptionInfo.subscriptionBadge = 'frozen';
            subscriptionInfo.subscriptionActive = false;
        }
        else if (isExpired && !hasEndedInName) {
            subscriptionInfo.subscriptionStatus = 'Абонемент истек';
            subscriptionInfo.subscriptionBadge = 'expired';
            subscriptionInfo.subscriptionActive = false;
        }
        else if (!hasRemaining || hasEndedInName) {
            subscriptionInfo.subscriptionStatus = 'Занятия закончились';
            subscriptionInfo.subscriptionBadge = 'expired';
            subscriptionInfo.subscriptionActive = false;
        }
        else if (hasRemaining && hasUsed) {
            subscriptionInfo.subscriptionStatus = `Активный (осталось ${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
            subscriptionInfo.subscriptionBadge = 'active';
            subscriptionInfo.subscriptionActive = true;
        }
        else if (hasRemaining && !hasUsed) {
            subscriptionInfo.subscriptionStatus = `Купленный (${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
            subscriptionInfo.subscriptionBadge = 'has_subscription';
            subscriptionInfo.subscriptionActive = true;
        }
        else if (hasClasses) {
            subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий`;
            subscriptionInfo.subscriptionBadge = 'has_subscription';
            subscriptionInfo.subscriptionActive = true;
        }
        
        console.log(`\n✅ РЕЗУЛЬТАТ:`);
        console.log(`   • Абонемент: ${subscriptionInfo.hasSubscription ? 'Да' : 'Нет'}`);
        console.log(`   • Всего: ${subscriptionInfo.totalClasses} занятий`);
        console.log(`   • Использовано: ${subscriptionInfo.usedClasses}`);
        console.log(`   • Осталось: ${subscriptionInfo.remainingClasses}`);
        console.log(`   • Статус: ${subscriptionInfo.subscriptionStatus}`);
        console.log(`   • Активен: ${subscriptionInfo.subscriptionActive}`);
        
        return subscriptionInfo;
        
    } catch (error) {
        console.error('❌ Ошибка извлечения абонемента:', error);
        return subscriptionInfo;
    }
}

// 🔧 ДОПОЛНИТЕЛЬНЫЙ МЕТОД: parseNumberFromString
parseNumberFromString(value) {
    if (!value) return 0;
    
    try {
        const str = String(value).toLowerCase();
        
        // Специальные случаи
        if (str.includes('разовый') || str.includes('пробное')) {
            return 1;
        }
        
        // Ищем числа
        const match = str.match(/(\d+)/);
        if (match) {
            return parseInt(match[1]);
        }
        
        // Проверяем русские числительные
        if (str.includes('четыре') || str.includes('4 занятия')) {
            return 4;
        }
        if (str.includes('восемь') || str.includes('8 занятий')) {
            return 8;
        }
        if (str.includes('шестнадцать') || str.includes('16 занятий')) {
            return 16;
        }
        
        return 0;
    } catch (error) {
        console.error('❌ Ошибка парсинга числа:', error);
        return 0;
    }
}

// 🔧 МЕТОД: debugSubscriptionAnalysis
async debugSubscriptionAnalysis(leadId) {
    try {
        console.log(`\n🔍 ПОЛНЫЙ АНАЛИЗ АБОНЕМЕНТА ID: ${leadId}`);
        
        // Получаем сделку
        const lead = await this.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        const customFields = lead.custom_fields_values || [];
        
        console.log(`\n📋 СДЕЛКА: "${lead.name}"`);
        console.log(`📅 Статус ID: ${lead.status_id}`);
        console.log(`📊 Цена: ${lead.price}`);
        
        // Анализируем ВСЕ поля
        console.log('\n📊 ВСЕ ПОЛЯ СДЕЛКИ:');
        console.log('='.repeat(60));
        
        const importantFields = [];
        const allFields = [];
        
        customFields.forEach(field => {
            const fieldId = field.field_id || field.id;
            const fieldName = this.getFieldName(field);
            const fieldValue = this.getFieldValue(field);
            const fieldType = field.field_type || 'unknown';
            
            allFields.push({
                id: fieldId,
                name: fieldName,
                value: fieldValue,
                type: fieldType
            });
            
            // Показываем все поля
            console.log(`ID:${fieldId} "${fieldName}" = "${fieldValue}" (${fieldType})`);
            
            // Отмечаем важные поля
            const isImportant = [
                850241, 891819, 850257, 890163, 891007, 850255,
                851565, 850259, 867693, 884899, 884901, 884903,
                884905, 884907, 884909, 884911, 884913, 884915,
                884917, 884919, 884921, 884923, 884925, 884927,
                884929
            ].includes(fieldId);
            
            if (isImportant) {
                importantFields.push({
                    id: fieldId,
                    name: fieldName,
                    value: fieldValue,
                    description: this.getFieldDescription(fieldId)
                });
            }
        });
        
        // Анализ по моему новому методу
        console.log('\n🔍 АНАЛИЗ ПО НОВОМУ МЕТОДУ:');
        console.log('='.repeat(60));
        
        const subscriptionInfo = this.extractSubscriptionInfo(lead);
        
        console.log('\n📈 ИТОГОВЫЕ ДАННЫЕ:');
        console.log('='.repeat(60));
        console.log(`Всего занятий: ${subscriptionInfo.totalClasses}`);
        console.log(`Использовано: ${subscriptionInfo.usedClasses}`);
        console.log(`Осталось: ${subscriptionInfo.remainingClasses}`);
        console.log(`Статус: ${subscriptionInfo.subscriptionStatus}`);
        console.log(`Активен: ${subscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
        
        return {
            success: true,
            data: {
                leadId: lead.id,
                leadName: lead.name,
                subscriptionInfo: subscriptionInfo,
                importantFields: importantFields,
                allFields: allFields,
                summary: {
                    totalFields: customFields.length,
                    importantCount: importantFields.length,
                    hasSubscription: subscriptionInfo.hasSubscription,
                    shouldBeActive: subscriptionInfo.subscriptionActive
                }
            }
        };
        
    } catch (error) {
        console.error('❌ Ошибка анализа:', error);
        return { success: false, error: error.message };
    }
}

// 🔧 ВСПОМОГАТЕЛЬНЫЙ МЕТОД: getFieldDescription
getFieldDescription(fieldId) {
    const descriptions = {
        850241: 'Абонемент занятий: (основное поле)',
        891819: 'Количество занятий (тех) (техническое поле)',
        850257: 'Счетчик занятий: (использовано)',
        890163: 'Остаток занятий (осталось)',
        891007: 'Тип абонемента',
        850255: 'Окончание абонемента:',
        851565: 'Дата активации абонемента:',
        850259: 'Дата последнего визита:',
        867693: 'Заморозка абонемента:',
        884899: '1 занятие (чекбокс)',
        884901: '2 занятие (чекбокс)',
        884903: '3 занятие (чекбокс)',
        884905: '4 занятие (чекбокс)',
        884907: '5 занятие (чекбокс)',
        884909: '6 занятие (чекбокс)',
        884911: '7 занятие (чекбокс)',
        884913: '8 занятие (чекбокс)',
        884915: '9 занятие (чекбокс)',
        884917: '10 занятие (чекбокс)',
        884919: '11 занятие (чекбокс)',
        884921: '12 занятие (чекбокс)',
        884923: '13 занятие (чекбокс)',
        884925: '14 занятие (чекбокс)',
        884927: '15 занятие (чекбокс)',
        884929: '16 занятие (чекбокс)'
    };
    
    return descriptions[fieldId] || `Неизвестное поле (${fieldId})`;
}
    
    // 🔧 ДОБАВЛЕННЫЙ МЕТОД: parseDateOrTimestamp
    parseDateOrTimestamp(value) {
        if (!value) return null;
        
        try {
            const str = String(value).trim();
            
            // Если это timestamp (число)
            if (/^\d+$/.test(str)) {
                const timestamp = parseInt(str);
                // Проверяем, в секундах или миллисекундах
                const date = timestamp < 10000000000 
                    ? new Date(timestamp * 1000) // секунды -> миллисекунды
                    : new Date(timestamp); // уже миллисекунды
                
                return date.toISOString().split('T')[0]; // Возвращаем YYYY-MM-DD
            }
            
            // Если это уже дата в формате YYYY-MM-DD
            if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
                return str;
            }
            
            // Пытаемся распарсить как обычную дату
            return this.parseDate(str);
            
        } catch (error) {
            console.error('❌ Ошибка парсинга даты/таймстампа:', error);
            return value;
        }
    }
    
   // 🔧 УЛУЧШЕННЫЙ МЕТОД: extractStudentsFromContact
// 🔧 ДОБАВЬТЕ В extractStudentsFromContact логику для нескольких детей
extractStudentsFromContact(contact) {
    const students = [];
    
    try {
        const customFields = contact.custom_fields_values || [];
        const contactName = contact.name || '';
        
        console.log(`\n👤 Поиск детей в контакте: "${contactName}"`);
        
        // Для каждого возможного ребенка
        const childrenConfig = [
            { number: 1, nameFieldId: 867233 }, // !ФИО ребенка:
            { number: 2, nameFieldId: 867235 }, // !!ФИО ребенка:
            { number: 3, nameFieldId: 867733 }  // !!!ФИО ребенка:
        ];
        
        for (const childConfig of childrenConfig) {
            let childInfo = {
                studentName: '',
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
            
            let hasChildData = false;
            
            // Ищем имя ребенка
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                if (fieldId === childConfig.nameFieldId) {
                    childInfo.studentName = fieldValue.trim();
                    hasChildData = true;
                    console.log(`✅ Найден ребенок ${childConfig.number}: ${childInfo.studentName}`);
                    break;
                }
            }
            
            // Если нашли имя ребенка, ищем остальные поля
            if (hasChildData && childInfo.studentName) {
                // Теперь ищем остальные поля для этого ребенка
                for (const field of customFields) {
                    const fieldId = field.field_id || field.id;
                    const fieldName = this.getFieldName(field).toLowerCase();
                    const fieldValue = this.getFieldValue(field);
                    
                    if (!fieldValue || fieldValue.trim() === '') continue;
                    
                    // Общие поля (заполняем для всех детей в контакте)
                    if (fieldId === 871273) { // Филиал:
                        childInfo.branch = fieldValue;
                    }
                    else if (fieldId === 888881) { // Преподаватель
                        childInfo.teacherName = fieldValue;
                    }
                    else if (fieldId === 892225) { // День недели (2025-26)
                        childInfo.dayOfWeek = fieldValue;
                    }
                    else if (fieldId === 888903) { // Возраст группы
                        childInfo.ageGroup = fieldValue;
                    }
                    else if (fieldId === 890179) { // Есть активный абонемент
                        childInfo.hasActiveSubscription = fieldValue.toLowerCase() === 'да' || 
                                                         fieldValue === '1' || 
                                                         fieldValue.toLowerCase() === 'true';
                    }
                    else if (fieldId === 885380) { // Дата последнего визита
                        childInfo.lastVisitDate = this.parseDate(fieldValue);
                    }
                    else if (fieldId === 850239) { // Аллергия и особенности:
                        childInfo.allergies = fieldValue;
                    }
                }
                
                students.push(childInfo);
            }
        }
        
        console.log(`📊 ИТОГО найдено детей: ${students.length}`);
        
    } catch (error) {
        console.error('❌ Ошибка извлечения учеников из контакта:', error);
    }
    
    return students;
}

// 🔧 МЕТОД: getAllActiveSubscriptions - полная выгрузка всех активных абонементов
async getAllActiveSubscriptions(limit = 100) {
    try {
        console.log(`\n📊 ПОЛНАЯ ВЫГРУЗКА ВСЕХ АКТИВНЫХ АБОНЕМЕНТОВ`);
        console.log('='.repeat(80));
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return [];
        }
        
        // Получаем все сделки с полями абонемента
        const response = await this.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&limit=${limit}&order[updated_at]=desc`
        );
        
        const allLeads = response._embedded?.leads || [];
        console.log(`📋 Всего сделок получено: ${allLeads.length}`);
        
        // Фильтруем сделки с абонементами
        const subscriptions = [];
        
        for (const lead of allLeads) {
            const subscriptionInfo = this.extractSubscriptionInfo(lead);
            
            if (subscriptionInfo.hasSubscription) {
                const leadAnalysis = {
                    leadId: lead.id,
                    leadName: lead.name || 'Без названия',
                    statusId: lead.status_id,
                    pipelineId: lead.pipeline_id,
                    price: lead.price,
                    createdAt: lead.created_at,
                    updatedAt: lead.updated_at,
                    customFieldsCount: lead.custom_fields_values?.length || 0,
                    subscriptionInfo: subscriptionInfo,
                    rawFields: []
                };
                
                // Сохраняем все поля для анализа
                if (lead.custom_fields_values) {
                    lead.custom_fields_values.forEach(field => {
                        const fieldId = field.field_id || field.id;
                        const fieldName = this.getFieldName(field);
                        const fieldValue = this.getFieldValue(field);
                        const fieldType = field.field_type;
                        
                        leadAnalysis.rawFields.push({
                            id: fieldId,
                            name: fieldName,
                            value: fieldValue,
                            type: fieldType,
                            values: field.values || []
                        });
                    });
                }
                
                subscriptions.push(leadAnalysis);
                
                console.log(`\n📋 ${subscriptions.length}. "${lead.name}"`);
                console.log(`   • ID: ${lead.id}`);
                console.log(`   • Абонемент: ${subscriptionInfo.subscriptionStatus}`);
                console.log(`   • Занятий: ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses}`);
                console.log(`   • Осталось: ${subscriptionInfo.remainingClasses}`);
                console.log(`   • Активен: ${subscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
            }
        }
        
        console.log(`\n📊 ИТОГО найденных абонементов: ${subscriptions.length} из ${allLeads.length} сделок`);
        
        // Анализ паттернов
        this.analyzeSubscriptionPatterns(subscriptions);
        
        return subscriptions;
        
    } catch (error) {
        console.error('❌ Ошибка выгрузки абонементов:', error.message);
        return [];
    }
}

// 🔧 МЕТОД: analyzeSubscriptionPatterns - анализ паттернов заполнения
analyzeSubscriptionPatterns(subscriptions) {
    console.log('\n🔍 АНАЛИЗ ПАТТЕРНОВ ЗАПОЛНЕНИЯ АБОНЕМЕНТОВ');
    console.log('='.repeat(80));
    
    const patterns = {
        totalClasses: new Set(),
        usedClasses: new Set(),
        remainingClasses: new Set(),
        subscriptionTypes: new Set(),
        fieldCombinations: [],
        commonIssues: []
    };
    
    subscriptions.forEach(sub => {
        const info = sub.subscriptionInfo;
        
        // Анализируем поля
        patterns.totalClasses.add(`${info.totalClasses} занятий (${sub.leadName})`);
        patterns.usedClasses.add(`Использовано: ${info.usedClasses} (${sub.leadName})`);
        patterns.remainingClasses.add(`Осталось: ${info.remainingClasses} (${sub.leadName})`);
        patterns.subscriptionTypes.add(`${info.subscriptionType || 'Не указан'} (${sub.leadName})`);
        
        // Анализируем поля сделки
        const subscriptionFields = sub.rawFields.filter(f => 
            f.name.includes('абонемент') || 
            f.name.includes('занят') || 
            f.name.includes('счетчик') ||
            f.name.includes('остаток') ||
            f.name.includes('окончание') ||
            f.name.includes('активация')
        );
        
        if (subscriptionFields.length > 0) {
            patterns.fieldCombinations.push({
                leadName: sub.leadName,
                fields: subscriptionFields.map(f => ({
                    id: f.id,
                    name: f.name,
                    value: f.value
                }))
            });
        }
        
        // Проверяем проблемы
        if (info.totalClasses > 0 && info.remainingClasses === 0 && info.usedClasses === 0) {
            patterns.commonIssues.push(`${sub.leadName}: ${info.totalClasses} занятий, но остаток 0 и использовано 0`);
        }
        
        if (info.totalClasses > 0 && info.remainingClasses > info.totalClasses) {
            patterns.commonIssues.push(`${sub.leadName}: остаток ${info.remainingClasses} > всего ${info.totalClasses}`);
        }
    });
    
    // Выводим результаты анализа
    console.log(`\n📊 ВАРИАНТЫ КОЛИЧЕСТВА ЗАНЯТИЙ (${patterns.totalClasses.size}):`);
    Array.from(patterns.totalClasses).forEach(item => console.log(`   • ${item}`));
    
    console.log(`\n📊 ВАРИАНТЫ ИСПОЛЬЗОВАННЫХ ЗАНЯТИЙ (${patterns.usedClasses.size}):`);
    Array.from(patterns.usedClasses).forEach(item => console.log(`   • ${item}`));
    
    console.log(`\n📊 ВАРИАНТЫ ОСТАТКА ЗАНЯТИЙ (${patterns.remainingClasses.size}):`);
    Array.from(patterns.remainingClasses).forEach(item => console.log(`   • ${item}`));
    
    console.log(`\n📊 ТИПЫ АБОНЕМЕНТОВ (${patterns.subscriptionTypes.size}):`);
    Array.from(patterns.subscriptionTypes).forEach(item => console.log(`   • ${item}`));
    
    console.log(`\n🔍 КОМБИНАЦИИ ПОЛЕЙ В СДЕЛКАХ:`);
    patterns.fieldCombinations.forEach((combo, index) => {
        console.log(`\n${index + 1}. ${combo.leadName}:`);
        combo.fields.forEach(field => {
            console.log(`   • ${field.name} (ID: ${field.id}): "${field.value}"`);
        });
    });
    
    if (patterns.commonIssues.length > 0) {
        console.log(`\n🚨 ОБНАРУЖЕННЫЕ ПРОБЛЕМЫ (${patterns.commonIssues.length}):`);
        patterns.commonIssues.forEach(issue => console.log(`   • ${issue}`));
    }
    
    // Создаем сводный отчет
    console.log('\n📈 СВОДНЫЙ ОТЧЕТ:');
    console.log('='.repeat(80));
    
    const activeCount = subscriptions.filter(s => s.subscriptionInfo.subscriptionActive).length;
    const expiredCount = subscriptions.filter(s => s.subscriptionInfo.subscriptionStatus.includes('истек')).length;
    const frozenCount = subscriptions.filter(s => s.subscriptionInfo.isFrozen).length;
    const hasRemaining = subscriptions.filter(s => s.subscriptionInfo.remainingClasses > 0).length;
    
    console.log(`• Всего абонементов: ${subscriptions.length}`);
    console.log(`• Активных: ${activeCount}`);
    console.log(`• Истекших: ${expiredCount}`);
    console.log(`• Замороженных: ${frozenCount}`);
    console.log(`• С остатком занятий: ${hasRemaining}`);
    console.log(`• Без остатка: ${subscriptions.length - hasRemaining}`);
    
    // Распределение по количеству занятий
    const classDistribution = {};
    subscriptions.forEach(sub => {
        const classes = sub.subscriptionInfo.totalClasses;
        if (classes > 0) {
            classDistribution[classes] = (classDistribution[classes] || 0) + 1;
        }
    });
    
    console.log('\n📊 РАСПРЕДЕЛЕНИЕ ПО КОЛИЧЕСТВУ ЗАНЯТИЙ:');
    Object.keys(classDistribution).sort((a, b) => a - b).forEach(key => {
        console.log(`   • ${key} занятий: ${classDistribution[key]} абонементов`);
    });
}

// 🔧 МЕТОД: getSubscriptionStats - статистика по абонементам
async getSubscriptionStats() {
    try {
        console.log('\n📈 СТАТИСТИКА ПО АБОНЕМЕНТАМ');
        console.log('='.repeat(80));
        
        const subscriptions = await this.getAllActiveSubscriptions(200);
        
        const stats = {
            total: subscriptions.length,
            byStatus: {},
            byType: {},
            byClassCount: {},
            activeCount: 0,
            expiredCount: 0,
            frozenCount: 0,
            withRemaining: 0,
            withoutRemaining: 0,
            issues: []
        };
        
        subscriptions.forEach(sub => {
            const info = sub.subscriptionInfo;
            
            // По статусу
            const status = info.subscriptionStatus.split('(')[0].trim();
            stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
            
            // По типу
            const type = info.subscriptionType || 'Не указан';
            stats.byType[type] = (stats.byType[type] || 0) + 1;
            
            // По количеству занятий
            if (info.totalClasses > 0) {
                stats.byClassCount[info.totalClasses] = (stats.byClassCount[info.totalClasses] || 0) + 1;
            }
            
            // Счетчики
            if (info.subscriptionActive) stats.activeCount++;
            if (info.subscriptionStatus.includes('истек')) stats.expiredCount++;
            if (info.isFrozen) stats.frozenCount++;
            if (info.remainingClasses > 0) stats.withRemaining++;
            else stats.withoutRemaining++;
            
            // Проблемы
            if (info.totalClasses > 0 && info.remainingClasses === 0 && info.usedClasses === 0) {
                stats.issues.push({
                    leadId: sub.leadId,
                    leadName: sub.leadName,
                    problem: `Всего ${info.totalClasses} занятий, но остаток 0 и использовано 0`
                });
            }
        });
        
        return {
            stats: stats,
            subscriptions: subscriptions.slice(0, 50), // Ограничиваем вывод
            totalSubscriptions: subscriptions.length
        };
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error.message);
        return { stats: {}, subscriptions: [], totalSubscriptions: 0 };
    }
}
    
async getStudentsByPhone(phoneNumber) {
    console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
    
    const studentProfiles = [];
    
    if (!this.isInitialized) {
        console.log('❌ amoCRM не инициализирован');
        return studentProfiles;
    }
    
    try {
        // 1. Ищем контакты по телефону
        console.log('🔍 Поиск контактов...');
        const contactsResponse = await this.searchContactsByPhone(phoneNumber);
        const contacts = contactsResponse._embedded?.contacts || [];
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        if (contacts.length === 0) {
            console.log('❌ Контакты не найдены');
            return studentProfiles;
        }
        
        for (const contact of contacts) {
            console.log(`\n👤 Анализ контакта: ${contact.name} (ID: ${contact.id})`);
            
            // 2. Получаем полную информацию о контакте
            const fullContact = await this.getFullContactInfo(contact.id);
            if (!fullContact) {
                console.log('❌ Не удалось получить полную информацию о контакте');
                continue;
            }
            
            // 3. Извлекаем информацию о детях
            const children = this.extractStudentsFromContact(fullContact);
            console.log(`📊 Найдено детей в контакте: ${children.length}`);
            
            if (children.length === 0) {
                console.log('⚠️  Дети не найдены в контакте, пропускаем');
                continue;
            }
            
            // 4. Получаем ВСЕ сделки контакта с увеличенным лимитом
            console.log('🔍 Получение ВСЕХ сделок контакта...');
            const leads = await this.getContactLeadsSorted(contact.id);
            console.log(`📊 Найдено сделок: ${leads.length}`);
            
            // 5. Для каждой сделки делаем полный анализ
            console.log('\n🔍 АНАЛИЗ ВСЕХ СДЕЛОК:');
            leads.forEach((lead, index) => {
                console.log(`${index + 1}. "${lead.name}" (ID: ${lead.id})`);
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                console.log(`   • Абонемент: ${subscriptionInfo.hasSubscription ? 'Да' : 'Нет'}`);
                console.log(`   • Занятий: ${subscriptionInfo.totalClasses}`);
                console.log(`   • Использовано: ${subscriptionInfo.usedClasses}`);
                console.log(`   • Осталось: ${subscriptionInfo.remainingClasses}`);
                console.log(`   • Активен: ${subscriptionInfo.subscriptionActive}`);
            });
            
            // 6. Для каждого ребенка ищем подходящую сделку
            for (const child of children) {
                console.log(`\n🎯 Поиск абонемента для: "${child.studentName}"`);
                
                // Ищем лучшую сделку для этого ребенка
                const bestLead = this.findBestLeadForStudent(child.studentName, leads);
                
                let subscriptionInfo;
                if (bestLead) {
                    console.log(`✅ Найдена сделка: "${bestLead.name}" (ID: ${bestLead.id})`);
                    subscriptionInfo = this.extractSubscriptionInfo(bestLead);
                } else {
                    console.log(`❌ Не найдено подходящей сделки для "${child.studentName}"`);
                    
                    // Пробуем найти любую сделку с абонементом
                    for (const lead of leads) {
                        const tempInfo = this.extractSubscriptionInfo(lead);
                        if (tempInfo.hasSubscription) {
                            console.log(`⚠️  Найдена альтернативная сделка: "${lead.name}"`);
                            subscriptionInfo = tempInfo;
                            bestLead = lead;
                            break;
                        }
                    }
                    
                    if (!subscriptionInfo) {
                        subscriptionInfo = this.extractSubscriptionInfo(null);
                        console.log(`⚠️  Абонемент не найден`);
                    }
                }
                
                // 7. Создаем профиль ученика
                const studentProfile = this.createStudentProfile(
                    fullContact,
                    phoneNumber,
                    child,
                    subscriptionInfo,
                    bestLead
                );
                
                studentProfiles.push(studentProfile);
                console.log(`✅ Профиль создан: ${child.studentName}`);
            }
        }
        
        console.log(`\n🎯 ИТОГО создано профилей: ${studentProfiles.length}`);
        
    } catch (crmError) {
        console.error(`❌ Ошибка получения данных из amoCRM:`, crmError.message);
        console.error(crmError.stack);
    }
    
    return studentProfiles;
}
    async getContactLeadsSorted(contactId) {
        try {
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&order[created_at]=desc&limit=50`
            );
            
            return response._embedded?.leads || [];
        } catch (error) {
            console.error(`⚠️  Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    extractStudentNameFromLead(lead) {
        try {
            const customFields = lead.custom_fields_values || [];
            const leadName = lead.name || '';
            
            // Ищем имя ученика в полях сделки
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (fieldValue && (fieldName.includes('ученик') || 
                                   fieldName.includes('ребен') || 
                                   fieldName.includes('фио'))) {
                    return fieldValue;
                }
            }
            
            // Если не нашли в полях, используем название сделки
            return leadName;
        } catch (error) {
            console.error('❌ Ошибка извлечения имени из сделки:', error);
            return '';
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
            console.error(`❌ Ошибка получения контакта: ${error.message}`);
            return null;
        }
    }

    findEmail(contact) {
        try {
            const customFields = contact.custom_fields_values || [];
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                const fieldValue = this.getFieldValue(field);
                
                // Ищем поле email по ID или по названию
                if ((fieldId === this.FIELD_IDS.CONTACT.EMAIL || 
                     this.getFieldName(field).includes('email') || 
                     this.getFieldName(field).includes('почта')) && 
                    fieldValue && 
                    fieldValue.includes('@')) {
                    return fieldValue;
                }
            }
        } catch (error) {
            console.error('❌ Ошибка поиска email:', error);
        }
        return '';
    }

findBestLeadForStudent(studentName, leads) {
    if (!leads || leads.length === 0) {
        console.log('⚠️  Нет сделок для анализа');
        return null;
    }
    
    console.log(`\n🔍 Поиск лучшей сделки для ученика: "${studentName}"`);
    console.log(`📊 Всего сделок: ${leads.length}`);
    
    const studentNames = studentName.toLowerCase().split(' ');
    const studentFirstName = studentNames[0] || '';
    const studentLastName = studentNames[1] || '';
    
    let bestLead = null;
    let bestScore = -1000;
    
    // ДЛЯ ОТЛАДКИ: анализируем каждую сделку
    console.log('\n📊 АНАЛИЗ ВСЕХ СДЕЛОК:');
    
    for (const lead of leads) {
        const leadName = lead.name || '';
        let score = 0;
        const reasons = [];
        
        console.log(`\n   Сделка: "${leadName}"`);
        
        // 1. ВЫСШИЙ ПРИОРИТЕТ: Полное совпадение имени в названии
        if (leadName.includes(studentName)) {
            score += 200;
            reasons.push(`✅ ПОЛНОЕ СОВПАДЕНИЕ ИМЕНИ +200`);
        }
        
        // 2. Проверяем наличие абонемента в сделке
        const subscriptionInfo = this.extractSubscriptionInfo(lead);
        console.log(`   Абонемент: ${subscriptionInfo.hasSubscription ? 'Да' : 'Нет'}`);
        console.log(`   Занятий: ${subscriptionInfo.totalClasses}`);
        console.log(`   Осталось: ${subscriptionInfo.remainingClasses}`);
        console.log(`   Активен: ${subscriptionInfo.subscriptionActive}`);
        
        if (subscriptionInfo.hasSubscription) {
            score += 100;
            reasons.push(`🎫 ЕСТЬ АБОНЕМЕНТ +100`);
            
            if (subscriptionInfo.subscriptionActive) {
                score += 80;
                reasons.push(`🟢 АБОНЕМЕНТ АКТИВЕН +80`);
            }
            
            if (subscriptionInfo.totalClasses > 0) {
                score += 50;
                reasons.push(`📊 ${subscriptionInfo.totalClasses} ЗАНЯТИЙ +50`);
            }
            
            if (subscriptionInfo.remainingClasses > 0) {
                score += 30;
                reasons.push(`🔢 ОСТАЛОСЬ ${subscriptionInfo.remainingClasses} ЗАНЯТИЙ +30`);
            }
        }
        
        // 3. Совпадение по первому имени
        if (studentFirstName && leadName.toLowerCase().includes(studentFirstName.toLowerCase())) {
            score += 60;
            reasons.push(`👤 СОВПАДЕНИЕ ИМЕНИ "${studentFirstName}" +60`);
        }
        
        // 4. Проверяем название сделки на наличие слова "занятий"
        if (leadName.toLowerCase().includes('занятий')) {
            score += 20;
            reasons.push(`🔢 СЛОВО "ЗАНЯТИЙ" В НАЗВАНИИ +20`);
        }
        
        // 5. Минусы за "Закончился" в названии
        if (leadName.includes('Закончился') || leadName.includes('закончился')) {
            score -= 50;
            reasons.push(`⏹️  СЛОВО "ЗАКОНЧИЛСЯ" В НАЗВАНИИ -50`);
        }
        
        console.log(`   Балл: ${score}`);
        if (reasons.length > 0) {
            console.log(`   Причины: ${reasons.join(', ')}`);
        }
        
        // Обновляем лучшую сделку
        if (score > bestScore) {
            bestScore = score;
            bestLead = lead;
        }
    }
    
    if (bestLead) {
        console.log(`\n✅ ВЫБРАНА СДЕЛКА: "${bestLead.name}"`);
        console.log(`📊 ЛУЧШИЙ БАЛЛ: ${bestScore}`);
        
        const finalSubscriptionInfo = this.extractSubscriptionInfo(bestLead);
        console.log(`📋 ДЕТАЛИ АБОНЕМЕНТА:`);
        console.log(`   • Всего занятий: ${finalSubscriptionInfo.totalClasses}`);
        console.log(`   • Использовано: ${finalSubscriptionInfo.usedClasses}`);
        console.log(`   • Осталось: ${finalSubscriptionInfo.remainingClasses}`);
        console.log(`   • Статус: ${finalSubscriptionInfo.subscriptionStatus}`);
        console.log(`   • Активен: ${finalSubscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
        
    } else {
        console.log(`\n⚠️  НЕ НАЙДЕНО ПОДХОДЯЩЕЙ СДЕЛКИ`);
    }
    
    return bestLead;
}

// 🔧 МЕТОД: checkIfLeadBelongsToStudent - для проверки принадлежности
checkIfLeadBelongsToStudent(leadName, studentName) {
    if (!leadName || !studentName) return false;
    
    const lowerLeadName = leadName.toLowerCase().trim();
    const lowerStudentName = studentName.toLowerCase().trim();
    
    // Полное совпадение
    if (lowerLeadName.includes(lowerStudentName)) {
        return true;
    }
    
    // Разбиваем имена на части
    const studentNames = lowerStudentName.split(' ');
    const studentFirstName = studentNames[0] || '';
    const studentLastName = studentNames[1] || '';
    
    // Ищем паттерн "Имя Фамилия - " в начале названия сделки
    const namePattern = /^([а-яё\s]+)\s+-\s+\d+/i;
    const match = leadName.match(namePattern);
    
    if (match) {
        const dealStudentName = match[1].trim().toLowerCase();
        const dealNames = dealStudentName.split(' ');
        const dealFirstName = dealNames[0] || '';
        const dealLastName = dealNames[1] || '';
        
        // Проверяем совпадение
        if (dealFirstName && dealFirstName === studentFirstName) {
            if (!dealLastName || !studentLastName || dealLastName === studentLastName) {
                return true;
            }
        }
    }
    
    // Проверяем наличие имени в любой части названия
    if (studentFirstName && lowerLeadName.includes(studentFirstName)) {
        // Дополнительная проверка: не должно быть других явных имен
        const otherNamePatterns = [
            /(артем|артемий|серик|никита|алиса|вероника|полина|мария|диана)/i
        ];
        
        let hasOtherName = false;
        for (const pattern of otherNamePatterns) {
            if (pattern.test(leadName) && !pattern.test(studentName)) {
                hasOtherName = true;
                break;
            }
        }
        
        return !hasOtherName;
    }
    
    return false;
}
    
// 🔧 МЕТОД: findBestLeadFallback - запасной вариант
findBestLeadFallback(studentName, leads) {
    console.log(`🔍 Запасной поиск среди всех сделок...`);
    
    let bestLead = null;
    let bestScore = 0;
    
    for (const lead of leads) {
        let score = 0;
        const leadName = lead.name || '';
        
        // Пропускаем явно неподходящие
        if (leadName.includes('Рассылка') || leadName.includes('Успешные') || 
            leadName.includes('Архив') || leadName.match(/^\d+\s*₽/)) {
            continue;
        }
        
        // Проверяем наличие слова "абонемент"
        if (leadName.toLowerCase().includes('абонемент')) {
            score += 50;
        }
        
        // Проверяем совпадение имени
        const studentFirstName = studentName.split(' ')[0] || '';
        if (studentFirstName && leadName.includes(studentFirstName)) {
            score += 30;
        }
        
        // Проверяем наличие занятий в названии
        if (leadName.match(/\d+\s*занят/)) {
            score += 20;
        }
        
        if (score > bestScore) {
            bestScore = score;
            bestLead = lead;
        }
    }
    
    if (bestLead) {
        console.log(`✅ Найдена сделка: "${bestLead.name.substring(0, 50)}..."`);
    }
    
    return bestLead;
}


parseLeadNameForSubscription(leadName) {
    if (!leadName) return 0;
    
    try {
        console.log(`🔍 Парсинг названия сделки: "${leadName}"`);
        
        // Пропускаем неподходящие названия
        const skipPatterns = [
            /^рассылка\s/i,
            /^успешн/i,
            /^архивн/i,
            /^отменен/i,
            /^не\s+актив/i,
            /^закончил/i,
            /^завершён/i,
            /^\d+\s*₽/i,
            /^сделка\s*#/i,
            /^#\d+/i
        ];
        
        for (const pattern of skipPatterns) {
            if (pattern.test(leadName)) {
                console.log('⏭️  Пропускаем по фильтру:', pattern);
                return 0;
            }
        }
        
        const lowerName = leadName.toLowerCase();
        
        // Паттерны для поиска количества занятий
        const patterns = [
            // "Имя Фамилия - 4 занятия" (самый частый паттерн)
            { pattern: /-\s*(\d+)\s+занят/i, desc: 'число после дефиса с занятиями' },
            
            // "Имя Фамилия 4 занятия" (без дефиса)
            { pattern: /\s+(\d+)\s+занят/i, desc: 'число с занятиями' },
            
            // "4 занятия" в любом месте
            { pattern: /(\d+)\s+занят/i, desc: 'число занятий' },
            
            // "8занятий" (без пробела)
            { pattern: /(\d+)занят/i, desc: 'число занятий без пробела' },
            
            // "Абонемент 8"
            { pattern: /абонемент\s+(\d+)/i, desc: 'абонемент число' },
            
            // "на 8 занятий"
            { pattern: /на\s+(\d+)\s+занят/i, desc: 'на число занятий' },
            
            // "Разовый" или "Пробное"
            { pattern: /(разовый|пробное)/i, desc: 'разовое занятие' },
        ];
        
        // Проверяем специальные случаи
        if (lowerName.includes('разовый') || lowerName.includes('пробное')) {
            console.log(`✅ Найдено разовое занятие`);
            return 1;
        }
        
        // Ищем по паттернам
        for (const { pattern, desc } of patterns) {
            const match = lowerName.match(pattern);
            if (match && match[1]) {
                const num = parseInt(match[1]);
                if (num >= 1 && num <= 50) {
                    console.log(`✅ Найдено по паттерну "${desc}": ${num} занятий`);
                    return num;
                }
            }
        }
        
        // Если не нашли по паттернам, ищем просто числа в конце
        const endMatch = leadName.match(/(\d{1,2})\s*(?:занятий|занятия|уроков|урока)?\s*$/i);
        if (endMatch && endMatch[1]) {
            const num = parseInt(endMatch[1]);
            if (num >= 1 && num <= 50) {
                console.log(`✅ Найдено число в конце: ${num} занятий`);
                return num;
            }
        }
        
        console.log(`❌ Не удалось определить количество занятий из названия`);
        return 0;
        
    } catch (error) {
        console.error('❌ Ошибка парсинга названия:', error);
        return 0;
    }
}

// 🔧 МЕТОД: countVisitedClasses
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
    
    // 🔧 МЕТОД: debugSubscriptionFields
debugSubscriptionFields(customFields) {
    console.log('\n🔧 ДИАГНОСТИКА ПОЛЕЙ АБОНЕМЕНТА');
    console.log('=' .repeat(50));
    
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
    
    subscriptionFieldIds.forEach(fieldId => {
        const field = customFields.find(f => (f.field_id || f.id) === fieldId);
        if (field) {
            const value = this.getFieldValue(field);
            console.log(`✅ Поле ${fieldId}: "${value}"`);
        } else {
            console.log(`❌ Поле ${fieldId}: не найдено`);
        }
    });
    
    // Ищем чекбоксы посещений
    const checkboxFields = customFields.filter(f => {
        const fieldId = f.field_id || f.id;
        return [
            this.FIELD_IDS.LEAD.CLASS_1, this.FIELD_IDS.LEAD.CLASS_2,
            this.FIELD_IDS.LEAD.CLASS_3, this.FIELD_IDS.LEAD.CLASS_4,
            this.FIELD_IDS.LEAD.CLASS_5, this.FIELD_IDS.LEAD.CLASS_6,
            this.FIELD_IDS.LEAD.CLASS_7, this.FIELD_IDS.LEAD.CLASS_8,
            this.FIELD_IDS.LEAD.CLASS_9, this.FIELD_IDS.LEAD.CLASS_10,
            this.FIELD_IDS.LEAD.CLASS_11, this.FIELD_IDS.LEAD.CLASS_12,
            this.FIELD_IDS.LEAD.CLASS_13, this.FIELD_IDS.LEAD.CLASS_14,
            this.FIELD_IDS.LEAD.CLASS_15, this.FIELD_IDS.LEAD.CLASS_16
        ].includes(fieldId);
    });
    
    const visitedClasses = checkboxFields.filter(f => {
        const value = this.getFieldValue(f);
        return value && value.toLowerCase() === 'да';
    }).length;
    
    console.log(`📊 Чекбоксы посещений: ${visitedClasses} из ${checkboxFields.length}`);
}
    
    // 🔧 ОБНОВЛЕННЫЙ МЕТОД: createStudentProfile
    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        // Определяем email
        const email = studentInfo.email || this.findEmail(contact);
        
        // Форматируем даты для отображения
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
        
        // Создаем базовый профиль
        const profile = {
            amocrm_contact_id: contact.id || null,
            parent_contact_id: contact.id || null,
            amocrm_lead_id: lead?.id || null,
            student_name: studentInfo.studentName || 'Ученик',
            phone_number: phoneNumber,
            email: email || '',
            birth_date: studentInfo.birthDate || '',
            branch: studentInfo.branch || '',
            parent_name: studentInfo.parentName || contact.name || '',
            day_of_week: studentInfo.dayOfWeek || '',
            time_slot: studentInfo.timeSlot || '',
            teacher_name: studentInfo.teacherName || '',
            age_group: studentInfo.ageGroup || '',
            course: studentInfo.course || '',
            allergies: studentInfo.allergies || '',
            
            // Данные абонемента
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
            
            // Форматированные даты для отображения
            expiration_date_display: formatDisplayDate(subscriptionInfo.expirationDate),
            activation_date_display: formatDisplayDate(subscriptionInfo.activationDate),
            last_visit_date_display: formatDisplayDate(studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate),
            
            // Технические данные
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
        console.log(`   👨‍👩‍👧 Родитель: ${profile.parent_name || 'не указан'}`);
        console.log(`   📍 Филиал: ${profile.branch || 'не указан'}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        console.log(`   📊 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        console.log(`   📅 Активация: ${profile.activation_date_display || 'не указано'}`);
        console.log(`   📅 Окончание: ${profile.expiration_date_display || 'не указано'}`);
        console.log(`   ✅ Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
        
        return profile;
    }
}


// Создаем экземпляр сервиса amoCRM (удален дублирующий код)
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
                
                -- Основная информация
                student_name TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                email TEXT,
                birth_date TEXT,
                branch TEXT,
                
                -- Расписание
                day_of_week TEXT,
                time_slot TEXT,
                teacher_name TEXT,
                age_group TEXT,
                course TEXT,
                allergies TEXT,
                
                -- Информация о родителе
                parent_name TEXT,
                
                -- Абонемент
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
                
                -- Технические данные
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
        
        // Первая синхронизация при запуске
        await this.syncAllProfiles();
        
        // Запускаем периодическую синхронизацию
        setInterval(async () => {
            await this.syncAllProfiles();
        }, 10 * 60 * 1000); // 10 минут
    }

    async syncAllProfiles() {
        if (this.isSyncing) {
            console.log('⚠️  Синхронизация уже выполняется, пропускаем');
            return;
        }

        this.isSyncing = true;
        const startTime = Date.now();
        const syncId = `sync_${new Date().toISOString().replace(/[^0-9]/g, '')}`;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔄 ЗАПУСК СИНХРОНИЗАЦИИ: ${syncId}`);
        console.log(`⏰ Время: ${new Date().toISOString()}`);
        console.log('='.repeat(80));

        try {
            // Получаем все уникальные номера телефонов из базы
            const phones = await db.all(
                `SELECT DISTINCT phone_number FROM student_profiles WHERE is_active = 1`
            );

            console.log(`📊 Найдено уникальных телефонов: ${phones.length}`);

            let totalUpdated = 0;
            let totalErrors = 0;

            // Для каждого телефона обновляем данные
            for (const phoneRow of phones) {
                const phone = phoneRow.phone_number;
                
                try {
                    console.log(`\n🔍 Синхронизация для телефона: ${phone}`);
                    
                    // Получаем актуальные данные из amoCRM
                    const profiles = await amoCrmService.getStudentsByPhone(phone);
                    
                    // Сохраняем в базу
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

            // Логируем результат синхронизации
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

    async syncSinglePhone(phoneNumber) {
        console.log(`\n🔧 РУЧНАЯ СИНХРОНИЗАЦИЯ ТЕЛЕФОНА: ${phoneNumber}`);
        
        try {
            // Получаем актуальные данные из amoCRM
            const profiles = await amoCrmService.getStudentsByPhone(phoneNumber);
            
            // Сохраняем в базу
            const savedCount = await saveProfilesToDatabase(profiles);
            
            console.log(`✅ Синхронизация завершена`);
            console.log(`📊 Обновлено профилей: ${savedCount}`);
            
            return {
                success: true,
                phone: phoneNumber,
                profiles_updated: savedCount,
                total_profiles: profiles.length
            };
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации:', error.message);
            return {
                success: false,
                phone: phoneNumber,
                error: error.message
            };
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

// Создаем сервис синхронизации
const syncService = new SyncService();

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

// 🔧 Обновите метод saveProfilesToDatabase
async function saveProfilesToDatabase(profiles) {
    try {
        console.log(`💾 Сохранение профилей в БД...`);
        let savedCount = 0;
        
        for (const profile of profiles) {
            try {
                // Генерируем уникальный ключ для поиска
                const searchKey = `${profile.student_name}|${profile.phone_number}|${profile.branch || ''}`;
                
                // Ищем существующий профиль
                const existingProfile = await db.get(
                    `SELECT id FROM student_profiles 
                     WHERE student_name = ? AND phone_number = ?`,
                    [profile.student_name, profile.phone_number]
                );
                
                const columns = [
                    'amocrm_contact_id', 'parent_contact_id', 'amocrm_lead_id', 'student_name', 'phone_number', 'email',
                    'birth_date', 'branch', 'day_of_week', 'time_slot', 'teacher_name', 'age_group', 'course', 'allergies',
                    'parent_name', 'subscription_type', 'subscription_active', 'subscription_status', 'subscription_badge',
                    'total_classes', 'used_classes', 'remaining_classes', 'expiration_date', 
                    'activation_date', 'last_visit_date', 'custom_fields', 
                    'raw_contact_data', 'lead_data', 'is_demo', 'source', 'is_active', 'last_sync'
                ];
                
                const values = [
                    profile.amocrm_contact_id || null,
                    profile.parent_contact_id || null,
                    profile.amocrm_lead_id || null,
                    profile.student_name,
                    profile.phone_number,
                    profile.email || '',
                    profile.birth_date || '',
                    profile.branch || '',
                    profile.day_of_week || '',
                    profile.time_slot || '',
                    profile.teacher_name || '',
                    profile.age_group || '',
                    profile.course || '',
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
                    profile.custom_fields || '{}',
                    profile.raw_contact_data || '{}',
                    profile.lead_data || '{}',
                    profile.is_demo || 0,
                    profile.source || 'amocrm',
                    1,
                    new Date().toISOString()
                ];
                
                if (!existingProfile) {
                    // Вставка нового профиля
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    const result = await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    
                    console.log(`✅ Профиль создан (ID: ${result.lastID}): ${profile.student_name}`);
                    savedCount++;
                } else {
                    // Обновление существующего профиля
                    const setClause = columns.map(col => `${col} = ?`).join(', ');
                    
                    await db.run(
                        `UPDATE student_profiles SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [...values, existingProfile.id]
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
        version: '4.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        sync_status: syncService.getSyncStatus(),
        data_source: 'Актуальные данные из amoCRM'
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
        console.log(`📱 Форматированный номер: ${formattedPhone}`);
        console.log(`🔧 Статус amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
        
        let profiles = [];
        
        // Получаем актуальные данные из amoCRM
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
        
        // Если не нашли профилей
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
        
        // Создаем временного пользователя
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            first_name: profiles.length > 0 ? profiles[0].student_name?.split(' ')[0] || 'Ученик' : 'Гость',
            is_temp: true,
            profiles_count: profiles.length
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
                    JSON.stringify({ user: tempUser, profiles_count: profiles.length }),
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
            is_demo: p.is_demo === 0 ? false : true, // Всегда false, так как только реальные данные
            source: p.source,
            last_sync: p.last_sync
        }));
        
        // Определяем, есть ли несколько учеников
        const hasMultipleStudents = profiles.length > 1;
        
        // Формируем ответ
        const responseData = {
            success: true,
            message: profiles.length > 0 
                ? 'Найдены профили учеников'
                : 'Профили не найдены',
            data: {
                user: tempUser,
                profiles: responseProfiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                has_real_data: true, // Всегда true, так как только реальные данные
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

// 🔧 ИСПРАВЬТЕ метод в server.js для обработки /api/subscription
app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id, phone } = req.body;
        
        console.log(`\n📋 ЗАПРОС АБОНЕМЕНТА`);
        console.log(`📌 profile_id: ${profile_id}`);
        console.log(`📌 phone: ${phone}`);
        
        let profile;
        
        if (profile_id) {
            // Ищем профиль по ID в базе
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE id = ?`,
                [parseInt(profile_id)]
            );
            
            if (profile) {
                console.log(`✅ Найден профиль в БД: ${profile.student_name}`);
            } else {
                console.log(`❌ Профиль ${profile_id} не найден в БД`);
                
                // Если profile_id начинается с "profile-", это временный ID из фронтенда
                if (profile_id.startsWith('profile-')) {
                    const index = parseInt(profile_id.replace('profile-', ''));
                    console.log(`🔍 Это временный ID, индекс: ${index}`);
                    
                    // Ищем по телефону и имени ученика
                    if (phone) {
                        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
                        const profiles = await db.all(
                            `SELECT * FROM student_profiles 
                             WHERE phone_number LIKE ? AND is_active = 1 
                             ORDER BY subscription_active DESC, updated_at DESC`,
                            [`%${cleanPhone}%`]
                        );
                        
                        if (profiles.length > index) {
                            profile = profiles[index];
                            console.log(`✅ Найден профиль по индексу: ${profile.student_name}`);
                        }
                    }
                }
            }
        } 
        
        // Если не нашли по profile_id, ищем по телефону
        if (!profile && phone) {
            const cleanPhone = phone.replace(/\D/g, '').slice(-10);
            profile = await db.get(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1 
                 ORDER BY subscription_active DESC, updated_at DESC LIMIT 1`,
                [`%${cleanPhone}%`]
            );
            console.log(`🔍 Поиск по телефону: ${phone}`);
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
        
        // Рассчитываем прогресс
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

// ==================== ДИАГНОСТИЧЕСКИЕ МАРШРУТЫ ====================

// 📍 ТЕСТИРОВАНИЕ КОНКРЕТНОГО АБОНЕМЕНТА
app.get('/api/test/subscription/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        
        console.log(`\n🔧 ТЕСТ КОНКРЕТНОГО АБОНЕМЕНТА ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const result = await amoCrmService.debugSubscriptionAnalysis(leadId);
        
        if (!result.success) {
            return res.status(500).json(result);
        }
        
        // Проверяем корректность данных
        const check = {
            crmTotalClasses: 0,
            appTotalClasses: result.data.subscriptionInfo.totalClasses,
            crmUsedClasses: 0,
            appUsedClasses: result.data.subscriptionInfo.usedClasses,
            crmRemainingClasses: 0,
            appRemainingClasses: result.data.subscriptionInfo.remainingClasses,
            issues: []
        };
        
        // Находим значения из CRM
        result.data.importantFields.forEach(field => {
            if (field.id === 850241 || field.id === 891819) {
                const num = parseInt(field.value) || amoCrmService.parseNumberFromString(field.value);
                if (num > 0) check.crmTotalClasses = num;
            }
            if (field.id === 850257) {
                check.crmUsedClasses = parseInt(field.value) || 0;
            }
            if (field.id === 890163) {
                check.crmRemainingClasses = parseInt(field.value) || 0;
            }
        });
        
        // Проверяем расхождения
        if (check.appTotalClasses !== check.crmTotalClasses && check.crmTotalClasses > 0) {
            check.issues.push(`Количество занятий: CRM=${check.crmTotalClasses}, Приложение=${check.appTotalClasses}`);
        }
        
        if (check.appUsedClasses !== check.crmUsedClasses && check.crmUsedClasses > 0) {
            check.issues.push(`Использовано: CRM=${check.crmUsedClasses}, Приложение=${check.appUsedClasses}`);
        }
        
        if (check.appRemainingClasses !== check.crmRemainingClasses && check.crmRemainingClasses > 0) {
            check.issues.push(`Остаток: CRM=${check.crmRemainingClasses}, Приложение=${check.appRemainingClasses}`);
        }
        
        res.json({
            success: true,
            data: {
                ...result.data,
                validation: check,
                correctData: {
                    totalClasses: check.crmTotalClasses || check.appTotalClasses,
                    usedClasses: check.crmUsedClasses || check.appUsedClasses,
                    remainingClasses: check.crmRemainingClasses || check.appRemainingClasses
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка тестирования'
        });
    }
});

// 📍 ПОЛНАЯ ВЫГРУЗКА ВСЕХ АКТИВНЫХ АБОНЕМЕНТОВ
app.get('/api/debug/all-subscriptions', async (req, res) => {
    try {
        console.log(`\n📊 ЗАПРОС ПОЛНОЙ ВЫГРУЗКИ ВСЕХ АКТИВНЫХ АБОНЕМЕНТОВ`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const limit = parseInt(req.query.limit) || 100;
        console.log(`🔧 Лимит: ${limit} сделок`);
        
        const subscriptions = await amoCrmService.getAllActiveSubscriptions(limit);
        
        res.json({
            success: true,
            data: {
                total: subscriptions.length,
                limit: limit,
                subscriptions: subscriptions,
                analysis: {
                    patterns: amoCrmService.analyzeSubscriptionPatterns(subscriptions)
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка выгрузки абонементов:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка выгрузки абонементов'
        });
    }
});

// 📍 СТАТИСТИКА ПО АБОНЕМЕНТАМ
app.get('/api/debug/subscription-stats', async (req, res) => {
    try {
        console.log(`\n📈 ЗАПРОС СТАТИСТИКИ ПО АБОНЕМЕНТАМ`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const stats = await amoCrmService.getSubscriptionStats();
        
        res.json({
            success: true,
            data: stats
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// 📍 ТЕСТИРОВАНИЕ КОНКРЕТНЫХ ПРОБЛЕМНЫХ СДЕЛОК
app.get('/api/debug/test-subscription/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        
        console.log(`\n🔍 ТЕСТИРОВАНИЕ СДЕЛКИ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        // Анализируем все поля
        console.log('\n📊 ВСЕ ПОЛЯ СДЕЛКИ:');
        const customFields = lead.custom_fields_values || [];
        customFields.forEach(field => {
            const fieldId = field.field_id || field.id;
            const fieldName = amoCrmService.getFieldName(field);
            const fieldValue = amoCrmService.getFieldValue(field);
            console.log(`   ID: ${fieldId} - "${fieldName}": "${fieldValue}"`);
        });
        
        // Используем новый метод извлечения
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        // Подсчитываем чекбоксы отдельно
        const visitedClasses = amoCrmService.countVisitedClasses(customFields);
        console.log(`\n📊 Чекбоксы посещений: ${visitedClasses}`);
        
        res.json({
            success: true,
            data: {
                leadName: lead.name,
                subscriptionInfo: subscriptionInfo,
                visitedClasses: visitedClasses,
                fieldsCount: customFields.length,
                rawFields: customFields.map(f => ({
                    id: f.field_id || f.id,
                    name: amoCrmService.getFieldName(f),
                    value: amoCrmService.getFieldValue(f)
                }))
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка тестирования'
        });
    }
});

// 📍 ПРОВЕРКА КОНКРЕТНЫХ СДЕЛОК (например, проблемных)
app.get('/api/debug/problematic-subscriptions', async (req, res) => {
    try {
        console.log(`\n🔍 ПОИСК ПРОБЛЕМНЫХ АБОНЕМЕНТОВ`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const subscriptions = await amoCrmService.getAllActiveSubscriptions(200);
        
        // Находим проблемные абонементы
        const problematic = subscriptions.filter(sub => {
            const info = sub.subscriptionInfo;
            
            // Проблемы:
            // 1. Остаток 0, но использовано 0 (все занятия доступны, но не отображаются)
            // 2. Остаток больше общего количества
            // 3. Нет даты окончания
            // 4. Абонемент активен, но остаток 0
            // 5. Неправильные данные в полях
            
            return (
                (info.totalClasses > 0 && info.remainingClasses === 0 && info.usedClasses === 0) ||
                (info.totalClasses > 0 && info.remainingClasses > info.totalClasses) ||
                (!info.expirationDate && info.totalClasses > 0) ||
                (info.subscriptionActive && info.remainingClasses === 0 && info.totalClasses > 0) ||
                sub.leadName.includes('закончился') && info.subscriptionActive
            );
        });
        
        console.log(`📊 Найдено проблемных абонементов: ${problematic.length}`);
        
        // Анализируем проблемные поля
        const fieldAnalysis = {};
        problematic.forEach(sub => {
            sub.rawFields.forEach(field => {
                if (field.name.includes('занят') || field.name.includes('счетчик') || field.name.includes('остаток')) {
                    const key = `${field.name} (ID: ${field.id})`;
                    fieldAnalysis[key] = fieldAnalysis[key] || { values: new Set(), count: 0 };
                    fieldAnalysis[key].values.add(field.value);
                    fieldAnalysis[key].count++;
                }
            });
        });
        
        res.json({
            success: true,
            data: {
                totalProblematic: problematic.length,
                problematicSubscriptions: problematic,
                fieldAnalysis: fieldAnalysis,
                summary: {
                    '0_остаток_0_использовано': problematic.filter(p => 
                        p.subscriptionInfo.totalClasses > 0 && 
                        p.subscriptionInfo.remainingClasses === 0 && 
                        p.subscriptionInfo.usedClasses === 0
                    ).length,
                    'остаток_больше_всего': problematic.filter(p => 
                        p.subscriptionInfo.totalClasses > 0 && 
                        p.subscriptionInfo.remainingClasses > p.subscriptionInfo.totalClasses
                    ).length,
                    'нет_даты_окончания': problematic.filter(p => 
                        !p.subscriptionInfo.expirationDate && 
                        p.subscriptionInfo.totalClasses > 0
                    ).length,
                    'активен_но_0_остаток': problematic.filter(p => 
                        p.subscriptionInfo.subscriptionActive && 
                        p.subscriptionInfo.remainingClasses === 0 && 
                        p.subscriptionInfo.totalClasses > 0
                    ).length
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска проблемных абонементов:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка поиска проблемных абонементов'
        });
    }
});

// 📍 АНАЛИЗ КОНКРЕТНОЙ ПРОБЛЕМНОЙ СДЕЛКИ
app.get('/api/debug/analyze-problem/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 АНАЛИЗ ПРОБЛЕМНОЙ СДЕЛКИ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        // Детальный анализ полей
        const detailedAnalysis = {
            leadInfo: {
                id: lead.id,
                name: lead.name,
                statusId: lead.status_id,
                price: lead.price,
                createdAt: lead.created_at,
                updatedAt: lead.updated_at
            },
            subscriptionInfo: subscriptionInfo,
            fields: {
                all: [],
                subscription: [],
                problematic: []
            },
            issues: [],
            recommendations: []
        };
        
        // Анализируем поля
        if (lead.custom_fields_values) {
            lead.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                const fieldType = field.field_type;
                
                const fieldInfo = {
                    id: fieldId,
                    name: fieldName,
                    value: fieldValue,
                    type: fieldType,
                    values: field.values || []
                };
                
                detailedAnalysis.fields.all.push(fieldInfo);
                
                // Поля абонемента
                if (fieldName.includes('абонемент') || 
                    fieldName.includes('занят') || 
                    fieldName.includes('счетчик') ||
                    fieldName.includes('остаток') ||
                    fieldName.includes('окончание') ||
                    fieldName.includes('активация') ||
                    fieldName.includes('последний визит')) {
                    detailedAnalysis.fields.subscription.push(fieldInfo);
                }
                
                // Проверяем проблемы
                if (fieldName.includes('остаток') && fieldValue === '0' && subscriptionInfo.totalClasses > 0) {
                    detailedAnalysis.fields.problematic.push({
                        ...fieldInfo,
                        problem: 'Остаток 0, хотя есть абонемент'
                    });
                }
                
                if (fieldName.includes('счетчик') && fieldValue === '0' && subscriptionInfo.totalClasses > 0) {
                    detailedAnalysis.fields.problematic.push({
                        ...fieldInfo,
                        problem: 'Счетчик 0, хотя абонемент мог использоваться'
                    });
                }
            });
        }
        
        // Выявляем проблемы
        if (subscriptionInfo.totalClasses > 0 && subscriptionInfo.remainingClasses === 0 && subscriptionInfo.usedClasses === 0) {
            detailedAnalysis.issues.push('Абонемент на занятия есть, но остаток 0 и использовано 0');
            detailedAnalysis.recommendations.push('Проверить поле "Остаток занятий" - должно быть равно количеству занятий');
        }
        
        if (subscriptionInfo.totalClasses > 0 && !subscriptionInfo.expirationDate) {
            detailedAnalysis.issues.push('Нет даты окончания абонемента');
            detailedAnalysis.recommendations.push('Заполнить поле "Окончание абонемента:"');
        }
        
        if (subscriptionInfo.subscriptionActive && subscriptionInfo.remainingClasses === 0 && subscriptionInfo.totalClasses > 0) {
            detailedAnalysis.issues.push('Абонемент активен, но остаток занятий 0');
            detailedAnalysis.recommendations.push('Проверить корректность данных об абонементе');
        }
        
        // Проверяем названия полей
        const fieldNames = detailedAnalysis.fields.subscription.map(f => f.name);
        const requiredFields = ['абонемент занятий:', 'остаток занятий', 'счетчик занятий:', 'окончание абонемента:'];
        const missingFields = requiredFields.filter(req => 
            !fieldNames.some(name => name.includes(req.toLowerCase()))
        );
        
        if (missingFields.length > 0) {
            detailedAnalysis.issues.push(`Отсутствуют поля: ${missingFields.join(', ')}`);
            detailedAnalysis.recommendations.push(`Добавить недостающие поля в сделку`);
        }
        
        res.json({
            success: true,
            data: detailedAnalysis
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа сделки:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка анализа сделки'
        });
    }
});


// 📍 ДИАГНОСТИКА ИЗВЛЕЧЕНИЯ АБОНЕМЕНТА ИЗ СДЕЛКИ
app.get('/api/debug/subscription-extraction/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        
        console.log(`\n🔍 ЗАПРОС ДИАГНОСТИКИ ИЗВЛЕЧЕНИЯ АБОНЕМЕНТА: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const analysis = await amoCrmService.debugSubscriptionExtraction(leadId);
        
        if (!analysis) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена или ошибка анализа'
            });
        }
        
        res.json({
            success: true,
            data: analysis
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики извлечения абонемента:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка диагностики'
        });
    }
});


// 📍 ПОЛЯ КОНТАКТОВ
app.get('/api/debug/contact-fields', async (req, res) => {
    try {
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const fields = await amoCrmService.debugContactFields();
        
        res.json({
            success: true,
            message: 'Поля контактов получены',
            data: fields
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения полей контактов:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения полей контактов'
        });
    }
});

// 📍 ДЕТАЛЬНАЯ ДИАГНОСТИКА КОНТАКТА
app.get('/api/debug/contact-detailed/:id', async (req, res) => {
    try {
        const contactId = req.params.id;
        
        console.log(`\n🔍 ЗАПРОС ДЕТАЛЬНОЙ ДИАГНОСТИКИ КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const analysis = await amoCrmService.debugContactAnalysis(contactId);
        
        if (!analysis) {
            return res.status(404).json({
                success: false,
                error: 'Контакт не найден или ошибка анализа'
            });
        }
        
        res.json({
            success: true,
            data: analysis
        });
        
    } catch (error) {
        console.error('❌ Ошибка детальной диагностики контакта:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка диагностики контакта'
        });
    }
});

// 📍 ДИАГНОСТИКА КОНКРЕТНОЙ СДЕЛКИ
app.get('/api/debug/lead-analysis/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        
        console.log(`\n🔍 ЗАПРОС ДИАГНОСТИКИ СДЕЛКИ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const analysis = await amoCrmService.debugLeadAnalysis(leadId);
        
        if (!analysis) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена или ошибка анализа'
            });
        }
        
        res.json({
            success: true,
            data: analysis
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики сделки:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка диагностики'
        });
    }
});

// 📍 ПРОВЕРКА ТЕЛЕФОНА С ДЕТАЛЬНОЙ ДИАГНОСТИКОЙ
app.get('/api/debug/phone-detailed/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n🔍 ПОЛНАЯ ДИАГНОСТИКА ТЕЛЕФОНА: ${phone}`);
        console.log('='.repeat(80));
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        
        // 1. Ищем контакты
        console.log('\n🔍 Поиск контактов...');
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        // 2. Для каждого контакта получаем сделки и анализируем
        const detailedAnalysis = [];
        
        for (const contact of contacts) {
            console.log(`\n👤 Анализ контакта: ${contact.name} (ID: ${contact.id})`);
            
            // Получаем полную информацию о контакте
            const fullContact = await amoCrmService.getFullContactInfo(contact.id);
            
            // Получаем сделки контакта
            const leadsResponse = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contact.id}&limit=20`
            );
            
            const leads = leadsResponse._embedded?.leads || [];
            
            // Анализируем каждую сделку
            const leadAnalyses = [];
            for (const lead of leads) {
                const analysis = await amoCrmService.debugLeadAnalysis(lead.id);
                if (analysis) {
                    leadAnalyses.push(analysis);
                }
            }
            
            detailedAnalysis.push({
                contact: {
                    id: contact.id,
                    name: contact.name,
                    fields: fullContact?.custom_fields_values || []
                },
                leads: leadAnalyses,
                leadsCount: leads.length
            });
        }
        
        res.json({
            success: true,
            data: {
                phone: formattedPhone,
                contactsCount: contacts.length,
                detailedAnalysis: detailedAnalysis,
                fieldMappings: Object.fromEntries(amoCrmService.fieldMappings)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка детальной диагностики:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка диагностики'
        });
    }
});



// 📍 ДИАГНОСТИКА ПОИСКА УЧЕНИКА
app.get('/api/debug/student-search/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n🔍 ЗАПРОС ДИАГНОСТИКИ ПОИСКА УЧЕНИКА: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const results = await amoCrmService.debugStudentSearch(phone);
        
        if (!results) {
            return res.status(404).json({
                success: false,
                error: 'Ошибка диагностики'
            });
        }
        
        res.json({
            success: true,
            data: results
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики поиска:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка диагностики'
        });
    }
});

// Проверка связи с amoCRM
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
        
        // Проверяем доступность API
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

// Получение всех полей сделок (для проверки ID полей)
app.get('/api/debug/lead-fields', async (req, res) => {
    try {
        console.log('\n📋 ПОЛУЧЕНИЕ ВСЕХ ПОЛЕЙ СДЕЛОК');
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        const fields = await amoCrmService.makeRequest('GET', '/api/v4/leads/custom_fields');
        
        const subscriptionFields = [];
        const allFields = [];
        
        if (fields && fields._embedded && fields._embedded.custom_fields) {
            fields._embedded.custom_fields.forEach(field => {
                const fieldInfo = {
                    id: field.id,
                    name: field.name,
                    type: field.type,
                    enums: field.enums || []
                };
                
                allFields.push(fieldInfo);
                
                // Ищем поля абонементов
                if (field.name.toLowerCase().includes('абонемент') || 
                    field.name.toLowerCase().includes('занят') || 
                    field.name.toLowerCase().includes('счетчик') ||
                    field.name.toLowerCase().includes('остаток')) {
                    subscriptionFields.push(fieldInfo);
                }
            });
        }
        
        res.json({
            success: true,
            message: 'Поля успешно получены',
            timestamp: new Date().toISOString(),
            data: {
                total_fields: allFields.length,
                subscription_fields_count: subscriptionFields.length,
                subscription_fields: subscriptionFields,
                your_field_ids: amoCrmService.FIELD_IDS.LEAD,
                all_fields: allFields.slice(0, 50) // Ограничиваем вывод
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения полей:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения полей',
            error: error.message
        });
    }
});

// Проверка телефона - основной диагностический маршрут
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
        console.log(`📱 Форматированный номер: ${formattedPhone}`);
        
        // 1. Ищем контакты
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
        
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        // 2. Получаем профили учеников
        console.log('\n🎯 Получение профилей учеников...');
        const profiles = await amoCrmService.getStudentsByPhone(phone);
        
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
        
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        // 3. Проверяем наличие в локальной базе
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

// 🔧 ДОПОЛНИТЕЛЬНЫЙ ДИАГНОСТИЧЕСКИЙ МАРШРУТ
app.get('/api/debug/contact-details/:id', async (req, res) => {
    try {
        const contactId = req.params.id;
        
        console.log(`\n🔍 ПОДРОБНАЯ ДИАГНОСТИКА КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        // Получаем полную информацию о контакте
        const contact = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/contacts/${contactId}?with=custom_fields_values`
        );
        
        // Извлекаем учеников
        const students = amoCrmService.extractStudentsFromContact(contact);
        
        // Получаем все поля контакта
        const fields = [];
        if (contact.custom_fields_values) {
            contact.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                
                fields.push({
                    id: fieldId,
                    name: fieldName,
                    value: fieldValue,
                    raw: field.values
                });
            });
        }
        
        // Ищем email
        const email = amoCrmService.findEmail(contact);
        
        // Получаем сделки контакта
        const leadsResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&order[created_at]=desc&limit=5`
        );
        
        const leads = leadsResponse._embedded?.leads || [];
        
        // Анализируем абонементы в сделках
        const subscriptions = [];
        leads.forEach(lead => {
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            if (subscriptionInfo.hasSubscription) {
                subscriptions.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    created_at: lead.created_at,
                    status_id: lead.status_id,
                    subscription: subscriptionInfo
                });
            }
        });
        
        res.json({
            success: true,
            message: 'Детальная диагностика контакта',
            timestamp: new Date().toISOString(),
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name,
                    created_at: contact.created_at,
                    updated_at: contact.updated_at,
                    responsible_user_id: contact.responsible_user_id,
                    email: email
                },
                students: {
                    count: students.length,
                    items: students
                },
                fields: {
                    total: fields.length,
                    items: fields
                },
                leads: {
                    count: leads.length,
                    items: leads.map(lead => ({
                        id: lead.id,
                        name: lead.name,
                        created_at: lead.created_at,
                        status_id: lead.status_id,
                        pipeline_id: lead.pipeline_id
                    }))
                },
                subscriptions: {
                    count: subscriptions.length,
                    items: subscriptions
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка детальной диагностики:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка диагностики',
            error: error.message,
            contact_id: req.params.id
        });
    }
});

// 🔧 МАРШРУТ ДЛЯ ПРОВЕРКИ БАЗЫ ДАННЫХ
app.get('/api/debug/database-status', async (req, res) => {
    try {
        console.log('\n💾 ПРОВЕРКА БАЗЫ ДАННЫХ');
        
        // Получаем статистику
        const stats = await db.all(`
            SELECT 
                (SELECT COUNT(*) FROM student_profiles) as total_profiles,
                (SELECT COUNT(*) FROM student_profiles WHERE subscription_active = 1) as active_subscriptions,
                (SELECT COUNT(*) FROM student_profiles WHERE is_active = 1) as active_profiles,
                (SELECT COUNT(DISTINCT phone_number) FROM student_profiles) as unique_phones,
                (SELECT COUNT(*) FROM sync_logs) as total_syncs,
                (SELECT MAX(last_sync) FROM student_profiles WHERE last_sync IS NOT NULL) as last_profile_sync
        `);
        
        // Получаем последние 5 профилей
        const recentProfiles = await db.all(`
            SELECT 
                id, student_name, phone_number, branch, 
                subscription_status, total_classes, remaining_classes,
                last_sync, created_at, updated_at
            FROM student_profiles 
            ORDER BY updated_at DESC 
            LIMIT 5
        `);
        
        // Получаем последние 5 синхронизаций
        const recentSyncs = await db.all(`
            SELECT 
                id, sync_type, items_count, success_count, error_count,
                duration_ms, created_at
            FROM sync_logs 
            ORDER BY created_at DESC 
            LIMIT 5
        `);
        
        res.json({
            success: true,
            message: 'Статус базы данных',
            timestamp: new Date().toISOString(),
            data: {
                statistics: stats[0] || {},
                recent_profiles: recentProfiles,
                recent_syncs: recentSyncs,
                database_path: process.env.NODE_ENV === 'production' ? 'data/art_school.db' : ':memory:',
                total_tables: 3
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки базы данных:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка проверки базы',
            error: error.message
        });
    }
});

// Проверка конкретной сделки
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
                    value: fieldValue,
                    is_subscription_field: [
                        850241, 850257, 890163, 850255, 851565, 891007
                    ].includes(fieldId)
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
                    pipeline_id: lead.pipeline_id,
                    created_at: lead.created_at,
                    updated_at: lead.updated_at,
                    is_closed: [142, 143].includes(lead.status_id)
                },
                subscription: subscriptionInfo,
                fields: {
                    count: fields.length,
                    subscription_fields: fields.filter(f => f.is_subscription_field),
                    all_fields: fields
                },
                subscription_active: subscriptionInfo.subscriptionActive,
                has_subscription: subscriptionInfo.hasSubscription
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

// Проверка конкретного контакта
app.get('/api/debug/contact/:id', async (req, res) => {
    try {
        const contactId = req.params.id;
        
        console.log(`\n👤 ДИАГНОСТИКА КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        const contact = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/contacts/${contactId}?with=custom_fields_values`
        );
        
        const students = amoCrmService.extractStudentsFromContact(contact);
        
        const fields = [];
        if (contact.custom_fields_values) {
            contact.custom_fields_values.forEach(field => {
                const fieldId = field.field_id || field.id;
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                
                fields.push({
                    id: fieldId,
                    name: fieldName,
                    value: fieldValue,
                    is_child_field: [
                        867233, 867687, 867235, 867685, 867733, 867735
                    ].includes(fieldId)
                });
            });
        }
        
        // Получаем сделки контакта
        const leadsResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&limit=10`
        );
        
        const leads = leadsResponse._embedded?.leads || [];
        
        res.json({
            success: true,
            message: 'Контакт получен',
            timestamp: new Date().toISOString(),
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name,
                    created_at: contact.created_at,
                    updated_at: contact.updated_at
                },
                students: {
                    count: students.length,
                    items: students
                },
                fields: {
                    count: fields.length,
                    child_fields: fields.filter(f => f.is_child_field),
                    all_fields: fields
                },
                leads: {
                    count: leads.length,
                    items: leads.map(lead => ({
                        id: lead.id,
                        name: lead.name,
                        status_id: lead.status_id,
                        has_subscription_fields: lead.custom_fields_values?.some(f => 
                            [850241, 850257, 890163].includes(f.field_id || f.id)
                        )
                    }))
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики контакта:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения контакта',
            error: error.message,
            contact_id: req.params.id
        });
    }
});

// Статус системы
app.get('/api/debug/system-status', async (req, res) => {
    try {
        console.log('\n⚙️  СТАТУС СИСТЕМЫ');
        
        // Статистика базы данных
        const dbStats = await db.all(`
            SELECT 
                (SELECT COUNT(*) FROM student_profiles) as total_profiles,
                (SELECT COUNT(*) FROM student_profiles WHERE subscription_active = 1) as active_subscriptions,
                (SELECT COUNT(*) FROM student_profiles WHERE is_active = 1) as active_profiles,
                (SELECT COUNT(DISTINCT phone_number) FROM student_profiles) as unique_phones,
                (SELECT COUNT(*) FROM sync_logs) as total_syncs
        `);
        
        const lastSync = await db.get(
            `SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 1`
        );
        
        res.json({
            success: true,
            message: 'Статус системы',
            timestamp: new Date().toISOString(),
            data: {
                system: {
                    uptime: process.uptime(),
                    memory_usage: process.memoryUsage(),
                    node_version: process.version,
                    platform: process.platform
                },
                amocrm: {
                    connected: amoCrmService.isInitialized,
                    account_name: amoCrmService.accountInfo?.name || null,
                    subdomain: AMOCRM_SUBDOMAIN,
                    fields_loaded: amoCrmService.fieldMappings.size
                },
                database: dbStats[0] || {},
                synchronization: {
                    status: syncService.getSyncStatus(),
                    last_sync: lastSync
                },
                endpoints: {
                    main_auth: `${DOMAIN}/api/auth/phone`,
                    get_subscription: `${DOMAIN}/api/subscription`,
                    check_phone: `${DOMAIN}/api/debug/phone/79175161115`,
                    connection_test: `${DOMAIN}/api/debug/connection`,
                    system_status: `${DOMAIN}/api/debug/system-status`
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статуса системы:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения статуса',
            error: error.message
        });
    }
});

// ==================== API СИНХРОНИЗАЦИИ ====================

app.get('/api/sync/status', async (req, res) => {
    try {
        const status = syncService.getSyncStatus();
        
        // Получаем статистику из логов
        const lastSync = await db.get(
            `SELECT * FROM sync_logs 
             WHERE sync_type = 'auto_sync' 
             ORDER BY created_at DESC LIMIT 1`
        );
        
        const syncStats = await db.get(
            `SELECT 
                COUNT(*) as total_syncs,
                SUM(success_count) as total_success,
                SUM(error_count) as total_errors,
                AVG(duration_ms) as avg_duration
             FROM sync_logs 
             WHERE sync_type = 'auto_sync'`
        );
        
        res.json({
            success: true,
            data: {
                sync_status: status,
                last_sync: lastSync || null,
                statistics: syncStats || null,
                total_profiles: await db.get(`SELECT COUNT(*) as count FROM student_profiles WHERE is_active = 1`),
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

app.post('/api/sync/phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`\n🔧 РУЧНАЯ СИНХРОНИЗАЦИЯ ДЛЯ ТЕЛЕФОНА: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const result = await syncService.syncSinglePhone(phone);
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Ошибка ручной синхронизации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка синхронизации'
        });
    }
});

// ==================== ДОПОЛНИТЕЛЬНЫЕ API ====================

app.get('/api/profile/:id', async (req, res) => {
    try {
        const profileId = req.params.id;
        
        console.log(`👤 ЗАПРОС ПРОФИЛЯ ID: ${profileId}`);
        
        const profile = await db.get(
            `SELECT * FROM student_profiles WHERE id = ?`,
            [profileId]
        );
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Профиль не найден'
            });
        }
        
        // Рассчитываем прогресс
        let progress = 0;
        if (profile.total_classes > 0) {
            progress = Math.round((profile.used_classes / profile.total_classes) * 100);
        }
        
        res.json({
            success: true,
            data: {
                profile: {
                    student: {
                        id: profile.id,
                        name: profile.student_name,
                        phone: profile.phone_number,
                        email: profile.email,
                        birth_date: profile.birth_date,
                        branch: profile.branch || 'Филиал не указан',
                        age_group: profile.age_group,
                        course: profile.course,
                        allergies: profile.allergies
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
                    } : null
                },
                stats: {
                    total_visits: profile.used_classes || 0,
                    remaining_classes: profile.remaining_classes || 0,
                    usage_percentage: progress,
                    last_sync: profile.last_sync
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения профиля:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профиля'
        });
    }
});

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

app.get('/api/crm/status', async (req, res) => {
    try {
        const isValid = amoCrmService.isInitialized;
        
        res.json({
            success: true,
            data: {
                connected: isValid,
                account_name: amoCrmService.accountInfo?.name || null,
                subdomain: AMOCRM_SUBDOMAIN,
                last_check: new Date().toISOString(),
                field_count: amoCrmService.fieldMappings.size
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки статуса CRM:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки статуса CRM'
        });
    }
});

// ==================== ПРОДОЛЖЕНИЕ server.js (добавить перед startServer) ====================

// 📍 ПРОФИЛЬ ПО ID
app.get('/api/profile/:id', async (req, res) => {
    try {
        const profileId = req.params.id;
        
        console.log(`👤 ЗАПРОС ПРОФИЛЯ ID: ${profileId}`);
        
        const profile = await db.get(
            `SELECT * FROM student_profiles WHERE id = ?`,
            [profileId]
        );
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Профиль не найден'
            });
        }
        
        let progress = 0;
        if (profile.total_classes > 0) {
            progress = Math.round((profile.used_classes / profile.total_classes) * 100);
        }
        
        res.json({
            success: true,
            data: {
                profile: {
                    student: {
                        id: profile.id,
                        name: profile.student_name,
                        phone: profile.phone_number,
                        email: profile.email,
                        birth_date: profile.birth_date,
                        branch: profile.branch || 'Филиал не указан',
                        age_group: profile.age_group,
                        course: profile.course,
                        allergies: profile.allergies
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
                    } : null
                },
                stats: {
                    total_visits: profile.used_classes || 0,
                    remaining_classes: profile.remaining_classes || 0,
                    usage_percentage: progress,
                    last_sync: profile.last_sync
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения профиля:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профиля'
        });
    }
});

// 📍 ВСЕ ПРОФИЛИ ПОЛЬЗОВАТЕЛЯ
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

// 📍 ПРОВЕРКА ЗДОРОВЬЯ
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

// 📍 СТАТУС CRM
app.get('/api/crm/status', async (req, res) => {
    try {
        const isValid = amoCrmService.isInitialized;
        
        res.json({
            success: true,
            data: {
                connected: isValid,
                account_name: amoCrmService.accountInfo?.name || null,
                subdomain: AMOCRM_SUBDOMAIN,
                last_check: new Date().toISOString(),
                field_count: amoCrmService.fieldMappings.size
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки статуса CRM:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки статуса CRM'
        });
    }
});

// 📍 СТАТУС СИНХРОНИЗАЦИИ
app.get('/api/sync/status', async (req, res) => {
    try {
        const status = syncService.getSyncStatus();
        
        const lastSync = await db.get(
            `SELECT * FROM sync_logs 
             WHERE sync_type = 'auto_sync' 
             ORDER BY created_at DESC LIMIT 1`
        );
        
        const syncStats = await db.get(
            `SELECT 
                COUNT(*) as total_syncs,
                SUM(success_count) as total_success,
                SUM(error_count) as total_errors,
                AVG(duration_ms) as avg_duration
             FROM sync_logs 
             WHERE sync_type = 'auto_sync'`
        );
        
        res.json({
            success: true,
            data: {
                sync_status: status,
                last_sync: lastSync || null,
                statistics: syncStats || null,
                total_profiles: await db.get(`SELECT COUNT(*) as count FROM student_profiles WHERE is_active = 1`),
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

// 📍 РУЧНАЯ СИНХРОНИЗАЦИЯ ТЕЛЕФОНА
app.post('/api/sync/phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`\n🔧 РУЧНАЯ СИНХРОНИЗАЦИЯ ДЛЯ ТЕЛЕФОНА: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const result = await syncService.syncSinglePhone(phone);
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Ошибка ручной синхронизации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка синхронизации'
        });
    }
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v4.0');
        console.log('='.repeat(80));
        console.log('✨ ТОЛЬКО РЕАЛЬНЫЕ ДАННЫЕ ИЗ AMOCRM');
        console.log('✨ АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ КАЖДЫЕ 10 МИНУТ');
        console.log('✨ КОРРЕКТНЫЙ ПОИСК ПО ТЕЛЕФОНУ И ИМЕНИ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            
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
            console.log(`🔍 Профили пользователя: GET http://localhost:${PORT}/api/profiles`);
            console.log(`📋 Абонемент: POST http://localhost:${PORT}/api/subscription`);
            console.log(`🔄 Статус синхронизации: GET http://localhost:${PORT}/api/sync/status`);
            console.log(`🔧 Ручная синхронизация: POST http://localhost:${PORT}/api/sync/phone`);
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
