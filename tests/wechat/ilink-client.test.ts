import { describe, expect, it, vi } from "vitest";
import { createIlinkClient } from "../../src/wechat/ilink-client.js";

function mockFetch(response: { ok: boolean; status: number; json: () => Promise<unknown>; text?: () => Promise<string> }) {
  return vi.fn().mockResolvedValue({ text: async () => "", ...response });
}

const botToken = "test-bot-token-12345";

describe("createIlinkClient", () => {
  it("includes correct auth headers in requests", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ msgs: [], get_updates_buf: "buf1" }),
    });
    const client = createIlinkClient(botToken, fetchMock as unknown as typeof fetch);

    await client.getUpdates("");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("ilinkai.weixin.qq.com/ilink/bot/getupdates");
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      Authorization: "Bearer test-bot-token-12345",
    });
    expect(options.headers["X-WECHAT-UIN"]).toBeTruthy();
  });

  it("getUpdates returns messages and new cursor", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        msgs: [
          {
            from_user_id: "user1@im.wechat",
            to_user_id: "bot@im.bot",
            message_type: 1,
            message_state: 2,
            context_token: "ctx-123",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
          },
        ],
        get_updates_buf: "cursor-456",
      }),
    });
    const client = createIlinkClient(botToken, fetchMock as unknown as typeof fetch);

    const result = await client.getUpdates("cursor-0");

    expect(result.msgs).toHaveLength(1);
    expect(result.msgs[0].from_user_id).toBe("user1@im.wechat");
    expect(result.msgs[0].context_token).toBe("ctx-123");
    expect(result.get_updates_buf).toBe("cursor-456");
  });

  it("sendMessage posts with correct payload shape", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ ret: 0 }),
    });
    const client = createIlinkClient(botToken, fetchMock as unknown as typeof fetch);

    await client.sendMessage({
      to_user_id: "user1@im.wechat",
      client_id: "mmassistant_inbox_123",
      context_token: "ctx-123",
      item_list: [{ type: 1, text_item: { text: "reply" } }],
    });

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.msg.to_user_id).toBe("user1@im.wechat");
    expect(body.msg.from_user_id).toBe("");
    expect(body.msg.client_id).toBe("mmassistant_inbox_123");
    expect(body.msg.message_type).toBe(2);
    expect(body.msg.message_state).toBe(2);
    expect(body.msg.context_token).toBe("ctx-123");
    expect(body.msg.item_list[0].text_item.text).toBe("reply");
    expect(body.base_info).toEqual({ channel_version: "1.0.2" });
  });

  it("throws on non-2xx response", async () => {
    const fetchMock = mockFetch({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    const client = createIlinkClient(botToken, fetchMock as unknown as typeof fetch);

    await expect(client.getUpdates("")).rejects.toThrow(/HTTP 401/);
  });

  it("getQrCode returns QR code data", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ qrcode: "qr-abc", qrcode_img_content: "base64..." }),
    });
    const client = createIlinkClient(botToken, fetchMock as unknown as typeof fetch);

    const result = await client.getQrCode();
    expect(result.qrcode).toBe("qr-abc");
  });
});
