export type ComfyWsEvent =
  | { type: "status"; data: unknown }
  | { type: "progress"; data: unknown }
  | { type: "executing"; data: unknown }
  | { type: "executed"; data: unknown }
  | { type: "execution_error"; data: unknown };

export type ComfyWsClient = {
  close(): void;
};

export function createWebSocketClient(): ComfyWsClient {
  throw new Error("ComfyUI WebSocket client is not implemented in the Milestone 0 scaffold");
}
