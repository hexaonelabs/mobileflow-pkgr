import { Environment } from '../builds/build.model';
import type { EncryptionService } from '../crypto/encryption.service';
import type { FirestoreService } from '../firestore/firestore.service';
import { Platform } from '../projects/project.model';
import type { CreateSecretDto } from './dto/create-secret.dto';
import { SECRETS_COLLECTION, SecretType, type SecretDocument } from './secret.model';
import { SecretsService } from './secrets.service';

interface StoredDoc {
  id: string;
  data: SecretDocument;
}

function createFirestoreMock(initialDocs: StoredDoc[] = []) {
  const state = [...initialDocs];
  let nextId = state.length + 1;

  function queryBuilder(filters: Array<[string, unknown]>) {
    return {
      where: jest.fn((field: string, _op: string, value: unknown) =>
        queryBuilder([...filters, [field, value]]),
      ),
      get: jest.fn(async () => {
        const matching = state.filter((doc) =>
          filters.every(
            ([field, value]) => (doc.data as unknown as Record<string, unknown>)[field] === value,
          ),
        );
        return {
          docs: matching.map((doc) => ({
            id: doc.id,
            data: () => doc.data,
            ref: {
              delete: jest.fn(async () => {
                const idx = state.findIndex((d) => d.id === doc.id);
                if (idx !== -1) {
                  state.splice(idx, 1);
                }
              }),
            },
          })),
        };
      }),
    };
  }

  const secretsCollection = {
    ...queryBuilder([]),
    add: jest.fn(async (doc: SecretDocument) => {
      const id = `secret-${nextId++}`;
      state.push({ id, data: doc });
      return { id };
    }),
  };

  const firestore = {
    db: {
      collection: jest.fn((name: string) => {
        if (name === SECRETS_COLLECTION) {
          return secretsCollection;
        }
        return {
          doc: jest.fn(() => ({
            get: jest.fn(async () => ({
              exists: true,
              data: () => ({ userId: 'user1', githubRepoFullName: 'owner/repo' }),
            })),
          })),
        };
      }),
    },
  } as unknown as FirestoreService;

  return { firestore, state };
}

function secretDoc(overrides: Partial<SecretDocument> = {}): SecretDocument {
  return {
    projectId: 'proj1',
    userId: 'user1',
    type: SecretType.ios_provisioning_profile,
    environment: Environment.staging,
    fileName: 'profile.mobileprovision',
    ciphertext: JSON.stringify({
      fileBase64: 'default-b64',
      password: null,
      alias: null,
      keyPassword: null,
    }),
    iv: 'iv',
    authTag: 'tag',
    createdAt: null as never,
    ...overrides,
  };
}

function createEncryptionMock() {
  return {
    encrypt: jest.fn((_tenantId: string, plaintext: string) => ({
      ciphertext: plaintext,
      iv: 'iv',
      authTag: 'tag',
    })),
    decrypt: jest.fn((_tenantId: string, payload: { ciphertext: string }) => payload.ciphertext),
  };
}

describe('SecretsService.create - environment scoping', () => {
  it('uploading a production provisioning profile does not delete the existing staging one', async () => {
    const staging = secretDoc({ fileName: 'staging.mobileprovision' });
    const { firestore, state } = createFirestoreMock([{ id: 'secret-staging', data: staging }]);
    const service = new SecretsService(firestore, createEncryptionMock() as unknown as EncryptionService);

    const dto = {
      type: SecretType.ios_provisioning_profile,
      fileName: 'production.mobileprovision',
      fileBase64: 'base64',
      environment: Environment.production,
    } as CreateSecretDto;

    await service.create('user1', 'proj1', dto);

    expect(state.find((d) => d.id === 'secret-staging')).toBeDefined();
    expect(
      state.some((d) => d.data.environment === Environment.production && d.data.fileName === 'production.mobileprovision'),
    ).toBe(true);
    expect(state).toHaveLength(2);
  });

  it('uploading a new staging provisioning profile replaces the old staging one, leaving production untouched', async () => {
    const staging = secretDoc({ fileName: 'old-staging.mobileprovision' });
    const production = secretDoc({ environment: Environment.production, fileName: 'prod.mobileprovision' });
    const { firestore, state } = createFirestoreMock([
      { id: 'secret-staging', data: staging },
      { id: 'secret-production', data: production },
    ]);
    const service = new SecretsService(firestore, createEncryptionMock() as unknown as EncryptionService);

    const dto = {
      type: SecretType.ios_provisioning_profile,
      fileName: 'new-staging.mobileprovision',
      fileBase64: 'base64',
      environment: Environment.staging,
    } as CreateSecretDto;

    await service.create('user1', 'proj1', dto);

    expect(state.find((d) => d.id === 'secret-staging')).toBeUndefined();
    expect(state.find((d) => d.id === 'secret-production')).toBeDefined();
    expect(
      state.filter((d) => d.data.type === SecretType.ios_provisioning_profile && d.data.environment === Environment.staging),
    ).toHaveLength(1);
    expect(state.find((d) => d.data.fileName === 'new-staging.mobileprovision')).toBeDefined();
  });

  it('keeps ios_certificate as a single slot per project (environment stays null on both sides)', async () => {
    const existing = secretDoc({ type: SecretType.ios_certificate, environment: null, fileName: 'old.p12' });
    const { firestore, state } = createFirestoreMock([{ id: 'secret-cert', data: existing }]);
    const service = new SecretsService(firestore, createEncryptionMock() as unknown as EncryptionService);

    const dto = {
      type: SecretType.ios_certificate,
      fileName: 'new.p12',
      fileBase64: 'base64',
      password: 'secret',
    } as CreateSecretDto;

    await service.create('user1', 'proj1', dto);

    expect(state).toHaveLength(1);
    expect(state[0].data.fileName).toBe('new.p12');
    expect(state[0].data.environment).toBeNull();
  });
});

describe('SecretsService.getDecryptedForPlatform - environment scoping', () => {
  it('returns the provisioning profile matching the requested environment, and the environment-agnostic certificate', async () => {
    const staging = secretDoc({
      ciphertext: JSON.stringify({ fileBase64: 'staging-b64', password: null, alias: null, keyPassword: null }),
    });
    const production = secretDoc({
      environment: Environment.production,
      ciphertext: JSON.stringify({ fileBase64: 'production-b64', password: null, alias: null, keyPassword: null }),
    });
    const cert = secretDoc({
      type: SecretType.ios_certificate,
      environment: null,
      ciphertext: JSON.stringify({ fileBase64: 'cert-b64', password: 'pw', alias: null, keyPassword: null }),
    });
    const { firestore } = createFirestoreMock([
      { id: 'secret-staging', data: staging },
      { id: 'secret-production', data: production },
      { id: 'secret-cert', data: cert },
    ]);
    const service = new SecretsService(firestore, createEncryptionMock() as unknown as EncryptionService);

    const result = await service.getDecryptedForPlatform('user1', 'proj1', Platform.ios, Environment.production);

    expect(result.iosProvisioningProfile?.fileBase64).toBe('production-b64');
    expect(result.iosCertificate?.fileBase64).toBe('cert-b64');
  });

  it('returns null for a requested environment that has no profile yet, distinct from no profile at all', async () => {
    const staging = secretDoc();
    const { firestore } = createFirestoreMock([{ id: 'secret-staging', data: staging }]);
    const service = new SecretsService(firestore, createEncryptionMock() as unknown as EncryptionService);

    const result = await service.getDecryptedForPlatform('user1', 'proj1', Platform.ios, Environment.production);

    expect(result.iosProvisioningProfile).toBeNull();
  });
});
