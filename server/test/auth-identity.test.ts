import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BadRequestException,ForbiddenException} from '@nestjs/common';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {PhoneDto,VerifyDto} from '../src/dto';
import {profileUpdateData} from '../src/http';

test('client profile stores normalized explicit names and their combined display name',()=>{
  assert.deepEqual(profileUpdateData({firstName:'  Асан  ',lastName:'  Ибраев  ',language:'ky'},'CLIENT'),{firstName:'Асан',lastName:'Ибраев',name:'Асан Ибраев',language:'ky'});
  assert.deepEqual(profileUpdateData({firstName:'Анна  Мария',lastName:'де  ла Крус'},'CLIENT'),{firstName:'Анна Мария',lastName:'де ла Крус',name:'Анна Мария де ла Крус'});
});
test('client identity requires a complete valid pair and rejects ambiguous name writes',()=>{
  for(const dto of [{firstName:'Асан'},{lastName:'Ибраев'},{firstName:' ',lastName:'Ибраев'},{firstName:'Асан',lastName:''},{firstName:'x'.repeat(40),lastName:'y'.repeat(40)},{firstName:'Асан\u0000',lastName:'Ибраев'},{firstName:null,lastName:'Ибраев'},{firstName:'Асан',lastName:'Ибраев',name:'Override'}])assert.throws(()=>profileUpdateData(dto as any,'CLIENT'),BadRequestException);
});
test('legacy client names stay intact without guessed components; preferences alone keep identity intact',()=>{
  assert.deepEqual(profileUpdateData({name:' Асан  Ибраев '},'CLIENT'),{name:'Асан Ибраев',firstName:'',lastName:''});
  assert.deepEqual(profileUpdateData({name:'Асан'},'CLIENT'),{name:'Асан',firstName:'',lastName:''});
  assert.deepEqual(profileUpdateData({notifications:false},'CLIENT'),{notifications:false});
  assert.throws(()=>profileUpdateData({firstName:'Асан',lastName:'Ибраев'},'DRIVER'),ForbiddenException);
});
test('OTP DTO accepts explicit client/driver app selection and rejects admin or invented variants',async()=>{
  for(const appVariant of [undefined,'client','driver'])assert.equal((await validate(plainToInstance(PhoneDto,{phone:'+996700123456',...(appVariant?{appVariant}:{})}))).length,0);
  for(const appVariant of ['admin','restaurant',0])assert.ok((await validate(plainToInstance(VerifyDto,{phone:'+996700123456',code:'123456',appVariant}))).length);
});
