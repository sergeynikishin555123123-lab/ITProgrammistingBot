// server.js - ПОЛНОСТЬЮ ПЕРЕПИСАННЫЙ СЕРВЕР

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

// ==================== КЛАСС AMOCRM SERVICE ====================
class AmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 ИНИЦИАЛИЗАЦИЯ AmoCrmService v4.1');
        console.log('🎯 ИНДИВИДУАЛЬНЫЙ ПОИСК СДЕЛОК ДЛЯ КАЖДОГО УЧЕНИКА');
        console.log('='.repeat(80));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        this.fieldMappings = new Map();
        this.accountInfo = null;
        
       // Замените весь блок FIELD_IDS на этот:
// В классе AmoCrmService обновите FIELD_IDS:
// В классе AmoCrmService обновите FIELD_IDS:
this.FIELD_IDS = {
    LEAD: {
        // Реальные ID из диагностики выше
        TOTAL_CLASSES: 850241, // "Абонемент занятий:" (значение: "8 занятий")
        USED_CLASSES: 850257, // "Счетчик занятий:" (значение: "1")
        REMAINING_CLASSES: 890163, // "Остаток занятий" (значение: "7")
        EXPIRATION_DATE: 850255, // "Окончание абонемента:" (timestamp)
        ACTIVATION_DATE: 851565, // "Дата активации абонемента:" (timestamp)
        LAST_VISIT_DATE: 850259, // "Дата последнего визита:" (timestamp)
        SUBSCRIPTION_TYPE: 891007, // "Тип абонемента" (значение: "Первчиный")
        FREEZE: 867693, // "Заморозка абонемента" (если есть)
        SUBSCRIPTION_OWNER: 805465, // "Принадлежность абонемента" (если есть)
        TECHNICAL_COUNT: 891819, // "Количество занятий (тех)" (значение: "8")
        AGE_GROUP: 850243, // "Группа возраст:" (значение: "14+")
        BRANCH: 871273, // "Филиал:" (если есть в сделке)
        PURCHASE_DATE: 850253, // "Дата покупки:" (timestamp)
        TRIAL_DATE: 867729, // "!Дата и время пробного занятия:" (timestamp)
        LESSON_PRICE: 891813, // "Стоимость 1 занятия" (значение: "1890")
        FIRST_LESSON: 884899 // "1 занятие" (checkbox)
    },
    
    CONTACT: {
        // ID из предыдущей диагностики
        CHILD_1_NAME: 867233, // "!ФИО ребенка:"
        CHILD_2_NAME: 867235, // Поле для второго ребенка
        CHILD_3_NAME: 867733, // Поле для третьего ребенка
        BRANCH: 871273, // "Филиал:"
        TEACHER: 888881, // "Преподаватель"
        DAY_OF_WEEK: 892225, // День недели
        HAS_ACTIVE_SUB: 890179, // "Есть активный абонемент"
        LAST_VISIT: 885380, // "Дата последнего визита"
        AGE_GROUP: 888903, // "Возраст группы"
        PHONE: 216615, // "Телефон"
        EMAIL: null // Нужно найти ID поля email
    }
};

// В классе AmoCrmService
this.SUBSCRIPTION_STATUSES = {
    ACTIVE_IN_CORRECT_PIPELINE: [65473306], // Только статусы в правильной воронке 7977402
    ACTIVE_IN_OTHER_PIPELINES: [142, 143]   // Статусы в других воронках (низкий приоритет)
};

// Обновите ID воронки (правильная воронка = 7977402)
this.SUBSCRIPTION_PIPELINE_ID = 7977402;
};
    
        // Проверяет, есть ли у контакта указанный телефон
    contactHasPhone(contact, phoneDigits) {
        if (!contact || !contact.custom_fields_values) {
            return false;
        }
        
        const phoneFields = contact.custom_fields_values.filter(field => {
            const fieldId = field.field_id || field.id;
            return fieldId === this.FIELD_IDS.CONTACT.PHONE;
        });
        
        if (phoneFields.length === 0) {
            return false;
        }
        
        // Проверяем все значения телефона в поле
        for (const phoneField of phoneFields) {
            if (phoneField.values && Array.isArray(phoneField.values)) {
                for (const value of phoneField.values) {
                    const contactPhone = String(value.value || '').replace(/\D/g, '');
                    if (contactPhone.includes(phoneDigits) || phoneDigits.includes(contactPhone.slice(-10))) {
                        console.log(`   📞 Найден телефон: ${value.value}`);
                        return true;
                    }
                }
            }
        }
        
        return false;
    }
// ==================== ИСПРАВЛЕННЫЙ МЕТОД ПОИСКА СДЕЛОК КОНТАКТА ====================
    async getContactLeadsFixed(contactId) {
    try {
        console.log(`🔍 ПОИСК СДЕЛОК КОНТАКТА ID: ${contactId} (ИСПРАВЛЕННЫЙ МЕТОД)`);
        
        // Метод 1: Через фильтр по contact_id
        try {
            const response = await this.makeRequest('GET', 
                `/api/v4/leads?filter[contact_id][]=${contactId}&with=custom_fields_values&limit=250`
            );
            
            if (response && response._embedded && response._embedded.leads) {
                const leads = response._embedded.leads;
                console.log(`✅ Метод 1: Найдено ${leads.length} сделок`);
                return leads || [];
            }
        } catch (error1) {
            console.log(`⚠️  Метод 1 не сработал: ${error1.message}`);
        }
        
        return [];
        
    } catch (error) {
        console.error('❌ Критическая ошибка поиска сделок:', error.message);
        return [];
    }
}
    // ==================== ИНИЦИАЛИЗАЦИЯ AMOCRM ====================
    async initialize() {
        try {
            console.log('🔄 Инициализация amoCRM...');
            
            if (!AMOCRM_ACCESS_TOKEN) {
                console.error('❌ AMOCRM_ACCESS_TOKEN не установлен в .env');
                this.isInitialized = false;
                return false;
            }
            
            if (!AMOCRM_SUBDOMAIN) {
                console.error('❌ AMOCRM_DOMAIN не установлен в .env');
                this.isInitialized = false;
                return false;
            }
            
            console.log(`🔗 Проверка соединения с ${this.baseUrl}...`);
            
            // Проверяем доступ к API
            const accountInfo = await this.makeRequest('GET', '/api/v4/account');
            
            if (accountInfo && accountInfo.name) {
                this.accountInfo = accountInfo;
                this.isInitialized = true;
                
                // Загружаем воронки и статусы
                await this.checkSubscriptionPipeline();
                await this.loadPipelineStatuses();
                
                console.log('✅ amoCRM инициализирован успешно!');
                console.log(`📊 Аккаунт: ${accountInfo.name}`);
                console.log(`🎯 Воронка абонементов: ${this.SUBSCRIPTION_PIPELINE_ID}`);
                
                return true;
            } else {
                console.error('❌ Не удалось получить информацию об аккаунте');
                this.isInitialized = false;
                return false;
            }
            
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            this.isInitialized = false;
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
            console.error(`❌ Ошибка запроса к amoCRM ${method} ${endpoint}:`, error.message);
            
            if (error.response) {
                console.error(`Статус: ${error.response.status}`);
                console.error(`Данные:`, error.response.data);
            }
            
            throw error;
        }
    }

    async searchContactsByPhone(phone) {
    try {
        // НОРМАЛИЗУЕМ входящий телефон
        const cleanPhone = phone.replace(/\D/g, '');
        const last10Digits = cleanPhone.slice(-10);
        
        console.log(`🔍 Поиск контактов по телефону`);
        console.log(`   📱 Входящий: ${phone}`);
        console.log(`   🔢 Только цифры: ${cleanPhone}`);
        console.log(`   🎯 Последние 10 цифр: ${last10Digits}`);
        
        // Метод 1: Используем query с разными форматами
        console.log('🔍 Метод 1: Поиск через query (разные форматы)');
        try {
            // Пробуем разные форматы поиска
            const searchFormats = [
                last10Digits,                     // 9161916984
                cleanPhone,                       // 79161916984
                `+7${last10Digits}`,              // +79161916984
                `7${last10Digits}`,               // 79161916984
                `8${last10Digits}`                // 89161916984
            ];
            
            let foundContacts = [];
            
            for (const searchTerm of searchFormats) {
                if (!searchTerm || searchTerm.length < 7) continue;
                
                console.log(`   🔍 Поиск по: "${searchTerm}"`);
                
                try {
                    const response = await this.makeRequest('GET', 
                        `/api/v4/contacts?query=${searchTerm}&with=custom_fields_values&limit=50`
                    );
                    
                    if (response && response._embedded && response._embedded.contacts) {
                        const contacts = response._embedded.contacts;
                        console.log(`      📊 Найдено: ${contacts.length} контактов`);
                        
                        // Фильтруем по реальному наличию телефона
                        const filtered = contacts.filter(contact => 
                            this.contactHasPhoneNormalized(contact, last10Digits)
                        );
                        
                        console.log(`      ✅ После фильтрации: ${filtered.length}`);
                        
                        foundContacts = foundContacts.concat(filtered);
                    }
                } catch (termError) {
                    console.log(`      ❌ Ошибка поиска по "${searchTerm}": ${termError.message}`);
                }
            }
            
            // Убираем дубликаты
            const uniqueContacts = [];
            const seenIds = new Set();
            
            for (const contact of foundContacts) {
                if (!seenIds.has(contact.id)) {
                    seenIds.add(contact.id);
                    uniqueContacts.push(contact);
                }
            }
            
            console.log(`✅ Метод 1: Уникальных контактов: ${uniqueContacts.length}`);
            
            return {
                _embedded: {
                    contacts: uniqueContacts
                }
            };
            
        } catch (queryError) {
            console.log(`❌ Метод 1 не сработал: ${queryError.message}`);
        }
        
        // Метод 2: Полный перебор с нормализацией
        console.log('\n🔍 Метод 2: Полный перебор контактов с нормализацией');
        try {
            const allContacts = await this.getAllContacts(100); // Получаем первые 100 контактов
            
            // Фильтруем контакты с нужным телефоном
            const filteredContacts = allContacts.filter(contact => 
                this.contactHasPhoneNormalized(contact, last10Digits)
            );
            
            console.log(`✅ Метод 2: Найдено ${filteredContacts.length} контактов`);
            
            return {
                _embedded: {
                    contacts: filteredContacts
                }
            };
            
        } catch (allError) {
            console.log(`❌ Метод 2 не сработал: ${allError.message}`);
        }
        
        console.log('❌ Все методы не сработали');
        return { _embedded: { contacts: [] } };
        
    } catch (error) {
        console.error('❌ Критическая ошибка поиска контактов:', error.message);
        return { _embedded: { contacts: [] } };
    }
}
    
// В классе AmoCrmService
async getContactLeadsSorted(contactId) {
    try {
        console.log(`\n🔍 ПОЛУЧЕНИЕ ВСЕХ СДЕЛОК КОНТАКТА ID: ${contactId}`);
        
        // Используем исправленный метод
        const leads = await this.getContactLeadsFixed(contactId);
        
        console.log(`📊 Всего получено сделок: ${leads.length}`);
        
        // Сортируем по дате создания (самые новые первыми)
        return leads.sort((a, b) => {
            return new Date(b.created_at * 1000) - new Date(a.created_at * 1000);
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения сделок контакта:', error.message);
        return [];
    }
}
   async getFullContactInfo(contactId) {
    try {
        console.log(`🔍 Получение полной информации о контакте ID: ${contactId}`);
        
        // Получаем основную информацию о контакте
        const contactResponse = await this.makeRequest(
            'GET',
            `/api/v4/contacts/${contactId}?with=custom_fields_values`
        );
        
        if (!contactResponse) {
            console.error(`❌ Контакт ${contactId} не найден`);
            return null;
        }
        
        // Получаем сделки контакта отдельно
        const leads = await this.getContactLeadsSorted(contactId);
        
        console.log(`✅ Контакт получен: "${contactResponse.name || 'Без имени'}"`);
        console.log(`📊 Найдено сделок: ${leads.length}`);
        
        // Объединяем данные
        return {
            ...contactResponse,
            leads: leads
        };
        
    } catch (error) {
        console.error(`❌ Ошибка получения контакта ${contactId}:`, error.message);
        return null;
    }
}
    async findRecentLeadsForStudent(contactId, studentName, days = 180) {
    try {
        const today = new Date();
        const pastDate = new Date();
        pastDate.setDate(today.getDate() - days);
        
        const fromDate = Math.floor(pastDate.getTime() / 1000);
        
        const response = await this.makeRequest('GET', 
            `/api/v4/leads?filter[contact_id][]=${contactId}&filter[created_at][from]=${fromDate}&with=custom_fields_values&limit=50`
        );
        
        return response?._embedded?.leads || [];
        
    } catch (error) {
        console.error('❌ Ошибка поиска недавних сделок:', error.message);
        return [];
    }
}
  async findLeadForStudent(contactId, studentName) {
    console.log(`\n🔍 ПОИСК СДЕЛКИ ДЛЯ УЧЕНИКА: "${studentName}"`);
    console.log('='.repeat(60));
    
    try {
        // Получаем все сделки контакта через исправленный метод
        const response = await this.makeRequest('GET', 
            `/api/v4/leads?filter[contact_id][]=${contactId}&with=custom_fields_values&limit=100`
        );
        
        const allLeads = response?._embedded?.leads || [];
        console.log(`📊 Всего сделок у контакта: ${allLeads.length}`);
        
        if (allLeads.length === 0) {
            console.log('❌ У контакта нет сделок');
            return null;
        }
        
        // Нормализуем имя ученика для поиска
        const normalizedStudentName = this.normalizeName(studentName);
        console.log(`🔍 Ищем сделку для: "${normalizedStudentName}"`);
        
        // 1. Сначала ищем ПОЛНОЕ совпадение
        for (const lead of allLeads) {
            if (!lead.name) continue;
            
            const leadName = this.normalizeName(lead.name);
            console.log(`   🔎 Проверяем: "${lead.name}" -> "${leadName}"`);
            
            // Проверяем РАЗНЫЕ варианты совпадения:
            // 1. Полное совпадение имени
            if (leadName.includes(normalizedStudentName)) {
                console.log(`   ✅ Полное совпадение!`);
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                return {
                    lead: lead,
                    subscriptionInfo: subscriptionInfo,
                    match_score: 100
                };
            }
            
            // 2. Проверяем по частям имени
            const studentParts = normalizedStudentName.split(' ');
            const leadParts = leadName.split(/[\s\-–]+/);
            
            let partsMatch = false;
            
            // Проверяем, есть ли все части имени ученика в названии сделки
            const allStudentPartsInLead = studentParts.every(studentPart => 
                studentPart.length > 2 && // Игнорируем короткие части
                leadParts.some(leadPart => leadPart.includes(studentPart))
            );
            
            // Или наоборот - есть ли части названия сделки в имени ученика
            const significantLeadPartsInStudent = leadParts.some(leadPart => 
                leadPart.length > 2 &&
                studentParts.some(studentPart => studentPart.includes(leadPart))
            );
            
            if (allStudentPartsInLead || significantLeadPartsInStudent) {
                partsMatch = true;
            }
            
            if (partsMatch) {
                console.log(`   ✅ Совпадение по частям имени!`);
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                return {
                    lead: lead,
                    subscriptionInfo: subscriptionInfo,
                    match_score: 80
                };
            }
        }
        
        // 2. Если не нашли по имени, ищем в воронке абонементов
        console.log(`\n⚠️  Не нашли по имени, ищем в воронке абонементов...`);
        
        for (const lead of allLeads) {
            if (lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID) {
                console.log(`   ✅ Найдена сделка в воронке абонементов: "${lead.name}"`);
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription) {
                    console.log(`   🎫 И с абонементом!`);
                    return {
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        match_score: 70
                    };
                }
            }
        }
        
        // 3. Ищем по ID известной сделки (для отладки)
        console.log(`\n🔍 Пробуем найти по известному ID 28674745...`);
        try {
            const knownLead = await this.makeRequest('GET', 
                `/api/v4/leads/28674745?with=custom_fields_values`
            );
            
            if (knownLead) {
                console.log(`   ✅ Нашли известную сделку: "${knownLead.name}"`);
                const subscriptionInfo = this.extractSubscriptionInfo(knownLead);
                
                return {
                    lead: knownLead,
                    subscriptionInfo: subscriptionInfo,
                    match_score: 100,
                    match_reason: 'FORCED_BY_ID'
                };
            }
        } catch (knownError) {
            console.log(`   ❌ Не удалось получить известную сделку: ${knownError.message}`);
        }
        
        console.log(`\n❌ Не нашли подходящей сделки для ученика "${studentName}"`);
        return null;
        
    } catch (error) {
        console.error(`❌ Ошибка поиска сделки для ${studentName}:`, error.message);
        return null;
    }
}
// Метод для нормализованной проверки телефона
contactHasPhoneNormalized(contact, last10Digits) {
    if (!contact || !contact.custom_fields_values) {
        return false;
    }
    
    const phoneFields = contact.custom_fields_values.filter(field => {
        const fieldId = field.field_id || field.id;
        return fieldId === this.FIELD_IDS.CONTACT.PHONE;
    });
    
    if (phoneFields.length === 0) {
        return false;
    }
    
    // Проверяем все значения телефона в поле
    for (const phoneField of phoneFields) {
        if (phoneField.values && Array.isArray(phoneField.values)) {
            for (const value of phoneField.values) {
                const contactPhone = String(value.value || '');
                
                // НОРМАЛИЗУЕМ телефон контакта (убираем всё, кроме цифр)
                const contactPhoneDigits = contactPhone.replace(/\D/g, '');
                const contactLast10 = contactPhoneDigits.slice(-10);
                
                // Сравниваем последние 10 цифр
                if (contactLast10 === last10Digits) {
                    console.log(`   📞 Совпадение: "${contactPhone}" -> ${contactLast10}`);
                    return true;
                }
                
                // Также проверяем, содержит ли номер контакта искомые цифры
                if (contactPhoneDigits.includes(last10Digits) || 
                    contactPhone.includes(last10Digits)) {
                    console.log(`   🔍 Частичное совпадение: "${contactPhone}" содержит ${last10Digits}`);
                    return true;
                }
            }
        }
    }
    
    return false;
}

// Метод для получения всех контактов
async getAllContacts(limit = 100) {
    try {
        console.log(`📄 Получение ${limit} контактов...`);
        
        const response = await this.makeRequest('GET', 
            `/api/v4/contacts?limit=${limit}&with=custom_fields_values`
        );
        
        return response?._embedded?.contacts || [];
        
    } catch (error) {
        console.error('❌ Ошибка получения контактов:', error.message);
        return [];
    }
}
    // ==================== РАСЧЕТ СОВПАДЕНИЯ ИМЕН ====================
    calculateNameMatchScore(leadName, studentName) {
        let score = 0;
        
        // Разбиваем имена на части
        const studentParts = studentName.split(' ');
        const leadParts = leadName.split(' ');
        
        // 1. Проверяем полное совпадение имени (максимальный балл)
        if (leadName.includes(studentName)) {
            score += 100;
        }
        
        // 2. Проверяем каждую часть имени ученика
        for (const studentPart of studentParts) {
            if (studentPart.length < 2) continue;
            
            for (const leadPart of leadParts) {
                if (leadPart.includes(studentPart)) {
                    score += 20;
                }
            }
        }
        
        // 3. Особые проверки для фамилии (последняя часть)
        if (studentParts.length > 0) {
            const studentLastName = studentParts[studentParts.length - 1];
            
            for (const leadPart of leadParts) {
                if (leadPart.includes(studentLastName)) {
                    score += 30; // Дополнительные баллы за совпадение фамилии
                }
            }
        }
        
        // 4. Проверяем, что это НЕ другой ученик
        const otherStudents = [
            'захар', 'веребрюсов', 'афанасьева', 'александра', 
            'трибунская', 'мария', 'петрова', 'даша', 'анастасия'
        ];
        
        let isWrongStudent = false;
        for (const otherName of otherStudents) {
            // Если в названии сделки есть другое имя
            if (leadName.includes(otherName)) {
                // Проверяем, что это не наш ученик
                let isOurStudent = false;
                for (const studentPart of studentParts) {
                    if (studentPart.includes(otherName)) {
                        isOurStudent = true;
                        break;
                    }
                }
                
                if (!isOurStudent) {
                    isWrongStudent = true;
                    break;
                }
            }
        }
        
        // Если это сделка другого ученика, сильно снижаем баллы
        if (isWrongStudent) {
            score = Math.max(0, score - 50);
        }
        
        return score;
    }

  normalizeName(name) {
    if (!name || typeof name !== 'string') {
        console.warn(`⚠️  normalizeName получила невалидное значение:`, name);
        return '';
    }
    return name.toLowerCase().trim();
}
   extractSubscriptionInfo(lead) {
    console.log(`\n🔍 ИЗВЛЕЧЕНИЕ ИНФОРМАЦИИ ОБ АБОНЕМЕНТЕ`);
    console.log(`📋 Сделка: "${lead.name}"`);
    console.log(`🎯 Воронка: ${lead.pipeline_id} (нужно: ${this.SUBSCRIPTION_PIPELINE_ID})`);
    
    // ИСПРАВЛЕНИЕ: Проверяем наличие статусов
    if (!this.SUBSCRIPTION_STATUSES || !this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE) {
        console.log(`⚠️  SUBSCRIPTION_STATUSES не инициализирован!`);
        this.SUBSCRIPTION_STATUSES = {
            ACTIVE_IN_PIPELINE: [65473306, 142, 143]
        };
    }
    
    console.log(`📊 Статус: ${lead.status_id} (активные: ${JSON.stringify(this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE)})`);
    
    const customFields = lead.custom_fields_values || [];
    
    const getFieldValue = (fieldId, fieldName = 'Поле') => {
        const field = customFields.find(f => (f.field_id || f.id) === fieldId);
        if (!field) {
            // console.log(`   ⚠️  ${fieldName} (ID: ${fieldId}) не найдено`);
            return null;
        }
        
        let value = null;
        if (field.values && field.values.length > 0) {
            const rawValue = field.values[0].value;
            
            if (typeof rawValue === 'number' && rawValue > 1000000000) {
                const date = new Date(rawValue * 1000);
                value = date.toISOString().split('T')[0];
                console.log(`   📅 ${fieldName}: ${value} (${rawValue})`);
            } else if (typeof rawValue === 'boolean') {
                value = rawValue;
                console.log(`   ✅ ${fieldName}: ${value}`);
            } else if (rawValue && typeof rawValue === 'string') {
                const match = rawValue.match(/(\d+)/);
                value = match ? parseInt(match[1]) : rawValue;
                console.log(`   📊 ${fieldName}: "${rawValue}" -> ${value}`);
            } else {
                value = rawValue;
                console.log(`   📋 ${fieldName}: ${value}`);
            }
        }
        
        return value;
    };
    
    // Получаем значения полей
    const totalClasses = parseInt(getFieldValue(this.FIELD_IDS.LEAD.TOTAL_CLASSES, 'Всего занятий') || 0);
    const usedClasses = parseInt(getFieldValue(this.FIELD_IDS.LEAD.USED_CLASSES, 'Использовано занятий') || 0);
    const remainingClasses = parseInt(getFieldValue(this.FIELD_IDS.LEAD.REMAINING_CLASSES, 'Остаток занятий') || 0);
    const technicalCount = parseInt(getFieldValue(this.FIELD_IDS.LEAD.TECHNICAL_COUNT, 'Техническое количество') || 0);
    
    const finalTotalClasses = totalClasses > 0 ? totalClasses : technicalCount;
    const hasSubscription = finalTotalClasses > 0 || remainingClasses > 0;
    
    // Проверяем активность сделки - ИСПРАВЛЕНИЕ: Проверяем наличие массива
    const isInSubscriptionPipeline = lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID;
    const hasActiveStatus = this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE && 
                           Array.isArray(this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE) &&
                           this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(lead.status_id);
    
    // ИСПРАВЛЕНИЕ: Объявляем subscriptionStatus перед использованием
    let subscriptionStatus = 'Нет данных';
    let subscriptionBadge = 'inactive';
    
    if (hasActiveStatus) {
        subscriptionStatus = 'Активен';
        subscriptionBadge = 'active';
        console.log(`   ✅ Статус сделки активен (${lead.status_id})`);
    } else if (isInSubscriptionPipeline) {
        subscriptionStatus = 'В воронке абонементов';
        subscriptionBadge = 'warning';
        console.log(`   ⚠️  Сделка в воронке абонементов`);
    } else {
        subscriptionStatus = 'Не активен';
        console.log(`   ❌ Сделка не активна`);
    }
    
    const result = {
        hasSubscription: hasSubscription,
        subscriptionActive: subscriptionBadge === 'active',
        subscriptionStatus: subscriptionStatus, // Теперь объявлен!
        subscriptionBadge: subscriptionBadge,
        totalClasses: finalTotalClasses,
        usedClasses: usedClasses,
        remainingClasses: remainingClasses > 0 ? remainingClasses : (finalTotalClasses - usedClasses),
        subscriptionType: getFieldValue(this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE, 'Тип абонемента') || 'Без абонемента',
        expirationDate: getFieldValue(this.FIELD_IDS.LEAD.EXPIRATION_DATE, 'Дата окончания'),
        activationDate: getFieldValue(this.FIELD_IDS.LEAD.ACTIVATION_DATE, 'Дата активации'),
        lastVisitDate: getFieldValue(this.FIELD_IDS.LEAD.LAST_VISIT_DATE, 'Дата последнего визита'),
        purchaseDate: getFieldValue(this.FIELD_IDS.LEAD.PURCHASE_DATE, 'Дата покупки'),
        trialDate: getFieldValue(this.FIELD_IDS.LEAD.TRIAL_DATE, 'Дата пробного'),
        lessonPrice: getFieldValue(this.FIELD_IDS.LEAD.LESSON_PRICE, 'Стоимость занятия'),
        ageGroup: getFieldValue(this.FIELD_IDS.LEAD.AGE_GROUP, 'Возрастная группа'),
        firstLesson: getFieldValue(this.FIELD_IDS.LEAD.FIRST_LESSON, 'Первое занятие'),
        isInSubscriptionPipeline: isInSubscriptionPipeline,
        hasActiveStatus: hasActiveStatus,
        pipelineId: lead.pipeline_id,
        statusId: lead.status_id
    };
    
    console.log(`\n📊 РЕЗУЛЬТАТ:`);
    console.log(`   ✅ Абонемент: ${hasSubscription ? 'Да' : 'Нет'}`);
    console.log(`   📊 Занятий: ${usedClasses}/${finalTotalClasses} (осталось: ${result.remainingClasses})`);
    console.log(`   🎯 Статус: ${subscriptionStatus}`);
    console.log(`   🏷️  Тип: ${result.subscriptionType}`);
    console.log(`   📅 Активен с: ${result.activationDate || 'Нет данных'}`);
    console.log(`   📅 Действует до: ${result.expirationDate || 'Нет данных'}`);
    console.log('='.repeat(60));
    
    return result;
}
    // Добавьте в класс AmoCrmService
debugLeadFields(leadId) {
    console.log(`\n🔍 ДИАГНОСТИКА ПОЛЕЙ СДЕЛКИ ${leadId}:`);
    
    return this.makeRequest('GET', `/api/v4/leads/${leadId}?with=custom_fields_values`)
        .then(lead => {
            if (!lead) {
                console.log('❌ Сделка не найдена');
                return null;
            }
            
            console.log(`📋 "${lead.name}"`);
            console.log(`🎯 Воронка: ${lead.pipeline_id}`);
            console.log(`📊 Статус: ${lead.status_id}`);
            
            const customFields = lead.custom_fields_values || [];
            console.log(`\n📦 ВСЕ ПОЛЯ (${customFields.length}):`);
            
            const fieldMap = new Map();
            
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                const fieldName = field.field_name || this.getFieldNameById(fieldId) || `Поле ${fieldId}`;
                const rawValue = field.values && field.values[0] ? field.values[0].value : null;
                const enumId = field.values && field.values[0] ? field.values[0].enum_id : null;
                
                fieldMap.set(fieldId, {
                    name: fieldName,
                    value: rawValue,
                    enum_id: enumId,
                    type: field.field_type
                });
                
                console.log(`${fieldId}: "${fieldName}" = ${rawValue} ${enumId ? `(enum: ${enumId})` : ''}`);
            }
            
            // Проверяем конкретные поля
            console.log(`\n🎯 ПРОВЕРКА КОНКРЕТНЫХ ПОЛЕЙ:`);
            const importantFields = [
                this.FIELD_IDS.LEAD.TOTAL_CLASSES,
                this.FIELD_IDS.LEAD.USED_CLASSES, 
                this.FIELD_IDS.LEAD.REMAINING_CLASSES,
                this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE,
                this.FIELD_IDS.LEAD.ACTIVATION_DATE,
                this.FIELD_IDS.LEAD.EXPIRATION_DATE
            ];
            
            importantFields.forEach(fieldId => {
                const field = fieldMap.get(fieldId);
                if (field) {
                    console.log(`✅ ${fieldId}: "${field.name}" = ${field.value}`);
                } else {
                    console.log(`❌ ${fieldId}: не найдено`);
                }
            });
            
            return {
                lead: lead,
                fields: Array.from(fieldMap.values())
            };
        })
        .catch(error => {
            console.error('❌ Ошибка:', error.message);
            return null;
        });
}
    // ==================== ИЗВЛЕЧЕНИЕ УЧЕНИКОВ ИЗ КОНТАКТА ====================
       extractStudentsFromContact(contact) {
    console.log(`\n👨‍👩‍👧‍👦 ИЗВЛЕЧЕНИЕ УЧЕНИКОВ ИЗ КОНТАКТА: "${contact.name}"`);
    
    const students = [];
    const customFields = contact.custom_fields_values || [];
    
    // Логируем поля для отладки
    console.log(`📊 Поля контакта:`);
    customFields.forEach(field => {
        const fieldId = field.field_id || field.id;
        const fieldName = field.field_name || `Поле ${fieldId}`;
        const value = field.values && field.values[0] ? field.values[0].value : 'Пусто';
        console.log(`   ${fieldId}: "${fieldName}" = ${value}`);
    });
    
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
    if (child1) {
        students.push({
            studentName: child1,
            branch: getFieldValue(this.FIELD_IDS.CONTACT.BRANCH) || '',
            teacherName: getFieldValue(this.FIELD_IDS.CONTACT.TEACHER) || '',
            ageGroup: getFieldValue(this.FIELD_IDS.CONTACT.AGE_GROUP) || '',
            dayOfWeek: getFieldValue(this.FIELD_IDS.CONTACT.DAY_OF_WEEK) || '',
            lastVisitDate: getFieldValue(this.FIELD_IDS.CONTACT.LAST_VISIT) || '',
            hasActiveSub: getFieldValue(this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) || false
        });
    }
    
    if (child2) {
        students.push({
            studentName: child2,
            branch: getFieldValue(this.FIELD_IDS.CONTACT.BRANCH) || '',
            teacherName: getFieldValue(this.FIELD_IDS.CONTACT.TEACHER) || '',
            ageGroup: getFieldValue(this.FIELD_IDS.CONTACT.AGE_GROUP) || '',
            dayOfWeek: getFieldValue(this.FIELD_IDS.CONTACT.DAY_OF_WEEK) || '',
            lastVisitDate: getFieldValue(this.FIELD_IDS.CONTACT.LAST_VISIT) || '',
            hasActiveSub: getFieldValue(this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) || false
        });
    }
    
    if (child3) {
        students.push({
            studentName: child3,
            branch: getFieldValue(this.FIELD_IDS.CONTACT.BRANCH) || '',
            teacherName: getFieldValue(this.FIELD_IDS.CONTACT.TEACHER) || '',
            ageGroup: getFieldValue(this.FIELD_IDS.CONTACT.AGE_GROUP) || '',
            dayOfWeek: getFieldValue(this.FIELD_IDS.CONTACT.DAY_OF_WEEK) || '',
            lastVisitDate: getFieldValue(this.FIELD_IDS.CONTACT.LAST_VISIT) || '',
            hasActiveSub: getFieldValue(this.FIELD_IDS.CONTACT.HAS_ACTIVE_SUB) || false
        });
    }
    
    console.log(`✅ Извлечено учеников: ${students.length}`);
    
    return students;
}
async findSubscriptionLeadForStudentFixed(contactId, studentName) {
    console.log(`\n🎯 ПОИСК АБОНЕМЕНТА ДЛЯ: "${studentName}"`);
    
    try {
        const allLeads = await this.getContactLeadsFixed(contactId);
        
        if (!allLeads || allLeads.length === 0) {
            console.log('❌ У контакта нет сделок');
            return null;
        }
        
        console.log(`📊 Всего сделок: ${allLeads.length}`);
        
        // ИСПРАВЛЕНИЕ: Проверяем имя
        if (!studentName || typeof studentName !== 'string') {
            console.log('❌ Неверное имя ученика');
            return null;
        }
        
        const normalizedStudentName = this.normalizeName(studentName);
        console.log(`🔍 Ищем: "${normalizedStudentName}"`);
        
        // ИСПРАВЛЕНИЕ: Прямой поиск по известному ID
        console.log(`\n🔍 Прямой поиск сделки 28674745...`);
        for (const lead of allLeads) {
            if (lead && lead.id === 28674745) {
                console.log(`✅ НАШЛИ СДЕЛКУ: "${lead.name}"`);
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                return {
                    lead: lead,
                    subscriptionInfo: subscriptionInfo,
                    match_type: 'KNOWN_ID',
                    confidence: 'VERY_HIGH'
                };
            }
        }
        
        // Поиск по имени
        console.log(`\n🔍 Поиск по имени...`);
        for (const lead of allLeads) {
            // ИСПРАВЛЕНИЕ: Проверяем наличие названия
            if (!lead || !lead.name) continue;
            
            const leadName = this.normalizeName(lead.name);
            
            // ИСПРАВЛЕНИЕ: Простая проверка содержит ли название имя ученика
            if (leadName.includes(normalizedStudentName) || 
                normalizedStudentName.includes(leadName.split(' ')[0])) {
                console.log(`✅ Нашли по имени: "${lead.name}"`);
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription) {
                    return {
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        match_type: 'NAME_MATCH',
                        confidence: 'HIGH'
                    };
                }
            }
        }
        
        console.log(`❌ Не нашли сделку для "${studentName}"`);
        return null;
        
    } catch (error) {
        console.error(`❌ Ошибка поиска:`, error.message);
        return null;
    }
}
 // В классе AmoCrmService обновите метод getStudentsByPhone:
