import { stat } from "node:fs/promises";

import { PermanentError } from "./errors.ts";

import type { ServiceName } from "./errors.ts";

const MIN_VIDEO_BYTES = 1024;
const BYTES_PER_SECOND = 250_000; // pretend every video is ~2 Mbps

/**
 * The external services never read file contents. A "video" is any file of at
 * least 1 KB, and its duration is derived from its size.
 */
export async function inspectVideo(service: ServiceName, filePath: string) {
  const info = await stat(filePath).catch((cause: unknown) => {
    throw new PermanentError(`cannot read ${filePath}`, { service, cause });
  });
  if (!info.isFile() || info.size < MIN_VIDEO_BYTES) {
    throw new PermanentError(`${filePath} is not a recognizable video`, {
      service,
    });
  }
  return {
    sizeBytes: info.size,
    durationSec: Math.max(1, Math.round(info.size / BYTES_PER_SECOND)),
  };
}
