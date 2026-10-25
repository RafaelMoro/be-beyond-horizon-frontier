import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { INITIAL_RESPONSE } from '../constants.js';

interface Mapped {
  status: number;
  error: object;
}

const badRequest = (message: string | string[]): Mapped => ({
  status: 400,
  error: { message, error: 'Bad Request', statusCode: 400 },
});

// Express `http-errors` (e.g. 413 body too large), same signature check as Nest's base filter.
function isExposedHttpError(e: unknown): e is Error & { statusCode: number } {
  if (!(e instanceof Error)) return false;
  const { expose, statusCode, status } = e as Error & {
    expose?: unknown;
    statusCode?: unknown;
    status?: unknown;
  };
  return (
    typeof expose === 'boolean' &&
    expose &&
    typeof statusCode === 'number' &&
    Number.isInteger(statusCode) &&
    status === statusCode &&
    statusCode >= 400 &&
    statusCode <= 599
  );
}

// Registered before GeneralAppExceptionFilter, so HttpExceptions never reach it.
// No raw library message ever reaches the body.
@Catch()
export class CatchAllExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(CatchAllExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    if (res.headersSent) {
      res.end();
      return;
    }
    const req = ctx.getRequest<Request>();
    // Route pattern, never the URL: reset-password URLs carry a live token.
    const route = `${req.method} ${req.route?.path ?? '<unmatched>'}`;
    const { status, error } = this.map(exception, route);
    res.status(status).send({ ...INITIAL_RESPONSE, success: false, error });
  }

  private map(e: unknown, route: string): Mapped {
    if (e instanceof mongoose.Error.CastError) {
      // The message holds the client's value, so only the path is logged.
      this.logger.warn(`${route} 400 CastError path=${e.path}`);
      return badRequest(`Invalid ${e.path}`);
    }
    if (e instanceof Error && e.name === 'BSONError') {
      this.logger.warn(`${route} 400 BSONError`);
      return badRequest('Invalid id');
    }
    if (e instanceof mongoose.Error.ValidationError) {
      // After DTO validation this usually means a server bug, so keep the stack.
      this.logger.warn(`${route} 400 ValidationError`, e.stack);
      return badRequest(Object.values(e.errors).map((err) => err.message));
    }
    if ((e as { code?: unknown } | null)?.code === 11000) {
      // E11000 message and keyValue contain the duplicated value (emails): log keyPattern only.
      const { keyPattern } = e as { keyPattern?: object };
      this.logger.warn(
        `${route} 409 E11000 keyPattern=${JSON.stringify(keyPattern)}`,
      );
      return {
        status: 409,
        error: {
          message: 'Duplicate value',
          error: 'Conflict',
          statusCode: 409,
        },
      };
    }
    if (isExposedHttpError(e)) {
      return {
        status: e.statusCode,
        error: { statusCode: e.statusCode, message: e.message },
      };
    }
    this.logger.error(`${route} 500`, e instanceof Error ? e.stack : String(e));
    return {
      status: 500,
      error: { statusCode: 500, message: 'Internal server error' },
    };
  }
}
