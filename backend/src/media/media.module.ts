import { Body, Controller, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/auth';
import { must, SupabaseService } from '../common/supabase.service';
import { MetaIntegrationModule } from '../meta/meta.module';
import { MediaService } from './media.service';

class RetryDto {
  @IsArray() @IsUUID('4', { each: true }) adIds: string[];
}

@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly supabase: SupabaseService,
  ) {}

  /** Re-queue failed/pending media downloads for the given ads. */
  @Post('retry')
  async retry(@CurrentUser() user: AuthUser, @Body() body: RetryDto) {
    const ads = must<{ id: string; ad_account_id: string }[]>(
      await this.supabase.from('ads').select('id,ad_account_id').eq('user_id', user.id).in('id', body.adIds.slice(0, 100)),
      'load ads',
    );
    let queued = 0;
    for (const accountId of new Set(ads.map((ad) => ad.ad_account_id))) {
      queued += await this.media.planForAds(user.id, accountId, ads.filter((ad) => ad.ad_account_id === accountId).map((ad) => ad.id));
    }
    return { queued };
  }
}

@Module({ imports: [MetaIntegrationModule], controllers: [MediaController], providers: [MediaService], exports: [MediaService] })
export class MediaStorageModule {}
