import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Actor } from './auth';

export function assertAdmin(actor:Actor) {
  if(actor.role!=='ADMIN')throw new ForbiddenException('Доступ разрешён только администратору');
}
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context:ExecutionContext) {assertAdmin(context.switchToHttp().getRequest().actor);return true;}
}
@Injectable()
export class AdminAuditService {
  record(tx:Prisma.TransactionClient,actor:Actor,action:string,entity:string,entityId:string,details?:Prisma.InputJsonValue) {
    assertAdmin(actor);
    return tx.adminAudit.create({data:{actorId:actor.id,action,entity,entityId,...(details===undefined?{}:{details})}});
  }
}
function derive(password:string,salt:Buffer):Promise<Buffer> {
  return new Promise((resolve,reject)=>scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));
}
export async function hashAdminPassword(password:string) {
  if(password.length<12||password.length>256)throw new Error('Password must be 12–256 characters');
  const salt=randomBytes(16),key=await derive(password,salt);
  return `scrypt-v1:${salt.toString('hex')}:${key.toString('hex')}`;
}
export async function verifyAdminPassword(password:string,encoded:string) {
  const [version,saltHex,keyHex]=encoded.split(':');
  if(version!=='scrypt-v1'||!/^[a-f0-9]{32}$/.test(saltHex??'')||!/^[a-f0-9]{128}$/.test(keyHex??'')||password.length>256)return false;
  return timingSafeEqual(await derive(password,Buffer.from(saltHex,'hex')),Buffer.from(keyHex,'hex'));
}
