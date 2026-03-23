import * as readline from "readline";
import * as http from "http";
import { exec, execFile } from "child_process";
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "fs";
import { HISTORY_PATH, API_TOKEN_PATH, TUI_DEBUG_LOG_PATH, ensureHootHome } from "../paths.js";

const API_BASE = (process.env.HOOT_API_URL ?? process.env.MAX_API_URL) || "http://127.0.0.1:7777";

let apiToken: string | null = null;
try {
  if (existsSync(API_TOKEN_PATH)) {
    apiToken = readFileSync(API_TOKEN_PATH, "utf-8").trim();
  }
} catch {
  console.error("Warning: Could not read API token from " + API_TOKEN_PATH + " — requests may fail.");
}

function authHeaders(): Record<string, string> {
  return apiToken ? { Authorization: `Bearer ${apiToken}` } : {};
}

const C = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  boldCyan: (s: string) => `\x1b[1;36m${s}\x1b[0m`,
  bgDim: (s: string) => `\x1b[48;5;236m${s}\x1b[0m`,
  coral: (s: string) => `\x1b[38;2;255;127;80m${s}\x1b[0m`,
  boldWhite: (s: string) => `\x1b[1;97m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[38;2;14;165;233m${s}\x1b[0m`,
};

const LABEL_PAD = "          "; // 10-char indent for continuation lines
const MAX_LABEL = `  ${C.cyan("HOOT 🦉")} `;
const TUI_DEBUG_ENABLED = /^(1|true|yes|on)$/i.test(((process.env.HOOT_TUI_DEBUG ?? process.env.MAX_TUI_DEBUG) || "").trim());
let debugWriteFailureReported = false;

