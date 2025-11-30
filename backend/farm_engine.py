class FarmEngine:
    """Движок 2.5D фермы"""
    
    def __init__(self):
        self.field_size = (10, 10)  # 10x10 клеток
        self.buildings = {
            "house": {"width": 2, "height": 2, "sprite": "🏠"},
            "barn": {"width": 3, "height": 2, "sprite": "🏚️"},
            "greenhouse": {"width": 4, "height": 3, "sprite": "🌿"}
        }
        self.crops = {
            "wheat": {"sprite": "🌾", "growth_time": 5},
            "carrot": {"sprite": "🥕", "growth_time": 3},
            "potato": {"sprite": "🥔", "growth_time": 4}
        }
    
    def create_new_farm(self, user_id):
        """Создает новую ферму для пользователя"""
        field = [["🟫" for _ in range(self.field_size[0])] for _ in range(self.field_size[1])]
        
        # Добавляем начальные элементы
        field[5][5] = "🏠"  # Дом в центре
        field[3][3] = "🌾"  # Пшеница
        field[3][7] = "🥕"  # Морковь
        
        return {
            "field": field,
            "buildings": [{"type": "house", "x": 5, "y": 5}],
            "crops": [
                {"type": "wheat", "x": 3, "y": 3, "growth": 100},
                {"type": "carrot", "x": 3, "y": 7, "growth": 100}
            ],
            "animals": []
        }
    
    def update_farm_after_lesson(self, user_id, lesson_id, farm_data):
        """Обновляет ферму после прохождения урока"""
        if lesson_id == 1:
            # Урок 1: Расчистка территории
            for i in range(3, 7):
                for j in range(3, 7):
                    farm_data["field"][i][j] = "🟫"
        
        elif lesson_id == 2:
            # Урок 2: Строительство дома
            farm_data["buildings"].append({"type": "house", "x": 5, "y": 5})
            farm_data["field"][5][5] = "🏠"
        
        elif lesson_id == 3:
            # Урок 3: Вспашка поля
            for i in range(1, 4):
                for j in range(1, 9):
                    farm_data["field"][i][j] = "🟫"
        
        return farm_data
    
    def render_farm_html(self, farm_data):
        """Рендерит ферму в HTML для отображения"""
        html = '<div class="farm-container">\n'
        html += '<div class="farm-field">\n'
        
        for row in farm_data["field"]:
            html += '<div class="farm-row">\n'
            for cell in row:
                html += f'<div class="farm-cell">{cell}</div>\n'
            html += '</div>\n'
        
        html += '</div>\n'
        html += '</div>'
        
        return html

farm_engine = FarmEngine()
