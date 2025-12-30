require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

// Инициализация приложения
const app = express();

// ========== КОНФИГУРАЦИЯ ==========
const config = {
    port: process.env.PORT || 3000,
    jwtSecret: process.env.JWT_SECRET || 'quantumflow-secret-key-2024',
    bcryptRounds: 12,
    dbPath: process.env.NODE_ENV === 'production' ? '/tmp/quantumflow.db' : './quantumflow.db',
    corsOptions: {
        origin: ['http://localhost:3000', 'http://localhost:8080', 'http://localhost:5500'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }
};

// ========== МИДЛВАРЫ ==========
app.use(cors(config.corsOptions));
app.options('*', cors(config.corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// ========== БАЗА ДАННЫХ ==========
class Database {
    constructor() {
        this.db = null;
    }

    async connect() {
        try {
            this.db = await open({
                filename: config.dbPath,
                driver: sqlite3.Database
            });

            await this.db.run('PRAGMA foreign_keys = ON');
            console.log('✅ База данных подключена');
            
            return this.db;
        } catch (error) {
            console.error('❌ Ошибка подключения к БД:', error);
            throw error;
        }
    }

    async initTables() {
        const tables = [
            // Пользователи
            `CREATE TABLE IF NOT EXISTS users (
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
            )`,

            // Задачи
            `CREATE TABLE IF NOT EXISTS tasks (
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
            )`,

            // Привычки
            `CREATE TABLE IF NOT EXISTS habits (
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
            )`,

            // Отметки привычек
            `CREATE TABLE IF NOT EXISTS habit_completions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                habit_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`,

            // Транзакции
            `CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                category TEXT DEFAULT 'other',
                description TEXT,
                date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`,

            // Мерки здоровья
            `CREATE TABLE IF NOT EXISTS health_metrics (
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
            )`,

            // Финансовые цели
            `CREATE TABLE IF NOT EXISTS financial_goals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                target_amount REAL NOT NULL,
                current_amount REAL DEFAULT 0,
                deadline DATE,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`,

            // Достижения
            `CREATE TABLE IF NOT EXISTS achievements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`,

            // Лучшие практики
            `CREATE TABLE IF NOT EXISTS best_practices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                category TEXT DEFAULT 'productivity',
                icon TEXT DEFAULT 'fas fa-lightbulb',
                priority INTEGER DEFAULT 1,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        try {
            for (const tableSql of tables) {
                await this.db.exec(tableSql);
            }
            console.log('✅ Таблицы созданы');
        } catch (error) {
            console.error('❌ Ошибка создания таблиц:', error);
            throw error;
        }
    }

    async seedInitialData() {
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
            }
        ];

        try {
            for (const practice of practices) {
                const exists = await this.db.get(
                    'SELECT 1 FROM best_practices WHERE title = ?', 
                    [practice.title]
                );
                
                if (!exists) {
                    await this.db.run(
                        'INSERT INTO best_practices (title, description, category, icon, priority) VALUES (?, ?, ?, ?, ?)',
                        [practice.title, practice.description, practice.category, practice.icon, practice.priority]
                    );
                }
            }
            console.log('✅ Начальные данные загружены');
        } catch (error) {
            console.error('❌ Ошибка загрузки начальных данных:', error);
        }
    }
}

// ========== УТИЛИТЫ ==========
class Utils {
    static successResponse(data = null, message = 'Успешно') {
        return {
            success: true,
            message,
            data
        };
    }

    static errorResponse(message = 'Ошибка сервера', statusCode = 500) {
        return {
            success: false,
            error: message,
            statusCode
        };
    }

    static generateToken(user) {
        return jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                username: user.username 
            },
            config.jwtSecret,
            { expiresIn: '30d' }
        );
    }

    static async hashPassword(password) {
        return await bcrypt.hash(password, config.bcryptRounds);
    }

    static async comparePassword(password, hash) {
        return await bcrypt.compare(password, hash);
    }

    static validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }
}

// ========== МИДЛВАРЫ АУТЕНТИФИКАЦИИ ==========
const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json(
                Utils.errorResponse('Требуется авторизация', 401)
            );
        }
        
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, config.jwtSecret);
        
        req.userId = decoded.id;
        next();
    } catch (error) {
        return res.status(401).json(
            Utils.errorResponse('Неверный или просроченный токен', 401)
        );
    }
};

const optionalAuthMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, config.jwtSecret);
            req.userId = decoded.id;
        }
        
        next();
    } catch (error) {
        next();
    }
};

// ========== КОНТРОЛЛЕРЫ ==========

class AuthController {
    constructor(db) {
        this.db = db;
    }

    async register(req, res) {
        try {
            const { email, username, password, first_name, last_name } = req.body;
            
            // Валидация
            if (!email || !password || !first_name) {
                return res.status(400).json(
                    Utils.errorResponse('Заполните обязательные поля', 400)
                );
            }
            
            if (!Utils.validateEmail(email)) {
                return res.status(400).json(
                    Utils.errorResponse('Некорректный email', 400)
                );
            }
            
            // Проверка существующего пользователя
            const existingUser = await this.db.get(
                'SELECT id FROM users WHERE email = ? OR username = ?', 
                [email, username]
            );
            
            if (existingUser) {
                return res.status(409).json(
                    Utils.errorResponse('Пользователь уже существует', 409)
                );
            }
            
            // Хеширование пароля
            const hashedPassword = await Utils.hashPassword(password);
            
            // Создание пользователя
            const result = await this.db.run(
                `INSERT INTO users (email, username, password, first_name, last_name, coins) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [email, username, hashedPassword, first_name, last_name || '', 100]
            );
            
            const userId = result.lastID;
            
            // Создание достижения
            await this.db.run(
                'INSERT INTO achievements (user_id, type, title, description) VALUES (?, ?, ?, ?)',
                [userId, 'welcome', 'Добро пожаловать!', 'Вы зарегистрировались в QuantumFlow']
            );
            
            // Генерация токена
            const user = await this.db.get(
                `SELECT id, email, username, first_name, last_name, avatar_url, 
                        level, coins, streak, balance, monthly_income, monthly_expenses,
                        tasks_completed, health_streak, goal
                 FROM users WHERE id = ?`,
                [userId]
            );
            
            const token = Utils.generateToken(user);
            
            res.status(201).json(
                Utils.successResponse({ user, token }, 'Регистрация успешна')
            );
            
        } catch (error) {
            console.error('Registration error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка регистрации')
            );
        }
    }

    async login(req, res) {
        try {
            const { email, password } = req.body;
            
            if (!email || !password) {
                return res.status(400).json(
                    Utils.errorResponse('Заполните все поля', 400)
                );
            }
            
            // Поиск пользователя
            const user = await this.db.get(
                `SELECT * FROM users WHERE email = ? AND is_active = 1`,
                [email]
            );
            
            if (!user) {
                return res.status(401).json(
                    Utils.errorResponse('Пользователь не найден', 401)
                );
            }
            
            // Проверка пароля
            const isValidPassword = await Utils.comparePassword(password, user.password);
            if (!isValidPassword) {
                return res.status(401).json(
                    Utils.errorResponse('Неверный пароль', 401)
                );
            }
            
            // Обновление последнего входа
            await this.db.run(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
                [user.id]
            );
            
            // Подготовка данных пользователя
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
            
            const token = Utils.generateToken(userData);
            
            res.json(
                Utils.successResponse({ user: userData, token }, 'Вход успешен')
            );
            
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка входа')
            );
        }
    }

    async getCurrentUser(req, res) {
        try {
            const user = await this.db.get(
                `SELECT id, email, username, first_name, last_name, avatar_url, 
                        level, coins, streak, balance, monthly_income, monthly_expenses,
                        tasks_completed, health_streak, goal
                 FROM users WHERE id = ?`,
                [req.userId]
            );
            
            if (!user) {
                return res.status(404).json(
                    Utils.errorResponse('Пользователь не найден', 404)
                );
            }
            
            res.json(Utils.successResponse(user));
            
        } catch (error) {
            console.error('Get user error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка получения данных пользователя')
            );
        }
    }
}

