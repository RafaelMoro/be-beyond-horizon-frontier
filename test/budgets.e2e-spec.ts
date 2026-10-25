import { INestApplication, Logger } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import {
  type ClientSession,
  type Connection,
  type Model,
  Types,
} from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { BUDGET_EXPENSES_UNLINK } from '../src/budget/budget.constants.js';
import type { BudgetExpensesUnlink } from '../src/budget/budget.interface.js';
import { BudgetHistory } from '../src/budget/entities/budget-history.entity.js';
import { Budget } from '../src/budget/entities/budget.entity.js';
import { BudgetHistoryService } from '../src/budget/services/budget-history.service.js';
import { BudgetService } from '../src/budget/services/budget.service.js';
import { INITIAL_RESPONSE } from '../src/constants.js';
import { closeTestApp, createTestApp } from './create-test-app.js';

const PASSWORD = 'e2e-password';
const UNUSED_ID = '000000000000000000000000';
const BUDGET_NOT_FOUND = 'Budget not found';
const HISTORY_NOT_FOUND = 'Budget history not found';
let seq = 0;
const uniqueEmail = () => `e2e-bud-${Date.now()}-${seq++}@example.invalid`;
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
const notFound = (message: string) => ({
  ...INITIAL_RESPONSE,
  success: false,
  error: { message, error: 'Not Found', statusCode: 404 },
});
const internalError = {
  ...INITIAL_RESPONSE,
  success: false,
  error: { statusCode: 500, message: 'Internal server error' },
};
// FE_Budget_Master's create shape: all 11 fields, nextResetDate = endDate, previousPeriods [].
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
const recordBody = {
  recordId: 'expense-1',
  recordName: 'Lunch',
  recordDate: '2026-01-02T12:00:00.000Z',
  recordAmount: 10,
  budgetCurrentAmount: 0,
  budgetUpdatedAmount: 10,
};
type Doc = Record<string, unknown> & { _id: string };

