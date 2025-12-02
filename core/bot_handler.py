import telebot
from telebot import types
import logging
from database.db_connection import execute_query
from utils.helpers import format_user_stats

logger = logging.getLogger(__name__)

class TelegramBotHandler:
    """Обработчик Telegram бота"""
    
    def __init__(self, token):
        self.bot = telebot.TeleBot(token)
        self.setup_handlers()
    
    def setup_handlers(self):
        """Настройка обработчиков команд"""
        
        @self.bot.message_handler(commands=['start'])
        def handle_start(message):
            """Обработчик команды /start"""
            user = self.register_user(message.from_user)
            
            welcome_text = f"""
🌟 Добро пожаловать в CodeFarm, {user['first_name']}!

🎮 Здесь ты научишься программировать на Python, выращивая свою ферму!

🏆 Твой прогресс:
📊 Уровень: {user['level']}
💰 Монеты: {user['coins']}
📈 Опыт: {user['experience']}/{user['level'] * 100}

💡 Используй команды:
/lessons - начать обучение
/farm - посмотреть ферму
/profile - профиль
/help - помощь
"""
            
            keyboard = types.InlineKeyboardMarkup()
            keyboard.row(
                types.InlineKeyboardButton("🚀 Начать обучение", callback_data="start_lessons"),
                types.InlineKeyboardButton("🏡 Моя ферма", callback_data="view_farm")
            )
            
            self.bot.send_message(
                message.chat.id,
                welcome_text,
                reply_markup=keyboard,
                parse_mode='HTML'
            )
        
        @self.bot.message_handler(commands=['farm'])
        def handle_farm(message):
            """Показать ферму пользователя"""
            user = self.get_user(message.from_user.id)
            if not user:
                self.bot.send_message(message.chat.id, "Сначала зарегистрируйтесь через /start")
                return
            
            farm_data = self.get_farm_state(user['id'])
            
            farm_text = f"""
🏡 Твоя ферма (Уровень {user['level']})

📊 Статистика:
🌾 Грядок: {len(farm_data.get('buildings', []))}
🐔 Животных: {len(farm_data.get('animals', []))}
🎨 Украшений: {len(farm_data.get('decorations', []))}

💰 Баланс: {user['coins']} монет
"""
            
            # Отправляем изображение фермы (в будущем - генерация)
            self.bot.send_message(
                message.chat.id,
                farm_text,
                parse_mode='HTML'
            )
        
        @self.bot.callback_query_handler(func=lambda call: True)
        def handle_callback(call):
            """Обработчик inline кнопок"""
            if call.data == "start_lessons":
                self.send_lessons_menu(call.message.chat.id)
            elif call.data.startswith("lesson_"):
                lesson_id = int(call.data.split("_")[1])
                self.send_lesson(call.message.chat.id, lesson_id)
    
    def register_user(self, telegram_user):
        """Регистрация пользователя в базе данных"""
        query = """
        INSERT INTO users (telegram_id, username, first_name, last_name)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (telegram_id) 
        DO UPDATE SET last_active = CURRENT_TIMESTAMP
        RETURNING *
        """
        
        result = execute_query(
            query,
            (telegram_user.id, telegram_user.username, 
             telegram_user.first_name, telegram_user.last_name),
            fetchone=True
        )
        
        # Создаем начальное состояние фермы
        farm_query = """
        INSERT INTO farm_state (user_id, grid_data)
        VALUES (%s, %s)
        ON CONFLICT (user_id) DO NOTHING
        """
        execute_query(farm_query, (result[0], '{}'))
        
        return {
            'id': result[0],
            'telegram_id': result[1],
            'username': result[2],
            'first_name': result[3],
            'last_name': result[4],
            'level': result[6],
            'experience': result[7],
            'coins': result[8]
        }
    
    def get_user(self, telegram_id):
        """Получение пользователя из базы данных"""
        query = "SELECT * FROM users WHERE telegram_id = %s"
        result = execute_query(query, (telegram_id,), fetchone=True)
        
        if result:
            return {
                'id': result[0],
                'telegram_id': result[1],
                'username': result[2],
                'first_name': result[3],
                'last_name': result[4],
                'level': result[6],
                'experience': result[7],
                'coins': result[8]
            }
        return None
    
    def get_farm_state(self, user_id):
        """Получение состояния фермы пользователя"""
        query = "SELECT * FROM farm_state WHERE user_id = %s"
        result = execute_query(query, (user_id,), fetchone=True)
        
        if result:
            return {
                'buildings': result[3] or [],
                'animals': result[4] or [],
                'decorations': result[5] or []
            }
        return {}
    
    def send_lessons_menu(self, chat_id):
        """Отправка меню уроков"""
        query = "SELECT id, title, description FROM lessons ORDER BY order_index LIMIT 5"
        lessons = execute_query(query, fetchall=True)
        
        text = "📚 Доступные уроки:\n\n"
        keyboard = types.InlineKeyboardMarkup()
        
        for i, lesson in enumerate(lessons, 1):
            text += f"{i}. {lesson[1]}\n   {lesson[2]}\n\n"
            keyboard.add(types.InlineKeyboardButton(
                f"Урок {i}: {lesson[1]}",
                callback_data=f"lesson_{lesson[0]}"
            ))
        
        self.bot.send_message(chat_id, text, reply_markup=keyboard)
    
    def send_lesson(self, chat_id, lesson_id):
        """Отправка урока"""
        query = "SELECT * FROM lessons WHERE id = %s"
        lesson = execute_query(query, (lesson_id,), fetchone=True)
        
        if not lesson:
            self.bot.send_message(chat_id, "Урок не найден")
            return
        
        lesson_text = f"""
📖 Урок {lesson[0]}: {lesson[1]}

📝 Задача:
{lesson[4]}

💡 Пример кода для начала:
```python
{lesson[5]}
