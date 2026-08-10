import type { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Platform } from '../projects/project.model';

export const RUN_TOKENS_COLLECTION = 'runSecretsTokens';

// Le token lui-même sert d'ID de document (lookup direct, pas de requête).
export interface RunTokenDocument {
  buildId: string;
  projectId: string;
  userId: string;
  platform: Platform;
  expiresAt: Timestamp;
  createdAt: Timestamp | FieldValue;
}
