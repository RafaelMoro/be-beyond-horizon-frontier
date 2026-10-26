import type { INestApplicationContext } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Account } from '../account/entities/account.entity.js';
import { BudgetHistory } from '../budget/entities/budget-history.entity.js';
import { Budget } from '../budget/entities/budget.entity.js';
import { Category } from '../category/entities/category.entity.js';
import { RateLimit } from '../rate-limit/entities/rate-limit.entity.js';
import { Expense } from '../record/entities/expense.entity.js';
import { Income } from '../record/entities/income.entity.js';
import { User } from '../user/entities/user.entity.js';
import { errorLabel, type ScriptOptions } from './script-runner.js';

export const INDEXED_MODELS = [
  User,
  Category,
  Account,
  Budget,
  BudgetHistory,
  Expense,
  Income,
  RateLimit,
].map((m) => m.name);

// Duplicate key (unique index over existing duplicates), IndexOptionsConflict, IndexKeySpecsConflict.
const INDEX_BUILD_ERRORS = [11000, 85, 86];

// E8.Q8: create only. Never syncIndexes / dropIndex / dropIndexes / cleanIndexes: prod's extra indexes stay.
export async function createMissingIndexes(
  app: INestApplicationContext,
  { apply, log }: ScriptOptions,
): Promise<boolean> {
  let ok = true;
  for (const name of INDEXED_MODELS) {
    const model = app.get<Model<unknown>>(getModelToken(name));
    const collection = model.collection.name;
    const { toDrop, toCreate } = await model.diffIndexes();
    log(
      `${collection}: missing [${toCreate.map((k) => JSON.stringify(k)).join(', ')}]`,
    );
    if (toDrop.length > 0) {
      log(`${collection}: extra, kept (never dropped) [${toDrop.join(', ')}]`);
    }
    if (!apply || toCreate.length === 0) continue;
    try {
      await model.createIndexes();
    } catch (error) {
      if (!INDEX_BUILD_ERRORS.includes((error as { code?: number }).code!)) {
        throw error;
      }
      log(`${collection}: NOT created (${errorLabel(error)})`);
      ok = false;
      continue;
    }
    const after = await model.diffIndexes();
    log(`${collection}: after, missing ${after.toCreate.length}`);
  }
  return ok;
}
