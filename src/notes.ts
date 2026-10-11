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
  const skipped = (m: Manifest | Nullish) => m ? m.fetched_entries - m.distinct_entries : null;
  const duration = (m: Manifest | Nullish) => m ? +new Date(m.end_state.time) - +new Date(m.start_state.time) : null;
  
  const f = format;
  const thl: typeof th = (label, attrs) => th(label, {...attrs, align: "left"});
  const tdr: typeof td = (value, attrs) => td(value, {...attrs, align: "right"});

  return `
Snapshot of the most recent [npm replication feed](https://replicate.npmjs.com/) entry of every package, compared to the previous snapshot.

### Differences to previous snapshot

${
  baseline
    ? `The previous snapshot was created on ${format.time(baseline.start_state.time)}.`
    : `No previous snapshot was found. All entries have been recorded as additions.`
}

Packages are counted as drifted if some of their fields changed retroactively. Dropped packages got removed without a corresponding change record.

${
  table([
    [
      thl("Added", {scope: "row"}),
      tdr(f.count(delta.added))
    ],
    [
      thl("Updated", {scope: "row"}),
      tdr(f.count(delta.updated))
    ],
    [
      thl("Drifted", {scope: "row"}),
      tdr(f.count(delta.drifted))
    ],
    [
      thl("Dropped", {scope: "row"}),
      tdr(f.count(delta.dropped))
    ],
  ] satisfies Row<1, 1>[])
}

### Fetch statistics

Changes are fetched in batches of 10,000 entries per page. When a package gets updated during a run only its newest record is kept.

${
  table([
    [
      th(""),
      thl("Previous snapshot"),
      thl("This snapshot"),
      thl("Trend")
    ],
    [
      thl("Duration", {scope: "row"}),
      tdr(f.duration(duration(baseline))),
      tdr(f.duration(duration(current))),
      tdr(f.duration(baseline ? duration(current)! - duration(baseline)! : null, true)),
    ],
    [
      thl("Fetched pages", {scope: "row"}),
      tdr(f.count(baseline?.pages)),
      tdr(f.count(current?.pages)),
      tdr(f.delta(baseline?.pages, current?.pages)),
    ],
    [
      thl("Fetched records", {scope: "row"}),
      tdr(f.count(baseline?.fetched_entries)),
      tdr(f.count(current?.fetched_entries)),
      tdr(f.delta(baseline?.fetched_entries, current?.fetched_entries)),
    ],
    [
      thl("Stored records", {scope: "row"}),
      tdr(f.count(baseline?.distinct_entries)),
      tdr(f.count(current.distinct_entries)),
      tdr(f.delta(baseline?.distinct_entries, current.distinct_entries)),
    ],
    [
      thl("Skipped records", {scope: "row"}),
      tdr(f.count(skipped(baseline))),
      tdr(f.count(skipped(current))),
      tdr(f.delta(skipped(baseline), skipped(current))),
    ],
  ] satisfies [Row<4, 0>, ...Row<1, 3>[]])
}

### Revisions

Record revision numbers count any kind of change to a package document and can serve as a heuristic for its overall number of released versions.

${
  table([
    [
      th(""),
      thl("Previous snapshot", {align: "left"}),
      thl("This snapshot", {align: "left"}),
      thl("Trend", {align: "left"})
    ],
    [
      thl("Min", {scope: "row"}),
      tdr(f.count(baseline?.stats.rev_num.min)),
      tdr(f.count(current.stats.rev_num.min)),
      tdr(f.delta(baseline?.stats.rev_num.min, current.stats.rev_num.min)),
    ],
    [
      thl("Median", {scope: "row"}),
      tdr(f.count(baseline?.stats.rev_num.p50)),
      tdr(f.count(current.stats.rev_num.p50)),
      tdr(f.delta(baseline?.stats.rev_num.p50, current.stats.rev_num.p50)),
    ],
    [
      thl("P95", {scope: "row"}),
      tdr(f.count(baseline?.stats.rev_num.p95)),
      tdr(f.count(current.stats.rev_num.p95)),
      tdr(f.delta(baseline?.stats.rev_num.p95, current.stats.rev_num.p95)),
    ],
    [
      thl("P99", {scope: "row"}),
      tdr(f.count(baseline?.stats.rev_num.p99)),
      tdr(f.count(current.stats.rev_num.p99)),
      tdr(f.delta(baseline?.stats.rev_num.p99, current.stats.rev_num.p99)),
    ],
    [
      thl("Max", {scope: "row"}),
      tdr(f.count(baseline?.stats.rev_num.max)),
      tdr(f.count(current.stats.rev_num.max)),
      tdr(f.delta(baseline?.stats.rev_num.max, current.stats.rev_num.max)),
    ],
  ] satisfies [Row<4, 0>, ...Row<1, 3>[]])
}
  `;
}
