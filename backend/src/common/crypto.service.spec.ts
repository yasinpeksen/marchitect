import { AppConfig } from './app-config';
import { CryptoService } from './crypto.service';

const buildService = (key = 'b'.repeat(64)) => new CryptoService({ tokenEncryptionKey: key } as AppConfig);

describe('CryptoService', () => {
  it('round-trips text and produces different ciphertext each time', () => {
    const service = buildService();
    const first = service.encrypt('EAAB-secret-token');
    const second = service.encrypt('EAAB-secret-token');
    expect(first).not.toBe(second);
    expect(first).not.toContain('EAAB-secret-token');
    expect(service.decrypt(first)).toBe('EAAB-secret-token');
    expect(service.decrypt(second)).toBe('EAAB-secret-token');
  });

  it('uses the v1 format', () => expect(buildService().encrypt('x').split('.')).toHaveLength(4));

  it('rejects tampered ciphertext', () => {
    const service = buildService();
    const [version, initializationVector, tag, body] = service.encrypt('hello').split('.');
    const tampered = [version, initializationVector, tag, Buffer.from('tampered').toString('base64url')].join('.');
    expect(body).toBeDefined();
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('cannot decrypt with another key', () => {
    const encrypted = buildService('c'.repeat(64)).encrypt('hello');
    expect(() => buildService('d'.repeat(64)).decrypt(encrypted)).toThrow();
  });

  it.each(['', 'v2.a.b.c', 'v1.only-two', 'garbage'])('rejects unsupported format %p', (payload) => {
    expect(() => buildService().decrypt(payload)).toThrow('Unsupported ciphertext format');
  });

  it('supports base64 keys', () => {
    const service = buildService(Buffer.alloc(32, 9).toString('base64'));
    expect(service.decrypt(service.encrypt('ok'))).toBe('ok');
  });

  it('signs deterministically per key and value', () => {
    const service = buildService();
    expect(service.sign('payload')).toBe(service.sign('payload'));
    expect(service.sign('payload')).not.toBe(service.sign('other'));
    expect(buildService('e'.repeat(64)).sign('payload')).not.toBe(service.sign('payload'));
  });

  it('hashes with sha256', () => {
    expect(buildService().sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
