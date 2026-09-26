import { publicPath, routePattern } from './public-routes.ts';

const invalid = () => Error('Invalid static recovery document');
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Detached document facts only; this decision performs no navigation or DOM access. */
export function recoveryTarget(
  facts: unknown,
  requestedPath: string,
  pageKind: unknown,
): string | null {
  if (!record(facts) || !Array.isArray(facts.markers)) throw invalid();
  if (!facts.markers.length) return null;
  if (facts.markers.length !== 1) throw invalid();
  const marker: unknown = facts.markers[0];
  if (
    !record(marker) ||
    marker.inHead !== true ||
    marker.version !== 'static-v1' ||
    facts.mainCount !== 1 ||
    facts.scriptCount !== 0 ||
    facts.templateCount !== 0 ||
    facts.browserEntryCount !== 0 ||
    facts.resourceDescriptorCount !== 0
  )
    throw invalid();
  if (typeof requestedPath !== 'string' || /[?#\\\u0000-\u0020\u007f]/.test(requestedPath))
    throw invalid();
  const route = routePattern.exec(requestedPath);
  if (!route) throw invalid();
  let slug: string;
  try {
    slug = decodeURIComponent(requestedPath.split('/')[3]);
  } catch {
    throw invalid();
  }
  if (slug === '.' || slug === '..' || /[\u0000-\u001f\u007f]/.test(slug)) throw invalid();
  const canonical = publicPath(route[1], route[2] as 'songs' | 'versions', slug);
  // Hex case is immaterial; escaped unreserved ASCII and path separators are aliases.
  if (
    canonical !== requestedPath.replace(/%[0-9a-f]{2}/gi, (value) => value.toUpperCase()) ||
    marker.path !== canonical ||
    pageKind !== (route[2] === 'songs' ? 'song' : 'version')
  )
    throw invalid();
  return canonical;
}
