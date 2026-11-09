import { BadRequestException, Body, Controller, Get, Module, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { IANAZone } from 'luxon';
import { AuthUser, CurrentUser } from '../auth/auth';
import { must, SupabaseService } from '../common/supabase.service';

class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(120) display_name?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
class UsersController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return must(await this.supabase.from('profiles').select('*').eq('id', user.id).single(), 'load profile');
  }

  @Patch('me')
  async update(@CurrentUser() user: AuthUser, @Body() body: UpdateProfileDto) {
    if (body.timezone && !IANAZone.isValidZone(body.timezone)) throw new BadRequestException('Unknown IANA timezone');
    return must(await this.supabase.from('profiles').update(body).eq('id', user.id).select('*').single(), 'update profile');
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
