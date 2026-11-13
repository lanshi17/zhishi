import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { pino } from "pino";
import { loadConfig } from "./shared/config.js";
import { createDefaultEntrypoint } from "./app/entrypoint.js";
import { createFeishuChannel } from "./feishu/channel.js";
import { createFeishuMessenger } from "./feishu/client.js";
import { createFeishuRuntime } from "./feishu/runtime.js";

function logFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}_${time}.log`;
}

/**
 * Feishu (飞书) bot entrypoint: long-connection event subscription plus the
 * shared health agent. Group chats are keyed by chat_id, so an entire group
 * shares one conversation and one agent memory.
 */
export async function runFeishuEntrypoint(input: { env: Record<string, string | undefined> }) {
  const config = loadConfig(input.env);
  if (!config.feishu.enabled) {
    throw new Error("Feishu channel not configured: set FEISHU_APP_ID and FEISHU_APP_SECRET");
  }

  const logDir = "logs";
  mkdirSync(logDir, { recursive: true });
  const logger = pino(
    { level: "info" },
    pino.destination({ dest: `${logDir}/${logFileName()}`, sync: false }),
  );

  logger.info({ model: config.llm.model, baseUrl: config.llm.baseUrl }, "feishu bot starting");

  const entrypoint = await createDefaultEntrypoint({ env: input.env, logger });
  const messenger = createFeishuMessenger({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
  });

  const channel = createFeishuChannel({
    allowedOpenIds: config.feishu.allowedOpenIds,
    allowedChatIds: config.feishu.allowedChatIds,
    logger,
    sendReply: (target, text) => messenger.replyText(target.messageId, text),
    downloadImage: (messageId, imageKey) => messenger.downloadImage(messageId, imageKey),
    handleAgent: async (conversationId, text, imageUrls) => {
      const thread = await entrypoint.taskService.receiveMessage({
        fromUserId: conversationId,
        text,
      });

      try {
        const context = await entrypoint.buildContext(conversationId);
        const reply = await entrypoint.healthPipeline.handleMessage(
          conversationId,
          text,
          context,
          imageUrls,
        );
        await entrypoint.taskService.markDone(thread.threadId);
        return reply;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await entrypoint.taskService.markFailed(thread.threadId, reason);
        throw error;
      }
    },
  });

  const runtime = createFeishuRuntime({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    logger,
    onMessage: (event) => channel.handleMessage(event),
  });

  await runtime.start();
  logger.info(
    {
      allowedOpenIds: config.feishu.allowedOpenIds,
      allowedChatIds: config.feishu.allowedChatIds,
    },
    "feishu bot ready — subscribe im.message.receive_v1 with long connection in the app console",
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "feishu bot shutting down");
    await runtime.stop().catch(() => {});
    await entrypoint.db.end().catch(() => {});
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  return { runtime, entrypoint };
}

export async function main() {
  try {
    await runFeishuEntrypoint({ env: process.env });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Feishu startup failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
