require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;
const fsSync = require('fs');

// ДОБАВЬТЕ ЭТУ СТРОКУ ↓
const DOMAIN = process.env.DOMAIN || `http://localhost:${process.env.PORT || 3000}`;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// CORS настройки
const corsOptions = {
    origin: [
        DOMAIN,
        'https://sergeynikishin555123123-lab-itprogrammistingbot-8f42.twc1.net',
        'http://localhost:3000',
        'http://localhost:8080'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Применяем CORS middleware
app.use(cors(corsOptions));

// Обработка preflight запросов
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Статические файлы
// Статические файлы
app.use(express.static('public', {
    setHeaders: (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        
        // Настройки кэширования
        if (ext.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/)) {
            res.set('Cache-Control', 'public, max-age=31536000');
        } else if (ext.match(/\.(css|js)$/)) {
            res.set('Cache-Control', 'public, max-age=86400');
        } else {
            res.set('Cache-Control', 'public, max-age=3600');
        }
        
        // ДОБАВЬТЕ ЭТИ ЗАГОЛОВКИ ДЛЯ БЕЗОПАСНОСТИ ↓
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'DENY');
        res.set('X-XSS-Protection', '1; mode=block');
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET');
        
        // ДОБАВЬТЕ ЭТОТ ЗАГОЛОВОК ДЛЯ SPA ↓
        if (ext === '.html') {
            res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

// ДОБАВЬТЕ ЭТОТ МИДЛВАР ПОСЛЕ СТАТИКИ ↓
app.use((req, res, next) => {
    // Устанавливаем заголовки для API
    if (req.path.startsWith('/api/')) {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    next();
});
// ==================== КОНФИГУРАЦИЯ ====================
const DEMO_MODE = true;

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных AtomicFlow...');
        
        const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/atomicflow.db' : './atomicflow.db';
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        await db.run('PRAGMA foreign_keys = ON');

        // Создание таблиц
        await db.exec('BEGIN TRANSACTION');

        // Пользователи AtomicFlow
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT,
                username TEXT UNIQUE,
                password TEXT NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT,
                avatar_url TEXT,
                phone TEXT,
                phone_verified INTEGER DEFAULT 0,
                role TEXT DEFAULT 'user' CHECK(role IN ('user', 'premium', 'admin')),
                level INTEGER DEFAULT 1,
                coins INTEGER DEFAULT 0,
                streak INTEGER DEFAULT 0,
                balance REAL DEFAULT 0,
                monthly_income REAL DEFAULT 0,
                monthly_expenses REAL DEFAULT 0,
                tasks_completed INTEGER DEFAULT 0,
                habits_streak INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Задачи
        await db.exec(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                tag TEXT DEFAULT '#общее',
                priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
                due_date DATE,
                time TEXT,
                completed INTEGER DEFAULT 0,
                completed_at TIMESTAMP,
                subtasks TEXT,
                pomodoro_sessions INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Привычки
        await db.exec(`
            CREATE TABLE IF NOT EXISTS habits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                icon TEXT DEFAULT 'fas fa-star',
                description TEXT,
                streak INTEGER DEFAULT 0,
                calendar TEXT DEFAULT '[]',
                current_streak INTEGER DEFAULT 0,
                best_streak INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Финансовые операции
        await db.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
                amount REAL NOT NULL,
                category TEXT DEFAULT 'other',
                description TEXT,
                comment TEXT,
                date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Долги (метод снежного кома)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS debts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                amount REAL NOT NULL,
                interest REAL DEFAULT 0,
                priority INTEGER DEFAULT 1,
                paid_amount REAL DEFAULT 0,
                start_date DATE,
                target_date DATE,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Еженедельные ревью
        await db.exec(`
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                week_start DATE NOT NULL,
                week_end DATE NOT NULL,
                important_tasks TEXT,
                improvements TEXT,
                financial_insight TEXT,
                rating INTEGER DEFAULT 5,
                completed INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Достижения
        await db.exec(`
            CREATE TABLE IF NOT EXISTS achievements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Настройки пользователя
        await db.exec(`
            CREATE TABLE IF NOT EXISTS user_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                theme TEXT DEFAULT 'light',
                pomodoro_duration INTEGER DEFAULT 25,
                short_break INTEGER DEFAULT 5,
                long_break INTEGER DEFAULT 15,
                notifications INTEGER DEFAULT 1,
                language TEXT DEFAULT 'ru',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id)
            )
        `);

        await db.exec('COMMIT');
        console.log('✅ Все таблицы AtomicFlow созданы');

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

// ==================== ТЕСТОВЫЕ ДАННЫЕ ====================
const createInitialData = async () => {
    try {
        console.log('📝 Создание начальных данных AtomicFlow...');

        // Проверяем существование тестового пользователя
        const userExist = await db.get("SELECT 1 FROM users WHERE username = 'atomic_user'");
        if (!userExist) {
            const passwordHash = await bcrypt.hash('atomic123', 12);
            
            await db.run(
                `INSERT INTO users 
                (email, username, password, first_name, last_name, avatar_url,
                 role, level, coins, streak, balance, monthly_income, monthly_expenses,
                 tasks_completed, habits_streak, is_active) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    'alex@atomicflow.test',
                    'atomic_user',
                    passwordHash,
                    'Александр',
                    '',
                    '',
                    'user',
                    3,
                    1250,
                    12,
                    15840,
                    32500,
                    17600,
                    87,
                    12,
                    1
                ]
            );
            
            console.log('✅ Тестовый пользователь создан');
        }

        // Проверяем существование тестовых задач
        const tasksExist = await db.get("SELECT 1 FROM tasks LIMIT 1");
        if (!tasksExist) {
            const userId = await db.get("SELECT id FROM users WHERE username = 'atomic_user'");
            
            if (userId) {
                const tasks = [
                    [userId.id, 'Запланировать неделю', 'Составить план на неделю', '#работа', 'medium', null, '10:00', 0],
                    [userId.id, 'Утренняя зарядка', '15 минут упражнений', '#здоровье', 'medium', null, '08:00', 1],
                    [userId.id, 'Купить продукты', 'Список продуктов на неделю', '#дом', 'low', null, '18:00', 0],
                    [userId.id, 'Изучить новый фреймворк', 'Изучить основы нового JS фреймворка', '#учеба', 'high', null, '14:00', 0],
                    [userId.id, 'Заполнить финансовый отчет', 'Отчет за прошлый месяц', '#финансы', 'medium', null, '16:00', 0]
                ];
                
                for (const task of tasks) {
                    await db.run(
                        `INSERT INTO tasks (user_id, title, description, tag, priority, due_date, time, completed)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        task
                    );
                }
                console.log('✅ Тестовые задачи созданы');
            }
        }

        // Проверяем существование тестовых привычек
        const habitsExist = await db.get("SELECT 1 FROM habits LIMIT 1");
        if (!habitsExist) {
            const userId = await db.get("SELECT id FROM users WHERE username = 'atomic_user'");
            
            if (userId) {
                const habits = [
                    [userId.id, 'Пить воду', 'fas fa-tint', 'Выпивать 2 литра воды в день', 12, '[1,1,1,1,1,1,0,1,1,1,1,1,1,0]'],
                    [userId.id, '15 минут уборки', 'fas fa-broom', 'Короткая уборка каждый день', 8, '[1,1,0,1,1,1,1,1,1,0,0,1,1,1]'],
                    [userId.id, 'Чтение 20 мин', 'fas fa-book', 'Чтение перед сном', 5, '[1,0,1,1,0,1,1,1,0,1,0,0,1,1]']
                ];
                
                for (const habit of habits) {
                    await db.run(
                        `INSERT INTO habits (user_id, title, icon, description, streak, calendar)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        habit
                    );
                }
                console.log('✅ Тестовые привычки созданы');
            }
        }

        // Проверяем существование тестовых транзакций
        const transactionsExist = await db.get("SELECT 1 FROM transactions LIMIT 1");
        if (!transactionsExist) {
            const userId = await db.get("SELECT id FROM users WHERE username = 'atomic_user'");
            
            if (userId) {
                const transactions = [
                    [userId.id, 'income', 50000, 'salary', 'Зарплата', 'Оклад за январь'],
                    [userId.id, 'expense', 350, 'food', 'Обед', 'Бизнес-ланч'],
                    [userId.id, 'expense', 1200, 'transport', 'Такси', 'Поездка в аэропорт'],
                    [userId.id, 'expense', 2500, 'entertainment', 'Кино', 'Вечер с друзьями'],
                    [userId.id, 'expense', 1800, 'shopping', 'Книги', 'Новые книги по программированию']
                ];
                
                for (const transaction of transactions) {
                    await db.run(
                        `INSERT INTO transactions (user_id, type, amount, category, description, comment)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        transaction
                    );
                }
                console.log('✅ Тестовые транзакции созданы');
            }
        }

        // Проверяем существование тестовых долгов
        const debtsExist = await db.get("SELECT 1 FROM debts LIMIT 1");
        if (!debtsExist) {
            const userId = await db.get("SELECT id FROM users WHERE username = 'atomic_user'");
            
            if (userId) {
                const debts = [
                    [userId.id, 'Кредитная карта', 45000, 25, 1, 0, '2024-01-01', '2024-12-01'],
                    [userId.id, 'Автокредит', 350000, 12, 2, 50000, '2023-06-01', '2026-06-01']
                ];
                
                for (const debt of debts) {
                    await db.run(
                        `INSERT INTO debts (user_id, title, amount, interest, priority, paid_amount, start_date, target_date)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        debt
                    );
                }
                console.log('✅ Тестовые долги созданы');
            }
        }

        console.log('🎉 Начальные данные AtomicFlow созданы!');
        
    } catch (error) {
        console.error('⚠️ Ошибка создания начальных данных:', error.message);
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
const generateAvatarUrl = (firstName, lastName) => {
    const colors = ['#4361ee', '#f72585', '#4cc9f0', '#4ade80', '#fbbf24'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName)}+${encodeURIComponent(lastName)}&background=${color.replace('#', '')}&color=fff&bold=true`;
};

// ==================== JWT МИДЛВАР ====================
const authMiddleware = () => {
    return async (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;
            
            const publicRoutes = [
                'GET /',
                'GET /health',
                'POST /api/auth/register',
                'POST /api/auth/login',
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
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'atomicflow-secret-key-2024');
                
                const user = await db.get(
                    `SELECT id, email, username, first_name, last_name, avatar_url,
                            role, level, coins, streak, balance, monthly_income, monthly_expenses,
                            tasks_completed, habits_streak, is_active
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
                    first_name: user.first_name,
                    last_name: user.last_name,
                    avatar_url: user.avatar_url,
                    role: user.role,
                    level: user.level,
                    coins: user.coins,
                    streak: user.streak,
                    balance: user.balance,
                    monthly_income: user.monthly_income,
                    monthly_expenses: user.monthly_expenses,
                    tasks_completed: user.tasks_completed,
                    habits_streak: user.habits_streak
                };
                
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
        message: '🚀 Добро пожаловать в AtomicFlow API',
        version: '1.0.0',
        status: '🟢 Работает',
        features: ['Задачи', 'Привычки', 'Финансы', 'Таймер Pomodoro', 'Ревью'],
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1 as status');
        
        res.json({
            success: true,
            status: 'OK',
            database: 'connected',
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
        const { email, username, password, first_name, last_name = '' } = req.body;
        
        console.log('📝 Регистрация пользователя:', { email, username, first_name });
        
        if (!email || !username || !password || !first_name) {
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
        
        const existingUser = await db.get('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким email или именем уже существует'
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 12);
        const avatarUrl = generateAvatarUrl(first_name, last_name);
        
        const result = await db.run(
            `INSERT INTO users 
            (email, username, password, first_name, last_name, avatar_url,
             role, level, coins, streak, balance, monthly_income, monthly_expenses) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email,
                username,
                hashedPassword,
                first_name,
                last_name,
                avatarUrl,
                'user',
                1,
                100,
                0,
                0,
                0,
                0
            ]
        );
        
        const userId = result.lastID;
        
        // Создаем настройки пользователя
        await db.run(
            `INSERT INTO user_settings (user_id) VALUES (?)`,
            [userId]
        );
        
        // Создаем первую достижение
        await db.run(
            `INSERT INTO achievements (user_id, type, title, description) VALUES (?, ?, ?, ?)`,
            [userId, 'welcome', 'Первые шаги', 'Добро пожаловать в AtomicFlow!']
        );
        
        const user = await db.get(
            `SELECT id, email, username, first_name, last_name, avatar_url,
                    role, level, coins, streak, balance, monthly_income, monthly_expenses,
                    tasks_completed, habits_streak
             FROM users WHERE id = ?`,
            [userId]
        );
        
        const token = jwt.sign(
            { 
                id: user.id,
                email: user.email,
                username: user.username,
                first_name: user.first_name
            },
            process.env.JWT_SECRET || 'atomicflow-secret-key-2024',
            { expiresIn: '30d' }
        );
        
        res.status(201).json({
            success: true,
            message: 'Регистрация завершена успешно!',
            data: { 
                user: user,
                token: token
            }
        });
        
    } catch (error) {
        console.error('Ошибка регистрации:', error.message);
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
        
        await db.run(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        const userForResponse = {
            id: user.id,
            email: user.email,
            username: user.username,
            first_name: user.first_name,
            last_name: user.last_name,
            avatar_url: user.avatar_url,
            role: user.role,
            level: user.level,
            coins: user.coins,
            streak: user.streak,
            balance: user.balance,
            monthly_income: user.monthly_income,
            monthly_expenses: user.monthly_expenses,
            tasks_completed: user.tasks_completed,
            habits_streak: user.habits_streak
        };
        
        const token = jwt.sign(
            { 
                id: user.id,
                email: user.email,
                username: user.username,
                first_name: user.first_name
            },
            process.env.JWT_SECRET || 'atomicflow-secret-key-2024',
            { expiresIn: '30d' }
        );
        
        console.log('Успешный вход пользователя:', user.email);
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: { 
                user: userForResponse,
                token 
            }
        });
        
    } catch (error) {
        console.error('Ошибка входа:', error.message);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера при входе'
        });
    }
});

// ==================== ЗАДАЧИ ====================

// Получение задач пользователя
app.get('/api/tasks', authMiddleware(), async (req, res) => {
    try {
        const { completed, tag, date } = req.query;
        
        let query = 'SELECT * FROM tasks WHERE user_id = ?';
        const params = [req.user.id];
        
        if (completed !== undefined) {
            query += ' AND completed = ?';
            params.push(completed === 'true' ? 1 : 0);
        }
        
        if (tag && tag !== 'all') {
            query += ' AND tag = ?';
            params.push(tag);
        }
        
        if (date) {
            query += ' AND DATE(due_date) = ?';
            params.push(date);
        }
        
        query += ' ORDER BY due_date, time ASC';
        
        const tasks = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                tasks,
                count: tasks.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения задач:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// Создание задачи
app.post('/api/tasks', authMiddleware(), async (req, res) => {
    try {
        const { title, description, tag, priority, due_date, time, subtasks } = req.body;
        
        if (!title) {
            return res.status(400).json({
                success: false,
                error: 'Заполните название задачи'
            });
        }
        
        const result = await db.run(
            `INSERT INTO tasks 
            (user_id, title, description, tag, priority, due_date, time, subtasks) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                title,
                description || null,
                tag || '#общее',
                priority || 'medium',
                due_date || null,
                time || null,
                subtasks || null
            ]
        );
        
        const taskId = result.lastID;
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана',
            data: { task }
        });
        
    } catch (error) {
        console.error('Ошибка создания задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания задачи'
        });
    }
});

