import { databasePathForStateDir, openDatabase } from "../persistence/database.js";
import { AuthTokenRepository } from "../persistence/repositories/index.js";

export type AuthCommandResult = {
  exitCode: number;
  stdout?: unknown;
  stderr?: string;
};

export function runAuthCommand(args: string[], stateDir: string): AuthCommandResult {
  const [action, ...rest] = args;
  const handle = openDatabase(databasePathForStateDir(stateDir));
  const tokens = new AuthTokenRepository(handle.db);

  try {
    if (action === "create") {
      const label = readFlag(rest, "--label") ?? "client";
      const token = tokens.create(label);
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
      return {
        exitCode: 0,
        stdout: {
          records: tokens.list().map((record) => ({
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
      const replacement = tokens.rotate(tokenId);
      if (!replacement) {
        return { exitCode: 1, stderr: "token not found or revoked" };
      }
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
      const revoked = tokens.revoke(tokenId);
      if (!revoked) {
        return { exitCode: 1, stderr: "token not found" };
      }
      return { exitCode: 0, stdout: { token_id: tokenId, revoked: true } };
    }

    return {
      exitCode: 2,
      stderr: "usage: comfymcp-local auth <create|list|rotate|revoke>"
    };
  } finally {
    handle.close();
  }
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}
