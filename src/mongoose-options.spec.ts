import type { ConfigType } from '@nestjs/config';
import type config from './config.js';
import { assertTestMongoUri, mongooseOptions } from './mongoose-options.js';

const cfg = (uri: string, nodeEnv: string) =>
  ({
    database: { uri, dbName: 'db' },
    nodeEnv,
  }) as ConfigType<typeof config>;

describe('assertTestMongoUri', () => {
  it.each([
    'mongodb://127.0.0.1:51234/?replicaSet=testset',
    'mongodb://localhost:27017/?replicaSet=rs0',
    'mongodb://u:p@localhost:27017,127.0.0.1:27018,[::1]:27019/db?replicaSet=rs0',
  ])('accepts %s', (uri) => {
    expect(() => assertTestMongoUri(uri)).not.toThrow();
  });

  it.each([
    'mongodb+srv://u:SECRETPWD@x.q040o.mongodb.net',
    'mongodb://u:SECRETPWD@cluster.mongodb.net:27017',
    'mongodb://u:SECRETPWD@localhost:27017,cluster.mongodb.net:27017/?replicaSet=rs0',
  ])('rejects %s without leaking the password', (uri) => {
    expect(() => assertTestMongoUri(uri)).toThrow(/Refusing/);
    try {
      assertTestMongoUri(uri);
    } catch (e) {
      expect((e as Error).message).not.toContain('SECRETPWD');
    }
  });
});

describe('mongooseOptions', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws on an Atlas URI under Vitest', () => {
    expect(() =>
      mongooseOptions(cfg('mongodb+srv://u:p@x.mongodb.net', 'development')),
    ).toThrow(/Refusing/);
  });

  it('does not guard outside tests; autoIndex off, retries on', () => {
    vi.stubEnv('VITEST', '');
    const opts = mongooseOptions(
      cfg('mongodb+srv://u:p@x.mongodb.net', 'development'),
    );
    expect(opts.autoIndex).toBe(false);
    expect(opts.retryAttempts).toBe(2);
  });

  it('uses test options for a local URI with NODE_ENV=test', () => {
    const opts = mongooseOptions(cfg('mongodb://127.0.0.1:1/', 'test'));
    expect(opts).toMatchObject({
      autoIndex: true,
      retryAttempts: 0,
      serverSelectionTimeoutMS: 5000,
    });
  });
});
