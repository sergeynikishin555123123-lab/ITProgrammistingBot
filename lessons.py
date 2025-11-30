# lessons.py
import json
import os
from database import LessonProgress

class LessonManager:
    def __init__(self):
        self.lessons = self.load_lessons()
    
    def load_lessons(self):
        """Загружает уроки из JSON файла"""
        lessons_path = os.path.join('data', 'lessons.json')
        
        if not os.path.exists(lessons_path):
            # Создаем базовые уроки
            base_lessons = self.create_base_lessons()
            os.makedirs('data', exist_ok=True)
            with open(lessons_path, 'w', encoding='utf-8') as f:
                json.dump(base_lessons, f, ensure_ascii=False, indent=2)
            return base_lessons
        
        with open(lessons_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def create_base_lessons(self):
        """Создает базовые уроки"""
        return [
            {
                "id": 1,
                "title": "Первая программа - Запуск бота",
                "description": "Научись основам Python: синтаксис, функции print(), комментарии",
                "theory": "Python - язык программирования с простым и понятным синтаксисом. Каждая программа состоит из инструкций, которые выполняются последовательно.\n\nФункция print() выводит текст на экран. Комментарии начинаются с символа # и игнорируются Python.",
                "task": "Напиши программу, которая поприветствует бота и активирует системы фермы",
                "initial_code": "# Твоя первая программа\nprint(\"Привет, АгроБот!\")\n\n# Добавь код для активации систем",
                "tests": "check_output_contains('Привет, АгроБот!')",
                "farm_update": {
                    "action": "clear_land",
                    "area": "all",
                    "message": "Территория расчищена для строительства!"
                },
                "reward": {"coins": 50, "exp": 100}
            },
            {
                "id": 2,
                "title": "Переменные - Проект фермы",
                "description": "Изучи переменные и типы данных для создания проекта фермы",
                "theory": "Переменные - это контейнеры для хранения данных. В Python переменные создаются простым присваиванием значения.\n\nТипы данных:\n- str (текст): 'Привет'\n- int (числа): 100\n- bool (логика): True/False",
                "task": "Создай переменные для названия фермы, площади и проверь условия",
                "initial_code": "название_фермы = \"Солнечная долина\"\nплощадь = 100\nесть_вода = True\n\n# Выведи информацию о ферме",
                "tests": "check_variable_exists('название_фермы') and check_output()",
                "farm_update": {
                    "action": "add_sign",
                    "text": "Солнечная долина", 
                    "position": {"x": 50, "y": 50}
                },
                "reward": {"coins": 75, "exp": 150}
            },
            {
                "id": 3,
                "title": "Функции - Расчистка территории", 
                "description": "Научись создавать функции для управления техникой",
                "theory": "Функции - это повторно используемые блоки кода. Они помогают организовать код и избежать повторений.\n\ndef имя_функции():\n    # код функции\n\nФункции вызываются по имени: имя_функции()",
                "task": "Создай функции для запуска трактора и расчистки территории",
                "initial_code": "def запустить_трактор():\n    print(\"Запускаю трактор...\")\n\ndef расчистить_участок(сторона):\n    print(f\"Расчищаю {сторону} сторону\")\n\n# Используй функции",
                "tests": "check_function_called('запустить_трактор')",
                "farm_update": {
                    "action": "activate_tractor", 
                    "path": ["north", "east", "south", "west"]
                },
                "reward": {"coins": 100, "exp": 200}
            }
        ]
    
    def get_available_lessons(self, user_id):
        """Возвращает уроки доступные пользователю"""
        completed_lessons = LessonProgress.get_completed_lessons(user_id)
        
        available_lessons = []
        for lesson in self.lessons:
            lesson_data = lesson.copy()
            lesson_data["completed"] = lesson["id"] in completed_lessons
            lesson_data["available"] = self.is_lesson_available(lesson["id"], completed_lessons)
            available_lessons.append(lesson_data)
        
        return available_lessons
    
    def is_lesson_available(self, lesson_id, completed_lessons):
        """Проверяет доступен ли урок"""
        if lesson_id == 1:
            return True
        return (lesson_id - 1) in completed_lessons
    
    def get_lesson(self, lesson_id):
        """Возвращает урок по ID"""
        for lesson in self.lessons:
            if lesson["id"] == lesson_id:
                return lesson
        return None
    
    def complete_lesson(self, user_id, lesson_id, code_solution):
        """Отмечает урок как выполненный"""
        LessonProgress.create(user_id, lesson_id, code_solution)
    
    def get_farm_update(self, lesson_id):
        """Возвращает обновление для фермы после урока"""
        lesson = self.get_lesson(lesson_id)
        return lesson.get("farm_update", {}) if lesson else {}
