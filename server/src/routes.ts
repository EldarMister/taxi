import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';
import { Actor, AuthGuard, RateLimits } from './auth';
import { MatchTraceDto, RoadFeaturesDto, RouteDto } from './dto';
import { haversine } from './domain';
import { legacyRoadFeatures, RoadFeaturesService } from './road-features';
import { RoutingService } from './routing';

class MapFeaturesQuery {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) south!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) west!: number;
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) north!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) east!: number;
}

@ApiTags('routes') @ApiBearerAuth() @UseGuards(AuthGuard) @Controller('routes')
export class RoutesController {
  constructor(private readonly routing: RoutingService, private readonly limits: RateLimits, private readonly roadFeatures: RoadFeaturesService) {}
  @Get('map-features') @ApiOperation({summary:'Пешеходные переходы и самостоятельные светофоры в видимой области карты'})
  async mapFeatures(@Query() query: MapFeaturesQuery, @Req() req: {actor: Actor}, @Headers('x-atlas-capabilities') capabilities?: string) {
    await this.limits.take(`map-features:${req.actor.id}`, 60, 60);
    if (query.south >= query.north || query.west >= query.east
      || query.north - query.south > .06 || query.east - query.west > .08)
      throw new BadRequestException('Слишком большая область карты');
    const features = await this.roadFeatures.currentMapFeatures(query);
    return { features: capabilities?.split(/[,\s]+/).includes('road-features-v2') ? features
      : features.filter(feature => feature.kind === 'traffic_light' || feature.kind === 'pedestrian_crossing'), generatedAt: this.roadFeatures.generatedAt, sourceTimestamp: this.roadFeatures.sourceTimestamp };
  }
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
  async features(@Body() dto: RoadFeaturesDto, @Req() req: {actor: Actor}, @Headers('x-atlas-capabilities') capabilities?: string) {
    if (req.actor.role !== 'DRIVER') throw new ForbiddenException('Дорожные предупреждения доступны водителю');
    await this.limits.take(`road-features:${req.actor.id}`, 20, 60);
    let length = 0;
    for (let index = 1; index < dto.points.length; index++) length += haversine(dto.points[index - 1], dto.points[index]);
    if (length > 1800) throw new BadRequestException('Участок маршрута слишком длинный');
    const features = await this.roadFeatures.currentAlong(dto.points, dto.startAlong);
    return { features: capabilities?.split(/[,\s]+/).includes('road-features-v2') ? features : legacyRoadFeatures(features), generatedAt: this.roadFeatures.generatedAt };
  }
}
