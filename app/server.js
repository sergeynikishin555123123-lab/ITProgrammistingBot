require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

// ★★★★ ДОБАВЛЯЕМ ЭТИ ИМПОРТЫ ★★★★
const fs = require('fs');           // Для работы с файлами
const http = require('http');       // Для создания HTTP сервера

// Импорт наших модулей
const MemoryStorage = require('./storage');
const Lessons = require('./lessons');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ★★★★ ОБНОВЛЯЕМ ЭТУ СЕКЦИЮ ДЛЯ СТАТИЧЕСКИХ ФАЙЛОВ ★★★★
// Основные статические файлы клиента
app.use(express.static(path.join(__dirname, '../client')));

// Путь для ассетов (текстуры, модели, изображения)
app.use('/assets', express.static(path.join(__dirname, '../assets'), {
    setHeaders: (res, filePath) => {
        // Устанавливаем правильные заголовки для 3D моделей
        if (filePath.endsWith('.glb') || filePath.endsWith('.gltf')) {
            res.setHeader('Content-Type', 'model/gltf-binary');
        }
    }
}));

// Путь для JavaScript файлов приложения
app.use('/app', express.static(path.join(__dirname, '../app'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
    }
}));

// Путь для библиотек Three.js
app.use('/lib/three', express.static(path.join(__dirname, '../node_modules/three')));
app.use('/lib/tween', express.static(path.join(__dirname, '../node_modules/@tweenjs/tween.js')));

// Инициализация
const storage = new MemoryStorage();
const lessons = new Lessons();

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        users: Object.keys(storage.users).length,
        lessons: lessons.getAllLessons().length, // Исправляем здесь
        uptime: process.uptime()
    });
});

// ★★★★ ДОБАВЛЯЕМ НОВЫЕ МАРШРУТЫ ДЛЯ 3D ФЕРМЫ ★★★★

// Получить состояние 3D фермы пользователя
app.get('/api/farm/3d/:userId', (req, res) => {
    try {
        const userId = req.params.userId;
        console.log(`🌐 Запрос 3D фермы для пользователя: ${userId}`);
        
        const user = storage.getUser(userId);
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Пользователь не найден' 
            });
        }
        
        // Получаем данные фермы
        const farm = storage.getFarm(userId);
        
        // Форматируем данные для 3D фермы
        const farm3DData = {
            userId: userId,
            userName: user.firstName || 'Фермер',
            cells: farm?.cells || [],
            buildings: this.extractBuildings(farm), // Метод ниже
            crops: this.extractCrops(farm),         // Метод ниже
            waterSources: this.extractWaterSources(farm), // Метод ниже
            stats: farm?.stats || {
                clearedLand: 0,
                buildings: 0,
                crops: 0,
                water: 0
            },
            completedLessons: user.completedLessonIds || [],
            lastUpdated: new Date().toISOString(),
            version: '1.0.0'
        };
        
        res.json({
            success: true,
            data: farm3DData
        });
        
    } catch (error) {
        console.error('❌ Ошибка получения 3D фермы:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка сервера при получении данных фермы',
            error: error.message 
        });
    }
});

// ★★★★ ДОБАВЛЯЕМ ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ ФОРМАТИРОВАНИЯ ★★★★

// Метод для извлечения построек из данных фермы
function extractBuildings(farmData) {
    if (!farmData || !farmData.cells) return [];
    
    const buildings = [];
    
    farmData.cells.forEach((cell, index) => {
        if (cell.type === 'house' || cell.type === 'barn') {
            buildings.push({
                id: `building-${index}`,
                type: cell.type,
                position: {
                    x: cell.x || 0,
                    y: 0,
                    z: cell.y || 0 // Используем y как z для 3D
                },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 },
                level: cell.level || 1,
                health: cell.health || 100
            });
        }
    });
    
    return buildings;
}

// Метод для извлечения культур
function extractCrops(farmData) {
    if (!farmData || !farmData.cells) return [];
    
    const crops = [];
    
    farmData.cells.forEach((cell, index) => {
        if (cell.type === 'crop') {
            crops.push({
                id: `crop-${index}`,
                type: cell.cropType || 'wheat',
                position: {
                    x: cell.x || 0,
                    y: 0,
                    z: cell.y || 0
                },
                growth: cell.growth || 0,
                waterLevel: cell.waterLevel || 0,
                harvestable: (cell.growth || 0) >= 80
            });
        }
    });
    
    return crops;
}

