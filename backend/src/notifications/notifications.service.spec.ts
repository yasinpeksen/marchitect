import { SupabaseService } from '../common/supabase.service';
import { FakeSupabase } from '../testing/fake-supabase';
import { NotificationsService } from './notifications.service';

const buildService = () => {
  const fake = new FakeSupabase();
  return { fake, service: new NotificationsService(fake as unknown as SupabaseService) };
};

describe('NotificationsService', () => {
  it('stores a notification for the user', async () => {
    const { fake, service } = buildService();
    await service.notify('u1', 'schedule_failed', 'Title', 'Body', { run_id: 'r1' });
    expect(fake.argumentsOf('notifications', 'insert')).toEqual([{ user_id: 'u1', type: 'schedule_failed', title: 'Title', body: 'Body', data: { run_id: 'r1' } }]);
  });

  it('lists recent notifications, optionally only unread', async () => {
    const { fake, service } = buildService();
    fake.respond('notifications', { data: [{ id: 'n1' }] });
    expect(await service.list('u1', false)).toEqual([{ id: 'n1' }]);
    expect(fake.argumentsOf('notifications', 'is')).toBeUndefined();
    await service.list('u1', true);
    expect(fake.callsTo('notifications')[1].operations).toContainEqual({ name: 'is', args: ['read_at', null] });
  });

  it('marks all unread notifications as read', async () => {
    const { fake, service } = buildService();
    await service.markRead('u1');
    const operations = fake.callsTo('notifications')[0].operations;
    expect(operations.find((operation) => operation.name === 'update')?.args[0]).toEqual({ read_at: expect.any(String) });
    expect(operations.some((operation) => operation.name === 'in')).toBe(false);
  });

  it('marks only the given notifications as read', async () => {
    const { fake, service } = buildService();
    await service.markRead('u1', ['n1', 'n2']);
    expect(fake.argumentsOf('notifications', 'in')).toEqual(['id', ['n1', 'n2']]);
  });

  it('surfaces database errors', async () => {
    const { fake, service } = buildService();
    fake.respond('notifications', { error: { message: 'db down' } });
    await expect(service.markRead('u1')).rejects.toThrow('mark read: db down');
  });
});
