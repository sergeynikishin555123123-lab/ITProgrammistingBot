# database.py
import sqlite3
import json
from datetime import datetime
from config import Config

class Database:
    @staticmethod
    def get_connection():
        """Возвращает соединение с SQLite"""
        try:
            conn = sqlite3.connect(Config.DB_PATH)
            conn.row_factory = sqlite3.Row
            return conn
        except Exception as e:
            print(f"❌ Ошибка подключения к БД: {e}")
            return None
    
    @staticmethod
    def init_tables():
        """Инициализирует таблицы в SQLite"""
        conn = Database.get_connection()
        if not conn:
            return False
        
        try:
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
            
            # Таблица уроков
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS lessons (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    description TEXT,
                    theory TEXT,
                    task TEXT,
                    initial_code TEXT,
                    tests TEXT,
                    order_index INTEGER,
                    farm_update TEXT
                )
            ''')
            
            # Таблица прогресса
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS user_progress (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    lesson_id INTEGER,
                    code_solution TEXT,
                    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, lesson_id)
                )
            ''')
            
            # Таблица фермы
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
            print("✅ Таблицы SQLite инициализированы")
            return True
            
        except Exception as e:
            print(f"❌ Ошибка инициализации таблиц: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()

class User:
    @staticmethod
    def get_or_create(telegram_id, username, full_name):
        """Создает или возвращает пользователя"""
        conn = Database.get_connection()
        if not conn:
            return None
        
        try:
            cursor = conn.cursor()
            
            cursor.execute(
                'SELECT * FROM users WHERE telegram_id = ?',
                (telegram_id,)
            )
            user = cursor.fetchone()
            
            if user:
                return dict(user)
            else:
                cursor.execute(
                    '''INSERT INTO users (telegram_id, username, full_name) 
                    VALUES (?, ?, ?) RETURNING *''',
                    (telegram_id, username, full_name)
                )
                new_user = cursor.fetchone()
                
                # Создаем начальное состояние фермы
                cursor.execute(
                    'INSERT INTO farm_state (user_id) VALUES (?)',
                    (new_user['id'],)
                )
                
                conn.commit()
                return dict(new_user)
                
        except Exception as e:
            print(f"❌ Ошибка работы с пользователем: {e}")
            conn.rollback()
            return None
        finally:
            conn.close()

class LessonProgress:
    @staticmethod
    def create(user_id, lesson_id, code_solution):
        """Сохраняет прогресс урока"""
        conn = Database.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            cursor.execute(
                '''INSERT OR REPLACE INTO user_progress (user_id, lesson_id, code_solution) 
                VALUES (?, ?, ?)''',
                (user_id, lesson_id, code_solution)
            )
            conn.commit()
            return True
        except Exception as e:
            print(f"❌ Ошибка сохранения прогресса: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()
    
    @staticmethod
    def get_completed_lessons(user_id):
        """Возвращает пройденные уроки пользователя"""
        conn = Database.get_connection()
        if not conn:
            return []
        
        try:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT lesson_id FROM user_progress WHERE user_id = ?',
                (user_id,)
            )
            return [row[0] for row in cursor.fetchall()]
        except Exception as e:
            print(f"❌ Ошибка получения прогресса: {e}")
            return []
        finally:
            conn.close()

class FarmState:
    @staticmethod
    def get_by_user(user_id):
        """Возвращает состояние фермы пользователя"""
        conn = Database.get_connection()
        if not conn:
            return None
        
        try:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT * FROM farm_state WHERE user_id = ?',
                (user_id,)
            )
            farm = cursor.fetchone()
            
            if farm:
                return {
                    'level': farm['level'],
                    'buildings': json.loads(farm['buildings']) if farm['buildings'] else [],
                    'fields': json.loads(farm['fields']) if farm['fields'] else [],
                    'decorations': json.loads(farm['decorations']) if farm['decorations'] else []
                }
            return None
        except Exception as e:
            print(f"❌ Ошибка получения состояния фермы: {e}")
            return None
        finally:
            conn.close()
