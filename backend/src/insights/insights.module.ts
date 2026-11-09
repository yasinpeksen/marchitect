import { BadRequestException, Body, Controller, Get, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsISO8601, IsUUID } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/auth';
import { must, SupabaseService } from '../common/supabase.service';
import { QueueService } from '../jobs/queues';
import { MetaIntegrationModule } from '../meta/meta.module';
import { CollectionRunsService } from '../search/collection-runs.service';
import { SearchModule } from '../search/search.module';
import { InsightsService } from './insights.service';

class RefreshDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('4', { each: true }) ad_ids: string[];
  @IsISO8601({ strict: true }) date_from: string;
  @IsISO8601({ strict: true }) date_to: string;
}

@ApiTags('insights')
@ApiBearerAuth()
@Controller()
class InsightsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly runs: CollectionRunsService,
    private readonly queues: QueueService,
  ) {}

  /** Historical range snapshots for an ad (one per collection day / range). */
  @Get('ads/:id/snapshots')
  async snapshots(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) adId: string) {
    return must(
      await this.supabase.from('ad_insights').select('*').eq('ad_id', adId).eq('user_id', user.id).order('collected_at', { ascending: false }).limit(60),
      'snapshots',
    );
  }

  /** Re-fetch insights for specific ads over a new date range (async job). */
  @Post('insights/refresh')
  async refresh(@CurrentUser() user: AuthUser, @Body() body: RefreshDto) {
    if (body.date_from > body.date_to) throw new BadRequestException('date_from must be on or before date_to');
    const ads = must<{ id: string; ad_account_id: string }[]>(
      await this.supabase.from('ads').select('id,ad_account_id').eq('user_id', user.id).in('id', body.ad_ids),
      'load ads',
    );
    if (ads.length === 0) throw new BadRequestException('No matching ads');
    if (new Set(ads.map((ad) => ad.ad_account_id)).size > 1) throw new BadRequestException('Refresh ads from one ad account at a time');
    const run = await this.runs.create({
      userId: user.id, adAccountId: ads[0].ad_account_id, keywords: [], dateFrom: body.date_from, dateTo: body.date_to, trigger: 'manual',
    });
    await this.queues.enqueueInsightsRefresh({
      runId: run.id, userId: user.id, adIds: ads.map((ad) => ad.id), dateFrom: body.date_from, dateTo: body.date_to,
    });
    return run;
  }
}

@Module({
  imports: [MetaIntegrationModule, SearchModule],
  controllers: [InsightsController],
  providers: [InsightsService],
  exports: [InsightsService],
})
export class InsightsModule {}
