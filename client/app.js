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
            GRASS: 'grass',
            CLEARED: 'cleared',
            PLOWED: 'plowed',
            HOUSE: 'house',
            BARN: 'barn',
            CROP: 'crop',
            WATER: 'water',
            ROAD: 'road'
        };
        
        // ★★★★ ДОБАВЛЯЕМ ЭТУ СТРОКУ ★★★★
        this.farm3D = null; // Инициализация 3D фермы
        
        // Биндим методы к текущему контексту
        this.loadLessons = this.loadLessons.bind(this);
        this.createCompleteLessons = this.createCompleteLessons.bind(this);
        this.startLesson = this.startLesson.bind(this);
        this.runCode = this.runCode.bind(this);
        this.submitSolution = this.submitSolution.bind(this);
        
        console.log('🚀 CodeFarmApp инициализирован');
    }
    
    // Биндим методы к текущему контексту
    this.loadLessons = this.loadLessons.bind(this);
    this.createCompleteLessons = this.createCompleteLessons.bind(this);
    this.startLesson = this.startLesson.bind(this);
    this.runCode = this.runCode.bind(this);
    this.submitSolution = this.submitSolution.bind(this);
    
    console.log('🚀 CodeFarmApp инициализирован');
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

async loadInitialData() {
    console.log('📥 Загружаем начальные данные...');
    
    try {
        // Загружаем уроки - ОБЯЗАТЕЛЬНО ЖДЕМ завершения
        this.lessonsData = await this.loadLessons();
        console.log(`📚 Уроки загружены: ${this.lessonsData.length} уроков`);
        
        // Загружаем ферму
        await this.loadFarm();
        
        // Обновляем статистику
        this.updateUserStats();
        
        // Сразу рендерим уроки
        this.renderLessons();
        
    } catch (error) {
        console.error('❌ Ошибка загрузки данных:', error);
        this.showError('Не удалось загрузить данные');
        
        // Создаем демо уроки
        this.lessonsData = this.createCompleteLessons();
        this.renderLessons();
    }
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
    

async loadLessons() {
    console.log('📚 Загружаем уроки...');
    
    try {
        // Пробуем API
        const response = await fetch('/api/lessons');
        if (response.ok) {
            this.lessonsData = await response.json();
            console.log(`✅ API: ${this.lessonsData.length} уроков`);
        } else {
            throw new Error('API не отвечает');
        }
    } catch (error) {
        console.log('🔄 Используем локальные уроки');
        this.lessonsData = [
            {
                id: 'lesson_1',
                title: 'Урок 1: Приветствие',
                description: 'Научитесь использовать print()',
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
    }
    
    // Всегда рендерим уроки
    this.renderLessons();
    return this.lessonsData;
}
    
    createCompleteLessons() {
        console.log('📝 Создаем полные уроки...');
        return [
            {
                id: 'lesson_1',
                title: 'Первые команды - Расчистка фермы',
                description: 'Научитесь давать команды боту для расчистки всей фермы',
                level: 1,
                rewardCoins: 100,
                rewardExp: 200,
                theory: 'В этом уроке вы научитесь использовать функцию print() для вывода текста и clear_area() для управления фермой. Это основа программирования - давать четкие инструкции компьютеру. Каждая команда должна быть на отдельной строке. Python читает код сверху вниз.',
                task: 'Напишите программу, которая полностью расчистит ферму от травы.\n\nТребуется:\n1. Использовать print() для приветствия бота\n2. Использовать clear_area("вся ферма") для очистки\n3. Вывести сообщение о завершении работы',
                testCode: 'print("Привет, фермерский бот!")\nprint("Начинаю расчистку фермы")\nclear_area("вся ферма")\nprint("Ферма полностью расчищена!")',
                initialCode: '# Урок 1: Расчистка фермы\n# Напишите код для расчистки всей фермы\n\n# 1. Поприветствуйте бота командой print()\n# Пример: print("Привет, бот!")\n\n# 2. Расчистите ферму командой clear_area()\n# Пример: clear_area("вся ферма")\n\n# 3. Подтвердите завершение работы\n# Пример: print("Работа выполнена!")\n\n# Напишите ваш код ниже:'
            },
            {
                id: 'lesson_2',
                title: 'Переменные - Постройка дома',
                description: 'Используйте переменные для постройки первого дома на ферме',
                level: 1,
                rewardCoins: 150,
                rewardExp: 300,
                theory: 'Переменные хранят данные. Используйте знак = для присвоения значения. Функции могут принимать аргументы для кастомизации. Переменные позволяют повторно использовать значения и делать код понятнее. В Python переменные не требуют объявления типа - тип определяется значением.',
                task: 'Создайте переменные для координат дома и постройте дом в центре фермы.\n\nТребуется:\n1. Создать переменные x и y для координат\n2. Установить координаты центра фермы (x=3, y=3 для сетки 8x8)\n3. Вызвать функцию build_house(x, y)\n4. Вывести сообщение о завершении',
                testCode: '# Определяем координаты для дома\nx = 3\ny = 3\n\n# Строим дом\nbuild_house(x, y)\n\n# Выводим результат\nprint(f"Дом построен по адресу: x={x}, y={y}")\nprint("Теперь у фермы есть жилье!")',
                initialCode: '# Урок 2: Постройка дома\n# Постройте дом в центре фермы\n\n# 1. Определите координаты центра фермы (8x8 сетка)\n# Центр: x=3, y=3\n\n# 2. Создайте переменные для координат\n\n# 3. Постройте дом с помощью функции build_house()\n\n# 4. Выведите сообщение о завершении\n\n# Напишите ваш код ниже:'
            },
            {
                id: 'lesson_3',
                title: 'Функции - Создание трактора-бота',
                description: 'Создайте класс трактора с базовыми методами',
                level: 2,
                rewardCoins: 200,
                rewardExp: 400,
                theory: 'Функции создаются с помощью ключевого слова def. Классы позволяют создавать собственные типы объектов с методами. Методы - это функции внутри класса. Классы делают код организованным и переиспользуемым. В Python классы используют CamelCase для имен.',
                task: 'Создайте класс Tractor с методами запуска, движения и остановки.\n\nТребуется:\n1. Создать класс Tractor\n2. Добавить метод start() для запуска\n3. Добавить метод drive(direction) для движения\n4. Добавить метод stop() для остановки\n5. Создать экземпляр класса и вызвать методы',
                testCode: 'class Tractor:\n    def start(self):\n        print("Трактор запущен")\n    \n    def drive(self, direction):\n        print(f"Трактор едет {direction}")\n    \n    def stop(self):\n        print("Трактор остановлен")\n\n# Создаем экземпляр трактора\nmy_tractor = Tractor()\nmy_tractor.start()\nmy_tractor.drive("вперед")\nmy_tractor.stop()',
                initialCode: '# Урок 3: Создание трактора-бота\n# Создайте класс трактора\n\n# 1. Определите класс Tractor\n# Пример: class Tractor:\n\n# 2. Добавьте метод start()\n# Пример: def start(self):\n#            print("Запускаю трактор")\n\n# 3. Добавьте метод drive() с параметром direction\n\n# 4. Добавьте метод stop()\n\n# 5. Создайте объект и вызовите методы\n\n# Напишите ваш код ниже:'
            },
            {
                id: 'lesson_4',
                title: 'Аргументы функций - Команда трактору',
                description: 'Дайте команду трактору вскопать землю',
                level: 2,
                rewardCoins: 250,
                rewardExp: 500,
                theory: 'Аргументы функции указываются в скобках после имени функции. Они позволяют передавать данные в функцию. Можно использовать именованные аргументы для большей ясности. Аргументы делают функции гибкими и переиспользуемыми. В Python можно использовать как позиционные, так и именованные аргументы.',
                task: 'Добавьте метод plow() в класс Tractor и дайте команду вскопать поле.\n\nТребуется:\n1. Добавить метод plow(field_x, field_y) в класс Tractor\n2. Метод должен принимать координаты поля\n3. Метод должен выводить сообщение о начале работы\n4. Создать трактор и дать ему команду вскопать поле с координатами (2, 2)',
                testCode: 'class Tractor:\n    def plow(self, field_x, field_y):\n        print(f"Вскапываю поле по координатам x={field_x}, y={field_y}")\n        return f"Поле ({field_x}, {field_y}) вскопано"\n\n# Использование\nmy_tractor = Tractor()\nresult = my_tractor.plow(field_x=2, field_y=2)\nprint(result)\nprint("Поле готово для посадки!")',
                initialCode: '# Урок 4: Команда трактору\n# Добавьте метод вскопать землю\n\n# 1. Расширьте класс Tractor из урока 3\n# или создайте новый класс\n\n# 2. Добавьте метод plow() с параметрами field_x, field_y\n\n# 3. В методе выведите сообщение о начале работы\n\n# 4. Создайте объект и вызовите метод с координатами (2, 2)\n\n# 5. Выведите результат\n\n# Напишите ваш код ниже:'
            },
            {
                id: 'lesson_5',
                title: 'Списки и циклы - Посадка растений',
                description: 'Используйте списки и циклы для посадки растений',
                level: 3,
                rewardCoins: 300,
                rewardExp: 600,
                theory: 'Списки хранят коллекции элементов. Цикл for повторяет команды для каждого элемента списка. Функция range() создает последовательность чисел. Это основа автоматизации повторяющихся задач. В Python индексация списков начинается с 0.',
                task: 'Создайте список культур и посадите их на поле с помощью цикла.\n\nТребуется:\n1. Создать список crops с названиями культур\n2. Использовать цикл for для перебора списка\n3. Для каждой культуры вызвать функцию plant(crop_name)\n4. Посадить минимум 3 разные культуры\n5. Вывести сообщение о завершении',
                testCode: '# Создаем список культур\ncrops = ["пшеница", "морковь", "картофель"]\n\nprint("Начинаю посадку культур:")\n\n# Используем цикл для посадки каждой культуры\nfor crop in crops:\n    print(f"Сажаю {crop}...")\n    plant(crop)\n\nprint("Все культуры посажены!")\nprint("Через несколько дней будет урожай.")',
                initialCode: '# Урок 5: Посадка растений\n# Используйте списки и циклы\n\n# 1. Создайте список культур\n# Пример: crops = ["пшеница", "морковь", "картофель"]\n\n# 2. Используйте цикл for для перебора списка\n# Пример: for crop in crops:\n\n# 3. В цикле вызовите функцию plant() для каждой культуры\n\n# 4. Выведите прогресс посадки\n\n# 5. Выведите сообщение о завершении\n\n# Напишите ваш код ниже:'
            },
            {
                id: 'lesson_6',
                title: 'Условия - Умная система полива',
                description: 'Создайте систему полива, реагирующую на условия',
                level: 3,
                rewardCoins: 350,
                rewardExp: 700,
                theory: 'Оператор if проверяет условие. elif проверяет дополнительные условия. else выполняется, если все условия ложны. Это позволяет программе принимать решения на основе данных. В Python отступы (4 пробела) определяют блоки кода.',
                task: 'Создайте систему полива, которая проверяет влажность почвы и решает, поливать или нет.\n\nТребования:\n1. Создать переменную moisture_level со значением от 0 до 100\n2. Использовать if/elif/else для проверки влажности\n3. Если влажность < 30 - поливать обильно\n4. Если влажность 30-60 - поливать умеренно\n5. Если влажность > 60 - не поливать\n6. Вызывать water_plants(amount) в зависимости от условий',
                testCode: '# Уровень влажности почвы\nmoisture_level = 25  # в процентах\n\nprint(f"Текущая влажность почвы: {moisture_level}%")\n\n# Проверяем условия и принимаем решение\nif moisture_level < 30:\n    print("Критически сухо! Срочно поливаю.")\n    water_plants(amount="обильно")\nelif moisture_level <= 60:\n    print("Суховато, поливаю умеренно.")\n    water_plants(amount="умеренно")\nelse:\n    print("Влажность нормальная, полив не требуется.")\n    print("Растения в порядке!")\n\nprint("Проверка влажности завершена.")',
                initialCode: '# Урок 6: Умная система полива\n# Используйте условия if/elif/else\n\n# 1. Создайте переменную moisture_level\n# Пример: moisture_level = 40\n\n# 2. Проверьте условие для обильного полива (влажность < 30)\n# Используйте if moisture_level < 30:\n\n# 3. Добавьте условие для умеренного полива (30-60)\n# Используйте elif 30 <= moisture_level <= 60:\n\n# 4. Добавьте условие, когда полив не нужен (> 60)\n# Используйте else:\n\n# 5. В каждом условии вызовите water_plants() с разным amount\n\n# 6. Выведите информативные сообщения\n\n# Напишите ваш код ниже:'
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
                clearedLand: 0,
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
    
    // 1. Инициализируем навигацию
    this.initNavigation();
    
    // 2. Инициализируем редактор кода
    this.initCodeEditor();
    
    // 3. Инициализируем обработчики событий
    this.initEventHandlers();
    
    // 4. Показываем главный экран
    this.showScreen('main');
    
    // 5. Добавляем CSS для анимаций
    this.addStyles();
    
    // ★★★★ ДОБАВЛЯЕМ ЭТИ СТРОКИ ПОСЛЕ addStyles() ★★★★
    // 6. Инициализируем 3D ферму (если библиотеки загружены)
    if (window.THREE && window.TWEEN) {
        setTimeout(() => {
            this.init3DFarm();
        }, 1000); // Даем время на загрузку DOM
    } else {
        console.log('⚠️ Three.js не загружен, 3D ферма недоступна');
    }
    
    console.log('✅ Интерфейс инициализирован');
}

// ★★★★ ДОБАВЛЯЕМ НОВЫЙ МЕТОД ПОСЛЕ initUI() ★★★★
init3DFarm() {
    console.log('🎮 Инициализируем 3D ферму...');
    
    const container = document.getElementById('farm-3d-container');
    if (!container) {
        console.log('⚠️ Контейнер для 3D фермы не найден');
        return;
    }
    
    try {
        // Проверяем, что все необходимые библиотеки загружены
        if (!window.THREE || !window.TWEEN) {
            throw new Error('Не загружены необходимые 3D библиотеки');
        }
        
        // Создаем экземпляр 3D фермы
        this.farm3D = new Farm3DEngine('farm-3d-container', this.userId);
        
        // Инициализируем с небольшой задержкой
        setTimeout(async () => {
            try {
                await this.farm3D.init();
                console.log('✅ 3D ферма успешно инициализирована');
                
                // Если есть текущая ферма, применяем ее состояние
                if (this.farmData) {
                    this.update3DFarmFromData();
                }
            } catch (error) {
                console.error('❌ Ошибка инициализации 3D фермы:', error);
                this.show3DFarmFallback(container);
            }
        }, 1500);
        
    } catch (error) {
        console.error('❌ Ошибка создания 3D фермы:', error);
        this.show3DFarmFallback(container);
    }
}

// ★★★★ ДОБАВЛЯЕМ ВСПОМОГАТЕЛЬНЫЙ МЕТОД ★★★★
show3DFarmFallback(container) {
    if (!container) return;
    
    container.innerHTML = `
        <div style="
            width: 100%; 
            height: 100%; 
            display: flex; 
            flex-direction: column;
            align-items: center; 
            justify-content: center;
            background: linear-gradient(135deg, #2E7D32 0%, #1B5E20 100%);
            color: white;
            border-radius: 10px;
            text-align: center;
            padding: 20px;
        ">
            <div style="font-size: 60px; margin-bottom: 20px;">🌾</div>
            <h3 style="margin-bottom: 10px;">3D Ферма</h3>
            <p style="margin-bottom: 20px; opacity: 0.9;">
                Пройдите уроки программирования, чтобы развивать свою ферму!
            </p>
            <div style="
                background: rgba(255,255,255,0.1); 
                padding: 15px; 
                border-radius: 8px;
                margin-top: 10px;
            ">
                <p style="margin: 0; font-size: 14px;">
                    <strong>Для активации 3D фермы:</strong><br>
                    1. Пройдите Урок 1: Расчистка фермы<br>
                    2. Напишите код правильно<br>
                    3. Ферма автоматически обновится!
                </p>
            </div>
        </div>
    `;
}

// ★★★★ ДОБАВЛЯЕМ МЕТОД ОБНОВЛЕНИЯ 3D ФЕРМЫ ★★★★
update3DFarmFromData() {
    if (!this.farm3D || !this.userData) return;
    
    // Применяем эффекты для пройденных уроков
    const completedLessons = this.userData.completedLessonIds || [];
    
    completedLessons.forEach(lessonId => {
        setTimeout(() => {
            if (this.farm3D && typeof this.farm3D.applyLessonEffect === 'function') {
                this.farm3D.applyLessonEffect(lessonId);
            }
        }, 500);
    });
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
    
    // 1. Кнопка запуска кода
    const runBtn = document.getElementById('run-code-btn');
    if (runBtn) {
        runBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.runCode();
        });
    }
        
        // 2. Кнопка отправки решения
        const submitBtn = document.getElementById('submit-code-btn');
        if (submitBtn) {
            console.log('✅ submit-code-btn найден, добавляем обработчик');
            submitBtn.addEventListener('click', (e) => {
                console.log('🎯 Нажата кнопка "Проверить решение"');
                e.preventDefault();
                e.stopPropagation();
                this.submitSolution();
            });
        }
        
        // 3. Кнопка очистки вывода
        const clearBtn = document.getElementById('clear-output-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.clearOutput();
            });
        }
           
        // 4. Быстрые действия
        const quickActions = document.querySelectorAll('.quick-action-btn');
        console.log('🔍 quick-action-btn найдено:', quickActions.length);
        quickActions.forEach(btn => {
            const action = btn.getAttribute('data-action');
            if (action) {
                btn.addEventListener('click', () => {
                    console.log('🎯 Быстрое действие:', action);
                    this.handleQuickAction(action);
                });
            }
        });
        
        // 5. Действия на ферме
        const farmActions = document.querySelectorAll('.farm-action-btn');
        console.log('🔍 farm-action-btn найдено:', farmActions.length);
        farmActions.forEach(btn => {
            const action = btn.getAttribute('data-action');
            if (action) {
                btn.addEventListener('click', () => {
                    console.log('🎯 Действие на ферме:', action);
                    this.handleFarmAction(action);
                });
            }
        });
        
        // 6. Кнопки навигации
        const navItems = document.querySelectorAll('.nav-item');
        console.log('🔍 nav-item найдено:', navItems.length);
        navItems.forEach(item => {
            const screen = item.getAttribute('data-screen');
            if (screen) {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log('🎯 Навигация на экран:', screen);
                    this.showScreen(screen);
                });
            }
        });
        
        // 7. Кнопки быстрых уроков
        const quickLessonBtns = document.querySelectorAll('.quick-lesson-btn');
        console.log('🔍 quick-lesson-btn найдено:', quickLessonBtns.length);
        quickLessonBtns.forEach(btn => {
            const lessonId = btn.getAttribute('data-lesson');
            if (lessonId) {
                btn.addEventListener('click', () => {
                    console.log('🎯 Быстрый урок:', lessonId);
                    this.startLesson(lessonId);
                });
            }
        });
        
        // 8. Навигация по урокам
        this.initLessonNavigation();
        
      // ★★★★ ДОБАВЛЯЕМ ОБРАБОТЧИК ДЛЯ ПЕРЕЗАГРУЗКИ 3D ФЕРМЫ ★★★★
    const reloadFarmBtn = document.getElementById('reload-farm-btn');
    if (reloadFarmBtn) {
        reloadFarmBtn.addEventListener('click', () => {
            console.log('🔄 Перезагружаем 3D ферму...');
            if (this.farm3D) {
                this.farm3D.init().catch(error => {
                    console.error('❌ Ошибка перезагрузки 3D фермы:', error);
                });
            } else {
                this.init3DFarm();
            }
        });
    }
    
    // ★★★★ ДОБАВЛЯЕМ ОБРАБОТЧИК ДЛЯ ПЕРЕКЛЮЧЕНИЯ ВИДА ★★★★
    const toggleViewBtn = document.getElementById('toggle-view-btn');
    if (toggleViewBtn) {
        toggleViewBtn.addEventListener('click', () => {
            const farmContainer = document.getElementById('farm-3d-container');
            const farm2D = document.getElementById('farm-grid-container');
            
            if (farmContainer && farm2D) {
                if (farmContainer.style.display === 'none') {
                    // Показываем 3D
                    farmContainer.style.display = 'block';
                    farm2D.style.display = 'none';
                    toggleViewBtn.innerHTML = '<i class="fas fa-th"></i> 2D Вид';
                    
                    // Переинициализируем 3D если нужно
                    if (this.farm3D && !this.farm3D.scene) {
                        this.farm3D.init();
                    }
                } else {
                    // Показываем 2D
                    farmContainer.style.display = 'none';
                    farm2D.style.display = 'block';
                    toggleViewBtn.innerHTML = '<i class="fas fa-cube"></i> 3D Вид';
                }
            }
        });
    }
    
    console.log('✅ Обработчики событий настроены');
}


    initLessonNavigation() {
        console.log('🔄 Инициализируем навигацию по урокам...');
        
        // Кнопка предыдущего урока
        const prevBtn = document.getElementById('prev-lesson-btn');
        if (prevBtn) {
            prevBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🎯 Нажата кнопка "Предыдущий урок"');
                this.prevLesson();
            });
        }
        
        // Кнопка следующего урока
        const nextBtn = document.getElementById('next-lesson-btn');
        if (nextBtn) {
            nextBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🎯 Нажата кнопка "Следующий урок"');
                this.nextLesson();
            });
        }
    }
    
    prevLesson() {
        if (!this.currentLesson) {
            console.log('⚠️ Нет текущего урока');
            return;
        }
        
        const currentIndex = this.lessonsData.findIndex(l => l.id === this.currentLesson.id);
        if (currentIndex > 0) {
            const prevLesson = this.lessonsData[currentIndex - 1];
            this.startLesson(prevLesson.id);
        } else {
            this.showNotification('ℹ️ Нет предыдущего урока', 'Это первый урок');
        }
    }
    
    nextLesson() {
        if (!this.currentLesson) {
            console.log('⚠️ Нет текущего урока');
            return;
        }
        
        const currentIndex = this.lessonsData.findIndex(l => l.id === this.currentLesson.id);
        if (currentIndex < this.lessonsData.length - 1) {
            const nextLesson = this.lessonsData[currentIndex + 1];
            this.startLesson(nextLesson.id);
        } else {
            this.showNotification('🎉 Поздравляем!', 'Вы прошли все уроки!');
        }
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
        
        // Для экрана уроков обновляем список уроков
        if (screenName === 'lessons' && this.lessonsData.length > 0) {
            console.log('📚 Обновляем список уроков на экране уроков');
            this.renderLessons();
        }
        
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
    console.log('🎨 Рендерим уроки...');
    
    const container = document.getElementById('lessons-list');
    if (!container) {
        console.log('⚠️ Не найден lessons-list');
        return;
    }
    
    if (!this.lessonsData || this.lessonsData.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <div style="font-size: 48px;">📚</div>
                <h3>Нет уроков</h3>
                <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px;
                        background: #4CAF50; color: white; border: none; border-radius: 5px;">
                    Обновить страницу
                </button>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    
    this.lessonsData.forEach((lesson, index) => {
        const card = document.createElement('div');
        card.className = 'lesson-card';
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                <div style="background: #4CAF50; color: white; width: 30px; height: 30px; 
                           border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                    ${index + 1}
                </div>
                <div style="width: 12px; height: 12px; background: #4CAF50; border-radius: 50%;"></div>
            </div>
            <h3 style="margin-bottom: 10px;">${lesson.title}</h3>
            <p style="color: #666; margin-bottom: 15px;">${lesson.description}</p>
            
            <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                <span style="background: #FFF3E0; color: #EF6C00; padding: 4px 8px; border-radius: 12px;">
                    🪙 ${lesson.rewardCoins || 50}
                </span>
                <span style="background: #E8F5E9; color: #2E7D32; padding: 4px 8px; border-radius: 12px;">
                    ⭐ ${lesson.rewardExp || 100}
                </span>
            </div>
            
            <button onclick="window.codeFarmApp.startLesson('${lesson.id}')" 
                    style="width: 100%; padding: 10px; background: #4CAF50; color: white; 
                           border: none; border-radius: 5px; cursor: pointer;">
                Начать урок
            </button>
        `;
        
        container.appendChild(card);
    });
    
    console.log(`✅ Отрендерено ${this.lessonsData.length} уроков`);
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
    
    // ★★★★ ОБНОВЛЯЕМ СТАТИСТИКУ НА СТРАНИЦЕ ★★★★
    // Используем существующие элементы или создаем новые
    this.updateStatElement('cleared-land-count', stats.clearedLand);
    this.updateStatElement('buildings-count', stats.buildings);
    this.updateStatElement('crops-count', stats.crops);
    this.updateStatElement('water-sources', stats.water);
    
    // Обновляем прогресс-бар фермы
    const progressBar = document.getElementById('farm-progress-bar');
    if (progressBar) {
        // Рассчитываем общий прогресс (максимум 64 клетки)
        const totalProgress = Math.min(100, (stats.clearedLand / 64) * 100);
        progressBar.style.width = `${totalProgress}%`;
    }
    
    console.log('✅ Статистика фермы обновлена:', stats);
}

// ★★★★ ДОБАВЛЯЕМ ВСПОМОГАТЕЛЬНЫЙ МЕТОД ★★★★
updateStatElement(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = value;
    } else {
        // Если элемента нет, создаем его (для совместимости)
        console.log(`⚠️ Элемент ${elementId} не найден`);
    }
}
    
   startLesson(lessonId) {
    console.log(`🎯 Начинаем урок: ${lessonId}`);
    
    const lesson = this.lessonsData.find(l => l.id === lessonId);
    if (!lesson) {
        alert('Урок не найден');
        return;
    }
    
    this.currentLesson = lesson;
    this.showScreen('code');
    
    // Обновляем интерфейс
    setTimeout(() => {
        const titleEl = document.getElementById('current-lesson-title');
        if (titleEl) titleEl.textContent = lesson.title;
        
        const editor = document.getElementById('code-editor');
        if (editor) {
            editor.value = lesson.initialCode || '# Напишите код здесь';
        }
        
        console.log(`✅ Урок "${lesson.title}" начат`);
    }, 100);
}
    
    updateLessonInterface() {
        if (!this.currentLesson) return;
        
        console.log('🔄 Обновляем интерфейс урока...');
        
        // Обновляем заголовок
        const titleElement = document.getElementById('current-lesson-title');
        const descElement = document.getElementById('current-lesson-desc');
        
        if (titleElement) titleElement.textContent = this.currentLesson.title;
        if (descElement) descElement.textContent = this.currentLesson.description;
        
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
                    ${this.currentLesson.task.replace(/\n/g, '<br>')}
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
        
        // Обновляем номер урока в навигации
        const currentIndex = this.lessonsData.findIndex(l => l.id === this.currentLesson.id);
        if (currentIndex >= 0) {
            const currentLessonNumber = document.getElementById('current-lesson-number');
            const totalLessons = document.getElementById('total-lessons');
            if (currentLessonNumber) currentLessonNumber.textContent = `Урок ${currentIndex + 1}`;
            if (totalLessons) totalLessons.textContent = this.lessonsData.length;
        }
        
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
            
            // Определяем функции для фермы
            const farmFunctions = {
                'print': (text) => `>>> ${text}`,
                'clear_area': (area) => `🌿 Расчищена ${area}`,
                'build_house': (x, y) => `🏠 Дом построен по координатам (${x}, ${y})`,
                'plant': (crop) => `🌱 Посажена ${crop}`,
                'water_plants': (amount) => `💧 Полив: ${amount}`,
                'harvest_crop': () => '📦 Культура собрана'
            };
            
            lines.forEach((line, i) => {
                const trimmed = line.trim();
                
                if (trimmed.includes('print(')) {
                    // Извлекаем текст для печати
                    const match = trimmed.match(/print\(["'](.+?)["']\)/);
                    if (match) {
                        result += `${farmFunctions.print(match[1])}\n`;
                    }
                } else if (trimmed.includes('clear_area(')) {
                    const match = trimmed.match(/clear_area\(["'](.+?)["']\)/);
                    if (match) {
                        result += `${farmFunctions.clear_area(match[1])}\n`;
                    }
                } else if (trimmed.includes('build_house(')) {
                    const match = trimmed.match(/build_house\((\d+),\s*(\d+)\)/);
                    if (match) {
                        result += `${farmFunctions.build_house(match[1], match[2])}\n`;
                    }
                } else if (trimmed.includes('plant(')) {
                    const match = trimmed.match(/plant\(["'](.+?)["']\)/);
                    if (match) {
                        result += `${farmFunctions.plant(match[1])}\n`;
                    }
                } else if (trimmed.includes('water_plants(')) {
                    const match = trimmed.match(/water_plants\(["'](.+?)["']\)/);
                    if (match) {
                        result += `${farmFunctions.water_plants(match[1])}\n`;
                    }
                } else if (trimmed.includes('harvest_crop(')) {
                    result += `${farmFunctions.harvest_crop()}\n`;
                } else if (trimmed && !trimmed.startsWith('#') && trimmed !== '') {
                    // Для других строк показываем, что они выполнены
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
    
    async submitSolution() {
        console.log('📤 Проверяем решение...');
        
        const code = this.codeEditor?.value;
        if (!code || !this.currentLesson) {
            this.showNotification('⚠️ Внимание', 'Сначала выберите урок и напишите код');
            return;
        }
        
        // Проверяем, что код не пустой
        if (!code.trim()) {
            this.showNotification('❌ Ошибка', 'Введите код для проверки');
            return;
        }
        
        console.log('🔍 Проверка кода для урока:', this.currentLesson.id);
        console.log('📝 Код для проверки:', code.substring(0, 200) + '...');
        
        // Показываем загрузку
        this.showNotification('⏳ Проверка', 'Проверяю ваш код...');
        
        try {
            // Проверяем код локально
            const checkResult = this.checkCode(code, this.currentLesson.id);
            console.log('Результат проверки:', checkResult);
            
            if (checkResult.success) {
                // Успешное выполнение
                await this.completeLesson(this.currentLesson.id, code);
            } else {
                // Ошибка
                this.showNotification('❌ Ошибка', checkResult.message || 'Код не соответствует заданию');
                
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
            this.showNotification('❌ Ошибка', 'Произошла ошибка при проверке кода');
        }
    }
    
    checkCode(code, lessonId) {
        console.log(`🔍 Проверка кода для урока: ${lessonId}`);
        
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
                const hasPrint1 = cleanCode.includes('print(');
                const hasClearArea = cleanCode.includes('clear_area(');
                passed = hasPrint1 && hasClearArea;
                message = passed ? 'Код правильный! Ферма расчищена.' : 'Нужно использовать print() и clear_area("вся ферма")';
                break;
                
            case 'lesson_2':
                const hasVariable = (cleanCode.includes('x=') || cleanCode.includes('x =')) && 
                                  (cleanCode.includes('y=') || cleanCode.includes('y ='));
                const hasBuildHouse = cleanCode.includes('build_house(');
                const hasPrint2 = cleanCode.includes('print(');
                passed = hasVariable && hasBuildHouse && hasPrint2;
                message = passed ? 'Код правильный! Дом построен.' : 'Нужно: 1) x=3, y=3 2) build_house(x, y) 3) print() для вывода';
                break;
                
            case 'lesson_3':
                const hasClass = cleanCode.includes('class tractor');
                const hasStart = cleanCode.includes('def start(');
                const hasDrive = cleanCode.includes('def drive(');
                const hasStop = cleanCode.includes('def stop(');
                passed = hasClass && hasStart && hasDrive && hasStop;
                message = passed ? 'Код правильный! Трактор создан.' : 'Нужно создать класс Tractor с методами start(), drive(), stop()';
                break;
                
            case 'lesson_4':
                const hasMethod = cleanCode.includes('def plow(');
                const hasParameters = cleanCode.includes('field_x') && cleanCode.includes('field_y');
                const hasCall = cleanCode.includes('.plow(');
                passed = hasMethod && hasParameters && hasCall;
                message = passed ? 'Код правильный! Трактор получил команду.' : 'Нужно: 1) def plow(field_x, field_y) 2) tractor.plow(2, 2)';
                break;
                
            case 'lesson_5':
                const hasList = cleanCode.includes('[') && cleanCode.includes(']');
                const hasForLoop = cleanCode.includes('for ') && cleanCode.includes(' in ');
                const hasPlant = cleanCode.includes('plant(');
                passed = hasList && hasForLoop && hasPlant;
                message = passed ? 'Код правильный! Растения посажены.' : 'Нужно: 1) список культур 2) цикл for 3) plant() в цикле';
                break;
                
            case 'lesson_6':
                const hasIf = cleanCode.includes('if ');
                const hasElif = cleanCode.includes('elif');
                const hasElse = cleanCode.includes('else:');
                const hasWaterPlants = cleanCode.includes('water_plants(');
                passed = hasIf && hasWaterPlants;
                message = passed ? 'Код правильный! Система полива работает.' : 'Нужно: if moisture_level < 30: с water_plants() внутри';
                break;
                
            default:
                // Для остальных уроков - простая проверка
                passed = code.length > 10 && code.includes('print');
                message = passed ? 'Код правильный!' : 'Код должен содержать команду print()';
        }
        
        console.log(`✅ Проверка завершена: ${passed ? 'ПРОШЕЛ' : 'НЕ ПРОШЕЛ'}`, { passed, message });
        return { success: passed, message: message };
    }
    
    async completeLesson(lessonId, code) {
        console.log(`✅ Завершаем урок: ${lessonId}`);
        
        try {
            const lesson = this.lessonsData.find(l => l.id === lessonId);
            if (!lesson) {
                throw new Error('Урок не найден');
            }
            
            const rewardCoins = lesson.rewardCoins || 50;
            const rewardExp = lesson.rewardExp || 100;
            
            // Показываем уведомление
            this.showNotification('🎉 Урок пройден!', 
                `${lesson.title} пройден!\n` +
                `Награда: ${rewardCoins} монет\n` +
                `Опыт: +${rewardExp}`);
            
            // Обновляем данные пользователя
            if (this.userData) {
                // Проверяем, не был ли урок уже пройден
                if (!this.userData.completedLessonIds) {
                    this.userData.completedLessonIds = [];
                }
                
                const alreadyCompleted = this.userData.completedLessonIds.includes(lessonId);
                
                if (!alreadyCompleted) {
                    // Обновляем данные
                    this.userData.coins = (this.userData.coins || 100) + rewardCoins;
                    this.userData.experience = (this.userData.experience || 0) + rewardExp;
                    this.userData.lessonsCompleted = (this.userData.lessonsCompleted || 0) + 1;
                    this.userData.completedLessonIds.push(lessonId);
                    
                    // Проверяем уровень
                    const oldLevel = this.userData.level || 1;
                    const newLevel = Math.max(1, Math.floor((this.userData.experience || 0) / 1000) + 1);
                    
                    if (newLevel > oldLevel) {
                        this.userData.level = newLevel;
                        this.showNotification('⭐ Новый уровень!', `Вы достигли уровня ${newLevel}!`);
                    }
                    
                    // Обновляем статистику
                    this.updateUserStats();
                    
                    // Перерисовываем уроки
                    this.renderLessons();
                    
                    // Применяем изменения на ферме
                    this.applyFarmChanges(lessonId);
                    
                    // Анимация успеха
                    this.playSuccessAnimation();
                    
                    // Сохраняем прогресс
                    this.saveProgress(lessonId, code);
                    
                    console.log('✅ Урок успешно завершен со всеми изменениями');
                } else {
                    this.showNotification('ℹ️ Уже пройден', 'Этот урок уже был пройден ранее');
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка завершения урока:', error);
            this.showNotification('❌ Ошибка', 'Не удалось завершить урок: ' + error.message);
        }
    }
    
    pplyFarmChanges(lessonId) {
    console.log(`🌾 Применяем изменения на ферме для урока: ${lessonId}`);
    
    if (!this.farmData || !this.farmData.cells) {
        console.log('⚠️ Нет данных фермы');
        return;
    }
    
    let cellsToUpdate = [];
    let message = '';
    let emoji = '✨';
    
    switch(lessonId) {
        case 'lesson_1':
                // Расчистка всей фермы от травы
                emoji = '🧹';
                message = 'Ферма полностью расчищена от травы! Теперь можно строить.';
                
                cellsToUpdate = this.farmData.cells.filter(cell => cell.type === 'grass');
                
                cellsToUpdate.forEach(cell => {
                    cell.type = 'cleared';
                    cell.emoji = '🟫';
                    cell.color = '#8D6E63';
                    cell.title = 'Расчищенная земля';
                });
                break;
                
            case 'lesson_2':
                // Постройка дома в центре
                emoji = '🏠';
                message = 'Дом построен в центре фермы! Теперь у вас есть жилье.';
                
                // Центр фермы (8x8 сетка)
                const centerX = 3;
                const centerY = 3;
                
                const centerCell = this.farmData.cells.find(cell => 
                    cell.x === centerX && cell.y === centerY && 
                    cell.type === 'cleared'
                );
                
                if (centerCell) {
                    cellsToUpdate = [centerCell];
                    centerCell.type = 'house';
                    centerCell.emoji = '🏠';
                    centerCell.color = '#FF9800';
                    centerCell.title = 'Дом фермера';
                }
                break;
                
            case 'lesson_3':
                // Строительство сарая рядом с домом
                emoji = '🏚️';
                message = 'Сарай построен! Теперь есть место для хранения инструментов.';
                
                // Ищем дом
                const houseCell = this.farmData.cells.find(cell => cell.type === 'house');
                if (houseCell) {
                    // Ищем соседнюю клетку для сарая
                    const barnCell = this.farmData.cells.find(cell => 
                        Math.abs(cell.x - houseCell.x) <= 1 &&
                        Math.abs(cell.y - houseCell.y) <= 1 &&
                        cell.type === 'cleared'
                    );
                    
                    if (barnCell) {
                        cellsToUpdate = [barnCell];
                        barnCell.type = 'barn';
                        barnCell.emoji = '🏚️';
                        barnCell.color = '#795548';
                        barnCell.title = 'Сарай';
                    }
                }
                break;
                
            case 'lesson_4':
                // Вспашка полей вокруг дома
                emoji = '🚜';
                message = 'Поля вскопаны! Готовы для посадки растений.';
                
                // Вскапываем несколько полей вокруг дома
                const clearedCells = this.farmData.cells.filter(cell => 
                    cell.type === 'cleared' && 
                    Math.random() > 0.5 // 50% шанс
                );
                
                cellsToUpdate = clearedCells.slice(0, 6); // Максимум 6 полей
                
                cellsToUpdate.forEach(cell => {
                    cell.type = 'plowed';
                    cell.emoji = '🟨';
                    cell.color = '#FFD54F';
                    cell.title = 'Вспаханное поле';
                });
                break;
                
            case 'lesson_5':
                // Посадка растений на вспаханных полях
                emoji = '🌱';
                message = 'Растения посажены! Скоро будет урожай.';
                
                const cropTypes = [
                    { emoji: '🌾', title: 'Пшеница', color: '#8BC34A' },
                    { emoji: '🥕', title: 'Морковь', color: '#FF9800' },
                    { emoji: '🥔', title: 'Картофель', color: '#795548' }
                ];
                
                const plowedCells = this.farmData.cells.filter(cell => cell.type === 'plowed');
                cellsToUpdate = plowedCells.slice(0, Math.min(5, plowedCells.length));
                
                cellsToUpdate.forEach(cell => {
                    const crop = cropTypes[Math.floor(Math.random() * cropTypes.length)];
                    cell.type = 'crop';
                    cell.emoji = crop.emoji;
                    cell.color = crop.color;
                    cell.title = `${crop.title} (рост: 25%)`;
                    cell.growth = 25;
                });
                break;
                
            case 'lesson_6':
                // Добавление источника воды
                emoji = '💧';
                message = 'Источник воды добавлен! Теперь можно поливать растения.';
                
                // Ищем клетку на краю фермы
                const edgeCells = this.farmData.cells.filter(cell => 
                    (cell.x === 0 || cell.x === 7 || cell.y === 0 || cell.y === 7) &&
                    cell.type === 'cleared'
                );
                
                if (edgeCells.length > 0) {
                    const waterCell = edgeCells[Math.floor(Math.random() * edgeCells.length)];
                    cellsToUpdate = [waterCell];
                    waterCell.type = 'water';
                    waterCell.emoji = '💧';
                    waterCell.color = '#2196F3';
                    waterCell.title = 'Источник воды';
                }
                break;
                
            default:
                // Для остальных уроков
                emoji = '⭐';
                message = 'Ферма улучшена!';
        }
        
       // Применяем изменения в 3D ферме
    if (this.farm3D && typeof this.farm3D.applyLessonEffect === 'function') {
        // Даем время на обновление 2D фермы
        setTimeout(() => {
            console.log(`🎮 Применяем изменения в 3D ферме для урока: ${lessonId}`);
            this.farm3D.applyLessonEffect(lessonId);
            
            // Обновляем статистику фермы
            this.updateFarmStats();
            
        }, 300);
    } else {
        console.log('⚠️ 3D ферма не инициализирована, применяем только 2D изменения');
        this.updateFarmStats();
    }
    
    // ★★★★ ПЕРЕРИСОВЫВАЕМ ФЕРМУ (если метод renderFarm существует) ★★★★
    if (typeof this.renderFarm === 'function') {
        this.renderFarm();
    }
    
    // Показываем уведомление
    if (message) {
        this.showNotification(emoji, message);
    }
    
    console.log(`✅ Изменения применены: ${cellsToUpdate.length} клеток обновлены`);
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
    
    async saveProgress(lessonId, code) {
        try {
            // Сохраняем в localStorage
            const progress = {
                userId: this.userId,
                lessonId: lessonId,
                code: code,
                completedAt: new Date().toISOString(),
                userData: this.userData
            };
            
            localStorage.setItem(`codefarm_progress_${this.userId}_${lessonId}`, JSON.stringify(progress));
            
            // Сохраняем общий прогресс
            let userProgress = JSON.parse(localStorage.getItem(`codefarm_user_${this.userId}`) || '{}');
            userProgress.completedLessons = userProgress.completedLessons || [];
            if (!userProgress.completedLessons.includes(lessonId)) {
                userProgress.completedLessons.push(lessonId);
            }
            userProgress.lastActivity = new Date().toISOString();
            localStorage.setItem(`codefarm_user_${this.userId}`, JSON.stringify(userProgress));
            
            console.log('💾 Прогресс сохранен в localStorage');
            
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
                    console.log('⚠️ Не удалось сохранить прогресс на сервере');
                }
            }
            
        } catch (error) {
            console.error('❌ Ошибка сохранения прогресса:', error);
        }
    }
    
    handleFarmClick(x, y, cellData) {
        console.log(`📍 Клик по клетке фермы: (${x}, ${y})`, cellData);
        
        let message = `Клетка (${x}, ${y})\n`;
        let emoji = cellData?.emoji || '📍';
        
        if (cellData) {
            switch(cellData.type) {
                case 'grass':
                    message += '🌿 Заросший участок.\n';
                    message += 'Пройдите Урок 1: "Первые команды", чтобы расчистить землю!';
                    break;
                case 'cleared':
                    message += '🟫 Расчищенная земля.\n';
                    message += 'Готова для строительства или посадки растений. Пройдите Урок 2 для постройки дома.';
                    break;
                case 'plowed':
                    message += '🟨 Вспаханное поле.\n';
                    message += 'Идеально подготовлено для посадки культур. Пройдите Урок 5 для посадки растений.';
                    break;
                case 'house':
                    message += '🏠 Дом фермера.\n';
                    message += 'Главное здание вашей фермы. Здесь вы планируете работу и отдыхаете.';
                    break;
                case 'barn':
                    message += '🏚️ Сарай.\n';
                    message += 'Хранилище для инструментов и урожая. Построен в Уроке 3.';
                    break;
                case 'crop':
                    const cropName = cellData.title?.split('(')[0] || 'Культура';
                    message += `${cellData.emoji} ${cropName}.\n`;
                    message += `Рост: ${cellData.growth || 0}%.\n`;
                    message += cellData.growth >= 80 ? 'Готов к сбору!' : 'Растет...\n';
                    message += 'Для полива используйте кнопку "Полить" в меню фермы.';
                    break;
                case 'water':
                    message += '💧 Источник воды.\n';
                    message += 'Необходим для полива растений и содержания животных. Добавлен в Уроке 6.';
                    break;
                case 'road':
                    message += '🛣️ Дорога.\n';
                    message += 'Удобные пути для перемещения по ферме.';
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
        
        let watered = 0;
        if (this.farmData) {
            this.farmData.cells.forEach(cell => {
                if (cell.type === 'crop' && cell.growth < 100) {
                    cell.growth = Math.min(100, (cell.growth || 0) + 25);
                    cell.title = `${cell.title?.split('(')[0] || 'Культура'} (рост: ${cell.growth}%)`;
                    watered++;
                }
            });
        }
        
        if (watered > 0) {
            this.showNotification('💧 Полив', `Полито ${watered} растений! Рост ускорен.`);
            this.renderFarm();
        } else {
            this.showNotification('⚠️ Нечего поливать', 'Нет растений для полива или все уже созрели.');
        }
    }
    
    harvestCrops() {
        console.log('📦 Собираем урожай...');
        
        let harvested = 0;
        let totalCoins = 0;
        
        if (this.farmData) {
            this.farmData.cells.forEach(cell => {
                if (cell.type === 'crop' && cell.growth >= 80) {
                    harvested++;
                    
                    // Разная стоимость в зависимости от типа растения
                    let coins = 20; // Базовая стоимость
                    if (cell.emoji === '🌾') coins = 30; // Пшеница дороже
                    if (cell.emoji === '🥕') coins = 25; // Морковь
                    
                    totalCoins += coins;
                    
                    // Превращаем обратно в расчищенную землю
                    cell.type = 'cleared';
                    cell.emoji = '🟫';
                    cell.color = '#8D6E63';
                    cell.title = 'Расчищенная земля';
                    cell.growth = null;
                }
            });
        }
        
        if (harvested > 0) {
            this.showNotification('📦 Урожай собран!', 
                `Собрано ${harvested} культур\n` +
                `Получено ${totalCoins} монет`);
            
            if (this.userData) {
                this.userData.coins += totalCoins;
                this.updateUserStats();
            }
            
            this.renderFarm();
        } else {
            this.showNotification('⚠️ Нечего собирать', 'Растения еще не созрели. Поливайте их!');
        }
    }
    
    plantCrop() {
        console.log('🌱 Сажаем растения...');
        
        if (!this.userData || this.userData.coins < 10) {
            this.showNotification('⚠️ Недостаточно монет', 'Для посадки растений нужно 10 монет.');
            return;
        }
        
        // Находим вспаханное поле
        if (this.farmData) {
            const emptyCell = this.farmData.cells.find(cell => 
                cell.type === 'plowed'
            );
            
            if (emptyCell) {
                const cropTypes = [
                    { emoji: '🌾', title: 'Пшеница', color: '#8BC34A' },
                    { emoji: '🥕', title: 'Морковь', color: '#FF9800' },
                    { emoji: '🥔', title: 'Картофель', color: '#795548' }
                ];
                
                const crop = cropTypes[Math.floor(Math.random() * cropTypes.length)];
                
                emptyCell.type = 'crop';
                emptyCell.emoji = crop.emoji;
                emptyCell.color = crop.color;
                emptyCell.growth = 10;
                emptyCell.title = `${crop.title} (рост: 10%)`;
                
                this.showNotification('🌱 Посадка', 
                    `${crop.title} посажена!\n` +
                    `Потрачено 10 монет. Через 4 полива будет урожай.`);
                
                // Вычитаем монеты
                this.userData.coins -= 10;
                this.updateUserStats();
                
                this.renderFarm();
            } else {
                this.showNotification('⚠️ Нет места', 'Нет вспаханной земли для посадки! Пройдите уроки 2 и 5.');
            }
        }
    }
    
    buildHouse() {
        console.log('🏠 Строим дом...');
        
        if (!this.userData || this.userData.coins < 100) {
            this.showNotification('⚠️ Недостаточно монет', 'Для строительства дома нужно 100 монет.');
            return;
        }
        
        // Находим расчищенную землю для дома
        if (this.farmData) {
            const emptyCell = this.farmData.cells.find(cell => 
                cell.type === 'cleared' && 
                cell.x >= 2 && cell.x <= 5 && 
                cell.y >= 2 && cell.y <= 5
            );
            
            if (emptyCell) {
                this.userData.coins -= 100;
                this.updateUserStats();
                
                emptyCell.type = 'house';
                emptyCell.emoji = '🏠';
                emptyCell.color = '#FF9800';
                emptyCell.title = 'Дом фермера';
                
                this.showNotification('🏠 Строительство', 
                    'Дом построен!\n' +
                    'Потрачено 100 монет.\n' +
                    'Теперь у вас есть жилье на ферме.');
                
                this.renderFarm();
            } else {
                this.showNotification('⚠️ Нет места', 'Нет подходящего места для строительства дома. Расчистите ферму!');
            }
        }
    }
        
    upgradeFarm() {
        console.log('⬆️ Улучшаем ферму...');
        
        if (!this.userData || this.userData.coins < 500) {
            this.showNotification('⚠️ Недостаточно монет', 'Для улучшения фермы нужно 500 монет.');
            return;
        }
        
        this.userData.coins -= 500;
        this.userData.level += 1;
        this.updateUserStats();
        
        this.showNotification('⭐ Улучшение фермы', 
            'Ферма улучшена!\n' +
            'Потрачено 500 монет.\n' +
            'Уровень повышен!\n' +
            'Открываются новые возможности.');
    }
    
    sellProduce() {
        console.log('💰 Продаем продукцию...');
        
        if (!this.userData) {
            return;
        }
        
        // Базовая продажа
        const saleAmount = Math.floor(Math.random() * 50) + 30;
        this.userData.coins += saleAmount;
        this.updateUserStats();
        
        this.showNotification('💰 Продажа', 
            `Вы продали продукцию за ${saleAmount} монет!\n` +
            `Теперь у вас ${this.userData.coins} монет.`);
    }
    
    clearOutput() {
        const outputEl = document.getElementById('output-text');
        if (outputEl) {
            outputEl.textContent = '';
            const outputContainer = document.getElementById('output-container');
            if (outputContainer) {
                outputContainer.style.display = 'none';
            }
            console.log('🧹 Очищен вывод кода');
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
}

// Создаем глобальный объект приложения
window.codeFarmApp = null;

// Глобальные функции для HTML
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

window.startLesson = (lessonId) => {
    if (window.codeFarmApp) {
        window.codeFarmApp.startLesson(lessonId);
    }
};

// Простая проверка
window.checkApp = () => {
    console.log('Проверка приложения:', {
        appExists: !!window.codeFarmApp,
        lessons: window.codeFarmApp?.lessonsData?.length || 0,
        user: window.codeFarmApp?.userData
    });
    
    if (window.codeFarmApp && !window.codeFarmApp.lessonsData?.length) {
        window.codeFarmApp.loadLessons();
    }
};

// Запускаем приложение при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    console.log('📄 DOM загружен, запускаем CodeFarm...');
    
    try {
        // Создаем и сохраняем глобальный экземпляр
        window.codeFarmApp = new CodeFarmApp();
        
        // Явно привязываем методы
        window.codeFarmApp.handleQuickAction = window.codeFarmApp.handleQuickAction.bind(window.codeFarmApp);
        window.codeFarmApp.startLesson = window.codeFarmApp.startLesson.bind(window.codeFarmApp);
        window.codeFarmApp.showScreen = window.codeFarmApp.showScreen.bind(window.codeFarmApp);
        
        // Инициализируем
        await window.codeFarmApp.init();
        
        console.log('✅ CodeFarm запущен!');
        
        // Сразу загружаем уроки принудительно
        setTimeout(() => {
            if (!window.codeFarmApp.lessonsData || window.codeFarmApp.lessonsData.length === 0) {
                console.log('🔄 Принудительно загружаем уроки...');
                window.codeFarmApp.loadLessons().then(() => {
                    console.log(`✅ Уроки загружены: ${window.codeFarmApp.lessonsData.length}`);
                    window.codeFarmApp.renderLessons();
                });
            }
        }, 500);
        
    } catch (error) {
        console.error('❌ Ошибка запуска приложения:', error);
        this.showSimpleError(error.message);
    }
});

// Простая функция для показа ошибки
function showSimpleError(message) {
    const div = document.createElement('div');
    div.innerHTML = `
        <div style="position: fixed; top: 20px; left: 50%; transform: translateX(-50%); 
                   background: #ff4444; color: white; padding: 15px 20px; border-radius: 8px;
                   z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">
            <strong>❌ Ошибка:</strong> ${message}
            <button onclick="location.reload()" style="margin-left: 15px; padding: 5px 10px;
                    background: white; color: #333; border: none; border-radius: 4px; cursor: pointer;">
                Обновить
            </button>
        </div>
    `;
    document.body.appendChild(div);
}
