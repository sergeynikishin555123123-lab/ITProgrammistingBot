const TelegramBot = require('node-telegram-bot-api');

class CodeFarmTelegramBot {
    constructor(storage, lessons) {
        this.token = process.env.TELEGRAM_BOT_TOKEN || '8048171645:AAEt4N2ivjIoTc1fEg4loPTcnaq_dZlWMfw';
        
        // Используем polling если нет корректного домена для вебхука
        const useWebhook = process.env.NODE_ENV === 'production' && process.env.WEBHOOK_DOMAIN;
        
        if (useWebhook) {
            this.bot = new TelegramBot(this.token);
            this.setupWebhook();
        } else {
            // Используем polling для разработки
            console.log('🔧 Использую polling вместо webhook (режим разработки)');
            this.bot = new TelegramBot(this.token, { polling: true });
        }
        
        this.storage = storage;
        this.lessons = lessons;
        
        this.setupCommands();
    }
    
    setupWebhook() {
        if (!process.env.WEBHOOK_DOMAIN) {
            console.log('⚠️ WEBHOOK_DOMAIN не задан, пропускаю настройку вебхука');
            return;
        }
        
        const webhookUrl = `${process.env.WEBHOOK_DOMAIN}/webhook`;
        
        this.bot.setWebHook(webhookUrl)
            .then(() => {
                console.log(`✅ Вебхук установлен: ${webhookUrl}`);
            })
            .catch(error => {
                console.error('❌ Ошибка установки вебхука:', error.message);
                console.log('🔄 Переключаюсь на polling...');
                // Если вебхук не работает, переключаемся на polling
                this.bot.stopPolling();
                this.bot = new TelegramBot(this.token, { polling: true });
                this.setupCommands();
            });
    }
    
