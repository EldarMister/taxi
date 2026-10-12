// Only concurrent identical work is shared. Completed results are never cached.
export class SingleFlight<T> {
  private readonly pending=new Map<string,Promise<T>>();
  constructor(private readonly limit=256){}
  run(key:string,work:()=>Promise<T>):Promise<T>{
    const existing=this.pending.get(key);if(existing)return existing.then(value=>structuredClone(value));
    if(this.pending.size>=this.limit)return work();
    const pending=Promise.resolve().then(work);this.pending.set(key,pending);
    void pending.finally(()=>{if(this.pending.get(key)===pending)this.pending.delete(key);}).catch(()=>undefined);
    return pending.then(value=>structuredClone(value));
  }
}
