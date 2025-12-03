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

// В server.js улучшаем обработку /api/lessons/:id/submit
app.post('/api/lessons/:id/submit', async (req, res) => {
    try {
        const { userId, code } = req.body;
        const lessonId = req.params.id;
        
        console.log(`📥 Отправка решения: userId=${userId}, lessonId=${lessonId}`);
        
        if (!userId || !code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Необходимы userId и код' 
            });
        }
        
        // Получаем пользователя
        let user = storage.getUser(userId);
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Пользователь не найден' 
            });
        }
        
        // Получаем урок
        const lesson = lessons.getLesson(lessonId);
        if (!lesson) {
            return res.status(404).json({ 
                success: false, 
                message: 'Урок не найден' 
            });
        }
        
        // Проверяем, не пройден ли уже урок
        if (user.completedLessonIds?.includes(lessonId)) {
            return res.json({
                success: true,
                message: 'Урок уже был пройден ранее',
                alreadyCompleted: true,
                reward: 0,
                experience: 0
            });
        }
        
        // Простая проверка кода
        let passed = false;
        const cleanCode = code.toLowerCase().replace(/\s+/g, ' ');
        
        switch(lessonId) {
            case 'lesson_1':
                passed = cleanCode.includes('"привет, агробот!"') && 
                        cleanCode.includes('"начинаю работу!"');
                break;
            case 'lesson_2':
                passed = cleanCode.includes('farm_name=') && 
                        (cleanCode.includes('"солнечная долина"') || 
                         cleanCode.includes("'солнечная долина'")) &&
                        cleanCode.includes('print(farm_name)');
                break;
            case 'lesson_3':
                passed = cleanCode.includes('def start_tractor():') && 
                        cleanCode.includes('print') &&
                        cleanCode.includes('start_tractor()');
                break;
            case 'lesson_4':
                passed = cleanCode.includes('def build_house(') && 
                        cleanCode.includes('material') &&
                        cleanCode.includes('print');
                break;
            case 'lesson_5':
                passed = cleanCode.includes('for ') && 
                        cleanCode.includes('range(3)') &&
                        cleanCode.includes('print') &&
                        cleanCode.includes('сажаю растение');
                break;
            case 'lesson_6':
                passed = cleanCode.includes('if ') && 
                        cleanCode.includes('soil_moisture') &&
                        cleanCode.includes('< 50') &&
                        cleanCode.includes('print');
                break;
            default:
                // Для остальных уроков
                passed = code.length > 10 && code.includes('print');
        }
        
        if (passed) {
            // Обновляем прогресс пользователя
            user.lessonsCompleted = (user.lessonsCompleted || 0) + 1;
            user.coins = (user.coins || 0) + lesson.rewardCoins;
            user.experience = (user.experience || 0) + lesson.rewardExp;
            
            if (!user.completedLessonIds) {
                user.completedLessonIds = [];
            }
            user.completedLessonIds.push(lessonId);
            
            // Проверяем уровень
            const oldLevel = user.level || 1;
            const newLevel = Math.max(1, Math.floor((user.experience || 0) / 1000) + 1);
            user.level = newLevel;
            
            // Сохраняем пользователя
            storage.updateUser(userId, user);
            
            // Готовим ответ
            const response = {
                success: true,
                message: '🎉 Урок успешно пройден!',
                reward: lesson.rewardCoins,
                experience: lesson.rewardExp,
                levelUp: newLevel > oldLevel,
                newLevel: newLevel,
                coins: user.coins,
                experienceTotal: user.experience,
                farmUpdate: {
                    lessonId: lessonId,
                    action: 'update_farm',
                    changes: this.getFarmChangesForLesson(lessonId)
                }
            };
            
            console.log('✅ Урок пройден:', response);
            res.json(response);
            
        } else {
            // Ошибка
            res.json({
                success: false,
                message: 'Код не соответствует заданию',
                hint: this.getHintForLesson(lessonId)
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка проверки урока:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера при проверке урока' 
        });
    }
});

// Функция для получения подсказки по уроку
function getHintForLesson(lessonId) {
    const hints = {
        'lesson_1': 'Используйте две команды print: "Привет, АгроБот!" и "Начинаю работу!"',
        'lesson_2': 'Создайте переменную: farm_name = "Солнечная долина", затем выведите её',
        'lesson_3': 'Создайте функцию def start_tractor(): с print внутри, затем вызовите её',
        'lesson_4': 'Функция должна принимать аргумент: def build_house(material):',
        'lesson_5': 'Используйте: for i in range(3): и внутри print("Сажаю растение")',
        'lesson_6': 'Проверьте условие: if soil_moisture < 50: и выведите сообщение'
    };
    return hints[lessonId] || 'Проверьте синтаксис Python и точное соответствие заданию';
}

// Функция для получения изменений на ферме
function getFarmChangesForLesson(lessonId) {
    const changes = {
        'lesson_1': { clearedCells: 10, type: 'clear_grass' },
        'lesson_2': { plowedCells: 8, type: 'plow_land' },
        'lesson_3': { buildings: 1, type: 'build_house' },
        'lesson_4': { buildings: 1, type: 'build_barn' },
        'lesson_5': { crops: 6, type: 'plant_crops' },
        'lesson_6': { waterSources: 1, type: 'add_water' }
    };
    return changes[lessonId] || {};
}
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
