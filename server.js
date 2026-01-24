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
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.fieldMappings = new Map();
        
        // Обновленные FIELD_IDS
        this.FIELD_IDS = {
            // Сделки (абонементы)
            LEAD: {
                TOTAL_CLASSES: 850241,    // "Абонемент занятий:" ✓
                USED_CLASSES: 850257,     // "Счетчик занятий:" ✓  
                REMAINING_CLASSES: 890163, // "Остаток занятий" ✓
                EXPIRATION_DATE: 850255,  // "Окончание абонемента:" ✓
                ACTIVATION_DATE: 851565,  // "Дата активации абонемента:" ✓
                LAST_VISIT_DATE: 850259,  // "Дата последнего визита:" ✓
                SUBSCRIPTION_TYPE: 891007, // "Тип абонемента" ✓
                BRANCH: null,             // "Филиал" в сделке
                AGE_GROUP: 850243,        // "Группа возраст:" ✓
                FREEZE: 867693,           // "Заморозка абонемента:" ✓
                SUBSCRIPTION_OWNER: 805465, // "Принадлежность абонемента:" ✓
                
                // Поля для посещений (checkbox)
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
                CHILD_1_NAME: 867233,    // "!ФИО ребенка:" ✓
                CHILD_1_BIRTHDAY: null,  // ДР ребенка 1
                CHILD_2_NAME: 867235,    // "!!ФИО ребенка:" ✓
                CHILD_2_BIRTHDAY: 867685, // "День рождения:" для ребенка 2 ✓
                CHILD_3_NAME: 867733,    // "!!!ФИО ребенка:" ✓
                CHILD_3_BIRTHDAY: 867735, // "День рождения:" для ребенка 3 ✓
                
                // Основные поля
                BRANCH: 871273,          // "Филиал:" ✓
                TEACHER: 888881,         // "Преподаватель" ✓
                DAY_OF_WEEK: 892225,     // "День недели (2025-26)" ✓
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
            
            // Теперь вызываем extractSubscriptionInfo
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
                    
                    const bestLead = await this.findActiveSubscriptionForContact(contact.id, child.studentName);
                    
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
            
            // Собираем данные из полей
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                const fieldValue = this.getFieldValue(field);
                
                // Обработка поля "Абонемент занятий:" (ID: 850241)
                if (fieldId === 850241) {
                    console.log(`📊 [850241] Абонемент занятий: "${fieldValue}"`);
                    
                    if (fieldValue.includes('База - 16 занятий')) {
                        fieldData.totalClasses = 16;
                    } else if (fieldValue.includes('4 занятия')) {
                        fieldData.totalClasses = 4;
                    } else if (fieldValue.includes('8 занятий')) {
                        fieldData.totalClasses = 8;
                    } else if (fieldValue.includes('12 занятий')) {
                        fieldData.totalClasses = 12;
                    } else {
                        const numMatch = fieldValue.match(/(\d+)/);
                        if (numMatch) {
                            fieldData.totalClasses = parseInt(numMatch[1]);
                        }
                    }
                } else if (fieldId === 891819) {
                    // "количество занятий (тех)"
                    const classes = parseInt(fieldValue) || 0;
                    if (classes > 0 && fieldData.totalClasses === 0) {
                        fieldData.totalClasses = classes;
                        console.log(`📊 [891819] Количество занятий (тех): ${classes}`);
                    }
                } else if (fieldId === 850257) {
                    // "счетчик занятий:"
                    const used = parseInt(fieldValue) || 0;
                    fieldData.usedClasses = used;
                    fieldData.counterValue = used;
                    console.log(`📊 [850257] Счетчик занятий: ${used}`);
                } else if (fieldId === 890163) {
                    // "остаток занятий"
                    const remaining = parseInt(fieldValue) || 0;
                    fieldData.remainingClasses = remaining;
                    console.log(`📊 [890163] Остаток занятий: ${remaining}`);
                } else if (fieldId === 891007) {
                    // "тип абонемента"
                    fieldData.subscriptionType = fieldValue;
                    console.log(`📊 [891007] Тип абонемента: ${fieldValue}`);
                } else if (fieldId === 850255) {
                    // "окончание абонемента:"
                    fieldData.expirationDate = this.parseDateOrTimestamp(fieldValue);
                    console.log(`📊 [850255] Окончание: ${fieldData.expirationDate}`);
                } else if (fieldId === 851565) {
                    // "дата активации абонемента:"
                    fieldData.activationDate = this.parseDateOrTimestamp(fieldValue);
                    console.log(`📊 [851565] Активация: ${fieldData.activationDate}`);
                } else if (fieldId === 850259) {
                    // "дата последнего визита:"
                    fieldData.lastVisitDate = this.parseDateOrTimestamp(fieldValue);
                    console.log(`📊 [850259] Последний визит: ${fieldData.lastVisitDate}`);
                } else if (fieldId === 867693) {
                    // "заморозка абонемента:"
                    const freezeValue = String(fieldValue).toLowerCase();
                    fieldData.isFrozen = freezeValue === 'да' || freezeValue === 'true' || freezeValue === '1';
                    console.log(`📊 [867693] Заморожен: ${fieldData.isFrozen}`);
                }
                
                // Проверяем чекбоксы посещений
                if (fieldId >= 884899 && fieldId <= 884929) {
                    const isChecked = fieldValue === 'true' || fieldValue === '1' || fieldValue === true;
                    if (isChecked) {
                        fieldData.usedClasses++;
                    }
                }
            }
            
            // Парсим название сделки (как запасной вариант)
            if (fieldData.totalClasses === 0) {
                const nameClasses = this.parseLeadNameForSubscription(leadName);
                
                if (nameClasses === 0) {
                    const complexClasses = this.parseComplexLeadName(leadName);
                    if (complexClasses > 0) {
                        fieldData.totalClasses = complexClasses;
                        console.log(`📊 Из сложного названия: ${complexClasses} занятий`);
                    }
                } else if (nameClasses > 0) {
                    fieldData.totalClasses = nameClasses;
                    console.log(`📊 Из названия: ${nameClasses} занятий`);
                }
            }
            
            // Рассчет основных показателей
            subscriptionInfo.totalClasses = fieldData.totalClasses;
            
            if (fieldData.counterValue > 0) {
                subscriptionInfo.usedClasses = fieldData.counterValue;
            } else if (fieldData.usedClasses > 0) {
                subscriptionInfo.usedClasses = fieldData.usedClasses;
            }
            
            if (fieldData.remainingClasses > 0) {
                subscriptionInfo.remainingClasses = fieldData.remainingClasses;
            } else if (subscriptionInfo.totalClasses > 0) {
                subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
            }
            
            // Определение статуса
            let isExpired = false;
            if (fieldData.expirationDate) {
                try {
                    const expDate = new Date(fieldData.expirationDate);
                    isExpired = expDate < now;
                } catch (e) {}
            }
            
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
            
            if (fieldData.isFrozen) {
                subscriptionInfo.subscriptionStatus = 'Абонемент заморожен';
                subscriptionInfo.subscriptionBadge = 'frozen';
                subscriptionInfo.subscriptionActive = false;
            } else if (isExpired && !hasEndedInName) {
                subscriptionInfo.subscriptionStatus = 'Абонемент истек';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            } else if (!hasRemaining || hasEndedInName) {
                subscriptionInfo.subscriptionStatus = 'Занятия закончились';
                subscriptionInfo.subscriptionBadge = 'expired';
                subscriptionInfo.subscriptionActive = false;
            } else if (hasRemaining && hasUsed) {
                subscriptionInfo.subscriptionStatus = `Активный (осталось ${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
                subscriptionInfo.subscriptionBadge = 'active';
                subscriptionInfo.subscriptionActive = true;
            } else if (hasRemaining && !hasUsed) {
                subscriptionInfo.subscriptionStatus = `Купленный (${subscriptionInfo.remainingClasses}/${subscriptionInfo.totalClasses} занятий)`;
                subscriptionInfo.subscriptionBadge = 'has_subscription';
                subscriptionInfo.subscriptionActive = true;
            } else if (hasClasses) {
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

    parseNumberFromString(value) {
        if (!value) return 0;
        
        try {
            const str = String(value).toLowerCase();
            
            if (str.includes('разовый') || str.includes('пробное')) {
                return 1;
            }
            
            const match = str.match(/(\d+)/);
            if (match) {
                return parseInt(match[1]);
            }
            
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

    async debugSubscriptionAnalysis(leadId) {
        try {
            console.log(`\n🔍 ПОЛНЫЙ АНАЛИЗ АБОНЕМЕНТА ID: ${leadId}`);
            
            const lead = await this.makeRequest(
                'GET',
                `/api/v4/leads/${leadId}?with=custom_fields_values`
            );
            
            const customFields = lead.custom_fields_values || [];
            
            console.log(`\n📋 СДЕЛКА: "${lead.name}"`);
            console.log(`📅 Статус ID: ${lead.status_id}`);
            console.log(`📊 Цена: ${lead.price}`);
            
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
                
                console.log(`ID:${fieldId} "${fieldName}" = "${fieldValue}" (${fieldType})`);
                
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
    
    extractStudentsFromContact(contact) {
        const students = [];
        
        try {
            const customFields = contact.custom_fields_values || [];
            const contactName = contact.name || '';
            
            console.log(`\n👤 Поиск детей в контакте: "${contactName}"`);
            
            const childrenConfig = [
                { number: 1, nameFieldId: 867233 },
                { number: 2, nameFieldId: 867235 },
                { number: 3, nameFieldId: 867733 }
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
                
                if (hasChildData && childInfo.studentName) {
                    for (const field of customFields) {
                        const fieldId = field.field_id || field.id;
                        const fieldValue = this.getFieldValue(field);
                        
                        if (!fieldValue || fieldValue.trim() === '') continue;
                        
                        if (fieldId === 871273) {
                            childInfo.branch = fieldValue;
                        } else if (fieldId === 888881) {
                            childInfo.teacherName = fieldValue;
                        } else if (fieldId === 892225) {
                            childInfo.dayOfWeek = fieldValue;
                        } else if (fieldId === 888903) {
                            childInfo.ageGroup = fieldValue;
                        } else if (fieldId === 890179) {
                            childInfo.hasActiveSubscription = fieldValue.toLowerCase() === 'да' || 
                                                             fieldValue === '1' || 
                                                             fieldValue.toLowerCase() === 'true';
                        } else if (fieldId === 885380) {
                            childInfo.lastVisitDate = this.parseDate(fieldValue);
                        } else if (fieldId === 850239) {
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

    async getAllActiveSubscriptions(limit = 100) {
        try {
            console.log(`\n📊 ПОЛНАЯ ВЫГРУЗКА ВСЕХ АКТИВНЫХ АБОНЕМЕНТОВ`);
            console.log('='.repeat(80));
            
            if (!this.isInitialized) {
                console.log('❌ amoCRM не инициализирован');
                return [];
            }
            
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&limit=${limit}&order[updated_at]=desc`
            );
            
            const allLeads = response._embedded?.leads || [];
            console.log(`📋 Всего сделок получено: ${allLeads.length}`);
            
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
            
            this.analyzeSubscriptionPatterns(subscriptions);
            
            return subscriptions;
            
        } catch (error) {
            console.error('❌ Ошибка выгрузки абонементов:', error.message);
            return [];
        }
    }

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
            
            patterns.totalClasses.add(`${info.totalClasses} занятий (${sub.leadName})`);
            patterns.usedClasses.add(`Использовано: ${info.usedClasses} (${sub.leadName})`);
            patterns.remainingClasses.add(`Осталось: ${info.remainingClasses} (${sub.leadName})`);
            patterns.subscriptionTypes.add(`${info.subscriptionType || 'Не указан'} (${sub.leadName})`);
            
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
            
            if (info.totalClasses > 0 && info.remainingClasses === 0 && info.usedClasses === 0) {
                patterns.commonIssues.push(`${sub.leadName}: ${info.totalClasses} занятий, но остаток 0 и использовано 0`);
            }
            
            if (info.totalClasses > 0 && info.remainingClasses > info.totalClasses) {
                patterns.commonIssues.push(`${sub.leadName}: остаток ${info.remainingClasses} > всего ${info.totalClasses}`);
            }
        });
        
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
                
                const status = info.subscriptionStatus.split('(')[0].trim();
                stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
                
                const type = info.subscriptionType || 'Не указан';
                stats.byType[type] = (stats.byType[type] || 0) + 1;
                
                if (info.totalClasses > 0) {
                    stats.byClassCount[info.totalClasses] = (stats.byClassCount[info.totalClasses] || 0) + 1;
                }
                
                if (info.subscriptionActive) stats.activeCount++;
                if (info.subscriptionStatus.includes('истек')) stats.expiredCount++;
                if (info.isFrozen) stats.frozenCount++;
                if (info.remainingClasses > 0) stats.withRemaining++;
                else stats.withoutRemaining++;
                
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
                subscriptions: subscriptions.slice(0, 50),
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
                
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) {
                    console.log('❌ Не удалось получить полную информацию о контакте');
                    continue;
                }
                
                const children = this.extractStudentsFromContact(fullContact);
                console.log(`📊 Найдено детей в контакте: ${children.length}`);
                
                if (children.length === 0) {
                    console.log('⚠️  Дети не найдены в контакте, пропускаем');
                    continue;
                }
                
                console.log('🔍 Получение ВСЕХ сделок контакта...');
                const leads = await this.getContactLeadsSorted(contact.id);
                console.log(`📊 Найдено сделок: ${leads.length}`);
                
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
                
                for (const child of children) {
                    console.log(`\n🎯 Поиск абонемента для: "${child.studentName}"`);
                    
                    const bestLead = await this.findActiveSubscriptionForContact(contact.id, child.studentName);
                    
                    let subscriptionInfo;
                    if (bestLead) {
                        console.log(`✅ Найдена сделка: "${bestLead.name}" (ID: ${bestLead.id})`);
                        subscriptionInfo = this.extractSubscriptionInfo(bestLead);
                    } else {
                        console.log(`❌ Не найдено подходящей сделки для "${child.studentName}"`);
                        
                        for (const lead of leads) {
                            const tempInfo = this.extractSubscriptionInfo(lead);
                            if (tempInfo.hasSubscription) {
                                console.log(`⚠️  Найдена альтернативная сделка: "${lead.name}"`);
                                subscriptionInfo = tempInfo;
                                break;
                            }
                        }
                        
                        if (!subscriptionInfo) {
                            subscriptionInfo = this.extractSubscriptionInfo(null);
                            console.log(`⚠️  Абонемент не найден`);
                        }
                    }
                    
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
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&order[updated_at]=desc&limit=100`
            );
            
            const allLeads = response._embedded?.leads || [];
            
            console.log(`📊 Всего сделок у контакта: ${allLeads.length}`);
            
            const filteredLeads = allLeads.filter(lead => {
                const leadName = lead.name || '';
                
                const excludePatterns = [
                    /^рассылка/i,
                    /^для рассылки/i,
                    /^успешн/i,
                    /^архив/i,
                    /^отменен/i,
                    /^не\s+актив/i
                ];
                
                return !excludePatterns.some(pattern => pattern.test(leadName));
            });
            
            console.log(`✅ После фильтрации: ${filteredLeads.length} сделок`);
            
            return filteredLeads;
            
        } catch (error) {
            console.error(`⚠️  Ошибка получения сделок: ${error.message}`);
            return [];
        }
    }

    extractStudentNameFromLead(lead) {
        try {
            const customFields = lead.custom_fields_values || [];
            const leadName = lead.name || '';
            
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (fieldValue && (fieldName.includes('ученик') || 
                                   fieldName.includes('ребен') || 
                                   fieldName.includes('фио'))) {
                    return fieldValue;
                }
            }
            
            return leadName;
        } catch (error) {
            console.error('❌ Ошибка извлечения имени из сделки:', error);
            return '';
        }
    }

    async findActiveSubscriptionForContact(contactId, studentName = '') {
        try {
            console.log(`\n🔍 ПОИСК АКТИВНОЙ СДЕЛКИ ДЛЯ КОНТАКТА ${contactId}, УЧЕНИК: "${studentName}"`);
            
            const leads = await this.getContactLeadsSorted(contactId);
            console.log(`📊 Всего сделок у контакта: ${leads.length}`);
            
            if (leads.length === 0) {
                console.log('❌ Сделки не найдены');
                return null;
            }
            
            let bestLead = null;
            let bestScore = -1;
            let bestSubscriptionInfo = null;
            
            for (const lead of leads) {
                console.log(`\n📋 Проверка сделки: "${lead.name}" (ID: ${lead.id})`);
                
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (!subscriptionInfo.hasSubscription) {
                    console.log(`   ❌ Нет абонемента`);
                    continue;
                }
                
                let score = 0;
                
                if (studentName) {
                    const belongs = this.checkIfLeadBelongsToStudent(lead.name, studentName);
                    if (belongs) {
                        console.log(`   ✅ Принадлежит ученику: ${studentName}`);
                        score += 100;
                    } else {
                        console.log(`   ❌ Не принадлежит ученику: ${studentName}`);
                    }
                }
                
                if (subscriptionInfo.subscriptionActive) {
                    score += 50;
                    console.log(`   ✅ Абонемент активен`);
                }
                
                if (subscriptionInfo.remainingClasses > 0) {
                    score += 30;
                    console.log(`   ✅ Есть остаток занятий: ${subscriptionInfo.remainingClasses}`);
                }
                
                if (subscriptionInfo.totalClasses > 0) {
                    score += 20;
                }
                
                const leadDate = new Date(lead.updated_at || lead.created_at || 0);
                const daysOld = (Date.now() - leadDate.getTime()) / (1000 * 60 * 60 * 24);
                score += Math.max(0, 50 - daysOld * 5);
                
                console.log(`   📊 Итоговый балл: ${score}`);
                
                if (score > bestScore) {
                    bestScore = score;
                    bestLead = lead;
                    bestSubscriptionInfo = subscriptionInfo;
                }
            }
            
            if (!bestLead && studentName) {
                console.log(`\n🔍 Поиск любой активной сделки (не найдено по имени)`);
                
                for (const lead of leads) {
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    
                    if (subscriptionInfo.hasSubscription && subscriptionInfo.subscriptionActive) {
                        console.log(`✅ Найдена активная сделка: "${lead.name}"`);
                        bestLead = lead;
                        bestSubscriptionInfo = subscriptionInfo;
                        break;
                    }
                }
            }
            
            if (!bestLead) {
                console.log(`\n🔍 Поиск любой сделки с абонементом`);
                
                for (const lead of leads) {
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    
                    if (subscriptionInfo.hasSubscription) {
                        console.log(`✅ Найдена сделка с абонементом: "${lead.name}"`);
                        bestLead = lead;
                        bestSubscriptionInfo = subscriptionInfo;
                        break;
                    }
                }
            }
            
            if (bestLead) {
                console.log(`\n🎯 ВЫБРАНА ЛУЧШАЯ СДЕЛКА:`);
                console.log(`   Название: "${bestLead.name}"`);
                console.log(`   ID: ${bestLead.id}`);
                console.log(`   Балл: ${bestScore}`);
                console.log(`   Абонемент: ${bestSubscriptionInfo.subscriptionStatus}`);
                console.log(`   Занятий: ${bestSubscriptionInfo.totalClasses}`);
                console.log(`   Осталось: ${bestSubscriptionInfo.remainingClasses}`);
                console.log(`   Активен: ${bestSubscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
            } else {
                console.log(`\n❌ Подходящая сделка не найдена`);
            }
            
            return bestLead;
            
        } catch (error) {
            console.error(`❌ Ошибка поиска сделки: ${error.message}`);
            return null;
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
        console.log(`\n🔍 Поиск лучшей сделки для ученика: "${studentName}"`);
        console.log(`📊 Всего сделок: ${leads.length}`);
        
        const validLeads = leads.filter(lead => {
            const subscriptionInfo = this.extractSubscriptionInfo(lead);
            
            const leadName = lead.name || '';
            const isBadName = leadName.includes('Рассылка') || 
                             leadName.includes('Успешные') ||
                             leadName.includes('Архив') ||
                             leadName.match(/^Для рассылки/i);
            
            return !isBadName && 
                   subscriptionInfo.hasSubscription && 
                   subscriptionInfo.subscriptionActive &&
                   subscriptionInfo.remainingClasses > 0;
        });
        
        console.log(`✅ Подходящих сделок после фильтрации: ${validLeads.length}`);
        
        if (validLeads.length === 0) {
            console.log('⚠️  Нет подходящих активных сделок');
            return null;
        }
        
        validLeads.sort((a, b) => {
            const infoA = this.extractSubscriptionInfo(a);
            const infoB = this.extractSubscriptionInfo(b);
            
            if (infoB.remainingClasses !== infoA.remainingClasses) {
                return infoB.remainingClasses - infoA.remainingClasses;
            }
            
            const dateA = new Date(a.updated_at || a.created_at || 0);
            const dateB = new Date(b.updated_at || b.created_at || 0);
            if (dateB.getTime() !== dateA.getTime()) {
                return dateB.getTime() - dateA.getTime();
            }
            
            return infoB.totalClasses - infoA.totalClasses;
        });
        
        const bestLead = validLeads[0];
        const bestInfo = this.extractSubscriptionInfo(bestLead);
        
        console.log(`\n✅ ВЫБРАНА ЛУЧШАЯ СДЕЛКА:`);
        console.log(`   Название: "${bestLead.name}"`);
        console.log(`   ID: ${bestLead.id}`);
        console.log(`   Занятий: ${bestInfo.totalClasses}`);
        console.log(`   Осталось: ${bestInfo.remainingClasses}`);
        console.log(`   Активен: ${bestInfo.subscriptionActive}`);
        console.log(`   Статус: ${bestInfo.subscriptionStatus}`);
        
        return bestLead;
    }

    checkIfLeadBelongsToStudent(leadName, studentName) {
        if (!leadName || !studentName) return true;
        
        const cleanLeadName = leadName.toLowerCase().trim();
        const cleanStudentName = studentName.toLowerCase().trim();
        
        const studentFirstName = cleanStudentName.split(' ')[0] || '';
        
        if (!studentFirstName) return true;
        
        console.log(`   🔍 Проверка принадлежности: сделка "${cleanLeadName}", ученик "${cleanStudentName}"`);
        console.log(`   🔍 Имя ученика для поиска: "${studentFirstName}"`);
        
        if (cleanLeadName.includes(cleanStudentName)) {
            console.log(`   ✅ Прямое вхождение полного имени`);
            return true;
        }
        
        if (studentFirstName && cleanLeadName.includes(studentFirstName)) {
            const regex = new RegExp(`\\b${studentFirstName}\\b`, 'i');
            if (regex.test(leadName)) {
                console.log(`   ✅ Вхождение первого имени`);
                return true;
            }
        }
        
        const pattern = /^([а-яё\s]+)\s*-\s*/i;
        const match = leadName.match(pattern);
        
        if (match) {
            const nameInLead = match[1].trim().toLowerCase();
            console.log(`   🔍 Найдено имя в паттерне: "${nameInLead}"`);
            
            const firstNameInLead = nameInLead.split(' ')[0] || '';
            if (firstNameInLead && firstNameInLead === studentFirstName) {
                console.log(`   ✅ Совпадение по паттерну`);
                return true;
            }
        }
        
        const dashPattern = /-\s*([а-яё\s]+)/i;
        const dashMatch = leadName.match(dashPattern);
        
        if (dashMatch) {
            const nameAfterDash = dashMatch[1].trim().toLowerCase();
            console.log(`   🔍 Найдено имя после дефиса: "${nameAfterDash}"`);
            
            const firstNameAfterDash = nameAfterDash.split(' ')[0] || '';
            if (firstNameAfterDash && firstNameAfterDash === studentFirstName) {
                console.log(`   ✅ Совпадение по дефису`);
                return true;
            }
        }
        
        console.log(`   ❌ Не принадлежит ученику`);
        return false;
    }
    
    findBestLeadFallback(studentName, leads) {
        console.log(`🔍 Запасной поиск среди всех сделок...`);
        
        let bestLead = null;
        let bestScore = 0;
        
        for (const lead of leads) {
            let score = 0;
            const leadName = lead.name || '';
            
            if (leadName.includes('Рассылка') || leadName.includes('Успешные') || 
                leadName.includes('Архив') || leadName.match(/^\d+\s*₽/)) {
                continue;
            }
            
            if (leadName.toLowerCase().includes('абонемент')) {
                score += 50;
            }
            
            const studentFirstName = studentName.split(' ')[0] || '';
            if (studentFirstName && leadName.includes(studentFirstName)) {
                score += 30;
            }
            
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
            
            const dashPattern = /-\s*(\d+)\s{1,3}занят/i;
            const dashMatch = leadName.match(dashPattern);
            if (dashMatch && dashMatch[1]) {
                const num = parseInt(dashMatch[1]);
                if (num >= 1 && num <= 50) {
                    console.log(`✅ Паттерн 1 (через дефис): ${num} занятий`);
                    return num;
                }
            }
            
            const spacesPattern = /(\d+)\s{0,3}занят/i;
            const spacesMatch = lowerName.match(spacesPattern);
            if (spacesMatch && spacesMatch[1]) {
                const num = parseInt(spacesMatch[1]);
                if (num >= 1 && num <= 50) {
                    console.log(`✅ Паттерн 2 (пробелы): ${num} занятий`);
                    return num;
                }
            }
            
            if (lowerName.includes('абонемент')) {
                const abonementMatch = lowerName.match(/абонемент\s+(\d+)/i);
                if (abonementMatch && abonementMatch[1]) {
                    const num = parseInt(abonementMatch[1]);
                    if (num >= 1 && num <= 50) {
                        console.log(`✅ Паттерн 3 (абонемент): ${num} занятий`);
                        return num;
                    }
                }
            }
            
            if (lowerName.includes('на')) {
                const naMatch = lowerName.match(/на\s+(\d+)\s+занят/i);
                if (naMatch && naMatch[1]) {
                    const num = parseInt(naMatch[1]);
                    if (num >= 1 && num <= 50) {
                        console.log(`✅ Паттерн 4 (на N занятий): ${num} занятий`);
                        return num;
                    }
                }
            }
            
            if (lowerName.includes('разовый') || lowerName.includes('пробное')) {
                console.log(`✅ Паттерн 5 (разовое): 1 занятие`);
                return 1;
            }
            
            const endMatch = leadName.match(/(\d{1,2})\s*$/);
            if (endMatch && endMatch[1]) {
                const num = parseInt(endMatch[1]);
                if (num >= 1 && num <= 50) {
                    console.log(`✅ Паттерн 6 (число в конце): ${num} занятий`);
                    return num;
                }
            }
            
            const romanNumerals = {
                ' i ': 1, ' ii ': 2, ' iii ': 3, ' iv ': 4, ' v ': 5,
                ' vi ': 6, ' vii ': 7, ' viii ': 8, ' ix ': 9, ' x ': 10
            };
            
            for (const [roman, num] of Object.entries(romanNumerals)) {
                if (lowerName.includes(roman)) {
                    console.log(`✅ Паттерн 7 (римские цифры): ${num} занятий`);
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

    parseComplexLeadName(leadName) {
        if (!leadName) return 0;
        
        try {
            console.log(`🔍 Расширенный парсинг: "${leadName}"`);
            
            let cleanedName = leadName
                .replace(/[а-яёА-ЯЁ\s\-–—()«»"']+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            
            console.log(`🔍 Очищенное название: "${cleanedName}"`);
            
            const occupationPattern = /(\d+)\s*(?:занятий|занятия|уроков|урока)/i;
            const occupationMatch = leadName.match(occupationPattern);
            
            if (occupationMatch && occupationMatch[1]) {
                const num = parseInt(occupationMatch[1]);
                if (num >= 1 && num <= 50) {
                    console.log(`✅ Найдено в сложном названии: ${num} занятий`);
                    return num;
                }
            }
            
            const numbers = leadName.match(/\d+/g);
            if (numbers && numbers.length > 0) {
                for (const numStr of numbers) {
                    const num = parseInt(numStr);
                    if (num >= 1 && num <= 50) {
                        const position = leadName.indexOf(numStr);
                        const substring = leadName.substring(Math.max(0, position - 10), 
                                                            Math.min(leadName.length, position + 15));
                        
                        if (substring.toLowerCase().includes('занят') || 
                            position > leadName.length - 5) {
                            console.log(`✅ Найдено число ${num} в сложном названии`);
                            return num;
                        }
                    }
                }
            }
            
            return 0;
            
        } catch (error) {
            console.error('❌ Ошибка расширенного парсинга:', error);
            return 0;
        }
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
    
    debugSubscriptionFields(customFields) {
        console.log('\n🔧 ДИАГНОСТИКА ПОЛЕЙ АБОНЕМЕНТА');
        console.log('='.repeat(50));
        
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
            
            expiration_date_display: formatDisplayDate(subscriptionInfo.expirationDate),
            activation_date_display: formatDisplayDate(subscriptionInfo.activationDate),
            last_visit_date_display: formatDisplayDate(studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate),
            
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
        const syncId = `sync_${new Date().toISOString().replace(/[^0-9]/g, '')}`;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔄 ЗАПУСК СИНХРОНИЗАЦИИ: ${syncId}`);
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

    async syncSinglePhone(phoneNumber) {
        console.log(`\n🔧 РУЧНАЯ СИНХРОНИЗАЦИЯ ТЕЛЕФОНА: ${phoneNumber}`);
        
        try {
            const profiles = await amoCrmService.getStudentsByPhone(phoneNumber);
            
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
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    const result = await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    
                    console.log(`✅ Профиль создан (ID: ${result.lastID}): ${profile.student_name}`);
                    savedCount++;
                } else {
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
            console.error(`❌ Ошибка создания сессии: ${dbError.message}`);
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
            is_demo: p.is_demo === 0 ? false : true,
            source: p.source,
            last_sync: p.last_sync
        }));
        
        const hasMultipleStudents = profiles.length > 1;
        
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
            
            if (profile) {
                console.log(`✅ Найден профиль в БД: ${profile.student_name}`);
            } else {
                console.log(`❌ Профиль ${profile_id} не найден в БД`);
                
                if (profile_id.startsWith('profile-')) {
                    const index = parseInt(profile_id.replace('profile-', ''));
                    console.log(`🔍 Это временный ID, индекс: ${index}`);
                    
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


app.get('/api/debug/subscription-analysis/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ПОЛНЫЙ АНАЛИЗ АБОНЕМЕНТА ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        // Получаем сделку
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.status(404).json({
                success: false,
                error: 'Сделка не найдена'
            });
        }
        
        const customFields = lead.custom_fields_values || [];
        const leadName = lead.name || '';
        
        // 1. Анализ всех полей сделки
        const fieldAnalysis = [];
        const subscriptionFields = [];
        const checkboxFields = [];
        
        customFields.forEach(field => {
            const fieldId = field.field_id || field.id;
            const fieldName = amoCrmService.getFieldName(field);
            const fieldValue = amoCrmService.getFieldValue(field);
            const fieldType = field.field_type || 'unknown';
            
            const fieldInfo = {
                id: fieldId,
                name: fieldName,
                value: fieldValue,
                type: fieldType,
                values: field.values || []
            };
            
            fieldAnalysis.push(fieldInfo);
            
            // Определяем тип поля
            if (fieldId >= 884899 && fieldId <= 884929) {
                fieldInfo.field_type = 'checkbox_visit';
                checkboxFields.push(fieldInfo);
            } else if ([850241, 891819, 850257, 890163, 891007].includes(fieldId)) {
                fieldInfo.field_type = 'subscription_field';
                subscriptionFields.push(fieldInfo);
            }
        });
        
        // 2. Анализ названия сделки
        const nameAnalysis = {
            original_name: leadName,
            cleaned_name: leadName.toLowerCase(),
            patterns_found: [],
            class_count_from_name: 0
        };
        
        // Поиск паттернов в названии
        const patterns = [
            { regex: /(\d+)\s*занятий?/i, description: 'число занятий' },
            { regex: /(\d+)\s*уроков?/i, description: 'число уроков' },
            { regex: /абонемент\s+на\s+(\d+)/i, description: 'абонемент на N' },
            { regex: /(\d+)\s*занятия/i, description: 'число занятия (множ)' },
            { regex: /(\d+)\s{0,3}-\s{0,3}занятий?/i, description: 'через дефис' },
            { regex: /^(\d+)\s*занятий?/i, description: 'в начале' },
            { regex: /занятий?\s*(\d+)$/i, description: 'в конце' },
            { regex: /разовый|пробное/i, description: 'разовое' }
        ];
        
        patterns.forEach(pattern => {
            const match = leadName.match(pattern.regex);
            if (match) {
                let count = pattern.description === 'разовое' ? 1 : parseInt(match[1] || 0);
                nameAnalysis.patterns_found.push({
                    pattern: pattern.description,
                    match: match[0],
                    count: count
                });
                
                if (count > 0 && count <= 50) {
                    nameAnalysis.class_count_from_name = count;
                }
            }
        });
        
        // 3. Анализ посещений по чекбоксам
        const visitedClasses = checkboxFields.filter(field => {
            const value = String(field.value).toLowerCase();
            return value === 'true' || value === '1' || value === 'да';
        }).length;
        
        // 4. Получение данных из полей абонемента
        const subscriptionData = {
            totalClasses: { value: 0, source: '', fieldId: null },
            usedClasses: { value: 0, source: '', fieldId: null },
            remainingClasses: { value: 0, source: '', fieldId: null },
            subscriptionType: { value: '', source: '', fieldId: null },
            expirationDate: { value: '', source: '', fieldId: null },
            activationDate: { value: '', source: '', fieldId: null },
            lastVisitDate: { value: '', source: '', fieldId: null }
        };
        
        // Маппинг полей
        const fieldMapping = {
            850241: { key: 'totalClasses', description: 'Абонемент занятий:' },
            891819: { key: 'totalClasses', description: 'Количество занятий (тех)' },
            850257: { key: 'usedClasses', description: 'Счетчик занятий:' },
            890163: { key: 'remainingClasses', description: 'Остаток занятий' },
            891007: { key: 'subscriptionType', description: 'Тип абонемента' },
            850255: { key: 'expirationDate', description: 'Окончание абонемента:' },
            851565: { key: 'activationDate', description: 'Дата активации абонемента:' },
            850259: { key: 'lastVisitDate', description: 'Дата последнего визита:' }
        };
        
        customFields.forEach(field => {
            const fieldId = field.field_id || field.id;
            if (fieldMapping[fieldId]) {
                const mapping = fieldMapping[fieldId];
                const value = amoCrmService.getFieldValue(field);
                
                subscriptionData[mapping.key] = {
                    value: value,
                    source: mapping.description,
                    fieldId: fieldId,
                    rawValue: field.values || []
                };
            }
        });
        
        // 5. Применение логики приоритетов
        const calculated = {
            // Всего занятий (приоритеты: 1. поле "Абонемент занятий", 2. поле "Количество занятий", 3. название)
            finalTotalClasses: 0,
            totalClassesSource: '',
            
            // Использованные занятия (приоритеты: 1. поле "Счетчик занятий", 2. чекбоксы, 3. расчет)
            finalUsedClasses: 0,
            usedClassesSource: '',
            
            // Остаток занятий (приоритеты: 1. поле "Остаток занятий", 2. расчет)
            finalRemainingClasses: 0,
            remainingClassesSource: ''
        };
        
        // Определение всего занятий
        if (subscriptionData.totalClasses.value && parseInt(subscriptionData.totalClasses.value) > 0) {
            calculated.finalTotalClasses = parseInt(subscriptionData.totalClasses.value);
            calculated.totalClassesSource = subscriptionData.totalClasses.source;
        } else if (nameAnalysis.class_count_from_name > 0) {
            calculated.finalTotalClasses = nameAnalysis.class_count_from_name;
            calculated.totalClassesSource = 'Название сделки';
        }
        
        // Определение использованных занятий
        if (subscriptionData.usedClasses.value && parseInt(subscriptionData.usedClasses.value) > 0) {
            calculated.finalUsedClasses = parseInt(subscriptionData.usedClasses.value);
            calculated.usedClassesSource = subscriptionData.usedClasses.source;
        } else if (visitedClasses > 0) {
            calculated.finalUsedClasses = visitedClasses;
            calculated.usedClassesSource = 'Чекбоксы посещений';
        }
        
        // Определение остатка
        if (subscriptionData.remainingClasses.value && parseInt(subscriptionData.remainingClasses.value) > 0) {
            calculated.finalRemainingClasses = parseInt(subscriptionData.remainingClasses.value);
            calculated.remainingClassesSource = subscriptionData.remainingClasses.source;
        } else if (calculated.finalTotalClasses > 0) {
            calculated.finalRemainingClasses = Math.max(0, calculated.finalTotalClasses - calculated.finalUsedClasses);
            calculated.remainingClassesSource = 'Расчет (Всего - Использовано)';
        }
        
        // 6. Вызов текущей логики для сравнения
        const currentLogicResult = amoCrmService.extractSubscriptionInfo(lead);
        
        // 7. Создание отчета
        const report = {
            lead_info: {
                id: lead.id,
                name: leadName,
                status_id: lead.status_id,
                pipeline_id: lead.pipeline_id,
                price: lead.price,
                created_at: lead.created_at,
                updated_at: lead.updated_at
            },
            
            name_analysis: nameAnalysis,
            
            fields_analysis: {
                total_fields: customFields.length,
                subscription_fields: subscriptionFields,
                checkbox_fields: {
                    total: checkboxFields.length,
                    checked: visitedClasses,
                    details: checkboxFields.map(f => ({
                        id: f.id,
                        name: f.name,
                        checked: String(f.value).toLowerCase() === 'true' || 
                                 String(f.value).toLowerCase() === '1' || 
                                 String(f.value).toLowerCase() === 'да'
                    }))
                },
                all_fields: fieldAnalysis
            },
            
            subscription_data: subscriptionData,
            
            calculations: {
                total_classes: {
                    value: calculated.finalTotalClasses,
                    source: calculated.totalClassesSource,
                    confidence: calculated.totalClassesSource ? 'high' : 'low'
                },
                used_classes: {
                    value: calculated.finalUsedClasses,
                    source: calculated.usedClassesSource,
                    confidence: calculated.usedClassesSource ? 'high' : 'low'
                },
                remaining_classes: {
                    value: calculated.finalRemainingClasses,
                    source: calculated.remainingClassesSource,
                    confidence: calculated.remainingClassesSource ? 'high' : 'low'
                }
            },
            
            current_logic_result: currentLogicResult,
            
            issues_and_recommendations: []
        };
        
        // 8. Поиск проблем
        if (calculated.finalTotalClasses === 0) {
            report.issues_and_recommendations.push({
                severity: 'high',
                issue: 'Не удалось определить общее количество занятий',
                recommendation: 'Проверьте поле 850241 или формат названия сделки'
            });
        }
        
        if (calculated.finalTotalClasses > 0 && calculated.finalRemainingClasses > calculated.finalTotalClasses) {
            report.issues_and_recommendations.push({
                severity: 'high',
                issue: `Остаток занятий (${calculated.finalRemainingClasses}) больше общего количества (${calculated.finalTotalClasses})`,
                recommendation: 'Проверьте поле 890163 (остаток)'
            });
        }
        
        if (visitedClasses > 0 && calculated.finalUsedClasses === 0) {
            report.issues_and_recommendations.push({
                severity: 'medium',
                issue: 'Есть отмеченные посещения, но счетчик занятий не заполнен',
                recommendation: 'Проверьте поле 850257 (счетчик)'
            });
        }
        
        res.json({
            success: true,
            data: report,
            summary: {
                total_classes: calculated.finalTotalClasses,
                used_classes: calculated.finalUsedClasses,
                remaining_classes: calculated.finalRemainingClasses,
                subscription_active: currentLogicResult.subscriptionActive,
                subscription_status: currentLogicResult.subscriptionStatus,
                issues_count: report.issues_and_recommendations.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа абонемента:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// ДОПОЛНИТЕЛЬНЫЙ МАРШРУТ ДЛЯ СТАТИСТИКИ ВСЕХ АБОНЕМЕНТОВ
app.get('/api/debug/subscription-patterns', async (req, res) => {
    try {
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const limit = parseInt(req.query.limit) || 50;
        
        const response = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&limit=${limit}&order[updated_at]=desc`
        );
        
        const allLeads = response._embedded?.leads || [];
        
        const patterns = {
            name_patterns: new Map(),
            field_usage: {
                total_classes_field: 0,
                used_classes_field: 0,
                remaining_classes_field: 0,
                checkbox_usage: 0
            },
            class_counts: {},
            subscription_types: new Map(),
            issues: []
        };
        
        allLeads.forEach(lead => {
            const leadName = lead.name || '';
            const customFields = lead.custom_fields_values || [];
            
            // Анализ названия
            if (leadName) {
                const nameLower = leadName.toLowerCase();
                
                // Поиск количества занятий в названии
                const classMatch = leadName.match(/(\d+)\s*занятий?/i);
                if (classMatch) {
                    const count = parseInt(classMatch[1]);
                    patterns.class_counts[count] = (patterns.class_counts[count] || 0) + 1;
                }
                
                // Паттерны названий
                const commonPatterns = [
                    { pattern: /-\s*\d+\s*занятий?/i, name: 'Дефис-N-занятий' },
                    { pattern: /\d+\s*-\s*занятий?/i, name: 'N-дефис-занятий' },
                    { pattern: /абонемент\s+на\s+\d+/i, name: 'Абонемент на N' },
                    { pattern: /\d+\s*занятий?\s*$/i, name: 'N занятий в конце' },
                    { pattern: /разовый/i, name: 'Разовый' },
                    { pattern: /пробное/i, name: 'Пробное' },
                    { pattern: /база\s*-\s*\d+/i, name: 'База-N' }
                ];
                
                commonPatterns.forEach(p => {
                    if (p.pattern.test(leadName)) {
                        patterns.name_patterns.set(p.name, (patterns.name_patterns.get(p.name) || 0) + 1);
                    }
                });
            }
            
            // Анализ полей
            customFields.forEach(field => {
                const fieldId = field.field_id || field.id;
                const value = amoCrmService.getFieldValue(field);
                
                if (fieldId === 850241 || fieldId === 891819) {
                    patterns.field_usage.total_classes_field++;
                    
                    if (value) {
                        const typeKey = value.split(' ')[0] || value;
                        patterns.subscription_types.set(
                            typeKey, 
                            (patterns.subscription_types.get(typeKey) || 0) + 1
                        );
                    }
                }
                
                if (fieldId === 850257) patterns.field_usage.used_classes_field++;
                if (fieldId === 890163) patterns.field_usage.remaining_classes_field++;
                
                // Чекбоксы
                if (fieldId >= 884899 && fieldId <= 884929) {
                    if (value === 'true' || value === '1' || value === 'да') {
                        patterns.field_usage.checkbox_usage++;
                    }
                }
            });
            
            // Проверка консистентности
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            if (subscriptionInfo.totalClasses > 0) {
                if (subscriptionInfo.totalClasses < subscriptionInfo.usedClasses) {
                    patterns.issues.push({
                        lead_id: lead.id,
                        lead_name: leadName,
                        issue: `Использовано занятий (${subscriptionInfo.usedClasses}) больше общего количества (${subscriptionInfo.totalClasses})`
                    });
                }
                
                if (subscriptionInfo.remainingClasses > subscriptionInfo.totalClasses) {
                    patterns.issues.push({
                        lead_id: lead.id,
                        lead_name: leadName,
                        issue: `Остаток (${subscriptionInfo.remainingClasses}) больше общего количества (${subscriptionInfo.totalClasses})`
                    });
                }
            }
        });
        
        // Статистика
        const stats = {
            total_leads_analyzed: allLeads.length,
            leads_with_subscription: allLeads.filter(lead => {
                const info = amoCrmService.extractSubscriptionInfo(lead);
                return info.hasSubscription;
            }).length,
            
            name_patterns: Array.from(patterns.name_patterns.entries()).map(([name, count]) => ({
                pattern: name,
                count: count,
                percentage: ((count / allLeads.length) * 100).toFixed(1) + '%'
            })),
            
            field_usage: {
                total_classes_field: {
                    count: patterns.field_usage.total_classes_field,
                    percentage: ((patterns.field_usage.total_classes_field / allLeads.length) * 100).toFixed(1) + '%'
                },
                used_classes_field: {
                    count: patterns.field_usage.used_classes_field,
                    percentage: ((patterns.field_usage.used_classes_field / allLeads.length) * 100).toFixed(1) + '%'
                },
                remaining_classes_field: {
                    count: patterns.field_usage.remaining_classes_field,
                    percentage: ((patterns.field_usage.remaining_classes_field / allLeads.length) * 100).toFixed(1) + '%'
                },
                checkbox_usage: {
                    count: patterns.field_usage.checkbox_usage,
                    per_lead_avg: (patterns.field_usage.checkbox_usage / allLeads.length).toFixed(1)
                }
            },
            
            class_distribution: Object.entries(patterns.class_counts)
                .map(([count, frequency]) => ({
                    classes: parseInt(count),
                    frequency: frequency,
                    percentage: ((frequency / allLeads.length) * 100).toFixed(1) + '%'
                }))
                .sort((a, b) => b.frequency - a.frequency),
            
            subscription_types: Array.from(patterns.subscription_types.entries())
                .map(([type, count]) => ({
                    type: type,
                    count: count,
                    percentage: ((count / allLeads.length) * 100).toFixed(1) + '%'
                }))
                .sort((a, b) => b.count - a.count),
            
            common_issues: {
                total: patterns.issues.length,
                issues: patterns.issues.slice(0, 10), // Показываем первые 10
                most_common: patterns.issues.length > 0 ? 
                    patterns.issues[0].issue.split(':')[0] : 'Нет проблем'
            },
            
            recommendations: []
        };
        
        // Рекомендации на основе анализа
        if (stats.field_usage.total_classes_field.percentage < '50%') {
            stats.recommendations.push('Поле "Абонемент занятий" заполнено менее чем в 50% сделок. Рассмотрите обязательное заполнение.');
        }
        
        if (stats.field_usage.remaining_classes_field.percentage < '30%') {
            stats.recommendations.push('Поле "Остаток занятий" редко заполняется. Это поле критично для отображения баланса.');
        }
        
        if (stats.common_issues.total > allLeads.length * 0.1) {
            stats.recommendations.push('Более 10% сделок имеют проблемы с консистентностью данных. Требуется проверка данных в CRM.');
        }
        
        res.json({
            success: true,
            data: stats,
            analysis_date: new Date().toISOString(),
            leads_analyzed: allLeads.length
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа паттернов:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

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
        console.log(`📱 Форматированный номер: ${formattedPhone}`);
        
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

// Добавьте остальные диагностические маршруты здесь...

// ==================== ОСНОВНЫЕ API МАРШРУТЫ ====================
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
