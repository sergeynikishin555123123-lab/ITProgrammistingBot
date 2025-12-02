const TelegramBot = require('node-telegram-bot-api');

class CodeFarmTelegramBot {
    constructor(storage, lessons) {
        this.token = process.env.TELEGRAM_BOT_TOKEN || '8048171645:AAEt4N2ivjIoTc1fEg4loPTcnaq_dZlWMfw';
        
        // Всегда используем polling для простоты
        console.log('🔧 Запускаю бота в режиме polling...');
        this.bot = new TelegramBot(this.token, { 
            polling: {
                interval: 300,
                autoStart: true,
                params: {
                    timeout: 10
                }
            }
        });
        
        this.storage = storage;
        this.lessons = lessons;
        
        this.setupCommands();
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
            
            const welcomeMessage = `👋 Привет, ${user.first_name}! Добро пожаловать в CodeFarm! 🚜\n\n`
                + `Я - твой помощник в изучении программирования через фермерство.\n`
                + `Выращивай виртуальную ферму, изучая реальный Python!\n\n`
                + `📊 Твой прогресс:\n`
                + `• Уровень: ${userData.level}\n`
                + `• Монеты: ${userData.coins}\n`
                + `• Опыт: ${userData.experience}\n\n`
                + `Открой веб-приложение чтобы начать:`;
            
            const webAppUrl = `https://${process.env.HOSTNAME || 'localhost:3000'}`;
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { 
                            text: '🎮 Открыть ферму', 
                            web_app: { 
                                url: webAppUrl 
                            } 
                        }
                    ],
                    [
                        { text: '📚 Уроки', callback_data: 'lessons' },
                        { text: '🌾 Моя ферма', callback_data: 'my_farm' }
                    ],
                    [
                        { text: '📊 Статистика', callback_data: 'stats' },
                        { text: 'ℹ️ Помощь', callback_data: 'help' }
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
            
            if (!user || !farm) {
                this.bot.sendMessage(chatId, 'Сначала начните игру с /start');
                return;
            }
            
            let farmMessage = `🌾 <b>Твоя ферма:</b>\n\n`;
            
            if (farm.buildings && farm.buildings.length > 0) {
                farmMessage += `🏗️ <b>Постройки (${farm.buildings.length}):</b>\n`;
                farm.buildings.forEach(building => {
                    const emoji = this.getBuildingEmoji(building.type);
                    farmMessage += `  ${emoji} ${building.type} (уровень ${building.level || 1})\n`;
                });
            } else {
                farmMessage += `🏗️ <b>Постройки:</b> Нет построек\n`;
            }
            
            if (farm.crops && farm.crops.length > 0) {
                farmMessage += `\n🌱 <b>Посадки (${farm.crops.length}):</b>\n`;
                const cropTypes = {};
                farm.crops.forEach(crop => {
                    cropTypes[crop.type] = (cropTypes[crop.type] || 0) + 1;
                });
                
                for (const [type, count] of Object.entries(cropTypes)) {
                    farmMessage += `  ${this.getCropEmoji(type)} ${type}: ${count}\n`;
                }
            }
            
            if (farm.resources) {
                farmMessage += `\n💰 <b>Ресурсы:</b>\n`;
                farmMessage += `  💧 Вода: ${farm.resources.water || 0}/200\n`;
                farmMessage += `  ⚡ Энергия: ${farm.resources.energy || 0}/200\n`;
                farmMessage += `  🌱 Семена: ${farm.resources.seeds || 0}\n`;
                farmMessage += `  🪵 Дерево: ${farm.resources.wood || 0}\n`;
                farmMessage += `  🪨 Камень: ${farm.resources.stone || 0}\n`;
                farmMessage += `  🪙 Монеты: ${user.coins || 0}\n`;
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
                lessonsMessage += `   📖 ${lesson.description}\n`;
                lessonsMessage += `   ⭐ Награда: ${lesson.coins} монет\n\n`;
            });
            
