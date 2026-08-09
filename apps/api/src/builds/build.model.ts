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
  createdAt: Timestamp | FieldValue;
}
