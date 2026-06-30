export type ErrorCode =
  | "COMFY_UNAVAILABLE"
  | "CAPABILITY_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "APPROVAL_REQUIRED"
  | "PLAN_EXPIRED"
  | "POLICY_VIOLATION"
  | "INVALID_WORKFLOW"
  | "MISSING_NODE"
  | "MISSING_MODEL"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DISK_SPACE"
  | "DOWNLOAD_AUTH_REQUIRED"
  | "LICENSE_ACCEPTANCE_REQUIRED"
  | "CHECKSUM_MISMATCH"
  | "LIMIT_EXCEEDED"
  | "TIMEOUT"
  | "CANCELLED"
  | "LOST"
  | "INTERNAL";

export type ErrorEnvelope = {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    node_id?: string;
    node_type?: string;
    details: Record<string, unknown>;
  };
};

export type OperationEnvelope<T = Record<string, unknown>> = {
  ok: true;
  request_id: string;
  summary: string;
  resource_links: Array<{ uri: string; mime_type?: string; title?: string }>;
  warnings: string[];
  next_actions: string[];
} & T;

export function okEnvelope<T extends Record<string, unknown>>(
  requestId: string,
  summary: string,
  body: T
): OperationEnvelope<T> {
  return {
    ok: true,
    request_id: requestId,
    summary,
    resource_links: [],
    warnings: [],
    next_actions: [],
    ...body
  };
}

export function errorEnvelope(
  code: ErrorCode,
  message: string,
  retryable = false,
  details: Record<string, unknown> = {}
): ErrorEnvelope {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      details
    }
  };
}
