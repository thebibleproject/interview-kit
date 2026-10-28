import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

import { createExternal } from "../index.ts";

import type { ExternalOptions, UploadSource } from "../index.ts";

export const tinyData: UploadSource = { kind: "data", data: "x" };

/** Creates a temp dir holding a 10 MB (40 s) video. The dir is removed after the calling file's tests. */
export async function useFixture() {
  const dir = await mkdtemp(join(tmpdir(), "external-test-"));
  after(() => rm(dir, { recursive: true, force: true }));
  const video = join(dir, "video.mp4");
  await writeFile(video, "");
  await truncate(video, 10_000_000);

  const instantExternal = (overrides: ExternalOptions = {}) =>
    createExternal({
      failureRate: 0,
      slowRate: 0,
      hangRate: 0,
      latencyScale: 0,
      dataDir: join(dir, "stores"),
      ...overrides,
    });

  return { dir, video, instantExternal };
}
