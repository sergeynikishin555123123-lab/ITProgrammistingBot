# config.py
import os
import sqlite3

class Config:
    # Базовые настройки
    SECRET_KEY = os.getenv('SECRET_KEY', 'codefarm-secret-key-2024')
    DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
    
    # Telegram Bot
    TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '8048171645:AAEt4N2ivjIoTc1fEg4loPTcnaq_dZlWMfw')
    BASE_URL = os.getenv('BASE_URL', 'https://sergeynikishin555123123-lab-itprogrammistingbot-52b2.twc1.net')
    
    # SQLite база данных (вместо PostgreSQL)
    DB_PATH = 'codefarm.db'
    
    # Настройки приложения
    APP_NAME = "CodeFarm"
    VERSION = "1.0.0"

print("✅ Конфигурация загружена (SQLite)")
