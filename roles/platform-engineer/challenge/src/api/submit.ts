import { isoNow, one, text, transaction } from "../db.ts";
import { newSubmissionId, newVideoId, taskKey } from "../domain.ts";
import { tasksFor } from "./plan.ts";

import type { DatabaseSync } from "node:sqlite";
import type { Language, SubmissionId, VideoId } from "../domain.ts";

/** A video is a file: the same path, size, and mtime is the same video. */
export type Submission = {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  languages: Language[];
};

export type Accepted = {
  submissionId: SubmissionId;
  videoId: VideoId;
  newTasks: number;
};

/** Records the submission and adds whatever tasks its video does not already have. */
export function submit(
  db: DatabaseSync,
  { path, sizeBytes, mtimeMs, languages }: Submission,
): Accepted {
  return transaction(db, () => {
    const createdAt = isoNow();
    const video = one(
      db,
      // The no-op update makes RETURNING yield the existing row on a conflict.
      `INSERT INTO videos (id, path, size_bytes, mtime_ms, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (path, size_bytes, mtime_ms) DO UPDATE SET path = excluded.path
       RETURNING id`,
      newVideoId(),
      path,
      sizeBytes,
      mtimeMs,
      createdAt,
    );
    const videoId = text(video, "id") as VideoId;

    const submissionId = newSubmissionId();
    db.prepare(
      "INSERT INTO submissions (id, video_id, created_at) VALUES (?, ?, ?)",
    ).run(submissionId, videoId, createdAt);
    const addLanguage = db.prepare(
      "INSERT INTO submission_languages (submission_id, language) VALUES (?, ?)",
    );
    for (const language of languages) addLanguage.run(submissionId, language);

    const addTask = db.prepare(
      `INSERT OR IGNORE INTO tasks (video_id, key, type, action, state, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    );
    let newTasks = 0;
    for (const action of tasksFor(languages)) {
      const added = addTask.run(
        videoId,
        taskKey(action),
        action.type,
        JSON.stringify(action),
        Date.now(),
        createdAt,
        createdAt,
      );
      newTasks += Number(added.changes);
    }
    return { submissionId, videoId, newTasks };
  });
}
