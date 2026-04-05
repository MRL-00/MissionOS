/**
 * Timezone-aware date formatting utilities.
 *
 * All helpers accept a `timeZone` IANA string (e.g. "Pacific/Auckland").
 * When the value is empty or "auto", the browser's local timezone is used.
 */

/** Resolve "auto" / blank to `undefined` so Intl uses the runtime default. */
function resolveTimeZone(tz: string | undefined): string | undefined {
  if (!tz || tz === "auto") return undefined;
  return tz;
}

/**
 * Full date + time string, e.g. "4/6/2026, 3:42:15 PM"
 * Replacement for `date.toLocaleString()`.
 */
export function formatDateTime(
  value: string | number | Date,
  timeZone?: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { timeZone: resolveTimeZone(timeZone) });
}

/**
 * Date-only string, e.g. "4/6/2026"
 * Replacement for `date.toLocaleDateString()`.
 */
export function formatDate(
  value: string | number | Date,
  timeZone?: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { timeZone: resolveTimeZone(timeZone) });
}
