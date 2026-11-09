import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';
import { AppConfig } from './app-config';

/** AES-256-GCM token encryption. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: AppConfig) {
    const rawKey = config.tokenEncryptionKey;
    this.key = /^[0-9a-fA-F]{64}$/.test(rawKey) ? Buffer.from(rawKey, 'hex') : Buffer.from(rawKey, 'base64');
  }

  encrypt(plainText: string): string {
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, initializationVector);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();
    return [
      'v1',
      initializationVector.toString('base64url'),
      authenticationTag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string): string {
    const [version, initializationVector, authenticationTag, encrypted] = payload.split('.');
    if (version !== 'v1' || !initializationVector || !authenticationTag || !encrypted) {
      throw new Error('Unsupported ciphertext format');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(initializationVector, 'base64url'));
    decipher.setAuthTag(Buffer.from(authenticationTag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
  }

  /** HMAC used for OAuth `state` so the callback can be tied to a user without a session. */
  sign(value: string): string {
    return createHmac('sha256', this.key).update(value).digest('base64url');
  }

  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
