import type { RunInfo } from "./snapshot.ts";
import type { SnapshotStats } from "./stats.ts";

type SnapshotInfo = {
  run: RunInfo;
  stats: SnapshotStats;
};

export type ReleaseMeta = {
  current: SnapshotInfo;
  baseline: SnapshotInfo | null;
  diff: {
    added: number;
    updated: number;
    dropped: number;
    drifted: number;
    deleted: number;
    undeleted: number;
    flaky: number;
  } | null;
};

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
};

export function renderNotes({current, baseline, diff}: ReleaseMeta): string {
  const skipped = (m: SnapshotInfo | Nullish) => m ? m.run.fetched_records - m.stats.total : null;
  const duration = (m: SnapshotInfo | Nullish) => m ? +new Date(m.run.end_state.time) - +new Date(m.run.start_state.time) : null;
  // TODO
  //const linked = (label: string, href?: string) => href ? `[${label}](${href})` : label;
  
  const f = format;
  const counts = (a: number | Nullish, b: number | Nullish) => [f.count(a), f.count(b), f.delta(a, b)].join(" | ");

  return `
Snapshot of the most recent [npm replication feed](https://replicate.npmjs.com/) entry of every package, compared to the previous snapshot.

### Differences to previous snapshot

${
  !baseline
    ? `There was no compatible snapshot to compare against.`
    : `The previous snapshot was created on ${format.time(baseline.run.start_state.time)}.`
}

${
  !diff
    ? ""
    : `
| Status | Count
| :- | -:
| added | ${ f.count(diff.added) }
| updated | ${ f.count(diff.updated) }
| drifted[^1] | ${ f.count(diff.drifted) }
| dropped[^2] | ${ f.count(diff.dropped) }

[^1]: Some fields changed retroactively without creating a new change record.
[^2]: The ID is no longer present in the feed and stays orphaned in registry mirrors.

| Status | Count
| :- | -:
| flaky[^3] | ${ f.count(diff.flaky) }
| deleted | ${ f.count(diff.deleted) }
| undeleted | ${ f.count(diff.undeleted) }

[^3]: The ID is no longer present in the feed but the packument is still reachable. Suggests that a new unpublished change record replaced the old one.
    `
}

### Fetch statistics

Changes are fetched in batches of 10,000 entries per page. When a package gets updated during a run only its newest record is kept.

| | Previous snapshot | This snapshot | Trend
| :- | -: | -: | -:
| **Duration** | ${ f.duration(duration(baseline)) } | ${ f.duration(duration(current)) } | ${ f.duration(baseline ? duration(current)! - duration(baseline)! : null, true) }
| **Fetched pages** | ${ counts(baseline?.run.fetched_pages, current.run.fetched_pages) }
| **Fetched records** | ${ counts(baseline?.run.fetched_records, current.run.fetched_records) }
| **Stored records** | ${ counts(baseline?.stats.total, current.stats.total) }
| **Skipped records** | ${ counts(skipped(baseline), skipped(current)) }

### Revisions

Record revision numbers count any kind of change to a package document and can serve as a heuristic for its overall number of released versions.

| Dimension | Previous snapshot | This snapshot | Trend
| :- | -: | -: | -:
| min | ${ counts(baseline?.stats.rev.min, current.stats.rev.min) }
| median | ${ counts(baseline?.stats.rev.p50, current.stats.rev.p50) }
| p95 | ${ counts(baseline?.stats.rev.p95, current.stats.rev.p95) }
| p99 | ${ counts(baseline?.stats.rev.p99, current.stats.rev.p99) }
| max | ${ counts(baseline?.stats.rev.max, current.stats.rev.max) }
| sum | ${ counts(baseline?.stats.rev.sum, current.stats.rev.sum) }

  `;
}
