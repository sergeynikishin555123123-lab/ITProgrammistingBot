class FarmEngine {
    constructor(storage) {
        this.storage = storage;
        this.initialFarmState = this.createInitialOvergrownFarm();
    }
    
    // Создаем изначальную заросшую ферму
    createInitialOvergrownFarm() {
        const width = 8;
        const height = 8;
        const land = [];
        
        for (let y = 0; y < height; y++) {
            const row = [];
            for (let x = 0; x < width; x++) {
                row.push({
                    type: 'overgrown_grass',
                    fertility: 60 + Math.random() * 30,
                    hasCrop: false,
                    cropId: null,
                    hasBuilding: false,
                    buildingId: null,
                    decoration: null,
                    isCleared: false,
                    overgrownLevel: 0.7 + Math.random() * 0.3 // Уровень заросшести
                });
            }
            land.push(row);
        }
        
        return {
            land: land,
            buildings: [],
            crops: [],
            animals: [],
            decorations: [],
            resources: {
                water: 0,
                seeds: 0,
                wood: 0,
                stone: 0,
                coins: 0
            },
            stats: {
                clearedLand: 0,
                builtBuildings: 0,
                plantedCrops: 0,
                completedLessons: 0
            }
        };
    }
    
    // Очистить участок (урок 1)
    clearLand(userId, lessonId, data) {
        const farm = this.storage.getFarm(userId) || this.initialFarmState;
        let clearedCount = 0;
        
        // Очищаем случайные участки в центре
        const centerX = Math.floor(farm.land[0].length / 2);
        const centerY = Math.floor(farm.land.length / 2);
        
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const x = centerX + dx;
                const y = centerY + dy;
                
                if (y >= 0 && y < farm.land.length && 
                    x >= 0 && x < farm.land[0].length) {
                    
                    if (farm.land[y][x].type === 'overgrown_grass') {
                        farm.land[y][x] = {
                            type: 'cleared_land',
                            fertility: 80,
                            hasCrop: false,
                            cropId: null,
                            hasBuilding: false,
                            buildingId: null,
                            decoration: null,
                            isCleared: true,
                            overgrownLevel: 0
                        };
                        clearedCount++;
                    }
                }
            }
        }
        
        farm.stats.clearedLand += clearedCount;
        farm.resources.coins += 50; // Награда за очистку
        
        this.storage.updateFarm(userId, farm);
        
        return {
            success: true,
            clearedCount: clearedCount,
            message: `🧹 Очищено ${clearedCount} участков!`,
            farmUpdate: farm
        };
    }
    
    // Построить дом (урок 2)
    buildHouse(userId, lessonId, houseData = {}) {
        const farm = this.storage.getFarm(userId);
        if (!farm) return { success: false, message: 'Ферма не найдена' };
        
        // Ищем очищенный участок для постройки
        let buildSpot = null;
        for (let y = 0; y < farm.land.length && !buildSpot; y++) {
            for (let x = 0; x < farm.land[y].length && !buildSpot; x++) {
                if (farm.land[y][x].isCleared && !farm.land[y][x].hasBuilding) {
                    buildSpot = { x, y };
                    break;
                }
            }
        }
        
        if (!buildSpot) {
            return { success: false, message: 'Нет места для постройки!' };
        }
        
        const houseId = `house_${Date.now()}`;
        const house = {
            id: houseId,
            type: 'house',
            level: 1,
            materials: houseData.materials || 'wood',
            color: houseData.color || 'brown',
            position: buildSpot,
            health: 100,
            builtAt: new Date().toISOString()
        };
        
        farm.buildings.push(house);
        farm.land[buildSpot.y][buildSpot.x].hasBuilding = true;
        farm.land[buildSpot.y][buildSpot.x].buildingId = houseId;
        farm.stats.builtBuildings++;
        
        // Освобождаем землю вокруг дома
        this.clearAreaAround(farm, buildSpot.x, buildSpot.y, 2);
        
        this.storage.updateFarm(userId, farm);
        
        return {
            success: true,
            house: house,
            message: '🏠 Дом построен! Теперь у вас есть база на ферме!',
            farmUpdate: farm
        };
    }
    
    // Подготовить поле (урок 3)
    prepareField(userId, lessonId, fieldData = {}) {
        const farm = this.storage.getFarm(userId);
        if (!farm) return { success: false, message: 'Ферма не найдена' };
        
        const fieldSize = fieldData.size || 4;
        let prepared = 0;
        const fieldCells = [];
        
        // Ищем место для поля (рядом с домом)
        const house = farm.buildings.find(b => b.type === 'house');
        if (!house) {
            return { success: false, message: 'Сначала постройте дом!' };
        }
        
        const startX = Math.max(0, house.position.x - 2);
        const startY = Math.max(0, house.position.y + 1);
        
        // Подготавливаем землю под поле
        for (let i = 0; i < fieldSize; i++) {
            for (let j = 0; j < fieldSize; j++) {
                const x = startX + j;
                const y = startY + i;
                
                if (y < farm.land.length && x < farm.land[0].length) {
                    if (!farm.land[y][x].hasBuilding && farm.land[y][x].isCleared) {
                        farm.land[y][x].type = 'plowed_field';
                        farm.land[y][x].fertility = 90;
                        fieldCells.push({ x, y });
                        prepared++;
                    }
                }
            }
        }
        
        farm.resources.seeds += 20; // Даем семена для посадки
        
        this.storage.updateFarm(userId, farm);
        
        return {
            success: true,
            preparedCount: prepared,
            fieldCells: fieldCells,
            message: `🌾 Подготовлено поле ${fieldSize}x${fieldSize}! Готово к посадке.`,
            farmUpdate: farm
        };
    }
    
    // Посадить культуры (урок 4-6)
    plantCrops(userId, lessonId, cropData = {}) {
        const farm = this.storage.getFarm(userId);
        if (!farm) return { success: false, message: 'Ферма не найдена' };
        
        const crops = cropData.crops || ['wheat', 'carrot'];
        const fieldSize = cropData.size || 3;
        let planted = 0;
        const plantedCrops = [];
        
        // Ищем подготовленные поля
        for (let y = 0; y < farm.land.length && planted < crops.length * fieldSize; y++) {
            for (let x = 0; x < farm.land[y].length && planted < crops.length * fieldSize; x++) {
                if (farm.land[y][x].type === 'plowed_field' && 
                    !farm.land[y][x].hasCrop) {
                    
                    const cropType = crops[planted % crops.length];
                    const cropId = `${cropType}_${Date.now()}_${planted}`;
                    
                    farm.land[y][x].hasCrop = true;
                    farm.land[y][x].cropId = cropId;
                    
                    farm.crops.push({
                        id: cropId,
                        type: cropType,
                        position: { x, y },
                        growth: 10, // Начинаем с 10% роста
                        health: 100,
                        plantedAt: new Date().toISOString(),
                        lastWatered: new Date().toISOString()
                    });
                    
                    plantedCrops.push({ type: cropType, position: { x, y } });
                    planted++;
                }
            }
        }
        
        farm.stats.plantedCrops += planted;
        farm.resources.seeds = Math.max(0, farm.resources.seeds - planted);
        
        this.storage.updateFarm(userId, farm);
        
        return {
            success: true,
            plantedCount: planted,
            crops: plantedCrops,
            message: `🌱 Посажено ${planted} культур! Теперь нужно ухаживать за ними.`,
            farmUpdate: farm
        };
    }
    
    // Полить растения (урок 7)
    waterCrops(userId, lessonId, waterData = {}) {
        const farm = this.storage.getFarm(userId);
        if (!farm) return { success: false, message: 'Ферма не найдена' };
        
        let watered = 0;
        
        farm.crops.forEach(crop => {
            if (crop.health > 0 && crop.growth < 100) {
                crop.growth = Math.min(100, crop.growth + 15); // Ускоряем рост
                crop.health = Math.min(100, crop.health + 10); // Улучшаем здоровье
                crop.lastWatered = new Date().toISOString();
                watered++;
            }
        });
        
        farm.resources.water = Math.max(0, farm.resources.water - watered * 5);
        
        this.storage.updateFarm(userId, farm);
        
        return {
            success: true,
            wateredCount: watered,
            message: `💧 Полито ${watered} растений! Они растут быстрее.`,
            farmUpdate: farm
        };
    }
    
    // Собрать урожай (урок 9)
    harvestCrops(userId, lessonId, harvestData = {}) {
        const farm = this.storage.getFarm(userId);
        if (!farm) return { success: false, message: 'Ферма не найдена' };
        
        let harvested = 0;
        let totalYield = 0;
        const harvestedTypes = {};
        
        // Собираем созревшие растения
        for (let i = farm.crops.length - 1; i >= 0; i--) {
            const crop = farm.crops[i];
            if (crop.growth >= 80) { // Если выросло хотя бы на 80%
                
                // Удаляем из списка
                farm.crops.splice(i, 1);
                
                // Освобождаем землю
                if (crop.position.y < farm.land.length && 
                    crop.position.x < farm.land[crop.position.y].length) {
                    farm.land[crop.position.y][crop.position.x].hasCrop = false;
                    farm.land[crop.position.y][crop.position.x].cropId = null;
                    farm.land[crop.position.y][crop.position.x].type = 'resting_field';
                }
                
                // Считаем урожай
                const yieldAmount = Math.floor(crop.growth / 10); // 1-10 единиц
                totalYield += yieldAmount;
                
                if (!harvestedTypes[crop.type]) {
                    harvestedTypes[crop.type] = 0;
                }
                harvestedTypes[crop.type] += yieldAmount;
                
                // Добавляем ресурсы
                farm.resources[crop.type] = (farm.resources[crop.type] || 0) + yieldAmount;
                farm.resources.coins += yieldAmount * 5; // Продаем по 5 монет за единицу
                
                harvested++;
            }
        }
        
        this.storage.updateFarm(userId, farm);
        
        return {
            success: true,
            harvestedCount: harvested,
            totalYield: totalYield,
            harvestedTypes: harvestedTypes,
            coinsEarned: totalYield * 5,
            message: `📦 Собрано ${harvested} культур! Урожай: ${totalYield} единиц.`,
            farmUpdate: farm
        };
    }
    
    // Построить теплицу (урок 14)
    buildGreenhouse(userId, lessonId, greenhouseData = {}) {
        const farm = this.storage.getFarm(userId);
        if (!farm) return { success: false, message: 'Ферма не найдена' };
        
        // Ищем место рядом с домом
        const house = farm.buildings.find(b => b.type === 'house');
        if (!house) {
            return { success: false, message: 'Сначала постройте дом!' };
        }
        
        const greenhouseId = `greenhouse_${Date.now()}`;
        const position = {
            x: house.position.x + 3,
            y: house.position.y
        };
        
        // Проверяем, что место свободно
        if (position.y >= farm.land.length || position.x >= farm.land[0].length ||
            farm.land[position.y][position.x].hasBuilding) {
            return { success: false, message: 'Нет места для теплицы!' };
        }
        
        const greenhouse = {
            id: greenhouseId,
            type: 'greenhouse',
            level: 1,
            temperature: 25,
            humidity: 70,
            plants: [],
            position: position,
            health: 100,
            builtAt: new Date().toISOString()
        };
        
        farm.buildings.push(greenhouse);
        farm.land[position.y][position.x].hasBuilding = true;
        farm.land[position.y][position.x].buildingId = greenhouseId;
        farm.stats.builtBuildings++;
        
        // Освобождаем землю вокруг
        this.clearAreaAround(farm, position.x, position.y, 1);
        
        this.storage.updateFarm(userId, farm);
        
        return {
            success: true,
            greenhouse: greenhouse,
            message: '🌿 Умная теплица построена! Теперь можно выращивать растения круглый год.',
            farmUpdate: farm
        };
    }
    
    // Вспомогательные методы
    clearAreaAround(farm, centerX, centerY, radius) {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const x = centerX + dx;
                const y = centerY + dy;
                
                if (y >= 0 && y < farm.land.length && 
                    x >= 0 && x < farm.land[0].length &&
                    !farm.land[y][x].hasBuilding) {
                    
                    farm.land[y][x].type = 'cleared_land';
                    farm.land[y][x].isCleared = true;
                    farm.land[y][x].overgrownLevel = 0;
                }
            }
        }
    }
    
    // Получить визуальное представление фермы
    getVisualFarm(farm) {
        const visualFarm = {
            width: farm.land[0] ? farm.land[0].length : 8,
            height: farm.land.length || 8,
            cells: [],
            buildings: farm.buildings || [],
            crops: farm.crops || [],
            stats: farm.stats || {}
        };
        
        // Преобразуем данные фермы в визуальные клетки
        for (let y = 0; y < farm.land.length; y++) {
            for (let x = 0; x < farm.land[y].length; x++) {
                const cell = farm.land[y][x];
                const visualCell = {
                    x: x,
                    y: y,
                    type: this.getCellType(cell),
                    emoji: this.getCellEmoji(cell),
                    color: this.getCellColor(cell),
                    isCleared: cell.isCleared,
                    hasCrop: cell.hasCrop,
                    hasBuilding: cell.hasBuilding,
                    cropType: null,
                    buildingType: null
                };
                
                // Определяем тип культуры если есть
                if (cell.hasCrop && cell.cropId) {
                    const crop = farm.crops.find(c => c.id === cell.cropId);
                    if (crop) {
                        visualCell.cropType = crop.type;
                        visualCell.cropGrowth = crop.growth;
                    }
                }
                
                // Определяем тип постройки если есть
                if (cell.hasBuilding && cell.buildingId) {
                    const building = farm.buildings.find(b => b.id === cell.buildingId);
                    if (building) {
                        visualCell.buildingType = building.type;
                    }
                }
                
                visualFarm.cells.push(visualCell);
            }
        }
        
        return visualFarm;
    }
    
    getCellType(cell) {
        if (cell.hasBuilding) return 'building';
        if (cell.hasCrop) return 'crop';
        if (cell.type === 'overgrown_grass') return 'overgrown';
        if (cell.type === 'cleared_land') return 'cleared';
        if (cell.type === 'plowed_field') return 'plowed';
        if (cell.type === 'resting_field') return 'resting';
        return 'unknown';
    }
    
    getCellEmoji(cell) {
        if (cell.hasBuilding) {
            if (cell.buildingId?.includes('house')) return '🏠';
            if (cell.buildingId?.includes('greenhouse')) return '🌿';
            return '🏗️';
        }
        if (cell.hasCrop) {
            if (cell.cropId?.includes('wheat')) return '🌾';
            if (cell.cropId?.includes('carrot')) return '🥕';
            if (cell.cropId?.includes('potato')) return '🥔';
            return '🌱';
        }
        if (cell.type === 'overgrown_grass') return '🌿';
        if (cell.type === 'cleared_land') return '🟫';
        if (cell.type === 'plowed_field') return '🟨';
        if (cell.type === 'resting_field') return '🟧';
        return '❓';
    }
    
    getCellColor(cell) {
        if (cell.hasBuilding) return '#FF9800';
        if (cell.hasCrop) return '#4CAF50';
        if (cell.type === 'overgrown_grass') return '#2E7D32';
        if (cell.type === 'cleared_land') return '#8D6E63';
        if (cell.type === 'plowed_field') return '#FFEB3B';
        if (cell.type === 'resting_field') return '#FF5722';
        return '#9E9E9E';
    }
}

module.exports = FarmEngine;
