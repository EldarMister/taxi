import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Decorator metadata is emitted by the server build, not the tsx test runner.
const { UsersController } = require('../dist/src/http.js');

test('a full device list accepts a replacement push token and evicts only the oldest', async () => {
  const userId='00000000-0000-0000-0000-000000000001';
  const tokens=Array.from({length:10},(_,index)=>({id:String(index),token:`ExponentPushToken[old-${index}]`,userId,updatedAt:new Date(index*1000)}));
  const db={
    $transaction:async (work:(tx:any)=>Promise<void>)=>work({
      $queryRaw:async()=>[],
      pushToken:{
        findUnique:async ({where}:any)=>tokens.find(item=>item.token===where.token)??null,
        findMany:async ()=>tokens.toSorted((a,b)=>a.updatedAt.getTime()-b.updatedAt.getTime()).map(({id})=>({id})),
        deleteMany:async ({where}:any)=>{for(const id of where.id.in){const index=tokens.findIndex(item=>item.id===id);if(index>=0)tokens.splice(index,1);}},
        upsert:async ({where,create}:any)=>{if(!tokens.some(item=>item.token===where.token))tokens.push({...create,id:'replacement',updatedAt:new Date()});},
      },
    }),
  };
  const limits={take:async()=>{}};
  const controller=new UsersController(db,{},limits);
  await controller.push({actor:{id:userId}},{token:'ExponentPushToken[current]',platform:'android'});
  assert.equal(tokens.length,10);
  assert.equal(tokens.some(item=>item.id==='0'),false);
  assert.equal(tokens.some(item=>item.token==='ExponentPushToken[current]'),true);
});
