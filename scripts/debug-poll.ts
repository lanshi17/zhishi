/**
 * Debug: try to get and reply to a message, handling buf state properly.
 * Run this as a persistent poller until a message arrives.
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
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return env;
}

const env = loadEnv();
const botToken = env.ILINK_BOT_TOKEN!;
const botId = env.ILINK_BOT_ID ?? "";

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
  console.log("=== Persistent Poller ===");
  console.log("Send a message to the bot in WeChat");
  console.log("Press Ctrl+C to stop\n");

  let getUpdatesBuf = "";
  let pollCount = 0;

  while (pollCount < 20) {  // Poll for up to ~2 minutes
    pollCount++;
    const startTime = Date.now();

    try {
      const res = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/getupdates", {
        method: "POST",
        headers: makeHeaders(),
        body: JSON.stringify({
          get_updates_buf: getUpdatesBuf,
          base_info: { channel_version: "1.0.2" },
        }),
      });

      const data = await res.json() as any;
      const elapsed = Date.now() - startTime;

      // Update buf for next call
      if (data.get_updates_buf) {
        getUpdatesBuf = data.get_updates_buf;
      }

      if (data.msgs && data.msgs.length > 0) {
        console.log(`\n[Poll ${pollCount}] Got ${data.msgs.length} message(s) after ${elapsed}ms!`);

        for (const msg of data.msgs) {
          console.log("\n  From:", msg.from_user_id);
          console.log("  Type:", msg.message_type, "State:", msg.message_state);
          console.log("  Context:", msg.context_token?.substring(0, 40) + "...");
          const text = msg.item_list?.[0]?.text_item?.text ?? "";
          console.log("  Text:", text);

          // Try sending reply
          console.log("\n  Sending reply...");
          const replyBody = {
            msg: {
              from_user_id: "",
              to_user_id: msg.from_user_id,
              client_id: botId,
              message_type: 2,
              message_state: 2,
              context_token: msg.context_token,
              item_list: [{ type: 1, text_item: { text: `✅ 收到: "${text}" (botId=${botId})` } }],
            },
            base_info: { channel_version: "1.0.2" },
          };
          console.log("  Body:", JSON.stringify(replyBody).substring(0, 200));

          const replyRes = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/sendmessage", {
            method: "POST",
            headers: makeHeaders(),
            body: JSON.stringify(replyBody),
          });
          const replyData = await replyRes.json() as any;
          console.log("  Reply response:", JSON.stringify(replyData));
        }
        return;  // Got message, exit
      } else {
        process.stdout.write(`[Poll ${pollCount}] No messages (${elapsed}ms) buf=${getUpdatesBuf.substring(0, 20)}...\n`);
      }
    } catch (err) {
      console.error(`[Poll ${pollCount}] Error:`, err);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log("\nStopped after 20 polls without receiving a message");
}

main().catch(console.error);
