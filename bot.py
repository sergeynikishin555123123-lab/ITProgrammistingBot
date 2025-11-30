# bot.py
import requests
import threading
import time
from config import Config

class TelegramBot:
    def __init__(self):
        self.token = Config.TELEGRAM_BOT_TOKEN
        self.webhook_url = f"{Config.BASE_URL}/webhook"
        self.set_webhook()
    
    def set_webhook(self):
        """Устанавливает webhook для Telegram бота"""
        url = f"https://api.telegram.org/bot{self.token}/setWebhook"
        data = {
            "url": self.webhook_url,
            "drop_pending_updates": True
        }
        
        try:
            response = requests.post(url, json=data)
            if response.status_code == 200:
                print("✅ Webhook установлен успешно")
            else:
                print(f"❌ Ошибка установки webhook: {response.text}")
        except Exception as e:
            print(f"❌ Ошибка подключения: {e}")
    
    def send_message(self, chat_id, text, reply_markup=None):
        """Отправляет сообщение пользователю"""
        url = f"https://api.telegram.org/bot{self.token}/sendMessage"
        data = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML"
        }
        
        if reply_markup:
            data["reply_markup"] = reply_markup
        
        try:
            response = requests.post(url, json=data)
            return response.status_code == 200
        except Exception as e:
            print(f"Ошибка отправки сообщения: {e}")
            return False
    
    def process_update(self, update):
        """Обрабатывает обновление от Telegram"""
        if "message" in update:
            message = update["message"]
            chat_id = message["chat"]["id"]
            text = message.get("text", "")
            
            if text.startswith("/start"):
                self.handle_start(chat_id, message)
            elif text.startswith("/lessons"):
                self.handle_lessons(chat_id, message)
            elif text.startswith("/farm"):
                self.handle_farm(chat_id, message)
    
    def handle_start(self, chat_id, message):
        """Обрабатывает команду /start"""
        user = message["from"]
        welcome_text = f"""
🤖 Добро пожаловать в <b>CodeFarm</b>, {user.get('first_name', 'друг')}!

🎯 <b>Твоя миссия:</b> научиться программированию на Python, управляя виртуальной фермой.

🚀 <b>Начни с первого урока</b> и посмотри, как твоя ферма будет расти вместе с твоими навыками!

<b>Доступные команды:</b>
/lessons - 📚 Список уроков
/farm - 🏠 Моя ферма

🌐 <b>Веб-версия:</b> {Config.BASE_URL}
        """
        
        keyboard = {
            "inline_keyboard": [
                [{"text": "📚 Уроки", "callback_data": "lessons"}],
                [{"text": "🌐 Открыть веб-версию", "url": Config.BASE_URL}]
            ]
        }
        
        self.send_message(chat_id, welcome_text, keyboard)
    
    def handle_lessons(self, chat_id, message):
        """Обрабатывает команду /lessons"""
        # Получаем уроки из API
        try:
            response = requests.get(f"{Config.BASE_URL}/api/lessons?user_id=1")
            if response.status_code == 200:
                lessons = response.json()
                
                text = "📚 <b>Доступные уроки:</b>\n\n"
                for lesson in lessons[:5]:
                    status = "✅" if lesson.get("completed") else "🔓"
                    text += f"{status} <b>Урок {lesson['id']}:</b> {lesson['title']}\n"
                
                text += f"\n🌐 <b>Полный курс в веб-версии:</b> {Config.BASE_URL}"
                
                self.send_message(chat_id, text)
            else:
                self.send_message(chat_id, "❌ Не удалось загрузить уроки")
        except Exception as e:
            self.send_message(chat_id, "❌ Ошибка соединения с сервером")
    
    def handle_farm(self, chat_id, message):
        """Обрабатывает команду /farm"""
        try:
            response = requests.get(f"{Config.BASE_URL}/api/farm?user_id=1")
            if response.status_code == 200:
                farm_data = response.json()
                
                text = f"""
🏠 <b>Твоя ферма:</b>

📊 <b>Уровень:</b> {farm_data['level']}
🏗️ <b>Построек:</b> {len(farm_data['buildings'])}
🌾 <b>Полей:</b> {len(farm_data['fields'])}

🌐 <b>Управляй фермой в веб-версии:</b> {Config.BASE_URL}
                """
                
                self.send_message(chat_id, text)
            else:
                self.send_message(chat_id, "❌ Не удалось загрузить данные фермы")
        except Exception as e:
            self.send_message(chat_id, "❌ Ошибка соединения с сервером")

# Глобальный экземпляр бота
bot = None

def init_bot():
    """Инициализирует бота в фоновом режиме"""
    global bot
    try:
        bot = TelegramBot()
        print("✅ Telegram бот инициализирован")
    except Exception as e:
        print(f"❌ Ошибка инициализации бота: {e}")
