import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { AppConfig } from './app-config';

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
const EXTEND_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;

/** Redis SET NX PX distributed lock (single Redis node). */
@Injectable()
export class LockService implements OnModuleDestroy {
  readonly redis: Redis;

  constructor(config: AppConfig) {
    this.redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }

  /** Returns an ownership token when the lock was taken, `null` when someone else holds it. */
  async acquire(key: string, timeToLiveMs: number): Promise<string | null> {
    const ownerToken = randomUUID();
    const result = await this.redis.set(`lock:${key}`, ownerToken, 'PX', timeToLiveMs, 'NX');
    return result === 'OK' ? ownerToken : null;
  }

  async extend(key: string, ownerToken: string, timeToLiveMs: number): Promise<void> {
    await this.redis.eval(EXTEND_SCRIPT, 1, `lock:${key}`, ownerToken, String(timeToLiveMs));
  }

  /** Only the owner (matching token) can release. */
  async release(key: string, ownerToken: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, `lock:${key}`, ownerToken);
  }

  async ping(): Promise<boolean> {
    return (await this.redis.ping()) === 'PONG';
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
