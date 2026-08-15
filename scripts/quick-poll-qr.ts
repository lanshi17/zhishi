/**
 * Quick poll for QR scan status and save to .env
 */
import { readFileSync, writeFileSync } from "node:fs";

const QR_CODE = "f9c09bdc93afe3ea3bcf8184ff00c2c5";

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

async function main() {
  console.log("Polling for scan...");

  for (let i = 0; i < 90; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(
        `https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=${QR_CODE}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);
      const data = await res.json() as any;

      if (data.status === "confirmed" && data.bot_token) {
        console.log("\n✅ 扫码成功！");
        console.log("Bot Token:", data.bot_token?.substring(0, 30) + "...");
        console.log("Bot ID:", data.ilink_bot_id);
        console.log("User ID:", data.ilink_user_id);

        const env = loadEnv();
        env.ILINK_BOT_TOKEN = data.bot_token;
        if (data.ilink_bot_id) env.ILINK_BOT_ID = data.ilink_bot_id;
        if (data.ilink_user_id) env.ILINK_USER_ID = data.ilink_user_id;

        const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n");
        writeFileSync(".env", lines + "\n");
        console.log("✅ 已保存到 .env");
        return;
      }

      if (data.status === "expired") {
        console.log("\n❌ 二维码已过期");
        return;
      }

      process.stdout.write(`[${data.status || "waiting"}] `);
    } catch {
      clearTimeout(timeout);
      process.stdout.write(".");
    }

    await new Promise(r => setTimeout(r, 2000));
  }
}

main();
