import { INestApplication, Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Account } from '../src/account/entities/account.entity.js';
import { AccountService } from '../src/account/services/account.service.js';
import { BudgetHistory } from '../src/budget/entities/budget-history.entity.js';
import { Budget } from '../src/budget/entities/budget.entity.js';
import { BudgetHistoryService } from '../src/budget/services/budget-history.service.js';
import { INITIAL_RESPONSE } from '../src/constants.js';
import { Expense } from '../src/record/entities/expense.entity.js';
import { closeTestApp, createTestApp } from './create-test-app.js';

const PASSWORD = 'e2e-password';
const UNUSED_ID = '000000000000000000000000';
let seq = 0;
const uniqueEmail = () => `e2e-rec-${Date.now()}-${seq++}@example.invalid`;
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
const emptyListing = {
  ...INITIAL_RESPONSE,
  message: 'Expenses not found.',
  data: { expenses: [] },
};
const budgetBody = {
  name: 'Food',
  description: 'Groceries',
  typeBudget: 'periodic',
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2026-01-31T00:00:00.000Z',
  currentAmount: 0,
  limit: 500,
  period: 'monthly',
  isActive: true,
  nextResetDate: '2026-01-31T00:00:00.000Z',
  previousPeriods: [],
};
// Input instant → stored Mexico City wall clock (research §4 vector).
const INPUT_DATE = '2025-02-03T20:05:30.123Z';
const STORED_DATE = '2025-02-03T14:05:30.000Z';
type User = { sub: string; auth: Record<string, string> };
type Doc = Record<string, unknown> & { _id: string };

