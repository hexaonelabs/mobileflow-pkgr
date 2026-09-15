import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { FirestoreService } from '../firestore/firestore.service';
import { LOGS_TOKENS_COLLECTION, type LogsTokenDocument } from './logs-token.model';

// Couvre le job iOS le plus lent observé (compilation + export) avec une marge confortable.
const TOKEN_TTL_MS = 90 * 60 * 1000;

@Injectable()
export class LogsTokensService {
  constructor(private readonly firestore: FirestoreService) {}

  private get tokens() {
    return this.firestore.db.collection(LOGS_TOKENS_COLLECTION);
  }

  async issueToken(params: {
    buildId: string;
    projectId: string;
    userId: string;
  }): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const doc: LogsTokenDocument = {
      ...params,
      expiresAt: Timestamp.fromMillis(Date.now() + TOKEN_TTL_MS),
      createdAt: FieldValue.serverTimestamp(),
    };
    await this.tokens.doc(token).set(doc);
    return token;
  }

  // Vérification en lecture seule (jamais supprimé ici) : le shipper de logs envoie plusieurs
  // chunks pendant toute la durée du job avec le même token.
  async verifyToken(token: string, buildId: string): Promise<LogsTokenDocument> {
    const snap = await this.tokens.doc(token).get();
    const data = snap.data() as LogsTokenDocument | undefined;
    if (!snap.exists || !data) {
      throw new UnauthorizedException('Token invalide.');
    }
    if (data.buildId !== buildId) {
      throw new UnauthorizedException('Token invalide pour ce build.');
    }
    if (data.expiresAt.toMillis() < Date.now()) {
      throw new UnauthorizedException('Token expiré.');
    }
    return data;
  }

  // Appelé à la finalisation du build (cf. BuildsService.finalizeBuildStatus) : ferme la
  // fenêtre d'ingestion dès que le job est terminé, plutôt que d'attendre l'expiration TTL.
  async revokeToken(buildId: string): Promise<void> {
    const snap = await this.tokens.where('buildId', '==', buildId).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  }
}
