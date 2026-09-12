/* Public title aliases only. Search stays local and never changes chart identity. */
(() => {
  'use strict';
  const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
  const compact = value => normalize(value).replace(/[\p{P}\p{Z}\s]/gu, '');
  const entries = __MAIMAI_SONG_ALIASES__;
  const aliases = new Map(entries.map(([title, artist, names]) => [JSON.stringify([normalize(title), normalize(artist)]), names]));
  const cached = new WeakMap();
  function fields(chart) {
    if (!cached.has(chart)) {
      const identity = JSON.stringify([normalize(chart.title), normalize(chart.artist)]);
      const names = [chart.title, chart.artist, ...(chart.aliases || []), ...(aliases.get(identity) || [])];
      cached.set(chart, {text: names.map(normalize).join(' '), compact: names.map(compact)});
    }
    return cached.get(chart);
  }
  function query(value) {
    const text = normalize(value), joined = compact(value), words = text.split(' ');
    return (chart, extra = []) => {
      if (!text) return true;
      const indexed = fields(chart), more = extra.map(normalize);
      const allText = [indexed.text, ...more].join(' ');
      if (allText.includes(text) || words.every(word => allText.includes(word))) return true;
      // A punctuation-only query must not turn into an empty, match-everything key.
      return !!joined && [...indexed.compact, ...more.map(compact)].some(name => name.includes(joined));
    };
  }
  window.maimaiSongSearch = {query};
})();
