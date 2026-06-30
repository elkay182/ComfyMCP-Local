import { z } from "zod";

export const pageInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().positive().optional()
});

export const workflowManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  media_type: z.enum(["image", "video", "audio", "3d", "generic"]).optional(),
  entrypoint: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()).default({}),
  outputs: z.array(z.record(z.string(), z.unknown())).default([]),
  requires: z
    .object({
      nodes: z.array(z.string()).default([]),
      models: z.array(z.unknown()).default([])
    })
    .default({ nodes: [], models: [] }),
  policy: z
    .object({
      runtime: z.enum(["local", "api", "mixed", "unknown"]).default("local")
    })
    .default({ runtime: "local" })
});

export const workflowRunInputSchema = z.object({
  workflow: z.union([
    z.object({
      workflow_id: z.string().min(1),
      version: z.string().optional()
    }),
    z.object({
      api_graph: z.record(z.string(), z.unknown()),
      manifest: workflowManifestSchema.optional()
    })
  ]),
  inputs: z.record(z.string(), z.unknown()),
  priority: z.enum(["normal", "front"]).optional(),
  idempotency_key: z.string().min(1),
  limits: z.record(z.string(), z.unknown()).optional()
});

export type WorkflowManifest = z.infer<typeof workflowManifestSchema>;
export type WorkflowRunInput = z.infer<typeof workflowRunInputSchema>;
