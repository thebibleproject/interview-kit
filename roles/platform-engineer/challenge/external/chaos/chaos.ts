import { setTimeout as sleep } from "node:timers/promises";

export type ChaosConfig = {
  /** Chance a call fails transiently. */
  failureRate: number;
  /** Chance a call takes 10x longer. */
  slowRate: number;
  /** Chance a call hangs until aborted. */
  hangRate: number;
  /** Multiplier on all latency; 0 = instant. */
  latencyScale: number;
};

/** Shared source of latency and failures. Reads `config` on every call, so changes to it take effect immediately. */
export class Chaos {
  readonly #config: ChaosConfig;
  readonly #random: () => number;

  constructor({ config, seed }: { config: ChaosConfig; seed?: number }) {
    this.#config = config;
    this.#random = seed === undefined ? Math.random : mulberry32(seed);
  }

  random(): number {
    return this.#random();
  }

  get latencyScale(): number {
    return this.#config.latencyScale;
  }

  /** Waits roughly `baseMs` (jittered, occasionally 10x slower, occasionally hangs until `signal` aborts). */
  async delay(baseMs: number, signal: AbortSignal | undefined): Promise<void> {
    // A ref'd timer keeps the process alive like a stalled socket. Only an abort settles the call.
    if (this.#random() < this.#config.hangRate)
      await sleep(2 ** 31 - 1, undefined, { signal });
    let ms = baseMs * (0.5 + this.#random()) * this.#config.latencyScale;
    if (this.#random() < this.#config.slowRate) ms *= 10;
    await sleep(ms, undefined, { signal });
  }

  fails(multiplier = 1): boolean {
    return this.#random() < this.#config.failureRate * multiplier;
  }
}

/** Small seeded PRNG so runs can be reproduced. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
