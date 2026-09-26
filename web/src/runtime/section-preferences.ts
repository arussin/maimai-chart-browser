import type { SectionPreferences, SectionState } from '../components/chart-sections';
/** Optional presentation storage never blocks rendering or touches player inputs. */
export function sectionPreferences(key: string): SectionPreferences {
  return {
    read() {
      try {
        const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (!value || typeof value !== 'object') return {};
        const fields = value as Record<string, unknown>;
        const result: Partial<SectionState> = {};
        for (const name of ['chart', 'player'] as const)
          if (name in fields && typeof fields[name] === 'boolean') result[name] = fields[name];
        return result;
      } catch {
        return {};
      }
    },
    write(state) {
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {}
    },
    subscribe(listener) {
      const handler = (event: StorageEvent) => {
        if (event.key === key) listener();
      };
      window.addEventListener?.('storage', handler);
      return () => window.removeEventListener?.('storage', handler);
    },
  };
}
