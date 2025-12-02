import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Статические файлы
  app.use(express.static(join(__dirname, '..', 'public')));
  app.use('/lessons', express.static(join(__dirname, '..', 'lessons')));
  
  // Включение CORS для локальной разработки
  app.enableCors();
  
  // Глобальный префикс API
  app.setGlobalPrefix('api');
  
  // Запуск сервера
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 CodeFarm запущен на http://localhost:${port}`);
}

bootstrap();
