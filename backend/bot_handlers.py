from telegram import Update, ReplyKeyboardMarkup
from telegram.ext import ContextTypes
import json

class BotHandlers:
    """Обработчики Telegram бота"""
    
    def __init__(self, db, lesson_system, farm_engine):
        self.db = db
        self.lesson_system = lesson_system
        self.farm_engine = farm_engine
    
    async def start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Обработчик команды /start"""
        user = update.effective_user
        telegram_id = user.id
        
        # Регистрируем пользователя
        cursor = self.db.connection.cursor()
        cursor.execute(
            "INSERT INTO users (telegram_id, username) VALUES (%s, %s) ON CONFLICT (telegram_id) DO NOTHING RETURNING id",
            (telegram_id, user.username)
        )
        
        result = cursor.fetchone()
        if result:
            user_id = result[0]
            # Создаем начальную ферму
            farm_data = self.farm_engine.create_new_farm(user_id)
            cursor.execute(
                "INSERT INTO farm_state (user_id, field_data) VALUES (%s, %s)",
                (user_id, json.dumps(farm_data))
            )
            self.db.connection.commit()
        
        cursor.close()
        
        # Приветственное сообщение
        welcome_text = """
        🚜 Добро пожаловать на CodeFarm! 🎮

        Ты стал владельцем собственной фермы, где будешь учиться программированию на Python!

        🌱 Начни с первого урока - научись давать команды боту-помощнику
        🏠 Строй здания, выращивай урожай, автоматизируй процессы
        💻 Изучай реальный Python код, видя результат на своей ферме

        Используй кнопки ниже для навигации:
        """
        
        keyboard = [
            ["📚 Уроки", "🏠 Моя ферма"],
            ["📊 Прогресс", "🆘 Помощь"]
        ]
        reply_markup = ReplyKeyboardMarkup(keyboard, resize_keyboard=True)
        
        await update.message.reply_text(welcome_text, reply_markup=reply_markup)
    
    async def show_lessons(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Показывает список уроков"""
        user = update.effective_user
        telegram_id = user.id
        
        cursor = self.db.connection.cursor()
        cursor.execute(
            "SELECT lesson_id FROM user_progress up JOIN users u ON up.user_id = u.id WHERE u.telegram_id = %s AND completed = TRUE",
            (telegram_id,)
        )
        completed_lessons = [row[0] for row in cursor.fetchall()]
        cursor.close()
        
        lessons_text = "📚 Доступные уроки:\n\n"
        
        for i, lesson in enumerate(self.lesson_system.lessons, 1):
            status = "✅" if lesson["id"] in completed_lessons else "🔒"
            lessons_text += f"{status} Урок {i}: {lesson['title']}\n"
        
        lessons_text += "\nВыбери урок чтобы начать обучение!"
        
        await update.message.reply_text(lessons_text)
    
    async def show_farm(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Показывает текущее состояние фермы"""
        user = update.effective_user
        telegram_id = user.id
        
        cursor = self.db.connection.cursor()
        cursor.execute(
            "SELECT fs.field_data FROM farm_state fs JOIN users u ON fs.user_id = u.id WHERE u.telegram_id = %s",
            (telegram_id,)
        )
        
        result = cursor.fetchone()
        if result:
            farm_data = json.loads(result[0])
            farm_html = self.farm_engine.render_farm_html(farm_data)
            
            farm_text = "🏠 Твоя ферма:\n\n"
            for row in farm_data["field"]:
                farm_text += "".join(row) + "\n"
            
            farm_text += "\nИспользуй /lessons чтобы продолжить обучение!"
            
            await update.message.reply_text(farm_text)
        else:
            await update.message.reply_text("❌ Ферма не найдена. Используй /start чтобы начать.")
        
        cursor.close()

bot_handlers = None  # Инициализируется в main.py
