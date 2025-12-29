// server.js - СЕРВЕР ДЛЯ IT FARM
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const app = express();

// Настройка CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ==================== БАЗА ДАННЫХ ====================
let db;

const initDatabase = async () => {
    try {
        console.log('🔄 Инициализация базы данных...');
        
        const dbPath = path.join(__dirname, 'itfarm.db');
        
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        console.log('✅ База данных подключена');
        
        // Создание таблиц
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE,
                username TEXT UNIQUE,
                password TEXT NOT NULL,
                full_name TEXT,
                avatar_url TEXT,
                level INTEGER DEFAULT 1,
                experience INTEGER DEFAULT 0,
                coins INTEGER DEFAULT 0,
                completed_lessons TEXT DEFAULT '[]',
                farm_state TEXT DEFAULT '{"grass": 100, "elements": []}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                content TEXT NOT NULL,
                task TEXT NOT NULL,
                solution TEXT NOT NULL,
                icon TEXT DEFAULT 'fas fa-code',
                difficulty TEXT DEFAULT 'easy',
                order_index INTEGER DEFAULT 0,
                requirements TEXT DEFAULT '[]',
                farm_effect TEXT DEFAULT '{}',
                xp_reward INTEGER DEFAULT 100,
                coins_reward INTEGER DEFAULT 50,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await db.exec(`
            CREATE TABLE IF NOT EXISTS progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                lesson_id INTEGER,
                completed BOOLEAN DEFAULT 0,
                code TEXT,
                attempts INTEGER DEFAULT 0,
                completed_at TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (lesson_id) REFERENCES lessons(id),
                UNIQUE(user_id, lesson_id)
            )
        `);

        console.log('✅ Таблицы созданы');
        
        // Создаем тестовые данные
        await createTestData();
        
        return db;
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error);
        throw error;
    }
};

const createTestData = async () => {
    try {
        // Проверяем есть ли уроки
        const lessonCount = await db.get('SELECT COUNT(*) as count FROM lessons');
        
        if (lessonCount.count === 0) {
            const lessons = [
                {
                    title: 'Основы JavaScript',
                    description: 'Напишите свой первый код и скосите траву на ферме',
                    content: `<h3>Добро пожаловать в мир программирования!</h3>
                             <p>JavaScript - это язык программирования, который оживляет веб-страницы.</p>
                             <p>Команда <code>console.log()</code> выводит информацию в консоль разработчика.</p>`,
                    task: 'Используйте console.log() чтобы вывести сообщение "Трава скошена!"',
                    solution: "console.log('Трава скошена!');",
                    icon: 'fas fa-code',
                    difficulty: 'easy',
                    order_index: 1,
                    requirements: '[]',
                    farm_effect: JSON.stringify({ type: 'clear_grass', amount: 50 }),
                    xp_reward: 100,
                    coins_reward: 50
                },
                {
                    title: 'Переменные и типы данных',
                    description: 'Создайте переменные для посадки семян',
                    content: `<h3>Переменные - контейнеры для данных</h3>
                             <p>В JavaScript переменные объявляются с помощью <code>let</code>, <code>const</code> или <code>var</code>.</p>
                             <p>Пример: <code>let plantName = "Пшеница";</code></p>`,
                    task: 'Создайте переменную seeds и присвойте ей значение 10',
                    solution: 'let seeds = 10;',
                    icon: 'fas fa-seedling',
                    difficulty: 'easy',
                    order_index: 2,
                    requirements: JSON.stringify([1]),
                    farm_effect: JSON.stringify({ type: 'plant_seeds', count: 10 }),
                    xp_reward: 150,
                    coins_reward: 75
                },
                {
                    title: 'Функции',
                    description: 'Создайте функции для автоматизации работы на ферме',
                    content: `<h3>Функции в JavaScript</h3>
                             <p>Функции - это блоки кода, которые выполняют определенную задачу.</p>
                             <p>Пример: <code>function waterPlants() { return "Растения политы!"; }</code></p>`,
                    task: 'Создайте функцию buildFence(), которая возвращает строку "Забор построен!"',
                    solution: 'function buildFence() {\n    return "Забор построен!";\n}',
                    icon: 'fas fa-hammer',
                    difficulty: 'medium',
                    order_index: 3,
                    requirements: JSON.stringify([1, 2]),
                    farm_effect: JSON.stringify({ type: 'build_fence' }),
                    xp_reward: 200,
                    coins_reward: 100
                }
            ];

            for (const lesson of lessons) {
                await db.run(
                    `INSERT INTO lessons (title, description, content, task, solution, icon, difficulty, 
                                          order_index, requirements, farm_effect, xp_reward, coins_reward) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        lesson.title, lesson.description, lesson.content, lesson.task, lesson.solution,
                        lesson.icon, lesson.difficulty, lesson.order_index, lesson.requirements,
                        lesson.farm_effect, lesson.xp_reward, lesson.coins_reward
                    ]
                );
            }
            console.log(`✅ Создано ${lessons.length} урока`);
        }

        // Тестовый пользователь
        const userCount = await db.get('SELECT COUNT(*) as count FROM users');
        
        if (userCount.count === 0) {
            const hashedPassword = await bcrypt.hash('123456', 10);
            
            await db.run(
                `INSERT INTO users (email, username, password, full_name, avatar_url, level, coins) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    'test@test.com',
                    'testuser',
                    hashedPassword,
                    'Тестовый Пользователь',
                    'https://ui-avatars.com/api/?name=Тест&background=7CB342&color=fff',
                    1,
                    100
                ]
            );
            console.log('✅ Тестовый пользователь создан');
        }
        
    } catch (error) {
        console.error('❌ Ошибка создания тестовых данных:', error);
    }
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
const generateToken = (user) => {
    return jwt.sign(
        { id: user.id, email: user.email, username: user.username },
        'itfarm-secret-key-2024',
        { expiresIn: '30d' }
    );
};

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
            const decoded = jwt.verify(token, 'itfarm-secret-key-2024');
            req.userId = decoded.id;
            next();
        } catch (jwtError) {
            return res.status(401).json({ 
                success: false, 
                error: 'Неверный токен' 
            });
        }
    } catch (error) {
        console.error('Ошибка аутентификации:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Ошибка сервера' 
        });
    }
};

