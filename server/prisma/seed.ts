import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const db=new PrismaClient();
async function main() {
  if(process.env.NODE_ENV!=='development') throw new Error('Demo seed is allowed only in NODE_ENV=development');
  await db.tariff.upsert({where:{id:'economy'},create:{id:'economy',name:'Эконом',description:'Быстро и доступно',basePrice:60,pricePerKm:14,pricePerMinute:2,minimumPrice:100,commissionBps:1000},update:{}});
  await db.tariff.upsert({where:{id:'comfort'},create:{id:'comfort',name:'Комфорт',description:'Больше места и комфорта',basePrice:90,pricePerKm:19,pricePerMinute:3,minimumPrice:150,commissionBps:1000},update:{}});
  await db.user.upsert({where:{phone:'+996700123456'},create:{phone:'+996700123456',name:'Айдана',role:'CLIENT'},update:{}});
  await db.user.upsert({where:{phone:'+996700999999'},create:{phone:'+996700999999',name:'Администратор',role:'ADMIN'},update:{}});
  for(const data of [{phone:'+996700111111',name:'Азамат',make:'Toyota Camry',color:'Белый',plate:'01 KG 777 AAA',latitude:42.8756,longitude:74.6040},{phone:'+996700222222',name:'Бакыт',make:'Hyundai Sonata',color:'Серебристый',plate:'01 KG 888 BBB',latitude:42.8742,longitude:74.6015}]) {
    await db.$transaction(async tx=>{
      const user=await tx.user.upsert({where:{phone:data.phone},create:{phone:data.phone,name:data.name,role:'DRIVER'},update:{}});
      await tx.driverProfile.upsert({where:{userId:user.id},create:{userId:user.id,verified:true,deposit:1000},update:{}});
      await tx.vehicle.upsert({where:{driverId:user.id},create:{driverId:user.id,make:data.make,color:data.color,plate:data.plate},update:{}});
      await tx.ledgerEntry.upsert({where:{idempotencyKey:`seed:${user.id}`},create:{driverId:user.id,kind:'TOPUP',amount:1000,balanceAfter:1000,idempotencyKey:`seed:${user.id}`,note:'Тестовое пополнение депозита'},update:{}});
    }, {timeout: 15000});
  }
  console.log('Demo data ready. Client +996700123456; drivers +996700111111 / +996700222222; admin +996700999999. Use DEV_OTP_CODE after requesting SMS.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.$disconnect());
