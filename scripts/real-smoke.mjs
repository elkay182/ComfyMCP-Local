import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ComfyRestClient } from "../dist/comfyui/rest-client.js";
import { parseEnv } from "../dist/config/schema.js";
import { createMcpServer } from "../dist/mcp/server.js";
import { openDatabase } from "../dist/persistence/database.js";
import { AssetRepository, JobRepository } from "../dist/persistence/repositories/index.js";

const workflowJson = process.env.COMFYMCP_SMOKE_API_GRAPH_JSON;
if (!workflowJson) {
  fail("Set COMFYMCP_SMOKE_API_GRAPH_JSON to a tiny API workflow JSON object before running smoke:real");
}

const apiGraph = parseJsonObject(workflowJson, "COMFYMCP_SMOKE_API_GRAPH_JSON");
const config = parseEnv(process.env);
const stateDir = process.env.COMFYMCP_SMOKE_STATE_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "comfymcp-smoke-"));
const database = openDatabase(path.join(stateDir, "state.sqlite"));
const server = createMcpServer(config, {
  actorId: "smoke_actor",
  jobs: new JobRepository(database.db),
  assets: new AssetRepository(database.db),
  comfyRestClient: new ComfyRestClient(config)
});
const client = new Client({
  name: "comfymcp-real-smoke",
  version: "0.1.0"
});
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  await call("system_status", {});
  await call("workflows_validate", { api_graph: apiGraph });

  const run = await call("workflows_run", {
    workflow: {
      api_graph: apiGraph
    },
    inputs: {},
    idempotency_key: `smoke-${Date.now()}`
  });
  const jobId = stringAt(recordAt(run, "job"), "job_id");
  const terminal = await waitForTerminalJob(jobId);

  await call("jobs_list", { limit: 5 });
  await call("jobs_cancel", { job_id: jobId, idempotency_key: `smoke-cancel-${Date.now()}` });

  const state = stringAt(recordAt(terminal, "job"), "state");
  const assets = arrayAt(terminal, "assets");
  if (state !== "succeeded") {
    fail(`Smoke workflow ended in ${state}; expected succeeded`);
  }
  if (assets.length === 0) {
    fail("Smoke workflow succeeded but registered no assets");
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        job_id: jobId,
        state,
        assets: assets.length
      },
      null,
      2
    )}\n`
  );
} finally {
  await client.close();
  await server.close();
  database.close();
}

async function call(name, args) {
  const result = await client.callTool({
    name,
    arguments: args
  });
  if (result.isError) {
    fail(`${name} failed: ${JSON.stringify(result.structuredContent)}`);
  }
  return object(result.structuredContent);
}

async function waitForTerminalJob(jobId) {
  const deadline = Date.now() + Number(process.env.COMFYMCP_SMOKE_TIMEOUT_MS ?? "120000");
  let latest;
  while (Date.now() <= deadline) {
    latest = await call("jobs_get", { job_id: jobId });
    const state = stringAt(recordAt(latest, "job"), "state");
    if (["succeeded", "failed", "cancelled", "lost"].includes(state)) {
      return latest;
    }
    await sleep(500);
  }
  fail(`Timed out waiting for smoke job ${jobId}; latest=${JSON.stringify(latest)}`);
}

function parseJsonObject(value, name) {
  try {
    return object(JSON.parse(value));
  } catch (error) {
    fail(`${name} must be a JSON object: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function recordAt(record, key) {
  return object(record[key]);
}

function arrayAt(record, key) {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function stringAt(record, key) {
  const value = record[key];
  if (typeof value === "string") {
    return value;
  }
  fail(`Expected ${key} to be a string`);
}

function object(value) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }
  fail("Expected a JSON object");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function fail(message) {
  throw new Error(message);
}
