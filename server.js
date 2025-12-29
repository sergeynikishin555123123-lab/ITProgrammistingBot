// server.js - ПОЛНЫЙ СЕРВЕР ДЛЯ IT FARM - ОБУЧЕНИЕ ПРОГРАММИРОВАНИЮ
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs').promises;
const fsSync = require('fs');

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// CORS настройки
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://yourdomain.com'] 
        : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080', 'http://localhost:5000', 'http://localhost:5500'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Парсинг JSON с увеличенным лимитом
app.use(express.json({ 
    limit: '50mb',
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

app.use(express.urlencoded({ 
    extended: true, 
    limit: '50mb',
    parameterLimit: 100000
}));

// Статические файлы с правильными заголовками
app.use(express.static('public', {
    setHeaders: (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        
        // Настройки кэширования для разных типов файлов
        if (ext.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/)) {
            res.set('Cache-Control', 'public, max-age=31536000');
        } else if (ext.match(/\.(css|js)$/)) {
            res.set('Cache-Control', 'public, max-age=86400');
        } else {
            res.set('Cache-Control', 'public, max-age=3600');
        }
        
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'DENY');
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET');
    }
}));

// Middleware для обработки ошибок CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.path.startsWith('/api')) {
        res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.header('Pragma', 'no-cache');
        res.header('Expires', '0');
    }
    
    next();
});

// ==================== КОНФИГУРАЦИЯ ====================
const DEMO_MODE = true;

// ==================== НАСТРОЙКА ДИРЕКТОРИЙ ====================
const ensureUploadDirs = () => {
    try {
        console.log('📁 Проверка директорий для загрузок...');
        
        const dirs = [
            'public',
            'public/uploads',
            'public/uploads/users',
            'public/uploads/logo'
        ];
        
        let dirsCreated = true;
        dirs.forEach(dir => {
            try {
                if (!fsSync.existsSync(dir)) {
                    console.warn(`⚠️ Директория ${dir} не существует`);
                    console.log(`ℹ️ Для полной функциональности создайте директорию вручную:`);
                    console.log(`   mkdir -p ${dir}`);
                    console.log(`   chmod 755 ${dir}`);
                    dirsCreated = false;
                } else {
                    console.log(`✅ Директория ${dir} существует`);
                }
            } catch (dirError) {
                console.warn(`⚠️ Не удалось проверить директорию ${dir}:`, dirError.message);
                dirsCreated = false;
            }
        });
        
        return dirsCreated;
    } catch (error) {
        console.warn('⚠️ Предупреждение при проверке директорий:', error.message);
        return false;
    }
};
// Вызываем сразу
ensureUploadDirs();

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных IT Farm...');
        
        // Изменяем путь для работы без прав в текущей директории
        const dbPath = process.env.NODE_ENV === 'production' 
            ? '/tmp/itfarm_prod.db' 
            : path.join(os.homedir(), '.itfarm.db'); // Используем домашнюю директорию
        
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        await db.run('PRAGMA foreign_keys = ON');

        // Создание таблиц
        await db.exec('BEGIN TRANSACTION');

        // Пользователи
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE,
                username TEXT UNIQUE,
                password TEXT NOT NULL,
                full_name TEXT,
                avatar_url TEXT,
                role TEXT DEFAULT 'student' CHECK(role IN ('student', 'teacher', 'admin')),
                level INTEGER DEFAULT 1,
                experience INTEGER DEFAULT 0,
                coins INTEGER DEFAULT 0,
                completed_lessons TEXT DEFAULT '[]',
                farm_state TEXT DEFAULT '{"grass": 100, "elements": []}',
                is_active INTEGER DEFAULT 1,
                email_verified INTEGER DEFAULT 0,
                verification_token TEXT,
                reset_token TEXT,
                reset_token_expires TIMESTAMP,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Уроки программирования
        await db.exec(`
            CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                content TEXT NOT NULL,
                task_description TEXT NOT NULL,
                task_code TEXT NOT NULL,
                solution TEXT NOT NULL,
                icon TEXT NOT NULL,
                difficulty TEXT DEFAULT 'easy',
                duration_minutes INTEGER DEFAULT 15,
                order_index INTEGER DEFAULT 0,
                requirements TEXT DEFAULT '[]',
                farm_effect TEXT DEFAULT '{}',
                rewards TEXT DEFAULT '{"xp": 100, "coins": 50}',
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Прогресс пользователей
        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                lesson_id INTEGER NOT NULL,
                status TEXT DEFAULT 'not_started' CHECK(status IN ('not_started', 'started', 'completed')),
                attempts INTEGER DEFAULT 0,
                code_submissions TEXT DEFAULT '[]',
                completed_at TIMESTAMP,
                score INTEGER,
                feedback TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
                UNIQUE(user_id, lesson_id)
            )
        `);

        // Достижения
        await db.exec(`
            CREATE TABLE IF NOT EXISTS achievements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                icon TEXT NOT NULL,
                condition TEXT NOT NULL,
                rewards TEXT DEFAULT '{"xp": 50, "coins": 25}',
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Достижения пользователей
        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_achievements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                achievement_id INTEGER NOT NULL,
                unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE,
                UNIQUE(user_id, achievement_id)
            )
        `);

        // Код сессии (для выполнения кода)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS code_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                lesson_id INTEGER,
                code TEXT NOT NULL,
                output TEXT,
                error TEXT,
                execution_time INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE SET NULL
            )
        `);

        // Уведомления
        await db.exec(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                read_at TIMESTAMP,
                related_id INTEGER,
                related_type TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Системные настройки
        await db.exec(`
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT,
                description TEXT,
                category TEXT DEFAULT 'general',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.exec('COMMIT');
        console.log('✅ Все таблицы созданы');

        // Создание начальных данных
        await createInitialData();
        
        return db;
    } catch (error) {
        try {
            await db.exec('ROLLBACK');
        } catch (rollbackError) {
            console.error('Ошибка при ROLLBACK:', rollbackError.message);
        }
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        throw error;
    }
};

