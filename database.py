# database.py
import psycopg2
import json
from datetime import datetime
from config import Config

class Database:
    @staticmethod
    def get_connection():
        """Возвращает соединение с PostgreSQL"""
        try:
            conn = psycopg2.connect(**Config.DB_CONFIG)
            return conn
        except Exception as e:
            print(f"❌ Ошибка подключения к БД: {e}")
            return None
    
    @staticmethod
    def init_tables():
        """Инициализирует таблицы в базе данных"""
        conn = Database.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            
            # Таблица пользователей
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    telegram_id BIGINT UNIQUE,
                    username VARCHAR(100),
                    full_name VARCHAR(200),
                    level INTEGER DEFAULT 1,
                    experience INTEGER DEFAULT 0,
                    coins INTEGER DEFAULT 100,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Таблица уроков
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS lessons (
                    id SERIAL PRIMARY KEY,
                    title VARCHAR(200) NOT NULL,
                    description TEXT,
                    theory TEXT,
                    task TEXT,
                    initial_code TEXT,
                    tests TEXT,
                    order_index INTEGER,
                    farm_update JSONB
                )
            ''')
            
            # Таблица прогресса
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS user_progress (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id),
                    lesson_id INTEGER,
                    code_solution TEXT,
                    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, lesson_id)
                )
            ''')
            
            # Таблица фермы
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS farm_state (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER UNIQUE REFERENCES users(id),
                    level INTEGER DEFAULT 1,
                    buildings JSONB DEFAULT '[]',
                    fields JSONB DEFAULT '[]',
                    decorations JSONB DEFAULT '[]',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            conn.commit()
            print("✅ Таблицы базы данных инициализированы")
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
                'SELECT * FROM users WHERE telegram_id = %s',
                (telegram_id,)
            )
            user = cursor.fetchone()
            
            if user:
                return {
                    'id': user[0],
                    'telegram_id': user[1],
                    'username': user[2],
                    'full_name': user[3],
                    'level': user[4],
                    'coins': user[6]
                }
            else:
                cursor.execute(
                    '''INSERT INTO users (telegram_id, username, full_name) 
                    VALUES (%s, %s, %s) RETURNING *''',
                    (telegram_id, username, full_name)
                )
                new_user = cursor.fetchone()
                
                # Создаем начальное состояние фермы
                cursor.execute(
                    'INSERT INTO farm_state (user_id) VALUES (%s)',
                    (new_user[0],)
                )
                
                conn.commit()
                
                return {
                    'id': new_user[0],
                    'telegram_id': new_user[1],
                    'username': new_user[2],
                    'full_name': new_user[3],
                    'level': new_user[4],
                    'coins': new_user[6]
                }
                
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
                '''INSERT INTO user_progress (user_id, lesson_id, code_solution) 
                VALUES (%s, %s, %s)''',
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
                'SELECT lesson_id FROM user_progress WHERE user_id = %s',
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
                'SELECT * FROM farm_state WHERE user_id = %s',
                (user_id,)
            )
            farm = cursor.fetchone()
            
            if farm:
                return {
                    'level': farm[2],
                    'buildings': farm[3] or [],
                    'fields': farm[4] or [],
                    'decorations': farm[5] or []
                }
            return None
        except Exception as e:
            print(f"❌ Ошибка получения состояния фермы: {e}")
            return None
        finally:
            conn.close()
    
    @staticmethod
    def update(user_id, level=None, buildings=None, fields=None, decorations=None):
        """Обновляет состояние фермы"""
        conn = Database.get_connection()
        if not conn:
            return False
        
        try:
            cursor = conn.cursor()
            
            # Получаем текущее состояние
            current = FarmState.get_by_user(user_id)
            if not current:
                return False
            
            # Обновляем только переданные поля
            new_level = level if level is not None else current['level']
            new_buildings = json.dumps(buildings) if buildings is not None else current['buildings']
            new_fields = json.dumps(fields) if fields is not None else current['fields']
            new_decorations = json.dumps(decorations) if decorations is not None else current['decorations']
            
            cursor.execute(
                '''UPDATE farm_state 
                SET level = %s, buildings = %s, fields = %s, decorations = %s 
                WHERE user_id = %s''',
                (new_level, new_buildings, new_fields, new_decorations, user_id)
            )
            
            conn.commit()
            return True
        except Exception as e:
            print(f"❌ Ошибка обновления фермы: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()