class TasksController {
    constructor(db) {
        this.db = db;
    }

    async getTasks(req, res) {
        try {
            const { date, completed, limit } = req.query;
            
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
            
            if (limit) {
                query += ' LIMIT ?';
                params.push(parseInt(limit));
            }
            
            const tasks = await this.db.all(query, params);
            
            res.json(Utils.successResponse({ tasks }));
            
        } catch (error) {
            console.error('Get tasks error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка получения задач')
            );
        }
    }

    async createTask(req, res) {
        try {
            const { title, description, tag, priority, due_date, time } = req.body;
            
            if (!title) {
                return res.status(400).json(
                    Utils.errorResponse('Название задачи обязательно', 400)
                );
            }
            
            const result = await this.db.run(
                `INSERT INTO tasks (user_id, title, description, tag, priority, due_date, time)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [req.userId, title, description || null, tag || '#общее', 
                 priority || 'medium', due_date || null, time || null]
            );
            
            const taskId = result.lastID;
            const task = await this.db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
            
            res.status(201).json(
                Utils.successResponse({ task }, 'Задача создана')
            );
            
        } catch (error) {
            console.error('Create task error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка создания задачи')
            );
        }
    }

    async updateTask(req, res) {
        try {
            const taskId = req.params.id;
            const { completed } = req.body;
            
            // Проверка прав доступа
            const task = await this.db.get(
                'SELECT * FROM tasks WHERE id = ? AND user_id = ?', 
                [taskId, req.userId]
            );
            
            if (!task) {
                return res.status(404).json(
                    Utils.errorResponse('Задача не найдена', 404)
                );
            }
            
            if (completed !== undefined) {
                await this.db.run(
                    'UPDATE tasks SET completed = ?, completed_at = ? WHERE id = ?',
                    [completed ? 1 : 0, completed ? new Date().toISOString() : null, taskId]
                );
                
                // Начисление монет за выполнение задачи
                if (completed && !task.completed) {
                    await this.db.run(
                        'UPDATE users SET coins = coins + 10, tasks_completed = tasks_completed + 1 WHERE id = ?',
                        [req.userId]
                    );
                }
            }
            
            const updatedTask = await this.db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
            
            res.json(Utils.successResponse({ task: updatedTask }, 'Задача обновлена'));
            
        } catch (error) {
            console.error('Update task error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка обновления задачи')
            );
        }
    }

    async deleteTask(req, res) {
        try {
            const taskId = req.params.id;
            
            const result = await this.db.run(
                'DELETE FROM tasks WHERE id = ? AND user_id = ?',
                [taskId, req.userId]
            );
            
            if (result.changes === 0) {
                return res.status(404).json(
                    Utils.errorResponse('Задача не найдена', 404)
                );
            }
            
            res.json(Utils.successResponse(null, 'Задача удалена'));
            
        } catch (error) {
            console.error('Delete task error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка удаления задачи')
            );
        }
    }
}

class HabitsController {
    constructor(db) {
        this.db = db;
    }

    async getHabits(req, res) {
        try {
            const habits = await this.db.all(
                'SELECT * FROM habits WHERE user_id = ? AND is_active = 1 ORDER BY streak DESC',
                [req.userId]
            );
            
            res.json(Utils.successResponse({ habits }));
            
        } catch (error) {
            console.error('Get habits error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка получения привычек')
            );
        }
    }

    async createHabit(req, res) {
        try {
            const { title, icon, description } = req.body;
            
            if (!title) {
                return res.status(400).json(
                    Utils.errorResponse('Название привычки обязательно', 400)
                );
            }
            
            const result = await this.db.run(
                `INSERT INTO habits (user_id, title, icon, description)
                 VALUES (?, ?, ?, ?)`,
                [req.userId, title, icon || 'fas fa-star', description || '']
            );
            
            const habitId = result.lastID;
            const habit = await this.db.get('SELECT * FROM habits WHERE id = ?', [habitId]);
            
            res.status(201).json(
                Utils.successResponse({ habit }, 'Привычка создана')
            );
            
        } catch (error) {
            console.error('Create habit error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка создания привычки')
            );
        }
    }

    async markHabit(req, res) {
        try {
            const habitId = req.params.id;
            
            const habit = await this.db.get(
                'SELECT * FROM habits WHERE id = ? AND user_id = ?', 
                [habitId, req.userId]
            );
            
            if (!habit) {
                return res.status(404).json(
                    Utils.errorResponse('Привычка не найдена', 404)
                );
            }
            
            const today = new Date().toISOString().split('T')[0];
            
            // Проверка, не отмечена ли уже сегодня
            const lastMarked = await this.db.get(
                'SELECT 1 FROM habit_completions WHERE habit_id = ? AND DATE(created_at) = DATE(?)',
                [habitId, today]
            );
            
            if (lastMarked) {
                return res.status(400).json(
                    Utils.errorResponse('Привычка уже отмечена сегодня', 400)
                );
            }
            
            // Создание отметки
            await this.db.run(
                'INSERT INTO habit_completions (habit_id, user_id) VALUES (?, ?)',
                [habitId, req.userId]
            );
            
            // Обновление стрика
            const newCurrentStreak = habit.current_streak + 1;
            const newBestStreak = Math.max(habit.best_streak, newCurrentStreak);
            
            await this.db.run(
                'UPDATE habits SET streak = streak + 1, current_streak = ?, best_streak = ? WHERE id = ?',
                [newCurrentStreak, newBestStreak, habitId]
            );
            
            // Начисление монет
            await this.db.run(
                'UPDATE users SET coins = coins + 5, streak = streak + 1 WHERE id = ?',
                [req.userId]
            );
            
            const updatedHabit = await this.db.get('SELECT * FROM habits WHERE id = ?', [habitId]);
            
            res.json(Utils.successResponse({ habit: updatedHabit }, 'Привычка отмечена'));
            
        } catch (error) {
            console.error('Mark habit error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка отметки привычки')
            );
        }
    }
}

class FinanceController {
    constructor(db) {
        this.db = db;
    }

    async getTransactions(req, res) {
        try {
            const { type, start_date, end_date } = req.query;
            
            let query = 'SELECT * FROM transactions WHERE user_id = ?';
            const params = [req.userId];
            
            if (type) {
                query += ' AND type = ?';
                params.push(type);
            }
            
            if (start_date) {
                query += ' AND date >= ?';
                params.push(start_date);
            }
            
            if (end_date) {
                query += ' AND date <= ?';
                params.push(end_date);
            }
            
            query += ' ORDER BY date DESC, created_at DESC';
            
            const transactions = await this.db.all(query, params);
            
            res.json(Utils.successResponse({ transactions }));
            
        } catch (error) {
            console.error('Get transactions error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка получения транзакций')
            );
        }
    }

    async createTransaction(req, res) {
        try {
            const { type, amount, category, description } = req.body;
            
            if (!type || !amount) {
                return res.status(400).json(
                    Utils.errorResponse('Тип и сумма обязательны', 400)
                );
            }
            
            const result = await this.db.run(
                `INSERT INTO transactions (user_id, type, amount, category, description)
                 VALUES (?, ?, ?, ?, ?)`,
                [req.userId, type, amount, category || 'other', description || null]
            );
            
            // Обновление баланса пользователя
            if (type === 'income') {
                await this.db.run(
                    'UPDATE users SET balance = balance + ?, monthly_income = monthly_income + ? WHERE id = ?',
                    [amount, amount, req.userId]
                );
            } else {
                await this.db.run(
                    'UPDATE users SET balance = balance - ?, monthly_expenses = monthly_expenses + ? WHERE id = ?',
                    [amount, amount, req.userId]
                );
            }
            
            const transactionId = result.lastID;
            const transaction = await this.db.get('SELECT * FROM transactions WHERE id = ?', [transactionId]);
            
            res.status(201).json(
                Utils.successResponse({ transaction }, 'Транзакция создана')
            );
            
        } catch (error) {
            console.error('Create transaction error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка создания транзакции')
            );
        }
    }

    async getFinancialGoals(req, res) {
        try {
            const goals = await this.db.all(
                'SELECT * FROM financial_goals WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC',
                [req.userId]
            );
            
            res.json(Utils.successResponse({ goals }));
            
        } catch (error) {
            console.error('Get financial goals error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка получения целей')
            );
        }
    }

    async createFinancialGoal(req, res) {
        try {
            const { title, target_amount, current_amount, deadline } = req.body;
            
            if (!title || !target_amount) {
                return res.status(400).json(
                    Utils.errorResponse('Название и целевая сумма обязательны', 400)
                );
            }
            
            const result = await this.db.run(
                `INSERT INTO financial_goals (user_id, title, target_amount, current_amount, deadline)
                 VALUES (?, ?, ?, ?, ?)`,
                [req.userId, title, target_amount, current_amount || 0, deadline || null]
            );
            
            const goalId = result.lastID;
            const goal = await this.db.get('SELECT * FROM financial_goals WHERE id = ?', [goalId]);
            
            res.status(201).json(
                Utils.successResponse({ goal }, 'Цель создана')
            );
            
        } catch (error) {
            console.error('Create financial goal error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка создания цели')
            );
        }
    }
}

class HealthController {
    constructor(db) {
        this.db = db;
    }

    async getHealthMetrics(req, res) {
        try {
            const { date } = req.query;
            const targetDate = date || new Date().toISOString().split('T')[0];
            
            const metrics = await this.db.get(
                'SELECT * FROM health_metrics WHERE user_id = ? AND date = ?',
                [req.userId, targetDate]
            );
            
            res.json(Utils.successResponse({ metrics: metrics || {} }));
            
        } catch (error) {
            console.error('Get health metrics error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка получения данных здоровья')
            );
        }
    }

    async updateHealthMetrics(req, res) {
        try {
            const { weight, steps, calories, water_ml, activity_level } = req.body;
            const today = new Date().toISOString().split('T')[0];
            
            // Проверка существующей записи
            let metric = await this.db.get(
                'SELECT * FROM health_metrics WHERE user_id = ? AND date = ?',
                [req.userId, today]
            );
            
            if (!metric) {
                // Создание новой записи
                const result = await this.db.run(
                    `INSERT INTO health_metrics (user_id, weight, steps, calories, water_ml, activity_level, date)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [req.userId, weight || null, steps || 0, calories || 0, water_ml || 0, 
                     activity_level || 'medium', today]
                );
                metric = await this.db.get('SELECT * FROM health_metrics WHERE id = ?', [result.lastID]);
            } else {
                // Обновление существующей
                await this.db.run(
                    `UPDATE health_metrics 
                     SET weight = COALESCE(?, weight),
                         steps = COALESCE(?, steps),
                         calories = COALESCE(?, calories),
                         water_ml = COALESCE(?, water_ml),
                         activity_level = COALESCE(?, activity_level)
                     WHERE id = ?`,
                    [weight, steps, calories, water_ml, activity_level, metric.id]
                );
                metric = await this.db.get('SELECT * FROM health_metrics WHERE id = ?', [metric.id]);
            }
            
            // Проверка достижений
            if (water_ml >= 2000) {
                await this.db.run(
                    'UPDATE users SET coins = coins + 10 WHERE id = ?',
                    [req.userId]
                );
            }
            
            if (steps >= 10000) {
                await this.db.run(
                    'UPDATE users SET health_streak = health_streak + 1 WHERE id = ?',
                    [req.userId]
                );
            }
            
            res.json(Utils.successResponse({ metric }, 'Данные здоровья обновлены'));
            
        } catch (error) {
            console.error('Update health metrics error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка обновления данных здоровья')
            );
        }
    }

    async updateWaterIntake(req, res) {
        try {
            const { amount } = req.body;
            const today = new Date().toISOString().split('T')[0];
            
            if (!amount || amount <= 0) {
                return res.status(400).json(
                    Utils.errorResponse('Укажите количество воды', 400)
                );
            }
            
            let metric = await this.db.get(
                'SELECT * FROM health_metrics WHERE user_id = ? AND date = ?',
                [req.userId, today]
            );
            
            if (!metric) {
                const result = await this.db.run(
                    'INSERT INTO health_metrics (user_id, water_ml, date) VALUES (?, ?, ?)',
                    [req.userId, amount, today]
                );
                metric = await this.db.get('SELECT * FROM health_metrics WHERE id = ?', [result.lastID]);
            } else {
                await this.db.run(
                    'UPDATE health_metrics SET water_ml = water_ml + ? WHERE id = ?',
                    [amount, metric.id]
                );
                metric = await this.db.get('SELECT * FROM health_metrics WHERE id = ?', [metric.id]);
            }
            
            res.json(Utils.successResponse({ metric }, 'Потребление воды обновлено'));
            
        } catch (error) {
            console.error('Update water intake error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка обновления потребления воды')
            );
        }
    }
}

