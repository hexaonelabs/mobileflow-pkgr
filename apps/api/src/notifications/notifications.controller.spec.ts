import { BadRequestException } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import type { NotificationConfigService } from './notification-config.service';
import type { NotificationsService } from './notifications.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

function requestFor(user: AuthenticatedUser) {
  return { user } as unknown as Request & { user: AuthenticatedUser };
}

const user = {
  id: 'user1',
  email: 'a@b.com',
  plan: 'starter',
  githubInstallationId: null,
} as AuthenticatedUser;

describe('NotificationsController', () => {
  it('getConfig delegates to NotificationConfigService.getConfig', async () => {
    const configService = {
      getConfig: jest.fn().mockResolvedValue({ userId: 'user1', projectId: 'proj1' }),
      upsert: jest.fn(),
    };
    const controller = new NotificationsController(
      configService as unknown as NotificationConfigService,
      {} as NotificationsService,
    );

    const result = await controller.getConfig(requestFor(user), 'proj1');

    expect(configService.getConfig).toHaveBeenCalledWith('user1', 'proj1');
    expect(result).toEqual({ userId: 'user1', projectId: 'proj1' });
  });

  it('upsertConfig delegates to NotificationConfigService.upsert', async () => {
    const dto = { slack: { webhookUrl: 'https://hooks.slack.com/x', enabled: true, events: [] } };
    const configService = {
      upsert: jest.fn().mockResolvedValue({ userId: 'user1', projectId: 'proj1', ...dto }),
    };
    const controller = new NotificationsController(
      configService as unknown as NotificationConfigService,
      {} as NotificationsService,
    );

    await controller.upsertConfig(requestFor(user), 'proj1', dto);

    expect(configService.upsert).toHaveBeenCalledWith('user1', 'proj1', dto);
  });

  describe('sendTest', () => {
    it('throws BadRequestException when slack is not enabled', async () => {
      const configService = {
        getConfig: jest.fn().mockResolvedValue({ userId: 'user1', projectId: 'proj1' }),
      };
      const notificationsService = { onBuildStatusChanged: jest.fn() };
      const controller = new NotificationsController(
        configService as unknown as NotificationConfigService,
        notificationsService as unknown as NotificationsService,
      );

      await expect(controller.sendTest(requestFor(user), 'proj1')).rejects.toThrow(
        BadRequestException,
      );
      expect(notificationsService.onBuildStatusChanged).not.toHaveBeenCalled();
    });

    it('sends a test build.success event through NotificationsService when slack is enabled', async () => {
      const configService = {
        getConfig: jest.fn().mockResolvedValue({
          userId: 'user1',
          projectId: 'proj1',
          slack: { webhookUrl: 'https://hooks.slack.com/x', enabled: true, events: [] },
        }),
      };
      const notificationsService = {
        onBuildStatusChanged: jest.fn().mockResolvedValue(undefined),
      };
      const controller = new NotificationsController(
        configService as unknown as NotificationConfigService,
        notificationsService as unknown as NotificationsService,
      );

      const result = await controller.sendTest(requestFor(user), 'proj1');

      expect(notificationsService.onBuildStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj1', userId: 'user1', status: 'success' }),
      );
      expect(result).toEqual({ message: 'Notification de test envoyée.' });
    });
  });
});
