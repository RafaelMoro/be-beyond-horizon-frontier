import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { ClientSession } from 'mongoose';
import { Expense } from '../entities/expense.entity.js';
import { Income } from '../entities/income.entity.js';
import { RecordPortsService } from './record-ports.service.js';

describe('RecordPortsService', () => {
  let service: RecordPortsService;
  const exec = vi.fn();
  const incomeExec = vi.fn();
  const model = {
    updateMany: vi.fn(() => ({ exec })),
    deleteMany: vi.fn(() => ({ exec })),
  };
  const incomeModel = { deleteMany: vi.fn(() => ({ exec: incomeExec })) };
  const session = { id: 'fake-session' } as unknown as ClientSession;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordPortsService,
        { provide: getModelToken(Expense.name), useValue: model },
        { provide: getModelToken(Income.name), useValue: incomeModel },
      ],
    }).compile();
    service = module.get(RecordPortsService);
  });

  it("unlinkBudget pulls the budget from the owner's expenses in the session", async () => {
    await service.unlinkBudget({ budgetId: 'b1', sub: 'u1', session });
    expect(model.updateMany).toHaveBeenCalledWith(
      { userId: 'u1', linkedBudgets: 'b1' },
      { $pull: { linkedBudgets: 'b1' } },
      { session },
    );
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("deleteAccountRecords deletes the owner's expenses and incomes on that account and maps the counts", async () => {
    exec.mockResolvedValue({ deletedCount: 2 });
    incomeExec.mockResolvedValue({ deletedCount: 1 });
    expect(
      await service.deleteAccountRecords({
        accountId: 'a1',
        sub: 'u1',
        session,
      }),
    ).toStrictEqual({ numberExpensesDeleted: 2, numberIncomesDeleted: 1 });
    const filter = { userId: 'u1', account: 'a1' };
    expect(model.deleteMany).toHaveBeenCalledWith(filter, { session });
    expect(incomeModel.deleteMany).toHaveBeenCalledWith(filter, { session });
  });
});
