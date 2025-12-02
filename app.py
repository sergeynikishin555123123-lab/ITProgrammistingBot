from fastapi import FastAPI, Request, Form, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import os
import sys
import logging
import secrets
from datetime import datetime, timedelta

# Добавляем путь к backend
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))

from backend.config import config
from backend.database import db
from backend.lessons import lesson_system
from backend.farm_engine import farm_engine

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Инициализация FastAPI
app = FastAPI(title="CodeFarm", description="Игровая платформа для обучения программированию")

# CORS для Telegram Web App
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # В продакшене замени на домен Telegram
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Монтирование статических файлов
app.mount("/static", StaticFiles(directory="static"), name="static")

# Инициализация шаблонов
templates = Jinja2Templates(directory="templates")

# Хранилище сессий (временное, в продакшене используй Redis)
sessions = {}

# 📊 API РОУТЫ
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request, startapp: str = None):
    """Главная страница - Telegram Web App"""
    
    # Генерируем сессию для пользователя
    session_token = secrets.token_urlsafe(32)
    
    # Если передан startapp (из Telegram), создаем сессию
    if startapp:
        sessions[session_token] = {
            "telegram_id": startapp,
            "created_at": datetime.now(),
            "expires_at": datetime.now() + timedelta(hours=24)
        }
    
    return templates.TemplateResponse("index.html", {
        "request": request,
        "session_token": session_token,
        "is_telegram": startapp is not None
    })

@app.get("/lesson/{lesson_id}", response_class=HTMLResponse)
async def read_lesson(request: Request, lesson_id: int, session_token: str = None):
    """Страница урока"""
    
    # Проверяем сессию
    if not session_token or session_token not in sessions:
        return HTMLResponse("<h1>❌ Сессия не найдена. Начни с /start в боте!</h1>")
    
    lesson = lesson_system.get_lesson(lesson_id)
    if not lesson:
        return HTMLResponse("<h1>Урок не найден</h1>")
    
    # Получаем ID пользователя из сессии
    telegram_id = sessions[session_token]["telegram_id"]
    
    # Получаем прогресс пользователя
    cursor = db.connection.cursor()
    if hasattr(db.connection, 'execute'):  # SQLite
        cursor.execute(
            "SELECT up.* FROM user_progress up JOIN users u ON up.user_id = u.id WHERE u.telegram_id = ? AND up.lesson_id = ?",
            (telegram_id, lesson_id)
        )
    else:  # PostgreSQL
        cursor.execute(
            "SELECT up.* FROM user_progress up JOIN users u ON up.user_id = u.id WHERE u.telegram_id = %s AND up.lesson_id = %s",
            (telegram_id, lesson_id)
        )
    
    progress = cursor.fetchone()
    cursor.close()
    
    return templates.TemplateResponse("lesson.html", {
        "request": request, 
        "lesson": lesson,
        "session_token": session_token,
        "completed": progress[3] if progress else False,  # completed field
        "user_solution": progress[4] if progress else ""  # code_solution field
    })

