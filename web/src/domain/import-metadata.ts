import metadata from './import-song-metadata.json';
import type { ImportRow } from './import-official';

type MetadataRow = [string, string, string, number] | null;
const songs = metadata.tables['diving-fish'] as unknown as Record<string, MetadataRow>;
const difficulties = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'RE:MASTER'];
const normalized = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ');

/** Pinned Diving-Fish IDs supply missing metadata; catalog IDs are never inferred. */
export function enrichImportRow(provider: string, input: ImportRow): ImportRow {
  if (provider !== 'diving-fish') throw new Error('Unsupported source metadata provider.');
  const row = songs[input.sourceSongID + ':' + input.format];
  if (!row || !(row[3] & (1 << difficulties.indexOf(input.difficulty)))) return input;
  if (
    (input.title && normalized(input.title) !== normalized(row[0])) ||
    (input.artist && normalized(input.artist) !== normalized(row[1]))
  )
    throw new Error('The export disagrees with its source song metadata. Nothing was imported.');
  return { ...input, title: row[0], artist: row[1] };
}
