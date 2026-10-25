import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { ClientSession } from 'mongoose';
import { INITIAL_RESPONSE } from '../../constants.js';
import { ACCOUNT_RECORDS_CASCADE } from '../account.constants.js';
import type {
  CreateAccountDto,
  UpdateAccountDto,
} from '../dtos/account.dto.js';
import { Account } from '../entities/account.entity.js';
import { AccountService } from './account.service.js';

const exec = (value: unknown) => ({ exec: vi.fn().mockResolvedValue(value) });
const SUB = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439099';
const AID = '64b7f0c2a1b2c3d4e5f60718';
const DIGITS = 'Termination digits must be a 4-digit number (digits only).';
const PROVIDER = 'Invalid account provider';
const rejectsWith = async (
  p: Promise<unknown>,
  type:
    | typeof BadRequestException
    | typeof NotFoundException
    | typeof UnauthorizedException,
  message: string,
) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(type);
  expect((err as Error).message).toBe(message);
};
const cash = {
  title: 'Cash',
  alias: 'C',
  accountType: 'Efectivo',
  amount: 10,
  backgroundColor: 'red',
  color: 'white',
};
const update = (fields: object) =>
  ({ accountId: AID, ...fields }) as unknown as UpdateAccountDto;

describe('AccountService', () => {
  let service: AccountService;
  const model = {
    find: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findOneAndDelete: vi.fn(),
  };
  const session = { id: 'fake-session' } as unknown as ClientSession;
  const connection = { transaction: vi.fn() };
  const cascade = { deleteAccountRecords: vi.fn() };
  // findById(id).select('sub').session(s).exec() → { sub } | null
  const ownerQuery = { select: vi.fn(), session: vi.fn(), exec: vi.fn() };
  const owner = (sub: string | null) =>
    ownerQuery.exec.mockResolvedValue(sub === null ? null : { sub });

  beforeEach(async () => {
    vi.resetAllMocks();
    connection.transaction.mockImplementation(
      (fn: (s: unknown) => Promise<unknown>) => fn(session),
    );
    cascade.deleteAccountRecords.mockResolvedValue({
      numberExpensesDeleted: 2,
      numberIncomesDeleted: 3,
    });
    model.findById.mockReturnValue(ownerQuery);
    ownerQuery.select.mockReturnValue(ownerQuery);
    ownerQuery.session.mockReturnValue(ownerQuery);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: getModelToken(Account.name), useValue: model },
        { provide: getConnectionToken(), useValue: connection },
        { provide: ACCOUNT_RECORDS_CASCADE, useValue: cascade },
      ],
    }).compile();

    service = module.get<AccountService>(AccountService);
  });

  describe('findByUser', () => {
    it('queries { sub } with no projection and wraps the list', async () => {
      const accounts = [{ title: 'A' }];
      model.find.mockReturnValue(exec(accounts));
      await expect(service.findByUser(SUB)).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { accounts },
      });
      expect(model.find).toHaveBeenCalledWith({ sub: SUB });
    });
  });

  describe('createAccount', () => {
    it('stores the sub and returns the created doc', async () => {
      const dto = {
        ...cash,
        accountProvider: 'visa',
        terminationFourDigits: '1234',
      };
      const account = { ...dto, sub: SUB };
      model.create.mockResolvedValue(account);
      await expect(service.createAccount(SUB, dto)).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Account created',
        data: { account },
      });
      expect(model.create).toHaveBeenCalledWith({ ...dto, sub: SUB });
    });

    it('skips the card checks when absent or null, and drops null keys', async () => {
      model.create.mockResolvedValue({});
      await service.createAccount(SUB, cash);
      await service.createAccount(SUB, {
        ...cash,
        accountProvider: null,
        terminationFourDigits: null,
      } as unknown as CreateAccountDto);
      expect(model.create).toHaveBeenNthCalledWith(1, { ...cash, sub: SUB });
      expect(model.create).toHaveBeenNthCalledWith(2, { ...cash, sub: SUB });
    });

    it('digits error wins over provider error', async () => {
      await rejectsWith(
        service.createAccount(SUB, {
          ...cash,
          accountProvider: 'Visa',
          terminationFourDigits: '12a4',
        }),
        BadRequestException,
        DIGITS,
      );
      expect(model.create).not.toHaveBeenCalled();
    });

    it.each(['123', '12345', '12a4', ' 1234'])(
      'rejects digits %j',
      async (d) => {
        await rejectsWith(
          service.createAccount(SUB, { ...cash, terminationFourDigits: d }),
          BadRequestException,
          DIGITS,
        );
      },
    );

    it.each(['Visa', 'amex', 'VISA', ''])('rejects provider %j', async (p) => {
      await rejectsWith(
        service.createAccount(SUB, { ...cash, accountProvider: p }),
        BadRequestException,
        PROVIDER,
      );
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  describe('updateAccount', () => {
    it('400 not found for a missing account, without checks or write', async () => {
      owner(null);
      await rejectsWith(
        service.updateAccount(SUB, update({ terminationFourDigits: 'x' })),
        BadRequestException,
        'Account not found',
      );
      expect(model.findById).toHaveBeenCalledWith(AID);
      expect(ownerQuery.select).toHaveBeenCalledWith('sub');
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('400 unauthorized for a foreign account, before the card checks', async () => {
      owner(OTHER);
      await rejectsWith(
        service.updateAccount(SUB, update({ terminationFourDigits: 'x' })),
        BadRequestException,
        'Account does not belong to the user',
      );
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('digits before provider, no write', async () => {
      owner(SUB);
      await rejectsWith(
        service.updateAccount(
          SUB,
          update({ terminationFourDigits: '1', accountProvider: 'x' }),
        ),
        BadRequestException,
        DIGITS,
      );
      await rejectsWith(
        service.updateAccount(SUB, update({ accountProvider: 'x' })),
        BadRequestException,
        PROVIDER,
      );
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('filters { _id, sub } and $sets present non-null fields only, keeping amount 0', async () => {
      owner(SUB);
      const account = { _id: AID, title: 'New', amount: 0 };
      model.findOneAndUpdate.mockReturnValue(exec(account));
      await expect(
        service.updateAccount(
          SUB,
          update({ title: 'New', amount: 0, alias: null, sub: OTHER }),
        ),
      ).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Account Updated',
        data: { account },
      });
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: AID, sub: SUB },
        { $set: { title: 'New', amount: 0 } },
        { returnDocument: 'after' },
      );
    });

    it('400 not found when the write matches nothing', async () => {
      owner(SUB);
      model.findOneAndUpdate.mockReturnValue(exec(null));
      await rejectsWith(
        service.updateAccount(SUB, update({})),
        BadRequestException,
        'Account not found',
      );
    });
  });

  describe('deleteAccount', () => {
    it('400 for a missing account, nothing called', async () => {
      owner(null);
      await rejectsWith(
        service.deleteAccount(SUB, { accountId: AID }),
        BadRequestException,
        'Account not found',
      );
      expect(cascade.deleteAccountRecords).not.toHaveBeenCalled();
      expect(model.findOneAndDelete).not.toHaveBeenCalled();
    });

    it('401 for a foreign account, nothing called', async () => {
      owner(OTHER);
      await rejectsWith(
        service.deleteAccount(SUB, { accountId: AID }),
        UnauthorizedException,
        'Account does not belong to the user',
      );
      expect(cascade.deleteAccountRecords).not.toHaveBeenCalled();
      expect(model.findOneAndDelete).not.toHaveBeenCalled();
    });

    it('runs read, cascade and delete in the transaction session', async () => {
      owner(SUB);
      const accountDeleted = { _id: AID };
      model.findOneAndDelete.mockReturnValue(exec(accountDeleted));
      const res = await service.deleteAccount(SUB, { accountId: AID });
      expect(res).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Account Deleted',
        data: {
          accountDeleted,
          numberExpensesDeleted: 2,
          numberIncomesDeleted: 3,
        },
      });
      expect(Object.keys(res.data as object)).toStrictEqual([
        'accountDeleted',
        'numberExpensesDeleted',
        'numberIncomesDeleted',
      ]);
      expect(ownerQuery.session).toHaveBeenCalledWith(session);
      expect(cascade.deleteAccountRecords).toHaveBeenCalledWith({
        accountId: AID,
        sub: SUB,
        session,
      });
      expect(model.findOneAndDelete).toHaveBeenCalledWith(
        { _id: AID, sub: SUB },
        { session },
      );
    });

    it('400 when the delete matches nothing', async () => {
      owner(SUB);
      model.findOneAndDelete.mockReturnValue(exec(null));
      await rejectsWith(
        service.deleteAccount(SUB, { accountId: AID }),
        BadRequestException,
        'Account not found',
      );
    });
  });

  describe('assertAccountOwned', () => {
    it('404 for a non-ObjectId without a query', async () => {
      await rejectsWith(
        service.assertAccountOwned({ accountId: 'abc', sub: SUB }),
        NotFoundException,
        'Account not found',
      );
      expect(model.findById).not.toHaveBeenCalled();
    });

    it('404 missing, 401 foreign, resolves owned, forwards the session', async () => {
      owner(null);
      await rejectsWith(
        service.assertAccountOwned({ accountId: AID, sub: SUB }),
        NotFoundException,
        'Account not found',
      );
      owner(OTHER);
      await rejectsWith(
        service.assertAccountOwned({ accountId: AID, sub: SUB }),
        UnauthorizedException,
        'Account does not belong to the user',
      );
      owner(SUB);
      await expect(
        service.assertAccountOwned({ accountId: AID, sub: SUB, session }),
      ).resolves.toBeUndefined();
      expect(ownerQuery.session).toHaveBeenLastCalledWith(session);
    });
  });

  describe('incrementBalance', () => {
    it('one owner-bound $inc with the session, returns the doc', async () => {
      const account = { _id: AID, amount: 69.5 };
      model.findOneAndUpdate.mockReturnValue(exec(account));
      await expect(
        service.incrementBalance({
          accountId: AID,
          sub: SUB,
          delta: -30.5,
          session,
        }),
      ).resolves.toBe(account);
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: AID, sub: SUB },
        { $inc: { amount: -30.5 } },
        { session, returnDocument: 'after' },
      );
    });

    it('404 when nothing owned matches', async () => {
      model.findOneAndUpdate.mockReturnValue(exec(null));
      await rejectsWith(
        service.incrementBalance({
          accountId: AID,
          sub: SUB,
          delta: 1,
          session,
        }),
        NotFoundException,
        'Account not found',
      );
    });

    it('404 for a non-ObjectId without a query', async () => {
      await rejectsWith(
        service.incrementBalance({
          accountId: 'abc',
          sub: SUB,
          delta: 1,
          session,
        }),
        NotFoundException,
        'Account not found',
      );
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
