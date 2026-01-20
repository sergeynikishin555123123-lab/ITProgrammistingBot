// server.js - Полный диагностический сервер для проверки amoCRM
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();

// ==================== КОНФИГУРАЦИЯ ====================
const DOMAIN = process.env.DOMAIN || 'http://localhost:3000';
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN || 'pismovbanu.amocrm.ru';
const AMOCRM_SUBDOMAIN = AMOCRM_DOMAIN.replace('.amocrm.ru', '');
const AMOCRM_CLIENT_ID = process.env.AMOCRM_CLIENT_ID;
const AMOCRM_CLIENT_SECRET = process.env.AMOCRM_CLIENT_SECRET;
const AMOCRM_REDIRECT_URI = process.env.AMOCRM_REDIRECT_URI || `${DOMAIN}/oauth/callback`;
const AMOCRM_ACCESS_TOKEN = process.env.AMOCRM_ACCESS_TOKEN;
const AMOCRM_REFRESH_TOKEN = process.env.AMOCRM_REFRESH_TOKEN;

// ==================== НАСТРОЙКА EXPRESS ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Middleware для логирования всех запросов
app.use((req, res, next) => {
    const startTime = Date.now();
    const requestId = crypto.randomBytes(4).toString('hex');
    
    console.log(`\n📥 [${requestId}] ${req.method} ${req.url}`);
    console.log(`   IP: ${req.ip}, User-Agent: ${req.headers['user-agent']?.substring(0, 50)}...`);
    
    if (Object.keys(req.body).length > 0) {
        console.log(`   Body:`, JSON.stringify(req.body).substring(0, 200));
    }
    
    // Перехватываем response для логирования
    const originalSend = res.send;
    res.send = function(data) {
        const duration = Date.now() - startTime;
        console.log(`📤 [${requestId}] ${res.statusCode} ${duration}ms`);
        
        if (typeof data === 'string' && data.length < 1000) {
            console.log(`   Response: ${data.substring(0, 200)}...`);
        }
        
        originalSend.call(this, data);
    };
    
    next();
});

