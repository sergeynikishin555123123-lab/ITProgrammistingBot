# lessons.py
from database import LessonProgress

class LessonManager:
    def __init__(self):
        self.lessons = self.create_lessons()
    
    def create_lessons(self):
        """Создает базовые уроки"""
        return [
            {
                "id": 1,
                "title": "Первая программа - Запуск бота",
                "description": "Научись основам Python: синтаксис, функции print(), комментарии",
                "theory": "Python - язык программирования с простым и понятным синтаксисом...",
                "task": "Напиши программу, которая поприветствует бота и активирует системы фермы",
                "initial_code": '# Твоя первая программа\nprint("Привет, АгроБот!")\n\n# Добавь код для активации систем',
                "tests": "check_output_contains('Привет, АгроБот!')",
                "farm_update": {
                    "action": "clear_land",
                    "area": "all",
                    "message": "Территория расчищена для строительства!"
                }
            },
            {
                "id": 2,
                "title": "Переменные - Проект фермы", 
                "description": "Изучи переменные и типы данных для создания проекта фермы",
                "theory": "Переменные - это контейнеры для хранения данных...",
                "task": "Создай переменные для названия фермы, площади и проверь условия",
                "initial_code": 'название_фермы = "Солнечная долина"\nплощадь = 100\nесть_вода = True\n\n# Выведи информацию о ферме',
                "tests": "check_variable_exists('название_фермы') and check_output()",
                "farm_update": {
                    "action": "add_sign", 
                    "text": "Солнечная долина",
                    "position": {"x": 50, "y": 50}
                }
            },
            {
                "id": 3,
                "title": "Функции - Расчистка территории",
                "description": "Научись создавать функции для управления техникой", 
                "theory": "Функции - это повторно используемые блоки кода...",
                "task": "Создай функции для запуска трактора и расчистки территории",
                "initial_code": 'def запустить_трактор():\n    print("Запускаю трактор...")\n\ndef расчистить_участок(сторона):\n    print(f"Расчищаю {сторону} сторону")\n\n# Используй функции',
                "tests": "check_function_called('запустить_трактор')",
                "farm_update": {
                    "action": "activate_tractor",
                    "path": ["north", "east", "south", "west"]
                }
            }
        ]
    
    def get_available_lessons(self, user_id):
        """Возвращает доступные уроки"""
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
        """Возвращает обновление для фермы"""
        lesson = self.get_lesson(lesson_id)
        return lesson.get("farm_update", {}) if lesson else {}
