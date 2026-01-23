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

// ДОБАВЬТЕ этот метод в класс AmoCrmService
async debugLeadFields(leadId) {
    try {
        console.log(`\n🔍 ДИАГНОСТИКА ПОЛЕЙ СДЕЛКИ ${leadId}`);
        
        const lead = await this.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values`
        );
        
        if (!lead) {
            console.log('❌ Сделка не найдена');
            return;
        }
        
        console.log(`📋 Название сделки: "${lead.name}"`);
        console.log(`📊 Поля сделки:`);
        console.log('='.repeat(80));
        
        if (!lead.custom_fields_values || lead.custom_fields_values.length === 0) {
            console.log('❌ Нет пользовательских полей');
            return;
        }
        
        // Группируем поля по ID
        const fieldMap = {};
        
        lead.custom_fields_values.forEach((field, index) => {
            const fieldId = field.field_id || field.id;
            const fieldName = this.getFieldNameById(fieldId);
            const fieldValue = this.getFieldValue(field);
            const rawValues = field.values || [];
            
            fieldMap[fieldId] = {
                name: fieldName,
                value: fieldValue,
                raw: rawValues
            };
            
            console.log(`${index + 1}. Поле ID: ${fieldId}`);
            console.log(`   Название: ${fieldName}`);
            console.log(`   Значение: "${fieldValue}"`);
            console.log(`   RAW values:`, JSON.stringify(rawValues, null, 2));
            
            // Особое внимание к полю "Абонемент занятий:"
            if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES) {
                console.log(`   ⭐ ЭТО ПОЛЕ "АБОНЕМЕНТ ЗАНЯТИЙ:"`);
                console.log(`     Парсинг значения: "${fieldValue}"`);
                
                if (rawValues.length > 0) {
                    const firstValue = rawValues[0];
                    if (typeof firstValue === 'object') {
                        console.log(`     Объект raw value:`, firstValue);
                        console.log(`     enum_id: ${firstValue.enum_id}`);
                        console.log(`     enum_value: ${firstValue.enum_value}`);
                        console.log(`     value: ${firstValue.value}`);
                    }
                }
            }
            console.log('---');
        });
        
        // Выводим важные поля
        console.log('\n🎯 ВАЖНЫЕ ПОЛЯ АБОНЕМЕНТА:');
        console.log('='.repeat(80));
        
        const importantFields = [
            this.FIELD_IDS.LEAD.TOTAL_CLASSES,
            this.FIELD_IDS.LEAD.TECHNICAL_CLASSES,
            this.FIELD_IDS.LEAD.USED_CLASSES,
            this.FIELD_IDS.LEAD.REMAINING_CLASSES,
            this.FIELD_IDS.LEAD.EXPIRATION_DATE,
            this.FIELD_IDS.LEAD.ACTIVATION_DATE
        ];
        
        importantFields.forEach(fieldId => {
            if (fieldMap[fieldId]) {
                const field = fieldMap[fieldId];
                console.log(`Поле ${fieldId} (${field.name}):`);
                console.log(`  Значение: "${field.value}"`);
                console.log(`  RAW:`, JSON.stringify(field.raw));
            }
        });
        
        // Анализируем данные
        const subscriptionData = this.extractSubscriptionData(lead);
        
        console.log('\n📊 РЕЗУЛЬТАТ АНАЛИЗА:');
        console.log('='.repeat(80));
        console.log(`Всего занятий: ${subscriptionData.totalClasses}`);
        console.log(`Использовано: ${subscriptionData.usedClasses}`);
        console.log(`Осталось: ${subscriptionData.remainingClasses}`);
        console.log(`Дата окончания: ${subscriptionData.expirationDate || 'не указана'}`);
        
        return {
            lead: lead,
            fields: fieldMap,
            subscription: subscriptionData
        };
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error.message);
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
    // ЗАМЕНИТЕ метод extractSubscriptionData на этот:
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
    
    console.log(`\n📊 Анализ полей сделки ID: ${lead.id} ("${lead.name}")`);
    
    // Проходим по ВСЕМ полям и группируем их для отладки
    const fieldsByType = {};
    
    lead.custom_fields_values.forEach(field => {
        const fieldId = field.field_id || field.id;
        const fieldName = this.getFieldNameById(fieldId);
        const fieldValue = this.getFieldValue(field);
        const rawValues = field.values || [];
        
        console.log(`   📋 Поле ${fieldId} (${fieldName}): "${fieldValue}"`);
        console.log(`     📌 RAW values:`, JSON.stringify(rawValues));
        
        // Сохраняем для анализа
        if (!fieldsByType[fieldId]) {
            fieldsByType[fieldId] = [];
        }
        fieldsByType[fieldId].push({
            value: fieldValue,
            raw: rawValues
        });
        
        // ОБЩЕЕ КОЛИЧЕСТВО ЗАНЯТИЙ - поле 850241 (селект)
        if (fieldId === this.FIELD_IDS.LEAD.TOTAL_CLASSES) {
            console.log(`   🎯 Это поле "Абонемент занятий:" (${fieldId})`);
            
            // Смотрим на raw values чтобы получить enum_id
            if (rawValues.length > 0) {
                const firstValue = rawValues[0];
                if (typeof firstValue === 'object' && firstValue !== null) {
                    // Пытаемся получить enum_id
                    const enumId = firstValue.enum_id || firstValue.enum_value || firstValue.value;
                    console.log(`     🎯 enum_id: ${enumId}`);
                    
                    // Мапим enum_id на количество занятий
                    const classCountMap = {
                        // Основные значения
                        '504033': 4,   // "4 занятия"
                        '504035': 8,   // "8 занятий"
                        '504037': 16,  // "16 занятий"
                        '557385': 24,  // "24 Занятия"
                        '557137': 2,   // "2 занятия"
                        '557139': 3,   // "3 занятия"
                        '504237': 5,   // "База Блок № 1 - 5 занятий"
                        '504239': 6,   // "База Блок № 2 - 6 занятий"
                        '504241': 5,   // "База Блок № 3 - 5 занятий"
                        '504243': 16,  // "База - 16 занятий"
                        '504039': 4,   // "Продвинутый 4 занятия"
                        '504041': 8,   // "Продвинутый 8 занятий"
                        '504043': 16,  // "Продвинутый 16 занятий"
                        '507129': 1    // "Разовый"
                    };
                    
                    if (classCountMap[enumId]) {
                        data.totalClasses = classCountMap[enumId];
                        console.log(`     ✅ Определено: ${data.totalClasses} занятий`);
                    } else {
                        // Парсим из текста
                        const parsed = this.parseClassCountFromSelect(fieldValue);
                        if (parsed > 0) {
                            data.totalClasses = parsed;
                            console.log(`     📊 Парсинг из текста: ${data.totalClasses} занятий`);
                        }
                    }
                } else {
                    // Если это просто строка
                    const parsed = this.parseClassCountFromSelect(fieldValue);
                    if (parsed > 0) {
                        data.totalClasses = parsed;
                        console.log(`     📊 Парсинг из строки: ${data.totalClasses} занятий`);
                    }
                }
            }
        }
        
        // ТЕХНИЧЕСКОЕ КОЛИЧЕСТВО ЗАНЯТИЙ - поле 891819 (числовое)
        else if (fieldId === this.FIELD_IDS.LEAD.TECHNICAL_CLASSES) {
            console.log(`   🎯 Это поле "Количество занятий (тех)" (${fieldId})`);
            const techClasses = parseInt(fieldValue);
            if (!isNaN(techClasses) && techClasses > 0) {
                data.totalClasses = techClasses;
                console.log(`     ✅ Техническое количество: ${techClasses} занятий`);
            }
        }
        
        // СЧЕТЧИК ЗАНЯТИЙ - поле 850257 (селект 1-24)
        else if (fieldId === this.FIELD_IDS.LEAD.USED_CLASSES) {
            console.log(`   🎯 Это поле "Счетчик занятий:" (${fieldId})`);
            const used = parseInt(fieldValue);
            if (!isNaN(used) && used >= 1 && used <= 24) {
                data.usedClasses = used;
                console.log(`     ✅ Счетчик: ${used} занятий`);
            }
        }
        
        // ОСТАТОК ЗАНЯТИЙ - поле 890163 (числовое)
        else if (fieldId === this.FIELD_IDS.LEAD.REMAINING_CLASSES) {
            console.log(`   🎯 Это поле "Остаток занятий" (${fieldId})`);
            const remaining = parseInt(fieldValue);
            if (!isNaN(remaining) && remaining >= 0) {
                data.remainingClasses = remaining;
                console.log(`     ✅ Остаток: ${remaining} занятий`);
            }
        }
        
        // ДАТА ОКОНЧАНИЯ - поле 850255
        else if (fieldId === this.FIELD_IDS.LEAD.EXPIRATION_DATE) {
            console.log(`   🎯 Это поле "Окончание абонемента:" (${fieldId})`);
            const date = this.parseDate(fieldValue);
            if (date) {
                data.expirationDate = date;
                console.log(`     ✅ Дата окончания: ${date}`);
            }
        }
        
        // ДАТА АКТИВАЦИИ - поле 851565
        else if (fieldId === this.FIELD_IDS.LEAD.ACTIVATION_DATE) {
            console.log(`   🎯 Это поле "Дата активации абонемента:" (${fieldId})`);
            const date = this.parseDate(fieldValue);
            if (date) {
                data.activationDate = date;
                console.log(`     ✅ Дата активации: ${date}`);
            }
        }
        
        // ДАТА ПОСЛЕДНЕГО ВИЗИТА - поле 850259
        else if (fieldId === this.FIELD_IDS.LEAD.LAST_VISIT_DATE) {
            console.log(`   🎯 Это поле "Дата последнего визита:" (${fieldId})`);
            const date = this.parseDate(fieldValue);
            if (date) {
                data.lastVisitDate = date;
                console.log(`     ✅ Последний визит: ${date}`);
            }
        }
        
        // ТИП АБОНЕМЕНТА - поле 891007
        else if (fieldId === this.FIELD_IDS.LEAD.SUBSCRIPTION_TYPE) {
            data.subscriptionType = fieldValue;
            console.log(`     ✅ Тип абонемента: ${fieldValue}`);
        }
        
        // ЗАМОРОЗКА - поле 867693
        else if (fieldId === this.FIELD_IDS.LEAD.FREEZE) {
            data.isFrozen = fieldValue === 'ДА' || fieldValue === '1' || fieldValue.toLowerCase() === 'да';
            console.log(`     ✅ Заморозка: ${data.isFrozen ? 'ДА' : 'НЕТ'}`);
        }
        
        // ФИЛИАЛ - поле 891589
        else if (fieldId === this.FIELD_IDS.LEAD.BRANCH) {
            data.branch = fieldValue;
            console.log(`     ✅ Филиал: ${fieldValue}`);
        }
    });
    
    // ЛОГИКА ВЫЧИСЛЕНИЯ ПРОПУЩЕННЫХ ДАННЫХ
    console.log(`\n🧮 ВЫЧИСЛЕНИЕ ПРОПУЩЕННЫХ ДАННЫХ:`);
    
    // Если не нашли техническое количество, но нашли в селекте
    if (data.totalClasses === 0) {
        console.log(`   ⚠️  Общее количество занятий не найдено`);
    }
    
    // Если есть общее количество, но нет счётчика или остатка
    if (data.totalClasses > 0) {
        // Если нет остатка, но есть счётчик - вычисляем остаток
        if (data.remainingClasses === 0 && data.usedClasses > 0) {
            data.remainingClasses = Math.max(0, data.totalClasses - data.usedClasses);
            console.log(`   📊 Вычислен остаток: ${data.totalClasses} - ${data.usedClasses} = ${data.remainingClasses}`);
        }
        
        // Если нет счётчика, но есть остаток - вычисляем счётчик
        if (data.usedClasses === 0 && data.remainingClasses > 0) {
            data.usedClasses = Math.max(0, data.totalClasses - data.remainingClasses);
            console.log(`   📊 Вычислен счётчик: ${data.totalClasses} - ${data.remainingClasses} = ${data.usedClasses}`);
        }
        
        // Если ни счётчик, ни остаток не указаны
        if (data.usedClasses === 0 && data.remainingClasses === 0) {
            // Считаем, что все занятия доступны
            data.remainingClasses = data.totalClasses;
            console.log(`   📊 Установлен остаток по умолчанию: ${data.remainingClasses} занятий`);
        }
        
        // Проверка корректности
        const calculatedTotal = data.usedClasses + data.remainingClasses;
        if (calculatedTotal !== data.totalClasses) {
            console.warn(`   ⚠️  НЕСООТВЕТСТВИЕ: ${data.usedClasses} + ${data.remainingClasses} ≠ ${data.totalClasses}`);
            // Корректируем остаток
            data.remainingClasses = Math.max(0, data.totalClasses - data.usedClasses);
            console.log(`   🔧 Исправлен остаток: ${data.remainingClasses}`);
        }
    }
    
    console.log(`\n📊 ИТОГОВЫЕ ДАННЫЕ АБОНЕМЕНТА:`);
    console.log(`   • Всего занятий: ${data.totalClasses}`);
    console.log(`   • Использовано: ${data.usedClasses}`);
    console.log(`   • Осталось: ${data.remainingClasses}`);
    console.log(`   • Дата окончания: ${data.expirationDate || 'не указана'}`);
    console.log(`   • Дата активации: ${data.activationDate || 'не указана'}`);
    console.log(`   • Заморозка: ${data.isFrozen ? 'ДА' : 'НЕТ'}`);
    
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
        
        // Периодическая синхронизация
        setInterval(async () => {
            await this.syncAllProfiles();
        }, 10 * 60 * 1000);
    }

    async syncAllProfiles() {
        if (this.isSyncing) {
            console.log('⚠️  Синхронизация уже выполняется');
            return;
        }

        this.isSyncing = true;
        const startTime = Date.now();

        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔄 ЗАПУСК СИНХРОНИЗАЦИИ`);
        console.log(`⏰ Время: ${new Date().toISOString()}`);
        console.log('='.repeat(80));

        try {
            // Получаем все уникальные номера
            const phones = await db.all(
                `SELECT DISTINCT phone_number FROM student_profiles WHERE is_active = 1`
            );

            console.log(`📊 Найдено телефонов: ${phones.length}`);

            let totalUpdated = 0;
            let totalErrors = 0;

            // Для каждого телефона
            for (const phoneRow of phones) {
                const phone = phoneRow.phone_number;
                
                try {
                    console.log(`\n🔍 Синхронизация телефона: ${phone}`);
                    
                    // Получаем данные из amoCRM
                    const profiles = await amoCrmService.getStudentDataByPhone(phone);
                    
                    // Сохраняем в базу
                    const savedCount = await saveProfilesToDatabase(profiles);
                    
                    console.log(`✅ Обновлено: ${savedCount}`);
                    totalUpdated += savedCount;
                    
                } catch (phoneError) {
                    console.error(`❌ Ошибка телефона ${phone}:`, phoneError.message);
                    totalErrors++;
                }
            }

            const duration = Date.now() - startTime;
            this.lastSyncTime = new Date();

            // Логируем результат
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
            console.error('❌ Критическая ошибка:', error.message);
            
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
        console.log(`\n🔧 РУЧНАЯ СИНХРОНИЗАЦИЯ: ${phoneNumber}`);
        
        try {
            const profiles = await amoCrmService.getStudentDataByPhone(phoneNumber);
            const savedCount = await saveProfilesToDatabase(profiles);
            
            console.log(`✅ Синхронизация завершена`);
            console.log(`📊 Обновлено: ${savedCount}`);
            
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
async function saveProfilesToDatabase(profiles) {
    try {
        console.log(`💾 Сохранение профилей в БД...`);
        let savedCount = 0;
        
        for (const profile of profiles) {
            try {
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
                    // Вставка нового
                    const placeholders = columns.map(() => '?').join(', ');
                    const columnNames = columns.join(', ');
                    
                    const result = await db.run(
                        `INSERT INTO student_profiles (${columnNames}) VALUES (${placeholders})`,
                        values
                    );
                    
                    console.log(`✅ Профиль создан (ID: ${result.lastID}): ${profile.student_name}`);
                    savedCount++;
                } else {
                    // Обновление существующего
                    const setClause = columns.map(col => `${col} = ?`).join(', ');
                    
                    await db.run(
                        `UPDATE student_profiles SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [...values, existingProfile.id]
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
        
        // Если не нашли, ищем в локальной базе
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
            console.error(`❌ Ошибка сессии: ${dbError.message}`);
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
        
        // Форматируем профили
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
            message: profiles.length > 0 ? 'Найдены профили' : 'Профили не найдены',
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
            // Ищем по ID в базе
            profile = await db.get(
                `SELECT * FROM student_profiles WHERE id = ?`,
                [parseInt(profile_id)]
            );
            
            if (!profile && profile_id.startsWith('profile-')) {
                const index = parseInt(profile_id.replace('profile-', ''));
                console.log(`🔍 Временный ID, индекс: ${index}`);
                
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
                        console.log(`✅ Найден по индексу: ${profile.student_name}`);
                    }
                }
            }
        } 
        
        // Если не нашли, ищем по телефону
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
            error: 'Ошибка получения информации'
        });
    }
});



// ==================== ДИАГНОСТИЧЕСКИЕ МАРШРУТЫ ====================


// ДОБАВЬТЕ этот маршрут в раздел ДИАГНОСТИЧЕСКИЙ API
app.get('/api/debug/lead/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        
        console.log(`\n🔍 ДИАГНОСТИКА СДЕЛКИ ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                message: 'amoCRM не подключен'
            });
        }
        
        const result = await amoCrmService.debugLeadFields(leadId);
        
        if (!result) {
            return res.status(404).json({
                success: false,
                message: 'Сделка не найдена'
            });
        }
        
        res.json({
            success: true,
            lead_id: leadId,
            lead_name: result.lead.name,
            subscription: result.subscription,
            important_fields: {
                total_classes: {
                    field_id: amoCrmService.FIELD_IDS.LEAD.TOTAL_CLASSES,
                    value: result.subscription.totalClasses,
                    raw_data: result.fields[amoCrmService.FIELD_IDS.LEAD.TOTAL_CLASSES]
                },
                technical_classes: {
                    field_id: amoCrmService.FIELD_IDS.LEAD.TECHNICAL_CLASSES,
                    raw_data: result.fields[amoCrmService.FIELD_IDS.LEAD.TECHNICAL_CLASSES]
                },
                used_classes: {
                    field_id: amoCrmService.FIELD_IDS.LEAD.USED_CLASSES,
                    value: result.subscription.usedClasses,
                    raw_data: result.fields[amoCrmService.FIELD_IDS.LEAD.USED_CLASSES]
                },
                remaining_classes: {
                    field_id: amoCrmService.FIELD_IDS.LEAD.REMAINING_CLASSES,
                    value: result.subscription.remainingClasses,
                    raw_data: result.fields[amoCrmService.FIELD_IDS.LEAD.REMAINING_CLASSES]
                }
            },
            all_fields: Object.keys(result.fields).map(id => ({
                field_id: parseInt(id),
                field_name: amoCrmService.getFieldNameById(parseInt(id)),
                value: result.fields[id].value,
                raw_values: result.fields[id].raw
            }))
        });
        
    } catch (error) {
        console.error('❌ Ошибка диагностики сделки:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка диагностики',
            error: error.message
        });
    }
});

// Добавьте этот маршрут в раздел ДИАГНОСТИЧЕСКИЕ МАРШРУТЫ
app.get('/api/debug/all-crm-fields', async (req, res) => {
    try {
        console.log('\n📋 ПОЛУЧЕНИЕ ВСЕХ ПОЛЕЙ AMOCRM');
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        // Получаем ВСЕ поля сделок
        console.log('🔍 Получение полей сделок...');
        const leadFieldsResponse = await amoCrmService.makeRequest(
            'GET',
            '/api/v4/leads/custom_fields'
        );
        
        // Получаем ВСЕ поля контактов
        console.log('🔍 Получение полей контактов...');
        const contactFieldsResponse = await amoCrmService.makeRequest(
            'GET',
            '/api/v4/contacts/custom_fields'
        );
        
        const leadFields = leadFieldsResponse._embedded?.custom_fields || [];
        const contactFields = contactFieldsResponse._embedded?.custom_fields || [];
        
        console.log(`📊 Поля сделок: ${leadFields.length}`);
        console.log(`📊 Поля контактов: ${contactFields.length}`);
        
        // Форматируем для удобного просмотра
        const formattedLeadFields = leadFields.map(field => ({
            id: field.id,
            name: field.name,
            type: field.type,
            code: field.code || null,
            sort: field.sort,
            is_editable: field.is_editable || false,
            enums: field.enums ? field.enums.map(e => ({
                id: e.id,
                value: e.value,
                sort: e.sort
            })) : [],
            group_id: field.group_id || null,
            account_id: field.account_id
        }));
        
        const formattedContactFields = contactFields.map(field => ({
            id: field.id,
            name: field.name,
            type: field.type,
            code: field.code || null,
            sort: field.sort,
            is_editable: field.is_editable || false,
            enums: field.enums ? field.enums.map(e => ({
                id: e.id,
                value: e.value,
                sort: e.sort
            })) : [],
            group_id: field.group_id || null,
            account_id: field.account_id
        }));
        
        // Находим поля, связанные с абонементами
        const subscriptionKeywords = [
            'абонемент', 'занят', 'урок', 'счетчик', 'остаток', 
            'активации', 'окончание', 'последний визит', 'филиал',
            'преподаватель', 'тип абонемента', 'заморозка'
        ];
        
        const leadSubscriptionFields = formattedLeadFields.filter(field => 
            subscriptionKeywords.some(keyword => 
                field.name.toLowerCase().includes(keyword.toLowerCase())
            )
        );
        
        const contactSubscriptionFields = formattedContactFields.filter(field => 
            subscriptionKeywords.some(keyword => 
                field.name.toLowerCase().includes(keyword.toLowerCase())
            )
        );
        
        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            data: {
                summary: {
                    total_lead_fields: leadFields.length,
                    total_contact_fields: contactFields.length,
                    subscription_lead_fields: leadSubscriptionFields.length,
                    subscription_contact_fields: contactSubscriptionFields.length
                },
                
                // Все поля (первые 100 для каждого типа)
                all_lead_fields_sample: formattedLeadFields.slice(0, 100),
                all_contact_fields_sample: formattedContactFields.slice(0, 100),
                
                // Только поля, связанные с абонементами
                subscription_lead_fields: leadSubscriptionFields,
                subscription_contact_fields: contactSubscriptionFields,
                
                // ID полей, которые используются в системе
                configured_field_ids: amoCrmService.FIELD_IDS,
                
                // Для поиска конкретных полей
                search_tips: {
                    lead_fields_by_id: 'Используйте Ctrl+F для поиска по ID',
                    contact_fields_by_id: 'Используйте Ctrl+F для поиска по ID',
                    common_subscription_fields: [
                        'Абонемент занятий:',
                        'Счетчик занятий:',
                        'Остаток занятий',
                        'Дата активации абонемента:',
                        'Окончание абонемента:',
                        'Тип абонемента',
                        'Филиал:',
                        'Преподаватель'
                    ]
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения полей:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения полей',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
                service_initialized: amoCrmService.isInitialized,
                field_mapping: amoCrmService.FIELD_IDS
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка соединения',
            error: error.message
        });
    }
});

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
        
        const formattedPhone = formatPhoneNumber(phone);
        
        // 1. Ищем контакты
        console.log('🔍 Поиск контактов...');
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        const contactsInfo = contacts.map(contact => ({
            id: contact.id,
            name: contact.name,
            created_at: contact.created_at,
            updated_at: contact.updated_at,
            fields_count: contact.custom_fields_values ? contact.custom_fields_values.length : 0
        }));
        
        console.log(`📊 Контактов: ${contacts.length}`);
        
        // 2. Получаем профили
        console.log('🎯 Получение профилей...');
        const profiles = await amoCrmService.getStudentDataByPhone(phone);

        
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
        
        console.log(`📊 Профилей: ${profiles.length}`);
        
        // 3. Проверяем локальную базу
        console.log('💾 Проверка базы...');
        const cleanPhone = phone.replace(/\D/g, '');
        const localProfiles = await db.all(
            `SELECT student_name, branch, subscription_status, total_classes, remaining_classes, last_sync 
             FROM student_profiles 
             WHERE phone_number LIKE ? AND is_active = 1`,
            [`%${cleanPhone.slice(-10)}%`]
        );
        
        res.json({
            success: true,
            message: 'Диагностика выполнена',
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
        console.error('❌ Ошибка диагностики:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка диагностики',
            error: error.message,
            phone: req.params.phone
        });
    }
});

