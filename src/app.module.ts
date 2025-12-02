import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { BotModule } from './bot/bot.module';
import { LessonsModule } from './lessons/lessons.module';
import { DatabaseModule } from './database/database.module';
import { WebModule } from './web/web.module';

@Module({
  imports: [
    // Загрузка .env файла
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    
    // Статические файлы
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/',
    }),
    
    // Модули приложения
    BotModule,
    LessonsModule,
    DatabaseModule,
    WebModule,
  ],
})
export class AppModule {}
