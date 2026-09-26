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
  const compact = ['sparse-tags-2', 'sparse-tags-3'].includes(pack?.representation ?? '');
  type Row = DenseTag | SparseTag;
  function status(row: Row | undefined, absent: boolean): AnalysisStatus {
    if (!row) return absent ? 'not-detected-with-supported-coverage' : 'unknown';
    if (!compact) return row[1] as AnalysisStatus;
    return (['unknown', 'detected', 'not-detected-with-supported-coverage'] as const)[
      (row[1] as number) & 3
    ];
  }
  // Visit canonical observation states without manufacturing display details for every chart.
  // Sparse duplicates retain the last row, exactly as historical decoding did.
  function visitRows(
    chart: AnalysisIdentity,
    visit: (index: number, row: Row | undefined, absent: boolean) => void,
  ) {
    const record = get(chart);
    if (!record || !pack) return;
    if (pack.representation?.startsWith('sparse-tags-')) {
      const present = new Map(record.tags.map((row) => [row[0], row])),
        absent = new Set(record.absent ?? []);
      for (let index = 0; index < pack.patterns.length; index++)
        visit(index, present.get(index), absent.has(index));
    } else for (const row of record.tags) visit(row[0], row, false);
  }
  function decode(index: number, row: Row | undefined, absent: boolean): AnalysisTag {
    const id = pack!.patterns[index],
      observed = status(row, absent);
    if (!row)
      return {
        id,
        status: observed,
        count: absent ? 0 : null,
        prevalence: absent ? 0 : null,
        coverage: absent ? 'complete' : 'partial',
        truncated: false,
        spans: [],
        evidence: [],
      };
    const common = { id, status: observed, count: row[2], prevalence: row[3] };
    if (compact) {
      const sparse = row as SparseTag;
      const evidence = pack!.evidence_pool
        ? sparse[5].map((index) => pack!.evidence_pool![index as number])
        : sparse[5];
      return {
        ...common,
        coverage: sparse[1] & 4 ? 'complete' : 'partial',
        truncated: !!(sparse[1] & 8),
        spans: sparse[4],
        evidence,
      };
    }
    const dense = row as DenseTag;
    return {
      ...common,
      coverage: dense[4],
      truncated: dense[5],
      spans: dense[6],
      evidence: dense[7] ?? [],
    };
  }
  function tags(chart: AnalysisIdentity): AnalysisTag[] {
    const result: AnalysisTag[] = [];
    visitRows(chart, (index, row, absent) => result.push(decode(index, row, absent)));
    return result;
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
    visitRows(chart, (index, row, absent) => {
      const id = pack!.patterns[index],
        state = status(row, absent);
      if (state !== 'unknown') coverage.set(id, (coverage.get(id) ?? 0) + 1);
      if (state === 'detected') frequency.set(id, (frequency.get(id) ?? 0) + 1);
    });
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
