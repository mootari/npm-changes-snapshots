import { getHeapStatistics } from "node:v8";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as v from "valibot";
import { parseConfig } from "./config.ts";
import { fetchChanges, fetchFeedState } from "./feed.ts";
import { createOctokit, createRelease, downloadLatestAssets } from "./github.ts";
import { ManifestSchema, renderNotes, type Manifest } from "./notes.ts";
import { compareSnapshots, computeStats, diffStats, writeParquet } from "./parquet.ts";

const config = parseConfig(process.env);
const OUT_DIR = config.outDir;
const PREVIOUS_DIR = join(OUT_DIR, "previous");
const SNAPSHOT_FILE = "changes.parquet";
const MANIFEST_FILE = "manifest.json";

const MiB = (bytes: number) => `${(bytes / 2 ** 20).toFixed(0)} MiB`;

function logMemory(label: string): void {
  const { heapUsed, rss } = process.memoryUsage();
  const heapLimit = getHeapStatistics().heap_size_limit;
  console.log(
    `Memory ${label}: heap ${MiB(heapUsed)} / ${MiB(heapLimit)} (${(heapUsed / heapLimit * 100).toFixed(1)}%), ` +
      `rss ${MiB(rss)}`,
  );
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data) + "\n");
}

await mkdir(PREVIOUS_DIR, { recursive: true });

// 1. Start state
const start = await fetchFeedState(config.feedUrl);
const formattedTime = start.time.slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
const tag = `snapshot-${formattedTime}`;

// 2. Changes
logMemory("before fetch");
const { entries, pages, fetchedEntries } = await fetchChanges(start.state.update_seq, config.changesUrl);
logMemory("after fetch");

// 3. Final state
const final = await fetchFeedState(config.feedUrl);

// 4. Parquet
const currentFile = join(OUT_DIR, SNAPSHOT_FILE);
await writeParquet(entries.values(), currentFile);

// 5. Manifest
const manifest: Manifest = {
  start,
  final,
  pages,
  fetched_entries: fetchedEntries,
  stored_entries: entries.size,
  stats: await computeStats(currentFile),
};
const manifestFile = join(OUT_DIR, MANIFEST_FILE);
await writeJson(manifestFile, manifest);

// 6. Previous snapshot
const { repository, draft } = config;
const octokit = createOctokit(config.token);
const previousFile = join(PREVIOUS_DIR, SNAPSHOT_FILE);
const previousManifestFile = join(PREVIOUS_DIR, MANIFEST_FILE);
const previous = repository
  ? await downloadLatestAssets(octokit, repository, {
      [SNAPSHOT_FILE]: previousFile,
      [MANIFEST_FILE]: previousManifestFile,
    })
  : null;
if (!previous) {
  console.warn("No previous snapshot found, comparing against an empty dataset.");
  await writeParquet([], previousFile);
}

// 7. Delta
// The previous manifest is missing without a previous snapshot, or unreadable if it predates the current format.
// Missing values count as 0.
const previousParsed = previous
  ? v.safeParse(ManifestSchema, JSON.parse(await readFile(previousManifestFile, "utf8")))
  : null;
const previousManifest = previousParsed?.success ? previousParsed.output : null;
const statsDelta = diffStats(previousManifest?.stats ?? null, manifest.stats);
const delta = await compareSnapshots(previousFile, currentFile, previous, { tag, time: start.time }, statsDelta);
const deltaFile = join(OUT_DIR, "delta.json");
await writeJson(deltaFile, delta);

// 8. Release
const notes = renderNotes(manifest, delta, previousManifest);
await writeFile(join(OUT_DIR, "notes.md"), notes);
if (repository) {
  await createRelease(
    octokit,
    repository,
    { tag, title: `Snapshot ${formattedTime}`, notes, draft },
    [currentFile, manifestFile, deltaFile],
  );
} else {
  console.warn("GITHUB_REPOSITORY is not set, skipping release.");
}

console.log(`Snapshot ${formattedTime}: ${entries.size} entries from ${pages} pages.`);
