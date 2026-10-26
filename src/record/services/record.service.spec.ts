import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { ClientSession } from 'mongoose';
import { AccountService } from '../../account/services/account.service.js';
import { CategoryService } from '../../category/services/category.service.js';
import type { CreateTransferDto } from '../dtos/transfer.dto.js';
import { Expense } from '../entities/expense.entity.js';
import { Income } from '../entities/income.entity.js';
import {
  CATEGORY_POPULATE,
  EXPENSES_PAID_POPULATE,
  INVALID_EXPENSES_PAID,
} from '../record.constants.js';
import { IncomeService } from './income.service.js';
import { RecordService } from './record.service.js';

const SUB = '507f1f77bcf86cd799439011';
const ACC = '64b7f0c2a1b2c3d4e5f60711';
const ACC2 = '64b7f0c2a1b2c3d4e5f60712';
const CAT = '64b7f0c2a1b2c3d4e5f60721';
const E1 = '64b7f0c2a1b2c3d4e5f60801';
const E2 = '64b7f0c2a1b2c3d4e5f60802';
const INPUT_DATE = new Date('2025-02-03T20:05:30.123Z');
// S7a's vector: the Mexico City wall clock written as UTC, ms dropped.
const SHIFTED = new Date('2025-02-03T14:05:30.000Z');

const side = (fields: object = {}) => ({
  shortName: 'Move',
  typeOfRecord: 'transfer',
  description: '',
  amount: 300,
  date: new Date(INPUT_DATE),
  category: CAT,
  subCategory: 'Sub',
  tag: [],
  indebtedPeople: [],
  budgets: [],
  ...fields,
});
const transferDto = (expense: object = {}, income: object = {}) =>
  ({
    expense: side({
      account: ACC,
      isPaid: true,
      linkedBudgets: [],
      ...expense,
    }),
    income: side({ account: ACC2, expensesPaid: [], ...income }),
  }) as unknown as CreateTransferDto;