describe('Records: expenses (e2e)', () => {
  let app: INestApplication<App>;
  let expenseModel: Model<Expense>;
  let accountModel: Model<Account>;
  let budgetModel: Model<Budget>;
  let historyModel: Model<BudgetHistory>;
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
  const createCategory = async (u: User, categoryName = 'Food') =>
    (
      await http()
        .post('/categories')
        .set(u.auth)
        .send({ categoryName, subCategories: ['Lunch'], icon: 'food' })
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
  const createBudget = async (u: User) =>
    (await http().post('/budgets').set(u.auth).send(budgetBody).expect(201))
      .body.data as { budget: Doc; budgetHistory: Doc };
  // A user with one category, two accounts and two budgets.
  const setup = async () => {
    const u = await signupAndLogin();
    const category = await createCategory(u);
    const account = await createAccount(u, 1000);
    const account2 = await createAccount(u, 500);
    const b1 = await createBudget(u);
    const b2 = await createBudget(u);
    return { ...u, category, account, account2, b1, b2 };
  };
  const balance = async (id: string) =>
    (await accountModel.findById(id).lean().exec())?.amount;
  const budgetAmount = async (id: string) =>
    (await budgetModel.findById(id).lean().exec())?.currentAmount;
  const historyRecords = async (id: string) =>
    (await historyModel.findById(id).lean().exec())?.records;
  // Legacy shapes, written raw (no casting, no defaults).
  const seed = async (fields: Record<string, unknown>) => {
    const doc = {
      shortName: 'Seeded',
      typeOfRecord: 'expense',
      description: '',
      amount: 10,
      amountFormatted: '$10.00',
      date: new Date('2025-02-10T12:00:00.000Z'),
      fullDate: 'Lun, 10 Feb, 2025',
      formattedTime: '12:00pm',
      subCategory: 'Lunch',
      tag: [],
      indebtedPeople: [],
      budgets: [],
      isPaid: true,
      __v: 0,
      ...fields,
    };
    const { insertedId } = await expenseModel.collection.insertOne(doc);
    return insertedId.toString();
  };
  const listing = (u: User, accountId: string, month = 'Feb', year = '2025') =>
    http()
      .get(`/expenses-actions/${accountId}/${month}/${year}`)
      .set(u.auth)
      .expect(200);

  beforeAll(async () => {
    app = await createTestApp();
    expenseModel = app.get<Model<Expense>>(getModelToken(Expense.name));
    accountModel = app.get<Model<Account>>(getModelToken(Account.name));
    budgetModel = app.get<Model<Budget>>(getModelToken(Budget.name));
    historyModel = app.get<Model<BudgetHistory>>(
      getModelToken(BudgetHistory.name),
    );
    await expenseModel.init();
    await accountModel.init();
    await budgetModel.init();
    await historyModel.init();
  });

  afterAll(async () => {
    if (app) await closeTestApp(app);
  });

  afterEach(() => vi.restoreAllMocks());

  it('401 without a token on all 4 routes', async () => {
    const routes = [
      ['post', '/expenses-actions'],
      ['put', '/expenses-actions'],
      ['delete', '/expenses-actions'],
      ['get', `/expenses-actions/${UNUSED_ID}/Feb/2025`],
    ] as const;
    for (const [method, path] of routes) {
      const res = await http()[method](path).expect(401);
      expect(res.body).toStrictEqual(unauthorized);
    }
  });

  it('schema paths: linkedBudgets ObjectId[], category Mixed, account String', () => {
    const schema = expenseModel.schema;
    // mongoose 9 names the element type `embeddedSchemaType` (the plan's `caster`).
    const linked = schema.path('linkedBudgets') as unknown as {
      embeddedSchemaType: { instance: string };
    };
    expect(linked.embeddedSchemaType.instance).toBe('ObjectId');
    expect(schema.path('category').instance).toBe('Mixed');
    expect(schema.path('account').instance).toBe('String');
  });

  describe('GET /expenses-actions/:accountId/:month/:year', () => {
    it('lists legacy and new shapes populated; skips transfers, other months and other users', async () => {
      const a = await setup();
      const b = await signupAndLogin();
      const acc = a.account._id;
      const legacy = await seed({
        userId: a.sub,
        account: acc,
        category: new Types.ObjectId(a.category._id),
      });
      const fresh = await seed({
        userId: a.sub,
        account: acc,
        category: a.category._id,
        linkedBudgets: [
          new Types.ObjectId(a.b1.budget._id),
          new Types.ObjectId(UNUSED_ID),
        ],
      });
      await seed({
        userId: a.sub,
        account: acc,
        category: a.category._id,
        typeOfRecord: 'transfer',
      });
      await seed({
        userId: a.sub,
        account: acc,
        category: a.category._id,
        date: new Date('2025-03-01T00:00:00.000Z'),
      });
      await seed({ userId: b.sub, account: acc, category: a.category._id });

      const res = await listing(a, acc);
      expect(res.body.message).toBeNull();
      const expenses = res.body.data.expenses as Doc[];
      expect(expenses.map((e) => e._id).sort()).toStrictEqual(
        [legacy, fresh].sort(),
      );
      const category = {
        _id: a.category._id,
        categoryName: 'Food',
        icon: 'food',
      };
      const byId = Object.fromEntries(expenses.map((e) => [e._id, e]));
      expect(byId[legacy].category).toStrictEqual(category);
      expect(byId[legacy]).not.toHaveProperty('linkedBudgets');
      expect(byId[fresh].category).toStrictEqual(category);
      expect(byId[fresh].linkedBudgets).toStrictEqual([
        { ...a.b1.budget, __v: 0 },
      ]);
      expect(byId[fresh]).toMatchObject({
        userId: a.sub,
        account: acc,
        indebtedPeople: [],
        __v: 0,
      });
    });

    it('a missing category populates to null', async () => {
      const a = await setup();
      await seed({
        userId: a.sub,
        account: a.account._id,
        category: UNUSED_ID,
      });
      const res = await listing(a, a.account._id);
      expect(res.body.data.expenses[0].category).toBeNull();
    });

    it.each([
      ['jan', '2025'],
      ['Feb', '2025a'],
    ])('200 empty for %s/%s', async (month, year) => {
      const a = await setup();
      await seed({
        userId: a.sub,
        account: a.account._id,
        category: a.category._id,
      });
      const res = await listing(a, a.account._id, month, year);
      expect(res.body).toStrictEqual(emptyListing);
    });

    it('200 empty for an unknown or non-ObjectId account', async () => {
      const a = await signupAndLogin();
      for (const acc of [UNUSED_ID, 'not-an-id']) {
        expect((await listing(a, acc)).body).toStrictEqual(emptyListing);
      }
    });
  });

  describe('AC4: DELETE /budgets unlinks the budget from the owner expenses', () => {
    it("pulls only the deleted id, only from the owner's expenses", async () => {
      const a = await setup();
      const b = await signupAndLogin();
      const bud = new Types.ObjectId(a.b1.budget._id);
      const other = new Types.ObjectId(a.b2.budget._id);
      const base = { account: a.account._id, category: a.category._id };
      const e1 = await seed({ ...base, userId: a.sub, linkedBudgets: [bud] });
      const e2 = await seed({
        ...base,
        userId: a.sub,
        linkedBudgets: [bud, other],
      });
      const eb = await seed({ ...base, userId: b.sub, linkedBudgets: [bud] });
      await http()
        .delete('/budgets')
        .set(a.auth)
        .send({ budgetId: a.b1.budget._id })
        .expect(200);
      const linked = async (id: string) =>
        (await expenseModel.findById(id).lean().exec())?.linkedBudgets?.map(
          String,
        );
      expect(await linked(e1)).toStrictEqual([]);
      expect(await linked(e2)).toStrictEqual([a.b2.budget._id]);
      expect(await linked(eb)).toStrictEqual([a.b1.budget._id]);
    });

    it('a failing history delete → 500 and the links stay', async () => {
      const a = await setup();
      const bud = new Types.ObjectId(a.b1.budget._id);
      const e1 = await seed({
        userId: a.sub,
        account: a.account._id,
        category: a.category._id,
        linkedBudgets: [bud],
      });
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      vi.spyOn(historyModel, 'findOneAndDelete').mockImplementationOnce(() => {
        throw new Error('boom');
      });
      const res = await http()
        .delete('/budgets')
        .set(a.auth)
        .send({ budgetId: a.b1.budget._id })
        .expect(500);
      expect(res.body).toStrictEqual(internalError);
      const doc = await expenseModel.findById(e1).lean().exec();
      expect(doc?.linkedBudgets?.map(String)).toStrictEqual([a.b1.budget._id]);
    });
  });

  type Setup = Awaited<ReturnType<typeof setup>>;
  const expenseBody = (s: Setup, fields: object = {}) => ({
    shortName: 'Lunch',
    typeOfRecord: 'expense',
    description: '',
    amount: 100,
    date: INPUT_DATE,
    category: s.category._id,
    subCategory: 'Lunch',
    tag: [],
    indebtedPeople: [{ name: 'P', amount: 10, amountPaid: 0, isPaid: false }],
    account: s.account._id,
    budgets: [],
    isPaid: true,
    linkedBudgets: [s.b1.budget._id],
    ...fields,
  });
  const post = (s: User, body: object) =>
    http().post('/expenses-actions').set(s.auth).send(body);
  const put = (s: User, body: object) =>
    http().put('/expenses-actions').set(s.auth).send(body);
  const del = (s: User, recordId: string) =>
    http().delete('/expenses-actions').set(s.auth).send({ recordId });
  // Everything a failed mutation must leave unchanged.
  const snapshot = async (s: Setup) => ({
    expenses: await expenseModel.find({ userId: s.sub }).lean().exec(),
    acc: await balance(s.account._id),
    acc2: await balance(s.account2._id),
    b1: await budgetAmount(s.b1.budget._id),
    b2: await budgetAmount(s.b2.budget._id),
    h1: await historyRecords(s.b1.budgetHistory._id),
    h2: await historyRecords(s.b2.budgetHistory._id),
  });
  const create = async (s: Setup, fields: object = {}) =>
    (await post(s, expenseBody(s, fields)).expect(201)).body.data
      .expense as Doc;
  // old-next's edit body: the stored record echoed (indebtedPeople with `_id`), linkedBudgets as ids.
  const echo = (s: Setup, e: Doc, fields: object = {}) => ({
    ...expenseBody(s),
    recordId: e._id,
    date: e.date,
    indebtedPeople: e.indebtedPeople,
    linkedBudgets: (e.linkedBudgets as (Doc | string)[]).map((b) =>
      typeof b === 'string' ? b : b._id,
    ),
    ...fields,
  });

  describe('POST /expenses-actions', () => {
    it('201: populated, Mexico wall clock stored, balance −amount, budget +amount with one history entry', async () => {
      const s = await setup();
      const res = await post(s, expenseBody(s)).expect(201);
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(
        res.body.message.every((m: unknown) => typeof m === 'string'),
      ).toBe(true);
      const e = res.body.data.expense as Doc;
      expect(e).toMatchObject({
        shortName: 'Lunch',
        date: STORED_DATE,
        fullDate: 'Lun, 3 Feb, 2025',
        formattedTime: '14:05pm',
        amountFormatted: '$100.00',
        userId: s.sub,
        account: s.account._id,
        isPaid: true,
        category: { _id: s.category._id, categoryName: 'Food', icon: 'food' },
      });
      expect(Object.keys(e.category as object).sort()).toStrictEqual(
        ['_id', 'categoryName', 'icon'].sort(),
      );
      // Populated after the commit: the budget already carries this expense.
      expect(e.linkedBudgets).toStrictEqual([
        { ...s.b1.budget, currentAmount: 100, __v: 0 },
      ]);
      expect(e).not.toHaveProperty('expensesPaid');
      expect(await balance(s.account._id)).toBe(900);
      expect(await budgetAmount(s.b1.budget._id)).toBe(100);
      expect(await historyRecords(s.b1.budgetHistory._id)).toMatchObject([
        {
          recordId: e._id,
          recordName: 'Lunch',
          recordAmount: 100,
          recordDate: new Date(INPUT_DATE),
          budgetCurrentAmount: 0,
          budgetUpdatedAmount: 100,
        },
      ]);
      // category is stored as the DTO string (Q4).
      const raw = await expenseModel.collection.findOne({
        _id: new Types.ObjectId(e._id),
      });
      expect(typeof raw?.category).toBe('string');
    });

    it('accepts indebtedPeople with an _id (Q7)', async () => {
      const s = await setup();
      await post(
        s,
        expenseBody(s, {
          indebtedPeople: [
            {
              _id: UNUSED_ID,
              name: 'P',
              amount: 1,
              amountPaid: 0,
              isPaid: false,
            },
          ],
        }),
      ).expect(201);
    });

    it('errors write nothing (expense, balance, budget, history)', async () => {
      const s = await setup();
      const b = await setup();
      const before = await snapshot(s);
      const cases: [object, number, unknown][] = [
        [
          { typeOfRecord: 'transfer' },
          400,
          badRequest('Transfer record cannot be linked to budget'),
        ],
        [{ typeOfRecord: 'income' }, 400, badRequest('Invalid type of record')],
        [
          {
            linkedBudgets: [
              s.b1.budget._id,
              s.b2.budget._id,
              UNUSED_ID,
              b.b1.budget._id,
            ],
          },
          400,
          badRequest('The maximum number of budgets are 3'),
        ],
        [{ category: UNUSED_ID }, 404, notFound('Category not found')],
        [{ category: b.category._id }, 404, notFound('Category not found')],
        [{ account: UNUSED_ID }, 404, notFound('Account not found')],
        [
          { account: b.account._id },
          401,
          unauthorizedMsg('Account does not belong to the user'),
        ],
        [
          { linkedBudgets: [s.b2.budget._id, b.b1.budget._id] },
          400,
          badRequest('Budget history not found'),
        ],
        [
          { linkedBudgets: [UNUSED_ID] },
          400,
          badRequest('Budget history not found'),
        ],
        [
          { indebtedPeople: null },
          400,
          badRequest([
            'nested property indebtedPeople must be either object or array',
          ]),
        ],
        [
          { transferRecord: null },
          400,
          badRequest([
            'nested property transferRecord must be either object or array',
          ]),
        ],
        [
          { userId: b.sub },
          400,
          badRequest(['property userId should not exist']),
        ],
      ];
      for (const [fields, status, body] of cases) {
        const res = await post(s, expenseBody(s, fields));
        expect([res.status, res.body]).toStrictEqual([status, body]);
      }
      expect(await snapshot(s)).toStrictEqual(before);
      expect(await budgetAmount(b.b1.budget._id)).toBe(0);
    });

    it('atomic: a failing history push → 500 and nothing written', async () => {
      const s = await setup();
      const before = await snapshot(s);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      vi.spyOn(
        app.get(BudgetHistoryService, { strict: false }),
        'addHistoryRecord',
      ).mockRejectedValueOnce(new Error('boom'));
      const res = await post(s, expenseBody(s)).expect(500);
      expect(res.body).toStrictEqual(internalError);
      expect(await snapshot(s)).toStrictEqual(before);
    });
  });

  describe('DELETE /expenses-actions', () => {
    it('200 raw doc; balance, budget and history restored; repeat → 404', async () => {
      const s = await setup();
      const e = await create(s);
      const res = await del(s, e._id).expect(200);
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(res.body.data.expense).toMatchObject({
        _id: e._id,
        category: s.category._id,
        linkedBudgets: [s.b1.budget._id],
      });
      expect(await balance(s.account._id)).toBe(1000);
      expect(await budgetAmount(s.b1.budget._id)).toBe(0);
      expect(await historyRecords(s.b1.budgetHistory._id)).toStrictEqual([]);
      expect(await expenseModel.countDocuments({ userId: s.sub })).toBe(0);
      expect((await del(s, e._id).expect(404)).body).toStrictEqual(
        notFound('Expense not found.'),
      );
      expect(await balance(s.account._id)).toBe(1000);
    });

    it("401 for another user's record, nothing changes", async () => {
      const s = await setup();
      const b = await signupAndLogin();
      await create(s);
      const before = await snapshot(s);
      const e = before.expenses[0]._id.toString();
      expect((await del(b, e).expect(401)).body).toStrictEqual(
        unauthorizedMsg('This expense does not belongs to the user'),
      );
      expect(await snapshot(s)).toStrictEqual(before);
    });

    it('200 for a record linked to a deleted budget and for one without linkedBudgets', async () => {
      const s = await setup();
      const base = {
        userId: s.sub,
        account: s.account._id,
        category: s.category._id,
        amount: 10,
      };
      const stale = await seed({
        ...base,
        linkedBudgets: [new Types.ObjectId(UNUSED_ID)],
      });
      const legacy = await seed(base);
      await del(s, stale).expect(200);
      await del(s, legacy).expect(200);
      expect(await balance(s.account._id)).toBe(1020);
    });

    it('Q10: a record on a foreign account → 404 and the record stays', async () => {
      const s = await setup();
      const b = await setup();
      const id = await seed({
        userId: s.sub,
        account: b.account._id,
        category: s.category._id,
      });
      expect((await del(s, id).expect(404)).body).toStrictEqual(
        notFound('Account not found'),
      );
      expect(await expenseModel.exists({ _id: id })).not.toBeNull();
      expect(await balance(b.account._id)).toBe(1000);
    });
  });

  describe('PUT /expenses-actions', () => {
    it('echoed edit (Q7) → 200, only category populated; amount, links and account moves', async () => {
      const s = await setup();
      const e = await create(s);
      const res = await put(s, echo(s, e)).expect(200);
      expect(res.body.data.expense).toMatchObject({
        category: { _id: s.category._id, categoryName: 'Food', icon: 'food' },
        linkedBudgets: [s.b1.budget._id],
        date: STORED_DATE,
      });
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(await balance(s.account._id)).toBe(900);

      // amount 100 → 150
      await put(s, echo(s, e, { amount: 150 })).expect(200);
      expect(await balance(s.account._id)).toBe(850);
      expect(await budgetAmount(s.b1.budget._id)).toBe(150);
      expect(await historyRecords(s.b1.budgetHistory._id)).toMatchObject([
        { recordId: e._id, recordAmount: 150 },
      ]);

      // unlink b1, link b2
      await put(
        s,
        echo(s, e, { amount: 150, linkedBudgets: [s.b2.budget._id] }),
      ).expect(200);
      expect(await budgetAmount(s.b1.budget._id)).toBe(0);
      expect(await historyRecords(s.b1.budgetHistory._id)).toStrictEqual([]);
      expect(await budgetAmount(s.b2.budget._id)).toBe(150);
      expect(await historyRecords(s.b2.budgetHistory._id)).toMatchObject([
        { recordId: e._id, recordAmount: 150 },
      ]);

      // move to the second account
      const moved = echo(s, e, {
        amount: 150,
        account: s.account2._id,
        linkedBudgets: [s.b2.budget._id],
      });
      await put(s, moved).expect(200);
      expect(await balance(s.account._id)).toBe(1000);
      expect(await balance(s.account2._id)).toBe(350);

      // repeating the same PUT moves nothing (D9)
      await put(s, moved).expect(200);
      expect(await balance(s.account2._id)).toBe(350);
      expect(await budgetAmount(s.b2.budget._id)).toBe(150);
    });

    it("B's account → 401, B's category → 404, B's budget → 400; nothing changes", async () => {
      const s = await setup();
      const b = await setup();
      const e = await create(s);
      const before = await snapshot(s);
      const cases: [object, number, unknown][] = [
        [
          { account: b.account._id },
          401,
          unauthorizedMsg('Account does not belong to the user'),
        ],
        [{ category: b.category._id }, 404, notFound('Category not found')],
        [
          { linkedBudgets: [s.b1.budget._id, b.b1.budget._id] },
          400,
          badRequest('Budget history not found'),
        ],
      ];
      for (const [fields, status, body] of cases) {
        const res = await put(s, echo(s, e, { amount: 120, ...fields }));
        expect([res.status, res.body]).toStrictEqual([status, body]);
      }
      expect(await snapshot(s)).toStrictEqual(before);
      expect(await balance(b.account._id)).toBe(1000);
      expect(await budgetAmount(b.b1.budget._id)).toBe(0);
    });

    it("Q9: a legacy doc with B's category stored stays editable when the category is kept", async () => {
      const s = await setup();
      const b = await setup();
      const id = await seed({
        userId: s.sub,
        account: s.account._id,
        category: new Types.ObjectId(b.category._id),
      });
      const res = await put(s, {
        ...expenseBody(s, { category: b.category._id, linkedBudgets: [] }),
        recordId: id,
        amount: 10,
        date: '2025-02-10T12:00:00.000Z',
      }).expect(200);
      expect(res.body.data.expense.category).toMatchObject({
        _id: b.category._id,
      });
    });

    it("B's PUT on A's record → 401; unknown recordId → 404; missing props → 400", async () => {
      const s = await setup();
      const b = await setup();
      const e = await create(s);
      const before = await snapshot(s);
      expect((await put(b, echo(s, e)).expect(401)).body).toStrictEqual(
        unauthorizedMsg('This expense does not belongs to the user'),
      );
      expect(
        (await put(s, echo(s, e, { recordId: UNUSED_ID })).expect(404)).body,
      ).toStrictEqual(notFound('Expense not found.'));
      const missing: [string, string][] = [
        ['date', 'date prop is missing.'],
        ['category', 'category prop is missing.'],
        ['amount', 'amount prop is missing.'],
        ['linkedBudgets', 'linkedBudgets prop is missing.'],
      ];
      for (const [field, message] of missing) {
        const { [field]: _omit, ...body } = echo(s, e) as Record<
          string,
          unknown
        >;
        expect((await put(s, body).expect(400)).body).toStrictEqual(
          badRequest(message),
        );
      }
      expect(
        (await put(s, echo(s, e, { amount: 0 })).expect(400)).body,
      ).toStrictEqual(badRequest('amount prop is missing.'));
      expect(
        (await put(s, echo(s, e, { userId: b.sub })).expect(400)).body,
      ).toStrictEqual(badRequest(['property userId should not exist']));
      expect(await snapshot(s)).toStrictEqual(before);
    });

    it("typeOfRecord 'transfer' on a seeded transfer → 200, stored type kept", async () => {
      const s = await setup();
      const id = await seed({
        userId: s.sub,
        account: s.account._id,
        category: s.category._id,
        typeOfRecord: 'transfer',
        transferRecord: { transferId: UNUSED_ID, account: s.account2._id },
      });
      const res = await put(s, {
        ...expenseBody(s, { typeOfRecord: 'transfer', linkedBudgets: [] }),
        recordId: id,
        amount: 10,
        date: '2025-02-10T12:00:00.000Z',
      }).expect(200);
      expect(res.body.data.expense.typeOfRecord).toBe('transfer');
      expect(await balance(s.account._id)).toBe(1000);
    });

    it('atomic: a failing incrementBalance on the new account → 500, nothing changes', async () => {
      const s = await setup();
      const e = await create(s);
      const before = await snapshot(s);
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
        echo(s, e, { account: s.account2._id, amount: 150 }),
      ).expect(500);
      expect(res.body).toStrictEqual(internalError);
      expect(await snapshot(s)).toStrictEqual(before);
    });
  });
});
