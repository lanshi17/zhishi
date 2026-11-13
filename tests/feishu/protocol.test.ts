import { describe, expect, it } from "vitest";
import { conversationIdOf, parseTextContent, senderOpenId, speakerLabel } from "../../src/feishu/protocol.js";
import type { FeishuMessageEvent } from "../../src/feishu/protocol.js";

function event(chatType: string): FeishuMessageEvent {
  return {
    sender: { sender_id: { open_id: "ou_alice" } },
    message: {
      message_id: "om-1",
      chat_id: "oc-1",
      chat_type: chatType,
      message_type: "text",
      content: JSON.stringify({ text: "hi" }),
    },
  };
}

describe("feishu protocol", () => {
  it("strips mention placeholders from text content", () => {
    const content = JSON.stringify({ text: "@_user_1 @_user_2 今天吃了包子" });
    const mentions = [
      { key: "@_user_1", name: "知食" },
      { key: "@_user_2", name: "小王" },
    ];

    expect(parseTextContent(content, mentions)).toBe("今天吃了包子");
  });

  it("keeps newlines and returns empty text for non-text payloads", () => {
    expect(parseTextContent(JSON.stringify({ text: "第一行\n第二行" }))).toBe("第一行\n第二行");
    expect(parseTextContent(JSON.stringify({ image_key: "img_1" }))).toBe("");
    expect(parseTextContent("not json")).toBe("");
  });

  it("keys group conversations by chat and direct chats by user", () => {
    expect(conversationIdOf(event("group"), "ou_alice")).toBe("feishu:chat:oc-1");
    expect(conversationIdOf(event("p2p"), "ou_alice")).toBe("feishu:user:ou_alice");
  });

  it("derives the sender open id and a short speaker label", () => {
    expect(senderOpenId(event("p2p"))).toBe("ou_alice");
    expect(senderOpenId({ message: event("p2p").message })).toBeUndefined();
    expect(speakerLabel("ou_abcd123456")).toBe("123456");
    expect(speakerLabel("short")).toBe("short");
  });
});
