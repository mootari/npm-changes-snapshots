import type { StateRecord } from "./feed.ts";
import type { Delta, Stats } from "./parquet.ts";

export type Manifest = {
  start: StateRecord;
  final: StateRecord;
  pages: number;
  fetched_entries: number;
  stored_entries: number;
  stats: Stats;
};

/** Cells are left blank where a row has no value for a column. */
type Row = { label: string; previous?: string; current?: string; delta?: string };

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Renders rows as an HTML table, which unlike a Markdown table supports row headers and column groups. */
function table(rows: Row[]): string {
  const columnHeader = (text: string) => `<th scope="col" align="right">${text}</th>`;
  const cell = (text = "") => `<td align="right">${escapeHtml(text)}</td>`;
  return [
    "<table>",
    '<colgroup><col></colgroup><colgroup><col span="2"></colgroup><colgroup><col></colgroup>',
    `<thead><tr><td></td>${["Previous", "Current", "Delta"].map(columnHeader).join("")}</tr></thead>`,
    "<tbody>",
    ...rows.map(
      ({ label, previous, current, delta }) =>
        `<tr><th scope="row" align="left">${label}</th>${cell(previous)}${cell(current)}${cell(delta)}</tr>`,
    ),
    "</tbody>",
    "</table>",
  ].join("\n");
}

const numberFormat = new Intl.NumberFormat("en-US");
const deltaFormat = new Intl.NumberFormat("en-US", { signDisplay: "exceptZero" });

/** Formats a number with thousand separators; null becomes `-`. */
const count = (value: number | null) => (value === null ? "-" : numberFormat.format(value));

const statsLabels: Record<keyof Stats, string> = {
  deleted_entries: "Deleted",
  not_deleted_entries: "Not deleted",
  rev_min: "Rev min",
  rev_p50: "Rev p50",
  rev_p90: "Rev p90",
  rev_p95: "Rev p95",
  rev_p99: "Rev p99",
  rev_max: "Rev max",
};

/** Formats an ISO timestamp as `YYYY-MM-DD HH:MM:SS UTC`; falls back to the raw value if unparsable. */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/** `previousStats` is null if there is no previous snapshot, or if its manifest predates stats. */
export function renderNotes(manifest: Manifest, delta: Delta, previousStats: Stats | null): string {
  const { start, final, stats } = manifest;
  const { previous, current } = delta;

  const rows: Row[] = [
    { label: "Release", previous: previous?.tag ?? "-", current: current.tag },
    { label: "Time", previous: previous ? formatTime(previous.time) : "-", current: formatTime(current.time) },
    { label: "Added", delta: count(delta.added) },
    { label: "Removed", delta: count(delta.missing) },
    { label: "Updated", delta: count(delta.updated_seq_changed) },
    { label: "Retroactively changed", delta: count(delta.updated_seq_unchanged) },
    ...(Object.entries(statsLabels) as [keyof Stats, string][]).map(([key, label]) => ({
      label,
      previous: previousStats ? count(previousStats[key]) : "-",
      current: count(stats[key]),
      delta: deltaFormat.format(delta.stats[key]),
    })),
    { label: "Start sequence", current: count(start.state.update_seq) },
    { label: "Start documents", current: count(start.state.doc_count) },
    { label: "Final time", current: formatTime(final.time) },
    { label: "Final sequence", current: count(final.state.update_seq) },
    { label: "Final documents", current: count(final.state.doc_count) },
    { label: "Pages fetched", current: count(manifest.pages) },
    { label: "Entries fetched", current: count(manifest.fetched_entries) },
    { label: "Entries stored", current: count(manifest.stored_entries) },
    { label: "Entries discarded", current: count(manifest.fetched_entries - manifest.stored_entries) },
  ];

  return (
    [
      "Snapshot of the most recent [npm replication feed](https://replicate.npmjs.com/) entry of every package, compared to the previous snapshot.",
      table(rows),
      [
        "- The feed state is recorded before the fetch (start) and after it (final). Changes are fetched only up to the start sequence, even if the final sequence has increased in the meantime. Entries updated during the fetch are discarded.",
        "- Updated entries have a new sequence number. Entries are counted as retroactively changed if any of their fields change without updating the sequence number.",
        "- Entries are expected to only be added or updated. There should be no removed or retroactively changed entries.",
      ].join("\n"),
    ].join("\n\n") + "\n"
  );
}
