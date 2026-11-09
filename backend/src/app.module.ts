import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AdAccountsModule } from './ad-accounts/ad-accounts.module';
import { AdvertisementsModule } from './advertisements/advertisements.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { AppConfig } from './common/app-config';
import { CommonModule } from './common/common.module';
import { CreativesModule } from './creatives/creatives.module';
import { HealthModule } from './health/health.module';
import { InsightsModule } from './insights/insights.module';
import { QueuesModule } from './jobs/queues';
import { MediaStorageModule } from './media/media.module';
import { MetaIntegrationModule } from './meta/meta.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SearchModule } from './search/search.module';
import { UsersModule } from './users/users.module';

export const loggerModule = LoggerModule.forRoot({
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: ['req.headers.authorization', 'req.headers.cookie', 'req.query.token', 'req.query.code'],
    autoLogging: { ignore: (request) => request.url === '/health' },
    transport: process.env.LOG_PRETTY === 'true' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
  },
});

/** Domain modules shared by the API and the worker. */
export const domainModules = [
  CommonModule, QueuesModule, UsersModule, MetaIntegrationModule, AdAccountsModule, CampaignsModule,
  AdvertisementsModule, CreativesModule, MediaStorageModule, SearchModule, SchedulerModule, AnalyticsModule,
  InsightsModule, NotificationsModule,
];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    loggerModule,
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => [{ ttl: config.throttleTtlMs, limit: config.throttleLimit }],
    }),
    ...domainModules,
    AuthModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
