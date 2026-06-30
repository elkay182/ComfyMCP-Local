export const RESOURCE_TEMPLATES = [
  "comfymcp://system/capabilities",
  "comfymcp://workflows/{workflow_id}",
  "comfymcp://jobs/{job_id}",
  "comfymcp://assets/{asset_id}",
  "comfymcp://assets/{asset_id}/chunks/{index}",
  "comfymcp://models/{model_type}/{model_id}",
  "comfymcp://nodes/{class_type}"
] as const;
