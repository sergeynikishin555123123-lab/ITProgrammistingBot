from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
import logging
import sys
from pathlib import Path

# Добавляем корневую директорию в путь Python
sys.path.append(str(Path(__file__).parent))

from config import config
from core.bot_handler import TelegramBotHandler
from database.db_connection import init_db, get_db
from admin.admin_routes import admin_bp
from api.routes import api_bp
from utils.helpers import setup_logging

# Настройка логирования
setup_logging()
logger = logging.getLogger(__name__)

# Создание Flask приложения
app = Flask(__name__, 
           static_folder=config.STATIC_DIR,
           template_folder=config.TEMPLATES_DIR)
app.config.from_object(config)

# Включение CORS
CORS(app)

# Инициализация базы данных
init_db(app)

# Инициализация Telegram бота
bot_handler = TelegramBotHandler(config.TELEGRAM_TOKEN)
bot_handler.setup_webhook(app)

# Регистрация Blueprints
app.register_blueprint(admin_bp, url_prefix='/admin')
app.register_blueprint(api_bp, url_prefix=config.API_PREFIX)

@app.route('/')
def index():
    """Главная страница приложения"""
    return render_template('index.html')

@app.route('/farm/<int:user_id>')
def farm(user_id):
    """Страница фермы пользователя"""
    return render_template('farm.html', user_id=user_id)

@app.route('/lesson/<int:lesson_id>')
def lesson(lesson_id):
    """Страница урока"""
    return render_template('lesson.html', lesson_id=lesson_id)

@app.route('/profile')
def profile():
    """Страница профиля пользователя"""
    return render_template('profile.html')

@app.route('/leaderboard')
def leaderboard():
    """Таблица лидеров"""
    return render_template('leaderboard.html')

@app.route('/health')
def health_check():
    """Проверка работоспособности приложения"""
    return jsonify({
        'status': 'healthy',
        'service': 'codefarm',
        'version': '1.0.0'
    })

@app.route('/webhook', methods=['POST'])
def webhook():
    """Webhook для Telegram бота"""
    if request.is_json:
        update = request.get_json()
        bot_handler.handle_update(update)
    return 'OK', 200

@app.errorhandler(404)
def not_found(error):
    return render_template('404.html'), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Server error: {error}")
    return render_template('500.html'), 500

if __name__ == '__main__':
    # Запуск в режиме разработки
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=config.DEBUG,
        use_reloader=True
    )
