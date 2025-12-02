import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Базовые настройки
    NODE_ENV = os.getenv('NODE_ENV', 'production')
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
    DEBUG = os.getenv('NODE_ENV', 'production') == 'development'
    PORT = int(os.getenv('PORT', 8000))
    
    # Настройки Telegram Bot
    TELEGRAM_TOKEN = os.getenv('BOT_TOKEN', '8048171645:AAEt4N2ivjIoTc1fEg4loPTcnaq_dZlWMfw')
    DOMAIN = os.getenv('DOMAIN', 'sergeynikishin555123123-lab-itprogrammistingbot-4dcd.twc1.net')
    TELEGRAM_WEBHOOK_URL = f"https://{DOMAIN}/webhook"
    
    # Настройки базы данных PostgreSQL
    DB_HOST = os.getenv('DB_HOST', 'a164a4937320e318380ee513.twc1.net')
    DB_NAME = os.getenv('DB_NAME', 'default_db')
    DB_USER = os.getenv('DB_USER', 'gen_user')
    DB_PASSWORD = os.getenv('DB_PASSWORD', '&5~iC3GJHd4V^p')
    DB_PORT = os.getenv('DB_PORT', '5432')
    
    # Настройки приложения
    APP_URL = f"https://{DOMAIN}"
    API_PREFIX = '/api/v1'
    
    # Настройки безопасности
    CODE_EXECUTION_TIMEOUT = 5
    MAX_CODE_LENGTH = 1000
    
    # Пути к файлам
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    LESSONS_DIR = os.path.join(BASE_DIR, 'lessons/lessons')
    STATIC_DIR = os.path.join(BASE_DIR, 'static')
    TEMPLATES_DIR = os.path.join(BASE_DIR, 'templates')
    
    # Настройки игры
    STARTING_COINS = 100
    STARTING_LEVEL = 1
    MAX_LEVEL = 50

config = Config()
