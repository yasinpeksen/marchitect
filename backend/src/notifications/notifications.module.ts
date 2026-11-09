import { Body, Controller, Get, HttpCode, Module, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsUUID } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/auth';
import { NotificationsService } from './notifications.service';

class MarkReadDto {
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) ids?: string[];
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('unread') unread?: string) {
    return this.notifications.list(user.id, unread === 'true');
  }

  @Post('read')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Body() body: MarkReadDto) {
    await this.notifications.markRead(user.id, body.ids);
  }
}

@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
