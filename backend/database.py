import psycopg2
import os
from config import config

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
    
    def init_tables(self):
        """Инициализация таблиц"""
        commands = [
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                username VARCHAR(255),
                level INTEGER DEFAULT 1,
                coins INTEGER DEFAULT 100,
                experience INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """,
            """
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
            """,
            """
            CREATE TABLE IF NOT EXISTS farm_state (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) UNIQUE,
                field_data JSONB DEFAULT '{}',
                buildings JSONB DEFAULT '[]',
                decorations JSONB DEFAULT '[]',
                animals JSONB DEFAULT '[]'
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS lessons (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                theory_text TEXT,
                task_text TEXT,
                initial_code TEXT,
                expected_output TEXT,
                difficulty INTEGER DEFAULT 1,
                order_index INTEGER NOT NULL
            )
            """
        ]
        
        try:
            cursor = self.connection.cursor()
            for command in commands:
                cursor.execute(command)
            self.connection.commit()
            cursor.close()
            print("✅ Таблицы базы данных инициализированы")
        except Exception as e:
            print(f"❌ Ошибка инициализации таблиц: {e}")

db = Database()
