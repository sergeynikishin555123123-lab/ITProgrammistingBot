require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

const app = express();

// Настройки CORS
const corsOptions = {
    origin: ['http://localhost:3000', 'http://localhost:8080', 'https://yourdomain.com'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

let db;

// Инициализация базы данных
const initDatabase = async () => {
    try {
        const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/quantumflow.db' : './quantumflow.db';
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        await db.run('PRAGMA foreign_keys = ON');

        // Создание таблиц
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT,
                avatar_url TEXT,
                goal TEXT DEFAULT 'finance',
                level INTEGER DEFAULT 1,
                coins INTEGER DEFAULT 100,
                streak INTEGER DEFAULT 0,
                balance REAL DEFAULT 0,
                monthly_income REAL DEFAULT 0,
                monthly_expenses REAL DEFAULT 0,
                tasks_completed INTEGER DEFAULT 0,
                health_streak INTEGER DEFAULT 0,
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
                priority TEXT DEFAULT 'medium',
                due_date DATE,
                time TEXT,
                completed INTEGER DEFAULT 0,
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                category TEXT DEFAULT 'other',
                description TEXT,
                date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
            CREATE TABLE IF NOT EXISTS financial_goals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                target_amount REAL NOT NULL,
                current_amount REAL DEFAULT 0,
                deadline DATE,
                is_active INTEGER DEFAULT 1,
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
            CREATE TABLE IF NOT EXISTS best_practices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT DEFAULT 'productivity',
                icon TEXT DEFAULT 'fas fa-lightbulb',
                priority INTEGER DEFAULT 1,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ База данных инициализирована');

        // Заполнение лучших практик
        await seedBestPractices();

    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error);
        process.exit(1);
    }
};

const seedBestPractices = async () => {
    const practices = [
        {
            title: 'Метод помидора',
            description: 'Работайте 25 минут, затем делайте 5-минутный перерыв. После 4 помидоров — длинный перерыв 15-30 минут.',
            category: 'productivity',
            icon: 'fas fa-clock',
            priority: 1
        },
        {
            title: 'Правило 2 минут',
            description: 'Если задача занимает меньше 2 минут — сделайте ее сразу. Это уменьшает нагрузку на память.',
            category: 'productivity',
            icon: 'fas fa-hourglass-half',
            priority: 2
        },
        {
            title: 'Съешьте лягушку',
            description: 'Начинайте день с самой сложной задачи. Это даст энергию на остальной день.',
            category: 'productivity',
            icon: 'fas fa-frog',
            priority: 3
        },
        {
            title: 'Правило 50/30/20',
            description: '50% дохода на нужды, 30% на хочу, 20% на сбережения и долги.',
            category: 'finance',
            icon: 'fas fa-chart-pie',
            priority: 1
        },
        {
            title: 'Автоматизация сбережений',
            description: 'Настройте автоматическое списание 10-20% от каждого дохода на сберегательный счет.',
            category: 'finance',
            icon: 'fas fa-robot',
            priority: 2
        },
        {
            title: 'Пить воду утром',
            description: 'Выпивайте стакан воды сразу после пробуждения для запуска метаболизма.',
            category: 'health',
            icon: 'fas fa-tint',
            priority: 1
        },
        {
            title: '10 минут растяжки',
            description: 'Ежедневная растяжка улучшает гибкость и предотвращает травмы.',
            category: 'health',
            icon: 'fas fa-spa',
            priority: 2
        }
    ];

    for (const practice of practices) {
        const exists = await db.get('SELECT 1 FROM best_practices WHERE title = ?', [practice.title]);
        if (!exists) {
            await db.run(
                'INSERT INTO best_practices (title, description, category, icon, priority) VALUES (?, ?, ?, ?, ?)',
                [practice.title, practice.description, practice.category, practice.icon, practice.priority]
            );
        }
    }
};

// Middleware аутентификации
const authMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ 
                success: false, 
                error: 'Требуется авторизация' 
            });
        }
        
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'quantumflow-secret-2024');
        
        req.userId = decoded.id;
        next();
    } catch (error) {
        return res.status(401).json({ 
            success: false, 
            error: 'Неверный токен' 
        });
    }
};

