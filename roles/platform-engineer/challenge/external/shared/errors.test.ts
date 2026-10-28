import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { tinyData, useFixture } from "../testing/fixture.ts";

const { dir, instantExternal } = await useFixture();

test("errors say which service failed and whether to retry", async () => {
  const external = instantExternal();
  const notVideo = join(dir, "tiny.mp4");
  await writeFile(notVideo, "hello");
  await assert.rejects(external.media.getMetadata(notVideo), {
    name: "PermanentError",
    service: "media",
    retryable: false,
  });
  external.config.failureRate = 1;
  await assert.rejects(
    external.stores.cdn.upload({ key: "errors/a.txt", source: tinyData }),
    {
      name: "TransientError",
      service: "store:cdn",
      retryable: true,
    },
  );
});
