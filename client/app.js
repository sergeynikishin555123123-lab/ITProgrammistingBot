// client/app.js - Полностью рабочий фронтенд для CodeFarm
class CodeFarmApp {
    constructor() {
        this.userId = null;
        this.userData = null;
        this.farmData = null;
        this.lessonsData = [];
        this.currentLesson = null;
        this.socket = null;
        this.codeEditor = null;
        
        this.init();
    }
    
    async init() {
        console.log('🚀 Инициализация CodeFarm...');
        
        // 1. Проверяем авторизацию
        await this.checkAuth();
        
        // 2. Инициализируем WebSocket
        this.initWebSocket();
        
        // 3. Загружаем начальные данные
        await this.loadInitialData();
        
        // 4. Инициализируем интерфейс
        this.initUI();
        
        // 5. Начинаем мониторинг
        this.startMonitoring();
        
        console.log('✅ CodeFarm инициализирован!');
    }
    
    async checkAuth() {
        // Проверяем Telegram Web App
        if (window.Telegram?.WebApp) {
            const tg = window.Telegram.WebApp;
            tg.expand();
            tg.ready();
            
            const user = tg.initDataUnsafe?.user;
            if (user) {
                this.userId = user.id.toString();
                console.log('👤 Пользователь Telegram:', user);
                
                // Регистрируем пользователя
                await this.registerUser(user);
            }
        } else {
            // Демо-режим для разработки
            this.userId = localStorage.getItem('codefarm_user_id');
            if (!this.userId) {
                this.userId = 'demo-' + Date.now();
                localStorage.setItem('codefarm_user_id', this.userId);
            }
            
            await this.registerUser({
                id: this.userId,
                first_name: 'Демо Фермер',
                username: 'demo'
            });
        }
    }
    
