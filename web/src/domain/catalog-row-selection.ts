export interface CatalogRowSelection<T> {
  index: number;
  row: T;
}

/** Keep pagination as a prefix, with one matching route target outside it.
 * The caller supplies already filtered, uniquely identified, sorted rows.
 * Returned indices always refer to that list, including the extra target.
 */
export function selectCatalogRows<T extends { key: string }>(
  rows: readonly T[],
  visible: number,
  focusedKey: string | null,
): CatalogRowSelection<T>[] {
  if (!Number.isSafeInteger(visible) || visible < 0) {
    throw new RangeError('Catalog prefix must be a nonnegative safe integer');
  }
  const count = Math.min(visible, rows.length);
  const selected = rows.slice(0, count).map((row, index) => ({ index, row }));
  const index = focusedKey === null ? -1 : rows.findIndex((row) => row.key === focusedKey);
  if (index >= count) selected.push({ index, row: rows[index]! });
  return selected;
}
