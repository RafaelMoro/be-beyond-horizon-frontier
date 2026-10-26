import type {
  INestApplication,
  INestApplicationContext,
  Type,
} from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import config from '../src/config.js';
import { configureApp } from '../src/configure-app.js';
import { assertTestMongoUri } from '../src/mongoose-options.js';
import { E2E_DB_NAME } from './setup-env.js';

export async function createTestApp(
  extra: { controllers?: Type[] } = {},
): Promise<INestApplication<App>> {
  // First line of defense, before anything connects; the Mongoose factory guards again.
  assertTestMongoUri(config().database.uri);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extra.controllers ?? [],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

export async function closeTestApp(
  app: INestApplicationContext,
): Promise<void> {
  try {
    const conn = app.get<Connection>(getConnectionToken());
    const name = conn.db?.databaseName;
    if (name !== E2E_DB_NAME) {
      throw new Error(`Refusing to drop database "${name}"`);
    }
    await conn.dropDatabase();
  } finally {
    await app.close();
  }
}
