// Toolchain self-test: typed ESM that tsc checks and Node 24 runs by
// stripping the types. Not part of scripts/seo.
import path from "node:path";
import { createHash } from "node:crypto";

export type Severity = "error" | "warning" | "info";
export const SEVERITY_ORDER = ["error", "warning", "info"] as const satisfies readonly Severity[];

export interface PageRef {
  readonly url: string;
  readonly line?: number;
}

export function label(page: PageRef, severity: Severity): string {
  return `${severity} ${page.url}${page.line ? `:${page.line}` : ""}`;
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

if (import.meta.main) {
  console.log(label({ url: "/about", line: 3 }, "warning"));
  console.log(path.posix.join("scripts", "seo"));
  console.log(sha256("bpozz").slice(0, 12));
}
