import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsDefined, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const FOOD_STATUSES = ['PLACED','CONFIRMED','PREPARING','READY','DELIVERING','COMPLETED','CANCELLED'] as const;
export type FoodStatus = typeof FOOD_STATUSES[number];
export type FoodFulfillment = 'DELIVERY'|'PICKUP';
export type FoodPayment = 'CASH'|'CARD'|'ONLINE';

export class FoodOrderItemDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) dishId!:string;
  @ApiProperty({minimum:1,maximum:99}) @IsInt() @Min(1) @Max(99) quantity!:number;
  @ApiProperty({type:[String]}) @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsString({each:true}) @MinLength(1,{each:true}) @MaxLength(100,{each:true}) optionIds!:string[];
}
export class FoodDeliveryPointDto {
  @IsNumber() @Min(-90) @Max(90) latitude!:number;
  @IsNumber() @Min(-180) @Max(180) longitude!:number;
  @IsOptional() @IsString() @MaxLength(300) address?:string;
}
export class CreateFoodOrderDto {
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(100) requestId!:string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) restaurantId!:string;
  @ApiProperty({type:[FoodOrderItemDto]}) @IsDefined() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({each:true}) @Type(()=>FoodOrderItemDto) items!:FoodOrderItemDto[];
  @ApiProperty({enum:['DELIVERY','PICKUP']}) @IsIn(['DELIVERY','PICKUP']) fulfillment!:FoodFulfillment;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) address?:string;
  @IsOptional() @ValidateNested() @Type(()=>FoodDeliveryPointDto) deliveryPoint?:FoodDeliveryPointDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) comment?:string;
  @ApiProperty({enum:['CASH','CARD','ONLINE']}) @IsIn(['CASH','CARD','ONLINE']) paymentMethod!:FoodPayment;
}
export class CreateFoodOrderBatchDto {
  @ApiProperty({type:[CreateFoodOrderDto],minItems:1,maxItems:10}) @IsDefined() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({each:true}) @Type(()=>CreateFoodOrderDto) orders!:CreateFoodOrderDto[];
}
export class FoodStatusDto {
  @ApiProperty({enum:FOOD_STATUSES}) @IsIn(FOOD_STATUSES) status!:FoodStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?:string;
}
