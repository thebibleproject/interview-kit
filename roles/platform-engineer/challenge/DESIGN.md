# Media Processing Service Design Document

The service takes a video file path and a list of languages. It reads the file's metadata, takes 5 screen captures, transcribes the video into each language, and uploads the original, the captures, and the transcripts to every store. Clients poll a submission for its progress.

| Route | Does |
| ----- | ---- |
| `POST /videos` `{ path, languages }` | Records a submission and its tasks. Responds `202 { submissionId, videoId }` immediately. |
| `GET /submissions/:id` | Returns the submission's derived status. |
| `POST /videos/:id/retry` | Retries the video's failed tasks. Responds `202 { retried }`. |

## Organization

The files below are listed in the order a submission moves through the service.

| File | Owns |
| ---- | ---- |
| `src/api/app.ts` | The routes and request validation. |
| `src/api/submit.ts` | The transaction that records a submission and inserts its plan. |
| `src/api/plan.ts` | The tasks a submission needs and the assets it uploads. |
| `src/api/status.ts` | A submission's status, derived from its tasks. |
| `src/worker/worker.ts` | Starting runnable tasks, running them under a timeout, and recording the outcome. |
| `src/worker/handlers.ts` | What each task type does, and its concurrency, timeout, and attempt limit. |
| `src/worker/retry.ts` | The retry policy. |
| `src/domain.ts` | The core types, task keys, and object keys. |
| `src/db.ts` | The schema, transactions, and row decoding. |
| `src/server.ts`, `src/log.ts` | Startup, shutdown, and log lines. |
| `src/tests/*.test.ts` | Behavior tests through the HTTP API. `test-harness.ts` starts the service on a fresh database against instant, reliable external services. |

## A Submission's Lifecycle

1. `POST /videos` validates the request. The path must be absolute and name a regular file. The languages must be a non-empty list of codes such as `en` or `pt-BR`.
2. One transaction finds or creates the video by path, size, and mtime. It records the submission and its languages. It then inserts the submission's plan. A task the video already has is skipped, so earlier work is reused.
3. The worker polls the database every 250 ms and immediately after each task finishes, then starts runnable tasks of each type. A task is runnable when it is pending, its `next_run_at` has passed, and what it reads exists.
4. Each task runs with a timeout. On success, its output and `state = 'done'` commit in one transaction. On failure, the retry policy either schedules another attempt or marks the task failed.
5. `GET /submissions/:id` reads the tasks in the submission's scope and derives its state.

The plan for one submission looks like this:

```text
getMetadata ──┬── captureFrame:1..5 ─ upload:capture-<n>@{primary,cdn,archive}
              ├── transcribe:<lang> ─ upload:transcript-<lang>@{primary,cdn,archive}
              └────────────────────── upload:original@{primary,cdn,archive}
```

Objects land at `<videoId>/original.<ext>`, `<videoId>/capture-<n>.jpg`, and `<videoId>/transcript-<lang>.json`.

## Data Model

| Table | Holds |
| ----- | ----- |
| `videos` | One row per file, unique on `(path, size_bytes, mtime_ms)`. `metadata` holds the getMetadata result as JSON once it has run. |
| `submissions`, `submission_languages` | What each client asked for. Insert-only. |
| `tasks` | One row per unit of work, unique on `(video_id, key)`. Holds `state`, `attempts`, `next_run_at`, `last_error`, and, for uploads, a `result` of `{ url, sizeBytes }`. |
| `captures`, `transcripts` | Produced assets, so an upload retry never produces them again. |

Task keys are `getMetadata`, `captureFrame:<n>`, `transcribe:<lang>`, and `upload:<asset>@<store>`, where the asset is `original`, `capture-<n>`, or `transcript-<lang>`. Each key names the unit of work the task performs.

## Decisions

**A video is a file.** Two submissions are the same video when path, size, and mtime match. Hashing a 5 GB file takes minutes, and the stat is free. A file edited in place is a new video.

**The plan is materialized at submit time.** Every task exists from the start. Progress and status are a query over rows, and the worker is generic. It knows how to run a task, not what a submission is.

**A delivery is a task.** An upload to one store is a task like any other, with its own attempts and error. Its result holds the URL. There is no separate deliveries table to keep in step.

**A task is ready once its input exists.** The worker's query knows what each type reads. Captures and transcriptions wait for the video's metadata. An upload waits for its capture or transcript row, or for the metadata when it uploads the original.

**Today, every video goes to the same three stores.** `primary` is ours, and `cdn` and `archive` are GoodPeople's. `primary` and `cdn` are required, and their uploads get 8 attempts. `archive` is best-effort. Uploads to archive never fail a submission or hold one up, and they retry forever with capped backoff.

**Behavior is keyed by task type.** `src/worker/handlers.ts` gives each task type its concurrency, timeout, and attempt limit. `perform` does a task's work and returns its output. `record` writes that output in the transaction that marks the task done.

| Type | Concurrency | Timeout | Attempts |
| ---- | ----------- | ------- | -------- |
| getMetadata | 4 | 10 s | 5 |
| captureFrame | 4 | 15 s | 5 |
| transcribe | 2 | 30 s + 200 ms per second of video | 5 |
| upload | 6 | 30 s + 1 s per MB | 8, archive unlimited |

Transcribe concurrency is 2 because the transcriber rejects a third concurrent call.

**Status is derived.** No table stores a submission's state. A submission's scope is its getMetadata task, its captures, its languages' transcriptions, and the uploads of its assets. Uploads to archive don't count toward its state. It is `failed` if any other task in scope failed, and `succeeded` once every other task in scope is done. Otherwise it is `processing`. `missing.archive` lists the assets not yet delivered to archive.

**A finished task is never redone.** The output and the `done` state commit together. An upload retry overwrites the same key, so an upload that stored the object and then threw is harmless to repeat.

**One process owns the database.** On start, the worker resets every `running` task to `pending`, because nothing else could be running it. While the process runs, only the task's own run writes to its row, and the task's timeout aborts a run that hangs.

**One retry policy.** `src/worker/retry.ts` classifies every failure the same way.

| Error | Retried | Wait |
| ----- | ------- | ---- |
| `PermanentError` | No; the task fails | |
| `RateLimitError` | Yes, without consuming an attempt | at least `retryAfterMs` |
| `TransientError` | Yes | backoff |
| Our timeout (`TimeoutError`) | Yes | backoff |
| Anything else | Yes, logged with reason `unexpected` | backoff |

Backoff starts at 500 ms and doubles per attempt up to 60 s. Each wait is a random point between half and all of the current backoff. When attempts reach the type's limit, the task fails with its last error. A task cut off by `stop()` goes back to pending without using an attempt.

**Retries run out, then an operator retries.** A required upload that fails 8 times fails the submission. `POST /videos/:id/retry` puts the video's failed tasks back to pending with fresh attempts. Done tasks stay done, so only the failed work runs again.

## Logs

One JSON line per event on stdout.

| Event | Fields |
| ----- | ------ |
| `submission.accepted` | submission, video, languages, newTasks |
| `task.succeeded` | video, task, ms |
| `task.retry` | video, task, attempt, delayMs, reason, error |
| `task.failed` | video, task, attempts, reason, error |
| `worker.error` | error; task, if the error occurred while recording a task's outcome |

## Known Limits

- The transcriber limit and the startup reset assume one process. A second process would exceed the transcriber's concurrency and reset the first process's running tasks.
- The scheduler orders all work by `next_run_at`, then by task id. A large backlog delays a new submission, and there is no notion of priority.
- Captures and transcripts live in SQLite as blobs and text. That suits small assets only.
