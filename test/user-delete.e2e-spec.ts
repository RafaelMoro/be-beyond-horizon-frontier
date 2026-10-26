import { INestApplication, Logger } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Account } from '../src/account/entities/account.entity.js';
import { BudgetHistory } from '../src/budget/entities/budget-history.entity.js';
import { Budget } from '../src/budget/entities/budget.entity.js';
import { Category } from '../src/category/entities/category.entity.js';
import { INITIAL_RESPONSE } from '../src/constants.js';
import { Expense } from '../src/record/entities/expense.entity.js';
import { Income } from '../src/record/entities/income.entity.js';
import { User } from '../src/user/entities/user.entity.js';
import { closeTestApp, createTestApp } from './create-test-app.js';

const PASSWORD = 'e2e-password';
let seq = 0;
const uniqueEmail = () => `e2e-del-${Date.now()}-${seq++}@example.invalid`;

// Owned collections and their owner field (strings, like prod).
const OWNED = [
  ['categories', 'sub'],
  ['accounts', 'sub'],
  ['budgetmodels', 'sub'],
  ['budgethistorymodels', 'sub'],
  ['createexpenses', 'userId'],
  ['createincomes', 'userId'],
] as const;

describe('User delete cascade (e2e)', () => {
  let app: INestApplication<App>;
  let connection: Connection;
  let incomeModel: Model<Income>;
  const http = () => request(app.getHttpServer());

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
      .post('/auth')
      .send({ email, password: PASSWORD })
      .expect(201);
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0];
    const token = cookie.slice(cookie.indexOf('=') + 1, cookie.indexOf(';'));
    return {
      email,
      sub: res.body.data.userCreated.sub as string,
      auth: { Authorization: `Bearer ${token}` },
    };
  };

  // Legacy-shaped raw docs (minimal fields), plus the API-seeded default categories.
  const seed = async (sub: string) => {
    const col = (name: string) => connection.collection(name);
    // First: it refuses a user who already has categories.
    await http()
      .post('/categories/create-local-categories')
      .send({ sub })
      .expect(201);
    await col('categories').insertMany([
      { categoryName: 'Raw 1', sub },
      { categoryName: 'Raw 2', sub, subCategories: [] },
    ]);
    await col('accounts').insertOne({ title: 'Raw', amount: 1, sub });
    const budget = await col('budgetmodels').insertOne({ name: 'Raw', sub });
    await col('budgethistorymodels').insertOne({
      budget: budget.insertedId,
      sub,
      records: [],
    });
    await col('createexpenses').insertMany([
      { shortName: 'e1', amount: 1, userId: sub },
      { shortName: 'e2', userId: sub, linkedBudgets: [] },
    ]);
    await col('createincomes').insertOne({ shortName: 'i1', userId: sub });
  };

  const counts = async (sub: string) => ({
    users: await connection
      .collection('users')
      .countDocuments({ _id: new Types.ObjectId(sub) }),
    ...Object.fromEntries(
      await Promise.all(
        OWNED.map(async ([name, field]) => [
          name,
          await connection.collection(name).countDocuments({ [field]: sub }),
        ]),
      ),
    ),
  });
  const seeded = {
    users: 1,
    categories: 14,
    accounts: 1,
    budgetmodels: 1,
    budgethistorymodels: 1,
    createexpenses: 2,
    createincomes: 1,
  };
  const empty = Object.fromEntries(Object.keys(seeded).map((k) => [k, 0]));

  beforeAll(async () => {
    app = await createTestApp();
    connection = app.get<Connection>(getConnectionToken());
    incomeModel = app.get<Model<Income>>(getModelToken(Income.name));
    for (const name of [
      User.name,
      Category.name,
      Account.name,
      Budget.name,
      BudgetHistory.name,
      Expense.name,
      Income.name,
    ]) {
      await app.get<Model<unknown>>(getModelToken(name)).init();
    }
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rolls back, then deletes the user and everything they own; other users untouched', async () => {
    const a = await signupAndLogin();
    const b = await signupAndLogin();
    await seed(a.sub);
    await seed(b.sub);
    expect(await counts(a.sub)).toStrictEqual(seeded);

    // Atomicity: the last op really deletes with the session, then throws → everything rolls back.
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const original = incomeModel.deleteMany.bind(incomeModel);
    vi.spyOn(incomeModel, 'deleteMany').mockImplementationOnce(((
      filter: object,
      opts: object,
    ) => ({
      exec: async () => {
        await original(filter, opts).exec();
        throw new Error('boom');
      },
    })) as never);
    const failed = await http().delete('/users').set(a.auth).expect(500);
    expect(failed.body).toStrictEqual({
      ...INITIAL_RESPONSE,
      success: false,
      error: { statusCode: 500, message: 'Internal server error' },
    });
    expect(incomeModel.deleteMany).toHaveBeenCalledTimes(1);
    expect(await counts(a.sub)).toStrictEqual(seeded);
    vi.restoreAllMocks();

    const res = await http().delete('/users').set(a.auth).expect(200);
    expect(res.body).toStrictEqual({
      ...INITIAL_RESPONSE,
      message: 'User deleted.',
      data: {
        userDeleted: { email: a.email, firstName: 'First', lastName: 'Last' },
      },
    });
    expect(await counts(a.sub)).toStrictEqual(empty);
    expect(await counts(b.sub)).toStrictEqual(seeded);

    await http().delete('/users').set(a.auth).expect(401);
    const login = await http()
      .post('/auth')
      .send({ email: a.email, password: PASSWORD })
      .expect(401);
    expect(login.body.error.message).toBe('Email or Password incorrect.');

    // B still works and still sees its docs.
    const b2 = await http()
      .post('/auth')
      .send({ email: b.email, password: PASSWORD })
      .expect(201);
    expect(b2.headers['set-cookie']).toHaveLength(1);
    const cats = await http().get('/categories').set(b.auth).expect(200);
    expect(cats.body.data.categories).toHaveLength(14);
    const accs = await http().get('/account-actions').set(b.auth).expect(200);
    expect(accs.body.data.accounts).toHaveLength(1);
  });
});
