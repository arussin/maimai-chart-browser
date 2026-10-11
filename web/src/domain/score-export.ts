import type {
  PlayerChart,
  PlayerDataset,
  PlayerIdentity,
  PlayerRecord,
  PlayerSnapshot,
} from './player-data';

export interface VersionChoice {
  id: string;
  label: string;
  /** Chart debut releases in the New 15 pool, not catalog-build versions. */
  versions: string[];
  source: 'known' | 'snapshot';
  /** Canonical artwork label, independent from imported spelling or chart identity. */
  logoVersion: string | null;
  supportsBest50: boolean;
}
export interface ExportEntry {
  chart: PlayerChart;
  record: PlayerRecord;
  rating: number;
  ratingSource: 'imported' | 'calculated';
  canonicalChartID: string | null;
}
export interface ExportResolution {
  canonicalChartID?: string;
  /** Reviewed chart-specific regional debut only; never a song-level debut. */
  displayVersion?: string;
  /** An accepted identity does not establish this debut release for every region. */
  versionEvidence?: 'unqualified';
  alias?: boolean;
}
export type ExportResolver = (
  chart: PlayerChart,
  record: PlayerRecord,
) => ExportResolution | undefined;
export interface Best50Export {
  player: PlayerIdentity;
  capturedAt: number;
  version: VersionChoice;
  detectedVersion: string | null;
  old: ExportEntry[];
  new: ExportEntry[];
  oldTotal: number;
  newTotal: number;
  totalRating: number;
  calculatedRatings: number;
  unqualifiedVersions: number;
  coverage: 'complete' | 'partial';
  excluded: {
    missingRating: number;
    missingVersion: number;
    futureVersion: number;
    unsupportedChart: number;
    duplicate: number;
    total: number;
  };
  /** English localization keys. Keep these limitations on the downloaded image. */
  warnings: string[];
}

const releases = [
  'maimai',
  'maimai PLUS',
  'maimai GreeN',
  'maimai GreeN PLUS',
  'maimai ORANGE',
  'maimai ORANGE PLUS',
  'maimai PiNK',
  'maimai PiNK PLUS',
  'maimai MURASAKi',
  'maimai MURASAKi PLUS',
  'maimai MiLK',
  'maimai MiLK PLUS',
  'maimai FiNALE',
  'maimai DX',
  'maimai DX PLUS',
  'maimai DX Splash',
  'maimai DX Splash PLUS',
  'maimai DX UNiVERSE',
  'maimai DX UNiVERSE PLUS',
  'maimai DX FESTiVAL',
  'maimai DX FESTiVAL PLUS',
  'maimai DX BUDDiES',
  'maimai DX BUDDiES PLUS',
  'maimai DX PRiSM',
  'maimai DX PRiSM PLUS',
  'maimai DX CiRCLE',
  'maimai DX CiRCLE PLUS',
  'maimai DX MAGiCAL',
];
const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function versionToken(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/でらっくす|DELUXE/g, 'DX')
    .replace(/\+/g, 'PLUS')
    .replace(/[\s_-]/g, '')
    .replace(/^MAIMAI/, '')
    .replace(/^DX(?=SPLASH|UNIVERSE|FESTIVAL|BUDDIES|PRISM|CIRCLE|MAGICAL)/, '');
}
/** Stable release choices suitable for preferences; report-specific pools are excluded. */
export function knownScoreExportVersionIDs(): string[] {
  return releases.map((label) => versionToken(label).toLowerCase() || 'original');
}
const releaseRank = new Map(releases.map((name, index) => [versionToken(name), index]));
const circleRank = releases.indexOf('maimai DX CiRCLE');
const firstBest50Rank = releases.indexOf('maimai DX Splash PLUS');

function current(data: PlayerDataset) {
  let refs: Record<string, string> = {};
  let snapshot: PlayerSnapshot | null = null;
  const observed = new Map<string, number>();
  for (const [, next] of Object.entries(data.snapshots).sort(
    ([a, x], [b, y]) =>
      x.capturedAt - y.capturedAt ||
      Number(x.phase === 'after') - Number(y.phase === 'after') ||
      ordinal(a, b),
  )) {
    if (next.complete) refs = {};
    Object.assign(refs, next.pbs);
    for (const cid of Object.keys(next.pbs)) observed.set(cid, next.capturedAt);
    snapshot = next;
  }
  return { refs, snapshot, observed };
}

