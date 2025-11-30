class LessonSystem:
    """Система уроков программирования"""
    
    def __init__(self):
        self.lessons = self.load_lessons()
    
    def load_lessons(self):
        """Загружает все уроки"""
        return [
            {
                "id": 1,
                "title": "Первые команды боту-помощнику",
                "theory": """
                <h3>Знакомство с ботом-помощником</h3>
                <p>Привет, фермер! Я - твой умный помощник АгроБот. Я понимаю команды на Python и могу управлять всей техникой на ферме.</p>
                
                <h4>Что такое функция в программировании?</h4>
                <p>Функция - это как кнопка на пульте управления. Нажал - получил результат.</p>
                
                <pre><code># Примеры команд для меня:
print("Привет!")              # - я напечатаю текст
bot_say("Начинаю работу")     # - я произнесу это вслух
tractor_start()               # - запущу трактор</code></pre>
                """,
                "task": "Напиши программу, которая поприветствует бота и запустит трактор для расчистки территории.",
                "initial_code": """# Твоя первая программа!
# Поприветствуй бота и запусти технику

print("Добавь код здесь")
""",
                "expected_output": "Привет, АгроБот!\\nТрактор запущен!\\nНачинаю расчистку территории...",
                "solution": """print("Привет, АгроБот!")
print("Трактор запущен!")
print("Начинаю расчистку территории...")"""
            },
            {
                "id": 2, 
                "title": "Переменные - Проект фермы",
                "theory": """
                <h3>Что такое переменная?</h3>
                <p>Переменная - это как ящик с надписью. Положил что-то внутрь, подписал - потом легко найдешь.</p>
                
                <pre><code># Создаем переменные-ящики:
farm_name = "Солнечная долина"    # Текст в ящике
field_size = 100                  # Число в ящике  
has_water = True                  # Флажок Да/Нет</code></pre>
                """,
                "task": "Создай проект своей фермы используя переменные: название, площадь, наличие воды.",
                "initial_code": """# Спроектируй свою ферму!
# Используй переменные для хранения данных

farm_name = 
field_size = 
has_water = 

print("Моя ферма называется: " + farm_name)
print("Площадь: " + str(field_size) + " гектаров")
print("Водоснабжение: " + str(has_water))
""",
                "expected_output": "Моя ферма называется: Солнечная долина\\nПлощадь: 100 гектаров\\nВодоснабжение: True",
                "solution": """farm_name = "Солнечная долина"
field_size = 100
has_water = True

print("Моя ферма называется: " + farm_name)
print("Площадь: " + str(field_size) + " гектаров") 
print("Водоснабжение: " + str(has_water))"""
            },
            {
                "id": 3,
                "title": "Функции - Расчистка территории", 
                "theory": """
                <h3>Зачем нужны свои функции?</h3>
                <p>Когда ты постоянно повторяешь одни и те же действия, проще создать 'макрос' - одну команду, которая делает сразу несколько действий.</p>
                
                <pre><code># Вместо этого каждый раз:
tractor_start()
tractor_forward() 
tractor_forward()
tractor_turn()

# Создаем функцию:
def clear_sector():
    tractor_start()
    tractor_forward()
    tractor_forward() 
    tractor_turn()

# И теперь просто:
clear_sector()
clear_sector()</code></pre>
                """,
                "task": "Создай функции для автоматической расчистки четырех секторов поля.",
                "initial_code": """# Создай функции для автоматизации!
# Твои первые функции для фермы

def clear_north():
    print("Расчищаю северный сектор...")

def clear_east():
    # Добавь код здесь!
    pass

# Вызови функции для расчистки всех секторов

""",
                "expected_output": "Расчищаю северный сектор...\\nРасчищаю восточный сектор...\\nРасчищаю южный сектор...\\nРасчищаю западный сектор...\\nТерритория расчищена!",
                "solution": """def clear_north():
    print("Расчищаю северный сектор...")

def clear_east():
    print("Расчищаю восточный сектор...")

def clear_south():
    print("Расчищаю южный сектор...") 

def clear_west():
    print("Расчищаю западный сектор...")

clear_north()
clear_east() 
clear_south()
clear_west()
print("Территория расчищена!")"""
            }
        ]
    
    def get_lesson(self, lesson_id):
        """Получает урок по ID"""
        for lesson in self.lessons:
            if lesson["id"] == lesson_id:
                return lesson
        return None
    
    def validate_solution(self, user_code, expected_output):
        """Валидирует решение пользователя"""
        # Простая проверка вывода (в реальном проекте будет код-исполнитель)
        try:
            # Эмуляция выполнения кода
            lines = user_code.split('\n')
            output_lines = []
            
            for line in lines:
                if line.strip().startswith('print('):
                    # Извлекаем текст из print
                    content = line.split('print(')[1].rstrip(')').strip('"\'')
                    output_lines.append(content)
            
            user_output = '\n'.join(output_lines)
            return user_output.strip() == expected_output.strip()
            
        except Exception as e:
            return False

lesson_system = LessonSystem()
