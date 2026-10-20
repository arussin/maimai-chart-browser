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
};

/** Service identity owns the available methods; labels never select a parser. */
export const IMPORT_SERVICES: readonly ImportService[] = [
  {
    id: 'kamaitachi',
    title: 'Kamaitachi',
    help: 'kamaitachi',
    helpLabel: 'About Kamaitachi imports',
    methods: [
      { value: 'kamaitachi', label: 'Import by username' },
      { value: 'file:tachi', label: 'Upload BATCH-MANUAL', fileFormat: 'tachi' },
    ],
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
    id: 'maishift',
    title: 'Maishift',
    help: 'maishift',
    helpLabel: 'About Maishift imports',
    methods: [{ value: 'maishift', label: 'Public profile' }],
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