function importedChoice(snapshot: PlayerSnapshot | null) {
  const versions = [...new Set(snapshot?.versions.filter((v) => v.trim()) ?? [])].sort(ordinal);
  return versions.length ? { label: versions.join(' + '), versions } : null;
}

export function versionChoices(data: PlayerDataset): VersionChoice[] {
  const imported = importedChoice(current(data).snapshot);
  // Splash PLUS introduced the modern rating model. CiRCLE extended New 15
  // to the immediately preceding release (including a distinct PLUS release).
  // Primary sources: https://info-maimai.sega.jp/616/ and /7725/.
  const known = releases.map((label, rank): VersionChoice => {
    return {
      id: versionToken(label).toLowerCase() || 'original',
      label,
      versions: rank >= circleRank ? [releases[rank - 1], label] : [label],
      source: 'known',
      logoVersion: label,
      supportsBest50: rank >= firstBest50Rank,
    };
  });
  if (imported) {
    const ranks = imported.versions.map((value) => releaseRank.get(versionToken(value)));
    if (ranks.every((rank) => rank !== undefined)) {
      // One chronological choice per release. Keep the report's exact New 15
      // grouping, even when a provider uses aliases or a different regional pool.
      const choice = known[Math.max(...(ranks as number[]))];
      choice.versions = imported.versions;
      choice.source = 'snapshot';
    } else {
      // A custom report pool has no verified chronology; place it after releases.
      return [
        ...known.reverse(),
        {
          ...imported,
          id: 'snapshot',
          source: 'snapshot',
          logoVersion: null,
          supportsBest50: true,
        },
      ];
    }
  }
  return known.reverse();
}

/** A chart's debut alone cannot reveal which game release the player used. */
export function detectVersion(data: PlayerDataset): string | null {
  return versionChoices(data).find((choice) => choice.source === 'snapshot')?.id ?? null;
}

export function gradeForAchievement(value: number | null): string {
  if (value === null || !Number.isSafeInteger(value) || value < 0 || value > 1010000) return '';
  const boundaries: [number, string][] = [
    [1005000, 'SSS+'],
    [1000000, 'SSS'],
    [995000, 'SS+'],
    [990000, 'SS'],
    [980000, 'S+'],
    [970000, 'S'],
    [940000, 'AAA'],
    [900000, 'AA'],
    [800000, 'A'],
    [750000, 'BBB'],
    [700000, 'BB'],
    [600000, 'B'],
    [500000, 'C'],
    [0, 'D'],
  ];
  return boundaries.find(([floor]) => value >= floor)![1];
}

export function lampLabel(value: string): string {
  const key = value
    .trim()
    .toUpperCase()
    .replace(/_/g, ' ')
    .replace(/ PLUS$/, '+');
  return (
    (
      {
        FC: 'FC',
        'FC+': 'FC+',
        AP: 'AP',
        'AP+': 'AP+',
        'FULL COMBO': 'FC',
        'FULL COMBO+': 'FC+',
        'ALL PERFECT': 'AP',
        'ALL PERFECT+': 'AP+',
      } as Record<string, string>
    )[key] ?? ''
  );
}

export function syncLabel(value: string): string {
  const key = value
    .trim()
    .toUpperCase()
    .replace(/_/g, ' ')
    .replace(/ PLUS$/, '+');
  return (
    (
      {
        FS: 'FS',
        'FS+': 'FS+',
        FSD: 'FSD',
        'FSD+': 'FSD+',
        FDX: 'FSD',
        'FDX+': 'FSD+',
        SYNC: 'SYNC',
        'SYNC PLAY': 'SYNC',
        'FULL SYNC': 'FS',
        'FULL SYNC+': 'FS+',
        'FULL SYNC DX': 'FSD',
        'FULL SYNC DX+': 'FSD+',
      } as Record<string, string>
    )[key] ?? ''
  );
}

