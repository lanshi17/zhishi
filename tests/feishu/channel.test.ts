import { describe, expect, it, vi } from "vitest";
import { createFeishuChannel } from "../../src/feishu/channel.js";
import type { FeishuMessageEvent } from "../../src/feishu/protocol.js";

type EventOverrides = Partial<FeishuMessageEvent["message"]> & { event_id?: string };

function event(overrides: EventOverrides = {}, senderOpenId = "ou_alice"): FeishuMessageEvent {
  const { event_id = "evt-1", ...messageOverrides } = overrides;
  return {
    event_id,
    sender: { sender_id: { open_id: senderOpenId } },
    message: {
      message_id: "om-1",
      chat_id: "oc-group",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "今天早餐吃了两个包子" }),
      ...messageOverrides,
    },
  };
}

describe("createFeishuChannel", () => {
  it("runs the agent for a direct chat and replies to the message", async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handleAgent = vi.fn().mockResolvedValue("已记录：两个包子约 300 千卡");
    const channel = createFeishuChannel({ allowedOpenIds: [], sendReply, handleAgent });

    await channel.handleMessage(event());

    expect(handleAgent).toHaveBeenCalledWith("feishu:user:ou_alice", "今天早餐吃了两个包子");
    expect(sendReply).toHaveBeenCalledWith(
      { messageId: "om-1", chatId: "oc-group" },
      "已记录：两个包子约 300 千卡",
    );
  });

  it("shares one conversation per group and attributes the speaker", async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handleAgent = vi.fn().mockResolvedValue("ok");
    const channel = createFeishuChannel({ allowedOpenIds: [], sendReply, handleAgent });

    await channel.handleMessage(
      event({
        event_id: "evt-1",
        message_id: "om-1",
        chat_type: "group",
        content: JSON.stringify({ text: "@_user_1 今天午餐吃了牛肉面" }),
        mentions: [{ key: "@_user_1", name: "知食", id: { open_id: "ou_bot" } }],
      }),
    );
    await channel.handleMessage(
      event({
        event_id: "evt-2",
        message_id: "om-2",
        chat_type: "group",
        content: JSON.stringify({ text: "@_user_1 晚上跑了5公里" }),
        mentions: [{ key: "@_user_1", name: "知食", id: { open_id: "ou_bot" } }],
      }, "ou_bob"),
    );

    expect(handleAgent).toHaveBeenNthCalledWith(1, "feishu:chat:oc-group", "[alice] 今天午餐吃了牛肉面");
    expect(handleAgent).toHaveBeenNthCalledWith(2, "feishu:chat:oc-group", "[bob] 晚上跑了5公里");
  });

  it("drops senders outside the allowlist", async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handleAgent = vi.fn().mockResolvedValue("ok");
    const channel = createFeishuChannel({ allowedOpenIds: ["ou_alice"], sendReply, handleAgent });

    await channel.handleMessage(event());
    await channel.handleMessage(event({ event_id: "evt-2" }, "ou_mallory"));

    expect(handleAgent).toHaveBeenCalledTimes(1);
  });

  it("only serves approved group chats, regardless of sender", async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handleAgent = vi.fn().mockResolvedValue("ok");
    const channel = createFeishuChannel({
      allowedOpenIds: ["ou_alice"],
      allowedChatIds: ["oc-agents-team"],
      sendReply,
      handleAgent,
    });

    await channel.handleMessage(
      event({ event_id: "g1", chat_id: "oc-agents-team", chat_type: "group" }, "ou_bob"),
    );
    await channel.handleMessage(
      event({ event_id: "g2", chat_id: "oc-other-group", chat_type: "group" }, "ou_bob"),
    );
    await channel.handleMessage(event({ event_id: "p2p", chat_type: "p2p" }, "ou_bob"));

    expect(handleAgent).toHaveBeenCalledTimes(1);
    expect(handleAgent).toHaveBeenCalledWith(
      "feishu:chat:oc-agents-team",
      "[bob] 今天早餐吃了两个包子",
    );
  });

  it("ignores duplicate events", async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handleAgent = vi.fn().mockResolvedValue("ok");
    const channel = createFeishuChannel({ allowedOpenIds: [], sendReply, handleAgent });

    await channel.handleMessage(event());
    await channel.handleMessage(event());

    expect(handleAgent).toHaveBeenCalledTimes(1);
    expect(sendReply).toHaveBeenCalledTimes(1);
  });

  it("forwards an image message to the agent as a data URL", async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handleAgent = vi.fn().mockResolvedValue("已记录：约 300 千卡");
    const downloadImage = vi.fn().mockResolvedValue("data:image/png;base64,AAAA");
    const channel = createFeishuChannel({ allowedOpenIds: [], sendReply, handleAgent, downloadImage });

    await channel.handleMessage(
      event({ message_type: "image", content: JSON.stringify({ image_key: "img_1" }) }),
    );

    expect(downloadImage).toHaveBeenCalledWith("om-1", "img_1");
    expect(handleAgent).toHaveBeenCalledWith(
      "feishu:user:ou_alice",
      "[图片]",
      ["data:image/png;base64,AAAA"],
    );
  });

  it("replies with a hint when the image cannot be downloaded or images are disabled", async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handleAgent = vi.fn();
    const channel = createFeishuChannel({ allowedOpenIds: [], sendReply, handleAgent });

    await channel.handleMessage(
      event({ message_type: "image", content: JSON.stringify({ image_key: "img_1" }) }),
    );

    expect(handleAgent).not.toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining("图片"));

    const failing = createFeishuChannel({
      allowedOpenIds: [],
      sendReply,
      handleAgent,
      downloadImage: vi.fn().mockRejectedValue(new Error("boom")),
    });
    await failing.handleMessage(
      event({ event_id: "evt-2", message_type: "image", content: JSON.stringify({ image_key: "img_1" }) }),
    );

    expect(sendReply).toHaveBeenLastCalledWith(expect.any(Object), "图片下载失败，请重试。");
  });

  it("rejects unsupported message types with a hint", async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handleAgent = vi.fn();
    const channel = createFeishuChannel({ allowedOpenIds: [], sendReply, handleAgent });

    await channel.handleMessage(
      event({ message_type: "file", content: JSON.stringify({ file_key: "file_1" }) }),
    );

    expect(handleAgent).not.toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining("图片"));
  });

  it("serializes turns within one conversation", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const handleAgent = vi
      .fn()
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        order.push("first");
        return "first reply";
      })
      .mockImplementationOnce(async () => {
        order.push("second");
        return "second reply";
      });

    const channel = createFeishuChannel({
      allowedOpenIds: [],
      sendReply: vi.fn().mockResolvedValue(undefined),
      handleAgent,
    });

    const first = channel.handleMessage(event({ event_id: "a" }));
    const second = channel.handleMessage(event({ event_id: "b" }));

    await Promise.resolve();
    expect(order).toEqual([]);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(order).toEqual(["first", "second"]);
  });

  it("replies with a failure hint when the agent throws", async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handleAgent = vi.fn().mockRejectedValue(new Error("LLM 超时"));
    const channel = createFeishuChannel({ allowedOpenIds: [], sendReply, handleAgent });

    await channel.handleMessage(event());

    expect(sendReply).toHaveBeenCalledWith(expect.any(Object), "处理失败，请稍后重试。");
  });

  it("ignores events without a sender id", async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handleAgent = vi.fn();
    const channel = createFeishuChannel({ allowedOpenIds: [], sendReply, handleAgent });

    await channel.handleMessage({ event_id: "evt-x", message: event().message });

    expect(handleAgent).not.toHaveBeenCalled();
    expect(sendReply).not.toHaveBeenCalled();
  });
});
