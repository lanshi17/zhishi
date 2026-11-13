import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createFeishuMessenger, truncateText, type FeishuSdkClient } from "../../src/feishu/client.js";

function fakeClient(
  reply: ReturnType<typeof vi.fn>,
  get: ReturnType<typeof vi.fn> = vi.fn(),
): FeishuSdkClient {
  return { im: { message: { reply }, messageResource: { get } } };
}

describe("createFeishuMessenger", () => {
  it("replies to the message with a text payload", async () => {
    const reply = vi.fn().mockResolvedValue({ code: 0, msg: "success" });
    const messenger = createFeishuMessenger({ appId: "cli_x", appSecret: "secret", client: fakeClient(reply) });

    await messenger.replyText("om-1", "已记录：300 千卡");

    expect(reply).toHaveBeenCalledWith({
      path: { message_id: "om-1" },
      data: { content: JSON.stringify({ text: "已记录：300 千卡" }), msg_type: "text" },
    });
  });

  it("downloads an image attachment as a data URL", async () => {
    const get = vi.fn().mockResolvedValue({
      getReadableStream: () => Readable.from([Buffer.from([0xff, 0xd8, 0xff])]),
      headers: { "content-type": "image/jpeg; charset=binary" },
    });
    const messenger = createFeishuMessenger({
      appId: "cli_x",
      appSecret: "secret",
      client: fakeClient(vi.fn(), get),
    });

    const dataUrl = await messenger.downloadImage("om-1", "img_v2_key");

    expect(get).toHaveBeenCalledWith({
      params: { type: "image" },
      path: { message_id: "om-1", file_key: "img_v2_key" },
    });
    expect(dataUrl).toBe("data:image/jpeg;base64,/9j/");
  });

  it("throws when the api returns a non-zero code", async () => {
    const reply = vi.fn().mockResolvedValue({ code: 230002, msg: "bot not in group" });
    const messenger = createFeishuMessenger({ appId: "cli_x", appSecret: "secret", client: fakeClient(reply) });

    await expect(messenger.replyText("om-1", "hi")).rejects.toThrow(/230002/);
  });
});

describe("truncateText", () => {
  it("keeps short content intact", () => {
    expect(truncateText("short")).toBe("short");
  });

  it("truncates long content and marks it", () => {
    const truncated = truncateText("热".repeat(1_000), 100);

    expect(truncated.startsWith("热".repeat(100))).toBe(true);
    expect(truncated.endsWith("（内容过长已截断）")).toBe(true);
  });
});
