FROM node:18-alpine

WORKDIR /app

# Устанавливаем системные утилиты
RUN apk add --no-cache curl bash

# Копируем только package.json для лучшего кеширования
COPY package*.json ./

# Настраиваем npm для работы за прокси и с ограниченным интернетом
RUN npm config set registry https://registry.npmjs.org/ && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set progress false && \
    npm config set loglevel warn

# Создаем package-lock.json если его нет
RUN if [ ! -f package-lock.json ]; then \
        echo "Создаем package-lock.json..."; \
        npm install --package-lock-only --no-audit --no-save; \
    fi

# Устанавливаем зависимости
RUN npm ci --only=production --no-audit --prefer-offline --no-optional

# Копируем исходный код (исключая node_modules)
COPY . .

# Убедимся, что public директория существует
RUN mkdir -p public

# Создаем директорию для базы данных SQLite
RUN mkdir -p /tmp && chmod 777 /tmp

# Открываем порт
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Запуск приложения
CMD ["node", "server.js"]
