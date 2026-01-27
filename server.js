// server.js - СТАБИЛЬНЫЙ И БЫСТРЫЙ СЕРВЕР

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
const JWT_SECRET = process.env.JWT_SECRET || 'art-school-jwt-secret-2024';
const AMOCRM_ACCESS_TOKEN = process.env.AMOCRM_ACCESS_TOKEN;
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN;
const AMOCRM_SUBDOMAIN = AMOCRM_DOMAIN ? AMOCRM_DOMAIN.replace('.amocrm.ru', '') : '';

// ==================== НАСТРОЙКА EXPRESS ====================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ==================== УПРОЩЕННЫЙ AMOCRM SERVICE ====================
class StableAmoCrmService {
    constructor() {
        console.log('\n' + '='.repeat(60));
        console.log('🔄 УПРОЩЕННЫЙ AmoCrmService');
        console.log('='.repeat(60));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.isInitialized = false;
        
        // Кэш на 1 минуту
        this.cache = new Map();
        this.cacheDuration = 60 * 1000;
        
        // ID полей
        this.FIELDS = {
            PHONE: 216615,
            CHILD_NAME: 867233,
            BRANCH: 871273,
            TOTAL_CLASSES: 850241,
            USED_CLASSES: 850257,
            REMAINING_CLASSES: 890163
        };
    }

    // ==================== ПРОВЕРКА ПОДКЛЮЧЕНИЯ ====================
    async initialize() {
        try {
            console.log('🔗 Проверка подключения к amoCRM...');
            
            const response = await axios.get(`${this.baseUrl}/api/v4/account`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
            
            this.isInitialized = true;
            console.log('✅ amoCRM подключен');
            return true;
            
        } catch (error) {
            console.error('❌ Ошибка подключения к amoCRM:', error.message);
            this.isInitialized = false;
            return false;
        }
    }

    // ==================== ПОИСК КОНТАКТА (САМЫЙ БЫСТРЫЙ СПОСОБ) ====================
    async findContactByPhone(phone) {
        const cacheKey = `contact_${phone}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < this.cacheDuration) {
            return cached.data;
        }
        
        try {
            const cleanPhone = phone.replace(/\D/g, '').slice(-10);
            
            // Способ 1: Поиск через query (самый быстрый)
            const response = await axios.get(`${this.baseUrl}/api/v4/contacts`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    query: cleanPhone,
                    with: 'custom_fields_values',
                    limit: 5
                },
                timeout: 5000
            });
            
            if (response.data?._embedded?.contacts) {
                for (const contact of response.data._embedded.contacts) {
                    if (this.hasPhone(contact, cleanPhone)) {
                        console.log(`✅ Найден контакт: ${contact.name}`);
                        this.cache.set(cacheKey, { data: contact, timestamp: Date.now() });
                        return contact;
                    }
                }
            }
            
            return null;
            
        } catch (error) {
            console.error('❌ Ошибка поиска контакта:', error.message);
            return null;
        }
    }

    hasPhone(contact, phoneDigits) {
        if (!contact.custom_fields_values) return false;
        
        for (const field of contact.custom_fields_values) {
            if (field.field_id === this.FIELDS.PHONE && field.values) {
                for (const value of field.values) {
                    const contactPhone = String(value.value || '').replace(/\D/g, '');
                    if (contactPhone.includes(phoneDigits)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // ==================== ПОЛУЧЕНИЕ СДЕЛОК (С ЛИМИТОМ!) ====================
    async getLeadsForContact(contactId) {
        const cacheKey = `leads_${contactId}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < this.cacheDuration) {
            return cached.data;
        }
        
        try {
            // ВАЖНО: лимит 30 сделок и только 1 страница!
            const response = await axios.get(`${this.baseUrl}/api/v4/leads`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    filter: JSON.stringify({ contact_id: [contactId] }),
                    with: 'custom_fields_values',
                    limit: 30, // Только 30 последних сделок
                    page: 1    // Только первая страница
                },
                timeout: 10000
            });
            
            const leads = response.data?._embedded?.leads || [];
            
            // Сортируем по дате (новые первыми)
            leads.sort((a, b) => b.created_at - a.created_at);
            
            console.log(`📊 Получено сделок: ${leads.length}`);
            this.cache.set(cacheKey, { data: leads, timestamp: Date.now() });
            
