/**
 * Deep debug: capture full inbound message structure and test send formats.
 * Logs the COMPLETE inbound JSON so we can inspect all fields.
 */
import { readFileSync } from "node:fs";

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const content = readFileSync(".env", "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    env[trimmed.slice(0, trimmed.indexOf("=")).trim()] = trimmed.slice(trimmed.indexOf("=") + 1).trim();
  }
  return env;
}

const env = loadEnv();
const botToken = env.ILINK_BOT_TOKEN!;
const botId = env.ILINK_BOT_ID ?? "";

function hdr() {
  const uin = Buffer.from(String(Math.floor(Math.random() * 4294967295))).toString("base64");
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": uin,
    Authorization: `Bearer ${botToken}`,
  };
}

async function main() {
  console.log("=== Deep Debug ===");
  console.log("Bot ID:", botId);
  console.log("Send a message to the bot in WeChat NOW\n");

  // Get updates with 30s timeout
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/getupdates", {
      method: "POST",
      headers: hdr(),
      body: JSON.stringify({ get_updates_buf: "", base_info: { channel_version: "1.0.2" } }),
      signal: controller.signal,
    });
    clearTimeout(t);
    const data = await res.json() as any;
    console.log("\n=== FULL getUpdates RESPONSE ===");
    console.log(JSON.stringify(data, null, 2));

    const msgs = data.msgs ?? [];
    if (msgs.length === 0) {
      console.log("\nNo messages. Try again.");
      return;
    }

    const msg = msgs[0];
    console.log("\n=== INBOUND MESSAGE (full) ===");
    console.log(JSON.stringify(msg, null, 2));

    const toUserId = msg.to_user_id;
    const fromUserId = msg.from_user_id;
    const ctx = msg.context_token;

    console.log("\n=== Sending test replies ===");
    console.log(`to_user_id (inbound): ${toUserId}`);
    console.log(`from_user_id (inbound): ${fromUserId}`);

    // Try 3 formats
    const attempts = [
      {
        label: "A: to=from(inbound), type=2,st=2, from='', client=botId",
        body: {
          msg: {
            from_user_id: "",
            to_user_id: fromUserId,
            client_id: botId,
            message_type: 2,
            message_state: 2,
            context_token: ctx,
            item_list: [{ type: 1, text_item: { text: "[A] 测试回复送达" } }],
          },
          base_info: { channel_version: "1.0.2" },
        },
      },
      {
        label: "B: to=from(inbound), type=1,st=1",
        body: {
          msg: {
            from_user_id: "",
            to_user_id: fromUserId,
            client_id: botId,
            message_type: 1,
            message_state: 1,
            context_token: ctx,
            item_list: [{ type: 1, text_item: { text: "[B] 测试回复送达" } }],
          },
        },
      },
      {
        label: "C: to=to(inbound), type=2,st=2",
        body: {
          msg: {
            from_user_id: "",
            to_user_id: toUserId,
            client_id: botId,
            message_type: 2,
            message_state: 2,
            context_token: ctx,
            item_list: [{ type: 1, text_item: { text: "[C] 测试回复送达" } }],
          },
          base_info: { channel_version: "1.0.2" },
        },
      },
      {
        label: "D: with from=botId, to=from(inbound)",
        body: {
          msg: {
            from_user_id: botId,
            to_user_id: fromUserId,
            client_id: botId,
            message_type: 2,
            message_state: 2,
            context_token: ctx,
            item_list: [{ type: 1, text_item: { text: "[D] 测试回复送达" } }],
          },
          base_info: { channel_version: "1.0.2" },
        },
      },
    ];

    for (const a of attempts) {
      console.log(`\n--- ${a.label} ---`);
      console.log("Body:", JSON.stringify(a.body).substring(0, 250));
      try {
        const r = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/sendmessage", {
          method: "POST",
          headers: hdr(),
          body: JSON.stringify(a.body),
        });
        const rd = await r.json() as any;
        console.log("HTTP:", r.status, "Response:", JSON.stringify(rd));
      } catch (e) {
        console.log("Error:", e);
      }
      await new Promise(r => setTimeout(r, 1500));
    }
    console.log("\n4. Check WeChat for [A][B][C][D] replies");
  } catch (err) {
    clearTimeout(t);
    if (err instanceof Error && err.name === "AbortError") {
      console.log("Timeout - no message received");
    } else {
      console.error("Error:", err);
    }
  }
}

main();