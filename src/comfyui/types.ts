export type ComfySystemStats = {
  system?: {
    os?: string;
    python_version?: string;
    embedded_python?: boolean;
  };
  devices?: Array<{
    name?: string;
    type?: string;
    vram_total?: number;
    vram_free?: number;
  }>;
};

export type ComfyObjectInfo = Record<
  string,
  {
    input?: Record<string, unknown>;
    output?: unknown[];
    output_name?: string[];
    category?: string;
    description?: string;
  }
>;

export type ComfyPromptResponse = {
  prompt_id: string;
  number?: number;
  node_errors?: Record<string, unknown>;
};

export type ComfyQueueResponse = {
  queue_running?: unknown[];
  queue_pending?: unknown[];
};

export type ComfyHistoryResponse = Record<string, unknown>;
