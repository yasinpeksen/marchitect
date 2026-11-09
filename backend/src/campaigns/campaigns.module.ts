import { Controller, DefaultValuePipe, Get, Module, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/auth';
import { must, SupabaseService } from '../common/supabase.service';
import { sanitizeSearchText } from './search-text';

@ApiTags('campaigns')
@ApiBearerAuth()
@Controller()
class CampaignsController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('campaigns')
  async campaigns(
    @CurrentUser() user: AuthUser,
    @Query('ad_account_id') accountId?: string,
    @Query('q') searchText?: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit = 100,
  ) {
    let query = this.supabase
      .from('campaigns')
      .select('id,ad_account_id,meta_campaign_id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time')
      .eq('user_id', user.id)
      .order('name')
      .limit(Math.min(limit, 500));
    if (accountId) query = query.eq('ad_account_id', accountId);
    const cleaned = sanitizeSearchText(searchText);
    if (cleaned) query = query.ilike('name', `%${cleaned}%`);
    return must(await query, 'list campaigns');
  }

  @Get('ad-sets')
  async adSets(@CurrentUser() user: AuthUser, @Query('campaign_id') campaignId?: string) {
    let query = this.supabase
      .from('ad_sets')
      .select('id,campaign_id,meta_adset_id,name,status,effective_status,optimization_goal,billing_event,daily_budget,targeting')
      .eq('user_id', user.id)
      .order('name')
      .limit(500);
    if (campaignId) query = query.eq('campaign_id', campaignId);
    return must(await query, 'list ad sets');
  }
}

@Module({ controllers: [CampaignsController] })
export class CampaignsModule {}
