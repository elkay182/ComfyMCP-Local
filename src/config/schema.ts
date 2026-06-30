import { z } from "zod";

export const transportSchema = z.enum(["stdio", "streamable_http"]);
export const tlsModeSchema = z.enum(["native", "trusted_proxy"]);
export const egressAssuranceSchema = z.enum([
  "policy_only",
  "operator_attested",
  "container_verified"
]);

export type Transport = z.infer<typeof transportSchema>;
export type TlsMode = z.infer<typeof tlsModeSchema>;
export type EgressAssurance = z.infer<typeof egressAssuranceSchema>;
export type DeploymentMode = "local_stdio" | "lan_hosted";

export type LimitsConfig = {
  workflowJsonBytes: number;
  inputUploadBytes: number;
  inlinePreviewBytes: number;
  logResponseBytes: number;
  batchSize: number;
  imageDimensionPixels: number;
  samplingSteps: number;
  simultaneousDownloads: number;
  workflowExecutionTimeoutMs: number;
  downloadRetryCount: number;
  planLifetimeMs: number;
  comfyuiRequestTimeoutMs: number;
  auditRetentionDays: number;
  maxInlineUploadBytes: number;
  maxResourceBytes: number;
  uploadStagingBytes: number;
  maxActiveUploadsPerActor: number;
  uploadTtlMs: number;
  previewCacheBytes: number;
  downloadCacheBytes: number;
};

export type HttpConfig = {
  bind: string;
  port: number;
  path: "/mcp";
  advertisedUrl?: URL;
  tlsMode?: TlsMode;
  tlsCert?: string;
  tlsKey?: string;
  allowedClientCidrs: string[];
  allowedHosts: string[];
  allowedOrigins: string[];
  trustedProxyCidrs: string[];
  rateLimitPerMinute: number;
  authFailuresPerMinute: number;
  maxHeaderBytes: number;
  maxConnections: number;
  maxSessions: number;
  maxSessionsPerActor: number;
  maxSseStreamsPerActor: number;
  maxBodyBytes: number;
  sessionIdleMs: number;
};

export type ComfyMcpConfig = {
  transport: Transport;
  deploymentMode: DeploymentMode;
  comfyuiUrl: URL;
  allowLanComfyUi: boolean;
  comfyuiAllowedHosts: string[];
  comfyuiPath?: string;
  stateDir?: string;
  workflowRoot?: string;
  inputRoots: string[];
  exportRoot?: string;
  comfyuiInputRoot?: string;
  comfyuiOutputRoot?: string;
  modelRootsFile?: string;
  customNodesRoot?: string;
  adminMutations: boolean;
  allowedModelHosts: string[];
  allowDirectDownloads: boolean;
  allowUnsafeModelFormats: boolean;
  comfyuiCommand?: string;
  comfyuiArgs: string[];
  requireEgressEnforcement: boolean;
  egressAssurance: EgressAssurance;
  hfTokenPresent: boolean;
  civitaiTokenPresent: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  limits: LimitsConfig;
  http: HttpConfig;
};

