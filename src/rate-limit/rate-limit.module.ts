import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RateLimit, RateLimitSchema } from './entities/rate-limit.entity.js';
import { RateLimitService } from './services/rate-limit.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RateLimit.name, schema: RateLimitSchema },
    ]),
  ],
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
