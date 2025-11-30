from fastapi import FastAPI, Request, Form
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, JSONResponse
import uvicorn
import os
from telegram.ext import Application, CommandHandler, MessageHandler, filters

# Импорты из backend модулей
from backend.config import config
from backend.database import db
from backend.lessons import lesson_system
from backend.farm_engine import farm_engine
from backend.bot_handlers import BotHandlers

# Инициализация FastAPI
app = FastAPI(title="CodeFarm", description="Игровая платформа для обучения программированию")

# Монтирование статических файлов
app.mount("/static", StaticFiles(directory="static"), name="static")

# Инициализация шаблонов
templates = Jinja2Templates(directory="templates")

# Инициализация бота
bot_application = Application.builder().token(config.BOT_TOKEN).build()

# Инициализация обработчиков
bot_handlers = BotHandlers(db, lesson_system, farm_engine)

# Регистрация обработчиков бота
bot_application.add_handler(CommandHandler("start", bot_handlers.start))
bot_application.add_handler(MessageHandler(filters.Text(["📚 Уроки"]), bot_handlers.show_lessons))
bot_application.add_handler(MessageHandler(filters.Text(["🏠 Моя ферма"]), bot_handlers.show_farm))

# 📊 API РОУТЫ
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    """Главная страница"""
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/lesson/{lesson_id}", response_class=HTMLResponse)
async def read_lesson(request: Request, lesson_id: int):
    """Страница урока"""
    lesson = lesson_system.get_lesson(lesson_id)
    if not lesson:
        return HTMLResponse("<h1>Урок не найден</h1>")
    
    return templates.TemplateResponse("lesson.html", {
        "request": request, 
        "lesson": lesson
    })

@app.post("/api/validate_code")
async def validate_code(lesson_id: int = Form(...), user_code: str = Form(...)):
    """Валидация кода пользователя"""
    lesson = lesson_system.get_lesson(lesson_id)
    if not lesson:
        return JSONResponse({"success": False, "error": "Урок не найден"})
    
    is_correct = lesson_system.validate_solution(user_code, lesson["expected_output"])
    
    if is_correct:
        return JSONResponse({
            "success": True, 
            "message": "✅ Отлично! Код работает правильно!",
            "farm_updated": True
        })
    else:
        return JSONResponse({
            "success": False,
            "message": "❌ Код работает не совсем правильно. Попробуй еще раз!"
        })

@app.get("/admin", response_class=HTMLResponse)
async def admin_panel(request: Request):
    """Панель администратора"""
    cursor = db.connection.cursor()
    cursor.execute("SELECT COUNT(*) FROM users")
    user_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM user_progress WHERE completed = TRUE")
    completed_lessons = cursor.fetchone()[0]
    
    cursor.close()
    
    return templates.TemplateResponse("admin.html", {
        "request": request,
        "user_count": user_count,
        "completed_lessons": completed_lessons
    })

# 🚀 ЗАПУСК СЕРВЕРА
async def start_bot():
    """Запуск Telegram бота"""
    await bot_application.initialize()
    await bot_application.start()
    await bot_application.updater.start_polling()

@app.on_event("startup")
async def startup_event():
    """Запуск при старте сервера"""
    await start_bot()
    print("🚀 CodeFarm сервер запущен!")

@app.on_event("shutdown") 
async def shutdown_event():
    """Остановка при завершении сервера"""
    await bot_application.stop()
    await bot_application.shutdown()
    print("🛑 CodeFarm сервер остановлен")

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=port,
        reload=False
    )
