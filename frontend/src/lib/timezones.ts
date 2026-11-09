/** IANA timezones the browser knows, or just UTC on very old engines. */
export function listTimezones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  return typeof supported === 'function' ? supported('timeZone') : ['UTC'];
}

export const browserTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
