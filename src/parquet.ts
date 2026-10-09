import { DuckDBDataChunkWriter, DuckDBInstance, JSToDuckDBValueConverter } from "@duckdb/node-api";
import * as v from "valibot";
import type { Entry } from "./feed.ts";
import { StatsSchema } from "./types.ts";
import type { Stats } from "./types.ts";

export async function writeParquet(entries: Iterable<Entry>, path: string): Promise<void> {
  const connection = await (await DuckDBInstance.create()).connect();
  await connection.run(
    `
      CREATE TABLE entries (
        id VARCHAR,
        seq INT,
        rev VARCHAR,
        rev_num INT,
        deleted BOOLEAN,
        fetched_at TIMESTAMPTZ
      )
    `
  );
  const appender = await connection.createAppender("entries");
  const writer = DuckDBDataChunkWriter.forAppender(appender, { converter: JSToDuckDBValueConverter });
  for (const { id, seq, rev, rev_num, deleted, fetched_at } of entries) {
    writer.appendRow([id, seq, rev, rev_num, deleted, fetched_at]);
  }
  writer.flush();
  appender.closeSync();
  // Order by id to improve compression ratio. 16 is the sweet spot with actual size gains.
  await connection.run(
    `
      COPY (
        SELECT * FROM entries ORDER BY id
      ) TO $path (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 16)
    `,
    { path }
  );
}

export async function computeStats(path: string): Promise<Stats> {
  const connection = await (await DuckDBInstance.create()).connect();
  const reader = await connection.runAndReadAll(
    `
      SELECT
        1 AS '$schema_version',
        count(*)::DOUBLE AS total,
        (count(*) FILTER (WHERE deleted))::DOUBLE AS deleted,
        {
          'min': min(n),
          'max': max(n),
          'p50': quantile_disc(n, 0.5),
          'p90': quantile_disc(n, 0.9),
          'p95': quantile_disc(n, 0.95),
          'p99': quantile_disc(n, 0.99),
          'sum': sum(n)::DOUBLE,
          'sumsq': sum(n::DOUBLE * n), -- currently 38 bits
        } as rev_num,
      FROM (SELECT deleted, rev_num AS n FROM read_parquet($path))
    `,
    { path },
  );
  return v.parse(StatsSchema, reader.getRowObjectsJson()[0]);
}

export async function compareSnapshots(
  previousPath: string,
  currentPath: string,
) {
  const connection = await (await DuckDBInstance.create()).connect();
  const reader = await connection.runAndReadAll(
    `
      SELECT
        (count(*) FILTER (WHERE p.id IS NULL))::DOUBLE AS added,
        (count(*) FILTER (WHERE c.id IS NULL))::DOUBLE AS dropped,
        (count(*) FILTER (WHERE c.seq > p.seq))::DOUBLE AS updated,
        (count(*) FILTER (
          WHERE c.seq < p.seq OR (
            c.seq = p.seq AND (
              c.rev IS DISTINCT FROM p.rev OR
              c.deleted IS DISTINCT FROM p.deleted
            )
          )
        ))::DOUBLE AS drifted
      FROM read_parquet($previousPath) p
      FULL OUTER JOIN read_parquet($currentPath) c USING (id)
    `,
    { previousPath, currentPath },
  );
  type Row = {added: number, dropped: number, updated: number, drifted: number};
  return reader.getRowObjectsJson()[0] as Row;
}
