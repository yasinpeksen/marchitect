import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/auth';
import { TikTokApiClient } from './tiktok-api.client';
import { TikTokCollectorService } from './tiktok-collector.service';
import { TikTokConnectionsService } from './tiktok-connections.service';
import { TikTokInsightsService } from './tiktok-insights.service';

export class ConnectTikTokDto {
  @IsString() @MinLength(20) @MaxLength(1000) token: string;
  /** Advertiser ids from TikTok Ads Manager (the token must be authorised for them). */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @Matches(/^\d{5,25}$/, { each: true }) advertiser_ids: string[];
  @IsOptional() @IsString() @MaxLength(100) name?: string;
}

@ApiTags('tiktok')
@ApiBearerAuth()
@Controller('tiktok')
class TikTokController {
  constructor(private readonly connections: TikTokConnectionsService) {}

  @Get('connections')
  list(@CurrentUser() user: AuthUser) {
    return this.connections.list(user.id);
  }

  /** Token is validated, encrypted at rest and never returned. */
  @Post('connections')
  connect(@CurrentUser() user: AuthUser, @Body() body: ConnectTikTokDto) {
    return this.connections.connect(user.id, body.token.trim(), body.advertiser_ids, body.name);
  }

  @Post('connections/:id/sync')
  @HttpCode(200)
  sync(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) connectionId: string) {
    return this.connections.syncAccounts(user.id, connectionId);
  }

  @Delete('connections/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) connectionId: string) {
    await this.connections.remove(user.id, connectionId);
  }
}

@Module({
  controllers: [TikTokController],
  providers: [TikTokApiClient, TikTokConnectionsService, TikTokCollectorService, TikTokInsightsService],
  exports: [TikTokApiClient, TikTokConnectionsService, TikTokCollectorService, TikTokInsightsService],
})
export class TikTokIntegrationModule {}
