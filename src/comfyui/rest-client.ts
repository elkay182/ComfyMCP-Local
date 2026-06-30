import type { ComfyMcpConfig } from "../config/schema.js";
import { assertComfyUpstreamAllowed } from "../policy/comfy-upstream-policy.js";
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

  async deletePrompt(promptId: string, signal?: AbortSignal): Promise<unknown> {
    return this.postJson("/queue", { delete: [promptId] }, signal);
  }

  async interrupt(signal?: AbortSignal): Promise<unknown> {
    return this.postJson("/interrupt", {}, signal);
  }

  async clearVram(signal?: AbortSignal): Promise<unknown> {
    return this.postJson("/free", { unload_models: true, free_memory: true }, signal);
  }

  async getViewBytes(
    input: { filename: string; subfolder?: string; type?: string },
    signal?: AbortSignal
  ): Promise<{ bytes: Buffer; mimeType?: string }> {
    const params = new URLSearchParams({
      filename: input.filename
    });
    if (input.subfolder) {
      params.set("subfolder", input.subfolder);
    }
    if (input.type) {
      params.set("type", input.type);
    }
    return this.fetchBytes(`/view?${params.toString()}`, signal);
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
    const timeout = timeoutSignal(init.signal ?? undefined, this.config.limits.comfyuiRequestTimeoutMs);
    try {
      await assertComfyUpstreamAllowed(this.config, url);
      response = await fetch(url, {
        ...init,
        signal: timeout.signal,
        redirect: "manual"
      });
    } catch (error) {
      throw new ComfyUiError("COMFY_UNAVAILABLE", error instanceof Error ? error.message : "ComfyUI unavailable");
    } finally {
      timeout.cancel();
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

  private async fetchBytes(pathname: string, signal?: AbortSignal): Promise<{ bytes: Buffer; mimeType?: string }> {
    const url = resolveComfyUrl(this.config, pathname);
    let response: Response;
    const timeout = timeoutSignal(signal, this.config.limits.comfyuiRequestTimeoutMs);
    try {
      await assertComfyUpstreamAllowed(this.config, url);
      response = await fetch(url, {
        method: "GET",
        signal: timeout.signal,
        redirect: "manual"
      });
    } catch (error) {
      throw new ComfyUiError("COMFY_UNAVAILABLE", error instanceof Error ? error.message : "ComfyUI unavailable");
    } finally {
      timeout.cancel();
    }

    if (response.status >= 300 && response.status < 400) {
      throw new ComfyUiError("COMFY_HTTP_ERROR", "ComfyUI redirects are rejected", response.status);
    }
    if (!response.ok) {
      throw new ComfyUiError("COMFY_HTTP_ERROR", `ComfyUI returned HTTP ${response.status}`, response.status);
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > this.config.limits.maxResourceBytes) {
      throw new ComfyUiError("COMFY_HTTP_ERROR", "ComfyUI resource exceeds configured byte limit", response.status);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > this.config.limits.maxResourceBytes) {
      throw new ComfyUiError("COMFY_HTTP_ERROR", "ComfyUI resource exceeds configured byte limit", response.status);
    }
    return {
      bytes,
      mimeType: response.headers.get("content-type") ?? undefined
    };
  }
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cancel(): void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error("ComfyUI request timed out"));
  }, timeoutMs);
  const abort = () => {
    controller.abort(signal?.reason);
  };
  if (signal) {
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };
}
