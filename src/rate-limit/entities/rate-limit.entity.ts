import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

// `_id` = `${scope}:${sha256(trim+lowercase value)}:${bucket}`: the window lives in the key, the TTL only cleans up.
@Schema({ collection: 'ratelimits', versionKey: false })
export class RateLimit {
  @Prop({ type: String })
  _id: string;

  @Prop({ required: true })
  count: number;

  @Prop({ required: true })
  expiresAt: Date;
}

export const RateLimitSchema = SchemaFactory.createForClass(RateLimit);
// Builds under test only (autoIndex); prod gets it from S8b's index script.
RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
