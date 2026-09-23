/** Pure historical research decoding and comparison, shared by every presentation. */
export interface AnalysisIdentity {
  chart_id: string;
  source_hash: string;
}
export type AnalysisStatus = 'unknown' | 'detected' | 'not-detected-with-supported-coverage';
export type Span = [number, number];
export interface AnalysisTag {
  id: string;
  status: AnalysisStatus;
  count: number | null;
  prevalence: number | null;
  coverage: 'complete' | 'partial';
  truncated: boolean;
  spans: Span[];
  evidence: unknown[];
}
type DenseTag = [
  number,
  AnalysisStatus,
  number | null,
  number | null,
  'complete' | 'partial',
  boolean,
  Span[],
  unknown[]?,
];
type SparseTag = [number, number, number | null, number | null, Span[], unknown[]];
export interface AnalysisRecord {
  source_hash: string;
  tags: (DenseTag | SparseTag)[];
  absent?: number[];
  span?: Span;
  segments?: [number, number, number | null, number | null, number][];
  flow_peak?: number;
  [key: string]: unknown;
}
interface AnalysisPack {
  version: string;
  representation?: string;
  patterns: string[];
  charts: Record<string, AnalysisRecord>;
  evidence_pool?: unknown[];
}
function supported(value: unknown): value is AnalysisPack {
  if (!value || typeof value !== 'object') return false;
  const pack = value as Partial<AnalysisPack>;
  return (
    ['research-overview-1', 'research-overview-2'].includes(pack.version ?? '') &&
    [undefined, 'sparse-tags-1', 'sparse-tags-2', 'sparse-tags-3'].includes(pack.representation) &&
    Array.isArray(pack.patterns) &&
    pack.patterns.every((id) => typeof id === 'string') &&
    !!pack.charts &&
    typeof pack.charts === 'object'
  );
}
export type AnalysisModel = ReturnType<typeof createAnalysisModel>;
export function createAnalysisModel(input: unknown, catalog: readonly AnalysisIdentity[]) {
  const pack = supported(input) ? input : null;
  const get = (chart: AnalysisIdentity): AnalysisRecord | null => {
    const record = pack?.charts[chart.chart_id];
    return record?.source_hash === chart.source_hash ? record : null;
  };
  function tags(chart: AnalysisIdentity): AnalysisTag[] {
    const record = get(chart);
    if (!record || !pack) return [];
    let rows: DenseTag[];
    if (['sparse-tags-2', 'sparse-tags-3'].includes(pack.representation ?? '')) {
      rows = (record.tags as SparseTag[]).map((tag) => [
        tag[0],
        (['unknown', 'detected', 'not-detected-with-supported-coverage'] as const)[tag[1] & 3],
        tag[2],
        tag[3],
        tag[1] & 4 ? 'complete' : 'partial',
        !!(tag[1] & 8),
        tag[4],
        pack.evidence_pool ? tag[5].map((index) => pack.evidence_pool![index as number]) : tag[5],
      ]);
    } else rows = record.tags as DenseTag[];
    if (pack.representation?.startsWith('sparse-tags-')) {
      const present = new Map(rows.map((tag) => [tag[0], tag])),
        absent = new Set(record.absent ?? []);
      rows = pack.patterns.map(
        (_, index) =>
          present.get(index) ??
          (absent.has(index)
            ? [index, 'not-detected-with-supported-coverage', 0, 0, 'complete', false, []]
            : [index, 'unknown', null, null, 'partial', false, []]),
      );
    }
    return rows.map((tag) => ({
      id: pack.patterns[tag[0]],
      status: tag[1],
      count: tag[2],
      prevalence: tag[3],
      coverage: tag[4],
      truncated: tag[5],
      spans: tag[6],
      evidence: tag[7] ?? [],
    }));
  }
  const detected = (chart: AnalysisIdentity) =>
    tags(chart)
      .filter((tag) => tag.status === 'detected')
      .sort(
        (a, b) =>
          Number(a.id.startsWith('trait.')) - Number(b.id.startsWith('trait.')) ||
          (b.prevalence ?? 0) - (a.prevalence ?? 0) ||
          (b.count ?? 0) - (a.count ?? 0) ||
          a.id.localeCompare(b.id),
      );
  function rate(chart: AnalysisIdentity, tag: AnalysisTag): number | null {
    const span = get(chart)?.span;
    return span && span[1] > span[0] && tag.count != null
      ? (tag.count * 60e6) / (span[1] - span[0])
      : null;
  }
  const frequency = new Map<string, number>(),
    coverage = new Map<string, number>();
  for (const chart of catalog)
    for (const tag of tags(chart)) {
      if (tag.status !== 'unknown') coverage.set(tag.id, (coverage.get(tag.id) ?? 0) + 1);
      if (tag.status === 'detected') frequency.set(tag.id, (frequency.get(tag.id) ?? 0) + 1);
    }
  function compare(left: AnalysisIdentity, right: AnalysisIdentity) {
    const a = new Map(tags(left).map((tag) => [tag.id, tag])),
      b = new Map(tags(right).map((tag) => [tag.id, tag]));
    const shared: string[] = [],
      first: string[] = [],
      second: string[] = [],
      unknown: string[] = [];
    let difference = 0,
      union = 0,
      known = 0;
    for (const id of pack?.patterns ?? []) {
      const x = a.get(id),
        y = b.get(id),
        xd = x?.status === 'detected',
        yd = y?.status === 'detected';
      if (xd && yd) shared.push(id);
      else if (xd || yd) {
        const other = xd ? y : x;
        if (other?.status === 'not-detected-with-supported-coverage')
          (xd ? first : second).push(id);
        else unknown.push(id);
      }
      if (
        x &&
        y &&
        x.status !== 'unknown' &&
        y.status !== 'unknown' &&
        x.coverage === 'complete' &&
        y.coverage === 'complete'
      ) {
        known++;
        if (xd || yd) {
          const weight = 1 / Math.max(1, frequency.get(id) ?? 1);
          const rx = id.startsWith('trait.') ? Number(xd) : (rate(left, x) ?? 0);
          const ry = id.startsWith('trait.') ? Number(yd) : (rate(right, y) ?? 0);
          const rateDifference = rx + ry ? Math.abs(rx - ry) / (rx + ry) : 0;
          union += weight;
          difference +=
            weight *
            (0.5 * Number(xd !== yd) +
              0.3 * rateDifference +
              0.2 * Math.abs((x.prevalence ?? 0) - (y.prevalence ?? 0)));
        }
      }
    }
    return {
      shared,
      first,
      second,
      unknown,
      coverage: known,
      patternDistance: union && known >= 4 ? difference / union : null,
    };
  }
  return Object.freeze({ get, tags, detected, rate, compare, frequency, coverage });
}
