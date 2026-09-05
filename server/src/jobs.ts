import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { OrdersService } from './orders';
import { PushService } from './providers';
import { PrismaService } from './prisma.service';

@Injectable()
export class BackgroundJobs {
  private dispatchRunning=false;
  private pushRunning=false;
  private readonly logger=new Logger(BackgroundJobs.name);
  constructor(private readonly orders:OrdersService,private readonly push:PushService,private readonly db:PrismaService) {}
  @Interval(3000)
  async dispatch() {
    if(this.dispatchRunning)return;this.dispatchRunning=true;
    try{await this.orders.dispatchPending();}catch{this.logger.error('Dispatch failed; will retry');}finally{this.dispatchRunning=false;}
  }
  @Interval(5000)
  async notifications() {
    if(this.pushRunning)return;this.pushRunning=true;
    try{await this.push.deliverPending();}catch{this.logger.error('Push worker failed; will retry');}finally{this.pushRunning=false;}
  }
  @Interval(3600000)
  async cleanup() {
    try {
      await this.db.rateLimit.deleteMany({where:{expiresAt:{lt:new Date(Date.now()-86400000)}}});
      await this.db.smsChallenge.deleteMany({where:{expiresAt:{lt:new Date(Date.now()-86400000)}}});
      await this.db.refreshSession.deleteMany({where:{expiresAt:{lt:new Date(Date.now()-90*86400000)}}});
      await this.db.pushJob.deleteMany({where:{sentAt:{lt:new Date(Date.now()-30*86400000)}}});
    } catch{this.logger.error('Retention cleanup failed');}
  }
}
