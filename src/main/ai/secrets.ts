// Secret storage. In the app, values are encrypted with Electron safeStorage,
// whose key lives in the macOS Keychain; only ciphertext is written to disk
// (with 0600 permissions), outside the database, so backups never contain
// secrets. Nothing here is ever logged.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SecretStore {
  available(): boolean;
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(data: Buffer): string;
}

export class SecretStoreUnavailableError extends Error {
  constructor() {
    super('Secure storage (Keychain) is not available, so credentials cannot be saved.');
    this.name = 'SecretStoreUnavailableError';
  }
}

export class EncryptedFileSecretStore implements SecretStore {
  private cache: Record<string, string> | null = null;

  constructor(
    private readonly path: string,
    private readonly cipher: Cipher,
  ) {}

  available(): boolean {
    return this.cipher.isEncryptionAvailable();
  }

  private load(): Record<string, string> {
    if (this.cache) return this.cache;
    if (!existsSync(this.path)) return (this.cache = {});
    try {
      this.cache = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, string>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cache ?? {}), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }

  get(key: string): string | null {
    const enc = this.load()[key];
    if (!enc || !this.available()) return null;
    try {
      return this.cipher.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    if (!this.available()) throw new SecretStoreUnavailableError();
    const all = this.load();
    all[key] = this.cipher.encryptString(value).toString('base64');
    this.persist();
  }

  delete(key: string): void {
    const all = this.load();
    if (key in all) {
      delete all[key];
      this.persist();
    }
  }
}

/** In-memory store for tests. */
export class MemorySecretStore implements SecretStore {
  private readonly map = new Map<string, string>();
  constructor(private readonly isAvailable = true) {}
  available(): boolean {
    return this.isAvailable;
  }
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    if (!this.isAvailable) throw new SecretStoreUnavailableError();
    this.map.set(key, value);
  }
  delete(key: string): void {
    this.map.delete(key);
  }
}
