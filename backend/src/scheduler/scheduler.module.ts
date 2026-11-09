import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max,
  MaxLength, Min, MinLength,
} from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/auth';
import { NotificationsModule } from '../notifications/notifications.module';
import { SearchModule } from '../search/search.module';
import { SchedulerService } from './scheduler.service';

class CreateScheduleDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true }) keywords: string[];
  @IsUUID() ad_account_id: string;
  @IsIn(['hour', 'day', 'week', 'month']) interval_unit: 'hour' | 'day' | 'week' | 'month';
  @IsInt() @Min(1) @Max(1000) interval_value: number;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1100) lookback_days?: number;
  @IsISO8601() start_at: string;
  @IsOptional() @IsISO8601() end_at?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class UpdateScheduleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true }) keywords?: string[];
  @IsOptional() @IsIn(['hour', 'day', 'week', 'month']) interval_unit?: 'hour' | 'day' | 'week' | 'month';
  @IsOptional() @IsInt() @Min(1) @Max(1000) interval_value?: number;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1100) lookback_days?: number;
  @IsOptional() @IsISO8601() start_at?: string;
  @IsOptional() @IsISO8601() end_at?: string | null;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

@ApiTags('schedules')
@ApiBearerAuth()
@Controller('schedules')
class SchedulerController {
  constructor(private readonly scheduler: SchedulerService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.scheduler.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateScheduleDto) {
    return this.scheduler.create(user.id, body);
  }

  /** Edit, pause (`enabled:false`) or resume (`enabled:true`). */
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) scheduleId: string, @Body() body: UpdateScheduleDto) {
    return this.scheduler.update(user.id, scheduleId, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) scheduleId: string) {
    await this.scheduler.remove(user.id, scheduleId);
  }

  @Post(':id/run')
  async run(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) scheduleId: string) {
    const run = await this.scheduler.runNow(user.id, scheduleId);
    return { started: Boolean(run), run };
  }

  @Get(':id/executions')
  executions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) scheduleId: string) {
    return this.scheduler.executions(user.id, scheduleId);
  }
}

@Module({
  imports: [SearchModule, NotificationsModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
