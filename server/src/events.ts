import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
export interface RealtimeEvent {userIds:string[];name:string;payload:unknown;audience?:'admin'|'authenticated';orderId?:string}
@Injectable()
export class RealtimeEvents extends EventEmitter {
  publish(userIds:string[],name:string,payload:unknown) {
    this.emit('event',{userIds:[...new Set(userIds)],name,payload} satisfies RealtimeEvent);
    if(name==='order:updated')this.adminChanged('taxi-orders',(payload as {id?:string})?.id);
  }
  publishOrder(orderId:string,name:string,payload:unknown) {
    this.emit('event',{userIds:[],orderId,name,payload} satisfies RealtimeEvent);
  }
  adminChanged(resource:string,id?:string) {
    this.emit('event',{userIds:[],audience:'admin',name:'admin:changed',payload:{resource,id,at:new Date().toISOString()}} satisfies RealtimeEvent);
  }
  contentChanged(resource:'restaurants'|'banners'|'tariffs') {
    this.emit('event',{userIds:[],audience:'authenticated',name:'content:changed',payload:{resource,at:new Date().toISOString()}} satisfies RealtimeEvent);
  }
}
