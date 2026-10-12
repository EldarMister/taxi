import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { DEMO_FOOD_RESTAURANTS, upgradeLegacyDemoCatalog } from '../src/food-catalog';

// Explicit local development task; it never touches users, tariffs or real menus.
async function main() {
  if(process.env.NODE_ENV!=='development')throw new Error('Food demo seed requires NODE_ENV=development.');
  const host=new URL(process.env.DATABASE_URL??'').hostname;
  if(!['localhost','127.0.0.1','[::1]','::1'].includes(host))throw new Error('Food demo seed is restricted to the local development database.');
  const db=new PrismaClient();
  try {
    for(const [sortOrder,restaurant] of DEMO_FOOD_RESTAURANTS.entries()) {
      const existing=await db.foodRestaurant.findUnique({where:{id:restaurant.id}});
      if(!existing) {
        await db.foodRestaurant.upsert({where:{id:restaurant.id},create:{id:restaurant.id,catalog:restaurant as unknown as Prisma.InputJsonValue,isDemo:true,active:true,sortOrder},update:{}});
        console.log(`${restaurant.id}: demo menu available`);
        continue;
      }
      const upgraded=upgradeLegacyDemoCatalog(existing);
      if(!upgraded) { console.log(`${restaurant.id}: existing menu preserved`);continue; }
      const result=await db.foodRestaurant.updateMany({where:{id:restaurant.id,isDemo:true,updatedAt:existing.updatedAt},data:{catalog:upgraded as unknown as Prisma.InputJsonValue}});
      console.log(`${restaurant.id}: ${result.count?'legacy demo upgraded':'concurrent changes preserved'}`);
    }
  } finally { await db.$disconnect(); }
}

main().catch(error=>{console.error(error instanceof Error?error.message:'Food demo seed failed.');process.exitCode=1;});
