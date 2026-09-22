import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Prisma, RegistrationApplicationStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { Actor, AuthService } from './auth';
import { ACTIVE_STATUSES } from './domain';
import { RealtimeEvents } from './events';
import { ACTIVE_FOOD_STATUSES } from './food-domain';
import { PrismaService } from './prisma.service';
import { PatchRegistrationDto, RegistrationUploadDto, ResubmitRegistrationDto, SubmitRegistrationDto } from './registration.dto';
import {
  ADDITIONAL_VEHICLE_CLIENT_ID_PATTERN, PerformerRoleValue, REGISTRATION_CONFIG, RegistrationData, aggregateRegistrationRoleStates, assertSafeRegistrationData, correctableRegistrationRoles,
  emptyRegistrationData, mergeRegistrationData, parseRegistrationExpiryDate, redactRegistrationData, registrationProjectionIssueText, registrationSteps, registrationUploadCanExpire, registrationUploadExpiryOverrides, registrationUploadsWithEffectiveExpiry, registrationUploadSlotSpec, stableJson, stripClientUploadState,
  validateRegistrationConsents, validateRegistrationDataValues, validateRegistrationSubmission,
} from './registration-domain';

const editableStatuses:RegistrationApplicationStatus[]=['NOT_STARTED','DRAFT','CORRECTION_REQUIRED','REJECTED'];
const allowedUploadMimes=new Set<string>(REGISTRATION_CONFIG.upload.allowedMimeTypes);
const registrationApplicationInclude={
  roles:{orderBy:{createdAt:'asc'}},
  uploads:{select:{id:true,slotKey:true,kind:true,role:true,status:true,mimeType:true,byteSize:true,checksum:true,version:true,expiresAt:true,reasonCode:true,reasonText:true,canReupload:true,createdAt:true,updatedAt:true},orderBy:{createdAt:'asc'}},
} as const satisfies Prisma.PerformerApplicationInclude;
type RegistrationApplicationView=Prisma.PerformerApplicationGetPayload<{include:typeof registrationApplicationInclude}>;
type RegistrationUploadView=RegistrationApplicationView['uploads'][number];
type DatabaseClient=PrismaService|Prisma.TransactionClient;
export type RegistrationFile={buffer:Buffer;mimetype:string;size:number};

export function detectRegistrationMime(data:Uint8Array):string|null {
  if(data.length>=5&&Buffer.from(data.subarray(0,5)).toString('ascii')==='%PDF-')return 'application/pdf';
  if(data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return 'image/jpeg';
  if(data.length>=8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index)=>data[index]===value))return 'image/png';
  if(data.length>=12&&data[0]===0x52&&data[1]===0x49&&data[2]===0x46&&data[3]===0x46&&data[8]===0x57&&data[9]===0x45&&data[10]===0x42&&data[11]===0x50)return 'image/webp';
  return null;
}

function registrationError(message:string,fieldErrors?:unknown) {
  return new BadRequestException({statusCode:400,code:'REGISTRATION_INVALID',message,...(fieldErrors?{fieldErrors}:{})});
}
@Injectable()
export class RegistrationService {
  constructor(private readonly db:PrismaService,private readonly auth:AuthService,private readonly events:RealtimeEvents) {}

  config() {return REGISTRATION_CONFIG;}

  async current(actor:Actor) {
    this.assertPerformer(actor);
    const application=await this.db.performerApplication.findUnique({where:{userId:actor.id},include:registrationApplicationInclude});
    return {application:application?this.serialize(application):null,config:REGISTRATION_CONFIG};
  }

