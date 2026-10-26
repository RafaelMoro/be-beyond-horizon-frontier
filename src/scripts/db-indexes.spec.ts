import type { INestApplicationContext } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { createMissingIndexes, INDEXED_MODELS } from './db-indexes.js';

type Diff = { toDrop: string[]; toCreate: object[] };

function fakeApp(diffs: Record<string, Diff>, createError?: Error) {
  const models = Object.fromEntries(
    INDEXED_MODELS.map((name) => {
      const diff = diffs[name] ?? { toDrop: [], toCreate: [] };
      return [
        name,
        {
          collection: { name: name.toLowerCase() },
          // After a create, nothing is missing.
          diffIndexes: vi
            .fn()
            .mockResolvedValueOnce(diff)
            .mockResolvedValue({ toDrop: diff.toDrop, toCreate: [] }),
          createIndexes: vi.fn(async () => {
            if (createError && name === 'BudgetHistory') throw createError;
          }),
          syncIndexes: vi.fn(),
          dropIndex: vi.fn(),
          cleanIndexes: vi.fn(),
        },
      ];
    }),
  );
  const app = {
    get: (token: string) =>
      models[INDEXED_MODELS.find((n) => getModelToken(n) === token)!],
  } as unknown as INestApplicationContext;
  return { app, models };
}

describe('createMissingIndexes', () => {
  const diffs: Record<string, Diff> = {
    Category: { toDrop: [], toCreate: [{ sub: 1 }] },
    BudgetHistory: { toDrop: [], toCreate: [{ budget: 1, sub: 1 }] },
    Expense: { toDrop: ['date_1', 'userId_1'], toCreate: [] },
  };
  let lines: string[];
  const log = (line: string) => lines.push(line);

  beforeEach(() => {
    lines = [];
  });

  it('dry run: lists missing and extra indexes, creates nothing', async () => {
    const { app, models } = fakeApp(diffs);
    await expect(
      createMissingIndexes(app, { apply: false, log }),
    ).resolves.toBe(true);
    expect(lines).toContain('category: missing [{"sub":1}]');
    expect(lines).toContain(
      'expense: extra, kept (never dropped) [date_1, userId_1]',
    );
    for (const m of Object.values(models)) {
      expect(m.createIndexes).not.toHaveBeenCalled();
    }
  });

  it('apply: creates only where something is missing, never drops', async () => {
    const { app, models } = fakeApp(diffs);
    await expect(createMissingIndexes(app, { apply: true, log })).resolves.toBe(
      true,
    );
    const created = Object.entries(models)
      .filter(([, m]) => m.createIndexes.mock.calls.length > 0)
      .map(([name]) => name);
    expect(created).toEqual(['Category', 'BudgetHistory']);
    expect(lines).toContain('category: after, missing 0');
    for (const m of Object.values(models)) {
      expect(m.syncIndexes).not.toHaveBeenCalled();
      expect(m.dropIndex).not.toHaveBeenCalled();
      expect(m.cleanIndexes).not.toHaveBeenCalled();
    }
  });

  it('an index build error on one model is reported and the others still run', async () => {
    const dup = Object.assign(new Error('E11000 … dup key: { sub: "x" }'), {
      name: 'MongoServerError',
      code: 11000,
    });
    const { app, models } = fakeApp(
      { ...diffs, RateLimit: { toDrop: [], toCreate: [{ expiresAt: 1 }] } },
      dup,
    );
    await expect(createMissingIndexes(app, { apply: true, log })).resolves.toBe(
      false,
    );
    expect(lines).toContain(
      'budgethistory: NOT created (MongoServerError 11000)',
    );
    expect(lines.join('\n')).not.toContain('dup key');
    expect(models.RateLimit.createIndexes).toHaveBeenCalled();
  });

  it('rethrows any other error', async () => {
    const { app } = fakeApp(diffs, new Error('network'));
    await expect(
      createMissingIndexes(app, { apply: true, log }),
    ).rejects.toThrow('network');
  });
});