// Обновление задачи
app.put('/api/tasks/:id', authMiddleware(), async (req, res) => {
    try {
        const taskId = req.params.id;
        const { title, description, tag, priority, due_date, time, completed, subtasks } = req.body;
        
        const task = await db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, req.user.id]);
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        const updateFields = [];
        const updateValues = [];
        
        if (title !== undefined) {
            updateFields.push('title = ?');
            updateValues.push(title);
        }
        
        if (description !== undefined) {
            updateFields.push('description = ?');
            updateValues.push(description);
        }
        
        if (tag !== undefined) {
            updateFields.push('tag = ?');
            updateValues.push(tag);
        }
        
        if (priority !== undefined) {
            updateFields.push('priority = ?');
            updateValues.push(priority);
        }
        
        if (due_date !== undefined) {
            updateFields.push('due_date = ?');
            updateValues.push(due_date);
        }
        
        if (time !== undefined) {
            updateFields.push('time = ?');
            updateValues.push(time);
        }
        
        if (completed !== undefined) {
            updateFields.push('completed = ?');
            updateValues.push(completed ? 1 : 0);
            
            if (completed && !task.completed) {
                updateFields.push('completed_at = CURRENT_TIMESTAMP');
                
                // Начисляем монеты за выполнение задачи
                await db.run(
                    'UPDATE users SET coins = coins + 10, tasks_completed = tasks_completed + 1 WHERE id = ?',
                    [req.user.id]
                );
            }
        }
        
        if (subtasks !== undefined) {
            updateFields.push('subtasks = ?');
            updateValues.push(subtasks);
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Нет данных для обновления'
            });
        }
        
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(taskId);
        
        const query = `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = ?`;
        
        await db.run(query, [...updateValues, taskId]);
        
        const updatedTask = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        
        res.json({
            success: true,
            message: 'Задача успешно обновлена',
            data: { task: updatedTask }
        });
        
    } catch (error) {
        console.error('Ошибка обновления задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления задачи'
        });
    }
});

