// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;
const { Telegraf, Markup, session } = require('telegraf');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const querystring = require('querystring');

const app = express();

// ==================== КОНФИГУРАЦИЯ ====================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8425388642:AAFpXOa7lYdGYmimJvxyDg2PXyLjlxYrSq4';
const DOMAIN = process.env.DOMAIN || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'art-school-jwt-secret-2024';

// Настройки amoCRM
const AMOCRM_CLIENT_ID = process.env.AMOCRM_CLIENT_ID;
const AMOCRM_CLIENT_SECRET = process.env.AMOCRM_CLIENT_SECRET;
const AMOCRM_REDIRECT_URI = process.env.AMOCRM_REDIRECT_URI;
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN;
const AMOCRM_AUTH_CODE = process.env.AMOCRM_AUTH_CODE;
const AMOCRM_ACCESS_TOKEN = process.env.AMOCRM_ACCESS_TOKEN;
// ==================== ИНИЦИАЛИЗАЦИЯ TELEGRAM БОТА ====================
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
bot.use(session({ defaultSession: () => ({}) }));

// ==================== КЛАСС ДЛЯ РАБОТЫ С AMOCRM ====================
class AmoCrmService {
    constructor() {
        this.baseUrl = `https://${AMOCRM_DOMAIN}`;
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpires = null;
        this.isInitialized = false;
    }

async initialize() {
    try {
        console.log('🔄 Инициализация amoCRM...');
        
        // Используем access token, если он есть
        if (AMOCRM_ACCESS_TOKEN) {
            this.accessToken = AMOCRM_ACCESS_TOKEN;
            // Устанавливаем срок действия (например, на 10 дней)
            this.tokenExpires = Date.now() + (10 * 24 * 60 * 60 * 1000);
            this.isInitialized = true;
            console.log('✅ amoCRM инициализирован с access token');
            return true;
        }
            
            // Проверяем сохраненные токены в базе
            const tokens = await this.getStoredTokens();
            if (tokens && tokens.access_token) {
                this.accessToken = tokens.access_token;
                this.refreshToken = tokens.refresh_token;
                this.tokenExpires = tokens.expires_at;
                
                // Проверяем, не истек ли токен
                if (Date.now() >= this.tokenExpires) {
                    console.log('🔄 Токен amoCRM истек, обновляем...');
                    await this.refreshAccessToken();
                } else {
                    console.log('✅ amoCRM инициализирован с сохраненными токенами');
                    this.isInitialized = true;
                }
                return true;
            }
            
            console.log('⚠️ amoCRM не инициализирован: нет токенов');
            return false;
            
        } catch (error) {
            console.error('❌ Ошибка инициализации amoCRM:', error.message);
            return false;
        }
    }

    async getStoredTokens() {
        try {
            const result = await db.get(
                'SELECT * FROM amocrm_tokens ORDER BY id DESC LIMIT 1'
            );
            return result;
        } catch (error) {
            return null;
        }
    }

    async storeTokens(tokens) {
        try {
            const expiresAt = Date.now() + (tokens.expires_in * 1000);
            
            await db.run(`
                INSERT INTO amocrm_tokens (access_token, refresh_token, expires_at, created_at)
                VALUES (?, ?, ?, datetime('now'))
            `, [tokens.access_token, tokens.refresh_token, expiresAt]);
            
            console.log('✅ Токены amoCRM сохранены');
        } catch (error) {
            console.error('❌ Ошибка сохранения токенов amoCRM:', error.message);
        }
    }

