import type { ComfyMcpConfig } from "../../config/schema.js";
import { ComfyRestClient } from "../../comfyui/rest-client.js";
import {
  createWebSocketClient,
  type ComfyWsClient,
  type ComfyWsPromptResult
} from "../../comfyui/websocket-client.js";
import {
  isActiveJobState,
  type AssetRepository,
  type JobRecord,
  type JobRepository
} from "../../persistence/repositories/index.js";
import { analyzePromptHistory, registerAssetsFromHistory } from "./history.js";

const sharedRunners = new WeakMap<JobRepository, WorkflowJobRunner>();

export type WorkflowJobRunnerOptions = {
  clientIdPrefix?: string;
  pollIntervalMs?: number;
  websocketTimeoutMs?: number;
  executionTimeoutMs?: number;
  websocketFactory?: (config: ComfyMcpConfig, clientId: string) => Promise<ComfyWsClient>;
};

export type WorkflowJobRunnerDependencies = {
  config: ComfyMcpConfig;
  jobs: JobRepository;
  assets: AssetRepository;
  rest?: ComfyRestClient;
  options?: WorkflowJobRunnerOptions;
};

export class WorkflowJobRunner {
  readonly #config: ComfyMcpConfig;
  readonly #jobs: JobRepository;
  readonly #assets: AssetRepository;
  readonly #rest: ComfyRestClient;
  readonly #activeJobIds = new Set<string>();
  readonly #options: Required<Omit<WorkflowJobRunnerOptions, "websocketFactory">> & {
    websocketFactory: (config: ComfyMcpConfig, clientId: string) => Promise<ComfyWsClient>;
  };

  constructor(dependencies: WorkflowJobRunnerDependencies) {
    this.#config = dependencies.config;
    this.#jobs = dependencies.jobs;
    this.#assets = dependencies.assets;
    this.#rest = dependencies.rest ?? new ComfyRestClient(dependencies.config);
    this.#options = {
      clientIdPrefix: dependencies.options?.clientIdPrefix ?? "comfymcp-local",
      pollIntervalMs: dependencies.options?.pollIntervalMs ?? 250,
      websocketTimeoutMs: dependencies.options?.websocketTimeoutMs ?? 30_000,
      executionTimeoutMs:
        dependencies.options?.executionTimeoutMs ?? dependencies.config.limits.workflowExecutionTimeoutMs,
      websocketFactory: dependencies.options?.websocketFactory ?? createWebSocketClient
    };
  }

  static shared(dependencies: WorkflowJobRunnerDependencies): WorkflowJobRunner {
    const existing = sharedRunners.get(dependencies.jobs);
    if (existing) {
      return existing;
    }
    const runner = new WorkflowJobRunner(dependencies);
    sharedRunners.set(dependencies.jobs, runner);
    return runner;
  }

  startWorkflowJob(input: { job: JobRecord; apiGraph: Record<string, unknown> }): void {
    if (this.#activeJobIds.has(input.job.jobId)) {
      return;
    }
    this.#activeJobIds.add(input.job.jobId);
    void this.runWorkflowJob(input).catch((error: unknown) => {
      this.failJob(input.job.jobId, error);
    }).finally(() => {
      this.#activeJobIds.delete(input.job.jobId);
    });
  }

  async runWorkflowJob(input: { job: JobRecord; apiGraph: Record<string, unknown> }): Promise<void> {
    if (!this.isActive(input.job.jobId)) {
      return;
    }

    const clientId = `${this.#options.clientIdPrefix}-${input.job.jobId}`;
    const watcher = await this.tryCreateWatcher(clientId);

    try {
      this.#jobs.update({
        jobId: input.job.jobId,
        state: "running"
      });

      const prompt = await this.withRetry(() => this.#rest.postPrompt(input.apiGraph, clientId));
      if (!this.isActive(input.job.jobId)) {
        return;
      }

      this.#jobs.update({
        jobId: input.job.jobId,
        state: "running",
        promptId: prompt.prompt_id
      });

      const signal = await this.waitForWatcher(watcher, prompt.prompt_id);
      if (!this.isActive(input.job.jobId)) {
        return;
      }

      const history =
        signal?.state === "failed"
          ? await this.historyOrSyntheticFailure(prompt.prompt_id, signal)
          : await this.pollHistory(prompt.prompt_id);
      this.completeFromHistory(input.job.jobId, prompt.prompt_id, history);
    } finally {
      watcher?.close();
    }
  }

  async reconcileUnfinishedJobs(): Promise<void> {
    for (const job of this.#jobs.markActiveForReconciliation()) {
      await this.reconcileJob(job);
    }
  }

  private async reconcileJob(job: JobRecord): Promise<void> {
    if (!job.promptId) {
      this.#jobs.update({
        jobId: job.jobId,
        state: "lost",
        error: {
          code: "LOST",
          message: "Job was queued before restart but no ComfyUI prompt id was persisted"
        }
      });
      return;
    }

    try {
      const history = await this.withRetry(() => this.#rest.getHistory(job.promptId));
      const analysis = analyzePromptHistory(history, job.promptId);
      if (analysis.state === "pending") {
        this.#jobs.update({
          jobId: job.jobId,
          state: "lost",
          promptId: job.promptId,
          error: {
            code: "LOST",
            message: "Job was active before restart but ComfyUI has no terminal history for it"
          }
        });
        return;
      }
      this.completeFromHistory(job.jobId, job.promptId, history);
    } catch (error) {
      this.#jobs.update({
        jobId: job.jobId,
        state: "lost",
        promptId: job.promptId,
        error: errorRecord("LOST", error, "Job reconciliation could not read ComfyUI history")
      });
    }
  }

  private async pollHistory(promptId: string): Promise<Record<string, unknown>> {
    const deadline = Date.now() + this.#options.executionTimeoutMs;
    let lastHistory: Record<string, unknown> = {};

    while (Date.now() <= deadline) {
      const history = await this.withRetry(() => this.#rest.getHistory(promptId));
      lastHistory = history;
      if (analyzePromptHistory(history, promptId).state !== "pending") {
        return history;
      }
      await sleep(this.#options.pollIntervalMs);
    }

    return {
      ...lastHistory,
      [promptId]: {
        status: {
          completed: false,
          status_str: "lost",
          messages: [
            [
              "execution_error",
              {
                prompt_id: promptId,
                message: "Workflow execution timed out before ComfyUI history became terminal"
              }
            ]
          ]
        },
        outputs: {}
      }
    };
  }

  private async historyOrSyntheticFailure(
    promptId: string,
    signal: Extract<ComfyWsPromptResult, { state: "failed" }>
  ): Promise<Record<string, unknown>> {
    try {
      const history = await this.withRetry(() => this.#rest.getHistory(promptId));
      if (analyzePromptHistory(history, promptId).state !== "pending") {
        return history;
      }
    } catch {
      // Use the WebSocket failure below.
    }
    return {
      [promptId]: {
        status: {
          completed: false,
          status_str: "error",
          messages: [["execution_error", signal.error]]
        },
        outputs: {}
      }
    };
  }

  private completeFromHistory(jobId: string, promptId: string, history: Record<string, unknown>): void {
    if (!this.isActive(jobId)) {
      return;
    }

    const analysis = analyzePromptHistory(history, promptId);
    if (analysis.state === "failed") {
      this.#jobs.update({
        jobId,
        state: errorCode(analysis.error) === "LOST" ? "lost" : "failed",
        promptId,
        error: analysis.error ?? {
          code: "INTERNAL",
          message: "Workflow execution failed"
        }
      });
      return;
    }

    if (analysis.state === "pending") {
      this.#jobs.update({
        jobId,
        state: "lost",
        promptId,
        error: {
          code: "LOST",
          message: "Workflow execution did not produce terminal ComfyUI history"
        }
      });
      return;
    }

    const assets = registerAssetsFromHistory(this.#assets, {
      jobId,
      promptId,
      history
    });
    this.#jobs.update({
      jobId,
      state: "succeeded",
      promptId,
      result: {
        prompt_id: promptId,
        assets: assets.map((asset) => ({
          asset_id: asset.assetId,
          resource_uri: asset.resourceUri,
          node_id: asset.nodeId,
          kind: asset.kind
        }))
      }
    });
  }

  private async tryCreateWatcher(clientId: string): Promise<ComfyWsClient | undefined> {
    try {
      return await this.#options.websocketFactory(this.#config, clientId);
    } catch {
      return undefined;
    }
  }

  private async waitForWatcher(
    watcher: ComfyWsClient | undefined,
    promptId: string
  ): Promise<ComfyWsPromptResult | undefined> {
    if (!watcher) {
      return undefined;
    }
    try {
      return await watcher.waitForPrompt(
        promptId,
        Math.min(this.#options.websocketTimeoutMs, this.#options.executionTimeoutMs)
      );
    } catch {
      return undefined;
    }
  }

  private isActive(jobId: string): boolean {
    const job = this.#jobs.findById(jobId);
    return job ? isActiveJobState(job.state) : false;
  }

  private failJob(jobId: string, error: unknown): void {
    if (!this.isActive(jobId)) {
      return;
    }
    this.#jobs.update({
      jobId,
      state: "failed",
      error: errorRecord("INTERNAL", error, "Workflow execution failed")
    });
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    const attempts = Math.max(1, this.#config.limits.downloadRetryCount + 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === attempts - 1) {
          break;
        }
        await sleep(Math.min(1_000, 50 * 2 ** attempt));
      }
    }
    throw lastError;
  }
}

export function startJobReconciliation(dependencies: WorkflowJobRunnerDependencies): void {
  const runner = WorkflowJobRunner.shared(dependencies);
  void runner.reconcileUnfinishedJobs().catch(() => undefined);
}

export async function reconcileUnfinishedJobs(dependencies: WorkflowJobRunnerDependencies): Promise<void> {
  await WorkflowJobRunner.shared(dependencies).reconcileUnfinishedJobs();
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function errorRecord(code: string, error: unknown, fallbackMessage: string): Record<string, unknown> {
  return {
    code,
    message: error instanceof Error ? error.message : fallbackMessage
  };
}

function errorCode(error: Record<string, unknown> | undefined): string | undefined {
  const code = error?.code;
  return typeof code === "string" ? code : undefined;
}
