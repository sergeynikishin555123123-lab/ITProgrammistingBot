// diagnostic-server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== КОНФИГУРАЦИЯ ====================
console.log('\n' + '='.repeat(80));
console.log('🔍 ЗАПУСК ДИАГНОСТИКИ AMOCRM');
console.log('='.repeat(80));

// Проверяем переменные окружения
const ENV_VARS = {
    'AMOCRM_DOMAIN': process.env.AMOCRM_DOMAIN,
    'AMOCRM_CLIENT_ID': process.env.AMOCRM_CLIENT_ID,
    'AMOCRM_CLIENT_SECRET': process.env.AMOCRM_CLIENT_SECRET,
    'AMOCRM_ACCESS_TOKEN': process.env.AMOCRM_ACCESS_TOKEN,
    'AMOCRM_REFRESH_TOKEN': process.env.AMOCRM_REFRESH_TOKEN,
    'AMOCRM_REDIRECT_URI': process.env.AMOCRM_REDIRECT_URI
};

console.log('\n📋 ПРОВЕРКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ:');
console.log('='.repeat(50));

let hasCriticalErrors = false;
for (const [key, value] of Object.entries(ENV_VARS)) {
    const status = value ? '✅' : '❌';
    const displayValue = value ? 
        (key.includes('TOKEN') || key.includes('SECRET') ? 
            value.substring(0, 20) + '...' : 
            value) : 
        'НЕ УСТАНОВЛЕНО';
    
    console.log(`${status} ${key}: ${displayValue}`);
    
    if (!value && key !== 'AMOCRM_REFRESH_TOKEN') {
        if (key === 'AMOCRM_DOMAIN') {
            console.log('   ⚠️  Исправьте: AMOCRM_DOMAIN=pismovbanu.amocrm.ru');
        } else if (key === 'AMOCRM_CLIENT_ID') {
            console.log('   ⚠️  Исправьте: AMOCRM_CLIENT_ID=bb629052-604f-449a-80bd-8f6333645879');
        }
        hasCriticalErrors = true;
    }
}

// Проверка конкретных ошибок
if (ENV_VARS.AMOCRM_DOMAIN === 'yourcompany.amocrm.ru') {
    console.log('\n🚨 КРИТИЧЕСКАЯ ОШИБКА:');
    console.log('   AMOCRM_DOMAIN установлен как "yourcompany.amocrm.ru"');
    console.log('   Исправьте на: AMOCRM_DOMAIN=pismovbanu.amocrm.ru');
    hasCriticalErrors = true;
}

if (ENV_VARS.AMOCRM_ACCESS_TOKEN === 'initial_access_token') {
    console.log('\n🚨 КРИТИЧЕСКАЯ ОШИБКА:');
    console.log('   AMOCRM_ACCESS_TOKEN содержит демо-значение');
    console.log('   Получите реальный токен через OAuth');
    hasCriticalErrors = true;
}

console.log('='.repeat(50));

// ==================== MIDDLEWARE ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Логирование запросов
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`\n📥 ${timestamp} ${req.method} ${req.url}`);
    if (Object.keys(req.body).length > 0) {
        console.log('   Body:', JSON.stringify(req.body).substring(0, 200));
    }
    next();
});

// ==================== ФУНКЦИИ ДИАГНОСТИКИ ====================
async function testUrlAccessibility(url) {
    try {
        console.log(`\n🌐 Тест доступности: ${url}`);
        const response = await axios.get(url, { timeout: 10000 });
        return {
            success: true,
            status: response.status,
            statusText: response.statusText,
            data: response.data ? 'Данные получены' : 'Нет данных'
        };
    } catch (error) {
        return {
            success: false,
            status: error.response?.status,
            statusText: error.response?.statusText || error.code,
            message: error.message
        };
    }
}