    async exchangeCodeForToken(code) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/oauth2/access_token`,
                {
                    client_id: AMOCRM_CLIENT_ID,
                    client_secret: AMOCRM_CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: AMOCRM_REDIRECT_URI
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            this.accessToken = response.data.access_token;
            this.refreshToken = response.data.refresh_token;
            this.tokenExpires = Date.now() + (response.data.expires_in * 1000);
            
            await this.storeTokens(response.data);
            this.isInitialized = true;
            
            console.log('✅ Токен amoCRM получен');
            return true;
            
        } catch (error) {
            console.error('❌ Ошибка получения токена amoCRM:', error.response?.data || error.message);
            throw error;
        }
    }

    async refreshAccessToken() {
        try {
            if (!this.refreshToken) {
                throw new Error('Нет refresh token');
            }

            const response = await axios.post(
                `${this.baseUrl}/oauth2/access_token`,
                {
                    client_id: AMOCRM_CLIENT_ID,
                    client_secret: AMOCRM_CLIENT_SECRET,
                    grant_type: 'refresh_token',
                    refresh_token: this.refreshToken,
                    redirect_uri: AMOCRM_REDIRECT_URI
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            this.accessToken = response.data.access_token;
            this.refreshToken = response.data.refresh_token;
            this.tokenExpires = Date.now() + (response.data.expires_in * 1000);
            
            await this.storeTokens(response.data);
            
            console.log('✅ Токен amoCRM обновлен');
            return true;
            
        } catch (error) {
            console.error('❌ Ошибка обновления токена amoCRM:', error.response?.data || error.message);
            throw error;
        }
    }

    async makeRequest(method, endpoint, data = null) {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            // Проверяем, не истек ли токен
            if (Date.now() >= this.tokenExpires - 60000) { // За минуту до истечения
                await this.refreshAccessToken();
            }

            const config = {
                method: method,
                url: `${this.baseUrl}${endpoint}`,
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            };

            if (data) {
                config.data = data;
            }

            const response = await axios(config);
            return response.data;
            
        } catch (error) {
            console.error(`❌ Ошибка запроса к amoCRM ${endpoint}:`, error.response?.data || error.message);
            
            // Если ошибка авторизации, пробуем обновить токен и повторить
            if (error.response?.status === 401) {
                console.log('🔄 Получена 401 ошибка, обновляем токен...');
                try {
                    await this.refreshAccessToken();
                    return await this.makeRequest(method, endpoint, data);
                } catch (refreshError) {
                    throw new Error('Не удалось обновить токен amoCRM');
                }
            }
            
            throw error;
        }
    }

    // Методы для работы с контактами (учениками)
    async getContacts(filters = {}) {
        try {
            let query = '/api/v4/contacts';
            const queryParams = [];
            
            if (filters.phone) {
                query += `?query=${encodeURIComponent(filters.phone)}`;
            }
            
            if (filters.limit) {
                query += `${query.includes('?') ? '&' : '?'}limit=${filters.limit}`;
            }
            
            const response = await this.makeRequest('GET', query);
            return response;
            
        } catch (error) {
            console.error('❌ Ошибка получения контактов из amoCRM:', error.message);
            throw error;
        }
    }

    async getContactById(id) {
        try {
            const response = await this.makeRequest('GET', `/api/v4/contacts/${id}`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения контакта ${id} из amoCRM:`, error.message);
            throw error;
        }
    }

    async createContact(contactData) {
        try {
            const response = await this.makeRequest('POST', '/api/v4/contacts', [contactData]);
            return response;
        } catch (error) {
            console.error('❌ Ошибка создания контакта в amoCRM:', error.message);
            throw error;
        }
    }

    async updateContact(id, contactData) {
        try {
            const response = await this.makeRequest('PATCH', `/api/v4/contacts/${id}`, contactData);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка обновления контакта ${id} в amoCRM:`, error.message);
            throw error;
        }
    }

    // Методы для работы со сделками (абонементы)
    async getLeads(filters = {}) {
        try {
            let query = '/api/v4/leads';
            const queryParams = [];
            
            if (filters.contact_id) {
                query += `?filter[contacts][id]=${filters.contact_id}`;
            }
            
            if (filters.status_id) {
                query += `${query.includes('?') ? '&' : '?'}filter[statuses][0][id]=${filters.status_id}`;
            }
            
            if (filters.limit) {
                query += `${query.includes('?') ? '&' : '?'}limit=${filters.limit}`;
            }
            
            const response = await this.makeRequest('GET', query);
            return response;
            
        } catch (error) {
            console.error('❌ Ошибка получения сделок из amoCRM:', error.message);
            throw error;
        }
    }

    async getLeadById(id) {
        try {
            const response = await this.makeRequest('GET', `/api/v4/leads/${id}`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения сделки ${id} из amoCRM:`, error.message);
            throw error;
        }
    }

    // Методы для работы с задачами (посещения)
    async getTasks(filters = {}) {
        try {
            let query = '/api/v4/tasks';
            
            if (filters.entity_id) {
                query += `?filter[entity_id]=${filters.entity_id}`;
            }
            
            if (filters.entity_type) {
                query += `${query.includes('?') ? '&' : '?'}filter[entity_type]=${filters.entity_type}`;
            }
            
            const response = await this.makeRequest('GET', query);
            return response;
            
        } catch (error) {
            console.error('❌ Ошибка получения задач из amoCRM:', error.message);
            throw error;
        }
    }

    async createTask(taskData) {
        try {
            const response = await this.makeRequest('POST', '/api/v4/tasks', [taskData]);
            return response;
        } catch (error) {
            console.error('❌ Ошибка создания задачи в amoCRM:', error.message);
            throw error;
        }
    }

    // Методы для работы с событиями (история коммуникаций)
    async getEvents(filters = {}) {
        try {
            let query = '/api/v4/events';
            
            if (filters.entity_id) {
                query += `?filter[entity_id]=${filters.entity_id}`;
            }
            
            if (filters.entity_type) {
                query += `${query.includes('?') ? '&' : '?'}filter[entity_type]=${filters.entity_type}`;
            }
            
            const response = await this.makeRequest('GET', query);
            return response;
            
        } catch (error) {
            console.error('❌ Ошибка получения событий из amoCRM:', error.message);
            throw error;
        }
    }

    // Методы для работы со статусами воронок
    async getPipelines() {
        try {
            const response = await this.makeRequest('GET', '/api/v4/leads/pipelines');
            return response;
        } catch (error) {
            console.error('❌ Ошибка получения воронок из amoCRM:', error.message);
            throw error;
        }
    }

    async getPipelineStatuses(pipelineId) {
        try {
            const response = await this.makeRequest('GET', `/api/v4/leads/pipelines/${pipelineId}/statuses`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения статусов воронки ${pipelineId} из amoCRM:`, error.message);
            throw error;
        }
    }

    // Методы для работы с полями (кастомными полями)
    async getCustomFields(entityType) {
        try {
            const response = await this.makeRequest('GET', `/api/v4/${entityType}/custom_fields`);
            return response;
        } catch (error) {
            console.error(`❌ Ошибка получения кастомных полей для ${entityType} из amoCRM:`, error.message);
            throw error;
        }
    }

    // Получение пользователей amoCRM (преподаватели/администраторы)
    async getUsers() {
        try {
            const response = await this.makeRequest('GET', '/api/v4/users');
            return response;
        } catch (error) {
            console.error('❌ Ошибка получения пользователей из amoCRM:', error.message);
            throw error;
        }
    }

    // Синхронизация данных из amoCRM
    async syncAllData() {
        try {
            console.log('🔄 Начинаю синхронизацию данных из amoCRM...');
            
            // Синхронизируем пользователей (преподавателей)
            await this.syncTeachersFromAmo();
            
            // Синхронизируем контакты (учеников)
            await this.syncStudentsFromAmo();
            
            // Синхронизируем сделки (абонементы)
            await this.syncSubscriptionsFromAmo();
            
            console.log('✅ Синхронизация данных из amoCRM завершена');
            return true;
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации данных из amoCRM:', error.message);
            return false;
        }
    }

    async syncTeachersFromAmo() {
        try {
            const users = await this.getUsers();
            
            if (users && users._embedded && users._embedded.users) {
                for (const user of users._embedded.users) {
                    // Проверяем, есть ли пользователь в базе
                    const existingTeacher = await db.get(
                        'SELECT * FROM teachers WHERE amocrm_user_id = ?',
                        [user.id]
                    );
                    
                    const teacherData = {
                        name: user.name || '',
                        email: user.email || '',
                        phone_number: user.phone || '',
                        amocrm_user_id: user.id,
                        is_active: 1,
                        created_at: new Date().toISOString()
                    };
                    
                    if (!existingTeacher) {
                        await db.run(
                            `INSERT INTO teachers (name, email, phone_number, amocrm_user_id, is_active, created_at)
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [
                                teacherData.name,
                                teacherData.email,
                                teacherData.phone_number,
                                teacherData.amocrm_user_id,
                                teacherData.is_active,
                                teacherData.created_at
                            ]
                        );
                    } else {
                        await db.run(
                            `UPDATE teachers SET name = ?, email = ?, phone_number = ?, updated_at = datetime('now')
                             WHERE amocrm_user_id = ?`,
                            [
                                teacherData.name,
                                teacherData.email,
                                teacherData.phone_number,
                                teacherData.amocrm_user_id
                            ]
                        );
                    }
                }
                
                console.log(`✅ Синхронизировано ${users._embedded.users.length} преподавателей из amoCRM`);
            }
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации преподавателей:', error.message);
        }
    }

    async syncStudentsFromAmo() {
        try {
            const contacts = await this.getContacts({ limit: 100 });
            
            if (contacts && contacts._embedded && contacts._embedded.contacts) {
                for (const contact of contacts._embedded.contacts) {
                    // Ищем телефон контакта
                    let phone = '';
                    if (contact.custom_fields_values) {
                        const phoneField = contact.custom_fields_values.find(field => 
                            field.field_code === 'PHONE' || field.field_name?.toLowerCase().includes('телефон')
                        );
                        if (phoneField && phoneField.values && phoneField.values[0]) {
                            phone = phoneField.values[0].value;
                        }
                    }
                    
                    // Ищем филиал
                    let branch = '';
                    if (contact.custom_fields_values) {
                        const branchField = contact.custom_fields_values.find(field => 
                            field.field_name?.toLowerCase().includes('филиал')
                        );
                        if (branchField && branchField.values && branchField.values[0]) {
                            branch = branchField.values[0].value;
                        }
                    }
                    
                    const studentData = {
                        amocrm_contact_id: contact.id,
                        student_name: contact.name || '',
                        phone_number: phone,
                        branch: branch || 'Не указан',
                        is_active: 1,
                        created_at: new Date().toISOString()
                    };
                    
                    // Проверяем, есть ли контакт в базе
                    const existingStudent = await db.get(
                        'SELECT * FROM student_profiles WHERE amocrm_contact_id = ?',
                        [contact.id]
                    );
                    
                    if (!existingStudent) {
                        await db.run(
                            `INSERT INTO student_profiles 
                             (amocrm_contact_id, student_name, phone_number, branch, is_active, created_at)
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [
                                studentData.amocrm_contact_id,
                                studentData.student_name,
                                studentData.phone_number,
                                studentData.branch,
                                studentData.is_active,
                                studentData.created_at
                            ]
                        );
                    } else {
                        await db.run(
                            `UPDATE student_profiles 
                             SET student_name = ?, phone_number = ?, branch = ?, updated_at = datetime('now')
                             WHERE amocrm_contact_id = ?`,
                            [
                                studentData.student_name,
                                studentData.phone_number,
                                studentData.branch,
                                studentData.amocrm_contact_id
                            ]
                        );
                    }
                }
                
                console.log(`✅ Синхронизировано ${contacts._embedded.contacts.length} учеников из amoCRM`);
            }
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации учеников:', error.message);
        }
    }

    async syncSubscriptionsFromAmo() {
        try {
            // Получаем все активные сделки (абонементы)
            const leads = await this.getLeads({ limit: 100 });
            
            if (leads && leads._embedded && leads._embedded.leads) {
                for (const lead of leads._embedded.leads) {
                    // Ищем связанного ученика
                    if (lead._embedded && lead._embedded.contacts && lead._embedded.contacts[0]) {
                        const contactId = lead._embedded.contacts[0].id;
                        
                        // Получаем ученика из базы по contact_id
                        const student = await db.get(
                            'SELECT * FROM student_profiles WHERE amocrm_contact_id = ?',
                            [contactId]
                        );
                        
                        if (student) {
                            // Обновляем информацию об абонементе
                            await db.run(
                                `UPDATE student_profiles 
                                 SET subscription_type = ?, total_classes = ?, remaining_classes = ?,
                                     expiration_date = ?, updated_at = datetime('now')
                                 WHERE amocrm_contact_id = ?`,
                                [
                                    `Абонемент #${lead.id}`,
                                    12, // Значение по умолчанию
                                    8,  // Значение по умолчанию
                                    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                                    contactId
                                ]
                            );
                        }
                    }
                }
                
                console.log(`✅ Синхронизировано ${leads._embedded.leads.length} абонементов из amoCRM`);
            }
            
        } catch (error) {
            console.error('❌ Ошибка синхронизации абонементов:', error.message);
        }
    }

    // Получение данных ученика по телефону из amoCRM
    async getStudentByPhoneFromAmo(phoneNumber) {
        try {
            const contacts = await this.getContacts({ phone: phoneNumber });
            
            if (contacts && contacts._embedded && contacts._embedded.contacts && contacts._embedded.contacts.length > 0) {
                const contact = contacts._embedded.contacts[0];
                
                // Получаем сделки (абонементы) для этого контакта
                const leads = await this.getLeads({ contact_id: contact.id });
                
                // Получаем кастомные поля контакта
                const customFields = {};
                if (contact.custom_fields_values) {
                    for (const field of contact.custom_fields_values) {
                        if (field.values && field.values[0]) {
                            const fieldName = field.field_name || field.field_code;
                            customFields[fieldName] = field.values[0].value;
                        }
                    }
                }
                
                // Формируем профиль ученика
                const studentProfile = {
                    amocrm_contact_id: contact.id,
                    student_name: contact.name || '',
                    parent_name: customFields['Родитель'] || customFields['Контактное лицо'] || '',
                    phone_number: phoneNumber,
                    email: customFields['Email'] || '',
                    branch: customFields['Филиал'] || 'Не указан',
                    subscription_type: leads && leads._embedded && leads._embedded.leads && leads._embedded.leads.length > 0 
                        ? `Абонемент #${leads._embedded.leads[0].id}` 
                        : 'Без абонемента',
                    total_classes: 12, // Можно получить из кастомных полей сделки
                    remaining_classes: 8, // Можно получить из кастомных полей сделки
                    expiration_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    teacher_name: customFields['Преподаватель'] || '',
                    day_of_week: customFields['День недели'] || '',
                    time_slot: customFields['Время'] || '',
                    custom_fields: customFields
                };
                
                return [studentProfile];
            }
            
            return [];
            
        } catch (error) {
            console.error('❌ Ошибка получения ученика из amoCRM:', error.message);
            return [];
        }
    }

    // Создание новой сделки (покупка абонемента)
    async createSubscription(studentProfileId, subscriptionData) {
        try {
            const student = await db.get(
                'SELECT * FROM student_profiles WHERE id = ?',
                [studentProfileId]
            );
            
            if (!student || !student.amocrm_contact_id) {
                throw new Error('Ученик не найден в amoCRM');
            }
            
            const leadData = {
                name: `Абонемент для ${student.student_name}`,
                price: subscriptionData.price || 0,
                status_id: subscriptionData.status_id || 142, // ID статуса в вашей воронке
                pipeline_id: subscriptionData.pipeline_id || 7125623, // ID вашей воронки продаж
                _embedded: {
                    contacts: [{ id: student.amocrm_contact_id }]
                },
                custom_fields_values: [
                    {
                        field_id: subscriptionData.field_id_total_classes || 12345, // ID поля "Всего занятий"
                        values: [{ value: subscriptionData.total_classes || 12 }]
                    },
                    {
                        field_id: subscriptionData.field_id_remaining_classes || 12346, // ID поля "Осталось занятий"
                        values: [{ value: subscriptionData.remaining_classes || subscriptionData.total_classes || 12 }]
                    },
                    {
                        field_id: subscriptionData.field_id_expiration_date || 12347, // ID поля "Дата окончания"
                        values: [{ value: subscriptionData.expiration_date }]
                    }
                ]
            };
            
            const response = await this.makeRequest('POST', '/api/v4/leads', [leadData]);
            
            // Обновляем профиль ученика в локальной базе
            if (response && response._embedded && response._embedded.leads && response._embedded.leads[0]) {
                await db.run(
                    `UPDATE student_profiles 
                     SET subscription_type = ?, total_classes = ?, remaining_classes = ?, expiration_date = ?
                     WHERE id = ?`,
                    [
                        `Абонемент #${response._embedded.leads[0].id}`,
                        subscriptionData.total_classes || 12,
                        subscriptionData.remaining_classes || subscriptionData.total_classes || 12,
                        subscriptionData.expiration_date,
                        studentProfileId
                    ]
                );
            }
            
            return response;
            
        } catch (error) {
            console.error('❌ Ошибка создания абонемента в amoCRM:', error.message);
            throw error;
        }
    }

    // Отметка посещения занятия
    async markAttendance(studentProfileId, attendanceData) {
        try {
            const student = await db.get(
                'SELECT * FROM student_profiles WHERE id = ?',
                [studentProfileId]
            );
            
            if (!student || !student.amocrm_contact_id) {
                throw new Error('Ученик не найден в amoCRM');
            }
            
            // Создаем задачу в amoCRM для отметки посещения
            const taskData = {
                text: `Посещение занятия: ${attendanceData.date}`,
                complete_till: Math.floor(Date.now() / 1000) + 86400, // До конца дня
                entity_id: student.amocrm_contact_id,
                entity_type: 'contacts',
                task_type_id: attendanceData.task_type_id || 1, // Тип задачи
                result: {
                    text: `Ученик ${student.student_name} посетил занятие. ${attendanceData.notes || ''}`
                }
            };
            
            const response = await this.createTask(taskData);
            
            // Обновляем количество оставшихся занятий
            if (student.remaining_classes > 0) {
                const newRemaining = student.remaining_classes - 1;
                
                // Обновляем в локальной базе
                await db.run(
                    `UPDATE student_profiles SET remaining_classes = ? WHERE id = ?`,
                    [newRemaining, studentProfileId]
                );
                
                // Обновляем в amoCRM
                const leads = await this.getLeads({ contact_id: student.amocrm_contact_id });
                if (leads && leads._embedded && leads._embedded.leads && leads._embedded.leads[0]) {
                    const leadId = leads._embedded.leads[0].id;
                    
                    await this.makeRequest('PATCH', `/api/v4/leads/${leadId}`, {
                        custom_fields_values: [
                            {
                                field_id: 12346, // ID поля "Осталось занятий"
                                values: [{ value: newRemaining }]
                            }
                        ]
                    });
                }
            }
            
            return response;
            
        } catch (error) {
            console.error('❌ Ошибка отметки посещения в amoCRM:', error.message);
            throw error;
        }
    }

    // Получение истории посещений
    async getAttendanceHistory(studentProfileId) {
        try {
            const student = await db.get(
                'SELECT * FROM student_profiles WHERE id = ?',
                [studentProfileId]
            );
            
            if (!student || !student.amocrm_contact_id) {
                return [];
            }
            
            // Получаем задачи (посещения) для этого контакта
            const tasks = await this.getTasks({
                entity_id: student.amocrm_contact_id,
                entity_type: 'contacts'
            });
            
            const attendanceHistory = [];
            
            if (tasks && tasks._embedded && tasks._embedded.tasks) {
                for (const task of tasks._embedded.tasks) {
                    if (task.text && task.text.includes('Посещение занятия')) {
                        attendanceHistory.push({
                            date: new Date(task.created_at * 1000).toISOString().split('T')[0],
                            status: 'attended',
                            notes: task.result?.text || ''
                        });
                    }
                }
            }
            
            return attendanceHistory;
            
        } catch (error) {
            console.error('❌ Ошибка получения истории посещений из amoCRM:', error.message);
            return [];
        }
    }
}

