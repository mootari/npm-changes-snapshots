import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchChanges, fetchFeedState } from "./feed.ts";
import { createRelease, downloadLatestAsset } from "./github.ts";
import { renderNotes, type Manifest } from "./notes.ts";
import { compareSnapshots, writeParquet } from "./parquet.ts";

const OUT_DIR = process.env.OUT_DIR ?? "out";
const PREVIOUS_DIR = join(OUT_DIR, "previous");
const FEED_URL = process.env.FEED_URL;
const CHANGES_URL = FEED_URL && new URL("registry/_changes", FEED_URL).href;
const SNAPSHOT_FILE = "changes.parquet";

const tagFor = (date: string) => `snapshot-${date}`;

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}

await mkdir(PREVIOUS_DIR, { recursive: true });

// 1. Start state
const start = await fetchFeedState(FEED_URL);
const date = start.time.slice(0, 10);

// 2. Changes
const { entries, pages, fetchedEntries } = await fetchChanges(start.state.update_seq, CHANGES_URL);

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
const manifestFile = join(OUT_DIR, "manifest.json");
await writeJson(manifestFile, manifest);

// 5. Parquet
const currentFile = join(OUT_DIR, SNAPSHOT_FILE);
await writeParquet(entries.values(), currentFile);

// 6. Previous snapshot
const repository = process.env.GITHUB_REPOSITORY;
const previousFile = join(PREVIOUS_DIR, SNAPSHOT_FILE);
const previousTag = repository ? await downloadLatestAsset(repository, SNAPSHOT_FILE, previousFile) : null;

// 7. Delta
const delta = previousTag
  ? await compareSnapshots(previousFile, currentFile, { previous: previousTag, current: tagFor(date) })
  : null;
const deltaFile = join(OUT_DIR, "delta.json");
if (delta) await writeJson(deltaFile, delta);
else console.warn("No previous snapshot found, skipping delta.");

// 8. Release
const notes = renderNotes(manifest, delta);
await writeFile(join(OUT_DIR, "notes.md"), notes);
if (repository) {
  await createRelease(
    repository,
    { tag: tagFor(date), title: `npm changes snapshot ${date}`, notes },
    [currentFile, manifestFile, ...(delta ? [deltaFile] : [])],
  );
} else {
  console.warn("GITHUB_REPOSITORY is not set, skipping release.");
}

console.log(`Snapshot ${date}: ${entries.size} entries from ${pages} pages.`);
