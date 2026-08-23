import { webcrypto } from 'node:crypto';
import * as forge from 'node-forge';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IosCertificateCryptoService } from './ios-certificate-crypto.service';

// jsdom (l'environnement de test par défaut) ne fournit pas crypto.subtle : on retombe sur le
// moteur WebCrypto natif de Node, qui a la même API.
function stubWebCrypto(): void {
  vi.stubGlobal('crypto', webcrypto as unknown as Crypto);
}

// Passe par une chaîne binaire plutôt qu'un Uint8Array : sous certains environnements de test
// (isolation par royaume JS des workers Vitest), le ByteStringBuffer de forge ne reconnaît pas
// un typed array qui ne provient pas de son propre royaume (instanceof cross-royaume).
function arrayBufferToBinaryString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return binary;
}

async function toForgePublicKey(publicKey: CryptoKey): Promise<forge.pki.rsa.PublicKey> {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  return forge.pki.publicKeyFromAsn1(forge.asn1.fromDer(arrayBufferToBinaryString(spki)));
}

async function toForgePrivateKey(privateKey: CryptoKey): Promise<forge.pki.rsa.PrivateKey> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  return forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(arrayBufferToBinaryString(pkcs8)));
}

// Simule ce qu'Apple renverrait : un certificat signant la clé publique de la paire générée
// côté client, encodé en DER/base64 comme le fait l'API App Store Connect.
async function fakeAppleCertificateFor(keyPair: CryptoKeyPair): Promise<string> {
  const forgePublicKey = await toForgePublicKey(keyPair.publicKey);
  const forgePrivateKey = await toForgePrivateKey(keyPair.privateKey);

  const cert = forge.pki.createCertificate();
  cert.publicKey = forgePublicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attrs = [{ name: 'commonName', value: 'Test App' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(forgePrivateKey, forge.md.sha256.create());

  return forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
}

describe('IosCertificateCryptoService', () => {
  let service: IosCertificateCryptoService;

  beforeEach(() => {
    stubWebCrypto();
    service = new IosCertificateCryptoService();
  });

  it('generates an extractable RSA-2048 key pair', async () => {
    const keyPair = await service.generateKeyPair();

    expect(keyPair.privateKey.extractable).toBe(true);
    expect(keyPair.publicKey.algorithm.name).toBe('RSASSA-PKCS1-v1_5');
    expect((keyPair.publicKey.algorithm as RsaHashedKeyAlgorithm).modulusLength).toBe(2048);
  });

  it('creates a CSR whose signature verifies and carries the requested common name', async () => {
    const keyPair = await service.generateKeyPair();

    const csrPem = await service.createCertificateSigningRequest(keyPair, 'My iOS App');

    const csr = forge.pki.certificationRequestFromPem(csrPem);
    expect(csr.verify()).toBe(true);
    expect(csr.subject.getField('CN')?.value).toBe('My iOS App');
  });

  it('round-trips a private key through buildPkcs12: the .p12 decodes with the same password and matches the original key', async () => {
    const keyPair = await service.generateKeyPair();
    const certificateContentBase64 = await fakeAppleCertificateFor(keyPair);
    const password = service.generateRandomPassword();

    const p12Base64 = await service.buildPkcs12(keyPair, certificateContentBase64, password);

    const p12Asn1 = forge.asn1.fromDer(forge.util.decode64(p12Base64));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    const pkcs8ShroudedKeyBagOid = forge.pki.oids['pkcs8ShroudedKeyBag'];
    const certBagOid = forge.pki.oids['certBag'];
    const keyBags = p12.getBags({ bagType: pkcs8ShroudedKeyBagOid });
    const certBags = p12.getBags({ bagType: certBagOid });
    const recoveredKey = keyBags[pkcs8ShroudedKeyBagOid]?.[0]?.key as forge.pki.rsa.PrivateKey;
    const originalPrivateKey = await toForgePrivateKey(keyPair.privateKey);

    expect(recoveredKey.n.toString(16)).toBe(originalPrivateKey.n.toString(16));
    expect(certBags[certBagOid]).toHaveLength(1);
  });

  it('rejects decoding the .p12 with the wrong password', async () => {
    const keyPair = await service.generateKeyPair();
    const certificateContentBase64 = await fakeAppleCertificateFor(keyPair);
    const p12Base64 = await service.buildPkcs12(keyPair, certificateContentBase64, 'correct-password');

    const p12Asn1 = forge.asn1.fromDer(forge.util.decode64(p12Base64));
    expect(() => forge.pkcs12.pkcs12FromAsn1(p12Asn1, 'wrong-password')).toThrow();
  });

  it('generates random passwords that are long and not repeated', () => {
    const first = service.generateRandomPassword();
    const second = service.generateRandomPassword();

    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(first).not.toBe(second);
  });
});
