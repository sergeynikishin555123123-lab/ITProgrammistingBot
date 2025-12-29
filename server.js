// server.js - ПОЛНЫЙ СЕРВЕР ДЛЯ IT FARM С ТЕЛЕГРАМ БОТОМ
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');

// ==================== TELEGRAM BOT ====================
const TelegramBot = require('node-telegram-bot-api');
let bot;

if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
        bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
        console.log('🤖 Telegram Bot инициализирован');
    } catch (error) {
        console.error('❌ Ошибка инициализации Telegram бота:', error.message);
    }
} else {
    console.log('⚠️ TELEGRAM_BOT_TOKEN не указан, бот отключен');
}

// ==================== ИНИЦИАЛИЗАЦИЯ EXPRESS ====================
const app = express();

// Настройка CORS для SPA
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:8080'],
    credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Статические файлы
app.use(express.static('public'));

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных IT Farm...');
        
        const dbPath = path.join(__dirname, 'itfarm.db');
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        
        // Создание таблиц
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE,
                username TEXT UNIQUE,
                password TEXT NOT NULL,
                full_name TEXT,
                avatar_url TEXT,
                role TEXT DEFAULT 'student',
                level INTEGER DEFAULT 1,
                experience INTEGER DEFAULT 0,
                coins INTEGER DEFAULT 0,
                completed_lessons TEXT DEFAULT '[]',
                farm_state TEXT DEFAULT '{"grass": 100, "elements": []}',
                telegram_id TEXT UNIQUE,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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

        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                lesson_id INTEGER NOT NULL,
                status TEXT DEFAULT 'not_started',
                attempts INTEGER DEFAULT 0,
                code_submissions TEXT DEFAULT '[]',
                completed_at TIMESTAMP,
                score INTEGER,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
                UNIQUE(user_id, lesson_id)
            )
        `);

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

        console.log('✅ Все таблицы созданы');
        
        // Создаем начальные данные
        await createInitialData();
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        throw error;
    }
};

// ==================== НАЧАЛЬНЫЕ ДАННЫЕ ====================
const createInitialData = async () => {
    try {
        console.log('📝 Создание начальных данных...');
        
        // Проверяем есть ли уроки
        const lessonsExist = await db.get("SELECT 1 FROM lessons LIMIT 1");
        if (!lessonsExist) {
            const lessons = [
                {
                    title: "Основы JavaScript: Первая программа",
                    description: "Напишите свой первый код на JavaScript",
                    content: `<h3>🎉 Добро пожаловать в мир программирования!</h3><p>Изучите основы JavaScript.</p>`,
                    task_description: "Используйте console.log() чтобы вывести сообщение 'Трава скошена!'",
                    task_code: `// Ваш код здесь`,
                    solution: "console.log('Трава скошена!');",
                    icon: "fas fa-code",
                    difficulty: "easy",
                    duration_minutes: 10,
                    order_index: 1,
                    requirements: "[]",
                    farm_effect: JSON.stringify({ action: "clear_grass", amount: 50 }),
                    rewards: JSON.stringify({ xp: 100, coins: 50 })
                },
                {
                    title: "Переменные: Хранилища для данных",
                    description: "Создайте переменные для хранения информации",
                    content: `<h3>📦 Переменные в JavaScript</h3><p>Изучите работу с переменными.</p>`,
                    task_description: "Создайте переменную seeds и присвойте ей значение 10",
                    task_code: `// Создайте переменную здесь`,
                    solution: "let seeds = 10;",
                    icon: "fas fa-seedling",
                    difficulty: "easy",
                    duration_minutes: 15,
                    order_index: 2,
                    requirements: JSON.stringify([1]),
                    farm_effect: JSON.stringify({ action: "plant_seeds", count: 10 }),
                    rewards: JSON.stringify({ xp: 150, coins: 75 })
                }
            ];

            for (const lesson of lessons) {
                await db.run(
                    `INSERT INTO lessons 
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
            }
            console.log('✅ Уроки созданы');
        }

        // Тестовый пользователь
        const userExist = await db.get("SELECT 1 FROM users WHERE email = 'test@test.com'");
        if (!userExist) {
            const passwordHash = await bcrypt.hash('123456', 12);
            
            await db.run(
                `INSERT INTO users 
                (email, username, password, full_name, role) 
                VALUES (?, ?, ?, ?, ?)`,
                ['test@test.com', 'testuser', passwordHash, 'Тестовый Пользователь', 'student']
            );
            console.log('✅ Тестовый пользователь создан');
        }

        console.log('🎉 Начальные данные созданы!');
        
    } catch (error) {
        console.error('⚠️ Ошибка создания начальных данных:', error.message);
    }
};

// ==================== TELEGRAM BOT ФУНКЦИИ ====================
if (bot) {
    // Обработчик команды /start
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const firstName = msg.from.first_name;
        
        const options = {
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '🚜 Открыть IT Farm',
                        url: 'http://localhost:3000'
                    }
                ]],
                resize_keyboard: true
            },
            parse_mode: 'HTML'
        };
        
        const message = `👋 Привет, ${firstName}!\n\n` +
                       `Добро пожаловать в <b>IT Farm</b> - платформу для обучения программированию через игру!\n\n` +
                       `🎯 <b>Что вас ждет:</b>\n` +
                       `• Изучение JavaScript с нуля\n` +
                       `• Создание своей цифровой фермы\n` +
                       `• Система достижений и прогресса\n` +
                       `• Интерактивные задания\n\n` +
                       `Нажмите кнопку ниже, чтобы начать обучение:`;
        
        bot.sendMessage(chatId, message, options).catch(error => {
            console.error('Ошибка отправки сообщения в Telegram:', error.message);
        });
    });
    
    // Обработчик обычных сообщений
    bot.on('message', (msg) => {
        if (msg.text && !msg.text.startsWith('/')) {
            const chatId = msg.chat.id;
            
            bot.sendMessage(chatId, 
                'Для начала работы с IT Farm нажмите /start или используйте кнопку ниже:\n\n' +
                '🚜 <a href="http://localhost:3000">Открыть IT Farm</a>',
                { parse_mode: 'HTML' }
            ).catch(error => {
                console.error('Ошибка отправки сообщения:', error.message);
            });
        }
    });
    
    console.log('🤖 Telegram Bot готов к работе. Команда: /start');
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
const validateEmail = (email) => {
    if (!email) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

const authMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        // Пропускаем публичные маршруты
        const publicRoutes = [
            'GET /',
            'GET /health',
            'POST /api/auth/register',
            'POST /api/auth/login',
            'GET /api/lessons',
            'GET /api/lessons/:id'
        ];
        
        const currentRoute = `${req.method} ${req.path}`;
        const isPublicRoute = publicRoutes.some(route => {
            const [method, path] = route.split(' ');
            if (method !== req.method) return false;
            
            if (path.includes(':id')) {
                const pattern = path.replace(':id', '([^/]+)');
                return new RegExp(`^${pattern}$`).test(req.path);
            }
            
            return req.path === path;
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
            
            req.userId = decoded.id;
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

// ==================== API МАРШРУТЫ ====================

// Главная
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🚜 IT Farm API',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth/*',
            lessons: '/api/lessons',
            farm: '/api/farm',
            progress: '/api/user/progress'
        }
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        res.json({
            success: true,
            status: 'OK',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== АУТЕНТИФИКАЦИЯ ====================

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, username, password, full_name } = req.body;
        
        if (!email || !username || !password || !full_name) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все поля'
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
                error: 'Некорректный email'
            });
        }
        
        // Проверяем уникальность
        const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [email]);
        if (existingEmail) {
            return res.status(409).json({
                success: false,
                error: 'Email уже используется'
            });
        }
        
        const existingUsername = await db.get('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUsername) {
            return res.status(409).json({
                success: false,
                error: 'Имя пользователя занято'
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 12);
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=7CB342&color=fff&bold=true`;
        
        const result = await db.run(
            `INSERT INTO users (email, username, password, full_name, avatar_url) 
             VALUES (?, ?, ?, ?, ?)`,
            [email, username, hashedPassword, full_name, avatarUrl]
        );
        
        const userId = result.lastID;
        
        const token = jwt.sign(
            { id: userId, email: email, username: username },
            process.env.JWT_SECRET || 'itfarm-secret-key-2024',
            { expiresIn: '30d' }
        );
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешна!',
            data: { 
                user: {
                    id: userId,
                    email: email,
                    username: username,
                    full_name: full_name,
                    avatar_url: avatarUrl,
                    level: 1,
                    experience: 0,
                    coins: 0
                },
                token
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка регистрации:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка регистрации'
        });
    }
});

