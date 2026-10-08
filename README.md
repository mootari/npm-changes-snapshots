# npm-changes-snapshots
Creates a daily snapshot of npm's changes feed to verify claims of retroactive changes.

## How it works

A scheduled workflow (`.github/workflows/daily-snapshot.yml`) runs `src/main.ts` once a day:

1. Records the start time and the feed state from <https://replicate.npmjs.com/>.
2. Pages through `/registry/_changes` up to the feed state's `update_seq`, discards later entries, keeps only the latest entry per id and records the page fetch start time (`fetched_at`) per entry.
3. Records the final time and feed state.
4. Writes `manifest.json` (start state, final state, pages, fetched entries, stored entries).
5. Writes `changes-YYYY-MM-DD.parquet` (ordered by id, ZSTD, via the DuckDB CLI).
6. Downloads the previous day's Parquet file from the release `snapshot-YYYY-MM-DD`.
7. Writes `delta.json` with counts of missing ids, added ids, ids updated with a new `seq` and ids updated with the same `seq` (different `rev` or `deleted`).
8. Creates the release `snapshot-YYYY-MM-DD` with these files; the release notes contain Markdown tables of the manifest and delta.

If no snapshot exists for the previous day, the delta is skipped.

## Local run

Requires the [DuckDB CLI](https://duckdb.org/install/) on `PATH` (or set `DUCKDB` to its location).

```sh
npm ci
npm run typecheck
npm run snapshot   # writes to ./out
```
