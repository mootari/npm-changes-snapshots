import type { StateRecord } from "./feed.ts";
import type { Delta, SnapshotRef, Stats, StatsDelta } from "./parquet.ts";

export type Manifest = {
  start: StateRecord;
  final: StateRecord;
  pages: number;
  fetched_entries: number;
  stored_entries: number;
  stats: Stats;
};

/** Renders rows as a Markdown table. `headers` maps row keys to column labels, in column order. */
function table<T extends Record<string, unknown>>(headers: NoInfer<{ [K in keyof T]?: string }>, rows: T[]): string {
  const columns = Object.keys(headers) as (keyof T & string)[];
  const line = (cells: unknown[]) => `| ${cells.join(" | ")} |`;
  return [
    line(columns.map((key) => headers[key])),
    line(columns.map(() => "---")),
    ...rows.map((row) => line(columns.map((key) => row[key]))),
  ].join("\n");
}

const statsHeaders = {
  deleted_entries: "Deleted",
  not_deleted_entries: "Not deleted",
  rev_min: "Rev min",
  rev_p50: "Rev p50",
  rev_p90: "Rev p90",
  rev_p95: "Rev p95",
  rev_p99: "Rev p99",
  rev_max: "Rev max",
};

const statsRow = (stats: Stats | StatsDelta) =>
  Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, value ?? "-"]));

/** Formats an ISO timestamp as `YYYY-MM-DD HH:MM:SS UTC`; falls back to the raw value if unparsable. */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function renderNotes(manifest: Manifest, delta: Delta): string {
  const feedState = (label: string, { time, state }: StateRecord) => ({
    label,
    time: formatTime(time),
    documents: state.doc_count,
    sequence: state.update_seq,
  });
  const snapshot = (label: string, ref: SnapshotRef | null) => ({
    label,
    tag: ref?.tag ?? "-",
    time: ref ? formatTime(ref.time) : "-",
  });

  return (
    [
      "## Manifest",
      table({ label: "Feed state", time: "Time", documents: "Documents", sequence: "Sequence" }, [
        feedState("Start", manifest.start),
        feedState("Final", manifest.final),
      ]),
      table({ pages: "Pages fetched", fetched_entries: "Entries fetched", stored_entries: "Entries stored" }, [manifest]),
      table(statsHeaders, [statsRow(manifest.stats)]),
      "## Delta",
      table({ label: "Snapshot", tag: "Release", time: "Time" }, [
        snapshot("Previous", delta.previous),
        snapshot("Current", delta.current),
      ]),
      table(statsHeaders, [statsRow(delta.stats)]),
      table(
        {
          added: "Added",
          missing: "Removed",
          updated_seq_changed: "Updated",
          updated_seq_unchanged: "Retroactively changed",
        },
        [delta],
      ),
      "*Updated entries have a new sequence number. Retroactively changed entries differ from the previous snapshot without a new sequence number.*",
    ].join("\n\n") + "\n"
  );
}
