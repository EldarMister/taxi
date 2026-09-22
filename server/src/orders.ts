import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Order, OrderStatus, Prisma } from '@prisma/client';
import { Actor, AuthService, RateLimits } from './auth';
import { AppConfig } from './config';
import { ACTIVE_STATUSES, ASSIGNED_STATUSES, assertDriverTransition, calculateFare, haversine, historySince, Point } from './domain';
import { CreateOrderDto, MessageDto, QuoteDto } from './dto';
import { RealtimeEvents } from './events';
import { PrismaService } from './prisma.service';
import { RoutingService } from './providers';
import { visibleDriverLocation } from './tracking';
import { nextDriver, OFFER_SECONDS, POSITION_MAX_AGE_MS } from './dispatch-ranking';
import { driverCanTake } from './driver-eligibility';

@Injectable()
export class OrdersService {
  constructor(private readonly db:PrismaService,private readonly config:AppConfig,private readonly routing:RoutingService,private readonly auth:AuthService,private readonly events:RealtimeEvents,private readonly limits:RateLimits) {}
  async quote(actor:Actor,dto:QuoteDto) {
    if(actor.role !== 'CLIENT') throw new ForbiddenException('Заказ доступен клиенту');
    await this.limits.take(`quote:${actor.id}`,20,60);
    const tariff = await this.db.tariff.findFirst({where:{id:dto.tariffId,active:true}});
    if(!tariff) throw new NotFoundException('Тариф не найден');
    if (haversine(dto.pickup,dto.dropoff)<30) throw new BadRequestException('Укажите разные точки маршрута');
    const route = await this.routing.route(dto.pickup,dto.dropoff);
    const fare = calculateFare(tariff,route.distanceMeters,route.durationSeconds);
    const quote = await this.db.quote.create({data:{userId:actor.id,tariffId:tariff.id,kind:tariff.kind,pickup:{...dto.pickup},dropoff:{...dto.dropoff},geometry:route.geometry,distanceMeters:route.distanceMeters,durationSeconds:route.durationSeconds,...fare,routeProvider:route.provider,expiresAt:new Date(Date.now()+300000)}});
    return {...quote,currency:'KGS',paymentMethod:'CASH',tariff,development:route.provider.startsWith('development')};
  }
  async create(actor:Actor,dto:CreateOrderDto) {
    if(actor.role !== 'CLIENT') throw new ForbiddenException('Заказ доступен клиенту');
    await this.limits.take(`orders:${actor.id}`,15,60);
    const passenger=dto.passenger?{name:dto.passenger.name.trim(),phone:dto.passenger.phone.replace(/[\s()-]/g,'')}:null;
    if(passenger&&passenger.name.length<2)throw new BadRequestException('Укажите имя пассажира');
    const order = await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.id}::uuid FOR UPDATE`;
      const currentUser=await tx.user.findUnique({where:{id:actor.id},select:{role:true}});
      if(currentUser?.role!=='CLIENT')throw new ForbiddenException('Заказ доступен клиенту');
      const existing = await tx.order.findUnique({where:{clientId_idempotencyKey:{clientId:actor.id,idempotencyKey:dto.idempotencyKey}}});
      if(existing) {
        if(existing.quoteId !== dto.quoteId || existing.comment !== (dto.comment?.trim()??'') || existing.passengerName !== (passenger?.name??null) || existing.passengerPhone !== (passenger?.phone??null) || this.stable(existing.deliveryDetails)!==this.stable(this.deliveryDetails(existing.kind,dto,false))) throw new ConflictException('Ключ повтора уже использован с другими данными');
        return existing;
      }
      if(await tx.order.findFirst({where:{clientId:actor.id,status:{in:ACTIVE_STATUSES}}})) throw new ConflictException('У вас уже есть активный заказ');
      const quote = await tx.quote.findFirst({where:{id:dto.quoteId,userId:actor.id,expiresAt:{gt:new Date()}},include:{order:true}});
      if(!quote) throw new BadRequestException('Расчёт стоимости истёк. Постройте маршрут ещё раз.');
      if(quote.order) throw new ConflictException('Этот расчёт уже использован');
      const details=this.deliveryDetails(quote.kind,dto);
      if(quote.kind!=='RIDE'&&passenger)throw new BadRequestException('Для доставки укажите сведения о грузе вместо пассажира');
      const dispatchAfter=details?.scheduledAt?new Date(details.scheduledAt):new Date();
      const created = await tx.order.create({data:{clientId:actor.id,quoteId:quote.id,idempotencyKey:dto.idempotencyKey,kind:quote.kind,deliveryDetails:details?details as Prisma.InputJsonValue:Prisma.DbNull,dispatchAfter,pickup:quote.pickup as Prisma.InputJsonValue,dropoff:quote.dropoff as Prisma.InputJsonValue,geometry:quote.geometry as Prisma.InputJsonValue,distanceMeters:quote.distanceMeters,durationSeconds:quote.durationSeconds,price:quote.price,commission:quote.commission,comment:dto.comment?.trim()??'',passengerName:passenger?.name,passengerPhone:passenger?.phone,searchExpiresAt:new Date(dispatchAfter.getTime()+OFFER_SECONDS*1000),history:{create:{status:'SEARCHING',actorId:actor.id}}}});
      await this.push(tx,[actor.id],'order:created',created.id); return created;
    });
    await this.dispatchOrder(order.id); await this.publish(order.id); return this.serialize(order.id,false,actor.id);
  }
  private async lockOrder(tx:Prisma.TransactionClient,id:string) {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id"=${id}::uuid FOR UPDATE`;
    const order = await tx.order.findUnique({where:{id}});
    if(!order) throw new NotFoundException('Заказ не найден'); return order;
  }
  private async push(tx:Prisma.TransactionClient,users:string[],event:string,orderId:string) {
    if(users.length) await tx.pushJob.createMany({data:[...new Set(users)].map(userId=>({userId,event,orderId}))});
  }
  private participants(order:Order) {return [order.clientId,...(order.driverId?[order.driverId]:[])];}
  async active(actor:Actor) {
    const order = await this.db.order.findFirst({where:{...(actor.role==='DRIVER'?{driverId:actor.id}:{clientId:actor.id}),status:{in:ACTIVE_STATUSES}},orderBy:{createdAt:'desc'}});
    return order?this.serialize(order.id,false,actor.id):null;
  }
  async history(actor:Actor,period:string) {
    const orders = await this.db.order.findMany({where:{...(actor.role==='DRIVER'?{driverId:actor.id}:{clientId:actor.id}),createdAt:{gte:historySince(period)}},orderBy:{createdAt:'desc'},take:100});
    return Promise.all(orders.map(order=>this.serialize(order.id,false,actor.id)));
  }
  async get(actor:Actor,id:string) {return this.serialize(id,false,actor.id);}
  async authorize(actor:Actor,id:string) {
    const order = await this.db.order.findUnique({where:{id}});
    if(!order) throw new NotFoundException('Заказ не найден');
    if(order.clientId !== actor.id && order.driverId !== actor.id) throw new ForbiddenException('Нет доступа к заказу'); return order;
  }
  async serialize(id:string,offer=false,viewerId?:string) {
    const order = await this.db.order.findUniqueOrThrow({where:{id},include:{rating:true,clientRating:true,quote:{include:{tariff:true}}}});
    if(viewerId&&order.clientId!==viewerId&&order.driverId!==viewerId)throw new ForbiddenException('Нет доступа к заказу');
    const assignment = !offer&&order.driverId&&ASSIGNED_STATUSES.includes(order.status)
      ? await this.db.statusHistory.findFirst({where:{orderId:id,status:'ASSIGNED',actorId:order.driverId},orderBy:{createdAt:'desc'},select:{id:true}})
      : null;
    const driver = !offer&&order.driverId?await this.auth.user(order.driverId):null;
    const client = offer?undefined:await this.auth.user(order.clientId);
    const clientRating = await this.db.clientRating.aggregate({where:{order:{clientId:order.clientId,passengerName:null}},_avg:{score:true}});
    const safeClient = client?{id:client.id,name:client.name,phone:client.phone,photoUrl:client.photoUrl,role:client.role}:undefined;
    return {driverLocation:offer?null:visibleDriverLocation(order),assignmentId:assignment?.id??null,id:order.id,kind:order.kind,deliveryDetails:order.deliveryDetails,dispatchAfter:order.dispatchAfter,status:order.status,pickup:order.pickup,dropoff:order.dropoff,geometry:order.geometry,distanceMeters:order.distanceMeters,durationSeconds:order.durationSeconds,price:order.price,currency:'KGS',paymentMethod:'CASH',comment:order.comment,passenger:order.passengerName?{name:order.passengerName,phone:offer?undefined:order.passengerPhone}:null,createdAt:order.createdAt,updatedAt:order.updatedAt,searchExpiresAt:order.searchExpiresAt,completedAt:order.completedAt,driver,client:safeClient,rating:order.rating?.score??null,clientRating:clientRating._avg.score??null,driverRating:order.clientRating?.score??null,tariff:order.quote.tariff,routeProvider:order.quote.routeProvider};
  }
  async publish(id:string,additionalUsers:string[]=[]) {
    const snapshot=await this.serialize(id);
    const users=[snapshot.client?.id,snapshot.driver?.id].filter((value):value is string=>Boolean(value));
    this.events.publish(users,'order:updated',snapshot);
    if(additionalUsers.length)this.events.publish(additionalUsers.filter(userId=>!users.includes(userId)),'order:updated',{...snapshot,status:'SEARCHING',driver:null,client:undefined});
    if(snapshot.status!=='SEARCHING') {
      const offered=await this.db.orderOffer.findMany({where:{orderId:id},select:{driverId:true}});
      this.events.publish(offered.map(offer=>offer.driverId).filter(driverId=>driverId!==snapshot.driver?.id),'order:withdrawn',{orderId:id});
    }
  }
  async dispatchOrder(id:string) {
    const dispatch = await this.db.$transaction(async tx=>{
      const order = await this.lockOrder(tx,id);
      if(order.status !== 'SEARCHING') return {offered:null as string|null,withdrawn:[] as string[],expired:false};
      const now=Date.now();
      if(order.dispatchAfter.getTime()>now)return {offered:null,withdrawn:[],expired:false};
      const existing=await tx.orderOffer.findMany({where:{orderId:id},select:{driverId:true,skipped:true,expiresAt:true}});
      const active=existing.find(offer=>!offer.skipped&&offer.expiresAt.getTime()>now);
      if(active)return {offered:null,withdrawn:[],expired:false};
      const withdrawn=existing.filter(offer=>!offer.skipped&&offer.expiresAt.getTime()<=now).map(offer=>offer.driverId);
      if(withdrawn.length)await tx.orderOffer.updateMany({where:{orderId:id,driverId:{in:withdrawn}},data:{skipped:true}});
      const requiredClass=(await tx.quote.findUniqueOrThrow({where:{id:order.quoteId},select:{tariff:{select:{requiredClass:true}}}})).tariff.requiredClass;
      const drivers=(await tx.driverProfile.findMany({where:{verified:true,online:true,deposit:{gte:Math.max(this.config.minimumDeposit,order.commission)},vehicle:{isNot:null},locationMeasuredAt:{gte:new Date(now-POSITION_MAX_AGE_MS)}}})).filter(d=>driverCanTake(d,order.kind,requiredClass));
      const busy=new Set((await tx.order.findMany({where:{driverId:{in:drivers.map(d=>d.userId)},status:{in:ACTIVE_STATUSES}},select:{driverId:true}})).map(o=>o.driverId));
      const offered=new Set(existing.map(o=>o.driverId));
      const eligible=drivers.filter(d=>!busy.has(d.userId)&&!offered.has(d.userId));
      let ratings=new Map<string,number>();
      if(eligible.length){
        const ids=eligible.map(d=>Prisma.sql`${d.userId}::uuid`);
        const rows=await tx.$queryRaw<{driverId:string;rating:number}[]>`SELECT o."driverId", AVG(r."score")::float AS "rating" FROM "Rating" r JOIN "Order" o ON o."id"=r."orderId" WHERE o."driverId" IN (${Prisma.join(ids)}) GROUP BY o."driverId"`;
        ratings=new Map(rows.map(row=>[row.driverId,row.rating]));
      }
      const next=nextDriver(order.pickup as unknown as Point,eligible,ratings,now);
      if(next){
        const expiresAt=new Date(now+OFFER_SECONDS*1000);
        await tx.orderOffer.create({data:{orderId:id,driverId:next,expiresAt}});
        await tx.order.update({where:{id},data:{searchExpiresAt:expiresAt}});
        await this.push(tx,[next],'order:offer',id);
        return {offered:next,withdrawn,expired:false};
      }
      if(existing.length||order.searchExpiresAt.getTime()<=now){
        await tx.order.update({where:{id},data:{status:'NO_DRIVER',history:{create:{status:'NO_DRIVER',reason:'SEARCH_TIMEOUT'}}}});
        await this.push(tx,[order.clientId],'order:updated',id);
        return {offered:null,withdrawn,expired:true};
      }
      return {offered:null,withdrawn,expired:false};
    });
    if(dispatch.withdrawn.length)this.events.publish(dispatch.withdrawn,'order:withdrawn',{orderId:id});
    if(dispatch.expired) await this.publish(id);
    if(dispatch.offered) {
      const snapshot=await this.serialize(id,true);
      if(snapshot.status==='SEARCHING')this.events.publish([dispatch.offered],'order:offer',snapshot);
    }
  }
  async dispatchPending() {
    const pending = await this.db.order.findMany({where:{status:'SEARCHING',dispatchAfter:{lte:new Date()}},select:{id:true},take:200});
    for(const order of pending) await this.dispatchOrder(order.id);
  }
  async offers(actor:Actor) {
    if(actor.role !== 'DRIVER') throw new ForbiddenException();
    const driver = await this.db.driverProfile.findUnique({where:{userId:actor.id}});
    if(!driver?.verified || !driver.online) return [];
    if(await this.db.order.findFirst({where:{driverId:actor.id,status:{in:ACTIVE_STATUSES}}})) return [];
    const offers = await this.db.orderOffer.findMany({where:{driverId:actor.id,skipped:false,expiresAt:{gt:new Date()},order:{status:'SEARCHING',commission:{lte:driver.deposit}}},include:{order:{include:{quote:{include:{tariff:true}}}}},orderBy:{createdAt:'desc'},take:50});
    const valid = offers.filter(offer=>driver.deposit>=this.config.minimumDeposit&&driverCanTake(driver,offer.order.kind,offer.order.quote.tariff.requiredClass));
    return Promise.all(valid.map(async offer=>({...await this.serialize(offer.orderId,true),searchExpiresAt:offer.expiresAt})));
  }
  async accept(actor:Actor,id:string) {
    if(actor.role !== 'DRIVER') throw new ForbiddenException('Действие доступно водителю');
    await this.db.$transaction(async tx=>{
      const order = await this.lockOrder(tx,id);
      if(order.driverId===actor.id&&ASSIGNED_STATUSES.includes(order.status)) return;
      if(order.status !== 'SEARCHING') throw new ConflictException('Этот заказ уже недоступен');
      await tx.$queryRaw`SELECT "userId" FROM "DriverProfile" WHERE "userId"=${actor.id}::uuid FOR UPDATE`;
      const driver = await tx.driverProfile.findUnique({where:{userId:actor.id},include:{vehicle:true}});
      if(!driver?.verified||!driver.online||!driver.vehicle) throw new ForbiddenException('Водитель не подтверждён или не на линии');
      const requiredClass=(await tx.quote.findUniqueOrThrow({where:{id:order.quoteId},select:{tariff:{select:{requiredClass:true}}}})).tariff.requiredClass;
      if(!driverCanTake(driver,order.kind,requiredClass))throw new ForbiddenException('Этот вид заказа не разрешён водителю');
      if(driver.deposit<Math.max(order.commission,this.config.minimumDeposit)) throw new BadRequestException('Недостаточно средств на депозите');
      const offer = await tx.orderOffer.findUnique({where:{orderId_driverId:{orderId:id,driverId:actor.id}}});
      if(!offer||offer.skipped||offer.expiresAt.getTime()<=Date.now()) throw new ForbiddenException('Предложение истекло или заказ не был предложен вам');
      if(await tx.order.findFirst({where:{driverId:actor.id,status:{in:ACTIVE_STATUSES}}})) throw new ConflictException('У вас уже есть активный заказ');
      await tx.order.update({where:{id},data:{status:'ASSIGNED',driverId:actor.id,driverLocation:Prisma.DbNull,history:{create:{status:'ASSIGNED',actorId:actor.id}}}});
      await this.push(tx,[order.clientId],'order:assigned',id);
    });
    await this.publish(id);return this.serialize(id,false,actor.id);
  }
  async skip(actor:Actor,id:string) {
    if(actor.role !== 'DRIVER') throw new ForbiddenException();
    const result = await this.db.orderOffer.updateMany({where:{orderId:id,driverId:actor.id,skipped:false,expiresAt:{gt:new Date()},order:{status:'SEARCHING'}},data:{skipped:true}});
    if(!result.count) throw new NotFoundException('Предложение не найдено');
    this.events.publish([actor.id],'order:withdrawn',{orderId:id});
    await this.dispatchOrder(id);return {ok:true};
  }
  async transition(actor:Actor,id:string,status:OrderStatus) {
    await this.db.$transaction(async tx=>{
      const order = await this.lockOrder(tx,id);
      if(actor.role !== 'DRIVER'||order.driverId !== actor.id) throw new ForbiddenException('Заказ назначен другому водителю');
      if(order.status === status) return;
      assertDriverTransition(actor.role,order.status,status);
      if(status === 'COMPLETED') {
        await tx.$queryRaw`SELECT "userId" FROM "DriverProfile" WHERE "userId"=${actor.id}::uuid FOR UPDATE`;
        const driver = await tx.driverProfile.findUniqueOrThrow({where:{userId:actor.id}});
        if(driver.deposit<order.commission) throw new ConflictException('Недостаточно депозита для комиссии. Обратитесь в поддержку.');
        const balanceAfter = driver.deposit-order.commission;
        await tx.driverProfile.update({where:{userId:actor.id},data:{deposit:balanceAfter,...(balanceAfter<this.config.minimumDeposit?{online:false,locationLatitude:null,locationLongitude:null,locationAccuracyM:null,locationMeasuredAt:null}:{})}});
        await tx.ledgerEntry.create({data:{driverId:actor.id,orderId:id,kind:'COMMISSION',amount:-order.commission,balanceAfter,idempotencyKey:`commission:${id}`,note:'Комиссия за поездку'}});
      }
      await tx.order.update({where:{id},data:{status,...(status==='COMPLETED'?{completedAt:new Date(),driverLocation:Prisma.DbNull}:{}),history:{create:{status,actorId:actor.id}}}});
      if(status==='ARRIVED') await this.push(tx,[order.clientId],'trip:arrived',id);
      else await this.push(tx,this.participants(order),status==='COMPLETED'?'trip:completed':'order:updated',id);
    });
    await this.publish(id);return this.serialize(id,false,actor.id);
  }
  async cancel(actor:Actor,id:string) {
    let previousDriver:string|undefined;
    let cancelledByDriver=false;
    await this.db.$transaction(async tx=>{
      const order = await this.lockOrder(tx,id);
      if(order.clientId !== actor.id && order.driverId !== actor.id) throw new ForbiddenException();
      if(order.status==='CANCELLED'&&order.clientId===actor.id) return;
      if(!['SEARCHING','ASSIGNED','ARRIVED'].includes(order.status)) throw new BadRequestException('После начала поездки отмена недоступна');
      previousDriver=order.driverId??undefined;
      const byDriver=order.driverId===actor.id;
      cancelledByDriver=byDriver;
      if(byDriver) {
        await tx.orderOffer.updateMany({where:{orderId:id,driverId:actor.id},data:{skipped:true}});
        // Other drivers may receive a fresh offer after a driver cancellation.
        await tx.orderOffer.deleteMany({where:{orderId:id,driverId:{not:actor.id},skipped:false}});
      }
      const status = byDriver?'SEARCHING':'CANCELLED';
      await tx.order.update({where:{id},data:{status,driverLocation:Prisma.DbNull,...(byDriver?{driverId:null,searchExpiresAt:new Date(Date.now()+OFFER_SECONDS*1000)}:{}),history:{create:{status,actorId:actor.id,reason:byDriver?'DRIVER_CANCELLED':'CLIENT_CANCELLED'}}}});
      await this.push(tx,this.participants(order),'order:updated',id);
    });
    await this.publish(id,previousDriver?[previousDriver]:[]);await this.dispatchOrder(id);
    const snapshot=await this.serialize(id);
    return cancelledByDriver?{...snapshot,status:'SEARCHING',driver:null,client:undefined}:snapshot;
  }
  async coming(actor:Actor,id:string) {
    const order = await this.authorize(actor,id);
    if(order.clientId !== actor.id || order.status !== 'ARRIVED'||!order.driverId) throw new BadRequestException('Водитель ещё не прибыл');
    await this.limits.take(`coming:${id}`,3,60);
    await this.db.pushJob.create({data:{userId:order.driverId,orderId:id,event:'rider:coming'}});
    this.events.publish([order.driverId],'rider:coming',{orderId:id});return {ok:true,status:order.status};
  }
  async messages(actor:Actor,id:string) {
    return this.db.$transaction(async tx=>{
      const order=await this.lockOrder(tx,id);
      if(!this.participants(order).includes(actor.id))throw new ForbiddenException('Нет доступа к чату');
      if(!order.driverId)return [];
      const assignment=await tx.statusHistory.findFirst({where:{orderId:id,status:'ASSIGNED'},orderBy:{createdAt:'desc'}});
      // A replacement driver sees only the conversation for their own assignment.
      return tx.message.findMany({where:{orderId:id,senderId:{in:this.participants(order)},createdAt:{gte:assignment?.createdAt}},orderBy:{createdAt:'asc'},take:500});
    });
  }
  async sendMessage(actor:Actor,id:string,dto:MessageDto) {
    await this.limits.take(`chat:${actor.id}`,40,60);
    const message = await this.db.$transaction(async tx=>{
      const order = await this.lockOrder(tx,id);
      if(!this.participants(order).includes(actor.id)) throw new ForbiddenException();
      if(!ASSIGNED_STATUSES.includes(order.status)) throw new BadRequestException('Чат доступен во время активной поездки');
      if(!dto.text.trim()) throw new BadRequestException('Сообщение пустое');
      const existing = await tx.message.findUnique({where:{senderId_clientMessageId:{senderId:actor.id,clientMessageId:dto.clientMessageId}}});
      if(existing) {
        if(existing.orderId!==id||existing.text!==dto.text.trim()) throw new ConflictException('Ключ сообщения уже использован');return existing;
      }
      const created = await tx.message.create({data:{orderId:id,senderId:actor.id,text:dto.text.trim(),clientMessageId:dto.clientMessageId}});
      await this.push(tx,this.participants(order).filter(userId=>userId!==actor.id),'chat:message',id);return created;
    });
    const order = await this.db.order.findUniqueOrThrow({where:{id}});
    this.events.publish(this.participants(order),'chat:message',message);return message;
  }
  async rate(actor:Actor,id:string,score:number,comment?:string) {
    const normalizedComment=comment?.trim()??'';
    return this.db.$transaction(async tx=>{
      const order = await this.lockOrder(tx,id);
      if(order.clientId !== actor.id) throw new ForbiddenException();
      if(order.status!=='COMPLETED') throw new BadRequestException('Оценка доступна после завершения поездки');
      const rating = await tx.rating.findUnique({where:{orderId:id}});
      if(rating) {if(rating.score!==score||rating.comment!==normalizedComment) throw new ConflictException('Поездка уже оценена');return rating;}
      return tx.rating.create({data:{orderId:id,score,comment:normalizedComment}});
    });
  }
  private stable(value:unknown):string {
    return JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  }
  private deliveryDetails(kind:Order['kind'],dto:CreateOrderDto,validateSchedule=true) {
    if(kind==='RIDE'){
      if(dto.delivery)throw new BadRequestException('Параметры доставки не относятся к поездке');
      return null;
    }
    if(!dto.delivery?.goodsDescription.trim()||dto.delivery.goodsDescription.trim().length<3)throw new BadRequestException('Опишите груз для доставки');
    const scheduledAt=dto.delivery.scheduledAt?new Date(dto.delivery.scheduledAt):null;
    if(validateSchedule&&scheduledAt&&(scheduledAt.getTime()<Date.now()+300000||scheduledAt.getTime()>Date.now()+7*86400000))throw new BadRequestException('Запланировать доставку можно от 5 минут до 7 дней');
    if(kind==='DELIVERY_CAR'&&(dto.delivery.bodyType||dto.delivery.loaders))throw new BadRequestException('Грузчики и тип кузова доступны только для грузовой машины');
    return {goodsDescription:dto.delivery.goodsDescription.trim(),doorToDoor:!!dto.delivery.doorToDoor,...(scheduledAt?{scheduledAt:scheduledAt.toISOString()}:{}),...(kind==='DELIVERY_TRUCK'?{bodyType:dto.delivery.bodyType??'VAN',loaders:dto.delivery.loaders??0}:{})};
  }
  async rateClient(actor:Actor,id:string,score:number,comment?:string) {
    const normalizedComment=comment?.trim()??'';
    return this.db.$transaction(async tx=>{
      const order = await this.lockOrder(tx,id);
      if(actor.role!=='DRIVER'||order.driverId!==actor.id) throw new ForbiddenException();
      if(order.status!=='COMPLETED') throw new BadRequestException('Оценка доступна после завершения поездки');
      const rating = await tx.clientRating.findUnique({where:{orderId:id}});
      if(rating) {if(rating.score!==score||rating.comment!==normalizedComment) throw new ConflictException('Пассажир уже оценён');return rating;}
      return tx.clientRating.create({data:{orderId:id,score,comment:normalizedComment}});
    });
  }
}
