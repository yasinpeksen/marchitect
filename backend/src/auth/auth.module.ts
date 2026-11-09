import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, SupabaseAuthGuard } from './auth';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
class AuthController {
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}

@Module({
  controllers: [AuthController],
  providers: [{ provide: APP_GUARD, useClass: SupabaseAuthGuard }],
})
export class AuthModule {}
