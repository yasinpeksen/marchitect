import { Module } from '@nestjs/common';
import { AdvertisementsModule } from '../advertisements/advertisements.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { InsightsModule } from '../insights/insights.module';
import { MediaStorageModule } from '../media/media.module';
import { MetaIntegrationModule } from '../meta/meta.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SearchModule } from '../search/search.module';
import { CollectionOrchestrator } from './collection.orchestrator';
import { AnalyticsProcessor, CollectionProcessor, MediaProcessor, SchedulerProcessor } from './processors';

/** Worker-only: registers the BullMQ processors. The API process does NOT import this module. */
@Module({
  imports: [
    MetaIntegrationModule, SearchModule, AdvertisementsModule, InsightsModule, MediaStorageModule,
    AnalyticsModule, SchedulerModule, NotificationsModule,
  ],
  providers: [CollectionOrchestrator, CollectionProcessor, MediaProcessor, AnalyticsProcessor, SchedulerProcessor],
})
export class BackgroundJobsModule {}
