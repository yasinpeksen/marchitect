import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../common/supabase.service';

export interface AuthUser {
  id: string;
  email?: string;
}

interface AuthenticatedRequest {
  headers: Record<string, string | undefined>;
  user?: AuthUser;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The user attached to the request by the auth guard. */
export const getRequestUser = (_data: unknown, context: ExecutionContext): AuthUser =>
  context.switchToHttp().getRequest<AuthenticatedRequest>().user as AuthUser;

export const CurrentUser = createParamDecorator(getRequestUser);

/** Extracts the token from an `Authorization: Bearer <token>` header, or `undefined`. */
export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader?.startsWith('Bearer ')) return undefined;
  return authorizationHeader.slice('Bearer '.length).trim() || undefined;
}

/** Verifies the Supabase access token (Bearer) and attaches `request.user`. Global guard. */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers['authorization']);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    const { data, error } = await this.supabase.admin.auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedException('Invalid or expired session');
    request.user = { id: data.user.id, email: data.user.email } satisfies AuthUser;
    return true;
  }
}
