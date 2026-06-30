import type Database from "better-sqlite3";
import type { HttpSession } from "../../transport/http-session.js";

type HttpSessionRow = {
  session_hash: string;
  actor_id: string;
  token_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  closed_at: string | null;
};

export class HttpSessionRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  save(session: HttpSession): void {
    this.#db
      .prepare<{
        session_hash: string;
        actor_id: string;
        token_id: string;
        created_at: string;
        last_seen_at: string;
        expires_at: string;
      }>(
        `
          INSERT INTO http_sessions (
            session_hash,
            actor_id,
            token_id,
            created_at,
            last_seen_at,
            expires_at
          ) VALUES (
            @session_hash,
            @actor_id,
            @token_id,
            @created_at,
            @last_seen_at,
            @expires_at
          )
        `
      )
      .run({
        session_hash: session.sessionHash,
        actor_id: session.actorId,
        token_id: session.tokenId,
        created_at: new Date(session.createdAt).toISOString(),
        last_seen_at: new Date(session.lastSeenAt).toISOString(),
        expires_at: new Date(session.expiresAt).toISOString()
      });
  }

  findOpenByHash(sessionHash: string): HttpSessionRow | undefined {
    return this.#db
      .prepare<[string], HttpSessionRow>(
        `
          SELECT session_hash, actor_id, token_id, created_at, last_seen_at, expires_at, closed_at
          FROM http_sessions
          WHERE session_hash = ? AND closed_at IS NULL
        `
      )
      .get(sessionHash);
  }

  touch(sessionHash: string, lastSeenAt: Date, expiresAt: Date): boolean {
    const result = this.#db
      .prepare<[string, string, string]>(
        `
          UPDATE http_sessions
          SET last_seen_at = ?, expires_at = ?
          WHERE session_hash = ? AND closed_at IS NULL
        `
      )
      .run(lastSeenAt.toISOString(), expiresAt.toISOString(), sessionHash);
    return result.changes > 0;
  }

  close(sessionHash: string, closedAt = new Date()): boolean {
    const result = this.#db
      .prepare<[string, string]>(
        `
          UPDATE http_sessions
          SET closed_at = COALESCE(closed_at, ?)
          WHERE session_hash = ?
        `
      )
      .run(closedAt.toISOString(), sessionHash);
    return result.changes > 0;
  }
}
