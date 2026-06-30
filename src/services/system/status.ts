import type { ComfyMcpConfig } from "../../config/schema.js";
import { ComfyUiAdapter, type ComfyConnectionSnapshot } from "../../comfyui/adapter.js";
import { systemStatus } from "../../tools/system.js";

export async function getSystemStatusWithConnection(
  config: ComfyMcpConfig,
  adapter = new ComfyUiAdapter(config)
): Promise<Record<string, unknown>> {
  const base = systemStatus(config);
  const snapshot = await adapter.snapshot();
  return {
    ...base,
    comfyui_connection: snapshot.state,
    comfyui: summarizeSnapshot(snapshot)
  };
}

function summarizeSnapshot(snapshot: ComfyConnectionSnapshot): Record<string, unknown> {
  if (snapshot.state === "disconnected") {
    return { reason: snapshot.reason };
  }
  return {
    device_count: snapshot.systemStats.devices?.length ?? 0,
    node_count: Object.keys(snapshot.objectInfo).length
  };
}
