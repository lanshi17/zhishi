import { loadConfig } from "../shared/config.js";
import { createWeChatGateway } from "../wechat/gateway.js";
import { createIlinkClient } from "../wechat/ilink-client.js";
import { createIlinkWeChatGateway } from "../wechat/ilink-gateway.js";
import { createAgentRuntime } from "../agent/runtime.js";
import { createToolRegistry } from "../tools/registry.js";
import { createApplication } from "./main.js";
import { createTaskService } from "../tasks/service.js";
import { classifyAction } from "../approval/engine.js";
import { createPgPool } from "../store/db.js";
import { ThreadRepository } from "../store/repositories/threads.js";
import { ApprovalRepository } from "../store/repositories/approvals.js";
import { DietRepository } from "../store/repositories/diet.js";
import { ExerciseRepository } from "../store/repositories/exercise.js";
import { GoalRepository } from "../store/repositories/goals.js";
import { createOpenAiProvider } from "../agent/provider/openai.js";
import { createRealShellExec } from "../tools/shell/real-runner.js";
import { createRealFsRead, createRealFsWrite } from "../tools/fs/real-runner.js";
import { createRealWebFetch, createTavilyClient, createTavilyWebSearch } from "../tools/web/real-runner.js";
import { createLightRagClient } from "../health/lightrag.js";
import { createKnowledgeService } from "../health/knowledge.js";
import { createHealthPipeline } from "../agent/pipeline.js";
import { createReportGenerator } from "../health/report-generator.js";
import { ReportRepository } from "../store/repositories/reports.js";
import { UserProfileRepository } from "../store/repositories/profiles.js";
import { ConversationRepository } from "../store/repositories/conversations.js";
import { pino } from "pino";
import type { MessageInput } from "../tasks/service.js";
import type { InboundWeChatMessage } from "../wechat/types.js";
import type { AgentContext } from "../health/types.js";

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function createDefaultEntrypoint(input: { env: Record<string, string | undefined> }) {
  const config = loadConfig(input.env);

  let currentMessage: MessageInput | undefined;
  let currentThreadId: string | undefined;

  const db = await createPgPool({
    databaseUrl: config.databaseUrl,
    max: config.pgPoolMax,
    idleTimeoutMs: config.pgPoolIdleTimeoutMs,
  });
  const threadRepository = new ThreadRepository(db);
  const approvalRepository = new ApprovalRepository(db);
  const dietRepo = new DietRepository(db);
  const exerciseRepo = new ExerciseRepository(db);
  const goalRepo = new GoalRepository(db);
  const reportRepo = new ReportRepository(db);
  const profileRepo = new UserProfileRepository(db);
  const conversationRepository = new ConversationRepository(db);

  const logger = pino({ level: "info" });
  const contextTokens = new Map<string, string>();

  const ilinkClient = config.ilinkBotToken
    ? createIlinkClient(config.ilinkBotToken)
    : undefined;

  async function sendReply(toUserId: string, text: string) {
    const ctxToken = contextTokens.get(toUserId);
    if (ilinkClient && ctxToken) {
      try {
        const clientId = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await ilinkClient.sendMessage({
          to_user_id: toUserId,
          client_id: clientId,
          context_token: ctxToken,
          item_list: [{ type: 1, text_item: { text } }],
        });
        logger.info({ toUserId, text }, "wechat reply sent via ilink");
      } catch (err) {
        logger.error({ toUserId, text, err }, "ilink sendMessage failed");
      }
    } else {
      logger.info({ toUserId, text }, "wechat reply logged (no ilink)");
    }
  }

  const provider = createOpenAiProvider(config.llm);
  const runtime = createAgentRuntime({ provider });

  // Create LightRAG knowledge service if configured
  let knowledgeService: ReturnType<typeof createKnowledgeService> | undefined;
  if (config.lightrag.enabled && config.lightrag.apiUrl) {
    const lightragClient = createLightRagClient({
      apiUrl: config.lightrag.apiUrl,
      apiKey: config.lightrag.apiKey,
      timeoutMs: config.lightrag.timeoutMs,
    });
    knowledgeService = createKnowledgeService(lightragClient, logger);
  }

  // Create report generator
  const reportGenerator = createReportGenerator({
    dietRepo,
    exerciseRepo,
    goalRepo,
    reportRepo,
    profileRepo,
    knowledgeService,
    logger,
  });

  // Create web search (Tavily) if configured
  const webSearchFn = config.tavily.apiKey
    ? createTavilyWebSearch(createTavilyClient({ apiKey: config.tavily.apiKey }))
    : undefined;

  // Wrap web search for health pipeline (simplified interface)
  const webSearchForPipeline = webSearchFn
    ? async (query: string) => webSearchFn({ query })
    : undefined;

  logger.info({ tavilyConfigured: !!webSearchFn }, "web search initialization");

  // Create health pipeline (always created; knowledgeService is optional)
  const healthPipeline = createHealthPipeline({
    provider,
    knowledgeService,
    webSearch: webSearchForPipeline,
    dietRepo,
    exerciseRepo,
    goalRepo,
    profileRepo,
    reportGenerator,
    logger,
    conversationRepository,
    contextWindowTokens: config.health.contextWindow,
  });

  // Build agent context for the health pipeline
  async function buildContext(userId: string): Promise<AgentContext> {
    const today = todayStr();
    const [todayDietRecords, todayExerciseRecords, activeGoals, threads, userProfile] = await Promise.all([
      dietRepo.getByDate(userId, today),
      exerciseRepo.getByDate(userId, today),
      goalRepo.getActive(userId),
      threadRepository.listBySourceUserId(userId),
      profileRepo.get(userId),
    ]);

    // Get recent events from the latest threads
    let recentEvents: Array<{ kind: string; summary: string }> = [];
    if (threads.length > 0) {
      const latestThread = threads[threads.length - 1];
      const events = await threadRepository.listEvents(latestThread.id);
      recentEvents = events.slice(-5).map((e) => ({
        kind: e.kind,
        summary: e.summary,
      }));
    }

    const knowledgeAvailable = knowledgeService
      ? await knowledgeService.isAvailable().catch(() => false)
      : false;

    return {
      todayDietRecords,
      todayExerciseRecords,
      activeGoals,
      recentEvents,
      knowledgeAvailable,
      userProfile,
    };
  }

  const toolRegistry = createToolRegistry({
    shellExec: createRealShellExec(config.workspaceRoot),
    fsRead: createRealFsRead(config.workspaceRoot),
    fsWrite: createRealFsWrite(config.workspaceRoot),
    webSearch: webSearchFn,
    webFetch: createRealWebFetch(),
    wechatReply: async (input) => {
      await sendReply(input.toUserId, input.text);
      return { delivered: true };
    },
  });
  const taskServiceImpl = createTaskService({
    threadRepository,
    approvalRepository,
  });

  const app = createApplication({
    adminUserId: config.adminUserId,
    runtime: {
      async planNext() {
        if (!currentThreadId) {
          throw new Error("thread not initialized before planning");
        }
        return runtime.planNext({
          threadId: currentThreadId,
          prompt: currentMessage?.text ?? "test",
        });
      },
    },
    approvals: { classifyAction },
    tools: toolRegistry,
    healthPipeline,
    buildContext,
    taskService: {
      async receiveMessage() {
        if (!currentMessage) {
          throw new Error("currentMessage not set before receiveMessage call");
        }
        const received = await taskServiceImpl.receiveMessage(currentMessage);
        currentThreadId = received.threadId;
        return received;
      },
      async appendEvent(threadId: string, event: { kind: string; [key: string]: unknown }) {
        await taskServiceImpl.appendEvent(threadId, {
          kind: event.kind,
          summary: typeof event.summary === "string" ? event.summary : `Event: ${event.kind}`,
        });
      },
      async markDone(threadId: string) {
        await taskServiceImpl.markDone(threadId);
      },
      async markFailed(threadId: string, reason: string) {
        await taskServiceImpl.markFailed(threadId, reason);
      },
      async createApprovalRequest(threadId: string, action: { tool: string; input: unknown }, reply: string) {
        return taskServiceImpl.createApprovalRequest(threadId, action, reply);
      },
      async markWaitingApproval(threadId: string) {
        await taskServiceImpl.markWaitingApproval(threadId);
      },
      async getPendingApproval(approvalId: string) {
        return taskServiceImpl.getPendingApproval(approvalId);
      },
      async markApproved(approvalId: string) {
        await taskServiceImpl.markApproved(approvalId);
      },
      async markRejected(approvalId: string) {
        await taskServiceImpl.markRejected(approvalId);
      },
    },
    sendReply,
  });

  const onMessage = async (message: InboundWeChatMessage) => {
    contextTokens.set(message.fromUserId, message.contextToken);
    currentMessage = {
      fromUserId: message.fromUserId,
      text: message.text,
    };
    await app.handleAdminMessage({
      fromUserId: message.fromUserId,
      text: message.text,
      contextToken: message.contextToken,
      imageUrls: message.imageUrls,
    });
  };

  const gateway = ilinkClient
    ? createIlinkWeChatGateway({
        adminUserId: config.adminUserId,
        ilinkClient,
        onMessage,
      })
    : createWeChatGateway({
        adminUserId: config.adminUserId,
        onMessage,
      });

  return { app, gateway, taskService: taskServiceImpl, setCurrentMessage: (msg: MessageInput) => { currentMessage = msg; }, db };
}