            return leads;
            
        } catch (error) {
            console.error('❌ Ошибка получения сделок:', error.message);
            return [];
        }
    }

    // ==================== ПОИСК АБОНЕМЕНТА ДЛЯ УЧЕНИКА ====================
    async findSubscriptionForStudent(contactId, studentName) {
        console.log(`🎯 Поиск абонемента для: ${studentName}`);
        
        const leads = await this.getLeadsForContact(contactId);
        if (leads.length === 0) return null;
        
        const normalizedStudentName = studentName.toLowerCase();
        
        // Стратегии поиска по приоритету
        const searchStrategies = [
            // 1. По полному имени в названии
            lead => lead.name.toLowerCase().includes(normalizedStudentName),
            
            // 2. По фамилии (последнее слово)
            lead => {
                const lastName = normalizedStudentName.split(' ').pop();
                return lastName && lead.name.toLowerCase().includes(lastName);
            },
            
            // 3. Сделки в воронке абонементов
            lead => lead.pipeline_id === 7977402,
            
            // 4. С активным статусом
            lead => [65473306, 142, 143].includes(lead.status_id),
            
            // 5. Любая сделка с полями абонемента
            lead => {
                if (!lead.custom_fields_values) return false;
                return lead.custom_fields_values.some(f => 
                    f.field_id === this.FIELDS.TOTAL_CLASSES || 
                    f.field_id === this.FIELDS.REMAINING_CLASSES
                );
            }
        ];
        
        // Перебираем сделки по приоритету
        for (const lead of leads) {
            for (const strategy of searchStrategies) {
                if (strategy(lead)) {
                    const subscription = this.extractSubscriptionData(lead);
                    if (subscription.hasSubscription) {
                        console.log(`✅ Найдена сделка: "${lead.name.substring(0, 50)}..."`);
                        return { lead, subscription };
                    }
                }
            }
        }
        
        console.log('❌ Абонемент не найден');
        return null;
    }

    // ==================== ИЗВЛЕЧЕНИЕ ДАННЫХ ОБ АБОНЕМЕНТЕ ====================
    extractSubscriptionData(lead) {
        const fields = lead.custom_fields_values || [];
        
        const getValue = (fieldId) => {
            const field = fields.find(f => f.field_id === fieldId);
            if (!field || !field.values || field.values.length === 0) return null;
            
            const value = field.values[0].value;
            
            // Извлекаем число из строки
            if (typeof value === 'string') {
                const match = value.match(/\d+/);
                return match ? parseInt(match[0]) : value;
            }
            
            return value;
        };
        
        const total = getValue(this.FIELDS.TOTAL_CLASSES) || 0;
        const used = getValue(this.FIELDS.USED_CLASSES) || 0;
        const remaining = getValue(this.FIELDS.REMAINING_CLASSES) || 0;
        
        const hasSubscription = total > 0 || remaining > 0;
        const isActive = [65473306, 142, 143].includes(lead.status_id);
        
        return {
            hasSubscription,
            subscriptionActive: isActive,
            totalClasses: total,
            usedClasses: used,
            remainingClasses: remaining > 0 ? remaining : (total - used),
            subscriptionType: hasSubscription ? 'Активный абонемент' : 'Без абонемента',
            isActive
        };
    }

    // ==================== ПОЛУЧЕНИЕ ДАННЫХ УЧЕНИКА ====================
    async getStudentData(phone) {
        console.log(`\n📱 ЗАПРОС ДАННЫХ: ${phone}`);
        const startTime = Date.now();
        
        try {
            // 1. Ищем контакт
            const contact = await this.findContactByPhone(phone);
            if (!contact) {
                console.log('❌ Контакт не найден');
                return null;
            }
            
            // 2. Извлекаем имя ученика
            const childField = contact.custom_fields_values?.find(f => 
                f.field_id === this.FIELDS.CHILD_NAME
            );
            
            if (!childField?.values?.[0]?.value) {
                console.log('❌ Имя ученика не указано');
                return null;
            }
            
            const studentName = childField.values[0].value;
            console.log(`👤 Ученик: ${studentName}`);
            
            // 3. Ищем абонемент
            const subscriptionResult = await this.findSubscriptionForStudent(contact.id, studentName);
            
            // 4. Формируем данные
            const studentData = {
                contactId: contact.id,
                studentName: studentName,
                phone: phone,
                parentName: contact.name || '',
                branch: this.getFieldValue(contact, this.FIELDS.BRANCH) || '',
                subscription: subscriptionResult ? subscriptionResult.subscription : {
                    hasSubscription: false,
                    subscriptionActive: false,
                    totalClasses: 0,
                    usedClasses: 0,
                    remainingClasses: 0,
                    subscriptionType: 'Без абонемента'
                }
            };
            
            console.log(`✅ Данные получены за ${Date.now() - startTime}ms`);
            console.log(`📊 ${studentData.subscription.usedClasses}/${studentData.subscription.totalClasses} занятий`);
            
            return studentData;
            
        } catch (error) {
            console.error(`❌ Ошибка получения данных: ${error.message}`);
            console.log(`⏱️  Время выполнения: ${Date.now() - startTime}ms`);
            return null;
        }
    }

    getFieldValue(contact, fieldId) {
        const field = contact.custom_fields_values?.find(f => f.field_id === fieldId);
        return field?.values?.[0]?.value || null;
    }
}

