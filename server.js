require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

const app = express();

// CORS настройки
const corsOptions = {
    origin: [
        'http://localhost:3000',
        'http://localhost:8080',
        'https://sergeynikishin555123123-lab-itprogrammistingbot-8f42.twc1.net'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Статические файлы
app.use(express.static('public'));

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных QuantumFlow...');
        
        // Проверяем и создаем директорию если нужно
        const dbDir = path.dirname(__dirname);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        // Путь к базе данных
        const dbPath = path.join(__dirname, 'quantumflow.db');
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');

        // Создание таблиц
        await createTables();
        
        // Создаем демо-данные
        await createDemoData();
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error.message);
        throw error;
    }
};

const createTables = async () => {
    try {
        console.log('📊 Создание таблиц...');
        
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE,
                password TEXT NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT,
                avatar_url TEXT,
                goal TEXT DEFAULT 'productivity',
                level INTEGER DEFAULT 1,
                coins INTEGER DEFAULT 100,
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
                pomodoro_sessions INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS habits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                icon TEXT DEFAULT 'fas fa-star',
                description TEXT,
                streak INTEGER DEFAULT 0,
                current_streak INTEGER DEFAULT 0,
                best_streak INTEGER DEFAULT 0,
                marked_today INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
                amount REAL NOT NULL,
                category TEXT DEFAULT 'other',
                description TEXT,
                date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS financial_goals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                target_amount REAL NOT NULL,
                current_amount REAL DEFAULT 0,
                deadline DATE,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS health_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                weight REAL,
                steps INTEGER DEFAULT 0,
                calories INTEGER DEFAULT 0,
                water_ml INTEGER DEFAULT 0,
                activity_level TEXT DEFAULT 'medium',
                date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

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

        await db.exec(`
            CREATE TABLE IF NOT EXISTS daily_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                rating INTEGER DEFAULT 5,
                successes TEXT,
                improvements TEXT,
                tomorrow_goals TEXT,
                date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS best_practices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                icon TEXT DEFAULT 'fas fa-lightbulb',
                description TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                is_active INTEGER DEFAULT 1,
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
        console.log('📝 Создание демо-данных...');

        // Проверяем существование демо-пользователя
        const demoUser = await db.get("SELECT 1 FROM users WHERE email = 'demo@quantumflow.test'");
        if (!demoUser) {
            const passwordHash = await bcrypt.hash('demo123', 12);
            
            await db.run(
                `INSERT INTO users 
                (email, username, password, first_name, goal, level, coins, streak, balance, monthly_income, monthly_expenses, tasks_completed) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    'demo@quantumflow.test',
                    'demo_user',
                    passwordHash,
                    'Демо',
                    'productivity',
                    3,
                    1250,
                    12,
                    15840,
                    32500,
                    17600,
                    87
                ]
            );
            
            console.log('✅ Демо-пользователь создан');
        }

        // Получаем ID демо-пользователя
        const userId = await db.get("SELECT id FROM users WHERE email = 'demo@quantumflow.test'");
        if (!userId) return;

        // Создаем демо-задачи
        const tasksExist = await db.get("SELECT 1 FROM tasks LIMIT 1");
        if (!tasksExist) {
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
            console.log('✅ Демо-задачи созданы');
        }

        // Создаем демо-привычки
        const habitsExist = await db.get("SELECT 1 FROM habits LIMIT 1");
        if (!habitsExist) {
            const habits = [
                [userId.id, 'Пить воду', 'fas fa-tint', 'Выпивать 2 литра воды в день', 12, 12, 12, 1],
                [userId.id, '15 минут уборки', 'fas fa-broom', 'Короткая уборка каждый день', 8, 8, 8, 1],
                [userId.id, 'Чтение 20 мин', 'fas fa-book', 'Чтение перед сном', 5, 5, 5, 0]
            ];
            
            for (const habit of habits) {
                await db.run(
                    `INSERT INTO habits (user_id, title, icon, description, streak, current_streak, best_streak, marked_today)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    habit
                );
            }
            console.log('✅ Демо-привычки созданы');
        }

        // Создаем демо-транзакции
        const transactionsExist = await db.get("SELECT 1 FROM transactions LIMIT 1");
        if (!transactionsExist) {
            const transactions = [
                [userId.id, 'income', 50000, 'salary', 'Зарплата'],
                [userId.id, 'expense', 350, 'food', 'Обед'],
                [userId.id, 'expense', 1200, 'transport', 'Такси'],
                [userId.id, 'expense', 2500, 'entertainment', 'Кино'],
                [userId.id, 'expense', 1800, 'shopping', 'Книги'],
                [userId.id, 'expense', 3200, 'house', 'Коммунальные услуги'],
                [userId.id, 'expense', 1500, 'health', 'Аптека'],
                [userId.id, 'expense', 2800, 'education', 'Курсы']
            ];
            
            for (const transaction of transactions) {
                await db.run(
                    `INSERT INTO transactions (user_id, type, amount, category, description)
                     VALUES (?, ?, ?, ?, ?)`,
                    transaction
                );
            }
            console.log('✅ Демо-транзакции созданы');
        }

        // Создаем финансовую цель
        const goalsExist = await db.get("SELECT 1 FROM financial_goals LIMIT 1");
        if (!goalsExist) {
            await db.run(
                `INSERT INTO financial_goals (user_id, title, target_amount, current_amount, deadline)
                 VALUES (?, ?, ?, ?, ?)`,
                [userId.id, 'Новый ноутбук', 150000, 45000, '2024-12-31']
            );
            console.log('✅ Демо-цель создана');
        }

        // Создаем метрики здоровья
        const healthExist = await db.get("SELECT 1 FROM health_metrics LIMIT 1");
        if (!healthExist) {
            await db.run(
                `INSERT INTO health_metrics (user_id, weight, steps, calories, water_ml, activity_level)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [userId.id, 75.5, 8450, 2100, 1500, 'medium']
            );
            console.log('✅ Демо-метрики здоровья созданы');
        }

        // Создаем достижения
        const achievementsExist = await db.get("SELECT 1 FROM achievements LIMIT 1");
        if (!achievementsExist) {
            const achievements = [
                [userId.id, 'welcome', 'Первые шаги', 'Добро пожаловать в QuantumFlow!'],
                [userId.id, 'tasks', 'Трудоголик', 'Выполнено 50 задач'],
                [userId.id, 'habits', 'Мастер привычек', '30 дней подряд привычки'],
                [userId.id, 'finance', 'Финансист', 'Накоплено 100,000 ₽'],
                [userId.id, 'streak', 'Железная воля', 'Активная серия 14 дней']
            ];
            
            for (const achievement of achievements) {
                await db.run(
                    `INSERT INTO achievements (user_id, type, title, description)
                     VALUES (?, ?, ?, ?)`,
                    achievement
                );
            }
            console.log('✅ Демо-достижения созданы');
        }

        // Создаем лучшие практики
        const practicesExist = await db.get("SELECT 1 FROM best_practices LIMIT 1");
        if (!practicesExist) {
            const practices = [
                ['Правило 2 минут', 'fas fa-clock', 'Если задача занимает менее 2 минут, делайте её сразу', 'productivity'],
                ['Метод Pomodoro', 'fas fa-hourglass-half', '25 минут работы, 5 минут отдыха', 'productivity'],
                ['Пить воду утром', 'fas fa-tint', 'Выпивайте стакан воды сразу после пробуждения', 'health'],
                ['Ведение бюджета', 'fas fa-chart-pie', 'Записывайте все доходы и расходы', 'finance'],
                ['Планирование дня', 'fas fa-calendar-check', 'Составляйте план на день с вечера', 'productivity'],
                ['Цифровой детокс', 'fas fa-mobile-alt', 'Отключайте уведомления во время работы', 'productivity'],
                ['Регулярные перерывы', 'fas fa-coffee', 'Делайте перерыв каждые 90 минут', 'health']
            ];
            
            for (const practice of practices) {
                await db.run(
                    `INSERT INTO best_practices (title, icon, description, category)
                     VALUES (?, ?, ?, ?)`,
                    practice
                );
            }
            console.log('✅ Лучшие практики созданы');
        }

        console.log('🎉 Демо-данные созданы!');
        
    } catch (error) {
        console.error('⚠️ Ошибка создания демо-данных:', error.message);
    }
};

