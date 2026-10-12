import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { json, Request, Response } from 'express';
import { AppConfig } from './config';
import { PrismaService } from './prisma.service';

export function whatsappWebhookBodyParser() {
  return json({limit:'2mb',verify:(request,_response,buffer)=>{
    if ((request as Request).url.split('?')[0]==='/api/auth/whatsapp/webhook')
      (request as Request&{rawBody?:Buffer}).rawBody=Buffer.from(buffer);
  }});
}

export function cloudOtpPayload(config: AppConfig, phone: string, code: string) {
  if (!/^\+996\d{9}$/.test(phone) || !/^[0-9]{6}$/.test(code)) throw new Error('invalid-cloud-input');
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: phone.slice(1), type: 'template',
    template: {name:config.whatsappCloudTemplate,language:{code:config.whatsappCloudLanguage},components:[
      {type:'body',parameters:[{type:'text',text:code}]},
      {type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:code}]},
    ]},
  };
}

export function acceptedCloudMessage(value:any,phone:string):string|null {
  const contacts=value?.contacts,messages=value?.messages;
  if (value?.error || value?.messaging_product!=='whatsapp' || !Array.isArray(contacts) || contacts.length!==1
    || contacts[0]?.input!==phone.slice(1) || contacts[0]?.wa_id!==phone.slice(1)
    || !Array.isArray(messages) || messages.length!==1 || messages[0]?.error
    || !['accepted',undefined].includes(messages[0]?.message_status)
    || typeof messages[0]?.id!=='string' || !/^wamid\.[A-Za-z0-9+/=_-]+$/.test(messages[0].id)) return null;
  return messages[0].id;
}

export function validMetaSignature(raw:Buffer|undefined,header:unknown,secret:string):boolean {
  if (!raw || !secret || typeof header!=='string' || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  const actual=Buffer.from(header.slice(7),'hex');
  const expected=createHmac('sha256',secret).update(raw).digest();
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}

export function cloudDeliveryReports(body:any,config:AppConfig):Array<{id:string;phone:string;delivered:boolean}> {
  const reports:Array<{id:string;phone:string;delivered:boolean}>=[];
  if (body?.object!=='whatsapp_business_account' || !Array.isArray(body.entry)) return reports;
  for (const entry of body.entry) {
    if (entry?.id!==config.whatsappCloudWabaId || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      const value=change?.value;
      if (change?.field!=='messages' || value?.messaging_product!=='whatsapp'
        || value.metadata?.phone_number_id!==config.whatsappCloudPhoneId || !Array.isArray(value.statuses)) continue;
      for (const status of value.statuses) {
        if (!status || typeof status.id!=='string' || !/^wamid\.[A-Za-z0-9+/=_-]+$/.test(status.id)
          || typeof status.recipient_id!=='string' || !/^996\d{9}$/.test(status.recipient_id)
          || !['delivered','read','failed'].includes(status.status)) continue;
        reports.push({id:status.id,phone:`+${status.recipient_id}`,delivered:status.status!=='failed'});
      }
    }
  }
  return reports;
}

@Controller('auth/whatsapp/webhook')
export class WhatsAppCloudWebhook {
  constructor(@Inject(AppConfig) private readonly config:AppConfig,@Inject(PrismaService) private readonly db:PrismaService) {}

  @Get()
  verify(@Query('hub.mode') mode:string,@Query('hub.verify_token') token:string,@Query('hub.challenge') challenge:string,@Res() response:Response) {
    const expected=Buffer.from(this.config.whatsappCloudVerifyToken),actual=Buffer.from(typeof token==='string'?token:'');
    if (!expected.length || mode!=='subscribe' || actual.length!==expected.length || !timingSafeEqual(actual,expected)
      || typeof challenge!=='string' || !/^\d{1,64}$/.test(challenge)) throw new ForbiddenException('Webhook verification failed');
    response.type('text/plain').send(challenge);
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() request:Request&{rawBody?:Buffer},@Body() body:unknown) {
    if (!validMetaSignature(request.rawBody,request.headers['x-hub-signature-256'],this.config.whatsappCloudAppSecret))
      throw new ForbiddenException('Invalid webhook signature');
    if (this.config.smsProvider==='whatsapp_cloud') for (const report of cloudDeliveryReports(body,this.config)) {
      // Exact message + recipient, only pending unexpired attempts. Replayed or
      // late events cannot change an already verified/fallback delivery.
      await this.db.otpDeliveryAttempt.updateMany({where:{whatsappMessageId:report.id,phone:report.phone,
        state:{in:['whatsapp_pending','whatsapp_failed']},expiresAt:{gt:new Date()}},data:report.delivered
        ? {state:'whatsapp_delivered',codeCiphertext:''}
        : this.config.telegramGatewayToken ? {state:'whatsapp_failed',nextCheckAt:new Date()} : {state:'failed',codeCiphertext:''}});
    }
    return {received:true};
  }
}
