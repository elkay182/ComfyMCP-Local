import crypto from "node:crypto";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ErrorCode as McpErrorCode,
  McpError,
  type CallToolResult,
  type ReadResourceResult,
  type ToolAnnotations
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ComfyMcpConfig } from "../config/schema.js";
import { ComfyRestClient } from "../comfyui/rest-client.js";
import { ComfyUiError } from "../comfyui/errors.js";
import type { MutationClass } from "../policy/authorization.js";
import { decideWorkflowPolicy } from "../policy/workflow-policy.js";
import type { AssetRepository } from "../persistence/repositories/asset-repository.js";
import {
  JOB_STATES,
  type JobRecord,
  type JobRepository
} from "../persistence/repositories/job-repository.js";
import { errorEnvelope, okEnvelope, type ErrorCode } from "../schemas/envelope.js";
import { workflowRunInputSchema, type WorkflowRunInput } from "../schemas/workflow.js";
import {
  WorkflowJobRunner,
  type WorkflowJobRunnerOptions
} from "../services/jobs/job-runner.js";
import { getSystemStatusWithConnection } from "../services/system/status.js";
import { listTools, type ToolDefinition } from "../tools/index.js";
import { systemCapabilities } from "../tools/system.js";

export type SystemToolDependencies = {
  getStatus?: () => Promise<Record<string, unknown>>;
  getCapabilities?: () => Record<string, unknown>;
  getLogs?: () => Record<string, unknown>;
  clearVram?: () => Promise<unknown>;
  jobs?: JobRepository;
  assets?: AssetRepository;
  comfyRestClient?: ComfyRestClient;
  jobRunnerOptions?: WorkflowJobRunnerOptions;
  actorId?: string;
};

const workflowValidateInputSchema = z.object({
  api_graph: z.record(z.string(), z.unknown())
});

const jobsGetInputSchema = z.object({
  job_id: z.string().min(1)
});

const jobsListInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
  state: z.enum(JOB_STATES).optional()
});

const jobsCancelInputSchema = z.object({
  job_id: z.string().min(1),
  idempotency_key: z.string().min(1).optional()
});

export function createMcpServer(
  config: ComfyMcpConfig,
  dependencies: SystemToolDependencies = {}
): McpServer {
  const server = new McpServer(
    {
      name: "comfymcp-local",
      version: "0.1.0"
    },
    {
      instructions:
        "Control a loopback-only local ComfyUI instance. Administrative mutations and networked operations are gated by server policy."
    }
  );

  for (const definition of listTools(config)) {
    server.registerTool(
      definition.name,
      {
        title: toTitle(definition.name),
        description: describeTool(definition),
        inputSchema: inputSchemaFor(definition),
        annotations: annotationsFor(definition)
      },
      async (args) => callTool(config, definition, dependencies, args)
    );
  }

  registerAssetResource(server, dependencies);

  return server;
}

function registerAssetResource(server: McpServer, dependencies: SystemToolDependencies): void {
  server.registerResource(
    "asset",
    new ResourceTemplate("comfymcp://assets/{asset_id}", {
      list: undefined
    }),
    {
      title: "ComfyMCP Asset",
      description: "Durable metadata and provenance for a generated ComfyMCP asset.",
      mimeType: "application/json"
    },
    (uri) => readAssetResource(dependencies, uri)
  );
}

function readAssetResource(dependencies: SystemToolDependencies, uri: URL): ReadResourceResult {
  if (!dependencies.assets) {
    throw new McpError(McpErrorCode.InvalidParams, "Persistent asset storage is not configured");
  }
  const assetId = assetIdFromUri(uri);
  if (!assetId) {
    throw new McpError(McpErrorCode.InvalidParams, `Resource ${uri.toString()} is not an asset URI`);
  }
  const asset = dependencies.assets.findById(assetId);
  if (!asset) {
    throw new McpError(McpErrorCode.InvalidParams, `Asset ${assetId} not found`);
  }
  return {
    contents: [
      {
        uri: asset.resourceUri,
        mimeType: "application/json",
        text: JSON.stringify(
          {
            asset: {
              asset_id: asset.assetId,
              job_id: asset.jobId,
              prompt_id: asset.promptId,
              node_id: asset.nodeId,
              kind: asset.kind,
              mime_type: asset.mimeType,
              comfyui_filename: asset.comfyuiFilename,
              subfolder: asset.subfolder,
              storage_type: asset.storageType,
              resource_uri: asset.resourceUri,
              metadata: asset.metadata,
              created_at: asset.createdAt
            }
          },
          null,
          2
        )
      }
    ]
  };
}

