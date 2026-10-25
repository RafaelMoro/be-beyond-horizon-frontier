import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { INITIAL_RESPONSE } from '../../constants.js';
import { Test, TestingModule } from '@nestjs/testing';
import { User } from '../entities/user.entity.js';
import { FORGOT_PASSWORD_MAILER } from '../user.constants.js';
import { hashToken } from '../user.utils.js';
import { UserService } from './user.service.js';

const exec = (value: unknown) => ({ exec: vi.fn().mockResolvedValue(value) });

describe('UserService', () => {
  let service: UserService;
  const model = {
    findOne: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findByIdAndDelete: vi.fn(),
    updateOne: vi.fn(),
  };
  const jwtService = { signAsync: vi.fn(), verifyAsync: vi.fn() };
  const mailer = { sendForgotPasswordEmail: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getModelToken(User.name), useValue: model },
        { provide: JwtService, useValue: jwtService },
        { provide: FORGOT_PASSWORD_MAILER, useValue: mailer },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  describe('findById', () => {
    it('returns null for a non-ObjectId string without calling the model', async () => {
      await expect(service.findById('not-an-id')).resolves.toBeNull();
      expect(model.findById).not.toHaveBeenCalled();
    });

    it('looks up a valid ObjectId', async () => {
      const user = { _id: 'x' };
      model.findById.mockReturnValue(exec(user));
      await expect(service.findById('507f1f77bcf86cd799439011')).resolves.toBe(
        user,
      );
    });
  });

  describe('findByEmail', () => {
    it('queries { email } with the raw string', async () => {
      model.findOne.mockReturnValue(exec(null));
      await service.findByEmail('Mixed@Case.com');
      expect(model.findOne).toHaveBeenCalledWith({ email: 'Mixed@Case.com' });
    });
  });

  describe('createUser', () => {
    const dto = {
      email: 'a@b.com',
      password: 'secret',
      firstName: 'A',
      lastName: 'B',
      middleName: '',
    };
    const badRequest = async (p: Promise<unknown>) => {
      const err = await p.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toBe(
        'Try with other email.',
      );
    };

    it('400 when the email already exists', async () => {
      model.findOne.mockReturnValue(exec({ _id: 'x' }));
      await badRequest(service.createUser(dto));
      expect(model.create).not.toHaveBeenCalled();
    });

    it('maps a racing E11000 to the same 400', async () => {
      model.findOne.mockReturnValue(exec(null));
      model.create.mockRejectedValue({ code: 11000 });
      await badRequest(service.createUser(dto));
    });

    it('rethrows any other error untouched', async () => {
      const boom = new Error('boom');
      model.findOne.mockReturnValue(exec(null));
      model.create.mockRejectedValue(boom);
      await expect(service.createUser(dto)).rejects.toBe(boom);
    });

    it('stores a bcrypt hash and returns the legacy body', async () => {
      const _id = new Types.ObjectId();
      model.findOne.mockReturnValue(exec(null));
      model.create.mockImplementation(async (doc: typeof dto) => ({
        ...doc,
        _id,
      }));
      const res = await service.createUser(dto);
      const stored = model.create.mock.calls[0][0] as typeof dto;
      expect(stored.password).not.toBe('secret');
      await expect(bcrypt.compare('secret', stored.password)).resolves.toBe(
        true,
      );
      expect(res).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'User created',
        data: { userCreated: { email: 'a@b.com', sub: _id.toString() } },
      });
    });
  });

  describe('updateUser', () => {
    const sub = '507f1f77bcf86cd799439011';
    const stored = {
      _id: sub,
      email: 'a@b.com',
      firstName: 'A',
      middleName: '',
      lastName: 'B',
    };
    const expect400 = async (p: Promise<unknown>, message: string) => {
      const err = await p.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toBe(message);
      expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
    };

    beforeEach(() => model.findById.mockReturnValue(exec(stored)));

    it('400 User not found.', async () => {
      model.findById.mockReturnValue(exec(null));
      await expect400(
        service.updateUser(sub, { email: 'a@b.com' }),
        'User not found.',
      );
    });

    it.each(['other@b.com', 'A@b.com'])(
      '400 when the email differs (%s)',
      async (email) => {
        await expect400(
          service.updateUser(sub, { email }),
          'You cannot change your email',
        );
      },
    );

    it('email error wins over the password error', async () => {
      await expect400(
        service.updateUser(sub, { email: 'x@b.com', password: 'p' }),
        'You cannot change your email',
      );
    });

    it('400 when password is sent, even with the right email', async () => {
      await expect400(
        service.updateUser(sub, { email: 'a@b.com', password: 'p' }),
        'You cannot change your password directly. Try changing it using forgot password',
      );
    });

    it('writes only string name fields and returns the 4-key userUpdated', async () => {
      model.findByIdAndUpdate.mockReturnValue(
        exec({
          ...stored,
          firstName: 'New',
          oneTimeToken: 'h',
          password: 'hash',
        }),
      );
      const res = await service.updateUser(sub, {
        email: 'a@b.com',
        firstName: 'New',
        lastName: null as unknown as string,
      });
      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        sub,
        { $set: { firstName: 'New' } },
        { returnDocument: 'after' },
      );
      expect(res).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Profile updated',
        data: {
          userUpdated: {
            email: 'a@b.com',
            firstName: 'New',
            middleName: '',
            lastName: 'B',
          },
        },
      });
    });

    it('400 when the user was deleted meanwhile', async () => {
      model.findByIdAndUpdate.mockReturnValue(exec(null));
      await expect(
        service.updateUser(sub, { email: 'a@b.com' }),
      ).rejects.toThrow('User not found.');
    });
  });

  describe('deleteUser', () => {
    it('400 User not found. when nothing was deleted', async () => {
      model.findByIdAndDelete.mockReturnValue(exec(null));
      await expect(
        service.deleteUser('507f1f77bcf86cd799439011'),
      ).rejects.toThrow('User not found.');
    });

    it('returns the legacy body', async () => {
      model.findByIdAndDelete.mockReturnValue(
        exec({
          email: 'a@b.com',
          firstName: 'A',
          lastName: 'B',
          middleName: '',
          password: 'h',
        }),
      );
      await expect(
        service.deleteUser('507f1f77bcf86cd799439011'),
      ).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'User deleted.',
        data: {
          userDeleted: { email: 'a@b.com', firstName: 'A', lastName: 'B' },
        },
      });
    });
  });

  describe('forgotPassword', () => {
    const _id = new Types.ObjectId();
    const user = {
      _id,
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      password: 'h',
    };
    const sent = { ...INITIAL_RESPONSE, message: 'Email Sent', data: null };

    it('unknown email → 201, no write, no send', async () => {
      model.findOne.mockReturnValue(exec(null));
      await expect(
        service.forgotPassword({ email: 'x@y.com' }),
      ).resolves.toStrictEqual(sent);
      expect(model.updateOne).not.toHaveBeenCalled();
      expect(mailer.sendForgotPasswordEmail).not.toHaveBeenCalled();
    });

    it('known email stores the hash (never the raw token) and mails the raw token', async () => {
      model.findOne.mockReturnValue(exec(user));
      model.updateOne.mockReturnValue(exec({ matchedCount: 1 }));
      jwtService.signAsync.mockResolvedValue('raw.one.time');
      await expect(
        service.forgotPassword({ email: 'a@b.com' }),
      ).resolves.toStrictEqual(sent);
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: _id.toString(),
      });
      expect(model.updateOne).toHaveBeenCalledWith(
        { _id },
        { $set: { oneTimeToken: hashToken('raw.one.time') } },
      );
      expect(JSON.stringify(model.updateOne.mock.calls)).not.toContain(
        'raw.one.time',
      );
      expect(mailer.sendForgotPasswordEmail).toHaveBeenCalledWith({
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        oneTimeToken: 'raw.one.time',
      });
    });

    it('answers only after the send resolves', async () => {
      model.findOne.mockReturnValue(exec(user));
      model.updateOne.mockReturnValue(exec({ matchedCount: 1 }));
      jwtService.signAsync.mockResolvedValue('raw.one.time');
      let finishSend!: () => void;
      mailer.sendForgotPasswordEmail.mockReturnValue(
        new Promise<void>((r) => (finishSend = r)),
      );
      let settled = false;
      const res = service.forgotPassword({ email: 'a@b.com' }).finally(() => {
        settled = true;
      });
      await vi.waitFor(() =>
        expect(mailer.sendForgotPasswordEmail).toHaveBeenCalled(),
      );
      await new Promise((r) => setImmediate(r));
      expect(settled).toBe(false);
      finishSend();
      await expect(res).resolves.toStrictEqual(sent);
    });
  });

  describe('resetPassword', () => {
    const sub = new Types.ObjectId().toString();
    const raw = 'raw.one.time';
    const expect400 = async (message: string) => {
      const err = await service
        .resetPassword(raw, 'new-pw')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toStrictEqual({
        message,
        error: 'Bad Request',
        statusCode: 400,
      });
    };

    beforeEach(() => {
      jwtService.verifyAsync.mockResolvedValue({ sub });
      model.findById.mockReturnValue(
        exec({ _id: sub, oneTimeToken: hashToken(raw) }),
      );
      model.updateOne.mockReturnValue(exec({ matchedCount: 1 }));
    });

    // Real @nestjs/jwt errors: proves v12 surfaces jsonwebtoken's names and messages unchanged.
    it.each([
      ['jwt malformed', () => 'not-a-jwt'],
      [
        'invalid signature',
        () => new JwtService({ secret: 'other' }).signAsync({ sub }),
      ],
      [
        'jwt expired',
        () => new JwtService({ secret: 'k' }).signAsync({ sub, exp: 1 }),
      ],
      [
        'jwt not active',
        () =>
          new JwtService({ secret: 'k' }).signAsync(
            { sub },
            { notBefore: '1h' },
          ),
      ],
    ])(
      'passes the jsonwebtoken message %s as a 400',
      async (message, token) => {
        const real = new JwtService({ secret: 'k' });
        const t = await token();
        jwtService.verifyAsync.mockImplementation(() => real.verifyAsync(t));
        await expect400(message);
        expect(model.findById).not.toHaveBeenCalled();
      },
    );

    it('rethrows a non-jwt error untouched', async () => {
      const boom = new Error('boom');
      jwtService.verifyAsync.mockRejectedValue(boom);
      await expect(service.resetPassword(raw, 'x')).rejects.toBe(boom);
    });

    it('a bad ObjectId sub → User not found.', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'nope' });
      await expect400('User not found.');
      expect(model.findById).not.toHaveBeenCalled();
    });

    it('user missing → User not found.', async () => {
      model.findById.mockReturnValue(exec(null));
      await expect400('User not found.');
    });

    it('no stored token → JWT not found.', async () => {
      model.findById.mockReturnValue(exec({ _id: sub }));
      await expect400('JWT not found.');
    });

    it('hash mismatch (incl. a legacy plaintext token) → Wrong JWT', async () => {
      model.findById.mockReturnValue(exec({ _id: sub, oneTimeToken: raw }));
      await expect400('Wrong JWT');
      expect(model.updateOne).not.toHaveBeenCalled();
    });

    it('a lost concurrent reset (matchedCount 0) → Wrong JWT', async () => {
      model.updateOne.mockReturnValue(exec({ matchedCount: 0 }));
      await expect400('Wrong JWT');
    });

    it('writes hash + passwordChangedAt + $unset in one filtered call', async () => {
      await expect(service.resetPassword(raw, 'new-pw')).resolves.toStrictEqual(
        {
          ...INITIAL_RESPONSE,
          message: 'Reset Password Successfully',
          data: null,
        },
      );
      expect(model.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update] = model.updateOne.mock.calls[0];
      expect(filter).toStrictEqual({ _id: sub, oneTimeToken: hashToken(raw) });
      expect(update.$unset).toStrictEqual({ oneTimeToken: '' });
      expect(update.$set.passwordChangedAt).toBeInstanceOf(Date);
      await expect(
        bcrypt.compare('new-pw', update.$set.password),
      ).resolves.toBe(true);
    });
  });
});
