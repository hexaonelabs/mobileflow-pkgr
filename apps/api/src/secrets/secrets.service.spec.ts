import type { AppleCertificateService } from '../apple/apple-certificate.service';
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

function createAppleCertificateServiceMock() {
  return {
    createDistributionCertificate: jest.fn(async () => ({
      certificateContentBase64: 'cert-b64',
      serialNumber: 'SERIAL',
      expirationDate: '2027-01-01T00:00:00.000Z',
    })),
  };
}

describe('SecretsService.create - environment scoping', () => {
  it('uploading a production provisioning profile does not delete the existing staging one', async () => {
    const staging = secretDoc({ fileName: 'staging.mobileprovision' });
    const { firestore, state } = createFirestoreMock([{ id: 'secret-staging', data: staging }]);
    const service = new SecretsService(
      firestore,
      createEncryptionMock() as unknown as EncryptionService,
      createAppleCertificateServiceMock() as unknown as AppleCertificateService,
    );

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
    const service = new SecretsService(
      firestore,
      createEncryptionMock() as unknown as EncryptionService,
      createAppleCertificateServiceMock() as unknown as AppleCertificateService,
    );

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
    const service = new SecretsService(
      firestore,
      createEncryptionMock() as unknown as EncryptionService,
      createAppleCertificateServiceMock() as unknown as AppleCertificateService,
    );

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
    const service = new SecretsService(
      firestore,
      createEncryptionMock() as unknown as EncryptionService,
      createAppleCertificateServiceMock() as unknown as AppleCertificateService,
    );

    const result = await service.getDecryptedForPlatform('user1', 'proj1', Platform.ios, Environment.production);

    expect(result.iosProvisioningProfile?.fileBase64).toBe('production-b64');
    expect(result.iosCertificate?.fileBase64).toBe('cert-b64');
  });

  it('returns null for a requested environment that has no profile yet, distinct from no profile at all', async () => {
    const staging = secretDoc();
    const { firestore } = createFirestoreMock([{ id: 'secret-staging', data: staging }]);
    const service = new SecretsService(
      firestore,
      createEncryptionMock() as unknown as EncryptionService,
      createAppleCertificateServiceMock() as unknown as AppleCertificateService,
    );

    const result = await service.getDecryptedForPlatform('user1', 'proj1', Platform.ios, Environment.production);

    expect(result.iosProvisioningProfile).toBeNull();
  });
});

describe('SecretsService.getAppStoreConnectKey', () => {
  it('decrypts and decodes the .p8 content for the project', async () => {
    const doc = secretDoc({
      type: SecretType.app_store_connect_key,
      environment: null,
      ciphertext: JSON.stringify({
        fileBase64: Buffer.from('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----').toString(
          'base64',
        ),
        password: null,
        alias: null,
        keyPassword: null,
        issuerId: 'issuer-123',
        keyId: 'key-abc',
      }),
    });
    const { firestore } = createFirestoreMock([{ id: 'secret-asc', data: doc }]);
    const service = new SecretsService(
      firestore,
      createEncryptionMock() as unknown as EncryptionService,
      createAppleCertificateServiceMock() as unknown as AppleCertificateService,
    );

    const result = await service.getAppStoreConnectKey('user1', 'proj1');

    expect(result).toEqual({
      issuerId: 'issuer-123',
      keyId: 'key-abc',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    });
  });

  it('returns null when the project has no App Store Connect key configured', async () => {
    const { firestore } = createFirestoreMock([]);
    const service = new SecretsService(
      firestore,
      createEncryptionMock() as unknown as EncryptionService,
      createAppleCertificateServiceMock() as unknown as AppleCertificateService,
    );

    const result = await service.getAppStoreConnectKey('user1', 'proj1');

    expect(result).toBeNull();
  });
});

describe('SecretsService.generateIosDistributionCertificate', () => {
  it('delegates to AppleCertificateService using the project App Store Connect key', async () => {
    const doc = secretDoc({
      type: SecretType.app_store_connect_key,
      environment: null,
      ciphertext: JSON.stringify({
        fileBase64: Buffer.from('pem-content').toString('base64'),
        password: null,
        alias: null,
        keyPassword: null,
        issuerId: 'issuer-123',
        keyId: 'key-abc',
      }),
    });
    const { firestore } = createFirestoreMock([{ id: 'secret-asc', data: doc }]);
    const appleCertificateService = createAppleCertificateServiceMock();
    const service = new SecretsService(
      firestore,
      createEncryptionMock() as unknown as EncryptionService,
      appleCertificateService as unknown as AppleCertificateService,
    );

    const result = await service.generateIosDistributionCertificate('user1', 'proj1', 'CSR_PEM');

    expect(appleCertificateService.createDistributionCertificate).toHaveBeenCalledWith(
      { issuerId: 'issuer-123', keyId: 'key-abc', privateKeyPem: 'pem-content' },
      'CSR_PEM',
    );
    expect(result.certificateContentBase64).toBe('cert-b64');
  });

  it('throws NotFoundException when no App Store Connect key is configured for the project', async () => {
    const { firestore } = createFirestoreMock([]);
    const service = new SecretsService(
      firestore,
      createEncryptionMock() as unknown as EncryptionService,
      createAppleCertificateServiceMock() as unknown as AppleCertificateService,
    );

    await expect(
      service.generateIosDistributionCertificate('user1', 'proj1', 'CSR_PEM'),
    ).rejects.toThrow("Ajoutez d'abord une clé App Store Connect API à ce projet.");
  });
});
