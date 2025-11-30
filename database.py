# database.py
import sqlite3
import json
from datetime import datetime

class Database:
    @staticmethod
    def get_connection():
        """Возвращает соединение с базой данных"""
        conn = sqlite3.connect('codefarm.db')
        conn.row_factory = sqlite3.Row
        return conn

class User:
    @staticmethod
    def get_or_create(telegram_id, username, full_name):
        """Создает или возвращает пользователя"""
        conn = Database.get_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT * FROM users WHERE telegram_id = ?',
            (telegram_id,)
        )
        user = cursor.fetchone()
        
        if user:
            conn.close()
            return dict(user)
        else:
            cursor.execute(
                '''INSERT INTO users (telegram_id, username, full_name, level, experience, coins) 
                VALUES (?, ?, ?, ?, ?, ?)''',
                (telegram_id, username, full_name, 1, 0, 100)
            )
            user_id = cursor.lastrowid
            
            # Создаем начальное состояние фермы
            cursor.execute(
                'INSERT INTO farm_state (user_id, level, buildings, fields, decorations) VALUES (?, ?, ?, ?, ?)',
                (user_id, 1, '[]', '[]', '[]')
            )
            
            conn.commit()
            conn.close()
            
            return {
                'id': user_id,
                'telegram_id': telegram_id,
                'username': username,
                'full_name': full_name,
                'level': 1,
                'experience': 0,
                'coins': 100
            }

class LessonProgress:
    @staticmethod
    def create(user_id, lesson_id, code_solution):
        """Сохраняет прогресс урока"""
        conn = Database.get_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            '''INSERT OR REPLACE INTO lesson_progress (user_id, lesson_id, code_solution) 
            VALUES (?, ?, ?)''',
            (user_id, lesson_id, code_solution)
        )
        
        conn.commit()
        conn.close()
    
    @staticmethod
    def get_completed_lessons(user_id):
        """Возвращает список пройденных уроков"""
        conn = Database.get_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT lesson_id FROM lesson_progress WHERE user_id = ?',
            (user_id,)
        )
        lessons = [row[0] for row in cursor.fetchall()]
        conn.close()
        
        return lessons
    
    @staticmethod
    def get_completion_stats():
        """Возвращает статистику прохождения уроков"""
        conn = Database.get_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT lesson_id, COUNT(*) as completions 
            FROM lesson_progress 
            GROUP BY lesson_id 
            ORDER BY lesson_id
        ''')
        stats = {row[0]: row[1] for row in cursor.fetchall()}
        conn.close()
        
        return stats

class FarmState:
    @staticmethod
    def get_by_user(user_id):
        """Возвращает состояние фермы пользователя"""
        conn = Database.get_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            'SELECT * FROM farm_state WHERE user_id = ?',
            (user_id,)
        )
        farm_data = cursor.fetchone()
        conn.close()
        
        if farm_data:
            return {
                'level': farm_data[2],
                'buildings': json.loads(farm_data[3]),
                'fields': json.loads(farm_data[4]),
                'decorations': json.loads(farm_data[5])
            }
        return None
    
    @staticmethod
    def update(user_id, level=None, buildings=None, fields=None, decorations=None):
        """Обновляет состояние фермы"""
        conn = Database.get_connection()
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
            SET level = ?, buildings = ?, fields = ?, decorations = ?, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?''',
            (new_level, new_buildings, new_fields, new_decorations, user_id)
        )
        
        conn.commit()
        conn.close()
        return True
