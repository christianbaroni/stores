/**
 * Returns a pluralized (by default: `word` + `'s'`) string based on the count.
 *
 * `word` should be provided in singular form.
 */
export function pluralize(word: string, count: number, pluralSuffix = 's'): string {
  return count === 1 ? word : `${word}${pluralSuffix}`;
}
