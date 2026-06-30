import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { ComfyRestClient } from "../../src/comfyui/rest-client.js";
import { parseEnv } from "../../src/config/schema.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { openDatabase, type DatabaseHandle } from "../../src/persistence/database.js";
import { AssetRepository, JobRepository } from "../../src/persistence/repositories/index.js";
import { startFakeComfyUiServer, type FakeComfyUiServer } from "../fake-comfyui/server.js";

const tempDirs: string[] = [];
const clients: Client[] = [];
const servers: McpServer[] = [];
let fakeComfyUi: FakeComfyUiServer | undefined;
let database: DatabaseHandle | undefined;

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close();
  }
  for (const server of servers.splice(0)) {
    await server.close();
  }
  database?.close();
  database = undefined;
  await fakeComfyUi?.close();
  fakeComfyUi = undefined;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("workflow/job Milestone 1 starter", () => {
  it("validates, runs, persists, and retrieves an inline workflow through fake ComfyUI", async () => {
    fakeComfyUi = await startFakeComfyUiServer();
    const config = parseEnv({
      COMFYMCP_COMFYUI_URL: fakeComfyUi.url
    });
    database = openDatabase(path.join(tempStateDir(), "state.sqlite"));
    const client = await connectInMemory(
      createMcpServer(config, {
        actorId: "test_actor",
        jobs: new JobRepository(database.db),
        assets: new AssetRepository(database.db),
        comfyRestClient: new ComfyRestClient(config)
      })
    );
    const apiGraph = {
      "1": {
        class_type: "SaveImage",
        inputs: {}
      }
    };

    const validation = await client.callTool({
      name: "workflows_validate",
      arguments: {
        api_graph: apiGraph
      }
    });
    const run = await client.callTool({
      name: "workflows_run",
      arguments: {
        workflow: {
          api_graph: apiGraph
        },
        inputs: {},
        idempotency_key: "run-once"
      }
    });
    const runContent = structured(run.structuredContent);
    const job = structured(runContent.job);
    const jobId = stringField(job, "job_id");
    const firstAsset = firstStructured(runContent.assets);
    const retrieved = await client.callTool({
      name: "jobs_get",
      arguments: {
        job_id: jobId
      }
    });

    expect(validation.structuredContent).toMatchObject({
      ok: true,
      validation: {
        ok: true,
        runtime: "local"
      }
    });
    expect(run.structuredContent).toMatchObject({
      ok: true,
      job: {
        job_id: jobId,
        state: "succeeded",
        prompt_id: "fake-prompt-1"
      },
      assets: [
        {
          kind: "image"
        }
      ]
    });
    expect(stringField(firstAsset, "resource_uri")).toContain("comfymcp://assets/");
    expect(retrieved.structuredContent).toMatchObject({
      ok: true,
      job: {
        job_id: jobId,
        state: "succeeded",
        prompt_id: "fake-prompt-1"
      },
      assets: [
        {
          node_id: "9",
          kind: "image",
          mime_type: "image/png"
        }
      ]
    });
  });
});

async function connectInMemory(server: McpServer): Promise<Client> {
  const client = new Client({
    name: "workflow-job-client",
    version: "0.1.0"
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  clients.push(client);
  servers.push(server);
  return client;
}

function tempStateDir(): string {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "comfymcp-workflow-"));
  tempDirs.push(stateDir);
  return stateDir;
}

function structured(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("Expected structured object");
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`Expected ${key} to be a string`);
}

function firstStructured(value: unknown): Record<string, unknown> {
  if (Array.isArray(value) && value.length > 0) {
    return structured(value[0]);
  }
  throw new Error("Expected non-empty structured array");
}
