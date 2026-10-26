import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import config from './config.js';
import { CatchAllExceptionFilter } from './exceptions/catch-all.filter.js';
import { GeneralAppExceptionFilter } from './exceptions/http-exception.filter.js';

// Shared by main.ts and the e2e harness. Never calls listen/init (Lambda uses init).
export function configureApp(app: INestApplication): void {
  // First, so preflights and error responses carry the headers too. Defaults (E8.Q4); agreed fallback if old-next
  // breaks: helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }). Also removes X-Powered-By.
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Order is the contract: Nest reverses global filters, so the catch-all must be listed first.
  app.useGlobalFilters(
    new CatchAllExceptionFilter(),
    new GeneralAppExceptionFilter(),
  );
  const { frontendUri, testFrontendUri, domainUri } = app.get<
    ConfigType<typeof config>
  >(config.KEY);
  app.enableCors({
    origin: [frontendUri, testFrontendUri, domainUri] as string[],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    // No allowedHeaders on purpose: cors mirrors the request headers, so `Authorization: Bearer` passes.
  });
}
