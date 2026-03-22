export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  component: string;
  msg: string;
  correlationId?: string;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m", // cyan
  info:  "\x1b[32m", // green
  warn:  "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};
const RESET = "\x1b[0m";

export class Logger {
  private readonly component: string;
  private readonly correlationId?: string;
  private readonly minLevel: LogLevel;

  constructor(component: string, correlationId?: string) {
    this.component = component;
    this.correlationId = correlationId;
    this.minLevel = (process.env.MAX_LOG_LEVEL as LogLevel | undefined) ?? "info";
  }

  debug(msg: string, extra?: Record<string, unknown>): void {
    this.write("debug", msg, extra);
  }

  info(msg: string, extra?: Record<string, unknown>): void {
    this.write("info", msg, extra);
  }

  warn(msg: string, extra?: Record<string, unknown>): void {
    this.write("warn", msg, extra);
  }

  error(msg: string, extra?: Record<string, unknown>): void {
    this.write("error", msg, extra);
  }

  child(component: string): Logger {
    return new Logger(component, this.correlationId);
  }

  withCorrelation(id: string): Logger {
    return new Logger(this.component, id);
  }

  private write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const format = getLogFormat();

    if (format === "legacy") {
      const prefix = `[${this.component}]`;
      if (level === "error") {
        console.error(prefix, msg, extra ?? "");
      } else {
        console.log(prefix, msg, extra ?? "");
      }
      return;
    }

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      component: this.component,
      msg,
      ...(this.correlationId ? { correlationId: this.correlationId } : {}),
      ...(extra ?? {}),
    };

    if (format === "pretty") {
      const color = LEVEL_COLORS[level];
      const ts = entry.ts.replace("T", " ").replace("Z", "");
      const extras = extra && Object.keys(extra).length > 0
        ? " " + JSON.stringify(extra)
        : "";
      const line = `${color}${level.toUpperCase().padEnd(5)}${RESET} [${ts}] [${this.component}] ${msg}${extras}`;
      if (level === "error") {
        process.stderr.write(line + "\n");
      } else {
        process.stdout.write(line + "\n");
      }
      return;
    }

    // Default: json — all levels to stdout for log ingestion, errors also to stderr
    const line = JSON.stringify(entry);
    process.stdout.write(line + "\n");
    if (level === "error") {
      process.stderr.write(line + "\n");
    }
  }
}

function getLogFormat(): "json" | "pretty" | "legacy" {
  const v = process.env.MAX_LOG_FORMAT ?? "json";
  if (v === "pretty" || v === "legacy") return v;
  return "json";
}

export function createLogger(componentOrOpts: string | { component: string }, correlationId?: string): Logger {
  const component = typeof componentOrOpts === 'string'
    ? componentOrOpts
    : componentOrOpts.component;
  return new Logger(component, correlationId);
}

export const log = createLogger("hoot");
export const logger = createLogger("hoot");
