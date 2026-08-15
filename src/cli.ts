import { pathToFileURL } from "node:url";
import { bootstrapApplication } from "./app/bootstrap.js";
import { startTuiRuntime } from "./tui/runtime.js";
import qrcode from "qrcode-terminal";

type CliStream = {
  write(chunk: string): unknown;
};

type CliRuntime = Awaited<ReturnType<typeof bootstrapApplication>>;

type CliDeps = {
  env: Record<string, string | undefined>;
  stdout: CliStream;
  stderr: CliStream;
  stdin: typeof process.stdin;
  bootstrapApplication: typeof bootstrapApplication;
  startTuiRuntime: typeof startTuiRuntime;
};

function writeLine(stream: CliStream, line: string) {
  stream.write(`${line}\n`);
}

function usage(stream: CliStream) {
  writeLine(stream, "Usage: wechat-claw <message|approve|reject|tui|login> ...");
  writeLine(stream, "  message <text...>");
  writeLine(stream, "  approve <approvalId>");
  writeLine(stream, "  reject <approvalId> [reason...]");
  writeLine(stream, "  tui");
  writeLine(stream, "  login");
}

async function getThreadStatus(runtime: CliRuntime, approvalId: string): Promise<string | undefined> {
  const approval = await runtime.taskService.getPendingApproval?.(approvalId);
  if (!approval) {
    return undefined;
  }

  const thread = await runtime.taskService.getThread?.(approval.threadId);
  return thread?.status;
}

export async function runCli(argv: string[], deps: Partial<CliDeps> = {}) {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const stdin = deps.stdin ?? process.stdin;
  const runBootstrap = deps.bootstrapApplication ?? bootstrapApplication;
  const runTui = deps.startTuiRuntime ?? startTuiRuntime;
  const [command, ...rest] = argv;

  if (!command || !["message", "approve", "reject", "tui", "login"].includes(command)) {
    usage(stderr);
    return 1;
  }

  if (command === "tui" && rest.length > 0) {
    usage(stderr);
    return 1;
  }

  if (command === "login") {
    const ILINK_BASE = "https://ilinkai.weixin.qq.com";
    writeLine(stdout, "Requesting QR code from iLink...");

    try {
      const qrResp = await fetch(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=3`);
      if (!qrResp.ok) {
        writeLine(stderr, `Login failed: QR code request returned HTTP ${qrResp.status}`);
        return 1;
      }
      const qrData = (await qrResp.json()) as { qrcode: string; qrcode_img_content?: string };
      const scanUrl = qrData.qrcode_img_content ?? `${ILINK_BASE}/ilink/qrcode?qrcode=${qrData.qrcode}`;

      writeLine(stdout, "");
      qrcode.generate(scanUrl, { small: true }, (qr: string) => { stdout.write(qr); });
      writeLine(stdout, "");
      writeLine(stdout, `Scan URL: ${scanUrl}`);
      writeLine(stdout, "Scan the QR code with WeChat. Waiting...");

      let botToken: string | undefined;
      let attempts = 0;
      while (!botToken && attempts < 90) {
        await new Promise((r) => setTimeout(r, 2000));
        attempts++;
        const statusResp = await fetch(`${ILINK_BASE}/ilink/bot/get_qrcode_status?qrcode=${qrData.qrcode}`);
        if (!statusResp.ok) continue;
        const statusData = (await statusResp.json()) as { status: string; bot_token?: string };
        if (statusData.status === "confirmed" && statusData.bot_token) {
          botToken = statusData.bot_token;
        } else if (statusData.status !== "pending" && statusData.status !== "waiting_confirm") {
          writeLine(stdout, `QR status: ${statusData.status}`);
        }
      }

      if (!botToken) {
        writeLine(stderr, "Login timed out. Please try again.");
        return 1;
      }

      writeLine(stdout, "");
      writeLine(stdout, "Login successful!");
      writeLine(stdout, `Bot token: ${botToken}`);
      writeLine(stdout, "Add this to your .env file:");
      writeLine(stdout, `  ILINK_BOT_TOKEN=${botToken}`);
      return 0;
    } catch (err) {
      writeLine(stderr, `Login error: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  const runtime = await runBootstrap({ env });

  if (command === "tui") {
    runTui(runtime, { stdin, stdout });
    return 0;
  }

  if (command === "message") {
    if (rest.length === 0) {
      usage(stderr);
      return 1;
    }

    const text = rest.join(" ");
    const fromUserId = env.ADMIN_USER_ID ?? "wxid_admin";
    runtime.setCurrentMessage({
      fromUserId,
      text,
    });
    await runtime.app.handleAdminMessage({
      fromUserId,
      text,
      contextToken: "cli-message",
    });
    writeLine(stdout, `Message submitted: ${text}`);
    return 0;
  }

  const approvalId = rest[0];
  if (!approvalId) {
    usage(stderr);
    return 1;
  }

  if (command === "approve") {
    await runtime.app.resumeApproval(approvalId);
    const status = await getThreadStatus(runtime, approvalId);
    writeLine(stdout, `Approval ${approvalId} approved.`);
    if (status) {
      writeLine(stdout, `Final thread status: ${status}`);
    }
    return 0;
  }

  const reason = rest.slice(1).join(" ") || undefined;
  await runtime.app.rejectApproval(approvalId, reason);
  const status = await getThreadStatus(runtime, approvalId);
  writeLine(stdout, `Approval ${approvalId} rejected.${reason ? ` Reason: ${reason}` : ""}`);
  if (status) {
    writeLine(stdout, `Final thread status: ${status}`);
  }
  return 0;
}

async function main() {
  try {
    const exitCode = await runCli(process.argv.slice(2));
    process.exitCode = exitCode;
  } catch (error) {
    if (error instanceof Error) {
      console.error("✗ CLI failed:", error.message);
    } else {
      console.error("✗ CLI failed:", String(error));
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
