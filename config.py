# config.py
import os

class Config:
    # Базовые настройки
    SECRET_KEY = os.getenv('SECRET_KEY', 'codefarm-secret-key-2024')
    DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
    
    # Telegram Bot
    TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '8048171645:AAEt4N2ivjIoTc1fEg4loPTcnaq_dZlWMfw')
    BASE_URL = os.getenv('BASE_URL', 'https://sergeynikishin555123123-lab-itprogrammistingbot-52b2.twc1.net')
    
    # База данных PostgreSQL
    DB_CONFIG = {
        'host': os.getenv('DB_HOST', 'a164a4937320e318380ee513.twc1.net'),
        'database': os.getenv('DB_NAME', 'default_db'),
        'user': os.getenv('DB_USER', 'gen_user'),
        'password': os.getenv('DB_PASSWORD', '&5~iC3GJHd4V^p'),
        'sslmode': os.getenv('DB_SSLMODE', 'verify-full')
    }
    
    # Настройки приложения
    APP_NAME = "CodeFarm"
    VERSION = "1.0.0"

# Проверка обязательных настроек
required_vars = ['TELEGRAM_BOT_TOKEN', 'BASE_URL', 'DB_HOST']
for var in required_vars:
    if not os.getenv(var):
        print(f"⚠️ Внимание: переменная {var} не установлена")

print("✅ Конфигурация загружена")
