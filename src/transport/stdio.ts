import type { ComfyMcpConfig } from "../config/schema.js";
import { listTools } from "../tools/index.js";

export function getStdioContractSnapshot(config: ComfyMcpConfig): unknown {
  return {
    transport: "stdio",
    tools: listTools(config)
  };
}

export async function startStdioServer(config: ComfyMcpConfig): Promise<void> {
  void config;
  // The SDK-backed stdio server will be wired here after the contract and
  // policy shell are stable. This function intentionally writes nothing to
  // stdout so protocol frames cannot be polluted by logs.
  await new Promise<void>(() => {
    /* keep process alive */
  });
}
