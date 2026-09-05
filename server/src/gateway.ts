import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from './auth';
import { RealtimeEvent, RealtimeEvents } from './events';

@WebSocketGateway({cors:{origin:(process.env.CORS_ORIGINS??'http://localhost:8081').split(',')},maxHttpBufferSize:16384})
export class TaxiGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!:Server;
  private auditTimer?:NodeJS.Timeout;
  constructor(private readonly auth:AuthService,private readonly events:RealtimeEvents) {}
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
    try {const actor=await this.actor(socket);socket.data.userId=actor.id;socket.emit('session:ready',{userId:actor.id});}
    catch {socket.emit('session:expired',{message:'Войдите снова'});socket.disconnect(true);}
  }
  private async audit() {
    if(!this.server)return;
    for(const socket of this.server.sockets.sockets.values()) {
      try{await this.actor(socket);}catch{socket.emit('session:expired',{});socket.disconnect(true);}
    }
  }
  private async send(event:RealtimeEvent) {
    if(!this.server)return;
    for(const socket of this.server.sockets.sockets.values()) {
      if(!event.userIds.includes(socket.data.userId))continue;
      try {
        await this.actor(socket);
        socket.emit(event.name,event.payload);
      }catch{socket.disconnect(true);}
    }
  }
  // Rooms cannot be selected by clients. Order/chat changes use the same guarded REST commands.
}
