export const IMPORT_FORMATS = [
  ['portable', 'Session Report / Party'],
  ['mai-tools', 'mai-tools'],
  ['dxrating', 'DXRating'],
  ['tomomai', 'Tomomai'],
  ['jietng', 'JiETNG'],
  ['aqua', 'AquaDX'],
  ['tachi', 'Tachi BATCH-MANUAL'],
] as const;
export type FileImportFormat = (typeof IMPORT_FORMATS)[number][0];
export interface FileImportOptions {
  format: FileImportFormat;
  username: string;
  region: 'jp' | 'intl' | 'cn' | 'private';
  instance?: string;
}
export interface ImportFile {
  size: number;
  lastModified?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
