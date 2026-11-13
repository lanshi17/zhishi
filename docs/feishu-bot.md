# 飞书机器人接入（群聊 + 单聊）

用飞书自建应用的机器人能力接收消息，走**长连接事件订阅**（不需要公网 IP / 回调 URL），
把群聊里 @机器人 的消息交给现有健康 agent，并在同一条消息下回复。

## 为什么是飞书

| 渠道 | 群聊 | 需要公网回调 | 说明 |
| --- | --- | --- | --- |
| 微信服务号 | ❌ 公众号不能进群 | 是 | 只有按 OpenID 的 1:1 会话 |
| 企业微信智能机器人 | ✅ | 是（回调模式） | 也可用长连接，但生态偏企业内部 |
| **飞书自建应用机器人** | ✅ | **否（长连接）** | 官方 SDK，单聊 / 群聊 / 图片 / 卡片都支持 |
| 现有 iLink 微信机器人 | ❌ 无群会话字段 | 否（轮询） | 个人号形态，仅 1:1 |

## 一、创建飞书应用

1. 打开 [飞书开放平台](https://open.feishu.cn/app)，创建**企业自建应用**。
2. 「添加应用能力」→ 添加 **机器人**。
3. 「权限管理」开通（最小集合，按需增补）：
   - `im:message`（读取与发送单聊、群聊消息）或分别开通
     `im:message.p2p_msg:readonly`、`im:message.group_at_msg:readonly`、`im:message:send_as_bot`
   - 若要让机器人把用户拉进群：`im:chat` 或 `im:chat.members:write_only`
4. 「事件与回调」→ 订阅方式选择 **使用长连接接收事件**，添加事件
   `im.message.receive_v1`（接收消息）。
5. 「版本管理与发布」创建版本并发布，把应用可用范围配置为需要使用机器人的成员。

> 群聊里默认只有 **@机器人** 的消息会推送给应用；要接收群内全部消息需要额外申请
> 「获取群组中所有消息」权限（`im:message.group_msg`），一般不建议。

## 二、配置环境变量

```bash
FEISHU_ENABLED=true
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxx
# 单聊白名单：逗号分隔的发送者 open_id；留空 = 企业内所有可见成员
FEISHU_ALLOWED_OPEN_IDS=
# 群聊白名单：逗号分隔的 chat_id；留空 = 机器人所在的每个群都可用
FEISHU_ALLOWED_CHAT_IDS=
```

访问控制语义：

- **单聊**按发送者 `open_id` 判断，不在白名单则静默忽略；
- **群聊**按 `chat_id` 判断，只要群在白名单内，群里**任何成员** @机器人都能触发（不再看发送者白名单），
  这样团队群里其他人也能用；
- 不在白名单的群/人不会收到任何回复，只在日志里留下 `feishu group not allowed` / `feishu sender not allowed`。

`FEISHU_ENABLED` 未显式设为 `false` 且 `FEISHU_APP_ID`/`FEISHU_APP_SECRET` 都存在时，渠道视为启用。

## 三、启动

```bash
bun run start:feishu
```

启动后进程只运行飞书长连接 + agent，不启动 TUI；日志写入 `logs/YYYY-MM-DD_HHMMSS.log`。
SIGINT/SIGTERM 会关闭长连接与数据库连接池。

## 四、把机器人拉进群

1. 群聊 → 设置 → 群机器人 → 添加机器人（手动方式）；或
2. 用脚本按 App ID 把机器人拉进群（需要机器人已在群内或你有群管理权限）：

```bash
bun scripts/feishu-add-bot-to-chat.ts oc_xxxxxxxxxxxxxxxx [ou_xxxx ou_yyyy]
```

脚本调用
[将用户或机器人拉入群聊](https://open.feishu.cn/document/server-docs/group/chat-member/create)：
`POST /open-apis/im/v1/chats/:chat_id/members`，`member_id_type=app_id` 时 `id_list`
填应用的 App ID；追加的参数按 `open_id` 拉入用户。

进群后 @机器人 说「今天早餐吃了两个包子」即可；agent 的回复会以 **回复该消息** 的形式
出现在群里。

## 五、会话语义

- **群聊**：整个群共用一个会话键 `feishu:chat:<chat_id>`，对话历史与饮食/运动记录都归到
  这个键下；转发给模型的消息带 `[发言者标识]` 前缀（Open ID 去掉 `ou_` 前缀后的后 6 位）。
  效果是「一群一账本」，适合家庭/团队共用一个热量记录。
- **单聊**：每个用户独立会话键 `feishu:user:<open_id>`。
- 同一会话的消息串行处理，慢回复不会和下一轮交叠；回调按 `event_id` 去重（10 分钟窗口）。
- **图片**：单聊/群聊里发送图片会经 `im/v1/messages/:message_id/resources` 下载并以 data URL
  交给视觉模型，可直接拍食物照片记账；其他类型（文件/语音/视频）回提示，不进入 agent。

## 六、限制与注意事项

- 飞书机器人向同一群发消息限频 5 QPS（群内机器人共享）；agent 回复通常远低于此。
- 回复用 `im/v1/messages/:message_id/reply`，内容为纯文本（单条上限约 150 KB，
  客户端按 30,000 字符截断）。
- 图片识别需要视觉模型：`LLM_SUPPORTS_IMAGE_INPUT=true` 且 `LLM_VISION_MODEL` 指向支持
  图片输入且**支持 function calling** 的模型（实测 `Qwen/Qwen3.5-35B-A3B` 两者兼备；
  `Qwen3-VL-*` 系列能看图但不返回 tool_calls，会被 agent 的「必须调用工具」约束拒绝）。
- 健康 agent 要求模型至少调用一次工具后才给出最终回复，因此与健康无关的闲聊会收到
  「处理失败」提示；这是现有 agent 的约束，不是飞书渠道的问题。
- 长连接依赖 `@larksuiteoapi/node-sdk` 的 `WSClient`（自动重连）；进程退出后飞书侧不会保留事件。

## 七、排障

| 现象 | 原因 / 处理 |
| --- | --- |
| 启动报 `Feishu channel not configured` | 缺 `FEISHU_APP_ID`/`FEISHU_APP_SECRET`，或 `FEISHU_ENABLED=false` |
| 日志无 `feishu long connection ready` | 应用未发布、事件订阅未选长连接、或网络无法访问开放平台 |
| 发消息无响应 | 群里没 @机器人；或该群不在 `FEISHU_ALLOWED_CHAT_IDS`、单聊发送者不在 `FEISHU_ALLOWED_OPEN_IDS`；或发送者不在应用可用范围 |
| `code=230002` | 机器人不在该群：先用脚本或群设置把机器人拉进群 |
| `code=230013` | 用户不在机器人可用范围：在开发者后台调整并重新发布 |
| `code=99992351` | `open_id` 不属于当前应用：用 API Explorer 重新获取 |

## 相关代码

- `src/feishu/protocol.ts` — 事件解析、@ 占位符清理、会话键
- `src/feishu/channel.ts` — 白名单、去重、串行化、群/单聊转发
- `src/feishu/client.ts` — 回复消息（`im.message.reply`）
- `src/feishu/runtime.ts` — 长连接事件订阅（`WSClient` + `EventDispatcher`）
- `src/feishu-main.ts` — 独立入口 `bun run start:feishu`
- `scripts/feishu-add-bot-to-chat.ts` — 把机器人拉进群
