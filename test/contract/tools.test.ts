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
  it("exposes only implemented production tools by default", () => {
    const names = toolNames(connectedSafeConfig());

    expect(names).toEqual([
      "system_status",
      "system_capabilities",
      "system_logs",
      "system_clear_vram",
      "workflows_validate",
      "workflows_run",
      "jobs_list",
      "jobs_get",
      "jobs_cancel"
    ]);
    expect(names).not.toContain("system_control");
    expect(names).not.toContain("workflows_list");
    expect(names).not.toContain("jobs_queue");
    expect(names).not.toContain("assets_export");
  });

  it("keeps the full roadmap inventory available for contract introspection", () => {
    const tools = listTools(fullConfig());
    const roadmap = listTools(fullConfig(), { includeCapabilityOmissions: true });

    expect(tools).toHaveLength(9);
    expect(roadmap).toHaveLength(42);
    expect(roadmap.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["system_control", "models_apply_install", "nodes_snapshots"])
    );
  });

  it("reports default omissions separately", () => {
    const omissions = omittedTools(parseEnv({ COMFYMCP_ADMIN_MUTATIONS: "true" }));

    expect(omissions).toEqual(
      expect.arrayContaining([
        { name: "workflows_list", reason: "not_implemented" },
        { name: "assets_export", reason: "not_implemented" },
        { name: "models_apply_install", reason: "not_implemented" },
        { name: "system_control", reason: "not_implemented" }
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
