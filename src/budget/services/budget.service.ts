import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  type ClientSession,
  type Connection,
  isValidObjectId,
  Model,
} from 'mongoose';
import { INITIAL_RESPONSE } from '../../constants.js';
import type { GeneralResponse } from '../../response.interface.js';
import {
  BUDGET_CREATED_MESSAGE,
  BUDGET_DELETED_MESSAGE,
  BUDGET_EXPENSES_UNLINK,
  BUDGET_HISTORY_NOT_FOUND_ERROR,
  BUDGET_NOT_FOUND_ERROR,
  BUDGET_UPDATED_MESSAGE,
  BUDGETS_NOT_FOUND_ERROR,
} from '../budget.constants.js';
import type { BudgetExpensesUnlink } from '../budget.interface.js';
import {
  CreateBudgetDto,
  DeleteBudgetDto,
  UpdateBudgetDto,
} from '../dtos/budget.dto.js';
import { BudgetHistory } from '../entities/budget-history.entity.js';
import { Budget } from '../entities/budget.entity.js';

// Never budgetId, sub or the legacy nestResetDate.
const UPDATABLE_FIELDS = [
  'name',
  'description',
  'typeBudget',
  'startDate',
  'endDate',
  'currentAmount',
  'limit',
  'period',
  'isActive',
  'nextResetDate',
  'previousPeriods',
] as const;

// Responses carry the hydrated docs (Nest serializes them through toJSON), as develop did.
// No try/catch: mongoose ValidationError/CastError → 400 and anything else → 500 via the global filters.
@Injectable()
export class BudgetService {
  constructor(
    @InjectModel(Budget.name) private readonly budgetModel: Model<Budget>,
    @InjectModel(BudgetHistory.name)
    private readonly historyModel: Model<BudgetHistory>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(BUDGET_EXPENSES_UNLINK)
    private readonly expensesUnlink: BudgetExpensesUnlink,
  ) {}

  // Budget and its history doc in one transaction; both created inside fn, so a retry makes fresh _ids.
  async createBudget(
    sub: string,
    dto: CreateBudgetDto,
  ): Promise<GeneralResponse> {
    const data = await this.connection.transaction(async (session) => {
      const [budget] = await this.budgetModel.create([{ ...dto, sub }], {
        session,
      });
      const [budgetHistory] = await this.historyModel.create(
        [{ budget: budget._id, sub, records: [] }],
        { session },
      );
      return { budget, budgetHistory };
    });
    return { ...INITIAL_RESPONSE, message: BUDGET_CREATED_MESSAGE, data };
  }

  // Empty → 200 with data: null (develop; clients branch on the message).
  async findByUser(sub: string): Promise<GeneralResponse> {
    const budgets = await this.budgetModel.find({ sub }, { sub: 0 }).exec();
    if (budgets.length === 0) {
      return { ...INITIAL_RESPONSE, message: BUDGETS_NOT_FOUND_ERROR };
    }
    return { ...INITIAL_RESPONSE, data: { budgets } };
  }

  // A non-ObjectId id → CastError → 400 'Invalid _id' via the filter.
  async findOne(sub: string, budgetId: string): Promise<GeneralResponse> {
    const budget = await this.budgetModel
      .findOne({ _id: budgetId, sub })
      .exec();
    if (!budget) {
      return { ...INITIAL_RESPONSE, message: BUDGET_NOT_FOUND_ERROR };
    }
    return { ...INITIAL_RESPONSE, data: { budget } };
  }

  async updateBudget(
    sub: string,
    dto: UpdateBudgetDto,
  ): Promise<GeneralResponse> {
    // Only present, non-null fields (IsOptional lets null through).
    const $set = Object.fromEntries(
      UPDATABLE_FIELDS.filter((f) => dto[f] != null).map((f) => [f, dto[f]]),
    );
    const budget = await this.budgetModel
      .findOneAndUpdate(
        { _id: dto.budgetId, sub },
        { $set },
        { returnDocument: 'after' },
      )
      .exec();
    if (!budget) throw new NotFoundException(BUDGET_NOT_FOUND_ERROR);
    return {
      ...INITIAL_RESPONSE,
      message: BUDGET_UPDATED_MESSAGE,
      data: { budget },
    };
  }

  // Budget, expenses unlink (S7 port) and history in one transaction; nothing in it has side effects (it may be retried).
  async deleteBudget(
    sub: string,
    { budgetId }: DeleteBudgetDto,
  ): Promise<GeneralResponse> {
    const data = await this.connection.transaction(async (session) => {
      const budget = await this.budgetModel
        .findOneAndDelete({ _id: budgetId, sub }, { session })
        .exec();
      if (!budget) throw new NotFoundException(BUDGET_NOT_FOUND_ERROR);
      await this.expensesUnlink.unlinkBudget({ budgetId, sub, session });
      const budgetHistoryDeleted = await this.historyModel
        .findOneAndDelete({ budget: budgetId, sub }, { session })
        .exec();
      // A missing history must not abort: develop deleted the budget and then answered 404 (E6.Q6).
      return { budget, budgetHistoryDeleted };
    });
    if (!data.budgetHistoryDeleted) {
      throw new NotFoundException(BUDGET_HISTORY_NOT_FOUND_ERROR);
    }
    return { ...INITIAL_RESPONSE, message: BUDGET_DELETED_MESSAGE, data };
  }

  // For S7 (records): owner-bound $inc in the caller's session. Missing/foreign → null, the caller decides (E6.Q4).
  // Returns the two amounts a history entry stores; $inc is the same IEEE addition, so `updated` equals the stored value.
  async incrementBudgetAmount({
    budgetId,
    sub,
    delta,
    session,
  }: {
    budgetId: string;
    sub: string;
    delta: number;
    session: ClientSession;
  }): Promise<{
    budgetCurrentAmount: number;
    budgetUpdatedAmount: number;
  } | null> {
    if (!isValidObjectId(budgetId)) return null;
    const before = await this.budgetModel
      .findOneAndUpdate(
        { _id: budgetId, sub },
        { $inc: { currentAmount: delta } },
        { session, returnDocument: 'before' },
      )
      .exec();
    if (!before) return null;
    return {
      budgetCurrentAmount: before.currentAmount,
      budgetUpdatedAmount: before.currentAmount + delta,
    };
  }
}