class StatsController {
    constructor(db) {
        this.db = db;
    }

    async getOverviewStats(req, res) {
        try {
            // Статистика пользователя
            const userStats = await this.db.get(
                `SELECT level, coins, streak, tasks_completed, 
                        balance, monthly_income, monthly_expenses
                 FROM users WHERE id = ?`,
                [req.userId]
            );
            
            // Статистика задач
            const tasksStats = await this.db.get(
                `SELECT COUNT(*) as total, 
                        SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed,
                        SUM(CASE WHEN date(due_date) = date('now') AND completed = 0 THEN 1 ELSE 0 END) as due_today
                 FROM tasks WHERE user_id = ?`,
                [req.userId]
            );
            
            // Статистика привычек
            const habitsStats = await this.db.get(
                `SELECT COUNT(*) as total, 
                        COALESCE(AVG(current_streak), 0) as avg_streak,
                        COALESCE(SUM(streak), 0) as total_streak
                 FROM habits WHERE user_id = ? AND is_active = 1`,
                [req.userId]
            );
            
            // Последние 5 задач
            const recentTasks = await this.db.all(
                `SELECT * FROM tasks 
                 WHERE user_id = ? 
                 ORDER BY created_at DESC 
                 LIMIT 5`,
                [req.userId]
            );
            
            res.json(Utils.successResponse({
                user_stats: userStats,
                tasks_stats: tasksStats,
                habits_stats: habitsStats,
                recent_tasks: recentTasks
            }));
            
        } catch (error) {
            console.error('Get overview stats error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка получения статистики')
            );
        }
    }

    async getProductivityStats(req, res) {
        try {
            // Продуктивность по дням недели
            const weeklyStats = await this.db.all(
                `SELECT date(created_at) as date,
                        COUNT(*) as total_tasks,
                        SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed_tasks
                 FROM tasks 
                 WHERE user_id = ? AND date(created_at) >= date('now', '-7 days')
                 GROUP BY date(created_at)
                 ORDER BY date`,
                [req.userId]
            );
            
            // Распределение задач по приоритетам
            const priorityStats = await this.db.all(
                `SELECT priority, COUNT(*) as count
                 FROM tasks 
                 WHERE user_id = ?
                 GROUP BY priority`,
                [req.userId]
            );
            
            // Время выполнения задач
            const completionStats = await this.db.get(
                `SELECT AVG(julianday(completed_at) - julianday(created_at)) * 24 as avg_hours_to_complete
                 FROM tasks 
                 WHERE user_id = ? AND completed = 1`,
                [req.userId]
            );
            
            res.json(Utils.successResponse({
                weekly_stats: weeklyStats,
                priority_stats: priorityStats,
                completion_stats: completionStats
            }));
            
        } catch (error) {
            console.error('Get productivity stats error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка получения статистики продуктивности')
            );
        }
    }
}

