import * as v from "valibot";

const FEED_URL = "https://replicate.npmjs.com/";
const CHANGES_URL = "https://replicate.npmjs.com/registry/_changes";
const PAGE_LIMIT = 10000;
const MAX_ATTEMPTS = 5;

const Seq = v.pipe(v.number(), v.safeInteger());

const FeedStateSchema = v.looseObject({ update_seq: Seq });

const ChangesPageSchema = v.object({
  results: v.array(
    v.object({
      seq: Seq,
      id: v.string(),
      deleted: v.optional(v.boolean(), false),
      changes: v.pipe(v.array(v.object({ rev: v.string() })), v.minLength(1)),
    }),
  ),
  last_seq: Seq,
});

export type FeedState = v.InferOutput<typeof FeedStateSchema>;

export interface StateRecord {
  time: string;
  state: FeedState;
}

export interface Entry {
  id: string;
  seq: number;
  rev: string;
  deleted: boolean;
  fetched_at: Date;
}

export interface ChangesResult {
  entries: Map<string, Entry>;
  pages: number;
  fetchedEntries: number;
}

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.json();
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
    }
  }
}

export async function fetchFeedState(url = FEED_URL): Promise<StateRecord> {
  const time = new Date().toISOString();
  const state = v.parse(FeedStateSchema, await getJson(url));
  return { time, state };
}

/**
 * Pages through the changes feed until `updateSeq` is reached. Entries past
 * `updateSeq` are discarded, only the latest entry per id is kept.
 */
export async function fetchChanges(updateSeq: number, url = CHANGES_URL): Promise<ChangesResult> {
  const entries = new Map<string, Entry>();
  let since = 0;
  let pages = 0;
  let fetchedEntries = 0;

  while (since < updateSeq) {
    const fetched_at = new Date();
    const page = v.parse(ChangesPageSchema, await getJson(`${url}?since=${since}&limit=${PAGE_LIMIT}`));
    pages++;
    fetchedEntries += page.results.length;
    if (page.last_seq <= since) throw new Error(`Feed did not advance past seq ${since}`);

    for (const { seq, id, deleted, changes } of page.results) {
      if (seq > updateSeq) continue;
      // Results are ordered by seq, so later entries replace earlier ones.
      entries.set(id, { id, seq, rev: changes[changes.length - 1].rev, deleted, fetched_at });
    }
    since = page.last_seq;
  }

  return { entries, pages, fetchedEntries };
}
