#!/usr/bin/env node
import { runApproveCommand } from "./cli/approve.js";
import { runAuthCommand } from "./cli/auth.js";
import { defaultStateDir } from "./config/paths.js";
import { ConfigError, parseEnv, type ComfyMcpConfig } from "./config/schema.js";
import { validateStartupConfig } from "./config/validation.js";
import { databasePathForStateDir, openDatabase } from "./persistence/database.js";
import { AuthTokenRepository } from "./persistence/repositories/index.js";
import { startStreamableHttpServer } from "./transport/streamable-http.js";
import { startStdioServer } from "./transport/stdio.js";
import { listTools } from "./tools/index.js";
import { systemCapabilities, systemStatus } from "./tools/system.js";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const command = argv[0];

  try {
    const config = parseEnv(process.env);
    const stateDir = config.stateDir ?? defaultStateDir();

    if (command === "--version" || command === "version") {
      writeJson({ name: "comfymcp-local", version: "0.1.0" });
      return 0;
    }

    if (command === "tools:list") {
      writeJson({ tools: listTools(config) });
      return 0;
    }

    if (command === "status") {
      writeJson(systemStatus(config));
      return 0;
    }

    if (command === "capabilities") {
      writeJson(systemCapabilities(config));
      return 0;
    }

    if (command === "auth") {
      return emitCommandResult(runAuthCommand(argv.slice(1), stateDir));
    }

    if (command === "approve") {
      return emitCommandResult(runApproveCommand(argv.slice(1)));
    }

    validateStartupConfig(config, activeBearerRecordCount(config, stateDir));

    if (config.transport === "streamable_http") {
      const server = await startStreamableHttpServer(config, { stateDir });
      process.stderr.write(`ComfyMCP Streamable HTTP listening at ${server.url.toString()}\n`);
      await waitForShutdown(() => server.close());
      return 0;
    }

    await startStdioServer(config);
    return 0;
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${JSON.stringify({ ok: false, errors: error.issues })}\n`);
      return 2;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function emitCommandResult(result: { exitCode: number; stdout?: unknown; stderr?: string }): number {
  if (result.stdout !== undefined) {
    writeJson(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(`${result.stderr}\n`);
  }
  return result.exitCode;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function activeBearerRecordCount(config: ComfyMcpConfig, stateDir: string): number {
  if (config.transport !== "streamable_http") {
    return 0;
  }
  const handle = openDatabase(databasePathForStateDir(stateDir));
  try {
    return new AuthTokenRepository(handle.db).countActive();
  } finally {
    handle.close();
  }
}

async function waitForShutdown(close: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
  await close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await main();
  process.exitCode = exitCode;
}
