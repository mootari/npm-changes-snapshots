import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { Octokit } from "octokit";

export const createOctokit = (token?: string) => new Octokit({ auth: token });

export type Repository = { owner: string; repo: string };

/**
 * Downloads the named asset from the most recent published release that has it.
 * Returns the tag and creation time of that release, or null if there is none.
 */
export async function downloadLatestAsset(
  octokit: Octokit,
  { owner, repo }: Repository,
  assetName: string,
  dest: string,
): Promise<{ tag: string; time: string } | null> {
  // Releases are listed newest first.
  for await (const { data: releases } of octokit.paginate.iterator(octokit.rest.repos.listReleases, { owner, repo })) {
    for (const release of releases) {
      if (release.draft) continue;
      const asset = release.assets.find((a) => a.name === assetName);
      if (!asset) continue;

      const download = await octokit.rest.repos.getReleaseAsset({
        owner,
        repo,
        asset_id: asset.id,
        headers: { accept: "application/octet-stream" },
      });
      await writeFile(dest, Buffer.from(download.data as unknown as ArrayBuffer));
      return { tag: release.tag_name, time: release.created_at };
    }
  }
  return null;
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
