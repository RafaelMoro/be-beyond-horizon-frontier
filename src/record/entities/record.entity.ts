import { Prop, raw } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { Category } from '../../category/entities/category.entity.js';

export interface IndebtedPerson {
  name: string;
  amount: number;
  amountPaid: number;
  isPaid: boolean;
}

export interface TransferRecord {
  transferId: string;
  account: string;
}

// Shared paths of createexpenses / createincomes (research §2). No @Schema: each record kind has its own.
export abstract class AccountRecord {
  // The JWT `sub`, a string on every prod doc.
  @Prop({ type: String, required: true })
  userId: string;

  @Prop({ type: String, required: true })
  shortName: string;

  @Prop({ type: String, required: true })
  typeOfRecord: string;

  @Prop({ type: String })
  description?: string;

  @Prop({ type: Number, required: true })
  amount: number;

  @Prop({ type: String, required: true })
  amountFormatted: string;

  // Not required (legacy).
  @Prop({ type: Date })
  date?: Date;

  @Prop({ type: String, required: true })
  fullDate: string;

  @Prop({ type: String, required: true })
  formattedTime: string;

  // Q4: Mixed + ref, as legacy's runtime. Prod stores strings and ObjectIds; both populate and keep their stored type.
  @Prop({
    type: mongoose.Schema.Types.Mixed,
    ref: Category.name,
    required: true,
  })
  category: unknown;

  @Prop({ type: String, required: true })
  subCategory: string;

  @Prop({ type: [String] })
  tag: string[];

  // Subdocs keep their `_id` (old-next echoes it on edit, Q7).
  @Prop({
    type: [
      {
        name: { type: String },
        amount: { type: Number },
        amountPaid: { type: Number },
        isPaid: { type: Boolean },
      },
    ],
  })
  indebtedPeople: IndebtedPerson[];

  @Prop(raw({ transferId: { type: String }, account: { type: String } }))
  transferRecord?: TransferRecord;

  // D2: a string on every prod doc, never populated.
  @Prop({ type: String, required: true })
  account: string;

  // Deprecated, the FE sends [].
  @Prop({ type: [String] })
  budgets: string[];
}
