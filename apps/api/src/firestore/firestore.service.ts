import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { Firestore, getFirestore } from 'firebase-admin/firestore';

@Injectable()
export class FirestoreService {
  readonly db: Firestore;

  constructor(configService: ConfigService) {
    if (getApps().length === 0) {
      initializeApp({
        credential: cert({
          projectId: configService.getOrThrow<string>('FIREBASE_PROJECT_ID'),
          clientEmail: configService.getOrThrow<string>('FIREBASE_CLIENT_EMAIL'),
          privateKey: configService
            .getOrThrow<string>('FIREBASE_PRIVATE_KEY')
            .replace(/\\n/g, '\n'),
        }),
      });
    }
    this.db = getFirestore();
  }
}
