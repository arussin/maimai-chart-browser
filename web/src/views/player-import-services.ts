export type ImportMethodValue =
  'file' | 'report' | 'maishift' | 'kamaitachi' | 'diving-fish' | 'lxns';
export interface ImportServiceMethod {
  value: ImportMethodValue;
  label: string;
  fileFormat?: 'portable';
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
};

/** Service identity owns the available methods; labels never select a parser. */
export const IMPORT_SERVICES: readonly ImportService[] = [
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
];

export function importServiceForMethod(method: ImportMethodValue): ImportService {
  const service = IMPORT_SERVICES.find((entry) =>
    entry.methods.some((row) => row.value === method),
  );
  if (!service) throw new Error('Unknown player import method.');
  return service;
}
export function importMethodFileFormat(method: ImportMethodValue): 'portable' | null {
  return (
    importServiceForMethod(method).methods.find((row) => row.value === method)?.fileFormat ?? null
  );
}
