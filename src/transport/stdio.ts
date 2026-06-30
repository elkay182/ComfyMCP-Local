import type { ComfyMcpConfig } from "../config/schema.js";
import { ComfyRestClient } from "../comfyui/rest-client.js";
import { defaultStateDir } from "../config/paths.js";
import { createMcpServer } from "../mcp/server.js";
import { databasePathForStateDir, openDatabase } from "../persistence/database.js";
import { AssetRepository, JobRepository } from "../persistence/repositories/index.js";
import { startJobReconciliation } from "../services/jobs/job-runner.js";
import { listTools } from "../tools/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export function getStdioContractSnapshot(config: ComfyMcpConfig): unknown {
  return {
    transport: "stdio",
    tools: listTools(config)
  };
}

export async function startStdioServer(config: ComfyMcpConfig): Promise<void> {
  const handle = openDatabase(databasePathForStateDir(config.stateDir ?? defaultStateDir()));
  const jobs = new JobRepository(handle.db);
  const assets = new AssetRepository(handle.db);
  const comfyRestClient = new ComfyRestClient(config);
  startJobReconciliation({
    config,
    jobs,
    assets,
    rest: comfyRestClient
  });
  const server = createMcpServer(config, {
    actorId: "local_stdio",
    jobs,
    assets,
    comfyRestClient
  });
  await server.connect(new StdioServerTransport());
}
