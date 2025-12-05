require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

// Импорт наших модулей
const MemoryStorage = require('./storage');
const Lessons = require('./lessons');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Статические файлы
app.use(express.static(path.join(__dirname, '../client')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Инициализация
const storage = new MemoryStorage();
const lessons = new Lessons();

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
    try {
        const allLessons = lessons.getAllLessons();
        // Форматируем уроки для фронтенда
        const formattedLessons = allLessons.map(lesson => ({
            id: lesson.id,
            title: lesson.title,
            description: lesson.description,
            level: lesson.level || 1,
            rewardCoins: lesson.coins || 50,
            rewardExp: lesson.experience || 100,
            theory: lesson.theory || 'Теория будет добавлена позже',
            task: lesson.task || 'Задание будет добавлено',
            testCode: lesson.exampleCode || '# Пример кода',
            initialCode: lesson.initialCode || '# Начни писать код здесь'
        }));
        res.json(formattedLessons);
    } catch (error) {
        console.error('❌ Ошибка загрузки уроков:', error);
        
        // Возвращаем демо уроки
        const demoLessons = [
            {
                id: 'lesson_1',
                title: 'Урок 1: Первые команды',
                description: 'Научитесь использовать print() для вывода текста',
                level: 1,
                rewardCoins: 100,
                rewardExp: 200,
                theory: 'Используйте print() для вывода текста',
                task: 'Напишите: print("Привет, фермер!")',
                testCode: 'print("Привет, фермер!")',
                initialCode: '# Урок 1\n# Напишите команду print'
            },
            {
                id: 'lesson_2',
                title: 'Урок 2: Переменные',
                description: 'Научитесь создавать переменные',
                level: 1,
                rewardCoins: 150,
                rewardExp: 300,
                theory: 'Переменные хранят данные',
                task: 'Создайте переменную name = "Фермер"',
                testCode: 'name = "Фермер"\nprint(name)',
                initialCode: '# Урок 2\n# Создайте переменную'
            }
        ];
        res.json(demoLessons);
    }
});

// Получить конкретный урок
app.get('/api/lessons/:id', (req, res) => {
    const lesson = lessons.getLesson(req.params.id);
    if (lesson) {
        res.json(lesson);
    } else {
        res.status(404).json({ error: 'Lesson not found' });
    }
});

// Проверка решения
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
        
        // Простая проверка кода
        let passed = false;
        const cleanCode = code.toLowerCase();
        
        switch(lessonId) {
            case 'lesson_1':
                passed = cleanCode.includes('print(') && 
                        cleanCode.includes('clear_area');
                break;
            case 'lesson_2':
                passed = cleanCode.includes('build_house') && 
                        (cleanCode.includes('x=') || cleanCode.includes('x ='));
                break;
            default:
                passed = code.length > 10;
        }
        
        if (passed) {
            // Обновляем прогресс
            if (!user.completedLessonIds) {
                user.completedLessonIds = [];
            }
            
            if (!user.completedLessonIds.includes(lessonId)) {
                user.lessonsCompleted = (user.lessonsCompleted || 0) + 1;
                user.coins = (user.coins || 0) + (lesson.coins || 100);
                user.experience = (user.experience || 0) + (lesson.experience || 200);
                user.completedLessonIds.push(lessonId);
                
                // Проверяем уровень
                const newLevel = Math.max(1, Math.floor((user.experience || 0) / 1000) + 1);
                user.level = newLevel;
                
                storage.updateUser(userId, user);
            }
            
            // Готовим ответ
            const response = {
                success: true,
                message: '🎉 Урок успешно пройден!',
                reward: lesson.coins || 100,
                experience: lesson.experience || 200,
                coins: user.coins,
                experienceTotal: user.experience,
                level: user.level,
                farmUpdate: {
                    lessonId: lessonId,
                    changes: {}
                }
            };
            
            res.json(response);
            
        } else {
            // Ошибка
            res.json({
                success: false,
                message: 'Код не соответствует заданию',
                hint: 'Проверьте синтаксис Python и точное соответствие заданию'
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

// В конце класса Lessons добавьте:
getLessonCount() {
    return this.lessons.length;
}

// Экспорт для Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Lessons;
}

// Статические файлы фронтенда
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Веб-приложение: http://localhost:${PORT}`);
    console.log(`👥 Пользователей в системе: ${Object.keys(storage.users).length}`);
    console.log(`📚 Уроков доступно: ${lessons.getLessonCount()}`);
});
