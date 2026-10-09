import { getHeapStatistics } from "node:v8";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as v from "valibot";
import { parseConfig } from "./config.ts";
import { fetchChanges, fetchFeedState } from "./feed.ts";
import { createOctokit, createRelease, downloadLatestAssets } from "./github.ts";
import { renderNotes as renderReleaseNotes } from "./notes.ts";
import { compareSnapshots, computeStats, writeParquet } from "./parquet.ts";
import { DeltaSchema, ManifestSchema } from "./types.ts";
import type { Delta, Manifest } from "./types.ts";

const config = parseConfig(process.env);
const SNAPSHOT_FILE = "snapshot.parquet";
const MANIFEST_FILE = "manifest.json";

const baselineDir = join(config.outDir, "previous");
await mkdir(baselineDir, { recursive: true });
const baselineAssetPaths = {
  snapshot: join(baselineDir, SNAPSHOT_FILE),
  manifest: join(baselineDir, MANIFEST_FILE),
};
const assetPaths = {
  snapshot: join(config.outDir, SNAPSHOT_FILE),
  manifest: join(config.outDir, MANIFEST_FILE),
  delta: join(config.outDir, "delta.json"),
};

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

// Fetch the changes feed.
// To keep our code simple we populate the DuckDBInstance separately, at the cost
// of increased memory usage.
const startState = await fetchFeedState(config.feedUrl);
logMemory("before fetch");
const { entries, pages, fetchedEntries } = await fetchChanges({url: config.changesUrl, maxPages: config.maxPages ?? undefined});
logMemory("after fetch");
const endState = await fetchFeedState(config.feedUrl);

// Create the Parquet file
await writeParquet(entries.values(), assetPaths.snapshot);

// Write the manifest
const manifest: Manifest = {
  "$schema_version": 1,
  start_state: startState,
  end_state: endState,
  pages,
  fetched_entries: fetchedEntries,
  distinct_entries: entries.size,
  stats: await computeStats(assetPaths.snapshot),
};
await writeJson(assetPaths.manifest, manifest);

// Fetch the previous snapshot
const { repository, draft } = config;
const octokit = createOctokit(config.token);
const previousRelease = repository
  ? await downloadLatestAssets(octokit, repository, {
      [SNAPSHOT_FILE]: baselineAssetPaths.snapshot,
      [MANIFEST_FILE]: baselineAssetPaths.manifest,
    })
  : null;
if (!previousRelease) {
  console.warn("No previous snapshot found, comparing against an empty dataset.");
  await writeParquet([], baselineAssetPaths.snapshot);
}

// Compute the delta.
// If no prior release was found all values will be compared against an empty dataset.
const previousManifest = previousRelease
  ? v.parse(ManifestSchema, JSON.parse(await readFile(baselineAssetPaths.manifest, "utf8")))
  : null;
const delta = v.parse(DeltaSchema, {
  "$schema_version": 1,
  baseline: previousRelease,
  ...await compareSnapshots(baselineAssetPaths.snapshot, assetPaths.snapshot),
} satisfies Delta);
await writeJson(assetPaths.delta, delta);

// Create the release
const formattedTime = startState.time.slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
const tag = `snapshot-${formattedTime}`;
const releaseNotes = renderReleaseNotes({current: manifest, baseline: previousManifest, delta});
if (repository) {
  await createRelease(
    octokit,
    repository,
    { tag, title: `Snapshot ${formattedTime}`, notes: releaseNotes, draft },
    [assetPaths.snapshot, assetPaths.manifest, assetPaths.delta],
  );
} else {
  await writeFile(join(config.outDir, "release-notes.md"), releaseNotes);
  console.warn("GITHUB_REPOSITORY is not set, skipping release.");
}

console.log(`Snapshot ${formattedTime}: ${entries.size} entries from ${pages} pages.`);