// Создаем экземпляр сервиса amoCRM
const amoCrmService = new AmoCrmService();

// ==================== НАСТРОЙКА CORS И MIDDLEWARE ====================
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

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных школы рисования с интеграцией amoCRM...');
        
        const dbPath = path.join(__dirname, 'art_school.db');
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');
        
        await createTables();
        await createDemoData();
        
        console.log('🎉 База данных успешно инициализирована!');
        
        // Инициализируем amoCRM
        await amoCrmService.initialize();
        
        // Синхронизируем данные из amoCRM
        if (amoCrmService.isInitialized) {
            await amoCrmService.syncAllData();
        }
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        
        try {
            console.log('🔄 Пробуем создать временную базу данных в памяти...');
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            console.log('✅ Создана временная база данных в памяти');
            await db.run('PRAGMA foreign_keys = ON');
            await createTables();
            await createDemoData();
            console.log('⚠️ ВНИМАНИЕ: Используется база данных в памяти. Данные не сохранятся после перезапуска!');
            
            return db;
        } catch (memoryError) {
            console.error('❌ Не удалось создать даже базу в памяти:', memoryError.message);
            throw error;
        }
    }
};

const createTables = async () => {
    try {
        console.log('📊 Создание таблиц школы рисования...');
        
        // Токены amoCRM
        await db.exec(`
            CREATE TABLE IF NOT EXISTS amocrm_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Пользователи Telegram
        await db.exec(`
            CREATE TABLE IF NOT EXISTS telegram_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE NOT NULL,
                phone_number TEXT NOT NULL,
                first_name TEXT,
                last_name TEXT,
                username TEXT,
                avatar_url TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Профили учеников
        await db.exec(`
            CREATE TABLE IF NOT EXISTS student_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_user_id INTEGER,
                amocrm_contact_id INTEGER UNIQUE,
                student_name TEXT NOT NULL,
                parent_name TEXT,
                phone_number TEXT NOT NULL,
                email TEXT,
                branch TEXT NOT NULL CHECK(branch IN ('Свиблово', 'Чертаново', 'Не указан')),
                subscription_type TEXT,
                total_classes INTEGER DEFAULT 0,
                remaining_classes INTEGER DEFAULT 0,
                expiration_date DATE,
                teacher_name TEXT,
                day_of_week TEXT,
                time_slot TEXT,
                amocrm_lead_id INTEGER,
                amocrm_custom_fields TEXT,
                is_active INTEGER DEFAULT 1,
                last_selected INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(id) ON DELETE CASCADE
            )
        `);

        // Расписание занятий
        await db.exec(`
            CREATE TABLE IF NOT EXISTS schedule (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                branch TEXT NOT NULL,
                day_of_week TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                teacher_id INTEGER,
                teacher_name TEXT,
                group_name TEXT,
                room_number TEXT,
                max_students INTEGER DEFAULT 10,
                current_students INTEGER DEFAULT 0,
                status TEXT DEFAULT 'normal' CHECK(status IN ('normal', 'cancelled', 'changed', 'rescheduled')),
                status_note TEXT,
                cancellation_reason TEXT,
                replacement_teacher_id INTEGER,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Преподаватели
        await db.exec(`
            CREATE TABLE IF NOT EXISTS teachers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                photo_url TEXT,
                qualification TEXT,
                specialization TEXT,
                experience_years INTEGER,
                description TEXT,
                branches TEXT,
                telegram_username TEXT,
                phone_number TEXT,
                email TEXT,
                amocrm_user_id INTEGER UNIQUE,
                is_active INTEGER DEFAULT 1,
                display_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // История посещений
        await db.exec(`
            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_profile_id INTEGER NOT NULL,
                schedule_id INTEGER,
                attendance_date DATE NOT NULL,
                attendance_time TIME,
                status TEXT DEFAULT 'attended' CHECK(status IN ('attended', 'missed', 'cancelled')),
                notes TEXT,
                amocrm_task_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_profile_id) REFERENCES student_profiles(id) ON DELETE CASCADE,
                FOREIGN KEY (schedule_id) REFERENCES schedule(id) ON DELETE SET NULL
            )
        `);

        // Частые вопросы (FAQ)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS faq (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                display_order INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Новости школы
        await db.exec(`
            CREATE TABLE IF NOT EXISTS news (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                short_description TEXT,
                image_url TEXT,
                branch TEXT,
                is_active INTEGER DEFAULT 1,
                publish_date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Администраторы
        await db.exec(`
            CREATE TABLE IF NOT EXISTS administrators (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE,
                name TEXT NOT NULL,
                email TEXT,
                phone_number TEXT,
                branches TEXT,
                role TEXT DEFAULT 'admin' CHECK(role IN ('admin', 'superadmin')),
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Рассылки
        await db.exec(`
            CREATE TABLE IF NOT EXISTS broadcasts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id INTEGER NOT NULL,
                broadcast_type TEXT NOT NULL CHECK(broadcast_type IN ('service', 'marketing')),
                message_type TEXT CHECK(message_type IN ('cancellation', 'replacement', 'reschedule', 'custom')),
                title TEXT,
                message TEXT NOT NULL,
                branches TEXT,
                teacher_ids TEXT,
                days_of_week TEXT,
                filters_applied TEXT,
                recipients_count INTEGER DEFAULT 0,
                sent_count INTEGER DEFAULT 0,
                failed_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sending', 'sent', 'failed')),
                sent_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_id) REFERENCES administrators(id) ON DELETE CASCADE
            )
        `);

        // Контакты администраторов по филиалам
        await db.exec(`
            CREATE TABLE IF NOT EXISTS branch_contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                branch TEXT UNIQUE NOT NULL,
                telegram_username TEXT,
                telegram_chat_id TEXT,
                phone_number TEXT,
                email TEXT,
                address TEXT,
                working_hours TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Сессии пользователей для веб-интерфейса
        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_user_id INTEGER NOT NULL,
                session_id TEXT UNIQUE NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                is_active INTEGER DEFAULT 1,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (telegram_user_id) REFERENCES telegram_users(id) ON DELETE CASCADE
            )
        `);

        // Логи синхронизации с amoCRM
        await db.exec(`
            CREATE TABLE IF NOT EXISTS amocrm_sync_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_type TEXT NOT NULL,
                records_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'success' CHECK(status IN ('success', 'error', 'partial')),
                error_message TEXT,
                sync_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Все таблицы созданы');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц:', error.message);
        throw error;
    }
};

// ==================== ДЕМО ДАННЫЕ ====================
const createDemoData = async () => {
    try {
        console.log('📝 Создание демо-данных для школы рисования...');

        // Демо администраторы
        const adminExists = await db.get("SELECT 1 FROM administrators LIMIT 1");
        if (!adminExists) {
            await db.run(
                `INSERT INTO administrators (telegram_id, name, email, phone_number, branches, role) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [123456789, 'Администратор Свиблово', 'admin1@artschool.ru', '+79991112233', '["Свиблово"]', 'admin']
            );
            
            await db.run(
                `INSERT INTO administrators (telegram_id, name, email, phone_number, branches, role) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [987654321, 'Администратор Чертаново', 'admin2@artschool.ru', '+79994445566', '["Чертаново"]', 'admin']
            );
            
            console.log('✅ Демо-администраторы созданы');
        }

        // Демо преподаватели (будут заменены данными из amoCRM при синхронизации)
        const teachersExist = await db.get("SELECT 1 FROM teachers LIMIT 1");
        if (!teachersExist) {
            const teachers = [
                ['Анна Петрова', 'https://via.placeholder.com/300x300/4A90E2/FFFFFF?text=АП', 
                 'Художник-педагог, член Союза художников России', 
                 'Академический рисунок, графика', 8,
                 'Опытный преподаватель с 8-летним стажем. Специализируется на академическом рисунке и графике.',
                 '["Свиблово"]', '@anna_petrova', '+79997778899', 'anna@artschool.ru', null, 1],
                 
                ['Сергей Смирнов', 'https://via.placeholder.com/300x300/9C6ADE/FFFFFF?text=СС',
                 'Художник-живописец, преподаватель с 10-летним стажем',
                 'Акварель, масляная живопись', 10,
                 'Эксперт в акварельной и масляной живописи. Работы учеников регулярно участвуют в выставках.',
                 '["Чертаново"]', '@sergey_smirnov', '+79996667788', 'sergey@artschool.ru', null, 2],
                 
                ['Елена Ковалева', 'https://via.placeholder.com/300x300/FFC107/FFFFFF?text=ЕК',
                 'Иллюстратор, дизайнер, преподаватель детских групп',
                 'Скетчинг, иллюстрация, детское творчество', 6,
                 'Специализируется на работе с детьми. Разработала авторскую методику обучения рисованию для детей.',
                 '["Свиблово", "Чертаново"]', '@elena_kovaleva', '+79995554433', 'elena@artschool.ru', null, 3]
            ];
            
            for (const teacher of teachers) {
                await db.run(
                    `INSERT INTO teachers (name, photo_url, qualification, specialization, 
                     experience_years, description, branches, telegram_username, 
                     phone_number, email, amocrm_user_id, display_order) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    teacher
                );
            }
            console.log('✅ Демо-преподаватели созданы');
        }

        // Демо расписание
        const scheduleExists = await db.get("SELECT 1 FROM schedule LIMIT 1");
        if (!scheduleExists) {
            const schedule = [
                ['Свиблово', 'понедельник', '16:00', '17:30', 1, 'Анна Петрова', 'Дети 7-9 лет', 'Кабинет 1', 8, 6],
                ['Свиблово', 'понедельник', '18:00', '19:30', 1, 'Анна Петрова', 'Подростки 10-12 лет', 'Кабинет 1', 8, 5],
                ['Свиблово', 'вторник', '17:00', '18:30', 3, 'Елена Ковалева', 'Дети 5-7 лет', 'Кабинет 2', 6, 4],
                ['Чертаново', 'среда', '16:30', '18:00', 2, 'Сергей Смирнов', 'Взрослые', 'Кабинет 3', 10, 8],
                ['Чертаново', 'суббота', '11:00', '12:30', 2, 'Сергей Смирнов', 'Подростки', 'Кабинет 3', 8, 7],
                ['Чертаново', 'суббота', '13:00', '14:30', 3, 'Елена Ковалеva', 'Дети 7-9 лет', 'Кабинет 4', 8, 6]
            ];
            
            for (const item of schedule) {
                await db.run(
                    `INSERT INTO schedule (branch, day_of_week, start_time, end_time, 
                     teacher_id, teacher_name, group_name, room_number, max_students, current_students) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    item
                );
            }
            console.log('✅ Демо-расписание создано');
        }

        // Демо FAQ
        const faqExists = await db.get("SELECT 1 FROM faq LIMIT 1");
        if (!faqExists) {
            const faq = [
                ['Как продлить абонемент?', 
                 'Для продления абонемента свяжитесь с администратором вашего филиала через кнопку "Связаться с администратором" в разделе "Абонемент".', 
                 'subscription', 1],
                 
                ['Что делать, если нужно пропустить занятие?', 
                 'Если вы пропускаете занятие по уважительной причине, сообщите об этом администратору за 24 часа. В некоторых случаях возможно перенести занятие.', 
                 'attendance', 2],
                 
                ['Какие материалы нужны для занятий?', 
                 'Основные материалы (бумага, красы, карандаши) предоставляются школой. Для некоторых специализированных занятий могут потребоваться дополнительные материалы, о чем преподаватель сообщит заранее.', 
                 'materials', 3],
                 
                ['Можно ли посещать занятия в другом филиале?', 
                 'Да, по предварительному согласованию с администраторами обеих филиалов возможно разовое посещение занятий в другом филиале.', 
                 'branches', 4],
                 
                ['Что входит в стоимость абонемента?', 
                 'В стоимость абонемента входят занятия с преподавателем, основные материалы, пользование оборудованием школы. Дополнительные материалы и участие в выставках оплачиваются отдельно.', 
                 'subscription', 5]
            ];
            
            for (const item of faq) {
                await db.run(
                    `INSERT INTO faq (question, answer, category, display_order) 
                     VALUES (?, ?, ?, ?)`,
                    item
                );
            }
            console.log('✅ Демо-FAQ созданы');
        }

        // Демо новости
        const newsExists = await db.get("SELECT 1 FROM news LIMIT 1");
        if (!newsExists) {
            const news = [
                ['Новая выставка работ учеников', 
                 'С 15 по 30 марта в холле школы будет проходить выставка работ наших учеников. Вы сможете увидеть прогресс детей за прошедший год и познакомиться с различными техниками рисования.',
                 'Приглашаем на выставку лучших работ наших учеников',
                 'https://via.placeholder.com/600x300/4A90E2/FFFFFF?text=Выставка+работ', null],
                 
                ['Мастер-класс по акварели', 
                 '15 апреля в 18:00 состоится бесплатный мастер-класс по акварельной живописи для взрослых. Все материалы предоставляются. Количество мест ограничено, необходима предварительная регистрация.',
                 'Бесплатный мастер-класс для всех желающих',
                 'https://via.placeholder.com/600x300/9C6ADE/FFFFFF?text=Мастер-класс', 'Свиблово'],
                 
                ['Летний интенсив по рисованию', 
                 'С 1 июня стартуют летние интенсивные курсы для детей и взрослых. За месяц вы освоите основы рисунка и живописи. Группы формируются по возрасту и уровню подготовки.',
                 'Запись на летние интенсивные курсы открыта',
                 'https://via.placeholder.com/600x300/FFC107/FFFFFF?text=Летний+курс', 'Чертаново']
            ];
            
            for (const item of news) {
                await db.run(
                    `INSERT INTO news (title, content, short_description, image_url, branch) 
                     VALUES (?, ?, ?, ?, ?)`,
                    item
                );
            }
            console.log('✅ Демо-новости созданы');
        }

        // Контакты филиалов
        const contactsExist = await db.get("SELECT 1 FROM branch_contacts LIMIT 1");
        if (!contactsExist) {
            await db.run(
                `INSERT INTO branch_contacts (branch, telegram_username, phone_number, email, address, working_hours) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ['Свиблово', '@art_school_sviblovo', '+7 (495) 123-45-67', 'sviblovo@artschool.ru', 
                 'ул. Свибловская, д. 1', 'Пн-Сб 10:00-20:00, Вс 10:00-18:00']
            );
            
            await db.run(
                `INSERT INTO branch_contacts (branch, telegram_username, phone_number, email, address, working_hours) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ['Чертаново', '@art_school_chertanovo', '+7 (495) 765-43-21', 'chertanovo@artschool.ru', 
                 'ул. Чертановская, д. 2', 'Пн-Сб 10:00-20:00, Вс 10:00-18:00']
            );
            
            console.log('✅ Контакты филиалов созданы');
        }

        console.log('🎉 Демо-данные созданы!');
        
    } catch (error) {
        console.error('⚠️ Ошибка создания демо-данных:', error.message);
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

// Получение профилей учеников по номеру телефона (из amoCRM)
async function findProfilesByPhone(phoneNumber) {
    try {
        // Если amoCRM инициализирован, ищем данные там
        if (amoCrmService.isInitialized) {
            console.log(`🔍 Поиск ученика в amoCRM по телефону: ${phoneNumber}`);
            const profiles = await amoCrmService.getStudentByPhoneFromAmo(phoneNumber);
            
            if (profiles && profiles.length > 0) {
                console.log(`✅ Найдено ${profiles.length} профилей в amoCRM`);
                return profiles;
            }
        }
        
        // Если не нашли в amoCRM или amoCRM не инициализирован, используем демо-данные
        console.log('⚠️ Использую демо-данные, т.к. amoCRM не доступен');
        return [
            {
                student_name: 'Иван Иванов',
                parent_name: 'Мария Иванова',
                phone_number: phoneNumber,
                branch: 'Свиблово',
                subscription_type: 'Художественный курс для начинающих',
                total_classes: 12,
                remaining_classes: 5,
                expiration_date: '2024-12-31',
                teacher_name: 'Анна Петрова',
                day_of_week: 'понедельник',
                time_slot: '16:00-17:30'
            },
            {
                student_name: 'Мария Сидорова',
                parent_name: 'Ольга Сидорова',
                phone_number: phoneNumber,
                branch: 'Чертаново',
                subscription_type: 'Курс акварельной живописи',
                total_classes: 16,
                remaining_classes: 8,
                expiration_date: '2024-11-30',
                teacher_name: 'Сергей Смирнов',
                day_of_week: 'среда',
                time_slot: '16:30-18:00'
            }
        ];
        
    } catch (error) {
        console.error('❌ Ошибка поиска профилей:', error.message);
        return [];
    }
}

// Сохранение профилей в базу
async function saveProfiles(telegramUserId, profiles) {
    const savedProfiles = [];
    
    for (const profile of profiles) {
        try {
            // Проверяем существующий профиль
            const existingProfile = await db.get(
                `SELECT * FROM student_profiles 
                 WHERE phone_number = ? AND student_name = ? AND telegram_user_id = ?`,
                [profile.phone_number, profile.student_name, telegramUserId]
            );
            
            if (!existingProfile) {
                // Создаем новый профиль
                const result = await db.run(
                    `INSERT INTO student_profiles 
                     (telegram_user_id, amocrm_contact_id, student_name, parent_name, phone_number, 
                      email, branch, subscription_type, total_classes, remaining_classes, 
                      expiration_date, teacher_name, day_of_week, time_slot, amocrm_custom_fields) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        telegramUserId,
                        profile.amocrm_contact_id || null,
                        profile.student_name,
                        profile.parent_name || '',
                        profile.phone_number,
                        profile.email || '',
                        profile.branch,
                        profile.subscription_type,
                        profile.total_classes,
                        profile.remaining_classes,
                        profile.expiration_date,
                        profile.teacher_name || '',
                        profile.day_of_week || '',
                        profile.time_slot || '',
                        profile.custom_fields ? JSON.stringify(profile.custom_fields) : null
                    ]
                );
                
                const newProfile = await db.get(
                    'SELECT * FROM student_profiles WHERE id = ?',
                    [result.lastID]
                );
                savedProfiles.push(newProfile);
            } else {
                // Обновляем существующий профиль
                await db.run(
                    `UPDATE student_profiles 
                     SET branch = ?, subscription_type = ?,
                         total_classes = ?, remaining_classes = ?, expiration_date = ?,
                         teacher_name = ?, day_of_week = ?, time_slot = ?,
                         amocrm_contact_id = ?, amocrm_custom_fields = ?,
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [
                        profile.branch,
                        profile.subscription_type,
                        profile.total_classes,
                        profile.remaining_classes,
                        profile.expiration_date,
                        profile.teacher_name || '',
                        profile.day_of_week || '',
                        profile.time_slot || '',
                        profile.amocrm_contact_id || existingProfile.amocrm_contact_id,
                        profile.custom_fields ? JSON.stringify(profile.custom_fields) : existingProfile.amocrm_custom_fields,
                        existingProfile.id
                    ]
                );
                
                savedProfiles.push({
                    ...existingProfile,
                    ...profile
                });
            }
        } catch (error) {
            console.error('❌ Ошибка сохранения профиля:', error.message);
        }
    }
    
    return savedProfiles;
}

// ==================== TELEGRAM БОТ КОМАНДЫ ====================

const WEB_APP_URL = 'sergeynikishin555123123-lab-itprogrammistingbot-8f42.twc1.net';

bot.start(async (ctx) => {
    const telegramId = ctx.from.id;
    const firstName = ctx.from.first_name || '';
    const lastName = ctx.from.last_name || '';
    const username = ctx.from.username || '';
    
    try {
        // Сохраняем пользователя
        const existingUser = await db.get(
            'SELECT * FROM telegram_users WHERE telegram_id = ?',
            [telegramId]
        );
        
        if (!existingUser) {
            await db.run(
                `INSERT INTO telegram_users (telegram_id, first_name, last_name, username) 
                 VALUES (?, ?, ?, ?)`,
                [telegramId, firstName, lastName, username]
            );
        } else {
            await db.run(
                `UPDATE telegram_users 
                 SET first_name = ?, last_name = ?, username = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE telegram_id = ?`,
                [firstName, lastName, username, telegramId]
            );
        }
    } catch (error) {
        console.error('Ошибка сохранения пользователя:', error);
    }
    
    await ctx.replyWithHTML(
        `🎨 <b>Добро пожаловать в художественную студию!</b>\n\n` +
        `Для доступа к вашему расписанию, абонементу и другим функциям перейдите в наше веб-приложение:`,
        Markup.inlineKeyboard([
            Markup.button.webApp(
                '🚀 Открыть приложение',
                `https://${WEB_APP_URL}`
            )
        ])
    );
});

