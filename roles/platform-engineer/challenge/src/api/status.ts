import { loadVideo, parseTask, text } from "../db.ts";
import { assetName, objectKey, taskKey } from "../domain.ts";
import { assetsFor, tasksFor } from "./plan.ts";

import type { DatabaseSync } from "node:sqlite";
import type { Row } from "../db.ts";
import type {
  Asset,
  Language,
  Metadata,
  StoreName,
  Task,
  TaskState,
} from "../domain.ts";

export type SubmissionState = "processing" | "succeeded" | "failed";

export type StoreStatus = {
  state: TaskState;
  attempts: number;
  lastError?: string;
  url?: string;
};

export type SubmissionStatus = {
  id: string;
  videoId: string;
  state: SubmissionState;
  languages: Language[];
  createdAt: string;
  video: { path: string; metadata: Metadata | null };
  assets: {
    name: string;
    key: string;
    stores: Record<StoreName, StoreStatus>;
  }[];
  /** Assets not yet delivered to archive. */
  missing: { archive: string[] };
  errors: { task: string; error: string | null }[];
};

/** Archive is best-effort: an upload there never fails a submission or holds one up. */
function deriveState(scope: Task[]): SubmissionState {
  const required = scope.filter(
    ({ action }) => !(action.type === "upload" && action.store === "archive"),
  );
  if (required.some((task) => task.state === "failed")) return "failed";
  if (required.every((task) => task.state === "done")) return "succeeded";
  return "processing";
}

/** A submission's status, derived from its video's tasks. Null if there is no such submission. */
export function submissionStatus(
  db: DatabaseSync,
  id: string,
): SubmissionStatus | null {
  const submission = db
    .prepare("SELECT video_id, created_at FROM submissions WHERE id = ?")
    .get(id);
  if (submission === undefined) return null;
  const video = loadVideo(db, text(submission, "video_id"));
  if (video === null) return null;
  const languages = db
    .prepare(
      "SELECT language FROM submission_languages WHERE submission_id = ? ORDER BY language",
    )
    .all(id)
    .map((row: Row) => text(row, "language") as Language);

  const tasks = new Map(
    db
      .prepare("SELECT * FROM tasks WHERE video_id = ?")
      .all(video.id)
      .map(parseTask)
      .map((task) => [task.key, task] as const),
  );
  const taskAt = (key: string): Task => {
    const task = tasks.get(key);
    if (task === undefined)
      throw new Error(`video ${video.id} has no task ${key}`);
    return task;
  };
  const uploadTo = (store: StoreName, asset: Asset) =>
    storeStatus(taskAt(taskKey({ type: "upload", asset, store })));
  // The tasks for this submission's languages are exactly its scope.
  const scope = tasksFor(languages).map((action) => taskAt(taskKey(action)));

  const assets = assetsFor(languages).map((asset) => ({
    name: assetName(asset, video.path),
    key: objectKey(video, asset),
    stores: {
      primary: uploadTo("primary", asset),
      cdn: uploadTo("cdn", asset),
      archive: uploadTo("archive", asset),
    },
  }));

  return {
    id,
    videoId: video.id,
    state: deriveState(scope),
    languages,
    createdAt: text(submission, "created_at"),
    video: { path: video.path, metadata: video.metadata },
    assets,
    missing: {
      archive: assets
        .filter((asset) => asset.stores.archive.state !== "done")
        .map((asset) => asset.name),
    },
    errors: scope
      .filter((task) => task.state === "failed")
      .map((task) => ({ task: task.key, error: task.lastError })),
  };
}

function storeStatus(task: Task): StoreStatus {
  return {
    state: task.state,
    attempts: task.attempts,
    ...(task.lastError !== null && { lastError: task.lastError }),
    ...(task.result !== null && { url: task.result.url }),
  };
}
