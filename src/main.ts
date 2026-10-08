import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchChanges, fetchFeedState } from "./feed.ts";
import { downloadReleaseAsset } from "./github.ts";
import { renderNotes, type Manifest } from "./notes.ts";
import { compareSnapshots, writeParquet } from "./parquet.ts";

const OUT_DIR = process.env.OUT_DIR ?? "out";
const PREVIOUS_DIR = join(OUT_DIR, "previous");
const FEED_URL = process.env.FEED_URL;
const CHANGES_URL = FEED_URL && new URL("registry/_changes", FEED_URL).href;

const tagFor = (date: string) => `snapshot-${date}`;
const parquetFor = (date: string) => `changes-${date}.parquet`;

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}

await mkdir(PREVIOUS_DIR, { recursive: true });

// 1. Start state
const start = await fetchFeedState(FEED_URL);
const date = start.time.slice(0, 10);
const previousDate = new Date(Date.parse(date) - 86_400_000).toISOString().slice(0, 10);
const updateSeq = Number(start.state.update_seq);
if (!Number.isSafeInteger(updateSeq)) throw new Error(`Unsupported update_seq: ${start.state.update_seq}`);

// 2. Changes
const { entries, pages, fetchedEntries } = await fetchChanges(updateSeq, CHANGES_URL);

// 3. Final state
const final = await fetchFeedState(FEED_URL);

// 4. Manifest
const manifest: Manifest = {
  start,
  final,
  pages,
  fetched_entries: fetchedEntries,
  stored_entries: entries.size,
};
await writeJson(join(OUT_DIR, "manifest.json"), manifest);

// 5. Parquet
const currentFile = join(OUT_DIR, parquetFor(date));
await writeParquet(entries.values(), currentFile);

// 6. Previous snapshot
const repository = process.env.GITHUB_REPOSITORY;
const previousFile = join(PREVIOUS_DIR, parquetFor(previousDate));
const hasPrevious =
  repository !== undefined &&
  (await downloadReleaseAsset(repository, tagFor(previousDate), parquetFor(previousDate), previousFile));

// 7. Delta
const delta = hasPrevious
  ? await compareSnapshots(previousFile, currentFile, { previous: previousDate, current: date })
  : null;
if (delta) await writeJson(join(OUT_DIR, "delta.json"), delta);
else console.warn(`No snapshot found for ${previousDate}, skipping delta.`);

// 8. Release notes (the workflow creates the release)
await writeFile(join(OUT_DIR, "notes.md"), renderNotes(manifest, delta));

if (process.env.GITHUB_OUTPUT) {
  await writeFile(process.env.GITHUB_OUTPUT, `tag=${tagFor(date)}\ndate=${date}\n`, { flag: "a" });
}
console.log(`Snapshot ${date}: ${entries.size} entries from ${pages} pages.`);
