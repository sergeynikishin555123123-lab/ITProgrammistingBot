from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
import logging
import sys
from pathlib import Path

# Добавляем корневую директорию в путь Python
sys.path.append(str(Path(__file__).parent))

from config import config
from core.bot_handler import TelegramBotHandler
from database.db_connection import init_db, create_tables
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

# Создание таблиц при запуске (если их нет)
with app.app_context():
    try:
        create_tables()
        logger.info("Database tables created/verified")
    except Exception as e:
        logger.error(f"Error creating tables: {e}")

# Инициализация Telegram бота
try:
    bot_handler = TelegramBotHandler(config.TELEGRAM_TOKEN)
    bot_handler.setup_webhook()
    logger.info("Telegram bot initialized")
except Exception as e:
    logger.error(f"Failed to initialize Telegram bot: {e}")
    bot_handler = None

# Основные маршруты веб-приложения
@app.route('/')
def index():
    """Главная страница приложения"""
    return render_template('index.html')

@app.route('/farm')
def farm():
    """Страница фермы"""
    return render_template('farm.html')

@app.route('/lessons')
def lessons():
    """Список уроков"""
    return render_template('lessons.html')

@app.route('/lesson/<int:lesson_id>')
def lesson(lesson_id):
    """Страница урока"""
    return render_template('lesson.html', lesson_id=lesson_id)

@app.route('/profile')
def profile():
    """Профиль пользователя"""
    return render_template('profile.html')

@app.route('/leaderboard')
def leaderboard():
    """Таблица лидеров"""
    return render_template('leaderboard.html')

@app.route('/playground')
def playground():
    """Песочница для кода"""
    return render_template('playground.html')

# API маршруты
@app.route('/api/health')
def health_check():
    """Проверка работоспособности приложения"""
    return jsonify({
        'status': 'healthy',
        'service': 'codefarm',
        'environment': config.NODE_ENV,
        'version': '1.0.0',
        'bot_status': 'active' if bot_handler else 'inactive'
    })

@app.route('/api/telegram-webhook', methods=['POST'])
def webhook():
    """Webhook для Telegram бота"""
    if bot_handler and request.is_json:
        try:
            update = request.get_json()
            bot_handler.handle_update(update)
            return jsonify({'status': 'ok'}), 200
        except Exception as e:
            logger.error(f"Webhook error: {e}")
            return jsonify({'error': str(e)}), 500
    return jsonify({'error': 'Invalid request'}), 400

@app.route('/api/set-webhook', methods=['GET'])
def set_webhook():
    """Ручная установка webhook (для отладки)"""
    if bot_handler:
        success = bot_handler.setup_webhook()
        return jsonify({'success': success, 'url': config.APP_URL + '/api/telegram-webhook'})
    return jsonify({'error': 'Bot not initialized'}), 500

# Обработчики ошибок
@app.errorhandler(404)
def not_found(error):
    return render_template('404.html'), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Server error: {error}")
    return render_template('500.html'), 500

def create_app():
    """Фабрика приложения для Gunicorn"""
    return app

if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=config.PORT,
        debug=config.DEBUG
    )
