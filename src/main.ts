import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseConfig } from "./config.ts";
import { createOctokit, createRelease, downloadAsset, fetchLatestRelease } from "./lib/github.ts";
import { renderNotes as renderReleaseNotes, type ReleaseMeta } from "./tasks/notes.ts";
import { createSnapshot, RunInfoSchema, type RunInfo } from "./tasks/snapshot.ts";
import { createDiff } from "./tasks/diff.ts";
import { buildDiffStats, buildSnapshotStats, type SnapshotStats } from "./tasks/stats.ts";
import { readParquetKvMetadata } from "./lib/duckdb.ts";

const controller = new AbortController();
const signal = controller.signal;
process.on("SIGINT", () => {
  controller.abort();
  process.exit();
});

const config = parseConfig(process.env);
const SNAPSHOT_FILE = "snapshot.parquet";
const { repository, draft } = config;
const octokit = createOctokit(config.token);

const assetDir = join(config.outDir, "assets");
const snapshotPath = join(assetDir, SNAPSHOT_FILE);
const diffPath = join(assetDir, "diff.parquet");
await mkdir(assetDir, { recursive: true });

const runInfo = await createSnapshot(snapshotPath, {signal});
const snapshotStats = await buildSnapshotStats(snapshotPath);

// Fetch the previous snapshot
const baselinePath = await (async() => {
  if(!repository) return null;

  const release = repository ? await fetchLatestRelease(octokit, repository) : null;
  if(!release) return null;

  const assetId = release.assetIds[SNAPSHOT_FILE];
  if(!assetId) return null;

  const dir = join(config.outDir, "baseline");
  await mkdir(dir, { recursive: true });

  const dest = join(dir, SNAPSHOT_FILE);
  await downloadAsset(octokit, {...repository, id: assetId, dest, signal: controller.signal});

  return dest;
})();

const baselineInfo = !baselinePath ? null : await readParquetKvMetadata(baselinePath, "run_info", RunInfoSchema);
const baselineStats = !baselinePath ? null : await buildSnapshotStats(baselinePath);

const diffStats: ReleaseMeta["diff"] = !baselinePath ? null : {
  ...await createDiff(baselinePath, snapshotPath, diffPath),
  ...await buildDiffStats(diffPath, {signal}),
};

// Create the release
const formattedTime = runInfo.start_state.time.slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
const tag = `snapshot-${formattedTime}`;
const releaseNotes = renderReleaseNotes({
  current: {
    run: runInfo,
    stats: snapshotStats
  },
  baseline: (baselineInfo && baselineStats) ? {
    run: baselineInfo,
    stats: baselineStats
  } : null,
  diff: diffStats,
});
if (repository) {
  await createRelease(
    octokit,
    repository,
    { tag, title: `Snapshot ${formattedTime}`, notes: releaseNotes, draft },
    [snapshotPath, ...diffStats ? [diffPath] : []],
  );
} else {
  await writeFile(join(config.outDir, "release-notes.md"), releaseNotes);
  console.warn("GITHUB_REPOSITORY is not set, skipping release.");
}

console.log(`Snapshot ${formattedTime}: ${snapshotStats.total} entries from ${runInfo.fetched_pages} pages.`);
