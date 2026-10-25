import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_MAX_AGE_MS,
} from '../auth.constants.js';
import type { LoginBody } from '../auth.interface.js';
import { Public } from '../decorators/public.decorator.js';
import { AuthService } from '../services/auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Credentials come only from the body. `accessToken` must stay the first (and only) Set-Cookie: the client reads
  // set-cookie[0] as a bare JWT, so nothing else on this route may set or clear a cookie.
  @Public()
  @Post()
  async login(
    @Body() body: LoginBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, response } = await this.authService.login(body);
    res.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: ACCESS_TOKEN_MAX_AGE_MS,
    });
    return response;
  }
}
