import type { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Environment } from '../builds/build.model';

export const SecretType = {
  ios_certificate: 'ios_certificate',
  ios_provisioning_profile: 'ios_provisioning_profile',
  android_keystore: 'android_keystore',
  // Clé App Store Connect API de l'utilisateur (issuerId/keyId/.p8), utilisée pour signer une
  // CSR côté serveur et générer un certificat Apple Distribution sans passer par le portail
  // Apple — cf. POST /:id/secrets/generate-ios-certificate. Un seul slot par projet
  // (environment: null), même pattern que ios_certificate.
  app_store_connect_key: 'app_store_connect_key',
} as const;
export type SecretType = (typeof SecretType)[keyof typeof SecretType];

export const SECRETS_COLLECTION = 'secrets';

export interface SecretDocument {
  projectId: string;
  userId: string;
  type: SecretType;
  // null pour ios_certificate/android_keystore (un seul slot par projet) ; requis
  // (staging/production) pour ios_provisioning_profile — cf. IOS_SIGNING_ENVIRONMENTS_PLAN.md.
  environment: Environment | null;
  fileName: string;
  // Payload chiffré (fichier + mots de passe), jamais exposé en clair par l'API — cf. spec.md §5 (FR-8).
  ciphertext: string;
  iv: string;
  authTag: string;
  createdAt: Timestamp | FieldValue;
}