function assetIdFromUri(uri: URL): string | undefined {
  if (uri.protocol !== "comfymcp:" || uri.hostname !== "assets") {
    return undefined;
  }
  const assetId = decodeURIComponent(uri.pathname.replace(/^\//, ""));
  return assetId.length > 0 ? assetId : undefined;
}

async function callTool(
  config: ComfyMcpConfig,
  definition: ToolDefinition,
  dependencies: SystemToolDependencies,
  args: unknown
): Promise<CallToolResult> {
  switch (definition.name) {
    case "system_status":
      return systemStatusResult(config, dependencies);
    case "system_capabilities":
      return systemCapabilitiesResult(config, dependencies);
    case "system_logs":
      return systemLogsResult(dependencies);
    case "system_clear_vram":
      return systemClearVramResult(config, dependencies);
    case "workflows_validate":
      return workflowsValidateResult(args);
    case "workflows_run":
      return workflowsRunResult(config, dependencies, args);
    case "jobs_list":
      return jobsListResult(dependencies, args);
    case "jobs_get":
      return jobsGetResult(dependencies, args);
    case "jobs_cancel":
      return jobsCancelResult(config, dependencies, args);
    default:
      return errorResult(
        "CAPABILITY_UNAVAILABLE",
        `${definition.name} is registered for contract discovery but is not implemented in this milestone`
      );
  }
}

function workflowsValidateResult(args: unknown): CallToolResult {
  const input = workflowValidateInputSchema.safeParse(args);
  if (!input.success) {
    return errorResult("INVALID_WORKFLOW", "workflow validation requires an api_graph object");
  }
  const decision = decideWorkflowPolicy(input.data.api_graph);
  return structuredResult(
    okEnvelope(requestId(), decision.ok ? "Workflow is allowed by local policy" : "Workflow rejected by local policy", {
      validation: {
        ok: decision.ok,
        runtime: decision.runtime,
        ...(decision.ok
          ? {}
          : {
              code: decision.code,
              message: decision.message,
              node_id: decision.nodeId,
              node_type: decision.nodeType
            })
      }
    })
  );
}

function workflowsRunResult(
  config: ComfyMcpConfig,
  dependencies: SystemToolDependencies,
  args: unknown
): CallToolResult {
  if (!dependencies.jobs || !dependencies.assets) {
    return errorResult("CAPABILITY_UNAVAILABLE", "Persistent job storage is not configured");
  }

  const parsed = workflowRunInputSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult("INVALID_WORKFLOW", "Invalid workflows_run input");
  }

  const graphResult = apiGraphFromRunInput(parsed.data);
  if (!graphResult.ok) {
    return errorResult("NOT_FOUND", graphResult.message);
  }

  const policy = decideWorkflowPolicy(graphResult.apiGraph);
  if (!policy.ok) {
    return errorResult("POLICY_VIOLATION", policy.message);
  }

  const job = dependencies.jobs.create({
    actorId: dependencies.actorId ?? "local_stdio",
    kind: "generation",
    workflowId: graphResult.workflowId,
    idempotencyKey: parsed.data.idempotency_key,
    request: parsed.data
  });

  const rest = dependencies.comfyRestClient ?? new ComfyRestClient(config);
  new WorkflowJobRunner({
    config,
    jobs: dependencies.jobs,
    assets: dependencies.assets,
    rest,
    options: dependencies.jobRunnerOptions
  }).startWorkflowJob({
    job,
    apiGraph: graphResult.apiGraph
  });

  return structuredResult(
    okEnvelope(requestId(), "Workflow queued locally", {
      job: jobSummary(job),
      assets: []
    })
  );
}

function jobsListResult(dependencies: SystemToolDependencies, args: unknown): CallToolResult {
  if (!dependencies.jobs) {
    return errorResult("CAPABILITY_UNAVAILABLE", "Persistent job storage is not configured");
  }
  const parsed = jobsListInputSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult("INVALID_WORKFLOW", "Invalid jobs_list input");
  }
  const result = dependencies.jobs.list(parsed.data);
  return structuredResult(
    okEnvelope(requestId(), "Jobs listed", {
      jobs: result.jobs.map(jobSummary),
      next_cursor: result.nextCursor
    })
  );
}

function jobsGetResult(dependencies: SystemToolDependencies, args: unknown): CallToolResult {
  if (!dependencies.jobs || !dependencies.assets) {
    return errorResult("CAPABILITY_UNAVAILABLE", "Persistent job storage is not configured");
  }
  const parsed = jobsGetInputSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult("NOT_FOUND", "jobs_get requires a job_id");
  }
  const job = dependencies.jobs.findById(parsed.data.job_id);
  if (!job) {
    return errorResult("NOT_FOUND", "Job not found");
  }
  const assets = dependencies.assets.listByJobId(job.jobId);
  return structuredResult(
    okEnvelope(requestId(), "Job status reported", {
      job: jobSummary(job),
      assets: assets.map((asset) => ({
        asset_id: asset.assetId,
        resource_uri: asset.resourceUri,
        node_id: asset.nodeId,
        kind: asset.kind,
        mime_type: asset.mimeType
      }))
    })
  );
}

