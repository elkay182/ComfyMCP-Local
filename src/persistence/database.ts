import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations/index.js";

export type DatabaseHandle = {
  path: string;
  db: Database.Database;
  close(): void;
};

export const DEFAULT_DATABASE_FILENAME = "comfymcp.sqlite";

export function databasePathForStateDir(stateDir: string): string {
  return path.join(stateDir, DEFAULT_DATABASE_FILENAME);
}

export function openDatabase(databasePath: string): DatabaseHandle {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  }

  const db = new Database(databasePath);
  configureDatabase(db, databasePath);
  migrateDatabase(db);

  if (databasePath !== ":memory:") {
    fs.chmodSync(databasePath, 0o600);
  }

  return {
    path: databasePath,
    db,
    close: () => {
      db.close();
    }
  };
}

export function configureDatabase(db: Database.Database, databasePath: string): void {
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  if (databasePath !== ":memory:") {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
}

export function migrateDatabase(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const appliedRows = db
    .prepare<[], { version: number }>("SELECT version FROM schema_migrations")
    .all();
  const applied = new Set(appliedRows.map((row) => row.version));

  const runMigration = db.transaction(() => {
    const insert = db.prepare<[number, string, string]>(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
    );

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) {
        continue;
      }
      db.exec(migration.sql);
      insert.run(migration.version, migration.name, new Date().toISOString());
    }
  });

  runMigration();
}
