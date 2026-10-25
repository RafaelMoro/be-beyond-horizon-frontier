import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

// No timestamps and the default versionKey: the prod docs have `__v` and no createdAt/updatedAt.
@Schema({ collection: 'categories' })
export class Category {
  @Prop({ required: true })
  categoryName: string;

  @Prop({ type: [String], required: true })
  subCategories: string[];

  @Prop({ required: true })
  icon: string;

  // Legacy declared `Types.ObjectId` without a type, so it became Mixed and stored the JWT string: all prod docs are strings.
  @Prop({ type: String, required: true })
  sub: string;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
// Builds under test only (autoIndex); prod gets it from S8's index script.
CategorySchema.index({ sub: 1 });
export type CategoryDoc = HydratedDocument<Category>;
