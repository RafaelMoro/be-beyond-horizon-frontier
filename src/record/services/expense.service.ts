import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { AccountService } from '../../account/services/account.service.js';
import { BUDGET_HISTORY_NOT_FOUND_ERROR } from '../../budget/budget.constants.js';
import { BudgetHistoryService } from '../../budget/services/budget-history.service.js';
import { BudgetService } from '../../budget/services/budget.service.js';
import { CategoryService } from '../../category/services/category.service.js';
import { INITIAL_RESPONSE } from '../../constants.js';
import type { GeneralResponse } from '../../response.interface.js';
import {
  CreateExpenseDto,
  DeleteExpenseDto,
  UpdateExpenseDto,
} from '../dtos/expense.dto.js';
import { Expense } from '../entities/expense.entity.js';
import {
  CATEGORY_POPULATE,
  EXPENSE_CREATED_MESSAGE,
  EXPENSE_DELETED_MESSAGE,
  EXPENSE_NOT_FOUND,
  EXPENSE_UNAUTHORIZED_ERROR,
  EXPENSES_NOT_FOUND,
  MAX_LINKED_BUDGETS,
  MAXIMUM_BUDGETS_LIMIT_ERROR,
  MISSING_AMOUNT,
  MISSING_CATEGORY,
  MISSING_DATE,
  MISSING_LINKED_BUDGETS,
  TRANSFER_RECORD_LINKED_BUDGET_ERROR,
  TYPE_OF_RECORD_INVALID,
} from '../record.constants.js';
import type { ExpenseMutationResult } from '../record.interface.js';
import {
  formatDateToString,
  formatNumberToCurrency,
  getMonthBounds,
  toMexicoCityWallClock,
} from '../record.utils.js';

// Never recordId or userId.
const UPDATABLE_FIELDS = [
  'shortName',
  'typeOfRecord',
  'description',
  'amount',
  'date',
  'category',
  'subCategory',
  'tag',
  'indebtedPeople',
  'transferRecord',
  'account',
  'budgets',
  'isPaid',
] as const;

interface BudgetStep {
  budgetId: string;
  sub: string;
  recordId: string;
  amount: number;
  messages: string[];
  session: ClientSession;
}

// Mutations run in one transaction each: fn may be retried, so it has no side effects and re-reads everything.
// No try/catch: CastError/ValidationError → 400 and anything else → 500 via the global filters (D6).
@Injectable()
export class ExpenseService {
  constructor(
    @InjectModel(Expense.name) private readonly expenseModel: Model<Expense>,
    @InjectConnection() private readonly connection: Connection,
    private readonly accountService: AccountService,
    private readonly categoryService: CategoryService,
    private readonly budgetService: BudgetService,
    private readonly budgetHistoryService: BudgetHistoryService,
  ) {}

  // Lean keeps the stored keys (no `linkedBudgets: []` added), as legacy's aggregate. Unsorted (legacy).
  async findByAccountAndMonth({
    sub,
    accountId,
    month,
    year,
  }: {
    sub: string;
    accountId: string;
    month: string;
    year: string;
  }): Promise<GeneralResponse> {
    const bounds = getMonthBounds(month, year);
    const expenses = bounds
      ? await this.expenseModel
          .find({
            userId: sub,
            account: accountId,
            typeOfRecord: 'expense',
            date: { $gte: bounds.startDate, $lt: bounds.endDate },
          })
          .populate(CATEGORY_POPULATE)
          .populate('linkedBudgets')
          .lean()
          .exec()
      : [];
    if (expenses.length === 0) {
      return {
        ...INITIAL_RESPONSE,
        message: EXPENSES_NOT_FOUND,
        data: { expenses: [] },
      };
    }
    return { ...INITIAL_RESPONSE, data: { expenses } };
  }

