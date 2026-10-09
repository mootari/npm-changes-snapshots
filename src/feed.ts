import * as v from "valibot";

const FEED_URL = "https://replicate.npmjs.com/";
const CHANGES_URL = "https://replicate.npmjs.com/registry/_changes";
const PAGE_LIMIT = 10000;
const MAX_ATTEMPTS = 5;

const Seq = v.pipe(v.number(), v.safeInteger());

const FeedStateSchema = v.object({
  doc_count: v.number(),
  update_seq: Seq,
});

export const StateRecordSchema = v.object({
  time: v.string(),
  state: FeedStateSchema,
});

const ChangeSchema = v.pipe(
  v.object({
    seq: Seq,
    id: v.string(),
    changes: v.strictTuple([v.object({ rev: v.string() })]),
    deleted: v.optional(v.boolean(), false),
  }),
  v.transform(({ seq, id, changes: [{ rev }], deleted }) => ({ seq, id, rev, deleted })),
);

const ChangesPageSchema = v.object({
  results: v.array(ChangeSchema),
  last_seq: Seq,
});

export type FeedState = v.InferOutput<typeof FeedStateSchema>;
export type Entry = v.InferOutput<typeof ChangeSchema> & { fetched_at: Date };

export type StateRecord = v.InferOutput<typeof StateRecordSchema>;

/** The feed's last sequence number, and the time at which the page containing it was requested. */
export const FinalSchema = v.object({
  time: v.string(),
  seq: Seq,
});

export type Final = v.InferOutput<typeof FinalSchema>;

export interface ChangesResult {
  entries: Map<string, Entry>;
  final: Final;
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
 * Pages through the changes feed from the beginning until a page has fewer results than the limit, so entries
 * updated while fetching are included. Only the latest entry per id is kept.
 */
export async function fetchChanges(url = CHANGES_URL): Promise<ChangesResult> {
  const entries = new Map<string, Entry>();
  let since = 0;
  let pages = 0;
  let fetchedEntries = 0;
  let final: Final;

  while (true) {
    const fetched_at = new Date();
    const page = v.parse(ChangesPageSchema, await getJson(`${url}?since=${since}&limit=${PAGE_LIMIT}`));
    pages++;
    fetchedEntries += page.results.length;
    final = { time: fetched_at.toISOString(), seq: page.last_seq };

    for (const change of page.results) {
      // Results are ordered by seq, so later entries replace earlier ones.
      entries.set(change.id, { ...change, fetched_at });
    }

    if (page.results.length < PAGE_LIMIT) break;
    if (page.last_seq <= since) {
      console.warn(`Feed stalled at seq ${since} with a full page.`);
      break;
    }
    since = page.last_seq;
  }

  return { entries, final, pages, fetchedEntries };
}
