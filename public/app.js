/**
 * 🎯 ОСНОВНАЯ ЛОГИКА ПРИЛОЖЕНИЯ
 */

class CodeFarmApp {
    constructor() {
        this.user = null;
        this.currentLesson = 1;
        this.lessons = {};
        this.init();
    }
    
    async init() {
        // Проверка авторизации
        await this.checkAuth();
        
        // Загрузка уроков
        await this.loadLessons();
        
        // Загрузка прогресса
        await this.loadProgress();
        
        // Инициализация UI
        this.initUI();
        
        // Запуск урока
        this.loadLesson(this.currentLesson);
    }
    
    async checkAuth() {
        // Проверяем Telegram WebApp
        if (window.Telegram && Telegram.WebApp) {
            this.user = Telegram.WebApp.initDataUnsafe.user;
            this.updateUserInfo();
            return;
        }
        
        // Или проверяем localStorage
        const savedUser = localStorage.getItem('codefarm_user');
        if (savedUser) {
            this.user = JSON.parse(savedUser);
            this.updateUserInfo();
        }
    }
    
    updateUserInfo() {
        if (this.user) {
            document.getElementById('username').textContent = this.user.first_name || 'Игрок';
            document.getElementById('login-btn').style.display = 'none';
        }
    }
    
    async loadLessons() {
        try {
            const response = await fetch('/api/lessons');
            this.lessons = await response.json();
            console.log('Уроки загружены:', Object.keys(this.lessons).length);
        } catch (error) {
            console.error('Ошибка загрузки уроков:', error);
        }
    }
    
    async loadProgress() {
        try {
            const response = await fetch('/api/progress');
            const progress = await response.json();
            this.currentLesson = progress.current_lesson || 1;
            
            // Обновляем UI
            document.getElementById('coins').textContent = progress.coins || 0;
            document.getElementById('level').textContent = progress.level || 1;
        } catch (error) {
            console.error('Ошибка загрузки прогресса:', error);
        }
    }
    
    loadLesson(lessonId) {
        const lesson = this.lessons[lessonId];
        if (!lesson) {
            console.error('Урок не найден:', lessonId);
            return;
        }
        
        // Обновляем UI
        document.getElementById('lesson-title').textContent = `Урок ${lessonId}: ${lesson.title}`;
        document.getElementById('theory-content').innerHTML = this.formatTheory(lesson.theory);
        document.getElementById('code-input').value = lesson.initial_code || '# Напиши свой код здесь';
        
        // Обновляем прогресс
        const progress = (lessonId / Object.keys(this.lessons).length) * 100;
        document.getElementById('lesson-progress').value = progress;
        document.getElementById('progress-text').textContent = `${Math.round(progress)}%`;
        
        // Обновляем навигацию
        document.getElementById('prev-lesson').disabled = lessonId === 1;
        document.getElementById('next-lesson').disabled = lessonId === Object.keys(this.lessons).length;
        
        // Сохраняем текущий урок
        this.currentLesson = lessonId;
        
        // Обновляем ферму в соответствии с уроком
        this.updateFarmForLesson(lessonId);
    }
    
