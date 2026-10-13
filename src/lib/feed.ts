import * as v from "valibot";
import { UInt53 } from "./schema.ts";

const INFO_URL = "https://replicate.npmjs.com/";
const FEED_URL = "https://replicate.npmjs.com/registry/_changes";
const PAGE_LIMIT = 10000;

const ChangeRecordSchema = v.strictObject({
  seq: UInt53,
  id: v.string(),
  changes: v.strictTuple([v.strictObject({ rev: v.string() })]),
  deleted: v.optional(v.literal(true)),
});

const ChangesSchema = v.strictObject({
  results: v.array(ChangeRecordSchema),
  last_seq: UInt53,
});

const InfoSchema = v.object({
  doc_count: UInt53,
  update_seq: UInt53,
});

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { 
    ...init,
    headers: {
      accept: "application/json",
      ...init?.headers
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.json();
}

export async function fetchFeedInfo({signal}: {signal?: AbortSignal} = {}) {
  return v.parse(InfoSchema, await fetchJson(INFO_URL, {signal}));
}

export async function* fetchChanges({maxPages = Infinity, signal}: {maxPages?: number, signal?: AbortSignal} = {}) {
  let since = 0;
  let pages = 0;

  while (++pages <= maxPages) {
    const pageUrl = `${FEED_URL}?${new URLSearchParams({
      since: String(since),
      limit: String(PAGE_LIMIT)
    })}`;
    const fetched_at = new Date();
    const {results, last_seq} = v.parse(ChangesSchema, await fetchJson(pageUrl, {signal}));
    yield {results, fetched_at};
    if (results.length < PAGE_LIMIT) break;
    if (last_seq <= since) {
      console.warn(`Feed stalled at seq ${since} with a full page.`);
      break;
    }
    since = last_seq;
  }
}
