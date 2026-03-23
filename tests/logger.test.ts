import { describe, it, expect, beforeEach } from "vitest";
import { Logger, createLogger } from "../src/observability/logger.js";

describe("Logger", () => {
  it("creates a logger instance", () => {
    const logger = createLogger("test-component");
    expect(logger).toBeInstanceOf(Logger);
  });

  it("child() creates a new logger with different component", () => {
    const parent = createLogger("parent");
    const child = parent.child("child");
    expect(child).toBeInstanceOf(Logger);
    expect(child).not.toBe(parent);
  });

  it("withCorrelation() creates a child logger with correlationId", () => {
    const logger = createLogger("test");
    const corr = logger.withCorrelation("corr-id-123");
    expect(corr).toBeInstanceOf(Logger);
  });

  it("outputs JSON when HOOT_LOG_FORMAT=json", () => {
    process.env.HOOT_LOG_FORMAT = "json";
    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { lines.push(s); return true; };

    const logger = createLogger("json-test");
    logger.info("test message", { key: "value" });

    (process.stdout as any).write = origWrite;
    process.env.HOOT_LOG_FORMAT = "json";

    expect(lines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.level).toBe("info");
    expect(parsed.component).toBe("json-test");
    expect(parsed.msg).toBe("test message");
    expect(parsed.key).toBe("value");
    expect(parsed.ts).toBeDefined();
  });

  it("outputs pretty format when HOOT_LOG_FORMAT=pretty", () => {
    process.env.HOOT_LOG_FORMAT = "pretty";
    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { lines.push(s); return true; };

    const logger = createLogger("pretty-test");
    logger.info("pretty message");

    (process.stdout as any).write = origWrite;
    process.env.HOOT_LOG_FORMAT = "json";

    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("pretty-test");
    expect(lines[0]).toContain("pretty message");
    expect(lines[0]).not.toContain("{"); // Not raw JSON
  });

  it("outputs to console.log when HOOT_LOG_FORMAT=legacy", () => {
    process.env.HOOT_LOG_FORMAT = "legacy";
    let capturedMsg: string | undefined;
    const origLog = console.log;
    console.log = (...args: unknown[]) => { capturedMsg = args.join(" "); };

    const logger = createLogger("legacy-test");
    logger.info("legacy message");

    console.log = origLog;
    process.env.HOOT_LOG_FORMAT = "json";

    expect(capturedMsg).toContain("legacy message");
  });

  it("error() writes to stderr", () => {
    process.env.HOOT_LOG_FORMAT = "json";
    const lines: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (s: string) => { lines.push(s); return true; };

    const logger = createLogger("err-test");
    logger.error("error occurred", { code: 500 });

    (process.stderr as any).write = origWrite;

    expect(lines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.level).toBe("error");
    expect(parsed.code).toBe(500);
  });

  it("log entry includes correlationId when set", () => {
    process.env.HOOT_LOG_FORMAT = "json";
    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { lines.push(s); return true; };

    const logger = createLogger("corr-test").withCorrelation("abc-123");
    logger.info("correlated message");

    (process.stdout as any).write = origWrite;

    const parsed = JSON.parse(lines[0]);
    expect(parsed.correlationId).toBe("abc-123");
  });
});
