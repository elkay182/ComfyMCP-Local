export type Migration = {
  version: number;
  name: string;
  sql: string;
};

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial_persistence_schema",
    sql: `
      CREATE TABLE auth_tokens (
        token_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        label TEXT NOT NULL,
        secret_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        rotated_from_token_id TEXT REFERENCES auth_tokens(token_id),
        revoked_at TEXT
      );

      CREATE INDEX auth_tokens_actor_id_idx ON auth_tokens(actor_id);
      CREATE INDEX auth_tokens_revoked_at_idx ON auth_tokens(revoked_at);

      CREATE TABLE http_sessions (
        session_hash TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        token_id TEXT NOT NULL REFERENCES auth_tokens(token_id),
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        closed_at TEXT
      );

      CREATE INDEX http_sessions_actor_id_idx ON http_sessions(actor_id);
      CREATE INDEX http_sessions_expires_at_idx ON http_sessions(expires_at);

      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        actor_id TEXT,
        token_id_hash TEXT,
        transport TEXT NOT NULL,
        request_id TEXT,
        session_id_hash TEXT,
        action TEXT NOT NULL,
        plan_id TEXT,
        outcome TEXT NOT NULL,
        details_json TEXT NOT NULL CHECK (json_valid(details_json))
      );

      CREATE INDEX audit_events_occurred_at_idx ON audit_events(occurred_at);
      CREATE INDEX audit_events_actor_id_idx ON audit_events(actor_id);
      CREATE INDEX audit_events_action_idx ON audit_events(action);
    `
  },
  {
    version: 2,
    name: "jobs_and_assets",
    sql: `
      CREATE TABLE jobs (
        job_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        workflow_id TEXT,
        prompt_id TEXT,
        idempotency_key TEXT NOT NULL,
        request_json TEXT NOT NULL CHECK (json_valid(request_json)),
        result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
        error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX jobs_actor_id_idempotency_key_idx
        ON jobs(actor_id, idempotency_key);
      CREATE INDEX jobs_state_idx ON jobs(state);
      CREATE INDEX jobs_prompt_id_idx ON jobs(prompt_id);

      CREATE TABLE assets (
        asset_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(job_id),
        prompt_id TEXT,
        node_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        mime_type TEXT,
        comfyui_filename TEXT,
        subfolder TEXT,
        storage_type TEXT,
        resource_uri TEXT NOT NULL,
        metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
        created_at TEXT NOT NULL
      );

      CREATE INDEX assets_job_id_idx ON assets(job_id);
      CREATE INDEX assets_prompt_id_idx ON assets(prompt_id);
    `
  }
];
