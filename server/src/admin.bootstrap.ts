import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashAdminPassword } from './admin.security';

// Supply one JSON object through stdin; credentials never enter argv or stdout.
// {"username":"...","password":"...","name":"..."}
async function main() {
  let input='';
  for await (const chunk of process.stdin) {
    input+=chunk.toString();if(input.length>4096)throw new Error('Input exceeds 4096 bytes');
  }
  const value=JSON.parse(input) as {username?:unknown;password?:unknown;name?:unknown};
  if(typeof value.username!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value.username))throw new Error('Username must contain 3–64 letters, digits, dots, dashes or underscores');
  if(typeof value.password!=='string')throw new Error('Password is required');
  const username=value.username.toLowerCase(),passwordHash=await hashAdminPassword(value.password),name=typeof value.name==='string'?value.name.trim().slice(0,100):'Администратор';
  const db=new PrismaClient();
  try {
    await db.$transaction(async tx=>{
      // Serialize bootstrap/reset with concurrent owner provisioning and login.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'admin-bootstrap:'+username}))`;
      const old=await tx.adminCredential.findUnique({where:{username}});
      if(old)await tx.$queryRaw`SELECT "userId" FROM "AdminCredential" WHERE "userId"=${old.userId}::uuid FOR UPDATE`;
      const user=old?await tx.user.update({where:{id:old.userId},data:{name,role:'ADMIN'}}):await tx.user.create({data:{phone:`admin:${username}`,name,role:'ADMIN'}});
      await tx.adminCredential.upsert({where:{userId:user.id},create:{userId:user.id,username,passwordHash},update:{passwordHash,disabled:false}});
      await tx.refreshSession.updateMany({where:{userId:user.id,revokedAt:null},data:{revokedAt:new Date()}});
      await tx.adminAudit.create({data:{actorId:user.id,action:old?'admin.password-reset':'admin.bootstrap',entity:'admin',entityId:user.id}});
    });
    process.stdout.write('Administrator account is ready. Existing sessions have been revoked.\n');
  } finally {await db.$disconnect();}
}
main().catch(()=>{process.stderr.write('Administrator setup failed. Check the input format, database configuration and applied migrations.\n');process.exitCode=1;});
