import os
import psycopg2
from psycopg2 import pool
from flask import g
import logging

logger = logging.getLogger(__name__)

class DatabaseConnection:
    """Менеджер подключений к PostgreSQL"""
    
    _connection_pool = None
    
    @classmethod
    def initialize(cls, app_config):
        """Инициализация пула подключений"""
        try:
            cls._connection_pool = psycopg2.pool.SimpleConnectionPool(
                minconn=1,
                maxconn=10,
                host=app_config.DB_HOST,
                database=app_config.DB_NAME,
                user=app_config.DB_USER,
                password=app_config.DB_PASSWORD,
                port=app_config.DB_PORT,
                sslmode='require'
            )
            logger.info("Database connection pool initialized")
        except Exception as e:
            logger.error(f"Failed to initialize database pool: {e}")
            raise
    
    @classmethod
    def get_connection(cls):
        """Получение подключения из пула"""
        if cls._connection_pool is None:
            raise Exception("Database pool not initialized")
        return cls._connection_pool.getconn()
    
    @classmethod
    def return_connection(cls, connection):
        """Возврат подключения в пул"""
        if cls._connection_pool:
            cls._connection_pool.putconn(connection)
    
    @classmethod
    def close_all_connections(cls):
        """Закрытие всех подключений"""
        if cls._connection_pool:
            cls._connection_pool.closeall()

def init_db(app):
    """Инициализация базы данных для Flask приложения"""
    DatabaseConnection.initialize(app.config)
    
    @app.teardown_appcontext
    def close_db(error):
        """Закрытие подключения при завершении контекста"""
        if hasattr(g, 'db_conn'):
            DatabaseConnection.return_connection(g.db_conn)

def get_db():
    """Получение подключения к базе данных для текущего контекста"""
    if 'db_conn' not in g:
        g.db_conn = DatabaseConnection.get_connection()
    return g.db_conn

def execute_query(query, params=None, fetchone=False, fetchall=False):
    """Выполнение SQL запроса"""
    conn = get_db()
    cursor = conn.cursor()
    
    try:
        cursor.execute(query, params or ())
        
        if fetchone:
            result = cursor.fetchone()
        elif fetchall:
            result = cursor.fetchall()
        else:
            conn.commit()
            result = cursor.rowcount
        
        return result
    except Exception as e:
        conn.rollback()
        logger.error(f"Query error: {e}")
        raise
    finally:
        cursor.close()

def create_tables():
    """Создание таблиц базы данных"""
    queries = [
        """
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            telegram_id BIGINT UNIQUE NOT NULL,
            username VARCHAR(100),
            first_name VARCHAR(100),
            last_name VARCHAR(100),
            level INTEGER DEFAULT 1,
            experience INTEGER DEFAULT 0,
            coins INTEGER DEFAULT 100,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_premium BOOLEAN DEFAULT FALSE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS lessons (
            id SERIAL PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            description TEXT,
            theory TEXT,
            task TEXT,
            initial_code TEXT,
            expected_output TEXT,
            order_index INTEGER NOT NULL,
            difficulty VARCHAR(50),
            category VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS user_progress (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id),
            lesson_id INTEGER REFERENCES lessons(id),
            completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            code_solution TEXT,
            attempts INTEGER DEFAULT 0,
            success BOOLEAN DEFAULT FALSE,
            UNIQUE(user_id, lesson_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS farm_state (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) UNIQUE,
            grid_data JSONB DEFAULT '{}',
            buildings JSONB DEFAULT '[]',
            decorations JSONB DEFAULT '[]',
            animals JSONB DEFAULT '[]',
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS achievements (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id),
            achievement_name VARCHAR(200),
            unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            reward_coins INTEGER DEFAULT 0
        )
        """
    ]
    
    for query in queries:
        execute_query(query)
    
    logger.info("Database tables created successfully")
