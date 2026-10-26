import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { INITIAL_RESPONSE } from '../src/constants.js';
import { RateLimit } from '../src/rate-limit/entities/rate-limit.entity.js';
import { FORGOT_PASSWORD_MAILER } from '../src/user/user.constants.js';
import type { ForgotPasswordMailer } from '../src/user/user.interface.js';
import { closeTestApp, createTestApp } from './create-test-app.js';

const PASSWORD = 'e2e-password';
let seq = 0;
const uniqueEmail = () => `e2e-rl-${Date.now()}-${seq++}@example.invalid`;
const tooMany = {
  ...INITIAL_RESPONSE,
  success: false,
  error: {
    message: 'Too Many Requests',
    error: 'Too Many Requests',
    statusCode: 429,
  },
};

describe('Rate limits (e2e)', () => {
  let app: INestApplication<App>;
  let rateLimitModel: Model<RateLimit>;
  let sendMail: ReturnType<typeof vi.fn>;
  const http = () => request(app.getHttpServer());
  const login = (email: string, password: string) =>
    http().post('/auth').send({ email, password });
  const forgot = (email: string) =>
    http().post('/users/forgot-password').send({ email });
  const signup = (email: string) =>
    http()
      .post('/users')
      .send({
        email,
        password: PASSWORD,
        firstName: 'F',
        lastName: 'L',
        middleName: '',
      })
      .expect(201);

  const expect429 = (res: request.Response) => {
    expect(res.status).toBe(429);
    expect(res.body).toStrictEqual(tooMany);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['retry-after']).toBeUndefined();
    expect(
      Object.keys(res.headers).filter((h) => h.startsWith('x-ratelimit')),
    ).toStrictEqual([]);
  };

  // 10 wrong passwords → 401 each, then the right one → 429.
  const exhaustLogin = async (email: string) => {
    for (let i = 0; i < 10; i++) {
      const res = await login(email, 'wrong-password');
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Email or Password incorrect.');
    }
    expect429(await login(email, PASSWORD));
  };

  beforeAll(async () => {
    app = await createTestApp();
    rateLimitModel = app.get<Model<RateLimit>>(getModelToken(RateLimit.name));
    await rateLimitModel.init();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  beforeEach(async () => {
    // Every request in this file comes from one IP.
    await rateLimitModel.deleteMany({});
    const mailer = app.get<ForgotPasswordMailer>(FORGOT_PASSWORD_MAILER, {
      strict: false,
    });
    sendMail = vi
      .spyOn(mailer, 'sendForgotPasswordEmail')
      .mockResolvedValue() as never;
  });

  afterEach(() => vi.restoreAllMocks());

  describe('POST /auth', () => {
    it('known email: 10 attempts, then 429 even with the right password', async () => {
      const email = uniqueEmail();
      await signup(email);
      await exhaustLogin(email);
    });

    it('unknown email behaves the same', async () => {
      await exhaustLogin(uniqueEmail());
    });

    it('trim + lowercase share one counter', async () => {
      const email = uniqueEmail();
      for (let i = 0; i < 10; i++) {
        const variant = i % 2 ? ` ${email.toUpperCase()} ` : email;
        expect((await login(variant, 'wrong-password')).status).toBe(401);
      }
      expect429(await login(email, 'wrong-password'));
    });

    it('missing email / password → 401 Unauthorized, nothing counted', async () => {
      for (const body of [{}, { email: uniqueEmail() }, { password: 'x' }]) {
        const res = await http().post('/auth').send(body).expect(401);
        expect(res.body.error.message).toBe('Unauthorized');
      }
      expect(await rateLimitModel.countDocuments()).toBe(0);
    });

    it('15 parallel attempts: exactly 10 × 401 + 5 × 429, one doc with count 15', async () => {
      const email = uniqueEmail();
      // Listen once: otherwise each parallel supertest call binds the server (MaxListeners warning).
      await new Promise<void>((r) => app.getHttpServer().listen(0, r));
      const res = await Promise.all(
        Array.from({ length: 15 }, () => login(email, 'wrong-password')),
      );
      const statuses = res.map((r) => r.status).sort();
      expect(statuses).toStrictEqual([
        ...Array(10).fill(401),
        ...Array(5).fill(429),
      ]);
      const docs = await rateLimitModel.find().lean();
      expect(docs).toHaveLength(1);
      expect(docs[0].count).toBe(15);
    });

    it('stores only a hashed key with a future expiry, and the TTL index exists', async () => {
      const email = uniqueEmail();
      await login(email, 'wrong-password').expect(401);
      const docs = await rateLimitModel.find().lean();
      expect(docs).toHaveLength(1);
      expect(docs[0]._id).toMatch(/^login:[0-9a-f]{64}:\d+$/);
      expect(JSON.stringify(docs)).not.toContain(email);
      expect(docs[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
      const indexes = await rateLimitModel.collection.indexes();
      expect(indexes).toContainEqual(
        expect.objectContaining({
          key: { expiresAt: 1 },
          expireAfterSeconds: 0,
        }),
      );
    });
  });

  describe('POST /users/forgot-password', () => {
    it.each([
      ['known', true],
      ['unknown', false],
    ])('%s email: 3 × 201, the 4th → 429', async (_, known) => {
      const email = uniqueEmail();
      if (known) await signup(email);
      for (let i = 0; i < 3; i++) {
        const res = await forgot(email).expect(201);
        expect(res.body.message).toBe('Email Sent');
      }
      expect429(await forgot(email));
      expect(sendMail).toHaveBeenCalledTimes(known ? 3 : 0);
    });

    it('per IP: 10 different emails pass, the 11th → 429; X-Forwarded-For does not help', async () => {
      for (let i = 0; i < 10; i++) {
        await forgot(uniqueEmail())
          .set('X-Forwarded-For', `203.0.113.${i}`)
          .expect(201);
      }
      expect429(
        await forgot(uniqueEmail()).set('X-Forwarded-For', '203.0.113.99'),
      );
    });

    it('a DTO 400 is not counted', async () => {
      await forgot('not-an-email').expect(400);
      expect(await rateLimitModel.countDocuments()).toBe(0);
    });
  });
});
