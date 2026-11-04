import { resolve } from "node:path";

import { bytes, num, text } from "../db.ts";
import { CAPTURE_COUNT, objectKey } from "../domain.ts";

import type { DatabaseSync } from "node:sqlite";
import type {
  Media,
  ObjectStore,
  Transcriber,
  UploadSource,
} from "../../external/index.ts";
import type {
  Asset,
  Language,
  Metadata,
  StoreName,
  TaskAction,
  TaskType,
  UploadResult,
  Video,
} from "../domain.ts";

export type Services = {
  media: Media;
  transcriber: Transcriber;
  stores: Record<StoreName, ObjectStore>;
};

type Frame = Awaited<ReturnType<Media["captureFrame"]>>;
type Transcript = Awaited<ReturnType<Transcriber["transcribe"]>>;

/** What a task produced. `record` writes it in the transaction that marks the task done. */
export type Output =
  | { type: "getMetadata"; metadata: Metadata }
  | { type: "captureFrame"; index: number; frame: Frame }
  | { type: "transcribe"; language: Language; transcript: Transcript }
  | { type: "upload"; result: UploadResult };

const MB = 1_000_000;

/** Running tasks of each type at once. Transcribe is 2 because the transcriber rejects a third concurrent call. */
export const CONCURRENCY = {
  getMetadata: 4,
  captureFrame: 4,
  transcribe: 2,
  upload: 6,
} as const satisfies Record<TaskType, number>;

/** Archive is best-effort, so its uploads retry forever with capped backoff. */
export function maxAttempts(action: TaskAction): number {
  if (action.type !== "upload") return 5;
  return action.store === "archive" ? Infinity : 8;
}

export function timeoutMs(action: TaskAction, video: Video): number {
  switch (action.type) {
    case "getMetadata":
      return 10_000;
    case "captureFrame":
      return 15_000;
    case "transcribe":
      return 30_000 + 200 * metadataOf(video).durationSec;
    case "upload":
      return (
        30_000 +
        (action.asset.type === "original" ? (1000 * video.sizeBytes) / MB : 0)
      );
  }
}

export async function perform(
  action: TaskAction,
  {
    video,
    videosDir,
    db,
    services,
    signal,
  }: {
    video: Video;
    videosDir: string;
    db: DatabaseSync;
    services: Services;
    signal: AbortSignal;
  },
): Promise<Output> {
  const filePath = resolve(videosDir, video.path);
  switch (action.type) {
    case "getMetadata":
      return {
        type: "getMetadata",
        metadata: await services.media.getMetadata(filePath, { signal }),
      };
    case "captureFrame": {
      const atSec =
        (metadataOf(video).durationSec * (action.index - 0.5)) / CAPTURE_COUNT;
      const frame = await services.media.captureFrame(filePath, atSec, {
        signal,
      });
      return { type: "captureFrame", index: action.index, frame };
    }
    case "transcribe": {
      const transcript = await services.transcriber.transcribe(filePath, {
        language: action.language,
        signal,
      });
      return { type: "transcribe", language: action.language, transcript };
    }
    case "upload": {
      const stored = await services.stores[action.store].upload(
        {
          key: objectKey(video, action.asset),
          source: uploadSource(db, video, filePath, action.asset),
        },
        { signal },
      );
      return {
        type: "upload",
        result: { url: stored.url, sizeBytes: stored.sizeBytes },
      };
    }
  }
}

export function record(
  db: DatabaseSync,
  taskId: number,
  video: Video,
  output: Output,
): void {
  switch (output.type) {
    case "getMetadata":
      db.prepare("UPDATE videos SET metadata = ? WHERE id = ?").run(
        JSON.stringify(output.metadata),
        video.id,
      );
      return;
    case "captureFrame": {
      const { frame } = output;
      db.prepare(
        `INSERT OR REPLACE INTO captures (video_id, idx, at_sec, content_type, width, height, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        video.id,
        output.index,
        frame.atSec,
        frame.contentType,
        frame.width,
        frame.height,
        frame.data,
      );
      return;
    }
    case "transcribe": {
      const { transcript } = output;
      db.prepare(
        `INSERT OR REPLACE INTO transcripts (video_id, language, duration_sec, text, segments)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        video.id,
        output.language,
        transcript.durationSec,
        transcript.text,
        JSON.stringify(transcript.segments),
      );
      return;
    }
    case "upload":
      db.prepare("UPDATE tasks SET result = ? WHERE id = ?").run(
        JSON.stringify(output.result),
        taskId,
      );
      return;
  }
}

/** Dependencies guarantee getMetadata ran before any task that reads its output. */
function metadataOf(video: Video): Metadata {
  if (video.metadata === null)
    throw new Error(`video ${video.id} has no metadata yet`);
  return video.metadata;
}

/** Produced assets come from the database, so an upload retry never produces them again. */
function uploadSource(
  db: DatabaseSync,
  video: Video,
  filePath: string,
  asset: Asset,
): UploadSource {
  switch (asset.type) {
    case "original":
      return { kind: "file", filePath };
    case "capture": {
      const row = db
        .prepare("SELECT data FROM captures WHERE video_id = ? AND idx = ?")
        .get(video.id, asset.index);
      if (row === undefined)
        throw new Error(`capture ${asset.index} of ${video.id} is missing`);
      return { kind: "data", data: Buffer.from(bytes(row, "data")) };
    }
    case "transcript": {
      const row = db
        .prepare(
          "SELECT duration_sec, text, segments FROM transcripts WHERE video_id = ? AND language = ?",
        )
        .get(video.id, asset.language);
      if (row === undefined)
        throw new Error(
          `transcript ${asset.language} of ${video.id} is missing`,
        );
      const transcript = {
        language: asset.language,
        durationSec: num(row, "duration_sec"),
        text: text(row, "text"),
        segments: JSON.parse(text(row, "segments")) as unknown,
      };
      return { kind: "data", data: JSON.stringify(transcript) };
    }
  }
}
