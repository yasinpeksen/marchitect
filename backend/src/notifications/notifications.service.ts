import { Injectable } from '@nestjs/common';
import { must, SupabaseService } from '../common/supabase.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly supabase: SupabaseService) {}

  async notify(userId: string, type: string, title: string, body?: string, data?: Record<string, unknown>): Promise<void> {
    await this.supabase.from('notifications').insert({ user_id: userId, type, title, body, data });
  }

  async list(userId: string, unreadOnly: boolean) {
    let query = this.supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
    if (unreadOnly) query = query.is('read_at', null);
    return must(await query, 'list notifications');
  }

  /** Marks the given notifications (or all unread when `ids` is empty) as read. */
  async markRead(userId: string, ids?: string[]): Promise<void> {
    let query = this.supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null);
    if (ids?.length) query = query.in('id', ids);
    must(await query, 'mark read');
  }
}