// Удаление задачи
app.delete('/api/tasks/:id', authMiddleware(), async (req, res) => {
    try {
        const taskId = req.params.id;
        
        const task = await db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, req.user.id]);
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        await db.run('DELETE FROM tasks WHERE id = ?', [taskId]);
        
        res.json({
            success: true,
            message: 'Задача успешно удалена',
            data: { id: taskId }
        });
        
    } catch (error) {
        console.error('Ошибка удаления задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления задачи'
        });
    }
});

// ==================== ПРИВЫЧКИ ====================

// Получение привычек пользователя
app.get('/api/habits', authMiddleware(), async (req, res) => {
    try {
        const habits = await db.all(
            'SELECT * FROM habits WHERE user_id = ? AND is_active = 1 ORDER BY streak DESC',
            [req.user.id]
        );
        
        const habitsWithParsedCalendar = habits.map(habit => ({
            ...habit,
            calendar: JSON.parse(habit.calendar || '[]')
        }));
        
        res.json({
            success: true,
            data: {
                habits: habitsWithParsedCalendar,
                count: habits.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения привычек:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения привычек'
        });
    }
});

// Создание привычки
app.post('/api/habits', authMiddleware(), async (req, res) => {
    try {
        const { title, icon, description } = req.body;
        
        if (!title) {
            return res.status(400).json({
                success: false,
                error: 'Заполните название привычки'
            });
        }
        
        const result = await db.run(
            `INSERT INTO habits (user_id, title, icon, description) 
             VALUES (?, ?, ?, ?)`,
            [
                req.user.id,
                title,
                icon || 'fas fa-star',
                description || null
            ]
        );
        
        const habitId = result.lastID;
        const habit = await db.get('SELECT * FROM habits WHERE id = ?', [habitId]);
        
        res.status(201).json({
            success: true,
            message: 'Привычка успешно создана',
            data: { 
                habit: {
                    ...habit,
                    calendar: JSON.parse(habit.calendar || '[]')
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка создания привычки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания привычки'
        });
    }
});

// Отметка привычки
app.post('/api/habits/:id/mark', authMiddleware(), async (req, res) => {
    try {
        const habitId = req.params.id;
        
        const habit = await db.get('SELECT * FROM habits WHERE id = ? AND user_id = ?', [habitId, req.user.id]);
        if (!habit) {
            return res.status(404).json({
                success: false,
                error: 'Привычка не найдена'
            });
        }
        
        let calendar = JSON.parse(habit.calendar || '[]');
        const today = new Date().toISOString().split('T')[0];
        
        // Проверяем, не отмечена ли уже сегодня
        const lastMarkedIndex = calendar.length - 1;
        if (lastMarkedIndex >= 0 && calendar[lastMarkedIndex] === 1) {
            return res.status(400).json({
                success: false,
                error: 'Привычка уже отмечена на сегодня'
            });
        }
        
        // Добавляем отметку на сегодня
        calendar.push(1);
        
        // Обновляем стрик
        const newStreak = habit.streak + 1;
        const newCurrentStreak = habit.current_streak + 1;
        const newBestStreak = Math.max(habit.best_streak, newCurrentStreak);
        
        await db.run(
            `UPDATE habits SET 
                calendar = ?,
                streak = ?,
                current_streak = ?,
                best_streak = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [JSON.stringify(calendar), newStreak, newCurrentStreak, newBestStreak, habitId]
        );
        
        // Обновляем статистику пользователя
        await db.run(
            'UPDATE users SET coins = coins + 5, streak = ?, habits_streak = ? WHERE id = ?',
            [newStreak, newStreak, req.user.id]
        );
        
        const updatedHabit = await db.get('SELECT * FROM habits WHERE id = ?', [habitId]);
        
        res.json({
            success: true,
            message: 'Привычка успешно отмечена! +5 монет',
            data: { 
                habit: {
                    ...updatedHabit,
                    calendar: JSON.parse(updatedHabit.calendar || '[]')
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка отметки привычки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отметки привычки'
        });
    }
});

// ==================== ФИНАНСЫ ====================

// Получение транзакций
app.get('/api/transactions', authMiddleware(), async (req, res) => {
    try {
        const { type, category, start_date, end_date, limit = 20 } = req.query;
        
        let query = 'SELECT * FROM transactions WHERE user_id = ?';
        const params = [req.user.id];
        
        if (type && type !== 'all') {
            query += ' AND type = ?';
            params.push(type);
        }
        
        if (category && category !== 'all') {
            query += ' AND category = ?';
            params.push(category);
        }
        
        if (start_date) {
            query += ' AND date >= ?';
            params.push(start_date);
        }
        
        if (end_date) {
            query += ' AND date <= ?';
            params.push(end_date);
        }
        
        query += ' ORDER BY date DESC, created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const transactions = await db.all(query, params);
        
        // Пересчитываем баланс
        const income = await db.get(
            'SELECT SUM(amount) as total FROM transactions WHERE user_id = ? AND type = "income"',
            [req.user.id]
        );
        
        const expenses = await db.get(
            'SELECT SUM(amount) as total FROM transactions WHERE user_id = ? AND type = "expense"',
            [req.user.id]
        );
        
        const balance = (income?.total || 0) - (expenses?.total || 0);
        
        // Обновляем баланс пользователя
        await db.run(
            'UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [balance, req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                transactions,
                balance: balance,
                income: income?.total || 0,
                expenses: expenses?.total || 0,
                count: transactions.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения транзакций:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения транзакций'
        });
    }
});

// Создание транзакции
app.post('/api/transactions', authMiddleware(), async (req, res) => {
    try {
        const { type, amount, category, description, comment, date } = req.body;
        
        if (!type || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Заполните тип и сумму транзакции'
            });
        }
        
        const result = await db.run(
            `INSERT INTO transactions 
            (user_id, type, amount, category, description, comment, date) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                type,
                parseFloat(amount),
                category || 'other',
                description || null,
                comment || null,
                date || new Date().toISOString().split('T')[0]
            ]
        );
        
        // Обновляем статистику пользователя
        if (type === 'income') {
            await db.run(
                'UPDATE users SET monthly_income = monthly_income + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [amount, req.user.id]
            );
        } else {
            await db.run(
                'UPDATE users SET monthly_expenses = monthly_expenses + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [amount, req.user.id]
            );
        }
        
        const transactionId = result.lastID;
        const transaction = await db.get('SELECT * FROM transactions WHERE id = ?', [transactionId]);
        
        res.status(201).json({
            success: true,
            message: 'Транзакция успешно добавлена',
            data: { transaction }
        });
        
    } catch (error) {
        console.error('Ошибка создания транзакции:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания транзакции'
        });
    }
});

// ==================== ДОЛГИ ====================

// Получение долгов
app.get('/api/debts', authMiddleware(), async (req, res) => {
    try {
        const debts = await db.all(
            'SELECT * FROM debts WHERE user_id = ? AND is_active = 1 ORDER BY priority, amount ASC',
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                debts,
                total_debt: debts.reduce((sum, debt) => sum + (debt.amount - debt.paid_amount), 0),
                count: debts.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения долгов:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения долгов'
        });
    }
});

