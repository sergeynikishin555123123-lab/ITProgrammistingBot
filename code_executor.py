# code_executor.py
import subprocess
import tempfile
import os

class CodeExecutor:
    def execute_python(self, code, tests):
        """Безопасное выполнение Python кода"""
        try:
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
                    timeout=10
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
    
    def wrap_code(self, user_code, tests):
        """Оборачивает пользовательский код"""
        return f"""
# Безопасное окружение
import sys
from io import StringIO

# Перехватываем вывод
old_stdout = sys.stdout
sys.stdout = StringIO()

try:
    # Пользовательский код
{self.indent_code(user_code)}
    
    # Простые проверки
    output = sys.stdout.getvalue()
    
    def check_output_contains(text):
        return text in output
    
    def check_variable_exists(var_name):
        return var_name in locals()
    
    # Выполняем тесты
    test_results = []
    {tests}
    
    print("=== РЕЗУЛЬТАТЫ ===")
    print(f"Вывод программы:")
    print(output)
    
except Exception as e:
    print(f"Ошибка: {{e}}")
finally:
    sys.stdout = old_stdout
"""
    
    def indent_code(self, code):
        """Добавляет отступы к коду"""
        lines = code.split('\n')
        indented = ['    ' + line for line in lines]
        return '\n'.join(indented)