// ==================== НАЧАЛЬНЫЕ ДАННЫЕ ====================
const createInitialData = async () => {
    try {
        console.log('📝 Создание начальных данных IT Farm...');

        // 1. Системные настройки
        const settingsExist = await db.get("SELECT 1 FROM settings WHERE key = 'site_name'");
        if (!settingsExist) {
            const settings = [
                ['site_name', 'IT Farm', 'Название сайта', 'general'],
                ['site_description', 'Обучение программированию через игру - создайте свою цифровую ферму!', 'Описание сайта', 'general'],
                ['welcome_message', 'Добро пожаловать в IT Farm! Начните свой путь в программировании с первого урока.', 'Приветственное сообщение', 'general'],
                ['default_avatar_color', '#7CB342', 'Цвет аватара по умолчанию', 'appearance'],
                ['demo_mode', DEMO_MODE ? '1' : '0', 'Демо-режим', 'system'],
                ['xp_per_level', '100', 'Опыт для повышения уровня', 'game'],
                ['coins_per_lesson', '50', 'Монет за урок', 'game'],
                ['max_lesson_attempts', '3', 'Максимальное количество попыток', 'lessons']
            ];

            for (const setting of settings) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO settings (key, value, description, category) VALUES (?, ?, ?, ?)`,
                        setting
                    );
                } catch (error) {
                    console.warn(`Ошибка вставки настройки ${setting[0]}:`, error.message);
                }
            }
            console.log('✅ Настройки системы созданы');
        }

        // 2. Уроки программирования
        const lessonsExist = await db.get("SELECT 1 FROM lessons LIMIT 1");
        if (!lessonsExist) {
            console.log('📚 Создание уроков программирования...');
            
            const lessons = [
                {
                    title: "Основы JavaScript: Первая программа",
                    description: "Напишите свой первый код на JavaScript и скосите траву на ферме",
                    content: `
                        <h3>🎉 Добро пожаловать в мир программирования!</h3>
                        <p>JavaScript - это язык программирования, который оживляет веб-страницы. Давайте начнем с простого:</p>
                        
                        <h4>📝 Что такое console.log()?</h4>
                        <p><code>console.log()</code> - это функция, которая выводит информацию в консоль разработчика. Это ваш первый инструмент для отладки и вывода информации.</p>
                        
                        <h4>🔤 Строки в JavaScript</h4>
                        <p>Строки - это последовательности символов, заключенные в кавычки:</p>
                        <ul>
                            <li><code>"Привет, мир!"</code> - двойные кавычки</li>
                            <li><code>'Привет, мир!'</code> - одинарные кавычки</li>
                            <li><code>\`Привет, мир!\`</code> - обратные кавычки (для шаблонных строк)</li>
                        </ul>
                        
                        <h4>✨ Примеры:</h4>
                        <div class="code-example">
                            <pre><code>// Вывод текста
console.log("Привет, IT Farm!");

// Вывод числа
console.log(42);

// Вывод нескольких значений
console.log("Трава:", 100, "%");</code></pre>
                        </div>
                    `,
                    task_description: "Используйте функцию console.log() чтобы вывести сообщение 'Трава скошена!' в консоль",
                    task_code: `// Ваш код здесь
// Напишите console.log() с сообщением`,
                    solution: "console.log('Трава скошена!');",
                    icon: "fas fa-code",
                    difficulty: "easy",
                    duration_minutes: 10,
                    order_index: 1,
                    requirements: "[]",
                    farm_effect: JSON.stringify({
                        action: "clear_grass",
                        amount: 50,
                        message: "Вы скосили 50% травы на ферме!"
                    }),
                    rewards: JSON.stringify({ xp: 100, coins: 50 })
                },
                {
                    title: "Переменные: Хранилища для данных",
                    description: "Создайте переменные для хранения информации о ферме",
                    content: `
                        <h3>📦 Переменные в JavaScript</h3>
                        <p>Переменные - это контейнеры для хранения данных. Они помогают сохранять и повторно использовать информацию.</p>
                        
                        <h4>🔧 Способы объявления переменных:</h4>
                        <div class="code-example">
                            <pre><code>// 1. let - изменяемая переменная
let grassAmount = 100;
grassAmount = 50; // Можно изменить

// 2. const - константа (нельзя изменить)
const farmName = "IT Farm";
// farmName = "Новая ферма"; // Ошибка!

// 3. var - устаревший способ (старайтесь не использовать)
var oldWay = "не рекомендуется";</code></pre>
                        </div>
                        
                        <h4>🎯 Типы данных:</h4>
                        <ul>
                            <li><strong>Числа:</strong> <code>let seeds = 10;</code></li>
                            <li><strong>Строки:</strong> <code>let plantType = "Пшеница";</code></li>
                            <li><strong>Логические:</strong> <code>let isWatered = true;</code></li>
                            <li><strong>Массивы:</strong> <code>let tools = ["лопата", "грабли", "лейка"];</code></li>
                            <li><strong>Объекты:</strong> <code>let farmer = { name: "Иван", level: 1 };</code></li>
                        </ul>
                        
                        <h4>🔗 Конкатенация строк:</h4>
                        <p>Объединение строк с помощью оператора +:</p>
                        <pre><code>let greeting = "Привет, " + "фермер!"; // "Привет, фермер!"</code></pre>
                    `,
                    task_description: "Создайте переменную seeds и присвойте ей значение 10, затем создайте переменную plantType со значением 'Пшеница'",
                    task_code: `// Создайте переменные здесь
// Используйте let для seeds
// Используйте const для plantType`,
                    solution: "let seeds = 10;\nconst plantType = 'Пшеница';",
                    icon: "fas fa-seedling",
                    difficulty: "easy",
                    duration_minutes: 15,
                    order_index: 2,
                    requirements: JSON.stringify([1]),
                    farm_effect: JSON.stringify({
                        action: "plant_seeds",
                        count: 10,
                        plant_type: "Пшеница",
                        message: "Вы посадили 10 семян пшеницы!"
                    }),
                    rewards: JSON.stringify({ xp: 150, coins: 75 })
                },
                {
                    title: "Функции: Автоматизация работы на ферме",
                    description: "Создайте функции для автоматизации повторяющихся задач",
                    content: `
                        <h3>⚙️ Функции в JavaScript</h3>
                        <p>Функции - это блоки кода, которые выполняют определенную задачу. Они помогают избежать повторения кода.</p>
                        
                        <h4>📝 Объявление функции:</h4>
                        <div class="code-example">
                            <pre><code>// 1. Function Declaration
function waterPlants() {
    console.log("Поливаю растения...");
    return "Растения политы!";
}

// 2. Function Expression
const harvestCrops = function() {
    console.log("Собираю урожай...");
    return "Урожай собран!";
};

// 3. Arrow Function (ES6)
const feedAnimals = () => {
    console.log("Кормлю животных...");
    return "Животные накормлены!";
};</code></pre>
                        </div>
                        
                        <h4>🎯 Параметры и аргументы:</h4>
                        <pre><code>function plantSeed(seedType, count) {
    console.log(\`Сажаю \${count} семян \${seedType}\`);
    return \`Посажено: \${seedType} x\${count}\`;
}

// Вызов функции с аргументами
plantSeed("Морковь", 5); // "Сажаю 5 семян Морковь"</code></pre>
                        
                        <h4>↩️ Возврат значений:</h4>
                        <p>Ключевое слово <code>return</code> возвращает результат работы функции:</p>
                        <pre><code>function calculateArea(width, height) {
    return width * height;
}

let fieldArea = calculateArea(10, 20); // 200</code></pre>
                    `,
                    task_description: "Создайте функцию buildFence(), которая возвращает строку 'Забор построен!'",
                    task_code: `// Создайте функцию buildFence здесь
// Она должна возвращать строку`,
                    solution: "function buildFence() {\n    return 'Забор построен!';\n}",
                    icon: "fas fa-hammer",
                    difficulty: "medium",
                    duration_minutes: 20,
                    order_index: 3,
                    requirements: JSON.stringify([1, 2]),
                    farm_effect: JSON.stringify({
                        action: "build_fence",
                        length: 50,
                        message: "Вы построили забор вокруг фермы!"
                    }),
                    rewards: JSON.stringify({ xp: 200, coins: 100 })
                },
                {
                    title: "Условные операторы: Принятие решений",
                    description: "Научите ферму принимать решения в зависимости от условий",
                    content: `
                        <h3>🤔 Условные операторы if/else</h3>
                        <p>Условные операторы позволяют выполнять разный код в зависимости от условий.</p>
                        
                        <h4>🎯 Базовый синтаксис:</h4>
                        <div class="code-example">
                            <pre><code>let weather = "солнечно";

if (weather === "солнечно") {
    console.log("Идеальный день для работы в поле!");
} else if (weather === "дождь") {
    console.log("Лучше заняться делами в сарае");
} else {
    console.log("Обычный день на ферме");
}</code></pre>
                        </div>
                        
                        <h4>⚖️ Операторы сравнения:</h4>
                        <ul>
                            <li><code>===</code> - строгое равенство</li>
                            <li><code>!==</code> - неравенство</li>
                            <li><code>></code> - больше</li>
                            <li><code><</code> - меньше</li>
                            <li><code>>=</code> - больше или равно</li>
                            <li><code><=</code> - меньше или равно</li>
                        </ul>
                        
                        <h4>🔀 Тернарный оператор:</h4>
                        <p>Короткая запись if/else:</p>
                        <pre><code>let isDay = true;
let greeting = isDay ? "Добрый день!" : "Доброй ночи!";
// То же что и:
// if (isDay) {
//     greeting = "Добрый день!";
// } else {
//     greeting = "Доброй ночи!";
// }</code></pre>
                        
                        <h4>🔗 Логические операторы:</h4>
                        <pre><code>let hasSeeds = true;
let hasWater = true;

// И (&&) - оба условия true
if (hasSeeds && hasWater) {
    console.log("Можно сажать растения!");
}

// ИЛИ (||) - хотя бы одно условие true
let isWeekend = true;
let isHoliday = false;
if (isWeekend || isHoliday) {
    console.log("Можно отдохнуть!");
}

// НЕ (!) - инвертирует значение
let isRaining = false;
if (!isRaining) {
    console.log("Дождя нет, можно работать!");
}</code></pre>
                    `,
                    task_description: "Создайте функцию checkSoil(quality), которая возвращает 'Можно сажать' если quality больше 70, иначе 'Нужно удобрить'",
                    task_code: `// Создайте функцию checkSoil с параметром quality
// Используйте условный оператор if/else`,
                    solution: "function checkSoil(quality) {\n    if (quality > 70) {\n        return 'Можно сажать';\n    } else {\n        return 'Нужно удобрить';\n    }\n}",
                    icon: "fas fa-question-circle",
                    difficulty: "medium",
                    duration_minutes: 25,
                    order_index: 4,
                    requirements: JSON.stringify([1, 2, 3]),
                    farm_effect: JSON.stringify({
                        action: "plow_field",
                        area: 100,
                        message: "Вы вспахали поле для посадки!"
                    }),
                    rewards: JSON.stringify({ xp: 250, coins: 125 })
                },
                {
                    title: "Циклы: Массовая обработка",
                    description: "Используйте циклы для обработки множества элементов на ферме",
                    content: `
                        <h3>🔄 Циклы в JavaScript</h3>
                        <p>Циклы позволяют выполнять один и тот же код несколько раз - идеально для работы с множеством объектов на ферме!</p>
                        
                        <h4>📝 Цикл for:</h4>
                        <div class="code-example">
                            <pre><code>// Вырастить 5 деревьев
for (let i = 1; i <= 5; i++) {
    console.log(\`Выращиваю дерево #\${i}\`);
}

// Собираем урожай с грядок
let beds = ["Морковь", "Капуста", "Помидоры"];
for (let i = 0; i < beds.length; i++) {
    console.log(\`Собираю \${beds[i]}\`);
}</code></pre>
                        </div>
                        
                        <h4>🌀 Цикл while:</h4>
                        <pre><code>// Пока есть вода - поливаем
let waterAmount = 100;

while (waterAmount > 0) {
    console.log(\`Поливаю растение. Осталось воды: \${waterAmount}\`);
    waterAmount -= 10;
}</code></pre>
                        
                        <h4>🎯 Цикл for...of (для массивов):</h4>
                        <pre><code>let animals = ["Корова", "Курица", "Овца"];

for (let animal of animals) {
    console.log(\`Кормлю \${animal}\`);
}</code></pre>
                        
                        <h4>🗝️ Цикл for...in (для объектов):</h4>
                        <pre><code>let farmStats = {
    cows: 5,
    chickens: 20,
    area: 1000
};

for (let key in farmStats) {
    console.log(\`\${key}: \${farmStats[key]}\`);
}</code></pre>
                        
                        <h4>⏹️ Управление циклами:</h4>
                        <pre><code>// break - прервать цикл
for (let i = 1; i <= 10; i++) {
    if (i === 5) {
        break; // цикл остановится на 5
    }
    console.log(i);
}

// continue - пропустить итерацию
for (let i = 1; i <= 5; i++) {
    if (i === 3) {
        continue; // пропустит 3
    }
    console.log(i);
}</code></pre>
                    `,
                    task_description: "Создайте функцию waterPlants(plants), которая принимает массив растений и возвращает сообщение о поливе каждого",
                    task_code: `// Используйте цикл for...of
// Верните строку с результатами`,
                    solution: "function waterPlants(plants) {\n    let result = '';\n    for (let plant of plants) {\n        result += `Поливаю ${plant}\\n`;\n    }\n    return result;\n}",
                    icon: "fas fa-redo",
                    difficulty: "medium",
                    duration_minutes: 30,
                    order_index: 5,
                    requirements: JSON.stringify([1, 2, 3, 4]),
                    farm_effect: JSON.stringify({
                        action: "build_house",
                        size: "medium",
                        message: "Вы построили дом на ферме!"
                    }),
                    rewards: JSON.stringify({ xp: 300, coins: 150 })
                }
            ];

            for (const lesson of lessons) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO lessons 
                        (title, description, content, task_description, task_code, solution, 
                         icon, difficulty, duration_minutes, order_index, requirements, 
                         farm_effect, rewards, is_active) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            lesson.title,
                            lesson.description,
                            lesson.content,
                            lesson.task_description,
                            lesson.task_code,
                            lesson.solution,
                            lesson.icon,
                            lesson.difficulty,
                            lesson.duration_minutes,
                            lesson.order_index,
                            lesson.requirements,
                            lesson.farm_effect,
                            lesson.rewards,
                            1
                        ]
                    );
                } catch (error) {
                    console.warn('Ошибка вставки урока:', error.message);
                }
            }
            console.log(`✅ Создано ${lessons.length} уроков программирования`);
        }

        // 3. Достижения
        const achievementsExist = await db.get("SELECT 1 FROM achievements LIMIT 1");
        if (!achievementsExist) {
            const achievements = [
                {
                    title: "Первый код",
                    description: "Выполнен первый урок программирования",
                    icon: "fas fa-star",
                    condition: "completed_lessons >= 1",
                    rewards: JSON.stringify({ xp: 100, coins: 50 })
                },
                {
                    title: "Начинающий фермер",
                    description: "Выполнено 3 урока",
                    icon: "fas fa-tractor",
                    condition: "completed_lessons >= 3",
                    rewards: JSON.stringify({ xp: 200, coins: 100 })
                },
                {
                    title: "Опытный кодер",
                    description: "Достигнут 3 уровень",
                    icon: "fas fa-laptop-code",
                    condition: "level >= 3",
                    rewards: JSON.stringify({ xp: 300, coins: 150 })
                },
                {
                    title: "Мастер функций",
                    description: "Выполнен урок по функциям",
                    icon: "fas fa-cogs",
                    condition: "lesson_completed:3",
                    rewards: JSON.stringify({ xp: 150, coins: 75 })
                },
                {
                    title: "Цикловой король",
                    description: "Выполнен урок по циклам",
                    icon: "fas fa-infinity",
                    condition: "lesson_completed:5",
                    rewards: JSON.stringify({ xp: 200, coins: 100 })
                }
            ];

            for (const achievement of achievements) {
                try {
                    await db.run(
                        `INSERT OR IGNORE INTO achievements 
                        (title, description, icon, condition, rewards, is_active) 
                        VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            achievement.title,
                            achievement.description,
                            achievement.icon,
                            achievement.condition,
                            achievement.rewards,
                            1
                        ]
                    );
                } catch (error) {
                    console.warn('Ошибка вставки достижения:', error.message);
                }
            }
            console.log('✅ Достижения созданы');
        }

        // 4. Тестовый пользователь
        const userExist = await db.get("SELECT 1 FROM users WHERE email = 'student@itfarm.test'");
        if (!userExist) {
            const passwordHash = await bcrypt.hash('student123', 12);
            
            await db.run(
                `INSERT OR IGNORE INTO users 
                (email, username, password, full_name, role, level, experience, coins, 
                 farm_state, is_active, email_verified) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    'student@itfarm.test',
                    'student',
                    passwordHash,
                    'Тестовый Студент',
                    'student',
                    1,
                    0,
                    0,
                    JSON.stringify({
                        grass: 100,
                        elements: [],
                        seed_count: 0,
                        has_fence: false,
                        field_plowed: false,
                        has_house: false
                    }),
                    1,
                    1
                ]
            );
            console.log('✅ Тестовый пользователь создан');
        }

        console.log('🎉 Все начальные данные созданы!');
        
    } catch (error) {
        console.error('⚠️ Ошибка создания начальных данных:', error.message);
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
const validateEmail = (email) => {
    if (!email) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

const generateAvatarUrl = (username) => {
    const colors = ['#7CB342', '#4A7C2A', '#2D5016', '#FFD54F', '#FFB300'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=${color.replace('#', '')}&color=fff&bold=true`;
};

// ==================== JWT МИДЛВАР ====================
const authMiddleware = (roles = []) => {
    return async (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;
            
            const publicRoutes = [
                'GET /',
                'GET /health',
                'POST /api/auth/register',
                'POST /api/auth/login',
                'GET /api/lessons',
                'GET /api/lessons/:id',
                'OPTIONS /*'
            ];
            
            const currentRoute = `${req.method} ${req.path}`;
            const isPublicRoute = publicRoutes.some(route => {
                if (route.includes('*')) {
                    const pattern = route.replace('*', '.*');
                    return new RegExp(`^${pattern}$`).test(currentRoute);
                }
                return currentRoute === route;
            });
            
            if (isPublicRoute) {
                return next();
            }
            
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Требуется авторизация' 
                });
            }
            
            const token = authHeader.replace('Bearer ', '').trim();
            
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'itfarm-secret-key-2024');
                
                const user = await db.get(
                    `SELECT id, email, username, full_name, role, level, experience, coins,
                            completed_lessons, farm_state, avatar_url, is_active
                     FROM users WHERE id = ? AND is_active = 1`,
                    [decoded.id]
                );
                
                if (!user) {
                    return res.status(401).json({ 
                        success: false, 
                        error: 'Пользователь не найден' 
                    });
                }
                
                req.user = {
                    id: user.id,
                    email: user.email,
                    username: user.username,
                    full_name: user.full_name,
                    role: user.role,
                    level: user.level,
                    experience: user.experience,
                    coins: user.coins,
                    completed_lessons: JSON.parse(user.completed_lessons || '[]'),
                    farm_state: JSON.parse(user.farm_state || '{}'),
                    avatar_url: user.avatar_url
                };
                
                if (roles.length > 0 && !roles.includes(user.role)) {
                    return res.status(403).json({ 
                        success: false, 
                        error: 'Недостаточно прав' 
                    });
                }
                
                next();
                
            } catch (jwtError) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Неверный токен' 
                });
            }
            
        } catch (error) {
            console.error('Ошибка authMiddleware:', error);
            return res.status(500).json({ 
                success: false, 
                error: 'Внутренняя ошибка сервера' 
            });
        }
    };
};

// ==================== API МАРШРУТЫ ====================

// Главная
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🚜 Добро пожаловать в IT Farm API',
        version: '1.0.0',
        status: '🟢 Работает',
        features: ['Обучение JavaScript', 'Интерактивная ферма', 'Система прогресса', 'Достижения'],
        demo_mode: DEMO_MODE,
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        
        const tables = ['users', 'lessons', 'user_progress', 'achievements'];
        const tableStatus = {};
        
        for (const table of tables) {
            try {
                await db.get(`SELECT 1 FROM ${table} LIMIT 1`);
                tableStatus[table] = 'OK';
            } catch (error) {
                tableStatus[table] = 'ERROR';
            }
        }
        
        res.json({
            success: true,
            status: 'OK',
            database: 'connected',
            tables: tableStatus,
            demo_mode: DEMO_MODE,
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'ERROR',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ==================== АУТЕНТИФИКАЦИЯ ====================

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, username, password, full_name } = req.body;
        
        console.log('📝 Регистрация нового пользователя:', { email, username });
        
        if (!email || !username || !password || !full_name) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен содержать не менее 6 символов'
            });
        }
        
        if (!validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный email адрес'
            });
        }
        
        // Проверяем уникальность email и username
        const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingEmail) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким email уже существует'
            });
        }
        
        const existingUsername = await db.get('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUsername) {
            return res.status(409).json({
                success: false,
                error: 'Этот username уже занят'
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 12);
        const avatarUrl = generateAvatarUrl(username);
        
        const result = await db.run(
            `INSERT INTO users 
            (email, username, password, full_name, avatar_url, role) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [email, username, hashedPassword, full_name, avatarUrl, 'student']
        );
        
        const userId = result.lastID;
        
        // Создаем начальное состояние фермы
        const initialFarmState = {
            grass: 100,
            elements: [],
            seed_count: 0,
            has_fence: false,
            field_plowed: false,
            has_house: false,
            trees: 0,
            animals: []
        };
        
        await db.run(
            'UPDATE users SET farm_state = ? WHERE id = ?',
            [JSON.stringify(initialFarmState), userId]
        );
        
        // Создаем уведомление
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                userId,
                'welcome',
                'Добро пожаловать в IT Farm!',
                'Начните свой путь в программировании с первого урока. Удачи!'
            ]
        );
        
        const user = await db.get(
            `SELECT id, email, username, full_name, role, level, experience, coins,
                    avatar_url, farm_state
             FROM users WHERE id = ?`,
            [userId]
        );
        
        const token = jwt.sign(
            { 
                id: user.id,
                email: user.email,
                username: user.username,
                role: user.role
            },
            process.env.JWT_SECRET || 'itfarm-secret-key-2024',
            { expiresIn: '30d' }
        );
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешна! Добро пожаловать в IT Farm!',
            data: { 
                user: {
                    ...user,
                    farm_state: JSON.parse(user.farm_state)
                },
                token
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка регистрации:', error.message);
        
        if (error.message.includes('UNIQUE constraint failed') || error.message.includes('SQLITE_CONSTRAINT')) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким email или username уже существует'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при регистрации'
        });
    }
});

