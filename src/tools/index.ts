import type { ComfyMcpConfig } from "../config/schema.js";
import type { MutationClass } from "../policy/authorization.js";
import { requiresAdministrativeEnablement } from "../policy/authorization.js";

export type ToolDomain = "system" | "workflows" | "jobs" | "assets" | "models" | "nodes";

export type ToolDefinition = {
  name: string;
  domain: ToolDomain;
  purpose: string;
  mutationClass: MutationClass;
  requiresAdminEnabled?: boolean;
  requiresExportRoot?: boolean;
  requiresComfyUiPath?: boolean;
  requiresProcessControl?: boolean;
};

export type ToolInventoryOptions = {
  includeCapabilityOmissions?: boolean;
};

export const ALL_TOOLS: readonly ToolDefinition[] = [
  tool("system_status", "system", "Connection, versions, sanitized deployment state, roots, devices, queue, and policy mode.", "read_only"),
  tool("system_capabilities", "system", "Local node, model, feature, route, and media capability summary.", "read_only"),
  tool("system_logs", "system", "Bounded and filtered local ComfyUI/MCP logs.", "read_only"),
  tool("system_clear_vram", "system", "Unload cached models through ComfyUI /free.", "local_mutation"),
  tool("system_control", "system", "Start, stop, or restart an owned local ComfyUI process.", "administrative", {
    requiresAdminEnabled: true,
    requiresProcessControl: true
  }),
  tool("workflows_list", "workflows", "Search registered and ComfyUI-library workflows.", "read_only"),
  tool("workflows_get", "workflows", "Read workflow, manifest, dependencies, and provenance.", "read_only"),
  tool("workflows_save", "workflows", "Save an API workflow and optional UI sidecar.", "local_mutation"),
  tool("workflows_delete", "workflows", "Delete a registered workflow revision after dependency and revision checks.", "destructive_administrative", {
    requiresAdminEnabled: true
  }),
  tool("workflows_convert", "workflows", "Convert UI/API formats with an explicit conversion report.", "read_only"),
  tool("workflows_validate", "workflows", "Static, live-node, model, connection, output, and policy validation.", "read_only"),
  tool("workflows_create", "workflows", "Create an API graph from a local template or explicit nodes.", "read_only"),
  tool("workflows_edit", "workflows", "Apply typed graph operations to a workflow value.", "read_only"),
  tool("workflows_run", "workflows", "Submit a validated local workflow and return a job immediately.", "local_mutation"),
  tool("jobs_list", "jobs", "Search persistent jobs by status, workflow, date, or label.", "read_only"),
  tool("jobs_get", "jobs", "Return status, progress, errors, outputs, and resource links.", "read_only"),
  tool("jobs_cancel", "jobs", "Delete a pending prompt or interrupt the currently running prompt.", "local_mutation"),
  tool("jobs_queue", "jobs", "Administer external/pending prompts.", "administrative", {
    requiresAdminEnabled: true
  }),
  tool("assets_upload", "assets", "Validate and upload image, video, audio, mask, or generic input.", "local_mutation"),
  tool("assets_list", "assets", "Search persistent input/output assets.", "read_only"),
  tool("assets_get", "assets", "Return metadata and an MCP resource or bounded inline preview.", "read_only"),
  tool("assets_metadata", "assets", "Return complete generation and file provenance.", "read_only"),
  tool("assets_stage_as_input", "assets", "Copy or upload a generated output into ComfyUI input storage.", "local_mutation"),
  tool("assets_regenerate", "assets", "Re-run the originating workflow with typed overrides.", "local_mutation"),
  tool("assets_export", "assets", "Copy an asset into the configured user export root.", "local_mutation", {
    requiresExportRoot: true
  }),
  tool("assets_delete", "assets", "Delete asset content or metadata under retention and dependency rules.", "destructive_administrative", {
    requiresAdminEnabled: true
  }),
  tool("models_list", "models", "List installed local models by ComfyUI folder type.", "read_only"),
  tool("models_search", "models", "Search approved model providers.", "networked_read_only"),
  tool("models_inspect", "models", "Read remote/local metadata, files, hashes, licenses, and compatibility.", "networked_read_only"),
  tool("models_plan_install", "models", "Resolve model requests into an immutable install plan.", "networked_read_only"),
  tool("models_apply_install", "models", "Execute an approved install plan.", "administrative", {
    requiresAdminEnabled: true,
    requiresComfyUiPath: true
  }),
  tool("models_download_status", "models", "Return bytes, speed, ETA, verification, and destination.", "read_only"),
  tool("models_cancel_download", "models", "Stop an active download without exposing a partial model.", "administrative", {
    requiresAdminEnabled: true
  }),
  tool("models_verify", "models", "Hash and validate installed files against a manifest.", "read_only"),
  tool("models_plan_remove", "models", "Report files, reclaimed space, workflow dependents, and an immutable removal plan.", "read_only"),
  tool("models_remove", "models", "Apply an approved removal plan after containment and use checks.", "destructive_administrative", {
    requiresAdminEnabled: true,
    requiresComfyUiPath: true
  }),
  tool("nodes_search", "nodes", "Search live node classes and approved Registry metadata.", "networked_read_only"),
  tool("nodes_describe", "nodes", "Return live inputs, outputs, defaults, package, and category.", "read_only"),
  tool("nodes_packs", "nodes", "List installed packs, versions, commits, and dependency health.", "read_only"),
  tool("nodes_plan_change", "nodes", "Plan install, update, remove, repair, or dependency sync.", "networked_read_only"),
  tool("nodes_apply_change", "nodes", "Apply a previously approved immutable plan.", "administrative", {
    requiresAdminEnabled: true,
    requiresComfyUiPath: true
  }),
  tool("nodes_snapshots", "nodes", "List, save, or restore custom-node snapshots.", "administrative", {
    requiresAdminEnabled: true,
    requiresComfyUiPath: true
  })
];

