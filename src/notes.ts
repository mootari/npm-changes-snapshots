import type { StateRecord } from "./feed.ts";
import type { Delta } from "./parquet.ts";

export interface Manifest {
  start: StateRecord;
  final: StateRecord;
  pages: number;
  fetched_entries: number;
  stored_entries: number;
}

type Row = Record<string, string | number>;

function table(headers: string[], rows: Row[]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map((row) => line(headers.map((h) => row[h])))].join(
    "\n",
  );
}

function stateRows(label: string, { time, state }: StateRecord): Row[] {
  return [
    { Key: `${label}.time`, Value: time },
    ...Object.entries(state).map(([key, value]) => ({
      Key: `${label}.state.${key}`,
      Value: typeof value === "string" ? value : JSON.stringify(value),
    })),
  ];
}

export function renderNotes(manifest: Manifest, delta: Delta | null): string {
  const manifestRows: Row[] = [
    ...stateRows("start", manifest.start),
    ...stateRows("final", manifest.final),
    { Key: "pages", Value: manifest.pages },
    { Key: "fetched_entries", Value: manifest.fetched_entries },
    { Key: "stored_entries", Value: manifest.stored_entries },
  ];
  const deltaSection = delta
    ? table(Object.keys(delta), [delta])
    : "No snapshot from the previous day was available for comparison.";
  return `## Manifest\n\n${table(["Key", "Value"], manifestRows)}\n\n## Delta\n\n${deltaSection}\n`;
}
