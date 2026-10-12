import { HttpException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Actor, AuthService, RateLimits } from './auth';
import { RealtimeEvent, RealtimeEvents } from './events';
import { TrackingService } from './tracking';

type ActorLookup=(socket:Socket)=>Promise<Actor>;
@WebSocketGateway({cors:{origin:(process.env.CORS_ORIGINS??'http://localhost:8081').split(',')},maxHttpBufferSize:16384})
export class TaxiGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!:Server;
  private auditTimer?:NodeJS.Timeout;
  private auditing=false;
  private readonly admittedSessions=new WeakMap<Socket,string>();
  private readonly pendingAdmissions=new WeakMap<Socket,{sessionId:string;promise:Promise<void>}>();
  constructor(private readonly auth:AuthService,private readonly events:RealtimeEvents,private readonly tracking:TrackingService,private readonly limits:RateLimits) {}
  private readonly deliver=(event:RealtimeEvent)=>this.send(event);
  onModuleInit() {
    this.events.on('event',this.deliver);
    this.auditTimer=setInterval(()=>{void this.audit().catch(()=>undefined);},10000);this.auditTimer.unref();
  }
  onModuleDestroy() {this.events.off('event',this.deliver);if(this.auditTimer)clearInterval(this.auditTimer);}
  private token(socket:Socket) {
    const token=socket.handshake.auth?.token;
    if(typeof token!=='string'||token.length>4096)throw new UnauthorizedException();
    return token;
  }
  private actor(socket:Socket) {return this.auth.authenticate(this.token(socket));}
  /** One delivery/sweep shares checks for identical tokens, but no result
   * survives that operation. Separate session tokens are always checked. */
  private lookup():ActorLookup {
    const pending=new Map<string,Promise<Actor>>();
    return socket=>{
      const token=this.token(socket);
      let result=pending.get(token);
      if(!result){result=this.auth.authenticate(token);pending.set(token,result);}
      return result;
    };
  }
  private failure(socket:Socket,error:unknown) {
    if(error instanceof UnauthorizedException) {
      socket.emit('session:expired',{message:'Войдите снова'});socket.disconnect(true);return;
    }
    if(error instanceof HttpException&&error.getStatus()===429) {
      const response=error.getResponse(),retry=typeof response==='object'&&response!==null?(response as {retryAfterSeconds?:unknown}).retryAfterSeconds:undefined;
      socket.emit('session:unavailable',{statusCode:429,message:'Слишком много подключений. Попробуйте позже.',...(typeof retry==='number'&&Number.isInteger(retry)&&retry>0?{retryAfterSeconds:retry}:{})});
      // Release a rejected transport; the session itself remains valid. A
      // later audit may recover DB failures, never rejected admissions.
      socket.disconnect(true);return;
    }
    // A failed access check is not token expiry. Keep transport for recovery,
    // but emit no protected data or successful protected action.
    if(!socket.data.authorizationUnavailable)socket.emit('session:unavailable',{statusCode:error instanceof HttpException?error.getStatus():503,message:'Не удалось проверить доступ. Попробуйте позже.'});
    socket.data.authorizationUnavailable=true;
  }
  private async admit(socket:Socket,actor:Actor) {
    if(this.admittedSessions.get(socket)===actor.sessionId)return;
    let admission=this.pendingAdmissions.get(socket);
    if(admission?.sessionId!==actor.sessionId) {
      admission={sessionId:actor.sessionId,promise:this.limits.take(`ws-connect:session:${actor.sessionId}`,60,60).then(()=>{this.admittedSessions.set(socket,actor.sessionId);})};
      this.pendingAdmissions.set(socket,admission);
    }
    try{await admission.promise;}finally{if(this.pendingAdmissions.get(socket)===admission)this.pendingAdmissions.delete(socket);}
  }
  private async ready(socket:Socket,actor:Actor) {
    // Failed DB checks remain retryable. A socket cannot join protected rooms
    // or recover before its connection allowance has actually been consumed.
    await this.admit(socket,actor);
    const recovery=socket.data.authorizationUnavailable===true;
    const initial=socket.data.userId===undefined;
    socket.data.userId=actor.id;socket.data.role=actor.role;socket.data.authorizationUnavailable=false;
    await socket.join(`user:${actor.id}`);
    if(actor.role==='ADMIN')await socket.join('audience:admin');else await socket.leave('audience:admin');
    if(initial||recovery)socket.emit('session:ready',{userId:actor.id,resyncRequired:true});
  }
  async handleConnection(socket:Socket) {
    try {
      const actor=await this.actor(socket);
      await this.ready(socket,actor);
    }catch(error){this.failure(socket,error);}
  }
  @SubscribeMessage('tracking:subscribe')
  async subscribeTracking(@ConnectedSocket() socket:Socket,@MessageBody() body:{orderId?:string}) {
    try {
      const actor=await this.actor(socket);
      if(actor.role!=='CLIENT'||typeof body?.orderId!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).test(body.orderId))return {ok:false};
      try{await this.admit(socket,actor);}catch(error){
        this.failure(socket,error);
        return error instanceof HttpException&&error.getStatus()===429?{ok:false,statusCode:429}:{ok:false,retry:true};
      }
      await this.limits.take(`ws-tracking:${actor.sessionId}`,120,60);
      const snapshot=await this.tracking.get(actor,body.orderId);
      if(!['ASSIGNED','ARRIVED','IN_PROGRESS'].includes(snapshot.status))return {ok:false};
      await this.ready(socket,actor);
      await socket.join(`order:${body.orderId}`);
      socket.emit('driver:location:update',snapshot);
      return {ok:true};
    }catch(error) {
      if(error instanceof HttpException&&[400,403,404,429].includes(error.getStatus()))return {ok:false,statusCode:error.getStatus()};
      this.failure(socket,error);return {ok:false,retry:true};
    }
  }
  @SubscribeMessage('tracking:unsubscribe')
  async unsubscribeTracking(@ConnectedSocket() socket:Socket,@MessageBody() body:{orderId?:string}) {
    if(typeof body?.orderId==='string')await socket.leave(`order:${body.orderId}`);
    return {ok:true};
  }
  private async audit() {
    if(!this.server||this.auditing)return;
    this.auditing=true;
    const actorFor=this.lookup();
    try {
      for(const socket of this.server.sockets.sockets.values()) {
        try{await this.ready(socket,await actorFor(socket));}catch(error){this.failure(socket,error);}
      }
    }finally{this.auditing=false;}
  }
  private recipients(event:RealtimeEvent):Iterable<Socket> {
    if(!event.orderId&&event.audience==='authenticated')return this.server.sockets.sockets.values();
    const rooms=event.orderId?[`order:${event.orderId}`]:event.audience==='admin'?['audience:admin']:event.userIds.map(id=>`user:${id}`);
    const ids=new Set<string>();
    for(const room of rooms)for(const id of this.server.sockets.adapter.rooms.get(room)??[])ids.add(id);
    return [...ids].flatMap(id=>{const socket=this.server.sockets.sockets.get(id);return socket?[socket]:[];});
  }
  private async send(event:RealtimeEvent) {
    if(!this.server)return;
    const actorFor=this.lookup();
    let unavailable=false;
    for(const socket of this.recipients(event)) {
      try {
        const actor=await actorFor(socket);
        await this.ready(socket,actor);
        if(event.orderId&&actor.role!=='CLIENT')continue;
        if(event.audience==='admin'&&actor.role!=='ADMIN')continue;
        if(event.name==='order:offer'&&actor.role!=='DRIVER')continue;
        if(!event.orderId&&!event.audience&&!event.userIds.includes(actor.id))continue;
        socket.emit(event.name,event.payload);
      }catch(error){this.failure(socket,error);if(!(error instanceof UnauthorizedException))unavailable=true;}
    }
    if(unavailable)throw new ServiceUnavailableException('Не удалось проверить доступ получателя события.');
  }
}
