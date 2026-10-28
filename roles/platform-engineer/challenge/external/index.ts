import { Chaos } from "./chaos/chaos.ts";
import { Media } from "./media/media.ts";
import { parseSettings } from "./settings/settings.ts";
import { ObjectStore } from "./stores/stores.ts";
import { Transcriber } from "./transcriber/transcriber.ts";

import type { MediaProfile } from "./media/media.ts";
import type { ExternalOptions } from "./settings/settings.ts";
import type { StoreProfile } from "./stores/stores.ts";
import type { TranscriberProfile } from "./transcriber/transcriber.ts";

export * from "./shared/errors.ts";
export type { ChaosConfig } from "./chaos/chaos.ts";
export type { Media } from "./media/media.ts";
export type {
  ObjectStore,
  StoredObject,
  StoreName,
  UploadSource,
} from "./stores/stores.ts";
export type { ExternalOptions } from "./settings/settings.ts";
export type { Transcriber } from "./transcriber/transcriber.ts";

export type External = ReturnType<typeof createExternal>;

/** How fast and reliable a store is. Faster tiers fail less often. */
export type StoreTier = "fast" | "medium" | "slow";

const STORE_TIERS = {
  fast: { baseMs: 200, msPerMb: 5, failureMultiplier: 0.5 },
  medium: { baseMs: 500, msPerMb: 15, failureMultiplier: 1 },
  slow: { baseMs: 1500, msPerMb: 40, failureMultiplier: 2 },
} satisfies Record<StoreTier, StoreProfile>;

const MEDIA_PROFILE = {
  getMetadataMs: 200,
  captureFrameMs: 500,
} satisfies MediaProfile;

const TRANSCRIBER_PROFILE = {
  baseMs: 1000,
  msPerVideoSec: 10,
  maxConcurrent: 2,
  retryAfterMs: 1000,
} satisfies TranscriberProfile;

/** Creates the external services. Options default to the EXTERNAL_* env vars. */
export function createExternal(options: ExternalOptions = {}) {
  const { config, seed, dataDir } = parseSettings(options);
  const chaos = new Chaos({ config, seed });
  const opened = new Map<string, { tier: StoreTier; store: ObjectStore }>();

  /**
   * Returns the store called `name`, creating it on first use. Its objects
   * live under `<dataDir>/<name>/`. `name` must match `/^[a-z0-9][a-z0-9-]*$/`,
   * and reopening a name with a different tier throws.
   */
  const openStore = (
    name: string,
    { tier }: { tier: StoreTier },
  ): ObjectStore => {
    const existing = opened.get(name);
    if (existing) {
      if (existing.tier !== tier) {
        throw new Error(
          `store ${name} is already open with tier ${existing.tier}, not ${tier}`,
        );
      }
      return existing.store;
    }
    const store = new ObjectStore({
      name,
      profile: STORE_TIERS[tier],
      chaos,
      rootDir: dataDir,
    });
    opened.set(name, { tier, store });
    return store;
  };

  return {
    /** Live config: changes take effect on the next call. Handy in tests. */
    config,
    media: new Media({ profile: MEDIA_PROFILE, chaos }),
    transcriber: new Transcriber({ profile: TRANSCRIBER_PROFILE, chaos }),
    stores: {
      primary: openStore("primary", { tier: "fast" }),
      cdn: openStore("cdn", { tier: "medium" }),
      archive: openStore("archive", { tier: "slow" }),
    },
    openStore,
  };
}
