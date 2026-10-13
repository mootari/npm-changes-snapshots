import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { Octokit } from "octokit";

export const createOctokit = (token?: string) => new Octokit({ auth: token });

export async function fetchLatestRelease(octokit: Octokit, {owner, repo, signal}: {owner: string, repo: string, signal?: AbortSignal}) {
  const per_page = 10;
  let page = 1;
  // Releases are listed newest first.
  while(true) {
    const {data: releases} = await octokit.rest.repos.listReleases({owner, repo, per_page, page, request: {signal}});
    for (const release of releases) if (!release.draft) return {
      url: release.html_url,
      tag: release.tag_name,
      created: release.created_at,
      assetIds: Object.fromEntries(release.assets.map(d => [d.name, d.id])),
    };
    if(releases.length < per_page) return null;
    page++;
  }
}

export async function downloadAsset(octokit: Octokit, {owner, repo, id, dest, signal}: {owner: string, repo: string, id: number, dest: string, signal?: AbortSignal}): Promise<void> {
  // Adapted from https://github.com/octokit/types.ts/issues/606
  const {data} = await octokit.rest.repos.getReleaseAsset({
    owner,
    repo,
    asset_id: id,
    headers: {
      accept: "application/octet-stream"
    },
    request: {
      parseSuccessResponseBody: false,
      signal,
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
export async function createRelease(octokit: Octokit, {owner, repo, release, paths, signal}: {
  owner: string,
  repo: string,
  release: { tag: string; title: string; notes: string; draft: boolean },
  paths: string[],
  signal?: AbortSignal
}): Promise<void> {
  const { data } = await octokit.rest.repos.createRelease({
    owner,
    repo,
    tag_name: release.tag,
    name: release.title,
    body: release.notes,
    draft: true,
    request: {signal}
  });

  for (const path of paths) {
    await octokit.rest.repos.uploadReleaseAsset({
      owner,
      repo,
      release_id: data.id,
      name: basename(path),
      data: (await readFile(path, {signal})) as unknown as string,
      headers: { "content-type": "application/octet-stream" },
      request: {signal}
    });
  }

  if(release.draft) return;
  await octokit.rest.repos.updateRelease({
    owner,
    repo,
    release_id: data.id,
    draft: false,
    request: {signal}
  });
}
