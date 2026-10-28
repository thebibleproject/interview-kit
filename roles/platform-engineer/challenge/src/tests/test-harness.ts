import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { createExternal } from "../../external/index.ts";
import { createApp } from "../api/app.ts";
import { openDatabase } from "../db.ts";
import { Worker } from "../worker/worker.ts";

import type { SubmissionState, SubmissionStatus } from "../api/status.ts";
import type { Log } from "../log.ts";
import type { WorkerOptions } from "../worker/worker.ts";

const TEST_OPTIONS = {
  tickMs: 10,
  backoff: { baseMs: 5, capMs: 50 },
} satisfies Partial<WorkerOptions>;
const POLL_MS = 10;
const WAIT_MS = 10_000;

export type LogEntry = { event: string } & Record<string, unknown>;

/** A temp dir removed after the calling file's tests. */
export async function useTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "media-tasks-test-"));
  after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * The external services treat about 1 MB as a 4-second video and anything under 1 KB as not a video.
 * The default is not a whole number of MB, like real files, so size-scaled timeouts come out fractional.
 */
export async function createVideo(
  dir: string,
  name: string,
  sizeBytes = 1_000_500,
): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, "");
  await truncate(path, sizeBytes);
  return path;
}

/** The HTTP app and a worker on a fresh database, against external services that are instant and never fail on their own. */
export async function startService(
  dir: string,
  { worker: workerOptions = {} }: { worker?: Partial<WorkerOptions> } = {},
) {
  const home = await mkdtemp(join(dir, "service-"));
  const storesDir = join(home, "stores");
  const external = createExternal({
    failureRate: 0,
    slowRate: 0,
    hangRate: 0,
    latencyScale: 0,
    dataDir: storesDir,
  });
  const db = openDatabase(join(home, "service.db"));
  const logs: LogEntry[] = [];
  const log: Log = (event, fields = {}) => logs.push({ event, ...fields });
  const newWorker = () =>
    new Worker({
      db,
      services: external,
      log,
      options: { ...TEST_OPTIONS, ...workerOptions },
    });
  let worker = newWorker();

  const server = createApp({ db, log }).listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  worker.start();

  const post = (path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
    });

  async function status(id: string): Promise<SubmissionStatus> {
    const res = await fetch(`${base}/submissions/${id}`);
    assert.equal(res.status, 200, `submission ${id} exists`);
    return (await res.json()) as SubmissionStatus;
  }

  return {
    db,
    external,
    logs,
    storesDir,
    post,
    get: (path: string) => fetch(`${base}${path}`),
    status,
    async submit(
      path: string,
      languages: string[],
    ): Promise<{ submissionId: string; videoId: string }> {
      const res = await post("/videos", { path, languages });
      assert.equal(res.status, 202, "submission accepted");
      return (await res.json()) as { submissionId: string; videoId: string };
    },
    waitForState: (id: string, state: SubmissionState) =>
      waitFor(
        `submission ${state}`,
        () => status(id),
        (s) => s.state === state,
      ),
    stopWorker: () => worker.stop(),
    /** A fresh worker on the same database, as after a process restart. */
    startWorker() {
      worker = newWorker();
      worker.start();
    },
    async close() {
      await worker.stop();
      server.closeAllConnections();
      server.close();
      db.close();
    },
  };
}

export async function waitFor<T>(
  label: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = WAIT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline)
      assert.fail(
        `timed out waiting for ${label}: ${JSON.stringify(value, null, 2)}`,
      );
    await sleep(POLL_MS);
  }
}

/** Swaps a method on an external service. Returns a function that puts the original back. */
export function replace<O, K extends keyof O>(
  object: O,
  method: K,
  impl: O[K],
): () => void {
  const original = object[method];
  object[method] = impl;
  return () => {
    object[method] = original;
  };
}

/** Counts calls to an async method on an external service, and how many of them resolved. */
export function track<O, K extends keyof O>(
  object: O,
  method: K,
): { calls: number; resolved: number } {
  const counts = { calls: 0, resolved: 0 };
  const original = object[method] as (...args: unknown[]) => Promise<unknown>;
  object[method] = (async (...args: unknown[]) => {
    counts.calls++;
    const value = await original.apply(object, args);
    counts.resolved++;
    return value;
  }) as O[K];
  return counts;
}

/** A call that hangs like a stalled socket and settles only when aborted. */
export function hang(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}
