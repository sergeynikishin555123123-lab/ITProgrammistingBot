// server.js - ИСПРАВЛЕННАЯ ВЕРСИЯ С ПРАВИЛЬНОЙ ЛОГИКОЙ РАБОТЫ С AMOCRM

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

// ==================== КЛАСС AMOCRM ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        
        // ID воронки "!Абонемент"
        this.SUBSCRIPTION_PIPELINE_ID = 7977402;
        
        // Ключевые поля для парсинга
        this.FIELD_IDS = {
            LEAD: {
                TOTAL_CLASSES: 850241,    // "Абонемент занятий:"
                USED_CLASSES: 850257,     // "Счетчик занятий:"  
                REMAINING_CLASSES: 890163, // "Остаток занятий"
                EXPIRATION_DATE: 850255,  // "Окончание абонемента:"
                ACTIVATION_DATE: 851565,  // "Дата активации абонемента:"
                LAST_VISIT_DATE: 850259,  // "Дата последнего визита:"
                SUBSCRIPTION_TYPE: 891007, // "Тип абонемента"
                FREEZE: 867693,           // "Заморозка абонемента:"
                SUBSCRIPTION_OWNER: 805465, // "Принадлежность абонемента:"
                AGE_GROUP: 850243,        // "Группа возраст:"
                BRANCH: 871273,           // "Филиал:"
                TEACHER: 888881,          // "Преподаватель"
                DAY_OF_WEEK: 892225       // "День недели (2025-26)"
            },
            CONTACT: {
                CHILD_1_NAME: 867233,    // "!ФИО ребенка:"
                CHILD_2_NAME: 867235,    // "!!ФИО ребенка:"
                CHILD_3_NAME: 867733,    // "!!!ФИО ребенка:"
                PHONE: 216615,           // "Телефон"
                EMAIL: 216617,           // "Email"
                BRANCH: 871273           // "Филиал:"
            }
        };
    }

    async initialize() {
        try {
            console.log('🔄 Проверка подключения к amoCRM...');
            
            if (!this.accessToken) {
                console.log('❌ Токен не найден');
                return false;
            }
            
            // Проверяем валидность токена
            const isValid = await this.checkTokenValidity(this.accessToken);
            
            if (isValid) {
                this.isInitialized = true;
                console.log('✅ amoCRM успешно подключен');
                console.log(`📊 Аккаунт: ${this.accountInfo.name}`);
                return true;
            } else {
                console.log('❌ Токен невалиден');
                return false;
            }
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
            return true;
        } catch (error) {
            console.error('❌ Ошибка проверки токена:', error.message);
            return false;
        }
    }

    async makeRequest(method, endpoint, data = null) {
        try {
            const config = {
                method,
                url: `${this.baseUrl}${endpoint}`,
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
            console.error(`❌ Ошибка запроса ${method} ${endpoint}:`, error.message);
            throw error;
        }
    }

    // ==================== ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ ====================
    async searchContactsByPhone(phone) {
        const cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length < 10) {
            return { _embedded: { contacts: [] } };
        }
        
        try {
            const last10Digits = cleanPhone.slice(-10);
            const searchFormats = [
                `+7${last10Digits}`,
                `8${last10Digits}`,
                `7${last10Digits}`,
                last10Digits
            ];
            
            let allContacts = [];
            
            for (const format of searchFormats) {
                try {
                    const response = await this.makeRequest(
                        'GET', 
                        `/api/v4/contacts?query=${encodeURIComponent(format)}&with=custom_fields_values&limit=10`
                    );
                    
                    if (response._embedded?.contacts) {
                        response._embedded.contacts.forEach(contact => {
                            if (!allContacts.some(c => c.id === contact.id)) {
                                allContacts.push(contact);
                            }
                        });
                    }
                } catch (error) {
                    continue;
                }
            }
            
            return { _embedded: { contacts: allContacts } };
        } catch (error) {
            console.error('❌ Ошибка поиска контактов:', error.message);
            return { _embedded: { contacts: [] } };
        }
    }

    // ==================== ПОЛУЧЕНИЕ СДЕЛОК КОНТАКТА ====================
    async getContactLeads(contactId) {
        try {
            let allLeads = [];
            let page = 1;
            const limit = 100;
            
            while (true) {
                try {
                    const response = await this.makeRequest(
                        'GET',
                        `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}&page=${page}&limit=${limit}&order[updated_at]=desc`
                    );
                    
                    const leads = response._embedded?.leads || [];
                    if (leads.length === 0) break;
                    
                    allLeads = [...allLeads, ...leads];
                    
                    if (leads.length < limit) break;
                    page++;
                    
                    if (page > 5) break;
                    
                } catch (error) {
                    break;
                }
            }
            
            // Фильтруем только сделки из воронки абонементов
            const subscriptionLeads = allLeads.filter(lead => 
                lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID
            );
            
            return subscriptionLeads;
        } catch (error) {
            console.error('❌ Ошибка получения сделок:', error.message);
            return [];
        }
    }

    // ==================== ИЗВЛЕЧЕНИЕ ИНФОРМАЦИИ ОБ АБОНЕМЕНТЕ ====================
    extractSubscriptionInfo(lead) {
        try {
            const customFields = lead.custom_fields_values || [];
            
            // 1. Получаем значения полей
            const getFieldValue = (fieldId) => {
                const field = customFields.find(f => f.field_id === fieldId);
                if (!field || !field.values || field.values.length === 0) return '';
                
                const value = field.values[0];
                if (value.value !== undefined) return String(value.value).trim();
                if (value.enum_id !== undefined) return String(value.enum_id);
                return '';
            };
            
            // 2. Парсим числа из полей
            const parseNumber = (value) => {
                if (!value) return 0;
                const match = String(value).match(/\d+/);
                return match ? parseInt(match[0]) : 0;
            };
            
            // 3. Получаем данные полей
            const totalClassesStr = getFieldValue(this.FIELD_IDS.LEAD.TOTAL_CLASSES);
            const usedClassesStr = getFieldValue(this.FIELD_IDS.LEAD.USED_CLASSES);
            const remainingClassesStr = getFieldValue(this.FIELD_IDS.LEAD.REMAINING_CLASSES);
            const freezeStr = getFieldValue(this.FIELD_IDS.LEAD.FREEZE);
            const subscriptionType = getFieldValue(this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE);
            const activationDate = getFieldValue(this.FIELD_IDS.LEAD.ACTIVATION_DATE);
            const expirationDate = getFieldValue(this.FIELD_IDS.LEAD.EXPIRATION_DATE);
            const lastVisitDate = getFieldValue(this.FIELD_IDS.LEAD.LAST_VISIT_DATE);
            
            // 4. Преобразуем в числа
            const totalClasses = parseNumber(totalClassesStr);
            const usedClasses = parseNumber(usedClassesStr);
            const remainingFromField = parseNumber(remainingClassesStr);
            
            // 5. ВЫЧИСЛЯЕМ правильный остаток
            const calculatedRemaining = Math.max(0, totalClasses - usedClasses);
            const remainingClasses = calculatedRemaining; // Всегда используем вычисленный остаток
            
            // 6. Проверяем заморозку
            const isFrozen = freezeStr === 'ДА' || freezeStr === 'Да' || freezeStr === 'true' || freezeStr === '1';
            
            // 7. Определяем активность абонемента
            const hasSubscription = totalClasses > 0;
            const hasRemainingClasses = remainingClasses > 0;
            const isInSubscriptionPipeline = lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID;
            
            // Активный абонемент если:
            // - Есть абонемент
            // - Есть остаток занятий
            // - Сделка в воронке абонементов
            // - Не заморожен
            // - Не просрочен
            let subscriptionActive = false;
            let subscriptionStatus = 'Нет абонемента';
            let subscriptionBadge = 'secondary';
            
            if (!hasSubscription) {
                subscriptionStatus = 'Нет абонемента';
                subscriptionBadge = 'secondary';
            } else if (isFrozen) {
                subscriptionStatus = `Заморожен (осталось ${remainingClasses} занятий)`;
                subscriptionBadge = 'warning';
            } else if (!hasRemainingClasses) {
                subscriptionStatus = `Использован (${usedClasses}/${totalClasses} занятий)`;
                subscriptionBadge = 'secondary';
            } else if (isInSubscriptionPipeline && hasRemainingClasses) {
                // Проверяем дату окончания
                let isExpired = false;
                if (expirationDate) {
                    const today = new Date().toISOString().split('T')[0];
                    if (expirationDate < today) {
                        isExpired = true;
                    }
                }
                
                if (isExpired) {
                    subscriptionStatus = `Просрочен (истек ${expirationDate})`;
                    subscriptionBadge = 'danger';
                } else {
                    subscriptionStatus = `Активный (осталось ${remainingClasses} занятий)`;
                    subscriptionBadge = 'success';
                    subscriptionActive = true;
                }
            } else {
                subscriptionStatus = 'Не активен';
                subscriptionBadge = 'secondary';
            }
            
            // 8. Парсим даты
            const parseDate = (dateStr) => {
                if (!dateStr) return null;
                try {
                    if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
                        const parts = dateStr.split('.');
                        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                    }
                    return dateStr;
                } catch {
                    return dateStr;
                }
            };
            
            return {
                hasSubscription,
                totalClasses,
                usedClasses,
                remainingClasses,
                subscriptionType,
                subscriptionActive,
                subscriptionStatus,
                subscriptionBadge,
                isFrozen,
                isInSubscriptionPipeline,
                activationDate: parseDate(activationDate),
                expirationDate: parseDate(expirationDate),
                lastVisitDate: parseDate(lastVisitDate),
                leadId: lead.id,
                leadName: lead.name,
                pipelineId: lead.pipeline_id,
                statusId: lead.status_id,
                
                // Для отладки
                _debug: {
                    totalField: totalClassesStr,
                    usedField: usedClassesStr,
                    remainingField: remainingClassesStr,
                    freezeField: freezeStr,
                    calculatedRemaining,
                    originalRemaining: remainingFromField
                }
            };
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации об абонементе:', error);
            return this.getDefaultSubscriptionInfo();
        }
    }

    getDefaultSubscriptionInfo() {
        return {
            hasSubscription: false,
            totalClasses: 0,
            usedClasses: 0,
            remainingClasses: 0,
            subscriptionType: '',
            subscriptionActive: false,
            subscriptionStatus: 'Нет абонемента',
            subscriptionBadge: 'secondary',
            isFrozen: false,
            isInSubscriptionPipeline: false,
            activationDate: null,
            expirationDate: null,
            lastVisitDate: null,
            leadId: null,
            leadName: null,
            pipelineId: null,
            statusId: null
        };
    }

    // ==================== ИЗВЛЕЧЕНИЕ УЧЕНИКОВ ИЗ КОНТАКТА ====================
    extractStudentsFromContact(contact) {
        const students = [];
        
        try {
            const customFields = contact.custom_fields_values || [];
            const contactName = contact.name || '';
            
            // Массив полей с именами детей
            const childrenNameFields = [
                { id: this.FIELD_IDS.CONTACT.CHILD_1_NAME, number: 1 },
                { id: this.FIELD_IDS.CONTACT.CHILD_2_NAME, number: 2 },
                { id: this.FIELD_IDS.CONTACT.CHILD_3_NAME, number: 3 }
            ];
            
            // Получаем email
            const getEmail = () => {
                const emailField = customFields.find(f => f.field_id === this.FIELD_IDS.CONTACT.EMAIL);
                if (emailField && emailField.values && emailField.values.length > 0) {
                    return emailField.values[0].value || '';
                }
                return '';
            };
            
            // Получаем филиал
            const getBranch = () => {
                const branchField = customFields.find(f => f.field_id === this.FIELD_IDS.CONTACT.BRANCH);
                if (branchField && branchField.values && branchField.values.length > 0) {
                    return branchField.values[0].value || '';
                }
                return '';
            };
            
            // Получаем телефон
            const getPhone = () => {
                const phoneField = customFields.find(f => f.field_id === this.FIELD_IDS.CONTACT.PHONE);
                if (phoneField && phoneField.values && phoneField.values.length > 0) {
                    return phoneField.values[0].value || '';
                }
                return '';
            };
            
            const email = getEmail();
            const branch = getBranch();
            const phone = getPhone();
            
            // Для каждого поля с именем ребенка
            for (const field of childrenNameFields) {
                const nameField = customFields.find(f => f.field_id === field.id);
                
                if (nameField && nameField.values && nameField.values.length > 0) {
                    const studentName = nameField.values[0].value;
                    
                    if (studentName && studentName.trim()) {
                        students.push({
                            studentName: studentName.trim(),
                            parentName: contactName,
                            email: email,
                            branch: branch,
                            phone: phone,
                            contactId: contact.id
                        });
                    }
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка извлечения учеников:', error);
        }
        
        return students;
    }

    // ==================== ПОИСК ЛУЧШЕЙ СДЕЛКИ ДЛЯ УЧЕНИКА ====================
    async findBestLeadForStudent(contactId, studentName) {
        try {
            console.log(`\n🔍 Поиск сделки для: "${studentName}"`);
            
            // 1. Получаем все сделки контакта (только из воронки абонементов)
            const leads = await this.getContactLeads(contactId);
            
            if (leads.length === 0) {
                console.log('❌ Нет сделок в воронке абонементов');
                return null;
            }
            
            console.log(`📊 Найдено сделок в воронке: ${leads.length}`);
            
            // 2. Извлекаем информацию об абонементах
            const leadsWithSubscriptions = [];
            
            for (const lead of leads) {
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription) {
                    leadsWithSubscriptions.push({
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        // Проверяем совпадение имени
                        nameMatch: this.checkNameMatch(lead.name, studentName)
                    });
                }
            }
            
            if (leadsWithSubscriptions.length === 0) {
                console.log('❌ Нет сделок с абонементами');
                return null;
            }
            
            console.log(`📊 С абонементами: ${leadsWithSubscriptions.length}`);
            
            // 3. ВЫБИРАЕМ ЛУЧШУЮ СДЕЛКУ по приоритету
            const sortedLeads = leadsWithSubscriptions.sort((a, b) => {
                // 1. Приоритет: АКТИВНЫЙ абонемент
                if (a.subscriptionInfo.subscriptionActive !== b.subscriptionInfo.subscriptionActive) {
                    return b.subscriptionInfo.subscriptionActive - a.subscriptionInfo.subscriptionActive;
                }
                
                // 2. Приоритет: больше остаток занятий
                if (a.subscriptionInfo.remainingClasses !== b.subscriptionInfo.remainingClasses) {
                    return b.subscriptionInfo.remainingClasses - a.subscriptionInfo.remainingClasses;
                }
                
                // 3. Приоритет: точное совпадение имени
                if (a.nameMatch.exact !== b.nameMatch.exact) {
                    return b.nameMatch.exact - a.nameMatch.exact;
                }
                
                // 4. Приоритет: свежая сделка
                return b.lead.updated_at - a.lead.updated_at;
            });
            
            const bestLead = sortedLeads[0];
            
            console.log(`\n🏆 ВЫБРАНА СДЕЛКА:`);
            console.log(`   📋 "${bestLead.lead.name}"`);
            console.log(`   📊 Занятий: ${bestLead.subscriptionInfo.usedClasses}/${bestLead.subscriptionInfo.totalClasses}`);
            console.log(`   📈 Остаток: ${bestLead.subscriptionInfo.remainingClasses}`);
            console.log(`   🎯 Статус: ${bestLead.subscriptionInfo.subscriptionStatus}`);
            console.log(`   ✅ Активен: ${bestLead.subscriptionInfo.subscriptionActive ? 'Да' : 'Нет'}`);
            
            return bestLead;
            
        } catch (error) {
            console.error('❌ Ошибка поиска сделки:', error.message);
            return null;
        }
    }

    // ==================== ПОЛУЧЕНИЕ ДАННЫХ ДЛЯ ТЕЛЕФОНА ====================
    async getStudentsByPhone(phone) {
        console.log(`\n📱 ПОЛУЧЕНИЕ ДАННЫХ ПО ТЕЛЕФОНУ: ${phone}`);
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            // 1. Ищем контакты по телефону
            const contactsResponse = await this.searchContactsByPhone(phone);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            console.log(`📊 Найдено контактов: ${contacts.length}`);
            
            if (contacts.length === 0) {
                return studentProfiles;
            }
            
            // 2. Обрабатываем каждый контакт
            for (const contact of contacts) {
                try {
                    console.log(`\n📋 Обработка контакта: "${contact.name}"`);
                    
                    // Получаем полную информацию о контакте
                    const fullContact = await this.makeRequest(
                        'GET',
                        `/api/v4/contacts/${contact.id}?with=custom_fields_values`
                    );
                    
                    if (!fullContact) continue;
                    
                    // Извлекаем учеников
                    const students = this.extractStudentsFromContact(fullContact);
                    
                    console.log(`👥 Учеников в контакте: ${students.length}`);
                    
                    if (students.length === 0) continue;
                    
                    // 3. Для каждого ученика ищем лучшую сделку
                    for (const student of students) {
                        console.log(`\n👤 Обработка ученика: "${student.studentName}"`);
                        
                        const bestLeadResult = await this.findBestLeadForStudent(
                            contact.id, 
                            student.studentName
                        );
                        
                        if (bestLeadResult) {
                            // Создаем профиль с найденной сделкой
                            const profile = this.createStudentProfile(
                                fullContact,
                                student,
                                bestLeadResult.lead,
                                bestLeadResult.subscriptionInfo
                            );
                            
                            studentProfiles.push(profile);
                            console.log(`✅ Профиль создан`);
                        } else {
                            // Создаем профиль без абонемента
                            const profile = this.createStudentProfile(
                                fullContact,
                                student,
                                null,
                                this.getDefaultSubscriptionInfo()
                            );
                            
                            studentProfiles.push(profile);
                            console.log(`⚠️  Профиль создан без абонемента`);
                        }
                    }
                    
                } catch (contactError) {
                    console.error('❌ Ошибка обработки контакта:', contactError.message);
                }
            }
            
            console.log(`\n🎯 ИТОГО создано профилей: ${studentProfiles.length}`);
            
            return studentProfiles;
            
        } catch (error) {
            console.error('❌ Ошибка получения данных:', error.message);
            return studentProfiles;
        }
    }

    // ==================== СОЗДАНИЕ ПРОФИЛЯ УЧЕНИКА ====================
    createStudentProfile(contact, student, lead, subscriptionInfo) {
        // Форматируем дату для отображения
        const formatDisplayDate = (dateStr) => {
            if (!dateStr) return '';
            try {
                const date = new Date(dateStr);
                return date.toLocaleDateString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                });
            } catch {
                return dateStr;
            }
        };
        
        // Получаем дополнительные поля из сделки
        let branch = student.branch || '';
        let dayOfWeek = '';
        let teacherName = '';
        
        if (lead && lead.custom_fields_values) {
            const leadFields = lead.custom_fields_values;
            
            // Филиал
            const branchField = leadFields.find(f => f.field_id === this.FIELD_IDS.LEAD.BRANCH);
            if (branchField && branchField.values && branchField.values.length > 0) {
                branch = branchField.values[0].value || branch;
            }
            
            // День недели
            const dayField = leadFields.find(f => f.field_id === this.FIELD_IDS.LEAD.DAY_OF_WEEK);
            if (dayField && dayField.values && dayField.values.length > 0) {
                dayOfWeek = dayField.values[0].value || '';
            }
            
            // Преподаватель
            const teacherField = leadFields.find(f => f.field_id === this.FIELD_IDS.LEAD.TEACHER);
            if (teacherField && teacherField.values && teacherField.values.length > 0) {
                teacherName = teacherField.values[0].value || '';
            }
        }
        
        return {
            // Основная информация
            amocrm_contact_id: contact.id,
            parent_contact_id: contact.id,
            amocrm_lead_id: lead?.id || null,
            
            // Данные ученика
            student_name: student.studentName,
            phone_number: student.phone || '',
            email: student.email || '',
            birth_date: '',
            branch: branch,
            parent_name: student.parentName || contact.name || '',
            
            // Расписание
            day_of_week: dayOfWeek,
            time_slot: '',
            teacher_name: teacherName,
            age_group: '',
            course: '',
            allergies: '',
            
            // Абонемент
            subscription_type: subscriptionInfo.subscriptionType || 'Без абонемента',
            subscription_active: subscriptionInfo.subscriptionActive ? 1 : 0,
            subscription_status: subscriptionInfo.subscriptionStatus,
            subscription_badge: subscriptionInfo.subscriptionBadge,
            
            total_classes: subscriptionInfo.totalClasses,
            remaining_classes: subscriptionInfo.remainingClasses,
            used_classes: subscriptionInfo.usedClasses,
            
            // Даты
            expiration_date: subscriptionInfo.expirationDate,
            activation_date: subscriptionInfo.activationDate,
            last_visit_date: subscriptionInfo.lastVisitDate,
            
            expiration_date_display: formatDisplayDate(subscriptionInfo.expirationDate),
            activation_date_display: formatDisplayDate(subscriptionInfo.activationDate),
            last_visit_date_display: formatDisplayDate(subscriptionInfo.lastVisitDate),
            
            // Сырые данные для отладки
            custom_fields: JSON.stringify(contact.custom_fields_values || []),
            raw_contact_data: JSON.stringify(contact),
            lead_data: lead ? JSON.stringify(lead) : '{}',
            
            // Метаданные
            is_demo: 0,
            source: 'amocrm',
            is_active: 1,
            last_sync: new Date().toISOString()
        };
    }

    // ==================== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ====================
    checkNameMatch(leadName, studentName) {
        if (!leadName || !studentName) return { exact: false, partial: false };
        
        const cleanLeadName = leadName.toLowerCase().trim();
        const cleanStudentName = studentName.toLowerCase().trim();
        
        // Точное совпадение
        if (cleanLeadName.includes(cleanStudentName)) {
            return { exact: true, partial: true };
        }
        
        // Разбиваем имена на части
        const studentParts = cleanStudentName.split(/\s+/);
        
        // Ищем совпадение любой части
        for (const studentPart of studentParts) {
            if (studentPart.length < 3) continue;
            if (cleanLeadName.includes(studentPart)) {
                return { exact: false, partial: true };
            }
        }
        
        return { exact: false, partial: false };
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
// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
async function saveProfilesToDatabase(profiles) {
    try {
        let savedCount = 0;
        
        for (const profile of profiles) {
            try {
                // Проверяем, существует ли уже профиль
                const existingProfile = await db.get(
                    `SELECT id FROM student_profiles 
                     WHERE student_name = ? AND phone_number = ?`,
                    [profile.student_name, profile.phone_number]
                );
                
                if (!existingProfile) {
                    // Создаем новый профиль
                    await db.run(
                        `INSERT INTO student_profiles (
                            amocrm_contact_id, parent_contact_id, amocrm_lead_id,
                            student_name, phone_number, email, branch,
                            parent_name, subscription_type, subscription_active, subscription_status,
                            subscription_badge, total_classes, used_classes, remaining_classes,
                            expiration_date, activation_date, last_visit_date,
                            custom_fields, raw_contact_data, lead_data,
                            is_demo, source, is_active, last_sync
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            profile.amocrm_contact_id, profile.parent_contact_id, profile.amocrm_lead_id,
                            profile.student_name, profile.phone_number, profile.email, profile.branch,
                            profile.parent_name, profile.subscription_type, profile.subscription_active, profile.subscription_status,
                            profile.subscription_badge, profile.total_classes, profile.used_classes, profile.remaining_classes,
                            profile.expiration_date, profile.activation_date, profile.last_visit_date,
                            profile.custom_fields, profile.raw_contact_data, profile.lead_data,
                            profile.is_demo, profile.source, 1, new Date().toISOString()
                        ]
                    );
                    
                    savedCount++;
                } else {
                    // Обновляем существующий профиль
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
                }
            } catch (profileError) {
                console.error('❌ Ошибка сохранения профиля:', profileError.message);
            }
        }
        
        console.log(`💾 Сохранено профилей: ${savedCount}`);
        return savedCount;
    } catch (error) {
        console.error('❌ Общая ошибка сохранения:', error.message);
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
        }
    }
    
    return '+7' + cleanPhone.slice(-10);
}

// ==================== ОСНОВНЫЕ API МАРШРУТЫ ====================

// 1. АВТОРИЗАЦИЯ И ПОЛУЧЕНИЕ ДАННЫХ
app.post('/api/auth/phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        console.log(`\n📱 ЗАПРОС ДАННЫХ: ${phone}`);
        
        const formattedPhone = formatPhoneNumber(phone);
        
        // Проверяем подключение к amoCRM
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'Сервис временно недоступен. Повторите попытку позже.'
            });
        }
        
        // Получаем данные из amoCRM
        const crmProfiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        if (crmProfiles.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Ученики не найдены',
                message: 'По указанному телефону не найдено учеников.'
            });
        }
        
        // Сохраняем в базу данных
        await saveProfilesToDatabase(crmProfiles);
        
        // Создаем токен
        const token = jwt.sign(
            {
                phone: formattedPhone,
                profiles_count: crmProfiles.length,
                timestamp: Date.now()
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        // Форматируем ответ для приложения
        const responseProfiles = crmProfiles.map(p => ({
            id: p.amocrm_lead_id || Date.now(), // Временный ID если нет lead_id
            student_name: p.student_name,
            phone_number: p.phone_number,
            branch: p.branch || 'Филиал не указан',
            
            subscription: {
                type: p.subscription_type,
                active: p.subscription_active === 1,
                status: p.subscription_status,
                badge: p.subscription_badge,
                
                classes: {
                    total: p.total_classes,
                    used: p.used_classes,
                    remaining: p.remaining_classes,
                    progress: p.total_classes > 0 
                        ? Math.round((p.used_classes / p.total_classes) * 100) 
                        : 0
                },
                
                dates: {
                    activation: p.activation_date_display,
                    expiration: p.expiration_date_display,
                    last_visit: p.last_visit_date_display
                }
            },
            
            schedule: {
                day_of_week: p.day_of_week,
                time_slot: p.time_slot,
                teacher_name: p.teacher_name
            },
            
            parent: p.parent_name ? {
                name: p.parent_name
            } : null,
            
            metadata: {
                profile_id: p.amocrm_lead_id,
                last_sync: p.last_sync,
                source: p.source,
                is_real_data: true
            }
        }));
        
        console.log(`✅ Отправлено профилей: ${responseProfiles.length}`);
        
        res.json({
            success: true,
            message: 'Данные получены',
            data: {
                user: {
                    phone: formattedPhone,
                    first_name: crmProfiles[0]?.student_name?.split(' ')[0] || 'Ученик',
                    profiles_count: crmProfiles.length
                },
                profiles: responseProfiles,
                token: token,
                timestamp: new Date().toISOString(),
                amocrm_connected: amoCrmService.isInitialized
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка авторизации:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения данных',
            details: error.message
        });
    }
});

// 2. ПОЛУЧЕНИЕ ИНФОРМАЦИИ ОБ АБОНЕМЕНТЕ
app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id, phone } = req.body;
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Требуется авторизация'
            });
        }
        
        try {
            jwt.verify(token, JWT_SECRET);
        } catch (tokenError) {
            return res.status(401).json({
                success: false,
                error: 'Невалидный токен'
            });
        }
        
        let profile;
        
        // Ищем профиль в базе данных
        if (profile_id) {
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE amocrm_lead_id = ? OR id = ?`,
                [parseInt(profile_id), parseInt(profile_id)]
            );
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
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        // Форматируем ответ
        const progress = profile.total_classes > 0 
            ? Math.round((profile.used_classes / profile.total_classes) * 100) 
            : 0;
        
        res.json({
            success: true,
            data: {
                student: {
                    id: profile.id,
                    name: profile.student_name,
                    phone: profile.phone_number,
                    email: profile.email,
                    branch: profile.branch || 'Филиал не указан',
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
                        activation: profile.activation_date_display,
                        expiration: profile.expiration_date_display,
                        last_visit: profile.last_visit_date_display
                    }
                },
                
                parent: profile.parent_name ? {
                    name: profile.parent_name
                } : null,
                
                metadata: {
                    data_source: profile.source,
                    is_real_data: true,
                    last_sync: profile.last_sync,
                    lead_id: profile.amocrm_lead_id
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения абонемента:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации'
        });
    }
});

// 3. ОБНОВЛЕНИЕ ДАННЫХ (ПРИНУДИТЕЛЬНАЯ СИНХРОНИЗАЦИЯ)
app.post('/api/force-refresh/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`\n🔄 ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ: ${formattedPhone}`);
        
        // Удаляем старые данные
        await db.run(
            `DELETE FROM student_profiles WHERE phone_number LIKE ?`,
            [`%${formattedPhone.slice(-10)}%`]
        );
        
        // Получаем свежие данные
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        // Сохраняем
        await saveProfilesToDatabase(profiles);
        
        res.json({
            success: true,
            message: 'Данные обновлены',
            data: {
                phone: formattedPhone,
                profiles_found: profiles.length,
                last_sync: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. ПРОВЕРКА СДЕЛКИ (для отладки)
app.get('/api/test-deal/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.status(404).json({ success: false, error: 'Сделка не найдена' });
        }
        
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        res.json({
            success: true,
            data: {
                lead_info: {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    is_in_subscription_pipeline: lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID
                },
                subscription_info: subscriptionInfo
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. СТАТУС СЕРВЕРА
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        data_source: 'Реальные данные из amoCRM'
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('='.repeat(80));
        
        // Инициализация базы данных
        await initDatabase();
        console.log('✅ База данных готова');
        
        // Инициализация amoCRM
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM подключен');
        } else {
            console.log('❌ amoCRM не подключен');
            console.log('⚠️  Сервер запущен, но данные из CRM недоступны');
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(80));
            console.log('🚀 СЕРВЕР ЗАПУЩЕН УСПЕШНО!');
            console.log('='.repeat(80));
            console.log(`🌐 URL: http://localhost:${PORT}`);
            console.log(`📊 amoCRM: ${amoCrmService.isInitialized ? '✅ Подключен' : '❌ Не подключен'}`);
            console.log(`💾 База данных: SQLite`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`📋 Абонемент: POST http://localhost:${PORT}/api/subscription`);
            console.log(`🔄 Обновление: POST http://localhost:${PORT}/api/force-refresh/:phone`);
            console.log(`🧪 Тест сделки: GET http://localhost:${PORT}/api/test-deal/28674081`);
            console.log(`📊 Статус: GET http://localhost:${PORT}/api/status`);
            console.log('='.repeat(50));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

startServer();
