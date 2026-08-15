import { createDecipheriv } from "node:crypto";

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
const ILINK_CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";

function decryptAesEcb(encrypted: Buffer, aesKeyHex: string): Buffer {
  const key = Buffer.from(aesKeyHex, "hex");
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export type CdnMedia = {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
};

export type IlinkInboundMessage = {
  from_user_id: string;
  to_user_id: string;
  client_id: string;
  message_type: number;
  message_state: number;
  context_token: string;
  item_list: Array<{
    type: number;
    text_item?: { text: string };
    image_item?: {
      media?: CdnMedia;
      thumb_media?: CdnMedia;
      aeskey?: string;
      mid_size?: number;
      thumb_size?: number;
      thumb_width?: number;
      thumb_height?: number;
      hd_size?: number;
    };
  }>;
};

export type IlinkGetUpdatesResult = {
  msgs: IlinkInboundMessage[];
  get_updates_buf: string;
  longpolling_timeout_ms: number;
};

export type IlinkSendMessagePayload = {
  to_user_id: string;
  client_id: string;
  context_token: string;
  item_list: Array<{ type: number; text_item: { text: string } }>;
};

export function createIlinkClient(botToken: string, fetchFn: typeof fetch = globalThis.fetch.bind(globalThis)) {
  function makeHeaders(): Record<string, string> {
    const uin = Buffer.from(String(Math.floor(Math.random() * 4294967295))).toString("base64");
    return {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      "X-WECHAT-UIN": uin,
      Authorization: `Bearer ${botToken}`,
    };
  }

  async function apiPost<T>(path: string, body: unknown): Promise<T> {
    const response = await fetchFn(`${ILINK_BASE_URL}/${path}`, {
      method: "POST",
      headers: makeHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`ilink ${path}: HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }

    return (await response.json()) as T;
  }

  async function apiGet<T>(path: string): Promise<T> {
    const response = await fetchFn(`${ILINK_BASE_URL}/${path}`, {
      method: "GET",
      headers: makeHeaders(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`ilink ${path}: HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }

    return (await response.json()) as T;
  }

  return {
    async getUpdates(getUpdatesBuf: string): Promise<IlinkGetUpdatesResult> {
      return apiPost<IlinkGetUpdatesResult>("ilink/bot/getupdates", {
        get_updates_buf: getUpdatesBuf,
        base_info: { channel_version: "1.0.2" },
      });
    },

    async sendMessage(payload: IlinkSendMessagePayload): Promise<void> {
      const rawResponse = await apiPost<{ ret?: number; errmsg?: string; message_id?: number }>("ilink/bot/sendmessage", {
        msg: {
          from_user_id: "",
          to_user_id: payload.to_user_id,
          client_id: payload.client_id,
          message_type: 2,
          message_state: 2,
          context_token: payload.context_token,
          item_list: payload.item_list,
        },
        base_info: { channel_version: "1.0.2" },
      });
      if (rawResponse.ret !== undefined && rawResponse.ret !== 0) {
        throw new Error(`ilink sendmessage returned ret=${rawResponse.ret}${rawResponse.errmsg ? `: ${rawResponse.errmsg}` : ""}`);
      }
      console.log("[ilink] sendmessage response:", JSON.stringify(rawResponse));
    },

    async getQrCode(): Promise<{ qrcode: string; qrcode_img_content?: string }> {
      return apiGet("ilink/bot/get_bot_qrcode?bot_type=3");
    },

    async getQrCodeStatus(qrcode: string): Promise<{
      status: string;
      bot_token?: string;
      baseurl?: string;
    }> {
      return apiGet(`ilink/bot/get_qrcode_status?qrcode=${qrcode}`);
    },

    async downloadImage(media: CdnMedia, aesKey: string): Promise<Buffer> {
      if (!media.encrypt_query_param) {
        throw new Error("ilink image: missing encrypt_query_param");
      }
      const url = `${ILINK_CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param)}`;
      const response = await fetchFn(url, { method: "GET", headers: makeHeaders() });
      if (!response.ok) {
        throw new Error(`ilink image download failed: HTTP ${response.status}`);
      }
      const encrypted = Buffer.from(await response.arrayBuffer());
      return decryptAesEcb(encrypted, aesKey);
    },
  };
}
