import {
  Body, Controller, Delete, Get, HttpCode, Module, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/auth';
import { MediaStorageModule } from '../media/media.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CollectionRunsService } from './collection-runs.service';
import { SavedSearchDto, StartCollectionDto, UpdateSavedSearchDto } from './search.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@Controller()
class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly runs: CollectionRunsService,
  ) {}

  /** Triggers an asynchronous Meta collection. Poll GET /collection-runs/:id for progress. */
  @Post('search/collect')
  collect(@CurrentUser() user: AuthUser, @Body() body: StartCollectionDto) {
    return this.search.startCollection(user.id, body);
  }

  @Get('search/tags')
  tags(@CurrentUser() user: AuthUser, @Query('q') prefix?: string) {
    return this.search.tagSuggestions(user.id, prefix);
  }

  @Get('search/history')
  history(@CurrentUser() user: AuthUser) {
    return this.search.history(user.id);
  }

  @Get('collection-runs')
  listRuns(
    @CurrentUser() user: AuthUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('page_size', new DefaultValuePipe(25), ParseIntPipe) pageSize: number,
    @Query('status') status?: string,
  ) {
    const limit = Math.min(Math.max(pageSize, 1), 100);
    return this.runs.list(user.id, limit, (Math.max(page, 1) - 1) * limit, status);
  }

  @Get('collection-runs/:id')
  getRun(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) runId: string) {
    return this.runs.get(user.id, runId);
  }

  @Get('saved-searches')
  listSaved(@CurrentUser() user: AuthUser) {
    return this.search.listSaved(user.id);
  }

  @Post('saved-searches')
  createSaved(@CurrentUser() user: AuthUser, @Body() body: SavedSearchDto) {
    return this.search.createSaved(user.id, body);
  }

  @Patch('saved-searches/:id')
  updateSaved(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) savedSearchId: string, @Body() body: UpdateSavedSearchDto) {
    return this.search.updateSaved(user.id, savedSearchId, body);
  }

  @Delete('saved-searches/:id')
  @HttpCode(204)
  async deleteSaved(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) savedSearchId: string) {
    await this.search.deleteSaved(user.id, savedSearchId);
  }

  @Post('saved-searches/:id/run')
  runSaved(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) savedSearchId: string) {
    return this.search.runSaved(user.id, savedSearchId);
  }
}

@Module({
  imports: [MediaStorageModule, NotificationsModule],
  controllers: [SearchController],
  providers: [SearchService, CollectionRunsService],
  exports: [SearchService, CollectionRunsService],
})
export class SearchModule {}
