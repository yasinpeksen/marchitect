import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppConfig } from '../common/app-config';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { SupabaseService } from '../common/supabase.service';
import { buildTestConfig, FakeSupabase } from '../testing/fake-supabase';
import { MetaApiClient, MetaApiError } from './meta-api.client';
import { MetaConnectionsService } from './meta-connections.service';

const buildService = (configOverrides: Record<string, unknown> = {}) => {
  const fake = new FakeSupabase();
  const crypto = {
    encrypt: jest.fn((text: string) => `enc(${text})`),
    decrypt: jest.fn((text: string) => text.replace(/^enc\(|\)$/g, '')),
    sign: jest.fn((text: string) => `sig-${text.length}`),
  };
  const meta = {
    me: jest.fn().mockResolvedValue({ id: 'meta-user', name: 'Meta User' }),
    permissions: jest.fn().mockResolvedValue({ data: [{ permission: 'ads_read', status: 'granted' }, { permission: 'business_management', status: 'declined' }] }),
    listAdAccounts: jest.fn().mockResolvedValue([{ id: 'act_1', name: 'Account', currency: 'USD', business: { id: 'b1', name: 'Biz' } }]),
    get: jest.fn(),
  };
  const audit = { record: jest.fn() };
  const service = new MetaConnectionsService(
    fake as unknown as SupabaseService,
    crypto as unknown as CryptoService,
    meta as unknown as MetaApiClient,
    buildTestConfig(configOverrides) as unknown as AppConfig,
    audit as unknown as AuditService,
  );
  return { service, fake, crypto, meta, audit };
};

