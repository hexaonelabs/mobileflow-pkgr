import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

export interface AppStoreConnectKey {
  issuerId: string;
  keyId: string;
  privateKeyPem: string;
}

export interface DistributionCertificate {
  certificateContentBase64: string;
  serialNumber: string;
  expirationDate: string;
}

interface AppleErrorBody {
  errors?: Array<{ code?: string; title?: string; detail?: string }>;
}

const APPLE_API_BASE_URL = 'https://api.appstoreconnect.apple.com/v1';
// Apple exige un JWT court : 20 minutes maximum (https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests).
const ACCESS_TOKEN_TTL_SECONDS = 1_200;
const REQUEST_TIMEOUT_MS = 15_000;

@Injectable()
export class AppleCertificateService {
  async createDistributionCertificate(
    key: AppStoreConnectKey,
    csrPem: string,
  ): Promise<DistributionCertificate> {
    const accessToken = this.buildAccessToken(key);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${APPLE_API_BASE_URL}/certificates`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            type: 'certificates',
            attributes: { certificateType: 'IOS_DISTRIBUTION', csrContent: csrPem },
          },
        }),
        signal: controller.signal,
      });
    } catch {
      throw new ServiceUnavailableException(
        "Impossible de contacter l'API App Store Connect (réseau ou timeout). Réessayez dans un instant.",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw await this.toHttpException(response);
    }

    const body = (await response.json()) as {
      data: { attributes: { certificateContent: string; serialNumber: string; expirationDate: string } };
    };
    return {
      certificateContentBase64: body.data.attributes.certificateContent,
      serialNumber: body.data.attributes.serialNumber,
      expirationDate: body.data.attributes.expirationDate,
    };
  }

  private buildAccessToken(key: AppStoreConnectKey): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        iss: key.issuerId,
        iat: nowSeconds,
        exp: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
        aud: 'appstoreconnect-v1',
      },
      key.privateKeyPem,
      { algorithm: 'ES256', header: { alg: 'ES256', kid: key.keyId, typ: 'JWT' } },
    );
  }

  // Le mapping se base sur le statut HTTP plutôt que sur le texte des messages Apple, qui
  // n'est pas documenté comme stable dans le temps.
  private async toHttpException(response: Response): Promise<Error> {
    const body = (await response.json().catch(() => null)) as AppleErrorBody | null;
    const detail = body?.errors?.[0]?.detail ?? body?.errors?.[0]?.title;

    if (response.status === 409) {
      return new ConflictException(
        'Limite de certificats Distribution atteinte sur ce compte Apple Developer (généralement 3 actifs). ' +
          'Révoquez-en un depuis App Store Connect avant de réessayer.',
      );
    }
    if (response.status === 401 || response.status === 403) {
      return new UnauthorizedException(
        'Clé App Store Connect invalide, expirée ou sans les droits nécessaires pour créer un certificat.',
      );
    }
    if (response.status >= 500) {
      return new ServiceUnavailableException(
        "L'API App Store Connect est indisponible pour le moment. Réessayez dans un instant.",
      );
    }
    return new BadRequestException(
      detail ? `Apple a rejeté la demande de certificat : ${detail}` : 'Apple a rejeté la demande de certificat.',
    );
  }
}