export const DEFAULT_LIMITS: LimitsConfig = {
  workflowJsonBytes: 5 * 1024 * 1024,
  inputUploadBytes: 500 * 1024 * 1024,
  inlinePreviewBytes: 512 * 1024,
  logResponseBytes: 256 * 1024,
  batchSize: 16,
  imageDimensionPixels: 16_384,
  samplingSteps: 1_000,
  simultaneousDownloads: 3,
  workflowExecutionTimeoutMs: 60 * 60 * 1_000,
  downloadRetryCount: 4,
  planLifetimeMs: 30 * 60 * 1_000,
  comfyuiRequestTimeoutMs: 30_000,
  auditRetentionDays: 30,
  maxInlineUploadBytes: 16 * 1024 * 1024,
  maxResourceBytes: 16 * 1024 * 1024,
  uploadStagingBytes: 20 * 1024 * 1024 * 1024,
  maxActiveUploadsPerActor: 4,
  uploadTtlMs: 60 * 60 * 1_000,
  previewCacheBytes: 2 * 1024 * 1024 * 1024,
  downloadCacheBytes: 100 * 1024 * 1024 * 1024
};

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function parseEnv(env: NodeJS.ProcessEnv): ComfyMcpConfig {
  const issues: string[] = [];
  const transport = parseEnum(
    env.COMFYMCP_TRANSPORT,
    transportSchema,
    "stdio",
    "COMFYMCP_TRANSPORT",
    issues
  );
  const comfyuiUrl = parseUrl(
    env.COMFYMCP_COMFYUI_URL ?? "http://127.0.0.1:8188",
    "COMFYMCP_COMFYUI_URL",
    issues
  );
  const tlsMode =
    env.COMFYMCP_HTTP_TLS_MODE === undefined
      ? undefined
      : parseEnum(
          env.COMFYMCP_HTTP_TLS_MODE,
          tlsModeSchema,
          undefined,
          "COMFYMCP_HTTP_TLS_MODE",
          issues
        );
  const advertisedUrl = env.COMFYMCP_HTTP_ADVERTISED_URL
    ? parseUrl(env.COMFYMCP_HTTP_ADVERTISED_URL, "COMFYMCP_HTTP_ADVERTISED_URL", issues)
    : undefined;
  const egressAssurance = parseEnum(
    env.COMFYMCP_EGRESS_ASSURANCE,
    egressAssuranceSchema,
    "policy_only",
    "COMFYMCP_EGRESS_ASSURANCE",
    issues
  );
  const deploymentMode: DeploymentMode =
    transport === "streamable_http" ? "lan_hosted" : "local_stdio";

  const config: ComfyMcpConfig = {
    transport,
    deploymentMode,
    comfyuiUrl,
    allowLanComfyUi: parseBool(env.COMFYMCP_ALLOW_LAN_COMFYUI, false),
    comfyuiAllowedHosts: parseList(env.COMFYMCP_COMFYUI_ALLOWED_HOSTS),
    comfyuiPath: env.COMFYMCP_COMFYUI_PATH,
    stateDir: env.COMFYMCP_STATE_DIR,
    workflowRoot: env.COMFYMCP_WORKFLOW_ROOT,
    inputRoots: parseList(env.COMFYMCP_INPUT_ROOTS),
    exportRoot: env.COMFYMCP_EXPORT_ROOT,
    comfyuiInputRoot: env.COMFYMCP_COMFYUI_INPUT_ROOT,
    comfyuiOutputRoot: env.COMFYMCP_COMFYUI_OUTPUT_ROOT,
    modelRootsFile: env.COMFYMCP_MODEL_ROOTS_FILE,
    customNodesRoot: env.COMFYMCP_CUSTOM_NODES_ROOT,
    adminMutations: parseBool(env.COMFYMCP_ADMIN_MUTATIONS, false),
    allowedModelHosts: parseList(env.COMFYMCP_ALLOWED_MODEL_HOSTS),
    allowDirectDownloads: parseBool(env.COMFYMCP_ALLOW_DIRECT_DOWNLOADS, false),
    allowUnsafeModelFormats: parseBool(env.COMFYMCP_ALLOW_UNSAFE_MODEL_FORMATS, false),
    comfyuiCommand: env.COMFYMCP_COMFYUI_COMMAND,
    comfyuiArgs: parseJsonStringArray(env.COMFYMCP_COMFYUI_ARGS_JSON, issues),
    requireEgressEnforcement: parseBool(env.COMFYMCP_REQUIRE_EGRESS_ENFORCEMENT, false),
    egressAssurance,
    hfTokenPresent: Boolean(env.COMFYMCP_HF_TOKEN),
    civitaiTokenPresent: Boolean(env.COMFYMCP_CIVITAI_TOKEN),
    logLevel: parseLogLevel(env.COMFYMCP_LOG_LEVEL, issues),
    limits: {
      ...DEFAULT_LIMITS,
      maxInlineUploadBytes: parseBytes(
        env.COMFYMCP_MAX_INLINE_UPLOAD_BYTES,
        DEFAULT_LIMITS.maxInlineUploadBytes,
        "COMFYMCP_MAX_INLINE_UPLOAD_BYTES",
        issues
      ),
      maxResourceBytes: parseBytes(
        env.COMFYMCP_MAX_RESOURCE_BYTES,
        DEFAULT_LIMITS.maxResourceBytes,
        "COMFYMCP_MAX_RESOURCE_BYTES",
        issues
      ),
      uploadStagingBytes: parseGib(
        env.COMFYMCP_UPLOAD_STAGING_GIB,
        DEFAULT_LIMITS.uploadStagingBytes,
        "COMFYMCP_UPLOAD_STAGING_GIB",
        issues
      ),
      maxActiveUploadsPerActor: parsePositiveInt(
        env.COMFYMCP_MAX_ACTIVE_UPLOADS_PER_ACTOR,
        DEFAULT_LIMITS.maxActiveUploadsPerActor,
        "COMFYMCP_MAX_ACTIVE_UPLOADS_PER_ACTOR",
        issues
      ),
      uploadTtlMs:
        parsePositiveInt(
          env.COMFYMCP_UPLOAD_TTL_MINUTES,
          DEFAULT_LIMITS.uploadTtlMs / 60_000,
          "COMFYMCP_UPLOAD_TTL_MINUTES",
          issues
        ) * 60_000,
      previewCacheBytes: parseGib(
        env.COMFYMCP_PREVIEW_CACHE_GIB,
        DEFAULT_LIMITS.previewCacheBytes,
        "COMFYMCP_PREVIEW_CACHE_GIB",
        issues
      ),
      downloadCacheBytes: parseGib(
        env.COMFYMCP_DOWNLOAD_CACHE_GIB,
        DEFAULT_LIMITS.downloadCacheBytes,
        "COMFYMCP_DOWNLOAD_CACHE_GIB",
        issues
      ),
      comfyuiRequestTimeoutMs: parsePositiveInt(
        env.COMFYMCP_COMFYUI_REQUEST_TIMEOUT_MS,
        DEFAULT_LIMITS.comfyuiRequestTimeoutMs,
        "COMFYMCP_COMFYUI_REQUEST_TIMEOUT_MS",
        issues
      ),
      auditRetentionDays: parsePositiveInt(
        env.COMFYMCP_AUDIT_RETENTION_DAYS,
        DEFAULT_LIMITS.auditRetentionDays,
        "COMFYMCP_AUDIT_RETENTION_DAYS",
        issues
      )
    },
    http: {
      bind: env.COMFYMCP_HTTP_BIND ?? "127.0.0.1",
      port: parsePositiveInt(env.COMFYMCP_HTTP_PORT, 9100, "COMFYMCP_HTTP_PORT", issues),
      path: "/mcp",
      advertisedUrl,
      tlsMode,
      tlsCert: env.COMFYMCP_HTTP_TLS_CERT,
      tlsKey: env.COMFYMCP_HTTP_TLS_KEY,
      allowedClientCidrs: parseList(env.COMFYMCP_HTTP_ALLOWED_CLIENT_CIDRS),
      allowedHosts: parseList(env.COMFYMCP_HTTP_ALLOWED_HOSTS),
      allowedOrigins: parseList(env.COMFYMCP_HTTP_ALLOWED_ORIGINS),
      trustedProxyCidrs: parseList(env.COMFYMCP_HTTP_TRUSTED_PROXY_CIDRS),
      rateLimitPerMinute: parsePositiveInt(
        env.COMFYMCP_HTTP_RATE_LIMIT_PER_MINUTE,
        120,
        "COMFYMCP_HTTP_RATE_LIMIT_PER_MINUTE",
        issues
      ),
      authFailuresPerMinute: parsePositiveInt(
        env.COMFYMCP_HTTP_AUTH_FAILURES_PER_MINUTE,
        10,
        "COMFYMCP_HTTP_AUTH_FAILURES_PER_MINUTE",
        issues
      ),
      maxHeaderBytes: parseBytes(
        env.COMFYMCP_HTTP_MAX_HEADER_BYTES,
        32 * 1024,
        "COMFYMCP_HTTP_MAX_HEADER_BYTES",
        issues
      ),
      maxConnections: parsePositiveInt(
        env.COMFYMCP_HTTP_MAX_CONNECTIONS,
        32,
        "COMFYMCP_HTTP_MAX_CONNECTIONS",
        issues
      ),
      maxSessions: parsePositiveInt(
        env.COMFYMCP_HTTP_MAX_SESSIONS,
        16,
        "COMFYMCP_HTTP_MAX_SESSIONS",
        issues
      ),
      maxSessionsPerActor: parsePositiveInt(
        env.COMFYMCP_HTTP_MAX_SESSIONS_PER_ACTOR,
        8,
        "COMFYMCP_HTTP_MAX_SESSIONS_PER_ACTOR",
        issues
      ),
      maxSseStreamsPerActor: parsePositiveInt(
        env.COMFYMCP_HTTP_MAX_SSE_STREAMS_PER_ACTOR,
        4,
        "COMFYMCP_HTTP_MAX_SSE_STREAMS_PER_ACTOR",
        issues
      ),
      maxBodyBytes: parseBytes(
        env.COMFYMCP_HTTP_MAX_BODY_BYTES,
        20 * 1024 * 1024,
        "COMFYMCP_HTTP_MAX_BODY_BYTES",
        issues
      ),
      sessionIdleMs:
        parsePositiveInt(
          env.COMFYMCP_HTTP_SESSION_IDLE_MINUTES,
          30,
          "COMFYMCP_HTTP_SESSION_IDLE_MINUTES",
          issues
        ) * 60_000
    }
  };

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  return config;
}

