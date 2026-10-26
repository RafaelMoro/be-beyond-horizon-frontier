import type { INestApplicationContext } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import {
  type ClientSession,
  type Connection,
  type Model,
  Types,
} from 'mongoose';
import { readFileSync } from 'node:fs';
import { TERMINATION_DIGITS_REGEX } from '../account/account.constants.js';
import { Account } from '../account/entities/account.entity.js';
import { Budget } from '../budget/entities/budget.entity.js';
import { Category } from '../category/entities/category.entity.js';
import { Expense } from '../record/entities/expense.entity.js';
import { Income } from '../record/entities/income.entity.js';
import { User } from '../user/entities/user.entity.js';
import { errorLabel, type ScriptOptions } from './script-runner.js';

// Data repair (S8b, research §7, owner decisions E8.Q10/Q11). Output: case labels, counts and _ids only — never names,
// emails, amounts or the stored terminationFourDigits (partial card digits).

export type RecordKind = 'expense' | 'income';

interface RawDoc {
  _id: unknown;
  [key: string]: unknown;
}

export interface Snapshot {
  users: RawDoc[];
  accounts: RawDoc[];
  categories: RawDoc[];
  budgets: RawDoc[];
  expenses: RawDoc[];
  incomes: RawDoc[];
}

export interface RecordRef {
  kind: RecordKind;
  recordId: string;
}

export interface RepairCases {
  r1: string[];
  r2: (RecordRef & {
    target: string | null;
    reason?: 'no-match' | 'ambiguous';
  })[];
  r3: RecordRef[];
  r4: (RecordRef & { userId: string; ownerCategoryIds: string[] })[];
  r5: RecordRef[];
  r6: { recordId: string; danglingIds: unknown[] }[];
  r7: RecordRef[];
  r8: { accounts: string[]; categories: string[] };
  r8Kept: { accounts: string[]; categories: string[] };
}

export type R4Map = Record<string, string>;

export interface RepairModels {
  user: Model<unknown>;
  account: Model<unknown>;
  category: Model<unknown>;
  budget: Model<unknown>;
  expense: Model<unknown>;
  income: Model<unknown>;
}

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

export async function loadSnapshot(
  models: RepairModels,
  session?: ClientSession,
): Promise<Snapshot> {
  const find = (model: Model<unknown>, projection: string) =>
    model
      .find({}, projection)
      .session(session ?? null)
      .lean<RawDoc[]>()
      .exec();
  return {
    users: await find(models.user, '_id'),
    accounts: await find(models.account, '_id sub terminationFourDigits'),
    // categoryName: R2 matching only, never printed.
    categories: await find(models.category, '_id sub categoryName'),
    budgets: await find(models.budget, '_id'),
    expenses: await find(
      models.expense,
      '_id userId account category linkedBudgets',
    ),
    incomes: await find(models.income, '_id userId account category'),
  };
}

