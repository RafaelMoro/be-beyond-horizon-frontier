import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { ClientSession } from 'mongoose';
import { INITIAL_RESPONSE } from '../../constants.js';
import { BudgetHistory } from '../entities/budget-history.entity.js';
import { Budget } from '../entities/budget.entity.js';
import { BudgetHistoryService } from './budget-history.service.js';

const exec = (value: unknown) => ({ exec: vi.fn().mockResolvedValue(value) });
// find/findOne(...).populate('budget').exec()
const populated = (value: unknown) => {
  const q = { populate: vi.fn(), exec: vi.fn().mockResolvedValue(value) };
  q.populate.mockReturnValue(q);
  return q;
};
const SUB = '507f1f77bcf86cd799439011';
const BID = '64b7f0c2a1b2c3d4e5f60718';
const HID = '64b7f0c2a1b2c3d4e5f60719';
const NOT_FOUND = 'Budget history not found';
const rejectsWith = async (
  p: Promise<unknown>,
  type: typeof BadRequestException | typeof NotFoundException,
  message: string,
) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(type);
  expect((err as Error).message).toBe(message);
};
const record = {
  recordId: 'r1',
  recordName: 'Lunch',
  recordDate: new Date('2026-01-02'),
  recordAmount: 10,
  budgetCurrentAmount: 0,
  budgetUpdatedAmount: 10,
};

