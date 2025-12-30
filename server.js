// server.js - ПОЛНЫЙ СЕРВЕР ДЛЯ ATOMICFLOW - УПРАВЛЕНИЕ ЗАДАЧАМИ, ФИНАНСАМИ И ПРИВЫЧКАМИ
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

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// CORS настройки
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://yourdomain.com'] 
        : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080', 'http://localhost:5000', 'http://localhost:5500', 'http://localhost:8000'],
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

// Статические файлы
app.use(express.static('public', {
    setHeaders: (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        
        if (ext.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/)) {
            res.set('Cache-Control', 'public, max-age=31536000');
        } else if (ext.match(/\.(css|js)$/)) {
            res.set('Cache-Control', 'public, max-age=86400');
        } else {
            res.set('Cache-Control', 'public, max-age=3600');
        }
        
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('X-Frame-Options', 'DENY');
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

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных AtomicFlow...');
        
        const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/atomicflow_prod.db' : './atomicflow.db';
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
                telegram_id TEXT UNIQUE,
                email TEXT UNIQUE,
                username TEXT UNIQUE,
                password TEXT NOT NULL,
                full_name TEXT,
                avatar_url TEXT,
                role TEXT DEFAULT 'user',
                level INTEGER DEFAULT 1,
                experience INTEGER DEFAULT 0,
                coins INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                email_verified INTEGER DEFAULT 0,
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
                priority TEXT DEFAULT 'medium',
                status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'archived')),
                due_date TIMESTAMP,
                reminder_time TIMESTAMP,
                estimated_time INTEGER,
                actual_time INTEGER,
                is_recurring INTEGER DEFAULT 0,
                recurring_pattern TEXT,
                parent_task_id INTEGER,
                subtasks TEXT DEFAULT '[]',
                pomodoro_sessions INTEGER DEFAULT 0,
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE
            )
        `);

        // Сессии Pomodoro
        await db.exec(`
            CREATE TABLE IF NOT EXISTS pomodoro_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                task_id INTEGER,
                duration INTEGER NOT NULL,
                break_duration INTEGER DEFAULT 5,
                completed INTEGER DEFAULT 0,
                interrupted INTEGER DEFAULT 0,
                start_time TIMESTAMP,
                end_time TIMESTAMP,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
            )
        `);

        // Финансовые транзакции
        await db.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('income', 'expense', 'transfer')),
                amount DECIMAL(10, 2) NOT NULL,
                category TEXT NOT NULL,
                subcategory TEXT,
                description TEXT,
                payment_method TEXT,
                location TEXT,
                receipt_image TEXT,
                is_recurring INTEGER DEFAULT 0,
                recurring_pattern TEXT,
                transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Долги (Метод снежного кома)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS debts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                initial_amount DECIMAL(10, 2) NOT NULL,
                current_amount DECIMAL(10, 2) NOT NULL,
                interest_rate DECIMAL(5, 2) DEFAULT 0,
                minimum_payment DECIMAL(10, 2),
                due_day INTEGER,
                priority INTEGER DEFAULT 1,
                status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paid', 'overdue')),
                notes TEXT,
                start_date TIMESTAMP,
                target_payoff_date TIMESTAMP,
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
                description TEXT,
                icon TEXT DEFAULT 'fas fa-star',
                frequency TEXT DEFAULT 'daily',
                goal_days INTEGER DEFAULT 7,
                current_streak INTEGER DEFAULT 0,
                longest_streak INTEGER DEFAULT 0,
                best_streak INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                reminders TEXT DEFAULT '[]',
                metadata TEXT DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Отметки привычек
        await db.exec(`
            CREATE TABLE IF NOT EXISTS habit_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                habit_id INTEGER NOT NULL,
                entry_date DATE NOT NULL,
                status TEXT DEFAULT 'completed' CHECK(status IN ('completed', 'skipped', 'partial')),
                notes TEXT,
                value INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, habit_id, entry_date),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
            )
        `);

        // Еженедельные ревью
        await db.exec(`
            CREATE TABLE IF NOT EXISTS weekly_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                week_start_date DATE NOT NULL,
                week_end_date DATE NOT NULL,
                important_tasks TEXT DEFAULT '[]',
                lessons_learned TEXT,
                financial_insights TEXT,
                goals_next_week TEXT DEFAULT '[]',
                mood INTEGER CHECK(mood >= 1 AND mood <= 5),
                productivity_score INTEGER CHECK(productivity_score >= 1 AND productivity_score <= 10),
                completed INTEGER DEFAULT 0,
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, week_start_date),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Категории расходов
        await db.exec(`
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                type TEXT CHECK(type IN ('income', 'expense')),
                icon TEXT,
                color TEXT,
                budget_limit DECIMAL(10, 2),
                is_default INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id, name, type)
            )
        `);

        // Достижения
        await db.exec(`
            CREATE TABLE IF NOT EXISTS achievements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                icon TEXT NOT NULL,
                type TEXT NOT NULL,
                requirement TEXT NOT NULL,
                requirement_value INTEGER NOT NULL,
                reward_coins INTEGER DEFAULT 100,
                reward_xp INTEGER DEFAULT 50,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

        // Уведомления
        await db.exec(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                data TEXT DEFAULT '{}',
                is_read INTEGER DEFAULT 0,
                read_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Статистика
        await db.exec(`
            CREATE TABLE IF NOT EXISTS statistics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                date DATE NOT NULL,
                tasks_completed INTEGER DEFAULT 0,
                tasks_created INTEGER DEFAULT 0,
                pomodoro_sessions INTEGER DEFAULT 0,
                total_pomodoro_time INTEGER DEFAULT 0,
                income_total DECIMAL(10, 2) DEFAULT 0,
                expenses_total DECIMAL(10, 2) DEFAULT 0,
                habits_completed INTEGER DEFAULT 0,
                streak_days INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, date),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
        console.log('📝 Создание начальных данных AtomicFlow...');

        // 1. Категории по умолчанию
        const defaultCategories = [
            // Категории расходов
            { name: 'Еда', type: 'expense', icon: 'fas fa-utensils', color: '#ef4444', is_default: 1 },
            { name: 'Транспорт', type: 'expense', icon: 'fas fa-bus', color: '#3b82f6', is_default: 1 },
            { name: 'Развлечения', type: 'expense', icon: 'fas fa-film', color: '#8b5cf6', is_default: 1 },
            { name: 'Покупки', type: 'expense', icon: 'fas fa-shopping-bag', color: '#10b981', is_default: 1 },
            { name: 'Здоровье', type: 'expense', icon: 'fas fa-heartbeat', color: '#06b6d4', is_default: 1 },
            { name: 'Образование', type: 'expense', icon: 'fas fa-graduation-cap', color: '#f59e0b', is_default: 1 },
            { name: 'Жилье', type: 'expense', icon: 'fas fa-home', color: '#84cc16', is_default: 1 },
            { name: 'Связь', type: 'expense', icon: 'fas fa-phone', color: '#6366f1', is_default: 1 },
            
            // Категории доходов
            { name: 'Зарплата', type: 'income', icon: 'fas fa-money-bill-wave', color: '#22c55e', is_default: 1 },
            { name: 'Фриланс', type: 'income', icon: 'fas fa-laptop-code', color: '#0ea5e9', is_default: 1 },
            { name: 'Инвестиции', type: 'income', icon: 'fas fa-chart-line', color: '#8b5cf6', is_default: 1 },
            { name: 'Подарки', type: 'income', icon: 'fas fa-gift', color: '#f97316', is_default: 1 }
        ];

        for (const category of defaultCategories) {
            await db.run(
                `INSERT OR IGNORE INTO categories (name, type, icon, color, is_default) VALUES (?, ?, ?, ?, ?)`,
                [category.name, category.type, category.icon, category.color, category.is_default]
            );
        }

        // 2. Достижения
        const achievements = [
            {
                title: 'Первая задача',
                description: 'Выполнена первая задача',
                icon: 'fas fa-check-circle',
                type: 'tasks',
                requirement: 'tasks_completed',
                requirement_value: 1,
                reward_coins: 50,
                reward_xp: 25
            },
            {
                title: 'Продуктивная неделя',
                description: 'Выполнено 10 задач за неделю',
                icon: 'fas fa-trophy',
                type: 'tasks',
                requirement: 'tasks_completed',
                requirement_value: 10,
                reward_coins: 100,
                reward_xp: 50
            },
            {
                title: 'Мастер Pomodoro',
                description: 'Завершено 50 сессий Pomodoro',
                icon: 'fas fa-clock',
                type: 'pomodoro',
                requirement: 'pomodoro_sessions',
                requirement_value: 50,
                reward_coins: 200,
                reward_xp: 100
            },
            {
                title: 'Финансовый обзор',
                description: 'Завершено 5 еженедельных ревью',
                icon: 'fas fa-chart-pie',
                type: 'reviews',
                requirement: 'reviews_completed',
                requirement_value: 5,
                reward_coins: 150,
                reward_xp: 75
            },
            {
                title: 'Привычка на 21 день',
                description: '21 день подряд выполнялась привычка',
                icon: 'fas fa-calendar-check',
                type: 'habits',
                requirement: 'habit_streak',
                requirement_value: 21,
                reward_coins: 300,
                reward_xp: 150
            },
            {
                title: 'Снежный ком',
                description: 'Полностью выплачен первый долг по методу снежного кома',
                icon: 'fas fa-snowflake',
                type: 'debts',
                requirement: 'debts_paid',
                requirement_value: 1,
                reward_coins: 500,
                reward_xp: 250
            }
        ];

        for (const achievement of achievements) {
            await db.run(
                `INSERT OR IGNORE INTO achievements 
                (title, description, icon, type, requirement, requirement_value, reward_coins, reward_xp, is_active) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    achievement.title,
                    achievement.description,
                    achievement.icon,
                    achievement.type,
                    achievement.requirement,
                    achievement.requirement_value,
                    achievement.reward_coins,
                    achievement.reward_xp,
                    1
                ]
            );
        }

        // 3. Тестовый пользователь
        const userExist = await db.get("SELECT 1 FROM users WHERE email = 'demo@atomicflow.test'");
        if (!userExist) {
            const passwordHash = await bcrypt.hash('demo123', 12);
            
            await db.run(
                `INSERT OR IGNORE INTO users 
                (email, username, password, full_name, role, coins) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    'demo@atomicflow.test',
                    'demo_user',
                    passwordHash,
                    'Демо Пользователь',
                    'user',
                    1000
                ]
            );
            
            console.log('✅ Тестовый пользователь создан');
            
            // Создаем демо данные для тестового пользователя
            const demoUser = await db.get("SELECT id FROM users WHERE email = 'demo@atomicflow.test'");
            if (demoUser) {
                await createDemoData(demoUser.id);
            }
        }

        console.log('🎉 Начальные данные созданы успешно!');
        
    } catch (error) {
        console.error('⚠️ Ошибка создания начальных данных:', error.message);
    }
};