bot.command('app', async (ctx) => {
    await ctx.replyWithHTML(
        `🎨 <b>Откройте приложение художественной студии</b>\n\n` +
        `Перейдите по кнопке ниже, чтобы получить доступ ко всем функциям:`,
        Markup.inlineKeyboard([
            Markup.button.webApp(
                '🚀 Открыть приложение',
                `https://${WEB_APP_URL}`
            )
        ])
    );
});

bot.command('help', async (ctx) => {
    await ctx.replyWithHTML(
        `🎨 <b>Помощь по боту художественной студии</b>\n\n` +
        `<b>Основные команды:</b>\n` +
        `/start - Начать работу с ботом\n` +
        `/app - Открыть веб-приложение\n` +
        `/help - Эта справка\n\n` +
        `<b>Как использовать:</b>\n` +
        `1. Нажмите /start для начала работы\n` +
        `2. Нажмите кнопку "Открыть приложение"\n` +
        `3. В приложении авторизуйтесь через Telegram\n` +
        `4. Используйте все функции личного кабинета\n\n` +
        `<b>Функции приложения:</b>\n` +
        `• Просмотр расписания занятий\n` +
        `• Информация об абонементе\n` +
        `• История посещений\n` +
        `• Связь с администратором\n` +
        `• Уведомления об изменениях\n\n` +
        `<b>Техническая поддержка:</b>\n` +
        `Если у вас возникли проблемы, напишите администратору в приложении`
    );
});

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    
    if (text.startsWith('/')) {
        return;
    }
    
    await ctx.replyWithHTML(
        `🎨 Для работы с функциями художественной студии используйте наше веб-приложение:`,
        Markup.inlineKeyboard([
            Markup.button.webApp(
                '🚀 Открыть приложение',
                `https://${WEB_APP_URL}`
            )
        ])
    );
});

