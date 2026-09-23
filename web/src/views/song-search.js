/** Existing DOM behavior with explicit module dependencies. */
export function createSongSearch(ports) {
  let songSearch;
  /* Public title aliases only. Search stays local and never changes chart identity. */
  (() => {
    'use strict';
    const normalize = (value) =>
      String(value ?? '')
        .normalize('NFKC')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
    const compact = (value) => normalize(value).replace(/[\p{P}\p{Z}\s]/gu, '');
    const entries = ports.configuration.search.entries;
    const aliases = new Map(
      entries.map(([title, artist, names]) => [
        JSON.stringify([normalize(title), normalize(artist)]),
        names,
      ]),
    );
    const multilingual = ports.configuration.search.multilingual;
    const readings = new Map(
      ports.configuration.search.readings.map(([title, artist, reading]) => [
        JSON.stringify([normalize(title), normalize(artist)]),
        reading,
      ]),
    );
    const romaji = (chart) =>
      readings.get(JSON.stringify([normalize(chart.title), normalize(chart.artist)])) || '';
    const cached = new WeakMap();
    function fields(chart) {
      const prior = cached.get(chart);
      if (
        !prior ||
        prior.title !== chart.title ||
        prior.artist !== chart.artist ||
        prior.aliases !== chart.aliases
      ) {
        const identity = JSON.stringify([normalize(chart.title), normalize(chart.artist)]);
        const regional = Object.values(chart.regional || {}).flatMap((row) => [
          row.metadata?.title,
          row.metadata?.artist,
          row.metadata?.title_kana,
        ]);
        const names = [
          chart.title,
          chart.artist,
          ...regional,
          ...(chart.aliases || []),
          ...(aliases.get(identity) || []),
          ...(multilingual[chart.song_id] || []),
        ];
        cached.set(chart, {
          title: chart.title,
          artist: chart.artist,
          aliases: chart.aliases,
          text: names.map(normalize).join(' '),
          compact: names.map(compact),
        });
      }
      return cached.get(chart);
    }
    function query(value) {
      const text = normalize(value),
        joined = compact(value),
        words = text.split(' ');
      return (chart, extra = []) => {
        if (!text) return true;
        const indexed = fields(chart),
          more = extra.map(normalize);
        const allText = [indexed.text, ...more].join(' ');
        if (allText.includes(text) || words.every((word) => allText.includes(word))) return true;
        // A punctuation-only query must not turn into an empty, match-everything key.
        return (
          !!joined &&
          [...indexed.compact, ...more.map(compact)].some((name) => name.includes(joined))
        );
      };
    }
    songSearch = { query, romaji };
  })();

  return songSearch;
}
