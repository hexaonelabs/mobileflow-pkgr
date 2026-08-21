import { Environment } from '../builds/build.model';
import type { FirestoreService } from '../firestore/firestore.service';
import { Platform } from '../projects/project.model';
import { RunTokensService } from './run-tokens.service';
import type { RunTokenDocument } from './run-token.model';

function createFirestoreMock() {
  const store = new Map<string, RunTokenDocument>();

  const db = {
    collection: jest.fn(() => ({
      doc: jest.fn((token: string) => ({
        token,
        set: jest.fn(async (doc: RunTokenDocument) => {
          store.set(token, doc);
        }),
      })),
    })),
    runTransaction: jest.fn(
      async (
        fn: (tx: {
          get: (ref: {
            token: string;
          }) => Promise<{ exists: boolean; data: () => RunTokenDocument | undefined }>;
          delete: (ref: { token: string }) => void;
        }) => unknown,
      ) =>
        fn({
          get: async (ref) => {
            const data = store.get(ref.token);
            return { exists: !!data, data: () => data };
          },
          delete: (ref) => {
            store.delete(ref.token);
          },
        }),
    ),
  };

  return { db } as unknown as FirestoreService;
}

describe('RunTokensService - environment round-trip', () => {
  it('carries environment from issueToken() through to consumeToken()', async () => {
    const firestore = createFirestoreMock();
    const service = new RunTokensService(firestore);

    const token = await service.issueToken({
      buildId: 'build1',
      projectId: 'proj1',
      userId: 'user1',
      platform: Platform.ios,
      environment: Environment.production,
    });

    const consumed = await service.consumeToken(token);

    expect(consumed.environment).toBe(Environment.production);
    expect(consumed).toMatchObject({
      buildId: 'build1',
      projectId: 'proj1',
      userId: 'user1',
      platform: Platform.ios,
    });
  });
});