  async createExpense(
    sub: string,
    dto: CreateExpenseDto,
  ): Promise<GeneralResponse> {
    // Develop's order, before any read.
    if (dto.linkedBudgets.length > 0 && dto.typeOfRecord === 'transfer') {
      throw new BadRequestException(TRANSFER_RECORD_LINKED_BUDGET_ERROR);
    }
    if (dto.typeOfRecord !== 'expense') {
      throw new BadRequestException(TYPE_OF_RECORD_INVALID);
    }
    if (dto.linkedBudgets.length > MAX_LINKED_BUDGETS) {
      throw new BadRequestException(MAXIMUM_BUDGETS_LIMIT_ERROR);
    }
    const budgetIds = [...new Set(dto.linkedBudgets)];
    const { expense, messages } =
      await this.connection.transaction<ExpenseMutationResult>(
        async (session) => {
          const messages: string[] = [];
          await this.categoryService.assertCategoryOwned(dto.category, sub);
          await this.accountService.assertAccountOwned({
            accountId: dto.account,
            sub,
            session,
          });
          const date = toMexicoCityWallClock(dto.date);
          const [expense] = await this.expenseModel.create(
            [
              {
                ...dto,
                linkedBudgets: budgetIds,
                date,
                ...formatDateToString(date),
                amountFormatted: formatNumberToCurrency(dto.amount),
                userId: sub,
              },
            ],
            { session },
          );
          messages.push(EXPENSE_CREATED_MESSAGE);
          await this.accountService.incrementBalance({
            accountId: dto.account,
            sub,
            delta: -dto.amount,
            session,
          });
          messages.push('Account updated');
          for (const budgetId of budgetIds) {
            // History recordDate is the unshifted DTO date (research §4).
            await this.addToBudget({
              budgetId,
              sub,
              recordId: expense._id.toString(),
              recordName: dto.shortName,
              recordDate: dto.date,
              amount: dto.amount,
              messages,
              session,
            });
          }
          return { expense, messages };
        },
      );
    await expense.populate([CATEGORY_POPULATE, { path: 'linkedBudgets' }]);
    return { ...INITIAL_RESPONSE, message: messages, data: { expense } };
  }

  // Q9: ownership of category/account/budgets is checked only for a field this edit changes.
  async updateExpense(
    sub: string,
    dto: UpdateExpenseDto,
  ): Promise<GeneralResponse> {
    // Develop's order; falsy fails, so amount 0 → 400.
    if (!dto.date) throw new BadRequestException(MISSING_DATE);
    if (!dto.category) throw new BadRequestException(MISSING_CATEGORY);
    if (!dto.amount) throw new BadRequestException(MISSING_AMOUNT);
    if (!dto.linkedBudgets) {
      throw new BadRequestException(MISSING_LINKED_BUDGETS);
    }
    const { date, category, amount } = dto;
    const newIds = [...new Set(dto.linkedBudgets)];
    const { expense, messages } =
      await this.connection.transaction<ExpenseMutationResult>(
        async (session) => {
          const messages: string[] = [];
          const old = await this.findOwnedExpense(dto.recordId, sub, session);
          const recordId = dto.recordId;
          if (category !== String(old.category)) {
            await this.categoryService.assertCategoryOwned(category, sub);
          }
          const newAccount = dto.account ?? old.account;
          const accountChanged = newAccount !== old.account;
          if (accountChanged) {
            // Audit High: never move a record to another user's account.
            await this.accountService.assertAccountOwned({
              accountId: newAccount,
              sub,
              session,
            });
            await this.accountService.incrementBalance({
              accountId: old.account,
              sub,
              delta: old.amount,
              session,
            });
            await this.accountService.incrementBalance({
              accountId: newAccount,
              sub,
              delta: -amount,
              session,
            });
            messages.push("Account's amount updated");
          } else if (old.amount !== amount) {
            await this.accountService.incrementBalance({
              accountId: old.account,
              sub,
              delta: old.amount - amount,
              session,
            });
            messages.push("Account's amount updated");
          }

          // Q5 (bug 8 fixed): removed lose the old amount, added gain the new, kept move by new − old.
          const oldIds = (old.linkedBudgets ?? []).map(String);
          const step = { sub, recordId, messages, session };
          for (const budgetId of oldIds.filter((id) => !newIds.includes(id))) {
            await this.removeFromBudget({
              ...step,
              budgetId,
              amount: old.amount,
            });
          }
          const recordName = dto.shortName ?? old.shortName;
          for (const budgetId of newIds.filter((id) => !oldIds.includes(id))) {
            await this.addToBudget({
              ...step,
              budgetId,
              amount,
              recordName,
              recordDate: date,
            });
          }
          if (old.amount !== amount) {
            for (const budgetId of newIds.filter((id) => oldIds.includes(id))) {
              const r = await this.budgetService.incrementBudgetAmount({
                budgetId,
                sub,
                delta: amount - old.amount,
                session,
              });
              if (!r) continue;
              await this.budgetHistoryService.removeHistoryRecord({
                budgetId,
                sub,
                recordId,
                session,
              });
              await this.budgetHistoryService.addHistoryRecord({
                budgetId,
                sub,
                session,
                record: {
                  recordId,
                  recordName,
                  recordDate: date,
                  recordAmount: amount,
                  ...r,
                },
              });
              messages.push(`Budget updated: ${budgetId}`);
            }
          }

          // Only present, non-null fields (IsOptional lets null through). The date is not shifted on edit (§4).
          const $set = {
            ...Object.fromEntries(
              UPDATABLE_FIELDS.filter((f) => dto[f] != null).map((f) => [
                f,
                dto[f],
              ]),
            ),
            linkedBudgets: newIds,
            ...formatDateToString(date),
            amountFormatted: formatNumberToCurrency(amount),
          };
          const expense = await this.expenseModel
            .findOneAndUpdate(
              { _id: recordId, userId: sub },
              { $set },
              { session, returnDocument: 'after' },
            )
            .exec();
          if (!expense) throw new NotFoundException(EXPENSE_NOT_FOUND);
          messages.push('Updated expense');
          return { expense, messages };
        },
      );
    // Only the category (develop): linkedBudgets stay ids.
    await expense.populate(CATEGORY_POPULATE);
    return { ...INITIAL_RESPONSE, message: messages, data: { expense } };
  }

