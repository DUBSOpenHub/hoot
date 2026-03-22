import type { MessageBus } from "../bus/index.js";
import type { Logger } from "../observability/logger.js";
import type { Tool } from "@github/copilot-sdk";
import type Database from "better-sqlite3";
import type { RequestHandler } from "express";

export interface PluginContext {
  bus: MessageBus;
    registerTool(tool: Tool<any>): void;
    addApiRoute(method: "get" | "post" | "delete", path: string, handler: RequestHandler): void;
  getDb(): Database.Database;
  log: Logger;
  config: Readonly<{
    copilotModel: string;
    apiPort: number;
    telegramEnabled: boolean;
    [key: string]: unknown;
  }>;
}

export interface HootPlugin {
  name: string;
  version: string;
    onLoad(ctx: PluginContext): Promise<void>;
    onUnload?(): Promise<void>;
}

/** @deprecated Use HootPlugin instead */
export type MaxPlugin = HootPlugin;