const IMPLEMENTED_TOOL_NAMES = new Set([
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

export function listTools(
  config: ComfyMcpConfig,
  options: ToolInventoryOptions = {}
): ToolDefinition[] {
  return ALL_TOOLS.filter((definition) => isToolAvailable(config, definition, options));
}

export function omittedTools(config: ComfyMcpConfig): Array<{ name: string; reason: string }> {
  return ALL_TOOLS.flatMap((definition) => {
    const reason = omissionReason(config, definition);
    return reason ? [{ name: definition.name, reason }] : [];
  });
}

export function toolNames(config: ComfyMcpConfig): string[] {
  return listTools(config).map((definition) => definition.name);
}

function isToolAvailable(
  config: ComfyMcpConfig,
  definition: ToolDefinition,
  options: ToolInventoryOptions
): boolean {
  if (options.includeCapabilityOmissions) {
    return true;
  }
  return omissionReason(config, definition) === undefined;
}

function omissionReason(config: ComfyMcpConfig, definition: ToolDefinition): string | undefined {
  if (!IMPLEMENTED_TOOL_NAMES.has(definition.name)) {
    return "not_implemented";
  }
  if (definition.requiresAdminEnabled || requiresAdministrativeEnablement(definition.mutationClass)) {
    if (!config.adminMutations) {
      return "administrative_mutations_disabled";
    }
  }
  if (definition.requiresExportRoot && !config.exportRoot) {
    return "export_root_unconfigured";
  }
  if (definition.requiresComfyUiPath && !config.comfyuiPath) {
    return "comfyui_path_unconfigured";
  }
  if (definition.requiresProcessControl && !config.comfyuiCommand) {
    return "process_control_unconfigured";
  }
  return undefined;
}

function tool(
  name: string,
  domain: ToolDomain,
  purpose: string,
  mutationClass: MutationClass,
  extra: Omit<ToolDefinition, "name" | "domain" | "purpose" | "mutationClass"> = {}
): ToolDefinition {
  return {
    name,
    domain,
    purpose,
    mutationClass,
    ...extra
  };
}
