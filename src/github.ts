import { writeFile } from "node:fs/promises";
import { Octokit } from "octokit";

/** Downloads a release asset to `dest`. Returns false if the release or asset does not exist. */
export async function downloadReleaseAsset(
  repository: string,
  tag: string,
  assetName: string,
  dest: string,
): Promise<boolean> {
  const [owner, repo] = repository.split("/");
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const release = await octokit.rest.repos.getReleaseByTag({ owner, repo, tag }).catch((error) => {
    if (error.status === 404) return null;
    throw error;
  });
  const asset = release?.data.assets.find((a) => a.name === assetName);
  if (!asset) return false;

  const download = await octokit.rest.repos.getReleaseAsset({
    owner,
    repo,
    asset_id: asset.id,
    headers: { accept: "application/octet-stream" },
  });
  await writeFile(dest, Buffer.from(download.data as unknown as ArrayBuffer));
  return true;
}
