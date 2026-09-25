import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from './auth';
import { RealtimeEvent, RealtimeEvents } from './events';
import { TrackingService } from './tracking';

@WebSocketGateway({cors:{origin:(process.env.CORS_ORIGINS??'http://localhost:8081').split(',')},maxHttpBufferSize:16384})
export class TaxiGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!:Server;
  private auditTimer?:NodeJS.Timeout;
  constructor(private readonly auth:AuthService,private readonly events:RealtimeEvents,private readonly tracking:TrackingService) {}
  private readonly deliver=(event:RealtimeEvent)=>{void this.send(event).catch(()=>undefined);};
  onModuleInit() {
    this.events.on('event',this.deliver);
    this.auditTimer=setInterval(()=>{void this.audit().catch(()=>undefined);},10000);this.auditTimer.unref();
  }
  onModuleDestroy() {this.events.off('event',this.deliver);if(this.auditTimer)clearInterval(this.auditTimer);}
  private async actor(socket:Socket) {
    const token=socket.handshake.auth?.token;
    if(typeof token!=='string'||token.length>4096) throw new Error('Unauthorized');
    return this.auth.authenticate(token);
  }
  async handleConnection(socket:Socket) {
    try {const actor=await this.actor(socket);socket.data.userId=actor.id;socket.data.role=actor.role;socket.emit('session:ready',{userId:actor.id});}
    catch {socket.emit('session:expired',{message:'Войдите снова'});socket.disconnect(true);}
  }
  @SubscribeMessage('tracking:subscribe')
  async subscribeTracking(@ConnectedSocket() socket:Socket,@MessageBody() body:{orderId?:string}) {
    const actor=await this.actor(socket);
    if(actor.role!=='CLIENT'||typeof body?.orderId!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).test(body.orderId))return {ok:false};
    try {
      const snapshot=await this.tracking.get(actor,body.orderId);
      if(!['ASSIGNED','ARRIVED','IN_PROGRESS'].includes(snapshot.status))return {ok:false};
      await socket.join(`order:${body.orderId}`);
      socket.emit('driver:location:update',snapshot);
      return {ok:true};
    } catch {return {ok:false};}
  }
  @SubscribeMessage('tracking:unsubscribe')
  async unsubscribeTracking(@ConnectedSocket() socket:Socket,@MessageBody() body:{orderId?:string}) {
    if(typeof body?.orderId==='string')await socket.leave(`order:${body.orderId}`);
    return {ok:true};
  }
  private async audit() {
    if(!this.server)return;
    for(const socket of this.server.sockets.sockets.values()) {
      try{await this.actor(socket);}catch{socket.emit('session:expired',{});socket.disconnect(true);}
    }
  }
  private async send(event:RealtimeEvent) {
    if(!this.server)return;
    if(event.orderId){
      const room=this.server.sockets.adapter.rooms.get(`order:${event.orderId}`);
      if(!room)return;
      for(const id of room){
        const socket=this.server.sockets.sockets.get(id);
        if(!socket)continue;
        try{const actor=await this.actor(socket);if(actor.role==='CLIENT')socket.emit(event.name,event.payload);else socket.disconnect(true);}
        catch{socket.disconnect(true);}
      }
      return;
    }
    for(const socket of this.server.sockets.sockets.values()) {
      if(event.audience==='admin'&&socket.data.role!=='ADMIN')continue;
      if(!event.audience&&!event.userIds.includes(socket.data.userId))continue;
      try {
        const actor=await this.actor(socket);
        socket.data.role=actor.role;
        if(event.audience==='admin'&&actor.role!=='ADMIN')continue;
        socket.emit(event.name,event.payload);
      }catch{socket.disconnect(true);}
    }
  }
  // Tracking rooms require a fresh authenticated order membership check.
}
