import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/schema.js";
import { listTools, omittedTools, toolNames } from "../../src/tools/index.js";
import { PROMPTS } from "../../src/prompts/index.js";
import { RESOURCE_TEMPLATES } from "../../src/resources/index.js";

function connectedSafeConfig() {
  return parseEnv({
    COMFYMCP_COMFYUI_PATH: "/tmp/ComfyUI",
    COMFYMCP_EXPORT_ROOT: "/tmp/exports"
  });
}

function fullConfig() {
  return parseEnv({
    COMFYMCP_COMFYUI_PATH: "/tmp/ComfyUI",
    COMFYMCP_EXPORT_ROOT: "/tmp/exports",
    COMFYMCP_COMFYUI_COMMAND: "python",
    COMFYMCP_COMFYUI_ARGS_JSON: "[\"main.py\"]",
    COMFYMCP_ADMIN_MUTATIONS: "true"
  });
}

describe("MCP contract inventory", () => {
  it("exposes the documented 33-tool connected admin-disabled inventory", () => {
    const names = toolNames(connectedSafeConfig());

    expect(names).toHaveLength(33);
    expect(names).not.toContain("system_control");
    expect(names).not.toContain("workflows_delete");
    expect(names).not.toContain("jobs_queue");
    expect(names).not.toContain("assets_delete");
    expect(names).not.toContain("models_apply_install");
    expect(names).not.toContain("models_cancel_download");
    expect(names).not.toContain("models_remove");
    expect(names).not.toContain("nodes_apply_change");
    expect(names).not.toContain("nodes_snapshots");
    expect(names).toContain("assets_export");
  });

  it("exposes the documented 42-tool local-full inventory when administrative capabilities are enabled", () => {
    const tools = listTools(fullConfig());

    expect(tools).toHaveLength(42);
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["system_control", "models_apply_install", "nodes_snapshots"])
    );
  });

  it("reports capability-dependent omissions separately", () => {
    const omissions = omittedTools(parseEnv({ COMFYMCP_ADMIN_MUTATIONS: "true" }));

    expect(omissions).toEqual(
      expect.arrayContaining([
        { name: "assets_export", reason: "export_root_unconfigured" },
        { name: "models_apply_install", reason: "comfyui_path_unconfigured" },
        { name: "system_control", reason: "process_control_unconfigured" }
      ])
    );
  });

  it("ships the resource templates and prompt names from the brief", () => {
    expect(RESOURCE_TEMPLATES).toHaveLength(7);
    expect(PROMPTS).toEqual([
      "generate-image",
      "generate-video",
      "generate-audio",
      "generate-3d",
      "edit-image",
      "install-model",
      "repair-workflow"
    ]);
  });
});
