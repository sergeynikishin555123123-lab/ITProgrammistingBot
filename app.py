# app.py
from flask import Flask, render_template, request, jsonify
from config import Config
from database import Database, User, LessonProgress, FarmState
from lessons import LessonManager
from code_executor import CodeExecutor
from bot import init_bot

app = Flask(__name__)
app.secret_key = Config.SECRET_KEY

# Инициализация систем
lesson_manager = LessonManager()
code_executor = CodeExecutor()

@app.route('/')
def index():
    """Главная страница"""
    return render_template('index.html')

@app.route('/admin')
def admin():
    """Админ панель"""
    return render_template('admin.html')

# API маршруты
@app.route('/api/user')
def get_user():
    """Получить информацию о пользователе"""
    user_id = request.args.get('user_id', 1)
    return jsonify({
        'id': user_id,
        'username': 'Demo User',
        'level': 1,
        'coins': 100
    })

@app.route('/api/lessons')
def get_lessons():
    """Получить список уроков"""
    user_id = request.args.get('user_id', 1)
    lessons = lesson_manager.get_available_lessons(user_id)
    return jsonify(lessons)

@app.route('/api/lessons/<int:lesson_id>')
def get_lesson(lesson_id):
    """Получить конкретный урок"""
    lesson = lesson_manager.get_lesson(lesson_id)
    if lesson:
        return jsonify(lesson)
    return jsonify({'error': 'Lesson not found'}), 404

@app.route('/api/lessons/<int:lesson_id>/submit', methods=['POST'])
def submit_lesson(lesson_id):
    """Отправить решение урока"""
    user_id = request.json.get('user_id', 1)
    code = request.json.get('code', '')
    
    lesson = lesson_manager.get_lesson(lesson_id)
    if not lesson:
        return jsonify({'error': 'Lesson not found'}), 404
    
    # Простая проверка кода (для демо)
    if 'print(' in code:
        result = {
            "success": True,
            "output": "✅ Код выполнен успешно!\nВывод программы:\nПривет, АгроБот!",
            "error": ""
        }
    else:
        result = {
            "success": False,
            "output": "",
            "error": "❌ В коде нет функции print()"
        }
    
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

@app.route('/api/farm')
def get_farm():
    """Получить состояние фермы"""
    user_id = request.args.get('user_id', 1)
    farm_state = FarmState.get_by_user(user_id)
    
    if farm_state:
        return jsonify(farm_state)
    else:
        return jsonify({
            'level': 1,
            'buildings': [],
            'fields': [],
            'decorations': []
        })

@app.route('/api/admin/stats')
def admin_stats():
    """Статистика для админки"""
    return jsonify({
        'total_users': 1,
        'active_users': 1,
        'completed_lessons': 0
    })

if __name__ == '__main__':
    # Инициализация базы данных
    Database.init_tables()
    
    # Запуск бота
    init_bot()
    
    # Запуск Flask приложения
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=Config.DEBUG
    )