// Ids are compared as strings: record `category` is a string or an ObjectId, owners and `account` are strings.
// A non-ObjectId reference just never matches (no cast); an absent account/category resolves to none.
export function classify(snapshot: Snapshot): RepairCases {
  const userIds = new Set(snapshot.users.map((u) => String(u._id)));
  const accounts = new Map(snapshot.accounts.map((a) => [String(a._id), a]));
  const categories = new Map(
    snapshot.categories.map((c) => [String(c._id), c]),
  );
  const budgetIds = new Set(snapshot.budgets.map((b) => String(b._id)));
  const records = [
    ...snapshot.expenses.map((doc) => ({ kind: 'expense' as const, doc })),
    ...snapshot.incomes.map((doc) => ({ kind: 'income' as const, doc })),
  ];
  const ownerCategories = (userId: string) =>
    snapshot.categories.filter((c) => String(c.sub) === userId);

  const cases: RepairCases = {
    r1: snapshot.accounts
      .filter(
        (a) =>
          a.terminationFourDigits != null &&
          !TERMINATION_DIGITS_REGEX.test(String(a.terminationFourDigits)),
      )
      .map((a) => String(a._id)),
    r2: [],
    r3: [],
    r4: [],
    r5: [],
    r6: [],
    r7: [],
    r8: { accounts: [], categories: [] },
    r8Kept: { accounts: [], categories: [] },
  };
  const referenced = new Set<string>();

  for (const { kind, doc } of records) {
    const recordId = String(doc._id);
    referenced.add(String(doc.account));
    referenced.add(String(doc.category));
    // Matches the R7 delete filter `{ userId: null }` (missing or null); such records are only R7.
    if (doc.userId == null) {
      cases.r7.push({ kind, recordId });
      continue;
    }
    const userId = String(doc.userId);

    const category = categories.get(String(doc.category));
    if (!category) {
      cases.r4.push({
        kind,
        recordId,
        userId,
        ownerCategoryIds: ownerCategories(userId).map((c) => String(c._id)),
      });
    } else if (String(category.sub) !== userId) {
      const sameName = ownerCategories(userId).filter(
        (c) => c.categoryName === category.categoryName,
      );
      cases.r2.push(
        sameName.length === 1
          ? { kind, recordId, target: String(sameName[0]._id) }
          : {
              kind,
              recordId,
              target: null,
              reason: sameName.length === 0 ? 'no-match' : 'ambiguous',
            },
      );
    }

    const account = accounts.get(String(doc.account));
    if (!account) cases.r5.push({ kind, recordId });
    else if (String(account.sub) !== userId) cases.r3.push({ kind, recordId });

    if (kind === 'expense' && Array.isArray(doc.linkedBudgets)) {
      const danglingIds = (doc.linkedBudgets as unknown[]).filter(
        (id) => !budgetIds.has(String(id)),
      );
      if (danglingIds.length > 0) cases.r6.push({ recordId, danglingIds });
    }
  }

  // Orphans still referenced by a record are kept: deleting them would turn that record into R4 / R5.
  for (const [docs, key] of [
    [snapshot.accounts, 'accounts'],
    [snapshot.categories, 'categories'],
  ] as const) {
    for (const doc of docs) {
      if (userIds.has(String(doc.sub))) continue;
      const id = String(doc._id);
      (referenced.has(id) ? cases.r8Kept : cases.r8)[key].push(id);
    }
  }
  return cases;
}

export function loadR4Map(path: string): R4Map {
  const invalid = () =>
    Object.assign(new Error('Invalid R4 map'), { code: 'R4_MAP_INVALID' });
  let map: unknown;
  try {
    map = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw invalid();
  }
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    throw invalid();
  }
  for (const [key, value] of Object.entries(map)) {
    if (
      !OBJECT_ID_HEX.test(key) ||
      typeof value !== 'string' ||
      !OBJECT_ID_HEX.test(value)
    ) {
      throw invalid();
    }
  }
  return map as R4Map;
}

// A map entry applies only to a record that is still R4, onto a category its owner has.
function r4Decisions(cases: RepairCases, map: R4Map) {
  return Object.entries(map).map(([recordId, categoryId]) => {
    const r4 = cases.r4.find((c) => c.recordId === recordId);
    const status = !r4
      ? 'skip: not R4'
      : r4.ownerCategoryIds.includes(categoryId)
        ? 'apply'
        : 'skip: category not owned';
    return { recordId, categoryId, kind: r4?.kind, status };
  });
}

const ref = (r: RecordRef) => `${r.kind} ${r.recordId}`;