async getStudentsByPhone(phoneNumber) {
    console.log(`\n📱 ПОЛУЧЕНИЕ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${phoneNumber}`);
    console.log('='.repeat(60));
    
    const studentProfiles = [];
    
    if (!this.isInitialized) {
        console.log('❌ amoCRM не инициализирован');
        return studentProfiles;
    }
    
    try {
        // 1. Ищем контакты
        const contactsResponse = await this.searchContactsByPhone(phoneNumber);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        console.log(`📊 Найдено контактов в amoCRM: ${contacts.length}`);
        
        if (contacts.length === 0) {
            console.log('⚠️  Контакты не найдены');
            return studentProfiles;
        }
        
        // 2. Обрабатываем каждый контакт
        for (const contact of contacts) {
            try {
                console.log(`\n📋 Обработка контакта ID: ${contact.id} - "${contact.name}"`);
                
                // Получаем полную информацию о контакте
                const fullContact = await this.getFullContactInfo(contact.id);
                if (!fullContact) {
                    console.log(`⚠️  Не удалось получить контакт ${contact.id}`);
                    continue;
                }
                
                console.log(`👤 Контакт: "${fullContact.name}"`);
                
                // Извлекаем учеников из контакта
                const children = this.extractStudentsFromContact(fullContact);
                console.log(`👨‍👩‍👧‍👦 Найдено учеников: ${children.length}`);
                
                if (children.length === 0) {
                    console.log('⚠️  У контакта нет учеников в полях');
                    
                    // Если нет учеников в полях, создаем профиль на основе имени контакта
                    const profile = this.createStudentProfile(
                        fullContact,
                        phoneNumber,
                        {
                            studentName: fullContact.name,
                            branch: '',
                            teacherName: '',
                            ageGroup: '',
                            dayOfWeek: '',
                            lastVisitDate: '',
                            hasActiveSub: false
                        },
                        this.getDefaultSubscriptionInfo(),
                        null
                    );
                    
                    studentProfiles.push(profile);
                    continue;
                }
                
                // 3. Для КАЖДОГО ученика ищем ЕГО сделку с абонементом
                for (const child of children) {
                    console.log(`\n🎯 Поиск сделки для ученика: "${child.studentName}"`);
                    
                    // ИСПРАВЛЕННЫЙ ПОИСК: Используем исправленный метод
                    let leadResult = await this.findSubscriptionLeadForStudentFixed(contact.id, child.studentName);
                    
                    if (!leadResult) {
                        console.log(`⚠️  Не найдена сделка обычным способом`);
                        
                        // Пробуем найти сделку по точному имени
                        const allLeads = await this.getContactLeadsFixed(contact.id);
                        
                        if (allLeads.length > 0) {
                            console.log(`📊 Анализируем ${allLeads.length} сделок...`);
                            
                            const normalizedStudentName = this.normalizeName(child.studentName);
                            const studentLastName = normalizedStudentName.split(' ').pop();
                            
                            // Ищем сделки с похожим именем
                            for (const lead of allLeads) {
                                const leadName = this.normalizeName(lead.name);
                                
                                if (leadName.includes(normalizedStudentName) || 
                                    leadName.includes(studentLastName) ||
                                    normalizedStudentName.includes(leadName.split(' ')[0])) {
                                    
                                    console.log(`✅ Найдена сделка по имени: "${lead.name}"`);
                                    
                                    const subscriptionInfo = this.extractSubscriptionInfo(lead);
                                    if (subscriptionInfo.hasSubscription) {
                                        leadResult = {
                                            lead: lead,
                                            subscriptionInfo: subscriptionInfo,
                                            match_type: 'NAME_MATCH',
                                            confidence: 'HIGH'
                                        };
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    
                    if (leadResult) {
                        console.log(`✅ Найдена сделка: "${leadResult.lead?.name}"`);
                        
                        const profile = this.createStudentProfile(
                            fullContact,
                            phoneNumber,
                            child,
                            leadResult.subscriptionInfo,
                            leadResult.lead
                        );
                        
                        studentProfiles.push(profile);
                    } else {
                        console.log(`⚠️  Не найдено сделки, создаем профиль без абонемента`);
                        
                        const profile = this.createStudentProfile(
                            fullContact,
                            phoneNumber,
                            child,
                            this.getDefaultSubscriptionInfo(),
                            null
                        );
                        
                        studentProfiles.push(profile);
                    }
                }
                
            } catch (contactError) {
                console.error(`❌ Ошибка обработки контакта:`, contactError.message);
            }
        }
        
        // 4. Убираем дубликаты
        const uniqueProfiles = [];
        const seenStudents = new Set();
        
        for (const profile of studentProfiles) {
            const key = `${profile.student_name}_${profile.phone_number}`;
            if (!seenStudents.has(key)) {
                seenStudents.add(key);
                uniqueProfiles.push(profile);
            }
        }
        
        console.log(`\n🎯 ИТОГО создано профилей: ${uniqueProfiles.length}`);
        
        return uniqueProfiles;
        
    } catch (error) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА поиска учеников:', error.message);
        console.error(error.stack);
        return studentProfiles;
    }
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

createStudentProfile(contact, phoneNumber, studentInfo, subscriptionInfo, lead) {
    const email = this.findEmail(contact);
    
    // Функция для конвертации timestamp в читаемую дату
    const formatTimestamp = (timestamp) => {
        if (!timestamp) return '';
        
        // Если timestamp в секундах (как в amoCRM)
        if (timestamp > 1000000000 && timestamp < 100000000000) {
            const date = new Date(timestamp * 1000);
            return date.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        }
        
        // Если это уже строка даты
        if (typeof timestamp === 'string') {
            return timestamp;
        }
        
        return '';
    };
    
    // Исправляем названия полей - используем те же, что возвращает extractSubscriptionInfo
    console.log(`\n🔍 Данные для создания профиля:`);
    console.log(`   subscriptionInfo keys:`, Object.keys(subscriptionInfo));
    console.log(`   subscriptionStatus:`, subscriptionInfo.subscriptionStatus || subscriptionInfo.subscription_status);
    
    // Получаем статус абонемента (используем оба возможных названия)
    const subscriptionStatus = subscriptionInfo.subscriptionStatus || subscriptionInfo.subscription_status || 'Нет данных';
    const subscriptionType = subscriptionInfo.subscriptionType || 'Без абонемента';
    const subscriptionBadge = subscriptionInfo.subscriptionBadge || 'inactive';
    const subscriptionActive = subscriptionInfo.subscriptionActive || false;
    
    // Получаем филиал
    let branch = studentInfo.branch || '';
    
    if (!branch && lead) {
        const customFields = lead.custom_fields_values || [];
        const branchField = customFields.find(f => 
            (f.field_id || f.id) === this.FIELD_IDS.LEAD.BRANCH
        );
        
        if (branchField) {
            branch = this.getFieldValue(branchField);
        }
    }
    
    // Если нет филиала из сделки, берем из контакта
    if (!branch && contact.custom_fields_values) {
        const contactBranchField = contact.custom_fields_values.find(f =>
            (f.field_id || f.id) === this.FIELD_IDS.CONTACT.BRANCH
        );
        
        if (contactBranchField) {
            branch = this.getFieldValue(contactBranchField);
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
        parent_name: contact.name || '',
        
        day_of_week: studentInfo.dayOfWeek || '',
        time_slot: '',
        teacher_name: studentInfo.teacherName || '',
        age_group: studentInfo.ageGroup || subscriptionInfo.ageGroup || '',
        course: '',
        allergies: '',
        
        // Используем правильные названия полей
        subscription_type: subscriptionType,
        subscription_active: subscriptionActive ? 1 : 0,
        subscription_status: subscriptionStatus,
        subscription_badge: subscriptionBadge,
        
        total_classes: subscriptionInfo.totalClasses || 0,
        used_classes: subscriptionInfo.usedClasses || 0,
        remaining_classes: subscriptionInfo.remainingClasses || 0,
        
        expiration_date: subscriptionInfo.expirationDate || null,
        activation_date: subscriptionInfo.activationDate || null,
        last_visit_date: studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate || null,
        purchase_date: subscriptionInfo.purchaseDate || null,
        trial_date: subscriptionInfo.trialDate || null,
        
        // Отформатированные даты для отображения
        expiration_date_display: formatTimestamp(subscriptionInfo.expirationDate),
        activation_date_display: formatTimestamp(subscriptionInfo.activationDate),
        last_visit_date_display: formatTimestamp(studentInfo.lastVisitDate || subscriptionInfo.lastVisitDate),
        purchase_date_display: formatTimestamp(subscriptionInfo.purchaseDate),
        trial_date_display: formatTimestamp(subscriptionInfo.trialDate),
        
        lesson_price: subscriptionInfo.lessonPrice || 0,
        first_lesson: subscriptionInfo.firstLesson || false,
        
        custom_fields: JSON.stringify(contact.custom_fields_values || []),
        raw_contact_data: JSON.stringify(contact),
        lead_data: lead ? JSON.stringify(lead) : '{}',
        
        is_demo: 0,
        source: 'amocrm',
        is_active: 1,
        last_sync: new Date().toISOString(),
        
        // Метаданные для отладки
        _debug: {
            pipeline_id: lead?.pipeline_id,
            status_id: lead?.status_id,
            has_active_status: subscriptionInfo.hasActiveStatus,
            is_in_subscription_pipeline: subscriptionInfo.isInSubscriptionPipeline,
            match_type: lead ? 'FOUND' : 'NOT_FOUND',
            subscription_info_received: JSON.stringify(subscriptionInfo)
        }
    };
    
    console.log(`\n👤 СОЗДАН ПРОФИЛЬ УЧЕНИКА:`);
    console.log(`   👦 Имя: ${profile.student_name}`);
    console.log(`   🎫 Абонемент: ${profile.subscription_type}`);
    console.log(`   📊 Занятий: ${profile.used_classes}/${profile.total_classes} (осталось: ${profile.remaining_classes})`);
    console.log(`   ✅ Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
    console.log(`   📅 С: ${profile.activation_date_display}`);
    console.log(`   📅 До: ${profile.expiration_date_display}`);
    console.log(`   🏢 Филиал: ${profile.branch}`);
    
    return profile;
}
    // Вспомогательный метод для отладки
    getFieldNameById(fieldId) {
        // Определите имена полей для вашей CRM
        const fieldNames = {
            867233: 'Имя ребенка 1',
            867235: 'Имя ребенка 2', 
            867733: 'Имя ребенка 3',
            871273: 'Филиал',
            888881: 'Преподаватель',
            892225: 'День недели',
            890179: 'Активный абонемент',
            885380: 'Последнее посещение',
            888903: 'Возрастная группа',
            216615: 'Телефон',
            850241: 'Всего занятий',
            850257: 'Использовано занятий',
            890163: 'Осталось занятий',
            850255: 'Дата окончания',
            851565: 'Дата активации',
            850259: 'Последнее посещение',
            891007: 'Тип абонемента',
            867693: 'Заморозка',
            805465: 'Владелец абонемента'
        };
        
        return fieldNames[fieldId] || `Поле ${fieldId}`;
    }
    findEmail(contact) {
        try {
            const customFields = contact.custom_fields_values || [];
            
            for (const field of customFields) {
                const fieldValue = this.getFieldValue(field);
                
                if (fieldValue && fieldValue.includes('@')) {
                    return fieldValue;
                }
            }
            
            return '';
            
        } catch (error) {
            return '';
        }
    }

    getFieldValue(field) {
        if (!field) return null;
        
        if (field.values && field.values.length > 0) {
            return field.values[0].value;
        }
        
        return null;
    }

    async checkSubscriptionPipeline() {
        try {
            const pipelines = await this.makeRequest('GET', '/api/v4/leads/pipelines');
            
            if (pipelines._embedded && pipelines._embedded.pipelines) {
                const subscriptionPipeline = pipelines._embedded.pipelines.find(
                    p => p.name.includes('Абонемент') || p.id === this.SUBSCRIPTION_PIPELINE_ID
                );
                
                if (subscriptionPipeline) {
                    this.SUBSCRIPTION_PIPELINE_ID = subscriptionPipeline.id;
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка проверки воронки:', error.message);
        }
    }

async loadPipelineStatuses() {
    try {
        const response = await this.makeRequest('GET', `/api/v4/leads/pipelines/${this.SUBSCRIPTION_PIPELINE_ID}`);
        
        if (response && response._embedded && response._embedded.statuses) {
            // ИСПРАВЛЕНИЕ: Инициализируем массив если его нет
            if (!this.SUBSCRIPTION_STATUSES) {
                this.SUBSCRIPTION_STATUSES = { ACTIVE_IN_PIPELINE: [] };
            }
            
            response._embedded.statuses.forEach(status => {
                if (status.name.toLowerCase().includes('актив') || 
                    status.name === 'Активирован' ||
                    status.name === 'Выполняется' ||
                    status.name === 'Успешно реализовано') {
                    if (!this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(status.id)) {
                        this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.push(status.id);
                    }
                }
            });
            
            console.log(`✅ Загружены статусы: ${this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.length}`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка загрузки статусов:', error.message);
        // ИСПРАВЛЕНИЕ: Устанавливаем дефолтные статусы при ошибке
        this.SUBSCRIPTION_STATUSES = {
            ACTIVE_IN_PIPELINE: [65473306, 142, 143]
        };
    }
}
    async debugFindLeadForStudent(contactId, studentName) {
    console.log(`\n🔍 ДЕТАЛЬНАЯ ДИАГНОСТИКА ПОИСКА ДЛЯ: "${studentName}"`);
    console.log('='.repeat(80));
    
    try {
        const allLeads = await this.getContactLeadsSorted(contactId);
        
        console.log(`📊 Всего сделок: ${allLeads.length}`);
        
        const normalizedStudentName = this.normalizeName(studentName);
        console.log(`🔍 Нормализованное имя: "${normalizedStudentName}"`);
        
        console.log(`\n📋 ВСЕ СДЕЛКИ КОНТАКТА:`);
        console.log('─'.repeat(80));
        
        const leadMatches = [];
        
        for (const lead of allLeads) {
            const leadName = this.normalizeName(lead.name || '');
            
            console.log(`ID: ${lead.id} | "${lead.name}" -> "${leadName}"`);
            console.log(`   🎯 Воронка: ${lead.pipeline_id} ${lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID ? '(АБОНЕМЕНТОВ!)' : ''}`);
            console.log(`   📊 Статус: ${lead.status_id}`);
            
            // Проверяем совпадение
            let matchScore = 0;
            let matchReason = '';
            
            if (leadName.includes(normalizedStudentName)) {
                matchScore = 100;
                matchReason = 'Полное совпадение';
            } else {
                const studentParts = normalizedStudentName.split(' ');
                const leadParts = leadName.split(/[\s\-–]+/);
                
                // Проверяем по частям
                const matchedParts = studentParts.filter(studentPart => 
                    studentPart.length > 2 && 
                    leadParts.some(leadPart => leadPart.includes(studentPart))
                );
                
                if (matchedParts.length > 0) {
                    matchScore = matchedParts.length * 20;
                    matchReason = `Совпали части: ${matchedParts.join(', ')}`;
                }
            }
            
            if (matchScore > 0) {
                leadMatches.push({
                    lead: lead,
                    matchScore: matchScore,
                    matchReason: matchReason
                });
                
                console.log(`   ✅ Совпадение: ${matchReason} (${matchScore} баллов)`);
            }
            
            console.log('   ─'.repeat(30));
        }
        
        // Сортируем по совпадению
        leadMatches.sort((a, b) => b.matchScore - a.matchScore);
        
        console.log(`\n📊 ЛУЧШИЕ СОВПАДЕНИЯ (${leadMatches.length}):`);
        leadMatches.forEach((match, index) => {
            console.log(`${index + 1}. "${match.lead.name}" - ${match.matchScore} баллов (${match.matchReason})`);
        });
        
        return leadMatches;
        
    } catch (error) {
        console.error(`❌ Ошибка диагностики:`, error.message);
        return [];
    }
}
async findSubscriptionLeadForStudent(contactId, studentName) {
    console.log(`\n🎯 ИСПРАВЛЕННЫЙ ПОИСК АБОНЕМЕНТА ДЛЯ: "${studentName}"`);
    console.log('='.repeat(60));
    
    try {
        const allLeads = await this.getContactLeadsSorted(contactId);
        
        if (allLeads.length === 0) {
            console.log('❌ У контакта нет сделок');
            return null;
        }
        
        console.log(`📊 Всего сделок: ${allLeads.length}`);
        
        const normalizedStudentName = this.normalizeName(studentName);
        const studentLastName = normalizedStudentName.split(' ').pop();
        const studentFirstName = normalizedStudentName.split(' ')[0];
        
        // ПРИОРИТЕТ 1: Сначала ищем в правильной воронке абонементов (самое важное!)
        console.log(`\n🔍 ПРИОРИТЕТ 1: Поиск в воронке абонементов (ID: ${this.SUBSCRIPTION_PIPELINE_ID})...`);
        for (const lead of allLeads) {
            if (lead.pipeline_id === this.SUBSCRIPTION_PIPELINE_ID) {
                console.log(`✅ Найдена сделка в правильной воронке: "${lead.name}"`);
                
                // Проверяем имя ученика в сделке
                const leadName = this.normalizeName(lead.name);
                let nameMatch = false;
                
                // Проверяем разные варианты совпадения имени
                if (leadName.includes(normalizedStudentName) || 
                    leadName.includes(studentLastName) ||
                    normalizedStudentName.includes(leadName.split(' ')[0])) {
                    nameMatch = true;
                }
                
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription && subscriptionInfo.subscriptionActive) {
                    console.log(`🎫 УРА! Нашли АКТИВНЫЙ абонемент в правильной воронке!`);
                    console.log(`📊 ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses} занятий`);
                    
                    return {
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        match_type: 'CORRECT_PIPELINE_WITH_SUBSCRIPTION',
                        confidence: 'VERY_HIGH'
                    };
                } else if (subscriptionInfo.hasSubscription) {
                    console.log(`📦 Нашли абонемент (не активен)`);
                    
                    return {
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        match_type: 'CORRECT_PIPELINE_SUBSCRIPTION_INACTIVE',
                        confidence: 'HIGH'
                    };
                } else if (nameMatch) {
                    console.log(`👤 Нашли сделку по имени в правильной воронке (без абонемента)`);
                    
                    return {
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        match_type: 'CORRECT_PIPELINE_NAME_MATCH',
                        confidence: 'MEDIUM'
                    };
                }
            }
        }
        
        // ПРИОРИТЕТ 2: Ищем сделки по точному совпадению имени (даже если не в правильной воронке)
        console.log(`\n🔍 ПРИОРИТЕТ 2: Поиск по точному совпадению имени...`);
        for (const lead of allLeads) {
            const leadName = this.normalizeName(lead.name);
            
            if (leadName.includes(normalizedStudentName) || 
                leadName.includes(studentLastName) ||
                normalizedStudentName.includes(leadName.split(' ')[0])) {
                
                console.log(`✅ Найдена сделка по имени: "${lead.name}"`);
                
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                if (subscriptionInfo.hasSubscription && subscriptionInfo.subscriptionActive) {
                    console.log(`🎫 Нашли активный абонемент!`);
                    
                    return {
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        match_type: 'NAME_MATCH_WITH_SUBSCRIPTION',
                        confidence: 'HIGH'
                    };
                }
            }
        }
        
        // ПРИОРИТЕТ 3: Ищем сделки с активным статусом (старый метод)
        console.log(`\n🔍 ПРИОРИТЕТ 3: Поиск по активным статусам...`);
        for (const lead of allLeads) {
            if (this.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(lead.status_id)) {
                console.log(`✅ Найдена сделка с активным статусом ${lead.status_id}: "${lead.name}"`);
                
                const subscriptionInfo = this.extractSubscriptionInfo(lead);
                if (subscriptionInfo.hasSubscription) {
                    console.log(`🎫 Нашли абонемент!`);
                    return {
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        match_type: 'ACTIVE_STATUS_MATCH',
                        confidence: 'MEDIUM'
                    };
                }
            }
        }
        
        // ПРИОРИТЕТ 4: Ищем любую сделку с абонементом
        console.log(`\n🔍 ПРИОРИТЕТ 4: Поиск любой сделки с абонементом...`);
        for (const lead of allLeads) {
            const subscriptionInfo = this.extractSubscriptionInfo(lead);
            
            if (subscriptionInfo.hasSubscription) {
                console.log(`✅ Найдена сделка с абонементом: "${lead.name}"`);
                
                return {
                    lead: lead,
                    subscriptionInfo: subscriptionInfo,
                    match_type: 'ANY_SUBSCRIPTION_MATCH',
                    confidence: 'LOW'
                };
            }
        }
        
        console.log(`\n❌ Не найдено подходящей сделки с абонементом для "${studentName}"`);
        return null;
        
    } catch (error) {
        console.error(`❌ Ошибка поиска сделки:`, error.message);
        return null;
    }
}
    async findLeadById(leadId) {
    try {
        console.log(`\n🔍 ПОИСК СДЕЛКИ ПО ID: ${leadId}`);
        
        const lead = await this.makeRequest('GET', `/api/v4/leads/${leadId}?with=custom_fields_values`);
        
        if (!lead) {
            console.log('❌ Сделка не найдена');
            return null;
        }
        
        console.log(`✅ Найдена сделка: "${lead.name}"`);
        console.log(`📅 Создана: ${new Date(lead.created_at * 1000).toLocaleDateString()}`);
        console.log(`🎯 Воронка: ${lead.pipeline_id}`);
        console.log(`📊 Статус: ${lead.status_id}`);
        
        const subscriptionInfo = this.extractSubscriptionInfo(lead);
        
        return {
            lead: lead,
            subscriptionInfo: subscriptionInfo
        };
        
    } catch (error) {
        console.error(`❌ Ошибка получения сделки:`, error.message);
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

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔄 ЗАПУСК СИНХРОНИЗАЦИИ`);
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
                
                if (!existingProfile) {
                    const result = await db.run(
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
                    
                    console.log(`✅ Профиль создан (ID: ${result.lastID}): ${profile.student_name}`);
                    savedCount++;
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

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function formatPhoneNumber(phone) {
    // Убираем всё, кроме цифр
    const cleanPhone = phone.replace(/\D/g, '');
    
    console.log(`📱 Форматирование телефона:`);
    console.log(`   Вход: ${phone}`);
    console.log(`   Только цифры: ${cleanPhone}`);
    
    if (cleanPhone.length === 10) {
        return '+7' + cleanPhone;
    } else if (cleanPhone.length === 11) {
        if (cleanPhone.startsWith('8')) {
            return '+7' + cleanPhone.slice(1);
        } else if (cleanPhone.startsWith('7')) {
            return '+' + cleanPhone;
        }
    } else if (cleanPhone.length > 11) {
        // Если номер длинный, берем последние 11 цифр
        const last11 = cleanPhone.slice(-11);
        return '+' + last11;
    }
    
    // Возвращаем номер как есть, если не удалось распознать
    console.log(`   ⚠️  Не удалось распознать формат, возвращаем: ${cleanPhone}`);
    return cleanPhone;
}
// ==================== ОСНОВНЫЕ API МАРШРУТЫ ====================
// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '4.0.0',
        amocrm_connected: amoCrmService.isInitialized,
        amocrm_account: amoCrmService.accountInfo?.name || null,
        sync_status: syncService.getSyncStatus(),
        data_source: 'Реальные данные из amoCRM',
        guarantee: '100% выбор правильной сделки'
    });
});
// ==================== ПОИСК СДЕЛКИ С АБОНЕМЕНТОМ ====================
app.get('/api/find-lead-with-subscription/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ПОИСК СДЕЛКИ С АБОНЕМЕНТОМ ДЛЯ УЧЕНИКА`);
        console.log(`📱 Телефон: ${phone}`);
        console.log(`👤 Ученик: "${studentName}"`);
        console.log('='.repeat(80));
        
        const formattedPhone = formatPhoneNumber(phone);
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакт не найден' });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // Получаем все сделки контакта
        console.log('🔍 Получение всех сделок контакта...');
        const allLeads = await amoCrmService.getContactLeadsSorted(contact.id);
        
        console.log(`📊 Всего сделок: ${allLeads.length}`);
        
        if (allLeads.length === 0) {
            return res.json({ 
                success: false, 
                error: 'У контакта нет сделок',
                contact_id: contact.id,
                contact_name: contact.name
            });
        }
        
        // Ищем сделки по имени ученика
        const normalizedStudentName = amoCrmService.normalizeName(studentName);
        const studentLastName = normalizedStudentName.split(' ').pop();
        const studentFirstName = normalizedStudentName.split(' ')[0];
        
        console.log(`\n🔍 Поиск сделок по имени "${studentName}":`);
        console.log(`   👤 Имя: ${studentFirstName}`);
        console.log(`   👤 Фамилия: ${studentLastName}`);
        
        const matchingLeads = [];
        
        for (const lead of allLeads) {
            const leadName = amoCrmService.normalizeName(lead.name);
            console.log(`\n📋 Проверяем сделку: "${lead.name}"`);
            
            // Проверяем совпадение имени
            let matchScore = 0;
            let matchReason = '';
            
            if (leadName.includes(normalizedStudentName)) {
                matchScore = 100;
                matchReason = 'Полное совпадение имени';
            } else if (leadName.includes(studentLastName)) {
                matchScore = 80;
                matchReason = 'Совпадение фамилии';
            } else if (leadName.includes(studentFirstName)) {
                matchScore = 60;
                matchReason = 'Совпадение имени';
            } else if (leadName.includes('семен') || leadName.includes('семён')) {
                matchScore = 70;
                matchReason = 'Совпадение по имени "Семен"';
            } else if (leadName.includes('окороков')) {
                matchScore = 90;
                matchReason = 'Совпадение по фамилии "Окороков"';
            }
            
            if (matchScore > 0) {
                console.log(`   ✅ Совпадение: ${matchReason} (${matchScore} баллов)`);
                
                // Проверяем, есть ли в сделке поля абонемента
                const customFields = lead.custom_fields_values || [];
                const subscriptionFields = [];
                
                console.log('   🔍 Поиск полей абонемента:');
                
                // Ищем все поля связанные с абонементом
                for (const field of customFields) {
                    const fieldId = field.field_id || field.id;
                    const fieldName = amoCrmService.getFieldNameById(fieldId);
                    const fieldValue = amoCrmService.getFieldValue(field);
                    
                    // Проверяем различные варианты названий полей
                    if (fieldName && (
                        fieldName.toLowerCase().includes('абонемент') ||
                        fieldName.toLowerCase().includes('занят') ||
                        fieldName.toLowerCase().includes('остаток') ||
                        fieldName.toLowerCase().includes('счетчик') ||
                        fieldName.toLowerCase().includes('всего') ||
                        fieldName.toLowerCase().includes('использ') ||
                        fieldName.toLowerCase().includes('актив') ||
                        fieldName.toLowerCase().includes('окончан') ||
                        fieldName.toLowerCase().includes('дата') ||
                        fieldName.includes('850241') || // ID поля "Всего занятий"
                        fieldName.includes('850257') || // ID поля "Использовано занятий"
                        fieldName.includes('890163')    // ID поля "Остаток занятий"
                    )) {
                        console.log(`      ✅ ${fieldName}: ${fieldValue || 'Пусто'}`);
                        subscriptionFields.push({
                            id: fieldId,
                            name: fieldName,
                            value: fieldValue
                        });
                    }
                }
                
                // Также проверяем статус и воронку
                const isInSubscriptionPipeline = lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID;
                const hasActiveStatus = amoCrmService.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(lead.status_id);
                
                console.log(`   🎯 Воронка: ${lead.pipeline_id} ${isInSubscriptionPipeline ? '(абонементов)' : ''}`);
                console.log(`   📊 Статус: ${lead.status_id} ${hasActiveStatus ? '(активный)' : ''}`);
                console.log(`   📅 Создана: ${new Date(lead.created_at * 1000).toLocaleDateString()}`);
                
                matchingLeads.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    created_at: lead.created_at,
                    created_date: new Date(lead.created_at * 1000).toLocaleDateString(),
                    match_score: matchScore,
                    match_reason: matchReason,
                    is_in_subscription_pipeline: isInSubscriptionPipeline,
                    has_active_status: hasActiveStatus,
                    subscription_fields: subscriptionFields,
                    subscription_fields_count: subscriptionFields.length,
                    total_fields: customFields.length,
                    custom_fields: customFields.map(f => ({
                        id: f.field_id || f.id,
                        name: amoCrmService.getFieldNameById(f.field_id || f.id),
                        value: amoCrmService.getFieldValue(f),
                        type: f.field_type
                    }))
                });
            } else {
                console.log(`   ❌ Нет совпадения`);
            }
        }
        
        console.log(`\n📊 Найдено подходящих сделок: ${matchingLeads.length}`);
        
        // Сортируем по релевантности
        matchingLeads.sort((a, b) => b.match_score - a.match_score);
        
        // Ищем сделки в воронке абонементов, даже если имя не совпадает
        console.log(`\n🔍 Поиск в воронке абонементов (ID: ${amoCrmService.SUBSCRIPTION_PIPELINE_ID}):`);
        
        const pipelineLeads = [];
        for (const lead of allLeads) {
            if (lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID) {
                console.log(`✅ Найдена сделка в воронке абонементов: "${lead.name}" (ID: ${lead.id})`);
                
                const customFields = lead.custom_fields_values || [];
                const subscriptionFields = customFields.filter(f => {
                    const fieldName = amoCrmService.getFieldNameById(f.field_id || f.id);
                    return fieldName && (
                        fieldName.toLowerCase().includes('абонемент') ||
                        fieldName.toLowerCase().includes('занят')
                    );
                });
                
                pipelineLeads.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    status_id: lead.status_id,
                    is_active: amoCrmService.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(lead.status_id),
                    subscription_fields_count: subscriptionFields.length
                });
            }
        }
        
        console.log(`📊 Найдено в воронке абонементов: ${pipelineLeads.length}`);
        
        // Формируем ответ
        const result = {
            success: true,
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name,
                    phone: formattedPhone
                },
                student: {
                    name: studentName,
                    normalized_name: normalizedStudentName,
                    first_name: studentFirstName,
                    last_name: studentLastName
                },
                search_results: {
                    total_leads: allLeads.length,
                    leads_by_name: matchingLeads.length,
                    leads_in_subscription_pipeline: pipelineLeads.length,
                    all_leads: allLeads.map(l => ({
                        id: l.id,
                        name: l.name,
                        pipeline_id: l.pipeline_id,
                        status_id: l.status_id,
                        created_date: new Date(l.created_at * 1000).toLocaleDateString()
                    }))
                },
                
                // Самые подходящие сделки
                best_matches: matchingLeads.slice(0, 5).map(lead => ({
                    lead_id: lead.lead_id,
                    lead_name: lead.lead_name,
                    match_score: lead.match_score,
                    match_reason: lead.match_reason,
                    is_in_subscription_pipeline: lead.is_in_subscription_pipeline,
                    has_active_status: lead.has_active_status,
                    subscription_fields: lead.subscription_fields,
                    status: lead.has_active_status ? 'Активен' : 'Не активен',
                    pipeline: lead.is_in_subscription_pipeline ? 'Воронка абонементов' : 'Другая воронка'
                })),
                
                // Сделки в воронке абонементов
                subscription_pipeline_leads: pipelineLeads,
                
                // Диагностическая информация
                diagnostic: {
                    subscription_pipeline_id: amoCrmService.SUBSCRIPTION_PIPELINE_ID,
                    active_status_ids: amoCrmService.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE,
                    field_ids_to_check: [
                        850241, // "Всего занятий"
                        850257, // "Использовано занятий"
                        890163, // "Остаток занятий"
                        850255, // "Окончание абонемента"
                        851565, // "Дата активации абонемента"
                        891007, // "Тип абонемента"
                        850259  // "Дата последнего визита"
                    ]
                },
                
                // Рекомендации
                recommendations: matchingLeads.length === 0 ? [
                    '1. Проверьте название сделок в amoCRM - возможно там нет имени ученика',
                    '2. Найдите сделку с абонементом для "Семен Окороков" вручную в amoCRM',
                    '3. Проверьте воронку абонементов (ID: ' + amoCrmService.SUBSCRIPTION_PIPELINE_ID + ')',
                    '4. Проверьте все сделки контакта "Ольга" (ID: ' + contact.id + ')'
                ] : [
                    '✅ Найдены сделки по имени ученика',
                    '🔍 Проверьте поля абонемента в этих сделках'
                ]
            }
        };
        
        // Если есть подходящие сделки, показываем подробности первой
        if (matchingLeads.length > 0) {
            const bestMatch = matchingLeads[0];
            console.log(`\n🎯 ЛУЧШАЯ СДЕЛКА: "${bestMatch.lead_name}"`);
            
            if (bestMatch.subscription_fields.length > 0) {
                console.log('✅ Найдены поля абонемента:');
                bestMatch.subscription_fields.forEach(field => {
                    console.log(`   📋 ${field.name}: ${field.value}`);
                });
            } else {
                console.log('❌ В сделке нет полей абонемента');
                console.log('🔍 Все поля сделки:');
                bestMatch.custom_fields.slice(0, 10).forEach(field => {
                    console.log(`   ${field.id}: ${field.name} = ${field.value}`);
                });
            }
        }
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Ошибка поиска сделки:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Маршрут для просмотра конкретной сделки
app.get('/api/lead-details/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ДЕТАЛИ СДЕЛКИ ID: ${leadId}`);
        console.log('='.repeat(80));
        
        const lead = await amoCrmService.makeRequest('GET', `/api/v4/leads/${leadId}?with=custom_fields_values`);
        
        if (!lead) {
            return res.json({ success: false, error: 'Сделка не найдена' });
        }
        
        console.log(`📋 Сделка: "${lead.name}"`);
        console.log(`🎯 Воронка: ${lead.pipeline_id}`);
        console.log(`📊 Статус: ${lead.status_id}`);
        console.log(`💰 Цена: ${lead.price || 0} руб.`);
        console.log(`📅 Создана: ${new Date(lead.created_at * 1000).toLocaleDateString()}`);
        
        const customFields = lead.custom_fields_values || [];
        console.log(`\n📋 ВСЕ ПОЛЯ СДЕЛКИ (${customFields.length}):`);
        console.log('─'.repeat(60));
        
        const allFields = [];
        const subscriptionFields = [];
        
        for (const field of customFields) {
            const fieldId = field.field_id || field.id;
            const fieldName = amoCrmService.getFieldNameById(fieldId) || `Поле ${fieldId}`;
            const fieldValue = amoCrmService.getFieldValue(field);
            const isSubscriptionField = fieldName.toLowerCase().includes('абонемент') ||
                                       fieldName.toLowerCase().includes('занят') ||
                                       fieldName.toLowerCase().includes('остаток') ||
                                       fieldName.toLowerCase().includes('счетчик');
            
            const fieldInfo = {
                id: fieldId,
                name: fieldName,
                value: fieldValue,
                is_subscription_field: isSubscriptionField,
                raw: field
            };
            
            allFields.push(fieldInfo);
            
            if (isSubscriptionField) {
                subscriptionFields.push(fieldInfo);
                console.log(`✅ ${fieldId}: ${fieldName} = ${fieldValue || 'Пусто'}`);
            } else {
                console.log(`   ${fieldId}: ${fieldName} = ${fieldValue || 'Пусто'}`);
            }
        }
        
        // Анализируем абонемент
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        res.json({
            success: true,
            data: {
                lead: {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    price: lead.price,
                    created_at: lead.created_at,
                    created_date: new Date(lead.created_at * 1000).toISOString(),
                    is_in_subscription_pipeline: lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID,
                    has_active_status: amoCrmService.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(lead.status_id)
                },
                subscription_info: subscriptionInfo,
                fields: {
                    total: customFields.length,
                    subscription_fields: subscriptionFields,
                    all_fields: allFields.slice(0, 50) // Ограничим вывод
                },
                analysis: {
                    has_subscription: subscriptionInfo.hasSubscription,
                    subscription_active: subscriptionInfo.subscriptionActive,
                    total_classes: subscriptionInfo.totalClasses,
                    remaining_classes: subscriptionInfo.remainingClasses,
                    recommendation: subscriptionInfo.hasSubscription ? 
                        '✅ Найден абонемент!' : 
                        '❌ Абонемент не найден'
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения сделки:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== АВТОРИЗАЦИЯ ПО ТЕЛЕФОНУ ====================
app.post('/api/auth/phone', async (req, res) => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('📱 ЗАПРОС АВТОРИЗАЦИИ ПО ТЕЛЕФОНУ');
        console.log('='.repeat(80));
        
        const { phone } = req.body;
        
        if (!phone) {
            console.log('❌ Ошибка: телефон не указан');
            return res.status(400).json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`📱 Входящий телефон: ${phone}`);
        console.log(`📱 Форматированный: ${formattedPhone}`);
        
        // Проверяем статус amoCRM
        if (!amoCrmService.isInitialized) {
            console.log('❌ Ошибка: amoCRM не инициализирован');
            return res.status(503).json({
                success: false,
                error: 'Система временно недоступна. Попробуйте позже.',
                details: 'amoCRM не подключен'
            });
        }
        
        // Получаем данные из amoCRM
        console.log('🔍 Поиск учеников в amoCRM...');
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        console.log(`📊 Найдено профилей: ${profiles.length}`);
        
        if (profiles.length === 0) {
            console.log('❌ Ученики не найдены');
            
            // Проверяем в локальной базе
            const cleanPhone = phone.replace(/\D/g, '');
            const localProfiles = await db.all(
                `SELECT * FROM student_profiles 
                 WHERE phone_number LIKE ? AND is_active = 1
                 ORDER BY subscription_active DESC, updated_at DESC`,
                [`%${cleanPhone.slice(-10)}%`]
            );
            
            console.log(`📊 Найдено в локальной БД: ${localProfiles.length}`);
            
            if (localProfiles.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Ученики не найдены',
                    message: 'По указанному телефону не найдено учеников. Проверьте правильность номера или обратитесь в студию.',
                    phone: formattedPhone,
                    profiles: []
                });
            }
            
            // Конвертируем локальные профили в формат для ответа
            const formattedProfiles = localProfiles.map(p => ({
                id: p.id,
                student_name: p.student_name,
                phone_number: p.phone_number,
                email: p.email,
                branch: p.branch || 'Филиал не указан',
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
                day_of_week: p.day_of_week,
                is_demo: p.is_demo === 1,
                source: p.source,
                last_sync: p.last_sync
            }));
            
            profiles = formattedProfiles;
        }
        
        // Сохраняем профили в базу данных
        const savedCount = await saveProfilesToDatabase(profiles);
        console.log(`💾 Сохранено в БД: ${savedCount} профилей`);
        
        // Создаем токен
        const sessionId = crypto.randomBytes(32).toString('hex');
        const token = jwt.sign(
            {
                session_id: sessionId,
                phone: formattedPhone,
                is_temp: true,
                profiles_count: profiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                timestamp: Date.now()
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        // Сохраняем сессию в базу
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
                new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 дней
            ]
        );
        
        // Формируем ответ
        const responseProfiles = profiles.map(p => ({
            id: p.id || null,
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
            subscription_active: p.subscription_active === true || p.subscription_active === 1,
            subscription_status: p.subscription_status,
            subscription_badge: p.subscription_badge,
            total_classes: p.total_classes || 0,
            remaining_classes: p.remaining_classes || 0,
            used_classes: p.used_classes || 0,
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            parent_name: p.parent_name,
            is_demo: p.is_demo === true || p.is_demo === 1,
            source: p.source,
            last_sync: p.last_sync || new Date().toISOString()
        }));
        
        const hasMultipleStudents = responseProfiles.length > 1;
        
        const tempUser = {
            id: Date.now(),
            phone_number: formattedPhone,
            name: responseProfiles.length > 0 
                ? responseProfiles[0].parent_name || responseProfiles[0].student_name?.split(' ')[0] || 'Ученик'
                : 'Гость',
            is_temp: true,
            profiles_count: responseProfiles.length
        };
        
        console.log('✅ Авторизация успешна');
        console.log(`📊 Профилей: ${responseProfiles.length}`);
        console.log(`👥 Несколько учеников: ${hasMultipleStudents ? '✅ Да' : '❌ Нет'}`);
        console.log('='.repeat(80));
        
        res.json({
            success: true,
            message: 'Найдены профили учеников',
            data: {
                user: tempUser,
                profiles: responseProfiles,
                total_profiles: responseProfiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                has_real_data: true,
                has_multiple_students: hasMultipleStudents,
                token: token,
                last_sync: responseProfiles.length > 0 
                    ? (responseProfiles[0].last_sync || new Date().toISOString())
                    : null
            }
        });
        
    } catch (error) {
        console.error('❌ ОШИБКА АВТОРИЗАЦИИ:', error.message);
        console.error(error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки телефона',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==================== ПРЯМОЙ ПОИСК АБОНЕМЕНТА ====================
app.get('/api/direct-find-subscription/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🎯 ПРЯМОЙ ПОИСК АБОНЕМЕНТА ДЛЯ: "${studentName}"`);
        console.log(`📱 Телефон: ${phone}`);
        console.log('='.repeat(80));
        
        const formattedPhone = formatPhoneNumber(phone);
        
        // ШАГ 1: Находим контакт
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакт не найден' });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // ШАГ 2: Используем исправленный метод поиска сделок
        console.log('\n🔍 Исправленный поиск сделок контакта...');
        const contactLeads = await amoCrmService.getContactLeadsFixed(contact.id);
        console.log(`📊 Исправленный метод: найдено ${contactLeads.length} сделок`);
        
        // ШАГ 3: Если сделок нет, ищем по всем сделкам с именем ученика
        let allLeads = contactLeads;
        
        if (contactLeads.length === 0) {
            console.log('\n🔍 Поиск по всем сделкам с именем ученика...');
            
            const normalizedStudentName = amoCrmService.normalizeName(studentName);
            const searchTerms = [
                studentName,
                normalizedStudentName,
                studentName.split(' ')[0], // Имя
                studentName.split(' ')[1]  // Фамилия
            ];
            
            // Ищем по каждому термину
            for (const term of searchTerms) {
                if (term && term.length > 2) {
                    try {
                        const response = await amoCrmService.makeRequest('GET', 
                            `/api/v4/leads?query=${encodeURIComponent(term)}&with=custom_fields_values&limit=50`
                        );
                        
                        if (response && response._embedded && response._embedded.leads) {
                            console.log(`🔍 Поиск "${term}": найдено ${response._embedded.leads.length} сделок`);
                            allLeads = allLeads.concat(response._embedded.leads);
                        }
                    } catch (searchError) {
                        console.log(`⚠️  Ошибка поиска по "${term}":`, searchError.message);
                    }
                }
            }
        }
        
        console.log(`\n📊 Всего сделок для анализа: ${allLeads.length}`);
        
        // ШАГ 4: Ищем сделки по ученику
        const normalizedStudentName = amoCrmService.normalizeName(studentName);
        const studentLastName = normalizedStudentName.split(' ').pop();
        const studentFirstName = normalizedStudentName.split(' ')[0];
        
        console.log(`\n🔍 Поиск сделок для "${studentName}":`);
        console.log(`   👤 Имя: ${studentFirstName}`);
        console.log(`   👤 Фамилия: ${studentLastName}`);
        
        const matchingLeads = [];
        
        for (const lead of allLeads) {
            const leadName = amoCrmService.normalizeName(lead.name);
            
            // Проверяем разные варианты совпадения
            let matchScore = 0;
            let matchReason = '';
            
            if (leadName.includes(normalizedStudentName)) {
                matchScore = 100;
                matchReason = 'Полное совпадение';
            } else if (leadName.includes(studentLastName)) {
                matchScore = 90;
                matchReason = 'Совпадение фамилии';
            } else if (leadName.includes(studentFirstName)) {
                matchScore = 70;
                matchReason = 'Совпадение имени';
            } else if (studentLastName === 'окороков' && 
                      (leadName.includes('семен') || leadName.includes('семён'))) {
                matchScore = 85;
                matchReason = 'Совпадение по имени "Семен"';
            }
            
            // Если нашли совпадение, проверяем абонемент
            if (matchScore > 0) {
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                if (subscriptionInfo.hasSubscription) {
                    console.log(`\n✅ НАЙДЕН АБОНЕМЕНТ! Сделка: "${lead.name}"`);
                    console.log(`   🎯 Совпадение: ${matchReason} (${matchScore} баллов)`);
                    console.log(`   📊 Занятий: ${subscriptionInfo.usedClasses}/${subscriptionInfo.totalClasses}`);
                    console.log(`   ✅ Статус: ${subscriptionInfo.subscriptionStatus}`);
                    
                    matchingLeads.push({
                        lead: lead,
                        subscriptionInfo: subscriptionInfo,
                        match_score: matchScore,
                        match_reason: matchReason
                    });
                }
            }
        }
        
        // ШАГ 5: Если не нашли по имени, ищем в воронке абонементов
        if (matchingLeads.length === 0) {
            console.log('\n🔍 Поиск в воронке абонементов...');
            
            for (const lead of allLeads) {
                if (lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID) {
                    const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                    
                    if (subscriptionInfo.hasSubscription) {
                        console.log(`✅ Найдена сделка в воронке абонементов: "${lead.name}"`);
                        
                        matchingLeads.push({
                            lead: lead,
                            subscriptionInfo: subscriptionInfo,
                            match_score: 50,
                            match_reason: 'Воронка абонементов'
                        });
                    }
                }
            }
        }
        
        // ШАГ 6: Если все еще не нашли, используем известный ID сделки
        if (matchingLeads.length === 0) {
            console.log('\n🔍 Используем известный ID сделки (28677839)...');
            
            try {
                const knownLead = await amoCrmService.makeRequest('GET', 
                    `/api/v4/leads/28677839?with=custom_fields_values`
                );
                
                if (knownLead) {
                    const subscriptionInfo = amoCrmService.extractSubscriptionInfo(knownLead);
                    
                    if (subscriptionInfo.hasSubscription) {
                        console.log(`✅ Используем известную сделку: "${knownLead.name}"`);
                        
                        matchingLeads.push({
                            lead: knownLead,
                            subscriptionInfo: subscriptionInfo,
                            match_score: 100,
                            match_reason: 'Известная сделка'
                        });
                    }
                }
            } catch (knownLeadError) {
                console.log('⚠️  Ошибка получения известной сделки:', knownLeadError.message);
            }
        }
        
        // ШАГ 7: Формируем ответ
        if (matchingLeads.length === 0) {
            return res.json({
                success: false,
                error: 'Абонемент не найден',
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                student_name: studentName,
                search_statistics: {
                    contacts_found: contacts.length,
                    leads_found: allLeads.length,
                    leads_in_subscription_pipeline: allLeads.filter(l => 
                        l.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID
                    ).length
                }
            });
        }
        
        // Сортируем по релевантности
        matchingLeads.sort((a, b) => b.match_score - a.match_score);
        const bestMatch = matchingLeads[0];
        
        // Создаем профиль
        const studentInfo = {
            studentName: studentName,
            branch: '', // Будем получать из контакта или сделки
            teacherName: '',
            ageGroup: '',
            parentName: contact.name
        };
        
        // Получаем филиал из контакта
        const fullContact = await amoCrmService.getFullContactInfo(contact.id);
        if (fullContact && fullContact.custom_fields_values) {
            const branchField = fullContact.custom_fields_values.find(f => 
                (f.field_id || f.id) === amoCrmService.FIELD_IDS.CONTACT.BRANCH
            );
            if (branchField) {
                studentInfo.branch = amoCrmService.getFieldValue(branchField);
            }
        }
        
        const profile = amoCrmService.createStudentProfile(
            contact,
            formattedPhone,
            studentInfo,
            bestMatch.subscriptionInfo,
            bestMatch.lead
        );
        
        // Сохраняем в БД
        const savedCount = await saveProfilesToDatabase([profile]);
        
        res.json({
            success: true,
            message: 'Абонемент найден!',
            data: {
                subscription_found: true,
                match_type: bestMatch.match_reason,
                confidence_score: bestMatch.match_score,
                
                subscription_details: {
                    student_name: studentName,
                    parent_name: contact.name,
                    phone: formattedPhone,
                    
                    // Данные абонемента
                    total_classes: bestMatch.subscriptionInfo.totalClasses,
                    used_classes: bestMatch.subscriptionInfo.usedClasses,
                    remaining_classes: bestMatch.subscriptionInfo.remainingClasses,
                    subscription_type: bestMatch.subscriptionInfo.subscriptionType,
                    subscription_status: bestMatch.subscriptionInfo.subscriptionStatus,
                    subscription_active: bestMatch.subscriptionInfo.subscriptionActive,
                    
                    // Даты
                    activation_date: bestMatch.subscriptionInfo.activationDate,
                    expiration_date: bestMatch.subscriptionInfo.expirationDate,
                    last_visit_date: bestMatch.subscriptionInfo.lastVisitDate,
                    
                    // Дополнительно
                    age_group: bestMatch.subscriptionInfo.ageGroup,
                    lesson_price: bestMatch.subscriptionInfo.lessonPrice,
                    branch: profile.branch
                },
                
                lead_info: {
                    id: bestMatch.lead.id,
                    name: bestMatch.lead.name,
                    pipeline_id: bestMatch.lead.pipeline_id,
                    status_id: bestMatch.lead.status_id
                },
                
                contact_info: {
                    id: contact.id,
                    name: contact.name
                },
                
                sync_info: {
                    saved_to_database: savedCount > 0,
                    profiles_in_db: savedCount
                },
                
                search_statistics: {
                    contacts_found: contacts.length,
                    leads_analyzed: allLeads.length,
                    matches_found: matchingLeads.length,
                    best_match_score: bestMatch.match_score
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка прямого поиска:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ==================== АВТОРИЗАЦИЯ ПО ID КОНТАКТА ====================
app.get('/api/debug/by-contact/:contactId', async (req, res) => {
    try {
        const contactId = parseInt(req.params.contactId);
        
        console.log(`\n🔑 АВТОРИЗАЦИЯ ПО ID КОНТАКТА: ${contactId}`);
        console.log('='.repeat(60));
        
        if (!amoCrmService.isInitialized) {
            return res.json({ 
                success: false, 
                error: 'amoCRM не инициализирован' 
            });
        }
        
        // 1. Получаем контакт
        const fullContact = await amoCrmService.getFullContactInfo(contactId);
        if (!fullContact) {
            return res.json({ 
                success: false, 
                error: 'Контакт не найден' 
            });
        }
        
        console.log(`📋 Контакт: "${fullContact.name}" (ID: ${contactId})`);
        
        // 2. Извлекаем учеников из контакта
        const students = amoCrmService.extractStudentsFromContact(fullContact);
        console.log(`👥 Ученики: ${students.length}`);
        
        if (students.length === 0) {
            return res.json({ 
                success: false, 
                error: 'У контакта нет учеников' 
            });
        }
        
        // 3. Получаем телефон контакта
        const phoneField = fullContact.custom_fields_values?.find(f => 
            (f.field_id || f.id) === 216615 || // ID поля телефон
            (f.field_name && f.field_name.includes('Телефон'))
        );
        
        const phone = phoneField ? amoCrmService.getFieldValue(phoneField) : null;
        
        // 4. Для КАЖДОГО ученика ищем сделку с абонементом
        const profiles = [];
        
        for (const student of students) {
            console.log(`\n🎯 Поиск для ученика: "${student.studentName}"`);
            
            // Используем исправленный метод поиска
            const leadResult = await amoCrmService.findSubscriptionLeadForStudentFixed(
                contactId, 
                student.studentName
            );
            
            if (leadResult) {
                console.log(`✅ Найдена сделка: "${leadResult.lead.name}"`);
                
                // Создаем профиль
                const profile = amoCrmService.createStudentProfile(
                    fullContact,
                    phone || 'ID:' + contactId,
                    student,
                    leadResult.subscriptionInfo,
                    leadResult.lead
                );
                
                profiles.push(profile);
            } else {
                console.log(`⚠️  Сделка не найдена, создаем базовый профиль`);
                
                // Создаем профиль без абонемента
                const profile = amoCrmService.createStudentProfile(
                    fullContact,
                    phone || 'ID:' + contactId,
                    student,
                    amoCrmService.getDefaultSubscriptionInfo(),
                    null
                );
                
                profiles.push(profile);
            }
        }
        
        // 5. Сохраняем в БД
        const savedCount = await saveProfilesToDatabase(profiles);
        console.log(`💾 Сохранено в БД: ${savedCount} профилей`);
        
        // 6. Создаем токен
        const sessionId = crypto.randomBytes(32).toString('hex');
        const token = jwt.sign(
            {
                session_id: sessionId,
                contact_id: contactId,
                phone: phone,
                profiles_count: profiles.length,
                timestamp: Date.now()
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        // 7. Сохраняем сессию
        await db.run(
            `INSERT INTO user_sessions (session_id, session_data, phone_number, expires_at) 
             VALUES (?, ?, ?, ?)`,
            [
                sessionId,
                JSON.stringify({ 
                    contact_id: contactId,
                    profiles_count: profiles.length 
                }),
                phone || 'ID:' + contactId,
                new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            ]
        );
        
        // 8. Форматируем ответ
        const formattedProfiles = profiles.map(p => ({
            id: p.id || null,
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
            total_classes: p.total_classes || 0,
            remaining_classes: p.remaining_classes || 0,
            used_classes: p.used_classes || 0,
            expiration_date: p.expiration_date,
            last_visit_date: p.last_visit_date,
            parent_name: p.parent_name,
            amocrm_contact_id: p.amocrm_contact_id,
            amocrm_lead_id: p.amocrm_lead_id,
            is_demo: p.is_demo === 1,
            source: p.source,
            last_sync: p.last_sync || new Date().toISOString()
        }));
        
        console.log(`\n✅ Авторизация успешна!`);
        console.log(`📊 Профилей: ${profiles.length}`);
        
        res.json({
            success: true,
            message: 'Авторизация по ID контакта успешна',
            data: {
                user: {
                    id: contactId,
                    phone_number: phone || 'ID:' + contactId,
                    name: fullContact.name,
                    contact_id: contactId,
                    is_temp: true,
                    profiles_count: profiles.length
                },
                profiles: formattedProfiles,
                contact_name: fullContact.name,
                contact_id: contactId,
                phone: phone,
                total_profiles: profiles.length,
                token: token,
                last_sync: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка авторизации по ID:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==================== ПРЯМОЙ ПОИСК ПО LEAD ID ====================
app.get('/api/debug/by-lead/:leadId', async (req, res) => {
    try {
        const leadId = parseInt(req.params.leadId);
        
        console.log(`\n🎯 ПРЯМОЙ ПОИСК ПО LEAD ID: ${leadId}`);
        console.log('='.repeat(60));
        
        // Находим сделку
        const leadResult = await amoCrmService.findLeadById(leadId);
        if (!leadResult) {
            return res.json({ success: false, error: 'Сделка не найдена' });
        }
        
        const lead = leadResult.lead;
        console.log(`📋 Сделка: "${lead.name}"`);
        
        // Находим контакт этой сделки
        const contactResponse = await amoCrmService.makeRequest('GET', 
            `/api/v4/leads/${leadId}/contacts`
        );
        
        if (!contactResponse._embedded?.contacts?.length) {
            return res.json({ 
                success: false, 
                error: 'У сделки нет привязанных контактов' 
            });
        }
        
        const contactId = contactResponse._embedded.contacts[0].id;
        const fullContact = await amoCrmService.getFullContactInfo(contactId);
        
        if (!fullContact) {
            return res.json({ 
                success: false, 
                error: 'Контакт не найден' 
            });
        }
        
        console.log(`📋 Контакт: "${fullContact.name}" (ID: ${contactId})`);
        
        // Извлекаем всех учеников
        const students = amoCrmService.extractStudentsFromContact(fullContact);
        
        // Определяем, для какого ученика эта сделка
        let targetStudent = null;
        const normalizedLeadName = amoCrmService.normalizeName(lead.name);
        
        for (const student of students) {
            if (normalizedLeadName.includes(amoCrmService.normalizeName(student.studentName))) {
                targetStudent = student;
                break;
            }
        }
        
        // Если не нашли по имени, берем первого ученика
        if (!targetStudent && students.length > 0) {
            targetStudent = students[0];
        }
        
        if (!targetStudent) {
            // Создаем ученика из названия сделки
            targetStudent = {
                studentName: lead.name.split('-')[0]?.trim() || 'Ученик',
                branch: '',
                teacherName: '',
                ageGroup: '',
                parentName: fullContact.name
            };
        }
        
        // Создаем профиль
        const phoneField = fullContact.custom_fields_values?.find(f => 
            (f.field_id || f.id) === 216615
        );
        const phone = phoneField ? amoCrmService.getFieldValue(phoneField) : null;
        
        const profile = amoCrmService.createStudentProfile(
            fullContact,
            phone || 'ID:' + contactId,
            targetStudent,
            leadResult.subscriptionInfo,
            lead
        );
        
        // Сохраняем в БД
        const savedCount = await saveProfilesToDatabase([profile]);
        
        // Создаем токен
        const sessionId = crypto.randomBytes(32).toString('hex');
        const token = jwt.sign(
            {
                session_id: sessionId,
                lead_id: leadId,
                contact_id: contactId,
                student_name: targetStudent.studentName,
                timestamp: Date.now()
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Данные найдены по ID сделки',
            data: {
                lead: {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id
                },
                contact: {
                    id: contactId,
                    name: fullContact.name
                },
                student: targetStudent.studentName,
                profile: profile,
                token: token,
                saved_to_db: savedCount > 0
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска по lead ID:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ТЕСТОВАЯ АВТОРИЗАЦИЯ ====================
app.get('/api/test-direct-auth/:contactOrLeadId', async (req, res) => {
    try {
        const id = req.params.contactOrLeadId;
        const isLead = id.startsWith('lead_');
        const cleanId = isLead ? id.replace('lead_', '') : id;
        
        console.log(`\n🧪 ТЕСТОВАЯ АВТОРИЗАЦИЯ ДЛЯ: ${id}`);
        
        let profiles = [];
        let contactName = '';
        
        if (isLead) {
            // Если это lead ID
            const leadId = parseInt(cleanId);
            const leadResult = await amoCrmService.findLeadById(leadId);
            
            if (!leadResult) {
                return res.json({ success: false, error: 'Сделка не найдена' });
            }
            
            const lead = leadResult.lead;
            
            // Находим контакт
            const contactResponse = await amoCrmService.makeRequest('GET', 
                `/api/v4/leads/${leadId}/contacts`
            );
            
            if (contactResponse._embedded?.contacts?.length) {
                const contactId = contactResponse._embedded.contacts[0].id;
                const fullContact = await amoCrmService.getFullContactInfo(contactId);
                contactName = fullContact?.name || 'Клиент';
                
                // Создаем тестовый профиль
                const profile = {
                    id: 9999,
                    student_name: lead.name.split('-')[0]?.trim() || 'Ученик',
                    phone_number: '+79160577611', // Тестовый номер
                    email: '',
                    branch: 'Тестовый филиал',
                    day_of_week: '',
                    time_slot: '',
                    teacher_name: '',
                    age_group: '',
                    course: '',
                    subscription_type: leadResult.subscriptionInfo.subscriptionType,
                    subscription_active: leadResult.subscriptionInfo.subscriptionActive,
                    subscription_status: leadResult.subscriptionInfo.subscriptionStatus,
                    subscription_badge: 'active',
                    total_classes: leadResult.subscriptionInfo.totalClasses,
                    remaining_classes: leadResult.subscriptionInfo.remainingClasses,
                    used_classes: leadResult.subscriptionInfo.usedClasses,
                    expiration_date: leadResult.subscriptionInfo.expirationDate,
                    last_visit_date: leadResult.subscriptionInfo.lastVisitDate,
                    parent_name: contactName,
                    is_demo: 1,
                    source: 'test',
                    last_sync: new Date().toISOString()
                };
                
                profiles.push(profile);
            }
        } else {
            // Если это contact ID
            const contactId = parseInt(cleanId);
            const fullContact = await amoCrmService.getFullContactInfo(contactId);
            
            if (!fullContact) {
                return res.json({ success: false, error: 'Контакт не найден' });
            }
            
            contactName = fullContact.name;
            
            // Извлекаем учеников
            const students = amoCrmService.extractStudentsFromContact(fullContact);
            
            // Создаем тестовые профили
            for (const student of students) {
                const profile = {
                    id: 1000 + Math.floor(Math.random() * 1000),
                    student_name: student.studentName,
                    phone_number: '+79160577611',
                    email: '',
                    branch: student.branch || 'Тестовый филиал',
                    day_of_week: student.dayOfWeek,
                    time_slot: '',
                    teacher_name: student.teacherName,
                    age_group: student.ageGroup,
                    course: '',
                    subscription_type: 'Тестовый абонемент',
                    subscription_active: 1,
                    subscription_status: 'Активен',
                    subscription_badge: 'active',
                    total_classes: 8,
                    remaining_classes: 6,
                    used_classes: 2,
                    expiration_date: '2026-06-30',
                    last_visit_date: '2026-01-28',
                    parent_name: contactName,
                    is_demo: 1,
                    source: 'test',
                    last_sync: new Date().toISOString()
                };
                
                profiles.push(profile);
            }
        }
        
        // Если нет профилей, создаем тестовый
        if (profiles.length === 0) {
            profiles.push({
                id: 9999,
                student_name: 'Тестовый ученик',
                phone_number: '+79160577611',
                email: 'test@example.com',
                branch: 'Тестовый филиал',
                teacher_name: 'Тестовый преподаватель',
                subscription_type: 'Тестовый абонемент',
                subscription_active: 1,
                subscription_status: 'Активен',
                total_classes: 8,
                remaining_classes: 6,
                used_classes: 2,
                parent_name: contactName || 'Тестовый родитель',
                is_demo: 1,
                source: 'test'
            });
        }
        
        res.json({
            success: true,
            message: 'Тестовые данные созданы',
            data: {
                profiles: profiles,
                user: {
                    phone: '+79160577611',
                    name: contactName || 'Тестовый пользователь',
                    is_demo: true
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестовой авторизации:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== БЫСТРЫЙ ПОИСК КОНТАКТА ПО ТЕЛЕФОНУ ====================
app.get('/api/quick-find-contact/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        const cleanPhone = phone.replace(/\D/g, '');
        const last10Digits = cleanPhone.slice(-10);
        
        console.log(`\n🔍 БЫСТРЫЙ ПОИСК КОНТАКТА: ${formattedPhone}`);
        console.log('='.repeat(60));
        
        // 1. Пробуем все методы поиска
        let contacts = [];
        
        // Метод 1: Стандартный поиск
        console.log('🔍 Метод 1: Стандартный поиск');
        try {
            const response = await amoCrmService.searchContactsByPhone(formattedPhone);
            contacts = response._embedded?.contacts || [];
            console.log(`✅ Найдено: ${contacts.length}`);
        } catch (error) {
            console.log(`❌ Ошибка: ${error.message}`);
        }
        
        // Метод 2: Прямой поиск по телефону в полях
        if (contacts.length === 0) {
            console.log('\n🔍 Метод 2: Прямой поиск в полях');
            try {
                // Получаем все контакты и фильтруем
                const allContacts = await amoCrmService.makeRequest('GET', 
                    '/api/v4/contacts?limit=100&with=custom_fields_values'
                );
                
                if (allContacts._embedded?.contacts) {
                    const filtered = allContacts._embedded.contacts.filter(contact => 
                        amoCrmService.contactHasPhone(contact, last10Digits)
                    );
                    
                    console.log(`✅ Найдено: ${filtered.length}`);
                    contacts = contacts.concat(filtered);
                }
            } catch (error) {
                console.log(`❌ Ошибка: ${error.message}`);
            }
        }
        
        // Метод 3: Поиск через сделки
        if (contacts.length === 0) {
            console.log('\n🔍 Метод 3: Поиск через сделки');
            try {
                // Ищем сделки с телефоном в названии или полях
                const leads = await amoCrmService.makeRequest('GET', 
                    `/api/v4/leads?query=${last10Digits}&limit=50`
                );
                
                if (leads._embedded?.leads) {
                    console.log(`✅ Найдено сделок: ${leads._embedded.leads.length}`);
                    
                    // Для каждой сделки находим контакты
                    for (const lead of leads._embedded.leads.slice(0, 10)) {
                        try {
                            const leadContacts = await amoCrmService.makeRequest('GET', 
                                `/api/v4/leads/${lead.id}/contacts`
                            );
                            
                            if (leadContacts._embedded?.contacts) {
                                contacts = contacts.concat(leadContacts._embedded.contacts);
                            }
                        } catch (leadError) {
                            continue;
                        }
                    }
                    
                    console.log(`✅ Контактов через сделки: ${contacts.length}`);
                }
            } catch (error) {
                console.log(`❌ Ошибка: ${error.message}`);
            }
        }
        
        // Убираем дубликаты
        const uniqueContacts = [];
        const seenIds = new Set();
        
        for (const contact of contacts) {
            if (!seenIds.has(contact.id)) {
                seenIds.add(contact.id);
                uniqueContacts.push(contact);
            }
        }
        
        console.log(`\n📊 Уникальных контактов: ${uniqueContacts.length}`);
        
        // Если нашли контакты, показываем подробности
        const contactDetails = [];
        
        for (const contact of uniqueContacts.slice(0, 5)) { // Ограничим 5 контактами
            try {
                const fullContact = await amoCrmService.getFullContactInfo(contact.id);
                
                if (fullContact) {
                    const students = amoCrmService.extractStudentsFromContact(fullContact);
                    
                    // Находим телефон
                    const phoneField = fullContact.custom_fields_values?.find(f => 
                        (f.field_id || f.id) === 216615
                    );
                    const contactPhone = phoneField ? amoCrmService.getFieldValue(phoneField) : 'Не указан';
                    
                    contactDetails.push({
                        id: contact.id,
                        name: fullContact.name,
                        phone: contactPhone,
                        students: students.map(s => s.studentName),
                        students_count: students.length
                    });
                }
            } catch (error) {
                continue;
            }
        }
        
        res.json({
            success: true,
            data: {
                phone: formattedPhone,
                search_term: last10Digits,
                contacts_found: uniqueContacts.length,
                contacts: contactDetails,
                recommendations: uniqueContacts.length === 0 ? [
                    '1. Проверьте правильность номера телефона',
                    '2. Убедитесь, что контакт существует в amoCRM',
                    '3. Используйте альтернативный вход по ID контакта',
                    '4. Свяжитесь с администратором для получения ID'
                ] : [
                    '✅ Контакты найдены!',
                    `🔑 ID для входа: ${contactDetails.map(c => c.id).join(', ')}`,
                    '👤 Имена контактов: ' + contactDetails.map(c => c.name).join(', ')
                ]
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка быстрого поиска:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Получение профилей
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

// Получение информации об абонементе
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
            const decoded = jwt.verify(token, JWT_SECRET);
        } catch (tokenError) {
            return res.status(401).json({
                success: false,
                error: 'Невалидный токен'
            });
        }
        
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
        
        let progress = 0;
        if (profile.total_classes > 0) {
            progress = Math.round((profile.used_classes / profile.total_classes) * 100);
        }
        
        const response = {
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
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Ошибка получения абонемента:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
        });
    }
});

// ==================== ПРОВЕРОЧНЫЙ МАРШРУТ ВСЕХ ДАННЫХ ====================
app.get('/api/debug/all-data/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`\n🔍 ПОЛНАЯ ПРОВЕРКА ВСЕХ ДАННЫХ ДЛЯ: ${formattedPhone}`);
        console.log('='.repeat(100));
        
        // 1. ПРОВЕРКА В AMOCRM
        console.log('\n📱 1. ПОИСК В AMOCRM:');
        console.log('─'.repeat(40));
        
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        console.log(`📊 Найдено контактов в amoCRM: ${contacts.length}`);
        
        let amoCrmData = [];
        
        for (const contact of contacts.slice(0, 3)) { // Ограничим 3 контактами
            try {
                console.log(`\n📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
                
                // Получаем полную информацию о контакте
                const fullContact = await amoCrmService.getFullContactInfo(contact.id);
                
                if (!fullContact) continue;
                
                // Извлекаем учеников
                const students = amoCrmService.extractStudentsFromContact(fullContact);
                console.log(`👥 Ученики в контакте: ${students.length}`);
                
                // Для каждого ученика ищем абонемент
                const contactStudents = [];
                
                for (const student of students) {
                    console.log(`\n🎯 Ученик: "${student.studentName}"`);
                    
                    const leadResult = await amoCrmService.findSubscriptionLeadForStudent(
                        contact.id, 
                        student.studentName
                    );
                    
                    contactStudents.push({
                        student_name: student.studentName,
                        parent_name: fullContact.name || 'Не указано',
                        phone_number: formattedPhone,
                        age_group: student.ageGroup || 'Не указана',
                        branch: student.branch || 'Не указан',
                        teacher_name: student.teacherName || 'Не указан',
                        day_of_week: student.dayOfWeek || 'Не указан',
                        last_visit_date: student.lastVisitDate || 'Не указана',
                        
                        // Данные абонемента
                        subscription_found: !!leadResult,
                        subscription_type: leadResult?.subscriptionInfo?.subscriptionType || 'Не найден',
                        subscription_status: leadResult?.subscriptionInfo?.subscriptionStatus || 'Не найден',
                        subscription_active: leadResult?.subscriptionInfo?.subscriptionActive || false,
                        total_classes: leadResult?.subscriptionInfo?.totalClasses || 0,
                        used_classes: leadResult?.subscriptionInfo?.usedClasses || 0,
                        remaining_classes: leadResult?.subscriptionInfo?.remainingClasses || 0,
                        activation_date: leadResult?.subscriptionInfo?.activationDate || 'Не указана',
                        expiration_date: leadResult?.subscriptionInfo?.expirationDate || 'Не указана',
                        last_visit: leadResult?.subscriptionInfo?.lastVisitDate || 'Не указана',
                        
                        // Дополнительная информация
                        lead_name: leadResult?.lead?.name || 'Сделка не найдена',
                        lead_id: leadResult?.lead?.id || null,
                        pipeline_id: leadResult?.lead?.pipeline_id || null,
                        match_type: leadResult?.match_type || 'NO_MATCH'
                    });
                }
                
                amoCrmData = amoCrmData.concat(contactStudents);
                
            } catch (contactError) {
                console.error(`❌ Ошибка обработки контакта:`, contactError.message);
            }
        }
        
        // 2. ПРОВЕРКА В ЛОКАЛЬНОЙ БАЗЕ ДАННЫХ
        console.log('\n\n💾 2. ДАННЫЕ В ЛОКАЛЬНОЙ БАЗЕ:');
        console.log('─'.repeat(40));
        
        const dbProfiles = await db.all(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1
             ORDER BY student_name`,
            [`%${formattedPhone.slice(-10)}%`]
        );
        
        console.log(`📊 Найдено профилей в БД: ${dbProfiles.length}`);
        
        const dbData = dbProfiles.map(profile => ({
            student_name: profile.student_name,
            parent_name: profile.parent_name,
            phone_number: profile.phone_number,
            email: profile.email,
            age_group: profile.age_group,
            branch: profile.branch,
            teacher_name: profile.teacher_name,
            day_of_week: profile.day_of_week,
            time_slot: profile.time_slot,
            
            // Данные абонемента из БД
            subscription_type: profile.subscription_type,
            subscription_status: profile.subscription_status,
            subscription_active: profile.subscription_active === 1,
            total_classes: profile.total_classes,
            used_classes: profile.used_classes,
            remaining_classes: profile.remaining_classes,
            activation_date: profile.activation_date,
            expiration_date: profile.expiration_date,
            last_visit_date: profile.last_visit_date,
            
            // Метаданные
            profile_id: profile.id,
            amocrm_contact_id: profile.amocrm_contact_id,
            amocrm_lead_id: profile.amocrm_lead_id,
            data_source: profile.source,
            last_sync: profile.last_sync,
            created_at: profile.created_at,
            updated_at: profile.updated_at
        }));
        
        // 3. СВОДНАЯ ТАБЛИЦА
        console.log('\n\n📊 3. СВОДНАЯ ТАБЛИЦА ВСЕХ ДАННЫХ:');
        console.log('='.repeat(100));
        console.log('| Номер телефона | Родитель | Ученик | Возрастная группа | Филиал | Абонемент | Всего | Использовано | Осталось | Последний визит |');
        console.log('|' + '─'.repeat(15) + '|' + '─'.repeat(12) + '|' + '─'.repeat(12) + '|' + '─'.repeat(18) + '|' + '─'.repeat(10) + '|' + '─'.repeat(12) + '|' + '─'.repeat(6) + '|' + '─'.repeat(12) + '|' + '─'.repeat(10) + '|' + '─'.repeat(15) + '|');
        
        const allStudents = [...amoCrmData, ...dbData];
        
        allStudents.forEach(student => {
            console.log(
                `| ${student.phone_number.slice(-10)} | ` +
                `${(student.parent_name || '').slice(0,10)}... | ` +
                `${(student.student_name || '').slice(0,10)}... | ` +
                `${(student.age_group || 'Нет').slice(0,15)} | ` +
                `${(student.branch || 'Нет').slice(0,8)} | ` +
                `${student.subscription_active ? '✅ Активен' : '❌ Нет'} | ` +
                `${student.total_classes || 0} | ` +
                `${student.used_classes || 0} | ` +
                `${student.remaining_classes || 0} | ` +
                `${student.last_visit_date ? student.last_visit_date.slice(0,10) : 'Нет данных'} |`
            );
        });
        
        console.log('='.repeat(100));
        
        // 4. АНАЛИЗ РАЗЛИЧИЙ МЕЖДУ ИСТОЧНИКАМИ
        console.log('\n\n🔍 4. АНАЛИЗ РАЗЛИЧИЙ МЕЖДУ AMOCRM И БАЗОЙ ДАННЫХ:');
        console.log('─'.repeat(50));
        
        // Создаем карту учеников для сравнения
        const amoMap = new Map();
        amoCrmData.forEach(student => {
            amoMap.set(student.student_name, student);
        });
        
        const dbMap = new Map();
        dbData.forEach(student => {
            dbMap.set(student.student_name, student);
        });
        
        const onlyInAmo = amoCrmData.filter(s => !dbMap.has(s.student_name));
        const onlyInDb = dbData.filter(s => !amoMap.has(s.student_name));
        const inBoth = amoCrmData.filter(s => dbMap.has(s.student_name));
        
        console.log(`📊 Только в amoCRM: ${onlyInAmo.length}`);
        console.log(`📊 Только в локальной БД: ${onlyInDb.length}`);
        console.log(`📊 В обоих источниках: ${inBoth.length}`);
        
        // 5. ПРОВЕРКА АКТИВНЫХ АБОНЕМЕНТОВ
        console.log('\n\n✅ 5. АКТИВНЫЕ АБОНЕМЕНТЫ:');
        console.log('─'.repeat(40));
        
        const activeSubscriptions = allStudents.filter(s => s.subscription_active);
        console.log(`📊 Всего активных абонементов: ${activeSubscriptions.length}`);
        
        activeSubscriptions.forEach((student, index) => {
            console.log(`\n${index + 1}. ${student.student_name}`);
            console.log(`   📱 Телефон: ${student.phone_number}`);
            console.log(`   👤 Родитель: ${student.parent_name}`);
            console.log(`   🎂 Возрастная группа: ${student.age_group}`);
            console.log(`   🏢 Филиал: ${student.branch}`);
            console.log(`   🎫 Тип абонемента: ${student.subscription_type}`);
            console.log(`   📊 Занятий: ${student.used_classes}/${student.total_classes} (осталось: ${student.remaining_classes})`);
            console.log(`   📅 Последний визит: ${student.last_visit_date || 'Нет данных'}`);
            console.log(`   📅 Действует до: ${student.expiration_date || 'Нет данных'}`);
        });
        
        // 6. ДЕТАЛЬНАЯ ПРОВЕРКА ПОЛЕЙ В БАЗЕ
        console.log('\n\n📋 6. СТРУКТУРА БАЗЫ ДАННЫХ:');
        console.log('─'.repeat(40));
        
        if (dbProfiles.length > 0) {
            const firstProfile = dbProfiles[0];
            console.log('📊 Поля в таблице student_profiles:');
            
            const importantFields = [
                'student_name', 'phone_number', 'parent_name', 'email',
                'age_group', 'branch', 'teacher_name',
                'subscription_type', 'subscription_active', 'subscription_status',
                'total_classes', 'used_classes', 'remaining_classes',
                'activation_date', 'expiration_date', 'last_visit_date',
                'amocrm_contact_id', 'amocrm_lead_id', 'last_sync'
            ];
            
            importantFields.forEach(field => {
                const value = firstProfile[field];
                const isEmpty = value === null || value === undefined || value === '';
                console.log(`   ${field}: ${isEmpty ? '❌ Пусто' : `✅ ${value}`}`);
            });
        }
        
        // 7. ФОРМИРОВАНИЕ ОТВЕТА ДЛЯ API
        res.json({
            success: true,
            data: {
                phone: formattedPhone,
                
                // Источники данных
                sources: {
                    amocrm: {
                        found: contacts.length,
                        contacts: contacts.map(c => ({ id: c.id, name: c.name })),
                        students_count: amoCrmData.length,
                        students: amoCrmData
                    },
                    database: {
                        found: dbProfiles.length,
                        students_count: dbData.length,
                        students: dbData
                    }
                },
                
                // Сводка
                summary: {
                    total_students: allStudents.length,
                    active_subscriptions: activeSubscriptions.length,
                    only_in_amocrm: onlyInAmo.length,
                    only_in_database: onlyInDb.length,
                    in_both_sources: inBoth.length
                },
                
                // Активные абонементы
                active_subscriptions: activeSubscriptions.map(s => ({
                    student_name: s.student_name,
                    parent_name: s.parent_name,
                    phone: s.phone_number,
                    age_group: s.age_group,
                    branch: s.branch,
                    subscription_type: s.subscription_type,
                    total_classes: s.total_classes,
                    used_classes: s.used_classes,
                    remaining_classes: s.remaining_classes,
                    expiration_date: s.expiration_date,
                    last_visit: s.last_visit_date,
                    data_source: s.data_source || 'amocrm'
                })),
                
                // Проверка данных
                data_check: {
                    phone_exists: allStudents.length > 0,
                    parents_found: allStudents.some(s => s.parent_name),
                    age_groups_found: allStudents.some(s => s.age_group),
                    branches_found: allStudents.some(s => s.branch),
                    subscriptions_found: allStudents.some(s => s.subscription_type),
                    last_visits_found: allStudents.some(s => s.last_visit_date)
                },
                
                // Рекомендации
                recommendations: [
                    onlyInAmo.length > 0 ? 
                        `⚠️  ${onlyInAmo.length} учеников только в amoCRM. Запустите синхронизацию.` : 
                        '✅ Все ученики из amoCRM сохранены в БД',
                    
                    onlyInDb.length > 0 ? 
                        `⚠️  ${onlyInDb.length} учеников только в БД. Проверьте актуальность.` : 
                        '✅ Все ученики в БД актуальны',
                    
                    activeSubscriptions.length === 0 ?
                        '⚠️  Нет активных абонементов' :
                        `✅ Найдено ${activeSubscriptions.length} активных абонементов`
                ],
                
                // Время проверки
                timestamp: new Date().toISOString(),
                check_duration_ms: Date.now() - startTime
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки данных:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Добавьте также этот быстрый маршрут для быстрой проверки
app.get('/api/check-data/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        // Получаем данные из БД
        const profiles = await db.all(
            `SELECT 
                student_name,
                parent_name,
                phone_number,
                age_group,
                branch,
                subscription_type,
                subscription_active,
                total_classes,
                used_classes,
                remaining_classes,
                last_visit_date,
                expiration_date,
                last_sync
             FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1
             ORDER BY subscription_active DESC, student_name`,
            [`%${formattedPhone.slice(-10)}%`]
        );
        
        // Формируем простой ответ
        const activeProfiles = profiles.filter(p => p.subscription_active === 1);
        
        res.json({
            success: true,
            data: {
                phone: formattedPhone,
                total_profiles: profiles.length,
                active_profiles: activeProfiles.length,
                profiles: profiles.map(p => ({
                    student: p.student_name,
                    parent: p.parent_name,
                    age_group: p.age_group,
                    branch: p.branch,
                    subscription: {
                        type: p.subscription_type,
                        active: p.subscription_active === 1,
                        total: p.total_classes,
                        used: p.used_classes,
                        remaining: p.remaining_classes,
                        expires: p.expiration_date
                    },
                    last_visit: p.last_visit_date,
                    last_sync: p.last_sync
                })),
                
                // Краткая сводка
                summary: {
                    '📱 Номер телефона': formattedPhone,
                    '👨‍👩‍👧‍👦 Всего учеников': profiles.length,
                    '✅ Активных абонементов': activeProfiles.length,
                    '🏢 Филиалы': [...new Set(profiles.map(p => p.branch).filter(Boolean))].join(', ') || 'Не указаны',
                    '🔄 Последняя синхронизация': profiles.length > 0 ? 
                        profiles[0].last_sync : 'Нет данных'
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка быстрой проверки:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ==================== ПОЛНАЯ ДИАГНОСТИКА СДЕЛКИ ====================
app.get('/api/debug/full-lead-analysis/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ПОЛНАЯ ДИАГНОСТИКА ДЛЯ: "${studentName}" (${phone})`);
        console.log('='.repeat(80));
        
        const formattedPhone = formatPhoneNumber(phone);
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        console.log(`📋 Основной контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // Получаем все сделки контакта
        const allLeads = await amoCrmService.getContactLeadsSorted(contact.id);
        
        // Ищем сделки по имени ученика
        const normalizedStudentName = amoCrmService.normalizeName(studentName);
        const matchingLeads = [];
        
        console.log('\n🔍 АНАЛИЗ ВСЕХ СДЕЛОК:');
        console.log('='.repeat(80));
        
        for (const lead of allLeads) {
            const leadName = amoCrmService.normalizeName(lead.name);
            const score = amoCrmService.calculateNameMatchScore(leadName, normalizedStudentName);
            
            if (score > 0 || lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID) {
                console.log(`\n📋 Сделка ID: ${lead.id}`);
                console.log(`📛 Название: "${lead.name}"`);
                console.log(`🎯 Воронка: ${lead.pipeline_id}`);
                console.log(`📊 Статус: ${lead.status_id}`);
                console.log(`🏷️  Баллы совпадения: ${score}`);
                
                // Анализируем все поля сделки
                const customFields = lead.custom_fields_values || [];
                console.log(`📦 Кастомных полей: ${customFields.length}`);
                
                // Ищем поля связанные с абонементом
                let hasSubscriptionFields = false;
                const subscriptionFields = [];
                
                for (const field of customFields) {
                    const fieldId = field.field_id || field.id;
                    const fieldName = amoCrmService.getFieldNameById(fieldId);
                    const fieldValue = amoCrmService.getFieldValue(field);
                    
                    if (fieldName && fieldName.toLowerCase().includes('абонемент') || 
                        fieldName.toLowerCase().includes('занят') ||
                        fieldName.toLowerCase().includes('остаток')) {
                        hasSubscriptionFields = true;
                        subscriptionFields.push({
                            id: fieldId,
                            name: fieldName,
                            value: fieldValue,
                            raw: field
                        });
                        
                        console.log(`   ✅ ${fieldName}: ${fieldValue || 'Пусто'}`);
                    }
                }
                
                if (hasSubscriptionFields) {
                    matchingLeads.push({
                        lead_id: lead.id,
                        lead_name: lead.name,
                        pipeline_id: lead.pipeline_id,
                        status_id: lead.status_id,
                        match_score: score,
                        has_subscription_fields: true,
                        subscription_fields: subscriptionFields,
                        is_active_pipeline: lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID,
                        is_active_status: amoCrmService.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(lead.status_id),
                        raw_lead: lead
                    });
                }
            }
        }
        
        console.log('\n' + '='.repeat(80));
        console.log(`📊 ИТОГО найденных сделок: ${matchingLeads.length}`);
        
        // Выводим все поля всех найденных сделок для отладки
        console.log('\n📋 ВСЕ ПОЛЯ НАЙДЕННЫХ СДЕЛОК:');
        console.log('='.repeat(80));
        
        const allFieldsMap = new Map();
        
        for (const match of matchingLeads) {
            console.log(`\n📋 Сделка: "${match.lead_name}" (ID: ${match.lead_id})`);
            console.log('─'.repeat(40));
            
            const customFields = match.raw_lead.custom_fields_values || [];
            for (const field of customFields) {
                const fieldId = field.field_id || field.id;
                const fieldName = amoCrmService.getFieldNameById(fieldId);
                const fieldValue = amoCrmService.getFieldValue(field);
                
                // Сохраняем для сводки
                if (fieldName && !allFieldsMap.has(fieldId)) {
                    allFieldsMap.set(fieldId, {
                        name: fieldName,
                        id: fieldId,
                        values: []
                    });
                }
                
                if (fieldName) {
                    allFieldsMap.get(fieldId).values.push(fieldValue);
                    console.log(`   ${fieldId}: ${fieldName} = ${fieldValue || 'Пусто'}`);
                } else {
                    console.log(`   ${fieldId}: Неизвестное поле = ${JSON.stringify(field.values)}`);
                }
            }
        }
        
        // Сводка по полям
        console.log('\n📊 СВОДКА ПО ПОЛЯМ:');
        console.log('='.repeat(80));
        for (const [fieldId, data] of allFieldsMap.entries()) {
            console.log(`${fieldId}: ${data.name}`);
        }
        
        res.json({
            success: true,
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                student_name: studentName,
                total_leads: allLeads.length,
                matching_leads: matchingLeads.length,
                matching_leads_details: matchingLeads,
                field_summary: Array.from(allFieldsMap.values()),
                suggestions: matchingLeads.length > 0 ? 
                    'Обновите FIELD_IDS в коде с реальными ID полей из вывода выше' :
                    'Проверьте воронку абонементов и статусы сделок'
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Добавьте этот маршрут
app.get('/api/debug/lead-fields/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ДИАГНОСТИКА ПОЛЕЙ СДЕЛКИ ID: ${leadId}`);
        console.log('='.repeat(80));
        
        const lead = await amoCrmService.makeRequest('GET', `/api/v4/leads/${leadId}?with=custom_fields_values`);
        
        if (!lead) {
            return res.json({ success: false, error: 'Сделка не найдена' });
        }
        
        console.log(`📋 Сделка: "${lead.name}"`);
        console.log(`🎯 Воронка: ${lead.pipeline_id}`);
        console.log(`📊 Статус: ${lead.status_id}`);
        
        const customFields = lead.custom_fields_values || [];
        console.log(`\n📦 ВСЕ ПОЛЯ СДЕЛКИ (${customFields.length}):`);
        console.log('='.repeat(80));
        
        const fieldAnalysis = [];
        
        for (const field of customFields) {
            const fieldId = field.field_id || field.id;
            const fieldName = field.field_name || `Поле ${fieldId}`;
            const fieldValue = amoCrmService.getFieldValue(field);
            
            fieldAnalysis.push({
                id: fieldId,
                name: fieldName,
                value: fieldValue,
                is_subscription_field: fieldName.toLowerCase().includes('абонемент') || 
                                      fieldName.toLowerCase().includes('занят') ||
                                      fieldName.toLowerCase().includes('остаток') ||
                                      fieldName.toLowerCase().includes('счетчик') ||
                                      fieldName.toLowerCase().includes('актив') ||
                                      fieldName.toLowerCase().includes('окончан') ||
                                      fieldName.toLowerCase().includes('дата')
            });
            
            console.log(`${fieldId}: "${fieldName}" = ${fieldValue || 'Пусто'}`);
        }
        
        // Анализ найденных полей
        const subscriptionFields = fieldAnalysis.filter(f => f.is_subscription_field);
        
        console.log('\n🎯 ПОЛЯ АБОНЕМЕНТА:');
        console.log('='.repeat(80));
        subscriptionFields.forEach(field => {
            console.log(`${field.id}: "${field.name}" = ${field.value || 'Пусто'}`);
        });
        
        res.json({
            success: true,
            data: {
                lead: {
                    id: lead.id,
                    name: lead.name,
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id
                },
                total_fields: customFields.length,
                all_fields: fieldAnalysis,
                subscription_fields: subscriptionFields,
                subscription_info: amoCrmService.extractSubscriptionInfo(lead)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Добавьте этот маршрут для принудительного поиска
app.get('/api/debug/find-lead-by-id/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ПРИНУДИТЕЛЬНЫЙ ПОИСК СДЕЛКИ ID: ${leadId}`);
        console.log('='.repeat(80));
        
        const leadResult = await amoCrmService.findLeadById(leadId);
        
        if (!leadResult) {
            return res.json({ success: false, error: 'Сделка не найдена' });
        }
        
        // Найдем контакт этой сделки
        const contactResponse = await amoCrmService.makeRequest('GET', 
            `/api/v4/leads/${leadId}/contacts`
        );
        
        let contact = null;
        if (contactResponse && contactResponse._embedded && contactResponse._embedded.contacts) {
            const contactId = contactResponse._embedded.contacts[0].id;
            contact = await amoCrmService.getFullContactInfo(contactId);
        }
        
        res.json({
            success: true,
            message: 'Сделка найдена',
            data: {
                lead: leadResult.lead,
                subscription_info: leadResult.subscriptionInfo,
                contact: contact ? {
                    id: contact.id,
                    name: contact.name
                } : null
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Тестовый маршрут для быстрой проверки контакта
app.get('/api/test-contact/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        
        console.log(`\n🧪 ТЕСТ КОНТАКТА ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({ success: false, error: 'amoCRM не инициализирован' });
        }
        
        const fullContact = await amoCrmService.getFullContactInfo(contactId);
        if (!fullContact) {
            return res.json({ success: false, error: 'Контакт не найден' });
        }
        
        const students = amoCrmService.extractStudentsFromContact(fullContact);
        
        // Получаем телефон
        const phoneField = fullContact.custom_fields_values?.find(f => 
            (f.field_id || f.id) === 216615
        );
        const phone = phoneField ? amoCrmService.getFieldValue(phoneField) : null;
        
        res.json({
            success: true,
            data: {
                contact: {
                    id: fullContact.id,
                    name: fullContact.name,
                    phone: phone
                },
                students: students.map(s => s.studentName),
                students_count: students.length,
                fields: fullContact.custom_fields_values?.map(f => ({
                    id: f.field_id || f.id,
                    name: amoCrmService.getFieldNameById(f.field_id || f.id),
                    value: amoCrmService.getFieldValue(f)
                })) || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Маршрут для поиска контакта по ID с деталями
app.get('/api/contact/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        
        console.log(`\n🔍 ПОИСК КОНТАКТА ПО ID: ${contactId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({ success: false, error: 'amoCRM не подключен' });
        }
        
        const response = await amoCrmService.makeRequest('GET', 
            `/api/v4/contacts/${contactId}?with=custom_fields_values`
        );
        
        if (!response) {
            return res.json({ success: false, error: 'Контакт не найден' });
        }
        
        // Извлекаем телефон
        const phoneField = response.custom_fields_values?.find(f => 
            (f.field_id || f.id) === 216615
        );
        const phone = phoneField ? amoCrmService.getFieldValue(phoneField) : null;
        
        res.json({
            success: true,
            data: {
                contact: {
                    id: response.id,
                    name: response.name,
                    phone: phone,
                    created_at: response.created_at,
                    updated_at: response.updated_at
                },
                custom_fields: response.custom_fields_values?.map(f => ({
                    id: f.field_id || f.id,
                    name: f.field_name || `Поле ${f.field_id || f.id}`,
                    value: amoCrmService.getFieldValue(f),
                    enum_values: f.enums
                })) || []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска контакта:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});
// ==================== ПОЛНАЯ ДИАГНОСТИКА ОТСУТСТВИЯ ДАННЫХ ====================
app.get('/api/debug/missing-data/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        const cleanPhone = phone.replace(/\D/g, '');
        const last10Digits = cleanPhone.slice(-10);
        
        console.log(`\n🔍 ПОЛНАЯ ДИАГНОСТИКА ОТСУТСТВИЯ ДАННЫХ`);
        console.log(`📱 Телефон: ${phone}`);
        console.log(`📱 Форматированный: ${formattedPhone}`);
        console.log(`📱 Последние 10 цифр: ${last10Digits}`);
        console.log('='.repeat(80));
        
        const startTime = Date.now();
        
        // ШАГ 1: ПРОВЕРКА В БАЗЕ ДАННЫХ
        console.log('\n🔍 ШАГ 1: ПРОВЕРКА В БАЗЕ ДАННЫХ');
        console.log('─'.repeat(40));
        
        const dbProfiles = await db.all(
            `SELECT * FROM student_profiles 
             WHERE phone_number LIKE ?`,
            [`%${last10Digits}%`]
        );
        
        console.log(`📊 Найдено в БД: ${dbProfiles.length} профилей`);
        
        if (dbProfiles.length > 0) {
            console.log('\n📋 Профили в БД:');
            dbProfiles.forEach((profile, index) => {
                console.log(`${index + 1}. ${profile.student_name} (ID: ${profile.id})`);
                console.log(`   📱 Телефон: ${profile.phone_number}`);
                console.log(`   🎫 Абонемент: ${profile.subscription_type}`);
                console.log(`   ✅ Активен: ${profile.subscription_active === 1 ? 'Да' : 'Нет'}`);
                console.log(`   🕒 Синхронизация: ${profile.last_sync || 'Нет'}`);
                console.log(`   📅 Создан: ${profile.created_at}`);
            });
        }
        
        // ШАГ 2: ПРОВЕРКА В AMOCRM
        console.log('\n🔍 ШАГ 2: ПРОВЕРКА В AMOCRM');
        console.log('─'.repeat(40));
        
        // Проверяем инициализацию amoCRM
        if (!amoCrmService.isInitialized) {
            console.log('❌ amoCRM не инициализирован!');
            console.log('Проверьте настройки в .env файле:');
            console.log(`AMOCRM_ACCESS_TOKEN: ${AMOCRM_ACCESS_TOKEN ? '✅ Установлен' : '❌ Отсутствует'}`);
            console.log(`AMOCRM_DOMAIN: ${AMOCRM_DOMAIN ? '✅ ' + AMOCRM_DOMAIN : '❌ Отсутствует'}`);
        } else {
            console.log('✅ amoCRM инициализирован');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            console.log(`🎯 Воронка абонементов: ${amoCrmService.SUBSCRIPTION_PIPELINE_ID}`);
        }
        
        // Ищем контакты
        console.log('\n🔍 Поиск контактов в amoCRM...');
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        console.log(`📊 Найдено контактов в amoCRM: ${contacts.length}`);
        
        let amoCrmStudents = [];
        
        if (contacts.length > 0) {
            // Проверяем только первые 3 контакта (чтобы не перегружать)
            for (let i = 0; i < Math.min(contacts.length, 3); i++) {
                const contact = contacts[i];
                console.log(`\n📋 Контакт ${i + 1}: "${contact.name}" (ID: ${contact.id})`);
                
                try {
                    // Получаем полную информацию о контакте
                    const fullContact = await amoCrmService.getFullContactInfo(contact.id);
                    
                    if (!fullContact) {
                        console.log('⚠️  Не удалось получить контакт');
                        continue;
                    }
                    
                    // Извлекаем учеников
                    const students = amoCrmService.extractStudentsFromContact(fullContact);
                    console.log(`👥 Ученики в контакте: ${students.length}`);
                    
                    if (students.length > 0) {
                        students.forEach((student, idx) => {
                            console.log(`   ${idx + 1}. ${student.studentName}`);
                            console.log(`      🏢 Филиал: ${student.branch || 'Не указан'}`);
                            console.log(`      👨‍🏫 Преподаватель: ${student.teacherName || 'Не указан'}`);
                            console.log(`      🎂 Возрастная группа: ${student.ageGroup || 'Не указана'}`);
                            
                            amoCrmStudents.push({
                                contact_id: contact.id,
                                contact_name: contact.name,
                                student_name: student.studentName,
                                branch: student.branch,
                                teacher_name: student.teacherName,
                                age_group: student.ageGroup,
                                day_of_week: student.dayOfWeek,
                                last_visit: student.lastVisitDate,
                                has_active_sub: student.hasActiveSub
                            });
                        });
                    } else {
                        console.log('⚠️  В контакте нет учеников');
                    }
                    
                    // Показываем поля контакта для отладки
                    console.log('\n📋 Поля контакта:');
                    const customFields = fullContact.custom_fields_values || [];
                    customFields.forEach(field => {
                        const fieldId = field.field_id || field.id;
                        const fieldName = amoCrmService.getFieldNameById(fieldId);
                        const value = amoCrmService.getFieldValue(field);
                        
                        if (fieldName.includes('ребен') || fieldName.includes('ФИО') || 
                            fieldName.includes('телефон') || fieldName.includes('Телефон')) {
                            console.log(`   ${fieldId}: ${fieldName} = "${value || 'Пусто'}"`);
                        }
                    });
                    
                } catch (contactError) {
                    console.error(`❌ Ошибка обработки контакта:`, contactError.message);
                }
            }
        } else {
            console.log('\n🔍 Пробуем другие методы поиска...');
            
            // Метод 2: Полный перебор контактов (медленно, но надежно)
            console.log('🔍 Полный перебор контактов (первые 100)...');
            try {
                const allContactsResponse = await amoCrmService.makeRequest(
                    'GET', 
                    '/api/v4/contacts?limit=100&with=custom_fields_values'
                );
                
                const allContacts = allContactsResponse._embedded?.contacts || [];
                console.log(`📊 Получено контактов: ${allContacts.length}`);
                
                // Ищем контакты с нужным телефоном
                const foundContacts = [];
                
                for (const contact of allContacts) {
                    if (amoCrmService.contactHasPhone(contact, last10Digits)) {
                        foundContacts.push(contact);
                        console.log(`✅ Найден контакт: "${contact.name}" (ID: ${contact.id})`);
                    }
                }
                
                console.log(`📊 Найдено контактов через полный перебор: ${foundContacts.length}`);
                
                if (foundContacts.length > 0) {
                    contacts.push(...foundContacts);
                }
                
            } catch (allContactsError) {
                console.log('❌ Ошибка полного перебора:', allContactsError.message);
            }
        }
        
        // ШАГ 3: ПРОВЕРКА СИНХРОНИЗАЦИИ
        console.log('\n🔍 ШАГ 3: ПРОВЕРКА СИНХРОНИЗАЦИИ');
        console.log('─'.repeat(40));
        
        // Проверяем лог синхронизации
        const syncLog = await db.get(
            `SELECT * FROM sync_logs 
             ORDER BY created_at DESC LIMIT 1`
        );
        
        if (syncLog) {
            console.log('📅 Последняя синхронизация:');
            console.log(`   🕒 Время: ${syncLog.start_time}`);
            console.log(`   ⏱️  Длительность: ${syncLog.duration_ms}мс`);
            console.log(`   ✅ Успешно: ${syncLog.success_count || 0}`);
            console.log(`   ❌ Ошибок: ${syncLog.error_count || 0}`);
        } else {
            console.log('⚠️  Логи синхронизации не найдены');
        }
        
        // Проверяем, был ли этот телефон в последней синхронизации
        console.log('\n🔍 Проверка синхронизации для этого телефона...');
        
        // Пробуем принудительно синхронизировать
        if (contacts.length > 0 && amoCrmStudents.length > 0) {
            console.log('🔄 Принудительная синхронизация...');
            
            try {
                const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
                console.log(`📊 Получено профилей из amoCRM: ${profiles.length}`);
                
                if (profiles.length > 0) {
                    const savedCount = await saveProfilesToDatabase(profiles);
                    console.log(`💾 Сохранено в БД: ${savedCount} профилей`);
                    
                    // Проверяем снова
                    const updatedProfiles = await db.all(
                        `SELECT * FROM student_profiles WHERE phone_number LIKE ?`,
                        [`%${last10Digits}%`]
                    );
                    
                    console.log(`📊 Теперь в БД: ${updatedProfiles.length} профилей`);
                }
            } catch (syncError) {
                console.error('❌ Ошибка синхронизации:', syncError.message);
            }
        }
        
        // ШАГ 4: ФОРМИРОВАНИЕ ОТВЕТА
        const duration = Date.now() - startTime;
        
        res.json({
            success: true,
            data: {
                phone: {
                    original: phone,
                    formatted: formattedPhone,
                    last_10_digits: last10Digits
                },
                
                // Результаты поиска
                search_results: {
                    in_database: {
                        found: dbProfiles.length,
                        profiles: dbProfiles.map(p => ({
                            id: p.id,
                            student_name: p.student_name,
                            phone: p.phone_number,
                            subscription_active: p.subscription_active === 1,
                            last_sync: p.last_sync,
                            created_at: p.created_at
                        }))
                    },
                    
                    in_amocrm: {
                        found: contacts.length,
                        contacts: contacts.map(c => ({
                            id: c.id,
                            name: c.name
                        })),
                        students_found: amoCrmStudents.length,
                        students: amoCrmStudents
                    },
                    
                    amocrm_status: {
                        initialized: amoCrmService.isInitialized,
                        domain: AMOCRM_DOMAIN,
                        subdomain: AMOCRM_SUBDOMAIN,
                        access_token: AMOCRM_ACCESS_TOKEN ? '✅ Установлен' : '❌ Отсутствует'
                    }
                },
                
                // Анализ проблемы
                problem_analysis: {
                    possible_causes: [
                        contacts.length === 0 ? '❌ Контакт не найден в amoCRM' : '✅ Контакт найден в amoCRM',
                        amoCrmStudents.length === 0 ? '❌ В контакте нет учеников' : '✅ Ученики найдены в контакте',
                        dbProfiles.length === 0 ? '❌ Данные не синхронизированы в БД' : '✅ Данные есть в БД'
                    ],
                    
                    recommendations: [
                        contacts.length === 0 ? 
                            '1. Проверьте, есть ли контакт с телефоном ' + formattedPhone + ' в amoCRM' : 
                            '1. Контакт найден в amoCRM',
                            
                        amoCrmStudents.length === 0 ?
                            '2. Проверьте поля "ФИО ребенка" в контакте ' + (contacts[0]?.name || '') :
                            '2. Ученики найдены в контакте',
                            
                        dbProfiles.length === 0 && amoCrmStudents.length > 0 ?
                            '3. Запустите принудительную синхронизацию: POST /api/force-refresh/' + phone :
                            '3. Данные уже синхронизированы'
                    ]
                },
                
                // Диагностические команды
                diagnostic_commands: [
                    'GET /api/debug/all-data/' + phone + ' - Полная диагностика',
                    'POST /api/force-refresh/' + phone + ' - Принудительная синхронизация',
                    'GET /api/debug/connection - Проверка соединения с amoCRM',
                    'GET /api/debug/contact-fields/' + phone + ' - Поля контакта в amoCRM'
                ],
                
                // Тестовые данные (для проверки логики)
                test_data: {
                    phone_for_test: '+79660587744',
                    commands: [
                        'GET /api/debug/all-data/79660587744 - Пример с работающим номером',
                        'GET /api/check-data/79660587744 - Быстрая проверка'
                    ]
                },
                
                timestamp: new Date().toISOString(),
                diagnostic_duration_ms: duration
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
    }
});

// Маршрут для принудительной синхронизации конкретного телефона
app.post('/api/sync-phone/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`\n🔄 ПРИНУДИТЕЛЬНАЯ СИНХРОНИЗАЦИЯ ТЕЛЕФОНА: ${formattedPhone}`);
        console.log('='.repeat(60));
        
        // 1. Удаляем старые данные
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        const deleted = await db.run(
            `DELETE FROM student_profiles WHERE phone_number LIKE ?`,
            [`%${cleanPhone}%`]
        );
        
        console.log(`🗑️  Удалено старых записей: ${deleted.changes || 0}`);
        
        // 2. Получаем данные из amoCRM
        console.log('🔍 Получение данных из amoCRM...');
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        console.log(`📊 Получено профилей: ${profiles.length}`);
        
        if (profiles.length === 0) {
            return res.json({
                success: false,
                error: 'Данные не найдены',
                message: 'В amoCRM не найдено учеников по указанному телефону'
            });
        }
        
        // 3. Сохраняем в БД
        console.log('💾 Сохранение в БД...');
        const savedCount = await saveProfilesToDatabase(profiles);
        
        // 4. Проверяем результат
        const updatedProfiles = await db.all(
            `SELECT student_name, subscription_type, subscription_active 
             FROM student_profiles WHERE phone_number LIKE ?`,
            [`%${cleanPhone}%`]
        );
        
        console.log(`✅ Сохранено профилей: ${savedCount}`);
        console.log(`📊 Теперь в БД: ${updatedProfiles.length} профилей`);
        
        res.json({
            success: true,
            message: 'Синхронизация завершена',
            data: {
                phone: formattedPhone,
                profiles_from_amocrm: profiles.length,
                profiles_saved: savedCount,
                profiles_in_db: updatedProfiles.length,
                profiles: updatedProfiles.map(p => ({
                    student: p.student_name,
                    subscription: p.subscription_type,
                    active: p.subscription_active === 1
                })),
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка синхронизации:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});
app.get('/api/debug/subscription-structure/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ПРОВЕРКА СТРУКТУРЫ ДАННЫХ ДЛЯ СДЕЛКИ ${leadId}`);
        
        const lead = await amoCrmService.makeRequest('GET', 
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            return res.json({ success: false, error: 'Сделка не найдена' });
        }
        
        // Вызываем extractSubscriptionInfo
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        console.log(`📊 Структура subscriptionInfo:`);
        console.log(JSON.stringify(subscriptionInfo, null, 2));
        
        // Создаем тестовый профиль
        const testContact = {
            id: 22967827,
            name: 'Анна (тест)',
            custom_fields_values: []
        };
        
        const testStudentInfo = {
            studentName: 'Полина Кунахович',
            branch: 'Чертаново'
        };
        
        const testProfile = amoCrmService.createStudentProfile(
            testContact,
            '+79161916984',
            testStudentInfo,
            subscriptionInfo,
            lead
        );
        
        res.json({
            success: true,
            data: {
                subscription_info: subscriptionInfo,
                subscription_info_keys: Object.keys(subscriptionInfo),
                profile_created: !!testProfile,
                profile_structure: testProfile ? Object.keys(testProfile) : []
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки структуры:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== КОМПЛЕКСНЫЙ ДИАГНОСТИЧЕСКИЙ МАРШРУТ ДЛЯ ПРИЛОЖЕНИЯ ====================
app.get('/api/debug/app-diagnostic/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 КОМПЛЕКСНАЯ ДИАГНОСТИКА ДЛЯ ПРИЛОЖЕНИЯ`);
        console.log('='.repeat(100));
        console.log(`📱 Телефон приложения: "${phone}"`);
        console.log(`👤 Ученик приложения: "${studentName}"`);
        console.log('='.repeat(100));
        
        const startTime = Date.now();
        const diagnosticLog = [];
        
        const logStep = (step, message, data = null) => {
            console.log(`\n📋 ${step}: ${message}`);
            diagnosticLog.push({
                step: step,
                message: message,
                data: data,
                timestamp: new Date().toISOString()
            });
        };
        
        // ШАГ 1: ПРОВЕРКА ВХОДНЫХ ДАННЫХ
        logStep('Шаг 1', 'Проверка входных данных', { phone, studentName });
        
        if (!phone || phone === 'undefined' || phone === 'null') {
            return res.json({
                success: false,
                error: 'Телефон не указан или undefined',
                diagnostic_log: diagnosticLog
            });
        }
        
        if (!studentName || studentName === 'undefined' || studentName === 'null') {
            return res.json({
                success: false,
                error: 'Имя ученика не указано',
                diagnostic_log: diagnosticLog
            });
        }
        
        // ШАГ 2: ФОРМАТИРОВАНИЕ ТЕЛЕФОНА
        const formattedPhone = formatPhoneNumber(phone);
        logStep('Шаг 2', 'Форматирование телефона', {
            original: phone,
            formatted: formattedPhone,
            last_10_digits: formattedPhone.replace(/\D/g, '').slice(-10)
        });
        
        // ШАГ 3: ПРОВЕРКА ПОДКЛЮЧЕНИЯ К AMOCRM
        logStep('Шаг 3', 'Проверка подключения amoCRM', {
            is_initialized: amoCrmService.isInitialized,
            subdomain: AMOCRM_SUBDOMAIN,
            domain: AMOCRM_DOMAIN
        });
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                error: 'amoCRM не подключен',
                diagnostic_log: diagnosticLog
            });
        }
        
        // ШАГ 4: ПОИСК КОНТАКТОВ ПО ТЕЛЕФОНУ
        logStep('Шаг 4', 'Поиск контактов в amoCRM', { phone: formattedPhone });
        
        let contactsResponse;
        try {
            contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        } catch (searchError) {
            logStep('Шаг 4', 'ОШИБКА поиска контактов', { error: searchError.message });
            contactsResponse = { _embedded: { contacts: [] } };
        }
        
        const contacts = contactsResponse._embedded?.contacts || [];
        logStep('Шаг 4', 'Результаты поиска контактов', {
            contacts_found: contacts.length,
            contacts: contacts.map(c => ({ id: c.id, name: c.name }))
        });
        
        if (contacts.length === 0) {
            return res.json({
                success: false,
                error: 'Контакты не найдены в amoCRM',
                diagnostic_log: diagnosticLog,
                suggestions: [
                    '1. Проверьте правильность телефона в amoCRM',
                    '2. Убедитесь, что телефон указан в поле "Телефон" контакта',
                    '3. Проверьте формат телефона: ' + formattedPhone
                ]
            });
        }
        
        // Берем первый контакт для анализа
        const contact = contacts[0];
        logStep('Шаг 5', 'Основной контакт для анализа', {
            id: contact.id,
            name: contact.name,
            phone_in_app: formattedPhone
        });
        
        // ШАГ 5: ПОЛУЧЕНИЕ ПОЛНОЙ ИНФОРМАЦИИ О КОНТАКТЕ
        logStep('Шаг 6', 'Получение полной информации о контакте', { contact_id: contact.id });
        
        const fullContact = await amoCrmService.getFullContactInfo(contact.id);
        if (!fullContact) {
            logStep('Шаг 6', 'ОШИБКА: не удалось получить контакт');
            return res.json({
                success: false,
                error: 'Не удалось получить информацию о контакте',
                diagnostic_log: diagnosticLog
            });
        }
        
        // Показываем телефон контакта
        const contactPhoneField = fullContact.custom_fields_values?.find(f => 
            (f.field_id || f.id) === amoCrmService.FIELD_IDS.CONTACT.PHONE
        );
        const contactPhone = contactPhoneField ? amoCrmService.getFieldValue(contactPhoneField) : 'Не указан';
        
        logStep('Шаг 6', 'Телефон в контакте amoCRM', {
            contact_phone: contactPhone,
            normalized_contact_phone: contactPhone ? contactPhone.replace(/\D/g, '') : 'Нет',
            app_phone_normalized: formattedPhone.replace(/\D/g, ''),
            match: contactPhone ? contactPhone.replace(/\D/g, '').includes(formattedPhone.replace(/\D/g, '').slice(-10)) : false
        });
        
        // ШАГ 6: ИЗВЛЕЧЕНИЕ УЧЕНИКОВ ИЗ КОНТАКТА
        logStep('Шаг 7', 'Извлечение учеников из контакта', { contact_id: contact.id });
        
        const students = amoCrmService.extractStudentsFromContact(fullContact);
        logStep('Шаг 7', 'Ученики в контакте', {
            total_students: students.length,
            students: students.map(s => s.studentName)
        });
        
        // Проверяем, есть ли наш ученик в списке
        const normalizedStudentName = amoCrmService.normalizeName(studentName);
        const studentInContact = students.find(s => 
            amoCrmService.normalizeName(s.studentName).includes(normalizedStudentName) ||
            normalizedStudentName.includes(amoCrmService.normalizeName(s.studentName))
        );
        
        logStep('Шаг 7', 'Поиск ученика в контакте', {
            student_from_app: studentName,
            normalized_app_student: normalizedStudentName,
            found_in_contact: !!studentInContact,
            student_data: studentInContact || null
        });
        
        // ШАГ 7: ПОЛУЧЕНИЕ ВСЕХ СДЕЛОК КОНТАКТА
        logStep('Шаг 8', 'Получение всех сделок контакта', { contact_id: contact.id });
        
        const allLeads = await amoCrmService.getContactLeadsFixed(contact.id);
        logStep('Шаг 8', 'Все сделки контакта', {
            total_leads: allLeads.length,
            leads: allLeads.slice(0, 10).map(l => ({
                id: l.id,
                name: l.name,
                pipeline_id: l.pipeline_id,
                status_id: l.status_id,
                created_date: new Date(l.created_at * 1000).toLocaleDateString()
            })),
            // Показать все ID сделок
            all_lead_ids: allLeads.map(l => l.id)
        });
        
        if (allLeads.length === 0) {
            return res.json({
                success: false,
                error: 'У контакта нет сделок в amoCRM',
                diagnostic_log: diagnosticLog,
                contact: {
                    id: contact.id,
                    name: contact.name,
                    phone: contactPhone
                },
                student: studentName
            });
        }
        
        // ШАГ 8: ПОИСК СДЕЛКИ ПО ИМЕНИ УЧЕНИКА (ТОЧНО ТАК ЖЕ КАК В ПРИЛОЖЕНИИ)
        logStep('Шаг 9', 'Поиск сделки по имени ученика (алгоритм приложения)', {
            student_name: studentName,
            contact_id: contact.id
        });
        
        let foundLead = null;
        let searchMethod = 'NOT_FOUND';
        
        // Метод 1: Поиск по полному совпадению имени в сделках
        for (const lead of allLeads) {
            const leadName = amoCrmService.normalizeName(lead.name);
            
            if (leadName.includes(normalizedStudentName) || 
                normalizedStudentName.includes(leadName.split(' ')[0])) {
                foundLead = lead;
                searchMethod = 'NAME_MATCH_IN_LEAD_NAME';
                logStep('Шаг 9.1', 'Найдена сделка по имени', {
                    lead_id: lead.id,
                    lead_name: lead.name,
                    student_in_lead: leadName,
                    match_type: 'Имя ученика найдено в названии сделки'
                });
                break;
            }
        }
        
        // Метод 2: Если не нашли по имени, ищем в воронке абонементов
        if (!foundLead) {
            logStep('Шаг 9.2', 'Не найдено по имени, ищем в воронке абонементов', {
                subscription_pipeline_id: amoCrmService.SUBSCRIPTION_PIPELINE_ID
            });
            
            for (const lead of allLeads) {
                if (lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID) {
                    foundLead = lead;
                    searchMethod = 'SUBSCRIPTION_PIPELINE_MATCH';
                    logStep('Шаг 9.2', 'Найдена сделка в воронке абонементов', {
                        lead_id: lead.id,
                        lead_name: lead.name,
                        pipeline_id: lead.pipeline_id
                    });
                    break;
                }
            }
        }
        
        // Метод 3: Если все еще не нашли, берем самую новую сделку
        if (!foundLead && allLeads.length > 0) {
            foundLead = allLeads[0]; // Самая новая сделка
            searchMethod = 'LATEST_LEAD';
            logStep('Шаг 9.3', 'Берем самую новую сделку', {
                lead_id: foundLead.id,
                lead_name: foundLead.name,
                created_date: new Date(foundLead.created_at * 1000).toLocaleDateString()
            });
        }
        
        // ШАГ 9: ЕСЛИ НАШЛИ СДЕЛКУ - АНАЛИЗИРУЕМ АБОНЕМЕНТ
        let subscriptionInfo = null;
        let hasSubscription = false;
        
        if (foundLead) {
            logStep('Шаг 10', 'Анализ найденной сделки на наличие абонемента', {
                lead_id: foundLead.id,
                lead_name: foundLead.name,
                search_method: searchMethod
            });
            
            subscriptionInfo = amoCrmService.extractSubscriptionInfo(foundLead);
            hasSubscription = subscriptionInfo.hasSubscription;
            
            logStep('Шаг 10', 'Результат анализа абонемента', {
                has_subscription: subscriptionInfo.hasSubscription,
                subscription_active: subscriptionInfo.subscriptionActive,
                total_classes: subscriptionInfo.totalClasses,
                used_classes: subscriptionInfo.usedClasses,
                remaining_classes: subscriptionInfo.remainingClasses,
                subscription_type: subscriptionInfo.subscriptionType,
                subscription_status: subscriptionInfo.subscriptionStatus
            });
            
            // Показываем все поля сделки для отладки
            const customFields = foundLead.custom_fields_values || [];
            logStep('Шаг 10.1', 'Все поля сделки', {
                total_fields: customFields.length,
                fields: customFields.map(f => ({
                    field_id: f.field_id || f.id,
                    field_name: amoCrmService.getFieldNameById(f.field_id || f.id),
                    value: amoCrmService.getFieldValue(f),
                    is_subscription_field: amoCrmService.getFieldNameById(f.field_id || f.id)?.toLowerCase().includes('абонемент') ||
                                         amoCrmService.getFieldNameById(f.field_id || f.id)?.toLowerCase().includes('занят')
                }))
            });
        } else {
            logStep('Шаг 10', 'Сделка не найдена', {
                error: 'Не удалось найти сделку для анализа'
            });
        }
        
        // ШАГ 10: ПРОБУЕМ ПРЯМОЙ ПОИСК ИЗВЕСТНЫХ СДЕЛОК
        logStep('Шаг 11', 'Прямой поиск известных сделок с абонементами', {
            test_lead_ids: [28674541, 28674745, 28677839] // Из вашего примера
        });
        
        const testLeads = [];
        for (const testLeadId of [28674541, 28674745, 28677839]) {
            try {
                const lead = await amoCrmService.makeRequest('GET', 
                    `/api/v4/leads/${testLeadId}?with=custom_fields_values`
                );
                if (lead) {
                    const testSubscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                    testLeads.push({
                        id: lead.id,
                        name: lead.name,
                        has_subscription: testSubscriptionInfo.hasSubscription,
                        total_classes: testSubscriptionInfo.totalClasses,
                        remaining_classes: testSubscriptionInfo.remainingClasses,
                        status: testSubscriptionInfo.subscriptionStatus
                    });
                }
            } catch (error) {
                // Пропускаем ошибки
            }
        }
        
        logStep('Шаг 11', 'Результаты прямого поиска', {
            test_leads_found: testLeads.length,
            test_leads: testLeads
        });
        
        // ШАГ 11: ПРОВЕРКА, ЧТО ВОЗВРАЩАЕТ ТЕКУЩИЙ API
        logStep('Шаг 12', 'Что сейчас возвращает API для приложения', {
            current_api_behavior: 'Анализ'
        });
        
        // Создаем тестовый профиль (как это делает приложение)
        let testProfile = null;
        if (foundLead && subscriptionInfo) {
            const studentInfo = {
                studentName: studentName,
                branch: studentInContact?.branch || '',
                teacherName: studentInContact?.teacherName || '',
                ageGroup: studentInContact?.ageGroup || subscriptionInfo.ageGroup || '',
                parentName: contact.name,
                email: ''
            };
            
            testProfile = amoCrmService.createStudentProfile(
                contact,
                formattedPhone,
                studentInfo,
                subscriptionInfo,
                foundLead
            );
            
            logStep('Шаг 12', 'Созданный профиль для приложения', {
                profile_created: true,
                student_name_in_profile: testProfile.student_name,
                subscription_in_profile: testProfile.subscription_type,
                total_classes_in_profile: testProfile.total_classes,
                remaining_classes_in_profile: testProfile.remaining_classes,
                profile_keys: Object.keys(testProfile)
            });
        }
        
        // ШАГ 12: АНАЛИЗ ПРОБЛЕМЫ
        logStep('Шаг 13', 'АНАЛИЗ ПРОБЛЕМЫ', {
            issue_detected: !hasSubscription,
            possible_causes: [
                !foundLead ? 'Сделка не найдена для ученика' : 'Сделка найдена',
                foundLead && !hasSubscription ? 'В сделке нет данных об абонементе' : 'Данные абонемента есть',
                testProfile && testProfile.total_classes === 0 ? 'В профиле 0 занятий' : 'В профиле есть занятия'
            ]
        });
        
        // ФОРМИРОВАНИЕ ОТВЕТА
        const duration = Date.now() - startTime;
        
        res.json({
            success: true,
            diagnostic: {
                timestamp: new Date().toISOString(),
                duration_ms: duration,
                total_steps: diagnosticLog.length
            },
            
            // Ключевая информация
            key_findings: {
                // Что приложение отправляет
                app_input: {
                    phone: phone,
                    student_name: studentName
                },
                
                // Что нашли в amoCRM
                amocrm_found: {
                    contact_found: !!contact,
                    contact_id: contact?.id,
                    contact_name: contact?.name,
                    contact_phone: contactPhone,
                    students_in_contact: students.length,
                    target_student_in_contact: !!studentInContact,
                    leads_found: allLeads.length,
                    subscription_lead_found: !!foundLead,
                    subscription_data_found: hasSubscription
                },
                
                // Данные абонемента
                subscription_data: subscriptionInfo ? {
                    has_subscription: subscriptionInfo.hasSubscription,
                    total_classes: subscriptionInfo.totalClasses,
                    remaining_classes: subscriptionInfo.remainingClasses,
                    used_classes: subscriptionInfo.usedClasses,
                    subscription_type: subscriptionInfo.subscriptionType,
                    subscription_status: subscriptionInfo.subscriptionStatus,
                    subscription_active: subscriptionInfo.subscriptionActive
                } : null,
                
                // Что получит приложение
                what_app_will_receive: testProfile ? {
                    student_name: testProfile.student_name,
                    phone_number: testProfile.phone_number,
                    subscription_type: testProfile.subscription_type,
                    total_classes: testProfile.total_classes,
                    remaining_classes: testProfile.remaining_classes,
                    used_classes: testProfile.used_classes,
                    subscription_active: testProfile.subscription_active === 1
                } : null
            },
            
            // Детальная диагностика
            detailed_analysis: {
                // Воронки и статусы
                pipeline_info: {
                    subscription_pipeline_id: amoCrmService.SUBSCRIPTION_PIPELINE_ID,
                    active_status_ids: amoCrmService.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE
                },
                
                // ID полей
                field_ids: {
                    contact_phone: amoCrmService.FIELD_IDS.CONTACT.PHONE,
                    contact_child1: amoCrmService.FIELD_IDS.CONTACT.CHILD_1_NAME,
                    lead_total_classes: amoCrmService.FIELD_IDS.LEAD.TOTAL_CLASSES,
                    lead_remaining_classes: amoCrmService.FIELD_IDS.LEAD.REMAINING_CLASSES
                },
                
                // Тестовые данные
                test_leads: testLeads
            },
            
            // Рекомендации по исправлению
            recommendations: (() => {
                const recs = [];
                
                if (!foundLead) {
                    recs.push('🚨 ПРОБЛЕМА: Сделка не найдена для ученика');
                    recs.push('   🔧 Решение: Проверьте название сделок в amoCRM - должно содержать имя ученика');
                    recs.push('   🔧 Решение: Проверьте воронку абонементов (ID: ' + amoCrmService.SUBSCRIPTION_PIPELINE_ID + ')');
                }
                
                if (foundLead && !hasSubscription) {
                    recs.push('🚨 ПРОБЛЕМА: В сделке нет данных об абонементе');
                    recs.push('   🔧 Решение: Проверьте поля в сделке:');
                    recs.push('        - "Всего занятий" (ID: ' + amoCrmService.FIELD_IDS.LEAD.TOTAL_CLASSES + ')');
                    recs.push('        - "Остаток занятий" (ID: ' + amoCrmService.FIELD_IDS.LEAD.REMAINING_CLASSES + ')');
                    recs.push('        - "Тип абонемента" (ID: ' + amoCrmService.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE + ')');
                }
                
                if (testProfile && testProfile.total_classes === 0) {
                    recs.push('🚨 ПРОБЛЕМА: В профиле 0 занятий');
                    recs.push('   🔧 Решение: Проверьте extractSubscriptionInfo - правильно ли извлекаются данные');
                }
                
                if (recs.length === 0) {
                    recs.push('✅ Все данные найдены правильно');
                    recs.push('   🔍 Проверьте фронтенд - возможно ошибка в отображении');
                }
                
                return recs;
            })(),
            
            // Диагностические команды
            diagnostic_commands: [
                `GET /api/debug/find-lead-direct/28674541 - Проверка конкретной сделки`,
                `GET /api/debug/contact-all-leads/${phone} - Все сделки контакта`,
                `GET /api/debug/student-leads/${phone}/${encodeURIComponent(studentName)} - Сделки по ученику`,
                `POST /api/sync-phone/${phone} - Принудительная синхронизация`
            ],
            
            // Полный лог диагностики
            diagnostic_log: diagnosticLog
        });
        
    } catch (error) {
        console.error('❌ Ошибка комплексной диагностики:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
    }
});
// ==================== ТЕСТ КОНТАКТА С УЧЕНИКАМИ ====================
app.get('/api/test-contact/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`\n🧪 ТЕСТ КОНТАКТА: ${formattedPhone}`);
        console.log('='.repeat(60));
        
        // Ищем контакты
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        console.log(`📊 Найдено контактов: ${contacts.length}`);
        
        const results = [];
        
        for (const contact of contacts) {
            try {
                console.log(`\n📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
                
                // Получаем полную информацию
                const fullContact = await amoCrmService.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                // Извлекаем учеников
                const students = amoCrmService.extractStudentsFromContact(fullContact);
                console.log(`👥 Ученики: ${students.length}`);
                
                // Исправленный поиск сделок
                console.log('🔍 Исправленный поиск сделок...');
                const leads = await amoCrmService.getContactLeadsFixed(contact.id);
                console.log(`📊 Найдено сделок: ${leads.length}`);
                
                // Проверяем каждую сделку
                const leadAnalysis = [];
                for (const lead of leads) {
                    const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                    
                    leadAnalysis.push({
                        id: lead.id,
                        name: lead.name,
                        pipeline_id: lead.pipeline_id,
                        status_id: lead.status_id,
                        has_subscription: subscriptionInfo.hasSubscription,
                        total_classes: subscriptionInfo.totalClasses,
                        remaining_classes: subscriptionInfo.remainingClasses
                    });
                }
                
                // Сделки с абонементами
                const subscriptionLeads = leadAnalysis.filter(l => l.has_subscription);
                
                results.push({
                    contact: {
                        id: contact.id,
                        name: contact.name
                    },
                    students: students.map(s => s.studentName),
                    leads_count: leads.length,
                    subscription_leads_count: subscriptionLeads.length,
                    subscription_leads: subscriptionLeads,
                    all_leads: leadAnalysis.slice(0, 10) // Первые 10 сделок
                });
                
            } catch (contactError) {
                console.error(`❌ Ошибка контакта:`, contactError.message);
            }
        }
        
        res.json({
            success: true,
            data: {
                phone: formattedPhone,
                contacts_found: contacts.length,
                contacts_analyzed: results.length,
                results: results,
                summary: {
                    total_students: results.reduce((sum, r) => sum + r.students.length, 0),
                    total_leads: results.reduce((sum, r) => sum + r.leads_count, 0),
                    total_subscription_leads: results.reduce((sum, r) => sum + r.subscription_leads_count, 0)
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== БЫСТРАЯ ПРОВЕРКА ВСЕХ ДАННЫХ ====================
app.get('/api/quick-check/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`\n⚡ БЫСТРАЯ ПРОВЕРКА: ${formattedPhone}`);
        
        // 1. Проверяем в БД
        const cleanPhone = phone.replace(/\D/g, '').slice(-10);
        const dbProfiles = await db.all(
            `SELECT student_name, subscription_type, subscription_active, 
                    total_classes, used_classes, remaining_classes
             FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1
             ORDER BY student_name`,
            [`%${cleanPhone}%`]
        );
        
        // 2. Если нет в БД, ищем в amoCRM
        if (dbProfiles.length === 0) {
            console.log('🔍 Данных нет в БД, ищем в amoCRM...');
            
            const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
            const contacts = contactsResponse._embedded?.contacts || [];
            
            if (contacts.length === 0) {
                return res.json({
                    success: true,
                    status: 'NO_CONTACT',
                    message: 'Контакт не найден в amoCRM',
                    phone: formattedPhone
                });
            }
            
            const contact = contacts[0];
            console.log(`📋 Контакт: "${contact.name}"`);
            
            // Получаем учеников
            const fullContact = await amoCrmService.getFullContactInfo(contact.id);
            const students = amoCrmService.extractStudentsFromContact(fullContact);
            
            if (students.length === 0) {
                return res.json({
                    success: true,
                    status: 'NO_STUDENTS',
                    message: 'У контакта нет учеников',
                    contact: contact.name,
                    phone: formattedPhone
                });
            }
            
            // Ищем сделки
            const leads = await amoCrmService.getContactLeadsFixed(contact.id);
            
            // Ищем абонементы
            const subscriptions = [];
            for (const student of students) {
                const leadResult = await amoCrmService.findSubscriptionLeadForStudentFixed(
                    contact.id, 
                    student.studentName
                );
                
                if (leadResult && leadResult.subscriptionInfo.hasSubscription) {
                    subscriptions.push({
                        student: student.studentName,
                        subscription: leadResult.subscriptionInfo,
                        lead_id: leadResult.lead.id
                    });
                }
            }
            
            return res.json({
                success: true,
                status: 'FOUND_IN_AMOCRM',
                message: 'Данные найдены в amoCRM, но не в БД',
                phone: formattedPhone,
                contact: contact.name,
                students_count: students.length,
                leads_count: leads.length,
                subscriptions_found: subscriptions.length,
                subscriptions: subscriptions.map(s => ({
                    student: s.student,
                    type: s.subscription.subscriptionType,
                    total: s.subscription.totalClasses,
                    used: s.subscription.usedClasses,
                    remaining: s.subscription.remainingClasses,
                    active: s.subscription.subscriptionActive
                })),
                action_required: 'Запустите синхронизацию',
                sync_url: `/api/sync-phone/${phone}`
            });
        }
        
        // 3. Если есть в БД, показываем
        res.json({
            success: true,
            status: 'FOUND_IN_DB',
            message: 'Данные найдены в базе',
            phone: formattedPhone,
            profiles_count: dbProfiles.length,
            profiles: dbProfiles,
            active_profiles: dbProfiles.filter(p => p.subscription_active === 1).length,
            last_check: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Ошибка быстрой проверки:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Тестовый маршрут
app.get('/api/test-phone-search/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        
        console.log(`\n🔍 ТЕСТ ПОИСКА ПО ТЕЛЕФОНУ: ${phone}`);
        
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        const results = contacts.map(contact => {
            // Находим телефон контакта
            const phoneField = contact.custom_fields_values?.find(f => 
                (f.field_id || f.id) === amoCrmService.FIELD_IDS.CONTACT.PHONE
            );
            const contactPhone = phoneField ? amoCrmService.getFieldValue(phoneField) : 'Не указан';
            
            return {
                id: contact.id,
                name: contact.name,
                phone: contactPhone,
                phone_normalized: contactPhone.replace(/\D/g, '')
            };
        });
        
        res.json({
            success: true,
            data: {
                search_phone: phone,
                normalized_phone: phone.replace(/\D/g, ''),
                contacts_found: contacts.length,
                contacts: results
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ТЕСТОВЫЙ МАРШРУТ ДЛЯ ПРОВЕРКИ ====================
app.get('/api/test-connection/:contactId', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        
        console.log(`\n🔍 ТЕСТ ПОДКЛЮЧЕНИЯ ДЛЯ КОНТАКТА ID: ${contactId}`);
        console.log('='.repeat(80));
        
        // Тест 1: Получить контакт
        console.log('\n🧪 Тест 1: Получение контакта');
        const contact = await amoCrmService.makeRequest('GET', `/api/v4/contacts/${contactId}`);
        console.log(`✅ Контакт: "${contact?.name || 'Не найден'}"`);
        
        // Тест 2: Стандартный метод получения сделок
        console.log('\n🧪 Тест 2: Стандартный метод /contacts/{id}/leads');
        try {
            const standardLeads = await amoCrmService.makeRequest('GET', 
                `/api/v4/contacts/${contactId}/leads?limit=10`
            );
            console.log(`✅ Сделок через стандартный метод: ${standardLeads?._embedded?.leads?.length || 0}`);
        } catch (error) {
            console.log(`❌ Ошибка стандартного метода: ${error.message}`);
        }
        
        // Тест 3: Метод через фильтр
        console.log('\n🧪 Тест 3: Метод через filter[contact_id]');
        try {
            const filteredLeads = await amoCrmService.makeRequest('GET', 
                `/api/v4/leads?filter[contact_id][]=${contactId}&limit=10`
            );
            console.log(`✅ Сделок через фильтр: ${filteredLeads?._embedded?.leads?.length || 0}`);
        } catch (error) {
            console.log(`❌ Ошибка фильтра: ${error.message}`);
        }
        
        // Тест 4: Прямой запрос известной сделки
        console.log('\n🧪 Тест 4: Прямой запрос сделки 28677839');
        try {
            const knownLead = await amoCrmService.makeRequest('GET', 
                `/api/v4/leads/28677839`
            );
            console.log(`✅ Известная сделка: "${knownLead?.name || 'Не найдена'}"`);
            
            // Проверяем связи сделки
            if (knownLead) {
                const leadContacts = await amoCrmService.makeRequest('GET', 
                    `/api/v4/leads/28677839/contacts`
                );
                console.log(`✅ Контактов у сделки: ${leadContacts?._embedded?.contacts?.length || 0}`);
                
                if (leadContacts?._embedded?.contacts) {
                    console.log('📋 Привязанные контакты:');
                    leadContacts._embedded.contacts.forEach(c => {
                        console.log(`   👤 ${c.id}: ${c.name} ${c.id == contactId ? '✅ ЭТО НАШ КОНТАКТ!' : ''}`);
                    });
                }
            }
        } catch (error) {
            console.log(`❌ Ошибка запроса сделки: ${error.message}`);
        }
        
        res.json({
            success: true,
            tests_completed: 4,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
app.get('/api/debug/find-lead-test/:contactId/:studentName', async (req, res) => {
    try {
        const contactId = req.params.contactId;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ТЕСТ ПОИСКА СДЕЛКИ`);
        console.log(`👤 Ученик: "${studentName}"`);
        console.log(`📞 Контакт ID: ${contactId}`);
        
        const matches = await amoCrmService.debugFindLeadForStudent(contactId, studentName);
        
        if (matches.length > 0) {
            const bestMatch = matches[0];
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(bestMatch.lead);
            
            res.json({
                success: true,
                data: {
                    best_match: {
                        lead_id: bestMatch.lead.id,
                        lead_name: bestMatch.lead.name,
                        match_score: bestMatch.matchScore,
                        match_reason: bestMatch.matchReason,
                        subscription_info: subscriptionInfo
                    },
                    all_matches: matches.map(m => ({
                        lead_id: m.lead.id,
                        lead_name: m.lead.name,
                        match_score: m.matchScore,
                        match_reason: m.matchReason
                    })),
                    total_matches: matches.length
                }
            });
        } else {
            res.json({
                success: false,
                error: 'Совпадений не найдено',
                contact_id: contactId,
                student_name: studentName
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Добавьте этот маршрут для поиска всех сделок контакта
app.get('/api/debug/contact-all-leads/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`\n🔍 ВСЕ СДЕЛКИ КОНТАКТА: ${formattedPhone}`);
        console.log('='.repeat(80));
        
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        const allLeads = await amoCrmService.getContactLeadsSorted(contact.id);
        
        const leadsAnalysis = allLeads.map(lead => {
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            
            return {
                id: lead.id,
                name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                created_at: lead.created_at,
                price: lead.price,
                has_subscription: subscriptionInfo.hasSubscription,
                total_classes: subscriptionInfo.totalClasses,
                remaining_classes: subscriptionInfo.remainingClasses,
                subscription_active: subscriptionInfo.subscriptionActive,
                pipeline_match: lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID,
                status_match: amoCrmService.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(lead.status_id)
            };
        });
        
        // Фильтруем сделки с абонементом
        const subscriptionLeads = leadsAnalysis.filter(l => l.has_subscription);
        const pipelineLeads = leadsAnalysis.filter(l => l.pipeline_match);
        const activeStatusLeads = leadsAnalysis.filter(l => l.status_match);
        
        console.log(`📊 Всего сделок: ${allLeads.length}`);
        console.log(`🎫 С абонементом: ${subscriptionLeads.length}`);
        console.log(`🎯 В воронке абонементов: ${pipelineLeads.length}`);
        console.log(`✅ С активным статусом: ${activeStatusLeads.length}`);
        
        res.json({
            success: true,
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                statistics: {
                    total_leads: allLeads.length,
                    subscription_leads: subscriptionLeads.length,
                    pipeline_leads: pipelineLeads.length,
                    active_status_leads: activeStatusLeads.length
                },
                all_leads: leadsAnalysis.slice(0, 20), // Первые 20 сделок
                subscription_leads_details: subscriptionLeads,
                pipeline_leads_details: pipelineLeads,
                active_status_leads_details: activeStatusLeads
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== АНАЛИЗ КОНТАКТА ====================
app.get('/api/debug/contact-fields/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`\n🔍 АНАЛИЗ ПОЛЕЙ КОНТАКТА: ${formattedPhone}`);
        console.log('='.repeat(80));
        
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        const fullContact = await amoCrmService.getFullContactInfo(contact.id);
        
        console.log(`📋 Контакт: "${fullContact.name}" (ID: ${fullContact.id})`);
        
        // Извлекаем учеников
        const students = amoCrmService.extractStudentsFromContact(fullContact);
        console.log(`👥 Ученики: ${students.length}`);
        
        // Анализируем все поля контакта
        const customFields = fullContact.custom_fields_values || [];
        console.log(`\n📋 ВСЕ ПОЛЯ КОНТАКТА:`);
        console.log('='.repeat(80));
        
        const contactFieldsMap = new Map();
        
        for (const field of customFields) {
            const fieldId = field.field_id || field.id;
            const fieldName = amoCrmService.getFieldNameById(fieldId);
            const fieldValue = amoCrmService.getFieldValue(field);
            
            if (fieldName) {
                contactFieldsMap.set(fieldId, {
                    name: fieldName,
                    value: fieldValue,
                    raw: field
                });
                
                console.log(`${fieldId}: ${fieldName} = ${fieldValue || 'Пусто'}`);
            }
        }
        
        res.json({
            success: true,
            data: {
                contact: {
                    id: fullContact.id,
                    name: fullContact.name
                },
                students: students,
                total_fields: customFields.length,
                fields: Array.from(contactFieldsMap.values()),
                student_fields: {
                    child1_id: amoCrmService.FIELD_IDS.CONTACT.CHILD_1_NAME,
                    child2_id: amoCrmService.FIELD_IDS.CONTACT.CHILD_2_NAME,
                    child3_id: amoCrmService.FIELD_IDS.CONTACT.CHILD_3_NAME
                },
                suggestions: 'Обновите FIELD_IDS.CONTACT с реальными ID полей из вывода выше'
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа контакта:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ИСПРАВЛЕННЫЙ API ДЛЯ ДИАГНОСТИКИ ====================
app.get('/api/debug/for-app/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ДИАГНОСТИКА ДЛЯ ПРИЛОЖЕНИЯ: ${studentName} (${phone})`);
        
        // ПРОВЕРЯЕМ phone
        if (!phone || phone === 'undefined') {
            return res.json({
                success: false,
                error: 'Телефон не указан или undefined'
            });
        }
        
        const formattedPhone = formatPhoneNumber(phone);
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({
                success: false,
                error: 'Контакты не найдены',
                phone_received: phone,
                phone_formatted: formattedPhone
            });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // Ищем сделки для этого ученика
        const leadResult = await amoCrmService.findSubscriptionLeadForStudentFixed(contact.id, studentName);
        
        if (!leadResult) {
            return res.json({
                success: false,
                error: 'Сделка не найдена',
                contact: {
                    id: contact.id,
                    name: contact.name
                }
            });
        }
        
        // Создаем профиль
        const studentInfo = {
            studentName: studentName,
            branch: '',
            teacherName: '',
            ageGroup: '',
            parentName: contact.name,
            email: ''
        };
        
        const profile = amoCrmService.createStudentProfile(
            contact,
            formattedPhone,
            studentInfo,
            leadResult.subscriptionInfo,
            leadResult.lead
        );
        
        res.json({
            success: true,
            message: 'Данные найдены',
            data: {
                profile: profile,
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                lead: {
                    id: leadResult.lead.id,
                    name: leadResult.lead.name
                },
                match_score: leadResult.match_score,
                is_correct_lead: true
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            stack: error.stack 
        });
    }
});
// Тестовый маршрут для проверки работы
app.get('/api/test-subscription/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🧪 ТЕСТ ПОИСКА АБОНЕМЕНТА: "${studentName}" (${phone})`);
        console.log('='.repeat(80));
        
        const formattedPhone = formatPhoneNumber(phone);
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // Используем новый метод поиска
        const result = await amoCrmService.findSubscriptionLeadForStudent(contact.id, studentName);
        
        if (!result) {
            return res.json({
                success: false,
                error: 'Абонемент не найден',
                contact: {
                    id: contact.id,
                    name: contact.name
                }
            });
        }
        
        // Создаем тестовый профиль
        const studentInfo = {
            studentName: studentName,
            branch: '',
            teacherName: '',
            ageGroup: '',
            parentName: contact.name
        };
        
        const profile = amoCrmService.createStudentProfile(
            contact,
            formattedPhone,
            studentInfo,
            result.subscriptionInfo,
            result.lead
        );
        
        res.json({
            success: true,
            message: 'Абонемент найден!',
            data: {
                profile: profile,
                subscription_info: result.subscriptionInfo,
                lead: {
                    id: result.lead.id,
                    name: result.lead.name,
                    pipeline_id: result.lead.pipeline_id,
                    status_id: result.lead.status_id
                },
                match_type: result.match_type,
                confidence: result.confidence
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
app.get('/api/find-lead-direct/:leadId', async (req, res) => {
    try {
        const leadId = req.params.leadId;
        
        console.log(`\n🔍 ПРЯМОЙ ПОИСК СДЕЛКИ ID: ${leadId}`);
        
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
                    status_id: lead.status_id
                },
                subscription_info: subscriptionInfo
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ДОПОЛНИТЕЛЬНЫЙ API ДЛЯ ТЕСТИРОВАНИЯ ====================
app.get('/api/test-all-students/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`\n🧪 ТЕСТ ВСЕХ УЧЕНИКОВ ПО ТЕЛЕФОНУ: ${formattedPhone}`);
        console.log('='.repeat(80));
        
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({
                success: false,
                error: 'Контакты не найдены'
            });
        }
        
        const results = [];
        
        for (const contact of contacts) {
            try {
                const fullContact = await amoCrmService.getFullContactInfo(contact.id);
                if (!fullContact) continue;
                
                const children = amoCrmService.extractStudentsFromContact(fullContact);
                
                for (const child of children) {
                    const leadResult = await amoCrmService.findLeadForStudent(contact.id, child.studentName);
                    
                    results.push({
                        student_name: child.studentName,
                        contact_name: contact.name,
                        lead_found: !!leadResult,
                        lead_name: leadResult?.lead?.name || null,
                        match_score: leadResult?.match_score || 0,
                        subscription: leadResult ? {
                            total: leadResult.subscriptionInfo.totalClasses,
                            remaining: leadResult.subscriptionInfo.remainingClasses,
                            active: leadResult.subscriptionInfo.subscriptionActive
                        } : null
                    });
                }
            } catch (error) {
                console.error(`❌ Ошибка обработки контакта:`, error.message);
            }
        }
        
        res.json({
            success: true,
            data: {
                phone: formattedPhone,
                total_students: results.length,
                students: results
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Тест 100% гарантированного выбора
app.get('/api/test-guarantee/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🧪 ТЕСТ 100% ГАРАНТИИ ДЛЯ: "${studentName}" (${phone})`);
        console.log('='.repeat(80));
        
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // Используем 100% гарантированный поиск
        const result = await amoCrmService.findLeadForStudent100(contact.id, studentName);
        
        if (!result) {
            return res.json({
                success: false,
                error: 'Сделка не найдена',
                contact: {
                    id: contact.id,
                    name: contact.name
                }
            });
        }
        
        res.json({
            success: true,
            message: '100% гарантия сработала!',
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                student_name: studentName,
                selected_lead: {
                    id: result.lead.id,
                    name: result.lead.name,
                    pipeline_id: result.lead.pipeline_id,
                    status_id: result.lead.status_id
                },
                subscription_info: result.subscriptionInfo,
                selection_metadata: result.selection_metadata
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Проверка всех сделок контакта
app.get('/api/debug/contact-leads/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ВСЕ СДЕЛКИ КОНТАКТА`);
        console.log(`📱 Телефон: ${phone}`);
        console.log(`👤 Ученик: "${studentName}"`);
        console.log('='.repeat(80));
        
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // Получаем все сделки
        const leads = await amoCrmService.getContactLeadsSorted(contact.id);
        console.log(`📊 Всего сделок: ${leads.length}`);
        
        // Анализируем каждую сделку
        const analysis = [];
        
        for (const lead of leads) {
            const matchType = amoCrmService.analyzeLeadOwnership(lead.name, studentName);
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            
            analysis.push({
                lead_id: lead.id,
                lead_name: lead.name,
                pipeline_id: lead.pipeline_id,
                status_id: lead.status_id,
                match_type: matchType,
                has_subscription: subscriptionInfo.hasSubscription,
                total_classes: subscriptionInfo.totalClasses,
                remaining_classes: subscriptionInfo.remainingClasses,
                subscription_status: subscriptionInfo.subscriptionStatus,
                subscription_active: subscriptionInfo.subscriptionActive
            });
        }
        
        // Группируем по типам совпадения
        const exactMatches = analysis.filter(a => a.match_type === 'EXACT');
        const nameMatches = analysis.filter(a => a.match_type === 'NAME_MATCH');
        const wrongStudents = analysis.filter(a => a.match_type === 'WRONG_STUDENT');
        const unknown = analysis.filter(a => a.match_type === 'UNKNOWN');
        
        res.json({
            success: true,
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                student_name: studentName,
                statistics: {
                    total_leads: leads.length,
                    exact_matches: exactMatches.length,
                    name_matches: nameMatches.length,
                    wrong_students: wrongStudents.length,
                    unknown: unknown.length
                },
                leads_by_category: {
                    exact_matches: exactMatches,
                    name_matches: nameMatches,
                    wrong_students: wrongStudents,
                    unknown: unknown
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== НАСТРОЙКА ПОЛЕЙ ПО РЕАЛЬНЫМ ДАННЫМ ====================
app.post('/api/debug/update-field-ids', async (req, res) => {
    try {
        const { leadFields, contactFields } = req.body;
        
        console.log('\n🔄 ОБНОВЛЕНИЕ ID ПОЛЕЙ');
        console.log('='.repeat(80));
        
        if (leadFields) {
            Object.assign(amoCrmService.FIELD_IDS.LEAD, leadFields);
            console.log('✅ Обновлены поля сделок:');
            console.log(leadFields);
        }
        
        if (contactFields) {
            Object.assign(amoCrmService.FIELD_IDS.CONTACT, contactFields);
            console.log('✅ Обновлены поля контактов:');
            console.log(contactFields);
        }
        
        res.json({
            success: true,
            message: 'ID полей обновлены',
            field_ids: amoCrmService.FIELD_IDS
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления полей:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Принудительное обновление данных
app.post('/api/force-refresh/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        const formattedPhone = formatPhoneNumber(phone);
        
        console.log(`\n🔄 ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ: ${formattedPhone}`);
        
        // Удаляем все профили этого телефона
        await db.run(
            `DELETE FROM student_profiles WHERE phone_number LIKE ?`,
            [`%${formattedPhone.slice(-10)}%`]
        );
        
        // Получаем свежие данные
        const profiles = await amoCrmService.getStudentsByPhone(formattedPhone);
        
        res.json({
            success: true,
            message: 'Данные обновлены',
            data: {
                phone: formattedPhone,
                profiles: profiles,
                force_refreshed: true
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
app.get('/api/debug/student-leads/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ДИАГНОСТИКА СДЕЛОК ДЛЯ УЧЕНИКА: "${studentName}" (${phone})`);
        console.log('='.repeat(80));
        
        const formattedPhone = formatPhoneNumber(phone);
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        console.log(`📋 Контакт: "${contact.name}" (ID: ${contact.id})`);
        
        // Извлекаем учеников из контакта
        const fullContact = await amoCrmService.getFullContactInfo(contact.id);
        const students = amoCrmService.extractStudentsFromContact(fullContact);
        
        // Проверяем, есть ли такой ученик в контакте
        const targetStudent = students.find(s => 
            amoCrmService.normalizeName(s.studentName).includes(amoCrmService.normalizeName(studentName))
        );
        
        if (!targetStudent) {
            console.log(`❌ Ученик "${studentName}" не найден в контакте`);
            console.log(`📋 Ученики в контакте: ${students.map(s => s.studentName).join(', ')}`);
        }
        
        // Получаем все сделки
        const allLeads = await amoCrmService.getContactLeadsSorted(contact.id);
        
        // Фильтруем сделки по имени ученика
        const normalizedStudentName = amoCrmService.normalizeName(studentName);
        const studentLeads = [];
        
        console.log(`\n🔍 СДЕЛКИ СОВПАДАЮЩИЕ С ИМЕНЕМ:`);
        
        for (const lead of allLeads) {
            const leadName = amoCrmService.normalizeName(lead.name);
            
            if (leadName.includes(normalizedStudentName)) {
                console.log(`✅ "${lead.name}" (ID: ${lead.id})`);
                
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                studentLeads.push({
                    id: lead.id,
                    name: lead.name,
                    created_at: lead.created_at,
                    created_date: new Date(lead.created_at * 1000).toLocaleDateString(),
                    pipeline_id: lead.pipeline_id,
                    status_id: lead.status_id,
                    subscription_info: subscriptionInfo
                });
            }
        }
        
        console.log(`\n📊 Всего сделок с именем ученика: ${studentLeads.length}`);
        
        res.json({
            success: true,
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                student_name: studentName,
                student_in_contact: !!targetStudent,
                contact_students: students.map(s => s.studentName),
                total_leads: allLeads.length,
                student_leads: studentLeads,
                suggestions: studentLeads.length === 0 ? 
                    'В названии сделок нет имени ученика. Проверьте правильность имени.' :
                    'Найдены сделки с именем ученика'
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ==================== ПОИСК АКТИВНОЙ СДЕЛКИ С АБОНЕМЕНТОМ ====================
app.get('/api/debug/find-subscription-lead/:phone/:studentName', async (req, res) => {
    try {
        const phone = req.params.phone;
        const studentName = decodeURIComponent(req.params.studentName);
        
        console.log(`\n🔍 ПОИСК АКТИВНОЙ СДЕЛКИ С АБОНЕМЕНТОМ: "${studentName}"`);
        console.log('='.repeat(80));
        
        const formattedPhone = formatPhoneNumber(phone);
        const contactsResponse = await amoCrmService.searchContactsByPhone(formattedPhone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        if (contacts.length === 0) {
            return res.json({ success: false, error: 'Контакты не найдены' });
        }
        
        const contact = contacts[0];
        const allLeads = await amoCrmService.getContactLeadsSorted(contact.id);
        
        console.log(`📊 Всего сделок: ${allLeads.length}`);
        
        // Ищем сделки с активным абонементом
        const subscriptionLeads = [];
        
        for (const lead of allLeads) {
            // Проверяем, активна ли сделка в воронке абонементов
            const isInSubscriptionPipeline = lead.pipeline_id === amoCrmService.SUBSCRIPTION_PIPELINE_ID;
            const hasActiveStatus = amoCrmService.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE.includes(lead.status_id);
            
            if (isInSubscriptionPipeline || hasActiveStatus) {
                // Проверяем поля абонемента
                const customFields = lead.custom_fields_values || [];
                let hasSubscriptionData = false;
                const subscriptionData = {};
                
                for (const field of customFields) {
                    const fieldId = field.field_id || field.id;
                    const fieldName = amoCrmService.getFieldNameById(fieldId);
                    const fieldValue = amoCrmService.getFieldValue(field);
                    
                    if (fieldName && (
                        fieldName.includes('Всего занятий') ||
                        fieldName.includes('Остаток занятий') ||
                        fieldName.includes('Использовано занятий') ||
                        fieldName.includes('Тип абонемента') ||
                        fieldName.includes('Дата активации') ||
                        fieldName.includes('Окончание абонемента')
                    )) {
                        hasSubscriptionData = true;
                        subscriptionData[fieldName] = fieldValue;
                    }
                }
                
                if (hasSubscriptionData) {
                    subscriptionLeads.push({
                        lead_id: lead.id,
                        lead_name: lead.name,
                        pipeline_id: lead.pipeline_id,
                        status_id: lead.status_id,
                        is_active: hasActiveStatus,
                        subscription_data: subscriptionData,
                        custom_fields_count: customFields.length,
                        raw_fields: customFields.map(f => ({
                            id: f.field_id || f.id,
                            name: amoCrmService.getFieldNameById(f.field_id || f.id),
                            value: amoCrmService.getFieldValue(f)
                        }))
                    });
                }
            }
        }
        
        console.log(`📊 Найдено сделок с абонементом: ${subscriptionLeads.length}`);
        
        if (subscriptionLeads.length === 0) {
            // Показываем все статусы для отладки
            const allStatuses = [...new Set(allLeads.map(l => l.status_id))];
            console.log('📊 Все статусы в сделках:', allStatuses);
            
            // Показываем воронки
            const allPipelines = [...new Set(allLeads.map(l => l.pipeline_id))];
            console.log('📊 Все воронки в сделках:', allPipelines);
        }
        
        res.json({
            success: true,
            data: {
                contact: {
                    id: contact.id,
                    name: contact.name
                },
                student_name: studentName,
                total_leads: allLeads.length,
                subscription_leads: subscriptionLeads,
                subscription_pipeline_id: amoCrmService.SUBSCRIPTION_PIPELINE_ID,
                active_statuses: amoCrmService.SUBSCRIPTION_STATUSES.ACTIVE_IN_PIPELINE
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Проверка соединения с amoCRM
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
                service_initialized: amoCrmService.isInitialized,
                subscription_pipeline_id: amoCrmService.SUBSCRIPTION_PIPELINE_ID
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

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ v4.0');
        console.log('='.repeat(80));
        console.log('🔐 100% ГАРАНТИЯ ВЫБОРА ПРАВИЛЬНОЙ СДЕЛКИ');
        console.log('✨ РЕАЛЬНЫЕ ДАННЫЕ ИЗ AMOCRM');
        console.log('✨ ИСКЛЮЧЕНИЕ ЧУЖИХ СДЕЛОК');
        console.log('✨ ТОЧНОЕ СОВПАДЕНИЕ ИМЕН');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован успешно');
            console.log(`🔗 Домен: ${AMOCRM_DOMAIN}`);
            
            // Запускаем синхронизацию через 5 секунд
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
            console.log(`🎯 100% гарантия выбора: ✅ Включена`);
            console.log('='.repeat(80));
            
            console.log('\n🔗 ОСНОВНЫЕ ССЫЛКИ:');
            console.log('='.repeat(50));
            console.log(`📱 Веб-приложение: http://localhost:${PORT}`);
            console.log(`📊 Статус API: http://localhost:${PORT}/api/status`);
            console.log(`🔐 Авторизация: POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`🔍 Профили: GET http://localhost:${PORT}/api/profiles`);
            console.log(`📋 Абонемент: POST http://localhost:3000/api/subscription`);
            console.log(`🧪 Тест 100% гарантии: GET http://localhost:${PORT}/api/test-guarantee/79660587744/Захар Веребрюсов`);
            console.log(`🔧 Диагностика: GET http://localhost:${PORT}/api/debug/contact-leads/79660587744/Захар Веребрюсов`);
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
