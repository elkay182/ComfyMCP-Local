import type { ComfyMcpConfig } from "../config/schema.js";
import { omittedTools, toolNames } from "./index.js";

export type SystemStatus = {
  server_name: "comfymcp-local";
  api_version: "v1";
  deployment_mode: "local_stdio" | "lan_hosted";
  transport: "stdio" | "streamable_http";
  comfyui_origin: string;
  comfyui_connection: "unknown" | "connected" | "disconnected";
  locality_assurance: "policy_only" | "operator_attested" | "container_verified";
  administrative_mutations: boolean;
};

export function systemStatus(config: ComfyMcpConfig): SystemStatus {
  return {
    server_name: "comfymcp-local",
    api_version: "v1",
    deployment_mode: config.deploymentMode,
    transport: config.transport,
    comfyui_origin: config.comfyuiUrl.origin,
    comfyui_connection: "unknown",
    locality_assurance: config.egressAssurance,
    administrative_mutations: config.adminMutations
  };
}

export function systemCapabilities(config: ComfyMcpConfig): Record<string, unknown> {
  return {
    tools: toolNames(config),
    omitted_tools: omittedTools(config),
    roots: {
      comfyui_path: Boolean(config.comfyuiPath),
      export_root: Boolean(config.exportRoot),
      custom_nodes_root: Boolean(config.customNodesRoot)
    },
    administrative_mutations: config.adminMutations,
    direct_downloads: config.allowDirectDownloads,
    unsafe_model_formats: config.allowUnsafeModelFormats
  };
}
