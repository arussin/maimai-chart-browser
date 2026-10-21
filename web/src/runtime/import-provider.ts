import type {
  PlayerChart,
  PlayerDataset,
  PlayerRecord,
  PlayerSnapshot,
} from '../domain/player-data';
import type { ProviderImportOptions } from '../domain/import-provider-options';
import { filePlayerKey, type FileProvider, type FileRegion } from '../domain/import-identities';
import { enrichImportRow } from '../domain/import-metadata';
import { parseOfficialExport, type ImportRow, type ImportResult } from '../domain/import-official';
import type { createPlayerDataCore } from '../views/player-data-core';

const difficulties = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'RE:MASTER'];
const gradeThresholds: [number, string][] = [
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
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 8640000000000000;

/** Normalize verified tracker API responses before the existing consent transaction. */
export async function normalizeImportDocument(
  core: ReturnType<typeof createPlayerDataCore>,
  input: unknown,
  options: ProviderImportOptions,
  acquisition: { capturedAt?: number; sourceKind: string; sourceID?: string },
  diagnostics: (excludedUtage: number, snapshotDateUnknown: boolean) => void = () => {},
): Promise<PlayerDataset> {
  if (
    (options.provider !== 'diving-fish' && options.provider !== 'lxns') ||
    options.region !== 'cn'
  )
    throw new Error('Unsupported tracker provider or region.');
  return normalizeParsedImportDocument(
    core,
    input,
    options,
    parseOfficialExport(options.provider, input),
    acquisition,
    diagnostics,
  );
}

/** Shared portable-data builder; parsers establish the source contract before calling it. */
export async function normalizeParsedImportDocument(
  core: ReturnType<typeof createPlayerDataCore>,
  input: unknown,
  options: { provider: FileProvider; username: string; region: FileRegion; displayName?: string },
  parsed: ImportResult,
  acquisition: { capturedAt?: number; sourceKind: string; sourceID?: string },
  diagnostics: (excludedUtage: number, snapshotDateUnknown: boolean) => void = () => {},
): Promise<PlayerDataset> {
  const provider = options.provider;
  const username = options.username.trim();
  const key = filePlayerKey(provider, options.region, username);
  if (parsed.rows.length > 100000)
    throw new Error('This export contains too many records. Nothing was imported.');
  const capturedAt = timestamp(parsed.capturedAt)
    ? parsed.capturedAt
    : timestamp(acquisition.capturedAt)
      ? acquisition.capturedAt
      : 0;
  const data: PlayerDataset = {
    format: 'maimai-player-data',
    schemaVersion: 1,
    revision: '',
    player: {
      key,
      provider,
      game: 'maimaidx',
      username,
      displayName: parsed.displayName || options.displayName || options.username.trim(),
    },
    charts: {},
    records: {},
    plays: {},
    snapshots: {},
    captures: {},
  };
  const pbs: Record<string, string> = {};
  const pools: { old: string[]; new: string[] } = { old: [], new: [] };
  const rows: { row: ImportRow; pool?: 'old' | 'new' }[] = parsed.rows.map((row) => ({ row }));
  for (const pool of ['old', 'new'] as const)
    for (const row of parsed.best50?.[pool] ?? []) rows.push({ row, pool });
  const explicitPBs = new Set<string>();
  const hashes = new Map<string, Promise<string>>();
  const identityHash = (value: string) => {
    let pending = hashes.get(value);
    if (!pending) {
      pending = core.hash(value);
      hashes.set(value, pending);
    }
    return pending;
  };
  for (let i = 0; i < rows.length; i += 128) {
    const batch = await Promise.all(
      rows.slice(i, i + 128).map(async ({ row: input, pool }) => {
        const row = enrichImportRow(provider, input);
        if (!difficulties.includes(row.difficulty))
          throw new Error('Unsupported chart difficulty.');
        const [chartHash, songHash, playHash] = await Promise.all([
          identityHash(row.sourceID),
          identityHash(row.sourceSongID || row.title),
          row.playID === undefined ? undefined : identityHash(row.playID),
        ]);
        const chartID = `${provider}:${options.region}:${chartHash}`;
        const chart: PlayerChart = {
          chartID,
          songID:
            (row.sourceSongID || row.title).length <= 256
              ? row.sourceSongID || row.title
              : `${provider}:${songHash}`,
          title: row.title,
          artist: row.artist,
          format: row.format,
          difficulty: row.difficulty,
          level: row.level,
          constant: row.constant,
          displayVersion: '',
          inGameID: null,
        };
        const record = observation(chartID, row);
        return {
          pool,
          row,
          chartID,
          chart,
          record,
          ref: await core.digest(record),
          playID: playHash === undefined ? undefined : `${provider}:${options.region}:${playHash}`,
        };
      }),
    );
    for (const { row, chartID, chart, record, ref, playID, pool } of batch) {
      const prior = data.charts[chartID];
      if (
        prior &&
        ['songID', 'title', 'artist', 'format', 'difficulty'].some(
          (k) => prior[k as keyof PlayerChart] !== chart[k as keyof PlayerChart],
        )
      )
        throw new Error('Conflicting chart identities in this export. Nothing was imported.');
      data.charts[chartID] = chart;
      data.records[ref] = record;
      if (pool) {
        // B50 is a separate provider observation. A later PB must never replace
        // a score in this saved selection, even when both use the same chart.
        pools[pool].push(ref);
      } else if (playID !== undefined) {
        if (Object.hasOwn(data.plays, playID) && data.plays[playID] !== ref)
          throw new Error('Conflicting play identities in this export. Nothing was imported.');
        data.plays[playID] = ref;
      } else if (!row.kind || row.kind === 'pb') {
        if (explicitPBs.has(chartID) && pbs[chartID] !== ref)
          throw new Error('Conflicting personal bests in this export. Nothing was imported.');
        explicitPBs.add(chartID);
        pbs[chartID] = ref;
      }
    }
  }
  // Neither an export nor a current API response proves that an omitted chart
  // should erase a retained PB. Acquisition time is never a gameplay timestamp.
  const snapshot: PlayerSnapshot = {
    capturedAt,
    phase: 'after',
    complete: false,
    versions: [],
    pbs,
  };
  if (parsed.best50) {
    if ((provider !== 'diving-fish' && provider !== 'lxns') || options.region !== 'cn')
      throw new Error('Unsupported Best 50 provider or region.');
    snapshot.best50 = { provider, region: 'cn', ...pools };
  }
  const snapshotID = await core.digest(snapshot);
  data.snapshots[snapshotID] = snapshot;
  const capture = {
    capturedAt,
    sourceKind: acquisition.sourceKind,
    sourceID: acquisition.sourceID ?? (await core.digest(input)),
    sessionID: '',
    historyCoverage: Object.keys(data.plays).length ? 'retained-only' : 'none',
    playIDs: Object.keys(data.plays).sort(),
    snapshotIDs: [snapshotID],
  };
  data.captures[await core.digest(capture)] = capture;
  const { revision: _, ...body } = data;
  data.revision = await core.digest(body);
  const valid = await core.validate(data);
  diagnostics(parsed.excludedUtage ?? 0, parsed.capturedAt === null);
  return valid;
}

function observation(chartID: string, row: ImportRow): PlayerRecord {
  return {
    chartID,
    achievement: row.achievement,
    grade: gradeThresholds.find(([minimum]) => row.achievement >= minimum)?.[1] ?? '',
    rate: row.rate ?? null,
    lamp: row.lamp,
    sync: row.sync,
    constant: row.constant,
    displayVersion: '',
    timeAchieved: row.timeAchieved,
    dxScore: row.dxScore,
    maxDxScore: row.maxDxScore ?? null,
    maxCombo: row.maxCombo ?? null,
    fast: row.fast ?? null,
    slow: row.slow ?? null,
    miss: row.miss ?? null,
    good: row.good ?? null,
    great: row.great ?? null,
    perfect: row.perfect ?? null,
    pcrit: row.pcrit ?? null,
  };
}
