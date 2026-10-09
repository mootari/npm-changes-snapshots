import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Octokit } from "octokit";

export const createOctokit = (token?: string) => new Octokit({ auth: token });

export type Repository = { owner: string; repo: string };

/**
 * Downloads the assets in `dests` (asset name to destination path) from the most recent published
 * release that has all of them. Returns the tag and creation time of that release, or null if there is none.
 */
export async function downloadLatestAssets(
  octokit: Octokit,
  { owner, repo }: Repository,
  dests: Record<string, string>,
): Promise<{ tag: string; time: string } | null> {
  // Releases are listed newest first.
  for await (const { data: releases } of octokit.paginate.iterator(octokit.rest.repos.listReleases, { owner, repo, per_page: 10 })) {
    for (const release of releases) {
      if (release.draft) continue;

      const assetIds = Object.fromEntries(release.assets.map(d => [d.name, d.id]));
      const matched = Object.entries(dests).map(([name, dest]) => ({ name, dest, id: assetIds[name]}));
      const missing = matched.filter(d => !d.id).map(d => d.name);
      if(missing.length) throw new Error(`Release "${release.tag_name}" is missing the following assets: ${missing.join(", ")}`);

      for (const { id, dest } of matched) await downloadAsset(octokit, {repo, owner, id, dest});
      return { tag: release.tag_name, time: release.created_at };
    }
  }
  return null;
}

async function downloadAsset(octokit: Octokit, {owner, repo, id, dest}: {owner: string, repo: string, id: number, dest: string}): Promise<void> {
  // Adapted from https://github.com/octokit/types.ts/issues/606
  const {data} = await octokit.rest.repos.getReleaseAsset({
    owner,
    repo,
    asset_id: id,
    headers: {
      accept: "application/octet-stream"
    },
    request: {
      parseSuccessResponseBody: false
    },
  });
  // Octokit types don't account for response options. See https://github.com/octokit/types.ts/issues/606
  await pipeline(data as unknown as NodeJS.ReadableStream, createWriteStream(dest));
}

/**
 * Creates a release and uploads the files at `paths` as its assets.
 * The release is created as a draft and only published after all assets are uploaded,
 * unless `release.draft` is set.
 */
export async function createRelease(
  octokit: Octokit,
  { owner, repo }: Repository,
  release: { tag: string; title: string; notes: string; draft: boolean },
  paths: string[],
): Promise<void> {
  const { data } = await octokit.rest.repos.createRelease({
    owner,
    repo,
    tag_name: release.tag,
    name: release.title,
    body: release.notes,
    draft: true,
  });
  for (const path of paths) {
    await octokit.rest.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: data.id,
      name: basename(path),
      data: (await readFile(path)) as unknown as string,
      headers: { "content-type": "application/octet-stream" },
    });
  }
  if (!release.draft) {
    await octokit.rest.repos.updateRelease({ owner, repo, release_id: data.id, draft: false });
  }
}
