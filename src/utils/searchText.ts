/** Case-insensitive indexOf; returns index in the original haystack. */
export function indexOfIgnoreCase(haystack: string, needle: string, fromIndex = 0): number {
  if (!needle) return fromIndex <= haystack.length ? fromIndex : -1
  return haystack.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase(), fromIndex)
}
