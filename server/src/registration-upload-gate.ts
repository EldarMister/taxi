import { BadRequestException, CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, NestInterceptor, PayloadTooLargeException } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import { RateLimits } from './auth';
import { REGISTRATION_CONFIG } from './registration-domain';

const MULTIPART_OVERHEAD_BYTES=512*1024;
export const REGISTRATION_UPLOADS_PER_USER_HOUR=REGISTRATION_CONFIG.upload.maxFiles*2;
export const REGISTRATION_UPLOADS_PER_IP_HOUR=REGISTRATION_CONFIG.upload.maxFiles*20;
export const REGISTRATION_UPLOAD_GLOBAL_CONCURRENCY=4;
export const REGISTRATION_UPLOAD_IP_CONCURRENCY=2;

@Injectable()
export class RegistrationUploadGate implements NestInterceptor {
  private readonly activeUsers=new Set<string>();
  private readonly activeByIp=new Map<string,number>();
  private activeCount=0;
  constructor(private readonly limits:RateLimits) {}

  async intercept(context:ExecutionContext,next:CallHandler):Promise<Observable<unknown>> {
    const request=context.switchToHttp().getRequest<{actor?:{id?:string};ip?:string;headers?:Record<string,string|string[]|undefined>}>();
    const rawLength=request.headers?.['content-length'],lengthText=Array.isArray(rawLength)?rawLength[0]:rawLength;
    if(lengthText!==undefined) {
      const length=Number(lengthText);
      if(!Number.isSafeInteger(length)||length<0)throw new BadRequestException('Некорректный Content-Length');
      if(length>REGISTRATION_CONFIG.upload.maxBytes+MULTIPART_OVERHEAD_BYTES)throw new PayloadTooLargeException('Файл должен быть не больше 12 МБ');
    }
    const userId=request.actor?.id;
    if(!userId)throw new HttpException('Необходима авторизация',HttpStatus.UNAUTHORIZED);
    const ip=request.ip??'unknown',ipCount=this.activeByIp.get(ip)??0;
    if(this.activeUsers.has(userId))throw new HttpException('Дождитесь завершения предыдущей загрузки',HttpStatus.TOO_MANY_REQUESTS);
    if(this.activeCount>=REGISTRATION_UPLOAD_GLOBAL_CONCURRENCY||ipCount>=REGISTRATION_UPLOAD_IP_CONCURRENCY)throw new HttpException('Сервер обрабатывает другие загрузки. Попробуйте ещё раз через несколько секунд',HttpStatus.TOO_MANY_REQUESTS);
    this.activeUsers.add(userId);
    this.activeCount++;
    this.activeByIp.set(ip,ipCount+1);
    let released=false;
    const release=()=>{
      if(released)return;
      released=true;
      this.activeUsers.delete(userId);
      this.activeCount--;
      const remaining=(this.activeByIp.get(ip)??1)-1;
      if(remaining>0)this.activeByIp.set(ip,remaining);else this.activeByIp.delete(ip);
    };
    try {
      // These durable counters execute before FileInterceptor buffers or sharp
      // decodes the body, limiting both repeated replacements and multi-account
      // abuse from one source address.
      await this.limits.take(`registration-upload:user:${userId}`,REGISTRATION_UPLOADS_PER_USER_HOUR,3600);
      await this.limits.take(`registration-upload:ip:${ip}`,REGISTRATION_UPLOADS_PER_IP_HOUR,3600);
      return next.handle().pipe(finalize(release));
    }
    catch(error) {release();throw error;}
  }
}
