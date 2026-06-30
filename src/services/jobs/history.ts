import type { AssetRecord, AssetRepository } from "../../persistence/repositories/asset-repository.js";

export type PromptHistoryState = "pending" | "succeeded" | "failed";

export type PromptHistoryAnalysis = {
  state: PromptHistoryState;
  error?: Record<string, unknown>;
};

export function analyzePromptHistory(
  history: Record<string, unknown>,
  promptId: string
): PromptHistoryAnalysis {
  const promptHistory = recordAt(history, promptId);
  if (Object.keys(promptHistory).length === 0) {
    return { state: "pending" };
  }

  const status = recordAt(promptHistory, "status");
  const completed = status.completed;
  const statusText = stringAt(status, "status_str") ?? stringAt(status, "status");
  const outputs = recordAt(promptHistory, "outputs");

  if (completed === false || stringContainsError(statusText) || stringContainsLost(statusText) || arrayAt(status, "messages").some((message) => messageContainsError(message))) {
    const lost = stringContainsLost(statusText);
    return {
      state: "failed",
      error: {
        code: lost ? "LOST" : "INTERNAL",
        message: historyErrorMessage(promptHistory, "Workflow execution failed"),
        details: {
          status
        }
      }
    };
  }

  if (completed === true || Object.keys(outputs).length > 0) {
    return { state: "succeeded" };
  }

  return { state: "pending" };
}

export function registerAssetsFromHistory(
  assets: AssetRepository,
  input: { jobId: string; promptId: string; history: Record<string, unknown> }
): AssetRecord[] {
  const promptHistory = recordAt(input.history, input.promptId);
  const outputs = recordAt(promptHistory, "outputs");
  const existingKeys = new Set(assets.listByJobId(input.jobId).map(assetKey));

  for (const [nodeId, output] of Object.entries(outputs)) {
    const outputRecord = asRecord(output);
    for (const image of arrayAt(outputRecord, "images")) {
      const imageRecord = asRecord(image);
      const candidate = {
        nodeId,
        kind: "image",
        filename: stringAt(imageRecord, "filename"),
        subfolder: stringAt(imageRecord, "subfolder"),
        storageType: stringAt(imageRecord, "type")
      };
      const key = outputKey(candidate);
      if (existingKeys.has(key)) {
        continue;
      }
      const asset = assets.create({
        jobId: input.jobId,
        promptId: input.promptId,
        nodeId,
        kind: candidate.kind,
        mimeType: "image/png",
        comfyuiFilename: candidate.filename,
        subfolder: candidate.subfolder,
        storageType: candidate.storageType,
        metadata: imageRecord
      });
      existingKeys.add(assetKey(asset));
    }
  }

  return assets.listByJobId(input.jobId);
}

function historyErrorMessage(promptHistory: Record<string, unknown>, fallback: string): string {
  const status = recordAt(promptHistory, "status");
  for (const message of arrayAt(status, "messages")) {
    const extracted = errorMessageFromMessage(message);
    if (extracted) {
      return extracted;
    }
  }
  const promptError = promptHistory.error;
  if (typeof promptError === "string") {
    return promptError;
  }
  const errorRecord = asRecord(promptError);
  return stringAt(errorRecord, "message") ?? stringAt(errorRecord, "exception_message") ?? fallback;
}

function messageContainsError(message: unknown): boolean {
  if (!Array.isArray(message)) {
    return false;
  }
  return message.some((entry) => {
    if (typeof entry === "string") {
      return stringContainsError(entry);
    }
    const record = asRecord(entry);
    return Boolean(
      stringAt(record, "exception_message") ||
        stringAt(record, "message") ||
        stringContainsError(stringAt(record, "type"))
    );
  });
}

function errorMessageFromMessage(message: unknown): string | undefined {
  if (!Array.isArray(message)) {
    return undefined;
  }
  for (const entry of message) {
    const record = asRecord(entry);
    const messageText = stringAt(record, "exception_message") ?? stringAt(record, "message");
    if (messageText) {
      return messageText;
    }
  }
  return undefined;
}

function stringContainsError(value: string | undefined): boolean {
  return value ? value.toLowerCase().includes("error") || value.toLowerCase().includes("failed") : false;
}

function stringContainsLost(value: string | undefined): boolean {
  return value ? value.toLowerCase().includes("lost") || value.toLowerCase().includes("timeout") : false;
}

function assetKey(asset: AssetRecord): string {
  return outputKey({
    nodeId: asset.nodeId,
    kind: asset.kind,
    filename: asset.comfyuiFilename,
    subfolder: asset.subfolder,
    storageType: asset.storageType
  });
}

function outputKey(input: {
  nodeId: string;
  kind: string;
  filename?: string;
  subfolder?: string;
  storageType?: string;
}): string {
  return [
    input.nodeId,
    input.kind,
    input.filename ?? "",
    input.subfolder ?? "",
    input.storageType ?? ""
  ].join("\u001f");
}

function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return asRecord(record[key]);
}

function arrayAt(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function stringAt(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
