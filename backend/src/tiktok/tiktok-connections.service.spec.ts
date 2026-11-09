import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { SupabaseService } from '../common/supabase.service';
import { FakeSupabase } from '../testing/fake-supabase';
import { TikTokApiClient, TikTokApiError } from './tiktok-api.client';
import { buildAdvertiserAccountRow, TikTokConnectionsService } from './tiktok-connections.service';

const advertiser = { advertiser_id: '700', name: 'Shoe Shop', currency: 'USD', timezone: 'Etc/GMT', display_timezone: 'America/New_York', company: 'Shoe Co' };

const buildService = () => {
  const fake = new FakeSupabase();
  const crypto = { encrypt: jest.fn((text: string) => `enc(${text})`), decrypt: jest.fn((text: string) => text.replace(/^enc\(|\)$/g, '')) };
  const tiktok = { advertiserInfo: jest.fn().mockResolvedValue([advertiser]) };
  const audit = { record: jest.fn() };
  const service = new TikTokConnectionsService(
    fake as unknown as SupabaseService, crypto as unknown as CryptoService, tiktok as unknown as TikTokApiClient, audit as unknown as AuditService,
  );
  return { service, fake, crypto, tiktok, audit };
};

describe('buildAdvertiserAccountRow', () => {
  it('prefixes the advertiser id and prefers the display timezone', () => {
    expect(buildAdvertiserAccountRow('u1', 'conn', advertiser)).toMatchObject({
      user_id: 'u1', connection_id: 'conn', platform: 'tiktok', meta_account_id: 'tiktok:700', name: 'Shoe Shop', currency: 'USD',
      timezone_name: 'America/New_York', business_name: 'Shoe Co',
    });
  });
  it('falls back to nulls and the plain timezone', () => {
    expect(buildAdvertiserAccountRow('u1', 'conn', { advertiser_id: '1', timezone: 'Etc/GMT' })).toMatchObject({ name: null, currency: null, timezone_name: 'Etc/GMT', business_name: null });
  });
});

