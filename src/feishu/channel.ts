import {
  conversationIdOf,
  parseImageKey,
  parseTextContent,
  senderOpenId,
  speakerLabel,
  type FeishuMessageEvent,
} from "./protocol.js";

type Logger = {
  info(data: unknown, msg?: string): void;
  warn(data: unknown, msg?: string): void;
  error(data: unknown, msg?: string): void;
};

export type FeishuChannelDeps = {
  /** Direct-chat senders. Empty list allows every member of the tenant. */
  allowedOpenIds: string[];
  /** Group chats that may invoke the bot. Empty list allows every group. */
  allowedChatIds?: string[];
  sendReply: (target: { messageId: string; chatId: string }, text: string) => Promise<void>;
  handleAgent: (conversationId: string, text: string, imageUrls?: string[]) => Promise<string>;
  /** Downloads an image message attachment as a data URL; omitted disables image input. */
  downloadImage?: (messageId: string, imageKey: string) => Promise<string>;
  logger?: Logger;
  dedupeTtlMs?: number;
  unsupportedMessageText?: string;
  failureText?: string;
};

export type FeishuChannel = {
  handleMessage(event: FeishuMessageEvent): Promise<void>;
};

const DEFAULT_DEDUPE_TTL_MS = 10 * 60 * 1000;
const MAX_DEDUPE_ENTRIES = 2_000;

/**
 * Turns one Feishu `im.message.receive_v1` event into an agent turn.
 *
 * Group chats share one conversation keyed by `chat_id`, so every member sees
 * the same history and the reply lands in the group (as a reply to the user's
 * message). Direct chats are keyed by the sender's Open ID. Turns within one
 * conversation are serialized so a slow agent run cannot interleave.
 */
export function createFeishuChannel(deps: FeishuChannelDeps): FeishuChannel {
  const logger = deps.logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  const dedupeTtlMs = deps.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS;
  const unsupportedText = deps.unsupportedMessageText
    ?? "目前只支持文本与图片消息，请直接描述或发送图片。";
  const failureText = deps.failureText ?? "处理失败，请稍后重试。";
  const allowed = new Set(deps.allowedOpenIds);
  const allowedChats = new Set(deps.allowedChatIds ?? []);
  const seen = new Map<string, number>();
  const queues = new Map<string, Promise<void>>();

  function isDuplicate(key: string): boolean {
    const now = Date.now();
    for (const [seenKey, expiresAt] of seen) {
      if (expiresAt <= now) {
        seen.delete(seenKey);
      }
    }

    const expiresAt = seen.get(key);
    if (expiresAt !== undefined && expiresAt > now) {
      return true;
    }

    if (seen.size >= MAX_DEDUPE_ENTRIES) {
      const oldest = seen.keys().next();
      if (!oldest.done) {
        seen.delete(oldest.value);
      }
    }

    seen.set(key, now + dedupeTtlMs);
    return false;
  }

  function enqueue(conversationId: string, task: () => Promise<void>): Promise<void> {
    const previous = queues.get(conversationId) ?? Promise.resolve();
    const next = previous.then(task, task).catch((err: unknown) => {
      logger.error({ conversationId, err }, "feishu conversation task failed");
    });

    queues.set(conversationId, next);
    void next.then(() => {
      if (queues.get(conversationId) === next) {
        queues.delete(conversationId);
      }
    });

    return next;
  }

  return {
    async handleMessage(event: FeishuMessageEvent) {
      const openId = senderOpenId(event);
      if (!openId) {
        logger.warn({ eventId: event.event_id }, "feishu event without sender id, ignored");
        return;
      }

      const message = event.message;
      const dedupeKey = event.event_id ?? message.message_id;
      if (dedupeKey && isDuplicate(dedupeKey)) {
        logger.info({ dedupeKey }, "feishu duplicate event ignored");
        return;
      }

      const isGroup = message.chat_type === "group";

      // Group access is gated by chat_id so every member of an approved group
      // can talk to the bot; direct chats are gated by the sender's Open ID.
      if (isGroup) {
        if (allowedChats.size > 0 && !allowedChats.has(message.chat_id)) {
          logger.warn({ chatId: message.chat_id, openId }, "feishu group not allowed, ignored");
          return;
        }
      } else if (allowed.size > 0 && !allowed.has(openId)) {
        logger.warn({ openId, chatType: message.chat_type }, "feishu sender not allowed, ignored");
        return;
      }

      let text = "";
      let imageUrls: string[] | undefined;

      if (message.message_type === "image") {
        const imageKey = parseImageKey(message.content);
        if (!imageKey || !deps.downloadImage) {
          await deps.sendReply(
            { messageId: message.message_id, chatId: message.chat_id },
            unsupportedText,
          ).catch((err: unknown) => {
            logger.error({ messageId: message.message_id, err }, "feishu unsupported-type reply failed");
          });
          return;
        }

        try {
          imageUrls = [await deps.downloadImage(message.message_id, imageKey)];
        } catch (err) {
          logger.error({ messageId: message.message_id, err }, "feishu image download failed");
          await deps.sendReply(
            { messageId: message.message_id, chatId: message.chat_id },
            "图片下载失败，请重试。",
          ).catch(() => {});
          return;
        }

        text = "[图片]";
      } else if (message.message_type === "text") {
        text = parseTextContent(message.content, message.mentions);
        if (!text) {
          return;
        }
      } else {
        await deps.sendReply(
          { messageId: message.message_id, chatId: message.chat_id },
          unsupportedText,
        ).catch((err: unknown) => {
          logger.error({ messageId: message.message_id, err }, "feishu unsupported-type reply failed");
        });
        return;
      }

      const conversationId = conversationIdOf(event, openId);
      const agentText = isGroup
        ? `[${speakerLabel(openId)}] ${text}`
        : text;

      logger.info(
        { messageId: message.message_id, openId, conversationId, chatType: message.chat_type },
        "feishu message accepted",
      );

      await enqueue(conversationId, async () => {
        try {
          const reply = imageUrls
            ? await deps.handleAgent(conversationId, agentText, imageUrls)
            : await deps.handleAgent(conversationId, agentText);
          await deps.sendReply({ messageId: message.message_id, chatId: message.chat_id }, reply);
        } catch (err) {
          logger.error({ conversationId, messageId: message.message_id, err }, "feishu agent turn failed");
          await deps.sendReply(
            { messageId: message.message_id, chatId: message.chat_id },
            failureText,
          ).catch((sendErr: unknown) => {
            logger.error({ conversationId, err: sendErr }, "feishu failure reply failed");
          });
        }
      });
    },
  };
}
