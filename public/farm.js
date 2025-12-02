/**
 * 🎮 2.5D ВИЗУАЛИЗАЦИЯ ФЕРМЫ
 */

class FarmVisualization {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.farmData = null;
        this.tileSize = 40;
        this.cameraX = 0;
        this.cameraY = 0;
        
        // Ассеты
        this.assets = {
            grass: '🟩',
            soil: '🟫', 
            house: '🏠',
            tractor: '🚜',
            chicken: '🐔',
            cow: '🐄',
            wheat: '🌾',
            tree: '🌳',
            fence: '🟧'
        };
        
        this.init();
    }
    
    init() {
        // Инициализация пустой фермы
        this.farmData = {
            level: 1,
            buildings: [],
            fields: [],
            animals: [],
            decorations: [],
            size: { width: 10, height: 10 }
        };
        
        // Создаем базовую карту
        this.generateBaseMap();
        
        // Запускаем рендеринг
        this.render();
        
        // Обработка событий
        this.canvas.addEventListener('click', (e) => this.handleClick(e));
        this.setupControls();
    }
    
    generateBaseMap() {
        this.farmData.map = [];
        
        for (let y = 0; y < this.farmData.size.height; y++) {
            const row = [];
            for (let x = 0; x < this.farmData.size.width; x++) {
                // Базовый ландшафт
                if (x < 2 && y < 2) {
                    row.push({ type: 'house', asset: '🏠' });
                } else if (x >= 3 && x < 7 && y >= 3 && y < 7) {
                    row.push({ type: 'field', asset: '🟫', crop: 'wheat', growth: 0.5 });
                } else if (Math.random() > 0.7) {
                    row.push({ type: 'tree', asset: '🌳' });
                } else {
                    row.push({ type: 'grass', asset: '🟩' });
                }
            }
            this.farmData.map.push(row);
        }
        
        // Добавляем животных
        this.farmData.animals = [
            { type: 'chicken', x: 2, y: 3, asset: '🐔' },
            { type: 'chicken', x: 3, y: 2, asset: '🐔' },
            { type: 'cow', x: 6, y: 6, asset: '🐄' }
        ];
        
        // Добавляем технику
        this.farmData.buildings.push({
            type: 'tractor',
            x: 4,
            y: 4,
            asset: '🚜',
            direction: 'right'
        });
    }
    
    render() {
        // Очистка
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Рисуем сетку
        this.drawGrid();
        
        // Рисуем тайлы
        for (let y = 0; y < this.farmData.size.height; y++) {
            for (let x = 0; x < this.farmData.size.width; x++) {
                const tile = this.farmData.map[y][x];
                this.drawTile(x, y, tile);
            }
        }
        
        // Рисуем животных
        this.farmData.animals.forEach(animal => {
            this.drawAnimal(animal.x, animal.y, animal);
        });
        
        // Рисуем технику
        this.farmData.buildings.forEach(building => {
            if (building.type === 'tractor') {
                this.drawTractor(building.x, building.y, building);
            }
        });
        
        // Анимация
        requestAnimationFrame(() => this.animate());
    }
    
    drawTile(x, y, tile) {
        const screenX = x * this.tileSize + this.cameraX;
        const screenY = y * this.tileSize + this.cameraY;
        
        // Рисуем фон
        this.ctx.fillStyle = this.getTileColor(tile.type);
        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
        
        // Рисуем границы
        this.ctx.strokeStyle = '#888';
        this.ctx.strokeRect(screenX, screenY, this.tileSize, this.tileSize);
        
        // Рисуем эмодзи или иконку
        if (tile.asset) {
            this.ctx.font = '20px Arial';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(tile.asset, screenX + this.tileSize/2, screenY + this.tileSize/2);
        }
        
        // Прогресс роста для культур
        if (tile.crop && tile.growth) {
            this.ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
            const growthHeight = this.tileSize * tile.growth;
            this.ctx.fillRect(screenX, screenY + this.tileSize - growthHeight, this.tileSize, growthHeight);
        }
    }
    
    drawAnimal(x, y, animal) {
        const screenX = x * this.tileSize + this.cameraX;
        const screenY = y * this.tileSize + this.cameraY;
        
        this.ctx.font = '20px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(animal.asset, screenX + this.tileSize/2, screenY + this.tileSize/2);
        
        // Анимация движения
        if (Math.random() > 0.95) {
            const dx = Math.random() * 2 - 1;
            const dy = Math.random() * 2 - 1;
            animal.x = Math.max(0, Math.min(this.farmData.size.width - 1, animal.x + dx));
            animal.y = Math.max(0, Math.min(this.farmData.size.height - 1, animal.y + dy));
        }
    }
    
    drawTractor(x, y, tractor) {
        const screenX = x * this.tileSize + this.cameraX;
        const screenY = y * this.tileSize + this.cameraY;
        
        this.ctx.font = '20px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(tractor.asset, screenX + this.tileSize/2, screenY + this.tileSize/2);
        
        // Анимация движения трактора
        if (tractor.direction === 'right') {
            tractor.x += 0.1;
            if (tractor.x > this.farmData.size.width - 1) {
                tractor.direction = 'left';
            }
        } else {
            tractor.x -= 0.1;
            if (tractor.x < 0) {
                tractor.direction = 'right';
            }
        }
    }
    
    getTileColor(type) {
        const colors = {
            grass: '#8BC34A',
            soil: '#795548',
            house: '#FF9800',
            field: '#8D6E63',
            tree: '#4CAF50'
        };
        return colors[type] || '#C8E6C9';
    }
    
    drawGrid() {
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        this.ctx.lineWidth = 1;
        
        // Вертикальные линии
        for (let x = 0; x <= this.farmData.size.width; x++) {
            const screenX = x * this.tileSize + this.cameraX;
            this.ctx.beginPath();
            this.ctx.moveTo(screenX, 0 + this.cameraY);
            this.ctx.lineTo(screenX, this.farmData.size.height * this.tileSize + this.cameraY);
            this.ctx.stroke();
        }
        
        // Горизонтальные линии
        for (let y = 0; y <= this.farmData.size.height; y++) {
            const screenY = y * this.tileSize + this.cameraY;
            this.ctx.beginPath();
            this.ctx.moveTo(0 + this.cameraX, screenY);
            this.ctx.lineTo(this.farmData.size.width * this.tileSize + this.cameraX, screenY);
            this.ctx.stroke();
        }
    }
    
    animate() {
        // Простая анимация
        this.render();
    }
    
    handleClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left - this.cameraX;
        const y = event.clientY - rect.top - this.cameraY;
        
        const tileX = Math.floor(x / this.tileSize);
        const tileY = Math.floor(y / this.tileSize);
        
        if (tileX >= 0 && tileX < this.farmData.size.width && 
            tileY >= 0 && tileY < this.farmData.size.height) {
            
            const tile = this.farmData.map[tileY][tileX];
            console.log(`Клик по тайлу: (${tileX}, ${tileY}) - ${tile.type}`);
            
            // Можно добавить взаимодействие
            if (tile.type === 'grass') {
                tile.type = 'soil';
                tile.asset = '🟫';
            }
        }
    }
    
    setupControls() {
        // Простое управление камерой
        let isDragging = false;
        let lastX = 0;
        let lastY = 0;
        
        this.canvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            lastX = e.clientX;
            lastY = e.clientY;
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const dx = e.clientX - lastX;
                const dy = e.clientY - lastY;
                this.cameraX += dx;
                this.cameraY += dy;
                lastX = e.clientX;
                lastY = e.clientY;
            }
        });
        
        this.canvas.addEventListener('mouseup', () => {
            isDragging = false;
        });
        
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoom = e.deltaY > 0 ? 0.9 : 1.1;
            this.tileSize = Math.max(20, Math.min(60, this.tileSize * zoom));
        });
    }
    
    // API для обновления фермы
    updateFarm(data) {
        this.farmData = { ...this.farmData, ...data };
    }
    
    addBuilding(type, x, y) {
        this.farmData.buildings.push({ type, x, y, asset: this.assets[type] || '🏠' });
    }
    
    addAnimal(type, x, y) {
        this.farmData.animals.push({ type, x, y, asset: this.assets[type] || '🐔' });
    }
    
    plantCrop(x, y, cropType) {
        if (this.farmData.map[y][x].type === 'soil') {
            this.farmData.map[y][x] = {
                type: 'field',
                asset: '🟫',
                crop: cropType,
                growth: 0.1
            };
        }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.farm = new FarmVisualization('farm-canvas');
});