describe('TikTokConnectionsService', () => {
  describe('connect', () => {
    it('validates the token, stores it encrypted and creates a prefixed ad account per advertiser', async () => {
      const { service, fake, tiktok, audit } = buildService();
      fake.respond('meta_connections', { data: { id: 'conn-1' } });

      expect(await service.connect('u1', 'secret-token-0123456789', ['700', '700'], '  My TikTok ')).toEqual({ id: 'conn-1' });

      expect(tiktok.advertiserInfo).toHaveBeenCalledWith({ token: 'secret-token-0123456789' }, ['700']);
      const [connectionRow, options] = fake.argumentsOf('meta_connections', 'upsert') as [Record<string, unknown>, { onConflict: string }];
      expect(connectionRow).toMatchObject({
        user_id: 'u1', platform: 'tiktok', meta_user_id: 'tiktok:700', name: 'My TikTok', token_encrypted: 'enc(secret-token-0123456789)', status: 'active', scopes: [],
      });
      expect(options.onConflict).toBe('user_id,meta_user_id');
      const [accountRows] = fake.argumentsOf('ad_accounts', 'upsert') as [Record<string, unknown>[]];
      expect(accountRows).toMatchObject([{ connection_id: 'conn-1', meta_account_id: 'tiktok:700', platform: 'tiktok' }]);
      expect(audit.record).toHaveBeenCalledWith('u1', 'tiktok.connect', 'meta_connection', 'conn-1', { advertisers: 1 });
    });

    it('names the connection after the first advertiser when no label is given', async () => {
      const { service, fake } = buildService();
      fake.respond('meta_connections', { data: { id: 'conn-1' } });
      await service.connect('u1', 'secret-token-0123456789', ['700']);
      expect((fake.argumentsOf('meta_connections', 'upsert') as [Record<string, unknown>])[0].name).toBe('Shoe Shop');
    });

    it('rejects a token TikTok refuses', async () => {
      const { service, tiktok } = buildService();
      tiktok.advertiserInfo.mockRejectedValue(new TikTokApiError('Access token is invalid', 200, 40_105));
      await expect(service.connect('u1', 'bad-token-0123456789012', ['700'])).rejects.toThrow(new BadRequestException('TikTok rejected the token: Access token is invalid'));
    });

    it('rethrows unexpected errors and rejects tokens without advertiser access', async () => {
      const { service, tiktok } = buildService();
      tiktok.advertiserInfo.mockRejectedValueOnce(new Error('disk on fire'));
      await expect(service.connect('u1', 'token-0123456789012345', ['700'])).rejects.toThrow('disk on fire');
      tiktok.advertiserInfo.mockResolvedValueOnce([]);
      await expect(service.connect('u1', 'token-0123456789012345', ['700'])).rejects.toThrow('cannot access any of the given advertiser ids');
    });
  });

  describe('list', () => {
    it('lists only TikTok connections of the user', async () => {
      const { service, fake } = buildService();
      fake.respond('meta_connections', { data: [{ id: 'conn-1' }] });
      expect(await service.list('u1')).toEqual([{ id: 'conn-1' }]);
      expect(fake.callsTo('meta_connections')[0].operations.filter((operation) => operation.name === 'eq').map((operation) => operation.args)).toEqual([['user_id', 'u1'], ['platform', 'tiktok']]);
    });
  });

  describe('syncAccounts', () => {
    it('refreshes the advertisers linked to the connection', async () => {
      const { service, fake, tiktok } = buildService();
      fake.respond('meta_connections', { data: { id: 'conn-1', token_encrypted: 'enc(tok)', status: 'active' } });
      fake.respond('ad_accounts', { data: [{ meta_account_id: 'tiktok:700' }] });
      expect(await service.syncAccounts('u1', 'conn-1')).toEqual({ synced: 1 });
      expect(tiktok.advertiserInfo).toHaveBeenCalledWith({ token: 'tok', connectionId: 'conn-1' }, ['700']);
    });

    it('notes the failure on the connection and rethrows', async () => {
      const { service, fake, tiktok } = buildService();
      fake.respond('meta_connections', { data: { id: 'conn-1', token_encrypted: 'enc(tok)', status: 'active' } });
      fake.respond('ad_accounts', { data: [{ meta_account_id: 'tiktok:700' }] });
      tiktok.advertiserInfo.mockRejectedValue(new TikTokApiError('Access token is invalid', 200, 40_105));
      await expect(service.syncAccounts('u1', 'conn-1')).rejects.toThrow('Access token is invalid');
      const updates = fake.callsTo('meta_connections').flatMap((call) => call.operations.filter((operation) => operation.name === 'update').map((operation) => operation.args[0]));
      expect(updates).toContainEqual({ last_error: 'Access token is invalid', status: 'expired' });
    });
  });

  describe('remove', () => {
    it('deletes the connection and audits it', async () => {
      const { service, fake, audit } = buildService();
      fake.respond('meta_connections', { data: [{ id: 'conn-1' }] });
      await service.remove('u1', 'conn-1');
      expect(audit.record).toHaveBeenCalledWith('u1', 'tiktok.disconnect', 'meta_connection', 'conn-1');
    });
    it('404s for unknown connections', async () => {
      const { service } = buildService();
      await expect(service.remove('u1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('contextFor', () => {
    it('decrypts the token', async () => {
      const { service, fake } = buildService();
      fake.respond('meta_connections', { data: { id: 'conn-1', token_encrypted: 'enc(tok)', status: 'active' } });
      expect(await service.contextFor('u1', 'conn-1')).toEqual({ token: 'tok', connectionId: 'conn-1' });
    });
    it('rejects unknown, expired and revoked connections', async () => {
      const { service, fake } = buildService();
      fake.respond('meta_connections', { data: null });
      await expect(service.contextFor('u1', 'x')).rejects.toBeInstanceOf(NotFoundException);
      for (const status of ['expired', 'revoked']) {
        const next = buildService();
        next.fake.respond('meta_connections', { data: { id: 'c', token_encrypted: 'enc(t)', status } });
        await expect(next.service.contextFor('u1', 'c')).rejects.toBeInstanceOf(BadRequestException);
      }
    });
  });

  describe('contextForAccount', () => {
    it('returns the account, advertiser id and context', async () => {
      const { service, fake } = buildService();
      fake.respond('ad_accounts', { data: { id: 'acc-1', connection_id: 'conn-1', meta_account_id: 'tiktok:700' } });
      fake.respond('meta_connections', { data: { id: 'conn-1', token_encrypted: 'enc(tok)', status: 'active' } });
      expect(await service.contextForAccount('u1', 'acc-1')).toMatchObject({ advertiserId: '700', context: { token: 'tok' }, account: { id: 'acc-1' } });
    });
    it('404s for unknown accounts', async () => {
      const { service, fake } = buildService();
      fake.respond('ad_accounts', { data: null });
      await expect(service.contextForAccount('u1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('noteFailure', () => {
    it('stores the message and leaves the status alone for non-auth errors', async () => {
      const { service, fake } = buildService();
      await service.noteFailure('conn-1', new Error('boom'));
      await service.noteFailure('conn-1', 'plain text');
      const updates = fake.callsTo('meta_connections').map((call) => call.operations.find((operation) => operation.name === 'update')?.args[0]);
      expect(updates).toEqual([{ last_error: 'boom' }, { last_error: 'plain text' }]);
    });
  });
});
