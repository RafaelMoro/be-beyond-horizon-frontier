import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Types } from 'mongoose';
import {
  classify,
  loadR4Map,
  printCases,
  type Snapshot,
} from './data-repair.js';

const oid = () => new Types.ObjectId();

describe('classify', () => {
  const U1 = oid();
  const U2 = oid();
  const u1 = String(U1);
  const u2 = String(U2);
  const GONE = String(oid());
  const ids = {
    u1Food: oid(),
    u2Food: oid(),
    u2Rare: oid(),
    u2Dup: oid(),
    u1DupA: oid(),
    u1DupB: oid(),
    goneCat: oid(),
    goneCatRef: oid(),
    acc: oid(),
    u2Acc: oid(),
    goneAcc: oid(),
    goneAccRef: oid(),
    budget: oid(),
    missingBudget: oid(),
  };
  const s = (id: Types.ObjectId) => String(id);
  const rec = (category: unknown, account: unknown, extra: object = {}) => ({
    _id: oid(),
    userId: u1,
    category,
    account,
    ...extra,
  });

  const records = {
    r2Match: rec(ids.u2Food, s(ids.acc)), // ObjectId category
    r2NoMatch: rec(s(ids.u2Rare), s(ids.acc)),
    r2Ambiguous: rec(s(ids.u2Dup), s(ids.acc)),
    r2Orphan: rec(s(ids.goneCatRef), s(ids.acc)),
    r3: rec(s(ids.u1Food), s(ids.u2Acc)),
    r3Orphan: rec(s(ids.u1Food), s(ids.goneAccRef)),
    r4: rec(s(oid()), s(ids.acc)),
    r5: rec(s(ids.u1Food), 'not-an-object-id'),
    r6: rec(s(ids.u1Food), s(ids.acc), {
      linkedBudgets: [ids.budget, ids.missingBudget],
    }),
    r7: { _id: oid(), isPaid: false, category: 'x', account: 'y' },
    ok: rec(ids.u1Food, s(ids.acc), { linkedBudgets: [ids.budget] }),
  };
  const income = rec(s(ids.u1Food), 'missing');

  const snapshot: Snapshot = {
    users: [{ _id: U1 }, { _id: U2 }],
    accounts: [
      { _id: oid(), sub: u1, terminationFourDigits: 123 },
      { _id: oid(), sub: u1, terminationFourDigits: '12a4' },
      { _id: oid(), sub: u1 },
      { _id: ids.acc, sub: u1, terminationFourDigits: '1234' },
      { _id: ids.u2Acc, sub: u2 },
      { _id: ids.goneAcc, sub: GONE },
      { _id: ids.goneAccRef, sub: GONE },
    ],
    categories: [
      { _id: ids.u1Food, sub: u1, categoryName: 'Food' },
      { _id: ids.u2Food, sub: u2, categoryName: 'Food' },
      { _id: ids.u2Rare, sub: u2, categoryName: 'Rare' },
      { _id: ids.u2Dup, sub: u2, categoryName: 'Dup' },
      { _id: ids.u1DupA, sub: u1, categoryName: 'Dup' },
      { _id: ids.u1DupB, sub: u1, categoryName: 'Dup' },
      { _id: ids.goneCat, sub: GONE, categoryName: 'Food' },
      { _id: ids.goneCatRef, sub: GONE, categoryName: 'Ghost' },
    ],
    budgets: [{ _id: ids.budget }],
    expenses: Object.values(records),
    incomes: [income],
  };
  const cases = classify(snapshot);
  const exp = (r: { _id: unknown }) => ({
    kind: 'expense',
    recordId: String(r._id),
  });

  it('R1: only non-4-digit values, never a missing field', () => {
    expect(cases.r1).toEqual([
      String(snapshot.accounts[0]._id),
      String(snapshot.accounts[1]._id),
    ]);
  });

  it('R2: repoints to exactly one same-name owner category, else no-match / ambiguous', () => {
    expect(cases.r2).toEqual([
      { ...exp(records.r2Match), target: s(ids.u1Food) },
      { ...exp(records.r2NoMatch), target: null, reason: 'no-match' },
      { ...exp(records.r2Ambiguous), target: null, reason: 'ambiguous' },
      { ...exp(records.r2Orphan), target: null, reason: 'no-match' },
    ]);
  });

  it('R3, R4, R5, R6', () => {
    expect(cases.r3).toEqual([exp(records.r3), exp(records.r3Orphan)]);
    expect(cases.r4).toEqual([
      {
        ...exp(records.r4),
        userId: u1,
        ownerCategoryIds: [s(ids.u1Food), s(ids.u1DupA), s(ids.u1DupB)],
      },
    ]);
    expect(cases.r5).toEqual([
      exp(records.r5),
      { kind: 'income', recordId: String(income._id) },
    ]);
    expect(cases.r6).toEqual([
      { recordId: String(records.r6._id), danglingIds: [ids.missingBudget] },
    ]);
  });

  it('R7: a record without userId is in no other case', () => {
    expect(cases.r7).toEqual([exp(records.r7)]);
    const r7 = String(records.r7._id);
    for (const list of [cases.r2, cases.r3, cases.r4, cases.r5]) {
      expect(list.map((r) => r.recordId)).not.toContain(r7);
    }
  });

  it('R8: orphans still referenced by a record are kept', () => {
    expect(cases.r8).toEqual({
      accounts: [s(ids.goneAcc)],
      categories: [s(ids.goneCat)],
    });
    expect(cases.r8Kept).toEqual({
      accounts: [s(ids.goneAccRef)],
      categories: [s(ids.goneCatRef)],
    });
  });

  it('printCases prints ids, never names or digits', () => {
    const lines: string[] = [];
    printCases(cases, (l) => lines.push(l), {
      [String(records.r4._id)]: s(ids.u1Food),
    });
    const out = lines.join('\n');
    expect(out).toContain(
      `expense ${records.r2Match._id} -> category ${ids.u1Food}`,
    );
    expect(out).toContain(
      `record ${records.r4._id} -> category ${ids.u1Food}: apply`,
    );
    for (const secret of ['Food', 'Rare', 'Dup', 'Ghost', '12a4']) {
      expect(out).not.toContain(secret);
    }
  });
});

describe('loadR4Map', () => {
  let dir: string;
  const write = (content: string) => {
    const path = join(dir, 'map.json');
    writeFileSync(path, content);
    return path;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r4-map-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a { recordId: categoryId } file', () => {
    const map = { [String(oid())]: String(oid()) };
    expect(loadR4Map(write(JSON.stringify(map)))).toEqual(map);
  });

  it.each([
    ['bad JSON', '{'],
    ['an array', '[]'],
    ['a non-hex key', JSON.stringify({ nope: String(oid()) })],
    ['a non-hex value', JSON.stringify({ [String(oid())]: 'nope' })],
  ])('rejects %s', (_, content) => {
    expect(() => loadR4Map(write(content))).toThrow(
      expect.objectContaining({ code: 'R4_MAP_INVALID' }),
    );
  });
});
