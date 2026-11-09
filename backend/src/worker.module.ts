import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { domainModules, loggerModule } from './app.module';
import { BackgroundJobsModule } from './jobs/background-jobs.module';

/** Headless application context: BullMQ processors + scheduler tick, no HTTP. */
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), loggerModule, ...domainModules, BackgroundJobsModule] })
export class WorkerModule {}
