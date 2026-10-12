import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Actor, AuthGuard } from './auth';
import { AdminAuditService, AdminGuard, assertAdmin } from './admin.security';
import { PrismaService } from './prisma.service';
import { RealtimeEvents } from './events';
import { REGISTRATION_CONFIG } from './registration-domain';

class CityDto {
  @IsString() @MaxLength(100) name!: string;
  @IsIn(['ACTIVE', 'SOON', 'HIDDEN']) status!: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
  @IsOptional() @IsISO8601() updatedAt?: string;
}
type CityRow = { id: string; name: string; aliases: string[]; status: string; sortOrder: number };
export function cityRegistrationConfig(rows: CityRow[]) {
  const active = rows.filter(city => city.status === 'ACTIVE');
  return { ...REGISTRATION_CONFIG, cities: active.map(city => city.name), comingSoonCities: rows.filter(city => city.status === 'SOON').map(city => city.name), workCities: rows.filter(city => city.status !== 'HIDDEN').map(({ id, name, status, sortOrder }) => ({ id, name, status, sortOrder })), acceptedCityNames: active.flatMap(city => [city.name, ...city.aliases]) };
}
@Injectable()
export class CitiesService {
  constructor(private readonly db: PrismaService, private readonly audit: AdminAuditService, private readonly events: RealtimeEvents) {}
  async registrationConfig(db: PrismaService | Prisma.TransactionClient = this.db) {
    return cityRegistrationConfig(await db.serviceCity.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }));
  }
  list(actor: Actor) { assertAdmin(actor); return this.db.serviceCity.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }); }
  async save(actor: Actor, dto: CityDto, id?: string) {
    assertAdmin(actor);
    const name = dto.name.trim().replace(/\s+/g, ' ');
    if (!name || /[\x00-\x1f\x7f]/.test(name)) throw new BadRequestException('Укажите название города');
    const city = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(91008001)`;
      const existing = id ? await tx.serviceCity.findUnique({ where: { id } }) : null;
      if (id && !existing) throw new NotFoundException('Город не найден');
      if (existing && (!dto.updatedAt || existing.updatedAt.getTime() !== new Date(dto.updatedAt).getTime())) throw new ConflictException('Город изменён другим администратором. Обновите список.');
      const rows = await tx.serviceCity.findMany();
      if (rows.some(row => row.id !== id && [row.name, ...row.aliases].some(value => value.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru')))) throw new ConflictException('Город с таким названием уже существует');
      const aliases = existing && existing.name !== name ? [...new Set([...existing.aliases, existing.name])].filter(value => value !== name) : existing?.aliases || [];
      const data = { name, status: dto.status, sortOrder: dto.sortOrder ?? existing?.sortOrder ?? rows.length, aliases };
      const result = existing ? await tx.serviceCity.update({ where: { id }, data }) : await tx.serviceCity.create({ data });
      await this.audit.record(tx, actor, existing ? 'city.update' : 'city.create', 'city', result.id, { name, status: dto.status, ...(existing ? { previousName: existing.name, previousStatus: existing.status } : {}) });
      return result;
    });
    this.events.adminChanged('cities', city.id);
    this.events.contentChanged('cities');
    return city;
  }
}
@UseGuards(AuthGuard, AdminGuard) @Controller('admin/cities')
export class AdminCitiesController {
  constructor(private readonly cities: CitiesService) {}
  @Get() list(@Req() req: { actor: Actor }) { return this.cities.list(req.actor); }
  @Post() create(@Req() req: { actor: Actor }, @Body() dto: CityDto) { return this.cities.save(req.actor, dto); }
  @Patch(':id') update(@Req() req: { actor: Actor }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CityDto) { return this.cities.save(req.actor, dto, id); }
}
