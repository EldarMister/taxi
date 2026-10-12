import { BadRequestException, CallHandler, ExecutionContext, ForbiddenException, HttpException, Injectable, NestInterceptor, NotFoundException, PayloadTooLargeException, UnauthorizedException } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import { Actor, RateLimits } from './auth';
import { ASSIGNED_STATUSES } from './domain';
import { PrismaService } from './prisma.service';
import { RestaurantActor } from './restaurant-auth';
import { RestaurantService } from './restaurant';
import { isRestaurantDelivery } from './restaurant-delivery-state';
import { requestClientIp } from './request-client-ip';

type UploadRequest = {
  actor?:Actor; restaurantActor?:RestaurantActor; params:Record<string,string>;
  headers:Record<string,string|string[]|undefined>;socket?:{remoteAddress?:string};
};
export const MEDIA_UPLOAD_GLOBAL_CONCURRENCY=4;
export const MEDIA_UPLOAD_IP_CONCURRENCY=2;
const MULTIPART_OVERHEAD=64*1024;

/** One process-wide bound covers buffering AND decoding of all media routes.
 * Rate counters are durable; this memory limit is per API process. */
export class MediaUploadSlots {
  private readonly users=new Set<string>();
  private readonly byIp=new Map<string,number>();
  private active=0;
  acquire(user:string,ip:string) {
    const count=this.byIp.get(ip)??0;
    if(this.users.has(user)||this.active>=MEDIA_UPLOAD_GLOBAL_CONCURRENCY||count>=MEDIA_UPLOAD_IP_CONCURRENCY)
      throw new HttpException({statusCode:429,message:'Дождитесь завершения загрузки и попробуйте снова.',retryAfterSeconds:2},429);
    this.users.add(user);this.byIp.set(ip,count+1);this.active++;
    let released=false;
    return ()=>{
      if(released)return;released=true;
      this.users.delete(user);this.active--;
      const remaining=(this.byIp.get(ip)??1)-1;
      if(remaining>0)this.byIp.set(ip,remaining);else this.byIp.delete(ip);
    };
  }
}
const slots=new MediaUploadSlots();

abstract class UploadGate implements NestInterceptor {
  constructor(protected readonly limits:RateLimits){}
  protected abstract policy(request:UploadRequest):{user:string;key:string;max:number;bytes:number};
  protected abstract authorize(request:UploadRequest):Promise<void>;
  async intercept(context:ExecutionContext,next:CallHandler):Promise<Observable<unknown>> {
    const request=context.switchToHttp().getRequest<UploadRequest>();
    const policy=this.policy(request);
    const rawLength=request.headers['content-length'];
    if(rawLength!==undefined) {
      if(typeof rawLength!=='string'||!/^\d+$/.test(rawLength)||!Number.isSafeInteger(Number(rawLength)))throw new BadRequestException('Некорректный Content-Length');
      if(Number(rawLength)>policy.bytes+MULTIPART_OVERHEAD)throw new PayloadTooLargeException('Файл слишком большой');
    }
    // A valid token is insufficient: check resource membership before Multer
    // sees file bytes, then repeat business authorization during the write.
    await this.authorize(request);
    const ip=requestClientIp(request),release=slots.acquire(policy.user,ip);
    try {
      await this.limits.takeAll([
        {key:policy.key,max:policy.max,seconds:3600},
        {key:`media-upload:ip:${ip}`,max:300,seconds:3600},
      ]);
      return next.handle().pipe(finalize(release));
    }catch(error){release();throw error;}
  }
}

@Injectable()
export class AvatarUploadGate extends UploadGate {
  constructor(limits:RateLimits){super(limits);}
  protected policy(request:UploadRequest) {
    if(!request.actor)throw new UnauthorizedException();
    return {user:`mobile:${request.actor.id}`,key:`avatar:${request.actor.id}`,max:10,bytes:5*1024*1024};
  }
  protected async authorize(request:UploadRequest) {
    if(request.actor?.role!=='DRIVER')throw new ForbiddenException('Только водитель может установить фотографию профиля.');
  }
}

@Injectable()
export class ChatPhotoUploadGate extends UploadGate {
  constructor(limits:RateLimits,private readonly db:PrismaService){super(limits);}
  protected policy(request:UploadRequest) {
    if(!request.actor)throw new UnauthorizedException();
    return {user:`mobile:${request.actor.id}`,key:`chat-photo:${request.actor.id}`,max:120,bytes:8*1024*1024};
  }
  protected async authorize(request:UploadRequest) {
    const id=request.params.id;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id??''))throw new BadRequestException('Некорректный заказ');
    const order=await this.db.order.findUnique({where:{id},select:{clientId:true,driverId:true,status:true,foodOrderId:true,idempotencyKey:true}});
    if(!order)throw new NotFoundException('Заказ не найден');
    if(order.driverId!==request.actor!.id&&(order.clientId!==request.actor!.id||isRestaurantDelivery(order)))throw new ForbiddenException('Нет доступа к чату');
    if(!ASSIGNED_STATUSES.includes(order.status))throw new BadRequestException('Чат доступен во время активной поездки');
  }
}

@Injectable()
export class RestaurantMediaUploadGate extends UploadGate {
  constructor(limits:RateLimits,private readonly restaurants:RestaurantService){super(limits);}
  protected policy(request:UploadRequest) {
    if(!request.restaurantActor)throw new UnauthorizedException();
    return {user:`restaurant:${request.restaurantActor.id}`,key:`restaurant-media-admission:${request.restaurantActor.id}`,max:60,bytes:8*1024*1024};
  }
  protected async authorize(request:UploadRequest) {await this.restaurants.mediaAccess(request.restaurantActor!,request.params.id);}
}
