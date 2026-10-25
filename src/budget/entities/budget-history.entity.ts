import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import { Budget } from './budget.entity.js';

export interface BudgetHistoryRecord {
  recordId: string;
  recordName: string;
  recordAmount: number;
  recordDate: Date;
  budgetCurrentAmount: number;
  budgetUpdatedAmount: number;
}

@Schema({ collection: 'budgethistorymodels' })
export class BudgetHistory {
  // mongoose.Schema.Types.ObjectId, not mongoose's `Types.ObjectId` class: that one makes the path Mixed (legacy's bug).
  // The 5 prod docs store ObjectIds; this type makes string ids cast and match them.
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: Budget.name,
    required: true,
  })
  budget: Types.ObjectId;

  // All 5 prod docs store the JWT `sub` as a string.
  @Prop({ type: String, required: true })
  sub: string;

  // Develop's inline element type; subdocs keep their `_id`.
  @Prop({
    type: [
      {
        recordId: { type: String },
        recordName: { type: String },
        recordAmount: { type: Number },
        recordDate: { type: Date },
        budgetCurrentAmount: { type: Number },
        budgetUpdatedAmount: { type: Number },
      },
    ],
  })
  records: BudgetHistoryRecord[];
}

export const BudgetHistorySchema = SchemaFactory.createForClass(BudgetHistory);
// Builds under test only (autoIndex); prod gets it from S8's index script.
BudgetHistorySchema.index({ budget: 1, sub: 1 }, { unique: true });
export type BudgetHistoryDoc = HydratedDocument<BudgetHistory>;
