import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { PermanentError, TransientError } from "../shared/errors.ts";

import type { Chaos } from "../chaos/chaos.ts";
import type { ServiceName } from "../shared/errors.ts";

export type StoreName = string;

/**
 * A store's speed and reliability. `baseMs` is the latency of every
 * upload, `msPerMb` adds latency per MB uploaded, and `failureMultiplier`
 * scales `failureRate`.
 */
export type StoreProfile = {
  baseMs: number;
  msPerMb: number;
  failureMultiplier: number;
};

export type UploadSource =
  | { kind: "file"; filePath: string }
  | { kind: "data"; data: Buffer | string };

export type StoredObject = {
  store: StoreName;
  key: string;
  url: string;
  sizeBytes: number;
};

// A store name is one directory under the data dir.
const STORE_NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Stand-in for an object store / delivery platform. Objects are written to
 * `<rootDir>/<name>/<key>` so you can inspect what was delivered.
 */
export class ObjectStore {
  readonly name: StoreName;
  readonly #service: ServiceName;
  readonly #profile: StoreProfile;
  readonly #rootDir: string;
  readonly #chaos: Chaos;

  constructor({
    name,
    profile,
    chaos,
    rootDir,
  }: {
    name: StoreName;
    profile: StoreProfile;
    chaos: Chaos;
    rootDir: string;
  }) {
    if (!isStoreName(name))
      throw new Error(`invalid store name ${JSON.stringify(name)}`);
    this.name = name;
    this.#service = `store:${name}`;
    this.#profile = profile;
    this.#rootDir = rootDir;
    this.#chaos = chaos;
  }

  /**
   * Stores an object under `key`, overwriting any existing object.
   *
   * A TransientError does NOT guarantee the object was not stored: like a
   * dropped connection, the write sometimes lands before the error.
   */
  async upload(
    { key, source }: { key: string; source: UploadSource },
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<StoredObject> {
    const path = this.#objectPath(key);
    return this.#put(key, path, source, await this.#sizeOf(source), signal);
  }

  /**
   * Copies the object at `from.key` in store `from.store` to `key` in this
   * store without sending its bytes through the caller. The source can be
   * any store under the same data dir, opened or not.
   *
   * Fails and times like an upload of the same size to this store,
   * including that a TransientError does NOT guarantee the copy was not stored.
   */
  async copy(
    { key, from }: { key: string; from: { store: StoreName; key: string } },
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<StoredObject> {
    const path = this.#objectPath(key);
    const filePath = this.#objectPath(from.key, from.store);
    const sizeBytes = await fileSize(filePath);
    if (sizeBytes === null) {
      throw new PermanentError(
        `no object at external://${from.store}/${from.key} to copy`,
        {
          service: this.#service,
        },
      );
    }
    return this.#put(key, path, { kind: "file", filePath }, sizeBytes, signal);
  }

  /** Looks up an object without downloading it. Resolves to null if absent. */
  async head(
    key: string,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<StoredObject | null> {
    const path = this.#objectPath(key);
    await this.#chaos.delay(50, signal);
    const sizeBytes = await fileSize(path);
    return sizeBytes === null ? null : this.#describe(key, sizeBytes);
  }

  async #put(
    key: string,
    path: string,
    source: UploadSource,
    sizeBytes: number,
    signal: AbortSignal | undefined,
  ): Promise<StoredObject> {
    const { baseMs, msPerMb, failureMultiplier } = this.#profile;
    await this.#chaos.delay(baseMs + (sizeBytes / 1e6) * msPerMb, signal);

    // Half of failed uploads are lost before the write. The rest land, then throw.
    const failed = this.#chaos.fails(failureMultiplier);
    const lost = failed && this.#chaos.random() < 0.5;
    if (lost)
      throw new TransientError("upload failed", { service: this.#service });
    await this.#write(key, path, source);
    if (failed)
      throw new TransientError("connection reset", { service: this.#service });
    return this.#describe(key, sizeBytes);
  }

  #objectPath(key: string, store: StoreName = this.name): string {
    if (!isStoreName(store)) {
      throw new PermanentError(`invalid store ${JSON.stringify(store)}`, {
        service: this.#service,
      });
    }
    if (
      typeof key !== "string" ||
      key
        .split("/")
        .some(
          (segment) => segment === "" || segment === "." || segment === "..",
        )
    ) {
      throw new PermanentError(`invalid key ${JSON.stringify(key)}`, {
        service: this.#service,
      });
    }
    return join(this.#rootDir, store, key);
  }

  async #sizeOf(source: UploadSource): Promise<number> {
    switch (source.kind) {
      case "data":
        return Buffer.byteLength(source.data);
      case "file": {
        const info = await stat(source.filePath).catch((cause: unknown) => {
          throw new PermanentError(`cannot read ${source.filePath}`, {
            service: this.#service,
            cause,
          });
        });
        if (!info.isFile()) {
          throw new PermanentError(`${source.filePath} is not a file`, {
            service: this.#service,
          });
        }
        return info.size;
      }
      default: {
        const _exhaustive: never = source;
        throw new TypeError("unknown upload source kind");
      }
    }
  }

  async #write(key: string, path: string, source: UploadSource): Promise<void> {
    try {
      await mkdir(dirname(path), { recursive: true });
      if (source.kind === "data") await writeFile(path, source.data);
      else await copyFile(source.filePath, path);
    } catch (err) {
      if (hasErrnoCode(err, "EEXIST", "ENOTDIR", "EISDIR")) {
        throw new PermanentError(
          `key ${JSON.stringify(key)} conflicts with another object's path`,
          {
            service: this.#service,
            cause: err,
          },
        );
      }
      throw err;
    }
  }

  #describe(key: string, sizeBytes: number): StoredObject {
    return {
      store: this.name,
      key,
      url: `external://${this.name}/${key}`,
      sizeBytes,
    };
  }
}

function isStoreName(name: unknown): name is StoreName {
  return typeof name === "string" && STORE_NAME.test(name);
}

/** Resolves to the size of the file at `path`, or null if no file is there. */
async function fileSize(path: string): Promise<number | null> {
  const info = await stat(path).catch((err: unknown) => {
    if (hasErrnoCode(err, "ENOENT", "ENOTDIR")) return null;
    throw err;
  });
  return info?.isFile() ? info.size : null;
}

function hasErrnoCode(err: unknown, ...codes: string[]) {
  return (
    err instanceof Error &&
    "code" in err &&
    typeof err.code === "string" &&
    codes.includes(err.code)
  );
}
