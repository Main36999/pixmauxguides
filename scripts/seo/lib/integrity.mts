/**
 * scripts/seo/lib/integrity.mts — compares the dist/ inventory with the
 * approved output manifest.
 *
 * The checker reports on dist/ only when every file in it is byte-identical
 * to scripts/qa/approved-output.json: the same set of paths, the same sha256
 * for each. A stale, partial or hand-edited dist/ would make the findings
 * describe something that is not the approved site, so any difference stops
 * the run before a report is written.
 *
 * Pure: takes { path: sha256 } maps.
 */

import { isRecord } from "./guards.mts";
import type { FileHashes, ManifestDiff } from "../types.mts";

export function compareManifest(actual: FileHashes, approved: FileHashes): ManifestDiff {
  const added = Object.keys(actual).filter((f) => !Object.prototype.hasOwnProperty.call(approved, f)).sort();
  const removed = Object.keys(approved).filter((f) => !Object.prototype.hasOwnProperty.call(actual, f)).sort();
  const changed = Object.keys(actual)
    .filter((f) => Object.prototype.hasOwnProperty.call(approved, f) && approved[f] !== actual[f])
    .sort();
  return { added, removed, changed, ok: !added.length && !removed.length && !changed.length };
}

/**
 * Problems with the manifest itself, before any file is compared against it.
 * `algorithm` and `count` are checked only when the manifest declares them;
 * scripts/qa/approved-output.json does declare both (src/build/build.js,
 * verify stage).
 */
export function validateManifest(manifest: unknown): string[] {
  if (!isRecord(manifest) || Array.isArray(manifest)) return ["the manifest is not a JSON object"];
  const problems: string[] = [];
  const files = manifest.files;
  const hasFiles = isRecord(files) && !Array.isArray(files);
  if (!hasFiles) problems.push('the manifest has no "files" map');
  if (manifest.algorithm !== undefined && manifest.algorithm !== "sha256") {
    problems.push(`the manifest declares algorithm "${manifest.algorithm}"; this checker compares sha256`);
  }
  if (manifest.count !== undefined && hasFiles && manifest.count !== Object.keys(files).length) {
    problems.push(`the manifest declares count ${manifest.count} but lists ${Object.keys(files).length} files`);
  }
  return problems;
}
