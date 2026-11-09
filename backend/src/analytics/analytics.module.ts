import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/auth';
import { must, SupabaseService } from '../common/supabase.service';
import { QueueService } from '../jobs/queues';
import { AnalyticsService } from './analytics.service';

class RangeQuery {
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) to?: string;
}

class RecalculateDto {
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('4', { each: true }) ad_ids?: string[];
}

@ApiTags('analytics')
@ApiBearerAuth()
@Controller()
class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly queues: QueueService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.analytics.overview(user.id);
  }

  /** Per-ad dashboard: metrics, daily series, fatigue and breakdowns for the chosen date range. */
  @Get('ads/:id/analytics')
  forAd(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) adId: string, @Query() range: RangeQuery) {
    return this.analytics.adDashboard(user.id, adId, range.from, range.to);
  }

  /** Queue an analytics recalculation (all ads when `ad_ids` is omitted). */
  @Post('analytics/recalculate')
  @HttpCode(202)
  async recalculate(@CurrentUser() user: AuthUser, @Body() body: RecalculateDto) {
    const adIds =
      body.ad_ids ??
      must<{ id: string }[]>(
        await this.supabase.from('ads').select('id').eq('user_id', user.id).order('last_collected_at', { ascending: false }).limit(200),
        'ads',
      ).map((ad) => ad.id);
    await this.queues.enqueueAnalytics({ userId: user.id, adIds });
    return { queued: adIds.length };
  }
}

@Module({ controllers: [AnalyticsController], providers: [AnalyticsService], exports: [AnalyticsService] })
export class AnalyticsModule {}
