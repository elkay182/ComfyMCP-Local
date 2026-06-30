import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { parseEnv, type ComfyMcpConfig } from "../../src/config/schema.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { databasePathForStateDir, openDatabase } from "../../src/persistence/database.js";
import { AuthTokenRepository } from "../../src/persistence/repositories/index.js";
import {
  startStreamableHttpServer,
  type StreamableHttpServerHandle
} from "../../src/transport/streamable-http.js";
import type { CreatedBearerToken } from "../../src/transport/http-auth.js";

const tempDirs: string[] = [];
const clients: Client[] = [];
const servers: McpServer[] = [];
const httpServers: StreamableHttpServerHandle[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close();
  }
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const server of httpServers.splice(0)) {
    await server.close();
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Streamable HTTP MCP transport", () => {
  it("exposes the same tools/list inventory as the stdio MCP server", async () => {
    const port = await getFreePort();
    const stateDir = tempStateDir();
    const bearer = createStoredBearer(stateDir);
    const httpConfig = streamableConfig(port, stateDir);
    const stdioConfig = parseEnv({
      COMFYMCP_COMFYUI_PATH: "/tmp/ComfyUI",
      COMFYMCP_EXPORT_ROOT: "/tmp/exports"
    });
    const httpServer = await startStreamableHttpServer(httpConfig, { stateDir });
    httpServers.push(httpServer);

    const stdioClient = await connectInMemory(createMcpServer(stdioConfig));
    const { client: httpClient, transport } = await connectHttp(httpServer.url, bearer.plaintext);

    const stdioTools = await stdioClient.listTools();
    const httpTools = await httpClient.listTools();

    expect(httpTools.tools).toEqual(stdioTools.tools);
    expect(httpServer.activeSessionCount()).toBe(1);

    await transport.terminateSession();
    expect(httpServer.activeSessionCount()).toBe(0);
  });

  it("rejects unauthenticated and hostile-host requests before MCP dispatch", async () => {
    const port = await getFreePort();
    const stateDir = tempStateDir();
    const bearer = createStoredBearer(stateDir);
    const config = streamableConfig(port, stateDir);
    const server = await startStreamableHttpServer(config, { stateDir });
    httpServers.push(server);

    const unauthenticated = await rawPost(port, {
      Host: `127.0.0.1:${port}`
    });
    const hostileHost = await rawPost(port, {
      Authorization: `Bearer ${bearer.plaintext}`,
      Host: "evil.example"
    });

    expect(unauthenticated).toMatchObject({
      status: 401,
      headers: {
        "www-authenticate": "Bearer"
      },
      body: {
        ok: false,
        error: {
          code: "UNAUTHENTICATED"
        }
      }
    });
    expect(hostileHost).toMatchObject({
      status: 403,
      body: {
        ok: false,
        error: {
          code: "FORBIDDEN"
        }
      }
    });
    expect(server.activeSessionCount()).toBe(0);
  });

  it("rejects disallowed client CIDRs before MCP dispatch", async () => {
    const port = await getFreePort();
    const stateDir = tempStateDir();
    const bearer = createStoredBearer(stateDir);
    const config = streamableConfig(port, stateDir, {
      allowedClientCidrs: "10.0.0.0/8"
    });
    const server = await startStreamableHttpServer(config, { stateDir });
    httpServers.push(server);

    const response = await rawPost(port, {
      Authorization: `Bearer ${bearer.plaintext}`,
      Host: `127.0.0.1:${port}`
    });

    expect(response).toMatchObject({
      status: 403,
      body: {
        ok: false,
        error: {
          code: "FORBIDDEN"
        }
      }
    });
    expect(server.activeSessionCount()).toBe(0);
  });

  it("rate-limits admitted HTTP request volume before MCP dispatch", async () => {
    const port = await getFreePort();
    const stateDir = tempStateDir();
    createStoredBearer(stateDir);
    const config = streamableConfig(port, stateDir, {
      rateLimitPerMinute: "1"
    });
    const server = await startStreamableHttpServer(config, { stateDir });
    httpServers.push(server);

    const first = await rawPost(port, {
      Host: `127.0.0.1:${port}`
    });
    const second = await rawPost(port, {
      Host: `127.0.0.1:${port}`
    });

    expect(first.status).toBe(401);
    expect(second).toMatchObject({
      status: 429,
      body: {
        ok: false,
        error: {
          code: "RATE_LIMITED"
        }
      }
    });
  });

  it("rate-limits repeated authentication failures", async () => {
    const port = await getFreePort();
    const stateDir = tempStateDir();
    createStoredBearer(stateDir);
    const config = streamableConfig(port, stateDir, {
      authFailuresPerMinute: "1",
      rateLimitPerMinute: "20"
    });
    const server = await startStreamableHttpServer(config, { stateDir });
    httpServers.push(server);

    const first = await rawPost(port, {
      Host: `127.0.0.1:${port}`
    });
    const second = await rawPost(port, {
      Host: `127.0.0.1:${port}`
    });

    expect(first.status).toBe(401);
    expect(second).toMatchObject({
      status: 429,
      body: {
        ok: false,
        error: {
          code: "RATE_LIMITED"
        }
      }
    });
  });
});

