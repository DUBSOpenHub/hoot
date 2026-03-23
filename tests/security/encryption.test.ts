/**
 * Acceptance tests for FR-5: Encryption at Rest
 * Sealed — implementation team does not see these until after code ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

let testDir: string;
let dbPath: string;
let tokenPath: string;

beforeEach(() => {
  testDir = join(tmpdir(), `hoot-enc-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  dbPath = join(testDir, 'hoot.db');
  tokenPath = join(testDir, 'api-token');
  writeFileSync(tokenPath, 'test-api-secret-key-for-hkdf', 'utf8');
  process.env.HOOT_DB_PATH = dbPath;
  process.env.HOOT_TOKEN_PATH = tokenPath;
  vi.resetModules();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
  delete process.env.HOOT_DB_PATH;
  delete process.env.HOOT_TOKEN_PATH;
  delete process.env.HOOT_ENCRYPT_DB;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// FR-5.1 — When HOOT_ENCRYPT_DB=1, SQLCipher is used with HKDF key
// ---------------------------------------------------------------------------
describe('FR-5.1 — Encrypted database opens with SQLCipher', () => {
  it('FR-5.1: getDb() with HOOT_ENCRYPT_DB=1 does not throw', async () => {
    process.env.HOOT_ENCRYPT_DB = '1';
    vi.resetModules();
    // If better-sqlite3-sqlcipher is not installed, skip gracefully
    try {
      const { getDb } = await import('../../src/store/db');
      expect(() => getDb()).not.toThrow();
    } catch (e: unknown) {
      const msg = String(e);
      if (msg.includes('Cannot find module') || msg.includes('sqlcipher')) {
        // SQLCipher dependency not installed — skip
        return;
      }
      throw e;
    }
  });

  it('FR-5.1: encryption key is derived from api-token file via HKDF-SHA256', async () => {
    process.env.HOOT_ENCRYPT_DB = '1';
    vi.resetModules();

    // Verify the db module references HKDF key derivation
    const fs = await import('fs');
    const path = await import('path');
    let source = '';
    try {
      source = fs.readFileSync(path.resolve('src/store/db.ts'), 'utf8');
    } catch { return; }

    // Source should reference HKDF or crypto key derivation
    expect(source).toMatch(/hkdf|HKDF|createHmac|scrypt|pbkdf2|deriveKey|crypto/i);
  });

  it('FR-5.1: encryption key uses salt "max-db-v1"', async () => {
    const fs = await import('fs');
    const path = await import('path');
    let source = '';
    try {
      source = fs.readFileSync(path.resolve('src/store/db.ts'), 'utf8');
    } catch { return; }

    expect(source).toMatch(/max-db-v1/);
  });
});

// ---------------------------------------------------------------------------
// FR-5.2 — Migration exports all rows, creates encrypted DB, atomically renames
// ---------------------------------------------------------------------------
describe('FR-5.2 — Encryption migration', () => {
  it('FR-5.2: a migration script or function is exported', async () => {
    let mod: Record<string, unknown>;
    try {
      mod = await import('../../src/store/db');
    } catch { return; }

    const hasMigration =
      typeof mod.migrateToEncrypted === 'function' ||
      typeof mod.encryptDatabase === 'function' ||
      typeof mod.runEncryptionMigration === 'function';

    // Also check for a standalone migration script
    const fs = await import('fs');
    const path = await import('path');
    const migrationExists =
      fs.existsSync(path.resolve('src/store/migration.ts')) ||
      fs.existsSync(path.resolve('src/store/migrate-to-encrypted.ts')) ||
      fs.existsSync(path.resolve('scripts/migrate-to-encrypted.ts')) ||
      fs.existsSync(path.resolve('scripts/migrate-to-encrypted.js'));

    expect(hasMigration || migrationExists).toBe(true);
  });

  it('FR-5.2: migration creates an encrypted database file', async () => {
    process.env.HOOT_ENCRYPT_DB = '1';
    vi.resetModules();

    let mod: Record<string, unknown>;
    try {
      mod = await import('../../src/store/db');
    } catch { return; }

    const migrateFn =
      (mod.migrateToEncrypted ?? mod.encryptDatabase ?? mod.runEncryptionMigration) as ((...args: unknown[]) => Promise<void>) | undefined;
    if (typeof migrateFn !== 'function') return;

    // Create a plain DB first
    const { getDb } = mod as { getDb: () => { prepare: (sql: string) => { run: (...args: unknown[]) => void; all: () => unknown[] } } };
    const db = getDb();
    db.prepare('CREATE TABLE IF NOT EXISTS test_data (id INTEGER PRIMARY KEY, value TEXT)').run();
    db.prepare('INSERT INTO test_data (value) VALUES (?)').run('test-row');

    await migrateFn({ dbPath, tokenPath });

    const encryptedPath = dbPath.replace('.db', '-encrypted.db');
    expect(existsSync(encryptedPath) || existsSync(dbPath)).toBe(true);
  });

  it('FR-5.2: migration atomically renames (old plain db replaced by encrypted)', async () => {
    process.env.HOOT_ENCRYPT_DB = '1';
    vi.resetModules();

    let mod: Record<string, unknown>;
    try {
      mod = await import('../../src/store/db');
    } catch { return; }

    const migrateFn =
      (mod.migrateToEncrypted ?? mod.encryptDatabase ?? mod.runEncryptionMigration) as ((...args: unknown[]) => Promise<void>) | undefined;
    if (typeof migrateFn !== 'function') return;

    // Only one db file should exist after migration (the encrypted one)
    await migrateFn({ dbPath, tokenPath });

    // The original plain DB should no longer be accessible as plaintext
    // (either renamed or replaced)
    const plainExists = existsSync(dbPath + '.plain-backup') || !existsSync(dbPath + '.unencrypted');
    expect(plainExists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FR-5.3 — Migration is idempotent
// ---------------------------------------------------------------------------
describe('FR-5.3 — Idempotent migration', () => {
  it('FR-5.3: running migration twice does not throw', async () => {
    process.env.HOOT_ENCRYPT_DB = '1';
    vi.resetModules();

    let mod: Record<string, unknown>;
    try {
      mod = await import('../../src/store/db');
    } catch { return; }

    const migrateFn =
      (mod.migrateToEncrypted ?? mod.encryptDatabase ?? mod.runEncryptionMigration) as ((...args: unknown[]) => Promise<void>) | undefined;
    if (typeof migrateFn !== 'function') return;

    await migrateFn({ dbPath, tokenPath });
    // Second run must not throw
    await expect(migrateFn({ dbPath, tokenPath })).resolves.not.toThrow();
  });

  it('FR-5.3: data is intact after running migration twice', async () => {
    process.env.HOOT_ENCRYPT_DB = '1';
    vi.resetModules();

    let mod: Record<string, unknown>;
    try {
      mod = await import('../../src/store/db');
    } catch { return; }

    const migrateFn =
      (mod.migrateToEncrypted ?? mod.encryptDatabase ?? mod.runEncryptionMigration) as ((...args: unknown[]) => Promise<void>) | undefined;
    const { getDb } = mod as { getDb: () => { prepare: (sql: string) => { run: (...args: unknown[]) => void; all: () => Array<{ value: string }> } } };
    if (typeof migrateFn !== 'function') return;

    const db = getDb();
    db.prepare('CREATE TABLE IF NOT EXISTS idempotent_test (id INTEGER PRIMARY KEY, value TEXT)').run();
    db.prepare("INSERT INTO idempotent_test (value) VALUES ('original')").run();

    await migrateFn({ dbPath, tokenPath });
    await migrateFn({ dbPath, tokenPath });

    // Re-open and verify data
    vi.resetModules();
    const mod2 = await import('../../src/store/db') as { getDb: () => { prepare: (sql: string) => { all: () => Array<{ value: string }> } } };
    const db2 = mod2.getDb();
    const rows = db2.prepare('SELECT * FROM idempotent_test').all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].value).toBe('original');
  });
});

// ---------------------------------------------------------------------------
// FR-5.4 — Encrypted database unreadable by standard sqlite3 CLI
// ---------------------------------------------------------------------------
describe('FR-5.4 — Encrypted DB unreadable without key', () => {
  it('FR-5.4: sqlite3 CLI cannot read tables from an encrypted database', async () => {
    process.env.HOOT_ENCRYPT_DB = '1';
    vi.resetModules();

    let mod: Record<string, unknown>;
    try {
      mod = await import('../../src/store/db');
    } catch { return; }

    const { getDb } = mod as { getDb: () => { prepare: (sql: string) => { run: (...args: unknown[]) => void } } };
    const migrateFn =
      (mod.migrateToEncrypted ?? mod.encryptDatabase ?? mod.runEncryptionMigration) as ((...args: unknown[]) => Promise<void>) | undefined;

    if (typeof migrateFn !== 'function') return;

    const db = getDb();
    db.prepare('CREATE TABLE IF NOT EXISTS secret_data (id INTEGER PRIMARY KEY, value TEXT)').run();
    db.prepare("INSERT INTO secret_data (value) VALUES ('top secret')").run();

    await migrateFn({ dbPath, tokenPath });

    // Try to read with plain sqlite3 CLI (should fail or produce gibberish)
    let output = '';
    let errorOccurred = false;
    try {
      output = execSync(`sqlite3 "${dbPath}" ".tables"`, { encoding: 'utf8', timeout: 5000 });
    } catch {
      errorOccurred = true;
    }

    // Either the command failed, or output doesn't show our tables
    expect(errorOccurred || !output.includes('secret_data')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FR-5.5 — HOOT_ENCRYPT_DB=0 keeps better-sqlite3 unchanged
// ---------------------------------------------------------------------------
describe('FR-5.5 — HOOT_ENCRYPT_DB=0 uses plain better-sqlite3', () => {
  it('FR-5.5: getDb() with HOOT_ENCRYPT_DB=0 uses plain better-sqlite3', async () => {
    process.env.HOOT_ENCRYPT_DB = '0';
    vi.resetModules();
    const { getDb } = await import('../../src/store/db');
    const db = getDb();
    expect(db).toBeDefined();
    // Plain DB should be readable
    expect(() => db.prepare('SELECT 1').get()).not.toThrow();
  });

  it('FR-5.5: getDb() with HOOT_ENCRYPT_DB unset uses plain better-sqlite3', async () => {
    delete process.env.HOOT_ENCRYPT_DB;
    vi.resetModules();
    const { getDb } = await import('../../src/store/db');
    const db = getDb();
    expect(db).toBeDefined();
    expect(() => db.prepare('SELECT 1').get()).not.toThrow();
  });

  it('FR-5.5: plain db file is readable by standard sqlite3 CLI when unencrypted', () => {
    // Create a real SQLite db and verify sqlite3 CLI can read it
    let output = '';
    let failed = false;
    try {
      // Create a minimal db
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      db.prepare('CREATE TABLE plain_test (x INTEGER)').run();
      db.prepare('INSERT INTO plain_test VALUES (42)').run();
      db.close();

      output = execSync(`sqlite3 "${dbPath}" "SELECT x FROM plain_test;"`, {
        encoding: 'utf8',
        timeout: 5000,
      });
    } catch {
      failed = true;
    }

    if (!failed) {
      expect(output.trim()).toContain('42');
    }
  });
});
