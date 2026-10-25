import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { UserService } from '../../user/services/user.service.js';
import { extractToken } from '../auth.utils.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const req = (r: {
  cookies?: Record<string, unknown>;
  authorization?: string;
}) =>
  ({
    cookies: r.cookies ?? {},
    headers: { authorization: r.authorization },
  }) as unknown as Request;

describe('extractToken', () => {
  it('prefers the cookie over Bearer', () => {
    expect(
      extractToken(
        req({ cookies: { accessToken: 'c' }, authorization: 'Bearer h' }),
      ),
    ).toBe('c');
  });
  it('accepts a lower-case bearer scheme', () => {
    expect(extractToken(req({ authorization: 'bearer h' }))).toBe('h');
  });
  it('ignores other schemes', () => {
    expect(extractToken(req({ authorization: 'Basic abc' }))).toBeUndefined();
  });
  it('falls back to the header for an empty cookie', () => {
    expect(
      extractToken(
        req({ cookies: { accessToken: '' }, authorization: 'Bearer h' }),
      ),
    ).toBe('h');
  });
  it('returns undefined without either', () => {
    expect(extractToken(req({}))).toBeUndefined();
  });
});

describe('JwtAuthGuard', () => {
  const reflector = { getAllAndOverride: vi.fn() };
  const jwtService = { verifyAsync: vi.fn() };
  const userService = { findById: vi.fn() };
  const guard = new JwtAuthGuard(
    reflector as unknown as Reflector,
    jwtService as unknown as JwtService,
    userService as unknown as UserService,
  );
  const sub = '507f1f77bcf86cd799439011';
  const iat = 1_700_000_000;
  const payload = { sub, iat, exp: iat + 1000 };
  let request: Request & { user?: unknown };
  const ctx = () =>
    ({
      getHandler: () => 'h',
      getClass: () => 'c',
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;
  const expect401 = async () => {
    const err = await guard.canActivate(ctx()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toStrictEqual({
      message: 'Unauthorized',
      statusCode: 401,
    });
  };

  beforeEach(() => {
    vi.resetAllMocks();
    request = req({ authorization: 'Bearer t' });
    reflector.getAllAndOverride.mockReturnValue(undefined);
    jwtService.verifyAsync.mockResolvedValue(payload);
    userService.findById.mockResolvedValue({ _id: sub });
  });

  it('lets a public handler or class through without verifying', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('isPublic', [
      'h',
      'c',
    ]);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('401 without a token', async () => {
    request = req({});
    await expect401();
  });

  it('401 when verify throws', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    await expect401();
  });

  it('401 when the user is missing (incl. a bad ObjectId sub → findById null)', async () => {
    userService.findById.mockResolvedValue(null);
    await expect401();
  });

  it('401 when iat is one second before passwordChangedAt', async () => {
    userService.findById.mockResolvedValue({
      passwordChangedAt: new Date((iat + 1) * 1000),
    });
    await expect401();
  });

  it('passes when iat is in the same second as passwordChangedAt', async () => {
    userService.findById.mockResolvedValue({
      passwordChangedAt: new Date(iat * 1000 + 999),
    });
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
  });

  it('passes without passwordChangedAt and sets req.user to the payload', async () => {
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('t');
    expect(userService.findById).toHaveBeenCalledWith(sub);
    expect(request.user).toBe(payload);
  });
});