// API маршруты

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, username, password, first_name, last_name } = req.body;
        
        if (!email || !password || !first_name) {
            return res.status(400).json({
                success: false,
                error: 'Заполните обязательные поля'
            });
        }
        
        // Проверка существующего пользователя
        const existingUser = await db.get('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Пользователь уже существует'
            });
        }
        
        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 12);
        
        // Создание пользователя
        const result = await db.run(
            `INSERT INTO users (email, username, password, first_name, last_name, coins) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [email, username, hashedPassword, first_name, last_name || '', 100]
        );
        
        const userId = result.lastID;
        
        // Создание достижения
        await db.run(
            'INSERT INTO achievements (user_id, type, title, description) VALUES (?, ?, ?, ?)',
            [userId, 'welcome', 'Добро пожаловать!', 'Вы зарегистрировались в QuantumFlow']
        );
        
        // Генерация токена
        const token = jwt.sign(
            { id: userId, email, username },
            process.env.JWT_SECRET || 'quantumflow-secret-2024',
            { expiresIn: '30d' }
        );
        
        // Получение данных пользователя
        const user = await db.get(
            `SELECT id, email, username, first_name, last_name, avatar_url, 
                    level, coins, streak, balance, monthly_income, monthly_expenses,
                    tasks_completed, health_streak, goal
             FROM users WHERE id = ?`,
            [userId]
        );
        
        res.status(201).json({
            success: true,
            data: {
                user,
                token
            }
        });
        
    } catch (error) {
        console.error('Registration error:', error);
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
                error: 'Заполните все поля'
            });
        }
        
        // Поиск пользователя
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
        
        // Проверка пароля
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                error: 'Неверный пароль'
            });
        }
        
        // Обновление последнего входа
        await db.run(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );
        
        // Генерация токена
        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username },
            process.env.JWT_SECRET || 'quantumflow-secret-2024',
            { expiresIn: '30d' }
        );
        
        // Подготовка данных пользователя для ответа
        const userData = {
            id: user.id,
            email: user.email,
            username: user.username,
            first_name: user.first_name,
            last_name: user.last_name,
            avatar_url: user.avatar_url,
            level: user.level,
            coins: user.coins,
            streak: user.streak,
            balance: user.balance,
            monthly_income: user.monthly_income,
            monthly_expenses: user.monthly_expenses,
            tasks_completed: user.tasks_completed,
            health_streak: user.health_streak,
            goal: user.goal
        };
        
        res.json({
            success: true,
            data: {
                user: userData,
                token
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка входа'
        });
    }
});

// Текущий пользователь
app.get('/api/user/current', authMiddleware, async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, username, first_name, last_name, avatar_url, 
                    level, coins, streak, balance, monthly_income, monthly_expenses,
                    tasks_completed, health_streak, goal
             FROM users WHERE id = ?`,
            [req.userId]
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
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения данных'
        });
    }
});

// Задачи