export function printCases(
  cases: RepairCases,
  log: (line: string) => void,
  r4Map?: R4Map,
): void {
  log(`R1 accounts with invalid terminationFourDigits: ${cases.r1.length}`);
  cases.r1.forEach((id) => log(`  account ${id}`));
  log(`R2 records on another user's category: ${cases.r2.length}`);
  cases.r2.forEach((r) =>
    log(`  ${ref(r)} -> ${r.target ? `category ${r.target}` : r.reason}`),
  );
  log(`R3 records on another user's account (report only): ${cases.r3.length}`);
  cases.r3.forEach((r) => log(`  ${ref(r)}`));
  log(`R4 records on a missing category: ${cases.r4.length}`);
  cases.r4.forEach((r) =>
    log(
      `  ${ref(r)} user ${r.userId} owner categories [${r.ownerCategoryIds.join(', ')}]`,
    ),
  );
  if (r4Map) {
    log(`R4 map entries: ${Object.keys(r4Map).length}`);
    r4Decisions(cases, r4Map).forEach((d) =>
      log(`  record ${d.recordId} -> category ${d.categoryId}: ${d.status}`),
    );
  }
  log(`R5 records on a missing account: ${cases.r5.length}`);
  cases.r5.forEach((r) => log(`  ${ref(r)}`));
  log(`R6 expenses with missing linked budgets: ${cases.r6.length}`);
  cases.r6.forEach((r) =>
    log(
      `  expense ${r.recordId} budgets [${r.danglingIds.map(String).join(', ')}]`,
    ),
  );
  log(`R7 records without userId: ${cases.r7.length}`);
  cases.r7.forEach((r) => log(`  ${ref(r)}`));
  log(
    `R8 orphans to delete: accounts ${cases.r8.accounts.length}, categories ${cases.r8.categories.length}`,
  );
  cases.r8.accounts.forEach((id) => log(`  account ${id}`));
  cases.r8.categories.forEach((id) => log(`  category ${id}`));
  log(
    `R8 orphans referenced, kept: accounts ${cases.r8Kept.accounts.length}, categories ${cases.r8Kept.categories.length}`,
  );
  cases.r8Kept.accounts.forEach((id) => log(`  account ${id}`));
  cases.r8Kept.categories.forEach((id) => log(`  category ${id}`));
}

function assertCount(actual: number, expected: number): void {
  // Aborts the case's transaction: the DB changed between the read and the write.
  if (actual !== expected) {
    throw Object.assign(new Error('Unexpected write count'), {
      code: 'COUNT_MISMATCH',
    });
  }
}

interface RepairStep {
  label: string;
  // Ids the step would fix (0 → no transaction).
  pending: (cases: RepairCases) => number;
  // Writes with `session` only; returns the number fixed. No logging: the transaction may retry.
  fix: (cases: RepairCases, session: ClientSession) => Promise<number>;
}

