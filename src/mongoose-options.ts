import type { ConfigType } from '@nestjs/config';
import type { MongooseModuleOptions } from '@nestjs/mongoose';
import type config from './config.js';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// Allow-list, not a deny-list of Atlas patterns: a renamed prod host can't slip through.
export function assertTestMongoUri(uri: string): void {
  const prefix = 'mongodb://';
  if (!uri.startsWith(prefix)) {
    throw new Error(
      `Refusing to run tests: the Mongo URI scheme must be ${prefix} (got ${uri.split(':')[0]}://)`,
    );
  }
  const authority = uri.slice(prefix.length).split(/[/?]/)[0];
  const hostList = authority.slice(authority.lastIndexOf('@') + 1);
  for (const host of hostList.split(',')) {
    const name = host.replace(/:\d+$/, '');
    if (!LOCAL_HOSTS.includes(name)) {
      throw new Error(
        `Refusing to run tests: Mongo host "${name}" is not local (${LOCAL_HOSTS.join(', ')})`,
      );
    }
  }
}

export function mongooseOptions(
  c: ConfigType<typeof config>,
): MongooseModuleOptions {
  const underTest = Boolean(process.env.VITEST) || c.nodeEnv === 'test';
  // The guard is keyed on the host, not on NODE_ENV: the prod-pointing .env doesn't set NODE_ENV=production.
  // NODE_ENV/VITEST only decide when it runs. Any spec that imports AppModule with the prod .env throws here.
  if (underTest) assertTestMongoUri(c.database.uri);
  return {
    uri: c.database.uri,
    dbName: c.database.dbName,
    serverSelectionTimeoutMS: 5000,
    retryAttempts: underTest ? 0 : 2,
    retryDelay: 1000,
    // start:dev hits the prod DB, so autoIndex stays off there; prod indexes come from S8's script.
    autoIndex: c.nodeEnv === 'test',
  };
}
