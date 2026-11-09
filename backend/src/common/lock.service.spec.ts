import Redis from 'ioredis';
import { AppConfig } from './app-config';
import { LockService } from './lock.service';

jest.mock('ioredis');

describe('LockService', () => {
  const redisInstance = { set: jest.fn(), eval: jest.fn(), ping: jest.fn(), quit: jest.fn().mockResolvedValue('OK') };
  let service: LockService;

  beforeEach(() => {
    jest.clearAllMocks();
    (Redis as unknown as jest.Mock).mockImplementation(() => redisInstance);
    service = new LockService({ redisUrl: 'redis://redis:6379' } as AppConfig);
  });

  it('connects with the configured URL and unlimited retries for BullMQ compatibility', () => {
    expect(Redis).toHaveBeenCalledWith('redis://redis:6379', { maxRetriesPerRequest: null, lazyConnect: false });
  });

  it('returns an ownership token when the lock is free', async () => {
    redisInstance.set.mockResolvedValue('OK');
    const token = await service.acquire('collect:acct', 5000);
    expect(token).toEqual(expect.any(String));
    expect(redisInstance.set).toHaveBeenCalledWith('lock:collect:acct', token, 'PX', 5000, 'NX');
  });

  it('returns null when somebody else holds the lock', async () => {
    redisInstance.set.mockResolvedValue(null);
    expect(await service.acquire('collect:acct', 5000)).toBeNull();
  });

  it('extends and releases only through the owner token scripts', async () => {
    await service.extend('key', 'token-1', 9000);
    expect(redisInstance.eval).toHaveBeenLastCalledWith(expect.stringContaining('pexpire'), 1, 'lock:key', 'token-1', '9000');
    await service.release('key', 'token-1');
    expect(redisInstance.eval).toHaveBeenLastCalledWith(expect.stringContaining('del'), 1, 'lock:key', 'token-1');
  });

  it('reports liveness through PING', async () => {
    redisInstance.ping.mockResolvedValueOnce('PONG').mockResolvedValueOnce('nope');
    expect(await service.ping()).toBe(true);
    expect(await service.ping()).toBe(false);
  });

  it('closes the connection on shutdown and ignores close errors', async () => {
    await service.onModuleDestroy();
    expect(redisInstance.quit).toHaveBeenCalled();
    redisInstance.quit.mockRejectedValueOnce(new Error('already closed'));
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
