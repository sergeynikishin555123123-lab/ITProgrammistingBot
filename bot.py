# bot.py
import requests
from config import Config

def init_bot():
    """Инициализирует Telegram бота"""
    print(f"🤖 Бот инициализирован с токеном: {Config.TELEGRAM_BOT_TOKEN}")
    print(f"🌐 Webhook URL: {Config.BASE_URL}")
    
    # Устанавливаем webhook
    try:
        url = f"https://api.telegram.org/bot{Config.TELEGRAM_BOT_TOKEN}/setWebhook"
        data = {
            "url": f"{Config.BASE_URL}/webhook",
            "drop_pending_updates": True
        }
        
        response = requests.post(url, json=data)
        if response.status_code == 200:
            print("✅ Webhook установлен успешно")
        else:
            print(f"❌ Ошибка установки webhook: {response.text}")
    except Exception as e:
        print(f"❌ Ошибка подключения бота: {e}")

def send_message(chat_id, text):
    """Отправляет сообщение через бота"""
    try:
        url = f"https://api.telegram.org/bot{Config.TELEGRAM_BOT_TOKEN}/sendMessage"
        data = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML"
        }
        response = requests.post(url, json=data)
        return response.status_code == 200
    except Exception as e:
        print(f"❌ Ошибка отправки сообщения: {e}")
        return False