  async patch(actor:Actor,dto:PatchRegistrationDto) {
    this.assertPerformer(actor);
    if(dto.currentStep===undefined&&dto.roles===undefined&&dto.data===undefined)throw registrationError('Нет изменений для сохранения');
    const application=await this.db.$transaction(async tx=>{
      const existing=await this.ensureApplication(tx,actor.id);
      await tx.$queryRaw`SELECT "id" FROM "PerformerApplication" WHERE "id"=${existing.id}::uuid FOR UPDATE`;
      const current=await tx.performerApplication.findUniqueOrThrow({where:{id:existing.id},include:registrationApplicationInclude});
      if(!editableStatuses.includes(current.status))throw new ConflictException('Анкета сейчас недоступна для редактирования');
      if(current.status==='REJECTED'&&!current.canResubmit)throw new ForbiddenException('Повторная подача этой анкеты недоступна');

      const selected=current.roles.filter(item=>item.selected).map(item=>item.role as PerformerRoleValue);
      const nextRoles=dto.roles??selected;
      const sameRoles=[...selected].sort().join('|')===[...nextRoles].sort().join('|');
      if(dto.roles&&!sameRoles&&current.status!=='NOT_STARTED'&&current.status!=='DRAFT')throw new ConflictException('После отправки можно исправлять данные выбранных направлений, но нельзя менять состав направлений');
      const currentData=stripClientUploadState((current.data&&typeof current.data==='object'&&!Array.isArray(current.data)?current.data:{}) as RegistrationData);
      const nextData=dto.data?mergeRegistrationData(currentData,stripClientUploadState(dto.data)):currentData;
      try {assertSafeRegistrationData(nextData);} catch(error) {
        if(error instanceof Error&&error.message.startsWith('PAYMENT_'))throw registrationError('Передавайте только тип платёжного способа и последние четыре цифры');
        throw registrationError('Некорректная структура данных анкеты');
      }
      const valueErrors=validateRegistrationDataValues(nextData,nextRoles);
      if(valueErrors.length)throw registrationError('Исправьте некорректные значения анкеты',valueErrors);
      this.assertCorrectionScope(current,currentData,nextData);
      if(Buffer.byteLength(stableJson(nextData),'utf8')>256*1024)throw new PayloadTooLargeException('Данные анкеты слишком велики');
      const steps=registrationSteps(nextRoles,nextData);
      const requestedStep=dto.currentStep??current.currentStep;
      const nextStep=steps.includes(requestedStep)?requestedStep:'ROLES';

      const unchanged=sameRoles&&nextStep===current.currentStep&&stableJson(nextData)===stableJson(currentData);
      if(unchanged)return current;
      if(dto.version!==current.version)throw new ConflictException({statusCode:409,code:'REGISTRATION_VERSION_CONFLICT',message:'Анкета была изменена. Обновите данные и повторите попытку.',currentVersion:current.version});

      if(dto.roles) {
        await tx.performerApplicationRole.updateMany({where:{applicationId:current.id,role:{notIn:nextRoles}},data:{selected:false}});
        for(const role of nextRoles)await tx.performerApplicationRole.upsert({
          where:{applicationId_role:{applicationId:current.id,role}},
          create:{applicationId:current.id,role,selected:true,status:'DRAFT'},
          update:{selected:true},
        });
      }
      await tx.performerApplication.update({where:{id:current.id},data:{
        data:nextData as Prisma.InputJsonObject,currentStep:nextStep,version:{increment:1},
        ...(current.status==='NOT_STARTED'?{status:'DRAFT' as const}:{}),
      }});
      return tx.performerApplication.findUniqueOrThrow({where:{id:current.id},include:registrationApplicationInclude});
    });
    return {application:this.serialize(application)};
  }

