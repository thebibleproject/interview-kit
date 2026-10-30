import { mkdir, open } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { inspectVideo } from "../external/shared/video.ts";

const VIDEOS_DIR = resolve(process.env.VIDEOS_DIR ?? "data/videos");
const DEFAULT_MEGABYTES = "10";
const MAX_MEGABYTES = 100;
const BYTES_PER_MEGABYTE = 1_000_000;
const USAGE = `usage: npm run create-video -- <path under ${VIDEOS_DIR}> [megabytes, default 10, max ${MAX_MEGABYTES}]`;

function parseArgs([path, megabytes = DEFAULT_MEGABYTES]: string[]) {
  if (!path || isAbsolute(path)) return undefined;
  const filePath = resolve(VIDEOS_DIR, path);
  const inside = relative(VIDEOS_DIR, filePath);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`))
    return undefined;
  const mb = Number(megabytes);
  if (!(mb > 0 && mb <= MAX_MEGABYTES)) return undefined;
  return { path: inside, filePath, bytes: Math.round(mb * BYTES_PER_MEGABYTE) };
}

const args = parseArgs(process.argv.slice(2));
if (!args) {
  console.error(USAGE);
  process.exit(1);
}
const { path, filePath, bytes } = args;

await mkdir(dirname(filePath), { recursive: true });
{
  await using file = await open(filePath, "wx").catch((err) => {
    if (err.code !== "EEXIST") throw err;
    console.error(`${filePath} already exists`);
    process.exit(1);
  });
  await file.truncate(bytes);
}
const { durationSec } = await inspectVideo("media", filePath);
console.log(
  `Created ${filePath} (${bytes / BYTES_PER_MEGABYTE} MB, ~${durationSec} s). Submit it with "path": "${path}".`,
);
