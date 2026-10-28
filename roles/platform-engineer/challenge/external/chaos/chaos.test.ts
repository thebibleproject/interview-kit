import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { createExternal, TransientError } from "../index.ts";
import { useFixture } from "../testing/fixture.ts";

const { dir, video, instantExternal } = await useFixture();

test("config can be changed at runtime to force failures", async () => {
  const external = instantExternal();
  external.config.failureRate = 1;
  await assert.rejects(external.media.getMetadata(video), TransientError);
  external.config.failureRate = 0;
  await external.media.getMetadata(video);
});

test("calls can be aborted", async () => {
  const external = createExternal({
    latencyScale: 1,
    dataDir: join(dir, "stores"),
  });
  await assert.rejects(
    external.transcriber.transcribe(video, { signal: AbortSignal.timeout(10) }),
    { name: "AbortError" },
  );
});

test("calls can hang until aborted", async () => {
  const { stores } = instantExternal({ hangRate: 1 });
  await assert.rejects(
    stores.primary.head("missing", { signal: AbortSignal.timeout(20) }),
    {
      name: "AbortError",
    },
  );
});

test("the same seed repeats the same outcomes for sequential calls", async () => {
  const run = async () => {
    const external = instantExternal({ failureRate: 0.5, seed: 7 });
    const outcomes = [];
    for (let i = 0; i < 20; i++) {
      outcomes.push(
        await external.media.getMetadata(video).then(
          () => "ok",
          (err: unknown) => (err instanceof Error ? err.name : String(err)),
        ),
      );
    }
    external.config.failureRate = 0;
    outcomes.push((await external.transcriber.transcribe(video)).text);
    return outcomes;
  };
  const first = await run();
  assert.ok(
    first.includes("ok") && first.includes("TransientError"),
    "the seed mixes outcomes",
  );
  assert.deepEqual(await run(), first);
});
