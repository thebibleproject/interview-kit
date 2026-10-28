import assert from "node:assert/strict";
import { test } from "node:test";

import { TransientError } from "../../external/index.ts";
import {
  createVideo,
  replace,
  startService,
  track,
  useTempDir,
  waitFor,
} from "./test-harness.ts";

const dir = await useTempDir();

test("a failing archive does not hold up a submission and catches up later", async (t) => {
  const service = await startService(dir);
  t.after(() => service.close());
  const video = await createVideo(dir, "archive-down.mp4");
  const restore = replace(
    service.external.stores.archive,
    "upload",
    async () => {
      throw new TransientError("archive is down", { service: "store:archive" });
    },
  );

  const { submissionId } = await service.submit(video, ["en"]);
  const status = await service.waitForState(submissionId, "succeeded");
  assert.deepEqual(
    status.missing.archive,
    status.assets.map((asset) => asset.name),
    "every asset is missing from archive",
  );
  assert.deepEqual(status.errors, [], "archive retries are not errors");

  restore();
  const caughtUp = await waitFor(
    "archive to catch up",
    () => service.status(submissionId),
    (s) => s.missing.archive?.length === 0,
  );
  assert.equal(caughtUp.state, "succeeded");
  for (const asset of caughtUp.assets) {
    assert.equal(
      asset.stores.archive.url,
      `external://archive/${asset.key}`,
      `${asset.name} reached archive`,
    );
  }
});

test("a cdn that outlasts its retries fails the submission until an operator retries it", async (t) => {
  const service = await startService(dir);
  t.after(() => service.close());
  const video = await createVideo(dir, "cdn-down.mp4");
  const restore = replace(service.external.stores.cdn, "upload", async () => {
    throw new TransientError("cdn is down", { service: "store:cdn" });
  });

  const { submissionId, videoId } = await service.submit(video, ["en"]);
  const failed = await waitFor(
    "every cdn upload to run out of attempts",
    () => service.status(submissionId),
    (s) => s.errors.length === s.assets.length,
  );
  assert.equal(failed.state, "failed");
  for (const error of failed.errors) {
    assert.match(error.task, /@cdn$/, "only cdn uploads failed");
    assert.equal(error.error, "store:cdn: cdn is down");
  }
  assert.ok(
    failed.assets.every(
      (asset) =>
        asset.stores.cdn.state === "failed" && asset.stores.cdn.attempts === 8,
    ),
    "each cdn upload used all 8 attempts",
  );

  restore();
  const primaryUploads = track(service.external.stores.primary, "upload");
  const res = await service.post(`/videos/${videoId}/retry`);
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { retried: failed.assets.length });

  const status = await service.waitForState(submissionId, "succeeded");
  assert.deepEqual(status.errors, []);
  assert.equal(
    primaryUploads.calls,
    0,
    "finished primary deliveries were not redone",
  );
});
