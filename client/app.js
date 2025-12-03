// client/app.js - Полностью рабочий фронтенд для CodeFarm
class CodeFarmApp {
    constructor() {
        this.userId = null;
        this.userData = null;
        this.farmData = null;
        this.lessonsData = [];
        this.currentLesson = null;
        this.codeEditor = null;
        
        // Типы клеток фермы
        this.CELL_TYPES = {
            GRASS: 'grass',      // Трава (заросший участок) - начало
            CLEARED: 'cleared',  // Расчищенная земля - урок 1
            PLOWED: 'plowed',    // Вспаханная земля - урок 2
            HOUSE: 'house',      // Дом - урок 3
            BARN: 'barn',        // Сарай - урок 4
            CROP: 'crop',        // Посев - урок 5
            WATER: 'water',      // Вода - урок 6
            ROAD: 'road'         // Дорога
        };
        
        console.log('🚀 CodeFarmApp инициализирован');
        this.init();
    }
    
    async init() {
        console.log('🔧 Начинаем инициализацию...');
        
        // 1. Проверяем авторизацию
        await this.checkAuth();
        
        // 2. Загружаем начальные данные
        await this.loadInitialData();
        
        // 3. Инициализируем интерфейс
        this.initUI();
        
        // 4. Показываем приветствие
        this.showWelcomeMessage();
        
        console.log('✅ Инициализация завершена');
    }
    
    async checkAuth() {
        console.log('🔐 Проверяем авторизацию...');
        
        // Проверяем Telegram Web App
        if (window.Telegram?.WebApp) {
            console.log('📱 Обнаружен Telegram Web App');
            const tg = window.Telegram.WebApp;
            
            // Расширяем на весь экран
            tg.expand();
            tg.ready();
            
            // Получаем данные пользователя
            const user = tg.initDataUnsafe?.user;
            if (user) {
                console.log('👤 Пользователь Telegram:', user);
                this.userId = user.id.toString();
                
                // Регистрируем пользователя
                await this.registerUser(user);
            } else {
                console.log('⚠️ Пользователь не найден в Telegram Web App');
                this.userId = 'demo-user';
                this.userData = {
                    id: 'demo-user',
                    firstName: 'Демо Фермер',
                    username: 'demo',
                    level: 1,
                    coins: 100,
                    experience: 0,
                    lessonsCompleted: 0,
                    completedLessonIds: []
                };
            }
        } else {
            console.log('🌐 Режим обычного браузера');
            this.userId = localStorage.getItem('codefarm_user_id') || 'demo-user-' + Date.now();
            localStorage.setItem('codefarm_user_id', this.userId);
            
            this.userData = {
                id: this.userId,
                firstName: 'Демо Фермер',
                username: 'demo',
                level: 1,
                coins: 100,
                experience: 0,
                lessonsCompleted: 0,
                completedLessonIds: [],
                streak: 1
            };
        }
    }
    
    async registerUser(tgUser) {
        try {
            console.log('📝 Регистрируем пользователя:', tgUser);
            
            const response = await fetch('/api/user', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    telegramId: this.userId,
                    username: tgUser.username,
                    firstName: tgUser.first_name,
                    lastName: tgUser.last_name
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            this.userData = await response.json();
            console.log('✅ Пользователь зарегистрирован:', this.userData);
            
        } catch (error) {
            console.error('❌ Ошибка регистрации:', error);
            
            // Создаем демо-данные
            this.userData = {
                id: this.userId,
                username: tgUser?.username || 'demo',
                firstName: tgUser?.first_name || 'Фермер',
                level: 1,
                coins: 100,
                experience: 0,
                lessonsCompleted: 0,
                completedLessonIds: [],
                streak: 1,
                createdAt: new Date().toISOString()
            };
            
            console.log('🔄 Используем демо-данные:', this.userData);
        }
    }
    
    async loadInitialData() {
        console.log('📥 Загружаем начальные данные...');
        
        try {
            // Загружаем уроки
            await this.loadLessons();
            
            // Загружаем ферму
            await this.loadFarm();
            
            // Обновляем статистику
            this.updateUserStats();
            
        } catch (error) {
            console.error('❌ Ошибка загрузки данных:', error);
            this.showError('Не удалось загрузить данные');
        }
    }
    
    async loadLessons() {
        console.log('📚 Загружаем уроки...');
        
        try {
            const response = await fetch('/api/lessons');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            this.lessonsData = await response.json();
            console.log(`✅ Загружено ${this.lessonsData.length} уроков`);
            
            // Рендерим уроки
            this.renderLessons();
            
        } catch (error) {
            console.error('❌ Ошибка загрузки уроков:', error);
            
            // Создаем демо-уроки
            this.lessonsData = this.createDemoLessons();
            console.log('🔄 Используем демо-уроки');
            
            this.renderLessons();
        }
    }
    
    createDemoLessons() {
        return [
            {
                id: 'lesson_1',
                title: 'Первые команды боту-помощнику',
                description: 'Научитесь давать базовые команды боту',
                level: 1,
                rewardCoins: 50,
                rewardExp: 100,
                theory: 'В этом уроке вы научитесь использовать функцию print() для вывода текста.',
                task: 'Напишите программу, которая выведет "Привет, АгроБот!" и "Начинаю работу!"',
                testCode: 'print("Привет, АгроБот!")\nprint("Начинаю работу!")',
                initialCode: '# Напишите приветствие для бота\nprint("Привет, АгроБот!")'
            },
            {
                id: 'lesson_2',
                title: 'Переменные - Проект фермы',
                description: 'Используйте переменные для создания проекта фермы',
                level: 1,
                rewardCoins: 75,
                rewardExp: 150,
                theory: 'Переменные хранят данные. Используйте знак = для присвоения значения.',
                task: 'Создайте переменную farm_name со значением "Солнечная долина" и выведите её',
                testCode: 'farm_name = "Солнечная долина"\nprint(farm_name)',
                initialCode: '# Создайте переменную для названия фермы\nfarm_name = "Моя ферма"'
            },
            {
                id: 'lesson_3',
                title: 'Функции - Расчистка территории',
                description: 'Создайте свои функции для управления техникой',
                level: 1,
                rewardCoins: 100,
                rewardExp: 200,
                theory: 'Функции создаются с помощью def. Команды внутри функции должны быть с отступом.',
                task: 'Создайте функцию start_tractor(), которая выводит "Запускаю трактор"',
                testCode: 'def start_tractor():\n    print("Запускаю трактор")\n\nstart_tractor()',
                initialCode: '# Создайте функцию для запуска трактора\ndef start_tractor():\n    # Ваш код здесь\n    pass'
            },
            {
                id: 'lesson_4',
                title: 'Аргументы функций - Строительство дома',
                description: 'Используйте аргументы функций для кастомизации построек',
                level: 2,
                rewardCoins: 125,
                rewardExp: 250,
                theory: 'Аргументы функции указываются в скобках после имени функции.',
                task: 'Создайте функцию build_house(material), которая выводит "Строю дом из [material]"',
                testCode: 'def build_house(material):\n    print(f"Строю дом из {material}")\n\nbuild_house("дерево")',
                initialCode: '# Создайте функцию для постройки дома\ndef build_house(material):\n    # Ваш код здесь\n    pass'
            },
            {
                id: 'lesson_5',
                title: 'Циклы - Посадка растений',
                description: 'Используйте циклы для автоматической посадки растений',
                level: 2,
                rewardCoins: 150,
                rewardExp: 300,
                theory: 'Цикл for повторяет команды несколько раз. Используйте range() для создания последовательности.',
                task: 'Используйте цикл for, чтобы вывести "Сажаю растение" 3 раза',
                testCode: 'for i in range(3):\n    print("Сажаю растение")',
                initialCode: '# Используйте цикл для посадки растений\nfor i in range(3):\n    # Ваш код здесь\n    pass'
            },
            {
                id: 'lesson_6',
                title: 'Условные операторы - Уход за растениями',
                description: 'Используйте условия для принятия решений на ферме',
                level: 2,
                rewardCoins: 175,
                rewardExp: 350,
                theory: 'if проверяет условие. else выполняется, если условие ложно.',
                task: 'Проверьте, если soil_moisture < 50, выведите "Поливаю растения"',
                testCode: 'soil_moisture = 30\nif soil_moisture < 50:\n    print("Поливаю растения")\nelse:\n    print("Полив не нужен")',
                initialCode: '# Проверьте влажность почвы\nsoil_moisture = 30\n\nif soil_moisture < 50:\n    # Ваш код здесь\n    pass'
            }
        ];
    }
    
    async loadFarm() {
        if (!this.userId) {
            console.log('⚠️ Нет userId, пропускаем загрузку фермы');
            return;
        }
        
        console.log('🌾 Загружаем ферму...');
        
        try {
            // Сначала пробуем загрузить через API
            const response = await fetch(`/api/farm/${this.userId}/visual`);
            
            if (response.ok) {
                this.farmData = await response.json();
                console.log('✅ Ферма загружена через API');
            } else {
                throw new Error('API не доступен');
            }
            
        } catch (error) {
            console.log('🔄 Создаем начальную ферму (вся в траве)');
            this.createInitialFarm();
        }
        
        this.renderFarm();
        this.updateFarmStats();
    }
    
    createInitialFarm() {
        console.log('🏗️ Создаем начальную ферму (вся в траве)...');
        
        this.farmData = {
            cells: [],
            width: 8,
            height: 8,
            stats: {
                clearedLand: 0,  // Все в траве - 0 расчищено
                buildings: 0,
                crops: 0,
                water: 0
            }
        };
        
        // Создаем все клетки как траву
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                this.farmData.cells.push({
                    x, y,
                    type: 'grass',
                    emoji: '🌿',
                    color: '#2E7D32',
                    title: 'Заросший участок. Пройдите урок 1, чтобы расчистить!',
                    canClear: true
                });
            }
        }
        
