require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');

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

// Статические файлы из public директории
app.use(express.static(path.join(__dirname, 'public')));

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных QuantumFlow...');
        
        const dbDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        const dbPath = path.join(dbDir, 'quantumflow_v2.db');
        console.log(`📁 Путь к базе данных: ${dbPath}`);
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных SQLite подключена');
        await db.run('PRAGMA foreign_keys = ON');
        await db.run('PRAGMA journal_mode = WAL');

        await createTables();
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
        
        // Расширенная таблица пользователей с целями и сроками
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE,
                password TEXT NOT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT,
                avatar_url TEXT,
                
                -- Основные цели (1-5)
                goal_1_finance BOOLEAN DEFAULT 0,
                goal_2_fitness BOOLEAN DEFAULT 0,
                goal_3_habits BOOLEAN DEFAULT 0,
                goal_4_productivity BOOLEAN DEFAULT 0,
                goal_5_schedule BOOLEAN DEFAULT 0,
                
                -- Сроки для целей (в месяцах)
                goal_1_deadline INTEGER DEFAULT 12,
                goal_2_deadline INTEGER DEFAULT 6,
                goal_3_deadline INTEGER DEFAULT 3,
                goal_4_deadline INTEGER DEFAULT 1,
                goal_5_deadline INTEGER DEFAULT 1,
                
                -- Статистика
                level INTEGER DEFAULT 1,
                coins INTEGER DEFAULT 100,
                streak INTEGER DEFAULT 0,
                tasks_completed INTEGER DEFAULT 0,
                habits_streak INTEGER DEFAULT 0,
                
                -- Финансы
                balance REAL DEFAULT 0,
                monthly_income REAL DEFAULT 0,
                monthly_expenses REAL DEFAULT 0,
                
                -- Здоровье
                weight REAL DEFAULT 70,
                height REAL DEFAULT 170,
                target_weight REAL DEFAULT 65,
                activity_level TEXT DEFAULT 'medium',
                
                -- Вредные привычки
                smoking_status TEXT DEFAULT 'non_smoker',
                alcohol_status TEXT DEFAULT 'non_drinker',
                smoking_start_date DATE,
                alcohol_start_date DATE,
                
                is_active INTEGER DEFAULT 1,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Финансовые цели и копилки
        await db.exec(`
            CREATE TABLE IF NOT EXISTS financial_goals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                target_amount REAL NOT NULL,
                current_amount REAL DEFAULT 0,
                deadline DATE,
                category TEXT DEFAULT 'savings',
                icon TEXT DEFAULT 'fas fa-piggy-bank',
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Транзакции с расширенными категориями
        await db.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                subcategory TEXT,
                description TEXT,
                date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Упражнения и тренировки
        await db.exec(`
            CREATE TABLE IF NOT EXISTS workouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                duration INTEGER DEFAULT 20,
                calories INTEGER DEFAULT 100,
                completed INTEGER DEFAULT 0,
                date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Программа упражнений (рекомендации)
        await db.exec(`
            CREATE TABLE IF NOT EXISTS exercise_programs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                difficulty TEXT DEFAULT 'beginner',
                duration INTEGER DEFAULT 30,
                calories INTEGER DEFAULT 200,
                exercises TEXT NOT NULL, -- JSON массив упражнений
                for_weight_loss BOOLEAN DEFAULT 1,
                for_strength BOOLEAN DEFAULT 0,
                for_endurance BOOLEAN DEFAULT 0,
                is_active INTEGER DEFAULT 1
            )
        `);

        // Трекер вредных привычек
        await db.exec(`
            CREATE TABLE IF NOT EXISTS bad_habits_tracker (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                habit_type TEXT NOT NULL CHECK(habit_type IN ('smoking', 'alcohol', 'other')),
                status TEXT DEFAULT 'active',
                start_date DATE,
                quit_date DATE,
                cravings_today INTEGER DEFAULT 0,
                money_saved REAL DEFAULT 0,
                health_improvements TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Практики для отказа от вредных привычек
        await db.exec(`
            CREATE TABLE IF NOT EXISTS quitting_practices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                for_habit TEXT NOT NULL,
                difficulty TEXT DEFAULT 'easy',
                duration INTEGER DEFAULT 10,
                steps TEXT NOT NULL, -- JSON шаги
                success_rate INTEGER DEFAULT 70
            )
        `);

        // Методы личной эффективности
        await db.exec(`
            CREATE TABLE IF NOT EXISTS productivity_methods (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                icon TEXT DEFAULT 'fas fa-brain',
                steps TEXT NOT NULL,
                recommended_duration INTEGER DEFAULT 25,
                category TEXT DEFAULT 'focus'
            )
        `);

        // Распорядок дня
        await db.exec(`
            CREATE TABLE IF NOT EXISTS daily_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                day_type TEXT DEFAULT 'weekday',
                time_slot TEXT NOT NULL,
                activity TEXT NOT NULL,
                duration INTEGER DEFAULT 60,
                priority INTEGER DEFAULT 3,
                completed INTEGER DEFAULT 0,
                date DATE DEFAULT CURRENT_DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Достижения для всех категорий
        await db.exec(`
            CREATE TABLE IF NOT EXISTS achievements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                icon TEXT DEFAULT 'fas fa-trophy',
                earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Финансовые советы на основе расходов
        await db.exec(`
            CREATE TABLE IF NOT EXISTS financial_advice (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                condition TEXT NOT NULL,
                advice_text TEXT NOT NULL,
                action_items TEXT,
                priority INTEGER DEFAULT 1
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

        // Демо-пользователь
        const demoUser = await db.get("SELECT 1 FROM users WHERE email = 'demo@quantumflow.test'");
        if (!demoUser) {
            const passwordHash = await bcrypt.hash('demo123', 12);
            
            await db.run(
                `INSERT INTO users 
                (email, username, password, first_name, 
                 goal_1_finance, goal_2_fitness, goal_3_habits, goal_4_productivity, goal_5_schedule,
                 goal_1_deadline, goal_2_deadline, goal_3_deadline, goal_4_deadline, goal_5_deadline,
                 level, coins, streak, balance, monthly_income, monthly_expenses,
                 weight, target_weight, smoking_status, alcohol_status) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    'demo@quantumflow.test',
                    'demo_user',
                    passwordHash,
                    'Демо',
                    1, 1, 1, 1, 1,  // Все цели активны
                    12, 6, 3, 1, 1, // Сроки
                    3, 1250, 12, 15840, 32500, 17600,
                    75.5, 70, 'former_smoker', 'social_drinker'
                ]
            );
            
            console.log('✅ Демо-пользователь создан');
        }

        const userId = await db.get("SELECT id FROM users WHERE email = 'demo@quantumflow.test'");
        if (!userId) return;

        // Финансовые цели демо
        const goalsExist = await db.get("SELECT 1 FROM financial_goals LIMIT 1");
        if (!goalsExist) {
            const goals = [
                [userId.id, 'Новый ноутбук', 150000, 45000, '2024-12-31', 'electronics', 'fas fa-laptop'],
                [userId.id, 'Отпуск на море', 80000, 20000, '2024-08-01', 'travel', 'fas fa-umbrella-beach'],
                [userId.id, 'Подушка безопасности', 100000, 60000, null, 'savings', 'fas fa-shield-alt']
            ];
            
            for (const goal of goals) {
                await db.run(
                    `INSERT INTO financial_goals (user_id, title, target_amount, current_amount, deadline, category, icon)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    goal
                );
            }
            console.log('✅ Демо-финансовые цели созданы');
        }

        // Программы упражнений
        const programsExist = await db.get("SELECT 1 FROM exercise_programs LIMIT 1");
        if (!programsExist) {
            const programs = [
                ['Похудение для новичков', '30-минутная кардио тренировка для сжигания жира', 'beginner', 30, 250,
                 JSON.stringify([
                    {name: 'Прыжки на месте', duration: 60, rest: 30},
                    {name: 'Приседания', duration: 45, rest: 15},
                    {name: 'Отжимания от стены', duration: 45, rest: 15},
                    {name: 'Планка', duration: 30, rest: 30},
                    {name: 'Бег на месте', duration: 60, rest: 30}
                 ]), 1, 0, 1],
                 
                ['Силовая тренировка дома', 'Упражнения с собственным весом для набора мышечной массы', 'intermediate', 40, 300,
                 JSON.stringify([
                    {name: 'Отжимания', sets: 3, reps: 15},
                    {name: 'Приседания с прыжком', sets: 3, reps: 20},
                    {name: 'Выпады', sets: 3, reps: 12},
                    {name: 'Подтягивания (если есть турник)', sets: 3, reps: 'до отказа'},
                    {name: 'Планка', duration: 60}
                 ]), 0, 1, 0]
            ];
            
            for (const program of programs) {
                await db.run(
                    `INSERT INTO exercise_programs (title, description, difficulty, duration, calories, exercises, for_weight_loss, for_strength, for_endurance)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    program
                );
            }
            console.log('✅ Демо-программы упражнений созданы');
        }

        // Практики для отказа от вредных привычек
        const practicesExist = await db.get("SELECT 1 FROM quitting_practices LIMIT 1");
        if (!practicesExist) {
            const practices = [
                ['Метод "5 минут"', 'Когда возникает желание закурить, подождите 5 минут и займитесь другим делом', 'smoking', 'easy', 5,
                 JSON.stringify([
                    'При появлении желания закурить посмотрите на часы',
                    'Скажите себе: "Я подожду всего 5 минут"',
                    'В течение этих 5 минут займитесь чем-то: выпейте воды, сделайте дыхательное упражнение',
                    'После 5 минут оцените, насколько сильным осталось желание',
                    'Повторяйте при необходимости'
                 ]), 85],
                 
                ['Альтернативные ритуалы', 'Замена утренней сигареты на здоровые привычки', 'smoking', 'medium', 15,
                 JSON.stringify([
                    'Определите триггеры, которые вызывают желание курить',
                    'Для каждого триггера придумайте альтернативное действие',
                    'Утренняя сигарета → стакан воды с лимоном',
                    'Сигарета после еды → чистка зубов',
                    'Сигарета при стрессе → дыхательное упражнение 4-7-8'
                 ]), 75],
                 
                ['Контроль окружения', 'Как избежать ситуаций, провоцирующих употребление алкоголя', 'alcohol', 'easy', 10,
                 JSON.stringify([
                    'Составьте список ситуаций, где вы обычно пьете',
                    'Планируйте альтернативные активности',
                    'Предупредите друзей о своем решении',
                    'Всегда имейте безалкогольный напиток в руке',
                    'Практикуйте вежливый отказ'
                 ]), 80]
            ];
            
            for (const practice of practices) {
                await db.run(
                    `INSERT INTO quitting_practices (title, description, for_habit, difficulty, duration, steps, success_rate)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    practice
                );
            }
            console.log('✅ Демо-практики для отказа созданы');
        }

        // Методы личной эффективности
        const methodsExist = await db.get("SELECT 1 FROM productivity_methods LIMIT 1");
        if (!methodsExist) {
            const methods = [
                ['Метод Pomodoro', '25 минут работы, 5 минут отдыха', 'fas fa-hourglass-half',
                 JSON.stringify([
                    'Выберите задачу',
                    'Установите таймер на 25 минут',
                    'Работайте без отвлечений',
                    'Сделайте 5-минутный перерыв',
                    'После 4 циклов сделайте длинный перерыв 15-30 минут'
                 ]), 25, 'focus'],
                 
                ['Матрица Эйзенхауэра', 'Приоритизация задач по срочности и важности', 'fas fa-th-list',
                 JSON.stringify([
                    'Составьте список всех задач',
                    'Разделите на 4 квадранта: Важно/Срочно, Важно/Не срочно, Не важно/Срочно, Не важно/Не срочно',
                    'Выполняйте задачи в порядке приоритета квадрантов',
                    'Делегируйте или удаляйте не важные задачи'
                 ]), 30, 'planning'],
                 
                ['Правило двух минут', 'Если задача занимает меньше 2 минут, делайте её сразу', 'fas fa-bolt',
                 JSON.stringify([
                    'Получив новую задачу, оцените время выполнения',
                    'Если задача занимает ≤2 минут, выполните её немедленно',
                    'Если >2 минут, запланируйте в системе',
                    'Применяйте к мелким задачам: ответы на email, уборка стола и т.д.'
                 ]), 2, 'execution']
            ];
            
            for (const method of methods) {
                await db.run(
                    `INSERT INTO productivity_methods (name, description, icon, steps, recommended_duration, category)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    method
                );
            }
            console.log('✅ Демо-методы эффективности созданы');
        }

        // Финансовые советы
        const adviceExist = await db.get("SELECT 1 FROM financial_advice LIMIT 1");
        if (!adviceExist) {
            const advice = [
                ['food', 'spending > 30% income', 'Вы тратите более 30% дохода на еду. Попробуйте планировать меню на неделю и покупать оптом.', '["Составить список покупок", "Использовать купоны", "Готовить дома чаще"]', 1],
                ['entertainment', 'spending > 15% income', 'Развлечения составляют значительную часть расходов. Установите месячный лимит.', '["Искать бесплатные мероприятия", "Использовать подписки вместо разовых покупок"]', 2],
                ['transport', 'spending > 10% income', 'Рассмотрите альтернативы: общественный транспорт, каршеринг, велосипед.', '["Проанализировать частоту поездок", "Объединять поездки"]', 3],
                ['savings', 'savings < 10% income', 'Старайтесь откладывать минимум 10% от дохода. Начните с автоматических переводов.', '["Настроить автоперевод в день зарплаты", "Начать с 5%"]', 1]
            ];
            
            for (const item of advice) {
                await db.run(
                    `INSERT INTO financial_advice (category, condition, advice_text, action_items, priority)
                     VALUES (?, ?, ?, ?, ?)`,
                    item
                );
            }
            console.log('✅ Демо-финансовые советы созданы');
        }

        // Демо-достижения
        const achievementsExist = await db.get("SELECT 1 FROM achievements LIMIT 1");
        if (!achievementsExist) {
            const achievements = [
                [userId.id, 'finance', 'Первые накопления', 'Накоплено первые 10,000 ₽', 'fas fa-coins'],
                [userId.id, 'fitness', 'Неделя тренировок', '7 дней подряд тренировок', 'fas fa-dumbbell'],
                [userId.id, 'habits', 'Месяц без сигарет', '30 дней без курения', 'fas fa-smoking-ban'],
                [userId.id, 'productivity', 'Мастер фокуса', '100 выполненных Pomodoro', 'fas fa-brain'],
                [userId.id, 'schedule', 'Ранняя пташка', '7 дней раннего подъема', 'fas fa-sun']
            ];
            
            for (const achievement of achievements) {
                await db.run(
                    `INSERT INTO achievements (user_id, category, title, description, icon)
                     VALUES (?, ?, ?, ?, ?)`,
                    achievement
                );
            }
            console.log('✅ Демо-достижения созданы');
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
                `SELECT id, email, username, first_name, last_name,
                        goal_1_finance, goal_2_fitness, goal_3_habits, goal_4_productivity, goal_5_schedule,
                        goal_1_deadline, goal_2_deadline, goal_3_deadline, goal_4_deadline, goal_5_deadline,
                        level, coins, streak, balance, monthly_income, monthly_expenses,
                        weight, height, target_weight, activity_level,
                        smoking_status, alcohol_status,
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
        message: '🚀 Добро пожаловать в QuantumFlow API v2.0',
        version: '2.0.0',
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
        const { email, username, password, first_name, last_name = '', 
                goals, deadlines } = req.body;
        
        if (!email || !username || !password || !first_name || !goals) {
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
        
        // Парсинг целей и сроков
        const goalFields = {};
        const deadlineFields = {};
        
        if (goals) {
            const goalList = goals.split(',').map(g => parseInt(g));
            goalFields.goal_1_finance = goalList.includes(1) ? 1 : 0;
            goalFields.goal_2_fitness = goalList.includes(2) ? 1 : 0;
            goalFields.goal_3_habits = goalList.includes(3) ? 1 : 0;
            goalFields.goal_4_productivity = goalList.includes(4) ? 1 : 0;
            goalFields.goal_5_schedule = goalList.includes(5) ? 1 : 0;
        }
        
        if (deadlines) {
            const deadlineList = deadlines.split(',').map(d => parseInt(d));
            deadlineFields.goal_1_deadline = deadlineList[0] || 12;
            deadlineFields.goal_2_deadline = deadlineList[1] || 6;
            deadlineFields.goal_3_deadline = deadlineList[2] || 3;
            deadlineFields.goal_4_deadline = deadlineList[3] || 1;
            deadlineFields.goal_5_deadline = deadlineList[4] || 1;
        }
        
        const result = await db.run(
            `INSERT INTO users (email, username, password, first_name, last_name,
                               goal_1_finance, goal_2_fitness, goal_3_habits, goal_4_productivity, goal_5_schedule,
                               goal_1_deadline, goal_2_deadline, goal_3_deadline, goal_4_deadline, goal_5_deadline) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                email, username, hashedPassword, first_name, last_name,
                goalFields.goal_1_finance || 0, goalFields.goal_2_fitness || 0, 
                goalFields.goal_3_habits || 0, goalFields.goal_4_productivity || 0,
                goalFields.goal_5_schedule || 0,
                deadlineFields.goal_1_deadline || 12, deadlineFields.goal_2_deadline || 6,
                deadlineFields.goal_3_deadline || 3, deadlineFields.goal_4_deadline || 1,
                deadlineFields.goal_5_deadline || 1
            ]
        );
        
        const userId = result.lastID;
        
        // Создаем первое достижение
        await db.run(
            `INSERT INTO achievements (user_id, category, title, description, icon) 
             VALUES (?, 'general', 'Первые шаги', 'Добро пожаловать в QuantumFlow!', 'fas fa-flag')`,
            [userId]
        );
        
        const user = await db.get(
            `SELECT id, email, username, first_name, last_name,
                    goal_1_finance, goal_2_fitness, goal_3_habits, goal_4_productivity, goal_5_schedule,
                    goal_1_deadline, goal_2_deadline, goal_3_deadline, goal_4_deadline, goal_5_deadline,
                    level, coins, streak, balance
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
            goal_1_finance: user.goal_1_finance,
            goal_2_fitness: user.goal_2_fitness,
            goal_3_habits: user.goal_3_habits,
            goal_4_productivity: user.goal_4_productivity,
            goal_5_schedule: user.goal_5_schedule,
            goal_1_deadline: user.goal_1_deadline,
            goal_2_deadline: user.goal_2_deadline,
            goal_3_deadline: user.goal_3_deadline,
            goal_4_deadline: user.goal_4_deadline,
            goal_5_deadline: user.goal_5_deadline,
            level: user.level,
            coins: user.coins,
            streak: user.streak,
            balance: user.balance,
            monthly_income: user.monthly_income,
            monthly_expenses: user.monthly_expenses,
            weight: user.weight,
            height: user.height,
            target_weight: user.target_weight,
            activity_level: user.activity_level,
            smoking_status: user.smoking_status,
            alcohol_status: user.alcohol_status,
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

// ==================== ПОЛЬЗОВАТЕЛЬ И НАСТРОЙКИ ====================

// Получение текущего пользователя
app.get('/api/user/current', authMiddleware, async (req, res) => {
    try {
        const user = await db.get(
            `SELECT id, email, username, first_name, last_name,
                    goal_1_finance, goal_2_fitness, goal_3_habits, goal_4_productivity, goal_5_schedule,
                    goal_1_deadline, goal_2_deadline, goal_3_deadline, goal_4_deadline, goal_5_deadline,
                    level, coins, streak, balance, monthly_income, monthly_expenses,
                    weight, height, target_weight, activity_level,
                    smoking_status, alcohol_status, smoking_start_date, alcohol_start_date,
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

// Обновление настроек пользователя
app.put('/api/user/settings', authMiddleware, async (req, res) => {
    try {
        const { 
            first_name, last_name, 
            goal_1_finance, goal_2_fitness, goal_3_habits, goal_4_productivity, goal_5_schedule,
            goal_1_deadline, goal_2_deadline, goal_3_deadline, goal_4_deadline, goal_5_deadline,
            weight, height, target_weight, activity_level,
            smoking_status, alcohol_status
        } = req.body;
        
        const updateFields = [];
        const updateValues = [];
        
        if (first_name !== undefined) {
            updateFields.push('first_name = ?');
            updateValues.push(first_name);
        }
        
        if (last_name !== undefined) {
            updateFields.push('last_name = ?');
            updateValues.push(last_name);
        }
        
        // Обновление целей
        const goals = [
            {field: 'goal_1_finance', value: goal_1_finance},
            {field: 'goal_2_fitness', value: goal_2_fitness},
            {field: 'goal_3_habits', value: goal_3_habits},
            {field: 'goal_4_productivity', value: goal_4_productivity},
            {field: 'goal_5_schedule', value: goal_5_schedule}
        ];
        
        goals.forEach(goal => {
            if (goal.value !== undefined) {
                updateFields.push(`${goal.field} = ?`);
                updateValues.push(goal.value ? 1 : 0);
            }
        });
        
        // Обновление сроков
        const deadlines = [
            {field: 'goal_1_deadline', value: goal_1_deadline},
            {field: 'goal_2_deadline', value: goal_2_deadline},
            {field: 'goal_3_deadline', value: goal_3_deadline},
            {field: 'goal_4_deadline', value: goal_4_deadline},
            {field: 'goal_5_deadline', value: goal_5_deadline}
        ];
        
        deadlines.forEach(deadline => {
            if (deadline.value !== undefined) {
                updateFields.push(`${deadline.field} = ?`);
                updateValues.push(parseInt(deadline.value));
            }
        });
        
        // Обновление данных здоровья
        if (weight !== undefined) {
            updateFields.push('weight = ?');
            updateValues.push(parseFloat(weight));
        }
        
        if (height !== undefined) {
            updateFields.push('height = ?');
            updateValues.push(parseFloat(height));
        }
        
        if (target_weight !== undefined) {
            updateFields.push('target_weight = ?');
            updateValues.push(parseFloat(target_weight));
        }
        
        if (activity_level !== undefined) {
            updateFields.push('activity_level = ?');
            updateValues.push(activity_level);
        }
        
        // Обновление статусов вредных привычек
        if (smoking_status !== undefined) {
            updateFields.push('smoking_status = ?');
            updateValues.push(smoking_status);
            if (smoking_status === 'former_smoker') {
                updateFields.push('smoking_start_date = CURRENT_DATE');
            }
        }
        
        if (alcohol_status !== undefined) {
            updateFields.push('alcohol_status = ?');
            updateValues.push(alcohol_status);
            if (alcohol_status === 'former_drinker') {
                updateFields.push('alcohol_start_date = CURRENT_DATE');
            }
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
        
        // Получаем обновленного пользователя
        const user = await db.get(
            `SELECT id, email, username, first_name, last_name,
                    goal_1_finance, goal_2_fitness, goal_3_habits, goal_4_productivity, goal_5_schedule,
                    goal_1_deadline, goal_2_deadline, goal_3_deadline, goal_4_deadline, goal_5_deadline,
                    level, coins, streak, balance, monthly_income, monthly_expenses,
                    weight, height, target_weight, activity_level,
                    smoking_status, alcohol_status,
                    tasks_completed, habits_streak
             FROM users WHERE id = ?`,
            [req.user.id]
        );
        
        res.json({
            success: true,
            message: 'Настройки обновлены',
            data: { user }
        });
        
    } catch (error) {
        console.error('Ошибка обновления настроек:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка обновления настроек'
        });
    }
});

// ==================== СТАТИСТИКА ПОЛЬЗОВАТЕЛЯ ====================

// Полная статистика для страницы настроек
app.get('/api/user/stats', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Основные данные пользователя
        const userData = await db.get(
            `SELECT goal_1_finance, goal_2_fitness, goal_3_habits, goal_4_productivity, goal_5_schedule,
                    level, coins, streak, tasks_completed, habits_streak
             FROM users WHERE id = ?`,
            [userId]
        );
        
        // Финансовая статистика
        const financeStats = await db.get(
            `SELECT balance, monthly_income, monthly_expenses
             FROM users WHERE id = ?`,
            [userId]
        );
        
        // Статистика по финансовым целям
        const financeGoals = await db.all(
            `SELECT COUNT(*) as total_goals,
                    SUM(CASE WHEN current_amount >= target_amount THEN 1 ELSE 0 END) as completed_goals,
                    SUM(target_amount) as total_target,
                    SUM(current_amount) as total_current
             FROM financial_goals WHERE user_id = ? AND is_active = 1`,
            [userId]
        );
        
        // Статистика по тренировкам
        const workoutStats = await db.get(
            `SELECT COUNT(*) as total_workouts,
                    SUM(calories) as total_calories,
                    SUM(duration) as total_minutes
             FROM workouts WHERE user_id = ? AND completed = 1`,
            [userId]
        );
        
        // Статистика по вредным привычкам
        const habitStats = await db.get(
            `SELECT smoking_status, alcohol_status,
                    CASE WHEN smoking_start_date IS NOT NULL 
                         THEN JULIANDAY('now') - JULIANDAY(smoking_start_date) 
                         ELSE 0 END as days_smoke_free,
                    CASE WHEN alcohol_start_date IS NOT NULL 
                         THEN JULIANDAY('now') - JULIANDAY(alcohol_start_date) 
                         ELSE 0 END as days_alcohol_free
             FROM users WHERE id = ?`,
            [userId]
        );
        
        // Прогресс по похудению
        let weightProgress = { current: 0, target: 0, lost: 0, to_go: 0 };
        const weightData = await db.get(
            `SELECT weight, target_weight FROM users WHERE id = ?`,
            [userId]
        );
        
        if (weightData && weightData.weight && weightData.target_weight) {
            weightProgress = {
                current: weightData.weight,
                target: weightData.target_weight,
                lost: weightData.target_weight < weightData.weight ? 
                      weightData.weight - weightData.target_weight : 0,
                to_go: weightData.target_weight < weightData.weight ? 
                       weightData.weight - weightData.target_weight : 0
            };
        }
        
        res.json({
            success: true,
            data: {
                user_data: userData,
                finance_stats: financeStats,
                finance_goals: financeGoals[0] || {},
                workout_stats: workoutStats || {},
                habit_stats: habitStats || {},
                weight_progress: weightProgress
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

// ==================== ФИНАНСЫ ====================

// Полная финансовая статистика
app.get('/api/finance/full-stats', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Баланс и основные показатели
        const userFinance = await db.get(
            `SELECT balance, monthly_income, monthly_expenses
             FROM users WHERE id = ?`,
            [userId]
        );
        
        // Активные цели
        const activeGoals = await db.all(
            `SELECT * FROM financial_goals 
             WHERE user_id = ? AND is_active = 1
             ORDER BY deadline ASC`,
            [userId]
        );
        
        // Статистика по категориям расходов за текущий месяц
        const categoryStats = await db.all(
            `SELECT category, SUM(amount) as total, COUNT(*) as count
             FROM transactions 
             WHERE user_id = ? AND type = 'expense' 
                   AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')
             GROUP BY category
             ORDER BY total DESC`,
            [userId]
        );
        
        // Рекомендации на основе расходов
        let advice = [];
        for (const cat of categoryStats) {
            const categoryAdvice = await db.all(
                `SELECT * FROM financial_advice 
                 WHERE category = ? AND priority <= 2
                 LIMIT 2`,
                [cat.category]
            );
            advice = [...advice, ...categoryAdvice];
        }
        
        // Если рекомендаций мало, добавить общие
        if (advice.length < 3) {
            const generalAdvice = await db.all(
                `SELECT * FROM financial_advice 
                 WHERE category = 'savings' OR category = 'general'
                 ORDER BY priority ASC
                 LIMIT 5`,
                []
            );
            advice = [...advice, ...generalAdvice];
        }
        
        // Последние транзакции
        const recentTransactions = await db.all(
            `SELECT * FROM transactions 
             WHERE user_id = ?
             ORDER BY date DESC, created_at DESC
             LIMIT 10`,
            [userId]
        );
        
        res.json({
            success: true,
            data: {
                balance: userFinance?.balance || 0,
                monthly_income: userFinance?.monthly_income || 0,
                monthly_expenses: userFinance?.monthly_expenses || 0,
                savings_rate: userFinance?.monthly_income > 0 ? 
                    Math.round(((userFinance.monthly_income - userFinance.monthly_expenses) / userFinance.monthly_income) * 100) : 0,
                active_goals: activeGoals,
                category_stats: categoryStats,
                advice: advice.slice(0, 5),
                recent_transactions: recentTransactions
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения финансовой статистики:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения финансовой статистики'
        });
    }
});

// Создание финансовой цели
app.post('/api/finance/goals', authMiddleware, async (req, res) => {
    try {
        const { title, target_amount, current_amount, deadline, category, icon } = req.body;
        
        if (!title || !target_amount) {
            return res.status(400).json({
                success: false,
                error: 'Заполните название и целевую сумму'
            });
        }
        
        const result = await db.run(
            `INSERT INTO financial_goals 
            (user_id, title, target_amount, current_amount, deadline, category, icon) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                title,
                parseFloat(target_amount),
                parseFloat(current_amount) || 0,
                deadline || null,
                category || 'savings',
                icon || 'fas fa-piggy-bank'
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

// Пополнение копилки
app.post('/api/finance/goals/:id/add', authMiddleware, async (req, res) => {
    try {
        const goalId = req.params.id;
        const { amount } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Укажите корректную сумму'
            });
        }
        
        // Проверяем существование цели
        const goal = await db.get(
            'SELECT * FROM financial_goals WHERE id = ? AND user_id = ?',
            [goalId, req.user.id]
        );
        
        if (!goal) {
            return res.status(404).json({
                success: false,
                error: 'Цель не найдена'
            });
        }
        
        // Обновляем текущую сумму
        const newAmount = goal.current_amount + parseFloat(amount);
        
        await db.run(
            'UPDATE financial_goals SET current_amount = ? WHERE id = ?',
            [newAmount, goalId]
        );
        
        // Создаем транзакцию перевода
        await db.run(
            `INSERT INTO transactions 
            (user_id, type, amount, category, description) 
            VALUES (?, 'expense', ?, 'savings', ?)`,
            [
                req.user.id,
                amount,
                `Пополнение цели: ${goal.title}`
            ]
        );
        
        // Проверяем достижение цели
        let achievementMessage = '';
        if (newAmount >= goal.target_amount) {
            achievementMessage = '🎉 Цель достигнута! Поздравляем!';
            
            // Создаем достижение
            await db.run(
                `INSERT INTO achievements (user_id, category, title, description, icon) 
                 VALUES (?, 'finance', 'Цель достигнута', 'Накопили на ${goal.title}', 'fas fa-trophy')`,
                [req.user.id]
            );
        }
        
        const updatedGoal = await db.get('SELECT * FROM financial_goals WHERE id = ?', [goalId]);
        
        res.json({
            success: true,
            message: `Средства добавлены в копилку${achievementMessage ? '. ' + achievementMessage : ''}`,
            data: { goal: updatedGoal }
        });
        
    } catch (error) {
        console.error('Ошибка пополнения копилки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка пополнения копилки'
        });
    }
});

// ==================== ФИТНЕС И ПОХУДЕНИЕ ====================

// Получение рекомендаций по упражнениям
app.get('/api/fitness/recommendations', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Получаем данные пользователя
        const user = await db.get(
            `SELECT weight, target_weight, activity_level 
             FROM users WHERE id = ?`,
            [userId]
        );
        
        let recommendations = [];
        
        // Рекомендации для похудения
        if (user.weight > user.target_weight) {
            const weightLossPrograms = await db.all(
                `SELECT * FROM exercise_programs 
                 WHERE for_weight_loss = 1 
                 AND difficulty = ?
                 ORDER BY calories DESC
                 LIMIT 3`,
                [user.activity_level === 'low' ? 'beginner' : 
                 user.activity_level === 'medium' ? 'intermediate' : 'advanced']
            );
            recommendations = [...recommendations, ...weightLossPrograms];
        }
        
        // Если рекомендаций мало, добавить общие
        if (recommendations.length < 2) {
            const generalPrograms = await db.all(
                `SELECT * FROM exercise_programs 
                 WHERE difficulty = ?
                 ORDER BY RANDOM()
                 LIMIT 2`,
                [user.activity_level === 'low' ? 'beginner' : 'intermediate']
            );
            recommendations = [...recommendations, ...generalPrograms];
        }
        
        // Расчет калорий для похудения
        const bmr = 10 * user.weight + 6.25 * 170 - 5 * 30 + 5; // Примерный BMR
        const activityMultiplier = {
            'low': 1.2,
            'medium': 1.55,
            'high': 1.725
        }[user.activity_level] || 1.55;
        
        const dailyCalories = Math.round(bmr * activityMultiplier);
        const weightLossCalories = Math.max(dailyCalories - 500, 1200);
        
        res.json({
            success: true,
            data: {
                recommendations,
                calorie_info: {
                    daily_maintenance: dailyCalories,
                    weight_loss_target: weightLossCalories,
                    weekly_weight_loss: 0.5, // кг в неделю
                    target_date: new Date(Date.now() + 
                        ((user.weight - user.target_weight) / 0.5 * 7 * 24 * 60 * 60 * 1000))
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения рекомендаций:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения рекомендаций'
        });
    }
});

// Старт тренировки
app.post('/api/fitness/start-workout', authMiddleware, async (req, res) => {
    try {
        const { program_id, custom_title, duration } = req.body;
        
        let workoutData = {};
        
        if (program_id) {
            // Используем готовую программу
            const program = await db.get(
                'SELECT * FROM exercise_programs WHERE id = ?',
                [program_id]
            );
            
            if (!program) {
                return res.status(404).json({
                    success: false,
                    error: 'Программа не найдена'
                });
            }
            
            workoutData = {
                user_id: req.user.id,
                type: 'program',
                title: program.title,
                duration: duration || program.duration,
                calories: program.calories
            };
        } else if (custom_title) {
            // Своя тренировка
            workoutData = {
                user_id: req.user.id,
                type: 'custom',
                title: custom_title,
                duration: duration || 30,
                calories: Math.round((duration || 30) * 8) // Примерный расчет
            };
        } else {
            return res.status(400).json({
                success: false,
                error: 'Укажите программу или название тренировки'
            });
        }
        
        const result = await db.run(
            `INSERT INTO workouts (user_id, type, title, duration, calories) 
             VALUES (?, ?, ?, ?, ?)`,
            [
                workoutData.user_id,
                workoutData.type,
                workoutData.title,
                workoutData.duration,
                workoutData.calories
            ]
        );
        
        const workoutId = result.lastID;
        const workout = await db.get('SELECT * FROM workouts WHERE id = ?', [workoutId]);
        
        res.status(201).json({
            success: true,
            message: 'Тренировка начата',
            data: { 
                workout,
                timer_duration: workout.duration * 60 // в секундах
            }
        });
        
    } catch (error) {
        console.error('Ошибка старта тренировки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка старта тренировки'
        });
    }
});

// Завершение тренировки
app.post('/api/fitness/complete-workout/:id', authMiddleware, async (req, res) => {
    try {
        const workoutId = req.params.id;
        
        const workout = await db.get(
            'SELECT * FROM workouts WHERE id = ? AND user_id = ?',
            [workoutId, req.user.id]
        );
        
        if (!workout) {
            return res.status(404).json({
                success: false,
                error: 'Тренировка не найдена'
            });
        }
        
        if (workout.completed) {
            return res.status(400).json({
                success: false,
                error: 'Тренировка уже завершена'
            });
        }
        
        await db.run(
            'UPDATE workouts SET completed = 1 WHERE id = ?',
            [workoutId]
        );
        
        // Начисляем монеты
        await db.run(
            'UPDATE users SET coins = coins + 15 WHERE id = ?',
            [req.user.id]
        );
        
        // Проверяем достижения
        const workoutCount = await db.get(
            'SELECT COUNT(*) as count FROM workouts WHERE user_id = ? AND completed = 1',
            [req.user.id]
        );
        
        if (workoutCount.count === 1) {
            await db.run(
                `INSERT INTO achievements (user_id, category, title, description, icon) 
                 VALUES (?, 'fitness', 'Первая тренировка', 'Завершили первую тренировку!', 'fas fa-dumbbell')`,
                [req.user.id]
            );
        }
        
        if (workoutCount.count === 7) {
            await db.run(
                `INSERT INTO achievements (user_id, category, title, description, icon) 
                 VALUES (?, 'fitness', 'Неделя тренировок', '7 дней подряд тренировок', 'fas fa-trophy')`,
                [req.user.id]
            );
        }
        
        res.json({
            success: true,
            message: 'Тренировка завершена! +15 монет',
            data: { 
                coins_awarded: 15,
                total_workouts: workoutCount.count
            }
        });
        
    } catch (error) {
        console.error('Ошибка завершения тренировки:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка завершения тренировки'
        });
    }
});

// ==================== ВРЕДНЫЕ ПРИВЫЧКИ ====================

// Получение практик для отказа
app.get('/api/habits/practices', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Получаем статус привычек пользователя
        const user = await db.get(
            `SELECT smoking_status, alcohol_status 
             FROM users WHERE id = ?`,
            [userId]
        );
        
        let practices = [];
        
        // Практики для курения
        if (user.smoking_status === 'smoker' || user.smoking_status === 'social_smoker') {
            const smokingPractices = await db.all(
                `SELECT * FROM quitting_practices 
                 WHERE for_habit = 'smoking'
                 ORDER BY success_rate DESC
                 LIMIT 3`
            );
            practices = [...practices, ...smokingPractices];
        }
        
        // Практики для алкоголя
        if (user.alcohol_status === 'drinker' || user.alcohol_status === 'social_drinker') {
            const alcoholPractices = await db.all(
                `SELECT * FROM quitting_practices 
                 WHERE for_habit = 'alcohol'
                 ORDER BY success_rate DESC
                 LIMIT 3`
            );
            practices = [...practices, ...alcoholPractices];
        }
        
        // Если пользователь уже бросил, показываем практики для поддержания
        if (user.smoking_status === 'former_smoker' || user.alcohol_status === 'former_drinker') {
            const maintenancePractices = await db.all(
                `SELECT * FROM quitting_practices 
                 WHERE for_habit IN ('smoking', 'alcohol') AND difficulty = 'easy'
                 ORDER BY RANDOM()
                 LIMIT 2`
            );
            practices = [...practices, ...maintenancePractices];
        }
        
        // Добавляем статистику
        const habitStats = await db.get(
            `SELECT 
                CASE WHEN smoking_start_date IS NOT NULL 
                     THEN JULIANDAY('now') - JULIANDAY(smoking_start_date) 
                     ELSE 0 END as days_smoke_free,
                CASE WHEN alcohol_start_date IS NOT NULL 
                     THEN JULIANDAY('now') - JULIANDAY(alcohol_start_date) 
                     ELSE 0 END as days_alcohol_free
             FROM users WHERE id = ?`,
            [userId]
        );
        
        // Расчет сэкономленных денег
        const moneySaved = {
            smoking: Math.round((habitStats.days_smoke_free || 0) * 200), // 200 руб в день на сигареты
            alcohol: Math.round((habitStats.days_alcohol_free || 0) * 150) // 150 руб в день на алкоголь
        };
        
       res.json({
    success: true,
    data: {
        practices: practices.slice(0, 5),
        stats: habitStats,
        money_saved: moneySaved,
        health_improvements: calculateHealthImprovements(habitStats) // Исправить на этот вызов
    }
});
        
    } catch (error) {
        console.error('Ошибка получения практик:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения практик'
        });
    }
});

// Начать практику отказа
app.post('/api/habits/start-practice', authMiddleware, async (req, res) => {
    try {
        const { practice_id, habit_type } = req.body;
        
        if (!practice_id || !habit_type) {
            return res.status(400).json({
                success: false,
                error: 'Укажите практику и тип привычки'
            });
        }
        
        // Получаем практику
        const practice = await db.get(
            'SELECT * FROM quitting_practices WHERE id = ?',
            [practice_id]
        );
        
        if (!practice) {
            return res.status(404).json({
                success: false,
                error: 'Практика не найдена'
            });
        }
        
        // Создаем запись в трекере
        const result = await db.run(
            `INSERT INTO bad_habits_tracker 
            (user_id, habit_type, status, start_date) 
            VALUES (?, ?, 'in_progress', CURRENT_DATE)`,
            [req.user.id, habit_type]
        );
        
        const trackerId = result.lastID;
        
        res.status(201).json({
            success: true,
            message: 'Практика начата! Вы на пути к изменениям.',
            data: {
                practice: practice,
                tracker_id: trackerId,
                estimated_success_rate: practice.success_rate
            }
        });
        
    } catch (error) {
        console.error('Ошибка начала практики:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка начала практики'
        });
    }
});

// Отметить день без привычки
app.post('/api/habits/mark-day', authMiddleware, async (req, res) => {
    try {
        const { habit_type } = req.body;
        
        const tracker = await db.get(
            `SELECT * FROM bad_habits_tracker 
             WHERE user_id = ? AND habit_type = ? AND status = 'in_progress'
             ORDER BY start_date DESC LIMIT 1`,
            [req.user.id, habit_type]
        );
        
        if (!tracker) {
            return res.status(404).json({
                success: false,
                error: 'Активный трекер не найден'
            });
        }
        
        // Обновляем статистику
        const daysFree = Math.floor((new Date() - new Date(tracker.start_date)) / (1000 * 60 * 60 * 24)) + 1;
        const moneySaved = daysFree * (habit_type === 'smoking' ? 200 : 150);
        
        await db.run(
            `UPDATE bad_habits_tracker 
             SET cravings_today = cravings_today + 1,
                 money_saved = ?
             WHERE id = ?`,
            [moneySaved, tracker.id]
        );
        
        // Начисляем монеты
        await db.run(
            'UPDATE users SET coins = coins + 20 WHERE id = ?',
            [req.user.id]
        );
        
        // Проверяем достижения
        if (daysFree === 1) {
            await db.run(
                `INSERT INTO achievements (user_id, category, title, description, icon) 
                 VALUES (?, 'habits', 'Первый день', 'Первый день без ${habit_type === "smoking" ? "курения" : "алкоголя"}', 'fas fa-star')`,
                [req.user.id]
            );
        }
        
        if (daysFree === 7) {
            await db.run(
                `INSERT INTO achievements (user_id, category, title, description, icon) 
                 VALUES (?, 'habits', 'Неделя свободы', '7 дней без ${habit_type === "smoking" ? "курения" : "алкоголя"}', 'fas fa-trophy')`,
                [req.user.id]
            );
        }
        
        if (daysFree === 30) {
            await db.run(
                `INSERT INTO achievements (user_id, category, title, description, icon) 
                 VALUES (?, 'habits', 'Месяц победителя', '30 дней без ${habit_type === "smoking" ? "курения" : "алкоголя"}!', 'fas fa-crown')`,
                [req.user.id]
            );
        }
        
        res.json({
            success: true,
            message: `Отличная работа! День ${daysFree} без ${habit_type === 'smoking' ? 'сигарет' : 'алкоголя'}. +20 монет`,
            data: {
                days_free: daysFree,
                money_saved: moneySaved,
                coins_awarded: 20
            }
        });
        
    } catch (error) {
        console.error('Ошибка отметки дня:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отметки дня'
        });
    }
});

