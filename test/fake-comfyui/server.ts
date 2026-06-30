import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

export type FakeComfyUiServer = {
  url: string;
  close(): Promise<void>;
};

type PromptRecord = {
  prompt_id: string;
  prompt: unknown;
  client_id: string;
  cancelled: boolean;
};

type FakeWebSocketClient = {
  socket: Duplex;
};

export async function startFakeComfyUiServer(): Promise<FakeComfyUiServer> {
  const prompts = new Map<string, PromptRecord>();
  const websocketClients = new Set<FakeWebSocketClient>();
  let promptCounter = 0;

  const server = http.createServer((request, response) => {
    void route(request, response, {
      prompts,
      websocketClients,
      nextPromptId: () => {
        promptCounter += 1;
        return `fake-prompt-${promptCounter}`;
      }
    });
  });

  server.on("upgrade", (request, socket) => {
    handleWebSocketUpgrade(request, socket, websocketClients);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start fake ComfyUI server");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const client of websocketClients) {
          client.socket.destroy();
        }
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      })
  };
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  context: {
    prompts: Map<string, PromptRecord>;
    websocketClients: Set<FakeWebSocketClient>;
    nextPromptId: () => string;
  }
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/system_stats") {
    json(response, {
      system: {
        os: "fake",
        python_version: "3.11.0",
        embedded_python: false
      },
      devices: [{ name: "Fake GPU", type: "cuda", vram_total: 12_000, vram_free: 10_000 }]
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/object_info") {
    json(response, fakeObjectInfo());
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/object_info/")) {
    const classType = decodeURIComponent(url.pathname.slice("/object_info/".length));
    const info = fakeObjectInfo();
    json(response, info[classType] ? { [classType]: info[classType] } : {});
    return;
  }

  if (request.method === "GET" && url.pathname === "/models") {
    json(response, ["checkpoints", "loras", "vae"]);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/models/")) {
    const folder = decodeURIComponent(url.pathname.slice("/models/".length));
    json(response, folder === "checkpoints" ? ["fake-checkpoint.safetensors"] : []);
    return;
  }

  if (request.method === "POST" && url.pathname === "/prompt") {
    const body = (await readJson(request)) as { prompt?: unknown; client_id?: string };
    const promptId = context.nextPromptId();
    context.prompts.set(promptId, {
      prompt_id: promptId,
      prompt: body.prompt,
      client_id: body.client_id ?? "unknown",
      cancelled: false
    });
    setTimeout(() => {
      emitPromptEvents(context.websocketClients, promptId, body.prompt);
    }, 10);
    json(response, { prompt_id: promptId, number: context.prompts.size, node_errors: {} });
    return;
  }

  if (request.method === "GET" && url.pathname === "/queue") {
    json(response, { queue_running: [], queue_pending: [] });
    return;
  }

  if (request.method === "POST" && url.pathname === "/queue") {
    const body = asRecord(await readJson(request));
    for (const promptId of arrayAt(body, "delete")) {
      if (typeof promptId === "string") {
        const prompt = context.prompts.get(promptId);
        if (prompt) {
          prompt.cancelled = true;
        }
      }
    }
    json(response, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/history") {
    json(
      response,
      Object.fromEntries(
        Array.from(context.prompts.entries()).map(([promptId, prompt]) => [promptId, historyForPrompt(prompt)])
      )
    );
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/history/")) {
    const promptId = decodeURIComponent(url.pathname.slice("/history/".length));
    const prompt = context.prompts.get(promptId);
    json(response, prompt ? { [promptId]: historyForPrompt(prompt) } : {});
    return;
  }

  if (request.method === "POST" && (url.pathname === "/interrupt" || url.pathname === "/free")) {
    json(response, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/upload/image") {
    json(response, { name: "uploaded.png", subfolder: "", type: "input" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/view") {
    const bytes = Buffer.from("fake-png-bytes", "utf8");
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.byteLength)
    });
    response.end(bytes);
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
}

function fakeObjectInfo(): Record<string, unknown> {
  return {
    CheckpointLoaderSimple: {
      input: { required: { ckpt_name: [["fake-checkpoint.safetensors"]] } },
      output: ["MODEL", "CLIP", "VAE"],
      category: "loaders"
    },
    KSampler: {
      input: { required: { seed: ["INT"], steps: ["INT"] } },
      output: ["LATENT"],
      category: "sampling"
    },
    SaveImage: {
      input: { required: { images: ["IMAGE"] } },
      output: [],
      category: "image"
    },
    FailNode: {
      input: { required: {} },
      output: [],
      category: "testing"
    }
  };
}

function historyForPrompt(prompt: PromptRecord): Record<string, unknown> {
  if (prompt.cancelled) {
    return {
      status: {
        completed: false,
        status_str: "error",
        messages: [
          [
            "execution_error",
            {
              prompt_id: prompt.prompt_id,
              message: "Fake workflow was cancelled"
            }
          ]
        ]
      },
      outputs: {}
    };
  }

  if (promptShouldFail(prompt.prompt)) {
    return {
      status: {
        completed: false,
        status_str: "error",
        messages: [
          [
            "execution_error",
            {
              prompt_id: prompt.prompt_id,
              node_id: firstNodeOfType(prompt.prompt, "FailNode") ?? "fail",
              exception_message: "Fake workflow failed"
            }
          ]
        ]
      },
      outputs: {}
    };
  }

  return {
    status: {
      completed: true,
      status_str: "success"
    },
    outputs: imageOutputsForPrompt(prompt)
  };
}

function imageOutputsForPrompt(prompt: PromptRecord): Record<string, unknown> {
  const saveNodeIds = nodesOfType(prompt.prompt, "SaveImage");
  const outputNodeIds = saveNodeIds.length > 0 ? saveNodeIds : ["9"];
  return Object.fromEntries(
    outputNodeIds.map((nodeId, index) => [
      nodeId,
      {
        images: [
          {
            filename: `${prompt.prompt_id}-${index + 1}.png`,
            subfolder: "",
            type: "output"
          }
        ]
      }
    ])
  );
}

function emitPromptEvents(
  websocketClients: Set<FakeWebSocketClient>,
  promptId: string,
  prompt: unknown
): void {
  sendWebSocketJson(websocketClients, {
    type: "executing",
    data: {
      prompt_id: promptId,
      node: firstExecutableNode(prompt) ?? "1"
    }
  });
  sendWebSocketJson(
    websocketClients,
    promptShouldFail(prompt)
      ? {
          type: "execution_error",
          data: {
            prompt_id: promptId,
            node_id: firstNodeOfType(prompt, "FailNode") ?? "fail",
            exception_message: "Fake workflow failed"
          }
        }
      : {
          type: "executing",
          data: {
            prompt_id: promptId,
            node: null
          }
        }
  );
}

function handleWebSocketUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  websocketClients: Set<FakeWebSocketClient>
): void {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const key = request.headers["sec-websocket-key"];
  if (url.pathname !== "/ws" || typeof key !== "string") {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n"
    ].join("\r\n")
  );

  const client = { socket };
  websocketClients.add(client);
  const removeClient = () => {
    websocketClients.delete(client);
  };
  socket.once("close", removeClient);
  socket.once("error", removeClient);
}

function sendWebSocketJson(websocketClients: Set<FakeWebSocketClient>, message: unknown): void {
  const frame = webSocketTextFrame(JSON.stringify(message));
  for (const client of websocketClients) {
    client.socket.write(frame);
  }
}

function webSocketTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function promptShouldFail(prompt: unknown): boolean {
  return nodesOfType(prompt, "FailNode").length > 0;
}

function firstExecutableNode(prompt: unknown): string | undefined {
  return Object.keys(asRecord(prompt))[0];
}

function firstNodeOfType(prompt: unknown, classType: string): string | undefined {
  return nodesOfType(prompt, classType)[0];
}

function nodesOfType(prompt: unknown, classType: string): string[] {
  return Object.entries(asRecord(prompt)).flatMap(([nodeId, node]) => {
    const nodeRecord = asRecord(node);
    return nodeRecord.class_type === classType ? [nodeId] : [];
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    } else if (chunk instanceof Uint8Array) {
      chunks.push(Buffer.from(chunk));
    }
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function json(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function arrayAt(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
