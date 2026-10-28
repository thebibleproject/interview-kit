import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  createVideo,
  hang,
  replace,
  startService,
  track,
  useTempDir,
  waitFor,
} from "./test-harness.ts";

const STORE_NAMES = ["primary", "cdn", "archive"] as const;

const dir = await useTempDir();

test("a submission delivers every asset to every store", async (t) => {
  const service = await startService(dir);
  t.after(() => service.close());
  const video = await createVideo(dir, "delivered.mp4");

  const { submissionId, videoId } = await service.submit(video, ["es", "en"]);
  // Archive doesn't hold up `succeeded`, so wait for it too.
  const status = await waitFor(
    "every store to have every asset",
    () => service.status(submissionId),
    (s) => s.state === "succeeded" && s.missing.archive.length === 0,
  );

  assert.deepEqual(status.languages, ["en", "es"]);
  assert.deepEqual(
    status.assets.map((asset) => asset.key),
    [
      "original.mp4",
      "capture-1.jpg",
      "capture-2.jpg",
      "capture-3.jpg",
      "capture-4.jpg",
      "capture-5.jpg",
      "transcript-en.json",
      "transcript-es.json",
    ].map((name) => `${videoId}/${name}`),
  );
  for (const asset of status.assets) {
    for (const store of STORE_NAMES) {
      assert.equal(
        asset.stores[store].state,
        "done",
        `${asset.name} reached ${store}`,
      );
      assert.equal(
        asset.stores[store].url,
        `external://${store}/${asset.key}`,
        `${asset.name} has its ${store} url`,
      );
      assert.notEqual(
        await service.external.stores[store].head(asset.key),
        null,
        `${store} holds ${asset.name}`,
      );
    }
  }
  assert.deepEqual(status.missing, { archive: [] });
  assert.equal(status.video.metadata?.durationSec, 4);

  const delivered = JSON.parse(
    await readFile(
      join(service.storesDir, "cdn", videoId, "transcript-es.json"),
      "utf8",
    ),
  );
  assert.equal(
    delivered.language,
    "es",
    "the delivered transcript is in the requested language",
  );
  assert.ok(
    delivered.segments.length > 0,
    "the delivered transcript has segments",
  );
  const stored = service.db
    .prepare(
      "SELECT language FROM transcripts WHERE video_id = ? ORDER BY language",
    )
    .all(videoId);
  assert.deepEqual(
    stored.map((row) => row.language),
    ["en", "es"],
    "transcripts are persisted",
  );
});

test("resubmitting a video with a new language does only the new work", async (t) => {
  const service = await startService(dir);
  t.after(() => service.close());
  const video = await createVideo(dir, "resubmitted.mp4");
  const first = await service.submit(video, ["en"]);
  await service.waitForState(first.submissionId, "succeeded");

  const transcribe = track(service.external.transcriber, "transcribe");
  const captureFrame = track(service.external.media, "captureFrame");
  const second = await service.submit(video, ["en", "fr"]);

  assert.equal(
    second.videoId,
    first.videoId,
    "the same file is the same video",
  );
  const status = await service.waitForState(second.submissionId, "succeeded");
  assert.equal(transcribe.calls, 1, "only the new language was transcribed");
  assert.equal(captureFrame.calls, 0, "captures were reused");
  assert.equal(
    status.assets.at(-1)?.stores.primary.state,
    "done",
    "the new transcript was delivered",
  );
  assert.equal(
    (await service.status(first.submissionId)).state,
    "succeeded",
    "the first submission still succeeds",
  );
});

test("a restarted worker resumes without redoing finished work", async (t) => {
  const service = await startService(dir);
  t.after(() => service.close());
  const video = await createVideo(dir, "restarted.mp4");
  const transcribe = track(service.external.transcriber, "transcribe");
  const captureFrame = track(service.external.media, "captureFrame");
  const restores = STORE_NAMES.map((store) =>
    replace(service.external.stores[store], "upload", (_request, options) =>
      hang(options?.signal),
    ),
  );

  const { submissionId } = await service.submit(video, ["en"]);
  await waitFor(
    "captures and transcript",
    async () => ({
      captures: captureFrame.resolved,
      transcripts: transcribe.resolved,
    }),
    (done) => done.captures === 5 && done.transcripts === 1,
  );
  await service.stopWorker();
  const stopped = await service.status(submissionId);
  assert.equal(stopped.state, "processing", "the worker stopped partway");
  assert.ok(
    stopped.assets.every((asset) =>
      STORE_NAMES.every(
        (store) =>
          asset.stores[store].state === "pending" &&
          asset.stores[store].attempts === 0,
      ),
    ),
    "cut-off uploads went back to pending without using an attempt",
  );
  for (const restore of restores) restore();
  service.startWorker();

  await service.waitForState(submissionId, "succeeded");
  assert.equal(captureFrame.calls, 5, "no capture ran twice");
  assert.equal(transcribe.calls, 1, "no transcription ran twice");
});

test("a hung call is timed out and retried", async (t) => {
  const service = await startService(dir, { worker: { timeoutScale: 0.01 } });
  t.after(() => service.close());
  const video = await createVideo(dir, "hung.mp4");
  const primary = service.external.stores.primary;
  const upload = primary.upload.bind(primary);
  let hung = false;
  replace(primary, "upload", (request, options) => {
    if (hung) return upload(request, options);
    hung = true;
    return hang(options?.signal);
  });

  const { submissionId } = await service.submit(video, ["en"]);
  await service.waitForState(submissionId, "succeeded");

  const retries = service.logs.filter((entry) => entry.event === "task.retry");
  assert.equal(retries.length, 1, "one call was retried");
  assert.equal(retries[0].reason, "timeout");
  assert.match(String(retries[0].task), /@primary$/);
});
