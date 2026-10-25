import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

// No timestamps and the default versionKey: the prod docs have `__v` and no createdAt/updatedAt.
@Schema({ collection: 'accounts' })
export class Account {
  @Prop({ required: true })
  title: string;

  // D17: alias is required by the create DTO only; old prod docs lack these three fields.
  @Prop()
  alias?: string;

  @Prop({ required: true })
  accountType: string;

  @Prop({ required: true })
  backgroundColor: string;

  @Prop()
  accountProvider?: string;

  // String like develop: the one prod int hydrates to its string form (S8's data repair fixes that doc).
  @Prop()
  terminationFourDigits?: string;

  @Prop({ required: true })
  color: string;

  @Prop({ required: true })
  amount: number;

  // Legacy declared `Types.ObjectId` without a type, so it became Mixed and stored the JWT string: all prod docs are strings.
  @Prop({ type: String, required: true })
  sub: string;
}

export const AccountSchema = SchemaFactory.createForClass(Account);
// Builds under test only (autoIndex); prod gets it from S8's index script.
AccountSchema.index({ sub: 1 });
export type AccountDoc = HydratedDocument<Account>;
