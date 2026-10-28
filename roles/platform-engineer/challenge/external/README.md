# External services

`external/` stands in for the media tools and third-party services the service calls.

| Folder | Provides |
| ------ | -------- |
| `media/` | `media` — video metadata and frame capture. |
| `transcriber/` | `transcriber` — speech-to-text. |
| `stores/` | Object stores, including `primary`, `cdn`, and `archive`. |
| `chaos/` | Shared latency and failure behavior. |
| `settings/` | Options and environment variable parsing. |
| `shared/` | Errors and file inspection used by more than one service. |
| `testing/` | Fixtures used by the external services' tests. |

From the repo root:

```ts
import {
    createExternal,
    TransientError,
    RateLimitError,
    PermanentError,
} from "./external/index.ts";

const { media, transcriber, stores, openStore, config } = createExternal();
```

The external services never read the contents of a file. Any file of at least 1 KB counts as a valid video. They derive its duration from its size using a rate of about 250 KB per second, so a 10 MB file is about 40 seconds long. They reject smaller files with a `PermanentError`.

| Call | Returns | Behavior |
| ---- | ------- | -------- |
| `media.getMetadata(filePath)` | `{ container, videoCodec, audioCodec, width, height, durationSec, sizeBytes }` | Fast. |
| `media.captureFrame(filePath, atSec)` | `{ contentType, width, height, atSec, data: Buffer }` | About 0.5 s per frame. `atSec` must be within `0..durationSec`. |
| `transcriber.transcribe(filePath, { language? })` | `{ language, durationSec, text, segments: [{ startSec, endSec, text }] }` | Returns a transcript in the requested language, regardless of the video's audio. The text is filler. The call is slow, and its runtime scales with the video's duration. Allows at most **2 concurrent calls**, and rejects additional calls with `RateLimitError`. |
| `openStore(name, { tier })` | an object store | Opens the store called `name`. `tier` is `fast`, `medium`, or `slow`. Opening the same name again returns the same store, and opening it with a different tier throws. A name must start with a lowercase letter or digit and may contain lowercase letters, digits, and hyphens. |
| `<store>.upload({ key, source })` | `{ store, key, url, sizeBytes }` | Stores `source`, either `{ kind: 'file', filePath }` or `{ kind: 'data', data }`, under `key`, overwriting any existing object with that key. A key is a relative path such as `abc/capture-1.jpg`, and a key cannot also be the path prefix of another key. Upload time scales with file size. A failed upload **may still have stored the object**. |
| `<store>.copy({ key, from: { store, key } })` | `{ store, key, url, sizeBytes }` | Copies an object from another store into this one, without reading it through your service. It behaves like `upload`, with the same timing and failures. It rejects with a `PermanentError` if the source object doesn't exist. |
| `<store>.head(key)` | `{ store, key, url, sizeBytes }` or `null` | Checks whether an object exists. |

The transcriber counts concurrent calls inside one `createExternal()` instance. The real service would count them across every process you run, so design as if it does.

`stores` holds the three stores the current service uses. Each tier has a different speed and reliability:

| Tier | Store in `stores` | Speed | Reliability |
| ---- | ----------------- | ----- | ----------- |
| `fast` | `primary` | fast | most reliable |
| `medium` | `cdn` | medium | average |
| `slow` | `archive` | slow | least reliable |

By default, stores write objects to `data/stores/<name>/<key>` so you can inspect them.

Every media, transcriber, and store call accepts `{ signal }` as its last argument. Passing an `AbortSignal` cancels the call, which then rejects with an `AbortError`. Occasionally a call hangs and never settles until you abort it.

## Errors

Each failure from these services is a `TransientError`, a `RateLimitError`, or a `PermanentError`. Each of these has `retryable` and `service` properties.

- `TransientError` has `retryable: true`. The same call may succeed if you try it again.
- `RateLimitError` extends `TransientError`. Wait at least `err.retryAfterMs` before you retry.
- `PermanentError` has `retryable: false`. The input is bad, so retrying won't help.

An `AbortError` comes from your own signal, not from the service, so it has no `retryable` property.

## Configuration

You can pass options to `createExternal()` or set the matching environment variables:

| Option | Env var | Default | Description |
| ------ | ------- | ------- | ----------- |
| `failureRate` | `EXTERNAL_FAILURE_RATE` | `0.1` | Chance that a call fails with a transient error. |
| `slowRate` | `EXTERNAL_SLOW_RATE` | `0.05` | Chance that a call takes 10x longer than usual. |
| `hangRate` | `EXTERNAL_HANG_RATE` | `0.01` | Chance that a call hangs until you abort it. |
| `latencyScale` | `EXTERNAL_LATENCY_SCALE` | `1` | Multiplier on all latency. Set it to `0` to make calls instant. Hangs still hang. |
| `seed` | `EXTERNAL_SEED` | random | Fixes the sequence of random outcomes. All services draw from one sequence, so a run repeats exactly only when calls happen in the same order. Concurrent calls may interleave differently from run to run. |
| `dataDir` | `EXTERNAL_DATA_DIR` | `./data/stores` | Where stores write objects. |

Changes to the returned `config` object take effect on the next call. For example, setting `external.config.failureRate = 1` partway through a test makes every call after that point fail. See the `external/**/*.test.ts` files for usage examples.
