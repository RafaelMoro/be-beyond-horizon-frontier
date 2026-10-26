import { INestApplication, Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ACCOUNT_RECORDS_CASCADE } from '../src/account/account.constants.js';
import { Account } from '../src/account/entities/account.entity.js';
import { AccountService } from '../src/account/services/account.service.js';
import { INITIAL_RESPONSE } from '../src/constants.js';
import { Expense } from '../src/record/entities/expense.entity.js';
import { Income } from '../src/record/entities/income.entity.js';
import { INVALID_EXPENSES_PAID } from '../src/record/record.constants.js';
import { RecordPortsService } from '../src/record/services/record-ports.service.js';
import { closeTestApp, createTestApp } from './create-test-app.js';

const PASSWORD = 'e2e-password';
const UNUSED_ID = '000000000000000000000000';
let seq = 0;
const uniqueEmail = () => `e2e-inc-${Date.now()}-${seq++}@example.invalid`;
const unauthorized = {
  ...INITIAL_RESPONSE,
  success: false,
  error: { message: 'Unauthorized', statusCode: 401 },
};
const httpError =
  (statusCode: number, error: string) => (message: unknown) => ({
    ...INITIAL_RESPONSE,
    success: false,
    error: { message, error, statusCode },
  });
const badRequest = httpError(400, 'Bad Request');
const notFound = httpError(404, 'Not Found');
const unauthorizedMsg = httpError(401, 'Unauthorized');
const internalError = {
  ...INITIAL_RESPONSE,
  success: false,
  error: { statusCode: 500, message: 'Internal server error' },
};
// Input instant → stored Mexico City wall clock (research §4 vector).
const INPUT_DATE = '2025-02-03T20:05:30.123Z';
const STORED_DATE = '2025-02-03T14:05:30.000Z';
type User = { sub: string; auth: Record<string, string> };
type Doc = Record<string, unknown> & { _id: string };
type Setup = User & { category: Doc; account: Doc; account2: Doc };

