# code_executor.py
import subprocess
import tempfile
import os
import ast

class CodeExecutor:
    def execute_python(self, code, tests):
        """Безопасное выполнение Python кода"""
        try:
            # Проверка синтаксиса
            self.validate_syntax(code)
            
            # Создаем временный файл
            with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
                full_code = self.wrap_code(code, tests)
                f.write(full_code)
                temp_file = f.name
            
            try:
                # Выполняем код
                result = subprocess.run(
                    ['python', temp_file],
                    capture_output=True,
                    text=True,
                    timeout=10,
                    cwd=os.path.dirname(temp_file)
                )
                
                output = result.stdout + result.stderr
                
                if result.returncode == 0:
                    return {
                        "success": True,
                        "output": output,
                        "error": ""
                    }
                else:
                    return {
                        "success": False,
                        "output": output,
                        "error": "Ошибка выполнения"
                    }
                    
            finally:
                # Удаляем временный файл
                os.unlink(temp_file)
                
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "output": "",
                "error": "Превышено время выполнения"
            }
        except Exception as e:
            return {
                "success": False,
                "output": "",
                "error": f"Ошибка: {str(e)}"
            }
    
    def validate_syntax(self, code):
        """Проверяет синтаксис кода"""
        try:
            ast.parse(code)
        except SyntaxError as e:
            raise Exception(f"Синтаксическая ошибка: {e}")
    
    def wrap_code(self, user_code, tests):
        """Оборачивает пользовательский код в безопасное окружение"""
        safe_code = f"""
# Безопасное окружение
import sys
from io import StringIO

# Перехватываем вывод
old_stdout = sys.stdout
sys.stdout = StringIO()

try:
    # Пользовательский код
{self.indent_code(user_code)}
    
    # Запуск тестов
    output = sys.stdout.getvalue()
    
    # Простые проверки
    def check_output_contains(text):
        return text in output
    
    def check_variable_exists(var_name):
        return var_name in locals()
    
    # Выполняем тесты
    test_results = []
    {tests}
    
    # Вывод результатов
    print("=== РЕЗУЛЬТАТЫ ===")
    print(f"Вывод программы:")
    print(output)
    print(f"Результаты тестов: {{test_results}}")
    
except Exception as e:
    print(f"Ошибка: {{e}}")
finally:
    sys.stdout = old_stdout
"""
        return safe_code
    
    def indent_code(self, code):
        """Добавляет отступы к коду"""
        lines = code.split('\n')
        indented = ['    ' + line for line in lines]
        return '\n'.join(indented)
