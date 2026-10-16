import {
  VERSION,
  validateRow,
  type Page,
  type UsageRow,
  type EmitArguments,
} from './usage-contract';
import { validateDiagnostic, type DiagnosticRow, type DiagnosticSink } from './diagnostic-contract';
export interface DeliveryStatus {
  last:
    | 'idle'
    | 'disabled'
    | 'recorded'
    | 'unconfirmed'
    | 'network'
    | 'timeout'
    | 'rejected'
    | 'unavailable';
  saturated: number;
  dropped: number;
  schema: 'unknown' | 'compatible' | 'incompatible';
}
export interface UsageAPI {
  emit: (...args: EmitArguments) => void;
  activate: (page: Page) => void;
  flush: () => Promise<void>;
  suspend: <T>(run: () => T) => T;
  disable: () => void;
  diagnose?: DiagnosticSink;
  delivery?: () => Readonly<DeliveryStatus>;
}
declare global {
  interface Window {
    maimaiUsageEnabled?: boolean;
  }
}
export function createUsageForOrigin(
  origin: 'https://maimai.party' | 'https://maimai-party-staging.pages.dev',
): UsageAPI {
  let enabled = window.maimaiUsageEnabled !== false,
    suspended = 0,
    page: Page = 'charts',
    timer: number | undefined;
  const queue = new Map<string, UsageRow>(),
    diagnostics = new Map<string, DiagnosticRow>(),
    firstFilters = new Set<string>();
  const status: DeliveryStatus = { last: 'idle', saturated: 0, dropped: 0, schema: 'unknown' };
  const bump = (key: 'saturated' | 'dropped', amount = 1) => {
    status[key] = Math.min(1000, status[key] + amount);
  };
  let pending = 0;
  const allowed = () =>
    enabled &&
    window.maimaiUsageEnabled !== false &&
    location.origin === origin &&
    !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl &&
    navigator.doNotTrack !== '1' &&
    (window as Window & { doNotTrack?: string }).doNotTrack !== '1' &&
    !(document as Document & { prerendering?: boolean }).prerendering;
  function emit(...[event, p = page, detail = '', failure = '']: EmitArguments) {
    if (suspended || !allowed()) return;
    const row = validateRow({ event, page: p, detail, failure, count: 1 });
    if (!row) return;
    if (event === 'filter_first_used') {
      if (firstFilters.has(detail)) return;
      firstFilters.add(detail);
    }
    const key = [row.event, row.page, row.detail, row.failure].join('|'),
      existing = queue.get(key);
    if (existing) {
      if (existing.count === 100) {
        bump('saturated');
        bump('dropped');
      }
      existing.count = Math.min(100, existing.count + 1);
    } else if (queue.size < 16) queue.set(key, row);
    else {
      bump('saturated');
      bump('dropped');
    }
    if (queue.size && !timer)
      timer = window.setTimeout(() => {
        void flush();
      }, 10000);
  }
  function diagnose(value: DiagnosticRow) {
    if (suspended || !allowed()) return;
    const row = validateDiagnostic(value);
    if (!row) return;
    const key = JSON.stringify({ ...row, count: 0 }),
      existing = diagnostics.get(key);
    if (!existing && diagnostics.size === 16) {
      bump('saturated');
      void flush();
    }
    if (existing) {
      const next = existing.count + row.count;
      if (next > 100) {
        bump('saturated');
        bump('dropped', next - 100);
      }
      existing.count = Math.min(100, next);
    } else diagnostics.set(key, row);
    // Coalesce technical terminals too; storage transactions must not cause a request burst.
    if (!timer)
      timer = window.setTimeout(() => {
        void flush();
      }, 10000);
  }
  async function send(version: 1 | 2, rows: (UsageRow | DiagnosticRow)[]) {
    if (!allowed() || !rows.length) return;
    if (pending >= 2) {
      bump('saturated');
      bump(
        'dropped',
        rows.reduce((n, r) => n + r.count, 0),
      );
      return;
    }
    const body = JSON.stringify({ version, events: rows });
    if (new TextEncoder().encode(body).length > 4096) {
      if (rows.length === 1) {
        bump('dropped', rows[0].count);
        return;
      }
      const middle = Math.ceil(rows.length / 2);
      await send(version, rows.slice(0, middle));
      await send(version, rows.slice(middle));
      return;
    }
    pending++;
    const timeout = AbortSignal.timeout(5000);
    try {
      const response = await fetch('/__usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        keepalive: true,
        signal: timeout,
      });
      if (!allowed()) return;
      const schema = response.headers.get('X-Maimai-Usage-Schema');
      status.schema =
        schema === null ? 'unknown' : schema === '1,2' ? 'compatible' : 'incompatible';
      status.last =
        response.status === 204
          ? response.headers.get('X-Maimai-Usage-Receipt') === 'stored'
            ? 'recorded'
            : 'unconfirmed'
          : response.status >= 400 && response.status < 500
            ? 'rejected'
            : 'unavailable';
      if (response.status !== 204)
        bump(
          'dropped',
          rows.reduce((n, r) => n + r.count, 0),
        );
    } catch {
      if (allowed()) {
        status.last = timeout.aborted ? 'timeout' : 'network';
        bump(
          'dropped',
          rows.reduce((n, r) => n + r.count, 0),
        );
      }
    } finally {
      pending--;
    }
  }
  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    const rows = [...queue.values()];
    const diagnosticRows = [...diagnostics.values()];
    queue.clear();
    diagnostics.clear();
    if (!allowed()) return;
    await send(VERSION, rows);
    if (allowed()) await send(2, diagnosticRows);
  }
  const api: UsageAPI = Object.freeze({
    emit,
    flush,
    diagnose,
    delivery: () =>
      Object.freeze(
        allowed()
          ? { ...status }
          : { last: 'disabled', saturated: 0, dropped: 0, schema: 'unknown' },
      ),
    activate: (next: Page) => {
      page = next;
      emit('page_view');
    },
    suspend: <T>(run: () => T) => {
      suspended++;
      try {
        return run();
      } finally {
        suspended--;
      }
    },
    disable: () => {
      enabled = false;
      queue.clear();
      diagnostics.clear();
      status.last = 'disabled';
      status.dropped = 0;
      status.saturated = 0;
      status.schema = 'unknown';
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  });
  // Navigation owns initial activation. BFCache restoration is a new activation.
  window.addEventListener('pagehide', () => {
    void flush();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
  return api;
}
