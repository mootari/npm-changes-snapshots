import * as b from "@bomb.sh/router";
import type * as B from "@bomb.sh/router";
import * as v from "valibot";
import { GithubProject, ParquetPath } from "../lib/schema.ts";
import { createRelease } from "../tasks/release.ts";

export const command = b.command(
  b.name("release"),
  b.description("Creates a new release"),
  b.option(
    b.name("project"),
    b.description("(required) GitHub project owner/repo"),
    b.schema(GithubProject)
  ),
  b.option(
    b.name("token"),
    b.description("(required) GitHub token"),
    b.env("GITHUB_TOKEN"),
    b.schema(v.string())
  ),
  b.option(
    b.name("snapshot"),
    b.description("(required) Snapshot Parquet path"),
    b.schema(ParquetPath)
  ),
  b.option(
    b.name("summary"),
    b.description("(required) Summary Markdown path"),
    b.schema(v.pipe(v.string(), v.endsWith(".md")))
  ),
  b.option(
    b.name("diff"),
    b.description("Diff Parquet path"),
    b.schema(v.optional(ParquetPath))
  ),
  b.toggle(
    b.name("draft"),
  ),
);
type Model = B.ModelOf<typeof command>;

export async function execute(model: Model, {signal}: {signal: AbortSignal}) {
  const {project, token, snapshot, diff, summary, draft} = model;
  await createRelease({
    project,
    token,
    snapshotPath: snapshot,
    diffPath: diff,
    summaryPath: summary,
    draft,
    signal
  });
}
