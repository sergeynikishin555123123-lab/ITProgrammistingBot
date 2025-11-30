# config.py
import os

class Config:
    # Базовые настройки
    SECRET_KEY = os.getenv('SECRET_KEY', 'codefarm-secret-key-2024')
    DEBUG = os.getenv('DEBUG', 'True').lower() == 'true'
    
    # Telegram Bot
    TELEGRAM_BOT_TOKEN = '8048171645:AAEt4N2ivjIoTc1fEg4loPTcnaq_dZlWMfw'
    
    # Базовый URL (ваш домен TwinCode)
    BASE_URL = 'https://sergeynikishin555123123-lab-itprogrammistingbot-52b2.twc1.net'
    
    # Настройки приложения
    APP_NAME = "CodeFarm"
    VERSION = "1.0.0"
    
    # Настройки фермы
    INITIAL_COINS = 100
    INITIAL_LEVEL = 1
    
    # Настройки уроков
    MAX_LESSONS = 50
    EXP_PER_LESSON = 100
    COINS_PER_LESSON = 50

# Проверка обязательных настроек
if not Config.TELEGRAM_BOT_TOKEN:
    raise ValueError("TELEGRAM_BOT_TOKEN не установлен")

print("✅ Конфигурация загружена")
print(f"🔧 Режим отладки: {Config.DEBUG}")
print(f"🌐 Базовый URL: {Config.BASE_URL}")