            lessonsMessage += `Всего уроков: ${allLessons.length}\n`;
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
                + `2. Напиши код в редакторе\n`
                + `3. Смотри как меняется ферма\n`
                + `4. Зарабатывай монеты и опыт\n\n`
                + `<b>Для полного опыта:</b>\n`
                + `Открой веб-приложение через кнопку "🎮 Открыть ферму"`;
            
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
            const farm = this.storage.getFarm(userId);
            
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
            statsMessage += `   • Общий счет: ${progress.totalScore || 0}\n\n`;
            
            if (farm) {
                statsMessage += `🌾 <b>Ферма:</b>\n`;
                statsMessage += `   • Построек: ${farm.buildings?.length || 0}\n`;
                statsMessage += `   • Посадок: ${farm.crops?.length || 0}\n`;
                statsMessage += `   • Животных: ${farm.animals?.length || 0}\n`;
            }
            
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
                case 'lessons':
                    this.bot.sendMessage(msg.chat.id, '📚 Открываю список уроков...\nИспользуй /lessons для подробной информации.');
                    break;
                    
                case 'my_farm':
                    this.bot.sendMessage(msg.chat.id, '🌾 Открываю информацию о ферме...\nИспользуй /farm для просмотра.');
                    break;
                    
                case 'stats':
                    this.bot.sendMessage(msg.chat.id, '📊 Открываю статистику...\nИспользуй /stats для подробностей.');
                    break;
                    
                case 'help':
                    this.bot.sendMessage(msg.chat.id, 'ℹ️ Открываю справку...\nИспользуй /help для подробной информации.');
                    break;
                    
                default:
                    this.bot.sendMessage(msg.chat.id, `Выбрано: ${data}`);
            }
            
            this.bot.answerCallbackQuery(callbackQuery.id);
        });
        
        // Обработка текстовых сообщений (не команд)
        this.bot.on('message', (msg) => {
            if (msg.text && msg.text.startsWith('/')) {
                return; // Команды уже обработаны
            }
            
            const text = msg.text?.toLowerCase() || '';
            let response = '';
            
            if (text.includes('привет') || text.includes('hello') || text.includes('hi')) {
                response = `Привет, ${msg.from.first_name}! 🚜\nИспользуй /start чтобы начать игру!`;
            } else if (text.includes('ферма') || text.includes('farm')) {
                response = '🌾 Используй /farm чтобы посмотреть свою ферму!\nИли открой веб-приложение для полного управления.';
            } else if (text.includes('урок') || text.includes('lesson') || text.includes('python')) {
                response = '📚 Используй /lessons чтобы увидеть список уроков!\nНачни с урока 1 чтобы изучить основы.';
            } else if (text.includes('код') || text.includes('программ')) {
                response = '💻 CodeFarm учит программированию на Python через фермерство!\nНачни с /start чтобы попробовать.';
            } else if (text.includes('спасибо') || text.includes('thanks')) {
                response = 'Рад помочь! 🎯\nУдачи в изучении программирования!';
            } else if (text.trim()) {
                response = '🤖 Я CodeFarm бот!\nИспользуй команды:\n/start - Начать игру\n/farm - Ферма\n/lessons - Уроки\n/stats - Статистика\n/help - Помощь';
            }
            
            if (response) {
                this.bot.sendMessage(msg.chat.id, response);
            }
        });
        
        console.log('✅ Команды бота настроены');
    }
    
    getBuildingEmoji(type) {
        const emojis = {
            'house': '🏠',
            'barn': '🏚️',
            'silo': '🗼',
            'greenhouse': '🌿',
            'workshop': '🔨',
            'farmhouse': '🏡',
            'stable': '🐴'
        };
        return emojis[type] || '🏗️';
    }
    
    getCropEmoji(type) {
        const emojis = {
            'wheat': '🌾',
            'carrot': '🥕',
            'potato': '🥔',
            'corn': '🌽',
            'tomato': '🍅',
            'cabbage': '🥬'
        };
        return emojis[type] || '🌱';
    }
    
    handleUpdate(update) {
        // Для polling этот метод не нужен, но оставим для совместимости
        this.bot.processUpdate(update);
    }
    
    sendNotification(userId, message) {
        try {
            this.bot.sendMessage(userId, message, {
                parse_mode: 'HTML'
            });
            return true;
        } catch (error) {
            console.error('Ошибка отправки уведомления:', error.message);
            return false;
        }
    }
}

module.exports = CodeFarmTelegramBot;
