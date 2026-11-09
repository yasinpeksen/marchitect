import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly supabase: SupabaseService) {}

  /** Best-effort: audit failures never break the request. */
  async record(
    userId: string | null,
    action: string,
    entityType?: string,
    entityId?: string,
    metadata?: Record<string, unknown>,
    ipAddress?: string,
  ): Promise<void> {
    const { error } = await this.supabase.from('audit_logs').insert({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
      ip: ipAddress,
    });
    if (error) this.logger.warn(`audit insert failed: ${error.message}`);
  }
}
