import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { localizedRoadName, parseOsrmMatch, parseOsrmRoute, RoutingService } from '../src/routing';
import { PlacesService, parseNominatimPlace } from '../src/places';
import { AppConfig } from '../src/config';
import { PhotonSearch, parsePhotonPlace } from '../src/photon';
import { osrmFixture, pickup, dropoff } from './maps.fixture';

const config = {osrmBaseUrl:'https://routing.example.test/osrm',nominatimBaseUrl:'https://geocoding.example.test',nominatimUserAgent:'TaxiGO/1.0 (+https://example.test)',nominatimIntervalMs:1000} as AppConfig;
const place = {osm_type:'way',osm_id:123,lat:'42.8756',lon:'74.604',display_name:'Площадь Ала-Тоо, Бишкек, Кыргызстан'};
const photonFeature = {type:'Feature',geometry:{type:'Point',coordinates:[72.1795757,41.2033565]},properties:{osm_type:'W',osm_id:27339503,name:'улица Ленина',street:'улица Ленина',city:'Шамалды-Сай',country:'Кыргызстан'}};

test('Photon preserves coordinates and OSM identity, deduplicates labels and never invents house numbers',()=>{
  const result=parsePhotonPlace(photonFeature);
  assert.deepEqual(result,{id:'osm-way-27339503',address:'улица Ленина, Шамалды-Сай, Кыргызстан',latitude:41.2033565,longitude:72.1795757});
  for(const value of [null,{...photonFeature,geometry:{type:'Point',coordinates:[181,41]}},{...photonFeature,properties:{osm_type:'X',osm_id:2,name:'Test'}}])assert.throws(()=>parsePhotonPlace(value));
});

test('Photon autocomplete shares parallel local/global work and caches normalized queries',async(t)=>{
  const finish:Array<(value:Response)=>void>=[];
  const mock=t.mock.method(globalThis,'fetch',async(input:any)=>{
    const u=new URL(input.toString());assert.equal(u.hostname,'photon.example.test');assert.equal(u.searchParams.get('q'),'ленена');assert.equal(u.searchParams.get('countrycode'),'KG');assert.equal(u.searchParams.get('lang'),'ru');if(u.searchParams.has('bbox'))assert.equal(u.searchParams.get('lat'),'41.199');
    return new Promise<Response>(resolve=>{finish.push(resolve);});
  });
  const s=new PlacesService({...config,photonBaseUrl:'http://photon.example.test'} as AppConfig);
  const center={latitude:41.1987,longitude:72.1802};
  const a=s.search(' Ленена ',center),b=s.search('ленена',center);
  assert.equal(mock.mock.callCount(),2);
  finish.forEach(resolve=>resolve(Response.json({type:'FeatureCollection',features:[photonFeature,photonFeature]})));
  const [first,second]=await Promise.all([a,b]);assert.equal(first.length,1);assert.deepEqual(first,second);
  first[0].address='mutated';assert.notEqual((await s.search('ЛЕНЕНА',center))[0].address,'mutated');assert.equal(mock.mock.callCount(),2);
});

test('Photon requests Kyrgyz labels separately from Russian cache entries',async(t)=>{
  const langs:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:any)=>{
    langs.push(new URL(input.toString()).searchParams.get('lang')!);
    return Response.json({type:'FeatureCollection',features:[photonFeature]});
  });
  const search=new PhotonSearch('http://photon.example.test'),center={latitude:41,longitude:72};
  await search.search('Ленина',center,'ky');
  await search.search('Ленина',center,'ru');
  assert.deepEqual(langs,['ky','ky','ru','ru']);
});

test('different Photon queries run concurrently and failures do not poison later requests',async(t)=>{
  const pending:Array<(r:Response)=>void>=[];
  const mock=t.mock.method(globalThis,'fetch',()=>new Promise<Response>(r=>pending.push(r)));
  const s=new PhotonSearch('http://photon.example.test'),center={latitude:41,longitude:72};
  const a=s.search('Ленина',center),b=s.search('Ош',center);
  assert.equal(pending.length,4,'there is no serialized one-second queue');
  pending[0](new Response('',{status:503}));pending[1](new Response('',{status:503}));
  pending[2](Response.json({type:'FeatureCollection',features:[]}));pending[3](Response.json({type:'FeatureCollection',features:[]}));
  await assert.rejects(()=>a,ServiceUnavailableException);assert.deepEqual(await b,[]);
  mock.mock.mockImplementation(async()=>Response.json({type:'FeatureCollection',features:[photonFeature]}));
  assert.equal((await s.search('Ленина',center)).length,1);
});

