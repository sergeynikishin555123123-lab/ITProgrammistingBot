import requests
import logging
from config import config

logger = logging.getLogger(__name__)

class TelegramBotHandler:
    """Обработчик Telegram бота через API"""
    
    def __init__(self, token):
        self.token = token
        self.api_url = f"https://api.telegram.org/bot{token}"
        logger.info(f"Telegram bot API initialized. App URL: {config.APP_URL}")
    
    def send_message(self, chat_id, text, keyboard=None):
        """Отправка сообщения через Telegram API"""
        try:
            url = f"{self.api_url}/sendMessage"
            payload = {
                'chat_id': chat_id,
                'text': text,
                'parse_mode': 'HTML',
                'disable_web_page_preview': False
            }
            
            if keyboard:
                payload['reply_markup'] = keyboard
            
            response = requests.post(url, json=payload)
            return response.json()
        except Exception as e:
            logger.error(f"Error sending message: {e}")
            return None
    
    def handle_update(self, update):
        """Обработка обновления от Telegram"""
        try:
            if 'message' in update:
                message = update['message']
                chat_id = message['chat']['id']
                text = message.get('text', '')
                
                # Обработка команд
                if text.startswith('/start'):
                    self.handle_start_command(chat_id)
                elif text.startswith('/help'):
                    self.handle_help_command(chat_id)
                elif text.startswith('/app'):
                    self.handle_app_command(chat_id)
                else:
                    self.handle_other_message(chat_id)
            
            return True
        except Exception as e:
            logger.error(f"Error handling update: {e}")
            return False
    
    def handle_start_command(self, chat_id):
        """Обработка команды /start"""
        welcome_text = f"""
🌟 <b>Добро пожаловать в CodeFarm!</b>

🎮 <b>Изучай Python, выращивая ферму!</b>

🌐 Все обучение проходит в веб-приложении:
{config.APP_URL}

💡 <b>Что тебя ждет:</b>
• 50+ уроков Python от нуля до Junior
• Визуализация результатов на ферме
• Система прогресса и достижений
• Таблица лидеров

🚀 <b>Начни прямо сейчас!</b>
        """
        
        keyboard = {
            'inline_keyboard': [
                [
                    {'text': '🌐 Открыть приложение', 'url': config.APP_URL},
                    {'text': '📚 Уроки', 'url': f"{config.APP_URL}/lessons"}
                ],
                [
                    {'text': '🏡 Моя ферма', 'url': f"{config.APP_URL}/farm"},
                    {'text': '📊 Профиль', 'url': f"{config.APP_URL}/profile"}
                ]
            ]
        }
        
        self.send_message(chat_id, welcome_text, keyboard)
    
    def handle_help_command(self, chat_id):
        """Обработка команды /help"""
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
        """
        
        keyboard = {
            'inline_keyboard': [[
                {'text': '🌐 Открыть приложение', 'url': config.APP_URL}
            ]]
        }
        
        self.send_message(chat_id, help_text, keyboard)
    
    def handle_app_command(self, chat_id):
        """Обработка команды /app"""
        keyboard = {
            'inline_keyboard': [[
                {'text': '🚀 Открыть CodeFarm', 'url': config.APP_URL}
            ]]
        }
        
        self.send_message(chat_id, f"🌐 Откройте CodeFarm: {config.APP_URL}", keyboard)
    
    def handle_other_message(self, chat_id):
        """Обработка остальных сообщений"""
        response_text = f"""
👋 Привет! Я бот CodeFarm.

Все обучение проходит в веб-приложении:

🌐 {config.APP_URL}

Используй команды:
/start - начать работу
/help - помощь
/app - прямая ссылка
        """
        
        keyboard = {
            'inline_keyboard': [[
                {'text': '🌐 Открыть CodeFarm', 'url': config.APP_URL}
            ]]
        }
        
        self.send_message(chat_id, response_text, keyboard)
    
    def setup_webhook(self):
        """Настройка webhook для Telegram бота"""
        try:
            url = f"{self.api_url}/setWebhook"
            webhook_url = f"{config.APP_URL}/api/telegram-webhook"
            
            payload = {
                'url': webhook_url,
                'drop_pending_updates': True
            }
            
            response = requests.post(url, json=payload)
            result = response.json()
            
            if result.get('ok'):
                logger.info(f"Webhook set successfully to: {webhook_url}")
                return True
            else:
                logger.error(f"Failed to set webhook: {result}")
                return False
                
        except Exception as e:
            logger.error(f"Error setting webhook: {e}")
            return False
