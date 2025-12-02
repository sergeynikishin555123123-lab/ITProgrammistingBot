// app.js - работает с текущей структурой
const path = require('path');
const fs = require('fs');

console.log('🚀 Запуск CodeFarm...');
console.log('📁 Текущая директория:', __dirname);

// Покажем структуру для отладки
console.log('📋 Структура проекта:');
try {
    const files = fs.readdirSync(__dirname);
    console.log('Корень:', files.filter(f => !f.startsWith('.')));
    
    if (fs.existsSync('client')) {
        const clientFiles = fs.readdirSync('client');
        console.log('client/:', clientFiles);
    }
    
    if (fs.existsSync('data')) {
        const dataFiles = fs.readdirSync('data');
        console.log('data/:', dataFiles);
    }
    
    if (fs.existsSync('app')) {
        const appFiles = fs.readdirSync('app');
        console.log('app/:', appFiles);
    }
} catch (err) {
    console.log('Ошибка чтения структуры:', err.message);
}

// Загружаем .env
require('dotenv').config();

// Пытаемся загрузить server.js из текущей директории
try {
    console.log('🔧 Загрузка server.js...');
    
    // Проверяем, где находится server.js
    let serverPath;
    if (fs.existsSync('app/server.js')) {
        serverPath = './app/server.js';
        console.log('✅ server.js найден в app/');
    } else if (fs.existsSync('server.js')) {
        serverPath = './server.js';
        console.log('✅ server.js найден в корне');
    } else {
        console.log('❌ server.js не найден!');
        process.exit(1);
    }
    
    // Загружаем сервер
    require(serverPath);
    
    console.log('✅ CodeFarm успешно запущен!');
    
} catch (error) {
    console.error('❌ Ошибка запуска сервера:', error.message);
    console.error(error.stack);
    process.exit(1);
}
