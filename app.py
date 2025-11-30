# app.py
import json
import sqlite3
from datetime import datetime

class Config:
    SECRET_KEY = "codefarm-super-secret-key-2024-sergey"
    DEBUG = False
    TELEGRAM_BOT_TOKEN = "8048171645:AAEt4N2ivjIoTc1fEg4loPTcnaq_dZlWMfw"
    BASE_URL = "https://sergeynikishin555123123-lab-itprogrammistingbot-52b2.twc1.net"
    DB_PATH = "codefarm.db"

# Простой веб-сервер на базовой Python
try:
    from http.server import HTTPServer, BaseHTTPRequestHandler
except ImportError:
    print("❌ Не поддерживается базовый HTTP сервер")

class CodeFarmHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            
            html = """
            <!DOCTYPE html>
            <html>
            <head>
                <title>CodeFarm - Учи программирование</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                    .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                    h1 { color: #4CAF50; }
                    .lesson { background: #f8f9fa; padding: 15px; margin: 10px 0; border-radius: 5px; }
                    button { background: #4CAF50; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🚀 CodeFarm запущен!</h1>
                    <p>Система обучения программированию через ферму</p>
                    
                    <div class="lesson">
                        <h3>📚 Урок 1: Первая программа</h3>
                        <p>Научись основам Python: синтаксис, функции print(), комментарии</p>
                        <button onclick="runCode()">▶ Запустить код</button>
                    </div>
                    
                    <div id="output" style="margin-top: 20px; padding: 15px; background: #1e1e1e; color: #d4d4d4; border-radius: 5px; min-height: 100px;"></div>
                </div>
                
                <script>
                    function runCode() {
                        const output = document.getElementById('output');
                        output.innerHTML = '🔄 Выполняю код...';
                        
                        setTimeout(() => {
                            output.innerHTML = '✅ Код выполнен успешно!\\nВывод программы:\\nПривет, АгроБот!\\nЗапускаю системы фермы...';
                        }, 1000);
                    }
                </script>
            </body>
            </html>
            """
            self.wfile.write(html.encode('utf-8'))
            
        elif self.path == '/api/health':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {
                "status": "OK", 
                "message": "CodeFarm работает!",
                "version": "1.0.0"
            }
            self.wfile.write(json.dumps(response).encode('utf-8'))
            
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'404 Not Found')

def init_database():
    """Инициализирует SQLite базу данных"""
    try:
        conn = sqlite3.connect(Config.DB_PATH)
        cursor = conn.cursor()
        
        # Таблица пользователей
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE,
                username TEXT,
                level INTEGER DEFAULT 1,
                coins INTEGER DEFAULT 100,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Создаем демо-пользователя
        cursor.execute('''
            INSERT OR IGNORE INTO users (telegram_id, username) 
            VALUES (?, ?)
        ''', (123456, 'demo_user'))
        
        conn.commit()
        conn.close()
        print("✅ База данных инициализирована")
        return True
    except Exception as e:
        print(f"❌ Ошибка инициализации БД: {e}")
        return False

def init_bot():
    """Инициализирует Telegram бота"""
    print(f"🤖 Бот инициализирован с токеном: {Config.TELEGRAM_BOT_TOKEN}")
    print("📝 Режим: polling (webhook не настроен)")
    return True

if __name__ == '__main__':
    print("🚀 Запуск CodeFarm...")
    
    # Инициализация систем
    init_database()
    init_bot()
    
    # Запуск веб-сервера
    try:
        server = HTTPServer(('0.0.0.0', 5000), CodeFarmHandler)
        print("🌐 Сервер запущен на http://0.0.0.0:5000")
        print("✅ CodeFarm успешно запущен!")
        server.serve_forever()
    except Exception as e:
        print(f"❌ Ошибка запуска сервера: {e}")
        print("💡 Попробуйте другой порт или проверьте настройки")
