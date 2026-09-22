import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, Request, urlencoded } from 'express';
import { static as serveStatic } from 'express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { AppConfig } from './config';
import { ApiExceptionFilter, apiValidation, stripLegacyFreshQuery } from './http';

async function bootstrap() {
  const app=await NestFactory.create(AppModule,{bodyParser:false});
  app.use(json({limit:'2mb'}));
  app.use(urlencoded({extended:false,limit:'64kb'}));
  // Android builds released before 1.0.6 retried a 304 response with
  // `?_fresh=...`. Remove that one legacy cache key before Nest parses query
  // DTOs; unknown parameters are still rejected by the global validation pipe.
  app.use((request:Request,_response:unknown,next:()=>void)=>{if(request.method==='GET')request.url=stripLegacyFreshQuery(request.url);next();});
  const config=app.get(AppConfig);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use('/admin',serveStatic(join(process.cwd(),'admin'),{index:'index.html',fallthrough:false}));
  app.getHttpAdapter().get('/',(_request:unknown,response:{redirect:(path:string)=>void})=>response.redirect('/admin/'));
  app.enableCors({origin:config.origins,credentials:false});
  app.useGlobalPipes(apiValidation());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  const spec=new DocumentBuilder().setTitle('Такси — REST API').setDescription('Все суммы — целые сомы (KGS). JWT в Authorization: Bearer. Права вычисляются сервером. Socket.IO подключается к корню сервера с auth.token.').setVersion('1.0.0').addBearerAuth().build();
  SwaggerModule.setup('api/docs',app,SwaggerModule.createDocument(app,spec));
  await app.listen(config.port,'0.0.0.0');
}
void bootstrap();
