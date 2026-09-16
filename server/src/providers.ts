import { Injectable, Logger } from '@nestjs/common';
import { applicationDefault, initializeApp, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { PrismaService } from './prisma.service';
import { AppConfig } from './config';
export { RoutingService } from './routing';
import { pushPresentation } from './pushPresentation';

const PUSH_TTL = {
  chat: 6 * 60 * 60,
  state: 30 * 60,
  durable: 24 * 60 * 60,
} as const;

export function pushTtlSeconds(event: string, offerExpiresAt?: Date, now = Date.now()) {
  if (event === 'order:offer') {
    if (!offerExpiresAt) return 1;
    return Math.max(1, Math.floor((offerExpiresAt.getTime() - now) / 1000));
  }
  if (event === 'chat:message') return PUSH_TTL.chat;
  if (['order:created','trip:completed'].includes(event)) return PUSH_TTL.durable;
  return PUSH_TTL.state;
}

class PushDeliveryError extends Error {
  constructor(readonly reason: string) { super(reason); this.name = 'PushDeliveryError'; }
}

function safeProviderCode(value: unknown, fallback: string) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._\/-]{0,100}$/i.test(value) ? value : fallback;
}

export function safePushFailureReason(error: unknown) {
  if (error instanceof PushDeliveryError) return error.reason;
  if (error && typeof error === 'object') {
    const name = typeof Reflect.get(error, 'name') === 'string' ? Reflect.get(error, 'name') as string : 'Error';
    const code = Reflect.get(error, 'code');
    if (typeof code === 'string' && /^[a-z0-9][a-z0-9._\/-]{0,100}$/i.test(code)) return `${name}:${code}`;
    return name;
  }
  return 'UnknownError';
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
        const user = await this.db.user.findUnique({where:{id:job.userId},select:{
          notifications:true,
          role:true,
          pushTokens:{select:{id:true,token:true}},
        }});
        if (user?.notifications && user.pushTokens.length && this.config.pushProvider !== 'development') {
          const { title, body, sound, channelId } = pushPresentation(job.event, user.role);
          let ttl = pushTtlSeconds(job.event);
          if (job.event === 'order:offer') {
            const offer = await this.db.orderOffer.findFirst({where:{orderId:job.orderId,driverId:job.userId,skipped:false,expiresAt:{gt:new Date()},driver:{online:true,verified:true},order:{status:'SEARCHING'}},include:{order:true}});
            if (!offer) { await this.db.pushJob.update({where:{id:job.id},data:{sentAt:new Date()}}); continue; }
            ttl = pushTtlSeconds(job.event, offer.expiresAt);
          }
          if (this.config.pushProvider === 'expo') {
            const headers: Record<string,string> = {'Content-Type':'application/json'};
            if (this.config.expoAccessToken) headers.Authorization = `Bearer ${this.config.expoAccessToken}`;
            const response = await fetch('https://exp.host/--/api/v2/push/send',{method:'POST',headers,body:JSON.stringify(user.pushTokens.map(t=>({to:t.token,title,body,sound,channelId,ttl,priority:'high',data:{event:job.event,orderId:job.orderId,eventId:job.id}}))),signal:AbortSignal.timeout(10000)});
            if (!response.ok) throw new PushDeliveryError(`expo-http-${response.status}`);
            const result = await response.json() as {data?:{status:string;details?:{error:string}}[]};
            if (!Array.isArray(result.data) || result.data.length !== user.pushTokens.length) throw new PushDeliveryError('expo-invalid-ticket-response');
            const temporaryFailures = new Set<string>();
            for (let i=0;i<result.data.length;i++) {
              if (result.data[i].status !== 'error') continue;
              if (result.data[i].details?.error === 'DeviceNotRegistered') await this.db.pushToken.deleteMany({where:{id:user.pushTokens[i].id}});
              else temporaryFailures.add(safeProviderCode(result.data[i].details?.error, 'unknown-ticket-error'));
            }
            if (temporaryFailures.size) throw new PushDeliveryError(`expo-ticket-${[...temporaryFailures].sort().join(',')}`);
          } else {
            const result = await getMessaging().sendEachForMulticast({tokens:user.pushTokens.map(t=>t.token),notification:{title,body},data:{event:job.event,orderId:job.orderId,eventId:job.id},android:{priority:'high',ttl:ttl*1000,notification:{channelId,sound:sound.replace(/\.wav$/,'')}},apns:{headers:{'apns-expiration':String(Math.floor(Date.now()/1000)+ttl)},payload:{aps:{sound}}}});
            const temporaryFailures = new Set<string>();
            for (let i=0;i<result.responses.length;i++) {
              const error = result.responses[i].error;
              if (error?.code === 'messaging/registration-token-not-registered'||error?.code==='messaging/invalid-registration-token') await this.db.pushToken.deleteMany({where:{id:user.pushTokens[i].id}});
              else if(error) temporaryFailures.add(safeProviderCode(error.code, 'unknown-message-error'));
            }
            if (temporaryFailures.size) throw new PushDeliveryError(`firebase-message-${[...temporaryFailures].sort().join(',')}`);
          }
        }
        await this.db.pushJob.update({where:{id:job.id},data:{sentAt:new Date()}});
      } catch (error) {
        this.logger.warn(`Push job ${job.id} event=${job.event} provider=${this.config.pushProvider} attempt=${job.attempts+1} failed reason=${safePushFailureReason(error)}; queued for retry`);
        await this.db.pushJob.update({where:{id:job.id},data:{availableAt:new Date(Date.now()+Math.min(3600,2**job.attempts*15)*1000)}});
      }
    }
  }
}
