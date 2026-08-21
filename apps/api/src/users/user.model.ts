import type { FieldValue, Timestamp } from 'firebase-admin/firestore';

export const AuthProvider = {
  email: 'email',
  google: 'google',
  github: 'github',
} as const;
export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];

export const Plan = {
  free: 'free',
  starter: 'starter',
  pro: 'pro',
  enterprise: 'enterprise',
} as const;
export type Plan = (typeof Plan)[keyof typeof Plan];

export const USERS_COLLECTION = 'users';

export const SubscriptionStatus = {
  active: 'active',
  pastDue: 'past_due',
  canceled: 'canceled',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export interface UserBilling {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Timestamp;
}

export interface UserDocument {
  email: string;
  authProvider: AuthProvider;
  passwordHash: string | null;
  githubInstallationId: string | null;
  plan: Plan;
  billing?: UserBilling;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}