async function jobsCancelResult(
  config: ComfyMcpConfig,
  dependencies: SystemToolDependencies,
  args: unknown
): Promise<CallToolResult> {
  if (!dependencies.jobs) {
    return errorResult("CAPABILITY_UNAVAILABLE", "Persistent job storage is not configured");
  }
  const parsed = jobsCancelInputSchema.safeParse(args);
  if (!parsed.success) {
    return errorResult("NOT_FOUND", "jobs_cancel requires a job_id");
  }

  const existing = dependencies.jobs.findById(parsed.data.job_id);
  if (!existing) {
    return errorResult("NOT_FOUND", "Job not found");
  }

  const warnings: string[] = [];
  if (existing.promptId) {
    const rest = dependencies.comfyRestClient ?? new ComfyRestClient(config);
    try {
      await rest.deletePrompt(existing.promptId);
      await rest.interrupt();
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "ComfyUI cancellation request failed");
    }
  }

  const cancelled = dependencies.jobs.cancel(existing.jobId) ?? existing;
  const content = okEnvelope(requestId(), "Job cancellation requested", {
    job: jobSummary(cancelled)
  });
  content.warnings.push(...warnings);
  return structuredResult(content);
}

function jobSummary(job: JobRecord): Record<string, unknown> {
  return {
    job_id: job.jobId,
    kind: job.kind,
    state: job.state,
    prompt_id: job.promptId,
    resource_uri: `comfymcp://jobs/${job.jobId}`,
    result: job.result,
    error: job.error,
    created_at: job.createdAt,
    updated_at: job.updatedAt
  };
}

async function systemStatusResult(
  config: ComfyMcpConfig,
  dependencies: SystemToolDependencies
): Promise<CallToolResult> {
  const status = dependencies.getStatus
    ? await dependencies.getStatus()
    : await getSystemStatusWithConnection(config);
  return structuredResult(
    okEnvelope(requestId(), "System status reported", {
      status
    })
  );
}

function systemCapabilitiesResult(
  config: ComfyMcpConfig,
  dependencies: SystemToolDependencies
): CallToolResult {
  const capabilities = dependencies.getCapabilities
    ? dependencies.getCapabilities()
    : systemCapabilities(config);
  return structuredResult(
    okEnvelope(requestId(), "System capabilities reported", {
      capabilities
    })
  );
}

function inputSchemaFor(definition: ToolDefinition): z.ZodTypeAny | undefined {
  if (definition.name === "workflows_validate") {
    return workflowValidateInputSchema;
  }
  if (definition.name === "workflows_run") {
    return workflowRunInputSchema;
  }
  if (definition.name === "jobs_list") {
    return jobsListInputSchema;
  }
  if (definition.name === "jobs_get") {
    return jobsGetInputSchema;
  }
  if (definition.name === "jobs_cancel") {
    return jobsCancelInputSchema;
  }
  return undefined;
}

function systemLogsResult(dependencies: SystemToolDependencies): CallToolResult {
  const logs =
    dependencies.getLogs?.() ?? {
      entries: [],
      truncated: false,
      message: "Persistent log reading is not implemented in this milestone"
    };
  return structuredResult(
    okEnvelope(requestId(), "System logs reported", {
      logs
    })
  );
}

async function systemClearVramResult(
  config: ComfyMcpConfig,
  dependencies: SystemToolDependencies
): Promise<CallToolResult> {
  try {
    const result = dependencies.clearVram
      ? await dependencies.clearVram()
      : await new ComfyRestClient(config).clearVram();
    return structuredResult(
      okEnvelope(requestId(), "ComfyUI VRAM clear requested", {
        result
      })
    );
  } catch (error) {
    return errorResult(mapComfyErrorCode(error), error instanceof Error ? error.message : "VRAM clear failed");
  }
}

function structuredResult(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof structuredContent.summary === "string" ? structuredContent.summary : "Tool completed"
      }
    ],
    structuredContent
  };
}

function errorResult(code: ErrorCode, message: string): CallToolResult {
  const structuredContent = errorEnvelope(code, message);
  return {
    content: [
      {
        type: "text",
        text: message
      }
    ],
    structuredContent,
    isError: true
  };
}

function mapComfyErrorCode(error: unknown): ErrorCode {
  if (error instanceof ComfyUiError && error.code === "COMFY_UNAVAILABLE") {
    return "COMFY_UNAVAILABLE";
  }
  return "INTERNAL";
}

function apiGraphFromRunInput(
  input: WorkflowRunInput
): { ok: true; apiGraph: Record<string, unknown>; workflowId?: string } | { ok: false; message: string } {
  if ("api_graph" in input.workflow) {
    return {
      ok: true,
      apiGraph: input.workflow.api_graph
    };
  }
  return {
    ok: false,
    message: "Registered workflow execution is not implemented yet"
  };
}

function annotationsFor(definition: ToolDefinition): ToolAnnotations {
  const mutationClass = definition.mutationClass;
  return {
    title: toTitle(definition.name),
    readOnlyHint: mutationClass === "read_only" || mutationClass === "networked_read_only",
    destructiveHint: mutationClass === "destructive_administrative",
    idempotentHint: isIdempotent(mutationClass),
    openWorldHint: mutationClass === "networked_read_only" || mutationClass === "administrative"
  };
}

function isIdempotent(mutationClass: MutationClass): boolean {
  return mutationClass === "read_only" || mutationClass === "networked_read_only";
}

function describeTool(definition: ToolDefinition): string {
  return `${definition.purpose} Mutation class: ${definition.mutationClass}.`;
}

function toTitle(name: string): string {
  return name
    .split("_")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function requestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
}