function parseEnum<T extends z.ZodEnum>(
  value: string | undefined,
  schema: T,
  fallback: z.infer<T> | undefined,
  name: string,
  issues: string[]
): z.infer<T> {
  if (value === undefined || value === "") {
    if (fallback !== undefined) {
      return fallback;
    }
    issues.push(`${name} is required`);
    return schema.options[0] as z.infer<T>;
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    issues.push(`${name} must be one of ${schema.options.join(", ")}`);
    return fallback ?? (schema.options[0] as z.infer<T>);
  }
  return parsed.data;
}

function parseUrl(value: string, name: string, issues: string[]): URL {
  try {
    return new URL(value);
  } catch {
    issues.push(`${name} must be a valid URL`);
    return new URL("http://127.0.0.1:8188");
  }
}

function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseJsonStringArray(value: string | undefined, issues: string[]): string[] {
  if (value === undefined || value === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Report below.
  }
  issues.push("COMFYMCP_COMFYUI_ARGS_JSON must be a JSON string array");
  return [];
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  name: string,
  issues: string[]
): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    issues.push(`${name} must be a positive integer`);
    return fallback;
  }
  return parsed;
}

function parseBytes(
  value: string | undefined,
  fallback: number,
  name: string,
  issues: string[]
): number {
  return parsePositiveInt(value, fallback, name, issues);
}

function parseGib(
  value: string | undefined,
  fallbackBytes: number,
  name: string,
  issues: string[]
): number {
  if (value === undefined || value === "") {
    return fallbackBytes;
  }
  return parsePositiveInt(value, fallbackBytes / (1024 * 1024 * 1024), name, issues) * 1024 * 1024 * 1024;
}

function parseLogLevel(
  value: string | undefined,
  issues: string[]
): "debug" | "info" | "warn" | "error" {
  if (value === undefined || value === "") {
    return "info";
  }
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  issues.push("COMFYMCP_LOG_LEVEL must be debug, info, warn, or error");
  return "info";
}
