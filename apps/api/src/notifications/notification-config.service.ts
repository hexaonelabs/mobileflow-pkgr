import { Injectable, NotFoundException } from '@nestjs/common';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { FirestoreService } from '../firestore/firestore.service';
import { PROJECTS_COLLECTION, type ProjectDocument } from '../projects/project.model';
import {
  NOTIFICATION_CONFIGS_COLLECTION,
  type NotificationConfigDocument,
  type NotificationConfigResponse,
} from './notification-config.model';
import type { UpsertNotificationConfigDto } from './dto/upsert-notification-config.dto';

@Injectable()
export class NotificationConfigService {
  constructor(private readonly firestore: FirestoreService) {}

  private get configs() {
    return this.firestore.db.collection(NOTIFICATION_CONFIGS_COLLECTION);
  }

  private async getOwnedProject(userId: string, projectId: string): Promise<ProjectDocument> {
    const doc = await this.firestore.db.collection(PROJECTS_COLLECTION).doc(projectId).get();
    const data = doc.data() as ProjectDocument | undefined;
    if (!doc.exists || !data || data.userId !== userId) {
      throw new NotFoundException('Projet introuvable.');
    }
    return data;
  }

  async upsert(
    userId: string,
    projectId: string,
    dto: UpsertNotificationConfigDto,
  ): Promise<NotificationConfigResponse> {
    await this.getOwnedProject(userId, projectId);

    const ref = this.configs.doc(projectId);
    const existing = await ref.get();
    const current = existing.exists ? (existing.data() as NotificationConfigDocument) : undefined;

    const updated: NotificationConfigDocument = {
      userId,
      projectId,
      slack: dto.slack ?? current?.slack,
      discord: current?.discord,
      email: current?.email,
      createdAt: current?.createdAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await ref.set(updated);
    const saved = await ref.get();
    return this.toResponse(saved.data() as NotificationConfigDocument);
  }

  async getConfig(userId: string, projectId: string): Promise<NotificationConfigResponse> {
    await this.getOwnedProject(userId, projectId);

    const doc = await this.configs.doc(projectId).get();
    if (!doc.exists) {
      return this.toResponse({
        userId,
        projectId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return this.toResponse(doc.data() as NotificationConfigDocument);
  }

  private toResponse(doc: NotificationConfigDocument): NotificationConfigResponse {
    return {
      userId: doc.userId,
      projectId: doc.projectId,
      slack: doc.slack,
      discord: doc.discord,
      email: doc.email,
      createdAt: this.toIsoString(doc.createdAt),
      updatedAt: this.toIsoString(doc.updatedAt),
    };
  }

  // Un FieldValue.serverTimestamp() non résolu (juste avant écriture) ne s'exporte pas en JSON :
  // uniquement les Timestamp effectivement lus depuis Firestore sont convertis en chaîne ISO.
  private toIsoString(value: Timestamp | FieldValue): string | null {
    return value instanceof Timestamp ? value.toDate().toISOString() : null;
  }
}
