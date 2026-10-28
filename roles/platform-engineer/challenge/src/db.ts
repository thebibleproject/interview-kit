import { DatabaseSync } from "node:sqlite";

import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import type {
  Metadata,
  Task,
  TaskAction,
  TaskState,
  UploadResult,
  Video,
  VideoId,
} from "./domain.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (path, size_bytes, mtime_ms)
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos (id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submission_languages (
  submission_id TEXT NOT NULL REFERENCES submissions (id),
  language TEXT NOT NULL,
  PRIMARY KEY (submission_id, language)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos (id),
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  action TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER NOT NULL,
  last_error TEXT,
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (video_id, key)
);
CREATE INDEX IF NOT EXISTS tasks_runnable ON tasks (type, state, next_run_at);

CREATE TABLE IF NOT EXISTS captures (
  video_id TEXT NOT NULL REFERENCES videos (id),
  idx INTEGER NOT NULL,
  at_sec REAL NOT NULL,
  content_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (video_id, idx)
);

CREATE TABLE IF NOT EXISTS transcripts (
  video_id TEXT NOT NULL REFERENCES videos (id),
  language TEXT NOT NULL,
  duration_sec REAL NOT NULL,
  text TEXT NOT NULL,
  segments TEXT NOT NULL,
  PRIMARY KEY (video_id, language)
);
`;

export type Row = Record<string, SQLOutputValue>;

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
  );
  db.exec(SCHEMA);
  return db;
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export const isoNow = () => new Date().toISOString();

/** The single row a statement must return. */
export function one(
  db: DatabaseSync,
  sql: string,
  ...params: SQLInputValue[]
): Row {
  const row = db.prepare(sql).get(...params);
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row;
}

export function loadVideo(db: DatabaseSync, id: string): Video | null {
  const row = db
    .prepare("SELECT id, path, size_bytes, metadata FROM videos WHERE id = ?")
    .get(id);
  if (row === undefined) return null;
  const metadata = nullableText(row, "metadata");
  return {
    id: text(row, "id") as VideoId,
    path: text(row, "path"),
    sizeBytes: num(row, "size_bytes"),
    metadata: metadata === null ? null : (JSON.parse(metadata) as Metadata),
  };
}

export function parseTask(row: Row): Task {
  const result = nullableText(row, "result");
  return {
    id: num(row, "id"),
    videoId: text(row, "video_id") as VideoId,
    key: text(row, "key"),
    action: JSON.parse(text(row, "action")) as TaskAction,
    state: text(row, "state") as TaskState,
    attempts: num(row, "attempts"),
    lastError: nullableText(row, "last_error"),
    result: result === null ? null : (JSON.parse(result) as UploadResult),
  };
}

export function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value === "string") return value;
  throw new TypeError(`${column}: expected text, got ${typeof value}`);
}

export function nullableText(row: Row, column: string): string | null {
  return row[column] === null ? null : text(row, column);
}

export function num(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === "number") return value;
  throw new TypeError(`${column}: expected a number, got ${typeof value}`);
}

export function bytes(row: Row, column: string): Uint8Array {
  const value = row[column];
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`${column}: expected a blob, got ${typeof value}`);
}