app.get('/api/debug/system-status', async (req, res) => {
    try {
        console.log('\n⚙️  СТАТУС СИСТЕМЫ');
        
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
        console.error('❌ Ошибка статуса:', error.message);
        res.status(500).json({
            success: false,
            message: 'Ошибка получения статуса',
            error: error.message
        });
    }
});


// ==================== ДИАГНОСТИЧЕСКИЙ API ====================
app.get('/api/debug/full-diagnostic/:phone', async (req, res) => {
    try {
        const phone = req.params.phone;
        console.log(`\n🔍 ПОЛНАЯ ДИАГНОСТИКА ДЛЯ: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        // 1. Поиск контактов
        console.log('🔍 Поиск контактов по телефону...');
        const contactsResponse = await amoCrmService.searchContactsByPhone(phone);
        const contacts = contactsResponse._embedded?.contacts || [];
        
        const detailedContacts = [];
        
        // 2. Для каждого контакта получаем ПОЛНЫЕ данные
        for (const contact of contacts) {
            console.log(`\n📋 Анализ контакта ID: ${contact.id} - "${contact.name}"`);
            
            // Получаем полные данные контакта
            const fullContact = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/contacts/${contact.id}?with=custom_fields_values`
            );
            
            // Получаем все сделки контакта
            const leads = await amoCrmService.makeRequest(
                'GET',
                `/api/v4/leads?with=custom_fields_values&filter[contact_id]=${contact.id}&limit=50`
            );
            
            const contactLeads = leads._embedded?.leads || [];
            
            // Подробный анализ полей контакта
            const contactFields = fullContact.custom_fields_values || [];
            const analyzedContactFields = contactFields.map(field => {
                const fieldName = amoCrmService.getFieldName(field);
                const fieldValue = amoCrmService.getFieldValue(field);
                
                return {
                    id: field.field_id || field.id,
                    name: fieldName,
                    value: fieldValue,
                    raw_field: field
                };
            });
            
            // Подробный анализ каждой сделки
            const analyzedLeads = [];
            for (const lead of contactLeads) {
                console.log(`   📊 Анализ сделки ID: ${lead.id} - "${lead.name}"`);
                
                const leadFields = lead.custom_fields_values || [];
                const analyzedLeadFields = leadFields.map(field => {
                    const fieldName = amoCrmService.getFieldName(field);
                    const fieldValue = amoCrmService.getFieldValue(field);
                    
                    return {
                        id: field.field_id || field.id,
                        name: fieldName,
                        value: fieldValue,
                        raw_field: field
                    };
                });
                
                // Извлекаем информацию об абонементе
                const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
                
                analyzedLeads.push({
                    lead_id: lead.id,
                    lead_name: lead.name,
                    status_id: lead.status_id,
                    created_at: lead.created_at,
                    price: lead.price,
                    subscription_info: subscriptionInfo,
                    custom_fields: analyzedLeadFields,
                    raw_lead: lead // Полные сырые данные
                });
            }
            
            detailedContacts.push({
                contact_id: fullContact.id,
                contact_name: fullContact.name,
                created_at: fullContact.created_at,
                updated_at: fullContact.updated_at,
                email: amoCrmService.findEmail(fullContact),
                custom_fields: analyzedContactFields,
                leads_count: contactLeads.length,
                leads: analyzedLeads,
                raw_contact: fullContact // Полные сырые данные контакта
            });
        }
        
        // 3. Запрос всех пользовательских полей системы
        console.log('📋 Получение всех пользовательских полей amoCRM...');
        let allFields = { lead: [], contact: [] };
        
        try {
            const leadFields = await amoCrmService.makeRequest('GET', '/api/v4/leads/custom_fields');
            const contactFields = await amoCrmService.makeRequest('GET', '/api/v4/contacts/custom_fields');
            
            allFields = {
                lead: leadFields._embedded?.custom_fields || [],
                contact: contactFields._embedded?.custom_fields || []
            };
        } catch (error) {
            console.error('❌ Ошибка получения полей:', error.message);
        }
        
        // 4. Формируем отчет
        const report = {
            success: true,
            diagnostic_time: new Date().toISOString(),
            phone_number: phone,
            search_results: {
                total_contacts: contacts.length,
                contacts: detailedContacts
            },
            system_info: {
                amocrm_initialized: amoCrmService.isInitialized,
                account_name: amoCrmService.accountInfo?.name,
                field_mappings_size: amoCrmService.fieldMappings.size,
                configured_field_ids: amoCrmService.FIELD_IDS
            },
            available_fields: {
                total_lead_fields: allFields.lead.length,
                total_contact_fields: allFields.contact.length,
                lead_fields_sample: allFields.lead.slice(0, 20).map(f => ({
                    id: f.id,
                    name: f.name,
                    type: f.type,
                    enums: f.enums ? f.enums.slice(0, 5) : []
                })),
                contact_fields_sample: allFields.contact.slice(0, 20).map(f => ({
                    id: f.id,
                    name: f.name,
                    type: f.type,
                    enums: f.enums ? f.enums.slice(0, 5) : []
                }))
            },
            recommendations: []
        };
        
        // 5. Анализ и рекомендации
        if (contacts.length === 0) {
            report.recommendations.push("❌ Контакты не найдены. Проверьте формат телефона в amoCRM.");
        } else {
            report.recommendations.push(`✅ Найдено контактов: ${contacts.length}`);
            
            for (const contact of detailedContacts) {
                if (contact.leads_count === 0) {
                    report.recommendations.push(`⚠️ Контакт "${contact.contact_name}" не имеет сделок`);
                } else {
                    const activeSubs = contact.leads.filter(l => l.subscription_info.hasSubscription);
                    if (activeSubs.length === 0) {
                        report.recommendations.push(`⚠️ У контакта "${contact.contact_name}" нет сделок с абонементами`);
                    } else {
                        report.recommendations.push(`✅ Контакт "${contact.contact_name}" имеет ${activeSubs.length} сделок с абонементами`);
                    }
                }
            }
        }
        
        console.log(`\n📊 Диагностика завершена. Контактов: ${contacts.length}`);
        res.json(report);
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка диагностики',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

app.get('/api/debug/search-leads/:query', async (req, res) => {
    try {
        const query = req.params.query;
        console.log(`\n🔍 ПОИСК СДЕЛОК ПО ЗАПРОСУ: "${query}"`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        // Ищем сделки по названию
        const leadsResponse = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads?query=${encodeURIComponent(query)}&with=custom_fields_values&limit=20`
        );
        
        const leads = leadsResponse._embedded?.leads || [];
        
        const analyzedLeads = leads.map(lead => {
            const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
            
            return {
                lead_id: lead.id,
                lead_name: lead.name,
                status_id: lead.status_id,
                price: lead.price,
                created_at: lead.created_at,
                subscription_info: subscriptionInfo,
                custom_fields_count: lead.custom_fields_values?.length || 0
            };
        });
        
        res.json({
            success: true,
            query: query,
            total_found: leads.length,
            leads: analyzedLeads,
            search_examples: [
                "Фёдор Шигин",
                "Баранова Настя",
                "8 занятий",
                "16 занятий",
                "абонемент",
                "Активный абонемент"
            ]
        });
        
    } catch (error) {
        console.error('❌ Ошибка поиска:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка поиска',
            error: error.message
        });
    }
});

app.get('/api/debug/lead/:id', async (req, res) => {
    try {
        const leadId = req.params.id;
        console.log(`\n🔍 ДЕТАЛЬНЫЙ АНАЛИЗ СДЕЛКИ ID: ${leadId}`);
        
        if (!amoCrmService.isInitialized) {
            return res.json({
                success: false,
                message: 'amoCRM не инициализирован'
            });
        }
        
        // Получаем полные данные сделки
        const lead = await amoCrmService.makeRequest(
            'GET',
            `/api/v4/leads/${leadId}?with=custom_fields_values,contacts`
        );
        
        if (!lead) {
            return res.status(404).json({
                success: false,
                message: 'Сделка не найдена'
            });
        }
        
        // Анализ полей сделки
        const leadFields = lead.custom_fields_values || [];
        const analyzedFields = leadFields.map(field => {
            const fieldName = amoCrmService.getFieldName(field);
            const fieldValue = amoCrmService.getFieldValue(field);
            
            return {
                field_id: field.field_id || field.id,
                field_name: fieldName,
                field_value: fieldValue,
                raw_value: field.values,
                is_subscription_field: (
                    fieldName.includes('абонемент') ||
                    fieldName.includes('занят') ||
                    fieldName.includes('счетчик') ||
                    fieldName.includes('остаток') ||
                    fieldName.includes('активации') ||
                    fieldName.includes('окончание')
                )
            };
        });
        
        // Извлекаем информацию об абонементе
        const subscriptionInfo = amoCrmService.extractSubscriptionInfo(lead);
        
        // Находим связанные контакты
        const contacts = lead._embedded?.contacts || [];
        const contactDetails = [];
        
        for (const contact of contacts) {
            try {
                const fullContact = await amoCrmService.makeRequest(
                    'GET',
                    `/api/v4/contacts/${contact.id}?with=custom_fields_values`
                );
                
                const contactFields = fullContact.custom_fields_values || [];
                const analyzedContactFields = contactFields.map(field => ({
                    id: field.field_id || field.id,
                    name: amoCrmService.getFieldName(field),
                    value: amoCrmService.getFieldValue(field)
                }));
                
                contactDetails.push({
                    contact_id: fullContact.id,
                    contact_name: fullContact.name,
                    phone: '', // Нужно извлечь из полей
                    email: amoCrmService.findEmail(fullContact),
                    custom_fields: analyzedContactFields
                });
            } catch (contactError) {
                console.error(`❌ Ошибка контакта ${contact.id}:`, contactError.message);
            }
        }
        
        // Анализ названия сделки на наличие абонемента
        const nameAnalysis = {
            original_name: lead.name,
            contains_абонемент: lead.name.toLowerCase().includes('абонемент'),
            contains_занятий: lead.name.toLowerCase().includes('занят'),
            contains_numbers: lead.name.match(/\d+/g) || [],
            subscription_parse_result: amoCrmService.parseLeadNameForSubscription(lead.name)
        };
        
        res.json({
            success: true,
            lead_id: lead.id,
            lead_name: lead.name,
            status_id: lead.status_id,
            pipeline_id: lead.pipeline_id,
            price: lead.price,
            created_at: lead.created_at,
            updated_at: lead.updated_at,
            
            name_analysis: nameAnalysis,
            subscription_info: subscriptionInfo,
            
            custom_fields: {
                total: leadFields.length,
                fields: analyzedFields,
                subscription_fields: analyzedFields.filter(f => f.is_subscription_field)
            },
            
            contacts: {
                total: contacts.length,
                details: contactDetails
            },
            
            raw_data_sample: {
                name: lead.name,
                status_id: lead.status_id,
                first_5_fields: analyzedFields.slice(0, 5)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа сделки:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка анализа сделки',
            error: error.message
        });
    }
});

// ==================== ДОПОЛНИТЕЛЬНЫЕ API ====================
app.get('/api/profile/:id', async (req, res) => {
    try {
        const profileId = req.params.id;
        
        console.log(`👤 ЗАПРОС ПРОФИЛЯ: ${profileId}`);
        
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
        console.error('❌ Ошибка профиля:', error);
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
        console.error('❌ Ошибка профилей:', error);
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
        res.json({
            success: true,
            data: {
                connected: amoCrmService.isInitialized,
                account_name: amoCrmService.accountInfo?.name || null,
                subdomain: AMOCRM_SUBDOMAIN,
                last_check: new Date().toISOString(),
                field_count: amoCrmService.fieldMappings.size
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка статуса CRM:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки статуса CRM'
        });
    }
});

app.get('/api/sync/status', async (req, res) => {
    try {
        const status = syncService.getSyncStatus();
        
        const lastSync = await db.get(
            `SELECT * FROM sync_logs 
             WHERE sync_type = 'auto_sync' 
             ORDER BY created_at DESC LIMIT 1`
        );
        
        res.json({
            success: true,
            data: {
                sync_status: status,
                last_sync: lastSync || null,
                total_profiles: await db.get(`SELECT COUNT(*) as count FROM student_profiles WHERE is_active = 1`),
                amocrm_status: amoCrmService.isInitialized
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка статуса синхронизации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статуса'
        });
    }
});

app.post('/api/sync/phone', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Укажите номер'
            });
        }
        
        console.log(`\n🔧 РУЧНАЯ СИНХРОНИЗАЦИЯ: ${phone}`);
        
        if (!amoCrmService.isInitialized) {
            return res.status(503).json({
                success: false,
                error: 'amoCRM не подключен'
            });
        }
        
        const result = await syncService.syncSinglePhone(phone);
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Ошибка синхронизации:', error);
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
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ');
        console.log('='.repeat(80));
        console.log('✨ ПРАВИЛЬНЫЙ ПОИСК АБОНЕМЕНТОВ');
        console.log('✨ ИСПРАВЛЕННЫЙ ПОИСК СДЕЛОК');
        console.log('✨ АВТОМАТИЧЕСКАЯ СИНХРОНИЗАЦИЯ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        console.log('\n🔄 Инициализация amoCRM...');
        const crmInitialized = await amoCrmService.initialize();
        
        if (crmInitialized) {
            console.log('✅ amoCRM инициализирован');
            
            setTimeout(() => {
                syncService.startAutoSync();
            }, 5000);
            
        } else {
            console.log('❌ amoCRM не инициализирован');
        }
        
        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, () => {
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
            console.log(`🔍 Профили: GET http://localhost:${PORT}/api/profiles`);
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
                console.error('❌ Ошибка закрытия БД:', dbError.message);
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
