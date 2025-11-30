import os

class Config:
    # 🔐 Telegram Bot
    BOT_TOKEN = "8048171645:AAEt4N2ivjIoTc1fEg4loPTcnaq_dZlWMfw"
    
    # 🗄️ Database
    DB_CONFIG = {
        "host": "a164a4937320e318380ee513.twc1.net",
        "database": "default_db", 
        "user": "gen_user",
        "password": "&5~iC3GJHd4V^p",
        "port": 5432,
        "sslmode": "verify-full"
    }
    
    # 🌐 Web Server
    HOST = "0.0.0.0"
    PORT = 8000
    DOMAIN = "sergeynikishin555123123-lab-itprogrammistingbot-52b2.twc1.net"
    
    # 🎮 Game Settings
    MAX_LEVEL = 50
    START_COINS = 100
    LESSONS_PER_LEVEL = 3

config = Config()
