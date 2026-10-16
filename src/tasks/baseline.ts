import { readParquetKvMetadata } from "../lib/duckdb.ts";
import { createOctokit, fetchRelease } from "../lib/github.ts";
import { SNAPSHOT_FILE } from "../lib/schema.ts";
import { RunInfoSchema } from "./snapshot.ts";
import {isValiError} from "valibot";

export async function findBaseline(project: {owner: string, repo: string}, options: {
  tag?: string,
  assetName?: string,
  skipMetadata?: boolean,
  token?: string,
  signal?: AbortSignal
}) {
  const {tag, assetName = SNAPSHOT_FILE, skipMetadata = false, token, signal} = options;

  const octokit = createOctokit(token);
  const release = await fetchRelease(octokit, {...project, tag, signal});
  if(!release) {
    throw new Error(tag ? `Release ${tag} not found` : "No latest release found");
  }
  const asset = release.assets[assetName];
  if(!asset) {
    throw new Error(`${tag ? "Release" : `Latest release`} ${release.tag} has no asset "${assetName}"`);
  }
  if(!skipMetadata) {
    try {
      await readParquetKvMetadata(asset.download_url, "run_info", RunInfoSchema);
    }
    catch(error) {
      if(isValiError(error)) {
        throw new Error("Run info is missing or incompatible", {cause: error});
      }
      throw error;
    }
  }
  return {
    tag: release.tag,
    created: release.created,
    id: asset.id,
    sha256: asset.sha256,
    download_url: asset.download_url
  };
}
