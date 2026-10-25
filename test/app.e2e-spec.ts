import {
  Body,
  Controller,
  Get,
  INestApplication,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { IsString } from 'class-validator';
import type { Request } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { Public } from '../src/auth/decorators/public.decorator.js';
import { INITIAL_RESPONSE } from '../src/constants.js';
import { closeTestApp, createTestApp } from './create-test-app.js';

// Test-only routes, never shipped.
class ProbeDto {
  @IsString()
  name: string;
}

@Public()
@Controller()
class ProbeController {
  @Post('probe')
  probe(@Body() dto: ProbeDto) {
    return { ...INITIAL_RESPONSE, data: dto };
  }

  @Get('boom')
  boom() {
    throw new Error('internal secret');
  }

  @Get('cookies')
  cookies(@Req() req: Request) {
    return req.cookies;
  }
}

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ProbeController] });
  });

  afterAll(async () => {
    // app is undefined when createTestApp refused the URI.
    if (app) await closeTestApp(app);
  });

  afterEach(() => vi.restoreAllMocks());

  it('GET / returns Hello World! as text/html', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.text).toBe('Hello World!');
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('POST /probe rejects an unknown property with the legacy 400 body', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe')
      .send({ name: 'a', extra: 1 })
      .expect(400);
    expect(res.body).toStrictEqual({
      version: INITIAL_RESPONSE.version,
      success: false,
      data: null,
      message: null,
      error: {
        message: ['property extra should not exist'],
        error: 'Bad Request',
        statusCode: 400,
      },
    });
  });

  it('POST /probe returns the envelope on success', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe')
      .send({ name: 'a' })
      .expect(201);
    expect(res.body).toStrictEqual({
      ...INITIAL_RESPONSE,
      data: { name: 'a' },
    });
  });

  it('POST /probe over 100 kb keeps the 413 inside the envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe')
      .send({ name: 'x'.repeat(110_000) })
      .expect(413);
    expect(res.body).toMatchObject({
      success: false,
      data: null,
      error: { statusCode: 413, message: 'request entity too large' },
    });
  });

  it('POST /probe with invalid JSON gives an enveloped 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    expect(res.body).toMatchObject({
      success: false,
      data: null,
      error: { statusCode: 400 },
    });
  });

  it('GET /boom gives the generic enveloped 500', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const res = await request(app.getHttpServer()).get('/boom').expect(500);
    expect(res.body).toStrictEqual({
      ...INITIAL_RESPONSE,
      success: false,
      error: { statusCode: 500, message: 'Internal server error' },
    });
    expect(res.text).not.toContain('internal secret');
  });

  it('answers a CORS preflight from a listed origin with credentials', async () => {
    const res = await request(app.getHttpServer())
      .options('/')
      .set('Origin', 'http://localhost:4100')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:4100',
    );
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']).toContain(
      'authorization',
    );
  });

  it('omits Allow-Origin for an unlisted origin', async () => {
    const res = await request(app.getHttpServer())
      .options('/')
      .set('Origin', 'http://evil.test')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('parses cookies', async () => {
    const res = await request(app.getHttpServer())
      .get('/cookies')
      .set('Cookie', 'accessToken=abc')
      .expect(200);
    expect(res.body).toStrictEqual({ accessToken: 'abc' });
  });
});
