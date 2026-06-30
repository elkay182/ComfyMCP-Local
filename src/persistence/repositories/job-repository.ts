import crypto from "node:crypto";
import type Database from "better-sqlite3";

export type JobState =
  | "queued"
  | "running"
  | "cancelling"
  | "reconciling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "lost";

export const JOB_STATES = [
  "queued",
  "running",
  "cancelling",
  "reconciling",
  "succeeded",
  "failed",
  "cancelled",
  "lost"
] as const satisfies readonly JobState[];

export const ACTIVE_JOB_STATES = [
  "queued",
  "running",
  "cancelling",
  "reconciling"
] as const satisfies readonly JobState[];

export function isActiveJobState(state: JobState): boolean {
  return (ACTIVE_JOB_STATES as readonly string[]).includes(state);
}

export type JobRecord = {
  jobId: string;
  actorId: string;
  kind: string;
  state: JobState;
  workflowId?: string;
  promptId?: string;
  idempotencyKey: string;
  request: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type JobListResult = {
  jobs: JobRecord[];
  nextCursor?: string;
};

type JobRow = {
  job_id: string;
  actor_id: string;
  kind: string;
  state: JobState;
  workflow_id: string | null;
  prompt_id: string | null;
  idempotency_key: string;
  request_json: string;
  result_json: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
};

export class JobRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  create(input: {
    actorId: string;
    kind: string;
    workflowId?: string;
    idempotencyKey: string;
    request: Record<string, unknown>;
  }): JobRecord {
    const now = new Date().toISOString();
    const job: JobRecord = {
      jobId: `job_${crypto.randomBytes(16).toString("base64url")}`,
      actorId: input.actorId,
      kind: input.kind,
      state: "queued",
      workflowId: input.workflowId,
      idempotencyKey: input.idempotencyKey,
      request: input.request,
      createdAt: now,
      updatedAt: now
    };

    this.#db
      .prepare<{
        job_id: string;
        actor_id: string;
        kind: string;
        state: string;
        workflow_id: string | null;
        prompt_id: string | null;
        idempotency_key: string;
        request_json: string;
        result_json: string | null;
        error_json: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `
          INSERT INTO jobs (
            job_id, actor_id, kind, state, workflow_id, prompt_id, idempotency_key,
            request_json, result_json, error_json, created_at, updated_at
          ) VALUES (
            @job_id, @actor_id, @kind, @state, @workflow_id, @prompt_id, @idempotency_key,
            @request_json, @result_json, @error_json, @created_at, @updated_at
          )
        `
      )
      .run({
        job_id: job.jobId,
        actor_id: job.actorId,
        kind: job.kind,
        state: job.state,
        workflow_id: job.workflowId ?? null,
        prompt_id: null,
        idempotency_key: job.idempotencyKey,
        request_json: JSON.stringify(job.request),
        result_json: null,
        error_json: null,
        created_at: job.createdAt,
        updated_at: job.updatedAt
      });

    return job;
  }

  findById(jobId: string): JobRecord | undefined {
    const row = this.#db
      .prepare<[string], JobRow>(
        `
          SELECT job_id, actor_id, kind, state, workflow_id, prompt_id, idempotency_key,
                 request_json, result_json, error_json, created_at, updated_at
          FROM jobs
          WHERE job_id = ?
        `
      )
      .get(jobId);
    return row ? rowToRecord(row) : undefined;
  }

  list(input: { state?: JobState; cursor?: string; limit?: number } = {}): JobListResult {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const offset = cursorToOffset(input.cursor);
    const rows = input.state
      ? this.#db
          .prepare<{ state: string; limit: number; offset: number }, JobRow>(
            `
              SELECT job_id, actor_id, kind, state, workflow_id, prompt_id, idempotency_key,
                     request_json, result_json, error_json, created_at, updated_at
              FROM jobs
              WHERE state = @state
              ORDER BY created_at DESC, job_id DESC
              LIMIT @limit OFFSET @offset
            `
          )
          .all({ state: input.state, limit: limit + 1, offset })
      : this.#db
          .prepare<{ limit: number; offset: number }, JobRow>(
            `
              SELECT job_id, actor_id, kind, state, workflow_id, prompt_id, idempotency_key,
                     request_json, result_json, error_json, created_at, updated_at
              FROM jobs
              ORDER BY created_at DESC, job_id DESC
              LIMIT @limit OFFSET @offset
            `
          )
          .all({ limit: limit + 1, offset });
    const page = rows.slice(0, limit).map(rowToRecord);
    return {
      jobs: page,
      ...(rows.length > limit ? { nextCursor: String(offset + limit) } : {})
    };
  }

  listByStates(states: readonly JobState[]): JobRecord[] {
    if (states.length === 0) {
      return [];
    }
    const placeholders = states.map(() => "?").join(", ");
    return this.#db
      .prepare<JobState[], JobRow>(
        `
          SELECT job_id, actor_id, kind, state, workflow_id, prompt_id, idempotency_key,
                 request_json, result_json, error_json, created_at, updated_at
          FROM jobs
          WHERE state IN (${placeholders})
          ORDER BY created_at ASC, job_id ASC
        `
      )
      .all(...states)
      .map(rowToRecord);
  }

  markActiveForReconciliation(): JobRecord[] {
    const candidates = this.listByStates(ACTIVE_JOB_STATES);
    if (candidates.length === 0) {
      return [];
    }
    const now = new Date().toISOString();
    const placeholders = ACTIVE_JOB_STATES.map(() => "?").join(", ");
    this.#db
      .prepare<[string, ...JobState[]]>(
        `
          UPDATE jobs
          SET state = 'reconciling',
              updated_at = ?
          WHERE state IN (${placeholders})
        `
      )
      .run(now, ...ACTIVE_JOB_STATES);
    return candidates.flatMap((job) => {
      const updated = this.findById(job.jobId);
      return updated ? [updated] : [];
    });
  }

  update(input: {
    jobId: string;
    state: JobState;
    promptId?: string;
    result?: Record<string, unknown>;
    error?: Record<string, unknown>;
  }): JobRecord | undefined {
    this.#db
      .prepare<{
        state: string;
        prompt_id: string | null;
        result_json: string | null;
        error_json: string | null;
        updated_at: string;
        job_id: string;
      }>(
        `
          UPDATE jobs
          SET state = @state,
              prompt_id = COALESCE(@prompt_id, prompt_id),
              result_json = @result_json,
              error_json = @error_json,
              updated_at = @updated_at
          WHERE job_id = @job_id
        `
      )
      .run({
        state: input.state,
        prompt_id: input.promptId ?? null,
        result_json: input.result ? JSON.stringify(input.result) : null,
        error_json: input.error ? JSON.stringify(input.error) : null,
        updated_at: new Date().toISOString(),
        job_id: input.jobId
      });
    return this.findById(input.jobId);
  }

  cancel(jobId: string): JobRecord | undefined {
    const existing = this.findById(jobId);
    if (!existing) {
      return undefined;
    }
    if (!isActiveJobState(existing.state)) {
      return existing;
    }
    return this.update({
      jobId,
      state: "cancelled",
      promptId: existing.promptId,
      error: {
        code: "CANCELLED",
        message: "Job was cancelled before completion"
      }
    });
  }
}

function cursorToOffset(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number(cursor);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function rowToRecord(row: JobRow): JobRecord {
  return {
    jobId: row.job_id,
    actorId: row.actor_id,
    kind: row.kind,
    state: row.state,
    workflowId: row.workflow_id ?? undefined,
    promptId: row.prompt_id ?? undefined,
    idempotencyKey: row.idempotency_key,
    request: parseObject(row.request_json),
    result: row.result_json ? parseObject(row.result_json) : undefined,
    error: row.error_json ? parseObject(row.error_json) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseObject(json: string): Record<string, unknown> {
  const value = JSON.parse(json) as unknown;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
