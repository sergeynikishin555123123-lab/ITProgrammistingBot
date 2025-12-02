import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Базовые настройки
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
    DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
    
    # Настройки Telegram Bot
    TELEGRAM_TOKEN = os.getenv('TELEGRAM_TOKEN', '8048171645:AAEt4N2ivjIoTc1fEg4loPTcnaq_dZlWMfw')
    TELEGRAM_WEBHOOK_URL = os.getenv('TELEGRAM_WEBHOOK_URL', '')
    
    # Настройки базы данных PostgreSQL
    DB_HOST = os.getenv('DB_HOST', 'a164a4937320e318380ee513.twc1.net')
    DB_NAME = os.getenv('DB_NAME', 'default_db')
    DB_USER = os.getenv('DB_USER', 'gen_user')
    DB_PASSWORD = os.getenv('DB_PASSWORD', '&5~iC3GJHd4V^p')
    DB_PORT = os.getenv('DB_PORT', '5432')
    
    # Настройки приложения
    APP_URL = os.getenv('APP_URL', 'https://sergeynikishin555123123-lab-itprogrammistingbot-52b2.twc1.net')
    API_PREFIX = '/api/v1'
    
    # Настройки безопасности
    CODE_EXECUTION_TIMEOUT = int(os.getenv('CODE_EXECUTION_TIMEOUT', 5))
    MAX_CODE_LENGTH = int(os.getenv('MAX_CODE_LENGTH', 1000))
    
    # Пути к файлам
    LESSONS_DIR = os.path.join(os.path.dirname(__file__), 'lessons/lessons')
    STATIC_DIR = os.path.join(os.path.dirname(__file__), 'static')
    TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), 'templates')
    
    # Настройки игры
    STARTING_COINS = 100
    STARTING_LEVEL = 1
    MAX_LEVEL = 50

config = Config()
