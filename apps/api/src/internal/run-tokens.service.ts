import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Environment } from '../builds/build.model';
import { FirestoreService } from '../firestore/firestore.service';
import type { Platform } from '../projects/project.model';
import { RUN_TOKENS_COLLECTION, type RunTokenDocument } from './run-token.model';

const TOKEN_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class RunTokensService {
  constructor(private readonly firestore: FirestoreService) {}

  private get tokens() {
    return this.firestore.db.collection(RUN_TOKENS_COLLECTION);
  }

  async issueToken(params: {
    buildId: string;
    projectId: string;
    userId: string;
    platform: Platform;
    environment: Environment;
  }): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const doc: RunTokenDocument = {
      ...params,
      expiresAt: Timestamp.fromMillis(Date.now() + TOKEN_TTL_MS),
      createdAt: FieldValue.serverTimestamp(),
    };
    await this.tokens.doc(token).set(doc);
    return token;
  }

  // Usage unique (le document est supprimé dans la même transaction que sa lecture) : borne
  // la fenêtre d'exposition, sachant que les inputs workflow_dispatch restent visibles sur la
  // page du run GitHub par tout collaborateur ayant accès en lecture au repo (limite connue,
  // documentée — cf. tasks.md T5.27).
  async consumeToken(token: string): Promise<RunTokenDocument> {
    const ref = this.tokens.doc(token);
    return this.firestore.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() as RunTokenDocument | undefined;
      if (!snap.exists || !data) {
        throw new UnauthorizedException('Token invalide.');
      }
      tx.delete(ref);
      if (data.expiresAt.toMillis() < Date.now()) {
        throw new UnauthorizedException('Token expiré.');
      }
      return data;
    });
  }
}
