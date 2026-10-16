import { queryColumn, queryRow, readParquetKvMetadata, withMemoryDb } from "../../lib/duckdb.ts";
import * as v from "valibot";
import type {InferOutput} from "valibot";
import { UInt53 } from "../../lib/schema.ts";
import { deriveSignal } from "../../lib/abort.ts";
import { DiffInfoSchema, queryStatusCounts } from "../diff.ts";
import { RunInfoSchema } from "../snapshot.ts";
import type { ReleaseMeta } from "./notes.ts";

const SnapshotStatsSchema = v.strictObject({
  total: UInt53,
  deleted: UInt53,
  rev: v.strictObject({
    min: UInt53,
    max: UInt53,
    p50: UInt53,
    p90: UInt53,
    p95: UInt53,
    p99: UInt53,
    sum: UInt53,
    sumsq: UInt53,
  }),
});
export type SnapshotStats = InferOutput<typeof SnapshotStatsSchema>;

export async function buildSummaryStats(snapshotPath: string, {baselinePath, diffPath, signal}: {
  baselinePath?: string | null,
  diffPath?: string | null,
  signal?: AbortSignal
} = {}): Promise<ReleaseMeta> {
  const current = {
    run: await readParquetKvMetadata(snapshotPath, "run_info", RunInfoSchema),
    stats: await querySnapshotStats(snapshotPath),
  };
  const baseline = !baselinePath ? null : {
    run: await readParquetKvMetadata(baselinePath, "run_info", RunInfoSchema),
    stats: await querySnapshotStats(baselinePath),
  };
  const diff: ReleaseMeta["diff"] = !diffPath ? null : await queryDiffStats(diffPath, {signal});
  return {current, baseline, diff};
}

async function querySnapshotStats(snapshotPath: string, {signal}: {signal?: AbortSignal} = {}): Promise<SnapshotStats> {
  return await withMemoryDb(async(conn) => {
    return await queryRow(SnapshotStatsSchema, conn, `
      SELECT
        count(*)::DOUBLE AS total,
        (count(*) FILTER (WHERE deleted))::DOUBLE AS deleted,
        {
          'min': min(rev_num),
          'max': max(rev_num),
          'p50': quantile_disc(rev_num, 0.5),
          'p90': quantile_disc(rev_num, 0.9),
          'p95': quantile_disc(rev_num, 0.95),
          'p99': quantile_disc(rev_num, 0.99),
          'sum': sum(rev_num)::DOUBLE,
          'sumsq': sum(rev_num::DOUBLE ** 2), -- currently 38 bits
        } AS rev,
      FROM read_parquet($path)
    `, {path: snapshotPath});
  }, {signal});
}

async function queryDiffStats(diffPath: string, {signal}: {signal?: AbortSignal} = {}) {
  const statusCounts = await queryStatusCounts(diffPath);
  return await withMemoryDb(async(conn) => {
    const droppedIds = await queryColumn(v.string(), conn, `
      SELECT id FROM read_parquet($path) WHERE status = 'dropped'
    `, {path: diffPath});
    const flaky = await pingDroppedIds(droppedIds, signal);
    if(flaky.length) {
      console.warn(`${flaky.length} packuments for dropped IDs are still accessible:`, flaky.join(", "));
    }

    const rowSchema = v.strictObject({
      deleted: UInt53,
      undeleted: UInt53
    });
    const stats = await queryRow(rowSchema, conn, `
      SELECT
        (count(*) FILTER (WHERE l_deleted IS FALSE AND r_deleted IS TRUE))::DOUBLE AS deleted,
        (count(*) FILTER (WHERE l_deleted IS TRUE AND r_deleted IS FALSE))::DOUBLE AS undeleted
      FROM read_parquet($path)
    `, {path: diffPath});
    
    return {
      ...statusCounts,
      ...stats,
      flaky: flaky.length
    };
  }, {signal});
}

/**
 * Yields an array chunk by chunk.
 */
function* chunked<T>(chunkSize: number, arr: T[]) {
  for(let i = 0; i < arr.length;) yield arr.slice(i, i += chunkSize);
}

/**
 * Checks if a packument still gets served. Retries with forced revalidation
 * on positive responses.
 */
async function pingPackument(id: string, {signal}: {signal?: AbortSignal}) {
  const ping = async(url: string) => {
    const res = await fetch(url, {method: "HEAD", signal});
    if(res.ok) return true;
    if(res.status === 404) return false;
    throw new Error(`Unexpected response status ${res.status} for packument "${id}"`);
  };

  const url = `https://registry.npmjs.org/${id}`;
  // TODO check tombstone vs published
  return (await ping(url)) && (await ping(url + "?write=true"));
}

async function pingDroppedIds(droppedIds: string[], signal?: AbortSignal) {
  const {abort, signal: fetchSignal} = deriveSignal(signal);
  try {
    const flaky: string[] = [];
    for(const batch of chunked(200, droppedIds)) {
      await Promise.all(batch.map(async id => {
        if(await pingPackument(id, {signal: fetchSignal})) flaky.push(id);
      }));
    }
    return flaky;
  }
  catch(error) {
    abort(error);
    throw error;
  }
}