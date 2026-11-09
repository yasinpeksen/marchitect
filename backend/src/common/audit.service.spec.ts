import { Logger } from '@nestjs/common';
import { FakeSupabase } from '../testing/fake-supabase';
import { AuditService } from './audit.service';
import { SupabaseService } from './supabase.service';

describe('AuditService', () => {
  it('writes an audit row with the provided details', async () => {
    const fake = new FakeSupabase();
    await new AuditService(fake as unknown as SupabaseService).record('u1', 'meta.connect', 'meta_connection', 'c1', { scopes: ['ads_read'] }, '10.0.0.1');
    expect(fake.argumentsOf('audit_logs', 'insert')).toEqual([
      { user_id: 'u1', action: 'meta.connect', entity_type: 'meta_connection', entity_id: 'c1', metadata: { scopes: ['ads_read'] }, ip: '10.0.0.1' },
    ]);
  });

  it('never throws when the insert fails (best effort)', async () => {
    const fake = new FakeSupabase().respond('audit_logs', { error: { message: 'db down' } });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await expect(new AuditService(fake as unknown as SupabaseService).record(null, 'x')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
    warn.mockRestore();
  });
});
