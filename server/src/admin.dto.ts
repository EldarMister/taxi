import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class AdminLoginDto {
  @IsString() @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/) username!:string;
  @IsString() @MinLength(1) @MaxLength(256) password!:string;
}
export class AdminPageDto {
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100000) page=1;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100) pageSize=25;
  @IsOptional() @IsString() @MaxLength(100) search='';
}
export class AdminOrdersDto extends AdminPageDto {
  @IsOptional() @IsIn(['taxi','food']) kind:'taxi'|'food'='taxi';
  @IsOptional() @IsString() @MaxLength(30) status?:string;
}
export class AdminDriversDto extends AdminPageDto {
  @IsOptional() @IsIn(['all','online','offline','unverified']) filter:'all'|'online'|'offline'|'unverified'='all';
}
export class AdminTariffDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9_-]{1,49}$/) id!:string;
  @IsString() @MinLength(1) @MaxLength(80) name!:string;
  @IsString() @MaxLength(400) description!:string;
  @IsInt() @Min(0) @Max(1000000) basePrice!:number;
  @IsInt() @Min(0) @Max(1000000) pricePerKm!:number;
  @IsInt() @Min(0) @Max(1000000) pricePerMinute!:number;
  @IsInt() @Min(0) @Max(1000000) minimumPrice!:number;
  @IsInt() @Min(0) @Max(10000) commissionBps!:number;
  @IsBoolean() active!:boolean;
  @IsIn(['RIDE','DELIVERY_CAR','DELIVERY_TRUCK']) kind:'RIDE'|'DELIVERY_CAR'|'DELIVERY_TRUCK'='RIDE';
  @IsIn(['ECONOMY','COMFORT','TRUCK']) requiredClass:'ECONOMY'|'COMFORT'|'TRUCK'='ECONOMY';
}
export class AdminTariffPatchDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?:string;
  @IsOptional() @IsString() @MaxLength(400) description?:string;
  @IsOptional() @IsInt() @Min(0) @Max(1000000) basePrice?:number;
  @IsOptional() @IsInt() @Min(0) @Max(1000000) pricePerKm?:number;
  @IsOptional() @IsInt() @Min(0) @Max(1000000) pricePerMinute?:number;
  @IsOptional() @IsInt() @Min(0) @Max(1000000) minimumPrice?:number;
  @IsOptional() @IsInt() @Min(0) @Max(10000) commissionBps?:number;
  @IsOptional() @IsBoolean() active?:boolean;
  @IsOptional() @IsIn(['RIDE','DELIVERY_CAR','DELIVERY_TRUCK']) kind?:'RIDE'|'DELIVERY_CAR'|'DELIVERY_TRUCK';
  @IsOptional() @IsIn(['ECONOMY','COMFORT','TRUCK']) requiredClass?:'ECONOMY'|'COMFORT'|'TRUCK';
}
export class AdminDriverDto {
  @Matches(/^\+[1-9]\d{7,14}$/) phone!:string;
  @IsString() @MinLength(1) @MaxLength(100) name!:string;
  @IsString() @MinLength(1) @MaxLength(80) carMake!:string;
  @IsString() @MinLength(1) @MaxLength(40) carColor!:string;
  @IsString() @MinLength(2) @MaxLength(20) carPlate!:string;
  @IsBoolean() verified!:boolean;
  @IsIn(['ECONOMY','COMFORT','TRUCK']) transportClass:'ECONOMY'|'COMFORT'|'TRUCK'='ECONOMY';
}
export class AdminDriverPatchDto {
  @IsOptional() @Matches(/^\+[1-9]\d{7,14}$/) phone?:string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?:string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) carMake?:string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) carColor?:string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(20) carPlate?:string;
  @IsOptional() @IsBoolean() verified?:boolean;
  @IsOptional() @IsIn(['ECONOMY','COMFORT','TRUCK']) transportClass?:'ECONOMY'|'COMFORT'|'TRUCK';
  @IsOptional() @IsIn([false]) online?:false;
}
export class AdminCancelDto {
  @IsString() @MinLength(3) @MaxLength(300) reason!:string;
}
