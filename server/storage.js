const fs = require('fs');
const path = require('path');

class MemoryStorage {
    constructor() {
        this.dataDir = path.join(__dirname, '../data');
        this.ensureDataDir();
        
        // Инициализация данных в памяти
        this.users = this.loadData('users.json', {});
        this.progress = this.loadData('progress.json', {});
        this.farms = this.loadData('farms.json', {});
        this.achievements = this.loadData('achievements.json', {});
        
        // Автосохранение каждые 30 секунд
        setInterval(() => this.saveAll(), 30000);
    }
    
    ensureDataDir() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }
    
    loadData(filename, defaultValue) {
        const filePath = path.join(this.dataDir, filename);
        
        try {
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error(`Ошибка загрузки ${filename}:`, error);
        }
        
        // Создаем файл с дефолтными значениями
        this.saveData(filename, defaultValue);
        return defaultValue;
    }
    
    saveData(filename, data) {
        const filePath = path.join(this.dataDir, filename);
        
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            console.error(`Ошибка сохранения ${filename}:`, error);
        }
    }
    
    saveAll() {
        console.log('💾 Автосохранение данных...');
        this.saveData('users.json', this.users);
        this.saveData('progress.json', this.progress);
        this.saveData('farms.json', this.farms);
        this.saveData('achievements.json', this.achievements);
    }
    
    // === МЕТОДЫ ДЛЯ РАБОТЫ С ПОЛЬЗОВАТЕЛЯМИ ===
    
    getOrCreateUser(telegramId, userData) {
        const userId = telegramId.toString();
        
        if (!this.users[userId]) {
            this.users[userId] = {
                id: userId,
                telegramId: telegramId,
                username: userData.username || '',
                firstName: userData.firstName || '',
                lastName: userData.lastName || '',
                languageCode: userData.language_code || 'ru',
                level: 1,
                experience: 0,
                coins: 100,
                created: new Date().toISOString(),
                lastActive: new Date().toISOString(),
                settings: {
                    theme: 'light',
                    notifications: true,
                    sound: true
                }
            };
            
            // Создаем начальную ферму
            this.farms[userId] = this.createInitialFarm(userId);
            
            // Создаем начальный прогресс
            this.progress[userId] = {};
            
            console.log(`✅ Создан новый пользователь: ${userId}`);
            this.saveAll();
        } else {
            // Обновляем время последней активности
            this.users[userId].lastActive = new Date().toISOString();
        }
        
        return this.users[userId];
    }
    
    createInitialFarm(userId) {
        return {
            userId: userId,
            land: this.createEmptyLand(5, 5),
            buildings: [
                {
                    id: 'house_1',
                    type: 'house',
                    level: 1,
                    position: { x: 2, z: 2 },
                    health: 100,
                    builtAt: new Date().toISOString()
                }
            ],
            crops: [],
            animals: [],
            decorations: [],
            resources: {
                water: 100,
                energy: 100,
                seeds: 50,
                wood: 100,
                stone: 50,
                coins: 100
            },
            lastUpdate: new Date().toISOString()
        };
    }
    
    createEmptyLand(width, height) {
        const land = [];
        for (let y = 0; y < height; y++) {
            const row = [];
            for (let x = 0; x < width; x++) {
                row.push({
                    type: 'grass',
                    fertility: 70,
                    hasCrop: false,
                    cropId: null
                });
            }
            land.push(row);
        }
        return land;
    }
    
    getUser(userId) {
        return this.users[userId] || null;
    }
    
    updateUser(userId, updates) {
        if (this.users[userId]) {
            Object.assign(this.users[userId], updates);
            this.users[userId].lastActive = new Date().toISOString();
            return true;
        }
        return false;
    }
    
    addUserCoins(userId, amount) {
        if (this.users[userId]) {
            this.users[userId].coins += amount;
            return this.users[userId].coins;
        }
        return null;
    }
    
    addUserExperience(userId, amount) {
        if (this.users[userId]) {
            this.users[userId].experience += amount;
            
            // Проверяем повышение уровня (1000 опыта за уровень)
            const newLevel = Math.floor(this.users[userId].experience / 1000) + 1;
            if (newLevel > this.users[userId].level) {
                this.users[userId].level = newLevel;
                this.users[userId].coins += newLevel * 100; // Награда за уровень
                return { levelUp: true, newLevel, reward: newLevel * 100 };
            }
            
            return { levelUp: false };
        }
        return null;
    }
    
    // === МЕТОДЫ ДЛЯ ФЕРМЫ ===
    
    getFarm(userId) {
        return this.farms[userId] || this.createInitialFarm(userId);
    }
    
    updateFarm(userId, updates) {
        if (this.farms[userId]) {
            Object.assign(this.farms[userId], updates);
            this.farms[userId].lastUpdate = new Date().toISOString();
            return true;
        }
        return false;
    }
    
    addBuilding(userId, building) {
        if (this.farms[userId]) {
            const buildingId = `${building.type}_${Date.now()}`;
            const newBuilding = {
                id: buildingId,
                ...building,
                builtAt: new Date().toISOString()
            };
            
            this.farms[userId].buildings.push(newBuilding);
            
            // Вычитаем ресурсы
            this.updateFarmResources(userId, building.cost || {});
            
            return newBuilding;
        }
        return null;
    }
    
    addCrop(userId, crop) {
        if (this.farms[userId]) {
            const cropId = `${crop.type}_${Date.now()}`;
            const newCrop = {
                id: cropId,
                ...crop,
                plantedAt: new Date().toISOString(),
                growth: 0,
                health: 100
            };
            
            this.farms[userId].crops.push(newCrop);
            
            // Обновляем землю
            if (crop.position) {
                const { x, z } = crop.position;
                if (this.farms[userId].land[z] && this.farms[userId].land[z][x]) {
                    this.farms[userId].land[z][x].hasCrop = true;
                    this.farms[userId].land[z][x].cropId = cropId;
                }
            }
            
            // Вычитаем ресурсы
            this.updateFarmResources(userId, { seeds: -1, water: -10 });
            
            return newCrop;
        }
        return null;
    }
    
    updateCropGrowth(userId, cropId, growthAmount) {
        if (this.farms[userId]) {
            const crop = this.farms[userId].crops.find(c => c.id === cropId);
            if (crop) {
                crop.growth = Math.min(100, crop.growth + growthAmount);
                crop.lastWatered = new Date().toISOString();
                return crop.growth;
            }
        }
        return null;
    }
    
    harvestCrop(userId, cropId) {
        if (this.farms[userId]) {
            const cropIndex = this.farms[userId].crops.findIndex(c => c.id === cropId);
            if (cropIndex !== -1) {
                const crop = this.farms[userId].crops[cropIndex];
                
                // Убираем урожай
                const harvestAmount = Math.floor(crop.growth / 10); // 1-10 единиц урожая
                
                // Удаляем растение
                this.farms[userId].crops.splice(cropIndex, 1);
                
                // Освобождаем землю
                if (crop.position) {
                    const { x, z } = crop.position;
                    if (this.farms[userId].land[z] && this.farms[userId].land[z][x]) {
                        this.farms[userId].land[z][x].hasCrop = false;
                        this.farms[userId].land[z][x].cropId = null;
                    }
                }
                
                // Добавляем ресурсы
                this.updateFarmResources(userId, { 
                    [crop.type]: harvestAmount,
                    coins: harvestAmount * 5 // Продажа урожая
                });
                
                return { harvested: harvestAmount, cropType: crop.type };
            }
        }
        return null;
    }
    
    updateFarmResources(userId, resources) {
        if (this.farms[userId]) {
            for (const [resource, amount] of Object.entries(resources)) {
                if (this.farms[userId].resources[resource] !== undefined) {
                    this.farms[userId].resources[resource] += amount;
                    
                    // Ограничиваем минимальные значения
                    if (this.farms[userId].resources[resource] < 0) {
                        this.farms[userId].resources[resource] = 0;
                    }
                    
                    // Ограничиваем максимальные значения
                    const maxValues = {
                        water: 200,
                        energy: 200,
                        seeds: 100,
                        wood: 500,
                        stone: 500,
                        coins: 999999
                    };
                    
                    if (maxValues[resource]) {
                        this.farms[userId].resources[resource] = Math.min(
                            this.farms[userId].resources[resource],
                            maxValues[resource]
                        );
                    }
                }
            }
            return true;
        }
        return false;
    }
    
    // === МЕТОДЫ ДЛЯ УРОКОВ И ПРОГРЕССА ===
    
    getLessonProgress(userId, lessonId) {
        if (this.progress[userId]) {
            return this.progress[userId][lessonId] || {
                status: 'locked',
                attempts: 0,
                score: 0,
                completedAt: null,
                codeSolution: ''
            };
        }
        return null;
    }
    
    setLessonProgress(userId, lessonId, progressData) {
        if (!this.progress[userId]) {
            this.progress[userId] = {};
        }
        
        this.progress[userId][lessonId] = {
            ...progressData,
            lastUpdated: new Date().toISOString()
        };
        
        return true;
    }
    
    completeLesson(userId, lessonId, score, codeSolution = '') {
        const progress = {
            status: 'completed',
            attempts: (this.progress[userId]?.[lessonId]?.attempts || 0) + 1,
            score: score,
            completedAt: new Date().toISOString(),
            codeSolution: codeSolution
        };
        
        this.setLessonProgress(userId, lessonId, progress);
        
        // Награда за урок
        const reward = score * 10; // 10 монет за каждый балл
        this.addUserCoins(userId, reward);
        const expResult = this.addUserExperience(userId, score * 50);
        
        return {
            reward,
            coins: this.users[userId]?.coins || 0,
            ...expResult
        };
    }
    
    getUserProgress(userId) {
        if (this.progress[userId]) {
            const completedLessons = Object.values(this.progress[userId])
                .filter(p => p.status === 'completed').length;
            
            const totalScore = Object.values(this.progress[userId])
                .reduce((sum, p) => sum + (p.score || 0), 0);
            
            return {
                completedLessons,
                totalScore,
                progress: this.progress[userId]
            };
        }
        return { completedLessons: 0, totalScore: 0, progress: {} };
    }
    
    // === МЕТОДЫ ДЛЯ ДОСТИЖЕНИЙ ===
    
    unlockAchievement(userId, achievementId, achievementData) {
        if (!this.achievements[userId]) {
            this.achievements[userId] = {};
        }
        
        if (!this.achievements[userId][achievementId]) {
            this.achievements[userId][achievementId] = {
                ...achievementData,
                unlockedAt: new Date().toISOString()
            };
            
            // Награда за достижение
            const reward = achievementData.reward || 100;
            this.addUserCoins(userId, reward);
            
            return { unlocked: true, reward };
        }
        
        return { unlocked: false };
    }
    
    getUserAchievements(userId) {
        return this.achievements[userId] || {};
    }
    
    // === СИСТЕМНЫЕ МЕТОДЫ ===
    
    getAllUsers() {
        return Object.values(this.users);
    }
    
    getUserStats(userId) {
        const user = this.getUser(userId);
        const progress = this.getUserProgress(userId);
        const farm = this.getFarm(userId);
        const achievements = this.getUserAchievements(userId);
        
        return {
            user: user,
            progress: progress,
            farmStats: {
                buildings: farm.buildings.length,
                crops: farm.crops.length,
                animals: farm.animals.length,
                resources: farm.resources
            },
            achievements: Object.keys(achievements).length
        };
    }
    
    // Резервное копирование
    backupData() {
        const backupDir = path.join(this.dataDir, 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `backup-${timestamp}.json`);
        
        const backupData = {
            timestamp: new Date().toISOString(),
            users: this.users,
            progress: this.progress,
            farms: this.farms,
            achievements: this.achievements
        };
        
        fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf8');
        console.log(`💾 Создан бэкап: ${backupPath}`);
        
        // Удаляем старые бэкапы (оставляем последние 10)
        const backups = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('backup-'))
            .sort()
            .map(f => path.join(backupDir, f));
        
        if (backups.length > 10) {
            const toDelete = backups.slice(0, backups.length - 10);
            toDelete.forEach(file => {
                fs.unlinkSync(file);
                console.log(`🗑️ Удален старый бэкап: ${file}`);
            });
        }
    }
}

module.exports = MemoryStorage;