// ==================== EXPRESS API С ИНТЕГРАЦИЕЙ AMOCRM ====================

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use('/api/', limiter);

// Webhook для Telegram
app.post('/webhook', (req, res) => {
    bot.handleUpdate(req.body, res);
});

// ==================== API ДЛЯ РАБОТЫ С AMOCRM ====================

// Получение статуса amoCRM
app.get('/api/amocrm/status', async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                is_initialized: amoCrmService.isInitialized,
                domain: AMOCRM_DOMAIN,
                client_id: AMOCRM_CLIENT_ID ? '✅ Установлен' : '❌ Не установлен',
                has_auth_code: !!AMOCRM_AUTH_CODE
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статуса amoCRM'
        });
    }
});

// Синхронизация данных с amoCRM
app.post('/api/amocrm/sync', async (req, res) => {
    try {
        const { sync_type } = req.body;
        
        let result;
        
        switch (sync_type) {
            case 'teachers':
                result = await amoCrmService.syncTeachersFromAmo();
                break;
            case 'students':
                result = await amoCrmService.syncStudentsFromAmo();
                break;
            case 'subscriptions':
                result = await amoCrmService.syncSubscriptionsFromAmo();
                break;
            case 'all':
            default:
                result = await amoCrmService.syncAllData();
                break;
        }
        
        res.json({
            success: true,
            message: `Синхронизация ${sync_type || 'all'} завершена`,
            data: result
        });
        
    } catch (error) {
        console.error('Ошибка синхронизации:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка синхронизации с amoCRM'
        });
    }
});

