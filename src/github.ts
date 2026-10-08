import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { Octokit } from "octokit";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

function parseRepository(repository: string) {
  const [owner, repo] = repository.split("/");
  return { owner, repo };
}

/**
 * Downloads the named asset from the most recent release that has it.
 * Returns the tag of that release, or null if there is none.
 */
export async function downloadLatestAsset(repository: string, assetName: string, dest: string): Promise<string | null> {
  const target = parseRepository(repository);

  // Releases are listed newest first.
  for await (const { data: releases } of octokit.paginate.iterator(octokit.rest.repos.listReleases, target)) {
    for (const release of releases) {
      const asset = release.assets.find((a) => a.name === assetName);
      if (!asset) continue;

      const download = await octokit.rest.repos.getReleaseAsset({
        ...target,
        asset_id: asset.id,
        headers: { accept: "application/octet-stream" },
      });
      await writeFile(dest, Buffer.from(download.data as unknown as ArrayBuffer));
      return release.tag_name;
    }
  }
  return null;
}

/** Creates a release and uploads the files at `paths` as its assets. */
export async function createRelease(
  repository: string,
  release: { tag: string; title: string; notes: string },
  paths: string[],
): Promise<void> {
  const target = parseRepository(repository);
  const { data } = await octokit.rest.repos.createRelease({
    ...target,
    tag_name: release.tag,
    name: release.title,
    body: release.notes,
  });
  for (const path of paths) {
    await octokit.rest.repos.uploadReleaseAsset({
      ...target,
      release_id: data.id,
      name: basename(path),
      data: (await readFile(path)) as unknown as string,
      headers: { "content-type": "application/octet-stream" },
    });
  }
}
