const FEED_URL = "https://replicate.npmjs.com/";
const CHANGES_URL = "https://replicate.npmjs.com/registry/_changes";
const PAGE_LIMIT = 10000;
const MAX_ATTEMPTS = 5;

export interface FeedState {
  update_seq: number | string;
  [key: string]: unknown;
}

export interface StateRecord {
  time: string;
  state: FeedState;
}

export interface Entry {
  id: string;
  seq: number;
  rev: string | null;
  deleted: boolean;
  fetched_at: string;
}

export interface ChangesResult {
  entries: Map<string, Entry>;
  pages: number;
  fetchedEntries: number;
}

interface ChangesPage {
  results: { seq: number | string; id: string; deleted?: boolean; changes?: { rev: string }[] }[];
  last_seq: number | string;
}

async function getJson<T>(url: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
  }
  throw lastError;
}

export async function fetchFeedState(baseUrl = FEED_URL): Promise<StateRecord> {
  const time = new Date().toISOString();
  const state = await getJson<FeedState>(baseUrl);
  return { time, state };
}

function toSeq(value: number | string): number {
  const seq = Number(value);
  if (!Number.isSafeInteger(seq)) throw new Error(`Unsupported seq value: ${value}`);
  return seq;
}

/**
 * Pages through the changes feed until `updateSeq` is reached. Entries past
 * `updateSeq` are discarded, only the latest entry per id is kept.
 */
export async function fetchChanges(updateSeq: number, changesUrl = CHANGES_URL): Promise<ChangesResult> {
  const entries = new Map<string, Entry>();
  let since = 0;
  let pages = 0;
  let fetchedEntries = 0;

  while (since < updateSeq) {
    const fetchedAt = new Date().toISOString();
    const page = await getJson<ChangesPage>(`${changesUrl}?since=${since}&limit=${PAGE_LIMIT}`);
    pages++;
    fetchedEntries += page.results.length;
    if (page.results.length === 0) break;

    for (const result of page.results) {
      const seq = toSeq(result.seq);
      if (seq > updateSeq) continue;
      // Results are ordered by seq, so later entries replace earlier ones.
      entries.set(result.id, {
        id: result.id,
        seq,
        rev: result.changes?.[result.changes.length - 1]?.rev ?? null,
        deleted: result.deleted === true,
        fetched_at: fetchedAt,
      });
    }

    const next = toSeq(page.last_seq);
    if (next <= since) throw new Error(`Feed did not advance past seq ${since}`);
    since = next;
  }

  return { entries, pages, fetchedEntries };
}