// Получение контактов из amoCRM
app.get('/api/amocrm/contacts', async (req, res) => {
    try {
        if (!amoCrmService.isInitialized) {
            return res.status(400).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const { phone, limit } = req.query;
        const contacts = await amoCrmService.getContacts({ phone, limit: parseInt(limit) || 50 });
        
        res.json({
            success: true,
            data: contacts
        });
        
    } catch (error) {
        console.error('Ошибка получения контактов:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения контактов из amoCRM'
        });
    }
});

// Получение сделок из amoCRM
app.get('/api/amocrm/leads', async (req, res) => {
    try {
        if (!amoCrmService.isInitialized) {
            return res.status(400).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const { contact_id, status_id, limit } = req.query;
        const leads = await amoCrmService.getLeads({ 
            contact_id, 
            status_id,
            limit: parseInt(limit) || 50 
        });
        
        res.json({
            success: true,
            data: leads
        });
        
    } catch (error) {
        console.error('Ошибка получения сделок:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения сделок из amoCRM'
        });
    }
});

// Создание сделки в amoCRM
app.post('/api/amocrm/leads', async (req, res) => {
    try {
        if (!amoCrmService.isInitialized) {
            return res.status(400).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const { student_profile_id, subscription_data } = req.body;
        
        if (!student_profile_id || !subscription_data) {
            return res.status(400).json({
                success: false,
                error: 'Необходимы student_profile_id и subscription_data'
            });
        }
        
        const result = await amoCrmService.createSubscription(student_profile_id, subscription_data);
        
        res.json({
            success: true,
            message: 'Сделка создана в amoCRM',
            data: result
        });
        
    } catch (error) {
        console.error('Ошибка создания сделки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания сделки в amoCRM'
        });
    }
});

// Отметка посещения в amoCRM
app.post('/api/amocrm/attendance', async (req, res) => {
    try {
        if (!amoCrmService.isInitialized) {
            return res.status(400).json({
                success: false,
                error: 'amoCRM не инициализирован'
            });
        }
        
        const { student_profile_id, attendance_data } = req.body;
        
        if (!student_profile_id || !attendance_data) {
            return res.status(400).json({
                success: false,
                error: 'Необходимы student_profile_id и attendance_data'
            });
        }
        
        const result = await amoCrmService.markAttendance(student_profile_id, attendance_data);
        
        res.json({
            success: true,
            message: 'Посещение отмечено в amoCRM',
            data: result
        });
        
    } catch (error) {
        console.error('Ошибка отметки посещения:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отметки посещения в amoCRM'
        });
    }
});

