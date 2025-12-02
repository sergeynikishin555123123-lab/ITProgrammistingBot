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
                + `<b>Основные команды:</b>\n`
                + `/farm - Показать ферму\n`
                + `/lessons - Список уроков\n`
                + `/stats - Статистика\n`
                + `/help - Помощь\n\n`
                + `Для полного опыта открой веб-версию:\n`
                + `https://${process.env.HOSTNAME || 'localhost:3000'}`;
            
            const keyboard = {
                inline_keyboard: [
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
                parse_mode: 'HTML',
                disable_web_page_preview: true
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
                farm.buildings.forEach((building, index) => {
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
            } else {
                farmMessage += `\n🌱 <b>Посадки:</b> Нет посадок\n`;
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
            
            farmMessage += `\n📈 <b>Весь функционал в веб-версии:</b>\n`;
            farmMessage += `https://${process.env.HOSTNAME || 'localhost:3000'}`;
            
            this.bot.sendMessage(chatId, farmMessage, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
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
                
                const lessonNumber = (index + 1).toString().padStart(2, '0');
                lessonsMessage += `${status} <b>Урок ${lessonNumber}:</b> ${lesson.title}\n`;
                if (progress?.score) {
                    lessonsMessage += `   ⭐ Оценка: ${progress.score}/100\n`;
                }
                lessonsMessage += `   💰 Награда: ${lesson.coins} монет\n\n`;
            });
            
            const totalLessons = allLessons.length;
            const completedLessons = userProgress.completedLessons || 0;
            const completionPercent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
            
            lessonsMessage += `📊 <b>Прогресс:</b> ${completedLessons}/${totalLessons} (${completionPercent}%)\n\n`;
            lessonsMessage += `<b>Для прохождения уроков открой веб-версию:</b>\n`;
            lessonsMessage += `https://${process.env.HOSTNAME || 'localhost:3000'}`;
            
            this.bot.sendMessage(chatId, lessonsMessage, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        });
        
        // Команда /help
        this.bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            
            const helpText = `🤖 <b>CodeFarm Bot - Помощь</b>\n\n`
                + `<b>Основные команды:</b>\n`
                + `/start - Начать игру и показать прогресс\n`
                + `/farm - Показать состояние фермы\n`
                + `/lessons - Показать список уроков\n`
                + `/stats - Показать статистику\n`
                + `/help - Эта справка\n\n`
                + `<b>Как играть:</b>\n`
                + `1. Открой веб-версию по ссылке в /start\n`
                + `2. Начни с урока 1\n`
                + `3. Напиши код в редакторе\n`
                + `4. Смотри как меняется ферма\n`
                + `5. Зарабатывай монеты и опыт\n\n`
                + `<b>Веб-версия:</b>\n`
                + `https://${process.env.HOSTNAME || 'localhost:3000'}\n\n`
                + `<b>Поддержка:</b>\n`
                + `По вопросам пиши: @support`;
            
            this.bot.sendMessage(chatId, helpText, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
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
            statsMessage += `✨ <b>Опыт:</b> ${user.experience || 0}/1000\n`;
            statsMessage += `🪙 <b>Монеты:</b> ${user.coins || 0}\n\n`;
            
            statsMessage += `📚 <b>Прогресс обучения:</b>\n`;
            const totalLessons = this.lessons.getLessonCount();
            const completedLessons = progress.completedLessons || 0;
            const completionPercent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
            
            statsMessage += `   • Пройдено уроков: ${completedLessons}/${totalLessons}\n`;
            statsMessage += `   • Процент завершения: ${completionPercent}%\n`;
            statsMessage += `   • Общий счет: ${progress.totalScore || 0}\n\n`;
            
            if (farm) {
                statsMessage += `🌾 <b>Ферма:</b>\n`;
                statsMessage += `   • Построек: ${farm.buildings?.length || 0}\n`;
                statsMessage += `   • Посадок: ${farm.crops?.length || 0}\n`;
                statsMessage += `   • Животных: ${farm.animals?.length || 0}\n`;
                
                // Расчет следующего уровня
                const expToNextLevel = Math.max(0, 1000 - (user.experience % 1000));
                if (expToNextLevel > 0) {
                    statsMessage += `\n🎯 <b>До следующего уровня:</b> ${expToNextLevel} опыта\n`;
                }
            }
            
            statsMessage += `\n🌐 <b>Веб-версия для полного функционала:</b>\n`;
            statsMessage += `https://${process.env.HOSTNAME || 'localhost:3000'}`;
            
            this.bot.sendMessage(chatId, statsMessage, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        });
        
        // Обработка callback-ов
        this.bot.on('callback_query', (callbackQuery) => {
            const msg = callbackQuery.message;
            const data = callbackQuery.data;
            const userId = callbackQuery.from.id.toString();
            const chatId = msg.chat.id;
            
            let response = '';
            
            switch (data) {
                case 'lessons':
                    // Показываем короткую информацию о уроках
                    const allLessons = this.lessons.getAllLessons();
                    const progress = this.storage.getUserProgress(userId);
                    const completed = progress.completedLessons || 0;
                    
                    response = `📚 <b>Твои уроки</b>\n\n`
                        + `✅ Пройдено: ${completed}/${allLessons.length}\n`
                        + `💰 Доступно уроков: ${allLessons.length}\n\n`
                        + `Используй /lessons для полного списка\n`
                        + `Или открой веб-версию для прохождения:\n`
                        + `https://${process.env.HOSTNAME || 'localhost:3000'}`;
                    break;
                    
                case 'my_farm':
                    // Краткая информация о ферме
                    const farm = this.storage.getFarm(userId);
                    const user = this.storage.getUser(userId);
                    
                    if (farm && user) {
                        response = `🌾 <b>Моя ферма</b>\n\n`
                            + `🏗️ Построек: ${farm.buildings?.length || 0}\n`
                            + `🌱 Посадок: ${farm.crops?.length || 0}\n`
                            + `💰 Монет: ${user.coins || 0}\n\n`
                            + `Используй /farm для подробной информации\n`
                            + `Или открой веб-версию для управления:\n`
                            + `https://${process.env.HOSTNAME || 'localhost:3000'}`;
                    } else {
                        response = '❌ Сначала начни игру с /start';
                    }
                    break;
                    
                case 'stats':
                    // Краткая статистика
                    const userStats = this.storage.getUser(userId);
                    if (userStats) {
                        response = `📊 <b>Статистика</b>\n\n`
                            + `⭐ Уровень: ${userStats.level || 1}\n`
                            + `✨ Опыт: ${userStats.experience || 0}\n`
                            + `🪙 Монеты: ${userStats.coins || 0}\n\n`
                            + `Используй /stats для полной статистики`;
                    } else {
                        response = '❌ Сначала начни игру с /start';
                    }
                    break;
                    
                case 'help':
                    response = `ℹ️ <b>Помощь</b>\n\n`
                        + `Используй /help для полной справки\n\n`
                        + `Основные команды:\n`
                        + `/start - Начать\n`
                        + `/farm - Ферма\n`
                        + `/lessons - Уроки\n`
                        + `/stats - Статистика`;
                    break;
                    
                default:
                    response = `Выбрано: ${data}\nИспользуй меню команд для навигации`;
            }
            
            this.bot.sendMessage(chatId, response, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
            
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
                response = `👋 Привет, ${msg.from.first_name}!\nЯ CodeFarm бот - твой помощник в изучении Python через фермерство!\n\nИспользуй /start чтобы начать.`;
            } else if (text.includes('ферма') || text.includes('farm')) {
                response = '🌾 Для управления фермой используй команду /farm\nИли открой веб-версию для полного контроля.';
            } else if (text.includes('урок') || text.includes('lesson') || text.includes('python')) {
                response = '📚 Уроки Python ждут тебя!\nИспользуй /lessons чтобы увидеть список.\nНачни с урока 1 чтобы изучить основы.';
            } else if (text.includes('код') || text.includes('программ')) {
                response = '💻 CodeFarm учит программированию на Python через фермерство!\nНачни с /start чтобы попробовать.';
            } else if (text.includes('спасибо') || text.includes('thanks')) {
                response = 'Рад помочь! 🎯\nУдачи в изучении программирования!';
            } else if (text.includes('монет') || text.includes('coin')) {
                response = '💰 Зарабатывай монеты, проходя уроки!\nКаждый урок дает награду в монетах.\nИспользуй /stats чтобы посмотреть баланс.';
            } else if (text.trim()) {
                response = '🤖 Я CodeFarm бот!\nИспользуй команды:\n/start - Начать игру\n/farm - Ферма\n/lessons - Уроки\n/stats - Статистика\n/help - Помощь';
            }
            
            if (response) {
                this.bot.sendMessage(msg.chat.id, response);
            }
        });
        
        // Обработка ошибок
        this.bot.on('polling_error', (error) => {
            console.error('❌ Ошибка polling:', error.message);
            // Не паникуем, polling сам переподключится
        });
        
        this.bot.on('webhook_error', (error) => {
            console.error('❌ Ошибка webhook:', error.message);
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
            'stable': '🐴',
            'water_tower': '💧',
            'windmill': '🌬️'
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
            'cabbage': '🥬',
            'cucumber': '🥒',
            'onion': '🧅',
            'garlic': '🧄',
            'strawberry': '🍓',
            'blueberry': '🫐',
            'raspberry': '🍇'
        };
        return emojis[type] || '🌱';
    }
    
    sendNotification(userId, message) {
        try {
            this.bot.sendMessage(userId, message, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
            console.log(`✅ Уведомление отправлено пользователю ${userId}`);
            return true;
        } catch (error) {
            console.error('❌ Ошибка отправки уведомления:', error.message);
            return false;
        }
    }
    
    // Метод для отправки прогресса урока
    sendLessonProgress(userId, lessonTitle, score, reward, totalCoins) {
        const message = `🎉 <b>Урок "${lessonTitle}" пройден!</b>\n\n`
            + `⭐ Оценка: ${score}/100\n`
            + `💰 Награда: +${reward} монет\n`
            + `🪙 Всего монет: ${totalCoins}\n\n`
            + `Продолжай в том же духе! 🚜`;
        
        return this.sendNotification(userId, message);
    }
    
    // Метод для отправки достижения
    sendAchievement(userId, achievementName, reward) {
        const message = `🏆 <b>Новое достижение!</b>\n\n`
            + `🎯 ${achievementName}\n`
            + `💰 Награда: +${reward} монет\n\n`
            + `Поздравляю! 🎉`;
        
        return this.sendNotification(userId, message);
    }
}

module.exports = CodeFarmTelegramBot;
