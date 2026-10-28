import { randomUUID } from "node:crypto";
import { extname } from "node:path";

import type { Media } from "../external/index.ts";

export type VideoId = string & { readonly __brand: "VideoId" };
export type SubmissionId = string & { readonly __brand: "SubmissionId" };
export type Language = string & { readonly __brand: "Language" };

/** `primary` is ours. `cdn` and `archive` are GoodPeople's. */
export type StoreName = "primary" | "cdn" | "archive";

/** Captures are numbered from 1. */
export const CAPTURE_COUNT = 5;

const LANGUAGE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
const DEFAULT_VIDEO_EXT = ".mp4";

export type Asset =
  | { type: "original" }
  | { type: "capture"; index: number }
  | { type: "transcript"; language: Language };

export type TaskAction =
  | { type: "getMetadata" }
  | { type: "captureFrame"; index: number }
  | { type: "transcribe"; language: Language }
  | { type: "upload"; asset: Asset; store: StoreName };

export type TaskType = TaskAction["type"];
export type TaskState = "pending" | "running" | "done" | "failed";

export type Metadata = Awaited<ReturnType<Media["getMetadata"]>>;

export type Video = {
  id: VideoId;
  path: string;
  sizeBytes: number;
  metadata: Metadata | null;
};

export type UploadResult = { url: string; sizeBytes: number };

export type Task = {
  id: number;
  videoId: VideoId;
  key: string;
  action: TaskAction;
  state: TaskState;
  attempts: number;
  lastError: string | null;
  result: UploadResult | null;
};

export const newVideoId = () => randomUUID() as VideoId;
export const newSubmissionId = () => randomUUID() as SubmissionId;

export function parseLanguage(value: unknown): Language | null {
  return typeof value === "string" && LANGUAGE.test(value)
    ? (value as Language)
    : null;
}

/** Names an asset independently of the video's file extension. */
function assetSlug(asset: Asset): string {
  switch (asset.type) {
    case "original":
      return "original";
    case "capture":
      return `capture-${asset.index}`;
    case "transcript":
      return `transcript-${asset.language}`;
  }
}

export function assetName(asset: Asset, videoPath: string): string {
  switch (asset.type) {
    case "original":
      return `original${extname(videoPath) || DEFAULT_VIDEO_EXT}`;
    case "capture":
      return `${assetSlug(asset)}.jpg`;
    case "transcript":
      return `${assetSlug(asset)}.json`;
  }
}

export function objectKey(
  video: Pick<Video, "id" | "path">,
  asset: Asset,
): string {
  return `${video.id}/${assetName(asset, video.path)}`;
}

/** Unique per video. Stable across submissions, which is what lets a resubmission reuse finished work. */
export function taskKey(action: TaskAction): string {
  switch (action.type) {
    case "getMetadata":
      return "getMetadata";
    case "captureFrame":
      return `captureFrame:${action.index}`;
    case "transcribe":
      return `transcribe:${action.language}`;
    case "upload":
      return `upload:${assetSlug(action.asset)}@${action.store}`;
  }
}
