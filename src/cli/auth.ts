import fs from "node:fs";
import path from "node:path";
import {
  createBearerToken,
  rotateBearerToken,
  type BearerRecord
} from "../transport/http-auth.js";

export type AuthCommandResult = {
  exitCode: number;
  stdout?: unknown;
  stderr?: string;
};

type AuthStoreFile = {
  records: BearerRecord[];
};

export function runAuthCommand(args: string[], stateDir: string): AuthCommandResult {
  const [action, ...rest] = args;
  const storePath = path.join(stateDir, "auth-tokens.json");

  if (action === "create") {
    const label = readFlag(rest, "--label") ?? "client";
    const token = createBearerToken(label);
    const store = readStore(storePath);
    store.records.push(token.record);
    writeStore(storePath, store);
    return {
      exitCode: 0,
      stdout: {
        token_id: token.record.tokenId,
        actor_id: token.record.actorId,
        label: token.record.label,
        token: token.plaintext
      }
    };
  }

  if (action === "list") {
    const store = readStore(storePath);
    return {
      exitCode: 0,
      stdout: {
        records: store.records.map((record) => ({
          token_id: record.tokenId,
          actor_id: record.actorId,
          label: record.label,
          created_at: record.createdAt,
          revoked_at: record.revokedAt
        }))
      }
    };
  }

  if (action === "rotate") {
    const tokenId = rest[0];
    if (!tokenId) {
      return { exitCode: 2, stderr: "usage: comfymcp-local auth rotate <token_id>" };
    }
    const store = readStore(storePath);
    const previous = store.records.find((record) => record.tokenId === tokenId);
    if (!previous) {
      return { exitCode: 1, stderr: "token not found" };
    }
    const replacement = rotateBearerToken(previous);
    previous.revokedAt = new Date().toISOString();
    store.records.push(replacement.record);
    writeStore(storePath, store);
    return {
      exitCode: 0,
      stdout: {
        token_id: replacement.record.tokenId,
        actor_id: replacement.record.actorId,
        rotated_from_token_id: tokenId,
        token: replacement.plaintext
      }
    };
  }

  if (action === "revoke") {
    const tokenId = rest[0];
    if (!tokenId) {
      return { exitCode: 2, stderr: "usage: comfymcp-local auth revoke <token_id>" };
    }
    const store = readStore(storePath);
    const record = store.records.find((entry) => entry.tokenId === tokenId);
    if (!record) {
      return { exitCode: 1, stderr: "token not found" };
    }
    record.revokedAt = new Date().toISOString();
    writeStore(storePath, store);
    return { exitCode: 0, stdout: { token_id: tokenId, revoked: true } };
  }

  return {
    exitCode: 2,
    stderr: "usage: comfymcp-local auth <create|list|rotate|revoke>"
  };
}

function readStore(storePath: string): AuthStoreFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as AuthStoreFile;
    if (Array.isArray(parsed.records)) {
      return parsed;
    }
  } catch {
    // Treat missing or unreadable files as an empty store for the scaffold.
  }
  return { records: [] };
}

function writeStore(storePath: string, store: AuthStoreFile): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, storePath);
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}
