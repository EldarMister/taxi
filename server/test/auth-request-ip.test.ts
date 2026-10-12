import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authRequestIp } from '../src/auth';
import { requestClientIp, trustedProxyPeers } from '../src/request-client-ip';

const request=(client:unknown,peer='10.20.30.5')=>({ip:'203.0.113.99',socket:{remoteAddress:peer},headers:{host:'atlas-api-test.up.railway.app','x-railway-edge':'spoofed','x-forwarded-proto':'https','x-real-ip':client}} as any);
test('spoofable Host and edge/proto/Express ip never establish proxy trust',()=>{
  assert.equal(authRequestIp(request('203.0.113.1'),''),'10.20.30.5');
  assert.equal(authRequestIp(request('203.0.113.1','198.51.100.7'),'10.20.30.0/24'),'198.51.100.7');
  assert.equal(requestClientIp({headers:request('203.0.113.1').headers,ip:'203.0.113.99'},''),'unknown');
});
test('only explicitly trusted network peers can supply one valid client IP',()=>{
  for(const ip of ['203.0.113.1','2001:db8::1'])assert.equal(authRequestIp(request(ip),'10.20.30.0/24'),ip);
  assert.equal(authRequestIp(request('::ffff:203.0.113.1','::ffff:10.20.30.5'),'10.20.30.5'),'203.0.113.1');
  assert.equal(authRequestIp(request('203.0.113.1','fd00:1234::1'),'fd00:1234::/64'),'203.0.113.1');
});
test('malformed, duplicate and port-bearing forwarded IPs remain untrusted',()=>{
  for(const ip of ['bad','203.0.113.1, 203.0.113.2','203.0.113.1:443',['203.0.113.1','203.0.113.2']])assert.equal(authRequestIp(request(ip),'10.20.30.0/24'),'10.20.30.5');
  assert.equal(authRequestIp(request(' 203.0.113.1 '),'10.20.30.0/24'),'203.0.113.1');
});
test('invalid or blanket proxy configuration fails closed',()=>{
  for(const spec of ['garbage','10.0.0.1/33','10.0.0.1/0','::/0','10.0.0.1/','10.0.0.1/24/24','10.0.0.1/-1'])assert.throws(()=>trustedProxyPeers(spec),/Invalid TRUSTED_PROXY_CIDRS/);
});
