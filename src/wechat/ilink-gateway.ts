import type { InboundWeChatMessage } from "./types.js";
import type { createIlinkClient, IlinkInboundMessage } from "./ilink-client.js";

type IlinkClient = ReturnType<typeof createIlinkClient>;

export function createIlinkWeChatGateway(deps: {
  adminUserId: string;
  ilinkClient: IlinkClient;
  onMessage: (message: InboundWeChatMessage) => Promise<void> | void;
}) {
  const contextTokens = new Map<string, string>();
  let polling = false;
  let getUpdatesBuf = "";

  async function extractImages(msg: IlinkInboundMessage): Promise<string[]> {
    const imageUrls: string[] = [];
    for (const item of msg.item_list ?? []) {
      if (item.type === 2 && item.image_item) {
        try {
          const media = item.image_item.media ?? item.image_item.thumb_media;
          const aesKey = item.image_item.aeskey ?? media?.aes_key;
          if (media && aesKey) {
            const decrypted = await deps.ilinkClient.downloadImage(media, aesKey);
            const base64 = decrypted.toString("base64");
            imageUrls.push(`data:image/jpeg;base64,${base64}`);
          }
        } catch (err) {
          console.error("[ilink] image download/decrypt failed:", err);
        }
      }
    }
    return imageUrls;
  }

  async function poll() {
    while (polling) {
      try {
        const result = await deps.ilinkClient.getUpdates(getUpdatesBuf);
        getUpdatesBuf = result.get_updates_buf ?? getUpdatesBuf;

        for (const msg of result.msgs ?? []) {
          if (msg.message_type !== 1) continue;

          // Extract text and images from item_list
          let text = "";
          for (const item of msg.item_list ?? []) {
            if (item.text_item?.text) {
              text += item.text_item.text;
            }
          }
          const imageUrls = await extractImages(msg);
          if (!text && imageUrls.length === 0) continue;

          contextTokens.set(msg.from_user_id, msg.context_token);

          const inbound: InboundWeChatMessage = {
            fromUserId: msg.from_user_id,
            text: text || "[图片]",
            contextToken: msg.context_token,
            clientId: msg.client_id,
            imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
          };

          if (inbound.fromUserId === deps.adminUserId) {
            await deps.onMessage(inbound);
          } else {
            console.log(`[ilink] ignored message from non-admin user: ${inbound.fromUserId} (text: ${inbound.text.slice(0, 50)})`);
          }
        }
      } catch (_err) {
        // Polling error — wait briefly and retry
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  return {
    start() {
      polling = true;
      poll();
    },

    stop() {
      polling = false;
    },

    handleInbound(message: InboundWeChatMessage) {
      contextTokens.set(message.fromUserId, message.contextToken);
      return deps.onMessage(message);
    },

    getContextToken(userId: string): string | undefined {
      return contextTokens.get(userId);
    },
  };
}