class AchievementsController {
    constructor(db) {
        this.db = db;
    }

    async getAchievements(req, res) {
        try {
            const achievements = await this.db.all(
                'SELECT * FROM achievements WHERE user_id = ? ORDER BY earned_at DESC',
                [req.userId]
            );
            
            // Достижения пользователя
            const userAchievements = [
                {
                    id: 1,
                    type: 'welcome',
                    title: 'Добро пожаловать!',
                    description: 'Вы зарегистрировались в QuantumFlow',
                    earned_at: new Date().toISOString()
                },
                {
                    id: 2,
                    type: 'first_task',
                    title: 'Первая задача',
                    description: 'Вы создали свою первую задачу',
                    earned_at: new Date().toISOString()
                },
                {
                    id: 3,
                    type: 'streak_7',
                    title: 'Неделя продуктивности',
                    description: 'Активность 7 дней подряд',
                    earned_at: new Date().toISOString()
                }
            ];
            
            res.json(Utils.successResponse({ 
                achievements: achievements.length > 0 ? achievements : userAchievements 
            }));
            
        } catch (error) {
            console.error('Get achievements error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка получения достижений')
            );
        }
    }

    async checkAndAwardAchievements(req, res) {
        try {
            const userId = req.userId;
            const achievementsToCheck = [
                {
                    type: 'first_task',
                    title: 'Первая задача',
                    description: 'Вы создали свою первую задачу',
                    condition: async () => {
                        const result = await this.db.get(
                            'SELECT COUNT(*) as count FROM tasks WHERE user_id = ?',
                            [userId]
                        );
                        return result.count > 0;
                    }
                },
                {
                    type: 'streak_7',
                    title: 'Неделя продуктивности',
                    description: 'Активность 7 дней подряд',
                    condition: async () => {
                        const result = await this.db.get(
                            'SELECT streak FROM users WHERE id = ?',
                            [userId]
                        );
                        return result.streak >= 7;
                    }
                },
                {
                    type: 'tasks_10',
                    title: 'Десять задач',
                    description: 'Выполнено 10 задач',
                    condition: async () => {
                        const result = await this.db.get(
                            'SELECT tasks_completed FROM users WHERE id = ?',
                            [userId]
                        );
                        return result.tasks_completed >= 10;
                    }
                }
            ];
            
            const awarded = [];
            
            for (const achievement of achievementsToCheck) {
                const hasAchievement = await this.db.get(
                    'SELECT 1 FROM achievements WHERE user_id = ? AND type = ?',
                    [userId, achievement.type]
                );
                
                if (!hasAchievement) {
                    const conditionMet = await achievement.condition();
                    
                    if (conditionMet) {
                        await this.db.run(
                            'INSERT INTO achievements (user_id, type, title, description) VALUES (?, ?, ?, ?)',
                            [userId, achievement.type, achievement.title, achievement.description]
                        );
                        
                        // Начисление монет за достижение
                        await this.db.run(
                            'UPDATE users SET coins = coins + 50 WHERE id = ?',
                            [userId]
                        );
                        
                        awarded.push(achievement);
                    }
                }
            }
            
            res.json(Utils.successResponse({ awarded }));
            
        } catch (error) {
            console.error('Check achievements error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка проверки достижений')
            );
        }
    }
}