// Вход
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log('🔐 Попытка входа:', { email });
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Укажите email и пароль'
            });
        }
        
        const user = await db.get(
            `SELECT * FROM users WHERE email = ? AND is_active = 1`,
            [email]
        );
        
        if (!user) {
            console.log(`❌ Пользователь не найден: ${email}`);
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден или учетная запись неактивна'
            });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Неверный пароль'
            });
        }
        
        // Обновляем время последнего входа
        await db.run(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        const userForResponse = {
            id: user.id,
            email: user.email,
            username: user.username,
            full_name: user.full_name,
            role: user.role,
            level: user.level,
            experience: user.experience,
            coins: user.coins,
            completed_lessons: JSON.parse(user.completed_lessons || '[]'),
            farm_state: JSON.parse(user.farm_state || '{}'),
            avatar_url: user.avatar_url
        };
        
        const token = jwt.sign(
            { 
                id: user.id,
                email: user.email,
                username: user.username,
                role: user.role
            },
            process.env.JWT_SECRET || 'itfarm-secret-key-2024',
            { expiresIn: '30d' }
        );
        
        console.log('✅ Успешный вход пользователя:', user.email);
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: { 
                user: userForResponse,
                token 
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка входа:', error.message);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при входе'
        });
    }
});

// Проверка токена
app.get('/api/auth/check', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, username, full_name, role, level, experience, coins,
                    completed_lessons, farm_state, avatar_url
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const userForResponse = {
            ...user,
            completed_lessons: JSON.parse(user.completed_lessons || '[]'),
            farm_state: JSON.parse(user.farm_state || '{}')
        };
        
        res.json({
            success: true,
            data: { user: userForResponse }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки токена:', error.message);
        res.status(401).json({
            success: false,
            error: 'Неверный токен'
        });
    }
});

