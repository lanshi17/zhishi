import { describe, expect, it, vi } from "vitest";
import { createIlinkWeChatGateway } from "../../src/wechat/ilink-gateway.js";

describe("createIlinkWeChatGateway", () => {
  it("sends inbound messages to onMessage for admin user", async () => {
    const onMessage = vi.fn();
    const ilinkClient = {
      getUpdates: vi.fn().mockResolvedValueOnce({
        msgs: [
          {
            from_user_id: "wxid_admin",
            to_user_id: "bot@im.bot",
            message_type: 1,
            message_state: 2,
            context_token: "ctx-1",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
          },
        ],
        get_updates_buf: "cursor-1",
      }),
      sendMessage: vi.fn(),
      getQrCode: vi.fn(),
      getQrCodeStatus: vi.fn(),
      downloadImage: vi.fn(),
    };

    const gw = createIlinkWeChatGateway({
      adminUserId: "wxid_admin",
      ilinkClient,
      onMessage,
    });

    await gw.handleInbound({
      fromUserId: "wxid_admin",
      text: "hello",
      contextToken: "ctx-1",
    });

    expect(onMessage).toHaveBeenCalledWith({
      fromUserId: "wxid_admin",
      text: "hello",
      contextToken: "ctx-1",
    });
  });

  it("stores context token per user", async () => {
    const ilinkClient = {
      getUpdates: vi.fn(),
      sendMessage: vi.fn(),
      getQrCode: vi.fn(),
      getQrCodeStatus: vi.fn(),
      downloadImage: vi.fn(),
    };

    const gw = createIlinkWeChatGateway({
      adminUserId: "wxid_admin",
      ilinkClient,
      onMessage: vi.fn(),
    });

    await gw.handleInbound({
      fromUserId: "user1@im.wechat",
      text: "hi",
      contextToken: "ctx-abc",
    });

    expect(gw.getContextToken("user1@im.wechat")).toBe("ctx-abc");
    expect(gw.getContextToken("unknown")).toBeUndefined();
  });

  it("starts and stops polling", () => {
    const ilinkClient = {
      getUpdates: vi.fn().mockResolvedValue({ msgs: [], get_updates_buf: "" }),
      sendMessage: vi.fn(),
      getQrCode: vi.fn(),
      getQrCodeStatus: vi.fn(),
      downloadImage: vi.fn(),
    };

    const gw = createIlinkWeChatGateway({
      adminUserId: "wxid_admin",
      ilinkClient,
      onMessage: vi.fn(),
    });

    gw.start();
    expect(ilinkClient.getUpdates).toHaveBeenCalled();

    gw.stop();
  });
});
