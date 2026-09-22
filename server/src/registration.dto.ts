import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PERFORMER_ROLES, REGISTRATION_UPLOAD_KINDS, PerformerRoleValue, RegistrationData, RegistrationUploadKindValue } from './registration-domain';

export class PatchRegistrationDto {
  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[A-Z][A-Z0-9_]*$/)
  currentStep?:string;

  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsIn(PERFORMER_ROLES,{each:true})
  roles?:PerformerRoleValue[];

  @IsOptional() @IsObject()
  data?:RegistrationData;

  @IsInt() @Min(0) @Max(2_147_483_647)
  version!:number;
}

export class RegistrationUploadDto {
  @IsString() @IsIn(REGISTRATION_UPLOAD_KINDS)
  kind!:RegistrationUploadKindValue;

  @IsOptional() @IsString() @IsIn(PERFORMER_ROLES)
  role?:PerformerRoleValue;

  @IsOptional() @IsString() @MaxLength(40) @Matches(/^(?:\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?)$/)
  expiresAt?:string;
}

export class SubmitRegistrationDto {
  @IsBoolean()
  truthConfirmed!:boolean;

  @IsBoolean()
  termsAccepted!:boolean;

  @IsString() @MaxLength(80)
  legalTermsVersion!:string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(32) @ArrayUnique() @IsString({each:true}) @MaxLength(80,{each:true}) @Matches(/^[a-z0-9][a-z0-9-]*$/,{each:true})
  acceptedConsentIds!:string[];
}

export class ResubmitRegistrationDto extends SubmitRegistrationDto {}

export class AdminRegistrationApplicationsDto {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100000)
  page=1;

  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100)
  pageSize=25;

  @IsOptional() @IsString() @MaxLength(100)
  search='';

  @IsOptional() @IsIn(['NOT_STARTED','DRAFT','SUBMITTED','UNDER_REVIEW','CORRECTION_REQUIRED','APPROVED','REJECTED','BLOCKED'])
  status?:'NOT_STARTED'|'DRAFT'|'SUBMITTED'|'UNDER_REVIEW'|'CORRECTION_REQUIRED'|'APPROVED'|'REJECTED'|'BLOCKED';

  @IsOptional() @IsIn(PERFORMER_ROLES)
  role?:PerformerRoleValue;
}

export class AdminStartRegistrationReviewDto {
  @IsInt() @Min(0) @Max(2_147_483_647)
  expectedVersion!:number;
}

export class AdminRegistrationRoleReviewDto extends AdminStartRegistrationReviewDto {
  @IsIn(['APPROVED','CORRECTION_REQUIRED','REJECTED','BLOCKED'])
  status!:'APPROVED'|'CORRECTION_REQUIRED'|'REJECTED'|'BLOCKED';

  @IsOptional() @IsString() @Matches(/^[A-Z0-9_:-]+$/) @MaxLength(80)
  reasonCode?:string;

  @IsOptional() @IsString() @MaxLength(500)
  reasonText?:string;

  @IsOptional() @IsBoolean()
  canResubmit?:boolean;

  @IsOptional() @IsArray() @ArrayUnique() @IsString({each:true}) @Matches(/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/,{each:true}) @MaxLength(120,{each:true})
  correctionFields?:string[];

  @IsOptional() @IsISO8601({strict:true})
  blockedUntil?:string;
}

export class AdminRegistrationUploadReviewDto extends AdminStartRegistrationReviewDto {
  @IsIn(['APPROVED','CORRECTION_REQUIRED','REJECTED','BLOCKED'])
  status!:'APPROVED'|'CORRECTION_REQUIRED'|'REJECTED'|'BLOCKED';

  @IsOptional() @IsString() @Matches(/^[A-Z0-9_:-]+$/) @MaxLength(80)
  reasonCode?:string;

  @IsOptional() @IsString() @MaxLength(500)
  reasonText?:string;

  @IsOptional() @IsBoolean()
  canReupload?:boolean;

  @IsOptional() @IsString() @MaxLength(40) @Matches(/^(?:\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?)$/)
  expiresAt?:string;
}
