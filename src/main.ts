import { getHeapStatistics } from "node:v8";
import { mkdir, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { join } from "node:path";
import { parseConfig } from "./config.ts";
import { fetchChanges, fetchFeedState } from "./feed.ts";
import { createOctokit, createRelease, downloadLatestAsset } from "./github.ts";
import { renderNotes, type Manifest } from "./notes.ts";
import { compareSnapshots, writeParquet } from "./parquet.ts";

const config = parseConfig(process.env);
const OUT_DIR = config.outDir;
const PREVIOUS_DIR = join(OUT_DIR, "previous");
const SNAPSHOT_FILE = "changes.parquet";

const tagFor = (date: string) => `snapshot-${date}`;

const MiB = (bytes: number) => `${(bytes / 2 ** 20).toFixed(0)} MiB`;

function logMemory(label: string): void {
  const { heapUsed, rss } = process.memoryUsage();
  const heapLimit = getHeapStatistics().heap_size_limit;
  const systemLimit = process.constrainedMemory() || totalmem();
  const heap = `${MiB(heapUsed)} / ${MiB(heapLimit)} (${(heapUsed / heapLimit * 100).toFixed(1)}%)`;
  const system = `${MiB(rss)} / ${MiB(systemLimit)} (${(rss / systemLimit * 100).toFixed(1)}%)`;
  console.log(`Memory ${label}: heap ${heap}, rss ${system}`);
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}

await mkdir(PREVIOUS_DIR, { recursive: true });

// 1. Start state
const start = await fetchFeedState(config.feedUrl);
const date = start.time.slice(0, 10);

// 2. Changes
logMemory("before fetch");
const { entries, pages, fetchedEntries } = await fetchChanges(start.state.update_seq, config.changesUrl);
logMemory("after fetch");

// 3. Final state
const final = await fetchFeedState(config.feedUrl);

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
const { repository, draft } = config;
const octokit = createOctokit(config.token);
const previousFile = join(PREVIOUS_DIR, SNAPSHOT_FILE);
const previous = repository ? await downloadLatestAsset(octokit, repository, SNAPSHOT_FILE, previousFile) : null;
if (!previous) {
  console.warn("No previous snapshot found, comparing against an empty dataset.");
  await writeParquet([], previousFile);
}

// 7. Delta
const delta = await compareSnapshots(previousFile, currentFile, previous, { tag: tagFor(date), time: start.time });
const deltaFile = join(OUT_DIR, "delta.json");
await writeJson(deltaFile, delta);

// 8. Release
const notes = renderNotes(manifest, delta);
await writeFile(join(OUT_DIR, "notes.md"), notes);
if (repository) {
  await createRelease(
    octokit,
    repository,
    { tag: tagFor(date), title: `npm changes snapshot ${date}`, notes, draft },
    [currentFile, manifestFile, deltaFile],
  );
} else {
  console.warn("GITHUB_REPOSITORY is not set, skipping release.");
}

console.log(`Snapshot ${date}: ${entries.size} entries from ${pages} pages.`);
