/** Read-only adapters for documented public score export contracts. */
export interface ImportRow {
  sourceID: string;
  sourceSongID: string;
  title: string;
  artist: string;
  format: 'STD' | 'DX';
  difficulty: string;
  achievement: number;
  rate?: number | null;
  lamp: string;
  sync: string;
  dxScore: number | null;
  constant: number | null;
  level: string;
  timeAchieved: number | null;
}

export interface ImportResult {
  rows: ImportRow[];
  capturedAt: number | null;
  displayName: string | null;
  coverage: 'partial' | 'unknown' | 'full';
  excludedUtage?: number;
}

export type OfficialImportProvider = 'diving-fish' | 'lxns';
type JsonObject = Record<string, unknown>;
const DIFFICULTIES = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'RE:MASTER'];
const MAX_ROWS = 100_000;

class UnsupportedUtage extends Error {}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a score object.');
  }
  return value as JsonObject;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) {
    throw new Error('Expected a score list containing at most 100,000 records.');
  }
  return value;
}

function text(value: unknown, name: string, required = false): string {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > 2000 || (required && !value.trim())) {
    throw new Error(`Invalid ${name}.`);
  }
  return value;
}

function number(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}.`);
  }
  return value;
}

function integer(value: unknown, name: string, min: number, max: number): number {
  const result = number(value, name, min, max);
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid ${name}.`);
  return result;
}

function optionalNumber(
  value: unknown,
  name: string,
  max: number,
  integral = false,
): number | null {
  if (value == null) return null;
  return integral ? integer(value, name, 0, max) : number(value, name, 0, max);
}

function percentage(value: unknown): number {
  const percent = number(value, 'achievement percentage', 0, 101);
  const ticks = Math.round(percent * 10000);
  if (Math.abs(percent * 10000 - ticks) > 0.000001) {
    throw new Error('Achievement percentage has more than four decimal places.');
  }
  return ticks;
}

function numericID(value: unknown): string {
  if (typeof value === 'string' && /^\d{1,12}$/.test(value)) return String(Number(value));
  return String(integer(value, 'song ID', 0, 999_999_999_999));
}

function constant(value: unknown): number | null {
  if (value == null) return null;
  const decimal = number(value, 'chart constant', 0, 20);
  const tenths = Math.round(decimal * 10);
  if (Math.abs(decimal * 10 - tenths) > 0.000001)
    throw new Error('Invalid chart constant precision.');
  return tenths;
}

function difficulty(value: unknown, indexed = false): string {
  if (indexed) {
    if (value === 5 || value === 10)
      throw new Error('Utage charts are not supported by this importer.');
    return DIFFICULTIES[integer(value, 'difficulty index', 0, 4)];
  }
  const name = text(value, 'difficulty', true).toUpperCase().replace(/[:\s]/g, '');
  if (name === 'UTAGE' || name.startsWith('【')) {
    throw new Error('Utage charts are not supported by this importer.');
  }
  const index = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'REMASTER'].indexOf(name);
  if (index < 0) throw new Error('Invalid difficulty.');
  return DIFFICULTIES[index];
}

function format(value: unknown, indexed = false): 'STD' | 'DX' {
  if (indexed) {
    if (value === 2) throw new UnsupportedUtage('Utage charts are not supported by this importer.');
    if (value === 0) return 'STD';
    if (value === 1) return 'DX';
  } else {
    const name = text(value, 'chart type', true).toUpperCase();
    if (name === 'UTAGE') {
      throw new UnsupportedUtage('Utage charts are not supported by this importer.');
    }
    if (['SD', 'STD', 'STANDARD'].includes(name)) return 'STD';
    if (name === 'DX') return 'DX';
  }
  throw new Error('Invalid chart type.');
}

function flag(value: unknown, sync = false): string {
  if (value == null || value === '') return '';
  const name = text(value, sync ? 'sync status' : 'combo status').toUpperCase();
  if (name === 'NONE') return '';
  const names: Record<string, string> = sync
    ? {
        FS: 'FS',
        FSP: 'FS+',
        'FS+': 'FS+',
        FSD: 'FSD',
        FDX: 'FSD',
        FSDP: 'FSD+',
        'FSD+': 'FSD+',
        'FDX+': 'FSD+',
        SYNC: 'SYNC PLAY',
      }
    : {
        FC: 'FULL COMBO',
        FCP: 'FULL COMBO+',
        'FC+': 'FULL COMBO+',
        AP: 'ALL PERFECT',
        APP: 'ALL PERFECT+',
        'AP+': 'ALL PERFECT+',
      };
  if (!(name in names)) throw new Error(`Invalid ${sync ? 'sync' : 'combo'} status.`);
  return names[name];
}

