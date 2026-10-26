import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { hashToken } from '../../user/user.utils.js';
import { RateLimit } from '../entities/rate-limit.entity.js';
import {
  RATE_LIMITS,
  RateLimitScope,
  TOO_MANY_REQUESTS,
} from '../rate-limit.constants.js';

@Injectable()
export class RateLimitService {
  constructor(
    @InjectModel(RateLimit.name)
    private readonly rateLimitModel: Model<RateLimit>,
  ) {}

  // Counts every hit (all keys, even once one is over), then 429s if any key is over its limit.
  // shortcut: a fixed window lets up to 2 × limit through across a boundary; move to a sliding window if abuse shows up.
  async consume(
    hits: { scope: RateLimitScope; value: string }[],
  ): Promise<void> {
    let over = false;
    for (const { scope, value } of hits) {
      const { limit, windowMs } = RATE_LIMITS[scope];
      const bucket = Math.floor(Date.now() / windowMs);
      // Only the hash is stored. The upsert on `_id` is atomic and retried by the server on a racing duplicate key.
      const doc = await this.rateLimitModel
        .findOneAndUpdate(
          {
            _id: `${scope}:${hashToken(value.trim().toLowerCase())}:${bucket}`,
          },
          {
            $inc: { count: 1 },
            $setOnInsert: { expiresAt: new Date((bucket + 1) * windowMs) },
          },
          { upsert: true, returnDocument: 'after', lean: true },
        )
        .exec();
      if (doc!.count > limit) over = true;
    }
    if (over) {
      throw new HttpException(
        HttpException.createBody(
          TOO_MANY_REQUESTS,
          TOO_MANY_REQUESTS,
          HttpStatus.TOO_MANY_REQUESTS,
        ),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
