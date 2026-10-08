import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { OtpDeliveryAttempt } from '@prisma/client';
import { AppConfig } from './config';
import { PrismaService } from './prisma.service';
import { OtpDelivery } from './otp-delivery';

// Durable fallback jobs need the same OTP. Store only authenticated ciphertext,
// using a domain-separated key; normal challenge verification still uses HMAC.
export function sealOtp(code:string, secret:string, identity:string):string {
  const key=createHmac('sha256',secret).update('atlas-otp-fallback-encryption-v1').digest();
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(identity));
  const encrypted=Buffer.concat([cipher.update(code,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
}
export function unsealOtp(value:string,secret:string,identity:string):string {
  const bytes=Buffer.from(value,'base64');
  const key=createHmac('sha256',secret).update('atlas-otp-fallback-encryption-v1').digest();
  const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));decipher.setAAD(Buffer.from(identity));
  return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');
}
const identity=(job:{id:string;phone:string;codeHash:string})=>`${job.id}:${job.phone}:${job.codeHash}`;

@Injectable()
export class OtpFallback {
  private running=false;
  private readonly logger=new Logger(OtpFallback.name);
  constructor(private readonly db:PrismaService,private readonly config:AppConfig,private readonly delivery:OtpDelivery) {}

  async start(phone:string,code:string,codeHash:string) {
    const id=randomUUID(),expiresAt=new Date(Date.now()+300000);
    const codeCiphertext=sealOtp(code,this.config.otpSecret,identity({id,phone,codeHash}));
    const job=await this.db.otpDeliveryAttempt.create({data:{id,phone,codeHash,codeCiphertext,expiresAt}});
    let messageId:string;
    try { messageId=await this.delivery.sendWhatsapp(phone,code); }
    catch {
      this.logger.warn('WhatsApp OTP submission failed; attempting Telegram Gateway');
      return this.toTelegram(job,false);
    }
    await this.db.otpDeliveryAttempt.update({where:{id},data:{state:'whatsapp_pending',whatsappMessageId:messageId}});
    return {channel:'whatsapp' as const,deliveryId:id};
  }

  async status(id:string) {
    const job=await this.db.otpDeliveryAttempt.findUnique({where:{id}});
    if (!job) throw new NotFoundException('Запрос кода не найден.');
    return {channel:job.channel,state:job.expiresAt.getTime()<=Date.now()?'expired':job.state};
  }

  private async toTelegram(job:OtpDeliveryAttempt,checkChallenge=true) {
    const now=new Date();
    if (checkChallenge) {
      const challenge=await this.db.smsChallenge.findUnique({where:{phone:job.phone}});
      if (!challenge || challenge.codeHash!==job.codeHash || challenge.consumedAt || challenge.expiresAt<=now) {
        await this.finish(job.id,'stopped');return {channel:job.channel,deliveryId:job.id};
      }
    }
    // Claim before sending: across workers/restarts there is at most one paid
    // Telegram request. Ambiguous network failures are never retried blindly.
    const claimed=await this.db.otpDeliveryAttempt.updateMany({where:{id:job.id,state:{in:['sending_whatsapp','whatsapp_pending']},expiresAt:{gt:now}},data:{state:'telegram_sending',channel:'telegram',nextCheckAt:new Date(Date.now()+15000)}});
    if (!claimed.count) throw new ServiceUnavailableException('Запрос кода уже обрабатывается.');
    try {
      const code=unsealOtp(job.codeCiphertext,this.config.otpSecret,identity(job));
      const ttl=Math.floor((job.expiresAt.getTime()-Date.now())/1000);
      const requestId=await this.delivery.sendTelegram(job.phone,code,ttl);
      await this.db.otpDeliveryAttempt.update({where:{id:job.id},data:{state:'telegram_accepted',telegramRequestId:requestId,codeCiphertext:''}});
      return {channel:'telegram' as const,deliveryId:job.id};
    } catch {
      await this.finish(job.id,'failed');
      this.logger.warn('Telegram Gateway OTP submission failed');
      throw new ServiceUnavailableException('Не удалось отправить код в WhatsApp и Telegram. Попробуйте позже.');
    }
  }

  private finish(id:string,state:string) {
    return this.db.otpDeliveryAttempt.update({where:{id},data:{state,codeCiphertext:''}});
  }

  @Interval(3000)
  async processPending() {
    if (this.running) return;
    this.running=true;
    try {
      const now=new Date();
      await this.db.otpDeliveryAttempt.updateMany({where:{codeCiphertext:{not:''},expiresAt:{lte:now}},data:{state:'expired',codeCiphertext:''}});
      await this.db.otpDeliveryAttempt.updateMany({where:{state:{in:['sending_whatsapp','telegram_sending']},nextCheckAt:{lt:new Date(Date.now()-30000)}},data:{state:'failed',codeCiphertext:''}});
      await this.db.otpDeliveryAttempt.deleteMany({where:{expiresAt:{lt:new Date(Date.now()-86400000)}}});
      if (!this.config.telegramGatewayToken || this.config.smsProvider!=='messaggio') return;
      const jobs=await this.db.otpDeliveryAttempt.findMany({where:{state:'whatsapp_pending',expiresAt:{gt:now},nextCheckAt:{lte:now}},take:8,orderBy:{nextCheckAt:'asc'}});
      await Promise.all(jobs.map(job=>this.check(job).catch(()=>this.logger.warn('OTP delivery check deferred'))));
    } catch {this.logger.warn('OTP delivery worker deferred');}
    finally {this.running=false;}
  }

  private async check(job:OtpDeliveryAttempt) {
    const claimed=await this.db.otpDeliveryAttempt.updateMany({where:{id:job.id,state:'whatsapp_pending',nextCheckAt:job.nextCheckAt},data:{nextCheckAt:new Date(Date.now()+15000)}});
    if (!claimed.count) return;
    const challenge=await this.db.smsChallenge.findUnique({where:{phone:job.phone}});
    if (!challenge || challenge.codeHash!==job.codeHash || challenge.consumedAt || challenge.expiresAt.getTime()<=Date.now()) {await this.finish(job.id,'stopped');return;}
    let result:'pending'|'failed'|'delivered'='pending';
    try {result=await this.delivery.whatsappStatus(job.whatsappMessageId!,job.phone);} catch { /* Wait for the delivery deadline on status API outages. */ }
    if (result==='delivered') {await this.finish(job.id,'whatsapp_delivered');return;}
    if (result==='failed' || Date.now()-job.createdAt.getTime()>=60000) await this.toTelegram(job);
  }
}
