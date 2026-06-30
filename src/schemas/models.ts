import { z } from "zod";

export const installFileSchema = z.object({
  source_file: z.string(),
  category: z.string(),
  target_name: z.string().optional(),
  expected_sha256: z.string().optional()
});

export const modelInstallRequestSchema = z.union([
  z.object({
    kind: z.literal("pack"),
    pack_id: z.string(),
    version: z.string().optional()
  }),
  z.object({
    kind: z.literal("huggingface"),
    repository: z.string(),
    revision: z.string(),
    files: z.array(installFileSchema)
  }),
  z.object({
    kind: z.literal("civitai"),
    model_version_id: z.number().int(),
    file_ids: z.array(z.number().int()).optional(),
    category: z.string().optional()
  }),
  z.object({
    kind: z.literal("direct"),
    url: z.string().url(),
    file: installFileSchema.extend({
      expected_sha256: z.string()
    })
  })
]);

export const modelsPlanInstallInputSchema = z.object({
  requests: z.array(modelInstallRequestSchema)
});

export const modelsApplyInstallInputSchema = z.object({
  plan_id: z.string(),
  accepted_license_ids: z.array(z.string()).optional(),
  idempotency_key: z.string().min(1)
});

export type ModelInstallRequest = z.infer<typeof modelInstallRequestSchema>;