  async upload(actor:Actor,slotKey:string,dto:RegistrationUploadDto,file:RegistrationFile|undefined) {
    this.assertPerformer(actor);this.assertSlotKey(slotKey);
    if(!file?.buffer?.length)throw registrationError('Выберите файл для загрузки');
    const normalized=await this.validateFile(file),mimeType=normalized.mimeType,bytes=normalized.buffer;
    const checksum=createHash('sha256').update(bytes).digest('hex');
    const upload=await this.db.$transaction(async tx=>{
      const application=await this.ensureApplication(tx,actor.id);
      await tx.$queryRaw`SELECT "id" FROM "PerformerApplication" WHERE "id"=${application.id}::uuid FOR UPDATE`;
      const fresh=await tx.performerApplication.findUniqueOrThrow({where:{id:application.id},include:{roles:true}});
      this.assertEditable(fresh.status,fresh.canResubmit);
      const roles=fresh.roles.filter(item=>item.selected).map(item=>item.role as PerformerRoleValue);
      const data=stripClientUploadState((fresh.data&&typeof fresh.data==='object'&&!Array.isArray(fresh.data)?fresh.data:{}) as RegistrationData);
      const slot=registrationUploadSlotSpec(slotKey,roles,data);
      if(!slot)throw registrationError('Этот слот файла не разрешён для текущей конфигурации анкеты');
      if(dto.kind!==slot.kind||dto.role!==undefined&&dto.role!==slot.role)throw registrationError('Тип или направление файла не соответствует выбранному слоту');
      if(dto.expiresAt&&!registrationUploadCanExpire(slot.kind))throw registrationError('Для фотографии нельзя указывать срок действия');
      if((slot.kind==='PROFILE_PHOTO'||slot.kind==='VEHICLE_PHOTO')&&!mimeType.startsWith('image/'))throw registrationError('Для этого слота требуется фотография');
      const previous=await tx.performerUpload.findUnique({where:{applicationId_slotKey:{applicationId:fresh.id,slotKey}}});
      const expiresAt=dto.expiresAt?parseRegistrationExpiryDate(dto.expiresAt):null;
      if(dto.expiresAt&&!expiresAt)throw registrationError('Укажите корректный срок действия документа');
      if(expiresAt&&expiresAt.getTime()<=Date.now())throw registrationError('Срок действия документа уже истёк');
      // A committed replacement may have reached UPLOADED while its HTTP response
      // was lost. Exact replay is a read-only success even though further changes
      // to that slot remain forbidden until another correction decision.
      if(previous&&previous.checksum===checksum&&previous.mimeType===mimeType&&previous.kind===slot.kind&&(previous.role??null)===slot.role&&(previous.expiresAt?.getTime()??null)===(expiresAt?.getTime()??null)) {
        return tx.performerUpload.findUniqueOrThrow({where:{id:previous.id},select:registrationApplicationInclude.uploads.select});
      }
      if(fresh.status==='CORRECTION_REQUIRED'&&(!previous||!['CORRECTION_REQUIRED','REJECTED','EXPIRED'].includes(previous.status)))throw new ForbiddenException('Можно заменить только файл, отмеченный оператором для исправления');
      if(previous&&['UNDER_REVIEW','APPROVED','ACTIVE','EXPIRING','BLOCKED'].includes(previous.status))throw new ForbiddenException('Сначала оператор должен вернуть этот документ на исправление');
      if(previous&&!previous.canReupload&&['CORRECTION_REQUIRED','REJECTED','EXPIRED'].includes(previous.status))throw new ForbiddenException('Повторная загрузка этого документа недоступна');
      if(!previous&&await tx.performerUpload.count({where:{applicationId:fresh.id}})>=REGISTRATION_CONFIG.upload.maxFiles)throw registrationError('Достигнут лимит количества файлов в анкете');
      const storedBytes=(await tx.performerUpload.aggregate({where:{applicationId:fresh.id},_sum:{byteSize:true}}))._sum.byteSize??0;
      if(storedBytes-(previous?.byteSize??0)+bytes.length>REGISTRATION_CONFIG.upload.maxTotalBytes)throw new PayloadTooLargeException('Общий размер файлов анкеты не должен превышать 256 МБ');
      const stored=await tx.performerUpload.upsert({
        where:{applicationId_slotKey:{applicationId:fresh.id,slotKey}},
        create:{applicationId:fresh.id,slotKey,kind:slot.kind,role:slot.role,mimeType,byteSize:bytes.length,checksum,data:Uint8Array.from(bytes),expiresAt,status:'UPLOADED'},
        update:{kind:slot.kind,role:slot.role,mimeType,byteSize:bytes.length,checksum,data:Uint8Array.from(bytes),expiresAt,status:'UPLOADED',version:{increment:1},reasonCode:null,reasonText:null,canReupload:true},
        select:registrationApplicationInclude.uploads.select,
      });
      if(fresh.status==='NOT_STARTED')await tx.performerApplication.update({where:{id:fresh.id},data:{status:'DRAFT'}});
      return stored;
    });
    return this.uploadMetadata(upload);
  }