// Создание демо данных
const createDemoData = async (userId) => {
    try {
        console.log(`📊 Создание демо данных для пользователя ${userId}...`);
        
        // Демо задачи
        const demoTasks = [
            {
                title: 'Запланировать неделю',
                tag: '#работа',
                status: 'pending',
                priority: 'high',
                due_date: new Date().toISOString(),
                subtasks: JSON.stringify(['Составить список задач', 'Расставить приоритеты', 'Оценить время'])
            },
            {
                title: 'Утренняя зарядка',
                tag: '#здоровье',
                status: 'completed',
                priority: 'medium',
                completed_at: new Date().toISOString(),
                pomodoro_sessions: 1
            },
            {
                title: 'Купить продукты',
                tag: '#дом',
                status: 'pending',
                priority: 'medium',
                subtasks: JSON.stringify(['Составить список', 'Пойти в магазин', 'Приготовить ужин'])
            },
            {
                title: 'Изучить новый фреймворк',
                tag: '#учеба',
                status: 'in_progress',
                priority: 'low',
                estimated_time: 120
            }
        ];

        for (const task of demoTasks) {
            await db.run(
                `INSERT INTO tasks (user_id, title, tag, status, priority, due_date, subtasks, completed_at, pomodoro_sessions, estimated_time)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    task.title,
                    task.tag,
                    task.status,
                    task.priority,
                    task.due_date,
                    task.subtasks,
                    task.completed_at,
                    task.pomodoro_sessions || 0,
                    task.estimated_time || 0
                ]
            );
        }

        // Демо привычки
        const demoHabits = [
            {
                title: 'Пить воду',
                icon: 'fas fa-tint',
                frequency: 'daily',
                current_streak: 12,
                longest_streak: 15
            },
            {
                title: '15 минут уборки',
                icon: 'fas fa-broom',
                frequency: 'daily',
                current_streak: 8,
                longest_streak: 10
            },
            {
                title: 'Чтение 20 мин',
                icon: 'fas fa-book',
                frequency: 'daily',
                current_streak: 5,
                longest_streak: 7
            }
        ];

        for (const habit of demoHabits) {
            const result = await db.run(
                `INSERT INTO habits (user_id, title, icon, frequency, current_streak, longest_streak)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    habit.title,
                    habit.icon,
                    habit.frequency,
                    habit.current_streak,
                    habit.longest_streak
                ]
            );

            // Создаем записи для привычек за последние 14 дней
            const habitId = result.lastID;
            for (let i = 0; i < 14; i++) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const completed = i < habit.current_streak ? 1 : (i % 3 === 0 ? 1 : 0);
                
                if (completed) {
                    await db.run(
                        `INSERT INTO habit_entries (user_id, habit_id, entry_date, status)
                         VALUES (?, ?, ?, ?)`,
                        [userId, habitId, date.toISOString().split('T')[0], 'completed']
                    );
                }
            }
        }

        // Демо транзакции
        const demoTransactions = [
            { type: 'expense', amount: 350, category: 'Еда', description: 'Обед' },
            { type: 'income', amount: 50000, category: 'Зарплата', description: 'Зарплата за январь' },
            { type: 'expense', amount: 1200, category: 'Транспорт', description: 'Такси' },
            { type: 'expense', amount: 2500, category: 'Развлечения', description: 'Кино' }
        ];

        for (const transaction of demoTransactions) {
            await db.run(
                `INSERT INTO transactions (user_id, type, amount, category, description, transaction_date)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    transaction.type,
                    transaction.amount,
                    transaction.category,
                    transaction.description,
                    new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString()
                ]
            );
        }

        // Демо долги
        const demoDebts = [
            {
                name: 'Кредитная карта',
                initial_amount: 45000,
                current_amount: 45000,
                interest_rate: 25,
                minimum_payment: 5000,
                priority: 1
            },
            {
                name: 'Автокредит',
                initial_amount: 350000,
                current_amount: 350000,
                interest_rate: 12,
                minimum_payment: 15000,
                priority: 2
            }
        ];

        for (const debt of demoDebts) {
            await db.run(
                `INSERT INTO debts (user_id, name, initial_amount, current_amount, interest_rate, minimum_payment, priority)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    debt.name,
                    debt.initial_amount,
                    debt.current_amount,
                    debt.interest_rate,
                    debt.minimum_payment,
                    debt.priority
                ]
            );
        }

        // Демо еженедельное ревью
        const lastMonday = new Date();
        lastMonday.setDate(lastMonday.getDate() - 7 - lastMonday.getDay() + 1);
        
        await db.run(
            `INSERT INTO weekly_reviews 
            (user_id, week_start_date, week_end_date, important_tasks, lessons_learned, financial_insights, goals_next_week, completed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                lastMonday.toISOString().split('T')[0],
                new Date(lastMonday.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                JSON.stringify(['Запланировать неделю', 'Закончить проект']),
                'Нужно лучше планировать время на утренние задачи',
                'На развлечения ушло на 15% больше, чем обычно',
                JSON.stringify(['Начать новый курс', 'Увеличить доход на 10%']),
                1
            ]
        );

        console.log(`✅ Демо данные созданы для пользователя ${userId}`);
        
    } catch (error) {
        console.error('⚠️ Ошибка создания демо данных:', error.message);
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
const validateEmail = (email) => {
    if (!email) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

const generateAvatarUrl = (username) => {
    const colors = ['#4361ee', '#f72585', '#4cc9f0', '#4ade80', '#fbbf24'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=${color.replace('#', '')}&color=fff&bold=true`;
};

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('ru-RU', { 
        style: 'currency', 
        currency: 'RUB',
        minimumFractionDigits: 0
    }).format(amount);
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
                'POST /api/auth/telegram',
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
                    `SELECT id, email, username, full_name, role, level, experience, coins,
                            telegram_id, avatar_url, is_active
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
                    telegram_id: user.telegram_id,
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

// Главная страница
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🚀 Добро пожаловать в AtomicFlow API',
        version: '1.0.0',
        description: 'Превращай большие цели в цепочку маленьких побед',
        endpoints: {
            auth: '/api/auth/*',
            tasks: '/api/tasks/*',
            finance: '/api/finance/*',
            habits: '/api/habits/*',
            reviews: '/api/reviews/*',
            stats: '/api/stats/*'
        },
        demo_mode: DEMO_MODE,
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
            service: 'AtomicFlow API',
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
        const { email, username, password, full_name, telegram_id } = req.body;
        
        console.log('📝 Регистрация нового пользователя:', { email, username, telegram_id });
        
        if ((!email && !telegram_id) || !username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Заполните обязательные поля'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен содержать не менее 6 символов'
            });
        }
        
        if (email && !validateEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный email адрес'
            });
        }
        
        // Проверяем уникальность
        if (email) {
            const existingEmail = await db.get('SELECT id FROM users WHERE email = ?', [email]);
            if (existingEmail) {
                return res.status(409).json({
                    success: false,
                    error: 'Пользователь с таким email уже существует'
                });
            }
        }
        
        if (telegram_id) {
            const existingTelegram = await db.get('SELECT id FROM users WHERE telegram_id = ?', [telegram_id]);
            if (existingTelegram) {
                return res.status(409).json({
                    success: false,
                    error: 'Пользователь с таким Telegram ID уже существует'
                });
            }
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
            (email, username, password, full_name, telegram_id, avatar_url, coins) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [email || null, username, hashedPassword, full_name || username, telegram_id || null, avatarUrl, 100]
        );
        
        const userId = result.lastID;
        
        // Создаем уведомление
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message) 
            VALUES (?, ?, ?, ?)`,
            [
                userId,
                'welcome',
                'Добро пожаловать в AtomicFlow! 🎉',
                'Начните свой путь к продуктивности с первой задачи или привычки!'
            ]
        );
        
        const user = await db.get(
            `SELECT id, email, username, full_name, role, level, experience, coins,
                    telegram_id, avatar_url
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
            process.env.JWT_SECRET || 'atomicflow-secret-key-2024',
            { expiresIn: '30d' }
        );
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешна! Добро пожаловать в AtomicFlow!',
            data: { 
                user,
                token
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка регистрации:', error.message);
        
        if (error.message.includes('UNIQUE constraint failed') || error.message.includes('SQLITE_CONSTRAINT')) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с такими данными уже существует'
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
        const { email, username, password } = req.body;
        
        console.log('🔐 Попытка входа:', { email, username });
        
        if ((!email && !username) || !password) {
            return res.status(400).json({
                success: false,
                error: 'Укажите email/username и пароль'
            });
        }
        
        const user = await db.get(
            `SELECT * FROM users WHERE (email = ? OR username = ?) AND is_active = 1`,
            [email || username, email || username]
        );
        
        if (!user) {
            console.log(`❌ Пользователь не найден: ${email || username}`);
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
            telegram_id: user.telegram_id,
            avatar_url: user.avatar_url
        };
        
        const token = jwt.sign(
            { 
                id: user.id,
                email: user.email,
                username: user.username,
                role: user.role
            },
            process.env.JWT_SECRET || 'atomicflow-secret-key-2024',
            { expiresIn: '30d' }
        );
        
        console.log('✅ Успешный вход пользователя:', user.email || user.username);
        
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

// Telegram авторизация
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { telegram_id, username, first_name, last_name, photo_url } = req.body;
        
        console.log('🤖 Telegram авторизация:', { telegram_id, username });
        
        if (!telegram_id) {
            return res.status(400).json({
                success: false,
                error: 'Telegram ID обязателен'
            });
        }
        
        // Проверяем существующего пользователя
        let user = await db.get(
            `SELECT * FROM users WHERE telegram_id = ? AND is_active = 1`,
            [telegram_id]
        );
        
        if (!user) {
            // Создаем нового пользователя
            const avatarUrl = photo_url || generateAvatarUrl(username || first_name);
            const fullName = first_name + (last_name ? ` ${last_name}` : '');
            
            const result = await db.run(
                `INSERT INTO users 
                (telegram_id, username, full_name, avatar_url, coins, password) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    telegram_id,
                    username || `user_${telegram_id}`,
                    fullName || 'Telegram User',
                    avatarUrl,
                    100,
                    await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12)
                ]
            );
            
            user = await db.get(
                `SELECT id, username, full_name, role, level, experience, coins,
                        telegram_id, avatar_url
                 FROM users WHERE id = ?`,
                [result.lastID]
            );
            
            // Создаем уведомление
            await db.run(
                `INSERT INTO notifications 
                (user_id, type, title, message) 
                VALUES (?, ?, ?, ?)`,
                [
                    user.id,
                    'welcome',
                    'Добро пожаловать из Telegram! 🎉',
                    'Теперь вы можете использовать AtomicFlow прямо в Telegram!'
                ]
            );
            
            console.log('✅ Создан новый пользователь из Telegram');
        }
        
        // Обновляем время последнего входа
        await db.run(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        const userForResponse = {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role: user.role,
            level: user.level,
            experience: user.experience,
            coins: user.coins,
            telegram_id: user.telegram_id,
            avatar_url: user.avatar_url
        };
        
        const token = jwt.sign(
            { 
                id: user.id,
                telegram_id: user.telegram_id,
                username: user.username,
                role: user.role
            },
            process.env.JWT_SECRET || 'atomicflow-secret-key-2024',
            { expiresIn: '30d' }
        );
        
        res.json({
            success: true,
            message: 'Авторизация через Telegram успешна!',
            data: { 
                user: userForResponse,
                token 
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка Telegram авторизации:', error.message);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера'
        });
    }
});

