import { NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { ClientSession } from 'mongoose';
import { INITIAL_RESPONSE } from '../../constants.js';
import { BUDGET_EXPENSES_UNLINK } from '../budget.constants.js';
import type { CreateBudgetDto, UpdateBudgetDto } from '../dtos/budget.dto.js';
import { BudgetHistory } from '../entities/budget-history.entity.js';
import { Budget } from '../entities/budget.entity.js';
import { BudgetService } from './budget.service.js';

const exec = (value: unknown) => ({ exec: vi.fn().mockResolvedValue(value) });
const SUB = '507f1f77bcf86cd799439011';
const BID = '64b7f0c2a1b2c3d4e5f60718';
const rejects404 = async (p: Promise<unknown>, message: string) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(NotFoundException);
  expect((err as Error).message).toBe(message);
};
const dto = {
  name: 'Food',
  description: '',
  typeBudget: 'periodic',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31'),
  currentAmount: 0,
  limit: 500,
  period: 'monthly',
  isActive: true,
  nextResetDate: new Date('2026-01-31'),
  previousPeriods: [],
} as CreateBudgetDto;
const update = (fields: object) =>
  ({ budgetId: BID, ...fields }) as unknown as UpdateBudgetDto;

describe('BudgetService', () => {
  let service: BudgetService;
  const budgetModel = {
    create: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findOneAndDelete: vi.fn(),
  };
  const historyModel = { create: vi.fn(), findOneAndDelete: vi.fn() };
  const session = { id: 'fake-session' } as unknown as ClientSession;
  const connection = { transaction: vi.fn() };
  const unlink = { unlinkBudget: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    connection.transaction.mockImplementation(
      (fn: (s: unknown) => Promise<unknown>) => fn(session),
    );
    unlink.unlinkBudget.mockResolvedValue(undefined);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetService,
        { provide: getModelToken(Budget.name), useValue: budgetModel },
        { provide: getModelToken(BudgetHistory.name), useValue: historyModel },
        { provide: getConnectionToken(), useValue: connection },
        { provide: BUDGET_EXPENSES_UNLINK, useValue: unlink },
      ],
    }).compile();
    service = module.get<BudgetService>(BudgetService);
  });

  describe('createBudget', () => {
    it('creates budget then history in the session, array form', async () => {
      const budget = { _id: BID, ...dto, sub: SUB };
      const budgetHistory = { _id: 'h1', budget: BID, sub: SUB, records: [] };
      budgetModel.create.mockResolvedValue([budget]);
      historyModel.create.mockResolvedValue([budgetHistory]);
      await expect(service.createBudget(SUB, dto)).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'New budget created',
        data: { budget, budgetHistory },
      });
      expect(budgetModel.create).toHaveBeenCalledWith([{ ...dto, sub: SUB }], {
        session,
      });
      expect(historyModel.create).toHaveBeenCalledWith(
        [{ budget: BID, sub: SUB, records: [] }],
        { session },
      );
    });
  });

  describe('findByUser', () => {
    it('{ sub } without sub; empty → data null + message', async () => {
      budgetModel.find.mockReturnValue(exec([]));
      await expect(service.findByUser(SUB)).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Budgets not found',
      });
      expect(budgetModel.find).toHaveBeenCalledWith({ sub: SUB }, { sub: 0 });
      const budgets = [{ name: 'A' }];
      budgetModel.find.mockReturnValue(exec(budgets));
      await expect(service.findByUser(SUB)).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { budgets },
      });
    });
  });

  describe('findOne', () => {
    it('filters { _id, sub }; null → 200 data null + message', async () => {
      budgetModel.findOne.mockReturnValue(exec(null));
      await expect(service.findOne(SUB, BID)).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Budget not found',
      });
      expect(budgetModel.findOne).toHaveBeenCalledWith({ _id: BID, sub: SUB });
      const budget = { _id: BID };
      budgetModel.findOne.mockReturnValue(exec(budget));
      await expect(service.findOne(SUB, BID)).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { budget },
      });
    });
  });

  describe('updateBudget', () => {
    it('$sets present non-null allowed fields, keeps 0, owner filter', async () => {
      const budget = { _id: BID, name: 'New' };
      budgetModel.findOneAndUpdate.mockReturnValue(exec(budget));
      await expect(
        service.updateBudget(
          SUB,
          update({
            name: 'New',
            currentAmount: 0,
            limit: null,
            sub: 'x',
            nestResetDate: new Date(),
          }),
        ),
      ).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Budget history updated',
        data: { budget },
      });
      expect(budgetModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: BID, sub: SUB },
        { $set: { name: 'New', currentAmount: 0 } },
        { returnDocument: 'after' },
      );
    });

    it('404 when nothing owned matches', async () => {
      budgetModel.findOneAndUpdate.mockReturnValue(exec(null));
      await rejects404(
        service.updateBudget(SUB, update({})),
        'Budget not found',
      );
    });
  });

  describe('deleteBudget', () => {
    it('budget missing → 404, port and history not called', async () => {
      budgetModel.findOneAndDelete.mockReturnValue(exec(null));
      await rejects404(
        service.deleteBudget(SUB, { budgetId: BID }),
        'Budget not found',
      );
      expect(unlink.unlinkBudget).not.toHaveBeenCalled();
      expect(historyModel.findOneAndDelete).not.toHaveBeenCalled();
    });

    it('deletes budget, unlinks and deletes history in the session', async () => {
      const budget = { _id: BID };
      const budgetHistoryDeleted = { _id: 'h1' };
      budgetModel.findOneAndDelete.mockReturnValue(exec(budget));
      historyModel.findOneAndDelete.mockReturnValue(exec(budgetHistoryDeleted));
      await expect(
        service.deleteBudget(SUB, { budgetId: BID }),
      ).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Budget deleted',
        data: { budget, budgetHistoryDeleted },
      });
      expect(budgetModel.findOneAndDelete).toHaveBeenCalledWith(
        { _id: BID, sub: SUB },
        { session },
      );
      expect(unlink.unlinkBudget).toHaveBeenCalledWith({
        budgetId: BID,
        sub: SUB,
        session,
      });
      expect(historyModel.findOneAndDelete).toHaveBeenCalledWith(
        { budget: BID, sub: SUB },
        { session },
      );
    });

    it('missing history → 404 history text after the transaction resolved (Q6)', async () => {
      budgetModel.findOneAndDelete.mockReturnValue(exec({ _id: BID }));
      historyModel.findOneAndDelete.mockReturnValue(exec(null));
      await rejects404(
        service.deleteBudget(SUB, { budgetId: BID }),
        'Budget history not found',
      );
      await expect(
        connection.transaction.mock.results[0].value,
      ).resolves.toEqual({ budget: { _id: BID }, budgetHistoryDeleted: null });
    });
  });

  describe('incrementBudgetAmount', () => {
    it('owner-bound $inc in the session, returns before/after amounts', async () => {
      budgetModel.findOneAndUpdate.mockReturnValue(exec({ currentAmount: 10 }));
      await expect(
        service.incrementBudgetAmount({
          budgetId: BID,
          sub: SUB,
          delta: 12.5,
          session,
        }),
      ).resolves.toStrictEqual({
        budgetCurrentAmount: 10,
        budgetUpdatedAmount: 22.5,
      });
      expect(budgetModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: BID, sub: SUB },
        { $inc: { currentAmount: 12.5 } },
        { session, returnDocument: 'before' },
      );
    });

    it('null when nothing matches; null for a bad id without a query', async () => {
      budgetModel.findOneAndUpdate.mockReturnValue(exec(null));
      await expect(
        service.incrementBudgetAmount({
          budgetId: BID,
          sub: SUB,
          delta: 1,
          session,
        }),
      ).resolves.toBeNull();
      budgetModel.findOneAndUpdate.mockClear();
      await expect(
        service.incrementBudgetAmount({
          budgetId: 'abc',
          sub: SUB,
          delta: 1,
          session,
        }),
      ).resolves.toBeNull();
      expect(budgetModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
