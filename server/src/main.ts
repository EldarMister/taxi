import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config';
import { ApiExceptionFilter, apiValidation } from './http';

async function bootstrap() {
  const app=await NestFactory.create(AppModule,{bodyParser:true});
  const config=app.get(AppConfig);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({origin:config.origins,credentials:false});
  app.useGlobalPipes(apiValidation());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  const spec=new DocumentBuilder().setTitle('Такси — REST API').setDescription('Все суммы — целые сомы (KGS). JWT в Authorization: Bearer. Права вычисляются сервером. Socket.IO подключается к корню сервера с auth.token.').setVersion('1.0.0').addBearerAuth().build();
  SwaggerModule.setup('api/docs',app,SwaggerModule.createDocument(app,spec));
  await app.listen(config.port,'0.0.0.0');
}
void bootstrap();
