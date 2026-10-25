import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import type { ClientSession } from 'mongoose';
import { Expense } from '../entities/expense.entity.js';
import { RecordPortsService } from './record-ports.service.js';

describe('RecordPortsService', () => {
  let service: RecordPortsService;
  const exec = vi.fn();
  const model = { updateMany: vi.fn(() => ({ exec })) };
  const session = { id: 'fake-session' } as unknown as ClientSession;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordPortsService,
        { provide: getModelToken(Expense.name), useValue: model },
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
});
