import { pathToFileURL } from "node:url";
import { bootstrapApplication } from "./app/bootstrap.js";

type SmokeStream = {
  write(chunk: string): unknown;
};

type SmokeApproval = {
  id: string;
  threadId: string;
  status: string;
};

type SmokeThread = {
  status: string;
} | undefined;

type SmokeDeps = {
  env: Record<string, string | undefined>;
  stdout: SmokeStream;
  stderr: SmokeStream;
  bootstrapApplication: typeof bootstrapApplication;
};

const SMOKE_MESSAGE =
  "Run a shell.exec action for `pwd` and require approval before executing it.";

function writeLine(stream: SmokeStream, line: string) {
  stream.write(`${line}\n`);
}

function getNewPendingApproval(
  approvals: SmokeApproval[],
  existingApprovalIds: Set<string>,
): SmokeApproval | undefined {
  return approvals.find((approval) => approval.status === "pending" && !existingApprovalIds.has(approval.id));
}

function formatSmokeFailure(error: unknown) {
  if (
    typeof error === "object"
    && error !== null
    && "category" in error
    && typeof error.category === "string"
    && "message" in error
    && typeof error.message === "string"
  ) {
    return `Smoke bootstrap failed [${error.category}]: ${error.message}`;
  }

  if (error instanceof Error) {
    return `Smoke bootstrap failed: ${error.message}`;
  }

  return `Smoke bootstrap failed: ${String(error)}`;
}

export async function runMvpSmoke(deps: Partial<SmokeDeps> = {}) {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const runBootstrap = deps.bootstrapApplication ?? bootstrapApplication;

  let runtime: Awaited<ReturnType<typeof bootstrapApplication>>;
  try {
    runtime = await runBootstrap({ env });
  } catch (error) {
    writeLine(stderr, formatSmokeFailure(error));
    return 1;
  }

  const initialApprovals = await runtime.taskService.listApprovals();
  const existingApprovalIds = new Set(initialApprovals.map((approval) => approval.id));
  const fromUserId = env.ADMIN_USER_ID ?? "wxid_admin";

  writeLine(stdout, `Submitted smoke message: ${SMOKE_MESSAGE}`);

  await runtime.gateway.handleInbound({
    fromUserId,
    text: SMOKE_MESSAGE,
    contextToken: "mvp-smoke",
  });

  const allApprovals = await runtime.taskService.listApprovals();
  const approval = getNewPendingApproval(allApprovals, existingApprovalIds);
  if (!approval) {
    writeLine(stderr, "No new pending approval was created by the smoke message.");
    return 1;
  }

  writeLine(stdout, `Detected approval ID: ${approval.id}`);

  await runtime.app.resumeApproval(approval.id);

  const thread: SmokeThread = await runtime.taskService.getThread(approval.threadId);
  if (!thread?.status) {
    writeLine(stderr, `Could not resolve final thread status for approval ${approval.id}.`);
    return 1;
  }

  writeLine(stdout, `Final thread status: ${thread.status}`);
  return 0;
}

export async function main() {
  try {
    process.exitCode = await runMvpSmoke();
  } catch (error) {
    if (error instanceof Error) {
      console.error("Smoke run failed:", error.message);
    } else {
      console.error("Smoke run failed:", String(error));
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
