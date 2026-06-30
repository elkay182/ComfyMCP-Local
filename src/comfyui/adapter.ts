import type { ComfyMcpConfig } from "../config/schema.js";
import { ComfyRestClient } from "./rest-client.js";
import type { ComfyObjectInfo, ComfySystemStats } from "./types.js";

export type ComfyConnectionSnapshot =
  | {
      state: "connected";
      systemStats: ComfySystemStats;
      objectInfo: ComfyObjectInfo;
    }
  | {
      state: "disconnected";
      reason: string;
    };

export class ComfyUiAdapter {
  readonly rest: ComfyRestClient;

  constructor(config: ComfyMcpConfig) {
    this.rest = new ComfyRestClient(config);
  }

  async snapshot(signal?: AbortSignal): Promise<ComfyConnectionSnapshot> {
    try {
      const [systemStats, objectInfo] = await Promise.all([
        this.rest.getSystemStats(signal),
        this.rest.getObjectInfo(undefined, signal)
      ]);
      return {
        state: "connected",
        systemStats,
        objectInfo
      };
    } catch (error) {
      return {
        state: "disconnected",
        reason: error instanceof Error ? error.message : "ComfyUI unavailable"
      };
    }
  }
}
