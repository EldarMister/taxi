import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class PhoneDto {
  @ApiProperty({example:'+996700123456'}) @Matches(/^\+[1-9]\d{7,14}$/) phone!:string;
}
export class VerifyDto extends PhoneDto {
  @ApiProperty({example:'123456'}) @Matches(/^\d{6}$/) code!:string;
}
export class RefreshDto {
  @ApiProperty() @IsString() @MinLength(40) @MaxLength(200) refreshToken!:string;
}
export class ProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) name?:string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({protocols:['https'],require_protocol:true}) @MaxLength(1000) photoUrl?:string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifications?:boolean;
  @ApiPropertyOptional({enum:['ru','ky']}) @IsOptional() @IsIn(['ru','ky']) language?:string;
}
export class PointDto {
  @ApiProperty({example:42.875}) @IsNumber() @Min(-90) @Max(90) latitude!:number;
  @ApiProperty({example:74.603}) @IsNumber() @Min(-180) @Max(180) longitude!:number;
  @ApiProperty({example:'Площадь Ала-Тоо'}) @IsString() @MinLength(2) @MaxLength(250) address!:string;
}
export class QuoteDto {
  @ApiProperty({type:PointDto}) @IsDefined() @ValidateNested() @Type(()=>PointDto) pickup!:PointDto;
  @ApiProperty({type:PointDto}) @IsDefined() @ValidateNested() @Type(()=>PointDto) dropoff!:PointDto;
  @ApiProperty({example:'economy'}) @IsString() @MaxLength(80) tariffId!:string;
}
export class CreateOrderDto {
  @ApiProperty() @IsUUID() quoteId!:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) comment?:string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(100) idempotencyKey!:string;
}
export class OnlineDto { @ApiProperty() @IsBoolean() online!:boolean; }
export class MessageDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(1000) text!:string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(100) clientMessageId!:string;
}
export class RatingDto { @ApiProperty({minimum:1,maximum:5}) @IsInt() @Min(1) @Max(5) score!:number; }
export class HistoryDto { @ApiPropertyOptional({enum:['today','week','all']}) @IsOptional() @IsIn(['today','week','all']) period:'today'|'week'|'all' = 'all'; }
export class PushTokenDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(4096) token!:string;
  @ApiProperty({enum:['android','ios']}) @IsIn(['android','ios']) platform!:string;
}
export class RemovePushTokenDto { @ApiProperty() @IsString() @MaxLength(4096) token!:string; }
export class TopupDto {
  @ApiProperty() @IsInt() @Min(1) @Max(1000000) amount!:number;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(100) idempotencyKey!:string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(250) note!:string;
}
export class VerifyDriverDto {
  @ApiProperty() @IsBoolean() verified!:boolean;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) carMake!:string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(40) carColor!:string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(20) carPlate!:string;
}
