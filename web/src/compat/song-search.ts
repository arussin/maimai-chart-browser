import { createSongSearch } from '../views/song-search.js';
declare const __MAIMAI_SONG_ALIASES__: unknown;
declare const __MAIMAI_MULTILINGUAL_ALIASES__: unknown;
declare const __MAIMAI_DISPLAY_READINGS__: unknown;
Object.assign(globalThis, {
  maimaiSongSearch: createSongSearch({
    configuration: {
      search: {
        entries: __MAIMAI_SONG_ALIASES__,
        multilingual: __MAIMAI_MULTILINGUAL_ALIASES__,
        readings: __MAIMAI_DISPLAY_READINGS__,
      },
    },
  }),
});
