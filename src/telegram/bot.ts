import { Bot, type Context } from "grammy";
import { config, persistModel, MAX_PROMPT_LENGTH } from "../config.js";
import { sendToOrchestrator, cancelCurrentMessage, getWorkers, getLastRouteResult } from "../copilot/orchestrator.js";
import { chunkMessage, toTelegramMarkdown } from "./formatter.js";
import { searchMemories } from "../store/db.js";
import { listSkills } from "../copilot/skills.js";
import { restartDaemon } from "../daemon.js";
import { getRouterConfig, updateRouterConfig } from "../copilot/router.js";

let bot: Bot | undefined;

export function createBot(): Bot {
  if (!config.telegramBotToken) {
    throw new Error("Telegram bot token is missing. Run 'hoot setup' and enter the bot token from @BotFather.");
  }
  if (config.authorizedUserId === undefined) {
    throw new Error("Telegram user ID is missing. Run 'hoot setup' and enter your Telegram user ID (get it from @userinfobot).");
  }
  bot = new Bot(config.telegramBotToken);

  bot.use(async (ctx, next) => {
    if (config.authorizedUserId !== undefined && ctx.from?.id !== config.authorizedUserId) {
      const { logAudit } = await import("../store/db.js");
      logAudit("auth_reject", String(ctx.from?.id ?? "unknown"), {
        username: ctx.from?.username,
        chatId: ctx.chat?.id,
      }, "telegram");
      return; // Silently ignore unauthorized users
    }
    await next();
  });

  bot.command("start", (ctx) => ctx.reply("Hoot 🦉 is online. Send me anything."));
  bot.command("help", (ctx) =>
    ctx.reply(
      "I'm Hoot 🦉, your AI daemon.\n\n" +
        "Just send me a message and I'll handle it.\n\n" +
        "Commands:\n" +
        "/cancel — Cancel the current message\n" +
        "/model — Show current model\n" +
        "/model <name> — Switch model\n" +
        "/auto — Toggle auto model routing\n" +
        "/memory — Show stored memories\n" +
        "/skills — List installed skills\n" +
        "/workers — List active worker sessions\n" +
        "/restart — Restart Hoot 🦉\n" +
        "/help — Show this help"
    )
  );
  bot.command("cancel", async (ctx) => {
    const cancelled = await cancelCurrentMessage();
    await ctx.reply(cancelled ? "⛔ Cancelled." : "Nothing to cancel.");
  });
  bot.command("model", async (ctx) => {
    const arg = ctx.match?.trim();
    if (arg) {
      try {
        const { getClient } = await import("../copilot/client.js");
        const client = await getClient();
        const models = await client.listModels();
        const match = models.find((m) => m.id === arg);
        if (!match) {
          const suggestions = models
            .filter((m) => m.id.includes(arg) || m.id.toLowerCase().includes(arg.toLowerCase()))
            .map((m) => m.id);
          const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
          await ctx.reply(`Model '${arg}' not found.${hint}`);
          return;
        }
      } catch {
      }
      const previous = config.copilotModel;
      config.copilotModel = arg;
      persistModel(arg);
      await ctx.reply(`Model: ${previous} → ${arg}`);
    } else {
      await ctx.reply(`Current model: ${config.copilotModel}`);
    }
  });
  bot.command("memory", async (ctx) => {
    const memories = searchMemories(undefined, undefined, 50);
    if (memories.length === 0) {
      await ctx.reply("No memories stored.");
    } else {
      const lines = memories.map((m) => `#${m.id} [${m.category}] ${m.content}`);
      await ctx.reply(lines.join("\n") + `\n\n${memories.length} total`);
    }
  });
  bot.command("skills", async (ctx) => {
    const skills = listSkills();
    if (skills.length === 0) {
      await ctx.reply("No skills installed.");
    } else {
      const lines = skills.map((s) => `• ${s.name} (${s.source}) — ${s.description}`);
      await ctx.reply(lines.join("\n"));
    }
  });
  bot.command("workers", async (ctx) => {
    const workers = Array.from(getWorkers().values());
    if (workers.length === 0) {
      await ctx.reply("No active worker sessions.");
    } else {
      const lines = workers.map((w) => `• ${w.name} (${w.workingDir}) — ${w.status}`);
      await ctx.reply(lines.join("\n"));
    }
  });
  bot.command("restart", async (ctx) => {
    await ctx.reply("⏳ Restarting Hoot 🦉...");
    setTimeout(() => {
      restartDaemon().catch((err) => {
        console.error("[hoot] Restart failed:", err);
      });
    }, 500);
  });
  bot.command("auto", async (ctx) => {
    const current = getRouterConfig();
    const newState = !current.enabled;
    updateRouterConfig({ enabled: newState });
    const label = newState
      ? "⚡ Auto mode on"
      : `Auto mode off · using ${config.copilotModel}`;
    await ctx.reply(label);
  });

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const userMessageId = ctx.message.message_id;
    const replyParams = { message_id: userMessageId };

    if (ctx.message.text.length > MAX_PROMPT_LENGTH) {
      await ctx.reply(`Message too long. Maximum ${MAX_PROMPT_LENGTH.toLocaleString()} characters.`, { reply_parameters: replyParams });
      return;
    }

    let typingInterval: ReturnType<typeof setInterval> | undefined;
    const startTyping = () => {
      void ctx.replyWithChatAction("typing").catch(() => {});
      typingInterval = setInterval(() => {
        void ctx.replyWithChatAction("typing").catch(() => {});
      }, 4000);
    };
    const stopTyping = () => {
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = undefined;
      }
    };

    startTyping();

    sendToOrchestrator(
      ctx.message.text,
      { type: "telegram", chatId, messageId: userMessageId },
      (text: string, done: boolean) => {
        if (done) {
          stopTyping();
          void (async () => {
            try {
            const safeText = text ?? "(No response)";
            console.log("[hoot-debug] Response text length:", safeText.length, "first 200:", safeText.slice(0, 200));
            const routeResult = getLastRouteResult();
            let indicatorSuffix = "";
            if (routeResult && routeResult.routerMode === "auto") {
              indicatorSuffix = `\n\n_⚡ auto · ${routeResult.model}_`;
            }
            const formatted = toTelegramMarkdown(safeText) + indicatorSuffix;
            console.log("[hoot-debug] Formatted length:", formatted.length);
            const chunks = chunkMessage(formatted);
            const fallbackText = routeResult && routeResult.routerMode === "auto"
              ? safeText + `\n\n⚡ auto · ${routeResult.model}`
              : safeText;
            const fallbackChunks = chunkMessage(fallbackText);
            const sendChunk = async (chunk: string, fallback: string, isFirst: boolean) => {
              const opts = isFirst
                ? { parse_mode: "MarkdownV2" as const, reply_parameters: replyParams }
                : { parse_mode: "MarkdownV2" as const };
              await ctx.reply(chunk, opts).catch(
                () => ctx.reply(fallback, isFirst ? { reply_parameters: replyParams } : {})
              );
            };
            try {
              for (let i = 0; i < chunks.length; i++) {
                await sendChunk(chunks[i], fallbackChunks[i] ?? chunks[i], i === 0);
              }
            } catch (fmtErr) {
              console.error("[hoot-debug] Fallback send error:", fmtErr);
              try {
                for (let i = 0; i < fallbackChunks.length; i++) {
                  await ctx.reply(fallbackChunks[i], i === 0 ? { reply_parameters: replyParams } : {});
                }
              } catch (fbErr) {
                console.error("[hoot-debug] Final fallback error:", fbErr);
              }
            }
            } catch (outerErr) {
              console.error("[hoot-debug] Outer callback error:", outerErr);
            }
          })();
        }
      }
    );
  });

  return bot;
}

