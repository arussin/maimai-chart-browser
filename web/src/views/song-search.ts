/** Public aliases are search-only; they never rewrite canonical identity. */
export interface SearchConfiguration {
  entries: [string, string, string[]][];
  readings: [string, string, string][];
  multilingual: Record<string, string[]>;
}
export interface SearchableChart {
  title: string;
  artist: string;
  song_id: string;
  aliases?: string[];
  regional?: Record<
    string,
    { metadata?: { title?: unknown; artist?: unknown; title_kana?: unknown } }
  >;
}
interface IndexedNames {
  title: string;
  artist: string;
  aliases?: string[];
  text: string;
  compact: string[];
}
export function createSongSearch(ports: { configuration: { search: SearchConfiguration } }) {
  const normalize = (value: unknown) =>
    String(value ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  const compact = (value: unknown) => normalize(value).replace(/[\p{P}\p{Z}\s]/gu, '');
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
  const romaji = (chart: SearchableChart) =>
    readings.get(JSON.stringify([normalize(chart.title), normalize(chart.artist)])) || '';
  const cached = new WeakMap<SearchableChart, IndexedNames>();
  function fields(chart: SearchableChart): IndexedNames {
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
    return cached.get(chart)!;
  }
  function query(value: string) {
    const text = normalize(value),
      joined = compact(value),
      words = text.split(' ');
    return (chart: SearchableChart, extra: string[] = []) => {
      if (!text) return true;
      const indexed = fields(chart),
        more = extra.map(normalize);
      const allText = [indexed.text, ...more].join(' ');
      if (allText.includes(text) || words.every((word) => allText.includes(word))) return true;
      // A punctuation-only query must not turn into an empty, match-everything key.
      return (
        !!joined && [...indexed.compact, ...more.map(compact)].some((name) => name.includes(joined))
      );
    };
  }
  return Object.freeze({ query, romaji });
}
