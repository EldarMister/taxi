import { ServiceUnavailableException } from '@nestjs/common';
import type { Place } from './places';

const clean = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g,' ').slice(0,250) : '';
const nameKey=(text:string)=>text.toLocaleLowerCase('ru').replace(/^город\s+|^г\.\s*/u,'').replace(/[^\p{L}\p{N}]/gu,'').replace(/ё/g,'е');
function closeCityName(query:string,name:string) {
  const a=nameKey(query),b=nameKey(name);
  if(a===b)return true;
  if(a.length>=4&&a.length/b.length>=.6&&b.startsWith(a))return true;
  if(a.length<5||Math.abs(a.length-b.length)>1)return false;
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}
  return row[b.length]<=1;
}

export function parsePhotonPlace(value: unknown): Place {
  const feature=value as {type?:unknown;geometry?:{type?:unknown;coordinates?:unknown};properties?:Record<string,unknown>} | null;
  const coordinates=feature?.geometry?.coordinates;
  const p=feature?.properties;
  if(feature?.type!=='Feature'||feature.geometry?.type!=='Point'||!Array.isArray(coordinates)||coordinates.length<2||!p)throw new Error('Invalid Photon feature');
  const [longitude,latitude]=coordinates;
  if(typeof longitude!=='number'||typeof latitude!=='number'||!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90)throw new Error('Invalid Photon coordinates');
  const type:Record<string,string>={N:'node',W:'way',R:'relation'};
  const osmType=type[String(p.osm_type)];
  if(!osmType||!/^\d+$/.test(String(p.osm_id)))throw new Error('Invalid Photon identity');
  const name=clean(p.name),street=clean(p.street),house=clean(p.housenumber);
  const parts=[name,street,house,clean(p.locality),clean(p.district),clean(p.city),clean(p.county),clean(p.state),clean(p.country)];
  const seen=new Set<string>();
  const address=parts.filter(part=>{const key=part.toLocaleLowerCase('ru');if(!part||seen.has(key))return false;seen.add(key);return true;}).join(', ').slice(0,250);
  if(!name&&!street&&!house)throw new Error('Photon result has no address');
  return {id:`osm-${osmType}-${p.osm_id}`,address,latitude,longitude};
}

/** Dedicated autocomplete engine. No public-Nominatim pacing or serial queue. */
export class PhotonSearch {
  private readonly cache=new Map<string,{expires:number;places:Place[]}>();
  private readonly pending=new Map<string,Promise<Place[]>>();
  constructor(private readonly baseUrl:string) {}
  async search(query:string,center:{latitude:number;longitude:number},language:'ru'|'ky'='ru'):Promise<Place[]> {
    const q=query.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
    const url=new URL(`${this.baseUrl}/api`);
    url.search=new URLSearchParams({q,lang:language,limit:'8',countrycode:'KG',lat:center.latitude.toFixed(3),lon:center.longitude.toFixed(3),zoom:'14',location_bias_scale:'0.1'}).toString();
    const key=url.toString();
    const cached=this.cache.get(key);
    if(cached&&cached.expires>Date.now())return cached.places.map(p=>({...p}));
    this.cache.delete(key);
    const existing=this.pending.get(key);
    if(existing)return (await existing).map(p=>({...p}));
    if(this.pending.size>=32)throw new ServiceUnavailableException('Поиск адресов занят. Повторите через несколько секунд.');
    const request=(async()=>{
      try{
        const bbox=[Math.max(-180,center.longitude-.08),Math.max(-90,center.latitude-.08),Math.min(180,center.longitude+.08),Math.min(90,center.latitude+.08)].map(v=>v.toFixed(3)).join(',');
        const get=async(text:string,local:boolean)=>{
          const target=new URL(`${this.baseUrl}/api`);
          target.search=new URLSearchParams({q:text,lang:language,limit:'8',countrycode:'KG',...(local?{bbox,lat:center.latitude.toFixed(3),lon:center.longitude.toFixed(3),zoom:'14',location_bias_scale:'0.1'}:{})}).toString();
          const response=await fetch(target,{signal:AbortSignal.timeout(2500),redirect:'error',headers:{Accept:'application/json'}});
          if(!response.ok)throw new Error('Photon unavailable');
          const body=await response.json() as {type?:unknown;features?:unknown};
          if(body.type!=='FeatureCollection'||!Array.isArray(body.features))throw new Error('Invalid Photon response');
          return body.features.slice(0,8).map(feature=>({place:parsePhotonPlace(feature),name:clean(feature.properties?.name),kind:clean(feature.properties?.type)}));
        };
        // Exact global names can suppress fuzzy nearby matches in Photon too.
        // Search both scopes concurrently, without Nominatim's paced queue.
        const [localResult,globalResult]=await Promise.allSettled([get(q,true),get(q,false)]);
        if(localResult.status==='rejected'&&globalResult.status==='rejected')throw new Error('Photon unavailable');
        let nearby=localResult.status==='fulfilled'?localResult.value:[];
        const wider=globalResult.status==='fulfilled'?globalResult.value:[];
        const city=wider.filter(p=>p.kind==='city'&&closeCityName(q,p.name));
        // When a house has not been mapped, offer the actual local street.
        // Do not copy the requested number into the returned address.
        const streetQuery=q.replace(/\s+(?:д(?:ом)?\.?\s*)?\d+[\p{L}]?(?:[/-]\d+[\p{L}]?)?$/u,'').trim();
        if(!nearby.length&&!city.length&&streetQuery!==q&&streetQuery.replace(/\b(?:street|road)\b|улица|ул\.|дом/gu,'').trim().length>=2){
          try{nearby=(await get(streetQuery,true)).filter(p=>p.kind==='street');}catch{/* Keep any valid full-address results. */}
        }
        const unique=new Map<string,Place>();
        for(const {place} of [...city,...nearby,...wider])if(!unique.has(place.id))unique.set(place.id,place);
        const places=[...unique.values()].slice(0,8);
        if(this.cache.size>=500)this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key,{expires:Date.now()+(places.length?600000:15000),places});
        return places;
      }catch{throw new ServiceUnavailableException('Не удалось найти адрес. Попробуйте снова.');}
    })();
    this.pending.set(key,request);
    try{return (await request).map(p=>({...p}));}finally{this.pending.delete(key);}
  }
}
