import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { ComfyMcpConfig } from "../config/schema.js";
import { defaultStateDir } from "../config/paths.js";
import { validateHttpStartupSettings } from "../config/validation.js";
import { createMcpServer } from "../mcp/server.js";
import { databasePathForStateDir, openDatabase } from "../persistence/database.js";
import {
  AuthTokenRepository,
  AuditEventRepository,
  AssetRepository,
  HttpSessionRepository,
  JobRepository
} from "../persistence/repositories/index.js";
import { admissionFailureBody, admitHttpRequest } from "./http-admission.js";
import { hashSessionId } from "./http-session.js";
import { loadTlsMaterial } from "./tls.js";

export function assertStreamableHttpReady(config: ComfyMcpConfig, activeBearerRecords: number): void {
  const issues = validateHttpStartupSettings(config, activeBearerRecords, []);
  if (issues.length > 0) {
    throw new Error(issues.join("; "));
  }
}

export type StreamableHttpServerHandle = {
  url: URL;
  close(): Promise<void>;
  activeSessionCount(): number;
};

export type StreamableHttpServerOptions = {
  stateDir?: string;
  port?: number;
  skipStartupValidation?: boolean;
};

type SessionRuntime = {
  transport: StreamableHTTPServerTransport;
  server: ReturnType<typeof createMcpServer>;
  actorId: string;
  tokenId: string;
  sessionHash: string;
};

