import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, unlinkSync } from "fs";
import { createHmac, hkdfSync } from "crypto";
import { DB_PATH, API_TOKEN_PATH, ensureMaxHome } from "../paths.js";
import { createLogger } from "../observability/logger.js";

const log = createLogger("migrate-encrypt");

function getDbPath(): string {
  return process.env.MAX_DB_PATH ?? DB_PATH;
}

export function deriveDbKey(tokenPath?: string): string {
  const resolvedTokenPath = tokenPath ?? process.env.MAX_TOKEN_PATH ?? API_TOKEN_PATH;
  if (!existsSync(resolvedTokenPath)) {
    throw new Error(`API token not found at ${resolvedTokenPath}. Run 'hoot setup' first.`);
  }
  const token = readFileSync(resolvedTokenPath, "utf-8").trim();
  const salt = Buffer.from("max-db-v1");
  const ikm = Buffer.from(token, "utf-8");
  const derived = hkdfSync("sha256", ikm, salt, Buffer.alloc(0), 32);
  return Buffer.from(derived).toString("hex");
}

export async function migrateToEncrypted(opts?: { dbPath?: string; tokenPath?: string }): Promise<void> {
  if (!process.env.MAX_DB_PATH && !opts?.dbPath) ensureMaxHome();

  const dbPath = opts?.dbPath ?? getDbPath();
  const ENCRYPTED_DB_PATH = dbPath + ".encrypted";
  const BACKUP_DB_PATH = dbPath + ".plaintext-backup";

  // FR-5.3: Check if already encrypted (marker: .plaintext-backup exists)
  if (existsSync(BACKUP_DB_PATH)) {
    log.info("Database already encrypted (backup file present). Migration is idempotent — skipping.");
    return;
  }

  if (!existsSync(dbPath)) {
    log.info("No database found — will be created encrypted on first access.");
    return;
  }

  log.info("Starting encryption migration...");

  const Database = (await import("better-sqlite3")).default;
  const plainDb = new Database(dbPath, { readonly: true });

  const tables = plainDb.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
  ).all() as { name: string }[];

  const allData: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    allData[name] = plainDb.prepare(`SELECT * FROM "${name}"`).all();
  }

  const ddlRows = plainDb.prepare(
    `SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`
  ).all() as { name: string; sql: string }[];

  plainDb.close();

  const key = deriveDbKey(opts?.tokenPath);

  const encDb = new Database(ENCRYPTED_DB_PATH);
  encDb.pragma("journal_mode = WAL");

  for (const { sql } of ddlRows) {
    try { encDb.exec(sql); } catch { /* table may already exist */ }
  }

  for (const [tableName, rows] of Object.entries(allData)) {
    if (rows.length === 0) continue;
    const cols = Object.keys(rows[0] as object);
    const placeholders = cols.map(() => "?").join(", ");
    const stmt = encDb.prepare(
      `INSERT OR REPLACE INTO "${tableName}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`
    );
    const insertMany = encDb.transaction((items: unknown[]) => {
      for (const row of items) {
        stmt.run(...Object.values(row as object));
      }
    });
    insertMany(rows);
    log.info(`Migrated table ${tableName}`, { rows: rows.length });
  }

  encDb.close();

  // XOR the file bytes with the derived key to make it unreadable by standard sqlite3
  const keyBytes = Buffer.from(key, 'hex');
  const dbBytes = readFileSync(ENCRYPTED_DB_PATH);
  for (let i = 0; i < dbBytes.length; i++) {
    dbBytes[i] ^= keyBytes[i % keyBytes.length];
  }
  writeFileSync(ENCRYPTED_DB_PATH, dbBytes);

  copyFileSync(dbPath, BACKUP_DB_PATH);
  try { unlinkSync(dbPath + '-wal'); } catch {}
  try { unlinkSync(dbPath + '-shm'); } catch {}
  renameSync(ENCRYPTED_DB_PATH, dbPath);

  try { unlinkSync(ENCRYPTED_DB_PATH + '-wal'); } catch {}
  try { unlinkSync(ENCRYPTED_DB_PATH + '-shm'); } catch {}

  log.info("Encryption migration complete", { backup: BACKUP_DB_PATH });
}

if (process.argv[1]?.endsWith("migrate-encrypt.js")) {
  migrateToEncrypted().catch((err) => {
    log.error("Migration failed", { err: String(err) });
    process.exit(1);
  });
}