    setupCommands() {
        // Команда /start
        this.bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const user = msg.from;
            
            // Регистрируем пользователя
            const userData = this.storage.getOrCreateUser(user.id.toString(), {
                username: user.username,
                firstName: user.first_name,
                lastName: user.last_name
            });
            
            const baseUrl = process.env.BASE_URL || 'https://sergeynikishin555123123-lab-itprogrammistingbot-52b2.twc1.net';
            
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
                                url: baseUrl 
                            } 
                        }
                    ],
                    [
                        { text: '📚 Уроки', callback_data: 'open_lessons' },
                        { text: '🌾 Ферма', callback_data: 'open_farm' }
                    ]
                ]
            };
            
            this.bot.sendMessage(chatId, welcomeMessage, {
                reply_markup: keyboard,
                parse_mode: 'HTML'
            });
        });
        
        // Команда /farm
        this.bot.onText(/\/farm/, (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id.toString();
            
            const farm = this.storage.getFarm(userId);
            const user = this.storage.getUser(userId);
            
            let farmMessage = `🌾 <b>Твоя ферма:</b>\n\n`;
            
            if (farm.buildings && farm.buildings.length > 0) {
                farmMessage += `🏗️ <b>Постройки (${farm.buildings.length}):</b>\n`;
                farm.buildings.forEach(building => {
                    const emoji = this.getBuildingEmoji(building.type);
                    farmMessage += `  ${emoji} ${building.type} (уровень ${building.level || 1})\n`;
                });
            }
            
            if (farm.resources) {
                farmMessage += `\n💰 <b>Ресурсы:</b>\n`;
                farmMessage += `  💧 Вода: ${farm.resources.water || 0}/200\n`;
                farmMessage += `  ⚡ Энергия: ${farm.resources.energy || 0}/200\n`;
                farmMessage += `  🪙 Монеты: ${user?.coins || 0}\n`;
            }
            
            this.bot.sendMessage(chatId, farmMessage, {
                parse_mode: 'HTML'
            });
        });
        
        // Команда /lessons
        this.bot.onText(/\/lessons/, (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id.toString();
            
            const allLessons = this.lessons.getAllLessons();
            const userProgress = this.storage.getUserProgress(userId);
            
            let lessonsMessage = `📚 <b>Доступные уроки:</b>\n\n`;
            
            // Показываем первые 5 уроков
            allLessons.slice(0, 5).forEach((lesson, index) => {
                const progress = userProgress.progress?.[lesson.id];
                const status = progress?.status === 'completed' ? '✅' : 
                              progress?.status === 'in-progress' ? '🔄' : '🔒';
                
                lessonsMessage += `${status} <b>Урок ${index + 1}:</b> ${lesson.title}\n`;
            });
            
            lessonsMessage += `\nВсего уроков: ${allLessons.length}\n`;
            lessonsMessage += `Пройдено: ${userProgress.completedLessons || 0}`;
            
            this.bot.sendMessage(chatId, lessonsMessage, {
                parse_mode: 'HTML'
            });
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
                + `4. Зарабатывай монеты и опыт`;
            
            this.bot.sendMessage(chatId, helpText, {
                parse_mode: 'HTML'
            });
        });
        
        // Команда /stats
        this.bot.onText(/\/stats/, (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id.toString();
            
            const user = this.storage.getUser(userId);
            const progress = this.storage.getUserProgress(userId);
            
            if (!user) {
                this.bot.sendMessage(chatId, 'Сначала начните игру с /start');
                return;
            }
            
            let statsMessage = `📊 <b>Твоя статистика:</b>\n\n`;
            statsMessage += `👤 <b>Игрок:</b> ${user.firstName || 'Фермер'}\n`;
            statsMessage += `⭐ <b>Уровень:</b> ${user.level || 1}\n`;
            statsMessage += `✨ <b>Опыт:</b> ${user.experience || 0}\n`;
            statsMessage += `🪙 <b>Монеты:</b> ${user.coins || 0}\n\n`;
            statsMessage += `📚 <b>Прогресс обучения:</b>\n`;
            statsMessage += `   • Пройдено уроков: ${progress.completedLessons || 0}\n`;
            statsMessage += `   • Общий счет: ${progress.totalScore || 0}\n`;
            
            this.bot.sendMessage(chatId, statsMessage, {
                parse_mode: 'HTML'
            });
        });
        
        // Обработка callback-ов
        this.bot.on('callback_query', (callbackQuery) => {
            const msg = callbackQuery.message;
            const data = callbackQuery.data;
            const userId = callbackQuery.from.id.toString();
            
            switch (data) {
                case 'open_farm':
                    this.bot.sendMessage(msg.chat.id, 'Открываю ферму...', {
                        reply_markup: {
                            inline_keyboard: [
                                [{ 
                                    text: '🚜 Управлять фермой', 
                                    web_app: { 
                                        url: `${process.env.WEBAPP_URL || 'https://sergeynikishin555123123-lab-itprogrammistingbot-52b2.twc1.net'}/farm` 
                                    } 
                                }]
                            ]
                        }
                    });
                    break;
                    
                case 'open_lessons':
                    this.bot.sendMessage(msg.chat.id, 'Открываю уроки...', {
                        reply_markup: {
                            inline_keyboard: [
                                [{ 
                                    text: '📚 Изучать уроки', 
                                    web_app: { 
                                        url: `${process.env.WEBAPP_URL || 'https://sergeynikishin555123123-lab-itprogrammistingbot-52b2.twc1.net'}/lessons` 
                                    } 
                                }]
                            ]
                        }
                    });
                    break;
            }
            
            this.bot.answerCallbackQuery(callbackQuery.id);
        });
        
        // Обработка текстовых сообщений (не команд)
        this.bot.on('message', (msg) => {
            if (msg.text && msg.text.startsWith('/')) {
                return; // Команды уже обработаны
            }
            
            // Простые ответы на сообщения
            const text = msg.text?.toLowerCase() || '';
            let response = '';
            
            if (text.includes('привет') || text.includes('hello') || text.includes('hi')) {
                response = `Привет, ${msg.from.first_name}! Как твоя ферма? 🚜`;
            } else if (text.includes('ферма') || text.includes('farm')) {
                response = 'Открой ферму через веб-приложение для управления! 🌾\nИспользуй /farm для быстрого просмотра.';
            } else if (text.includes('урок') || text.includes('lesson')) {
                response = 'Уроки ждут тебя! Используй /lessons чтобы увидеть прогресс. 📚';
            } else if (text.includes('python') || text.includes('код')) {
                response = 'Python - отличный выбор! Начни обучение с урока 1. 🐍';
            } else if (text.includes('спасибо') || text.includes('thanks')) {
                response = 'Всегда рад помочь! Удачи в обучении! 🌟';
            } else if (text.trim()) {
                response = 'Используй команды: /start, /farm, /lessons, /stats, /help\nДля полного опыта открой веб-приложение! 🎮';
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
            'workshop': '🔨'
        };
        return emojis[type] || '🏗️';
    }
    
    handleUpdate(update) {
        this.bot.processUpdate(update);
    }
    
    sendNotification(userId, message) {
        // Отправка уведомления пользователю
        this.bot.sendMessage(userId, message, {
            parse_mode: 'HTML'
        });
    }
}

module.exports = CodeFarmTelegramBot;