describe('BudgetHistoryService', () => {
  let service: BudgetHistoryService;
  const historyModel = {
    create: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findOneAndDelete: vi.fn(),
  };
  const budgetModel = { exists: vi.fn() };
  const session = { id: 'fake-session' } as unknown as ClientSession;

  beforeEach(async () => {
    vi.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetHistoryService,
        { provide: getModelToken(BudgetHistory.name), useValue: historyModel },
        { provide: getModelToken(Budget.name), useValue: budgetModel },
      ],
    }).compile();
    service = module.get<BudgetHistoryService>(BudgetHistoryService);
  });

  describe('createHistory', () => {
    it('bad id → 404 without a query', async () => {
      await rejectsWith(
        service.createHistory(SUB, { budget: 'abc', records: [] }),
        NotFoundException,
        'Budget not found',
      );
      expect(budgetModel.exists).not.toHaveBeenCalled();
      expect(historyModel.create).not.toHaveBeenCalled();
    });

    it('missing/foreign budget → 404 without create', async () => {
      budgetModel.exists.mockReturnValue(exec(null));
      await rejectsWith(
        service.createHistory(SUB, { budget: BID, records: [] }),
        NotFoundException,
        'Budget not found',
      );
      expect(budgetModel.exists).toHaveBeenCalledWith({ _id: BID, sub: SUB });
      expect(historyModel.create).not.toHaveBeenCalled();
    });

    it('owned budget → creates with the sub', async () => {
      budgetModel.exists.mockReturnValue(exec({ _id: BID }));
      const budgetHistory = { _id: HID };
      historyModel.create.mockResolvedValue(budgetHistory);
      await expect(
        service.createHistory(SUB, { budget: BID, records: [record] }),
      ).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'New budget history created',
        data: { budgetHistory },
      });
      expect(historyModel.create).toHaveBeenCalledWith({
        budget: BID,
        sub: SUB,
        records: [record],
      });
    });
  });

  describe('reads', () => {
    it('findByUser: { sub } without sub, populated; empty → 404', async () => {
      const q = populated([]);
      historyModel.find.mockReturnValue(q);
      await rejectsWith(service.findByUser(SUB), NotFoundException, NOT_FOUND);
      expect(historyModel.find).toHaveBeenCalledWith({ sub: SUB }, { sub: 0 });
      expect(q.populate).toHaveBeenCalledWith('budget');
      const budgetsHistory = [{ _id: HID }];
      historyModel.find.mockReturnValue(populated(budgetsHistory));
      await expect(service.findByUser(SUB)).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { budgetsHistory },
      });
    });

    it('findOne (D13): { _id, sub }, populated; null → 404', async () => {
      const q = populated(null);
      historyModel.findOne.mockReturnValue(q);
      await rejectsWith(
        service.findOne(SUB, HID),
        NotFoundException,
        NOT_FOUND,
      );
      expect(historyModel.findOne).toHaveBeenCalledWith({ _id: HID, sub: SUB });
      expect(q.populate).toHaveBeenCalledWith('budget');
      const budgetHistory = { _id: HID };
      historyModel.findOne.mockReturnValue(populated(budgetHistory));
      await expect(service.findOne(SUB, HID)).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { budgetHistory },
      });
    });
  });

  describe('updateHistory / deleteHistory', () => {
    it('$sets only records, never budget; owner filter', async () => {
      const budgetHistory = { _id: HID };
      historyModel.findOneAndUpdate.mockReturnValue(exec(budgetHistory));
      await expect(
        service.updateHistory(SUB, {
          budgetHistoryId: HID,
          budget: BID,
          records: [record],
        }),
      ).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Budget history updated',
        data: { budgetHistory },
      });
      expect(historyModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: HID, sub: SUB },
        { $set: { records: [record] } },
        { returnDocument: 'after' },
      );
      await service.updateHistory(SUB, { budgetHistoryId: HID, budget: BID });
      expect(historyModel.findOneAndUpdate).toHaveBeenLastCalledWith(
        { _id: HID, sub: SUB },
        { $set: {} },
        { returnDocument: 'after' },
      );
    });

    it('404 when nothing owned matches', async () => {
      historyModel.findOneAndUpdate.mockReturnValue(exec(null));
      await rejectsWith(
        service.updateHistory(SUB, { budgetHistoryId: HID }),
        NotFoundException,
        NOT_FOUND,
      );
      historyModel.findOneAndDelete.mockReturnValue(exec(null));
      await rejectsWith(
        service.deleteHistory(SUB, { budgetHistoryId: HID }),
        NotFoundException,
        NOT_FOUND,
      );
      expect(historyModel.findOneAndDelete).toHaveBeenCalledWith({
        _id: HID,
        sub: SUB,
      });
    });

    it('delete → 200 with the doc', async () => {
      const budgetHistory = { _id: HID };
      historyModel.findOneAndDelete.mockReturnValue(exec(budgetHistory));
      await expect(
        service.deleteHistory(SUB, { budgetHistoryId: HID }),
      ).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Budget history deleted',
        data: { budgetHistory },
      });
    });
  });

  describe('record helpers', () => {
    it('addHistoryRecord: owner-bound $push with the session', async () => {
      const doc = { _id: HID };
      historyModel.findOneAndUpdate.mockReturnValue(exec(doc));
      await expect(
        service.addHistoryRecord({ budgetId: BID, sub: SUB, record, session }),
      ).resolves.toBe(doc);
      expect(historyModel.findOneAndUpdate).toHaveBeenCalledWith(
        { budget: BID, sub: SUB },
        { $push: { records: record } },
        { session, returnDocument: 'after' },
      );
    });

    it('removeHistoryRecord: $pull by recordId with the session', async () => {
      historyModel.findOneAndUpdate.mockReturnValue(exec({ _id: HID }));
      await service.removeHistoryRecord({
        budgetId: BID,
        sub: SUB,
        recordId: 'r1',
        session,
      });
      expect(historyModel.findOneAndUpdate).toHaveBeenCalledWith(
        { budget: BID, sub: SUB },
        { $pull: { records: { recordId: 'r1' } } },
        { session, returnDocument: 'after' },
      );
    });

    it('null or bad id → 400 history text', async () => {
      historyModel.findOneAndUpdate.mockReturnValue(exec(null));
      await rejectsWith(
        service.addHistoryRecord({ budgetId: BID, sub: SUB, record }),
        BadRequestException,
        NOT_FOUND,
      );
      historyModel.findOneAndUpdate.mockClear();
      await rejectsWith(
        service.removeHistoryRecord({
          budgetId: 'abc',
          sub: SUB,
          recordId: 'r1',
        }),
        BadRequestException,
        NOT_FOUND,
      );
      expect(historyModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('HTTP wrappers: 201 texts, record → recordId, no session', async () => {
      const doc = { _id: HID };
      historyModel.findOneAndUpdate.mockReturnValue(exec(doc));
      await expect(
        service.addRecord(SUB, { budgetId: BID, record }),
      ).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Record added to budget history',
        data: { budgetHistory: doc },
      });
      await expect(
        service.removeRecord(SUB, { budgetId: BID, record: HID }),
      ).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Record removed from budget history',
        data: { budgetHistory: doc },
      });
      expect(historyModel.findOneAndUpdate).toHaveBeenLastCalledWith(
        { budget: BID, sub: SUB },
        { $pull: { records: { recordId: HID } } },
        { session: undefined, returnDocument: 'after' },
      );
    });
  });
});
