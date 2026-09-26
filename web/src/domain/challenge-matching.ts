/** Pure summary matching; parity with maimai_analyzer.challenge_similarity.query_demands. */
export interface ComparisonProfile {
  version?: string;
  chart_id: string;
  song_id?: string;
  song_family?: string;
  demand?: Record<string, Record<string, number | null>> | null;
}
export interface PatternComparison {
  patternDistance: number | null;
}
export interface SimilarOptions<
  P extends ComparisonProfile,
  R extends PatternComparison = PatternComparison,
> {
  limit?: number;
  eligibleIds?: Iterable<string> | null;
  patternCompare?: ((left: P, right: P) => R | null | undefined) | null;
}
export interface SimilarResult<R extends PatternComparison> {
  chart_id: string;
  distance: number;
  closest_groups: string[];
  largest_difference: string;
  patterns?: R | null;
  patternDistance?: number | null;
  rankDistance?: number;
}
const groups = ['cadence', 'rhythm', 'coordination', 'holds', 'slides', 'spatial'] as const;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function bound(values: number[], x: number, upper: boolean) {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < x || (upper && values[mid] === x)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
export function createIndex<P extends ComparisonProfile>(profiles: P[]) {
  profiles = profiles.filter((c) => c.version !== 'registry-chart-1');
  const byId = new Map<string, P>(),
    scale = new Map<string, number[]>();
  for (const profile of profiles) {
    if (profile.version !== 'challenge-profile-1-experimental' || byId.has(profile.chart_id))
      throw new Error('Incompatible comparison profile');
    byId.set(profile.chart_id, profile);
    for (const group of groups)
      for (const [key, value] of Object.entries(profile.demand![group] || {})) {
        if (typeof value !== 'number' || !Number.isFinite(value))
          throw new Error('Invalid comparison measurement');
        const name = group + '.' + key;
        if (!scale.has(name)) scale.set(name, []);
        scale.get(name)!.push(value);
      }
  }
  for (const values of scale.values()) values.sort((a, b) => a - b);
  const vectors = new Map(
    profiles.map((profile) => [
      profile.chart_id,
      Object.fromEntries(
        groups.map((group) => [
          group,
          Object.fromEntries(
            Object.entries(profile.demand![group] || {}).map(([key, value]) => {
              const sorted = scale.get(group + '.' + key)!;
              return [
                key,
                (bound(sorted, value!, false) + bound(sorted, value!, true)) / (2 * sorted.length),
              ];
            }),
          ),
        ]),
      ),
    ]),
  );
  function compare(leftId: string, rightId: string) {
    const left = vectors.get(leftId),
      right = vectors.get(rightId);
    if (!left || !right) throw new Error('Chart is not in this catalog');
    const differences: Record<string, number> = {};
    for (const group of groups) {
      const keys = Object.keys(left[group])
        .filter((k) => Object.hasOwn(right[group], k))
        .sort();
      if (keys.length)
        differences[group] = mean(keys.map((k) => Math.abs(left[group][k] - right[group][k])));
    }
    if (Object.keys(differences).length < 4) return null;
    const closest = Object.keys(differences).sort(
      (a, b) => differences[a] - differences[b] || order(a, b),
    );
    const largest = Object.keys(differences).sort(
      (a, b) => differences[b] - differences[a] || order(b, a),
    )[0];
    return {
      distance: Math.round(mean(Object.values(differences)) * 1e6) / 1e6,
      closest_groups: closest.slice(0, 2),
      largest_difference: largest,
    };
  }
  function similar<R extends PatternComparison = PatternComparison>(
    id: string,
    { limit = 8, eligibleIds = null, patternCompare = null }: SimilarOptions<P, R> = {},
  ) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Result limit must be 1..100');
    const query = byId.get(id);
    if (!query) throw new Error('Chart is not in this catalog');
    const family = query.song_family ?? query.song_id,
      allowed = eligibleIds && new Set(eligibleIds),
      rows: SimilarResult<R>[] = [];
    for (const candidate of profiles) {
      if (
        candidate.chart_id === id ||
        (candidate.song_family ?? candidate.song_id) === family ||
        (allowed && !allowed.has(candidate.chart_id))
      )
        continue;
      const result = compare(id, candidate.chart_id);
      if (result) {
        const patterns = patternCompare?.(query, candidate),
          patternDistance = patterns?.patternDistance ?? null;
        rows.push({
          chart_id: candidate.chart_id,
          ...result,
          ...(patternCompare
            ? {
                patterns,
                patternDistance,
                rankDistance:
                  patternDistance == null
                    ? result.distance
                    : 0.6 * patternDistance + 0.4 * result.distance,
              }
            : {}),
        });
      }
    }
    rows.sort((a, b) =>
      patternCompare
        ? Number(a.patternDistance == null) - Number(b.patternDistance == null) ||
          a.rankDistance! - b.rankDistance! ||
          order(a.chart_id, b.chart_id)
        : a.distance - b.distance || order(a.chart_id, b.chart_id),
    );
    const found: SimilarResult<R>[] = [],
      families = new Set<string | undefined>();
    for (const row of rows) {
      const candidate = byId.get(row.chart_id)!,
        key = candidate.song_family ?? candidate.song_id;
      if (families.has(key)) continue;
      families.add(key);
      found.push(row);
      if (found.length === limit) break;
    }
    return found;
  }
  return Object.freeze({ compare, similar });
}
