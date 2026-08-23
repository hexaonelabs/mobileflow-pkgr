import { Injectable, NotFoundException } from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { AppleCertificateService, type DistributionCertificate } from '../apple/apple-certificate.service';
import type { Environment } from '../builds/build.model';
import { EncryptionService } from '../crypto/encryption.service';
import { FirestoreService } from '../firestore/firestore.service';
import { PROJECTS_COLLECTION, Platform, type ProjectDocument } from '../projects/project.model';
import type { CreateSecretDto } from './dto/create-secret.dto';
import { SECRETS_COLLECTION, SecretType, type SecretDocument } from './secret.model';

export interface SecretSummary {
  id: string;
  type: SecretDocument['type'];
  environment: SecretDocument['environment'];
  fileName: string;
  createdAt: SecretDocument['createdAt'];
}

interface DecryptedSecretPayload {
  fileBase64: string;
  password: string | null;
  alias: string | null;
  keyPassword: string | null;
  issuerId: string | null;
  keyId: string | null;
}

export interface BuildSecretsPayload {
  androidKeystore: DecryptedSecretPayload | null;
  iosCertificate: DecryptedSecretPayload | null;
  iosProvisioningProfile: DecryptedSecretPayload | null;
}

@Injectable()
export class SecretsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly encryption: EncryptionService,
    private readonly appleCertificateService: AppleCertificateService,
  ) {}

  private get secrets() {
    return this.firestore.db.collection(SECRETS_COLLECTION);
  }

  private async getOwnedProject(userId: string, projectId: string): Promise<ProjectDocument> {
    const doc = await this.firestore.db.collection(PROJECTS_COLLECTION).doc(projectId).get();
    const data = doc.data() as ProjectDocument | undefined;
    if (!doc.exists || !data || data.userId !== userId) {
      throw new NotFoundException('Projet introuvable.');
    }
    return data;
  }

  async create(userId: string, projectId: string, dto: CreateSecretDto): Promise<SecretSummary> {
    await this.getOwnedProject(userId, projectId);
    const environment = dto.environment ?? null;

    // Un seul secret actif par (type, environment) et par projet : un nouvel upload remplace
    // le précédent. `environment` reste `null` des deux côtés pour ios_certificate/android_keystore,
    // donc leur comportement (un seul slot par projet) est inchangé.
    const existing = await this.secrets
      .where('projectId', '==', projectId)
      .where('type', '==', dto.type)
      .where('environment', '==', environment)
      .get();
    await Promise.all(existing.docs.map((doc) => doc.ref.delete()));

    const payload = JSON.stringify({
      fileBase64: dto.fileBase64,
      password: dto.password ?? null,
      alias: dto.alias ?? null,
      keyPassword: dto.keyPassword ?? null,
      issuerId: dto.issuerId ?? null,
      keyId: dto.keyId ?? null,
    });
    const { ciphertext, iv, authTag } = this.encryption.encrypt(userId, payload);

    const now = FieldValue.serverTimestamp();
    const doc: SecretDocument = {
      projectId,
      userId,
      type: dto.type,
      environment,
      fileName: dto.fileName,
      ciphertext,
      iv,
      authTag,
      createdAt: now,
    };
    const ref = await this.secrets.add(doc);
    return {
      id: ref.id,
      type: doc.type,
      environment: doc.environment,
      fileName: doc.fileName,
      createdAt: doc.createdAt,
    };
  }

  async findAllForProject(userId: string, projectId: string): Promise<SecretSummary[]> {
    await this.getOwnedProject(userId, projectId);
    const snapshot = await this.secrets.where('projectId', '==', projectId).get();
    return snapshot.docs
      .map((doc) => {
        const data = doc.data() as SecretDocument;
        return {
          id: doc.id,
          type: data.type,
          environment: data.environment,
          fileName: data.fileName,
          createdAt: data.createdAt,
        };
      })
      .sort((a, b) => this.toMillis(b.createdAt) - this.toMillis(a.createdAt));
  }

  async remove(userId: string, projectId: string, secretId: string): Promise<void> {
    await this.getOwnedProject(userId, projectId);
    const doc = await this.secrets.doc(secretId).get();
    const data = doc.data() as SecretDocument | undefined;
    if (!doc.exists || !data || data.projectId !== projectId) {
      throw new NotFoundException('Secret introuvable.');
    }
    await doc.ref.delete();
  }

  // Réservé à l'endpoint interne (cf. src/internal/) consommé par le run GitHub Actions via
  // un token de run à courte durée de vie — jamais exposé sur une route authentifiée par JWT
  // utilisateur (le payload déchiffré ne doit jamais transiter par le navigateur).
  async getDecryptedForPlatform(
    userId: string,
    projectId: string,
    platform: Platform,
    environment: Environment,
  ): Promise<BuildSecretsPayload> {
    const snapshot = await this.secrets.where('projectId', '==', projectId).get();
    const docs = snapshot.docs.map((doc) => doc.data() as SecretDocument);

    // ios_provisioning_profile a un doc distinct par environment (cf. create()) ; les autres
    // types n'ont qu'un seul slot par projet (environment: null), donc environment-agnostiques.
    const findOne = (type: SecretType, scopedToEnvironment: boolean): SecretDocument | undefined =>
      docs.find((doc) => doc.type === type && (!scopedToEnvironment || doc.environment === environment));

    const decrypt = (doc: SecretDocument | undefined): DecryptedSecretPayload | null => {
      if (!doc) {
        return null;
      }
      const plaintext = this.encryption.decrypt(userId, {
        ciphertext: doc.ciphertext,
        iv: doc.iv,
        authTag: doc.authTag,
      });
      return JSON.parse(plaintext) as DecryptedSecretPayload;
    };

    if (platform === Platform.android) {
      return {
        androidKeystore: decrypt(findOne(SecretType.android_keystore, false)),
        iosCertificate: null,
        iosProvisioningProfile: null,
      };
    }
    return {
      androidKeystore: null,
      iosCertificate: decrypt(findOne(SecretType.ios_certificate, false)),
      iosProvisioningProfile: decrypt(findOne(SecretType.ios_provisioning_profile, true)),
    };
  }

  // Réservée à l'endpoint authentifié JWT utilisateur qui déclenche la génération de certificat
  // (generateIosDistributionCertificate ci-dessous) — contrairement à getDecryptedForPlatform,
  // jamais consommée par le runner GitHub Actions.
  async getAppStoreConnectKey(
    userId: string,
    projectId: string,
  ): Promise<{ issuerId: string; keyId: string; privateKeyPem: string } | null> {
    const snapshot = await this.secrets
      .where('projectId', '==', projectId)
      .where('type', '==', SecretType.app_store_connect_key)
      .where('environment', '==', null)
      .get();
    const doc = snapshot.docs[0]?.data() as SecretDocument | undefined;
    if (!doc) {
      return null;
    }
    const plaintext = this.encryption.decrypt(userId, {
      ciphertext: doc.ciphertext,
      iv: doc.iv,
      authTag: doc.authTag,
    });
    const payload = JSON.parse(plaintext) as DecryptedSecretPayload;
    if (!payload.issuerId || !payload.keyId) {
      return null;
    }
    return {
      issuerId: payload.issuerId,
      keyId: payload.keyId,
      privateKeyPem: Buffer.from(payload.fileBase64, 'base64').toString('utf8'),
    };
  }

  // Fait signer une CSR par Apple via la clé App Store Connect du projet ; ne persiste rien —
  // le navigateur reconstruit et upload le .p12 via create() ci-dessus, endpoint inchangé.
  async generateIosDistributionCertificate(
    userId: string,
    projectId: string,
    csrPem: string,
  ): Promise<DistributionCertificate> {
    await this.getOwnedProject(userId, projectId);
    const key = await this.getAppStoreConnectKey(userId, projectId);
    if (!key) {
      throw new NotFoundException('Ajoutez d\'abord une clé App Store Connect API à ce projet.');
    }
    return this.appleCertificateService.createDistributionCertificate(key, csrPem);
  }

  private toMillis(value: SecretDocument['createdAt']): number {
    return typeof value === 'object' && value !== null && 'toMillis' in value
      ? value.toMillis()
      : 0;
  }
}