class BestPracticesController {
    constructor(db) {
        this.db = db;
    }

    async getBestPractices(req, res) {
        try {
            const { category } = req.query;
            
            let query = 'SELECT * FROM best_practices WHERE is_active = 1';
            const params = [];
            
            if (category) {
                query += ' AND category = ?';
                params.push(category);
            }
            
            query += ' ORDER BY priority ASC, created_at DESC';
            
            const practices = await this.db.all(query, params);
            
            // Если нет практик в БД, возвращаем дефолтные
            if (practices.length === 0) {
                const defaultPractices = [
                    {
                        id: 1,
                        title: 'Метод помидора',
                        description: 'Работайте 25 минут, затем делайте 5-минутный перерыв. После 4 помидоров — длинный перерыв 15-30 минут.',
                        category: 'productivity',
                        icon: 'fas fa-clock',
                        priority: 1
                    },
                    {
                        id: 2,
                        title: 'Правило 2 минут',
                        description: 'Если задача занимает меньше 2 минут — сделайте ее сразу. Это уменьшает нагрузку на память.',
                        category: 'productivity',
                        icon: 'fas fa-hourglass-half',
                        priority: 2
                    },
                    {
                        id: 3,
                        title: 'Съешьте лягушку',
                        description: 'Начинайте день с самой сложной задачи. Это даст энергию на остальной день.',
                        category: 'productivity',
                        icon: 'fas fa-frog',
                        priority: 3
                    }
                ];
                return res.json(Utils.successResponse({ practices: defaultPractices }));
            }
            
            res.json(Utils.successResponse({ practices }));
            
        } catch (error) {
            console.error('Get best practices error:', error);
            res.status(500).json(
                Utils.errorResponse('Ошибка получения лучших практик')
            );
        }
    }
}

