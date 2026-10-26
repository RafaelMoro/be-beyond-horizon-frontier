import { INestApplication, Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Account } from '../src/account/entities/account.entity.js';
import { AccountService } from '../src/account/services/account.service.js';
import { Budget } from '../src/budget/entities/budget.entity.js';
import { INITIAL_RESPONSE } from '../src/constants.js';
import { Expense } from '../src/record/entities/expense.entity.js';
import { Income } from '../src/record/entities/income.entity.js';
import { INVALID_EXPENSES_PAID } from '../src/record/record.constants.js';
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
const internalError = {
  ...INITIAL_RESPONSE,
  success: false,
  error: { statusCode: 500, message: 'Internal server error' },
};
const noRecords = {
  ...INITIAL_RESPONSE,
  message: 'No incomes or expenses found.',
  data: null,
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
const mismatch = (field: string) =>
  `Transfer records has different ${field}. Both must have the same value`;
type User = { sub: string; auth: Record<string, string> };
type Doc = Record<string, unknown> & { _id: string };
type Setup = User & { category: Doc; account: Doc; account2: Doc };

describe('Records: transfers and listing (e2e)', () => {
  let app: INestApplication<App>;
  let expenseModel: Model<Expense>;
  let incomeModel: Model<Income>;
  let accountModel: Model<Account>;
  let budgetModel: Model<Budget>;
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
  const createCategory = async (u: User) =>
    (
      await http()
        .post('/categories')
        .set(u.auth)
        .send({ categoryName: 'Move', subCategories: ['Sub'], icon: 'move' })
        .expect(201)
    ).body.data.category as Doc;
  const createAccount = async (u: User, amount: number) =>
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
  // A user with one category and two accounts (1000 and 500).
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
  const json = (x: unknown) => JSON.parse(JSON.stringify(x)) as Doc;
  const base = {
    description: '',
    amount: 10,
    amountFormatted: '$10.00',
    fullDate: 'Lun, 10 Feb, 2025',
    formattedTime: '12:00pm',
    subCategory: 'Sub',
    tag: [],
    indebtedPeople: [],
    budgets: [],
    __v: 0,
  };
  // Legacy shapes, written raw (no casting, no defaults, no linkedBudgets key).
  const seedExpense = async (fields: Record<string, unknown>) => {
    const { insertedId } = await expenseModel.collection.insertOne({
      ...base,
      date: new Date('2025-02-10T12:00:00.000Z'),
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
      date: new Date('2025-02-10T12:00:00.000Z'),
      shortName: 'Seeded income',
      typeOfRecord: 'income',
      expensesPaid: [],
      ...fields,
    });
    return insertedId.toString();
  };
  const expenseObject = async (id: string) =>
    json(await expenseModel.findById(id).lean().exec());
  const list = (u: User, accountId: string, month = 'Feb', year = '2025') =>
    http()
      .get(`/records/expenses-and-incomes/${accountId}/${month}/${year}`)
      .set(u.auth);
  const ids = (body: { data: { records: Doc[] } | null }) =>
    (body.data?.records ?? []).map((r) => r._id);

  // old-next's getValuesIncomeAndExpense body.
  const transferBody = (
    s: Setup,
    { expense = {}, income = {} }: { expense?: object; income?: object } = {},
  ) => {
    const common = {
      shortName: 'Move',
      description: '',
      amount: 200,
      date: INPUT_DATE,
      category: s.category._id,
      subCategory: 'Sub',
      tag: [],
      budgets: [],
      indebtedPeople: [],
      typeOfRecord: 'transfer',
    };
    return {
      expense: {
        ...common,
        account: s.account._id,
        isPaid: true,
        linkedBudgets: [],
        ...expense,
      },
      income: {
        ...common,
        account: s.account2._id,
        expensesPaid: [],
        ...income,
      },
    };
  };
  const transfer = (u: User, body: object) =>
    http().post('/records/transfer').set(u.auth).send(body);
  const snapshot = async (s: Setup, expenseIds: string[]) => ({
    expenses: await expenseModel
      .find({ userId: s.sub })
      .sort({ _id: 1 })
      .lean()
      .exec(),
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
    budgetModel = app.get<Model<Budget>>(getModelToken(Budget.name));
    await expenseModel.init();
    await incomeModel.init();
    await accountModel.init();
  });

  afterAll(async () => {
    if (app) await closeTestApp(app);
  });

  afterEach(() => vi.restoreAllMocks());

  it('401 without a token on the listing and the transfer', async () => {
    const get = await http()
      .get(`/records/expenses-and-incomes/${UNUSED_ID}/Feb/2025`)
      .expect(401);
    expect(get.body).toStrictEqual(unauthorized);
    const post = await http().post('/records/transfer').expect(401);
    expect(post.body).toStrictEqual(unauthorized);
  });

  describe('GET /records/expenses-and-incomes/:accountId/:month/:year', () => {
    it('lists old and new shapes, transfers included, within the UTC month, date desc', async () => {
      const a = await setup();
      const b = await signupAndLogin();
      const acc = a.account._id;
      const cat = a.category._id;
      const budget = (
        await http().post('/budgets').set(a.auth).send(budgetBody).expect(201)
      ).body.data.budget as Doc;
      const legacy = await seedExpense({
        userId: a.sub,
        account: acc,
        category: new Types.ObjectId(cat),
        date: new Date('2025-02-10T12:00:00.000Z'),
      });
      const withBudget = await seedExpense({
        userId: a.sub,
        account: acc,
        category: cat,
        linkedBudgets: [new Types.ObjectId(budget._id)],
        date: new Date('2025-02-12T12:00:00.000Z'),
      });
      const trExpense = await seedExpense({
        userId: a.sub,
        account: acc,
        category: cat,
        typeOfRecord: 'transfer',
        isPaid: true,
        linkedBudgets: [],
        transferRecord: { transferId: UNUSED_ID, account: a.account2._id },
        date: new Date('2025-02-14T12:00:00.000Z'),
      });
      const income = await seedIncome({
        userId: a.sub,
        account: acc,
        category: cat,
        expensesPaid: [new Types.ObjectId(legacy)],
        date: new Date('2025-02-11T12:00:00.000Z'),
      });
      const trIncome = await seedIncome({
        userId: a.sub,
        account: acc,
        category: cat,
        typeOfRecord: 'transfer',
        transferRecord: { transferId: UNUSED_ID, account: a.account2._id },
        date: new Date('2025-02-01T00:00:00.000Z'),
      });
      // Out: just before, at the end bound, A's other account, B's with the same account string.
      await seedExpense({
        userId: a.sub,
        account: acc,
        category: cat,
        date: new Date('2025-01-31T23:59:59.999Z'),
      });
      await seedIncome({
        userId: a.sub,
        account: acc,
        category: cat,
        date: new Date('2025-03-01T00:00:00.000Z'),
      });
      await seedExpense({
        userId: a.sub,
        account: a.account2._id,
        category: cat,
      });
      const bsOwn = await seedIncome({
        userId: b.sub,
        account: acc,
        category: cat,
      });

      const res = await list(a, acc).expect(200);
      expect(res.body.message).toBeNull();
      expect(ids(res.body)).toEqual([
        trExpense,
        withBudget,
        income,
        legacy,
        trIncome,
      ]);
      const byId = Object.fromEntries(
        (res.body.data.records as Doc[]).map((r) => [r._id, r]),
      );
      const populatedCategory = {
        _id: cat,
        categoryName: 'Move',
        icon: 'move',
      };
      for (const id of [legacy, withBudget, trExpense, income, trIncome]) {
        expect(byId[id].category).toStrictEqual(populatedCategory);
      }
      for (const id of [legacy, withBudget, trExpense]) {
        expect(byId[id]).toHaveProperty('isPaid');
        expect(byId[id]).not.toHaveProperty('expensesPaid');
      }
      for (const id of [income, trIncome]) {
        expect(byId[id]).not.toHaveProperty('isPaid');
        expect(byId[id]).toHaveProperty('expensesPaid');
      }
      expect(byId[legacy]).not.toHaveProperty('linkedBudgets');
      expect(byId[withBudget].linkedBudgets).toStrictEqual([
        json(await budgetModel.findById(budget._id).lean().exec()),
      ]);
      expect(byId[income].expensesPaid).toStrictEqual([
        {
          _id: legacy,
          shortName: 'Seeded expense',
          amountFormatted: '$10.00',
          fullDate: 'Lun, 10 Feb, 2025',
          formattedTime: '12:00pm',
        },
      ]);
      expect(byId[trExpense].transferRecord).toStrictEqual({
        transferId: UNUSED_ID,
        account: a.account2._id,
      });

      // B listing A's account string sees only B's own record, never A's.
      const rb = await list(b, acc).expect(200);
      expect(rb.body.message).toBe('No expenses found.');
      expect(ids(rb.body)).toEqual([bsOwn]);
      // B listing A's other account (A has a record there) → empty.
      expect((await list(b, a.account2._id).expect(200)).body).toStrictEqual(
        noRecords,
      );
    });

    it('the three other messages, and bad month/year → the empty answer', async () => {
      const a = await setup();
      const cat = a.category._id;
      const onlyIncome = await seedIncome({
        userId: a.sub,
        account: a.account._id,
        category: cat,
      });
      const onlyExpense = await seedExpense({
        userId: a.sub,
        account: a.account2._id,
        category: cat,
      });
      const r1 = await list(a, a.account._id).expect(200);
      expect(r1.body.message).toBe('No expenses found.');
      expect(ids(r1.body)).toEqual([onlyIncome]);
      const r2 = await list(a, a.account2._id).expect(200);
      expect(r2.body.message).toBe('No incomes found.');
      expect(ids(r2.body)).toEqual([onlyExpense]);
      expect(
        (await list(a, a.account._id, 'Mar').expect(200)).body,
      ).toStrictEqual(noRecords);
      expect((await list(a, 'not-an-id').expect(200)).body).toStrictEqual(
        noRecords,
      );
      for (const [m, y] of [
        ['feb', '2025'],
        ['February', '2025'],
        ['13', '2025'],
        ['Feb', '25'],
      ]) {
        expect(
          (await list(a, a.account._id, m, y).expect(200)).body,
        ).toStrictEqual(noRecords);
      }
    });
  });

  describe('POST /records/transfer', () => {
    // A with two own unpaid expenses, B with one.
    const withExpenses = async () => {
      const s = await setup();
      const b = await setup();
      const e = {
        userId: s.sub,
        account: s.account._id,
        category: s.category._id,
      };
      const e1 = await seedExpense(e);
      const e2 = await seedExpense(e);
      const eb = await seedExpense({
        userId: b.sub,
        account: b.account._id,
        category: b.category._id,
      });
      return { s, b, e1, e2, eb };
    };

    it("201 with old-next's body: both sides cross-linked, balances moved, A's expenses paid", async () => {
      const { s, e1, e2, eb } = await withExpenses();
      const res = await transfer(
        s,
        transferBody(s, {
          income: {
            expensesPaid: [await expenseObject(e1), e2, eb, UNUSED_ID],
          },
        }),
      ).expect(201);
      expect(Array.isArray(res.body.message)).toBe(true);
      const { expense, income } = res.body.data as {
        expense: Doc;
        income: Doc;
      };
      const common = {
        userId: s.sub,
        typeOfRecord: 'transfer',
        shortName: 'Move',
        amount: 200,
        amountFormatted: '$200.00',
        date: STORED_DATE,
        fullDate: 'Lun, 3 Feb, 2025',
        formattedTime: '14:05pm',
        category: s.category._id,
      };
      expect(expense).toMatchObject({
        ...common,
        account: s.account._id,
        isPaid: true,
        linkedBudgets: [],
        transferRecord: { transferId: income._id, account: s.account2._id },
      });
      expect(income).toMatchObject({
        ...common,
        account: s.account2._id,
        expensesPaid: [e1, e2],
        transferRecord: { transferId: expense._id, account: s.account._id },
      });
      expect(expense).not.toHaveProperty('expensesPaid');
      expect(income).not.toHaveProperty('isPaid');
      expect(await balance(s.account._id)).toBe(800);
      expect(await balance(s.account2._id)).toBe(700);
      expect([await isPaid(e1), await isPaid(e2), await isPaid(eb)]).toEqual([
        true,
        true,
        false,
      ]);
      // Stored as returned.
      expect(
        json(await incomeModel.findById(income._id).lean().exec()),
      ).toMatchObject({ expensesPaid: [e1, e2] });
    });

    it.each([
      [
        'a non-transfer type',
        { expense: { typeOfRecord: 'expense' } },
        'Invalid type of record',
      ],
      [
        'an unpaid expense',
        { expense: { isPaid: false } },
        'The expense transfer record must have value isPaid as true',
      ],
      [
        'linked budgets',
        { expense: { linkedBudgets: [UNUSED_ID] } },
        'The expense transfer record cannot have linked budgets',
      ],
      [
        'the same account',
        { income: { account: 'SAME' } },
        'Income account and expense account must be different',
      ],
      [
        'a different short name',
        { income: { shortName: 'Other' } },
        mismatch('short name'),
      ],
      ['different amounts', { income: { amount: 201 } }, mismatch('amounts')],
      [
        'dates 1 ms apart',
        { income: { date: '2025-02-03T20:05:30.124Z' } },
        mismatch('dates'),
      ],
      [
        'a different category',
        { income: { category: UNUSED_ID } },
        mismatch('category'),
      ],
      [
        'a different subCategory',
        { income: { subCategory: 'Other' } },
        mismatch('subCategory'),
      ],
      [
        'a malformed expensesPaid element',
        { income: { expensesPaid: [{ _id: { $ne: null } }] } },
        INVALID_EXPENSES_PAID,
      ],
    ])('400 on %s, nothing written', async (_, patch, message) => {
      const { s, e1, e2, eb } = await withExpenses();
      const before = await snapshot(s, [e1, e2, eb]);
      const p = patch as { expense?: Doc; income?: Doc };
      if (p.income?.account === 'SAME') p.income.account = s.account._id;
      const res = await transfer(
        s,
        transferBody(s, {
          expense: p.expense,
          income: { expensesPaid: [e1], ...p.income },
        }),
      ).expect(400);
      expect(res.body).toStrictEqual(badRequest(message));
      expect(await snapshot(s, [e1, e2, eb])).toStrictEqual(before);
    });

    it('400 on isPaid in the income (nested whitelist), nothing written', async () => {
      const { s, e1, e2, eb } = await withExpenses();
      const before = await snapshot(s, [e1, e2, eb]);
      const res = await transfer(
        s,
        transferBody(s, { income: { isPaid: true, expensesPaid: [e1] } }),
      ).expect(400);
      expect(res.body.error.message).toEqual([
        'income.property isPaid should not exist',
      ]);
      expect(await snapshot(s, [e1, e2, eb])).toStrictEqual(before);
    });

    it.each([
      ["B's category", 'category', 'Category not found'],
      ['a missing expense account', 'missing', 'Account not found'],
      [
        "B's account as destination",
        'foreign',
        'Account does not belong to the user',
      ],
    ])(
      '400 on %s with the same text, nothing written',
      async (_, kind, message) => {
        const { s, b, e1, e2, eb } = await withExpenses();
        const before = await snapshot(s, [e1, e2, eb]);
        const patch =
          kind === 'category'
            ? {
                expense: { category: b.category._id },
                income: { category: b.category._id },
              }
            : kind === 'missing'
              ? { expense: { account: UNUSED_ID } }
              : { income: { account: b.account._id } };
        const body = transferBody(s, patch);
        body.income.expensesPaid = [e1];
        const res = await transfer(s, body).expect(400);
        expect(res.body).toStrictEqual(badRequest(message));
        expect(await snapshot(s, [e1, e2, eb])).toStrictEqual(before);
        expect(await balance(b.account._id)).toBe(1000);
      },
    );

    it('atomic: a failing incrementBalance on the income account → 500, nothing written', async () => {
      const { s, e1, e2, eb } = await withExpenses();
      const before = await snapshot(s, [e1, e2, eb]);
      const accounts = app.get(AccountService, { strict: false });
      const real = accounts.incrementBalance.bind(accounts);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      vi.spyOn(accounts, 'incrementBalance').mockImplementation((args) =>
        args.accountId === s.account2._id
          ? Promise.reject(new Error('boom'))
          : real(args),
      );
      const res = await transfer(
        s,
        transferBody(s, { income: { expensesPaid: [e1] } }),
      ).expect(500);
      expect(res.body).toStrictEqual(internalError);
      expect(await snapshot(s, [e1, e2, eb])).toStrictEqual(before);
    });
  });

  describe("D9: old-next's edit and delete flows on a transfer", () => {
    // A transfer of 200 from account (1000) to account2 (500) that pays E1.
    const withTransfer = async () => {
      const s = await setup();
      const e1 = await seedExpense({
        userId: s.sub,
        account: s.account._id,
        category: s.category._id,
      });
      const res = await transfer(
        s,
        transferBody(s, {
          income: { expensesPaid: [await expenseObject(e1)] },
        }),
      ).expect(201);
      const { expense, income } = res.body.data as {
        expense: Doc;
        income: Doc;
      };
      expect(await balance(s.account._id)).toBe(800);
      expect(await balance(s.account2._id)).toBe(700);
      return { s, e1, expense, income };
    };
    // useEditTransfer: the expense PUT, then the income PUT; no transferRecord in either body.
    const edit = async ({
      s,
      e1,
      expenseId,
      incomeId,
      amount,
    }: {
      s: Setup;
      e1: string;
      expenseId: string;
      incomeId: string;
      amount: number;
    }) => {
      const common = {
        amount,
        budgets: [],
        category: s.category._id,
        date: STORED_DATE,
        description: '',
        indebtedPeople: [],
        shortName: 'Move',
        subCategory: 'Sub',
        tag: [],
        typeOfRecord: 'transfer',
      };
      await http()
        .put('/expenses-actions')
        .set(s.auth)
        .send({
          ...common,
          recordId: expenseId,
          account: s.account._id,
          isPaid: true,
          linkedBudgets: [],
        })
        .expect(200);
      await http()
        .put('/incomes-actions')
        .set(s.auth)
        .send({
          ...common,
          recordId: incomeId,
          account: s.account2._id,
          expensesPaid: [await expenseObject(e1)],
        })
        .expect(200);
    };
    const del = (s: Setup, expenseId: string, incomeId: string) =>
      Promise.all([
        http()
          .delete('/expenses-actions')
          .set(s.auth)
          .send({ recordId: expenseId }),
        http()
          .delete('/incomes-actions')
          .set(s.auth)
          .send({ recordId: incomeId }),
      ]);
    const listed = async (s: Setup) => [
      ids((await list(s, s.account._id).expect(200)).body),
      ids((await list(s, s.account2._id).expect(200)).body),
    ];
    const assertEdited = async (
      s: Setup,
      e1: string,
      expense: Doc,
      income: Doc,
    ) => {
      expect(await balance(s.account._id)).toBe(750);
      expect(await balance(s.account2._id)).toBe(750);
      expect(await isPaid(e1)).toBe(true);
      const e = json(await expenseModel.findById(expense._id).lean().exec());
      const i = json(await incomeModel.findById(income._id).lean().exec());
      expect(e).toMatchObject({
        typeOfRecord: 'transfer',
        amount: 250,
        transferRecord: expense.transferRecord,
      });
      expect(i).toMatchObject({
        typeOfRecord: 'transfer',
        amount: 250,
        expensesPaid: [e1],
        transferRecord: income.transferRecord,
      });
      return { e, i };
    };

    it('edit from the expense side: both balances move by the difference; a repeat changes nothing', async () => {
      const { s, e1, expense, income } = await withTransfer();
      const target = {
        s,
        e1,
        expenseId: expense._id,
        // The opened record's transferRecord gives the other side.
        incomeId: (expense.transferRecord as Doc).transferId as string,
        amount: 250,
      };
      await edit(target);
      const first = await assertEdited(s, e1, expense, income);
      expect(await listed(s)).toEqual([[e1, expense._id], [income._id]]);
      await edit(target);
      expect(await assertEdited(s, e1, expense, income)).toStrictEqual(first);
    });

    it('edit from the income side: same result', async () => {
      const { s, e1, expense, income } = await withTransfer();
      const target = {
        s,
        e1,
        expenseId: (income.transferRecord as Doc).transferId as string,
        incomeId: income._id,
        amount: 250,
      };
      await edit(target);
      const first = await assertEdited(s, e1, expense, income);
      await edit(target);
      expect(await assertEdited(s, e1, expense, income)).toStrictEqual(first);
      expect(await listed(s)).toEqual([[e1, expense._id], [income._id]]);
    });

    it('parallel deletes restore both balances and unpay E1; a repeat → 404/404, nothing changes', async () => {
      const { s, e1, expense, income } = await withTransfer();
      expect(await listed(s)).toEqual([[e1, expense._id], [income._id]]);
      const [re, ri] = await del(s, expense._id, income._id);
      expect(re.status).toBe(200);
      expect(ri.status).toBe(200);
      expect(await balance(s.account._id)).toBe(1000);
      expect(await balance(s.account2._id)).toBe(500);
      expect(await isPaid(e1)).toBe(false);
      expect(await expenseModel.exists({ _id: expense._id }).exec()).toBeNull();
      expect(await incomeModel.exists({ _id: income._id }).exec()).toBeNull();
      expect(await listed(s)).toEqual([[e1], []]);

      const [re2, ri2] = await del(s, expense._id, income._id);
      expect(re2.status).toBe(404);
      expect(re2.body).toStrictEqual(notFound('Expense not found.'));
      expect(ri2.status).toBe(404);
      expect(ri2.body).toStrictEqual(notFound('Income not found.'));
      expect(await balance(s.account._id)).toBe(1000);
      expect(await balance(s.account2._id)).toBe(500);
      expect(await isPaid(e1)).toBe(false);
    });
  });
});
