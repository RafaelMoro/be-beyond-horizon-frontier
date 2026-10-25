import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { INITIAL_RESPONSE } from '../constants.js';

@Catch(HttpException)
export class GeneralAppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GeneralAppExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    if (res.headersSent) {
      res.end();
      return;
    }
    const status = exception.getStatus();
    if (status >= 500) {
      const req = ctx.getRequest<Request>();
      // Route pattern, never the URL: reset-password URLs carry a live token.
      this.logger.error(
        `${req.method} ${req.route?.path ?? '<unmatched>'} ${status}`,
        exception.stack,
      );
    }
    res.status(status).send({
      ...INITIAL_RESPONSE,
      success: false,
      error: exception.getResponse(),
    });
  }
}