// ========== ИНИЦИАЛИЗАЦИЯ КОНТРОЛЛЕРОВ ==========
let authController, tasksController, habitsController, financeController;
let healthController, statsController, achievementsController, bestPracticesController;

async function initControllers(db) {
    authController = new AuthController(db);
    tasksController = new TasksController(db);
    habitsController = new HabitsController(db);
    financeController = new FinanceController(db);
    healthController = new HealthController(db);
    statsController = new StatsController(db);
    achievementsController = new AchievementsController(db);
    bestPracticesController = new BestPracticesController(db);
}

// ========== МАРШРУТЫ ==========

// Аутентификация
app.post('/api/auth/register', (req, res) => authController.register(req, res));
app.post('/api/auth/login', (req, res) => authController.login(req, res));
app.get('/api/user/current', authMiddleware, (req, res) => authController.getCurrentUser(req, res));

// Задачи
app.get('/api/tasks', authMiddleware, (req, res) => tasksController.getTasks(req, res));
app.post('/api/tasks', authMiddleware, (req, res) => tasksController.createTask(req, res));
app.put('/api/tasks/:id', authMiddleware, (req, res) => tasksController.updateTask(req, res));
app.delete('/api/tasks/:id', authMiddleware, (req, res) => tasksController.deleteTask(req, res));

