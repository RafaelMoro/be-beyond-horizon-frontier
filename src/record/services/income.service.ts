import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';
import { AccountService } from '../../account/services/account.service.js';
import { CategoryService } from '../../category/services/category.service.js';
import { INITIAL_RESPONSE } from '../../constants.js';
import type { GeneralResponse } from '../../response.interface.js';
import {
  CreateIncomeDto,
  DeleteIncomeDto,
  UpdateIncomeDto,
} from '../dtos/income.dto.js';
import { Expense } from '../entities/expense.entity.js';
import { Income } from '../entities/income.entity.js';
import {
  CATEGORY_POPULATE,
  EXPENSE_NOT_FOUND,
  EXPENSES_PAID_POPULATE,
  INCOME_CREATED_MESSAGE,
  INCOME_DELETED_MESSAGE,
  INCOME_NOT_FOUND,
  INCOME_UNAUTHORIZED_ERROR,
  INVALID_EXPENSES_PAID,
  MISSING_AMOUNT,
  MISSING_CATEGORY,
  MISSING_DATE,
  RECORD_UPDATABLE_FIELDS,
  TYPE_OF_RECORD_INVALID,
  UNAUTHORIZED_INCOMES_ERROR,
} from '../record.constants.js';
import type { IncomeMutationResult } from '../record.interface.js';
import {
  formatDateToString,
  formatNumberToCurrency,
  toExpenseIds,
  toMexicoCityWallClock,
} from '../record.utils.js';

interface SessionStep {
  sub: string;
  session: ClientSession;
}

// Mutations run in one transaction each: fn may be retried, so it has no side effects and re-reads everything.
// Paid flags only ever touch the caller's expenses (audit Medium); a missing or foreign id matches nothing (Q6, bug 6).
// No try/catch: CastError/ValidationError → 400 and anything else → 500 via the global filters (D6).
@Injectable()
export class IncomeService {
  constructor(
    @InjectModel(Income.name) private readonly incomeModel: Model<Income>,
    @InjectModel(Expense.name) private readonly expenseModel: Model<Expense>,
    @InjectConnection() private readonly connection: Connection,
    private readonly accountService: AccountService,
    private readonly categoryService: CategoryService,
  ) {}

  async createIncome(
    sub: string,
    dto: CreateIncomeDto,
  ): Promise<GeneralResponse> {
    if (dto.typeOfRecord !== 'income') {
      throw new BadRequestException(TYPE_OF_RECORD_INVALID);
    }
    const ids = this.parseExpenseIds(dto.expensesPaid);
    const { income, messages } =
      await this.connection.transaction<IncomeMutationResult>(
        async (session) => {
          const messages: string[] = [];
          await this.categoryService.assertCategoryOwned(dto.category, sub);
          await this.accountService.assertAccountOwned({
            accountId: dto.account,
            sub,
            session,
          });
          const owned = await this.ownedExpenseIds({ ids, sub, session });
          const date = toMexicoCityWallClock(dto.date);
          const [income] = await this.incomeModel.create(
            [
              {
                ...dto,
                expensesPaid: owned,
                date,
                ...formatDateToString(date),
                amountFormatted: formatNumberToCurrency(dto.amount),
                userId: sub,
              },
            ],
            { session },
          );
          messages.push(INCOME_CREATED_MESSAGE);
          await this.accountService.incrementBalance({
            accountId: dto.account,
            sub,
            delta: dto.amount,
            session,
          });
          messages.push('Account updated');
          await this.payExpenses({ ids, owned, sub, messages, session });
          return { income, messages };
        },
      );
    // Unpopulated (develop).
    return { ...INITIAL_RESPONSE, message: messages, data: { income } };
  }

  // Q9: category/account ownership is checked only when this edit changes that field. Q8: no expensesPaid = no flags.
  async updateIncome(
    sub: string,
    dto: UpdateIncomeDto,
  ): Promise<GeneralResponse> {
    // Develop's order; falsy fails, so amount 0 → 400.
    if (!dto.date) throw new BadRequestException(MISSING_DATE);
    if (!dto.category) throw new BadRequestException(MISSING_CATEGORY);
    if (!dto.amount) throw new BadRequestException(MISSING_AMOUNT);
    const { date, category, amount, recordId } = dto;
    const newIds =
      dto.expensesPaid === undefined
        ? undefined
        : this.parseExpenseIds(dto.expensesPaid);
    const { income, messages } =
      await this.connection.transaction<IncomeMutationResult>(
        async (session) => {
          const messages: string[] = [];
          // develop's PUT texts ('Expense not found.' sic).
          const old = await this.findOwnedIncome({
            recordId,
            sub,
            session,
            notFound: EXPENSE_NOT_FOUND,
            unauthorized: UNAUTHORIZED_INCOMES_ERROR,
          });
          if (category !== String(old.category)) {
            await this.categoryService.assertCategoryOwned(category, sub);
          }
          const newAccount = dto.account ?? old.account;
          if (newAccount !== old.account) {
            // Audit High: never move a record to another user's account.
            await this.accountService.assertAccountOwned({
              accountId: newAccount,
              sub,
              session,
            });
            await this.accountService.incrementBalance({
              accountId: old.account,
              sub,
              delta: -old.amount,
              session,
            });
            await this.accountService.incrementBalance({
              accountId: newAccount,
              sub,
              delta: amount,
              session,
            });
            messages.push("Account's amount updated");
          } else if (old.amount !== amount) {
            await this.accountService.incrementBalance({
              accountId: old.account,
              sub,
              delta: amount - old.amount,
              session,
            });
            messages.push("Account's amount updated");
          }

          const owned =
            newIds === undefined
              ? undefined
              : await this.repayExpenses({
                  oldIds: (old.expensesPaid ?? []).map(String),
                  newIds,
                  sub,
                  messages,
                  session,
                });

          // Only present, non-null fields (IsOptional lets null through). The date is not shifted on edit (§4).
          const $set = {
            ...Object.fromEntries(
              RECORD_UPDATABLE_FIELDS.filter((f) => dto[f] != null).map((f) => [
                f,
                dto[f],
              ]),
            ),
            ...(owned !== undefined ? { expensesPaid: owned } : {}),
            ...formatDateToString(date),
            amountFormatted: formatNumberToCurrency(amount),
          };
          const income = await this.incomeModel
            .findOneAndUpdate(
              { _id: recordId, userId: sub },
              { $set },
              { session, returnDocument: 'after' },
            )
            .exec();
          if (!income) throw new NotFoundException(EXPENSE_NOT_FOUND);
          messages.push('Updated income');
          return { income, messages };
        },
      );
    await income.populate([EXPENSES_PAID_POPULATE, CATEGORY_POPULATE]);
    return { ...INITIAL_RESPONSE, message: messages, data: { income } };
  }

