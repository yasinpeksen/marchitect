import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfig } from './common/app-config';
import { AllExceptionsFilter } from './common/http-exception.filter';

async function bootstrap() {
  if (process.env.SENTRY_DSN) Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });

  const application = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = application.get(AppConfig);
  application.useLogger(application.get(Logger));
  application.set('trust proxy', 1);
  application.use(helmet());
  application.enableCors({ origin: config.corsOrigins, credentials: true });
  application.setGlobalPrefix('api/v1', { exclude: ['health'] });
  application.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  application.useGlobalFilters(new AllExceptionsFilter());
  application.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    application,
    new DocumentBuilder()
      .setTitle('Meta Ads Intelligence API')
      .setDescription('Collect, search, schedule and analyse Meta advertisements. Auth: Supabase access token as Bearer.')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', application, document);

  await application.listen(config.port, '0.0.0.0');
}
bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