// Проверка токена
app.get('/api/auth/check', authMiddleware(), async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, username, full_name, role, level, experience, coins,
                    telegram_id, avatar_url
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        res.json({
            success: true,
            data: { user }
        });
        
    } catch (error) {
        console.error('❌ Ошибка проверки токена:', error.message);
        res.status(401).json({
            success: false,
            error: 'Неверный токен'
        });
    }
});

// ==================== ЗАДАЧИ ====================

// Получение всех задач
app.get('/api/tasks', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { status, tag, priority, date, limit = 50 } = req.query;
        
        let query = `
            SELECT * FROM tasks 
            WHERE user_id = ?
        `;
        const params = [userId];
        
        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }
        
        if (tag) {
            query += ' AND tag = ?';
            params.push(tag);
        }
        
        if (priority) {
            query += ' AND priority = ?';
            params.push(priority);
        }
        
        if (date) {
            query += ' AND DATE(due_date) = DATE(?)';
            params.push(date);
        }
        
        query += ' ORDER BY 
            CASE priority 
                WHEN "high" THEN 1
                WHEN "medium" THEN 2
                WHEN "low" THEN 3
                ELSE 4
            END,
            due_date ASC,
            created_at DESC
            LIMIT ?';
        params.push(parseInt(limit));
        
        const tasks = await db.all(query, params);
        
        // Парсим JSON поля
        const tasksWithParsedData = tasks.map(task => ({
            ...task,
            subtasks: JSON.parse(task.subtasks || '[]')
        }));
        
        res.json({
            success: true,
            data: {
                tasks: tasksWithParsedData,
                count: tasks.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения задач:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
        });
    }
});

// Создание задачи
app.post('/api/tasks', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            title, 
            description, 
            tag, 
            priority, 
            due_date, 
            reminder_time,
            estimated_time,
            subtasks,
            parent_task_id 
        } = req.body;
        
        if (!title) {
            return res.status(400).json({
                success: false,
                error: 'Название задачи обязательно'
            });
        }
        
        const result = await db.run(
            `INSERT INTO tasks 
            (user_id, title, description, tag, priority, due_date, reminder_time, estimated_time, subtasks, parent_task_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                title,
                description || '',
                tag || '#общее',
                priority || 'medium',
                due_date || null,
                reminder_time || null,
                estimated_time || 0,
                JSON.stringify(subtasks || []),
                parent_task_id || null
            ]
        );
        
        const taskId = result.lastID;
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        
        // Создаем уведомление
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, data) 
            VALUES (?, ?, ?, ?, ?)`,
            [
                userId,
                'task_created',
                'Задача создана 📝',
                `Задача "${title}" успешно создана`,
                JSON.stringify({ task_id: taskId })
            ]
        );
        
        // Обновляем статистику
        await updateStatistics(userId, 'tasks_created');
        
        res.status(201).json({
            success: true,
            message: 'Задача успешно создана',
            data: { 
                task: {
                    ...task,
                    subtasks: JSON.parse(task.subtasks || '[]')
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания задачи:', error.message);
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
        const userId = req.user.id;
        const updateData = req.body;
        
        // Проверяем принадлежность задачи
        const task = await db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена или у вас нет прав'
            });
        }
        
        // Подготавливаем поля для обновления
        const updateFields = [];
        const updateValues = [];
        
        const allowedFields = ['title', 'description', 'tag', 'priority', 'status', 
                              'due_date', 'reminder_time', 'estimated_time', 'actual_time',
                              'subtasks', 'pomodoro_sessions'];
        
        allowedFields.forEach(field => {
            if (updateData[field] !== undefined) {
                updateFields.push(`${field} = ?`);
                if (field === 'subtasks') {
                    updateValues.push(JSON.stringify(updateData[field]));
                } else {
                    updateValues.push(updateData[field]);
                }
            }
        });
        
        // Если статус изменен на completed, устанавливаем completed_at
        if (updateData.status === 'completed' && task.status !== 'completed') {
            updateFields.push('completed_at = CURRENT_TIMESTAMP');
        } else if (updateData.status !== 'completed' && task.status === 'completed') {
            updateFields.push('completed_at = NULL');
        }
        
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(taskId, userId);
        
        const query = `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`;
        
        await db.run(query, updateValues);
        
        // Обновляем статистику если задача завершена
        if (updateData.status === 'completed') {
            await updateStatistics(userId, 'tasks_completed');
            
            // Проверяем достижения
            await checkAchievements(userId, 'tasks');
        }
        
        const updatedTask = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        
        res.json({
            success: true,
            message: 'Задача обновлена',
            data: { 
                task: {
                    ...updatedTask,
                    subtasks: JSON.parse(updatedTask.subtasks || '[]')
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления задачи:', error.message);
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
        const userId = req.user.id;
        
        // Проверяем принадлежность задачи
        const task = await db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена или у вас нет прав'
            });
        }
        
        await db.run('DELETE FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
        
        res.json({
            success: true,
            message: 'Задача удалена'
        });
        
    } catch (error) {
        console.error('❌ Ошибка удаления задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка удаления задачи'
        });
    }
});

