import { buildMongoUri, envSchema } from './config.js';

const base = {
  MONGO_DB_NAME: 'budget',
  FRONTEND_URI: 'https://app.example.com',
  TEST_FRONTEND_URI: 'http://localhost:4000',
  DOMAIN_URI: 'https://example.com',
  NODE_ENV: 'development',
  JWT_KEY: 'jwt-key',
  ONE_TIME_JWT_KEY: 'one-time-key',
};
const parts = {
  MONGO_CONNECTION: 'mongodb+srv',
  MONGO_USER: 'user',
  MONGO_PWD: 'pwd',
  MONGO_HOST: 'cluster0.abcde.mongodb.net',
};
const validate = (env: Record<string, string>) =>
  envSchema.validate(env, { allowUnknown: true });

describe('envSchema', () => {
  it('accepts a legacy-style env plus MONGO_HOST', () => {
    expect(
      validate({ ...base, ...parts, CLUSTER: 'cluster0' }).error,
    ).toBeUndefined();
  });

  it('accepts MONGO_URI alone, without the parts', () => {
    expect(
      validate({ ...base, MONGO_URI: 'mongodb://localhost:27017' }).error,
    ).toBeUndefined();
  });

  it('fails without MONGO_URI and without MONGO_HOST', () => {
    const { MONGO_HOST: _, ...rest } = parts;
    expect(validate({ ...base, ...rest }).error?.message).toMatch(
      /"MONGO_HOST" is required/,
    );
  });

  it('fails without FRONTEND_URI', () => {
    const { FRONTEND_URI: _, ...rest } = base;
    expect(validate({ ...rest, ...parts }).error?.message).toMatch(
      /"FRONTEND_URI" is required/,
    );
  });

  it.each(['JWT_KEY', 'ONE_TIME_JWT_KEY'] as const)(
    'fails without %s',
    (key) => {
      const { [key]: _, ...rest } = base;
      expect(validate({ ...rest, ...parts }).error?.message).toMatch(
        new RegExp(`"${key}" is required`),
      );
    },
  );

  it.each(['https://app.example.com/', 'example.com'])(
    'rejects FRONTEND_URI %s',
    (FRONTEND_URI) => {
      expect(validate({ ...base, ...parts, FRONTEND_URI }).error).toBeDefined();
    },
  );
});

describe('envSchema mail keys', () => {
  const mail = {
    RESEND_API_KEY: 're_test_fake',
    MAILER_MAIL: 'no-reply@example.com',
  };

  it('accepts no mail keys in development', () => {
    expect(validate({ ...base, ...parts }).error).toBeUndefined();
  });

  it('accepts blank mail keys in development', () => {
    expect(
      validate({ ...base, ...parts, RESEND_API_KEY: '', MAILER_MAIL: '' })
        .error,
    ).toBeUndefined();
  });

  it('accepts both mail keys in production', () => {
    expect(
      validate({ ...base, ...parts, ...mail, NODE_ENV: 'production' }).error,
    ).toBeUndefined();
  });

  it.each(['RESEND_API_KEY', 'MAILER_MAIL'] as const)(
    'fails in production without %s, or with it blank',
    (key) => {
      const { [key]: _, ...rest } = mail;
      const env = { ...base, ...parts, ...rest, NODE_ENV: 'production' };
      expect(validate(env).error?.message).toMatch(
        new RegExp(`"${key}" is required`),
      );
      expect(validate({ ...env, [key]: '' }).error?.message).toMatch(
        new RegExp(`"${key}"`),
      );
    },
  );

  it('accepts MAILER_MAIL as `Name <addr>`', () => {
    expect(
      validate({
        ...base,
        ...parts,
        ...mail,
        MAILER_MAIL: 'Budget Master <no-reply@example.com>',
      }).error,
    ).toBeUndefined();
  });
});

describe('buildMongoUri', () => {
  it('returns MONGO_URI unchanged when set, ignoring the parts', () => {
    expect(buildMongoUri({ ...parts, MONGO_URI: 'mongodb://h:1/x' })).toBe(
      'mongodb://h:1/x',
    );
  });

  it('builds the URI from the parts', () => {
    expect(buildMongoUri(parts)).toBe(
      'mongodb+srv://user:pwd@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority',
    );
  });

  it('percent-encodes user and password', () => {
    expect(buildMongoUri({ ...parts, MONGO_PWD: 'p@s:s/w' })).toBe(
      'mongodb+srv://user:p%40s%3As%2Fw@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority',
    );
  });
});