async function testApiEndpoint(baseUrl, endpoint, accessToken = null) {
    const url = `${baseUrl}${endpoint}`;
    try {
        console.log(`\n🔧 Тест API: ${url}`);
        
        const headers = {};
        if (accessToken) {
            headers['Authorization'] = `Bearer ${accessToken}`;
        }
        
        const response = await axios.get(url, { 
            headers,
            timeout: 15000,
            validateStatus: () => true // Принимаем все статусы для диагностики
        });
        
        return {
            success: response.status >= 200 && response.status < 300,
            status: response.status,
            statusText: response.statusText,
            data: response.data ? 
                (typeof response.data === 'object' ? 
                    Object.keys(response.data).join(', ') : 
                    'Данные получены') : 
                'Нет данных',
            fullData: response.data
        };
    } catch (error) {
        return {
            success: false,
            status: error.response?.status || 0,
            statusText: error.response?.statusText || error.code,
            message: error.message,
            details: error.response?.data
        };
    }
}

async function testOauthToken(clientId, clientSecret, refreshToken, redirectUri) {
    try {
        console.log('\n🔐 Тест OAuth токена...');
        
        const oauthUrl = 'https://pismovbanu.amocrm.ru/oauth2/access_token';
        const data = {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            redirect_uri: redirectUri
        };
        
        const response = await axios.post(oauthUrl, data, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000
        });
        
        return {
            success: true,
            access_token: response.data.access_token,
            refresh_token: response.data.refresh_token,
            expires_in: response.data.expires_in
        };
    } catch (error) {
        return {
            success: false,
            status: error.response?.status,
            message: error.message,
            details: error.response?.data
        };
    }
}

// ==================== МАРШРУТЫ ДИАГНОСТИКИ ====================

