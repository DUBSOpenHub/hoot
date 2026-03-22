/**
 * AIProvider — abstract interface between Hoot and any AI backend.
 * The Copilot SDK is the default implementation; others can be swapped in.
 */

export interface AIProviderSession {
  readonly id: string;
  sendAndWait(prompt: string, timeoutMs: number): Promise<string>;
  onDelta(handler: (text: string) => void): void;
  onToolComplete(handler: (toolName: string, result: string) => void): void;
  abort(): Promise<void>;
  destroy(): Promise<void>;
}

export interface SessionConfig {
  model: string;
  systemMessage?: string;
  workingDirectory?: string;
  configDir?: string;
  streaming?: boolean;
  tools?: unknown[];
  mcpServers?: Record<string, unknown>;
  skillDirectories?: string[];
  infiniteSessions?: { enabled: boolean; backgroundCompactionThreshold?: number; bufferExhaustionThreshold?: number };
}

export interface ModelInfo {
  id: string;
  name?: string;
  billingMultiplier?: number;
}

export interface AIProvider {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): string;
  listModels(): Promise<ModelInfo[]>;
  createSession(config: SessionConfig): Promise<AIProviderSession>;
  resumeSession(sessionId: string, config: SessionConfig): Promise<AIProviderSession>;
}
