import type { FieldValue, Timestamp } from 'firebase-admin/firestore';

export const NOTIFICATION_CONFIGS_COLLECTION = 'notificationConfigs';

export const NotificationEvent = {
  buildStarted: 'build.started',
  buildSuccess: 'build.success',
  buildFailed: 'build.failed',
} as const;
export type NotificationEvent = (typeof NotificationEvent)[keyof typeof NotificationEvent];

// L'email n'est déclenché que pour les événements importants (pas build.started).
export type EmailNotificationEvent = Exclude<
  NotificationEvent,
  typeof NotificationEvent.buildStarted
>;

export interface NotificationConfigDocument {
  userId: string;
  projectId: string;

  slack?: {
    webhookUrl: string;
    enabled: boolean;
    events: NotificationEvent[];
  };

  discord?: {
    webhookUrl: string;
    enabled: boolean;
    events: NotificationEvent[];
  };

  email?: {
    enabled: boolean;
    events: EmailNotificationEvent[];
  };

  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

export interface NotificationConfigResponse extends Omit<
  NotificationConfigDocument,
  'createdAt' | 'updatedAt'
> {
  createdAt: string | null;
  updatedAt: string | null;
}
