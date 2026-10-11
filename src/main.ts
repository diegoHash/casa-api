import { loadProductionSecrets } from './config/aws-secrets';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { MonitoringInterceptor } from './monitoring/monitoring.interceptor';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production') {
    await loadProductionSecrets();
  }


  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const prefix = config.getOrThrow<string>('API_PREFIX');
  const origin = config.getOrThrow<string>('WEB_ORIGIN');
  const port = config.getOrThrow<number>('PORT');

  app.use(helmet());
  app.enableCors({
    origin: origin.split(',').map((value) => value.trim()),
    // Authentication is Authorization: Bearer, never an ambient cookie.
    // Keeping credentials disabled prevents cross-origin cookie attachment.
    credentials: false,
  });
  app.setGlobalPrefix(prefix);
  const trustedProxyCidrs = config.get<string>('TRUSTED_PROXY_CIDRS', '');
  const express = app.getHttpAdapter().getInstance() as { set: (name: string, value: unknown) => void };
  if (trustedProxyCidrs.trim()) express.set('trust proxy', trustedProxyCidrs.split(',').map((value) => value.trim()).filter(Boolean));
  app.useGlobalFilters(app.get(HttpExceptionFilter));
  app.useGlobalInterceptors(app.get(MonitoringInterceptor));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  await app.listen(port);
}

void bootstrap();
