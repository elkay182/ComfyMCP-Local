export type WorkflowRuntimeClass = "local" | "api" | "mixed" | "unknown";

const API_NODE_PATTERNS = [
  /api/i,
  /cloud/i,
  /http/i,
  /webhook/i,
  /openai/i,
  /replicate/i,
  /fal/i,
  /stability/i,
  /midjourney/i
];

export type WorkflowPolicyDecision =
  | { ok: true; runtime: "local" }
  | {
      ok: false;
      runtime: Exclude<WorkflowRuntimeClass, "local">;
      code: "WORKFLOW_POLICY_REJECTED";
      nodeId?: string;
      nodeType?: string;
      message: string;
    };

export function classifyWorkflowRuntime(apiGraph: Record<string, unknown>): WorkflowRuntimeClass {
  const nodeTypes = Object.values(apiGraph).flatMap((node) => {
    if (!isRecord(node)) {
      return [];
    }
    const classType = node.class_type;
    return typeof classType === "string" ? [classType] : [];
  });

  if (nodeTypes.length === 0) {
    return "unknown";
  }

  const hasApiNode = nodeTypes.some((type) => API_NODE_PATTERNS.some((pattern) => pattern.test(type)));
  const hasLocalNode = nodeTypes.some((type) => !API_NODE_PATTERNS.some((pattern) => pattern.test(type)));

  if (hasApiNode && hasLocalNode) {
    return "mixed";
  }
  if (hasApiNode) {
    return "api";
  }
  return "local";
}

export function decideWorkflowPolicy(apiGraph: Record<string, unknown>): WorkflowPolicyDecision {
  const runtime = classifyWorkflowRuntime(apiGraph);
  if (runtime === "local") {
    return { ok: true, runtime };
  }
  const offending = findFirstApiNode(apiGraph);
  return {
    ok: false,
    runtime,
    code: "WORKFLOW_POLICY_REJECTED",
    nodeId: offending?.id,
    nodeType: offending?.type,
    message:
      runtime === "unknown"
        ? "Workflow runtime could not be classified as local"
        : "Workflow contains an API-backed or cloud-like node"
  };
}

function findFirstApiNode(apiGraph: Record<string, unknown>): { id: string; type: string } | undefined {
  for (const [id, node] of Object.entries(apiGraph)) {
    if (!isRecord(node) || typeof node.class_type !== "string") {
      continue;
    }
    if (API_NODE_PATTERNS.some((pattern) => pattern.test(node.class_type as string))) {
      return { id, type: node.class_type };
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
