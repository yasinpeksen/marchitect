import {
  Body, Controller, Delete, Get, HttpCode, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/auth';
import { must, SupabaseService } from '../common/supabase.service';
import { AdRow } from '../common/types';
import { MediaService } from '../media/media.service';
import { MediaStorageModule } from '../media/media.module';
import { MetaIntegrationModule } from '../meta/meta.module';
import { AdQueryDto } from '../search/search.dto';
import { SearchModule } from '../search/search.module';
import { SearchService } from '../search/search.service';
import { AdCollectorService } from './ad-collector.service';
import { creativeVariations } from './creative-mapper';

class AddTagDto {
  @IsString() @MinLength(1) @MaxLength(60) tag: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) confidence?: number;
}

type RawRecord = Record<string, unknown> & { raw?: unknown };

const withoutRaw = (record: RawRecord | null): Omit<RawRecord, 'raw'> | null => {
  if (!record) return null;
  const { raw: _raw, ...rest } = record;
  return rest;
};

@ApiTags('ads')
@ApiBearerAuth()
@Controller('ads')
class AdsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly search: SearchService,
    private readonly media: MediaService,
  ) {}

  /** Library + instant search. Filters, sorting and pagination run in indexed SQL. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: AdQueryDto) {
    return this.search.instant(user.id, query);
  }

  private async load(userId: string, adId: string): Promise<AdRow & RawRecord> {
    const response = await this.supabase.from('ads').select('*').eq('id', adId).eq('user_id', userId).maybeSingle();
    const ad = must<(AdRow & RawRecord) | null>(response, 'load ad');
    if (!ad) throw new NotFoundException('Ad not found');
    return ad;
  }

  private async loadRelated(table: string, userId: string, relatedId: string | null): Promise<RawRecord | null> {
    if (!relatedId) return null;
    const response = await this.supabase.from(table).select('*').eq('id', relatedId).eq('user_id', userId).maybeSingle();
    return must<RawRecord | null>(response, table);
  }

  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) adId: string) {
    const { raw: _raw, search_text: _searchText, ...ad } = (await this.load(user.id, adId)) as AdRow & RawRecord & { search_text?: string };
    const [campaign, adSet, creative, mediaByAd, snapshot, tags, account] = await Promise.all([
      this.loadRelated('campaigns', user.id, ad.campaign_id),
      this.loadRelated('ad_sets', user.id, ad.ad_set_id),
      this.loadRelated('ad_creatives', user.id, ad.creative_id),
      this.media.mediaForAds(user.id, [adId]),
      this.supabase
        .from('ad_insights')
        .select('currency,quality_ranking,engagement_rate_ranking,conversion_rate_ranking,date_start,date_stop,collected_at,reach,frequency')
        .eq('ad_id', adId)
        .eq('user_id', user.id)
        .order('collected_at', { ascending: false })
        .limit(1),
      this.supabase.from('ai_creative_tags').select('id,tag,category,confidence,source').eq('ad_id', adId).eq('user_id', user.id),
      this.loadRelated('ad_accounts', user.id, ad.ad_account_id),
    ]);
    return {
      ...ad,
      campaign: withoutRaw(campaign),
      ad_set: withoutRaw(adSet),
      creative: withoutRaw(creative),
      creative_variations: creativeVariations(creative as Parameters<typeof creativeVariations>[0]),
      targeting: (adSet as { targeting?: unknown } | null)?.targeting ?? null,
      media: mediaByAd.get(adId) ?? [],
      latest_snapshot: must<unknown[]>(snapshot, 'snapshot')[0] ?? null,
      tags: must(tags, 'tags'),
      ad_account: account
        ? { id: account.id, name: account.name, currency: account.currency, meta_account_id: account.meta_account_id }
        : null,
    };
  }

  /** Raw Meta JSON for the dashboard's JSON viewer. */
  @Get(':id/raw')
  async raw(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) adId: string) {
    const ad = await this.load(user.id, adId);
    const [campaign, adSet, creative, insight] = await Promise.all([
      this.loadRelated('campaigns', user.id, ad.campaign_id),
      this.loadRelated('ad_sets', user.id, ad.ad_set_id),
      this.loadRelated('ad_creatives', user.id, ad.creative_id),
      this.supabase.from('ad_insights').select('raw').eq('ad_id', adId).eq('user_id', user.id).order('collected_at', { ascending: false }).limit(1),
    ]);
    const creativeRecord = creative as { object_story_spec?: unknown; asset_feed_spec?: unknown } | null;
    return {
      ad: ad.raw,
      campaign: campaign?.raw ?? null,
      ad_set: adSet?.raw ?? null,
      creative: creativeRecord
        ? { object_story_spec: creativeRecord.object_story_spec, asset_feed_spec: creativeRecord.asset_feed_spec }
        : null,
      latest_insights: must<{ raw: unknown }[]>(insight, 'insights')[0]?.raw ?? null,
    };
  }

  @Post(':id/tags')
  async addTag(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) adId: string, @Body() body: AddTagDto) {
    await this.load(user.id, adId);
    return must(
      await this.supabase
        .from('ai_creative_tags')
        .upsert(
          { user_id: user.id, ad_id: adId, tag: body.tag.trim().toLowerCase(), category: body.category ?? null, confidence: body.confidence ?? null, source: 'manual' },
          { onConflict: 'ad_id,tag' },
        )
        .select('id,tag,category,confidence,source')
        .single(),
      'add tag',
    );
  }

  @Delete(':id/tags/:tagId')
  @HttpCode(204)
  async removeTag(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) adId: string, @Param('tagId', ParseUUIDPipe) tagId: string) {
    must(await this.supabase.from('ai_creative_tags').delete().eq('id', tagId).eq('ad_id', adId).eq('user_id', user.id), 'remove tag');
  }
}

@Module({
  imports: [MetaIntegrationModule, SearchModule, MediaStorageModule],
  controllers: [AdsController],
  providers: [AdCollectorService],
  exports: [AdCollectorService],
})
export class AdvertisementsModule {}
