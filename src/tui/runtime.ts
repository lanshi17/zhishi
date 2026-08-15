import type { ApprovalQueueItem } from "./widgets/approval-queue.js";
import { buildMainViewModel, renderMainScreen } from "./app.js";
import type { EventLogItem } from "./widgets/event-log.js";
import type { MainScreenState } from "./screens/main-screen.js";

export type TuiMode = "browse" | "reject_input";

export type TuiControllerState = {
  mode: TuiMode;
  selectedApprovalIndex: number;
  rejectReason: string;
};

export type TuiInput =
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "approve" }
  | { kind: "reject" }
  | { kind: "quit" }
  | { kind: "submit" }
  | { kind: "escape" }
  | { kind: "backspace" }
  | { kind: "char"; value: string };

type TuiAppActions = {
  resumeApproval(approvalId: string): Promise<void> | void;
  rejectApproval(approvalId: string, reason?: string): Promise<void> | void;
};

type TuiThread = {
  id: string;
  fromUserId: string;
  title: string;
  status: string;
};

type TuiApproval = {
  id: string;
  threadId: string;
  status: string;
  action: { tool: string; input: unknown };
  reply: string;
};

type TuiTaskEvent = {
  kind: string;
  summary: string;
};

type TuiTaskService = {
  listThreads(): Promise<TuiThread[]>;
  listApprovals(): Promise<TuiApproval[]>;
  listEvents(threadId: string): Promise<TuiTaskEvent[]>;
};

