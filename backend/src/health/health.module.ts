import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth';
import { LockService } from '../common/lock.service';
import { SupabaseService } from '../common/supabase.service';

export interface HealthReport {
  status: 'ok' | 'degraded';
  redis: boolean;
  database: boolean;
  uptime: number;
}

/** Healthy only when both Redis and the database answer. */
export function buildHealthReport(redis: boolean, database: boolean, uptimeSeconds: number): HealthReport {
  return { status: redis && database ? 'ok' : 'degraded', redis, database, uptime: Math.round(uptimeSeconds) };
}

@ApiTags('health')
@Controller('health')
@SkipThrottle()
class HealthController {
  constructor(
    private readonly locks: LockService,
    private readonly supabase: SupabaseService,
  ) {}

  /** Readiness: Redis and Supabase (PostgREST + migrated schema) must answer. */
  @Public()
  @Get()
  async check() {
    const redis = await this.locks.ping().catch(() => false);
    const database = !(await this.supabase.from('profiles').select('id', { head: true, count: 'exact' }).limit(1)).error;
    const report = buildHealthReport(redis, database, process.uptime());
    if (report.status !== 'ok') throw new ServiceUnavailableException(report);
    return report;
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
