import {Injectable,Logger} from '@nestjs/common';
import {Interval} from '@nestjs/schedule';
import {PrismaService} from './prisma.service';
import {OrdersService} from './orders';
import {FoodService} from './food';
import {RealtimeEvents} from './events';
@Injectable()
export class OrderOutboxWorker {
  private running=false;
  private readonly logger=new Logger(OrderOutboxWorker.name);
  constructor(private readonly db:PrismaService,private readonly orders:OrdersService,private readonly food:FoodService,private readonly events:RealtimeEvents){}
  @Interval(1000)
  async tick(){
    if(this.running)return;
    this.running=true;
    try{
      // A busy queue may use the idle portion of this turn. Keep each claim
      // small and serial; never interrupt an in-flight batch or its lease.
      const started=performance.now();
      let claimed=0;
      while(claimed<100){
        const limit=Math.min(25,100-claimed);
        const batch=await this.flush(limit);
        claimed+=batch.claimed;
        // A failed delivery backs off before claiming more recipients. The
        // elapsed-time budget is checked only after the batch has finished.
        if(batch.claimed<limit||batch.delivered<batch.claimed||performance.now()-started>=500)break;
      }
    }catch{this.logger.warn('Order synchronization deferred');}
    finally{this.running=false;}
  }
  async flush(limit=25){
    const rows=await this.db.$transaction(async tx=>{
      const selected=await tx.$queryRaw<Array<{id:string}>>`SELECT "id" FROM "OrderEventOutbox" WHERE "deliveredAt" IS NULL AND "availableAt" <= (NOW() AT TIME ZONE 'UTC') ORDER BY "createdAt", "id" LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      if(!selected.length)return [];
      await tx.orderEventOutbox.updateMany({where:{id:{in:selected.map(row=>row.id)}},data:{attempts:{increment:1},availableAt:new Date(Date.now()+30000)}});
      return tx.orderEventOutbox.findMany({where:{id:{in:selected.map(row=>row.id)}},orderBy:[{createdAt:'asc'},{id:'asc'}]});
    });
    let delivered=0;
    for(const row of rows){
      try{
        if(row.aggregateType==='TAXI'){
          if(await this.db.order.findUnique({where:{id:row.aggregateId},select:{id:true}}))await this.orders.publish(row.aggregateId,row.previousDriverId?[row.previousDriverId]:[],true);
        }else{
          const order=await this.db.foodOrder.findUnique({where:{id:row.aggregateId}});
          if(order){await this.events.dispatch({userIds:[order.clientId],name:'food:order:updated',payload:this.food.serialize(order)});await this.events.dispatch({userIds:[],audience:'admin',name:'admin:changed',payload:{resource:'food-orders',id:order.id}});}
        }
        // The monotonic attempt number identifies this claim. A slow older
        // owner cannot acknowledge or reschedule a lease reclaimed meanwhile.
        const acknowledged=await this.db.orderEventOutbox.updateMany({where:{id:row.id,attempts:row.attempts,deliveredAt:null},data:{deliveredAt:new Date()}});
        if(acknowledged.count===1)delivered++;
      }catch{
        await this.db.orderEventOutbox.updateMany({where:{id:row.id,attempts:row.attempts,deliveredAt:null},data:{availableAt:new Date(Date.now()+Math.min(300000,1000*2**Math.min(row.attempts,8)))}}).catch(()=>undefined);
      }
    }
    return {claimed:rows.length,delivered};
  }
}
