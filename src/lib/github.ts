import { Octokit, RequestError } from "octokit";

export const createOctokit = (token?: string) => new Octokit({ auth: token });

export async function fetchRelease(octokit: Octokit, {owner, repo, tag, signal}: {owner: string, repo: string, tag?: string, signal?: AbortSignal}) {
  try {
    const {data} = tag
      ? await octokit.rest.repos.getReleaseByTag({owner, repo, tag, request: {signal}})
      : await octokit.rest.repos.getLatestRelease({owner, repo, request: {signal}});
    return {
      url: data.html_url,
      tag: data.tag_name,
      created: data.created_at,
      assets: Object.fromEntries(
        data.assets.map(d => [d.name, ({
          name: d.name,
          // Technically the digest should always use sha256
          sha256: d.digest?.match(/^sha256:([0-9a-f]{64})$/)?.[1] ?? null,
          id: d.id,
          download_url: d.browser_download_url,
        })])
      ),
    };
  }
  catch(error) {
    if(error instanceof RequestError && error.status === 404) return null;
    throw error;
  }
}

type ReleaseStub = {owner: string, repo: string, id: number};

export async function createDraftRelease(octokit: Octokit, {owner, repo, tag, title, notes, signal}: {
  owner: string;
  repo: string;
  tag: string;
  title: string;
  notes: string;
  signal?: AbortSignal
}): Promise<ReleaseStub> {
  const { data } = await octokit.rest.repos.createRelease({
    owner,
    repo,
    tag_name: tag,
    name: title,
    body: notes,
    draft: true,
    request: {signal}
  });
  return {owner, repo, id: data.id};
}

export async function uploadReleaseAsset(octokit: Octokit, {release, name, body, signal}: {
  release: ReleaseStub,
  name: string,
  body: string | File | Uint8Array | Blob,
  signal?: AbortSignal
}) {
  await octokit.rest.repos.uploadReleaseAsset({
    owner: release.owner,
    repo: release.repo,
    release_id: release.id,
    name,
    headers: { "content-type": "application/octet-stream" },
    // Octokit types don't account for the request content-type
    data: body as string,
    request: {signal}
  });
}

export async function publishRelease(octokit: Octokit, {release, signal}: {
  release: ReleaseStub,
  signal?: AbortSignal
}) {
  await octokit.rest.repos.updateRelease({
    owner: release.owner,
    repo: release.repo,
    release_id: release.id,
    draft: false,
    request: {signal}
  });
}