// ==================== API МАРШРУТЫ ====================

// Главная страница
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '🚜 IT Farm API',
        version: '1.0.0',
        endpoints: {
            auth: ['POST /api/auth/register', 'POST /api/auth/login'],
            lessons: ['GET /api/lessons', 'GET /api/lessons/:id'],
            farm: ['GET /api/farm', 'POST /api/farm/update'],
            progress: ['GET /api/progress']
        }
    });
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await db.get('SELECT 1');
        res.json({
            success: true,
            status: 'OK',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Database error'
        });
    }
});

// Регистрация
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, username, password, full_name } = req.body;
        
        if (!email || !username || !password || !full_name) {
            return res.status(400).json({
                success: false,
                error: 'Все поля обязательны'
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Пароль должен быть не менее 6 символов'
            });
        }
        
        // Проверяем уникальность
        const existing = await db.get(
            'SELECT id FROM users WHERE email = ? OR username = ?',
            [email, username]
        );
        
        if (existing) {
            return res.status(400).json({
                success: false,
                error: 'Пользователь с таким email или именем уже существует'
            });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=7CB342&color=fff`;
        
        const result = await db.run(
            `INSERT INTO users (email, username, password, full_name, avatar_url) 
             VALUES (?, ?, ?, ?, ?)`,
            [email, username, hashedPassword, full_name, avatarUrl]
        );
        
        const user = await db.get(
            'SELECT id, email, username, full_name, avatar_url, level, experience, coins FROM users WHERE id = ?',
            [result.lastID]
        );
        
        const token = generateToken(user);
        
        res.status(201).json({
            success: true,
            message: 'Регистрация успешна!',
            data: { user, token }
        });
        
    } catch (error) {
        console.error('❌ Ошибка регистрации:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
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
                error: 'Email и пароль обязательны'
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
        
        const token = generateToken(user);
        
        res.json({
            success: true,
            message: 'Вход выполнен успешно!',
            data: { user: userResponse, token }
        });
        
    } catch (error) {
        console.error('❌ Ошибка входа:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// Получение уроков
app.get('/api/lessons', async (req, res) => {
    try {
        const lessons = await db.all(
            'SELECT * FROM lessons ORDER BY order_index ASC'
        );
        
        const lessonsWithData = lessons.map(lesson => ({
            ...lesson,
            requirements: JSON.parse(lesson.requirements || '[]'),
            farm_effect: JSON.parse(lesson.farm_effect || '{}')
        }));
        
        res.json({
            success: true,
            data: { lessons: lessonsWithData }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения уроков:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// Получение урока по ID
app.get('/api/lessons/:id', async (req, res) => {
    try {
        const lesson = await db.get(
            'SELECT * FROM lessons WHERE id = ?',
            [req.params.id]
        );
        
        if (!lesson) {
            return res.status(404).json({
                success: false,
                error: 'Урок не найден'
            });
        }
        
        const lessonWithData = {
            ...lesson,
            requirements: JSON.parse(lesson.requirements || '[]'),
            farm_effect: JSON.parse(lesson.farm_effect || '{}')
        };
        
        res.json({
            success: true,
            data: { lesson: lessonWithData }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения урока:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// Получение фермы
app.get('/api/farm', authMiddleware, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT farm_state, level, experience, coins FROM users WHERE id = ?',
            [req.userId]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const farmState = JSON.parse(user.farm_state || '{}');
        
        // Генерируем элементы фермы
        const elements = [];
        
        // Трава
        if (farmState.grass > 0) {
            const grassCount = Math.floor((farmState.grass / 100) * 20);
            for (let i = 0; i < grassCount; i++) {
                elements.push({
                    type: 'grass',
                    x: Math.random() * 90 + 5,
                    y: Math.random() * 80 + 10,
                    size: Math.random() * 15 + 10
                });
            }
        }
        
        // Существующие элементы
        if (farmState.elements && Array.isArray(farmState.elements)) {
            elements.push(...farmState.elements);
        }
        
        // Солнце и облака
        elements.push({
            type: 'sun',
            x: 85,
            y: 10
        });
        
        elements.push({
            type: 'cloud',
            x: 20,
            y: 15
        });
        
        elements.push({
            type: 'cloud',
            x: 60,
            y: 20
        });
        
        res.json({
            success: true,
            data: {
                farm: {
                    grass: farmState.grass || 100,
                    elements: elements
                },
                stats: {
                    level: user.level,
                    experience: user.experience,
                    coins: user.coins
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения фермы:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// Обновление фермы
app.post('/api/farm/update', authMiddleware, async (req, res) => {
    try {
        const { farm_state } = req.body;
        
        await db.run(
            'UPDATE users SET farm_state = ? WHERE id = ?',
            [JSON.stringify(farm_state), req.userId]
        );
        
        res.json({
            success: true,
            message: 'Ферма обновлена'
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления фермы:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// Проверка решения урока
app.post('/api/lessons/:id/check', authMiddleware, async (req, res) => {
    try {
        const { code } = req.body;
        const lessonId = req.params.id;
        
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
        
        // Простая проверка решения
        const userCode = code.trim();
        const solution = lesson.solution.trim();
        const isCorrect = userCode.includes(solution) || solution.includes(userCode);
        
        if (isCorrect) {
            // Получаем пользователя
            const user = await db.get('SELECT * FROM users WHERE id = ?', [req.userId]);
            
            // Добавляем урок в завершенные
            let completedLessons = JSON.parse(user.completed_lessons || '[]');
            if (!completedLessons.includes(parseInt(lessonId))) {
                completedLessons.push(parseInt(lessonId));
                
                // Начисляем награды
                const xpReward = lesson.xp_reward || 100;
                const coinsReward = lesson.coins_reward || 50;
                
                let newExperience = user.experience + xpReward;
                let newLevel = user.level;
                let newCoins = user.coins + coinsReward;
                
                // Проверяем повышение уровня
                const xpPerLevel = 100;
                while (newExperience >= newLevel * xpPerLevel) {
                    newExperience -= newLevel * xpPerLevel;
                    newLevel++;
                }
                
                // Применяем эффект к ферме
                let farmState = JSON.parse(user.farm_state || '{}');
                const farmEffect = JSON.parse(lesson.farm_effect || '{}');
                
                if (farmEffect.type === 'clear_grass') {
                    farmState.grass = Math.max(0, (farmState.grass || 100) - (farmEffect.amount || 50));
                }
                
                // Обновляем пользователя
                await db.run(
                    `UPDATE users SET 
                        level = ?,
                        experience = ?,
                        coins = ?,
                        completed_lessons = ?,
                        farm_state = ?
                     WHERE id = ?`,
                    [
                        newLevel,
                        newExperience,
                        newCoins,
                        JSON.stringify(completedLessons),
                        JSON.stringify(farmState),
                        req.userId
                    ]
                );
                
                // Сохраняем прогресс
                await db.run(
                    `INSERT OR REPLACE INTO progress (user_id, lesson_id, completed, code, attempts, completed_at)
                     VALUES (?, ?, ?, ?, COALESCE((SELECT attempts + 1 FROM progress WHERE user_id = ? AND lesson_id = ?), 1), CURRENT_TIMESTAMP)`,
                    [req.userId, lessonId, 1, code, req.userId, lessonId]
                );
                
                // Получаем обновленного пользователя
                const updatedUser = await db.get(
                    'SELECT * FROM users WHERE id = ?',
                    [req.userId]
                );
                
                const userResponse = {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    username: updatedUser.username,
                    full_name: updatedUser.full_name,
                    avatar_url: updatedUser.avatar_url,
                    level: updatedUser.level,
                    experience: updatedUser.experience,
                    coins: updatedUser.coins,
                    completed_lessons: JSON.parse(updatedUser.completed_lessons || '[]'),
                    farm_state: JSON.parse(updatedUser.farm_state || '{}')
                };
                
                res.json({
                    success: true,
                    message: '🎉 Урок выполнен успешно!',
                    data: {
                        is_correct: true,
                        user: userResponse,
                        rewards: {
                            xp: xpReward,
                            coins: coinsReward,
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
                    is_correct: false
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка проверки решения:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// Получение прогресса
app.get('/api/progress', authMiddleware, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT level, experience, coins, completed_lessons FROM users WHERE id = ?',
            [req.userId]
        );
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден'
            });
        }
        
        const totalLessons = await db.get('SELECT COUNT(*) as count FROM lessons');
        const completedLessons = JSON.parse(user.completed_lessons || '[]');
        const progressPercent = totalLessons.count > 0 
            ? Math.round((completedLessons.length / totalLessons.count) * 100)
            : 0;
        
        res.json({
            success: true,
            data: {
                level: user.level,
                experience: user.experience,
                coins: user.coins,
                completed_lessons: completedLessons.length,
                total_lessons: totalLessons.count,
                progress_percent: progressPercent
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения прогресса:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// Проверка пользователя
app.get('/api/auth/check', authMiddleware, async (req, res) => {
    try {
        const user = await db.get(
            'SELECT id, email, username, full_name, avatar_url, level, experience, coins, completed_lessons, farm_state FROM users WHERE id = ?',
            [req.userId]
        );
        
        if (!user) {
            return res.status(404).json({
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
        console.error('❌ Ошибка проверки пользователя:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка сервера'
        });
    }
});

// ==================== SPA РОУТИНГ ====================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ЗАПУСК СЕРВЕРА ====================
const startServer = async () => {
    try {
        await initDatabase();
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(60));
            console.log('🚜 IT FARM СЕРВЕР ЗАПУЩЕН');
            console.log('='.repeat(60));
            console.log(`🌐 Сервер: http://localhost:${PORT}`);
            console.log(`🏥 Health: http://localhost:${PORT}/health`);
            console.log('='.repeat(60));
            console.log('📚 API эндпоинты:');
            console.log('  POST /api/auth/register - Регистрация');
            console.log('  POST /api/auth/login    - Вход');
            console.log('  GET  /api/lessons       - Все уроки');
            console.log('  GET  /api/farm          - Ферма');
            console.log('  GET  /api/progress      - Прогресс');
            console.log('='.repeat(60));
            console.log('👤 Тестовый аккаунт: test@test.com / 123456');
            console.log('='.repeat(60));
            console.log('🚜 Приложение готово к работе!');
            console.log('='.repeat(60));
        });
        
    } catch (error) {
        console.error('❌ Не удалось запустить сервер:', error);
        process.exit(1);
    }
};

// Экспорт для скриптов
module.exports = {
    initDatabase,
    app
};

// Запуск сервера
if (require.main === module) {
    startServer();
}
