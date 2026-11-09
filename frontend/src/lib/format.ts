/** Display helpers. `null`/`undefined` always render as an em dash: missing is never shown as 0. */
export const MISSING_VALUE = '—';

export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const formatInteger = (value: number | null | undefined): string => (isNumber(value) ? Math.round(value).toLocaleString() : MISSING_VALUE);

export const formatCompact = (value: number | null | undefined): string =>
  isNumber(value) ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value) : MISSING_VALUE;

export const formatDecimal = (value: number | null | undefined, digits = 2): string =>
  isNumber(value) ? value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : MISSING_VALUE;

export const formatPercent = (value: number | null | undefined, digits = 2): string =>
  isNumber(value) ? `${formatDecimal(value, digits)}%` : MISSING_VALUE;

export const formatMoney = (value: number | null | undefined, currency?: string | null): string => {
  if (!isNumber(value)) return MISSING_VALUE;
  try {
    return value.toLocaleString(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 });
  } catch {
    return formatDecimal(value); // unknown currency code
  }
};

export const formatDateTime = (isoText?: string | null, timezone?: string): string =>
  isoText ? new Date(isoText).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }) : MISSING_VALUE;

export const formatDay = (isoDay?: string | null): string =>
  isoDay ? new Date(`${isoDay}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) : MISSING_VALUE;

/** Milliseconds the timezone is ahead of UTC at the given instant. */
const timezoneOffsetMs = (instantMs: number, timezone: string): number => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(instantMs)
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - instantMs;
};

/** "2026-03-01T09:00" interpreted as wall-clock time in `timezone` -> UTC ISO string. */
export function zonedToUtcIso(localDateTime: string, timezone: string): string {
  const [datePart, timePart] = localDateTime.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallClockAsUtc;
  for (let iteration = 0; iteration < 3; iteration++) instant = wallClockAsUtc - timezoneOffsetMs(instant, timezone);
  return new Date(instant).toISOString();
}

/** UTC ISO -> "YYYY-MM-DDTHH:mm" wall-clock in `timezone` (for datetime-local inputs). */
export function utcToZonedLocal(isoText: string, timezone: string): string {
  const instant = Date.parse(isoText);
  return new Date(instant + timezoneOffsetMs(instant, timezone)).toISOString().slice(0, 16);
}

export const todayIso = (now: Date = new Date()): string => now.toISOString().slice(0, 10);
export const daysAgoIso = (days: number, now: Date = new Date()): string => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
