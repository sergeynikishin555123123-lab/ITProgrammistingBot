# app.py
from flask import Flask, render_template, request, jsonify, session
from flask_cors import CORS
import sqlite3
import json
import os
from datetime import datetime

from bot import init_bot
from lessons import LessonManager
from code_executor import CodeExecutor
from config import Config

app = Flask(__name__)
app.secret_key = Config.SECRET_KEY
app.config.from_object(Config)

# CORS для API
CORS(app)

# Инициализация систем
lesson_manager = LessonManager()
code_executor = CodeExecutor()

# Инициализация базы данных при запуске
def init_db():
    conn = sqlite3.connect('codefarm.db')
    cursor = conn.cursor()
    
    # Таблица пользователей
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER UNIQUE,
            username TEXT,
            full_name TEXT,
            level INTEGER DEFAULT 1,
            experience INTEGER DEFAULT 0,
            coins INTEGER DEFAULT 100,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Таблица прогресса уроков
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS lesson_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            lesson_id INTEGER,
            code_solution TEXT,
            completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, lesson_id)
        )
    ''')
    
    # Таблица состояния фермы
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS farm_state (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE,
            level INTEGER DEFAULT 1,
            buildings TEXT DEFAULT '[]',
            fields TEXT DEFAULT '[]',
            decorations TEXT DEFAULT '[]',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()
    print("✅ База данных инициализирована")

# Главная страница
@app.route('/')
def index():
    return render_template('index.html')

# Админ панель
@app.route('/admin')
def admin():
    return render_template('admin.html')

# API: Получить информацию о пользователе
@app.route('/api/user')
def get_user():
    # В реальном приложении здесь будет аутентификация
    user_id = request.args.get('user_id', 1)  # Для демо используем ID 1
    
    conn = sqlite3.connect('codefarm.db')
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
    user = cursor.fetchone()
    conn.close()
    
    if user:
        return jsonify({
            'id': user[0],
            'telegram_id': user[1],
            'username': user[2],
            'full_name': user[3],
            'level': user[4],
            'experience': user[5],
            'coins': user[6]
        })
    else:
        return jsonify({'error': 'User not found'}), 404

# API: Получить уроки
@app.route('/api/lessons')
def get_lessons():
    user_id = request.args.get('user_id', 1)
    lessons = lesson_manager.get_available_lessons(user_id)
    return jsonify(lessons)

# API: Получить конкретный урок
@app.route('/api/lessons/<int:lesson_id>')
def get_lesson(lesson_id):
    lesson = lesson_manager.get_lesson(lesson_id)
    if lesson:
        return jsonify(lesson)
    else:
        return jsonify({'error': 'Lesson not found'}), 404

# API: Отправить решение урока
@app.route('/api/lessons/<int:lesson_id>/submit', methods=['POST'])
def submit_lesson(lesson_id):
    user_id = request.json.get('user_id', 1)
    code = request.json.get('code', '')
    
    lesson = lesson_manager.get_lesson(lesson_id)
    if not lesson:
        return jsonify({'error': 'Lesson not found'}), 404
    
    # Выполняем код
    result = code_executor.execute_python(code, lesson.get("tests", ""))
    
    if result["success"]:
        # Сохраняем прогресс
        lesson_manager.complete_lesson(user_id, lesson_id, code)
        
        # Получаем обновление для фермы
        farm_update = lesson_manager.get_farm_update(lesson_id)
        
        return jsonify({
            "success": True,
            "message": "Задание выполнено успешно!",
            "farm_update": farm_update,
            "output": result["output"]
        })
    else:
        return jsonify({
            "success": False,
            "message": "Ошибка в коде",
            "error": result["error"],
            "output": result["output"]
        })

# API: Получить состояние фермы
@app.route('/api/farm')
def get_farm():
    user_id = request.args.get('user_id', 1)
    
    conn = sqlite3.connect('codefarm.db')
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM farm_state WHERE user_id = ?', (user_id,))
    farm_data = cursor.fetchone()
    conn.close()
    
    if farm_data:
        return jsonify({
            'level': farm_data[2],
            'buildings': json.loads(farm_data[3]),
            'fields': json.loads(farm_data[4]),
            'decorations': json.loads(farm_data[5])
        })
    else:
        # Создаем начальное состояние фермы
        conn = sqlite3.connect('codefarm.db')
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO farm_state (user_id, level, buildings, fields, decorations) VALUES (?, ?, ?, ?, ?)',
            (user_id, 1, '[]', '[]', '[]')
        )
        conn.commit()
        conn.close()
        
        return jsonify({
            'level': 1,
            'buildings': [],
            'fields': [],
            'decorations': []
        })

# API: Админ статистика
@app.route('/api/admin/stats')
def admin_stats():
    conn = sqlite3.connect('codefarm.db')
    cursor = conn.cursor()
    
    # Общее количество пользователей
    cursor.execute('SELECT COUNT(*) FROM users')
    total_users = cursor.fetchone()[0]
    
    # Активные пользователи (за последние 7 дней)
    cursor.execute('''
        SELECT COUNT(DISTINCT user_id) FROM lesson_progress 
        WHERE completed_at >= datetime('now', '-7 days')
    ''')
    active_users = cursor.fetchone()[0]
    
    # Статистика по урокам
    cursor.execute('''
        SELECT lesson_id, COUNT(*) as completions 
        FROM lesson_progress 
        GROUP BY lesson_id 
        ORDER BY lesson_id
    ''')
    lesson_stats = {row[0]: row[1] for row in cursor.fetchall()}
    
    conn.close()
    
    return jsonify({
        'total_users': total_users,
        'active_users': active_users,
        'lesson_stats': lesson_stats
    })

# Webhook для Telegram бота
@app.route('/webhook', methods=['POST'])
def webhook():
    update = request.get_json()
    # Обработка обновлений от Telegram будет здесь
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    # Инициализация базы данных
    init_db()
    
    # Запуск бота в фоновом режиме
    init_bot()
    
    # Запуск Flask приложения
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=Config.DEBUG
    )