// Профиль пользователя
app.get('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, username, full_name, role, level, experience, coins,
                    completed_lessons, farm_state, avatar_url, created_at, updated_at
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const completedLessons = JSON.parse(user.completed_lessons || '[]');
        const farmState = JSON.parse(user.farm_state || '{}');
        
        // Получаем статистику прогресса
        const totalLessons = await db.get('SELECT COUNT(*) as count FROM lessons WHERE is_active = 1');
        const userProgress = await db.all(
            'SELECT * FROM user_progress WHERE user_id = ?',
            [req.user.id]
        );
        
        // Получаем достижения пользователя
        const achievements = await db.all(`
            SELECT a.* 
            FROM achievements a
            JOIN user_achievements ua ON a.id = ua.achievement_id
            WHERE ua.user_id = ?
            ORDER BY ua.unlocked_at DESC
        `, [req.user.id]);
        
        // Получаем уведомления
        const unreadNotifications = await db.get(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        
        const userForResponse = {
            ...user,
            completed_lessons: completedLessons,
            farm_state: farmState
        };
        
        res.json({
            success: true,
            data: { 
                user: userForResponse,
                stats: {
                    total_lessons: totalLessons?.count || 0,
                    completed_lessons: completedLessons.length,
                    progress_percent: totalLessons?.count ? Math.round((completedLessons.length / totalLessons.count) * 100) : 0,
                    achievements_count: achievements.length,
                    unread_notifications: unreadNotifications?.count || 0,
                    experience_needed: (user.level || 1) * 100,
                    level_progress: user.experience % 100
                },
                achievements: achievements,
                user_progress: userProgress
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения профиля:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения профиля'
        });
    }
});