// Привычки
app.get('/api/habits', authMiddleware, (req, res) => habitsController.getHabits(req, res));
app.post('/api/habits', authMiddleware, (req, res) => habitsController.createHabit(req, res));
app.post('/api/habits/:id/mark', authMiddleware, (req, res) => habitsController.markHabit(req, res));

// Финансы
app.get('/api/transactions', authMiddleware, (req, res) => financeController.getTransactions(req, res));
app.post('/api/transactions', authMiddleware, (req, res) => financeController.createTransaction(req, res));
app.get('/api/financial-goals', authMiddleware, (req, res) => financeController.getFinancialGoals(req, res));
app.post('/api/financial-goals', authMiddleware, (req, res) => financeController.createFinancialGoal(req, res));

// Здоровье
app.get('/api/health/metrics', authMiddleware, (req, res) => healthController.getHealthMetrics(req, res));
app.post('/api/health/metrics', authMiddleware, (req, res) => healthController.updateHealthMetrics(req, res));
app.post('/api/health/water', authMiddleware, (req, res) => healthController.updateWaterIntake(req, res));

// Статистика
app.get('/api/stats/overview', authMiddleware, (req, res) => statsController.getOverviewStats(req, res));
app.get('/api/stats/productivity', authMiddleware, (req, res) => statsController.getProductivityStats(req, res));

