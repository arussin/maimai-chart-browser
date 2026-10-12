import type { PlayerChart, PlayerDataset, PlayerRecord } from '../domain/player-data';
import type { ProviderImportOptions } from '../domain/import-provider-options';
import { filePlayerKey } from '../domain/import-identities';
import { enrichImportRow } from '../domain/import-metadata';
import { parseOfficialExport, type ImportRow } from '../domain/import-official';
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
  const provider = options.provider;
  const username = options.username.trim();
  const key = filePlayerKey(provider, options.region, username);
  const parsed = parseOfficialExport(provider, input);
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
      displayName: parsed.displayName || options.username.trim(),
    },
    charts: {},
    records: {},
    plays: {},
    snapshots: {},
    captures: {},
  };
  const pbs: Record<string, string> = {};
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
  for (let i = 0; i < parsed.rows.length; i += 128) {
    const batch = await Promise.all(
      parsed.rows.slice(i, i + 128).map(async (input) => {
        const row = enrichImportRow(provider, input);
        if (!difficulties.includes(row.difficulty))
          throw new Error('Unsupported chart difficulty.');
        const [chartHash, songHash] = await Promise.all([
          identityHash(row.sourceID),
          identityHash(row.sourceSongID || row.title),
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
          row,
          chartID,
          chart,
          record,
          ref: await core.digest(record),
        };
      }),
    );
    for (const { chartID, chart, record, ref } of batch) {
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
      if (explicitPBs.has(chartID) && pbs[chartID] !== ref)
        throw new Error('Conflicting personal bests in this export. Nothing was imported.');
      explicitPBs.add(chartID);
      pbs[chartID] = ref;
    }
  }
  // Neither an export nor a current API response proves that an omitted chart
  // should erase a retained PB. Acquisition time is never a gameplay timestamp.
  const snapshot = { capturedAt, phase: 'after', complete: false, versions: [], pbs };
  const snapshotID = await core.digest(snapshot);
  data.snapshots[snapshotID] = snapshot;
  const capture = {
    capturedAt,
    sourceKind: acquisition.sourceKind,
    sourceID: acquisition.sourceID ?? (await core.digest(input)),
    sessionID: '',
    historyCoverage: 'none',
    playIDs: [],
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
    maxDxScore: null,
    maxCombo: null,
    fast: null,
    slow: null,
    miss: null,
    good: null,
    great: null,
    perfect: null,
    pcrit: null,
  };
}
