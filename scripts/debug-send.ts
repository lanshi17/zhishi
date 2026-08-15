/**
 * Debug: get fresh message and try sending reply with different formats.
 * Logs everything for diagnosis.
 *
 * Usage:
 *   1. Send a message to the bot in WeChat first
 *   2. npx tsx scripts/debug-send.ts
 */
import { readFileSync } from "node:fs";

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const content = readFileSync(".env", "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key) env[key] = val;
  }
  return env;
}

const env = loadEnv();
const botToken = env.ILINK_BOT_TOKEN!;
const botId = env.ILINK_BOT_ID ?? "";
const adminUserId = env.ADMIN_USER_ID ?? "";

console.log("=== Debug Send ===");
console.log("Bot Token:", botToken.substring(0, 30) + "...");
console.log("Bot ID:", botId);
console.log("Admin User ID:", adminUserId);

function makeHeaders() {
  const uin = Buffer.from(String(Math.floor(Math.random() * 4294967295))).toString("base64");
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": uin,
    Authorization: `Bearer ${botToken}`,
  };
}

async function main() {
  // Step 1: Get updates - wait up to 30s for a message
  console.log("\n1. Waiting for message (30s timeout)...");
  console.log("   → Send a message to the bot in WeChat NOW");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let msgs: any[] = [];
  try {
    const res = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/getupdates", {
      method: "POST",
      headers: makeHeaders(),
      body: JSON.stringify({
        get_updates_buf: "",
        base_info: { channel_version: "1.0.2" },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json() as any;
    console.log("\n   getUpdates response:", JSON.stringify(data, null, 2).substring(0, 500));
    msgs = data.msgs ?? [];
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      console.log("   Timeout - no messages received");
    } else {
      console.error("   Error:", err);
    }
    return;
  }

  if (msgs.length === 0) {
    console.log("   No messages to reply to");
    return;
  }

  const msg = msgs[0];
  console.log("\n2. Received message:");
  console.log("   from_user_id:", msg.from_user_id);
  console.log("   to_user_id:", msg.to_user_id);
  console.log("   message_type:", msg.message_type);
  console.log("   message_state:", msg.message_state);
  console.log("   context_token:", msg.context_token);
  console.log("   item_list:", JSON.stringify(msg.item_list));

  const text = msg.item_list?.[0]?.text_item?.text ?? "";
  console.log("   text:", text);

  // Try different send formats
  const formats = [
    {
      name: "Format A: type=2, state=2, from='', client_id=botId",
      body: {
        msg: {
          from_user_id: "",
          to_user_id: msg.from_user_id,
          client_id: botId,
          message_type: 2,
          message_state: 2,
          context_token: msg.context_token,
          item_list: [{ type: 1, text_item: { text: `[A] 回复测试: "${text}"` } }],
        },
        base_info: { channel_version: "1.0.2" },
      },
    },
    {
      name: "Format B: type=1, state=1, from='', client_id=botId",
      body: {
        msg: {
          from_user_id: "",
          to_user_id: msg.from_user_id,
          client_id: botId,
          message_type: 1,
          message_state: 1,
          context_token: msg.context_token,
          item_list: [{ type: 1, text_item: { text: `[B] 回复测试: "${text}"` } }],
        },
      },
    },
    {
      name: "Format C: type=2, state=2, from=botId, client_id=botId",
      body: {
        msg: {
          from_user_id: botId,
          to_user_id: msg.from_user_id,
          client_id: botId,
          message_type: 2,
          message_state: 2,
          context_token: msg.context_token,
          item_list: [{ type: 1, text_item: { text: `[C] 回复测试: "${text}"` } }],
        },
        base_info: { channel_version: "1.0.2" },
      },
    },
    {
      name: "Format D: type=2, state=1, no from_user_id",
      body: {
        msg: {
          to_user_id: msg.from_user_id,
          client_id: botId,
          message_type: 2,
          message_state: 1,
          context_token: msg.context_token,
          item_list: [{ type: 1, text_item: { text: `[D] 回复测试: "${text}"` } }],
        },
      },
    },
  ];

  for (const fmt of formats) {
    console.log(`\n3. Trying ${fmt.name}...`);
    console.log("   Request body:", JSON.stringify(fmt.body).substring(0, 300));

    try {
      const res = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/sendmessage", {
        method: "POST",
        headers: makeHeaders(),
        body: JSON.stringify(fmt.body),
      });
      const data = await res.json() as any;
      console.log("   Response:", JSON.stringify(data));
    } catch (err) {
      console.error("   Error:", err);
    }

    // Wait 1s between attempts
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log("\n4. Done. Check WeChat for replies [A], [B], [C], [D]");
}

main().catch(console.error);
