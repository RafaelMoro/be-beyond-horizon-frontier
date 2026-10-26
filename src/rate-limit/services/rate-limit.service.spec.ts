import { HttpException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { RateLimit } from '../entities/rate-limit.entity.js';
import { RateLimitService } from './rate-limit.service.js';

const NOW = new Date('2026-10-25T12:07:00.000Z').getTime();
const LOGIN_WINDOW = 15 * 60_000;
const HOUR = 3_600_000;

describe('RateLimitService', () => {
  let service: RateLimitService;
  const model = { findOneAndUpdate: vi.fn() };
  const counts = (...values: number[]) => {
    for (const count of values) {
      model.findOneAndUpdate.mockReturnValueOnce({
        exec: vi.fn().mockResolvedValue({ count }),
      });
    }
  };
  const ids = () =>
    model.findOneAndUpdate.mock.calls.map((c) => (c[0] as { _id: string })._id);

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitService,
        { provide: getModelToken(RateLimit.name), useValue: model },
      ],
    }).compile();
    service = module.get<RateLimitService>(RateLimitService);
  });

  afterEach(() => vi.useRealTimers());

  it('upserts scope:<sha256>:<bucket> with $inc + $setOnInsert at the bucket end, never storing the raw value', async () => {
    counts(1);
    await service.consume([{ scope: 'login', value: 'a@b.com' }]);
    const bucket = Math.floor(NOW / LOGIN_WINDOW);
    const [filter, update, opts] = model.findOneAndUpdate.mock.calls[0];
    expect(filter._id).toMatch(new RegExp(`^login:[0-9a-f]{64}:${bucket}$`));
    expect(update).toStrictEqual({
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date((bucket + 1) * LOGIN_WINDOW) },
    });
    expect(opts).toStrictEqual({
      upsert: true,
      returnDocument: 'after',
      lean: true,
    });
    expect(JSON.stringify(model.findOneAndUpdate.mock.calls)).not.toContain(
      'a@b.com',
    );
  });

  it('normalizes trim + lowercase into the same key', async () => {
    counts(1, 1);
    await service.consume([{ scope: 'login', value: ' A@B.com ' }]);
    await service.consume([{ scope: 'login', value: 'a@b.com' }]);
    expect(ids()[0]).toBe(ids()[1]);
  });

  it('count === limit passes, limit + 1 throws the enveloped 429 body', async () => {
    counts(10, 11);
    await expect(
      service.consume([{ scope: 'login', value: 'a@b.com' }]),
    ).resolves.toBeUndefined();
    const err = await service
      .consume([{ scope: 'login', value: 'a@b.com' }])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).getResponse()).toStrictEqual({
      message: 'Too Many Requests',
      error: 'Too Many Requests',
      statusCode: 429,
    });
  });

  it('counts every hit even when the first is already over', async () => {
    counts(4, 1);
    await expect(
      service.consume([
        { scope: 'forgotPasswordEmail', value: 'a@b.com' },
        { scope: 'forgotPasswordIp', value: '::1' },
      ]),
    ).rejects.toThrow('Too Many Requests');
    expect(ids()).toHaveLength(2);
    expect(ids()[0]).toMatch(/^forgotPasswordEmail:/);
    expect(ids()[1]).toMatch(/^forgotPasswordIp:/);
  });

  it('a later window gets a new key', async () => {
    counts(1, 1);
    await service.consume([{ scope: 'forgotPasswordIp', value: '::1' }]);
    vi.setSystemTime(NOW + HOUR);
    await service.consume([{ scope: 'forgotPasswordIp', value: '::1' }]);
    expect(ids()[0]).not.toBe(ids()[1]);
    expect(ids()[1]).toMatch(new RegExp(`:${Math.floor(NOW / HOUR) + 1}$`));
  });
});
