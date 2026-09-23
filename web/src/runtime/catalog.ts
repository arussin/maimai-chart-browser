import type { Catalog, Chart } from '../catalog-query';
import {
  PublicReader,
  MiB,
  sha256,
  decodeJSON,
  singleReference,
  multipartReference,
  type SingleVerifiedRef,
} from './verified-data';
export interface ChartIdentity {
  chart_id: string;
  source_hash: string;
  detail_bucket?: string;
}
export interface CatalogChart extends ChartIdentity, Chart {
  title: string;
  artist: string;
  song_id: string;
  version?: string;
  demand?: Record<string, Record<string, number | null>> | null;
  aliases?: string[];
  format: string;
  difficulty: string;
  [key: string]: unknown;
}
export interface PublicCatalog extends Catalog {
  schema_version: string;
  index_schema_version?: string;
  source_catalog_sha256?: string;
  catalog: CatalogChart[];
  artwork?: unknown;
  provider_mapping?: import('../player-session').ProviderMapping;
  maishift_mapping?: import('../player-session').ProviderMapping;
  legacy_ids?: Record<string, string>;
  detail_buckets?: Record<string, SingleVerifiedRef>;
  analysis?: {
    charts: Record<string, Record<string, unknown>>;
    patterns?: string[];
    definitions?: Record<string, unknown>;
  };
  snippets: Record<string, unknown>;
}
interface StartupParts {
  schema_version: string;
  source_catalog_sha256: string;
  sha256: string;
  bytes: number;
  parts: SingleVerifiedRef[];
}
interface Release {
  version: string;
  sha256: string;
  path: string;
  inventory_schema?: string;
  startup?: SingleVerifiedRef;
  startup_shared?: SingleVerifiedRef;
  startup_parts?: StartupParts;
  parts?: SingleVerifiedRef[];
}
interface Manifest {
  schema_version: string;
  default: string;
  releases: Release[];
}
export interface CatalogDetails {
  ensure: (chart: ChartIdentity, priority?: boolean) => Promise<void>;
  ready: (chart: ChartIdentity) => boolean;
}
export interface LoadedCatalog {
  canonical: PublicCatalog;
  data: PublicCatalog;
  details: CatalogDetails | undefined;
  version: string;
  latest: boolean;
  hash: string;
}
export async function loadCatalog(
  reader: PublicReader,
  requested: string | null,
): Promise<LoadedCatalog> {
  const manifest = decodeJSON<Manifest>(await reader.read('manifest.json', MiB));
  const version = requested || manifest.default,
    entry =
      Array.isArray(manifest.releases) && manifest.releases.find((row) => row.version === version);
  if (
    !['1.0.0', '1.1.0', '1.2.0', '1.3.0'].includes(manifest.schema_version) ||
    !entry ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    entry.path !== `catalogs/${entry.sha256}.json`
  )
    throw Error('This research catalog version is unavailable');
  const startup = entry.startup_parts ?? entry.startup_shared ?? entry.startup;
  let bytes: Uint8Array;
  if (startup !== undefined) {
    if (!['1.2.0', '1.3.0'].includes(manifest.schema_version))
      throw Error('Unsupported browsing index');
    if (entry.startup_parts) {
      if (
        entry.startup_parts.schema_version !== 'catalog-index-shared-1' ||
        entry.startup_parts.source_catalog_sha256 !== entry.sha256
      )
        throw Error('Invalid browsing index');
      bytes = await reader.verified(
        multipartReference(entry.startup_parts, 'catalog-index-parts', 32 * MiB, 4),
      );
    } else bytes = await reader.verified(singleReference(startup, 'catalog-index', 32 * MiB));
  } else if (entry.parts !== undefined) {
    if (
      !['1.1.0', '1.2.0', '1.3.0'].includes(manifest.schema_version) ||
      !Array.isArray(entry.parts)
    )
      throw Error('Invalid catalog parts');
    const bytes = entry.parts.reduce((sum, part) => sum + part.bytes, 0);
    const ref = multipartReference(
      { sha256: entry.sha256, bytes, parts: entry.parts },
      'catalog-parts',
      64 * MiB,
      8,
    );
    return finish(await reader.verified(ref), entry);
  } else {
    bytes = await reader.read(entry.path, 64 * MiB);
    if ((await sha256(bytes)) !== entry.sha256)
      throw Error('Research catalog integrity check failed');
  }
  return finish(bytes, entry);
  function finish(bytes: Uint8Array, entry: Release): LoadedCatalog {
    const data = decodeJSON<PublicCatalog>(bytes);
    if (entry.inventory_schema && data.schema_version !== entry.inventory_schema)
      throw Error('Inventory schema mismatch');
    if (startup) {
      if (
        entry.startup_parts || entry.startup_shared
          ? data.index_schema_version !== 'catalog-index-shared-1'
          : entry.inventory_schema && data.index_schema_version !== 'catalog-index-2'
      )
        throw Error('Unsupported inventory index');
      if (
        data.source_catalog_sha256 !== entry.sha256 ||
        !Array.isArray(data.catalog) ||
        !data.detail_buckets ||
        Object.keys(data.detail_buckets).length > 1024
      )
        throw Error('Invalid browsing index');
    }
    // Hydrated evidence belongs to a disposable view; verified canonical bytes never change.
    const view = startup
      ? {
          ...data,
          analysis: data.analysis && { ...data.analysis, charts: { ...data.analysis.charts } },
          snippets: { ...data.snippets },
        }
      : data;
    return {
      canonical: data,
      data: view,
      details: startup ? createDetails(reader, view, entry.sha256) : undefined,
      version,
      latest: version === manifest.default,
      hash: entry.sha256,
    };
  }
}
interface DetailBucket {
  schema_version: string;
  source_catalog_sha256?: string;
  identities: Record<string, string>;
  charts: Record<string, Record<string, unknown>>;
  snippets: Record<string, unknown>;
}
interface Job {
  bucket: string;
  started: boolean;
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}
function createDetails(reader: PublicReader, data: PublicCatalog, hash: string): CatalogDetails {
  const charts = new Map(data.catalog.map((chart) => [chart.chart_id, chart])),
    loaded = new Set<string>(),
    jobs = new Map<string, Job>(),
    queue: Job[] = [];
  let active = 0;
  async function fetchBucket(bucket: string) {
    const ref = singleReference(data.detail_buckets?.[bucket], 'chart-details', 8 * MiB),
      detail = decodeJSON<DetailBucket>(await reader.verified(ref));
    if (
      data.index_schema_version === 'catalog-index-shared-1'
        ? detail.schema_version !== 'chart-details-shared-1'
        : detail.schema_version !==
            (data.index_schema_version === 'catalog-index-2'
              ? 'chart-details-2'
              : 'chart-details-1') || detail.source_catalog_sha256 !== hash
    )
      throw Error('Chart details belong to another catalog');
    const expected = [...charts.values()].filter((chart) => chart.detail_bucket === bucket);
    if (
      !detail.identities ||
      Object.keys(detail.identities).length !== expected.length ||
      expected.some((chart) => detail.identities[chart.chart_id] !== chart.source_hash)
    )
      throw Error('Chart detail identity mismatch');
    for (const [id, record] of Object.entries(detail.charts || {}))
      if (
        charts.get(id)?.detail_bucket !== bucket ||
        record.source_hash !== charts.get(id)?.source_hash
      )
        throw Error('Chart detail identity mismatch');
    for (const id of Object.keys(detail.snippets || {}))
      if (charts.get(id)?.detail_bucket !== bucket) throw Error('Passage identity mismatch');
    for (const chart of expected)
      if (data.analysis?.charts[chart.chart_id] && !detail.charts?.[chart.chart_id])
        throw Error('Chart evidence is missing');
    if (data.analysis) Object.assign(data.analysis.charts, detail.charts);
    Object.assign(data.snippets, detail.snippets);
    loaded.add(bucket);
  }
  function pump() {
    while (active < 3 && queue.length) {
      const job = queue.shift()!;
      active++;
      job.started = true;
      void fetchBucket(job.bucket)
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          jobs.delete(job.bucket);
          pump();
        });
    }
  }
  function ensure(chart: ChartIdentity, priority = false): Promise<void> {
    const bucket = charts.get(chart.chart_id)?.detail_bucket;
    if (!bucket || !Object.hasOwn(data.detail_buckets ?? {}, bucket))
      return Promise.reject(Error('Chart details are unavailable'));
    if (loaded.has(bucket)) return Promise.resolve();
    const pending = jobs.get(bucket);
    if (pending) {
      if (priority && !pending.started) {
        queue.splice(queue.indexOf(pending), 1);
        queue.unshift(pending);
      }
      return pending.promise;
    }
    let resolve!: () => void, reject!: (reason: unknown) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const job = { bucket, started: false, promise, resolve, reject };
    jobs.set(bucket, job);
    if (priority) queue.unshift(job);
    else queue.push(job);
    pump();
    return promise;
  }
  return Object.freeze({
    ensure,
    ready: (chart: ChartIdentity) => !chart.detail_bucket || loaded.has(chart.detail_bucket),
  });
}