// ==================== ЛИЧНАЯ ЭФФЕКТИВНОСТЬ ====================

// Получение методов эффективности
app.get('/api/productivity/methods', authMiddleware, async (req, res) => {
    try {
        const methods = await db.all(
            `SELECT * FROM productivity_methods 
             ORDER BY category, name`
        );
        
        // Группировка по категориям
        const groupedMethods = methods.reduce((acc, method) => {
            if (!acc[method.category]) {
                acc[method.category] = [];
            }
            acc[method.category].push(method);
            return acc;
        }, {});
        
        res.json({
            success: true,
            data: {
                methods: groupedMethods,
                total_methods: methods.length
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения методов:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка получения методов'
        });
    }
});

// Старт сессии продуктивности
app.post('/api/productivity/start-session', authMiddleware, async (req, res) => {
    try {
        const { method_id, custom_method, duration } = req.body;
        
        let sessionData = {};
        
        if (method_id) {
            const method = await db.get(
                'SELECT * FROM productivity_methods WHERE id = ?',
                [method_id]
            );
            
            if (!method) {
                return res.status(404).json({
                    success: false,
                    error: 'Метод не найден'
                });
            }
            
            sessionData = {
                title: method.name,
                description: method.description,
                duration: duration || method.recommended_duration,
                method: method.name
            };
        } else if (custom_method) {
            sessionData = {
                title: custom_method,
                description: 'Пользовательская сессия продуктивности',
                duration: duration || 25,
                method: 'custom'
            };
        } else {
            return res.status(400).json({
                success: false,
                error: 'Укажите метод или название сессии'
            });
        }
        
        res.json({
            success: true,
            message: 'Сессия продуктивности начата',
            data: {
                session: sessionData,
                timer_duration: sessionData.duration * 60, // в секундах
                start_time: new Date().toISOString(),
                estimated_end_time: new Date(Date.now() + sessionData.duration * 60 * 1000).toISOString()
            }
        });
        
    } catch (error) {
        console.error('Ошибка старта сессии:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка старта сессии'
        });
    }
});