    formatTheory(text) {
        // Простой Markdown парсер
        return text
            .replace(/### (.*?)\n/g, '<h4>$1</h4>')
            .replace(/## (.*?)\n/g, '<h3>$1</h3>')
            .replace(/# (.*?)\n/g, '<h2>$1</h2>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }
    
    async runCode() {
        const code = document.getElementById('code-input').value;
        const output = document.getElementById('code-output');
        const testResults = document.getElementById('test-results');
        
        output.innerHTML = '🚀 Запускаю код...';
        testResults.innerHTML = '';
        
        try {
            const response = await fetch('/api/run-code', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    code: code,
                    lesson_id: this.currentLesson
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                output.innerHTML = `<pre style="color: #4CAF50">✅ Успешно!\n${result.output}</pre>`;
                testResults.innerHTML = this.formatTestResults(result.tests);
                
                // Если все тесты пройдены, показываем кнопку продолжения
                if (result.all_passed) {
                    this.showSuccess();
                }
            } else {
                output.innerHTML = `<pre style="color: #F44336">❌ Ошибка:\n${result.error}</pre>`;
            }
        } catch (error) {
            output.innerHTML = `<pre style="color: #F44336">❌ Ошибка сети: ${error.message}</pre>`;
        }
    }
    
    formatTestResults(tests) {
        if (!tests || tests.length === 0) return '';
        
        let html = '<div class="tests">';
        tests.forEach(test => {
            const icon = test.passed ? '✅' : '❌';
            html += `<div class="test ${test.passed ? 'passed' : 'failed'}">
                ${icon} ${test.name}: ${test.message}
            </div>`;
        });
        html += '</div>';
        return html;
    }
    
    showSuccess() {
        // Показываем анимацию успеха
        const successDiv = document.createElement('div');
        successDiv.className = 'success-animation';
        successDiv.innerHTML = `
            <div style="text-align: center; padding: 20px; background: #4CAF50; color: white; border-radius: 10px; margin: 20px 0;">
                <h3>🎉 Отлично! Урок пройден!</h3>
                <p>+10 монет 💰</p>
                <p>+1 уровень фермы 🏆</p>
                <button onclick="app.nextLesson()" class="btn" style="margin-top: 10px;">
                    Продолжить обучение →
                </button>
            </div>
        `;
        
        document.querySelector('.result-section').appendChild(successDiv);
        
        // Обновляем ферму
        this.updateFarmProgress();
    }
    
    updateFarmForLesson(lessonId) {
        if (!window.farm) return;
        
        // В зависимости от урока обновляем ферму
        switch(lessonId) {
            case 1:
                window.farm.updateFarm({ level: 1 });
                break;
            case 5:
                window.farm.addBuilding('house', 1, 1);
                break;
            case 10:
                window.farm.addAnimal('chicken', 3, 3);
                window.farm.addAnimal('chicken', 4, 3);
                break;
            case 15:
                window.farm.plantCrop(5, 5, 'wheat');
                window.farm.plantCrop(6, 5, 'wheat');
                break;
        }
    }
    
    updateFarmProgress() {
        // Обновляем статистику фермы
        const stats = {
            plants: Math.floor(Math.random() * 10) + this.currentLesson,
            buildings: Math.floor(this.currentLesson / 5),
            bots: Math.floor(this.currentLesson / 10)
        };
        
        document.getElementById('plants-count').textContent = stats.plants;
        document.getElementById('buildings-count').textContent = stats.buildings;
        document.getElementById('bots-count').textContent = stats.bots;
    }
    
    nextLesson() {
        if (this.currentLesson < Object.keys(this.lessons).length) {
            this.currentLesson++;
            this.loadLesson(this.currentLesson);
        }
    }
    
    prevLesson() {
        if (this.currentLesson > 1) {
            this.currentLesson--;
            this.loadLesson(this.currentLesson);
        }
    }
    
    initUI() {
        // Кнопка запуска кода
        document.getElementById('run-code').addEventListener('click', () => this.runCode());
        
        // Кнопка отправки
        document.getElementById('submit-code').addEventListener('click', () => this.runCode());
        
        // Навигация
        document.getElementById('next-lesson').addEventListener('click', () => this.nextLesson());
        document.getElementById('prev-lesson').addEventListener('click', () => this.prevLesson());
        
        // Ежедневная награда
        document.getElementById('claim-daily').addEventListener('click', () => this.claimDaily());
        
        // Telegram логин
        document.getElementById('login-btn').addEventListener('click', () => this.loginWithTelegram());
        
        // Подсказки
        document.getElementById('hint-btn').addEventListener('click', () => this.showHint());
    }
    
    async claimDaily() {
        try {
            const response = await fetch('/api/daily-reward', {
                method: 'POST'
            });
            const result = await response.json();
            
            if (result.success) {
                alert(`🎁 Получено: ${result.reward} монет!`);
                this.loadProgress();
            }
        } catch (error) {
            console.error('Ошибка получения награды:', error);
        }
    }
    
    loginWithTelegram() {
        // Простая ссылка на бота
        window.open('https://t.me/codefarm_bot', '_blank');
    }
    
    showHint() {
        const lesson = this.lessons[this.currentLesson];
        if (lesson && lesson.hints && lesson.hints.length > 0) {
            const hint = lesson.hints[0]; // Берем первую подсказку
            alert(`💡 Подсказка: ${hint}`);
        } else {
            alert('Для этого урока нет подсказок');
        }
    }
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', () => {
    window.app = new CodeFarmApp();
});
