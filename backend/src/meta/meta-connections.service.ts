import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppConfig } from '../common/app-config';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { must, SupabaseService } from '../common/supabase.service';
import { AdAccountRow, MetaAdAccount, MetaConnectionRow } from '../common/types';
import { MetaApiClient, MetaApiError, MetaContext } from './meta-api.client';

export const REQUIRED_SCOPES = ['ads_read'];
export const OPTIONAL_SCOPES = ['business_management'];
const OAUTH_STATE_MAX_AGE_MS = 10 * 60_000;
const PUBLIC_COLUMNS =
  'id,meta_user_id,name,token_expires_at,scopes,graph_version,status,last_validated_at,last_error,created_at';

interface OAuthTokenResponse {
  access_token: string;
  expires_in?: number;
}

@Injectable()
export class MetaConnectionsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly crypto: CryptoService,
    private readonly meta: MetaApiClient,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string) {
    const response = await this.supabase.from('meta_connections').select(PUBLIC_COLUMNS).eq('user_id', userId).eq('platform', 'meta').order('created_at');
    return must(response, 'list connections');
  }

  status() {
    return {
      oauthConfigured: Boolean(this.config.metaAppId && this.config.metaAppSecret),
      graphVersion: this.config.metaGraphVersion,
      adLibraryEnabled: this.config.adLibraryEnabled,
      requiredPermissions: REQUIRED_SCOPES,
      optionalPermissions: OPTIONAL_SCOPES,
    };
  }

  /** Validate a token against Meta, verify permissions, store it encrypted and sync ad accounts. */
  async connect(userId: string, token: string, name?: string, expiresAt?: Date | null) {
    const context: MetaContext = { token };
    let profile: { id: string; name?: string };
    let grantedPermissions: string[];
    try {
      profile = await this.meta.me(context);
      const permissions = await this.meta.permissions(context);
      grantedPermissions = permissions.data.filter((entry) => entry.status === 'granted').map((entry) => entry.permission);
    } catch (error) {
      if (error instanceof MetaApiError) throw new BadRequestException(`Meta rejected the token: ${error.message}`);
      throw error;
    }
    // System-user tokens may not list permissions; only reject when a list is returned without ads_read.
    if (grantedPermissions.length > 0 && !grantedPermissions.includes('ads_read')) {
      throw new BadRequestException(`Token is missing the required permission: ads_read (granted: ${grantedPermissions.join(', ')})`);
    }

    const tokenExpiry = expiresAt ?? (await this.tokenExpiry(token));
    const response = await this.supabase
      .from('meta_connections')
      .upsert(
        {
          user_id: userId,
          meta_user_id: profile.id,
          name: name?.trim() || profile.name,
          token_encrypted: this.crypto.encrypt(token),
          token_expires_at: tokenExpiry,
          scopes: grantedPermissions,
          status: 'active',
          last_validated_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: 'user_id,meta_user_id' },
      )
      .select(PUBLIC_COLUMNS)
      .single();
    const connection = must<{ id: string }>(response, 'save connection');
    await this.syncAccounts(userId, connection.id);
    await this.audit.record(userId, 'meta.connect', 'meta_connection', connection.id, { scopes: grantedPermissions });
    return connection;
  }

  private async tokenExpiry(token: string): Promise<Date | null> {
    if (!this.config.metaAppId || !this.config.metaAppSecret) return null;
    try {
      const debug = await this.meta.get<{ data?: { data_access_expires_at?: number; expires_at?: number } }>(
        { token: `${this.config.metaAppId}|${this.config.metaAppSecret}` },
        'debug_token',
        { input_token: token },
      );
      const expiresAtSeconds = debug.data?.data_access_expires_at || debug.data?.expires_at;
      return expiresAtSeconds ? new Date(expiresAtSeconds * 1000) : null;
    } catch {
      return null;
    }
  }

  async syncAccounts(userId: string, connectionId: string): Promise<{ synced: number }> {
    const context = await this.contextFor(userId, connectionId);
    let accounts: MetaAdAccount[];
    try {
      accounts = await this.meta.listAdAccounts(context);
    } catch (error) {
      await this.noteFailure(connectionId, error);
      throw error;
    }
    if (accounts.length > 0) {
      const rows = accounts.map((account) => ({
        user_id: userId,
        connection_id: connectionId,
        meta_account_id: account.id,
        name: account.name,
        currency: account.currency,
        timezone_name: account.timezone_name,
        account_status: account.account_status,
        business_id: account.business?.id,
        business_name: account.business?.name,
        raw: account,
      }));
      must(await this.supabase.from('ad_accounts').upsert(rows, { onConflict: 'user_id,meta_account_id' }), 'save ad accounts');
    }
    await this.supabase
      .from('meta_connections')
      .update({ last_validated_at: new Date().toISOString(), status: 'active', last_error: null })
      .eq('id', connectionId);
    return { synced: accounts.length };
  }

  async remove(userId: string, connectionId: string): Promise<void> {
    const response = await this.supabase.from('meta_connections').delete().eq('id', connectionId).eq('user_id', userId).eq('platform', 'meta').select('id');
    if (must<{ id: string }[]>(response, 'delete connection').length === 0) throw new NotFoundException('Connection not found');
    await this.audit.record(userId, 'meta.disconnect', 'meta_connection', connectionId);
  }

  /** Decrypts the stored token. Only ever used server-side. */
  async contextFor(userId: string, connectionId: string): Promise<MetaContext> {
    const response = await this.supabase
      .from('meta_connections')
      .select('id,token_encrypted,graph_version,status')
      .eq('id', connectionId)
      .eq('user_id', userId)
      .eq('platform', 'meta')
      .maybeSingle();
    const connection = must<Pick<MetaConnectionRow, 'id' | 'token_encrypted' | 'graph_version' | 'status'> | null>(response, 'load connection');
    if (!connection) throw new NotFoundException('Connection not found');
    if (connection.status === 'expired' || connection.status === 'revoked') {
      throw new BadRequestException('Meta connection is no longer valid. Reconnect the account.');
    }
    return { token: this.crypto.decrypt(connection.token_encrypted), version: connection.graph_version, connectionId: connection.id };
  }

  async contextForAccount(userId: string, adAccountId: string): Promise<{ account: AdAccountRow; context: MetaContext }> {
    const response = await this.supabase.from('ad_accounts').select('*').eq('id', adAccountId).eq('user_id', userId).maybeSingle();
    const account = must<AdAccountRow | null>(response, 'load ad account');
    if (!account) throw new NotFoundException('Ad account not found');
    return { account, context: await this.contextFor(userId, account.connection_id) };
  }

  /** Flags the connection when Meta says the token is dead. */
  async noteFailure(connectionId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const expired = error instanceof MetaApiError && error.isAuth;
    await this.supabase
      .from('meta_connections')
      .update({ last_error: message.slice(0, 500), ...(expired ? { status: 'expired' } : {}) })
      .eq('id', connectionId);
  }

  // -------------------------------------------------------------------- OAuth
  buildOAuthState(userId: string, now: number = Date.now()): string {
    const payload = `${userId}.${now}`;
    return `${payload}.${this.crypto.sign(payload)}`;
  }

  /** Returns the user id when the state is authentic and fresh, otherwise `null`. */
  verifyOAuthState(state: string, now: number = Date.now()): string | null {
    const parts = state.split('.');
    if (parts.length !== 3) return null;
    const [userId, issuedAt, signature] = parts;
    if (this.crypto.sign(`${userId}.${issuedAt}`) !== signature) return null;
    return now - Number(issuedAt) > OAUTH_STATE_MAX_AGE_MS ? null : userId;
  }

  oauthUrl(userId: string): { url: string } {
    if (!this.config.metaAppId || !this.config.metaAppSecret) {
      throw new BadRequestException('Meta OAuth is not configured: set META_APP_ID and META_APP_SECRET.');
    }
    const query = new URLSearchParams({
      client_id: this.config.metaAppId,
      redirect_uri: this.config.metaRedirectUri,
      state: this.buildOAuthState(userId),
      scope: [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES].join(','),
      response_type: 'code',
    });
    return { url: `${this.config.metaDialogBaseUrl}/${this.config.metaGraphVersion}/dialog/oauth?${query}` };
  }

  async oauthCallback(code: string, state: string): Promise<string> {
    const userId = this.verifyOAuthState(state);
    if (!userId) throw new BadRequestException('Invalid or expired OAuth state');
    const token = await this.exchangeCode(code);
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
    await this.connect(userId, token.access_token, undefined, expiresAt);
    return userId;
  }

  private async exchangeCode(code: string): Promise<OAuthTokenResponse> {
    const exchange = async (parameters: Record<string, string>): Promise<OAuthTokenResponse> => {
      const response = await fetch(`${this.config.metaGraphBaseUrl}/${this.config.metaGraphVersion}/oauth/access_token?${new URLSearchParams(parameters)}`);
      const body = (await response.json()) as OAuthTokenResponse & { error?: { message?: string } };
      if (!response.ok) throw new BadRequestException(`Meta token exchange failed: ${body.error?.message ?? response.status}`);
      return body;
    };
    const shortLived = await exchange({
      client_id: this.config.metaAppId as string,
      client_secret: this.config.metaAppSecret as string,
      redirect_uri: this.config.metaRedirectUri,
      code,
    });
    return exchange({
      grant_type: 'fb_exchange_token',
      client_id: this.config.metaAppId as string,
      client_secret: this.config.metaAppSecret as string,
      fb_exchange_token: shortLived.access_token,
    });
  }
}
