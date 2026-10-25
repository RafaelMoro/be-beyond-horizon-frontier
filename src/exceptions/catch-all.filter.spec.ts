import { ArgumentsHost, Logger } from '@nestjs/common';
import mongoose from 'mongoose';
import { INITIAL_RESPONSE } from '../constants.js';
import { CatchAllExceptionFilter } from './catch-all.filter.js';

function fakeHost(headersSent = false) {
  const res = {
    headersSent,
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
    end: vi.fn(),
  };
  const req = {
    method: 'GET',
    route: { path: '/x/:id' },
    originalUrl: '/x/SECRET-TOKEN',
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('CatchAllExceptionFilter', () => {
  const filter = new CatchAllExceptionFilter();
  let error: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const run = (exception: unknown) => {
    const { host, res } = fakeHost();
    filter.catch(exception, host);
    return {
      status: res.status.mock.calls[0][0],
      body: res.send.mock.calls[0][0],
    };
  };
  const logs = () => JSON.stringify([...error.mock.calls, ...warn.mock.calls]);

  it('maps a CastError to 400 Invalid <path>', () => {
    const { status, body } = run(
      new mongoose.Error.CastError('ObjectId', 'bad', '_id'),
    );
    expect(status).toBe(400);
    expect(body).toStrictEqual({
      ...INITIAL_RESPONSE,
      success: false,
      error: { message: 'Invalid _id', error: 'Bad Request', statusCode: 400 },
    });
  });

  it('maps a BSONError to 400 Invalid id', () => {
    let bson: unknown;
    try {
      new mongoose.Types.ObjectId('bad');
    } catch (e) {
      bson = e;
    }
    const { status, body } = run(bson);
    expect(status).toBe(400);
    expect(body.error.message).toBe('Invalid id');
  });

  it('maps a ValidationError to 400 with every field message', () => {
    const v = new mongoose.Error.ValidationError();
    v.addError(
      'name',
      new mongoose.Error.ValidatorError({ message: 'name is required' }),
    );
    v.addError(
      'email',
      new mongoose.Error.ValidatorError({ message: 'email is invalid' }),
    );
    const { status, body } = run(v);
    expect(status).toBe(400);
    expect(body.error).toStrictEqual({
      message: ['name is required', 'email is invalid'],
      error: 'Bad Request',
      statusCode: 400,
    });
  });

  it('maps E11000 to 409 without leaking the duplicated value', () => {
    const dup = Object.assign(
      new Error('E11000 duplicate key error { email: "a@b.c" }'),
      { code: 11000, keyPattern: { email: 1 }, keyValue: { email: 'a@b.c' } },
    );
    const { status, body } = run(dup);
    expect(status).toBe(409);
    expect(body.error).toStrictEqual({
      message: 'Duplicate value',
      error: 'Conflict',
      statusCode: 409,
    });
    expect(JSON.stringify(body)).not.toContain('a@b.c');
    expect(logs()).not.toContain('a@b.c');
  });

  it('keeps an exposed http-errors status', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      expose: true,
      type: 'entity.too.large',
    });
    const { status, body } = run(tooLarge);
    expect(status).toBe(413);
    expect(body.error).toStrictEqual({
      statusCode: 413,
      message: 'request entity too large',
    });
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ['a plain object', { statusCode: 413, expose: true, message: 'x' }],
    [
      'an Error with status !== statusCode',
      Object.assign(new Error('x'), {
        status: 400,
        statusCode: 413,
        expose: true,
      }),
    ],
  ])('turns %s into 500', (_, e) => {
    expect(run(e).status).toBe(500);
  });

  it('turns a non-exposed 5xx http-error into a logged 500', () => {
    const e = Object.assign(new Error('upstream'), {
      status: 502,
      statusCode: 502,
      expose: false,
    });
    expect(run(e).status).toBe(500);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('turns an unknown Error into the generic 500 and logs it once', () => {
    const { status, body } = run(new Error('db password leaked'));
    expect(status).toBe(500);
    expect(body).toStrictEqual({
      ...INITIAL_RESPONSE,
      success: false,
      error: { statusCode: 500, message: 'Internal server error' },
    });
    expect(JSON.stringify(body)).not.toContain('leaked');
    expect(error).toHaveBeenCalledTimes(1);
    expect(logs()).toContain('/x/:id');
    expect(logs()).not.toContain('SECRET-TOKEN');
  });

  it('handles a thrown string', () => {
    expect(run('x').status).toBe(500);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('only ends the response when headers were already sent', () => {
    const { host, res } = fakeHost(true);
    filter.catch(new Error('x'), host);
    expect(res.end).toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });
});
