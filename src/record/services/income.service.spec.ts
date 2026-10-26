import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { type ClientSession, Types } from 'mongoose';
import { AccountService } from '../../account/services/account.service.js';
import { CategoryService } from '../../category/services/category.service.js';
import type { CreateIncomeDto, UpdateIncomeDto } from '../dtos/income.dto.js';
import { Expense } from '../entities/expense.entity.js';
import { Income } from '../entities/income.entity.js';
import {
  CATEGORY_POPULATE,
  EXPENSES_PAID_POPULATE,
  INVALID_EXPENSES_PAID,
} from '../record.constants.js';
import { IncomeService } from './income.service.js';

const SUB = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439099';
const RID = '64b7f0c2a1b2c3d4e5f60700';
const ACC = '64b7f0c2a1b2c3d4e5f60711';
const ACC2 = '64b7f0c2a1b2c3d4e5f60712';
const CAT = '64b7f0c2a1b2c3d4e5f60721';
const CAT2 = '64b7f0c2a1b2c3d4e5f60722';
const E1 = '64b7f0c2a1b2c3d4e5f60801';
const E2 = '64b7f0c2a1b2c3d4e5f60802';
const E3 = '64b7f0c2a1b2c3d4e5f60803';
const FOREIGN = '64b7f0c2a1b2c3d4e5f60809';
const INPUT_DATE = new Date('2025-02-03T20:05:30.123Z');

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
    shortName: 'Salary',
    typeOfRecord: 'income',
    description: '',
    amount: 200,
    date: INPUT_DATE,
    category: CAT,
    subCategory: 'Work',
    tag: [],
    indebtedPeople: [],
    account: ACC,
    budgets: [],
    expensesPaid: [],
    ...fields,
  }) as unknown as CreateIncomeDto;
const updateDto = (fields: object = {}) =>
  ({
    recordId: RID,
    shortName: 'Salary',
    amount: 200,
    date: INPUT_DATE,
    category: CAT,
    account: ACC,
    ...fields,
  }) as unknown as UpdateIncomeDto;
const stored = (fields: object = {}) => ({
  _id: new Types.ObjectId(RID),
  userId: SUB,
  shortName: 'Salary',
  amount: 200,
  account: ACC,
  category: CAT,
  expensesPaid: [] as Types.ObjectId[],
  ...fields,
});
const oid = (id: string) => new Types.ObjectId(id);

