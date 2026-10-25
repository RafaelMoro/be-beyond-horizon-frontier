import { registerAs } from '@nestjs/config';
// Default import: joi is CJS, so `import * as Joi` has no named exports under `node dist/main.js`.
import Joi from 'joi';

// CORS matches origins exactly, so a missing scheme or a trailing `/` would silently block the client.
const origin = () =>
  Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .pattern(/[^/]$/, 'no trailing slash')
    .required();

// Each part is required only when the full MONGO_URI is not given.
const mongoPart = () =>
  Joi.string().when('MONGO_URI', {
    is: Joi.exist(),
    otherwise: Joi.required(),
  });

// Only the keys S1 consumes. @nestjs/config applies `allowUnknown`, so the legacy .env's other keys pass.
export const envSchema = Joi.object({
  MONGO_URI: Joi.string(),
  MONGO_CONNECTION: mongoPart(),
  MONGO_USER: mongoPart(),
  MONGO_PWD: mongoPart(),
  MONGO_HOST: mongoPart(),
  MONGO_DB_NAME: Joi.string().required(),
  FRONTEND_URI: origin(),
  TEST_FRONTEND_URI: origin(),
  DOMAIN_URI: origin(),
  NODE_ENV: Joi.string().required(),
});

export function buildMongoUri(env: NodeJS.ProcessEnv): string {
  if (env.MONGO_URI) return env.MONGO_URI;
  const user = encodeURIComponent(env.MONGO_USER ?? '');
  const pwd = encodeURIComponent(env.MONGO_PWD ?? '');
  return `${env.MONGO_CONNECTION}://${user}:${pwd}@${env.MONGO_HOST}/?retryWrites=true&w=majority`;
}

export default registerAs('config', () => ({
  database: {
    uri: buildMongoUri(process.env),
    dbName: process.env.MONGO_DB_NAME,
  },
  frontendUri: process.env.FRONTEND_URI,
  testFrontendUri: process.env.TEST_FRONTEND_URI,
  domainUri: process.env.DOMAIN_URI,
  nodeEnv: process.env.NODE_ENV,
}));