type TuiInputStream = {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  off?(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  removeListener?(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  setRawMode?(enabled: boolean): unknown;
  resume?(): unknown;
  pause?(): unknown;
};

type TuiOutputStream = {
  write(chunk: string): unknown;
};

function clampSelection(index: number, approvals: ApprovalQueueItem[]) {
  if (approvals.length === 0) {
    return 0;
  }

  return Math.min(Math.max(index, 0), approvals.length - 1);
}

function isPendingApproval(
  approval: ApprovalQueueItem | undefined,
): approval is ApprovalQueueItem & { status: "pending" } {
  return approval?.status === "pending";
}

function buildApprovalItems(approvals: TuiApproval[]): ApprovalQueueItem[] {
  return approvals.map((approval) => ({
    id: approval.id,
    threadId: approval.threadId,
    tool: approval.action.tool,
    status: approval.status,
    summary: approval.reply,
  }));
}

function findLatestThreadId(
  threads: TuiThread[],
  status: "waiting_approval" | "failed",
) {
  for (let index = threads.length - 1; index >= 0; index -= 1) {
    if (threads[index]?.status === status) {
      return threads[index].id;
    }
  }

  return undefined;
}

function findSelectedThreadId(input: {
  threads: TuiThread[];
  approvals: ApprovalQueueItem[];
  selectedApprovalIndex: number;
}) {
  const selectedApproval = input.approvals[clampSelection(input.selectedApprovalIndex, input.approvals)];
  if (selectedApproval?.status === "pending") {
    return selectedApproval.threadId;
  }

  return findLatestThreadId(input.threads, "waiting_approval")
    ?? findLatestThreadId(input.threads, "failed");
}

export function decodeTerminalInput(input: Buffer | string, mode: TuiMode = "browse"): TuiInput[] {
  const chunk = typeof input === "string" ? input : input.toString("utf8");

  if (chunk === "[A") {
    return [{ kind: "up" }];
  }

  if (chunk === "[B") {
    return [{ kind: "down" }];
  }

  if (chunk === "\r" || chunk === "\n") {
    return [{ kind: "submit" }];
  }

  if (chunk === "") {
    return [{ kind: "escape" }];
  }

  if (chunk === "") {
    return [{ kind: "quit" }];
  }

  if (chunk === "") {
    return [{ kind: "backspace" }];
  }

  if (mode === "reject_input") {
    return Array.from(chunk, (character) => ({ kind: "char", value: character }));
  }

  const decoded: TuiInput[] = [];
  for (const character of chunk) {
    if (character === "j") {
      decoded.push({ kind: "down" });
    } else if (character === "k") {
      decoded.push({ kind: "up" });
    } else if (character === "a") {
      decoded.push({ kind: "approve" });
    } else if (character === "r") {
      decoded.push({ kind: "reject" });
    } else if (character === "q") {
      decoded.push({ kind: "quit" });
    } else {
      decoded.push({ kind: "char", value: character });
    }
  }

  return decoded;
}

export function createTuiController(input: { app: TuiAppActions }) {
  const state: TuiControllerState = {
    mode: "browse",
    selectedApprovalIndex: 0,
    rejectReason: "",
  };

  const getSelectedApproval = (approvals: ApprovalQueueItem[]) => {
    if (approvals.length === 0) {
      return undefined;
    }

    return approvals[clampSelection(state.selectedApprovalIndex, approvals)];
  };

  const resetRejectInput = () => {
    state.mode = "browse";
    state.rejectReason = "";
  };

  const syncSelection = (approvals: ApprovalQueueItem[]) => {
    state.selectedApprovalIndex = clampSelection(state.selectedApprovalIndex, approvals);

    if (approvals.length === 0 && state.mode === "reject_input") {
      resetRejectInput();
    }
  };

  return {
    getState(): TuiControllerState {
      return { ...state };
    },
    setApprovalItems(approvals: ApprovalQueueItem[]) {
      syncSelection(approvals);
      return this.getState();
    },
    async handleInput(inputEvent: TuiInput, approvals: ApprovalQueueItem[]) {
      syncSelection(approvals);

      if (state.mode === "reject_input") {
        if (inputEvent.kind === "escape") {
          resetRejectInput();
          return this.getState();
        }

        if (inputEvent.kind === "backspace") {
          state.rejectReason = state.rejectReason.slice(0, -1);
          return this.getState();
        }

        if (inputEvent.kind === "char") {
          state.rejectReason += inputEvent.value;
          return this.getState();
        }

        if (inputEvent.kind === "submit") {
          const approval = getSelectedApproval(approvals);
          if (isPendingApproval(approval)) {
            const reason = state.rejectReason || undefined;
            await input.app.rejectApproval(approval.id, reason);
          }
          resetRejectInput();
          return this.getState();
        }

        return this.getState();
      }

      switch (inputEvent.kind) {
        case "down":
          state.selectedApprovalIndex = clampSelection(state.selectedApprovalIndex + 1, approvals);
          break;
        case "up":
          state.selectedApprovalIndex = clampSelection(state.selectedApprovalIndex - 1, approvals);
          break;
        case "approve": {
          const approval = getSelectedApproval(approvals);
          if (isPendingApproval(approval)) {
            await input.app.resumeApproval(approval.id);
          }
          break;
        }
        case "reject": {
          const approval = getSelectedApproval(approvals);
          if (isPendingApproval(approval)) {
            state.mode = "reject_input";
            state.rejectReason = "";
          }
          break;
        }
        case "quit":
        default:
          break;
      }

      return this.getState();
    },
  };
}

function clearScreen(output: TuiOutputStream) {
  output.write("[2J[H");
}

export function createTuiRuntime(input: {
  app: TuiAppActions;
  taskService: TuiTaskService;
  stdin?: TuiInputStream;
  stdout?: TuiOutputStream;
}) {
  const controller = createTuiController({ app: input.app });
  const stdin = input.stdin ?? process.stdin;
  const stdout = input.stdout ?? process.stdout;

  const buildScreenState = async (): Promise<MainScreenState> => {
    const threads = await input.taskService.listThreads();
    const approvals = buildApprovalItems(await input.taskService.listApprovals());
    const selectedThreadId = findSelectedThreadId({
      threads,
      approvals,
      selectedApprovalIndex: controller.getState().selectedApprovalIndex,
    });
    const eventsByThread: Record<string, EventLogItem[]> = {};

    if (selectedThreadId) {
      const events = await input.taskService.listEvents(selectedThreadId);
      eventsByThread[selectedThreadId] = events.map((event, index) => ({
        id: `${selectedThreadId}:${event.kind}:${index}`,
        summary: event.summary,
      }));
    }

    const threadsWithEvents = [];
    for (const thread of threads) {
      const events = await input.taskService.listEvents(thread.id);
      threadsWithEvents.push({
        id: thread.id,
        title: thread.title,
        status: thread.status,
        latestEventSummary: events.at(-1)?.summary,
      });
    }

    return buildMainViewModel({
      threads: threadsWithEvents,
      approvals,
      eventsByThread,
      selectedThreadId,
      interaction: controller.getState(),
    });
  };

  const render = async () => {
    const state = await buildScreenState();
    clearScreen(stdout);
    stdout.write(`${renderMainScreen(state)}\n`);
    return state;
  };

  const applyInput = async (inputEvent: TuiInput) => {
    if (inputEvent.kind === "quit") {
      stop();
      return buildScreenState();
    }

    const approvals = buildApprovalItems(await input.taskService.listApprovals());
    await controller.handleInput(inputEvent, approvals);
    return render();
  };

  const handleData = async (chunk: Buffer | string) => {
    for (const inputEvent of decodeTerminalInput(chunk, controller.getState().mode)) {
      await applyInput(inputEvent);
    }
  };

  const onData = (chunk: Buffer | string) => {
    void handleData(chunk);
  };

  const stop = () => {
    stdin.setRawMode?.(false);
    if (stdin.off) {
      stdin.off("data", onData);
    } else {
      stdin.removeListener?.("data", onData);
    }
    stdin.pause?.();
  };

  const start = () => {
    stdin.setRawMode?.(true);
    stdin.resume?.();
    stdin.on("data", onData);
    return render();
  };

  return {
    controller,
    buildScreenState,
    render,
    start,
    stop,
    handleData,
    applyInput,
  };
}

export function startTuiRuntime(
  runtime: { app: TuiAppActions; taskService: TuiTaskService },
  streams: { stdin?: TuiInputStream; stdout?: TuiOutputStream } = {},
) {
  const tuiRuntime = createTuiRuntime({
    app: runtime.app,
    taskService: runtime.taskService,
    stdin: streams.stdin,
    stdout: streams.stdout,
  });

  return tuiRuntime.start();
}
