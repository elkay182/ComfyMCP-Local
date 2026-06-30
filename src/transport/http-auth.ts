import crypto from "node:crypto";

export type BearerRecord = {
  tokenId: string;
  actorId: string;
  label: string;
  secretHash: string;
  createdAt: string;
  rotatedFromTokenId?: string;
  revokedAt?: string;
};

export type CreatedBearerToken = {
  record: BearerRecord;
  plaintext: string;
};

export type BearerVerification =
  | { ok: true; tokenId: string; actorId: string; label: string }
  | { ok: false; reason: "missing" | "invalid" | "revoked" };

export function createBearerToken(label: string, actorId = createId("actor")): CreatedBearerToken {
  const plaintext = `cmcp_${crypto.randomBytes(32).toString("base64url")}`;
  const tokenId = createId("tok");
  return {
    plaintext,
    record: {
      tokenId,
      actorId,
      label,
      secretHash: hashBearerSecret(plaintext),
      createdAt: new Date().toISOString()
    }
  };
}

export function rotateBearerToken(previous: BearerRecord): CreatedBearerToken {
  const rotated = createBearerToken(previous.label, previous.actorId);
  return {
    plaintext: rotated.plaintext,
    record: {
      ...rotated.record,
      rotatedFromTokenId: previous.tokenId
    }
  };
}

export function hashBearerSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

export function verifyBearerSecret(
  authorizationHeader: string | undefined,
  records: readonly BearerRecord[]
): BearerVerification {
  const secret = parseBearerHeader(authorizationHeader);
  if (!secret) {
    return { ok: false, reason: "missing" };
  }
  const presentedHash = Buffer.from(hashBearerSecret(secret), "hex");
  let matchedRevoked = false;

  for (const record of records) {
    const storedHash = Buffer.from(record.secretHash, "hex");
    if (storedHash.length !== presentedHash.length) {
      continue;
    }
    if (crypto.timingSafeEqual(storedHash, presentedHash)) {
      if (record.revokedAt) {
        matchedRevoked = true;
        continue;
      }
      return {
        ok: true,
        tokenId: record.tokenId,
        actorId: record.actorId,
        label: record.label
      };
    }
  }

  return matchedRevoked ? { ok: false, reason: "revoked" } : { ok: false, reason: "invalid" };
}

export function parseBearerHeader(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = /^Bearer ([A-Za-z0-9_-]+\.?[A-Za-z0-9_-]*|cmcp_[A-Za-z0-9_-]+)$/.exec(value.trim());
  return match?.[1];
}

export function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/cmcp_[A-Za-z0-9_-]+/g, "cmcp_[REDACTED]")
    .replace(/approval_[A-Za-z0-9_-]+/g, "approval_[REDACTED]")
    .replace(/session_[A-Za-z0-9_-]+/g, "session_[REDACTED]");
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(16).toString("base64url")}`;
}
