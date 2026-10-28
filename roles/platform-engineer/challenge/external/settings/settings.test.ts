import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { createExternal } from "../index.ts";
import { useFixture } from "../testing/fixture.ts";

const { dir, instantExternal } = await useFixture();

test("createExternal rejects invalid configuration", () => {
  assert.throws(() => instantExternal({ failureRate: 2 }), RangeError);
  assert.throws(() => instantExternal({ latencyScale: -1 }), RangeError);
  assert.throws(() => instantExternal({ seed: 1.5 }), RangeError);
  const saved = process.env.EXTERNAL_SLOW_RATE;
  process.env.EXTERNAL_SLOW_RATE = "abc";
  try {
    assert.throws(
      () => createExternal({ dataDir: join(dir, "stores") }),
      RangeError,
    );
  } finally {
    if (saved === undefined) delete process.env.EXTERNAL_SLOW_RATE;
    else process.env.EXTERNAL_SLOW_RATE = saved;
  }
});