  // Q10: a missing or foreign account aborts with 404 and the record stays.
  async deleteExpense(
    sub: string,
    { recordId }: DeleteExpenseDto,
  ): Promise<GeneralResponse> {
    const { expense, messages } =
      await this.connection.transaction<ExpenseMutationResult>(
        async (session) => {
          const messages: string[] = [];
          const old = await this.findOwnedExpense(recordId, sub, session);
          const expense = await this.expenseModel
            .findOneAndDelete({ _id: recordId, userId: sub }, { session })
            .exec();
          if (!expense) throw new NotFoundException(EXPENSE_NOT_FOUND);
          messages.push(EXPENSE_DELETED_MESSAGE);
          await this.accountService.incrementBalance({
            accountId: old.account,
            sub,
            delta: old.amount,
            session,
          });
          messages.push("Account's amount updated");
          for (const budgetId of (old.linkedBudgets ?? []).map(String)) {
            await this.removeFromBudget({
              budgetId,
              sub,
              recordId,
              amount: old.amount,
              messages,
              session,
            });
          }
          return { expense, messages };
        },
      );
    // The raw deleted doc, unpopulated (develop).
    return { ...INITIAL_RESPONSE, message: messages, data: { expense } };
  }

  // Lean: the stored types (category string or ObjectId, no `linkedBudgets` key on old docs).
  private async findOwnedExpense(
    recordId: string,
    sub: string,
    session: ClientSession,
  ) {
    const old = await this.expenseModel
      .findById(recordId)
      .session(session)
      .lean()
      .exec();
    if (!old) throw new NotFoundException(EXPENSE_NOT_FOUND);
    if (String(old.userId) !== sub) {
      throw new UnauthorizedException(EXPENSE_UNAUTHORIZED_ERROR);
    }
    return old;
  }

  // A missing or foreign budget aborts everything (audit Medium), as does a budget whose history doc is gone.
  private async addToBudget({
    budgetId,
    sub,
    recordId,
    recordName,
    recordDate,
    amount,
    messages,
    session,
  }: BudgetStep & { recordName: string; recordDate: Date }): Promise<void> {
    const r = await this.budgetService.incrementBudgetAmount({
      budgetId,
      sub,
      delta: amount,
      session,
    });
    if (!r) throw new BadRequestException(BUDGET_HISTORY_NOT_FOUND_ERROR);
    await this.budgetHistoryService.addHistoryRecord({
      budgetId,
      sub,
      session,
      record: { recordId, recordName, recordDate, recordAmount: amount, ...r },
    });
    messages.push(`Budget added: ${budgetId}`);
  }

  // A missing or foreign (stale) budget is skipped, history included.
  private async removeFromBudget({
    budgetId,
    sub,
    recordId,
    amount,
    messages,
    session,
  }: BudgetStep): Promise<void> {
    const r = await this.budgetService.incrementBudgetAmount({
      budgetId,
      sub,
      delta: -amount,
      session,
    });
    if (!r) return;
    await this.budgetHistoryService.removeHistoryRecord({
      budgetId,
      sub,
      recordId,
      session,
    });
    messages.push(`Removed budget: ${budgetId}`);
  }
}
