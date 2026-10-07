export type BpmOperator = 'lte' | 'eq' | 'gte';

export interface BpmFilterValue {
  operator: BpmOperator;
  value: number | null;
}

export const bpmSymbols: Record<BpmOperator, string> = { lte: '≤', eq: '=', gte: '≥' };

export function isBpmOperator(value: unknown): value is BpmOperator {
  return value === 'lte' || value === 'eq' || value === 'gte';
}

export function isPositiveBpm(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Empty is unrestricted; undefined is an invalid draft, not zero or "any".
 * Decimal commas and full-width digits support the existing localized keyboards.
 * Group separators, exponents and trailing prose are deliberately not parsed.
 */
export function parseBpmInput(input: string): number | null | undefined {
  const text = input.normalize('NFKC').trim().replace(',', '.');
  if (!text) return null;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return undefined;
  const value = Number(text);
  return isPositiveBpm(value) ? value : undefined;
}

/** Keep valid extreme decimals editable without introducing exponent syntax. */
export function formatBpmInput(value: number | null): string {
  if (value === null) return '';
  const [coefficient, exponent] = String(value).split('e');
  if (exponent === undefined) return coefficient;
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return '0.' + '0'.repeat(-point) + digits;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return digits.slice(0, point) + '.' + digits.slice(point);
}

/** Saved state is untrusted. Older snapshots have no BPM filter. */
export function restoreBpmFilter(value: unknown): BpmFilterValue {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const saved = value as Record<string, unknown>;
    if (isBpmOperator(saved.operator) && (saved.value === null || isPositiveBpm(saved.value)))
      return { operator: saved.operator, value: saved.value };
  }
  return { operator: 'eq', value: null };
}

/** Compare the catalog BPM, never a derived average, maximum or missing-as-zero. */
export function matchesBpm(bpm: unknown, filter: BpmFilterValue): boolean {
  if (filter.value === null) return true;
  if (!isPositiveBpm(bpm) || !isPositiveBpm(filter.value)) return false;
  switch (filter.operator) {
    case 'lte':
      return bpm <= filter.value;
    case 'eq':
      return bpm === filter.value;
    case 'gte':
      return bpm >= filter.value;
    default:
      return false;
  }
}