describe('Records: incomes (e2e)', () => {
  let app: INestApplication<App>;
  let expenseModel: Model<Expense>;
  let incomeModel: Model<Income>;
  let accountModel: Model<Account>;
  const http = () => request(app.getHttpServer());

  const signupAndLogin = async (): Promise<User> => {
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
  const createCategory = async (u: User, categoryName = 'Work') =>
    (
      await http()
        .post('/categories')
        .set(u.auth)
        .send({ categoryName, subCategories: ['Salary'], icon: 'work' })
        .expect(201)
    ).body.data.category as Doc;
  const createAccount = async (u: User, amount = 1000) =>
    (
      await http()
        .post('/account-actions')
        .set(u.auth)
        .send({
          title: 'Debit',
          alias: 'D',
          accountType: 'Debit',
          amount,
          backgroundColor: 'red',
          color: 'white',
        })
        .expect(201)
    ).body.data.account as Doc;
  // A user with one category and two accounts.
  const setup = async (): Promise<Setup> => {
    const u = await signupAndLogin();
    const category = await createCategory(u);
    const account = await createAccount(u, 1000);
    const account2 = await createAccount(u, 500);
    return { ...u, category, account, account2 };
  };
  const balance = async (id: string) =>
    (await accountModel.findById(id).lean().exec())?.amount;
  const isPaid = async (id: string) =>
    (await expenseModel.findById(id).lean().exec())?.isPaid;
  const storedPaidIds = async (id: string) =>
    (await incomeModel.findById(id).lean().exec())?.expensesPaid?.map(String);
  const base = {
    description: '',
    amount: 10,
    amountFormatted: '$10.00',
    date: new Date('2025-02-10T12:00:00.000Z'),
    fullDate: 'Lun, 10 Feb, 2025',
    formattedTime: '12:00pm',
    subCategory: 'Salary',
    tag: [],
    indebtedPeople: [],
    budgets: [],
    __v: 0,
  };
  // Legacy shapes, written raw (no casting, no defaults).
  const seedExpense = async (fields: Record<string, unknown>) => {
    const { insertedId } = await expenseModel.collection.insertOne({
      ...base,
      shortName: 'Seeded expense',
      typeOfRecord: 'expense',
      isPaid: false,
      ...fields,
    });
    return insertedId.toString();
  };
  const seedIncome = async (fields: Record<string, unknown>) => {
    const { insertedId } = await incomeModel.collection.insertOne({
      ...base,
      shortName: 'Seeded income',
      typeOfRecord: 'income',
      expensesPaid: [],
      ...fields,
    });
    return insertedId.toString();
  };
  // What old-next sends as an expensesPaid element: the expense object.
  const expenseObject = async (id: string) =>
    JSON.parse(
      JSON.stringify(await expenseModel.findById(id).lean().exec()),
    ) as Doc;
  const incomeBody = (s: Setup, fields: Record<string, unknown> = {}) => ({
    shortName: 'Salary',
    typeOfRecord: 'income',
    description: '',
    amount: 200,
    date: INPUT_DATE,
    category: s.category._id,
    subCategory: 'Salary',
    tag: [],
    indebtedPeople: [],
    account: s.account._id,
    budgets: [],
    expensesPaid: [],
    ...fields,
  });
  const post = (u: User, body: object) =>
    http().post('/incomes-actions').set(u.auth).send(body);
  const put = (u: User, body: object) =>
    http().put('/incomes-actions').set(u.auth).send(body);
  const del = (u: User, recordId: string) =>
    http().delete('/incomes-actions').set(u.auth).send({ recordId });
  // A's two own expenses on account 1.
  const twoExpenses = async (s: Setup) => {
    const e = { userId: s.sub, account: s.account._id };
    return [
      await seedExpense({ ...e, category: s.category._id }),
      await seedExpense({ ...e, category: s.category._id }),
    ];
  };
  const snapshot = async (s: Setup, expenseIds: string[]) => ({
    incomes: await incomeModel
      .find({ userId: s.sub })
      .sort({ _id: 1 })
      .lean()
      .exec(),
    balances: [await balance(s.account._id), await balance(s.account2._id)],
    flags: await Promise.all(expenseIds.map(isPaid)),
  });

  beforeAll(async () => {
    app = await createTestApp();
    expenseModel = app.get<Model<Expense>>(getModelToken(Expense.name));
    incomeModel = app.get<Model<Income>>(getModelToken(Income.name));
    accountModel = app.get<Model<Account>>(getModelToken(Account.name));
    await expenseModel.init();
    await incomeModel.init();
    await accountModel.init();
  });

  afterAll(async () => {
    if (app) await closeTestApp(app);
  });

  afterEach(() => vi.restoreAllMocks());

  it('401 without a token on POST, PUT and DELETE', async () => {
    for (const method of ['post', 'put', 'delete'] as const) {
      const res = await http()[method]('/incomes-actions').expect(401);
      expect(res.body).toStrictEqual(unauthorized);
    }
  });

  it('schema paths: expensesPaid ObjectId[], no isPaid, category Mixed, account String', () => {
    const schema = incomeModel.schema;
    // mongoose 9 names the element type `embeddedSchemaType`.
    const paid = schema.path('expensesPaid') as unknown as {
      embeddedSchemaType: { instance: string };
    };
    expect(paid.embeddedSchemaType.instance).toBe('ObjectId');
    expect(schema.path('isPaid')).toBeUndefined();
    expect(schema.path('category').instance).toBe('Mixed');
    expect(schema.path('account').instance).toBe('String');
  });

  describe('AC4: DELETE /account-actions deletes the account records', () => {
    const seedAll = async () => {
      const a = await setup();
      const b = await signupAndLogin();
      const acc = a.account._id;
      const cat = a.category._id;
      const doomed = [
        await seedExpense({ userId: a.sub, account: acc, category: cat }),
        await seedExpense({
          userId: a.sub,
          account: acc,
          category: new Types.ObjectId(cat),
          typeOfRecord: 'transfer',
          transferRecord: { transferId: UNUSED_ID, account: a.account2._id },
        }),
      ];
      const doomedIncome = await seedIncome({
        userId: a.sub,
        account: acc,
        category: cat,
      });
      const kept = [
        await seedExpense({
          userId: a.sub,
          account: a.account2._id,
          category: cat,
        }),
        await seedExpense({ userId: b.sub, account: acc, category: cat }),
      ];
      const keptIncomes = [
        await seedIncome({
          userId: a.sub,
          account: a.account2._id,
          category: cat,
        }),
        await seedIncome({ userId: b.sub, account: acc, category: cat }),
      ];
      return { a, doomed, doomedIncome, kept, keptIncomes };
    };
    const exists = async (model: Model<Expense> | Model<Income>, id: string) =>
      (await model.exists({ _id: id }).exec()) !== null;

    it("200 with the real counts; only the owner's records on that account go", async () => {
      const { a, doomed, doomedIncome, kept, keptIncomes } = await seedAll();
      const res = await http()
        .delete('/account-actions')
        .set(a.auth)
        .send({ accountId: a.account._id })
        .expect(200);
      expect(res.body.data).toMatchObject({
        numberExpensesDeleted: 2,
        numberIncomesDeleted: 1,
      });
      for (const id of doomed)
        expect(await exists(expenseModel, id)).toBe(false);
      expect(await exists(incomeModel, doomedIncome)).toBe(false);
      for (const id of kept) expect(await exists(expenseModel, id)).toBe(true);
      for (const id of keptIncomes) {
        expect(await exists(incomeModel, id)).toBe(true);
      }
    });

    it('a failure after the cascade → 500; the account and its records stay', async () => {
      const { a, doomed, doomedIncome } = await seedAll();
      const ports = app.get(RecordPortsService, { strict: false });
      expect(app.get(ACCOUNT_RECORDS_CASCADE, { strict: false })).toBe(ports);
      const real = ports.deleteAccountRecords.bind(ports);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      vi.spyOn(ports, 'deleteAccountRecords').mockImplementationOnce(
        async (args) => {
          await real(args);
          throw new Error('boom');
        },
      );
      const res = await http()
        .delete('/account-actions')
        .set(a.auth)
        .send({ accountId: a.account._id })
        .expect(500);
      expect(res.body).toStrictEqual(internalError);
      expect(await balance(a.account._id)).toBe(1000);
      for (const id of doomed)
        expect(await exists(expenseModel, id)).toBe(true);
      expect(await exists(incomeModel, doomedIncome)).toBe(true);
    });
  });

  describe('POST /incomes-actions', () => {
    it("201: stores only A's existing expenses, pays them, adds the amount", async () => {
      const s = await setup();
      const b = await setup();
      const [e1, e2] = await twoExpenses(s);
      const [eb] = await twoExpenses(b);
      const res = await post(
        s,
        incomeBody(s, {
          expensesPaid: [await expenseObject(e1), e2, eb, UNUSED_ID],
        }),
      ).expect(201);
      expect(Array.isArray(res.body.message)).toBe(true);
      const income = res.body.data.income as Doc;
      expect(income).toMatchObject({
        userId: s.sub,
        typeOfRecord: 'income',
        amount: 200,
        amountFormatted: '$200.00',
        date: STORED_DATE,
        fullDate: 'Lun, 3 Feb, 2025',
        formattedTime: '14:05pm',
        category: s.category._id,
        account: s.account._id,
        expensesPaid: [e1, e2],
      });
      expect(income).not.toHaveProperty('isPaid');
      expect(await balance(s.account._id)).toBe(1200);
      expect(await isPaid(e1)).toBe(true);
      expect(await isPaid(e2)).toBe(true);
      expect(await isPaid(eb)).toBe(false);
      expect(await storedPaidIds(income._id)).toStrictEqual([e1, e2]);
    });

    it('errors write nothing: no income, same balance, no flag changed', async () => {
      const s = await setup();
      const b = await setup();
      const [e1] = await twoExpenses(s);
      const before = await snapshot(s, [e1]);
      const paying = { expensesPaid: [e1] };
      const cases: [Record<string, unknown>, number, unknown][] = [
        [
          { typeOfRecord: 'expense' },
          400,
          badRequest('Invalid type of record'),
        ],
        [
          { expensesPaid: [e1, { _id: { $ne: null } }] },
          400,
          badRequest(INVALID_EXPENSES_PAID),
        ],
        [{ expensesPaid: [null] }, 400, badRequest(INVALID_EXPENSES_PAID)],
        [
          { isPaid: true },
          400,
          badRequest(['property isPaid should not exist']),
        ],
        [{ category: UNUSED_ID }, 404, notFound('Category not found')],
        [{ category: b.category._id }, 404, notFound('Category not found')],
        [{ account: UNUSED_ID }, 404, notFound('Account not found')],
        [
          { account: b.account._id },
          401,
          unauthorizedMsg('Account does not belong to the user'),
        ],
      ];
      for (const [fields, status, body] of cases) {
        const res = await post(s, incomeBody(s, { ...paying, ...fields }));
        expect([res.status, res.body]).toStrictEqual([status, body]);
      }
      expect(await snapshot(s, [e1])).toStrictEqual(before);
    });

    it('atomic: a failing incrementBalance → 500, no income, no flag flipped', async () => {
      const s = await setup();
      const [e1] = await twoExpenses(s);
      const before = await snapshot(s, [e1]);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      vi.spyOn(
        app.get(AccountService, { strict: false }),
        'incrementBalance',
      ).mockRejectedValueOnce(new Error('boom'));
      const res = await post(s, incomeBody(s, { expensesPaid: [e1] })).expect(
        500,
      );
      expect(res.body).toStrictEqual(internalError);
      expect(await snapshot(s, [e1])).toStrictEqual(before);
    });
  });

  describe('DELETE /incomes-actions', () => {
    it("200 raw doc; balance back, own expenses unpaid, B's untouched; repeat → 404", async () => {
      const s = await setup();
      const b = await setup();
      const [e1, e2] = await twoExpenses(s);
      const [eb] = await twoExpenses(b);
      const { _id } = (
        await post(s, incomeBody(s, { expensesPaid: [e1, e2] })).expect(201)
      ).body.data.income as Doc;
      // B's paid expense slipped into the stored list (legacy data).
      await expenseModel.updateOne({ _id: eb }, { isPaid: true }).exec();
      await incomeModel
        .updateOne({ _id }, { $push: { expensesPaid: eb } })
        .exec();
      const res = await del(s, _id).expect(200);
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(res.body.data.income).toMatchObject({
        _id,
        category: s.category._id,
        expensesPaid: [e1, e2, eb],
      });
      expect(await balance(s.account._id)).toBe(1000);
      expect(await isPaid(e1)).toBe(false);
      expect(await isPaid(e2)).toBe(false);
      expect(await isPaid(eb)).toBe(true);
      const again = await del(s, _id).expect(404);
      expect(again.body).toStrictEqual(notFound('Income not found.'));
    });

    it("B deleting A's income → 401, nothing changes", async () => {
      const s = await setup();
      const b = await setup();
      const [e1] = await twoExpenses(s);
      await post(s, incomeBody(s, { expensesPaid: [e1] })).expect(201);
      const before = await snapshot(s, [e1]);
      const res = await del(b, before.incomes[0]._id.toString()).expect(401);
      expect(res.body).toStrictEqual(
        unauthorizedMsg('This income does not belongs to the user'),
      );
      expect(await snapshot(s, [e1])).toStrictEqual(before);
    });

    it('Q10: income on a foreign account → 404 and it stays', async () => {
      const s = await setup();
      const b = await setup();
      const id = await seedIncome({
        userId: s.sub,
        account: b.account._id,
        category: s.category._id,
      });
      const res = await del(s, id).expect(404);
      expect(res.body).toStrictEqual(notFound('Account not found'));
      expect(await incomeModel.exists({ _id: id }).exec()).not.toBeNull();
      expect(await balance(b.account._id)).toBe(1000);
    });

    it('bug 6: a legacy income with a dangling expensesPaid id → 200', async () => {
      const s = await setup();
      const id = await seedIncome({
        userId: s.sub,
        account: s.account._id,
        category: new Types.ObjectId(s.category._id),
        amount: 10,
        expensesPaid: [new Types.ObjectId(UNUSED_ID)],
      });
      await del(s, id).expect(200);
      expect(await balance(s.account._id)).toBe(990);
    });
  });

  describe('PUT /incomes-actions', () => {
    // A with an income of 200 on account 1 paying E1 and E2; E3 unpaid.
    const withIncome = async () => {
      const s = await setup();
      const [e1, e2] = await twoExpenses(s);
      const [e3] = await twoExpenses(s);
      const income = (
        await post(s, incomeBody(s, { expensesPaid: [e1, e2] })).expect(201)
      ).body.data.income as Doc;
      return { s, e1, e2, e3, income };
    };
    // What old-next's edit sends: the record's fields plus the populated expensesPaid.
    const echo = (
      s: Setup,
      income: Doc,
      fields: Record<string, unknown> = {},
    ) => {
      const body: Record<string, unknown> = {
        ...incomeBody(s),
        recordId: income._id,
        date: income.date,
        ...fields,
      };
      for (const k of Object.keys(body)) {
        if (body[k] === undefined) delete body[k];
      }
      return body;
    };

    it('200: populated expensesPaid and category; kept not touched (bug 7), removed unpaid, added paid', async () => {
      const { s, e1, e2, e3, income } = await withIncome();
      // A kept id is never touched: flip E1 back directly and check it stays.
      await expenseModel.updateOne({ _id: e1 }, { isPaid: false }).exec();
      const res = await put(
        s,
        echo(s, income, { expensesPaid: [await expenseObject(e1), e3] }),
      ).expect(200);
      expect(res.body.data.income.expensesPaid).toStrictEqual([
        {
          _id: e1,
          shortName: 'Seeded expense',
          amountFormatted: '$10.00',
          fullDate: 'Lun, 10 Feb, 2025',
          formattedTime: '12:00pm',
        },
        {
          _id: e3,
          shortName: 'Seeded expense',
          amountFormatted: '$10.00',
          fullDate: 'Lun, 10 Feb, 2025',
          formattedTime: '12:00pm',
        },
      ]);
      expect(res.body.data.income.category).toStrictEqual({
        _id: s.category._id,
        categoryName: 'Work',
        icon: 'work',
      });
      expect(await isPaid(e1)).toBe(false);
      expect(await isPaid(e2)).toBe(false);
      expect(await isPaid(e3)).toBe(true);
    });

    it('balances: amount 200 → 250 is +50; move to account 2 is −old/+new; repeat changes nothing (D9)', async () => {
      const { s, income } = await withIncome();
      await put(s, echo(s, income, { amount: 250 })).expect(200);
      expect(await balance(s.account._id)).toBe(1250);
      const move = echo(s, income, { amount: 250, account: s.account2._id });
      await put(s, move).expect(200);
      expect(await balance(s.account._id)).toBe(1000);
      expect(await balance(s.account2._id)).toBe(750);
      await put(s, move).expect(200);
      expect(await balance(s.account2._id)).toBe(750);
    });

    it("audit High / Q9 / Q6: B's account → 401, B's category → 404, B's expense not stored nor paid", async () => {
      const { s, e1, e2, income } = await withIncome();
      const b = await setup();
      const [eb] = await twoExpenses(b);
      const before = await snapshot(s, [e1, e2, eb]);
      const moved = await put(
        s,
        echo(s, income, { account: b.account._id }),
      ).expect(401);
      expect(moved.body).toStrictEqual(
        unauthorizedMsg('Account does not belong to the user'),
      );
      const recat = await put(
        s,
        echo(s, income, { category: b.category._id }),
      ).expect(404);
      expect(recat.body).toStrictEqual(notFound('Category not found'));
      expect(await snapshot(s, [e1, e2, eb])).toStrictEqual(before);
      expect(await balance(b.account._id)).toBe(1000);

      await put(s, echo(s, income, { expensesPaid: [e1, e2, eb] })).expect(200);
      expect(await storedPaidIds(income._id)).toStrictEqual([e1, e2]);
      expect(await isPaid(eb)).toBe(false);
    });

    it('Q8: no expensesPaid → flags and stored list unchanged; [] unpays all', async () => {
      const { s, e1, e2, income } = await withIncome();
      await put(s, echo(s, income, { expensesPaid: undefined })).expect(200);
      expect(await storedPaidIds(income._id)).toStrictEqual([e1, e2]);
      expect([await isPaid(e1), await isPaid(e2)]).toStrictEqual([true, true]);
      await put(s, echo(s, income, { expensesPaid: [] })).expect(200);
      expect(await storedPaidIds(income._id)).toStrictEqual([]);
      expect([await isPaid(e1), await isPaid(e2)]).toStrictEqual([
        false,
        false,
      ]);
    });

    it("legacy income (B's ObjectId category, dangling paid id) unchanged → 200 (Q9, bug 6)", async () => {
      const s = await setup();
      const b = await setup();
      const id = await seedIncome({
        userId: s.sub,
        account: s.account._id,
        category: new Types.ObjectId(b.category._id),
        expensesPaid: [new Types.ObjectId(UNUSED_ID)],
      });
      const res = await put(s, {
        ...incomeBody(s, { category: b.category._id, amount: 10 }),
        expensesPaid: undefined,
        recordId: id,
        date: '2025-02-10T12:00:00.000Z',
      }).expect(200);
      expect(res.body.data.income.expensesPaid).toStrictEqual([]);
      expect(await storedPaidIds(id)).toStrictEqual([UNUSED_ID]);
      expect(await balance(s.account._id)).toBe(1000);
    });

    it("errors: B's PUT → 401, unknown id → 404 'Expense not found.', missing props, userId", async () => {
      const { s, e1, e2, income } = await withIncome();
      const b = await signupAndLogin();
      const before = await snapshot(s, [e1, e2]);
      const foreign = await put(b, echo(s, income)).expect(401);
      expect(foreign.body).toStrictEqual(
        unauthorizedMsg("You're unauthorized to see these incomes."),
      );
      const cases: [Record<string, unknown>, number, unknown][] = [
        [{ recordId: UNUSED_ID }, 404, notFound('Expense not found.')],
        [{ date: undefined }, 400, badRequest('date prop is missing.')],
        [{ category: undefined }, 400, badRequest('category prop is missing.')],
        [{ amount: undefined }, 400, badRequest('amount prop is missing.')],
        [{ amount: 0 }, 400, badRequest('amount prop is missing.')],
        [{ expensesPaid: [42] }, 400, badRequest(INVALID_EXPENSES_PAID)],
        [
          { userId: b.sub },
          400,
          badRequest(['property userId should not exist']),
        ],
      ];
      for (const [fields, status, body] of cases) {
        const res = await put(s, echo(s, income, fields));
        expect([res.status, res.body]).toStrictEqual([status, body]);
      }
      expect(await snapshot(s, [e1, e2])).toStrictEqual(before);
    });

    it("typeOfRecord 'transfer' on a seeded transfer income → 200, only this side's account moves", async () => {
      const s = await setup();
      const id = await seedIncome({
        userId: s.sub,
        account: s.account._id,
        category: s.category._id,
        typeOfRecord: 'transfer',
        transferRecord: { transferId: UNUSED_ID, account: s.account2._id },
      });
      const res = await put(s, {
        ...incomeBody(s, { typeOfRecord: 'transfer', amount: 15 }),
        expensesPaid: undefined,
        recordId: id,
        date: '2025-02-10T12:00:00.000Z',
      }).expect(200);
      expect(res.body.data.income.typeOfRecord).toBe('transfer');
      expect(await balance(s.account._id)).toBe(1005);
      expect(await balance(s.account2._id)).toBe(500);
    });

    it('atomic: a failing incrementBalance on the new account → 500, nothing changes', async () => {
      const { s, e1, e2, e3, income } = await withIncome();
      const before = await snapshot(s, [e1, e2, e3]);
      const accounts = app.get(AccountService, { strict: false });
      const real = accounts.incrementBalance.bind(accounts);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      vi.spyOn(accounts, 'incrementBalance').mockImplementation((args) =>
        args.accountId === s.account2._id
          ? Promise.reject(new Error('boom'))
          : real(args),
      );
      const res = await put(
        s,
        echo(s, income, {
          account: s.account2._id,
          amount: 150,
          expensesPaid: [e3],
        }),
      ).expect(500);
      expect(res.body).toStrictEqual(internalError);
      expect(await snapshot(s, [e1, e2, e3])).toStrictEqual(before);
    });
  });
});
