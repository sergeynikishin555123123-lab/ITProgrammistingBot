// server.js - исправленная версия с правильным разделением учеников и загрузкой абонементов
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
        this.isInitialized = false;
        this.fieldMappings = new Map();
        this.customFieldCache = new Map();
    }

    async initialize() {
        try {
            if (this.accessToken) {
                console.log('🔍 Проверка валидности токена...');
                const isValid = await this.checkTokenValidity(this.accessToken);
                if (isValid) {
                    await this.loadFieldMappings();
                }
                this.isInitialized = isValid;
                return isValid;
            }
            return false;
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            return false;
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
                `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=leads,customers,custom_fields_values`
            );
            
            console.log(`📊 Найдено контактов: ${response._embedded?.contacts?.length || 0}`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка поиска контактов: ${error.message}`);
            return { _embedded: { contacts: [] } };
        }
    }

    // НОВЫЙ МЕТОД: Поиск сделок по телефону - ИСПРАВЛЕННАЯ ВЕРСИЯ
    async searchLeadsByPhone(phoneNumber) {
        console.log(`\n🔍 ПОИСК СДЕЛОК ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        try {
            // Сначала ищем контакты
            const contactsResponse = await this.searchContactsByPhone(phoneNumber);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            const allLeads = [];
            
            // Для каждого контакта ищем сделки
            for (const contact of contacts) {
                console.log(`🔍 Поиск сделок для контакта ID: ${contact.id}`);
                
                try {
                    // Правильный endpoint для получения сделок контакта
                    const leadsResponse = await this.makeRequest(
                        'GET',
                        `/api/v4/contacts/${contact.id}/leads?with=custom_fields_values,contacts`
                    );
                    
                    if (leadsResponse && leadsResponse._embedded && leadsResponse._embedded.leads) {
                        const leads = leadsResponse._embedded.leads;
                        console.log(`📊 Найдено сделок для контакта ${contact.id}: ${leads.length}`);
                        
                        // Добавляем информацию о контакте к каждой сделке
                        leads.forEach(lead => {
                            lead.contact_info = {
                                id: contact.id,
                                name: contact.name,
                                phone: phoneNumber,
                                custom_fields_values: contact.custom_fields_values || []
                            };
                            allLeads.push(lead);
                        });
                    }
                } catch (leadError) {
                    console.error(`⚠️  Ошибка поиска сделок для контакта ${contact.id}:`, leadError.message);
                    // Продолжаем обработку других контактов
                }
            }
            
            console.log(`📊 Всего найдено сделок: ${allLeads.length}`);
            return allLeads;
            
        } catch (error) {
            console.error(`❌ Общая ошибка поиска сделок по телефону: ${error.message}`);
            return [];
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

    // Улучшенный парсинг количества занятий
    parseClassesCount(value) {
        if (!value) return 0;
        
        const str = String(value).toLowerCase().trim();
        
        console.log(`🔢 Парсим значение: "${str}"`);
        
        // Пытаемся найти число в строке
        const numberMatch = str.match(/(\d+)/);
        if (numberMatch) {
            const result = parseInt(numberMatch[1]);
            console.log(`   → Найдено число: ${result}`);
            return result;
        }
        
        // Пытаемся распознать текстовые значения
        const textToNumber = {
            'одно': 1, 'один': 1, '1': 1,
            'два': 2, 'две': 2, '2': 2,
            'три': 3, '3': 3,
            'четыре': 4, '4': 4,
            'пять': 5, '5': 5,
            'шесть': 6, '6': 6,
            'семь': 7, '7': 7,
            'восемь': 8, '8': 8,
            'девять': 9, '9': 9,
            'десять': 10, '10': 10,
            'одиннадцать': 11, '11': 11,
            'двенадцать': 12, '12': 12,
            'тринадцать': 13, '13': 13,
            'четырнадцать': 14, '14': 14,
            'пятнадцать': 15, '15': 15,
            'шестнадцать': 16, '16': 16,
            'семнадцать': 17, '17': 17,
            'восемнадцать': 18, '18': 18,
            'девятнадцать': 19, '19': 19,
            'двадцать': 20, '20': 20
        };
        
        for (const [text, num] of Object.entries(textToNumber)) {
            if (str.includes(text)) {
                console.log(`   → Распознано текстовое значение: ${num}`);
                return num;
            }
        }
        
        console.log(`   → Число не найдено, возвращаем 0`);
        return 0;
    }

    parseDate(value) {
        if (!value) return null;
        
        try {
            const dateStr = String(value).trim();
            console.log(`📅 Парсим дату: "${dateStr}"`);
            
            // Формат DD.MM.YYYY или DD.MM.YY
            if (dateStr.match(/^\d{1,2}\.\d{1,2}\.\d{2,4}$/)) {
                const parts = dateStr.split('.');
                let day = parts[0].padStart(2, '0');
                let month = parts[1].padStart(2, '0');
                let year = parts[2];
                
                if (year.length === 2) {
                    year = '20' + year;
                }
                
                const result = `${year}-${month}-${day}`;
                console.log(`   → Преобразовано в: ${result}`);
                return result;
            }
            
            // Формат YYYY-MM-DD
            if (dateStr.match(/^\d{4}-\d{1,2}-\d{1,2}$/)) {
                const parts = dateStr.split('-');
                const result = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                console.log(`   → Стандартизировано: ${result}`);
                return result;
            }
            
            console.log(`   → Формат не распознан, возвращаем как есть`);
            return dateStr;
            
        } catch (error) {
            console.error('❌ Ошибка парсинга даты:', error);
            return value;
        }
    }

    // ОСНОВНОЙ МЕТОД: Получение всех профилей учеников по телефону
    async getStudentsByPhone(phoneNumber) {
        console.log(`\n🎯 ПОЛУЧЕНИЕ ПРОФИЛЕЙ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
        
        const studentProfiles = [];
        
        if (!this.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return studentProfiles;
        }
        
        try {
            // 1. Ищем все сделки по телефону
            console.log(`\n🔍 ПОИСК СДЕЛОК ПО ТЕЛЕФОНУ...`);
            const leads = await this.searchLeadsByPhone(phoneNumber);
            
            console.log(`\n🔍 АНАЛИЗ СДЕЛОК...`);
            
            // Словарь для хранения уникальных учеников
            const uniqueStudents = new Map();
            
            // 2. Обрабатываем каждую сделку
            for (const lead of leads) {
                console.log(`\n📋 Обработка сделки: "${lead.name || 'Без названия'}" (ID: ${lead.id})`);
                
                // 3. Извлекаем информацию об ученике из сделки
                const leadStudentInfo = this.extractStudentInfoFromLead(lead);
                
                if (leadStudentInfo && leadStudentInfo.studentName && leadStudentInfo.studentName.trim() !== '') {
                    console.log(`👤 Найден ученик в сделке: ${leadStudentInfo.studentName}`);
                    
                    // 4. Извлекаем информацию о филиале и расписании из контакта
                    const contactStudentInfo = this.extractStudentInfoFromContact(lead.contact_info);
                    
                    // 5. Объединяем информацию
                    const mergedInfo = {
                        ...contactStudentInfo,
                        ...leadStudentInfo
                    };
                    
                    // 6. Извлекаем информацию об абонементе из сделки
                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                    
                    // 7. Создаем полный профиль ученика
                    const studentProfile = this.createStudentProfile(
                        lead.contact_info,
                        phoneNumber,
                        mergedInfo,
                        subscriptionInfo,
                        lead
                    );
                    
                    // 8. Добавляем в словарь (ключ - имя ученика + филиал)
                    const studentKey = `${studentProfile.student_name}|${studentProfile.branch}`;
                    if (!uniqueStudents.has(studentKey)) {
                        uniqueStudents.set(studentKey, studentProfile);
                        console.log(`✅ Добавлен ученик: ${studentProfile.student_name} (филиал: ${studentProfile.branch || 'не указан'})`);
                    } else {
                        console.log(`⚠️  Ученик уже добавлен: ${studentProfile.student_name}`);
                    }
                }
            }
            
            // 9. Если в сделках не нашли учеников, ищем в контактах
            if (uniqueStudents.size === 0) {
                console.log(`\n🔍 Ученики не найдены в сделках, ищем в контактах...`);
                
                const contactsResponse = await this.searchContactsByPhone(phoneNumber);
                const contacts = contactsResponse._embedded?.contacts || [];
                
                for (const contact of contacts) {
                    console.log(`🔍 Анализ контакта: ${contact.name || 'Без имени'} (ID: ${contact.id})`);
                    
                    // Получаем полную информацию о контакте
                    const fullContact = await this.getFullContactInfo(contact.id);
                    
                    if (fullContact) {
                        // Ищем информацию об учениках в контакте
                        const contactStudents = this.extractStudentsFromContact(fullContact);
                        
                        for (const studentInfo of contactStudents) {
                            if (studentInfo.studentName && studentInfo.studentName.trim() !== '') {
                                console.log(`👤 Найден ученик в контакте: ${studentInfo.studentName}`);
                                
                                // Ищем сделки для этого контакта
                                const contactLeads = await this.getContactLeads(contact.id);
                                let subscriptionInfo = { hasSubscription: false };
                                
                                // Берем последнюю сделку для информации об абонементе
                                if (contactLeads.length > 0) {
                                    // Сортируем по дате создания (новые сначала)
                                    contactLeads.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                                    subscriptionInfo = this.extractSubscriptionInfo(contactLeads[0]);
                                }
                                
                                // Создаем профиль
                                const studentProfile = this.createStudentProfile(
                                    fullContact,
                                    phoneNumber,
                                    studentInfo,
                                    subscriptionInfo,
                                    contactLeads[0] || null
                                );
                                
                                const studentKey = `${studentProfile.student_name}|${studentProfile.branch}`;
                                if (!uniqueStudents.has(studentKey)) {
                                    uniqueStudents.set(studentKey, studentProfile);
                                    console.log(`✅ Добавлен ученик из контакта: ${studentProfile.student_name}`);
                                }
                            }
                        }
                    }
                }
            }
            
            // 10. Преобразуем Map в массив
            studentProfiles.push(...uniqueStudents.values());
            
            console.log(`\n🎯 ИТОГО найдено уникальных учеников: ${studentProfiles.length}`);
            
        } catch (crmError) {
            console.error(`❌ Ошибка получения данных из amoCRM:`, crmError.message);
            return [];
        }
        
        return studentProfiles;
    }

    // Метод для извлечения информации об ученике из сделки
    extractStudentInfoFromLead(lead) {
        const studentInfo = {
            studentName: '',
            branch: '',
            teacherName: '',
            course: '',
            ageGroup: ''
        };
        
        try {
            // Имя ученика может быть в названии сделки
            const leadName = lead.name || '';
            
            // Ищем информацию в кастомных полях сделки
            const customFields = lead.custom_fields_values || [];
            
            // Сначала проверяем специальные поля для имени ученика
            let studentNameFound = false;
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                // Имя ученика
                if ((fieldName.includes('фио') && fieldName.includes('ребен')) || 
                    fieldName.includes('ученик') ||
                    fieldName.includes('ребенок')) {
                    studentInfo.studentName = fieldValue;
                    studentNameFound = true;
                    break;
                }
            }
            
            // Если не нашли в специальных полях, используем название сделки
            if (!studentNameFound && leadName.trim() !== '') {
                studentInfo.studentName = leadName;
            }
            
            // Ищем остальные поля
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                // Филиал
                if (fieldName.includes('филиал') && !studentInfo.branch) {
                    studentInfo.branch = fieldValue;
                }
                
                // Преподаватель
                if ((fieldName.includes('преподаватель') || fieldName.includes('педагог')) && !studentInfo.teacherName) {
                    studentInfo.teacherName = fieldValue;
                }
                
                // Курс/направление
                if ((fieldName.includes('курс') || fieldName.includes('направление')) && !studentInfo.course) {
                    studentInfo.course = fieldValue;
                }
                
                // Возрастная группа
                if (fieldName.includes('возраст') || fieldName.includes('группа')) {
                    studentInfo.ageGroup = fieldValue;
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации из сделки:', error);
        }
        
        return studentInfo;
    }

    // Метод для извлечения информации об ученике из контакта
    extractStudentInfoFromContact(contact) {
        const studentInfo = {
            studentName: '',
            birthDate: '',
            branch: '',
            dayOfWeek: '',
            timeSlot: '',
            teacherName: '',
            course: '',
            ageGroup: '',
            allergies: '',
            parentName: ''
        };
        
        try {
            // Имя контакта может быть именем родителя или ученика
            studentInfo.parentName = contact.name || '';
            
            // Ищем информацию в кастомных полях контакта
            const customFields = contact.custom_fields_values || [];
            
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                // Имя ученика
                if ((fieldName.includes('фио') && fieldName.includes('ребен')) || 
                    fieldName.includes('ученик') ||
                    fieldName.includes('ребенок')) {
                    studentInfo.studentName = fieldValue;
                }
                
                // День рождения
                if (fieldName.includes('день рождения') || fieldName.includes('дата рождения')) {
                    studentInfo.birthDate = this.parseDate(fieldValue);
                }
                
                // Филиал
                if (fieldName.includes('филиал') && !studentInfo.branch) {
                    studentInfo.branch = fieldValue;
                }
                
                // День недели
                if (fieldName.includes('день недели') && !studentInfo.dayOfWeek) {
                    studentInfo.dayOfWeek = fieldValue;
                }
                
                // Время занятия
                if ((fieldName.includes('время') && fieldName.includes('занятия')) && !studentInfo.timeSlot) {
                    studentInfo.timeSlot = fieldValue;
                }
                
                // Преподаватель
                if ((fieldName.includes('преподаватель') || fieldName.includes('педагог')) && !studentInfo.teacherName) {
                    studentInfo.teacherName = fieldValue;
                }
                
                // Курс/направление
                if ((fieldName.includes('курс') || fieldName.includes('направление')) && !studentInfo.course) {
                    studentInfo.course = fieldValue;
                }
                
                // Возрастная группа
                if ((fieldName.includes('возраст') || fieldName.includes('группа')) && !studentInfo.ageGroup) {
                    studentInfo.ageGroup = fieldValue;
                }
                
                // Аллергии
                if (fieldName.includes('аллергия') || fieldName.includes('особенности')) {
                    studentInfo.allergies = fieldValue;
                }
            }
            
            // Если имя ученика не найдено, используем имя контакта
            if (!studentInfo.studentName || studentInfo.studentName.trim() === '') {
                studentInfo.studentName = studentInfo.parentName || 'Ученик';
            }
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации из контакта:', error);
        }
        
        return studentInfo;
    }

    // Метод для извлечения учеников из контакта (для случая нескольких учеников в одном контакте)
    extractStudentsFromContact(contact) {
        const students = [];
        
        try {
            const customFields = contact.custom_fields_values || [];
            
            // Сначала создаем одного ученика с основной информацией
            const mainStudent = this.extractStudentInfoFromContact(contact);
            students.push(mainStudent);
            
            // Затем ищем дополнительные поля с номерами
            const studentMap = new Map();
            studentMap.set(1, mainStudent);
            
            // Группируем поля по номерам учеников
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                // Определяем номер ученика (если есть)
                let studentNumber = 1;
                const numberMatch = fieldName.match(/ребенок\s*(\d+)|фио\s*ребенка\s*(\d+)/i);
                if (numberMatch) {
                    studentNumber = parseInt(numberMatch[1] || numberMatch[2]) || 1;
                }
                
                if (!studentMap.has(studentNumber)) {
                    studentMap.set(studentNumber, {
                        studentName: '',
                        birthDate: '',
                        branch: '',
                        dayOfWeek: '',
                        timeSlot: '',
                        teacherName: '',
                        course: '',
                        ageGroup: '',
                        allergies: '',
                        parentName: contact.name || ''
                    });
                }
                
                const student = studentMap.get(studentNumber);
                
                // Заполняем поля ученика
                if (fieldName.includes('фио') && fieldName.includes('ребен')) {
                    student.studentName = fieldValue;
                } else if (fieldName.includes('день рождения') || fieldName.includes('дата рождения')) {
                    student.birthDate = this.parseDate(fieldValue);
                } else if (fieldName.includes('филиал')) {
                    student.branch = fieldValue;
                } else if (fieldName.includes('день недели')) {
                    student.dayOfWeek = fieldValue;
                } else if (fieldName.includes('время') && fieldName.includes('занятия')) {
                    student.timeSlot = fieldValue;
                } else if (fieldName.includes('преподаватель') || fieldName.includes('педагог')) {
                    student.teacherName = fieldValue;
                } else if (fieldName.includes('курс') || fieldName.includes('направление')) {
                    student.course = fieldValue;
                } else if (fieldName.includes('возраст') || fieldName.includes('группа')) {
                    student.ageGroup = fieldValue;
                } else if (fieldName.includes('аллергия') || fieldName.includes('особенности')) {
                    student.allergies = fieldValue;
                }
            }
            
            // Преобразуем Map в массив, начиная со второго ученика
            for (const [studentNumber, studentInfo] of studentMap) {
                if (studentNumber === 1) continue; // Первый уже добавлен
                
                // Если у ученика есть имя, добавляем его
                if (studentInfo.studentName && studentInfo.studentName.trim() !== '') {
                    students.push(studentInfo);
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка извлечения учеников из контакта:', error);
        }
        
        return students;
    }

    // Метод для получения сделок контакта
    async getContactLeads(contactId) {
        try {
            console.log(`🔍 Запрос сделок для контакта ID: ${contactId}`);
            const response = await this.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}`
            );
            
            return response._embedded?.leads || [];
        } catch (error) {
            console.error(`⚠️  Ошибка получения сделок контакта ${contactId}:`, error.message);
            return [];
        }
    }

    // Метод для получения полной информации о контакте
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
            subscriptionBadge: 'inactive'
        };
        
        if (!lead) {
            return subscriptionInfo;
        }
        
        try {
            const customFields = lead.custom_fields_values || [];
            const leadName = lead.name || '';
            
            console.log(`\n🔍 Анализ абонемента в сделке: "${leadName}"`);
            console.log(`📊 ID статуса: ${lead.status_id}, ID воронки: ${lead.pipeline_id}`);
            
            // ============ ВАЖНОЕ ИЗМЕНЕНИЕ ============
            // Проверяем название сделки и статус на наличие признаков абонемента
            
            const leadNameLower = leadName.toLowerCase();
            
            // Если в названии есть признаки абонемента
            if (leadNameLower.includes('абонемент') || 
                leadNameLower.includes('подписка') ||
                leadNameLower.includes('занятий') ||
                leadNameLower.includes('курс')) {
                subscriptionInfo.hasSubscription = true;
                
                // Пытаемся извлечь количество из названия
                const nameMatch = leadName.match(/(\d+)\s*занятий?/i);
                if (nameMatch) {
                    subscriptionInfo.totalClasses = parseInt(nameMatch[1]);
                    console.log(`📊 Найдено в названии: ${subscriptionInfo.totalClasses} занятий`);
                }
            }
            
            // Проверяем статус сделки
            // Статус 143 обычно "Успешно реализовано", 142 - "Закрыто и не реализовано"
            // Нужен активный статус (например, в воронке абонементов)
            const isClosedStatus = [142, 143].includes(lead.status_id);
            console.log(`📊 Статус закрытый: ${isClosedStatus}`);
            
            // ============ ПРОВЕРЯЕМ КАСТОМНЫЕ ПОЛЯ ============
            
            for (const field of customFields) {
                const fieldName = this.getFieldName(field).toLowerCase();
                const fieldValue = this.getFieldValue(field);
                
                if (!fieldValue || fieldValue.trim() === '') continue;
                
                console.log(`   📋 Поле: "${fieldName}" = "${fieldValue}"`);
                
                // Ищем все возможные варианты названий полей
                if (fieldName.includes('количество занятий') || 
                    fieldName.includes('занятий в абонементе') ||
                    fieldName.includes('всего занятий') ||
                    fieldName.includes('абонемент на') ||
                    (fieldName.includes('абонемент') && fieldName.includes('занятий'))) {
                    
                    subscriptionInfo.totalClasses = this.parseClassesCount(fieldValue);
                    subscriptionInfo.hasSubscription = true;
                    console.log(`   📊 Всего занятий: ${subscriptionInfo.totalClasses}`);
                }
                
                else if (fieldName.includes('использовано') ||
                         fieldName.includes('пройдено') ||
                         fieldName.includes('посещено') ||
                         fieldName.includes('счетчик')) {
                    
                    subscriptionInfo.usedClasses = this.parseClassesCount(fieldValue);
                    subscriptionInfo.hasSubscription = true;
                    console.log(`   📊 Использовано занятий: ${subscriptionInfo.usedClasses}`);
                }
                
                else if (fieldName.includes('остаток') ||
                         fieldName.includes('осталось') ||
                         fieldName.includes('баланс')) {
                    
                    subscriptionInfo.remainingClasses = this.parseClassesCount(fieldValue);
                    subscriptionInfo.hasSubscription = true;
                    console.log(`   📊 Остаток занятий: ${subscriptionInfo.remainingClasses}`);
                }
                
                else if (fieldName.includes('дата окончания') ||
                         fieldName.includes('окончание') ||
                         fieldName.includes('действует до')) {
                    
                    subscriptionInfo.expirationDate = this.parseDate(fieldValue);
                    subscriptionInfo.hasSubscription = true;
                    console.log(`   📅 Дата окончания: ${subscriptionInfo.expirationDate}`);
                }
            }
            
            // ============ КЛЮЧЕВОЕ ИЗМЕНЕНИЕ ============
            // Если сделка активна (не закрыта) И есть признаки абонемента
            if (!isClosedStatus && subscriptionInfo.hasSubscription) {
                console.log(`🎯 Сделка активна и содержит абонемент!`);
                
                // Если нет данных о занятиях, но есть абонемент
                if (subscriptionInfo.totalClasses === 0 && subscriptionInfo.hasSubscription) {
                    // Попробуем установить дефолтное значение
                    subscriptionInfo.totalClasses = 8; // или 12, или другое типичное значение
                    console.log(`ℹ️  Установлено дефолтное значение: ${subscriptionInfo.totalClasses} занятий`);
                }
            }
            
            // Рассчитываем недостающие значения
            if (subscriptionInfo.hasSubscription) {
                // Если есть общее количество и использовано, но нет остатка
                if (subscriptionInfo.totalClasses > 0 && subscriptionInfo.usedClasses > 0 && subscriptionInfo.remainingClasses === 0) {
                    subscriptionInfo.remainingClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.usedClasses);
                    console.log(`ℹ️  Рассчитан остаток: ${subscriptionInfo.remainingClasses}`);
                }
                
                // Если есть общее количество и остаток, но нет использованных
                else if (subscriptionInfo.totalClasses > 0 && subscriptionInfo.remainingClasses > 0 && subscriptionInfo.usedClasses === 0) {
                    subscriptionInfo.usedClasses = Math.max(0, subscriptionInfo.totalClasses - subscriptionInfo.remainingClasses);
                    console.log(`ℹ️  Рассчитано использованных: ${subscriptionInfo.usedClasses}`);
                }
                
                // Формируем статус
                if (isClosedStatus) {
                    subscriptionInfo.subscriptionStatus = 'Абонемент завершен';
                    subscriptionInfo.subscriptionBadge = 'expired';
                    subscriptionInfo.subscriptionActive = false;
                } else if (subscriptionInfo.remainingClasses > 0) {
                    subscriptionInfo.subscriptionStatus = `Активный (осталось ${subscriptionInfo.remainingClasses} занятий)`;
                    subscriptionInfo.subscriptionBadge = 'active';
                    subscriptionInfo.subscriptionActive = true;
                } else if (subscriptionInfo.totalClasses > 0) {
                    subscriptionInfo.subscriptionStatus = `Абонемент на ${subscriptionInfo.totalClasses} занятий`;
                    subscriptionInfo.subscriptionBadge = 'has_subscription';
                    subscriptionInfo.subscriptionActive = true;
                } else {
                    subscriptionInfo.subscriptionStatus = 'Активный абонемент';
                    subscriptionInfo.subscriptionBadge = 'active';
                    subscriptionInfo.subscriptionActive = true;
                }
            }
            
            console.log(`🎯 Итоговый статус: ${subscriptionInfo.subscriptionStatus}`);
            console.log(`🏷️  Бейдж: ${subscriptionInfo.subscriptionBadge}`);
            
        } catch (error) {
            console.error('❌ Ошибка извлечения информации об абонементе:', error);
        }
        
        return subscriptionInfo;
    }

    // Метод для поиска email в контакте
    findEmail(contact) {
        try {
            const customFields = contact.custom_fields_values || [];
            for (const field of customFields) {
                const fieldName = this.getFieldName(field);
                const fieldValue = this.getFieldValue(field);
                
                if ((fieldName.includes('email') || 
                     fieldName.includes('почта') || 
                     fieldName.includes('e-mail')) && 
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

    // Метод для создания профиля ученика
    createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
        // Определяем email
        const email = this.findEmail(contact);
        
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
            last_visit_date: subscriptionInfo.lastVisitDate || null,
            
            // Технические данные
            custom_fields: JSON.stringify(contact.custom_fields_values || []),
            raw_contact_data: JSON.stringify(contact),
            lead_data: lead ? JSON.stringify(lead) : '{}',
            is_demo: 0,
            source: 'amocrm',
            is_active: 1
        };
        
        console.log(`📊 Создан профиль ученика:`);
        console.log(`   👤 ${profile.student_name}`);
        console.log(`   📍 Филиал: ${profile.branch || 'не указан'}`);
        console.log(`   🎫 Абонемент: ${profile.subscription_status}`);
        console.log(`   📊 Занятия: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
        
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Таблица student_profiles создана');

        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_phone ON student_profiles(phone_number)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_name ON student_profiles(student_name)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_active ON student_profiles(is_active)');
        await db.run('CREATE INDEX IF NOT EXISTS idx_student_profiles_branch ON student_profiles(branch)');
        
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

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

async function saveProfilesToDatabase(profiles) {
    try {
        console.log(`💾 Сохранение профилей в БД...`);
        let savedCount = 0;
        
        for (const profile of profiles) {
            try {
                // Проверяем существование профиля
                const existingProfile = await db.get(
                    `SELECT id FROM student_profiles 
                     WHERE student_name = ? AND phone_number = ? AND (branch = ? OR (branch IS NULL AND ? IS NULL))`,
                    [profile.student_name, profile.phone_number, profile.branch || '', profile.branch || '']
                );
                
                const columns = [
                    'amocrm_contact_id', 'parent_contact_id', 'amocrm_lead_id', 'student_name', 'phone_number', 'email',
                    'birth_date', 'branch', 'day_of_week', 'time_slot', 'teacher_name', 'age_group', 'course', 'allergies',
                    'parent_name', 'subscription_type', 'subscription_active', 'subscription_status', 'subscription_badge',
                    'total_classes', 'used_classes', 'remaining_classes', 'expiration_date', 
                    'activation_date', 'last_visit_date', 'custom_fields', 
                    'raw_contact_data', 'lead_data', 'is_demo', 'source', 'is_active'
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
                    1
                ];
                
                if (!existingProfile) {
                    // Вставка нового профиля
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    savedCount++;
                    console.log(`✅ Профиль сохранен: ${profile.student_name} (${profile.branch || 'без филиала'})`);
                } else {
                    // Обновление существующего профиля
                    const setClause = columns.map(col => `${col} = ?`).join(', ');
                    
                    await db.run(
                        `UPDATE student_profiles SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [...values, existingProfile.id]
                    );
                    savedCount++;
                    console.log(`✅ Профиль обновлен: ${profile.student_name} (${profile.branch || 'без филиала'})`);
                }
            } catch (profileError) {
                console.error(`⚠️  Ошибка сохранения профиля ${profile.student_name}:`, profileError.message);
            }
        }
        
        console.log(`✅ Сохранено/обновлено профилей: ${savedCount}`);
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
        version: '2.8.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        data_source: amoCrmService.isInitialized ? 'Реальные данные из amoCRM' : 'Локальные данные'
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
        
        // Ищем профили в amoCRM
        if (amoCrmService.isInitialized) {
            console.log('🔍 Поиск в amoCRM...');
            profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
            console.log(`📊 Найдено профилей в amoCRM: ${profiles.length}`);
            
            if (profiles.length > 0) {
                const savedCount = await saveProfilesToDatabase(profiles);
                console.log(`💾 Сохранено в БД: ${savedCount} профилей`);
                
                // После сохранения, загружаем из БД для гарантии
                const cleanPhone = phone.replace(/\D/g, '');
                profiles = await db.all(
                    `SELECT * FROM student_profiles 
                     WHERE phone_number LIKE ? AND is_active = 1
                     ORDER BY 
                       CASE WHEN subscription_active = 1 THEN 1 ELSE 2 END,
                       CASE WHEN source = 'amocrm' THEN 1 ELSE 2 END,
                       updated_at DESC`,
                    [`%${cleanPhone.slice(-10)}%`]
                );
                console.log(`📊 Загружено из БД после сохранения: ${profiles.length}`);
            }
        }
        
        // Если в amoCRM не нашли или не удалось сохранить, ищем в локальной БД
        if (profiles.length === 0) {
            console.log('🔍 Поиск в локальной базе данных...');
            const cleanPhone = phone.replace(/\D/g, '');
            profiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY 
                   CASE WHEN subscription_active = 1 THEN 1 ELSE 2 END,
                   CASE WHEN source = 'amocrm' THEN 1 ELSE 2 END,
                   updated_at DESC`,
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
            is_demo: p.is_demo === 1,
            source: p.source
        }));
        
        // Проверяем, есть ли реальные данные из amoCRM
        const hasRealData = profiles.some(p => p.source === 'amocrm' && p.is_demo === 0);
        
        // Определяем, есть ли несколько учеников
        const hasMultipleStudents = profiles.length > 1;
        
        // Формируем ответ
        const responseData = {
            success: true,
            message: profiles.length > 0 
                ? hasRealData ? 'Найдены реальные профили учеников' : 'Найдены демо-профили учеников'
                : 'Профили не найдены',
            data: {
                user: tempUser,
                profiles: responseProfiles,
                total_profiles: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                has_real_data: hasRealData,
                has_multiple_students: hasMultipleStudents,
                token: token
            }
        };
        
        console.log(`✅ Авторизация завершена успешно`);
        console.log(`📊 Реальные данные из amoCRM: ${hasRealData ? '✅ Да' : '❌ Нет'}`);
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
        
        let profile;
        if (profile_id) {
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE id = ?`,
                [profile_id]
            );
            console.log(`🔍 Поиск по ID профиля: ${profile_id}`);
        } else if (phone) {
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
        console.log(`📊 Тип данных: ${profile.is_demo === 1 ? 'Демо' : 'Реальные'}`);
        
        // Рассчитываем прогресс использования абонемента
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
                } : null,
                
                metadata: {
                    data_source: profile.source,
                    is_real_data: profile.is_demo === 0,
                    is_demo: profile.is_demo === 1,
                    last_updated: profile.updated_at,
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

// Маршрут для диагностики сделки по ID
app.get('/api/debug/lead/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        
        console.log(`\n🔍 ДИАГНОСТИКА СДЕЛКИ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем сделку напрямую
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values,contacts`
        );
        
        console.log('\n📊 НАЗВАНИЕ СДЕЛКИ:', lead.name);
        console.log(`📊 ID сделки: ${lead.id}`);
        console.log(`📊 ID воронки: ${lead.pipeline_id}`);
        console.log(`📊 ID статуса: ${lead.status_id}`);
        
        console.log('\n📋 ВСЕ ПОЛЯ СДЕЛКИ:');
        console.log('='.repeat(80));
        
        if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
            lead.custom_fields_values.forEach((field, index) => {
                const fieldId = field.field_id || field.id || 'unknown';
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                console.log(`[${index + 1}] ID: ${fieldId} | "${fieldName}": "${fieldValue}"`);
                
                // Показываем сырые данные поля
                console.log(`    RAW:`, JSON.stringify(field));
            });
        } else {
            console.log('❌ Нет кастомных полей в сделке');
        }
        
        console.log('='.repeat(80));
        
        // Тестируем парсинг абонемента
        console.log('\n🎫 ТЕСТ ПАРСИНГА АБОНЕМЕНТА:');
        console.log('-'.repeat(80));
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        console.log('-'.repeat(80));
        console.log('Результат парсинга:', subscriptionInfo);
        
        // Показываем сырые данные
        console.log('\n📄 СЫРЫЕ ДАННЫЕ СДЕЛКИ (первые 1000 символов):');
        const rawData = JSON.stringify(lead, null, 2);
        console.log(rawData.substring(0, 1000) + (rawData.length > 1000 ? '...' : ''));
        
        res.json({
            success: true,
            data: {
                lead_id: lead.id,
                lead_name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                fields_count: lead.custom_fields_values ? lead.custom_fields_values.length : 0,
                fields: lead.custom_fields_values ? lead.custom_fields_values.map((f, i) => ({
                    index: i,
                    field_id: f.field_id || f.id,
                    field_name: amoCrmService.getFieldName(f),
                    field_value: amoCrmService.getFieldValue(f),
                    raw_values: f.values || []
                })) : [],
                subscription_parsed: subscriptionInfo
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error.message);
        if (error.response) {
            console.error('📊 Ответ сервера:', error.response.status, error.response.data);
        }
        
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response ? {
                status: error.response.status,
                data: error.response.data
            } : null
        });
    }
});

