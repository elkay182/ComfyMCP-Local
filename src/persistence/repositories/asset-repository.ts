import crypto from "node:crypto";
import type Database from "better-sqlite3";

export type AssetRecord = {
  assetId: string;
  jobId: string;
  promptId?: string;
  nodeId: string;
  kind: string;
  mimeType?: string;
  comfyuiFilename?: string;
  subfolder?: string;
  storageType?: string;
  resourceUri: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type AssetRow = {
  asset_id: string;
  job_id: string;
  prompt_id: string | null;
  node_id: string;
  kind: string;
  mime_type: string | null;
  comfyui_filename: string | null;
  subfolder: string | null;
  storage_type: string | null;
  resource_uri: string;
  metadata_json: string;
  created_at: string;
};

export class AssetRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  create(input: Omit<AssetRecord, "assetId" | "resourceUri" | "createdAt">): AssetRecord {
    const assetId = `asset_${crypto.randomBytes(16).toString("base64url")}`;
    const record: AssetRecord = {
      ...input,
      assetId,
      resourceUri: `comfymcp://assets/${assetId}`,
      createdAt: new Date().toISOString()
    };
    this.#db
      .prepare<{
        asset_id: string;
        job_id: string;
        prompt_id: string | null;
        node_id: string;
        kind: string;
        mime_type: string | null;
        comfyui_filename: string | null;
        subfolder: string | null;
        storage_type: string | null;
        resource_uri: string;
        metadata_json: string;
        created_at: string;
      }>(
        `
          INSERT INTO assets (
            asset_id, job_id, prompt_id, node_id, kind, mime_type, comfyui_filename,
            subfolder, storage_type, resource_uri, metadata_json, created_at
          ) VALUES (
            @asset_id, @job_id, @prompt_id, @node_id, @kind, @mime_type, @comfyui_filename,
            @subfolder, @storage_type, @resource_uri, @metadata_json, @created_at
          )
        `
      )
      .run({
        asset_id: record.assetId,
        job_id: record.jobId,
        prompt_id: record.promptId ?? null,
        node_id: record.nodeId,
        kind: record.kind,
        mime_type: record.mimeType ?? null,
        comfyui_filename: record.comfyuiFilename ?? null,
        subfolder: record.subfolder ?? null,
        storage_type: record.storageType ?? null,
        resource_uri: record.resourceUri,
        metadata_json: JSON.stringify(record.metadata),
        created_at: record.createdAt
      });
    return record;
  }

  listByJobId(jobId: string): AssetRecord[] {
    return this.#db
      .prepare<[string], AssetRow>(
        `
          SELECT asset_id, job_id, prompt_id, node_id, kind, mime_type, comfyui_filename,
                 subfolder, storage_type, resource_uri, metadata_json, created_at
          FROM assets
          WHERE job_id = ?
          ORDER BY created_at ASC, asset_id ASC
        `
      )
      .all(jobId)
      .map(rowToRecord);
  }
}

function rowToRecord(row: AssetRow): AssetRecord {
  const metadata = JSON.parse(row.metadata_json) as unknown;
  return {
    assetId: row.asset_id,
    jobId: row.job_id,
    promptId: row.prompt_id ?? undefined,
    nodeId: row.node_id,
    kind: row.kind,
    mimeType: row.mime_type ?? undefined,
    comfyuiFilename: row.comfyui_filename ?? undefined,
    subfolder: row.subfolder ?? undefined,
    storageType: row.storage_type ?? undefined,
    resourceUri: row.resource_uri,
    metadata:
      typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {},
    createdAt: row.created_at
  };
}
