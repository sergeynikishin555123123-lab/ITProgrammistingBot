require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

// Импорт модулей
const MemoryStorage = require('./storage');
const TelegramBot = require('./telegram-bot');
const Lessons = require('./lessons');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Инициализация хранилища и уроков
const storage = new MemoryStorage();
const lessons = new Lessons();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../client')));

// Инициализация Telegram бота
let telegramBot;
if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramBot = new TelegramBot(storage, lessons);
}

// WebSocket для реального времени
io.on('connection', (socket) => {
    console.log('Клиент подключен:', socket.id);
    
    socket.on('join-farm', (userId) => {
        socket.join(`farm-${userId}`);
    });
    
    socket.on('code-executed', (data) => {
        io.to(`farm-${data.userId}`).emit('farm-update', data);
    });
    
    socket.on('farm-action', (data) => {
        const { userId, action, data: actionData } = data;
        
        switch (action) {
            case 'water-crop':
                handleWaterCrop(userId, actionData);
                break;
            case 'harvest-crop':
                handleHarvestCrop(userId, actionData);
                break;
            case 'build':
                handleBuild(userId, actionData);
                break;
        }
        
        // Отправляем обновление всем клиентам пользователя
        const farm = storage.getFarm(userId);
        io.to(`farm-${userId}`).emit('farm-update', {
            type: action,
            farmData: farm
        });
    });
    
    socket.on('disconnect', () => {
        console.log('Клиент отключен:', socket.id);
    });
});

// Функции обработки действий на ферме
function handleWaterCrop(userId, cropId) {
    const farm = storage.getFarm(userId);
    const crop = farm.crops.find(c => c.id === cropId);
    
    if (crop && farm.resources.water >= 10) {
        storage.updateFarmResources(userId, { water: -10 });
        const newGrowth = storage.updateCropGrowth(userId, cropId, 20);
        
        if (newGrowth >= 100) {
            // Растение созрело
            io.to(`farm-${userId}`).emit('notification', {
                type: 'crop-ready',
                message: `🌱 ${crop.type} созрел и готов к сбору!`
            });
        }
    }
}

function handleHarvestCrop(userId, cropId) {
    const result = storage.harvestCrop(userId, cropId);
    if (result) {
        io.to(`farm-${userId}`).emit('notification', {
            type: 'harvest',
            message: `💰 Собрано ${result.harvested} единиц ${result.cropType}!`
        });
    }
}

function handleBuild(userId, buildingData) {
    const cost = {
        wood: buildingData.type === 'house' ? 50 : 30,
        stone: buildingData.type === 'house' ? 20 : 10,
        coins: buildingData.type === 'house' ? 100 : 50
    };
    
    const farm = storage.getFarm(userId);
    const canBuild = Object.entries(cost).every(([resource, amount]) => 
        farm.resources[resource] >= amount
    );
    
    if (canBuild) {
        storage.addBuilding(userId, {
            ...buildingData,
            cost: cost
        });
        
        io.to(`farm-${userId}`).emit('notification', {
            type: 'building-complete',
            message: `🏗️ Построено новое здание: ${buildingData.type}!`
        });
    }
}

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        users: Object.keys(storage.users).length,
        uptime: process.uptime()
    });
});