// Быстрая проверка нескольких сделок
app.get('/api/debug/check-leads', async (req, res) => {
    try {
        console.log(`\n🔍 ПРОВЕРКА СДЕЛОК НА НАЛИЧИЕ АБОНЕМЕНТОВ`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Возьмем несколько ID сделок для проверки
        const leadIds = [
            18153229, // "Круглова" - интересное название
            20104751, // "Рассылка май 24" - другая воронка (5951374)
            20263225  // "Новый лид от Tilda"
        ];
        
        const results = [];
        
        for (const leadId of leadIds) {
            console.log(`\n📋 Проверка сделки ID: ${leadId}`);
            
            try {
                const lead = await amoCrmService.makeRequest(
                    'GET',
                    `/api/v4/leads/${leadId}?with=custom_fields_values`
                );
                
                console.log(`   Название: "${lead.name}"`);
                console.log(`   Воронка: ${lead.pipeline_id}, Статус: ${lead.status_id}`);
                
                const leadInfo = {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    has_fields: lead.custom_fields_values ? lead.custom_fields_values.length > 0 : false,
                    fields: []
                };
                
                // Проверяем поля на наличие информации об абонементе
                if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                    console.log(`   Поля (${lead.custom_fields_values.length}):`);
                    
                    lead.custom_fields_values.forEach(field => {
                        const fieldName = amoCrmService.getFieldName(field).toLowerCase();
                        const fieldValue = amoCrmService.getFieldValue(field);
                        
                        // Показываем только интересные поля
                        if (fieldName.includes('абонемент') || 
                            fieldName.includes('занят') || 
                            fieldName.includes('счетчик') ||
                            fieldName.includes('остаток') ||
                            fieldName.includes('ученик') ||
                            fieldName.includes('ребенок')) {
                            console.log(`      • "${fieldName}": ${fieldValue}`);
                            
                            leadInfo.fields.push({
                                name: fieldName,
                                value: fieldValue
                            });
                        }
                    });
                }
                
                // Проверяем парсинг абонемента
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                leadInfo.subscription = subscriptionInfo;
                console.log(`   Парсинг абонемента: ${subscriptionInfo.hasSubscription ? '✅ Найден' : '❌ Не найден'}`);
                if (subscriptionInfo.hasSubscription) {
                    console.log(`      Занятий: ${subscriptionInfo.totalClasses}/${subscriptionInfo.usedClasses}/${subscriptionInfo.remainingClasses}`);
                }
                
                results.push(leadInfo);
                
            } catch (leadError) {
                console.log(`   ❌ Ошибка: ${leadError.message}`);
                results.push({
                    id: leadId,
                    error: leadError.message
                });
            }
        }
        
        res.json({
            success: true,
            leads_checked: results.length,
            results: results
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки сделок:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Поиск активных сделок контакта
app.get('/api/debug/contact/:id/active-leads', async (req, res) => {
    try {
        const contactId = req.params.id;
        
        console.log(`\n🔍 ПОИСК АКТИВНЫХ СДЕЛОК КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем все сделки контакта
        const leadsResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contactId}`
        );
        
        const allLeads = leadsResponse._embedded?.leads || [];
        console.log(`📊 Всего сделок: ${allLeads.length}`);
        
        // Ищем активные сделки (не 142 и не 143)
        const activeLeads = allLeads.filter(lead => 
            lead.status_id !== 142 && lead.status_id !== 143
        );
        
        console.log(`🎯 Активных сделок: ${activeLeads.length}`);
        
        // Проверяем каждую активную сделку
        const results = [];
        
        for (const lead of activeLeads.slice(0, 10)) { // Проверяем первые 10
            console.log(`\n📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
            console.log(`   Статус: ${lead.status_id}, Воронка: ${lead.pipeline_id}`);
            
            const leadInfo = {
                id: lead.id,
                name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                fields_count: lead.custom_fields_values ? lead.custom_fields_values.length : 0,
                fields: []
            };
            
            // Проверяем все поля
            if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                console.log(`   Поля (${lead.custom_fields_values.length}):`);
                
                lead.custom_fields_values.forEach(field => {
                    const fieldId = field.field_id || field.id || 'unknown';
                    const fieldName = amoCrmService.getFieldName(field);
                    const fieldValue = amoCrmService.getFieldValue(field);
                    
                    console.log(`      • ID ${fieldId}: "${fieldName}" = "${fieldValue}"`);
                    
                    // Сохраняем все поля для анализа
                    leadInfo.fields.push({
                        id: fieldId,
                        name: fieldName,
                        value: fieldValue
                    });
                });
            }
            
            results.push(leadInfo);
        }
        
        // Если активных сделок нет, покажем несколько последних закрытых
        if (activeLeads.length === 0) {
            console.log(`\n⚠️  Активных сделок нет. Показываем последние 5 закрытых сделок:`);
            
            const recentLeads = allLeads
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 5);
            
            for (const lead of recentLeads) {
                console.log(`\n📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
                console.log(`   Создана: ${lead.created_at}, Статус: ${lead.status_id}`);
                
                if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                    console.log(`   Поля (${lead.custom_fields_values.length}):`);
                    
                    lead.custom_fields_values.forEach(field => {
                        const fieldName = amoCrmService.getFieldName(field).toLowerCase();
                        const fieldValue = amoCrmService.getFieldValue(field);
                        
                        if (fieldName.includes('абонемент') || 
                            fieldName.includes('занят') || 
                            fieldName.includes('ученик')) {
                            console.log(`      • "${fieldName}": ${fieldValue}`);
                        }
                    });
                }
            }
        }
        
        res.json({
            success: true,
            contact_id: contactId,
            total_leads: allLeads.length,
            active_leads: activeLeads.length,
            results: results
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска активных сделок:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Поиск сделок с ключевыми словами в полях
app.get('/api/debug/search/subscription-fields', async (req, res) => {
    try {
        console.log(`\n🔍 ПОИСК СДЕЛОК С ПОЛЯМИ ОБ АБОНЕМЕНТАХ`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем все кастомные поля сделок
        const fieldsResponse = await amoCrmService.makeRequest('GET', '/api/v4/leads/custom_fields');
        
        const subscriptionFields = [];
        
        if (fieldsResponse._embedded && fieldsResponse._embedded.custom_fields) {
            fieldsResponse._embedded.custom_fields.forEach(field => {
                const fieldName = field.name.toLowerCase();
                
                // Ищем поля, связанные с абонементами и занятиями
                if (fieldName.includes('абонемент') || 
                    fieldName.includes('занят') || 
                    fieldName.includes('счетчик') ||
                    fieldName.includes('остаток') ||
                    fieldName.includes('посещен') ||
                    fieldName.includes('активац') ||
                    fieldName.includes('окончан')) {
                    
                    subscriptionFields.push({
                        id: field.id,
                        name: field.name,
                        type: field.type,
                        enums: field.enums || []
                    });
                    
                    console.log(`📋 Найдено поле: "${field.name}" (ID: ${field.id})`);
                }
            });
        }
        
        console.log(`\n🎯 Всего найдено полей об абонементах: ${subscriptionFields.length}`);
        
        // Если нашли поля, ищем сделки с этими полями
        const leadsWithSubscription = [];
        
        if (subscriptionFields.length > 0) {
            // Берем первое поле для теста
            const testFieldId = subscriptionFields[0].id;
            console.log(`\n🔍 Ищем сделки с полем ID: ${testFieldId}`);
            
            // Ищем сделки с этим полем (фильтр по значению поля не работает в amoCRM API v4)
            // Поэтому ищем все сделки и фильтруем локально
            const leadsResponse = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&limit=50`
            );
            
            const leads = leadsResponse._embedded?.leads || [];
            console.log(`📊 Проверяем ${leads.length} сделок...`);
            
            for (const lead of leads) {
                if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                    // Проверяем, есть ли поле с абонементом
                    const hasSubscriptionField = lead.custom_fields_values.some(field => {
                        const fieldId = field.field_id || field.id;
                        return subscriptionFields.some(subField => subField.id == fieldId);
                    });
                    
                    if (hasSubscriptionField) {
                        console.log(`\n✅ Найдена сделка с абонементом: "${lead.name}" (ID: ${lead.id})`);
                        
                        const leadInfo = {
                            id: lead.id,
                            name: lead.name,
                            pipeline_id: lead.pipeline_id,
                            status_id: lead.status_id,
                            fields: []
                        };
                        
                        // Показываем все поля абонемента
                        lead.custom_fields_values.forEach(field => {
                            const fieldId = field.field_id || field.id;
                            const fieldObj = subscriptionFields.find(f => f.id == fieldId);
                            
                            if (fieldObj) {
                                const fieldValue = amoCrmService.getFieldValue(field);
                                console.log(`   • "${fieldObj.name}": ${fieldValue}`);
                                
                                leadInfo.fields.push({
                                    id: fieldId,
                                    name: fieldObj.name,
                                    value: fieldValue
                                });
                            }
                        });
                        
                        leadsWithSubscription.push(leadInfo);
                        
                        if (leadsWithSubscription.length >= 5) {
                            break; // Ограничиваем 5 сделками
                        }
                    }
                }
            }
        }
        
        res.json({
            success: true,
            subscription_fields_found: subscriptionFields.length,
            subscription_fields: subscriptionFields,
            leads_with_subscription: leadsWithSubscription.length,
            leads: leadsWithSubscription
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска полей абонементов:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Маршрут для диагностики контакта по ID
app.get('/api/debug/contact/:id', async (req, res) => {
    try {
        const contactId = req.params.id;
        
        console.log(`\n🔍 ДИАГНОСТИКА КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем контакт
        const contact = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/contacts/${contactId}?with=custom_fields_values`
        );
        
        console.log('\n📊 ИМЯ КОНТАКТА:', contact.name);
        console.log(`📊 ID контакта: ${contact.id}`);
        
        console.log('\n📋 ВСЕ ПОЛЯ КОНТАКТА:');
        console.log('='.repeat(80));
        
        if (contact.custom_fields_values && contact.custom_fields_values.length > 0) {
            contact.custom_fields_values.forEach((field, index) => {
                const fieldId = field.field_id || field.id || 'unknown';
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                console.log(`[${index + 1}] ID: ${fieldId} | "${fieldName}": "${fieldValue}"`);
            });
        } else {
            console.log('❌ Нет кастомных полей в контакте');
        }
        
        console.log('='.repeat(80));
        
        // Получаем сделки этого контакта
        console.log('\n🔍 ПОИСК СДЕЛОК ЭТОГО КОНТАКТА...');
        try {
            const leadsResponse = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/contacts/${contactId}/leads?with=custom_fields_values`
            );
            
            const leads = leadsResponse._embedded?.leads || [];
            console.log(`📊 Найдено сделок: ${leads.length}`);
            
            leads.forEach(lead => {
                console.log(`\n📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
                console.log(`   Статус ID: ${lead.status_id}, Воронка ID: ${lead.pipeline_id}`);
                
                if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                    console.log(`   Кастомные поля (${lead.custom_fields_values.length}):`);
                    lead.custom_fields_values.forEach(field => {
                        const fieldName = amoCrmService.getFieldName(field).toLowerCase();
                        const fieldValue = amoCrmService.getFieldValue(field);
                        console.log(`      • "${fieldName}": ${fieldValue}`);
                    });
                } else {
                    console.log(`   ❌ Нет кастомных полей в сделке`);
                }
            });
            
            // Показываем сырые данные первой сделки
            if (leads.length > 0) {
                console.log('\n📄 СЫРЫЕ ДАННЫЕ ПЕРВОЙ СДЕЛКИ (первые 1000 символов):');
                const rawData = JSON.stringify(leads[0], null, 2);
                console.log(rawData.substring(0, 1000) + (rawData.length > 1000 ? '...' : ''));
            }
            
        } catch (leadError) {
            console.error(`❌ Ошибка получения сделок: ${leadError.message}`);
        }
        
        res.json({
            success: true,
            data: {
                contact_id: contact.id,
                contact_name: contact.name,
                fields_count: contact.custom_fields_values ? contact.custom_fields_values.length : 0,
                fields: contact.custom_fields_values ? contact.custom_fields_values.map((f, i) => ({
                    index: i,
                    field_id: f.field_id || f.id,
                    field_name: amoCrmService.getFieldName(f),
                    field_value: amoCrmService.getFieldValue(f)
                })) : [],
                leads_found: leads ? leads.length : 0
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики контакта:', error.message);
        if (error.response) {
            console.error('📊 Ответ сервера:', error.response.status, error.response.data);
        }
        
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response ? {
                status: error.response.status,
                data: error.response.data
            } : null
        });
    }
});

// Маршрут для поиска полей по ключевым словам
app.get('/api/debug/fields/search/:keyword', async (req, res) => {
    try {
        const keyword = req.params.keyword.toLowerCase();
        console.log(`\n🔍 ПОИСК ПОЛЕЙ ПО КЛЮЧЕВОМУ СЛОВУ: "${keyword}"`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем все кастомные поля контактов
        const fields = await amoCrmService.makeRequest('GET', '/api/v4/contacts/custom_fields');
        
        const foundFields = [];
        
        if (fields && fields._embedded && fields._embedded.custom_fields) {
            fields._embedded.custom_fields.forEach(field => {
                const fieldName = field.name.toLowerCase();
                if (fieldName.includes(keyword)) {
                    foundFields.push({
                        id: field.id,
                        name: field.name,
                        type: field.type,
                        enums: field.enums || []
                    });
                }
            });
        }
        
        console.log(`📊 Найдено полей: ${foundFields.length}`);
        
        if (foundFields.length === 0) {
            // Показываем все поля для отладки
            console.log('📋 ВСЕ ПОЛЯ ДЛЯ ОТЛАДКИ:');
            if (fields && fields._embedded && fields._embedded.custom_fields) {
                fields._embedded.custom_fields.slice(0, 20).forEach(field => {
                    console.log(`   ${field.id}: "${field.name}" (${field.type})`);
                });
            }
        }
        
        res.json({
            success: true,
            keyword: keyword,
            found_count: foundFields.length,
            fields: foundFields
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска полей:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Маршрут для тестирования телефона
app.get('/api/debug/phone/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        console.log(`\n📱 ТЕСТИРОВАНИЕ ПО ТЕЛЕФОНУ: ${phone}`);
        console.log('='.repeat(80));
        
        if (!amoCrmService.isInitialized) {
            console.log('❌ amoCRM не инициализирован');
            return res.json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Форматируем телефон
        const formattedPhone = phone.replace(/\D/g, '');
        let searchPhone;
        if (formattedPhone.length === 11 && formattedPhone.startsWith('7')) {
            searchPhone = `+${formattedPhone}`;
        } else if (formattedPhone.length === 10) {
            searchPhone = `+7${formattedPhone}`;
        } else {
            searchPhone = `+${formattedPhone}`;
        }
        
        console.log(`📱 Форматированный номер для поиска: ${searchPhone}`);
        
        // 1. Ищем контакты
        console.log('\n🔍 ПОИСК КОНТАКТОВ...');
        const contactsResponse = await amoCrmService.makeRequest(
            'GET', 
            `/api/v4/contacts?query=${encodeURIComponent(searchPhone)}&with=custom_fields_values`
        );
        
        const contacts = contactsResponse._embedded?.contacts || [];
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        // 2. Для каждого контакта получаем сделки
        let allLeads = [];
        for (const contact of contacts) {
            console.log(`\n👤 Контакт: ${contact.name} (ID: ${contact.id})`);
            
            try {
                const leadsResponse = await amoCrmService.makeRequest(
                    'GET',
                    `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contact.id}`
                );
                
                const leads = leadsResponse._embedded?.leads || [];
                console.log(`📊 Сделок у контакта: ${leads.length}`);
                
                leads.forEach(lead => {
                    allLeads.push({
                        contact_id: contact.id,
                        contact_name: contact.name,
                        lead_id: lead.id,
                        lead_name: lead.name,
                        lead_status_id: lead.status_id,
                        lead_pipeline_id: lead.pipeline_id
                    });
                    
                    // Быстрый анализ абонемента
                    console.log(`   📋 Сделка: "${lead.name}" (ID: ${lead.id})`);
                    if (lead.custom_fields_values && lead.custom_fields_values.length > 0) {
                        lead.custom_fields_values.forEach(field => {
                            const fieldName = amoCrmService.getFieldName(field).toLowerCase();
                            if (fieldName.includes('абонемент') || 
                                fieldName.includes('занят') || 
                                fieldName.includes('счетчик') ||
                                fieldName.includes('остаток')) {
                                const value = amoCrmService.getFieldValue(field);
                                console.log(`      → "${fieldName}": ${value}`);
                            }
                        });
                    }
                });
                
            } catch (leadError) {
                console.error(`   ❌ Ошибка получения сделок: ${leadError.message}`);
            }
        }
        
        // 3. Получаем профили через основной метод
        console.log('\n🎯 ЗАПУСК ОСНОВНОГО МЕТОДА ПОИСКА...');
        const profiles = await amoCrmService.getStudentsByPhone(phone);
        console.log(`📊 Профилей найдено: ${profiles.length}`);
        
        res.json({
            success: true,
            phone: phone,
            formatted_phone: searchPhone,
            contacts_found: contacts.length,
            leads_found: allLeads.length,
            profiles_found: profiles.length,
            contacts: contacts.map(c => ({
                id: c.id,
                name: c.name,
                fields_count: c.custom_fields_values ? c.custom_fields_values.length : 0
            })),
            leads: allLeads,
            profiles: profiles.map(p => ({
                student_name: p.student_name,
                branch: p.branch,
                subscription_status: p.subscription_status,
                total_classes: p.total_classes,
                used_classes: p.used_classes,
                remaining_classes: p.remaining_classes
            }))
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестирования телефона:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            phone: req.params.phone
        });
    }
});

// Маршрут для проверки воронок
app.get('/api/debug/pipelines', async (req, res) => {
    try {
        console.log(`\n🔍 ПОЛУЧЕНИЕ СПИСКА ВОРОНОК`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        // Получаем все воронки
        const pipelines = await amoCrmService.makeRequest('GET', '/api/v4/leads/pipelines');
        
        console.log('\n📋 ВСЕ ВОРОНКИ:');
        console.log('='.repeat(80));
        
        if (pipelines && pipelines._embedded && pipelines._embedded.pipelines) {
            pipelines._embedded.pipelines.forEach(pipeline => {
                console.log(`🏷️  ${pipeline.id}: "${pipeline.name}"`);
                
                // Получаем статусы для этой воронки
                amoCrmService.makeRequest('GET', `/api/v4/leads/pipelines/${pipeline.id}/statuses`)
                    .then(statuses => {
                        if (statuses && statuses._embedded && statuses._embedded.statuses) {
                            console.log(`   Статусы (${statuses._embedded.statuses.length}):`);
                            statuses._embedded.statuses.forEach(status => {
                                console.log(`     • ${status.id}: "${status.name}"`);
                            });
                        }
                    })
                    .catch(err => {
                        console.log(`   ❌ Ошибка получения статусов: ${err.message}`);
                    });
            });
        }
        
        res.json({
            success: true,
            pipelines_count: pipelines._embedded?.pipelines?.length || 0,
            pipelines: pipelines._embedded?.pipelines?.map(p => ({
                id: p.id,
                name: p.name,
                is_main: p.is_main
            })) || []
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения воронок:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

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
                    usage_percentage: progress
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

// Получение всех профилей для пользователя
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
            is_demo: p.is_demo === 1,
            source: p.source
        }));
        
        res.json({
            success: true,
            data: {
                profiles: formattedProfiles,
                total: profiles.length,
                has_multiple: profiles.length > 1
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

// ==================== ДОПОЛНИТЕЛЬНЫЕ API ====================

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        amocrm_status: amoCrmService.isInitialized ? 'connected' : 'disconnected'
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
                last_check: new Date().toISOString()
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

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v2.8');
        console.log('='.repeat(80));
        console.log('✨ ИСПРАВЛЕНЫ ОШИБКИ СОХРАНЕНИЯ И ПОИСКА СДЕЛОК');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
        } else {
            console.log('⚠️  amoCRM не инициализирован');
            console.log('ℹ️  Используются локальные/тестовые данные');
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
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`🔍 Профили пользователя: GET http://localhost:${PORT}/api/profiles`);
            console.log(`📋 Абонемент: POST http://localhost:${PORT}/api/subscription`);
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