function previewForDebug(text: string, max = 120): string {
  return text
    .slice(0, max)
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function debugLog(event: string, data: Record<string, unknown> = {}): void { if (!TUI_DEBUG_ENABLED) return; const entry = { ts: new Date().toISOString(), event, ...data, }; try { appendFileSync(TUI_DEBUG_LOG_PATH, JSON.stringify(entry) + "\n");
  } catch (err) {
    if (debugWriteFailureReported) return;
    debugWriteFailureReported = true;
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n[hoot] failed to write TUI debug log: ${msg}\n`);
  }
}

function renderLine(line: string, inCodeBlock: boolean): string {
  if (inCodeBlock) {
    return `  ${C.dim("│")} ${line}`;
  }
  if (/^[-*_]{3,}\s*$/.test(line)) return C.dim("──────────────────────────────────");
  if (line.startsWith("### ")) return C.coral(line.slice(4));
  if (line.startsWith("## ")) return C.boldWhite(line.slice(3));
  if (line.startsWith("# ")) return C.boldWhite(line.slice(2));
  if (line.startsWith("> ")) return `${C.dim("│")} ${C.dim(line.slice(2))}`;
  if (/^ {2,}[-*] /.test(line)) return `    ◦ ${line.replace(/^ +[-*] /, "")}`;
  if (/^[-*] /.test(line)) return `  • ${line.slice(2)}`;
  if (/^\d+\. /.test(line)) return `  ${line}`;
  return line;
}

function applyInlineFormatting(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, `\x1b[1;3m$1\x1b[0m`)
    .replace(/\*\*(.+?)\*\*/g, `\x1b[1m$1\x1b[0m`)
    .replace(/~~(.+?)~~/g, `\x1b[9m$1\x1b[0m`)
    .replace(/`([^`]+)`/g, C.yellow("$1"))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `${t} ${C.dim(`(${u})`)}`);
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0 || stripAnsi(text).length <= maxWidth) return [text];

  const RESET = "\x1b[0m";
  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (stripAnsi(remaining).length <= maxWidth) {
      lines.push(remaining);
      break;
    }

    let visCount = 0;
    let i = 0;
    let lastSpaceI = -1;
    const ansiStack: string[] = [];
    let ansiAtSpace: string[] = [];

    while (i < remaining.length && visCount < maxWidth) {
      const match = remaining.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (match) {
        if (match[0] === RESET) ansiStack.length = 0;
        else ansiStack.push(match[0]);
        i += match[0].length;
      } else {
        if (remaining[i] === " ") {
          lastSpaceI = i;
          ansiAtSpace = [...ansiStack];
        }
        visCount++;
        i++;
      }
    }

    let breakI: number;
    let openAnsi: string[];
    if (lastSpaceI > 0) {
      breakI = lastSpaceI;
      openAnsi = ansiAtSpace;
    } else {
      breakI = i;
      openAnsi = [...ansiStack];
    }

    let line = remaining.slice(0, breakI);
    remaining = remaining.slice(breakI + (remaining[breakI] === " " ? 1 : 0));

    if (openAnsi.length > 0) {
      line += RESET;
      if (remaining.length > 0) remaining = openAnsi.join("") + remaining;
    }

    lines.push(line);
  }

  return lines;
}

function renderMarkdown(text: string): string {
  let inCodeBlock = false;
  const rendered = text.split("\n").map((line: string) => {
    if (/^```/.test(line)) {
      if (inCodeBlock) { inCodeBlock = false; return ""; }
      inCodeBlock = true;
      const lang = line.slice(3).trim();
      return lang ? C.dim(lang) : "";
    }
    return renderLine(line, inCodeBlock);
  });
  return applyInlineFormatting(rendered.join("\n"));
}

function writeLabeled(role: "hoot" | "sys", text: string): void {
  const label = role === "hoot"
    ? MAX_LABEL
    : `  ${C.dim("SYS")}     `;
  const availWidth = (process.stdout.columns || 80) - 10;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const prefix = i === 0 ? label : LABEL_PAD;
    const isCodeLine = stripAnsi(lines[i]).startsWith("  \u2502 ");
    if (isCodeLine) {
      process.stdout.write(prefix + lines[i] + "\n");
    } else {
      const wrapped = wrapText(lines[i], availWidth);
      process.stdout.write(prefix + wrapped.join("\n" + LABEL_PAD) + "\n");
    }
  }
}

let streamLineBuffer = "";
let inStreamCodeBlock = false;
let streamIsFirstLine = true;

function streamPrefix(): string {
  return streamIsFirstLine ? MAX_LABEL : LABEL_PAD;
}

function stripLeadingStreamNewlines(text: string): string {
  if (!streamIsFirstLine || streamLineBuffer.length > 0) return text;
  const stripped = text.replace(/^(?:\r?\n)+/, "");
  if (stripped.length !== text.length) {
 debugLog("stream-strip-leading-newlines", { requestId: activeRequestId, removedChars: text.length - stripped.length, originalPreview: previewForDebug(text), });
  }
  return stripped;
}

function clearVisualLine(charCount: number): void {
  const cols = process.stdout.columns || 80;
  const up = Math.ceil(Math.max(charCount, 1) / cols) - 1;
  debugLog("clear-visual-line", { requestId: activeRequestId, charCount, cols, up });
  if (up > 0) process.stdout.write(`\x1b[${up}A`);
  process.stdout.write(`\r\x1b[J`);
}

function writeRenderedStreamLine(line: string): void {
  const prefix = streamPrefix();
  if (/^```/.test(line)) {
    if (inStreamCodeBlock) {
      inStreamCodeBlock = false;
    } else {
      inStreamCodeBlock = true;
      const lang = line.slice(3).trim();
      process.stdout.write(prefix + (lang ? C.dim(lang) : ""));
    }
  } else {
    const rendered = applyInlineFormatting(renderLine(line, inStreamCodeBlock));
    if (inStreamCodeBlock) {
      process.stdout.write(prefix + rendered);
    } else {
      const availWidth = (process.stdout.columns || 80) - 10;
      const wrapped = wrapText(rendered, availWidth);
      process.stdout.write(prefix + wrapped.join("\n" + LABEL_PAD));
    }
  }
  process.stdout.write("\n");
  streamIsFirstLine = false;
}

function writeStreamChunk(newText: string): void {
 debugLog("stream-chunk", { requestId: activeRequestId, length: newText.length, preview: previewForDebug(newText), startsWithNewline: /^(?:\r?\n)/.test(newText), });
  let pos = 0;
  while (pos < newText.length) {
    const nl = newText.indexOf("\n", pos);

    if (nl === -1) {
      const partial = newText.slice(pos);
      if (streamLineBuffer.length === 0) {
        process.stdout.write(streamPrefix());
      }
      streamLineBuffer += partial;
      process.stdout.write(partial);
      return;
    }

    const segment = newText.slice(pos, nl);
    const hadPartial = streamLineBuffer.length > 0;
    streamLineBuffer += segment;

    if (hadPartial) {
      clearVisualLine(10 + streamLineBuffer.length);
    }

    if (streamLineBuffer.length === 0 && !hadPartial) {
      process.stdout.write(streamPrefix() + "\n");
      streamIsFirstLine = false;
    } else {
      writeRenderedStreamLine(streamLineBuffer);
    }

    streamLineBuffer = "";
    pos = nl + 1;
  }
}

function flushStreamState(): void {
  if (streamLineBuffer.length > 0) {
    clearVisualLine(10 + streamLineBuffer.length);
    writeRenderedStreamLine(streamLineBuffer);
  }
  streamLineBuffer = "";
  inStreamCodeBlock = false;
  streamIsFirstLine = true;
}

let thinkingTimer: ReturnType<typeof setInterval> | undefined;
let thinkingFrame = 0;
let thinkingVisible = false;
const thinkingFrames = ["Thinking", "Thinking.", "Thinking..", "Thinking..."];

function startThinking(): void {
  stopThinking("restart-thinking");
  thinkingFrame = 0;
  thinkingVisible = true;
  process.stdout.write(`\n${MAX_LABEL}${C.dim(thinkingFrames[0])}`);
 debugLog("thinking-start", { requestId: activeRequestId, frame: thinkingFrames[0], msSinceSubmit: activeRequestStartedAt > 0 ? Date.now() - activeRequestStartedAt : null, });
  thinkingTimer = setInterval(() => {
    thinkingFrame = (thinkingFrame + 1) % thinkingFrames.length;
    process.stdout.write(`\r\x1b[K${MAX_LABEL}${C.dim(thinkingFrames[thinkingFrame])}`);
 debugLog("thinking-tick", { requestId: activeRequestId, frameIndex: thinkingFrame, frame: thinkingFrames[thinkingFrame], });
  }, 400);
}

function stopThinking(reason = "unspecified"): void {
  const hadTimer = Boolean(thinkingTimer);
  const wasVisible = thinkingVisible;
  if (thinkingTimer) {
    clearInterval(thinkingTimer);
    thinkingTimer = undefined;
  }
  if (thinkingVisible) {
    process.stdout.write(`\r\x1b[K`);
    thinkingVisible = false;
  }
 debugLog("thinking-stop", { requestId: activeRequestId, reason, hadTimer, wasVisible, });
}

let connectionId: string | undefined;
let isStreaming = false;
let streamedContent = "";
let lastResponse = "";
let activeRequestId = 0;
let activeRequestStartedAt = 0;

const MAX_HISTORY = 1000;

function loadHistory(): string[] {
  try {
    if (existsSync(HISTORY_PATH)) {
      return readFileSync(HISTORY_PATH, "utf-8")
        .split("\n")
        .filter(Boolean)
        .slice(-MAX_HISTORY);
    }
  } catch { /* ignore */ }
  return [];
}

function saveHistoryLine(line: string): void {
  try {
    appendFileSync(HISTORY_PATH, line + "\n");
  } catch { /* ignore */ }
}

function trimHistoryFile(): void {
  try {
    if (!existsSync(HISTORY_PATH)) return;
    const lines = readFileSync(HISTORY_PATH, "utf-8").split("\n").filter(Boolean);
    if (lines.length > MAX_HISTORY) {
      writeFileSync(HISTORY_PATH, lines.slice(-MAX_HISTORY).join("\n") + "\n");
    }
  } catch { /* ignore */ }
}

ensureHootHome();
debugLog("session-start", { pid: process.pid, cwd: process.cwd(), stdinIsTTY: Boolean(process.stdin.isTTY), stdoutIsTTY: Boolean(process.stdout.isTTY), columns: process.stdout.columns || null, logPath: TUI_DEBUG_LOG_PATH, });
const history = loadHistory();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `  ${C.coral("›")} `,
  history,
  historySize: MAX_HISTORY,
});

function showBanner(): void {
  console.clear();
  console.log(); // legacy
  console.log(); // legacy
  console.log(C.boldWhite("    ██      ██     █████     ██   ██")); // legacy
  console.log(C.boldWhite("    ███    ███    ██   ██     ██ ██")); // legacy
  console.log(C.boldWhite("    ██ ████ ██    ███████      ███")); // legacy
  console.log(C.boldWhite("    ██  ██  ██    ██   ██     ██ ██")); // legacy
  console.log(C.boldWhite("    ██      ██    ██   ██    ██   ██") + "  " + C.coral("●")); // legacy
  console.log(); // legacy
  console.log(C.dim("    personal AI assistant for developers")); // legacy
  console.log(); // legacy
}

function showStatus(model?: string, skillCount?: number, routerInfo?: { enabled: boolean }): void {
  const parts: string[] = [];
  if (model) parts.push(`${C.dim("model:")} ${C.cyan(model)}`);
  if (routerInfo?.enabled) {
    parts.push(C.cyan("⚡ auto"));
  }
  if (skillCount !== undefined) parts.push(`${C.dim("skills:")} ${C.cyan(String(skillCount))}`);
  if (parts.length) console.log(`    ${parts.join("    ")}`); // legacy
  console.log(); // legacy
  console.log(C.dim("    /help for commands · esc to cancel")); // legacy
  console.log(); // legacy
}

function fetchStartupInfo(): void {
  let model = "unknown";
  let skillCount = 0;
  let routerInfo: { enabled: boolean } | undefined;
  let done = 0;
  const check = () => {
    done++;
    if (done === 3) showStatus(model, skillCount, routerInfo);
  };

  apiGetSilent("/model", (data: any) => { model = data?.model || "unknown"; check(); });
  apiGetSilent("/skills", (data: any) => { skillCount = Array.isArray(data) ? data.length : 0; check(); });
  apiGetSilent("/auto", (data: any) => { if (data) routerInfo = { enabled: Boolean(data.enabled) }; check(); });
}

function connectSSE(): void {
  const url = new URL("/stream", API_BASE);

  http.get(url, { headers: authHeaders() }, (res) => {
    console.log(C.green("  ● ") + C.dim("hoot — connected")); // legacy
    fetchStartupInfo();
    let buffer = "";

    res.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "connected") {
              connectionId = event.connectionId;
              debugLog("sse-connected", { connectionId });
            } else if (event.type === "delta") {
              const full = event.content || "";
              const baseLength = isStreaming ? streamedContent.length : 0;
              if (!isStreaming) {
                stopThinking("first-delta");
                isStreaming = true;
                streamedContent = "";
                streamLineBuffer = "";
                inStreamCodeBlock = false;
                streamIsFirstLine = true;
 debugLog("stream-first-delta", { requestId: activeRequestId, msSinceSubmit: activeRequestStartedAt > 0 ? Date.now() - activeRequestStartedAt : null, fullLength: full.length, newLength: full.length, startsWithNewline: /^(?:\r?\n)/.test(full), });
              }
              const newText = full.slice(baseLength);
              if (newText) {
                const normalized = stripLeadingStreamNewlines(newText);
 debugLog("stream-delta", { requestId: activeRequestId, fullLength: full.length, rawLength: newText.length, normalizedLength: normalized.length, preview: previewForDebug(normalized), });
                if (normalized) writeStreamChunk(normalized);
                streamedContent = full;
              }
            } else if (event.type === "cancelled") {
              stopThinking("cancelled-event");
              isStreaming = false;
              streamedContent = "";
              streamLineBuffer = "";
              inStreamCodeBlock = false;
              streamIsFirstLine = true;
            } else if (event.type === "message") {
 debugLog("stream-message", { requestId: activeRequestId, isStreaming, contentLength: typeof event.content === "string" ? event.content.length : 0, });
              if (isStreaming) {
                flushStreamState();
                isStreaming = false;
                lastResponse = streamedContent;
                streamedContent = "";
                if (event.route && event.route.routerMode === "auto") {
                  const r = event.route;
                  const label = r.overrideName
                    ? `⚡ auto · ${r.model} (${r.overrideName})`
                    : `⚡ auto · ${r.model}`;
                  process.stdout.write(`\n${LABEL_PAD}${C.dim(label)}`);
                }
                process.stdout.write("\n\n\n");
              } else {
                stopThinking("message-event");
                lastResponse = event.content;
                const rendered = renderMarkdown(event.content);
                process.stdout.write("\n");
                writeLabeled("hoot", rendered);
                process.stdout.write("\n\n");
              }
              activeRequestStartedAt = 0;
              rl.prompt();
            }
          } catch (err) {
 debugLog("sse-event-parse-error", { linePreview: previewForDebug(line), error: err instanceof Error ? err.message : String(err), });
          }
        }
      }
    });

    res.on("end", () => {
      stopThinking("sse-end");
      debugLog("sse-end");
      console.log(C.yellow("\n    ⚠ disconnected — reconnecting...")); // legacy
      isStreaming = false;
      streamedContent = "";
      setTimeout(connectSSE, 2000);
    });

    res.on("error", (err) => {
      stopThinking("sse-error");
      debugLog("sse-error", { error: err.message });
      console.error(C.red(`\n    ✗ connection error — retrying...`));
      isStreaming = false;
      streamedContent = "";
      setTimeout(connectSSE, 3000);
    });
  }).on("error", (err) => {
    debugLog("sse-connect-error", { error: err.message });
    console.error(C.red(`    ✗ cannot connect to daemon`));
    console.error(C.dim("      start with: hoot start"));
    setTimeout(connectSSE, 5000);
  });
}

function sendMessage(prompt: string, requestId: number): void {
  const body = JSON.stringify({ prompt, connectionId });
  const url = new URL("/message", API_BASE);
 debugLog("message-send-start", { requestId, promptLength: prompt.length, connectionId: connectionId || null, });

  const req = http.request(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...authHeaders(),
      },
    },
    (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
 debugLog("message-send-end", { requestId, statusCode: res.statusCode || null, responseLength: data.length, responsePreview: previewForDebug(data), });
        if (res.statusCode !== 200) {
          stopThinking("message-post-error");
          console.error(C.red(`  Error: ${data}`));
          rl.prompt();
        }
      });
    }
  );

  req.on("error", (err) => {
    stopThinking("message-request-error");
    debugLog("message-send-error", { requestId, error: err.message });
    console.error(C.red(`  Failed to send: ${err.message}`));
    rl.prompt();
  });

  req.write(body);
  req.end();
  debugLog("message-send-dispatched", { requestId, byteLength: Buffer.byteLength(body) });
}

