import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { must, SupabaseService } from '../common/supabase.service';
import { AdAccountRow, MetaConnectionRow, TikTokAdvertiser } from '../common/types';
import { TikTokApiClient, TikTokApiError, TikTokContext } from './tiktok-api.client';
import { prefixTikTokId, stripTikTokPrefix } from './tiktok-mappers';

const PUBLIC_COLUMNS = 'id,meta_user_id,name,token_expires_at,scopes,graph_version,status,last_validated_at,last_error,created_at';

/** Ad account row for one TikTok advertiser. */
export function buildAdvertiserAccountRow(userId: string, connectionId: string, advertiser: TikTokAdvertiser) {
  return {
    user_id: userId,
    connection_id: connectionId,
    platform: 'tiktok',
    meta_account_id: prefixTikTokId(advertiser.advertiser_id),
    name: advertiser.name ?? null,
    currency: advertiser.currency ?? null,
    timezone_name: advertiser.display_timezone ?? advertiser.timezone ?? null,
    business_name: advertiser.company ?? null,
    raw: advertiser,
  };
}

@Injectable()
export class TikTokConnectionsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly crypto: CryptoService,
    private readonly tiktok: TikTokApiClient,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string) {
    const response = await this.supabase.from('meta_connections').select(PUBLIC_COLUMNS).eq('user_id', userId).eq('platform', 'tiktok').order('created_at');
    return must(response, 'list TikTok connections');
  }

  /** Validates the token against the given advertisers, stores it encrypted and creates one ad account per advertiser. */
  async connect(userId: string, token: string, advertiserIds: string[], name?: string) {
    const uniqueIds = [...new Set(advertiserIds)];
    let advertisers: TikTokAdvertiser[];
    try {
      advertisers = await this.tiktok.advertiserInfo({ token }, uniqueIds);
    } catch (error) {
      if (error instanceof TikTokApiError) throw new BadRequestException(`TikTok rejected the token: ${error.message}`);
      throw error;
    }
    if (advertisers.length === 0) throw new BadRequestException('The token cannot access any of the given advertiser ids.');

    const response = await this.supabase
      .from('meta_connections')
      .upsert(
        {
          user_id: userId,
          platform: 'tiktok',
          meta_user_id: prefixTikTokId(advertisers[0].advertiser_id),
          name: name?.trim() || advertisers[0].name || null,
          token_encrypted: this.crypto.encrypt(token),
          token_expires_at: null,
          scopes: [],
          status: 'active',
          last_validated_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: 'user_id,meta_user_id' },
      )
      .select(PUBLIC_COLUMNS)
      .single();
    const connection = must<{ id: string }>(response, 'save TikTok connection');
    await this.saveAccounts(userId, connection.id, advertisers);
    await this.audit.record(userId, 'tiktok.connect', 'meta_connection', connection.id, { advertisers: advertisers.length });
    return connection;
  }

  private async saveAccounts(userId: string, connectionId: string, advertisers: TikTokAdvertiser[]): Promise<void> {
    const rows = advertisers.map((advertiser) => buildAdvertiserAccountRow(userId, connectionId, advertiser));
    must(await this.supabase.from('ad_accounts').upsert(rows, { onConflict: 'user_id,meta_account_id' }), 'save TikTok ad accounts');
  }

  /** Refreshes name / currency / timezone of the advertisers already linked to the connection. */
  async syncAccounts(userId: string, connectionId: string): Promise<{ synced: number }> {
    const context = await this.contextFor(userId, connectionId);
    const accounts = must<Pick<AdAccountRow, 'meta_account_id'>[]>(
      await this.supabase.from('ad_accounts').select('meta_account_id').eq('connection_id', connectionId).eq('user_id', userId),
      'load TikTok ad accounts',
    );
    let advertisers: TikTokAdvertiser[];
    try {
      advertisers = await this.tiktok.advertiserInfo(context, accounts.map((account) => stripTikTokPrefix(account.meta_account_id)));
    } catch (error) {
      await this.noteFailure(connectionId, error);
      throw error;
    }
    await this.saveAccounts(userId, connectionId, advertisers);
    await this.supabase.from('meta_connections').update({ last_validated_at: new Date().toISOString(), status: 'active', last_error: null }).eq('id', connectionId);
    return { synced: advertisers.length };
  }

  async remove(userId: string, connectionId: string): Promise<void> {
    const response = await this.supabase.from('meta_connections').delete().eq('id', connectionId).eq('user_id', userId).eq('platform', 'tiktok').select('id');
    if (must<{ id: string }[]>(response, 'delete TikTok connection').length === 0) throw new NotFoundException('Connection not found');
    await this.audit.record(userId, 'tiktok.disconnect', 'meta_connection', connectionId);
  }

  /** Decrypts the stored token. Only ever used server-side. */
  async contextFor(userId: string, connectionId: string): Promise<TikTokContext> {
    const response = await this.supabase
      .from('meta_connections')
      .select('id,token_encrypted,status')
      .eq('id', connectionId)
      .eq('user_id', userId)
      .eq('platform', 'tiktok')
      .maybeSingle();
    const connection = must<Pick<MetaConnectionRow, 'id' | 'token_encrypted' | 'status'> | null>(response, 'load TikTok connection');
    if (!connection) throw new NotFoundException('Connection not found');
    if (connection.status === 'expired' || connection.status === 'revoked') {
      throw new BadRequestException('TikTok connection is no longer valid. Reconnect the account.');
    }
    return { token: this.crypto.decrypt(connection.token_encrypted), connectionId: connection.id };
  }

  /** The ad account row, its TikTok advertiser id and the decrypted API context. */
  async contextForAccount(userId: string, adAccountId: string): Promise<{ account: AdAccountRow; advertiserId: string; context: TikTokContext }> {
    const response = await this.supabase.from('ad_accounts').select('*').eq('id', adAccountId).eq('user_id', userId).eq('platform', 'tiktok').maybeSingle();
    const account = must<AdAccountRow | null>(response, 'load TikTok ad account');
    if (!account) throw new NotFoundException('Ad account not found');
    return { account, advertiserId: stripTikTokPrefix(account.meta_account_id), context: await this.contextFor(userId, account.connection_id) };
  }

  /** Flags the connection when TikTok says the token is dead. */
  async noteFailure(connectionId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const expired = error instanceof TikTokApiError && error.isAuth;
    await this.supabase
      .from('meta_connections')
      .update({ last_error: message.slice(0, 500), ...(expired ? { status: 'expired' } : {}) })
      .eq('id', connectionId);
  }
}
