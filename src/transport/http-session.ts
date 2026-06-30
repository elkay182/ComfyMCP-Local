import crypto from "node:crypto";

export type HttpSession = {
  sessionId: string;
  sessionHash: string;
  actorId: string;
  tokenId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
};

export function createHttpSession(actorId: string, tokenId: string, idleMs: number, now = Date.now()): HttpSession {
  const sessionId = `session_${crypto.randomBytes(32).toString("base64url")}`;
  return {
    sessionId,
    sessionHash: hashSessionId(sessionId),
    actorId,
    tokenId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + idleMs
  };
}

export function hashSessionId(sessionId: string): string {
  return crypto.createHash("sha256").update(sessionId, "utf8").digest("hex");
}

export function canUseSession(
  session: HttpSession,
  actorId: string,
  tokenId: string,
  sessionId: string,
  now = Date.now()
): boolean {
  return (
    session.actorId === actorId &&
    session.tokenId === tokenId &&
    session.expiresAt > now &&
    session.sessionHash === hashSessionId(sessionId)
  );
}
