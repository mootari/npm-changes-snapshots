import { DuckDBDataChunkWriter, JSToDuckDBValueConverter } from "@duckdb/node-api";
import { fetchChanges, fetchFeedInfo } from "../lib/feed.ts";
import * as v from "valibot";
import { queryRow, withMemoryDb } from "../lib/duckdb.ts";
import { UInt53 } from "../lib/schema.ts";

const FeedStateSchema = v.strictObject({
  time: v.pipe(v.string(), v.isoTimestamp()),
  docs: UInt53,
  seq: UInt53,
});

export const RunInfoSchema = v.strictObject({
  "$schema_version": v.literal(1),
  start_state: FeedStateSchema,
  end_state: FeedStateSchema,
  fetched_pages: UInt53,
  fetched_records: UInt53,
});
export type RunInfo = v.InferOutput<typeof RunInfoSchema>;

export async function createSnapshot(path: string, {signal}: {signal?: AbortSignal} = {}) {
  return await withMemoryDb(async(conn) => {
    await conn.run(
      `
        CREATE TABLE changes (
          id VARCHAR NOT NULL,
          seq UINT32 NOT NULL,
          rev VARCHAR NOT NULL,
          rev_num UINT32 NOT NULL,
          deleted BOOLEAN NOT NULL,
          fetched_at TIMESTAMP_MS NOT NULL
        )
      `
    );
    const appender = await conn.createAppender("changes");
    const writer = DuckDBDataChunkWriter.forAppender(appender, { converter: JSToDuckDBValueConverter });

    const startTime = new Date();
    const startState = await fetchFeedInfo({signal});
    let pages = 0;

    for await(const {fetched_at, results} of fetchChanges({signal})) {
      ++pages;
      for (const { id, seq, changes, deleted } of results) {
        const {rev} = changes[0];
        writer.appendRow([
          id,
          seq,
          rev,
          parseInt(rev),
          deleted ?? false,
          fetched_at
        ]);
      }
    }
    const endTime = new Date();
    const endState = await fetchFeedInfo({signal});

    writer.flush();
    appender.closeSync();

    // At this point there may be multiple rows per id. We're only deduplicating on export to Parquet.
    const {total} = await queryRow(v.strictObject({total: UInt53}), conn, `
      SELECT count(*)::DOUBLE AS total FROM changes
    `);

    const runInfo = v.parse(RunInfoSchema, {
      "$schema_version": 1,
      start_state: {
        time: startTime.toISOString(),
        docs: startState.doc_count,
        seq: startState.update_seq
      },
      end_state: {
        time: endTime.toISOString(),
        docs: endState.doc_count,
        seq: endState.update_seq
      },
      fetched_pages: pages,
      fetched_records: total,
    } satisfies RunInfo);
    
    // Preserves only the latest seq per id.
    await conn.run(
      `
        COPY (
          SELECT *
          FROM changes
          QUALIFY row_number() OVER (PARTITION BY id ORDER BY seq DESC) = 1
          ORDER BY id
        ) TO $path (
        FORMAT parquet,
        COMPRESSION zstd,
        COMPRESSION_LEVEL 16,
        KV_METADATA {run_info: $runInfo}
        )
      `,
      {path, runInfo: JSON.stringify(runInfo)}
    );

    return runInfo;
  });
}
