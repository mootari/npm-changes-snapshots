import { queryRow, readParquetKvMetadata, withMemoryDb } from "../lib/duckdb.ts";
import * as v from "valibot";
import type * as V from "valibot";
import { UInt53 } from "../lib/schema.ts";
import { RunInfoSchema } from "./snapshot.ts";

export const DiffInfoSchema = v.strictObject({
  total: UInt53,
  added: UInt53,
  updated: UInt53,
  dropped: UInt53,
  drifted: UInt53,
});
export type DiffInfo = V.InferOutput<typeof DiffInfoSchema>;

export async function createDiff(leftPath: string, rightPath: string, diffPath: string, {signal}: {signal?: AbortSignal} = {}): Promise<DiffInfo> {
  await withMemoryDb(async(conn) => {
    await conn.run(
      `
        CREATE TABLE diff AS (
          WITH
            l AS NOT MATERIALIZED (FROM read_parquet($leftPath)),
            r AS NOT MATERIALIZED (FROM read_parquet($rightPath))
          SELECT
            id,
            CASE
              WHEN l.id IS NULL THEN 'added'
              WHEN r.id IS NULL THEN 'dropped'
              WHEN l.seq < r.seq THEN 'updated'
              ELSE 'drifted'
            END AS "status",
            l.seq AS l_seq,
            l.rev AS l_rev,
            l.rev_num AS l_rev_num,
            l.deleted AS l_deleted,
            COALESCE(l.fetched_at, (SELECT min(fetched_at) FROM l)) AS l_fetched_at,
            r.seq AS r_seq,
            r.rev AS r_rev,
            r.rev_num AS r_rev_num,
            r.deleted AS r_deleted,
            COALESCE(r.fetched_at, (SELECT min(fetched_at) FROM r)) AS r_fetched_at,
          FROM l
          FULL OUTER JOIN r USING (id)
          WHERE (l.id, l.seq, l.rev, l.deleted) IS DISTINCT FROM (r.id, r.seq, r.rev, r.deleted)
          ORDER BY id
        )
      `,
      {leftPath, rightPath}
    );

    const readInfo = async(path: string) => JSON.stringify(
      await readParquetKvMetadata(path, "run_info", RunInfoSchema).catch(() => null)
    );
    // TODO add baseline asset URL as metadata?
    await conn.run(
      `
        COPY diff TO $diffPath (
          FORMAT parquet,
          COMPRESSION zstd,
          COMPRESSION_LEVEL 16,
          KV_METADATA {
            l_run_info: $lInfo,
            r_run_info: $rInfo
          }
        )
      `,
      {
        diffPath,
        lInfo: await readInfo(leftPath),
        rInfo: await readInfo(rightPath)
      }
    );
  }, {signal});
  // Verify that the schema includes all statuses.
  const c = await queryStatusCounts(diffPath);
  if(0 !== c.total - (c.added + c.updated + c.dropped + c.drifted)) throw new Error("Invalid diff counts");
  return c;
}

export async function queryStatusCounts(diffPath: string, {signal}: {signal?: AbortSignal} = {}): Promise<DiffInfo> {
  return await withMemoryDb(async(conn) => {
    return await queryRow(DiffInfoSchema, conn, `
      SELECT
        count(*)::DOUBLE AS total,
        (count(*) FILTER (WHERE status = 'added'))::DOUBLE AS added,
        (count(*) FILTER (WHERE status = 'updated'))::DOUBLE AS updated,
        (count(*) FILTER (WHERE status = 'dropped'))::DOUBLE AS dropped,
        (count(*) FILTER (WHERE status = 'drifted'))::DOUBLE AS drifted
      FROM read_parquet($diffPath)
    `, {diffPath});
  }, {signal});
}
