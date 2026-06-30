import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { ComfyRestClient } from "../../src/comfyui/rest-client.js";
import { parseEnv, type ComfyMcpConfig } from "../../src/config/schema.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { openDatabase, type DatabaseHandle } from "../../src/persistence/database.js";
import { AssetRepository, JobRepository } from "../../src/persistence/repositories/index.js";
import { reconcileUnfinishedJobs } from "../../src/services/jobs/job-runner.js";
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

describe("workflow/job Milestone 1 core", () => {
  it("queues immediately, completes multi-output assets, lists jobs, and reads asset resources", async () => {
    const { client } = await setupWorkflowClient();
    const apiGraph = {
      "1": {
        class_type: "SaveImage",
        inputs: {}
      },
      "2": {
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
    const completedContent = await waitForJobState(client, jobId, "succeeded");
    const assets = structuredArray(completedContent.assets);
    const firstAsset = structured(assets[0]);
    const resource = await client.readResource({
      uri: stringField(firstAsset, "resource_uri")
    });
    const assetResource = structured(JSON.parse(resourceTextAt(resource, 1)) as unknown);
    const listed = await client.callTool({
      name: "jobs_list",
      arguments: {
        state: "succeeded",
        limit: 10
      }
    });
    const listedJobs = structuredArray(structured(listed.structuredContent).jobs);

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
        state: "queued"
      },
      assets: []
    });
    expect(job.prompt_id).toBeUndefined();
    expect(assets).toHaveLength(2);
    expect(stringField(firstAsset, "resource_uri")).toContain("comfymcp://assets/");
    expect(completedContent).toMatchObject({
      job: {
        job_id: jobId,
        state: "succeeded",
        prompt_id: "fake-prompt-1"
      },
      assets: [
        {
          node_id: "1",
          kind: "image",
          mime_type: "image/png"
        },
        {
          node_id: "2",
          kind: "image",
          mime_type: "image/png"
        }
      ]
    });
    expect(assetResource).toMatchObject({
      asset: {
        asset_id: stringField(firstAsset, "asset_id"),
        job_id: jobId,
        kind: "image"
      }
    });
    expect(resourceBlobAt(resource, 0)).toBe(Buffer.from("fake-png-bytes", "utf8").toString("base64"));
    expect(listedJobs.some((listedJob) => stringField(structured(listedJob), "job_id") === jobId)).toBe(true);
  });

  it("persists failed workflow errors from terminal ComfyUI history", async () => {
    const { client } = await setupWorkflowClient();
    const run = await client.callTool({
      name: "workflows_run",
      arguments: {
        workflow: {
          api_graph: {
            "1": {
              class_type: "FailNode",
              inputs: {}
            }
          }
        },
        inputs: {},
        idempotency_key: "run-failure"
      }
    });
    const jobId = stringField(structured(structured(run.structuredContent).job), "job_id");
    const failedContent = await waitForJobState(client, jobId, "failed");

    expect(failedContent).toMatchObject({
      job: {
        job_id: jobId,
        state: "failed",
        prompt_id: "fake-prompt-1",
        error: {
          message: "Fake workflow failed"
        }
      },
      assets: []
    });
  });

  it("replays duplicate workflows_run calls by idempotency key without starting a second job", async () => {
    const { client } = await setupWorkflowClient();
    const args = {
      workflow: {
        api_graph: {
          "1": {
            class_type: "SaveImage",
            inputs: {}
          }
        }
      },
      inputs: {},
      idempotency_key: "duplicate-run"
    };

    const first = await client.callTool({
      name: "workflows_run",
      arguments: args
    });
    const second = await client.callTool({
      name: "workflows_run",
      arguments: args
    });
    const firstJobId = stringField(structured(structured(first.structuredContent).job), "job_id");
    const secondJobId = stringField(structured(structured(second.structuredContent).job), "job_id");
    const completed = await waitForJobState(client, firstJobId, "succeeded");

    expect(second.structuredContent).toMatchObject({
      ok: true,
      summary: "Idempotent workflow job replayed"
    });
    expect(secondJobId).toBe(firstJobId);
    expect(completed).toMatchObject({
      job: {
        job_id: firstJobId,
        prompt_id: "fake-prompt-1",
        state: "succeeded"
      }
    });
  });

  it("reconciles an active persisted job from ComfyUI history after restart", async () => {
    fakeComfyUi = await startFakeComfyUiServer();
    const config = testConfig(fakeComfyUi.url);
    database = openDatabase(path.join(tempStateDir(), "state.sqlite"));
    const jobs = new JobRepository(database.db);
    const assets = new AssetRepository(database.db);
    const rest = new ComfyRestClient(config);
    const prompt = await rest.postPrompt(
      {
        "1": {
          class_type: "SaveImage",
          inputs: {}
        }
      },
      "reconcile-client"
    );
    const job = jobs.create({
      actorId: "test_actor",
      kind: "generation",
      idempotencyKey: "restart-reconcile",
      request: {
        workflow: {
          api_graph: {
            "1": {
              class_type: "SaveImage",
              inputs: {}
            }
          }
        },
        inputs: {},
        idempotency_key: "restart-reconcile"
      }
    });
    jobs.update({
      jobId: job.jobId,
      state: "running",
      promptId: prompt.prompt_id
    });

    await reconcileUnfinishedJobs({
      config,
      jobs,
      assets,
      rest,
      options: jobRunnerOptions()
    });

    expect(jobs.findById(job.jobId)).toMatchObject({
      state: "succeeded",
      promptId: "fake-prompt-1"
    });
    expect(assets.listByJobId(job.jobId)).toHaveLength(1);
  });

  it("cancels an active persisted job", async () => {
    const { client, jobs } = await setupWorkflowClient();
    const job = jobs.create({
      actorId: "test_actor",
      kind: "generation",
      idempotencyKey: "cancel-me",
      request: {
        workflow: {
          api_graph: {
            "1": {
              class_type: "SaveImage",
              inputs: {}
            }
          }
        },
        inputs: {},
        idempotency_key: "cancel-me"
      }
    });
    const cancelled = await client.callTool({
      name: "jobs_cancel",
      arguments: {
        job_id: job.jobId,
        idempotency_key: "cancel-once"
      }
    });

    expect(cancelled.structuredContent).toMatchObject({
      ok: true,
      job: {
        job_id: job.jobId,
        state: "cancelled"
      }
    });
  });
});

