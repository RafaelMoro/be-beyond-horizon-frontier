import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { INITIAL_RESPONSE } from '../src/constants.js';
import { FORGOT_PASSWORD_MAILER } from '../src/user/user.constants.js';
import type { ForgotPasswordMailer } from '../src/user/user.interface.js';
import { hashToken } from '../src/user/user.utils.js';
import { closeTestApp, createTestApp } from './create-test-app.js';

const PASSWORD = 'e2e-password';
let seq = 0;
const uniqueEmail = () => `e2e-${Date.now()}-${seq++}@example.invalid`;
const newUser = (email = uniqueEmail()) => ({
  email,
  password: PASSWORD,
  firstName: 'First',
  lastName: 'Last',
  middleName: '',
});
const unauthorized = {
  ...INITIAL_RESPONSE,
  success: false,
  error: { message: 'Unauthorized', statusCode: 401 },
};
const loginError = {
  ...INITIAL_RESPONSE,
  success: false,
  error: {
    message: 'Email or Password incorrect.',
    error: 'Unauthorized',
    statusCode: 401,
  },
};
const badRequest = (message: string | string[]) => ({
  ...INITIAL_RESPONSE,
  success: false,
  error: { message, error: 'Bad Request', statusCode: 400 },
});
// The old-next way: the value between the first `=` and the first `;` of set-cookie[0].
const tokenFromCookie = (setCookie: string[]) => {
  const first = setCookie[0];
  return first.slice(first.indexOf('=') + 1, first.indexOf(';'));
};
const decode = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as Record<
    string,
    unknown
  >;

