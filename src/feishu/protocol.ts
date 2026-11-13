/**
 * Subset of the Feishu `im.message.receive_v1` event used by the agent channel.
 * https://open.feishu.cn/document/server-docs/im-v1/message/events/receive
 */
export type FeishuMention = {
  key: string;
  name: string;
  id?: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
};

export type FeishuMessageEvent = {
  event_id?: string;
  sender?: {
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type?: string;
  };
  message: {
    message_id: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: FeishuMention[];
  };
};

export function senderOpenId(event: FeishuMessageEvent): string | undefined {
  return event.sender?.sender_id?.open_id ?? event.sender?.sender_id?.user_id;
}

/**
 * Feishu delivers text as `{"text":"@_user_1 今天吃了包子"}` and separately maps
 * mention placeholders in `mentions`. The placeholders are removed so the agent
 * receives the user's actual words.
 */
export function parseTextContent(content: string, mentions: FeishuMention[] = []): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return "";
  }

  if (typeof parsed !== "object" || parsed === null || !("text" in parsed)) {
    return "";
  }

  const text = parsed.text;
  if (typeof text !== "string") {
    return "";
  }

  let cleaned = text;
  for (const mention of mentions) {
    if (mention.key) {
      cleaned = cleaned.split(mention.key).join(" ");
    }
  }

  return cleaned.replace(/[ \t]{2,}/g, " ").trim();
}

/** Extracts `image_key` from an image message payload (`{"image_key":"img_v2_..."}`). */
export function parseImageKey(content: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || !("image_key" in parsed)) {
      return undefined;
    }
    return typeof parsed.image_key === "string" ? parsed.image_key : undefined;
  } catch {
    return undefined;
  }
}

/** Group chats share one conversation per chat_id; direct chats are per user. */
export function conversationIdOf(event: FeishuMessageEvent, openId: string): string {
  if (event.message.chat_type === "group") {
    return `feishu:chat:${event.message.chat_id}`;
  }
  return `feishu:user:${openId}`;
}

/** Short stable speaker label used to attribute group messages. */
export function speakerLabel(openId: string): string {
  const id = openId.replace(/^(?:ou|on)_/, "");
  return id.length <= 6 ? id : id.slice(-6);
}
