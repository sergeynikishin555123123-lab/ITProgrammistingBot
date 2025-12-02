require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const FarmEngine = require('./farm-engine');

// Импорт наших модулей
const MemoryStorage = require('./storage');
const Lessons = require('./lessons');
const CodeFarmTelegramBot = require('./telegram-bot');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Правильный путь к статическим файлам
app.use(express.static(path.join(__dirname, '../client')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Инициализация
const storage = new MemoryStorage();
const lessons = new Lessons();
const telegramBot = new CodeFarmTelegramBot(storage, lessons);
const farmEngine = new FarmEngine(storage);

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        users: Object.keys(storage.users).length,
        lessons: lessons.getLessonCount(),
        uptime: process.uptime()
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Получить пользователя
app.post('/api/user', (req, res) => {
    try {
        const { telegramId, username, firstName, lastName } = req.body;
        
        if (!telegramId) {
            return res.status(400).json({ error: 'Telegram ID required' });
        }
        
        const user = storage.getOrCreateUser(telegramId.toString(), {
            username,
            firstName,
            lastName
        });
        
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить данные пользователя
app.get('/api/user/:id', (req, res) => {
    try {
        const user = storage.getUser(req.params.id);
        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить прогресс пользователя
app.get('/api/user/:id/progress', (req, res) => {
    try {
        const progress = storage.getUserProgress(req.params.id);
        res.json(progress);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить состояние фермы
app.get('/api/farm/:userId', (req, res) => {
    try {
        const farm = storage.getFarm(req.params.userId);
        res.json(farm);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить уроки
app.get('/api/lessons', (req, res) => {
    const allLessons = lessons.getAllLessons();
    res.json(allLessons);
});

// Получить конкретный урок
app.get('/api/lessons/:id', (req, res) => {
    const lesson = lessons.getLesson(req.params.id);
    if (lesson) {
        // Добавляем прогресс пользователя если есть userId
        const userId = req.query.userId;
        if (userId) {
            const progress = storage.getLessonProgress(userId, req.params.id);
            lesson.progress = progress;
        }
        
        res.json(lesson);
    } else {
        res.status(404).json({ error: 'Lesson not found' });
    }
});

// Новый endpoint для получения визуальной фермы
app.get('/api/farm/:userId/visual', (req, res) => {
    try {
        const farm = storage.getFarm(req.params.userId);
        if (!farm) {
            return res.status(404).json({ error: 'Farm not found' });
        }
        
        const visualFarm = farmEngine.getVisualFarm(farm);
        res.json(visualFarm);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Обновляем обработку отправки урока
app.post('/api/lessons/:id/submit', async (req, res) => {
    try {
        const { userId, code } = req.body;
        const lessonId = req.params.id;
        
        if (!userId || !code) {
            return res.status(400).json({ error: 'Missing userId or code' });
        }
        
        const lesson = lessons.getLesson(lessonId);
        if (!lesson) {
            return res.status(404).json({ error: 'Lesson not found' });
        }
        
        // Проверяем код
        let score = 0;
        let errors = [];
        
        if (lesson.checks) {
            lesson.checks.forEach((check) => {
                if (code.includes(check.keyword)) {
                    score += check.points || 10;
                } else {
                    errors.push(check.error || `Missing: ${check.keyword}`);
                }
            });
        }
        
        if (errors.length === 0) {
            // Урок пройден успешно
            const result = storage.completeLesson(userId, lessonId, score, code);
            
            // Выполняем действие на ферме в зависимости от урока
            let farmActionResult = null;
            
            switch(lessonId) {
                case 'lesson_1':
                    // Очистить участок
                    farmActionResult = farmEngine.clearLand(userId, lessonId, {});
                    break;
                    
                case 'lesson_2':
                    // Построить дом
                    farmActionResult = farmEngine.buildHouse(userId, lessonId, {
                        materials: 'wood',
                        color: 'brown'
                    });
                    break;
                    
                case 'lesson_3':
                    // Подготовить поле
                    farmActionResult = farmEngine.prepareField(userId, lessonId, {
                        size: 4
                    });
                    break;
                    
                case 'lesson_4':
                case 'lesson_5':
                case 'lesson_6':
                    // Посадить культуры (разные для разных уроков)
                    const cropsMap = {
                        'lesson_4': ['wheat'],
                        'lesson_5': ['wheat', 'carrot'],
                        'lesson_6': ['wheat', 'carrot', 'potato']
                    };
                    farmActionResult = farmEngine.plantCrops(userId, lessonId, {
                        crops: cropsMap[lessonId] || ['wheat'],
                        size: 3
                    });
                    break;
                    
                case 'lesson_7':
                    // Полить растения
                    farmActionResult = farmEngine.waterCrops(userId, lessonId, {});
                    break;
                    
                case 'lesson_9':
                    // Собрать урожай
                    farmActionResult = farmEngine.harvestCrops(userId, lessonId, {});
                    break;
                    
                case 'lesson_14':
                    // Построить теплицу
                    farmActionResult = farmEngine.buildGreenhouse(userId, lessonId, {});
                    break;
                    
                default:
                    // Для остальных уроков просто добавляем ресурсы
                    if (lesson.farmUpdate) {
                        const farm = storage.getFarm(userId);
                        if (farm && farm.resources) {
                            Object.entries(lesson.farmUpdate.resources || {}).forEach(([key, value]) => {
                                farm.resources[key] = (farm.resources[key] || 0) + value;
                            });
                            storage.updateFarm(userId, farm);
                        }
                    }
            }
            
            // Отправляем уведомление в Telegram
            try {
                telegramBot.sendNotification(userId, 
                    `🎉 Урок "${lesson.title}" пройден!\n` +
                    `⭐ Оценка: ${score}/100\n` +
                    `💰 Награда: ${result.reward} монет\n` +
                    (farmActionResult ? `\n🏗️ ${farmActionResult.message}` : '')
                );
            } catch (botError) {
                console.log('Не удалось отправить уведомление:', botError.message);
            }
            
            res.json({
                success: true,
                message: '🎉 Урок успешно пройден!',
                score: score,
                reward: result.reward,
                levelUp: result.levelUp,
                newLevel: result.newLevel,
                farmAction: farmActionResult,
                farmUpdate: farmActionResult?.farmUpdate || lesson.farmUpdate
            });
            
        } else {
            // Урок не пройден
            const progress = storage.getLessonProgress(userId, lessonId);
            const attempts = (progress.attempts || 0) + 1;
            
            storage.setLessonProgress(userId, lessonId, {
                ...progress,
                status: 'in-progress',
                attempts: attempts,
                lastAttempt: new Date().toISOString()
            });
            
            res.json({
                success: false,
                message: '❌ Есть ошибки в коде',
                errors: errors,
                attempts: attempts
            });
        }
        
    } catch (error) {
        console.error('Ошибка отправки решения:', error);
        res.status(500).json({ error: error.message });
    }
});
// Webhook для Telegram
app.post('/webhook', (req, res) => {
    telegramBot.handleUpdate(req.body);
    res.sendStatus(200);
});

// Настройка вебхука
app.get('/set-webhook', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Используется polling или вебхук настроен автоматически',
        bot_token: process.env.TELEGRAM_BOT_TOKEN ? 'Настроен' : 'Не настроен'
    });
});

// Статические файлы фронтенда
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Веб-приложение: http://localhost:${PORT}`);
    console.log(`🤖 Telegram бот токен: ${process.env.TELEGRAM_BOT_TOKEN ? 'Настроен' : 'Не настроен'}`);
    console.log(`💾 Данные хранятся в папке: ${path.join(__dirname, '../data')}`);
    console.log(`👥 Пользователей в системе: ${Object.keys(storage.users).length}`);
    console.log(`📚 Уроков доступно: ${lessons.getLessonCount()}`);
});
