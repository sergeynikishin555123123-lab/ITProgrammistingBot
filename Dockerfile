FROM node:18-alpine

WORKDIR /app

# Установка зависимостей
COPY package*.json ./
RUN npm ci --only=production

# Копирование исходного кода
COPY . .

# Создание директории для базы данных
RUN mkdir -p /tmp && chmod 777 /tmp

# Открытие порта
EXPOSE 3000

# Запуск приложения
CMD ["node", "server.js"]
