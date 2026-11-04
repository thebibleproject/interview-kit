import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import express from "express";

import { isoNow } from "../db.ts";
import { parseLanguage } from "../domain.ts";
import { submissionStatus } from "./status.ts";
import { submit } from "./submit.ts";

import type { DatabaseSync } from "node:sqlite";
import type { NextFunction, Request, Response } from "express";
import type { Language } from "../domain.ts";
import type { Log } from "../log.ts";
import type { Submission } from "./submit.ts";

export function createApp({
  db,
  log,
  videosDir,
}: {
  db: DatabaseSync;
  log: Log;
  videosDir: string;
}) {
  const app = express();
  app.use(express.json());

  app.post("/videos", async (req, res) => {
    const parsed = await parseSubmission(req.body, videosDir);
    if ("error" in parsed) {
      res.status(400).json(parsed);
      return;
    }
    const { submissionId, videoId, newTasks } = submit(db, parsed);
    log("submission.accepted", {
      submission: submissionId,
      video: videoId,
      languages: parsed.languages,
      newTasks,
    });
    res.status(202).json({ submissionId, videoId });
  });

  app.get("/submissions/:id", (req, res) => {
    const status = submissionStatus(db, req.params.id);
    if (status === null)
      res.status(404).json({ error: "submission not found" });
    else res.json(status);
  });

  /** Retries the video's failed tasks with fresh attempts. Finished tasks are untouched. */
  app.post("/videos/:id/retry", (req, res) => {
    if (
      db.prepare("SELECT 1 FROM videos WHERE id = ?").get(req.params.id) ===
      undefined
    ) {
      res.status(404).json({ error: "video not found" });
      return;
    }
    const retried = db
      .prepare(
        `UPDATE tasks SET state = 'pending', attempts = 0, next_run_at = ?, updated_at = ?
         WHERE video_id = ? AND state = 'failed'`,
      )
      .run(Date.now(), isoNow(), req.params.id);
    res.status(202).json({ retried: Number(retried.changes) });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? Number(err.status)
        : 500;
    res
      .status(status)
      .json({ error: err instanceof Error ? err.message : "internal error" });
  });

  return app;
}

async function parseSubmission(
  body: unknown,
  videosDir: string,
): Promise<Submission | { error: string }> {
  if (typeof body !== "object" || body === null)
    return { error: "body must be a JSON object" };
  const { path, languages } = body as Record<string, unknown>;
  if (typeof path !== "string" || isAbsolute(path))
    return { error: "path must be relative to the videos directory" };
  const filePath = resolve(videosDir, path);
  const inside = relative(videosDir, filePath);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`))
    return { error: "path must be inside the videos directory" };
  if (!Array.isArray(languages) || languages.length === 0) {
    return { error: "languages must be a non-empty array" };
  }
  const parsedLanguages = languages.map(parseLanguage);
  if (parsedLanguages.includes(null))
    return { error: 'each language must look like "en" or "pt-BR"' };
  const info = await stat(filePath).catch(() => null);
  if (info === null || !info.isFile())
    return { error: `${inside} is not a file` };
  return {
    path: inside,
    sizeBytes: info.size,
    mtimeMs: Math.trunc(info.mtimeMs),
    languages: [...new Set(parsedLanguages as Language[])],
  };
}
