import { Injectable } from '@angular/core';
import * as forge from 'node-forge';

const RSA_KEY_ALGORITHM: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

@Injectable({ providedIn: 'root' })
export class IosCertificateCryptoService {
  // RSA-2048 généré nativement (crypto.subtle) : c'est l'opération sensible au RNG et coûteuse
  // en calcul, donc celle où s'appuyer sur le moteur crypto natif du navigateur compte le plus.
  // extractable: true est nécessaire pour pouvoir exporter la clé privée en .p12 plus tard.
  async generateKeyPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey(RSA_KEY_ALGORITHM, true, ['sign', 'verify']);
  }

  // La CSR (PKCS#10) est construite via node-forge : Web Crypto API n'a aucune notion de ce
  // format ASN.1, seulement des primitives bas niveau.
  async createCertificateSigningRequest(keyPair: CryptoKeyPair, commonName: string): Promise<string> {
    const { privateKey, publicKey } = await this.toForgeKeyPair(keyPair);
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = publicKey;
    csr.setSubject([{ name: 'commonName', value: commonName }]);
    csr.sign(privateKey, forge.md.sha256.create());
    return forge.pki.certificationRequestToPem(csr);
  }

  // node-forge est utilisé ici (et non une lib "moderne" comme pkijs) car il implémente les
  // algorithmes PKCS#12 historiques (pbeWithSHAAnd3-KeyTripleDES-CBC) attendus par le Trousseau
  // macOS/codesign — le chiffrement PBES2 "moderne" que pkijs (ou OpenSSL 3 par défaut) produit
  // est connu pour échouer à l'import dans le Trousseau.
  async buildPkcs12(
    keyPair: CryptoKeyPair,
    certificateContentBase64: string,
    password: string,
  ): Promise<string> {
    const { privateKey } = await this.toForgeKeyPair(keyPair);
    const certAsn1 = forge.asn1.fromDer(forge.util.decode64(certificateContentBase64));
    const certificate = forge.pki.certificateFromAsn1(certAsn1);
    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, certificate, password, { algorithm: '3des' });
    return forge.util.encode64(forge.asn1.toDer(p12Asn1).getBytes());
  }

  // crypto.getRandomValues (pas Math.random) : mot de passe interne, jamais saisi ni mémorisé
  // par l'utilisateur — MobileFlow le stocke chiffré et l'utilise au moment du build.
  generateRandomPassword(length = 32): string {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private async toForgeKeyPair(
    keyPair: CryptoKeyPair,
  ): Promise<{ privateKey: forge.pki.rsa.PrivateKey; publicKey: forge.pki.rsa.PublicKey }> {
    const [pkcs8, spki] = await Promise.all([
      crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
      crypto.subtle.exportKey('spki', keyPair.publicKey),
    ]);
    const privateKey = forge.pki.privateKeyFromAsn1(
      forge.asn1.fromDer(this.arrayBufferToBinaryString(pkcs8)),
    );
    const publicKey = forge.pki.publicKeyFromAsn1(
      forge.asn1.fromDer(this.arrayBufferToBinaryString(spki)),
    );
    return { privateKey, publicKey };
  }

  // Passe par une chaîne binaire plutôt que par le typed array directement : selon
  // l'environnement d'exécution (ex: isolation par royaume JS des workers de test), le
  // constructeur ByteStringBuffer de forge peut échouer à reconnaître un Uint8Array qui ne
  // provient pas du même royaume que sa propre classe Uint8Array (instanceof cross-royaume).
  // Une chaîne, primitive, n'a pas ce problème.
  private arrayBufferToBinaryString(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return binary;
  }
}
