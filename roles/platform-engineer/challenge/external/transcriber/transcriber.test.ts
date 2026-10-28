import assert from "node:assert/strict";
import { test } from "node:test";

import { RateLimitError } from "../index.ts";
import { useFixture } from "../testing/fixture.ts";

const { video, instantExternal } = await useFixture();

test("transcriber returns segments and rate limits", async () => {
  const { transcriber } = instantExternal();
  const transcript = await transcriber.transcribe(video);
  assert.equal(transcript.segments.length, 8);

  const calls = [1, 2, 3].map(() => transcriber.transcribe(video));
  const results = await Promise.allSettled(calls);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  assert.ok(
    results.some(
      (r) => r.status === "rejected" && r.reason instanceof RateLimitError,
    ),
  );
});

test("a rate-limited call says how long to wait", async () => {
  const { transcriber } = instantExternal({ latencyScale: 0.01 });
  const results = await Promise.allSettled(
    [1, 2, 3].map(() => transcriber.transcribe(video)),
  );
  const limited = results.find((r) => r.status === "rejected");
  assert.ok(limited?.reason instanceof RateLimitError);
  assert.equal(limited.reason.service, "transcriber");
  assert.equal(limited.reason.retryable, true);
  assert.ok(limited.reason.retryAfterMs > 0);
});
