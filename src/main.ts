import { getHeapStatistics } from "node:v8";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { parseConfig } from "./config.ts";
import { fetchChanges, fetchFeedState } from "./feed.ts";
import { createOctokit, createRelease, downloadLatestAssets } from "./github.ts";
import { renderNotes, type Manifest } from "./notes.ts";
import { compareSnapshots, computeStats, diffStats, StatsSchema, writeParquet, type Stats } from "./parquet.ts";

const config = parseConfig(process.env);
const OUT_DIR = config.outDir;
const PREVIOUS_DIR = join(OUT_DIR, "previous");
const SNAPSHOT_FILE = "changes.parquet";
const MANIFEST_FILE = "manifest.json";

const MiB = (bytes: number) => `${(bytes / 2 ** 20).toFixed(0)} MiB`;

function logMemory(label: string): void {
  const { heapUsed, rss } = process.memoryUsage();
  const heapLimit = getHeapStatistics().heap_size_limit;
  const systemLimit = process.constrainedMemory() || totalmem();
  console.log(
    `Memory ${label}: heap ${MiB(heapUsed)} / ${MiB(heapLimit)} (${(heapUsed / heapLimit * 100).toFixed(1)}%), ` +
      `rss ${MiB(rss)} / ${MiB(systemLimit)} (${(rss / systemLimit * 100).toFixed(1)}%)`,
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
// Without a previous snapshot the stats are compared against an empty dataset. Releases made before
// stats were added to the manifest have no previous stats to compare against.
const emptyStats: Stats = {
  deleted_entries: 0,
  not_deleted_entries: 0,
  rev_min: null,
  rev_max: null,
  rev_p50: null,
  rev_p90: null,
  rev_p95: null,
  rev_p99: null,
};
const previousManifest = previous
  ? v.safeParse(v.object({ stats: StatsSchema }), JSON.parse(await readFile(previousManifestFile, "utf8")))
  : null;
const previousStats = previousManifest ? (previousManifest.success ? previousManifest.output.stats : null) : emptyStats;
const statsDelta = previousStats ? diffStats(previousStats, manifest.stats) : null;
const delta = await compareSnapshots(previousFile, currentFile, previous, { tag, time: start.time }, statsDelta);
const deltaFile = join(OUT_DIR, "delta.json");
await writeJson(deltaFile, delta);

// 8. Release
const notes = renderNotes(manifest, delta);
await writeFile(join(OUT_DIR, "notes.md"), notes);
if (repository) {
  await createRelease(
    octokit,
    repository,
    { tag, title: `npm changes snapshot ${formattedTime}`, notes, draft },
    [currentFile, manifestFile, deltaFile],
  );
} else {
  console.warn("GITHUB_REPOSITORY is not set, skipping release.");
}

console.log(`Snapshot ${formattedTime}: ${entries.size} entries from ${pages} pages.`);
