// One-off migration: backfill `environment: 'staging'` on existing ios_provisioning_profile
// secrets uploaded before this field existed — matches today's de facto behavior (everything
// currently exports Ad Hoc). Idempotent: only touches docs missing the field.
// cf. IOS_SIGNING_ENVIRONMENTS_PLAN.md §5, option (a).
//
// Usage (from apps/api): npm run migrate:provisioning-profile-environment
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function loadEnvFile(path: string): void {
  if (!existsSync(path)) {
    return;
  }
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
}

loadEnvFile(resolve(__dirname, '../.env'));

const SECRETS_COLLECTION = 'secrets';

async function main(): Promise<void> {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID!,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
      }),
    });
  }
  const db = getFirestore();

  const snapshot = await db
    .collection(SECRETS_COLLECTION)
    .where('type', '==', 'ios_provisioning_profile')
    .get();
  const toMigrate = snapshot.docs.filter((doc) => !doc.data().environment);

  if (toMigrate.length === 0) {
    console.log('No ios_provisioning_profile secret needs migration.');
    return;
  }

  await Promise.all(toMigrate.map((doc) => doc.ref.update({ environment: 'staging' })));
  console.log(
    `Migrated ${toMigrate.length} ios_provisioning_profile secret(s) to environment: staging.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
