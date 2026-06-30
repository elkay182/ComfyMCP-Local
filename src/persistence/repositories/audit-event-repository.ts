import crypto from "node:crypto";
import type Database from "better-sqlite3";

export type AuditEventInput = {
  actorId?: string;
  tokenId?: string;
  transport: "stdio" | "streamable_http";
  requestId?: string;
  sessionIdHash?: string;
  action: string;
  planId?: string;
  outcome: "allowed" | "denied" | "failed" | "succeeded";
  details?: Record<string, unknown>;
};

export type AuditEventRecord = {
  id: number;
  occurredAt: string;
  actorId?: string;
  tokenIdHash?: string;
  transport: "stdio" | "streamable_http";
  requestId?: string;
  sessionIdHash?: string;
  action: string;
  planId?: string;
  outcome: "allowed" | "denied" | "failed" | "succeeded";
  details: Record<string, unknown>;
};

type AuditEventRow = {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  token_id_hash: string | null;
  transport: "stdio" | "streamable_http";
  request_id: string | null;
  session_id_hash: string | null;
  action: string;
  plan_id: string | null;
  outcome: "allowed" | "denied" | "failed" | "succeeded";
  details_json: string;
};

export class AuditEventRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  append(input: AuditEventInput): number {
    const result = this.#db
      .prepare<{
        occurred_at: string;
        actor_id: string | null;
        token_id_hash: string | null;
        transport: string;
        request_id: string | null;
        session_id_hash: string | null;
        action: string;
        plan_id: string | null;
        outcome: string;
        details_json: string;
      }>(
        `
          INSERT INTO audit_events (
            occurred_at,
            actor_id,
            token_id_hash,
            transport,
            request_id,
            session_id_hash,
            action,
            plan_id,
            outcome,
            details_json
          ) VALUES (
            @occurred_at,
            @actor_id,
            @token_id_hash,
            @transport,
            @request_id,
            @session_id_hash,
            @action,
            @plan_id,
            @outcome,
            @details_json
          )
        `
      )
      .run({
        occurred_at: new Date().toISOString(),
        actor_id: input.actorId ?? null,
        token_id_hash: input.tokenId ? hashIdentifier(input.tokenId) : null,
        transport: input.transport,
        request_id: input.requestId ?? null,
        session_id_hash: input.sessionIdHash ?? null,
        action: input.action,
        plan_id: input.planId ?? null,
        outcome: input.outcome,
        details_json: JSON.stringify(input.details ?? {})
      });

    return Number(result.lastInsertRowid);
  }

  list(limit = 100): AuditEventRecord[] {
    return this.#db
      .prepare<[number], AuditEventRow>(
        `
          SELECT
            id,
            occurred_at,
            actor_id,
            token_id_hash,
            transport,
            request_id,
            session_id_hash,
            action,
            plan_id,
            outcome,
            details_json
          FROM audit_events
          ORDER BY id DESC
          LIMIT ?
        `
      )
      .all(limit)
      .map(rowToRecord);
  }
}

function rowToRecord(row: AuditEventRow): AuditEventRecord {
  const parsedDetails = JSON.parse(row.details_json) as unknown;
  const details =
    typeof parsedDetails === "object" && parsedDetails !== null && !Array.isArray(parsedDetails)
      ? (parsedDetails as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorId: row.actor_id ?? undefined,
    tokenIdHash: row.token_id_hash ?? undefined,
    transport: row.transport,
    requestId: row.request_id ?? undefined,
    sessionIdHash: row.session_id_hash ?? undefined,
    action: row.action,
    planId: row.plan_id ?? undefined,
    outcome: row.outcome,
    details
  };
}

function hashIdentifier(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
