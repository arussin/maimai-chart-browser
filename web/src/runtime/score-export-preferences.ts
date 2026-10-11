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
}): ScoreExportPreferences {
  const versions = new Set(ports.versionIDs),
    partners = new Set(ports.partnerKeys),
    storage = ports.storage ?? (() => localStorage),
    defaults = (): ScoreExportPreferenceValues => ({ versionID: null, partnerKey: 'none' });
  let state = defaults(),
    memoryOnly = false;
  const version = (value: unknown) =>
    typeof value === 'string' && versions.has(value) ? value : null;
  const partner = (value: unknown) =>
    typeof value === 'string' && partners.has(value) ? value : 'none';
  function read() {
    if (!memoryOnly) {
      let raw: string | null;
      try {
        raw = storage().getItem(scoreExportPreferencesKey);
      } catch {
        // A denied storage getter/read still permits choices for this page session.
        memoryOnly = true;
        return { ...state };
      }
      let value: unknown = null;
      try {
        if (raw && raw.length <= 2048) value = JSON.parse(raw);
      } catch {
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
    } catch {
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
