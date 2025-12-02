// app.js в корне проекта - точка входа сервера
const path = require('path');
const fs = require('fs');

console.log('🚀 Запуск CodeFarm...');
console.log('📁 Текущая директория:', __dirname);

// Загружаем .env
require('dotenv').config();

// Пытаемся загрузить server.js из текущей директории
try {
    console.log('🔧 Загрузка server.js...');
    
    // Проверяем, где находится server.js
    let serverPath;
    if (fs.existsSync(path.join(__dirname, 'app/server.js'))) {
        serverPath = './app/server.js';
        console.log('✅ server.js найден в app/');
    } else if (fs.existsSync(path.join(__dirname, 'server.js'))) {
        serverPath = './server.js';
        console.log('✅ server.js найден в корне');
    } else {
        // Создаем минимальный сервер если не найден
        console.log('⚠️ server.js не найден, создаем минимальный сервер...');
        createMinimalServer();
        return;
    }
    
    // Загружаем сервер
    require(serverPath);
    
    console.log('✅ CodeFarm успешно запущен!');
    
} catch (error) {
    console.error('❌ Ошибка запуска сервера:', error.message);
    console.error(error.stack);
    process.exit(1);
}

function createMinimalServer() {
    const express = require('express');
    const path = require('path');
    
    const app = express();
    const PORT = process.env.PORT || 3000;
    
    // Middleware
    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'client')));
    
    // Маршруты API
    app.get('/api/health', (req, res) => {
        res.json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            message: 'Minimal server is running'
        });
    });
    
    app.get('/api/lessons', (req, res) => {
        res.json([
            {
                id: 'lesson_1',
                title: 'Первые команды боту-помощнику',
                description: 'Научитесь давать базовые команды боту',
                level: 1,
                rewardCoins: 50,
                rewardExp: 100,
                theory: 'В этом уроке вы научитесь использовать функцию print() для вывода текста.',
                task: 'Напишите программу, которая поприветствует бота.',
                initialCode: '# Напишите приветствие для бота\nprint("Привет, АгроБот!")',
                exampleCode: 'print("Привет, АгроБот!")\nprint("Поработаем сегодня!")'
            }
        ]);
    });
    
    app.post('/api/user', (req, res) => {
        const { telegramId, username, firstName, lastName } = req.body;
        
        res.json({
            id: telegramId || 'demo-user',
            telegramId: telegramId || 'demo-user',
            username: username || 'demo',
            firstName: firstName || 'Демо Фермер',
            lastName: lastName || '',
            level: 1,
            coins: 100,
            experience: 0,
            lessonsCompleted: 0,
            streak: 1,
            created: new Date().toISOString()
        });
    });
    
    app.post('/api/lessons/:id/submit', (req, res) => {
        const { userId, code } = req.body;
        
        res.json({
            success: true,
            message: 'Урок пройден успешно!',
            score: 85,
            reward: 50,
            coins: 150
        });
    });
    
    // Главная страница
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'client/index.html'));
    });
    
    app.listen(PORT, () => {
        console.log(`🚀 Минимальный сервер запущен на порту ${PORT}`);
        console.log(`🌐 Веб-приложение: http://localhost:${PORT}`);
    });
}
