import * as v from "valibot";

export const UInt53 = v.pipe(v.number(), v.minValue(0), v.safeInteger());

export const GithubProject = v.pipe(
  v.string(),
  v.regex(/^[^/]+\/[^/]+$/),
  v.transform(s => {
    const [owner, repo] = s.split("/");
    return {owner, repo};
  }
));

export const ParquetPath = v.pipe(v.string(), v.endsWith(".parquet"));

export const SNAPSHOT_FILE = "snapshot.parquet";