// Завершение сессии продуктивности
app.post('/api/productivity/complete-session', authMiddleware, async (req, res) => {
    try {
        const { session_title, duration_actual, distractions } = req.body;
        
        if (!session_title || !duration_actual) {
            return res.status(400).json({
                success: false,
                error: 'Укажите название сессии и фактическую длительность'
            });
        }
        
        // Начисляем монеты
        const coinsAwarded = Math.min(30, Math.round(duration_actual / 5) * 5);
        await db.run(
            'UPDATE users SET coins = coins + ?, tasks_completed = tasks_completed + 1 WHERE id = ?',
            [coinsAwarded, req.user.id]
        );
        
        // Проверяем достижения
        const sessionCount = await db.get(
            'SELECT tasks_completed FROM users WHERE id = ?',
            [req.user.id]
        );
        
        let achievementMessage = '';
        if (sessionCount.tasks_completed === 10) {
            achievementMessage = '🎉 10 завершенных сессий!';
            await db.run(
                `INSERT INTO achievements (user_id, category, title, description, icon) 
                 VALUES (?, 'productivity', 'Мастер фокуса', '10 завершенных сессий продуктивности', 'fas fa-brain')`,
                [req.user.id]
            );
        }
        
        if (sessionCount.tasks_completed === 50) {
            achievementMessage = '🎉 50 завершенных сессий! Вы настоящий профи!';
            await db.run(
                `INSERT INTO achievements (user_id, category, title, description, icon) 
                 VALUES (?, 'productivity', 'Гуру продуктивности', '50 завершенных сессий продуктивности', 'fas fa-crown')`,
                [req.user.id]
            );
        }
        
        res.json({
            success: true,
            message: `Сессия "${session_title}" завершена! +${coinsAwarded} монет${achievementMessage ? '. ' + achievementMessage : ''}`,
            data: {
                coins_awarded: coinsAwarded,
                total_sessions: sessionCount.tasks_completed,
                distractions: distractions || 0,
                focus_score: distractions ? Math.round(100 - (distractions * 10)) : 95
            }
        });
        
    } catch (error) {
        console.error('Ошибка завершения сессии:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка завершения сессии'
        });
    }
});

