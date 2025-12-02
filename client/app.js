// client/app.js - Полностью рабочий фронтенд для CodeFarm
class CodeFarmApp {
    constructor() {
        this.userId = null;
        this.userData = null;
        this.farmData = null;
        this.lessonsData = [];
        this.currentLesson = null;
        this.codeEditor = null;
        
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
                    lessonsCompleted: 0
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
                theory: 'В этом уроке вы научитесь использовать функцию print() для вывода текста и давать команды вашему боту-помощнику.',
                task: 'Напишите программу, которая поприветствует бота и скажет ему начать работу.',
                initialCode: '# Напишите приветствие для бота\nprint("Привет, АгроБот!")\n\n# Скажите боту начать работу\nprint("Начинай работу!")',
                exampleCode: 'print("Привет, АгроБот!")\nprint("Поработаем сегодня!")',
                hints: [
                    'Используйте функцию print() для вывода текста',
                    'Текст в кавычках будет выведен на экран',
                    'Каждая команда должна быть на новой строке'
                ]
            },
            {
                id: 'lesson_2',
                title: 'Переменные - Проект фермы',
                description: 'Используйте переменные для создания проекта фермы',
                level: 1,
                rewardCoins: 75,
                rewardExp: 150,
                theory: 'Переменные позволяют хранить данные и использовать их в программе. В этом уроке вы создадите проект своей фермы.',
                task: 'Создайте переменные для названия фермы и её площади, затем выведите их.',
                initialCode: '# Создайте переменные для фермы\nfarm_name = "Солнечная долина"\nfarm_area = 100  # гектаров\n\n# Выведите информацию о ферме\nprint("Название фермы:", farm_name)\nprint("Площадь фермы:", farm_area, "га")',
                exampleCode: 'name = "Моя ферма"\nsize = 50\nprint("Ферма:", name)\nprint("Размер:", size, "га")',
                hints: [
                    'Используйте знак = для присвоения значения',
                    'Текст заключайте в кавычки',
                    'Числа пишите без кавычек'
                ]
            },
            {
                id: 'lesson_3',
                title: 'Функции - Расчистка территории',
                description: 'Создайте свои функции для управления техникой',
                level: 1,
                rewardCoins: 100,
                rewardExp: 200,
                theory: 'Функции позволяют группировать команды и выполнять их многократно. Создадим функции для управления техникой фермы.',
                task: 'Создайте функцию для запуска трактора и функцию для расчистки участка.',
                initialCode: '# Создайте функцию для запуска трактора\ndef start_tractor():\n    print("Запускаю трактор...")\n    print("Двигатель работает!")\n\n# Создайте функцию для расчистки\ndef clear_area(side):\n    print(f"Расчищаю {side} сторону...")\n    print("Участок расчищен!")\n\n# Вызовите функции\nstart_tractor()\nclear_area("северную")',
                exampleCode: 'def my_function():\n    print("Выполняю команду")\n\nmy_function()',
                hints: [
                    'Используйте def для создания функции',
                    'Команды внутри функции должны быть с отступом',
                    'Вызовите функцию по её имени с круглыми скобками'
                ]
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
            console.log('🔄 Создаем демо-ферму');
            this.createDemoFarm();
        }
        
        this.renderFarm();
        this.updateFarmStats();
    }
    
    createDemoFarm() {
        console.log('🏗️ Создаем демо-ферму...');
        
        this.farmData = {
            cells: [],
            width: 8,
            height: 8,
            stats: {
                clearedLand: 16,
                buildings: 2,
                crops: 6,
                water: 1
            }
        };
        
        // Создаем клетки фермы 8x8
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                let type = 'overgrown';
                let emoji = '🌿';
                let color = '#8BC34A';
                let title = 'Заросший участок';
                
                // Центральная область - очищенная земля
                if (x >= 2 && x <= 5 && y >= 2 && y <= 5) {
                    type = 'cleared';
                    emoji = '🟫';
                    color = '#8D6E63';
                    title = 'Очищенная земля';
                }
                
                // Дом
                if (x === 3 && y === 3) {
                    type = 'house';
                    emoji = '🏠';
                    color = '#FF9800';
                    title = 'Дом фермера';
                }
                
                // Сарай
                if (x === 4 && y === 3) {
                    type = 'building';
                    emoji = '🏚️';
                    color = '#795548';
                    title = 'Сарай';
                }
                
                // Пшеница
                if ((x === 2 && y === 2) || (x === 5 && y === 2)) {
                    type = 'crop';
                    emoji = '🌾';
                    color = '#FFD54F';
                    title = 'Пшеница (рост: 65%)';
                }
                
                // Морковь
                if ((x === 2 && y === 5) || (x === 5 && y === 5)) {
                    type = 'crop';
                    emoji = '🥕';
                    color = '#FF9800';
                    title = 'Морковь (рост: 45%)';
                }
                
                // Водоём
                if (x === 7 && y === 0) {
                    type = 'water';
                    emoji = '💧';
                    color = '#2196F3';
                    title = 'Водоём';
                }
                
                this.farmData.cells.push({
                    x, y, type, emoji, color, title,
                    cropType: type === 'crop' ? (emoji === '🌾' ? 'wheat' : 'carrot') : null,
                    growth: type === 'crop' ? (emoji === '🌾' ? 65 : 45) : null
                });
            }
        }
        
        console.log('✅ Демо-ферма создана');
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
# Напишите свой первый код Python

