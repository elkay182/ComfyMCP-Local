import { describe, expect, it } from "vitest";
import {
  createBearerToken,
  parseBearerHeader,
  redactSecrets,
  rotateBearerToken,
  verifyBearerSecret
} from "../../src/transport/http-auth.js";

describe("bearer auth", () => {
  it("creates high-entropy bearer records and verifies only active secrets", () => {
    const token = createBearerToken("laptop");

    expect(token.plaintext.startsWith("cmcp_")).toBe(true);
    expect(token.record.secretHash).not.toContain(token.plaintext);
    expect(verifyBearerSecret(`Bearer ${token.plaintext}`, [token.record])).toMatchObject({
      ok: true,
      actorId: token.record.actorId,
      tokenId: token.record.tokenId
    });
    expect(verifyBearerSecret("Bearer wrong", [token.record])).toEqual({
      ok: false,
      reason: "invalid"
    });
  });

  it("preserves actor IDs across rotation", () => {
    const token = createBearerToken("laptop");
    const rotated = rotateBearerToken(token.record);

    expect(rotated.record.actorId).toBe(token.record.actorId);
    expect(rotated.record.rotatedFromTokenId).toBe(token.record.tokenId);
  });

  it("parses only Authorization bearer credentials and redacts secrets", () => {
    expect(parseBearerHeader("Bearer cmcp_abcd")).toBe("cmcp_abcd");
    expect(parseBearerHeader("Token cmcp_abcd")).toBeUndefined();
    expect(redactSecrets("Authorization: Bearer cmcp_abcd approval_abcd session_abcd")).toBe(
      "Authorization: Bearer [REDACTED] approval_[REDACTED] session_[REDACTED]"
    );
  });
});
