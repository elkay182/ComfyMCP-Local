import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAuthCommand } from "../../src/cli/auth.js";
import { databasePathForStateDir, openDatabase } from "../../src/persistence/database.js";
import { AuthTokenRepository } from "../../src/persistence/repositories/index.js";
import { verifyBearerSecret } from "../../src/transport/http-auth.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("auth CLI SQLite store", () => {
  it("creates, lists, rotates, and revokes bearer tokens in SQLite", () => {
    const stateDir = tempStateDir();

    const created = runAuthCommand(["create", "--label", "workstation"], stateDir);
    const createOutput = objectOutput(created.stdout);
    const tokenId = stringField(createOutput, "token_id");
    const actorId = stringField(createOutput, "actor_id");
    const plaintext = stringField(createOutput, "token");

    expect(created.exitCode).toBe(0);
    expect(fs.existsSync(path.join(stateDir, "auth-tokens.json"))).toBe(false);
    expect(fs.existsSync(databasePathForStateDir(stateDir))).toBe(true);

    const listed = runAuthCommand(["list"], stateDir);
    expect(listed.exitCode).toBe(0);
    expect(objectOutput(listed.stdout)).toMatchObject({
      records: [
        {
          token_id: tokenId,
          actor_id: actorId,
          label: "workstation"
        }
      ]
    });

    const handle = openDatabase(databasePathForStateDir(stateDir));
    const repository = new AuthTokenRepository(handle.db);
    expect(verifyBearerSecret(`Bearer ${plaintext}`, repository.listForVerification())).toMatchObject({
      ok: true,
      tokenId
    });
    handle.close();

    const rotated = runAuthCommand(["rotate", tokenId], stateDir);
    const rotateOutput = objectOutput(rotated.stdout);
    const rotatedToken = stringField(rotateOutput, "token");
    expect(rotated.exitCode).toBe(0);
    expect(rotateOutput).toMatchObject({
      actor_id: actorId,
      rotated_from_token_id: tokenId
    });

    const revoked = runAuthCommand(["revoke", stringField(rotateOutput, "token_id")], stateDir);
    expect(revoked).toMatchObject({
      exitCode: 0,
      stdout: {
        revoked: true
      }
    });

    const finalHandle = openDatabase(databasePathForStateDir(stateDir));
    const finalRepository = new AuthTokenRepository(finalHandle.db);
    expect(verifyBearerSecret(`Bearer ${plaintext}`, finalRepository.listForVerification())).toEqual({
      ok: false,
      reason: "revoked"
    });
    expect(verifyBearerSecret(`Bearer ${rotatedToken}`, finalRepository.listForVerification())).toEqual({
      ok: false,
      reason: "revoked"
    });
    finalHandle.close();
  });
});

function tempStateDir(): string {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "comfymcp-auth-"));
  tempDirs.push(stateDir);
  return stateDir;
}

function objectOutput(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("Expected object output");
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Expected ${key} to be a string`);
  }
  return value;
}
