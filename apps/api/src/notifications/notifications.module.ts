import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NotificationConfigService } from './notification-config.service';
import { NotificationsController } from './notifications.controller';
import { NOTIFICATIONS_QUEUE, NotificationsService } from './notifications.service';
import { NotificationsProcessor } from './notifications.processor';

@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationConfigService, NotificationsProcessor],
  exports: [NotificationsService, NotificationConfigService],
})
export class NotificationsModule {}
