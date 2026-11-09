import 'reflect-metadata';
import { createServer } from 'http';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { Logger } from 'nestjs-pino';
import { LockService } from './common/lock.service';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  if (process.env.SENTRY_DSN) Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });

  const application = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  application.useLogger(application.get(Logger));
  application.enableShutdownHooks(); // BullMQ workers finish in-flight jobs on SIGTERM

  // Liveness/readiness endpoint for the container health check.
  const locks = application.get(LockService);
  createServer((request, response) => {
    void (request.url === '/health' ? locks.ping().catch(() => false) : Promise.resolve(false)).then((healthy) => {
      response.writeHead(healthy ? 200 : 503).end(healthy ? 'ok' : 'unavailable');
    });
  }).listen(Number(process.env.WORKER_HEALTH_PORT ?? 3002), '0.0.0.0');

  application.get(Logger).log('Worker started');
}
bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
