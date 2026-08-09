import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

@Injectable()
export class EncryptionService {
  private readonly masterKey: Buffer;

  constructor(private readonly config: ConfigService) {
    const raw = this.config.getOrThrow<string>('MASTER_ENCRYPTION_KEY');
    this.masterKey = Buffer.from(raw, 'hex');
  }

  encrypt(tenantId: string, plaintext: string): EncryptedPayload {
    const key = this.deriveTenantKey(tenantId);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(tenantId: string, payload: EncryptedPayload): string {
    const key = this.deriveTenantKey(tenantId);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  // Isole les tenants : une clé maître compromise ne suffit pas seule,
  // et une clé dérivée pour un tenant ne permet pas de déchiffrer un autre tenant.
  private deriveTenantKey(tenantId: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.masterKey, Buffer.alloc(0), tenantId, 32));
  }
}