function apiGetSilent(path: string, cb: (data: any) => void): void {
  const url = new URL(path, API_BASE);
  http.get(url, { headers: authHeaders() }, (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      try { cb(JSON.parse(data)); } catch { /* ignore */ }
    });
  }).on("error", () => { cb(null); });
}

function apiGet(path: string, cb: (data: any) => void): void {
  const url = new URL(path, API_BASE);
  http.get(url, { headers: authHeaders() }, (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      try { cb(JSON.parse(data)); } catch { console.log(data); } // legacy
      rl.prompt();
    });
  }).on("error", (err) => {
    console.error(C.red(`  Error: ${err.message}`));
    rl.prompt();
  });
}

function apiPost(path: string, body: Record<string, unknown>, cb: (data: any) => void): void {
  const json = JSON.stringify(body);
  const url = new URL(path, API_BASE);
  const req = http.request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json), ...authHeaders() },
  }, (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      try { cb(JSON.parse(data)); } catch { console.log(data); } // legacy
      rl.prompt();
    });
  });
  req.on("error", (err) => {
    console.error(C.red(`  Error: ${err.message}`));
    rl.prompt();
  });
  req.write(json);
  req.end();
}

function apiDelete(path: string, cb: (data: any) => void): void {
  const url = new URL(path, API_BASE);
  const req = http.request(url, {
    method: "DELETE",
    headers: authHeaders(),
  }, (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      try { cb(JSON.parse(data)); } catch { console.log(data); } // legacy
      rl.prompt();
    });
  });
  req.on("error", (err) => {
    console.error(C.red(`  Error: ${err.message}`));
    rl.prompt();
  });
  req.end();
}

