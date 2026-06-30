import { z } from "zod";

const idempotentBase = {
  idempotency_key: z.string().min(1)
};

export const assetUploadInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("single"),
    source: z.union([
      z.object({ kind: z.literal("base64"), data: z.string(), mime_type: z.string() }),
      z.object({ kind: z.literal("resource"), uri: z.string() }),
      z.object({ kind: z.literal("host_path"), path: z.string() })
    ]),
    target: z.enum(["input", "mask", "registry_only"]),
    filename: z.string().optional(),
    ...idempotentBase
  }),
  z.object({
    action: z.literal("begin"),
    filename: z.string(),
    mime_type: z.string(),
    total_bytes: z.number().int().nonnegative(),
    sha256: z.string(),
    target: z.enum(["input", "mask", "registry_only"]),
    ...idempotentBase
  }),
  z.object({
    action: z.literal("chunk"),
    upload_id: z.string(),
    index: z.number().int().nonnegative(),
    data_base64: z.string(),
    chunk_sha256: z.string(),
    ...idempotentBase
  }),
  z.object({
    action: z.enum(["commit", "cancel"]),
    upload_id: z.string(),
    ...idempotentBase
  })
]);

export type AssetUploadInput = z.infer<typeof assetUploadInputSchema>;
