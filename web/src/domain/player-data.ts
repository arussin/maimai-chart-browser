/** Portable player-data contract shapes; admitted only through the retained validator. */
export interface PlayerIdentity {
  key: string;
  provider: string;
  game: string;
  username: string;
  displayName: string;
}
export interface PlayerChart {
  chartID: string;
  songID: string;
  title: string;
  artist: string;
  format: string;
  difficulty: string;
  level: string;
  constant: number | null;
  displayVersion: string;
  inGameID: number | null;
}
export interface PlayerRecord {
  chartID: string;
  achievement: number | null;
  grade: string;
  rate: number | null;
  lamp: string;
  sync: string;
  constant: number | null;
  displayVersion: string;
  timeAchieved: number | null;
  dxScore: number | null;
  maxDxScore: number | null;
  maxCombo: number | null;
  fast: number | null;
  slow: number | null;
  miss: number | null;
  good: number | null;
  great: number | null;
  perfect: number | null;
  pcrit: number | null;
}
export interface PlayerSnapshot {
  capturedAt: number;
  phase: string;
  complete: boolean;
  versions: string[];
  pbs: Record<string, string>;
}
export interface PlayerCapture {
  capturedAt: number;
  sourceKind: string;
  sourceID: string;
  sessionID: string;
  historyCoverage: string;
  playIDs: string[];
  snapshotIDs: string[];
}
export interface PlayerDataset {
  format: string;
  schemaVersion: number;
  revision: string;
  player: PlayerIdentity;
  charts: Record<string, PlayerChart>;
  records: Record<string, PlayerRecord>;
  plays: Record<string, string>;
  snapshots: Record<string, PlayerSnapshot>;
  captures: Record<string, PlayerCapture>;
}