function sendCancel(): void {
  stopThinking("user-cancel");
  debugLog("cancel-send", { requestId: activeRequestId, isStreaming });
  const url = new URL("/cancel", API_BASE);
  const req = http.request(url, { method: "POST", headers: authHeaders() }, (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      if (isStreaming) process.stdout.write("\n");
      isStreaming = false;
      streamedContent = "";
      console.log(C.dim("    ⛔ cancelled\n")); // legacy
      rl.prompt();
    });
  });
  req.on("error", (err) => {
    console.error(C.red(`  Failed to cancel: ${err.message}`));
    rl.prompt();
  });
  req.end();
}

function cmdWorkers(): void {
  apiGet("/sessions", (sessions: any[]) => {
    if (!sessions || sessions.length === 0) {
      console.log(C.dim("  No active worker sessions.\n")); // legacy
    } else {
      for (const s of sessions) {
        const badge = s.status === "idle" ? C.green("● idle") : C.yellow("● busy");
        console.log(`  ${badge}  ${C.bold(s.name)}  ${C.dim(s.workingDir)}`); // legacy
      }
      console.log(); // legacy
    }
  });
}

function cmdModel(arg: string): void {
  if (arg) {
    apiPost("/model", { model: arg }, (data: any) => {
      if (data.error) {
        console.log(C.red(`  Error: ${data.error}\n`)); // legacy
      } else {
        console.log(`  ${C.dim("model:")} ${C.dim(data.previous)} → ${C.cyan(data.current)}\n`); // legacy
      }
    });
  } else {
    apiGet("/model", (data: any) => {
      console.log(`  ${C.dim("model:")} ${C.cyan(data.model)}\n`); // legacy
    });
  }
}

