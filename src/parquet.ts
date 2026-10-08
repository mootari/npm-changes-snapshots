import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { promisify } from "node:util";
import type { Entry } from "./feed.ts";

const run = promisify(execFile);
const DUCKDB = process.env.DUCKDB ?? "duckdb";

function quote(path: string): string {
  return `'${path.replaceAll("'", "''")}'`;
}

async function duckdb(sql: string, json = false): Promise<string> {
  const args = [":memory:", ...(json ? ["-json"] : []), "-c", sql];
  const { stdout } = await run(DUCKDB, args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function writeNdjson(entries: Iterable<Entry>, path: string): Promise<void> {
  const stream = createWriteStream(path);
  let chunk = "";
  for (const entry of entries) {
    chunk += JSON.stringify(entry) + "\n";
    if (chunk.length >= 1 << 20) {
      if (!stream.write(chunk)) await once(stream, "drain");
      chunk = "";
    }
  }
  stream.end(chunk);
  await once(stream, "finish");
}

/** Writes entries ordered by id to a ZSTD-compressed Parquet file using the DuckDB CLI. */
export async function writeParquet(entries: Iterable<Entry>, path: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "snapshot-"));
  try {
    const ndjson = join(dir, "entries.ndjson");
    await writeNdjson(entries, ndjson);
    await duckdb(`
      COPY (
        SELECT id, seq, rev, deleted, fetched_at
        FROM read_json(${quote(ndjson)}, format = 'newline_delimited', columns = {
          id: 'VARCHAR', seq: 'BIGINT', rev: 'VARCHAR', deleted: 'BOOLEAN', fetched_at: 'TIMESTAMPTZ'
        })
        ORDER BY id
      ) TO ${quote(path)} (FORMAT parquet, COMPRESSION zstd)
    `);
  } finally {
    await rm(dir, { recursive: true, force: true });
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
  const output = await duckdb(
    `
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
  `,
    true,
  );
  const row = JSON.parse(output)[0] as Record<string, number>;
  return {
    previous_snapshot: labels.previous,
    current_snapshot: labels.current,
    missing: Number(row.missing),
    added: Number(row.added),
    updated_seq_changed: Number(row.updated_seq_changed),
    updated_seq_unchanged: Number(row.updated_seq_unchanged),
  };
}
