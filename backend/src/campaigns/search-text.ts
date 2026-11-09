/** Strips characters that have meaning inside PostgREST filters / LIKE patterns, then trims. */
export function sanitizeSearchText(text?: string): string {
  return (text ?? '').replaceAll(/[%_,()]/g, ' ').trim();
}