// Создание долга
app.post('/api/debts', authMiddleware(), async (req, res) => {
    try {
        const { title, amount, interest, priority, start_date, target_date } = req.body;
        
        if (!title || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Заполните название и сумму долга'
            });
        }
        
        const result = await db.run(
            `INSERT INTO debts 
            (user_id, title, amount, interest, priority, start_date, target_date) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                title,
                parseFloat(amount),
                interest || 0,
                priority || 1,
                start_date || new Date().toISOString().split('T')[0],
                target_date || null
            ]
        );
        
        const debtId = result.lastID;
        const debt = await db.get('SELECT * FROM debts WHERE id = ?', [debtId]);
        
        res.status(201).json({
            success: true,
            message: 'Долг успешно добавлен',
            data: { debt }
        });
        
    } catch (error) {
        console.error('Ошибка создания долга:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания долга'
        });
    }
});

// ==================== РЕВЬЮ ====================

// Получение последних ревью
app.get('/api/reviews', authMiddleware(), async (req, res) => {
    try {
        const reviews = await db.all(
            'SELECT * FROM reviews WHERE user_id = ? ORDER BY week_start DESC LIMIT 5',
            [req.user.id]
        );
        
        const reviewsWithParsedData = reviews.map(review => ({
            ...review,
            important_tasks: JSON.parse(review.important_tasks || '[]'),
            improvements: JSON.parse(review.improvements || '[]')
        }));
        
        res.json({
            success: true,
            data: {
                reviews: reviewsWithParsedData,
                count: reviews.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения ревью:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения ревью'
        });
    }
});

// Создание ревью
app.post('/api/reviews', authMiddleware(), async (req, res) => {
    try {
        const { week_start, week_end, important_tasks, improvements, financial_insight, rating } = req.body;
        
        const today = new Date();
        const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
        const endOfWeek = new Date(today.setDate(today.getDate() - today.getDay() + 6));
        
        const result = await db.run(
            `INSERT INTO reviews 
            (user_id, week_start, week_end, important_tasks, improvements, financial_insight, rating, completed) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                week_start || startOfWeek.toISOString().split('T')[0],
                week_end || endOfWeek.toISOString().split('T')[0],
                JSON.stringify(important_tasks || []),
                JSON.stringify(improvements || []),
                financial_insight || '',
                rating || 5,
                1
            ]
        );
        
        // Начисляем монеты за завершение ревью
        await db.run(
            'UPDATE users SET coins = coins + 50 WHERE id = ?',
            [req.user.id]
        );
        
        const reviewId = result.lastID;
        const review = await db.get('SELECT * FROM reviews WHERE id = ?', [reviewId]);
        
        res.status(201).json({
            success: true,
            message: 'Еженедельное ревью успешно завершено! +50 монет',
            data: { 
                review: {
                    ...review,
                    important_tasks: JSON.parse(review.important_tasks || '[]'),
                    improvements: JSON.parse(review.improvements || '[]')
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка создания ревью:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания ревью'
        });
    }
});

