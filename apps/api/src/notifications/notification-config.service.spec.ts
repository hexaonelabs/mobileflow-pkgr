import { NotFoundException } from '@nestjs/common';
import { Timestamp } from 'firebase-admin/firestore';
import { NotificationConfigService } from './notification-config.service';
import { NotificationEvent, type NotificationConfigDocument } from './notification-config.model';
import { PROJECTS_COLLECTION } from '../projects/project.model';
import type { FirestoreService } from '../firestore/firestore.service';

function createFirestore(options: { projectFound?: boolean } = {}) {
  const { projectFound = true } = options;
  const store = new Map<string, NotificationConfigDocument>();

  const projectsRoot = {
    doc: jest.fn().mockReturnValue({
      get: jest
        .fn()
        .mockResolvedValue(
          projectFound
            ? { exists: true, data: () => ({ userId: 'user1' }) }
            : { exists: false, data: () => undefined },
        ),
    }),
  };

  const configsRoot = {
    doc: (id: string) => ({
      get: () => {
        const entry = store.get(id);
        return Promise.resolve({ exists: entry !== undefined, data: () => entry });
      },
      set: (value: NotificationConfigDocument) => {
        // Résout les FieldValue.serverTimestamp() en Timestamp, comme le ferait Firestore.
        // Un Timestamp déjà résolu (createdAt réutilisé d'un doc existant) reste inchangé.
        const resolved = {
          ...value,
          createdAt: value.createdAt instanceof Timestamp ? value.createdAt : Timestamp.now(),
          updatedAt: value.updatedAt instanceof Timestamp ? value.updatedAt : Timestamp.now(),
        };
        store.set(id, resolved);
        return Promise.resolve();
      },
    }),
  };

  const db = {
    collection: jest.fn((name: string) => (name === PROJECTS_COLLECTION ? projectsRoot : configsRoot)),
  };

  return { db: db as unknown as FirestoreService['db'], store };
}

describe('NotificationConfigService', () => {
  it('throws when the project is not owned by the user', async () => {
    const { db } = createFirestore({ projectFound: false });
    const service = new NotificationConfigService({ db });

    await expect(service.getConfig('user1', 'proj1')).rejects.toThrow(NotFoundException);
    await expect(
      service.upsert('user1', 'proj1', {
        slack: { webhookUrl: 'https://hooks.slack.com/x', enabled: true, events: [] },
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('getConfig returns an empty default when no config was ever saved', async () => {
    const { db } = createFirestore();
    const service = new NotificationConfigService({ db });

    const config = await service.getConfig('user1', 'proj1');

    expect(config.userId).toBe('user1');
    expect(config.projectId).toBe('proj1');
    expect(config.slack).toBeUndefined();
    expect(config.createdAt).toBeNull();
  });

  it('upsert stores the slack config in Firestore and returns it', async () => {
    const { db, store } = createFirestore();
    const service = new NotificationConfigService({ db });

    const result = await service.upsert('user1', 'proj1', {
      slack: {
        webhookUrl: 'https://hooks.slack.com/services/x',
        enabled: true,
        events: [NotificationEvent.buildSuccess, NotificationEvent.buildFailed],
      },
    });

    expect(result.slack).toEqual({
      webhookUrl: 'https://hooks.slack.com/services/x',
      enabled: true,
      events: [NotificationEvent.buildSuccess, NotificationEvent.buildFailed],
    });
    expect(result.createdAt).not.toBeNull();
    expect(store.get('proj1')?.slack?.webhookUrl).toBe('https://hooks.slack.com/services/x');
  });

  it('upsert preserves the existing slack config when the dto omits it', async () => {
    const { db } = createFirestore();
    const service = new NotificationConfigService({ db });

    await service.upsert('user1', 'proj1', {
      slack: { webhookUrl: 'https://hooks.slack.com/services/x', enabled: true, events: [] },
    });
    const second = await service.upsert('user1', 'proj1', {});

    expect(second.slack?.webhookUrl).toBe('https://hooks.slack.com/services/x');
  });

  it('upsert keeps the original createdAt across updates', async () => {
    const { db, store } = createFirestore();
    const service = new NotificationConfigService({ db });

    await service.upsert('user1', 'proj1', {
      slack: { webhookUrl: 'https://hooks.slack.com/a', enabled: true, events: [] },
    });
    const firstCreatedAt = store.get('proj1')?.createdAt;

    await service.upsert('user1', 'proj1', {
      slack: { webhookUrl: 'https://hooks.slack.com/b', enabled: true, events: [] },
    });

    expect(store.get('proj1')?.createdAt).toBe(firstCreatedAt);
  });
});
