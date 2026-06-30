import type { ComfyMcpConfig } from "../config/schema.js";
import { resolveComfyUrl } from "../transport/origin-policy.js";

export type ComfyWsEvent =
  | { type: "status"; data: unknown }
  | { type: "progress"; data: unknown }
  | { type: "executing"; data: unknown }
  | { type: "executed"; data: unknown }
  | { type: "execution_error"; data: unknown };

export type ComfyWsPromptResult =
  | { state: "completed" }
  | { state: "failed"; error: Record<string, unknown> };

export type ComfyWsClient = {
  waitForPrompt(promptId: string, timeoutMs: number): Promise<ComfyWsPromptResult>;
  close(): void;
};

export function createWebSocketClient(config: ComfyMcpConfig, clientId: string): ComfyWsClient {
  return new GlobalWebSocketClient(webSocketUrl(config, clientId));
}

class GlobalWebSocketClient implements ComfyWsClient {
  readonly #socket: WebSocket;

  constructor(url: URL) {
    this.#socket = new WebSocket(url);
  }

  waitForPrompt(promptId: string, timeoutMs: number): Promise<ComfyWsPromptResult> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timeout);
        this.#socket.removeEventListener("message", onMessage);
        this.#socket.removeEventListener("error", onError);
        this.#socket.removeEventListener("close", onClose);
      };

      function onMessage(event: MessageEvent): void {
        const parsed = parseWsEvent(event.data);
        if (!parsed || !eventMatchesPrompt(parsed, promptId)) {
          return;
        }
        if (parsed.type === "execution_error") {
          cleanup();
          resolve({
            state: "failed",
            error: {
              code: "INTERNAL",
              message: errorMessageFromEvent(parsed),
              details: asRecord(parsed.data)
            }
          });
          return;
        }
        if (parsed.type === "executing" && isTerminalExecutingEvent(parsed)) {
          cleanup();
          resolve({ state: "completed" });
        }
      }

      function onError(): void {
        cleanup();
        reject(new Error("ComfyUI WebSocket watcher failed"));
      }

      function onClose(): void {
        cleanup();
        reject(new Error("ComfyUI WebSocket watcher closed before completion"));
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("ComfyUI WebSocket watcher timed out"));
      }, timeoutMs);

      this.#socket.addEventListener("message", onMessage);
      this.#socket.addEventListener("error", onError);
      this.#socket.addEventListener("close", onClose);
    });
  }

  close(): void {
    if (this.#socket.readyState === WebSocket.OPEN || this.#socket.readyState === WebSocket.CONNECTING) {
      this.#socket.close();
    }
  }
}

function webSocketUrl(config: ComfyMcpConfig, clientId: string): URL {
  const url = resolveComfyUrl(config, `/ws?clientId=${encodeURIComponent(clientId)}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

function parseWsEvent(data: unknown): ComfyWsEvent | undefined {
  if (typeof data !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(data) as unknown;
    const record = asRecord(parsed);
    const type = record.type;
    if (
      type === "status" ||
      type === "progress" ||
      type === "executing" ||
      type === "executed" ||
      type === "execution_error"
    ) {
      return {
        type,
        data: record.data
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function eventMatchesPrompt(event: ComfyWsEvent, promptId: string): boolean {
  const data = asRecord(event.data);
  return data.prompt_id === promptId;
}

function isTerminalExecutingEvent(event: ComfyWsEvent): boolean {
  const data = asRecord(event.data);
  return data.node === null;
}

function errorMessageFromEvent(event: ComfyWsEvent): string {
  const data = asRecord(event.data);
  const message = data.exception_message ?? data.message;
  return typeof message === "string" ? message : "Workflow execution failed";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
