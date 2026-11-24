import metadata from './import-dxrating-metadata.json';
import type { DXRatingSheetLookup } from './import-official';

const sheets = metadata.sheets as unknown as Record<string, [number, string, string]>;

/** Only the DXRating file path loads this pinned public catalog projection. */
export const lookupDXRatingSheet: DXRatingSheetLookup = (id) => {
  if (!Object.hasOwn(sheets, id)) return undefined;
  const [index, type, difficulty] = sheets[id];
  const [songID, title, artist] = metadata.songs[index];
  return { songID, title, artist, type, difficulty };
};