// Достижения
app.get('/api/achievements', authMiddleware, (req, res) => achievementsController.getAchievements(req, res));
app.post('/api/achievements/check', authMiddleware, (req, res) => achievementsController.checkAndAwardAchievements(req, res));

// Лучшие практики
app.get('/api/best-practices', optionalAuthMiddleware, (req, res) => bestPracticesController.getBestPractices(req, res));

// Утилитарные эндпоинты
app.get('/api/health/water-tracking', authMiddleware, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const metric = await healthController.db.get(
            'SELECT water_ml FROM health_metrics WHERE user_id = ? AND date = ?',
            [req.userId, today]
        );
        
        const waterMl = metric ? metric.water_ml : 0;
        const bottles = Math.floor(waterMl / 250); // 250мл на бутылку
        const progress = Math.min((waterMl / 2000) * 100, 100); // 2 литра цель
        
        res.json(Utils.successResponse({
            current: waterMl,
            target: 2000,
            bottles: Array.from({ length: 8 }, (_, i) => i < bottles),
            progress,
            message: waterMl >= 2000 ? 'Цель достигнута!' : `Осталось ${2000 - waterMl} мл`
        }));
        
    } catch (error) {
        console.error('Water tracking error:', error);
        res.status(500).json(Utils.errorResponse('Ошибка получения данных воды'));
    }
});

app.get('/api/calories/foods', optionalAuthMiddleware, async (req, res) => {
    try {
        const { query } = req.query;
        
        const calorieDatabase = {
            'яблоко': 52,
            'банан': 89,
            'апельсин': 47,
            'курица': 165,
            'говядина': 250,
            'рис': 344,
            'гречка': 343,
            'хлеб': 265,
            'яйцо': 155,
            'молоко': 60
        };
        
        let results = [];
        
        if (query) {
            const searchQuery = query.toLowerCase();
            results = Object.entries(calorieDatabase)
                .filter(([food]) => food.toLowerCase().includes(searchQuery))
                .map(([food, calories]) => ({
                    name: food,
                    calories,
                    serving: '100г'
                }));
        }
        
        res.json(Utils.successResponse({ results }));
        
    } catch (error) {
        console.error('Food search error:', error);
        res.status(500).json(Utils.errorResponse('Ошибка поиска продуктов'));
    }
});

// Проверка здоровья сервера
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'QuantumFlow API работает',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Обслуживание статических файлов
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== ЗАПУСК СЕРВЕРА ==========
async function startServer() {
    try {
        const database = new Database();
        const db = await database.connect();
        await database.initTables();
        await database.seedInitialData();
        
        await initControllers(db);
        
        app.listen(config.port, () => {
            console.log(`🚀 QuantumFlow запущен на порту ${config.port}`);
            console.log(`🌐 http://localhost:${config.port}`);
            console.log('\n🔑 ДОСТУПНЫЕ ЭНДПОИНТЫ:');
            console.log('   POST /api/auth/register - Регистрация');
            console.log('   POST /api/auth/login - Вход');
            console.log('   GET  /api/user/current - Текущий пользователь');
            console.log('   GET  /api/tasks - Получение задач');
            console.log('   POST /api/tasks - Создание задачи');
            console.log('   GET  /api/stats/overview - Статистика обзора');
            console.log('   POST /api/transactions - Создание транзакции');
            console.log('\n🔧 ДЕМО АККАУНТ:');
            console.log('   Email: demo@quantumflow.test');
            console.log('   Пароль: demo123');
        });
        
    } catch (error) {
        console.error('❌ Ошибка запуска сервера:', error);
        process.exit(1);
    }
}

startServer();

// ========== ОБРАБОТКА ЗАВЕРШЕНИЯ ==========
process.on('SIGINT', async () => {
    console.log('\n🛑 Остановка сервера...');
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Необработанное отклонение промиса:', reason);
});

module.exports = { app };