// Обновление профиля
app.put('/api/auth/profile', authMiddleware(), async (req, res) => {
    try {
        const { full_name, avatar_url } = req.body;
        
        const updateFields = [];
        const updateValues = [];
        
        if (full_name !== undefined) {
            updateFields.push('full_name = ?');
            updateValues.push(full_name);
        }
        
        if (avatar_url !== undefined) {
            updateFields.push('avatar_url = ?');
            updateValues.push(avatar_url);
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Нет данных для обновления'
            });
        }
        
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(req.user.id);
        
        const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
        
        await db.run(query, updateValues);
        
        const user = await db.get(
            `SELECT id, email, username, full_name, role, level, experience, coins,
                    avatar_url
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        res.json({
            success: true,
            message: 'Профиль успешно обновлен',
            data: { user }
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления профиля:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления профиля'
        });
    }
});

// ==================== УРОКИ ПРОГРАММИРОВАНИЯ ====================

// Получение всех уроков
app.get('/api/lessons', async (req, res) => {
    try {
        const lessons = await db.all(
            'SELECT * FROM lessons WHERE is_active = 1 ORDER BY order_index ASC'
        );
        
        const lessonsWithParsedData = lessons.map(lesson => ({
            ...lesson,
            requirements: JSON.parse(lesson.requirements || '[]'),
            farm_effect: JSON.parse(lesson.farm_effect || '{}'),
            rewards: JSON.parse(lesson.rewards || '{}')
        }));
        
        res.json({
            success: true,
            data: {
                lessons: lessonsWithParsedData,
                count: lessons.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения уроков:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения уроков'
        });
    }
});

// Получение урока по ID
app.get('/api/lessons/:id', async (req, res) => {
    try {
        const lessonId = req.params.id;
        
        const lesson = await db.get(
            'SELECT * FROM lessons WHERE id = ? AND is_active = 1',
            [lessonId]
        );
        
        if (!lesson) {
            return res.status(404).json({
                success: false,
                error: 'Урок не найден'
            });
        }
        
        const lessonWithParsedData = {
            ...lesson,
            requirements: JSON.parse(lesson.requirements || '[]'),
            farm_effect: JSON.parse(lesson.farm_effect || '{}'),
            rewards: JSON.parse(lesson.rewards || '{}')
        };
        
        res.json({
            success: true,
            data: { lesson: lessonWithParsedData }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения урока:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения урока'
        });
    }
});

// Получение прогресса пользователя по урокам
app.get('/api/lessons/:id/progress', authMiddleware(), async (req, res) => {
    try {
        const lessonId = req.params.id;
        const userId = req.user.id;
        
        // Проверяем доступность урока
        const lesson = await db.get(
            'SELECT * FROM lessons WHERE id = ? AND is_active = 1',
            [lessonId]
        );
        
        if (!lesson) {
            return res.status(404).json({
                success: false,
                error: 'Урок не найден'
            });
        }
        
        // Проверяем требования
        const requirements = JSON.parse(lesson.requirements || '[]');
        const user = await db.get(
            'SELECT completed_lessons FROM users WHERE id = ?',
            [userId]
        );
        
        const completedLessons = JSON.parse(user.completed_lessons || '[]');
        const isLocked = requirements.length > 0 && !requirements.every(req => completedLessons.includes(req));
        
        // Получаем прогресс
        const progress = await db.get(
            'SELECT * FROM user_progress WHERE user_id = ? AND lesson_id = ?',
            [userId, lessonId]
        );
        
        const lessonWithParsedData = {
            ...lesson,
            requirements: requirements,
            farm_effect: JSON.parse(lesson.farm_effect || '{}'),
            rewards: JSON.parse(lesson.rewards || '{}'),
            is_locked: isLocked,
            is_completed: completedLessons.includes(parseInt(lessonId)),
            progress: progress || {
                status: 'not_started',
                attempts: 0,
                code_submissions: []
            }
        };
        
        res.json({
            success: true,
            data: { 
                lesson: lessonWithParsedData,
                user_progress: progress
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения прогресса урока:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения прогресса урока'
        });
    }
});

// Запуск кода урока
app.post('/api/lessons/:id/run', authMiddleware(), async (req, res) => {
    try {
        const lessonId = req.params.id;
        const userId = req.user.id;
        const { code } = req.body;
        
        if (!code || code.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Код не может быть пустым'
            });
        }
        
        console.log(`▶️ Запуск кода для урока ${lessonId} пользователем ${userId}`);
        
        // Безопасное выполнение кода (симуляция)
        // ВНИМАНИЕ: В реальном приложении используйте sandbox или изолированную среду
        let output = '';
        let error = null;
        let executionTime = 0;
        
        try {
            // Симуляция выполнения кода
            const startTime = Date.now();
            
            // Простая проверка на наличие console.log
            if (code.includes('console.log')) {
                output = 'Код выполнен успешно. Проверьте консоль браузера (F12) для просмотра вывода.';
            } else {
                output = 'Код выполнен, но не содержит вывода в консоль.';
            }
            
            executionTime = Date.now() - startTime;
            
            // Сохраняем сессию выполнения
            await db.run(
                `INSERT INTO code_sessions (user_id, lesson_id, code, output, error, execution_time) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [userId, lessonId, code, output, error, executionTime]
            );
            
            // Обновляем прогресс
            const progress = await db.get(
                'SELECT * FROM user_progress WHERE user_id = ? AND lesson_id = ?',
                [userId, lessonId]
            );
            
            if (progress) {
                const submissions = JSON.parse(progress.code_submissions || '[]');
                submissions.push({
                    code: code,
                    timestamp: new Date().toISOString(),
                    output: output
                });
                
                await db.run(
                    `UPDATE user_progress SET 
                        attempts = attempts + 1,
                        code_submissions = ?,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE user_id = ? AND lesson_id = ?`,
                    [JSON.stringify(submissions), userId, lessonId]
                );
            } else {
                await db.run(
                    `INSERT INTO user_progress 
                    (user_id, lesson_id, status, attempts, code_submissions) 
                    VALUES (?, ?, ?, ?, ?)`,
                    [userId, lessonId, 'started', 1, JSON.stringify([{
                        code: code,
                        timestamp: new Date().toISOString(),
                        output: output
                    }])]
                );
            }
            
            res.json({
                success: true,
                message: 'Код успешно выполнен',
                data: {
                    output: output,
                    execution_time: executionTime,
                    lesson_id: lessonId
                }
            });
            
        } catch (execError) {
            error = execError.message;
            
            // Сохраняем ошибку
            await db.run(
                `INSERT INTO code_sessions (user_id, lesson_id, code, output, error, execution_time) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [userId, lessonId, code, null, error, executionTime]
            );
            
            res.status(400).json({
                success: false,
                error: 'Ошибка выполнения кода',
                data: {
                    error: error,
                    lesson_id: lessonId
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка выполнения кода:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка выполнения кода'
        });
    }
});

// Проверка решения урока
app.post('/api/lessons/:id/check', authMiddleware(), async (req, res) => {
    try {
        const lessonId = req.params.id;
        const userId = req.user.id;
        const { code } = req.body;
        
        console.log(`✅ Проверка решения для урока ${lessonId} пользователем ${userId}`);
        
        // Получаем урок и решение
        const lesson = await db.get(
            'SELECT * FROM lessons WHERE id = ?',
            [lessonId]
        );
        
        if (!lesson) {
            return res.status(404).json({
                success: false,
                error: 'Урок не найден'
            });
        }
        
        const solution = lesson.solution;
        const userCode = code.trim();
        
        // Простая проверка решения (в реальном приложении нужна более сложная логика)
        const isCorrect = userCode.includes(solution) || solution.includes(userCode);
        
        if (isCorrect) {
            // Отмечаем урок как выполненный
            const user = await db.get(
                'SELECT * FROM users WHERE id = ?',
                [userId]
            );
            
            let completedLessons = JSON.parse(user.completed_lessons || '[]');
            if (!completedLessons.includes(parseInt(lessonId))) {
                completedLessons.push(parseInt(lessonId));
                
                // Начисляем награды
                const rewards = JSON.parse(lesson.rewards || '{}');
                const xp = rewards.xp || 100;
                const coins = rewards.coins || 50;
                
                let newExperience = user.experience + xp;
                let newLevel = user.level;
                let newCoins = user.coins + coins;
                
                // Проверяем повышение уровня
                const xpPerLevel = 100;
                while (newExperience >= newLevel * xpPerLevel) {
                    newExperience -= newLevel * xpPerLevel;
                    newLevel++;
                }
                
                // Применяем эффект к ферме
                const farmEffect = JSON.parse(lesson.farm_effect || '{}');
                let farmState = JSON.parse(user.farm_state || '{}');
                
                switch (farmEffect.action) {
                    case 'clear_grass':
                        farmState.grass = Math.max(0, farmState.grass - (farmEffect.amount || 50));
                        break;
                    case 'plant_seeds':
                        farmState.seed_count = (farmState.seed_count || 0) + (farmEffect.count || 10);
                        farmState.elements.push({
                            type: 'seed',
                            plant_type: farmEffect.plant_type || 'Растение',
                            count: farmEffect.count || 10,
                            planted_at: new Date().toISOString()
                        });
                        break;
                    case 'build_fence':
                        farmState.has_fence = true;
                        farmState.elements.push({
                            type: 'fence',
                            length: farmEffect.length || 50,
                            built_at: new Date().toISOString()
                        });
                        break;
                    case 'plow_field':
                        farmState.field_plowed = true;
                        farmState.elements.push({
                            type: 'field',
                            area: farmEffect.area || 100,
                            plowed_at: new Date().toISOString()
                        });
                        break;
                    case 'build_house':
                        farmState.has_house = true;
                        farmState.elements.push({
                            type: 'house',
                            size: farmEffect.size || 'medium',
                            built_at: new Date().toISOString()
                        });
                        break;
                }
                
                // Обновляем пользователя
                await db.run(
                    `UPDATE users SET 
                        level = ?,
                        experience = ?,
                        coins = ?,
                        completed_lessons = ?,
                        farm_state = ?,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [newLevel, newExperience, newCoins, JSON.stringify(completedLessons), JSON.stringify(farmState), userId]
                );
                
                // Обновляем прогресс
                await db.run(
                    `UPDATE user_progress SET 
                        status = 'completed',
                        completed_at = CURRENT_TIMESTAMP,
                        score = 100,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE user_id = ? AND lesson_id = ?`,
                    [userId, lessonId]
                );
                
                // Проверяем достижения
                await checkAchievements(userId, newLevel, completedLessons.length, farmState);
                
                // Создаем уведомление
                await db.run(
                    `INSERT INTO notifications 
                    (user_id, type, title, message, related_id, related_type) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        userId,
                        'lesson_completed',
                        'Урок выполнен! 🎉',
                        `Поздравляем! Вы завершили урок "${lesson.title}". Получено: ${xp} опыта, ${coins} монет.`,
                        lessonId,
                        'lesson'
                    ]
                );
                
                // Добавляем эффект фермы в уведомление
                if (farmEffect.message) {
                    await db.run(
                        `INSERT INTO notifications 
                        (user_id, type, title, message, related_id, related_type) 
                        VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            userId,
                            'farm_update',
                            'Ферма обновлена! 🚜',
                            farmEffect.message,
                            lessonId,
                            'lesson'
                        ]
                    );
                }
                
                // Получаем обновленного пользователя
                const updatedUser = await db.get(
                    `SELECT id, email, username, full_name, role, level, experience, coins,
                            completed_lessons, farm_state, avatar_url
                     FROM users WHERE id = ?`,
                    [userId]
                );
                
                res.json({
                    success: true,
                    message: '🎉 Поздравляем! Урок выполнен успешно!',
                    data: {
                        is_correct: true,
                        user: {
                            ...updatedUser,
                            completed_lessons: JSON.parse(updatedUser.completed_lessons || '[]'),
                            farm_state: JSON.parse(updatedUser.farm_state || '{}')
                        },
                        rewards: {
                            xp: xp,
                            coins: coins,
                            level_up: newLevel > user.level
                        },
                        farm_effect: farmEffect
                    }
                });
            } else {
                res.json({
                    success: true,
                    message: 'Урок уже был выполнен ранее',
                    data: {
                        is_correct: true,
                        already_completed: true
                    }
                });
            }
        } else {
            res.json({
                success: false,
                message: 'Решение неверное. Попробуйте еще раз!',
                data: {
                    is_correct: false,
                    hint: 'Проверьте правильность написания кода. Убедитесь, что вы следуете инструкциям из урока.'
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка проверки решения:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки решения'
        });
    }
});

// ==================== ФЕРМА ====================