// ==================== РАСПОРЯДОК ДНЯ ====================

// Генерация распорядка дня
app.get('/api/schedule/generate', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Получаем предпочтения пользователя
        const user = await db.get(
            `SELECT goal_5_schedule, goal_5_deadline 
             FROM users WHERE id = ?`,
            [userId]
        );
        
        // Базовый распорядок (можно расширить)
        const baseSchedule = [
            { time: '07:00', activity: 'Пробуждение и утренние ритуалы', duration: 60, priority: 1 },
            { time: '08:00', activity: 'Завтрак и планирование дня', duration: 30, priority: 2 },
            { time: '09:00', activity: 'Работа/учеба (блок 1)', duration: 90, priority: 1 },
            { time: '10:30', activity: 'Перерыв и физическая активность', duration: 15, priority: 3 },
            { time: '10:45', activity: 'Работа/учеба (блок 2)', duration: 90, priority: 1 },
            { time: '12:15', activity: 'Обед', duration: 45, priority: 2 },
            { time: '13:00', activity: 'Работа/учеба (блок 3)', duration: 90, priority: 1 },
            { time: '14:30', activity: 'Послеобеденный перерыв', duration: 15, priority: 3 },
            { time: '14:45', activity: 'Работа/учеба (блок 4)', duration: 90, priority: 1 },
            { time: '16:15', activity: 'Завершение рабочего дня', duration: 30, priority: 2 },
            { time: '16:45', activity: 'Спорт/отдых/хобби', duration: 60, priority: 2 },
            { time: '17:45', activity: 'Ужин', duration: 45, priority: 2 },
            { time: '18:30', activity: 'Семья/отдых/развитие', duration: 90, priority: 3 },
            { time: '20:00', activity: 'Вечерние ритуалы', duration: 60, priority: 2 },
            { time: '21:00', activity: 'Подготовка ко сну', duration: 30, priority: 1 },
            { time: '21:30', activity: 'Сон', duration: 570, priority: 1 }
        ];
        
        // Очищаем старый распорядок и добавляем новый
        await db.run('DELETE FROM daily_schedules WHERE user_id = ? AND date = DATE("now")', [userId]);
        
        for (const item of baseSchedule) {
            await db.run(
                `INSERT INTO daily_schedules 
                (user_id, day_type, time_slot, activity, duration, priority, date) 
                VALUES (?, 'weekday', ?, ?, ?, ?, DATE("now"))`,
                [userId, item.time, item.activity, item.duration, item.priority]
            );
        }
        
        const todaySchedule = await db.all(
            `SELECT * FROM daily_schedules 
             WHERE user_id = ? AND date = DATE("now")
             ORDER BY time_slot`,
            [userId]
        );
        
        // Расчет прогресса
        const totalActivities = todaySchedule.length;
        const completedActivities = todaySchedule.filter(a => a.completed).length;
        const progress = totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0;
        
        res.json({
            success: true,
            data: {
                schedule: todaySchedule,
                progress: progress,
                total_activities: totalActivities,
                completed: completedActivities,
                recommendation: progress > 70 ? 
                    'Отличный прогресс!' : 
                    'Продолжайте следовать распорядку!'
            }
        });
        
    } catch (error) {
        console.error('Ошибка генерации распорядка:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка генерации распорядка'
        });
    }
});