// Разбор задачи на подзадачи
app.post('/api/tasks/:id/breakdown', authMiddleware(), async (req, res) => {
    try {
        const taskId = req.params.id;
        const userId = req.user.id;
        const { subtasks } = req.body;
        
        if (!subtasks || !Array.isArray(subtasks) || subtasks.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Укажите подзадачи'
            });
        }
        
        // Проверяем принадлежность задачи
        const task = await db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена или у вас нет прав'
            });
        }
        
        // Создаем подзадачи
        const createdSubtasks = [];
        for (const subtaskTitle of subtasks) {
            const result = await db.run(
                `INSERT INTO tasks 
                (user_id, title, tag, priority, parent_task_id) 
                VALUES (?, ?, ?, ?, ?)`,
                [
                    userId,
                    subtaskTitle,
                    task.tag,
                    'medium',
                    taskId
                ]
            );
            
            createdSubtasks.push({
                id: result.lastID,
                title: subtaskTitle
            });
        }
        
        // Обновляем основную задачу
        await db.run(
            'UPDATE tasks SET subtasks = ? WHERE id = ?',
            [JSON.stringify(createdSubtasks.map(st => st.title)), taskId]
        );
        
        res.json({
            success: true,
            message: `Задача разбита на ${subtasks.length} подзадач`,
            data: {
                subtasks: createdSubtasks
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка разбора задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка разбора задачи'
        });
    }
});

// ==================== POMODORO ====================

// Начало сессии Pomodoro
app.post('/api/pomodoro/start', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { task_id, duration = 25, break_duration = 5 } = req.body;
        
        // Завершаем все активные сессии
        await db.run(
            'UPDATE pomodoro_sessions SET completed = 1, end_time = CURRENT_TIMESTAMP WHERE user_id = ? AND completed = 0',
            [userId]
        );
        
        // Создаем новую сессию
        const result = await db.run(
            `INSERT INTO pomodoro_sessions 
            (user_id, task_id, duration, break_duration, start_time) 
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [userId, task_id || null, duration, break_duration]
        );
        
        const sessionId = result.lastID;
        const session = await db.get('SELECT * FROM pomodoro_sessions WHERE id = ?', [sessionId]);
        
        res.json({
            success: true,
            message: 'Сессия Pomodoro начата',
            data: { session }
        });
        
    } catch (error) {
        console.error('❌ Ошибка начала сессии Pomodoro:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка начала сессии Pomodoro'
        });
    }
});

// Завершение сессии Pomodoro
app.post('/api/pomodoro/:id/complete', authMiddleware(), async (req, res) => {
    try {
        const sessionId = req.params.id;
        const userId = req.user.id;
        const { notes } = req.body;
        
        // Проверяем принадлежность сессии
        const session = await db.get('SELECT * FROM pomodoro_sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Сессия не найдена'
            });
        }
        
        // Обновляем сессию
        await db.run(
            `UPDATE pomodoro_sessions SET 
                completed = 1,
                end_time = CURRENT_TIMESTAMP,
                notes = ?
             WHERE id = ?`,
            [notes || null, sessionId]
        );
        
        // Если сессия связана с задачей, увеличиваем счетчик Pomodoro
        if (session.task_id) {
            await db.run(
                'UPDATE tasks SET pomodoro_sessions = pomodoro_sessions + 1 WHERE id = ?',
                [session.task_id]
            );
        }
        
        // Обновляем статистику
        await updateStatistics(userId, 'pomodoro_sessions');
        
        // Проверяем достижения
        await checkAchievements(userId, 'pomodoro');
        
        const updatedSession = await db.get('SELECT * FROM pomodoro_sessions WHERE id = ?', [sessionId]);
        
        res.json({
            success: true,
            message: 'Сессия Pomodoro завершена',
            data: { session: updatedSession }
        });
        
    } catch (error) {
        console.error('❌ Ошибка завершения сессии Pomodoro:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка завершения сессии Pomodoro'
        });
    }
});

// История сессий Pomodoro
app.get('/api/pomodoro/history', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 20, date } = req.query;
        
        let query = `
            SELECT ps.*, t.title as task_title
            FROM pomodoro_sessions ps
            LEFT JOIN tasks t ON ps.task_id = t.id
            WHERE ps.user_id = ?
        `;
        const params = [userId];
        
        if (date) {
            query += ' AND DATE(ps.created_at) = DATE(?)';
            params.push(date);
        }
        
        query += ' ORDER BY ps.created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const sessions = await db.all(query, params);
        
        res.json({
            success: true,
            data: {
                sessions,
                total_time: sessions.reduce((sum, session) => sum + session.duration, 0)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения истории Pomodoro:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения истории Pomodoro'
        });
    }
});

// ==================== ФИНАНСЫ ====================

// Получение транзакций
app.get('/api/finance/transactions', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { type, category, start_date, end_date, limit = 50 } = req.query;
        
        let query = `
            SELECT * FROM transactions 
            WHERE user_id = ?
        `;
        const params = [userId];
        
        if (type) {
            query += ' AND type = ?';
            params.push(type);
        }
        
        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }
        
        if (start_date && end_date) {
            query += ' AND DATE(transaction_date) BETWEEN DATE(?) AND DATE(?)';
            params.push(start_date, end_date);
        } else if (start_date) {
            query += ' AND DATE(transaction_date) >= DATE(?)';
            params.push(start_date);
        } else if (end_date) {
            query += ' AND DATE(transaction_date) <= DATE(?)';
            params.push(end_date);
        }
        
        query += ' ORDER BY transaction_date DESC, created_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const transactions = await db.all(query, params);
        
        // Рассчитываем баланс
        const income = await db.get(
            'SELECT SUM(amount) as total FROM transactions WHERE user_id = ? AND type = "income"',
            [userId]
        );
        
        const expenses = await db.get(
            'SELECT SUM(amount) as total FROM transactions WHERE user_id = ? AND type = "expense"',
            [userId]
        );
        
        const balance = (income?.total || 0) - (expenses?.total || 0);
        
        res.json({
            success: true,
            data: {
                transactions,
                balance: {
                    total: balance,
                    income: income?.total || 0,
                    expenses: expenses?.total || 0
                },
                count: transactions.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения транзакций:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения транзакций'
        });
    }
});

// Создание транзакции
app.post('/api/finance/transactions', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            type, 
            amount, 
            category, 
            description, 
            payment_method,
            location,
            transaction_date 
        } = req.body;
        
        if (!type || !amount || !category) {
            return res.status(400).json({
                success: false,
                error: 'Тип, сумма и категория обязательны'
            });
        }
        
        if (amount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Сумма должна быть положительной'
            });
        }
        
        const result = await db.run(
            `INSERT INTO transactions 
            (user_id, type, amount, category, description, payment_method, location, transaction_date) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                type,
                amount,
                category,
                description || '',
                payment_method || null,
                location || null,
                transaction_date || new Date().toISOString()
            ]
        );
        
        const transactionId = result.lastID;
        const transaction = await db.get('SELECT * FROM transactions WHERE id = ?', [transactionId]);
        
        // Обновляем статистику
        if (type === 'income') {
            await updateStatistics(userId, 'income_total', amount);
        } else if (type === 'expense') {
            await updateStatistics(userId, 'expenses_total', amount);
        }
        
        res.status(201).json({
            success: true,
            message: 'Транзакция добавлена',
            data: { transaction }
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания транзакции:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания транзакции'
        });
    }
});

