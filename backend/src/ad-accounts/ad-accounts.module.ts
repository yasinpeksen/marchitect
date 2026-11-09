import { Body, Controller, Get, Module, NotFoundException, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/auth';
import { must, SupabaseService } from '../common/supabase.service';

class UpdateAdAccountDto {
  @IsBoolean() selected: boolean;
}

@ApiTags('ad-accounts')
@ApiBearerAuth()
@Controller('ad-accounts')
class AdAccountsController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const response = await this.supabase
      .from('ad_accounts')
      .select('id,connection_id,meta_account_id,name,currency,timezone_name,account_status,business_id,business_name,selected')
      .eq('user_id', user.id)
      .order('name');
    return must(response, 'list ad accounts');
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) accountId: string, @Body() body: UpdateAdAccountDto) {
    const response = await this.supabase
      .from('ad_accounts')
      .update({ selected: body.selected })
      .eq('id', accountId)
      .eq('user_id', user.id)
      .select('id,selected');
    const rows = must<{ id: string; selected: boolean }[]>(response, 'update ad account');
    if (rows.length === 0) throw new NotFoundException('Ad account not found');
    return rows[0];
  }
}

@Module({ controllers: [AdAccountsController] })
export class AdAccountsModule {}
