import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { type ClientSession, Types } from 'mongoose';
import { AccountService } from '../../account/services/account.service.js';
import { BudgetHistoryService } from '../../budget/services/budget-history.service.js';
import { BudgetService } from '../../budget/services/budget.service.js';
import { CategoryService } from '../../category/services/category.service.js';
import { INITIAL_RESPONSE } from '../../constants.js';
import type {
  CreateExpenseDto,
  UpdateExpenseDto,
} from '../dtos/expense.dto.js';
import { Expense } from '../entities/expense.entity.js';
import { CATEGORY_POPULATE } from '../record.constants.js';
import { ExpenseService } from './expense.service.js';

const SUB = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439099';
const RID = '64b7f0c2a1b2c3d4e5f60700';
const ACC = '64b7f0c2a1b2c3d4e5f60711';
const ACC2 = '64b7f0c2a1b2c3d4e5f60712';
const CAT = '64b7f0c2a1b2c3d4e5f60721';
const CAT2 = '64b7f0c2a1b2c3d4e5f60722';
const B1 = '64b7f0c2a1b2c3d4e5f60731';
const B2 = '64b7f0c2a1b2c3d4e5f60732';
const B3 = '64b7f0c2a1b2c3d4e5f60733';
const B4 = '64b7f0c2a1b2c3d4e5f60734';
const INPUT_DATE = new Date('2025-02-03T20:05:30.123Z');
const HISTORY_NOT_FOUND = 'Budget history not found';
const AMOUNTS = { budgetCurrentAmount: 5, budgetUpdatedAmount: 105 };

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
const createDto = (fields: object = {}) =>
  ({
    shortName: 'Lunch',
    typeOfRecord: 'expense',
    description: '',
    amount: 100,
    date: INPUT_DATE,
    category: CAT,
    subCategory: 'Food',
    tag: [],
    indebtedPeople: [],
    account: ACC,
    budgets: [],
    isPaid: true,
    linkedBudgets: [],
    ...fields,
  }) as unknown as CreateExpenseDto;
const updateDto = (fields: object = {}) =>
  ({
    recordId: RID,
    shortName: 'Lunch',
    amount: 100,
    date: INPUT_DATE,
    category: CAT,
    account: ACC,
    linkedBudgets: [],
    ...fields,
  }) as unknown as UpdateExpenseDto;
const stored = (fields: object = {}) => ({
  _id: new Types.ObjectId(RID),
  userId: SUB,
  shortName: 'Lunch',
  amount: 100,
  account: ACC,
  category: CAT,
  ...fields,
});