        console.log('✅ Начальная ферма создана (64 клетки травы)');
    }
    
    initUI() {
        console.log('🎨 Инициализируем интерфейс...');
        
        // Инициализируем навигацию
        this.initNavigation();
        
        // Инициализируем редактор кода
        this.initCodeEditor();
        
        // Инициализируем обработчики событий
        this.initEventHandlers();
        
        // Показываем главный экран
        this.showScreen('main');
        
        // Добавляем CSS для анимаций
        this.addStyles();
        
        console.log('✅ Интерфейс инициализирован');
    }
    
    initNavigation() {
        console.log('📍 Инициализируем навигацию...');
        
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            const screen = item.getAttribute('data-screen');
            if (screen) {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.showScreen(screen);
                });
            }
        });
        
        console.log('✅ Навигация настроена');
    }
    
    initCodeEditor() {
        console.log('💻 Инициализируем редактор кода...');
        
        const textarea = document.getElementById('code-editor');
        if (textarea) {
            this.codeEditor = textarea;
            
            // Автоподстройка высоты
            textarea.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = (this.scrollHeight) + 'px';
            });
            
            // Устанавливаем начальный код
            textarea.value = `# Добро пожаловать в CodeFarm!
# Выберите урок слева, чтобы начать обучение`;

            // Подстраиваем высоту
            setTimeout(() => {
                textarea.style.height = 'auto';
                textarea.style.height = (textarea.scrollHeight) + 'px';
            }, 100);
            
            console.log('✅ Редактор кода готов');
        }
    }
    
    initEventHandlers() {
        console.log('🔄 Настраиваем обработчики событий...');
        
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
        
        // Кнопка очистки вывода
        const clearBtn = document.getElementById('clear-output-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearOutput());
        }
        
        // Быстрые действия
        const quickActions = document.querySelectorAll('.quick-action-btn');
        quickActions.forEach(btn => {
            const action = btn.getAttribute('data-action');
            if (action) {
                btn.addEventListener('click', () => this.handleQuickAction(action));
            }
        });
        
        // Действия на ферме
        const farmActions = document.querySelectorAll('.farm-action-btn');
        farmActions.forEach(btn => {
            const action = btn.getAttribute('data-action');
            if (action) {
                btn.addEventListener('click', () => this.handleFarmAction(action));
            }
        });
        
        console.log('✅ Обработчики событий настроены');
    }
    
    addStyles() {
        console.log('🎨 Добавляем стили...');
        
        const style = document.createElement('style');
        style.textContent = `
            /* Анимации */
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
            
            @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.05); }
            }
            
            @keyframes bounce {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-5px); }
            }
            
            @keyframes grow {
                0% { transform: scale(0.5); opacity: 0; }
                100% { transform: scale(1); opacity: 1; }
            }
            
            .fade-in {
                animation: fadeIn 0.3s ease forwards;
            }
            
            .pulse {
                animation: pulse 2s infinite;
            }
            
            .bounce {
                animation: bounce 2s infinite;
            }
            
            .grow {
                animation: grow 0.5s ease-out;
            }
            
            /* Ферма */
            .farm-grid {
                display: grid;
                gap: 2px;
                background: #8D6E63;
                padding: 10px;
                border-radius: 10px;
                border: 3px solid #5D4037;
            }
            
            .farm-cell {
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 5px;
                font-size: 20px;
                cursor: pointer;
                transition: all 0.3s;
                position: relative;
                user-select: none;
                min-height: 40px;
            }
            
            .farm-cell:hover {
                transform: scale(1.1);
                z-index: 10;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
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
            
            /* Типы клеток фермы */
            .farm-cell.grass { 
                background: #2E7D32 !important; 
                color: white;
            }
            .farm-cell.cleared { 
                background: #8D6E63 !important; 
                color: white;
            }
            .farm-cell.plowed { 
                background: #FFD54F !important; 
                color: #333;
            }
            .farm-cell.house { 
                background: #FF9800 !important; 
                color: white;
            }
            .farm-cell.barn { 
                background: #795548 !important; 
                color: white;
            }
            .farm-cell.crop { 
                background: #8BC34A !important; 
                color: #333;
            }
            .farm-cell.water { 
                background: #2196F3 !important; 
                color: white;
            }
            .farm-cell.road { 
                background: #9E9E9E !important; 
                color: white;
            }
            
            /* Уведомления */
            .notification {
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
            }
            
            .notification-icon {
                font-size: 24px;
            }
            
            .notification-content {
                flex: 1;
            }
            
            .notification-content strong {
                display: block;
                margin-bottom: 5px;
                color: #333;
            }
            
            .notification-content p {
                margin: 0;
                color: #666;
                font-size: 14px;
                line-height: 1.4;
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
            
            /* Уроки */
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
                font-size: 14px;
            }
            
            .lesson-status {
                width: 12px;
                height: 12px;
                border-radius: 50%;
            }
            
            .status-completed {
                background: #4CAF50;
            }
            
            .status-available {
                background: #2196F3;
            }
            
            .status-locked {
                background: #9E9E9E;
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
                margin-top: 15px;
            }
            
            .start-lesson-btn:hover {
                background: #45a049;
                transform: translateY(-2px);
            }
            
            .start-lesson-btn:disabled {
                background: #e0e0e0;
                color: #9E9E9E;
                cursor: not-allowed;
                transform: none;
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
            
            /* Загрузка */
            .loading-screen {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
            }
            
            .loading-content {
                text-align: center;
                color: white;
                padding: 40px;
            }
            
            .loading-logo {
                font-size: 80px;
                margin-bottom: 20px;
                animation: bounce 2s infinite;
            }

            /* Анимация успеха */
@keyframes zoomInOut {
    0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
    50% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
}

@keyframes confetti {
    0% { transform: translateY(0) rotate(0deg); opacity: 1; }
    100% { transform: translateY(100vh) rotate(360deg); opacity: 0; }
}

.confetti {
    position: fixed;
    width: 10px;
    height: 10px;
    background: var(--color);
    top: -10px;
    animation: confetti 3s linear forwards;
    z-index: 1000;
}
        `;
        
        document.head.appendChild(style);
        console.log('✅ Стили добавлены');
    }
    
    showScreen(screenName) {
        console.log(`🖥️ Переключаемся на экран: ${screenName}`);
        
        // Скрываем все экраны
        const screens = ['main', 'lessons', 'code', 'profile'];
        screens.forEach(screen => {
            const element = document.getElementById(`${screen}-screen`);
            if (element) {
                element.style.display = 'none';
            }
        });
        
        // Показываем нужный экран
        const targetScreen = document.getElementById(`${screenName}-screen`);
        if (targetScreen) {
            targetScreen.style.display = 'block';
        }
        
        // Обновляем активную кнопку навигации
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('data-screen') === screenName) {
                item.classList.add('active');
            }
        });
        
        // Для экрана кода обновляем редактор
        if (screenName === 'code' && this.codeEditor) {
            setTimeout(() => {
                this.codeEditor.style.height = 'auto';
                this.codeEditor.style.height = (this.codeEditor.scrollHeight) + 'px';
            }, 100);
        }
        
        console.log(`✅ Экран "${screenName}" показан`);
    }
    
    showWelcomeMessage() {
        console.log('👋 Показываем приветствие...');
        
        const welcomeDiv = document.getElementById('welcome-message');
        if (welcomeDiv && this.userData) {
            welcomeDiv.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <div style="font-size: 60px; margin-bottom: 20px;" class="bounce">🚜</div>
                    <h1 style="color: #2E7D32; margin-bottom: 10px;">Привет, ${this.userData.firstName}!</h1>
                    <p style="color: #666; margin-bottom: 20px; font-size: 16px;">Добро пожаловать на вашу ферму. Начните с первого урока!</p>
                    <div style="display: flex; justify-content: center; gap: 15px; flex-wrap: wrap;">
                        <div style="background: white; padding: 10px 15px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                            <div style="color: #4CAF50; font-weight: bold; font-size: 20px;">⭐ ${this.userData.level || 1}</div>
                            <div style="font-size: 12px; color: #666;">Уровень</div>
                        </div>
                        <div style="background: white; padding: 10px 15px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                            <div style="color: #4CAF50; font-weight: bold; font-size: 20px;">🪙 ${this.userData.coins || 100}</div>
                            <div style="font-size: 12px; color: #666;">Монеты</div>
                        </div>
                        <div style="background: white; padding: 10px 15px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                            <div style="color: #4CAF50; font-weight: bold; font-size: 20px;">📚 ${this.userData.lessonsCompleted || 0}</div>
                            <div style="font-size: 12px; color: #666;">Уроков</div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        console.log('✅ Приветствие показано');
    }
    
    renderFarm() {
        const farmGrid = document.getElementById('farm-grid');
        if (!farmGrid || !this.farmData) {
            console.log('⚠️ Не найден farm-grid или farmData');
            return;
        }
        
        console.log('🎨 Рендерим ферму...');
        
        farmGrid.innerHTML = '';
        farmGrid.style.gridTemplateColumns = `repeat(${this.farmData.width}, 1fr)`;
        farmGrid.style.gridTemplateRows = `repeat(${this.farmData.height}, 1fr)`;
        
        // Сортируем клетки для правильного отображения
        const sortedCells = [...this.farmData.cells].sort((a, b) => {
            if (a.y !== b.y) return a.y - b.y;
            return a.x - b.x;
        });
        
        sortedCells.forEach((cell, index) => {
            const cellElement = document.createElement('div');
            cellElement.className = `farm-cell ${cell.type} fade-in`;
            cellElement.style.animationDelay = `${index * 0.02}s`;
            cellElement.dataset.x = cell.x;
            cellElement.dataset.y = cell.y;
            
            cellElement.innerHTML = cell.emoji;
            cellElement.style.background = cell.color;
            cellElement.title = cell.title;
            
            // Добавляем координаты
            const coords = document.createElement('div');
            coords.className = 'farm-cell-coords';
            coords.textContent = `${cell.x},${cell.y}`;
            cellElement.appendChild(coords);
            
            // Обработчик клика
            cellElement.addEventListener('click', () => {
                this.handleFarmClick(cell.x, cell.y, cell);
            });
            
            farmGrid.appendChild(cellElement);
        });
        
        console.log(`✅ Ферма отрендерена: ${sortedCells.length} клеток`);
    }
    
    renderLessons() {
        const container = document.getElementById('lessons-list');
        if (!container) {
            console.log('⚠️ Не найден lessons-list');
            return;
        }
        
        console.log('📝 Рендерим уроки...');
        
        container.innerHTML = '';
        
        this.lessonsData.forEach((lesson, index) => {
            const card = document.createElement('div');
            card.className = 'lesson-card fade-in';
            card.style.animationDelay = `${index * 0.1}s`;
            
            // Определяем статус
            const completed = this.userData?.completedLessonIds?.includes(lesson.id) || false;
            const available = index === 0 || completed || 
                (index > 0 && this.userData?.completedLessonIds?.includes(this.lessonsData[index-1].id));
            const status = completed ? 'completed' : available ? 'available' : 'locked';
            
            card.innerHTML = `
                <div class="lesson-header">
                    <div class="lesson-number">${index + 1}</div>
                    <div class="lesson-status status-${status}"></div>
                </div>
                <h3 style="margin-bottom: 10px; color: #333;">${lesson.title}</h3>
                <p style="color: #666; margin-bottom: 15px; font-size: 14px;">${lesson.description}</p>
                
                <div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
                    <span style="background: #FFF3E0; color: #EF6C00; padding: 4px 8px; border-radius: 12px; font-size: 12px;">
                        🪙 ${lesson.rewardCoins || 50}
                    </span>
                    <span style="background: #E8F5E9; color: #2E7D32; padding: 4px 8px; border-radius: 12px; font-size: 12px;">
                        ⭐ ${lesson.rewardExp || 100}
                    </span>
                    <span style="background: #E3F2FD; color: #1565C0; padding: 4px 8px; border-radius: 12px; font-size: 12px;">
                        📊 Ур. ${lesson.level || 1}
                    </span>
                </div>
                
                <button class="start-lesson-btn" 
                        onclick="window.codeFarmApp.startLesson('${lesson.id}')"
                        ${!available ? 'disabled' : ''}>
                    ${completed ? 'Повторить урок' : available ? 'Начать урок' : 'Заблокировано'}
                </button>
            `;
            
            container.appendChild(card);
        });
        
        console.log(`✅ Уроки отрендерены: ${this.lessonsData.length} уроков`);
    }
    
    updateUserStats() {
        if (!this.userData) {
            console.log('⚠️ Нет userData для обновления статистики');
            return;
        }
        
        console.log('📊 Обновляем статистику пользователя...');
        
        // Обновляем все элементы статистики
        const elements = {
            'user-level-value': this.userData.level || 1,
            'user-coins-value': this.userData.coins || 100,
            'user-exp-value': this.userData.experience || 0,
            'user-lessons-value': this.userData.lessonsCompleted || 0,
            'header-coins': this.userData.coins || 100,
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
            const totalLessons = this.lessonsData.length || 6;
            const completed = this.userData.lessonsCompleted || 0;
            const progress = Math.min(100, (completed / totalLessons) * 100);
            progressBar.style.width = `${progress}%`;
        }
        
        console.log('✅ Статистика обновлена');
    }
    
   updateFarmStats() {
    if (!this.farmData || !this.farmData.cells) {
        console.log('⚠️ Нет farmData для обновления статистики фермы');
        return;
    }
    
    console.log('📈 Обновляем статистику фермы...');
    
    // Пересчитываем статистику
    const stats = {
        clearedLand: this.farmData.cells.filter(cell => 
            cell.type === 'cleared' || cell.type === 'plowed' || 
            cell.type === 'house' || cell.type === 'barn' || 
            cell.type === 'crop' || cell.type === 'water').length,
        buildings: this.farmData.cells.filter(cell => 
            cell.type === 'house' || cell.type === 'barn').length,
        crops: this.farmData.cells.filter(cell => cell.type === 'crop').length,
        water: this.farmData.cells.filter(cell => cell.type === 'water').length
    };
    
    // Сохраняем статистику
    this.farmData.stats = stats;
    
    // Обновляем элементы на странице
    document.getElementById('cleared-land-count').textContent = stats.clearedLand;
    document.getElementById('buildings-count').textContent = stats.buildings;
    document.getElementById('crops-count').textContent = stats.crops;
    
    // Обновляем прогресс-бар фермы
    const progressBar = document.getElementById('farm-progress-bar');
    if (progressBar) {
        // Рассчитываем общий прогресс (максимум 64 клетки)
        const totalProgress = Math.min(100, (stats.clearedLand / 64) * 100);
        progressBar.style.width = `${totalProgress}%`;
    }
    
    console.log('✅ Статистика фермы обновлена:', stats);
}
    
    async startLesson(lessonId) {
        console.log(`🎯 Начинаем урок: ${lessonId}`);
        
        // Находим урок
        const lesson = this.lessonsData.find(l => l.id === lessonId);
        if (!lesson) {
            this.showNotification('❌ Ошибка', 'Урок не найден');
            return;
        }
        
        this.currentLesson = lesson;
        this.showScreen('code');
        
        // Обновляем интерфейс урока
        this.updateLessonInterface();
        
        console.log(`✅ Урок "${lesson.title}" начат`);
    }
    
    updateLessonInterface() {
        if (!this.currentLesson) return;
        
        console.log('🔄 Обновляем интерфейс урока...');
        
        // Обновляем заголовок
        document.getElementById('current-lesson-title').textContent = this.currentLesson.title;
        document.getElementById('current-lesson-desc').textContent = this.currentLesson.description;
        
        // Обновляем теорию
        const theoryEl = document.getElementById('lesson-theory');
        if (theoryEl) {
            theoryEl.innerHTML = `
                <h3 style="color: #2E7D32; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 24px;">📖</span>
                    <span>Теория</span>
                </h3>
                <div style="background: #F9F9F9; padding: 20px; border-radius: 10px; border-left: 4px solid #4CAF50;">
                    ${this.currentLesson.theory || 'Информация о теории урока будет добавлена позже.'}
                </div>
            `;
        }
        
        // Обновляем задание
        const taskEl = document.getElementById('lesson-task');
        if (taskEl) {
            taskEl.innerHTML = `
                <h3 style="color: #2E7D32; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 24px;">🎯</span>
                    <span>Задание</span>
                </h3>
                <div style="background: #FFF3E0; padding: 20px; border-radius: 10px; border-left: 4px solid #FF9800; margin-bottom: 20px;">
                    ${this.currentLesson.task}
                </div>
                
                <div style="background: #E8F5E9; padding: 20px; border-radius: 10px;">
                    <h4 style="color: #2E7D32; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 20px;">📝</span>
                        <span>Пример правильного кода</span>
                    </h4>
                    <pre style="background: white; padding: 15px; border-radius: 8px; overflow-x: auto; margin: 0; font-family: 'Consolas', monospace;">
<code>${this.currentLesson.testCode || '# Пример кода будет здесь'}</code></pre>
                </div>
            `;
        }
        
        // Обновляем код в редакторе
        if (this.codeEditor) {
            this.codeEditor.value = this.currentLesson.initialCode;
            this.codeEditor.style.height = 'auto';
            this.codeEditor.style.height = (this.codeEditor.scrollHeight) + 'px';
        }
        
        // Обновляем подсказки
        this.updateHints();
        
        console.log('✅ Интерфейс урока обновлен');
    }
    
    updateHints() {
        const hintsEl = document.getElementById('hints-container');
        if (!hintsEl || !this.currentLesson) return;
        
        hintsEl.innerHTML = `
            <div style="background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <h3 style="color: #2E7D32; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 24px;">💡</span>
                    <span>Как правильно написать код</span>
                </h3>
                <ul style="margin: 0; padding-left: 20px; color: #666;">
                    <li style="margin-bottom: 8px;">Следуйте <strong>точному</strong> тексту задания</li>
                    <li style="margin-bottom: 8px;">Используйте <strong>двойные кавычки</strong> для текста: print("текст")</li>
                    <li style="margin-bottom: 8px;">Каждая команда должна быть на <strong>новой строке</strong></li>
                    <li style="margin-bottom: 8px;">Проверьте <strong>правильность синтаксиса</strong> Python</li>
                    <li style="margin-bottom: 8px;">Используйте функции и команды из теории урока</li>
                </ul>
                
                <div style="margin-top: 15px; padding: 10px; background: #FFF3E0; border-radius: 8px; border-left: 4px solid #FF9800;">
                    <strong>🔥 Важно:</strong> Код проверяется автоматически. Он должен точно соответствовать заданию!
                </div>
            </div>
        `;
    }
    
    async runCode() {
        console.log('🚀 Запускаем код...');
        
        const code = this.codeEditor?.value;
        if (!code) {
            this.showNotification('⚠️ Внимание', 'Введите код для выполнения');
            return;
        }
        
        const outputEl = document.getElementById('output-text');
        const outputContainer = document.getElementById('output-container');
        
        if (!outputEl || !outputContainer) {
            console.log('⚠️ Не найден output элемент');
            return;
        }
        
        outputEl.textContent = '🚀 Выполняю код...\n\n';
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
                        result += `>>> ${match[1]}\n`;
                    }
                } else if (trimmed.includes('bot_say(')) {
                    const match = trimmed.match(/bot_say\(["'](.+?)["']\)/);
                    if (match) {
                        result += `🤖 Бот: "${match[1]}"\n`;
                    }
                } else if (trimmed && !trimmed.startsWith('#') && trimmed !== '') {
                    result += `[Выполнено] ${trimmed}\n`;
                }
            });
            
            outputEl.textContent += result + '\n✅ Код выполнен успешно!';
            
            // Прокручиваем к результату
            outputContainer.scrollTop = outputContainer.scrollHeight;
            
            console.log('✅ Код выполнен');
            
        } catch (error) {
            console.error('❌ Ошибка выполнения кода:', error);
            outputEl.textContent += `\n❌ Ошибка: ${error.message}`;
        }
    }
    
