import psycopg2
import os
import json
from backend.config import config

class Database:
    def __init__(self):
        self.connection = None
        self.connect()
        self.init_tables()
    
    def connect(self):
        """Подключение к PostgreSQL"""
        try:
            self.connection = psycopg2.connect(**config.DB_CONFIG)
            print("✅ Подключение к базе данных установлено")
        except Exception as e:
            print(f"❌ Ошибка подключения к БД: {e}")
            # Создаем временную in-memory базу для демо
            self.create_demo_tables()
    
    def create_demo_tables(self):
        """Создает демо-таблицы в памяти"""
        print("🔄 Создаю демо-таблицы в памяти...")
        import sqlite3
        self.connection = sqlite3.connect(':memory:', check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
    
    def init_tables(self):
        """Инициализация таблиц"""
        try:
            cursor = self.connection.cursor()
            
            # Проверяем тип базы данных
            if hasattr(self.connection, 'execute'):
                # SQLite
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        telegram_id INTEGER UNIQUE NOT NULL,
                        username TEXT,
                        level INTEGER DEFAULT 1,
                        coins INTEGER DEFAULT 100,
                        experience INTEGER DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS user_progress (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER REFERENCES users(id),
                        lesson_id INTEGER NOT NULL,
                        completed BOOLEAN DEFAULT FALSE,
                        code_solution TEXT,
                        attempts INTEGER DEFAULT 0,
                        completed_at TIMESTAMP,
                        UNIQUE(user_id, lesson_id)
                    )
                ''')
                
            else:
                # PostgreSQL
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS users (
                        id SERIAL PRIMARY KEY,
                        telegram_id BIGINT UNIQUE NOT NULL,
                        username VARCHAR(255),
                        level INTEGER DEFAULT 1,
                        coins INTEGER DEFAULT 100,
                        experience INTEGER DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS user_progress (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER REFERENCES users(id),
                        lesson_id INTEGER NOT NULL,
                        completed BOOLEAN DEFAULT FALSE,
                        code_solution TEXT,
                        attempts INTEGER DEFAULT 0,
                        completed_at TIMESTAMP,
                        UNIQUE(user_id, lesson_id)
                    )
                ''')
            
            self.connection.commit()
            cursor.close()
            print("✅ Таблицы базы данных инициализированы")
            
        except Exception as e:
            print(f"❌ Ошибка инициализации таблиц: {e}")

db = Database()
