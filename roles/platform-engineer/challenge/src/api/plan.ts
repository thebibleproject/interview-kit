import { CAPTURE_COUNT } from "../domain.ts";

import type { Asset, Language, TaskAction } from "../domain.ts";

/** Every asset a submission for these languages uploads. */
export function assetsFor(languages: readonly Language[]): Asset[] {
  const assets: Asset[] = [{ type: "original" }];
  for (let index = 1; index <= CAPTURE_COUNT; index++)
    assets.push({ type: "capture", index });
  for (const language of languages)
    assets.push({ type: "transcript", language });
  return assets;
}

/** Every task a submission for these languages needs. Each asset goes to primary, cdn, and archive. */
export function tasksFor(languages: readonly Language[]): TaskAction[] {
  const tasks: TaskAction[] = [{ type: "getMetadata" }];
  for (let index = 1; index <= CAPTURE_COUNT; index++)
    tasks.push({ type: "captureFrame", index });
  for (const language of languages)
    tasks.push({ type: "transcribe", language });
  for (const asset of assetsFor(languages)) {
    tasks.push(
      { type: "upload", asset, store: "primary" },
      { type: "upload", asset, store: "cdn" },
      { type: "upload", asset, store: "archive" },
    );
  }
  return tasks;
}