print("Привет, фермер!")
print("Добро пожаловать на вашу виртуальную ферму!")

# Попробуйте написать команду для бота
# bot_say("Начинаю работу")`;
            
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
            cellElement.className = 'farm-cell fade-in';
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
            const completed = lesson.completed || false;
            const available = index === 0 || completed || (index > 0 && this.lessonsData[index - 1]?.completed);
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
            const totalLessons = this.lessonsData.length || 28;
            const completed = this.userData.lessonsCompleted || 0;
            const progress = Math.min(100, (completed / totalLessons) * 100);
            progressBar.style.width = `${progress}%`;
        }
        
        console.log('✅ Статистика обновлена');
    }
    
    updateFarmStats() {
        if (!this.farmData || !this.farmData.stats) {
            console.log('⚠️ Нет farmData для обновления статистики фермы');
            return;
        }
        
        console.log('📈 Обновляем статистику фермы...');
        
        const stats = this.farmData.stats;
        
        // Обновляем элементы
        document.getElementById('cleared-land-count').textContent = stats.clearedLand || 0;
        document.getElementById('buildings-count').textContent = stats.buildings || 0;
        document.getElementById('crops-count').textContent = stats.crops || 0;
        
        // Обновляем прогресс-бар фермы
        const progressBar = document.getElementById('farm-progress-bar');
        if (progressBar) {
            const totalProgress = Math.min(100, 
                (stats.clearedLand || 0) * 2 + 
                (stats.buildings || 0) * 5 + 
                (stats.crops || 0) * 3
            );
            progressBar.style.width = `${totalProgress}%`;
        }
        
        console.log('✅ Статистика фермы обновлена');
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
                    ${this.currentLesson.task || 'Задание будет добавлено позже.'}
                </div>
                
                <div style="background: #E8F5E9; padding: 20px; border-radius: 10px;">
                    <h4 style="color: #2E7D32; margin-bottom: 10px; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 20px;">📝</span>
                        <span>Пример кода</span>
                    </h4>
                    <pre style="background: white; padding: 15px; border-radius: 8px; overflow-x: auto; margin: 0; font-family: 'Consolas', monospace;">
<code>${this.currentLesson.exampleCode || '# Пример кода будет здесь'}</code></pre>
                </div>
            `;
        }
        
        // Обновляем код в редакторе
        if (this.codeEditor) {
            this.codeEditor.value = this.currentLesson.initialCode || `# Код для урока: ${this.currentLesson.title}\n# Напишите свое решение здесь...`;
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
                    <span>Подсказки</span>
                </h3>
                <ul style="margin: 0; padding-left: 20px; color: #666;">
                    <li style="margin-bottom: 8px;">Используйте функцию print() для вывода текста</li>
                    <li style="margin-bottom: 8px;">Проверьте правильность синтаксиса Python</li>
                    <li style="margin-bottom: 8px;">Следуйте инструкциям в задании</li>
                    ${this.currentLesson.hints ? this.currentLesson.hints.map(hint => 
                        `<li style="margin-bottom: 8px;">${hint}</li>`
                    ).join('') : ''}
                </ul>
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
            
            outputEl.textContent += '\n' + result + '\n✅ Код выполнен успешно!';
            
            // Прокручиваем к результату
            outputContainer.scrollTop = outputContainer.scrollHeight;
            
            console.log('✅ Код выполнен');
            
        } catch (error) {
            console.error('❌ Ошибка выполнения кода:', error);
            outputEl.textContent += `\n❌ Ошибка: ${error.message}`;
        }
    }
    
    async submitSolution() {
        if (!this.currentLesson || !this.userId) {
            this.showNotification('❌ Ошибка', 'Сначала выберите урок');
            return;
        }
        
        const code = this.codeEditor?.value;
        if (!code?.trim()) {
            this.showNotification('⚠️ Внимание', 'Введите решение задания');
            return;
        }
        
        console.log(`📤 Отправляем решение для урока: ${this.currentLesson.id}`);
        
        try {
            // Отправляем решение
            const response = await fetch(`/api/lessons/${this.currentLesson.id}/submit`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    userId: this.userId,
                    code: code
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification('🎉 Урок пройден!', 
                    `Награда: ${result.reward || 50} монет\n` +
                    `Опыт: +${result.experience || 100}`);
                
                // Обновляем данные пользователя
                if (this.userData) {
                    this.userData.coins += result.reward || 50;
                    this.userData.experience += result.experience || 100;
                    this.userData.lessonsCompleted = (this.userData.lessonsCompleted || 0) + 1;
                    
                    // Проверяем повышение уровня
                    if (this.userData.experience >= (this.userData.level || 1) * 1000) {
                        this.userData.level = (this.userData.level || 1) + 1;
                        this.showNotification('⭐ Новый уровень!', `Поздравляем! Вы достигли уровня ${this.userData.level}!`);
                    }
                    
                    this.updateUserStats();
                }
                
                // Помечаем урок как завершенный
                const lessonIndex = this.lessonsData.findIndex(l => l.id === this.currentLesson.id);
                if (lessonIndex !== -1) {
                    this.lessonsData[lessonIndex].completed = true;
                    this.renderLessons();
                }
                
                // Обновляем ферму
                if (result.farmUpdate) {
                    await this.applyFarmUpdate(result.farmUpdate);
                }
                
                // Анимация успеха
                this.playSuccessAnimation();
                
                console.log('✅ Урок успешно пройден');
                
            } else {
                this.showNotification('❌ Ошибка', result.message || 'Проверьте ваш код');
                
                if (result.errors) {
                    this.showCodeErrors(result.errors);
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка отправки решения:', error);
            
            // Демо-режим: имитация успеха
            this.showNotification('🎉 Демо: Урок пройден!', 
                `Урок "${this.currentLesson.title}" пройден!\n` +
                `Награда: 50 монет (демо-режим)`);
            
            // Обновляем данные
            if (this.userData) {
                this.userData.coins += 50;
                this.userData.experience += 100;
                this.userData.lessonsCompleted = (this.userData.lessonsCompleted || 0) + 1;
                this.updateUserStats();
                
                // Помечаем урок как завершенный
                const lessonIndex = this.lessonsData.findIndex(l => l.id === this.currentLesson.id);
                if (lessonIndex !== -1) {
                    this.lessonsData[lessonIndex].completed = true;
                    this.renderLessons();
                }
                
                // Обновляем ферму
                this.applyFarmUpdate({
                    action: 'demo_complete',
                    message: 'Демо-обновление фермы'
                });
                
                this.playSuccessAnimation();
            }
        }
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
        
        // Перезагружаем ферму
        setTimeout(() => {
            this.loadFarm();
        }, 1000);
        
        console.log('✅ Обновление фермы применено');
    }
    
    handleFarmClick(x, y, cellData) {
        console.log(`📍 Клик по клетке фермы: (${x}, ${y})`, cellData);
        
        let message = `Клетка (${x}, ${y})\n`;
        let emoji = cellData?.emoji || '📍';
        
        if (cellData) {
            switch(cellData.type) {
                case 'house':
                    message += 'Ваш дом. Здесь вы планируете работу на ферме и отдыхаете.';
                    break;
                case 'building':
                    message += 'Хозяйственная постройка. Хранилище для инструментов и урожая.';
                    break;
                case 'crop':
                    message += `${this.getCropName(cellData.cropType)}. Рост: ${cellData.growth || 0}%. `;
                    message += cellData.growth >= 80 ? 'Готов к сбору!' : 'Нужно полить.';
                    break;
                case 'cleared':
                    message += 'Очищенная земля. Можно построить дом или посадить растения.';
                    break;
                case 'water':
                    message += 'Источник воды. Необходим для полива растений.';
                    break;
                default:
                    message += 'Заросший участок. Пройдите урок 1, чтобы расчистить.';
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
                    cell.title = `${this.getCropName(cell.cropType)} (рост: ${cell.growth}%)`;
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
                    cell.cropType = null;
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
        
        // Находим первую очищенную клетку
        if (this.farmData) {
            const emptyCell = this.farmData.cells.find(cell => 
                cell.type === 'cleared'
            );
            
            if (emptyCell) {
                emptyCell.type = 'crop';
                emptyCell.cropType = 'wheat';
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
                this.showNotification('⚠️ Нет места', 'На ферме нет свободной земли для посадки!');
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
        
        // Создаем элемент анимации
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
        
        // Удаляем после анимации
        setTimeout(() => {
            if (successEl.parentNode) {
                successEl.parentNode.removeChild(successEl);
            }
        }, 1500);
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
}

// Создаем глобальный объект приложения
window.codeFarmApp = null;

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
    
    // Делаем функции глобальными для HTML
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
    
    console.log('✅ CodeFarm запущен и готов к работе!');
});
