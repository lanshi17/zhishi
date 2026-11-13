import { EventDispatcher, LoggerLevel, WSClient } from "@larksuiteoapi/node-sdk";
import type { FeishuMessageEvent } from "./protocol.js";

type Logger = {
  info(data: unknown, msg?: string): void;
  warn(data: unknown, msg?: string): void;
  error(data: unknown, msg?: string): void;
};

export type FeishuRuntime = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

/**
 * Feishu bot event subscription over a WebSocket long connection, so no public
 * callback URL is required (the same model as the official SDK quickstart).
 * Only `im.message.receive_v1` is consumed; unsupported event types are ignored
 * by the dispatcher.
 */
export function createFeishuRuntime(input: {
  appId: string;
  appSecret: string;
  onMessage: (event: FeishuMessageEvent) => Promise<void> | void;
  logger?: Logger;
}): FeishuRuntime {
  const logger = input.logger ?? { info: () => {}, warn: () => {}, error: () => {} };

  const dispatcher = new EventDispatcher({ loggerLevel: LoggerLevel.info }).register({
    "im.message.receive_v1": (data) => {
      // Acknowledge the event immediately; the agent turn may take minutes.
      void Promise.resolve(input.onMessage(data)).catch((err: unknown) => {
        logger.error({ err }, "feishu event handler failed");
      });
    },
  });

  const wsClient = new WSClient({
    appId: input.appId,
    appSecret: input.appSecret,
    loggerLevel: LoggerLevel.info,
    autoReconnect: true,
    onReady: () => logger.info({}, "feishu long connection ready"),
    onError: (err) => logger.error({ err }, "feishu long connection error"),
    onReconnecting: () => logger.warn({}, "feishu long connection reconnecting"),
    onReconnected: () => logger.info({}, "feishu long connection reconnected"),
  });

  return {
    async start() {
      await wsClient.start({ eventDispatcher: dispatcher });
    },

    async stop() {
      wsClient.close();
    },
  };
}