// Получение состояния фермы
app.get('/api/farm', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        
        const user = await db.get(
            'SELECT farm_state, level, experience, coins FROM users WHERE id = ?',
            [userId]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const farmState = JSON.parse(user.farm_state || '{}');
        
        // Дополнительная логика для генерации фермы
        const farmElements = generateFarmElements(farmState, user.level);
        
        res.json({
            success: true,
            data: {
                farm: {
                    ...farmState,
                    elements: farmElements
                },
                stats: {
                    level: user.level,
                    experience: user.experience,
                    coins: user.coins,
                    experience_needed: user.level * 100,
                    level_progress: user.experience % 100
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения состояния фермы:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения состояния фермы'
        });
    }
});

// Функция генерации элементов фермы
function generateFarmElements(farmState, level) {
    const elements = [...(farmState.elements || [])];
    
    // Генерация травы
    if (farmState.grass > 0) {
        const grassCount = Math.floor((farmState.grass / 100) * 50);
        for (let i = 0; i < grassCount; i++) {
            elements.push({
                type: 'grass',
                id: `grass-${i}`,
                x: Math.random() * 90 + 5,
                y: Math.random() * 80 + 10,
                size: Math.random() * 20 + 10
            });
        }
    }
    
    // Добавляем семена если есть
    if (farmState.seed_count > 0) {
        const seedCount = Math.min(farmState.seed_count, 20);
        for (let i = 0; i < seedCount; i++) {
            elements.push({
                type: 'seed',
                id: `seed-${i}`,
                x: Math.random() * 80 + 10,
                y: Math.random() * 70 + 15,
                plant_type: farmState.plant_type || 'Пшеница'
            });
        }
    }
    
    // Добавляем забор если есть
    if (farmState.has_fence) {
        elements.push({
            type: 'fence',
            id: 'fence-main',
            length: 50,
            x: 20,
            y: 20
        });
    }
    
    // Добавляем поле если вспахано
    if (farmState.field_plowed) {
        elements.push({
            type: 'field',
            id: 'field-main',
            area: 100,
            x: 50,
            y: 60
        });
    }
    
    // Добавляем дом если построен
    if (farmState.has_house) {
        elements.push({
            type: 'house',
            id: 'house-main',
            size: 'medium',
            x: 70,
            y: 30
        });
    }
    
    // Добавляем солнце и облака
    elements.push({
        type: 'sun',
        id: 'sun',
        x: 85,
        y: 10
    });
    
    // Добавляем облака
    for (let i = 0; i < 3; i++) {
        elements.push({
            type: 'cloud',
            id: `cloud-${i}`,
            x: 10 + i * 30,
            y: 15 + Math.random() * 10
        });
    }
    
    return elements;
}

// Обновление фермы (интерактивные действия)
app.post('/api/farm/action', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { action, data } = req.body;
        
        const user = await db.get(
            'SELECT farm_state, coins FROM users WHERE id = ?',
            [userId]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        let farmState = JSON.parse(user.farm_state || '{}');
        let message = '';
        let coinsChange = 0;
        
        switch (action) {
            case 'clear_grass':
                if (farmState.grass > 0) {
                    const amount = Math.min(data?.amount || 10, farmState.grass);
                    farmState.grass -= amount;
                    coinsChange = Math.floor(amount / 2);
                    message = `Вы скосили ${amount}% травы и заработали ${coinsChange} монет!`;
                }
                break;
                
            case 'plant_seed':
                if (user.coins >= 10) {
                    farmState.seed_count = (farmState.seed_count || 0) + 1;
                    coinsChange = -10;
                    message = 'Вы посадили семя за 10 монет!';
                } else {
                    return res.status(400).json({
                        success: false,
                        error: 'Недостаточно монет для посадки семени'
                    });
                }
                break;
                
            case 'collect_coins':
                coinsChange = Math.floor(Math.random() * 10) + 5;
                message = `Вы нашли ${coinsChange} монет на ферме!`;
                break;
                
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Неизвестное действие'
                });
        }
        
        // Обновляем состояние фермы и монеты
        await db.run(
            `UPDATE users SET 
                farm_state = ?,
                coins = coins + ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [JSON.stringify(farmState), coinsChange, userId]
        );
        
        // Создаем уведомление
        if (message) {
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message) 
                VALUES (?, ?, ?, ?)`,
                [
                    userId,
                    'farm_action',
                    'Действие на ферме',
                    message
                ]
            );
        }
        
        // Получаем обновленного пользователя
        const updatedUser = await db.get(
            'SELECT farm_state, coins FROM users WHERE id = ?',
            [userId]
        );
        
        res.json({
            success: true,
            message: message || 'Действие выполнено',
            data: {
                farm_state: JSON.parse(updatedUser.farm_state || '{}'),
                coins_change: coinsChange,
                new_balance: updatedUser.coins
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка выполнения действия на ферме:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка выполнения действия на ферме'
        });
    }
});

// ==================== ДОСТИЖЕНИЯ ====================

// Получение всех достижений
app.get('/api/achievements', async (req, res) => {
    try {
        const achievements = await db.all(
            'SELECT * FROM achievements WHERE is_active = 1 ORDER BY id ASC'
        );
        
        const achievementsWithParsedData = achievements.map(achievement => ({
            ...achievement,
            rewards: JSON.parse(achievement.rewards || '{}')
        }));
        
        res.json({
            success: true,
            data: {
                achievements: achievementsWithParsedData,
                count: achievements.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения достижений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения достижений'
        });
    }
});

// Получение достижений пользователя
app.get('/api/user/achievements', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        
        const achievements = await db.all(`
            SELECT a.*, ua.unlocked_at
            FROM achievements a
            LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = ?
            WHERE a.is_active = 1
            ORDER BY a.id ASC
        `, [userId]);
        
        const achievementsWithParsedData = achievements.map(achievement => ({
            ...achievement,
            rewards: JSON.parse(achievement.rewards || '{}'),
            unlocked: !!achievement.unlocked_at
        }));
        
        // Группируем по статусу
        const unlocked = achievementsWithParsedData.filter(a => a.unlocked);
        const locked = achievementsWithParsedData.filter(a => !a.unlocked);
        
        res.json({
            success: true,
            data: {
                achievements: achievementsWithParsedData,
                unlocked: unlocked,
                locked: locked,
                stats: {
                    total: achievementsWithParsedData.length,
                    unlocked: unlocked.length,
                    locked: locked.length,
                    progress: achievementsWithParsedData.length > 0 ? Math.round((unlocked.length / achievementsWithParsedData.length) * 100) : 0
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения достижений пользователя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения достижений'
        });
    }
});

// Функция проверки и начисления достижений
async function checkAchievements(userId, level, completedLessonsCount, farmState) {
    try {
        // Получаем все достижения
        const achievements = await db.all(
            'SELECT * FROM achievements WHERE is_active = 1'
        );
        
        for (const achievement of achievements) {
            // Проверяем, есть ли уже это достижение у пользователя
            const existing = await db.get(
                'SELECT 1 FROM user_achievements WHERE user_id = ? AND achievement_id = ?',
                [userId, achievement.id]
            );
            
            if (!existing) {
                let conditionMet = false;
                const condition = achievement.condition;
                
                // Проверяем условия
                if (condition.startsWith('level >= ')) {
                    const requiredLevel = parseInt(condition.split('level >= ')[1]);
                    conditionMet = level >= requiredLevel;
                } else if (condition.startsWith('completed_lessons >= ')) {
                    const requiredLessons = parseInt(condition.split('completed_lessons >= ')[1]);
                    conditionMet = completedLessonsCount >= requiredLessons;
                } else if (condition.startsWith('lesson_completed:')) {
                    const requiredLesson = parseInt(condition.split('lesson_completed:')[1]);
                    conditionMet = false; // Нужно проверить историю уроков
                }
                
                if (conditionMet) {
                    // Начисляем достижение
                    await db.run(
                        'INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?)',
                        [userId, achievement.id]
                    );
                    
                    // Начисляем награды
                    const rewards = JSON.parse(achievement.rewards || '{}');
                    const xp = rewards.xp || 50;
                    const coins = rewards.coins || 25;
                    
                    await db.run(
                        `UPDATE users SET 
                            experience = experience + ?,
                            coins = coins + ?,
                            updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        [xp, coins, userId]
                    );
                    
                    // Создаем уведомление
                    await db.run(
                        `INSERT INTO notifications 
                        (user_id, type, title, message, related_id, related_type) 
                        VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            userId,
                            'achievement_unlocked',
                            'Новое достижение! 🏆',
                            `Поздравляем! Вы получили достижение "${achievement.title}". Награда: ${xp} опыта, ${coins} монет.`,
                            achievement.id,
                            'achievement'
                        ]
                    );
                    
                    console.log(`✅ Пользователь ${userId} получил достижение: ${achievement.title}`);
                }
            }
        }
    } catch (error) {
        console.error('❌ Ошибка проверки достижений:', error.message);
    }
}

// ==================== ПРОГРЕСС И СТАТИСТИКА ====================

// Получение прогресса пользователя
app.get('/api/user/progress', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Получаем пользователя
        const user = await db.get(
            `SELECT id, level, experience, coins, completed_lessons, created_at
             FROM users WHERE id = ?`,
            [userId]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const completedLessons = JSON.parse(user.completed_lessons || '[]');
        
        // Получаем все уроки
        const totalLessons = await db.get('SELECT COUNT(*) as count FROM lessons WHERE is_active = 1');
        const lessonsCount = totalLessons?.count || 0;
        
        // Получаем детальный прогресс
        const progressDetails = await db.all(`
            SELECT l.*, up.status, up.completed_at, up.score
            FROM lessons l
            LEFT JOIN user_progress up ON l.id = up.lesson_id AND up.user_id = ?
            WHERE l.is_active = 1
            ORDER BY l.order_index ASC
        `, [userId]);
        
        // Рассчитываем статистику
        const completed = progressDetails.filter(p => p.status === 'completed').length;
        const inProgress = progressDetails.filter(p => p.status === 'started').length;
        const notStarted = progressDetails.filter(p => !p.status || p.status === 'not_started').length;
        
        // Рассчитываем общий прогресс
        const totalProgress = lessonsCount > 0 ? Math.round((completed / lessonsCount) * 100) : 0;
        
        // Получаем время обучения
        const learningTime = await db.get(`
            SELECT SUM(l.duration_minutes) as total_minutes
            FROM user_progress up
            JOIN lessons l ON up.lesson_id = l.id
            WHERE up.user_id = ? AND up.status = 'completed'
        `, [userId]);
        
        // Получаем последние достижения
        const recentAchievements = await db.all(`
            SELECT a.title, a.description, a.icon, ua.unlocked_at
            FROM user_achievements ua
            JOIN achievements a ON ua.achievement_id = a.id
            WHERE ua.user_id = ?
            ORDER BY ua.unlocked_at DESC
            LIMIT 5
        `, [userId]);
        
        res.json({
            success: true,
            data: {
                overall: {
                    level: user.level,
                    experience: user.experience,
                    coins: user.coins,
                    total_progress: totalProgress,
                    completed_lessons: completed,
                    total_lessons: lessonsCount,
                    learning_time_minutes: learningTime?.total_minutes || 0
                },
                breakdown: {
                    completed: completed,
                    in_progress: inProgress,
                    not_started: notStarted
                },
                progress_details: progressDetails.map(lesson => ({
                    ...lesson,
                    requirements: JSON.parse(lesson.requirements || '[]'),
                    farm_effect: JSON.parse(lesson.farm_effect || '{}'),
                    rewards: JSON.parse(lesson.rewards || '{}'),
                    is_completed: lesson.status === 'completed',
                    is_started: lesson.status === 'started'
                })),
                recent_achievements: recentAchievements,
                stats_by_difficulty: {
                    easy: progressDetails.filter(p => p.difficulty === 'easy' && p.status === 'completed').length,
                    medium: progressDetails.filter(p => p.difficulty === 'medium' && p.status === 'completed').length,
                    hard: progressDetails.filter(p => p.difficulty === 'hard' && p.status === 'completed').length
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения прогресса:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения прогресса'
        });
    }
});

// Получение истории выполнения кода
app.get('/api/user/code-history', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 20 } = req.query;
        
        const codeHistory = await db.all(`
            SELECT cs.*, l.title as lesson_title
            FROM code_sessions cs
            LEFT JOIN lessons l ON cs.lesson_id = l.id
            WHERE cs.user_id = ?
            ORDER BY cs.created_at DESC
            LIMIT ?
        `, [userId, parseInt(limit)]);
        
        res.json({
            success: true,
            data: {
                history: codeHistory,
                count: codeHistory.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения истории кода:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения истории'
        });
    }
});