// ==================== ОСНОВНОЙ API ====================

// Проверка статуса сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер школы рисования работает',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        amocrm_connected: amoCrmService.isInitialized
    });
});

// Получение расписания
app.post('/api/schedule', async (req, res) => {
    try {
        const { branch, week_start } = req.body;
        
        if (!branch) {
            return res.status(400).json({
                success: false,
                error: 'Укажите филиал'
            });
        }
        
        const schedule = await db.all(
            `SELECT * FROM schedule 
             WHERE branch = ? AND is_active = 1
             ORDER BY 
                 CASE day_of_week 
                     WHEN 'понедельник' THEN 1
                     WHEN 'вторник' THEN 2
                     WHEN 'среда' THEN 3
                     WHEN 'четверг' THEN 4
                     WHEN 'пятница' THEN 5
                     WHEN 'суббота' THEN 6
                     WHEN 'воскресенье' THEN 7
                     ELSE 8
                 END, start_time`,
            [branch]
        );
        
        res.json({
            success: true,
            data: {
                schedule: schedule,
                branch: branch
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения расписания:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения расписания'
        });
    }
});

// Получение информации об абонементе
app.post('/api/subscription', async (req, res) => {
    try {
        const { profile_id } = req.body;
        
        if (!profile_id) {
            return res.status(400).json({
                success: false,
                error: 'Укажите ID профиля'
            });
        }
        
        const profile = await db.get(
            `SELECT * FROM student_profiles WHERE id = ?`,
            [profile_id]
        );
        
        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Абонемент не найден'
            });
        }
        
        // Получаем историю посещений
        let visits = [];
        
        // Сначала пробуем получить из локальной базы
        const localVisits = await db.all(
            `SELECT * FROM attendance 
             WHERE student_profile_id = ?
             ORDER BY attendance_date DESC
             LIMIT 20`,
            [profile.id]
        );
        
        if (localVisits && localVisits.length > 0) {
            visits = localVisits;
        } else if (amoCrmService.isInitialized && profile.amocrm_contact_id) {
            // Если в локальной базе нет данных, пробуем получить из amoCRM
            visits = await amoCrmService.getAttendanceHistory(profile.id);
        }
        
        res.json({
            success: true,
            data: {
                subscription: profile,
                visits: visits,
                amocrm_connected: amoCrmService.isInitialized
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения информации об абонементе:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения информации об абонементе'
        });
    }
});

// Получение преподавателей
app.get('/api/teachers', async (req, res) => {
    try {
        const { branch } = req.query;
        
        let teachers;
        if (branch) {
            teachers = await db.all(
                `SELECT * FROM teachers 
                 WHERE is_active = 1 
                   AND (branches LIKE ? OR branches LIKE '%"all"%' OR branches IS NULL)
                 ORDER BY display_order, name`,
                [`%${branch}%`]
            );
        } else {
            teachers = await db.all(
                `SELECT * FROM teachers 
                 WHERE is_active = 1
                 ORDER BY display_order, name`
            );
        }
        
        res.json({
            success: true,
            data: {
                teachers: teachers,
                total: teachers.length,
                synced_from_amocrm: teachers.some(t => t.amocrm_user_id)
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения преподавателей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения преподавателей'
        });
    }
});

// Получение FAQ
app.get('/api/faq', async (req, res) => {
    try {
        const faq = await db.all(
            `SELECT * FROM faq 
             WHERE is_active = 1
             ORDER BY display_order, category`
        );
        
        res.json({
            success: true,
            data: {
                faq: faq
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения FAQ:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения FAQ'
        });
    }
});

// Получение новостей
app.get('/api/news', async (req, res) => {
    try {
        const { branch } = req.query;
        
        let query = `SELECT * FROM news WHERE is_active = 1`;
        let params = [];
        
        if (branch) {
            query += ` AND (branch = ? OR branch IS NULL)`;
            params.push(branch);
        }
        
        query += ` ORDER BY publish_date DESC, created_at DESC`;
        
        const news = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                news: news,
                total: news.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения новостей:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения новостей'
        });
    }
});

