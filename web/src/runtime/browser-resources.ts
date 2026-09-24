import type { SingleVerifiedRef } from './verified-data';

/** Immutable dependencies of the document that activated this application. */
export interface BrowserResources {
  version: 1;
  entry: SingleVerifiedRef;
  configuration: SingleVerifiedRef;
  shell: SingleVerifiedRef;
  catalog: SingleVerifiedRef;
  styles: SingleVerifiedRef;
  permalinks: SingleVerifiedRef | null;
  seoStyle: SingleVerifiedRef | null;
}
const MiB = 1024 * 1024;
export function browserResources(value: unknown): BrowserResources {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid browser resources');
  const record = value as Record<string, unknown>;
  const names = [
    'version',
    'entry',
    'configuration',
    'shell',
    'catalog',
    'styles',
    'permalinks',
    'seoStyle',
  ];
  if (
    record.version !== 1 ||
    Object.keys(record).length !== names.length ||
    names.some((name) => !Object.hasOwn(record, name))
  )
    throw Error('Invalid browser resources');
  function reference(name: string, extension: string, maximum: number): SingleVerifiedRef {
    const raw = record[name];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw Error('Invalid browser resource reference');
    const ref = raw as Record<string, unknown>;
    if (
      Object.keys(ref).length !== 3 ||
      typeof ref.path !== 'string' ||
      typeof ref.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(ref.sha256) ||
      !Number.isSafeInteger(ref.bytes) ||
      typeof ref.bytes !== 'number' ||
      ref.bytes < 1 ||
      ref.bytes > maximum ||
      (name === 'entry'
        ? !/^browser\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(ref.path)
        : ref.path !== `browser-resources/${ref.sha256}.${extension}`)
    )
      throw Error('Invalid browser resource reference');
    return Object.freeze({ path: ref.path, sha256: ref.sha256, bytes: ref.bytes });
  }
  return Object.freeze({
    version: 1,
    entry: reference('entry', 'js', 2 * MiB),
    configuration: reference('configuration', 'json', 4 * MiB),
    shell: reference('shell', 'html', 2 * MiB),
    catalog: reference('catalog', 'json', MiB),
    styles: reference('styles', 'css', 2 * MiB),
    permalinks: record.permalinks === null ? null : reference('permalinks', 'json', 2 * MiB),
    seoStyle: record.seoStyle === null ? null : reference('seoStyle', 'css', 2 * MiB),
  });
}

export function documentResources(root: ParentNode): BrowserResources {
  const nodes = root.querySelectorAll<HTMLScriptElement>(
    'script#browser-resources[type="application/json"]',
  );
  if (nodes.length !== 1 || nodes[0].textContent!.length > 16 * 1024)
    throw Error('Missing browser resources');
  return browserResources(JSON.parse(nodes[0].textContent!));
}