// ==================== УВЕДОМЛЕНИЯ ====================

// Получение уведомлений пользователя
app.get('/api/notifications', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { unread_only, limit = 20 } = req.query;
        
        let query = `
            SELECT *
            FROM notifications
            WHERE user_id = ?
        `;
        
        const params = [userId];
        
        if (unread_only === 'true') {
            query += ' AND is_read = 0';
        }
        
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const notifications = await db.all(query, params);
        
        // Помечаем как прочитанные если запрошены все
        if (unread_only !== 'true') {
            await db.run(
                `UPDATE notifications 
                 SET is_read = 1, read_at = CURRENT_TIMESTAMP 
                 WHERE user_id = ? AND is_read = 0`,
                [userId]
            );
        }
        
        res.json({
            success: true,
            data: {
                notifications: notifications,
                count: notifications.length,
                unread_count: unread_only !== 'true' ? 0 : notifications.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения уведомлений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения уведомлений'
        });
    }
});

// Пометить уведомление как прочитанное
app.put('/api/notifications/:id/read', authMiddleware(), async (req, res) => {
    try {
        const notificationId = req.params.id;
        const userId = req.user.id;
        
        await db.run(
            `UPDATE notifications 
             SET is_read = 1, read_at = CURRENT_TIMESTAMP 
             WHERE id = ? AND user_id = ?`,
            [notificationId, userId]
        );
        
        res.json({
            success: true,
            message: 'Уведомление помечено как прочитанное'
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления уведомления:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления уведомления'
        });
    }
});

// Очистить все уведомления
app.delete('/api/notifications/clear', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        
        await db.run(
            'DELETE FROM notifications WHERE user_id = ?',
            [userId]
        );
        
        res.json({
            success: true,
            message: 'Все уведомления очищены'
        });
        
    } catch (error) {
        console.error('❌ Ошибка очистки уведомлений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка очистки уведомлений'
        });
    }
});

// ==================== АДМИН ФУНКЦИОНАЛ ====================

// Вход администратора
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log('👑 Попытка входа администратора:', { email });
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Укажите email и пароль'
            });
        }
        
        const user = await db.get(
            `SELECT * FROM users WHERE email = ? AND role IN ('admin', 'teacher')`,
            [email]
        );
        
        if (!user) {
            console.log(`❌ Админ с email ${email} не найден`);
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден или недостаточно прав'
            });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            console.log(`❌ Неверный пароль для email ${email}`);
            return res.status(401).json({
                success: false,
                error: 'Неверный пароль'
            });
        }
        
        await db.run(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        const userForResponse = {
            id: user.id,
            email: user.email,
            username: user.username,
            full_name: user.full_name,
            role: user.role,
            avatar_url: user.avatar_url
        };
        
        const token = jwt.sign(
            { 
                id: user.id, 
                role: user.role,
                email: user.email,
                is_admin: true
            },
            process.env.JWT_SECRET || 'itfarm-secret-key-2024',
            { expiresIn: '30d' }
        );
        
        console.log(`✅ Успешный вход администратора: ${user.full_name} (${user.email})`);
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: { 
                user: userForResponse,
                token 
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка входа администратора:', error.message);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при входе'
        });
    }
});

