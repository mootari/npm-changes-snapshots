import type { StateRecord } from "./feed.ts";
import type { Delta, SnapshotRef } from "./parquet.ts";

export type Manifest = {
  start: StateRecord;
  final: StateRecord;
  pages: number;
  fetched_entries: number;
  stored_entries: number;
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

export function renderNotes(manifest: Manifest, delta: Delta): string {
  const feedState = (label: string, { time, state }: StateRecord) => ({
    label,
    time,
    documents: state.doc_count,
    sequence: state.update_seq,
  });
  const snapshot = (label: string, ref: SnapshotRef | null) => ({
    label,
    tag: ref?.tag ?? "none",
    time: ref?.time ?? "-",
  });

  return (
    [
      "## Manifest",
      table({ label: "Feed state", time: "Time", documents: "Documents", sequence: "Sequence" }, [
        feedState("Start", manifest.start),
        feedState("Final", manifest.final),
      ]),
      table({ pages: "Pages fetched", fetched_entries: "Entries fetched", stored_entries: "Entries stored" }, [manifest]),
      "## Delta",
      table({ label: "Snapshot", tag: "Release", time: "Time" }, [
        snapshot("Previous", delta.previous),
        snapshot("Current", delta.current),
      ]),
      table(
        {
          added: "Added",
          missing: "Removed",
          updated_seq_changed: "Updated",
          updated_seq_unchanged: "Retroactively changed",
        },
        [delta],
      ),
      "<small>Updated entries have a new sequence number. Retroactively changed entries differ from the previous snapshot without a new sequence number.</small>",
    ].join("\n\n") + "\n"
  );
}
