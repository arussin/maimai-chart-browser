import { DiagnosticError, diagnosticStep } from './diagnostic-error';
import type { PlayerDataset } from '../domain/player-data';
import { IMPORT_FORMATS, type ImportFile, type FileImportOptions } from '../domain/import-options';
import { parseOfficialFileExport } from '../domain/import-official';
import { parsePrivateExport } from '../domain/import-private';
import { normalizeParsedImportDocument } from './import-provider';
import type { createPlayerDataCore } from '../views/player-data-core';

/** A local export becomes ordinary portable data before the existing consent transaction. */
export async function readImportFile(
  core: ReturnType<typeof createPlayerDataCore>,
  file: ImportFile,
  options: FileImportOptions,
  diagnostics: (excludedUtage: number, snapshotDateUnknown: boolean) => void = () => {},
): Promise<PlayerDataset> {
  if (!IMPORT_FORMATS.some(([format]) => format === options.format))
    throw new Error('Unsupported file provider.');
  if (file.size > core.MAX_COMPRESSED)
    throw new DiagnosticError('Player file exceeds 32 MiB.', 'oversized_response', 'read');
  const bytes = new Uint8Array(await diagnosticStep(() => file.arrayBuffer(), 'unknown', 'read'));
  if (bytes.length > core.MAX_COMPRESSED)
    throw new DiagnosticError('Player file exceeds 32 MiB.', 'oversized_response', 'read');
  const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (options.format === 'portable' && compressed)
    return diagnosticStep(() => core.decode(bytes), 'normalization', 'decode');
  const raw = compressed
    ? await core.bounded(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
        core.MAX_DECODED,
      )
    : bytes;
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw new DiagnosticError(
      'Choose a valid JSON export for the selected source.',
      'malformed_response',
      'decode',
    );
  }
  if (options.format === 'portable') return core.validate(input);
  return normalizeFileImportDocument(
    core,
    input,
    options,
    {
      capturedAt: file.lastModified,
      sourceKind: `${options.format}-file`,
      sourceID: await core.hash(bytes),
    },
    diagnostics,
  );
}

/** Parse one explicitly selected local format, without broadening live API contracts. */
export async function normalizeFileImportDocument(
  core: ReturnType<typeof createPlayerDataCore>,
  input: unknown,
  options: FileImportOptions,
  acquisition: { capturedAt?: number; sourceKind: string; sourceID?: string },
  diagnostics: (excludedUtage: number, snapshotDateUnknown: boolean) => void = () => {},
): Promise<PlayerDataset> {
  if (!IMPORT_FORMATS.some(([format]) => format === options.format))
    throw new Error('Unsupported file provider.');
  if (options.format === 'portable') return core.validate(input);
  const provider = options.format;
  const privateSource = provider === 'aqua' || provider === 'tachi';
  if (privateSource && options.region !== 'private')
    throw new Error('Choose the private-server region for this export.');
  let username = options.username.trim();
  if (privateSource || options.region === 'private') {
    const instance = options.instance?.trim().toLowerCase() ?? '';
    if (!/^[a-z0-9](?:[a-z0-9.-]{0,98}[a-z0-9])?$/.test(instance))
      throw new Error('Enter the server name or hostname without a URL, password, or token.');
    if (!username || /[\p{White_Space}\ufeff]/u.test(username))
      throw new Error('Invalid account identifier.');
    username += '@' + instance;
  }
  const parsed = privateSource
    ? parsePrivateExport(provider, input)
    : parseOfficialFileExport(provider, input);
  if ('sourceRegion' in parsed && parsed.sourceRegion && parsed.sourceRegion !== options.region)
    throw new DiagnosticError(
      'The export and selected game region do not match.',
      'region_mismatch',
      'identity',
    );
  return normalizeParsedImportDocument(
    core,
    input,
    { provider, region: options.region, username, displayName: options.username.trim() },
    parsed,
    acquisition,
    diagnostics,
  );
}
