import { describe, expect, it } from "vitest";
import { classifyWorkflowRuntime, decideWorkflowPolicy } from "../../src/policy/workflow-policy.js";

describe("workflow policy", () => {
  it("classifies ordinary ComfyUI graphs as local", () => {
    expect(
      classifyWorkflowRuntime({
        "1": { class_type: "CheckpointLoaderSimple" },
        "2": { class_type: "KSampler" },
        "3": { class_type: "SaveImage" }
      })
    ).toBe("local");
  });

  it("rejects API-backed or mixed workflows", () => {
    const graph = {
      "1": { class_type: "CheckpointLoaderSimple" },
      "2": { class_type: "OpenAIImageNode" }
    };

    expect(classifyWorkflowRuntime(graph)).toBe("mixed");
    expect(decideWorkflowPolicy(graph)).toMatchObject({
      ok: false,
      runtime: "mixed",
      code: "WORKFLOW_POLICY_REJECTED",
      nodeId: "2",
      nodeType: "OpenAIImageNode"
    });
  });

  it("treats unclassifiable graphs as unknown", () => {
    expect(classifyWorkflowRuntime({})).toBe("unknown");
    expect(decideWorkflowPolicy({})).toMatchObject({ ok: false, runtime: "unknown" });
  });
});
