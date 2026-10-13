import metadata from './import-song-metadata.json';
import type { ImportRow } from './import-official';
import { isFileProvider } from './import-identities';

type MetadataRow = [string, string, string, number] | null;
const tables = metadata.tables as unknown as Record<string, Record<string, MetadataRow>>;
const difficulties = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'RE:MASTER'];
const normalized = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ');
const titleKeys = new Map<string, MetadataRow>();
for (const [key, row] of Object.entries(tables.dxrating ?? {})) {
  if (!row) continue;
  const fmt = key.slice(key.lastIndexOf(':') + 1);
  for (let i = 0; i < difficulties.length; i++) {
    if (!(row[3] & (1 << i))) continue;
    const identity = JSON.stringify([row[0], fmt, difficulties[i]]);
    titleKeys.set(identity, titleKeys.has(identity) ? null : row);
  }
}

/** Public, pinned provider IDs supply missing metadata; catalog IDs are never inferred. */
export function enrichImportRow(provider: string, input: ImportRow): ImportRow {
  if (!isFileProvider(provider)) throw new Error('Unsupported source metadata provider.');
  let table: string = provider,
    song = input.sourceSongID;
  if (provider === 'mai-tools' || provider === 'dxrating') table = 'dxrating';
  if (provider === 'mai-tools' && input.title === 'Link') {
    // mai-tools has two same-title STD songs; a missing/unknown genre is not
    // evidence that this is the maimai original rather than the niconico cover.
    const genre = (input.sourceGenre ?? '').trim();
    if (/niconico|ニコニコ/i.test(genre)) song = 'Link (2)';
    else if (genre.toLowerCase() !== 'maimai') return input;
  }
  if (provider === 'aqua' || (provider === 'tachi' && input.sourceGenre === 'in-game-id'))
    table = 'in-game-id';
  const row =
    provider === 'jietng'
      ? titleKeys.get(JSON.stringify([input.title, input.format, input.difficulty]))
      : tables[table]?.[song + ':' + input.format];
  if (!row || !(row[3] & (1 << difficulties.indexOf(input.difficulty)))) return input;
  // DXRating song IDs may disambiguate duplicate titles (for example Link (2)).
  const knownTitle = table === 'dxrating' && input.title === song;
  if (
    (input.title && !knownTitle && normalized(input.title) !== normalized(row[0])) ||
    (input.artist && normalized(input.artist) !== normalized(row[1]))
  )
    throw new Error('The export disagrees with its source song metadata. Nothing was imported.');
  return { ...input, title: row[0], artist: row[1] };
}
