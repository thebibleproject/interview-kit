import { resolve } from "node:path";

import type { ChaosConfig } from "../chaos/chaos.ts";

export type ExternalOptions = Partial<ChaosConfig> & {
  /** Makes the sequence of failures reproducible. */
  seed?: number;
  /** Where stores write objects. */
  dataDir?: string;
};

type Setting = {
  env: string;
  expected: string;
  isValid: (value: number) => boolean;
};

const rate = (env: string): Setting => ({
  env,
  expected: "a number from 0 to 1",
  isValid: (value) => value >= 0 && value <= 1,
});

const SETTINGS = {
  failureRate: rate("EXTERNAL_FAILURE_RATE"),
  slowRate: rate("EXTERNAL_SLOW_RATE"),
  hangRate: rate("EXTERNAL_HANG_RATE"),
  latencyScale: {
    env: "EXTERNAL_LATENCY_SCALE",
    expected: "a number of at least 0",
    isValid: (value) => Number.isFinite(value) && value >= 0,
  },
  seed: {
    env: "EXTERNAL_SEED",
    expected: "an integer",
    isValid: Number.isInteger,
  },
} satisfies Record<keyof ChaosConfig | "seed", Setting>;

/** Option, then env var (blank means unset), then default. */
export function parseSettings(options: ExternalOptions) {
  const config: ChaosConfig = {
    failureRate: readSetting(options, "failureRate") ?? 0.1,
    slowRate: readSetting(options, "slowRate") ?? 0.05,
    hangRate: readSetting(options, "hangRate") ?? 0.01,
    latencyScale: readSetting(options, "latencyScale") ?? 1,
  };
  return {
    config,
    seed: readSetting(options, "seed"),
    dataDir:
      options.dataDir ??
      process.env.EXTERNAL_DATA_DIR ??
      resolve("data/stores"),
  };
}

function readSetting(options: ExternalOptions, name: keyof typeof SETTINGS) {
  const { env, expected, isValid } = SETTINGS[name];
  const option = options[name];
  if (option !== undefined) {
    if (isValid(option)) return option;
    throw new RangeError(`${name} must be ${expected}, got ${option}`);
  }
  const raw = process.env[env]?.trim();
  if (!raw) return undefined;
  if (isValid(Number(raw))) return Number(raw);
  throw new RangeError(
    `${env} must be ${expected}, got ${JSON.stringify(raw)}`,
  );
}
