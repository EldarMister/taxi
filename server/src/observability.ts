import {Controller,Get,UseGuards} from '@nestjs/common';
import {Request,Response,NextFunction} from 'express';
import {randomUUID} from 'node:crypto';
import {AuthGuard} from './auth';
import {AdminGuard} from './admin.security';
type RouteMetric={requests:number;errors:number;statuses:Record<string,number>;samples:number[]};
const routes=new Map<string,RouteMetric>();
const started=Date.now();
export function observeRequest(request:Request,response:Response,next:NextFunction){
  const start=performance.now(),requestId=randomUUID();response.setHeader('X-Request-Id',requestId);
  response.once('finish',()=>{
    const route=typeof request.route?.path==='string'?request.route.path:'unmatched';
    const key=`${request.method} ${route}`;
    if(!routes.has(key)&&routes.size<150)routes.set(key,{requests:0,errors:0,statuses:{},samples:[]});
    const metric=routes.get(key),duration=Math.round((performance.now()-start)*100)/100;
    if(metric){metric.requests++;if(response.statusCode>=500)metric.errors++;const status=String(response.statusCode);metric.statuses[status]=(metric.statuses[status]??0)+1;metric.samples.push(duration);if(metric.samples.length>2048)metric.samples.shift();}
    const sample=Number(process.env.REQUEST_LOG_SAMPLE??'0.01');
    if(response.statusCode>=400||Math.random()<Math.max(0,Math.min(1,Number.isFinite(sample)?sample:0.01)))process.stdout.write(JSON.stringify({type:'http',requestId,method:request.method,route,status:response.statusCode,durationMs:duration})+'\n');
  });next();
}
export function applicationMetrics(){
  const quantile=(values:number[],p:number)=>values.length?values[Math.min(values.length-1,Math.ceil(values.length*p)-1)]:null;
  return {uptimeSeconds:Math.floor((Date.now()-started)/1000),memory:process.memoryUsage(),cpu:process.cpuUsage(),routes:[...routes].map(([route,metric])=>{const samples=[...metric.samples].sort((a,b)=>a-b);return {route,requests:metric.requests,errors:metric.errors,statuses:metric.statuses,p50Ms:quantile(samples,0.5),p95Ms:quantile(samples,0.95),p99Ms:quantile(samples,0.99),windowSamples:samples.length};})};
}
@Controller('admin/metrics') @UseGuards(AuthGuard,AdminGuard)
export class MetricsController {@Get() read(){return applicationMetrics();}}