@app.post("/api/validate_code")
async def validate_code(
    lesson_id: int = Form(...), 
    user_code: str = Form(...),
    session_token: str = Form(...)
):
    """Валидация кода пользователя"""
    
    # Проверяем сессию
    if session_token not in sessions:
        return JSONResponse({"success": False, "error": "Сессия не найдена"})
    
    lesson = lesson_system.get_lesson(lesson_id)
    if not lesson:
        return JSONResponse({"success": False, "error": "Урок не найден"})
    
    is_correct = lesson_system.validate_solution(user_code, lesson["expected_output"])
    
    if is_correct:
        # Сохраняем прогресс в базе
        telegram_id = sessions[session_token]["telegram_id"]
        
        cursor = db.connection.cursor()
        
        # Находим user_id
        if hasattr(db.connection, 'execute'):  # SQLite
            cursor.execute("SELECT id FROM users WHERE telegram_id = ?", (telegram_id,))
        else:  # PostgreSQL
            cursor.execute("SELECT id FROM users WHERE telegram_id = %s", (telegram_id,))
        
        user_result = cursor.fetchone()
        
        if user_result:
            user_id = user_result[0]
            
            # Сохраняем прогресс
            if hasattr(db.connection, 'execute'):  # SQLite
                cursor.execute(
                    """
                    INSERT OR REPLACE INTO user_progress 
                    (user_id, lesson_id, completed, code_solution, attempts, completed_at) 
                    VALUES (?, ?, ?, ?, COALESCE((SELECT attempts FROM user_progress WHERE user_id = ? AND lesson_id = ?), 0) + 1, ?)
                    """,
                    (user_id, lesson_id, True, user_code, user_id, lesson_id, datetime.now())
                )
            else:  # PostgreSQL
                cursor.execute(
                    """
                    INSERT INTO user_progress 
                    (user_id, lesson_id, completed, code_solution, attempts, completed_at) 
                    VALUES (%s, %s, %s, %s, 
                        COALESCE((SELECT attempts FROM user_progress WHERE user_id = %s AND lesson_id = %s), 0) + 1, %s)
                    ON CONFLICT (user_id, lesson_id) 
                    DO UPDATE SET 
                        completed = EXCLUDED.completed,
                        code_solution = EXCLUDED.code_solution,
                        attempts = EXCLUDED.attempts,
                        completed_at = EXCLUDED.completed_at
                    """,
                    (user_id, lesson_id, True, user_code, user_id, lesson_id, datetime.now())
                )
            
            db.connection.commit()
        
        cursor.close()
        
        return JSONResponse({
            "success": True, 
            "message": "✅ Отлично! Код работает правильно!",
            "farm_updated": True,
            "coins_reward": 50,
            "exp_reward": 100
        })
    else:
        return JSONResponse({
            "success": False,
            "message": "❌ Код работает не совсем правильно. Попробуй еще раз!",
            "hint": "Проверь, что все команды print() выводят правильный текст"
        })

@app.get("/api/user_progress")
async def get_user_progress(session_token: str):
    """Получает прогресс пользователя"""
    if session_token not in sessions:
        return JSONResponse({"success": False, "error": "Сессия не найдена"})
    
    telegram_id = sessions[session_token]["telegram_id"]
    
    cursor = db.connection.cursor()
    
    # Получаем данные пользователя
    if hasattr(db.connection, 'execute'):  # SQLite
        cursor.execute(
            "SELECT id, username, level, coins, experience FROM users WHERE telegram_id = ?",
            (telegram_id,)
        )
    else:  # PostgreSQL
        cursor.execute(
            "SELECT id, username, level, coins, experience FROM users WHERE telegram_id = %s",
            (telegram_id,)
        )
    
    user_data = cursor.fetchone()
    
    if not user_data:
        cursor.close()
        return JSONResponse({"success": False, "error": "Пользователь не найден"})
    
    user_id = user_data[0]
    
    # Получаем прогресс по урокам
    if hasattr(db.connection, 'execute'):  # SQLite
        cursor.execute(
            "SELECT lesson_id, completed FROM user_progress WHERE user_id = ?",
            (user_id,)
        )
    else:  # PostgreSQL
        cursor.execute(
            "SELECT lesson_id, completed FROM user_progress WHERE user_id = %s",
            (user_id,)
        )
    
    progress_data = cursor.fetchall()
    cursor.close()
    
    completed_lessons = [row[0] for row in progress_data if row[1]]
    
    return JSONResponse({
        "success": True,
        "user": {
            "username": user_data[1],
            "level": user_data[2],
            "coins": user_data[3],
            "experience": user_data[4]
        },
        "progress": {
            "completed_lessons": completed_lessons,
            "total_lessons": len(lesson_system.lessons)
        }
    })

@app.get("/health")
async def health_check():
    """Проверка здоровья приложения"""
    return {
        "status": "ok", 
        "message": "CodeFarm работает!",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0"
    }

# 🚀 ЗАПУСК СЕРВЕРА
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=port,
        reload=False
    )
