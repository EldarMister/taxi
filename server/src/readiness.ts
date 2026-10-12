import {Controller,Get,Injectable,ServiceUnavailableException} from '@nestjs/common';
import {PrismaService} from './prisma.service';
@Injectable()
export class ReadinessService {
  constructor(private readonly db:PrismaService){}
  async check(){
    try {await this.db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 1500');await tx.$queryRaw`SELECT 1`;},{maxWait:1000,timeout:2000});return {status:'ok'};}
    catch {throw new ServiceUnavailableException('Сервис временно недоступен');}
  }
}
@Controller()
export class ReadinessController {
  constructor(private readonly ready:ReadinessService){}
  @Get('live') live(){return {status:'ok'};}
  @Get('ready') readyCheck(){return this.ready.check();}
}
