import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { UserService } from '../../user/services/user.service.js';
import { DUMMY_PASSWORD_HASH, LOGIN_ERROR } from '../auth.constants.js';
import { AuthService } from './auth.service.js';

// Prod hashes are `$2a$` cost 10 (legacy bcryptjs 2); bcryptjs 3 must still verify them.
const LEGACY_HASH =
  '$2a$10$hzeXHVtXUanyE/pOwa1F8uGUhqBipLtle1Y99FeNOqfMf80kgpoJC';
const LEGACY_PASSWORD = 'legacy-fixture-pw';

describe('AuthService', () => {
  let service: AuthService;
  const userService = { findByEmail: vi.fn() };
  const jwtService = { signAsync: vi.fn() };
  const _id = new Types.ObjectId();
  const user = {
    _id,
    email: 'a@b.com',
    password: LEGACY_HASH,
    firstName: 'A',
    lastName: 'B',
    middleName: '',
    oneTimeToken: 'stored-hash',
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    jwtService.signAsync.mockResolvedValue('signed.jwt.token');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();
    service = module.get<AuthService>(AuthService);
  });

  it('bcryptjs 3 verifies a legacy $2a$ cost-10 hash', async () => {
    await expect(bcrypt.compare(LEGACY_PASSWORD, LEGACY_HASH)).resolves.toBe(
      true,
    );
    await expect(bcrypt.compare('wrong', LEGACY_HASH)).resolves.toBe(false);
  });

  it('DUMMY_PASSWORD_HASH is a valid cost-10 bcrypt hash', () => {
    expect(bcrypt.getRounds(DUMMY_PASSWORD_HASH)).toBe(10);
  });

  it.each([
    {},
    { email: 'a@b.com' },
    { password: 'x' },
    { email: '', password: 'x' },
    { email: 'a@b.com', password: '' },
    { email: { $gt: '' }, password: 'x' },
    { email: 'a@b.com', password: 1 },
  ])('message-less 401 without calling findByEmail for %j', async (body) => {
    const err = await service.login(body).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toStrictEqual({
      message: 'Unauthorized',
      statusCode: 401,
    });
    expect(userService.findByEmail).not.toHaveBeenCalled();
  });

  it('unknown email still runs bcrypt against the dummy hash, then 401 LOGIN_ERROR', async () => {
    userService.findByEmail.mockResolvedValue(null);
    const compare = vi.spyOn(bcrypt, 'compare');
    const err = await service
      .login({ email: 'x@y.com', password: 'p' })
      .catch((e: unknown) => e);
    expect(compare).toHaveBeenCalledWith('p', DUMMY_PASSWORD_HASH);
    expect((err as UnauthorizedException).getResponse()).toStrictEqual({
      message: LOGIN_ERROR,
      error: 'Unauthorized',
      statusCode: 401,
    });
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('wrong password → 401 LOGIN_ERROR', async () => {
    userService.findByEmail.mockResolvedValue(user);
    await expect(
      service.login({ email: user.email, password: 'wrong' }),
    ).rejects.toThrow(LOGIN_ERROR);
  });

  it('success signs exactly { sub } and returns the 5 public user keys', async () => {
    userService.findByEmail.mockResolvedValue(user);
    const { accessToken, response } = await service.login({
      email: user.email,
      password: LEGACY_PASSWORD,
      extra: 1,
    } as never);
    expect(jwtService.signAsync).toHaveBeenCalledWith({ sub: _id.toString() });
    expect(accessToken).toBe('signed.jwt.token');
    expect(response.message).toBeNull();
    expect(response.data).toStrictEqual({
      user: {
        _id,
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        middleName: '',
      },
    });
  });
});