// ==================== ДОСТИЖЕНИЯ ====================

// Получение достижений
app.get('/api/achievements', authMiddleware(), async (req, res) => {
    try {
        const achievements = await db.all(
            'SELECT * FROM achievements WHERE user_id = ? ORDER BY earned_at DESC',
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                achievements,
                count: achievements.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения достижений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения достижений'
        });
    }
});

// ==================== НАСТРОЙКИ ====================

// Получение настроек
app.get('/api/settings', authMiddleware(), async (req, res) => {
    try {
        const settings = await db.get(
            'SELECT * FROM user_settings WHERE user_id = ?',
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: { settings }
        });
        
    } catch (error) {
        console.error('Ошибка получения настроек:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения настроек'
        });
    }
});

// Обновление настроек
app.put('/api/settings', authMiddleware(), async (req, res) => {
    try {
        const { theme, pomodoro_duration, short_break, long_break, notifications, language } = req.body;
        
        const updateFields = [];
        const updateValues = [];
        
        if (theme !== undefined) {
            updateFields.push('theme = ?');
            updateValues.push(theme);
        }
        
        if (pomodoro_duration !== undefined) {
            updateFields.push('pomodoro_duration = ?');
            updateValues.push(pomodoro_duration);
        }
        
        if (short_break !== undefined) {
            updateFields.push('short_break = ?');
            updateValues.push(short_break);
        }
        
        if (long_break !== undefined) {
            updateFields.push('long_break = ?');
            updateValues.push(long_break);
        }
        
        if (notifications !== undefined) {
            updateFields.push('notifications = ?');
            updateValues.push(notifications);
        }
        
        if (language !== undefined) {
            updateFields.push('language = ?');
            updateValues.push(language);
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Нет данных для обновления'
            });
        }
        
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(req.user.id);
        
        const query = `UPDATE user_settings SET ${updateFields.join(', ')} WHERE user_id = ?`;
        
        await db.run(query, updateValues);
        
        const settings = await db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.user.id]);
        
        res.json({
            success: true,
            message: 'Настройки успешно обновлены',
            data: { settings }
        });
        
    } catch (error) {
        console.error('Ошибка обновления настроек:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления настроек'
        });
    }
});