describe('ExpenseService', () => {
  let service: ExpenseService;
  const session = { id: 'fake-session' } as unknown as ClientSession;
  const listQuery = { populate: vi.fn(), lean: vi.fn(), exec: vi.fn() };
  const findByIdQuery = { session: vi.fn(), lean: vi.fn(), exec: vi.fn() };
  const deleteQuery = { exec: vi.fn() };
  const updateQuery = { exec: vi.fn() };
  const model = {
    find: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    findOneAndDelete: vi.fn(),
    findOneAndUpdate: vi.fn(),
  };
  const connection = { transaction: vi.fn() };
  const accountService = {
    assertAccountOwned: vi.fn(),
    incrementBalance: vi.fn(),
  };
  const categoryService = { assertCategoryOwned: vi.fn() };
  const budgetService = { incrementBudgetAmount: vi.fn() };
  const historyService = {
    addHistoryRecord: vi.fn(),
    removeHistoryRecord: vi.fn(),
  };
  const doc = { _id: new Types.ObjectId(RID), populate: vi.fn() };
  const writes = () => [
    model.create,
    model.findOneAndDelete,
    model.findOneAndUpdate,
    accountService.incrementBalance,
    budgetService.incrementBudgetAmount,
    historyService.addHistoryRecord,
    historyService.removeHistoryRecord,
  ];
  const expectNoWrites = () => {
    for (const w of writes()) expect(w).not.toHaveBeenCalled();
  };
  const balanceCalls = () =>
    accountService.incrementBalance.mock.calls.map(([a]) => [
      a.accountId,
      a.delta,
    ]);
  const budgetCalls = () =>
    budgetService.incrementBudgetAmount.mock.calls.map(([a]) => [
      a.budgetId,
      a.delta,
    ]);
  const oldDoc = (fields: object = {}) =>
    findByIdQuery.exec.mockResolvedValue(stored(fields));

  beforeEach(async () => {
    vi.resetAllMocks();
    connection.transaction.mockImplementation(
      (fn: (s: unknown) => Promise<unknown>) => fn(session),
    );
    model.find.mockReturnValue(listQuery);
    listQuery.populate.mockReturnValue(listQuery);
    listQuery.lean.mockReturnValue(listQuery);
    model.findById.mockReturnValue(findByIdQuery);
    findByIdQuery.session.mockReturnValue(findByIdQuery);
    findByIdQuery.lean.mockReturnValue(findByIdQuery);
    model.findOneAndDelete.mockReturnValue(deleteQuery);
    model.findOneAndUpdate.mockReturnValue(updateQuery);
    model.create.mockResolvedValue([doc]);
    deleteQuery.exec.mockResolvedValue(doc);
    updateQuery.exec.mockResolvedValue(doc);
    budgetService.incrementBudgetAmount.mockResolvedValue(AMOUNTS);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseService,
        { provide: getModelToken(Expense.name), useValue: model },
        { provide: getConnectionToken(), useValue: connection },
        { provide: AccountService, useValue: accountService },
        { provide: CategoryService, useValue: categoryService },
        { provide: BudgetService, useValue: budgetService },
        { provide: BudgetHistoryService, useValue: historyService },
      ],
    }).compile();
    service = module.get(ExpenseService);
  });

  describe('findByAccountAndMonth', () => {
    const args = { sub: SUB, accountId: ACC, month: 'Feb', year: '2025' };
    const empty = {
      ...INITIAL_RESPONSE,
      message: 'Expenses not found.',
      data: { expenses: [] },
    };

    it('bad month/year → empty answer without a query', async () => {
      for (const bad of [{ month: 'jan' }, { year: '25' }]) {
        expect(
          await service.findByAccountAndMonth({ ...args, ...bad }),
        ).toStrictEqual(empty);
      }
      expect(model.find).not.toHaveBeenCalled();
    });

    it('empty result → the same empty answer', async () => {
      listQuery.exec.mockResolvedValue([]);
      expect(await service.findByAccountAndMonth(args)).toStrictEqual(empty);
    });

    it('filters by owner, account string, type and UTC bounds; populates; message null', async () => {
      const expenses = [{ _id: RID }];
      listQuery.exec.mockResolvedValue(expenses);
      expect(await service.findByAccountAndMonth(args)).toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { expenses },
      });
      expect(model.find).toHaveBeenCalledWith({
        userId: SUB,
        account: ACC,
        typeOfRecord: 'expense',
        date: {
          $gte: new Date('2025-02-01T00:00:00.000Z'),
          $lt: new Date('2025-03-01T00:00:00.000Z'),
        },
      });
      expect(listQuery.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
      expect(listQuery.populate).toHaveBeenCalledWith('linkedBudgets');
      expect(listQuery.lean).toHaveBeenCalled();
    });
  });

  describe('createExpense', () => {
    it('pre-checks in develop order, before any read', async () => {
      await rejectsWith(
        service.createExpense(
          SUB,
          createDto({ typeOfRecord: 'transfer', linkedBudgets: [B1] }),
        ),
        BadRequestException,
        'Transfer record cannot be linked to budget',
      );
      await rejectsWith(
        service.createExpense(SUB, createDto({ typeOfRecord: 'income' })),
        BadRequestException,
        'Invalid type of record',
      );
      await rejectsWith(
        service.createExpense(
          SUB,
          createDto({ linkedBudgets: [B1, B2, B3, B4] }),
        ),
        BadRequestException,
        'The maximum number of budgets are 3',
      );
      expect(connection.transaction).not.toHaveBeenCalled();
      expect(categoryService.assertCategoryOwned).not.toHaveBeenCalled();
    });

    it('category 404 and account 404/401 propagate before any write', async () => {
      categoryService.assertCategoryOwned.mockRejectedValueOnce(
        new NotFoundException('Category not found'),
      );
      await rejectsWith(
        service.createExpense(SUB, createDto()),
        NotFoundException,
        'Category not found',
      );
      expect(accountService.assertAccountOwned).not.toHaveBeenCalled();
      for (const e of [
        new NotFoundException('Account not found'),
        new UnauthorizedException('Account does not belong to the user'),
      ]) {
        accountService.assertAccountOwned.mockRejectedValueOnce(e);
        await expect(service.createExpense(SUB, createDto())).rejects.toBe(e);
      }
      expectNoWrites();
    });

    it('stores the shifted date and formats, debits the account, adds each deduped budget with the unshifted date', async () => {
      const res = await service.createExpense(
        SUB,
        createDto({ linkedBudgets: [B1, B1, B2] }),
      );
      expect(categoryService.assertCategoryOwned).toHaveBeenCalledWith(
        CAT,
        SUB,
      );
      expect(accountService.assertAccountOwned).toHaveBeenCalledWith({
        accountId: ACC,
        sub: SUB,
        session,
      });
      expect(model.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            date: new Date('2025-02-03T14:05:30.000Z'),
            fullDate: 'Lun, 3 Feb, 2025',
            formattedTime: '14:05pm',
            amountFormatted: '$100.00',
            userId: SUB,
            linkedBudgets: [B1, B2],
          }),
        ],
        { session },
      );
      expect(balanceCalls()).toStrictEqual([[ACC, -100]]);
      expect(budgetCalls()).toStrictEqual([
        [B1, 100],
        [B2, 100],
      ]);
      for (const b of [B1, B2]) {
        expect(historyService.addHistoryRecord).toHaveBeenCalledWith({
          budgetId: b,
          sub: SUB,
          session,
          record: {
            recordId: RID,
            recordName: 'Lunch',
            recordDate: INPUT_DATE,
            recordAmount: 100,
            ...AMOUNTS,
          },
        });
      }
      for (const fn of [
        accountService.incrementBalance,
        budgetService.incrementBudgetAmount,
      ]) {
        for (const [a] of fn.mock.calls) expect(a.session).toBe(session);
      }
      expect(doc.populate).toHaveBeenCalledWith([
        CATEGORY_POPULATE,
        { path: 'linkedBudgets' },
      ]);
      expect(res).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: expect.any(Array),
        data: { expense: doc },
      });
    });

    it('a missing or foreign budget → 400 and no history call', async () => {
      budgetService.incrementBudgetAmount.mockResolvedValueOnce(null);
      await rejectsWith(
        service.createExpense(SUB, createDto({ linkedBudgets: [B1] })),
        BadRequestException,
        HISTORY_NOT_FOUND,
      );
      expect(historyService.addHistoryRecord).not.toHaveBeenCalled();
      expect(doc.populate).not.toHaveBeenCalled();
    });
  });

  describe('deleteExpense', () => {
    it('404 missing and 401 foreign, no writes', async () => {
      findByIdQuery.exec.mockResolvedValueOnce(null);
      await rejectsWith(
        service.deleteExpense(SUB, { recordId: RID }),
        NotFoundException,
        'Expense not found.',
      );
      oldDoc({ userId: OTHER });
      await rejectsWith(
        service.deleteExpense(SUB, { recordId: RID }),
        UnauthorizedException,
        'This expense does not belongs to the user',
      );
      expectNoWrites();
    });

    it('credits the account and removes each stored budget with the old amount; null is skipped', async () => {
      oldDoc({
        linkedBudgets: [new Types.ObjectId(B1), new Types.ObjectId(B2)],
      });
      budgetService.incrementBudgetAmount
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(AMOUNTS);
      const res = await service.deleteExpense(SUB, { recordId: RID });
      expect(model.findOneAndDelete).toHaveBeenCalledWith(
        { _id: RID, userId: SUB },
        { session },
      );
      expect(balanceCalls()).toStrictEqual([[ACC, 100]]);
      expect(budgetCalls()).toStrictEqual([
        [B1, -100],
        [B2, -100],
      ]);
      expect(historyService.removeHistoryRecord).toHaveBeenCalledTimes(1);
      expect(historyService.removeHistoryRecord).toHaveBeenCalledWith({
        budgetId: B2,
        sub: SUB,
        recordId: RID,
        session,
      });
      expect(res).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: expect.any(Array),
        data: { expense: doc },
      });
      expect(doc.populate).not.toHaveBeenCalled();
    });

    it('a legacy doc without linkedBudgets deletes', async () => {
      oldDoc();
      await service.deleteExpense(SUB, { recordId: RID });
      expect(budgetService.incrementBudgetAmount).not.toHaveBeenCalled();
    });

    it('Q10: incrementBalance 404 propagates', async () => {
      oldDoc();
      const e = new NotFoundException('Account not found');
      accountService.incrementBalance.mockRejectedValueOnce(e);
      await expect(service.deleteExpense(SUB, { recordId: RID })).rejects.toBe(
        e,
      );
    });
  });

  describe('updateExpense', () => {
    it('the 4 missing-prop 400s in develop order (amount 0 included), no reads', async () => {
      const cases: [object, string][] = [
        [{ date: undefined, category: undefined }, 'date prop is missing.'],
        [
          { category: undefined, amount: undefined },
          'category prop is missing.',
        ],
        [{ amount: 0, linkedBudgets: undefined }, 'amount prop is missing.'],
        [{ linkedBudgets: undefined }, 'linkedBudgets prop is missing.'],
      ];
      for (const [fields, message] of cases) {
        await rejectsWith(
          service.updateExpense(SUB, updateDto(fields)),
          BadRequestException,
          message,
        );
      }
      expect(model.findById).not.toHaveBeenCalled();
    });

    it('404 missing and 401 foreign, no writes', async () => {
      findByIdQuery.exec.mockResolvedValueOnce(null);
      await rejectsWith(
        service.updateExpense(SUB, updateDto()),
        NotFoundException,
        'Expense not found.',
      );
      oldDoc({ userId: OTHER });
      await rejectsWith(
        service.updateExpense(SUB, updateDto()),
        UnauthorizedException,
        'This expense does not belongs to the user',
      );
      expectNoWrites();
    });

    it('Q9: unchanged category (ObjectId stored) and account are not checked; nothing moves', async () => {
      oldDoc({ category: new Types.ObjectId(CAT) });
      await service.updateExpense(SUB, updateDto());
      expect(categoryService.assertCategoryOwned).not.toHaveBeenCalled();
      expect(accountService.assertAccountOwned).not.toHaveBeenCalled();
      expect(accountService.incrementBalance).not.toHaveBeenCalled();
      expect(budgetService.incrementBudgetAmount).not.toHaveBeenCalled();
    });

    it('Q9: a changed category is checked and its 404 aborts before writes', async () => {
      oldDoc();
      categoryService.assertCategoryOwned.mockRejectedValueOnce(
        new NotFoundException('Category not found'),
      );
      await rejectsWith(
        service.updateExpense(SUB, updateDto({ category: CAT2, amount: 50 })),
        NotFoundException,
        'Category not found',
      );
      expect(categoryService.assertCategoryOwned).toHaveBeenCalledWith(
        CAT2,
        SUB,
      );
      expectNoWrites();
    });

    it('Q9/audit High: a changed account is checked and its 401 aborts before writes', async () => {
      oldDoc();
      accountService.assertAccountOwned.mockRejectedValueOnce(
        new UnauthorizedException('Account does not belong to the user'),
      );
      await rejectsWith(
        service.updateExpense(SUB, updateDto({ account: ACC2 })),
        UnauthorizedException,
        'Account does not belong to the user',
      );
      expect(accountService.assertAccountOwned).toHaveBeenCalledWith({
        accountId: ACC2,
        sub: SUB,
        session,
      });
      expectNoWrites();
    });

    it('balance: same account, amount changed → one incrementBalance(old − new)', async () => {
      oldDoc();
      await service.updateExpense(SUB, updateDto({ amount: 150 }));
      expect(balanceCalls()).toStrictEqual([[ACC, -50]]);
    });

    it('balance: account changed → +old on the old account, −new on the new one', async () => {
      oldDoc();
      await service.updateExpense(
        SUB,
        updateDto({ account: ACC2, amount: 150 }),
      );
      expect(balanceCalls()).toStrictEqual([
        [ACC, 100],
        [ACC2, -150],
      ]);
    });

    it('budgets: removed −old (+ pull, null skipped), added +new (+ push)', async () => {
      oldDoc({
        linkedBudgets: [new Types.ObjectId(B1), new Types.ObjectId(B2)],
      });
      budgetService.incrementBudgetAmount
        .mockResolvedValueOnce(AMOUNTS)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(AMOUNTS);
      await service.updateExpense(
        SUB,
        updateDto({ amount: 150, linkedBudgets: [B3] }),
      );
      expect(budgetCalls()).toStrictEqual([
        [B1, -100],
        [B2, -100],
        [B3, 150],
      ]);
      expect(historyService.removeHistoryRecord).toHaveBeenCalledTimes(1);
      expect(historyService.removeHistoryRecord).toHaveBeenCalledWith({
        budgetId: B1,
        sub: SUB,
        recordId: RID,
        session,
      });
      expect(historyService.addHistoryRecord).toHaveBeenCalledWith({
        budgetId: B3,
        sub: SUB,
        session,
        record: {
          recordId: RID,
          recordName: 'Lunch',
          recordDate: INPUT_DATE,
          recordAmount: 150,
          ...AMOUNTS,
        },
      });
    });

    it('budgets: an added missing/foreign budget → 400 and no update', async () => {
      oldDoc();
      budgetService.incrementBudgetAmount.mockResolvedValueOnce(null);
      await rejectsWith(
        service.updateExpense(SUB, updateDto({ linkedBudgets: [B1] })),
        BadRequestException,
        HISTORY_NOT_FOUND,
      );
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('budgets: kept with a changed amount → new − old, history entry replaced', async () => {
      oldDoc({ linkedBudgets: [new Types.ObjectId(B1)] });
      await service.updateExpense(
        SUB,
        updateDto({ amount: 150, linkedBudgets: [B1], shortName: undefined }),
      );
      expect(budgetCalls()).toStrictEqual([[B1, 50]]);
      expect(historyService.removeHistoryRecord).toHaveBeenCalledWith({
        budgetId: B1,
        sub: SUB,
        recordId: RID,
        session,
      });
      expect(historyService.addHistoryRecord).toHaveBeenCalledWith({
        budgetId: B1,
        sub: SUB,
        session,
        record: {
          recordId: RID,
          recordName: 'Lunch',
          recordDate: INPUT_DATE,
          recordAmount: 150,
          ...AMOUNTS,
        },
      });
    });

    it('budgets: kept with the same amount → no budget calls', async () => {
      oldDoc({ linkedBudgets: [new Types.ObjectId(B1)] });
      await service.updateExpense(SUB, updateDto({ linkedBudgets: [B1] }));
      expect(budgetService.incrementBudgetAmount).not.toHaveBeenCalled();
    });

    it('$set: no recordId/userId/nulls, unshifted date, recomputed formats; owner filter; only category populated', async () => {
      oldDoc();
      const res = await service.updateExpense(
        SUB,
        updateDto({ description: null, amount: 1234.5, linkedBudgets: [] }),
      );
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: RID, userId: SUB },
        {
          $set: {
            shortName: 'Lunch',
            amount: 1234.5,
            date: INPUT_DATE,
            category: CAT,
            account: ACC,
            linkedBudgets: [],
            fullDate: 'Lun, 3 Feb, 2025',
            formattedTime: '20:05pm',
            amountFormatted: '$1,234.50',
          },
        },
        { session, returnDocument: 'after' },
      );
      expect(doc.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
      expect(res).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: expect.any(Array),
        data: { expense: doc },
      });
    });
  });
});
