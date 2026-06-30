import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/schema.js";
import { createMcpServer } from "../../src/mcp/server.js";

let activeClient: Client | undefined;
let activeServer: McpServer | undefined;

afterEach(async () => {
  await activeClient?.close();
  await activeServer?.close();
  activeClient = undefined;
  activeServer = undefined;
});

describe("SDK-backed MCP server", () => {
  it("completes MCP initialization and exposes the configured tool inventory", async () => {
    const config = parseEnv({
      COMFYMCP_COMFYUI_PATH: "/tmp/ComfyUI",
      COMFYMCP_EXPORT_ROOT: "/tmp/exports"
    });
    const client = await connectClient(createMcpServer(config));

    const tools = await client.listTools();

    expect(client.getServerVersion()).toMatchObject({
      name: "comfymcp-local",
      version: "0.1.0"
    });
    expect(tools.tools).toHaveLength(33);
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["system_status", "system_capabilities", "assets_export"])
    );
    const statusTool = tools.tools.find((tool) => tool.name === "system_status");
    expect(statusTool?.description).toContain("Mutation class: read_only");
    expect(statusTool?.inputSchema).toEqual({
      type: "object",
      properties: {}
    });
    expect(statusTool?.annotations).toEqual({
      title: "System Status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    });
    expect(tools.tools.find((tool) => tool.name === "models_search")).toMatchObject({
      annotations: {
        readOnlyHint: true,
        openWorldHint: true
      }
    });
  });

  it("runs system_status and system_capabilities through tools/call", async () => {
    const config = parseEnv({});
    const client = await connectClient(
      createMcpServer(config, {
        getStatus: () =>
          Promise.resolve({
            server_name: "comfymcp-local",
            comfyui_connection: "disconnected"
          }),
        getCapabilities: () => ({
          tools: ["system_status", "system_capabilities"],
          omitted_tools: []
        })
      })
    );

    const status = await client.callTool({
      name: "system_status"
    });
    const capabilities = await client.callTool({
      name: "system_capabilities"
    });

    expect(status.isError).toBeUndefined();
    expect(status.structuredContent).toMatchObject({
      ok: true,
      summary: "System status reported",
      status: {
        comfyui_connection: "disconnected"
      }
    });
    expect(capabilities.structuredContent).toMatchObject({
      ok: true,
      summary: "System capabilities reported",
      capabilities: {
        tools: ["system_status", "system_capabilities"]
      }
    });
  });

  it("runs the remaining implemented system tools and reports unsupported tools as structured errors", async () => {
    const client = await connectClient(
      createMcpServer(parseEnv({}), {
        getLogs: () => ({
          entries: [{ level: "info", message: "hello" }],
          truncated: false
        }),
        clearVram: () => Promise.resolve({ ok: true })
      })
    );

    const logs = await client.callTool({
      name: "system_logs"
    });
    const clearVram = await client.callTool({
      name: "system_clear_vram"
    });
    const unsupported = await client.callTool({
      name: "workflows_list"
    });

    expect(logs.structuredContent).toMatchObject({
      ok: true,
      logs: {
        entries: [{ level: "info", message: "hello" }]
      }
    });
    expect(clearVram.structuredContent).toMatchObject({
      ok: true,
      summary: "ComfyUI VRAM clear requested",
      result: {
        ok: true
      }
    });
    expect(unsupported).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: {
          code: "CAPABILITY_UNAVAILABLE"
        }
      }
    });
  });
});

async function connectClient(server: McpServer): Promise<Client> {
  const client = new Client({
    name: "test-client",
    version: "0.1.0"
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  activeClient = client;
  activeServer = server;
  return client;
}
