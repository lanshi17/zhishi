/**
 * Debug script: test iLink sendmessage to verify reply delivery.
 * 1. Get updates (with timeout) to get a fresh context_token
 * 2. Send a test reply
 * 3. Log the full response
 *
 * Usage:
 *   npx tsx scripts/debug-ilink.ts
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
const botToken = env.ILINK_BOT_TOKEN;
if (!botToken) {
  console.error("ILINK_BOT_TOKEN not found in .env");
  process.exit(1);
}

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
  console.log("=== iLink Debug ===\n");
  console.log("Bot token:", botToken.substring(0, 20) + "...");

  // Step 1: Get updates with a short timeout (10s)
  console.log("\n1. Getting updates (10s timeout)...");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

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

    console.log("Status:", res.status);
    const data = await res.json() as any;
    console.log("\nFull response:");
    console.log(JSON.stringify(data, null, 2));

    if (data.msgs && data.msgs.length > 0) {
      console.log(`\n2. Found ${data.msgs.length} message(s)`);
      for (const msg of data.msgs) {
        console.log("\n  From:", msg.from_user_id);
        console.log("  Type:", msg.message_type);
        console.log("  State:", msg.message_state);
        console.log("  Context token:", msg.context_token?.substring(0, 30) + "...");
        console.log("  Items:", JSON.stringify(msg.item_list));

        // Step 2: Try to send a reply
        console.log("\n3. Sending test reply...");
        const replyRes = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/sendmessage", {
          method: "POST",
          headers: makeHeaders(),
          body: JSON.stringify({
            msg: {
              to_user_id: msg.from_user_id,
              message_type: 1,
              message_state: 1,
              context_token: msg.context_token,
              item_list: [{ type: 1, text_item: { text: "🤖 测试回复 - 收到你的消息了！" } }],
            },
          }),
        });
        console.log("  Reply status:", replyRes.status);
        const replyData = await replyRes.json() as any;
        console.log("  Reply response:", JSON.stringify(replyData));
      }
    } else {
      console.log("\nNo messages found. Send a message to the bot in WeChat first.");
      console.log("get_updates_buf:", data.get_updates_buf?.substring(0, 50) + "...");
    }
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      console.log("Timeout - no messages received in 10 seconds.");
      console.log("This is normal if no one sent a message.");
    } else {
      console.error("Error:", err);
    }
  }
}

main();
