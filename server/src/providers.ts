import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { applicationDefault, initializeApp, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { PrismaService } from './prisma.service';
import { AppConfig } from './config';
import { haversine, Point } from './domain';

@Injectable()
export class RoutingService {
  constructor(private readonly config:AppConfig) {}
  async route(pickup:Point, dropoff:Point, timeoutMs=12000) {
    if (this.config.routingProvider === 'approximation') {
      const distanceMeters = Math.max(100,Math.round(haversine(pickup,dropoff)*1.3));
      return {distanceMeters,durationSeconds:Math.ceil(distanceMeters/7),geometry:[{latitude:pickup.latitude,longitude:pickup.longitude},{latitude:dropoff.latitude,longitude:dropoff.longitude}],provider:'server-approximation'};
    }
    try {
      const url = new URL('https://api.routing.yandex.net/v2/route');
      url.searchParams.set('apikey',this.config.require('YANDEX_ROUTER_API_KEY'));
      url.searchParams.set('waypoints',`${pickup.latitude},${pickup.longitude}|${dropoff.latitude},${dropoff.longitude}`);
      url.searchParams.set('mode','driving');
      const response = await fetch(url,{signal:AbortSignal.timeout(timeoutMs)});
      if (!response.ok) throw new Error('Routing unavailable');
      const payload = await response.json() as {route?:{legs?:{status:string;steps:{length:number;duration:number;polyline:{points:number[][]}}[]}[]}};
      const legs = payload.route?.legs;
      if (!legs?.length || legs.some(leg=>leg.status !== 'OK')) throw new Error('No route');
      const steps = legs.flatMap(leg=>leg.steps);
      if (!steps.length || steps.some(s=>!Number.isFinite(s.length)||s.length<0||!Number.isFinite(s.duration)||s.duration<0||!s.polyline?.points?.length)) throw new Error('Invalid route response');
      const geometry = steps.flatMap(s=>s.polyline.points.map(pair=>({latitude:pair[0],longitude:pair[1]})));
      if (geometry.length<2||geometry.some(p=>!Number.isFinite(p.latitude)||Math.abs(p.latitude)>90||!Number.isFinite(p.longitude)||Math.abs(p.longitude)>180)) throw new Error('Invalid geometry');
      if (haversine(pickup,geometry[0])>1000 || haversine(dropoff,geometry[geometry.length-1])>1000) throw new Error('Route endpoints too far');
      return {distanceMeters:Math.round(steps.reduce((sum,s)=>sum+s.length,0)),durationSeconds:Math.ceil(steps.reduce((sum,s)=>sum+s.duration,0)),geometry,provider:'yandex'};
    } catch {throw new ServiceUnavailableException('Не удалось построить маршрут. Уточните точки и попробуйте снова.');}
  }
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  constructor(private readonly db:PrismaService,private readonly config:AppConfig) {
    if (config.pushProvider === 'firebase' && !getApps().length) initializeApp({credential:applicationDefault()});
  }
  async deliverPending() {
    const jobs = await this.db.pushJob.findMany({where:{sentAt:null,attempts:{lt:8},availableAt:{lte:new Date()}},orderBy:{createdAt:'asc'},take:50});
    for (const job of jobs) {
      const claimed = await this.db.pushJob.updateMany({where:{id:job.id,sentAt:null,availableAt:{lte:new Date()}},data:{availableAt:new Date(Date.now()+60000),attempts:{increment:1}}});
      if (!claimed.count) continue;
      try {
        const user = await this.db.user.findUnique({where:{id:job.userId},include:{pushTokens:true}});
        if (user?.notifications && user.pushTokens.length && this.config.pushProvider !== 'development') {
          const title = job.event === 'order:offer' ? 'Новый заказ' : 'Ваша поездка';
          const body = job.event === 'order:offer' ? 'Откройте приложение, чтобы принять заказ' : job.event === 'rider:coming' ? 'Клиент выходит' : job.event === 'chat:message' ? 'Новое сообщение в чате' : 'Статус поездки изменился';
          if (this.config.pushProvider === 'expo') {
            const response = await fetch('https://exp.host/--/api/v2/push/send',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.config.require('EXPO_ACCESS_TOKEN')}`},body:JSON.stringify(user.pushTokens.map(t=>({to:t.token,title,body,sound:'default',data:{event:job.event,orderId:job.orderId}}))),signal:AbortSignal.timeout(10000)});
            if (!response.ok) throw new Error('Push provider unavailable');
            const result = await response.json() as {data?:{status:string;details?:{error:string}}[]};
            if (!Array.isArray(result.data) || result.data.length !== user.pushTokens.length) throw new Error('Invalid Expo ticket response');
            let temporaryFailure = false;
            for (let i=0;i<result.data.length;i++) {
              if (result.data[i].status !== 'error') continue;
              if (result.data[i].details?.error === 'DeviceNotRegistered') await this.db.pushToken.deleteMany({where:{id:user.pushTokens[i].id}});
              else temporaryFailure = true;
            }
            if (temporaryFailure) throw new Error('Expo rejected push');
          } else {
            const result = await getMessaging().sendEachForMulticast({tokens:user.pushTokens.map(t=>t.token),notification:{title,body},data:{event:job.event,orderId:job.orderId},android:{priority:'high'},apns:{payload:{aps:{sound:'default'}}}});
            let temporaryFailure = false;
            for (let i=0;i<result.responses.length;i++) {
              const error = result.responses[i].error;
              if (error?.code === 'messaging/registration-token-not-registered'||error?.code==='messaging/invalid-registration-token') await this.db.pushToken.deleteMany({where:{id:user.pushTokens[i].id}});
              else if(error) temporaryFailure = true;
            }
            if (temporaryFailure) throw new Error('Firebase rejected push');
          }
        }
        await this.db.pushJob.update({where:{id:job.id},data:{sentAt:new Date()}});
      } catch {
        this.logger.warn(`Push job ${job.id} delivery failed; queued for retry`);
        await this.db.pushJob.update({where:{id:job.id},data:{availableAt:new Date(Date.now()+Math.min(3600,2**job.attempts*15)*1000)}});
      }
    }
  }
}
