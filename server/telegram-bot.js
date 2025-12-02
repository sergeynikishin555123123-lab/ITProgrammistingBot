const TelegramBot = require('node-telegram-bot-api');

class CodeFarmBot {
    constructor(storage, lessons) {
        this.token = process.env.TELEGRAM_BOT_TOKEN;
        this.webhookUrl = process.env.WEBHOOK_URL || `http://localhost:${process.env.PORT || 3000}/webhook`;
        this.bot = new TelegramBot(this.token);
        this.storage = storage;
        this.lessons = lessons;
        
        this.setupCommands();
    }
    
    async setWebhook() {
        try {
            await this.bot.setWebHook(this.webhookUrl);
            console.log(`✅ Вебхук установлен: ${this.webhookUrl}`);
        } catch (error) {
            console.error('❌ Ошибка установки вебхука:', error);
        }
    }
    
    setupCommands() {
        // Команда /start
        this.bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const user = msg.from;
            
            // Регистрируем пользователя
            const userData = this.storage.getOrCreateUser(user.id, {
                username: user.username,
                firstName: user.first_name,
                lastName: user.last_name
            });
            
            const welcomeMessage = `👋 Привет, ${user.first_name}! Добро пожаловать в CodeFarm! 🚜\n\n`
                + `Я - твой помощник в изучении программирования через фермерство.\n`
                + `Выращивай виртуальную ферму, изучая реальный Python!\n\n`
                + `📊 Твой прогресс:\n`
                + `• Уровень: ${userData.level}\n`
                + `• Монеты: ${userData.coins}\n`
                + `• Опыт: ${userData.experience}\n\n`
                + `Нажми кнопку ниже чтобы начать!`;
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { 
                            text: '🎮 Открыть ферму', 
                            web_app: { 
                                url: process.env.WEBAPP_URL || `http://localhost:${process.env.PORT || 3000}?tg=${user.id}` 
                            } 
                        }
                    ],
                    [
                        { text: '📚 Мои уроки', callback_data: 'my_lessons' },
                        { text: '🌾 Моя ферма', callback_data: 'my_farm' }
                    ],
                    [
                        { text: '📊 Статистика', callback_data: 'stats' },
                        { text: '❓ Помощь', callback_data: 'help' }
                    ]
                ]
            };
            
            this.bot.sendMessage(chatId, welcomeMessage, {
                reply_markup: keyboard,
                parse_mode: 'HTML'
            });
        });
        
        // Команда /farm
        this.bot.onText(/\/farm/, async (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            
            const farm = this.storage.getFarm(userId.toString());
            const user = this.storage.getUser(userId.toString());
            
            let farmMessage = `🌾 <b>Твоя ферма:</b>\n\n`;
            
            if (farm.buildings.length > 0) {
                farmMessage += `🏗️ <b>Постройки (${farm.buildings.length}):</b>\n`;
                farm.buildings.forEach(building => {
                    farmMessage += `  • ${this.getBuildingEmoji(building.type)} ${building.type} (уровень ${building.level})\n`;
                });
            }
            
            if (farm.crops.length > 0) {
                farmMessage += `\n🌱 <b>Посадки (${farm.crops.length}):</b>\n`;
                farm.crops.slice(0, 5).forEach(crop => {
                    const emoji = crop.growth >= 100 ? '✅' : '🌱';
                    farmMessage += `  ${emoji} ${crop.type}: ${crop.growth}%\n`;
                });
                
                if (farm.crops.length > 5) {
                    farmMessage += `  ... и еще ${farm.crops.length - 5}\n`;
                }
            }
            
            farmMessage += `\n💰 <b>Ресурсы:</b>\n`;
            farmMessage += `  • 💧 Вода: ${farm.resources.water}/200\n`;
            farmMessage += `  • ⚡ Энергия: ${farm.resources.energy}/200\n`;
            farmMessage += `  • 🌱 Семена: ${farm.resources.seeds}\n`;
            farmMessage += `  • 🪵 Дерево: ${farm.resources.wood}\n`;
            farmMessage += `  • 🪨 Камень: ${farm.resources.stone}\n`;
            farmMessage += `  • 🪙 Монеты: ${user?.coins || 0}\n`;
            
            this.bot.sendMessage(chatId, farmMessage, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚜 Управлять фермой', web_app: { url: `${process.env.WEBAPP_URL || `http://localhost:${process.env.PORT || 3000}`}/farm?tg=${userId}` } }]
                    ]
                }
            });
        });
        
        // Команда /lessons
        this.bot.onText(/\/lessons/, async (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id.toString();
            
            const allLessons = this.lessons.getAllLessons();
            const userProgress = this.storage.getUserProgress(userId);
            
            let lessonsMessage = `📚 <b>Твои уроки:</b>\n\n`;
            
            // Показываем первые 5 уроков
            allLessons.slice(0, 5).forEach((lesson, index) => {
                const progress = userProgress.progress?.[lesson.id];
                const status = progress?.status === 'completed' ? '✅' : 
                              progress?.status === 'in-progress' ? '🔄' : '🔒';
                
                lessonsMessage += `${status} <b>Урок ${index + 1}:</b> ${lesson.title}\n`;
                if (progress?.status === 'completed') {
                    lessonsMessage += `   ⭐ Оценка: ${progress.score}/100\n`;
                }
                lessonsMessage += '\n';
            });
            
            lessonsMessage += `Всего уроков: ${allLessons.length}\n`;
            lessonsMessage += `Пройдено: ${userProgress.completedLessons}`;
            
            this.bot.sendMessage(chatId, lessonsMessage, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎮 Продолжить обучение', web_app: { url: `${process.env.WEBAPP_URL || `http://localhost:${process.env.PORT || 3000}`}/lessons?tg=${userId}` } }]
                    ]
                }
            });
        });
        
        // Команда /stats
        this.bot.onText(/\/stats/, async (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id.toString();
            
            const stats = this.storage.getUserStats(userId);
            
            let statsMessage = `📊 <b>Твоя статистика:</b>\n\n`;
            statsMessage += `👤 <b>Игрок:</b> ${stats.user.firstName}\n`;
            statsMessage += `⭐ <b>Уровень:</b> ${stats.user.level}\n`;
            statsMessage += `✨ <b>Опыт:</b> ${stats.user.experience}\n`;
            statsMessage += `🪙 <b>Монеты:</b> ${stats.user.coins}\n\n`;
            
            statsMessage += `📚 <b>Прогресс обучения:</b>\n`;
            statsMessage += `   • Пройдено уроков: ${stats.progress.completedLessons}\n`;
            statsMessage += `   • Общий счет: ${stats.progress.totalScore}\n\n`;
            
            statsMessage += `🌾 <b>Ферма:</b>\n`;
            statsMessage += `   • Построек: ${stats.farmStats.buildings}\n`;
            statsMessage += `   • Посадок: ${stats.farmStats.crops}\n`;
            statsMessage += `   • Животных: ${stats.farmStats.animals}\n\n`;
            
            statsMessage += `🏆 <b>Достижения:</b> ${stats.achievements}`;
            
            this.bot.sendMessage(chatId, statsMessage, { parse_mode: 'HTML' });
        });
        
        // Команда /help
        this.bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            
            const helpText = `🤖 <b>CodeFarm Bot - Помощь</b>\n\n`
                + `<b>Основные команды:</b>\n`
                + `/start - Начать игру\n`
                + `/farm - Показать ферму\n`
                + `/lessons - Показать уроки\n`
                + `/stats - Статистика\n`
                + `/help - Эта справка\n\n`
                + `<b>Как играть:</b>\n`
                + `1. Начни с урока 1\n`
                + `2. Пиши код в редакторе\n`
                + `3. Смотри как меняется ферма\n`
                + `4. Зарабатывай монеты и опыт\n\n`
                + `<b>Веб-приложение:</b>\n`
                + `Для полного опыта открой веб-приложение через кнопку "Открыть ферму"`;
            
            this.bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
        });
        
        // Обработка callback-ов
        this.bot.on('callback_query', async (callbackQuery) => {
            const msg = callbackQuery.message;
            const data = callbackQuery.data;
            const userId = callbackQuery.from.id.toString();
            
            switch (data) {
                case 'my_lessons':
                    const allLessons = this.lessons.getAllLessons();
                    const progress = this.storage.getUserProgress(userId);
                    
                    let lessonsList = '📚 <b>Твои уроки:</b>\n\n';
                    
                    allLessons.forEach((lesson, index) => {
                        const lessonProgress = progress.progress?.[lesson.id];
                        const status = lessonProgress?.status === 'completed' ? '✅' : 
                                      lessonProgress?.status === 'in-progress' ? '🔄' : '🔒';
                        
                        lessonsList += `${status} Урок ${index + 1}: ${lesson.title}\n`;
                    });
                    
                    this.bot.sendMessage(msg.chat.id, lessonsList, { 
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🎮 Открыть уроки', web_app: { url: `${process.env.WEBAPP_URL || `http://localhost:${process.env.PORT || 3000}`}/lessons?tg=${userId}` } }]
                            ]
                        }
                    });
                    break;
                    
                case 'my_farm':
                    const farm = this.storage.getFarm(userId);
                    
                    let farmInfo = `🌾 <b>Твоя ферма:</b>\n\n`;
                    farmInfo += `🏠 Домов: ${farm.buildings.filter(b => b.type === 'house').length}\n`;
                    farmInfo += `🌱 Посадок: ${farm.crops.length}\n`;
                    farmInfo += `🪙 Монеты: ${this.storage.getUser(userId)?.coins || 0}\n`;
                    
                    this.bot.sendMessage(msg.chat.id, farmInfo, { 
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🚜 Открыть ферму', web_app: { url: `${process.env.WEBAPP_URL || `http://localhost:${process.env.PORT || 3000}`}/farm?tg=${userId}` } }]
                            ]
                        }
                    });
                    break;
                    
                case 'stats':
                    const userStats = this.storage.getUserStats(userId);
                    
                    let statsMsg = `📊 <b>Статистика:</b>\n\n`;
                    statsMsg += `Уровень: ${userStats.user.level}\n`;
                    statsMsg += `Опыт: ${userStats.user.experience}\n`;
                    statsMsg += `Монеты: ${userStats.user.coins}\n`;
                    statsMsg += `Пройдено уроков: ${userStats.progress.completedLessons}\n`;
                    statsMsg += `Достижений: ${userStats.achievements}`;
                    
                    this.bot.sendMessage(msg.chat.id, statsMsg, { parse_mode: 'HTML' });
                    break;
                    
                case 'help':
                    const helpMsg = `Нужна помощь? Вот что можно сделать:\n\n`
                        + `🎮 <b>Открой веб-приложение</b> для полного опыта\n`
                        + `📚 <b>Начни с первого урока</b> - основы Python\n`
                        + `🌾 <b>Ухаживай за фермой</b> чтобы зарабатывать монеты\n\n`
                        + `Используй команды /farm, /lessons, /stats`;
                    
                    this.bot.sendMessage(msg.chat.id, helpMsg, { parse_mode: 'HTML' });
                    break;
            }
            
            this.bot.answerCallbackQuery(callbackQuery.id);
        });
        
        // Обработка текстовых сообщений
        this.bot.on('message', async (msg) => {
            if (msg.text && msg.text.startsWith('/')) {
                return; // Команды уже обработаны
            }
            
            // Простые ответы на сообщения
            const text = msg.text?.toLowerCase() || '';
            let response = '';
            
            if (text.includes('привет') || text.includes('hello') || text.includes('hi')) {
                response = `Привет, ${msg.from.first_name}! Как твоя ферма? 🚜`;
            } else if (text.includes('ферма') || text.includes('farm')) {
                response = 'Открой ферму через веб-приложение для управления! 🌾';
            } else if (text.includes('урок') || text.includes('lesson')) {
                response = 'Уроки ждут тебя в веб-приложении! Начни с первого урока Python. 📚';
            } else if (text.includes('python') || text.includes('код')) {
                response = 'Python - отличный выбор! Начни обучение с урока 1 в CodeFarm. 🐍';
            } else if (text.includes('спасибо') || text.includes('thanks')) {
                response = 'Всегда рад помочь! Удачи в обучении! 🌟';
            } else if (text.trim()) {
                response = 'Я понимаю команды типа /start, /farm, /lessons. Для полного опыта открой веб-приложение! 🎮';
            }
            
            if (response) {
                this.bot.sendMessage(msg.chat.id, response);
            }
        });
    }
    
    getBuildingEmoji(type) {
        const emojis = {
            'house': '🏠',
            'barn': '🏚️',
            'silo': '🗼',
            'greenhouse': '🌿',
            'workshop': '🔨',
            'windmill': '⚡'
        };
        return emojis[type] || '🏗️';
    }
    
    handleUpdate(update) {
        this.bot.processUpdate(update);
    }
}

module.exports = CodeFarmBot;
