import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type ClientSession, isValidObjectId, Model } from 'mongoose';
import { INITIAL_RESPONSE } from '../../constants.js';
import type { GeneralResponse } from '../../response.interface.js';
import {
  BUDGET_HISTORY_CREATED,
  BUDGET_HISTORY_DELETED_MESSAGE,
  BUDGET_HISTORY_NOT_FOUND_ERROR,
  BUDGET_NOT_FOUND_ERROR,
  BUDGET_UPDATED_MESSAGE,
  RECORD_ADDED_MESSAGE,
  RECORD_REMOVED_MESSAGE,
} from '../budget.constants.js';
import {
  AddRecordToBudgetHistoryDto,
  CreateBudgetHistoryDto,
  DeleteBudgetHistoryDto,
  RemoveRecordFromBudgetHistoryDto,
  UpdateBudgetHistoryDto,
} from '../dtos/budget-history.dto.js';
import {
  BudgetHistory,
  type BudgetHistoryDoc,
  type BudgetHistoryRecord,
} from '../entities/budget-history.entity.js';
import { Budget } from '../entities/budget.entity.js';

// No try/catch: CastError → 400, E11000 → 409 and anything else → 500 via the global filters.
@Injectable()
export class BudgetHistoryService {
  constructor(
    @InjectModel(BudgetHistory.name)
    private readonly historyModel: Model<BudgetHistory>,
    @InjectModel(Budget.name) private readonly budgetModel: Model<Budget>,
  ) {}

  // Audit Medium (E6.Q3): the budget must be one of the caller's, else 404 and no write. A duplicate → 409 via the
  // unique index (test-only until S8). No transaction: a budget deleted in between leaves an orphan (accepted).
  async createHistory(
    sub: string,
    { budget, records }: CreateBudgetHistoryDto,
  ): Promise<GeneralResponse> {
    if (
      !isValidObjectId(budget) ||
      !(await this.budgetModel.exists({ _id: budget, sub }).exec())
    ) {
      throw new NotFoundException(BUDGET_NOT_FOUND_ERROR);
    }
    const budgetHistory = await this.historyModel.create({
      budget,
      sub,
      records,
    });
    return {
      ...INITIAL_RESPONSE,
      message: BUDGET_HISTORY_CREATED,
      data: { budgetHistory },
    };
  }

  // Empty → 404 (develop), unlike GET /budgets.
  async findByUser(sub: string): Promise<GeneralResponse> {
    const budgetsHistory = await this.historyModel
      .find({ sub }, { sub: 0 })
      .populate('budget')
      .exec();
    if (budgetsHistory.length === 0) {
      throw new NotFoundException(BUDGET_HISTORY_NOT_FOUND_ERROR);
    }
    return { ...INITIAL_RESPONSE, data: { budgetsHistory } };
  }

  // D13: develop filtered on a non-existent `userId` and always 404'd.
  async findOne(
    sub: string,
    budgetHistoryId: string,
  ): Promise<GeneralResponse> {
    const budgetHistory = await this.historyModel
      .findOne({ _id: budgetHistoryId, sub })
      .populate('budget')
      .exec();
    if (!budgetHistory) {
      throw new NotFoundException(BUDGET_HISTORY_NOT_FOUND_ERROR);
    }
    return { ...INITIAL_RESPONSE, data: { budgetHistory } };
  }

  // `budget` is ignored (develop; no repointing); `records` is replaced wholesale.
  async updateHistory(
    sub: string,
    { budgetHistoryId, records }: UpdateBudgetHistoryDto,
  ): Promise<GeneralResponse> {
    const $set = records ? { records } : {};
    const budgetHistory = await this.historyModel
      .findOneAndUpdate(
        { _id: budgetHistoryId, sub },
        { $set },
        { returnDocument: 'after' },
      )
      .exec();
    if (!budgetHistory) {
      throw new NotFoundException(BUDGET_HISTORY_NOT_FOUND_ERROR);
    }
    return {
      ...INITIAL_RESPONSE,
      message: BUDGET_UPDATED_MESSAGE,
      data: { budgetHistory },
    };
  }

  async deleteHistory(
    sub: string,
    { budgetHistoryId }: DeleteBudgetHistoryDto,
  ): Promise<GeneralResponse> {
    const budgetHistory = await this.historyModel
      .findOneAndDelete({ _id: budgetHistoryId, sub })
      .exec();
    if (!budgetHistory) {
      throw new NotFoundException(BUDGET_HISTORY_NOT_FOUND_ERROR);
    }
    return {
      ...INITIAL_RESPONSE,
      message: BUDGET_HISTORY_DELETED_MESSAGE,
      data: { budgetHistory },
    };
  }

  async addRecord(
    sub: string,
    { budgetId, record }: AddRecordToBudgetHistoryDto,
  ): Promise<GeneralResponse> {
    const budgetHistory = await this.addHistoryRecord({
      budgetId,
      sub,
      record,
    });
    return {
      ...INITIAL_RESPONSE,
      message: RECORD_ADDED_MESSAGE,
      data: { budgetHistory },
    };
  }

  async removeRecord(
    sub: string,
    { budgetId, record }: RemoveRecordFromBudgetHistoryDto,
  ): Promise<GeneralResponse> {
    const budgetHistory = await this.removeHistoryRecord({
      budgetId,
      sub,
      recordId: record,
    });
    return {
      ...INITIAL_RESPONSE,
      message: RECORD_REMOVED_MESSAGE,
      data: { budgetHistory },
    };
  }

  // For S7 (and the add-record route): one owner-bound $push. Not found → 400 (develop's status), aborting S7's transaction.
  async addHistoryRecord({
    budgetId,
    sub,
    record,
    session,
  }: {
    budgetId: string;
    sub: string;
    record: BudgetHistoryRecord;
    session?: ClientSession;
  }): Promise<BudgetHistoryDoc> {
    return this.updateRecords(
      budgetId,
      sub,
      { $push: { records: record } },
      session,
    );
  }

  // For S7 (and the delete-record route): one owner-bound $pull. An unknown recordId leaves the doc unchanged.
  async removeHistoryRecord({
    budgetId,
    sub,
    recordId,
    session,
  }: {
    budgetId: string;
    sub: string;
    recordId: string;
    session?: ClientSession;
  }): Promise<BudgetHistoryDoc> {
    return this.updateRecords(
      budgetId,
      sub,
      { $pull: { records: { recordId } } },
      session,
    );
  }

  private async updateRecords(
    budgetId: string,
    sub: string,
    update: object,
    session?: ClientSession,
  ): Promise<BudgetHistoryDoc> {
    if (!isValidObjectId(budgetId)) {
      throw new BadRequestException(BUDGET_HISTORY_NOT_FOUND_ERROR);
    }
    const budgetHistory = await this.historyModel
      .findOneAndUpdate({ budget: budgetId, sub }, update, {
        session,
        returnDocument: 'after',
      })
      .exec();
    if (!budgetHistory) {
      throw new BadRequestException(BUDGET_HISTORY_NOT_FOUND_ERROR);
    }
    return budgetHistory;
  }
}
