import os
from dotenv import load_dotenv

load_dotenv()  # Загружаем переменные из .env

class Config:
    # 🔐 Telegram Bot
    BOT_TOKEN = os.getenv("BOT_TOKEN", "8048171645:AAEt4N2ivjIoTc1fEg4loPTcnaq_dZlWMfw")
    
    # 🗄️ Database
    DB_CONFIG = {
        "host": os.getenv("DB_HOST", "a164a4937320e318380ee513.twc1.net"),
        "database": os.getenv("DB_NAME", "default_db"), 
        "user": os.getenv("DB_USER", "gen_user"),
        "password": os.getenv("DB_PASSWORD", "&5~iC3GJHd4V^p"),
        "port": int(os.getenv("DB_PORT", "5432")),
        "sslmode": "verify-full"
    }
    
    # 🌐 Web Server
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", "8000"))
    DOMAIN = os.getenv("DOMAIN", "sergeynikishin555123123-lab-itprogrammistingbot-52b2.twc1.net")
    
    # 🎮 Game Settings
    MAX_LEVEL = 50
    START_COINS = 100
    LESSONS_PER_LEVEL = 3

config = Config()
