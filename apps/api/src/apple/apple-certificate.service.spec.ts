import { generateKeyPairSync } from 'crypto';
import { BadRequestException, ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AppleCertificateService, type AppStoreConnectKey } from './apple-certificate.service';

function testKey(): AppStoreConnectKey {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { issuerId: 'issuer-123', keyId: 'key-abc', privateKeyPem: privateKey as unknown as string };
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('AppleCertificateService.createDistributionCertificate', () => {
  afterEach(() => {
    delete (global as { fetch?: unknown }).fetch;
  });

  it('signs a short-lived ES256 JWT scoped to the App Store Connect audience', async () => {
    const key = testKey();
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(201, {
        data: {
          attributes: {
            certificateContent: 'Y2VydA==',
            serialNumber: 'SERIAL',
            expirationDate: '2027-01-01T00:00:00.000Z',
          },
        },
      }),
    );
    (global as { fetch?: unknown }).fetch = fetchMock;
    const service = new AppleCertificateService();

    await service.createDistributionCertificate(key, 'CSR_PEM');

    const [url, options] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.appstoreconnect.apple.com/v1/certificates');
    const token = options.headers.Authorization.replace('Bearer ', '');
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded?.header).toMatchObject({ alg: 'ES256', kid: 'key-abc', typ: 'JWT' });
    const payload = decoded?.payload as jwt.JwtPayload;
    expect(payload.iss).toBe('issuer-123');
    expect(payload.aud).toBe('appstoreconnect-v1');
    expect(payload.exp! - payload.iat!).toBe(1_200);
  });

  it('sends the CSR with certificateType IOS_DISTRIBUTION and returns the parsed certificate', async () => {
    const key = testKey();
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(201, {
        data: {
          attributes: {
            certificateContent: 'Y2VydA==',
            serialNumber: 'SERIAL',
            expirationDate: '2027-01-01T00:00:00.000Z',
          },
        },
      }),
    );
    (global as { fetch?: unknown }).fetch = fetchMock;
    const service = new AppleCertificateService();

    const result = await service.createDistributionCertificate(key, 'CSR_PEM');

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as { data: { attributes: Record<string, string> } };
    expect(body.data.attributes.certificateType).toBe('IOS_DISTRIBUTION');
    expect(body.data.attributes.csrContent).toBe('CSR_PEM');
    expect(result).toEqual({
      certificateContentBase64: 'Y2VydA==',
      serialNumber: 'SERIAL',
      expirationDate: '2027-01-01T00:00:00.000Z',
    });
  });

  it('maps a 409 (certificate limit reached) to ConflictException', async () => {
    (global as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue(jsonResponse(409, { errors: [] }));
    const service = new AppleCertificateService();

    await expect(service.createDistributionCertificate(testKey(), 'CSR_PEM')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('maps 401/403 to UnauthorizedException', async () => {
    (global as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue(jsonResponse(403, { errors: [] }));
    const service = new AppleCertificateService();

    await expect(service.createDistributionCertificate(testKey(), 'CSR_PEM')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('maps 5xx to ServiceUnavailableException', async () => {
    (global as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue(jsonResponse(502, { errors: [] }));
    const service = new AppleCertificateService();

    await expect(service.createDistributionCertificate(testKey(), 'CSR_PEM')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('maps other 4xx statuses to BadRequestException with the Apple detail message', async () => {
    (global as { fetch?: unknown }).fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { errors: [{ detail: 'CSR is malformed' }] }));
    const service = new AppleCertificateService();

    await expect(service.createDistributionCertificate(testKey(), 'CSR_PEM')).rejects.toThrow(
      new BadRequestException('Apple a rejeté la demande de certificat : CSR is malformed'),
    );
  });

  it('maps a network failure to ServiceUnavailableException', async () => {
    (global as { fetch?: unknown }).fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const service = new AppleCertificateService();

    await expect(service.createDistributionCertificate(testKey(), 'CSR_PEM')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
