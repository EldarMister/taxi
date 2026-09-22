import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { PerformerRole } from '@prisma/client';
import { Actor, AuthGuard } from './auth';
import { AdminGuard } from './admin.security';
import { RegistrationAdminService } from './registration-admin';
import { AdminRegistrationApplicationsDto, AdminRegistrationRoleReviewDto, AdminRegistrationUploadReviewDto, AdminStartRegistrationReviewDto } from './registration.dto';

type AdminRequest=Request&{actor:Actor};

@ApiTags('performer registration admin')
@ApiBearerAuth()
@UseGuards(AuthGuard,AdminGuard)
@Controller('admin/performer-applications')
export class RegistrationAdminController {
  constructor(private readonly registration:RegistrationAdminService) {}

  @Get()
  list(@Req() request:AdminRequest,@Query() query:AdminRegistrationApplicationsDto) {return this.registration.list(request.actor,query);}

  @Get(':id/uploads/:uploadId/file')
  async file(@Req() request:AdminRequest,@Param('id',ParseUUIDPipe) id:string,@Param('uploadId',ParseUUIDPipe) uploadId:string,@Res() response:Response) {
    const file=await this.registration.file(request.actor,id,uploadId);
    response.setHeader('Content-Type',file.mimeType);
    response.setHeader('Content-Length',String(file.data.length));
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
    response.setHeader('Cache-Control','private, no-store');
    return response.send(file.data);
  }

  @Get(':id')
  detail(@Req() request:AdminRequest,@Param('id',ParseUUIDPipe) id:string) {return this.registration.detail(request.actor,id);}

  @Post(':id/start-review')
  startReview(@Req() request:AdminRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:AdminStartRegistrationReviewDto) {return this.registration.startReview(request.actor,id,dto);}

  @Patch(':id/roles/:role')
  reviewRole(@Req() request:AdminRequest,@Param('id',ParseUUIDPipe) id:string,@Param('role',new ParseEnumPipe(PerformerRole)) role:PerformerRole,@Body() dto:AdminRegistrationRoleReviewDto) {return this.registration.reviewRole(request.actor,id,role,dto);}

  @Patch(':id/uploads/:uploadId')
  reviewUpload(@Req() request:AdminRequest,@Param('id',ParseUUIDPipe) id:string,@Param('uploadId',ParseUUIDPipe) uploadId:string,@Body() dto:AdminRegistrationUploadReviewDto) {return this.registration.reviewUpload(request.actor,id,uploadId,dto);}
}
