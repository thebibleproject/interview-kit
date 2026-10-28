import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { PermanentError, TransientError } from "../index.ts";
import { tinyData, useFixture } from "../testing/fixture.ts";

import type { ObjectStore } from "../index.ts";

const { dir, video, instantExternal } = await useFixture();

test("stores keep objects by key", async () => {
  const { stores } = instantExternal();
  const result = await stores.primary.upload({
    key: "a/video.mp4",
    source: { kind: "file", filePath: video },
  });
  assert.equal(result.url, "external://primary/a/video.mp4");
  assert.equal(
    (await stores.primary.head("a/video.mp4"))?.sizeBytes,
    10_000_000,
  );
  assert.equal(await stores.cdn.head("a/video.mp4"), null);
});

test("a failed upload may still store the object", async () => {
  const { stores } = instantExternal({ failureRate: 1, seed: 1 });
  const stored = [];
  for (let i = 0; i < 20; i++) {
    const key = `landed/${i}.txt`;
    await assert.rejects(
      stores.cdn.upload({ key, source: tinyData }),
      TransientError,
    );
    stored.push((await stores.cdn.head(key)) !== null);
  }
  assert.ok(stored.includes(true), "some failed uploads stored the object");
  assert.ok(stored.includes(false), "some failed uploads stored nothing");
});

test("stores differ in reliability", async () => {
  const { stores, openStore } = instantExternal({ failureRate: 0.5, seed: 3 });
  const succeeded = async (store: ObjectStore) => {
    let count = 0;
    for (let i = 0; i < 20; i++) {
      await store
        .upload({ key: `reliability/${i}.txt`, source: tinyData })
        .then(
          () => count++,
          () => {},
        );
    }
    return count;
  };
  assert.ok(
    (await succeeded(stores.primary)) > 0,
    "primary sometimes succeeds",
  );
  assert.equal(
    await succeeded(stores.archive),
    0,
    "archive always fails at this rate",
  );
  assert.equal(
    await succeeded(openStore("cold", { tier: "slow" })),
    0,
    "an opened slow store fails like archive",
  );
});

test("openStore returns one store per name", () => {
  const { stores, openStore } = instantExternal();
  assert.equal(
    openStore("primary", { tier: "fast" }),
    stores.primary,
    "built-ins are already open",
  );
  assert.equal(
    openStore("eu-west", { tier: "medium" }),
    openStore("eu-west", { tier: "medium" }),
    "reopening returns the same store",
  );
  assert.throws(
    () => openStore("cdn", { tier: "fast" }),
    { name: "Error" },
    "tier mismatch",
  );
  for (const name of ["", "Upper", "-lead", "a/b", "..", "a_b"]) {
    assert.throws(
      () => openStore(name, { tier: "fast" }),
      { name: "Error" },
      name,
    );
  }
});

test("an opened store keeps objects in its own folder", async () => {
  const dataDir = join(dir, "opened-stores");
  const { openStore } = instantExternal({ dataDir });
  const result = await openStore("eu-west", { tier: "slow" }).upload({
    key: "a/b.txt",
    source: tinyData,
  });
  assert.equal(result.url, "external://eu-west/a/b.txt");
  assert.equal(result.store, "eu-west");
  assert.equal(
    await readFile(join(dataDir, "eu-west", "a", "b.txt"), "utf8"),
    "x",
    "written under <dataDir>/<name>/",
  );
});

test("copy duplicates an object from another store", async () => {
  const { stores } = instantExternal();
  await stores.primary.upload({
    key: "copy/video.mp4",
    source: { kind: "file", filePath: video },
  });
  const copied = await stores.cdn.copy({
    key: "copied/video.mp4",
    from: { store: "primary", key: "copy/video.mp4" },
  });
  assert.equal(copied.url, "external://cdn/copied/video.mp4");
  assert.equal(
    (await stores.cdn.head("copied/video.mp4"))?.sizeBytes,
    10_000_000,
  );
  assert.equal(
    (await stores.primary.head("copy/video.mp4"))?.sizeBytes,
    10_000_000,
    "source kept",
  );
});

test("copy rejects a source that is not an object", async () => {
  const { stores } = instantExternal();
  await stores.primary.upload({ key: "copy-missing/a/b", source: tinyData });
  const sources = [
    { store: "primary", key: "copy-missing/nothing" },
    { store: "primary", key: "copy-missing/a" },
    { store: "never-opened", key: "copy-missing/a/b" },
    { store: "..", key: "stores/primary/copy-missing/a/b" },
    { store: "cdn", key: "../primary/copy-missing/a/b" },
  ];
  for (const from of sources) {
    const copy = stores.cdn.copy({ key: "copy-missing/out", from });
    await assert.rejects(copy, PermanentError, JSON.stringify(from));
  }
});

test("a failed copy may still store the object", async () => {
  const { stores, config } = instantExternal({ seed: 1 });
  await stores.primary.upload({
    key: "copy-landed/source.txt",
    source: tinyData,
  });
  config.failureRate = 1;
  const from = { store: "primary", key: "copy-landed/source.txt" };
  const stored = [];
  for (let i = 0; i < 20; i++) {
    const key = `copy-landed/${i}.txt`;
    await assert.rejects(stores.cdn.copy({ key, from }), TransientError);
    stored.push((await stores.cdn.head(key)) !== null);
  }
  assert.ok(stored.includes(true), "some failed copies stored the object");
  assert.ok(stored.includes(false), "some failed copies stored nothing");
});

test("stores reject keys that escape their directory", async () => {
  const { stores } = instantExternal();
  for (const key of ["../escape.txt", "/absolute.txt", "a/../../escape.txt"]) {
    const upload = stores.primary.upload({ key, source: tinyData });
    await assert.rejects(upload, PermanentError, key);
  }
});

test("stores reject keys that do not name an object", async () => {
  const { stores } = instantExternal({ dataDir: join(dir, "fresh-stores") });
  for (const key of ["", ".", "a/", "a//b", "./a", "a/./b"]) {
    const upload = stores.primary.upload({ key, source: tinyData });
    await assert.rejects(upload, PermanentError, key);
  }
  await stores.primary.upload({ key: "after/ok.txt", source: tinyData });
});

test("a key cannot also be the folder of another key", async () => {
  const { stores } = instantExternal();
  await stores.primary.upload({ key: "conflict/a", source: tinyData });
  await assert.rejects(
    stores.primary.upload({ key: "conflict/a/b", source: tinyData }),
    PermanentError,
  );
  await stores.primary.upload({ key: "conflict/c/d", source: tinyData });
  await assert.rejects(
    stores.primary.upload({ key: "conflict/c", source: tinyData }),
    PermanentError,
  );
});

test("head finds only objects", async () => {
  const { stores } = instantExternal();
  await stores.primary.upload({ key: "head/a/b", source: tinyData });
  assert.equal(
    await stores.primary.head("head/a"),
    null,
    "a folder is not an object",
  );
  assert.equal(
    await stores.primary.head("head/a/b/c"),
    null,
    "nothing lives under an object",
  );
});

test("upload rejects a filePath that is not a file", async () => {
  const { stores } = instantExternal();
  await assert.rejects(
    stores.primary.upload({
      key: "folder.bin",
      source: { kind: "file", filePath: dir },
    }),
    PermanentError,
  );
});
