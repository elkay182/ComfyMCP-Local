import http, { type IncomingMessage, type ServerResponse } from "node:http";

export type FakeComfyUiServer = {
  url: string;
  close(): Promise<void>;
};

type PromptRecord = {
  prompt_id: string;
  prompt: unknown;
  client_id: string;
};

export async function startFakeComfyUiServer(): Promise<FakeComfyUiServer> {
  const prompts = new Map<string, PromptRecord>();
  let promptCounter = 0;

  const server = http.createServer((request, response) => {
    void route(request, response, prompts, () => {
      promptCounter += 1;
      return `fake-prompt-${promptCounter}`;
    });
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
  prompts: Map<string, PromptRecord>,
  nextPromptId: () => string
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
    const promptId = nextPromptId();
    prompts.set(promptId, {
      prompt_id: promptId,
      prompt: body.prompt,
      client_id: body.client_id ?? "unknown"
    });
    json(response, { prompt_id: promptId, number: prompts.size, node_errors: {} });
    return;
  }

  if (request.method === "GET" && url.pathname === "/queue") {
    json(response, { queue_running: [], queue_pending: [] });
    return;
  }

  if (request.method === "POST" && url.pathname === "/queue") {
    json(response, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/history") {
    json(response, Object.fromEntries(prompts));
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/history/")) {
    const promptId = decodeURIComponent(url.pathname.slice("/history/".length));
    const prompt = prompts.get(promptId);
    json(response, prompt ? { [promptId]: { status: { completed: true }, outputs: {} } } : {});
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
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(Buffer.from([]));
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
    }
  };
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
