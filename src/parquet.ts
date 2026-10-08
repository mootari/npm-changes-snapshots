import { DuckDBDataChunkWriter, DuckDBInstance, JSToDuckDBValueConverter } from "@duckdb/node-api";
import type { Entry } from "./feed.ts";

export type SnapshotRef = { tag: string; time: string };

/** Counts and rev number distribution of a snapshot. Rev numbers are null for an empty snapshot. */
export type Stats = {
  deleted_entries: number;
  not_deleted_entries: number;
  rev_min: number | null;
  rev_max: number | null;
  rev_p50: number | null;
  rev_p90: number | null;
  rev_p95: number | null;
  rev_p99: number | null;
};

export type Delta = {
  previous: SnapshotRef | null;
  current: SnapshotRef;
  previous_stats: Stats;
  current_stats: Stats;
  missing: number;
  added: number;
  updated_seq_changed: number;
  updated_seq_unchanged: number;
};

/** Writes entries ordered by id to a ZSTD-compressed Parquet file. */
export async function writeParquet(entries: Iterable<Entry>, path: string): Promise<void> {
  const connection = await (await DuckDBInstance.create()).connect();
  await connection.run(
    "CREATE TABLE entries (id VARCHAR, seq BIGINT, rev VARCHAR, deleted BOOLEAN, fetched_at TIMESTAMPTZ)",
  );
  const appender = await connection.createAppender("entries");
  const writer = DuckDBDataChunkWriter.forAppender(appender, { converter: JSToDuckDBValueConverter });
  for (const { id, seq, rev, deleted, fetched_at } of entries) {
    writer.appendRow([id, seq, rev, deleted, fetched_at]);
  }
  writer.flush();
  appender.closeSync();
  await connection.run("COPY (SELECT * FROM entries ORDER BY id) TO $path (FORMAT parquet, COMPRESSION zstd)", { path });
}

/** Rev numbers are the part of a rev before the hash, e.g. 12 for "12-abc". */
export async function computeStats(path: string): Promise<Stats> {
  const connection = await (await DuckDBInstance.create()).connect();
  const reader = await connection.runAndReadAll(
    `SELECT
      count(*) FILTER (WHERE deleted) AS deleted_entries,
      count(*) FILTER (WHERE NOT deleted) AS not_deleted_entries,
      min(n) AS rev_min,
      max(n) AS rev_max,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY n) AS rev_p50,
      percentile_disc(0.9) WITHIN GROUP (ORDER BY n) AS rev_p90,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY n) AS rev_p95,
      percentile_disc(0.99) WITHIN GROUP (ORDER BY n) AS rev_p99
    FROM (SELECT deleted, CAST(split_part(rev, '-', 1) AS BIGINT) AS n FROM read_parquet($path))`,
    { path },
  );
  const row = reader.getRowObjectsJson()[0];
  const num = (value: unknown) => (value === null ? null : Number(value));
  return {
    deleted_entries: Number(row.deleted_entries),
    not_deleted_entries: Number(row.not_deleted_entries),
    rev_min: num(row.rev_min),
    rev_max: num(row.rev_max),
    rev_p50: num(row.rev_p50),
    rev_p90: num(row.rev_p90),
    rev_p95: num(row.rev_p95),
    rev_p99: num(row.rev_p99),
  };
}

/**
 * Compares two snapshots by id. An id counts as updated without a seq change
 * when its seq is equal but its rev or deleted flag differs.
 */
export async function compareSnapshots(
  previousPath: string,
  currentPath: string,
  previous: SnapshotRef | null,
  current: SnapshotRef,
): Promise<Delta> {
  const connection = await (await DuckDBInstance.create()).connect();
  const reader = await connection.runAndReadAll(
    `SELECT
      count(*) FILTER (WHERE n.id IS NULL) AS missing,
      count(*) FILTER (WHERE o.id IS NULL) AS added,
      count(*) FILTER (WHERE o.seq <> n.seq) AS updated_seq_changed,
      count(*) FILTER (
        WHERE o.seq = n.seq AND (o.rev IS DISTINCT FROM n.rev OR o.deleted IS DISTINCT FROM n.deleted)
      ) AS updated_seq_unchanged
    FROM read_parquet($previousPath) o
    FULL OUTER JOIN read_parquet($currentPath) n ON o.id = n.id`,
    { previousPath, currentPath },
  );
  const row = reader.getRowObjectsJson()[0];
  return {
    previous,
    current,
    previous_stats: await computeStats(previousPath),
    current_stats: await computeStats(currentPath),
    missing: Number(row.missing),
    added: Number(row.added),
    updated_seq_changed: Number(row.updated_seq_changed),
    updated_seq_unchanged: Number(row.updated_seq_unchanged),
  };
}
