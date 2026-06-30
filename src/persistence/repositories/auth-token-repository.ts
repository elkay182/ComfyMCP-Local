import type Database from "better-sqlite3";
import {
  createBearerToken,
  rotateBearerToken,
  type BearerRecord,
  type CreatedBearerToken
} from "../../transport/http-auth.js";

type AuthTokenRow = {
  token_id: string;
  actor_id: string;
  label: string;
  secret_hash: string;
  created_at: string;
  rotated_from_token_id: string | null;
  revoked_at: string | null;
};

export class AuthTokenRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  create(label: string): CreatedBearerToken {
    const token = createBearerToken(label);
    this.insertRecord(token.record);
    return token;
  }

  list(): BearerRecord[] {
    return this.#db
      .prepare<[], AuthTokenRow>(
        `
          SELECT token_id, actor_id, label, secret_hash, created_at, rotated_from_token_id, revoked_at
          FROM auth_tokens
          ORDER BY created_at ASC, token_id ASC
        `
      )
      .all()
      .map(rowToRecord);
  }

  listForVerification(): BearerRecord[] {
    return this.list();
  }

  countActive(): number {
    const row = this.#db
      .prepare<[], { count: number }>(
        "SELECT COUNT(*) AS count FROM auth_tokens WHERE revoked_at IS NULL"
      )
      .get();
    return row?.count ?? 0;
  }

  findByTokenId(tokenId: string): BearerRecord | undefined {
    const row = this.#db
      .prepare<[string], AuthTokenRow>(
        `
          SELECT token_id, actor_id, label, secret_hash, created_at, rotated_from_token_id, revoked_at
          FROM auth_tokens
          WHERE token_id = ?
        `
      )
      .get(tokenId);
    return row ? rowToRecord(row) : undefined;
  }

  rotate(tokenId: string): CreatedBearerToken | undefined {
    const rotateTransaction = this.#db.transaction(() => {
      const previous = this.findByTokenId(tokenId);
      if (!previous || previous.revokedAt) {
        return undefined;
      }

      const replacement = rotateBearerToken(previous);
      this.insertRecord(replacement.record);
      this.revoke(tokenId, new Date().toISOString());
      return replacement;
    });

    return rotateTransaction();
  }

  revoke(tokenId: string, revokedAt = new Date().toISOString()): boolean {
    const result = this.#db
      .prepare<[string, string]>(
        "UPDATE auth_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE token_id = ?"
      )
      .run(revokedAt, tokenId);
    return result.changes > 0;
  }

  private insertRecord(record: BearerRecord): void {
    this.#db
      .prepare<{
        token_id: string;
        actor_id: string;
        label: string;
        secret_hash: string;
        created_at: string;
        rotated_from_token_id: string | null;
        revoked_at: string | null;
      }>(
        `
          INSERT INTO auth_tokens (
            token_id,
            actor_id,
            label,
            secret_hash,
            created_at,
            rotated_from_token_id,
            revoked_at
          ) VALUES (
            @token_id,
            @actor_id,
            @label,
            @secret_hash,
            @created_at,
            @rotated_from_token_id,
            @revoked_at
          )
        `
      )
      .run({
        token_id: record.tokenId,
        actor_id: record.actorId,
        label: record.label,
        secret_hash: record.secretHash,
        created_at: record.createdAt,
        rotated_from_token_id: record.rotatedFromTokenId ?? null,
        revoked_at: record.revokedAt ?? null
      });
  }
}

function rowToRecord(row: AuthTokenRow): BearerRecord {
  return {
    tokenId: row.token_id,
    actorId: row.actor_id,
    label: row.label,
    secretHash: row.secret_hash,
    createdAt: row.created_at,
    rotatedFromTokenId: row.rotated_from_token_id ?? undefined,
    revokedAt: row.revoked_at ?? undefined
  };
}