  // Q10: a missing or foreign account aborts with 404 and the income stays.
  async deleteIncome(
    sub: string,
    { recordId }: DeleteIncomeDto,
  ): Promise<GeneralResponse> {
    const { income, messages } =
      await this.connection.transaction<IncomeMutationResult>(
        async (session) => {
          const messages: string[] = [];
          const old = await this.findOwnedIncome({
            recordId,
            sub,
            session,
            notFound: INCOME_NOT_FOUND,
            unauthorized: INCOME_UNAUTHORIZED_ERROR,
          });
          const income = await this.incomeModel
            .findOneAndDelete({ _id: recordId, userId: sub }, { session })
            .exec();
          if (!income) throw new NotFoundException(INCOME_NOT_FOUND);
          messages.push(INCOME_DELETED_MESSAGE);
          await this.accountService.incrementBalance({
            accountId: old.account,
            sub,
            delta: -old.amount,
            session,
          });
          messages.push("Account's amount updated");
          const n = await this.setPaid({
            ids: (old.expensesPaid ?? []).map(String),
            isPaid: false,
            sub,
            session,
          });
          messages.push(`Expenses paid updated: ${n}`);
          return { income, messages };
        },
      );
    // The raw deleted doc, unpopulated (develop).
    return { ...INITIAL_RESPONSE, message: messages, data: { income } };
  }

  private parseExpenseIds(values: unknown[]): string[] {
    const ids = toExpenseIds(values);
    if (!ids) throw new BadRequestException(INVALID_EXPENSES_PAID);
    return ids;
  }

  // Lean: the stored types (category string or ObjectId, ObjectId expensesPaid).
  private async findOwnedIncome({
    recordId,
    sub,
    session,
    notFound,
    unauthorized,
  }: SessionStep & {
    recordId: string;
    notFound: string;
    unauthorized: string;
  }) {
    const old = await this.incomeModel
      .findById(recordId)
      .session(session)
      .lean()
      .exec();
    if (!old) throw new NotFoundException(notFound);
    if (String(old.userId) !== sub) {
      throw new UnauthorizedException(unauthorized);
    }
    return old;
  }

  // The caller's existing expenses among ids, in input order (Q6: only these are stored).
  private async ownedExpenseIds({
    ids,
    sub,
    session,
  }: SessionStep & { ids: string[] }): Promise<string[]> {
    if (ids.length === 0) return [];
    const found = await this.expenseModel
      .find({ _id: { $in: ids }, userId: sub })
      .select('_id')
      .session(session)
      .lean()
      .exec();
    const existing = new Set(found.map((e) => String(e._id)));
    return ids.filter((id) => existing.has(id));
  }

  // matchedCount: an already-paid expense still counts as paid.
  private async setPaid({
    ids,
    isPaid,
    sub,
    session,
  }: SessionStep & { ids: string[]; isPaid: boolean }): Promise<number> {
    if (ids.length === 0) return 0;
    const r = await this.expenseModel
      .updateMany(
        { _id: { $in: ids }, userId: sub },
        { $set: { isPaid } },
        { session },
      )
      .exec();
    return r.matchedCount;
  }

  // The income side's paid step; S7c's transfer create reuses it inside its own transaction.
  private async payExpenses({
    ids,
    owned,
    sub,
    messages,
    session,
  }: SessionStep & {
    ids: string[];
    owned: string[];
    messages: string[];
  }): Promise<void> {
    const n = await this.setPaid({ ids: owned, isPaid: true, sub, session });
    messages.push(
      `Expenses paid updated: ${n}`,
      `Expenses paid failed to update: ${ids.length - owned.length}`,
    );
  }

  // Bug 7 fixed: only removed ids are unpaid and only added ids paid; kept ones are not touched. Returns the new list.
  private async repayExpenses({
    oldIds,
    newIds,
    sub,
    messages,
    session,
  }: SessionStep & {
    oldIds: string[];
    newIds: string[];
    messages: string[];
  }): Promise<string[]> {
    const owned = await this.ownedExpenseIds({ ids: newIds, sub, session });
    const unpaid = await this.setPaid({
      ids: oldIds.filter((id) => !owned.includes(id)),
      isPaid: false,
      sub,
      session,
    });
    const paid = await this.setPaid({
      ids: owned.filter((id) => !oldIds.includes(id)),
      isPaid: true,
      sub,
      session,
    });
    messages.push(
      `Expenses unpaid: ${unpaid}`,
      `Expenses paid updated: ${paid}`,
      `Expenses paid failed to update: ${newIds.length - owned.length}`,
    );
    return owned;
  }
}
