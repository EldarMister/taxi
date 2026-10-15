import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNominatimPlace, PlacesService } from '../src/places';
import { parsePhotonPlace, PhotonSearch } from '../src/photon';
import type { AppConfig } from '../src/config';

const address = {road:'улица Ленина',house_number:'39',city:'Шамалды-Сай',county:'Ноокенский район',state:'Джалал-Абадская область'};
const nominatim = {osm_type:'way',osm_id:1,lat:'41.2',lon:'72.18',display_name:'Глобус, улица Ленина, 39, Шамалды-Сай',name:'Глобус',address};
const photon = {type:'Feature',geometry:{type:'Point',coordinates:[72.18,41.2]},properties:{osm_type:'W',osm_id:1,name:'Глобус',street:address.road,housenumber:'39',city:address.city,district:address.county,state:address.state}};
const cases = [
  ['shop','supermarket','supermarket'],['shop','convenience','shop'],['office','company','office'],
  ['amenity','school','school'],['amenity','kindergarten','kindergarten'],['amenity','hospital','hospital'],
  ['amenity','clinic','hospital'],['amenity','pharmacy','pharmacy'],['leisure','stadium','stadium'],
  ['building','apartments','home'],['building','yes','building'],['tourism','hotel','hotel'],
  ['amenity','restaurant','restaurant'],['amenity','cafe','cafe'],['amenity','bank','bank'],
  ['leisure','park','park'],['highway','bus_stop','transport'],['highway','residential',undefined],
] as const;

test('both providers expose the same category without leaking district or region labels', () => {
  for (const [key,value,category] of cases) {
    const first = parseNominatimPlace({...nominatim,category:key,type:value});
    const second = parsePhotonPlace({...photon,properties:{...photon.properties,osm_key:key,osm_value:value}});
    assert.equal(first.category,category,`${key}=${value}: Nominatim`);
    assert.equal(second.category,category,`${key}=${value}: Photon`);
    assert.doesNotMatch(first.address,/район|область/u);
    assert.doesNotMatch(second.address,/район|область/u);
  }
  assert.equal(parseNominatimPlace({...nominatim,class:'amenity',type:'pharmacy'}).category,'pharmacy');
  assert.equal(parseNominatimPlace(nominatim).category,undefined);
  assert.equal(parsePhotonPlace(photon).category,undefined);
});

test('search caches and reverse output preserve category and the selected coordinate', async t => {
  t.mock.method(globalThis,'fetch',async input => new URL(String(input)).pathname === '/api'
    ? Response.json({type:'FeatureCollection',features:[{...photon,properties:{...photon.properties,osm_key:'shop',osm_value:'supermarket'}}]})
    : Response.json(new URL(String(input)).pathname === '/search' ? [{...nominatim,category:'shop',type:'supermarket'}] : {...nominatim,category:'shop',type:'supermarket'}));
  const service = new PlacesService({nominatimBaseUrl:'https://geo.example',nominatimIntervalMs:0,nominatimUserAgent:'test'} as AppConfig);
  assert.equal((await service.search('Глобус'))[0].category,'supermarket');
  assert.equal((await service.search('Глобус'))[0].category,'supermarket');
  const reverse = await service.reverse({latitude:41.201,longitude:72.181});
  assert.equal(reverse.category,'supermarket');
  assert.equal(reverse.latitude,41.201);
  assert.equal(reverse.longitude,72.181);
  const search = new PhotonSearch('https://photon.example');
  assert.equal((await search.search('Глобус',reverse))[0].category,'supermarket');
  assert.equal((await search.search('Глобус',reverse))[0].category,'supermarket');
});
