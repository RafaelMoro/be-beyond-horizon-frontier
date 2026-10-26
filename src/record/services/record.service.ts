import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { type Connection, type Model, Types } from 'mongoose';
import { AccountService } from '../../account/services/account.service.js';
import { CategoryService } from '../../category/services/category.service.js';
import { INITIAL_RESPONSE } from '../../constants.js';
import type { GeneralResponse } from '../../response.interface.js';
import type { CreateTransferDto } from '../dtos/transfer.dto.js';
import { Expense } from '../entities/expense.entity.js';
import { Income } from '../entities/income.entity.js';
import {
  CATEGORY_POPULATE,
  EXPENSES_PAID_POPULATE,
  INVALID_EXPENSES_PAID,
  NO_EXPENSES_FOUND,
  NO_EXPENSES_INCOMES_FOUND,
  NO_INCOMES_FOUND,
  TRANSFER_ACCOUNT_ERROR,
  TRANSFER_EXPENSE_BUDGETS,
  TRANSFER_EXPENSE_NOT_PAID,
  transferMismatch,
  TYPE_OF_RECORD_INVALID,
} from '../record.constants.js';
import type { TransferMutationResult } from '../record.interface.js';
import {
  formatDateToString,
  formatNumberToCurrency,
  getMonthBounds,
  toExpenseIds,
  toMexicoCityWallClock,
} from '../record.utils.js';
import { IncomeService } from './income.service.js';

// The /records routes: the merged listing and the transfer create. No transfer edit/delete (D9): each side goes
// through its own expense/income route.
@Injectable()
export class RecordService {
  constructor(
    @InjectModel(Expense.name) private readonly expenseModel: Model<Expense>,
    @InjectModel(Income.name) private readonly incomeModel: Model<Income>,
    @InjectConnection() private readonly connection: Connection,
    private readonly accountService: AccountService,
    private readonly categoryService: CategoryService,
    private readonly incomeService: IncomeService,
  ) {}

  // No typeOfRecord filter: transfers are listed. Lean keeps the stored keys, so the client tells the kind by
  // `isPaid` / `expensesPaid` (legacy's aggregate).
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
    const empty = {
      ...INITIAL_RESPONSE,
      message: NO_EXPENSES_INCOMES_FOUND,
      data: null,
    };
    const bounds = getMonthBounds(month, year);
    if (!bounds) return empty;
    const filter = {
      userId: sub,
      account: accountId,
      date: { $gte: bounds.startDate, $lt: bounds.endDate },
    };
    const expenses = await this.expenseModel
      .find(filter)
      .populate(CATEGORY_POPULATE)
      .populate('linkedBudgets')
      .lean()
      .exec();
    const incomes = await this.incomeModel
      .find(filter)
      .populate(EXPENSES_PAID_POPULATE)
      .populate(CATEGORY_POPULATE)
      .lean()
      .exec();
    if (expenses.length === 0 && incomes.length === 0) return empty;
    // Date desc (legacy compareDateAndTime); sort is stable, so expenses stay first on equal dates.
    const records = [...expenses, ...incomes].sort(
      (a, b) => Number(b.date) - Number(a.date),
    );
    const message =
      expenses.length === 0
        ? NO_EXPENSES_FOUND
        : incomes.length === 0
          ? NO_INCOMES_FOUND
          : null;
    return { ...INITIAL_RESPONSE, message, data: { records } };
  }

  async createTransfer(
    sub: string,
    { expense, income }: CreateTransferDto,
  ): Promise<GeneralResponse> {
    this.validateTransfer({ expense, income });
    const ids = toExpenseIds(income.expensesPaid);
    if (!ids) throw new BadRequestException(INVALID_EXPENSES_PAID);
    // Outside fn: a retried transaction rewrites the same ids, so the cross-links stay right.
    const expenseId = new Types.ObjectId();
    const incomeId = new Types.ObjectId();
    let result: TransferMutationResult;
    try {
      result = await this.connection.transaction<TransferMutationResult>(
        async (session) => {
          const messages: string[] = [];
          await this.categoryService.assertCategoryOwned(expense.category, sub);
          // Expense account first (develop).
          await this.accountService.assertAccountOwned({
            accountId: expense.account,
            sub,
            session,
          });
          await this.accountService.assertAccountOwned({
            accountId: income.account,
            sub,
            session,
          });
          // Both sides get the same shifted date and formats.
          const date = toMexicoCityWallClock(expense.date);
          const common = {
            date,
            ...formatDateToString(date),
            amountFormatted: formatNumberToCurrency(expense.amount),
            userId: sub,
          };
          // A body transferRecord is overwritten (develop's $set did the same).
          const [e] = await this.expenseModel.create(
            [
              {
                ...expense,
                ...common,
                _id: expenseId,
                transferRecord: {
                  transferId: String(incomeId),
                  account: income.account,
                },
              },
            ],
            { session },
          );
          const owned = await this.incomeService.ownedExpenseIds({
            ids,
            sub,
            session,
          });
          const [i] = await this.incomeModel.create(
            [
              {
                ...income,
                ...common,
                _id: incomeId,
                expensesPaid: owned,
                transferRecord: {
                  transferId: String(expenseId),
                  account: expense.account,
                },
              },
            ],
            { session },
          );
          await this.accountService.incrementBalance({
            accountId: expense.account,
            sub,
            delta: -expense.amount,
            session,
          });
          await this.accountService.incrementBalance({
            accountId: income.account,
            sub,
            delta: income.amount,
            session,
          });
          await this.incomeService.payExpenses({
            ids,
            owned,
            sub,
            messages,
            session,
          });
          return { expense: e, income: i, messages };
        },
      );
    } catch (err) {
      // develop answers every transfer error with 400: only our own category/account texts are rewrapped, never a
      // library message. Anything else stays 500 (D6).
      if (
        err instanceof NotFoundException ||
        err instanceof UnauthorizedException
      ) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    // Unpopulated (develop).
    return {
      ...INITIAL_RESPONSE,
      message: result.messages,
      data: { expense: result.expense, income: result.income },
    };
  }

  // develop's validateTransferData, same order; pure, before any read. The first failing check wins.
  private validateTransfer({ expense, income }: CreateTransferDto): void {
    if (
      expense.typeOfRecord !== 'transfer' ||
      income.typeOfRecord !== 'transfer'
    ) {
      throw new BadRequestException(TYPE_OF_RECORD_INVALID);
    }
    if (!expense.isPaid) {
      throw new BadRequestException(TRANSFER_EXPENSE_NOT_PAID);
    }
    if (expense.linkedBudgets.length > 0) {
      throw new BadRequestException(TRANSFER_EXPENSE_BUDGETS);
    }
    if (expense.account === income.account) {
      throw new BadRequestException(TRANSFER_ACCOUNT_ERROR);
    }
    const mismatch = (
      [
        ['short name', expense.shortName !== income.shortName],
        ['amounts', expense.amount !== income.amount],
        ['dates', expense.date.getTime() !== income.date.getTime()],
        ['category', expense.category !== income.category],
        ['subCategory', expense.subCategory !== income.subCategory],
      ] as const
    ).find(([, differs]) => differs);
    if (mismatch) throw new BadRequestException(transferMismatch(mismatch[0]));
  }
}