function calculatedRating(record: PlayerRecord, release: number | null): number | null {
  const { achievement, constant } = record;
  if (
    release === null ||
    release < firstBest50Rank ||
    achievement === null ||
    !Number.isSafeInteger(achievement) ||
    achievement < 0 ||
    achievement > 1010000 ||
    constant === null ||
    !Number.isSafeInteger(constant) ||
    constant <= 0 ||
    constant > 200
  )
    return null;
  const lamp = lampLabel(record.lamp);
  const clear = record.lamp.trim().toUpperCase();
  if (
    (lamp === 'AP+' && achievement !== 1010000) ||
    (lamp === 'AP' && achievement < 1000000) ||
    (achievement === 1010000 && lamp && lamp !== 'AP+') ||
    (clear === 'FAILED' && achievement >= 800000) ||
    (clear === 'CLEAR' && achievement < 800000)
  )
    return null;
  // Integer units match the retained report policy; avoid floating-point errors
  // at grade boundaries. Constants are the observation's original tenths only.
  const coefficients: [number, number][] = [
    [1005000, 224],
    [1004999, 222],
    [1000000, 216],
    [999999, 214],
    [995000, 211],
    [990000, 208],
    [989999, 206],
    [980000, 203],
    [970000, 200],
    [969999, 176],
    [940000, 168],
    [900000, 152],
    [800000, 136],
    [799999, 128],
    [750000, 120],
    [700000, 112],
    [600000, 96],
    [500000, 80],
    [400000, 64],
    [300000, 48],
    [200000, 32],
    [100000, 16],
    [0, 0],
  ];
  const capped = Math.min(achievement, 1005000);
  const coefficient = coefficients.find(([floor]) => capped >= floor)![1];
  return (
    Math.floor((capped * coefficient * constant) / 100000000) +
    Number(release >= circleRank && (lamp === 'AP' || lamp === 'AP+'))
  );
}