export async function startBot(): Promise<void> {
  if (!bot) throw new Error("Bot not created");
  console.log("[hoot] Telegram bot starting..."); // legacy
  bot.start({
    onStart: () => console.log("[hoot] Telegram bot connected"), // legacy
  }).catch((err: any) => {
    if (err?.error_code === 401) {
      console.error("[hoot] ⚠️ Telegram bot token is invalid or expired. Run 'hoot setup' and re-enter your bot token from @BotFather.");
    } else if (err?.error_code === 409) {
      console.error("[hoot] ⚠️ Another bot instance is already running with this token. Stop the other instance first.");
    } else {
      console.error("[hoot] ❌ Telegram bot failed to start:", err?.message || err);
    }
  });
}

export async function stopBot(): Promise<void> {
  if (bot) {
    await bot.stop();
  }
}

export async function sendProactiveMessage(text: string): Promise<void> {
  if (!bot || config.authorizedUserId === undefined) return;
  const formatted = toTelegramMarkdown(text);
  const chunks = chunkMessage(formatted);
  const fallbackChunks = chunkMessage(text);
  for (let i = 0; i < chunks.length; i++) {
    try {
      await bot.api.sendMessage(config.authorizedUserId, chunks[i], { parse_mode: "MarkdownV2" });
    } catch {
      try {
        await bot.api.sendMessage(config.authorizedUserId, fallbackChunks[i] ?? chunks[i]);
      } catch {
      }
    }
  }
}

export async function sendPhoto(photo: string, caption?: string): Promise<void> {
  if (!bot || config.authorizedUserId === undefined) return;
  try {
    const { InputFile } = await import("grammy");
    const input = photo.startsWith("http") ? photo : new InputFile(photo);
    await bot.api.sendPhoto(config.authorizedUserId, input, {
      caption,
    });
  } catch (err) {
    console.error("[hoot] Failed to send photo:", err instanceof Error ? err.message : err);
    throw err;
  }
}
