import telebot
from telebot import types
import logging
import requests
from config import config

logger = logging.getLogger(__name__)

class TelegramBotHandler:
    """Обработчик Telegram бота"""
    
    def __init__(self, token):
        self.bot = telebot.TeleBot(token)
        self.setup_handlers()
        logger.info(f"Telegram bot initialized for domain: {config.DOMAIN}")
    
    def setup_handlers(self):
        """Настройка обработчиков команд"""
        
        @self.bot.message_handler(commands=['start'])
        def handle_start(message):
            """Обработчик команды /start"""
            try:
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

🌐 Веб-приложение: {config.APP_URL}
                """
                
                keyboard = types.InlineKeyboardMarkup()
                keyboard.row(
                    types.InlineKeyboardButton("🚀 Начать обучение", callback_data="start_lessons"),
                    types.InlineKeyboardButton("🌐 Открыть веб-приложение", url=config.APP_URL)
                )
                
                self.bot.send_message(
                    message.chat.id,
                    welcome_text,
                    reply_markup=keyboard,
                    parse_mode='HTML'
                )
                
                logger.info(f"New user started: {user['telegram_id']} - {user['first_name']}")
                
            except Exception as e:
                logger.error(f"Error in start handler: {e}")
                self.bot.send_message(message.chat.id, "Произошла ошибка. Пожалуйста, попробуйте позже.")
        
        @self.bot.message_handler(commands=['lessons'])
        def handle_lessons(message):
            """Показать список уроков"""
            try:
                self.send_lessons_menu(message.chat.id)
            except Exception as e:
                logger.error(f"Error in lessons handler: {e}")
                self.bot.send_message(message.chat.id, "Не удалось загрузить уроки. Попробуйте позже.")
        
        @self.bot.message_handler(commands=['farm'])
        def handle_farm(message):
            """Показать ферму пользователя"""
            try:
                farm_text = """
🏡 Твоя ферма

🌱 Начни обучение, чтобы построить свою ферму!
Каждый пройденный урок добавляет новые элементы на твою ферму.

🚜 Пока что у тебя пустой участок, но скоро здесь будут:
• Дом фермера 🏠
• Поля с урожаем 🌾
• Животные 🐔
• Теплицы 🏭
• И многое другое!

💡 Используй /lessons чтобы начать обучение!
                """
                
                keyboard = types.InlineKeyboardMarkup()
                keyboard.add(
                    types.InlineKeyboardButton(
                        "🌐 Открыть ферму в веб-приложении", 
                        url=f"{config.APP_URL}/farm"
                    )
                )
                
                self.bot.send_message(
                    message.chat.id,
                    farm_text,
                    reply_markup=keyboard,
                    parse_mode='HTML'
                )
                
            except Exception as e:
                logger.error(f"Error in farm handler: {e}")
                self.bot.send_message(message.chat.id, "Произошла ошибка. Попробуйте позже.")
        
        @self.bot.message_handler(commands=['help'])
        def handle_help(message):
            """Показать справку"""
            help_text = """
📚 CodeFarm - Справочная информация

🤖 Команды бота:
/start - Начать работу с ботом
/lessons - Показать доступные уроки
/farm - Посмотреть свою ферму
/profile - Профиль и статистика
/help - Эта справка

🌐 Веб-приложение:
• Выполнение уроков с редактором кода
• Визуализация фермы в 2.5D
• Система прогресса и достижений
• Таблица лидеров

🔗 Ссылки:
Веб-приложение: {config.APP_URL}
Поддержка: @itprogrammisting

💡 Совет: Начни с урока 1 и следуй инструкциям!
Каждый урок приближает тебя к созданию идеальной фермы!
            """.format(config=config)
            
            self.bot.send_message(message.chat.id, help_text, parse_mode='HTML')
        
        @self.bot.callback_query_handler(func=lambda call: True)
        def handle_callback(call):
            """Обработчик inline кнопок"""
            try:
                if call.data == "start_lessons":
                    self.send_lessons_menu(call.message.chat.id)
                elif call.data.startswith("lesson_"):
                    lesson_id = int(call.data.split("_")[1])
                    self.send_lesson(call.message.chat.id, lesson_id)
                
                # Подтверждаем обработку callback
                self.bot.answer_callback_query(call.id)
                
            except Exception as e:
                logger.error(f"Error in callback handler: {e}")
                self.bot.answer_callback_query(call.id, "Произошла ошибка. Попробуйте позже.")
    
    def register_user(self, telegram_user):
        """Регистрация пользователя в базе данных"""
        from database.db_connection import execute_query
        
        query = """
        INSERT INTO users (telegram_id, username, first_name, last_name, coins, level)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (telegram_id) 
        DO UPDATE SET 
            username = EXCLUDED.username,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            last_active = CURRENT_TIMESTAMP
        RETURNING id, telegram_id, username, first_name, last_name, level, coins, experience
        """
        
        result = execute_query(
            query,
            (telegram_user.id, telegram_user.username, 
             telegram_user.first_name, telegram_user.last_name,
             config.STARTING_COINS, config.STARTING_LEVEL),
            fetchone=True
        )
        
        if result:
            return {
                'id': result[0],
                'telegram_id': result[1],
                'username': result[2],
                'first_name': result[3],
                'last_name': result[4],
                'level': result[5],
                'coins': result[6],
                'experience': result[7]
            }
        
        raise Exception("Failed to register user")
    
    def send_lessons_menu(self, chat_id):
        """Отправка меню уроков"""
        from database.db_connection import execute_query
        
        query = "SELECT id, title, description FROM lessons ORDER BY order_index LIMIT 5"
        lessons = execute_query(query, fetchall=True)
        
        if not lessons:
            # Если уроков нет в БД, показываем примеры
            text = """
