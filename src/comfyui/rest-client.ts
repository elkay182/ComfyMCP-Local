import type { ComfyMcpConfig } from "../config/schema.js";
import { resolveComfyUrl } from "../transport/origin-policy.js";
import { ComfyUiError } from "./errors.js";
import type {
  ComfyHistoryResponse,
  ComfyObjectInfo,
  ComfyPromptResponse,
  ComfyQueueResponse,
  ComfySystemStats
} from "./types.js";

export class ComfyRestClient {
  readonly config: ComfyMcpConfig;

  constructor(config: ComfyMcpConfig) {
    this.config = config;
  }

  async getSystemStats(signal?: AbortSignal): Promise<ComfySystemStats> {
    return this.getJson<ComfySystemStats>("/system_stats", signal);
  }

  async getObjectInfo(classType?: string, signal?: AbortSignal): Promise<ComfyObjectInfo> {
    const path = classType ? `/object_info/${encodeURIComponent(classType)}` : "/object_info";
    return this.getJson<ComfyObjectInfo>(path, signal);
  }

  async getModels(folder?: string, signal?: AbortSignal): Promise<unknown> {
    const path = folder ? `/models/${encodeURIComponent(folder)}` : "/models";
    return this.getJson(path, signal);
  }

  async postPrompt(prompt: Record<string, unknown>, clientId: string, signal?: AbortSignal): Promise<ComfyPromptResponse> {
    return this.postJson<ComfyPromptResponse>("/prompt", { prompt, client_id: clientId }, signal);
  }

  async getQueue(signal?: AbortSignal): Promise<ComfyQueueResponse> {
    return this.getJson<ComfyQueueResponse>("/queue", signal);
  }

  async getHistory(promptId?: string, signal?: AbortSignal): Promise<ComfyHistoryResponse> {
    const path = promptId ? `/history/${encodeURIComponent(promptId)}` : "/history";
    return this.getJson<ComfyHistoryResponse>(path, signal);
  }

  async clearVram(signal?: AbortSignal): Promise<unknown> {
    return this.postJson("/free", { unload_models: true, free_memory: true }, signal);
  }

  private async getJson<T>(pathname: string, signal?: AbortSignal): Promise<T> {
    return this.fetchJson<T>(pathname, { method: "GET", signal });
  }

  private async postJson<T>(pathname: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return this.fetchJson<T>(pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal
    });
  }

  private async fetchJson<T>(pathname: string, init: RequestInit): Promise<T> {
    const url = resolveComfyUrl(this.config, pathname);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        redirect: "manual"
      });
    } catch (error) {
      throw new ComfyUiError("COMFY_UNAVAILABLE", error instanceof Error ? error.message : "ComfyUI unavailable");
    }

    if (response.status >= 300 && response.status < 400) {
      throw new ComfyUiError("COMFY_HTTP_ERROR", "ComfyUI redirects are rejected", response.status);
    }
    if (!response.ok) {
      throw new ComfyUiError("COMFY_HTTP_ERROR", `ComfyUI returned HTTP ${response.status}`, response.status);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ComfyUiError("COMFY_INVALID_RESPONSE", "ComfyUI returned invalid JSON", response.status);
    }
  }
}
