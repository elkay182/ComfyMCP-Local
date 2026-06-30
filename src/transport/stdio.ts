import type { ComfyMcpConfig } from "../config/schema.js";
import { defaultStateDir } from "../config/paths.js";
import { createMcpServer } from "../mcp/server.js";
import { databasePathForStateDir, openDatabase } from "../persistence/database.js";
import { AssetRepository, JobRepository } from "../persistence/repositories/index.js";
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
  const server = createMcpServer(config, {
    actorId: "local_stdio",
    jobs: new JobRepository(handle.db),
    assets: new AssetRepository(handle.db)
  });
  await server.connect(new StdioServerTransport());
}
