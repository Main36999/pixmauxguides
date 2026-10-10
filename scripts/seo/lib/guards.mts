/**
 * scripts/seo/lib/guards.mts — the two run-time checks the typed modules use
 * where the JavaScript read a property off a value of unknown shape.
 *
 * Pure: no fs.
 */

/** A non-null object (arrays included), so its properties can be read. */
export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

/** `err.message` for a thrown object; undefined for a thrown primitive, as reading the property was. */
export const messageOf = (err: unknown): unknown => (isRecord(err) ? err.message : undefined);