// Аналитика расходов
app.get('/api/finance/analytics', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { period = 'month', category } = req.query;
        
        // Определяем период
        let dateFilter = '';
        let groupBy = '';
        
        switch (period) {
            case 'day':
                dateFilter = 'DATE(transaction_date) = DATE("now")';
                groupBy = 'DATE(transaction_date)';
                break;
            case 'week':
                dateFilter = 'DATE(transaction_date) >= DATE("now", "-7 days")';
                groupBy = 'DATE(transaction_date)';
                break;
            case 'month':
                dateFilter = 'DATE(transaction_date) >= DATE("now", "-30 days")';
                groupBy = 'category';
                break;
            case 'year':
                dateFilter = 'DATE(transaction_date) >= DATE("now", "-365 days")';
                groupBy = 'strftime("%m", transaction_date)';
                break;
            default:
                dateFilter = 'DATE(transaction_date) >= DATE("now", "-30 days")';
                groupBy = 'category';
        }
        
        // Расходы по категориям
        const expensesByCategory = await db.all(`
            SELECT 
                category,
                SUM(amount) as total,
                COUNT(*) as count
            FROM transactions 
            WHERE user_id = ? 
                AND type = 'expense'
                AND ${dateFilter}
                ${category ? 'AND category = ?' : ''}
            GROUP BY ${groupBy}
            ORDER BY total DESC
        `, category ? [userId, category] : [userId]);
        
        // Доходы по категориям
        const incomeByCategory = await db.all(`
            SELECT 
                category,
                SUM(amount) as total,
                COUNT(*) as count
            FROM transactions 
            WHERE user_id = ? 
                AND type = 'income'
                AND ${dateFilter}
            GROUP BY ${groupBy}
            ORDER BY total DESC
        `, [userId]);
        
        // Ежемесячная статистика
        const monthlyStats = await db.all(`
            SELECT 
                strftime('%Y-%m', transaction_date) as month,
                SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
                SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense,
                SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) as balance
            FROM transactions 
            WHERE user_id = ?
            GROUP BY strftime('%Y-%m', transaction_date)
            ORDER BY month DESC
            LIMIT 6
        `, [userId]);
        
        // Самые частые расходы
        const frequentExpenses = await db.all(`
            SELECT 
                description,
                category,
                COUNT(*) as frequency,
                AVG(amount) as avg_amount
            FROM transactions 
            WHERE user_id = ? 
                AND type = 'expense'
                AND description IS NOT NULL
                AND description != ''
            GROUP BY description, category
            ORDER BY frequency DESC
            LIMIT 10
        `, [userId]);
        
        res.json({
            success: true,
            data: {
                expenses_by_category: expensesByCategory,
                income_by_category: incomeByCategory,
                monthly_stats: monthlyStats,
                frequent_expenses: frequentExpenses,
                period: period
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения аналитики:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения аналитики'
        });
    }
});

// ==================== ДОЛГИ (СНЕЖНЫЙ КОМ) ====================

// Получение долгов
app.get('/api/finance/debts', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        
        const debts = await db.all(
            'SELECT * FROM debts WHERE user_id = ? ORDER BY priority ASC, interest_rate DESC',
            [userId]
        );
        
        // Рассчитываем рекомендуемый план выплат
        const sortedDebts = [...debts].sort((a, b) => {
            // Метод снежного кома: сначала самый маленький долг
            return a.current_amount - b.current_amount;
        });
        
        // Генерируем прогноз выплат
        const forecast = generateDebtForecast(sortedDebts);
        
        res.json({
            success: true,
            data: {
                debts,
                snowball_order: sortedDebts,
                forecast,
                total_debt: debts.reduce((sum, debt) => sum + parseFloat(debt.current_amount), 0),
                total_minimum_payment: debts.reduce((sum, debt) => sum + (parseFloat(debt.minimum_payment) || 0), 0)
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения долгов:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения долгов'
        });
    }
});

// Создание долга
app.post('/api/finance/debts', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            name, 
            initial_amount, 
            current_amount, 
            interest_rate,
            minimum_payment,
            due_day,
            priority,
            notes
        } = req.body;
        
        if (!name || !initial_amount) {
            return res.status(400).json({
                success: false,
                error: 'Название и сумма обязательны'
            });
        }
        
        const result = await db.run(
            `INSERT INTO debts 
            (user_id, name, initial_amount, current_amount, interest_rate, minimum_payment, due_day, priority, notes) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                name,
                initial_amount,
                current_amount || initial_amount,
                interest_rate || 0,
                minimum_payment || null,
                due_day || null,
                priority || 1,
                notes || null
            ]
        );
        
        const debtId = result.lastID;
        const debt = await db.get('SELECT * FROM debts WHERE id = ?', [debtId]);
        
        res.status(201).json({
            success: true,
            message: 'Долг добавлен',
            data: { debt }
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания долга:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания долга'
        });
    }
});

// Внесение платежа по долгу
app.post('/api/finance/debts/:id/payment', authMiddleware(), async (req, res) => {
    try {
        const debtId = req.params.id;
        const userId = req.user.id;
        const { amount, date } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Укажите сумму платежа'
            });
        }
        
        // Проверяем принадлежность долга
        const debt = await db.get('SELECT * FROM debts WHERE id = ? AND user_id = ?', [debtId, userId]);
        if (!debt) {
            return res.status(404).json({
                success: false,
                error: 'Долг не найден'
            });
        }
        
        // Обновляем остаток
        const newAmount = parseFloat(debt.current_amount) - parseFloat(amount);
        const isPaid = newAmount <= 0;
        
        await db.run(
            `UPDATE debts SET 
                current_amount = ?,
                status = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [Math.max(0, newAmount), isPaid ? 'paid' : 'active', debtId]
        );
        
        // Создаем транзакцию для платежа
        await db.run(
            `INSERT INTO transactions 
            (user_id, type, amount, category, description) 
            VALUES (?, ?, ?, ?, ?)`,
            [
                userId,
                'expense',
                amount,
                'Долги',
                `Платеж по долгу: ${debt.name}`
            ]
        );
        
        // Проверяем достижения если долг полностью погашен
        if (isPaid) {
            await checkAchievements(userId, 'debts');
        }
        
        const updatedDebt = await db.get('SELECT * FROM debts WHERE id = ?', [debtId]);
        
        res.json({
            success: true,
            message: isPaid ? 'Долг полностью погашен! 🎉' : 'Платеж внесен',
            data: { debt: updatedDebt }
        });
        
    } catch (error) {
        console.error('❌ Ошибка внесения платежа:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка внесения платежа'
        });
    }
});

// Функция генерации прогноза выплат
function generateDebtForecast(debts, monthlyPayment = 0) {
    if (!debts.length) return [];
    
    // Если не указан платеж, используем сумму минимальных платежей
    if (!monthlyPayment) {
        monthlyPayment = debts.reduce((sum, debt) => sum + (parseFloat(debt.minimum_payment) || 0), 0);
    }
    
    const forecast = [];
    let month = 0;
    let remainingDebts = debts.map(debt => ({
        ...debt,
        current_amount: parseFloat(debt.current_amount),
        interest_rate: parseFloat(debt.interest_rate) / 100 / 12 // Месячная ставка
    }));
    
    while (remainingDebts.length > 0 && month < 120) { // Максимум 10 лет
        month++;
        
        // Начисляем проценты
        remainingDebts = remainingDebts.map(debt => ({
            ...debt,
            current_amount: debt.current_amount * (1 + debt.interest_rate)
        }));
        
        // Сортируем по методу снежного кома (самый маленький первый)
        remainingDebts.sort((a, b) => a.current_amount - b.current_amount);
        
        let remainingPayment = monthlyPayment;
        
        // Распределяем платеж
        for (let i = 0; i < remainingDebts.length; i++) {
            const debt = remainingDebts[i];
            
            if (remainingPayment <= 0) break;
            
            const payment = Math.min(debt.current_amount, remainingPayment);
            debt.current_amount -= payment;
            remainingPayment -= payment;
            
            // Если долг погашен, удаляем его
            if (debt.current_amount <= 1) {
                forecast.push({
                    month,
                    debt_name: debt.name,
                    amount_paid: payment,
                    total_paid: monthlyPayment * month,
                    status: 'paid'
                });
                
                remainingDebts.splice(i, 1);
                i--;
            }
        }
        
        // Если платеж меньше процентов, добавляем предупреждение
        const totalInterest = remainingDebts.reduce((sum, debt) => 
            sum + debt.current_amount * debt.interest_rate, 0);
        
        if (monthlyPayment < totalInterest) {
            forecast.push({
                month,
                warning: 'Платеж меньше начисляемых процентов',
                recommendation: 'Увеличьте ежемесячный платеж'
            });
            break;
        }
        
        if (month % 12 === 0) {
            forecast.push({
                year: month / 12,
                remaining_debts: remainingDebts.length,
                total_remaining: remainingDebts.reduce((sum, debt) => sum + debt.current_amount, 0),
                total_paid: monthlyPayment * month
            });
        }
    }
    
    return forecast.slice(0, 20); // Возвращаем первые 20 записей
}

