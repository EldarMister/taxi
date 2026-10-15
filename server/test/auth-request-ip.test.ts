import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authRequestIp } from '../src/auth';

const domain='atlas-api-test.up.railway.app';
const request=(client:string|Array<string>,overrides:Record<string,unknown>={})=>({ip:'10.0.0.5',headers:{host:domain,'x-railway-edge':'example-pop','x-forwarded-proto':'https','x-real-ip':client,...overrides}});
test('public Railway requests use distinct actual client IPs despite the same socket peer',()=>{
  assert.equal(authRequestIp(request('203.0.113.1'),domain),'203.0.113.1');
  assert.equal(authRequestIp(request('203.0.113.2'),domain),'203.0.113.2');
  assert.equal(authRequestIp(request('2001:db8::1'),domain),'2001:db8::1');
  assert.equal(authRequestIp(request('::ffff:203.0.113.1'),domain),'203.0.113.1');
});
test('direct and private requests cannot opt into trusting an arbitrary forwarded client address',()=>{
  assert.equal(authRequestIp(request('203.0.113.1'),''),'10.0.0.5');
  for(const headers of [{host:'atlas-api.railway.internal'},{host:'localhost'},{'x-railway-edge':undefined},{'x-forwarded-proto':'http'}])
    assert.equal(authRequestIp(request('203.0.113.1',headers),domain),'10.0.0.5');
});
test('malformed, duplicate and port-bearing IP headers are rejected while public hosts are normalized',()=>{
  for(const client of ['not-an-ip','203.0.113.1, 203.0.113.2','203.0.113.1:1234',['203.0.113.1','203.0.113.2']])
    assert.equal(authRequestIp(request(client),domain),'10.0.0.5');
  assert.equal(authRequestIp(request(' 203.0.113.1 ',{host:domain.toUpperCase()+':443'}),domain),'203.0.113.1');
});
