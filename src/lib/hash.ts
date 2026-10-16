import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

export function sha256(str: string) {
  return createHash("sha256").update(str).digest("hex");
}

export async function fileSha256(path: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}
