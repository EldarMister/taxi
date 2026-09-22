import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PerformerRole, Prisma, RegistrationApplicationStatus, RegistrationDocumentStatus, TransportClass } from '@prisma/client';
import { Actor } from './auth';
import { AdminAuditService, assertAdmin } from './admin.security';
import { ACTIVE_STATUSES } from './domain';
import { RealtimeEvents } from './events';
import { ACTIVE_FOOD_STATUSES } from './food-domain';
import { PrismaService } from './prisma.service';
import { AdminRegistrationApplicationsDto, AdminRegistrationRoleReviewDto, AdminRegistrationUploadReviewDto, AdminStartRegistrationReviewDto } from './registration.dto';
import { detectRegistrationMime } from './registration';
import {
  ADDITIONAL_VEHICLE_CLIENT_ID_PATTERN, PerformerRoleValue, RegistrationApplicationStatusValue, RegistrationData, aggregateRegistrationRoleStates,
  REGISTRATION_EXPIRY_WARNING_DAYS, courierTransportModes, parseRegistrationExpiryDate, redactRegistrationData, registrationCapabilityCeiling, registrationDocumentLifecycleStatus,
  registrationExpiryCorrectionFields, registrationProjectionIssueText, registrationRoleStatusAfterUploadDecision, registrationUploadCanExpire, registrationUploadRequiresExpiry,
  performerRoleForVehicleUsage, registrationAdditionalVehicles, registrationUploadSlotSpec, requiredUploadSlotsForRole, requiresDriverLicense, stripClientUploadState,
} from './registration-domain';

const applicationInclude={
  user:{select:{id:true,name:true,phone:true,role:true,createdAt:true}},
  roles:{orderBy:{createdAt:'asc'}},
  uploads:{select:{id:true,slotKey:true,kind:true,role:true,status:true,mimeType:true,byteSize:true,version:true,expiresAt:true,reasonCode:true,reasonText:true,canReupload:true,createdAt:true,updatedAt:true},orderBy:{createdAt:'asc'}},
} as const satisfies Prisma.PerformerApplicationInclude;
type ApplicationView=Prisma.PerformerApplicationGetPayload<{include:typeof applicationInclude}>;
type ReviewRoleStatus='APPROVED'|'CORRECTION_REQUIRED'|'REJECTED'|'BLOCKED';
type ReviewUploadStatus='APPROVED'|'CORRECTION_REQUIRED'|'REJECTED'|'BLOCKED';
type Tx=Prisma.TransactionClient;

const approvedDocumentStatuses=new Set<RegistrationDocumentStatus>(['APPROVED','ACTIVE','EXPIRING']);
const terminalRoundStatuses=new Set<RegistrationApplicationStatus>(['APPROVED','CORRECTION_REQUIRED','REJECTED','BLOCKED']);
const motorCourierModes=new Set(['MOPED','SCOOTER','MOTORCYCLE','CAR','TRUCK','CARGO_CAR']);
const expiryBatchSize=200;

function record(value:unknown):Record<string,unknown>|null {return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}
function text(value:unknown) {return typeof value==='string'?value.trim():'';}
function stringArray(value:unknown) {return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];}
function applicationNumber(id:string) {return `A-${id.toUpperCase()}`;}
function versionConflict(currentVersion:number) {
  return new ConflictException({statusCode:409,code:'REGISTRATION_VERSION_CONFLICT',message:'Анкета уже изменена другим оператором. Обновите данные.',currentVersion});
}
function reviewReason(status:ReviewRoleStatus|ReviewUploadStatus,reasonCode?:string,reasonText?:string) {
  if(status==='APPROVED')return {reasonCode:null,reasonText:null};
  const normalizedText=reasonText?.trim()??'',normalizedCode=reasonCode?.trim()||null;
  if(!normalizedText)throw new BadRequestException('Для исправления, отказа или блокировки укажите причину');
  return {reasonCode:normalizedCode,reasonText:normalizedText};
}
function sameDate(left:Date|null,right:Date|null) {return left?.getTime()===right?.getTime();}

@Injectable()
export class RegistrationAdminService {
  private expiryDeferredCursor:string|null=null;

  constructor(private readonly db:PrismaService,private readonly audit:AdminAuditService,private readonly events:RealtimeEvents) {}