// Получить пользователя
app.post('/api/user', (req, res) => {
    try {
        const { telegramId, username, firstName, lastName } = req.body;
        
        if (!telegramId) {
            return res.status(400).json({ error: 'Telegram ID required' });
        }
        
        const user = storage.getOrCreateUser(telegramId, {
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

// Обновить ресурсы фермы
app.post('/api/farm/:userId/resources', (req, res) => {
    try {
        const { resources } = req.body;
        const success = storage.updateFarmResources(req.params.userId, resources);
        
        if (success) {
            const farm = storage.getFarm(req.params.userId);
            res.json({ success: true, resources: farm.resources });
        } else {
            res.status(404).json({ error: 'Farm not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Выполнить действие на ферме
app.post('/api/farm/:userId/action', (req, res) => {
    try {
        const { action, data } = req.body;
        let result;
        
        switch (action) {
            case 'water':
                result = storage.updateCropGrowth(req.params.userId, data.cropId, 20);
                storage.updateFarmResources(req.params.userId, { water: -10 });
                break;
                
            case 'harvest':
                result = storage.harvestCrop(req.params.userId, data.cropId);
                break;
                
            case 'build':
                result = storage.addBuilding(req.params.userId, data);
                break;
                
            case 'plant':
                result = storage.addCrop(req.params.userId, data);
                break;
        }
        
        if (result) {
            const farm = storage.getFarm(req.params.userId);
            res.json({ success: true, result, farm });
        } else {
            res.status(400).json({ error: 'Action failed' });
        }
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

// Отправить решение урока
app.post('/api/lessons/:id/submit', (req, res) => {
    try {
        const { userId, code } = req.body;
        const lessonId = req.params.id;
        
        if (!userId || !code) {
            return res.status(400).json({ error: 'Missing userId or code' });
        }
        
        // Получаем урок
        const lesson = lessons.getLesson(lessonId);
        if (!lesson) {
            return res.status(404).json({ error: 'Lesson not found' });
        }
        
        // Простая проверка кода (в реальном проекте нужен sandbox)
        let score = 0;
        let errors = [];
        
        try {
            // Проверяем наличие ключевых слов
            const checks = lesson.checks || [];
            checks.forEach((check, index) => {
                if (code.includes(check.keyword)) {
                    score += check.points || 10;
                } else {
                    errors.push(check.error || `Missing: ${check.keyword}`);
                }
            });
            
            // Базовая проверка синтаксиса
            if (code.trim().length === 0) {
                errors.push('Код не может быть пустым');
            }
            
            // Проверяем выполнение задания
            if (lesson.requiredAction && !code.includes(lesson.requiredAction)) {
                errors.push(`Код должен выполнять действие: ${lesson.requiredAction}`);
            }
            
        } catch (error) {
            errors.push(`Ошибка проверки: ${error.message}`);
        }
        
        if (errors.length === 0) {
            // Урок пройден успешно
            const result = storage.completeLesson(userId, lessonId, score, code);
            
            // Обновляем ферму в соответствии с уроком
            if (lesson.farmUpdate) {
                storage.updateFarm(userId, lesson.farmUpdate);
                
                // Добавляем ресурсы за урок
                storage.updateFarmResources(userId, {
                    coins: result.reward,
                    experience: score * 10
                });
            }
            
            // Отправляем обновление через WebSocket
            const farm = storage.getFarm(userId);
            io.to(`farm-${userId}`).emit('farm-update', {
                type: 'lesson-completed',
                lessonId: lessonId,
                score: score,
                farmData: farm
            });
            
            res.json({
                success: true,
                message: '🎉 Урок успешно пройден!',
                score: score,
                reward: result.reward,
                levelUp: result.levelUp,
                newLevel: result.newLevel,
                farmUpdate: lesson.farmUpdate
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
        res.status(500).json({ error: error.message });
    }
});

// Получить достижения пользователя
app.get('/api/user/:id/achievements', (req, res) => {
    try {
        const achievements = storage.getUserAchievements(req.params.id);
        res.json(achievements);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Разблокировать достижение
app.post('/api/user/:id/achievements/unlock', (req, res) => {
    try {
        const { achievementId, achievementData } = req.body;
        const result = storage.unlockAchievement(req.params.id, achievementId, achievementData);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Получить статистику системы
app.get('/api/stats', (req, res) => {
    const stats = {
        totalUsers: Object.keys(storage.users).length,
        activeToday: Object.values(storage.users).filter(user => {
            const lastActive = new Date(user.lastActive);
            const today = new Date();
            return lastActive.toDateString() === today.toDateString();
        }).length,
        lessonsCompleted: Object.values(storage.progress).reduce((total, userProgress) => {
            return total + Object.values(userProgress).filter(p => p.status === 'completed').length;
        }, 0),
        totalCoins: Object.values(storage.users).reduce((sum, user) => sum + user.coins, 0)
    };
    
    res.json(stats);
});

// Создать бэкап
app.post('/api/backup', (req, res) => {
    try {
        storage.backupData();
        res.json({ success: true, message: 'Backup created' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Webhook для Telegram
if (telegramBot) {
    app.post('/webhook', (req, res) => {
        telegramBot.handleUpdate(req.body);
        res.sendStatus(200);
    });
    
    app.get('/set-webhook', async (req, res) => {
        try {
            await telegramBot.setWebhook();
            res.json({ success: true, message: 'Webhook установлен' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}

// Статические файлы фронтенда
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Веб-приложение: http://localhost:${PORT}`);
    
    if (telegramBot) {
        console.log(`🤖 Telegram бот: @${telegramBot.bot.username}`);
        console.log(`🔗 Webhook URL: ${process.env.WEBHOOK_URL || `http://localhost:${PORT}/webhook`}`);
    }
    
    console.log(`💾 Данные хранятся в папке: ${path.join(__dirname, '../data')}`);
    console.log(`👥 Пользователей в системе: ${Object.keys(storage.users).length}`);
});
