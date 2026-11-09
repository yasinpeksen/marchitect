import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FakeSupabase } from '../testing/fake-supabase';
import { SupabaseService } from '../common/supabase.service';
import { extractBearerToken, getRequestUser, IS_PUBLIC, Public, SupabaseAuthGuard } from './auth';

const buildContext = (request: Record<string, unknown>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  }) as unknown as ExecutionContext;

describe('extractBearerToken', () => {
  it('extracts the token', () => expect(extractBearerToken('Bearer abc.def')).toBe('abc.def'));
  it('trims whitespace', () => expect(extractBearerToken('Bearer   abc  ')).toBe('abc'));
  it.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer '])('returns undefined for %p', (header) => {
    expect(extractBearerToken(header)).toBeUndefined();
  });
});

describe('getRequestUser', () => {
  it('returns the user attached by the guard', () => {
    expect(getRequestUser(undefined, buildContext({ user: { id: 'u1' } }))).toEqual({ id: 'u1' });
  });
});

describe('Public', () => {
  it('marks a handler as public through metadata', () => {
    class Controller {
      @Public()
      open() {
        return true;
      }
    }
    expect(Reflect.getMetadata(IS_PUBLIC, Controller.prototype.open)).toBe(true);
  });
});

describe('SupabaseAuthGuard', () => {
  const buildGuard = (isPublic = false) => {
    const fake = new FakeSupabase();
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as unknown as Reflector;
    return { fake, guard: new SupabaseAuthGuard(reflector, fake as unknown as SupabaseService) };
  };

  it('lets public routes through without calling Supabase', async () => {
    const { fake, guard } = buildGuard(true);
    expect(await guard.canActivate(buildContext({ headers: {} }))).toBe(true);
    expect(fake.getUser).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer token', async () => {
    const { guard } = buildGuard();
    await expect(guard.canActivate(buildContext({ headers: {} }))).rejects.toThrow(new UnauthorizedException('Missing bearer token'));
  });

  it('rejects an invalid session', async () => {
    const { fake, guard } = buildGuard();
    fake.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    await expect(guard.canActivate(buildContext({ headers: { authorization: 'Bearer nope' } }))).rejects.toThrow('Invalid or expired session');
  });

  it('attaches the verified user to the request', async () => {
    const { fake, guard } = buildGuard();
    fake.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.test' } }, error: null });
    const request: Record<string, unknown> = { headers: { authorization: 'Bearer good' } };
    expect(await guard.canActivate(buildContext(request))).toBe(true);
    expect(fake.getUser).toHaveBeenCalledWith('good');
    expect(request.user).toEqual({ id: 'u1', email: 'a@b.test' });
  });
});