test('Photon favors local fuzzy matches over a distant old-name match and keeps explicit cities',async(t)=>{
  const local={...photonFeature,properties:{...photonFeature.properties,type:'street'}};
  const other={...photonFeature,properties:{...photonFeature.properties,osm_id:99,type:'city',name:'Раззакова',city:'Раззакова'}};
  t.mock.method(globalThis,'fetch',async(input:any)=>{
    const u=new URL(input.toString());const feature=u.searchParams.has('bbox')?local:{...other,properties:{...other.properties,...(u.searchParams.get('q')==='бишкек'?{name:'Бишкек',city:'Бишкек'}:{})}};
    return Response.json({type:'FeatureCollection',features:[feature]});
  });
  const s=new PhotonSearch('http://photon.example.test'),center={latitude:41.199,longitude:72.180};
  assert.equal((await s.search('ленена',center))[0].id,'osm-way-27339503');
  assert.equal((await s.search('Бишкек',center))[0].id,'osm-way-99');
});

test('Photon missing local house falls back to the real street without manufacturing its number',async(t)=>{
  const calls:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:any)=>{
    const u=new URL(input.toString());calls.push(u.searchParams.get('q')!);
    return Response.json({type:'FeatureCollection',features:u.searchParams.get('q')==='ленина'?[{...photonFeature,properties:{...photonFeature.properties,type:'street'}}]:[]});
  });
  const result=await new PhotonSearch('http://photon.example.test').search('Ленина 10',{latitude:41.199,longitude:72.180});
  assert.equal(calls.length,3);assert.equal(result[0].address,'улица Ленина, Шамалды-Сай, Кыргызстан');
});

test('OSRM GeoJSON and maneuver locations keep longitude/latitude order and instructions',()=>{
  const route = parseOsrmRoute(osrmFixture(), pickup, dropoff);
  assert.equal(route.provider,'osrm'); assert.equal(route.distanceMeters,3210); assert.equal(route.durationSeconds,551);
  assert.deepEqual(route.geometry[0],{latitude:pickup.latitude,longitude:pickup.longitude});
  assert.equal(route.steps[1].maneuver.modifier,'right'); assert.equal(route.steps[1].maneuver.bearingAfter,180);
  assert.equal(route.steps[1].name,'проспект Манаса'); assert.equal(route.steps.at(-1)?.maneuver.type,'arrive');
  const roundabout = osrmFixture(); Object.assign(roundabout.routes[0].legs[0].steps[1].maneuver,{type:'roundabout',exit:3});
  assert.equal(parseOsrmRoute(roundabout,pickup,dropoff).steps[1].maneuver.exit,3);
});

test('invalid OSRM responses cannot become successful straight-line routes',()=>{
  for (const mutate of [
    (p:any)=>{p.code='NoRoute';}, (p:any)=>{p.routes=[];},
    (p:any)=>{p.routes[0].distance=-1;}, (p:any)=>{p.routes[0].duration=NaN;},
    (p:any)=>{p.routes[0].geometry.coordinates[0]=[200,91];},
    (p:any)=>{p.routes[0].geometry.coordinates[0]=[0,0];},
    (p:any)=>{p.routes[0].legs[0].steps=[];},
    (p:any)=>{p.routes[0].legs[0].steps[1].maneuver.location=[null,42];},
    (p:any)=>{p.routes[0].legs[0].steps[1].maneuver.bearing_after=360;},
    (p:any)=>{p.routes[0].legs[0].steps[1].maneuver.exit=-1;},
    (p:any)=>{p.routes[0].legs[0].steps[2].maneuver.type='turn';},
  ]) {const payload=osrmFixture();mutate(payload);assert.throws(()=>parseOsrmRoute(payload,pickup,dropoff));}
});

