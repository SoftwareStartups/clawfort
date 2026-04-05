import { createHash } from "crypto";

export function contentHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}