async function connectInMemory(server: McpServer): Promise<Client> {
  const client = new Client({
    name: "stdio-parity-client",
    version: "0.1.0"
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  clients.push(client);
  servers.push(server);
  return client;
}

async function connectHttp(
  url: URL,
  bearer: string
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const client = new Client({
    name: "http-parity-client",
    version: "0.1.0"
  });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${bearer}`
      }
    }
  });
  await client.connect(transport);
  clients.push(client);
  return { client, transport };
}

function streamableConfig(
  port: number,
  stateDir: string,
  overrides: { allowedClientCidrs?: string; rateLimitPerMinute?: string; authFailuresPerMinute?: string } = {}
): ComfyMcpConfig {
  return parseEnv({
    COMFYMCP_TRANSPORT: "streamable_http",
    COMFYMCP_HTTP_BIND: "127.0.0.1",
    COMFYMCP_HTTP_PORT: String(port),
    COMFYMCP_HTTP_ADVERTISED_URL: `https://127.0.0.1:${port}/mcp`,
    COMFYMCP_HTTP_TLS_MODE: "trusted_proxy",
    COMFYMCP_HTTP_ALLOWED_CLIENT_CIDRS: overrides.allowedClientCidrs ?? "127.0.0.1/32",
    COMFYMCP_HTTP_ALLOWED_HOSTS: `127.0.0.1:${port}`,
    COMFYMCP_HTTP_TRUSTED_PROXY_CIDRS: "127.0.0.1/32",
    COMFYMCP_HTTP_RATE_LIMIT_PER_MINUTE: overrides.rateLimitPerMinute ?? "120",
    COMFYMCP_HTTP_AUTH_FAILURES_PER_MINUTE: overrides.authFailuresPerMinute ?? "10",
    COMFYMCP_COMFYUI_PATH: "/tmp/ComfyUI",
    COMFYMCP_EXPORT_ROOT: "/tmp/exports",
    COMFYMCP_STATE_DIR: stateDir
  });
}

function createStoredBearer(stateDir: string): CreatedBearerToken {
  const handle = openDatabase(databasePathForStateDir(stateDir));
  try {
    return new AuthTokenRepository(handle.db).create("http-test-client");
  } finally {
    handle.close();
  }
}

function tempStateDir(): string {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "comfymcp-http-"));
  tempDirs.push(stateDir);
  return stateDir;
}

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
  if (!address || typeof address === "string") {
    throw new Error("Failed to allocate a test port");
  }
  return address.port;
}

async function rawPost(
  port: number,
  headers: Record<string, string>
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: unknown }> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: {
        name: "rejection-test",
        version: "0.1.0"
      }
    }
  });

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
          ...headers
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: text ? (JSON.parse(text) as unknown) : undefined
          });
        });
      }
    );
    request.on("error", reject);
    request.end(body);
  });
}