test('routing requests driving steps with full GeoJSON; outages remain 503',async(t)=>{
  const fetchMock=t.mock.method(globalThis,'fetch',async(input:any)=>{
    const url=new URL(input.toString());
    assert.equal(url.pathname,`/osrm/route/v1/driving/${pickup.longitude},${pickup.latitude};${dropoff.longitude},${dropoff.latitude}`);
    assert.equal(url.searchParams.get('steps'),'true'); assert.equal(url.searchParams.get('geometries'),'geojson');assert.equal(url.searchParams.get('overview'),'full');
    return Response.json(osrmFixture());
  });
  const routing = new RoutingService(config);
  assert.equal((await routing.route(pickup,dropoff)).provider,'osrm');
  fetchMock.mock.mockImplementation(async()=>new Response('',{status:429}));
  await assert.rejects(()=>routing.route(pickup,dropoff),ServiceUnavailableException);
  fetchMock.mock.mockImplementation(async()=>{throw new DOMException('aborted','TimeoutError');});
  await assert.rejects(()=>routing.route(pickup,dropoff),ServiceUnavailableException);
  await assert.rejects(()=>routing.route({...pickup,latitude:NaN},dropoff),BadRequestException);
});

test('OSRM match accepts a confident multi-fix road and rejects weak or distant matches',()=>{
  const fixes=[{latitude:42,longitude:74,accuracy:8},{latitude:42.0001,longitude:74,accuracy:8},
    {latitude:42.0002,longitude:74,accuracy:8}];
  const tracepoints=fixes.map(fix=>({matchings_index:0,location:[fix.longitude,fix.latitude]}));
  const result=parseOsrmMatch({code:'Ok',tracepoints,matchings:[{confidence:.9}]},fixes);
  assert.ok(result);
  assert.ok(result.bearing!<1||result.bearing!>359);
  assert.equal(parseOsrmMatch({code:'Ok',tracepoints,matchings:[{confidence:.2}]},fixes),null);
  assert.equal(parseOsrmMatch({code:'Ok',tracepoints:[...tracepoints.slice(0,2),{matchings_index:0,location:[74.01,42]}],matchings:[{confidence:.9}]},fixes),null);
});

test('fast reroute constrains start bearing and skips slow road-name lookups',async(t)=>{
  let reverseCalls=0;
  t.mock.method(globalThis,'fetch',async(input:any)=>{
    const url=new URL(input.toString());
    if(url.pathname.includes('/route/v1/driving/')){
      assert.equal(url.searchParams.get('bearings'),'90,45;');
      return Response.json(osrmFixture());
    }
    reverseCalls++;
    return Response.json({});
  });
  const route=await new RoutingService(config).route(pickup,dropoff,12000,'ru',{bearing:90,fast:true});
  assert.equal(route.provider,'osrm');
  assert.equal(reverseCalls,0);
  assert.ok(route.steps.every(step=>step.name===''));
});

test('route names use explicit OSM language tags, never the stale OSRM name',async(t)=>{
  const requests:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:any)=>{
    const url=new URL(input.toString());requests.push(url.pathname);
    if(url.pathname.includes('/route/v1/driving/')) {
      const fixture=osrmFixture();
      fixture.routes[0].legs[0].steps[1].name='Ленин көч';
      return Response.json(fixture);
    }
    assert.equal(url.pathname,'/reverse');
    assert.equal(url.searchParams.get('zoom'),'17');
    assert.equal(url.searchParams.get('namedetails'),'1');
    return Response.json({category:'highway',type:'residential',namedetails:{name:'Ленин көч','name:ru':'улица Ленина','name:ky':'Ленин көчөсү'}});
  });
  const routing=new RoutingService(config);
  const russian=await routing.route(pickup,dropoff,12000,'ru');
  const kyrgyz=await routing.route(pickup,dropoff,12000,'ky');
  assert.equal(russian.steps[1].name,'улица Ленина');
  assert.equal(kyrgyz.steps[1].name,'Ленин көчөсү');
  assert.ok(requests.filter(path=>path==='/reverse').length>=2);
  assert.equal(localizedRoadName({category:'highway',namedetails:{name:'Ленин көч'}},'ru'),'');
  assert.equal(localizedRoadName({category:'building',namedetails:{'name:ru':'улица Ленина'}},'ru'),'');
  assert.equal(localizedRoadName({category:'highway',namedetails:{name:'Другая улица','name:ru':'улица Ленина'}},'ru','Ленин көч'),'');
  assert.equal(localizedRoadName({category:'highway',namedetails:{name:'Ленин көч','name:ru':'улица Ленина'}},'ru','Ленин көч'),'улица Ленина');
});