async function setupWorkflowClient(): Promise<{
  client: Client;
  config: ComfyMcpConfig;
  jobs: JobRepository;
  assets: AssetRepository;
}> {
  fakeComfyUi = await startFakeComfyUiServer();
  const config = testConfig(fakeComfyUi.url);
  database = openDatabase(path.join(tempStateDir(), "state.sqlite"));
  const jobs = new JobRepository(database.db);
  const assets = new AssetRepository(database.db);
  const client = await connectInMemory(
    createMcpServer(config, {
      actorId: "test_actor",
      jobs,
      assets,
      comfyRestClient: new ComfyRestClient(config),
      jobRunnerOptions: jobRunnerOptions()
    })
  );
  return {
    client,
    config,
    jobs,
    assets
  };
}

function testConfig(comfyUiUrl: string): ComfyMcpConfig {
  const config = parseEnv({
    COMFYMCP_COMFYUI_URL: comfyUiUrl
  });
  config.limits.workflowExecutionTimeoutMs = 1_000;
  return config;
}

function jobRunnerOptions(): { pollIntervalMs: number; websocketTimeoutMs: number; executionTimeoutMs: number } {
  return {
    pollIntervalMs: 10,
    websocketTimeoutMs: 500,
    executionTimeoutMs: 1_000
  };
}

async function waitForJobState(
  client: Client,
  jobId: string,
  state: string
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 1_500;
  let lastContent: Record<string, unknown> | undefined;
  while (Date.now() <= deadline) {
    const retrieved = await client.callTool({
      name: "jobs_get",
      arguments: {
        job_id: jobId
      }
    });
    lastContent = structured(retrieved.structuredContent);
    const job = structured(lastContent.job);
    if (job.state === state) {
      return lastContent;
    }
    await sleep(10);
  }
  throw new Error(`Timed out waiting for job ${jobId} to reach ${state}; last=${JSON.stringify(lastContent)}`);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

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

function structuredArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  throw new Error("Expected structured array");
}

function resourceTextAt(resource: unknown, index: number): string {
  const contents = structuredArray(structured(resource).contents);
  const content = structured(contents[index]);
  const text = content.text;
  if (typeof text === "string") {
    return text;
  }
  throw new Error("Expected text resource content");
}

function resourceBlobAt(resource: unknown, index: number): string {
  const contents = structuredArray(structured(resource).contents);
  const content = structured(contents[index]);
  const blob = content.blob;
  if (typeof blob === "string") {
    return blob;
  }
  throw new Error("Expected blob resource content");
}
