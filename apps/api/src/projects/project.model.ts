import type { FieldValue, Timestamp } from 'firebase-admin/firestore';

export const Framework = {
  capacitor: 'capacitor',
} as const;
export type Framework = (typeof Framework)[keyof typeof Framework];

export const Platform = {
  android: 'android',
  ios: 'ios',
} as const;
export type Platform = (typeof Platform)[keyof typeof Platform];

export const PROJECTS_COLLECTION = 'projects';

export interface ProjectDocument {
  userId: string;
  name: string;
  githubRepoFullName: string;
  framework: Framework;
  // Branche déclenchant un build automatique sur push ; null = désactivé (opt-in).
  autoTriggerBranch: string | null;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}
