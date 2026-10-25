import {
  INestApplication,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import {
  type ClientSession,
  type Connection,
  type Model,
  Types,
} from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ACCOUNT_RECORDS_CASCADE } from '../src/account/account.constants.js';
import type { AccountRecordsCascade } from '../src/account/account.interface.js';
import { Account } from '../src/account/entities/account.entity.js';
import { AccountService } from '../src/account/services/account.service.js';
import { INITIAL_RESPONSE } from '../src/constants.js';
import { closeTestApp, createTestApp } from './create-test-app.js';

const PASSWORD = 'e2e-password';
const DIGITS = 'Termination digits must be a 4-digit number (digits only).';
const NOT_FOUND = 'Account not found';
const FOREIGN = 'Account does not belong to the user';
const UNUSED_ID = '000000000000000000000000';
let seq = 0;
const uniqueEmail = () => `e2e-acc-${Date.now()}-${seq++}@example.invalid`;
const unauthorized = {
  ...INITIAL_RESPONSE,
  success: false,
  error: { message: 'Unauthorized', statusCode: 401 },
};
const badRequest = (message: string | string[]) => ({
  ...INITIAL_RESPONSE,
  success: false,
  error: { message, error: 'Bad Request', statusCode: 400 },
});
const cashAccount = {
  title: 'Cash',
  alias: 'Wallet',
  accountType: 'Efectivo',
  amount: 100,
  backgroundColor: 'Dark Orange',
  color: 'white',
};
const cardAccount = {
  title: 'Card',
  alias: 'Visa card',
  accountType: 'Crédito',
  accountProvider: 'visa',
  amount: 0,
  terminationFourDigits: '1234',
  backgroundColor: 'Blue',
  color: 'white',
};

