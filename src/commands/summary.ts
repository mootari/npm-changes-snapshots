import * as b from "@bomb.sh/router";
import type * as B from "@bomb.sh/router";
import * as v from "valibot";
import { ParquetPath } from "../lib/schema.ts";
import { buildSummaryStats } from "../tasks/summary/stats.ts";
import { renderSummary } from "../tasks/summary/notes.ts";
import { writeFile } from "node:fs/promises";

export const command = b.command(
  b.name("summary"),
  b.description("Generates statistics and release notes"),
  b.option(
    b.name("snapshot"),
    b.description("(required) Snapshot Parquet path"),
    b.schema(ParquetPath)
  ),
  b.option(
    b.name("dest"),
    b.description("(required) Output path"),
    b.schema(v.pipe(v.string(), v.endsWith(".md")))
  ),
  b.option(
    b.name("baseline"),
    b.description("Baseline Parquet path"),
    b.schema(v.optional(ParquetPath))
  ),
  b.option(
    b.name("diff"),
    b.description("Diff Parquet path"),
    b.schema(v.optional(ParquetPath))
  ),
);
type Model = B.ModelOf<typeof command>;

export async function execute(model: Model, {signal}: {signal: AbortSignal}) {
  const {
    snapshot: snapshotPath,
    baseline: baselinePath,
    diff: diffPath,
    dest
  } = model;
  const stats = await buildSummaryStats(snapshotPath, {baselinePath, diffPath, signal});
  const summary = renderSummary(stats);
  await writeFile(dest, summary);
}