// Статистика системы (админ)
app.get('/api/admin/stats', authMiddleware(['admin', 'teacher']), async (req, res) => {
    try {
        // 1. Статистика пользователей
        const usersStats = await db.get(`
            SELECT 
                COUNT(*) as total_users,
                SUM(CASE WHEN role = 'student' THEN 1 ELSE 0 END) as students,
                SUM(CASE WHEN role = 'teacher' THEN 1 ELSE 0 END) as teachers,
                SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_users,
                SUM(CASE WHEN email_verified = 1 THEN 1 ELSE 0 END) as verified_users,
                SUM(CASE WHEN DATE(created_at) = DATE('now') THEN 1 ELSE 0 END) as new_users_today,
                AVG(level) as avg_level,
                AVG(experience) as avg_experience,
                SUM(coins) as total_coins
            FROM users
        `);
        
        // 2. Статистика уроков
        const lessonsStats = await db.get(`
            SELECT 
                COUNT(*) as total_lessons,
                SUM(CASE WHEN difficulty = 'easy' THEN 1 ELSE 0 END) as easy_lessons,
                SUM(CASE WHEN difficulty = 'medium' THEN 1 ELSE 0 END) as medium_lessons,
                SUM(CASE WHEN difficulty = 'hard' THEN 1 ELSE 0 END) as hard_lessons,
                SUM(duration_minutes) as total_duration_minutes
            FROM lessons
            WHERE is_active = 1
        `);
        
        // 3. Статистика прогресса
        const progressStats = await db.get(`
            SELECT 
                COUNT(*) as total_progress_records,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_lessons,
                SUM(CASE WHEN status = 'started' THEN 1 ELSE 0 END) as started_lessons,
                AVG(score) as avg_score,
                COUNT(DISTINCT user_id) as active_learners
            FROM user_progress
        `);
        
        // 4. Популярные уроки
        const popularLessons = await db.all(`
            SELECT 
                l.id,
                l.title,
                l.difficulty,
                COUNT(up.id) as completions,
                AVG(up.score) as avg_score
            FROM lessons l
            LEFT JOIN user_progress up ON l.id = up.lesson_id AND up.status = 'completed'
            GROUP BY l.id
            ORDER BY completions DESC
            LIMIT 5
        `);
        
        // 5. Активные пользователи
        const activeUsers = await db.all(`
            SELECT 
                u.id,
                u.username,
                u.full_name,
                u.level,
                u.experience,
                COUNT(up.id) as completed_lessons,
                MAX(up.completed_at) as last_completion
            FROM users u
            LEFT JOIN user_progress up ON u.id = up.user_id AND up.status = 'completed'
            WHERE u.role = 'student'
            GROUP BY u.id
            ORDER BY completed_lessons DESC
            LIMIT 10
        `);
        
        // 6. Достижения статистика
        const achievementsStats = await db.get(`
            SELECT 
                COUNT(*) as total_achievements,
                COUNT(DISTINCT ua.user_id) as users_with_achievements,
                SUM(CASE WHEN DATE(ua.unlocked_at) = DATE('now') THEN 1 ELSE 0 END) as unlocked_today
            FROM achievements a
            LEFT JOIN user_achievements ua ON a.id = ua.achievement_id
            WHERE a.is_active = 1
        `);
        
        res.json({
            success: true,
            data: {
                users: usersStats,
                lessons: lessonsStats,
                progress: progressStats,
                achievements: achievementsStats,
                popular_lessons: popularLessons,
                active_users: activeUsers,
                system_info: {
                    demo_mode: DEMO_MODE,
                    total_tables: 8, // Количество таблиц в базе
                    server_time: new Date().toISOString(),
                    uptime: process.uptime()
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики системы:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики системы'
        });
    }
});

// Управление уроками (админ)
app.get('/api/admin/lessons', authMiddleware(['admin', 'teacher']), async (req, res) => {
    try {
        const lessons = await db.all(`
            SELECT l.*,
                   (SELECT COUNT(*) FROM user_progress up WHERE up.lesson_id = l.id AND up.status = 'completed') as completions,
                   (SELECT AVG(score) FROM user_progress up WHERE up.lesson_id = l.id AND up.status = 'completed') as avg_score
            FROM lessons l
            ORDER BY l.order_index ASC
        `);
        
        const lessonsWithParsedData = lessons.map(lesson => ({
            ...lesson,
            requirements: JSON.parse(lesson.requirements || '[]'),
            farm_effect: JSON.parse(lesson.farm_effect || '{}'),
            rewards: JSON.parse(lesson.rewards || '{}')
        }));
        
        res.json({
            success: true,
            data: {
                lessons: lessonsWithParsedData,
                count: lessons.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения уроков (админ):', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения уроков'
        });
    }
});

// Создание/обновление урока (админ)
app.post('/api/admin/lessons', authMiddleware(['admin', 'teacher']), async (req, res) => {
    try {
        const { 
            id, 
            title, 
            description, 
            content, 
            task_description, 
            task_code,
            solution,
            icon,
            difficulty,
            duration_minutes,
            order_index,
            requirements,
            farm_effect,
            rewards,
            is_active
        } = req.body;
        
        console.log('📝 Сохранение урока:', { id, title });
        
        if (!title || !description || !content || !task_description || !task_code || !solution) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все обязательные поля'
            });
        }
        
        const lessonData = {
            title,
            description,
            content,
            task_description,
            task_code,
            solution,
            icon: icon || 'fas fa-code',
            difficulty: difficulty || 'easy',
            duration_minutes: duration_minutes || 15,
            order_index: order_index || 0,
            requirements: JSON.stringify(requirements || []),
            farm_effect: JSON.stringify(farm_effect || {}),
            rewards: JSON.stringify(rewards || { xp: 100, coins: 50 }),
            is_active: is_active ? 1 : 0
        };
        
        if (id) {
            // Обновление существующего урока
            await db.run(
                `UPDATE lessons SET 
                    title = ?,
                    description = ?,
                    content = ?,
                    task_description = ?,
                    task_code = ?,
                    solution = ?,
                    icon = ?,
                    difficulty = ?,
                    duration_minutes = ?,
                    order_index = ?,
                    requirements = ?,
                    farm_effect = ?,
                    rewards = ?,
                    is_active = ?,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [
                    lessonData.title,
                    lessonData.description,
                    lessonData.content,
                    lessonData.task_description,
                    lessonData.task_code,
                    lessonData.solution,
                    lessonData.icon,
                    lessonData.difficulty,
                    lessonData.duration_minutes,
                    lessonData.order_index,
                    lessonData.requirements,
                    lessonData.farm_effect,
                    lessonData.rewards,
                    lessonData.is_active,
                    id
                ]
            );
            
            const lesson = await db.get('SELECT * FROM lessons WHERE id = ?', [id]);
            
            res.json({
                success: true,
                message: 'Урок успешно обновлен',
                data: { 
                    lesson: {
                        ...lesson,
                        requirements: JSON.parse(lesson.requirements || '[]'),
                        farm_effect: JSON.parse(lesson.farm_effect || '{}'),
                        rewards: JSON.parse(lesson.rewards || '{}')
                    }
                }
            });
        } else {
            // Создание нового урока
            const result = await db.run(
                `INSERT INTO lessons 
                (title, description, content, task_description, task_code, solution,
                 icon, difficulty, duration_minutes, order_index, requirements,
                 farm_effect, rewards, is_active) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    lessonData.title,
                    lessonData.description,
                    lessonData.content,
                    lessonData.task_description,
                    lessonData.task_code,
                    lessonData.solution,
                    lessonData.icon,
                    lessonData.difficulty,
                    lessonData.duration_minutes,
                    lessonData.order_index,
                    lessonData.requirements,
                    lessonData.farm_effect,
                    lessonData.rewards,
                    lessonData.is_active
                ]
            );
            
            const lessonId = result.lastID;
            const lesson = await db.get('SELECT * FROM lessons WHERE id = ?', [lessonId]);
            
            res.status(201).json({
                success: true,
                message: 'Урок успешно создан',
                data: { 
                    lesson: {
                        ...lesson,
                        requirements: JSON.parse(lesson.requirements || '[]'),
                        farm_effect: JSON.parse(lesson.farm_effect || '{}'),
                        rewards: JSON.parse(lesson.rewards || '{}')
                    }
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка сохранения урока:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения урока: ' + error.message
        });
    }
});

// ==================== ДОПОЛНИТЕЛЬНЫЕ ФУНКЦИИ ====================

// Получение лидерборда
app.get('/api/leaderboard', async (req, res) => {
    try {
        const { type = 'level', limit = 10 } = req.query;
        
        let orderBy = 'level DESC, experience DESC';
        if (type === 'coins') {
            orderBy = 'coins DESC';
        } else if (type === 'lessons') {
            // Для количества уроков нужен более сложный запрос
            orderBy = 'completed_count DESC';
        }
        
        const leaderboard = await db.all(`
            SELECT 
                u.id,
                u.username,
                u.full_name,
                u.avatar_url,
                u.level,
                u.experience,
                u.coins,
                (SELECT COUNT(*) FROM user_progress up WHERE up.user_id = u.id AND up.status = 'completed') as completed_count
            FROM users u
            WHERE u.role = 'student' AND u.is_active = 1
            ORDER BY ${orderBy}
            LIMIT ?
        `, [parseInt(limit)]);
        
        res.json({
            success: true,
            data: {
                leaderboard: leaderboard,
                type: type,
                count: leaderboard.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения лидерборда:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения лидерборда'
        });
    }
});

// Получение следующего урока для пользователя
app.get('/api/next-lesson', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Получаем завершенные уроки пользователя
        const user = await db.get(
            'SELECT completed_lessons FROM users WHERE id = ?',
            [userId]
        );
        
        const completedLessons = JSON.parse(user.completed_lessons || '[]');
        
        // Находим следующий доступный урок
        const nextLesson = await db.get(`
            SELECT l.*
            FROM lessons l
            WHERE l.is_active = 1
              AND l.id NOT IN (${completedLessons.length > 0 ? completedLessons.join(',') : '0'})
              AND (
                l.requirements = '[]' 
                OR json_array_length(l.requirements) = 0
                OR (
                  SELECT COUNT(*) 
                  FROM json_each(l.requirements) 
                  WHERE value IN (${completedLessons.length > 0 ? completedLessons.join(',') : '0'})
                ) = json_array_length(l.requirements)
              )
            ORDER BY l.order_index ASC
            LIMIT 1
        `);
        
        if (nextLesson) {
            const lessonWithParsedData = {
                ...nextLesson,
                requirements: JSON.parse(nextLesson.requirements || '[]'),
                farm_effect: JSON.parse(nextLesson.farm_effect || '{}'),
                rewards: JSON.parse(nextLesson.rewards || '{}')
            };
            
            res.json({
                success: true,
                data: {
                    lesson: lessonWithParsedData,
                    is_next: true
                }
            });
        } else {
            // Все уроки пройдены
            res.json({
                success: true,
                data: {
                    message: '🎉 Поздравляем! Вы завершили все доступные уроки!',
                    all_completed: true
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка получения следующего урока:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения следующего урока'
        });
    }
});

// ==================== ОБРАБОТКА ОШИБОК ====================
app.use((err, req, res, next) => {
    console.error('🔥 Ошибка сервера:', err.message);
    
    res.status(500).json({
        success: false,
        error: 'Внутренняя ошибка сервера',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Обработка 404 для API маршрутов
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'API маршрут не найден'
    });
});

// SPA маршрутизация
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🚜 ЗАПУСК IT FARM - ОБУЧЕНИЕ ПРОГРАММИРОВАНИЮ');
        console.log('='.repeat(80));
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        console.log(`🏷️  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📱 Демо-режим: ${DEMO_MODE ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН'}`);
        console.log(`💾 База данных: ${process.env.NODE_ENV === 'production' ? '/tmp/itfarm_prod.db' : './itfarm.db'}`);
        console.log('='.repeat(80));
        
        // Создаем public директорию если нужно
        if (!fsSync.existsSync('public')) {
            try {
                fsSync.mkdirSync('public', { recursive: true, mode: 0o755 });
                console.log('✅ Создана директория public');
            } catch (error) {
                console.warn('⚠️ Не удалось создать public директорию:', error.message);
            }
        }
        
        // Пытаемся создать uploads директории, но не критично если не получится
        const dirsCreated = ensureUploadDirs();
        
        await initDatabase();
        console.log('✅ База данных готова');
        console.log('✅ 5 интерактивных уроков созданы');
        console.log('✅ Система достижений настроена');
        console.log('✅ Все API настроены');
        
        const PORT = process.env.PORT || 3000;
        const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
        
        app.listen(PORT, HOST, () => {
            console.log('\n' + '='.repeat(80));
            console.log(`✅ Сервер запущен: http://${HOST}:${PORT}`);
            console.log(`🏥 Health check: http://${HOST}:${PORT}/health`);
            console.log('='.repeat(80));
            console.log('🚜 СИСТЕМА ГОТОВА К ОБУЧЕНИЮ!');
            console.log('='.repeat(80));
            
            if (!dirsCreated) {
                console.log('\n⚠️  ВНИМАНИЕ: Директории для загрузки файлов не созданы');
                console.log('ℹ️  Функция загрузки файлов может не работать');
                console.log('🔧 Чтобы исправить, создайте директории вручную:');
                console.log('   mkdir -p public/uploads public/uploads/users public/uploads/logo');
            }
            
            console.log('\n📚 УРОКИ ПРОГРАММИРОВАНИЯ:');
            console.log('='.repeat(70));
            console.log('1. Основы JavaScript: Первая программа');
            console.log('2. Переменные: Хранилища для данных');
            console.log('3. Функции: Автоматизация работы на ферме');
            console.log('4. Условные операторы: Принятие решений');
            console.log('5. Циклы: Массовая обработка');
            console.log('='.repeat(70));
            
            console.log('\n🔑 ТЕСТОВЫЙ АККАУНТ:');
            console.log('='.repeat(50));
            console.log('👨‍🎓 Студент: student@itfarm.test / student123');
            console.log('='.repeat(50));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        console.error('📋 Полная ошибка:', error.stack);
        process.exit(1);
    }
};
// Запуск
startServer();
