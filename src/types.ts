import * as v from "valibot";

export const Int = v.pipe(v.number(), v.safeInteger());

/** Counts and rev number distribution of a snapshot. Rev numbers are null for an empty snapshot. */
export const StatsSchema = v.strictObject({
  "$schema_version": v.literal(1),
  total: Int,
  deleted: Int,
  rev_num: v.strictObject({
    min: Int,
    max: Int,
    p50: Int,
    p90: Int,
    p95: Int,
    p99: Int,
    sum: Int,
    sumsq: Int,
  }),
});
export type Stats = v.InferOutput<typeof StatsSchema>;

export const DeltaSchema = v.strictObject({
  "$schema_version": v.literal(1),
  baseline: v.nullable(
    v.strictObject({
      tag: v.string(),
      time: v.string()
    })
  ),
  added: Int,
  dropped: Int,
  updated: Int,
  drifted: Int,
});
export type Delta = v.InferOutput<typeof DeltaSchema>;

const FeedStateSchema = v.strictObject({
  time: v.string(),
  docs: Int,
  seq: Int,
});
export type FeedState = v.InferOutput<typeof FeedStateSchema>;

export const ManifestSchema = v.strictObject({
  "$schema_version": v.literal(1),
  start_state: FeedStateSchema,
  end_state: FeedStateSchema,
  pages: v.number(),
  fetched_entries: v.number(),
  distinct_entries: v.number(),
  stats: StatsSchema,
});

export type Manifest = v.InferOutput<typeof ManifestSchema>;
