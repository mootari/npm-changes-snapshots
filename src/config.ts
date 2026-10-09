import * as v from "valibot";

const Flag = v.pipe(
  v.picklist(["true", "false"]),
  v.transform((value) => value === "true"),
);

const RepositorySchema = v.pipe(
  v.string(),
  v.regex(/^[^/]+\/[^/]+$/, "Expected owner/repo"),
  v.transform((value) => {
    const [owner, repo] = value.split("/");
    return { owner, repo };
  }),
);

const ConfigSchema = v.pipe(
  v.object({
    OUT_DIR: v.optional(v.string(), "out"),
    FEED_URL: v.optional(v.pipe(v.string(), v.url())),
    GITHUB_REPOSITORY: v.optional(RepositorySchema),
    GITHUB_TOKEN: v.optional(v.string()),
    DRAFT: v.optional(Flag, "false"),
    MAX_PAGES: v.optional(v.pipe(v.string(), v.toNumber(), v.integer())),
  }),
  v.transform((env) => ({
    outDir: env.OUT_DIR,
    feedUrl: env.FEED_URL,
    changesUrl: env.FEED_URL && new URL("registry/_changes", env.FEED_URL).href,
    repository: env.GITHUB_REPOSITORY,
    token: env.GITHUB_TOKEN,
    draft: env.DRAFT,
    maxPages: env.MAX_PAGES
  })),
);

export type Config = v.InferOutput<typeof ConfigSchema>;

export const parseConfig = (env: NodeJS.ProcessEnv): Config => v.parse(ConfigSchema, env);
