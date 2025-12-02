// Основной файл фронтенда - будет React минимум
class CodeFarmApp {
    constructor() {
        this.userId = null;
        this.farmData = null;
        this.currentLesson = null;
        this.socket = null;
        
        this.init();
    }
    
    async init() {
        // Проверяем авторизацию через Telegram
        await this.checkTelegramAuth();
        
        // Загружаем данные пользователя
        await this.loadUserData();
        
        // Инициализируем WebSocket
        this.initWebSocket();
        
        // Загружаем 3D сцену фермы
        this.initFarmScene();
        
        // Инициализируем редактор кода
        this.initCodeEditor();
        
        // Загружаем уроки
        await this.loadLessons();
    }
    
    async checkTelegramAuth() {
        // Проверяем, открыто ли через Telegram Web App
        if (window.Telegram?.WebApp) {
            const tg = window.Telegram.WebApp;
            tg.expand();
            tg.ready();
            
            // Получаем данные пользователя из Telegram
            const user = tg.initDataUnsafe?.user;
            if (user) {
                this.userId = user.id;
                
                // Регистрируем пользователя на сервере
                const response = await fetch('/api/user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ telegramId: user.id })
                });
                
                const userData = await response.json();
                this.userData = userData;
                
                // Показываем приветствие
                this.showWelcomeMessage(user.first_name);
            }
        } else {
            // Режим разработки или прямой доступ через браузер
            this.userId = localStorage.getItem('codefarm_user_id') || 'demo-user';
            this.showWelcomeMessage('Гость');
        }
    }
    
    showWelcomeMessage(name) {
        const welcomeElement = document.getElementById('welcome-message');
        if (welcomeElement) {
            welcomeElement.innerHTML = `
                <h1>👨‍🌾 Добро пожаловать, ${name}!</h1>
                <p>Начни свой путь фермера-программиста с первого урока!</p>
            `;
        }
    }
    
    async loadUserData() {
        try {
            const response = await fetch(`/api/user/${this.userId}/progress`);
            const data = await response.json();
            
            // Обновляем интерфейс данными пользователя
            this.updateUserInterface(data);
            
            // Загружаем состояние фермы
            await this.loadFarmState();
            
        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
        }
    }
    
    async loadFarmState() {
        try {
            const response = await fetch(`/api/farm/${this.userId}`);
            this.farmData = await response.json();
            
            // Обновляем 3D сцену фермы
            if (this.farmScene) {
                this.farmScene.updateFarm(this.farmData);
            }
            
        } catch (error) {
            console.error('Ошибка загрузки фермы:', error);
        }
    }
    
    initWebSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('WebSocket подключен');
            this.socket.emit('join-farm', this.userId);
        });
        
        this.socket.on('farm-update', (data) => {
            // Обновляем ферму при изменениях
            this.handleFarmUpdate(data);
        });
        
        this.socket.on('disconnect', () => {
            console.log('WebSocket отключен');
        });
    }
    
    initFarmScene() {
        // Инициализация Three.js сцены фермы
        this.farmScene = new Farm3DScene('farm-container', this.userId);
        this.farmScene.init();
    }
    
    initCodeEditor() {
        // Инициализация редактора кода (используем Monaco или CodeMirror)
        this.codeEditor = new CodeFarmEditor('code-editor');
        this.codeEditor.init();
    }
    
    async loadLessons() {
        try {
            const response = await fetch('/api/lessons');
            this.lessons = await response.json();
            
            // Показываем список уроков
            this.renderLessonsList();
            
        } catch (error) {
            console.error('Ошибка загрузки уроков:', error);
        }
    }
    
    renderLessonsList() {
        const container = document.getElementById('lessons-list');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.lessons.forEach((lesson, index) => {
            const lessonElement = document.createElement('div');
            lessonElement.className = 'lesson-card';
            lessonElement.innerHTML = `
                <div class="lesson-header">
                    <span class="lesson-number">Урок ${index + 1}</span>
                    <span class="lesson-status" data-lesson-id="${lesson.id}"></span>
                </div>
                <h3>${lesson.title}</h3>
                <p>${lesson.description}</p>
                <button onclick="app.startLesson('${lesson.id}')" class="start-lesson-btn">
                    Начать урок
                </button>
            `;
            container.appendChild(lessonElement);
        });
    }
    
    async startLesson(lessonId) {
        this.currentLesson = this.lessons.find(l => l.id === lessonId);
        
        if (!this.currentLesson) return;
        
        // Показываем интерфейс урока
        this.showLessonInterface();
        
        // Загружаем теорию и задание
        this.loadLessonContent();
    }
    
    showLessonInterface() {
        // Переключаем интерфейс на режим урока
        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('lesson-interface').style.display = 'block';
    }
    
    loadLessonContent() {
        const theoryElement = document.getElementById('lesson-theory');
        const taskElement = document.getElementById('lesson-task');
        const codeEditor = document.getElementById('code-editor');
        
        if (theoryElement && this.currentLesson) {
            theoryElement.innerHTML = `
                <h2>${this.currentLesson.title}</h2>
                <div class="theory-content">${this.currentLesson.theory}</div>
            `;
        }
        
        if (taskElement && this.currentLesson) {
            taskElement.innerHTML = `
                <h3>📝 Задание:</h3>
                <p>${this.currentLesson.task}</p>
                <div class="task-example">
                    <h4>Пример кода:</h4>
                    <pre><code>${this.currentLesson.exampleCode}</code></pre>
                </div>
            `;
        }
        
        if (codeEditor && this.codeEditor) {
            this.codeEditor.setValue(this.currentLesson.initialCode || '');
        }
    }
    
    async submitSolution() {
        const code = this.codeEditor.getValue();
        
        if (!code.trim()) {
            this.showMessage('Введите код для выполнения', 'error');
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
                this.showMessage('🎉 Урок пройден успешно!', 'success');
                
                // Обновляем ферму
                if (result.farmUpdate) {
                    this.farmScene.updateFarm(result.farmUpdate);
                }
                
                // Показываем результаты
                this.showLessonResults(result);
                
            } else {
                this.showMessage('❌ Есть ошибки в коде', 'error');
                this.showCodeErrors(result.errors);
            }
            
        } catch (error) {
            console.error('Ошибка отправки решения:', error);
            this.showMessage('Ошибка соединения с сервером', 'error');
        }
    }
    
    showMessage(text, type = 'info') {
        // Показываем всплывающее сообщение
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        messageElement.textContent = text;
        messageElement.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
            color: white;
            border-radius: 5px;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(messageElement);
        
        setTimeout(() => {
            messageElement.remove();
        }, 3000);
    }
    
    handleFarmUpdate(data) {
        // Обработка обновлений фермы в реальном времени
        console.log('Farm update received:', data);
        
        if (data.type === 'lesson-completed') {
            // Анимация на ферме при завершении урока
            this.farmScene.playAnimation('lesson-completed');
        }
        
        // Обновляем интерфейс фермы
        if (this.farmData) {
            Object.assign(this.farmData, data.farmData);
            this.updateFarmUI();
        }
    }
    
    updateFarmUI() {
        // Обновляем UI фермы
        const coinsElement = document.getElementById('coins-count');
        const levelElement = document.getElementById('user-level');
        const expElement = document.getElementById('user-exp');
        
        if (coinsElement && this.userData) {
            coinsElement.textContent = this.userData.coins || 0;
        }
        
        if (levelElement && this.userData) {
            levelElement.textContent = `Уровень ${this.userData.level || 1}`;
        }
        
        if (expElement && this.userData) {
            expElement.textContent = `Опыт: ${this.userData.experience || 0}`;
        }
    }
}

// Инициализация приложения при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.app = new CodeFarmApp();
});
