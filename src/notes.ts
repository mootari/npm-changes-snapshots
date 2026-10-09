import * as v from "valibot";
import { StateRecordSchema } from "./feed.ts";
import { ChangeCountsSchema, StatsSchema, type Delta, type Stats } from "./parquet.ts";

export const ManifestSchema = v.object({
  start: StateRecordSchema,
  final: StateRecordSchema,
  pages: v.number(),
  fetched_entries: v.number(),
  stored_entries: v.number(),
  stats: StatsSchema,
  /** Absent in manifests that predate it. */
  changes: v.optional(ChangeCountsSchema),
});

export type Manifest = v.InferOutput<typeof ManifestSchema>;

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
        `<tr><th scope="row" align="left">${escapeHtml(label)}</th>${cell(previous)}${cell(current)}${cell(delta)}</tr>`,
    ),
    "</tbody>",
    "</table>",
  ].join("\n");
}

const numberFormat = new Intl.NumberFormat("en-US");
const deltaFormat = new Intl.NumberFormat("en-US", { signDisplay: "exceptZero" });

/** Formats a number with thousand separators; a missing value becomes `-`. */
const count = (value: number | null | undefined) => (value == null ? "-" : numberFormat.format(value));

/** A numeric row. Unless given, the delta is the difference between the values, with missing values counting as 0. */
const metric = (
  label: string,
  previous: number | null | undefined,
  current: number | null,
  delta = (current ?? 0) - (previous ?? 0),
): Row => ({ label, previous: count(previous), current: count(current), delta: deltaFormat.format(delta) });

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

/**
 * Formats the time from `from` to `to` as `Nh Nm Ns`, omitting leading units that are 0.
 * Computed from whole seconds like `formatTime`, so it matches the displayed timestamps; `-` if either is unparsable.
 */
function formatElapsed(from: string, to: string): string {
  const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
  const diff = seconds(to) - seconds(from);
  if (Number.isNaN(diff)) return "-";
  const abs = Math.abs(diff);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor(abs / 60) % 60;
  const parts = [hours && `${hours}h`, (hours || minutes) && `${minutes}m`, `${abs % 60}s`].filter(Boolean);
  return `${diff < 0 ? "-" : ""}${parts.join(" ")}`;
}

const total = ({ deleted_entries, not_deleted_entries }: Stats) => deleted_entries + not_deleted_entries;

const discarded = (manifest: Manifest) => manifest.fetched_entries - manifest.stored_entries;

/** `previous` is null if there is no previous snapshot, or if its manifest is unreadable. */
export function renderNotes(manifest: Manifest, delta: Delta, previous: Manifest | null): string {
  const { start, final, stats } = manifest;
  const time = (label: string, previousTime: string | undefined, currentTime: string): Row => ({
    label,
    previous: previousTime ? formatTime(previousTime) : "-",
    current: formatTime(currentTime),
    delta: previousTime ? formatElapsed(previousTime, currentTime) : "-",
  });

  const rows: Row[] = [
    { label: "Release", previous: delta.previous?.tag ?? "-", current: delta.current.tag },
    metric("Entries", previous && total(previous.stats), total(stats)),
    metric("Added", previous?.changes?.added, delta.added),
    metric("Missing", previous?.changes?.missing, delta.missing),
    metric("Updated", previous?.changes?.updated_seq_changed, delta.updated_seq_changed),
    metric("Retroactively changed", previous?.changes?.updated_seq_unchanged, delta.updated_seq_unchanged),
    ...(Object.entries(statsLabels) as [keyof Stats, string][]).map(([key, label]) =>
      metric(label, previous?.stats[key], stats[key], delta.stats[key]),
    ),
    time("Start time", previous?.start.time, start.time),
    metric("Start sequence", previous?.start.state.update_seq, start.state.update_seq),
    metric("Start documents", previous?.start.state.doc_count, start.state.doc_count),
    time("Final time", previous?.final.time, final.time),
    metric("Final sequence", previous?.final.state.update_seq, final.state.update_seq),
    metric("Final documents", previous?.final.state.doc_count, final.state.doc_count),
    metric("Pages fetched", previous?.pages, manifest.pages),
    metric("Entries fetched", previous?.fetched_entries, manifest.fetched_entries),
    metric("Entries stored", previous?.stored_entries, manifest.stored_entries),
    metric("Entries discarded", previous && discarded(previous), discarded(manifest)),
  ];

  return (
    [
      "Snapshot of the most recent [npm replication feed](https://replicate.npmjs.com/) entry of every package, compared to the previous snapshot.",
      table(rows),
      [
        "- The feed state is recorded before the fetch (start) and after it (final). Changes are fetched only up to the start sequence, even if the final sequence has increased in the meantime. Entries updated during the fetch are discarded.",
        "- Updated entries have a new sequence number. Entries are counted as retroactively changed if any of their fields change without updating the sequence number.",
        "- Entries are expected to only be added or updated. None should be retroactively changed, and none should be missing unless they were updated during the fetch and discarded.",
      ].join("\n"),
    ].join("\n\n") + "\n"
  );
}
