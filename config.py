# config.py
import os

class Config:
    # Базовые настройки
    SECRET_KEY = os.getenv('SECRET_KEY', 'codefarm-secret-key-2024')
    DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
    
    # Telegram Bot
    TELEGRAM_BOT_TOKEN = '8048171645:AAEt4N2ivjIoTc1fEg4loPTcnaq_dZlWMfw'
    BASE_URL = 'https://sergeynikishin555123123-lab-itprogrammistingbot-52b2.twc1.net'
    
    # База данных PostgreSQL
    DB_CONFIG = {
        'host': 'a164a4937320e318380ee513.twc1.net',
        'database': 'default_db',
        'user': 'gen_user',
        'password': '&5~iC3GJHd4V^p',
        'sslmode': 'verify-full'
    }
    
    # Настройки приложения
    APP_NAME = "CodeFarm"
    VERSION = "1.0.0"

print("✅ Конфигурация загружена")
