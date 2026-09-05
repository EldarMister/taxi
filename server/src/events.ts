import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
export interface RealtimeEvent {userIds:string[];name:string;payload:unknown}
@Injectable()
export class RealtimeEvents extends EventEmitter {
  publish(userIds:string[],name:string,payload:unknown) {this.emit('event',{userIds:[...new Set(userIds)],name,payload} satisfies RealtimeEvent);}
}