test('route remains usable without geocoder but never speaks an unverified OSRM street name',async(t)=>{
  t.mock.method(globalThis,'fetch',async(input:any)=>new URL(input.toString()).pathname.includes('/route/v1/driving/')
    ? Response.json(osrmFixture()) : new Response('',{status:503}));
  const route=await new RoutingService(config).route(pickup,dropoff,12000,'ru');
  assert.equal(route.provider,'osrm');
  assert.equal(route.geometry.length,3);
  assert.ok(route.steps.every(step=>step.name===''));
  const foreign=osrmFixture();foreign.routes[0].legs[0].steps[1].name='Ленин көч';
  t.mock.method(globalThis,'fetch',async(input:any)=>new URL(input.toString()).pathname.includes('/route/v1/driving/')
    ? Response.json(foreign) : new Response('',{status:503}));
  const untranslated=await new RoutingService(config).route(pickup,dropoff,12000,'ru');
  assert.equal(untranslated.steps[1].name,'');
});

test('reverse geocoder cannot substitute a different road for the routed segment',async(t)=>{
  t.mock.method(globalThis,'fetch',async(input:any)=>new URL(input.toString()).pathname.includes('/route/v1/driving/')
    ? Response.json(osrmFixture())
    : Response.json({category:'highway',namedetails:{name:'улица Ленина','name:ru':'улица Ленина'}}));
  const route=await new RoutingService(config).route(pickup,dropoff,12000,'ru');
  assert.equal(route.steps[1].name,'');
});

test('Nominatim parser validates coordinates and preserves an OSM identity',()=>{
  assert.deepEqual(parseNominatimPlace(place),{id:'osm-way-123',latitude:42.8756,longitude:74.604,address:place.display_name});
  for(const value of [null,{...place,lat:null},{...place,lat:''},{...place,lon:'181'},{...place,display_name:''}])assert.throws(()=>parseNominatimPlace(value));
});

test('Nominatim shares one paced queue, identifies application, caches and deduplicates',async(t)=>{
  const starts:number[]=[];
  t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{
    starts.push(Date.now());
    const url=new URL(input.toString());assert.equal(init.headers['User-Agent'],config.nominatimUserAgent);
    assert.equal(url.searchParams.get('format'),'jsonv2');
    if(url.pathname==='/search'){assert.equal(url.searchParams.get('q'),'Ала-Тоо');return Response.json([place]);}
    assert.equal(url.searchParams.get('lat'),'42.87560');return Response.json(place);
  });
  const service=new PlacesService(config);
  const [first,duplicate,reverse] = await Promise.all([service.search(' Ала-Тоо '),service.search('Ала-Тоо'),service.reverse(pickup)]);
  assert.deepEqual(first,duplicate);assert.equal(starts.length,2);assert.ok(starts[1]-starts[0]>=990);
  assert.equal(reverse.latitude,pickup.latitude);assert.equal(reverse.longitude,pickup.longitude);
  first[0].address='mutated';assert.equal((await service.search('Ала-Тоо'))[0].address,place.display_name);
  assert.equal(starts.length,2);
});

test('Nominatim prefers the selected language for address and reverse lookup',async(t)=>{
  const languages:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:any)=>{
    const url=new URL(input.toString());languages.push(url.searchParams.get('accept-language')!);
    return Response.json(url.pathname==='/search'?[place]:place);
  });
  const service=new PlacesService({...config,nominatimIntervalMs:0} as AppConfig);
  await service.search('Чүй',undefined,'ky');
  await service.search('Чүй',undefined,'ru');
  await service.reverse({...pickup,language:'ky'});
  assert.deepEqual(languages,['ky,ru,en','ru,ky,en','ky,ru,en']);
});

