import { DuckDBInstance } from "@duckdb/node-api";
import type { Entry } from "./feed.ts";

function quote(path: string): string {
  return `'${path.replaceAll("'", "''")}'`;
}

/** Writes entries ordered by id to a ZSTD-compressed Parquet file. */
export async function writeParquet(entries: Iterable<Entry>, path: string): Promise<void> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    await connection.run(
      "CREATE TABLE entries (id VARCHAR, seq BIGINT, rev VARCHAR, deleted BOOLEAN, fetched_at VARCHAR)",
    );
    const appender = await connection.createAppender("entries");
    for (const entry of entries) {
      appender.appendVarchar(entry.id);
      appender.appendBigInt(BigInt(entry.seq));
      if (entry.rev === null) appender.appendNull();
      else appender.appendVarchar(entry.rev);
      appender.appendBoolean(entry.deleted);
      appender.appendVarchar(entry.fetched_at);
      appender.endRow();
    }
    appender.closeSync();
    await connection.run(
      `COPY (
        SELECT id, seq, rev, deleted, CAST(fetched_at AS TIMESTAMPTZ) AS fetched_at
        FROM entries ORDER BY id
      ) TO ${quote(path)} (FORMAT parquet, COMPRESSION zstd)`,
    );
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

export interface Delta {
  previous_snapshot: string;
  current_snapshot: string;
  missing: number;
  added: number;
  updated_seq_changed: number;
  updated_seq_unchanged: number;
}

/**
 * Compares two snapshots by id. An id counts as updated without a seq change
 * when its seq is equal but its rev or deleted flag differs.
 */
export async function compareSnapshots(
  previousPath: string,
  currentPath: string,
  labels: { previous: string; current: string },
): Promise<Delta> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(`
      SELECT
        count(*) FILTER (WHERE n.id IS NULL) AS missing,
        count(*) FILTER (WHERE o.id IS NULL) AS added,
        count(*) FILTER (WHERE o.id IS NOT NULL AND n.id IS NOT NULL AND o.seq <> n.seq) AS updated_seq_changed,
        count(*) FILTER (
          WHERE o.id IS NOT NULL AND n.id IS NOT NULL AND o.seq = n.seq
            AND (o.rev IS DISTINCT FROM n.rev OR o.deleted IS DISTINCT FROM n.deleted)
        ) AS updated_seq_unchanged
      FROM read_parquet(${quote(previousPath)}) o
      FULL OUTER JOIN read_parquet(${quote(currentPath)}) n ON o.id = n.id
    `);
    const row = reader.getRowObjectsJson()[0] as Record<string, string | number | null>;
    return {
      previous_snapshot: labels.previous,
      current_snapshot: labels.current,
      missing: Number(row.missing),
      added: Number(row.added),
      updated_seq_changed: Number(row.updated_seq_changed),
      updated_seq_unchanged: Number(row.updated_seq_unchanged),
    };
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
