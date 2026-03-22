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