// ==================== JWT МИДЛВАР ====================
const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ 
                success: false, 
                error: 'Требуется авторизация' 
            });
        }
        
        const token = authHeader.replace('Bearer ', '').trim();
        
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'quantumflow-secret-key-2024');
            
            const user = await db.get(
                `SELECT id, email, username, first_name, last_name, goal,
                        level, coins, streak, balance, monthly_income, monthly_expenses,
                        tasks_completed, habits_streak
                 FROM users WHERE id = ? AND is_active = 1`,
                [decoded.id]
            );
            
            if (!user) {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Пользователь не найден' 
                });
            }
            
            req.user = user;
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
        message: '🚀 Добро пожаловать в QuantumFlow API',
        version: '1.0.0',
        status: '🟢 Работает',
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
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'ERROR',
            error: error.message
        });
    }
});

// ==================== АУТЕНТИФИКАЦИЯ ====================

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, username, password, first_name, last_name = '' } = req.body;
        
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
        
        const existingUser = await db.get(
            'SELECT id FROM users WHERE email = ? OR username = ?', 
            [email, username]
        );
        
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь с таким email или именем уже существует'
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 12);
        
        const result = await db.run(
            `INSERT INTO users (email, username, password, first_name, last_name) 
             VALUES (?, ?, ?, ?, ?)`,
            [email, username, hashedPassword, first_name, last_name]
        );
        
        const userId = result.lastID;
        
        // Создаем первое достижение
        await db.run(
            `INSERT INTO achievements (user_id, type, title, description) 
             VALUES (?, 'welcome', 'Первые шаги', 'Добро пожаловать в QuantumFlow!')`,
            [userId]
        );
        
        const user = await db.get(
            `SELECT id, email, username, first_name, last_name, goal,
                    level, coins, streak, balance, monthly_income, monthly_expenses,
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
            process.env.JWT_SECRET || 'quantumflow-secret-key-2024',
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
            goal: user.goal,
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
            process.env.JWT_SECRET || 'quantumflow-secret-key-2024',
            { expiresIn: '30d' }
        );
        
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

// Обновление цели пользователя
app.put('/api/user/goal', authMiddleware, async (req, res) => {
    try {
        const { goal } = req.body;
        
        if (!goal) {
            return res.status(400).json({
                success: false,
                error: 'Укажите цель'
            });
        }
        
        await db.run(
            'UPDATE users SET goal = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [goal, req.user.id]
        );
        
        const user = await db.get(
            `SELECT id, email, username, first_name, goal,
                    level, coins, streak, balance, monthly_income, monthly_expenses,
                    tasks_completed, habits_streak
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        res.json({
            success: true,
            message: 'Цель обновлена',
            data: { user }
        });
        
    } catch (error) {
        console.error('Ошибка обновления цели:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления цели'
        });
    }
});

