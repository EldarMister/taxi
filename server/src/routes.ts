import { BadRequestException, Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Actor, AuthGuard, RateLimits } from './auth';
import { MatchTraceDto, RoadFeaturesDto, RouteDto } from './dto';
import { haversine } from './domain';
import { RoadFeaturesService } from './road-features';
import { RoutingService } from './routing';

@ApiTags('routes') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('routes')
export class RoutesController {
  constructor(private readonly routing: RoutingService, private readonly limits: RateLimits, private readonly roadFeatures: RoadFeaturesService) {}
  @Post() @ApiOperation({summary:'Автомобильный маршрут OSRM с манёврами для навигации'})
  async route(@Body() dto: RouteDto, @Req() req: {actor: Actor}) {
    await this.limits.take(`routes:${req.actor.id}`, 30, 60);
    return this.routing.route(dto.pickup, dto.dropoff, 12000, dto.language ?? 'ru',
      { bearing: dto.bearing, fast: dto.fast });
  }
  @Post('match') @ApiOperation({summary:'Привязка короткого GPS трека водителя к дорожной сети OSRM'})
  async match(@Body() dto: MatchTraceDto, @Req() req: {actor: Actor}) {
    if (req.actor.role !== 'DRIVER') throw new ForbiddenException('Только водитель может сверять GPS трек');
    await this.limits.take(`match:${req.actor.id}`, 12, 60);
    return this.routing.matchTrace(dto.points);
  }
  @Post('road-features') @ApiOperation({summary:'Дорожные знаки и светофоры на ближайшем участке маршрута'})
  async features(@Body() dto: RoadFeaturesDto, @Req() req: {actor: Actor}) {
    if (req.actor.role !== 'DRIVER') throw new ForbiddenException('Дорожные предупреждения доступны водителю');
    await this.limits.take(`road-features:${req.actor.id}`, 20, 60);
    let length = 0;
    for (let index = 1; index < dto.points.length; index++) length += haversine(dto.points[index - 1], dto.points[index]);
    if (length > 1800) throw new BadRequestException('Участок маршрута слишком длинный');
    return { features: this.roadFeatures.along(dto.points, dto.startAlong), generatedAt: this.roadFeatures.generatedAt };
  }
}