// Отметить активность как выполненную
app.post('/api/schedule/complete/:id', authMiddleware, async (req, res) => {
    try {
        const scheduleId = req.params.id;
        
        const activity = await db.get(
            'SELECT * FROM daily_schedules WHERE id = ? AND user_id = ?',
            [scheduleId, req.user.id]
        );
        
        if (!activity) {
            return res.status(404).json({
                success: false,
                error: 'Активность не найдена'
            });
        }
        
        if (activity.completed) {
            return res.status(400).json({
                success: false,
                error: 'Активность уже выполнена'
            });
        }
        
        await db.run(
            'UPDATE daily_schedules SET completed = 1 WHERE id = ?',
            [scheduleId]
        );
        
        // Начисляем монеты в зависимости от приоритета
        const coinsAwarded = activity.priority === 1 ? 10 : activity.priority === 2 ? 5 : 2;
        await db.run(
            'UPDATE users SET coins = coins + ? WHERE id = ?',
            [coinsAwarded, req.user.id]
        );
        
        // Проверяем выполнение всего распорядка
        const todaySchedule = await db.all(
            `SELECT * FROM daily_schedules 
             WHERE user_id = ? AND date = DATE("now")`,
            [req.user.id]
        );
        
        const totalActivities = todaySchedule.length;
        const completedActivities = todaySchedule.filter(a => a.completed).length;
        const progress = totalActivities > 0 ? Math.round((completedActivities / totalActivities) * 100) : 0;
        
        let achievementMessage = '';
        if (progress === 100) {
            achievementMessage = '🎉 Весь распорядок дня выполнен!';
            await db.run(
                `INSERT INTO achievements (user_id, category, title, description, icon) 
                 VALUES (?, 'schedule', 'Идеальный день', 'Выполнен весь распорядок дня', 'fas fa-calendar-check')`,
                [req.user.id]
            );
        }
        
        res.json({
            success: true,
            message: `Активность "${activity.activity}" выполнена! +${coinsAwarded} монет`,
            data: {
                coins_awarded: coinsAwarded,
                progress: progress,
                completed_activities: completedActivities,
                total_activities: totalActivities,
                achievement: achievementMessage
            }
        });
        
    } catch (error) {
        console.error('Ошибка отметки активности:', error.message);
        res.status(500).json({
            success: false,
            error: 'Ошибка отметки активности'
        });
    }
});