// Ищем строку с функцией submitCode() и заменяем её
// Примерно строка 1976:
async function submitCode() {
    const codeEditor = document.getElementById('code-editor');
    const code = codeEditor?.value;
    
    if (!code || !currentLesson) {
        showNotification('⚠️ Внимание', 'Сначала выберите урок и напишите код');
        return;
    }
    
    console.log('📤 Отправка кода:', { 
        lesson: currentLesson.id, 
        codeLength: code.length,
        codePreview: code.substring(0, 100) + '...' 
    });
    
    // Проверяем, что код не пустой
    if (!code.trim()) {
        showNotification('❌ Ошибка', 'Введите код для проверки');
        return;
    }
    
    // Показываем загрузку
    showNotification('⏳ Проверка', 'Проверяю ваш код...');
    
    try {
        // Проверяем код локально
        const checkResult = checkCode(code, currentLesson.id);
        console.log('Результат проверки:', checkResult);
        
        if (checkResult.success) {
            // Успешное выполнение
            await completeLesson(currentLesson.id, code);
        } else {
            // Ошибка
            showNotification('❌ Ошибка', checkResult.message || 'Код не соответствует заданию');
            
            // Показываем ошибку в выводе
            const output = document.getElementById('output-text');
            const outputContainer = document.getElementById('output-container');
            if (output && outputContainer) {
                output.textContent = '❌ Ошибка проверки:\n\n' + checkResult.message;
                outputContainer.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Ошибка при проверке кода:', error);
        showNotification('❌ Ошибка', 'Произошла ошибка при проверке кода');
    }
}

// Исправляем функцию checkCode() (примерно строка 1885):
function checkCode(code, lessonId) {
    console.log(`🔍 Проверка кода для урока: ${lessonId}`);
    console.log('📝 Код для проверки:', code);
    
    if (!code || typeof code !== 'string') {
        return { success: false, message: 'Код не найден или не является строкой' };
    }
    
    // Безопасная очистка кода
    let cleanCode;
    try {
        cleanCode = code.toLowerCase().replace(/\s+/g, ' ');
        console.log('🧹 Очищенный код:', cleanCode.substring(0, 150) + '...');
    } catch (error) {
        console.error('Ошибка очистки кода:', error);
        return { success: false, message: 'Ошибка обработки кода' };
    }
    
    // Проверяем код в зависимости от урока
    let passed = false;
    let message = '';
    
    switch(lessonId) {
        case 'lesson_1':
            const hasHello = code.includes('"Привет, АгроБот!"') || code.includes("'Привет, АгроБот!'");
            const hasStart = code.includes('"Начинаю работу!"') || code.includes("'Начинаю работу!'");
            passed = hasHello && hasStart;
            message = passed ? 'Код правильный!' : 'Нужно вывести обе фразы: "Привет, АгроБот!" и "Начинаю работу!"';
            break;
            
        case 'lesson_2':
            const hasVariable = cleanCode.includes('farm_name=') || cleanCode.includes('farm_name =');
            const hasValue = cleanCode.includes('"солнечная долина"') || cleanCode.includes("'солнечная долина'");
            const hasPrint = cleanCode.includes('print(farm_name)');
            passed = hasVariable && hasValue && hasPrint;
            message = passed ? 'Код правильный!' : 'Нужно: 1) farm_name = "Солнечная долина" 2) print(farm_name)';
            break;
            
        case 'lesson_3':
            const hasDef = cleanCode.includes('def start_tractor():');
            const hasPrintInside = cleanCode.includes('print("запускаю трактор")') || 
                                   cleanCode.includes("print('запускаю трактор')");
            const hasCall = cleanCode.includes('start_tractor()');
            passed = hasDef && hasPrintInside && hasCall;
            message = passed ? 'Код правильный!' : 'Нужно: 1) def start_tractor(): 2) print("Запускаю трактор") внутри 3) Вызов start_tractor()';
            break;
            
        case 'lesson_4':
            const hasDef2 = cleanCode.includes('def build_house(') && cleanCode.includes('material');
            const hasPrint2 = cleanCode.includes('print(') && 
                             (cleanCode.includes('строю дом из') || cleanCode.includes('f"строю дом из'));
            passed = hasDef2 && hasPrint2;
            message = passed ? 'Код правильный!' : 'Нужно: def build_house(material): с выводом "Строю дом из [material]"';
            break;
            
        case 'lesson_5':
            const hasFor = cleanCode.includes('for ') && cleanCode.includes('range(3)');
            const hasPrint3 = cleanCode.includes('print("сажаю растение")') || 
                             cleanCode.includes("print('сажаю растение')");
            passed = hasFor && hasPrint3;
            message = passed ? 'Код правильный!' : 'Нужно: for i in range(3): с print("Сажаю растение") внутри';
            break;
            
        case 'lesson_6':
            const hasIf = cleanCode.includes('if ') && cleanCode.includes('soil_moisture') && cleanCode.includes('< 50');
            const hasPrint4 = cleanCode.includes('print("поливаю растения")') || 
                             cleanCode.includes("print('поливаю растения')");
            passed = hasIf && hasPrint4;
            message = passed ? 'Код правильный!' : 'Нужно: if soil_moisture < 50: с print("Поливаю растения") внутри';
            break;
            
        default:
            // Для остальных уроков - простая проверка
            passed = code.length > 10 && code.includes('print');
            message = passed ? 'Код правильный!' : 'Код должен содержать команду print()';
    }
    
    console.log(`✅ Проверка завершена: ${passed ? 'ПРОШЕЛ' : 'НЕ ПРОШЕЛ'}`, { passed, message });
    return { success: passed, message: message };
}

// Улучшаем функцию completeLesson()
async function completeLesson(lessonId, code) {
    console.log(`✅ Завершаем урок: ${lessonId}`);
    
    try {
        const lesson = lessonsData.find(l => l.id === lessonId);
        if (!lesson) {
            throw new Error('Урок не найден');
        }
        
        const rewardCoins = lesson.rewardCoins || 50;
        const rewardExp = lesson.rewardExp || 100;
        
        // Показываем уведомление
        showNotification('🎉 Урок пройден!', 
            `${lesson.title} пройден!\n` +
            `Награда: ${rewardCoins} монет\n` +
            `Опыт: +${rewardExp}`);
        
        // Обновляем данные пользователя
        if (userData) {
            // Проверяем, не был ли урок уже пройден
            if (!userData.completedLessonIds) {
                userData.completedLessonIds = [];
            }
            
            const alreadyCompleted = userData.completedLessonIds.includes(lessonId);
            
            if (!alreadyCompleted) {
                // Обновляем данные
                userData.coins = (userData.coins || 100) + rewardCoins;
                userData.experience = (userData.experience || 0) + rewardExp;
                userData.lessonsCompleted = (userData.lessonsCompleted || 0) + 1;
                userData.completedLessonIds.push(lessonId);
                
                // Проверяем уровень
                const oldLevel = userData.level || 1;
                const newLevel = Math.max(1, Math.floor((userData.experience || 0) / 1000) + 1);
                
                if (newLevel > oldLevel) {
                    userData.level = newLevel;
                    showNotification('⭐ Новый уровень!', `Вы достигли уровня ${newLevel}!`);
                }
                
                // Обновляем статистику
                updateUserStats();
                
                // Перерисовываем уроки
                renderLessons();
                
                // Применяем изменения на ферме
                applyFarmChanges(lessonId);
                
                // Анимация успеха
                playSuccessAnimation();
                
                // Сохраняем прогресс
                saveProgress(lessonId, code);
                
                console.log('✅ Урок успешно завершен со всеми изменениями');
            } else {
                showNotification('ℹ️ Уже пройден', 'Этот урок уже был пройден ранее');
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка завершения урока:', error);
        showNotification('❌ Ошибка', 'Не удалось завершить урок: ' + error.message);
    }
}

// Упрощаем функцию applyFarmChanges()
function applyFarmChanges(lessonId) {
    console.log(`🌾 Применяем изменения на ферме для урока: ${lessonId}`);
    
    if (!farmData || !farmData.cells) {
        console.log('⚠️ Нет данных фермы');
        return;
    }
    
    // Находим доступные клетки
    let cellsToUpdate = [];
    let message = '';
    let emoji = '✨';
    
    switch(lessonId) {
        case 'lesson_1':
            // Расчистка 10 случайных участков травы
            emoji = '🧹';
            message = 'Расчищено 10 участков! Теперь можно строить.';
            
            const grassCells = farmData.cells.filter(cell => cell.type === 'grass');
            const shuffledGrass = [...grassCells].sort(() => Math.random() - 0.5);
            cellsToUpdate = shuffledGrass.slice(0, Math.min(10, grassCells.length));
            
            cellsToUpdate.forEach(cell => {
                cell.type = 'cleared';
                cell.emoji = '🟫';
                cell.title = 'Расчищенная земля';
            });
            break;
            
        case 'lesson_2':
            // Вспашка 8 расчищенных участков
            emoji = '🚜';
            message = 'Вспахано 8 участков! Готово для посадки.';
            
            const clearedCells = farmData.cells.filter(cell => cell.type === 'cleared');
            const shuffledCleared = [...clearedCells].sort(() => Math.random() - 0.5);
            cellsToUpdate = shuffledCleared.slice(0, Math.min(8, clearedCells.length));
            
            cellsToUpdate.forEach(cell => {
                cell.type = 'plowed';
                cell.emoji = '🟨';
                cell.title = 'Вспаханное поле';
            });
            break;
            
        case 'lesson_3':
            // Строительство дома
            emoji = '🏠';
            message = 'Построен дом! Теперь у вас есть жилье на ферме.';
            
            // Ищем центральную клетку
            const centerX = Math.floor(4); // Для 8x8 сетки
            const centerY = Math.floor(4);
            
            const centerCell = farmData.cells.find(cell => 
                cell.x === centerX && cell.y === centerY && 
                (cell.type === 'cleared' || cell.type === 'plowed')
            );
            
            if (centerCell) {
                cellsToUpdate = [centerCell];
                centerCell.type = 'house';
                centerCell.emoji = '🏠';
                centerCell.title = 'Дом фермера';
            }
            break;
            
        case 'lesson_4':
            // Строительство сарая
            emoji = '🏚️';
            message = 'Построен сарай! Можно хранить инструменты.';
            
            // Ищем дом
            const houseCell = farmData.cells.find(cell => cell.type === 'house');
            if (houseCell) {
                // Ищем соседнюю клетку
                const nearbyCells = farmData.cells.filter(cell => 
                    Math.abs(cell.x - houseCell.x) <= 1 &&
                    Math.abs(cell.y - houseCell.y) <= 1 &&
                    cell.type !== 'house' &&
                    (cell.type === 'cleared' || cell.type === 'plowed')
                );
                
                if (nearbyCells.length > 0) {
                    const barnCell = nearbyCells[0];
                    cellsToUpdate = [barnCell];
                    barnCell.type = 'barn';
                    barnCell.emoji = '🏚️';
                    barnCell.title = 'Сарай';
                }
            }
            break;
            
        case 'lesson_5':
            // Посадка культур
            emoji = '🌱';
            message = 'Посадены первые культуры! Скоро будет урожай.';
            
            const plowedCells = farmData.cells.filter(cell => cell.type === 'plowed');
            const shuffledPlowed = [...plowedCells].sort(() => Math.random() - 0.5);
            cellsToUpdate = shuffledPlowed.slice(0, Math.min(10, plowedCells.length));
            
            const cropTypes = [
                { emoji: '🌾', title: 'Пшеница' },
                { emoji: '🥕', title: 'Морковь' },
                { emoji: '🥔', title: 'Картофель' }
            ];
            
            cellsToUpdate.forEach(cell => {
                const crop = cropTypes[Math.floor(Math.random() * cropTypes.length)];
                cell.type = 'crop';
                cell.emoji = crop.emoji;
                cell.title = crop.title;
            });
            break;
            
        case 'lesson_6':
            // Добавление воды
            emoji = '💧';
            message = 'Добавлен источник воды! Можно поливать растения.';
            
            // Ищем клетку на краю
            const edgeCells = farmData.cells.filter(cell => 
                (cell.x === 0 || cell.x === 7 || cell.y === 0 || cell.y === 7) &&
                (cell.type === 'grass' || cell.type === 'cleared')
            );
            
            if (edgeCells.length > 0) {
                const waterCell = edgeCells[0];
                cellsToUpdate = [waterCell];
                waterCell.type = 'water';
                waterCell.emoji = '💧';
                waterCell.title = 'Источник воды';
            }
            break;
    }
    
    // Перерисовываем ферму
    renderFarm();
    
    // Обновляем статистику фермы
    updateFarmStats();
    
    // Показываем уведомление
    if (message) {
        showNotification(emoji, message);
    }
    
    console.log(`✅ Изменения применены: ${cellsToUpdate.length} клеток обновлены`);
}

// Добавляем недостающие функции
function renderFarm() {
    const farmGrid = document.getElementById('farm-grid');
    if (!farmGrid || !farmData) return;
    
    farmGrid.innerHTML = '';
    
    // Создаем сетку 8x8
    farmGrid.style.gridTemplateColumns = 'repeat(8, 1fr)';
    farmGrid.style.gridTemplateRows = 'repeat(8, 1fr)';
    
    // Сортируем клетки по координатам
    const sortedCells = [...farmData.cells].sort((a, b) => {
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
    });
    
    sortedCells.forEach((cell, index) => {
        const cellDiv = document.createElement('div');
        cellDiv.className = `farm-cell ${cell.type} fade-in`;
        cellDiv.dataset.x = cell.x;
        cellDiv.dataset.y = cell.y;
        
        cellDiv.innerHTML = `
            <div class="farm-cell-content">${cell.emoji || '🌿'}</div>
            <div class="farm-cell-coords">${cell.x},${cell.y}</div>
        `;
        
        cellDiv.title = cell.title || 'Клетка фермы';
        
        // Цвета в зависимости от типа
        const colors = {
            'grass': '#2E7D32',
            'cleared': '#8D6E63',
            'plowed': '#FFD54F',
            'house': '#FF9800',
            'barn': '#795548',
            'crop': '#8BC34A',
            'water': '#2196F3',
            'road': '#9E9E9E'
        };
        
        if (colors[cell.type]) {
            cellDiv.style.backgroundColor = colors[cell.type];
        }
        
        // Обработчик клика
        cellDiv.addEventListener('click', () => {
            handleFarmCellClick(cell.x, cell.y, cell.type);
        });
        
        farmGrid.appendChild(cellDiv);
    });
}

function updateFarmStats() {
    if (!farmData || !farmData.cells) return;
    
    const stats = {
        cleared: farmData.cells.filter(c => c.type !== 'grass').length,
        buildings: farmData.cells.filter(c => c.type === 'house' || c.type === 'barn').length,
        crops: farmData.cells.filter(c => c.type === 'crop').length
    };
    
    document.getElementById('cleared-land-count').textContent = stats.cleared;
    document.getElementById('buildings-count').textContent = stats.buildings;
    document.getElementById('crops-count').textContent = stats.crops;
    document.getElementById('lessons-count').textContent = userData?.lessonsCompleted || 0;
    
    // Обновляем прогресс-бар
    const progressBar = document.getElementById('farm-progress-bar');
    if (progressBar) {
        const progress = (stats.cleared / 64) * 100;
        progressBar.style.width = `${progress}%`;
    }
}

function playSuccessAnimation() {
    // Простая анимация
    const submitBtn = document.getElementById('submit-code-btn');
    if (submitBtn) {
        submitBtn.classList.add('pulse');
        setTimeout(() => submitBtn.classList.remove('pulse'), 2000);
    }
    
    // Показываем конфетти
    showConfetti();
}

function showConfetti() {
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#FFA500', '#C7F464'];
    
    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.style.cssText = `
            position: fixed;
            width: ${Math.random() * 10 + 5}px;
            height: ${Math.random() * 10 + 5}px;
            background: ${colors[Math.floor(Math.random() * colors.length)]};
            top: -10px;
            left: ${Math.random() * 100}vw;
            z-index: 1000;
            animation: confetti 3s linear forwards;
            border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
        `;
        
        // Добавляем CSS анимацию
        if (!document.querySelector('#confetti-animation')) {
            const style = document.createElement('style');
            style.id = 'confetti-animation';
            style.textContent = `
                @keyframes confetti {
                    0% { transform: translateY(0) rotate(0deg); opacity: 1; }
                    100% { transform: translateY(100vh) rotate(360deg); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(confetti);
        
        // Удаляем через 3 секунды
        setTimeout(() => {
            if (confetti.parentNode) {
                confetti.parentNode.removeChild(confetti);
            }
        }, 3000);
    }
}

function saveProgress(lessonId, code) {
    try {
        // Сохраняем в localStorage
        const progress = {
            userId: currentUserId,
            lessonId: lessonId,
            code: code,
            completedAt: new Date().toISOString(),
            userData: userData
        };
        
        localStorage.setItem(`codefarm_progress_${currentUserId}_${lessonId}`, JSON.stringify(progress));
        
        // Сохраняем общий прогресс
        let userProgress = JSON.parse(localStorage.getItem(`codefarm_user_${currentUserId}`) || '{}');
        userProgress.completedLessons = userProgress.completedLessons || [];
        if (!userProgress.completedLessons.includes(lessonId)) {
            userProgress.completedLessons.push(lessonId);
        }
        userProgress.lastActivity = new Date().toISOString();
        localStorage.setItem(`codefarm_user_${currentUserId}`, JSON.stringify(userProgress));
        
        console.log('💾 Прогресс сохранен');
    } catch (error) {
        console.error('❌ Ошибка сохранения:', error);
    }
}
        
        // Если есть API, отправляем данные на сервер
        if (window.Telegram?.WebApp) {
            try {
                const response = await fetch('/api/progress', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: this.userId,
                        lessonId: lessonId,
                        code: code,
                        completed: true
                    })
                });
                
                if (response.ok) {
                    console.log('✅ Прогресс сохранен на сервере');
                }
            } catch (error) {
                console.log('⚠️ Не удалось сохранить прогресс на сервере, продолжаем в демо-режиме');
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка сохранения прогресса:', error);
    }
}
    
    // Вспомогательная функция для получения случайных клеток
    getRandomCells(type, count) {
        const filteredCells = this.farmData.cells.filter(cell => cell.type === type);
        
        // Перемешиваем массив и берем нужное количество
        return [...filteredCells]
            .sort(() => Math.random() - 0.5)
            .slice(0, Math.min(count, filteredCells.length));
    }
    
    applyFarmUpdate(farmUpdate) {
        console.log('🔄 Применяем обновление фермы:', farmUpdate);
        
        // Визуальные эффекты в зависимости от действия
        let emoji = '✨';
        let message = 'Ферма обновлена!';
        
        switch(farmUpdate.action) {
            case 'clear_land':
                emoji = '🧹';
                message = 'Участок расчищен!';
                break;
            case 'build_house':
                emoji = '🏠';
                message = 'Дом построен!';
                break;
            case 'plant_crop':
                emoji = '🌱';
                message = 'Растения посажены!';
                break;
            case 'water_crops':
                emoji = '💧';
                message = 'Растения политы!';
                break;
        }
        
        this.showNotification(emoji, message);
        
        // Анимация на ферме
        const farmGrid = document.getElementById('farm-grid');
        if (farmGrid) {
            const cells = farmGrid.querySelectorAll('.farm-cell');
            cells.forEach(cell => {
                cell.classList.add('pulse');
                setTimeout(() => {
                    cell.classList.remove('pulse');
                }, 1000);
            });
        }
        
        console.log('✅ Обновление фермы применено');
    }
    
    handleFarmClick(x, y, cellData) {
        console.log(`📍 Клик по клетке фермы: (${x}, ${y})`, cellData);
        
        let message = `Клетка (${x}, ${y})\n`;
        let emoji = cellData?.emoji || '📍';
        
        if (cellData) {
            switch(cellData.type) {
                case 'grass':
                    message += '🌿 Заросший участок.\n';
                    message += 'Пройдите Урок 1: "Первые команды боту", чтобы расчистить землю!';
                    break;
                case 'cleared':
                    message += '🟫 Расчищенная земля.\n';
                    message += 'Готова для строительства или посадки растений. Пройдите Урок 2 для вспашки.';
                    break;
                case 'plowed':
                    message += '🟨 Вспаханное поле.\n';
                    message += 'Идеально подготовлено для посадки культур. Пройдите Урок 5 для посадки.';
                    break;
                case 'house':
                    message += '🏠 Дом фермера.\n';
                    message += 'Главное здание вашей фермы. Здесь вы планируете работу и отдыхаете.';
                    break;
                case 'barn':
                    message += '🏚️ Сарай.\n';
                    message += 'Хранилище для инструментов и урожая.';
                    break;
                case 'crop':
                    message += `${cellData.emoji} ${cellData.title || 'Культура'}.\n`;
                    message += `Рост: ${cellData.growth || 0}%.\n`;
                    message += cellData.growth >= 80 ? 'Готов к сбору!' : 'Растет...';
                    break;
                case 'water':
                    message += '💧 Источник воды.\n';
                    message += 'Необходим для полива растений и содержания животных.';
                    break;
                default:
                    message += 'Неизвестный тип клетки.';
            }
        } else {
            message += 'Заросший участок. Пройдите уроки, чтобы развивать ферму.';
        }
        
        this.showNotification(emoji, message);
    }
    
    handleQuickAction(action) {
        console.log(`⚡ Быстрое действие: ${action}`);
        
        switch(action) {
            case 'start_lesson_1':
                this.startLesson('lesson_1');
                break;
            case 'show_lessons':
                this.showScreen('lessons');
                break;
            case 'sell_produce':
                this.sellProduce();
                break;
            case 'show_code':
                this.showScreen('code');
                break;
            default:
                console.log(`⚠️ Неизвестное действие: ${action}`);
        }
    }
    
    handleFarmAction(action) {
        console.log(`🌾 Действие на ферме: ${action}`);
        
        switch(action) {
            case 'water':
                this.waterCrops();
                break;
            case 'harvest':
                this.harvestCrops();
                break;
            case 'plant':
                this.plantCrop();
                break;
            case 'build':
                this.buildHouse();
                break;
            case 'upgrade':
                this.upgradeFarm();
                break;
            default:
                console.log(`⚠️ Неизвестное действие на ферме: ${action}`);
        }
    }
    
    waterCrops() {
        console.log('💧 Поливаем растения...');
        this.showNotification('💧 Полив', 'Все растения политы! Рост ускорен.');
        
        // Обновляем ферму
        if (this.farmData) {
            this.farmData.cells.forEach(cell => {
                if (cell.type === 'crop' && cell.growth < 100) {
                    cell.growth = Math.min(100, (cell.growth || 0) + 20);
                    cell.title = `${cell.title?.split('(')[0] || 'Культура'} (рост: ${cell.growth}%)`;
                }
            });
            this.renderFarm();
        }
    }
    
    harvestCrops() {
        console.log('📦 Собираем урожай...');
        
        let harvested = 0;
        if (this.farmData) {
            this.farmData.cells.forEach(cell => {
                if (cell.type === 'crop' && cell.growth >= 80) {
                    harvested++;
                    cell.type = 'cleared';
                    cell.emoji = '🟫';
                    cell.color = '#8D6E63';
                    cell.title = 'Очищенная земля';
                    cell.growth = null;
                }
            });
        }
        
        if (harvested > 0) {
            const coins = harvested * 15;
            this.showNotification('📦 Урожай собран!', 
                `Собрано ${harvested} культур\n` +
                `Получено ${coins} монет`);
            
            if (this.userData) {
                this.userData.coins += coins;
                this.updateUserStats();
            }
            
            this.renderFarm();
        } else {
            this.showNotification('⚠️ Нечего собирать', 'Растения еще не созрели. Поливайте их!');
        }
    }
    
    plantCrop() {
        console.log('🌱 Сажаем растения...');
        
        // Находим первую вспаханную клетку
        if (this.farmData) {
            const emptyCell = this.farmData.cells.find(cell => 
                cell.type === 'plowed'
            );
            
            if (emptyCell) {
                emptyCell.type = 'crop';
                emptyCell.emoji = '🌾';
                emptyCell.color = '#FFD54F';
                emptyCell.growth = 10;
                emptyCell.title = 'Пшеница (рост: 10%)';
                
                this.showNotification('🌱 Посадка', 'Пшеница посажена! Через 3 дня будет урожай.');
                
                if (this.userData && this.userData.coins >= 10) {
                    this.userData.coins -= 10;
                    this.updateUserStats();
                }
                
                this.renderFarm();
            } else {
                this.showNotification('⚠️ Нет места', 'Нет вспаханной земли для посадки! Пройдите уроки 2 и 5.');
            }
        }
    }
    
    buildHouse() {
        console.log('🏠 Строим дом...');
        
        if (this.userData && this.userData.coins >= 100) {
            this.userData.coins -= 100;
            this.updateUserStats();
            
            this.showNotification('🏠 Строительство', 'Дом построен! Теперь у вас есть жилье на ферме.');
            
            // Обновляем ферму
            if (this.farmData) {
                // Находим центральную клетку
                const centerCell = this.farmData.cells.find(cell => 
                    cell.x === 3 && cell.y === 3 && cell.type !== 'house'
                );
                
                if (centerCell) {
                    centerCell.type = 'house';
                    centerCell.emoji = '🏠';
                    centerCell.color = '#FF9800';
                    centerCell.title = 'Дом фермера';
                    this.renderFarm();
                }
            }
        } else {
            this.showNotification('⚠️ Недостаточно монет', 'Для строительства дома нужно 100 монет.');
        }
    }
    
    upgradeFarm() {
        console.log('⬆️ Улучшаем ферму...');
        this.showNotification('🔄 В разработке', 'Эта функция скоро будет доступна!');
    }
    
    sellProduce() {
        console.log('💰 Продаем продукцию...');
        
        const saleAmount = Math.floor(Math.random() * 100) + 50;
        this.showNotification('💰 Продажа', `Вы продали продукцию за ${saleAmount} монет!`);
        
        if (this.userData) {
            this.userData.coins += saleAmount;
            this.updateUserStats();
        }
    }
    
    clearOutput() {
        const outputEl = document.getElementById('output-text');
        if (outputEl) {
            outputEl.textContent = '';
            console.log('🧹 Очищен вывод кода');
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
            outputContainer.scrollTop = outputContainer.scrollHeight;
        }
    }
    
    showNotification(title, message) {
        console.log(`🔔 Уведомление: ${title} - ${message}`);
        
        // Создаем элемент уведомления
        const notification = document.createElement('div');
        notification.className = 'notification';
        
        notification.innerHTML = `
            <div class="notification-icon">${title.split(' ')[0]}</div>
            <div class="notification-content">
                <strong>${title}</strong>
                <p>${message.replace(/\n/g, '<br>')}</p>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Автоматическое скрытие
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 4000);
    }
    
    showError(message) {
        this.showNotification('❌ Ошибка', message);
    }
    
    playSuccessAnimation() {
    console.log('🎉 Играем анимацию успеха...');
    
    // Создаем элемент анимации успеха
    const successEl = document.createElement('div');
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
    successEl.textContent = '🎉';
    
    document.body.appendChild(successEl);
    
    // Создаем конфетти
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#FFA500', '#C7F464'];
    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.cssText = `
            left: ${Math.random() * 100}vw;
            --color: ${colors[Math.floor(Math.random() * colors.length)]};
            animation-delay: ${Math.random() * 2}s;
            width: ${Math.random() * 10 + 5}px;
            height: ${Math.random() * 10 + 5}px;
            border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
        `;
        document.body.appendChild(confetti);
        
        // Удаляем конфетти после анимации
        setTimeout(() => {
            if (confetti.parentNode) {
                confetti.parentNode.removeChild(confetti);
            }
        }, 3000);
    }
    
    // Удаляем основной элемент после анимации
    setTimeout(() => {
        if (successEl.parentNode) {
            successEl.parentNode.removeChild(successEl);
        }
    }, 1500);
    
    // Добавляем вибрацию (если поддерживается)
    if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100]);
    }
}

// Создаем глобальный объект приложения
window.codeFarmApp = null;

// Делаем функции глобально доступными для HTML
window.showScreen = (screenName) => {
    if (window.codeFarmApp) {
        window.codeFarmApp.showScreen(screenName);
    }
};

window.runCode = () => {
    if (window.codeFarmApp) {
        window.codeFarmApp.runCode();
    }
};

window.submitCode = () => {
    if (window.codeFarmApp) {
        window.codeFarmApp.submitSolution();
    }
};

window.startLesson = (lessonId) => {
    if (window.codeFarmApp) {
        window.codeFarmApp.startLesson(lessonId);
    }
};

window.clearOutput = () => {
    if (window.codeFarmApp) {
        window.codeFarmApp.clearOutput();
    }
};

// Запускаем приложение при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM загружен, запускаем CodeFarm...');
    
    // Скрываем экран загрузки
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.style.display = 'none';
    }
    
    // Запускаем приложение
    window.codeFarmApp = new CodeFarmApp();
    
    console.log('✅ CodeFarm запущен и готов к работе!');
});