// Получение задач
app.get('/api/tasks', authMiddleware, async (req, res) => {
    try {
        const { date, completed } = req.query;
        
        let query = 'SELECT * FROM tasks WHERE user_id = ?';
        const params = [req.userId];
        
        if (date) {
            query += ' AND date(due_date) = date(?)';
            params.push(date);
        }
        
        if (completed !== undefined) {
            query += ' AND completed = ?';
            params.push(completed === 'true' ? 1 : 0);
        }
        
        query += ' ORDER BY created_at DESC';
        
        const tasks = await db.all(query, params);
        
        res.json({
            success: true,
            data: { tasks }
        });
        
    } catch (error) {
        console.error('Get tasks error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения задач'
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
                error: 'Название задачи обязательно'
            });
        }
        
        const result = await db.run(
            `INSERT INTO tasks (user_id, title, description, tag, priority, due_date, time)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.userId, title, description || null, tag || '#общее', priority || 'medium', due_date || null, time || null]
        );
        
        const taskId = result.lastID;
        const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        
        res.status(201).json({
            success: true,
            data: { task }
        });
        
    } catch (error) {
        console.error('Create task error:', error);
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
        const { completed } = req.body;
        
        // Проверка прав доступа
        const task = await db.get('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, req.userId]);
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Задача не найдена'
            });
        }
        
        if (completed !== undefined) {
            await db.run(
                'UPDATE tasks SET completed = ?, completed_at = ? WHERE id = ?',
                [completed ? 1 : 0, completed ? new Date().toISOString() : null, taskId]
            );
            
            // Начисление монет за выполнение задачи
            if (completed && !task.completed) {
                await db.run(
                    'UPDATE users SET coins = coins + 10, tasks_completed = tasks_completed + 1 WHERE id = ?',
                    [req.userId]
                );
            }
        }
        
        const updatedTask = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
        
        res.json({
            success: true,
            data: { task: updatedTask }
        });
        
    } catch (error) {
        console.error('Update task error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления задачи'
        });
    }
});

// Привычки

// Получение привычек
app.get('/api/habits', authMiddleware, async (req, res) => {
    try {
        const habits = await db.all(
            'SELECT * FROM habits WHERE user_id = ? AND is_active = 1 ORDER BY streak DESC',
            [req.userId]
        );
        
        res.json({
            success: true,
            data: { habits }
        });
        
    } catch (error) {
        console.error('Get habits error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения привычек'
        });
    }
});

// Отметка привычки
app.post('/api/habits/:id/mark', authMiddleware, async (req, res) => {
    try {
        const habitId = req.params.id;
        
        const habit = await db.get('SELECT * FROM habits WHERE id = ? AND user_id = ?', [habitId, req.userId]);
        if (!habit) {
            return res.status(404).json({
                success: false,
                error: 'Привычка не найдена'
            });
        }
        
        const today = new Date().toISOString().split('T')[0];
        
        // Проверка, не отмечена ли уже сегодня
        const lastMarked = await db.get(
            'SELECT 1 FROM habit_completions WHERE habit_id = ? AND DATE(created_at) = DATE(?)',
            [habitId, today]
        );
        
        if (lastMarked) {
            return res.status(400).json({
                success: false,
                error: 'Привычка уже отмечена сегодня'
            });
        }
        
        // Создание отметки
        await db.run(
            'INSERT INTO habit_completions (habit_id, user_id) VALUES (?, ?)',
            [habitId, req.userId]
        );
        
        // Обновление стрика
        const newCurrentStreak = habit.current_streak + 1;
        const newBestStreak = Math.max(habit.best_streak, newCurrentStreak);
        
        await db.run(
            'UPDATE habits SET streak = streak + 1, current_streak = ?, best_streak = ? WHERE id = ?',
            [newCurrentStreak, newBestStreak, habitId]
        );
        
        // Начисление монет
        await db.run(
            'UPDATE users SET coins = coins + 5, streak = streak + 1 WHERE id = ?',
            [req.userId]
        );
        
        const updatedHabit = await db.get('SELECT * FROM habits WHERE id = ?', [habitId]);
        
        res.json({
            success: true,
            data: { habit: updatedHabit }
        });
        
    } catch (error) {
        console.error('Mark habit error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка отметки привычки'
        });
    }
});

// Финансовые операции

// Создание транзакции
app.post('/api/transactions', authMiddleware, async (req, res) => {
    try {
        const { type, amount, category, description } = req.body;
        
        if (!type || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Тип и сумма обязательны'
            });
        }
        
        const result = await db.run(
            `INSERT INTO transactions (user_id, type, amount, category, description)
             VALUES (?, ?, ?, ?, ?)`,
            [req.userId, type, amount, category || 'other', description || null]
        );
        
        // Обновление баланса пользователя
        if (type === 'income') {
            await db.run(
                'UPDATE users SET balance = balance + ?, monthly_income = monthly_income + ? WHERE id = ?',
                [amount, amount, req.userId]
            );
        } else {
            await db.run(
                'UPDATE users SET balance = balance - ?, monthly_expenses = monthly_expenses + ? WHERE id = ?',
                [amount, amount, req.userId]
            );
        }
        
        const transactionId = result.lastID;
        const transaction = await db.get('SELECT * FROM transactions WHERE id = ?', [transactionId]);
        
        res.status(201).json({
            success: true,
            data: { transaction }
        });
        
    } catch (error) {
        console.error('Create transaction error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка создания операции'
        });
    }
});

// Получение статистики
app.get('/api/stats', authMiddleware, async (req, res) => {
    try {
        const user = await db.get(
            `SELECT level, coins, streak, tasks_completed FROM users WHERE id = ?`,
            [req.userId]
        );
        
        // Статистика задач
        const tasksStats = await db.get(
            `SELECT COUNT(*) as total, 
                    SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed
             FROM tasks WHERE user_id = ?`,
            [req.userId]
        );
        
        // Статистика привычек
        const habitsStats = await db.get(
            `SELECT COUNT(*) as total, AVG(streak) as avg_streak FROM habits WHERE user_id = ?`,
            [req.userId]
        );
        
        res.json({
            success: true,
            data: {
                user_stats: user,
                tasks_stats: tasksStats,
                habits_stats: habitsStats
            }
        });
        
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения статистики'
        });
    }
});

// Получение достижений
app.get('/api/achievements', authMiddleware, async (req, res) => {
    try {
        const achievements = await db.all(
            'SELECT * FROM achievements WHERE user_id = ? ORDER BY earned_at DESC',
            [req.userId]
        );
        
        res.json({
            success: false,
            data: { achievements }
        });
        
    } catch (error) {
        console.error('Get achievements error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения достижений'
        });
    }
});

// Лучшие практики
app.get('/api/best-practices', authMiddleware, async (req, res) => {
    try {
        const { category } = req.query;
        
        let query = 'SELECT * FROM best_practices WHERE is_active = 1';
        const params = [];
        
        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }
        
        query += ' ORDER BY priority ASC, created_at DESC';
        
        const practices = await db.all(query, params);
        
        res.json({
            success: true,
            data: { practices }
        });
        
    } catch (error) {
        console.error('Get practices error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения практик'
        });
    }
});

// База данных калорий
const calorieDatabase = {
    'овощи': {
        'морковь': 41,
        'картофель': 77,
        'помидор': 18,
        'огурец': 15,
        'капуста': 25,
        'лук': 40,
        'чеснок': 149,
        'свекла': 43,
        'редис': 20,
        'перец сладкий': 27,
        'брокколи': 34,
        'цветная капуста': 25,
        'кабачок': 24,
        'баклажан': 24,
        'тыква': 26,
        'зелень': 25
    },
    'фрукты': {
        'яблоко': 52,
        'банан': 89,
        'апельсин': 47,
        'мандарин': 53,
        'лимон': 29,
        'груша': 57,
        'персик': 39,
        'абрикос': 48,
        'слива': 46,
        'виноград': 69,
        'киви': 61,
        'ананас': 50,
        'манго': 60,
        'авокадо': 160,
        'гранат': 83
    },
    'мясо': {
        'курица': 165,
        'индейка': 135,
        'говядина': 250,
        'свинина': 242,
        'баранина': 209,
        'кролик': 156,
        'утка': 337,
        'колбаса вареная': 257,
        'колбаса сырокопченая': 460,
        'сосиски': 257,
        'салями': 450
    },
    'рыба': {
        'лосось': 208,
        'тунец': 184,
        'сельдь': 158,
        'треска': 78,
        'минтай': 72,
        'окунь': 91,
        'карп': 112,
        'щука': 84,
        'судак': 84,
        'камбала': 83,
        'икра красная': 251,
        'икра черная': 235
    },
    'молочные': {
        'молоко': 60,
        'кефир': 51,
        'йогурт': 60,
        'сметана': 206,
        'творог': 121,
        'сыр твердый': 352,
        'сыр плавленый': 267,
        'масло сливочное': 748,
        'ряженка': 54,
        'сливки': 206
    },
    'крупы': {
        'гречка': 343,
        'рис': 344,
        'овсянка': 366,
        'манка': 328,
        'перловка': 320,
        'пшено': 348,
        'кукурузная': 337,
        'ячневая': 324,
        'булгур': 342,
        'киноа': 368
    },
    'напитки': {
        'вода': 0,
        'чай': 0,
        'кофе': 0,
        'сок апельсиновый': 45,
        'сок яблочный': 46,
        'сок томатный': 21,
        'лимонад': 41,
        'кола': 42,
        'пиво': 42,
        'вино красное': 68,
        'вино белое': 66,
        'водка': 235,
        'коньяк': 239
    },
    'выпечка': {
        'хлеб белый': 265,
        'хлеб черный': 259,
        'батон': 262,
        'лаваш': 275,
        'булочка': 339,
        'круассан': 406,
        'печенье': 417,
        'пряник': 350,
        'вафли': 425,
        'сухари': 392,
        'сухарики': 400
    },
    'сладости': {
        'шоколад молочный': 550,
        'шоколад черный': 539,
        'конфеты': 375,
        'мармелад': 321,
        'зефир': 326,
        'халва': 516,
        'мед': 329,
        'варенье': 263,
        'джем': 250,
        'сгущенка': 320
    },
    'фастфуд': {
        'пицца': 260,
        'бургер': 295,
        'картофель фри': 312,
        'хот-дог': 250,
        'шаурма': 280,
        'суши': 150,
        'роллы': 170,
        'чизбургер': 303,
        'наггетсы': 296,
        'попкорн': 375
    },
    'блюда': {
        'борщ': 49,
        'щи': 34,
        'суп куриный': 50,
        'суп грибной': 26,
        'рагу овощное': 70,
        'плов': 193,
        'гречка с мясом': 150,
        'макароны с сыром': 196,
        'картофельное пюре': 106,
        'жаркое': 180,
        'гуляш': 148,
        'котлеты': 220,
        'пельмени': 275,
        'блины': 233,
        'омлет': 154,
        'яичница': 180
    }
};

// API для расчета калорий
app.get('/api/calories/search', authMiddleware, async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Введите запрос для поиска'
            });
        }
        
        const results = [];
        const searchQuery = query.toLowerCase();
        
        // Поиск по всей базе данных
        Object.entries(calorieDatabase).forEach(([category, items]) => {
            Object.entries(items).forEach(([name, calories]) => {
                if (name.toLowerCase().includes(searchQuery)) {
                    results.push({
                        category,
                        name,
                        calories,
                        serving: '100г'
                    });
                }
            });
        });
        
        res.json({
            success: true,
            data: { results }
        });
        
    } catch (error) {
        console.error('Calorie search error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка поиска'
        });
    }
});

// Расчет дневной нормы калорий
app.post('/api/calories/calculate', authMiddleware, async (req, res) => {
    try {
        const { gender, age, height, weight, activity } = req.body;
        
        if (!gender || !age || !height || !weight || !activity) {
            return res.status(400).json({
                success: false,
                error: 'Заполните все поля'
            });
        }
        
        let bmr;
        if (gender === 'male') {
            bmr = 88.36 + (13.4 * weight) + (4.8 * height) - (5.7 * age);
        } else {
            bmr = 447.6 + (9.2 * weight) + (3.1 * height) - (4.3 * age);
        }
        
        const activityMultipliers = {
            'sedentary': 1.2,
            'light': 1.375,
            'moderate': 1.55,
            'active': 1.725,
            'very_active': 1.9
        };
        
        const dailyCalories = Math.round(bmr * activityMultipliers[activity]);
        const weightLoss = Math.round(dailyCalories * 0.8); // -20% для похудения
        const weightGain = Math.round(dailyCalories * 1.2); // +20% для набора
        
        // Расчет БЖУ
        const protein = Math.round(weight * 2.2); // 2.2г белка на кг веса
        const fat = Math.round(dailyCalories * 0.25 / 9); // 25% от калорий
        const carbs = Math.round((dailyCalories - (protein * 4) - (fat * 9)) / 4);
        
        res.json({
            success: true,
            data: {
                maintenance: dailyCalories,
                weight_loss: weightLoss,
                weight_gain: weightGain,
                macros: {
                    protein,
                    fat,
                    carbs
                },
                water: Math.round(weight * 30) // 30мл на кг веса
            }
        });
        
    } catch (error) {
        console.error('Calorie calculation error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка расчета'
        });
    }
});

// Эндпоинт для водного баланса
app.post('/api/health/water', authMiddleware, async (req, res) => {
    try {
        const { amount } = req.body;
        
        const today = new Date().toISOString().split('T')[0];
        
        // Получение текущей записи за сегодня
        let metric = await db.get(
            'SELECT * FROM health_metrics WHERE user_id = ? AND date = ?',
            [req.userId, today]
        );
        
        if (!metric) {
            // Создание новой записи
            const result = await db.run(
                'INSERT INTO health_metrics (user_id, water_ml, date) VALUES (?, ?, ?)',
                [req.userId, amount || 250, today]
            );
            metric = await db.get('SELECT * FROM health_metrics WHERE id = ?', [result.lastID]);
        } else {
            // Обновление существующей
            await db.run(
                'UPDATE health_metrics SET water_ml = water_ml + ? WHERE id = ?',
                [amount || 250, metric.id]
            );
            metric = await db.get('SELECT * FROM health_metrics WHERE id = ?', [metric.id]);
        }
        
        // Проверка выполнения цели по воде
        if (metric.water_ml >= 2000) {
            await db.run(
                'UPDATE users SET coins = coins + 10 WHERE id = ?',
                [req.userId]
            );
        }
        
        res.json({
            success: true,
            data: { metric }
        });
        
    } catch (error) {
        console.error('Water tracking error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сохранения данных'
        });
    }
});

// Рекомендации по активности
app.get('/api/health/recommendations', authMiddleware, async (req, res) => {
    try {
        const recommendations = [
            {
                type: 'water',
                title: 'Выпейте стакан воды',
                message: 'Прошло 2 часа с момента последнего приема воды',
                icon: 'fas fa-tint',
                priority: 1
            },
            {
                type: 'movement',
                title: 'Встаньте и пройдитесь',
                message: 'Вы сидите уже более 45 минут',
                icon: 'fas fa-walking',
                priority: 2
            },
            {
                type: 'exercise',
                title: 'Сделайте разминку',
                message: 'Рекомендуется 5-минутная зарядка каждый час',
                icon: 'fas fa-dumbbell',
                priority: 3
            },
            {
                type: 'posture',
                title: 'Проверьте осанку',
                message: 'Держите спину прямо для здоровья позвоночника',
                icon: 'fas fa-user',
                priority: 4
            }
        ];
        
        res.json({
            success: true,
            data: { recommendations }
        });
        
    } catch (error) {
        console.error('Recommendations error:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения рекомендаций'
        });
    }
});

// Запуск сервера
const startServer = async () => {
    try {
        await initDatabase();
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`🚀 QuantumFlow запущен на порту ${PORT}`);
            console.log(`🌐 http://localhost:${PORT}`);
            console.log('\n🔑 ТЕСТОВЫЕ АККАУНТЫ:');
            console.log('   Email: test@quantum.test');
            console.log('   Пароль: quantum123');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

// Обработка завершения работы
process.on('SIGINT', async () => {
    if (db) {
        await db.close();
        console.log('Database connection closed');
    }
    process.exit(0);
});