// Получение текущего пользователя
app.get('/api/user/current', authMiddleware, async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, username, first_name, last_name, goal,
                    level, coins, streak, balance, monthly_income, monthly_expenses,
                    tasks_completed, habits_streak
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        res.json({
            success: true,
            data: user
        });
        
    } catch (error) {
        console.error('Ошибка получения пользователя:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения пользователя'
        });
    }
});

// ==================== СТАТИСТИКА ====================

// Общая статистика для главной страницы
app.get('/api/stats/overview', authMiddleware, async (req, res) => {
    try {
        // Статистика пользователя
        const userStats = await db.get(
            `SELECT level, coins, streak, tasks_completed, habits_streak
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        // Статистика задач
        const tasksStats = await db.get(
            `SELECT COUNT(*) as total,
                    SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) as pending
             FROM tasks WHERE user_id = ? AND DATE(due_date) = DATE('now')`,
            [req.user.id]
        );
        
        // Последние задачи
        const recentTasks = await db.all(
            `SELECT id, title, tag, time, completed
             FROM tasks 
             WHERE user_id = ? AND (due_date IS NULL OR DATE(due_date) >= DATE('now'))
             ORDER BY due_date ASC, time ASC
             LIMIT 5`,
            [req.user.id]
        );
        
        // Статистика финансов
        const financeStats = await db.get(
            `SELECT balance, monthly_income, monthly_expenses
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                user_stats: userStats,
                tasks_stats: tasksStats,
                recent_tasks: recentTasks,
                finance_stats: financeStats
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

// ==================== ЗАДАЧИ ====================

// Получение всех задач
app.get('/api/tasks', authMiddleware, async (req, res) => {
    try {
        const { completed, tag } = req.query;
        
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

// Получение одной задачи
app.get('/api/tasks/:id', authMiddleware, async (req, res) => {
    try {
        const taskId = req.params.id;
        
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ? AND user_id = ?',
            [taskId, req.user.id]
        );
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        res.json({
            success: true,
            data: { task }
        });
        
    } catch (error) {
        console.error('Ошибка получения задачи:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задачи'
        });
    }
});

// Создание задачи
app.post('/api/tasks', authMiddleware, async (req, res) => {
    try {
        const { title, description, tag, priority, due_date, time } = req.body;
        
        if (!title) {
            return res.status(400).json({
                success: false,
                error: 'Заполните название задачи'
            });
        }
        
        const result = await db.run(
            `INSERT INTO tasks 
            (user_id, title, description, tag, priority, due_date, time) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                title,
                description || null,
                tag || '#общее',
                priority || 'medium',
                due_date || null,
                time || null
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
app.put('/api/tasks/:id', authMiddleware, async (req, res) => {
    try {
        const taskId = req.params.id;
        const { title, description, tag, priority, due_date, time, completed } = req.body;
        
        const task = await db.get(
            'SELECT * FROM tasks WHERE id = ? AND user_id = ?',
            [taskId, req.user.id]
        );
        
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

// ==================== ПРИВЫЧКИ ====================

// Получение привычек
app.get('/api/habits', authMiddleware, async (req, res) => {
    try {
        const habits = await db.all(
            `SELECT * FROM habits 
             WHERE user_id = ? AND is_active = 1 
             ORDER BY streak DESC`,
            [req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                habits,
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
app.post('/api/habits', authMiddleware, async (req, res) => {
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
            data: { habit }
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
app.post('/api/habits/:id/mark', authMiddleware, async (req, res) => {
    try {
        const habitId = req.params.id;
        
        const habit = await db.get(
            'SELECT * FROM habits WHERE id = ? AND user_id = ?',
            [habitId, req.user.id]
        );
        
        if (!habit) {
            return res.status(404).json({
                success: false,
                error: 'Привычка не найдена'
            });
        }
        
        // Проверяем, не отмечена ли уже сегодня
        if (habit.marked_today) {
            return res.status(400).json({
                success: false,
                error: 'Привычка уже отмечена сегодня'
            });
        }
        
        // Обновляем стрик
        const newStreak = habit.streak + 1;
        const newCurrentStreak = habit.current_streak + 1;
        const newBestStreak = Math.max(habit.best_streak, newCurrentStreak);
        
        await db.run(
            `UPDATE habits SET 
                marked_today = 1,
                streak = ?,
                current_streak = ?,
                best_streak = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [newStreak, newCurrentStreak, newBestStreak, habitId]
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
            data: { habit: updatedHabit }
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

// Получение статистики финансов
app.get('/api/finance/stats', authMiddleware, async (req, res) => {
    try {
        // Баланс пользователя
        const userStats = await db.get(
            'SELECT balance, monthly_income, monthly_expenses FROM users WHERE id = ?',
            [req.user.id]
        );
        
        // Финансовые цели
        const goals = await db.all(
            'SELECT * FROM financial_goals WHERE user_id = ? AND is_active = 1',
            [req.user.id]
        );
        
        // Статистика по категориям
        const categoryStats = await db.all(
            `SELECT category, SUM(amount) as total
             FROM transactions 
             WHERE user_id = ? AND type = 'expense' 
             GROUP BY category
             ORDER BY total DESC`,
            [req.user.id]
        );
        
        // Общий баланс
        const incomeStats = await db.get(
            'SELECT SUM(amount) as total FROM transactions WHERE user_id = ? AND type = "income"',
            [req.user.id]
        );
        
        const expenseStats = await db.get(
            'SELECT SUM(amount) as total FROM transactions WHERE user_id = ? AND type = "expense"',
            [req.user.id]
        );
        
        const balance = (incomeStats?.total || 0) - (expenseStats?.total || 0);
        
        // Обновляем баланс пользователя
        await db.run(
            'UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [balance, req.user.id]
        );
        
        res.json({
            success: true,
            data: {
                balance: balance,
                monthly_income: userStats?.monthly_income || 0,
                monthly_expenses: userStats?.monthly_expenses || 0,
                goals: goals || [],
                category_stats: categoryStats || []
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения статистики финансов:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики финансов'
        });
    }
});

// Получение транзакций
app.get('/api/transactions', authMiddleware, async (req, res) => {
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
        
        res.json({
            success: true,
            data: {
                transactions,
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
app.post('/api/transactions', authMiddleware, async (req, res) => {
    try {
        const { type, amount, category, description, date } = req.body;
        
        if (!type || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Заполните тип и сумму транзакции'
            });
        }
        
        const result = await db.run(
            `INSERT INTO transactions 
            (user_id, type, amount, category, description, date) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                type,
                parseFloat(amount),
                category || 'other',
                description || null,
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

// ==================== ФИНАНСОВЫЕ ЦЕЛИ ====================

// Создание финансовой цели
app.post('/api/financial-goals', authMiddleware, async (req, res) => {
    try {
        const { title, target_amount, current_amount, deadline } = req.body;
        
        if (!title || !target_amount) {
            return res.status(400).json({
                success: false,
                error: 'Заполните название и целевую сумму'
            });
        }
        
        // Деактивируем старые цели
        await db.run(
            'UPDATE financial_goals SET is_active = 0 WHERE user_id = ?',
            [req.user.id]
        );
        
        const result = await db.run(
            `INSERT INTO financial_goals 
            (user_id, title, target_amount, current_amount, deadline) 
            VALUES (?, ?, ?, ?, ?)`,
            [
                req.user.id,
                title,
                parseFloat(target_amount),
                parseFloat(current_amount) || 0,
                deadline || null
            ]
        );
        
        const goalId = result.lastID;
        const goal = await db.get('SELECT * FROM financial_goals WHERE id = ?', [goalId]);
        
        res.status(201).json({
            success: true,
            message: 'Финансовая цель создана',
            data: { goal }
        });
        
    } catch (error) {
        console.error('Ошибка создания финансовой цели:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания финансовой цели'
        });
    }
});

// ==================== ЗДОРОВЬЕ ====================

// Получение статистики здоровья
app.get('/api/health/stats', authMiddleware, async (req, res) => {
    try {
        // Последние метрики
        const currentMetrics = await db.get(
            `SELECT weight, steps, calories, water_ml, activity_level
             FROM health_metrics 
             WHERE user_id = ? 
             ORDER BY date DESC 
             LIMIT 1`,
            [req.user.id]
        );
        
        // Дефолтные значения
        const metrics = currentMetrics || {
            weight: null,
            steps: 0,
            calories: 0,
            water_ml: 0,
            activity_level: 'medium'
        };
        
        res.json({
            success: true,
            data: {
                current_metrics: metrics
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения статистики здоровья:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики здоровья'
        });
    }
});

// Сохранение метрик здоровья
app.post('/api/health/metrics', authMiddleware, async (req, res) => {
    try {
        const { weight, steps, calories, water_ml, activity_level } = req.body;
        
        // Проверяем существование записи на сегодня
        const existingMetric = await db.get(
            'SELECT id FROM health_metrics WHERE user_id = ? AND date = DATE("now")',
            [req.user.id]
        );
        
        if (existingMetric) {
            // Обновляем существующую запись
            await db.run(
                `UPDATE health_metrics SET 
                    weight = COALESCE(?, weight),
                    steps = COALESCE(?, steps),
                    calories = COALESCE(?, calories),
                    water_ml = COALESCE(?, water_ml),
                    activity_level = COALESCE(?, activity_level)
                 WHERE id = ?`,
                [
                    weight || null,
                    steps || 0,
                    calories || 0,
                    water_ml || 0,
                    activity_level || 'medium',
                    existingMetric.id
                ]
            );
        } else {
            // Создаем новую запись
            await db.run(
                `INSERT INTO health_metrics 
                (user_id, weight, steps, calories, water_ml, activity_level) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    req.user.id,
                    weight || null,
                    steps || 0,
                    calories || 0,
                    water_ml || 0,
                    activity_level || 'medium'
                ]
            );
        }
        
        res.json({
            success: true,
            message: 'Метрики здоровья сохранены'
        });
        
    } catch (error) {
        console.error('Ошибка сохранения метрик здоровья:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения метрик здоровья'
        });
    }
});

// Трекинг воды
app.post('/api/health/water', authMiddleware, async (req, res) => {
    try {
        const { amount } = req.body;
        
        if (!amount) {
            return res.status(400).json({
                success: false,
                error: 'Укажите количество воды'
            });
        }
        
        // Получаем текущие метрики
        const currentMetrics = await db.get(
            'SELECT * FROM health_metrics WHERE user_id = ? AND date = DATE("now")',
            [req.user.id]
        );
        
        if (currentMetrics) {
            // Обновляем существующую запись
            await db.run(
                'UPDATE health_metrics SET water_ml = water_ml + ? WHERE id = ?',
                [amount, currentMetrics.id]
            );
        } else {
            // Создаем новую запись
            await db.run(
                'INSERT INTO health_metrics (user_id, water_ml) VALUES (?, ?)',
                [req.user.id, amount]
            );
        }
        
        res.json({
            success: true,
            message: 'Вода добавлена'
        });
        
    } catch (error) {
        console.error('Ошибка добавления воды:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка добавления воды'
        });
    }
});

// Получение трекера воды
app.get('/api/health/water-tracking', authMiddleware, async (req, res) => {
    try {
        // Получаем текущее количество воды
        const currentMetrics = await db.get(
            'SELECT water_ml FROM health_metrics WHERE user_id = ? AND date = DATE("now")',
            [req.user.id]
        );
        
        const waterMl = currentMetrics?.water_ml || 0;
        const bottlesCount = Math.floor(waterMl / 250);
        const bottles = Array.from({ length: 8 }, (_, i) => i < bottlesCount);
        
        res.json({
            success: true,
            data: {
                water_ml: waterMl,
                bottles: bottles
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения трекера воды:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения трекера воды'
        });
    }
});

// ==================== ЛУЧШИЕ ПРАКТИКИ ====================

// Получение лучших практик
app.get('/api/best-practices', authMiddleware, async (req, res) => {
    try {
        const practices = await db.all(
            'SELECT * FROM best_practices WHERE is_active = 1 ORDER BY created_at DESC'
        );
        
        res.json({
            success: true,
            data: {
                practices,
                count: practices.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения лучших практик:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения лучших практик'
        });
    }
});

// ==================== ДОСТИЖЕНИЯ ====================

// Получение достижений
app.get('/api/achievements', authMiddleware, async (req, res) => {
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

// Проверка достижений
app.post('/api/achievements/check', authMiddleware, async (req, res) => {
    try {
        const awarded = [];
        
        // Проверяем различные достижения
        
        // 1. Достижение за задачи
        const taskCount = await db.get(
            'SELECT COUNT(*) as count FROM tasks WHERE user_id = ? AND completed = 1',
            [req.user.id]
        );
        
        if (taskCount.count >= 50) {
            const existingAchievement = await db.get(
                'SELECT 1 FROM achievements WHERE user_id = ? AND type = "tasks"',
                [req.user.id]
            );
            
            if (!existingAchievement) {
                await db.run(
                    `INSERT INTO achievements (user_id, type, title, description) 
                     VALUES (?, 'tasks', 'Трудоголик', 'Выполнено 50 задач')`,
                    [req.user.id]
                );
                awarded.push('Трудоголик');
            }
        }
        
        // 2. Достижение за привычки
        const habitStreak = await db.get(
            'SELECT MAX(streak) as max_streak FROM habits WHERE user_id = ?',
            [req.user.id]
        );
        
        if (habitStreak.max_streak >= 30) {
            const existingAchievement = await db.get(
                'SELECT 1 FROM achievements WHERE user_id = ? AND type = "habits"',
                [req.user.id]
            );
            
            if (!existingAchievement) {
                await db.run(
                    `INSERT INTO achievements (user_id, type, title, description) 
                     VALUES (?, 'habits', 'Мастер привычек', '30 дней подряд привычки')`,
                    [req.user.id]
                );
                awarded.push('Мастер привычек');
            }
        }
        
        // 3. Достижение за финансы
        const userBalance = await db.get(
            'SELECT balance FROM users WHERE id = ?',
            [req.user.id]
        );
        
        if (userBalance.balance >= 100000) {
            const existingAchievement = await db.get(
                'SELECT 1 FROM achievements WHERE user_id = ? AND type = "finance"',
                [req.user.id]
            );
            
            if (!existingAchievement) {
                await db.run(
                    `INSERT INTO achievements (user_id, type, title, description) 
                     VALUES (?, 'finance', 'Финансист', 'Накоплено 100,000 ₽')`,
                    [req.user.id]
                );
                awarded.push('Финансист');
            }
        }
        
        res.json({
            success: true,
            data: {
                awarded: awarded,
                count: awarded.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка проверки достижений:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка проверки достижений'
        });
    }
});

// ==================== SPA МАРШРУТИЗАЦИЯ ====================
app.get('*', (req, res) => {
    // Проверяем, не является ли запрос API или статическим файлом
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ 
            success: false, 
            error: 'API endpoint not found' 
        });
    }
    
    // Отдаем index.html для всех остальных маршрутов
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
        console.log('🚀 ЗАПУСК QUANTUMFLOW v1.0.0');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        console.log('✅ Все API настроены');
        console.log('✅ Система готова к работе');
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`🚀 QuantumFlow запущен на порту ${PORT}!`);
            console.log(`🌐 Доступ по адресу: http://localhost:${PORT}`);
            console.log(`📊 Проверка здоровья: http://localhost:${PORT}/health`);
            console.log('='.repeat(80));
            console.log('🔑 ДЕМО АККАУНТ:');
            console.log('='.repeat(50));
            console.log('👤 Email: demo@quantumflow.test');
            console.log('🔐 Пароль: demo123');
            console.log('='.repeat(50));
            
            console.log('\n📊 ОСНОВНЫЕ ФУНКЦИОНАЛЬНОСТИ:');
            console.log('='.repeat(60));
            console.log('✅ Управление задачами с тегами и приоритетами');
            console.log('✅ Трекер привычек');
            console.log('✅ Финансовый трекер с целями');
            console.log('✅ Трекер здоровья и воды');
            console.log('✅ Таймер Pomodoro');
            console.log('✅ Система достижений и монет');
            console.log('✅ Ежедневные ревью');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        // Пробуем использовать базу данных в памяти как запасной вариант
        console.log('🔄 Пробуем использовать базу данных в памяти...');
        
        try {
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            console.log('✅ Используем базу данных в памяти');
            await createTables();
            
            const PORT = process.env.PORT || 3000;
            app.listen(PORT, () => {
                console.log(`🚀 QuantumFlow запущен на порту ${PORT} (база в памяти)!`);
                console.log(`⚠️ ВНИМАНИЕ: Данные будут сброшены при перезагрузке сервера`);
            });
        } catch (memoryError) {
            console.error('❌ Не удалось создать базу в памяти:', memoryError.message);
            process.exit(1);
        }
    }
};

// Запуск
startServer();
