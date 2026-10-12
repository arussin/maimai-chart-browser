import metadata from './import-song-metadata.json';
import type { ImportRow } from './import-official';

type MetadataRow = [string, string, string, number] | null;
const tables = metadata.tables as unknown as Record<string, Record<string, MetadataRow>>;
const difficulties = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'RE:MASTER'];
const normalized = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ');

/** Pinned provider IDs supply missing metadata; catalog IDs are never inferred. */
export function enrichImportRow(provider: string, input: ImportRow): ImportRow {
  if (provider !== 'diving-fish' && provider !== 'lxns')
    throw new Error('Unsupported source metadata provider.');
  const row = tables[provider]?.[input.sourceSongID + ':' + input.format];
  if (!row || !(row[3] & (1 << difficulties.indexOf(input.difficulty)))) return input;
  if (
    (input.title && normalized(input.title) !== normalized(row[0])) ||
    (input.artist && normalized(input.artist) !== normalized(row[1]))
  )
    throw new Error('The export disagrees with its source song metadata. Nothing was imported.');
  return { ...input, title: row[0], artist: row[1] };
}
