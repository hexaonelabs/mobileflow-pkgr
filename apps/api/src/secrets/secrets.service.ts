import { Injectable, NotFoundException } from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { EncryptionService } from '../crypto/encryption.service';
import { FirestoreService } from '../firestore/firestore.service';
import { PROJECTS_COLLECTION, type ProjectDocument } from '../projects/project.model';
import type { CreateSecretDto } from './dto/create-secret.dto';
import { SECRETS_COLLECTION, type SecretDocument } from './secret.model';

export interface SecretSummary {
  id: string;
  type: SecretDocument['type'];
  fileName: string;
  createdAt: SecretDocument['createdAt'];
}

@Injectable()
export class SecretsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly encryption: EncryptionService,
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

    // Un seul secret actif par type et par projet : un nouvel upload remplace le précédent.
    const existing = await this.secrets
      .where('projectId', '==', projectId)
      .where('type', '==', dto.type)
      .get();
    await Promise.all(existing.docs.map((doc) => doc.ref.delete()));

    const payload = JSON.stringify({
      fileBase64: dto.fileBase64,
      password: dto.password,
      alias: dto.alias ?? null,
      keyPassword: dto.keyPassword ?? null,
    });
    const { ciphertext, iv, authTag } = this.encryption.encrypt(userId, payload);

    const now = FieldValue.serverTimestamp();
    const doc: SecretDocument = {
      projectId,
      userId,
      type: dto.type,
      fileName: dto.fileName,
      ciphertext,
      iv,
      authTag,
      createdAt: now,
    };
    const ref = await this.secrets.add(doc);
    return { id: ref.id, type: doc.type, fileName: doc.fileName, createdAt: doc.createdAt };
  }

  async findAllForProject(userId: string, projectId: string): Promise<SecretSummary[]> {
    await this.getOwnedProject(userId, projectId);
    const snapshot = await this.secrets.where('projectId', '==', projectId).get();
    return snapshot.docs
      .map((doc) => {
        const data = doc.data() as SecretDocument;
        return { id: doc.id, type: data.type, fileName: data.fileName, createdAt: data.createdAt };
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

  private toMillis(value: SecretDocument['createdAt']): number {
    return typeof value === 'object' && value !== null && 'toMillis' in value
      ? value.toMillis()
      : 0;
  }
}
