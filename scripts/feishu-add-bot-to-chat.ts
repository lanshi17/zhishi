/**
 * Adds this bot (and optionally users) to a Feishu group chat.
 *
 * https://open.feishu.cn/document/server-docs/group/chat-member/create
 *
 * Usage:
 *   bun scripts/feishu-add-bot-to-chat.ts <chat_id> [open_id ...]
 *
 * Requires FEISHU_APP_ID / FEISHU_APP_SECRET in the environment. The calling
 * app must have bot capability, be in the group, and hold `im:chat` or
 * `im:chat.members:write_only`.
 */
import { Client } from "@larksuiteoapi/node-sdk";

async function main() {
  const [chatId, ...userOpenIds] = process.argv.slice(2);
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!chatId) {
    throw new Error("Usage: bun scripts/feishu-add-bot-to-chat.ts <chat_id> [open_id ...]");
  }
  if (!appId || !appSecret) {
    throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET must be set");
  }

  const client = new Client({ appId, appSecret });

  const botResult = await client.im.chatMembers.create(
    {
      path: { chat_id: chatId },
      params: { member_id_type: "app_id", succeed_type: 1 },
      data: { id_list: [appId] },
    },
  );

  if (botResult.code) {
    throw new Error(`failed to add bot: code=${botResult.code} msg=${botResult.msg ?? "?"}`);
  }
  console.log(`bot ${appId} added to ${chatId}`);

  if (userOpenIds.length > 0) {
    const userResult = await client.im.chatMembers.create(
      {
        path: { chat_id: chatId },
        params: { member_id_type: "open_id", succeed_type: 1 },
        data: { id_list: userOpenIds },
      },
    );

    if (userResult.code) {
      throw new Error(`failed to add users: code=${userResult.code} msg=${userResult.msg ?? "?"}`);
    }
    console.log(`users added: ${userOpenIds.join(", ")}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