// ==================== ПРИВЫЧКИ ====================

// Получение привычек
app.get('/api/habits', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { active_only = 'true', frequency } = req.query;
        
        let query = `
            SELECT * FROM habits 
            WHERE user_id = ?
        `;
        const params = [userId];
        
        if (active_only === 'true') {
            query += ' AND is_active = 1';
        }
        
        if (frequency) {
            query += ' AND frequency = ?';
            params.push(frequency);
        }
        
        query += ' ORDER BY current_streak DESC, created_at DESC';
        
        const habits = await db.all(query, params);
        
        // Получаем записи за последние 30 дней для каждой привычки
        const habitsWithEntries = await Promise.all(habits.map(async (habit) => {
            const entries = await db.all(
                `SELECT entry_date, status FROM habit_entries 
                 WHERE user_id = ? AND habit_id = ? 
                 AND entry_date >= DATE('now', '-30 days')
                 ORDER BY entry_date DESC`,
                [userId, habit.id]
            );
            
            // Формируем календарь за последние 14 дней
            const calendar = [];
            for (let i = 13; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateStr = date.toISOString().split('T')[0];
                
                const entry = entries.find(e => e.entry_date === dateStr);
                calendar.push({
                    date: dateStr,
                    completed: entry ? entry.status === 'completed' : false,
                    day: date.getDate()
                });
            }
            
            return {
                ...habit,
                entries,
                calendar,
                metadata: JSON.parse(habit.metadata || '{}'),
                reminders: JSON.parse(habit.reminders || '[]')
            };
        }));
        
        res.json({
            success: true,
            data: {
                habits: habitsWithEntries,
                count: habits.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения привычек:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения привычек'
        });
    }
});

// Создание привычки
app.post('/api/habits', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { 
            title, 
            description, 
            icon, 
            frequency, 
            goal_days,
            reminders,
            metadata 
        } = req.body;
        
        if (!title) {
            return res.status(400).json({
                success: false,
                error: 'Название привычки обязательно'
            });
        }
        
        const result = await db.run(
            `INSERT INTO habits 
            (user_id, title, description, icon, frequency, goal_days, reminders, metadata) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                title,
                description || '',
                icon || 'fas fa-star',
                frequency || 'daily',
                goal_days || 7,
                JSON.stringify(reminders || []),
                JSON.stringify(metadata || {})
            ]
        );
        
        const habitId = result.lastID;
        const habit = await db.get('SELECT * FROM habits WHERE id = ?', [habitId]);
        
        res.status(201).json({
            success: true,
            message: 'Привычка создана',
            data: { 
                habit: {
                    ...habit,
                    metadata: JSON.parse(habit.metadata || '{}'),
                    reminders: JSON.parse(habit.reminders || '[]')
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания привычки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания привычки'
        });
    }
});

// Отметка привычки
app.post('/api/habits/:id/check', authMiddleware(), async (req, res) => {
    try {
        const habitId = req.params.id;
        const userId = req.user.id;
        const { date, status = 'completed', notes, value = 1 } = req.body;
        
        const entryDate = date || new Date().toISOString().split('T')[0];
        
        // Проверяем принадлежность привычки
        const habit = await db.get('SELECT * FROM habits WHERE id = ? AND user_id = ?', [habitId, userId]);
        if (!habit) {
            return res.status(404).json({
                success: false,
                error: 'Привычка не найдена'
            });
        }
        
        // Проверяем, есть ли уже отметка на эту дату
        const existingEntry = await db.get(
            'SELECT * FROM habit_entries WHERE user_id = ? AND habit_id = ? AND entry_date = ?',
            [userId, habitId, entryDate]
        );
        
        let result;
        if (existingEntry) {
            // Обновляем существующую запись
            result = await db.run(
                `UPDATE habit_entries SET 
                    status = ?, 
                    notes = ?,
                    value = ?
                 WHERE id = ?`,
                [status, notes, value, existingEntry.id]
            );
        } else {
            // Создаем новую запись
            result = await db.run(
                `INSERT INTO habit_entries 
                (user_id, habit_id, entry_date, status, notes, value) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [userId, habitId, entryDate, status, notes, value]
            );
        }
        
        // Обновляем счетчик серии (стрика)
        if (status === 'completed') {
            await updateHabitStreak(habitId, userId);
        }
        
        // Обновляем статистику
        await updateStatistics(userId, 'habits_completed');
        
        const entry = await db.get(
            'SELECT * FROM habit_entries WHERE user_id = ? AND habit_id = ? AND entry_date = ?',
            [userId, habitId, entryDate]
        );
        
        res.json({
            success: true,
            message: 'Привычка отмечена',
            data: { entry }
        });
        
    } catch (error) {
        console.error('❌ Ошибка отметки привычки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отметки привычки'
        });
    }
});

// Обновление серии привычки
async function updateHabitStreak(habitId, userId) {
    try {
        // Получаем последние записи
        const entries = await db.all(
            `SELECT entry_date, status 
             FROM habit_entries 
             WHERE user_id = ? AND habit_id = ? 
             ORDER BY entry_date DESC
             LIMIT 30`,
            [userId, habitId]
        );
        
        let currentStreak = 0;
        let longestStreak = 0;
        let tempStreak = 0;
        let prevDate = null;
        
        for (const entry of entries) {
            if (entry.status === 'completed') {
                const entryDate = new Date(entry.entry_date);
                
                if (!prevDate || (prevDate.getTime() - entryDate.getTime()) === 86400000) {
                    tempStreak++;
                } else {
                    longestStreak = Math.max(longestStreak, tempStreak);
                    tempStreak = 1;
                }
                
                if (!prevDate || (prevDate.getTime() - entryDate.getTime()) === 86400000) {
                    currentStreak++;
                } else {
                    break;
                }
                
                prevDate = entryDate;
            } else {
                longestStreak = Math.max(longestStreak, tempStreak);
                tempStreak = 0;
                break;
            }
        }
        
        longestStreak = Math.max(longestStreak, tempStreak);
        
        // Обновляем привычку
        await db.run(
            'UPDATE habits SET current_streak = ?, longest_streak = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [currentStreak, longestStreak, habitId]
        );
        
        // Обновляем статистику
        if (currentStreak > 0) {
            await updateStatistics(userId, 'streak_days', currentStreak);
        }
        
        // Проверяем достижения
        if (currentStreak >= 21) {
            await checkAchievements(userId, 'habits');
        }
        
    } catch (error) {
        console.error('Ошибка обновления серии привычки:', error.message);
    }
}

// ==================== ЕЖЕНЕДЕЛЬНОЕ РЕВЬЮ ====================

// Получение ревью
app.get('/api/reviews', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 10, completed } = req.query;
        
        let query = `
            SELECT * FROM weekly_reviews 
            WHERE user_id = ?
        `;
        const params = [userId];
        
        if (completed !== undefined) {
            query += ' AND completed = ?';
            params.push(completed ? 1 : 0);
        }
        
        query += ' ORDER BY week_start_date DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const reviews = await db.all(query, params);
        
        // Парсим JSON поля
        const reviewsWithParsedData = reviews.map(review => ({
            ...review,
            important_tasks: JSON.parse(review.important_tasks || '[]'),
            goals_next_week: JSON.parse(review.goals_next_week || '[]')
        }));
        
        res.json({
            success: true,
            data: {
                reviews: reviewsWithParsedData,
                count: reviews.length
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения ревью:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения ревью'
        });
    }
});

