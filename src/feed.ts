import * as v from "valibot";
import { Int, type FeedState } from "./types.ts";

const FEED_URL = "https://replicate.npmjs.com/";
const CHANGES_URL = "https://replicate.npmjs.com/registry/_changes";
const PAGE_LIMIT = 10000;
const MAX_ATTEMPTS = 5;

const ChangeSchema = v.pipe(
  v.strictObject({
    seq: Int,
    id: v.string(),
    changes: v.strictTuple([v.strictObject({ rev: v.string() })]),
    deleted: v.optional(v.boolean(), false),
  }),
  v.transform(({ seq, id, changes: [{ rev }], deleted }) => ({
    seq,
    id,
    rev,
    rev_num: parseInt(rev), // int prefix without the hash
    deleted
  })),
);

const ChangesPageSchema = v.strictObject({
  results: v.array(ChangeSchema),
  last_seq: Int,
});

export type Entry = v.InferOutput<typeof ChangeSchema> & { fetched_at: Date };

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

const CounDBStateSchema = v.object({
  doc_count: v.number(),
  update_seq: Int,
});

export async function fetchFeedState(url = FEED_URL): Promise<FeedState> {
  const time = new Date().toISOString();
  const state = v.parse(CounDBStateSchema, await getJson(url));
  return { time, docs: state.doc_count, seq: state.update_seq };
}

/**
 * Pages through the changes feed from the beginning until a page has fewer results than the limit, so entries
 * updated while fetching are included. Only the latest entry per id is kept.
 */
export async function fetchChanges({url = CHANGES_URL, maxPages = Infinity}: {url?: string, maxPages?: number} = {}): Promise<ChangesResult> {
  const entries = new Map<string, Entry>();
  let since = 0;
  let pages = 0;
  let fetchedEntries = 0;

  while (pages < maxPages) {
    const fetched_at = new Date();
    const page = v.parse(ChangesPageSchema, await getJson(`${url}?since=${since}&limit=${PAGE_LIMIT}`));
    ++pages;
    fetchedEntries += page.results.length;

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
    if(pages % 20 === 0) console.log(`Fetched ${pages} pages…`);
  }

  return { entries, pages, fetchedEntries };
}
