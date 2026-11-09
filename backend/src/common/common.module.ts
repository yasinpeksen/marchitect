import { Global, Module } from '@nestjs/common';
import { AppConfig } from './app-config';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';
import { LockService } from './lock.service';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  providers: [AppConfig, SupabaseService, CryptoService, LockService, AuditService],
  exports: [AppConfig, SupabaseService, CryptoService, LockService, AuditService],
})
export class CommonModule {}
