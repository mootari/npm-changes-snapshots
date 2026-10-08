import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";

interface Release {
  assets: { name: string; url: string }[];
}

function headers(accept: string): Record<string, string> {
  const result: Record<string, string> = { accept, "x-github-api-version": "2022-11-28" };
  const token = process.env.GITHUB_TOKEN;
  if (token) result.authorization = ["Bearer", token].join(" ");
  return result;
}

/** Downloads a release asset to `dest`. Returns false if the release or asset does not exist. */
export async function downloadReleaseAsset(
  repository: string,
  tag: string,
  assetName: string,
  dest: string,
): Promise<boolean> {
  const api = `https://api.github.com/repos/${repository}`;
  const releaseResponse = await fetch(`${api}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: headers("application/vnd.github+json"),
  });
  if (releaseResponse.status === 404) return false;
  if (!releaseResponse.ok) throw new Error(`Fetching release ${tag} failed: HTTP ${releaseResponse.status}`);

  const asset = ((await releaseResponse.json()) as Release).assets.find((a) => a.name === assetName);
  if (!asset) return false;

  const download = await fetch(asset.url, { headers: headers("application/octet-stream") });
  if (!download.ok || !download.body) throw new Error(`Downloading ${assetName} failed: HTTP ${download.status}`);
  await pipeline(Readable.fromWeb(download.body as ReadableStream), createWriteStream(dest));
  return true;
}
