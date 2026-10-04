import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
export class RestaurantLoginDto {
  @IsString() @MinLength(8) @MaxLength(30) phone!:string;
  @IsString() @MinLength(1) @MaxLength(256) password!:string;
}
export class RestaurantRefreshDto { @IsString() @MinLength(20) @MaxLength(200) refreshToken!:string; }
export class RestaurantAccountInputDto {
  @IsOptional() @IsString() @MaxLength(150) name?:string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(30) phone?:string;
  @IsOptional() @IsString() @MinLength(12) @MaxLength(256) password?:string;
  @IsOptional() @IsBoolean() active?:boolean;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique() @IsString({each:true}) @MaxLength(100,{each:true}) restaurantIds?:string[];
}
export class RestaurantStaffInputDto {
  @IsOptional() @IsString() @MaxLength(150) name?:string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(30) phone?:string;
  @IsOptional() @IsString() @MinLength(12) @MaxLength(256) password?:string;
  @IsOptional() @IsBoolean() active?:boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @ArrayUnique() @IsString({each:true}) permissions?:string[];
}
export class RestaurantCatalogDto {
  @IsObject() catalog!:Record<string,unknown>;
  @IsOptional() @IsString() @MaxLength(50) updatedAt?:string;
}
export class RestaurantPromotionsDto {
  @IsArray() @ArrayMaxSize(30) promotions!:unknown[];
  @IsOptional() @IsString() @MaxLength(50) updatedAt?:string;
}
export class RestaurantOrderActionDto {
  @IsIn(['ACCEPT','PREPARING','READY','COMPLETE','CANCEL']) action!:'ACCEPT'|'PREPARING'|'READY'|'COMPLETE'|'CANCEL';
  @IsOptional() @IsString() @MaxLength(500) reason?:string;
}
export class RestaurantDispatchDto {
  @IsIn(['OWN','ATLAS_CAR']) method!:'OWN'|'ATLAS_CAR';
  @IsOptional() @IsString() @MaxLength(150) courierName?:string;
  @IsOptional() @IsString() @MaxLength(30) courierPhone?:string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) deliveryLat?:number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) deliveryLng?:number;
  @IsOptional() @IsNumber({maxDecimalPlaces:0}) @Min(0) @Max(1_000_000) expectedPrice?:number;
}
