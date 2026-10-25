import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

// D8: a stored legacy `nestResetDate` surfaces as `nextResetDate` when that is absent (also on populated docs).
function nextResetDateFallback(
  _doc: unknown,
  ret: Record<string, unknown>,
): Record<string, unknown> {
  if (ret.nextResetDate == null && ret.nestResetDate != null) {
    ret.nextResetDate = ret.nestResetDate;
  }
  return ret;
}

// No timestamps and the default versionKey: the prod docs have `__v` and no createdAt/updatedAt.
@Schema({
  collection: 'budgetmodels',
  toJSON: { transform: nextResetDateFallback },
})
export class Budget {
  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ required: true })
  typeBudget: string;

  @Prop({ type: Date, required: true })
  startDate: Date;

  @Prop({ type: Date, required: true })
  endDate: Date;

  @Prop({ required: true })
  currentAmount: number;

  @Prop({ required: true })
  limit: number;

  @Prop()
  period?: string;

  @Prop()
  isActive?: boolean;

  // D8: persisted now; legacy's DTO accepted it but the schema dropped it.
  @Prop({ type: Date })
  nextResetDate?: Date;

  // No default: old docs stay without the key instead of hydrating `[]`.
  @Prop({ type: [String], default: undefined })
  previousPeriods?: string[];

  // Legacy's misspelt path, read-only: no DTO field writes it (0 prod docs have it).
  @Prop({ type: Date })
  nestResetDate?: Date;

  // All 5 prod docs store the JWT `sub` as a string.
  @Prop({ type: String, required: true })
  sub: string;
}

export const BudgetSchema = SchemaFactory.createForClass(Budget);
// Builds under test only (autoIndex); prod gets it from S8's index script.
BudgetSchema.index({ sub: 1 });
export type BudgetDoc = HydratedDocument<Budget>;
