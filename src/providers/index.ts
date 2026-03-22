import type { AIProvider } from "./types.js";
import { CopilotProvider } from "./copilot.js";

let activeProvider: AIProvider | undefined;

export function getProvider(): AIProvider {
  if (!activeProvider) {
    activeProvider = new CopilotProvider();
  }
  return activeProvider;
}

export function setProvider(provider: AIProvider): void {
  activeProvider = provider;
}

export { CopilotProvider } from "./copilot.js";
export type { AIProvider, AIProviderSession, SessionConfig, ModelInfo } from "./types.js";