  async list(actor:Actor,query:AdminRegistrationApplicationsDto) {
    assertAdmin(actor);
    const search=query.search.trim(),idSearch=search.replace(/^A-/i,''),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idSearch);
    const where:Prisma.PerformerApplicationWhereInput={
      ...(query.status?{status:query.status}:{}),
      ...(query.role?{roles:{some:{selected:true,role:query.role}}}:{}),
      ...(search?{OR:[{user:{name:{contains:search,mode:'insensitive'}}},{user:{phone:{contains:search}}},...(uuid?[{id:idSearch},{userId:idSearch}]:[])]}:{}),
    };
    const [rows,total]=await this.db.$transaction([
      this.db.performerApplication.findMany({where,skip:(query.page-1)*query.pageSize,take:query.pageSize,orderBy:[{updatedAt:'desc'},{id:'desc'}],select:{id:true,userId:true,status:true,currentStep:true,version:true,activatedAt:true,submittedAt:true,reviewedAt:true,createdAt:true,updatedAt:true,user:{select:{id:true,name:true,phone:true,role:true}},roles:{where:{selected:true},select:{role:true,status:true,projectedAt:true,projectionIssueCode:true,canResubmit:true,reasonCode:true,blockedUntil:true},orderBy:{createdAt:'asc'}},_count:{select:{uploads:true}}}}),
      this.db.performerApplication.count({where}),
    ]);
    return {items:rows.map(row=>({...row,applicationNumber:applicationNumber(row.id),canActivate:!row.activatedAt&&row.roles.some(role=>role.status==='APPROVED'&&Boolean(role.projectedAt)),roles:row.roles.map(role=>({...role,operational:role.status==='APPROVED'&&Boolean(role.projectedAt)})),uploadCount:row._count.uploads,_count:undefined})),total,page:query.page,pageSize:query.pageSize};
  }

  async detail(actor:Actor,id:string) {
    assertAdmin(actor);
    const application=await this.db.performerApplication.findUnique({where:{id},include:applicationInclude});
    if(!application)throw new NotFoundException('Анкета не найдена');
    return this.serialize(application);
  }

  async startReview(actor:Actor,id:string,dto:AdminStartRegistrationReviewDto) {
    assertAdmin(actor);
    const result=await this.db.$transaction(async tx=>{
      const current=await this.lock(tx,id);
      const hasSubmittedRole=current.roles.some(role=>role.selected&&role.status==='SUBMITTED');
      if(current.status==='UNDER_REVIEW'&&!hasSubmittedRole)return {changed:false,userId:current.userId};
      if(dto.expectedVersion!==current.version)throw versionConflict(current.version);
      if(!hasSubmittedRole||!['SUBMITTED','UNDER_REVIEW'].includes(current.status))throw new ConflictException('Начать проверку можно только для отправленной анкеты');
      await tx.performerApplicationRole.updateMany({where:{applicationId:id,selected:true,status:'SUBMITTED'},data:{status:'UNDER_REVIEW'}});
      await tx.performerUpload.updateMany({where:{applicationId:id,status:'UPLOADED'},data:{status:'UNDER_REVIEW'}});
      await tx.performerApplication.update({where:{id},data:{status:'UNDER_REVIEW',reviewedAt:null,version:{increment:1}}});
      await this.enqueuePush(tx,current.userId,'registration:review_started',id,{status:'UNDER_REVIEW'});
      await this.audit.record(tx,actor,'registration.review.start','performer-applications',id,{from:current.status,to:'UNDER_REVIEW'});
      return {changed:true,userId:current.userId};
    });
    if(result.changed)this.changed(id,result.userId);
    return this.detail(actor,id);
  }

  async reviewRole(actor:Actor,id:string,role:PerformerRole,dto:AdminRegistrationRoleReviewDto) {
    assertAdmin(actor);
    const reason=reviewReason(dto.status,dto.reasonCode,dto.reasonText);
    const blockedUntil=dto.status==='BLOCKED'&&dto.blockedUntil?new Date(dto.blockedUntil):null;
    const canResubmit=dto.status==='CORRECTION_REQUIRED'?(dto.canResubmit??true):dto.status==='REJECTED'?(dto.canResubmit??false):false;
    const requestedCorrectionFields=(dto.status==='CORRECTION_REQUIRED'||dto.status==='REJECTED'&&canResubmit)?[...new Set(dto.correctionFields??[])].sort():[];
    if((dto.status==='CORRECTION_REQUIRED'||dto.status==='REJECTED'&&canResubmit)&&!requestedCorrectionFields.length)throw new BadRequestException('Для повторной подачи отметьте хотя бы одно поле анкеты');
    const result=await this.db.$transaction(async tx=>{
      const current=await this.lock(tx,id);
      const target=current.roles.find(item=>item.selected&&item.role===role);
      if(!target)throw new NotFoundException('Выбранное направление не найдено в анкете');
      const data=this.applicationData(current),correctionFields=this.normalizeCorrectionFields(requestedCorrectionFields,data);
      this.assertCorrectionFields(target.role as PerformerRoleValue,correctionFields,data);
      if(target.status===dto.status&&target.reasonCode===reason.reasonCode&&target.reasonText===reason.reasonText&&target.canResubmit===canResubmit&&sameDate(target.blockedUntil,blockedUntil)&&target.correctionFields.join('|')===correctionFields.join('|')) {
        if(dto.status!=='APPROVED')return {changed:false,userId:current.userId,projected:false};
        const projection=await this.syncLegacyProjection(tx,current.id);
        if(!projection.changed)return {changed:false,userId:current.userId,projected:false};
        await tx.performerApplication.update({where:{id:current.id},data:{version:{increment:1}}});
        await this.audit.record(tx,actor,'registration.legacy.project','drivers',current.userId,{applicationId:id,operationalRoles:projection.operationalRoles,retry:true});
        return {changed:true,userId:current.userId,projected:true};
      }
      if(dto.expectedVersion!==current.version)throw versionConflict(current.version);
      if(['NOT_STARTED','DRAFT','SUBMITTED'].includes(current.status)||['NOT_STARTED','DRAFT','SUBMITTED'].includes(target.status))throw new ConflictException('Сначала начните проверку анкеты');
      if(dto.status==='APPROVED')this.assertRoleDocumentsApproved(target.role as PerformerRoleValue,current);
      await tx.performerApplicationRole.update({where:{id:target.id},data:{status:dto.status,canResubmit,correctionFields,...reason,blockedUntil}});
      if(correctionFields.length) {
        const shared=correctionFields.filter(field=>['personal','identity','work','location','payment'].some(prefix=>field===prefix||field.startsWith(`${prefix}.`))||field==='driverLicense'||field.startsWith('driverLicense.'));
        for(const item of current.roles.filter(item=>item.selected&&item.id!==target.id)) {
          const relevant=shared.filter(field=>!field.startsWith('driverLicense')||requiresDriverLicense([item.role as PerformerRoleValue],data));
          if(!relevant.length)continue;
          if(item.status==='BLOCKED'||item.status==='REJECTED'&&!item.canResubmit)throw new ConflictException('Общее поле нельзя вернуть на исправление, пока другое направление заблокировано или окончательно отклонено');
          await tx.performerApplicationRole.update({where:{id:item.id},data:{status:'CORRECTION_REQUIRED',canResubmit:true,correctionFields:[...new Set([...item.correctionFields,...relevant])],reasonCode:reason.reasonCode??'SHARED_FIELD_CORRECTION',reasonText:reason.reasonText,blockedUntil:null}});
        }
      }
      const state=await this.updateAggregate(tx,current.id);
      const projection=await this.syncLegacyProjection(tx,current.id);
      const pushEvent=dto.status==='APPROVED'?'registration:approved':dto.status==='CORRECTION_REQUIRED'?'registration:correction_required':dto.status==='REJECTED'?'registration:rejected':'registration:blocked';
      await this.enqueuePush(tx,current.userId,pushEvent,id,{role,status:dto.status,applicationStatus:state.status,operational:projection.operationalRoles.includes(role),...(reason.reasonCode?{reasonCode:reason.reasonCode}:{})});
      await this.audit.record(tx,actor,'registration.role.decision','performer-applications',id,{role,from:target.status,to:dto.status,reasonCode:reason.reasonCode,canResubmit,correctionFields,applicationStatus:state.status});
      if(projection.changed)await this.audit.record(tx,actor,'registration.legacy.project','drivers',current.userId,{applicationId:id,operationalRoles:projection.operationalRoles});
      return {changed:true,userId:current.userId,projected:projection.changed};
    });
    if(result.changed)this.changed(id,result.userId,result.projected);
    return this.detail(actor,id);
  }

  async reviewUpload(actor:Actor,id:string,uploadId:string,dto:AdminRegistrationUploadReviewDto) {
    assertAdmin(actor);
    const reason=reviewReason(dto.status,dto.reasonCode,dto.reasonText);
    const canReupload=dto.status==='CORRECTION_REQUIRED'?(dto.canReupload??true):dto.status==='REJECTED'?(dto.canReupload??false):dto.status==='BLOCKED'?(dto.canReupload??false):false;
    const result=await this.db.$transaction(async tx=>{
      const current=await this.lock(tx,id);
      const target=current.uploads.find(item=>item.id===uploadId);
      if(!target)throw new NotFoundException('Файл анкеты не найден');
      if(dto.expiresAt&&dto.status!=='APPROVED')throw new BadRequestException('Срок действия можно указать только при одобрении документа');
      if(dto.expiresAt&&!registrationUploadCanExpire(target.kind))throw new BadRequestException('Для фотографии нельзя указывать срок действия');
      const parsedExpiry=dto.expiresAt?parseRegistrationExpiryDate(dto.expiresAt):null;
      if(dto.expiresAt&&!parsedExpiry)throw new BadRequestException('Укажите корректный срок действия');
      const expiresAt=dto.status==='APPROVED'?(parsedExpiry??target.expiresAt):target.expiresAt;
      if(dto.status==='APPROVED'&&registrationUploadRequiresExpiry(target.slotKey)&&!expiresAt)throw new BadRequestException('Для этого документа укажите срок действия');
      if(dto.status==='APPROVED'&&expiresAt&&expiresAt.getTime()<=Date.now())throw new BadRequestException('Нельзя одобрить просроченный документ');
      const storedStatus:RegistrationDocumentStatus=dto.status==='APPROVED'&&expiresAt?(registrationDocumentLifecycleStatus(expiresAt,new Date())??'ACTIVE'):dto.status;
      if(target.status===storedStatus&&target.reasonCode===reason.reasonCode&&target.reasonText===reason.reasonText&&target.canReupload===canReupload&&sameDate(target.expiresAt,expiresAt)) {
        if(dto.status!=='APPROVED')return {changed:false,userId:current.userId,projected:false};
        const projection=await this.syncLegacyProjection(tx,current.id);
        if(!projection.changed)return {changed:false,userId:current.userId,projected:false};
        await tx.performerApplication.update({where:{id:current.id},data:{version:{increment:1}}});
        await this.audit.record(tx,actor,'registration.legacy.project','drivers',current.userId,{applicationId:id,operationalRoles:projection.operationalRoles,retry:true});
        return {changed:true,userId:current.userId,projected:true};
      }
      if(dto.expectedVersion!==current.version)throw versionConflict(current.version);
      if(['NOT_STARTED','DRAFT','SUBMITTED'].includes(current.status)||['NOT_UPLOADED','DRAFT','UPLOADED'].includes(target.status))throw new ConflictException('Сначала начните проверку анкеты');
      await tx.performerUpload.update({where:{id:target.id},data:{status:storedStatus,...reason,canReupload,...(dto.status==='APPROVED'?{expiresAt}:{})}});
      if(dto.status!=='APPROVED') {
        const data=this.applicationData(current),affected=current.roles.filter(item=>item.selected&&(target.role===item.role||requiredUploadSlotsForRole(item.role as PerformerRoleValue,data).includes(target.slotKey)));
        for(const item of affected) {
          const roleStatus=registrationRoleStatusAfterUploadDecision(item,dto.status,canReupload);
          if(!roleStatus)continue;
          await tx.performerApplicationRole.update({where:{id:item.id},data:{status:roleStatus,canResubmit:roleStatus==='CORRECTION_REQUIRED',correctionFields:roleStatus==='CORRECTION_REQUIRED'?item.correctionFields:[],reasonCode:reason.reasonCode??`UPLOAD_${dto.status}`,reasonText:reason.reasonText,blockedUntil:null}});
        }
      }
      const state=await this.updateAggregate(tx,current.id);
      const projection=await this.syncLegacyProjection(tx,current.id);
      const pushEvent=dto.status==='APPROVED'?'registration:document_approved':'registration:correction_required';
      await this.enqueuePush(tx,current.userId,pushEvent,id,{slotKey:target.slotKey,status:storedStatus,applicationStatus:state.status,...(reason.reasonCode?{reasonCode:reason.reasonCode}:{})});
      if(storedStatus==='EXPIRING')await this.enqueuePush(tx,current.userId,'registration:document_expiring',id,{slotKey:target.slotKey,status:storedStatus,applicationStatus:state.status});
      await this.audit.record(tx,actor,'registration.upload.decision','performer-applications',id,{uploadId:target.id,slotKey:target.slotKey,from:target.status,to:storedStatus,reasonCode:reason.reasonCode,canReupload,applicationStatus:state.status});
      if(projection.changed)await this.audit.record(tx,actor,'registration.legacy.project','drivers',current.userId,{applicationId:id,operationalRoles:projection.operationalRoles});
      return {changed:true,userId:current.userId,projected:projection.changed};
    });
    if(result.changed)this.changed(id,result.userId,result.projected);
    return this.detail(actor,id);
  }

  async file(actor:Actor,id:string,uploadId:string) {
    assertAdmin(actor);
    const upload=await this.db.performerUpload.findFirst({where:{id:uploadId,applicationId:id},select:{id:true,data:true,mimeType:true,byteSize:true,version:true,updatedAt:true}});
    if(!upload||upload.data.length!==upload.byteSize)throw new NotFoundException('Файл анкеты не найден');
    const data=Buffer.from(upload.data);
    if(detectRegistrationMime(data)!==upload.mimeType)throw new NotFoundException('Файл анкеты не найден');
    return {...upload,data};
  }

  async processDocumentExpiry(now=new Date()) {
    const warningAt=new Date(now.getTime()+REGISTRATION_EXPIRY_WARNING_DAYS*86400000);
    // Keep due expirations, advance warnings and projection retries in separate
    // queues. Old deferred rows and already-warned documents must never consume
    // the bounded batch used for newly expired documents.
    const [expiredCandidates,warningCandidates]=await Promise.all([
      this.db.performerUpload.findMany({
        where:{status:{in:['APPROVED','ACTIVE','EXPIRING']},expiresAt:{not:null,lte:now}},
        select:{id:true,applicationId:true},orderBy:[{expiresAt:'asc'},{id:'asc'}],take:expiryBatchSize,
      }),
      this.db.performerUpload.findMany({
        where:{status:{in:['APPROVED','ACTIVE']},expiresAt:{gt:now,lte:warningAt}},
        select:{id:true,applicationId:true},orderBy:[{expiresAt:'asc'},{id:'asc'}],take:expiryBatchSize,
      }),
    ]);
    const candidates=[...expiredCandidates,...warningCandidates];
    let changed=0,failed=0;
    for(const candidate of candidates) {
      try {
        const outcome=await this.db.$transaction(async tx=>{
          const current=await this.lock(tx,candidate.applicationId);
          const target=current.uploads.find(upload=>upload.id===candidate.id);
          if(!target?.expiresAt)return {changed:false,reconcile:false,userId:current.userId};
          if(target.status==='EXPIRED')return {changed:false,reconcile:current.roles.some(role=>role.projectionIssueCode==='ACTIVE_WORK_DEFERRED'),userId:current.userId};
          if(!['APPROVED','ACTIVE','EXPIRING'].includes(target.status))return {changed:false,reconcile:false,userId:current.userId};
          const lifecycle=registrationDocumentLifecycleStatus(target.expiresAt,now);
          if(!lifecycle||lifecycle==='ACTIVE'||lifecycle===target.status)return {changed:false,reconcile:false,userId:current.userId};
          if(lifecycle==='EXPIRING') {
            await tx.performerUpload.update({where:{id:target.id},data:{status:'EXPIRING'}});
            await tx.performerApplication.update({where:{id:current.id},data:{version:{increment:1}}});
            await this.enqueuePush(tx,current.userId,'registration:document_expiring',current.id,{slotKey:target.slotKey,status:'EXPIRING',applicationStatus:current.status});
            return {changed:true,reconcile:false,userId:current.userId};
          }

          await tx.performerUpload.update({where:{id:target.id},data:{status:'EXPIRED',canReupload:true,reasonCode:'DOCUMENT_EXPIRED',reasonText:'Срок действия документа истёк'}});
          const data=this.applicationData(current);
          const affected=current.roles.filter(role=>role.selected&&(target.role===role.role||requiredUploadSlotsForRole(role.role as PerformerRoleValue,data).includes(target.slotKey)));
          const expiryCorrectionFields=registrationExpiryCorrectionFields(target.slotKey);
          let roleChanged=false;
          for(const role of affected) {
            const next=registrationRoleStatusAfterUploadDecision(role,'CORRECTION_REQUIRED',true);
            if(!next)continue;
            await tx.performerApplicationRole.update({where:{id:role.id},data:{status:next,canResubmit:true,correctionFields:[...new Set([...role.correctionFields,...expiryCorrectionFields])],reasonCode:'DOCUMENT_EXPIRED',reasonText:'Срок действия документа истёк',blockedUntil:null,projectedAt:null,projectionIssueCode:'ACTIVE_WORK_DEFERRED'}});
            roleChanged=true;
          }
          const courier=record(data.courier),reuse=courier?.useExistingVehicle===true,usage=text(courier?.existingVehicleUsage).toUpperCase();
          if(reuse) {
            const dependency=usage==='TAXI'?'TAXI_DRIVER':usage==='CARGO'?'CARGO_DRIVER':null;
            const freshRoles=await tx.performerApplicationRole.findMany({where:{applicationId:current.id,selected:true},select:{id:true,role:true,status:true,projectedAt:true}});
            const dependencyApproved=Boolean(dependency&&freshRoles.some(role=>role.role===dependency&&role.status==='APPROVED'));
            const courierRole=freshRoles.find(role=>role.role==='COURIER'&&role.status==='APPROVED'&&role.projectedAt);
            if(courierRole&&!dependencyApproved) {
              await tx.performerApplicationRole.update({where:{id:courierRole.id},data:{projectedAt:null,projectionIssueCode:'DEPENDENCY_NOT_APPROVED'}});
              roleChanged=true;
            }
          }
          const state=await this.updateAggregate(tx,current.id);

          // Remove dispatch capabilities in the same committed transaction, even when an
          // active order requires full profile reconciliation to wait until later.
          const profile=await tx.driverProfile.findUnique({where:{userId:current.userId}});
          if(profile?.registrationManaged) {
            const remaining=await tx.performerApplicationRole.findMany({where:{applicationId:current.id,selected:true,status:'APPROVED',projectedAt:{not:null}},select:{role:true}});
            const roles=remaining.map(item=>item.role as PerformerRoleValue),courierModes=roles.includes('COURIER')?profile.courierModes:[];
            const ceiling=registrationCapabilityCeiling(roles,courierModes,profile.transportClass);
            await tx.driverProfile.update({where:{userId:current.userId},data:{...ceiling,courierModes}});
          }
          await this.enqueuePush(tx,current.userId,'registration:document_expired',current.id,{slotKey:target.slotKey,status:'EXPIRED',applicationStatus:state.status,reasonCode:'DOCUMENT_EXPIRED'});
          return {changed:true,reconcile:roleChanged,userId:current.userId};
        });
        if(outcome.changed) {changed++;this.changed(candidate.applicationId,outcome.userId,true);}
      } catch {failed++;}
    }

    // Cycle through retry rows instead of repeatedly selecting the same oldest
    // active jobs. De-duplicate applications because several roles can be
    // deferred by the same upload expiration.
    let deferredRows=await this.deferredProjectionBatch();
    if(!deferredRows.length&&this.expiryDeferredCursor) {
      this.expiryDeferredCursor=null;
      deferredRows=await this.deferredProjectionBatch();
    }
    this.expiryDeferredCursor=deferredRows.length===expiryBatchSize?deferredRows[deferredRows.length-1].id:null;
    for(const applicationId of new Set(deferredRows.map(row=>row.applicationId))) {
      try {if(await this.reconcileDeferredProjection(applicationId))changed++;}
      catch {failed++;}
    }
    return {changed,failed};
  }

  private deferredProjectionBatch() {
    return this.db.performerApplicationRole.findMany({
      where:{projectionIssueCode:'ACTIVE_WORK_DEFERRED',...(this.expiryDeferredCursor?{id:{gt:this.expiryDeferredCursor}}:{})},
      select:{id:true,applicationId:true},orderBy:{id:'asc'},take:expiryBatchSize,
    });
  }

  private async reconcileDeferredProjection(applicationId:string) {
    const outcome=await this.db.$transaction(async tx=>{
      const current=await this.lock(tx,applicationId);
      if(!current.roles.some(role=>role.projectionIssueCode==='ACTIVE_WORK_DEFERRED'))return {changed:false,userId:current.userId};
      if(await this.hasActiveDriverWork(tx,current.userId))return {changed:false,userId:current.userId};
      const projection=await this.syncLegacyProjection(tx,current.id);
      if(projection.changed)await tx.performerApplication.update({where:{id:current.id},data:{version:{increment:1}}});
      return {changed:projection.changed,userId:current.userId};
    });
    if(outcome.changed)this.changed(applicationId,outcome.userId,true);
    return outcome.changed;
  }

  private async lock(tx:Tx,id:string) {
    await tx.$queryRaw`SELECT "id" FROM "PerformerApplication" WHERE "id"=${id}::uuid FOR UPDATE`;
    const application=await tx.performerApplication.findUnique({where:{id},include:applicationInclude});
    if(!application)throw new NotFoundException('Анкета не найдена');
    return application;
  }

  private applicationData(application:ApplicationView):RegistrationData {
    return stripClientUploadState((application.data&&typeof application.data==='object'&&!Array.isArray(application.data)?application.data:{}) as RegistrationData);
  }

  private assertRoleDocumentsApproved(role:PerformerRoleValue,application:ApplicationView) {
    const bySlot=new Map(application.uploads.map(upload=>[upload.slotKey,upload]));
    const missing=requiredUploadSlotsForRole(role,this.applicationData(application)).filter(slot=>{const upload=bySlot.get(slot);return !upload||!approvedDocumentStatuses.has(upload.status)||registrationUploadRequiresExpiry(slot)&&!upload.expiresAt||Boolean(upload.expiresAt&&upload.expiresAt.getTime()<=Date.now());});
    if(missing.length)throw new BadRequestException({statusCode:400,code:'REGISTRATION_DOCUMENTS_NOT_APPROVED',message:'Сначала проверьте все обязательные документы направления',fieldErrors:missing.map(slotKey=>({field:`uploads.${slotKey}`,code:'NOT_APPROVED',message:'Документ ещё не одобрен'}))});
  }

  private assertCorrectionFields(role:PerformerRoleValue,fields:string[],data:RegistrationData) {
    const common=['personal','identity','work','location','payment'],specific=role==='TAXI_DRIVER'?['taxiVehicle']:role==='CARGO_DRIVER'?['cargoVehicle','cargoEquipment']:['courier','courierVehicle'];
    const additional=registrationAdditionalVehicles(data).flatMap(({vehicle})=>{
      if(!vehicle)return [];
      const clientId=text(vehicle.clientId),vehicleRole=performerRoleForVehicleUsage(text(vehicle.usage).toUpperCase());
      return vehicleRole===role&&ADDITIONAL_VEHICLE_CLIENT_ID_PATTERN.test(clientId)?[`vehicles.${clientId}`]:[];
    });
    const allowed=[...common,...specific,...additional,...(role!=='COURIER'||courierTransportModes(data).some(mode=>motorCourierModes.has(mode))?['driverLicense']:[])];
    const invalid=fields.filter(field=>{
      if(allowed.some(prefix=>field===prefix||field.startsWith(`${prefix}.`)))return false;
      const expiry=field.match(/^documentExpiries\.(.+)$/);
      if(!expiry)return true;
      const spec=registrationUploadSlotSpec(expiry[1],[role],data);
      return !spec||spec.role!==role||!registrationUploadRequiresExpiry(spec.slotKey);
    });
    if(invalid.length)throw new BadRequestException({statusCode:400,code:'REGISTRATION_CORRECTION_FIELDS_INVALID',message:'Некоторые поля не относятся к выбранному направлению',fieldErrors:invalid.map(field=>({field,code:'INVALID_SCOPE',message:'Поле нельзя вернуть на исправление для этого направления'}))});
  }

  private normalizeCorrectionFields(fields:string[],data:RegistrationData) {
    return [...new Set(fields.map(field=>{
      const match=field.match(/^vehicles\.(\d+)(\..+)?$/);
      if(!match)return field;
      const vehicle=Array.isArray(data.vehicles)?record(data.vehicles[Number(match[1])]):null,clientId=text(vehicle?.clientId);
      return ADDITIONAL_VEHICLE_CLIENT_ID_PATTERN.test(clientId)?`vehicles.${clientId}${match[2]??''}`:field;
    }))].sort();
  }

  private async updateAggregate(tx:Tx,id:string) {
    const roles=await tx.performerApplicationRole.findMany({where:{applicationId:id,selected:true},select:{status:true,canResubmit:true}});
    const status=aggregateRegistrationRoleStates(roles as {status:RegistrationApplicationStatusValue;canResubmit:boolean}[]);
    const canResubmit=roles.some(role=>role.status==='CORRECTION_REQUIRED'||role.status==='REJECTED'&&role.canResubmit);
    const roundComplete=roles.length>0&&roles.every(role=>terminalRoundStatuses.has(role.status));
    return tx.performerApplication.update({where:{id},data:{status,canResubmit,reviewedAt:roundComplete?new Date():null,version:{increment:1}},select:{status:true,version:true}});
  }

  private async syncLegacyProjection(tx:Tx,applicationId:string) {
    const application=await tx.performerApplication.findUniqueOrThrow({where:{id:applicationId},include:{user:{include:{driverProfile:{include:{vehicle:true}}}},roles:{where:{selected:true}},uploads:{where:{OR:[{slotKey:{in:['profile_photo','taxi_photo_front','cargo_photo_front','courier_photo']}},{kind:'VEHICLE_PHOTO'}]},select:{slotKey:true,status:true,mimeType:true,data:true}}}});
    const data=stripClientUploadState((application.data&&typeof application.data==='object'&&!Array.isArray(application.data)?application.data:{}) as RegistrationData);
    const modes=courierTransportModes(data),approved=application.roles.filter(item=>item.status==='APPROVED'),approvedRoles=new Set(approved.map(item=>item.role as PerformerRoleValue));
    const previouslyProjected=application.roles.some(item=>Boolean(item.projectedAt));
    const user=application.user;
    if(user.role==='ADMIN')throw new ConflictException('Администратора нельзя зарегистрировать исполнителем');

    if(!approved.length) {
      const projectionChanged=application.roles.some(item=>item.projectedAt||item.projectionIssueCode);
      if(projectionChanged)await tx.performerApplicationRole.updateMany({where:{applicationId},data:{projectedAt:null,projectionIssueCode:null}});
      let profileChanged=false;
      if(user.driverProfile?.registrationManaged)profileChanged=await this.revokeLegacy(tx,user.id);
      else if(previouslyProjected&&user.driverProfile?.courierModes.length) {
        if(user.role==='DRIVER')await this.assertNoActiveDriverWork(tx,user.id);
        await tx.driverProfile.update({where:{userId:user.id},data:{courierModes:[],online:false,locationLatitude:null,locationLongitude:null,locationAccuracyM:null,locationMeasuredAt:null}});
        profileChanged=true;
      }
      return {changed:projectionChanged||profileChanged,operationalRoles:[] as PerformerRoleValue[]};
    }

    const courier=record(data.courier),courierMotor=modes.some(mode=>motorCourierModes.has(mode)),reuse=courier?.useExistingVehicle===true,usage=text(courier?.existingVehicleUsage).toUpperCase(),reuseClientId=text(courier?.existingVehicleClientId);
    type Candidate={role:PerformerRoleValue;vehicle:{make:string;color:string;plate:string;transportClass:TransportClass;photoSlot:string}};
    const candidates:Candidate[]=[];
    for(const item of approved) {
      const role=item.role as PerformerRoleValue;
      if(role==='COURIER'&&!courierMotor)continue;
      if(role==='COURIER'&&reuse) {
        const dependency=usage==='TAXI'?'TAXI_DRIVER':usage==='CARGO'?'CARGO_DRIVER':null;
        if(!dependency||!approvedRoles.has(dependency))continue;
        const vehicle=this.vehicleCandidate(dependency,data,modes,reuseClientId||undefined);
        if(vehicle)candidates.push({role,vehicle});
        continue;
      }
      const vehicle=this.vehicleCandidate(role,data,modes);
      if(vehicle)candidates.push({role,vehicle});
    }

    const profile=user.driverProfile,unmanagedProfile=Boolean(profile?.verified&&!profile.registrationManaged),matchingProfile=profile?.vehicle?candidates.find(item=>item.vehicle.plate===profile.vehicle!.plate.trim().toUpperCase()&&item.vehicle.transportClass===profile.transportClass):undefined;
    const ordered=[...candidates].sort((left,right)=>['TAXI_DRIVER','CARGO_DRIVER','COURIER'].indexOf(left.role)-['TAXI_DRIVER','CARGO_DRIVER','COURIER'].indexOf(right.role));
    let primary:Candidate|undefined=matchingProfile??ordered[0];
    const unmanagedConflict=Boolean(primary&&profile?.verified&&profile.vehicle&&!profile.registrationManaged&&!matchingProfile);
    if(unmanagedConflict)primary=undefined;
    const operational=new Set<PerformerRoleValue>();
    if(approvedRoles.has('COURIER')&&!courierMotor)operational.add('COURIER');
    if(primary)for(const candidate of candidates)if(candidate.vehicle.plate===primary.vehicle.plate&&candidate.vehicle.transportClass===primary.vehicle.transportClass&&(!unmanagedProfile||this.profileSupportsRole(profile!,candidate.role,candidate.vehicle.transportClass)))operational.add(candidate.role);

    const now=new Date();
    let projectionChanged=false;
    for(const item of application.roles) {
      const role=item.role as PerformerRoleValue,isOperational=item.status==='APPROVED'&&operational.has(role);
      let issue:string|null=null;
      if(item.status==='APPROVED'&&!isOperational) {
        if(role==='COURIER'&&reuse&&(!['TAXI','CARGO'].includes(usage)||!approvedRoles.has(usage==='TAXI'?'TAXI_DRIVER':'CARGO_DRIVER')))issue='DEPENDENCY_NOT_APPROVED';
        else if(unmanagedConflict)issue='LEGACY_PROFILE_CONFLICT';
        else if(unmanagedProfile&&primary&&candidates.some(candidate=>candidate.role===role&&candidate.vehicle.plate===primary!.vehicle.plate&&candidate.vehicle.transportClass===primary!.vehicle.transportClass))issue='LEGACY_PROFILE_CAPABILITY_CONFLICT';
        else if(!candidates.some(candidate=>candidate.role===role))issue='MISSING_VEHICLE_DATA';
        else issue='LEGACY_SINGLE_VEHICLE_LIMIT';
      }
      const projectedAt=isOperational?(item.projectedAt??now):null;
      if(!sameDate(item.projectedAt,projectedAt)||item.projectionIssueCode!==issue) {
        await tx.performerApplicationRole.update({where:{id:item.id},data:{projectedAt,projectionIssueCode:issue}});
        projectionChanged=true;
      }
    }

    const personal=record(data.personal),name=[text(personal?.firstName),text(personal?.lastName)].filter(Boolean).join(' ')||user.name;
    const avatar=application.uploads.find(item=>item.slotKey==='profile_photo'&&approvedDocumentStatuses.has(item.status)&&item.mimeType.startsWith('image/'));
    const avatarChanged=Boolean(avatar&&(user.avatarMime!==avatar!.mimeType||!user.avatarData||!Buffer.from(user.avatarData).equals(Buffer.from(avatar!.data))));
    const identityChanged=Boolean(name&&name!==user.name)||avatarChanged;
    if(identityChanged)await tx.user.update({where:{id:user.id},data:{...(name&&name!==user.name?{name}:{}),...(avatarChanged?{avatarData:avatar!.data,avatarMime:avatar!.mimeType,avatarUpdatedAt:new Date()}:{})}});
    if(!operational.size) {
      const profileChanged=profile?.registrationManaged?await this.revokeLegacy(tx,user.id):false;
      return {changed:projectionChanged||profileChanged||identityChanged,operationalRoles:[] as PerformerRoleValue[]};
    }

    if(unmanagedProfile)return {changed:projectionChanged||identityChanged,operationalRoles:[...operational]};

    const primaryRole=primary?.role??'COURIER',transportClass=primary?.vehicle.transportClass??profile?.transportClass??'ECONOMY';
    const finalCapabilities=this.capabilities(primaryRole,transportClass,modes,operational,data),courierModes=operational.has('COURIER')?modes:[];
    const sameModes=Boolean(profile)&&[...profile!.courierModes].sort().join('|')===[...courierModes].sort().join('|');
    const vehiclePhoto=primary?application.uploads.find(item=>item.slotKey===primary!.vehicle.photoSlot&&approvedDocumentStatuses.has(item.status)&&item.mimeType.startsWith('image/')):undefined;
    const samePhoto=!vehiclePhoto||Boolean(profile?.vehicle?.photoData&&profile.vehicle.photoMime===vehiclePhoto.mimeType&&Buffer.from(profile.vehicle.photoData).equals(Buffer.from(vehiclePhoto.data)));
    const sameVehicle=!primary||Boolean(profile?.vehicle&&profile.vehicle.plate.trim().toUpperCase()===primary.vehicle.plate&&profile.transportClass===transportClass&&profile.vehicle.make===primary.vehicle.make&&profile.vehicle.color===primary.vehicle.color&&samePhoto);
    const profileReady=Boolean(profile?.verified&&profile.registrationManaged&&profile.transportClass===transportClass&&sameModes&&sameVehicle
      &&profile.acceptsEconomy===finalCapabilities.acceptsEconomy&&profile.acceptsComfort===finalCapabilities.acceptsComfort
      &&profile.acceptsDeliveryCar===finalCapabilities.acceptsDeliveryCar&&profile.acceptsDeliveryTruck===finalCapabilities.acceptsDeliveryTruck);
    if(profileReady)return {changed:projectionChanged||identityChanged,operationalRoles:[...operational]};
    if(user.role==='DRIVER')await this.assertNoActiveDriverWork(tx,user.id);
    if(primary) {
      const expected=primary.vehicle,duplicate=await tx.vehicle.findFirst({where:{plate:expected.plate,driverId:{not:user.id}},select:{id:true}});
      if(duplicate)throw new ConflictException('Автомобиль с таким государственным номером уже зарегистрирован');
      await tx.driverProfile.upsert({where:{userId:user.id},create:{userId:user.id,verified:true,online:false,transportClass,requestedTransportClass:null,...finalCapabilities,courierModes,registrationManaged:true},update:{verified:true,online:false,transportClass,requestedTransportClass:null,...finalCapabilities,courierModes,registrationManaged:true,locationLatitude:null,locationLongitude:null,locationAccuracyM:null,locationMeasuredAt:null}});
      await tx.vehicle.upsert({where:{driverId:user.id},create:{driverId:user.id,make:expected.make,color:expected.color,plate:expected.plate,...(vehiclePhoto?{photoData:vehiclePhoto.data,photoMime:vehiclePhoto.mimeType,photoUpdatedAt:new Date()}:{})},update:{make:expected.make,color:expected.color,plate:expected.plate,...(vehiclePhoto?{photoData:vehiclePhoto.data,photoMime:vehiclePhoto.mimeType,photoUpdatedAt:new Date()}:{})}});
    } else {
      await tx.driverProfile.upsert({where:{userId:user.id},create:{userId:user.id,verified:true,online:false,transportClass,requestedTransportClass:null,...finalCapabilities,courierModes,registrationManaged:true},update:{verified:true,online:false,...finalCapabilities,courierModes,registrationManaged:true,locationLatitude:null,locationLongitude:null,locationAccuracyM:null,locationMeasuredAt:null}});
    }
    return {changed:true,operationalRoles:[...operational]};
  }

  private async revokeLegacy(tx:Tx,userId:string) {
    await this.assertNoActiveDriverWork(tx,userId);
    const result=await tx.driverProfile.updateMany({where:{userId,registrationManaged:true},data:{verified:false,online:false,acceptsEconomy:false,acceptsComfort:false,acceptsDeliveryCar:false,acceptsDeliveryTruck:false,courierModes:[],locationLatitude:null,locationLongitude:null,locationAccuracyM:null,locationMeasuredAt:null}});
    return result.count>0;
  }

  private profileSupportsRole(profile:{acceptsEconomy:boolean;acceptsComfort:boolean;acceptsDeliveryCar:boolean;acceptsDeliveryTruck:boolean},role:PerformerRoleValue,transportClass:TransportClass) {
    if(role==='TAXI_DRIVER')return transportClass==='COMFORT'?profile.acceptsComfort:transportClass!=='TRUCK'&&profile.acceptsEconomy;
    if(role==='CARGO_DRIVER')return transportClass==='TRUCK'&&profile.acceptsDeliveryTruck;
    return transportClass==='TRUCK'?profile.acceptsDeliveryTruck:profile.acceptsDeliveryCar;
  }

  private async assertNoActiveDriverWork(tx:Tx,userId:string) {
    if(await this.hasActiveDriverWork(tx,userId))throw new ConflictException('Сначала завершите активный заказ исполнителя');
  }

  private async hasActiveDriverWork(tx:Tx,userId:string) {
    return Boolean(await tx.order.findFirst({where:{driverId:userId,status:{in:ACTIVE_STATUSES}},select:{id:true}})||await tx.foodOrder.findFirst({where:{clientId:userId,status:{in:ACTIVE_FOOD_STATUSES}},select:{id:true}}));
  }

  private capabilities(role:PerformerRoleValue,transportClass:TransportClass,modes:string[],selected:Set<PerformerRoleValue>,data:RegistrationData) {
    const courier=record(data.courier),usage=text(courier?.existingVehicleUsage).toUpperCase(),usesPrimary=role==='COURIER'||courier?.useExistingVehicle===true&&(role==='TAXI_DRIVER'&&usage==='TAXI'||role==='CARGO_DRIVER'&&usage==='CARGO');
    const courierMotor=selected.has('COURIER')&&usesPrimary&&modes.some(mode=>motorCourierModes.has(mode));
    return {
      acceptsEconomy:selected.has('TAXI_DRIVER')&&role==='TAXI_DRIVER'&&transportClass!=='TRUCK',
      acceptsComfort:selected.has('TAXI_DRIVER')&&role==='TAXI_DRIVER'&&transportClass==='COMFORT',
      acceptsDeliveryCar:courierMotor&&transportClass!=='TRUCK',
      acceptsDeliveryTruck:(selected.has('CARGO_DRIVER')&&role==='CARGO_DRIVER'||courierMotor)&&transportClass==='TRUCK',
    };
  }

  private vehicleCandidate(role:PerformerRoleValue,data:RegistrationData,modes:string[],clientId?:string) {
    const vehicles=Array.isArray(data.vehicles)?data.vehicles.map(record).filter((item):item is Record<string,unknown>=>!!item):[];
    const usage=role==='TAXI_DRIVER'?'TAXI':role==='CARGO_DRIVER'?'CARGO':'COURIER';
    const direct=record(data[role==='TAXI_DRIVER'?'taxiVehicle':role==='CARGO_DRIVER'?'cargoVehicle':'courierVehicle']);
    const vehicle=clientId?vehicles.find(item=>text(item.clientId)===clientId&&text(item.usage).toUpperCase()===usage):direct;
    if(!vehicle)return null;
    const brand=text(vehicle.brand)||text(vehicle.make),model=text(vehicle.model),plate=(text(vehicle.plateNumber)||text(vehicle.plate)).toUpperCase();
    if(!brand||!plate)return null;
    const tariffs=stringArray(vehicle.tariffs),transportClass:TransportClass=role==='CARGO_DRIVER'||role==='COURIER'&&modes.includes('TRUCK')?'TRUCK':role==='TAXI_DRIVER'&&tariffs.some(tariff=>tariff==='COMFORT'||tariff==='BUSINESS')?'COMFORT':'ECONOMY';
    return {make:[brand,model].filter(Boolean).join(' '),color:text(vehicle.color)||'Не указан',plate,transportClass,photoSlot:clientId?`vehicle_${clientId}_photo_front`:role==='TAXI_DRIVER'?'taxi_photo_front':role==='CARGO_DRIVER'?'cargo_photo_front':'courier_photo'};
  }

  private serialize(application:ApplicationView) {
    const data=redactRegistrationData(this.applicationData(application));
    return {
      id:application.id,applicationId:application.id,applicationNumber:applicationNumber(application.id),user:application.user,status:application.status,currentStep:application.currentStep,version:application.version,canResubmit:application.canResubmit,data,
      roles:application.roles.filter(item=>item.selected).map(item=>({id:item.id,role:item.role,status:item.status,operational:item.status==='APPROVED'&&Boolean(item.projectedAt),projectedAt:item.projectedAt,projectionIssueCode:item.projectionIssueCode,projectionIssueText:registrationProjectionIssueText(item.projectionIssueCode),canResubmit:item.canResubmit,correctionFields:item.correctionFields,reasonCode:item.reasonCode,reasonText:item.reasonText,blockedUntil:item.blockedUntil,updatedAt:item.updatedAt})),
      uploads:application.uploads.map(item=>({id:item.id,slotKey:item.slotKey,kind:item.kind,role:item.role,status:item.status,mimeType:item.mimeType,byteSize:item.byteSize,version:item.version,expiresAt:item.expiresAt,reasonCode:item.reasonCode,reasonText:item.reasonText,canReupload:item.canReupload,createdAt:item.createdAt,updatedAt:item.updatedAt,url:`/admin/performer-applications/${application.id}/uploads/${item.id}/file?v=${item.version}`})),
      canActivate:!application.activatedAt&&application.roles.some(item=>item.selected&&item.status==='APPROVED'&&Boolean(item.projectedAt)),activatedAt:application.activatedAt,
      legalTermsVersion:application.legalTermsVersion,acceptedConsentIds:application.acceptedConsentIds,truthConfirmedAt:application.truthConfirmedAt,termsAcceptedAt:application.termsAcceptedAt,submittedAt:application.submittedAt,reviewedAt:application.reviewedAt,createdAt:application.createdAt,updatedAt:application.updatedAt,
    };
  }

  private changed(applicationId:string,userId:string,driverChanged=false) {
    this.events.adminChanged('performer-applications',applicationId);
    this.events.publish([userId],'registration:updated',{applicationId});
    if(driverChanged)this.events.adminChanged('drivers',userId);
  }

  private async enqueuePush(tx:Tx,userId:string,event:string,applicationId:string,payload:Record<string,string|boolean>={}) {
    await tx.pushJob.create({data:{userId,event,orderId:null,payload:{applicationId,...payload}}});
  }
}
