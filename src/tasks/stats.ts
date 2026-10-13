import { queryColumn, queryRow, withMemoryDb } from "../lib/duckdb.ts";
import * as v from "valibot";
import type {InferOutput} from "valibot";
import { UInt53 } from "../lib/schema.ts";
import { deriveSignal } from "../lib/abort.ts";

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

export async function buildSnapshotStats(snapshotPath: string): Promise<SnapshotStats> {
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
  });
}

export async function buildDiffStats(diffPath: string, {signal: parentSignal}: {signal?: AbortSignal} = {}) {
  return await withMemoryDb(async(conn) => {
    const droppedIds = await queryColumn(v.string(), conn, `
      SELECT id FROM read_parquet($path) WHERE status = 'dropped'
    `, {path: diffPath});
    const flaky: string[] = [];
    const {abort, signal} = deriveSignal(parentSignal);
    try {
      for(const batch of chunked(200, droppedIds)) {
        await Promise.all(batch.map(async id => {
          if(await pingPackument(id, {signal})) flaky.push(id);
        }));
      }
    }
    catch(error) {
      abort(error);
      throw error;
    }

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
    return {...stats, flaky: flaky.length};
  });
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
  return (await ping(url)) && (await ping(url + "?write=true"));
}
