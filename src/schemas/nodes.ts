import { z } from "zod";

export const nodesPlanChangeInputSchema = z.object({
  action: z.enum(["install", "update", "remove", "repair", "sync_dependencies"]),
  packages: z.array(
    z.object({
      registry_id: z.string().optional(),
      repository: z.string().optional(),
      revision: z.string().optional()
    })
  )
});

export const nodesApplyChangeInputSchema = z.object({
  plan_id: z.string(),
  approval_token: z.string(),
  restart: z.enum(["never", "if_required"]),
  idempotency_key: z.string().min(1)
});
