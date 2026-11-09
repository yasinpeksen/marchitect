import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Response } from 'express';
import { AuthUser, CurrentUser, Public } from '../auth/auth';
import { AppConfig } from '../common/app-config';
import { MetaApiClient } from './meta-api.client';
import { MetaConnectionsService } from './meta-connections.service';

class ConnectDto {
  @IsString() @MinLength(20) @MaxLength(1000) token: string;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
}

@ApiTags('meta')
@ApiBearerAuth()
@Controller('meta')
class MetaController {
  constructor(
    private readonly connections: MetaConnectionsService,
    private readonly meta: MetaApiClient,
    private readonly config: AppConfig,
  ) {}

  @Get('status')
  status() {
    return this.connections.status();
  }

  @Get('connections')
  list(@CurrentUser() user: AuthUser) {
    return this.connections.list(user.id);
  }

  /** Token is validated, encrypted at rest and never returned. */
  @Post('connections')
  connect(@CurrentUser() user: AuthUser, @Body() body: ConnectDto) {
    return this.connections.connect(user.id, body.token.trim(), body.name);
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

  @Get('oauth/url')
  oauthUrl(@CurrentUser() user: AuthUser) {
    return this.connections.oauthUrl(user.id);
  }

  @Public()
  @Get('oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error_description') errorDescription: string,
    @Res() response: Response,
  ) {
    const redirectBack = (queryString: string) => response.redirect(`${this.config.frontendUrl}/connections?${queryString}`);
    if (errorDescription || !code || !state) return redirectBack(`error=${encodeURIComponent(errorDescription || 'OAuth cancelled')}`);
    try {
      await this.connections.oauthCallback(code, state);
      return redirectBack('connected=1');
    } catch (error) {
      return redirectBack(`error=${encodeURIComponent(error instanceof Error ? error.message : 'OAuth failed')}`);
    }
  }

  /**
   * Optional, separate integration: Meta Ad Library (public ads, e.g. competitors).
   * Subject to Meta's eligibility/verification; no account-level performance data is available.
   */
  @Get('ad-library/search')
  async adLibrary(
    @CurrentUser() user: AuthUser,
    @Query('connection_id', ParseUUIDPipe) connectionId: string,
    @Query('q') searchText: string,
    @Query('countries') countries = 'US',
    @Query('limit') limit = '25',
  ) {
    if (!this.config.adLibraryEnabled) {
      throw new BadRequestException('Ad Library integration is disabled. Set META_AD_LIBRARY_ENABLED=true.');
    }
    if (!searchText?.trim()) throw new BadRequestException('q is required');
    const context = await this.connections.contextFor(user.id, connectionId);
    return this.meta.adLibrary(context, {
      search_terms: searchText.trim(),
      ad_reached_countries: countries.split(',').map((country) => country.trim().toUpperCase()),
      ad_active_status: 'ALL',
      limit: Math.min(Number(limit) || 25, 100),
      fields:
        'id,page_id,page_name,ad_creation_time,ad_delivery_start_time,ad_delivery_stop_time,ad_creative_bodies,ad_creative_link_titles,ad_snapshot_url,publisher_platforms,languages',
    });
  }
}

@Module({
  controllers: [MetaController],
  providers: [MetaApiClient, MetaConnectionsService],
  exports: [MetaApiClient, MetaConnectionsService],
})
export class MetaIntegrationModule {}