test('geocoding errors are not cached; unconfigured geocoder returns an explicit error',async(t)=>{
  const fetchMock=t.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}));
  const service=new PlacesService({...config,nominatimIntervalMs:0} as AppConfig);
  await assert.rejects(()=>service.search('Бишкек'),ServiceUnavailableException);
  fetchMock.mock.mockImplementation(async()=>Response.json([place]));
  assert.equal((await service.search('Бишкек')).length,1);
  assert.equal(fetchMock.mock.callCount(),2);
  await assert.rejects(()=>new PlacesService({...config,nominatimBaseUrl:''} as AppConfig).search('Бишкек'),ServiceUnavailableException);
});

test('address search accepts the map center as a viewbox bias without excluding other towns',async(t)=>{
  t.mock.method(globalThis,'fetch',async(input:any)=>{
    const url=new URL(input.toString());
    assert.equal(url.searchParams.get('viewbox'),url.searchParams.get('bounded')==='1'?'72.72,40.59,72.88,40.43':null);
    return Response.json([place]);
  });
  const service=new PlacesService(config);
  assert.equal((await service.search('улица Ленина',{latitude:40.51,longitude:72.80})).length,1);
  await assert.rejects(()=>service.search('улица Ленина',{latitude:91,longitude:72.80}),BadRequestException);
});

test('nearby streets omitted by broad search appear first, with no invented house number or duplicates',async(t)=>{
  const local={...place,osm_id:27339503,lat:'41.2033565',lon:'72.1795757',display_name:'улица Ленина, Шамалды-Сай',addresstype:'road'};
  const distant={...place,osm_id:99,display_name:'10, улица Ленина, Кара-Балта',addresstype:'house'};
  const calls:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:any)=>{
    const url=new URL(input.toString());calls.push(url.searchParams.get('bounded')!);
    return Response.json(url.searchParams.get('bounded')==='1'?[local]:[distant,local]);
  });
  const service=new PlacesService({...config,nominatimIntervalMs:0} as AppConfig);
  const result=await service.search('Ленина 10',{latitude:41.1987,longitude:72.1802});
  assert.deepEqual(calls,['0','1']);assert.equal(result[0].id,'osm-way-27339503');
  assert.equal(result[0].address,'улица Ленина, Шамалды-Сай');assert.equal(result.length,2);
  assert.ok(!('settlement' in result[0]));
});

test('explicit city searches remain global and a missing local street falls back to global results',async(t)=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(input:any)=>{
    calls++;const url=new URL(input.toString());
    if(url.searchParams.get('q')==='Бишкек')return Response.json([{...place,addresstype:'city'}]);
    return Response.json(url.searchParams.get('bounded')==='1'?[]:[place]);
  });
  const service=new PlacesService({...config,nominatimIntervalMs:0} as AppConfig);
  const center={latitude:41.1987,longitude:72.1802};
  assert.equal((await service.search('Бишкек',center)).length,1);assert.equal(calls,1);
  assert.equal((await service.search('Бишкек, Чуй',center)).length,1);assert.equal(calls,3);
});

test('provider config defaults to OSRM and refuses legacy/public/malformed endpoints',()=>{
  const original={...process.env};
  try {
    Object.assign(process.env,{NODE_ENV:'development',DATABASE_URL:'postgresql://test/db',JWT_SECRET:'j'.repeat(40),OTP_SECRET:'o'.repeat(40),SMS_PROVIDER:'development',PUSH_PROVIDER:'development'});
    for(const name of ['ROUTING_PROVIDER','OSRM_BASE_URL','NOMINATIM_BASE_URL','NOMINATIM_USER_AGENT'])delete process.env[name];
    assert.equal(new AppConfig().routingProvider,'osrm');assert.equal(new AppConfig().nominatimBaseUrl,'');
    process.env.ROUTING_PROVIDER='approximation';assert.throws(()=>new AppConfig(),/must be osrm/);process.env.ROUTING_PROVIDER='osrm';
    for(const url of ['file:///secret','https://user:pass@example.test','https://example.test?key=secret']){process.env.OSRM_BASE_URL=url;assert.throws(()=>new AppConfig(),/Invalid OSRM_BASE_URL/);}
    delete process.env.OSRM_BASE_URL;process.env.NOMINATIM_BASE_URL='https://nominatim.openstreetmap.org';assert.throws(()=>new AppConfig(),/dedicated Nominatim/);
  } finally {for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
});