describe('Budgets and budget history (e2e)', () => {
  let app: INestApplication<App>;
  let budgetModel: Model<Budget>;
  let historyModel: Model<BudgetHistory>;
  let connection: Connection;
  const http = () => request(app.getHttpServer());

  // Same signup + login as accounts.e2e-spec.ts; the token is the cookie value, sent as Bearer.
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
  const createBudget = async (
    auth: Record<string, string>,
    body: object = budgetBody,
  ) =>
    (await http().post('/budgets').set(auth).send(body).expect(201)).body
      .data as { budget: Doc; budgetHistory: Doc };
  const leanBudget = (id: string) => budgetModel.findById(id).lean().exec();
  const leanHistory = (id: string) => historyModel.findById(id).lean().exec();
  const unlinkPort = () =>
    app.get<BudgetExpensesUnlink>(BUDGET_EXPENSES_UNLINK, { strict: false });

  beforeAll(async () => {
    app = await createTestApp();
    budgetModel = app.get<Model<Budget>>(getModelToken(Budget.name));
    historyModel = app.get<Model<BudgetHistory>>(
      getModelToken(BudgetHistory.name),
    );
    connection = app.get<Connection>(getConnectionToken());
    // Collection + index creation (the unique { budget, sub }) must not race the first transaction.
    await budgetModel.init();
    await historyModel.init();
  });

  afterAll(async () => {
    if (app) await closeTestApp(app);
  });

  afterEach(() => vi.restoreAllMocks());

  it('401 without a token on all 12 routes', async () => {
    const routes = [
      ['post', '/budgets'],
      ['get', '/budgets'],
      ['get', `/budgets/${UNUSED_ID}`],
      ['put', '/budgets'],
      ['delete', '/budgets'],
      ['post', '/budget-history'],
      ['post', '/budget-history/add-record'],
      ['post', '/budget-history/delete-record'],
      ['get', '/budget-history'],
      ['get', `/budget-history/${UNUSED_ID}`],
      ['put', '/budget-history'],
      ['delete', '/budget-history'],
    ] as const;
    for (const [method, path] of routes) {
      const res = await http()[method](path).expect(401);
      expect(res.body).toStrictEqual(unauthorized);
    }
  });

  it('history `budget` path is an ObjectId (not Mixed, legacy bug)', () => {
    expect(historyModel.schema.path('budget').instance).toBe('ObjectId');
  });

  describe('POST /budgets', () => {
    it('201 with budget + its empty history, history.budget an ObjectId in the DB', async () => {
      const { sub, auth } = await signupAndLogin();
      const res = await http()
        .post('/budgets')
        .set(auth)
        .send(budgetBody)
        .expect(201);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'New budget created',
        data: {
          budget: { _id: expect.any(String), ...budgetBody, sub, __v: 0 },
          budgetHistory: {
            _id: expect.any(String),
            budget: res.body.data.budget._id,
            sub,
            records: [],
            __v: 0,
          },
        },
      });
      const raw = await historyModel.collection.findOne({
        _id: new Types.ObjectId(res.body.data.budgetHistory._id as string),
      });
      expect(raw?.budget).toBeInstanceOf(Types.ObjectId);
    });

    it('400 for a missing limit or a bad date, no doc in either collection', async () => {
      const { sub, auth } = await signupAndLogin();
      const { limit: _l, ...noLimit } = budgetBody;
      const res = await http()
        .post('/budgets')
        .set(auth)
        .send(noLimit)
        .expect(400);
      expect(res.body).toStrictEqual(
        badRequest([
          'limit should not be empty',
          'limit must be a number conforming to the specified constraints',
        ]),
      );
      const date = await http()
        .post('/budgets')
        .set(auth)
        .send({ ...budgetBody, nextResetDate: 'not-a-date' })
        .expect(400);
      expect(date.body).toStrictEqual(
        badRequest(['nextResetDate must be a Date instance']),
      );
      expect(await budgetModel.countDocuments({ sub })).toBe(0);
      expect(await historyModel.countDocuments({ sub })).toBe(0);
    });

    it('atomic: a failing history create leaves no budget', async () => {
      const { sub, auth } = await signupAndLogin();
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      vi.spyOn(historyModel, 'create').mockRejectedValueOnce(new Error('boom'));
      const res = await http()
        .post('/budgets')
        .set(auth)
        .send(budgetBody)
        .expect(500);
      expect(res.body).toStrictEqual(internalError);
      expect(await budgetModel.countDocuments({ sub })).toBe(0);
      expect(await historyModel.countDocuments({ sub })).toBe(0);
    });
  });

  describe('GET /budgets, GET /budgets/:budgetId', () => {
    it('fresh user → 200 Budgets not found, data null', async () => {
      const { auth } = await signupAndLogin();
      const res = await http().get('/budgets').set(auth).expect(200);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Budgets not found',
      });
    });

    it('lists own docs without sub; other user sees none', async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const { budget } = await createBudget(a.auth);
      const { sub: _s, ...withoutSub } = budget;
      const list = await http().get('/budgets').set(a.auth).expect(200);
      expect(list.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { budgets: [withoutSub] },
      });
      const listB = await http().get('/budgets').set(b.auth).expect(200);
      expect(listB.body.data).toBeNull();
    });

    it('by id: own incl. sub; foreign/unused → 200 Budget not found; abc → 400', async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const { budget } = await createBudget(a.auth);
      const own = await http()
        .get(`/budgets/${budget._id}`)
        .set(a.auth)
        .expect(200);
      expect(own.body).toStrictEqual({ ...INITIAL_RESPONSE, data: { budget } });
      for (const [auth, id] of [
        [b.auth, budget._id],
        [a.auth, UNUSED_ID],
      ] as const) {
        const res = await http().get(`/budgets/${id}`).set(auth).expect(200);
        expect(res.body).toStrictEqual({
          ...INITIAL_RESPONSE,
          message: BUDGET_NOT_FOUND,
        });
      }
      const bad = await http().get('/budgets/abc').set(a.auth).expect(400);
      expect(bad.body).toStrictEqual(badRequest('Invalid _id'));
    });

    it('D8: an old doc with nestResetDate surfaces it as nextResetDate, no previousPeriods key', async () => {
      const { sub, auth } = await signupAndLogin();
      const { previousPeriods: _p, nextResetDate: _n, ...old } = budgetBody;
      const nest = new Date('2024-08-15T00:00:00.000Z');
      const { insertedId } = await budgetModel.collection.insertOne({
        ...old,
        startDate: new Date(old.startDate),
        endDate: new Date(old.endDate),
        nestResetDate: nest,
        sub,
        __v: 0,
      });
      const res = await http()
        .get(`/budgets/${insertedId.toString()}`)
        .set(auth)
        .expect(200);
      expect(res.body.data.budget.nextResetDate).toBe(nest.toISOString());
      expect(res.body.data.budget.nestResetDate).toBe(nest.toISOString());
      expect(res.body.data.budget).not.toHaveProperty('previousPeriods');

      const both = await budgetModel.collection.insertOne({
        ...old,
        nestResetDate: nest,
        nextResetDate: new Date(budgetBody.nextResetDate),
        sub,
      });
      const res2 = await http()
        .get(`/budgets/${both.insertedId.toString()}`)
        .set(auth)
        .expect(200);
      expect(res2.body.data.budget.nextResetDate).toBe(
        budgetBody.nextResetDate,
      );

      // Populated budget in a history GET gets the same fallback.
      const history = await historyModel.collection.insertOne({
        budget: insertedId,
        sub,
        records: [],
        __v: 0,
      });
      const h = await http()
        .get(`/budget-history/${history.insertedId.toString()}`)
        .set(auth)
        .expect(200);
      expect(h.body.data.budgetHistory.budget.nextResetDate).toBe(
        nest.toISOString(),
      );
    });
  });

  describe('PUT /budgets', () => {
    it('owner: 200 Budget history updated with name, currentAmount 0 and nextResetDate', async () => {
      const { auth } = await signupAndLogin();
      const { budget } = await createBudget(auth, {
        ...budgetBody,
        currentAmount: 40,
      });
      const res = await http()
        .put('/budgets')
        .set(auth)
        .send({
          budgetId: budget._id,
          name: 'Renamed',
          currentAmount: 0,
          nextResetDate: '2026-02-28T00:00:00.000Z',
        })
        .expect(200);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Budget history updated',
        data: {
          budget: {
            ...budget,
            name: 'Renamed',
            currentAmount: 0,
            nextResetDate: '2026-02-28T00:00:00.000Z',
          },
        },
      });
    });

    it('FE edit shape without previousPeriods keeps the array; only budgetId → unchanged', async () => {
      const { auth } = await signupAndLogin();
      const { budget } = await createBudget(auth, {
        ...budgetBody,
        previousPeriods: ['01:12:2025 | 31:12:2025'],
      });
      const { previousPeriods: _p, ...form } = budgetBody;
      const res = await http()
        .put('/budgets')
        .set(auth)
        .send({ ...form, limit: 700, budgetId: budget._id })
        .expect(200);
      expect(res.body.data.budget.previousPeriods).toStrictEqual([
        '01:12:2025 | 31:12:2025',
      ]);
      expect(res.body.data.budget.limit).toBe(700);
      const only = await http()
        .put('/budgets')
        .set(auth)
        .send({ budgetId: budget._id })
        .expect(200);
      expect(only.body.data.budget).toStrictEqual({
        ...res.body.data.budget,
      });
    });

    it('PUT nextResetDate on an old doc writes it, nestResetDate untouched', async () => {
      const { sub, auth } = await signupAndLogin();
      const nest = new Date('2024-08-15T00:00:00.000Z');
      const { insertedId } = await budgetModel.collection.insertOne({
        name: 'Old',
        typeBudget: 'one-time',
        startDate: new Date('2024-07-25'),
        endDate: new Date('2024-08-15'),
        currentAmount: 0,
        limit: 100,
        nestResetDate: nest,
        sub,
        __v: 0,
      });
      await http()
        .put('/budgets')
        .set(auth)
        .send({
          budgetId: insertedId.toString(),
          nextResetDate: '2026-03-01T00:00:00.000Z',
        })
        .expect(200);
      const stored = await leanBudget(insertedId.toString());
      expect(stored?.nextResetDate).toStrictEqual(
        new Date('2026-03-01T00:00:00.000Z'),
      );
      expect(stored?.nestResetDate).toStrictEqual(nest);
    });

    it('400 for sub in the body and a non-ObjectId budgetId', async () => {
      const { auth } = await signupAndLogin();
      const { budget } = await createBudget(auth);
      const extra = await http()
        .put('/budgets')
        .set(auth)
        .send({ budgetId: budget._id, sub: 'x' })
        .expect(400);
      expect(extra.body).toStrictEqual(
        badRequest(['property sub should not exist']),
      );
      const bad = await http()
        .put('/budgets')
        .set(auth)
        .send({ budgetId: 'abc' })
        .expect(400);
      expect(bad.body).toStrictEqual(
        badRequest(['budgetId must be a mongodb id']),
      );
    });
  });

  describe('PUT / DELETE /budgets across users and unused ids', () => {
    it("never writes another user's budget or history", async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const { budget, budgetHistory } = await createBudget(a.auth);
      const before = [
        await leanBudget(budget._id),
        await leanHistory(budgetHistory._id),
      ];
      const put = await http()
        .put('/budgets')
        .set(b.auth)
        .send({ budgetId: budget._id, name: 'Hacked' })
        .expect(404);
      expect(put.body).toStrictEqual(notFound(BUDGET_NOT_FOUND));
      const del = await http()
        .delete('/budgets')
        .set(b.auth)
        .send({ budgetId: budget._id })
        .expect(404);
      expect(del.body).toStrictEqual(notFound(BUDGET_NOT_FOUND));
      expect([
        await leanBudget(budget._id),
        await leanHistory(budgetHistory._id),
      ]).toStrictEqual(before);
    });

    it('404 Budget not found for an unused id on both', async () => {
      const { auth } = await signupAndLogin();
      for (const method of ['put', 'delete'] as const) {
        const res = await http()
          [method]('/budgets')
          .set(auth)
          .send({ budgetId: UNUSED_ID })
          .expect(404);
        expect(res.body).toStrictEqual(notFound(BUDGET_NOT_FOUND));
      }
    });
  });

  describe('DELETE /budgets (owner)', () => {
    it('200 with budget + history, both gone; port ran in the transaction', async () => {
      const { sub, auth } = await signupAndLogin();
      const { budget, budgetHistory } = await createBudget(auth);
      let inTransaction: boolean | undefined;
      const spy = vi
        .spyOn(unlinkPort(), 'unlinkBudget')
        .mockImplementation(({ session }) => {
          inTransaction = session.inTransaction();
          return Promise.resolve();
        });
      const res = await http()
        .delete('/budgets')
        .set(auth)
        .send({ budgetId: budget._id })
        .expect(200);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Budget deleted',
        data: { budget, budgetHistoryDeleted: budgetHistory },
      });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ budgetId: budget._id, sub }),
      );
      expect(inTransaction).toBe(true);
      expect(await budgetModel.countDocuments({ sub })).toBe(0);
      expect(await historyModel.countDocuments({ sub })).toBe(0);
    });

    it('500 and nothing deleted when the port rejects', async () => {
      const { auth } = await signupAndLogin();
      const { budget, budgetHistory } = await createBudget(auth);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      vi.spyOn(unlinkPort(), 'unlinkBudget').mockRejectedValueOnce(
        new Error('boom'),
      );
      const res = await http()
        .delete('/budgets')
        .set(auth)
        .send({ budgetId: budget._id })
        .expect(500);
      expect(res.body).toStrictEqual(internalError);
      expect(await leanBudget(budget._id)).not.toBeNull();
      expect(await leanHistory(budgetHistory._id)).not.toBeNull();
    });

    it('500 and the budget survives when the history delete rejects', async () => {
      const { auth } = await signupAndLogin();
      const { budget } = await createBudget(auth);
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      vi.spyOn(historyModel, 'findOneAndDelete').mockImplementationOnce(() => {
        throw new Error('boom');
      });
      await http()
        .delete('/budgets')
        .set(auth)
        .send({ budgetId: budget._id })
        .expect(500);
      expect(await leanBudget(budget._id)).not.toBeNull();
    });

    it('Q6: history missing → 404 history text, but budget deleted and port ran; again → 404 budget', async () => {
      const { sub, auth } = await signupAndLogin();
      const { budget } = await createBudget(auth);
      await historyModel.deleteOne({ budget: budget._id });
      const spy = vi.spyOn(unlinkPort(), 'unlinkBudget');
      const res = await http()
        .delete('/budgets')
        .set(auth)
        .send({ budgetId: budget._id })
        .expect(404);
      expect(res.body).toStrictEqual(notFound(HISTORY_NOT_FOUND));
      expect(await budgetModel.countDocuments({ sub })).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
      const again = await http()
        .delete('/budgets')
        .set(auth)
        .send({ budgetId: budget._id })
        .expect(404);
      expect(again.body).toStrictEqual(notFound(BUDGET_NOT_FOUND));
    });
  });

  describe('POST /budget-history', () => {
    it('201 for an own budget without a history; duplicate → 409', async () => {
      const { sub, auth } = await signupAndLogin();
      const { budget, budgetHistory } = await createBudget(auth);
      await http()
        .delete('/budget-history')
        .set(auth)
        .send({ budgetHistoryId: budgetHistory._id })
        .expect(200);
      const res = await http()
        .post('/budget-history')
        .set(auth)
        .send({ budget: budget._id, records: [recordBody] })
        .expect(201);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'New budget history created',
        data: {
          budgetHistory: {
            _id: expect.any(String),
            budget: budget._id,
            sub,
            records: [{ ...recordBody, _id: expect.any(String) }],
            __v: 0,
          },
        },
      });
      const dup = await http()
        .post('/budget-history')
        .set(auth)
        .send({ budget: budget._id, records: [] })
        .expect(409);
      expect(dup.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        success: false,
        error: {
          message: 'Duplicate value',
          error: 'Conflict',
          statusCode: 409,
        },
      });
    });

    it('404 Budget not found for foreign / unused / abc budget, nothing written', async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const { budget } = await createBudget(a.auth);
      const before = await historyModel.countDocuments();
      for (const id of [budget._id, UNUSED_ID, 'abc']) {
        const res = await http()
          .post('/budget-history')
          .set(b.auth)
          .send({ budget: id, records: [] })
          .expect(404);
        expect(res.body).toStrictEqual(notFound(BUDGET_NOT_FOUND));
      }
      expect(await historyModel.countDocuments()).toBe(before);
    });
  });

  describe('add-record / delete-record', () => {
    it('adds, removes by recordId, unknown id → unchanged', async () => {
      const { auth } = await signupAndLogin();
      const { budget, budgetHistory } = await createBudget(auth);
      const recordId = new Types.ObjectId().toString();
      const add = await http()
        .post('/budget-history/add-record')
        .set(auth)
        .send({ budgetId: budget._id, record: { ...recordBody, recordId } })
        .expect(201);
      expect(add.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Record added to budget history',
        data: {
          budgetHistory: {
            ...budgetHistory,
            records: [{ ...recordBody, recordId, _id: expect.any(String) }],
          },
        },
      });
      const unknown = await http()
        .post('/budget-history/delete-record')
        .set(auth)
        .send({ budgetId: budget._id, record: UNUSED_ID })
        .expect(201);
      expect(unknown.body.data.budgetHistory).toStrictEqual(
        add.body.data.budgetHistory,
      );
      const del = await http()
        .post('/budget-history/delete-record')
        .set(auth)
        .send({ budgetId: budget._id, record: recordId })
        .expect(201);
      expect(del.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Record removed from budget history',
        data: { budgetHistory },
      });
    });

    it('add-record without record → 400, no write', async () => {
      const { auth } = await signupAndLogin();
      const { budget, budgetHistory } = await createBudget(auth);
      const res = await http()
        .post('/budget-history/add-record')
        .set(auth)
        .send({ budgetId: budget._id })
        .expect(400);
      expect(res.body).toStrictEqual(
        badRequest(['record should not be null or undefined']),
      );
      expect((await leanHistory(budgetHistory._id))?.records).toStrictEqual([]);
    });

    it("other user on A's budget → 400 history text, A unchanged", async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const { budget, budgetHistory } = await createBudget(a.auth);
      const add = await http()
        .post('/budget-history/add-record')
        .set(b.auth)
        .send({ budgetId: budget._id, record: recordBody })
        .expect(400);
      expect(add.body).toStrictEqual(badRequest(HISTORY_NOT_FOUND));
      const del = await http()
        .post('/budget-history/delete-record')
        .set(b.auth)
        .send({ budgetId: budget._id, record: UNUSED_ID })
        .expect(400);
      expect(del.body).toStrictEqual(badRequest(HISTORY_NOT_FOUND));
      expect((await leanHistory(budgetHistory._id))?.records).toStrictEqual([]);
    });
  });

  describe('GET /budget-history, GET /budget-history/:id (D13)', () => {
    it('fresh user → 404', async () => {
      const { auth } = await signupAndLogin();
      const res = await http().get('/budget-history').set(auth).expect(404);
      expect(res.body).toStrictEqual(notFound(HISTORY_NOT_FOUND));
    });

    it('lists own with populated budget and no sub', async () => {
      const a = await signupAndLogin();
      await signupAndLogin().then((b) => createBudget(b.auth));
      const { budget, budgetHistory } = await createBudget(a.auth);
      const { sub: _s, ...withoutSub } = budgetHistory;
      const res = await http().get('/budget-history').set(a.auth).expect(200);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { budgetsHistory: [{ ...withoutSub, budget }] },
      });
    });

    it('by id: own → 200 populated; foreign → 404; abc → 400', async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const { budget, budgetHistory } = await createBudget(a.auth);
      const own = await http()
        .get(`/budget-history/${budgetHistory._id}`)
        .set(a.auth)
        .expect(200);
      expect(own.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { budgetHistory: { ...budgetHistory, budget } },
      });
      const foreign = await http()
        .get(`/budget-history/${budgetHistory._id}`)
        .set(b.auth)
        .expect(404);
      expect(foreign.body).toStrictEqual(notFound(HISTORY_NOT_FOUND));
      const bad = await http()
        .get('/budget-history/abc')
        .set(a.auth)
        .expect(400);
      expect(bad.body).toStrictEqual(badRequest('Invalid _id'));
    });

    it('a history whose budget was deleted raw → populated budget null', async () => {
      const { auth } = await signupAndLogin();
      const { budget, budgetHistory } = await createBudget(auth);
      await budgetModel.deleteOne({ _id: budget._id });
      const res = await http()
        .get(`/budget-history/${budgetHistory._id}`)
        .set(auth)
        .expect(200);
      expect(res.body.data.budgetHistory.budget).toBeNull();
    });
  });

  describe('PUT / DELETE /budget-history', () => {
    it('PUT replaces records and ignores budget; only id → unchanged', async () => {
      const { auth } = await signupAndLogin();
      const { budgetHistory } = await createBudget(auth);
      const res = await http()
        .put('/budget-history')
        .set(auth)
        .send({
          budgetHistoryId: budgetHistory._id,
          budget: UNUSED_ID,
          records: [recordBody],
        })
        .expect(200);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Budget history updated',
        data: {
          budgetHistory: {
            ...budgetHistory,
            records: [{ ...recordBody, _id: expect.any(String) }],
          },
        },
      });
      const only = await http()
        .put('/budget-history')
        .set(auth)
        .send({ budgetHistoryId: budgetHistory._id })
        .expect(200);
      expect(only.body.data.budgetHistory).toStrictEqual(
        res.body.data.budgetHistory,
      );
    });

    it("other user's PUT / DELETE → 404, doc unchanged; owner DELETE → 200", async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const { budgetHistory } = await createBudget(a.auth);
      const before = await leanHistory(budgetHistory._id);
      for (const method of ['put', 'delete'] as const) {
        const res = await http()
          [method]('/budget-history')
          .set(b.auth)
          .send({ budgetHistoryId: budgetHistory._id })
          .expect(404);
        expect(res.body).toStrictEqual(notFound(HISTORY_NOT_FOUND));
      }
      expect(await leanHistory(budgetHistory._id)).toStrictEqual(before);
      const del = await http()
        .delete('/budget-history')
        .set(a.auth)
        .send({ budgetHistoryId: budgetHistory._id })
        .expect(200);
      expect(del.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Budget history deleted',
        data: { budgetHistory },
      });
      expect(await leanHistory(budgetHistory._id)).toBeNull();
    });
  });

  describe('S7 helpers', () => {
    const inTransaction = <T>(fn: (session: ClientSession) => Promise<T>) =>
      connection.transaction(fn);

    it('incrementBudgetAmount: owner-bound, returns both amounts, rolls back', async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const { budget } = await createBudget(a.auth, {
        ...budgetBody,
        currentAmount: 10,
      });
      const service = app.get(BudgetService);
      const amounts = await inTransaction((session) =>
        service.incrementBudgetAmount({
          budgetId: budget._id,
          sub: a.sub,
          delta: 12.5,
          session,
        }),
      );
      expect(amounts).toStrictEqual({
        budgetCurrentAmount: 10,
        budgetUpdatedAmount: 22.5,
      });
      expect((await leanBudget(budget._id))?.currentAmount).toBe(22.5);

      const foreign = await inTransaction((session) =>
        service.incrementBudgetAmount({
          budgetId: budget._id,
          sub: b.sub,
          delta: 1,
          session,
        }),
      );
      expect(foreign).toBeNull();
      expect((await leanBudget(budget._id))?.currentAmount).toBe(22.5);

      await expect(
        inTransaction(async (session) => {
          await service.incrementBudgetAmount({
            budgetId: budget._id,
            sub: a.sub,
            delta: 100,
            session,
          });
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      expect((await leanBudget(budget._id))?.currentAmount).toBe(22.5);
    });

    it('addHistoryRecord rolls back; other sub → 400', async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const { budget, budgetHistory } = await createBudget(a.auth);
      const service = app.get(BudgetHistoryService);
      const record = {
        ...recordBody,
        recordDate: new Date(recordBody.recordDate),
      };
      await expect(
        inTransaction(async (session) => {
          await service.addHistoryRecord({
            budgetId: budget._id,
            sub: a.sub,
            record,
            session,
          });
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      expect((await leanHistory(budgetHistory._id))?.records).toStrictEqual([]);
      await expect(
        service.addHistoryRecord({ budgetId: budget._id, sub: b.sub, record }),
      ).rejects.toThrow(HISTORY_NOT_FOUND);
      const added = await inTransaction((session) =>
        service.addHistoryRecord({
          budgetId: budget._id,
          sub: a.sub,
          record,
          session,
        }),
      );
      expect(added.records).toHaveLength(1);
      await inTransaction((session) =>
        service.removeHistoryRecord({
          budgetId: budget._id,
          sub: a.sub,
          recordId: record.recordId,
          session,
        }),
      );
      expect((await leanHistory(budgetHistory._id))?.records).toStrictEqual([]);
    });
  });
});
