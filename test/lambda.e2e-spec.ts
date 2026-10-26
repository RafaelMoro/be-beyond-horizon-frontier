import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { INITIAL_RESPONSE } from '../src/constants.js';
import { handler } from '../src/lambda.js';
import { closeTestApp, createTestApp } from './create-test-app.js';

const PASSWORD = 'e2e-password';
let seq = 0;
const uniqueEmail = () => `e2e-lambda-${Date.now()}-${seq++}@example.invalid`;
const UNKNOWN_ID = new Types.ObjectId().toString();
// Transport headers differ between a socket and the adapter by design; everything else must match.
const TRANSPORT = new Set([
  'connection',
  'date',
  'keep-alive',
  'transfer-encoding',
  'content-length',
]);

interface Req {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  sourceIp?: string;
}

interface Normalized {
  status: number;
  body: unknown;
  headers: Record<string, string[]>;
}

const restEvent = ({
  method,
  path,
  headers = {},
  body,
  sourceIp = '198.51.100.1',
}: Req): APIGatewayProxyEvent => {
  const raw =
    body === undefined
      ? null
      : typeof body === 'string'
        ? body
        : JSON.stringify(body);
  const all =
    raw === null ? headers : { 'Content-Type': 'application/json', ...headers };
  const proxy = path.replace(/^\//, '');
  return {
    httpMethod: method,
    path,
    resource: '/{proxy+}',
    pathParameters: proxy ? { proxy } : null,
    headers: all,
    multiValueHeaders: Object.fromEntries(
      Object.entries(all).map(([k, v]) => [k, [v]]),
    ),
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    body: raw,
    isBase64Encoded: false,
    requestContext: { stage: 'production', identity: { sourceIp } },
  } as unknown as APIGatewayProxyEvent;
};

const parse = (headers: Record<string, string[]>, text: string) =>
  headers['content-type']?.[0]?.includes('json') && text
    ? JSON.parse(text)
    : text;

// Cookie minus its value (JWT differs by iat) and Expires (differs by the second).
const cookieShape = (c: string) =>
  c.replace(/^([^=]+)=[^;]*/, '$1=').replace(/; Expires=[^;]*/i, '');

const normalizeHeaders = (h: Record<string, string[]>) =>
  Object.fromEntries(
    Object.entries(h)
      .map(([k, v]) => [k.toLowerCase(), v] as const)
      .filter(([k]) => !TRANSPORT.has(k))
      .map(([k, v]) => [k, k === 'set-cookie' ? v.map(cookieShape) : v]),
  );

describe('Lambda handler (e2e)', () => {
  let app: INestApplication<App>;
  let lambdaApp: INestApplication | undefined;
  const create = vi.spyOn(NestFactory, 'create');

  const invoke = async (req: Req) => {
    const res = (await handler(
      restEvent(req),
      {} as Context,
      () => undefined,
    )) as APIGatewayProxyResult;
    lambdaApp ??= (await create.mock.results[0]?.value) as INestApplication;
    const headers = Object.fromEntries(
      Object.entries(res.multiValueHeaders ?? {}).map(([k, v]) => [
        k.toLowerCase(),
        v.map(String),
      ]),
    );
    return {
      raw: res,
      headers,
      normalized: {
        status: res.statusCode,
        body: parse(headers, res.body),
        headers: normalizeHeaders(headers),
      } as Normalized,
    };
  };

  const viaMain = async ({
    method,
    path,
    headers = {},
    body,
  }: Req): Promise<Normalized> => {
    let r = request(app.getHttpServer())
      [method.toLowerCase() as 'get'](path)
      .set(headers);
    if (body !== undefined) {
      r =
        typeof body === 'string'
          ? r.set('Content-Type', 'application/json').send(body)
          : r.send(body as object);
    }
    const res = await r;
    const h = Object.fromEntries(
      Object.entries(res.headers).map(([k, v]) => [
        k,
        Array.isArray(v) ? v : [String(v)],
      ]),
    );
    return {
      status: res.status,
      body: parse(h, res.text),
      headers: normalizeHeaders(h),
    };
  };

  // Same request through both; returns the Lambda side for further checks.
  const same = async (req: Req) => {
    const main = await viaMain(req);
    const lambda = await invoke(req);
    expect(lambda.normalized).toStrictEqual(main);
    return lambda;
  };

  let email: string;
  let cookie: string;
  let bearer: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await lambdaApp?.close();
    await closeTestApp(app);
  });

  it('GET / and the empty-path root event → Hello World!', async () => {
    const res = await same({ method: 'GET', path: '/' });
    expect(res.normalized.status).toBe(200);
    expect(res.normalized.body).toBe('Hello World!');
    expect(res.headers['content-type'][0]).toContain('text/html');
    const root = await invoke({ method: 'GET', path: '' });
    expect(root.normalized).toStrictEqual(res.normalized);
    // helmet ran.
    expect(res.headers['x-content-type-options']).toStrictEqual(['nosniff']);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('POST /auth: same envelope, one bare-JWT accessToken cookie', async () => {
    email = uniqueEmail();
    await request(app.getHttpServer())
      .post('/users')
      .send({
        email,
        password: PASSWORD,
        firstName: 'F',
        lastName: 'L',
        middleName: '',
      })
      .expect(201);
    const res = await same({
      method: 'POST',
      path: '/auth',
      body: { email, password: PASSWORD },
    });
    expect(res.normalized.status).toBe(201);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(
      /^accessToken=[\w-]+\.[\w-]+\.[\w-]+; .*HttpOnly; Secure; SameSite=Strict$/,
    );
    cookie = cookies[0].slice(0, cookies[0].indexOf(';'));
    bearer = `Bearer ${cookie.slice(cookie.indexOf('=') + 1)}`;
  });

  describe.each([
    ['cookie', () => ({ Cookie: cookie })],
    ['bearer', () => ({ Authorization: bearer })],
  ])('protected routes with %s', (_, auth) => {
    it.each([
      ['GET', '/categories'],
      ['GET', '/account-actions'],
      ['GET', '/budgets'],
      ['GET', '/budget-history'],
      ['GET', `/expenses-actions/${UNKNOWN_ID}/Jan/2026`],
      ['GET', `/records/expenses-and-incomes/${UNKNOWN_ID}/Jan/2026`],
    ])('%s %s', async (method, path) => {
      const res = await same({ method, path, headers: auth() });
      expect(res.normalized.status).toBeLessThan(500);
    });

    it('PUT /users', async () => {
      const res = await same({
        method: 'PUT',
        path: '/users',
        headers: auth(),
        body: { email, firstName: 'Renamed' },
      });
      expect(res.normalized.status).toBe(200);
    });

    it('DELETE /incomes-actions (unknown record)', async () => {
      await same({
        method: 'DELETE',
        path: '/incomes-actions',
        headers: auth(),
        body: { recordId: UNKNOWN_ID },
      });
    });
  });

  it('no token → 401 envelope', async () => {
    const res = await same({ method: 'GET', path: '/account-actions' });
    expect(res.normalized.status).toBe(401);
    expect(res.normalized.body).toStrictEqual({
      ...INITIAL_RESPONSE,
      success: false,
      error: { message: 'Unauthorized', statusCode: 401 },
    });
  });

  it('unknown route → 404 envelope', async () => {
    const res = await same({ method: 'GET', path: '/does-not-exist' });
    expect(res.normalized.status).toBe(404);
    expect(res.normalized.body).toMatchObject({ success: false });
  });

  it('invalid JSON body → 400 envelope', async () => {
    const res = await same({ method: 'POST', path: '/auth', body: '{bad' });
    expect(res.normalized.status).toBe(400);
    expect(res.normalized.body).toMatchObject({ success: false });
  });

  it('CORS preflight allows authorization from a configured origin', async () => {
    const res = await same({
      method: 'OPTIONS',
      path: '/auth',
      headers: {
        Origin: 'http://localhost:4100',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(res.normalized.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toStrictEqual([
      'http://localhost:4100',
    ]);
    expect(res.headers['access-control-allow-credentials']).toStrictEqual([
      'true',
    ]);
    expect(res.headers['access-control-allow-headers'][0]).toContain(
      'authorization',
    );
  });

  it('forgot-password IP bucket follows sourceIp, not X-Forwarded-For', async () => {
    const forgot = (sourceIp: string, xff: string) =>
      invoke({
        method: 'POST',
        path: '/users/forgot-password',
        headers: { 'X-Forwarded-For': xff },
        body: { email: uniqueEmail() },
        sourceIp,
      });
    for (let i = 0; i < 10; i++) {
      expect(
        (await forgot('198.51.100.7', `203.0.113.${i}`)).normalized.status,
      ).toBe(201);
    }
    const blocked = await forgot('198.51.100.7', '203.0.113.99');
    expect(blocked.normalized.status).toBe(429);
    expect(blocked.normalized.body).toStrictEqual({
      ...INITIAL_RESPONSE,
      success: false,
      error: {
        message: 'Too Many Requests',
        error: 'Too Many Requests',
        statusCode: 429,
      },
    });
    expect(
      (await forgot('198.51.100.8', '203.0.113.99')).normalized.status,
    ).toBe(201);
  });

  it('DELETE /users through the handler cleans up; one bootstrap for the whole file', async () => {
    const res = await invoke({
      method: 'DELETE',
      path: '/users',
      headers: { Cookie: cookie },
    });
    expect(res.normalized.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
