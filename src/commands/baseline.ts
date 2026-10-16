import * as b from "@bomb.sh/router";
import type * as B from "@bomb.sh/router";
import * as v from "valibot";
import { GithubProject, SNAPSHOT_FILE } from "../lib/schema.ts";
import { findBaseline } from "../tasks/baseline.ts";

export const command = b.command(
  b.name("baseline"),
  b.description("Returns the download URL for a previously released snapshot"),
  b.option(
    b.name("project"),
    b.description("(required) GitHub project owner/repo"),
    b.schema(GithubProject)
  ),
  b.option(
    b.name("tag"),
    b.description("Release tag; defaults to latest release"),
    b.schema(v.optional(v.string())),
  ),
  b.option(
    b.name("name"),
    b.description(`Snapshot asset name; defaults to "${SNAPSHOT_FILE}"`),
    b.schema(v.optional(v.string(), SNAPSHOT_FILE)),
  ),
  b.option(
    b.name("token"),
    b.description("GitHub token"),
    b.env("GITHUB_TOKEN"),
    b.schema(v.optional(v.string())),
  ),
  b.toggle(
    b.name("skipMetadata"),
    b.description("Don't validate a snapshot's run info"),
  )
);
type Model = B.ModelOf<typeof command>;

export async function execute(model: Model, {signal}: {signal: AbortSignal}) {
  const {project, token, tag, name: assetName, skipMetadata} = model;
  const baseline = await findBaseline(project, {tag, assetName, skipMetadata, token, signal});

  process.stderr.write(`Found release ${baseline.tag} (created ${baseline.created})\n`);
  process.stdout.write(baseline.download_url);
}
