import {
  ArgumentsHost,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { INITIAL_RESPONSE } from '../constants.js';
import { GeneralAppExceptionFilter } from './http-exception.filter.js';

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

describe('GeneralAppExceptionFilter', () => {
  const filter = new GeneralAppExceptionFilter();
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends the legacy body for a validation 400', () => {
    const { host, res } = fakeHost();
    filter.catch(
      new BadRequestException(['property extra should not exist']),
      host,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({
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
    expect(error).not.toHaveBeenCalled();
  });

  it('sends the legacy 401 body', () => {
    const { host, res } = fakeHost();
    filter.catch(new UnauthorizedException(), host);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send.mock.calls[0][0].error).toStrictEqual({
      message: 'Unauthorized',
      statusCode: 401,
    });
  });

  it('logs a 5xx once with the route pattern, never the URL', () => {
    const { host } = fakeHost();
    filter.catch(new InternalServerErrorException(), host);
    expect(error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(error.mock.calls[0]);
    expect(logged).toContain('/x/:id');
    expect(logged).not.toContain('SECRET-TOKEN');
  });

  it('only ends the response when headers were already sent', () => {
    const { host, res } = fakeHost(true);
    filter.catch(new BadRequestException(), host);
    expect(res.end).toHaveBeenCalled();
    expect(res.send).not.toHaveBeenCalled();
  });
});
