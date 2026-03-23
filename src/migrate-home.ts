import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const OLD_HOME = join(homedir(), ".max");
const NEW_HOME = join(homedir(), ".hoot");
const MARKER_FILE = ".migrated";

export function migrateHomeIfNeeded(): void {
  // If already migrated or old dir doesn't exist, skip
  if (existsSync(NEW_HOME) || !existsSync(OLD_HOME)) return;

  // Recursively copy, renaming max.db → hoot.db
  copyDirRecursive(OLD_HOME, NEW_HOME);

  // Leave marker in old directory
  writeFileSync(
    join(OLD_HOME, MARKER_FILE),
    `Migrated to ~/.hoot/ on ${new Date().toISOString()}.\nThis directory is no longer used by Hoot.\n`
  );

  console.log("🦉 Migrated config from ~/.max/ → ~/.hoot/"); // legacy
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destName = entry === "max.db" ? "hoot.db" : entry;
    const destPath = join(dest, destName);

    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