describe('IncomeService', () => {
  let service: IncomeService;
  const session = { id: 'fake-session' } as unknown as ClientSession;
  const findByIdQuery = { session: vi.fn(), lean: vi.fn(), exec: vi.fn() };
  const deleteQuery = { exec: vi.fn() };
  const updateQuery = { exec: vi.fn() };
  const incomeModel = {
    create: vi.fn(),
    findById: vi.fn(),
    findOneAndDelete: vi.fn(),
    findOneAndUpdate: vi.fn(),
  };
  const expenseFind = {
    select: vi.fn(),
    session: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn(),
  };
  const expenseModel = { find: vi.fn(), updateMany: vi.fn() };
  const connection = { transaction: vi.fn() };
  const accountService = {
    assertAccountOwned: vi.fn(),
    incrementBalance: vi.fn(),
  };
  const categoryService = { assertCategoryOwned: vi.fn() };
  const doc = { _id: oid(RID), populate: vi.fn() };
  const expectNoWrites = () => {
    for (const w of [
      incomeModel.create,
      incomeModel.findOneAndDelete,
      incomeModel.findOneAndUpdate,
      accountService.incrementBalance,
      expenseModel.updateMany,
    ]) {
      expect(w).not.toHaveBeenCalled();
    }
  };
  const balanceCalls = () =>
    accountService.incrementBalance.mock.calls.map(([a]) => [
      a.accountId,
      a.delta,
    ]);
  // [ids, isPaid] per updateMany call.
  const paidCalls = () =>
    expenseModel.updateMany.mock.calls.map(([filter, update]) => [
      filter._id.$in,
      update.$set.isPaid,
    ]);
  // The caller owns these expenses (what find returns).
  const ownedExpenses = (...ids: string[]) =>
    expenseFind.exec.mockResolvedValue(ids.map((id) => ({ _id: oid(id) })));
  const oldDoc = (fields: object = {}) =>
    findByIdQuery.exec.mockResolvedValue(stored(fields));

  beforeEach(async () => {
    vi.resetAllMocks();
    connection.transaction.mockImplementation(
      (fn: (s: unknown) => Promise<unknown>) => fn(session),
    );
    incomeModel.findById.mockReturnValue(findByIdQuery);
    findByIdQuery.session.mockReturnValue(findByIdQuery);
    findByIdQuery.lean.mockReturnValue(findByIdQuery);
    incomeModel.findOneAndDelete.mockReturnValue(deleteQuery);
    incomeModel.findOneAndUpdate.mockReturnValue(updateQuery);
    incomeModel.create.mockResolvedValue([doc]);
    deleteQuery.exec.mockResolvedValue(doc);
    updateQuery.exec.mockResolvedValue(doc);
    expenseModel.find.mockReturnValue(expenseFind);
    expenseFind.select.mockReturnValue(expenseFind);
    expenseFind.session.mockReturnValue(expenseFind);
    expenseFind.lean.mockReturnValue(expenseFind);
    expenseFind.exec.mockResolvedValue([]);
    // Every id matches (the owner filter is asserted separately).
    expenseModel.updateMany.mockImplementation(
      (filter: { _id: { $in: string[] } }) => ({
        exec: () => Promise.resolve({ matchedCount: filter._id.$in.length }),
      }),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncomeService,
        { provide: getModelToken(Income.name), useValue: incomeModel },
        { provide: getModelToken(Expense.name), useValue: expenseModel },
        { provide: getConnectionToken(), useValue: connection },
        { provide: AccountService, useValue: accountService },
        { provide: CategoryService, useValue: categoryService },
      ],
    }).compile();
    service = module.get(IncomeService);
  });

  describe('createIncome', () => {
    it('400 on a non-income type, before the expensesPaid check and any read', async () => {
      await rejectsWith(
        service.createIncome(
          SUB,
          createDto({ typeOfRecord: 'expense', expensesPaid: [null] }),
        ),
        BadRequestException,
        'Invalid type of record',
      );
      expect(connection.transaction).not.toHaveBeenCalled();
    });

    it('400 on a malformed expensesPaid element, no transaction', async () => {
      await rejectsWith(
        service.createIncome(
          SUB,
          createDto({ expensesPaid: [E1, { _id: { $ne: null } }] }),
        ),
        BadRequestException,
        INVALID_EXPENSES_PAID,
      );
      expect(connection.transaction).not.toHaveBeenCalled();
    });

    it('category and account errors propagate and nothing after them runs', async () => {
      categoryService.assertCategoryOwned.mockRejectedValueOnce(
        new NotFoundException('Category not found'),
      );
      await rejectsWith(
        service.createIncome(SUB, createDto({ expensesPaid: [E1] })),
        NotFoundException,
        'Category not found',
      );
      expect(accountService.assertAccountOwned).not.toHaveBeenCalled();
      for (const err of [
        new NotFoundException('Account not found'),
        new UnauthorizedException('no'),
      ]) {
        accountService.assertAccountOwned.mockRejectedValueOnce(err);
        await expect(
          service.createIncome(SUB, createDto({ expensesPaid: [E1] })),
        ).rejects.toBe(err);
      }
      expect(expenseModel.find).not.toHaveBeenCalled();
      expectNoWrites();
    });

    it('stores only the owned ids with the shifted date, adds the amount and pays the owned expenses', async () => {
      ownedExpenses(E2, E1);
      const res = await service.createIncome(
        SUB,
        createDto({ expensesPaid: [{ _id: E1 }, E2, FOREIGN, E1] }),
      );
      expect(expenseModel.find).toHaveBeenCalledWith({
        _id: { $in: [E1, E2, FOREIGN] },
        userId: SUB,
      });
      expect(expenseFind.session).toHaveBeenCalledWith(session);
      expect(incomeModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            expensesPaid: [E1, E2],
            date: new Date('2025-02-03T14:05:30.000Z'),
            fullDate: 'Lun, 3 Feb, 2025',
            formattedTime: '14:05pm',
            amountFormatted: '$200.00',
            userId: SUB,
          }),
        ],
        { session },
      );
      expect(balanceCalls()).toStrictEqual([[ACC, 200]]);
      expect(accountService.incrementBalance).toHaveBeenCalledWith(
        expect.objectContaining({ sub: SUB, session }),
      );
      expect(expenseModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: [E1, E2] }, userId: SUB },
        { $set: { isPaid: true } },
        { session },
      );
      expect(res.message).toStrictEqual([
        'Income created',
        'Account updated',
        'Expenses paid updated: 2',
        'Expenses paid failed to update: 1',
      ]);
      expect(res.data).toStrictEqual({ income: doc });
      expect(doc.populate).not.toHaveBeenCalled();
    });

    it('expensesPaid [] → no expense query and no flip', async () => {
      await service.createIncome(SUB, createDto());
      expect(expenseModel.find).not.toHaveBeenCalled();
      expect(expenseModel.updateMany).not.toHaveBeenCalled();
      expect(incomeModel.create).toHaveBeenCalledWith(
        [expect.objectContaining({ expensesPaid: [] })],
        { session },
      );
    });
  });

  describe('deleteIncome', () => {
    it("404 'Income not found.' and 401 on another user's income, no writes", async () => {
      findByIdQuery.exec.mockResolvedValueOnce(null);
      await rejectsWith(
        service.deleteIncome(SUB, { recordId: RID }),
        NotFoundException,
        'Income not found.',
      );
      oldDoc({ userId: OTHER });
      await rejectsWith(
        service.deleteIncome(SUB, { recordId: RID }),
        UnauthorizedException,
        'This income does not belongs to the user',
      );
      expectNoWrites();
    });

    it('subtracts the amount and unpays the stored expenses, owner-filtered', async () => {
      oldDoc({ expensesPaid: [oid(E1), oid(FOREIGN)] });
      const res = await service.deleteIncome(SUB, { recordId: RID });
      expect(incomeModel.findOneAndDelete).toHaveBeenCalledWith(
        { _id: RID, userId: SUB },
        { session },
      );
      expect(balanceCalls()).toStrictEqual([[ACC, -200]]);
      expect(expenseModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: [E1, FOREIGN] }, userId: SUB },
        { $set: { isPaid: false } },
        { session },
      );
      expect(res.data).toStrictEqual({ income: doc });
    });

    it('no stored expensesPaid → no flip', async () => {
      oldDoc({ expensesPaid: undefined });
      await service.deleteIncome(SUB, { recordId: RID });
      expect(expenseModel.updateMany).not.toHaveBeenCalled();
    });

    it('Q10: an incrementBalance 404 propagates', async () => {
      oldDoc();
      const err = new NotFoundException('Account not found');
      accountService.incrementBalance.mockRejectedValueOnce(err);
      await expect(service.deleteIncome(SUB, { recordId: RID })).rejects.toBe(
        err,
      );
      expect(expenseModel.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('updateIncome', () => {
    it.each([
      [{ date: undefined }, 'date prop is missing.'],
      [{ category: undefined }, 'category prop is missing.'],
      [{ amount: undefined }, 'amount prop is missing.'],
      [{ amount: 0 }, 'amount prop is missing.'],
      [{ date: undefined, amount: 0 }, 'date prop is missing.'],
      [{ expensesPaid: [42] }, INVALID_EXPENSES_PAID],
    ])('400 on %o, no transaction', async (fields, message) => {
      await rejectsWith(
        service.updateIncome(SUB, updateDto(fields)),
        BadRequestException,
        message,
      );
      expect(connection.transaction).not.toHaveBeenCalled();
    });

    it("404 'Expense not found.' (sic) and 401 with develop's texts, no writes", async () => {
      findByIdQuery.exec.mockResolvedValueOnce(null);
      await rejectsWith(
        service.updateIncome(SUB, updateDto()),
        NotFoundException,
        'Expense not found.',
      );
      oldDoc({ userId: OTHER });
      await rejectsWith(
        service.updateIncome(SUB, updateDto()),
        UnauthorizedException,
        "You're unauthorized to see these incomes.",
      );
      expectNoWrites();
    });

    it('Q9: unchanged category/account → no ownership calls; changed → called and errors abort', async () => {
      oldDoc({ category: oid(CAT) });
      await service.updateIncome(SUB, updateDto());
      expect(categoryService.assertCategoryOwned).not.toHaveBeenCalled();
      expect(accountService.assertAccountOwned).not.toHaveBeenCalled();

      const err = new NotFoundException('Category not found');
      categoryService.assertCategoryOwned.mockRejectedValueOnce(err);
      vi.clearAllMocks();
      await expect(
        service.updateIncome(SUB, updateDto({ category: CAT2 })),
      ).rejects.toBe(err);
      expect(categoryService.assertCategoryOwned).toHaveBeenCalledWith(
        CAT2,
        SUB,
      );
      const err2 = new UnauthorizedException('no');
      accountService.assertAccountOwned.mockRejectedValueOnce(err2);
      await expect(
        service.updateIncome(SUB, updateDto({ account: ACC2 })),
      ).rejects.toBe(err2);
      expectNoWrites();
    });

    it('balance: same account and amount → none; amount changed → new − old', async () => {
      oldDoc();
      await service.updateIncome(SUB, updateDto());
      expect(balanceCalls()).toStrictEqual([]);
      await service.updateIncome(SUB, updateDto({ amount: 250 }));
      expect(balanceCalls()).toStrictEqual([[ACC, 50]]);
    });

    it('balance: account changed → −old on old, +new on new', async () => {
      oldDoc();
      await service.updateIncome(
        SUB,
        updateDto({ account: ACC2, amount: 250 }),
      );
      expect(accountService.assertAccountOwned).toHaveBeenCalledWith({
        accountId: ACC2,
        sub: SUB,
        session,
      });
      expect(balanceCalls()).toStrictEqual([
        [ACC, -200],
        [ACC2, 250],
      ]);
    });

    it('flags: removed → unpaid, added → paid, kept untouched; foreign not stored nor flipped', async () => {
      oldDoc({ expensesPaid: [oid(E1), oid(E2)] });
      ownedExpenses(E1, E3);
      const res = await service.updateIncome(
        SUB,
        updateDto({ expensesPaid: [{ _id: E1 }, E3, FOREIGN] }),
      );
      expect(paidCalls()).toStrictEqual([
        [[E2], false],
        [[E3], true],
      ]);
      for (const [filter] of expenseModel.updateMany.mock.calls) {
        expect(filter.userId).toBe(SUB);
      }
      const [, update] = incomeModel.findOneAndUpdate.mock.calls[0];
      expect(update.$set.expensesPaid).toStrictEqual([E1, E3]);
      expect(res.message).toEqual(
        expect.arrayContaining([
          'Expenses unpaid: 1',
          'Expenses paid updated: 1',
          'Expenses paid failed to update: 1',
        ]),
      );
    });

    it('flags: [] unpays all old ones and empties the list', async () => {
      oldDoc({ expensesPaid: [oid(E1)] });
      await service.updateIncome(SUB, updateDto({ expensesPaid: [] }));
      expect(expenseModel.find).not.toHaveBeenCalled();
      expect(paidCalls()).toStrictEqual([[[E1], false]]);
      const [, update] = incomeModel.findOneAndUpdate.mock.calls[0];
      expect(update.$set.expensesPaid).toStrictEqual([]);
    });

    it('Q8: no expensesPaid → no expense query, no flip, list not in $set', async () => {
      oldDoc({ expensesPaid: [oid(E1)] });
      await service.updateIncome(SUB, updateDto());
      expect(expenseModel.find).not.toHaveBeenCalled();
      expect(expenseModel.updateMany).not.toHaveBeenCalled();
      const [, update] = incomeModel.findOneAndUpdate.mock.calls[0];
      expect(update.$set).not.toHaveProperty('expensesPaid');
    });

    it('$set: present non-null fields only, unshifted date formats, owner filter; populates after commit', async () => {
      oldDoc();
      const res = await service.updateIncome(
        SUB,
        updateDto({
          description: null,
          userId: OTHER,
          typeOfRecord: 'transfer',
        }),
      );
      expect(incomeModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: RID, userId: SUB },
        {
          $set: {
            shortName: 'Salary',
            typeOfRecord: 'transfer',
            amount: 200,
            date: INPUT_DATE,
            category: CAT,
            account: ACC,
            fullDate: 'Lun, 3 Feb, 2025',
            formattedTime: '20:05pm',
            amountFormatted: '$200.00',
          },
        },
        { session, returnDocument: 'after' },
      );
      expect(doc.populate).toHaveBeenCalledWith([
        EXPENSES_PAID_POPULATE,
        CATEGORY_POPULATE,
      ]);
      expect(res.data).toStrictEqual({ income: doc });
    });

    it('404 when the update matches nothing (race)', async () => {
      oldDoc();
      updateQuery.exec.mockResolvedValueOnce(null);
      await rejectsWith(
        service.updateIncome(SUB, updateDto()),
        NotFoundException,
        'Expense not found.',
      );
    });
  });
});
