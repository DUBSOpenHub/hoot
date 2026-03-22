import { getState, setState } from "../store/db.js";
import { classifyWithLLM } from "./classifier.js";
import { createLogger } from "../observability/logger.js";
import type { AIProvider } from "../providers/types.js";

const log = createLogger("router"); // logger

export type Tier = "fast" | "standard" | "premium";

export interface OverrideRule {
  name: string;
  keywords: string[];
  model: string;
}

export interface RouterConfig {
  enabled: boolean;
  tierModels: Record<Tier, string>;
  overrides: OverrideRule[];
  cooldownMessages: number;
}

export interface RouteResult {
  model: string;
  tier: Tier | null;
  overrideName?: string;
  switched: boolean;
  routerMode: "auto" | "manual";
}

const DEFAULT_CONFIG: RouterConfig = {
  enabled: false,
  tierModels: {
    fast: "gpt-4.1",
    standard: "claude-sonnet-4.6",
    premium: "claude-opus-4.6",
  },
  overrides: [
    {
      name: "design",
      keywords: [
        "design", "ui", "ux", "css", "layout", "styling", "visual",
        "mockup", "wireframe", "frontend design", "tailwind", "responsive",
      ],
      model: "claude-opus-4.6",
    },
  ],
  cooldownMessages: 2,
};

let messagesSinceSwitch = Infinity;

const FOLLOW_UP_PATTERNS = [
  "yes", "no", "do it", "go ahead", "sure", "sounds good", "looks good",
  "perfect", "+1", "please", "yep", "yup", "nope", "nah", "ok", "okay",
  "got it", "cool", "nice", "great", "alright", "right",
];

function sanitize(prompt: string): string {
  return prompt
    .replace(/^\[via telegram\]\s*/i, "")
    .replace(/^\[via tui\]\s*/i, "")
    .trim();
}

function wordMatch(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

export function getRouterConfig(): RouterConfig {
  const stored = getState("router_config");
  if (stored) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }
  return { ...DEFAULT_CONFIG };
}

export function updateRouterConfig(partial: Partial<RouterConfig>): RouterConfig {
  const current = getRouterConfig();
  const merged: RouterConfig = {
    ...current,
    ...partial,
    tierModels: {
      ...current.tierModels,
      ...(partial.tierModels ?? {}),
    },
    overrides: partial.overrides ?? current.overrides,
  };
  setState("router_config", JSON.stringify(merged));
  return merged;
}

async function classifyMessage(
  prompt: string,
  recentTiers: Tier[],
  provider?: AIProvider,
): Promise<Tier> {
  const text = sanitize(prompt);
  const lower = text.toLowerCase();

  if (lower.startsWith("[background task completed]")) return "standard";

  if (text.length < 20 && recentTiers.length > 0) {
    const isFollowUp = FOLLOW_UP_PATTERNS.some((p) => lower === p || lower === p + ".");
    if (isFollowUp) return recentTiers[0];
  }

  if (provider) {
    const tier = await classifyWithLLM(provider, text);
    if (tier) {
      log.info(`Classifier: ${tier}`); // logger
      return tier;
    }
  }

  log.info("Classifier (fallback): standard"); // logger
  return "standard";
}

export async function resolveModel(
  prompt: string,
  currentModel: string,
  recentTiers: Tier[],
  provider?: AIProvider,
): Promise<RouteResult> {
  const config = getRouterConfig();

  if (!config.enabled) {
    messagesSinceSwitch = Infinity;
    return { model: currentModel, tier: null, switched: false, routerMode: "manual" };
  }

  const text = sanitize(prompt);

  for (const rule of config.overrides) {
    if (rule.keywords.some((kw) => wordMatch(text, kw))) {
      const switched = rule.model !== currentModel;
      if (switched) messagesSinceSwitch = 0;
      return { model: rule.model, tier: null, overrideName: rule.name, switched, routerMode: "auto" };
    }
  }

  const tier = await classifyMessage(prompt, recentTiers, provider);
  const targetModel = config.tierModels[tier];
  const wouldSwitch = targetModel !== currentModel;

  if (wouldSwitch && messagesSinceSwitch < config.cooldownMessages) {
    messagesSinceSwitch++;
    return { model: currentModel, tier, switched: false, routerMode: "auto" };
  }

  if (wouldSwitch) messagesSinceSwitch = 0;
  else messagesSinceSwitch++;

  return { model: targetModel, tier, switched: wouldSwitch, routerMode: "auto" };
}
