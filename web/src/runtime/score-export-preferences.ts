import type { DiagnosticSink, Stage, Reason } from '../diagnostic-contract';
import { beginDiagnostic } from './operation-diagnostics.ts';
import { storageReason } from './diagnostic-error.ts';
export const scoreExportPreferencesKey = 'maimai-score-export-preferences-v1';

export interface ScoreExportPreferenceValues {
  versionID: string | null;
  partnerKey: string;
}
export interface ScoreExportPreferences {
  read(): ScoreExportPreferenceValues;
  setVersion(value: string | null): void;
  setPartner(value: string): void;
}

/** Only optional presentation choices; never imported account or score data. */
export function createScoreExportPreferences(ports: {
  versionIDs: readonly string[];
  partnerKeys: readonly string[];
  storage?: () => Pick<Storage, 'getItem' | 'setItem'>;
  diagnose?: DiagnosticSink;
}): ScoreExportPreferences {
  const versions = new Set(ports.versionIDs),
    partners = new Set(ports.partnerKeys),
    storage = ports.storage ?? (() => localStorage),
    defaults = (): ScoreExportPreferenceValues => ({ versionID: null, partnerKey: 'none' });
  let state = defaults(),
    memoryOnly = false;
  const reported = new Set<string>();
  function degraded(stage: Stage, reason: Reason) {
    const key = stage + ':' + reason;
    if (reported.has(key)) return;
    reported.add(key);
    const operation = beginDiagnostic(ports.diagnose, 'preferences', 'persistent');
    operation.stage(stage);
    operation.finish('degraded', reason);
  }
  const version = (value: unknown) =>
    typeof value === 'string' && versions.has(value) ? value : null;
  const partner = (value: unknown) =>
    typeof value === 'string' && partners.has(value) ? value : 'none';
  function read() {
    if (!memoryOnly) {
      let raw: string | null;
      try {
        raw = storage().getItem(scoreExportPreferencesKey);
      } catch (error) {
        degraded('read', storageReason(error));
        // A denied storage getter/read still permits choices for this page session.
        memoryOnly = true;
        return { ...state };
      }
      let value: unknown = null;
      try {
        if (raw && raw.length <= 2048) value = JSON.parse(raw);
        else if (raw) degraded('decode', 'saved_malformed');
      } catch {
        degraded('decode', 'saved_malformed');
        // Malformed preferences do not prevent later valid storage updates.
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const fields = value as Record<string, unknown>;
        state =
          fields.schemaVersion === 1
            ? { versionID: version(fields.versionID), partnerKey: partner(fields.partnerKey) }
            : defaults();
      } else state = defaults();
    }
    return { ...state };
  }
  function write(next: ScoreExportPreferenceValues) {
    state = next;
    try {
      storage().setItem(scoreExportPreferencesKey, JSON.stringify({ schemaVersion: 1, ...state }));
      memoryOnly = false;
      reported.clear();
    } catch (error) {
      degraded('commit', storageReason(error));
      // Do not replace an unsaved manual choice with older storage on the next export.
      memoryOnly = true;
    }
  }
  return {
    read,
    setVersion(value) {
      write({ ...read(), versionID: version(value) });
    },
    setPartner(value) {
      write({ ...read(), partnerKey: partner(value) });
    },
  };
}
