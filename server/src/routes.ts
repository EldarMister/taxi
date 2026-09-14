import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Actor, AuthGuard, RateLimits } from './auth';
import { RouteDto } from './dto';
import { RoutingService } from './routing';

@ApiTags('routes') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('routes')
export class RoutesController {
  constructor(private readonly routing: RoutingService, private readonly limits: RateLimits) {}
  @Post() @ApiOperation({summary:'Автомобильный маршрут OSRM с манёврами для навигации'})
  async route(@Body() dto: RouteDto, @Req() req: {actor: Actor}) {
    await this.limits.take(`routes:${req.actor.id}`, 30, 60);
    return this.routing.route(dto.pickup, dto.dropoff, 12000, dto.language ?? 'ru');
  }
}
