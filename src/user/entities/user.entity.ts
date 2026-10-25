import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

// No timestamps and the default versionKey: the prod docs have `__v` and no createdAt/updatedAt.
@Schema({ collection: 'users' })
export class User {
  // `unique` only builds the index under test (autoIndex); prod already has `email_1`.
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: true })
  firstName: string;

  @Prop({ required: true })
  lastName: string;

  @Prop()
  middleName: string;

  // sha256 hex of the pending one-time reset JWT.
  @Prop()
  oneTimeToken?: string;

  // Access tokens issued before this instant are revoked. Absent = never revoked.
  @Prop()
  passwordChangedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
export type UserDoc = HydratedDocument<User>;