// Авторизация через Telegram
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { telegram_id, first_name, last_name, username, phone } = req.body;
        
        if (!telegram_id || !phone) {
            return res.status(400).json({
                success: false,
                error: 'Необходимы telegram_id и номер телефона'
            });
        }
        
        // Проверяем существующего пользователя
        let telegramUser = await db.get(
            'SELECT * FROM telegram_users WHERE telegram_id = ? OR phone_number = ?',
            [telegram_id, phone]
        );
        
        if (!telegramUser) {
            // Создаем нового пользователя
            const result = await db.run(
                `INSERT INTO telegram_users (telegram_id, phone_number, first_name, last_name, username) 
                 VALUES (?, ?, ?, ?, ?)`,
                [telegram_id, phone, first_name || '', last_name || '', username || '']
            );
            
            telegramUser = await db.get(
                'SELECT * FROM telegram_users WHERE id = ?',
                [result.lastID]
            );
            
            console.log(`✅ Новый пользователь Telegram создан: ${telegramUser.id}`);
        } else {
            // Обновляем существующего пользователя
            await db.run(
                `UPDATE telegram_users 
                 SET phone_number = ?, first_name = ?, last_name = ?, username = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [phone, first_name || '', last_name || '', username || '', telegramUser.id]
            );
        }
        
        // Ищем профили (из amoCRM или демо)
        const profiles = await findProfilesByPhone(phone);
        const savedProfiles = await saveProfiles(telegramUser.id, profiles);
        
        // Если есть профили, устанавливаем первый как выбранный
        if (savedProfiles.length > 0) {
            await db.run(
                'UPDATE student_profiles SET last_selected = 0 WHERE telegram_user_id = ?',
                [telegramUser.id]
            );
            
            await db.run(
                'UPDATE student_profiles SET last_selected = 1 WHERE id = ?',
                [savedProfiles[0].id]
            );
        }
        
        // Создаем JWT токен
        const token = jwt.sign(
            {
                id: telegramUser.id,
                telegram_id: telegramUser.telegram_id,
                phone: telegramUser.phone_number
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Авторизация успешна',
            data: {
                user: telegramUser,
                profiles: savedProfiles,
                total_profiles: savedProfiles.length,
                amocrm_connected: amoCrmService.isInitialized,
                token: token
            }
        });
        
    } catch (error) {
        console.error('Ошибка авторизации через Telegram:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка авторизации'
        });
    }
});

// Админ авторизация
app.post('/api/admin/auth', async (req, res) => {
    try {
        const { telegram_id } = req.body;
        
        if (!telegram_id) {
            return res.status(400).json({
                success: false,
                error: 'Необходим telegram_id'
            });
        }
        
        const admin = await db.get(
            'SELECT * FROM administrators WHERE telegram_id = ?',
            [telegram_id]
        );
        
        if (!admin) {
            return res.status(403).json({
                success: false,
                error: 'Доступ запрещен'
            });
        }
        
        const token = jwt.sign(
            {
                id: admin.id,
                telegram_id: admin.telegram_id,
                role: admin.role
            },
            JWT_SECRET,
            { expiresIn: '1d' }
        );
        
        res.json({
            success: true,
            data: {
                admin: admin,
                token: token
            }
        });
        
    } catch (error) {
        console.error('Ошибка админ авторизации:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка авторизации'
        });
    }
});

// Создание рассылки (админ)
app.post('/api/admin/broadcasts', async (req, res) => {
    try {
        const { message, filters, token } = req.body;
        
        if (!message || !token) {
            return res.status(400).json({
                success: false,
                error: 'Необходимы сообщение и токен'
            });
        }
        
        // Проверяем токен
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            
            const admin = await db.get(
                'SELECT * FROM administrators WHERE id = ?',
                [decoded.id]
            );
            
            if (!admin) {
                return res.status(403).json({
                    success: false,
                    error: 'Доступ запрещен'
                });
            }
            
            // Создаем рассылку
            const result = await db.run(
                `INSERT INTO broadcasts 
                 (admin_id, broadcast_type, message_type, title, message, 
                  branches, teacher_ids, days_of_week, filters_applied, status) 
                 VALUES (?, 'service', 'custom', 'Рассылка', ?, ?, ?, ?, ?, 'sent')`,
                [
                    admin.id,
                    message,
                    filters?.branches ? JSON.stringify(filters.branches) : null,
                    filters?.teacher_ids ? JSON.stringify(filters.teacher_ids) : null,
                    filters?.days_of_week ? JSON.stringify(filters.days_of_week) : null,
                    filters ? JSON.stringify(filters) : null
                ]
            );
            
            res.json({
                success: true,
                message: 'Рассылка создана',
                data: {
                    broadcast_id: result.lastID
                }
            });
            
        } catch (jwtError) {
            return res.status(401).json({
                success: false,
                error: 'Неверный токен'
            });
        }
        
    } catch (error) {
        console.error('Ошибка создания рассылки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания рассылки'
        });
    }
});

// Получение статистики
app.get('/api/admin/stats', async (req, res) => {
    try {
        const { token } = req.query;
        
        if (!token) {
            return res.status(400).json({
                success: false,
                error: 'Необходим токен'
            });
        }
        
        // Проверяем токен
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            
            const admin = await db.get(
                'SELECT * FROM administrators WHERE id = ?',
                [decoded.id]
            );
            
            if (!admin) {
                return res.status(403).json({
                    success: false,
                    error: 'Доступ запрещен'
                });
            }
            
            // Получаем статистику
            const totalStudents = await db.get('SELECT COUNT(*) as count FROM student_profiles WHERE is_active = 1');
            const totalTeachers = await db.get('SELECT COUNT(*) as count FROM teachers WHERE is_active = 1');
            const todayAttendance = await db.get(`
                SELECT COUNT(*) as count FROM attendance 
                WHERE DATE(attendance_date) = DATE('now')
            `);
            const activeSubscriptions = await db.get(`
                SELECT COUNT(*) as count FROM student_profiles 
                WHERE remaining_classes > 0 AND expiration_date >= DATE('now')
            `);
            
            // Статистика по филиалам
            const branchesStats = await db.all(`
                SELECT branch, COUNT(*) as students_count 
                FROM student_profiles 
                WHERE is_active = 1 
                GROUP BY branch
            `);
            
            res.json({
                success: true,
                data: {
                    total_students: totalStudents.count,
                    total_teachers: totalTeachers.count,
                    today_attendance: todayAttendance.count,
                    active_subscriptions: activeSubscriptions.count,
                    branches: branchesStats,
                    amocrm_connected: amoCrmService.isInitialized
                }
            });
            
        } catch (jwtError) {
            return res.status(401).json({
                success: false,
                error: 'Неверный токен'
            });
        }
        
    } catch (error) {
        console.error('Ошибка получения статистики:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// Получение логов синхронизации с amoCRM
app.get('/api/amocrm/sync-logs', async (req, res) => {
    try {
        const logs = await db.all(`
            SELECT * FROM amocrm_sync_logs 
            ORDER BY sync_date DESC 
            LIMIT 50
        `);
        
        res.json({
            success: true,
            data: {
                logs: logs
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения логов синхронизации:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения логов'
        });
    }
});

// ==================== OAuth callback для amoCRM ====================

app.get('/oauth/callback', async (req, res) => {
    try {
        const { code } = req.query;
        
        if (!code) {
            return res.status(400).send('Не передан код авторизации');
        }
        
        console.log('🔄 Получен код авторизации amoCRM');
        
        // Обмениваем код на токен
        await amoCrmService.exchangeCodeForToken(code);
        
        // Синхронизируем данные
        await amoCrmService.syncAllData();
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Авторизация amoCRM завершена</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        text-align: center;
                        padding: 50px;
                        background-color: #f5f5f5;
                    }
                    .container {
                        background: white;
                        padding: 30px;
                        border-radius: 10px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                        max-width: 500px;
                        margin: 0 auto;
                    }
                    .success {
                        color: #4CAF50;
                        font-size: 24px;
                        margin-bottom: 20px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="success">✅ Авторизация amoCRM успешно завершена!</div>
                    <p>Интеграция с amoCRM настроена. Данные синхронизируются.</p>
                    <p>Вы можете закрыть это окно и вернуться в приложение.</p>
                    <p><a href="/admin">Перейти в админ-панель</a></p>
                </div>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('Ошибка обработки OAuth callback:', error.message);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Ошибка авторизации amoCRM</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .error { color: #f44336; font-size: 24px; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <div class="error">❌ Ошибка авторизации amoCRM</div>
                <p>${error.message}</p>
                <p><a href="/admin">Вернуться в админ-панель</a></p>
            </body>
            </html>
        `);
    }
});

// Статические файлы
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ==================== ЗАПУСК СЕРВЕРА ====================

const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🎨 ЗАПУСК СИСТЕМЫ ХУДОЖЕСТВЕННОЙ СТУДИИ С ИНТЕГРАЦИЕЙ AMOCRM');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        
        try {
            const botInfo = await bot.telegram.getMe();
            console.log(`🤖 Telegram бот: @${botInfo.username}`);
        } catch (botError) {
            console.log('🤖 Telegram бот: Информация недоступна');
            console.log('⚠️  Проверьте токен бота');
        }
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}!`);
            console.log(`🌐 Доступ по адресу: http://localhost:${PORT}`);
            console.log('='.repeat(80));
            console.log('🔧 КОНФИГУРАЦИЯ:');
            console.log('='.repeat(50));
            console.log(`Бот токен: ${TELEGRAM_BOT_TOKEN ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log(`Домен: ${DOMAIN}`);
            console.log(`amoCRM домен: ${AMOCRM_DOMAIN || '❌ Не установлен'}`);
            console.log(`amoCRM client_id: ${AMOCRM_CLIENT_ID ? '✅ Установлен' : '❌ Не установлен'}`);
            console.log(`amoCRM инициализирован: ${amoCrmService.isInitialized ? '✅ Да' : '❌ Нет'}`);
            console.log('='.repeat(50));
            
            console.log('\n🎯 ОСНОВНЫЕ ФУНКЦИОНАЛЬНОСТИ:');
            console.log('='.repeat(60));
            console.log('✅ Telegram бот с веб-приложением');
            console.log(`✅ Интеграция с amoCRM: ${amoCrmService.isInitialized ? '✅ Активна' : '⚠️ Неактивна'}`);
            console.log('✅ Синхронизация учеников, преподавателей и абонементов');
            console.log('✅ Отметка посещений в amoCRM');
            console.log('✅ Админ-панель с OAuth авторизацией');
            console.log('✅ Расписание занятий');
            console.log('✅ Управление абонементами');
            console.log('✅ Статистика и аналитика');
            console.log('='.repeat(60));
            
            console.log('\n📱 КАК ИСПОЛЬЗОВАТЬ:');
            console.log('='.repeat(60));
            console.log('1. Откройте Telegram бота');
            console.log('2. Нажмите /start и поделитесь номером телефона');
            console.log('3. Перейдите в веб-приложение');
            console.log('4. Для админ-панели: http://localhost:3000/admin');
            if (!amoCrmService.isInitialized && AMOCRM_CLIENT_ID && AMOCRM_DOMAIN) {
                console.log('5. Для настройки amoCRM: http://localhost:3000/oauth/callback');
            }
            console.log('='.repeat(60));
        });
        
        // Запускаем бота
        bot.launch().then(() => {
            console.log('🤖 Telegram бот запущен в режиме polling');
        }).catch(error => {
            console.error('❌ Ошибка запуска бота:', error.message);
        });
        
        // Планировщик для автоматической синхронизации с amoCRM
        if (amoCrmService.isInitialized) {
            setInterval(async () => {
                try {
                    console.log('🔄 Автоматическая синхронизация с amoCRM...');
                    await amoCrmService.syncAllData();
                    console.log('✅ Автоматическая синхронизация завершена');
                } catch (error) {
                    console.error('❌ Ошибка автоматической синхронизации:', error.message);
                }
            }, 30 * 60 * 1000); // Каждые 30 минут
        }
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Обработка завершения работы
process.on('SIGINT', async () => {
    console.log('\n🔄 Остановка сервера...');
    if (db) {
        await db.close();
        console.log('✅ База данных закрыта');
    }
    bot.stop('SIGINT');
    console.log('✅ Telegram бот остановлен');
    process.exit(0);
});

// Запуск
startServer();