describe('MetaConnectionsService', () => {
  describe('status', () => {
    it('reports configuration and required permissions', () => {
      const { service } = buildService({ metaAppId: 'app', metaAppSecret: 'secret', adLibraryEnabled: true });
      expect(service.status()).toEqual({
        oauthConfigured: true, graphVersion: 'v24.0', adLibraryEnabled: true,
        requiredPermissions: ['ads_read'], optionalPermissions: ['business_management'],
      });
    });
    it('reports OAuth as unconfigured without app credentials', () => expect(buildService().service.status().oauthConfigured).toBe(false));
  });

  describe('list', () => {
    it('lists the user connections without the encrypted token column', async () => {
      const { service, fake } = buildService();
      fake.respond('meta_connections', { data: [{ id: 'c1' }] });
      expect(await service.list('u1')).toEqual([{ id: 'c1' }]);
      expect(String((fake.argumentsOf('meta_connections', 'select') as string[])[0])).not.toContain('token_encrypted');
      expect(fake.argumentsOf('meta_connections', 'eq')).toEqual(['user_id', 'u1']);
    });
  });

  describe('connect', () => {
    it('validates the token, stores it encrypted, syncs accounts and audits', async () => {
      const { service, fake, meta, audit } = buildService();
      fake.respond('meta_connections', { data: { id: 'conn-1' } }); // upsert().single()
      fake.respond('meta_connections', { data: { id: 'conn-1', token_encrypted: 'enc(EAAtoken)', graph_version: null, status: 'active' } }); // contextFor
      fake.respond('ad_accounts', { data: [] });
      const connection = await service.connect('u1', 'EAAtoken', '  My label ');
      expect(connection).toEqual({ id: 'conn-1' });
      const upsert = fake.argumentsOf('meta_connections', 'upsert') as [Record<string, unknown>, unknown];
      expect(upsert[0]).toMatchObject({
        user_id: 'u1', meta_user_id: 'meta-user', name: 'My label', token_encrypted: 'enc(EAAtoken)', scopes: ['ads_read'], status: 'active',
      });
      expect(JSON.stringify(upsert[0])).not.toContain('"EAAtoken"');
      expect(meta.listAdAccounts).toHaveBeenCalledWith({ token: 'EAAtoken', version: null, connectionId: 'conn-1' });
      expect(audit.record).toHaveBeenCalledWith('u1', 'meta.connect', 'meta_connection', 'conn-1', { scopes: ['ads_read'] });
    });

    it('uses the Meta profile name when no label is given', async () => {
      const { service, fake } = buildService();
      fake.respond('meta_connections', { data: { id: 'c' } });
      fake.respond('meta_connections', { data: { id: 'c', token_encrypted: 'enc(EAAtoken)', status: 'active' } });
      await service.connect('u1', 'EAAtoken');
      expect((fake.argumentsOf('meta_connections', 'upsert') as [Record<string, unknown>])[0].name).toBe('Meta User');
    });

    it('rejects a token Meta refuses', async () => {
      const { service, meta } = buildService();
      meta.me.mockRejectedValue(new MetaApiError('Invalid OAuth access token', 400, 190));
      await expect(service.connect('u1', 'EAAbad')).rejects.toThrow('Meta rejected the token: Invalid OAuth access token');
    });

    it('rethrows non-Meta failures untouched', async () => {
      const { service, meta } = buildService();
      meta.me.mockRejectedValue(new TypeError('network down'));
      await expect(service.connect('u1', 'EAAtoken')).rejects.toThrow(TypeError);
    });

    it('requires ads_read when permissions are listed', async () => {
      const { service, meta } = buildService();
      meta.permissions.mockResolvedValue({ data: [{ permission: 'email', status: 'granted' }] });
      await expect(service.connect('u1', 'EAAtoken')).rejects.toThrow('missing the required permission: ads_read');
    });

    it('accepts system-user tokens that list no permissions', async () => {
      const { service, fake, meta } = buildService();
      meta.permissions.mockResolvedValue({ data: [] });
      fake.respond('meta_connections', { data: { id: 'c' } });
      fake.respond('meta_connections', { data: { id: 'c', token_encrypted: 'enc(EAAtoken)', status: 'active' } });
      await expect(service.connect('u1', 'EAAtoken')).resolves.toEqual({ id: 'c' });
    });

    it('records the expiry reported by debug_token when the app is configured', async () => {
      const { service, fake, meta } = buildService({ metaAppId: 'app', metaAppSecret: 'secret' });
      meta.get.mockResolvedValue({ data: { expires_at: 1_900_000_000 } });
      fake.respond('meta_connections', { data: { id: 'c' } });
      fake.respond('meta_connections', { data: { id: 'c', token_encrypted: 'enc(EAAtoken)', status: 'active' } });
      await service.connect('u1', 'EAAtoken');
      expect((fake.argumentsOf('meta_connections', 'upsert') as [Record<string, unknown>])[0].token_expires_at).toEqual(new Date(1_900_000_000_000));
      expect(meta.get).toHaveBeenCalledWith({ token: 'app|secret' }, 'debug_token', { input_token: 'EAAtoken' });
    });

    it('ignores debug_token failures', async () => {
      const { service, fake, meta } = buildService({ metaAppId: 'app', metaAppSecret: 'secret' });
      meta.get.mockRejectedValue(new Error('nope'));
      fake.respond('meta_connections', { data: { id: 'c' } });
      fake.respond('meta_connections', { data: { id: 'c', token_encrypted: 'enc(EAAtoken)', status: 'active' } });
      await service.connect('u1', 'EAAtoken');
      expect((fake.argumentsOf('meta_connections', 'upsert') as [Record<string, unknown>])[0].token_expires_at).toBeNull();
    });
  });

  describe('syncAccounts', () => {
    const connectionRow = { id: 'c1', token_encrypted: 'enc(EAAtoken)', graph_version: 'v22.0', status: 'active' };

    it('upserts the accounts Meta returns', async () => {
      const { service, fake } = buildService();
      fake.respond('meta_connections', { data: connectionRow });
      expect(await service.syncAccounts('u1', 'c1')).toEqual({ synced: 1 });
      const [rows, options] = fake.argumentsOf('ad_accounts', 'upsert') as [Record<string, unknown>[], Record<string, string>];
      expect(rows[0]).toMatchObject({ user_id: 'u1', connection_id: 'c1', meta_account_id: 'act_1', business_name: 'Biz' });
      expect(options).toEqual({ onConflict: 'user_id,meta_account_id' });
    });

    it('does not write when Meta returns no accounts', async () => {
      const { service, fake, meta } = buildService();
      meta.listAdAccounts.mockResolvedValue([]);
      fake.respond('meta_connections', { data: connectionRow });
      expect(await service.syncAccounts('u1', 'c1')).toEqual({ synced: 0 });
      expect(fake.callsTo('ad_accounts')).toHaveLength(0);
    });

    it('flags the connection when listing accounts fails with an auth error', async () => {
      const { service, fake, meta } = buildService();
      meta.listAdAccounts.mockRejectedValue(new MetaApiError('expired', 401, 190));
      fake.respond('meta_connections', { data: connectionRow });
      await expect(service.syncAccounts('u1', 'c1')).rejects.toBeInstanceOf(MetaApiError);
      const updates = fake.callsTo('meta_connections').flatMap((call) => call.operations.filter((operation) => operation.name === 'update'));
      expect(updates[0].args[0]).toMatchObject({ status: 'expired', last_error: 'expired' });
    });
  });

  describe('remove', () => {
    it('deletes the connection and audits', async () => {
      const { service, fake, audit } = buildService();
      fake.respond('meta_connections', { data: [{ id: 'c1' }] });
      await service.remove('u1', 'c1');
      expect(audit.record).toHaveBeenCalledWith('u1', 'meta.disconnect', 'meta_connection', 'c1');
    });
    it('throws when nothing was deleted', async () => {
      const { service } = buildService();
      await expect(service.remove('u1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('contextFor', () => {
    it('decrypts the token and carries the Graph version', async () => {
      const { service, fake } = buildService();
      fake.respond('meta_connections', { data: { id: 'c1', token_encrypted: 'enc(EAAtoken)', graph_version: 'v22.0', status: 'active' } });
      expect(await service.contextFor('u1', 'c1')).toEqual({ token: 'EAAtoken', version: 'v22.0', connectionId: 'c1' });
    });
    it('throws when the connection does not exist', async () => {
      const { service, fake } = buildService();
      fake.respond('meta_connections', { data: null });
      await expect(service.contextFor('u1', 'c1')).rejects.toThrow(NotFoundException);
    });
    it.each(['expired', 'revoked'])('refuses %s connections', async (status) => {
      const { service, fake } = buildService();
      fake.respond('meta_connections', { data: { id: 'c1', token_encrypted: 'x', status } });
      await expect(service.contextFor('u1', 'c1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('contextForAccount', () => {
    it('returns the account with the connection context', async () => {
      const { service, fake } = buildService();
      fake.respond('ad_accounts', { data: { id: 'a1', connection_id: 'c1', meta_account_id: 'act_1' } });
      fake.respond('meta_connections', { data: { id: 'c1', token_encrypted: 'enc(EAAtoken)', graph_version: null, status: 'active' } });
      const result = await service.contextForAccount('u1', 'a1');
      expect(result.account.meta_account_id).toBe('act_1');
      expect(result.context.token).toBe('EAAtoken');
    });
    it('throws for an unknown account', async () => {
      const { service, fake } = buildService();
      fake.respond('ad_accounts', { data: null });
      await expect(service.contextForAccount('u1', 'a1')).rejects.toThrow('Ad account not found');
    });
  });

  describe('noteFailure', () => {
    it('stores a truncated message and leaves the status alone for ordinary errors', async () => {
      const { service, fake } = buildService();
      await service.noteFailure('c1', new Error('x'.repeat(600)));
      const [patch] = fake.argumentsOf('meta_connections', 'update') as [Record<string, unknown>];
      expect((patch.last_error as string).length).toBe(500);
      expect(patch).not.toHaveProperty('status');
    });
    it('marks the connection expired for auth errors', async () => {
      const { service, fake } = buildService();
      await service.noteFailure('c1', new MetaApiError('dead', 401, 190));
      expect((fake.argumentsOf('meta_connections', 'update') as [Record<string, unknown>])[0]).toMatchObject({ status: 'expired' });
    });
    it('accepts non-Error values', async () => {
      const { service, fake } = buildService();
      await service.noteFailure('c1', 'plain text');
      expect((fake.argumentsOf('meta_connections', 'update') as [Record<string, unknown>])[0].last_error).toBe('plain text');
    });
  });

  describe('OAuth', () => {
    it('builds and verifies a signed, time-limited state', () => {
      const { service } = buildService();
      const state = service.buildOAuthState('user-1', 1_000_000);
      expect(service.verifyOAuthState(state, 1_000_000 + 60_000)).toBe('user-1');
      expect(service.verifyOAuthState(state, 1_000_000 + 11 * 60_000)).toBeNull();
    });
    it.each(['', 'a.b', 'a.b.c.d'])('rejects a malformed state %p', (state) => {
      expect(buildService().service.verifyOAuthState(state)).toBeNull();
    });
    it('rejects a tampered signature', () => {
      const { service } = buildService();
      expect(service.verifyOAuthState('user-1.1000000.forged')).toBeNull();
    });

    it('requires app credentials to start OAuth', () => {
      expect(() => buildService().service.oauthUrl('u1')).toThrow('Meta OAuth is not configured');
    });
    it('builds the login dialog URL from the configurable dialog base', () => {
      const { service } = buildService({ metaAppId: 'app-1', metaAppSecret: 'secret', metaDialogBaseUrl: 'http://mock-meta:4010' });
      const url = new URL(service.oauthUrl('u1').url);
      expect(url.origin + url.pathname).toBe('http://mock-meta:4010/v24.0/dialog/oauth');
      expect(url.searchParams.get('client_id')).toBe('app-1');
      expect(url.searchParams.get('scope')).toBe('ads_read,business_management');
      expect(service.verifyOAuthState(url.searchParams.get('state') as string)).toBe('u1');
    });

    describe('callback', () => {
      let fetchMock: jest.SpiedFunction<typeof fetch>;
      beforeEach(() => {
        fetchMock = jest.spyOn(globalThis, 'fetch');
      });
      afterEach(() => fetchMock.mockRestore());

      it('rejects an invalid state', async () => {
        await expect(buildService().service.oauthCallback('code', 'bad')).rejects.toThrow('Invalid or expired OAuth state');
      });

      it('exchanges the code for a long-lived token and connects the account', async () => {
        const { service, fake } = buildService({ metaAppId: 'app-1', metaAppSecret: 'secret' });
        fetchMock
          .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'EAAshort' })))
          .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'EAAlong', expires_in: 5_184_000 })));
        fake.respond('meta_connections', { data: { id: 'c' } });
        fake.respond('meta_connections', { data: { id: 'c', token_encrypted: 'enc(EAAlong)', status: 'active' } });
        const userId = await service.oauthCallback('the-code', service.buildOAuthState('u1'));
        expect(userId).toBe('u1');
        const first = new URL(String(fetchMock.mock.calls[0][0]));
        expect(first.origin + first.pathname).toBe('https://graph.example.test/v24.0/oauth/access_token');
        expect(first.searchParams.get('code')).toBe('the-code');
        expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('fb_exchange_token')).toBe('EAAshort');
        const [record] = fake.argumentsOf('meta_connections', 'upsert') as [Record<string, unknown>];
        expect(record.token_encrypted).toBe('enc(EAAlong)');
        expect(record.token_expires_at).toBeInstanceOf(Date);
      });

      it('surfaces Meta exchange errors', async () => {
        const { service } = buildService({ metaAppId: 'app-1', metaAppSecret: 'secret' });
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Code expired' } }), { status: 400 }));
        await expect(service.oauthCallback('c', service.buildOAuthState('u1'))).rejects.toThrow('Meta token exchange failed: Code expired');
      });
    });
  });
});
