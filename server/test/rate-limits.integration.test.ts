import { requireTestDatabase } from './test-database';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RateLimits } from '../src/auth';
import type { PrismaService } from '../src/prisma.service';

const databaseUrl=process.env.RATE_LIMIT_TEST_DATABASE_URL || process.env.DATABASE_URL;
requireTestDatabase(databaseUrl);
const prefix=`otp-limits-test:${randomUUID()}:`;
let db:PrismaClient,limits:RateLimits;
before(async()=>{
  db=new PrismaClient({datasourceUrl:databaseUrl});
  await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "RateLimit" ("key" TEXT PRIMARY KEY,"count" INTEGER NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL)');
  limits=new RateLimits(db as PrismaService);
});
after(async()=>{if(db){await db.rateLimit.deleteMany({where:{key:{startsWith:prefix}}});await db.$disconnect();}});
const keys=(name:string)=>[
  {key:`${prefix}${name}:sms:ip`,max:20,seconds:3600},
  {key:`${prefix}${name}:sms:phone-hour`,max:5,seconds:3600},
  {key:`${prefix}${name}:sms:phone-minute`,max:1,seconds:60},
];
function rateError(error:unknown,min:number,max:number){
  assert.ok(error instanceof HttpException);assert.equal(error.getStatus(),429);
  const response=error.getResponse() as {retryAfterSeconds:number;message:string};
  assert.ok(response.retryAfterSeconds>=min&&response.retryAfterSeconds<=max,`Expected ${min}–${max}s, received ${JSON.stringify(response)}`);
  assert.match(response.message,/Слишком много запросов/);return true;
}

test('minute rejections leave the hourly and IP allowance unchanged; the next minute permits a request',async()=>{
  const rules=keys('minute');await limits.takeAll(rules);
  for(let i=0;i<8;i++)await assert.rejects(limits.takeAll(rules),error=>rateError(error,1,60));
  for(const rule of rules)assert.equal((await db.rateLimit.findUniqueOrThrow({where:{key:rule.key}})).count,1);
  await db.rateLimit.update({where:{key:rules[2].key},data:{expiresAt:new Date(Date.now()-1000)}});
  await limits.takeAll(rules);
  assert.equal((await db.rateLimit.findUniqueOrThrow({where:{key:rules[0].key}})).count,2);
  assert.equal((await db.rateLimit.findUniqueOrThrow({where:{key:rules[1].key}})).count,2);
  assert.equal((await db.rateLimit.findUniqueOrThrow({where:{key:rules[2].key}})).count,1);
});

test('the real hourly limit still rejects request six and reports its remaining window',async()=>{
  const rules=keys('hour');
  for(let i=0;i<5;i++){
    if(i)await db.rateLimit.update({where:{key:rules[2].key},data:{expiresAt:new Date(Date.now()-1000)}});
    await limits.takeAll(rules);
  }
  await assert.rejects(limits.takeAll(rules),error=>rateError(error,3500,3600));
  assert.equal((await db.rateLimit.findUniqueOrThrow({where:{key:rules[0].key}})).count,5);
  assert.equal((await db.rateLimit.findUniqueOrThrow({where:{key:rules[1].key}})).count,5);
});

test('concurrent requests for one number reserve one allowance without partial increments',async()=>{
  const rules=keys('concurrent');
  const results=await Promise.allSettled(Array.from({length:10},()=>limits.takeAll(rules)));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  for(const result of results)if(result.status==='rejected')rateError(result.reason,1,60);
  for(const rule of rules)assert.equal((await db.rateLimit.findUniqueOrThrow({where:{key:rule.key}})).count,1);
});

test('a shared IP allowance is enforced across different numbers and expired windows reset',async()=>{
  const ip={key:`${prefix}shared-ip`,max:4,seconds:3600};
  const results=await Promise.allSettled(Array.from({length:10},(_,i)=>limits.takeAll([ip,{key:`${prefix}shared-phone:${i}`,max:1,seconds:60}])));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,4);
  assert.equal(await db.rateLimit.count({where:{key:{startsWith:`${prefix}shared-phone:`}}}),4);
  await db.rateLimit.update({where:{key:ip.key},data:{expiresAt:new Date(Date.now()-1000)}});
  await limits.take(ip.key,4,3600);
  assert.equal((await db.rateLimit.findUniqueOrThrow({where:{key:ip.key}})).count,1);
});
