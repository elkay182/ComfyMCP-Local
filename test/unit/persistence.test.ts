import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  databasePathForStateDir,
  openDatabase,
  type DatabaseHandle
} from "../../src/persistence/database.js";
import {
  AuditEventRepository,
  AuthTokenRepository,
  HttpSessionRepository
} from "../../src/persistence/repositories/index.js";
import { createHttpSession } from "../../src/transport/http-session.js";
import { verifyBearerSecret } from "../../src/transport/http-auth.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("SQLite persistence", () => {
  it("creates the database with required migrations and restrictive file mode", () => {
    const { handle, stateDir } = openTempDatabase();

    expect(tables(handle)).toEqual(
      expect.arrayContaining(["schema_migrations", "auth_tokens", "http_sessions", "audit_events"])
    );
    expect(databaseModes(stateDir)).toMatchObject({
      stateDir: "700",
      database: "600"
    });

    handle.close();
  });

  it("stores bearer hashes only and verifies active, rotated, and revoked records", () => {
    const { handle } = openTempDatabase();
    const tokens = new AuthTokenRepository(handle.db);

    const created = tokens.create("desktop");
    expect(tokens.countActive()).toBe(1);
    expect(verifyBearerSecret(`Bearer ${created.plaintext}`, tokens.listForVerification())).toMatchObject({
      ok: true,
      actorId: created.record.actorId,
      tokenId: created.record.tokenId
    });
    expect(handle.db.serialize().includes(Buffer.from(created.plaintext))).toBe(false);

    const rotated = tokens.rotate(created.record.tokenId);
    expect(rotated).toBeDefined();
    expect(rotated?.record.actorId).toBe(created.record.actorId);
    expect(verifyBearerSecret(`Bearer ${created.plaintext}`, tokens.listForVerification())).toEqual({
      ok: false,
      reason: "revoked"
    });
    expect(verifyBearerSecret(`Bearer ${rotated?.plaintext ?? ""}`, tokens.listForVerification())).toMatchObject({
      ok: true,
      actorId: created.record.actorId
    });

    if (rotated) {
      expect(tokens.revoke(rotated.record.tokenId)).toBe(true);
      expect(verifyBearerSecret(`Bearer ${rotated.plaintext}`, tokens.listForVerification())).toEqual({
        ok: false,
        reason: "revoked"
      });
    }

    handle.close();
  });

  it("persists audit events and HTTP session metadata without plaintext session IDs", () => {
    const { handle } = openTempDatabase();
    const tokens = new AuthTokenRepository(handle.db);
    const sessions = new HttpSessionRepository(handle.db);
    const audit = new AuditEventRepository(handle.db);
    const created = tokens.create("lan-client");
    const session = createHttpSession(created.record.actorId, created.record.tokenId, 30_000, 1_700_000_000_000);

    sessions.save(session);
    audit.append({
      actorId: created.record.actorId,
      tokenId: created.record.tokenId,
      transport: "streamable_http",
      sessionIdHash: session.sessionHash,
      action: "auth.create",
      outcome: "succeeded",
      details: { label: "lan-client", header: `Authorization: Bearer ${created.plaintext}` }
    });

    expect(sessions.findOpenByHash(session.sessionHash)).toMatchObject({
      actor_id: created.record.actorId,
      token_id: created.record.tokenId
    });
    expect(handle.db.serialize().includes(Buffer.from(session.sessionId))).toBe(false);
    expect(audit.list(1)).toEqual([
      expect.objectContaining({
        actorId: created.record.actorId,
        transport: "streamable_http",
        action: "auth.create",
        outcome: "succeeded",
        details: { label: "lan-client", header: "Authorization: Bearer [REDACTED]" }
      })
    ]);
    handle.db
      .prepare("UPDATE audit_events SET occurred_at = ? WHERE action = ?")
      .run("2000-01-01T00:00:00.000Z", "auth.create");
    expect(audit.pruneOlderThan(new Date("2001-01-01T00:00:00.000Z"))).toBe(1);
    expect(audit.list(1)).toEqual([]);

    handle.close();
  });
});

function openTempDatabase(): { handle: DatabaseHandle; stateDir: string } {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "comfymcp-state-"));
  tempDirs.push(stateDir);
  return {
    stateDir,
    handle: openDatabase(databasePathForStateDir(stateDir))
  };
}

function tables(handle: DatabaseHandle): string[] {
  return handle.db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    )
    .all()
    .map((row) => row.name);
}

function databaseModes(stateDir: string): { stateDir: string; database: string } {
  return {
    stateDir: fileMode(stateDir),
    database: fileMode(databasePathForStateDir(stateDir))
  };
}

function fileMode(filePath: string): string {
  return (fs.statSync(filePath).mode & 0o777).toString(8);
}