// Создаем экземпляр сервиса
const amoCrmService = new StableAmoCrmService();

// ==================== ПРОСТАЯ БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        // Создаем директорию если нужно
        const dbDir = path.join(__dirname, 'data');
        try {
            await fs.mkdir(dbDir, { recursive: true });
        } catch (e) {
            // Директория уже существует
        }
        
        const dbPath = path.join(dbDir, 'students.db');
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });
        
        // Простая таблица
        await db.exec(`
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone TEXT NOT NULL,
                student_name TEXT NOT NULL,
                parent_name TEXT,
                branch TEXT,
                total_classes INTEGER DEFAULT 0,
                used_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 0,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(phone, student_name)
            )
        `);
        
        console.log('✅ База данных готова');
        
    } catch (error) {
        console.log('⚠️  База данных не работает, используем только amoCRM');
        db = null;
    }
};

// ==================== API МАРШРУТЫ ====================

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        amocrm_connected: amoCrmService.isInitialized
    });
});

// Главный эндпоинт - авторизация и получение данных
app.post('/api/auth/phone', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.json({
                success: false,
                error: 'Укажите номер телефона'
            });
        }
        
        // Форматируем телефон
        const cleanPhone = phone.replace(/\D/g, '');
        const formattedPhone = cleanPhone.length === 10 ? '+7' + cleanPhone : 
                              cleanPhone.length === 11 ? '+' + cleanPhone :
                              '+7' + cleanPhone.slice(-10);
        
        console.log(`\n📱 ЗАПРОС: ${formattedPhone}`);
        
        // Проверяем локальную базу (быстро)
        let cachedData = null;
        if (db) {
            cachedData = await db.get(
                `SELECT * FROM students WHERE phone = ? ORDER BY last_updated DESC LIMIT 1`,
                [formattedPhone]
            );
            
            if (cachedData) {
                console.log(`⚡ Данные из кэша (${Date.now() - startTime}ms)`);
            }
        }
        
        // Если нет в кэше или amoCRM подключен, ищем в CRM
        let studentData = null;
        if (!cachedData && amoCrmService.isInitialized) {
            studentData = await amoCrmService.getStudentData(formattedPhone);
            
            // Сохраняем в базу если нашли
            if (studentData && db) {
                try {
                    await db.run(
                        `INSERT OR REPLACE INTO students 
                         (phone, student_name, parent_name, branch, 
                          total_classes, used_classes, remaining_classes, is_active)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            studentData.phone,
                            studentData.studentName,
                            studentData.parentName,
                            studentData.branch,
                            studentData.subscription.totalClasses,
                            studentData.subscription.usedClasses,
                            studentData.subscription.remainingClasses,
                            studentData.subscription.subscriptionActive ? 1 : 0
                        ]
                    );
                } catch (dbError) {
                    console.log('⚠️  Ошибка сохранения в БД:', dbError.message);
                }
            }
        }
        
        // Формируем ответ
        const responseData = studentData || cachedData;
        
        if (!responseData) {
            return res.json({
                success: false,
                error: 'Ученик не найден',
                response_time: Date.now() - startTime
            });
        }
        
        // Создаем токен
        const token = jwt.sign(
            { phone: formattedPhone, timestamp: Date.now() },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        const response = {
            success: true,
            data: {
                student_name: responseData.studentName || responseData.student_name,
                phone: responseData.phone,
                parent_name: responseData.parentName || responseData.parent_name || '',
                branch: responseData.branch || '',
                subscription_type: responseData.subscription?.subscriptionType || 'Без абонемента',
                total_classes: responseData.subscription?.totalClasses || responseData.total_classes || 0,
                used_classes: responseData.subscription?.usedClasses || responseData.used_classes || 0,
                remaining_classes: responseData.subscription?.remainingClasses || responseData.remaining_classes || 0,
                is_active: responseData.subscription?.subscriptionActive || responseData.is_active === 1
            },
            token: token,
            response_time: Date.now() - startTime,
            from_cache: !!cachedData && !studentData
        };
        
        console.log(`✅ Ответ за ${response.response_time}ms`);
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        res.json({
            success: false,
            error: 'Ошибка сервера',
            response_time: Date.now() - startTime
        });
    }
});

// Получение информации об абонементе
app.post('/api/subscription', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { phone } = req.body;
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.json({
                success: false,
                error: 'Требуется авторизация'
            });
        }
        
        // Простая проверка токена
        try {
            const token = authHeader.replace('Bearer ', '');
            jwt.verify(token, JWT_SECRET);
        } catch {
            return res.json({
                success: false,
                error: 'Неверный токен'
            });
        }
        
        if (!phone) {
            return res.json({
                success: false,
                error: 'Укажите телефон'
            });
        }
        
        const cleanPhone = phone.replace(/\D/g, '');
        const formattedPhone = '+7' + cleanPhone.slice(-10);
        
        // Ищем в локальной базе
        let studentData = null;
        if (db) {
            studentData = await db.get(
                `SELECT * FROM students WHERE phone = ? ORDER BY last_updated DESC LIMIT 1`,
                [formattedPhone]
            );
        }
        
        if (!studentData) {
            return res.json({
                success: false,
                error: 'Данные не найдены'
            });
        }
        
        res.json({
            success: true,
            data: {
                student: {
                    name: studentData.student_name,
                    phone: studentData.phone,
                    branch: studentData.branch || 'Не указан'
                },
                subscription: {
                    is_active: studentData.is_active === 1,
                    classes: {
                        total: studentData.total_classes,
                        used: studentData.used_classes,
                        remaining: studentData.remaining_classes
                    }
                },
                last_updated: studentData.last_updated
            },
            response_time: Date.now() - startTime
        });
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        res.json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// Тестовый маршрут для проверки
app.get('/api/test/:phone', async (req, res) => {
    const phone = req.params.phone;
    const formattedPhone = '+7' + phone.replace(/\D/g, '').slice(-10);
    
    console.log(`\n🧪 ТЕСТ: ${formattedPhone}`);
    
    const data = await amoCrmService.getStudentData(formattedPhone);
    
    res.json({
        success: !!data,
        data: data,
        amocrm_connected: amoCrmService.isInitialized
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(60));
        console.log('🚀 ЗАПУСК СТАБИЛЬНОГО СЕРВЕРА');
        console.log('='.repeat(60));
        
        // Инициализируем базу (не критично если не работает)
        await initDatabase();
        
        // Подключаемся к amoCRM
        console.log('\n🔗 Подключение к amoCRM...');
        const connected = await amoCrmService.initialize();
        
        if (!connected) {
            console.log('⚠️  amoCRM не подключен, будут доступны только кэшированные данные');
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(60));
            console.log('✅ СЕРВЕР ЗАПУЩЕН!');
            console.log('='.repeat(60));
            console.log(`🌐 http://localhost:${PORT}`);
            console.log(`🔐 POST http://localhost:${PORT}/api/auth/phone`);
            console.log(`📋 POST http://localhost:${PORT}/api/subscription`);
            console.log(`🧪 GET http://localhost:${PORT}/api/test/79265725212`);
            console.log('='.repeat(60));
            
            console.log('\n📊 КЛЮЧЕВЫЕ ФИЧИ:');
            console.log('• Не зависает на больших данных');
            console.log('• Лимит 30 сделок на запрос');
            console.log('• Кэширование в памяти');
            console.log('• Работает без базы данных');
            console.log('• Timeout 10 секунд на запросы');
            console.log('='.repeat(60));
        });
        
        // Обработка выключения
        process.on('SIGINT', () => {
            console.log('\n👋 Сервер остановлен');
            process.exit(0);
        });
        
    } catch (error) {
        console.error('❌ Ошибка запуска:', error.message);
        process.exit(1);
    }
};

startServer();
