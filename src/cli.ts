#!/usr/bin/env node

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  const version = getVersion();
  console.log(` // legacy
hoot v${version} — AI orchestrator powered by Copilot SDK

Usage:
  hoot <command>

Commands:
  start       Start the Hoot 🦉 daemon (Telegram bot + HTTP API)
  tui         Connect to the daemon via terminal UI
  setup       Interactive first-run configuration
  update      Check for updates and install the latest version
  help        Show this help message

Flags (start):
  --self-edit Allow Hoot 🦉 to modify its own source code (off by default)

Examples:
  hoot start           Start the daemon
  hoot start --self-edit  Start with self-edit enabled
  hoot tui             Open the terminal client
  hoot setup           Configure Telegram token and settings
`.trim());
}

const args = process.argv.slice(2);
const command = args[0] || "help";

switch (command) {
  case "start": {
    const startFlags = args.slice(1);
    if (startFlags.includes("--self-edit")) {
      process.env.MAX_SELF_EDIT = "1";
    }
    await import("./daemon.js");
    break;
  }
  case "tui":
    await import("./tui/index.js");
    break;
  case "setup":
    await import("./setup.js");
    break;
  case "update": {
    const { checkForUpdate, performUpdate } = await import("./update.js");
    const check = await checkForUpdate();
    if (!check.checkSucceeded) {
      console.error("⚠ Could not reach the npm registry. Check your network and try again.");
      process.exit(1);
    }
    if (!check.updateAvailable) {
      console.log(`hoot v${check.current} is already the latest version.`); // legacy
      break;
    }
    console.log(`Update available: v${check.current} → v${check.latest}`); // legacy
    console.log("Installing..."); // legacy
    const result = await performUpdate();
    if (result.ok) {
      console.log(`✅ Updated to v${check.latest}`); // legacy
    } else {
      console.error(`❌ Update failed: ${result.output}`);
      process.exit(1);
    }
    break;
  }
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  case "--version":
  case "-v":
    console.log(getVersion()); // legacy
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exit(1);
}