describe('Auth + Users (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const accessJwt = () => new JwtService({ secret: process.env.JWT_KEY });

  const signup = async (body = newUser()) => {
    const res = await http().post('/users').send(body).expect(201);
    return { ...body, sub: res.body.data.userCreated.sub as string };
  };
  const login = async (email: string, password = PASSWORD) => {
    const res = await http()
      .post('/auth/')
      .send({ email, password })
      .expect(201);
    return tokenFromCookie(res.headers['set-cookie'] as unknown as string[]);
  };

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    if (app) await closeTestApp(app);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('POST /users (signup)', () => {
    it('201 with the legacy body', async () => {
      const body = newUser();
      const res = await http().post('/users').send(body).expect(201);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'User created',
        data: {
          userCreated: {
            email: body.email,
            sub: expect.stringMatching(/^[0-9a-f]{24}$/),
          },
        },
      });
    });

    it('duplicate email → 400 Try with other email.', async () => {
      const body = newUser();
      await http().post('/users').send(body).expect(201);
      const res = await http().post('/users').send(body).expect(400);
      expect(res.body).toStrictEqual(badRequest('Try with other email.'));
    });

    it('missing middleName → 400', async () => {
      const { middleName: _, ...body } = newUser();
      await http().post('/users').send(body).expect(400);
    });

    it('unknown field → 400', async () => {
      const res = await http()
        .post('/users')
        .send({ ...newUser(), role: 'admin' })
        .expect(400);
      expect(res.body.error.message).toStrictEqual([
        'property role should not exist',
      ]);
    });
  });

  describe('POST /auth (login)', () => {
    it.each(['/auth/', '/auth'])(
      '%s → 201, bare JWT as the only Set-Cookie, no token in the body',
      async (path) => {
        const user = await signup();
        const res = await http()
          .post(path)
          .send({ email: user.email, password: PASSWORD })
          .expect(201);
        expect(res.body).toStrictEqual({
          ...INITIAL_RESPONSE,
          data: {
            user: {
              _id: user.sub,
              email: user.email,
              firstName: 'First',
              lastName: 'Last',
              middleName: '',
            },
          },
        });
        expect(JSON.stringify(res.body)).not.toContain('accessToken');
        const setCookie = res.headers['set-cookie'] as unknown as string[];
        expect(setCookie).toHaveLength(1);
        expect(setCookie[0]).toMatch(/^accessToken=/);
        expect(setCookie[0]).toContain('Max-Age=432000');
        expect(setCookie[0]).toContain('HttpOnly');
        expect(setCookie[0]).toContain('Secure');
        expect(setCookie[0]).toContain('SameSite=Strict');
        const token = tokenFromCookie(setCookie);
        expect(token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
        expect(Object.keys(decode(token)).sort()).toStrictEqual([
          'exp',
          'iat',
          'sub',
        ]);
        expect(decode(token).sub).toBe(user.sub);
      },
    );

    it('wrong password and unknown email → 401 LOGIN_ERROR, no cookie', async () => {
      const user = await signup();
      for (const body of [
        { email: user.email, password: 'wrong' },
        { email: uniqueEmail(), password: PASSWORD },
      ]) {
        const res = await http().post('/auth/').send(body).expect(401);
        expect(res.body).toStrictEqual(loginError);
        expect(res.headers['set-cookie']).toBeUndefined();
      }
    });

    it('missing field → message-less 401', async () => {
      const res = await http().post('/auth/').send({}).expect(401);
      expect(res.body).toStrictEqual(unauthorized);
    });

    it('extra field is ignored → 201', async () => {
      const user = await signup();
      await http()
        .post('/auth/')
        .send({ email: user.email, password: PASSWORD, extra: 1 })
        .expect(201);
    });

    it('operator injection → 401', async () => {
      await http()
        .post('/auth/')
        .send({ email: { $gt: '' }, password: PASSWORD })
        .expect(401);
    });

    it('credentials only in the query string → 401', async () => {
      const user = await signup();
      await http()
        .post('/auth/')
        .query({ email: user.email, password: PASSWORD })
        .expect(401);
    });
  });

  describe('global guard (PUT /users)', () => {
    it('GET / stays public', async () => {
      await http().get('/').expect(200);
    });

    it('no token → 401 in the envelope', async () => {
      const res = await http()
        .put('/users')
        .send({ email: 'a@b.com' })
        .expect(401);
      expect(res.body).toStrictEqual(unauthorized);
    });

    it('unmatched routes stay 404', async () => {
      await http().get('/nope').expect(404);
    });

    it('garbage, expired, foreign-key and non-ObjectId-sub tokens → 401', async () => {
      const user = await signup();
      const now = Math.floor(Date.now() / 1000);
      const tokens = [
        'garbage',
        await accessJwt().signAsync({
          sub: user.sub,
          iat: now - 100,
          exp: now - 10,
        }),
        await new JwtService({ secret: 'another-key' }).signAsync({
          sub: user.sub,
        }),
        await accessJwt().signAsync({ sub: 'not-an-object-id' }),
      ];
      for (const token of tokens) {
        const res = await http()
          .put('/users')
          .set('Authorization', `Bearer ${token}`)
          .send({ email: user.email })
          .expect(401);
        expect(res.body).toStrictEqual(unauthorized);
      }
    });

    it('a valid token works as Bearer and as the accessToken cookie', async () => {
      const user = await signup();
      const token = await login(user.email);
      await http()
        .put('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: user.email })
        .expect(200);
      await http()
        .put('/users')
        .set('Cookie', `accessToken=${token}`)
        .send({ email: user.email })
        .expect(200);
    });
  });

  describe('PUT /users', () => {
    let user: Awaited<ReturnType<typeof signup>>;
    let token: string;
    const put = (body: object) =>
      http().put('/users').set('Authorization', `Bearer ${token}`).send(body);

    beforeEach(async () => {
      user = await signup();
      token = await login(user.email);
    });

    it('another email → 400 You cannot change your email', async () => {
      const res = await put({ email: uniqueEmail() }).expect(400);
      expect(res.body).toStrictEqual(
        badRequest('You cannot change your email'),
      );
    });

    it('password → 400 change-it-via-forgot message', async () => {
      const res = await put({ email: user.email, password: 'new' }).expect(400);
      expect(res.body).toStrictEqual(
        badRequest(
          'You cannot change your password directly. Try changing it using forgot password',
        ),
      );
    });

    it("firstName '' and unknown fields → 400", async () => {
      await put({ email: user.email, firstName: '' }).expect(400);
      await put({ email: user.email, role: 'admin' }).expect(400);
    });

    it('200 with the legacy body, and the change persists', async () => {
      const res = await put({
        email: user.email,
        firstName: 'New',
        middleName: 'M',
      }).expect(200);
      const userUpdated = {
        email: user.email,
        firstName: 'New',
        middleName: 'M',
        lastName: 'Last',
      };
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Profile updated',
        data: { userUpdated },
      });
      const again = await put({ email: user.email }).expect(200);
      expect(again.body.data.userUpdated).toStrictEqual(userUpdated);
    });
  });

  it('flow: signup → login → PUT → DELETE → same token 401 → login 401', async () => {
    const user = await signup();
    const token = await login(user.email);
    const auth = { Authorization: `Bearer ${token}` };
    await http()
      .put('/users')
      .set(auth)
      .send({ email: user.email, lastName: 'X' })
      .expect(200);
    const res = await http().delete('/users').set(auth).expect(200);
    expect(res.body).toStrictEqual({
      ...INITIAL_RESPONSE,
      message: 'User deleted.',
      data: {
        userDeleted: { email: user.email, firstName: 'First', lastName: 'X' },
      },
    });
    const after = await http()
      .put('/users')
      .set(auth)
      .send({ email: user.email })
      .expect(401);
    expect(after.body).toStrictEqual(unauthorized);
    const relog = await http()
      .post('/auth/')
      .send({ email: user.email, password: PASSWORD })
      .expect(401);
    expect(relog.body).toStrictEqual(loginError);
  });

  describe('forgot / reset password', () => {
    const sent = { ...INITIAL_RESPONSE, message: 'Email Sent', data: null };
    const users = () =>
      app.get<Connection>(getConnectionToken()).collection('users');
    // The raw one-time token only reaches the mailer port: capture it there.
    const captureToken = () => {
      const mailer = app.get<ForgotPasswordMailer>(FORGOT_PASSWORD_MAILER, {
        strict: false,
      });
      return vi.spyOn(mailer, 'sendForgotPasswordEmail').mockResolvedValue();
    };
    const forgot = async (email: string) => {
      const spy = captureToken();
      await http().post('/users/forgot-password').send({ email }).expect(201);
      const token = spy.mock.calls.at(-1)?.[0].oneTimeToken as string;
      spy.mockRestore();
      return token;
    };
    const reset = (token: string, password = 'new-password') =>
      http().post(`/users/reset-password/${token}`).send({ password });

    it('unknown email → 201 Email Sent, no send', async () => {
      const spy = captureToken();
      const res = await http()
        .post('/users/forgot-password')
        .send({ email: uniqueEmail() })
        .expect(201);
      expect(res.body).toStrictEqual(sent);
      expect(spy).not.toHaveBeenCalled();
    });

    it('invalid email → 400', async () => {
      await http()
        .post('/users/forgot-password')
        .send({ email: 'nope' })
        .expect(400);
    });

    it('known email → 201, only the sha256 of the token is stored', async () => {
      const user = await signup();
      const spy = captureToken();
      const res = await http()
        .post('/users/forgot-password')
        .send({ email: user.email })
        .expect(201);
      expect(res.body).toStrictEqual(sent);
      const raw = spy.mock.calls[0][0].oneTimeToken;
      const doc = await users().findOne({ email: user.email });
      expect(doc?.oneTimeToken).toBe(hashToken(raw));
      expect(doc?.oneTimeToken).not.toBe(raw);
    });

    it.each([
      ['jwt malformed', async () => 'not-a-jwt'],
      [
        'invalid signature',
        async (sub: string) => accessJwt().signAsync({ sub }),
      ],
      [
        'jwt expired',
        async (sub: string) =>
          new JwtService({ secret: process.env.ONE_TIME_JWT_KEY }).signAsync({
            sub,
            exp: Math.floor(Date.now() / 1000) - 10,
          }),
      ],
    ])('reset → 400 %s', async (message, makeToken) => {
      const user = await signup();
      const res = await reset(await makeToken(user.sub)).expect(400);
      expect(res.body).toStrictEqual(badRequest(message));
    });

    it('reset 201, then the same token → JWT not found., an older token → Wrong JWT', async () => {
      const user = await signup();
      const older = await forgot(user.email);
      // Different `iat` second, so the two tokens differ.
      const newer = await new JwtService({
        secret: process.env.ONE_TIME_JWT_KEY,
      }).signAsync({
        sub: user.sub,
        iat: Math.floor(Date.now() / 1000) + 1,
      });
      await users().updateOne(
        { _id: new Types.ObjectId(user.sub) },
        { $set: { oneTimeToken: hashToken(newer) } },
      );
      const wrong = await reset(older).expect(400);
      expect(wrong.body).toStrictEqual(badRequest('Wrong JWT'));
      const ok = await reset(newer).expect(201);
      expect(ok.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Reset Password Successfully',
        data: null,
      });
      const again = await reset(newer).expect(400);
      expect(again.body).toStrictEqual(badRequest('JWT not found.'));
    });

    it('an older token after a newer forgot → Wrong JWT', async () => {
      const user = await signup();
      const older = await forgot(user.email);
      await new Promise((r) => setTimeout(r, 1100)); // next `iat` second → a different token
      const newer = await forgot(user.email);
      expect(newer).not.toBe(older);
      const res = await reset(older).expect(400);
      expect(res.body).toStrictEqual(badRequest('Wrong JWT'));
    });

    it('a reset for a deleted user → User not found.', async () => {
      const user = await signup();
      const token = await forgot(user.email);
      const access = await login(user.email);
      await http()
        .delete('/users')
        .set('Authorization', `Bearer ${access}`)
        .expect(200);
      const res = await reset(token).expect(400);
      expect(res.body).toStrictEqual(badRequest('User not found.'));
    });

    it('revocation: tokens issued before the reset → 401; old password → 401; new one works', async () => {
      const user = await signup();
      const now = Math.floor(Date.now() / 1000);
      // Back-dated 60 s so the test is not same-second flaky.
      const before = await accessJwt().signAsync({
        sub: user.sub,
        iat: now - 60,
        exp: now + 3600,
      });
      const put = (token: string) =>
        http()
          .put('/users')
          .set('Authorization', `Bearer ${token}`)
          .send({ email: user.email });
      await put(before).expect(200);
      await reset(await forgot(user.email)).expect(201);
      const revoked = await put(before).expect(401);
      expect(revoked.body).toStrictEqual(unauthorized);
      const old = await http()
        .post('/auth/')
        .send({ email: user.email, password: PASSWORD })
        .expect(401);
      expect(old.body).toStrictEqual(loginError);
      const fresh = await login(user.email, 'new-password');
      await put(fresh).expect(200);
    });
  });
});
