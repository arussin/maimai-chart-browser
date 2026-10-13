import type { PlayerChart, PlayerIdentity } from './player-data';

/** Explicit local-file namespaces. Adding a provider requires a verified adapter. */
export const FILE_PROVIDERS = [
  'diving-fish',
  'lxns',
  'mai-tools',
  'dxrating',
  'tomomai',
  'jietng',
  'tachi',
  'aqua',
] as const;
export const FILE_REGIONS = ['cn', 'jp', 'intl', 'private'] as const;
export type FileProvider = (typeof FILE_PROVIDERS)[number];
export type FileRegion = (typeof FILE_REGIONS)[number];

export const isFileProvider = (value: string): value is FileProvider =>
  (FILE_PROVIDERS as readonly string[]).includes(value);
const validText = (value: string, maximum: number) =>
  value.length > 0 && value.length <= maximum && !/[\x00-\x1f\uD800-\uDFFF]/u.test(value);

function scopedAccount(username: string) {
  const separator = username.lastIndexOf('@');
  return (
    separator > 0 && separator < username.length - 1 && !/[\p{White_Space}\ufeff]/u.test(username)
  );
}

/** Private identities use an explicit account@instance supplied by the user/export. */
export function filePlayerKey(provider: string, region: string, username: string): string {
  if (!isFileProvider(provider) || !(FILE_REGIONS as readonly string[]).includes(region))
    throw new Error('Unsupported file provider or region.');
  if (['diving-fish', 'lxns'].includes(provider) && region !== 'cn')
    throw new Error('Unsupported tracker region.');
  if (['tachi', 'aqua'].includes(provider) && region !== 'private')
    throw new Error('Private server exports require the private region.');
  if (!validText(username, 200)) throw new Error('Invalid account identifier.');
  if (region === 'private' && !scopedAccount(username))
    throw new Error('Private accounts need an explicit account@instance identifier.');
  const key = provider + ':maimaidx:' + region + ':' + encodeURIComponent(username);
  if (key.length > 200)
    throw new Error('The encoded account identifier exceeds the portable player-data limit.');
  return key;
}

export function validFilePlayer(player: PlayerIdentity): boolean {
  try {
    const parts = player.key.split(':');
    return (
      player.game === 'maimaidx' &&
      parts.length === 4 &&
      player.key === filePlayerKey(player.provider, parts[2], player.username)
    );
  } catch {
    return false;
  }
}

export function validFileChartID(player: PlayerIdentity, id: string): boolean {
  if (!validFilePlayer(player)) return false;
  const prefix = player.provider + ':' + player.key.split(':')[2] + ':';
  if (!id.startsWith(prefix) || id.length > 256) return false;
  const suffix = id.slice(prefix.length);
  // Components are opaque URI-encoded source IDs, never paths or catalog IDs.
  try {
    return (
      /^[A-Za-z0-9._~!'()*%+:-]+$/.test(suffix) &&
      suffix.split(':').every((part) => {
        const decoded = decodeURIComponent(part);
        return (
          validText(decoded, 256) && !['__proto__', 'constructor', 'prototype'].includes(decoded)
        );
      })
    );
  } catch {
    return false;
  }
}

interface MatchChart {
  title: string;
  artist: string;
  format: string;
  difficulty: string;
}
interface CatalogMatchChart extends MatchChart {
  chart_id: string;
  variant_id?: unknown;
}
const normalized = (value: string) => value.normalize('NFC').trim().replace(/\s+/gu, ' ');
function exactIdentity(chart: MatchChart): string | null {
  const title = normalized(chart.title),
    artist = normalized(chart.artist);
  if (
    !title ||
    !artist ||
    !['STD', 'DX'].includes(chart.format) ||
    !['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'RE:MASTER'].includes(chart.difficulty)
  )
    return null;
  return JSON.stringify([title, artist, chart.format, chart.difficulty]);
}

/**
 * Exact source metadata only: titles, aliases and numeric IDs alone never match.
 * Adapters without an artist need a documented authoritative metadata supplement.
 * Ambiguous identities on either side stay retained in the dataset, unmatched.
 */
export function exactFileChartIndex(
  catalog: readonly CatalogMatchChart[],
  charts: Readonly<Record<string, PlayerChart>>,
): Map<string, string[]> {
  const canonical = new Map<string, string | null>(),
    incoming = new Map<string, string | null>(),
    result = new Map<string, string[]>();
  for (const chart of catalog) {
    if (chart.variant_id !== undefined && chart.variant_id !== 'ordinary') continue;
    const identity = exactIdentity(chart);
    if (identity) canonical.set(identity, canonical.has(identity) ? null : chart.chart_id);
  }
  for (const [id, chart] of Object.entries(charts)) {
    const identity = exactIdentity(chart);
    if (identity) incoming.set(identity, incoming.has(identity) ? null : id);
  }
  for (const [identity, id] of incoming) {
    const target = canonical.get(identity);
    if (id && target) result.set(target, [id]);
  }
  return result;
}