export function buildBest50(
  data: PlayerDataset,
  choiceId: string,
  resolve?: ExportResolver,
): Best50Export {
  const version = versionChoices(data).find((choice) => choice.id === choiceId);
  if (!version) throw Error('Choose the game version for this record.');
  if (!version.supportsBest50)
    throw Error('Best 50 began with Splash PLUS. Earlier rating formats are not supported.');
  const { refs, snapshot, observed } = current(data);
  const detectedVersion = detectVersion(data);
  const excluded: Best50Export['excluded'] = {
    missingRating: 0,
    missingVersion: 0,
    futureVersion: 0,
    unsupportedChart: 0,
    duplicate: 0,
    total: 0,
  };
  const newVersions = new Set(version.versions.map(versionToken));
  const knownRanks = [...newVersions].map((v) => releaseRank.get(v));
  const latestRank = knownRanks.every((rank) => rank !== undefined)
    ? Math.max(...(knownRanks as number[]))
    : null;
  const deduplicated = new Map<
    string,
    { entry: ExportEntry; resolution?: ExportResolution; observed: number }
  >();
  for (const [cid, ref] of Object.entries(refs)) {
    const chart = data.charts[cid];
    const record = data.records[ref];
    if (!chart || !record) {
      excluded.unsupportedChart++;
      continue;
    }
    const resolution = resolve?.(chart, record);
    const canonicalChartID = resolution?.canonicalChartID || null;
    const key = canonicalChartID ? 'canonical:' + canonicalChartID : 'provider:' + cid;
    const candidate = {
      entry: {
        chart,
        record,
        rating: record.rate ?? 0,
        ratingSource: 'imported' as const,
        canonicalChartID,
      },
      resolution,
      observed: observed.get(cid) ?? 0,
    };
    const previous = deduplicated.get(key);
    if (previous) {
      excluded.duplicate++;
      const newer =
        candidate.observed - previous.observed ||
        Number(!candidate.resolution?.alias) - Number(!previous.resolution?.alias) ||
        ordinal(previous.entry.chart.chartID, cid);
      if (newer <= 0) continue;
    }
    deduplicated.set(key, candidate);
  }
  const old: ExportEntry[] = [];
  const recent: ExportEntry[] = [];
  let unqualifiedVersions = 0;
  for (const { entry, resolution } of deduplicated.values()) {
    const { chart, record } = entry;
    if (
      !['STD', 'DX'].includes(chart.format.toUpperCase()) ||
      !['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'REMASTER'].includes(
        chart.difficulty.toUpperCase().replace(/[^A-Z]/g, ''),
      )
    ) {
      excluded.unsupportedChart++;
      continue;
    }
    const debut = record.displayVersion || chart.displayVersion || resolution?.displayVersion || '';
    const token = versionToken(debut);
    const rank = releaseRank.get(token);
    if (
      !debut.trim() ||
      (version.source === 'known' && rank === undefined && !newVersions.has(token))
    ) {
      excluded.missingVersion++;
      continue;
    }
    if (rank !== undefined && latestRank !== null && rank > latestRank) {
      excluded.futureVersion++;
      continue;
    }
    if (record.rate === null) {
      const rating = calculatedRating(record, latestRank);
      if (rating === null) {
        excluded.missingRating++;
        continue;
      }
      entry.rating = rating;
      entry.ratingSource = 'calculated';
    } else if (!Number.isSafeInteger(record.rate) || record.rate < 0) {
      excluded.missingRating++;
      continue;
    }
    if (
      !record.displayVersion &&
      !chart.displayVersion &&
      resolution?.versionEvidence === 'unqualified'
    )
      unqualifiedVersions++;
    (newVersions.has(token) ? recent : old).push(entry);
  }
  const order = (a: ExportEntry, b: ExportEntry) =>
    b.rating - a.rating ||
    (b.record.achievement ?? -1) - (a.record.achievement ?? -1) ||
    ordinal(a.canonicalChartID ?? a.chart.chartID, b.canonicalChartID ?? b.chart.chartID);
  const old35 = old.sort(order).slice(0, 35);
  const new15 = recent.sort(order).slice(0, 15);
  const oldTotal = old35.reduce((sum, row) => sum + row.rating, 0);
  const newTotal = new15.reduce((sum, row) => sum + row.rating, 0);
  const calculatedRatings = [...old35, ...new15].filter(
    (row) => row.ratingSource === 'calculated',
  ).length;
  excluded.total = Object.values(excluded).reduce((sum, count) => sum + count, 0);
  const importedVersions = importedChoice(snapshot)?.versions.map(versionToken);
  const changedVersion =
    importedVersions !== undefined &&
    (new Set(importedVersions).size !== newVersions.size ||
      importedVersions.some((value) => !newVersions.has(value)));
  const incompleteRecords =
    excluded.missingRating + excluded.missingVersion + excluded.futureVersion;
  const warnings = ['Ratings and constants come from the imported record.'];
  if (calculatedRatings)
    warnings.push('Missing chart ratings were calculated from imported constants and achievement.');
  if (unqualifiedVersions)
    warnings.push('Chart release groups use community metadata and may differ by region.');
  if (!snapshot?.complete)
    warnings.push('The imported record may not contain every personal best.');
  if (!detectedVersion) warnings.push('The game version was selected manually.');
  if (changedVersion)
    warnings.push(
      'Changing the version groups scores only; historical ratings are not recalculated.',
    );
  if (incompleteRecords)
    warnings.push('Some records could not be included in this rating estimate.');
  if (old35.length < 35 || new15.length < 15)
    warnings.push('There are not enough eligible records to fill all 50 slots.');
  if (excluded.duplicate) warnings.push('Duplicate chart identities were counted once.');
  return {
    player: data.player,
    capturedAt: snapshot?.capturedAt ?? 0,
    version,
    detectedVersion,
    old: old35,
    new: new15,
    oldTotal,
    newTotal,
    totalRating: oldTotal + newTotal,
    calculatedRatings,
    unqualifiedVersions,
    coverage:
      snapshot?.complete &&
      !incompleteRecords &&
      !unqualifiedVersions &&
      !changedVersion &&
      old35.length === 35 &&
      new15.length === 15
        ? 'complete'
        : 'partial',
    excluded,
    warnings,
  };
}
