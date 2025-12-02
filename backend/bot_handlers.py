from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import ContextTypes, Application, CommandHandler, MessageHandler, filters
import json
import logging

# Настройка логирования
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

class BotHandlers:
    """Обработчики Telegram бота - ТОЛЬКО ПРИВЕТСТВИЕ И ПЕРЕХОД В WEB APP"""
    
    def __init__(self, db, lesson_system, farm_engine):
        self.db = db
        self.lesson_system = lesson_system
        self.farm_engine = farm_engine
    
    async def start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Обработчик команды /start - ПРИВЕТСТВИЕ И КНОПКА В WEB APP"""
        user = update.effective_user
        telegram_id = user.id
        
        logger.info(f"Получена команда /start от пользователя {user.username} (ID: {telegram_id})")
        
        try:
            # Регистрируем пользователя в базе (простая версия)
            cursor = self.db.connection.cursor()
            
            if hasattr(self.db.connection, 'execute'):  # SQLite
                cursor.execute(
                    "INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)",
                    (telegram_id, user.username, user.first_name)
                )
            else:  # PostgreSQL
                cursor.execute(
                    """
                    INSERT INTO users (telegram_id, username, first_name) 
                    VALUES (%s, %s, %s) 
                    ON CONFLICT (telegram_id) 
                    DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name
                    """,
                    (telegram_id, user.username, user.first_name)
                )
            
            self.db.connection.commit()
            cursor.close()
            
        except Exception as e:
            logger.error(f"Ошибка при регистрации пользователя: {e}")
            # Продолжаем даже если ошибка
        
        # Приветственное сообщение
        welcome_text = f"""
        🚜 *Добро пожаловать на CodeFarm, {user.first_name}!* 🎮

        *Ты стал владельцем собственной фермы, где будешь учиться программированию на Python!*

        🎯 *Что такое CodeFarm?*
        • Интерактивная платформа для обучения Python
        • Игровая механика - твоя ферма развивается с каждым уроком
        • 50+ практических уроков от нуля до Junior разработчика
        • Визуальный результат кода в реальном времени

        🌱 *Попробуй прямо сейчас:*
        Нажми кнопку ниже чтобы открыть CodeFarm в мини-приложении Telegram!
        
        Там тебя ждут:
        • Первый урок - "Первые команды боту-помощнику"
        • Твоя первая ферма
        • Интерактивный редактор кода
        • И многое другое!

        Удачи в обучении! 🚀
        """
        
        # Создаем кнопку для открытия Web App
        # URL замени на свой домен Timeweb
        web_app_url = f"https://{config.DOMAIN}/?startapp={telegram_id}"
        
        keyboard = [
            [InlineKeyboardButton(
                text="🚀 Открыть CodeFarm", 
                web_app=WebAppInfo(url=web_app_url)
            )],
            [InlineKeyboardButton(
                text="📱 Открыть в браузере", 
                url=web_app_url
            )]
        ]
        
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        await update.message.reply_text(
            welcome_text, 
            reply_markup=reply_markup, 
            parse_mode='Markdown',
            disable_web_page_preview=True
        )
        
        logger.info(f"Приветственное сообщение с Web App кнопкой отправлено пользователю {user.username}")
    
    async def help_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Команда помощи"""
        help_text = """
        🆘 *Помощь по CodeFarm*

        🤖 *Основная команда:*
        /start - Начать работу и открыть CodeFarm

        🌐 *Как начать обучение:*
        1. Нажми /start
        2. Нажми кнопку "🚀 Открыть CodeFarm"
        3. В мини-приложении выбери первый урок
        4. Начни писать код и смотри как меняется твоя ферма!

        🎮 *Возможности:*
        • 50+ уроков программирования
        • 2.5D визуализация фермы
        • Реальный Python код
        • Прогресс и достижения

        ❓ *Проблемы с открытием?*
        Попробуй кнопку "📱 Открыть в браузере" или перейди напрямую:
        https://твой-домен.herokuapp.com/

        📞 *Поддержка:*
        По всем вопросам пиши: @твой_username
        """
        
        await update.message.reply_text(help_text, parse_mode='Markdown')
    
    async def unknown_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Обработчик неизвестных команд"""
        await update.message.reply_text(
            "🤔 Я не понимаю эту команду. Используй /start чтобы открыть CodeFarm!\n\n"
            "Если хочешь начать обучение программированию, просто нажми /start и открой мини-приложение! 🚀"
        )

bot_handlers = None  # Инициализируется в main.py
