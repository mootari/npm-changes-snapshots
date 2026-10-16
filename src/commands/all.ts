import * as b from "@bomb.sh/router";
import type * as B from "@bomb.sh/router";
import { GithubProject, SNAPSHOT_FILE } from "../lib/schema.ts";
import * as v from "valibot";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, access, constants, writeFile, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createSnapshot } from "../tasks/snapshot.ts";
import { findBaseline } from "../tasks/baseline.ts";
import { createDiff } from "../tasks/diff.ts";
import { buildSummaryStats } from "../tasks/summary/stats.ts";
import { renderSummary } from "../tasks/summary/notes.ts";
import { fileSha256, sha256 } from "../lib/hash.ts";
import { createRelease } from "../tasks/release.ts";

export const command = b.command(
  b.name("all"),
  b.description("Runs all steps and optionally creates a release"),
  b.option(
    b.name("project"),
    b.env("GITHUB_REPOSITORY"),
    b.schema(v.optional(GithubProject))
  ),
  b.option(
    b.name("baseline"),
    b.schema(v.optional(v.string()))
  ),
  b.option(
    b.name("token"),
    b.env("GITHUB_TOKEN"),
    b.schema(v.optional(v.string()))
  ),
  b.toggle(
    b.name("publish"),
    b.description("Publish a release"),
  ),
  b.toggle(
    b.name("draft"),
    b.description("Create a draft release"),
    b.env("DRAFT")
  ),
);
type Model = B.ModelOf<typeof command>;

export async function execute(model: Model, {signal}: {signal: AbortSignal}) {
  const {project, token, baseline: customBaseline, publish, draft} = model;
  
  const dir = "out";
  await mkdir(dir, {recursive: true});
  const snapshotPath = join(dir, SNAPSHOT_FILE);

  info("Creating snapshot…");
  await reusePath("snapshot", snapshotPath, dest => createSnapshot(dest, {signal}));
  const runHash = (await fileSha256(snapshotPath)).slice(0, 8);

  let baseline: {path: string, hash: string} | undefined;
  // Note: DuckDB's httpfs extension doesn't cache redirects (e.g. in GH asset download URLs).
  // We save several seconds by querying the baseline snapshot locally instead.
  if(customBaseline) {
    if(await exists(customBaseline)) {
      const hash = (await fileSha256(customBaseline)).slice(0, 8);
      baseline = {hash, path: customBaseline};
    }
    else if(URL.canParse(customBaseline)) {
      const hash = sha256(customBaseline).slice(0, 8);
      const path = join(dir, `baseline-${hash}.parquet`);
      await reusePath("baseline", path, dest => downloadSnapshot(customBaseline, dest, signal));
      baseline = {hash, path};
    }
    else {
      throw new Error("Invalid baseline argument");
    }
  }
  else if(project) {
    info("Querying baseline…");
    try {
      const meta = await findBaseline(project, {token, signal});
      info(`Using baseline ${meta.tag} (${meta.created})…`);
      const hash = meta.sha256?.slice(0, 8) ?? String(meta.id);
      const path = join(dir, `baseline-${hash}.parquet`);
      await reusePath("baseline", path, dest => downloadSnapshot(meta.download_url, dest, signal));
      baseline = {hash, path};
    }
    catch(error) {
      signal?.throwIfAborted();
      console.warn(`No compatible baseline snapshot found: ${(error as Error).message}`);
    }
  }

  let diffPath: string | undefined;
  if(baseline) {
    info("Creating diff…");
    diffPath = join(dir, `diff-${baseline.hash}-${runHash}.parquet`);
    await reusePath("diff", diffPath, dest => createDiff(baseline.path, snapshotPath, dest, {signal}));
  }

  info(`Creating summary…`);
  const summaryPath = join(dir, `summary-${baseline?.hash ?? ""}-${runHash}.md`);
  await reusePath("summary", summaryPath, async dest => {
    const stats = await buildSummaryStats(snapshotPath, {baselinePath: baseline?.path, diffPath, signal});
    const summary = renderSummary(stats);
    await writeFile(dest, summary);
  });

  if(publish) {
    if(!project) throw new Error("project is required to create a release");
    if(!token) throw new Error("token is required to create a release");
    info(`Creating release…`);
    await createRelease({project, token, snapshotPath, diffPath, summaryPath, draft, signal});
  }
}

async function downloadSnapshot(url: string, dest: string, signal?: AbortSignal) {
  const {ok, body, status} = await fetch(url, {signal});
  if(!ok || !body) throw new Error(`Could not fetch baseline snapshot (${status})`);
  await pipeline(Readable.fromWeb(body), createWriteStream(dest), {signal});
}

function info(msg: string) {
  process.stderr.write(`${msg}\n`);
}

async function exists(path: string) {
  return await access(path, constants.R_OK).then(() => true).catch(() => false);
}

async function reusePath<T extends string>(label: string, path: T, run: (dest: NoInfer<T>) => unknown) {
  if(await exists(path)) {
    info(`Found existing ${label}: ${path}`);
    return;
  }
  try {
    await run(path);
    info(`Created ${label}: ${path}`);
  }
  catch(error) {
    await rm(path, {force: true});
    info(`Encountered error while creating ${label}:`);
    throw error;
  }
}
