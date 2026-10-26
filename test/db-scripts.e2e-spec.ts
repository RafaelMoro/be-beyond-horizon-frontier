import type { INestApplicationContext } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Income } from '../src/record/entities/income.entity.js';
import { repairData } from '../src/scripts/data-repair.js';
import {
  createMissingIndexes,
  INDEXED_MODELS,
} from '../src/scripts/db-indexes.js';
import {
  assertApplyTarget,
  createScriptContext,
} from '../src/scripts/script-runner.js';
import { closeTestApp } from './create-test-app.js';
import { E2E_DB_NAME } from './setup-env.js';

const COLLECTIONS = [
  'users',
  'categories',
  'accounts',
  'budgetmodels',
  'budgethistorymodels',
  'createexpenses',
  'createincomes',
  'ratelimits',
];

describe('Operator scripts (e2e)', () => {
  let app: INestApplicationContext;
  let connection: Connection;
  let lines: string[];
  const log = (line: string) => lines.push(line);
  const col = (name: string) => connection.collection(name);

  beforeAll(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app = await createScriptContext();
    connection = app.get<Connection>(getConnectionToken());
    // Under NODE_ENV=test autoIndex builds every schema index; drop them to look like prod.
    for (const name of INDEXED_MODELS) {
      await app.get<Model<unknown>>(getModelToken(name)).init();
    }
    for (const name of COLLECTIONS) await col(name).dropIndexes();
    await col('users').createIndex({ email: 1 }, { unique: true });
    await col('createexpenses').createIndex({ date: 1 });
    await col('createexpenses').createIndex({ userId: 1 });
    await col('categories').createIndex({ icon: 1 });
  });

  afterAll(async () => {
    await closeTestApp(app);
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    lines = [];
  });

  describe('db-indexes', () => {
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          COLLECTIONS.map(async (name) => [
            name,
            (await col(name).listIndexes().toArray())
              .map(({ name: n, key, unique, expireAfterSeconds }) => ({
                name: n,
                key,
                unique,
                expireAfterSeconds,
              }))
              .sort((a, b) => String(a.name).localeCompare(String(b.name))),
          ]),
        ),
      );
    const names = async (name: string) =>
      (await col(name).listIndexes().toArray()).map((i) => i.name);

    it('dry run lists the missing and extra indexes and changes nothing', async () => {
      const before = await snapshot();
      await expect(
        createMissingIndexes(app, { apply: false, log }),
      ).resolves.toBe(true);
      expect(lines).toEqual(
        expect.arrayContaining([
          'users: missing []',
          'categories: missing [{"sub":1}]',
          'categories: extra, kept (never dropped) [icon_1]',
          'accounts: missing [{"sub":1}]',
          'budgetmodels: missing [{"sub":1}]',
          'budgethistorymodels: missing [{"budget":1,"sub":1}]',
          'createexpenses: missing [{"userId":1,"account":1,"date":-1}]',
          'createexpenses: extra, kept (never dropped) [date_1, userId_1]',
          'createincomes: missing [{"userId":1,"account":1,"date":-1}]',
          'ratelimits: missing [{"expiresAt":1}]',
        ]),
      );
      expect(await snapshot()).toStrictEqual(before);
    });

    it('apply creates every schema index, keeps the extras, and a re-run is a no-op', async () => {
      await expect(
        createMissingIndexes(app, { apply: true, log }),
      ).resolves.toBe(true);
      const after = await snapshot();
      expect(after.budgethistorymodels).toContainEqual({
        name: 'budget_1_sub_1',
        key: { budget: 1, sub: 1 },
        unique: true,
        expireAfterSeconds: undefined,
      });
      expect(after.ratelimits).toContainEqual({
        name: 'expiresAt_1',
        key: { expiresAt: 1 },
        unique: undefined,
        expireAfterSeconds: 0,
      });
      for (const name of ['categories', 'accounts', 'budgetmodels']) {
        expect(await names(name)).toContain('sub_1');
      }
      for (const name of ['createexpenses', 'createincomes']) {
        expect(await names(name)).toContain('userId_1_account_1_date_-1');
      }
      expect(await names('createexpenses')).toEqual(
        expect.arrayContaining(['date_1', 'userId_1']),
      );
      expect(await names('categories')).toContain('icon_1');

      lines = [];
      await expect(
        createMissingIndexes(app, { apply: true, log }),
      ).resolves.toBe(true);
      expect(lines.filter((l) => l.includes('missing ['))).toEqual(
        COLLECTIONS.map((name) => `${name}: missing []`),
      );
      expect(await snapshot()).toStrictEqual(after);
    });

    it('a duplicate {budget, sub} pair is reported and the other collections are still indexed', async () => {
      await col('budgethistorymodels').dropIndex('budget_1_sub_1');
      await col('createincomes').dropIndex('userId_1_account_1_date_-1');
      await col('ratelimits').dropIndex('expiresAt_1');
      const pair = { budget: new Types.ObjectId(), sub: 'dup-owner' };
      const { insertedIds } = await col('budgethistorymodels').insertMany([
        { ...pair, records: [] },
        { ...pair, records: [] },
      ]);

      await expect(
        createMissingIndexes(app, { apply: true, log }),
      ).resolves.toBe(false);
      expect(lines).toContain(
        'budgethistorymodels: NOT created (MongoServerError 11000)',
      );
      expect(lines.join('\n')).not.toContain('dup-owner');
      expect(await names('budgethistorymodels')).not.toContain(
        'budget_1_sub_1',
      );
      expect(await names('createincomes')).toContain(
        'userId_1_account_1_date_-1',
      );
      expect(await names('ratelimits')).toContain('expiresAt_1');

      await col('budgethistorymodels').deleteOne({ _id: insertedIds[1] });
    });
  });

  describe('data-repair', () => {
    const id = () => new Types.ObjectId();
    const U1 = id();
    const U2 = id();
    const GONE = String(id());
    const u1 = String(U1);
    const u2 = String(U2);
    const AMOUNT = 4567.891;
    const DIGITS = 987654;
    const SECRET_STRINGS = [
      'Food',
      'Rare',
      'Dup',
      'Ghost',
      'Other',
      'example.invalid',
      'SecretShort',
      String(AMOUNT),
      String(DIGITS),
    ];

    const c = {
      u1Food: id(),
      u2Food: id(),
      u2Rare: id(),
      u2Dup: id(),
      u1DupA: id(),
      u1DupB: id(),
      u1Other: id(),
      u2Other: id(),
      gone1: id(),
      gone2: id(),
      goneRef: id(),
    };
    const a = {
      badDigits: id(),
      goodDigits: id(),
      noDigits: id(),
      u2: id(),
      gone: id(),
      goneRef: id(),
    };
    const b = { existing: id(), missing: id() };
    const e = {
      r2: id(),
      r2Ambiguous: id(),
      r2Ghost: id(),
      r3: id(),
      r3Gone: id(),
      r4Mapped: id(),
      r4Foreign: id(),
      r5: id(),
      r6: id(),
      r7: id(),
      control: id(),
    };
    const i = { r2Rare: id(), r5: id(), control: id() };
    const missingCategory = String(id());
    const missingAccount = String(id());
    const mapPath = join(tmpdir(), `r4-map-${process.pid}-${Date.now()}.json`);

    const record = (
      _id: Types.ObjectId,
      category: unknown,
      account: unknown,
      extra: object = {},
    ) => ({
      _id,
      userId: u1,
      shortName: 'SecretShort',
      amount: AMOUNT,
      category,
      account,
      ...extra,
    });

    const seed = async () => {
      await col('users').insertMany([
        { _id: U1, email: 'u1@example.invalid' },
        { _id: U2, email: 'u2@example.invalid' },
      ]);
      const cat = (_id: Types.ObjectId, categoryName: string, sub: string) => ({
        _id,
        categoryName,
        sub,
        icon: 'x',
        subCategories: [],
      });
      await col('categories').insertMany([
        cat(c.u1Food, 'Food', u1),
        cat(c.u2Food, 'Food', u2),
        cat(c.u2Rare, 'Rare', u2),
        cat(c.u2Dup, 'Dup', u2),
        cat(c.u1DupA, 'Dup', u1),
        cat(c.u1DupB, 'Dup', u1),
        cat(c.u1Other, 'Other', u1),
        cat(c.u2Other, 'Other', u2),
        cat(c.gone1, 'Food', GONE),
        cat(c.gone2, 'Rare', GONE),
        cat(c.goneRef, 'Ghost', GONE),
      ]);
      const acc = (_id: Types.ObjectId, sub: string, extra: object = {}) => ({
        _id,
        title: 'Acc',
        sub,
        amount: AMOUNT,
        ...extra,
      });
      await col('accounts').insertMany([
        acc(a.badDigits, u1, { terminationFourDigits: DIGITS }),
        acc(a.goodDigits, u1, { terminationFourDigits: '1234' }),
        acc(a.noDigits, u1),
        acc(a.u2, u2),
        acc(a.gone, GONE),
        acc(a.goneRef, GONE),
      ]);
      await col('budgetmodels').insertOne({ _id: b.existing, sub: u1 });
      const ok = String(a.goodDigits);
      await col('createexpenses').insertMany([
        record(e.r2, c.u2Food, ok, { linkedBudgets: [] }),
        record(e.r2Ambiguous, String(c.u2Dup), ok),
        record(e.r2Ghost, String(c.goneRef), ok),
        record(e.r3, String(c.u1Food), String(a.u2)),
        record(e.r3Gone, String(c.u1Food), String(a.goneRef)),
        record(e.r4Mapped, missingCategory, ok),
        record(e.r4Foreign, missingCategory, ok),
        record(e.r5, String(c.u1Food), missingAccount),
        record(e.r6, String(c.u1Food), ok, {
          linkedBudgets: [b.existing, b.missing],
        }),
        { _id: e.r7, isPaid: false, budgets: [], __v: 0 },
        record(e.control, c.u1Food, ok, { linkedBudgets: [b.existing] }),
      ]);
      await col('createincomes').insertMany([
        record(i.r2Rare, String(c.u2Rare), ok),
        record(i.r5, String(c.u1Food), 'not-an-object-id'),
        record(i.control, String(c.u1Food), ok),
      ]);
    };

    const DATA = COLLECTIONS.filter((n) => n !== 'ratelimits');
    const dataSnapshot = async (): Promise<Record<string, Doc[]>> =>
      Object.fromEntries(
        await Promise.all(
          DATA.map(async (name) => [
            name,
            await col(name).find().sort({ _id: 1 }).toArray(),
          ]),
        ),
      );

    type Doc = { _id: unknown; [key: string]: unknown };
    // The seed with exactly the given cases' fixes applied.
    const expectedAfter = (seeded: Record<string, Doc[]>, cases: string[]) => {
      const deletes: Record<string, Types.ObjectId[]> = {
        R5: [e.r5, i.r5],
        R7: [e.r7],
        R8: [a.gone, c.gone1, c.gone2],
      };
      const patches: Record<string, [Types.ObjectId, (d: Doc) => Doc]> = {
        R1: [
          a.badDigits,
          (d) => {
            const { terminationFourDigits, ...rest } = d;
            void terminationFourDigits;
            return rest as Doc;
          },
        ],
        R2: [e.r2, (d) => ({ ...d, category: String(c.u1Food) })],
        R4: [e.r4Mapped, (d) => ({ ...d, category: String(c.u1Other) })],
        R6: [e.r6, (d) => ({ ...d, linkedBudgets: [b.existing] })],
      };
      const gone = new Set(
        cases.flatMap((k) => (deletes[k] ?? []).map(String)),
      );
      const patch = new Map(
        cases.flatMap((k) =>
          patches[k] ? [[String(patches[k][0]), patches[k][1]] as const] : [],
        ),
      );
      return Object.fromEntries(
        Object.entries(seeded).map(([name, docs]) => [
          name,
          docs
            .filter((d) => !gone.has(String(d._id)))
            .map((d) => patch.get(String(d._id))?.(d) ?? d),
        ]),
      );
    };

    const expectNoSecrets = () => {
      const out = lines.join('\n');
      for (const s of SECRET_STRINGS) expect(out).not.toContain(s);
    };

    beforeAll(() => {
      writeFileSync(
        mapPath,
        JSON.stringify({
          [String(e.r4Mapped)]: String(c.u1Other),
          [String(e.r4Foreign)]: String(c.u2Other),
          [String(e.control)]: String(c.u1Other),
        }),
      );
    });

    afterAll(() => {
      rmSync(mapPath, { force: true });
    });

    beforeEach(async () => {
      for (const name of DATA) await col(name).deleteMany({});
      await seed();
    });

    it('report (default) prints counts and ids and changes nothing', async () => {
      const before = await dataSnapshot();
      await expect(
        repairData(app, { apply: false, r4Map: mapPath, log }),
      ).resolves.toBe(true);
      expect(lines).toEqual(
        expect.arrayContaining([
          'R1 accounts with invalid terminationFourDigits: 1',
          `  account ${a.badDigits}`,
          "R2 records on another user's category: 4",
          `  expense ${e.r2} -> category ${c.u1Food}`,
          `  expense ${e.r2Ambiguous} -> ambiguous`,
          `  expense ${e.r2Ghost} -> no-match`,
          `  income ${i.r2Rare} -> no-match`,
          "R3 records on another user's account (report only): 2",
          'R4 records on a missing category: 2',
          `  expense ${e.r4Mapped} user ${u1} owner categories [${[c.u1Food, c.u1DupA, c.u1DupB, c.u1Other].join(', ')}]`,
          'R4 map entries: 3',
          `  record ${e.r4Mapped} -> category ${c.u1Other}: apply`,
          `  record ${e.r4Foreign} -> category ${c.u2Other}: skip: category not owned`,
          `  record ${e.control} -> category ${c.u1Other}: skip: not R4`,
          'R5 records on a missing account: 2',
          `  income ${i.r5}`,
          'R6 expenses with missing linked budgets: 1',
          `  expense ${e.r6} budgets [${b.missing}]`,
          'R7 records without userId: 1',
          `  expense ${e.r7}`,
          'R8 orphans to delete: accounts 1, categories 2',
          'R8 orphans referenced, kept: accounts 1, categories 1',
          `  account ${a.goneRef}`,
          `  category ${c.goneRef}`,
        ]),
      );
      expectNoSecrets();
      expect(await dataSnapshot()).toStrictEqual(before);
    });

    it('apply fixes exactly the approved cases and a second run changes nothing', async () => {
      const seeded = await dataSnapshot();
      await expect(
        repairData(app, { apply: true, r4Map: mapPath, log }),
      ).resolves.toBe(true);
      expect(lines).toEqual(
        expect.arrayContaining([
          'R1: before 1, fixed 1, after 0',
          'R2: before 1, fixed 1, after 0',
          'R4: before 1, fixed 1, after 0',
          'R5: before 2, fixed 2, after 0',
          'R6: before 1, fixed 1, after 0',
          'R7: before 1, fixed 1, after 0',
          'R8: before 3, fixed 3, after 0',
          'R3: report only',
        ]),
      );
      expectNoSecrets();
      const after = await dataSnapshot();
      expect(after).toStrictEqual(
        expectedAfter(seeded, ['R1', 'R2', 'R4', 'R5', 'R6', 'R7', 'R8']),
      );

      lines = [];
      await expect(
        repairData(app, { apply: true, r4Map: mapPath, log }),
      ).resolves.toBe(true);
      for (const n of ['R1', 'R2', 'R4', 'R5', 'R6', 'R7', 'R8']) {
        expect(lines).toContain(`${n}: nothing to do`);
      }
      expect(await dataSnapshot()).toStrictEqual(after);
    });

    it('a failing write rolls its case back and stops the run', async () => {
      const seeded = await dataSnapshot();
      const incomeModel = app.get<Model<Income>>(getModelToken(Income.name));
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

      await expect(repairData(app, { apply: true, log })).resolves.toBe(false);
      expect(lines).toContain('R5: aborted (Error)');
      expect(lines.some((l) => /^R[678]:/.test(l))).toBe(false);
      // R1 and R2 committed before R5; R5 rolled back; R6–R8 never ran (no map: R4 has nothing to do).
      expect(await dataSnapshot()).toStrictEqual(
        expectedAfter(seeded, ['R1', 'R2']),
      );

      lines = [];
      await expect(repairData(app, { apply: true, log })).resolves.toBe(true);
      expect(lines).toContain('R5: before 2, fixed 2, after 0');
      expect(lines).toContain('R8: before 3, fixed 3, after 0');
    });

    it('--apply needs --db equal to the connected db', () => {
      expect(assertApplyTarget({ apply: true }, E2E_DB_NAME)).toBe(false);
      expect(
        assertApplyTarget(
          { apply: true, db: 'budget-master-e2e' },
          connection.name,
        ),
      ).toBe(true);
    });
  });
});