// ==================== КЛАСС ДЛЯ ПОЛНОЙ ДИАГНОСТИКИ AMOCRM ====================
class AmoCrmDiagnostic {
    constructor() {
        console.log('\n' + '='.repeat(100));
        console.log('🔍 СОЗДАНИЕ СИСТЕМЫ ПОЛНОЙ ДИАГНОСТИКИ AMOCRM');
        console.log('='.repeat(100));
        
        this.baseUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.oauthUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru`;
        this.accessToken = AMOCRM_ACCESS_TOKEN;
        this.refreshToken = AMOCRM_REFRESH_TOKEN;
        this.clientId = AMOCRM_CLIENT_ID;
        this.clientSecret = AMOCRM_CLIENT_SECRET;
        this.redirectUri = AMOCRM_REDIRECT_URI;
        
        this.logConfig();
        this.createLogFile();
    }

    async createLogFile() {
        try {
            const logDir = path.join(__dirname, 'logs');
            await fs.mkdir(logDir, { recursive: true });
            this.logFilePath = path.join(logDir, `amocrm-diagnostic-${Date.now()}.log`);
            
            const configLog = `
=============================================================
AMOCRM ДИАГНОСТИКА - ${new Date().toISOString()}
=============================================================
DOMAIN: ${DOMAIN}
AMOCRM_DOMAIN: ${AMOCRM_DOMAIN}
AMOCRM_CLIENT_ID: ${AMOCRM_CLIENT_ID ? 'SET' : 'NOT SET'}
AMOCRM_CLIENT_SECRET: ${AMOCRM_CLIENT_SECRET ? 'SET' : 'NOT SET'}
AMOCRM_ACCESS_TOKEN: ${AMOCRM_ACCESS_TOKEN ? 'SET (' + AMOCRM_ACCESS_TOKEN.substring(0, 20) + '...)' : 'NOT SET'}
AMOCRM_REFRESH_TOKEN: ${AMOCRM_REFRESH_TOKEN ? 'SET (' + AMOCRM_REFRESH_TOKEN.substring(0, 20) + '...)' : 'NOT SET'}
AMOCRM_REDIRECT_URI: ${AMOCRM_REDIRECT_URI}
BASE_URL: ${this.baseUrl}
OAUTH_URL: ${this.oauthUrl}
=============================================================
            `;
            
            await fs.writeFile(this.logFilePath, configLog);
            console.log(`📝 Лог файл создан: ${this.logFilePath}`);
        } catch (error) {
            console.error('❌ Не удалось создать лог файл:', error.message);
        }
    }

    logConfig() {
        console.log('\n⚙️  КОНФИГУРАЦИЯ AMOCRM:');
        console.log('='.repeat(80));
        console.log(`🏢 Домен: ${AMOCRM_DOMAIN}`);
        console.log(`🔗 Base URL: ${this.baseUrl}`);
        console.log(`🔗 OAuth URL: ${this.oauthUrl}`);
        console.log(`🔑 Client ID: ${this.clientId ? '✅ Установлен' : '❌ Не установлен'}`);
        console.log(`🔐 Client Secret: ${this.clientSecret ? '✅ Установлен' : '❌ Не установлен'}`);
        console.log(`🔄 Redirect URI: ${this.redirectUri}`);
        console.log(`🔑 Access Token: ${this.accessToken ? '✅ Установлен (' + this.accessToken.substring(0, 30) + '...)' : '❌ Не установлен'}`);
        console.log(`🔄 Refresh Token: ${this.refreshToken ? '✅ Установлен (' + this.refreshToken.substring(0, 30) + '...)' : '❌ Не установлен'}`);
        console.log('='.repeat(80));
    }

    async logToFile(message) {
        try {
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] ${message}\n`;
            await fs.appendFile(this.logFilePath, logMessage);
        } catch (error) {
            console.error('❌ Ошибка записи в лог файл:', error.message);
        }
    }

    async testStep(stepName, testFunction) {
        console.log(`\n🧪 ШАГ: ${stepName}`);
        console.log('─'.repeat(80));
        
        await this.logToFile(`Начало шага: ${stepName}`);
        
        const result = {
            step: stepName,
            success: false,
            timestamp: new Date().toISOString(),
            data: null,
            error: null
        };
        
        try {
            const data = await testFunction();
            result.success = true;
            result.data = data;
            console.log(`✅ ${stepName}: УСПЕХ`);
            await this.logToFile(`✅ ${stepName}: УСПЕХ`);
            return result;
        } catch (error) {
            result.success = false;
            result.error = {
                message: error.message,
                code: error.code,
                response: error.response ? {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data
                } : null
            };
            
            console.log(`❌ ${stepName}: ОШИБКА`);
            console.log(`   ${error.message}`);
            
            if (error.response) {
                console.log(`   Статус: ${error.response.status} ${error.response.statusText}`);
                if (error.response.data) {
                    console.log(`   Ответ:`, JSON.stringify(error.response.data, null, 2));
                }
            }
            
            await this.logToFile(`❌ ${stepName}: ОШИБКА - ${error.message}`);
            return result;
        }
    }

    async makeRequest(method, url, data = null, headers = {}) {
        const defaultHeaders = {
            'User-Agent': 'AmoCRM-Diagnostic/1.0',
            'Accept': 'application/json',
            ...headers
        };
        
        if (this.accessToken && !headers['Authorization']) {
            defaultHeaders['Authorization'] = `Bearer ${this.accessToken}`;
        }
        
        const config = {
            method,
            url,
            headers: defaultHeaders,
            timeout: 30000,
            validateStatus: function (status) {
                return status >= 200 && status < 600; // Принимаем все статусы для диагностики
            }
        };
        
        if (data) {
            config.data = data;
            if (!config.headers['Content-Type']) {
                config.headers['Content-Type'] = 'application/json';
            }
        }
        
        console.log(`🌐 Запрос: ${method} ${url}`);
        console.log(`   Headers:`, JSON.stringify(config.headers, null, 2).substring(0, 200) + '...');
        if (data) {
            console.log(`   Data:`, JSON.stringify(data, null, 2).substring(0, 300) + '...');
        }
        
        try {
            const response = await axios(config);
            
            console.log(`📥 Ответ: ${response.status} ${response.statusText}`);
            console.log(`   Headers:`, JSON.stringify(response.headers, null, 2).substring(0, 200) + '...');
            
            if (response.data && typeof response.data === 'object') {
                console.log(`   Data keys:`, Object.keys(response.data).join(', '));
                if (Object.keys(response.data).length < 5) {
                    console.log(`   Data:`, JSON.stringify(response.data, null, 2));
                }
            }
            
            return response;
        } catch (error) {
            console.error(`❌ Ошибка запроса:`, error.message);
            if (error.response) {
                console.error(`   Статус: ${error.response.status}`);
                console.error(`   Данные:`, JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
    }

    async fullDiagnostic() {
        console.log('\n' + '='.repeat(100));
        console.log('🚀 ЗАПУСК ПОЛНОЙ ДИАГНОСТИКИ AMOCRM');
        console.log('='.repeat(100));
        
        await this.logToFile('Начало полной диагностики amoCRM');
        
        const results = {
            timestamp: new Date().toISOString(),
            config: this.getConfigSummary(),
            steps: []
        };
        
        // Шаг 1: Проверка доступности домена
        results.steps.push(await this.testStep('Проверка доступности домена amoCRM', async () => {
            return await this.makeRequest('GET', this.baseUrl, null, {});
        }));
        
        // Шаг 2: Проверка OAuth эндпоинта
        results.steps.push(await this.testStep('Проверка OAuth эндпоинта', async () => {
            return await this.makeRequest('GET', `${this.oauthUrl}/oauth`, null, {});
        }));
        
        // Шаг 3: Проверка API версии
        results.steps.push(await this.testStep('Проверка API версии', async () => {
            return await this.makeRequest('GET', `${this.baseUrl}/api/v4`, null, {});
        }));
        
        // Шаг 4: Проверка Access Token (если есть)
        if (this.accessToken) {
            results.steps.push(await this.testStep('Проверка валидности Access Token', async () => {
                return await this.makeRequest('GET', `${this.baseUrl}/api/v4/account`, null, {
                    'Authorization': `Bearer ${this.accessToken}`
                });
            }));
        }
        
        // Шаг 5: Проверка Refresh Token (если есть)
        if (this.refreshToken && this.clientId && this.clientSecret) {
            results.steps.push(await this.testStep('Проверка Refresh Token', async () => {
                const tokenData = {
                    client_id: this.clientId,
                    client_secret: this.clientSecret,
                    grant_type: 'refresh_token',
                    refresh_token: this.refreshToken,
                    redirect_uri: this.redirectUri
                };
                
                return await this.makeRequest('POST', `${this.oauthUrl}/oauth2/access_token`, tokenData);
            }));
        }
        
        // Шаг 6: Проверка авторизации OAuth
        if (this.clientId) {
            results.steps.push(await this.testStep('Проверка OAuth авторизации', async () => {
                const authUrl = `${this.oauthUrl}/oauth?client_id=${this.clientId}&mode=post_message`;
                return await this.makeRequest('GET', authUrl);
            }));
        }
        
        // Шаг 7: Проверка получения информации об аккаунте (если токен валиден)
        if (results.steps.find(s => s.step === 'Проверка валидности Access Token' && s.success)) {
            results.steps.push(await this.testStep('Получение информации об аккаунте', async () => {
                return await this.makeRequest('GET', `${this.baseUrl}/api/v4/account`, null, {
                    'Authorization': `Bearer ${this.accessToken}`
                });
            }));
            
            // Шаг 8: Проверка получения пользователей
            results.steps.push(await this.testStep('Получение списка пользователей', async () => {
                return await this.makeRequest('GET', `${this.baseUrl}/api/v4/users`, null, {
                    'Authorization': `Bearer ${this.accessToken}`
                });
            }));
            
            // Шаг 9: Проверка получения контактов
            results.steps.push(await this.testStep('Получение списка контактов', async () => {
                return await this.makeRequest('GET', `${this.baseUrl}/api/v4/contacts?limit=5`, null, {
                    'Authorization': `Bearer ${this.accessToken}`
                });
            }));
            
            // Шаг 10: Проверка получения сделок
            results.steps.push(await this.testStep('Получение списка сделок', async () => {
                return await this.makeRequest('GET', `${this.baseUrl}/api/v4/leads?limit=5`, null, {
                    'Authorization': `Bearer ${this.accessToken}`
                });
            }));
            
            // Шаг 11: Проверка кастомных полей
            results.steps.push(await this.testStep('Получение кастомных полей контактов', async () => {
                return await this.makeRequest('GET', `${this.baseUrl}/api/v4/contacts/custom_fields`, null, {
                    'Authorization': `Bearer ${this.accessToken}`
                });
            }));
        }
        
        // Шаг 12: Проверка Webhook (если есть токен)
        if (this.accessToken) {
            results.steps.push(await this.testStep('Проверка Webhook настроек', async () => {
                return await this.makeRequest('GET', `${this.baseUrl}/api/v4/webhooks`, null, {
                    'Authorization': `Bearer ${this.accessToken}`
                });
            }));
        }
        
        // Итоги диагностики
        results.summary = this.generateSummary(results.steps);
        
        console.log('\n' + '='.repeat(100));
        console.log('📊 ИТОГИ ДИАГНОСТИКИ');
        console.log('='.repeat(100));
        
        console.log(`✅ Успешных шагов: ${results.summary.successCount}`);
        console.log(`❌ Ошибочных шагов: ${results.summary.errorCount}`);
        console.log(`📈 Общий успех: ${results.summary.successRate}%`);
        console.log(`⏱️  Время выполнения: ${results.summary.duration}ms`);
        
        if (results.summary.criticalErrors.length > 0) {
            console.log('\n🚨 КРИТИЧЕСКИЕ ОШИБКИ:');
            results.summary.criticalErrors.forEach(error => {
                console.log(`   • ${error}`);
            });
        }
        
        if (results.summary.recommendations.length > 0) {
            console.log('\n💡 РЕКОМЕНДАЦИИ:');
            results.summary.recommendations.forEach(rec => {
                console.log(`   • ${rec}`);
            });
        }
        
        // Сохраняем результаты в файл
        await this.saveResultsToFile(results);
        
        return results;
    }

    getConfigSummary() {
        return {
            domain: AMOCRM_DOMAIN,
            clientId: this.clientId ? 'SET' : 'NOT SET',
            clientSecret: this.clientSecret ? 'SET' : 'NOT SET',
            accessToken: this.accessToken ? 'SET (' + this.accessToken.substring(0, 10) + '...)' : 'NOT SET',
            refreshToken: this.refreshToken ? 'SET (' + this.refreshToken.substring(0, 10) + '...)' : 'NOT SET',
            redirectUri: this.redirectUri,
            baseUrl: this.baseUrl,
            oauthUrl: this.oauthUrl
        };
    }

    generateSummary(steps) {
        const successCount = steps.filter(s => s.success).length;
        const errorCount = steps.filter(s => !s.success).length;
        const successRate = steps.length > 0 ? Math.round((successCount / steps.length) * 100) : 0;
        
        const startTime = new Date(steps[0]?.timestamp);
        const endTime = new Date(steps[steps.length - 1]?.timestamp);
        const duration = endTime - startTime || 0;
        
        const criticalErrors = [];
        const recommendations = [];
        
        // Анализируем ошибки для рекомендаций
        steps.forEach(step => {
            if (!step.success && step.error) {
                if (step.error.response?.status === 402) {
                    criticalErrors.push('Нет активной подписки amoCRM (402 Payment Required)');
                    recommendations.push('Активируйте или продлите подписку amoCRM');
                }
                if (step.error.response?.status === 401) {
                    criticalErrors.push('Невалидный или просроченный Access Token (401 Unauthorized)');
                    recommendations.push('Получите новый токен через OAuth авторизацию');
                }
                if (step.error.response?.status === 403) {
                    criticalErrors.push('Доступ запрещен (403 Forbidden)');
                    recommendations.push('Проверьте права доступа интеграции в amoCRM');
                }
                if (step.error.response?.status === 404) {
                    criticalErrors.push('Ресурс не найден (404 Not Found)');
                    recommendations.push('Проверьте корректность URL и доступность API');
                }
                if (step.error.message.includes('ENOTFOUND') || step.error.message.includes('ECONNREFUSED')) {
                    criticalErrors.push('Не удается подключиться к серверу amoCRM');
                    recommendations.push('Проверьте интернет-соединение и корректность домена');
                }
                if (step.error.message.includes('timeout')) {
                    criticalErrors.push('Таймаут подключения');
                    recommendations.push('Проверьте скорость интернет-соединения');
                }
            }
        });
        
        // Проверяем конфигурацию
        if (!this.clientId) {
            criticalErrors.push('Отсутствует AMOCRM_CLIENT_ID');
            recommendations.push('Установите AMOCRM_CLIENT_ID в .env файл');
        }
        if (!this.clientSecret) {
            criticalErrors.push('Отсутствует AMOCRM_CLIENT_SECRET');
            recommendations.push('Установите AMOCRM_CLIENT_SECRET в .env файл');
        }
        if (!this.accessToken && !this.refreshToken) {
            criticalErrors.push('Отсутствуют токены доступа');
            recommendations.push('Получите токены через OAuth авторизацию');
        }
        if (AMOCRM_DOMAIN.includes('yourcompany')) {
            criticalErrors.push('Некорректный домен amoCRM');
            recommendations.push('Установите правильный AMOCRM_DOMAIN в .env файл');
        }
        
        return {
            successCount,
            errorCount,
            successRate,
            duration,
            criticalErrors: [...new Set(criticalErrors)], // Убираем дубликаты
            recommendations: [...new Set(recommendations)]
        };
    }

    async saveResultsToFile(results) {
        try {
            const resultsDir = path.join(__dirname, 'diagnostic-results');
            await fs.mkdir(resultsDir, { recursive: true });
            
            const fileName = `diagnostic-${Date.now()}.json`;
            const filePath = path.join(resultsDir, fileName);
            
            await fs.writeFile(filePath, JSON.stringify(results, null, 2));
            
            console.log(`\n💾 Результаты сохранены в: ${filePath}`);
            console.log(`📝 Лог процесса: ${this.logFilePath}`);
            
            // Также сохраняем в общий лог
            await fs.appendFile(this.logFilePath, `\nРезультаты сохранены в: ${filePath}\n`);
            
            return filePath;
        } catch (error) {
            console.error('❌ Ошибка сохранения результатов:', error.message);
        }
    }

    async generateReport() {
        const results = await this.fullDiagnostic();
        
        const report = `
=============================================================
📋 ОТЧЕТ О ДИАГНОСТИКЕ AMOCRM
=============================================================
Дата: ${new Date().toLocaleString()}
Аккаунт: ${AMOCRM_DOMAIN}
Статус: ${results.summary.successRate >= 80 ? '✅ ГОТОВ К РАБОТЕ' : '⚠️  ТРЕБУЕТСЯ НАСТРОЙКА'}
Успешных тестов: ${results.summary.successCount}/${results.steps.length}
Процент успеха: ${results.summary.successRate}%
Время выполнения: ${results.summary.duration}ms
=============================================================

⚙️  КОНФИГУРАЦИЯ:
${Object.entries(results.config).map(([key, value]) => `  ${key}: ${value}`).join('\n')}

📊 РЕЗУЛЬТАТЫ ТЕСТОВ:
${results.steps.map(step => `
  ${step.success ? '✅' : '❌'} ${step.step}
  ${step.error ? `    Ошибка: ${step.error.message}` : '    Успешно'}
`).join('')}

${results.summary.criticalErrors.length > 0 ? `
🚨 ПРОБЛЕМЫ:
${results.summary.criticalErrors.map(error => `  • ${error}`).join('\n')}
` : ''}

${results.summary.recommendations.length > 0 ? `
💡 РЕКОМЕНДАЦИИ:
${results.summary.recommendations.map(rec => `  • ${rec}`).join('\n')}
` : ''}

=============================================================
${results.summary.successRate >= 80 ? 
'✅ Система готова к работе с amoCRM!' : 
'⚠️  Требуется дополнительная настройка для работы с amoCRM.'}
=============================================================
        `;
        
        console.log(report);
        
        // Сохраняем отчет в файл
        try {
            const reportDir = path.join(__dirname, 'reports');
            await fs.mkdir(reportDir, { recursive: true });
            
            const reportFile = path.join(reportDir, `amocrm-report-${Date.now()}.txt`);
            await fs.writeFile(reportFile, report);
            
            console.log(`\n📄 Полный отчет сохранен в: ${reportFile}`);
        } catch (error) {
            console.error('❌ Ошибка сохранения отчета:', error.message);
        }
        
        return report;
    }
}

// Создаем экземпляр диагностики
const diagnostic = new AmoCrmDiagnostic();

// ==================== API МАРШРУТЫ ====================

// Главная страница с диагностикой
app.get('/', async (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Диагностика amoCRM</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            }
            
            body {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
            }
            
            .container {
                max-width: 1200px;
                margin: 0 auto;
            }
            
            .header {
                background: white;
                border-radius: 20px;
                padding: 40px;
                margin-bottom: 20px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center;
            }
            
            h1 {
                color: #333;
                margin-bottom: 10px;
                font-size: 36px;
            }
            
            .subtitle {
                color: #666;
                font-size: 18px;
                margin-bottom: 30px;
            }
            
            .config-card {
                background: white;
                border-radius: 15px;
                padding: 30px;
                margin-bottom: 20px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            }
            
            .config-card h2 {
                color: #333;
                margin-bottom: 20px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .config-item {
                display: flex;
                justify-content: space-between;
                padding: 10px 0;
                border-bottom: 1px solid #eee;
            }
            
            .config-item:last-child {
                border-bottom: none;
            }
            
            .config-label {
                color: #555;
                font-weight: 500;
            }
            
            .config-value {
                color: #2196F3;
                font-family: 'Courier New', monospace;
                max-width: 400px;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .config-value.error {
                color: #f44336;
            }
            
            .config-value.success {
                color: #4CAF50;
            }
            
            .actions {
                display: flex;
                gap: 15px;
                margin-top: 30px;
                flex-wrap: wrap;
            }
            
            .btn {
                flex: 1;
                min-width: 200px;
                background: #4CAF50;
                color: white;
                border: none;
                padding: 20px 30px;
                border-radius: 50px;
                font-size: 18px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                text-decoration: none;
            }
            
            .btn:hover {
                background: #45a049;
                transform: translateY(-2px);
                box-shadow: 0 10px 20px rgba(0,0,0,0.2);
            }
            
            .btn-full {
                background: #2196F3;
            }
            
            .btn-full:hover {
                background: #0b7dda;
            }
            
            .btn-oauth {
                background: #FF9800;
            }
            
            .btn-oauth:hover {
                background: #e68900;
            }
            
            .results {
                background: white;
                border-radius: 15px;
                padding: 30px;
                margin-top: 20px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            }
            
            .results.hidden {
                display: none;
            }
            
            .step {
                padding: 15px;
                margin: 10px 0;
                border-radius: 10px;
                border-left: 5px solid #ddd;
            }
            
            .step.success {
                border-left-color: #4CAF50;
                background: #f1f8e9;
            }
            
            .step.error {
                border-left-color: #f44336;
                background: #ffebee;
            }
            
            .step-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }
            
            .step-name {
                font-weight: 500;
                color: #333;
            }
            
            .step-status {
                font-weight: 600;
                padding: 5px 15px;
                border-radius: 20px;
                font-size: 14px;
            }
            
            .status-success {
                background: #4CAF50;
                color: white;
            }
            
            .status-error {
                background: #f44336;
                color: white;
            }
            
            .step-details {
                color: #666;
                font-size: 14px;
                font-family: 'Courier New', monospace;
                background: #f8f9fa;
                padding: 10px;
                border-radius: 5px;
                margin-top: 10px;
                white-space: pre-wrap;
                word-break: break-all;
                max-height: 200px;
                overflow-y: auto;
            }
            
            .summary {
                background: #e8f5e9;
                border-radius: 10px;
                padding: 20px;
                margin-top: 20px;
            }
            
            .summary h3 {
                color: #2e7d32;
                margin-bottom: 15px;
            }
            
            .summary-item {
                display: flex;
                justify-content: space-between;
                margin-bottom: 10px;
                padding-bottom: 10px;
                border-bottom: 1px solid #c8e6c9;
            }
            
            .summary-item:last-child {
                border-bottom: none;
                margin-bottom: 0;
                padding-bottom: 0;
            }
            
            .loading {
                text-align: center;
                padding: 40px;
            }
            
            .spinner {
                border: 5px solid #f3f3f3;
                border-top: 5px solid #3498db;
                border-radius: 50%;
                width: 50px;
                height: 50px;
                animation: spin 1s linear infinite;
                margin: 0 auto 20px;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            @media (max-width: 768px) {
                .container {
                    padding: 10px;
                }
                
                .header, .config-card, .results {
                    padding: 20px;
                }
                
                .btn {
                    min-width: 100%;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔍 Диагностика amoCRM</h1>
                <div class="subtitle">Полная проверка подключения к системе amoCRM</div>
                
                <div class="config-card">
                    <h2>⚙️ Конфигурация</h2>
                    <div class="config-item">
                        <span class="config-label">Домен amoCRM:</span>
                        <span class="config-value ${AMOCRM_DOMAIN && !AMOCRM_DOMAIN.includes('yourcompany') ? 'success' : 'error'}">
                            ${AMOCRM_DOMAIN || 'Не установлен'}
                        </span>
                    </div>
                    <div class="config-item">
                        <span class="config-label">Client ID:</span>
                        <span class="config-value ${AMOCRM_CLIENT_ID ? 'success' : 'error'}">
                            ${AMOCRM_CLIENT_ID ? AMOCRM_CLIENT_ID.substring(0, 8) + '...' : 'Не установлен'}
                        </span>
                    </div>
                    <div class="config-item">
                        <span class="config-label">Client Secret:</span>
                        <span class="config-value ${AMOCRM_CLIENT_SECRET ? 'success' : 'error'}">
                            ${AMOCRM_CLIENT_SECRET ? '***' + AMOCRM_CLIENT_SECRET.substring(AMOCRM_CLIENT_SECRET.length - 4) : 'Не установлен'}
                        </span>
                    </div>
                    <div class="config-item">
                        <span class="config-label">Access Token:</span>
                        <span class="config-value ${AMOCRM_ACCESS_TOKEN ? 'success' : 'error'}">
                            ${AMOCRM_ACCESS_TOKEN ? AMOCRM_ACCESS_TOKEN.substring(0, 30) + '...' : 'Не установлен'}
                        </span>
                    </div>
                    <div class="config-item">
                        <span class="config-label">Redirect URI:</span>
                        <span class="config-value">${AMOCRM_REDIRECT_URI}</span>
                    </div>
                </div>
                
                <div class="actions">
                    <button class="btn" onclick="runFullDiagnostic()">
                        🚀 Запустить полную диагностику
                    </button>
                    <button class="btn btn-full" onclick="runQuickTest()">
                        ⚡ Быстрый тест
                    </button>
                    ${AMOCRM_CLIENT_ID ? `
                        <a href="${DOMAIN}/oauth/link" class="btn btn-oauth">
                            🔗 OAuth авторизация
                        </a>
                    ` : ''}
                </div>
            </div>
            
            <div id="results" class="results hidden">
                <div id="loading" class="loading">
                    <div class="spinner"></div>
                    <h3>Выполняется диагностика...</h3>
                    <p>Пожалуйста, подождите. Это может занять несколько минут.</p>
                </div>
                <div id="results-content" style="display: none;"></div>
            </div>
        </div>
        
        <script>
            function showLoading() {
                document.getElementById('results').classList.remove('hidden');
                document.getElementById('loading').style.display = 'block';
                document.getElementById('results-content').style.display = 'none';
            }
            
            function showResults(html) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('results-content').innerHTML = html;
                document.getElementById('results-content').style.display = 'block';
            }
            
            async function runFullDiagnostic() {
                showLoading();
                
                try {
                    const response = await fetch('/api/diagnostic/full', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    const results = await response.json();
                    displayResults(results);
                } catch (error) {
                    showResults('<div class="step error"><div class="step-header"><span class="step-name">Ошибка выполнения диагностики</span><span class="step-status status-error">Ошибка</span></div><div class="step-details">' + error.message + '</div></div>');
                }
            }
            
            async function runQuickTest() {
                showLoading();
                
                try {
                    const response = await fetch('/api/diagnostic/quick', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    const results = await response.json();
                    displayResults(results);
                } catch (error) {
                    showResults('<div class="step error"><div class="step-header"><span class="step-name">Ошибка выполнения теста</span><span class="step-status status-error">Ошибка</span></div><div class="step-details">' + error.message + '</div></div>');
                }
            }
            
            function displayResults(results) {
                let html = '<h2>📊 Результаты диагностики</h2>';
                
                if (results.summary) {
                    html += \`
                        <div class="summary">
                            <h3>Итоги</h3>
                            <div class="summary-item">
                                <span>Успешных тестов:</span>
                                <span><strong>\${results.summary.successCount}/\${results.steps.length}</strong></span>
                            </div>
                            <div class="summary-item">
                                <span>Процент успеха:</span>
                                <span><strong>\${results.summary.successRate}%</strong></span>
                            </div>
                            <div class="summary-item">
                                <span>Время выполнения:</span>
                                <span><strong>\${results.summary.duration}ms</strong></span>
                            </div>
                        </div>
                    \`;
                }
                
                if (results.steps && results.steps.length > 0) {
                    results.steps.forEach(step => {
                        html += \`
                            <div class="step \${step.success ? 'success' : 'error'}">
                                <div class="step-header">
                                    <span class="step-name">\${step.step}</span>
                                    <span class="step-status \${step.success ? 'status-success' : 'status-error'}">
                                        \${step.success ? 'Успех' : 'Ошибка'}
                                    </span>
                                </div>
                                \${step.error ? \`
                                    <div class="step-details">
                                        Сообщение: \${step.error.message}<br>
                                        \${step.error.response ? \`
                                            Статус: \${step.error.response.status} \${step.error.response.statusText}<br>
                                            \${step.error.response.data ? 'Данные: ' + JSON.stringify(step.error.response.data, null, 2) : ''}
                                        \` : ''}
                                    </div>
                                \` : \`
                                    <div class="step-details">
                                        Время: \${new Date(step.timestamp).toLocaleString()}<br>
                                        \${step.data ? 'Данные получены успешно' : ''}
                                    </div>
                                \`}
                            </div>
                        \`;
                    });
                }
                
                if (results.summary?.criticalErrors?.length > 0) {
                    html += \`
                        <div class="step error">
                            <div class="step-header">
                                <span class="step-name">Критические ошибки</span>
                                <span class="step-status status-error">Ошибка</span>
                            </div>
                            <div class="step-details">
                                \${results.summary.criticalErrors.map(error => '• ' + error).join('<br>')}
                            </div>
                        </div>
                    \`;
                }
                
                if (results.summary?.recommendations?.length > 0) {
                    html += \`
                        <div class="step success">
                            <div class="step-header">
                                <span class="step-name">Рекомендации</span>
                                <span class="step-status status-success">Совет</span>
                            </div>
                            <div class="step-details">
                                \${results.summary.recommendations.map(rec => '• ' + rec).join('<br>')}
                            </div>
                        </div>
                    \`;
                }
                
                // Добавляем ссылки на файлы
                if (results.logFile) {
                    html += \`
                        <div class="step success">
                            <div class="step-header">
                                <span class="step-name">Файлы диагностики</span>
                                <span class="step-status status-success">Файлы</span>
                            </div>
                            <div class="step-details">
                                • Лог файл: <a href="/api/diagnostic/log" target="_blank">\${results.logFile}</a><br>
                                \${results.reportFile ? '• Отчет: <a href="/api/diagnostic/report" target="_blank">' + results.reportFile + '</a>' : ''}
                            </div>
                        </div>
                    \`;
                }
                
                showResults(html);
                
                // Прокручиваем к результатам
                document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
            }
            
            // Проверяем конфигурацию при загрузке
            window.onload = function() {
                if (!${AMOCRM_CLIENT_ID ? 'true' : 'false'}) {
                    alert('⚠️ Внимание: AMOCRM_CLIENT_ID не установлен в .env файле!');
                }
                if (!${AMOCRM_CLIENT_SECRET ? 'true' : 'false'}) {
                    alert('⚠️ Внимание: AMOCRM_CLIENT_SECRET не установлен в .env файле!');
                }
                if (${AMOCRM_DOMAIN ? `'${AMOCRM_DOMAIN}'.includes('yourcompany')` : 'true'}) {
                    alert('⚠️ Внимание: AMOCRM_DOMAIN некорректен или содержит "yourcompany"!');
                }
            };
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

// Полная диагностика
app.post('/api/diagnostic/full', async (req, res) => {
    try {
        console.log('\n' + '='.repeat(100));
        console.log('🚀 ЗАПУСК ПОЛНОЙ ДИАГНОСТИКИ ПО ЗАПРОСУ');
        console.log('='.repeat(100));
        
        const results = await diagnostic.fullDiagnostic();
        
        // Получаем пути к файлам
        const logFile = diagnostic.logFilePath;
        let reportFile = null;
        
        try {
            const reportsDir = path.join(__dirname, 'reports');
            const reportFiles = await fs.readdir(reportsDir);
            if (reportFiles.length > 0) {
                reportFile = reportFiles.sort().reverse()[0];
                reportFile = path.join('reports', reportFile);
            }
        } catch (error) {
            // Игнорируем ошибки при поиске файлов
        }
        
        res.json({
            ...results,
            logFile: path.basename(logFile),
            reportFile: reportFile
        });
        
    } catch (error) {
        console.error('❌ Ошибка выполнения диагностики:', error);
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
});

// Быстрый тест
app.post('/api/diagnostic/quick', async (req, res) => {
    try {
        console.log('\n⚡ ЗАПУСК БЫСТРОГО ТЕСТА');
        
        const quickDiagnostic = new AmoCrmDiagnostic();
        const steps = [];
        
        // Только основные тесты
        steps.push(await quickDiagnostic.testStep('Проверка доступности домена', async () => {
            return await quickDiagnostic.makeRequest('GET', quickDiagnostic.baseUrl);
        }));
        
        if (quickDiagnostic.accessToken) {
            steps.push(await quickDiagnostic.testStep('Проверка Access Token', async () => {
                return await quickDiagnostic.makeRequest('GET', `${quickDiagnostic.baseUrl}/api/v4/account`, null, {
                    'Authorization': `Bearer ${quickDiagnostic.accessToken}`
                });
            }));
        }
        
        if (quickDiagnostic.clientId && quickDiagnostic.clientSecret) {
            steps.push(await quickDiagnostic.testStep('Проверка OAuth конфигурации', async () => {
                return await quickDiagnostic.makeRequest('GET', `${quickDiagnostic.oauthUrl}/oauth`);
            }));
        }
        
        const summary = quickDiagnostic.generateSummary(steps);
        
        res.json({
            steps,
            summary,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Ошибка быстрого теста:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получение лог файла
app.get('/api/diagnostic/log', async (req, res) => {
    try {
        if (diagnostic.logFilePath && await fs.access(diagnostic.logFilePath).then(() => true).catch(() => false)) {
            const logContent = await fs.readFile(diagnostic.logFilePath, 'utf-8');
            res.set('Content-Type', 'text/plain');
            res.send(logContent);
        } else {
            res.status(404).json({ error: 'Лог файл не найден' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получение отчета
app.get('/api/diagnostic/report', async (req, res) => {
    try {
        const reportsDir = path.join(__dirname, 'reports');
        const reportFiles = await fs.readdir(reportsDir);
        
        if (reportFiles.length > 0) {
            const latestReport = reportFiles.sort().reverse()[0];
            const reportPath = path.join(reportsDir, latestReport);
            const reportContent = await fs.readFile(reportPath, 'utf-8');
            
            res.set('Content-Type', 'text/plain');
            res.send(reportContent);
        } else {
            res.status(404).json({ error: 'Отчет не найден' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// OAuth авторизация
app.get('/oauth/link', (req, res) => {
    if (!AMOCRM_CLIENT_ID) {
        return res.status(400).json({ error: 'AMOCRM_CLIENT_ID не установлен' });
    }
    
    const authUrl = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru/oauth?client_id=${AMOCRM_CLIENT_ID}&mode=post_message`;
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>OAuth авторизация amoCRM</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 50px; text-align: center; }
            .container { max-width: 600px; margin: 0 auto; }
            .btn { 
                display: inline-block; 
                background: #2196F3; 
                color: white; 
                padding: 20px 40px; 
                border-radius: 50px; 
                text-decoration: none; 
                font-size: 18px; 
                font-weight: bold;
                margin: 20px 0;
                transition: all 0.3s ease;
            }
            .btn:hover { 
                background: #0b7dda; 
                transform: translateY(-2px);
                box-shadow: 0 10px 20px rgba(0,0,0,0.2);
            }
            .instructions { 
                background: #f8f9fa; 
                padding: 20px; 
                border-radius: 10px; 
                margin: 30px 0; 
                text-align: left;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🔗 OAuth авторизация amoCRM</h1>
            <p>Для получения доступа к amoCRM необходимо пройти авторизацию</p>
            
            <a href="${authUrl}" class="btn" target="_blank">
                🔐 Авторизоваться в amoCRM
            </a>
            
            <div class="instructions">
                <h3>📋 Инструкция:</h3>
                <ol>
                    <li>Нажмите кнопку "Авторизоваться в amoCRM"</li>
                    <li>Войдите в свой аккаунт amoCRM если потребуется</li>
                    <li>Разрешите доступ приложению к вашему аккаунту</li>
                    <li>После успешной авторизации вы получите код</li>
                    <li>Используйте этот код для получения токенов</li>
                </ol>
                
                <p><strong>Redirect URI:</strong> ${AMOCRM_REDIRECT_URI}</p>
                <p><strong>Client ID:</strong> ${AMOCRM_CLIENT_ID}</p>
            </div>
            
            <p><a href="/">← Вернуться к диагностике</a></p>
        </div>
    </body>
    </html>
    `;
    
    res.send(html);
});

// OAuth callback
app.get('/oauth/callback', async (req, res) => {
    const { code, error, error_description } = req.query;
    
    console.log('\n' + '='.repeat(100));
    console.log('🔄 OAuth CALLBACK ОБРАБОТКА');
    console.log('='.repeat(100));
    console.log('Code:', code ? code.substring(0, 20) + '...' : 'нет');
    console.log('Error:', error);
    console.log('Error description:', error_description);
    
    if (error) {
        const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Ошибка авторизации</title></head>
        <body>
            <h1>❌ Ошибка авторизации</h1>
            <p><strong>Код ошибки:</strong> ${error}</p>
            <p><strong>Описание:</strong> ${error_description || 'Нет описания'}</p>
            <p><a href="/oauth/link">Попробовать снова</a> | <a href="/">Вернуться к диагностике</a></p>
        </body>
        </html>
        `;
        return res.send(html);
    }
    
    if (!code) {
        const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Ошибка - нет кода</title></head>
        <body>
            <h1>❌ Код авторизации не получен</h1>
            <p>Попробуйте авторизоваться снова</p>
            <p><a href="/oauth/link">Попробовать снова</a> | <a href="/">Вернуться к диагностике</a></p>
        </body>
        </html>
        `;
        return res.send(html);
    }
    
    try {
        // Пробуем получить токен
        const tokenData = {
            client_id: AMOCRM_CLIENT_ID,
            client_secret: AMOCRM_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: AMOCRM_REDIRECT_URI
        };
        
        console.log('📦 Получение токена по коду...');
        console.log('Data:', {
            client_id: AMOCRM_CLIENT_ID?.substring(0, 8) + '...',
            client_secret: '***' + AMOCRM_CLIENT_SECRET?.substring(AMOCRM_CLIENT_SECRET.length - 4),
            grant_type: 'authorization_code',
            code_length: code.length,
            redirect_uri: AMOCRM_REDIRECT_URI
        });
        
        const response = await axios.post(
            `https://${AMOCRM_SUBDOMAIN}.amocrm.ru/oauth2/access_token`,
            tokenData,
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            }
        );
        
        const { access_token, refresh_token, expires_in } = response.data;
        
        console.log('✅ Токен получен успешно!');
        console.log('Access Token:', access_token.substring(0, 30) + '...');
        console.log('Refresh Token:', refresh_token.substring(0, 30) + '...');
        console.log('Expires in:', expires_in, 'секунд');
        
        // Сохраняем в лог
        await diagnostic.logToFile(`Получен новый токен: ${access_token.substring(0, 20)}...`);
        
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Успешная авторизация</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 50px; text-align: center; }
                .success { color: #4CAF50; font-size: 24px; margin: 20px 0; }
                .token-info { 
                    background: #f8f9fa; 
                    padding: 20px; 
                    border-radius: 10px; 
                    margin: 20px 0; 
                    text-align: left;
                    font-family: monospace;
                    word-break: break-all;
                }
                .instructions { 
                    background: #e8f5e9; 
                    padding: 20px; 
                    border-radius: 10px; 
                    margin: 20px 0;
                }
            </style>
        </head>
        <body>
            <h1>✅ Авторизация успешна!</h1>
            <div class="success">Токены получены и сохранены</div>
            
            <div class="instructions">
                <h3>📋 Информация о токенах:</h3>
                <p><strong>Access Token:</strong> ${access_token.substring(0, 50)}...</p>
                <p><strong>Refresh Token:</strong> ${refresh_token.substring(0, 50)}...</p>
                <p><strong>Действует:</strong> ${Math.floor(expires_in / 3600)} часов</p>
            </div>
            
            <div class="instructions">
                <h3>💡 Что делать дальше:</h3>
                <ol>
                    <li>Скопируйте полученные токены в .env файл</li>
                    <li>Перезапустите сервер</li>
                    <li>Проверьте подключение через диагностику</li>
                </ol>
                
                <h4>Для .env файла:</h4>
                <div class="token-info">
AMOCRM_ACCESS_TOKEN=${access_token}<br>
AMOCRM_REFRESH_TOKEN=${refresh_token}
                </div>
            </div>
            
            <p>
                <a href="/api/diagnostic/full" target="_blank" style="background: #4CAF50; color: white; padding: 15px 30px; border-radius: 50px; text-decoration: none; font-weight: bold;">
                    🚀 Проверить подключение
                </a>
            </p>
            
            <p><a href="/">← Вернуться к диагностике</a></p>
        </body>
        </html>
        `;
        
        res.send(html);
        
    } catch (error) {
        console.error('❌ Ошибка получения токена:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
        
        const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Ошибка получения токена</title></head>
        <body>
            <h1>❌ Ошибка получения токена</h1>
            <p><strong>Сообщение:</strong> ${error.message}</p>
            ${error.response ? `
                <p><strong>Статус:</strong> ${error.response.status}</p>
                <p><strong>Ответ сервера:</strong></p>
                <pre>${JSON.stringify(error.response.data, null, 2)}</pre>
            ` : ''}
            <p><a href="/oauth/link">Попробовать снова</a> | <a href="/">Вернуться к диагностике</a></p>
        </body>
        </html>
        `;
        
        res.send(html);
    }
});

// Статус системы
app.get('/api/status', (req, res) => {
    const status = {
        server: 'running',
        timestamp: new Date().toISOString(),
        amocrm: {
            domain: AMOCRM_DOMAIN,
            clientId: !!AMOCRM_CLIENT_ID,
            clientSecret: !!AMOCRM_CLIENT_SECRET,
            accessToken: !!AMOCRM_ACCESS_TOKEN,
            redirectUri: AMOCRM_REDIRECT_URI
        },
        diagnostic: {
            logFile: diagnostic.logFilePath ? path.basename(diagnostic.logFilePath) : null,
            endpoints: {
                fullDiagnostic: 'POST /api/diagnostic/full',
                quickTest: 'POST /api/diagnostic/quick',
                oauthLink: 'GET /oauth/link',
                status: 'GET /api/status'
            }
        }
    };
    
    res.json(status);
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(100));
        console.log('🚀 ЗАПУСК СЕРВЕРА ДИАГНОСТИКИ AMOCRM');
        console.log('='.repeat(100));
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, () => {
            console.log(`\n✅ СЕРВЕР ЗАПУЩЕН НА ПОРТУ ${PORT}`);
            console.log('='.repeat(50));
            console.log(`🌐 Веб-интерфейс: http://localhost:${PORT}`);
            console.log(`📊 API статус: http://localhost:${PORT}/api/status`);
            console.log(`🔗 OAuth: http://localhost:${PORT}/oauth/link`);
            console.log('='.repeat(50));
            console.log('\n🔍 ДЛЯ НАЧАЛА ДИАГНОСТИКИ:');
            console.log('1. Откройте http://localhost:3000 в браузере');
            console.log('2. Проверьте конфигурацию amoCRM');
            console.log('3. Запустите полную диагностику');
            console.log('4. Следуйте рекомендациям по исправлению ошибок');
            console.log('='.repeat(50));
        });
        
    } catch (error) {
        console.error('❌ Ошибка запуска сервера:', error.message);
        process.exit(1);
    }
};

// Обработка завершения
process.on('SIGINT', () => {
    console.log('\n🔄 Остановка сервера диагностики...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🔄 Получен SIGTERM, остановка...');
    process.exit(0);
});

// Запуск сервера
startServer();
