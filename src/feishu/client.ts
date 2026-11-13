import type { Readable } from "node:stream";
import { Client } from "@larksuiteoapi/node-sdk";

/** Max characters kept before sending; Feishu caps a text body at 150 KB. */
export const MAX_TEXT_CHARS = 30_000;

type ReplyResponse = {
  code?: number;
  msg?: string;
};

/**
 * Narrow SDK surface so the payload can be asserted in tests without touching
 * the network, while still accepting the real `lark.Client`.
 */
export type FeishuSdkClient = {
  im: {
    message: {
      reply(payload: {
        data: { content: string; msg_type: string };
        path: { message_id: string };
      }): Promise<ReplyResponse>;
    };
    messageResource: {
      get(payload: {
        params: { type: string };
        path: { message_id: string; file_key: string };
      }): Promise<{ getReadableStream(): Readable; headers?: unknown }>;
    };
  };
};

export type FeishuMessenger = {
  replyText(messageId: string, text: string): Promise<void>;
  /** Downloads an image attachment and returns it as a data URL for the vision model. */
  downloadImage(messageId: string, imageKey: string): Promise<string>;
};

export function truncateText(text: string, maxChars = MAX_TEXT_CHARS): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n…（内容过长已截断）`;
}

export function createFeishuMessenger(input: {
  appId: string;
  appSecret: string;
  client?: FeishuSdkClient;
}): FeishuMessenger {
  const client: FeishuSdkClient = input.client ?? new Client({
    appId: input.appId,
    appSecret: input.appSecret,
  });

  return {
    async replyText(messageId: string, text: string) {
      const response = await client.im.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify({ text: truncateText(text) }),
          msg_type: "text",
        },
      });

      if (response.code) {
        throw new Error(`feishu reply failed: code=${response.code} msg=${response.msg ?? "?"}`);
      }
    },

    async downloadImage(messageId: string, imageKey: string) {
      const resource = await client.im.messageResource.get({
        params: { type: "image" },
        path: { message_id: messageId, file_key: imageKey },
      });

      const chunks: Buffer[] = [];
      for await (const chunk of resource.getReadableStream()) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const rawContentType = readHeader(resource.headers, "content-type");
      const contentType = rawContentType?.split(";")[0] ?? "image/jpeg";
      return `data:${contentType};base64,${Buffer.concat(chunks).toString("base64")}`;
    },
  };
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (typeof headers !== "object" || headers === null) {
    return undefined;
  }
  const value = (headers as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}