// Главная страница диагностики
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Диагностика amoCRM</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-family: Arial, sans-serif; }
            body { background: #f0f2f5; padding: 20px; }
            .container { max-width: 1000px; margin: 0 auto; }
            .header { background: white; padding: 30px; border-radius: 10px; margin-bottom: 20px; }
            h1 { color: #333; margin-bottom: 10px; }
            .env-status { background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
            .env-item { padding: 10px 0; border-bottom: 1px solid #eee; display: flex; }
            .env-label { flex: 1; color: #555; }
            .env-value { flex: 2; font-family: monospace; }
            .success { color: #4CAF50; }
            .error { color: #f44336; }
            .warning { color: #FF9800; }
            .actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
            .btn { 
                background: #2196F3; 
                color: white; 
                border: none; 
                padding: 15px 25px; 
                border-radius: 5px; 
                cursor: pointer; 
                text-decoration: none;
                display: inline-block;
            }
            .btn:hover { background: #0b7dda; }
            .btn-danger { background: #f44336; }
            .btn-danger:hover { background: #d32f2f; }
            .btn-success { background: #4CAF50; }
            .btn-success:hover { background: #388e3c; }
            .results { background: white; padding: 20px; border-radius: 10px; margin-top: 20px; }
            .test-result { padding: 15px; margin: 10px 0; border-left: 5px solid #ddd; }
            .test-result.success { border-left-color: #4CAF50; background: #f1f8e9; }
            .test-result.error { border-left-color: #f44336; background: #ffebee; }
            .test-name { font-weight: bold; }
            .test-details { margin-top: 10px; color: #666; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🔍 Диагностика подключения к amoCRM</h1>
                <p>Проверка корректности настроек и подключения</p>
                
                <div class="env-status">
                    <h3>⚙️ Конфигурация</h3>
                    ${Object.entries(ENV_VARS).map(([key, value]) => {
                        const status = value ? 'success' : 'error';
                        const displayValue = value ? 
                            (key.includes('TOKEN') || key.includes('SECRET') ? 
                                '••••••' + value.substring(value.length - 4) : 
                                value) : 
                            'Не установлено';
                        return `
                            <div class="env-item">
                                <span class="env-label">${key}:</span>
                                <span class="env-value ${status}">${displayValue}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
                
                <div class="actions">
                    <button class="btn" onclick="runTest('quick')">⚡ Быстрая проверка</button>
                    <button class="btn" onclick="runTest('full')">🔍 Полная диагностика</button>
                    <button class="btn btn-success" onclick="runTest('oauth')">🔐 Проверка OAuth</button>
                    ${ENV_VARS.AMOCRM_CLIENT_ID ? `
                        <a href="/oauth" class="btn">🔗 OAuth авторизация</a>
                    ` : ''}
                </div>
            </div>
            
            <div id="results" class="results" style="display: none;">
                <h3>📊 Результаты диагностики</h3>
                <div id="loading">Выполнение диагностики...</div>
                <div id="test-results"></div>
            </div>
        </div>
        
        <script>
            async function runTest(type) {
                document.getElementById('results').style.display = 'block';
                document.getElementById('loading').innerHTML = 'Выполнение диагностики...';
                document.getElementById('test-results').innerHTML = '';
                
                try {
                    const response = await fetch('/api/diagnostic/' + type, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    const results = await response.json();
                    displayResults(results);
                } catch (error) {
                    document.getElementById('test-results').innerHTML = \`
                        <div class="test-result error">
                            <div class="test-name">Ошибка выполнения диагностики</div>
                            <div class="test-details">\${error.message}</div>
                        </div>
                    \`;
                }
            }
            
            function displayResults(results) {
                document.getElementById('loading').innerHTML = '';
                
                if (!results.tests || results.tests.length === 0) {
                    document.getElementById('test-results').innerHTML = 'Нет результатов тестирования';
                    return;
                }
                
                let html = '';
                
                // Показываем итоги
                if (results.summary) {
                    html += \`
                        <div style="background: #e3f2fd; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                            <strong>Итоги:</strong> 
                            Успешно: \${results.summary.success}, 
                            Ошибок: \${results.summary.errors}, 
                            Всего: \${results.summary.total}
                        </div>
                    \`;
                }
                
                // Показываем каждый тест
                results.tests.forEach(test => {
                    html += \`
                        <div class="test-result \${test.success ? 'success' : 'error'}">
                            <div class="test-name">\${test.name}</div>
                            <div class="test-details">
                                Статус: \${test.success ? '✅ Успех' : '❌ Ошибка'}<br>
                                \${test.details ? 'Детали: ' + test.details + '<br>' : ''}
                                \${test.error ? 'Ошибка: ' + test.error : ''}
                            </div>
                        </div>
                    \`;
                });
                
                document.getElementById('test-results').innerHTML = html;
            }
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

// Быстрая проверка
app.post('/api/diagnostic/quick', async (req, res) => {
    console.log('\n⚡ ЗАПУСК БЫСТРОЙ ПРОВЕРКИ');
    
    const tests = [];
    
    // Тест 1: Проверка домена
    const domain = ENV_VARS.AMOCRM_DOMAIN;
    if (domain && domain !== 'yourcompany.amocrm.ru') {
        const baseUrl = `https://${domain}`;
        const test1 = await testUrlAccessibility(baseUrl);
        tests.push({
            name: 'Доступность домена amoCRM',
            success: test1.success,
            details: `Статус: ${test1.status || 'N/A'}, ${test1.statusText || 'Нет ответа'}`,
            error: test1.success ? null : test1.message
        });
    } else {
        tests.push({
            name: 'Доступность домена amoCRM',
            success: false,
            details: 'Домен не указан или указан некорректно',
            error: `Используется: "${domain}"`
        });
    }
    
    // Тест 2: Проверка API
    if (domain && domain !== 'yourcompany.amocrm.ru') {
        const baseUrl = `https://${domain}`;
        const test2 = await testApiEndpoint(baseUrl, '/api/v4');
        tests.push({
            name: 'Доступность API v4',
            success: test2.success,
            details: `Статус: ${test2.status}, ${test2.statusText}`,
            error: test2.success ? null : test2.message
        });
    }
    
    // Тест 3: Проверка Access Token
    if (ENV_VARS.AMOCRM_ACCESS_TOKEN && ENV_VARS.AMOCRM_ACCESS_TOKEN !== 'initial_access_token') {
        const baseUrl = `https://${domain}`;
        const test3 = await testApiEndpoint(baseUrl, '/api/v4/account', ENV_VARS.AMOCRM_ACCESS_TOKEN);
        
        if (test3.status === 402) {
            tests.push({
                name: 'Проверка Access Token',
                success: false,
                details: 'Статус: 402 Payment Required',
                error: 'Нет активной подписки amoCRM. Требуется активировать или продлить подписку.'
            });
        } else {
            tests.push({
                name: 'Проверка Access Token',
                success: test3.success,
                details: `Статус: ${test3.status}, ${test3.statusText}`,
                error: test3.success ? null : test3.message
            });
        }
    } else {
        tests.push({
            name: 'Проверка Access Token',
            success: false,
            details: 'Токен не указан или указан некорректно',
            error: 'Используйте OAuth для получения токена'
        });
    }
    
    // Тест 4: Проверка OAuth конфигурации
    if (ENV_VARS.AMOCRM_CLIENT_ID && ENV_VARS.AMOCRM_CLIENT_SECRET) {
        tests.push({
            name: 'Конфигурация OAuth',
            success: true,
            details: 'Client ID и Client Secret установлены'
        });
    } else {
        tests.push({
            name: 'Конфигурация OAuth',
            success: false,
            details: 'Отсутствуют учетные данные OAuth',
            error: 'Установите AMOCRM_CLIENT_ID и AMOCRM_CLIENT_SECRET'
        });
    }
    
    const summary = {
        success: tests.filter(t => t.success).length,
        errors: tests.filter(t => !t.success).length,
        total: tests.length
    };
    
    console.log(`\n📊 ИТОГИ БЫСТРОЙ ПРОВЕРКИ:`);
    console.log(`   ✅ Успешно: ${summary.success}`);
    console.log(`   ❌ Ошибок: ${summary.errors}`);
    console.log(`   📈 Всего: ${summary.total}`);
    
    res.json({ tests, summary });
});

// Полная диагностика
app.post('/api/diagnostic/full', async (req, res) => {
    console.log('\n🔍 ЗАПУСК ПОЛНОЙ ДИАГНОСТИКИ');
    
    const tests = [];
    const domain = ENV_VARS.AMOCRM_DOMAIN;
    
    if (!domain || domain === 'yourcompany.amocrm.ru') {
        tests.push({
            name: 'Проверка домена',
            success: false,
            details: 'Домен не указан или указан некорректно',
            error: `Используется: "${domain}". Исправьте на: pismovbanu.amocrm.ru`
        });
        
        return res.json({ 
            tests, 
            summary: { success: 0, errors: tests.length, total: tests.length },
            recommendation: 'Исправьте AMOCRM_DOMAIN в .env файле'
        });
    }
    
    const baseUrl = `https://${domain}`;
    
    // 1. Проверка доступности домена
    const test1 = await testUrlAccessibility(baseUrl);
    tests.push({
        name: 'Доступность домена',
        success: test1.success,
        details: `URL: ${baseUrl}, Статус: ${test1.status || 'N/A'}`,
        error: test1.success ? null : test1.message
    });
    
    // 2. Проверка OAuth эндпоинта
    const oauthUrl = `${baseUrl}/oauth`;
    const test2 = await testUrlAccessibility(oauthUrl);
    tests.push({
        name: 'Доступность OAuth',
        success: test2.success,
        details: `URL: ${oauthUrl}, Статус: ${test2.status || 'N/A'}`,
        error: test2.success ? null : test2.message
    });
    
    // 3. Проверка API v4
    const test3 = await testApiEndpoint(baseUrl, '/api/v4');
    tests.push({
        name: 'Доступность API v4',
        success: test3.success,
        details: `Статус: ${test3.status}, ${test3.statusText}`,
        error: test3.success ? null : test3.message
    });
    
    // 4. Проверка Access Token (если есть)
    if (ENV_VARS.AMOCRM_ACCESS_TOKEN && ENV_VARS.AMOCRM_ACCESS_TOKEN !== 'initial_access_token') {
        const test4 = await testApiEndpoint(baseUrl, '/api/v4/account', ENV_VARS.AMOCRM_ACCESS_TOKEN);
        
        if (test4.status === 402) {
            tests.push({
                name: 'Проверка Access Token',
                success: false,
                details: 'Статус: 402 Payment Required',
                error: 'КРИТИЧЕСКАЯ ОШИБКА: Нет активной подписки amoCRM. Требуется активировать или продлить подписку.'
            });
        } else if (test4.status === 401) {
            tests.push({
                name: 'Проверка Access Token',
                success: false,
                details: 'Статус: 401 Unauthorized',
                error: 'Access Token невалиден или истек. Получите новый токен через OAuth.'
            });
        } else {
            tests.push({
                name: 'Проверка Access Token',
                success: test4.success,
                details: `Статус: ${test4.status}, ${test4.statusText}`,
                error: test4.success ? null : test4.message,
                accountInfo: test4.fullData
            });
        }
    } else {
        tests.push({
            name: 'Проверка Access Token',
            success: false,
            details: 'Токен не указан или указан некорректно',
            error: 'Получите токен через OAuth авторизацию'
        });
    }
    
    // 5. Проверка Refresh Token (если есть)
    if (ENV_VARS.AMOCRM_REFRESH_TOKEN && ENV_VARS.AMOCRM_REFRESH_TOKEN !== 'initial_refresh_token' &&
        ENV_VARS.AMOCRM_CLIENT_ID && ENV_VARS.AMOCRM_CLIENT_SECRET) {
        
        const test5 = await testOauthToken(
            ENV_VARS.AMOCRM_CLIENT_ID,
            ENV_VARS.AMOCRM_CLIENT_SECRET,
            ENV_VARS.AMOCRM_REFRESH_TOKEN,
            ENV_VARS.AMOCRM_REDIRECT_URI
        );
        
        tests.push({
            name: 'Проверка Refresh Token',
            success: test5.success,
            details: test5.success ? 
                `Новый токен получен, истекает через: ${Math.floor(test5.expires_in / 3600)} часов` : 
                `Статус: ${test5.status || 'Ошибка'}`,
            error: test5.success ? null : test5.message
        });
    }
    
    // 6. Проверка OAuth авторизации
    if (ENV_VARS.AMOCRM_CLIENT_ID) {
        const authUrl = `${baseUrl}/oauth?client_id=${ENV_VARS.AMOCRM_CLIENT_ID}&mode=post_message`;
        tests.push({
            name: 'Конфигурация OAuth авторизации',
            success: true,
            details: `Client ID: ${ENV_VARS.AMOCRM_CLIENT_ID.substring(0, 8)}...`,
            authUrl: authUrl
        });
    }
    
    const summary = {
        success: tests.filter(t => t.success).length,
        errors: tests.filter(t => !t.success).length,
        total: tests.length
    };
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 ИТОГИ ПОЛНОЙ ДИАГНОСТИКИ:');
    console.log(`   ✅ Успешно: ${summary.success}`);
    console.log(`   ❌ Ошибок: ${summary.errors}`);
    console.log(`   📈 Всего: ${summary.total}`);
    console.log('='.repeat(80));
    
    // Анализ результатов
    const criticalErrors = tests.filter(t => !t.success && t.error?.includes('КРИТИЧЕСКАЯ'));
    if (criticalErrors.length > 0) {
        console.log('\n🚨 КРИТИЧЕСКИЕ ОШИБКИ:');
        criticalErrors.forEach(error => {
            console.log(`   • ${error.error}`);
        });
    }
    
    const recommendations = [];
    if (tests.some(t => t.error?.includes('402'))) {
        recommendations.push('Активируйте или продлите подписку amoCRM');
    }
    if (tests.some(t => t.error?.includes('401'))) {
        recommendations.push('Получите новый Access Token через OAuth');
    }
    if (domain === 'yourcompany.amocrm.ru') {
        recommendations.push('Исправьте AMOCRM_DOMAIN на pismovbanu.amocrm.ru');
    }
    if (!ENV_VARS.AMOCRM_CLIENT_ID) {
        recommendations.push('Установите AMOCRM_CLIENT_ID в .env файл');
    }
    if (!ENV_VARS.AMOCRM_CLIENT_SECRET) {
        recommendations.push('Установите AMOCRM_CLIENT_SECRET в .env файл');
    }
    
    res.json({ 
        tests, 
        summary,
        criticalErrors: criticalErrors.map(e => e.error),
        recommendations
    });
});

// Проверка OAuth
app.post('/api/diagnostic/oauth', async (req, res) => {
    console.log('\n🔐 ПРОВЕРКА OAuth КОНФИГУРАЦИИ');
    
    const tests = [];
    
    // Проверка обязательных полей
    if (!ENV_VARS.AMOCRM_CLIENT_ID) {
        tests.push({
            name: 'Client ID',
            success: false,
            details: 'Не установлен',
            error: 'Установите AMOCRM_CLIENT_ID в .env файл'
        });
    } else {
        tests.push({
            name: 'Client ID',
            success: true,
            details: ENV_VARS.AMOCRM_CLIENT_ID.substring(0, 8) + '...'
        });
    }
    
    if (!ENV_VARS.AMOCRM_CLIENT_SECRET) {
        tests.push({
            name: 'Client Secret',
            success: false,
            details: 'Не установлен',
            error: 'Установите AMOCRM_CLIENT_SECRET в .env файл'
        });
    } else {
        tests.push({
            name: 'Client Secret',
            success: true,
            details: '••••••' + ENV_VARS.AMOCRM_CLIENT_SECRET.substring(ENV_VARS.AMOCRM_CLIENT_SECRET.length - 4)
        });
    }
    
    if (!ENV_VARS.AMOCRM_REDIRECT_URI) {
        tests.push({
            name: 'Redirect URI',
            success: false,
            details: 'Не установлен',
            error: 'Установите AMOCRM_REDIRECT_URI в .env файл'
        });
    } else {
        tests.push({
            name: 'Redirect URI',
            success: true,
            details: ENV_VARS.AMOCRM_REDIRECT_URI
        });
    }
    
    // Проверка Refresh Token
    if (ENV_VARS.AMOCRM_REFRESH_TOKEN && ENV_VARS.AMOCRM_REFRESH_TOKEN !== 'initial_refresh_token') {
        const test = await testOauthToken(
            ENV_VARS.AMOCRM_CLIENT_ID,
            ENV_VARS.AMOCRM_CLIENT_SECRET,
            ENV_VARS.AMOCRM_REFRESH_TOKEN,
            ENV_VARS.AMOCRM_REDIRECT_URI
        );
        
        tests.push({
            name: 'Refresh Token',
            success: test.success,
            details: test.success ? 
                '✅ Валиден, можно получить новый Access Token' : 
                '❌ Невалиден',
            error: test.success ? null : test.message,
            newToken: test.success ? test.access_token : null
        });
    } else {
        tests.push({
            name: 'Refresh Token',
            success: false,
            details: 'Не установлен или некорректен',
            error: 'Получите новый Refresh Token через OAuth авторизацию'
        });
    }
    
    // Генерация ссылки для OAuth
    if (ENV_VARS.AMOCRM_CLIENT_ID && ENV_VARS.AMOCRM_DOMAIN && ENV_VARS.AMOCRM_DOMAIN !== 'yourcompany.amocrm.ru') {
        const authUrl = `https://${ENV_VARS.AMOCRM_DOMAIN}/oauth?client_id=${ENV_VARS.AMOCRM_CLIENT_ID}&mode=post_message`;
        tests.push({
            name: 'Ссылка для OAuth авторизации',
            success: true,
            details: authUrl,
            authUrl: authUrl
        });
    }
    
    const summary = {
        success: tests.filter(t => t.success).length,
        errors: tests.filter(t => !t.success).length,
        total: tests.length
    };
    
    res.json({ tests, summary });
});

// OAuth авторизация
app.get('/oauth', (req, res) => {
    if (!ENV_VARS.AMOCRM_CLIENT_ID) {
        return res.send('Ошибка: AMOCRM_CLIENT_ID не установлен');
    }
    
    if (!ENV_VARS.AMOCRM_DOMAIN || ENV_VARS.AMOCRM_DOMAIN === 'yourcompany.amocrm.ru') {
        return res.send('Ошибка: AMOCRM_DOMAIN неверный. Исправьте на: pismovbanu.amocrm.ru');
    }
    
    const authUrl = `https://${ENV_VARS.AMOCRM_DOMAIN}/oauth?client_id=${ENV_VARS.AMOCRM_CLIENT_ID}&mode=post_message`;
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>OAuth авторизация</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 50px; text-align: center; }
            .container { max-width: 600px; margin: 0 auto; }
            .btn { 
                display: inline-block; 
                background: #2196F3; 
                color: white; 
                padding: 20px 40px; 
                border-radius: 5px; 
                text-decoration: none; 
                font-size: 18px; 
                margin: 20px 0;
                transition: background 0.3s;
            }
            .btn:hover { background: #0b7dda; }
            .info { 
                background: #f8f9fa; 
                padding: 20px; 
                border-radius: 5px; 
                margin: 20px 0; 
                text-align: left;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🔐 OAuth авторизация amoCRM</h1>
            <p>Для получения доступа к amoCRM необходимо пройти авторизацию</p>
            
            <a href="${authUrl}" class="btn" target="_blank">
                🔗 Авторизоваться в amoCRM
            </a>
            
            <div class="info">
                <h3>📋 Инструкция:</h3>
                <ol>
                    <li>Нажмите кнопку "Авторизоваться в amoCRM"</li>
                    <li>Войдите в свой аккаунт amoCRM если потребуется</li>
                    <li>Разрешите доступ приложению к вашему аккаунту</li>
                    <li>После успешной авторизации вы получите код</li>
                    <li>Используйте этот код для получения токенов через API</li>
                </ol>
                
                <p><strong>Client ID:</strong> ${ENV_VARS.AMOCRM_CLIENT_ID.substring(0, 8)}...</p>
                <p><strong>Redirect URI:</strong> ${ENV_VARS.AMOCRM_REDIRECT_URI}</p>
            </div>
            
            <p><a href="/">← Вернуться к диагностике</a></p>
        </div>
    </body>
    </html>
    `;
    
    res.send(html);
});

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        status: 'running',
        timestamp: new Date().toISOString(),
        env: Object.keys(ENV_VARS).reduce((acc, key) => {
            acc[key] = ENV_VARS[key] ? 'set' : 'not set';
            return acc;
        }, {}),
        endpoints: {
            quickTest: 'POST /api/diagnostic/quick',
            fullTest: 'POST /api/diagnostic/full',
            oauthTest: 'POST /api/diagnostic/oauth',
            oauth: 'GET /oauth',
            status: 'GET /api/status'
        }
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
app.listen(PORT, () => {
    console.log('\n' + '='.repeat(80));
    console.log(`✅ СЕРВЕР ДИАГНОСТИКИ ЗАПУЩЕН НА ПОРТУ ${PORT}`);
    console.log('='.repeat(80));
    console.log(`🌐 Веб-интерфейс: http://localhost:${PORT}`);
    console.log(`📊 API статус: http://localhost:${PORT}/api/status`);
    console.log(`🔍 Быстрая проверка: POST http://localhost:${PORT}/api/diagnostic/quick`);
    console.log('='.repeat(80));
    
    if (hasCriticalErrors) {
        console.log('\n🚨 ВНИМАНИЕ: Есть критические ошибки в конфигурации!');
        console.log('   Исправьте .env файл и перезапустите сервер.');
        console.log('='.repeat(80));
    }
});
