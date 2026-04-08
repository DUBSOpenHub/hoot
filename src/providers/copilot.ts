/**
 * CopilotProvider — AIProvider implementation backed by @github/copilot-sdk.
 * This is the default provider shipped with Hoot.
 */
import { CopilotClient, approveAll, defineTool } from "@github/copilot-sdk";
import type { CopilotSession } from "@github/copilot-sdk";
import type { AIProvider, AIProviderSession, SessionConfig, ModelInfo } from "./types.js";

class CopilotSessionWrapper implements AIProviderSession {
  constructor(private session: CopilotSession) {}

  get id(): string { return this.session.sessionId; }

  async sendAndWait(prompt: string, timeoutMs: number): Promise<string> {
    const result = await this.session.sendAndWait({ prompt }, timeoutMs);
    return result?.data?.content || "";
  }

  onDelta(handler: (text: string) => void): void {
    this.session.on("assistant.message_delta", (ev: any) => {
      handler(ev?.data?.content || "");
    });
  }

  onToolStart(handler: (toolName: string) => void): void {
    this.session.on("tool.execution_start", (ev: any) => {
      handler(ev?.name || "");
    });
  }

  onToolComplete(handler: (toolName: string, result: string) => void): void {
    this.session.on("tool.execution_complete", (ev: any) => {
      handler(ev?.name || "", JSON.stringify(ev?.result || ""));
    });
  }

  async abort(): Promise<void> {
    try { (this.session as any).abort?.(); } catch {}
  }

  async destroy(): Promise<void> {
    try { await this.session.destroy(); } catch {}
  }
}

export class CopilotProvider implements AIProvider {
  readonly name = "copilot-sdk";
  private client: CopilotClient | undefined;

  async start(): Promise<void> {
    this.client = new CopilotClient({ autoStart: true, autoRestart: true });
    await this.client.start();
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = undefined;
    }
  }

  getState(): string {
    return this.client?.getState?.() ?? "disconnected";
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.client) throw new Error("Provider not started");
    const models = await this.client.listModels();
    return (models || []).map((m: any) => ({
      id: m.id || m.modelId || String(m),
      name: m.name || m.id,
      billingMultiplier: m.billingMultiplier,
    }));
  }

  async createSession(config: SessionConfig): Promise<AIProviderSession> {
    if (!this.client) throw new Error("Provider not started");
    const session = await this.client.createSession({
      model: config.model,
      streaming: config.streaming ?? true,
      systemMessage: config.systemMessage ? { content: config.systemMessage } : undefined,
      workingDirectory: config.workingDirectory,
      configDir: config.configDir,
      tools: config.tools as import("@github/copilot-sdk").Tool<any>[] | undefined,
      mcpServers: config.mcpServers as Record<string, import("@github/copilot-sdk").MCPServerConfig> | undefined,
      skillDirectories: config.skillDirectories,
      onPermissionRequest: approveAll,
      infiniteSessions: config.infiniteSessions,
    });
    return new CopilotSessionWrapper(session);
  }

  async resumeSession(sessionId: string, config: SessionConfig): Promise<AIProviderSession> {
    if (!this.client) throw new Error("Provider not started");
    const session = await this.client.resumeSession(sessionId, {
      model: config.model,
      streaming: config.streaming ?? true,
      systemMessage: config.systemMessage ? { content: config.systemMessage } : undefined,
      workingDirectory: config.workingDirectory,
      configDir: config.configDir,
      tools: config.tools as import("@github/copilot-sdk").Tool<any>[] | undefined,
      mcpServers: config.mcpServers as Record<string, import("@github/copilot-sdk").MCPServerConfig> | undefined,
      skillDirectories: config.skillDirectories,
      onPermissionRequest: approveAll,
      infiniteSessions: config.infiniteSessions,
    });
    return new CopilotSessionWrapper(session);
  }

  /** Expose the underlying CopilotClient for pool/legacy uses that need direct SDK access */
  getClient(): CopilotClient | undefined {
    return this.client;
  }

  /** Expose defineTool for tool creation — SDK-specific but needed for tool registration */
  static defineTool = defineTool;

  /** Expose approveAll for backward compat */
  static approveAll = approveAll;
}
