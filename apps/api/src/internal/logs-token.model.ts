import type { FieldValue, Timestamp } from 'firebase-admin/firestore';

export const LOGS_TOKENS_COLLECTION = 'buildLogsTokens';

// Le token lui-même sert d'ID de document (lookup direct, pas de requête). Contrairement à
// RunTokenDocument (usage unique, supprimé à la lecture), ce token est vérifié en lecture seule
// à chaque chunk envoyé par le shipper de logs pendant toute la durée du job.
export interface LogsTokenDocument {
  buildId: string;
  projectId: string;
  userId: string;
  expiresAt: Timestamp;
  createdAt: Timestamp | FieldValue;
}
