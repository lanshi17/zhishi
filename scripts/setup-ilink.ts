/**
 * iLink Bot setup script:
 * 1. Get QR code URL
 * 2. Display QR code for scanning
 * 3. Poll status until confirmed
 * 4. Save bot token to .env
 * 5. Optionally start the app
 *
 * Usage:
 *   npx tsx scripts/setup-ilink.ts [--start]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { exec } from "node:child_process";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const envPath = ".env";
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key) env[key] = val;
    }
  }
  return env;
}

async function getQrCode(): Promise<{ qrcode: string; url: string }> {
  const res = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3");
  const data = await res.json() as { qrcode: string; qrcode_img_content: string; ret: number };
  if (data.ret !== 0) {
    throw new Error(`Failed to get QR code: ret=${data.ret}`);
  }
  return {
    qrcode: data.qrcode,
    url: data.qrcode_img_content,
  };
}

async function checkQrStatus(qrcode: string): Promise<{ status: string; bot_token?: string; ilink_bot_id?: string; ilink_user_id?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(
      `https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=${qrcode}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      return { status: "error" };
    }

    const data = await res.json() as { status: string; bot_token?: string; ilink_bot_id?: string; ilink_user_id?: string; ret?: number };
    return {
      status: data.status || (data.ret === 0 ? "pending" : "error"),
      bot_token: data.bot_token,
      ilink_bot_id: data.ilink_bot_id,
      ilink_user_id: data.ilink_user_id,
    };
  } catch (err) {
    clearTimeout(timeout);
    return { status: "timeout" };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const shouldStart = args.includes("--start");

  console.log("=== iLink Bot 设置 ===\n");

  console.log("1. 获取二维码...");
  const { qrcode, url } = await getQrCode();
  console.log("✅ 二维码获取成功\n");
  console.log(`二维码 ID: ${qrcode}`);
  console.log(`\n📱 请在微信中扫描以下链接：`);
  console.log(`   ${url}\n`);

  // Try to open in browser
  try {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    exec(`${cmd} "${url}"`);
    console.log("（已在浏览器中打开）\n");
  } catch {
    console.log("（请手动在浏览器中打开上述链接）\n");
  }

  console.log("2. 等待扫码确认（最长 3 分钟）...\n");

  let attempts = 0;
  const maxAttempts = 90; // 3 minutes (90 * 2s)
  let lastStatus = "";

  while (attempts < maxAttempts) {
    const { status, bot_token, ilink_bot_id, ilink_user_id } = await checkQrStatus(qrcode);

    if (status === "confirmed" && bot_token) {
      console.log("\n✅ 扫码确认成功！");
      console.log(`Bot Token: ${bot_token.substring(0, 20)}...`);
      if (ilink_bot_id) console.log(`Bot ID: ${ilink_bot_id}`);
      if (ilink_user_id) console.log(`User ID: ${ilink_user_id}`);

      // Update .env file
      const env = loadEnv();
      env.ILINK_BOT_TOKEN = bot_token;
      if (ilink_bot_id) env.ILINK_BOT_ID = ilink_bot_id;
      if (ilink_user_id) env.ILINK_USER_ID = ilink_user_id;

      const envLines = Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");
      writeFileSync(".env", envLines + "\n");
      console.log("\n✅ Token 已保存到 .env");

      if (shouldStart) {
        console.log("\n3. 启动应用...");
        const { runMainEntrypoint } = await import("../src/main-entrypoint.js");
        await runMainEntrypoint();
      } else {
        console.log("\n现在可以运行: npm run start:wechat");
      }
      return;
    }

    if (status !== lastStatus) {
      console.log(`   状态: ${status}`);
      lastStatus = status;
    } else {
      process.stdout.write(".");
    }

    await sleep(2000);
    attempts++;
  }

  console.log("\n\n⏰ 超时（3分钟），请重新运行脚本");
  process.exit(1);
}

main().catch((err) => {
  console.error("\n❌ 设置失败:", err instanceof Error ? err.message : err);
  console.log("\n提示：");
  console.log("- 确保网络连接正常");
  console.log("- 确保微信可以访问腾讯 iLink 平台");
  console.log("- 参考: https://cloud.tencent.com/developer/article/2651968");
  process.exit(1);
});
