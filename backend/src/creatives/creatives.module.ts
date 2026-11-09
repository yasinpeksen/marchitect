import { Controller, Get, Module, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { creativeVariations } from '../advertisements/creative-mapper';
import { AuthUser, CurrentUser } from '../auth/auth';
import { must, SupabaseService } from '../common/supabase.service';
import { CreativeRow } from '../common/types';

@ApiTags('creatives')
@ApiBearerAuth()
@Controller('creatives')
class CreativesController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) creativeId: string) {
    const response = await this.supabase.from('ad_creatives').select('*').eq('id', creativeId).eq('user_id', user.id).maybeSingle();
    const creative = must<CreativeRow | null>(response, 'load creative');
    if (!creative) throw new NotFoundException('Creative not found');
    return { ...creative, variations: creativeVariations(creative) };
  }
}

@Module({ controllers: [CreativesController] })
export class CreativesModule {}
