import { basename } from "node:path";

import { PermanentError, TransientError } from "../shared/errors.ts";
import { inspectVideo } from "../shared/video.ts";

import type { Chaos } from "../chaos/chaos.ts";

const SERVICE = "media";

/** The base latency of each call. */
export type MediaProfile = { getMetadataMs: number; captureFrameMs: number };

/** Stand-in for ffprobe/ffmpeg. */
export class Media {
  readonly #chaos: Chaos;
  readonly #profile: MediaProfile;

  constructor({ profile, chaos }: { profile: MediaProfile; chaos: Chaos }) {
    this.#profile = profile;
    this.#chaos = chaos;
  }

  /** Reads technical metadata from a video file. */
  async getMetadata(
    filePath: string,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    const { sizeBytes, durationSec } = await inspectVideo(SERVICE, filePath);
    await this.#chaos.delay(this.#profile.getMetadataMs, signal);
    if (this.#chaos.fails())
      throw new TransientError("getMetadata crashed", { service: SERVICE });
    return {
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      width: 1920,
      height: 1080,
      durationSec,
      sizeBytes,
    };
  }

  /**
   * Extracts a single still frame as a JPEG.
   *
   * @param atSec must be within 0..durationSec (see `getMetadata`)
   */
  async captureFrame(
    filePath: string,
    atSec: number,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    const { durationSec } = await inspectVideo(SERVICE, filePath);
    if (!(atSec >= 0 && atSec <= durationSec)) {
      throw new PermanentError(`atSec ${atSec} is outside 0-${durationSec}s`, {
        service: SERVICE,
      });
    }
    await this.#chaos.delay(this.#profile.captureFrameMs, signal);
    if (this.#chaos.fails()) {
      throw new TransientError("frame extraction crashed", {
        service: SERVICE,
      });
    }
    return {
      contentType: "image/jpeg",
      width: 1280,
      height: 720,
      atSec,
      data: Buffer.from(`simulated jpeg: ${basename(filePath)} @ ${atSec}s\n`),
    };
  }
}