describe('RecordService', () => {
  let service: RecordService;
  const session = { id: 'fake-session' } as unknown as ClientSession;
  const query = () => {
    const q = { populate: vi.fn(), lean: vi.fn(), exec: vi.fn() };
    q.populate.mockReturnValue(q);
    q.lean.mockReturnValue(q);
    return q;
  };
  let expenseQuery: ReturnType<typeof query>;
  let incomeQuery: ReturnType<typeof query>;
  const expenseModel = { find: vi.fn(), create: vi.fn() };
  const incomeModel = { find: vi.fn(), create: vi.fn() };
  const connection = { transaction: vi.fn() };
  const accountService = {
    assertAccountOwned: vi.fn(),
    incrementBalance: vi.fn(),
  };
  const categoryService = { assertCategoryOwned: vi.fn() };
  const incomeService = { ownedExpenseIds: vi.fn(), payExpenses: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    expenseQuery = query();
    incomeQuery = query();
    expenseModel.find.mockReturnValue(expenseQuery);
    incomeModel.find.mockReturnValue(incomeQuery);
    expenseQuery.exec.mockResolvedValue([]);
    incomeQuery.exec.mockResolvedValue([]);
    connection.transaction.mockImplementation(
      (fn: (s: unknown) => Promise<unknown>) => fn(session),
    );
    expenseModel.create.mockResolvedValue([{ _id: 'e' }]);
    incomeModel.create.mockResolvedValue([{ _id: 'i' }]);
    incomeService.ownedExpenseIds.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordService,
        { provide: getModelToken(Expense.name), useValue: expenseModel },
        { provide: getModelToken(Income.name), useValue: incomeModel },
        { provide: getConnectionToken(), useValue: connection },
        { provide: AccountService, useValue: accountService },
        { provide: CategoryService, useValue: categoryService },
        { provide: IncomeService, useValue: incomeService },
      ],
    }).compile();
    service = module.get(RecordService);
  });

  describe('findByAccountAndMonth', () => {
    const list = (month = 'Feb', year = '2025') =>
      service.findByAccountAndMonth({ sub: SUB, accountId: ACC, month, year });
    const d = (iso: string) => new Date(iso);

    it.each([
      ['feb', '2025'],
      ['February', '2025'],
      ['13', '2025'],
      ['Feb', '25'],
    ])('%s/%s → the empty answer, no query', async (month, year) => {
      expect(await list(month, year)).toMatchObject({
        message: 'No incomes or expenses found.',
        data: null,
      });
      expect(expenseModel.find).not.toHaveBeenCalled();
      expect(incomeModel.find).not.toHaveBeenCalled();
    });

    it('filters by user, account string and UTC month bounds, with no typeOfRecord', async () => {
      await list();
      const filter = {
        userId: SUB,
        account: ACC,
        date: {
          $gte: new Date('2025-02-01T00:00:00.000Z'),
          $lt: new Date('2025-03-01T00:00:00.000Z'),
        },
      };
      expect(expenseModel.find).toHaveBeenCalledWith(filter);
      expect(incomeModel.find).toHaveBeenCalledWith(filter);
      expect(expenseQuery.populate.mock.calls).toEqual([
        [CATEGORY_POPULATE],
        ['linkedBudgets'],
      ]);
      expect(incomeQuery.populate.mock.calls).toEqual([
        [EXPENSES_PAID_POPULATE],
        [CATEGORY_POPULATE],
      ]);
      expect(expenseQuery.lean).toHaveBeenCalled();
      expect(incomeQuery.lean).toHaveBeenCalled();
    });

    it('both empty → the empty answer', async () => {
      expect(await list()).toMatchObject({
        message: 'No incomes or expenses found.',
        data: null,
      });
    });

    it('only incomes → "No expenses found." with the incomes', async () => {
      const i = { _id: 'i', date: d('2025-02-02') };
      incomeQuery.exec.mockResolvedValue([i]);
      expect(await list()).toMatchObject({
        message: 'No expenses found.',
        data: { records: [i] },
      });
    });

    it('only expenses → "No incomes found." with the expenses', async () => {
      const e = { _id: 'e', date: d('2025-02-02') };
      expenseQuery.exec.mockResolvedValue([e]);
      expect(await list()).toMatchObject({
        message: 'No incomes found.',
        data: { records: [e] },
      });
    });

    it('both → message null, merged date desc, expenses first on equal dates', async () => {
      expenseQuery.exec.mockResolvedValue([
        { _id: 'e2', date: d('2025-02-01') },
        { _id: 'e1', date: d('2025-02-05') },
      ]);
      incomeQuery.exec.mockResolvedValue([
        { _id: 'i2', date: d('2025-02-05') },
        { _id: 'i1', date: d('2025-02-10') },
      ]);
      const r = await list();
      expect(r.message).toBeNull();
      expect(
        (r.data as { records: { _id: string }[] }).records.map((x) => x._id),
      ).toEqual(['i1', 'e1', 'i2', 'e2']);
    });
  });

  describe('createTransfer', () => {
    const rejects400 = async (dto: CreateTransferDto, message: string) => {
      const err = await service
        .createTransfer(SUB, dto)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toBe(message);
    };

    // Each case also breaks a later check, so the first failing one must win.
    it.each([
      [
        'a non-transfer expense type',
        transferDto({ typeOfRecord: 'expense', isPaid: false }),
        'Invalid type of record',
      ],
      [
        'a non-transfer income type',
        transferDto({ isPaid: false }, { typeOfRecord: 'income' }),
        'Invalid type of record',
      ],
      [
        'an unpaid expense',
        transferDto({ isPaid: false, linkedBudgets: [E1] }),
        'The expense transfer record must have value isPaid as true',
      ],
      [
        'linked budgets',
        transferDto({ linkedBudgets: [E1], account: ACC2 }),
        'The expense transfer record cannot have linked budgets',
      ],
      [
        'the same account',
        transferDto({ account: ACC2, shortName: 'Other' }),
        'Income account and expense account must be different',
      ],
      [
        'a different short name',
        transferDto({ shortName: 'Other', amount: 1 }),
        'Transfer records has different short name. Both must have the same value',
      ],
      [
        'different amounts',
        transferDto({ amount: 1, date: new Date(0) }),
        'Transfer records has different amounts. Both must have the same value',
      ],
      [
        'dates 1 ms apart',
        transferDto({
          date: new Date(INPUT_DATE.getTime() + 1),
          category: E1,
        }),
        'Transfer records has different dates. Both must have the same value',
      ],
      [
        'a different category',
        transferDto({ category: E1, subCategory: 'Other' }),
        'Transfer records has different category. Both must have the same value',
      ],
      [
        'a different subCategory',
        transferDto({ subCategory: 'Other' }, { expensesPaid: [null] }),
        'Transfer records has different subCategory. Both must have the same value',
      ],
      [
        'a malformed expensesPaid element (after the legacy checks)',
        transferDto({}, { expensesPaid: [E1, { _id: { $ne: null } }] }),
        INVALID_EXPENSES_PAID,
      ],
    ])('400 on %s, before any transaction', async (_, dto, message) => {
      await rejects400(dto, message);
      expect(connection.transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['category 404', 'cat', new NotFoundException('Category not found')],
      ['account 404', 'acc', new NotFoundException('Account not found')],
      [
        'account 401',
        'acc',
        new UnauthorizedException('Account does not belong to the user'),
      ],
    ])('%s → 400 with the same text, nothing created', async (_, who, err) => {
      if (who === 'cat') {
        categoryService.assertCategoryOwned.mockRejectedValue(err);
      } else {
        accountService.assertAccountOwned.mockRejectedValue(err);
      }
      await rejects400(transferDto(), err.message);
      expect(expenseModel.create).not.toHaveBeenCalled();
      expect(incomeModel.create).not.toHaveBeenCalled();
      expect(accountService.incrementBalance).not.toHaveBeenCalled();
    });

    it('checks the category, then the expense account, then the income account', async () => {
      await service.createTransfer(SUB, transferDto());
      expect(categoryService.assertCategoryOwned).toHaveBeenCalledWith(
        CAT,
        SUB,
      );
      expect(
        accountService.assertAccountOwned.mock.calls.map(([a]) => [
          a.accountId,
          a.session,
        ]),
      ).toEqual([
        [ACC, session],
        [ACC2, session],
      ]);
    });

    it('an unknown error is not wrapped', async () => {
      const boom = new Error('db down');
      accountService.incrementBalance.mockRejectedValue(boom);
      await expect(service.createTransfer(SUB, transferDto())).rejects.toBe(
        boom,
      );
    });

    it('creates both cross-linked sides with the same shifted date, moves both balances and pays owned expenses', async () => {
      incomeService.ownedExpenseIds.mockResolvedValue([E1]);
      incomeService.payExpenses.mockImplementation(
        ({ messages }: { messages: string[] }) => {
          messages.push('paid');
        },
      );
      const r = await service.createTransfer(
        SUB,
        transferDto(
          { transferRecord: { transferId: 'x', account: 'y' } },
          { expensesPaid: [{ _id: E1 }, E2] },
        ),
      );

      const [[[e], eOpts]] = expenseModel.create.mock.calls;
      const [[[i], iOpts]] = incomeModel.create.mock.calls;
      expect(eOpts).toEqual({ session });
      expect(iOpts).toEqual({ session });
      const common = {
        date: SHIFTED,
        fullDate: 'Lun, 3 Feb, 2025',
        formattedTime: '14:05pm',
        amountFormatted: '$300.00',
        userId: SUB,
      };
      expect(e).toMatchObject({
        ...common,
        account: ACC,
        isPaid: true,
        linkedBudgets: [],
        transferRecord: { transferId: String(i._id), account: ACC2 },
      });
      expect(i).toMatchObject({
        ...common,
        account: ACC2,
        expensesPaid: [E1],
        transferRecord: { transferId: String(e._id), account: ACC },
      });
      expect(incomeService.ownedExpenseIds).toHaveBeenCalledWith({
        ids: [E1, E2],
        sub: SUB,
        session,
      });
      expect(
        accountService.incrementBalance.mock.calls.map(([a]) => [
          a.accountId,
          a.delta,
          a.session,
        ]),
      ).toEqual([
        [ACC, -300, session],
        [ACC2, 300, session],
      ]);
      expect(incomeService.payExpenses).toHaveBeenCalledWith(
        expect.objectContaining({
          ids: [E1, E2],
          owned: [E1],
          sub: SUB,
          session,
        }),
      );
      expect(r).toMatchObject({
        message: ['paid'],
        data: { expense: { _id: 'e' }, income: { _id: 'i' } },
      });
    });

    it('a retried transaction reuses the same ids', async () => {
      connection.transaction.mockImplementation(
        async (fn: (s: unknown) => Promise<unknown>) => {
          await fn(session);
          return fn(session);
        },
      );
      await service.createTransfer(SUB, transferDto());
      const [a, b] = expenseModel.create.mock.calls.map(([[x]]) => x._id);
      const [c, d] = incomeModel.create.mock.calls.map(([[x]]) => x._id);
      expect(String(a)).toBe(String(b));
      expect(String(c)).toBe(String(d));
    });
  });
});