// Вход
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Укажите email и пароль'
            });
        }
        
        const user = await db.get(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Неверный пароль'
            });
        }
        
        const token = jwt.sign(
            { 
                id: user.id,
                email: user.email,
                username: user.username
            },
            process.env.JWT_SECRET || 'itfarm-secret-key-2024',
            { expiresIn: '30d' }
        );
        
        const userResponse = {
            id: user.id,
            email: user.email,
            username: user.username,
            full_name: user.full_name,
            avatar_url: user.avatar_url,
            level: user.level,
            experience: user.experience,
            coins: user.coins,
            completed_lessons: JSON.parse(user.completed_lessons || '[]'),
            farm_state: JSON.parse(user.farm_state || '{}')
        };
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: { 
                user: userResponse,
                token 
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка входа:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка входа'
        });
    }
});

// Проверка токена
app.get('/api/auth/check', authMiddleware, async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, username, full_name, avatar_url, level, experience, coins,
                    completed_lessons, farm_state
             FROM users WHERE id = ?`,
            [req.userId]
        );
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const userResponse = {
            ...user,
            completed_lessons: JSON.parse(user.completed_lessons || '[]'),
            farm_state: JSON.parse(user.farm_state || '{}')
        };
        
        res.json({
            success: true,
            data: { user: userResponse }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки токена:', error.message);
        res.status(401).json({
            success: false,
            error: 'Неверный токен'
        });
    }
});

// ==================== УРОКИ ====================

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
            data: { lessons: lessonsWithParsedData }
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

// Запуск кода урока
app.post('/api/lessons/:id/run', authMiddleware, async (req, res) => {
    try {
        const lessonId = req.params.id;
        const userId = req.userId;
        const { code } = req.body;
        
        if (!code || code.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Код не может быть пустым'
            });
        }
        
        // Симуляция выполнения кода
        let output = 'Код выполнен успешно';
        let executionTime = 100;
        
        // Сохраняем прогресс
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
            data: {
                output: output,
                execution_time: executionTime
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка выполнения кода:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка выполнения кода'
        });
    }
});

// Проверка решения урока
app.post('/api/lessons/:id/check', authMiddleware, async (req, res) => {
    try {
        const lessonId = req.params.id;
        const userId = req.userId;
        const { code } = req.body;
        
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
        
        // Простая проверка решения
        const isCorrect = userCode.includes(solution) || solution.includes(userCode);
        
        if (isCorrect) {
            // Получаем пользователя
            const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
            
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
                
                // Обновляем пользователя
                await db.run(
                    `UPDATE users SET 
                        level = ?,
                        experience = ?,
                        coins = ?,
                        completed_lessons = ?,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [newLevel, newExperience, newCoins, JSON.stringify(completedLessons), userId]
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
                
                // Получаем обновленного пользователя
                const updatedUser = await db.get(
                    `SELECT id, email, username, full_name, avatar_url, level, experience, coins,
                            completed_lessons, farm_state
                     FROM users WHERE id = ?`,
                    [userId]
                );
                
                res.json({
                    success: true,
                    message: '🎉 Урок выполнен успешно!',
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
                        }
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
                    is_correct: false
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
app.get('/api/farm', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        
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
        
        // Генерация элементов фермы
        const farmElements = [];
        
        // Добавляем траву
        if (farmState.grass > 0) {
            const grassCount = Math.floor((farmState.grass / 100) * 30);
            for (let i = 0; i < grassCount; i++) {
                farmElements.push({
                    type: 'grass',
                    id: `grass-${i}`,
                    x: Math.random() * 90 + 5,
                    y: Math.random() * 80 + 10,
                    size: Math.random() * 20 + 10
                });
            }
        }
        
        // Добавляем элементы из состояния
        if (farmState.elements && Array.isArray(farmState.elements)) {
            farmElements.push(...farmState.elements);
        }
        
        // Добавляем солнце и облака
        farmElements.push({
            type: 'sun',
            id: 'sun',
            x: 85,
            y: 10
        });
        
        for (let i = 0; i < 2; i++) {
            farmElements.push({
                type: 'cloud',
                id: `cloud-${i}`,
                x: 10 + i * 40,
                y: 15 + Math.random() * 10
            });
        }
        
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

// Обновление фермы
app.post('/api/farm/update', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const { farm_state } = req.body;
        
        await db.run(
            `UPDATE users SET 
                farm_state = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [JSON.stringify(farm_state), userId]
        );
        
        res.json({
            success: true,
            message: 'Ферма обновлена'
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления фермы:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления фермы'
        });
    }
});

// ==================== ПРОГРЕСС ====================

// Получение прогресса пользователя
app.get('/api/user/progress', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        
        const user = await db.get(
            `SELECT level, experience, coins, completed_lessons
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
        const totalLessons = await db.get('SELECT COUNT(*) as count FROM lessons WHERE is_active = 1');
        const lessonsCount = totalLessons?.count || 0;
        
        const totalProgress = lessonsCount > 0 ? Math.round((completedLessons.length / lessonsCount) * 100) : 0;
        
        res.json({
            success: true,
            data: {
                overall: {
                    level: user.level,
                    experience: user.experience,
                    coins: user.coins,
                    total_progress: totalProgress,
                    completed_lessons: completedLessons.length,
                    total_lessons: lessonsCount
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

// ==================== ОБРАБОТКА SPA ====================
// Маршрут для SPA - должен быть последним
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(60));
        console.log('🚜 ЗАПУСК IT FARM С ТЕЛЕГРАМ БОТОМ');
        console.log('='.repeat(60));
        
        // Создаем public директорию если нужно
        if (!fsSync.existsSync('public')) {
            try {
                fsSync.mkdirSync('public', { recursive: true });
                console.log('✅ Создана директория public');
            } catch (error) {
                console.warn('⚠️ Не удалось создать public директорию');
            }
        }
        
        // Проверяем наличие index.html
        if (!fsSync.existsSync(path.join(__dirname, 'public', 'index.html'))) {
            console.warn('⚠️ Файл index.html не найден в public/');
            console.log('ℹ️ Поместите ваш index.html в папку public/');
        }
        
        await initDatabase();
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(60));
            console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
            console.log(`🏥 Health check: http://localhost:${PORT}/health`);
            console.log('='.repeat(60));
            console.log('📚 API эндпоинты:');
            console.log('  POST /api/auth/register - Регистрация');
            console.log('  POST /api/auth/login    - Вход');
            console.log('  GET  /api/lessons       - Все уроки');
            console.log('  GET  /api/farm          - Состояние фермы');
            console.log('='.repeat(60));
            
            if (bot) {
                console.log('🤖 Telegram Bot активен');
                console.log('📱 Команда: /start');
                console.log('🔗 Ссылка: https://t.me/' + (bot.options.username || 'ваш_бот'));
            } else {
                console.log('⚠️ Telegram Bot отключен (укажите TELEGRAM_BOT_TOKEN)');
            }
            console.log('='.repeat(60));
            console.log('🚜 СИСТЕМА ГОТОВА К РАБОТЕ!');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Запуск сервера
startServer();
