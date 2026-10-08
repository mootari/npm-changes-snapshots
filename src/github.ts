import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { Octokit } from "octokit";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

function parseRepository(repository: string) {
  const [owner, repo] = repository.split("/");
  return { owner, repo };
}

/** Downloads a release asset to `dest`. Returns false if the release or asset does not exist. */
export async function downloadReleaseAsset(
  repository: string,
  tag: string,
  assetName: string,
  dest: string,
): Promise<boolean> {
  const target = parseRepository(repository);

  const release = await octokit.rest.repos.getReleaseByTag({ ...target, tag }).catch((error) => {
    if (error.status === 404) return null;
    throw error;
  });
  const asset = release?.data.assets.find((a) => a.name === assetName);
  if (!asset) return false;

  const download = await octokit.rest.repos.getReleaseAsset({
    ...target,
    asset_id: asset.id,
    headers: { accept: "application/octet-stream" },
  });
  await writeFile(dest, Buffer.from(download.data as unknown as ArrayBuffer));
  return true;
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
