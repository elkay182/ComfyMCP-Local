import { afterEach, describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/schema.js";
import { ComfyRestClient } from "../../src/comfyui/rest-client.js";
import { ComfyUiAdapter } from "../../src/comfyui/adapter.js";
import { startFakeComfyUiServer, type FakeComfyUiServer } from "../fake-comfyui/server.js";

let server: FakeComfyUiServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("fake ComfyUI integration", () => {
  it("supports discovery and prompt submission through the loopback adapter", async () => {
    server = await startFakeComfyUiServer();
    const config = parseEnv({
      COMFYMCP_COMFYUI_URL: server.url
    });
    const client = new ComfyRestClient(config);

    await expect(client.getSystemStats()).resolves.toMatchObject({
      devices: [{ name: "Fake GPU" }]
    });
    await expect(client.getObjectInfo("KSampler")).resolves.toHaveProperty("KSampler");
    await expect(client.getModels("checkpoints")).resolves.toContain("fake-checkpoint.safetensors");

    const prompt = await client.postPrompt({ "1": { class_type: "SaveImage" } }, "test-client");
    expect(prompt.prompt_id).toBe("fake-prompt-1");
    await expect(client.getHistory(prompt.prompt_id)).resolves.toHaveProperty(prompt.prompt_id);
  });

  it("summarizes connected snapshots", async () => {
    server = await startFakeComfyUiServer();
    const config = parseEnv({
      COMFYMCP_COMFYUI_URL: server.url
    });
    const adapter = new ComfyUiAdapter(config);

    await expect(adapter.snapshot()).resolves.toMatchObject({
      state: "connected",
      systemStats: {
        devices: [{ name: "Fake GPU" }]
      }
    });
  });
});
