import { isoNow, loadVideo, one, parseTask, transaction } from "../db.ts";
import { errorMessage } from "../log.ts";
import {
  CONCURRENCY,
  maxAttempts,
  perform,
  record,
  timeoutMs,
} from "./handlers.ts";
import { decide } from "./retry.ts";

import type { DatabaseSync } from "node:sqlite";
import type { Task, TaskType, Video } from "../domain.ts";
import type { Log } from "../log.ts";
import type { Services } from "./handlers.ts";
import type { Backoff } from "./retry.ts";

export type WorkerOptions = {
  tickMs: number;
  backoff: Backoff;
  /** Multiplies every task timeout. */
  timeoutScale: number;
};

const DEFAULT_OPTIONS: WorkerOptions = {
  tickMs: 250,
  backoff: { baseMs: 500, capMs: 60_000 },
  timeoutScale: 1,
};

const TYPES = Object.keys(CONCURRENCY) as TaskType[];

/** A task can start once what it reads exists. An upload's original is the source file, which getMetadata vouches for. */
const SELECT_RUNNABLE = `
  SELECT t.* FROM tasks t JOIN videos v ON v.id = t.video_id
  WHERE t.type = ? AND t.state = 'pending' AND t.next_run_at <= ?
    AND CASE t.type
      WHEN 'getMetadata' THEN TRUE
      WHEN 'captureFrame' THEN v.metadata IS NOT NULL
      WHEN 'transcribe' THEN v.metadata IS NOT NULL
      WHEN 'upload' THEN CASE json_extract(t.action, '$.asset.type')
        WHEN 'original' THEN v.metadata IS NOT NULL
        WHEN 'capture' THEN EXISTS (
          SELECT 1 FROM captures c WHERE c.video_id = t.video_id AND c.idx = json_extract(t.action, '$.asset.index')
        )
        WHEN 'transcript' THEN EXISTS (
          SELECT 1 FROM transcripts s
          WHERE s.video_id = t.video_id AND s.language = json_extract(t.action, '$.asset.language')
        )
      END
    END
  ORDER BY t.next_run_at, t.id
  LIMIT ?`;

/** Runs up to `CONCURRENCY` tasks of each type at once. Assumes it is the only worker on its database. */
export class Worker {
  readonly #db: DatabaseSync;
  readonly #services: Services;
  readonly #log: Log;
  readonly #options: WorkerOptions;
  readonly #stop = new AbortController();
  readonly #runs = new Map<Promise<void>, TaskType>();
  #timer: NodeJS.Timeout | undefined;

  constructor({
    db,
    services,
    log,
    options = {},
  }: {
    db: DatabaseSync;
    services: Services;
    log: Log;
    options?: Partial<WorkerOptions>;
  }) {
    this.#db = db;
    this.#services = services;
    this.#log = log;
    this.#options = { ...DEFAULT_OPTIONS, ...options };
  }

  start(): void {
    // Nothing else runs tasks on this database, so anything still running was cut off by a stop or crash.
    this.#db
      .prepare(`UPDATE tasks SET state = 'pending' WHERE state = 'running'`)
      .run();
    this.#tick();
  }

  /** Aborts running tasks and resolves once every task has settled. Aborted tasks keep their attempt. */
  async stop(): Promise<void> {
    this.#stop.abort();
    clearTimeout(this.#timer);
    await Promise.allSettled(this.#runs.keys());
  }

  #schedule(ms: number): void {
    if (this.#stop.signal.aborted) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#tick(), ms);
  }

  #tick(): void {
    try {
      this.#startRunnableTasks(Date.now());
    } catch (err) {
      this.#log("worker.error", { error: errorMessage(err) });
    }
    this.#schedule(this.#options.tickMs);
  }

  #startRunnableTasks(at: number): void {
    for (const type of TYPES) {
      const running = [...this.#runs.values()].filter((t) => t === type).length;
      const free = CONCURRENCY[type] - running;
      if (free <= 0) continue;
      for (const row of this.#db.prepare(SELECT_RUNNABLE).all(type, at, free)) {
        this.#startTask(parseTask(row));
      }
    }
  }

  #startTask({ id, videoId }: Task): void {
    const video = loadVideo(this.#db, videoId);
    if (video === null)
      throw new Error(`task ${id} names missing video ${videoId}`);
    const task = parseTask(
      one(
        this.#db,
        `UPDATE tasks SET state = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? RETURNING *`,
        isoNow(),
        id,
      ),
    );

    // A run that throws while recording its outcome stays running until the next start resets it.
    const run = this.#run(task, video)
      .catch((err: unknown) =>
        this.#log("worker.error", { task: task.key, error: errorMessage(err) }),
      )
      .finally(() => {
        this.#runs.delete(run);
        this.#schedule(0);
      });
    this.#runs.set(run, task.action.type);
  }

  async #run(task: Task, video: Video): Promise<void> {
    const started = Date.now();
    const timeout = AbortSignal.timeout(
      Math.ceil(timeoutMs(task.action, video) * this.#options.timeoutScale),
    );
    const signal = AbortSignal.any([this.#stop.signal, timeout]);
    const fields = { video: video.id, task: task.key };
    try {
      const output = await perform(task.action, {
        video,
        db: this.#db,
        services: this.#services,
        signal,
      });
      transaction(this.#db, () => {
        this.#db
          .prepare(
            `UPDATE tasks SET state = 'done', updated_at = ? WHERE id = ?`,
          )
          .run(isoNow(), task.id);
        record(this.#db, task.id, video, output);
      });
      this.#log("task.succeeded", { ...fields, ms: Date.now() - started });
    } catch (err) {
      if (this.#stop.signal.aborted) {
        this.#db
          .prepare(
            `UPDATE tasks SET state = 'pending', attempts = attempts - 1 WHERE id = ?`,
          )
          .run(task.id);
        return;
      }
      // A call cut off by our timeout rejects with an AbortError. The timeout is the real cause.
      const cause: unknown = timeout.aborted ? timeout.reason : err;
      const error = errorMessage(cause);
      const decision = decide(
        cause,
        task.attempts,
        maxAttempts(task.action),
        this.#options.backoff,
      );
      if (decision.state === "failed") {
        this.#db
          .prepare(
            `UPDATE tasks SET state = 'failed', last_error = ?, updated_at = ? WHERE id = ?`,
          )
          .run(error, isoNow(), task.id);
        this.#log("task.failed", {
          ...fields,
          attempts: task.attempts,
          reason: decision.reason,
          error,
        });
        return;
      }
      // A rate-limited attempt doesn't count, so `decide` may return one fewer than `task.attempts`.
      this.#db
        .prepare(
          `UPDATE tasks SET state = 'pending', attempts = ?, next_run_at = ?, last_error = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          decision.attempts,
          Date.now() + decision.delayMs,
          error,
          isoNow(),
          task.id,
        );
      this.#log("task.retry", {
        ...fields,
        attempt: task.attempts,
        delayMs: Math.round(decision.delayMs),
        reason: decision.reason,
        error,
      });
    }
  }
}
