import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createExternal } from "../external/index.ts";
import { createApp } from "./api/app.ts";
import { openDatabase } from "./db.ts";
import { stdoutLog } from "./log.ts";
import { Worker } from "./worker/worker.ts";

const dbPath = process.env.DB_PATH ?? "data/service.db";
const videosDir = resolve(process.env.VIDEOS_DIR ?? "data/videos");
const port = Number(process.env.PORT ?? 3000);

mkdirSync(dirname(dbPath), { recursive: true });
const db = openDatabase(dbPath);
const worker = new Worker({
  db,
  videosDir,
  services: createExternal(),
  log: stdoutLog,
});
worker.start();

const server = createApp({ db, log: stdoutLog, videosDir }).listen(port, () => {
  stdoutLog("server.listening", { port, db: dbPath, videos: videosDir });
});

async function shutdown(signal: string) {
  stdoutLog("server.stopping", { signal });
  await worker.stop();
  server.close();
  db.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
