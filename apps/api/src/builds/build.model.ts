import type { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Platform } from '../projects/project.model';

export const Environment = {
  staging: 'staging',
  production: 'production',
} as const;
export type Environment = (typeof Environment)[keyof typeof Environment];

export const BuildStatus = {
  queued: 'queued',
  running: 'running',
  success: 'success',
  failed: 'failed',
  cancelled: 'cancelled',
} as const;
export type BuildStatus = (typeof BuildStatus)[keyof typeof BuildStatus];

export const TriggeredBy = {
  manual: 'manual',
  push: 'push',
} as const;
export type TriggeredBy = (typeof TriggeredBy)[keyof typeof TriggeredBy];

export const BUILDS_COLLECTION = 'builds';

export interface BuildDocument {
  projectId: string;
  userId: string | null;
  triggeredBy: TriggeredBy;
  environment: Environment;
  platform: Platform;
  branch: string;
  commitSha: string;
  envVars: Record<string, string>;
  status: BuildStatus;
  githubRunId: number | null;
  startedAt: Timestamp | FieldValue | null;
  finishedAt: Timestamp | FieldValue | null;
  durationSeconds: number | null;
  artifactUrl: string | null;
  logsUrl: string | null;
  // Chemin (pas l'URL) dans le bucket Firebase Storage où l'exécutable buildé (.ipa/.apk) a été
  // déposé par le run — une URL signée fraîche est mintée à la demande (cf. StorageService),
  // jamais stockée telle quelle car elle expire.
  artifactStoragePath: string | null;
  // Renseignés uniquement pour iOS, à partir du provisioning profile / de l'archive Xcode —
  // utilisés dans le manifest.plist d'installation OTA (itms-services).
  bundleId: string | null;
  bundleVersion: string | null;
  createdAt: Timestamp | FieldValue;
}

// Forme exposée à l'API : les champs Timestamp de BuildDocument sont convertis en chaînes ISO
// (Timestamp ne se sérialise pas proprement en JSON tel quel) — cf. BuildsService.toApiBuild.
export interface BuildResponse extends Omit<
  BuildDocument,
  'startedAt' | 'finishedAt' | 'createdAt'
> {
  id: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string | null;
}
