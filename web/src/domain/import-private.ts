import type { ImportRow } from './import-official';

/** File-only interoperability. No account, card, token or game-server access. */
export interface ParsedPrivateExport {
  rows: ImportRow[];
  capturedAt: number | null;
  displayName: string | null;
  coverage: 'partial' | 'unknown' | 'full';
  sourceService: string;
  excludedUtage?: number;
}

type ObjectValue = Record<string, unknown>;
const DIFFICULTIES = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'RE:MASTER'] as const;
const LAMPS = ['', 'FULL COMBO', 'FULL COMBO+', 'ALL PERFECT', 'ALL PERFECT+'] as const;
const SYNCS = ['', 'FS', 'FS+', 'FSD', 'FSD+', 'SYNC PLAY'] as const;
const MAX_ROWS = 100_000;

function object(value: unknown, field: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as ObjectValue;
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) {
    throw new Error(`${field} must be an array of at most ${MAX_ROWS} rows.`);
  }
  return value;
}

function integer(value: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new Error(`${field} must be a nonnegative integer within the supported range.`);
  }
  return value;
}

function optionalInteger(value: unknown, field: string): number | null {
  return value === undefined || value === null ? null : integer(value, field);
}

function text(value: unknown, field: string, max: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required.`);
    return '';
  }
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${field} must be plain text of at most ${max} characters.`);
  }
  const result = value.trim();
  if (required && !result) throw new Error(`${field} is required.`);
  return result;
}

function gameID(value: unknown, field: string): number {
  const id = typeof value === 'string' && /^[1-9]\d{0,4}$/u.test(value) ? Number(value) : value;
  const result = integer(id, field, 99_999);
  if (!result)
    throw new Error(`${field} must identify a standard or DX song; Utage is unsupported.`);
  return result;
}

