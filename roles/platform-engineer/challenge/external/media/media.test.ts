import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { PermanentError } from "../index.ts";
import { useFixture } from "../testing/fixture.ts";

const { dir, video, instantExternal } = await useFixture();

test("media reads metadata and captures frames", async () => {
  const { media } = instantExternal();
  const info = await media.getMetadata(video);
  assert.equal(info.durationSec, 40);
  const frame = await media.captureFrame(video, 10);
  assert.equal(frame.contentType, "image/jpeg");
  await assert.rejects(media.captureFrame(video, 41), PermanentError);
});

test("rejects files that are not videos", async () => {
  const { media } = instantExternal();
  const notVideo = join(dir, "not-video.mp4");
  await writeFile(notVideo, "hello");
  await assert.rejects(media.getMetadata(notVideo), PermanentError);
});
