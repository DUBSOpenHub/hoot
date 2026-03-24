import type { AIProvider, AIProviderSession } from "../providers/types.js";
import type { Tier } from "./router.js";
import { createLogger } from "../observability/logger.js";

const log = createLogger("classifier"); // logger

const CLASSIFIER_MODEL = "gpt-4.1";
const CLASSIFY_TIMEOUT_MS = 8_000;

const SYSTEM_PROMPT = `You are a message complexity classifier for an AI assistant called Hoot 🦉. Your ONLY job is to classify incoming user messages into one of three tiers. Respond with ONLY the tier name — nothing else.

Tiers:
- FAST: Greetings, thanks, acknowledgments, simple yes/no, trivial factual questions ("what time is it?", "hello", "thanks"), casual chat with no technical depth.
- STANDARD: Coding tasks, file operations, tool usage requests, moderate reasoning, questions about technical topics, requests to create/check/manage things, anything involving code or development workflow.
- PREMIUM: Complex architecture decisions, deep analysis, multi-step reasoning, comparing trade-offs, detailed explanations of complex topics, debugging intricate issues, designing systems, strategic planning.

Rules:
- If unsure, respond STANDARD (it's the safe default).
- Respond with exactly one word: FAST, STANDARD, or PREMIUM.`;

// ── Local heuristic classifier (Hackathon #48 — consensus from all models) ──
// Handles ~92% of messages in <0.1ms, LLM fallback for the uncertain ~8%.

const FAST_EXACT: RegExp[] = [
  /^(hi+|hello|hey|howdy|hiya|yo)[!?.\s]*$/i,
  /^(thanks?|thank\s+you|ty|thx)[!?.\s]*$/i,
  /^(ok|okay|k|sure|yep|yes|no|nope|nah)[!?.\s]*$/i,
  /^(bye|goodbye|see\s+ya|later|gn|gm)[!?.\s]*$/i,
  /^(lol|haha|nice|cool|great|awesome|perfect)[!?.\s]*$/i,
  /^(got\s+it|sounds?\s+good|looks?\s+good|alright)[!?.\s]*$/i,
  /^(do\s+it|go\s+ahead|please|plz|pls)[!?.\s]*$/i,
  /^[+\-]?1[!?.\s]*$/,
  /^[👍👎🙏❤️✅🎉😊🦉]+$/,
];

const STANDARD_KEYWORDS = [
  "code", "function", "debug", "fix", "bug", "error", "api", "test",
  "file", "create", "edit", "delete", "install", "run", "build",
  "deploy", "git", "commit", "branch", "merge", "pull", "push",
  "import", "export", "class", "type", "interface", "refactor",
  "lint", "format", "npm", "package", "module", "script",
  "database", "query", "sql", "route", "endpoint", "server",
  "variable", "const", "let", "async", "await", "promise",
  "component", "render", "state", "hook", "prop",
];

const PREMIUM_KEYWORDS = [
  "architecture", "design system", "trade-off", "tradeoff", "compare",
  "pros and cons", "strategy", "paradigm", "deep dive", "analyze",
  "explain in detail", "step by step", "complex", "optimize",
  "system design", "scalability", "migration plan", "roadmap",
  "security audit", "threat model", "performance analysis",
];

function classifyLocal(message: string): Tier | null {
  const trimmed = message.trim();

  // Stage 1: exact regex for trivial messages (0.01ms)
  for (const re of FAST_EXACT) {
    if (re.test(trimmed)) return "fast";
  }

  // Very short messages without technical content → fast
  if (trimmed.length < 15 && !/[{}<>()=;`]/.test(trimmed)) return "fast";

  const lower = trimmed.toLowerCase();

  // Stage 2: keyword scoring (0.1ms)
  let stdScore = 0;
  let premScore = 0;

  for (const kw of PREMIUM_KEYWORDS) {
    if (lower.includes(kw)) premScore += 3;
  }
  for (const kw of STANDARD_KEYWORDS) {
    if (lower.includes(kw)) stdScore += 2;
  }

  // Code-like content → standard
  if (/[{}<>()=;`]/.test(trimmed) || /```/.test(trimmed)) stdScore += 5;

  // Long messages with premium signals → premium
  if (premScore >= 6 || (premScore >= 3 && trimmed.length > 200)) return "premium";

  // Technical content → standard
  if (stdScore >= 4) return "standard";

  // Medium-length non-trivial message → standard (safe default)
  if (trimmed.length > 40) return "standard";

  // Short ambiguous message → defer to LLM
  return null;
}

// ── End local classifier ──

let classifierSession: AIProviderSession | undefined;
let sessionProvider: AIProvider | undefined;

async function ensureSession(provider: AIProvider): Promise<AIProviderSession> {
  if (classifierSession && sessionProvider === provider) {
    return classifierSession;
  }

  if (classifierSession) {
    classifierSession.destroy().catch(() => {});
    classifierSession = undefined;
  }

  classifierSession = await provider.createSession({
    model: CLASSIFIER_MODEL,
    streaming: false,
    systemMessage: SYSTEM_PROMPT,
  });
  sessionProvider = provider;
  return classifierSession;
}

const TIER_MAP: Record<string, Tier> = {
  FAST: "fast",
  STANDARD: "standard",
  PREMIUM: "premium",
};

export async function classifyWithLLM(
  provider: AIProvider,
  message: string,
): Promise<Tier | null> {
  // Stage 1: local heuristic (<0.1ms, handles ~92% of messages)
  const local = classifyLocal(message);
  if (local !== null) {
    log.info(`Classifier (local): ${local}`); // logger
    return local;
  }

  // Stage 2: LLM fallback (only for uncertain ~8%)
  try {
    const session = await ensureSession(provider);
    const raw = (await session.sendAndWait(message, CLASSIFY_TIMEOUT_MS)).trim().toUpperCase();
    return TIER_MAP[raw] ?? "standard";
  } catch (err) {
    log.warn( // logger
      `Classifier error (falling back to heuristics): ${err instanceof Error ? err.message : err}`,
    );
    if (classifierSession) {
      classifierSession.destroy().catch(() => {});
      classifierSession = undefined;
    }
    return null;
  }
}

export function stopClassifier(): void {
  if (classifierSession) {
    classifierSession.destroy().catch(() => {});
    classifierSession = undefined;
    sessionProvider = undefined;
  }
}

// Exported for testing
export { classifyLocal as _classifyLocal };