describe('Accounts (e2e)', () => {
  let app: INestApplication<App>;
  let accountModel: Model<Account>;
  let connection: Connection;
  const http = () => request(app.getHttpServer());

  // Same signup + login as categories.e2e-spec.ts; the token is the cookie value, sent as Bearer.
  const signupAndLogin = async () => {
    const email = uniqueEmail();
    const res = await http()
      .post('/users')
      .send({
        email,
        password: PASSWORD,
        firstName: 'First',
        lastName: 'Last',
        middleName: '',
      })
      .expect(201);
    const login = await http()
      .post('/auth/')
      .send({ email, password: PASSWORD })
      .expect(201);
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0];
    const token = cookie.slice(cookie.indexOf('=') + 1, cookie.indexOf(';'));
    return {
      sub: res.body.data.userCreated.sub as string,
      auth: { Authorization: `Bearer ${token}` },
    };
  };
  const createAccount = async (
    auth: Record<string, string>,
    body: object = cardAccount,
  ) =>
    (await http().post('/account-actions').set(auth).send(body).expect(201))
      .body.data.account as Record<string, unknown> & { _id: string };
  const lean = (id: string) => accountModel.findById(id).lean().exec();

  beforeAll(async () => {
    app = await createTestApp();
    accountModel = app.get<Model<Account>>(getModelToken(Account.name));
    connection = app.get<Connection>(getConnectionToken());
    // Collection + index creation must not race the first transaction.
    await accountModel.init();
  });

  afterAll(async () => {
    if (app) await closeTestApp(app);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('GET /account-actions', () => {
    it('401 without a token', async () => {
      const res = await http().get('/account-actions').expect(401);
      expect(res.body).toStrictEqual(unauthorized);
    });

    it('200 with an empty list for a fresh user', async () => {
      const { auth } = await signupAndLogin();
      const res = await http().get('/account-actions').set(auth).expect(200);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { accounts: [] },
      });
    });

    it("lists only the user's own full docs, sub included", async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const created = await createAccount(a.auth);
      const listA = await http()
        .get('/account-actions')
        .set(a.auth)
        .expect(200);
      expect(listA.body.data.accounts).toStrictEqual([created]);
      expect(listA.body.data.accounts[0].sub).toBe(a.sub);
      const listB = await http()
        .get('/account-actions')
        .set(b.auth)
        .expect(200);
      expect(listB.body.data.accounts).toStrictEqual([]);
    });
  });

  describe('POST /account-actions', () => {
    it('201 card account with the exact envelope', async () => {
      const { sub, auth } = await signupAndLogin();
      const res = await http()
        .post('/account-actions')
        .set(auth)
        .send(cardAccount)
        .expect(201);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Account created',
        data: {
          account: {
            _id: expect.any(String),
            ...cardAccount,
            sub,
            __v: 0,
          },
        },
      });
    });

    it('201 cash account without the card keys; trailing slash works', async () => {
      const { sub, auth } = await signupAndLogin();
      const res = await http()
        .post('/account-actions/')
        .set(auth)
        .send(cashAccount)
        .expect(201);
      expect(res.body.data.account).toStrictEqual({
        _id: expect.any(String),
        ...cashAccount,
        sub,
        __v: 0,
      });
      const stored = await lean(res.body.data.account._id);
      expect(stored).not.toHaveProperty('accountProvider');
      expect(stored).not.toHaveProperty('terminationFourDigits');
    });

    it('accepts 0, negative and float amounts', async () => {
      const { auth } = await signupAndLogin();
      for (const amount of [0, -5, 12.34]) {
        const account = await createAccount(auth, { ...cashAccount, amount });
        expect(account.amount).toBe(amount);
      }
    });

    it('400 with the class-validator array when alias is missing', async () => {
      const { auth } = await signupAndLogin();
      const { alias: _alias, ...body } = cashAccount;
      const res = await http()
        .post('/account-actions')
        .set(auth)
        .send(body)
        .expect(400);
      expect(res.body).toStrictEqual(
        badRequest(['alias should not be empty', 'alias must be a string']),
      );
    });

    it('400 digits / provider texts and no doc written', async () => {
      const { sub, auth } = await signupAndLogin();
      for (const terminationFourDigits of ['12a4', '123']) {
        const res = await http()
          .post('/account-actions')
          .set(auth)
          .send({ ...cardAccount, terminationFourDigits })
          .expect(400);
        expect(res.body).toStrictEqual(badRequest(DIGITS));
      }
      const res = await http()
        .post('/account-actions')
        .set(auth)
        .send({ ...cardAccount, accountProvider: 'Visa' })
        .expect(400);
      expect(res.body).toStrictEqual(badRequest('Invalid account provider'));
      expect(await accountModel.countDocuments({ sub })).toBe(0);
    });

    it('400 for number digits, string amount, and sub in the body', async () => {
      const { auth } = await signupAndLogin();
      const digits = await http()
        .post('/account-actions')
        .set(auth)
        .send({ ...cardAccount, terminationFourDigits: 1234 })
        .expect(400);
      expect(digits.body).toStrictEqual(
        badRequest(['terminationFourDigits must be a string']),
      );
      await http()
        .post('/account-actions')
        .set(auth)
        .send({ ...cardAccount, amount: '10' })
        .expect(400);
      const extra = await http()
        .post('/account-actions')
        .set(auth)
        .send({ ...cardAccount, sub: 'x' })
        .expect(400);
      expect(extra.body).toStrictEqual(
        badRequest(['property sub should not exist']),
      );
    });
  });

  describe('PUT / DELETE across users (AC3)', () => {
    it("never writes another user's account", async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const { _id } = await createAccount(a.auth);
      const before = await lean(_id);

      const put = await http()
        .put('/account-actions')
        .set(b.auth)
        .send({ accountId: _id, title: 'Hacked', terminationFourDigits: 'bad' })
        .expect(400);
      expect(put.body).toStrictEqual(badRequest(FOREIGN));
      const del = await http()
        .delete('/account-actions')
        .set(b.auth)
        .send({ accountId: _id })
        .expect(401);
      expect(del.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        success: false,
        error: { message: FOREIGN, error: 'Unauthorized', statusCode: 401 },
      });
      expect(await lean(_id)).toStrictEqual(before);
    });

    it('400 not found for an unused id on both', async () => {
      const { auth } = await signupAndLogin();
      for (const method of ['put', 'delete'] as const) {
        const res = await http()
          [method]('/account-actions')
          .set(auth)
          .send({ accountId: UNUSED_ID })
          .expect(400);
        expect(res.body).toStrictEqual(badRequest(NOT_FOUND));
      }
    });

    it('400 IsMongoId for a non-ObjectId accountId', async () => {
      const { auth } = await signupAndLogin();
      const res = await http()
        .put('/account-actions')
        .set(auth)
        .send({ accountId: 'abc' })
        .expect(400);
      expect(res.body).toStrictEqual(
        badRequest(['accountId must be a mongodb id']),
      );
    });
  });

  describe('PUT /account-actions (owner)', () => {
    it('200 with the new title and amount', async () => {
      const { auth } = await signupAndLogin();
      const created = await createAccount(auth);
      const res = await http()
        .put('/account-actions')
        .set(auth)
        .send({ accountId: created._id, title: 'Renamed', amount: 250.5 })
        .expect(200);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Account Updated',
        data: { account: { ...created, title: 'Renamed', amount: 250.5 } },
      });
    });

    it('only accountId → 200 unchanged; alias null → alias kept; trailing slash', async () => {
      const { auth } = await signupAndLogin();
      const created = await createAccount(auth);
      const only = await http()
        .put('/account-actions/')
        .set(auth)
        .send({ accountId: created._id })
        .expect(200);
      expect(only.body.data.account).toStrictEqual(created);
      const nulled = await http()
        .put('/account-actions')
        .set(auth)
        .send({ accountId: created._id, alias: null })
        .expect(200);
      expect(nulled.body.data.account.alias).toBe(cardAccount.alias);
    });

    it('400 for bad digits / provider / sub, doc unchanged', async () => {
      const { auth } = await signupAndLogin();
      const { _id } = await createAccount(auth);
      const before = await lean(_id);
      const digits = await http()
        .put('/account-actions')
        .set(auth)
        .send({ accountId: _id, terminationFourDigits: '12a4' })
        .expect(400);
      expect(digits.body).toStrictEqual(badRequest(DIGITS));
      const provider = await http()
        .put('/account-actions')
        .set(auth)
        .send({ accountId: _id, accountProvider: 'amex' })
        .expect(400);
      expect(provider.body).toStrictEqual(
        badRequest('Invalid account provider'),
      );
      await http()
        .put('/account-actions')
        .set(auth)
        .send({ accountId: _id, sub: 'x' })
        .expect(400);
      expect(await lean(_id)).toStrictEqual(before);
    });

    it('accepts the full GET echo (FE_Budget_Master edit shape)', async () => {
      const { auth } = await signupAndLogin();
      const created = await createAccount(auth);
      const { _id, __v: _v, sub: _s, ...fields } = created;
      await http()
        .put('/account-actions')
        .set(auth)
        .send({ ...fields, title: 'Echo', accountId: _id })
        .expect(200);
    });

    it('edits an old doc without D17 fields; GET shows it without them', async () => {
      const { sub, auth } = await signupAndLogin();
      const { alias: _a, ...old } = cashAccount;
      const { insertedId } = await accountModel.collection.insertOne({
        ...old,
        sub,
        __v: 0,
      });
      const id = insertedId.toString();
      const res = await http()
        .put('/account-actions')
        .set(auth)
        .send({ accountId: id, title: 'Old edited' })
        .expect(200);
      expect(res.body.data.account).toStrictEqual({
        _id: id,
        ...old,
        title: 'Old edited',
        sub,
        __v: 0,
      });
      const list = await http().get('/account-actions').set(auth).expect(200);
      expect(list.body.data.accounts[0]).not.toHaveProperty('alias');
      expect(list.body.data.accounts[0]).not.toHaveProperty('accountProvider');
    });

    it('int-stored digits: GET returns the string, echoing it 400s (develop)', async () => {
      const { sub, auth } = await signupAndLogin();
      const { insertedId } = await accountModel.collection.insertOne({
        ...cardAccount,
        terminationFourDigits: 123,
        sub,
        __v: 0,
      });
      const list = await http().get('/account-actions').set(auth).expect(200);
      expect(list.body.data.accounts[0].terminationFourDigits).toBe('123');
      const res = await http()
        .put('/account-actions')
        .set(auth)
        .send({
          accountId: insertedId.toString(),
          terminationFourDigits: '123',
        })
        .expect(400);
      expect(res.body).toStrictEqual(badRequest(DIGITS));
    });
  });

  describe('DELETE /account-actions (owner)', () => {
    it('401 without a token', async () => {
      await http()
        .delete('/account-actions')
        .send({ accountId: UNUSED_ID })
        .expect(401);
    });

    it('200 with the deleted doc and 0/0, then 400 on a second delete', async () => {
      const { auth } = await signupAndLogin();
      const created = await createAccount(auth);
      const res = await http()
        .delete('/account-actions/')
        .set(auth)
        .send({ accountId: created._id })
        .expect(200);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Account Deleted',
        data: {
          accountDeleted: created,
          numberExpensesDeleted: 0,
          numberIncomesDeleted: 0,
        },
      });
      const again = await http()
        .delete('/account-actions')
        .set(auth)
        .send({ accountId: created._id })
        .expect(400);
      expect(again.body).toStrictEqual(badRequest(NOT_FOUND));
    });

    it('calls the cascade port inside the transaction and returns its counts', async () => {
      const { sub, auth } = await signupAndLogin();
      const { _id } = await createAccount(auth);
      const cascade = app.get<AccountRecordsCascade>(ACCOUNT_RECORDS_CASCADE, {
        strict: false,
      });
      let inTransaction: boolean | undefined;
      const spy = vi
        .spyOn(cascade, 'deleteAccountRecords')
        .mockImplementation(({ session }) => {
          inTransaction = session.inTransaction();
          return Promise.resolve({
            numberExpensesDeleted: 4,
            numberIncomesDeleted: 1,
          });
        });
      const res = await http()
        .delete('/account-actions')
        .set(auth)
        .send({ accountId: _id })
        .expect(200);
      expect(res.body.data.numberExpensesDeleted).toBe(4);
      expect(res.body.data.numberIncomesDeleted).toBe(1);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: _id, sub }),
      );
      expect(inTransaction).toBe(true);
    });

    it('500 and the account survives when the cascade rejects', async () => {
      const { auth } = await signupAndLogin();
      const { _id } = await createAccount(auth);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const cascade = app.get<AccountRecordsCascade>(ACCOUNT_RECORDS_CASCADE, {
        strict: false,
      });
      vi.spyOn(cascade, 'deleteAccountRecords').mockRejectedValue(
        new Error('boom'),
      );
      const res = await http()
        .delete('/account-actions')
        .set(auth)
        .send({ accountId: _id })
        .expect(500);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        success: false,
        error: { statusCode: 500, message: 'Internal server error' },
      });
      expect(await lean(_id)).not.toBeNull();
    });
  });

  describe('S7 helpers', () => {
    const inTransaction = <T>(fn: (session: ClientSession) => Promise<T>) =>
      connection.transaction(fn);

    it('incrementBalance is owner-bound and rolls back with the transaction', async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const { _id } = await createAccount(a.auth, cashAccount);
      const service = app.get(AccountService);

      const updated = await inTransaction((session) =>
        service.incrementBalance({
          accountId: _id,
          sub: a.sub,
          delta: -30.5,
          session,
        }),
      );
      expect(updated.amount).toBe(69.5);
      expect((await lean(_id))?.amount).toBe(69.5);

      await expect(
        inTransaction((session) =>
          service.incrementBalance({
            accountId: _id,
            sub: b.sub,
            delta: 1,
            session,
          }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect((await lean(_id))?.amount).toBe(69.5);

      await expect(
        inTransaction(async (session) => {
          await service.incrementBalance({
            accountId: _id,
            sub: a.sub,
            delta: 1000,
            session,
          });
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      expect((await lean(_id))?.amount).toBe(69.5);
    });

    it('assertAccountOwned: owner resolves, other 401, unused / bad id 404', async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const { _id } = await createAccount(a.auth);
      const service = app.get(AccountService);
      await expect(
        service.assertAccountOwned({ accountId: _id, sub: a.sub }),
      ).resolves.toBeUndefined();
      await expect(
        service.assertAccountOwned({ accountId: _id, sub: b.sub }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      for (const accountId of [new Types.ObjectId().toString(), 'abc']) {
        await expect(
          service.assertAccountOwned({ accountId, sub: a.sub }),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
    });
  });
});
