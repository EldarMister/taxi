import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Actor, AuthGuard } from './auth';
import { PatchRegistrationDto, RegistrationUploadDto, ResubmitRegistrationDto, SubmitRegistrationDto } from './registration.dto';
import { REGISTRATION_CONFIG } from './registration-domain';
import { RegistrationFile, RegistrationService } from './registration';
import { RegistrationUploadGate } from './registration-upload-gate';

type AuthedRequest=Request&{actor:Actor};
const uploadMimes=new Set<string>(REGISTRATION_CONFIG.upload.allowedMimeTypes);

@ApiTags('performer registration')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('driver/registration')
export class RegistrationController {
  constructor(private readonly registration:RegistrationService) {}

  @Get()
  @ApiOperation({summary:'Получить или продолжить анкету текущего исполнителя'})
  current(@Req() req:AuthedRequest) {return this.registration.current(req.actor);}

  @Get('config')
  @ApiOperation({summary:'Получить серверную конфигурацию динамической регистрации'})
  config() {return this.registration.config();}

  @Patch()
  @ApiOperation({summary:'Автосохранить поля анкеты с optimistic version'})
  patch(@Req() req:AuthedRequest,@Body() dto:PatchRegistrationDto) {return this.registration.patch(req.actor,dto);}

  @Post('uploads/:slotKey')
  @ApiConsumes('multipart/form-data')
  @ApiBody({schema:{type:'object',required:['kind','file'],properties:{kind:{type:'string',enum:['PROFILE_PHOTO','IDENTITY_DOCUMENT','DRIVER_LICENSE','VEHICLE_DOCUMENT','VEHICLE_PHOTO','ADDITIONAL_DOCUMENT']},role:{type:'string',enum:['TAXI_DRIVER','CARGO_DRIVER','COURIER']},expiresAt:{type:'string',description:'Срок действия: ДД.ММ.ГГГГ или ISO 8601'},file:{type:'string',format:'binary'}}}})
  @UseInterceptors(RegistrationUploadGate,FileInterceptor('file',{limits:{fileSize:REGISTRATION_CONFIG.upload.maxBytes,files:1,fields:3,fieldNameSize:50,fieldSize:256,parts:5},fileFilter:(_request,file,callback)=>{
    if(!uploadMimes.has(file.mimetype.toLowerCase()))return callback(new BadRequestException('Разрешены только JPEG, PNG, WEBP или PDF'),false);
    callback(null,true);
  }}))
  upload(@Req() req:AuthedRequest,@Param('slotKey') slotKey:string,@Body() dto:RegistrationUploadDto,@UploadedFile() file?:RegistrationFile) {
    return this.registration.upload(req.actor,slotKey,dto,file);
  }

  @Get('uploads/:slotKey')
  async file(@Req() req:AuthedRequest,@Param('slotKey') slotKey:string,@Query('v') version:string|undefined,@Res() response:Response) {
    const file=await this.registration.file(req.actor,slotKey);
    response.setHeader('Content-Type',file.mimeType);
    response.setHeader('Content-Length',String(file.data.length));
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
    response.setHeader('Cache-Control','private, no-store');
    response.setHeader('ETag',`"registration-${file.id}-${file.version}"`);
    return response.send(file.data);
  }

  @Delete('uploads/:slotKey')
  remove(@Req() req:AuthedRequest,@Param('slotKey') slotKey:string) {return this.registration.removeUpload(req.actor,slotKey);}

  @Post('submit')
  submit(@Req() req:AuthedRequest,@Body() dto:SubmitRegistrationDto) {return this.registration.submit(req.actor,dto);}

  @Post('resubmit')
  resubmit(@Req() req:AuthedRequest,@Body() dto:ResubmitRegistrationDto) {return this.registration.resubmit(req.actor,dto);}

  @Post('activate')
  activate(@Req() req:AuthedRequest) {return this.registration.activate(req.actor);}
}