// ==================== ДОСТИЖЕНИЯ ====================

// Получение всех достижений пользователя
app.get('/api/achievements', authMiddleware, async (req, res) => {
    try {
        const achievements = await db.all(
            `SELECT * FROM achievements 
             WHERE user_id = ? 
             ORDER BY earned_at DESC`,
            [req.user.id]
        );
        
        // Группировка по категориям
        const groupedAchievements = achievements.reduce((acc, achievement) => {
            if (!acc[achievement.category]) {
                acc[achievement.category] = [];
            }
            acc[achievement.category].push(achievement);
            return acc;
        }, {});
        
        res.json({
            success: true,
            data: {
                achievements: groupedAchievements,
                total: achievements.length,
                categories: Object.keys(groupedAchievements)
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

// ==================== SPA МАРШРУТИЗАЦИЯ ====================
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ 
            success: false, 
            error: 'API endpoint not found' 
        });
    }
    
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🚀 ЗАПУСК QUANTUMFLOW v2.0 - ПЯТЬ ОСНОВНЫХ ЦЕЛЕЙ');
        console.log('='.repeat(80));
        
        await initDatabase();
        console.log('✅ База данных готова');
        console.log('✅ Все API настроены');
        
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
            
            console.log('\n🎯 ПЯТЬ ОСНОВНЫХ ЦЕЛЕЙ:');
            console.log('='.repeat(60));
            console.log('1. 💰 Финансовая грамотность и накопления');
            console.log('2. 🏋️‍♂️ Спорт, фитнес и похудение');
            console.log('3. 🚭 Отказ от вредных привычек');
            console.log('4. ⚡ Личная эффективность и продуктивность');
            console.log('5. 📅 Распорядок дня и тайм-менеджмент');
            console.log('='.repeat(60));
            
            console.log('\n🌟 ОСНОВНЫЕ ФУНКЦИОНАЛЬНОСТИ:');
            console.log('='.repeat(60));
            console.log('✅ Полная система регистрации с выбором целей и сроков');
            console.log('✅ Страница настроек профиля со статистикой');
            console.log('✅ Финансовый учет с копилками и визуализацией');
            console.log('✅ Персонализированные программы тренировок');
            console.log('✅ Практики для отказа от курения и алкоголя');
            console.log('✅ Методы личной эффективности (Pomodoro, Эйзенхауэр)');
            console.log('✅ Генератор распорядка дня с трекингом');
            console.log('✅ Система достижений и мотивации');
            console.log('✅ Советы на основе данных пользователя');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error.message);
        
        try {
            db = await open({
                filename: ':memory:',
                driver: sqlite3.Database
            });
            
            console.log('✅ Используем базу данных в памяти');
            await createTables();
            await createDemoData();
            
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

// Вспомогательная функция для расчета улучшений здоровья
const calculateHealthImprovements = (stats) => {
    const improvements = [];
    
    if (stats.days_smoke_free > 0) {
        if (stats.days_smoke_free >= 1) improvements.push('Улучшилось кровообращение');
        if (stats.days_smoke_free >= 2) improvements.push('Нормализовалось давление');
        if (stats.days_smoke_free >= 3) improvements.push('Восстановилось обоняние и вкус');
        if (stats.days_smoke_free >= 14) improvements.push('Улучшилась функция легких на 30%');
        if (stats.days_smoke_free >= 30) improvements.push('Снизился риск сердечных заболеваний');
    }
    
    if (stats.days_alcohol_free > 0) {
        if (stats.days_alcohol_free >= 1) improvements.push('Улучшилось качество сна');
        if (stats.days_alcohol_free >= 7) improvements.push('Нормализовался уровень сахара в крови');
        if (stats.days_alcohol_free >= 30) improvements.push('Улучшилась функция печени');
    }
    
    return improvements;
};
// Запуск
startServer();