function percentTicks(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a percentage number.`);
  }
  const scaled = value * 10_000;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 0.000001) {
    throw new Error(`${field} must have at most four decimal places.`);
  }
  return integer(rounded, field, 1_010_000);
}

function unixMilliseconds(value: unknown, field: string): number | null {
  return value === undefined || value === null
    ? null
    : integer(value, field, 8_640_000_000_000_000);
}

/** Keep timezone-free cabinet times unknown; the viewer's timezone is not evidence. */
function aquaTime(value: unknown, field: string): { time: number | null; identity: string } {
  if (value === undefined || value === null || value === '') return { time: null, identity: '' };
  const date = text(value, field, 64, true);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/u.exec(
      date,
    );
  if (!match) throw new Error(`${field} must be an ISO date or a cabinet local date.`);
  const [, y, m, d, h, min, sec, , zone] = match;
  const local = `${y}-${m}-${d}T${h}:${min}:${sec}`;
  const check = new Date(`${local}Z`);
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 19) !== local) {
    throw new Error(`${field} is not a valid calendar date.`);
  }
  if (!zone) return { time: null, identity: date };
  const time = Date.parse(date.replace(' ', 'T'));
  if (!Number.isFinite(time) || time < 0) throw new Error(`${field} is not a valid timestamp.`);
  return { time, identity: String(time) };
}

function emptyRow(
  sourceID: string,
  sourceSongID: string,
  format: 'STD' | 'DX',
  difficulty: string,
): ImportRow {
  return {
    sourceID,
    sourceSongID,
    sourceGenre: 'in-game-id',
    title: '',
    artist: '',
    format,
    difficulty,
    achievement: 0,
    lamp: '',
    sync: '',
    dxScore: null,
    constant: null,
    level: '',
    timeAchieved: null,
  };
}

function aquaJudgements(source: ObjectValue, row: ImportRow, field: string): void {
  const kinds = ['tap', 'hold', 'slide', 'touch', 'break'];
  const metrics = [
    ['CriticalPerfect', 'pcrit'],
    ['Perfect', 'perfect'],
    ['Great', 'great'],
    ['Good', 'good'],
    ['Miss', 'miss'],
  ] as const;
  for (const [suffix, destination] of metrics) {
    const values = kinds.map((kind) =>
      optionalInteger(source[`${kind}${suffix}`], `${field}.${kind}${suffix}`),
    );
    // An incomplete per-note judgement group cannot be presented as a total.
    row[destination] = values.every((value) => value !== null)
      ? integer(
          values.reduce<number>((sum, value) => sum + (value ?? 0), 0),
          `${field}.${destination}`,
        )
      : null;
  }
  row.fast = optionalInteger(source.fastCount, `${field}.fastCount`);
  row.slow = optionalInteger(source.lateCount, `${field}.lateCount`);
  row.maxCombo = optionalInteger(source.maxCombo, `${field}.maxCombo`);
}

function parseAqua(input: ObjectValue): ParsedPrivateExport {
  if (input.gameId !== 'SDEZ')
    throw new Error('Choose an AquaDX maimai DX (SDEZ) full JSON export.');
  const user = object(input.userData, 'userData');
  const pbs = list(input.userMusicDetailList, 'userMusicDetailList');
  const plays =
    input.userPlaylogList === undefined ? [] : list(input.userPlaylogList, 'userPlaylogList');
  if (pbs.length + plays.length > MAX_ROWS)
    throw new Error('This export contains too many score rows.');
  const rows: ImportRow[] = [];
  let excludedUtage = 0;
  for (const [entries, isPlay] of [
    [pbs, false],
    [plays, true],
  ] as const) {
    entries.forEach((value, index) => {
      const field = `${isPlay ? 'userPlaylogList' : 'userMusicDetailList'}[${index}]`;
      const source = object(value, field);
      // Native Aqua fields are integers. Do not classify malformed values by coercion.
      const sourceMusicID = integer(source.musicId, `${field}.musicId`, 2_147_483_647);
      const sourceLevel = integer(source.level, `${field}.level`, 2_147_483_647);
      if (!sourceMusicID) throw new Error(`${field}.musicId must be a positive song ID.`);
      if (sourceMusicID >= 100_000 || sourceLevel === 5) {
        excludedUtage += 1;
        return;
      }
      const id = gameID(sourceMusicID, `${field}.musicId`);
      const difficulty =
        DIFFICULTIES[integer(sourceLevel, `${field}.level (Utage is unsupported)`, 4)];
      const format = id >= 10_000 ? 'DX' : 'STD';
      const row = emptyRow(`aqua:${id}:${difficulty}`, String(id), format, difficulty);
      row.kind = isPlay ? 'observation' : 'pb';
      row.achievement = integer(source.achievement, `${field}.achievement`, 1_010_000);
      row.lamp = LAMPS[integer(source.comboStatus, `${field}.comboStatus`, 4)];
      row.sync = SYNCS[integer(source.syncStatus, `${field}.syncStatus`, 5)];
      row.dxScore = optionalInteger(
        source[isPlay ? 'deluxscore' : 'deluxscoreMax'],
        `${field}.dxScore`,
      );
      if (isPlay) {
        if (source.isClear !== undefined && typeof source.isClear !== 'boolean') {
          throw new Error(`${field}.isClear must be a boolean.`);
        }
        if (!row.lamp && typeof source.isClear === 'boolean')
          row.lamp = source.isClear ? 'CLEAR' : 'FAILED';
        const date = aquaTime(source.userPlayDate, `${field}.userPlayDate`);
        row.timeAchieved = date.time;
        const playlogID = optionalInteger(source.playlogId, `${field}.playlogId`);
        const track = optionalInteger(source.trackNo, `${field}.trackNo`);
        aquaJudgements(source, row, field);
        // A cabinet counter can repeat. Require the complete native event key;
        // scores and optional measurements may be corrected by later exports.
        if (date.identity && playlogID !== null && track !== null) {
          row.playID = `aqua:${JSON.stringify([row.sourceID, playlogID, date.identity, track])}`;
          row.kind = 'play';
        }
      }
      rows.push(row);
    });
  }
  if (excludedUtage && rows.length === 0) {
    throw new Error(
      'This export contains only unsupported Utage score rows. Nothing was imported.',
    );
  }
  return {
    rows,
    capturedAt: null,
    displayName: text(user.userName, 'userData.userName', 100) || null,
    coverage: excludedUtage ? 'partial' : 'unknown',
    sourceService: 'AquaDX',
    excludedUtage,
  };
}

function parseTachi(input: ObjectValue): ParsedPrivateExport {
  const meta = object(input.meta, 'meta');
  if (meta.game !== 'maimaidx' || (meta.playtype !== undefined && meta.playtype !== 'Single')) {
    throw new Error(
      'Choose a maimai DX Single BATCH-MANUAL export. Legacy maimai scores use different scoring.',
    );
  }
  const service = text(meta.service, 'meta.service', 100, true);
  text(meta.version, 'meta.version', 100);
  const scores = list(input.scores, 'scores');
  const rows = scores.map((value, index) => {
    const field = `scores[${index}]`;
    const source = object(value, field);
    const difficultyText = text(source.difficulty, `${field}.difficulty`, 40, true);
    const match = /^(DX )?(Basic|Advanced|Expert|Master|Re:Master)$/u.exec(difficultyText);
    if (!match)
      throw new Error(
        `${field}.difficulty must be a supported STD/DX difficulty; Utage is unsupported.`,
      );
    const format = match[1] ? 'DX' : 'STD';
    const difficulty = match[2].toUpperCase();
    if (
      (source.game !== undefined && source.game !== meta.game) ||
      (source.playtype !== undefined && source.playtype !== 'Single')
    ) {
      throw new Error(`${field} contains a conflicting game or playtype.`);
    }
    const identifier = text(source.identifier, `${field}.identifier`, 500, true);
    const matchType = source.matchType;
    if (!['inGameID', 'tachiSongID', 'songTitle'].includes(String(matchType))) {
      throw new Error(`${field}.matchType is unsupported.`);
    }
    if (matchType === 'inGameID') {
      const id = gameID(identifier, `${field}.identifier`);
      if (id >= 10_000 !== (format === 'DX'))
        throw new Error(`${field} has conflicting in-game ID and STD/DX format.`);
    } else if (matchType === 'tachiSongID' && !/^[1-9]\d{0,14}$/u.test(identifier)) {
      throw new Error(`${field}.identifier must be a Tachi song ID.`);
    }
    const artist = text(source.artist, `${field}.artist`, 300);
    const row = emptyRow(
      `tachi:${JSON.stringify([matchType, identifier, matchType === 'songTitle' ? artist : '', format, difficulty])}`,
      identifier,
      format,
      difficulty,
    );
    row.kind = 'observation';
    row.sourceGenre =
      matchType === 'inGameID'
        ? 'in-game-id'
        : matchType === 'tachiSongID'
          ? 'tachi-song-id'
          : 'song-title';
    if (matchType === 'songTitle') {
      row.title = identifier;
      row.sourceSongID = '';
    }
    row.artist = artist;
    row.achievement = percentTicks(source.percent, `${field}.percent`);
    const lamp = text(source.lamp, `${field}.lamp`, 30, true);
    if (!['FAILED', 'CLEAR', ...LAMPS.slice(1)].includes(lamp))
      throw new Error(`${field}.lamp is unsupported.`);
    row.lamp = lamp;
    row.timeAchieved = unixMilliseconds(source.timeAchieved, `${field}.timeAchieved`);
    const optional =
      source.optional === undefined
        ? source.hitMeta === undefined
          ? {}
          : object(source.hitMeta, `${field}.hitMeta`)
        : object(source.optional, `${field}.optional`);
    for (const metric of ['fast', 'slow', 'maxCombo'] as const)
      row[metric] = optionalInteger(optional[metric], `${field}.optional.${metric}`);
    const judgements =
      source.judgements === undefined ? {} : object(source.judgements, `${field}.judgements`);
    for (const metric of ['miss', 'good', 'great', 'perfect', 'pcrit'] as const)
      row[metric] = optionalInteger(judgements[metric], `${field}.judgements.${metric}`);
    // BATCH-MANUAL has no stable event ID. Its timestamp may be rounded or derived
    // from cabinet-local time, so preserve observations without inventing plays.
    return row;
  });
  return { rows, capturedAt: null, displayName: null, coverage: 'unknown', sourceService: service };
}

export function parsePrivateExport(provider: string, input: unknown): ParsedPrivateExport {
  const value = typeof input === 'string' ? JSON.parse(input) : input;
  const root = object(value, 'Export');
  if (provider === 'aqua') return parseAqua(root);
  if (provider === 'tachi') return parseTachi(root);
  throw new Error('This private-server export provider is unsupported.');
}
