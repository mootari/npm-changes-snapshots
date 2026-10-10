import { table, td, th, type Row } from "./lib/html.ts";
import type { Delta, Manifest } from "./types.ts";

type Nullish = null | undefined;
const N_A = `-`;
const numberFormat = new Intl.NumberFormat("en-US");
const deltaFormat = new Intl.NumberFormat("en-US", { signDisplay: "exceptZero" });

const format = {
  count(value: number | Nullish): string {
    return value == null ? N_A : numberFormat.format(value);
  },
  delta(baseline: number | Nullish, value: number | Nullish): string {
    return baseline != null && value != null ? deltaFormat.format(value - baseline) : N_A;
  },
  time(iso: string | Nullish): string {
    if(!iso) return N_A;
    return `${new Date(iso).toISOString().slice(0, 19).replace("T", " ")} UTC`;
  },
  duration(millis: number | Nullish, sign: boolean = false) {
    if(millis == null) return N_A;
    const abs = Math.abs(millis);
    const units = {
      h: {d: 1000 * 60 * 60, r: Infinity},
      m: {d: 1000 * 60, r: 60},
      s: {d: 1000, r: 60},
    };
    const parts = Object.entries(units).map(([, {d, r}]) => String(Math.floor(abs / d) % r).padStart(2, "0"));
    return (!(sign && millis) ? "" : millis < 0 ? "-" : "+") + parts.join(":");

  },
  elapsed(from: string | Nullish, to: string | Nullish, sign: boolean = false): string {
    if(!from || !to) return N_A;
    return format.duration(Math.abs(Math.round(+new Date(to) - +new Date(from))), sign);
  }
};

/** `previous` is null if there is no previous snapshot, or if its manifest is unreadable. */
export function renderNotes({current, baseline, delta}: {current: Manifest, baseline: Manifest | null, delta: Delta}): string {
  const f = format;
  const skipped = (m: Manifest | Nullish) => m ? m.fetched_entries - m.distinct_entries : null;
  const duration = (m: Manifest | Nullish) => m ? +new Date(m.end_state.time) - +new Date(m.start_state.time) : null;

  return `
Snapshot of the most recent [npm replication feed](https://replicate.npmjs.com/) entry of every package, compared to the previous snapshot.

### Differences to previous snapshot

${
  baseline
    ? `The previous snapshot was created on ${format.time(baseline.start_state.time)}.`
    : `No previous snapshot was found. All entries have been recorded as additions.`
}

${
  table([
    [ th("Added"), td(format.count(delta.added), {align: "right"}) ],
    [ th("Updated"), td(format.count(delta.updated), {align: "right"}) ],
    [ th("Drifted"), td(format.count(delta.drifted), {align: "right"}) ],
    [ th("Dropped"), td(format.count(delta.dropped), {align: "right"}) ],
  ] satisfies Row<1, 1>[])
}

### Fetch statistics

${
  table([
    [
      th(""),
      th("Previous snapshot"),
      th("This snapshot"),
      th("Trend")
    ],
    [
      th("Duration"),
      td(format.duration(duration(baseline)), {align: "right"}),
      td(format.duration(duration(current)), {align: "right"}),
      td(format.duration(baseline ? duration(current)! - duration(baseline)! : null, true), {align: "right"}),
    ],
    [
      th("Fetched pages"),
      td(format.count(baseline?.pages), {align: "right"}),
      td(format.count(current?.pages), {align: "right"}),
      td(format.delta(baseline?.pages, current?.pages), {align: "right"}),
    ],
    [
      th("Fetched entries"),
      td(format.count(baseline?.fetched_entries), {align: "right"}),
      td(format.count(current?.fetched_entries), {align: "right"}),
      td(format.delta(baseline?.fetched_entries, current?.fetched_entries), {align: "right"}),
    ],
    [
      th("Skipped entries"),
      td(format.count(skipped(baseline)), {align: "right"}),
      td(format.count(skipped(current)), {align: "right"}),
      td(format.delta(skipped(baseline), skipped(current)), {align: "right"}),
    ],
    [
      th("Stored entries"),
      td(format.count(baseline?.distinct_entries), {align: "right"}),
      td(format.count(current.distinct_entries), {align: "right"}),
      td(format.delta(baseline?.distinct_entries, current.distinct_entries), {align: "right"}),
    ],
  ] satisfies [Row<4, 0>, ...Row<1, 3>[]])
}

### Revisions

${
  table([
    [th(""), th("Previous snapshot"), th("This snapshot"), th("Trend")],
    [
      th("Min"),
      td(format.count(baseline?.stats.rev_num.min)),
      td(format.count(current.stats.rev_num.min)),
      td(format.delta(baseline?.stats.rev_num.min, current.stats.rev_num.min)),
    ],
    [
      th("Median"),
      td(format.count(baseline?.stats.rev_num.p50)),
      td(format.count(current.stats.rev_num.p50)),
      td(format.delta(baseline?.stats.rev_num.p50, current.stats.rev_num.p50)),
    ],
    [
      th("P95"),
      td(format.count(baseline?.stats.rev_num.p95)),
      td(format.count(current.stats.rev_num.p95)),
      td(format.delta(baseline?.stats.rev_num.p95, current.stats.rev_num.p95)),
    ],
    [
      th("P99"),
      td(format.count(baseline?.stats.rev_num.p99)),
      td(format.count(current.stats.rev_num.p99)),
      td(format.delta(baseline?.stats.rev_num.p99, current.stats.rev_num.p99)),
    ],
    [
      th("Max"),
      td(format.count(baseline?.stats.rev_num.max)),
      td(format.count(current.stats.rev_num.max)),
      td(format.delta(baseline?.stats.rev_num.max, current.stats.rev_num.max)),
    ],
  ] satisfies [Row<4, 0>, ...Row<1, 3>[]])
}
  `;
}
