import { NestFactory } from '@nestjs/core';
// Named `configure`, not the default: the adapter's CJS .d.ts types the default import as the module object under
// nodenext (not callable); Node's ESM loader does expose `configure` as a named export.
import { configure as serverlessExpress } from '@codegenie/serverless-express';
import type { APIGatewayProxyEvent, Handler } from 'aws-lambda';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

// Same setup as main.ts minus listen/enableShutdownHooks. No `trust proxy`: the adapter sets req.ip to API Gateway's
// sourceIp, so X-Forwarded-For stays client-controlled and ignored.
export async function bootstrap(): Promise<Handler> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.init();
  return serverlessExpress({ app: app.getHttpAdapter().getInstance() });
}

// The promise is cached so concurrent first invocations share one bootstrap.
let server: Promise<Handler> | undefined;

export const handler: Handler<APIGatewayProxyEvent> = async (
  event,
  context,
  callback,
) => {
  // Legacy root fix: an empty path breaks the adapter (`ee.on is not a function`, serverless-offline#1832).
  if (!event.path) event.path = '/';
  // A failed bootstrap is dropped so the next invocation retries instead of the container failing forever.
  server ??= bootstrap().catch((e: unknown) => {
    server = undefined;
    throw e;
  });
  return (await server)(event, context, callback);
};