  async removeUpload(actor:Actor,slotKey:string) {
    this.assertPerformer(actor);this.assertSlotKey(slotKey);
    const existing=await this.db.performerApplication.findUnique({where:{userId:actor.id},select:{id:true}});
    if(!existing)return {ok:true,slotKey};
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT "id" FROM "PerformerApplication" WHERE "id"=${existing.id}::uuid FOR UPDATE`;
      const fresh=await tx.performerApplication.findUniqueOrThrow({where:{id:existing.id}});
      this.assertEditable(fresh.status,fresh.canResubmit);
      if(fresh.status==='CORRECTION_REQUIRED'||fresh.status==='REJECTED')throw new ForbiddenException('Исправляемый файл нужно заменить новой загрузкой без предварительного удаления');
      const upload=await tx.performerUpload.findUnique({where:{applicationId_slotKey:{applicationId:fresh.id,slotKey}}});
      if(!upload)return {ok:true,slotKey};
      if(['UNDER_REVIEW','APPROVED','ACTIVE','EXPIRING','BLOCKED'].includes(upload.status))throw new ForbiddenException('Сначала оператор должен вернуть этот документ на исправление');
      if(!upload.canReupload&&['CORRECTION_REQUIRED','REJECTED','EXPIRED'].includes(upload.status))throw new ForbiddenException('Удаление этого документа недоступно');
      await tx.performerUpload.delete({where:{id:upload.id}});
      return {ok:true,slotKey};
    });
  }

  async file(actor:Actor,slotKey:string) {
    this.assertPerformer(actor);this.assertSlotKey(slotKey);
    const upload=await this.db.performerUpload.findFirst({where:{slotKey,application:{userId:actor.id}},select:{id:true,data:true,mimeType:true,byteSize:true,version:true,updatedAt:true}});
    if(!upload)throw new NotFoundException('Файл не найден');
    const data=Buffer.from(upload.data),detected=detectRegistrationMime(data);
    if(!detected||detected!==upload.mimeType||data.length!==upload.byteSize)throw new NotFoundException('Файл не найден');
    return {...upload,data};
  }

  async submit(actor:Actor,dto:SubmitRegistrationDto) {
    this.assertPerformer(actor);
    this.assertConsents(dto);
    return {application:this.serialize(await this.submitLocked(actor.id,false,dto))};
  }

  async resubmit(actor:Actor,dto:ResubmitRegistrationDto) {
    this.assertPerformer(actor);
    this.assertConsents(dto);
    return {application:this.serialize(await this.submitLocked(actor.id,true,dto))};
  }

  async activate(actor:Actor) {
    this.assertPerformer(actor);
    const outcome=await this.db.$transaction(async tx=>{
      const known=await tx.performerApplication.findUnique({where:{userId:actor.id},select:{id:true}});
      if(!known)throw new NotFoundException('Анкета не найдена');
      await tx.$queryRaw`SELECT "id" FROM "PerformerApplication" WHERE "id"=${known.id}::uuid FOR UPDATE`;
      const application=await tx.performerApplication.findUniqueOrThrow({where:{id:known.id},include:{roles:true}});
      const selected=application.roles.filter(role=>role.selected);
      const operational=selected.filter(role=>role.status==='APPROVED'&&role.projectedAt);
      if(!operational.length)throw new ConflictException('Начать работу можно после одобрения и подготовки хотя бы одного направления');
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actor.id}::uuid FOR UPDATE`;
      const user=await tx.user.findUniqueOrThrow({where:{id:actor.id},select:{role:true,driverProfile:{include:{vehicle:true}}}});
      if(user.role==='ADMIN')throw new ForbiddenException('Администратор не может активировать профиль исполнителя');
      const roleChanged=user.role!=='DRIVER';
      if(roleChanged&&(await tx.order.findFirst({where:{clientId:actor.id,status:{in:ACTIVE_STATUSES}},select:{id:true}})||await tx.foodOrder.findFirst({where:{clientId:actor.id,status:{in:ACTIVE_FOOD_STATUSES}},select:{id:true}})))throw new ConflictException('Сначала завершите активный заказ');
      if(!user.driverProfile?.verified)throw new ConflictException('Профиль исполнителя ещё не подготовлен. Обновите статус анкеты.');
      const hasWorkCapability=[user.driverProfile.acceptsEconomy,user.driverProfile.acceptsComfort,user.driverProfile.acceptsDeliveryCar,user.driverProfile.acceptsDeliveryTruck].some(Boolean)||user.driverProfile.courierModes.some(mode=>['FOOT','BICYCLE','E_BICYCLE'].includes(mode));
      if(!hasWorkCapability)throw new ConflictException('Одобренное направление ещё не подготовлено. Обратитесь в поддержку.');
      if(roleChanged)await tx.user.update({where:{id:actor.id},data:{role:'DRIVER'}});
      if(!application.activatedAt) {
        await tx.performerApplication.update({where:{id:application.id},data:{activatedAt:new Date()}});
        await this.enqueuePush(tx,actor.id,'registration:activated',application.id);
      }
      return {applicationId:application.id,changed:roleChanged||!application.activatedAt};
    });
    if(outcome.changed) {
      this.events.adminChanged('drivers',actor.id);
      this.events.publish([actor.id],'registration:activated',{userId:actor.id});
    }
    const [application,user]=await Promise.all([
      this.db.performerApplication.findUniqueOrThrow({where:{id:outcome.applicationId},include:registrationApplicationInclude}),
      this.auth.user(actor.id),
    ]);
    return {application:this.serialize(application),user};
  }

  private async submitLocked(userId:string,resubmit:boolean,consents:SubmitRegistrationDto) {
    return this.db.$transaction(async tx=>{
      const application=await this.ensureApplication(tx,userId);
      await tx.$queryRaw`SELECT "id" FROM "PerformerApplication" WHERE "id"=${application.id}::uuid FOR UPDATE`;
      const current=await tx.performerApplication.findUniqueOrThrow({where:{id:application.id},include:registrationApplicationInclude});
      if(['SUBMITTED','UNDER_REVIEW'].includes(current.status))return current;
      if(resubmit) {
        const correctable=correctableRegistrationRoles(current.roles as {role:PerformerRoleValue;selected:boolean;status:RegistrationApplicationStatus;canResubmit:boolean}[]);
        if(!correctable.length) {
          if(current.status==='APPROVED')return current;
          throw new ForbiddenException('Повторная подача этой анкеты недоступна');
        }
      } else if(current.status!=='DRAFT')throw new ConflictException('Черновик не готов к отправке');

      const roles=current.roles.filter(item=>item.selected).map(item=>item.role as PerformerRoleValue);
      const validationRoles=resubmit?correctableRegistrationRoles(current.roles as {role:PerformerRoleValue;selected:boolean;status:RegistrationApplicationStatus;canResubmit:boolean}[]):roles;
      const data=(current.data&&typeof current.data==='object'&&!Array.isArray(current.data)?current.data:{}) as RegistrationData;
      try {assertSafeRegistrationData(data);} catch {throw registrationError('В анкете можно хранить только тип платёжного способа и последние четыре цифры');}
      const effectiveUploads=registrationUploadsWithEffectiveExpiry(data,current.uploads);
      const fieldErrors=validateRegistrationSubmission({roles:validationRoles,selectedRoles:roles,data,uploads:effectiveUploads});
      if(fieldErrors.length)throw registrationError('Заполните обязательные поля и загрузите документы',fieldErrors);
      const expiryOverrides=registrationUploadExpiryOverrides(data),uploadedSlots=new Set(current.uploads.filter(upload=>upload.status==='UPLOADED').map(upload=>upload.slotKey));
      for(const [slotKey,expiresAt] of Object.entries(expiryOverrides))if(uploadedSlots.has(slotKey))await tx.performerUpload.updateMany({where:{applicationId:current.id,slotKey,status:'UPLOADED'},data:{expiresAt}});
      await tx.performerApplicationRole.updateMany({where:{applicationId:current.id,selected:true,...(resubmit?{OR:[{status:'DRAFT'},{status:'CORRECTION_REQUIRED'},{status:'REJECTED',canResubmit:true}]}:{status:{in:['DRAFT','NOT_STARTED']}})},data:{status:'SUBMITTED',canResubmit:false,correctionFields:[],reasonCode:null,reasonText:null,blockedUntil:null}});
      await tx.performerUpload.updateMany({where:{applicationId:current.id,status:'UPLOADED'},data:{status:'UNDER_REVIEW'}});
      const submittedRoles=await tx.performerApplicationRole.findMany({where:{applicationId:current.id,selected:true},select:{status:true,canResubmit:true}});
      const nextStatus=aggregateRegistrationRoleStates(submittedRoles);
      const acceptedAt=new Date();
      await tx.performerApplication.update({where:{id:current.id},data:{status:nextStatus,canResubmit:false,legalTermsVersion:consents.legalTermsVersion,acceptedConsentIds:consents.acceptedConsentIds,truthConfirmedAt:acceptedAt,termsAcceptedAt:acceptedAt,submittedAt:acceptedAt,reviewedAt:null,version:{increment:1}}});
      await this.enqueuePush(tx,userId,'registration:submitted',current.id,{status:nextStatus,resubmitted:resubmit});
      return tx.performerApplication.findUniqueOrThrow({where:{id:current.id},include:registrationApplicationInclude});
    });
  }

  private async ensureApplication(client:DatabaseClient,userId:string):Promise<RegistrationApplicationView> {
    return client.performerApplication.upsert({
      where:{userId},update:{},create:{userId,data:{}},include:registrationApplicationInclude,
    });
  }

  private async enqueuePush(tx:Prisma.TransactionClient,userId:string,event:string,applicationId:string,payload:Record<string,string|boolean>={}) {
    await tx.pushJob.create({data:{userId,event,orderId:null,payload:{applicationId,...payload}}});
  }

  private serialize(application:RegistrationApplicationView) {
    const roles=application.roles.filter(item=>item.selected).map(item=>item.role as PerformerRoleValue);
    const storedData=stripClientUploadState((application.data&&typeof application.data==='object'&&!Array.isArray(application.data)?application.data:{}) as RegistrationData);
    const data=mergeRegistrationData(emptyRegistrationData(),storedData);
    const steps=registrationSteps(roles,data),currentIndex=steps.indexOf(application.currentStep);
    const uploads=application.uploads.map(item=>this.uploadMetadata(item));
    const publicData=redactRegistrationData(data) as RegistrationData;
    publicData.uploads=Object.fromEntries(uploads.map(item=>[item.slotKey,item]));
    return {
      id:application.id,applicationId:application.id,applicationNumber:`A-${application.id.toUpperCase()}`,
      status:application.status,roles,roleStatuses:application.roles.filter(item=>item.selected).map(item=>({role:item.role,status:item.status,operational:item.status==='APPROVED'&&Boolean(item.projectedAt),projectedAt:item.projectedAt,projectionIssueCode:item.projectionIssueCode,projectionIssueText:registrationProjectionIssueText(item.projectionIssueCode),canResubmit:item.canResubmit,correctionFields:item.correctionFields,reason:item.reasonText,reasonCode:item.reasonCode,reasonText:item.reasonText,blockedUntil:item.blockedUntil})),
      currentStep:application.currentStep==='ROLE_SELECTION'?'ROLES':application.currentStep,version:application.version,data:publicData,uploads,
      flow:{steps,currentIndex:currentIndex<0?0:currentIndex,totalSteps:steps.length},
      canEdit:editableStatuses.includes(application.status)&&(application.status!=='REJECTED'||application.canResubmit),
      canResubmit:application.status==='CORRECTION_REQUIRED'||application.roles.some(item=>item.selected&&(item.status==='CORRECTION_REQUIRED'||item.status==='REJECTED'&&item.canResubmit)),
      canActivate:!application.activatedAt&&application.roles.some(item=>item.selected&&item.status==='APPROVED'&&Boolean(item.projectedAt)),activatedAt:application.activatedAt,
      legalTermsVersion:application.legalTermsVersion,acceptedConsentIds:application.acceptedConsentIds,truthConfirmedAt:application.truthConfirmedAt,termsAcceptedAt:application.termsAcceptedAt,
      reviewEta:REGISTRATION_CONFIG.reviewEta,estimatedReviewTimeText:REGISTRATION_CONFIG.estimatedReviewTimeText,submittedAt:application.submittedAt,reviewedAt:application.reviewedAt,createdAt:application.createdAt,updatedAt:application.updatedAt,
    };
  }

  private uploadMetadata(upload:RegistrationUploadView) {
    const remoteUrl=`/driver/registration/uploads/${encodeURIComponent(upload.slotKey)}?v=${upload.version}`;
    return {id:upload.id,slotKey:upload.slotKey,kind:upload.kind,role:upload.role,status:upload.status,mimeType:upload.mimeType,byteSize:upload.byteSize,expiresAt:upload.expiresAt,reasonCode:upload.reasonCode,reasonText:upload.reasonText,canReupload:upload.canReupload,createdAt:upload.createdAt,updatedAt:upload.updatedAt,url:remoteUrl,remoteUrl};
  }

  private assertPerformer(actor:Actor) {if(actor.role!=='CLIENT'&&actor.role!=='DRIVER')throw new ForbiddenException('Анкета доступна только исполнителю');}
  private assertSlotKey(slotKey:string) {if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(slotKey))throw registrationError('Некорректный идентификатор файла');}
  private assertEditable(status:RegistrationApplicationStatus,canResubmit:boolean) {
    if(!editableStatuses.includes(status))throw new ConflictException('Анкета сейчас недоступна для редактирования');
    if(status==='REJECTED'&&!canResubmit)throw new ForbiddenException('Повторная подача этой анкеты недоступна');
  }
  private assertCorrectionScope(application:RegistrationApplicationView,before:RegistrationData,after:RegistrationData) {
    if(application.status!=='CORRECTION_REQUIRED'&&application.status!=='REJECTED')return;
    const allowed=new Set(application.roles.filter(role=>role.selected&&(role.status==='CORRECTION_REQUIRED'||role.status==='REJECTED'&&role.canResubmit)).flatMap(role=>role.correctionFields).map(field=>this.canonicalCorrectionPath(field,before)));
    const navigation=new Set(['skippedSteps','completedSteps','cameraIntroSeen','agreements']);
    const correctionUploads=new Set(application.uploads.filter(upload=>['CORRECTION_REQUIRED','REJECTED','EXPIRED'].includes(upload.status)&&upload.canReupload).map(upload=>upload.slotKey));
    const beforeExpiries=before.documentExpiries&&typeof before.documentExpiries==='object'&&!Array.isArray(before.documentExpiries)?before.documentExpiries as Record<string,unknown>:{},afterExpiries=after.documentExpiries&&typeof after.documentExpiries==='object'&&!Array.isArray(after.documentExpiries)?after.documentExpiries as Record<string,unknown>:{};
    const changedExpirySlots=[...new Set([...Object.keys(beforeExpiries),...Object.keys(afterExpiries)])].filter(slot=>stableJson(beforeExpiries[slot])!==stableJson(afterExpiries[slot]));
    const denied=this.changedPaths(before,after).filter(path=>{
      if(navigation.has(path.split('.')[0]))return false;
      if(path==='documentExpiries'||path.startsWith('documentExpiries.')) {
        const slot=path==='documentExpiries'?null:path.slice('documentExpiries.'.length);
        const allowedExpiry=(item:string)=>correctionUploads.has(item)||[...allowed].some(candidate=>candidate===`documentExpiries.${item}`||candidate==='documentExpiries');
        return slot?!allowedExpiry(slot):changedExpirySlots.some(item=>!allowedExpiry(item));
      }
      return ![...allowed].some(candidate=>path===candidate||path.startsWith(`${candidate}.`));
    });
    if(denied.length)throw new ForbiddenException({statusCode:403,code:'REGISTRATION_CORRECTION_SCOPE',message:'Можно изменять только поля, отмеченные оператором',fieldErrors:denied.map(field=>({field,code:'READ_ONLY',message:'Поле не возвращено на исправление'}))});
  }
  private changedPaths(before:unknown,after:unknown,prefix=''):string[] {
    if(stableJson(before)===stableJson(after))return [];
    if(prefix==='vehicles'&&Array.isArray(before)&&Array.isArray(after)) {
      const keyed=(items:unknown[])=>{
        const result=new Map<string,unknown>();
        for(const item of items) {
          if(!item||typeof item!=='object'||Array.isArray(item))return null;
          const clientId=typeof (item as Record<string,unknown>).clientId==='string'?(item as Record<string,unknown>).clientId as string:'';
          if(!ADDITIONAL_VEHICLE_CLIENT_ID_PATTERN.test(clientId)||result.has(clientId))return null;
          result.set(clientId,item);
        }
        return result;
      };
      const left=keyed(before),right=keyed(after);
      if(!left||!right)return [prefix];
      return [...new Set([...left.keys(),...right.keys()])].flatMap(clientId=>this.changedPaths(left.get(clientId),right.get(clientId),`${prefix}.${clientId}`));
    }
    const leftRecord=before&&typeof before==='object'&&!Array.isArray(before)?before as Record<string,unknown>:null;
    const rightRecord=after&&typeof after==='object'&&!Array.isArray(after)?after as Record<string,unknown>:null;
    if(leftRecord||rightRecord) {
      const left=leftRecord??{},right=rightRecord??{};
      return [...new Set([...Object.keys(left),...Object.keys(right)])].flatMap(key=>this.changedPaths(left[key],right[key],prefix?`${prefix}.${key}`:key));
    }
    return prefix?[prefix]:[];
  }
  private canonicalCorrectionPath(path:string,data:RegistrationData) {
    const match=path.match(/^vehicles\.(\d+)(\..+)?$/);
    if(!match)return path;
    const vehicle=Array.isArray(data.vehicles)?data.vehicles[Number(match[1])]:null;
    const clientId=vehicle&&typeof vehicle==='object'&&!Array.isArray(vehicle)&&typeof (vehicle as Record<string,unknown>).clientId==='string'?(vehicle as Record<string,unknown>).clientId as string:'';
    return ADDITIONAL_VEHICLE_CLIENT_ID_PATTERN.test(clientId)?`vehicles.${clientId}${match[2]??''}`:path;
  }
  private assertConsents(dto:SubmitRegistrationDto) {
    if(dto.legalTermsVersion!==REGISTRATION_CONFIG.legalTermsVersion)throw new ConflictException({statusCode:409,code:'REGISTRATION_TERMS_CHANGED',message:'Условия работы обновились. Ознакомьтесь с новой версией и подтвердите её.',legalTermsVersion:REGISTRATION_CONFIG.legalTermsVersion});
    const fieldErrors=validateRegistrationConsents(dto);
    if(fieldErrors.length)throw registrationError('Примите обязательные согласия',fieldErrors);
  }
  private async validateFile(file:RegistrationFile) {
    if(file.buffer.length>REGISTRATION_CONFIG.upload.maxBytes)throw new PayloadTooLargeException('Файл должен быть не больше 12 МБ');
    const declared=file.mimetype.toLowerCase(),detected=detectRegistrationMime(file.buffer);
    if(!detected||!allowedUploadMimes.has(detected)||declared!==detected)throw registrationError('Разрешены JPEG, PNG, WEBP и PDF; тип файла должен соответствовать содержимому');
    let buffer=Buffer.from(file.buffer);
    if(detected.startsWith('image/')) {
      try {
        const image=sharp(file.buffer,{failOn:'error',limitInputPixels:40_000_000,sequentialRead:true,animated:false}),metadata=await image.metadata();
        if(!metadata.width||!metadata.height||(metadata.pages??1)>1||metadata.width*metadata.height>40_000_000)throw new Error('invalid-image');
        const oriented=image.rotate();
        buffer=detected==='image/jpeg'?await oriented.jpeg({quality:94,chromaSubsampling:'4:4:4',mozjpeg:true}).toBuffer()
          :detected==='image/png'?await oriented.png({compressionLevel:9,adaptiveFiltering:true}).toBuffer()
          :await oriented.webp({quality:94,smartSubsample:true}).toBuffer();
        if(!buffer.length||buffer.length>REGISTRATION_CONFIG.upload.maxBytes||detectRegistrationMime(buffer)!==detected)throw new Error('invalid-image-output');
      } catch {throw registrationError('Изображение повреждено или имеет слишком большое разрешение');}
    }
    return {mimeType:detected,buffer};
  }
}
