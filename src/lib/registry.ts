import * as v from "valibot";
import { UInt53 } from "./schema.ts";
import {setTimeout as setTimeoutPromise} from "node:timers/promises";

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

async function fetchJson(url: string, {attempts = 3, signal}: {attempts?: number, signal?: AbortSignal}): Promise<{time: Date, retries: number[], data: unknown}> {
  let attempt = 0;
  const retries: number[] = [];
  while(true) {
    const time = new Date();
    const response = await fetch(url, {
      headers: {accept: "application/json"},
      signal
    });
    if(response.ok) return {time, retries, data: await response.json()};
    await response.body?.cancel();
    // The npm endpoints aren't rate limited, but gateway timeouts
    // have started to happen surprisingly often.
    if(++attempt < attempts && [500, 504].includes(response.status)) {
      retries.push(response.status);
      await setTimeoutPromise(attempt * 5000, null, {signal});
      continue;
    }
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
}

export async function fetchFeedInfo({signal}: {signal?: AbortSignal} = {}) {
  const {data} = await fetchJson(INFO_URL, {signal});
  return v.parse(InfoSchema, data);
}

export async function* fetchChanges({maxPages = Infinity, signal}: {maxPages?: number, signal?: AbortSignal} = {}) {
  let since = 0;
  let pages = 0;

  while (++pages <= maxPages) {
    const pageUrl = `${FEED_URL}?${new URLSearchParams({
      since: String(since),
      limit: String(PAGE_LIMIT)
    })}`;
    
    const {time, data, retries} = await fetchJson(pageUrl, {signal});
    const {results, last_seq} = v.parse(ChangesSchema, data);
    yield {results, fetched_at: time, retries};
    if (results.length < PAGE_LIMIT) break;
    if (last_seq <= since) {
      console.warn(`Feed stalled at seq ${since} with a full page.`);
      break;
    }
    since = last_seq;
  }
}