function timestamp(value: unknown): number | null {
  if (value == null) return null;
  // Explicit offsets keep importing independent of the browser's local timezone.
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    )
  )
    throw new Error('Expected an ISO timestamp with an explicit timezone.');
  const date = Date.parse(value);
  if (!Number.isFinite(date) || date < 0) throw new Error('Invalid timestamp.');
  const day = value.slice(0, 10);
  const calendar = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day)
    throw new Error('Invalid timestamp calendar date.');
  return date;
}

function row(
  fields: Partial<ImportRow> & Pick<ImportRow, 'format' | 'difficulty' | 'achievement'>,
): ImportRow {
  const result: ImportRow = {
    sourceID: '',
    sourceSongID: '',
    title: '',
    artist: '',
    lamp: '',
    sync: '',
    dxScore: null,
    constant: null,
    level: '',
    timeAchieved: null,
    ...fields,
  };
  if (!result.title && !result.sourceSongID) throw new Error('Score has no song identity.');
  if (!result.sourceID) {
    result.sourceID = JSON.stringify([
      result.sourceSongID || result.title,
      result.format,
      result.difficulty,
    ]);
  }
  return result;
}

function mapRows(
  values: unknown[],
  convert: (value: JsonObject) => ImportRow,
): Pick<ImportResult, 'rows' | 'excludedUtage'> {
  const rows: ImportRow[] = [];
  let excludedUtage = 0;
  array(values).forEach((value, index) => {
    try {
      rows.push(convert(object(value)));
    } catch (error) {
      if (error instanceof UnsupportedUtage) {
        excludedUtage++;
        return;
      }
      throw new Error(
        `Record ${index + 1}: ${error instanceof Error ? error.message : 'Invalid score.'}`,
      );
    }
  });
  if (!rows.length && excludedUtage)
    throw new Error('This export contains only unsupported Utage charts. Nothing was imported.');
  return { rows, excludedUtage };
}

function divingFish(input: unknown): ImportResult {
  const data = object(input);
  const b50 = data.charts == null ? null : object(data.charts);
  const scores = b50 ? [...array(b50.sd), ...array(b50.dx)] : array(data.records);
  return {
    capturedAt: null,
    displayName: text(data.nickname, 'display name') || null,
    coverage: b50 ? 'partial' : 'unknown',
    ...mapRows(scores, (score) =>
      row({
        sourceSongID: numericID(score.song_id),
        title: text(score.title, 'song title'),
        format: format(score.type),
        difficulty: difficulty(score.level_index, true),
        achievement: percentage(score.achievements),
        lamp: flag(score.fc),
        sync: flag(score.fs, true),
        dxScore: optionalNumber(score.dxScore, 'DX score', 100_000_000, true),
        constant: constant(score.ds),
        level: text(score.level, 'level'),
      }),
    ),
  };
}

function lxns(input: unknown): ImportResult {
  // This launch reads the personal OAuth scores endpoint, never developer
  // SimpleScore, B50, CSV or an arbitrary user-supplied export shape.
  const envelope = object(input);
  if (envelope.success !== true || envelope.code !== 200)
    throw new Error('LXNS response was not successful.');
  return {
    capturedAt: null,
    displayName: null,
    coverage: 'unknown',
    ...mapRows(array(envelope.data), (score) => {
      const sourceSongID = String(integer(score.id, 'song ID', 0, 999_999_999_999));
      if (!['standard', 'dx', 'utage'].includes(String(score.type)))
        throw new Error('Invalid chart type.');
      const chartFormat = format(score.type);
      if (!('achievements' in score))
        throw new Error('LXNS simplified scores contain no achievement percentage.');
      const dxRating = optionalNumber(score.dx_rating, 'DX Rating', Number.MAX_SAFE_INTEGER);
      return row({
        sourceSongID,
        title: text(score.song_name, 'song title'),
        format: chartFormat,
        difficulty: difficulty(score.level_index, true),
        achievement: percentage(score.achievements),
        // LXNS documents DX Rating as a float whose displayed value is floored.
        rate: dxRating === null ? null : Math.floor(dxRating),
        lamp: flag(score.fc),
        sync: flag(score.fs, true),
        dxScore: optionalNumber(score.dx_score, 'DX score', 100_000_000, true),
        level: text(score.level, 'level'),
        // upload_time and last_played_time are not the time this PB was achieved.
        timeAchieved: timestamp(score.play_time),
      });
    }),
  };
}

/** Input is already parsed JSON. This module never requests or stores credentials. */
export function parseOfficialExport(
  provider: OfficialImportProvider,
  input: unknown,
): ImportResult {
  let result: ImportResult;
  if (provider === 'diving-fish') result = divingFish(input);
  else if (provider === 'lxns') result = lxns(input);
  else throw new Error('Unsupported official-network score export.');
  if (result.excludedUtage) result.coverage = 'partial';
  return result;
}