📚 Уроки CodeFarm

Вот что тебя ждет:

1. 🚀 Первые команды боту-помощнику
   - Основы синтаксиса Python
   - Запуск бота и расчистка территории

2. 📊 Переменные - Проект фермы
   - Типы данных и переменные
   - Создание проекта фермы

3. ⚙️ Функции - Управление техникой
   - Создание функций
   - Управление трактором и косилкой

4. 🏗️ Строительство дома
   - Аргументы функций
   - Построение дома с параметрами

5. 🌱 Посадка культур
   - Списки и циклы
   - Автоматическая посадка

💡 Начни обучение в веб-приложении!
            """
            
            keyboard = types.InlineKeyboardMarkup()
            keyboard.add(
                types.InlineKeyboardButton(
                    "🌐 Начать обучение в веб-приложении",
                    url=f"{config.APP_URL}/lessons"
                )
            )
        else:
            text = "📚 Доступные уроки:\n\n"
            keyboard = types.InlineKeyboardMarkup()
            
            for i, lesson in enumerate(lessons, 1):
                text += f"{i}. {lesson[1]}\n   {lesson[2]}\n\n"
                keyboard.add(types.InlineKeyboardButton(
                    f"Урок {i}: {lesson[1]}",
                    callback_data=f"lesson_{lesson[0]}"
                ))
            
            keyboard.add(
                types.InlineKeyboardButton(
                    "🌐 Все уроки в веб-приложении",
                    url=f"{config.APP_URL}/lessons"
                )
            )
        
        self.bot.send_message(chat_id, text, reply_markup=keyboard)
    
       def send_lesson(self, chat_id, lesson_id):
        """Отправка урока"""
        from database.db_connection import execute_query
        
        query = "SELECT * FROM lessons WHERE id = %s"
        lesson = execute_query(query, (lesson_id,), fetchone=True)
        
        if not lesson:
            self.bot.send_message(chat_id, "Урок не найден")
            return
        
        # Безопасное извлечение данных урока
        lesson_title = lesson[1] if lesson[1] else "Без названия"
        lesson_task = lesson[4] if lesson[4] else "Задание не указано"
        lesson_code = lesson[5] if lesson[5] else "# Код не указан"
        lesson_theory = lesson[3][:500] if lesson[3] else "Теория не указана"
        
        lesson_text = f"""📖 Урок {lesson[0]}: {lesson_title}

📝 Задача:
{lesson_task}

💡 Пример кода для начала:
```python
{lesson_code}
📚 Теория:
{lesson_theory}... [продолжение в веб-приложении]

🏆 Награда за выполнение:
• +50 опыта
• +100 монет
• Новый элемент фермы"""

text
    keyboard = types.InlineKeyboardMarkup()
    keyboard.add(types.InlineKeyboardButton(
        "🌐 Выполнить задание в веб-приложении",
        url=f"{config.APP_URL}/lesson/{lesson_id}"
    ))
    
    self.bot.send_message(
        chat_id,
        lesson_text,
        reply_markup=keyboard,
        parse_mode='Markdown'
    )
text

Проблема была в том, что строка форматирования была разорвана и содержала неправильные кавычки и переносы строк. Теперь все должно работать правильно!

Если нужен более простой вариант без Markdown форматирования кода:

```python
    def send_lesson(self, chat_id, lesson_id):
        """Отправка урока"""
        from database.db_connection import execute_query
        
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
{lesson[5]}

📚 Теория:
{lesson[3][:500]}... [продолжение в веб-приложении]

🏆 Награда за выполнение:
• +50 опыта
• +100 монет
• Новый элемент фермы

🌐 Выполни задание: {config.APP_URL}/lesson/{lesson_id}
        """
        
        self.bot.send_message(
            chat_id,
            lesson_text,
            parse_mode='HTML'
        )
