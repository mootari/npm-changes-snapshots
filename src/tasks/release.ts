import { SNAPSHOT_FILE } from "../lib/schema.ts";
import { createDraftRelease, createOctokit, publishRelease, uploadReleaseAsset } from "../lib/github.ts";
import { readFile } from "node:fs/promises";
import { readParquetKvMetadata } from "../lib/duckdb.ts";
import { RunInfoSchema } from "../tasks/snapshot.ts";

export async function createRelease(options: {
  project: {owner: string, repo: string},
  token: string,
  snapshotPath: string,
  summaryPath: string,
  diffPath?: string
  draft?: boolean,
  signal?: AbortSignal
}) {
  const {project, token, snapshotPath, summaryPath, diffPath, draft, signal} = options;
  const octokit = createOctokit(token);
  const runInfo = await readParquetKvMetadata(snapshotPath, "run_info", RunInfoSchema);
  
  const time = new Date(runInfo.end_state.time);
  const tag = format(time, ({Y, m, d, H, M, S}) => `snapshot-${Y}${m}${d}${H}${M}${S}`);
  const title = `Snapshot ${format(time, ({Y, m, d, H, M}) => `${Y}-${m}-${d} ${H}:${M} UTC`)}`

  const notes = (await readFile(summaryPath)).toString();
  const release = await createDraftRelease(octokit, {...project, tag, title, notes, signal});

  const snapshotAsset = {name: SNAPSHOT_FILE, body: await readFile(snapshotPath)};
  await uploadReleaseAsset(octokit, {release, ...snapshotAsset, signal});
  
  if(diffPath) {
    const diffAsset = {name: "diff.parquet", body: await readFile(diffPath)};
    await uploadReleaseAsset(octokit, {release, ...diffAsset, signal});
  }

  if(!draft) await publishRelease(octokit, {release, signal});
}

function format(date: Date, apply: (parts: {[k in "Y" | "m" | "d" | "H" | "M" | "S"]: string}) => string) {
  const [Y, m, d, H, M, S] = date.toISOString().split(/[-T:.Z]/);
  return apply({Y, m, d, H, M, S});
}