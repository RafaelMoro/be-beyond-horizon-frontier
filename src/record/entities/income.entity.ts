import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import { Expense } from './expense.entity.js';
import { AccountRecord } from './record.entity.js';

// No timestamps and the default versionKey (prod docs). Never an `isPaid` path: key presence is the record kind on the
// client (research §2).
@Schema({ collection: 'createincomes' })
export class Income extends AccountRecord {
  // mongoose.Schema.Types.ObjectId, not mongoose's `Types.ObjectId` class (that makes it Mixed).
  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: Expense.name }] })
  expensesPaid: Types.ObjectId[];
}

export const IncomeSchema = SchemaFactory.createForClass(Income);
// Builds under test only (autoIndex); prod gets it from S8's index script.
IncomeSchema.index({ userId: 1, account: 1, date: -1 });
export type IncomeDoc = HydratedDocument<Income>;
