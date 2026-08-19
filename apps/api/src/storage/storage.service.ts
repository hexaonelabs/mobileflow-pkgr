import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getStorage } from 'firebase-admin/storage';

@Injectable()
export class StorageService {
  private readonly bucketName: string;

  constructor(private readonly config: ConfigService) {
    this.bucketName = this.config.getOrThrow<string>('FIREBASE_STORAGE_BUCKET');
  }

  private get bucket() {
    return getStorage().bucket(this.bucketName);
  }

  // URL signée à courte durée de vie : le bucket reste privé, chaque page d'installation ou
  // téléchargement en mint une fraîche à la demande plutôt que d'en stocker une en base (qui
  // expirerait silencieusement).
  async getSignedDownloadUrl(path: string, expiresInMs: number): Promise<string> {
    const [url] = await this.bucket.file(path).getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInMs,
    });
    return url;
  }

  async uploadBuffer(path: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.bucket.file(path).save(buffer, { metadata: { contentType } });
  }
}
