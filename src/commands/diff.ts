import * as b from "@bomb.sh/router";
import type * as B from "@bomb.sh/router";
import { ParquetPath } from "../lib/schema.ts";
import { createDiff } from "../tasks/diff.ts";

export const command = b.command(
  b.name("diff"),
  b.description("Saves the differences between two snapshots to a Parquet file"),
  b.option(
    b.name("left"),
    b.description("(required) baseline path"),
    b.schema(ParquetPath)
  ),
  b.option(
    b.name("right"),
    b.description("(required) snapshot path"),
    b.schema(ParquetPath)
  ),
  b.option(
    b.name("dest"),
    b.description("(required) diff output path"),
    b.schema(ParquetPath)
  ),
);
type Model = B.ModelOf<typeof command>;

export async function execute(model: Model, {signal}: {signal: AbortSignal}) {
  const {left, right, dest} = model;
  const counts = await createDiff(left, right, dest, {signal});
  process.stderr.write(`Diff created:\n${JSON.stringify(counts, null, 2)}`);
}
