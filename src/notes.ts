import type { StateRecord } from "./feed.ts";
import type { Delta } from "./parquet.ts";

export interface Manifest {
  start: StateRecord;
  final: StateRecord;
  pages: number;
  fetched_entries: number;
  stored_entries: number;
}

function table(rows: [string, string | number][]): string {
  const lines = ["| Key | Value |", "| --- | ---: |"];
  for (const [key, value] of rows) lines.push(`| ${key} | ${value} |`);
  return lines.join("\n");
}

function flattenState(prefix: string, record: StateRecord): [string, string][] {
  return [
    [`${prefix}.time`, record.time],
    ...Object.entries(record.state).map(([k, v]): [string, string] => [
      `${prefix}.state.${k}`,
      typeof v === "object" ? JSON.stringify(v) : String(v),
    ]),
  ];
}

export function renderNotes(manifest: Manifest, delta: Delta | null): string {
  const manifestRows: [string, string | number][] = [
    ...flattenState("start", manifest.start),
    ...flattenState("final", manifest.final),
    ["pages", manifest.pages],
    ["fetched_entries", manifest.fetched_entries],
    ["stored_entries", manifest.stored_entries],
  ];
  const sections = ["## Manifest", table(manifestRows), "## Delta"];
  if (delta) {
    sections.push(
      table([
        ["previous_snapshot", delta.previous_snapshot],
        ["current_snapshot", delta.current_snapshot],
        ["missing", delta.missing],
        ["added", delta.added],
        ["updated_seq_changed", delta.updated_seq_changed],
        ["updated_seq_unchanged", delta.updated_seq_unchanged],
      ]),
    );
  } else {
    sections.push("No snapshot from the previous day was available for comparison.");
  }
  return sections.join("\n\n") + "\n";
}
