import { RateLimitError, TransientError } from "../shared/errors.ts";
import { inspectVideo } from "../shared/video.ts";

import type { Chaos } from "../chaos/chaos.ts";

const SERVICE = "transcriber";
const SEGMENT_SEC = 5;
const LINES = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse.",
  "Excepteur sint occaecat cupidatat non proident.",
  "Sunt in culpa qui officia deserunt mollit anim id est laborum.",
];

export type TranscriberProfile = {
  /** Latency of every call. */
  baseMs: number;
  /** Latency added per second of video. */
  msPerVideoSec: number;
  /** Calls allowed at once before RateLimitError. */
  maxConcurrent: number;
  /** `retryAfterMs` on a RateLimitError, scaled by `latencyScale`. */
  retryAfterMs: number;
};

/** Stand-in for a third-party speech-to-text API. */
export class Transcriber {
  readonly #chaos: Chaos;
  readonly #profile: TranscriberProfile;
  #active = 0;

  constructor({
    profile,
    chaos,
  }: {
    profile: TranscriberProfile;
    chaos: Chaos;
  }) {
    this.#profile = profile;
    this.#chaos = chaos;
  }

  /**
   * Produces a transcript. Slow (scales with video duration) and allows at
   * most `maxConcurrent` calls at once; extra calls are rejected with
   * RateLimitError.
   */
  async transcribe(
    filePath: string,
    {
      language = "en",
      signal,
    }: { language?: string; signal?: AbortSignal } = {},
  ) {
    if (this.#active >= this.#profile.maxConcurrent) {
      throw new RateLimitError(
        `more than ${this.#profile.maxConcurrent} concurrent requests`,
        {
          service: SERVICE,
          retryAfterMs: this.#profile.retryAfterMs * this.#chaos.latencyScale,
        },
      );
    }
    this.#active++;
    try {
      const { durationSec } = await inspectVideo(SERVICE, filePath);
      await this.#chaos.delay(
        this.#profile.baseMs + durationSec * this.#profile.msPerVideoSec,
        signal,
      );
      if (this.#chaos.fails()) {
        throw new TransientError("internal server error", { service: SERVICE });
      }

      const segments = [];
      for (let start = 0; start < durationSec; start += SEGMENT_SEC) {
        segments.push({
          startSec: start,
          endSec: Math.min(start + SEGMENT_SEC, durationSec),
          text: LINES[Math.floor(this.#chaos.random() * LINES.length)],
        });
      }
      return {
        language,
        durationSec,
        text: segments.map((s) => s.text).join(" "),
        segments,
      };
    } finally {
      this.#active--;
    }
  }
}