// ==================== СТАТИСТИКА ====================

// Получение статистики
app.get('/api/stats', authMiddleware(), async (req, res) => {
    try {
        // Статистика задач
        const tasksStats = await db.get(`
            SELECT 
                COUNT(*) as total_tasks,
                SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) as pending_tasks,
                SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_priority_tasks,
                AVG(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completion_rate
            FROM tasks 
            WHERE user_id = ?
        `, [req.user.id]);
        
        // Статистика привычек
        const habitsStats = await db.get(`
            SELECT 
                COUNT(*) as total_habits,
                AVG(streak) as avg_streak,
                MAX(streak) as max_streak,
                SUM(CASE WHEN current_streak > 0 THEN 1 ELSE 0 END) as active_habits
            FROM habits 
            WHERE user_id = ? AND is_active = 1
        `, [req.user.id]);
        
        // Финансовая статистика
        const financeStats = await db.get(`
            SELECT 
                SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
                SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as total_expenses,
                AVG(CASE WHEN type = 'expense' THEN amount ELSE NULL END) as avg_expense,
                COUNT(DISTINCT category) as categories_count
            FROM transactions 
            WHERE user_id = ? AND DATE(date) >= DATE('now', '-30 days')
        `, [req.user.id]);
        
        // Статистика долгов
        const debtsStats = await db.get(`
            SELECT 
                COUNT(*) as total_debts,
                SUM(amount - paid_amount) as remaining_debt,
                AVG(interest) as avg_interest,
                SUM(paid_amount) as total_paid
            FROM debts 
            WHERE user_id = ? AND is_active = 1
        `, [req.user.id]);
        
        // Еженедельная продуктивность
        const weeklyProductivity = await db.all(`
            SELECT 
                strftime('%W', created_at) as week_number,
                COUNT(*) as tasks_created,
                SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as tasks_completed
            FROM tasks 
            WHERE user_id = ? 
            GROUP BY strftime('%W', created_at)
            ORDER BY week_number DESC
            LIMIT 4
        `, [req.user.id]);
        
        res.json({
            success: true,
            data: {
                tasks: tasksStats || {},
                habits: habitsStats || {},
                finance: financeStats || {},
                debts: debtsStats || {},
                weekly_productivity: weeklyProductivity || [],
                user_stats: {
                    level: req.user.level,
                    coins: req.user.coins,
                    streak: req.user.streak,
                    tasks_completed: req.user.tasks_completed,
                    habits_streak: req.user.habits_streak
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения статистики:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// ==================== SPA МАРШРУТИЗАЦИЯ ====================
// ==================== SPA МАРШРУТИЗАЦИЯ ====================
// ДОБАВЬТЕ ЭТОТ КОД В САМЫЙ КОНЕЦ, ПЕРЕД ОБРАБОТКОЙ ОШИБОК ↓
app.get('*', (req, res) => {
    // Проверяем, не является ли запрос API или статическим файлом
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ 
            success: false, 
            error: 'API endpoint not found' 
        });
    }
    
    // Отдаем index.html для всех остальных маршрутов
    res.sendFile(path.join(__dirname, 'public', 'index.html'), {
        headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'X-Content-Type-Options': 'nosniff'
        }
    });
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

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🚀 ЗАПУСК ATOMICFLOW v1.0.0');
        console.log('='.repeat(80));
        console.log(`🌐 ДОМЕН: ${DOMAIN}`);
        console.log(`🔌 PORT: ${process.env.PORT || 3000}`);
        console.log(`🏷️  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📊 Демо-режим: ${DEMO_MODE ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН'}`);
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        console.log('✅ Все API настроены');
        console.log('✅ Система готова к работе');
        
  const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            // ИЗМЕНИТЕ ВЫВОД НА ВАШ ДОМЕН ↓
            console.log(`🚀 AtomicFlow запущен!`);
            console.log(`🌐 Доступ по адресу: ${DOMAIN}`);
            console.log(`📊 Проверка здоровья: ${DOMAIN}/health`);
            console.log('='.repeat(80));
            console.log('🔑 ТЕСТОВЫЙ АККАУНТ:');
            console.log('='.repeat(50));
            console.log('👤 Email: alex@atomicflow.test');
            console.log('🔐 Пароль: atomic123');
            console.log('👤 Username: atomic_user');
            console.log('='.repeat(50));
        });
            
            console.log('\n📊 ОСНОВНЫЕ ФУНКЦИОНАЛЬНОСТИ:');
            console.log('='.repeat(60));
            console.log('✅ Управление задачами с тегами и приоритетами');
            console.log('✅ Трекер привычек с календарем');
            console.log('✅ Финансовый трекер с категориями');
            console.log('✅ Метод снежного кома для долгов');
            console.log('✅ Еженедельные ревью');
            console.log('✅ Таймер Pomodoro');
            console.log('✅ Система достижений и монет');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Запуск
startServer();