// Создание ревью
app.post('/api/reviews', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            week_start_date,
            week_end_date,
            important_tasks,
            lessons_learned,
            financial_insights,
            goals_next_week,
            mood,
            productivity_score
        } = req.body;
        
        // Проверяем, существует ли уже ревью на эту неделю
        const existingReview = await db.get(
            'SELECT * FROM weekly_reviews WHERE user_id = ? AND week_start_date = ?',
            [userId, week_start_date]
        );
        
        let result;
        if (existingReview) {
            // Обновляем существующее ревью
            result = await db.run(
                `UPDATE weekly_reviews SET 
                    important_tasks = ?,
                    lessons_learned = ?,
                    financial_insights = ?,
                    goals_next_week = ?,
                    mood = ?,
                    productivity_score = ?,
                    completed = 1,
                    completed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [
                    JSON.stringify(important_tasks || []),
                    lessons_learned || '',
                    financial_insights || '',
                    JSON.stringify(goals_next_week || []),
                    mood || null,
                    productivity_score || null,
                    existingReview.id
                ]
            );
        } else {
            // Создаем новое ревью
            result = await db.run(
                `INSERT INTO weekly_reviews 
                (user_id, week_start_date, week_end_date, important_tasks, lessons_learned, 
                 financial_insights, goals_next_week, mood, productivity_score, completed, completed_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
                [
                    userId,
                    week_start_date,
                    week_end_date,
                    JSON.stringify(important_tasks || []),
                    lessons_learned || '',
                    financial_insights || '',
                    JSON.stringify(goals_next_week || []),
                    mood || null,
                    productivity_score || null
                ]
            );
        }
        
        const reviewId = result.lastID || existingReview.id;
        const review = await db.get('SELECT * FROM weekly_reviews WHERE id = ?', [reviewId]);
        
        // Начисляем награды за ревью
        await db.run(
            'UPDATE users SET coins = coins + 50, experience = experience + 25 WHERE id = ?',
            [userId]
        );
        
        // Создаем уведомление
        await db.run(
            `INSERT INTO notifications 
            (user_id, type, title, message, data) 
            VALUES (?, ?, ?, ?, ?)`,
            [
                userId,
                'review_completed',
                'Еженедельное ревью завершено! 🎉',
                'Вы получили 50 монет и 25 опыта за ревью недели',
                JSON.stringify({ review_id: reviewId })
            ]
        );
        
        // Проверяем достижения
        await checkAchievements(userId, 'reviews');
        
        res.status(existingReview ? 200 : 201).json({
            success: true,
            message: 'Еженедельное ревью сохранено',
            data: { 
                review: {
                    ...review,
                    important_tasks: JSON.parse(review.important_tasks || '[]'),
                    goals_next_week: JSON.parse(review.goals_next_week || '[]')
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка создания ревью:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания ревью'
        });
    }
});

// Получение данных для ревью
app.get('/api/reviews/week-data', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { week_start_date, week_end_date } = req.query;
        
        if (!week_start_date || !week_end_date) {
            return res.status(400).json({
                success: false,
                error: 'Укажите начало и конец недели'
            });
        }
        
        // Получаем выполненные задачи за неделю
        const completedTasks = await db.all(
            `SELECT * FROM tasks 
             WHERE user_id = ? 
             AND status = 'completed'
             AND DATE(completed_at) BETWEEN DATE(?) AND DATE(?)
             ORDER BY completed_at DESC`,
            [userId, week_start_date, week_end_date]
        );
        
        // Получаем транзакции за неделю
        const transactions = await db.all(
            `SELECT * FROM transactions 
             WHERE user_id = ? 
             AND DATE(transaction_date) BETWEEN DATE(?) AND DATE(?)
             ORDER BY transaction_date DESC`,
            [userId, week_start_date, week_end_date]
        );
        
        // Анализируем финансы
        const income = transactions.filter(t => t.type === 'income')
            .reduce((sum, t) => sum + parseFloat(t.amount), 0);
        const expenses = transactions.filter(t => t.type === 'expense')
            .reduce((sum, t) => sum + parseFloat(t.amount), 0);
        
        // Анализируем категории расходов
        const expenseCategories = {};
        transactions.filter(t => t.type === 'expense').forEach(t => {
            expenseCategories[t.category] = (expenseCategories[t.category] || 0) + parseFloat(t.amount);
        });
        
        // Формируем финансовые инсайты
        const financialInsights = [];
        const totalExpenses = Object.values(expenseCategories).reduce((a, b) => a + b, 0);
        
        for (const [category, amount] of Object.entries(expenseCategories)) {
            const percentage = totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0;
            if (percentage > 30) {
                financialInsights.push(`${category}: ${percentage}% от всех расходов`);
            }
        }
        
        // Получаем привычки за неделю
        const habitEntries = await db.all(
            `SELECT h.title, he.status, he.entry_date 
             FROM habit_entries he
             JOIN habits h ON he.habit_id = h.id
             WHERE he.user_id = ? 
             AND he.entry_date BETWEEN DATE(?) AND DATE(?)
             ORDER BY he.entry_date DESC`,
            [userId, week_start_date, week_end_date]
        );
        
        res.json({
            success: true,
            data: {
                completed_tasks: completedTasks,
                transactions: transactions,
                financial_summary: {
                    income,
                    expenses,
                    balance: income - expenses,
                    expense_categories: expenseCategories
                },
                financial_insights: financialInsights.length > 0 ? 
                    financialInsights.join('; ') : 'Расходы распределены равномерно',
                habit_entries: habitEntries
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения данных для ревью:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения данных для ревью'
        });
    }
});

// ==================== СТАТИСТИКА ====================