function cmdMemory(): void {
  apiGet("/memory", (memories: any[]) => {
    if (!memories || memories.length === 0) {
      console.log(C.dim("  No memories stored.\n")); // legacy
    } else {
      for (const m of memories) {
        const cat = C.magenta(`[${m.category}]`);
        console.log(`  ${C.dim(`#${m.id}`)} ${cat} ${m.content}`); // legacy
      }
      console.log(C.dim(`\n  ${memories.length} memories total.\n`)); // legacy
    }
  });
}

function cmdSkills(): void {
  apiGet("/skills", (skills: any[]) => {
    if (!skills || skills.length === 0) {
      console.log(C.dim("  No skills installed.\n")); // legacy
      return;
    }

    const localSkills: { idx: number; slug: string }[] = [];
    console.log(); // legacy
    console.log(`  ${C.boldWhite("#")}   ${C.boldWhite("Skill")}${" ".repeat(24)}${C.boldWhite("Source")}      ${C.boldWhite("Description")}`); // legacy
    console.log(C.dim("  " + "─".repeat(72))); // legacy

    for (let i = 0; i < skills.length; i++) {
      const s = skills[i];
      const num = String(i + 1).padStart(2);
      const name = s.name.padEnd(28).slice(0, 28);
      const src = s.source === "bundled" ? C.dim("bundled")
        : s.source === "local" ? C.green("local")
        : C.cyan("global");
      const srcPad = s.source.padEnd(10);
      const desc = (s.description || "").slice(0, 40);

      if (s.source === "local") {
        localSkills.push({ idx: i + 1, slug: s.slug });
        console.log(`  ${C.cyan(num)}  ${name} ${src}${" ".repeat(Math.max(0, 10 - s.source.length))} ${C.dim(desc)}`); // legacy
      } else {
        console.log(`  ${C.dim(num)}  ${name} ${src}${" ".repeat(Math.max(0, 10 - s.source.length))} ${C.dim(desc)}`); // legacy
      }
    }

    console.log(); // legacy

    if (localSkills.length === 0) {
      console.log(C.dim("  No local skills to uninstall.\n")); // legacy
      return;
    }

    console.log(C.dim(`  Type a number to uninstall a local skill, or press Enter to go back.`)); // legacy
    rl.question(`  ${C.coral("uninstall #")} `, (answer) => {
      const trimmed = answer.trim();
      if (!trimmed) {
        console.log(); // legacy
        rl.prompt();
        return;
      }

      const num = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
      const match = localSkills.find((s) => s.idx === num);
      if (!match) {
        console.log(C.yellow(`  Invalid selection. Only local skills (highlighted) can be uninstalled.\n`)); // legacy
        rl.prompt();
        return;
      }

      apiDelete(`/skills/${encodeURIComponent(match.slug)}`, (data: any) => {
        if (data.error) {
          console.log(C.red(`  Error: ${data.error}\n`)); // legacy
        } else {
          console.log(C.green(`  ✓ Removed '${match.slug}'\n`)); // legacy
        }
      });
    });
  });
}

function cmdAuto(): void {
  apiGetSilent("/auto", (data: any) => {
    if (!data) { rl.prompt(); return; }
    const newState = !data.enabled;
    apiPost("/auto", { enabled: newState }, () => {
      const label = newState
        ? `${C.green("⚡")} auto on`
        : `auto off · using ${C.cyan(data.currentModel)}`;
      console.log(`  ${label}\n`); // legacy
    });
  });
}

function cmdHelp(): void {
  console.log(); // legacy
  console.log(C.boldWhite("    COMMANDS")); // legacy
  console.log(); // legacy
  console.log(`    ${C.coral("/model")} ${C.dim("[name]")}        show or switch model`); // legacy
  console.log(`    ${C.coral("/auto")}                 toggle auto model routing`); // legacy
  console.log(`    ${C.coral("/memory")}               show stored memories`); // legacy
  console.log(`    ${C.coral("/skills")}               list installed skills`); // legacy
  console.log(`    ${C.coral("/workers")}              list active sessions`); // legacy
  console.log(`    ${C.coral("/copy")}                 copy last response`); // legacy
  console.log(`    ${C.coral("/status")}               daemon health check`); // legacy
  console.log(`    ${C.coral("/restart")}              restart daemon`); // legacy
  console.log(`    ${C.coral("/clear")}                clear screen`); // legacy
  console.log(`    ${C.coral("/quit")}                 exit`); // legacy
  console.log(); // legacy
  console.log(C.dim("    press escape to cancel a running response")); // legacy
  console.log(C.dim("    set HOOT_TUI_DEBUG=1 to write lifecycle logs to ~/.hoot/tui-debug.log")); // legacy
  console.log(); // legacy
}

showBanner();
console.log(C.dim("    connecting...")); // legacy
connectSSE();

setTimeout(() => {
  rl.prompt();

  if (process.stdin.isTTY) {
    process.stdin.on("keypress", (_str: string, key: readline.Key) => {
      if (key && key.name === "escape") {
        sendCancel();
      }
    });
  }

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      debugLog("input-empty-line");
      rl.prompt();
      return;
    }
 debugLog("input-line", { length: trimmed.length, isCommand: trimmed.startsWith("/"), preview: previewForDebug(trimmed), });

    if (!trimmed.startsWith("/")) {
      saveHistoryLine(trimmed);

      const cols = process.stdout.columns || 80;
      const promptVisualLen = 4; // "  › " is 4 visible chars
      const inputVisualLen = promptVisualLen + trimmed.length;
      const wrappedLines = Math.ceil(Math.max(inputVisualLen, 1) / cols);
      if (wrappedLines > 1) {
        process.stdout.write(`\x1b[${wrappedLines}A\r\x1b[J`);
      } else {
        process.stdout.write(`\x1b[1A\r\x1b[J`);
      }

      const label = `  ${C.coral("YOU")}     `;
      const contentWidth = cols - 10; // 10 = label visual width
      if (contentWidth > 0 && trimmed.length > contentWidth) {
        const lines: string[] = [];
        for (let i = 0; i < trimmed.length; i += contentWidth) {
          lines.push(trimmed.slice(i, i + contentWidth));
        }
        for (let i = 0; i < lines.length; i++) {
          console.log((i === 0 ? label : LABEL_PAD) + lines[i]); // legacy
        }
      } else {
        console.log(label + trimmed); // legacy
      }
 debugLog("input-rendered-you-label", { columns: cols, wrappedLines, contentWidth, });
    }

    if (trimmed === "/quit" || trimmed === "/exit") {
      trimHistoryFile();
      console.log(C.dim("\n    bye.\n")); // legacy
      process.exit(0);
    }

    if (trimmed === "/cancel") { sendCancel(); return; }
    if (trimmed === "/sessions" || trimmed === "/workers") { cmdWorkers(); return; }
    if (trimmed.startsWith("/model")) { cmdModel(trimmed.slice(6).trim()); return; }
    if (trimmed === "/auto") { cmdAuto(); return; }
    if (trimmed === "/memory") { cmdMemory(); return; }
    if (trimmed === "/skills") { cmdSkills(); return; }
    if (trimmed === "/help") { cmdHelp(); return; }

    if (trimmed === "/status") {
      apiGet("/status", (data: any) => {
        console.log(JSON.stringify(data, null, 2) + "\n"); // legacy
      });
      return;
    }

    if (trimmed === "/restart") {
      apiPost("/restart", {}, () => {
        console.log(C.yellow("  ⏳ Hoot 🦉 is restarting...\n")); // legacy
      });
      return;
    }

    if (trimmed === "/clear") {
      console.clear();
      rl.prompt();
      return;
    }

    if (trimmed === "/copy") {
      if (!lastResponse) {
        console.log(C.dim("  No response to copy.\n")); // legacy
        rl.prompt();
        return;
      }
      const tryClipboard = (cmds: [string, string[]][], idx: number) => {
        if (idx >= cmds.length) {
          console.log(C.dim("  Clipboard tool not found (install xclip or xsel).\n")); // legacy
          rl.prompt();
          return;
        }
        const [cmd, args] = cmds[idx];
        const proc = execFile(cmd, args, (err: Error | null) => {
          if (err) {
            tryClipboard(cmds, idx + 1);
          } else {
            console.log(C.dim("  ✓ Copied to clipboard.\n")); // legacy
            rl.prompt();
          }
        });
        proc.stdin?.write(lastResponse);
        proc.stdin?.end();
      };
      tryClipboard([
        ["pbcopy", []],
        ["xclip", ["-selection", "clipboard"]],
        ["xsel", ["--clipboard", "--input"]],
      ], 0);
      return;
    }

    activeRequestId += 1;
    activeRequestStartedAt = Date.now();
 debugLog("request-dispatch", { requestId: activeRequestId, inputLength: trimmed.length, columns: process.stdout.columns || null, });
    startThinking();
    sendMessage(trimmed, activeRequestId);
  });

  rl.on("close", () => {
    trimHistoryFile();
    console.log(C.dim("\n    bye.\n")); // legacy
    process.exit(0);
  });
}, 1000);
