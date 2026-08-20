import type { Job } from 'bullmq';
import { NotificationsProcessor } from './notifications.processor';
import { EMAIL_NOTIFICATION_JOB, SLACK_NOTIFICATION_JOB } from './notifications.service';
import type { NotificationsService } from './notifications.service';
import { BuildStatusChangedEvent } from '../builds/events/build-status-changed.event';
import { BuildStatus, Environment } from '../builds/build.model';
import { Platform } from '../projects/project.model';

const buildEvent = new BuildStatusChangedEvent(
  'build1',
  'proj1',
  'user1',
  Platform.ios,
  Environment.staging,
  BuildStatus.success,
  60,
);

function createNotificationsService() {
  return {
    sendSlackNotification: jest.fn().mockResolvedValue(undefined),
    sendEmailNotification: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;
}

describe('NotificationsProcessor', () => {
  it('dispatches slack jobs to sendSlackNotification', async () => {
    const notificationsService = createNotificationsService();
    const processor = new NotificationsProcessor(notificationsService);
    const slackConfig = { webhookUrl: 'https://hooks.slack.com/x', enabled: true, events: [] };
    const job = { name: SLACK_NOTIFICATION_JOB, data: { config: slackConfig, event: buildEvent } } as Job;

    await processor.process(job);

    expect(notificationsService.sendSlackNotification).toHaveBeenCalledWith(slackConfig, buildEvent);
    expect(notificationsService.sendEmailNotification).not.toHaveBeenCalled();
  });

  it('dispatches email jobs to sendEmailNotification', async () => {
    const notificationsService = createNotificationsService();
    const processor = new NotificationsProcessor(notificationsService);
    const job = { name: EMAIL_NOTIFICATION_JOB, data: { userId: 'user1', event: buildEvent } } as Job;

    await processor.process(job);

    expect(notificationsService.sendEmailNotification).toHaveBeenCalledWith('user1', buildEvent);
    expect(notificationsService.sendSlackNotification).not.toHaveBeenCalled();
  });

  it('ignores unknown job names without throwing', async () => {
    const notificationsService = createNotificationsService();
    const processor = new NotificationsProcessor(notificationsService);
    const job = { name: 'unknown-job', data: {} } as Job;

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(notificationsService.sendSlackNotification).not.toHaveBeenCalled();
    expect(notificationsService.sendEmailNotification).not.toHaveBeenCalled();
  });
});