// Получение статистики
app.get('/api/stats', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const { period = 'month' } = req.query;
        
        // Определяем период
        let dateFilter = '';
        switch (period) {
            case 'day':
                dateFilter = 'DATE(date) = DATE("now")';
                break;
            case 'week':
                dateFilter = 'DATE(date) >= DATE("now", "-7 days")';
                break;
            case 'month':
                dateFilter = 'DATE(date) >= DATE("now", "-30 days")';
                break;
            case 'year':
                dateFilter = 'DATE(date) >= DATE("now", "-365 days")';
                break;
        }
        
        // Получаем статистику
        const stats = await db.all(
            `SELECT * FROM statistics 
             WHERE user_id = ? 
             ${dateFilter ? 'AND ' + dateFilter : ''}
             ORDER BY date DESC`,
            [userId]
        );
        
        // Суммируем статистику за период
        const summary = {
            tasks_completed: 0,
            tasks_created: 0,
            pomodoro_sessions: 0,
            total_pomodoro_time: 0,
            income_total: 0,
            expenses_total: 0,
            habits_completed: 0,
            streak_days: 0
        };
        
        stats.forEach(stat => {
            summary.tasks_completed += stat.tasks_completed;
            summary.tasks_created += stat.tasks_created;
            summary.pomodoro_sessions += stat.pomodoro_sessions;
            summary.total_pomodoro_time += stat.total_pomodoro_time;
            summary.income_total += parseFloat(stat.income_total || 0);
            summary.expenses_total += parseFloat(stat.expenses_total || 0);
            summary.habits_completed += stat.habits_completed;
            summary.streak_days = Math.max(summary.streak_days, stat.streak_days);
        });
        
        // Продуктивность по дням недели
        const productivityByDay = await db.all(`
            SELECT 
                strftime('%w', date) as day_of_week,
                AVG(tasks_completed) as avg_tasks,
                AVG(total_pomodoro_time) as avg_pomodoro_time
            FROM statistics 
            WHERE user_id = ? AND date >= DATE('now', '-30 days')
            GROUP BY strftime('%w', date)
            ORDER BY day_of_week
        `, [userId]);
        
        // Еженедельный прогресс
        const weeklyProgress = await db.all(`
            SELECT 
                strftime('%Y-%W', date) as week,
                SUM(tasks_completed) as tasks_completed,
                SUM(habits_completed) as habits_completed
            FROM statistics 
            WHERE user_id = ? AND date >= DATE('now', '-90 days')
            GROUP BY strftime('%Y-%W', date)
            ORDER BY week DESC
            LIMIT 12
        `, [userId]);
        
        res.json({
            success: true,
            data: {
                summary,
                daily_stats: stats,
                productivity_by_day: productivityByDay,
                weekly_progress: weeklyProgress,
                period: period
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения статистики:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// Функция обновления статистики
async function updateStatistics(userId, type, value = 1) {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // Проверяем, есть ли запись на сегодня
        let stat = await db.get('SELECT * FROM statistics WHERE user_id = ? AND date = ?', [userId, today]);
        
        if (!stat) {
            // Создаем новую запись
            await db.run(
                'INSERT INTO statistics (user_id, date) VALUES (?, ?)',
                [userId, today]
            );
            stat = { id: 0 }; // Инициализируем
        }
        
        // Обновляем соответствующее поле
        const updateField = {
            'tasks_completed': 'tasks_completed = tasks_completed + ?',
            'tasks_created': 'tasks_created = tasks_created + ?',
            'pomodoro_sessions': 'pomodoro_sessions = pomodoro_sessions + ?',
            'total_pomodoro_time': 'total_pomodoro_time = total_pomodoro_time + ?',
            'income_total': 'income_total = income_total + ?',
            'expenses_total': 'expenses_total = expenses_total + ?',
            'habits_completed': 'habits_completed = habits_completed + ?',
            'streak_days': 'streak_days = ?'
        }[type];
        
        if (updateField) {
            await db.run(
                `UPDATE statistics SET ${updateField} WHERE user_id = ? AND date = ?`,
                type === 'streak_days' ? [value, userId, today] : [value, userId, today]
            );
        }
        
    } catch (error) {
        console.error('Ошибка обновления статистики:', error.message);
    }
}

// ==================== ДОСТИЖЕНИЯ ====================

// Проверка достижений
async function checkAchievements(userId, type) {
    try {
        // Получаем статистику пользователя
        const stats = await db.get(`
            SELECT 
                (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'completed') as tasks_completed,
                (SELECT COUNT(*) FROM pomodoro_sessions WHERE user_id = ? AND completed = 1) as pomodoro_sessions,
                (SELECT COUNT(*) FROM weekly_reviews WHERE user_id = ? AND completed = 1) as reviews_completed,
                (SELECT MAX(current_streak) FROM habits WHERE user_id = ?) as habit_streak,
                (SELECT COUNT(*) FROM debts WHERE user_id = ? AND status = 'paid') as debts_paid
        `, [userId, userId, userId, userId, userId]);
        
        // Получаем все достижения нужного типа
        const achievements = await db.all(
            'SELECT * FROM achievements WHERE type = ? AND is_active = 1',
            [type]
        );
        
        for (const achievement of achievements) {
            // Проверяем, есть ли уже это достижение у пользователя
            const existing = await db.get(
                'SELECT 1 FROM user_achievements WHERE user_id = ? AND achievement_id = ?',
                [userId, achievement.id]
            );
            
            if (!existing) {
                // Проверяем выполнение условия
                const userValue = stats[achievement.requirement] || 0;
                
                if (userValue >= achievement.requirement_value) {
                    // Начисляем достижение
                    await db.run(
                        'INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?)',
                        [userId, achievement.id]
                    );
                    
                    // Начисляем награды
                    await db.run(
                        'UPDATE users SET coins = coins + ?, experience = experience + ? WHERE id = ?',
                        [achievement.reward_coins, achievement.reward_xp, userId]
                    );
                    
                    // Создаем уведомление
                    await db.run(
                        `INSERT INTO notifications 
                        (user_id, type, title, message, data) 
                        VALUES (?, ?, ?, ?, ?)`,
                        [
                            userId,
                            'achievement_unlocked',
                            `Достижение получено: ${achievement.title} 🏆`,
                            achievement.description,
                            JSON.stringify({
                                achievement_id: achievement.id,
                                coins: achievement.reward_coins,
                                xp: achievement.reward_xp
                            })
                        ]
                    );
                    
                    console.log(`✅ Пользователь ${userId} получил достижение: ${achievement.title}`);
                }
            }
        }
    } catch (error) {
        console.error('Ошибка проверки достижений:', error.message);
    }
}

// ==================== УВЕДОМЛЕНИЯ ====================

// Получение уведомлений
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
        
        res.json({
            success: true,
            data: {
                notifications: notifications.map(n => ({
                    ...n,
                    data: JSON.parse(n.data || '{}')
                })),
                count: notifications.length,
                unread_count: unread_only === 'true' ? notifications.length : 
                    (await db.get('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0', [userId])).count
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

// Отметить уведомление как прочитанное
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
            message: 'Уведомление прочитано'
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления уведомления:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления уведомления'
        });
    }
});

// ==================== ГЛАВНАЯ СТРАНИЦА (ОБЗОР) ====================

// Данные для главной страницы
app.get('/api/dashboard', authMiddleware(), async (req, res) => {
    try {
        const userId = req.user.id;
        const today = new Date().toISOString().split('T')[0];
        
        // Сегодняшние задачи
        const todayTasks = await db.all(
            `SELECT * FROM tasks 
             WHERE user_id = ? 
             AND (DATE(due_date) = DATE(?) OR DATE(reminder_time) = DATE(?))
             AND status != 'completed'
             ORDER BY 
                CASE priority 
                    WHEN "high" THEN 1
                    WHEN "medium" THEN 2
                    WHEN "low" THEN 3
                    ELSE 4
                END,
                due_date ASC
             LIMIT 5`,
            [userId, today, today]
        );
        
        // Ближайшие задачи
        const upcomingTasks = await db.all(
            `SELECT * FROM tasks 
             WHERE user_id = ? 
             AND due_date > DATE('now')
             AND status != 'completed'
             ORDER BY due_date ASC
             LIMIT 5`,
            [userId]
        );
        
        // Последние транзакции
        const recentTransactions = await db.all(
            `SELECT * FROM transactions 
             WHERE user_id = ? 
             ORDER BY transaction_date DESC
             LIMIT 5`,
            [userId]
        );
        
        // Сегодняшние привычки
        const todayHabits = await db.all(`
            SELECT h.*, he.status as today_status
            FROM habits h
            LEFT JOIN habit_entries he ON h.id = he.habit_id AND he.entry_date = DATE('now')
            WHERE h.user_id = ? AND h.is_active = 1
            LIMIT 5
        `, [userId]);
        
        // Статистика
        const stats = {
            tasks_completed_today: await db.get(
                'SELECT COUNT(*) as count FROM tasks WHERE user_id = ? AND status = "completed" AND DATE(completed_at) = DATE("now")',
                [userId]
            ).then(r => r.count),
            total_tasks_completed: await db.get(
                'SELECT COUNT(*) as count FROM tasks WHERE user_id = ? AND status = "completed"',
                [userId]
            ).then(r => r.count),
            current_streak: await db.get(
                'SELECT MAX(current_streak) as streak FROM habits WHERE user_id = ?',
                [userId]
            ).then(r => r.streak || 0),
            balance: await db.get(`
                SELECT 
                    SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
                    SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense
                FROM transactions 
                WHERE user_id = ?
            `, [userId])
        };
        
        // Прогресс дня
        const dayProgress = await db.get(`
            SELECT 
                (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND status = 'completed' AND DATE(completed_at) = DATE('now')) as completed,
                (SELECT COUNT(*) FROM tasks WHERE user_id = ? AND (DATE(due_date) = DATE('now') OR DATE(reminder_time) = DATE('now'))) as total
        `, [userId, userId]);
        
        const progressPercent = dayProgress.total > 0 ? 
            Math.round((dayProgress.completed / dayProgress.total) * 100) : 0;
        
        // Уведомления
        const unreadNotifications = await db.get(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [userId]
        );
        
        res.json({
            success: true,
            data: {
                today_tasks: todayTasks.map(t => ({
                    ...t,
                    subtasks: JSON.parse(t.subtasks || '[]')
                })),
                upcoming_tasks: upcomingTasks.map(t => ({
                    ...t,
                    subtasks: JSON.parse(t.subtasks || '[]')
                })),
                recent_transactions: recentTransactions,
                today_habits: todayHabits.map(h => ({
                    ...h,
                    metadata: JSON.parse(h.metadata || '{}'),
                    reminders: JSON.parse(h.reminders || '[]')
                })),
                stats: {
                    ...stats,
                    balance: (stats.balance?.income || 0) - (stats.balance?.expense || 0),
                    day_progress: progressPercent
                },
                unread_notifications: unreadNotifications?.count || 0
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения данных дашборда:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения данных дашборда'
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
        console.log('🚀 ЗАПУСК ATOMICFLOW - УПРАВЛЕНИЕ ЗАДАЧАМИ, ФИНАНСАМИ И ПРИВЫЧКАМИ');
        console.log('='.repeat(80));
        console.log(`🌐 PORT: ${process.env.PORT || 3000}`);
        console.log(`🏷️  NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📱 Демо-режим: ${DEMO_MODE ? 'ВКЛЮЧЕН' : 'ВЫКЛЮЧЕН'}`);
        console.log(`💾 База данных: ${process.env.NODE_ENV === 'production' ? '/tmp/atomicflow_prod.db' : './atomicflow.db'}`);
        console.log('='.repeat(80));
        
        await initDatabase();
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n✅ Сервер запущен на порту ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
            console.log(`🏥 Health check: http://localhost:${PORT}/health`);
            console.log('='.repeat(80));
            console.log('🚀 ATOMICFLOW ГОТОВ К РАБОТЕ!');
            console.log('='.repeat(80));
            
            console.log('\n📊 ОСНОВНЫЕ ВОЗМОЖНОСТИ:');
            console.log('='.repeat(60));
            console.log('✅ Управление задачами с приоритетами и тегами');
            console.log('✅ Таймер Pomodoro для фокусировки');
            console.log('✅ Учет доходов и расходов');
            console.log('✅ Метод "Снежного кома" для выплаты долгов');
            console.log('✅ Трекер привычек с календарем');
            console.log('✅ Еженедельные ревью с аналитикой');
            console.log('✅ Система достижений и наград');
            console.log('✅ Статистика и графики продуктивности');
            console.log('='.repeat(60));
            
            console.log('\n🔑 ТЕСТОВЫЙ АККАУНТ:');
            console.log('='.repeat(50));
            console.log('👤 Пользователь: demo@atomicflow.test / demo123');
            console.log('='.repeat(50));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        process.exit(1);
    }
};

// Запуск
startServer();
