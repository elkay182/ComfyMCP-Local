import type { ComfyMcpConfig } from "../config/schema.js";
import { isAddressInCidrs } from "../policy/network-policy.js";
import {
  type BearerRecord,
  type BearerVerification,
  verifyBearerSecret
} from "./http-auth.js";

export type HttpAdmissionInput = {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  remoteAddress: string;
  bodyBytes: number;
  records: readonly BearerRecord[];
};

export type HttpAdmissionFailureCode =
  | "MALFORMED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "OVERSIZED"
  | "RATE_LIMITED"
  | "UNAVAILABLE";

export type HttpAdmissionDecision =
  | {
      ok: true;
      actorId: string;
      tokenId: string;
      isPreflight: boolean;
    }
  | {
      ok: false;
      status: 400 | 401 | 403 | 413 | 429 | 503;
      code: HttpAdmissionFailureCode;
      correlationId: string;
      headers?: Record<string, string>;
    };

export function admitHttpRequest(
  config: ComfyMcpConfig,
  input: HttpAdmissionInput,
  correlationId = cryptoRandomCorrelationId()
): HttpAdmissionDecision {
  if (input.path !== config.http.path) {
    return fail(400, "MALFORMED", correlationId);
  }
  if (input.bodyBytes > config.http.maxBodyBytes) {
    return fail(413, "OVERSIZED", correlationId);
  }
  if (!isAddressInCidrs(input.remoteAddress, config.http.allowedClientCidrs)) {
    return fail(403, "FORBIDDEN", correlationId);
  }
  if (!hostAllowed(input.headers.host, config.http.allowedHosts)) {
    return fail(403, "FORBIDDEN", correlationId);
  }
  const originDecision = originAllowed(input.headers.origin, config.http.allowedOrigins);
  if (!originDecision.ok) {
    return fail(403, "FORBIDDEN", correlationId);
  }

  if (input.method === "OPTIONS") {
    if (!input.headers.origin) {
      return fail(403, "FORBIDDEN", correlationId);
    }
    return {
      ok: true,
      actorId: "preflight",
      tokenId: "preflight",
      isPreflight: true
    };
  }

  const auth = verifyBearerSecret(input.headers.authorization, input.records);
  if (!auth.ok) {
    return unauthenticated(auth, correlationId);
  }
  return {
    ok: true,
    actorId: auth.actorId,
    tokenId: auth.tokenId,
    isPreflight: false
  };
}

export function admissionFailureBody(decision: Extract<HttpAdmissionDecision, { ok: false }>): {
  ok: false;
  error: { code: HttpAdmissionFailureCode; message: string };
  correlation_id: string;
} {
  return {
    ok: false,
    error: {
      code: decision.code,
      message: "Request was not admitted"
    },
    correlation_id: decision.correlationId
  };
}

function hostAllowed(host: string | undefined, allowedHosts: string[]): boolean {
  if (!host) {
    return false;
  }
  return allowedHosts.includes(host);
}

function originAllowed(origin: string | undefined, allowedOrigins: string[]): { ok: true } | { ok: false } {
  if (origin === undefined) {
    return { ok: true };
  }
  if (origin === "null") {
    return { ok: false };
  }
  if (allowedOrigins.length === 0) {
    return { ok: false };
  }
  return allowedOrigins.includes(origin) ? { ok: true } : { ok: false };
}

function unauthenticated(
  auth: Exclude<BearerVerification, { ok: true }>,
  correlationId: string
): Extract<HttpAdmissionDecision, { ok: false }> {
  const status = auth.reason === "revoked" ? 401 : 401;
  return {
    ok: false,
    status,
    code: "UNAUTHENTICATED",
    correlationId,
    headers: {
      "WWW-Authenticate": "Bearer"
    }
  };
}

function fail(
  status: 400 | 401 | 403 | 413 | 429 | 503,
  code: HttpAdmissionFailureCode,
  correlationId: string
): Extract<HttpAdmissionDecision, { ok: false }> {
  return { ok: false, status, code, correlationId };
}

function cryptoRandomCorrelationId(): string {
  return `req_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`;
}