export async function startStreamableHttpServer(
  config: ComfyMcpConfig,
  options: StreamableHttpServerOptions = {}
): Promise<StreamableHttpServerHandle> {
  const stateDir = options.stateDir ?? config.stateDir ?? defaultStateDir();
  const database = openDatabase(databasePathForStateDir(stateDir));
  const authTokens = new AuthTokenRepository(database.db);
  const sessions = new HttpSessionRepository(database.db);
  const auditEvents = new AuditEventRepository(database.db);

  if (!options.skipStartupValidation) {
    assertStreamableHttpReady(config, authTokens.countActive());
  }

  const runtimes = new Map<string, SessionRuntime>();
  const listener = (request: IncomingMessage, response: ServerResponse) => {
    void handleMcpHttpRequest(config, request, response, {
    authTokens,
    sessions,
    auditEvents,
    jobs: new JobRepository(database.db),
    assets: new AssetRepository(database.db),
    runtimes
  });
  };

  const server =
    config.http.tlsMode === "native"
      ? https.createServer(nativeTlsOptions(config), listener)
      : http.createServer(listener);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? config.http.port, config.http.bind, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Streamable HTTP server did not expose a TCP address");
  }

  return {
    url: new URL(`${config.http.tlsMode === "native" ? "https" : "http"}://${config.http.bind}:${address.port}${config.http.path}`),
    activeSessionCount: () => runtimes.size,
    close: async () => {
      for (const [sessionId, runtime] of runtimes) {
        sessions.close(runtime.sessionHash);
        await runtime.transport.close();
        await runtime.server.close();
        runtimes.delete(sessionId);
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          database.close();
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
  };
}

async function handleMcpHttpRequest(
  config: ComfyMcpConfig,
  request: IncomingMessage,
  response: ServerResponse,
  context: {
    authTokens: AuthTokenRepository;
    sessions: HttpSessionRepository;
    auditEvents: AuditEventRepository;
    jobs: JobRepository;
    assets: AssetRepository;
    runtimes: Map<string, SessionRuntime>;
  }
): Promise<void> {
  const method = request.method ?? "GET";
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const contentLength = parseContentLength(request.headers["content-length"]);
  const admission = admitHttpRequest(config, {
    method,
    path: requestUrl.pathname,
    headers: normalizeHeaders(request),
    remoteAddress: effectiveRemoteAddress(request),
    bodyBytes: contentLength,
    records: context.authTokens.listForVerification()
  });

  if (!admission.ok) {
    writeAdmissionFailure(response, admission);
    return;
  }

  if (admission.isPreflight) {
    writePreflightResponse(config, request, response);
    return;
  }

  let parsedBody: unknown;
  if (method === "POST") {
    const body = await readJsonBody(request, config.http.maxBodyBytes);
    if (!body.ok) {
      writeJson(response, body.status, {
        ok: false,
        error: {
          code: body.status === 413 ? "OVERSIZED" : "MALFORMED",
          message: "Request was not admitted"
        },
        correlation_id: `req_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`
      });
      return;
    }
    parsedBody = body.value;
  }

  try {
    await dispatchAdmittedRequest(config, request, response, parsedBody, admission, context);
  } catch {
    if (!response.headersSent) {
      writeJson(response, 503, {
        ok: false,
        error: {
          code: "UNAVAILABLE",
          message: "Request was not admitted"
        },
        correlation_id: `req_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`
      });
    }
  }
}

async function dispatchAdmittedRequest(
  config: ComfyMcpConfig,
  request: IncomingMessage,
  response: ServerResponse,
  parsedBody: unknown,
  admission: Extract<ReturnType<typeof admitHttpRequest>, { ok: true }>,
  context: {
    sessions: HttpSessionRepository;
    auditEvents: AuditEventRepository;
    jobs: JobRepository;
    assets: AssetRepository;
    runtimes: Map<string, SessionRuntime>;
  }
): Promise<void> {
  const sessionId = headerValue(request.headers["mcp-session-id"]);
  const method = request.method ?? "GET";

  if (method === "POST" && !sessionId && isInitializeRequest(parsedBody)) {
    await initializeHttpSession(config, request, response, parsedBody, admission, context);
    return;
  }

  if (!sessionId) {
    writeJson(response, 400, {
      ok: false,
      error: {
        code: "MALFORMED",
        message: "Request was not admitted"
      },
      correlation_id: `req_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`
    });
    return;
  }

  const runtime = context.runtimes.get(sessionId);
  if (!runtime || runtime.actorId !== admission.actorId || runtime.tokenId !== admission.tokenId) {
    writeJson(response, 400, {
      ok: false,
      error: {
        code: "MALFORMED",
        message: "Request was not admitted"
      },
      correlation_id: `req_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`
    });
    return;
  }

  const persisted = context.sessions.findOpenByHash(runtime.sessionHash);
  if (!persisted || new Date(persisted.expires_at).getTime() <= Date.now()) {
    context.runtimes.delete(sessionId);
    await runtime.transport.close();
    await runtime.server.close();
    writeJson(response, 400, {
      ok: false,
      error: {
        code: "MALFORMED",
        message: "Request was not admitted"
      },
      correlation_id: `req_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`
    });
    return;
  }

  context.sessions.touch(runtime.sessionHash, new Date(), new Date(Date.now() + config.http.sessionIdleMs));
  attachAuthInfo(request, admission);
  await runtime.transport.handleRequest(request, response, parsedBody);

  if (method === "DELETE") {
    context.sessions.close(runtime.sessionHash);
    context.runtimes.delete(sessionId);
    await runtime.transport.close();
    await runtime.server.close();
  }
}

async function initializeHttpSession(
  config: ComfyMcpConfig,
  request: IncomingMessage,
  response: ServerResponse,
  parsedBody: unknown,
  admission: Extract<ReturnType<typeof admitHttpRequest>, { ok: true }>,
  context: {
    sessions: HttpSessionRepository;
    auditEvents: AuditEventRepository;
    jobs: JobRepository;
    assets: AssetRepository;
    runtimes: Map<string, SessionRuntime>;
  }
): Promise<void> {
  const mcpServer = createMcpServer(config, {
    actorId: admission.actorId,
    jobs: context.jobs,
    assets: context.assets
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => `session_${crypto.randomBytes(32).toString("base64url")}`,
    onsessioninitialized: (sessionId) => {
      const now = Date.now();
      const sessionHash = hashSessionId(sessionId);
      context.sessions.save({
        sessionId,
        sessionHash,
        actorId: admission.actorId,
        tokenId: admission.tokenId,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + config.http.sessionIdleMs
      });
      context.runtimes.set(sessionId, {
        transport,
        server: mcpServer,
        actorId: admission.actorId,
        tokenId: admission.tokenId,
        sessionHash
      });
      context.auditEvents.append({
        actorId: admission.actorId,
        tokenId: admission.tokenId,
        transport: "streamable_http",
        sessionIdHash: sessionHash,
        action: "http.session.initialize",
        outcome: "succeeded",
        details: {}
      });
    }
  });

  transport.onclose = () => {
    const sessionId = transport.sessionId;
    if (!sessionId) {
      return;
    }
    const runtime = context.runtimes.get(sessionId);
    if (runtime) {
      context.sessions.close(runtime.sessionHash);
      context.runtimes.delete(sessionId);
    }
  };

  attachAuthInfo(request, admission);
  await mcpServer.connect(transport);
  await transport.handleRequest(request, response, parsedBody);
}

function nativeTlsOptions(config: ComfyMcpConfig): https.ServerOptions {
  const tls = loadTlsMaterial(config.http.tlsCert, config.http.tlsKey);
  if (!tls.ok) {
    throw new Error(`Unable to load native TLS material: ${tls.reason}`);
  }
  return {
    cert: tls.cert,
    key: tls.key,
    minVersion: "TLSv1.2"
  };
}

function attachAuthInfo(
  request: IncomingMessage,
  admission: Extract<ReturnType<typeof admitHttpRequest>, { ok: true }>
): void {
  const auth: AuthInfo = {
    token: admission.tokenId,
    clientId: admission.actorId,
    scopes: ["comfymcp-local"],
    extra: {
      actor_id: admission.actorId,
      token_id: admission.tokenId
    }
  };
  (request as IncomingMessage & { auth?: AuthInfo }).auth = auth;
}

function writeAdmissionFailure(
  response: ServerResponse,
  decision: Extract<ReturnType<typeof admitHttpRequest>, { ok: false }>
): void {
  for (const [name, value] of Object.entries(decision.headers ?? {})) {
    response.setHeader(name, value);
  }
  writeJson(response, decision.status, admissionFailureBody(decision));
}

function writePreflightResponse(
  config: ComfyMcpConfig,
  request: IncomingMessage,
  response: ServerResponse
): void {
  const origin = headerValue(request.headers.origin);
  if (origin && config.http.allowedOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
  response.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID"
  );
  response.writeHead(204);
  response.end();
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify(body));
}

function normalizeHeaders(request: IncomingMessage): Record<string, string | undefined> {
  return {
    host: headerValue(request.headers.host),
    origin: headerValue(request.headers.origin),
    authorization: headerValue(request.headers.authorization)
  };
}

function effectiveRemoteAddress(request: IncomingMessage): string {
  const address = request.socket.remoteAddress ?? "";
  if (address.startsWith("::ffff:")) {
    return address.slice("::ffff:".length);
  }
  return address;
}

function parseContentLength(value: string | string[] | undefined): number {
  const raw = headerValue(value);
  if (!raw) {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number
): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 }> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : toBuffer(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      return { ok: false, status: 413 };
    }
    chunks.push(buffer);
  }

  try {
    return {
      ok: true,
      value: chunks.length === 0 ? undefined : (JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown)
    };
  } catch {
    return { ok: false, status: 400 };
  }
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  return Buffer.from(String(value));
}
