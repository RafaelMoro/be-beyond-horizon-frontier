import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import { Budget } from '../../budget/entities/budget.entity.js';
import { AccountRecord } from './record.entity.js';

// No timestamps and the default versionKey (prod docs). Never an `expensesPaid` path: key presence is the record kind
// on the client (research §2).
@Schema({ collection: 'createexpenses' })
export class Expense extends AccountRecord {
  @Prop({ type: Boolean, required: true })
  isPaid: boolean;

  // mongoose.Schema.Types.ObjectId, not mongoose's `Types.ObjectId` class (that makes it Mixed). No default: 545 old
  // docs lack the key and lean reads keep that.
  @Prop({
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: Budget.name }],
    default: undefined,
  })
  linkedBudgets?: Types.ObjectId[];
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);
// Builds under test only (autoIndex); prod gets it from S8's index script.
ExpenseSchema.index({ userId: 1, account: 1, date: -1 });
export type ExpenseDoc = HydratedDocument<Expense>;
