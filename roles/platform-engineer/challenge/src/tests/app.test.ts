import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { createVideo, startService, useTempDir } from "./test-harness.ts";

const dir = await useTempDir();

test("POST /videos rejects what it cannot process", async (t) => {
  const service = await startService(dir);
  t.after(() => service.close());
  const video = await createVideo(dir, "valid.mp4");

  const invalid: [string, unknown][] = [
    ["a relative path", { path: "valid.mp4", languages: ["en"] }],
    ["a missing file", { path: join(dir, "missing.mp4"), languages: ["en"] }],
    ["a directory", { path: dir, languages: ["en"] }],
    ["no languages", { path: video }],
    ["empty languages", { path: video, languages: [] }],
    ["an invalid language", { path: video, languages: ["en", "English"] }],
    ["malformed JSON", '{"path":'],
  ];
  for (const [label, body] of invalid) {
    const res = await service.post("/videos", body);
    assert.equal(res.status, 400, `400 for ${label}`);
    const { error } = (await res.json()) as { error: unknown };
    assert.equal(typeof error, "string", `an error message for ${label}`);
  }
});

test("repeated languages count once", async (t) => {
  const service = await startService(dir);
  t.after(() => service.close());
  const video = await createVideo(dir, "deduped.mp4");

  const { submissionId } = await service.submit(video, ["en", "en"]);
  assert.deepEqual((await service.status(submissionId)).languages, ["en"]);
});

test("unknown ids are 404", async (t) => {
  const service = await startService(dir);
  t.after(() => service.close());

  assert.equal(
    (await service.get("/submissions/nope")).status,
    404,
    "unknown submission",
  );
  assert.equal(
    (await service.post("/videos/nope/retry")).status,
    404,
    "unknown video retry",
  );
});

test("a file that is not a video fails with the getMetadata error", async (t) => {
  const service = await startService(dir);
  t.after(() => service.close());
  const video = await createVideo(dir, "tiny.mp4", 100);

  const { submissionId } = await service.submit(video, ["en"]);
  const status = await service.waitForState(submissionId, "failed");
  assert.equal(status.video.metadata, null);
  assert.equal(status.errors.length, 1);
  assert.equal(status.errors[0].task, "getMetadata");
  assert.match(String(status.errors[0].error), /is not a recognizable video/);
});
