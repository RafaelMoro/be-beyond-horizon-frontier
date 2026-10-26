import { NestFactory } from '@nestjs/core';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

// The real AppModule runs Joi validation at import time.
vi.mock('./app.module.js', () => ({ AppModule: class {} }));
vi.mock('./configure-app.js', () => ({ configureApp: vi.fn() }));
vi.mock('@codegenie/serverless-express', () => ({ configure: vi.fn() }));

const context = {} as Context;
const callback = () => undefined;
const event = (path?: string) =>
  ({ httpMethod: 'GET', path }) as unknown as APIGatewayProxyEvent;

describe('lambda handler', () => {
  let proxy: ReturnType<typeof vi.fn>;
  let app: {
    init: ReturnType<typeof vi.fn>;
    listen: ReturnType<typeof vi.fn>;
    getHttpAdapter: () => { getInstance: () => string };
  };
  let create: ReturnType<typeof vi.spyOn>;
  let configureApp: ReturnType<typeof vi.fn>;
  let configure: ReturnType<typeof vi.fn>;
  const order: string[] = [];

  // Fresh module per test: the bootstrap cache is module state.
  const load = async () => {
    vi.resetModules();
    configureApp = vi.mocked(
      (await import('./configure-app.js')).configureApp,
    ) as never;
    configureApp.mockImplementation(() => order.push('configureApp'));
    configure = vi.mocked(
      (await import('@codegenie/serverless-express')).configure,
    ) as never;
    configure.mockReturnValue(proxy);
    return (await import('./lambda.js')).handler;
  };

  beforeEach(() => {
    order.length = 0;
    proxy = vi.fn().mockResolvedValue({ statusCode: 200 });
    app = {
      init: vi.fn(async () => {
        order.push('init');
      }),
      listen: vi.fn(),
      getHttpAdapter: () => ({ getInstance: () => 'express-instance' }),
    };
    create = vi.spyOn(NestFactory, 'create').mockResolvedValue(app as never);
  });

  afterEach(() => vi.restoreAllMocks());

  it('bootstraps once across invocations and proxies each one', async () => {
    const handler = await load();
    const e1 = event('/auth');
    const e2 = event('/users');
    await expect(handler(e1, context, callback)).resolves.toStrictEqual({
      statusCode: 200,
    });
    await handler(e2, context, callback);
    expect(create).toHaveBeenCalledTimes(1);
    expect(configureApp).toHaveBeenCalledTimes(1);
    expect(app.init).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenCalledWith({ app: 'express-instance' });
    expect(proxy).toHaveBeenCalledTimes(2);
    expect(proxy).toHaveBeenNthCalledWith(1, e1, context, callback);
    expect(proxy).toHaveBeenNthCalledWith(2, e2, context, callback);
  });

  it('concurrent first invocations share one bootstrap', async () => {
    const handler = await load();
    await Promise.all([
      handler(event('/'), context, callback),
      handler(event('/'), context, callback),
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  it('configures before init and never listens', async () => {
    const handler = await load();
    await handler(event('/'), context, callback);
    expect(order).toStrictEqual(['configureApp', 'init']);
    expect(app.listen).not.toHaveBeenCalled();
  });

  it('a failed bootstrap rejects that invocation and the next one retries', async () => {
    const handler = await load();
    create.mockRejectedValueOnce(new Error('boom'));
    await expect(handler(event('/'), context, callback)).rejects.toThrow(
      'boom',
    );
    await expect(handler(event('/'), context, callback)).resolves.toStrictEqual(
      { statusCode: 200 },
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(proxy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['', '/'],
    [undefined, '/'],
    ['/auth', '/auth'],
  ])('path %j → %j', async (path, expected) => {
    const handler = await load();
    const e = event(path);
    await handler(e, context, callback);
    expect(proxy.mock.calls[0][0].path).toBe(expected);
  });
});
