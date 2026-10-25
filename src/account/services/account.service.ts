import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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
  ACCOUNT_CREATED_MESSAGE,
  ACCOUNT_DELETED_MESSAGE,
  ACCOUNT_NOT_FOUND,
  ACCOUNT_RECORDS_CASCADE,
  ACCOUNT_UNAUTHORIZED_ERROR,
  ACCOUNT_UPDATED_MESSAGE,
  CARD_PROVIDERS,
  INVALID_PROVIDER_ERROR,
  TERMINATION_DIGITS_ERROR,
  TERMINATION_DIGITS_REGEX,
} from '../account.constants.js';
import type { AccountRecordsCascade } from '../account.interface.js';
import {
  CreateAccountDto,
  DeleteAccountDto,
  UpdateAccountDto,
} from '../dtos/account.dto.js';
import { Account, AccountDoc } from '../entities/account.entity.js';

const UPDATABLE_FIELDS = [
  'title',
  'alias',
  'accountType',
  'accountProvider',
  'amount',
  'terminationFourDigits',
  'backgroundColor',
  'color',
] as const;

type CardFields = Pick<
  UpdateAccountDto,
  'accountProvider' | 'terminationFourDigits'
>;

// Responses carry the hydrated docs (Nest serializes them through toJSON: `_id`, `__v`, `sub`), as develop did.
// No try/catch: mongoose ValidationError/CastError → 400 and anything else → 500 via the global filters.
@Injectable()
export class AccountService {
  constructor(
    @InjectModel(Account.name) private readonly accountModel: Model<Account>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(ACCOUNT_RECORDS_CASCADE)
    private readonly recordsCascade: AccountRecordsCascade,
  ) {}

  async findByUser(sub: string): Promise<GeneralResponse> {
    const accounts = await this.accountModel.find({ sub }).exec();
    return { ...INITIAL_RESPONSE, data: { accounts } };
  }

  async createAccount(
    sub: string,
    dto: CreateAccountDto,
  ): Promise<GeneralResponse> {
    // IsOptional lets null through: null values are never stored nor checked.
    const fields = Object.fromEntries(
      Object.entries(dto).filter(([, v]) => v != null),
    ) as CreateAccountDto;
    this.assertCardFields(fields);
    const account = await this.accountModel.create({ ...fields, sub });
    return {
      ...INITIAL_RESPONSE,
      message: ACCOUNT_CREATED_MESSAGE,
      data: { account },
    };
  }

  // Legacy precedence: missing 400, foreign 400, then the card checks. The write is still filtered by owner.
  async updateAccount(
    sub: string,
    dto: UpdateAccountDto,
  ): Promise<GeneralResponse> {
    const owner = await this.findAccountOwner(dto.accountId);
    if (owner === null) throw new BadRequestException(ACCOUNT_NOT_FOUND);
    if (owner !== sub)
      throw new BadRequestException(ACCOUNT_UNAUTHORIZED_ERROR);
    this.assertCardFields(dto);
    // Only present, non-null fields; never accountId or sub.
    const $set = Object.fromEntries(
      UPDATABLE_FIELDS.filter((f) => dto[f] != null).map((f) => [f, dto[f]]),
    );
    const account = await this.accountModel
      .findOneAndUpdate(
        { _id: dto.accountId, sub },
        { $set },
        { returnDocument: 'after' },
      )
      .exec();
    if (!account) throw new BadRequestException(ACCOUNT_NOT_FOUND);
    return {
      ...INITIAL_RESPONSE,
      message: ACCOUNT_UPDATED_MESSAGE,
      data: { account },
    };
  }

  // Read, cascade and delete share one transaction; nothing in it has side effects (it may be retried).
  async deleteAccount(
    sub: string,
    { accountId }: DeleteAccountDto,
  ): Promise<GeneralResponse> {
    const data = await this.connection.transaction(async (session) => {
      const owner = await this.findAccountOwner(accountId, session);
      if (owner === null) throw new BadRequestException(ACCOUNT_NOT_FOUND);
      if (owner !== sub) {
        throw new UnauthorizedException(ACCOUNT_UNAUTHORIZED_ERROR);
      }
      const counts = await this.recordsCascade.deleteAccountRecords({
        accountId,
        sub,
        session,
      });
      const accountDeleted = await this.accountModel
        .findOneAndDelete({ _id: accountId, sub }, { session })
        .exec();
      if (!accountDeleted) throw new BadRequestException(ACCOUNT_NOT_FOUND);
      return { accountDeleted, ...counts };
    });
    return { ...INITIAL_RESPONSE, message: ACCOUNT_DELETED_MESSAGE, data };
  }

  // For S7 (records): legacy findAccountByIdForRecords. S7 wraps the transfer case in 400 itself.
  async assertAccountOwned({
    accountId,
    sub,
    session,
  }: {
    accountId: string;
    sub: string;
    session?: ClientSession;
  }): Promise<void> {
    if (!isValidObjectId(accountId)) {
      throw new NotFoundException(ACCOUNT_NOT_FOUND);
    }
    const owner = await this.findAccountOwner(accountId, session);
    if (owner === null) throw new NotFoundException(ACCOUNT_NOT_FOUND);
    if (owner !== sub) {
      throw new UnauthorizedException(ACCOUNT_UNAUTHORIZED_ERROR);
    }
  }

  // For S7: owner-bound (audit High: a record PUT must not rewrite another user's balance). S7 passes signed deltas.
  // Missing and foreign both 404, so the caller's transaction aborts.
  async incrementBalance({
    accountId,
    sub,
    delta,
    session,
  }: {
    accountId: string;
    sub: string;
    delta: number;
    session: ClientSession;
  }): Promise<AccountDoc> {
    if (!isValidObjectId(accountId)) {
      throw new NotFoundException(ACCOUNT_NOT_FOUND);
    }
    const account = await this.accountModel
      .findOneAndUpdate(
        { _id: accountId, sub },
        { $inc: { amount: delta } },
        { session, returnDocument: 'after' },
      )
      .exec();
    if (!account) throw new NotFoundException(ACCOUNT_NOT_FOUND);
    return account;
  }

  // Only picks the legacy message; the writes filter by { _id, sub } themselves.
  private async findAccountOwner(
    accountId: string,
    session?: ClientSession,
  ): Promise<string | null> {
    const doc = await this.accountModel
      .findById(accountId)
      .select('sub')
      .session(session ?? null)
      .exec();
    return doc ? String(doc.sub) : null;
  }

  // Develop's order: digits before provider. Exact, case-sensitive; absent or null skipped (D17).
  private assertCardFields({
    accountProvider,
    terminationFourDigits,
  }: CardFields): void {
    if (
      terminationFourDigits != null &&
      !TERMINATION_DIGITS_REGEX.test(terminationFourDigits)
    ) {
      throw new BadRequestException(TERMINATION_DIGITS_ERROR);
    }
    if (
      accountProvider != null &&
      !(CARD_PROVIDERS as readonly string[]).includes(accountProvider)
    ) {
      throw new BadRequestException(INVALID_PROVIDER_ERROR);
    }
  }
}