function repairSteps(models: RepairModels, r4Map: R4Map): RepairStep[] {
  const recordModel = (kind: RecordKind) =>
    kind === 'expense' ? models.expense : models.income;
  const setCategory = async (
    entries: { kind: RecordKind; recordId: string; categoryId: string }[],
    session: ClientSession,
  ) => {
    for (const e of entries) {
      // A string id, what the API writes today (even where the old value was an ObjectId).
      const res = await recordModel(e.kind)
        .updateOne(
          { _id: e.recordId },
          { $set: { category: e.categoryId } },
          { session },
        )
        .exec();
      assertCount(res.modifiedCount, 1);
    }
    return entries.length;
  };
  const r2Entries = (c: RepairCases) =>
    c.r2.flatMap((r) =>
      r.target
        ? [{ kind: r.kind, recordId: r.recordId, categoryId: r.target }]
        : [],
    );
  const r4Entries = (c: RepairCases) =>
    r4Decisions(c, r4Map).flatMap((d) =>
      d.status === 'apply'
        ? [{ kind: d.kind!, recordId: d.recordId, categoryId: d.categoryId }]
        : [],
    );
  const deleteByKind = async (
    refs: RecordRef[],
    extraFilter: object,
    session: ClientSession,
  ) => {
    for (const kind of ['expense', 'income'] as const) {
      const ids = refs.filter((r) => r.kind === kind).map((r) => r.recordId);
      if (ids.length === 0) continue;
      const res = await recordModel(kind)
        .deleteMany({ _id: { $in: ids }, ...extraFilter }, { session })
        .exec();
      assertCount(res.deletedCount, ids.length);
    }
    return refs.length;
  };

  // Balances, budget amounts / history, expensesPaid and transfer counterparts are left as they are (open question 3).
  return [
    {
      label: 'R1',
      pending: (c) => c.r1.length,
      fix: async (c, session) => {
        const res = await models.account
          .updateMany(
            { _id: { $in: c.r1 } },
            { $unset: { terminationFourDigits: 1 } },
            { session },
          )
          .exec();
        assertCount(res.modifiedCount, c.r1.length);
        return c.r1.length;
      },
    },
    {
      label: 'R2',
      pending: (c) => r2Entries(c).length,
      fix: (c, session) => setCategory(r2Entries(c), session),
    },
    {
      label: 'R4',
      pending: (c) => r4Entries(c).length,
      fix: (c, session) => setCategory(r4Entries(c), session),
    },
    {
      label: 'R5',
      pending: (c) => c.r5.length,
      fix: (c, session) => deleteByKind(c.r5, {}, session),
    },
    {
      label: 'R6',
      pending: (c) => c.r6.length,
      fix: async (c, session) => {
        for (const r of c.r6) {
          // Raw driver: pulls the stored values as they are (a non-ObjectId string would fail mongoose's cast).
          const res = await models.expense.collection.updateOne(
            { _id: new Types.ObjectId(r.recordId) },
            // The driver's PullOperator typing rejects `$in` on an untyped collection.
            { $pull: { linkedBudgets: { $in: r.danglingIds } } } as never,
            { session },
          );
          assertCount(res.modifiedCount, 1);
        }
        return c.r6.length;
      },
    },
    {
      label: 'R7',
      pending: (c) => c.r7.length,
      fix: (c, session) => deleteByKind(c.r7, { userId: null }, session),
    },
    {
      // Last: R2 / R4 may have repointed records off an orphan category.
      label: 'R8',
      pending: (c) => c.r8.accounts.length + c.r8.categories.length,
      fix: async (c, session) => {
        for (const [model, ids] of [
          [models.account, c.r8.accounts],
          [models.category, c.r8.categories],
        ] as const) {
          if (ids.length === 0) continue;
          const res = await model
            .deleteMany({ _id: { $in: ids } }, { session })
            .exec();
          assertCount(res.deletedCount, ids.length);
        }
        return c.r8.accounts.length + c.r8.categories.length;
      },
    },
  ];
}

export function repairModels(app: INestApplicationContext): RepairModels {
  const get = (name: string) => app.get<Model<unknown>>(getModelToken(name));
  return {
    user: get(User.name),
    account: get(Account.name),
    category: get(Category.name),
    budget: get(Budget.name),
    expense: get(Expense.name),
    income: get(Income.name),
  };
}

// Default: the read-only report. With `apply`: each case is re-detected and fixed in its own transaction.
export async function repairData(
  app: INestApplicationContext,
  { apply, r4Map: r4MapPath, log }: ScriptOptions,
): Promise<boolean> {
  // Before any read or write: a bad map stops the run.
  const r4Map = r4MapPath ? loadR4Map(r4MapPath) : undefined;
  const models = repairModels(app);
  const connection = app.get<Connection>(getConnectionToken());
  const before = classify(await loadSnapshot(models));
  printCases(before, log, r4Map);
  if (!apply) return true;

  for (const step of repairSteps(models, r4Map ?? {})) {
    const pending = step.pending(before);
    if (pending === 0) {
      log(`${step.label}: nothing to do`);
      continue;
    }
    let fixed = 0;
    try {
      fixed = await connection.transaction(async (session) =>
        step.fix(classify(await loadSnapshot(models, session)), session),
      );
    } catch (error) {
      log(`${step.label}: aborted (${errorLabel(error)})`);
      return false;
    }
    const after = step.pending(classify(await loadSnapshot(models)));
    log(`${step.label}: before ${pending}, fixed ${fixed}, after ${after}`);
  }
  log('R3: report only');
  return true;
}
