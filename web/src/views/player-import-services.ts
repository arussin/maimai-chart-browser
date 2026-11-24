import type { FileImportFormat } from '../domain/import-options';

export type ImportMethodValue =
  | 'file'
  | 'report'
  | 'maishift'
  | 'kamaitachi'
  | 'diving-fish'
  | 'lxns'
  | `file:${Exclude<FileImportFormat, 'portable'>}`;
export interface ImportServiceMethod {
  value: ImportMethodValue;
  label: string;
  fileFormat?: FileImportFormat;
}
export type ImportChoice = 'tracker' | 'file' | 'help';
/** Presentation only: adapter identities and region matching remain in the domain. */
export const IMPORT_METHOD_DETAILS: Readonly<
  Record<
    ImportMethodValue,
    {
      choice: ImportChoice;
      group: string;
      region: string;
      data: string;
    }
  >
> = {
  maishift: {
    choice: 'tracker',
    group: 'International and Japan',
    region: 'maimai DX · International / Japan',
    data: 'Personal bests',
  },
  kamaitachi: {
    choice: 'tracker',
    group: 'International and Japan',
    region: 'maimai DX · International / Japan',
    data: 'Personal bests',
  },
  'diving-fish': {
    choice: 'tracker',
    group: 'Mainland China',
    region: 'maimai DX · Mainland China',
    data: 'Personal bests',
  },
  lxns: {
    choice: 'tracker',
    group: 'Mainland China',
    region: 'maimai DX · Mainland China',
    data: 'Personal bests',
  },
  file: {
    choice: 'file',
    group: 'Session Report',
    region: 'maimai · Region recorded in the report',
    data: 'Personal bests and recent plays, when included',
  },
  report: {
    choice: 'help',
    group: 'Session Report',
    region: 'maimai · Region recorded in the report',
    data: 'Personal bests and recent plays, when included',
  },
  'file:mai-tools': {
    choice: 'file',
    group: 'Official game exports',
    region: 'maimai DX · International / Japan',
    data: 'Personal bests (may be partial)',
  },
  'file:dxrating': {
    choice: 'file',
    group: 'Official game exports',
    region: 'maimai DX · International / Japan',
    data: 'Personal bests (may be partial)',
  },
  'file:tomomai': {
    choice: 'file',
    group: 'Official game exports',
    region: 'maimai DX · International / Japan / Mainland China',
    data: 'Personal bests or recent score observations, depending on the export',
  },
  'file:jietng': {
    choice: 'file',
    group: 'Official game exports',
    region: 'maimai DX · International / Japan',
    data: 'Personal bests and recent score observations',
  },
  'file:aqua': {
    choice: 'file',
    group: 'Private servers',
    region: 'maimai DX · Private server',
    data: 'Personal bests and recent plays, when included',
  },
  'file:tachi': {
    choice: 'file',
    group: 'Private servers',
    region: 'maimai DX · Private server',
    data: 'Score observations only; no personal bests or play history',
  },
};
export interface ImportService {
  id: string;
  title: string;
  help: string;
  helpLabel: string;
  methods: readonly ImportServiceMethod[];
}

/** Neutral text badges are not presented as official provider logos. */
export const IMPORT_SERVICE_MONOGRAMS: Readonly<Record<string, string>> = {
  kamaitachi: 'K',
  'diving-fish': 'DF',
  lxns: 'LX',
  maishift: 'M',
  'session-report': 'P',
  'mai-tools': 'MT',
  dxrating: 'DR',
  tomomai: 'TM',
  jietng: 'JT',
  aqua: 'AD',
  tachi: 'T',
};

/** Service identity owns the available methods; labels never select a parser. */
export const IMPORT_SERVICES: readonly ImportService[] = [
  {
    id: 'maishift',
    title: 'Maishift',
    help: 'maishift',
    helpLabel: 'About Maishift imports',
    methods: [{ value: 'maishift', label: 'Public profile' }],
  },
  {
    id: 'kamaitachi',
    title: 'Kamaitachi',
    help: 'kamaitachi',
    helpLabel: 'About Kamaitachi imports',
    methods: [{ value: 'kamaitachi', label: 'Import by username' }],
  },
  {
    id: 'diving-fish',
    title: 'Diving-Fish',
    help: 'diving-fish',
    helpLabel: 'About Diving-Fish imports',
    methods: [{ value: 'diving-fish', label: 'Connect directly' }],
  },
  {
    id: 'lxns',
    title: 'LXNS',
    help: 'lxns',
    helpLabel: 'About LXNS imports',
    methods: [{ value: 'lxns', label: 'Connect directly' }],
  },
  {
    id: 'session-report',
    title: 'maimai.party Session Report',
    help: 'session-report',
    helpLabel: 'About Session Report imports',
    methods: [
      { value: 'file', label: 'Upload a file', fileFormat: 'portable' },
      { value: 'report', label: 'Hosted Session Report' },
    ],
  },
  ...(
    [
      ['tomomai', 'Tomomai'],
      ['mai-tools', 'mai-tools'],
      ['dxrating', 'DXRating'],
      ['jietng', 'JiETNG v2'],
      ['aqua', 'AquaDX'],
    ] as const
  ).map(([id, title]) => ({
    id,
    title,
    help: id,
    helpLabel: 'About file exports',
    methods: [{ value: `file:${id}` as ImportMethodValue, label: 'Upload a file', fileFormat: id }],
  })),
  {
    id: 'tachi',
    title: 'Tachi',
    help: 'tachi',
    helpLabel: 'About file exports',
    methods: [{ value: 'file:tachi', label: 'Upload BATCH-MANUAL', fileFormat: 'tachi' }],
  },
];

export function importServiceForMethod(method: ImportMethodValue): ImportService {
  const service = IMPORT_SERVICES.find((entry) =>
    entry.methods.some((row) => row.value === method),
  );
  if (!service) throw new Error('Unknown player import method.');
  return service;
}
export function importMethodFileFormat(method: ImportMethodValue): FileImportFormat | null {
  return (
    importServiceForMethod(method).methods.find((row) => row.value === method)?.fileFormat ?? null
  );
}

/** Hiding a method removes its choice; hiding every method removes the service. */
export function visibleImportServices(
  flags: Readonly<Partial<Record<ImportMethodValue, boolean>>>,
): readonly ImportService[] {
  return IMPORT_SERVICES.map((service) => ({
    ...service,
    methods: service.methods.filter((method) => flags[method.value] === true),
  })).filter((service) => service.methods.length > 0);
}
