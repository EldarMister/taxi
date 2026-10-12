import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const fixedUtcAliases = new Set(['utc', 'etc/utc', 'gmt', 'etc/gmt', 'gmt0', 'gmt+0', 'gmt-0', 'etc/gmt0', 'etc/gmt+0', 'etc/gmt-0']);
const clockFailure = 'Database clock check failed. Configure the application database and connection role TimeZone to UTC, then restart. No database settings or stored dates were changed.';
export interface DatabaseUtcClock { timezone: string; offsetSeconds: number; }

export function assertDatabaseUtcClock(clock: unknown): asserts clock is DatabaseUtcClock {
  if (!clock || typeof clock !== 'object') throw new Error(clockFailure);
  const { timezone, offsetSeconds } = clock as Record<string, unknown>;
  if (typeof timezone !== 'string' || !fixedUtcAliases.has(timezone.toLowerCase()) || offsetSeconds !== 0) throw new Error(clockFailure);
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    try {
      await this.$connect();
      const clock = await this.$queryRaw<DatabaseUtcClock[]>`SELECT current_setting('TimeZone') AS "timezone", EXTRACT(TIMEZONE FROM CURRENT_TIMESTAMP)::int AS "offsetSeconds"`;
      if (clock.length !== 1) throw new Error(clockFailure);
      assertDatabaseUtcClock(clock[0]);
    } catch {
      await this.$disconnect().catch(() => undefined);
      // Connection and query errors can contain credentials; expose only guidance.
      throw new Error(clockFailure);
    }
  }
  async onModuleDestroy() { await this.$disconnect(); }
}
