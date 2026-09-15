import { UnauthorizedException } from '@nestjs/common';
import { Timestamp } from 'firebase-admin/firestore';
import type { FirestoreService } from '../firestore/firestore.service';
import { LogsTokensService } from './logs-tokens.service';
import type { LogsTokenDocument } from './logs-token.model';

function createFirestoreMock() {
  const store = new Map<string, LogsTokenDocument>();

  const db = {
    collection: jest.fn(() => ({
      doc: jest.fn((token: string) => ({
        set: jest.fn((doc: LogsTokenDocument) => {
          store.set(token, doc);
          return Promise.resolve();
        }),
        get: jest.fn(() => {
          const data = store.get(token);
          return Promise.resolve({ exists: !!data, data: () => data });
        }),
      })),
      where: jest.fn((field: string, _op: string, value: string) => ({
        get: jest.fn(() =>
          Promise.resolve({
            docs: [...store.entries()]
              .filter(([, doc]) => (doc as unknown as Record<string, unknown>)[field] === value)
              .map(([token]) => ({
                ref: { delete: jest.fn(() => Promise.resolve(store.delete(token))) },
              })),
          }),
        ),
      })),
    })),
  };

  return { db, store } as unknown as FirestoreService & { store: Map<string, LogsTokenDocument> };
}

describe('LogsTokensService', () => {
  it('verifies a freshly issued token for its own build without consuming it', async () => {
    const firestore = createFirestoreMock();
    const service = new LogsTokensService(firestore);

    const token = await service.issueToken({
      buildId: 'build1',
      projectId: 'proj1',
      userId: 'user1',
    });
    const first = await service.verifyToken(token, 'build1');
    const second = await service.verifyToken(token, 'build1');

    expect(first).toMatchObject({ buildId: 'build1', projectId: 'proj1', userId: 'user1' });
    expect(second).toMatchObject({ buildId: 'build1' });
  });

  it('rejects a token used for a different build', async () => {
    const firestore = createFirestoreMock();
    const service = new LogsTokensService(firestore);
    const token = await service.issueToken({
      buildId: 'build1',
      projectId: 'proj1',
      userId: 'user1',
    });

    await expect(service.verifyToken(token, 'build2')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unknown token', async () => {
    const firestore = createFirestoreMock();
    const service = new LogsTokensService(firestore);

    await expect(service.verifyToken('unknown', 'build1')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const firestore = createFirestoreMock();
    const service = new LogsTokensService(firestore);
    const token = await service.issueToken({
      buildId: 'build1',
      projectId: 'proj1',
      userId: 'user1',
    });
    firestore.store.get(token)!.expiresAt = Timestamp.fromMillis(Date.now() - 1000);

    await expect(service.verifyToken(token, 'build1')).rejects.toThrow(UnauthorizedException);
  });

  it('revokes all tokens for a build so that subsequent verification fails', async () => {
    const firestore = createFirestoreMock();
    const service = new LogsTokensService(firestore);
    const token = await service.issueToken({
      buildId: 'build1',
      projectId: 'proj1',
      userId: 'user1',
    });

    await service.revokeToken('build1');

    await expect(service.verifyToken(token, 'build1')).rejects.toThrow(UnauthorizedException);
  });
});