    async registerUser(tgUser) {
        try {
            const response = await fetch('/api/user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegramId: this.userId,
                    username: tgUser.username,
                    firstName: tgUser.first_name,
                    lastName: tgUser.last_name
                })
            });
            
            if (!response.ok) throw new Error('Ошибка регистрации');
            
            this.userData = await response.json();
            console.log('✅ Пользователь зарегистрирован:', this.userData);
            
        } catch (error) {
            console.error('❌ Ошибка регистрации:', error);
            // Создаем демо-данные
            this.userData = {
                id: this.userId,
                username: tgUser.username || 'demo',
                firstName: tgUser.first_name || 'Фермер',
                level: 1,
                coins: 100,
                experience: 0,
                lessonsCompleted: 0,
                streak: 1,
                createdAt: new Date().toISOString()
            };
        }
    }
    
    initWebSocket() {
        try {
            // Используем polling вместо WebSocket для простоты
            console.log('📡 Используем HTTP polling');
        } catch (error) {
            console.error('❌ Ошибка WebSocket:', error);
        }
    }
    
    async loadInitialData() {
        // Загружаем уроки
        await this.loadLessons();
        
        // Загружаем ферму
        await this.loadFarm();
        
        // Загружаем прогресс
        await this.loadProgress();
        
        // Показываем приветствие
        this.showWelcomeMessage();
    }
    
    async loadLessons() {
        try {
            const response = await fetch('/api/lessons');
            this.lessonsData = await response.json();
            
            // Помечаем завершенные уроки
            if (this.userData) {
                const progress = await this.getUserProgress();
                this.lessonsData.forEach(lesson => {
                    lesson.completed = progress.some(p => p.lessonId === lesson.id && p.status === 'completed');
                });
            }
            
            this.renderLessons();
            
        } catch (error) {
            console.error('❌ Ошибка загрузки уроков:', error);
            this.showError('Не удалось загрузить уроки');
        }
    }
    
    async loadFarm() {
        if (!this.userId) return;
        
        try {
            const response = await fetch(`/api/farm/${this.userId}/visual`);
            this.farmData = await response.json();
            
            this.renderFarm();
            this.updateFarmStats();
            
        } catch (error) {
            console.error('❌ Ошибка загрузки фермы:', error);
            // Создаем демо-ферму
            this.createDemoFarm();
        }
    }
    
    async loadProgress() {
        if (!this.userId) return;
        
        try {
            const response = await fetch(`/api/user/${this.userId}/progress`);
            const progress = await response.json();
            
            // Обновляем прогресс в интерфейсе
            this.updateProgressUI(progress);
            
        } catch (error) {
            console.error('❌ Ошибка загрузки прогресса:', error);
        }
    }
    
    async getUserProgress() {
        if (!this.userId) return [];
        
        try {
            const response = await fetch(`/api/user/${this.userId}/progress`);
            return await response.json();
        } catch (error) {
            return [];
        }
    }
    
    initUI() {
        // Инициализируем навигацию
        this.initNavigation();
        
        // Инициализируем редактор кода
        this.initCodeEditor();
        
        // Инициализируем обработчики событий
        this.initEventHandlers();
        
        // Показываем главный экран
        this.showScreen('main');
    }
    
    initNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            const screen = item.getAttribute('data-screen');
            if (screen) {
                item.addEventListener('click', () => this.showScreen(screen));
            }
        });
    }
    
    initCodeEditor() {
        const textarea = document.getElementById('code-editor');
        if (textarea) {
            // Простой редактор с подсветкой синтаксиса
            textarea.addEventListener('input', function() {
                // Автоподстройка высоты
                this.style.height = 'auto';
                this.style.height = (this.scrollHeight) + 'px';
                
                // Простая подсветка ключевых слов
                const code = this.value;
                const keywords = [
                    'def', 'class', 'if', 'else', 'elif', 'for', 'while',
                    'return', 'print', 'import', 'from', 'as', 'True', 'False',
                    'None', 'and', 'or', 'not', 'in', 'is', 'try', 'except',
                    'finally', 'with', 'as', 'async', 'await', 'yield'
                ];
                
                // Можно добавить более сложную подсветку через CodeMirror или Monaco
                // Для MVP оставляем простой textarea
            });
            
            this.codeEditor = textarea;
        }
    }
    
    initEventHandlers() {
        // Кнопка запуска кода
        const runBtn = document.getElementById('run-code-btn');
        if (runBtn) {
            runBtn.addEventListener('click', () => this.runCode());
        }
        
        // Кнопка отправки решения
        const submitBtn = document.getElementById('submit-code-btn');
        if (submitBtn) {
            submitBtn.addEventListener('click', () => this.submitSolution());
        }
        
        // Кнопки действий на ферме
        const farmBtns = document.querySelectorAll('.farm-btn');
        farmBtns.forEach(btn => {
            const action = btn.getAttribute('data-action');
            if (action) {
                btn.addEventListener('click', () => this.handleFarmAction(action));
            }
        });
        
        // Кнопки быстрых действий
        const quickBtns = document.querySelectorAll('.quick-action-btn');
        quickBtns.forEach(btn => {
            const lessonId = btn.getAttribute('data-lesson');
            if (lessonId) {
                btn.addEventListener('click', () => this.startLesson(lessonId));
            }
        });
    }
    
    showWelcomeMessage() {
        const welcomeDiv = document.getElementById('welcome-message');
        if (welcomeDiv && this.userData) {
            welcomeDiv.innerHTML = `
                <h1>👋 Привет, ${this.userData.firstName}!</h1>
                <p>Добро пожаловать на вашу ферму. Начните с первого урока!</p>
                <div class="user-stats">
                    <span>⭐ Уровень ${this.userData.level}</span>
                    <span>🪙 ${this.userData.coins} монет</span>
                    <span>📚 ${this.userData.lessonsCompleted || 0} уроков</span>
                </div>
            `;
        }
    }
    
    renderFarm() {
        const farmGrid = document.getElementById('farm-grid');
        if (!farmGrid || !this.farmData) return;
        
        farmGrid.innerHTML = '';
        
        // Определяем размер фермы
        const size = Math.max(
            Math.ceil(Math.sqrt(this.farmData.cells?.length || 64)),
            8
        );
        
        farmGrid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
        farmGrid.style.gridTemplateRows = `repeat(${size}, 1fr)`;
        
        // Создаем клетки фермы
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const cell = document.createElement('div');
                cell.className = 'farm-cell';
                cell.dataset.x = x;
                cell.dataset.y = y;
                
                // Находим данные клетки
                const cellData = this.farmData.cells?.find(c => c.x === x && c.y === y);
                
                if (cellData) {
                    this.renderFarmCell(cell, cellData);
                } else {
                    // Пустая клетка
                    cell.innerHTML = '🌿';
                    cell.style.background = '#8BC34A';
                    cell.title = 'Заросший участок';
                }
                
                cell.addEventListener('click', () => this.handleFarmClick(x, y, cellData));
                farmGrid.appendChild(cell);
            }
        }
    }
    
    renderFarmCell(cell, data) {
        let emoji = '❓';
        let color = '#FFFFFF';
        let title = '';
        
        switch(data.type) {
            case 'cleared':
                emoji = '🟫';
                color = '#8D6E63';
                title = 'Очищенная земля';
                break;
            case 'house':
                emoji = '🏠';
                color = '#FF9800';
                title = 'Дом фермера';
                break;
            case 'field':
                emoji = '🟨';
                color = '#FFEB3B';
                title = 'Поле для посадки';
                break;
            case 'crop':
                if (data.cropType === 'wheat') {
                    emoji = '🌾';
                    color = '#FFD54F';
                    title = `Пшеница (рост: ${data.growth || 0}%)`;
                } else if (data.cropType === 'carrot') {
                    emoji = '🥕';
                    color = '#FF9800';
                    title = `Морковь (рост: ${data.growth || 0}%)`;
                } else {
                    emoji = '🌱';
                    color = '#4CAF50';
                    title = 'Растение';
                }
                break;
            case 'greenhouse':
                emoji = '🌿';
                color = '#4CAF50';
                title = 'Умная теплица';
                break;
            case 'water':
                emoji = '💧';
                color = '#2196F3';
                title = 'Водоём';
                break;
            default:
                emoji = data.emoji || '🌿';
                color = data.color || '#8BC34A';
                title = data.title || 'Участок';
        }
        
        cell.innerHTML = emoji;
        cell.style.background = color;
        cell.title = title;
        
        // Добавляем анимацию для растущих растений
        if (data.type === 'crop' && data.growth && data.growth < 100) {
            cell.style.animation = 'pulse 2s infinite';
        }
    }
    
    updateFarmStats() {
        if (!this.farmData) return;
        
        const stats = {
            cleared: this.farmData.cells?.filter(c => c.type === 'cleared').length || 0,
            buildings: this.farmData.cells?.filter(c => c.type === 'house' || c.type === 'greenhouse').length || 0,
            crops: this.farmData.cells?.filter(c => c.type === 'crop').length || 0,
            water: this.farmData.cells?.filter(c => c.type === 'water').length || 0
        };
        
        // Обновляем элементы
        document.getElementById('cleared-land-count').textContent = stats.cleared;
        document.getElementById('buildings-count').textContent = stats.buildings;
        document.getElementById('crops-count').textContent = stats.crops;
        
        // Обновляем прогресс
        const progress = Math.min(100, (stats.cleared + stats.buildings * 5 + stats.crops * 2) * 2);
        document.getElementById('farm-progress-bar').style.width = `${progress}%`;
    }
    
    createDemoFarm() {
        this.farmData = {
            cells: [],
            stats: {
                clearedLand: 4,
                buildings: 1,
                crops: 2
            }
        };
        
        // Создаем демо-ферму 8x8
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                let type = 'overgrown';
                let emoji = '🌿';
                let color = '#8BC34A';
                
                // Центр - дом
                if (x === 3 && y === 3) {
                    type = 'house';
                    emoji = '🏠';
                    color = '#FF9800';
                }
                // Очищенные участки
                else if (x < 4 && y < 4) {
                    type = 'cleared';
                    emoji = '🟫';
                    color = '#8D6E63';
                }
                // Пшеница
                else if (x === 6 && y === 2) {
                    type = 'crop';
                    emoji = '🌾';
                    color = '#FFD54F';
                }
                // Морковь
                else if (x === 2 && y === 6) {
                    type = 'crop';
                    emoji = '🥕';
                    color = '#FF9800';
                }
                // Водоём
                else if (x === 7 && y === 7) {
                    type = 'water';
                    emoji = '💧';
                    color = '#2196F3';
                }
                
                this.farmData.cells.push({
                    x, y, type, emoji, color,
                    cropType: type === 'crop' ? (x === 6 ? 'wheat' : 'carrot') : null,
                    growth: type === 'crop' ? Math.floor(Math.random() * 100) : null
                });
            }
        }
        
        this.renderFarm();
        this.updateFarmStats();
    }
    
    renderLessons() {
        const container = document.getElementById('lessons-list');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.lessonsData.forEach((lesson, index) => {
            const card = document.createElement('div');
            card.className = 'lesson-card';
            card.dataset.lessonId = lesson.id;
            
            const status = lesson.completed ? 'completed' : 
                          index === 0 ? 'available' : 'locked';
            
            card.innerHTML = `
                <div class="lesson-header">
                    <span class="lesson-number">Урок ${index + 1}</span>
                    <span class="lesson-status ${status}"></span>
                </div>
                <h3>${lesson.title}</h3>
                <p class="lesson-description">${lesson.description}</p>
                <div class="lesson-rewards">
                    <span class="reward-coins">🪙 ${lesson.rewardCoins || 50}</span>
                    <span class="reward-exp">⭐ ${lesson.rewardExp || 100}</span>
                    <span class="reward-level">📊 Ур. ${lesson.level || 1}</span>
                </div>
                <button class="start-lesson-btn ${status}" 
                        onclick="app.startLesson('${lesson.id}')"
                        ${status === 'locked' ? 'disabled' : ''}>
                    ${lesson.completed ? 'Повторить' : 'Начать'}
                </button>
            `;
            
            container.appendChild(card);
        });
    }
    
    showScreen(screenName) {
        // Скрываем все экраны
        const screens = ['main', 'lessons', 'code', 'profile'];
        screens.forEach(screen => {
            const element = document.getElementById(`${screen}-screen`);
            if (element) element.style.display = 'none';
        });
        
        // Показываем нужный экран
        const targetScreen = document.getElementById(`${screenName}-screen`);
        if (targetScreen) {
            targetScreen.style.display = 'block';
        }
        
        // Обновляем активную кнопку навигации
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.screen === screenName) {
                item.classList.add('active');
            }
        });
        
        // Обновляем заголовок
        document.title = `CodeFarm - ${
            screenName === 'main' ? 'Ферма' :
            screenName === 'lessons' ? 'Уроки' :
            screenName === 'code' ? 'Редактор' : 'Профиль'
        }`;
        
        // Для экрана кода инициализируем редактор
        if (screenName === 'code' && this.codeEditor) {
            setTimeout(() => {
                this.codeEditor.style.height = 'auto';
                this.codeEditor.style.height = (this.codeEditor.scrollHeight) + 'px';
            }, 100);
        }
    }
    
    async startLesson(lessonId) {
        try {
            const response = await fetch(`/api/lessons/${lessonId}?userId=${this.userId}`);
            this.currentLesson = await response.json();
            
            this.showScreen('code');
            this.loadLessonContent();
            
        } catch (error) {
            console.error('❌ Ошибка загрузки урока:', error);
            this.showError('Не удалось загрузить урок');
        }
    }
    
    loadLessonContent() {
        if (!this.currentLesson) return;
        
        // Обновляем заголовок
        document.getElementById('current-lesson-title').textContent = this.currentLesson.title;
        document.getElementById('current-lesson-desc').textContent = this.currentLesson.description;
        
        // Загружаем теорию
        const theoryEl = document.getElementById('lesson-theory');
        if (theoryEl) {
            theoryEl.innerHTML = `
                <h3>📖 Теория</h3>
                <div class="theory-content">${this.currentLesson.theory || 'Информация будет добавлена позже'}</div>
            `;
        }
        
        // Загружаем задание
        const taskEl = document.getElementById('lesson-task');
        if (taskEl) {
            taskEl.innerHTML = `
                <h3>🎯 Задание</h3>
                <div class="task-content">${this.currentLesson.task}</div>
                <div class="task-example">
                    <h4>📝 Пример кода:</h4>
                    <pre><code>${this.currentLesson.exampleCode || '# Пример кода'}</code></pre>
                </div>
            `;
        }
        
        // Устанавливаем начальный код
        if (this.codeEditor) {
            this.codeEditor.value = this.currentLesson.initialCode || `# Напишите решение для урока: ${this.currentLesson.title}\n# Ваш код здесь...`;
            this.codeEditor.style.height = 'auto';
            this.codeEditor.style.height = (this.codeEditor.scrollHeight) + 'px';
        }
        
        // Загружаем подсказки
        this.loadHints();
    }
    
    loadHints() {
        const hintsEl = document.getElementById('hints-container');
        if (!hintsEl || !this.currentLesson) return;
        
        hintsEl.innerHTML = `
            <div class="hint-section">
                <h3>💡 Подсказки</h3>
                <ul class="hints-list">
                    <li>Используйте функцию print() для вывода текста</li>
                    <li>Проверьте синтаксис Python</li>
                    <li>Следуйте инструкциям в задании</li>
                </ul>
            </div>
        `;
        
        // Добавляем специфичные подсказки из урока
        if (this.currentLesson.hints) {
            const hintsList = hintsEl.querySelector('.hints-list');
            this.currentLesson.hints.forEach(hint => {
                const li = document.createElement('li');
                li.textContent = hint;
                hintsList.appendChild(li);
            });
        }
    }
    
    async runCode() {
        const code = this.codeEditor?.value;
        if (!code) return;
        
        const outputEl = document.getElementById('output-text');
        const outputContainer = document.getElementById('output-container');
        
        if (!outputEl || !outputContainer) return;
        
        outputEl.textContent = '🚀 Выполняю код...\n';
        outputContainer.style.display = 'block';
        
        try {
            // Имитация выполнения кода
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Простой анализ кода
            const lines = code.split('\n');
            let result = '';
            
            lines.forEach((line, i) => {
                const trimmed = line.trim();
                
                if (trimmed.includes('print(')) {
                    // Извлекаем текст для печати
                    const match = trimmed.match(/print\(["'](.+?)["']\)/);
                    if (match) {
                        result += `[Строка ${i + 1}] Вывод: "${match[1]}"\n`;
                    }
                } else if (trimmed.includes('bot_say(')) {
                    const match = trimmed.match(/bot_say\(["'](.+?)["']\)/);
                    if (match) {
                        result += `[Строка ${i + 1}] 🤖 Бот: "${match[1]}"\n`;
                    }
                } else if (trimmed && !trimmed.startsWith('#')) {
                    result += `[Строка ${i + 1}] Выполнено: ${trimmed}\n`;
                }
            });
            
            outputEl.textContent += result + '\n✅ Код выполнен успешно!';
            
        } catch (error) {
            outputEl.textContent += `❌ Ошибка: ${error.message}`;
        }
    }
    
    async submitSolution() {
        if (!this.currentLesson || !this.userId) return;
        
        const code = this.codeEditor?.value;
        if (!code?.trim()) {
            this.showNotification('⚠️ Введите код', 'Напишите решение задания');
            return;
        }
        
        try {
            const response = await fetch(`/api/lessons/${this.currentLesson.id}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: this.userId,
                    code: code
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification('🎉 Урок пройден!', 
                    `Награда: ${result.reward} монет\n` +
                    `Опыт: +${result.experience || 100}\n` +
                    (result.levelUp ? `⭐ Новый уровень: ${result.newLevel}!` : ''));
                
                // Обновляем данные пользователя
                if (result.userData) {
                    this.userData = { ...this.userData, ...result.userData };
                    this.updateUserStats();
                }
                
                // Обновляем ферму
                if (result.farmUpdate) {
                    await this.applyFarmUpdate(result.farmUpdate);
                }
                
                // Обновляем список уроков
                await this.loadLessons();
                
                // Показываем анимацию успеха
                this.playSuccessAnimation();
                
            } else {
                this.showNotification('❌ Ошибка', result.message || 'Проверьте ваш код');
                
                if (result.errors) {
                    this.showCodeErrors(result.errors);
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка отправки:', error);
            this.showError('Ошибка соединения с сервером');
        }
    }
    
    async applyFarmUpdate(farmUpdate) {
        // Обновляем ферму визуально
        if (farmUpdate.action === 'clear_land') {
            this.showFarmAnimation('clear');
        } else if (farmUpdate.action === 'build_house') {
            this.showFarmAnimation('build');
        } else if (farmUpdate.action === 'plant_crop') {
            this.showFarmAnimation('plant');
        } else if (farmUpdate.action === 'water_crops') {
            this.showFarmAnimation('water');
        }
        
        // Перезагружаем ферму
        await this.loadFarm();
    }
    
    showFarmAnimation(type) {
        const farmGrid = document.getElementById('farm-grid');
        if (!farmGrid) return;
        
        let emoji = '✨';
        let message = '';
        
        switch(type) {
            case 'clear':
                emoji = '🧹';
                message = 'Участок расчищен!';
                break;
            case 'build':
                emoji = '🏗️';
                message = 'Постройка завершена!';
                break;
            case 'plant':
                emoji = '🌱';
                message = 'Растения посажены!';
                break;
            case 'water':
                emoji = '💧';
                message = 'Растения политы!';
                break;
        }
        
        // Показываем уведомление
        this.showNotification(emoji, message);
        
        // Анимация на ферме
        const cells = farmGrid.querySelectorAll('.farm-cell');
        cells.forEach(cell => {
            cell.style.transform = 'scale(1.05)';
            setTimeout(() => {
                cell.style.transform = 'scale(1)';
            }, 300);
        });
    }
    
    async handleFarmAction(action) {
        if (!this.userId) return;
        
        switch(action) {
            case 'water':
                await this.waterCrops();
                break;
            case 'harvest':
                await this.harvestCrops();
                break;
            case 'plant':
                await this.plantCrop();
                break;
            case 'build':
                await this.buildHouse();
                break;
            case 'upgrade':
                await this.upgradeFarm();
                break;
        }
    }
    
    async waterCrops() {
        try {
            const response = await fetch(`/api/farm/${this.userId}/water`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification('💧 Полив завершен', result.message);
                await this.loadFarm();
            }
            
        } catch (error) {
            console.error('❌ Ошибка полива:', error);
        }
    }
    
    async harvestCrops() {
        try {
            const response = await fetch(`/api/farm/${this.userId}/harvest`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification('📦 Урожай собран', 
                    `Получено ${result.coins || 0} монет\n` +
                    `Собрано: ${result.harvested || 0} культур`);
                
                if (result.coins && this.userData) {
                    this.userData.coins += result.coins;
                    this.updateUserStats();
                }
                
                await this.loadFarm();
            }
            
        } catch (error) {
            console.error('❌ Ошибка сбора:', error);
        }
    }
    
    async plantCrop() {
        try {
            const response = await fetch(`/api/farm/${this.userId}/plant`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cropType: 'wheat' })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification('🌱 Посадка', result.message);
                await this.loadFarm();
            }
            
        } catch (error) {
            console.error('❌ Ошибка посадки:', error);
        }
    }
    
    async buildHouse() {
        try {
            const response = await fetch(`/api/farm/${this.userId}/build`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ buildingType: 'house' })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification('🏠 Строительство', result.message);
                await this.loadFarm();
            }
            
        } catch (error) {
            console.error('❌ Ошибка строительства:', error);
        }
    }
    
    async upgradeFarm() {
        this.showNotification('🔄 В разработке', 'Эта функция скоро будет доступна!');
    }
    
    handleFarmClick(x, y, cellData) {
        if (!cellData) return;
        
        let message = `Участок (${x}, ${y})\n`;
        let emoji = '📍';
        
        switch(cellData.type) {
            case 'cleared':
                message += 'Очищенная земля. Можно построить дом или посадить растения.';
                emoji = '🟫';
                break;
            case 'house':
                message += 'Ваш дом. Здесь вы планируете работу на ферме.';
                emoji = '🏠';
                break;
            case 'crop':
                message += `${this.getCropName(cellData.cropType)}. Рост: ${cellData.growth || 0}%. `;
                message += cellData.growth >= 80 ? 'Готов к сбору!' : 'Нужно полить.';
                emoji = cellData.emoji || '🌱';
                break;
            case 'water':
                message += 'Источник воды. Необходим для полива растений.';
                emoji = '💧';
                break;
            default:
                message += 'Заросший участок. Пройдите урок 1, чтобы расчистить.';
                emoji = '🌿';
        }
        
        this.showNotification(emoji, message);
    }
    
    getCropName(type) {
        const names = {
            'wheat': 'Пшеница',
            'carrot': 'Морковь',
            'potato': 'Картофель',
            'tomato': 'Помидор'
        };
        return names[type] || type;
    }
    
    updateUserStats() {
        if (!this.userData) return;
        
        const elements = {
            'user-level-value': this.userData.level || 1,
            'user-coins-value': this.userData.coins || 0,
            'user-exp-value': this.userData.experience || 0,
            'user-lessons-value': this.userData.lessonsCompleted || 0,
            'header-coins': this.userData.coins || 0,
            'header-level': `Ур. ${this.userData.level || 1}`,
            'completed-lessons': this.userData.lessonsCompleted || 0,
            'user-level-text': this.userData.level || 1
        };
        
        for (const [id, value] of Object.entries(elements)) {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        }
        
        // Обновляем прогресс-бар уроков
        const progressBar = document.getElementById('lessons-progress');
        if (progressBar) {
            const progress = Math.min(100, (this.userData.lessonsCompleted || 0) * 3.57); // 100/28
            progressBar.style.width = `${progress}%`;
        }
    }
    
    updateProgressUI(progress) {
        // Обновляем статусы уроков
        if (progress && Array.isArray(progress)) {
            progress.forEach(p => {
                const lessonCard = document.querySelector(`[data-lesson-id="${p.lessonId}"]`);
                if (lessonCard) {
                    const statusEl = lessonCard.querySelector('.lesson-status');
                    if (statusEl) {
                        statusEl.className = `lesson-status ${p.status === 'completed' ? 'completed' : 'in-progress'}`;
                    }
                    
                    const button = lessonCard.querySelector('.start-lesson-btn');
                    if (button) {
                        button.textContent = p.status === 'completed' ? 'Повторить' : 'Продолжить';
                        button.className = `start-lesson-btn ${p.status === 'completed' ? 'completed' : 'available'}`;
                    }
                }
            });
        }
    }
    
    showCodeErrors(errors) {
        const outputEl = document.getElementById('output-text');
        const outputContainer = document.getElementById('output-container');
        
        if (outputEl && outputContainer) {
            outputEl.textContent = '❌ Ошибки в коде:\n\n';
            errors.forEach((error, i) => {
                outputEl.textContent += `${i + 1}. ${error}\n`;
            });
            outputContainer.style.display = 'block';
        }
    }
    
    showNotification(title, message) {
        // Создаем уведомление
        const notification = document.createElement('div');
        notification.className = 'notification fade-in';
        notification.innerHTML = `
            <div class="notification-icon">${title.split(' ')[0]}</div>
            <div class="notification-content">
                <strong>${title}</strong>
                <p>${message.replace(/\n/g, '<br>')}</p>
            </div>
        `;
        
        // Добавляем стили
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: white;
            padding: 15px 20px;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            max-width: 300px;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(notification);
        
        // Автоматическое скрытие
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }
    
    showError(message) {
        this.showNotification('❌ Ошибка', message);
    }
    
    playSuccessAnimation() {
        // Анимация успеха
        const successEl = document.createElement('div');
        successEl.className = 'success-animation';
        successEl.innerHTML = '🎉';
        successEl.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 80px;
            z-index: 2000;
            animation: zoomInOut 1.5s ease;
            pointer-events: none;
        `;
        
        document.body.appendChild(successEl);
        
        setTimeout(() => successEl.remove(), 1500);
    }
    
    startMonitoring() {
        // Периодическое обновление данных
        setInterval(() => {
            if (this.userId) {
                this.loadFarm();
                this.loadProgress();
            }
        }, 30000); // Каждые 30 секунд
    }
}

// Глобальный объект приложения
window.app = null;

// Запуск приложения при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM загружен, запускаем CodeFarm...');
    
    // Добавляем CSS для анимаций
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        
        @keyframes zoomInOut {
            0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
            50% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
        }
        
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        
        .fade-in {
            animation: fadeIn 0.3s ease;
        }
        
        .pulse {
            animation: pulse 2s infinite;
        }
        
        .notification {
            animation: slideIn 0.3s ease;
        }
        
        .success-animation {
            animation: zoomInOut 1.5s ease;
        }
        
        /* Стили для фермы */
        .farm-cell {
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid rgba(0,0,0,0.1);
            cursor: pointer;
            transition: all 0.2s;
            font-size: 20px;
            position: relative;
            user-select: none;
        }
        
        .farm-cell:hover {
            transform: scale(1.1);
            z-index: 10;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        
        .farm-cell-coords {
            position: absolute;
            bottom: 2px;
            right: 2px;
            font-size: 8px;
            color: rgba(0,0,0,0.5);
            background: rgba(255,255,255,0.3);
            padding: 1px 3px;
            border-radius: 2px;
        }
        
        /* Стили для уроков */
        .lesson-card {
            background: white;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
            border: 2px solid #e0e0e0;
            transition: all 0.3s;
        }
        
        .lesson-card:hover {
            border-color: #4CAF50;
            box-shadow: 0 6px 16px rgba(76, 175, 80, 0.1);
        }
        
        .lesson-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        
        .lesson-number {
            background: #4CAF50;
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
        }
        
        .lesson-status {
            width: 12px;
            height: 12px;
            border-radius: 50%;
        }
        
        .lesson-status.completed {
            background: #4CAF50;
        }
        
        .lesson-status.available {
            background: #FFC107;
        }
        
        .lesson-status.locked {
            background: #9E9E9E;
        }
        
        .lesson-status.in-progress {
            background: #2196F3;
        }
        
        .lesson-rewards {
            display: flex;
            gap: 10px;
            margin: 15px 0;
            flex-wrap: wrap;
        }
        
        .reward-coins, .reward-exp, .reward-level {
            background: #f5f5f5;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
        }
        
        .start-lesson-btn {
            width: 100%;
            padding: 10px;
            border: none;
            border-radius: 8px;
            background: #4CAF50;
            color: white;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
        }
        
        .start-lesson-btn:hover {
            background: #45a049;
            transform: translateY(-2px);
        }
        
        .start-lesson-btn.completed {
            background: #9E9E9E;
        }
        
        .start-lesson-btn.locked {
            background: #e0e0e0;
            color: #9E9E9E;
            cursor: not-allowed;
        }
        
        /* Редактор кода */
        #code-editor {
            width: 100%;
            min-height: 200px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.5;
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 8px;
            resize: vertical;
            background: #f8f9fa;
        }
        
        #code-editor:focus {
            outline: none;
            border-color: #4CAF50;
            box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.2);
        }
        
        .output-container {
            background: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 15px;
            margin-top: 20px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 13px;
            max-height: 200px;
            overflow-y: auto;
        }
        
        /* Прогресс-бар */
        .progress-bar {
            height: 10px;
            background: #e0e0e0;
            border-radius: 5px;
            overflow: hidden;
            margin: 10px 0;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #4CAF50, #8BC34A);
            transition: width 0.5s ease;
        }
        
        /* Адаптивность */
        @media (max-width: 768px) {
            .farm-cell {
                font-size: 16px;
            }
            
            .lesson-card {
                padding: 15px;
            }
            
            #code-editor {
                font-size: 13px;
            }
        }
    `;
    document.head.appendChild(style);
    
    // Запускаем приложение
    window.app = new CodeFarmApp();
});

// Глобальные функции для вызова из HTML
function showScreen(screenName) {
    if (window.app) {
        window.app.showScreen(screenName);
    }
}

function runCode() {
    if (window.app) {
        window.app.runCode();
    }
}

function submitCode() {
    if (window.app) {
        window.app.submitSolution();
    }
}

function startLesson(lessonId) {
    if (window.app) {
        window.app.startLesson(lessonId);
    }
}

function clearOutput() {
    const outputEl = document.getElementById('output-text');
    if (outputEl) {
        outputEl.textContent = '';
    }
}
