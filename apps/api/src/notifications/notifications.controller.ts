import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePlan } from '../auth/decorators/required-plan.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlanGuard } from '../auth/guards/plan.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { BuildStatus, Environment } from '../builds/build.model';
import { BuildStatusChangedEvent } from '../builds/events/build-status-changed.event';
import { Platform } from '../projects/project.model';
import { Plan } from '../users/user.model';
import { UpsertNotificationConfigDto } from './dto/upsert-notification-config.dto';
import { NotificationConfigService } from './notification-config.service';
import { NotificationsService } from './notifications.service';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@UseGuards(JwtAuthGuard)
@Controller('projects')
export class NotificationsController {
  constructor(
    private readonly notificationConfigService: NotificationConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Get(':id/notifications/config')
  getConfig(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.notificationConfigService.getConfig(req.user.id, id);
  }

  @Post(':id/notifications/config')
  @UseGuards(PlanGuard)
  @RequirePlan(Plan.starter)
  upsertConfig(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpsertNotificationConfigDto,
  ) {
    return this.notificationConfigService.upsert(req.user.id, id, dto);
  }

  @Post(':id/notifications/test')
  @UseGuards(PlanGuard)
  @RequirePlan(Plan.starter)
  async sendTest(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const config = await this.notificationConfigService.getConfig(req.user.id, id);
    if (!config.slack?.enabled) {
      throw new BadRequestException('Slack non configuré pour ce projet.');
    }

    const testEvent = new BuildStatusChangedEvent(
      'test-123',
      id,
      req.user.id,
      Platform.ios,
      Environment.staging,
      BuildStatus.success,
      420,
    );

    await this.notificationsService.onBuildStatusChanged(testEvent);
    return { message: 'Notification de test envoyée.' };
  }
}
