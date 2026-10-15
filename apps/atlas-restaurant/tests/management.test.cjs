const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/features/management/model.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const domainSource=fs.readFileSync(require('node:path').join(__dirname,'../src/domain/types.ts'),'utf8');
const domain={exports:{}};new Function('exports','module',ts.transpileModule(domainSource,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(domain.exports,domain);
const m={exports:{}};new Function('exports','module','require',compiled)(m.exports,m,()=>domain.exports);
const {promotionDate,dateInput,promotionDateValue,positiveNumber,validatePromotion,grantPermission,deliveryFields,saveDeliveryFields,saveProfileFields,initialManagerPermissions,staffEditable,staffInput}=m.exports;
test('promotions retain calendar boundaries in Bishkek independently from device timezone',()=>{
  assert.equal(promotionDate('2026-10-11'),'2026-10-10T18:00:00.000Z');
  assert.equal(promotionDate('2026-10-11',true),'2026-10-11T17:59:59.999Z');
  assert.equal(dateInput(promotionDate('2026-10-11')),'2026-10-11');
  assert.equal(promotionDate(''),null);assert.throws(()=>promotionDate('2026-02-30'));assert.throws(()=>promotionDate('11.10.2026'));
});
test('promotion selection never accidentally broadens an empty selection to all dishes',()=>{
  const p={id:'p',title:'Lunch',type:'PERCENT',value:10,minSubtotal:0,dishIds:[],active:true};
  assert.throws(()=>validatePromotion(p,true));assert.equal(validatePromotion(p,false),p);
  assert.throws(()=>validatePromotion({...p,value:101},false));assert.throws(()=>validatePromotion({...p,value:0},false));
  assert.throws(()=>validatePromotion({...p,startsAt:'2026-10-12',endsAt:'2026-10-11'},false));
  assert.doesNotThrow(()=>validatePromotion({...p,type:'FREE_DELIVERY',value:0},true));
});
test('orders.manage always requires read and revoking read revokes manage',()=>{
  assert.deepEqual(grantPermission([],'orders.manage',true),['orders.manage','orders.read']);
  assert.deepEqual(grantPermission(['menu.manage','orders.read','orders.manage'],'orders.read',false),['menu.manage']);
  assert.deepEqual(grantPermission(['orders.read'],'orders.read',true),['orders.read']);
});
test('delivery and promotion numeric entry rejects missing and nonfinite values',()=>{
  assert.equal(positiveNumber('125','sum'),125);
  for(const value of ['','Infinity','-1','one','1000001','12,5','12.5','1e3','0xff'])assert.throws(()=>positiveNumber(value,'sum'));
});

test('editing promotion labels preserves exact existing start/end instants',()=>{
  const start='2026-10-11T08:15:00.000Z',end='2026-10-11T14:00:00.000Z';
  assert.equal(promotionDateValue(dateInput(start),start),start);
  assert.equal(promotionDateValue(dateInput(end),end,true),end);
  assert.equal(promotionDateValue('2026-10-12',end,true),'2026-10-12T17:59:59.999Z');
  assert.equal(promotionDateValue('',start),null);
});

test('promotion validation matches integer money, title and time bounds',()=>{
  const p={id:'p',title:'Lunch',type:'PERCENT',value:10,minSubtotal:0,dishIds:[],active:true};
  for(const patch of [{value:10.5},{minSubtotal:0.5},{minSubtotal:1000001},{title:'x'.repeat(151)},{type:'FREE_DELIVERY',value:1},{startsAt:'broken'},{startsAt:'2026-10-11T10:00:00Z',endsAt:'2026-10-11T10:00:00Z'}])assert.throws(()=>validatePromotion({...p,...patch},false));
});

const catalog=()=>({id:'r',name:'Kitchen',cuisine:'Local',address:'Street',phone:null,categories:['Local'],latitude:42,longitude:73,imageKey:'r',heroImageKey:'r-hero',imageUrl:'https://example.test/a.jpg',isOpen:true,
  rating:4.9,reviewCount:19,etaMin:20,etaMax:40,deliveryFee:100,minimumOrder:200,freeDeliveryThreshold:1000,dishes:[{id:'dish'}],options:[{id:'o'}],menuCategories:['Lunch'],promotions:[{id:'p'}],isDemo:false});

test('delivery fields enforce server ETA bound and preserve all unrelated catalog data',()=>{
  const original=catalog();const fields=deliveryFields(original);
  const updated=saveDeliveryFields(original,{...fields,deliveryFee:'150',freeDeliveryThreshold:'0',etaMax:'1440'});
  assert.equal(updated.deliveryFee,150);assert.equal(updated.freeDeliveryThreshold,0);assert.equal(updated.etaMax,1440);
  assert.deepEqual(updated.dishes,original.dishes);assert.deepEqual(updated.promotions,original.promotions);assert.equal(updated.name,original.name);
  assert.throws(()=>saveDeliveryFields(original,{...fields,etaMax:'1441'}));
  assert.throws(()=>saveDeliveryFields(original,{...fields,etaMin:'41'}));
});

test('profile saves own fields while retaining latest menu promotions and delivery terms',()=>{
  const old=catalog(),latest={...old,deliveryFee:250,dishes:[{id:'new'}],promotions:[{id:'new-p'}]};
  const next=saveProfileFields(latest,{...old,name:'New kitchen'},'Local, Asian','42,1','73.2');
  assert.equal(next.name,'New kitchen');assert.equal(next.latitude,42.1);assert.equal(next.deliveryFee,250);assert.deepEqual(next.dishes,latest.dishes);assert.deepEqual(next.promotions,latest.promotions);assert.equal(next.rating,4.9);
  const noCoordinates=saveProfileFields(latest,old,'Local','','');assert.equal(noCoordinates.latitude,undefined);assert.equal(noCoordinates.longitude,undefined);
  assert.throws(()=>saveProfileFields(latest,old,'Local, Local','42','73'));
  assert.throws(()=>saveProfileFields(latest,old,'Local','91','73'));
  assert.throws(()=>saveProfileFields(latest,old,'Local','1e1','73'));
  assert.throws(()=>saveProfileFields(latest,{...old,name:'x'.repeat(151)},'Local','42','73'));
});

test('staff manager never receives hidden default grants and cannot edit more privileged coworkers',()=>{
  const member={restaurantId:'r',restaurantName:'R',role:'MANAGER',permissions:['staff.manage']};
  assert.deepEqual(initialManagerPermissions(member),[]);
  const staff={id:'other',name:'Teammate',phone:'+996700000000',role:'MANAGER',permissions:['orders.read'],active:true};
  assert.equal(staffEditable(member,staff,'me'),false);
  assert.equal(staffEditable({...member,role:'OWNER'},staff,'me'),true);
  assert.equal(staffEditable({...member,role:'OWNER'},staff,'other'),false);
  assert.throws(()=>staffInput(staff,staff,'',member));
  assert.deepEqual(staffInput({...staff,permissions:[]},staff,'',member),{permissions:[],active:true});
});

test('staff changes obey credential bounds and omit unchanged global account fields',()=>{
  const member={restaurantId:'r',restaurantName:'R',role:'OWNER',permissions:[]};
  const staff={id:'other',name:'Teammate',phone:'+996700000000',role:'MANAGER',permissions:['orders.read'],active:true};
  assert.deepEqual(staffInput({...staff,active:false},staff,'',member),{permissions:['orders.read'],active:false});
  assert.throws(()=>staffInput(staff,{...staff,id:''},'short',member));
  assert.throws(()=>staffInput(staff,staff,'x'.repeat(257),member));
  assert.throws(()=>staffInput({...staff,permissions:['orders.manage']},staff,'',member));
});