// Метод для извлечения источников воды
function extractWaterSources(farmData) {
    if (!farmData || !farmData.cells) return [];
    
    const waterSources = [];
    
    farmData.cells.forEach((cell, index) => {
        if (cell.type === 'water') {
            waterSources.push({
                id: `water-${index}`,
                type: 'well',
                position: {
                    x: cell.x || 0,
                    y: 0,
                    z: cell.y || 0
                },
                capacity: cell.capacity || 1000,
                currentAmount: cell.currentAmount || 500
            });
        }
    });
    
    return waterSources;
}

// Обновить состояние 3D фермы
app.post('/api/farm/3d/:userId/update', (req, res) => {
    try {
        const userId = req.params.userId;
        const updates = req.body;
        
        console.log(`🔄 Обновление 3D фермы для пользователя: ${userId}`);
        
        // Получаем текущие данные фермы
        const farm = storage.getFarm(userId);
        if (!farm) {
            return res.status(404).json({ 
                success: false, 
                message: 'Ферма не найдена' 
            });
        }
        
        // Применяем обновления
        if (updates.buildings && Array.isArray(updates.buildings)) {
            updates.buildings.forEach(building => {
                // Обновляем или добавляем постройки
                const existingIndex = farm.cells.findIndex(
                    cell => cell.x === building.position.x && 
                           cell.y === building.position.z &&
                           cell.type === building.type
                );
                
                if (existingIndex >= 0) {
                    // Обновляем существующую
                    farm.cells[existingIndex] = {
                        ...farm.cells[existingIndex],
                        ...building
                    };
                } else {
                    // Добавляем новую
                    farm.cells.push({
                        x: building.position.x,
                        y: building.position.z,
                        type: building.type,
                        level: building.level || 1,
                        health: building.health || 100
                    });
                }
            });
        }
        
        // Сохраняем обновления
        storage.updateFarm(userId, farm);
        
        res.json({
            success: true,
            message: 'Ферма успешно обновлена',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Ошибка обновления фермы:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ошибка обновления фермы',
            error: error.message 
        });
    }
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
        
        // ★★★★ ОБНОВЛЯЕМ ОТВЕТ ДЛЯ СОВМЕСТИМОСТИ С 3D ★★★★
        if (farm) {
            // Добавляем дополнительные данные для 3D
            const enhancedFarm = {
                ...farm,
                version: '2.0', // Версия с поддержкой 3D
                has3DSupport: true,
                lastUpdated: new Date().toISOString(),
                metadata: {
                    totalCells: farm.cells?.length || 0,
                    clearedCells: farm.cells?.filter(c => c.type !== 'grass').length || 0,
                    buildingCells: farm.cells?.filter(c => c.type === 'house' || c.type === 'barn').length || 0,
                    cropCells: farm.cells?.filter(c => c.type === 'crop').length || 0,
                    waterCells: farm.cells?.filter(c => c.type === 'water').length || 0
                }
            };
            res.json(enhancedFarm);
        } else {
            // Создаем начальную ферму если не существует
            const initialFarm = this.createInitialFarmData(req.params.userId);
            storage.updateFarm(req.params.userId, initialFarm);
            res.json(initialFarm);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ★★★★ ДОБАВЛЯЕМ МЕТОД ДЛЯ СОЗДАНИЯ НАЧАЛЬНОЙ ФЕРМЫ ★★★★
function createInitialFarmData(userId) {
    const cells = [];
    const farmSize = 8; // 8x8 сетка
    
    for (let x = 0; x < farmSize; x++) {
        for (let y = 0; y < farmSize; y++) {
            cells.push({
                x: x,
                y: y,
                type: 'grass',
                emoji: '🌿',
                color: '#2E7D32',
                title: 'Заросший участок',
                canClear: true,
                // Дополнительные поля для 3D
                position3D: {
                    x: (x - farmSize/2) * 2, // Масштабируем для 3D
                    y: 0,
                    z: (y - farmSize/2) * 2
                },
                rotation3D: { x: 0, y: 0, z: 0 },
                scale3D: { x: 1, y: 1, z: 1 }
            });
        }
    }
    
    return {
        userId: userId,
        cells: cells,
        width: farmSize,
        height: farmSize,
        stats: {
            clearedLand: 0,
            buildings: 0,
            crops: 0,
            water: 0,
            totalCells: farmSize * farmSize
        },
        settings: {
            farmName: 'Моя первая ферма',
            theme: 'default',
            difficulty: 'beginner',
            createdAt: new Date().toISOString()
        }
    };
}

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

// ★★★★ МАРШРУТ ДЛЯ ПРОВЕРКИ ДОСТУПНОСТИ 3D РЕСУРСОВ ★★★★
app.get('/api/check-3d-assets', (req, res) => {
    try {
        const assetPaths = [
            path.join(__dirname, '../client/index.html'),
            path.join(__dirname, '../app/3d-farm-engine.js'),
            path.join(__dirname, '../assets/textures')
        ];
        
        const results = assetPaths.map(assetPath => {
            const exists = fs.existsSync(assetPath);
            return {
                path: assetPath.replace(__dirname, ''),
                exists: exists,
                type: exists ? fs.statSync(assetPath).isDirectory() ? 'directory' : 'file' : 'not found'
            };
        });
        
        res.json({
            success: true,
            assets: results,
            threeJS: typeof THREE !== 'undefined',
            tweenJS: typeof TWEEN !== 'undefined',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            assets: []
        });
    }
});

// Маршрут для загрузки базовых 3D моделей (если нужны)
app.get('/api/3d/models/:modelName', (req, res) => {
    const modelName = req.params.modelName;
    const modelPath = path.join(__dirname, '../assets/models', `${modelName}.json`);
    
    if (fs.existsSync(modelPath)) {
        res.sendFile(modelPath);
    } else {
        // Возвращаем простую модель по умолчанию
        const defaultModel = this.getDefaultModel(modelName);
        res.json(defaultModel);
    }
});

// ★★★★ МЕТОД ДЛЯ СОЗДАНИЯ ПРОСТЫХ МОДЕЛЕЙ ПО УМОЛЧАНИЮ ★★★★
function getDefaultModel(modelName) {
    const models = {
        house: {
            type: 'group',
            children: [
                {
                    type: 'box',
                    size: [3, 2, 3],
                    position: [0, 1, 0],
                    material: { color: '#FF9800' }
                },
                {
                    type: 'cone',
                    radius: 2,
                    height: 1.5,
                    position: [0, 2.75, 0],
                    material: { color: '#8B0000' }
                }
            ]
        },
        tractor: {
            type: 'group',
            children: [
                {
                    type: 'box',
                    size: [1.5, 1.2, 1.2],
                    position: [0, 0.6, 0],
                    material: { color: '#FF4500' }
                }
            ]
        },
        // ... другие простые модели
    };
    
    return models[modelName] || models.house;
}

// Статические файлы фронтенда - ОБНОВЛЯЕМ ДЛЯ SPA
app.get('*', (req, res) => {
    const filePath = path.join(__dirname, '../client/index.html');
    
    // Проверяем существование файла
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        // Если файл не найден, возвращаем простую страницу
        res.status(200).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>CodeFarm - Learn Python</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    h1 { color: #4CAF50; }
                    .logo { font-size: 60px; margin: 20px; }
                </style>
            </head>
            <body>
                <div class="logo">🚜</div>
                <h1>CodeFarm</h1>
                <p>Изучайте Python через создание своей фермы!</p>
                <p><strong>Статус:</strong> Сервер работает, клиент загружается...</p>
                <p>Если страница не загрузилась, проверьте консоль браузера.</p>
                <script>
                    setTimeout(() => location.reload(), 3000);
                </script>
            </body>
            </html>
        `);
    }
});

// ★★★★ ДОБАВЛЯЕМ ОБРАБОТКУ ОШИБОК ★★★★
app.use((err, req, res, next) => {
    console.error('❌ Ошибка сервера:', err.stack);
    
    res.status(err.status || 500).json({
        success: false,
        message: 'Внутренняя ошибка сервера',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Обратитесь к администратору',
        timestamp: new Date().toISOString()
    });
});

// ★★★★ СОЗДАЕМ HTTP СЕРВЕР ДЛЯ ЛУЧШЕЙ ПРОИЗВОДИТЕЛЬНОСТИ ★★★★
const server = http.createServer(app);

// Запуск сервера
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Веб-приложение: http://localhost:${PORT}`);
    console.log(`👥 Пользователей в системе: ${Object.keys(storage.users).length}`);
    console.log(`📚 Уроков доступно: ${lessons.getAllLessons().length}`);
    console.log(`🎮 3D Ферма: ${fs.existsSync(path.join(__dirname, '../app/3d-farm-engine.js')) ? 'Доступна' : 'Не доступна'}`);
    console.log(`📁 Клиентские файлы: ${fs.existsSync(path.join(__dirname, '../client')) ? 'Найдены' : 'Не найдены'}`);
});

// ★★★★ ДОБАВЛЯЕМ ОБРАБОТКУ ЗАВЕРШЕНИЯ РАБОТЫ ★★★★
process.on('SIGINT', () => {
    console.log('\n🔴 Остановка сервера...');
    server.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🔴 Получен сигнал завершения...');
    server.close(() => {
        console.log('✅ Сервер остановлен');
        process.exit(0);
    });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Веб-приложение: http://localhost:${PORT}`);
    console.log(`👥 Пользователей в системе: ${Object.keys(storage.users).length}`);
    console.log(`📚 Уроков доступно: ${lessons.getLessonCount()}`);
});
