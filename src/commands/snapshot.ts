import { createSnapshot } from "./../tasks/snapshot.ts";
import * as b from "@bomb.sh/router";
import type * as B from "@bomb.sh/router";
import { ParquetPath } from "../lib/schema.ts";

export const command = b.command(
  b.name("snapshot"),
  b.description("Fetches the entire npm changes feed and save the result to a Parquet file"),
  b.option(
    b.name("dest"),
    b.description("(required) output path"),
    b.schema(ParquetPath)
  )
);
type Model = B.ModelOf<typeof command>;

export async function execute(model: Model, {signal}: {signal: AbortSignal}) {
  const {dest} = model;
  const runInfo = await createSnapshot(dest, {signal});
  process.stderr.write(`Snapshot created:\n${JSON.stringify(runInfo, null, 2)}\n`);
}
