import * as readline from "readline";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { CopilotProvider } from "./providers/copilot.js";
import { ensureHootHome, ENV_PATH, HOOT_HOME } from "./paths.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const FALLBACK_MODELS = [
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", desc: "Fast, great for most tasks" },
  { id: "gpt-5.1", label: "GPT-5.1", desc: "OpenAI's fast model" },
  { id: "gpt-4.1", label: "GPT-4.1", desc: "Free included model" },
];

async function fetchModels(): Promise<{ id: string; label: string; desc: string }[]> {
  const provider = new CopilotProvider();
  try {
    await provider.start();
    const models = await provider.listModels();
    return models
      .map((m) => {
        const mult = m.billingMultiplier;
        const desc =
          mult === 0 || mult === undefined ? "Included with Copilot" : `Premium (${mult}x)`;
        return { id: m.id, label: m.name || m.id, desc };
      });
  } catch {
    return [];
  } finally {
    try { await provider.stop(); } catch { /* best-effort */ }
  }
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function askRequired(rl: readline.Interface, prompt: string): Promise<string> {
  while (true) {
    const answer = (await ask(rl, prompt)).trim();
    if (answer) return answer;
    console.log(`${YELLOW}  This field is required. Please enter a value.${RESET}`); // legacy
  }
}

async function askYesNo(rl: readline.Interface, question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? "(Y/n)" : "(y/N)";
  const answer = (await ask(rl, `${question} ${hint} `)).trim().toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}

async function askPicker(rl: readline.Interface, label: string, options: { id: string; label: string; desc: string }[], defaultId: string): Promise<string> {
  console.log(`${BOLD}${label}${RESET}\n`); // legacy
  const defaultIdx = Math.max(0, options.findIndex((o) => o.id === defaultId));
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIdx ? `${GREEN}▸${RESET}` : " ";
    const tag = i === defaultIdx ? ` ${DIM}(default)${RESET}` : "";
    console.log(`  ${marker} ${CYAN}${i + 1}${RESET}  ${options[i].label}${tag}`); // legacy
    console.log(`       ${DIM}${options[i].desc}${RESET}`); // legacy
  }
  console.log(); // legacy
  const input = await ask(rl, `  Pick a number ${DIM}(1-${options.length}, Enter for default)${RESET}: `);
  const num = parseInt(input.trim(), 10);
  if (num >= 1 && num <= options.length) return options[num - 1].id;
  return options[defaultIdx].id;
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(` // legacy
${BOLD}╔══════════════════════════════════════════╗
║        🦉  Hoot Setup                    ║
╚══════════════════════════════════════════╝${RESET}
`);

  console.log(`${DIM}Config directory: ${HOOT_HOME}${RESET}\n`); // legacy

  ensureHootHome();

  const existing: Record<string, string> = {};
  if (existsSync(ENV_PATH)) {
    for (const line of readFileSync(ENV_PATH, "utf-8").split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) existing[match[1]] = match[2];
    }
  }

  console.log(`${BOLD}Meet Hoot 🦉${RESET}`); // legacy
  console.log(`Hoot 🦉 is your personal AI assistant — an always-on daemon that runs on`); // legacy
  console.log(`your machine. Talk to it in plain English and it'll handle the rest.`); // legacy
  console.log(); // legacy
  console.log(`${CYAN}What Hoot 🦉 can do out of the box:${RESET}`); // legacy
  console.log(`  • Have conversations and answer questions`); // legacy
  console.log(`  • Spin up Copilot CLI sessions to code, debug, and run commands`); // legacy
  console.log(`  • Manage multiple background tasks simultaneously`); // legacy
  console.log(`  • See and attach to any Copilot session on your machine`); // legacy
  console.log(); // legacy
  console.log(`${CYAN}Skills — teach Hoot 🦉 anything:${RESET}`); // legacy
  console.log(`  Hoot 🦉 has a skill system that lets it learn new capabilities. There's`); // legacy
  console.log(`  an open source library of community skills it can install, or it can`); // legacy
  console.log(`  write its own from scratch. Just ask it:`); // legacy
  console.log(); // legacy
  console.log(`  ${DIM}"Check my email"${RESET}        → Hoot 🦉 researches how, writes a skill, does it`); // legacy
  console.log(`  ${DIM}"Turn off the lights"${RESET}   → Hoot 🦉 finds the right CLI tool, learns it`); // legacy
  console.log(`  ${DIM}"Find me a skill for"${RESET}   → Hoot 🦉 searches community skills and installs one`); // legacy
  console.log(`  ${DIM}"Learn how to use X"${RESET}    → Hoot 🦉 proactively learns before you need it`); // legacy
  console.log(); // legacy
  console.log(`  Skills are saved permanently — Hoot 🦉 only needs to learn once.`); // legacy
  console.log(); // legacy
  console.log(`${CYAN}How to talk to Hoot 🦉:${RESET}`); // legacy
  console.log(`  • ${BOLD}Terminal${RESET}  — ${CYAN}hoot tui${RESET} — always available, no setup needed`); // legacy
  console.log(`  • ${BOLD}Telegram${RESET} — control Hoot 🦉 from your phone (optional, set up next)`); // legacy
  console.log(); // legacy

  await ask(rl, `${DIM}Press Enter to continue...${RESET}`);
  console.log(); // legacy

  console.log(`${BOLD}━━━ Telegram Setup (optional) ━━━${RESET}\n`); // legacy
  console.log(`Telegram lets you talk to Hoot 🦉 from your phone — send messages,`); // legacy
  console.log(`dispatch coding tasks, and get notified when background work finishes.`); // legacy
  console.log(); // legacy

  let telegramToken = existing.TELEGRAM_BOT_TOKEN || "";
  let userId = existing.AUTHORIZED_USER_ID || "";

  const setupTelegram = await askYesNo(rl, "Would you like to set up Telegram?");

  if (setupTelegram) {
    console.log(`\n${BOLD}Step 1: Create a Telegram bot${RESET}\n`); // legacy
    console.log(`  1. Open Telegram and search for ${BOLD}@BotFather${RESET}`); // legacy
    console.log(`  2. Send ${CYAN}/newbot${RESET} and follow the prompts`); // legacy
    console.log(`  3. Copy the bot token (looks like ${DIM}123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11${RESET})`); // legacy
    console.log(); // legacy

    const tokenInput = await askRequired(
      rl,
      `  Bot token${telegramToken ? ` ${DIM}(current: ${telegramToken.slice(0, 12)}...)${RESET}` : ""}: `
    );
    telegramToken = tokenInput;

    console.log(`\n${BOLD}Step 2: Lock down your bot${RESET}\n`); // legacy
    console.log(`${YELLOW}  ⚠  IMPORTANT: Your bot is currently open to anyone on Telegram.${RESET}`); // legacy
    console.log(`  Hoot 🦉 uses your Telegram user ID to ensure only YOU can control it.`); // legacy
    console.log(`  Without this, anyone who finds your bot could send it commands.`); // legacy
    console.log(); // legacy
    console.log(`  To get your user ID:`); // legacy
    console.log(`  1. Search for ${BOLD}@userinfobot${RESET} on Telegram`); // legacy
    console.log(`  2. Send it any message`); // legacy
    console.log(`  3. It will reply with your user ID (a number like ${DIM}123456789${RESET})`); // legacy
    console.log(); // legacy

    while (true) {
      const userIdInput = await askRequired(
        rl,
        `  Your user ID${userId ? ` ${DIM}(current: ${userId})${RESET}` : ""}: `
      );
      const parsed = parseInt(userIdInput, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        userId = userIdInput;
        break;
      }
      console.log(`${YELLOW}  That doesn't look like a valid user ID. It should be a positive number.${RESET}`); // legacy
    }

    console.log(`\n${GREEN}  ✓ Telegram locked down — only user ${userId} can control Hoot 🦉.${RESET}`); // legacy

    console.log(`\n${BOLD}Step 3: Disable group joins (recommended)${RESET}\n`); // legacy
    console.log(`  For extra security, prevent your bot from being added to groups:`); // legacy
    console.log(`  1. Go back to ${BOLD}@BotFather${RESET}`); // legacy
    console.log(`  2. Send ${CYAN}/mybots${RESET} → select your bot → ${CYAN}Bot Settings${RESET} → ${CYAN}Allow Groups?${RESET}`); // legacy
    console.log(`  3. Set to ${BOLD}Disable${RESET}`); // legacy
    console.log(); // legacy

    await ask(rl, `  ${DIM}Press Enter when done (or skip)...${RESET}`);

  } else {
    console.log(`\n${DIM}  Skipping Telegram. You can always set it up later with: hoot setup${RESET}\n`); // legacy
  }

  console.log(`${BOLD}━━━ Google / Gmail Setup (optional) ━━━${RESET}\n`); // legacy
  console.log(`Hoot 🦉 includes a Google skill that lets it read your email, manage`); // legacy
  console.log(`your calendar, access Drive, and more — using the ${BOLD}gog${RESET} CLI.`); // legacy
  console.log(); // legacy

  const setupGoogle = await askYesNo(rl, "Would you like to set up Google services?");

  if (setupGoogle) {
    console.log(`\n${BOLD}Step 1: Install the gog CLI${RESET}\n`); // legacy
    console.log(`  ${CYAN}brew install steipete/tap/gogcli${RESET}     ${DIM}(macOS/Linux with Homebrew)${RESET}`); // legacy
    console.log(); // legacy

    await ask(rl, `  ${DIM}Press Enter when installed (or to skip)...${RESET}`);

    console.log(`\n${BOLD}Step 2: Create OAuth credentials${RESET}\n`); // legacy
    console.log(`  You need a Google Cloud OAuth client to authenticate:`); // legacy
    console.log(`  1. Go to ${CYAN}https://console.cloud.google.com/apis/credentials${RESET}`); // legacy
    console.log(`  2. Create a project (if you don't have one)`); // legacy
    console.log(`  3. Enable the APIs you want (Gmail, Calendar, Drive, etc.)`); // legacy
    console.log(`  4. Configure the OAuth consent screen`); // legacy
    console.log(`  5. Create an OAuth client (type: ${BOLD}Desktop app${RESET})`); // legacy
    console.log(`  6. Download the JSON credentials file`); // legacy
    console.log(); // legacy
    console.log(`  Then store the credentials:`); // legacy
    console.log(`  ${CYAN}gog auth credentials ~/Downloads/client_secret_....json${RESET}`); // legacy
    console.log(); // legacy

    await ask(rl, `  ${DIM}Press Enter when done (or to skip)...${RESET}`);

    console.log(`\n${BOLD}Step 3: Authenticate with your Google account${RESET}\n`); // legacy
    console.log(`  Run this command to authorize:`); // legacy
    console.log(`  ${CYAN}gog auth add your-email@gmail.com${RESET}`); // legacy
    console.log(); // legacy
    console.log(`  This opens a browser for OAuth authorization. Once done, Hoot 🦉 can`); // legacy
    console.log(`  access your Google services on your behalf.`); // legacy
    console.log(); // legacy

    const googleEmail = await ask(
      rl,
      `  Google email ${DIM}(Enter to skip)${RESET}: `
    );

    if (googleEmail.trim()) {
      console.log(`\n  ${DIM}Run this now or later:${RESET}  ${CYAN}gog auth add ${googleEmail.trim()}${RESET}`); // legacy
      console.log(`  ${DIM}Check status anytime:${RESET}   ${CYAN}gog auth status${RESET}`); // legacy
    }

    console.log(`\n${GREEN}  ✓ Google skill is ready — authenticate with gog auth add when you're set.${RESET}\n`); // legacy
  } else {
    console.log(`\n${DIM}  Skipping Google. You can always set it up later with: hoot setup${RESET}\n`); // legacy
  }

  console.log(`\n${BOLD}━━━ Default Model ━━━${RESET}\n`); // legacy
  console.log(`${DIM}Fetching available models from Copilot...${RESET}`); // legacy

  let models = await fetchModels();
  if (models.length === 0) {
    console.log(`${YELLOW}  Could not fetch models (Copilot CLI may not be authenticated yet).${RESET}`); // legacy
    console.log(`${DIM}  Showing a curated list — you can switch anytime after setup.${RESET}\n`); // legacy
    models = FALLBACK_MODELS;
  } else {
    console.log(`${GREEN}  ✓ Found ${models.length} models${RESET}\n`); // legacy
  }

  console.log(`${DIM}You can switch models anytime by telling Hoot 🦉 "switch to gpt-4.1"${RESET}\n`); // legacy

  const currentModel = existing.COPILOT_MODEL || "claude-sonnet-4.6";
  const model = await askPicker(rl, "Choose a default model:", models, currentModel);
  const modelLabel = models.find((m) => m.id === model)?.label || model;
  console.log(`\n${GREEN}  ✓ Using ${modelLabel}${RESET}\n`); // legacy

  const apiPort = existing.API_PORT || "7777";
  const lines: string[] = [];
  if (telegramToken) lines.push(`TELEGRAM_BOT_TOKEN=${telegramToken}`);
  if (userId) lines.push(`AUTHORIZED_USER_ID=${userId}`);
  lines.push(`API_PORT=${apiPort}`);
  lines.push(`COPILOT_MODEL=${model}`);

  writeFileSync(ENV_PATH, lines.join("\n") + "\n");

  console.log(` // legacy
${GREEN}${BOLD}✅ Hoot 🦉 is ready!${RESET}
${DIM}Config saved to ${ENV_PATH}${RESET}

${BOLD}Get started:${RESET}

  ${CYAN}1.${RESET} Make sure Copilot CLI is authenticated:
     ${BOLD}copilot login${RESET}

  ${CYAN}2.${RESET} Start Hoot 🦉:
     ${BOLD}hoot start${RESET}

  ${CYAN}3.${RESET} ${setupTelegram ? "Open Telegram and message your bot!" : "Connect via terminal:"}
     ${BOLD}${setupTelegram ? "(message your bot on Telegram)" : "hoot tui"}${RESET}

${BOLD}Things to try:${RESET}

  ${DIM}"Start working on the auth bug in ~/dev/myapp"${RESET}
  ${DIM}"What sessions are running?"${RESET}
  ${DIM}"Find me a skill for checking Gmail"${RESET}
  ${DIM}"Learn how to control my smart lights"${RESET}
  ${DIM}"Switch to gpt-4.1"${RESET}
`);

  rl.close();
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
