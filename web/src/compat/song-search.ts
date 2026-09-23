import type { SearchConfiguration } from '../views/song-search';
import { createSongSearch } from '../views/song-search.js';
declare const __MAIMAI_SONG_ALIASES__: SearchConfiguration['entries'];
declare const __MAIMAI_MULTILINGUAL_ALIASES__: SearchConfiguration['multilingual'];
declare const __MAIMAI_DISPLAY_READINGS__: SearchConfiguration['readings'];
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
