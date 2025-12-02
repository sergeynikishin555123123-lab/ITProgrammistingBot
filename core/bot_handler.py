import telebot
from telebot import types
import logging
from config import config

logger = logging.getLogger(__name__)

class TelegramBotHandler:
    """Упрощенный обработчик Telegram бота - только редирект в веб-приложение"""
    
    def __init__(self, token):
        self.bot = telebot.TeleBot(token)
        self.setup_handlers()
        logger.info(f"Telegram bot initialized. App URL: {config.APP_URL}")
    
    def setup_handlers(self):
        """Настройка обработчиков команд"""
        
        @self.bot.message_handler(commands=['start'])
        def handle_start(message):
            """Обработчик команды /start"""
            try:
                welcome_text = f"""
🌟 Добро пожаловать в CodeFarm!

🎮 <b>Изучай Python, выращивая ферму!</b>

Здесь ты научишься программированию на Python, выполняя задания и развивая свою виртуальную ферму.

🌐 <b>Все обучение проходит в веб-приложении:</b>
{config.APP_URL}

💡 <b>Что тебя ждет:</b>
• 50+ уроков Python от нуля до Junior
• Визуализация результатов на ферме
• Система прогресса и достижений
• Таблица лидеров

🚀 <b>Начни прямо сейчас!</b>
                """
                
                keyboard = types.InlineKeyboardMarkup()
                keyboard.row(
                    types.InlineKeyboardButton("🌐 Открыть приложение", url=config.APP_URL),
                    types.InlineKeyboardButton("📚 Уроки", url=f"{config.APP_URL}/lessons")
                )
                keyboard.row(
                    types.InlineKeyboardButton("🏡 Моя ферма", url=f"{config.APP_URL}/farm"),
                    types.InlineKeyboardButton("📊 Профиль", url=f"{config.APP_URL}/profile")
                )
                
                self.bot.send_message(
                    message.chat.id,
                    welcome_text,
                    reply_markup=keyboard,
                    parse_mode='HTML'
                )
                
                logger.info(f"User {message.from_user.id} started the bot")
                
            except Exception as e:
                logger.error(f"Error in start handler: {e}")
                self.bot.send_message(message.chat.id, "Произошла ошибка. Пожалуйста, попробуйте позже.")
        
        @self.bot.message_handler(commands=['help'])
        def handle_help(message):
            """Показать справку"""
            help_text = f"""
📚 <b>CodeFarm - Справка</b>

🤖 <b>Команды:</b>
/start - Начать работу
/help - Эта справка

🌐 <b>Веб-приложение:</b>
{config.APP_URL}

📱 <b>Что можно делать:</b>
• Проходить уроки Python
• Выполнять задания
• Развивать свою ферму
• Смотреть прогресс
• Соревноваться с друзьями

❓ <b>Проблемы?</b>
Если что-то не работает, напишите: @itprogrammisting
            """
            
            keyboard = types.InlineKeyboardMarkup()
            keyboard.add(
                types.InlineKeyboardButton("🌐 Открыть приложение", url=config.APP_URL)
            )
            
            self.bot.send_message(
                message.chat.id,
                help_text,
                reply_markup=keyboard,
                parse_mode='HTML'
            )
        
        @self.bot.message_handler(commands=['app'])
        def handle_app(message):
            """Прямая ссылка на приложение"""
            keyboard = types.InlineKeyboardMarkup()
            keyboard.add(
                types.InlineKeyboardButton("🚀 Открыть CodeFarm", url=config.APP_URL)
            )
            
            self.bot.send_message(
                message.chat.id,
                f"🌐 Откройте CodeFarm по ссылке: {config.APP_URL}",
                reply_markup=keyboard
            )
        
        @self.bot.message_handler(func=lambda message: True)
        def handle_all_messages(message):
            """Обработчик всех остальных сообщений"""
            response_text = f"""
👋 Привет! Я бот CodeFarm.

Все обучение проходит в веб-приложении:

🌐 {config.APP_URL}

Используй команды:
/start - начать работу
/help - помощь
/app - прямая ссылка

Или просто нажми кнопку ниже!
            """
            
            keyboard = types.InlineKeyboardMarkup()
            keyboard.add(
                types.InlineKeyboardButton("🌐 Открыть CodeFarm", url=config.APP_URL)
            )
            
            self.bot.send_message(
                message.chat.id,
                response_text,
                reply_markup=keyboard
            )
    
    def handle_update(self, update):
        """Обработка обновления от Telegram"""
        try:
            self.bot.process_new_updates([telegram.Update.de_json(update)])
        except Exception as e:
            logger.error(f"Error handling update: {e}")
    
    def setup_webhook(self):
        """Настройка webhook для Telegram бота"""
        try:
            # Удаляем старый webhook
            self.bot.remove_webhook()
            
            # Устанавливаем новый webhook
            webhook_url = f"{config.APP_URL}/webhook"
            self.bot.set_webhook(url=webhook_url)
            
            logger.info(f"Webhook set to: {webhook_url}")
            return True
        except Exception as e:
            logger.error(f"Failed to set webhook: {e}")
            return False
